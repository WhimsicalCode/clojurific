# The REPL's MCP server

Design of the MCP (Model Context Protocol) server that gives coding agents the REPL's capabilities in dev mode: evaluating ClojureScript in the runtimes, seeing edits compiled and hot reloaded, the build's status, and looking up the build's namespaces and vars.

## Enabling it

It's configured like the nREPL server, under `:repl`:

```clojure
;; cljs.edn
{:repl {:mcp-port 0}}   ; with :nrepl-port too, or alone
```

```js
// vite.config.ts
cljf({ compilerOptions: { repl: { mcpPort: 0 } } })
```

- `:mcp-port`: `0` picks a free port, or a fixed one.
- `:mcp-host`: `127.0.0.1` by default. It has to be a loopback address.
- `:mcp-port-files`: `[".cljf/mcp-port"]` by default. A port file is written only if no other live server has its port in it, and is deleted on exit, as nREPL's `.nrepl-port` is.

## Architecture

```
agent ──stdio──▶ cljf mcp ──HTTP──▶ watcher's JVM: cljf.esm.mcp ──▶ cljf.esm.repl ──▶ runtimes
      └─(fixed port: HTTP directly)──▲
```

- **The server runs in the watcher's JVM** (`cljf.esm.mcp`), which `cljf.esm.repl/start!` starts under `:mcp-port`. It runs alongside the REPL, the compiler environment and the build's status. It serves MCP's Streamable HTTP at `/mcp`, with JSON responses only (no tool streams), on the JDK's own HTTP server. That means no dependencies, and no nREPL.
- **It works wherever the REPL works:** the Vite dev server, `vite build --watch` with `replSocket`, and `cljf watch`.
- **`cljf mcp`** (`src/main/js/cljf/mcp.js`) is a stdio bridge, which is how agents are configured:

  ```json
  { "mcpServers": { "clojurific": { "command": "npx", "args": ["cljf", "mcp"] } } }
  ```

  - It reads `.cljf/mcp-port` for every request, so it reconnects across dev server restarts.
  - It lists the tools before the dev server is up, from its copy `mcp-tools.json`.
  - Without a server, it answers `initialize` itself, saying how to start one, and tool calls fail with the same message.
  - With a fixed `:mcp-port`, agents can use `http://127.0.0.1:<port>/mcp` directly.
  - `--dir <dir>` reads `<dir>/.cljf/mcp-port`, for an agent started in another directory (a monorepo's root, with a server per project). Files the agent names relative to its own directory are passed as absolute paths.
- **Security:** the tools compile forms in the JVM, running their macros, so only this machine may connect:
  - the server binds a loopback address;
  - it accepts loopback clients only;
  - it rejects a `Host` header naming anything other than a loopback name, which blocks pages of other sites through DNS rebinding;
  - it rejects every request with an `Origin` header, which browsers send and MCP clients don't: a page of this machine, on any port (another dev server's, a script in the app's page), could run code otherwise;
  - it only accepts JSON (`Content-Type: application/json`), which a page can't send without a preflight request, which the server refuses.

## Runtimes

- **Every runtime tool requires `runtime_id`:** `eval`, `load_file`, `wait_for_reload` and `tag_runtime`. It's an id of `runtimes` or a tag. Agents can't see which tab the user focused, and a default changing as the user switches tabs would confuse them.
- **A browser tab keeps its id when it's reloaded.**
  - The page keeps a random tab key in `sessionStorage` and sends it in `hello`.
  - The Vite plugin gives a tab key the id it had, if no live runtime holds it.
  - A tab opened by another one has a copy of its `sessionStorage`, so the same key: it gets a new id, and a key of its own in `welcome`.
  - Other runtimes (servers, worker threads, bundles) get a new id when they restart.
- **Runtimes carry a `kind`:** `browser`, `server`, `worker` or `bundle`, from the runtime's `hello`. `focused` marks the tab the user focused last, for the agent's information only.
- **Unknown runtimes are tool errors that list the runtimes connected.** For one that disconnected lately, the error says when, and notes that a page may be reloading.

## Session start

The `initialize` result's `instructions` give a snapshot for the agent's context:
- the project and the dev server's URLs (the Vite plugin sends its config file and `ignoreWarnings` on a `dev-server` REPL message once the compiler starts, middleware mode included, and again with the URLs once the server listens);
- the build's status;
- the runtimes connected, up to 10;
- how to use `runtime_id` and `wait_for_reload`.

The snapshot isn't updated during the session, and the instructions say so.

## Tools

Results have a text `content` for the model and `structuredContent`. Values are printed with `*print-length*` 50 and `*print-level*` 8 unless given, and long texts are truncated at 20,000 characters. Failures (errors, warnings, a disconnected runtime) set `isError`.

| tool | |
|---|---|
| `runtimes` | the runtimes, and the dev server's URLs |
| `build_status` | compiling or not; the last compile, or its error with a source excerpt; the warnings holding back hot reloads; the runtimes |
| `eval` | `cljf.esm.repl/cljs-eval`: `code`, `runtime_id`, `ns`, `await`, `timeout_ms`, `warnings_ok`, `print_length`, `print_level` |
| `load_file` | `cljf.esm.repl/load-file` |
| `wait_for_reload` | compiles `files` unless the watcher did, then waits for the runtime to run the build's last compile. Results: `reloaded`, `error`, `warnings`, `timeout`, `no-runtime` |
| `tag_runtime` | `cljf.esm.repl/tag!` |
| `console_logs` | the runtime's last 500 `console.*` calls, uncaught errors and unhandled rejections, read with a `logs` runtime op, their stacks mapped to the sources. `since` (a previous call's `cursor`, which names the page load: a reloaded page's entries all come back), `levels`, `limit` |
| `vite_errors` | the dev server's own errors, which the plugin sends on `vite-error` REPL messages: its overlay's (until an update replaces it) and the last 50 it logged, not the compiler's (`build_status`) nor the pages' (`console_logs`) |
| `namespaces` | the build's namespaces and their files |
| `ns_info` | a namespace's file, docstring, publics with arglists, requires and dependents |
| `doc`, `source`, `apropos`, `macroexpand` | from a copy of the compiler environment no compile is changing |

`script/gen-mcp-tools` writes the bridge's copy of the tools, `src/main/js/cljf/mcp-tools.json`.

### The console's log

- The runtime records it only when the build has the MCP server: under `:mcp-port` the watcher defines `cljf.esm.repl-runtime/CONSOLE_LOG`.
- It wraps the console's methods. The Vite plugin adds the runtime to `server.sourcemapIgnoreList` (as well as Vite's default, or the project's own list), so browsers show the code logging as a message's source rather than the wrapper.
- It records the console's arguments as bounded text: JavaScript objects 2 levels deep, 10 keys each, without calling getters; ClojureScript values with `*print-length*` 20 and `*print-level*` 4.
- In Node.js it records uncaught exceptions and unhandled rejections with `uncaughtExceptionMonitor`, which changes nothing else. An `unhandledRejection` listener would turn off Node.js' default handling of them (exiting).

### The build's status

- The watcher keeps one error per failing file (`cljf.esm/compiled-status`).
- A later compile of other files succeeding doesn't clear a file's error: the watcher only compiles a file again once it changes. A successful compile of that file does, whether it changed or was compiled as a dependent. A full build clears them all, and any successful compile clears an error without a file.
- `build_status` and `wait_for_reload` report the errors outstanding, most recent first.
- `wait_for_reload` only compiles the Clojure and ClojureScript files it's given; it lists the others as skipped, since Vite reloads them.
- `wait_for_reload` waits for the runtime despite warnings when the dev server ignores them (`ignoreWarnings`).

### Before the first build

The watcher starts the MCP server before its first build, which can take minutes when cold. Until the build is done, the session's instructions and `build_status` say it's compiling, and the other tools fail with that.

## create-clojurific

Its templates start the MCP server (`mcpPort: 0`), and every project gets `.mcp.json` (configuring `cljf mcp`) and an `AGENTS.md` explaining the tools, from `create-clojurific/common/`.

## Later

- A console log from the start of a page's load, i.e. errors before the REPL runtime ran: the runtime records from when it's first imported, which the main namespaces do first.

## Not included

- `clj_eval`, evaluating Clojure in the compiler's JVM:
  - it adds running any code as the user to browser-only projects;
  - it can wedge the JVM (a loop can't be stopped on Java 20 and later) or corrupt the build;
  - it's rarely needed: macros are used through `eval` and changed by editing their files.

  nREPL (`:nrepl-port`) gives Clojure evaluation to those who need it.
- Screenshots and DOM interaction: browser MCP servers do these.
- Completion, MCP resources and prompts.

## Several dev servers

- Projects in separate directories already work: each one has its own `.cljf/mcp-port` and its own entry in the agent's config.
- Two dev servers in the same directory: the second can't take the port file (it warns, as nREPL does) and is reached with `cljf mcp --port <port>`.
- Each server's instructions name its Vite config file, so the agent knows which build it's talking to.
