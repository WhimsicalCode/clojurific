;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

(ns cljs.esm
  "Compiles ClojureScript to ES modules, one module per namespace, without
  the Google Closure Compiler. npm packages and relative JavaScript /
  TypeScript files required with string requires are emitted as plain
  imports, resolving and bundling is left to a bundler such as Vite."
  (:require [cljs.analyzer :as ana]
            [cljs.compiler :as comp]
            [cljs.env :as env]
            [cljs.js-deps :as deps]
            [cljs.util :as util]
            [cljs.vendor.clojure.data.json :as json]
            [clojure.edn :as edn]
            [clojure.java.io :as io]
            [clojure.string :as string])
  (:import [java.io File]
           [java.net URL]
           [java.util.concurrent Executors Future LinkedBlockingQueue]))

(def default-opts
  {:module-format  :esm
   :optimizations  :none
   :output-dir     "out"
   :language-out   :es2020
   :static-fns     true
   :cache-analysis true
   :source-map     true})

(def goog-shims
  "The subset of the Closure Library cljs.core and friends depend on,
  reimplemented as ES modules. Paths are relative to the output directory and
  the cljs/esm resource directory."
  ["goog.js"
   "goog/array.js"
   "goog/math.js"
   "goog/object.js"
   "goog/string.js"
   "goog/userAgent/product.js"])

(def ^:dynamic *generated-sources*
  "Generated namespaces of the build, {ns File}, see :test-runner."
  {})

(defn- source-for-ns
  "Returns the URL of the ClojureScript source of namespace ns on the
  classpath, nil if ns isn't a ClojureScript namespace."
  ^URL [ns]
  (if-let [^File f (get *generated-sources* ns)]
    (.toURL (.toURI f))
    (util/ns->source ns)))

(defn- jar-url? [^URL url]
  (= "jar" (.getProtocol url)))

(defn- source-file
  "Returns a File for a source URL. Sources in jars are copied to the output
  directory, like cljs.closure does."
  ^File [^URL url ns output-dir]
  (if (jar-url? url)
    (let [ext  (util/ext url)
          file (io/file output-dir (util/ns->relpath ns ext))]
      (when (or (not (.exists file))
                (< (.lastModified file) (util/last-modified url)))
        (util/mkdirs file)
        (with-open [in (io/input-stream url)]
          (io/copy in file)))
      file)
    (io/file url)))

(def ^:private parse-ns-cache (atom {}))

(defn- parse-ns
  "ana/parse-ns, cached by file and modification time, the watcher finds
  sources on every change."
  [^File file]
  (let [k [(.getPath file) (.lastModified file)]]
    (or (get @parse-ns-cache k)
        (let [ns-info (ana/parse-ns file)]
          (swap! parse-ns-cache assoc k ns-info)
          ns-info))))

(defn- mains [{:keys [main preloads]}]
  (concat preloads (if (coll? main) main [main])))

