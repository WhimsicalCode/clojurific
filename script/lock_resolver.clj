;; Writes src/main/js/cljf/resolver.lock.json: the jars on the classpath of the
;; cljf launcher's resolver (clojurific.resolve, from resolver/deps.edn), which
;; the launcher downloads itself, since tools.deps can't download tools.deps.
;; Each jar's SHA-256 is of the jar downloaded from Maven Central, not the
;; local repository's copy or the repository's .sha1. Run from the resolver
;; directory by script/lock-resolver.

(require '[clojure.java.io :as io]
         '[clojure.string :as string]
         '[clojure.tools.deps :as deps])

(def repository "https://repo1.maven.org/maven2")

(def out "../resolver.lock.json")

(defn jar-path [lib version]
  (let [group    (string/replace (namespace lib) "." "/")
        artifact (name lib)]
    (str group "/" artifact "/" version "/" artifact "-" version ".jar")))

(defn sha256-and-size [url]
  (let [digest (java.security.MessageDigest/getInstance "SHA-256")
        buf    (byte-array 65536)]
    (with-open [in (io/input-stream (java.net.URL. url))]
      (loop [size 0]
        (let [n (.read in buf)]
          (if (neg? n)
            [(apply str (map #(format "%02x" %) (.digest digest))) size]
            (do (.update digest buf 0 n)
                (recur (+ size n)))))))))

(defn json-string [s]
  (str \" (string/escape s {\" "\\\"" \\ "\\\\"}) \"))

(let [basis (deps/create-basis {:user nil})
      jars  (for [[lib {:keys [mvn/version]}] (sort-by key (:libs basis))]
              (do (assert version (str lib " isn't a Maven dependency"))
                  (let [path        (jar-path lib version)
                        [sha256 size] (sha256-and-size (str repository "/" path))]
                    {:lib (str lib) :version version :path path :sha256 sha256 :size size})))
      jars  (doall jars)]
  (spit out
    (str "{\n"
         "  \"repository\": " (json-string repository) ",\n"
         "  \"jars\": [\n"
         (string/join ",\n"
           (for [{:keys [lib version path sha256 size]} jars]
             (str "    {\"lib\": " (json-string lib) ", \"version\": " (json-string version)
                  ", \"path\": " (json-string path) ", \"sha256\": " (json-string sha256)
                  ", \"size\": " size "}")))
         "\n  ]\n}\n"))
  (println "Wrote" (count jars) "jars," (format "%.1f MB," (/ (reduce + (map :size jars)) 1e6)) "to"
           (.getCanonicalPath (io/file out)))
  (shutdown-agents))
