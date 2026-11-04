(ns {{ns}}
  (:require [{{themeNs}} :as theme]
            [reagent.core :as r]
            [reagent.dom.client :as rdc]
            [uni.style.core :as s]))

(defonce counter (r/atom 0))

;; s/c composes uni.style's utilities into a class: they compile to atomic
;; CSS in public/css/bundle.css, and for each property the last one wins
(def button
  (s/c (s/rounded 8)
       (s/border 1 "transparent")
       (s/bg theme/surface)
       (s/px 20)
       (s/py 10)
       (s/font-medium)
       (s/cursor-pointer)
       (s/transition-colors)
       (s/hover (s/border-color theme/accent))
       (s/focus-visible (s/outline 2 theme/accent) (s/outline-offset 2))))

(defn app []
  [:main {:class (s/c (s/flex) (s/flex-col) (s/items-center) (s/justify-center)
                      (s/gap 32) (s/min-h "100vh") (s/p 32) (s/text-center))}
   [:h1 {:class (s/c (s/font-size 48) (s/line-height 1.1) (s/font-bold))}
    "Clojurific + Reagent + uni.style"]
   [:button {:type "button" :class button :on-click #(swap! counter inc)}
    "count is " @counter]
   [:p {:class (s/color theme/muted)}
    "Edit " [:code {:class (s/font-mono)} "src/{{nsDir}}/core.cljs"] " and save to hot reload"]])

(defonce root (rdc/create-root (js/document.getElementById "app")))

(defn ^:dev/after-load render []
  (rdc/render root [app]))

(render)
