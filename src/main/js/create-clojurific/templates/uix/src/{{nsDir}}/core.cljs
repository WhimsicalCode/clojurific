(ns {{ns}}
  (:require [uix.core :as uix :refer [defui $]]
            [uix.dom]))

(defui app []
  (let [[count set-count!] (uix/use-state 0)]
    ($ :<>
       ($ :h1 "Clojurific + UIx")
       ($ :div.card
          ($ :button {:type "button" :on-click #(set-count! inc)}
             "count is " count))
       ($ :p.hint "Edit " ($ :code "src/{{nsDir}}/core.cljs") " and save to hot reload"))))

(defonce root (uix.dom/create-root (js/document.getElementById "app")))

(defn ^:dev/after-load render []
  (uix.dom/render-root ($ app) root))

(render)
