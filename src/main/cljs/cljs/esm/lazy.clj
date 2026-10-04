;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

(ns cljs.esm.lazy
  (:require [cljs.analyzer :as ana]
            [cljs.compiler :as comp]))

(defn- import-fn
  "() => import(\"path/to/ns.js\"), the path a static string so bundlers can
  split the namespace into a separate chunk."
  [env ns]
  (let [path (comp/esm-ns-path (-> env :ns :name) ns)]
    (list 'js* (str "(() => import(\"" path "\"))"))))

(defn- export-name [sym]
  (comp/esm-var-name (name sym)))

(defmacro loadable
  "Returns a Loadable of a fully qualified var, or of a map or vector of
  them, of namespaces loaded on demand by cljs.esm.lazy/load."
  [thing]
  (cond
    (qualified-symbol? thing)
    `(cljs.esm.lazy/Loadable.
       ~(import-fn &env (symbol (namespace thing)))
       (fn [m#] (cljs.core/unchecked-get m# ~(export-name thing)))
       nil nil)

    (or (map? thing) (vector? thing))
    (let [syms   (if (map? thing) (vals thing) thing)
          nses   (distinct (map (comp symbol namespace) syms))
          idx    (zipmap nses (range))
          m      (gensym "modules")
          lookup (fn [sym] `(cljs.core/unchecked-get (cljs.core/aget ~m ~(idx (symbol (namespace sym)))) ~(export-name sym)))]
      `(cljs.esm.lazy/Loadable.
         (fn [] (js/Promise.all (cljs.core/array ~@(map (fn [ns] (list (import-fn &env ns))) nses))))
         (fn [~m] ~(if (map? thing)
                     (into {} (map (fn [[k sym]] [k (lookup sym)])) thing)
                     (mapv lookup thing)))
         nil nil))

    :else
    (throw (ana/error &env (str "Invalid loadable " (pr-str thing))))))
