;; Copyright (c) Rich Hickey. All rights reserved.
;; The use and distribution terms for this software are covered by the
;; Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;; which can be found in the file epl-v10.html at the root of this distribution.
;; By using this software in any fashion, you are agreeing to be bound by
;; the terms of this license.
;; You must not remove this notice, or any other, from this software.

(ns cljs.repl-tests
  (:require [cljs.analyzer :as ana]
            [cljs.analyzer.api :as ana-api]
            [cljs.env :as env]
            [cljs.repl :as repl]
            [clojure.string :as string])
    (:use clojure.test))

(def st (env/default-compiler-env))

(env/with-compiler-env st
  (ana/analyze-file "cljs/core.cljs")
  (ana/load-core))

(deftest test-doc
  (env/with-compiler-env st
    (is (string? (:doc (ana-api/resolve {} '->))))))

(deftest test-source-fn
  (env/with-compiler-env st
    (binding [ana/*cljs-ns* 'cljs.user]
      (is (string/starts-with?
            (repl/source-fn (assoc-in (ana/empty-env) [:ns :name] 'cljs.user) 'cljs.core/first)
            "(defn first")))))

(deftest test-special-doc-map
  (is (contains? repl/special-doc-map 'if))
  (is (contains? repl/repl-special-doc-map 'in-ns)))
