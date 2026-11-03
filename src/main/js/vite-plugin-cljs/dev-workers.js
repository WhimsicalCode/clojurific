// Worker threads under the Vite dev server (see worker.js), with Vite's public
// API only: they run modules of an environment of their own (WORKER_ENV, a
// DevEnvironment of the dev server) whose transport is workerHotChannel, a
// HotChannel where each thread is a client. A thread runs a Vite module
// runner (worker-runner.js) whose transport is a MessagePort to this process:
// its invocations (fetchModule) are answered to it alone, broadcasts (hot
// updates) go to every thread, and the REPL talks to each.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MessageChannel, Worker } from 'node:worker_threads';

const RUNNER = fileURLToPath(new URL('./worker-runner.js', import.meta.url));

/** The dev server environment worker threads run modules of. */
export const WORKER_ENV = 'cljf_worker';

// A file an exports entry names: its import condition's, for ES modules
function exportFile(exported) {
  if (typeof exported === 'string') return exported;
  if (!exported || typeof exported !== 'object') return null;
  return exportFile(exported.import ?? exported.default ?? exported.node);
}

// The URL of subpath of the Vite that root's project resolves, the one
// running the dev server: the plugin isn't in its node_modules when it's
// linked or run from a checkout.
function viteUrl(root, subpath) {
  const require = createRequire(path.join(root, 'package.json'));
  const pkgFile = require.resolve('vite/package.json');
  const file = exportFile(JSON.parse(readFileSync(pkgFile, 'utf8')).exports?.[subpath]);
  if (!file) throw new Error(`[cljf] ${pkgFile} exports no ${subpath} (worker threads need Vite 6 or later)`);
  return pathToFileURL(path.join(path.dirname(pkgFile), file)).href;
}

/** The URL of vite/module-runner, which worker threads run modules with. */
export const moduleRunnerUrl = root => viteUrl(root, './module-runner');

/** The vite module (its DevEnvironment) of the dev server. */
export const importVite = root => import(viteUrl(root, '.'));

/**
 * A HotChannel (Vite's interface of an environment's transport) whose
 * clients are worker threads: connect(client) adds one ({ send(payload) }),
 * receive(payload, client) passes its custom events to the listeners as
 * Vite's hot channels do, disconnect(client) removes it. send broadcasts.
 */
export function workerHotChannel() {
  const listeners = new Map();
  const clients = new Set();
  const emit = (event, data, client) => {
    for (const fn of listeners.get(event) ?? []) fn(data, client);
  };
  return {
    // not exposed over the network, the threads are this process'
    skipFsCheck: true,
    send(payload) {
      for (const client of clients) client.send(payload);
    },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn);
    },
    listen() {
      emit('connection');
    },
    close() {
      for (const client of clients) client.close?.();
      clients.clear();
    },
    connect(client) {
      clients.add(client);
      emit('vite:client:connect', undefined, client);
    },
    receive(payload, client) {
      if (payload?.type === 'custom') emit(payload.event, payload.data, client);
    },
    disconnect(client) {
      if (clients.delete(client)) emit('vite:client:disconnect', undefined, client);
    },
    get clients() {
      return clients.size;
    },
  };
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
 * Spawns worker threads running modules of the environment whose transport
 * is channel (a workerHotChannel), resolve(entry) the module a :js-entries
 * name or path is, runnerUrl vite/module-runner's (default: of the Vite
 * root resolves). Returns { spawn(entry, options), close() }.
 *
 * spawn's options are new Worker's, and onFullReload(worker, payload): a
 * change the environment can't hot update (no module accepts it, i.e. the
 * entry's own TypeScript) calls it instead of re-running the entry in the
 * thread, i.e. to replace the thread.
 */
export function devWorkers({ channel, root, resolve, runnerUrl, onError = () => {} }) {
  const workers = new Set();

  function spawn(entry, options = {}) {
    runnerUrl ??= moduleRunnerUrl(root);
    const file = resolve(entry);
    if (!file) throw new Error(`[cljf] createWorker: no :js-entries ${entry}, nor a module ${path.resolve(root, entry)}`);
    const { workerData, name, transferList = [], onFullReload, ...workerOptions } = options;
    const { port1, port2 } = new MessageChannel();
    const worker = new Worker(RUNNER, {
      ...workerOptions,
      name,
      workerData: { __cljf: { port: port2, runner: runnerUrl, entry: file, workerData, name } },
      transferList: [port2, ...transferList],
    });
    const client = {
      send: payload => {
        if (payload?.type === 'full-reload' && onFullReload) {
          onFullReload(worker, payload);
          return;
        }
        post(port1, payload);
      },
      close: () => port1.close(),
    };
    let connected = false;
    port1.on('message', payload => {
      if (payload?.type === 'cljf:connect') {
        if (connected) return;
        connected = true;
        channel.connect(client);
        post(port1, { type: 'connected' });
      } else if (connected) {
        channel.receive(payload, client);
      }
    });
    // the port mustn't keep the dev server's process alive
    port1.unref();
    const disconnect = () => {
      workers.delete(worker);
      if (!connected) return;
      connected = false;
      channel.disconnect(client);
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
