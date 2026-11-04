// Vite plugin for ClojureScript compiled to ES modules (Clojurific).
//
// The ClojureScript compiler runs in a JVM, `vite build` runs a one-shot build
// before bundling, `vite` (dev) runs the compiler in watch mode. Compiled
// namespaces are plain ES modules in outputDir, Vite serves, hot reloads and
// bundles them like any other JavaScript, including the npm packages and
// TypeScript files they import.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { compilerCommand } from '../cljf/launcher.js';
import { pruneChunks, propertyRenames } from './prune.js';
import { ednValue } from './edn.js';
import { watchWarnings } from './warnings.js';
import { listenReplSocket } from './repl-socket.js';
import { runtimeMessage } from './runtime-ops.js';
import { WORKER_ENV, devWorkers, entryModule, importVite, workerHotChannel } from './dev-workers.js';

const EVENT_PREFIX = '[cljf.esm] ';
const NPM_AS = 'cljs-npm-as:';
// a ClojureScript source loaded by a page or imported from JavaScript, which
// the dev server serves as an import of its compiled module
const SOURCE = 'cljs-source:';
const SOURCE_FILE = /\.clj[sc]$/;

// The namespace of a ClojureScript source file, from its ns form
async function sourceNamespace(file) {
  const code = (await fs.readFile(file, 'utf8')).replace(/;.*$/gm, '');
  const ns = code.match(/\(\s*ns\s+(?:\^(?:\{[^}]*\}|\S+)\s+)*([^\s()[\]{}"^;]+)/)?.[1];
  if (!ns) throw new Error(`${file} has no ns form`);
  return ns;
}

const SCRIPT_SRC = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
// import "x", import x from "x", export … from "x", import("x")
const IMPORT = /(?:\bimport\s*(?:[\w$*{}\s,]+\bfrom\s*)?|\bexport\s*[\w$*{}\s,]+\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/;
// extensionless imports, as TypeScript projects write them
const SCRIPT_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.js'];

// The file a page's script or a module's import names: root-absolute or
// relative paths, not packages or aliases, which the bundler resolves
function importedFile(spec, from, root) {
  const file = spec.replace(/[?#].*$/, '');
  if (!file.startsWith('/') && !file.startsWith('.')) return null;
  return file.startsWith('/') ? path.join(root, file) : path.resolve(path.dirname(from), file);
}

// The ClojureScript sources the entries (pages and JavaScript or TypeScript
// modules) load: the pages' scripts and the modules' imports, followed through
// the project's modules
async function entrySources(entries, root) {
  const sources = new Set();
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file) || file.includes(`${path.sep}node_modules${path.sep}`)) continue;
    seen.add(file);
    let code;
    try {
      code = await fs.readFile(file, 'utf8');
    } catch (e) {
      continue;
    }
    for (const [, spec] of code.matchAll(file.endsWith('.html') ? SCRIPT_SRC : IMPORT)) {
      const target = importedFile(spec, file, root);
      if (!target) continue;
      if (SOURCE_FILE.test(target)) {
        if (existsSync(target)) sources.add(target);
      } else {
        const module = SCRIPT_SUFFIXES.map(suffix => target + suffix)
          .find(f => SCRIPT_FILE.test(f) && existsSync(f) && !statSync(f).isDirectory());
        if (module) queue.push(module);
      }
    }
  }
  return [...sources];
}

// Whether address is this machine's
function isLoopback(address) {
  return /^(127\.|::1$|::ffff:127\.)/.test(address ?? '');
}

// Whether a websocket connection comes from this machine: its peer, and the
// client a proxy on this machine (nginx) names in X-Real-IP
function isLocalConnection(req) {
  const realIp = req.headers['x-real-ip'];
  return isLoopback(req.socket.remoteAddress) && (realIp === undefined || isLoopback(realIp));
}

// Whether a plugin hook runs for one of the dev server's server environments
// (ssr, worker threads), whose module runner runs modules as ES modules
function serverEnvironment(ctx) {
  const env = ctx.environment;
  return env?.mode === 'dev' && env.config?.consumer === 'server';
}

// Whether file (a package's module) is CommonJS: .cjs, or .js without ES
// module syntax (which Node.js runs the same either way: a .js of a "type":
// "module" package without import, export or top-level await only has side
// effects)
const commonJSFiles = new Map();
async function isCommonJSFile(file) {
  if (file.endsWith('.mjs')) return false;
  if (file.endsWith('.cjs')) return true;
  if (!file.endsWith('.js')) return false;
  if (!commonJSFiles.has(file)) {
    commonJSFiles.set(file, fs.readFile(file, 'utf8').then(isCommonJS, () => false));
  }
  return commonJSFiles.get(file);
}

// A module without ES module syntax is CommonJS, i.e. its module.exports is
// what shadow-cljs binds with :as.
function isCommonJS(code) {
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return !/(^|[;\n])\s*(import\s*[\w*{"']|export\s+[\w*{]|export\s*\{)/.test(stripped);
}

// Whether the project's package.json makes its .js files CommonJS ("type":
// "commonjs", which npm init writes; without a type, the bundler detects ES
// modules)
async function commonJSPackage(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).type === 'commonjs';
  } catch (e) {
    return false;
  }
}

// A Rollup input (a file, files or {name: file}) as {name: absolute file},
// files named by their path in the root without the extension, so pages with
// the same file name in different directories (about/index.html) keep apart
function inputObject(input, root) {
  if (!input) return {};
  if (typeof input === 'object' && !Array.isArray(input)) {
    return Object.fromEntries(Object.entries(input).map(([name, file]) => [name, path.resolve(root, file)]));
  }
  return Object.fromEntries([].concat(input).map(file => {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    const name = relative.startsWith('..') || path.isAbsolute(relative) ? path.basename(absolute) : relative;
    return [name.slice(0, name.length - path.extname(name).length).split(path.sep).join('/'), absolute];
  }));
}

// oxc's minifier shipped with Rolldown, as used by Vite
function resolveFromProject(root, specifier, purpose) {
  const tryResolve = (base, spec) => {
    try {
      return createRequire(path.join(base, 'noop.js')).resolve(spec);
    } catch (e) {
      return null;
    }
  };
  // Vite's own dependencies (rolldown) from Vite's install: isolated installs
  // link only the project's direct dependencies
  const vite = tryResolve(root, 'vite') ?? tryResolve(process.cwd(), 'vite');
  for (const base of [root, process.cwd(), ...(vite ? [path.dirname(vite)] : [])]) {
    const resolved = tryResolve(base, specifier);
    if (resolved) return resolved;
  }
  throw new Error(`${specifier} not found, can not ${purpose}`);
}

// The native summarizer (src/main/rust/prune, script/build-native-prune) for
// this platform, null without one.
let nativePruneWarned = false;

function loadNativePrune() {
  const file = new URL(`./native/cljf-prune.${process.platform}-${process.arch}.node`, import.meta.url);
  if (process.env.CLJF_NATIVE_PRUNE === 'false' || !existsSync(file)) return null;
  try {
    return createRequire(import.meta.url)(fileURLToPath(file));
  } catch (e) {
    // a binary that's there but doesn't load (i.e. built for another Node.js
    // ABI) is said once, not mistaken for none
    if (!nativePruneWarned) {
      nativePruneWarned = true;
      console.warn(`[cljf] the native prune summarizer ${fileURLToPath(file)} didn't load, ` +
        `summarizing in JavaScript instead (same output): ${e.message.split('\n')[0]}`);
    }
    return null;
  }
}

// The native summaries (string table, statements as u32s) as prune.js'.
function decodeSummary({ strings, statements: a }) {
  const kinds = ['root', 'decl', 'prop'];
  const out = [];
  let i = 0;
  const list = () => {
    const n = a[i++];
    const r = new Array(n);
    for (let k = 0; k < n; k++) r[k] = strings[a[i++]];
    return r;
  };
  while (i < a.length) {
    const s = { start: a[i++], end: a[i++], kind: kinds[a[i++]] };
    const object = a[i++], prop = a[i++];
    const names = list();
    if (s.kind === 'prop') {
      s.object = strings[object];
      s.prop = prop === 0xFFFFFFFF ? null : strings[prop];
    }
    if (s.kind === 'decl') s.names = names;
    s.ids = list();
    s.props = list();
    out.push(s);
  }
  return out;
}

// Statement summaries of chunks for pruning (prune.js): by the native
// summarizer if there's one for this platform (and it supports the chunk),
// else parsed with oxc's parser (shipped with Rolldown, at oxcPath) in
// worker threads, the largest chunks first.
async function summarizeChunks(oxcPath, chunks) {
  const native = loadNativePrune();
  const summaries = native ? native.summarizeChunks(chunks.map(c => c.code)).map(s => s && decodeSummary(s)) : [];
  const rest = chunks.map((c, i) => i).filter(i => !summaries[i]);
  if (rest.length) {
    const results = await summarizeChunksJS(oxcPath, rest.map(i => chunks[i]));
    rest.forEach((i, k) => (summaries[i] = results[k]));
  }
  return summaries;
}

async function summarizeChunksJS(oxcPath, chunks) {
  const order = chunks.map((c, i) => i).sort((a, b) => chunks[b].code.length - chunks[a].code.length);
  const results = new Array(chunks.length);
  const size = Math.min(chunks.length, os.availableParallelism());
  const workers = Array.from({ length: size }, () => new Worker(new URL('./prune-worker.js', import.meta.url)));
  try {
    await Promise.all(workers.map(async worker => {
      for (let i = order.shift(); i !== undefined; i = order.shift()) {
        const { fileName, code } = chunks[i];
        const reply = await new Promise((resolve, reject) => {
          worker.once('message', resolve);
          worker.once('error', reject);
          worker.postMessage({ id: i, oxcPath, fileName, code });
        });
        worker.removeAllListeners('error');
        if (reply.error) throw new Error(reply.error);
        results[i] = reply.summary;
      }
    }));
  } finally {
    await Promise.all(workers.map(w => w.terminate()));
  }
  return results;
}

// A composed source map, as the bundler's chunks have them: with toString
// and toUrl.
class ChunkSourceMap {
  constructor(map) {
    Object.assign(this, map);
  }
  toString() {
    return JSON.stringify(this);
  }
  toUrl() {
    return `data:application/json;charset=utf-8;base64,${Buffer.from(this.toString()).toString('base64')}`;
  }
}

// Vite's build-import-analysis rewrites dynamic imports' __VITE_PRELOAD__
// markers in a chunk (and prepends __vite__mapDeps), then composes a source
// map of that edit with the chunk's: serially, chunk after chunk, a few
// seconds for large bundles. When the plugin composes every chunk's map again
// after minifying anyway, Vite rewrites the code without the map, and the
// minify workers compose the same edit's map (preload-edit-map.js). The
// edit, from the chunk's code before (code) and after (edited): {prefix,
// updates: [[start, end, text]]}, or null when the edited code isn't exactly
// such an edit.
const PRELOAD_MARKER = '__VITE_PRELOAD__';
const PRELOAD_REPLACEMENT = /^(?:void 0|\[\]|__vite__mapDeps\(\[[\d,]*\]\))/;
const MAP_DEPS = /^const __vite__mapDeps=[^\n]*\n/;

function preloadEdit(code, edited) {
  const prefix = MAP_DEPS.exec(edited)?.[0] ?? '';
  const updates = [];
  let at = prefix.length, from = 0;
  for (let i = code.indexOf(PRELOAD_MARKER); ; i = code.indexOf(PRELOAD_MARKER, from)) {
    const end = i < 0 ? code.length : i;
    if (!edited.startsWith(code.slice(from, end), at)) return null;
    at += end - from;
    if (i < 0) break;
    const replacement = PRELOAD_REPLACEMENT.exec(edited.slice(at, at + 4096))?.[0];
    if (replacement === undefined) return null;
    updates.push([i, i + PRELOAD_MARKER.length, replacement]);
    at += replacement.length;
    from = i + PRELOAD_MARKER.length;
  }
  return at === edited.length ? { prefix, updates } : null;
}

// Wraps Vite's build-import-analysis generateBundle (plugin) to rewrite the
// chunks' preload markers without composing their source maps; pending maps
// each edited chunk's file name to {code, edit, map} for generateBundle.
// Chunks whose edit preloadEdit doesn't recognize are rewritten by Vite again
// from their original code, with their maps.
function deferPreloadSourceMaps(plugin, pending) {
  const hook = plugin.generateBundle;
  const handler = typeof hook === 'function' ? hook : hook.handler;
  const deferred = async function (outputOptions, bundle) {
    // this build's edits only: a watch (or reused plugin instance) builds
    // again, chunks without hashed names keep their file names
    pending.clear();
    const chunks = Object.values(bundle).filter(c => c.type === 'chunk' && c.map && c.code.includes(PRELOAD_MARKER));
    const before = new Map(chunks.map(c => [c, { code: c.code, map: c.map }]));
    chunks.forEach(c => (c.map = null));
    try {
      await handler.call(this, outputOptions, bundle);
    } finally {
      chunks.forEach(c => (c.map = before.get(c).map));
    }
    const redo = [];
    for (const [chunk, { code, map }] of before) {
      if (chunk.code === code) continue;
      const edit = preloadEdit(code, chunk.code);
      if (edit) {
        pending.set(chunk.fileName, { code, edit, map });
      } else {
        chunk.code = code;
        redo.push(chunk);
      }
    }
    if (redo.length) {
      // the other chunks' markers are rewritten already
      await handler.call(this, outputOptions, bundle);
    }
  };
  plugin.generateBundle = typeof hook === 'function' ? deferred : { ...hook, handler: deferred };
}

// Minifies the pruned chunks (codes) in worker threads (minify-worker.js), the
// largest first, composing their source maps with the bundler's (maps, JSON
// or null) with @jridgewell/remapping, which the project depends on, at
// remappingPath. Returns [{code, map, error}].
async function minifyChunks(oxcPath, remappingPath, fileNames, codes, maps, edits, options) {
  const order = codes.map((c, i) => i).sort((a, b) => codes[b].length - codes[a].length);
  const results = new Array(codes.length);
  const size = Math.min(codes.length, os.availableParallelism());
  const workers = Array.from({ length: size }, () => new Worker(new URL('./minify-worker.js', import.meta.url)));
  try {
    await Promise.all(workers.map(async worker => {
      for (let i = order.shift(); i !== undefined; i = order.shift()) {
        const reply = await new Promise((resolve, reject) => {
          worker.once('message', resolve);
          worker.once('error', reject);
          worker.postMessage({ id: i, oxcPath, remappingPath, fileName: fileNames[i], code: codes[i], map: maps[i], edit: edits[i], options });
        });
        worker.removeAllListeners('error');
        if (reply.fatal) throw new Error(reply.fatal);
        results[i] = reply;
      }
    }));
  } finally {
    await Promise.all(workers.map(w => w.terminate()));
  }
  return results;
}

// Whether a dependency pre-bundled by Vite's dev server was CommonJS, from the
// optimizer's metadata.
async function preBundledCommonJS(file) {
  const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(file), '_metadata.json'), 'utf8'));
  const name = path.basename(file);
  return Object.values({ ...metadata.optimized, ...metadata.chunks })
    .some(dep => dep.file === name && dep.needsInterop);
}

// Wraps a CommonJS module as an ES module, static require("x") calls become
// imports of x's module.exports (or namespace).
function commonJSToESM(code) {
  const imports = [];
  const body = code.replace(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g, (_, q, spec) => {
    const name = `__cljs_require_${imports.length}`;
    imports.push(`import ${name} from ${JSON.stringify(NPM_AS + spec)};`);
    return name;
  });
  return `${imports.join('\n')}
const module = { exports: {} };
const exports = module.exports;
${body}
export default module.exports;
`;
}

/**
 * @param {object} options
 * @param {string[]} [options.aliases] deps.edn aliases of the classpath the
 *   compiler runs with, i.e. ["cljs"]. The launcher (cljf) resolves it with
 *   the compiler added and stock ClojureScript removed, see cljf/launcher.js.
 * @param {string[]} [options.command] starts Clojure with the compiler on the
 *   classpath instead of the launcher, i.e. ["clojure", "-M:cljs"],
 *   cljf.esm's arguments follow
 * @param {string} [options.cwd] the compiler's working directory, with the
 *   project's deps.edn, defaults to Vite's root (the project's directory)
 * @param {string} [options.config] compiler options file (EDN, see
 *   cljf.esm/load-options), relative to cwd
 * @param {string} [options.profile] profile of the config file, defaults to
 *   dev when serving and release when building
 * @param {string} options.outputDir the compiler's output directory, relative
 *   to cwd. Pages load namespaces from it, i.e. outputDir "out" serves my.app
 *   as /out/my/app.js
 * @param {object|string} [options.compilerOptions] more compiler options, an
 *   EDN string or an object with keyword keys, camelCase or kebab-case
 * @param {string|false} [options.manifest] writes the entry points' scripts
 *   and preloads to this file in Vite's outDir, for server rendered pages,
 *   defaults to "manifest.json"
 * @param {boolean} [options.prune] remove unused protocol implementations and
 *   shorten ClojureScript property names in production bundles, defaults to
 *   true
 * @param {string[]} [options.entries] the :js-entries this build bundles,
 *   defaults to all; each is self-contained when it's the only one
 * @param {string[]} [options.ssrEntries] :js-entries the dev server runs in
 *   its ssr environment once they're compiled, i.e. a server's (which a
 *   plugin like @hono/vite-dev-server imports from the same runner): the REPL
 *   evaluates in them before their first request
 * @param {boolean} [options.workers] the dev server's worker threads
 *   (createWorker of clojurific/worker): an environment of their own,
 *   cljf_worker, resolving as the ssr environment. Defaults to true with
 *   ssrEntries, else false.
 * @param {boolean} [options.ignoreWarnings] hot reload despite compiler
 *   warnings, like shadow-cljs' :devtools {:ignore-warnings true}: they go
 *   to the terminal only, defaults to false: hot reload pauses while any
 *   namespace has warnings, and the overlay shows them
 * @param {boolean|{port?: number, host?: string}} [options.replSocket] the
 *   REPL for bundles of vite build --watch, i.e. a Node.js server and its
 *   worker threads: the compiler's watch compiles with :esm-repl and every
 *   thread running the bundle connects to this socket (127.0.0.1, port 0 a
 *   free one, the default), its address defined in the bundle
 *   (__CLJF_REPL__), CLJF_REPL_PORT in a runtime's environment overrides
 *   the port. Defaults to false.
 * @param {boolean} [options.replRemoteConsole] accept cljs_eval (forms the
 *   compiler compiles, running its macros) from pages on other hosts too,
 *   defaults to false: only from this machine. A proxy in front of the dev
 *   server must set X-Real-IP to the client's address.
 */
export default function cljf(options) {
  const manifestName = options.manifest ?? 'manifest.json';
  let config, proc, server, minify, root, cwd, outputDir, compiler;
  // a build's info, read before Vite writes the bundle (which may empty its
  // outDir)
  let builtInfo;
  // chunks' preload edits whose source maps generateBundle composes
  const preloadEdits = new Map();
  // the namespaces of the pages' scripts, compiled as main namespaces
  let pageNamespaces = [];
  let compiling = Promise.resolve();
  const localModules = new Set();
  // the compiler warnings, which hold hot updates back (see warnings.js)
  const warnings = watchWarnings({ ignoreWarnings: options.ignoreWarnings });

    // The REPL (cljf.esm.repl): pages running the build (cljf.esm.repl-runtime)
  // say hello over Vite's websocket, modules the ssr environment's runner
  // runs (a server's :js-entries) over its hot channel, and the threads
  // running a bundle over the REPL socket (replSocket); each
  // connection gets a runtime id. Their cljs:repl messages go to the
  // compiler as `repl <json>` lines, the compiler's repl-send events to the
  // runtime of their runtime id, runtimes[id](data).
  const runtimes = new Map();
  let lastRuntimeId = 0;
  // A page's runtime id by its tab key (sessionStorage, see
  // cljf.esm.repl-runtime/tab-key): a reloaded page keeps its id, which the
  // MCP server's tools take, unless a live runtime has it (a page opened by
  // the other, with a copy of its sessionStorage), which gets a new id and
  // key.
  const tabIds = new Map();
  // tab keys are 32 hex digits (cljf.esm.repl-runtime/random-key), kept for
  // as many tabs as a session opens, the oldest dropped past that
  const MAX_TAB_IDS = 1000;
  const tabKeyOf = data => (typeof data.tabKey === 'string' && /^[0-9a-f-]{8,64}$/i.test(data.tabKey) ? data.tabKey : undefined);
  const toRepl = msg => proc?.stdin.writable && proc.stdin.write(`repl ${JSON.stringify(msg)}\n`);
  // A runtime's connection: receive takes the data of its cljs:repl events
  // for the REPL, close says bye. send replies to it, consoleAllowed whether
  // it may cljs_eval.
  const connectRuntime = (send, consoleAllowed) => {
    let id;
    const receive = data => {
      // a page can't send the plugin's own messages, see runtimeMessage
      if (!runtimeMessage(data)) return;
      let tabKey;
      if (data.op === 'hello' && id === undefined) {
        const key = tabKeyOf(data);
        const known = key !== undefined ? tabIds.get(key) : undefined;
        if (known !== undefined && !runtimes.has(known)) {
          id = known;
        } else {
          id = ++lastRuntimeId;
          if (key !== undefined) {
            // a page opened by another has a copy of its key: a key of its own
            if (known !== undefined) tabKey = `${key.slice(0, 40)}-${id}`;
            tabIds.set(tabKey ?? key, id);
            if (tabIds.size > MAX_TAB_IDS) tabIds.delete(tabIds.keys().next().value);
          }
        }
        runtimes.set(id, send);
      }
      if (id === undefined) return;
      if (data.op === 'hello') {
        send({ op: 'welcome', runtime: id, ...(tabKey ? { tabKey } : {}) });
        if (tabKey) data = { ...data, tabKey };
      }
      if (data.op === 'console-eval' && !consoleAllowed) {
        send({
          op: 'console-result',
          rid: data.rid,
          result: { error: 'cljs_eval only runs in pages on the dev server\'s machine, see the cljf plugin\'s replRemoteConsole' },
        });
        return;
      }
      toRepl({ ...data, runtime: id });
    };
    const close = () => {
      if (id !== undefined && runtimes.delete(id)) toRepl({ op: 'bye', runtime: id });
    };
    return { receive, close };
  };

  // a compiler's repl-send event: the message to its runtime
  const replSend = event => {
    const send = runtimes.get(event.runtime);
    if (send) send(event.msg);
    else toRepl({ op: 'bye', runtime: event.runtime });
  };
  // the REPL socket of vite build --watch (replSocket), see listenReplSocket
  let replSocket = null;
  // closed with the watch (closeWatcher), or when it fails to start: another
  // watch in the same process can listen on its port
  const closeReplSocket = () => {
    replSocket?.close();
    replSocket = null;
  };
  // The dev server's worker threads (createWorker of clojurific/worker): an
  // environment of their own, WORKER_ENV, whose transport is this channel,
  // each thread a client of it. See dev-workers.js.
  const workerChannel = workerHotChannel();
  // the dev server's first compile, and its first successful one, see api.
  // Both reject if the compiler exits before they settle.
  let firstCompile, firstSuccess, compilerExited;
  const initialCompile = new Promise((resolve, reject) => {
    firstCompile = resolve;
    compilerExited = e => {
      reject(e);
      failSuccess(e);
    };
  });
  let failSuccess;
  const successfulCompile = new Promise((resolve, reject) => {
    firstSuccess = resolve;
    failSuccess = reject;
  });
  // settled by the compiler's exit only when nobody awaits them
  initialCompile.catch(() => {});
  successfulCompile.catch(() => {});

  function compilerArgs(command, extra) {
    const profile = options.profile ?? (command === 'watch' ? 'dev' : 'release');
    const more = typeof options.compilerOptions === 'string'
      ? options.compilerOptions
      : ednValue(options.compilerOptions ?? {});
    return [
      command,
      ...(options.config ? [`@${options.config}`] : []),
      `:${profile}`,
      ednValue({
        ':output-dir': outputDir,
        ...(pageNamespaces.length ? { ':extra-main': pageNamespaces.map(ns => `'${ns}`) } : {}),
        ...extra,
      }),
      more,
    ];
  }

  function run(args, onEvent) {
    const [cmd, ...cmdArgs] = compiler;
    // cljf.main: cljf.esm's command line, loading the compiler from cached classes
    const child = spawn(cmd, [...cmdArgs, '-m', 'cljf.main', ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const log = (level, line) => (config ? config.logger[level](line) : console[level === 'warn' ? 'warn' : 'log'](line));
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line.startsWith(EVENT_PREFIX)) onEvent(JSON.parse(line.slice(EVENT_PREFIX.length)));
        else if (line.trim()) log('info', line);
      }
    });
    child.stderr.on('data', chunk => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim()) log('warn', line);
      }
    });
    return child;
  }

  // The compiler's watch for vite build --watch, compiling tracks the
  // compile in progress. Resolves once a build succeeded, the bundle's inputs
  // are its output: a failed initial build is logged and the watch waits for
  // the fix, like the dev server. Rejects when the compiler exits first.
  function watchCompiler() {
    let compiled = () => {};
    return new Promise((resolve, reject) => {
      let first = true;
      // the build's options: bundles don't hot reload, the dev server's watch
      // does. With the REPL socket, the bundle's threads are the REPL's runtimes.
      proc = run(compilerArgs('watch', {
        ':exit-with-parent': true,
        ':esm-hmr': false,
        ...(replSocket ? { ':esm-repl': true } : {}),
      }), event => {
        if (event.type === 'repl-send') {
          replSend(event);
        } else if (event.type === 'compiling') {
          compiling = new Promise(resolve => (compiled = resolve));
        } else if (event.type === 'compiled' || event.type === 'error') {
          compiled();
          const logger = config?.logger ?? console;
          if (event.type === 'error') logger.error(`[cljf] ${event.message}`);
          else logger.info(`[cljf] compiled ${event.namespaces} namespace(s) in ${event.ms}ms`);
          if (first && event.type === 'compiled') {
            first = false;
            resolve();
          }
        }
      });
      proc.on('exit', code => first && reject(new Error(`ClojureScript watch exited (${code})`)));
    });
  }

  async function buildInfo() {
    try {
      return JSON.parse(await fs.readFile(path.join(outputDir, 'cljs-esm.json'), 'utf8'));
    } catch (e) {
      return null;
    }
  }

  // Source map sources: compiled namespaces by classpath path (app/main.cljs),
  // other files relative to cwd (the project), not to the machine that built
  // them; the maps embed their content. source is relative to directory dir.
  function sourcePath(dir, source) {
    if (source == null) return source;
    const file = path.resolve(dir, source);
    const compiled = file.startsWith(outputDir + path.sep);
    // already transformed (Vite rewrites the maps of chunks it edits)
    if (!compiled && !existsSync(file)) return source;
    return (compiled ? path.relative(outputDir, file) : path.relative(cwd, file)).split(path.sep).join('/');
  }

  // Whether a ClojureScript source may be served: in Vite's root or
  // server.fs.allow
  function servedSource(file) {
    const dirs = [config.root, ...(config.server?.fs?.allow ?? [])].map(dir => path.resolve(dir));
    return SOURCE_FILE.test(file) && dirs.some(dir => file.startsWith(dir + path.sep));
  }

  // The compiled module of a ClojureScript source file: its namespace's in the
  // build info, or its munged name
  async function compiledModule(file) {
    // a source added while serving is compiled first
    await compiling;
    const ns = await sourceNamespace(file);
    const relative = (await buildInfo())?.main?.[ns] ??
      `${ns.split('.').map(part => part.replace(/-/g, '_')).join('/')}.js`;
    const module = path.join(outputDir, relative);
    if (!existsSync(module)) {
      throw new Error(`${ns} (${file}) isn't compiled: load it from a page's script or a module the pages ` +
        'import (through relative or root-absolute imports, restarting Vite after adding it), or add it to :main');
    }
    return module;
  }

  // The dev server's URL of an output file (relative to outputDir)
  function devUrl(file) {
    const absolute = path.resolve(outputDir, file);
    const relative = path.relative(config.root, absolute);
    return config.base + (relative.startsWith('..') || path.isAbsolute(relative)
      ? `@fs${absolute}`
      : relative).split(path.sep).join('/');
  }

  // Vite empties its outDir before writing a build: the compiler's output
  // can't be in it, unless build.emptyOutDir is false (Vite's default: true
  // for an outDir in the root)
  function checkOutDir(userConfig) {
    const outDir = path.resolve(root, userConfig.build?.outDir ?? 'dist');
    const emptied = userConfig.build?.emptyOutDir ?? (outDir + path.sep).startsWith(root + path.sep);
    if (emptied && (outputDir === outDir || outputDir.startsWith(outDir + path.sep))) {
      throw new Error(`[cljf] outputDir ${path.relative(cwd, outputDir) || '.'} is in Vite's build.outDir ` +
        `${path.relative(root, outDir) || '.'}, which Vite empties before writing the bundle: ` +
        'use an outputDir outside it, e.g. \'target/cljs\'');
    }
  }

  async function writeManifest(manifest) {
    if (!manifestName) return;
    const file = path.resolve(config.root, config.build.outDir, manifestName);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // written atomically, a server may read it any time
    await fs.writeFile(`${file}.tmp`, JSON.stringify(manifest, null, 2));
    await fs.rename(`${file}.tmp`, file);
  }

  return {
    name: 'cljf',
    // before Vite's resolver, which would take cljs-npm-as: specifiers
    enforce: 'pre',

    async config(userConfig, env) {
      root = path.resolve(userConfig.root ?? process.cwd());
      cwd = path.resolve(options.cwd ?? root);
      outputDir = path.resolve(cwd, options.outputDir);
      if (options.command) {
        compiler = options.command;
      } else if (!env.isPreview) {
        const launched = await compilerCommand({
          cwd,
          aliases: options.aliases,
          // Vite reads the terminal only once its server listens
          interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY && !process.env.CI),
        });
        compiler = [launched.command, ...launched.args];
      }
      const result = {};
      // The REPL runtime wraps the console (its log for the MCP server's
      // console_logs): ignore-listed, browsers' consoles show the code
      // logging as a message's source rather than the wrapper, and debuggers
      // step over it. With Vite's default, the node_modules.
      if (env.command === 'serve') {
        const userIgnore = userConfig.server?.sourcemapIgnoreList;
        if (userIgnore !== false) {
          const ignore = typeof userIgnore === 'function' ? userIgnore : file => file.includes('/node_modules/');
          result.server = {
            sourcemapIgnoreList: (file, map) =>
              /[\\/]cljf[\\/]esm[\\/]repl_runtime\.(?:cljs|js)$/.test(file) || ignore(file, map),
          };
        }
      }
      // the project's page, an input of builds and the dev server's /
      const indexHtml = existsSync(path.join(root, 'index.html')) ? path.join(root, 'index.html') : null;
      const userInput = userConfig.build?.rolldownOptions?.input ?? userConfig.build?.rollupOptions?.input;
      const entries = Object.values(inputObject(userInput ?? indexHtml, root));
      pageNamespaces = await Promise.all((await entrySources(entries, root)).map(sourceNamespace));
      if (env.command === 'build' && !env.isPreview) {
        checkOutDir(userConfig);
        const start = Date.now();
        if (userConfig.build?.watch) {
          // vite build --watch: the compiler's watch builds, then watches the
          // sources; the bundler rebuilds when the compiler's output changes.
          // With replSocket, the bundle's threads connect to the REPL.
          if (options.replSocket) {
            const { host = '127.0.0.1', port } = typeof options.replSocket === 'object' ? options.replSocket : {};
            // cljs_eval compiles forms in the compiler's JVM, which runs their
            // macros: only from this machine, unless replRemoteConsole, as the
            // dev server's websocket
            if (!options.replRemoteConsole && !isLoopback(host) && host !== 'localhost') {
              throw new Error(`[cljf] replSocket's host ${host} isn't this machine's loopback: ` +
                'set replRemoteConsole to accept runtimes from other machines');
            }
            replSocket = await listenReplSocket({
              host,
              port,
              connect: (send, remoteAddress) => connectRuntime(send, options.replRemoteConsole || isLoopback(remoteAddress)),
            });
            result.define = {
              __CLJF_REPL__: JSON.stringify({
                host: replSocket.host,
                port: replSocket.port,
                root: pathToFileURL(outputDir + path.sep).href,
              }),
            };
            console.log(`[cljf] REPL socket on ${replSocket.host}:${replSocket.port}`);
          }
          try {
            await watchCompiler();
          } catch (e) {
            closeReplSocket();
            throw e;
          }
        } else {
          await new Promise((resolve, reject) => {
            const child = run(compilerArgs('build', { ':verbose': false }), () => {});
            child.stdin.end();
            child.on('exit', code => code === 0 ? resolve() : reject(new Error(`ClojureScript build failed (${code})`)));
          });
        }
        console.log(`ClojureScript compiled in ${Date.now() - start}ms`);
        const info = builtInfo = await buildInfo();
        if (!info) throw new Error(`[cljf] the compiler wrote no ${path.join(outputDir, 'cljs-esm.json')}`);
        const jsEntries = Object.fromEntries(Object.entries(info.entries ?? {})
          .filter(([name]) => !options.entries || options.entries.includes(name)));
        const entries = { ...info.main, ...jsEntries };
        // The namespaces and :js-entries, with the HTML pages: the project's
        // input, else its index.html. Set on the user's config, since merging
        // an input object into a string or array doesn't work.
        userConfig.build ??= {};
        // rolldownOptions since Vite 8
        const key = userConfig.build.rolldownOptions ? 'rolldownOptions' : 'rollupOptions';
        userConfig.build[key] ??= {};
        userConfig.build[key].input = {
          ...Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, path.join(outputDir, file)])),
          ...inputObject(userConfig.build[key].input ?? indexHtml, root),
        };
        result.build = {
          rollupOptions: {
            // :js-entries' exports are the bundle's interface, namespaces'
            // exports are only for each other
            preserveEntrySignatures: Object.keys(jsEntries).length ? 'exports-only' : false,
            output: {
              sourcemapPathTransform: (source, sourcemapPath) => sourcePath(path.dirname(sourcemapPath), source),
            },
          },
        };
        // Production bundles: bundlers treat every
        // Type.prototype.cljs$core$ISeq$_first$arity$1 = ... as a side effect.
        // generateBundle removes the ones never read in the whole bundle,
        // renames ClojureScript's long property names, then minifies, pruning
        // works on unminified code.
        if (options.prune !== false) {
          minify = userConfig.build?.minify ?? true;
          result.build.minify = false;
        }
      } else {
        // The worker threads' environment, resolving as the ssr environment
        // (its ssr options), created with Vite's DevEnvironment: its
        // transport is the plugin's channel to the threads
        if (env.command === 'serve' && (options.workers ?? Boolean(options.ssrEntries?.length))) {
          const ssr = userConfig.ssr ?? {};
          const resolve = Object.fromEntries(Object.entries({
            noExternal: ssr.noExternal,
            external: ssr.external,
            conditions: ssr.resolve?.conditions,
            externalConditions: ssr.resolve?.externalConditions,
          }).filter(([, v]) => v !== undefined));
          result.environments = {
            [WORKER_ENV]: {
              consumer: 'server',
              resolve,
              dev: {
                createEnvironment: async (name, resolvedConfig) => {
                  const { DevEnvironment } = await importVite(root);
                  return new DevEnvironment(name, resolvedConfig, { hot: true, transport: workerChannel });
                },
              },
            },
          };
        }
        // dependencies to pre-bundle, from the previous build's entry points
        // and the page, not every HTML file under the root
        const info = await buildInfo();
        result.optimizeDeps = {
          entries: [
            ...Object.values(info?.main ?? {}).map(file => path.relative(root, path.join(outputDir, file)).split(path.sep).join('/')),
            ...(indexHtml ? ['index.html'] : []),
          ],
        };
      }
      return result;
    },

    configResolved(resolved) {
      config = resolved;
      // generateBundle composes every chunk's source map after minifying:
      // Vite's composition of its preload edits moves there, into workers
      if (config.command === 'build' && options.prune !== false && minify &&
          (config.build.sourcemap === true || config.build.sourcemap === 'hidden')) {
        const importAnalysis = config.plugins.find(p => p.name === 'vite:build-import-analysis');
        if (importAnalysis?.generateBundle) deferPreloadSourceMaps(importAnalysis, preloadEdits);
      }
    },

    // vite build --watch's watcher closed (i.e. through the JavaScript API):
    // its compiler and REPL socket go with it
    closeWatcher() {
      closeReplSocket();
      if (config?.command === 'build') proc?.kill();
    },

    // a watch rebuild, started by the compiler writing its output, bundles
    // the finished compile
    async buildStart() {
      if (config.command === 'build') {
        await compiling;
        builtInfo = (await buildInfo()) ?? builtInfo;
      }
    },

    // :npm-interop :shadow, ["pkg" :as x] binds module.exports of CommonJS
    // modules and the namespace of ES modules, like shadow-cljs
    async resolveId(source, importer, opts) {
      // A ClojureScript source: its compiled module, as a module importing it
      // when serving, which a page loading it by its source's URL and the
      // modules importing it by its own share
      const file = source.split(/[?#]/)[0];
      if (SOURCE_FILE.test(file) && !source.startsWith('\0')) {
        // URLs are root-relative, files are only served from the project
        const candidates = [
          ...(file.startsWith('/') ? [path.join(root, file)] : []),
          ...(importer && !importer.startsWith('\0') && !file.startsWith('/')
            ? [path.resolve(path.dirname(importer.split('?')[0]), file)]
            : []),
          ...(path.isAbsolute(file) ? [file] : []),
        ];
        const found = candidates.find(f => servedSource(f) && existsSync(f));
        if (!found) return null;
        return config.command === 'build' ? compiledModule(found) : '\0' + SOURCE + found;
      }
      if (!source.startsWith(NPM_AS)) return null;
      const resolved = await this.resolve(source.slice(NPM_AS.length), importer, { ...opts, skipSelf: true });
      if (!resolved) return null;
      if (!resolved.id.includes('/node_modules/')) localModules.add(resolved.id.split('?')[0]);
      return '\0' + NPM_AS + resolved.id;
    },

    // Vite's dev server only converts CommonJS in node_modules (pre-bundling),
    // project CommonJS files required by ClojureScript are converted here
    transform(code, id) {
      if (config.command !== 'serve' || !localModules.has(id.split('?')[0]) || !isCommonJS(code)) return null;
      return commonJSToESM(code);
    },

    async load(id) {
      // The dev server's server environments (ssr, worker threads) run
      // modules with Vite's module runner, which would run a CommonJS npm
      // module as an ES module, without its exports: Node.js loads it
      // instead, as it does the dependencies Vite externalizes. Its
      // module.exports is the default export, its keys named exports. A
      // resolved file, whichever plugin resolved it (i.e. a project's own
      // resolver of npm packages, which an absolute path keeps from being
      // externalized).
      const cjsFile = !id.startsWith('\0') && serverEnvironment(this) && id.split('?')[0];
      if (cjsFile && path.isAbsolute(cjsFile) && cjsFile.includes(`${path.sep}node_modules${path.sep}`) &&
          await isCommonJSFile(cjsFile)) {
        const file = cjsFile;
        const require = createRequire(file);
        let names = [];
        try {
          const m = require(file);
          names = m && (typeof m === 'object' || typeof m === 'function')
            ? Object.keys(m).filter(k => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'default')
            : [];
        } catch (e) {
          // loads in the runtime, which reports it
        }
        // locals named apart from the keys, which may be reserved words
        // (exports.delete): string export names
        return `import { createRequire } from 'node:module';\n` +
          `const m = createRequire(${JSON.stringify(file)})(${JSON.stringify(file)});\n` +
          `export default m;\n` +
          names.map((n, i) => `const $$cjs${i} = m[${JSON.stringify(n)}];\n` +
            `export { $$cjs${i} as ${JSON.stringify(n)} };\n`).join('');
      }
      if (id.startsWith('\0' + SOURCE)) {
        const file = id.slice(SOURCE.length + 1);
        if (!servedSource(file)) this.error(`${file} is outside the project`);
        const module = await compiledModule(file);
        return `import ${JSON.stringify(module)};\nexport * from ${JSON.stringify(module)};\n`;
      }
      // compiled namespaces with their source maps, to the ClojureScript sources
      if (config.command === 'build' && config.build.sourcemap && id.startsWith(outputDir + path.sep) && id.endsWith('.js')) {
        try {
          const [code, map] = await Promise.all([fs.readFile(id, 'utf8'), fs.readFile(id + '.map', 'utf8')]);
          // read here, not by the bundler: vite build --watch rebuilds when it changes
          this.addWatchFile(id);
          return { code, map: JSON.parse(map) };
        } catch (e) {
          return null;
        }
      }
      if (!id.startsWith('\0' + NPM_AS)) return null;
      const target = id.slice(NPM_AS.length + 1);
      const file = target.split('?')[0];
      let commonjs = false;
      try {
        commonjs = file.includes('/.vite/deps/')
          // pre-bundled by the dev server, which records CommonJS deps
          ? await preBundledCommonJS(file)
          : isCommonJS(await fs.readFile(file, 'utf8'));
      } catch (e) {
        // virtual or unreadable modules are treated as ES modules
      }
      // An ES module only exporting default binds the default export: dual
      // packages' module.exports, which shadow-cljs resolved them to.
      return commonjs
        ? `import m from ${JSON.stringify(target)};\nexport default m;\n`
        : `import * as m from ${JSON.stringify(target)};\n` +
          `const keys = Object.keys(m);\n` +
          `export default keys.length === 1 && keys[0] === 'default' ? m[keys[0]] : m;\n`;
    },

    // after Vite's own generateBundle hooks, i.e. its preloading of dynamic
    // imports' dependencies, which edits chunks and their source maps
    generateBundle: { order: 'post', async handler(outputOptions, bundle) {
      if (config.command !== 'build') return;
      const chunks = Object.values(bundle).filter(c => c.type === 'chunk');
      if (options.prune !== false) {
        const start = Date.now();
        const oxcPath = resolveFromProject(config.root, 'rolldown/utils', 'prune and minify');
        const pruned = pruneChunks(chunks.map(c => c.code), await summarizeChunks(oxcPath, chunks));
        const pruneMs = Date.now() - start;
        const renames = propertyRenames(pruned.codes);
        const minified = minify && await minifyChunks(
          oxcPath,
          chunks.some(c => c.map) ? resolveFromProject(config.root, '@jridgewell/remapping', 'compose source maps') : null,
          // the file name in the chunk's directory: the source the map's
          // sources are composed relative to
          chunks.map(c => path.basename(c.fileName)),
          pruned.codes,
          chunks.map(c => c.map ? c.map.toString() : null),
          chunks.map(c => {
            const pending = preloadEdits.get(c.fileName);
            return pending && c.map && { fileName: c.fileName, code: pending.code, ...pending.edit };
          }),
          {
            module: true,
            compress: true,
            mangle: true,
            // the renames apply across chunks, cljs$ properties are the
            // compiler's, only accessed as properties (or quoted)
            mangleProps: { include: /^cljs\$/, quoted: true, cache: renames },
            // licence notices (/*! ... */, @license, @preserve), as other minifiers keep them
            codegen: { legalComments: 'inline' },
          });
        chunks.forEach((chunk, i) => {
          let code = pruned.codes[i];
          if (minified) {
            const result = minified[i];
            // its output may be partial: a build that ships it isn't one
            if (result.error) this.error(`minifying ${chunk.fileName}: ${result.error}`);
            code = result.code;
            if (chunk.map) {
              const map = new ChunkSourceMap(result.map);
              const dir = path.join(path.resolve(config.root, config.build.outDir), path.dirname(chunk.fileName));
              map.sources = map.sources.map(source => sourcePath(dir, source));
              chunk.map = map;
              // the bundler has emitted the chunk's map file already
              const asset = bundle[chunk.fileName + '.map'];
              if (asset?.type === 'asset') asset.source = map.toString();
              // the minifier drops the bundler's source map comment
              if (config.build.sourcemap === true) code += `\n//# sourceMappingURL=${path.basename(chunk.fileName)}.map\n`;
            }
          }
          chunk.code = code;
        });
        if (!pruned.removed && await commonJSPackage(config.root)) {
          this.warn('nothing was pruned: package.json has "type": "commonjs", so the bundler treats the project\'s ' +
            '.js files as CommonJS and wraps the ClojureScript they import in initializers. Use "type": "module".');
        }
        config.logger.info(`[cljf] removed ${pruned.removed} unused statements (${pruneMs}ms), ` +
          `renamed ${Object.keys(renames).length} properties, ` +
          `minified (${Date.now() - start - pruneMs}ms)`);
      }
      if (manifestName) {
        // entry points' chunks, with the chunks they import statically
        const byFile = Object.fromEntries(chunks.map(c => [c.fileName, c]));
        const imports = (chunk, seen = new Set()) => {
          for (const file of chunk.imports) {
            // external modules aren't chunks
            if (!seen.has(file) && byFile[file]) {
              seen.add(file);
              imports(byFile[file], seen);
            }
          }
          return seen;
        };
        const manifest = {};
        for (const [ns, file] of Object.entries(builtInfo?.main ?? {})) {
          const chunk = chunks.find(c => c.facadeModuleId === path.join(outputDir, file));
          if (!chunk) continue;
          manifest[ns] = {
            scripts: [config.base + chunk.fileName],
            preload: [...imports(chunk)].map(f => config.base + f),
          };
        }
        this.emitFile({ type: 'asset', fileName: manifestName, source: JSON.stringify(manifest, null, 2) });
      }
    } },

    // The dev server's pages load the compiled modules of their scripts'
    // ClojureScript sources, which Vite would serve as files. Builds resolve
    // them (resolveId).
    transformIndexHtml: {
      order: 'pre',
      async handler(html, { filename }) {
        if (config.command !== 'serve') return html;
        const replacements = await Promise.all(
          // with a query or fragment, which the compiled module's URL keeps
          [...html.matchAll(/(<script\b[^>]*\bsrc\s*=\s*["'])([^"'?#]+\.clj[sc])([?#][^"']*)?(["'])/gi)].map(async match => {
            const file = match[2].startsWith('/') ? path.join(config.root, match[2]) : path.resolve(path.dirname(filename), match[2]);
            return [match[0], match[1] + devUrl(await compiledModule(file)) + (match[3] ?? '') + match[4]];
          }));
        return replacements.reduce((result, [from, to]) => result.replace(from, to), html);
      },
    },

    // Hot updates of compiled modules wait for the compile (and its build
    // hooks, i.e. generated CSS) to finish, in every environment: the pages',
    // the ssr environment's and the worker threads'.
    async hotUpdate({ file }) {
      await compiling;
      if (warnings.held(file)) return [];
    },

    // for scripts running the dev server themselves (createServer), i.e. to
    // import a server once its ClojureScript is compiled
    api: {
      /**
       * Resolves once the dev server's first compile finished: true if it
       * succeeded, false if it failed. Rejects if the compiler exits first.
       */
      ready: () => initialCompile,
      /**
       * Resolves once a compile of the dev server succeeded (with warnings or
       * not): its output is complete, i.e. a server's entry can be imported.
       * Rejects if the compiler exits first.
       */
      compiled: () => successfulCompile,
    },

    configureServer(devServer) {
      server = devServer;
      // The dev server for the REPL's MCP server: its config, whether it
      // ignores warnings, once the compiler runs (in middleware mode there's
      // no httpServer), then its URLs once it listens, which tell agents
      // which page to open
      const devServerInfo = () => toRepl({
        op: 'dev-server',
        urls: server.resolvedUrls ? [...server.resolvedUrls.local, ...server.resolvedUrls.network] : [],
        config: config.configFile ? path.relative(cwd, config.configFile) : undefined,
        ignoreWarnings: !!options.ignoreWarnings,
      });
      server.httpServer?.once('listening', () => setTimeout(devServerInfo, 0));
      // Vite's own errors for the REPL's MCP server (vite_errors): those the
      // dev server's overlay shows (transforms, i.e. TypeScript or CSS),
      // until an update replaces them, and those it logs (i.e. the ssr
      // environment's), not the plugin's (build_status has the compiler's)
      const stripAnsi = text => String(text).replace(/\u001b\[[\d;]*m/g, '');
      const viteError = (source, err) => {
        toRepl({
          op: 'vite-error',
          source,
          message: stripAnsi(err.message ?? ''),
          ...(err.id ? { file: err.loc?.file ?? err.id } : {}),
          ...(err.loc ? { line: err.loc.line, column: err.loc.column } : {}),
          ...(err.plugin ? { plugin: err.plugin } : {}),
          ...(err.frame ? { frame: stripAnsi(err.frame) } : {}),
          ...(err.stack ? { stack: stripAnsi(err.stack) } : {}),
        });
      };
      const wsSend = server.ws.send.bind(server.ws);
      server.ws.send = (payload, ...rest) => {
        if (payload?.type === 'error' && payload.err?.plugin !== 'cljf') viteError('overlay', payload.err);
        else if (payload?.type === 'update' || payload?.type === 'full-reload') toRepl({ op: 'vite-update' });
        return wsSend(payload, ...rest);
      };
      // the compiler's errors are logged with it: build_status has them
      const loggerError = config.logger.error.bind(config.logger);
      config.logger.error = (msg, opts) => {
        const text = stripAnsi(msg);
        // not the runtimes' errors Vite 8 forwards from the pages ([Unhandled
        // error], [Unhandled rejection]): console_logs has them, with their
        // runtime. The plugin's own (an ssrEntries or worker failing to run)
        // are recorded.
        if (!/^\[Unhandled (?:error|rejection)\]/.test(text)) {
          // an Error's message and stack aren't enumerable, spreading it
          // would lose them
          const e = opts?.error;
          viteError('log', {
            message: text,
            ...(e ? { stack: e.stack, id: e.id, loc: e.loc, plugin: e.plugin, frame: e.frame } : {}),
          });
        }
        return loggerError(msg, opts);
      };
      let compiled = () => {};
      let readyResolve;
      const initialBuild = new Promise(resolve => (readyResolve = resolve));
      // ok: whether the compile succeeded (with warnings or not)
      const ready = ok => {
        readyResolve();
        firstCompile(ok);
        if (ok) firstSuccess();
      };
      // the overlay of the last compile's error or warnings, for pages loaded
      // since: a reloaded page runs the output with warnings
      let problem = null;
      const showProblem = err => {
        problem = { type: 'error', err: { stack: '', plugin: 'cljf', ...err } };
        server.ws.send(problem);
      };
      server.ws.on('connection', socket => problem && socket.send(JSON.stringify(problem)));
      // the build info createWorker resolves :js-entries names with, read
      // after each compile
      let devInfo = null;
      const refreshDevInfo = async () => (devInfo = (await buildInfo()) ?? devInfo);
      // options.ssrEntries run in the ssr environment's runner once compiled,
      // until they ran
      let ssrEntries = options.ssrEntries ?? [];
      // one run at a time: a compile's run waits for the previous compile's,
      // which imports the entries it doesn't run yet
      let ssrEntriesRun = Promise.resolve();
      const runSsrEntries = () => (ssrEntriesRun = ssrEntriesRun.then(runSsrEntriesOnce));
      const runSsrEntriesOnce = async () => {
        await refreshDevInfo();
        if (!ssrEntries.length) return;
        // created when it's first read
        const runner = server.environments.ssr?.runner;
        if (!runner) return;
        const info = await buildInfo();
        for (const name of ssrEntries) {
          const file = info?.entries?.[name];
          if (!file) {
            config.logger.error(`[cljf] ssrEntries: no :js-entries ${name}`, { timestamp: true });
            continue;
          }
          try {
            await runner.import(path.join(outputDir, file));
            ssrEntries = ssrEntries.filter(n => n !== name);
          } catch (e) {
            config.logger.error(`[cljf] running ${name} (${file}): ${e.stack ?? e}`, { timestamp: true });
          }
        }
      };
      server.ws.on('connection', (socket, req) => {
        // cljs_eval compiles forms in the compiler's JVM, which runs their macros:
        // only for pages on this machine, unless replRemoteConsole
        const runtime = connectRuntime(
          data => socket.send(JSON.stringify({ type: 'custom', event: 'cljs:repl', data })),
          options.replRemoteConsole || isLocalConnection(req));
        socket.on('message', raw => {
          let msg;
          try {
            msg = JSON.parse(String(raw));
          } catch {
            return;
          }
          if (msg?.type !== 'custom' || msg.event !== 'cljs:repl' || !msg.data) return;
          runtime.receive(msg.data);
        });
        socket.on('close', runtime.close);
      });
      // Worker threads (createWorker of clojurific/worker): module runners
      // of the WORKER_ENV environment, hot reloaded, and runtimes of the REPL
      // as clients of its channel
      if (server.environments[WORKER_ENV]) {
        const workers = devWorkers({
          channel: workerChannel,
          root,
          resolve: entry => entryModule(devInfo, outputDir, root, entry),
          onError: (e, entry) => config.logger.error(`[cljf] worker ${entry}: ${e.stack ?? e}`, { timestamp: true }),
        });
        globalThis.__CLJF_DEV_WORKERS__ = workers;
        const closeWorkers = () => {
          if (globalThis.__CLJF_DEV_WORKERS__ === workers) delete globalThis.__CLJF_DEV_WORKERS__;
          return workers.close();
        };
        server.httpServer?.once('close', closeWorkers);
        const close = server.close.bind(server);
        server.close = async () => {
          await closeWorkers();
          return close();
        };
      }
      // the server environments' module runners (the ssr environment's in
      // this process, the worker threads') are clients of their hot channels
      for (const environment of [server.environments.ssr, server.environments[WORKER_ENV]]) {
        const hot = environment?.hot;
        if (!hot) continue;
        const clientRuntimes = new Map();
        const clientRuntime = client => {
          if (!clientRuntimes.has(client)) clientRuntimes.set(client, connectRuntime(data => client.send('cljs:repl', data), true));
          return clientRuntimes.get(client);
        };
        hot.on('cljs:repl', (data, client) => data && clientRuntime(client).receive(data));
        hot.on('vite:client:disconnect', (data, client) => {
          clientRuntimes.get(client)?.close();
          clientRuntimes.delete(client);
        });
      }
      proc = run(compilerArgs('watch', { ':esm-hmr': true, ':exit-with-parent': true, ':watch-events': ':stdin' }), async event => {
        if (event.type === 'repl-send') return replSend(event);
        if (event.type === 'watch-dirs') {
          // the compiler reads its stdin now, before its first build
          devServerInfo();
          // Vite's watcher (native file events) reports changes in the
          // compiler's source directories, polling them is expensive
          const dirs = event.dirs.map(dir => dir + path.sep);
          server.watcher.add(event.dirs);
          server.watcher.on('all', (type, file) => {
            // removed files too: a generated test runner requires what is left
            if ((type === 'change' || type === 'add' || type === 'unlink') && dirs.some(dir => file.startsWith(dir))) {
              proc.stdin.write(`changed ${file}\n`);
            }
          });
          return;
        }
        if (event.type === 'compiling') {
          compiling = new Promise(resolve => (compiled = resolve));
          return;
        }
        // before the hot updates waiting for the compile
        const held = event.type === 'compiled' ? warnings.compiled(event) : null;
        compiled();
        // The dev manifest, the pages' scripts, is written after the first
        // compile even if it failed: pages then show the error overlay.
        const info = await buildInfo();
        if (info) {
          await writeManifest(Object.fromEntries(Object.entries(info.main).map(([ns, file]) =>
            [ns, { scripts: [`${config.base}@vite/client`, devUrl(file)], preload: [] }])));
        }
        if (held?.outstanding.length) {
          const { outstanding } = held;
          const [first] = outstanding;
          config.logger.warn(`[cljf] compiled ${event.namespaces} namespace(s) in ${event.ms}ms, ` +
            `hot reload paused by ${outstanding.length} warning(s)`, { timestamp: true });
          showProblem({
            message: outstanding
              .map(w => `WARNING: ${w.message}${w.file ? ` at ${path.relative(cwd, w.file)}:${w.line}` : ''}`)
              .join('\n') + '\n\nHot reload is paused until the warnings are fixed.',
            id: first.file,
            loc: first.file ? { file: first.file, line: first.line, column: first.column } : undefined,
          });
          // The ssr entries run regardless: they run once, and a warning is no
          // error. The HTML pages a server entry serves show the overlay above
          // (those loading @vite/client); a port that never opens shows
          // nothing but the line above.
          runSsrEntries();
          // createWorker resolves :js-entries names with it, i.e. right after
          // api.compiled()
          await refreshDevInfo();
          ready(true);
        } else if (held) {
          const { released, ignored } = held;
          // all namespaces' warnings, not only this compile's
          config.logger.info(`[cljf] compiled ${event.namespaces} namespace(s) in ${event.ms}ms` +
            (ignored ? `, ${ignored} outstanding warning(s) ignored` : ''), { timestamp: true });
          problem = null;
          // the namespaces held back that this compile didn't update, in every
          // environment: a server entry's (ssr) as well as the pages'
          for (const environment of Object.values(server.environments)) {
            for (const file of released) {
              for (const mod of environment.moduleGraph.getModulesByFile(file) ?? []) environment.reloadModule(mod);
            }
          }
          runSsrEntries();
          // createWorker resolves :js-entries names with it, i.e. right after
          // api.compiled()
          await refreshDevInfo();
          ready(true);
        } else if (event.type === 'error') {
          loggerError(`[cljf] ${event.message}`, { timestamp: true });
          showProblem({
            message: event.message,
            id: event.file,
            loc: event.file ? { file: event.file, line: event.line, column: event.column } : undefined,
          });
          ready(false);
        }
      });
      // The compiler exiting stops the dev server's compiles and hot reloads:
      // before a successful compile, api.ready() and api.compiled() reject (a
      // script waiting for them exits rather than hangs), after, its output
      // stays as it was.
      let stopping = false;
      proc.on('exit', (code, signal) => {
        if (stopping) return;
        const message = `ClojureScript watch exited (${signal ?? code}): no more compiles or hot reloads, restart the dev server`;
        config.logger.error(`[cljf] ${message}`, { timestamp: true });
        readyResolve();
        compilerExited(new Error(message));
      });
      const stop = () => {
        stopping = true;
        proc.kill();
      };
      server.httpServer?.once('close', stop);
      process.once('exit', stop);
      // hold requests until the initial compile finished
      server.middlewares.use(async (req, res, next) => {
        await initialBuild;
        next();
      });
    },
  };
}
