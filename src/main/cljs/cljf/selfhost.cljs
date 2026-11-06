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
  directory, as forms need it. Macros expand with cljs.core's macros
  compiled as ClojureScript (cljs/core$macros.js, written by the build):
  other macro namespaces are Clojure, and aren't available.

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

(defn- import-core-macros
  "Imports cljs.core's macros (cljs/core$macros.js, written by the build):
  a static path, which bundlers split into a chunk of its own."
  []
  (js* "import(\"../cljs/core$macros.js\")"))

(defonce ^:private analysis-root
  ;; the URL the analysis caches are fetched from, default the output
  ;; directory's (cljf.esm.repl-runtime/root)
  (atom nil))

(defn set-analysis-root!
  "Fetches the analysis caches from url (a string or URL) rather than the
  output directory: a bundle's are copied elsewhere, i.e. next to its page.
  Paths under it are the output directory's (cljs/core.cljs.cache.json)."
  [url]
  (reset! analysis-root (js/URL. (str url) (.-baseURI js/document))))

(defonce ^:private state
  (doto (env/default-compiler-env {:static-fns true})
    ;; known to the analyzer as JavaScript namespaces, references go through
    ;; their modules (see refs)
    (swap! assoc :js-dependency-index
      (into {} (map (fn [ns] [ns {:provides [ns]}])) (keys goog-shims)))))

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
  it's not there."
  [path]
  (-> (js/fetch (.-href (js/URL. path (or @analysis-root (rt/root)))) #js {:headers #js {:Accept "application/json"}})
      (.then (fn [^js res]
               (let [type (or (.get (.-headers res) "content-type") "")]
                 ;; not a page, i.e. the dev server's fallback for a missing file
                 (when (and (.-ok res) (not (string/includes? type "html")))
                   (.text res)))))
      (.catch (fn [_] nil))))

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
                               (do (swap! state assoc-in [::ana/namespaces ns]
                                     (transit/read @transit-reader text))
                                   (swap! cached conj ns)
                                   true)
                               false))))]
          (swap! analyses assoc ns p)
          p))))

(defn- registered? [ns]
  (some-> (.-$CLJS_ESM js/globalThis) .-nses (.has (str ns))))

(defn- registry []
  (or (.-$CLJS_ESM js/globalThis)
      (set! (.-$CLJS_ESM js/globalThis) #js {:nses (js/Map.)})))

(defn- load-core!
  "A promise of cljs.core's analysis and macros, the module of its macros
  registered for the analyzer (cljs.core/find-macros-ns): a module compiled
  with :esm-repl registers itself, otherwise it's registered here."
  []
  (js/Promise.all
    #js [(load-analysis! 'cljs.core)
         ;; for the macros' arities
         (load-analysis! 'cljs.core$macros)
         (.then (import-core-macros)
           (fn [m]
             (when-not (registered? "cljs.core$macros")
               (.set (.-nses (registry)) "cljs.core$macros"
                 #js {:mod m :sets #js [(.-$$set m)] :libs #js {} :gen 1}))))]))

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
                (-> (js/Promise.all (into-array (map load-ns! deps)))
                    (.then (fn [_]
                             (js/Promise.all
                               (into-array
                                 (for [dep deps]
                                   (rt/load-ref [nil (str dep) "ns"
                                                 (when-not (registered? dep)
                                                   (ns->path dep ".js"))]))))))
                    (.then (fn [_] {:ns (:ns compiled) :value nil :warnings warnings}))))

              :else
              (.then (run-js compiled opts)
                (fn [{:keys [value]}] {:ns (:ns compiled) :value value :warnings warnings}))))))))

(defn- read-forms
  "The forms of string code, read in namespace ns: its aliases resolve
  ::alias/keywords and syntax quotes."
  [code ns]
  ;; binding's values are evaluated before any is bound
  (binding [env/*compiler*          state
            ana/*cljs-ns*           ns
            *ns*                    (create-ns ns)
            reader/*alias-map*      (binding [env/*compiler* state] (ana/get-aliases ns))
            reader/*data-readers*   tags/*cljs-data-readers*
            reader/resolve-symbol   ana/resolve-symbol]
    (let [rdr (readers/indexing-push-back-reader code 1 "<cljs selfhost>")
          eof (js-obj)]
      (loop [forms []]
        (let [form (reader/read {:eof eof :read-cond :allow :features #{:cljs}} rdr)]
          (if (identical? eof form)
            forms
            (recur (conj forms form))))))))

(defn eval-str
  "Evaluates the forms of string code, returns a promise of {:value :ns
  :warnings :error}: :value is the last form's, printed unless
  :print false, :ns the namespace evaluating the next form. Stops at the
  first form with an error or warnings (unless :warnings-ok).

  opts:
  - :ns - evaluate in this namespace, default the last in-ns's
  - :await - the value of a promise
  - :warnings-ok - evaluate forms with warnings
  - :print-length, :print-level - of the printed value"
  ([code] (eval-str code nil))
  ([code opts]
   (let [ns  (or (some-> (:ns opts) symbol) @current-ns)
         run (fn run [forms ns last]
               (if-let [form (first forms)]
                 (-> (eval-form form ns opts)
                     (.then (fn [{:keys [error] :as r}]
                              (if error r (run (rest forms) (:ns r) r)))))
                 (js/Promise.resolve (or last {:ns ns :value nil}))))]
     (-> (load-core!)
         (.then (fn [_] (load-ns! ns)))
         (.then (fn [_] (run (read-forms code ns) ns nil)))
         (.catch (fn [e] {:ns ns :error (error-message e) :stack (.-stack e)}))
         (.then (fn [{:keys [ns] :as r}]
                  (when-not (:ns opts) (reset! current-ns ns))
                  (cond-> r
                    (and (contains? r :value) (not (false? (:print opts))))
                    (update :value #(binding [*print-length* (:print-length opts *print-length*)
                                              *print-level*  (:print-level opts *print-level*)]
                                      (pr-str %))))))))))

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
