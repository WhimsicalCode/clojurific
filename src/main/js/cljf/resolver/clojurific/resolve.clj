;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

(ns clojurific.resolve
  "Resolves a project's classpath with tools.deps for the cljf launcher
  (cljf/launcher.js), the compiler added and stock ClojureScript removed.

  Run in the project's directory with the path of an EDN file of options:

    :aliases          the project's aliases to apply, keywords
    :compiler         the compiler's coordinate, added unless the project
                      lists com.whimsical/clojurific itself
    :no-clojurescript the coordinate replacing every org.clojure/clojurescript
    :output           the JSON file to write: {classpath, jvmOpts, manifests},
                      manifests are the deps.edn files the classpath depends on"
  (:require [clojure.java.io :as io]
            [clojure.string :as string]
            [clojure.tools.deps :as deps]
            [clojure.tools.deps.edn :as depsedn]))

(def compiler-lib 'com.whimsical/clojurific)

(defn- json [x]
  (cond
    (string? x)     (str \" (string/escape x {\" "\\\"" \\ "\\\\" \newline "\\n" \return "\\r" \tab "\\t"}) \")
    (map? x)        (str "{" (string/join "," (map (fn [[k v]] (str (json (name k)) ":" (json v))) x)) "}")
    (sequential? x) (str "[" (string/join "," (map json x)) "]")
    :else           (str x)))

(defn- argmap
  "The project's argmap for aliases, as create-basis merges it, and whether
  the project lists the compiler itself (in :deps or an alias' deps)."
  [aliases]
  (let [{:keys [root user project]} (depsedn/create-edn-maps {})
        alias-data (apply merge-with merge (keep :aliases [root user project]))
        undefined  (remove #(contains? alias-data %) aliases)
        argmap     (apply depsedn/merge-alias-maps (map alias-data aliases))
        merged     (depsedn/merge-edns [root user (deps/tool project argmap)])]
    (doseq [alias undefined]
      (binding [*out* *err*]
        (println "cljf: alias" alias "isn't defined in deps.edn")))
    {:argmap argmap
     :lists-compiler? (boolean (or (contains? (:deps merged) compiler-lib)
                                   (contains? (:extra-deps argmap) compiler-lib)))}))

(defn- manifests
  "The files the classpath was resolved from: the user's and the project's
  deps.edn and the manifests of local dependencies. Maven and git
  dependencies are immutable."
  [basis]
  (let [local (keep (fn [[_ {:keys [local/root]}]]
                      (when root
                        (let [f (io/file root)]
                          (if (.isFile f)
                            f
                            (some #(let [m (io/file f %)] (when (.exists m) m)) ["deps.edn" "pom.xml"])))))
                (:libs basis))]
    (->> (concat [(io/file (depsedn/user-deps-path)) (io/file "deps.edn")] local)
         (map #(.getCanonicalPath ^java.io.File %))
         distinct
         vec)))

(defn- git-missing? [^Throwable e]
  (some #(some-> (.getMessage ^Throwable %) (string/includes? "Cannot run program \"git\""))
        (take-while some? (iterate #(.getCause ^Throwable %) e))))

(defn -main [options-file]
  (try
    (let [{:keys [aliases compiler no-clojurescript output]} (read-string (slurp options-file))
          {:keys [argmap lists-compiler?]} (argmap aliases)
          basis (deps/create-basis
                  {:aliases aliases
                   :args (cond-> {:override-deps {'org.clojure/clojurescript no-clojurescript}}
                           (not lists-compiler?) (assoc :extra-deps {compiler-lib compiler}))})]
      (spit output (json {:classpath (:classpath-roots basis)
                          :jvmOpts   (vec (:jvm-opts argmap))
                          :manifests (manifests basis)}))
      (shutdown-agents)
      (System/exit 0))
    (catch Throwable e
      (binding [*out* *err*]
        (if (git-missing? e)
          (println "cljf: git dependencies need git, which isn't on PATH. Install git, or use Maven"
                   "or :local/root dependencies.")
          (println "cljf: resolving dependencies failed:"
                   (string/join ": " (distinct (keep #(.getMessage ^Throwable %)
                                                     (take-while some? (iterate #(.getCause ^Throwable %) e))))))))
      (System/exit 1))))
