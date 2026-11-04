(ns {{ns}}
  (:require ["react" :as react]
            ["react-dom/client" :as rdc]
            [{{themeNs}} :as theme]
            [uni.style.core :as s]))

;; #x [...] is a React element: hiccup compiled to react/jsx-runtime calls,
;; props map literals to JavaScript objects with the keys as written (React's
;; names: :className, :onClick)

;; s/c composes uni.style's utilities into a class: they compile to atomic
;; CSS in public/css/bundle.css, and for each property the last one wins.
;; React's :className takes it as is, its class names its string
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

;; a component's props are a JavaScript object, which keywords, get and
;; destructuring read
(defn Counter [{:keys [label clicks onIncrement]}]
  #x [:button {:type "button" :className button :onClick onIncrement}
      label " " clicks])

(defn App []
  (let [[count set-count!] (react/useState 0)]
    #x [:main {:className (s/c (s/flex) (s/flex-col) (s/items-center) (s/justify-center)
                                (s/gap 32) (s/min-h "100vh") (s/p 32) (s/text-center))}
        [:h1 {:className (s/c (s/font-size 48) (s/line-height 1.1) (s/font-bold))}
         "Clojurific + React + uni.style"]
        [Counter {:label "count is" :clicks count :onIncrement #(set-count! inc)}]
        [:p {:className (s/color theme/muted)}
         "Edit " [:code {:className (s/font-mono)} "src/{{nsDir}}/core.cljs"]
         " and save to hot reload"]]))

(defonce root (rdc/createRoot (js/document.getElementById "app")))

(defn ^:dev/after-load render []
  (.render root #x [App]))

(render)
