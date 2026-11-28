(ns cljf.esm.node-test
  "A cljf.esm :test-runner :runner for Node.js: runs the tests, the process
  exits with 1 when any failed."
  (:require [cljs.test :as test]))

(defmethod test/report [::test/default :end-run-tests] [m]
  (when-not (test/successful? m)
    (set! (.-exitCode js/process) 1)))

(defn run
  "Runs the generated runner's tests, (run-tests env)."
  [run-tests]
  (run-tests (test/empty-env)))
