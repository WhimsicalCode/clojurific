# Changelog

Changes since Clojurific was forked from ClojureScript. For ClojureScript's own
releases, see its [changelog](https://github.com/clojure/clojurescript/blob/master/changes.md).

## 0.12.4 [Next]

## 0.12.3 [2026-10-08]

### Fixed

- ClojureScript sources imported only from JavaScript or TypeScript modules weren't compiled. The Vite plugin now follows the pages' modules through relative and root-absolute imports to find them.
- Released compilers (0.12.2 from npm and Clojars) recompiled every namespace on every build: output compiled by a version like `1.12.clojurific-0.12.2` wasn't recognised as up to date.
- Page scripts loading ClojureScript sources with a query or fragment (`/src/app.cljs?v=1`) weren't compiled or rewritten in dev.
- Builds of several pages with the same file name in different directories (`index.html`, `about/index.html`) kept only one of them.
- The Vite dev server no longer serves ClojureScript sources outside Vite's root and `server.fs.allow`.
- `cljf watch` and its JVM kept running after a SIGINT sent only to `cljf`, i.e. by an IDE or a process supervisor.

## 0.12.2 [2026-10-08]

### Added

- The Clojars artifact `com.whimsical/clojurific`, for the Clojure CLI and Leiningen.

### Changed

- The npm package gets the compiler from Clojars (`com.whimsical/clojurific` of its version) instead of including its sources, which makes it 35 KB instead of 650 KB.
- Released compilers report their version as ClojureScript's major and minor version with Clojurific's release, i.e. `1.12.clojurific-0.12.2`, in compiled files' headers and `cljs.core/*clojurescript-version*`, instead of a hash of their sources.

## 0.12.1 [2026-10-08]

### Added

- Forked from ClojureScript's master at [0142b46589](https://github.com/clojure/clojurescript/commit/0142b465892517c9f530ec180792443266dcbcb7), 26 commits after the 1.12.145 release.
- `:module-format :esm` compiles every namespace to an ES module without the Closure Compiler, leaving bundling, minification, npm packages and TypeScript to Vite. `cljs.esm` builds and watches with options files, profiles, build hooks and preloads, and builds reuse their previous output, recompiling the namespaces that depend on a changed API ([ESM.md](ESM.md)).
- A Vite plugin compiles for `vite build` and `vite build --watch` and watches for the dev server, which hot reloads changed namespaces. It shows compiler errors and warnings in Vite's overlay and pauses hot reloading while there are warnings, like shadow-cljs. Production bundles drop unused protocol implementations, shorten ClojureScript's property names and are minified, with source maps and licence comments kept. A project's `index.html` is the dev server's page and an input of builds, its scripts and JavaScript modules can load ClojureScript sources (`<script type="module" src="/src/my/app.cljs">`) whose namespaces are compiled without listing them in `:main`, and the plugin writes a manifest of the entry points' scripts for server-rendered pages.
- `:js-entries` generate entry modules exporting vars under JavaScript names, for libraries and workers.
- Generated test runners (`:test-runner`), run in Node.js or with Karma. Watching regenerates them as tests are added and removed.
- `:extra-main` adds namespaces to `:main`, as the Vite plugin does with the pages' scripts.
- `:optimize-constants` puts keyword and symbol constants in one shared module, `:warnings-as-errors` fails the compile on any warning, and `:checked-set-literals false` lets set literals collapse duplicates, as before CLJS-3415.
- shadow-cljs compatibility: `:npm-interop :shadow` binds CommonJS packages as shadow-cljs does, and `shadow.resource`, `shadow.lazy`'s API (`cljs.esm.lazy`) and `defclass` work as in shadow-cljs.
- A REPL into the pages running a watched build, with an nREPL server, `cljs_eval` in the browser's console (only from the dev server's machine unless `replRemoteConsole` is set) and error stacks mapped to ClojureScript sources.
- `cljs.esm` fails at startup, naming both locations, when stock ClojureScript (`org.clojure/clojurescript`) is on the classpath too. `no-clojurescript/` is an empty project that replaces it in a whole dependency tree through `:override-deps`.
- The npm package `clojurific`, with the `cljf` command, the Vite plugin (`clojurific/vite`) and the Karma adapter (`clojurific/karma`). `cljf` needs only Java and Node.js: it resolves `deps.edn` with tools.deps, adds the compiler, removes stock ClojureScript, and caches the classpath. Without Java 17 or later it explains how to install it, or downloads Eclipse Temurin with `cljf setup-java`.

### Changed

- The coordinate is `com.whimsical/clojurific`. Namespaces stay `cljs.*`, so libraries written for ClojureScript work unchanged.
- The Closure Compiler is optional: only the classic compiler (`cljs.closure`, `cljs.build.api`, `cljs.main` and its REPLs) needs it, through the `:closure` alias. The analyzer reads the default externs' types from `cljs/externs/default.edn`.

### Fixed

- `cljs.analyzer.api/resolve-extern`, compiled to JavaScript, no longer expands the JVM's `with-compiler-env`, which warned of `cljs.core/class`.
