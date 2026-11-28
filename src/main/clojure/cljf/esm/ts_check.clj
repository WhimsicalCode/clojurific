(ns cljf.esm.ts-check
  "Experimental :ts-check: type checks the JavaScript interop of a build's
  namespaces with TypeScript. The compiled modules of the project's own
  namespaces are copied into <output-dir>/.ts-check with every ClojureScript
  value typed any (imports of other compiled namespaces and top-level vars),
  so that only interop is checked: js/ globals, npm modules (typed by their
  packages), goog shims (typed by their .d.ts) and what values flow from
  them through locals. tsc checks the copies (checkJs, not strict) and its
  diagnostics are reported as :ts-check warnings at the ClojureScript
  position the output's source map gives.

  :ts-check {:tsconfig \"tsconfig.ts-check.json\"} extends the generated
  tsconfig with the project's: its compilerOptions (paths of packages the
  bundler aliases, types) apply, and the files its include and files name
  (declarations of globals pages load with script tags) are checked with the
  copies.

  :warnings {:ts-check :error} (or :warnings-as-errors) reports every
  diagnostic, then fails the build with their count, and fails a check that
  can't run (no tsc, a tsc failing without diagnostics)."
  (:require [cljs.analyzer :as ana]
            [cljs.source-map :as sm]
            [cljs.vendor.clojure.data.json :as json]
            [clojure.java.io :as io]
            [clojure.string :as string])
  (:import [java.io File]))

(def ^:private dir ".ts-check")

(def ^:private any-var
  "The prefix typing a top-level var any."
  "/** @type {any} */ ")

(defn- canonical ^String [f]
  (.getCanonicalPath (io/file f)))

