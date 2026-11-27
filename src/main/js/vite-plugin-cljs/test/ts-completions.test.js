// The TypeScript completions of the REPL (ts-completions.js), over projects
// in temporary directories whose node_modules is the one with TypeScript 5
// or 6: this repository's, or CLJF_TEST_NODE_MODULES's (i.e. a scratch
// project's, with @types/node). Skipped without one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { tsCompletions, tsCompletionsWorker } from '../ts-completions.js';

const nodeModules = (() => {
  if (process.env.CLJF_TEST_NODE_MODULES) return path.resolve(process.env.CLJF_TEST_NODE_MODULES);
  try {
    const pkg = createRequire(import.meta.url).resolve('typescript/package.json');
    return path.dirname(path.dirname(pkg));
  } catch {
    return null;
  }
})();
const skip = nodeModules ? false : 'no typescript (set CLJF_TEST_NODE_MODULES)';

// a project of files {relative path: content}, with TypeScript
function project(files, withTypeScript = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cljf-ts-'));
  if (withTypeScript) fs.symlinkSync(nodeModules, path.join(root, 'node_modules'), 'dir');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

const names = r => r.entries.map(e => e.name);
// the worker doesn't keep the process alive: a test waiting for it does
const keepAlive = () => {
  const t = setInterval(() => {}, 1000);
  return () => clearInterval(t);
};
const at = (code, prefix, details) => ({ code, position: code.length, prefix, details });

test('members of typed values, values only, with the details asked for', { skip }, () => {
  const complete = tsCompletions({ root: project({ 'src/mod.ts': 'export interface Shape { a: number }\nexport const value = 1;\n' }) });
  const r = complete(at('document.getE', 'getE', 1));
  assert.ok(names(r).includes('getElementById'));
  assert.ok(names(r).every(n => n.startsWith('getE')));
  assert.deepEqual(names(r), [...names(r)].sort());
  assert.equal(r.entries.find(e => e.name === 'getElementById').type, 'function');
  assert.match(r.entries[0].signature, /Document\.getElement/);
  assert.equal(r.entries[1].signature, undefined);
  // the snippet's import isn't a candidate, nor are the module's types
  const m = complete(at('import * as __cljf_m0 from "./src/mod.ts";\n__cljf_m0.', '', 0));
  assert.deepEqual(names(m), ['value']);
  assert.ok(!names(complete(at('import * as __cljf_m0 from "./src/mod.ts";\n__cljf', '', 0))).some(n => n.startsWith('__cljf')));
  // any: nothing, the runtime completes it
  assert.deepEqual(names(complete(at('(undefined as any).fo', 'fo'))), []);
});

test('edits of imported files', { skip }, () => {
  const root = project({ 'src/mod.ts': 'export const beforeEdit = 1;\n' });
  const complete = tsCompletions({ root });
  const code = at('import * as __cljf_m0 from "./src/mod.ts";\n__cljf_m0.', '');
  assert.deepEqual(names(complete(code)), ['beforeEdit']);
  const file = path.join(root, 'src/mod.ts');
  fs.writeFileSync(file, 'export const afterEdit = 1;\n');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  assert.deepEqual(names(complete(code)), ['afterEdit']);
});

test("a solution-style tsconfig's first reference, with its declaration files", { skip }, () => {
  const root = project({
    'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }] }),
    'tsconfig.app.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', types: [] }, include: ['src'] }),
    'tsconfig.node.json': JSON.stringify({ compilerOptions: { types: [] }, include: ['vite.config.ts'] }),
    'src/env.d.ts': 'declare const appGlobal: { answer: number };\n',
  });
  assert.deepEqual(names(tsCompletions({ root })(at('appGlobal.ans', 'ans'))), ['answer']);
});

test("a tsconfig.json above the root isn't the project's", { skip }, () => {
  const root = project({
    'tsconfig.json': JSON.stringify({ compilerOptions: { lib: ['es2022'], types: [] } }),
    'app/package.json': '{}',
  });
  fs.symlinkSync(nodeModules, path.join(root, 'app', 'node_modules'), 'dir');
  assert.ok(names(tsCompletions({ root: path.join(root, 'app') })(at('document.getE', 'getE'))).includes('getElementById'));
});

