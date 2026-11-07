(ns clojurific.play
  "The playground (clojurific.dev/play/): a React app edited in the page,
  compiled by the self-hosted compiler (cljf.selfhost) as you type and
  rendered next to it, and a REPL in the app's namespace."
  (:require ["../error-boundary.js" :refer [ErrorBoundary]]
            ["react" :as react]
            ["react-dom/client" :as rdc]
            [cljf.selfhost :as selfhost]
            [cljf.webmcp :as webmcp]
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

(defn- evaluate!
  "Evaluates the editor's code, renders its App: a promise of {:error} or
  {:rendered true}, {:stale true} when the code changed meanwhile."
  [run]
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
                 (if (not= run @runs)
                   {:stale true}
                   (let [error (cond
                                 error error
                                 (not (fn? value)) "Define App, the component the preview renders: (defn App [] #x [:p \"Hi\"])")]
                     (if error
                       (do (show-error! error) {:error error})
                       (do (render! value)
                           (status! "ok" "compiled")
                           {:rendered true})))))))))

(defonce ^:private running
  ;; a promise of the run being evaluated: runs don't overlap, the forms of
  ;; one would redefine the vars of the next
  (atom (js/Promise.resolve nil)))

(defn- run-code!
  "Evaluates the code in the app's namespace, renders its App: after the run
  being evaluated, unless the code changed again meanwhile. A promise of
  evaluate!'s result."
  []
  (let [run (swap! runs inc)]
    (swap! running
      (fn [p]
        (-> p
            (.then #(if (= run @runs) (evaluate! run) {:stale true}))
            (.catch (fn [e]
                      (let [error (str (ex-message e))]
                        (show-error! error)
                        {:error error}))))))))

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

(defn- set-code!
  "Replaces the editor's code, as typing does (its undo too)."
  [code]
  (let [el ($ "code")]
    (.focus el)
    (.select el)
    (insert! code)
    ;; the input event's debounced run is the one awaited instead
    (some-> @pending js/clearTimeout)))

;; WebMCP: the app's tools for agents in the browser, with cljf.webmcp's

(defn- preview-state
  "The preview: its text and any error, what an agent sees of it."
  []
  (let [err ($ "preview-error")]
    (cond-> {:text (str (.-innerText ($ "preview-root")))
             :html (let [h (str (.-innerHTML ($ "preview-root")))]
                     (if (> (count h) 20000) (str (subs h 0 20000) "…") h))}
      (not (.-hidden err)) (assoc :error (str (.-textContent err))))))

(defn- result [m]
  (js/JSON.stringify (clj->js m) nil 1))

(defn- after-render
  "A promise resolving once React committed the render and the browser
  painted."
  []
  (js/Promise. (fn [resolve] (js/requestAnimationFrame #(js/setTimeout resolve 50)))))

(def ^:private app-tools
  [{:name        "playground_get_code"
    :description "The code in the playground's editor: the React app the preview renders, in namespace app. Its App component is rendered; react is required as react; use-atom (a hook rendering a component again when an atom changes) is defined."
    :inputSchema {:type "object" :properties {}}
    :annotations {:readOnlyHint true}
    :execute     (fn [_] (result {:code (str (.-value ($ "code")))}))}
   {:name        "playground_set_code"
    :description (str "Replaces the code in the playground's editor and runs it, as if the user typed it: its forms are evaluated in namespace app, "
                      "then its App component is rendered in the preview (#x [:tag ...] literals are React elements, hiccup compiled to JSX). "
                      "Returns the compile or render error, or the preview's text and HTML. defonce keeps state across edits. The user can undo it in the editor.")
    :inputSchema {:type       "object"
                  :properties {:code {:type "string" :description "The whole app's code, defining App."}}
                  :required   ["code"]}
    :execute     (fn [^js input]
                   (set-code! (str (.-code input)))
                   (-> (run-code!)
                       (.then (fn [r] (.then (after-render) (fn [_] r))))
                       (.then (fn [{:keys [error]}]
                                (result (if error {:error error} (assoc (preview-state) :rendered true)))))))}
   {:name        "playground_preview"
    :description "The playground's preview: the rendered app's text and HTML, and its compile or render error if any."
    :inputSchema {:type "object" :properties {}}
    :annotations {:readOnlyHint true}
    :execute     (fn [_] (result (preview-state)))}])

(defonce ^:private badge-timer (atom nil))

(defn- agent-called!
  "Shows on the WebMCP badge that an agent called a tool."
  [tool _]
  (let [el ($ "webmcp")]
    (.add (.-classList el) "active")
    (set! (.-textContent el) (str "WebMCP · " tool))
    (some-> @badge-timer js/clearTimeout)
    (reset! badge-timer
      (js/setTimeout #(do (.remove (.-classList el) "active")
                          (set! (.-textContent el) "WebMCP"))
                     1500))))

(defn- show-webmcp-badge!
  "Shows the WebMCP badge, next to the REPL's heading, listing the tools in
  its tooltip."
  [names]
  (let [el ($ "webmcp")]
    (set! (.-title el) (str "Agents in this browser can use the playground through WebMCP:\n"
                            (string/join "\n" names)))
    (set! (.-hidden el) false)))

(defn- register-webmcp!
  "Registers the playground's WebMCP tools: cljf.webmcp's, evaluating in the
  app's namespace and shown in the REPL's log, and the app's. Shows the
  WebMCP badge when the browser has WebMCP."
  []
  (when (webmcp/model-context)
    (show-webmcp-badge!
      (concat (map #(str "cljs_" %) ["eval" "doc" "apropos" "ns_info" "macroexpand" "namespaces"])
              (map :name app-tools))))
  (webmcp/register!
    {:ns          app-ns
     :on-call     agent-called!
     :before-eval #(repl/entry! "in agent" % :code {:prefix "agent> "})
     :after-eval  (fn [_ {:keys [value error]}]
                    (if error
                      (repl/entry! "error" error)
                      (repl/entry! "value" (str value) :code {})))
     :tools       app-tools}))

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
      (.then run-code!)
      (.then register-webmcp!)))

(when (exists? js/document)
  (init))
