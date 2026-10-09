;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

(ns shadow.resource
  "shadow-cljs' shadow.resource for code written for shadow-cljs compiled to
  ES modules (cljf.esm): inlines classpath resources at compile time, the
  watcher recompiles the namespace when the resource changes."
  (:require [cljs.analyzer :as ana]
            [cljf.esm :as esm]
            [cljs.util :as util]
            [clojure.java.io :as io]
            [clojure.string :as str])
  (:import [java.nio.file Paths]))

(defn- resource-path
  "path, absolute (/my/file.txt) or relative to the namespace (./file.txt),
  as a classpath resource path."
  [env path]
  (cond
    (str/starts-with? path "/")
    (subs path 1)

    (str/starts-with? path ".")
    (let [ns     (-> env :ns :name)
          parent (.getParent (Paths/get (util/ns->relpath ns :cljs) (into-array String [])))]
      (when-not parent
        (throw (ana/error env (str "Could not resolve " path " from " ns))))
      (-> (.resolve parent ^String path)
          (.normalize)
          (str)
          (str/replace java.io.File/separator "/")))

    :else
    path))

(defn slurp-resource
  "API function to let other macros read resources while also recording that
  they did so."
  [env path]
  (let [path (resource-path env path)
        res  (or (io/resource path)
                 (throw (ana/error env (str "Resource not found: " path))))]
    (esm/watch-resource! env path)
    (slurp res)))

(defmacro inline
  "Inlines the given resource path as a string value, will throw if the path
  is not found on the classpath. Relative paths are resolved relative to the
  current namespace.

  (def x (rc/inline \"./test.md\"))"
  [path]
  (when-not (string? path)
    (throw (ana/error &env "shadow.resource/inline must be called with a literal string argument")))
  (slurp-resource &env path))
