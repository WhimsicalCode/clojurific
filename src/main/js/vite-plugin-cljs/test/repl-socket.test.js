// The REPL socket of bundles: runtimes' JSON lines go to their connection's
// receive, replies to the socket, closing it closes the connection
import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { listenReplSocket } from '../repl-socket.js';

const once = (emitter, event) => new Promise(resolve => emitter.once(event, resolve));

test('relays JSON lines between runtimes and their connections', async () => {
  const received = [];
  let closed = 0;
  let send, peer;
  const socket = await listenReplSocket({
    connect: (s, remoteAddress) => {
      send = s;
      peer = remoteAddress;
      return { receive: msg => received.push(msg), close: () => closed++ };
    },
  });
  try {
    assert.equal(socket.host, '127.0.0.1');
    assert.ok(socket.port > 0);
    const client = net.createConnection({ host: socket.host, port: socket.port });
    client.setEncoding('utf8');
    await once(client, 'connect');
    // a message split across writes, a blank line and one that isn't JSON
    client.write('{"op":"hel');
    client.write('lo"}\n\nnot json\n{"op":"result","id":1}\n');
    for (let i = 0; i < 100 && received.length < 2; i++) await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(received, [{ op: 'hello' }, { op: 'result', id: 1 }]);
    // the peer's address, which decides whether it may cljs_eval
    assert.match(peer, /^(127\.|::ffff:127\.|::1$)/);
    const reply = once(client, 'data');
    send({ op: 'welcome', runtime: 1 });
    assert.equal(await reply, '{"op":"welcome","runtime":1}\n');
    client.end();
    for (let i = 0; i < 100 && !closed; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(closed, 1);
  } finally {
    socket.close();
  }
});
