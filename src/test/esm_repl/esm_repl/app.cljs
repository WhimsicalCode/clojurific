(ns esm-repl.app
  "The build of cljs.esm-repl-tests."
  (:require [goog.string :as gstr]))

(def ^:dynamic *dyn* 1)

(defn g [] :old)

(defn call-g [] (g))

(defonce state (atom 0))

(defn trim [s] (gstr/trim s))

(defn fail []
  (throw (js/Error. "failed")))
