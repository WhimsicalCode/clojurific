(ns clojurific.play
  "The playground (clojurific.dev/play/): a REPL in the page, its forms
  compiled and evaluated by the self-hosted compiler (cljf.selfhost)."
  (:require ["../../../src/main/js/cljf/highlight.js" :as hl]
            [cljf.selfhost :as selfhost]
            ;; namespaces the playground's forms can require
            [cljs.pprint]
            [clojure.data]
            [clojure.edn]
            [clojure.set]
            [clojure.string :as string]
            [clojure.walk]
            [clojure.zip]))

(def ^:private examples
  [["map" "(map inc [1 2 3])"]
   ["for" "(for [x (range 5) :when (odd? x)] (* x x))"]
   ["defn" "(defn greet [name]\n  (str \"Hello, \" name \"!\"))\n(greet \"Clojurific\")"]
   ["atom" "(def counter (atom 0))\n(swap! counter inc)"]
   ["require" "(require '[clojure.string :as str])\n(str/upper-case \"es modules\")"]
   ["interop" "(.toUpperCase (.-title js/document))"]
   ["promise" "(js/Promise.resolve {:awaited true})"]])

(defn- $ [id] (js/document.getElementById id))

(defonce ^:private history
  (atom (or (try (vec (js->clj (js/JSON.parse (js/localStorage.getItem "cljf-play-history"))))
                 (catch :default _ nil))
            [])))

(defonce ^:private history-pos (atom nil))

(defonce ^:private out-el
  ;; the log entry the output printed since the last one goes to
  (atom nil))

(defn- escape [s]
  (-> s
      (string/replace "&" "&amp;")
      (string/replace "<" "&lt;")
      (string/replace ">" "&gt;")))

(defn- highlight
  "code as HTML, its tokens (cljf repl's tokenizer, cljf/highlight.js) in
  spans of their type's class."
  [code]
  (loop [[^js t & ts] (hl/tokenize code) at 0 out ""]
    (if t
      (recur ts (.-end t)
        (str out (escape (subs code at (.-start t)))
             "<span class=\"tok-" (.-type t) "\">" (escape (subs code (.-start t) (.-end t))) "</span>"))
      (str out (escape (subs code at))))))

(defn- scroll! []
  (let [log ($ "log")]
    (set! (.-scrollTop log) (.-scrollHeight log))))

(defn- entry!
  "Adds an entry to the log, code highlighted."
  [cls text & {:keys [code]}]
  (let [e (js/document.createElement "pre")]
    (set! (.-className e) (str "entry " cls))
    (if code
      (set! (.-innerHTML e) (str (escape (or (:prefix code) "")) (highlight text)))
      (set! (.-textContent e) text))
    (.appendChild ($ "log") e)
    (reset! out-el nil)
    (scroll!)
    e))

(defn- print! [cls s]
  (let [e (or @out-el (doto (entry! cls "") (->> (reset! out-el))))]
    (set! (.-textContent e) (str (.-textContent e) s))
    (scroll!)))

(defn- prompt [] (str (.-textContent ($ "prompt"))))

