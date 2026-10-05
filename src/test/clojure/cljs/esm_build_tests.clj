;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

(ns cljs.esm-build-tests
  "cljs.esm builds reusing the output of a previous build."
  (:require [cljs.compiler :as comp]
            [cljs.esm :as esm]
            [clojure.java.io :as io]
            [clojure.string :as string]
            [clojure.test :refer [deftest is testing]])
  (:import [java.io File]
           [java.nio.file Files]
           [java.nio.file.attribute FileAttribute]))

(defn- temp-dir ^File []
  (.toFile (Files/createTempDirectory "cljs-esm-build" (make-array FileAttribute 0))))

(defn- write-source!
  "Writes namespace ns' source to dir, modified at time ms. Returns [ns file]."
  [^File dir ns source ms]
  (let [f (io/file dir (str (string/replace (str ns) "." "_") ".cljs"))]
    (spit f source)
    (.setLastModified f ms)
    [ns f]))

(defn- build!
  "Builds namespace main of sources {ns file} into dir/out. Returns the names
  of the source files it compiled."
  [^File dir sources main]
  (let [compiled      (atom #{})
        compile-file* comp/compile-file*]
    (with-redefs [comp/compile-file* (fn [^File src dest opts]
                                       (swap! compiled conj (.getName src))
                                       (compile-file* src dest opts))]
      (binding [esm/*generated-sources* sources]
        (esm/build {:main main :output-dir (str (io/file dir "out"))})))
    @compiled))

(defn- output [^File dir ns]
  (slurp (io/file dir "out" (str (string/replace (str ns) "." "/") ".js"))))

(deftest recompiles-dependents-of-api-changes
  (let [dir    (temp-dir)
        before (- (System/currentTimeMillis) 60000)
        after  (+ (System/currentTimeMillis) 60000)
        b      (write-source! dir 'test.b "(ns test.b (:require [test.a :as a])) (def y (a/f 1))" before)
        build  #(build! dir (into {} [b (write-source! dir 'test.a % %2)]) 'test.b)]
    (build "(ns test.a) (defn f [x] x)" before)
    (testing "a changed without changing its api"
      (is (= #{"test_a.cljs"} (build "(ns test.a) (defn f [x] (inc x))" after))))
    (testing "a changed its api: b calls f's arity directly (:static-fns)"
      (is (= #{"test_a.cljs" "test_b.cljs"} (build "(ns test.a) (defn f ([x] x) ([x y] y))" (+ after 1000))))
      (is (string/includes? (output dir 'test.b) "cljs$core$IFn$_invoke$arity$1(")))))

(deftest writes-closure-libraries-of-cached-namespaces
  (let [dir     (temp-dir)
        sources (into {} [(write-source! dir 'test.c "(ns test.c (:require [goog.string.format]))"
                            (- (System/currentTimeMillis) 60000))])
        lib     (io/file dir "out" "goog-lib" "ns" "goog.string.format.js")]
    (build! dir sources 'test.c)
    (is (.exists lib))
    (testing "a build compiling none of its users"
      (doseq [^File f (reverse (file-seq (io/file dir "out" "goog-lib")))]
        (.delete f))
      (build! dir sources 'test.c)
      (is (.exists lib)))))
