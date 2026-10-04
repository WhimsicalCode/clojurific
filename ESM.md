# ES module output without the Closure Compiler

`:module-format :esm` compiles every namespace to an ES module. Bundling,
minification, npm and TypeScript are left to standard JavaScript tooling
(Vite / Rolldown). The Closure Compiler isn't run, and externs aren't needed.

Status: experimental. The ClojureScript runtime test suite passes, and the
Whimsical app (3037 namespaces) compiles, bundles and boots in both production
and development builds. See [Status](#status).

## Usage

### Compiling

```sh
clojure -M -m cljs.esm build '{:main my.app :output-dir "out"}'  # build
clojure -M -m cljs.esm watch @cljs.edn                            # watch, hot reload
```

Options are EDN maps, `@file.edn` to read them from a file, and `:profile`
keywords (`cljs.esm/load-options`). Profiles are maps under `:profiles`, deep
merged over the rest; the profile names the build's `:mode`. `watch` defaults to
the `:dev` profile, `build` to `:release`:

```clojure
;; cljs.edn
{:main [my.app]
 :build-hooks [[my.build/hook {:some :arg}]]
 :profiles {:dev {:preloads [my.dev]}
            :release {:closure-defines {goog.DEBUG false}}}}
```

`cljs.esm/build` and `cljs.esm/watch` take the usual compiler options plus:

| option | |
|---|---|
| `:main` | a namespace or a collection of them, i.e. the app plus lazily loaded entries |
| `:preloads` | namespaces the main namespaces import first |
| `:parallel-build` | compiles namespaces in parallel once their dependencies are compiled |
| `:npm-interop :shadow` | `["pkg" :as x]` binds CommonJS packages' `module.exports`, like shadow-cljs, needs the Vite plugin |
| `:closure-defines {goog.DEBUG false}` | `goog.DEBUG` and `goog-define`s are compile time constants |
| `:build-hooks` | `[[fn-sym & args]]`, called with the build (`:compiler-env`, `:namespaces` in dependency order, `:mode`, `:options`) after a build and every watch recompile |
| `:warnings` | a map of warning types, or a boolean for the undeclared var warnings, like `cljs.closure` |
| `:optimize-constants true` | keyword and symbol constants are exports of one module, `cljs/core/constants.js`, instead of allocated at each use (`cljs.core` keeps its own) |
| `:checked-set-literals false` | set literals of runtime values collapse duplicates instead of throwing (before CLJS-3415) |
| `:esm-hmr` | hot reloading code, enabled by `watch` |
| `:esm-dts false` | don't write `.d.ts` files |
| `:esm-after-load` / `:esm-before-load` | fns run around hot reloads, like `^:dev/after-load` |
| `:watch-dirs` | source directories, defaults to the classpath directories without the compiler's own |

The output directory has one module per namespace (`out/my/app.js`), plus
`goog.js` and `goog/*.js` shims, `goog-lib/`, the parts of the Closure Library
the build uses (see below), and `cljs-esm.json`, the main namespaces' modules
(the bundle's entry points).

Macros reading classpath resources call `cljs.esm/watch-resource!`, the watcher
then recompiles the namespace when the resource changes. `shadow.resource` is
provided for code written for shadow-cljs.

### Vite

`src/main/js/vite-plugin-cljs` runs the compiler: a one-shot build for
`vite build` (the main namespaces are the bundle's entry points), watch mode for
`vite`, compile errors go to Vite's error overlay. In watch mode Vite's file
watcher reports changed sources to the compiler, hot updates wait for the
compile and its build hooks to finish.

```js
// vite.config.mjs
import cljs from 'vite-plugin-cljs';

export default {
  plugins: [cljs({ command: ['clojure', '-M:cljs'], config: 'cljs.edn', outputDir: 'out' })],
};
```

```html
<script type="module" src="/out/my/app.js"></script>
```

For server rendered pages the plugin writes `manifest.json` to Vite's `outDir`,
each main namespace's module scripts and the chunks they import (to preload):
the Vite dev server's modules when serving, the hashed chunks of a build.

## Interop

### npm packages and JavaScript / TypeScript files

String requires are plain imports, the bundler resolves them:

```clojure
(ns my.app
  (:require ["react" :as react]                ; npm package
            ["react-markdown" :default Markdown] ; default export
            ["./chart.ts" :as chart]           ; relative to this .cljs file
            ["/my/lib.js" :as lib]             ; on the classpath
            [rbush :as rbush]))                ; npm, like shadow-cljs
```

TypeScript is compiled by Vite, a TypeScript file or workspace package changed
in development is hot reloaded into the running app, no separate `tsc` process.

TypeScript imports ClojureScript modules like any other ES module, the compiler
writes `.d.ts` declarations next to them (fns with their arities and
docstrings):

```ts
import { describe } from '../out/app/state.js';
describe(1, 2); // error TS2554: Expected 1 arguments, but got 2.
```

### `^:export`

Exported vars are also installed as globals (`my.app.init`), for scripts calling
into the build.

### Lazy loading

`cljs.esm.lazy` follows `shadow.lazy`'s API. `(lazy/loadable my.ns/var)` loads
the namespace with a dynamic `import()`, bundlers split it and what only it
requires into a separate chunk. Lazily loaded namespaces are additional `:main`
entries.

## Design

### Namespaces as modules

```js
import * as cljs$core from "../cljs/core.js";
import * as my$util from "./util.js";
var my$app$greet = (function my$app$greet(name){
return my$util.format(name);
});
export { my$app$greet as greet };
```

- A namespace's vars are module-local bindings (`my$app$greet`), references to
  other namespaces' vars go through namespace imports (`my$util.format`).
  Bundlers resolve these statically, tree-shake unused vars and rename them.
- All of the emitter's naming goes through `munge`: a var of another namespace
  becomes `ns$alias.name`, a var of the namespace being compiled
  `ns$alias$name`. Namespaces only referenced by fully qualified names
  (macroexpansions) are imported at the end of the module (imports are
  hoisted).
- Imported bindings are read-only. `set!` of another namespace's var, i.e.
  `binding` and `with-redefs`, calls a setter the owning module exports,
  `$set$name` for dynamic vars and `$$set` for any var.
- `def`s nested in functions are hoisted as `var` declarations.
- Multi-arity and variadic fns are `/*@__PURE__*/` annotated.
- `js/my.ns.foo` references to namespaces as JavaScript globals are rewritten to
  module references, `(exists? my.ns/foo)` checks the binding.
- `js/eval` is an indirect eval, a direct one defeats tree shaking and renaming
  of the whole module.

### Closure Library

`cljs.core` uses little of the Closure Library. `src/main/cljs/cljs/esm/goog*`
are ES module versions of what it uses (`goog.typeOf`, `goog.object`,
`goog.string`, `goog.math.Long`, ...).

Other code using the Closure Library (cljs-time's `goog.date`, re-frame's
`goog.async`, cljs-http's `goog.Uri`, ...) and other Closure style libraries
(transit-js) gets the real thing: Closure Library files are wrapped as ES
modules (`goog-lib/`) run by Closure Library's `base.js`, with the debug loader
disabled, dependencies are imports. Members are resolved per reference, a shim
is used if it exports the member, otherwise the Closure Library. Its direct
`eval` calls (`goog.json.parse`, base.js' module loader) are made indirect: a
direct eval keeps minifiers from renaming the top level of the chunk it's in.

### Hot reloading

Modules accept their own updates (`import.meta.hot`). Importers keep the
bindings of the module instance they imported, a reloaded instance updates the
bindings of all previous ones through their `$$set`, so callers see new
definitions, like reloading a namespace under goog. A reloaded instance first
restores the previous instance's values, `defonce` keeps its value.
`^:dev/before-load` / `^:dev/after-load` fns run around updates. Changing
`cljs.core` reloads the page.

The watcher recompiles changed namespaces, their dependents when a
namespace's API (arities, macros) changed, and namespaces using changed
macros.

### Production bundles

Bundlers treat `Type.prototype.cljs$core$ISeq$_first$arity$1 = ...` as a side
effect, which keeps every protocol implementation of a used type. The Vite
plugin removes those of protocol methods never invoked in the bundle (and the
code only they reference), across chunks, shortens `cljs$...` property names
and minifies with oxc.

## Status

Verified with:

- The runtime test suite: `script/test-esm`, 662 tests, 20971 assertions, also
  as a pruned, minified bundle. `cljs.npm-deps-test`, which tests Closure's
  foreign lib processing, is excluded.
- The classic runtime tests (`:advanced`) and compiler tests, unchanged.
- The Whimsical app (3037 namespaces, compiled with its shadow-cljs build's
  sources): the production bundle and the development build under Vite's dev
  server boot until they need the backend.

Measured on the Whimsical app (Apple Silicon laptop):

| | shadow-cljs release (Closure advanced) | `:module-format :esm` + Vite 8, `:optimize-constants` |
|---|---|---|
| production build | 125s | 55s (compile and bundle) |
| total JS, minified | 25.8 MB | 27.0 MB |
| total JS, gzip / brotli | 5.93 / 4.72 MB | 6.04 / 4.82 MB |
| initial page load, gzip / brotli | 4.17 / 3.32 MB | 4.55 / 3.65 MB |
| incremental compile | | 150-230ms per changed namespace |

Hello world: 177 KB / 35 KB gzipped (Closure advanced: 110 KB / 23 KB).

## Known gaps

- ES modules are strict mode, ClojureScript under Closure isn't: writes to
  frozen objects or deleting non-configurable properties throw instead of
  silently doing nothing, `this` in a plain function call is `undefined`.
  `goog.getUid` (used by `hash` for JavaScript objects) gives frozen objects
  stable ids from a `WeakMap` rather than failing.

- REPL: not supported under `:module-format :esm` yet.
- Size: protocol pruning and property renaming are a bundle post pass in
  JavaScript (11s on the Whimsical app).
- Production source maps are dropped by the prune pass.
- `cljs.core` references `goog.math.Long` / `goog.math.Integer` for `integer?`,
  which keeps them in every bundle.
- Closure's `:modules` aren't supported, lazy loading uses `import()`.
- Self-hosted ClojureScript (`cljs.js`) doesn't emit ES modules.
