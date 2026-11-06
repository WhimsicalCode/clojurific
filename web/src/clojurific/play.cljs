(ns clojurific.play
  "The playground (clojurific.dev/play/): a React app edited in the page,
  compiled by the self-hosted compiler (cljf.selfhost) as you type and
  rendered next to it, and a REPL in the app's namespace."
  (:require ["../error-boundary.js" :refer [ErrorBoundary]]
            ["react" :as react]
            ["react-dom/client" :as rdc]
            [cljf.selfhost :as selfhost]
            [clojure.string :as string]
            [clojurific.repl :as repl]
            ;; namespaces the playground's code can require
            [cljs.pprint]
            [clojure.data]
            [clojure.edn]
            [clojure.set]
            [clojure.walk]
            [clojure.zip]))

(def ^:private app-ns
  "The namespace of the app's code, and the REPL's."
  "app")

(def ^:private prelude
  "The app namespace's code the editor doesn't show, evaluated before the
  app's: its ns form, and use-atom, which the sample's components read the
  app's state with."
  (str "(ns " app-ns " (:require [\"react\" :as react]))

(defn use-atom
  \"The value of atom a, rendering again when it changes.\"
  [a]
  (react/useSyncExternalStore
    (fn [changed]
      (add-watch a changed (fn [_ _ _ _] (changed)))
      #(remove-watch a changed))
    #(deref a)))"))

(def ^:private sample
  "(defonce state (atom {:clicks 0}))

(defn Counter [{:keys [label clicks onIncrement]}]
  #x [:button {:type \"button\" :onClick onIncrement}
      label \" \" clicks])

(defn App []
  (let [{:keys [clicks]} (use-atom state)]
    #x [:<>
        [:h1 \"Clojurific + React\"]
        [:div.card
         [Counter {:label \"count is\"
                   :clicks clicks
                   :onIncrement #(swap! state update :clicks inc)}]]]))
")

(def ^:private examples
  [["@state" "@state"]
   ["swap!" "(swap! state update :clicks + 10)"]
   ["reset!" "(reset! state {:clicks 0})"]
   ["map" "(map inc [1 2 3])"]
   ["require" "(require '[clojure.string :as str])\n(str/upper-case \"es modules\")"]
   ["promise" "(js/Promise.resolve {:awaited true})"]])

(def ^:private storage-key "cljf-play-code")

(defn- $ [id] (js/document.getElementById id))

(defonce ^:private root (delay (rdc/createRoot ($ "preview-root"))))

(defonce ^:private runs
  ;; counts the runs of the code: a run's result is rendered unless the code
  ;; changed meanwhile
  (atom 0))

(defn- status! [cls text]
  (let [el ($ "status")]
    (set! (.-className el) (str "status " cls))
    (set! (.-textContent el) text)))

(defn- show-error! [message]
  (let [el ($ "preview-error")]
    (set! (.-textContent el) message)
    (set! (.-hidden el) (string/blank? message))
    (when-not (string/blank? message)
      (status! "error" "error"))))

(defonce ^:private boundary
  ;; the error boundary's key: a new one remounts the app, with fresh state
  (atom 0))

(defn- Preview
  "Renders the app's App, its props' app, as part of itself: each edit
  defines a new App, which React would remount as a component of another
  type, losing its state (useState)."
  [^js props]
  ((.-app props)))

(defonce ^:private failed?
  ;; whether the last render threw with fresh state: its boundary stays
  ;; showing nothing, the next render needs a new one
  (atom false))

(defn- render!
  "Renders App in the preview, keeping its state. If it throws, i.e. an edit
  changed the hooks it calls, it's remounted with fresh state (fresh? true),
  and an error then is shown."
  ([App] (render! App @failed?))
  ([App fresh?]
   (show-error! "")
   (reset! failed? false)
   (when fresh? (swap! boundary inc))
   (.render @root
     #x [ErrorBoundary {:key @boundary
                        :onError (fn [e]
                                   (if fresh?
                                     (do (reset! failed? true)
                                         (show-error! (str "Render error: " (ex-message e))))
                                     ;; after the commit that caught it
                                     (js/queueMicrotask #(render! App true))))}
         [Preview {:app App}]])))

(defn- evaluate! [run]
  (let [code (str (.-value ($ "code")))]
    (status! "busy" "compiling…")
    (-> (selfhost/eval-str code {:ns app-ns :print false})
        (.then (fn [{:keys [error warnings]}]
                 (if error
                   {:error (string/join "\n" (cons error (map (fn [{:keys [message line column]}]
                                                                (str "WARNING: " message " (" line ":" column ")"))
                                                              warnings)))}
                   (selfhost/eval-str "App" {:ns app-ns :print false}))))
        (.then (fn [{:keys [value error]}]
                 (when (= run @runs)
                   (cond
                     error (show-error! error)
                     (not (fn? value)) (show-error! "Define App, the component the preview renders: (defn App [] #x [:p \"Hi\"])")
                     :else (do (render! value)
                               (status! "ok" "compiled")))))))))

(defonce ^:private running
  ;; a promise of the run being evaluated: runs don't overlap, the forms of
  ;; one would redefine the vars of the next
  (atom (js/Promise.resolve nil)))

(defn- run-code!
  "Evaluates the code in the app's namespace, renders its App: after the run
  being evaluated, unless the code changed again meanwhile."
  []
  (let [run (swap! runs inc)]
    (swap! running
      (fn [p]
        (-> p
            (.then #(when (= run @runs) (evaluate! run)))
            (.catch (fn [e] (show-error! (str (ex-message e))))))))))

(defonce ^:private pending (atom nil))

(defn- highlight! []
  (let [code (str (.-value ($ "code")))]
    (set! (.-rows ($ "code")) (max 1 (count (string/split-lines (str code " ")))))
    (set! (.-innerHTML ($ "code-highlight")) (str (repl/highlight code) "\n"))))

(defn- on-input []
  (highlight!)
  (try (js/localStorage.setItem storage-key (.-value ($ "code")))
       (catch :default _))
  (some-> @pending js/clearTimeout)
  (reset! pending (js/setTimeout run-code! 300)))

(defn- insert!
  "Inserts text at the editor's cursor, as typing does (undo too)."
  [text]
  (js/document.execCommand "insertText" false text))

(defn- on-key
  "Tab indents, Enter keeps the line's indentation."
  [^js e]
  (let [el   ($ "code")
        code (.-value el)
        at   (.-selectionStart el)]
    (cond
      (and (= "Tab" (.-key e)) (not (.-shiftKey e)) (not (.-metaKey e)) (not (.-ctrlKey e)))
      (do (.preventDefault e) (insert! "  "))

      (and (= "Enter" (.-key e)) (not (.-shiftKey e)) (not (.-metaKey e)) (not (.-ctrlKey e)))
      (let [line-start (inc (.lastIndexOf code "\n" (dec at)))
            indent     (re-find #"^ *" (subs code line-start at))]
        (.preventDefault e)
        (insert! (str "\n" indent))))))

(defn- reset-code! []
  (let [el ($ "code")]
    (.focus el)
    (.select el)
    (insert! sample)))

(defn init []
  (selfhost/provide-module! "react" react)
  (let [el ($ "code")]
    (set! (.-value el) (or (try (js/localStorage.getItem storage-key) (catch :default _ nil))
                           sample))
    (highlight!)
    (.addEventListener el "input" on-input)
    (.addEventListener el "keydown" on-key))
  (.addEventListener ($ "reset") "click" reset-code!)
  (-> (repl/init! {:examples  examples
                   :init-code prelude
                   :focus     false})
      (.then run-code!)))

(when (exists? js/document)
  (init))
