;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

(ns cljf.jsx
  "#x (or #jsx) literals' runtime: the JSX runtime, and the conversions of
  the values the compiler can't see into, see cljf.jsx/x. The compiler
  requires the runtime of the build's :jsx-import-source (default react,
  react/jsx-runtime) as cljf-jsx-runtime."
  (:require-macros [cljf.jsx]))

(def jsx cljf-jsx-runtime/jsx)
(def jsxs cljf-jsx-runtime/jsxs)
(def Fragment cljf-jsx-runtime/Fragment)

(defn prop-name
  "The JavaScript name of prop (or style) key k, as cljf.jsx/x names literal
  props and get reads it: a keyword's namespace/name, anything else as a
  string, never renamed."
  [k]
  (if (keyword? k) (.-fqn k) (str k)))

(def ^:private styles (js/WeakMap.))

(defn style
  "A :style value: a map as a JavaScript object (once per map), anything
  else as it is."
  [s]
  (if (map? s)
    (or (.get styles s)
        (let [o #js {}]
          (reduce-kv (fn [_ k v] (unchecked-set o (prop-name k) (if (keyword? v) (name v) v))) nil s)
          (.set styles s o)
          o))
    s))

(defn- push-classes [a c]
  (cond
    (or (nil? c) (false? c)) nil
    (keyword? c) (.push a (name c))
    (coll? c) (doseq [x c] (push-classes a x))
    :else (.push a (str c))))

(defn class-name
  "A :className value: a collection's classes (nested collections' too) joined,
  nil and false left out, keywords as their names, a string as it is."
  [c]
  (cond
    (string? c) c
    (keyword? c) (name c)
    (coll? c) (let [a #js []] (push-classes a c) (.join a " "))
    :else c))

(defn- props-obj [cache dom? p]
  (if (map? p)
    (or (.get cache p)
        (let [o #js {}]
          (reduce-kv (fn [_ k v]
                       (cond
                         ;; the element's key argument, see spread-key
                         (keyword-identical? :key k) nil
                         (keyword-identical? :style k) (unchecked-set o "style" (style v))
                         (or (keyword-identical? :className k) (keyword-identical? :class k))
                         (unchecked-set o (name k) (class-name v))
                         :else (unchecked-set o (prop-name k) (if (and dom? (keyword? v)) (name v) v))))
            nil p)
          (.set cache p o)
          o))
    p))

(def ^:private props-objs (js/WeakMap.))
(def ^:private component-props-objs (js/WeakMap.))

(defn props
  "A DOM element's spread props ({:& p}): a map as a JavaScript object (once
  per map, then spread into the element's own), keyword values as their
  names, anything else as it is."
  [p]
  (props-obj props-objs true p))

(defn component-props
  "A component's spread props, as props, keyword values as they are."
  [p]
  (props-obj component-props-objs false p))

(defn spread-key
  "The :key of a map spread at runtime ({:& m}), the element's key argument:
  undefined without one, and for anything else spread (nil, a JavaScript
  object): React keys null as \"null\"."
  [p]
  (if (map? p)
    (let [k (get p :key)]
      (if (nil? k) js/undefined k))
    js/undefined))

(defn child
  "A child the compiler can't see into: sequences (i.e. of for) and vectors
  of elements as arrays, anything else as it is. Hiccup vectors outside #x
  are data, as in squint: they need #x, and maps are props, which go first
  or in {:& ...}."
  [c]
  (cond
    (and (vector? c) (let [t (nth c 0 nil)] (or (keyword? t) (symbol? t))))
    (throw (js/Error. (str "A hiccup vector isn't a #x child, " (pr-str c)
                           ": hiccup in ClojureScript code needs #x, i.e. (for [i xs] #x [:li i])")))

    (map? c)
    (throw (js/Error. (str "A map isn't a #x child, " (pr-str c)
                           ": props are a map literal after the tag, other maps are spread with {:& m}")))

    (sequential? c)
    (let [a #js []]
      (doseq [x c] (.push a (child x)))
      a)

    :else c))
