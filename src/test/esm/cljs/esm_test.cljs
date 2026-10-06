;; Copyright (c) Rich Hickey. All rights reserved.
;; The use and distribution terms for this software are covered by the
;; Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;; which can be found in the file epl-v10.html at the root of this distribution.
;; By using this software in any fashion, you are agreeing to be bound by
;; the terms of this license.
;; You must not remove this notice, or any other, from this software.

(ns cljs.esm-test
  "Tests of behavior specific to :module-format :esm."
  (:require [cljs.esm.lazy :as lazy]
            [cljs.test :refer-macros [async deftest is testing]]))

(deftest test-hash-non-extensible-objects
  (testing "ES modules are strict mode, hashing can't add uid properties to frozen objects"
    (let [frozen (js/Object.freeze #js {:a 1})
          sealed (js/Object.seal #js {:b 2})]
      (is (number? (hash frozen)))
      (is (= (hash frozen) (hash frozen)))
      (is (= (hash sealed) (hash sealed)))
      (is (not= (hash frozen) (hash (js/Object.freeze #js {:a 1}))))
      (is (= :v (get {[frozen] :v} [frozen]))))))

(defn variadic-fn [x & _] [:original x])

(def variadic-fn-alias variadic-fn)

(defn recursive-fn [n] (if (pos? n) (recursive-fn (dec n)) :original))

(deftest test-redefined-fn-dispatch
  (testing "a variadic fn's dispatcher calls the var's current value, like goog.provide'd output"
    (with-redefs [variadic-fn (fn [x & _] [:redefined x])]
      (is (= [:redefined 1] (variadic-fn-alias 1 2)))))
  (testing "a fn calling itself calls the var's current value"
    (let [original recursive-fn]
      (with-redefs [recursive-fn (fn [_] :redefined)]
        (is (= :redefined (original 1)))))))

(deftest test-lazy-load-retries-after-a-failure
  (testing "a failed import isn't kept: the next load imports again"
    (async done
      (let [imports  (atom 0)
            loadable (lazy/Loadable. '[some.ns]
                                     (fn []
                                       (if (= 1 (swap! imports inc))
                                         (js/Promise.reject (js/Error. "offline"))
                                         (js/Promise.resolve #js {:v 42})))
                                     (fn [m] (.-v m))
                                     nil nil)]
        (-> (lazy/load loadable)
            (.then (fn [_] (is false "the first load fails"))
                   (fn [e] (is (= "offline" (.-message e)))))
            (.then (fn [] (lazy/load loadable)))
            (.then (fn [v]
                     (is (= 42 v))
                     (is (= 2 @imports))
                     (is (lazy/ready? loadable))))
            (.catch (fn [e] (is false (str e))))
            (.finally done))))))
