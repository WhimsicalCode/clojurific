(ns {{ns}}
  (:require ["cloudflare:workers" :refer [DurableObject]]
            ["hono" :refer [Hono]]
            [cljf.x :refer [defclass]]))

;; A Durable Object: one instance per name, whose storage outlives the
;; Worker's isolates (wrangler.jsonc binds the class as COUNTER). The Worker
;; calls its methods over RPC.
(defclass Counter
  (extends DurableObject)
  Object
  (clicks [this]
    (.then (.get (.. this -ctx -storage) "clicks") #(or % 0)))
  (click [this]
    (.then (.clicks this)
           (fn [n]
             (.then (.put (.. this -ctx -storage) "clicks" (inc n))
                    (constantly (inc n)))))))

(defn- counter [c]
  (let [counters (.. c -env -COUNTER)]
    (.get counters (.idFromName counters "clicks"))))

(defn- clicks [c n]
  (.json c #js {:clicks n}))

;; #x [...] is an element of Hono's JSX (hono/jsx, vite.config.ts'
;; jsxImportSource), rendered to HTML by c.html
(defn- page []
  #x [:html
      [:head [:title "{{name}}"]]
      [:body
       [:h1 "Hello Cloudflare Workers!"]
       [:p "Edit " [:code "src/{{nsDir}}/core.cljs"] " and save to hot reload"]]])

(def app
  (doto (Hono.)
    (.get "/" (fn [c] (.html c (str "<!doctype html>" (page)))))
    (.get "/clicks" (fn [c] (.then (.clicks (counter c)) #(clicks c %))))
    (.post "/clicks" (fn [c] (.then (.click (counter c)) #(clicks c %))))))
