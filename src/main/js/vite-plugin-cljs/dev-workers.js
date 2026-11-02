// Worker threads under the Vite dev server (see worker.js): each runs a
// module runner of the ssr environment (worker-runner.js) whose transport is
// a MessagePort, relayed here to the environment's hot channel as Vite's own
// runner transport (createServerModuleRunnerTransport) does. Every thread is
// a client of the channel: it gets hot updates, and the REPL a runtime.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MessageChannel, Worker } from 'node:worker_threads';

const RUNNER = fileURLToPath(new URL('./worker-runner.js', import.meta.url));

// The URL of Vite's module runner (vite/module-runner) of the Vite running
// the dev server, resolved from root: the plugin isn't in its node_modules
// when it's linked or run from a checkout.
export function moduleRunnerUrl(root) {
  const require = createRequire(path.join(root, 'package.json'));
  const pkgFile = require.resolve('vite/package.json');
  const exported = JSON.parse(readFileSync(pkgFile, 'utf8')).exports?.['./module-runner'];
  const file = typeof exported === 'string' ? exported : exported?.import?.default ?? exported?.import ?? exported?.default;
  if (!file) throw new Error(`[cljf] ${pkgFile} exports no ./module-runner (Vite 6 or later runs worker threads)`);
  return pathToFileURL(path.join(path.dirname(pkgFile), file)).href;
}

// A payload a port can carry: structured clone, JSON for the rest (i.e. an
// invocation's error with functions on it)
function post(port, payload) {
  try {
    port.postMessage(payload);
  } catch {
    port.postMessage(JSON.parse(JSON.stringify(payload)));
  }
}

/**
 * Spawns worker threads running modules of environment (the dev server's ssr
 * environment, whose hot channel is Vite's server hot channel), resolve(entry)
 * the module a :js-entries name or path is, runnerUrl vite/module-runner's
 * (default: of the Vite root resolves). Returns { spawn(entry, options),
 * close() }.
 */
export function devWorkers({ environment, root, resolve, runnerUrl, onError = () => {} }) {
  const api = environment.hot?.api;
  if (!api?.innerEmitter || !api?.outsideEmitter) {
    throw new Error(`[cljf] the ${environment.name} environment's hot channel isn't Vite's server hot channel: ` +
      'createWorker runs worker threads of the default ssr environment');
  }
  const workers = new Set();

  function spawn(entry, options = {}) {
    runnerUrl ??= moduleRunnerUrl(root);
    const file = resolve(entry);
    if (!file) throw new Error(`[cljf] createWorker: no :js-entries ${entry}, nor a module ${path.resolve(root, entry)}`);
    const { workerData, name, transferList = [], ...workerOptions } = options;
    const { port1, port2 } = new MessageChannel();
    const worker = new Worker(RUNNER, {
      ...workerOptions,
      name,
      workerData: { __cljf: { port: port2, runner: runnerUrl, entry: file, workerData, name } },
      transferList: [port2, ...transferList],
    });
    // the thread's client of the hot channel: invocation replies and the
    // REPL's messages
    const client = {
      send: payload => post(port1, payload),
    };
    // The channel's broadcasts: hot updates and plugins' events. Vite's server
    // hot channel has no per-client send, its in-process runner's replies are
    // broadcasts too: the REPL's messages and invocation replies for that
    // runner aren't this thread's, whose come through client.send.
    const broadcast = payload => {
      if (payload?.type === 'custom' && (payload.event === 'cljs:repl' || payload.event === 'vite:invoke')) return;
      post(port1, payload);
    };
    let connected = false;
    port1.on('message', payload => {
      if (payload?.type === 'cljf:connect') {
        if (connected) return;
        connected = true;
        api.outsideEmitter.on('send', broadcast);
        api.innerEmitter.emit('vite:client:connect', undefined, client);
        post(port1, { type: 'connected' });
      } else if (payload?.type === 'custom') {
        api.innerEmitter.emit(payload.event, payload.data, client);
      }
    });
    // the port mustn't keep the dev server's process alive
    port1.unref();
    const disconnect = () => {
      workers.delete(worker);
      if (!connected) return;
      connected = false;
      api.outsideEmitter.off('send', broadcast);
      api.innerEmitter.emit('vite:client:disconnect', undefined, client);
      port1.close();
    };
    worker.once('exit', disconnect);
    worker.once('error', e => onError(e, entry));
    workers.add(worker);
    return worker;
  }

  return {
    spawn,
    close: () => Promise.all([...workers].map(w => w.terminate())),
  };
}

/** The module of :js-entries name in the build info, else a file under root. */
export function entryModule(info, outputDir, root, entry) {
  const file = info?.entries?.[entry];
  if (file) return path.join(outputDir, file);
  const module = path.resolve(root, entry);
  return existsSync(module) ? module : null;
}
