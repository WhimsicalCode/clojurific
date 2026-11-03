// The REPL socket of bundles (vite build --watch with the replSocket option):
// a bundle has no import.meta.hot, its runtimes (every Node.js thread running
// it, see cljf.esm.repl-runtime/connect-socket!) connect to this TCP server
// instead of Vite's websocket. Messages are JSON lines, relayed to the
// compiler like the dev server's.
import net from 'node:net';

/**
 * Listens for the REPL's runtimes on host:port (port 0 picks a free one).
 * connect(send, remoteAddress) is called for each connection, send(msg)
 * writes to it, and returns { receive(msg), close() }, as the plugin's
 * connectRuntime does. Resolves with { host, port, close() } once it listens.
 * @param {{ host?: string, port?: number, connect: (send: (msg: object) => void, remoteAddress: string | undefined) => { receive: (msg: object) => void, close: () => void } }} options
 */
export function listenReplSocket({ host = '127.0.0.1', port = 0, connect }) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    const runtime = connect(msg => {
      if (socket.writable) socket.write(JSON.stringify(msg) + '\n');
    }, socket.remoteAddress);
    let buffer = '';
    socket.on('data', chunk => {
      const lines = (buffer + chunk).split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg && typeof msg === 'object') runtime.receive(msg);
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      sockets.delete(socket);
      runtime.close();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      // the watch's process exits with Vite, the server doesn't hold it
      server.unref();
      resolve({
        host,
        port: server.address().port,
        close: () => {
          for (const socket of sockets) socket.destroy();
          server.close();
        },
      });
    });
  });
}
