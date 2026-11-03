;; Copyright (c) Rich Hickey. All rights reserved.
;; The use and distribution terms for this software are covered by the
;; Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;; which can be found in the file epl-v10.html at the root of this distribution.
;; By using this software in any fashion, you are agreeing to be bound by
;; the terms of this license.
;; You must not remove this notice, or any other, from this software.

(ns cljs.test-runner
  "The analyzer's and the compiler's unit tests, run by script/test-esm."
  (:require [cljs.analyzer-api-tests]
            [cljs.analyzer.as-alias-test]
            [cljs.analyzer-pass-tests]
            [cljs.analyzer-tests]
            [cljs.analyzer.spec-tests]
            [cljs.compiler-tests]
            [cljs.externs-infer-tests]
            [cljs.instant-tests]
            [cljs.js-deps-tests]
            [cljs.repl-tests]
            [cljs.source-map.base64-tests]
            [cljs.type-inference-tests]
            [cljs.util-tests]
            [clojure.test :refer [run-tests]]))

(defn -main []
  (let [{:keys [fail error]}
        (run-tests
          'cljs.analyzer-api-tests
          'cljs.analyzer.as-alias-test
          'cljs.analyzer-pass-tests
          'cljs.analyzer-tests
          'cljs.analyzer.spec-tests
          'cljs.compiler-tests
          'cljs.externs-infer-tests
          'cljs.instant-tests
          'cljs.js-deps-tests
          'cljs.repl-tests
          'cljs.source-map.base64-tests
          'cljs.type-inference-tests
          'cljs.util-tests)]
    (if (or (not (zero? fail))
            (not (zero? error)))
      (System/exit 1)
      (System/exit 0))))
