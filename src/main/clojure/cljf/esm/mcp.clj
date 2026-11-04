;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

(ns cljf.esm.mcp
  "An MCP server for cljf.esm.repl: the watcher's REPL as tools of the
  Model Context Protocol, for coding agents. Under :repl {:mcp-port 0} the
  watcher serves it (MCP's Streamable HTTP, JSON responses) on
  127.0.0.1:<port>/mcp, with the JDK's HTTP server, its port in
  .cljf/mcp-port, which `cljf mcp` (a stdio bridge) reads.

  Tools evaluate ClojureScript in a runtime (eval, load_file), wait for
  edits to be compiled and hot reloaded (wait_for_reload), report the
  build's status and look up the build's namespaces and vars. Every tool of
  a runtime takes its runtime_id, an id of (runtimes) or a tag: agents
  can't see which page the user focused. call is the tools' entry point,
  tools their definitions."
  (:require [cljs.analyzer :as ana]
            [cljs.analyzer.api :as ana-api]
            [cljs.env :as env]
            [cljf.esm.repl :as repl]
            [cljs.repl]
            [cljs.util :as util]
            [cljs.vendor.clojure.data.json :as json]
            [clojure.java.io :as io]
            [clojure.pprint :as pp]
            [clojure.string :as string]
            [clojure.walk :as walk]
            [cljs.vendor.clojure.tools.reader :as reader])
  (:import [com.sun.net.httpserver HttpExchange HttpHandler HttpServer]
           [java.io File]
           [java.net InetAddress InetSocketAddress URI URL]
           [java.nio.charset StandardCharsets]
           [java.time Instant]
           [java.util.concurrent Executors ThreadFactory]))

;; Tools

(def ^:private runtime-id-schema
  {:type        ["integer" "string"]
   :description "The runtime: an id of the runtimes tool, or a tag (tag_runtime)."})

(def tools
  "The tools' definitions, as tools/list lists them. The cljf launcher's
  stdio bridge has a copy (src/main/js/cljf/mcp-tools.json, written by
  script/gen-mcp-tools), which it lists before the dev server is up."
  [{:name        "runtimes"
    :title       "Runtimes"
    :description "Lists the JavaScript runtimes running the build: browser tabs, the dev server's server (ssr) and its worker threads, and the threads of a bundle (vite build --watch). Every runtime tool takes one's runtime_id. A browser tab keeps its id when reloaded, other runtimes get a new one when they restart. focused marks the tab the user focused last."
    :inputSchema {:type "object" :properties {}}
    :annotations {:readOnlyHint true}}
   {:name        "build_status"
    :title       "Build status"
    :description "The build's status: whether it compiles, the last compile (its error with a source excerpt, or the namespaces compiled), the warnings holding back hot reloads, the dev server's URLs and the runtimes."
    :inputSchema {:type "object" :properties {}}
    :annotations {:readOnlyHint true}}
   {:name        "eval"
    :title       "Evaluate ClojureScript"
    :description "Evaluates ClojureScript forms in a runtime, compiled with the build's compiler environment. Returns each form's value printed as EDN, the output printed (out, err), the compiler warnings and an error with its stack mapped to the sources. A form with warnings isn't evaluated, unless warnings_ok, nor are the forms after a failed one. def redefines a var for the namespace's code, as a hot reload does; in-ns changes the namespace of the forms after it only. The result's ns is the namespace after the forms: *ns* is nil at runtime, as in all ClojureScript (the namespace is the compiler's), and (namespace ::x) is the form's namespace. Values are printed with print_length 50 and print_level 8 unless given."
    :inputSchema {:type       "object"
                  :properties {:code         {:type "string" :description "The forms to evaluate."}
                               :runtime_id   runtime-id-schema
                               :ns           {:type "string" :description "The namespace to evaluate in, default cljs.user."}
                               :await        {:type "boolean" :description "Wait for a promise's value."}
                               :timeout_ms   {:type "integer" :description "Give up waiting for the runtime after these ms, default 30000."}
                               :warnings_ok  {:type "boolean" :description "Evaluate forms with compiler warnings."}
                               :print_length {:type ["integer" "null"] :description "*print-length* of the values, null for none."}
                               :print_level  {:type ["integer" "null"] :description "*print-level* of the values, null for none."}}
                  :required   ["code" "runtime_id"]}}
   {:name        "load_file"
    :title       "Load file"
    :description "Loads a ClojureScript file into a runtime: the watcher compiles it and the tool returns once the runtime applied its hot reload (or with the warnings holding it back). A file outside the source directories is evaluated form by form."
    :inputSchema {:type       "object"
                  :properties {:path       {:type "string" :description "The file, relative to the project's directory."}
                               :runtime_id runtime-id-schema}
                  :required   ["path" "runtime_id"]}}
   {:name        "wait_for_reload"
    :title       "Wait for hot reload"
    :description "After editing source files: compiles them unless the watcher did already, then waits until the runtime runs the build's last compile, i.e. applied the hot reloads. Returns reloaded, error (the build failed: the error and where), warnings (they hold back hot reloads), timeout or no-runtime."
    :inputSchema {:type       "object"
                  :properties {:runtime_id runtime-id-schema
                               :files      {:type "array" :items {:type "string"}
                                            :description "The files edited, relative to the project's directory."}
                               :timeout_ms {:type "integer" :description "Give up after these ms, default 10000."}}
                  :required   ["runtime_id"]}}
   {:name        "tag_runtime"
    :title       "Tag runtime"
    :description "Tags a runtime, taking the tag from any other: tools take the tag as runtime_id. A browser tab keeps its tag when reloaded. A null tag removes the runtime's."
    :inputSchema {:type       "object"
                  :properties {:runtime_id runtime-id-schema
                               :tag        {:type ["string" "null"]}}
                  :required   ["runtime_id" "tag"]}}
   {:name        "namespaces"
    :title       "Namespaces"
    :description "The build's namespaces and their source files."
    :inputSchema {:type       "object"
                  :properties {:prefix {:type "string" :description "Only the namespaces starting with it."}}}
    :annotations {:readOnlyHint true}}
   {:name        "doc"
    :title       "Documentation"
    :description "A var's, macro's, special form's or namespace's documentation: its arglists, docstring and where it's defined, from the build's compiler environment."
    :inputSchema {:type       "object"
                  :properties {:symbol {:type "string" :description "The name, i.e. map, str/join, my.app/render."}
                               :ns     {:type "string" :description "The namespace resolving it (its aliases and refers), default cljs.user."}}
                  :required   ["symbol"]}
    :annotations {:readOnlyHint true}}
   {:name        "source"
    :title       "Source"
    :description "The source of a var or macro, read from its file."
    :inputSchema {:type       "object"
                  :properties {:symbol {:type "string"}
                               :ns     {:type "string" :description "The namespace resolving it, default cljs.user."}}
                  :required   ["symbol"]}
    :annotations {:readOnlyHint true}}
   {:name        "console_logs"
    :title       "Console logs"
    :description "The runtime's console output: its console.* calls, uncaught errors and unhandled rejections (the last 500), oldest first, their stacks mapped to the sources. Pass the last result's cursor as since to get only what's new: all of the entries when the page reloaded since."
    :inputSchema {:type       "object"
                  :properties {:runtime_id runtime-id-schema
                               :since      {:type "string" :description "Only the entries after this cursor, a previous call's."}
                               :levels     {:type "array" :items {:type "string" :enum ["log" "info" "warn" "error" "debug"]}
                                            :description "Only these levels, all by default."}
                               :limit      {:type "integer" :description "At most these of the last entries, default 100."}}
                  :required   ["runtime_id"]}
    :annotations {:readOnlyHint true}}
   {:name        "vite_errors"
    :title       "Vite errors"
    :description "The Vite dev server's own errors, not the ClojureScript compiler's (see build_status): the error its overlay shows, i.e. of a TypeScript, CSS or HTML transform, until an update replaces it, and the last ones it logged, i.e. of the server's ssr environment."
    :inputSchema {:type       "object"
                  :properties {:since {:type "string" :description "Only the errors after this time (ISO 8601), i.e. a previous call's."}}}
    :annotations {:readOnlyHint true}}
   {:name        "ns_info"
    :title       "Namespace info"
    :description "A namespace of the build: its file, docstring, public vars and macros with their arglists, the namespaces it requires, and its dependents (the namespaces requiring it, which recompile when its API changes)."
    :inputSchema {:type       "object"
                  :properties {:ns {:type "string"}}
                  :required   ["ns"]}
    :annotations {:readOnlyHint true}}
   {:name        "macroexpand"
    :title       "Macroexpand"
    :description "Expands a ClojureScript form's macros in a namespace of the build, with its aliases and refers: once (macroexpand-1), until the form's head isn't a macro (macroexpand), or all the forms in it (all)."
    :inputSchema {:type       "object"
                  :properties {:form {:type "string"}
                               :ns   {:type "string" :description "The namespace expanding it, default cljs.user."}
                               :mode {:type "string" :enum ["macroexpand-1" "macroexpand" "all"]
                                      :description "Default macroexpand."}}
                  :required   ["form"]}
    :annotations {:readOnlyHint true}}
   {:name        "apropos"
    :title       "Apropos"
    :description "The public vars of the build's namespaces whose name contains a string (case-insensitive)."
    :inputSchema {:type       "object"
                  :properties {:query {:type "string"}
                               :ns    {:type "string" :description "Only this namespace's vars."}}
                  :required   ["query"]}
    :annotations {:readOnlyHint true}}])

(def ^:private max-text
  ;; characters of a value or output, then truncated
  20000)

(defn- truncate [s]
  (when s
    (if (< max-text (count s))
      (str (subs s 0 max-text) "… (truncated, " (count s) " characters)")
      s)))

(defn- tool-error
  "A tool's result reporting an error: message, and data for
  structuredContent."
  ([message] (tool-error message nil))
  ([message data]
   {:content           [{:type "text" :text message}]
    :structuredContent (merge {:error message} data)
    :isError           true}))

(defn- iso [ms]
  (when ms (str (Instant/ofEpochMilli ms))))

(defn- runtime-info
  "A runtime of repl/runtimes for agents."
  [{:keys [runtime-id kind url title visible tag hmr connected-at user-agent]} focused-id]
  (cond-> {:runtime_id runtime-id
           :kind       (or kind (if (some-> url (string/starts-with? "http")) "browser" "server"))
           :url        url
           :title      title
           :visible    (boolean visible)
           :focused    (= runtime-id focused-id)
           :tag        tag
           :hmr        (not (false? hmr))}
    connected-at (assoc :connected_at (iso connected-at))
    user-agent   (assoc :user_agent user-agent)))

(defn- current-runtimes []
  (let [rs      (repl/runtimes)
        focused (:runtime-id (last (sort-by :focused-at (filter :focused-at rs))))]
    (mapv #(runtime-info % focused) rs)))

(defn- runtime-line
  "A runtime, on one line."
  [{:keys [runtime_id kind title url focused tag hmr]}]
  (str runtime_id " " kind
    (when title (str " " (pr-str title)))
    (when (and url (not (string/starts-with? url "node://"))) (str " " url))
    (when tag (str " tagged " (pr-str tag)))
    (when focused " (focused)")
    (when-not hmr " (bundle: doesn't hot reload)")))

(defn- runtimes-text [rs]
  (if (seq rs)
    (string/join "\n" (map #(str "- " (runtime-line %)) rs))
    (str "No runtime connected"
      (when-let [url (first (:urls (repl/dev-server)))]
        (str ": open " url " in a browser")))))

(defn- seconds-ago [ms]
  (let [s (quot (- (System/currentTimeMillis) ms) 1000)]
    (str s "s ago")))

(defn- runtime-arg
  "The runtime of a tool's runtime_id argument, {:runtime-id id} (or
  {:tag tag}) with its info, or a tool error: an unknown or disconnected
  one's lists the runtimes connected. A string of digits is an id."
  [id]
  (let [rs  (current-runtimes)
        id  (if (and (string? id) (re-matches #"\d+" id)) (Long/parseLong id) id)
        hit (cond
              (number? id) (first (filter #(= (long id) (:runtime_id %)) rs))
              (string? id) (first (filter #(= id (:tag %)) rs)))
        connected (str "Connected:\n" (runtimes-text rs))]
    (cond
      hit
      {:opts {:runtime-id (:runtime_id hit)} :runtime hit}

      (nil? id)
      (tool-error (str "runtime_id is required: an id or a tag of the runtimes tool.\n" connected)
        {:runtimes rs})

      :else
      (let [gone (when (number? id) (repl/departed (long id)))]
        (tool-error
          (str (cond
                 gone
                 (str "Runtime " id " disconnected " (seconds-ago (:at gone))
                   (when (:url gone) (str " (" (:url gone) ")"))
                   (when (= "browser" (or (:kind gone) "browser")) ", the page may be reloading"))
                 (string? id) (str "No runtime tagged " (pr-str id))
                 :else        (str "No runtime " id))
            ".\n" connected)
          {:runtimes rs})))))

(defn- relative
  "path relative to the project's directory, if it's in it."
  [path]
  (when path
    (let [f    (io/file path)
          root (str (.getCanonicalPath (io/file ".")) File/separator)
          p    (try (.getCanonicalPath f) (catch Exception _ (str path)))]
      (if (string/starts-with? p root) (subs p (count root)) (str path)))))

(defn- warning-line [{:keys [message file line column]}]
  (str "WARNING: " message
    (when file (str " at " (relative file) (when line (str ":" line (when column (str ":" column))))))))

(defn- warning-info [{:keys [message file line column]}]
  {:message message :file (relative file) :line line :column column})

(defn- excerpt
  "The lines of file around line, the line marked."
  [file line]
  (when (and file line)
    (let [f (io/file file)]
      (when (.isFile f)
        (let [lines (vec (string/split-lines (slurp f)))
              from  (max 1 (- line 3))
              to    (min (count lines) (+ line 3))
              width (count (str to))]
          (string/join "\n"
            (for [n (range from (inc to))]
              (str (if (= n line) "> " "  ")
                (format (str "%" width "d") n) " | " (get lines (dec n))))))))))

(defn- build-namespaces-count []
  (count (:cljf.esm/namespaces (repl/compiler-env-snapshot))))

(defn- error-info
  "A compile error for agents, with an excerpt of its source."
  [{:keys [message file line column at]}]
  (cond-> {:message message
           :file    (relative file)
           :line    line
           :column  column
           :at      (iso at)}
    (excerpt file line) (assoc :excerpt (excerpt file line))))

(defn- build-info
  "The build's status for agents, {:building true} until the watcher's
  first build is done."
  []
  (if-not (repl/built?)
    {:building true :compiling true :runtimes [] :warnings []
     :hot_reload "not yet: the first build is compiling"}
    (let [{:keys [compiling last errors outstanding ignore-warnings]} (repl/build-status)
          error (first errors)
          {:keys [urls config]} (repl/dev-server)]
      (cond-> {:compiling  compiling
               :namespaces (build-namespaces-count)
               :warnings   (mapv warning-info outstanding)
               :hot_reload (cond
                             error                 "paused: the build failed"
                             (and (seq outstanding) (not ignore-warnings))
                             (str "paused by " (count outstanding) " warning(s)")
                             :else                 "on")
               :runtimes   (current-runtimes)}
        (seq urls) (assoc :dev_server urls)
        config     (assoc :config config)
        error      (assoc :error (error-info error)
                     ;; most recent first, each until its file compiles
                     :errors (mapv error-info errors))
        last       (assoc :last_compile
                     (if (= "error" (:type last))
                       {:result "error" :at (iso (:at last))}
                       {:result     "compiled"
                        :namespaces (:namespaces last)
                        :compiled   (mapv str (:compiled last))
                        :ms         (:ms last)
                        :at         (iso (:at last))}))))))

(defn- build-summary
  "The build's status, in a few lines."
  [{:keys [building compiling namespaces warnings hot_reload last_compile error errors]}]
  (if building
    "Build: the first build is compiling (a cold one can take a minute or more), the tools answer once it's done."
    (string/join "\n"
      (concat
        [(str "Build: " namespaces " namespaces"
           (when compiling ", compiling now")
           (when (= "compiled" (:result last_compile))
             (str ". The last compile compiled " (:namespaces last_compile) " namespace(s) in "
               (:ms last_compile) "ms"))
           (when error
             (str ". The build failed: " (:message error)
               (when (:file error)
                 (str " at " (:file error) (when (:line error) (str ":" (:line error)))))
               (when (= "compiled" (:result last_compile))
                 " (still: a later compile of other sources doesn't fix it)")
               (when (< 1 (count errors))
                 (str ", and " (dec (count errors)) " more error(s)"))))
           ". Hot reload: " hot_reload ".")]
        (when-let [e (:excerpt error)] [e])
        (for [{:keys [message file line]} (rest errors)]
          (str "Also failed: " message (when file (str " at " file (when line (str ":" line))))))
        (map warning-line warnings)))))

(defn- text-result [text data]
  {:content [{:type "text" :text text}] :structuredContent data})

;; The tools' implementations, (fn [args]) of the arguments (string keys)

(defn- arg-ns [args]
  (if-let [ns (get args "ns")] (symbol ns) 'cljs.user))

(defn- with-runtime
  "Calls f with the runtime of args' runtime_id, see runtime-arg."
  [args f]
  (let [r (runtime-arg (get args "runtime_id"))]
    (if (:isError r) r (f r))))

(defn- runtime-head [runtime]
  (str "runtime " (runtime-line runtime)))

(defn- eval-tool [args]
  (with-runtime args
    (fn [{:keys [opts runtime]}]
      (let [plen  (if (contains? args "print_length") (get args "print_length") 50)
            plev  (if (contains? args "print_level") (get args "print_level") 8)
            r     (repl/cljs-eval (or (get args "code") "")
                    (merge opts
                      {:ns           (arg-ns args)
                       :await        (boolean (get args "await"))
                       :timeout      (get args "timeout_ms" 30000)
                       :warnings-ok  (boolean (get args "warnings_ok"))
                       :print-length plen
                       :print-level  plev}))
            {:keys [results out err warnings error stack ex-data ns]} r
            values (mapv #(when-not (= ::repl/failed %) (truncate %)) results)
            data   (cond-> {:runtime  runtime
                            :ns       (str ns)
                            :results  values
                            :out      (truncate out)
                            :err      (truncate err)
                            :warnings (mapv warning-info warnings)}
                     error   (assoc :error error)
                     stack   (assoc :stack (truncate stack))
                     ex-data (assoc :ex_data ex-data))
            text   (string/join "\n"
                     (concat
                       [(str ";; " (runtime-head runtime) ", ns " ns)]
                       (when (seq out) [(str ";; out:\n" (truncate out))])
                       (when (seq err) [(str ";; err:\n" (truncate err))])
                       (map warning-line warnings)
                       (for [[v r] (map vector values results)]
                         (if (= ::repl/failed r) ";; failed" (str "=> " v)))
                       (when error
                         [(str "Error: " error
                            (when ex-data (str "\nex-data: " ex-data))
                            (when (and stack (not= stack error)) (str "\n" (truncate stack))))])))]
        (cond-> (text-result text data)
          error (assoc :isError true))))))

(defn- load-file-tool [args]
  (with-runtime args
    (fn [{:keys [opts runtime]}]
      (let [path (get args "path")]
        (if-not (and path (.isFile (io/file path)))
          (tool-error (str "No file " (pr-str path) " (paths are relative to " (.getCanonicalPath (io/file ".")) ")"))
          (let [{:keys [warnings error err out stack]} (repl/load-file path opts)
                data (cond-> {:runtime  runtime
                              :path     (relative path)
                              :warnings (mapv warning-info warnings)}
                       (seq out) (assoc :out (truncate out))
                       (seq err) (assoc :err (truncate err))
                       error     (assoc :error error)
                       stack     (assoc :stack (truncate stack)))
                text (string/join "\n"
                       (concat
                         [(str (if error "Failed to load " "Loaded ") (relative path) " in " (runtime-head runtime))]
                         (map warning-line warnings)
                         (when (seq out) [(truncate out)])
                         (when (seq err) [(truncate err)])
                         (when error [(str "Error: " error (when stack (str "\n" (truncate stack))))])))]
            (cond-> (text-result text data)
              error (assoc :isError true))))))))

(defn- wait-for-reload-tool [args]
  (with-runtime args
    (fn [{:keys [opts runtime]}]
      (let [files (get args "files")
            missing (remove #(.isFile (io/file %)) files)]
        (if (seq missing)
          (tool-error (str "No file " (string/join ", " (map pr-str missing))
                        " (paths are relative to " (.getCanonicalPath (io/file ".")) ")"))
          (let [{:keys [status runtimes error errors warnings compiled skipped]}
                (repl/wait-for-reload files (assoc opts :timeout (get args "timeout_ms" 10000)))
                rstatus (get runtimes (:runtime_id runtime))
                data    (cond-> {:status status :runtime runtime}
                          (seq compiled) (assoc :compiled (mapv str compiled))
                          (seq skipped)  (assoc :skipped (mapv relative skipped))
                          error          (assoc :error (update error :file relative)
                                           :excerpt (excerpt (:file error) (:line error)))
                          (< 1 (count errors)) (assoc :errors (mapv #(update % :file relative) errors))
                          (seq warnings) (assoc :warnings (mapv warning-info warnings)))
                text    (case status
                          "reloaded" (str "Reloaded: " (runtime-head runtime)
                                       (if (= "bundle" rstatus)
                                         " runs a bundle, which doesn't hot reload: it applies once rebundled and restarted"
                                         " runs the last compile")
                                       (when (seq compiled) (str ". Compiled " (string/join ", " compiled))))
                          "error"    (if error
                                       (str "The build failed: " (:message error)
                                         (when (:file error)
                                           (str " at " (relative (:file error))
                                             (when (:line error) (str ":" (:line error)))))
                                         (some->> (excerpt (:file error) (:line error)) (str "\n"))
                                         (apply str
                                           (for [{:keys [message file line]} (rest errors)]
                                             (str "\nAlso failed: " message
                                               (when file (str " at " (relative file) (when line (str ":" line))))))))
                                       (str "Error: " rstatus))
                          "warnings" (string/join "\n"
                                       (cons (str "Hot reload is paused by " (count warnings) " warning(s):")
                                         (map warning-line warnings)))
                          "timeout"  (str "The hot reload didn't apply in " (runtime-head runtime) " in time")
                          (str status))
                text    (cond-> text
                          (seq skipped) (str "\nNot compiled (Vite reloads them): "
                                          (string/join ", " (map relative skipped))))]
            (cond-> (text-result text data)
              (not= "reloaded" status) (assoc :isError true))))))))

(defn- tag-runtime-tool [args]
  (with-runtime args
    (fn [{:keys [opts runtime]}]
      (let [tag   (get args "tag")
            acked (repl/tag! (:runtime-id opts) tag)]
        ;; the runtime acknowledges the tag with its printed value, nil
        ;; when it didn't reply (disconnected, timed out)
        (if (= (pr-str tag) acked)
          (text-result (str (if tag (str "Tagged " (pr-str tag) ": ") "Untagged: ") "runtime " (:runtime_id runtime))
            {:runtime (assoc runtime :tag tag)})
          (tool-error (str "Runtime " (:runtime_id runtime) " didn't acknowledge the tag: it may have disconnected or be busy, see runtimes")
            {:runtime runtime}))))))

(defn- runtimes-tool [_]
  (let [rs (current-runtimes)
        urls (:urls (repl/dev-server))]
    (text-result (runtimes-text rs)
      (cond-> {:runtimes rs}
        (seq urls) (assoc :dev_server urls)))))

(defn- build-status-tool [_]
  (let [info (build-info)]
    (if (:building info)
      (text-result (build-summary info) info)
      (text-result (str (build-summary info)
                     (when-let [urls (:dev_server info)] (str "\nDev server: " (string/join " " urls)))
                     "\nRuntimes:\n" (runtimes-text (:runtimes info)))
        info))))

(defn- source-file
  "The file of namespace ns' source, relative to the project if it's in it,
  else its classpath URL."
  [ns]
  (when-let [^URL url (util/ns->source ns)]
    (if (= "file" (.getProtocol url))
      (relative (.getPath (io/file (.toURI url))))
      (str url))))

(defn- namespaces-tool [args]
  (let [prefix (get args "prefix")
        nses   (->> (:cljf.esm/namespaces (repl/compiler-env-snapshot))
                    (map str)
                    (filter #(or (nil? prefix) (string/starts-with? % prefix)))
                    sort)
        shown  (take 500 nses)
        items  (mapv (fn [ns] {:ns ns :file (source-file (symbol ns))}) shown)]
    (text-result (str (string/join "\n" (map #(str (:ns %) (when (:file %) (str " " (:file %)))) items))
                   (when (< (count shown) (count nses))
                     (str "\n… and " (- (count nses) (count shown)) " more, give a prefix")))
      {:namespaces items :count (count nses)})))

(defn- with-snapshot
  "Calls f with a copy of the build's compiler environment no compile is
  changing (resolving may analyze)."
  [f]
  (env/with-compiler-env (atom (repl/compiler-env-snapshot))
    (binding [ana/*cljs-warnings* (zipmap (keys ana/*cljs-warnings*) (repeat false))]
      (f))))

(defn- env-of [ns]
  (assoc (ana/empty-env) :ns (or (ana/get-namespace ns) {:name ns})))

(defn- arglists [v]
  (let [a (:arglists v)]
    (if (and (seq? a) (= 'quote (first a))) (second a) a)))

(defn- doc-tool [args]
  (let [sym (symbol (get args "symbol" ""))
        ns  (arg-ns args)
        m   (with-snapshot
              (fn []
                (cond
                  (cljs.repl/special-doc-map sym)
                  (assoc (cljs.repl/special-doc-map sym) :name sym :special-form true)

                  (and (nil? (namespace sym)) (ana-api/find-ns sym))
                  (assoc (select-keys (ana-api/find-ns sym) [:doc]) :name sym :namespace true)

                  :else
                  (try
                    (when-let [v (ana/no-warn (ana-api/resolve (env-of ns) sym))]
                      (when (or (:ns v) (:macro v) (:doc v) (:arglists v))
                        v))
                    (catch Exception _ nil)))))]
    (if-not m
      (tool-error (str "No var, macro or namespace " sym " in " ns))
      (let [qualified (cond
                        (:special-form m) (str sym)
                        (:namespace m)    (str sym)
                        :else (str (:ns m) "/" (name (:name m))))
            data (cond-> {:name qualified
                          :kind (cond (:special-form m) "special form"
                                      (:namespace m)    "namespace"
                                      (:macro m)        "macro"
                                      :else             "var")}
                   (arglists m)    (assoc :arglists (mapv pr-str (arglists m)))
                   (:forms m)      (assoc :arglists (mapv pr-str (:forms m)))
                   (:doc m)        (assoc :doc (:doc m))
                   (:file m)       (assoc :file (relative (:file m)))
                   (:line m)       (assoc :line (:line m)))]
        (text-result (string/join "\n"
                       (remove nil?
                         [(str qualified (when-not (= "var" (:kind data)) (str " (" (:kind data) ")")))
                          (some->> (:arglists data) (string/join " "))
                          (:doc data)
                          (when (:file data) (str (:file data) (when (:line data) (str ":" (:line data)))))]))
          data)))))

(defn- source-tool [args]
  (let [sym (symbol (get args "symbol" ""))
        ns  (arg-ns args)
        src (with-snapshot
              (fn []
                (try
                  (cljs.repl/source-fn (env-of ns) sym)
                  (catch Exception _ nil))))]
    (if src
      (text-result (truncate src) {:symbol (str sym) :source (truncate src)})
      (tool-error (str "No source of " sym " found in " ns)))))

(defn- apropos-tool [args]
  (let [q       (string/lower-case (get args "query" ""))
        only    (some-> (get args "ns") symbol)
        matches (with-snapshot
                  (fn []
                    (sort
                      (for [ns    (if only [only] (ana-api/all-ns))
                            :when (ana-api/find-ns ns)
                            [sym v] (ana-api/ns-publics ns)
                            :when (and (not (:anonymous v))
                                       (string/includes? (string/lower-case (str sym)) q))]
                        (str ns "/" sym)))))
        shown   (take 200 matches)]
    (text-result (str (if (seq shown) (string/join "\n" shown) "No matches")
                   (when (< (count shown) (count matches))
                     (str "\n… and " (- (count matches) (count shown)) " more")))
      {:matches (vec shown) :count (count matches)})))

(defn- console-logs-tool [args]
  (with-runtime args
    (fn [{:keys [opts runtime]}]
      (let [[_ since-epoch since] (some->> (get args "since") str (re-matches #"(.*):(\d+)"))
            {:keys [entries dropped last epoch reloaded error]}
            (repl/logs (:runtime-id opts) {:epoch  since-epoch
                                           :since  (some-> since Long/parseLong)
                                           :limit  (get args "limit" 100)
                                           :levels (get args "levels")})
            cursor (str epoch ":" last)]
        (if error
          (tool-error error)
          (let [entries (mapv (fn [{:keys [seq at level text stack]}]
                                (cond-> {:seq seq :at (iso at) :level level :text (truncate text)}
                                  (and stack (not (string/includes? (str text) stack)))
                                  (assoc :stack (truncate stack))))
                          entries)]
            (text-result
              (string/join "\n"
                (concat
                  [(str ";; " (runtime-head runtime) ", " (count entries) " entr" (if (= 1 (count entries)) "y" "ies")
                     (when reloaded ", all since the page reloaded")
                     (when (pos? (or dropped 0)) (str " (" dropped " earlier left out, see limit)"))
                     ", cursor " cursor)]
                  (for [{:keys [seq level text stack]} entries]
                    (str "[" seq " " level "] " text (when stack (str "\n" stack))))))
              {:runtime runtime :entries entries :dropped (or dropped 0) :cursor cursor
               :reloaded (boolean reloaded)})))))))

(defn- vite-errors-tool [args]
  (if-let [{:keys [overlay log]} (repl/vite-errors)]
    (let [since (some-> (get args "since") Instant/parse .toEpochMilli)
          info  (fn [{:keys [at file] :as e}]
                  (cond-> (-> (select-keys e [:message :line :column :plugin :frame :stack])
                              (update :message truncate)
                              (update :stack truncate)
                              (assoc :at (iso at)))
                    file (assoc :file (relative file))))
          keep? #(or (nil? since) (< since (:at %)))
          overlay (mapv info (filter keep? overlay))
          ;; Vite logs the overlay's error too (\"Internal server error: ...\")
          shown?  (fn [{:keys [message]}]
                    (some #(let [head (string/trim (or (first (string/split-lines (str (:message %)))) ""))]
                             (and (seq head) (string/includes? (str message) head)))
                      overlay))
          log     (mapv info (remove shown? (filter keep? log)))
          line    (fn [{:keys [message file line plugin frame]}]
                    (str (when plugin (str "[" plugin "] ")) message
                      (when (and file (not (string/includes? (str message) (str file))))
                        (str " at " file (when line (str ":" line))))
                      (when frame (str "\n" frame))))]
      (text-result
        (if (and (empty? overlay) (empty? log))
          "No errors"
          (string/join "\n"
            (concat
              (when (seq overlay) (cons "The overlay shows:" (map line overlay)))
              (when (seq log) (cons "Logged:" (map line log))))))
        {:overlay overlay :log log :now (iso (System/currentTimeMillis))}))
    (tool-error "No Vite dev server: the build runs without the Vite plugin's dev server (i.e. cljf watch, vite build --watch)")))

(defn- ns-info-tool [args]
  (let [ns (symbol (get args "ns" ""))
        m  (with-snapshot
             (fn []
               (when-let [a (ana-api/find-ns ns)]
                 (let [cenv     @env/*compiler*
                       publics  (sort-by key (remove (comp :anonymous val) (ana-api/ns-publics ns)))
                       requires (->> (concat (vals (:requires a)) (vals (:uses a)))
                                     (map str) distinct sort vec)
                       dependents (->> (vals (::ana/namespaces cenv))
                                       (filter (fn [{:keys [requires uses]}]
                                                 (some #{ns} (concat (vals requires) (vals uses)))))
                                       (map (comp str :name))
                                       (remove #{(str ns)})
                                       sort vec)]
                   {:ns         (str ns)
                    :file       (source-file ns)
                    :doc        (:doc a)
                    :in_build   (contains? (:cljf.esm/namespaces cenv) ns)
                    :publics    (mapv (fn [[sym v]]
                                        (cond-> {:name (str sym)}
                                          (:macro v)    (assoc :macro true)
                                          (arglists v)  (assoc :arglists (mapv pr-str (arglists v)))
                                          (:doc v)      (assoc :doc (first (string/split-lines (:doc v))))))
                                  publics)
                    :requires   requires
                    :dependents dependents}))))]
    (if-not m
      (tool-error (str "No namespace " ns " in the build, see namespaces"))
      (text-result
        (string/join "\n"
          (concat
            [(str (:ns m) (when (:file m) (str " " (:file m))))]
            (when (:doc m) [(:doc m)])
            [(str "Requires: " (if (seq (:requires m)) (string/join ", " (:requires m)) "nothing"))
             (str "Dependents: " (if (seq (:dependents m)) (string/join ", " (:dependents m)) "none"))
             "Publics:"]
            (for [{:keys [name macro arglists doc]} (:publics m)]
              (str "- " name (when macro " (macro)") (when arglists (str " " (string/join " " arglists)))
                (when doc (str ": " doc))))))
        m))))

(defn- macroexpand-tool [args]
  (let [ns   (arg-ns args)
        mode (get args "mode" "macroexpand")
        code (get args "form" "")]
    (try
      (let [expansion
            (with-snapshot
              (fn []
                (binding [ana/*cljs-ns*      ns
                          reader/*read-eval* false]
                  (let [form (first (ana/forms-seq* (java.io.StringReader. code) "<macroexpand>"))
                        env  (env-of ns)
                        expand-1 #(ana/macroexpand-1 env %)
                        expand   (fn [f] (loop [f f]
                                           (let [f' (expand-1 f)]
                                             (if (identical? f f') f (recur f')))))]
                    (case mode
                      "macroexpand-1" (expand-1 form)
                      "all"           (walk/prewalk #(if (seq? %) (expand %) %) form)
                      (expand form))))))
            text (binding [*print-namespace-maps* false]
                   (with-out-str (pp/pprint expansion)))]
        (text-result (truncate (string/trimr text)) {:expansion (truncate (string/trimr text)) :ns (str ns)}))
      (catch Exception e
        (tool-error (str "Could not expand: " (or (some #(.getMessage ^Throwable %) (take-while some? (iterate ex-cause e)))
                                                  (str (class e)))))))))

(def ^:private implementations
  {"runtimes"        runtimes-tool
   "build_status"    build-status-tool
   "eval"            eval-tool
   "load_file"       load-file-tool
   "wait_for_reload" wait-for-reload-tool
   "tag_runtime"     tag-runtime-tool
   "namespaces"      namespaces-tool
   "doc"             doc-tool
   "source"          source-tool
   "apropos"         apropos-tool
   "console_logs"    console-logs-tool
   "ns_info"         ns-info-tool
   "vite_errors"     vite-errors-tool
   "macroexpand"     macroexpand-tool})

(defn call
  "Calls tool name with args (a map of string keys), returns its result as
  MCP's tools/call result: {:content :structuredContent :isError}. A tool
  throwing is an error result."
  [name args]
  (if-let [f (implementations name)]
    (if (or (repl/built?) (#{"build_status" "vite_errors"} name))
      (try
        (f (or args {}))
        (catch Throwable e
          (tool-error (or (.getMessage e) (str (class e))))))
      (tool-error "The first build is still compiling (a cold one can take a minute or more): try again shortly, build_status tells when it's done"
        {:building true}))
    (throw (ex-info (str "Unknown tool " name) {:code -32602}))))

(defn- write-json
  "x as JSON: keyword values (i.e. :cljf.esm.repl/failed) and symbols with
  their namespaces, which data.json drops."
  [x]
  (json/write-str x
    :value-fn (fn [_ v]
                (cond
                  (symbol? v)  (str v)
                  (keyword? v) (subs (str v) 1)
                  :else        v))))

;; The session's instructions

(defn instructions
  "The server's instructions to the agent, the initialize result's: what it
  is, the build's status and the runtimes connected now."
  []
  (let [{:keys [urls config]} (repl/dev-server)
        info (build-info)
        rs   (:runtimes info)
        shown (take 10 rs)]
    (string/join "\n"
      (concat
        [(str "Clojurific's ClojureScript REPL into the pages and servers running the build of "
           (.getName (.getCanonicalFile (io/file ".")))
           (when config (str " (" config ")"))
           (when (seq urls) (str ", dev server at " (string/join " " urls)))
           ".")
         (build-summary info)]
        (when-not (:building info)
          (concat
            ["Runtimes when this session started (they change as pages open, reload and close; call runtimes for the current ones):"]
            (if (seq shown) (map #(str "- " (runtime-line %)) shown) [(runtimes-text rs)])
            (when (< (count shown) (count rs)) [(str "- and " (- (count rs) (count shown)) " more")])))
        ["Every tool of a runtime (eval, load_file, wait_for_reload, console_logs, tag_runtime) takes its runtime_id, an id or a tag. After editing source files, call wait_for_reload with them to see the edit compiled and hot reloaded."]))))

;; JSON-RPC

(def ^:private protocol-versions
  #{"2024-11-05" "2025-03-26" "2025-06-18" "2025-11-25"})

(def ^:private latest-protocol-version "2025-06-18")

(defn- rpc-error [id code message]
  {:jsonrpc "2.0" :id id :error {:code code :message message}})

(defn handle-rpc
  "The response to JSON-RPC message msg (string keys), nil for a
  notification."
  [msg]
  (let [id     (get msg "id")
        method (get msg "method")
        params (get msg "params")]
    (when (contains? msg "id")
      (try
        (case method
          "initialize" {:jsonrpc "2.0" :id id
                        :result  {:protocolVersion (let [v (get params "protocolVersion")]
                                                     (if (protocol-versions v) v latest-protocol-version))
                                  :capabilities    {:tools {:listChanged false}}
                                  :serverInfo      {:name    "clojurific"
                                                    :title   "Clojurific REPL"
                                                    :version (util/clojurescript-version)}
                                  :instructions    (try (instructions)
                                                     (catch Throwable e
                                                       (str "Clojurific's REPL: " (.getMessage e))))}}
          "ping"       {:jsonrpc "2.0" :id id :result {}}
          "tools/list" {:jsonrpc "2.0" :id id :result {:tools tools}}
          "tools/call" {:jsonrpc "2.0" :id id :result (call (get params "name") (get params "arguments"))}
          (rpc-error id -32601 (str "Method not found: " method)))
        (catch clojure.lang.ExceptionInfo e
          (rpc-error id (:code (ex-data e) -32603) (.getMessage e)))
        (catch Throwable e
          (rpc-error id -32603 (or (.getMessage e) (str (class e)))))))))

;; HTTP

(defn- loopback-name? [host]
  (contains? #{"localhost" "127.0.0.1" "[::1]" "::1"} (some-> host string/lower-case)))

(defn- host-name
  "The host of a Host header, without its port."
  [^String host]
  (when host
    (if (string/starts-with? host "[")
      (subs host 0 (inc (max 0 (string/index-of host "]"))))
      (first (string/split host #":")))))

(defn- origin-host [^String origin]
  (try (.getHost (URI. origin)) (catch Exception _ nil)))

(defn allowed?
  "Whether a request of these headers, from a loopback address or not, may
  use the server: only this machine's clients, with a Host of a loopback
  name (pages of other sites, through DNS rebinding, don't have one), not
  from pages: without an Origin, which browsers send and MCP's clients
  (cljf mcp, agents) don't. A page of this machine, of any port (another
  dev server's, a script in the app's page), would run code otherwise.
  Requests also have to be JSON (see json-request?), which a page can't
  send without the preflight the server refuses."
  [{:keys [loopback? host origin]}]
  (boolean
    (and loopback?
         (or (nil? host) (loopback-name? (host-name host)))
         (nil? origin))))

(defn json-request?
  "Whether a request's Content-Type is JSON's."
  [content-type]
  (boolean (some-> content-type string/lower-case string/trim (string/starts-with? "application/json"))))

(defn- respond! [^HttpExchange ex status ^String body]
  (let [bytes (some-> body (.getBytes StandardCharsets/UTF_8))]
    (when bytes
      (.set (.getResponseHeaders ex) "Content-Type" "application/json"))
    (.sendResponseHeaders ex status (if bytes (count bytes) -1))
    (when bytes
      (with-open [out (.getResponseBody ex)]
        (.write out bytes)))
    (.close ex)))

(defn- handle-exchange [^HttpExchange ex]
  (try
    (let [headers (.getRequestHeaders ex)
          ok?     (allowed? {:loopback? (.isLoopbackAddress (.getAddress (.getRemoteAddress ex)))
                             :host      (.getFirst headers "Host")
                             :origin    (.getFirst headers "Origin")})]
      (cond
        (not ok?)
        (respond! ex 403 (write-json (rpc-error nil -32600 "Forbidden: only for this machine's clients")))

        (not= "POST" (.getRequestMethod ex))
        (do (.set (.getResponseHeaders ex) "Allow" "POST")
            (respond! ex 405 nil))

        (not (json-request? (.getFirst headers "Content-Type")))
        (respond! ex 415 (write-json (rpc-error nil -32600 "The request has to be JSON (Content-Type: application/json)")))

        :else
        (let [body (slurp (.getRequestBody ex) :encoding "UTF-8")
              msg  (try (json/read-str body) (catch Exception _ ::invalid))]
          (if (or (= ::invalid msg) (not (or (map? msg) (sequential? msg))))
            (respond! ex 400 (write-json (rpc-error nil -32700 "Parse error")))
            (let [response (if (sequential? msg)
                             (not-empty (vec (keep handle-rpc msg)))
                             (handle-rpc msg))]
              (if response
                (respond! ex 200 (write-json response))
                (respond! ex 202 nil)))))))
    (catch Throwable e
      (try
        (respond! ex 500 (write-json (rpc-error nil -32603 (str (.getMessage e)))))
        (catch Throwable _ (.close ex))))))

(def ^:private daemon-threads
  (reify ThreadFactory
    (newThread [_ r]
      (doto (Thread. ^Runnable r "cljf-mcp")
        (.setDaemon true)))))

(defn start-server!
  "Starts the MCP server of :repl options, {:mcp-port 0 (a free port)
  :mcp-host \"127.0.0.1\" :mcp-port-files [\".cljf/mcp-port\"]}, MCP's
  Streamable HTTP at /mcp. Only a loopback host: the tools compile forms in
  this JVM, running their macros. Returns the server, its port in :port of
  its meta."
  [{:keys [mcp-port mcp-host mcp-port-files] :or {mcp-host "127.0.0.1" mcp-port-files [".cljf/mcp-port"]}}]
  (when-not (.isLoopbackAddress (InetAddress/getByName mcp-host))
    (throw (ex-info (str ":mcp-host " mcp-host " isn't a loopback address: the MCP server is for this machine only") {})))
  (let [server (HttpServer/create (InetSocketAddress. ^String mcp-host (int (if (true? mcp-port) 0 mcp-port))) 0)]
    (.createContext server "/mcp" (reify HttpHandler (handle [_ ex] (handle-exchange ex))))
    (.setExecutor server (Executors/newCachedThreadPool daemon-threads))
    (.start server)
    (let [port  (.getPort (.getAddress server))
          files (repl/write-port-files! port mcp-port-files)]
      (println (str "[cljf.esm.repl] MCP server on http://" mcp-host ":" port "/mcp"
                 (when (seq files) (str " (" (string/join ", " files) ")"))
                 ", `npx cljf mcp` connects agents to it"))
      (flush)
      {:server server :port port})))

(defn stop-server! [{:keys [^HttpServer server]}]
  (.stop server 0))
