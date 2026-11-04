;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

(ns cljf.esm-repl-tests
  "The REPL of cljf.esm builds: forms compiled in REPL mode, and evaluated
  by the REPL runtime under Node.js, also through the nREPL server with
  cider-nrepl's middleware."
  (:require [cljs.analyzer :as ana]
            [cljs.compiler :as comp]
            [cljs.env :as env]
            [cljf.esm :as esm]
            [cljf.esm.mcp :as mcp]
            [cljf.esm.repl :as repl]
            [cljf.esm.repl.nrepl :as repl.nrepl]
            [cljs.vendor.clojure.data.json :as json]
            [clojure.java.io :as io]
            [clojure.string :as string]
            [clojure.test :refer [deftest is testing use-fixtures]]
            [nrepl.core :as nrepl]
            [nrepl.middleware]
            [nrepl.transport])
  (:import [java.io BufferedReader File InputStreamReader]
           [java.net URI]
           [java.net.http HttpClient HttpRequest HttpRequest$BodyPublishers HttpResponse$BodyHandlers]
           [java.nio.file Files]
           [java.nio.file.attribute FileAttribute]
           [java.util.concurrent.locks ReentrantLock]))

(defn- temp-dir ^File []
  (.toFile (Files/createTempDirectory "cljs-esm-repl" (make-array FileAttribute 0))))

