import { defineConfig } from 'vite';
import cljf from 'clojurific/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [
    cljf({
      outputDir: 'target/cljs',
      compilerOptions: {
        // the Worker's module, which worker.js re-exports: the app (its fetch
        // handler) and the Durable Object class wrangler.jsonc binds
        jsEntries: { worker: { exports: { default: "'{{ns}}/app", Counter: "'{{ns}}/Counter" } } },
        // #x literals are elements of Hono's JSX
        jsxImportSource: 'hono/jsx',
        // the dev server starts an nREPL server, its port in .nrepl-port, with
        // cider-nrepl's middleware: completion and lookup; and an MCP server
        // for coding agents, its port in .cljf/mcp-port (npx --no cljf mcp, see
        // .mcp.json and AGENTS.md)
        repl: { nreplPort: 0, mcpPort: 0, middleware: ["'cider.nrepl/cider-middleware"] },
      },
      // no pages, no manifest of their scripts
      manifest: false,
      // the Cloudflare plugin bundles the Worker from its main, worker.js
      entries: [],
    }),
    // runs the Worker in workerd (the Workers runtime), under vite as under
    // vite preview, and bundles it for wrangler deploy into dist/worker. The
    // environment's name is the Worker's otherwise, and Vite's own names
    // (client, ssr) aren't allowed.
    cloudflare({ viteEnvironment: { name: 'worker' } }),
  ],
});
