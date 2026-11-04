(ns {{themeNs}}
  "The page's base styles and its light and dark themes. uni.style's macros
  compile them, as every s/ call, into public/css/bundle.css: the build hook
  in vite.config.ts writes it after each compile, index.html loads it."
  (:require [uni.style.colors :as sc]
            [uni.style.core :as s]
            [uni.style.preflight :refer [import-preflight]]))

;; Tailwind's Preflight, a browser reset, in the base layer
(import-preflight)

(s/def-theme light)
(s/def-theme dark)

;; tokens are CSS variables, their value the root's theme's (or the last,
;; the default)
(s/def-token background
  dark (sc/neutral 10)
  sc/white)

(s/def-token foreground
  dark (sc/neutral 95)
  (sc/neutral 15))

(s/def-token muted
  dark (sc/neutral 65)
  (sc/neutral 45))

(s/def-token surface
  dark (sc/neutral 20)
  (sc/neutral 96))

(s/def-token accent
  dark (sc/orange 65)
  (sc/orange 55))

(s/def-token color-scheme
  dark "dark"
  "light")

(s/def-base "html"
  (s/bg background)
  (s/color foreground)
  (s/antialiased)
  (s/raw {:color-scheme (s/str color-scheme)}))

;; the page's theme follows the system's light or dark preference
(s/set-theme-system! light dark)
