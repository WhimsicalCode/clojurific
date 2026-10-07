// Finding Java and installing it with setup-java, with fake java binaries and
// a fake Adoptium API.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { LauncherError } from '../errors.js';
import { candidates, featureVersion, findJava, installInstructions, probe, setupJava } from '../java.js';
import { fakeJava, serve, tmpDir } from './helpers.js';

const posix = process.platform !== 'win32';

test('featureVersion', () => {
  assert.equal(featureVersion('1.8'), 8);
  assert.equal(featureVersion('17'), 17);
  assert.equal(featureVersion('21'), 21);
  assert.equal(featureVersion('25\n'), 25);
});

describe('findJava', { skip: !posix }, () => {
  const dir = tmpDir();
  const java11 = fakeJava(path.join(dir, 'java11'), { version: '11' });
  const java21 = fakeJava(path.join(dir, 'java21'), { version: '21' });
  const java25 = fakeJava(path.join(dir, 'java25'), { version: '25' });
  const broken = fakeJava(path.join(dir, 'broken'), { error: 'Unable to locate a Java Runtime.' });
  const cache = path.join(dir, 'cache');
  const none = { PATH: '', CLJF_CACHE_DIR: path.join(dir, 'empty-cache') };

  test('probe reads the version and home', async () => {
    assert.deepEqual(await probe(java21), { version: 21, home: path.join(dir, 'java21') });
    assert.deepEqual(await probe(broken), { error: 'Unable to locate a Java Runtime.' });
  });

  test('looks in CLJF_JAVA, JAVA_HOME, PATH, then setup-java\'s runtimes', async () => {
    fakeJava(path.join(cache, 'jre-21'), { version: '21' });
    fakeJava(path.join(cache, 'jre-25'), { version: '25' });
    const env = {
      CLJF_JAVA: java25,
      JAVA_HOME: path.join(dir, 'java11'),
      PATH: path.join(dir, 'java21', 'bin'),
      CLJF_CACHE_DIR: cache,
    };
    assert.deepEqual((await candidates(env)).map(c => [c.source, c.java]), [
      ['CLJF_JAVA', java25],
      ['JAVA_HOME', java11],
      ['java on PATH', java21],
      ['cljf setup-java', path.join(cache, 'jre-25', 'bin', 'java')],
      ['cljf setup-java', path.join(cache, 'jre-21', 'bin', 'java')],
    ]);
  });

  test('takes the first Java at least 17', async () => {
    const found = await findJava({ env: { ...none, JAVA_HOME: path.join(dir, 'java11'), PATH: path.join(dir, 'java21', 'bin') } });
    assert.equal(found.java, java21);
    assert.equal(found.version, 21);
    assert.equal(found.source, 'java on PATH');
  });

  test('picks up a runtime setup-java installed when there is no other', async () => {
    const found = await findJava({ env: { PATH: '', CLJF_CACHE_DIR: cache } });
    assert.equal(found.java, path.join(cache, 'jre-25', 'bin', 'java'));
  });

  test('CLJF_JAVA must be usable', async () => {
    await assert.rejects(findJava({ env: { ...none, CLJF_JAVA: java11, PATH: path.join(dir, 'java21', 'bin') } }),
      { name: 'LauncherError', message: `cljf: CLJF_JAVA ${java11} Java 11, older than 17` });
    await assert.rejects(findJava({ env: { ...none, CLJF_JAVA: path.join(dir, 'nope') } }), /CLJF_JAVA .* not found$/);
  });

  test('without Java, explains what it found and how to install one', async () => {
    const env = { ...none, JAVA_HOME: path.join(dir, 'java11'), PATH: path.join(dir, 'broken', 'bin') };
    const error = await findJava({ env }).catch(e => e);
    assert.ok(error instanceof LauncherError);
    assert.match(error.message, /needs Java 17 or later, and found only:/);
    assert.match(error.message, new RegExp(`JAVA_HOME \\(${java11}\\): Java 11, older than 17`));
    assert.match(error.message, /java on PATH \(.*broken.*\): doesn't run: Unable to locate a Java Runtime\./);
    assert.match(error.message, /npx cljf setup-java/);
    assert.match(error.message, /CLJF_INSTALL_JDK=1/);
  });

  test('CLJF_INSTALL_JDK=1 installs Java without asking', async () => {
    let installed = false;
    const found = await findJava({
      env: { ...none, CLJF_INSTALL_JDK: '1' },
      install: async () => {
        installed = true;
        return { java: java25, version: 25 };
      },
    });
    assert.ok(installed);
    assert.equal(found.java, java25);
    assert.equal(found.source, 'cljf setup-java');
  });
});

test('install instructions are for the platform', () => {
  assert.match(installInstructions([], 'darwin'), /brew install --cask temurin@25/);
  assert.match(installInstructions([], 'win32'), /winget install EclipseAdoptium\.Temurin\.25\.JDK/);
  assert.match(installInstructions([], 'linux'), /apt install openjdk-25-jdk/);
  assert.doesNotMatch(installInstructions([], 'linux'), /brew/);
  assert.match(installInstructions([], 'freebsd'), /sdk install java 25-tem/);
});

describe('setupJava', { skip: !posix }, () => {
  // A Temurin archive: jdk-25.0.1+8-jre/bin/java (Contents/Home/bin/java on macOS)
  const dir = tmpDir();
  const home = path.join(dir, 'archive', 'jdk-25.0.1+8-jre');
  fakeJava(process.platform === 'darwin' ? path.join(home, 'Contents', 'Home') : home, { version: '25' });
  const archive = path.join(dir, 'jre.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', path.join(dir, 'archive'), 'jdk-25.0.1+8-jre']);
  const bytes = readFileSync(archive);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  async function adoptium(checksum = sha256) {
    const server = await serve((req, res) => {
      if (req.url === '/v3/info/available_releases') {
        res.end(JSON.stringify({ most_recent_lts: 25 }));
      } else if (req.url.startsWith('/v3/assets/latest/25/hotspot?')) {
        res.end(JSON.stringify([{
          version: { openjdk_version: '25.0.1+8-LTS' },
          binary: { package: { name: 'jre.tar.gz', link: `${server.url}/jre.tar.gz`, checksum, size: bytes.length } },
        }]));
      } else if (req.url === '/jre.tar.gz') {
        res.end(bytes);
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    return server;
  }

  test('downloads, checks and installs the latest LTS, then reuses it', async () => {
    const server = await adoptium();
    const env = { CLJF_CACHE_DIR: path.join(dir, 'cache') };
    try {
      const installed = await setupJava({ env, api: server.url });
      assert.equal(installed.version, 25);
      assert.match(installed.java, /jre-25/);
      assert.ok(server.requests.includes('/jre.tar.gz'));
      assert.match(server.requests[1], /architecture=(x64|aarch64)&image_type=jre&os=(mac|linux|alpine-linux)&vendor=eclipse/);
      const count = server.requests.length;
      assert.equal((await setupJava({ env, api: server.url, version: 25 })).java, installed.java);
      assert.equal(server.requests.length, count);
      // findJava's last resort
      assert.equal((await findJava({ env: { ...env, PATH: '' } })).java, installed.java);
    } finally {
      await server.close();
    }
  });

  test('rejects an archive whose SHA-256 differs from the API\'s', async () => {
    const server = await adoptium('0'.repeat(64));
    const cache = path.join(dir, 'cache-bad');
    try {
      await assert.rejects(setupJava({ env: { CLJF_CACHE_DIR: cache }, api: server.url }),
        { name: 'LauncherError', message: /jre\.tar\.gz has SHA-256 [0-9a-f]{64}, expected 0{64}/ });
      assert.deepEqual((await candidates({ PATH: '', CLJF_CACHE_DIR: cache })), []);
    } finally {
      await server.close();
    }
  });

  test('refuses versions older than 17', async () => {
    await assert.rejects(setupJava({ version: '11', env: { CLJF_CACHE_DIR: path.join(dir, 'x') } }), /Java 17 or later, not 11/);
  });

  test('fails clearly when the API is unreachable', async () => {
    mkdirSync(path.join(dir, 'y'));
    await assert.rejects(setupJava({ env: { CLJF_CACHE_DIR: path.join(dir, 'y') }, api: 'http://127.0.0.1:1' }),
      { name: 'LauncherError', message: /http:\/\/127\.0\.0\.1:1\/v3\/info\/available_releases failed/ });
  });
});
