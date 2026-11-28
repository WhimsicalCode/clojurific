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

(def ^:private yield-after-ms
  "How long the tests may run without yielding the event loop. Karma drops a
  browser that doesn't answer its socket's ping within its pingTimeout, 5 s
  by default, and cljs.test only yields when an async test waits."
  1000)

(defn- yield-point?
  "Can the tests yield here? Only while an env is installed: between test
  namespaces, a test's late report would go to a fresh env, not to Karma. And
  not in a namespace with map fixtures, whose :before, test and :after are
  separate steps, between which cljs.test doesn't yield either."
  []
  (when-let [env ct/*current-env*]
    (not-any? #(some map? %)
              (concat (vals (:once-fixtures env)) (vals (:each-fixtures env))))))

(defn- yielding
  "Interposes a step that yields the event loop, once `yield-after-ms` have
  passed since the last yield, between the steps of `block` and of the blocks
  its steps return: between test namespaces and test vars, where
  `yield-point?`. A namespace with function fixtures runs its tests in one
  step, which this can't split."
  [block]
  (let [last-yield (volatile! (now))
        yield (fn []
                (when (and (< yield-after-ms (- (now) @last-yield))
                           (yield-point?))
                  (ct/async done
                    (js/setTimeout (fn []
                                     (vreset! last-yield (now))
                                     (done))
                                   0))))]
    ((fn interpose-yields [block]
       (interpose yield
                  (map (fn [step]
                         (fn []
                           (let [result (step)]
                             (if (:cljs.test/block? (meta result))
                               (ct/block (interpose-yields result))
                               result))))
                       block)))
     block)))

(defn start
  "Runs the tests (run-tests, given a cljs.test env) once Karma has started,
  yielding the event loop between tests so that Karma keeps the
  browser connected."
  [run-tests]
  (let [run #(run-tests (ct/empty-env ::karma) yielding)]
    (if (unchecked-get js/window "__karmaStarted")
      (run)
      (unchecked-set js/window "__karmaRun" run))))
