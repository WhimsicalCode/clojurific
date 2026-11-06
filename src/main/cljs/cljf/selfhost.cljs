;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

(ns cljf.selfhost
  "Self-hosted ClojureScript: compiles and evaluates forms in the page, with
  the compiler running in the page rather than the watcher's JVM. In builds
  with :self-host: a watched build's REPL runtime loads this namespace on
  demand (cljs_selfhost_eval), other builds require it (i.e. a playground).

  Forms are compiled as the JVM REPL compiles them (cljs.compiler's
  *esm-repl*): the body of a function taking views of the namespaces it
  references, which cljf.esm.repl-runtime evaluates. The analysis of the
  build's namespaces is read from the analysis caches in the output
  directory, as forms need it. Macros expand with the macros the build
  compiles as ClojureScript: cljs.core's (cljs/core$macros.js), and
  cljf.jsx's (cljf/jsx$macros.js), loaded for forms with #x literals. Other
  macro namespaces are Clojure, and aren't available.

  npm modules can't be loaded in the page: a form requires those the page
  provides (provide-module!), i.e. (ns app (:require [\"react\" :as react])),
  or reaches those of a namespace of the build that requires them.

  globalThis.cljs_selfhost_eval(code, opts) evaluates in the console."
  (:require [cljf.esm.repl-runtime :as rt]
            [cljs.analyzer :as ana]
            [cljs.compiler :as comp]
            [cljs.env :as env]
            [cljs.tagged-literals :as tags]
            [cljs.tools.reader :as reader]
            [cljs.tools.reader.reader-types :as readers]
            [clojure.set]
            [clojure.string :as string]
            [clojure.walk]
            [cognitect.transit :as transit]))

(def ^:private goog-shims
  "The Closure Library namespaces with an ES module shim in the output
  directory (see cljf.esm/goog-shims), {ns import-fn}: static paths relative
  to this module's output, which bundlers resolve to the modules the build's
  namespaces import."
  {"goog"                   #(js* "import(\"../goog.js\")")
   "goog.array"             #(js* "import(\"../goog/array.js\")")
   "goog.math"              #(js* "import(\"../goog/math.js\")")
   "goog.object"            #(js* "import(\"../goog/object.js\")")
   "goog.string"            #(js* "import(\"../goog/string.js\")")
   "goog.userAgent.product" #(js* "import(\"../goog/userAgent/product.js\")")})

(def ^:private macro-imports
  "The macro namespaces compiled as ClojureScript by the build (cljf.esm's
  self-host-macros), {ns import-fn}: static paths, which bundlers split
  into chunks of their own."
  {'cljs.core #(js* "import(\"../cljs/core$macros.js\")")
   'cljf.jsx  #(js* "import(\"../cljf/jsx$macros.js\")")})

(defonce ^:private analysis-root
  ;; the URL the analysis caches are fetched from, default the output
  ;; directory's (cljf.esm.repl-runtime/root)
  (atom nil))

(defn set-analysis-root!
  "Fetches the analysis caches from url (a string or URL) rather than the
  output directory: a bundle's are copied elsewhere, i.e. next to its page.
  Paths under it are the output directory's (cljs/core.cljs.cache.json)."
  [url]
  ;; relative to the page, outside one (Node.js, a worker) an absolute URL
  (reset! analysis-root (if (exists? js/document)
                          (js/URL. (str url) (.-baseURI js/document))
                          (js/URL. (str url)))))

(defonce ^:private state
  (doto (env/default-compiler-env {:static-fns true})
    ;; known to the analyzer as JavaScript namespaces, references go through
    ;; their modules (see refs)
    (swap! assoc :js-dependency-index
      (into {} (map (fn [ns] [ns {:provides [ns]}])) (keys goog-shims)))
    ;; the npm modules known to the analyzer (cljs.analyzer/node-module-dep?):
    ;; provided ones, and those the build's namespaces require
    (swap! assoc :node-module-index #{})))

(defonce ^:private modules
  ;; the npm modules forms can require, {lib module}, see provide-module!
  (js/Map.))

(defn provide-module!
  "Lets forms require npm module lib (a string, i.e. \"react\") as module,
  the page's: (ns app (:require [\"react\" :as react])). The self-hosted
  compiler can't load npm modules, only use those the page has imported."
  [lib module]
  (.set modules (str lib) module)
  (swap! state update :node-module-index conj (str lib)))

(defonce ^:private current-ns (atom 'cljs.user))

(defn- ns->path [ns ext]
  (str (string/replace (munge (str ns)) "." "/") ext))

(def ^:private transit-reader
  (delay
    (transit/reader :json
      {:handlers {"cljs/js"    (fn [v] (tags/->JSValue v))
                  "cljs/regex" (fn [v] (re-pattern v))}})))

(defn- fetch-text
  "A promise of the text of path relative to the output directory, nil if
  it's not there, rejected if it couldn't be fetched (i.e. a network error,
  the dev server restarting)."
  [path]
  (-> (js/fetch (.-href (js/URL. path (or @analysis-root (rt/root)))) #js {:headers #js {:Accept "application/json"}})
      (.then (fn [^js res]
               (let [type (or (.get (.-headers res) "content-type") "")]
                 (cond
                   ;; not a page, i.e. the dev server's fallback for a missing file
                   (and (.-ok res) (not (string/includes? type "html"))) (.text res)
                   (or (.-ok res) (= 404 (.-status res))) nil
                   :else (throw (js/Error. (str "Fetching " path ": HTTP " (.-status res))))))))))

(defonce ^:private analyses
  ;; {ns promise}: of whether the namespace's analysis cache was read
  (atom {}))

(defonce ^:private cached
  ;; the namespaces whose analysis was read from the output directory: their
  ;; modules are there
  (atom #{}))

(defn- load-analysis!
  "A promise of whether the analysis of namespace ns was read, from its
  analysis cache in the output directory (written by the build)."
  [ns]
  (let [ns (symbol ns)]
    (or (get @analyses ns)
        (let [p (-> (fetch-text (ns->path ns ".cljs.cache.json"))
                    (.then #(or % (fetch-text (ns->path ns ".cljc.cache.json"))))
                    (.then (fn [text]
                             (if text
                               (let [analysis (transit/read @transit-reader text)]
                                 (swap! state #(-> %
                                                   (assoc-in [::ana/namespaces ns] analysis)
                                                   ;; its npm modules, which forms reach
                                                   ;; through its registration's libs
                                                   (update :node-module-index into
                                                     (filter string? (vals (:requires analysis))))))
                                 (swap! cached conj ns)
                                 true)
                               false)))
                    ;; not remembered: the next form fetches it again
                    (.catch (fn [_]
                              (swap! analyses dissoc ns)
                              false)))]
          (swap! analyses assoc ns p)
          p))))

(defn- registered? [ns]
  (some-> (.-$CLJS_ESM js/globalThis) .-nses (.has (str ns))))

(defn- registry []
  (or (.-$CLJS_ESM js/globalThis)
      (set! (.-$CLJS_ESM js/globalThis) #js {:nses (js/Map.)})))

(defonce ^:private macro-loads
  ;; {ns promise}: of the macros of ns loaded
  (atom {}))

(defn- load-macros!
  "A promise of the macros of namespace ns (macro-imports) loaded: their
  module registered for the analyzer (cljs.core/find-macros-ns), a module
  compiled with :esm-repl registers itself, otherwise it's registered here.
  And their analysis, for the macros' arities."
  [ns]
  (or (get @macro-loads ns)
      (let [mns (str ns "$macros")
            p   (js/Promise.all
                  #js [(load-analysis! mns)
                       (.then ((macro-imports ns))
                         (fn [m]
                           (when-not (registered? mns)
                             (.set (.-nses (registry)) mns
                               #js {:mod m :sets #js [(.-$$set m)] :libs #js {} :gen 1}))))])]
        (swap! macro-loads assoc ns p)
        p)))

(defn- load-core!
  "A promise of cljs.core's analysis and macros."
  []
  (js/Promise.all #js [(load-analysis! 'cljs.core) (load-macros! 'cljs.core)]))

(defn- ensure-ns! [ns]
  (when-not (get-in @state [::ana/namespaces ns])
    (swap! state assoc-in [::ana/namespaces ns] {:name ns})))

(defn- load-ns!
  "A promise of namespace ns' analysis and of those it requires, if they're
  the build's."
  [ns]
  (-> (load-analysis! ns)
      (.then (fn [_]
               (ensure-ns! ns)
               (let [{:keys [requires]} (get-in @state [::ana/namespaces ns])]
                 (js/Promise.all
                   (into-array (map load-analysis! (distinct (remove string? (vals requires)))))))))))

;; Compiling

(defn- warning-handler [warnings]
  (fn [warning-type env extra]
    (when (warning-type ana/*cljs-warnings*)
      (when-let [s (ana/error-message warning-type extra)]
        (swap! warnings conj {:type    warning-type
                              ;; the namespace whose analysis may be missing
                              :ns      (case warning-type
                                         :undeclared-var (some-> (:prefix extra) symbol)
                                         :undeclared-ns  (some-> (:ns-sym extra) symbol)
                                         nil)
                              :message s
                              :line    (:line env)
                              :column  (:column env)})))))

(defn- refs
  "The references of the namespaces of an emitted form, [alias ns kind
  path], see cljf.esm.repl-runtime/load-ref."
  [esm]
  (concat
    (for [ns (sort @(:refs esm))]
      [(comp/esm-ns-alias ns) ns "ns"
       (when-not (registered? ns)
         (when (contains? @cached (symbol ns))
           (ns->path ns ".js")))])
    (for [ns (sort @(:goog-lib-refs esm))]
      (if (goog-shims ns)
        [(str (comp/esm-ns-alias ns) "$") ns "goog-shim" nil]
        [(str (comp/esm-ns-alias ns) "$") ns "default" (str "goog-lib/ns/" ns ".js")]))))

(defn- compile-form
  "Analyzes and emits form in namespace ns: {:ast :js :refs :warnings :ns},
  :ns the namespace after the form (i.e. of an ns form)."
  [form ns]
  (let [warnings (atom [])
        esm      (comp/esm-state)]
    (binding [env/*compiler*              state
              ana/*cljs-ns*               ns
              ana/*cljs-file*             "<cljs selfhost>"
              ana/*cljs-static-fns*       true
              ana/*analyze-deps*          false
              ana/*cljs-warning-handlers* [(warning-handler warnings)]]
      (let [env (assoc (ana/empty-env)
                  :ns (ana/get-namespace ns)
                  :context :return
                  :def-emits-var true)
            ast (ana/analyze env form nil (:options @state))
            ns' ana/*cljs-ns*
            js  (binding [comp/*esm*          esm
                          comp/*esm-emitting* true
                          comp/*esm-repl*     true]
                  (comp/emit-str ast))]
        {:ast ast :js js :refs (refs esm) :warnings @warnings :ns ns'}))))

(defn- missing-nses
  "The namespaces of undeclared vars in warnings that might be the build's
  and whose analysis wasn't read yet."
  [warnings]
  (->> warnings
       (keep (fn [{:keys [type ns]}]
               (when (and ns (not (contains? @analyses ns)))
                 ns)))
       distinct))

(defn- compile-loading
  "compile-form, then again after reading the analysis of the namespaces it
  referenced without it (i.e. of the vars a macro expanded to)."
  [form ns]
  (let [compiled (compile-form form ns)
        missing  (missing-nses (:warnings compiled))]
    (if (seq missing)
      (-> (js/Promise.all (into-array (map load-analysis! missing)))
          (.then (fn [loaded]
                   (if (some true? loaded)
                     (compile-loading form ns)
                     compiled))))
      (js/Promise.resolve compiled))))

;; Evaluating

(defn- error-message [e]
  (loop [e e]
    (cond
      (nil? e) "Unknown error"
      (and (nil? (ex-message e)) (ex-cause e)) (recur (ex-cause e))
      :else (str (or (ex-message e) e)
                 (when-let [c (ex-cause e)]
                   (when (ex-message c) (str ": " (ex-message c))))))))

(defn- load-ref
  "A promise of what reference [alias ns kind path] of a form is bound to,
  see cljf.esm.repl-runtime/load-ref: kind goog-shim a Closure Library
  shim's module."
  [[_ ns kind :as ref]]
  (if (= "goog-shim" kind)
    ((goog-shims ns))
    (rt/load-ref ref)))

(defn- run-js
  "A promise of {:value} of a compiled form, as a map: a promise value isn't
  awaited, unless :await."
  [{:keys [js refs]} opts]
  (-> (js/Promise.all (into-array (map load-ref refs)))
      (.then (fn [args]
               (let [f (js/Reflect.construct js/Function (into-array (concat (map first refs) [js])))
                     v (.apply f nil args)]
                 (if (and (:await opts) (some? v) (fn? (.-then v)))
                   (.then v (fn [x] {:value x}))
                   {:value v}))))))

(defn- ns-form-deps
  "The namespaces an ns (or require) form's ast requires."
  [ast]
  (distinct (remove string? (:deps ast))))

(defn- provide-libs!
  "Binds the npm modules an ns (or require) form's ast requires in namespace
  ns, as the build's modules bind theirs (cljs.analyzer/munge-node-lib): the
  provided ones (provide-module!). Throws for others."
  [ast ns]
  (doseq [lib (distinct (filter string? (:deps ast)))]
    (if (.has modules lib)
      (unchecked-set (rt/view (str ns)) (ana/munge-node-lib lib) (.get modules lib))
      (throw (js/Error. (str "npm module " lib " isn't in the page: the self-hosted compiler "
                             "only requires the modules the page provides (cljf.selfhost/provide-module!)"))))))

(defn- eval-form
  "A promise of {:ns :value :warnings :error} of form in namespace ns."
  [form ns opts]
  (if (and (seq? form) (= 'in-ns (first form)))
    (let [[_ [_ ns-sym]] form]
      (.then (load-ns! ns-sym) (fn [_] {:ns ns-sym :value nil})))
    (-> (compile-loading form ns)
        (.then
          (fn [{:keys [ast warnings] :as compiled}]
            (cond
              (and (seq warnings) (not (:warnings-ok opts)))
              {:ns ns :warnings warnings
               :error (str "Form not evaluated: " (count warnings) " warning(s)")}

              ;; ns, require: reads the analysis of the namespaces
              ;; required, loads their modules
              (#{:ns :ns*} (:op ast))
              (let [deps (ns-form-deps ast)]
                (provide-libs! ast (:ns compiled))
                (-> (js/Promise.all (into-array (map load-ns! deps)))
                    (.then (fn [_]
                             (js/Promise.all
                               (into-array
                                 (for [dep deps]
                                   ;; the build's have a module, the ones
                                   ;; defined in the page only a view
                                   (rt/load-ref [nil (str dep) "ns"
                                                 (when (and (not (registered? dep))
                                                            (contains? @cached dep))
                                                   (ns->path dep ".js"))]))))))
                    (.then (fn [_] {:ns (:ns compiled) :value nil :warnings warnings}))))

              :else
              (.then (run-js compiled opts)
                (fn [{:keys [value]}] {:ns (:ns compiled) :value value :warnings warnings}))))))))

(defn- jsx-literals?
  "Whether form has #x literals (cljf.jsx/x), #js literals' too."
  [form]
  (some #(= 'cljf.jsx/x %)
        (tree-seq #(or (coll? %) (instance? tags/JSValue %))
                  #(if (instance? tags/JSValue %) (seq (.-val %)) (seq %))
                  form)))

(defn- requires-jsx?
  "Whether namespace ns requires cljf.jsx, which #x literals need."
  [ns]
  (or (= 'cljf.jsx ns)
      (some #{'cljf.jsx} (vals (get-in @state [::ana/namespaces ns :requires])))))

(defn- eval-jsx-form
  "eval-form of a form with #x literals: once cljf.jsx's macros are loaded,
  and namespace ns requires cljf.jsx (implicitly, as the build does for a
  source file with #x literals), unless the form is an ns form."
  [form ns opts]
  (-> (load-macros! 'cljf.jsx)
      (.then (fn [_]
               (if (or (requires-jsx? ns)
                       (and (seq? form) (= 'ns (first form))))
                 (eval-form form ns opts)
                 (.then (eval-form '(require (quote cljf.jsx)) ns opts)
                   (fn [{:keys [error] :as r}]
                     (if error r (eval-form form ns opts)))))))))

(defn- read-form
  "The next form of reader rdr, eof when there's none, read in namespace ns:
  its aliases resolve ::alias/keywords and syntax quotes."
  [rdr ns eof]
  ;; binding's values are evaluated before any is bound
  (binding [env/*compiler*          state
            ana/*cljs-ns*           ns
            *ns*                    (create-ns ns)
            reader/*alias-map*      (binding [env/*compiler* state] (ana/get-aliases ns))
            reader/*data-readers*   tags/*cljs-data-readers*
            reader/resolve-symbol   ana/resolve-symbol]
    (reader/read {:eof eof :read-cond :allow :features #{:cljs}} rdr)))

(defn- error-result
  "The result of an evaluation that threw e (anything, nil too) in namespace
  ns."
  [ns e]
  {:ns ns :error (error-message e) :stack (some-> e .-stack)})

(defn eval-str
  "Evaluates the forms of string code, returns a promise of {:value :ns
  :warnings :error}: :value is the last form's, printed unless
  :print false, :ns the namespace evaluating the next form. Stops at the
  first form with an error or warnings (unless :warnings-ok). Each form is
  read once the one before it is evaluated, in the namespace it left (i.e.
  of an ns form), with the aliases it required. Never rejected.

  opts:
  - :ns - evaluate in this namespace, default the last in-ns's
  - :await - the value of a promise
  - :warnings-ok - evaluate forms with warnings
  - :print-length, :print-level - of the printed value"
  ([code] (eval-str code nil))
  ([code opts]
   (let [ns  (or (some-> (:ns opts) symbol) @current-ns)
         rdr (readers/indexing-push-back-reader code 1 "<cljs selfhost>")
         eof (js-obj)
         ;; a promise of the result of the forms after last's, in namespace
         ;; ns: an error's namespace is the one its form ran in
         run (fn run [ns last]
               (-> (js/Promise.resolve nil)
                   (.then (fn [_]
                            (let [form (read-form rdr ns eof)]
                              (if (identical? eof form)
                                (or last {:ns ns :value nil})
                                (.then (if (jsx-literals? form)
                                         (eval-jsx-form form ns opts)
                                         (eval-form form ns opts))
                                  (fn [{:keys [error] :as r}]
                                    (if error r (run (:ns r) r))))))))
                   ;; reading or evaluating a form threw: in the namespace
                   ;; it was read in
                   (.catch #(error-result ns %))))
         print (fn [r]
                 (if (and (contains? r :value) (not (false? (:print opts))))
                   (try
                     (update r :value #(binding [*print-length* (:print-length opts *print-length*)
                                                 *print-level*  (:print-level opts *print-level*)]
                                         (pr-str %)))
                     ;; i.e. a lazy sequence throwing as it's realized
                     (catch :default e
                       (merge (dissoc r :value) (error-result (:ns r) e))))
                   r))]
     (-> (load-core!)
         (.then (fn [_] (load-ns! ns)))
         (.then (fn [_] (run ns nil)))
         (.catch #(error-result ns %))
         (.then (fn [{:keys [ns] :as r}]
                  (when-not (:ns opts) (reset! current-ns ns))
                  (print r)))))))

(defn console-eval
  "eval-str for the console (globalThis.cljs_selfhost_eval): a promise of
  the value, rejected with the error or warnings."
  [code opts]
  (let [opts (cond-> opts (object? opts) (js->clj :keywordize-keys true))]
    (-> (eval-str code (merge {:print false} opts))
        (.then (fn [{:keys [value error warnings]}]
                 (doseq [{:keys [message line column]} warnings]
                   (js/console.warn (str "WARNING: " message " at " line ":" column)))
                 (if error
                   (throw (js/Error. error))
                   value))))))
