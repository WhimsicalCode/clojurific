;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

(ns cljs.esm-repl-tests
  "The REPL of cljs.esm builds: forms compiled in REPL mode, and evaluated
  by the REPL runtime under Node.js."
  (:require [cljs.analyzer :as ana]
            [cljs.compiler :as comp]
            [cljs.env :as env]
            [cljs.esm :as esm]
            [cljs.esm.repl :as repl]
            [cljs.vendor.clojure.data.json :as json]
            [clojure.java.io :as io]
            [clojure.string :as string]
            [clojure.test :refer [deftest is testing use-fixtures]])
  (:import [java.io BufferedReader File InputStreamReader]
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
        (is (string/includes? out "import \"../cljs/esm/repl_runtime.js\";"))))))

;; The REPL runtime under Node.js, messages are JSON lines on its stdin and
;; stdout.

(def ^:private node-harness
  "import * as runtime from './out/cljs/esm/repl_runtime.js';
   import './out/esm_repl/app.js';
   import readline from 'node:readline';
   // stdout is the REPL's
   console.log = console.error;
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

(defn- with-node-runtime [f]
  (let [dir  (temp-dir)
        opts (build-opts dir)
        cenv (env/default-compiler-env (merge esm/default-opts opts))
        build! #(do (esm/build opts cenv)
                    {:type "compiled" :warnings []})]
    (build!)
    (let [{:keys [proc send!]} (start-node! dir)]
      (try
        (repl/start! {:compiler-env cenv
                      :options      (:options @cenv)
                      :lock         (ReentrantLock.)
                      :compile!     (fn [_] (build!))
                      :warnings     (atom {})
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
         (map #(dissoc % :focused-at) (repl/runtimes))))
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
  (testing "no such runtime"
    (is (= "No runtime 5, see (cljs.esm.repl/runtimes)" (:error (repl/cljs-eval "1" {:runtime-id 5}))))))
