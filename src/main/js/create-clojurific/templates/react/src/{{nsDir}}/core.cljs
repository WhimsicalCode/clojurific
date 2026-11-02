(ns {{ns}}
  (:require ["react" :as react]
            ["react-dom/client" :as rdc]))

;; #x [...] is a React element: hiccup compiled to react/jsx-runtime calls,
;; props map literals to JavaScript objects with the keys as written (React's
;; names: :className, :onClick)

;; a component's props are a JavaScript object, which keywords, get and
;; destructuring read
(defn Counter [{:keys [label clicks onIncrement]}]
  #x [:button {:type "button" :onClick onIncrement}
      label " " clicks])

(defn App []
  (let [[count set-count!] (react/useState 0)]
    #x [:<>
        [:h1 "Clojurific + React"]
        [:div.card
         [Counter {:label "count is" :clicks count :onIncrement #(set-count! inc)}]]
        [:p.hint "Edit " [:code "src/{{nsDir}}/core.cljs"] " and save to hot reload"]]))

(defonce root (rdc/createRoot (js/document.getElementById "app")))

(defn ^:dev/after-load render []
  (.render root #x [App]))

(render)
