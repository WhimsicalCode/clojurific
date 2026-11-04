
Styles are [uni.style](https://github.com/WhimsicalCode/uni.style)'s
utilities, i.e. `(s/c (s/flex) (s/p 8) (s/hover (s/bg theme/surface)))`,
which its macros compile to atomic CSS: the build hook in `vite.config.ts`
writes the CSS of every compile to `public/css/bundle.css`, which
`index.html` loads (and the dev server's pages reload). `src/{{nsDir}}/theme.cljs`
has the base styles and the light and dark themes' tokens. See uni.style's
[docs](https://github.com/WhimsicalCode/uni.style#usage).