(defn- check-source
  "The copy of output module js (its lines, one for one) tsc checks: imports
  of other compiled modules (inside the output directory, but not the goog
  shims) are any, as are top-level vars; relative imports of files outside
  the output directory are absolute; cljs-npm-as: imports (:npm-interop
  :shadow) import the package's namespace."
  [^File js output shims ^File core-dts]
  (let [parent (.getParentFile js)
        ;; cljs.core and its constants module typed by ts_check_core.d.ts
        core   {(canonical (io/file output "cljs/core.js"))           "Core"
                (canonical (io/file output "cljs/core/constants.js")) "Constants"}]
    (->> (string/split (slurp js) #"\n" -1)
         ;; :npm-interop :shadow's imports, which the Vite plugin resolves:
         ;; an ES module's namespace, its default export if that's all it
         ;; exports, a CommonJS module's module.exports, as TypeScript's
         ;; import types type them (export = for CommonJS)
         (map (fn [line]
                (if-let [[_ alias spec] (re-matches #"import ([\w$]+) from \"cljs-npm-as:([^\"]+)\";" line)]
                  (let [spec (if (string/starts-with? spec ".") (canonical (io/file parent spec)) spec)
                        m    (str "typeof import(" (json/write-str spec :escape-slash false) ")")]
                    (str "const " alias " = /** @type {[Exclude<keyof " m ", \"default\">] extends [never] ? ("
                         m " extends {default: infer D} ? D : " m ") : " m "} */ (null);"))
                  line)))
         (map (fn [line]
                (if-let [[_ star alias spec] (re-matches #"import (\* as )?([\w$]+) from \"(\.[^\"]*)\";" line)]
                  (let [target (canonical (io/file parent spec))]
                    (cond
                      (and star (core target))
                      (str "var " alias " = /** @type {import(" (json/write-str (canonical core-dts) :escape-slash false)
                           ")." (core target) "} */ (/** @type {any} */ (null));")

                      ;; another compiled namespace
                      (and star (string/starts-with? target (str output File/separator)) (not (shims target)))
                      (str "var " alias " = /** @type {any} */ (null);")
                      ;; a JavaScript file of the sources, from the copy's directory
                      (not (string/starts-with? target (str output File/separator)))
                      (str "import " star alias " from " (json/write-str target :escape-slash false) ";")
                      :else line))
                  (cond-> line
                    (string/starts-with? line "var ") (->> (str any-var))))))
         ;; only the copies are checked, not the JavaScript they import:
         ;; in place of the "Compiled by" comment, keeping lines
         (#(cons "// @ts-check" (rest %)))
         (string/join "\n"))))

(defn- find-tsc
  "The tsc of the :ts-check option's :tsc, else of the node_modules nearest
  to the output directory or the working directory."
  [{:keys [ts-check output-dir]}]
  (or (when-let [tsc (when (map? ts-check) (:tsc ts-check))]
        ;; tsc runs in <output-dir>/.ts-check: a path is the working
        ;; directory's, a bare name is looked up on the PATH
        (cond-> tsc (string/includes? tsc "/") canonical))
      (some (fn [start]
              (loop [d (io/file (canonical start))]
                (when d
                  (let [tsc (io/file d "node_modules/.bin/tsc")]
                    (if (.exists tsc) (.getPath tsc) (recur (.getParentFile d)))))))
        [output-dir "."])))

(def ^:private diagnostic
  #"^(?:(.+?)\((\d+),(\d+)\): )?error (TS\d+): (.*)$")

(defn- noise?
  "Diagnostics of the output's shape rather than of interop: properties
  ClojureScript adds (cljs$core$IFn$_invoke$arity$2, protocol methods),
  whose names are munged, and comma expressions the compiler emits for
  let-bound arguments."
  [{:keys [code message]}]
  (or (= "TS2695" code)
      (and (#{"TS2339" "TS2551"} code)
           (re-find #"^Property '[^']*\$[^']*' does not exist" message))))

(defn- source-position
  "The ClojureScript [line column] (1-based) of output js' 1-based line and
  column, from its source map: the last mapping at or before it on the line,
  the innermost form of those starting at the same column (an enclosing let
  and the call in it start where the call does)."
  [source-map line column]
  (when-let [segs (get source-map (dec line))]
    (when-let [[_ ms] (first (rsubseq segs <= (dec column)))]
      (let [{:keys [line col]} (peek ms)]
        [(inc line) (inc col)]))))

(defn diagnostics
  "Runs tsc over the build's inputs ({:ns :source-file}) whose sources are
  in source directories dirs: nil when none are, {:failed message} when the
  check can't run (no tsc, a tsc failing without diagnostics), else
  {:checked namespaces :diagnostics [{:message :ns :file :line :column}]},
  :ns and :file the ClojureScript namespace and source a diagnostic is of
  (nil for the tsconfig's), :line and :column its position there (nil when
  the source map has none, :message then names the output's). hold calls
  its fn while the outputs are copied, i.e. holding a watch's lock: tsc and
  the mapping run on the copies (and their source maps) after."
  ([inputs dirs opts output-file shims]
   (diagnostics inputs dirs opts output-file shims #(%)))
  ([inputs dirs {:keys [output-dir] :as opts} output-file shims hold]
  (let [output (canonical output-dir)
        root   (io/file output dir)
        shims  (into #{} (map #(canonical (io/file output %))) shims)
        own    (filter (fn [{:keys [source-file]}]
                         (and (instance? File source-file)
                              (some #(string/starts-with? (canonical source-file) (str % File/separator)) dirs)))
                 inputs)
        tsc    (find-tsc opts)]
    (cond
      (empty? own) nil

      (not tsc)
      {:failed ":ts-check needs TypeScript: no node_modules/.bin/tsc near the output directory, set :ts-check {:tsc path}"}

      :else
      (let [;; the copies, taken holding hold
            [checked config]
            (hold
              (fn []
                (let [core-dts (io/file root "cljs-core.d.ts")
                      _        (do (io/make-parents core-dts)
                                   (spit core-dts (slurp (io/resource "cljf/esm/ts_check_core.d.ts"))))
                      checked (into {}
                                (keep (fn [{:keys [ns source-file]}]
                                        (let [^File js (output-file ns opts)]
                                          (when (.exists js)
                                            (let [rel  (subs (canonical js) (inc (count output)))
                                                  copy (io/file root rel)]
                                              (io/make-parents copy)
                                              (spit copy (check-source js output shims core-dts))
                                              (let [m (io/file (str (.getPath js) ".map"))]
                                                (when (.exists m)
                                                  (io/copy m (io/file (str (.getPath copy) ".map")))))
                                              [(canonical copy) {:ns ns :js js :source-file source-file}])))))
                                own)
                      ;; not tsconfig.json, which Vite watches for, reloading pages
                      ;; when it changes
                      config  (io/file root "config.json")]
                  (spit config
                    (json/write-str
                      (cond-> {:compilerOptions {:allowJs true :checkJs false :noEmit true :strict false :skipLibCheck true
                                                 :target "es2022" :module "esnext" :moduleResolution "bundler"
                                                 :lib ["esnext" "dom" "dom.iterable"]
                                                 ;; the copies' relative imports of the goog shims
                                                 :rootDirs [".." "."]}
                               ;; with :tsconfig's include, which a tsconfig extending
                               ;; it keeps unless it sets one: its files are replaced
                               :files (conj (vec (sort (map #(subs % (inc (count (canonical root)))) (keys checked))))
                                             (.getName core-dts))}
                        (and (map? (:ts-check opts)) (:tsconfig (:ts-check opts)))
                        (assoc :extends (canonical (:tsconfig (:ts-check opts)))))
                      :escape-slash false))
                  [checked config])))
            [lines exit] (try
                           (let [proc  (-> (ProcessBuilder. ^java.util.List [tsc "-p" (.getName config) "--pretty" "false"])
                                           (.directory root)
                                           (.redirectErrorStream true)
                                           (.start))
                                 lines (with-open [r (io/reader (.getInputStream proc))] (vec (line-seq r)))]
                             [lines (.waitFor proc)])
                           (catch java.io.IOException e
                             [[(.getMessage e)] -1]))
            maps  (atom {})]
        ;; tsc exits 1 on the diagnostics noise? leaves out too, but one
        ;; that fails without any (a crash, a tsc that doesn't run) checked
        ;; nothing
        (if (and (not (zero? exit)) (not-any? #(re-matches diagnostic %) lines))
          {:failed (str ":ts-check: " tsc " failed:\n" (string/join "\n" lines))}
          {:checked     (mapv :ns (vals checked))
           :diagnostics
           (vec
             (for [l lines
                   :let [[_ file line col code message] (re-matches diagnostic l)]
                   :when (and code (not (noise? {:code code :message message})))]
               (let [path (some->> file (io/file root) canonical)
                     {:keys [ns ^File js source-file]} (checked path)
                     line (some-> line Long/parseLong)
                     col  (some-> col Long/parseLong)]
                 (cond
                   ;; tsconfig's: without a file, or of another file
                   (not file)
                   {:message (str code " " message)}

                   (not js)
                   {:message (str path ":" line ":" col " " code " " message)}

                   :else
                   (let [col  (cond-> col
                                (string/starts-with? (nth (string/split-lines (slurp (io/file path))) (dec line) "") any-var)
                                (- (count any-var)))
                         smap (or (get @maps js)
                                  (let [f (io/file (str path ".map"))
                                        m (when (.exists f) (sm/decode (json/read-str (slurp f) :key-fn keyword)))]
                                    (swap! maps assoc js m)
                                    m))
                         [sl sc] (some-> smap (source-position line col))]
                     {:ns      ns
                      :file    (str source-file)
                      :line    sl
                      :column  sc
                      :message (str code " " message
                                    (when-not sl (str " (" (.getName js) ":" line ":" col ")")))})))))}))))))

(defn check!
  "Runs :ts-check over the build's inputs ({:ns :source-file}) whose sources
  are in source directories dirs, reports tsc's diagnostics as :ts-check
  warnings."
  [inputs dirs opts output-file shims]
  (let [{:keys [failed diagnostics]} (diagnostics inputs dirs opts output-file shims)
        ;; :ts-check :error reports every diagnostic, then fails the build:
        ;; the analyzer's :error throws at the first. It fails a check that
        ;; can't run too, which is otherwise a warning.
        error? (= :error (:ts-check ana/*cljs-warnings*))]
    (if failed
      (if error?
        (throw (ex-info failed {}))
        (binding [*out* *err*] (println (str "WARNING: " failed))))
      (do
        (binding [ana/*cljs-warnings* (cond-> ana/*cljs-warnings* error? (assoc :ts-check :warning))]
          ;; not of the namespace (its output's warnings, which hold back
          ;; hot reload until it recompiles): a watch checks separately
          (doseq [{:keys [file line column message]} diagnostics]
            (binding [ana/*cljs-file* file]
              (ana/warning :ts-check (cond-> {} line (assoc :line line :column column)) {:message message}))))
        (when (and error? (seq diagnostics))
          (let [n (count diagnostics)]
            (throw (ex-info (str ":ts-check: " n " TypeScript error" (when (< 1 n) "s")) {:ts-check n}))))))))
