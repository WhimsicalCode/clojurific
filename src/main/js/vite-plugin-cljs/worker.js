// Worker threads running a build's :js-entries (clojurific/worker):
//
//   import { createWorker } from 'clojurific/worker';
//   const worker = createWorker('render', { workerData: { ... } });
//
// Under the Vite dev server (the plugin's workers option, on with ssrEntries)
// the thread runs the entry through a Vite module runner of the dev server's
// cljf_worker environment (worker-runner.js, dev-workers.js): it hot reloads
// changed namespaces in place, keeping defonce, and the REPL evaluates in it.
// The plugin's configureServer provides that (globalThis.__CLJF_DEV_WORKERS__).
// Elsewhere, i.e. a production bundle, it's a plain Worker of the entry's
// bundled module, ./<entry>.js next to the bundle (the default entryFileNames
// of an ssr build), unless options.url names it.
import { Worker } from 'node:worker_threads';

/**
 * A worker thread running :js-entries entry (its name), or a module the dev
 * server can transform (a path relative to Vite's root, i.e. TypeScript). The
 * Worker's options, workerData included, apply as for new Worker; url is the
 * module of a production bundle, default new URL(`./${entry}.js`,
 * import.meta.url). Under the dev server, onFullReload(worker, payload) is
 * called for a change the thread can't hot update (no module accepts it,
 * i.e. its TypeScript), instead of re-running its entry in place, i.e. to
 * replace the thread.
 * @param {string} entry
 * @param {import('node:worker_threads').WorkerOptions & { url?: string | URL, onFullReload?: (worker: Worker, payload: object) => void }} [options]
 * @returns {Worker}
 */
export function createWorker(entry, options = {}) {
  const dev = globalThis.__CLJF_DEV_WORKERS__;
  const { url, onFullReload, ...workerOptions } = options;
  if (dev) return dev.spawn(entry, { ...workerOptions, onFullReload });
  // not new URL(`./${entry}.js`, import.meta.url), which bundlers take for
  // an asset glob
  const base = import.meta.url;
  return new Worker(url ?? new URL('./' + entry + '.js', base), workerOptions);
}
