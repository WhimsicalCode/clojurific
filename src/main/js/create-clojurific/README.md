# create-clojurific

Scaffolds a ClojureScript project compiled by
[Clojurific](https://github.com/WhimsicalCode/clojurific) and bundled by
[Vite](https://vite.dev):

```sh
npm create clojurific@latest
```

It asks for the project's name, a framework (Vanilla, [Reagent](https://reagent-project.github.io)
or [UIx](https://github.com/pitch-io/uix)), and whether to install the
dependencies and start the dev server. The project's namespace comes from its
name: `my-app` gets `src/my_app/core.cljs`, `my-app.core`. The compiler needs
Node.js 20 and Java 17 or later; when Java is missing, it offers to download
Eclipse Temurin before starting the dev server.

Projects have the scripts `dev` (Vite's dev server, hot reloading), `build`,
`preview`, and `repl`, a ClojureScript REPL evaluating in the pages the dev
server runs (`cljf repl`, through the dev server's nREPL server).

The options answer the questions, i.e. in scripts:

```sh
npm create clojurific@latest my-app -- --template reagent
npm create clojurific@latest my-app -- --template uix --immediate
```

| Option | |
|---|---|
| `-t`, `--template <name>` | `vanilla`, `reagent` or `uix` |
| `--overwrite` | remove the target directory's files |
| `-i`, `--immediate` | install the dependencies and start the dev server |
| `--no-interactive` | don't ask, use the defaults (`vanilla`, no install) |

pnpm, Yarn and Bun work too: `pnpm create clojurific`, `yarn create clojurific`,
`bun create clojurific`.

## License

Eclipse Public License 1.0, like ClojureScript.
