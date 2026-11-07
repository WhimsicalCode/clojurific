;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

(ns cljf.webmcp
  "The self-hosted compiler's tools for agents in the browser, through
  WebMCP (document.modelContext.registerTool): evaluating ClojureScript in
  the page and looking up its namespaces, as the REPL's MCP server does
  through the watcher in development. In builds with :self-host, see
  register!.

  WebMCP is a proposed standard, in Chrome behind an origin trial (or
  chrome://flags/#enable-webmcp-testing): without it register! does
  nothing."
  (:require [cljf.selfhost :as selfhost]
            [clojure.string :as string]))

(defn model-context
  "The page's WebMCP model context, nil without WebMCP:
  document.modelContext, or navigator.modelContext of earlier versions."
  []
  (or (when (exists? js/document) (.-modelContext js/document))
      (when (exists? js/navigator) (.-modelContext js/navigator))))

(def ^:private max-text
  ;; characters of a value or of the output, then truncated
  20000)

(defn- truncate [s]
  (if (and (string? s) (> (count s) max-text))
    (str (subs s 0 max-text) "… (truncated, " (count s) " characters)")
    s))

(defn- result-text
  "A tool's result, as WebMCP returns it to the agent: a string, here JSON."
  [m]
  (js/JSON.stringify (clj->js m) nil 1))

(defn- arg [^js input k]
  (let [v (when input (unchecked-get input k))]
    (when-not (or (undefined? v) (nil? v)) v)))

;; Evaluating

(defonce ^:private evals
  ;; a promise of the last evaluation: one at a time, the output each prints
  ;; is its own
  (atom (js/Promise.resolve nil)))

(defn- capturing
  "Calls f, which returns a promise, with the output printed until it
  settles captured into out and err (arrays), newlines too, still printed
  where it would be: without the newlines where *print-newline* was false
  (the console, which prints lines)."
  [f out err]
  (let [print-fn      *print-fn*
        print-err-fn  *print-err-fn*
        print-newline *print-newline*
        forward       (fn [pf s] (when (and pf (or print-newline (not= "\n" s))) (pf s)))
        restore       (fn []
                        (set! *print-fn* print-fn)
                        (set! *print-err-fn* print-err-fn)
                        (set! *print-newline* print-newline))]
    (set! *print-newline* true)
    (set! *print-fn* (fn [s] (.push out s) (forward print-fn s)))
    (set! *print-err-fn* (fn [s] (.push err s) (forward print-err-fn s)))
    (-> (js/Promise.resolve nil)
        (.then f)
        (.finally restore))))

(defn- eval-tool
  [{:keys [ns before-eval after-eval]}]
  (fn [input]
    (let [code (str (or (arg input "code") ""))
          opts {:ns           (or (arg input "ns") ns)
                :await        (boolean (arg input "await"))
                :warnings-ok  (boolean (arg input "warnings_ok"))
                :print-length (if (some? (arg input "print_length")) (arg input "print_length") 50)
                :print-level  (if (some? (arg input "print_level")) (arg input "print_level") 8)}
          out  #js []
          err  #js []
          run  (fn []
                 (when before-eval (before-eval code))
                 (-> (capturing #(selfhost/eval-str code (into {} (remove (comp nil? val)) opts)) out err)
                     (.then (fn [r]
                              (when after-eval (after-eval code r))
                              (result-text
                                (cond-> {:ns (str (:ns r))}
                                  (contains? r :value) (assoc :value (truncate (:value r)))
                                  (pos? (.-length out)) (assoc :out (truncate (.join out "")))
                                  (pos? (.-length err)) (assoc :err (truncate (.join err "")))
                                  (seq (:warnings r))  (assoc :warnings (mapv #(select-keys % [:message :line :column]) (:warnings r)))
                                  (:error r)           (assoc :error (:error r))))))))
          ;; after the last evaluation, whether it failed or not
          p    (.then @evals run run)]
      (reset! evals p)
      p)))

;; Looking up

(defn- doc-tool [{:keys [ns]}]
  (fn [input]
    (let [sym (str (or (arg input "symbol") ""))
          ns  (or (arg input "ns") ns)]
      (-> (selfhost/doc sym ns)
          (.then (fn [m]
                   (result-text (or m {:error (str "No var, macro or namespace " sym " in " (or ns "the current namespace"))}))))))))

(defn- apropos-tool [_]
  (fn [input]
    (.then (selfhost/apropos (str (or (arg input "query") "")) (arg input "ns"))
      (fn [matches]
        (result-text {:matches (vec (take 200 matches)) :count (count matches)})))))

(defn- ns-info-tool [_]
  (fn [input]
    (let [ns (str (or (arg input "ns") ""))]
      (.then (selfhost/ns-info ns)
        (fn [m] (result-text (or m {:error (str "No namespace " ns " in the page, see the namespaces tool")})))))))

(defn- macroexpand-tool [{:keys [ns]}]
  (fn [input]
    (-> (selfhost/macroexpand-str (str (or (arg input "form") "")) (or (arg input "ns") ns) (arg input "mode"))
        (.then (fn [s] (result-text {:expansion (truncate s)}))
               (fn [e] (result-text {:error (str "Could not expand: " (or (ex-message e) e))}))))))

(defn- namespaces-tool [_]
  (fn [input]
    (.then (selfhost/namespaces)
      (fn [nses]
        (let [prefix (arg input "prefix")
              nses   (cond->> nses prefix (filter #(string/starts-with? % prefix)))]
          (result-text {:namespaces (vec nses) :count (count nses)}))))))

(defn- ns-schema [default-ns]
  {:type "string"
   :description (str "The namespace, default " (or default-ns "the REPL's current one") ".")})

(defn- tools
  "The tools, as maps: :name (without the prefix), :description,
  :inputSchema, :annotations and :execute, a function of the input (a
  JavaScript object) returning a promise of the result."
  [{:keys [ns] :as opts}]
  [{:name        "eval"
    :description (str "Evaluates ClojureScript forms in this page, compiled by the self-hosted compiler running in it. "
                      "Returns the last form's value printed as EDN, the output printed (out, err), the compiler warnings, "
                      "and an error. A form with warnings isn't evaluated, unless warnings_ok, nor are the forms after a failed one. "
                      "def redefines a var as the page's code sees it. ns is the namespace after the forms. "
                      "Only the macros of cljs.core and #x (JSX) literals are available, and only the namespaces and npm modules the page has. "
                      "Values are printed with print_length 50 and print_level 8 unless given.")
    :inputSchema {:type       "object"
                  :properties {:code         {:type "string" :description "The forms to evaluate."}
                               :ns           (ns-schema ns)
                               :await        {:type "boolean" :description "Wait for a promise's value."}
                               :warnings_ok  {:type "boolean" :description "Evaluate forms with compiler warnings."}
                               :print_length {:type ["integer" "null"] :description "*print-length* of the values, null for none."}
                               :print_level  {:type ["integer" "null"] :description "*print-level* of the values, null for none."}}
                  :required   ["code"]}
    :execute     (eval-tool opts)}
   {:name        "doc"
    :description "A var's, macro's, special form's or namespace's documentation: its arglists and docstring, from the compiler state in this page."
    :inputSchema {:type       "object"
                  :properties {:symbol {:type "string" :description "The name, i.e. map, str/join, my.app/render."}
                               :ns     (ns-schema ns)}
                  :required   ["symbol"]}
    :annotations {:readOnlyHint true}
    :execute     (doc-tool opts)}
   {:name        "apropos"
    :description "The public vars and macros of the namespaces in this page whose name contains a string (case-insensitive)."
    :inputSchema {:type       "object"
                  :properties {:query {:type "string"}
                               :ns    {:type "string" :description "Only this namespace's vars."}}
                  :required   ["query"]}
    :annotations {:readOnlyHint true}
    :execute     (apropos-tool opts)}
   {:name        "ns_info"
    :description "A namespace in this page: its docstring, public vars and macros with their arglists, and the namespaces it requires."
    :inputSchema {:type       "object"
                  :properties {:ns {:type "string"}}
                  :required   ["ns"]}
    :annotations {:readOnlyHint true}
    :execute     (ns-info-tool opts)}
   {:name        "macroexpand"
    :description "Expands a ClojureScript form's macros in a namespace, with its aliases and refers: once (macroexpand-1), until the form's head isn't a macro (macroexpand), or all the forms in it (all)."
    :inputSchema {:type       "object"
                  :properties {:form {:type "string"}
                               :ns   (ns-schema ns)
                               :mode {:type "string" :enum ["macroexpand-1" "macroexpand" "all"] :description "Default macroexpand."}}
                  :required   ["form"]}
    :annotations {:readOnlyHint true}
    :execute     (macroexpand-tool opts)}
   {:name        "namespaces"
    :description "The ClojureScript namespaces in this page: the build's, and those defined by evaluated code."
    :inputSchema {:type       "object"
                  :properties {:prefix {:type "string" :description "Only the namespaces starting with it."}}}
    :annotations {:readOnlyHint true}
    :execute     (namespaces-tool opts)}])

(defn- js-tool
  "A tool map as WebMCP's tool dictionary, calling on-call (if any) with its
  name and input when an agent calls it. Its execute's errors are results
  (an :error), which the agent reads, rather than rejections."
  [{:keys [name description inputSchema annotations execute]} on-call]
  (cond-> #js {:name        name
               :description description
               :inputSchema (clj->js (or inputSchema {:type "object" :properties {}}))
               :execute     (fn [input _]
                              (-> (js/Promise.resolve nil)
                                  (.then #(when on-call (on-call name input)))
                                  (.then #(execute input))
                                  (.catch #(result-text {:error (str (or (ex-message %) %))}))))}
    annotations (doto (unchecked-set "annotations" (clj->js annotations)))))

(defn register!
  "Registers the self-hosted compiler's tools with WebMCP, named prefix
  (default cljs_) and eval, doc, apropos, ns_info, macroexpand and
  namespaces, and :tools, more tools as maps (see tools). Returns a function
  unregistering them, nil without WebMCP.

  opts:
  - :prefix - of the tools' names, default \"cljs_\"
  - :ns - the namespace tools default to, default the REPL's current one
  - :before-eval, :after-eval - called with the code eval evaluates, and
    with its eval-str result: i.e. to show the agent's forms in the page
  - :on-call - called with a tool's name and input when an agent calls it,
    any tool: i.e. to show agents' activity in the page
  - :tools - more tools, maps of :name (not prefixed), :description,
    :inputSchema, :annotations and :execute, a function of the input (a
    JavaScript object) returning a string or a promise of one"
  ([] (register! nil))
  ([{:keys [prefix] :or {prefix "cljs_"} :as opts}]
   (when-let [^js mc (model-context)]
     (let [controller (js/AbortController.)
           all        (concat (map #(update % :name (fn [n] (str prefix n))) (tools opts))
                              (:tools opts))
           names      (mapv :name all)]
       (doseq [t all]
         (let [r (.registerTool mc (js-tool t (:on-call opts)) #js {:signal (.-signal controller)})]
           ;; a promise in document.modelContext, i.e. rejected for a name
           ;; taken
           (when (and r (fn? (.-then r)))
             (.catch r #(js/console.warn "WebMCP: couldn't register" (:name t) %)))))
       (fn unregister []
         (.abort controller)
         ;; navigator.modelContext of earlier versions
         (when (fn? (.-unregisterTool mc))
           (doseq [n names]
             (try (.unregisterTool mc n) (catch :default _)))))))))
