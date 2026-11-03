;; Copyright (c) Rich Hickey. All rights reserved.
;; The use and distribution terms for this software are covered by the
;; Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;; which can be found in the file epl-v10.html at the root of this distribution.
;; By using this software in any fashion, you are agreeing to be bound by
;; the terms of this license.
;; You must not remove this notice, or any other, from this software.

(ns cljf.esm-test
  "Tests of behavior specific to ES module output."
  (:require ["node:path" :as node-path]
            [cljf.esm.lazy :as lazy]
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

(deftest test-exists-npm-module-property
  (testing "exists? checks the properties of an npm module's binding, which isn't a global"
    (is (exists? node-path/join))
    (is (exists? node-path/posix.join))
    (is (not (exists? node-path/noSuchExport)))
    (is (not (exists? node-path/noSuchExport.nested)))))

(deftest test-namespace-fields-of-js-globals
  (testing "namespaces read as fields of JavaScript globals are their modules, like js/cljs.core.inc"
    (is (identical? (.-EMPTY PersistentArrayMap) (.. js/cljs -core -PersistentArrayMap -EMPTY)))
    (is (= 3 (.. js/cljs -core (inc 2))))
    (is (= 3 ((.. js/cljs -core -inc) 2)))))

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

(defn- destructure-js [{:keys [a b] :strs [c] :or {b 9} :as m}]
  [a b c (:x/y m) (identical? m m)])

(deftest test-plain-javascript-objects-lookup
  (testing "keywords, get, get-in, contains? and destructuring read plain objects' own properties"
    (let [o  #js {:a 1 "c" 3 "x/y" 4 :n #js {:deep 42} :nil nil}
          j  (js/JSON.parse "{\"a\":{\"b\":[10,20]}}")
          ks [:n :deep]
          k  :a]
      (is (= 1 (:a o) (get o :a) (get o "a") (k o) (get o k)))
      (is (= :nf (:missing o :nf) (get o :missing :nf) (get o "missing" :nf)))
      (is (nil? (:missing o)))
      (testing "a property that is nil is found"
        (is (nil? (get o :nil :nf)))
        (is (contains? o :nil)))
      (is (= 4 (:x/y o)))
      (is (= 42 (get-in o [:n :deep]) (get-in o ks)))
      (is (= 20 (get-in j [:a :b 1])))
      (is (= :nf (get-in j [:a :q] :nf)))
      (is (= [1 9 3 4 true] (destructure-js o)))
      (let [{{:keys [deep]} :n} o] (is (= 42 deep)))
      (is (= [1 2 nil] (map :a [#js {:a 1} {:a 2} nil])))
      (is (= {:a 1} (select-keys o [:a :zz])))
      (is (contains? o :a))
      (is (not (contains? o :zz)))
      (is (= [:a 1] (find o :a)))
      (is (= [:nil nil] (find o :nil)))
      (is (nil? (find o :zz)))))
  (testing "objects with an own constructor property, and without a prototype"
    (let [o (js/JSON.parse "{\"constructor\":\"x\",\"a\":1}")]
      (is (= 1 (:a o)))
      (is (= "x" (:constructor o))))
    (let [nul (js/Object.create nil)]
      (unchecked-set nul "a" 1)
      (is (= 1 (:a nul)))
      (is (contains? nul :a))))
  (testing "not inherited properties, other keys, nor objects that aren't plain"
    (is (nil? (:toString #js {})))
    (is (not (contains? #js {} :toString)))
    (is (nil? (get #js {"1" :one} 1)))
    (is (nil? (get #js {"sym" 1} 'sym)))
    (is (nil? (:x (js/Date.))))
    (is (nil? (find (js/Date.) :x)))
    (is (nil? (:a (js/Object.create #js {:a 1})))))
  (testing "find agrees with get and contains? on JavaScript arrays and strings: indexed"
    (is (= [0 10] (find #js [10] 0)))
    (is (= [0 "a"] (find "a" 0)))
    (is (nil? (find #js [10] 1)))
    (is (nil? (find "a" 1)))))
