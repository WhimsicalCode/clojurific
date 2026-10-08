(ns {{ns}}
  (:require [reagent.core :as r]
            [reagent.dom.client :as rdc]))

(defonce counter (r/atom 0))

(defn app []
  [:<>
   [:h1 "Clojurific + Reagent"]
   [:div.card
    [:button {:type "button" :on-click #(swap! counter inc)}
     "count is " @counter]]
   [:p.hint "Edit " [:code "src/{{nsDir}}/core.cljs"] " and save to hot reload"]])

(defonce root (rdc/create-root (js/document.getElementById "app")))

(defn ^:dev/after-load render []
  (rdc/render root [app]))

(render)
