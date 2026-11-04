// cljf mcp: the stdio bridge, with a fake MCP server of the REPL.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { absolutePaths, bridge, tools } from '../mcp.js';
import { tmpDir } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// A bridge reading the messages written to input; responses() resolves to
// the responses once input ended
function start(opts) {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', chunk => (text += chunk));
  const done = bridge({ input, output, log: () => {}, waitMs: 0, ...opts });
  return {
    send: msg => input.write(`${JSON.stringify(msg)}\n`),
    responses: async () => {
      input.end();
      await done;
      return text.split('\n').filter(Boolean).map(line => JSON.parse(line)).sort((a, b) => a.id - b.id);
    },
  };
}

test('the tools are cljf.esm.mcp/tools', () => {
  const source = readFileSync(path.join(here, '../../../clojure/cljf/esm/mcp.clj'), 'utf8');
  for (const { name } of tools) assert.ok(source.includes(`{:name        "${name}"`), name);
  assert.equal((source.match(/\{:name {8}"/g) ?? []).length, tools.length);
  for (const tool of tools) {
    if (tool.name !== 'runtimes' && tool.name !== 'build_status' && Object.keys(tool.inputSchema.properties).includes('runtime_id')) {
      assert.ok(tool.inputSchema.required.includes('runtime_id'), tool.name);
    }
  }
});

test('without the dev server, it lists the tools and says how to start it', async () => {
  const cwd = tmpDir();
  const b = start({ cwd });
  b.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {} } });
  b.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  b.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  b.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'runtimes', arguments: {} } });
  b.send({ jsonrpc: '2.0', id: 4, method: 'ping' });
  const [init, list, call, ping] = await b.responses();
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.match(init.result.instructions, /isn't running/);
  assert.deepEqual(list.result.tools, tools);
  assert.equal(call.result.isError, true);
  assert.match(call.result.content[0].text, /mcp-port 0/);
  assert.deepEqual(ping.result, {});
});

test('forwards to the server in .cljf/mcp-port, with its token', async () => {
  const cwd = tmpDir();
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const msg = JSON.parse(body);
      received.push(msg);
      if (req.headers.authorization !== 'Bearer s3cret') {
        res.writeHead(403).end();
        return;
      }
      if (msg.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { echo: msg.method } }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  mkdirSync(path.join(cwd, '.cljf'));
  writeFileSync(path.join(cwd, '.cljf', 'mcp-port'), `${server.address().port}\ns3cret\n`);
  try {
    const b = start({ cwd });
    b.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    b.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    b.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'eval', arguments: { code: '1', runtime_id: 1 } } });
    const responses = await b.responses();
    assert.deepEqual(responses.map(r => r.result.echo), ['initialize', 'tools/call']);
    assert.deepEqual(received.map(m => m.method).sort(), ['initialize', 'notifications/initialized', 'tools/call']);
  } finally {
    server.close();
  }
});

test('a long tool call waits past fetch\'s headers timeout, other failures are errors', async () => {
  const cwd = tmpDir();
  let delay = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const msg = JSON.parse(body);
      if (msg.params?.name === 'broken') {
        // the server's errors of requests it couldn't read have no id
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'boom' } }));
      } else if (msg.params?.name === 'dropped') {
        req.socket.destroy();
      } else {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { done: true } }));
        }, delay);
      }
    });
  });
  // a headers timeout shorter than the call, as fetch's 300s is for a long eval
  server.headersTimeout = 0;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  mkdirSync(path.join(cwd, '.cljf'));
  writeFileSync(path.join(cwd, '.cljf', 'mcp-port'), String(server.address().port));
  try {
    delay = 300;
    const b = start({ cwd });
    b.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'eval', arguments: {} } });
    b.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'broken', arguments: {} } });
    b.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dropped', arguments: {} } });
    const [slow, broken, dropped] = await b.responses();
    assert.deepEqual(slow.result, { done: true });
    assert.equal(broken.id, 2);
    assert.equal(broken.error.message, 'boom');
    assert.equal(dropped.id, 3);
    assert.match(dropped.error.message, /^cljf mcp: /);
    assert.doesNotMatch(dropped.error.message, /isn't running/);
  } finally {
    server.close();
  }
});

test('messages that aren\'t objects are invalid requests, the bridge keeps answering', async () => {
  const b = start({ cwd: tmpDir() });
  for (const line of ['null', '42', '[null]', '"x"']) b.send(JSON.parse(line));
  b.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
  const responses = await b.responses();
  assert.equal(responses.filter(r => r.error?.code === -32600).length, 4);
  assert.deepEqual(responses.find(r => r.id === 1).result, {});
});

test('paths relative to the agent\'s directory are passed absolute, others as they are', () => {
  const dir = tmpDir();
  mkdirSync(path.join(dir, 'app', 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'app', 'src', 'a.cljs'), '');
  const call = args => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x', arguments: args } });
  assert.deepEqual(absolutePaths(call({ files: ['app/src/a.cljs', 'src/a.cljs'], runtime_id: 1 }), dir).params.arguments,
    { files: [path.join(dir, 'app', 'src', 'a.cljs'), 'src/a.cljs'], runtime_id: 1 });
  assert.equal(absolutePaths(call({ path: 'app/src/a.cljs' }), dir).params.arguments.path, path.join(dir, 'app', 'src', 'a.cljs'));
  assert.equal(absolutePaths(call({ path: '/abs.cljs' }), dir).params.arguments.path, '/abs.cljs');
  const ping = { jsonrpc: '2.0', id: 2, method: 'ping' };
  assert.equal(absolutePaths(ping, dir), ping);
});

test('--dir: the port file of another directory', async () => {
  const root = tmpDir();
  const project = path.join(root, 'app');
  mkdirSync(path.join(project, '.cljf'), { recursive: true });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const msg = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { from: 'app' } }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  writeFileSync(path.join(project, '.cljf', 'mcp-port'), String(server.address().port));
  try {
    const b = start({ cwd: project });
    b.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const [list] = await b.responses();
    assert.deepEqual(list.result, { from: 'app' });
  } finally {
    server.close();
  }
});
