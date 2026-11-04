// The REPL messages a runtime's connection may send (cljf.esm.repl-runtime's
// hello, focus, result and console-eval): a page, or a script on it, can't
// send the plugin's own (dev-server, vite-error, vite-update, bye), which
// tell the REPL, and agents through its MCP server, of the dev server and
// its errors.
const RUNTIME_OPS = new Set(['hello', 'focus', 'result', 'console-eval']);

/** Whether data is a message a runtime may send. */
export function runtimeMessage(data) {
  return data !== null && typeof data === 'object' && RUNTIME_OPS.has(data.op);
}
