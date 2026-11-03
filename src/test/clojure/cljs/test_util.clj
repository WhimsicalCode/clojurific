;; Copyright (c) Rich Hickey. All rights reserved.
;; The use and distribution terms for this software are covered by the
;; Eclipse Public License 1.0 (http://opensource.org/licenses/eclipse-1.0.php)
;; which can be found in the file epl-v10.html at the root of this distribution.
;; By using this software in any fashion, you are agreeing to be bound by
;; the terms of this license.
;; You must not remove this notice, or any other, from this software.

(ns cljs.test-util
  (:require [clojure.string :as string]
            [clojure.test]))

(defn unsplit-lines
  "Forms a string wherein each line is followed by a system-dependent newline.
  Roughly an inverse of clojure.string/split-lines."
  [lines]
  (with-out-str
    (run! println lines)))

(defn equiv-modulo-newlines
  "Returns whether strings are equivalent, disregarding differences in
  embedded system-dependent newlines."
  [s & more]
  (== 1 (count (group-by string/split-lines (list* s more)))))

(defmethod clojure.test/assert-expr 'thrown-with-cause-msg? [msg form]
  ;; (is (thrown-with-cause-msg? c re expr))
  ;; Asserts that evaluating expr throws an exception of class c.
  ;; Also asserts that the message string of the *cause* exception matches
  ;; (with re-find) the regular expression re.
  (let [klass (nth form 1)
        re    (nth form 2)
        body  (nthnext form 3)]
    `(try ~@body
          (clojure.test/do-report {:type :fail, :message ~msg, :expected '~form, :actual nil})
          (catch ~klass e#
            (let [m# (if (.getCause e#) (.. e# getCause getMessage) (.getMessage e#))]
              (if (re-find ~re m#)
                (clojure.test/do-report {:type     :pass, :message ~msg,
                                         :expected '~form, :actual e#})
                (clojure.test/do-report {:type     :fail, :message ~msg,
                                         :expected '~form, :actual e#})))
            e#))))
