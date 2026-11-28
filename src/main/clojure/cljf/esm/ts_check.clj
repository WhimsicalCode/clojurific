;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

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
  copies."
  (:require [cljs.analyzer :as ana]
            [cljs.source-map :as sm]
            [cljs.vendor.clojure.data.json :as json]
            [clojure.java.io :as io]
            [clojure.string :as string])
  (:import [java.io File]
           [java.util.concurrent TimeUnit]))

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
  [^File js output shims]
  (let [parent (.getParentFile js)]
    (->> (string/split (slurp js) #"\n" -1)
         ;; :npm-interop :shadow's imports, which the Vite plugin resolves:
         ;; an ES module's namespace, a CommonJS module's module.exports, as
         ;; TypeScript's import types type them (export = for CommonJS)
         (map (fn [line]
                (if-let [[_ alias spec] (re-matches #"import ([\w$]+) from \"cljs-npm-as:([^\"]+)\";" line)]
                  (let [spec (if (string/starts-with? spec ".") (canonical (io/file parent spec)) spec)]
                    (str "const " alias " = /** @type {typeof import(" (json/write-str spec :escape-slash false) ")} */ (null);"))
                  line)))
         (map (fn [line]
                (if-let [[_ star alias spec] (re-matches #"import (\* as )?([\w$]+) from \"(\.[^\"]*)\";" line)]
                  (let [target (canonical (io/file parent spec))]
                    (cond
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
  (or (when (map? ts-check) (:tsc ts-check))
      (some (fn [start]
              (loop [d (io/file (canonical start))]
                (when d
                  (let [tsc (io/file d "node_modules/.bin/tsc")]
                    (if (.exists tsc) (.getPath tsc) (recur (.getParentFile d)))))))
        [output-dir "."])))

(def ^:private diagnostic
  #"^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$")

(defn- noise?
  "Diagnostics of the output's shape rather than of interop: properties
  ClojureScript adds (cljs$core$IFn$_invoke$arity$2, protocol methods),
  whose names are munged, and comma expressions the compiler emits for
  let-bound arguments. A failed default import of an ES module without one
  (:npm-interop :shadow binds its namespace) leaves its binding any."
  [{:keys [code message]}]
  (or (#{"TS2695" "TS1192"} code)
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

(defn check!
  "Runs :ts-check over the build's inputs ({:ns :source-file}) whose sources
  are in source directories dirs, reports tsc's diagnostics as :ts-check
  warnings."
  [inputs dirs {:keys [output-dir] :as opts} output-file shims]
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
      (binding [*out* *err*]
        (println "WARNING: :ts-check needs TypeScript: no node_modules/.bin/tsc near the output directory, set :ts-check {:tsc path}"))

      :else
      (let [checked (into {}
                      (keep (fn [{:keys [ns source-file]}]
                              (let [^File js (output-file ns opts)]
                                (when (.exists js)
                                  (let [rel  (subs (canonical js) (inc (count output)))
                                        copy (io/file root rel)]
                                    (io/make-parents copy)
                                    (spit copy (check-source js output shims))
                                    [(canonical copy) {:ns ns :js js :source-file source-file}])))))
                      own)
            config  (io/file root "tsconfig.json")]
        (spit config
          (json/write-str
            (cond-> {:compilerOptions {:allowJs true :checkJs false :noEmit true :strict false :skipLibCheck true
                                       :target "es2022" :module "esnext" :moduleResolution "bundler"
                                       :lib ["esnext" "dom" "dom.iterable"]
                                       ;; the copies' relative imports of the goog shims
                                       :rootDirs [".." "."]}
                     ;; with :tsconfig's include, which a tsconfig extending
                     ;; it keeps unless it sets one: its files are replaced
                     :files (vec (sort (map #(subs % (inc (count (canonical root)))) (keys checked))))}
              (and (map? (:ts-check opts)) (:tsconfig (:ts-check opts)))
              (assoc :extends (canonical (:tsconfig (:ts-check opts)))))
            :escape-slash false))
        (let [proc  (-> (ProcessBuilder. ^java.util.List [tsc "-p" "tsconfig.json" "--pretty" "false"])
                        (.directory root)
                        (.redirectErrorStream true)
                        (.start))
              lines (with-open [r (io/reader (.getInputStream proc))] (vec (line-seq r)))
              maps  (atom {})]
          (.waitFor proc 1 TimeUnit/HOURS)
          (doseq [l lines
                  :let [[_ file line col code message] (re-matches diagnostic l)
                        d {:code code :message message}]
                  :when (and file (not (noise? d)))]
            (let [path (canonical (io/file root file))
                  {:keys [ns ^File js source-file]} (checked path)
                  line (Long/parseLong line)
                  col  (Long/parseLong col)]
              (if-not js
                (ana/warning :ts-check {} {:message (str path ":" line ":" col " " code " " message)})
                (let [col  (cond-> col
                             (string/starts-with? (nth (string/split-lines (slurp (io/file path))) (dec line) "") any-var)
                             (- (count any-var)))
                      smap (or (get @maps js)
                               (let [f (io/file (str (.getPath js) ".map"))
                                     m (when (.exists f) (sm/decode (json/read-str (slurp f) :key-fn keyword)))]
                                 (swap! maps assoc js m)
                                 m))
                      [sl sc] (some-> smap (source-position line col))]
                  (binding [ana/*cljs-file* (str source-file)
                            ana/*cljs-ns*   ns]
                    (ana/warning :ts-check {:line sl :column sc}
                      {:message (str code " " message
                                     (when-not sl (str " (" (.getName js) ":" line ":" col ")")))})))))))))))
