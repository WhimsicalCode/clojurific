// Vite plugin for ClojureScript compiled to ES modules (:module-format :esm).
//
// The ClojureScript compiler runs in a JVM, `vite build` runs a one-shot build
// before bundling, `vite` (dev) runs the compiler in watch mode. Compiled
// namespaces are plain ES modules in outputDir, Vite serves, hot reloads and
// bundles them like any other JavaScript, including the npm packages and
// TypeScript files they import.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { pruneChunks, renameProps } from './prune.js';

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
async function loadMinifier(root) {
  for (const base of [root, process.cwd()]) {
    try {
      const resolved = createRequire(path.join(base, 'noop.js')).resolve('rolldown/utils');
      return (await import(pathToFileURL(resolved).href)).minify;
    } catch (e) {
      // try the next location
    }
  }
  throw new Error('rolldown/utils not found, can not minify');
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
 */
export default function cljs(options) {
  const manifestName = options.manifest ?? 'manifest.json';
  let config, proc, server, minify, cwd, outputDir;
  let compiling = Promise.resolve();
  const localModules = new Set();

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

  async function buildInfo() {
    try {
      return JSON.parse(await fs.readFile(path.join(outputDir, 'cljs-esm.json'), 'utf8'));
    } catch (e) {
      return null;
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
    name: 'cljs',
    // before Vite's resolver, which would take cljs-npm-as: specifiers
    enforce: 'pre',

    async config(userConfig, env) {
      cwd = path.resolve(options.cwd ?? userConfig.root ?? process.cwd());
      outputDir = path.resolve(cwd, options.outputDir);
      const result = { root: outputDir };
      if (env.command === 'build' && !env.isPreview) {
        const start = Date.now();
        await new Promise((resolve, reject) => {
          const child = run(compilerArgs('build', { ':verbose': false }), () => {});
          child.stdin.end();
          child.on('exit', code => code === 0 ? resolve() : reject(new Error(`ClojureScript build failed (${code})`)));
        });
        console.log(`ClojureScript compiled in ${Date.now() - start}ms`);
        const info = await buildInfo();
        result.build = {
          rollupOptions: {
            input: Object.fromEntries(Object.entries(info.main).map(([ns, file]) => [ns, path.join(outputDir, file)])),
            preserveEntrySignatures: false,
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

    async generateBundle(outputOptions, bundle) {
      if (config.command !== 'build') return;
      const chunks = Object.values(bundle).filter(c => c.type === 'chunk');
      if (options.prune !== false) {
        const parse = code => this.parse(code);
        const start = Date.now();
        const pruned = pruneChunks(chunks.map(c => c.code), parse);
        const pruneMs = Date.now() - start;
        const renamed = renameProps(pruned.codes, parse);
        const renameMs = Date.now() - start - pruneMs;
        const minifier = minify ? await loadMinifier(config.root) : null;
        await Promise.all(chunks.map(async (chunk, i) => {
          let code = renamed.codes[i];
          if (minifier) {
            const result = await minifier(chunk.fileName, code, { module: true, compress: true, mangle: true });
            if (result.errors?.length) this.warn(`minifying ${chunk.fileName}: ${result.errors[0].message}`);
            code = result.code;
          }
          chunk.code = code;
          chunk.map = null;
        }));
        config.logger.info(`[cljs] removed ${pruned.removed} unused statements (${pruneMs}ms), ` +
          `renamed ${renamed.renamed} properties (${renameMs}ms), ` +
          `minified (${Date.now() - start - pruneMs - renameMs}ms)`);
      }
      if (manifestName) {
        // entry points' chunks, with the chunks they import statically
        const byFile = Object.fromEntries(chunks.map(c => [c.fileName, c]));
        const imports = (chunk, seen = new Set()) => {
          for (const file of chunk.imports) {
            if (!seen.has(file)) {
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
    },

    // Hot updates of compiled modules wait for the compile (and its build
    // hooks, i.e. generated CSS) to finish.
    async handleHotUpdate() {
      await compiling;
    },

    configureServer(devServer) {
      server = devServer;
      let ready, compiled = () => {};
      const initialBuild = new Promise(resolve => (ready = resolve));
      proc = run(compilerArgs('watch', { ':esm-hmr': true, ':exit-with-parent': true, ':watch-events': ':stdin' }), async event => {
        if (event.type === 'watch-dirs') {
          // Vite's watcher (native file events) reports changes in the
          // compiler's source directories, polling them is expensive
          const dirs = event.dirs.map(dir => dir + path.sep);
          server.watcher.add(event.dirs);
          server.watcher.on('all', (type, file) => {
            if ((type === 'change' || type === 'add') && dirs.some(dir => file.startsWith(dir))) {
              proc.stdin.write(`changed ${file}\n`);
            }
          });
          return;
        }
        if (event.type === 'compiling') {
          compiling = new Promise(resolve => (compiled = resolve));
          return;
        }
        compiled();
        // The dev manifest, the pages' scripts, is written after the first
        // compile even if it failed: pages then show the error overlay.
        const info = await buildInfo();
        if (info) {
          await writeManifest(Object.fromEntries(Object.entries(info.main).map(([ns, file]) =>
            [ns, { scripts: [`${config.base}@vite/client`, config.base + file], preload: [] }])));
        }
        if (event.type === 'compiled') {
          config.logger.info(`[cljs] compiled ${event.namespaces} namespace(s) in ${event.ms}ms`, { timestamp: true });
          ready();
        } else if (event.type === 'error') {
          config.logger.error(`[cljs] ${event.message}`, { timestamp: true });
          server.ws.send({
            type: 'error',
            err: {
              message: event.message,
              stack: '',
              id: event.file,
              loc: event.file ? { file: event.file, line: event.line, column: event.column } : undefined,
              plugin: 'cljs',
            },
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
