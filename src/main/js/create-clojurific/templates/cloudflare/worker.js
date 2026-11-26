// The Worker (wrangler.jsonc's main): the module the compiler writes for
// vite.config.ts' :js-entries, the Hono app and the Durable Object class
export { default, Counter } from './target/cljs/cljs-esm-entries/worker.js';
