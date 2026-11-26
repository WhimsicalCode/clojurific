# {{name}}

A [Hono](https://hono.dev) app on [Cloudflare Workers](https://developers.cloudflare.com/workers/)
in ClojureScript, compiled by [Clojurific](https://github.com/WhimsicalCode/clojurific) and
bundled by [Vite](https://vite.dev).

- `npm run dev` starts the dev server, which runs the Worker in workerd (the
  Workers runtime) and hot reloads changed namespaces
- `npm run repl` starts a ClojureScript REPL evaluating in the Worker the dev
  server runs (start `npm run dev` first)
- `npm run build` bundles the Worker into `dist/worker/`, `npm run preview` runs the
  bundle in workerd
- `npm run deploy` builds and deploys it with `wrangler deploy`

The app is `src/{{nsDir}}/core.cljs`. It's compiled as a `:js-entries` module
exporting the Hono app and `Counter`, a Durable Object class (see
`vite.config.ts`), which `worker.js`, the Worker's `main` in `wrangler.jsonc`,
re-exports. [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/)
runs it in workerd and bundles it. Changed namespaces are hot reloaded in place.
`Counter` keeps the clicks of `POST /clicks` in its storage, which outlives the
Worker's isolates, unlike a value in an atom.

Bindings (Durable Objects, KV, R2, variables) are declared in `wrangler.jsonc`;
the app reads them from Hono's context, `(.. c -env -COUNTER)`. Secrets for the
dev server go in `.dev.vars`.

ClojureScript dependencies go in `deps.edn`, npm packages in `package.json`.
The compiler needs Java 17 or later: `npx cljf setup-java` downloads one.

Editors connect to the dev server's nREPL server, its port in `.nrepl-port`
(i.e. Calva's "Connect to a running REPL", CIDER's `cider-connect-clj`), and
evaluate `(cljf.esm.repl/repl)` to switch the session to ClojureScript. Its
cider-nrepl middleware completes the build's namespaces and vars and the
runtime's JavaScript properties, for editors and Tab in `npm run repl`.
