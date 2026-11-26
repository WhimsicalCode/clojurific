// The dev server running a Cloudflare Worker in workerd (@cloudflare/vite-plugin),
// run by script/test-launcher in a project of create-clojurific's cloudflare
// template (its node_modules and deps.edn):
// - after a failed first compile, the dev server waits for the fix instead of
//   exiting (workerd imports the Worker's main as Vite starts), then serves it
// - the Worker is a REPL runtime: forms evaluate in it as modules (workerd
//   disallows new Function), and an error's location maps to the form
// - a changed namespace hot reloads in place, the Durable Object's state stays
// node cloudflare-dev-server.mjs, in the project's directory.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [coreFile] = fs.readdirSync('src', { recursive: true })
  .filter(f => f.endsWith(`${path.sep}core.cljs`)).map(f => path.join('src', f));
const source = fs.readFileSync(coreFile, 'utf8');
const ns = source.match(/\(ns\s+([^\s()]+)/)[1];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The processes' groups: npx, Vite, the compiler and workerd
const groups = new Set();
const killGroup = pid => {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {}
  groups.delete(pid);
};
process.on('exit', () => {
  groups.forEach(killGroup);
  fs.writeFileSync(coreFile, source);
});
setTimeout(() => {
  console.error('cloudflare dev server: timed out after 5 minutes');
  process.exit(1);
}, 5 * 60 * 1000).unref();

async function until(what, f, timeout = 120000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await f().catch(() => undefined);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(250);
  }
}

// A client of `npx cljf mcp`, the bridge to the dev server's MCP server
function mcpClient() {
  const proc = spawn('npx', ['--no', 'cljf', 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'], detached: true });
  groups.add(proc.pid);
  let buffer = '';
  let id = 0;
  const waiting = new Map();
  proc.stdout.on('data', chunk => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, msg => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
  });
  const call = (name, args = {}) => request('tools/call', { name, arguments: args });
  return { request, call };
}

let log = '';
const fail = message => {
  throw new Error(`${message}\n--- vite's output:\n${log}`);
};

try {
  // a first compile failing: the source doesn't read
  fs.writeFileSync(coreFile, `${source}\n(defn broken [`);
  // 127.0.0.1: on Linux, localhost can resolve to ::1 for Vite and to
  // 127.0.0.1 for fetch
  const proc = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '0', '--clearScreen', 'false'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
    detached: true,
  });
  groups.add(proc.pid);
  proc.stdout.on('data', chunk => (log += chunk));
  proc.stderr.on('data', chunk => (log += chunk));
  let exited = false;
  proc.on('exit', () => (exited = true));

  await until('the failed first compile', async () => /Unexpected EOF/.test(log));
  await sleep(3000);
  if (exited) fail('the dev server exited after a failed first compile');
  if (/Local:/.test(log)) fail('the dev server listened before a compile succeeded');

  fs.writeFileSync(coreFile, source);
  const url = await until('the dev server\'s URL, once the fix compiled', async () => log.match(/Local:\s+(http:\/\/\S+?)\/?\s/)?.[1]);
  const get = async (p = '/', init) => (await fetch(url + p, { ...init, signal: AbortSignal.timeout(10000) })).text();
  if (!(await get()).includes('Hello Cloudflare Workers!')) fail(`GET /: ${await get()}`);
  const clicks = async () => JSON.parse(await get('/clicks', { method: 'POST' })).clicks;
  const before = await clicks();

  const mcp = mcpClient();
  await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const worker = (await until('the Worker among the REPL runtimes', async () =>
    (await mcp.call('runtimes')).structuredContent?.runtimes?.find(rt => rt.user_agent === 'Cloudflare-Workers')));
  // referring to the app's namespace
  const evaluated = await mcp.call('eval', { runtime_id: worker.runtime_id, ns, code: '[(+ 1 2) (fn? (.-fetch app))]' });
  if (evaluated.structuredContent?.results?.[0] !== '[3 true]') fail(`eval in the Worker: ${JSON.stringify(evaluated)}`);
  // an error on the form's second line, located there
  const thrown = await mcp.call('eval', { runtime_id: worker.runtime_id, ns, code: '(let [x 1]\n  (throw (js/Error. (str "boom" x))))' });
  if (thrown.structuredContent?.error !== 'boom1' || !/<cljs repl>:2:\d+/.test(thrown.structuredContent?.stack ?? '')) {
    fail(`an error evaluated in the Worker: ${JSON.stringify(thrown)}`);
  }

  fs.writeFileSync(coreFile, source.replace('Hello Cloudflare Workers!', 'Hello again!'));
  await until('the edit hot reloaded', async () => (await get()).includes('Hello again!'));
  // the Durable Object kept its count
  if ((await clicks()) !== before + 1) fail('the Durable Object\'s count after the hot reload');
  console.log('cloudflare dev server: ok');
} finally {
  groups.forEach(killGroup);
}
