;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

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
