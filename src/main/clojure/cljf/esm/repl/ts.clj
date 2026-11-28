(ns cljf.esm.repl.ts
  "Completions of JavaScript interop in the nREPL sessions of
  cljf.esm.repl.nrepl from the Vite plugin's TypeScript language service
  (its tsCompletions, cljf.esm.repl/ts-complete): the ClojureScript at the
  cursor is translated into a small TypeScript snippet completing the same
  JavaScript, as Svelte's and Vue's tooling complete their templates.

    js/document.getE           document.getE|
    (.. js/document -body -cl  document.body.cl|
    (.-ver js/process)         process.ver|
    react/useSt                import * as __cljf_m0 from \"react\"; __cljf_m0.useSt|

  where react is the alias of a string require, [\"react\" :as react], of
  the completion's namespace. Forms it can't translate (locals, ClojureScript
  fns) aren't completed here: the runtime's (clj-suitable) are."
  (:require [cljs.analyzer :as ana]
            [cljs.util :as util]
            [cljs.vendor.clojure.data.json :as json]
            [cljs.vendor.clojure.tools.reader :as reader]
            [clojure.java.io :as io]
            [clojure.string :as string])
  (:import [java.net URL]))

(def ^:private ident #"[A-Za-z_$][\w$]*")

(defn- js-path
  "s, i.e. a.b.c, unless one of its names isn't a JavaScript identifier."
  [s]
  (when (every? #(re-matches ident %) (string/split s #"\." -1))
    s))

(defn- lib-of
  "The JavaScript module (a string require) of alias a in the namespace."
  [{:keys [ns]} a]
  (let [lib (get-in ns [:requires a])]
    (when (string? lib) lib)))

(defn- module-expr
  "The snippet's expression of a string require's lib: an import of its
  module (relative to the namespace's source file for ./ and ../), and the
  property path after $ (\"react$default\")."
  [{:keys [imports file]} lib]
  (let [[module path] (string/split lib #"\$" 2)
        module (if (string/starts-with? module ".")
                 (when file (.getCanonicalPath (io/file (.getParentFile (io/file file)) module)))
                 module)]
    (when (and module (or (nil? path) (js-path path)))
      (let [i (or (first (keep-indexed #(when (= module %2) %1) @imports))
                  (dec (count (vswap! imports conj module))))]
        (cond-> (str "__cljf_m" i) path (str "." path))))))

(defn- sym->ts
  "The snippet's expression of symbol sym, nil unless it's JavaScript: js/a.b,
  alias/a.b and alias of a string require, or one of its :refer names."
  [ctx sym]
  (let [ns (namespace sym)
        n  (name sym)]
    (cond
      (= "js" ns) (js-path n)
      ns          (when-let [m (some->> (lib-of ctx (symbol ns)) (module-expr ctx))]
                    (some->> (js-path n) (str m ".")))
      :else       (if-let [lib (lib-of ctx sym)]
                    (module-expr ctx lib)
                    (let [lib (get-in ctx [:ns :uses sym])]
                      (when (and (string? lib) (re-matches ident n))
                        (some-> (module-expr ctx lib) (str "." n))))))))

(declare form->ts)

(defn- args->ts
  "Arguments as TypeScript: those it can't translate are any. Literal ones
  pick overloads, as createElement's tag name."
  [ctx args]
  (string/join ", " (map #(or (form->ts ctx %) "(undefined as any)") args)))

(defn- chain
  "The expression of (.. obj & steps), nil if a step isn't interop."
  [ctx obj steps]
  (reduce (fn [o step]
            (let [[s args] (if (seq? step) [(first step) (rest step)] [step nil])
                  n        (when (symbol? s) (name s))]
              (cond
                (nil? n)                                              (reduced nil)
                (and (string/starts-with? n "-") (re-matches ident (subs n 1)) (nil? args))
                (str o "." (subs n 1))
                (re-matches ident n)                                  (str o "." n "(" (args->ts ctx args) ")")
                :else                                                 (reduced nil))))
    obj steps))

(defn- call->ts [ctx [head & args]]
  (when (symbol? head)
    (let [ns (namespace head)
          n  (name head)]
      (cond
        (and (nil? ns) (= ".." n) (seq args))
        (some-> (form->ts ctx (first args)) (#(chain ctx % (rest args))))

        (and (nil? ns) (string/starts-with? n ".-") (= 1 (count args)))
        (when-let [o (form->ts ctx (first args))]
          (some->> (js-path (subs n 2)) (str o ".")))

        (and (nil? ns) (string/starts-with? n ".") (re-matches ident (subs n 1)) (seq args))
        (some-> (form->ts ctx (first args)) (str "." (subs n 1) "(" (args->ts ctx (rest args)) ")"))

        (and (= 'new head) (seq args))
        (some-> (form->ts ctx (first args)) (#(str "new " % "(" (args->ts ctx (rest args)) ")")))

        (and (string/ends-with? n ".") (< 1 (count n)))
        (some-> (sym->ts ctx (symbol ns (subs n 0 (dec (count n)))))
          (#(str "new " % "(" (args->ts ctx args) ")")))

        :else
        (some-> (sym->ts ctx head) (str "(" (args->ts ctx args) ")"))))))

(defn- form->ts
  "The snippet's expression of form, nil unless it's interop TypeScript can
  type: JavaScript names, interop calls and literals."
  [ctx form]
  (cond
    (symbol? form)  (sym->ts ctx form)
    (string? form)  (json/write-str form)
    (number? form)  (str "(" form ")")
    (boolean? form) (str form)
    (nil? form)     "null"
    (seq? form)     (call->ts ctx form)))

(defn- read-context
  "cider's completion context, the top-level form at the cursor with
  __prefix__ in place of its symbol, nil if it can't be read."
  [context ns]
  (when (and (string? context) (string/includes? context "__prefix__"))
    (try
      ;; the editor's buffer: no #= or #Class[], which run code
      (binding [reader/*read-eval*              false
                reader/*default-data-reader-fn* (fn [_ v] v)
                ;; ::alias/k of any alias (:as-alias, :require-macros):
                ;; keywords don't matter to the snippet
                reader/*alias-map*              (fn [sym] sym)]
        (reader/read-string {:read-cond :allow :features #{:cljs} :eof nil} context))
      (catch Exception _ nil))))

(defn- prefix-list
  "The list holding __prefix__ in form."
  [form]
  (first (filter #(and (seq? %) (some #{'__prefix__} %)) (tree-seq coll? seq form))))

(defn- source-file
  "The path of namespace ns' source file, nil unless it's a file."
  [ns]
  (let [^URL url (util/ns->source ns)]
    (when (= "file" (some-> url .getProtocol))
      (.getPath (io/file (.toURI url))))))

(defn snippet
  "The TypeScript snippet completing what a complete message's prefix (and
  context) completes in namespace ns-name of compiler environment env:
  {:code :position :filter :candidate-prefix}, the language service's names
  starting with filter are candidates after candidate-prefix. nil when it
  isn't JavaScript interop."
  [{:keys [prefix context]} ns-name env]
  (let [ns      (get-in env [::ana/namespaces ns-name])
        ctx     {:ns ns :file (source-file ns-name) :imports (volatile! [])}
        member? #(re-matches #"[\w$]*" %)
        [obj member candidate-prefix]
        (cond
          ;; js/a.b.c, alias/a.b.c
          (and (string? prefix) (pos? (or (string/index-of prefix "/") -1)))
          (let [[q n] (string/split prefix #"/" 2)
                dot   (string/last-index-of n ".")]
            (cond
              dot         (when-let [o (sym->ts ctx (symbol q (subs n 0 dot)))]
                            [o (subs n (inc dot)) (str q "/" (subs n 0 (inc dot)))])
              (= "js" q)  [nil n "js/"]
              :else       (when-let [o (some->> (lib-of ctx (symbol q)) (module-expr ctx))]
                            [o n (str q "/")])))

          (string? prefix)
          (when-let [[head & args :as l] (prefix-list (read-context context ns))]
            (cond
              ;; (.-ver js/process), (.getE js/document)
              (and (= '__prefix__ head) (string/starts-with? prefix ".") (seq args))
              (let [dots (if (string/starts-with? prefix ".-") ".-" ".")]
                (some-> (form->ts ctx (first args)) (vector (subs prefix (count dots)) dots)))

              ;; (.. js/document -body -cl)
              (and (= '.. head) (< 1 (.indexOf ^java.util.List l '__prefix__)))
              (let [i     (.indexOf ^java.util.List l '__prefix__)
                    dash  (if (string/starts-with? prefix "-") "-" "")
                    steps (take (- i 2) (rest args))]
                (some-> (form->ts ctx (first args)) (#(chain ctx % steps))
                  (vector (subs prefix (count dash)) dash))))))]
    (when (and member (member? member) (or obj (= "js/" candidate-prefix)))
      (let [imports (string/join (map-indexed #(str "import * as __cljf_m" %1 " from " (json/write-str %2 :escape-slash false) ";\n")
                                   @(:imports ctx)))
            code    (str imports (if obj (str obj "." member) member))]
        {:code             code
         :position         (count code)
         :filter           member
         :candidate-prefix candidate-prefix}))))
