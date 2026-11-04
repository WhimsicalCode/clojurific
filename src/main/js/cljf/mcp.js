// cljf mcp: an MCP server on stdio for coding agents, bridging to the MCP
// server of the dev server's (or cljf watch's) REPL (:repl {:mcp-port 0},
// see cljf.esm.mcp), whose port is in .cljf/mcp-port. It lists the tools
// (mcp-tools.json, cljf.esm.mcp/tools' copy) before the dev server is up,
// and finds the server again for every request, so it survives the dev
// server's restarts. Messages are JSON-RPC, one per line; logs go to stderr.
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The tools' definitions, as the REPL's MCP server lists them. */
export const tools = JSON.parse(readFileSync(path.join(here, 'mcp-tools.json'), 'utf8'));

const version = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;

const NOT_RUNNING =
  "The dev server isn't running: start it (npm run dev, or cljf watch) with the REPL's MCP server, " +
  ":repl {:mcp-port 0} (compilerOptions: { repl: { mcpPort: 0 } } in the Vite plugin's options)";

/** The port of the REPL's MCP server: port, or the one in cwd's .cljf/mcp-port. */
export async function serverPort({ cwd = process.cwd(), port } = {}) {
  if (port) return port;
  const file = path.join(cwd, '.cljf', 'mcp-port');
  if (!existsSync(file)) return null;
  const p = Number((await fs.readFile(file, 'utf8')).trim());
  return Number.isInteger(p) && p > 0 ? p : null;
}

/** An error of a request to a server that isn't there (not listening). */
export class NotRunning extends Error {}

/**
 * Posts JSON-RPC message msg to the MCP server on port, resolves to its
 * response (null for a notification). Without a timeout: tools wait as long
 * as they're asked to (an eval's timeout_ms), which fetch's 300s headers
 * timeout would cut short. Rejects with NotRunning when nothing listens.
 */
export function post(port, msg, { host = '127.0.0.1' } = {}) {
  const body = JSON.stringify(msg);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host,
      port,
      path: '/mcp',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'content-length': Buffer.byteLength(body),
      },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (text += chunk));
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode === 202) return resolve(null);
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error(`HTTP ${res.statusCode}${text ? `: ${text.slice(0, 200)}` : ''}`));
        }
      });
    });
    // refused: nothing listens on the port (the dev server stopped, its
    // port file left behind by a crash)
    req.on('error', e => reject(e.code === 'ECONNREFUSED' ? new NotRunning(e.message) : e));
    req.end(body);
  });
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * The bridge: reads JSON-RPC messages from input, writes the responses to
 * output. initialize waits up to waitMs for the server (an agent starting
 * with the dev server), then answers itself, saying how to start it.
 * Resolves when input ends.
 */
export async function bridge({
  input = process.stdin,
  output = process.stdout,
  cwd = process.cwd(),
  port,
  host = '127.0.0.1',
  log = line => process.stderr.write(`${line}\n`),
  waitMs = 1000,
} = {}) {
  const write = msg => output.write(`${JSON.stringify(msg)}\n`);
  // the server's response to msg, null without a server. A response
  // without the request's id (the server's errors of a request it couldn't
  // read) answers the request.
  const forward = async msg => {
    const p = await serverPort({ cwd, port });
    if (!p) return null;
    try {
      const response = await post(p, msg, { host });
      if (response && msg.id !== undefined && (response.id === null || response.id === undefined)) {
        response.id = msg.id;
      }
      return { response };
    } catch (e) {
      if (e instanceof NotRunning) {
        if (port) log(`cljf mcp: no MCP server on ${host}:${port}: ${e.message}`);
        return null;
      }
      // the server is there: its request failed otherwise (a dropped
      // connection, a response that isn't JSON)
      if (msg.id === undefined) return { response: null };
      return { response: { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: `cljf mcp: ${e.message}` } } };
    }
  };
  const result = (id, result) => ({ jsonrpc: '2.0', id, result });
  const handle = async msg => {
    const { id, method } = msg;
    const request = id !== undefined;
    switch (method) {
      case 'initialize': {
        for (let waited = 0; ; waited += 100) {
          const r = await forward(msg);
          if (r) return r.response;
          if (waited >= waitMs) break;
          await sleep(100);
        }
        const requested = msg.params?.protocolVersion;
        return result(id, {
          protocolVersion: typeof requested === 'string' ? requested : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'clojurific', title: 'Clojurific REPL', version },
          instructions: `Clojurific's ClojureScript REPL into the pages and servers running the build of ${path.basename(cwd)}. ${NOT_RUNNING}, then call build_status or runtimes. Every tool of a runtime (eval, load_file, wait_for_reload, console_logs, tag_runtime) takes its runtime_id, an id or a tag. After editing source files, call wait_for_reload with them to see the edit compiled and hot reloaded.`,
        });
      }
      case 'ping':
        return request ? result(id, {}) : null;
      case 'tools/list': {
        const r = await forward(msg);
        return r?.response ?? result(id, { tools });
      }
      default: {
        const r = await forward(msg);
        if (r) return r.response;
        if (!request) return null;
        if (method === 'tools/call') {
          return result(id, {
            content: [{ type: 'text', text: `${NOT_RUNNING}.` }],
            structuredContent: { error: NOT_RUNNING },
            isError: true,
          });
        }
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
      }
    }
  };
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();
  for await (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    // requests run concurrently (an eval waiting for a promise doesn't hold
    // up a ping), each answered when it's done
    const messages = Array.isArray(msg) ? msg : [msg];
    for (const m of messages) {
      // a JSON value that isn't a message (null, a number)
      if (m === null || typeof m !== 'object' || Array.isArray(m)) {
        write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
        continue;
      }
      const p = handle(m)
        .then(response => response && write(response))
        .catch(e => {
          if (m.id !== undefined) write({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: String(e?.message ?? e) } });
        })
        .finally(() => pending.delete(p));
      pending.add(p);
    }
  }
  await Promise.all(pending);
}
