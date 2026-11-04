# create-clojurific

Scaffolds a ClojureScript project compiled by
[Clojurific](https://github.com/WhimsicalCode/clojurific) and bundled by
[Vite](https://vite.dev):

```sh
npm create clojurific@latest
```

It asks for the project's name, a framework (Vanilla, [React](https://react.dev/) with `#x` literals, [Reagent](https://reagent-project.github.io/),
[UIx](https://uix-cljs.dev/), or [Hono](https://hono.dev/) for a backend),
for React, Reagent and UIx whether to add [uni.style](https://github.com/WhimsicalCode/uni.style),
and whether to install the dependencies and start the dev server. The project's namespace comes from its
name: `my-app` gets `src/my_app/core.cljs`, `my-app.core`. The compiler needs
Node.js 20 and Java 17 or later; when Java is missing, it offers to download
Eclipse Temurin before starting the dev server.

Projects have the scripts `dev` (Vite's dev server, hot reloading), `build`,
`preview`, and `repl`, a ClojureScript REPL evaluating in the pages the dev
server runs (`cljf repl`, through the dev server's nREPL server).

The Hono project is a backend without pages: its app is a namespace the dev
server runs with [`@hono/vite-dev-server`](https://github.com/honojs/vite-plugins),
hot reloading it, and its REPL evaluates there. `build` bundles it into a
Node.js server, `dist/index.js`, which `start` runs.

uni.style, an add-on to the React, Reagent and UIx templates, styles the app
with compile-time atomic CSS instead of `src/style.css`: `(s/c (s/flex) (s/p 8))`
in components, which its macros compile to `public/css/bundle.css` (its build
hook in `vite.config.ts`), and light and dark themes in `src/my_app/theme.cljs`.

The options answer the questions, i.e. in scripts:

```sh
npm create clojurific@latest my-app -- --template reagent
npm create clojurific@latest my-app -- --template uix --immediate
npm create clojurific@latest my-app -- --template reagent --unistyle
npm create clojurific@latest my-api -- --template hono
```

| Option | |
|---|---|
| `-t`, `--template <name>` | `vanilla`, `react`, `reagent`, `uix` or `hono` |
| `--unistyle` | add uni.style (`react`, `reagent`, `uix`) |
| `--overwrite` | remove the target directory's files |
| `-i`, `--immediate` | install the dependencies and start the dev server |
| `--no-interactive` | don't ask, use the defaults (`vanilla`, no add-ons, no install) |

pnpm, Yarn and Bun work too: `pnpm create clojurific`, `yarn create clojurific`,
`bun create clojurific`.

## License

Eclipse Public License 1.0, like ClojureScript.
