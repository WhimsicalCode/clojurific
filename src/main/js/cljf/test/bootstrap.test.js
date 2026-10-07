// Downloading the resolver's jars from resolver.lock.json, from a fake Maven
// repository.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { bootstrapResolver, readLock } from '../bootstrap.js';
import { serve, tmpDir } from './helpers.js';

const jars = {
  'org/example/a/1.0/a-1.0.jar': Buffer.from('jar a'),
  'org/example/b/2.0/b-2.0.jar': Buffer.alloc(100000, 'b'),
};

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const lock = {
  repository: 'https://repo.invalid/maven2',
  jars: Object.entries(jars).map(([p, bytes]) => ({ lib: p, version: '1', path: p, sha256: sha256(bytes), size: bytes.length })),
};

// A repository under /maven2; /broken/ sends the first bytes of b, then
// closes the connection
function repository() {
  return serve((req, res) => {
    const file = req.url.replace(/^\/(maven2|broken)\//, '');
    if (!jars[file]) {
      res.statusCode = 404;
      res.end();
    } else if (req.url.startsWith('/broken/') && file.includes('/b/')) {
      res.writeHead(200, { 'content-length': jars[file].length });
      res.write(jars[file].subarray(0, 1000));
      setTimeout(() => res.destroy(), 20);
    } else {
      res.end(jars[file]);
    }
  });
}

test('the lock file lists jars with their SHA-256', () => {
  const { repository: repo, jars: locked } = readLock();
  assert.equal(repo, 'https://repo1.maven.org/maven2');
  assert.ok(locked.some(j => j.lib === 'org.clojure/tools.deps'));
  assert.ok(locked.every(j => /^[0-9a-f]{64}$/.test(j.sha256) && j.path.endsWith('.jar') && j.size > 0));
  // tools.deps' S3 transporter is left out
  assert.ok(!locked.some(j => /aws|core\.async|s3-transporter/.test(j.lib)));
});

test('downloads missing jars into the local repository, then reuses them', async () => {
  const server = await repository();
  const localRepo = tmpDir();
  try {
    const paths = await bootstrapResolver({ lock, localRepo, repository: `${server.url}/maven2` });
    assert.deepEqual(paths, Object.keys(jars).map(p => path.join(localRepo, p)));
    for (const [p, bytes] of Object.entries(jars)) assert.deepEqual(readFileSync(path.join(localRepo, p)), bytes);
    assert.equal(server.requests.length, 2);
    await bootstrapResolver({ lock, localRepo, repository: `${server.url}/maven2` });
    assert.equal(server.requests.length, 2);
  } finally {
    await server.close();
  }
});

test('downloads a jar again when it doesn\'t match its SHA-256', async () => {
  const server = await repository();
  const localRepo = tmpDir();
  const file = path.join(localRepo, 'org/example/a/1.0/a-1.0.jar');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'corrupt');
  const logs = [];
  try {
    await bootstrapResolver({ lock, localRepo, repository: `${server.url}/maven2`, log: l => logs.push(l) });
    assert.deepEqual(readFileSync(file), jars['org/example/a/1.0/a-1.0.jar']);
    assert.match(logs[0], /a-1\.0\.jar doesn't match resolver\.lock\.json, downloading it again/);
  } finally {
    await server.close();
  }
});

test('rejects a jar whose SHA-256 differs from the lock\'s', async () => {
  const server = await repository();
  const localRepo = tmpDir();
  const tampered = { ...lock, jars: [{ ...lock.jars[0], sha256: '0'.repeat(64) }] };
  try {
    await assert.rejects(bootstrapResolver({ lock: tampered, localRepo, repository: `${server.url}/maven2` }), {
      name: 'LauncherError',
      message: new RegExp(`${server.url}/maven2/org/example/a/1\\.0/a-1\\.0\\.jar has SHA-256 ${lock.jars[0].sha256}, expected 0{64}`),
    });
    assert.ok(!existsSync(path.join(localRepo, 'org/example/a/1.0/a-1.0.jar')));
  } finally {
    await server.close();
  }
});

test('an interrupted download leaves no partial jar', async () => {
  const server = await repository();
  const localRepo = tmpDir();
  try {
    await assert.rejects(bootstrapResolver({ lock, localRepo, repository: `${server.url}/broken` }),
      { name: 'LauncherError', message: /downloading .*\/broken\/org\/example\/b\/2\.0\/b-2\.0\.jar failed/ });
    assert.deepEqual(readdirSync(path.join(localRepo, 'org/example/b/2.0')), []);
    // the other jar was complete
    assert.ok(existsSync(path.join(localRepo, 'org/example/a/1.0/a-1.0.jar')));
  } finally {
    await server.close();
  }
});

test('names the URL and CLJF_MAVEN_REPO when the repository is unreachable', async () => {
  await assert.rejects(bootstrapResolver({ lock, localRepo: tmpDir(), repository: 'http://127.0.0.1:1/maven2/' }), {
    name: 'LauncherError',
    message: /downloading http:\/\/127\.0\.0\.1:1\/maven2\/org\/example\/.* failed: .*\(and 1 more\)\n.*CLJF_MAVEN_REPO/s,
  });
});
