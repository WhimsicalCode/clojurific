// Vite plugin for ClojureScript compiled to ES modules (:module-format :esm).
//
// The ClojureScript compiler runs in a JVM, `vite build` runs a one-shot build
// before bundling, `vite` (dev) runs the compiler in watch mode. Compiled
// namespaces are plain ES modules in outputDir, Vite serves, hot reloads and
// bundles them like any other JavaScript, including the npm packages and
// TypeScript files they import.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { pruneChunks, propertyRenames } from './prune.js';

const EVENT_PREFIX = '[cljs.esm] ';
const NPM_AS = 'cljs-npm-as:';

// A module without ES module syntax is CommonJS, i.e. its module.exports is
// what shadow-cljs binds with :as.
function isCommonJS(code) {
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return !/(^|[;\n])\s*(import\s*[\w*{"']|export\s+[\w*{]|export\s*\{)/.test(stripped);
}

function ednString(s) {
  return JSON.stringify(s);
}

function ednValue(v) {
  if (Array.isArray(v)) return `[${v.map(ednValue).join(' ')}]`;
  if (typeof v === 'string') return v.startsWith(':') || v.startsWith("'") ? v.replace(/^'/, '') : ednString(v);
  if (v && typeof v === 'object') {
    return `{${Object.entries(v).map(([k, x]) => `${k.startsWith(':') ? k : ':' + k} ${ednValue(x)}`).join(' ')}}`;
  }
  return String(v);
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

async function loadFromProject(root, specifier, purpose) {
  return import(pathToFileURL(resolveFromProject(root, specifier, purpose)).href);
}

// Statement summaries of chunks for pruning (prune.js), parsed with oxc's
// parser (shipped with Rolldown, at oxcPath) in worker threads, the largest
// chunks first.
async function summarizeChunks(oxcPath, chunks) {
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

// Composes source maps of the pruned, minified chunks with the bundler's,
// which the project depends on: @jridgewell/remapping.
async function loadRemapping(root) {
  return (await loadFromProject(root, '@jridgewell/remapping', 'compose source maps')).default;
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
 * @param {string[]} options.command starts Clojure with the compiler on the
 *   classpath, i.e. ["clojure", "-M:cljs"], cljs.esm's arguments follow
 * @param {string} [options.cwd] the command's working directory, defaults to
 *   Vite's root
 * @param {string} [options.config] compiler options file (EDN, see
 *   cljs.esm/load-options), relative to cwd
 * @param {string} [options.profile] profile of the config file, defaults to
 *   dev when serving and release when building
 * @param {string} options.outputDir the compiler's output directory, relative
 *   to cwd, Vite's root
 * @param {object|string} [options.compilerOptions] more compiler options, an
 *   EDN string or an object with keyword keys
 * @param {string|false} [options.manifest] writes the entry points' scripts
 *   and preloads to this file in Vite's outDir, for server rendered pages,
 *   defaults to "manifest.json"
 * @param {boolean} [options.prune] remove unused protocol implementations and
 *   shorten ClojureScript property names in production bundles, defaults to
 *   true
 * @param {string[]} [options.entries] the :js-entries this build bundles,
 *   defaults to all; each is self-contained when it's the only one
 */
export default function cljs(options) {
  const manifestName = options.manifest ?? 'manifest.json';
  let config, proc, server, minify, cwd, outputDir;
  let compiling = Promise.resolve();
  const localModules = new Set();
  // Like shadow-cljs, the output isn't hot reloaded while namespaces have
  // warnings, it would fail at runtime (undeclared vars): the warnings by
  // output file, and the output held back until they're fixed.
  const warnings = new Map();
  const held = new Set();

  function compilerArgs(command, extra) {
    const profile = options.profile ?? (command === 'watch' ? 'dev' : 'release');
    const more = typeof options.compilerOptions === 'string'
      ? options.compilerOptions
      : ednValue(options.compilerOptions ?? {});
    return [
      command,
      ...(options.config ? [`@${options.config}`] : []),
      `:${profile}`,
      ednValue({ ':output-dir': outputDir, ...extra }),
      more,
    ];
  }

  function run(args, onEvent) {
    const [cmd, ...cmdArgs] = options.command;
    const child = spawn(cmd, [...cmdArgs, '-m', 'cljs.esm', ...args], {
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
      // the build's options: bundles don't hot reload, the dev server's watch does
      proc = run(compilerArgs('watch', { ':exit-with-parent': true, ':esm-hmr': false }), event => {
        if (event.type === 'compiling') {
          compiling = new Promise(resolve => (compiled = resolve));
        } else if (event.type === 'compiled' || event.type === 'error') {
          compiled();
          const logger = config?.logger ?? console;
          if (event.type === 'error') logger.error(`[cljs] ${event.message}`);
          else logger.info(`[cljs] compiled ${event.namespaces} namespace(s) in ${event.ms}ms`);
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

  async function writeManifest(manifest) {
    if (!manifestName) return;
    const file = path.resolve(config.root, config.build.outDir, manifestName);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // written atomically, a server may read it any time
    await fs.writeFile(`${file}.tmp`, JSON.stringify(manifest, null, 2));
    await fs.rename(`${file}.tmp`, file);
  }

  return {
    name: 'cljs',
    // before Vite's resolver, which would take cljs-npm-as: specifiers
    enforce: 'pre',

    async config(userConfig, env) {
      cwd = path.resolve(options.cwd ?? userConfig.root ?? process.cwd());
      outputDir = path.resolve(cwd, options.outputDir);
      const result = { root: outputDir };
      if (env.command === 'build' && !env.isPreview) {
        const start = Date.now();
        if (userConfig.build?.watch) {
          // vite build --watch: the compiler's watch builds, then watches the
          // sources; the bundler rebuilds when the compiler's output changes
          await watchCompiler();
        } else {
          await new Promise((resolve, reject) => {
            const child = run(compilerArgs('build', { ':verbose': false }), () => {});
            child.stdin.end();
            child.on('exit', code => code === 0 ? resolve() : reject(new Error(`ClojureScript build failed (${code})`)));
          });
        }
        console.log(`ClojureScript compiled in ${Date.now() - start}ms`);
        const info = await buildInfo();
        const jsEntries = Object.fromEntries(Object.entries(info.entries ?? {})
          .filter(([name]) => !options.entries || options.entries.includes(name)));
        const entries = { ...info.main, ...jsEntries };
        result.build = {
          rollupOptions: {
            input: Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, path.join(outputDir, file)])),
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
        // dependencies to pre-bundle, from the previous build's entry points
        const info = await buildInfo();
        if (info) result.optimizeDeps = { entries: Object.values(info.main) };
      }
      return result;
    },

    configResolved(resolved) {
      config = resolved;
    },

    // a watch rebuild, started by the compiler writing its output, bundles
    // the finished compile
    async buildStart() {
      if (config.command === 'build') await compiling;
    },

    // :npm-interop :shadow, ["pkg" :as x] binds module.exports of CommonJS
    // modules and the namespace of ES modules, like shadow-cljs
    async resolveId(source, importer, opts) {
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
        const oxc = await import(pathToFileURL(oxcPath).href);
        const pruned = pruneChunks(chunks.map(c => c.code), await summarizeChunks(oxcPath, chunks));
        const pruneMs = Date.now() - start;
        const renames = propertyRenames(pruned.codes);
        const minifier = minify ? oxc.minify : null;
        const remapping = minifier && chunks.some(c => c.map) ? await loadRemapping(config.root) : null;
        await Promise.all(chunks.map(async (chunk, i) => {
          let code = pruned.codes[i];
          if (minifier) {
            // the file name in the chunk's directory: the source the map's
            // sources are composed relative to
            const result = await minifier(path.basename(chunk.fileName), code, {
              module: true,
              compress: true,
              mangle: true,
              // the renames apply across chunks, cljs$ properties are the
              // compiler's, only accessed as properties (or quoted)
              mangleProps: { include: /^cljs\$/, quoted: true, cache: renames },
              sourcemap: Boolean(chunk.map),
            });
            if (result.errors?.length) this.warn(`minifying ${chunk.fileName}: ${result.errors[0].message}`);
            code = result.code;
            if (chunk.map) {
              // blanking kept the positions of the bundler's map
              const map = remapping([result.map, JSON.parse(chunk.map.toString())], () => null);
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
        }));
        config.logger.info(`[cljs] removed ${pruned.removed} unused statements (${pruneMs}ms), ` +
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
        const info = await buildInfo();
        const manifest = {};
        for (const [ns, file] of Object.entries(info.main)) {
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

    // Hot updates of compiled modules wait for the compile (and its build
    // hooks, i.e. generated CSS) to finish.
    async handleHotUpdate({ file }) {
      await compiling;
      if (held.has(file)) return [];
    },

    configureServer(devServer) {
      server = devServer;
      let ready, compiled = () => {};
      const initialBuild = new Promise(resolve => (ready = resolve));
      // the overlay of the last compile's error or warnings, for pages loaded
      // since: a reloaded page runs the output with warnings
      let problem = null;
      const showProblem = err => {
        problem = { type: 'error', err: { stack: '', plugin: 'cljs', ...err } };
        server.ws.send(problem);
      };
      server.ws.on('connection', socket => problem && socket.send(JSON.stringify(problem)));
      proc = run(compilerArgs('watch', { ':esm-hmr': true, ':exit-with-parent': true, ':watch-events': ':stdin' }), async event => {
        if (event.type === 'watch-dirs') {
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
        let released = [];
        if (event.type === 'compiled') {
          for (const file of event.files ?? []) warnings.delete(file);
          for (const w of event.warnings ?? []) warnings.set(w.output, [...(warnings.get(w.output) ?? []), w]);
          if (warnings.size) {
            for (const file of event.files ?? []) held.add(file);
          } else {
            released = [...held].filter(file => !event.files?.includes(file));
            held.clear();
          }
        }
        compiled();
        // The dev manifest, the pages' scripts, is written after the first
        // compile even if it failed: pages then show the error overlay.
        const info = await buildInfo();
        if (info) {
          await writeManifest(Object.fromEntries(Object.entries(info.main).map(([ns, file]) =>
            [ns, { scripts: [`${config.base}@vite/client`, config.base + file], preload: [] }])));
        }
        const outstanding = [...warnings.values()].flat();
        if (event.type === 'compiled' && outstanding.length) {
          const [first] = outstanding;
          config.logger.warn(`[cljs] compiled ${event.namespaces} namespace(s) in ${event.ms}ms, ` +
            `hot reload paused by ${outstanding.length} warning(s)`, { timestamp: true });
          showProblem({
            message: outstanding
              .map(w => `WARNING: ${w.message}${w.file ? ` at ${path.relative(cwd, w.file)}:${w.line}` : ''}`)
              .join('\n') + '\n\nHot reload is paused until the warnings are fixed.',
            id: first.file,
            loc: first.file ? { file: first.file, line: first.line, column: first.column } : undefined,
          });
          ready();
        } else if (event.type === 'compiled') {
          config.logger.info(`[cljs] compiled ${event.namespaces} namespace(s) in ${event.ms}ms`, { timestamp: true });
          problem = null;
          // the namespaces held back that this compile didn't update
          const client = server.environments.client;
          for (const file of released) {
            for (const mod of client.moduleGraph.getModulesByFile(file) ?? []) client.reloadModule(mod);
          }
          ready();
        } else if (event.type === 'error') {
          config.logger.error(`[cljs] ${event.message}`, { timestamp: true });
          showProblem({
            message: event.message,
            id: event.file,
            loc: event.file ? { file: event.file, line: event.line, column: event.column } : undefined,
          });
          ready();
        }
      });
      const stop = () => proc.kill();
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
