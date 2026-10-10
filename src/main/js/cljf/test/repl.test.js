// cljf repl: bencode, reading forms, and sessions with a fake nREPL server.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { Decoder, bencode, complete, repl } from '../repl.js';
import { tmpDir } from './helpers.js';

test('bencode', () => {
  assert.equal(bencode({ op: 'eval', code: '(+ 1 2)', id: 1 }).toString(), 'd4:code7:(+ 1 2)2:idi1e2:op4:evale');
  assert.equal(bencode(['a', 2, ['é']]).toString(), 'l1:ai2el2:éee');
});

test('Decoder decodes values split across chunks', () => {
  const bytes = Buffer.concat([bencode({ out: 'héllo', status: ['done'] }), bencode({ value: '3' })]);
  const decoder = new Decoder();
  const values = [];
  // one byte at a time, splitting é's bytes too
  for (let i = 0; i < bytes.length; i++) values.push(...decoder.push(bytes.subarray(i, i + 1)));
  assert.deepEqual(values, [{ out: 'héllo', status: ['done'] }, { value: '3' }]);
});

test('complete', () => {
  assert.ok(complete('(+ 1 2)'));
  assert.ok(complete(':k'));
  assert.ok(complete(''));
  assert.ok(!complete('(defn f [x]'));
  assert.ok(!complete('{:a [1'));
  assert.ok(!complete('"a'));
  assert.ok(complete('"a\nb"'));
  assert.ok(complete('(str "(" \\( #"[")'));
  assert.ok(complete('(+ 1 ; (\n 2)'));
  assert.ok(!complete('(+ 1 ; )'));
  // the reader reports it
  assert.ok(complete('(+ 1))'));
});

// An nREPL server answering eval with handler(code, msg): responses
async function fakeServer(handler) {
  const requests = [];
  const server = net.createServer(socket => {
    const decoder = new Decoder();
    socket.on('data', chunk => {
      for (const msg of decoder.push(chunk)) {
        requests.push(msg);
        const reply = r => socket.write(bencode({ id: msg.id, session: msg.session, ...r }));
        if (msg.op === 'clone') reply({ 'new-session': 's1', status: ['done'] });
        else if (msg.op === 'eval') {
          for (const r of handler(msg.code, msg)) reply(r);
          reply({ status: ['done'] });
        } else reply({ status: ['done'] });
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, requests, close: () => server.close() };
}

async function session(server, lines, opts = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const errorOutput = new PassThrough();
  let out = '';
  let err = '';
  output.on('data', d => (out += d));
  errorOutput.on('data', d => (err += d));
  const done = repl({ port: server.port, input, output, errorOutput, terminal: false, ...opts });
  for (const line of lines) input.write(`${line}\n`);
  input.end();
  return { code: await done, out, err };
}

test('repl evaluates forms in the session switched to ClojureScript', async () => {
  const server = await fakeServer(code => {
    if (code === '(cljf.esm.repl/repl)') return [{ out: '; ClojureScript REPL\n' }];
    if (code.startsWith('(in-ns')) return [{ value: 'nil', ns: 'my.app' }];
    if (code.startsWith('(println')) return [{ out: 'hi\n' }, { value: 'nil', ns: 'cljs.user' }];
    if (code.startsWith('(boom')) return [{ err: 'Error: boom\n' }, { ex: 'cljf.esm.repl/eval-error', status: ['eval-error'] }];
    return [{ value: `[${code.trim()}]`, ns: 'cljs.user' }];
  });
  try {
    const { code, out, err } = await session(server,
      ['(+ 1', '2)', '(println "hi")', '', '(in-ns (quote my.app))', '(boom)', ':cljs/quit', '(never)']);
    assert.equal(code, 0);
    assert.equal(out, '; ClojureScript REPL\n[(+ 1\n2)]\nhi\nnil\nnil\n');
    assert.equal(err, 'Error: boom\n');
    const evals = server.requests.filter(r => r.op === 'eval');
    assert.deepEqual(evals.map(r => r.code.trim()), ['(cljf.esm.repl/repl)', '(+ 1\n2)', '(println "hi")', '(in-ns (quote my.app))', '(boom)']);
    assert.ok(evals.slice(1).every(r => r.session === 's1'));
    // the namespace the last form left
    assert.equal(evals.at(-1).ns, 'my.app');
    assert.equal(server.requests.at(-1).op, 'close');
  } finally {
    server.close();
  }
});

test('repl fails when the server has no ClojureScript REPL', async () => {
  const server = await fakeServer(() => [{ err: 'Could not resolve var: cljf.esm.repl/repl\n' }, { ex: 'class clojure.lang.Compiler$CompilerException' }]);
  try {
    await assert.rejects(session(server, ['(+ 1 2)']), /has no ClojureScript REPL/);
  } finally {
    server.close();
  }
});

test('repl connects to the port in .nrepl-port', async () => {
  const server = await fakeServer(code => [{ value: code === '(+ 1 2)\n' ? '3' : 'nil' }]);
  const cwd = tmpDir();
  writeFileSync(path.join(cwd, '.nrepl-port'), `${server.port}\n`);
  try {
    const { out } = await session(server, ['(+ 1 2)'], { port: undefined, cwd });
    assert.equal(out, '3\n');
  } finally {
    server.close();
  }
});

// An nREPL server that answers clone, and closes the connection on the request
// for which closeOn(msg) is true
async function closingServer(closeOn) {
  const server = net.createServer(socket => {
    const decoder = new Decoder();
    socket.on('data', chunk => {
      for (const msg of decoder.push(chunk)) {
        if (closeOn(msg)) {
          socket.destroy();
          return;
        }
        const reply = r => socket.write(bencode({ id: msg.id, session: msg.session, ...r }));
        if (msg.op === 'clone') reply({ 'new-session': 's1', status: ['done'] });
        else reply({ status: ['done'] });
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, close: () => server.close() };
}

// session's result, or a rejection when it doesn't settle within ms
function within(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`didn't settle within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

test('repl fails when the server closes the connection before switching to ClojureScript', async () => {
  const server = await closingServer(msg => msg.op === 'clone');
  try {
    await assert.rejects(within(session(server, ['(+ 1 2)']), 5000), /the nREPL server closed the connection/);
  } finally {
    server.close();
  }
});

test('repl reports a connection the server closes during an evaluation', async () => {
  const server = await closingServer(msg => msg.op === 'eval' && msg.code === '(+ 1 2)\n');
  try {
    const { code, err } = await within(session(server, ['(+ 1 2)', '(never)']), 5000);
    assert.equal(code, 1);
    assert.match(err, /the nREPL server closed the connection/);
  } finally {
    server.close();
  }
});