(defn- complete?
  "Whether code's brackets and strings are closed: Enter evaluates it, or
  starts a new line."
  [code]
  (loop [i 0 depth 0 in-str? false]
    (if (>= i (count code))
      (and (not in-str?) (<= depth 0))
      (let [c (.charAt code i)]
        (cond
          in-str?          (case c
                             "\\" (recur (+ i 2) depth true)
                             "\"" (recur (inc i) depth false)
                             (recur (inc i) depth true))
          (= c "\\")       (recur (+ i 2) depth false)
          (= c "\"")       (recur (inc i) depth true)
          (= c ";")        (let [nl (.indexOf code "\n" i)]
                             (if (neg? nl)
                               (<= depth 0)
                               (recur nl depth false)))
          (#{"(" "[" "{"} c) (recur (inc i) (inc depth) false)
          (#{")" "]" "}"} c) (recur (inc i) (dec depth) false)
          :else            (recur (inc i) depth false))))))

(defn- resize!
  "Sizes the input to its lines, and highlights it in the layer under it."
  []
  (let [input ($ "input")
        code  (str (.-value input))]
    (set! (.-rows input) (max 1 (count (string/split-lines (str code " ")))))
    ;; a trailing newline needs a line of its own
    (set! (.-innerHTML ($ "input-highlight")) (str (highlight code) "\n"))))

(defn- busy! [busy?]
  (.toggle (.-classList ($ "repl")) "busy" busy?))

(defn- remember! [code]
  (when-not (= code (peek @history))
    (swap! history #(vec (take-last 200 (conj % code))))
    (try (js/localStorage.setItem "cljf-play-history" (js/JSON.stringify (clj->js @history)))
         (catch :default _))))

(defn- eval! [code]
  (when-not (string/blank? code)
    (remember! code)
    (reset! history-pos nil)
    (entry! "in" code :code {:prefix (str (prompt) " ")})
    (busy! true)
    (-> (selfhost/eval-str code {:await true :print-length 100 :print-level 12})
        (.then (fn [{:keys [value error warnings ns]}]
                 (doseq [{:keys [message line column]} warnings]
                   (entry! "warning" (str "WARNING: " message " (" line ":" column ")")))
                 (if error
                   (entry! "error" error)
                   (entry! "value" value :code {}))
                 (set! (.-textContent ($ "prompt")) (str ns "=>"))
                 (busy! false))))))

(defn- history-step!
  "Shows the history entry before (-1) or after (1) the one shown."
  [delta]
  (let [n   (count @history)
        pos (+ (or @history-pos n) delta)]
    (when (<= 0 pos n)
      (reset! history-pos pos)
      (set! (.-value ($ "input")) (get @history pos ""))
      (resize!))))

(defn- on-key [^js e]
  (let [input ($ "input")
        code  (.-value input)]
    (cond
      (and (= "Enter" (.-key e)) (not (.-shiftKey e)) (complete? code))
      (do (.preventDefault e)
          (set! (.-value input) "")
          (resize!)
          (eval! (string/trim code)))

      (and (= "ArrowUp" (.-key e)) (not (string/includes? (subs code 0 (.-selectionStart input)) "\n")))
      (do (.preventDefault e) (history-step! -1))

      (and (= "ArrowDown" (.-key e)) (not (string/includes? (subs code (.-selectionEnd input)) "\n")))
      (do (.preventDefault e) (history-step! 1))

      (and (= "l" (.-key e)) (.-ctrlKey e))
      (do (.preventDefault e)
          (set! (.-innerHTML ($ "log")) "")))))

(defn- example-buttons []
  (let [div (js/document.createElement "div")]
    (set! (.-className div) "examples")
    (doseq [[label code] examples]
      (let [b (js/document.createElement "button")]
        (set! (.-textContent b) label)
        (set! (.-title b) code)
        (.addEventListener b "click" #(do (eval! code) (.focus ($ "input"))))
        (.appendChild div b)))
    div))

(defn init []
  ;; the analysis caches next to the page (vite.config.mjs), the dev
  ;; server's output directory otherwise
  (when-not (js* "import.meta.env.DEV")
    (selfhost/set-analysis-root! "analysis/"))
  (set! *print-newline* true)
  (set! *print-fn* #(print! "out" %))
  (set! *print-err-fn* #(print! "err" %))
  (.appendChild ($ "log") (example-buttons))
  (let [input ($ "input")]
    (.addEventListener input "keydown" on-key)
    (.addEventListener input "input" resize!)
    (.addEventListener ($ "repl") "click"
      #(when (string/blank? (str (.toString (js/getSelection)))) (.focus input)))
    (.focus input))
  ;; loads the compiler, cljs.core's analysis and macros
  (busy! true)
  (-> (selfhost/eval-str "nil" {:ns "cljs.user"})
      (.then (fn [_]
               (busy! false)
               (when-let [code (.get (js/URLSearchParams. (.-search js/location)) "code")]
                 (eval! code))))))

(when (exists? js/document)
  (init))
