;; The Clojars artifact com.whimsical/clojurific: the compiler's sources, with
;; a pom of the fork's dependencies without test.check and with a current
;; Clojure. Its version is the npm package's, whose launcher depends on it.
;; Run by script/clojars:
;;
;;   jar             writes builds/clojars/clojurific-<version>.jar and its pom
;;   install <repo>  installs the jar into the local Maven repository <repo>
;;   deploy          deploys the jar to Clojars, as CLOJARS_USERNAME with the
;;                   deploy token CLOJARS_PASSWORD

(require '[clojure.edn :as edn]
         '[clojure.tools.build.api :as b]
         '[deps-deploy.deps-deploy :as dd])

(def lib 'com.whimsical/clojurific)

(def version
  (second (re-find #"\"version\"\s*:\s*\"([^\"]+)\"" (slurp "src/main/js/package.json"))))

(def paths ["src/main/clojure" "src/main/cljs"])

(def deps
  (-> (:deps (edn/read-string (slurp "deps.edn")))
      (dissoc 'org.clojure/test.check)
      (assoc 'org.clojure/clojure {:mvn/version "1.12.6"})))

(def class-dir "builds/clojars/classes")

(def jar-file (format "builds/clojars/clojurific-%s.jar" version))

(defn basis [extra]
  (b/create-basis {:user nil :project (merge {:paths paths :deps deps} extra)}))

(defn jar []
  (b/delete {:path "builds/clojars"})
  (b/write-pom {:class-dir class-dir
                ;; not upstream's pom.xml, the default template
                :src-pom "builds/clojars/no-template.xml"
                :lib lib
                :version version
                :basis (basis nil)
                :src-dirs []
                :scm {:url "https://github.com/WhimsicalCode/clojurific"
                      :connection "scm:git:https://github.com/WhimsicalCode/clojurific.git"
                      :tag (str "v" version)}
                :pom-data [[:description "ClojureScript compiled to ES modules, bundled by Vite"]
                           [:url "https://github.com/WhimsicalCode/clojurific"]
                           [:licenses
                            [:license
                             [:name "Eclipse Public License 1.0"]
                             [:url "https://opensource.org/license/epl-1-0/"]]]]})
  (b/copy-dir {:src-dirs ["src/main"] :target-dir "builds/clojars/src"})
  (let [{:keys [exit err]} (b/process {:command-args ["script/stamp-version" "builds/clojars/src" version]
                                       :err :capture})]
    (when-not (zero? exit)
      (throw (ex-info (str "script/stamp-version failed: " err) {}))))
  (b/copy-dir {:src-dirs ["builds/clojars/src/clojure" "builds/clojars/src/cljs"] :target-dir class-dir})
  (b/jar {:class-dir class-dir :jar-file jar-file})
  (println "Wrote" jar-file))

(defn install [repo]
  (b/install {:basis (basis {:mvn/local-repo repo})
              :lib lib
              :version version
              :jar-file jar-file
              :class-dir class-dir})
  (println "Installed" lib version "into" repo))

(defn deploy []
  (dd/deploy {:installer :remote
              :artifact jar-file
              :pom-file (b/pom-path {:lib lib :class-dir class-dir})}))

(let [[command repo] *command-line-args*]
  (case command
    "jar"     (jar)
    "install" (do (jar) (install repo))
    "deploy"  (do (jar) (deploy))
    (do (println "Usage: script/clojars jar | install <local-repo> | deploy")
        (System/exit 2)))
  (shutdown-agents))
