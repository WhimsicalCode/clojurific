import { defineConfig } from 'vite';
import cljf from 'clojurific/vite';

export default defineConfig(({ command }) => ({
  plugins: [
    cljf({
      outputDir: 'target/cljs',
      compilerOptions: {
        // the dev server starts an nREPL server, its port in .nrepl-port, with
        // cider-nrepl's middleware: completion and lookup; and an MCP server
        // for coding agents, its port in .cljf/mcp-port (npx cljf mcp, see
        // .mcp.json and AGENTS.md)
        repl: { nreplPort: 0, mcpPort: 0, middleware: ["'cider.nrepl/cider-middleware"] },
        // cljs-devtools' console formatters, in the dev server's pages only
        ...(command === 'serve' && {
          preloads: ["'devtools.preload"],
          // cljs-devtools takes the missing js/devtools global of ES modules
          // for an advanced build and wouldn't install
          externalConfig: { 'devtools/config': { disableAdvancedModeCheck: true } },
        }),
      },
    }),
  ],
}));
