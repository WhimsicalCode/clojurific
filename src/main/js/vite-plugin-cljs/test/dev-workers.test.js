// Worker threads of the dev server's ssr environment (dev-workers.js,
// worker-runner.js), over a hot channel like Vite's server hot channel and a
// stand-in for Vite's module runner: the thread connects as a client of the
// channel, its modules see the user's workerData, it gets broadcasts but not
// the replies meant for other clients, and disconnects when it exits.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { devWorkers, entryModule } from '../dev-workers.js';

// Vite's createServerHotChannel, as far as dev-workers.js uses it
function hotChannel() {
  const innerEmitter = new EventEmitter();
  const outsideEmitter = new EventEmitter();
  return {
    name: 'ssr',
    hot: {
      send: payload => outsideEmitter.emit('send', payload),
      on: (event, fn) => innerEmitter.on(event, fn),
      api: { innerEmitter, outsideEmitter },
    },
  };
}

// vite/module-runner's ModuleRunner: connects the transport, imports the
// entry as a plain module, passes the channel's messages to it
const FAKE_RUNNER = `
export class ESModulesEvaluator {}
export class ModuleRunner {
  constructor({ transport }) {
    this.transport = transport;
    transport.connect({ onMessage: m => globalThis.__onMessage?.(m), onDisconnection() {} });
    globalThis.__send = p => transport.send(p);
  }
  import(entry) { return import(new URL('file://' + entry).href); }
}
`;

// the thread's module: reports its workerData, sends a custom event, and
// reports the messages it gets until told to stop. Its parentPort listener
// keeps the thread alive, as a plain Worker's would: the runner's port
// doesn't once the entry is loaded.
const ENTRY = `
import { parentPort, workerData } from 'node:worker_threads';
parentPort.on('message', () => {});
const seen = [];
globalThis.__onMessage = m => {
  if (m.type === 'connected') return;
  if (m.type === 'custom' && m.event === 'test:done') {
    parentPort.postMessage({ workerData, seen, title: globalThis.CLJF_REPL_TITLE });
    process.exit(0);
  }
  seen.push(m);
};
globalThis.__send({ type: 'custom', event: 'test:hello', data: { hi: 1 } });
`;

test('worker threads are clients of the ssr environment\'s hot channel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cljf-dev-workers-'));
  fs.writeFileSync(path.join(dir, 'runner.mjs'), FAKE_RUNNER);
  fs.writeFileSync(path.join(dir, 'entry.mjs'), ENTRY);
  const environment = hotChannel();
  const { innerEmitter } = environment.hot.api;
  const workers = devWorkers({
    environment,
    root: dir,
    resolve: entry => entryModule({ entries: {} }, dir, dir, entry),
    // the stand-in, not the Vite root resolves
    runnerUrl: pathToFileURL(path.join(dir, 'runner.mjs')).href,
  });
  const connected = new Promise(resolve => innerEmitter.once('vite:client:connect', (_, client) => resolve(client)));
  const hello = new Promise(resolve => innerEmitter.once('test:hello', (data, client) => resolve({ data, client })));
  const disconnected = new Promise(resolve => innerEmitter.once('vite:client:disconnect', (_, client) => resolve(client)));
  try {
    const worker = workers.spawn('entry.mjs', { workerData: { user: 1 }, name: 'test worker' });
    const client = await connected;
    const { data, client: from } = await hello;
    assert.deepEqual(data, { hi: 1 });
    assert.equal(from, client, 'its events come from its own client');
    const result = new Promise(resolve => worker.once('message', resolve));
    // a broadcast it gets, and replies of the in-process runner it doesn't
    environment.hot.send({ type: 'update', updates: [] });
    environment.hot.send({ type: 'custom', event: 'cljs:repl', data: { op: 'welcome', runtime: 99 } });
    environment.hot.send({ type: 'custom', event: 'vite:invoke', data: { id: 'response:x' } });
    // its own client's messages
    client.send({ type: 'custom', event: 'cljs:repl', data: { op: 'welcome', runtime: 1 } });
    client.send({ type: 'custom', event: 'test:done' });
    const { workerData, seen, title } = await result;
    assert.deepEqual(workerData, { user: 1 });
    assert.equal(title, 'test worker');
    assert.deepEqual(seen, [
      { type: 'update', updates: [] },
      { type: 'custom', event: 'cljs:repl', data: { op: 'welcome', runtime: 1 } },
    ]);
    assert.equal(await disconnected, client);
  } finally {
    await workers.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('entryModule: a :js-entries name, else a file under root', () => {
  const info = { entries: { server: 'cljs-esm-entries/server.js' } };
  assert.equal(entryModule(info, '/out', '/root', 'server'), path.join('/out', 'cljs-esm-entries/server.js'));
  assert.equal(entryModule(info, '/out', '/root', 'missing'), null);
  assert.equal(entryModule(info, '/out', path.dirname(import.meta.filename), path.basename(import.meta.filename)),
    import.meta.filename);
});
