// Types of clojurific/worker, see worker.js and README.md's Worker threads.
import type { Worker, WorkerOptions } from 'node:worker_threads';

/**
 * A worker thread running `:js-entries` entry (its name), or a module the dev server transforms (a path relative to
 * Vite's root). Under the dev server it runs through a module runner of the dev server's `cljf_worker` environment:
 * hot reloaded, and a runtime of the REPL (`name` titles it). Elsewhere it's a plain Worker of `url`, default
 * `./<entry>.js` next to the bundle.
 */
export function createWorker(
  entry: string,
  options?: WorkerOptions & {
    /** The entry's module in a bundle, default `./<entry>.js` next to it. */
    url?: string | URL;
    /** Under the dev server, a change the thread can't hot update (i.e. its TypeScript): replace the thread. */
    onFullReload?: (worker: Worker, payload: { type: 'full-reload'; triggeredBy?: string; path?: string }) => void;
  },
): Worker;
