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
 * @param {string|string[]} options.main namespace(s) to compile, as symbols i.e. "'my.app"
 * @param {string} [options.outputDir] defaults to "out"
 * @param {string[]} options.command the command starting Clojure with the
 *   compiler on the classpath, i.e. ["clojure", "-M:cljs"]
 * @param {object} [options.compilerOptions] additional compiler options
 * @param {boolean} [options.prune] remove unused protocol implementations and
 *   shorten ClojureScript property names in production bundles, defaults to
 *   true
 */
export default function cljs(options) {
  const outputDir = options.outputDir ?? 'out';
  const mains = [].concat(options.main).map(m => m.startsWith("'") ? m : "'" + m);
  let config, proc, server, minify;
  const localModules = new Set();

  function compilerOptions(extra) {
    return ednValue({
      ':main': mains,
      ':output-dir': path.resolve(config.root, outputDir),
      ...extra,
      ...options.compilerOptions,
    });
  }

  function run(args, onEvent) {
    const [cmd, ...cmdArgs] = options.command;
    const child = spawn(cmd, [...cmdArgs, '-m', 'cljs.esm', ...args], {
      cwd: options.cwd ?? config.root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line.startsWith(EVENT_PREFIX)) onEvent(JSON.parse(line.slice(EVENT_PREFIX.length)));
        else if (line.trim()) config.logger.info(line);
      }
    });
    child.stderr.on('data', chunk => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim()) config.logger.warn(line);
      }
    });
    return child;
  }

  return {
    name: 'cljs',

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
      if (config.command !== 'serve' || !localModules.has(id) || !isCommonJS(code)) return null;
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
      return commonjs
        ? `import m from ${JSON.stringify(target)};\nexport default m;\n`
        : `import * as m from ${JSON.stringify(target)};\nexport default m;\n`;
    },

    async buildStart() {
      if (config.command !== 'build') return;
      const start = Date.now();
      await new Promise((resolve, reject) => {
        const child = run([compilerOptions({ ':verbose': false })], () => {});
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`ClojureScript build failed (${code})`)));
      });
      config.logger.info(`ClojureScript compiled in ${Date.now() - start}ms`);
    },

    // Production bundles: bundlers treat every
    // Type.prototype.cljs$core$ISeq$_first$arity$1 = ... as a side effect.
    // Removes the ones never read in the whole bundle (with the code only they
    // reference), renames ClojureScript's long property names, then minifies,
    // pruning works on unminified code.
    config(userConfig, env) {
      if (env.command !== 'build' || options.prune === false) return;
      minify = userConfig.build?.minify ?? true;
      return { build: { minify: false } };
    },

    async generateBundle(outputOptions, bundle) {
      if (config.command !== 'build' || options.prune === false) return;
      const parse = code => this.parse(code);
      const chunks = Object.values(bundle).filter(c => c.type === 'chunk');
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
    },

    configureServer(devServer) {
      server = devServer;
      let ready;
      const initialBuild = new Promise(resolve => (ready = resolve));
      proc = run(['watch', compilerOptions({ ':esm-hmr': true })], event => {
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
      server.httpServer?.once('close', () => proc.kill());
      // hold requests until the initial compile finished
      server.middlewares.use(async (req, res, next) => {
        await initialBuild;
        next();
      });
    },
  };
}
