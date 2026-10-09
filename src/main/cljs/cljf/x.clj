;   Copyright (c) Rich Hickey. All rights reserved.
;   The use and distribution terms for this software are covered by the
;   Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;   which can be found in the file epl-v10.html at the root of this distribution.
;   By using this software in any fashion, you are agreeing to be bound by
;   the terms of this license.
;   You must not remove this notice, or any other, from this software.

(ns cljf.x)

(defn- super-calls
  "Form with its (super ...) calls as super*, sets found when it has any."
  [form found]
  (let [walk #(super-calls % found)]
    (cond
      (and (seq? form) (= 'super (first form)))
      (do (reset! found true)
          (with-meta (list* 'super* (map walk (rest form))) (meta form)))

      (seq? form) (with-meta (apply list (map walk form)) (meta form))
      (vector? form) (with-meta (mapv walk form) (meta form))
      (map? form) (with-meta (into {} (map (fn [[k v]] [(walk k) (walk v)])) form) (meta form))
      (set? form) (with-meta (into #{} (map walk) form) (meta form))
      :else form)))

(defmacro defclass
  "(defclass Name
     (extends Base)
     (constructor [this & params]
       (super & args)
       ...)
     Object
     (method [this & args] ...)
     Protocol
     (protocol-fn [this & args] ...))

  Defines Name as a JavaScript class, for APIs needing one: one they construct
  with new, or a subclass. Like shadow-cljs' shadow.cljs.modern/defclass.

  (extends Base) and (constructor ...) are optional. this is bound once
  (super & args) called the base class' constructor, which a constructor
  without a (super ...) call does first with its params. Without a
  constructor, the class has JavaScript's default one. The methods and
  protocol implementations are extend-type's, on the class' prototype."
  [name & body]
  (loop [[x & more :as forms] body base nil ctor nil]
    (cond
      (and (seq? x) (= 'extends (first x)) (nil? base))
      (recur more (second x) ctor)

      (and (seq? x) (= 'constructor (first x)) (nil? ctor))
      (recur more base x)

      (and (some? x) (not (symbol? x)))
      (throw (ex-info (str "defclass " name ": expected (extends Base), (constructor [this & params] ...)"
                           " or a protocol, got " (pr-str x))
                      {:form x}))

      :else
      (let [[_ [_ & params :as ctor-params] & ctor-body] ctor
            found     (atom false)
            ctor-body (super-calls ctor-body found)
            _         (when-not (or @found (nil? base) (every? symbol? params))
                        (throw (ex-info (str "defclass " name ": a constructor with destructured params"
                                             " calls (super ...) itself")
                                        {:form ctor})))
            ctor-body (if (or @found (nil? base))
                        ctor-body
                        (cons (list* 'super* params) ctor-body))]
        `(do
           (def ~name
             (~'class* ~name ~base ~@(if ctor (cons ctor-params ctor-body) [nil])))
           ~@(when (seq forms)
               [`(cljs.core/extend-type ~name ~@forms)]))))))
