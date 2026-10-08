(ns {{ns}})

(defonce counter (atom 0))

(defn ^:dev/after-load render []
  (let [app (js/document.getElementById "app")]
    (set! (.-innerHTML app)
          (str "<h1>Clojurific</h1>"
               "<div class=\"card\"><button type=\"button\">count is " @counter "</button></div>"
               "<p class=\"hint\">Edit <code>src/{{nsDir}}/core.cljs</code> and save to hot reload</p>"))
    (.addEventListener (.querySelector app "button") "click"
                       (fn []
                         (swap! counter inc)
                         (render)))))

(render)
