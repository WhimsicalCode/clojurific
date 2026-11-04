
## Coding agents

The dev server runs an MCP server for coding agents (`mcpPort` in `vite.config.ts`), which gives
them the REPL: they evaluate ClojureScript in the {{runtimes}} running the app, see their edits
compiled and hot reloaded (or the compiler's error or warnings), and read its console log.

1. Start the dev server, `npm run dev`{{openPageStep}}.
2. Start the agent in this directory. Claude Code reads `.mcp.json`, which runs `npx --no cljf mcp`
   (approve the `clojurific` server when it asks). Other clients take the same command:
   - Codex, in `~/.codex/config.toml`:
     ```toml
     [mcp_servers.clojurific]
     command = "npx"
     args = ["--no", "cljf", "mcp"]
     ```
   - Cursor, `.cursor/mcp.json`: the `mcpServers` of `.mcp.json`. VS Code, `.vscode/mcp.json`:
     the same under `servers`.

`npx --no cljf mcp` (`--no`: only the project's own `cljf`, which `npm install` installs, never a
package of that name from the registry) finds the dev server through `.cljf/mcp-port`, and survives its restarts: an agent
started first still sees the tools, which ask for `npm run dev`. The agent learns which
{{runtimeNoun}} are connected when its session starts. `AGENTS.md` tells it how to use the tools.

The server only accepts this machine's clients. To leave it out, remove `mcpPort` from
`vite.config.ts`.
