// A worker thread's module runner (see worker.js and devWorkers in index.js):
// runs a module of the dev server's ssr environment in this thread, fetched
// and hot updated over a MessagePort to the dev server's process, which
// relays to the environment's hot channel as its own runner's transport does.
// Modules see the workerData given to createWorker, not this runner's.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import * as workerThreads from 'node:worker_threads';

// read before the user's workerData replaces it
const { port, runner: runnerUrl, entry, workerData, name } = workerThreads.workerData.__cljf;

// the user's workerData, for import { workerData } too
createRequire(import.meta.url)('node:worker_threads').workerData = workerData;
syncBuiltinESMExports();

const { ModuleRunner, ESModulesEvaluator, createNodeImportMeta } = await import(runnerUrl);

let inFlight = 0;
const transport = {
  connect({ onMessage, onDisconnection }) {
    port.on('message', msg => {
      // the replies of invocations (fetchModule): the port keeps the thread
      // alive only while modules are loading, see below
      if (msg.type === 'custom' && msg.event === 'vite:invoke' && String(msg.data?.id).startsWith('response')) {
        if (--inFlight === 0 && loaded) port.unref();
      }
      onMessage(msg);
    });
    port.on('close', onDisconnection);
    port.postMessage({ type: 'cljf:connect' });
  },
  disconnect() {
    port.close();
  },
  send(payload) {
    if (payload.type === 'custom' && payload.event === 'vite:invoke' && String(payload.data?.id).startsWith('send')) {
      if (inFlight++ === 0) port.ref();
    }
    port.postMessage(payload);
  },
};

// hot update failures are reported, the rest with CLJF_DEBUG_WORKER
const logger = {
  debug: (...args) => process.env.CLJF_DEBUG_WORKER && console.debug('[cljf worker]', ...args),
  error: (...args) => console.error('[cljf worker]', ...args),
};

const runner = new ModuleRunner({
  transport,
  hmr: { logger },
  // Vite 7+: import.meta.resolve, Vite 6 has the default
  ...(createNodeImportMeta ? { createImportMeta: createNodeImportMeta } : {}),
  sourcemapInterceptor: typeof process.setSourceMapsEnabled === 'function' ? 'node' : 'prepareStackTrace',
}, new ESModulesEvaluator());

// createWorker's name option names the thread in the REPL's runtimes
if (name) globalThis.CLJF_REPL_TITLE = name;

let loaded = false;
try {
  // an absolute file path, as the ssr environment's own runner imports entries
  await runner.import(entry);
} finally {
  loaded = true;
}
// The thread lives as long as the entry keeps it alive (servers, timers, its
// parentPort's listeners), not the runner's port, as a plain Worker would.
if (inFlight === 0) port.unref();
