// Worker threads of the dev server (dev-workers.js, worker-runner.js), over
// the plugin's hot channel and a stand-in for Vite's module runner: the
// thread connects as a client of the channel, its modules see the user's
// workerData, it gets broadcasts and its own client's messages, a full
// reload goes to onFullReload, and it disconnects when it exits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { devWorkers, entryModule, workerHotChannel } from '../dev-workers.js';

// vite/module-runner's ModuleRunner: connects the transport, imports the
// entry as a plain module, passes the channel's messages to it
const FAKE_RUNNER = `
export class ESModulesEvaluator {}
export class ModuleRunner {
  constructor({ transport }) {
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

const once = (channel, event) => new Promise(resolve => {
  const fn = (data, client) => {
    channel.off(event, fn);
    resolve({ data, client });
  };
  channel.on(event, fn);
});

test('worker threads are clients of the plugin\'s hot channel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cljf-dev-workers-'));
  fs.writeFileSync(path.join(dir, 'runner.mjs'), FAKE_RUNNER);
  fs.writeFileSync(path.join(dir, 'entry.mjs'), ENTRY);
  const channel = workerHotChannel();
  const workers = devWorkers({
    channel,
    root: dir,
    resolve: entry => entryModule({ entries: {} }, dir, dir, entry),
    // the stand-in, not the Vite root resolves
    runnerUrl: pathToFileURL(path.join(dir, 'runner.mjs')).href,
  });
  const connected = once(channel, 'vite:client:connect');
  const hello = once(channel, 'test:hello');
  const disconnected = once(channel, 'vite:client:disconnect');
  const fullReloads = [];
  try {
    const worker = workers.spawn('entry.mjs', {
      workerData: { user: 1 },
      name: 'test worker',
      onFullReload: (w, payload) => fullReloads.push([w, payload]),
    });
    const { client } = await connected;
    const { data, client: from } = await hello;
    assert.deepEqual(data, { hi: 1 });
    assert.equal(from, client, 'its events come from its own client');
    assert.equal(channel.clients, 1);
    const result = new Promise(resolve => worker.once('message', resolve));
    // a broadcast, a full reload, and its own client's messages
    channel.send({ type: 'update', updates: [] });
    channel.send({ type: 'full-reload', triggeredBy: '/src/main.ts' });
    client.send({ type: 'custom', event: 'cljs:repl', data: { op: 'welcome', runtime: 1 } });
    client.send({ type: 'custom', event: 'test:done' });
    const { workerData, seen, title } = await result;
    assert.deepEqual(workerData, { user: 1 });
    assert.equal(title, 'test worker');
    assert.deepEqual(seen, [
      { type: 'update', updates: [] },
      { type: 'custom', event: 'cljs:repl', data: { op: 'welcome', runtime: 1 } },
    ]);
    assert.deepEqual(fullReloads, [[worker, { type: 'full-reload', triggeredBy: '/src/main.ts' }]]);
    assert.equal((await disconnected).client, client);
    assert.equal(channel.clients, 0);
  } finally {
    await workers.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the channel passes a client\'s custom events to the listeners, with the client', () => {
  const channel = workerHotChannel();
  const got = [];
  const fn = (data, client) => got.push([data, client]);
  channel.on('x', fn);
  const client = { send() {} };
  channel.receive({ type: 'custom', event: 'x', data: 1 }, client);
  channel.receive({ type: 'update', updates: [] }, client);
  channel.off('x', fn);
  channel.receive({ type: 'custom', event: 'x', data: 2 }, client);
  assert.deepEqual(got, [[1, client]]);
});

test('entryModule: a :js-entries name, else a file under root', () => {
  const info = { entries: { server: 'cljs-esm-entries/server.js' } };
  assert.equal(entryModule(info, '/out', '/root', 'server'), path.join('/out', 'cljs-esm-entries/server.js'));
  assert.equal(entryModule(info, '/out', '/root', 'missing'), null);
  assert.equal(entryModule(info, '/out', path.dirname(import.meta.filename), path.basename(import.meta.filename)),
    import.meta.filename);
});
