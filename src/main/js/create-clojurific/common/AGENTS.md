# Agent notes

A ClojureScript {{kind}} compiled by [Clojurific](https://github.com/WhimsicalCode/clojurific)
and bundled by Vite: the sources are in `src/{{nsDir}}/`, the build in `vite.config.ts`, the
ClojureScript dependencies in `deps.edn`. See `README.md`.

## The REPL's MCP server

The dev server (`npm run dev`) runs an MCP server, the `clojurific` server of `.mcp.json`
(`npx cljf mcp`), whose tools evaluate in the {{runtimes}} running the app:

- `build_status`, `runtimes`: the last compile (its error or warnings) and the runtimes
  connected.{{openPage}}
- `eval`: evaluates ClojureScript in a runtime, i.e. to inspect state{{evalExample}}. Every
  runtime tool takes `runtime_id`, an id of `runtimes` or a tag.
- `wait_for_reload`: after editing source files, call it with them to see the edit compiled and
  hot reloaded, or the error or warnings holding it back.
- `console_logs`: the runtime's console output and uncaught errors; `vite_errors`: the dev
  server's own errors, i.e. of TypeScript or CSS.
- `load_file`, `tag_runtime`, `namespaces`, `ns_info`, `doc`, `source`, `apropos`, `macroexpand`.

`*ns*` is nil at runtime, as in all ClojureScript: `eval`'s result has the namespace.
