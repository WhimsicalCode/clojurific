;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

(ns cljf.esm.karma
  "A cljf.esm :test-runner :runner for Karma: reports cljs.test results to
  Karma, one result per test var. The generated test runner calls `start`
  with a fn running the test namespaces. Karma's start (the adapter,
  src/main/js/karma-esm/adapter.js) can come before or after the test
  bundle, an ES module, has loaded."
  (:require [cljs.pprint :refer [pprint]]
            [cljs.test :as ct]
            [clojure.data :as data]
            [clojure.string :as str]))

(defn- now []
  (js/Date.now))

(defn- indent [n s]
  (str/replace s #"\n" (str "\n" (apply str (repeat n " ")))))

(defn- pprint-str [x]
  (str/trimr (with-out-str (pprint x))))

(defn- format-diff [indentation [c a b & more]]
  (when (and (= c '=) (nil? more))
    (let [[removed added] (data/diff a b)]
      (str "- " (indent (+ indentation 2) (pprint-str removed))
           "\n" (apply str (repeat indentation " "))
           "+ " (indent (+ indentation 2) (pprint-str added))))))

(defn- format-log [{:keys [expected actual message testing-contexts-str] :as result}]
  (let [indentation (count "expected: ")]
    (str
      "FAIL in   " (ct/testing-vars-str result) "\n"
      (when-not (str/blank? testing-contexts-str)
        (str "\"" testing-contexts-str "\"\n"))
      (cond
        (and (seq? expected) (seq? actual))
        (str "expected: " (indent indentation (pprint-str expected)) "\n"
             "  actual: " (indent indentation (pprint-str (second actual))) "\n"
             (when-let [diff (format-diff indentation (second actual))]
               (str "    diff: " diff "\n")))

        (and (object? actual) (.hasOwnProperty actual "stack"))
        (str "Exception: " (.-stack actual) "\n")

        (instance? js/Error actual)
        (str "Exception: " (.-stack actual) "\n")

        :else
        (str "expected: " (pr-str expected) "\n"
             "  actual: " (pr-str actual) "\n"))
      (when message
        (str " message: " (indent indentation message) "\n")))))

(def ^:private test-var-results (volatile! []))

(def ^:private test-var-start (volatile! (now)))

(derive ::karma :cljs.test/default)

(defmethod ct/report [::karma :summary] [_])

(defmethod ct/report [::karma :begin-test-ns] [m]
  (println "Testing" (name (:ns m))))

(defmethod ct/report [::karma :begin-test-var] [_]
  (vreset! test-var-start (now))
  (vreset! test-var-results []))

(defmethod ct/report [::karma :end-test-var] [m]
  (let [{var-ns :ns var-name :name} (meta (:var m))]
    (js/__karma__.result
      (clj->js {:suite [(str var-ns)]
                :description (str var-name)
                :success (empty? @test-var-results)
                :skipped nil
                :time (- (now) @test-var-start)
                :log (map format-log @test-var-results)}))))

(defmethod ct/report [::karma :fail] [m]
  (ct/inc-report-counter! :fail)
  (vswap! test-var-results conj (assoc m :testing-contexts-str (ct/testing-contexts-str))))

(defmethod ct/report [::karma :error] [m]
  (ct/inc-report-counter! :error)
  (vswap! test-var-results conj (assoc m :testing-contexts-str (ct/testing-contexts-str))))

(defmethod ct/report [::karma :end-run-tests] [_]
  (js/__karma__.complete #js {}))

(defn start
  "Runs the tests (run-tests, given a cljs.test env) once Karma has started."
  [run-tests]
  (let [run #(run-tests (ct/empty-env ::karma))]
    (if (unchecked-get js/window "__karmaStarted")
      (run)
      (unchecked-set js/window "__karmaRun" run))))
