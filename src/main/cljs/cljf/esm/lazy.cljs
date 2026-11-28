(ns cljf.esm.lazy
  "Lazily loaded code. (loadable my.ns/var)
  references a var of a namespace loaded with a dynamic import(), bundlers
  split it and everything only it requires into separate chunks. The API
  follows shadow.lazy."
  (:require-macros [cljf.esm.lazy]))

(defprotocol ILoadable
  (ready? [x]))

(deftype Loadable [modules import-fn deref-fn ^:mutable module ^:mutable promise]
  ILoadable
  (ready? [_]
    (some? module))

  IDeref
  (-deref [this]
    (when-not (ready? this)
      (throw (ex-info "loadable not ready yet" {})))
    (deref-fn module)))

(defn load
  "Loads the-loadable, returns a promise of its value. A failed load is
  tried again on the next call, as shadow.lazy does."
  ([^Loadable the-loadable]
   (when (nil? (.-promise the-loadable))
     (set! (.-promise the-loadable)
       (-> ((.-import-fn the-loadable))
           (.then (fn [m]
                    (set! (.-module the-loadable) m)
                    ((.-deref-fn the-loadable) m)))
           (.catch (fn [e]
                     (set! (.-promise the-loadable) nil)
                     (throw e))))))
   (.-promise the-loadable))
  ([the-loadable call-fn]
   (-> (load the-loadable)
       (.then call-fn)))
  ([the-loadable call-fn err-fn]
   (-> (load the-loadable)
       (.then call-fn err-fn))))
