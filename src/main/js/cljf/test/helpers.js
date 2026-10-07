import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export function tmpDir(prefix = 'cljf-test-') {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A java binary in dir/bin printing the properties of a Java of version
// (a java.specification.version), or failing with error
export function fakeJava(dir, { version, error } = {}) {
  mkdirSync(path.join(dir, 'bin'), { recursive: true });
  const java = path.join(dir, 'bin', 'java');
  writeFileSync(java, error
    ? `#!/bin/sh\necho '${error}' >&2\nexit 1\n`
    : `#!/bin/sh\necho 'Property settings:' >&2\necho '    java.home = ${dir}' >&2\n` +
      `echo '    java.specification.version = ${version}' >&2\nexit 0\n`, { mode: 0o755 });
  return java;
}

// An HTTP server answering with handler(req, res), on a random port:
// {url, requests (paths), close}
export async function serve(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    handler(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise(resolve => {
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}