test("a workspace's hoisted @types", { skip: skip || (!fs.existsSync(path.join(nodeModules ?? '', '@types', 'node')) && 'no @types/node') }, () => {
  const root = project({ 'app/package.json': '{}' });
  assert.deepEqual(names(tsCompletions({ root: path.join(root, 'app') })(at('process.ver', 'ver'))), ['version', 'versions']);
});

test('an error without TypeScript', () => {
  const r = tsCompletions({ root: project({}, false) })(at('document.getE', 'getE'));
  assert.match(r.error, /TypeScript/);
});

test('the worker thread: answers by id, skips requests past their deadline once started', { skip }, async () => {
  const release = keepAlive();
  const replies = [];
  let replied;
  const root = project({});
  const worker = tsCompletionsWorker({ root, onReply: r => { replies.push(r); replied?.(); }});
  const next = () => new Promise(resolve => (replied = resolve));
  try {
    // the warm-up, past its deadline, still starts the service and answers
    let got = next();
    worker.request({ id: 1, ...at('', ''), deadline: Date.now() - 1 });
    await got;
    worker.request({ id: 2, ...at('document.getE', 'getE'), deadline: Date.now() - 1 });
    got = next();
    worker.request({ id: 3, ...at('document.getE', 'getE'), deadline: Date.now() + 10000 });
    await got;
    assert.deepEqual(replies.map(r => r.id), [1, 3]);
    assert.ok(replies[1].entries.some(e => e.name === 'getElementById'));
  } finally {
    await worker.close();
    release();
  }
});

test('the worker thread without TypeScript answers with the error', async () => {
  const release = keepAlive();
  const worker = tsCompletionsWorker({ root: project({}, false), onReply: r => resolve(r)});
  let resolve;
  const reply = new Promise(r => (resolve = r));
  worker.request({ id: 7, ...at('document.getE', 'getE') });
  try {
    const r = await reply;
    assert.equal(r.id, 7);
    assert.match(r.error, /TypeScript/);
  } finally {
    await worker.close();
    release();
  }
});

test("the worker thread doesn't keep the process alive once it answered", () => {
  const module = new URL('../ts-completions.js', import.meta.url).href;
  const root = project({}, false);
  const script = `import { tsCompletionsWorker } from ${JSON.stringify(module)};
    const keepAlive = setTimeout(() => {}, 60000);
    tsCompletionsWorker({ root: ${JSON.stringify(root)}, onReply: r => { console.log(r.id); clearTimeout(keepAlive); } })
      .request({ id: 5, code: '', position: 0 });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(r.signal, null, 'exited by itself');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '5');
});

test("a worker that exits: its requests and the next ones answered with an error, none after close", async () => {
  const release = keepAlive();
  const replies = [];
  let replied;
  const next = () => new Promise(resolve => (replied = resolve));
  // a worker exiting once it gets a request
  const workerURL = new URL(`data:text/javascript,${encodeURIComponent(
    "import { parentPort } from 'node:worker_threads'; parentPort.on('message', () => process.exit(3));")}`);
  const worker = tsCompletionsWorker({ root: project({}, false), workerURL, onReply: r => { replies.push(r); replied?.(); } });
  try {
    let got = next();
    worker.request({ id: 1, code: '', position: 0 });
    await got;
    assert.equal(replies[0].id, 1);
    assert.match(replies[0].error, /exited: code 3/);
    // not started again right away: answered at once
    worker.request({ id: 2, code: '', position: 0 });
    assert.deepEqual(replies.map(r => r.id), [1, 2]);
    assert.match(replies[1].error, /exited/);
    await worker.close();
    worker.request({ id: 3, code: '', position: 0 });
    assert.equal(replies.length, 2);
  } finally {
    await worker.close();
    release();
  }
});
