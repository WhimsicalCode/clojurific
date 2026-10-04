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
clojure -M -m cljs.esm '{:main my.app :output-dir "out"}'        # build
clojure -M -m cljs.esm watch '{:main my.app :output-dir "out"}'  # watch, hot reload
```

`cljs.esm/build` and `cljs.esm/watch` take the usual compiler options plus:

| option | |
|---|---|
| `:main` | a namespace or a collection of them, i.e. the app plus lazily loaded entries |
| `:parallel-build` | compiles namespaces in parallel once their dependencies are compiled |
| `:npm-interop :shadow` | `["pkg" :as x]` binds CommonJS packages' `module.exports`, like shadow-cljs, needs the Vite plugin |
| `:closure-defines {goog.DEBUG false}` | `goog.DEBUG` and `goog-define`s are compile time constants |
| `:esm-hmr` | hot reloading code, enabled by `watch` |
| `:esm-dts false` | don't write `.d.ts` files |
| `:esm-after-load` / `:esm-before-load` | fns run around hot reloads, like `^:dev/after-load` |
| `:watch-dirs` | directories `watch` polls, defaults to the classpath directories |

The output directory has one module per namespace (`out/my/app.js`), plus
`goog.js` and `goog/*.js` shims, and `goog-lib/`, the parts of the Closure
Library the build uses (see below).

### Vite

`src/main/js/vite-plugin-cljs` runs the compiler: a one-shot build for
`vite build`, watch mode for `vite`, compile errors go to Vite's error overlay.

```js
// vite.config.js
import cljs from 'vite-plugin-cljs';

export default {
  plugins: [cljs({ main: 'my.app', outputDir: 'out', command: ['clojure', '-M'] })],
};
```

```html
<script type="module" src="/out/my/app.js"></script>
```

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
is used if it exports the member, otherwise the Closure Library.

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

| | shadow-cljs release (Closure advanced) | `:module-format :esm` + Vite 8 |
|---|---|---|
| production build | 110s | 46s (31s compile, 15s bundle, 3.4s of it Rolldown) |
| total JS, minified | 26.0 MB | 39.3 MB |
| total JS, gzipped | 5.9 MB | 6.7 MB |
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
  JavaScript (11s on the Whimsical app). Keyword and symbol constants aren't
  hoisted (`:optimize-constants`), each use allocates.
- Production source maps are dropped by the prune pass.
- `cljs.core` references `goog.math.Long` / `goog.math.Integer` for `integer?`,
  which keeps them in every bundle.
- Build hooks (shadow-cljs `:build-hooks`), i.e. CSS extraction, have no
  equivalent yet.
- Closure's `:modules` aren't supported, lazy loading uses `import()`.
- Self-hosted ClojureScript (`cljs.js`) doesn't emit ES modules.
