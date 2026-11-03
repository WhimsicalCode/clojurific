;; Copyright (c) Rich Hickey. All rights reserved.
;; The use and distribution terms for this software are covered by the
;; Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;; which can be found in the file epl-v10.html at the root of this distribution.
;; By using this software in any fashion, you are agreeing to be bound by
;; the terms of this license.
;; You must not remove this notice, or any other, from this software.

(ns cljs.externs-infer-tests
  "Type inference from the default externs (cljs/externs/default.edn) and the
  :infer-warning warnings."
  (:require
    [cljs.analyzer :as ana]
    [cljs.analyzer-tests :refer [analyze collecting-warning-handler test-cenv]]
    [cljs.compiler :as comp]
    [cljs.env :as env]
    [clojure.string :as string]
    [clojure.test :as test :refer [is deftest testing]]))

(def externs @env/default-externs)

(deftest test-normalize-js-tag
  (is (= 'js (ana/normalize-js-tag 'js)))
  (is (= '[Foo] (-> 'js/Foo ana/normalize-js-tag meta :prefix)))
  (is (true? (-> 'js/Foo ana/normalize-js-tag meta :prefix last meta :ctor)))
  (is (= '[Foo Bar] (-> 'js/Foo.Bar ana/normalize-js-tag meta :prefix)))
  (is (true? (-> 'js/Foo.Bar ana/normalize-js-tag meta :prefix last meta :ctor))))

(deftest test-resolve-extern
  (is (= '[Number]
         (-> (ana/resolve-extern '[Number] externs) :resolved)))
  (is (= '[Number prototype valueOf]
         (-> (ana/resolve-extern '[Number valueOf] externs) :resolved)))
  (is (= '[Console]
         (-> (ana/resolve-extern '[console] externs) :resolved)))
  (is (= '[Console prototype log]
         (-> (ana/resolve-extern '[console log] externs) :resolved)))
  (is (= '[undefined]
         (-> (ana/resolve-extern '[undefined] externs) :resolved)))
  (is (= '[webCrypto Crypto prototype subtle]
         (-> (ana/resolve-extern '[crypto subtle] externs) :resolved)))
  (is (nil? (ana/resolve-extern '[Number gozMethod] externs))))

(deftest test-has-extern?-defaults
  (is (true? (ana/has-extern? '[console] externs)))
  (is (true? (ana/has-extern? '[console log] externs)))
  (is (true? (ana/has-extern? '[Number isNaN] externs)))
  (is (false? (ana/has-extern? '[Number gozMethod] externs)))
  (testing "ClojureScript's own properties"
    (is (true? (ana/has-extern? '[Object cljs$core$ISeq$_first$arity$1] externs)))))

(deftest test-js-tag
  (is (= 'js/Console (ana/js-tag '[console] :tag externs)))
  (is (= 'js/Function (ana/js-tag '[console log] :tag externs)))
  (is (= 'js/undefined (ana/js-tag '[console log] :ret-tag externs)))
  (is (= 'boolean (ana/js-tag '[Number isNaN] :ret-tag externs))))

(defn- tag [form]
  (-> (binding [ana/*cljs-ns* ana/*cljs-ns*]
        (env/with-compiler-env (env/default-compiler-env)
          (analyze (ana/empty-env) form)))
      :tag))

(deftest test-externs-type-infer
  (is (= 'boolean (tag '(.isNaN js/Number 1))))
  (is (= 'boolean (tag '(js/Number.isNaN 1))))
  (is (= 'boolean (tag '(let [x js/Number] (.isNaN x 1)))))
  (is (= 'boolean (tag '(js/isNaN 1))))
  (is (= 'js/Promise (tag '(.generateKey js/crypto.subtle))))
  (is (= 'string (tag '(.toUpperCase "foo"))))
  (is (= 'boolean (tag '(.isArray js/Array (array)))))
  (is (= 'boolean (tag '(.isSafeInteger js/Number 1))))
  (is (= 'boolean (tag '(js/isFinite 1)))))

(defn- infer-warnings
  "The warnings analyzing forms, with :infer-warning enabled unless warn is
  false, and with cljs.core analyzed when with-core?."
  [{:keys [forms warn with-core?]}]
  (let [ws (atom [])]
    (ana/with-warning-handlers [(collecting-warning-handler ws)]
      (binding [ana/*analyze-deps* false
                ana/*cljs-ns*      ana/*cljs-ns*]
        (env/with-compiler-env (env/default-compiler-env)
          ((if with-core? #(comp/with-core-cljs nil %) #(%))
           (fn []
             (binding [ana/*analyze-deps* true
                       ana/*cljs-warnings* (assoc ana/*cljs-warnings*
                                             :infer-warning (if (nil? warn) true warn))]
               (ana/analyze-form-seq forms)))))))
    @ws))

(deftest test-infer-unknown-method
  (let [ws (infer-warnings {:forms '[(defn baz [^js/Number a]
                                       (.gozMethod a))]})]
    (is (= 1 (count ws)))
    (is (some-> ws first
          (string/starts-with? "Cannot resolve property gozMethod for inferred type js/Number")))))

(deftest test-infer-js-require
  (let [ws (infer-warnings {:forms '[(ns foo.core)
                                     (def React (js/require "react"))
                                     (.log js/console (.-Component React))]})]
    (is (= 1 (count ws)))
    (is (some-> ws first
          (string/starts-with? "Adding extern to Object for property Component")))))

(deftest test-set-warn-on-infer
  (let [ws (infer-warnings {:forms '[(ns warn-on-infer-test.app)
                                     (set! *warn-on-infer* true)
                                     (defn wrap-baz [x]
                                       (.baz x))]
                            :warn false
                            :with-core? true})]
    (is (= 1 (count ws)))
    (is (some-> ws first (string/starts-with? "Cannot infer target type")))))

(deftest test-no-infer-warnings
  (testing "CLJS-1970: ClojureScript literals"
    (is (empty? (infer-warnings
                  {:with-core? true
                   :forms '[(ns cjls-1970.core)
                            (set! *warn-on-infer* true)
                            (defn foo [] (list))
                            (defn bar [] (vector))]}))))
  (testing "CLJS-1918: case of keywords"
    (is (empty? (infer-warnings
                  {:with-core? true
                   :forms '[(ns cjls-1918.core)
                            (defn foo [x]
                              (cljs.core/case x
                                :foo 1
                                nil))]}))))
  (testing "CLJS-2385: a hinted destructured local"
    (is (empty? (infer-warnings
                  {:with-core? true
                   :forms '[(ns cjls-2385.core)
                            (defn thing [{:as this}]
                              (.componentDidUpdate ^js/Thing this))]}))))
  (testing "CLJS-2767: defrecord"
    (is (empty? (infer-warnings
                  {:with-core? true
                   :forms '[(ns cjls-2767.core)
                            (defrecord Foo [])]}))))
  (testing "CLJS-2767: deftype"
    (is (empty? (infer-warnings
                  {:with-core? true
                   :forms '[(ns cjls-2767.core)
                            (deftype Foo [])]}))))
  (testing "CLJS-2790: defrecord fields"
    (is (empty? (infer-warnings
                  {:with-core? true
                   :forms '[(ns cjls-2790.core)
                            (defrecord Foo [a b])]}))))
  (testing "CLJS-3181: a hinted call"
    (is (empty? (infer-warnings
                  {:with-core? true
                   :forms '[(ns warn-on-infer-test.app)
                            (set! *warn-on-infer* true)
                            (defn f [gfn]
                              (.then ^js/Promise (gfn (inc 1)) identity))]}))))
  (testing "CLJS-1924: defrecord with *warn-on-infer*"
    (is (empty? (infer-warnings
                  {:with-core? true
                   :forms '[(set! *warn-on-infer* true)
                            (defrecord Foo [])]}))))
  (testing "CLJS-2862: deftype methods"
    (is (empty? (infer-warnings
                  {:with-core? true
                   :forms '[(ns demo.app)
                            (set! *warn-on-infer* true)
                            (deftype Foo []
                              Object
                              (bar [this] :bar))]}))))
  (testing "CLJS-2957: an imported Closure Library constructor"
    (is (empty? (infer-warnings
                  {:with-core? true
                   :forms '[(ns test.foo
                              (:import [goog.history Html5History]))
                            (set! *warn-on-infer* true)
                            (doto (Html5History.)
                              (.setUseFragment false))]}))))
  (testing "CLJS-3236: defprotocol"
    (is (empty? (infer-warnings
                  {:with-core? true
                   :forms '[(ns test.foo)
                            (set! *warn-on-infer* true)
                            (defprotocol IFoo
                              (bar [this]))]}))))
  (testing "CLJS-3257: satisfies?"
    (is (empty? (infer-warnings
                  {:with-core? true
                   :forms '[(ns app.core)
                            (set! *warn-on-infer* true)
                            (defprotocol IFoo
                              (bar [this]))
                            (defn not-ok? [v]
                              (satisfies? IFoo v))]}))))
  (testing "CLJS-3408: inherited methods of JavaScript types"
    (is (empty? (infer-warnings
                  {:with-core? true
                   :forms '[(ns foo.core)
                            (.querySelectorAll js/document "div")]})))))

(deftest test-cljs-2247
  (let [ws (atom [])]
    (try
      (ana/with-warning-handlers [(collecting-warning-handler ws)]
        (env/with-compiler-env test-cenv
          (ana/analyze (ana/empty-env)
            '(defn -foo []))
          (ana/analyze (ana/empty-env)
            '(defprotocol IAlpha (-foo [this])))))
      (catch Exception _))
    (is (= ["Protocol IAlpha is overwriting function -foo"] @ws))))