(defn- build-opts
  "Builds esm-repl.app (src/test/esm_repl, on the classpath)."
  [^File dir]
  {:main       'esm-repl.app
   :output-dir (str (io/file dir "out"))
   :esm-repl   true
   ;; the console's log, for console_logs, as the watcher's under :mcp-port
   :closure-defines {"cljf.esm.repl_runtime.CONSOLE_LOG" true}
   ::esm/repl-mains (atom #{})})

(defn- emit
  "The JavaScript of form compiled for the REPL in namespace ns."
  [cenv ns form]
  (env/with-compiler-env cenv
    (binding [ana/*cljs-ns*           ns
              ana/*cljs-static-fns*   true
              ana/*unchecked-if*      false
              ana/*unchecked-arrays*  false]
      (comp/emit-esm-repl
        (ana/analyze (assoc (ana/empty-env) :ns (ana/get-namespace ns) :context :return :def-emits-var true)
          form)))))

(deftest repl-mode-emits-namespace-views
  (let [dir  (temp-dir)
        opts (build-opts dir)
        cenv (env/default-compiler-env (merge esm/default-opts opts))]
    (esm/build opts cenv)
    (testing "vars of the namespace evaluating the form are the view's"
      (let [{:keys [js refs]} (emit cenv 'esm-repl.app '(call-g))]
        (is (string/includes? js "return esm_repl$app.call_g()"))
        (is (contains? refs "esm-repl.app"))))
    (testing "def assigns the view, returns the var"
      (let [{:keys [js]} (emit cenv 'esm-repl.app '(defn g [] :new))]
        (is (string/includes? js "esm_repl$app.g = (function"))
        (is (not (string/includes? js "var esm_repl$app$g")))
        (is (string/includes? js "new cljs$core.Var(function(){return esm_repl$app.g;}"))))
    (testing "set! and binding of the namespace's dynamic vars go through its setters"
      (is (string/includes? (:js (emit cenv 'esm-repl.app '(set! *dyn* 2))) "esm_repl$app.$set$_STAR_dyn_STAR_((2))"))
      (is (string/includes? (:js (emit cenv 'esm-repl.app '(binding [*dyn* 3] *dyn*))) "esm_repl$app.$set$_STAR_dyn_STAR_(")))
    (testing "defonce checks the view"
      (is (string/includes? (:js (emit cenv 'esm-repl.app '(defonce state (atom 1)))) "typeof esm_repl$app.state !== 'undefined'")))
    (testing "deftype assigns the view"
      (is (string/includes? (:js (emit cenv 'esm-repl.app '(deftype T [a]))) "esm_repl$app.T = (function (a){")))
    (testing "Closure Library shims and namespaces run by the compatibility layer"
      (let [{:keys [js refs]} (emit cenv 'esm-repl.app '(gstr/trim " a "))]
        (is (string/includes? js "goog$string.trim("))
        (is (contains? refs "goog.string")))
      (let [{:keys [js goog-lib-refs]} (emit cenv 'esm-repl.app '(gstr/caseInsensitiveCompare "a" "b"))]
        (is (string/includes? js "goog$string$.caseInsensitiveCompare("))
        (is (contains? goog-lib-refs "goog.string"))))
    (testing "modules register themselves"
      (let [out (slurp (io/file dir "out" "esm_repl" "app.js"))]
        (is (string/includes? out "import * as esm_repl$app from \"./app.js\";"))
        (is (string/includes? out "$$r.nses.set(\"esm-repl.app\", { mod: esm_repl$app,"))
        (is (string/includes? out "import \"../cljf/esm/repl_runtime.js\";"))
        (testing "with the stamp of the compile, also in the analysis"
          (is (string/includes? out (str "stamp: \"" (get-in @cenv [::ana/namespaces 'esm-repl.app :cljf.esm/repl-stamp]) "\""))))))))

;; The REPL runtime under Node.js, messages are JSON lines on its stdin and
;; stdout.

(def ^:private node-harness
  "import readline from 'node:readline';
   import util from 'node:util';
   // stdout is the REPL's: the console's levels print to stderr, before the
   // runtime records them (its console_logs)
   for (const level of ['log', 'info', 'debug']) console[level] = (...args) => process.stderr.write(util.format(...args) + '\\n');
   const runtime = await import('./out/cljf/esm/repl_runtime.js');
   await import('./out/esm_repl/app.js');
   const send = msg => process.stdout.write(JSON.stringify({ ...msg, runtime: 1 }) + '\\n');
   globalThis.cljs_eval = (code, opts) => runtime.console_eval(send, code, opts ?? null);
   readline.createInterface({ input: process.stdin })
     .on('line', line => runtime.handle_BANG_(JSON.parse(line), send));
   send({ op: 'hello', url: 'node', visible: true, root: new URL('./out/', import.meta.url).href });")

(defn- start-node!
  "Runs the runtime in Node.js, connected to the REPL."
  [^File dir]
  (spit (io/file dir "harness.mjs") node-harness)
  (let [proc (.start (doto (ProcessBuilder. ["node" "harness.mjs"])
                       (.directory dir)
                       (.redirectError java.lang.ProcessBuilder$Redirect/INHERIT)))
        in   (io/writer (.getOutputStream proc))]
    (doto (Thread. (fn []
                     (with-open [rdr (BufferedReader. (InputStreamReader. (.getInputStream proc)))]
                       (doseq [line (line-seq rdr)]
                         (try
                           (repl/handle-message! line)
                           (catch Exception e
                             (println "Not a REPL message:" line (.getMessage e))))))))
      (.setDaemon true)
      (.start))
    {:proc proc
     :send! (fn [_ msg]
              (locking in
                (.write in (str (json/write-str msg) "\n"))
                (.flush in)))}))

(def ^:private runtime-dir
  "The fixture's output's directory, the REPL's watch directory."
  (atom nil))

(defn- with-node-runtime [f]
  (let [dir  (temp-dir)
        _    (reset! runtime-dir dir)
        opts (build-opts dir)
        cenv (env/default-compiler-env (merge esm/default-opts opts))
        build! #(do (esm/build opts cenv)
                    {:type "compiled" :warnings []})]
    ;; a JSX runtime for #x literals, see evaluates-jsx-literals
    (spit (doto (io/file dir "node_modules" "react" "jsx-runtime.js") io/make-parents)
      "const el = (type, props, key) => ({type, key: key ?? null, props});
       export const jsx = el, jsxs = el, Fragment = 'Fragment';")
    (spit (io/file dir "node_modules" "react" "package.json")
      "{\"name\": \"react\", \"type\": \"module\", \"exports\": {\"./jsx-runtime\": \"./jsx-runtime.js\"}}")
    (build!)
    (let [{:keys [proc send!]} (start-node! dir)]
      (try
        (repl/start! {:compiler-env cenv
                      :options      (:options @cenv)
                      :lock         (ReentrantLock.)
                      :compile!     (fn [_] (build!))
                      :warnings     (atom {})
                      :status       (atom {:compiling false
                                           :last {:type "compiled" :namespaces 3 :ms 5 :at 0}})
                      :watch-dirs   [(.getCanonicalPath dir)]
                      :run-hooks!   (fn [_])
                      :send!        send!})
        (loop [n 0]
          (when (and (empty? (repl/runtimes)) (< n 100))
            (Thread/sleep 50)
            (recur (inc n))))
        (f)
        (finally
          (repl/stop!)
          (.destroy ^Process proc))))))

(use-fixtures :once with-node-runtime)

(deftest evaluates-forms-in-the-runtime
  (is (= [{:runtime-id 1 :url "node" :title nil :tag nil :visible true :user-agent nil}]
         (map #(dissoc % :focused-at :connected-at) (repl/runtimes))))
  (is (number? (:connected-at (first (repl/runtimes)))))
  (is (= ["3"] (:results (repl/cljs-eval "(+ 1 2)"))))
  (testing "output"
    (is (= "hi\n" (:out (repl/cljs-eval "(println \"hi\")")))))
  (testing "the namespace's vars, Closure Library shims"
    (is (= ["\"a\""] (:results (repl/cljs-eval "(trim \" a \")" {:ns 'esm-repl.app})))))
  (testing "a redefined fn is called by the namespace's code"
    (is (= ["#'esm-repl.app/g" ":new"]
           (:results (repl/cljs-eval "(defn g [] :new) (call-g)" {:ns 'esm-repl.app})))))
  (testing "in-ns, vars only defined at the REPL"
    (let [{:keys [results ns]} (repl/cljs-eval "(in-ns 'esm-repl.app) (def only-repl 5) (inc only-repl)")]
      (is (= ["nil" "#'esm-repl.app/only-repl" "6"] results))
      (is (= 'esm-repl.app ns))))
  (testing "defonce keeps the module's value"
    (is (= ["nil" "0"] (:results (repl/cljs-eval "(defonce state (atom 1)) @state" {:ns 'esm-repl.app})))))
  (testing "binding a dynamic var"
    (is (= ["2" "1"] (:results (repl/cljs-eval "(binding [esm-repl.app/*dyn* 2] esm-repl.app/*dyn*) esm-repl.app/*dyn*")))))
  (testing "nil and false are forms"
    (is (= ["nil" "false" "1"] (:results (repl/cljs-eval "nil false 1")))))
  (testing "promises with :await"
    (is (= ["42"] (:results (repl/cljs-eval "(js/Promise.resolve 42)" {:await true}))))))

(deftest tags-target-one-runtime
  (is (= "\"A\"" (repl/tag! 1 "A")))
  (is (= 1 (:runtime-id (repl/cljs-eval "1" {:tag "A"}))))
  (testing "a page opened by the tagged one has a copy of its tag"
    (repl/handle-message! (json/write-str {:op "hello" :runtime 2 :url "copy" :tag "A"}))
    (is (= {1 "A" 2 nil} (into {} (map (juxt :runtime-id :tag)) (repl/runtimes))))
    (repl/handle-message! (json/write-str {:op "bye" :runtime 2})))
  (repl/tag! 1 nil)
  (is (nil? (:tag (first (repl/runtimes))))))

(deftest maps-stack-traces-to-the-sources
  (let [{:keys [error stack]} (repl/cljs-eval "(+ 1 2)\n(esm-repl.app/fail)")]
    (is (= "failed" error))
    (is (string/includes? stack "(esm_repl/app.cljs:16:10)") stack)
    (is (string/includes? stack "(<cljs repl>:2:2)") stack)
    (testing "without the frames of the REPL's evaluation"
      (is (not (string/includes? stack "repl_runtime"))))))

(deftest evaluates-the-consoles-forms
  (let [console #(:results (repl/cljs-eval (str "(js/cljs_eval " (pr-str %) %2 ")") {:await true}))]
    (testing "values of the last form"
      (is (= ["3"] (console "(inc 1) (+ 1 2)" ""))))
    (testing "printed"
      (is (= ["\"[1 2]\""] (console "[1 2]" " #js {:print true}"))))
    (testing "the namespace of the last in-ns"
      (is (= [":esm-repl.app/x"] (console "(in-ns 'esm-repl.app) ::x" "")))
      (is (= [":esm-repl.app/y"] (console "::y" ""))))
    (testing "rejected for warnings"
      (is (= ["\"Form not evaluated: 1 warning(s)\""]
             (:results (repl/cljs-eval "(.catch (js/cljs_eval \"(nope)\") #(.-message %))" {:await true})))))))

(deftest requires-namespaces-at-the-repl
  (testing "a namespace not in the build is compiled and loaded"
    (let [r (repl/cljs-eval "(require '[esm-repl.extra :as e]) (e/x)")]
      (is (= ["nil" ":extra"] (:results r)) (pr-str r))))
  (testing "namespaces only defined at the REPL"
    (is (= ["nil" "#'scratch.ns/y" "2"]
           (:results (repl/cljs-eval "(ns scratch.ns (:require [esm-repl.app :as app])) (def y 2) y"))))))

(deftest evaluates-jsx-literals
  (testing "#x needs cljf.jsx, which the REPL compiles and loads"
    (let [r (repl/cljs-eval "(ns scratch.jsx (:require [cljf.jsx])) (js/JSON.stringify #x [:div.a {:onClick identity :data-n 1} (for [i [1 2]] #x [:i {:key i} i])])")]
      (is (= ["nil" (pr-str "{\"type\":\"div\",\"key\":null,\"props\":{\"data-n\":1,\"className\":\"a\",\"children\":[{\"type\":\"i\",\"key\":1,\"props\":{\"children\":1}},{\"type\":\"i\",\"key\":2,\"props\":{\"children\":2}}]}}")]
             (:results r))
          (pr-str r))))
  (testing "#jsx is #x"
    (is (= [(pr-str "p")] (:results (repl/cljs-eval "(.-type #jsx [:p])" {:ns 'scratch.jsx})))))
  (testing "a namespace without cljf.jsx (i.e. an editor's unsaved buffer) requires it for #x"
    (is (= [(pr-str "p")] (:results (repl/cljs-eval "(.-type #x [:p])" {:ns 'esm-repl.app}))))))

(deftest fails-visibly
  (testing "a form with warnings isn't evaluated, nor are the forms after it"
    (let [{:keys [results warnings error out]} (repl/cljs-eval "(nope) (println \"after\")")]
      (is (= [::repl/failed] results))
      (is (= "Use of undeclared Var cljs.user/nope" (:message (first warnings))))
      (is (= "Form not evaluated: 1 warning(s)" error))
      (is (= "" out))))
  (testing "unless :warnings-ok"
    (let [{:keys [results warnings error]} (repl/cljs-eval "(nope)" {:warnings-ok true})]
      (is (= [::repl/failed] results))
      (is (seq warnings))
      (is (string/includes? error "Cannot read properties of undefined"))))
  (testing "errors"
    (let [{:keys [results error ex-data]} (repl/cljs-eval "1 (throw (ex-info \"boom\" {:a 1})) 2")]
      (is (= ["1" ::repl/failed] results))
      (is (= "boom" error))
      (is (= "{:a 1}" ex-data))))
  (testing "#= isn't evaluated while reading"
    (is (string/starts-with? (:error (repl/cljs-eval "#=(+ 1 2)")) "Could not read")))
  (testing "no such runtime"
    (is (= "No runtime 5, see (cljf.esm.repl/runtimes)" (:error (repl/cljs-eval "1" {:runtime-id 5}))))))

(deftest bundle-runtimes-evaluate-loaded-files
  ;; runtime 1 says it runs a bundle, as connect-socket!'s hello does
  ;; the harness' hello, see node-harness: its root maps stack traces
  (let [root  (str (.toUri (.toPath (.getCanonicalFile (io/file @runtime-dir "out")))))
        hello #(repl/handle-message! (json/write-str (merge {:op "hello" :runtime 1 :url "node" :visible true :root root} %)))]
    (hello {:hmr false})
    (try
      (is (= [false] (map :hmr (repl/runtimes))))
      (testing "load-file evaluates the file's forms instead of waiting for a hot reload"
        (let [f (doto (io/file @runtime-dir "scratch" "bundle.cljs") io/make-parents)]
          (spit f "(ns scratch.bundle)\n(def x 41)\n")
          (let [{:keys [value err error] :as r} (repl/load-file (.getPath f) {})]
            (is (nil? error) (pr-str r))
            (is (= "nil" value))
            (is (string/includes? err "bundle's runtime, which doesn't hot reload") err))
          (is (= ["42"] (:results (repl/cljs-eval "(inc scratch.bundle/x)"))))))
      (finally
        (hello {})))
    (is (= [nil] (map :hmr (repl/runtimes))))))

;; The MCP server

(defn- mcp-post
  "Posts body to the MCP server on port with headers, returns [status
  parsed body]."
  ([port body] (mcp-post port body {}))
  ([port body headers]
   (let [req  (.build ^java.net.http.HttpRequest$Builder
                (reduce (fn [^java.net.http.HttpRequest$Builder b [^String k ^String v]] (.header b k v))
                        (-> (HttpRequest/newBuilder (URI. (str "http://127.0.0.1:" port "/mcp")))
                            (.POST (HttpRequest$BodyPublishers/ofString (json/write-str body))))
                        (merge {"Content-Type" "application/json"} headers)))
         resp (.send (HttpClient/newHttpClient) req (HttpResponse$BodyHandlers/ofString))]
     [(.statusCode resp) (some-> (not-empty (.body resp)) json/read-str)])))

(defn- raw-status
  "The status of a POST of body to the MCP server on port with a Host
  header, which HttpClient doesn't set."
  [port host body]
  (with-open [sock (java.net.Socket. "127.0.0.1" (int port))]
    (let [out (.getOutputStream sock)
          bytes (.getBytes ^String body "UTF-8")]
      (.write out (.getBytes (str "POST /mcp HTTP/1.1\r\nHost: " host "\r\nContent-Type: application/json\r\n"
                                  "Content-Length: " (count bytes) "\r\nConnection: close\r\n\r\n") "UTF-8"))
      (.write out bytes)
      (.flush out)
      (let [line (.readLine (BufferedReader. (InputStreamReader. (.getInputStream sock))))]
        (Long/parseLong (second (string/split line #" ")))))))

(deftest mcp-tools
  (testing "runtime tools take a runtime id"
    (let [{:keys [isError content structuredContent]} (mcp/call "eval" {"code" "(+ 1 2)"})]
      (is isError)
      (is (string/starts-with? (:text (first content)) "runtime_id is required"))
      (is (= [1] (map :runtime_id (:runtimes structuredContent))))))
  (testing "eval"
    (let [{:keys [isError structuredContent]} (mcp/call "eval" {"code" "(+ 1 2) (println \"hi\")" "runtime_id" 1})]
      (is (not isError))
      (is (= ["3" "nil"] (:results structuredContent)))
      (is (= "hi\n" (:out structuredContent)))
      (is (= 1 (get-in structuredContent [:runtime :runtime_id])))
      (is (= "server" (get-in structuredContent [:runtime :kind])))
      (is (string? (get-in structuredContent [:runtime :connected_at]))))
    (testing "values bounded by default"
      (is (= ["(0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 ...)"]
             (:results (:structuredContent (mcp/call "eval" {"code" "(range)" "runtime_id" "1"})))))))
  (testing "errors and warnings are tool errors"
    (let [{:keys [isError structuredContent]} (mcp/call "eval" {"code" "(nope)" "runtime_id" 1})]
      (is isError)
      (is (= "Use of undeclared Var cljs.user/nope" (:message (first (:warnings structuredContent))))))
    (let [{:keys [isError structuredContent]} (mcp/call "eval" {"code" "(esm-repl.app/fail)" "runtime_id" 1})]
      (is isError)
      (is (= "failed" (:error structuredContent)))))
  (testing "a disconnected runtime, which a page reloading is for a moment"
    (repl/handle-message! (json/write-str {:op "hello" :runtime 9 :url "http://localhost:5173/" :kind "browser"}))
    (repl/handle-message! (json/write-str {:op "bye" :runtime 9}))
    (let [{:keys [isError content]} (mcp/call "eval" {"code" "1" "runtime_id" 9})]
      (is isError)
      (is (re-find #"^Runtime 9 disconnected \d+s ago \(http://localhost:5173/\), the page may be reloading" (:text (first content))))
      (is (string/includes? (:text (first content)) "- 1 server"))))
  (testing "tags"
    (is (not (:isError (mcp/call "tag_runtime" {"runtime_id" 1 "tag" "srv"}))))
    (is (= ["2"] (:results (:structuredContent (mcp/call "eval" {"code" "(inc 1)" "runtime_id" "srv"})))))
    (mcp/call "tag_runtime" {"runtime_id" 1 "tag" nil}))
  (testing "wait_for_reload"
    (let [{:keys [isError structuredContent]} (mcp/call "wait_for_reload" {"runtime_id" 1})]
      (is (not isError) (pr-str structuredContent))
      (is (= "reloaded" (:status structuredContent))))
    (let [{:keys [status warnings]} @@#'repl/build
          warning {:message "Use of undeclared Var esm-repl.app/x" :file "esm_repl/app.cljs" :line 1}]
      (testing "the build's error, until a compile of its sources succeeds"
        (swap! status assoc :errors {"a" {:type "error" :message "boom" :file "esm_repl/app.cljs" :at 2}
                                     "b" {:type "error" :message "older" :file "esm_repl/extra.cljs" :at 1}})
        (try
          (let [{:keys [isError structuredContent content]} (mcp/call "wait_for_reload" {"runtime_id" 1})]
            (is isError)
            (is (= "boom" (get-in structuredContent [:error :message])) "the most recent")
            (is (= ["boom" "older"] (map :message (:errors structuredContent))))
            (is (string/includes? (:text (first content)) "Also failed: older")))
          (is (= "paused: the build failed" (:hot_reload (:structuredContent (mcp/call "build_status" {})))))
          (finally
            (swap! status assoc :errors {}))))
      (testing "only Clojure and ClojureScript files are compiled"
        (let [ts (doto (io/file @runtime-dir "main.ts") (spit "const x = 1;"))
              {:keys [structuredContent content]} (mcp/call "wait_for_reload" {"runtime_id" 1 "files" [(.getPath ts)]})]
          (is (= "reloaded" (:status structuredContent)))
          (is (= 1 (count (:skipped structuredContent))))
          (is (string/includes? (:text (first content)) "Not compiled (Vite reloads them)"))))
      (testing "warnings hold back hot reloads"
        (reset! warnings {"out.js" [warning]})
        (try
          (is (= "warnings" (:status (:structuredContent (mcp/call "wait_for_reload" {"runtime_id" 1})))))
          (testing "unless the dev server ignores them"
            (repl/handle-message! (json/write-str {:op "dev-server" :urls [] :ignoreWarnings true}))
            (let [{:keys [isError structuredContent]} (mcp/call "wait_for_reload" {"runtime_id" 1})]
              (is (not isError) (pr-str structuredContent))
              (is (= "reloaded" (:status structuredContent)))
              (is (= ["Use of undeclared Var esm-repl.app/x"] (map :message (:warnings structuredContent)))))
            (is (= "on" (:hot_reload (:structuredContent (mcp/call "build_status" {}))))))
          (finally
            (reset! warnings {})
            (reset! @#'repl/dev-server- nil))))))
  (testing "build_status"
    (let [{:keys [structuredContent]} (mcp/call "build_status" {})]
      (is (= "on" (:hot_reload structuredContent)))
      (is (= "compiled" (get-in structuredContent [:last_compile :result])))
      (is (= [1] (map :runtime_id (:runtimes structuredContent))))))
  (testing "console_logs"
    (mcp/call "eval" {"code" "(js/console.log \"logged\" #js {:a 1} [1 2]) (js/console.warn \"careful\")" "runtime_id" 1})
    (let [{:keys [isError structuredContent]} (mcp/call "console_logs" {"runtime_id" 1})
          entries (:entries structuredContent)
          logged  (first (filter #(= "log" (:level %)) (filter #(string/starts-with? (:text %) "logged") entries)))]
      (is (not isError) (pr-str structuredContent))
      (is (= "logged {\"a\":1} [1 2]" (:text logged)))
      (is (some #(= {:level "warn" :text "careful"} (select-keys % [:level :text])) entries))
      (testing "JavaScript objects previewed, bounded"
        (mcp/call "eval" {"code" "(js/console.log #js {:a #js {:b #js {:c 1}} :xs (into-array (range 20))})" "runtime_id" 1})
        (is (some #{"{\"a\":{\"b\":{…}},\"xs\":[0,1,2,3,4,5,6,7,8,9,…]}"}
              (map :text (:entries (:structuredContent (mcp/call "console_logs" {"runtime_id" 1})))))))
      (testing "since and levels"
        (let [cursor (:cursor structuredContent)]
          (mcp/call "eval" {"code" "(js/console.error \"later\") (js/console.log \"also\")" "runtime_id" 1})
          (is (= ["later"] (map :text (:entries (:structuredContent
                                                  (mcp/call "console_logs" {"runtime_id" 1 "since" cursor "levels" ["error"]}))))))
          (testing "a cursor of another page load (the page reloaded since) gets all of them"
            (let [r (:structuredContent (mcp/call "console_logs" {"runtime_id" 1 "since" "other:100000"}))]
              (is (:reloaded r))
              (is (some #(= "logged" (subs (:text %) 0 (min 6 (count (:text %))))) (:entries r))))))))
    (testing "uncaught errors and unhandled rejections, recorded without changing Node.js' handling of them (it would end the harness' process), the stack mapped to the sources"
      ;; as Node.js' uncaughtExceptionMonitor would: the runtime's listener
      (mcp/call "eval" {"code" "(doseq [[e origin] [[(js/Error. \"thrown\") \"uncaughtException\"] [(try (esm-repl.app/fail) (catch :default e e)) \"unhandledRejection\"]]] (.emit js/process \"uncaughtExceptionMonitor\" e origin))" "runtime_id" 1})
      (let [errors (:entries (:structuredContent (mcp/call "console_logs" {"runtime_id" 1 "levels" ["error"]})))
            [thrown rejected] (take-last 2 errors)]
        (is (string/starts-with? (:text thrown) "Uncaught Error: thrown") (pr-str errors))
        (is (string/starts-with? (:text rejected) "Unhandled rejection Error: failed") (pr-str errors))
        (is (string/includes? (str (:text rejected) (:stack rejected)) "esm_repl/app.cljs:16") (pr-str rejected)))
      (testing "no unhandledRejection listener, which would turn Node.js' handling of them off"
        (is (= ["0"] (:results (repl/cljs-eval "(.listenerCount js/process \"unhandledRejection\")")))))))
  (testing "vite_errors"
    (is (:isError (mcp/call "vite_errors" {})) "without a dev server")
    (repl/handle-message! (json/write-str {:op "dev-server" :urls ["http://localhost:5173/"]}))
    (is (= "No errors" (-> (mcp/call "vite_errors" {}) :content first :text)))
    (repl/handle-message! (json/write-str {:op "vite-error" :source "overlay" :message "Unexpected token"
                                           :file "src/main.ts" :line 3 :plugin "vite:oxc"}))
    (repl/handle-message! (json/write-str {:op "vite-error" :source "log" :message "Error when evaluating SSR module"}))
    (repl/handle-message! (json/write-str {:op "vite-error" :source "log" :message "Internal server error: Unexpected token"}))
    (let [{:keys [overlay log]} (:structuredContent (mcp/call "vite_errors" {}))]
      (is (= [{:message "Unexpected token" :file "src/main.ts" :line 3 :plugin "vite:oxc"}]
             (map #(select-keys % [:message :file :line :plugin]) overlay)))
      (is (= ["Error when evaluating SSR module"] (map :message log)) "the overlay's error logged again is left out"))
    (testing "an overlay error without a message hides no logged one"
      (repl/handle-message! (json/write-str {:op "vite-error" :source "overlay" :message ""}))
      (is (= 2 (count (:log (:structuredContent (mcp/call "vite_errors" {})))))))
    (testing "an update replaces the overlay's error"
      (repl/handle-message! (json/write-str {:op "vite-update"}))
      (is (empty? (:overlay (:structuredContent (mcp/call "vite_errors" {}))))))
    (reset! @#'repl/dev-server- nil))
  (testing "ns_info"
    (let [{:keys [structuredContent]} (mcp/call "ns_info" {"ns" "esm-repl.app"})]
      (is (= "src/test/esm_repl/esm_repl/app.cljs" (:file structuredContent)))
      (is (some #{{:name "call-g" :arglists ["[]"]}} (:publics structuredContent)))
      (is (some #{"goog.string"} (:requires structuredContent)))
      (is (:in_build structuredContent))))
  (testing "macroexpand"
    (is (= "(if 1 (do 2))" (:expansion (:structuredContent (mcp/call "macroexpand" {"form" "(when 1 2)" "mode" "macroexpand-1"})))))
    (is (string/includes? (:expansion (:structuredContent (mcp/call "macroexpand" {"form" "(when-not (when 1 2) 3)" "mode" "all"})))
          "(if 1 (do 2))"))
    (is (:isError (mcp/call "macroexpand" {"form" "(when"}))))
  (testing "doc, source, apropos and namespaces"
    (is (= "esm-repl.app/call-g" (:name (:structuredContent (mcp/call "doc" {"symbol" "call-g" "ns" "esm-repl.app"})))))
    (is (= "macro" (:kind (:structuredContent (mcp/call "doc" {"symbol" "when"})))))
    (is (= "(defn call-g [] (g))" (:source (:structuredContent (mcp/call "source" {"symbol" "esm-repl.app/call-g"})))))
    (is (some #{"esm-repl.app/call-g"} (:matches (:structuredContent (mcp/call "apropos" {"query" "CALL-"})))))
    (let [nses (:namespaces (:structuredContent (mcp/call "namespaces" {"prefix" "esm-repl"})))]
      (is (some #{{:ns "esm-repl.app" :file "src/test/esm_repl/esm_repl/app.cljs"}} nses) (pr-str nses))
      (is (every? #(string/starts-with? (:ns %) "esm-repl") nses)))))

(deftest mcp-tools-copy
  (testing "the launcher's bridge lists the tools cljf.esm.mcp has"
    (is (= (json/read-str (json/write-str mcp/tools))
           (json/read-str (slurp "src/main/js/cljf/mcp-tools.json")))
        "run script/gen-mcp-tools")))

(deftest mcp-server
  (let [dir    (temp-dir)
        port-file (io/file dir ".cljf" "mcp-port")
        {:keys [port] :as server} (mcp/start-server! {:mcp-port 0 :mcp-port-files [(.getPath port-file)]})]
    (try
      (is (= (str port) (slurp port-file)))
      (testing "initialize, with the build and its runtimes in the instructions"
        (let [[status {:strs [result]}] (mcp-post port {:jsonrpc "2.0" :id 1 :method "initialize"
                                                         :params {:protocolVersion "2025-06-18" :capabilities {}
                                                                  :clientInfo {:name "test" :version "1"}}})]
          (is (= 200 status))
          (is (= "2025-06-18" (get result "protocolVersion")))
          (is (string/includes? (get result "instructions") "- 1 server"))))
      (testing "notifications are accepted"
        (is (= [202 nil] (mcp-post port {:jsonrpc "2.0" :method "notifications/initialized"}))))
      (testing "tools/list and tools/call"
        (let [[_ {:strs [result]}] (mcp-post port {:jsonrpc "2.0" :id 2 :method "tools/list"})]
          (is (= (map :name mcp/tools) (map #(get % "name") (get result "tools")))))
        (let [[_ {:strs [result]}] (mcp-post port {:jsonrpc "2.0" :id 3 :method "tools/call"
                                                   :params {:name "eval" :arguments {:code "(* 6 7)" :runtime_id 1}}})]
          (is (= ["42"] (get-in result ["structuredContent" "results"])))))
      (testing "pages of other sites can't use it (DNS rebinding)"
        (is (= 403 (first (mcp-post port {:jsonrpc "2.0" :id 4 :method "tools/list"} {"Origin" "http://evil.example"}))))
        (is (= 403 (raw-status port "evil.example" (json/write-str {:jsonrpc "2.0" :id 4 :method "tools/list"}))))
        (is (= 200 (raw-status port (str "localhost:" port) (json/write-str {:jsonrpc "2.0" :id 4 :method "tools/list"}))))
        (testing "nor pages of this machine, of any port"
          (is (= 403 (first (mcp-post port {:jsonrpc "2.0" :id 4 :method "tools/list"} {"Origin" "http://localhost:5173"})))))
        (testing "nor requests that aren't JSON, which a page sends without a preflight"
          (is (= 415 (first (mcp-post port {:jsonrpc "2.0" :id 4 :method "tools/list"} {"Content-Type" "text/plain"}))))))
      (testing "unknown methods and tools"
        (is (= -32601 (get-in (second (mcp-post port {:jsonrpc "2.0" :id 5 :method "nope"})) ["error" "code"])))
        (is (= -32602 (get-in (second (mcp-post port {:jsonrpc "2.0" :id 6 :method "tools/call" :params {:name "nope"}}))
                        ["error" "code"]))))
      (finally
        (mcp/stop-server! server)))))

(defn- wrap-test
  "Middleware the tests name, answering a test op."
  [h]
  (fn [msg]
    (if (= "cljf-test" (:op msg))
      (nrepl.transport/respond-to msg {:status #{:done} :answer "yes"})
      (h msg))))

(nrepl.middleware/set-descriptor! #'wrap-test {:handles {"cljf-test" {}}})

(def test-middleware-names
  "A var holding middleware names, as cider.nrepl/cider-middleware."
  ['cljf.esm-repl-tests/wrap-test "cljf.esm-repl-tests/wrap-test"])

(def test-middleware-set
  "A var holding a set of middleware names."
  #{'cljf.esm-repl-tests/wrap-test})

(def not-middleware
  "A var holding neither middleware nor names."
  42)

(def cyclic-middleware
  "A var holding middleware names, its own among them."
  '[cljf.esm-repl-tests/cyclic-middleware cljf.esm-repl-tests/other-cyclic-middleware])

(def other-cyclic-middleware
  "A var holding middleware names naming cyclic-middleware."
  '[cljf.esm-repl-tests/cyclic-middleware cljf.esm-repl-tests/wrap-test])

(deftest resolves-nrepl-middleware
  (let [server-middleware #'repl.nrepl/server-middleware
        err (java.io.StringWriter.)]
    (testing "names, strings, vars holding collections of names, without duplicates; middleware that doesn't load, or isn't a fn, is left out"
      (with-redefs [repl.nrepl/project-config (constantly {:middleware ['cljf.esm-repl-tests/wrap-test 'no.such.ns/wrap]})]
        (let [[names vars] (binding [*err* err]
                             (server-middleware ['cljf.esm-repl-tests/test-middleware-names
                                                 'cljf.esm-repl-tests/test-middleware-set
                                                 'cljf.esm-repl-tests/not-middleware
                                                 "cljf.esm-repl-tests/nope"]))]
          (is (= ['cljf.esm-repl-tests/test-middleware-names 'cljf.esm-repl-tests/test-middleware-set
                  'cljf.esm-repl-tests/wrap-test]
                 names))
          (is (= [#'wrap-test] vars))
          (is (string/includes? (str err) "nREPL middleware cljf.esm-repl-tests/not-middleware left out"))
          (is (string/includes? (str err) "nREPL middleware cljf.esm-repl-tests/nope not loaded"))
          (is (string/includes? (str err) "nREPL middleware no.such.ns/wrap not loaded")))))
    (testing "the project's .nrepl.edn, one that can't be read is left out"
      (let [dir (temp-dir)
            f   (io/file dir ".nrepl.edn")
            read-config #(binding [*err* err]
                           (with-redefs [io/file (fn [& args]
                                                   (if (= [".nrepl.edn"] args) f (apply (var-get #'io/file) args)))]
                             (#'repl.nrepl/project-config)))]
        (is (= {} (read-config)))
        (testing "empty, without a warning"
          (let [before (str err)]
            (spit f "")
            (is (= {} (read-config)))
            (spit f "  ; nothing yet\n")
            (is (= {} (read-config)))
            (is (= before (str err)))))
        (spit f "{:middleware [cider.nrepl/cider-middleware]}")
        (is (= {:middleware '[cider.nrepl/cider-middleware]} (read-config)))
        (spit f "{:middleware [")
        (is (= {} (read-config)))
        (is (string/includes? (str err) ".nrepl.edn not read"))))
    (testing ":middleware of an unexpected shape is left out"
      (doseq [[config expected] [[{:middleware :cider} []]
                                 [{:middleware {:a 'cljf.esm-repl-tests/wrap-test}} []]
                                 [{:middleware [1 'cljf.esm-repl-tests/wrap-test]} [#'wrap-test]]]]
        (let [err (java.io.StringWriter.)]
          (with-redefs [repl.nrepl/project-config (constantly config)]
            (is (= expected (second (binding [*err* err] (server-middleware [])))) (pr-str config))
            (is (string/includes? (str err) "left out") (pr-str config))))))
    (testing "collections naming themselves, directly or through others"
      (with-redefs [repl.nrepl/project-config (constantly {})]
        (is (= [#'wrap-test] (second (server-middleware ['cljf.esm-repl-tests/cyclic-middleware]))))))
    (testing "cider's middleware adds JavaScript property completion"
      (with-redefs [repl.nrepl/project-config (constantly {})]
        (let [[_ vars] (server-middleware ['cider.nrepl/cider-middleware])]
          (is (some #{#'repl.nrepl/wrap-cljs-complete} vars))
          (is (= (count vars) (count (distinct vars)))))))))

(defn- with-nrepl
  "Calls f with a fn sending a message to a session of an nREPL server with
  middleware, returning its combined responses."
  [middleware f]
  (let [server (with-redefs [repl.nrepl/project-config (constantly {})]
                 (repl.nrepl/start-server! {:nrepl-port 0 :port-files [] :middleware middleware}))]
    (try
      (with-open [conn (nrepl/connect :port (:port server))]
        (let [session (nrepl/client-session (nrepl/client conn 30000))]
          (f #(nrepl/combine-responses (nrepl/message session (if (string? %) {:op "eval" :code %} %))))))
      (finally
        (.close ^java.io.Closeable server)))))

(deftest nrepl-sessions
  (with-nrepl ['cljf.esm-repl-tests/wrap-test]
    (fn [send]
      (testing "configured middleware"
        (is (= "yes" (:answer (send {:op "cljf-test"})))))
      (testing "a session switched to ClojureScript evaluates in the runtime"
        (send "(cljf.esm.repl/repl)")
        (is (= ["\"cljs\""] (:value (send "(if (exists? js/process) \"cljs\" \"clj\")")))))
      (testing "and Clojure again after :cljs/quit"
        (is (= [":cljs/quit"] (:value (send ":cljs/quit"))))
        (is (= ["3"] (:value (send "(+ 1 2)")))))
      (testing "it switches to ClojureScript again"
        (send "(cljf.esm.repl/repl)")
        (is (= ["\"cljs\""] (:value (send "(if (exists? js/process) \"cljs\" \"clj\")"))))
        (send ":cljs/quit")))))

(defn- eventually
  "Calls f until it returns truthy, up to 10s, returns its last value."
  [f]
  (loop [n 0]
    (let [v (f)]
      (if (or v (>= n 100)) v (do (Thread/sleep 100) (recur (inc n)))))))

(deftest cider-nrepl-in-cljs-sessions
  (with-nrepl ['cider.nrepl/cider-middleware]
    (fn [send]
      (let [candidates (fn [msg] (set (map :candidate (:completions (send (assoc msg :op "complete"))))))
            js         (fn [msg] (candidates (assoc msg :enhanced-cljs-completion? "t")))]
        (testing "Clojure sessions complete Clojure"
          (is (contains? (candidates {:prefix "clojure.core/inte" :ns "user"}) "clojure.core/interleave")))
        (send "(cljf.esm.repl/repl)")
        (testing "the build's vars"
          (is (contains? (candidates {:prefix "call-" :ns "esm-repl.app"}) "call-g")))
        (testing "JavaScript properties of the runtime, asked for, once suitable.js-introspection loaded in it"
          (is (= #{"js/process.version" "js/process.versions"}
                 (eventually #(not-empty (js {:prefix "js/process.ver" :ns "cljs.user"})))))
          (is (= #{"js/process.version" "js/process.versions"}
                 (js {:prefix "js/process.ver" :ns "esm-repl.app"})))
          (is (= #{".-version" ".-versions"}
                 (js {:prefix ".-ver" :ns "cljs.user" :context "(__prefix__ js/process)"})))
          (is (empty? (candidates {:prefix "js/process.ver" :ns "cljs.user"}))))
        (testing "values printed whole, whatever *print-length* (i.e. set in user.clj)"
          (let [root *print-length*]
            (alter-var-root #'*print-length* (constantly 3))
            (try
              (is (< 20 (count (js {:prefix "js/process." :ns "cljs.user"}))))
              (finally
                (alter-var-root #'*print-length* (constantly root))))))
        (testing "no property completions while a compile holds the build lock, none compiled after it"
          (let [lock     (:lock @@#'repl/build)
                snippets #(deref @#'repl/snippets)
                held     (promise)
                release  (promise)
                compile  (future (.lock ^java.util.concurrent.locks.ReentrantLock lock)
                                 (deliver held true)
                                 @release
                                 (.unlock ^java.util.concurrent.locks.ReentrantLock lock))]
            @held
            (let [before (snippets)
                  start  (System/currentTimeMillis)
                  cs     (js {:prefix "js/process.ver" :ns "cljs.user"})]
              (is (empty? cs))
              (is (< (- (System/currentTimeMillis) start) 1500))
              (deliver release true)
              @compile
              (Thread/sleep 300)
              (is (= before (snippets))))))
        (testing "a completion's evaluation doesn't wait for a compile that started after it, past its deadline"
          (let [lock     ^java.util.concurrent.locks.ReentrantLock (:lock @@#'repl/build)
                snippets #(deref @#'repl/snippets)
                held     (promise)
                release  (promise)
                compile  (future (.lock lock) (deliver held true) @release (.unlock lock))]
            @held
            (let [before (snippets)
                  start  (System/currentTimeMillis)
                  ;; as a completion's evaluation that passed its compiling?
                  ;; check before the compile took the lock
                  r      (binding [repl/*deadline* (+ start 300)]
                           (repl/cljs-eval "(+ 1 2)"))]
              (is (= "Timed out waiting for a compile" (:error r)))
              (is (< (- (System/currentTimeMillis) start) 1500))
              (deliver release true)
              @compile
              (Thread/sleep 300)
              (is (= before (snippets)) "nothing compiled after the compile"))))
        (testing "a runtime that doesn't answer in time doesn't hold up the compiler environment's completions"
          (let [start (System/currentTimeMillis)
                ;; the runtime is busy evaluating this for 3s
                busy  (future (repl/cljs-eval "(let [t (+ (js/Date.now) 3000)] (while (< (js/Date.now) t)))"))
                _     (Thread/sleep 200)
                cs    (js {:prefix "call-" :ns "esm-repl.app"})]
            (is (contains? cs "call-g"))
            (is (< (- (System/currentTimeMillis) start) 2500))
            @busy))
        (testing "the runtime's introspection state is forgotten when it disconnects"
          (is (some? (#'repl/runtime-data 1 ::repl.nrepl/introspection)))
          (repl/handle-message! (json/write-str {:op "hello" :runtime 7 :url "other"}))
          (repl/update-runtime-data! 7 ::repl.nrepl/introspection (constantly :x))
          (repl/handle-message! (json/write-str {:op "bye" :runtime 7}))
          (repl/handle-message! (json/write-str {:op "hello" :runtime 7 :url "other"}))
          (is (nil? (#'repl/runtime-data 7 ::repl.nrepl/introspection)))
          (repl/handle-message! (json/write-str {:op "bye" :runtime 7})))
        (testing "info"
          (let [{:keys [name ns file]} (send {:op "info" :sym "call-g" :ns "esm-repl.app"})]
            (is (= ["call-g" "esm-repl.app"] [name ns]))
            (is (string/ends-with? file "esm_repl/app.cljs"))))
        (testing "during a compile, the compiler environment the last compile left"
          (repl/cljs-eval "(def snapshot-test 1)")
          (let [lock    ^java.util.concurrent.locks.ReentrantLock (:lock @@#'repl/build)
                held    (promise)
                release (promise)
                compile (future (.lock lock) (deliver held true) @release (.unlock lock))]
            @held
            (try
              (is (some? (get-in (repl/compiler-env-snapshot) [:cljs.analyzer/namespaces 'cljs.user :defs 'snapshot-test])))
              (finally
                (deliver release true)
                @compile))))
        (testing "macroexpansion, in a copy of the compiler environment"
          (let [before (repl/compiler-env-snapshot)]
            (is (= "(if 1 (do 2))" (:expansion (send {:op "macroexpand" :code "(when 1 2)" :ns "esm-repl.app"}))))
            (is (identical? before (repl/compiler-env-snapshot)))))
        (send ":cljs/quit")))))