(defn find-sources
  "Returns the parsed ns info of namespaces and their transitive ClojureScript
  dependencies in dependency order."
  [namespaces {:keys [output-dir]}]
  (letfn [(visit [{:keys [seen order] :as state} ns]
            (if (contains? seen ns)
              state
              (if-let [url (source-for-ns ns)]
                (let [file    (source-file url ns output-dir)
                      ns-info (parse-ns file)
                      state   (reduce visit
                                (update state :seen conj ns)
                                (->> (:requires ns-info)
                                     (remove string?)
                                     (map symbol)
                                     (cons 'cljs.core)
                                     (remove #{ns})))]
                  (update state :order conj (assoc ns-info :source-file file)))
                (update state :seen conj ns))))]
    (:order (reduce visit {:seen #{} :order []} (map symbol namespaces)))))

(defn- output-file ^File [ns {:keys [output-dir]}]
  (io/file output-dir (util/ns->relpath ns :js)))

(defn- install-goog-shims [{:keys [output-dir]}]
  (doseq [path goog-shims]
    (let [res  (io/resource (str "cljs/esm/" path))
          dest (io/file output-dir path)]
      (when (or (not (.exists dest))
                (not= (slurp res) (slurp dest)))
        (util/mkdirs dest)
        (spit dest (slurp res))))))

(defn- spit-if-changed [^File f content]
  (when (or (not (.exists f)) (not= content (slurp f)))
    (util/mkdirs f)
    (spit f content)))

(defn- relative-import
  "Import path of file to from file from, both relative to the output dir."
  [from to]
  (let [rel (-> (.relativize (.toPath (.getParentFile (io/file "/" from))) (.toPath (io/file "/" to)))
                str
                (string/replace File/separator "/"))]
    (if (string/starts-with? rel ".") rel (str "./" rel))))

(def ^:private goog-base "goog-lib/goog/base.js")

(defn- goog-base-module
  "Closure Library's base.js as an ES module exporting goog, also installed as
  the global goog Closure Library code expects. The debug loader is disabled,
  dependencies are loaded by imports."
  []
  (let [src (slurp (io/resource "goog/base.js"))]
    (str "// Closure Library base.js as an ES module, see cljs.esm/install-goog-libs\n"
         "globalThis.CLOSURE_NO_DEPS = true;\n"
         "globalThis.CLOSURE_DEFINES = Object.assign({'goog.ENABLE_DEBUG_LOADER': false}, globalThis.CLOSURE_DEFINES);\n"
         (-> src
             (string/replace #"(?m)^var COMPILED = false;" "var COMPILED = false; // eslint-disable-line")
             (string/replace #"(?m)^var goog = goog \|\| \{\};" "var goog = {};")
             (string/replace #"(?m)^goog\.global =\s*[^;]*;" "goog.global = globalThis;"))
         ;; base.js isn't strict mode, ES modules are: uids of non-extensible
         ;; objects can't be properties, see cljs/esm/goog.js
         "\nconst frozenUids = new WeakMap();\n"
         "const getUid = goog.getUid;\n"
         "goog.getUid = function(obj) {\n"
         "  if (Object.isExtensible(obj) || Object.prototype.hasOwnProperty.call(obj, goog.UID_PROPERTY_)) return getUid(obj);\n"
         "  let uid = frozenUids.get(obj);\n"
         "  if (uid === undefined) frozenUids.set(obj, (uid = ++goog.uidCounter_));\n"
         "  return uid;\n"
         "};\n"
         "if (goog.getHashCode) goog.getHashCode = goog.getUid;\n"
         "\nglobalThis.goog = goog;\nexport { goog };\n")))

(defn- goog-file-module
  "A Closure Library file as an ES module importing the files providing its
  requires, goog.module files are run by goog.loadModule."
  [lib {:keys [file requires module]}]
  (let [src     (slurp (io/resource file))
        out     (str "goog-lib/" file)
        imports (->> requires
                     (keep #(:file (lib %)))
                     (remove #{file "goog/base.js"})
                     distinct)]
    (str "import { goog } from \"" (relative-import out goog-base) "\";\n"
         (apply str (map #(str "import \"" (relative-import out (str "goog-lib/" %)) "\";\n") imports))
         (if (= :goog module)
           (str "goog.loadModule(function(exports) {'use strict';\n" src "\n;return exports;});\n")
           src))))

(defn install-goog-libs
  "Writes the Closure Library namespaces used without an ES module shim
  (recorded by the compiler as :cljs.esm/goog-libs) and the files they depend
  on as ES modules run by Closure Library's base.js. goog-lib/ns/<ns>.js
  default exports namespace ns."
  [compiler-env {:keys [output-dir]}]
  (let [idx  (:js-dependency-index @compiler-env)
        lib  #(deps/closure-lib idx %)
        nses (::goog-libs @compiler-env)]
    (when (seq nses)
      (let [files (loop [queue (vec (keep lib nses)) seen {}]
                    (if-let [{:keys [file requires] :as info} (first queue)]
                      (if (or (contains? seen file) (= "goog/base.js" file))
                        (recur (subvec queue 1) seen)
                        (recur (into (subvec queue 1) (keep lib requires))
                          (assoc seen file info)))
                      (vals seen)))]
        (spit-if-changed (io/file output-dir goog-base) (goog-base-module))
        (doseq [info files]
          (spit-if-changed (io/file output-dir "goog-lib" (:file info)) (goog-file-module lib info)))
        (doseq [ns nses]
          (when-let [{:keys [file]} (lib ns)]
            (let [out (comp/esm-goog-lib-path ns)]
              (spit-if-changed (io/file output-dir out)
                (str "import { goog } from \"" (relative-import out goog-base) "\";\n"
                     (when-not (= "goog/base.js" file)
                       (str "import \"" (relative-import out (str "goog-lib/" file)) "\";\n"))
                     "export default goog.module.get(\"" ns "\");\n")))))))))

(defn- write-package-json
  "Marks the output directory as ES modules for Node.js."
  [{:keys [output-dir]}]
  (let [f (io/file output-dir "package.json")]
    (when-not (.exists f)
      (util/mkdirs f)
      (spit f (json/write-str {:type "module"})))))

(defn- write-build-info
  "Writes cljs-esm.json to the output directory: the modules of the main
  namespaces, the build's entry points for bundlers."
  [{:keys [output-dir main] :as opts}]
  (spit-if-changed (io/file output-dir "cljs-esm.json")
    (json/write-str
      {:main (into (sorted-map)
               (map (fn [ns] [(str ns) (util/ns->relpath (symbol ns) :js)]))
               (if (coll? main) main [main]))
       :mode (some-> (:mode opts) name)})))

(defn- normalize-closure-defines
  "Normalizes :closure-defines keys to the munged names goog-define vars are
  looked up by."
  [defines]
  (into {}
    (map (fn [[k v]]
           [(if (or (symbol? k) (keyword? k))
              (str (comp/munge (symbol (namespace k) (name k))))
              k)
            v]))
    defines))

(defn- compile-ns
  "Compiles a namespace if its output isn't up to date. Up to date namespaces
  aren't analyzed by compile-file: reads their analysis (from the analysis
  cache), or each of their dependents, compiled in parallel, would analyze
  them concurrently."
  [{:keys [ns source-file]} opts]
  (let [ret (comp/compile-file source-file (output-file ns opts) opts)]
    (when-not (get-in @env/*compiler* [::ana/namespaces ns :defs])
      (if (= 'cljs.core ns)
        (comp/with-core-cljs opts (fn []))
        (ana/analyze-file source-file opts)))
    ret))

(defn- compile-parallel
  "Compiles inputs (in dependency order) with a pool of threads, a namespace
  is compiled once all its dependencies have been."
  [inputs opts]
  (let [threads (or (:parallel-build-threads opts)
                    (.availableProcessors (Runtime/getRuntime)))
        pool    (Executors/newFixedThreadPool threads)
        futures (atom {})]
    (try
      (doseq [{:keys [ns requires] :as input} inputs]
        (let [deps (keep #(get @futures (symbol %)) (remove string? requires))
              f    (.submit pool
                     ^Callable
                     (bound-fn []
                       (doseq [^Future d deps] (.get d))
                       (compile-ns input opts)))]
          (swap! futures assoc ns f)))
      (doseq [^Future f (vals @futures)]
        (.get f))
      (finally
        (.shutdown pool)))))

(defn- ensure-analyzed!
  "Namespaces up to date aren't recompiled, nor analyzed. Reads their
  analysis (from the analysis cache) so that the compiler environment
  describes the whole build, for build hooks and the watcher."
  [compiler-env inputs opts]
  (doseq [{:keys [ns source-file]} inputs]
    (when-not (get-in @compiler-env [::ana/namespaces ns :name])
      (ana/analyze-file source-file opts))))

(defn- run-hooks!
  "Calls the :build-hooks, [fn-sym & args], with the build and args. The
  build is a map of :compiler-env (a value), :namespaces (in dependency
  order), :mode and :options."
  [compiler-env inputs opts]
  (doseq [[f & args] (:build-hooks opts)]
    (apply (requiring-resolve f)
      {:compiler-env @compiler-env
       :namespaces   (mapv :ns inputs)
       :mode         (:mode opts)
       :options      opts}
      args)))

(defn- cljs-warnings
  "The analyzer's warnings with the :warnings option applied, like
  cljs.closure: a map of warning types, or a boolean toggling the undeclared
  var and namespace warnings. Closure namespace munging doesn't happen under
  ES module output."
  [{:keys [warnings] :or {warnings true}}]
  (-> ana/*cljs-warnings*
      (merge (if (map? warnings)
               warnings
               (zipmap [:unprovided :undeclared-var :undeclared-ns :undeclared-ns-form]
                 (repeat (boolean warnings)))))
      (assoc :munged-namespace false)))

(defn- prepare-opts [opts]
  (-> (merge default-opts opts)
      (update :closure-defines normalize-closure-defines)
      ;; the generated test runner is a main namespace
      (cond-> (:test-runner opts)
        (update :main #(vec (distinct (conj (if (coll? %) (vec %) (if % [%] [])) (-> opts :test-runner :ns))))))))

(declare watch-dirs source-files)

(defn- test-namespaces
  "The ClojureScript namespaces in the source directories matching regexp,
  sorted."
  [regexp opts]
  (->> (source-files (watch-dirs opts))
       keys
       (filter #(re-find #"\.clj[sc]$" %))
       (keep #(try (:ns (parse-ns (io/file %))) (catch Throwable _ nil)))
       (filter #(re-find (re-pattern regexp) (str %)))
       distinct
       sort))

(defn- generate-test-runner
  "Writes the :test-runner namespace, requiring the test namespaces matching
  :ns-regexp (default -test$) and calling (runner run-tests) with a fn running
  them, given a cljs.test env. Returns {ns File}."
  [{{:keys [ns ns-regexp runner] :or {ns-regexp "-test$"}} :test-runner :keys [output-dir] :as opts}]
  (let [nses (test-namespaces ns-regexp opts)
        file (io/file output-dir "cljs-esm-gen" (util/ns->relpath ns :cljs))
        env  (gensym "env")]
    (util/mkdirs file)
    (spit-if-changed file
      (with-out-str
        (prn (list* 'ns ns
               "Generated by cljs.esm (:test-runner), runs the test namespaces."
               [(list* :require ['cljs.test] [(symbol (namespace runner))] (map vector nses))]))
        (prn (list runner
               (list 'fn [env]
                 (list* 'cljs.test/run-tests env (map #(list 'quote %) nses)))))))
    {ns file}))

(defn build
  "Compiles the namespaces in :main (a symbol or a collection of symbols) and
  their dependencies to ES modules in :output-dir. Returns the compiled
  namespaces in dependency order.

  :test-runner {:ns my.test-runner :ns-regexp \"-test$\" :runner my.test/start}
  generates (and compiles) namespace my.test-runner, requiring the test
  namespaces of the source directories, calling (my.test/start run-tests)."
  ([opts]
   (build opts (env/default-compiler-env (merge default-opts opts))))
  ([opts compiler-env]
   (let [opts (prepare-opts opts)]
     (binding [ana/*cljs-warnings* (cljs-warnings opts)
               *generated-sources* (if (:test-runner opts)
                                     (generate-test-runner opts)
                                     *generated-sources*)]
       (env/with-compiler-env compiler-env
         (swap! compiler-env assoc :options opts)
         (let [start  (System/nanoTime)
               inputs (find-sources (mains opts) opts)]
           ;; lets the compiler know which namespaces are part of the build
           ;; before they're analyzed
           (swap! compiler-env assoc ::namespaces (into #{} (map :ns) inputs))
           (swap! compiler-env update ::ana/data-readers merge (ana/load-data-readers))
           (write-build-info opts)
           ;; cljs.core is analyzed first, the compiler expects its analysis
           ;; to be available when compiling anything else
           (compile-ns (first (filter #(= 'cljs.core (:ns %)) inputs)) opts)
           (let [others (remove #(= 'cljs.core (:ns %)) inputs)]
             (if (:parallel-build opts)
               (compile-parallel others opts)
               (doseq [input others]
                 (compile-ns input opts))))
           (install-goog-shims opts)
           (install-goog-libs compiler-env opts)
           (write-package-json opts)
           (when (seq (:build-hooks opts))
             (ensure-analyzed! compiler-env inputs opts)
             (run-hooks! compiler-env inputs opts))
           (when (:verbose opts)
             (util/debug-prn
               (format "Compiled %d namespaces in %.1fs" (count inputs)
                 (/ (- (System/nanoTime) start) 1e9))))
           (map :ns inputs)))))))

(defn- event!
  "Prints a build event as a JSON line, consumed by the Vite plugin."
  [type m]
  (locking *out*
    (println (str "[cljs.esm] " (json/write-str (assoc m :type type))))
    (flush)))

(defn- error-data [^Throwable e]
  (let [data  (ex-data (or (ex-cause e) e))
        cause (loop [e e] (if-let [c (ex-cause e)] (recur c) e))]
    {:message (.getMessage cause)
     :file    (or (:file data) (:clojure.error/source data))
     :line    (or (:line data) (:clojure.error/line data))
     :column  (or (:column data) (:clojure.error/column data))}))

(defn- source-files
  "All ClojureScript and Clojure (macro) files in dirs with their
  modification time."
  [dirs]
  (into {}
    (comp
      (mapcat #(file-seq (io/file %)))
      (filter #(.isFile ^File %))
      (filter #(re-find #"\.(cljs|cljc|clj)$" (.getName ^File %)))
      (map (fn [^File f] [(.getCanonicalPath f) (.lastModified f)])))
    dirs))

(defn- api
  "The parts of a namespace's analysis its dependents' compiled output
  depends on, i.e. arities of fns invoked directly under :static-fns."
  [compiler-env ns]
  (into {}
    (map (fn [[sym v]]
           [sym (-> (select-keys v [:fn-var :variadic? :max-fixed-arity :dynamic
                                    :protocol-symbol :protocol])
                    ;; arities, param names differ between compiles (gensyms)
                    (assoc :arities (map count (:method-params v))))]))
    (get-in @compiler-env [::ana/namespaces ns :defs])))

(defn- dependents
  "Namespaces of the build directly requiring any of nses."
  [compiler-env nses]
  (let [nses (set nses)]
    (->> (vals (::ana/namespaces @compiler-env))
         (filter (fn [{:keys [requires uses]}]
                   (some nses (concat (vals requires) (vals uses)))))
         (map :name))))

(defn- macro-dependents
  "Namespaces of the build using macros of any of macro-nses."
  [compiler-env macro-nses]
  (let [macro-nses (set macro-nses)]
    (->> (vals (::ana/namespaces @compiler-env))
         (filter (fn [{:keys [require-macros use-macros]}]
                   (some macro-nses (concat (vals require-macros) (vals use-macros)))))
         (map :name))))

(defn- file-ns
  "The namespace declared by a Clojure or ClojureScript file."
  [^File f]
  (try
    (:ns (ana/parse-ns f))
    (catch Throwable _ nil)))

(defn- recompile!
  "Recompiles namespaces nses (and their dependents if their API changed),
  returns the namespaces compiled."
  [compiler-env inputs nses opts]
  (let [by-ns (into {} (map (juxt :ns identity)) inputs)]
    (loop [queue (vec nses) done #{}]
      (if-let [ns (first queue)]
        (if (or (contains? done ns) (nil? (by-ns ns)))
          (recur (subvec queue 1) done)
          (let [before (api compiler-env ns)]
            (compile-ns (by-ns ns) (assoc opts :force true))
            (let [changed? (not= before (api compiler-env ns))]
              (recur (cond-> (subvec queue 1)
                       changed? (into (dependents compiler-env [ns])))
                (conj done ns)))))
        done))))

(defn- resource-refs
  "Classpath resources namespaces depend on, {path #{ns}}. Macros record
  them as {path last-modified} under :cljs.esm/resource-refs of the
  namespace being compiled, see watch-resource!."
  [compiler-env]
  (reduce-kv
    (fn [m ns {:keys [::resource-refs]}]
      (reduce (fn [m path] (update m path (fnil conj #{}) ns)) m (keys resource-refs)))
    {}
    (::ana/namespaces @compiler-env)))

(defn- resource-mtimes [refs]
  (into {}
    (keep (fn [path]
            (when-let [res (io/resource path)]
              [path (util/last-modified res)])))
    (keys refs)))

(defn watch-resource!
  "For macros: records that the namespace being compiled depends on the
  classpath resource at path, the watcher recompiles the namespace when the
  resource changes."
  [env path]
  (when env/*compiler*
    (let [res (or (io/resource path)
                  (throw (ana/error env (str "Resource not found: " path))))]
      (swap! env/*compiler* assoc-in
        [::ana/namespaces (-> env :ns :name) ::resource-refs path]
        (util/last-modified res)))))

(defn- resource-root
  "The classpath directory resource path is in, nil if it isn't in one."
  [path]
  (when-let [res (io/resource path)]
    (when (= "file" (.getProtocol ^URL res))
      (let [file (.getCanonicalPath (io/file res))]
        (subs file 0 (- (count file) (count path) 1))))))

(defn- watch-dirs
  "Directories with sources to watch, :watch-dirs or the classpath
  directories, without the output directory and the compiler's own sources:
  a changed compiler needs a new watcher, reloading it in place doesn't
  work."
  [{:keys [output-dir] :as opts}]
  (let [output   (.getCanonicalPath (io/file output-dir))
        compiler (set (keep resource-root ["cljs/compiler.cljc" "cljs/core.cljs"]))]
    (->> (or (:watch-dirs opts)
             (string/split (System/getProperty "java.class.path") #":"))
         (map io/file)
         (filter #(.isDirectory ^File %))
         (map #(.getCanonicalPath ^File %))
         (remove #(or (= output %) (string/starts-with? output (str % File/separator))))
         (remove compiler)
         distinct)))

(defn- start-stdin-reader!
  "Under :exit-with-parent, reads the parent's messages from stdin, puts
  the paths of `changed <path>` lines on queue, exits on EOF: the parent
  closes stdin when it exits, the watcher has to stop too."
  [^LinkedBlockingQueue queue]
  (doto (Thread. (fn []
                   (with-open [rdr (io/reader System/in)]
                     (doseq [^String line (line-seq rdr)]
                       (when (string/starts-with? line "changed ")
                         (.put queue (subs line 8)))))
                   (System/exit 0)))
    (.setDaemon true)
    (.start)))

(defn- poll-changes
  "Polls dirs for changed source files, returns [changed files']."
  [dirs files]
  (Thread/sleep 100)
  (let [files' (source-files dirs)]
    [(keep (fn [[path mtime]]
             (when (not= mtime (get files path)) (io/file path)))
       files')
     files']))

(defn- next-changes
  "Blocks until the parent reports changed files (sources or resources),
  returns them, batching the changes reported within a moment of each
  other."
  [^LinkedBlockingQueue queue]
  (let [first-path (.take queue)]
    (Thread/sleep 50)
    (let [more (java.util.ArrayList.)]
      (.drainTo queue more)
      (map io/file (distinct (cons first-path more))))))

(defn watch
  "Builds like build, then recompiles namespaces as their sources change.
  With :watch-events :stdin, the parent process (the Vite plugin) watches
  the directories of the watch-dirs event and writes `changed <path>` lines
  to stdin, otherwise polls :watch-dirs (defaults to the classpath
  directories). Enables :esm-hmr, modules accept their own hot updates when
  served by Vite."
  [opts]
  (let [opts         (prepare-opts (merge {:esm-hmr true} opts))
        compiler-env (env/default-compiler-env opts)
        dirs         (watch-dirs opts)
        queue        (LinkedBlockingQueue.)
        stdin?       (= :stdin (:watch-events opts))
        build!       (fn []
                       (let [start (System/nanoTime)
                             nses  (build opts compiler-env)]
                         ;; the watcher needs the analysis of the whole build
                         (env/with-compiler-env compiler-env
                           (ensure-analyzed! compiler-env (find-sources (mains opts) opts) opts))
                         (event! "compiled" {:namespaces (count nses)
                                             :ms (long (/ (- (System/nanoTime) start) 1e6))})))]
    (when (:exit-with-parent opts)
      (start-stdin-reader! queue))
    (event! "watch-dirs" {:dirs dirs})
    (try
      (build!)
      (catch Throwable e
        (event! "error" (error-data e))))
    (loop [files     (when-not stdin? (source-files dirs))
           resources (resource-mtimes (resource-refs compiler-env))]
      (let [[changed files'] (if stdin?
                               [(next-changes queue) nil]
                               (poll-changes dirs files))
            changed    (filter #(re-find #"\.(cljs|cljc|clj)$" (.getName ^File %)) changed)
            refs       (resource-refs compiler-env)
            resources' (resource-mtimes refs)
            ;; namespaces depending on changed resources
            res-nses   (mapcat (fn [[path mtime]]
                                 (when (and (contains? resources path) (not= mtime (get resources path)))
                                   (get refs path)))
                         resources')]
        (when (or (seq changed) (seq res-nses))
          (event! "compiling" {})
          (try
            (let [start  (System/nanoTime)
                  inputs (env/with-compiler-env compiler-env
                           (find-sources (mains opts) opts))
                  _      (swap! compiler-env assoc ::namespaces (into #{} (map :ns) inputs))
                  macros (keep #(when (re-find #"\.clj[c]?$" (.getName ^File %)) (file-ns %)) changed)
                  _      (doseq [ns macros]
                           (when (find-ns ns)
                             (require ns :reload)))
                  cljs   (keep #(when (re-find #"\.clj[sc]$" (.getName ^File %)) (file-ns %)) changed)
                  ;; namespaces newly required by a changed namespace
                  fresh  (remove #(get-in @compiler-env [::ana/namespaces % :name]) (map :ns inputs))
                  done   (env/with-compiler-env compiler-env
                           (binding [ana/*cljs-warning-handlers* ana/*cljs-warning-handlers*
                                     ana/*cljs-warnings*         (cljs-warnings opts)]
                             (recompile! compiler-env inputs
                               (distinct (concat fresh cljs res-nses (macro-dependents compiler-env macros)))
                               opts)))]
              (install-goog-libs compiler-env opts)
              (env/with-compiler-env compiler-env
                (run-hooks! compiler-env inputs opts))
              (event! "compiled" {:namespaces (count done)
                                  :files (map #(.getPath (output-file % opts)) (sort done))
                                  :ms (long (/ (- (System/nanoTime) start) 1e6))}))
            (catch Throwable e
              (event! "error" (error-data e)))))
        (recur files' resources')))))

(defn- deep-merge [& ms]
  (apply merge-with (fn [a b] (if (and (map? a) (map? b)) (deep-merge a b) b)) ms))

(defn load-options
  "Compiler options from command line arguments: @file.edn options files,
  :profile keywords and EDN maps. Profiles are maps under :profiles of the
  files, deep merged over them in order, EDN maps over the result. The
  profile names the build's :mode. Without a profile, default-profile."
  [args default-profile]
  (let [files    (keep #(when (string/starts-with? % "@") (edn/read-string (slurp (subs % 1)))) args)
        maps     (keep #(when (string/starts-with? % "{") (edn/read-string %)) args)
        profiles (or (seq (keep #(when (string/starts-with? % ":") (keyword (subs % 1))) args))
                     [default-profile])
        opts     (apply deep-merge files)]
    (-> (apply deep-merge
          (dissoc opts :profiles)
          (concat (map #(get-in opts [:profiles %]) profiles) maps))
        (assoc :mode (last profiles)))))

(defn -main
  "Usage: clojure -M -m cljs.esm [build|watch] options...

  Options are EDN maps, @file.edn and :profile keywords, see load-options.
  Watch defaults to the :dev profile, build to :release.

    clojure -M -m cljs.esm build '{:main my.app :output-dir \"out\"}'
    clojure -M -m cljs.esm watch @cljs.edn"
  [& args]
  (let [[command args] (if (#{"build" "watch"} (first args))
                         [(first args) (rest args)]
                         ["build" args])]
    (if (= "watch" command)
      (watch (merge {:verbose false} (load-options args :dev)))
      (do
        (build (merge {:verbose true} (load-options args :release)))
        (shutdown-agents)))))
