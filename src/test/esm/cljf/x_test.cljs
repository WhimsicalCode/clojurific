;; Copyright (c) Rich Hickey. All rights reserved.
;; The use and distribution terms for this software are covered by the
;; Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;; which can be found in the file epl-v10.html at the root of this distribution.
;; By using this software in any fashion, you are agreeing to be bound by
;; the terms of this license.
;; You must not remove this notice, or any other, from this software.

(ns cljf.x-test
  (:require [cljf.x :refer [defclass]]
            [cljs.test :refer-macros [deftest is testing]]))

(defprotocol IGreet
  (greet [this]))

(defclass Base
  (constructor [this a]
    (set! (.-a this) a))

  Object
  (describe [this] (str "base " (.-a this))))

(defclass Derived
  (extends Base)

  (constructor [this a b]
    (let [self (super (inc a))]
      (set! (.-b self) b)
      (set! (.-same self) (identical? self this))))

  Object
  (sum [this] (+ (.-a this) (.-b this)))
  (rest-args [this x & more] [x more])

  IGreet
  (greet [this] (str "hi " (.-b this))))

(defclass Implicit
  (extends Base)

  (constructor [this a]
    (set! (.-implicit this) true)))

(defclass Default
  (extends Base))

(defclass Destructured
  (constructor [this {:keys [x]} [y]]
    (set! (.-xy this) [x y])))

(deftest test-defclass
  (testing "a class without a base"
    (let [b (Base. 1)]
      (is (= 1 (.-a b)))
      (is (= "base 1" (.describe b)))))

  (testing "a subclass: super calls the base's constructor and returns this"
    (let [d (Derived. 1 2)]
      (is (instance? Derived d))
      (is (instance? Base d))
      (is (= 2 (.-a d)))
      (is (true? (.-same d)))
      (is (= 4 (.sum d)))
      (is (= "base 2" (.describe d)))
      (is (= [1 '(2 3)] (.rest-args d 1 2 3)))
      (is (= "hi 2" (greet d)))
      (is (satisfies? IGreet d))))

  (testing "a constructor without a super call passes its params"
    (let [i (Implicit. 5)]
      (is (= 5 (.-a i)))
      (is (true? (.-implicit i)))))

  (testing "without a constructor, JavaScript's default one"
    (is (= 7 (.-a (Default. 7)))))

  (testing "destructured constructor params"
    (is (= [1 2] (.-xy (Destructured. {:x 1} [2])))))

  (testing "a JavaScript class: new.target, the class syntax's prototype chain"
    (is (= "Derived" (.-name Derived)))
    (is (thrown? js/TypeError (Base 1)))))
