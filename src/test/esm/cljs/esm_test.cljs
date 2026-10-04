;; Copyright (c) Rich Hickey. All rights reserved.
;; The use and distribution terms for this software are covered by the
;; Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;; which can be found in the file epl-v10.html at the root of this distribution.
;; By using this software in any fashion, you are agreeing to be bound by
;; the terms of this license.
;; You must not remove this notice, or any other, from this software.

(ns cljs.esm-test
  "Tests of behavior specific to :module-format :esm."
  (:require [cljs.test :refer-macros [deftest is testing]]))

(deftest test-hash-non-extensible-objects
  (testing "ES modules are strict mode, hashing can't add uid properties to frozen objects"
    (let [frozen (js/Object.freeze #js {:a 1})
          sealed (js/Object.seal #js {:b 2})]
      (is (number? (hash frozen)))
      (is (= (hash frozen) (hash frozen)))
      (is (= (hash sealed) (hash sealed)))
      (is (not= (hash frozen) (hash (js/Object.freeze #js {:a 1}))))
      (is (= :v (get {[frozen] :v} [frozen]))))))
