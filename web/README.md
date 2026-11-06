# clojurific.dev

The website, a Vite project built with the compiler in `..`:

- `index.html`: the home page.
- `play/`: the playground, ClojureScript compiled and evaluated in the page by the self-hosted compiler (`cljf.selfhost`, `:self-host`):
  - A React app's code (`#x` literals), compiled as you type. Its `App` is rendered in the preview next to it (`src/clojurific/play.cljs`), inside an error boundary (`src/error-boundary.js`). `App` is called by a stable wrapper component, so its `useState` state survives edits, unless an edit changes its hooks: then it's remounted.
  - Code the editor doesn't show is evaluated first (`prelude`): the `ns` form, and `use-atom`, a hook that renders a component again when an atom changes. The sample keeps its state in a `defonce` atom.
  - A REPL in the app's namespace (`src/clojurific/repl.cljs`), which sees the app's vars and changes its state: `(swap! state update :clicks + 10)`.
  - The code can require `react`, which the page provides, and the namespaces `play.cljs` requires.
  - Code is highlighted with `cljf repl`'s tokenizer (`../src/main/js/cljf/highlight.js`).
- `public/`: copied as is: the logo, the favicon and the fonts.
- Styling follows unidraw.dev:
  - Monsical for text, in `public/fonts/` and copied from unidraw.dev.
  - Poppins for headings, from Google Fonts.
  - White cards on `#f5f5f5`.

```sh
cd web
npm ci
npm run dev      # http://localhost:5173, the compiler's watch and hot reload
npm run build    # dist/
npm run preview  # serves dist/
```

`vite.config.mjs` runs the plugin from `../src/main/js/vite-plugin-cljs` with the Clojure CLI (`clojure -M`, the classpath of `deps.edn`). It sets two compiler options:

- `:self-host`: the compiler, and the macros of `cljs.core` and `#x` as lazily loaded chunks.
- `:esm-repl`: namespaces register themselves for the compiler in the page.

A bundle is built with `prune: false`. Forms compiled in the page use ClojureScript's property names and may call any protocol method, so these can be neither renamed nor pruned. The build copies the analysis caches the compiler reads to `dist/play/analysis/`.

`../.github/workflows/web.yml` builds and deploys it to GitHub Pages on pushes to `main` that change it or the compiler. The custom domain is the repository's Pages setting: a deploy from GitHub Actions ignores a `CNAME` file. The setup, done once:

1. Verify `clojurific.dev` in the organization's Pages settings, with the `TXT` record GitHub gives (`_github-pages-challenge-WhimsicalCode`).
2. Point the domain at GitHub Pages: `A` records 185.199.108.153, 185.199.109.153, 185.199.110.153 and 185.199.111.153, `AAAA` records 2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153 and 2606:50c0:8003::153, and `www` as a `CNAME` of `whimsicalcode.github.io`.
3. In the repository's Pages settings, set **Source: GitHub Actions** and **Custom domain: clojurific.dev**.
4. `.dev` is HSTS-preloaded, so the site only loads over HTTPS: enable *Enforce HTTPS* once GitHub has issued the certificate. If it isn't issued within an hour, remove the custom domain and add it again.

If GitHub Pages doesn't work out, Cloudflare Pages serves the same output: `npx wrangler pages deploy dist --project-name clojurific`.
