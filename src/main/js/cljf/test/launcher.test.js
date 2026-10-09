// Resolving projects' classpaths and building them, with Java and tools.deps.
// Uses the local Maven repository, downloading what's missing from it.
// CLJF_TEST_DOWNLOADS=1 also tests a cold start: an empty local repository,
// about 20 MB from Maven Central.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { classpath, compilerCommand, compilerDir, findJava, normalizeAliases } from '../launcher.js';
import { tmpDir } from './helpers.js';

const STOCK = /org[/\\]clojure[/\\]clojurescript[/\\]/;
const CLOSURE_COMPILER = /com[/\\]google[/\\]javascript[/\\]/;

// A project directory with deps.edn and files, its real path: tools.deps
// canonicalizes local roots' (/private/var on macOS)
function project(deps, files = {}) {
  const dir = realpathSync(tmpDir('cljf-project-'));
  writeFileSync(path.join(dir, 'deps.edn'), deps);
  for (const [file, content] of Object.entries({ 'src/demo/core.cljs': '(ns demo.core) (println "hi")', ...files })) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

function logs() {
  const lines = [];
  return { lines, log: line => lines.push(line) };
}

const noJava = () => Promise.reject(new Error('resolved again'));

test('normalizeAliases', () => {
  assert.deepEqual(normalizeAliases(['cljs', ':test', ':a:b']), [':cljs', ':test', ':a', ':b']);
  assert.deepEqual(normalizeAliases(':cljs'), [':cljs']);
  assert.deepEqual(normalizeAliases(), []);
});

describe('resolution', { timeout: 300000 }, () => {
  const java = findJava();

  test('adds the compiler and removes stock ClojureScript brought in by dependencies', async () => {
    // thi.ng/color depends on org.clojure/clojurescript 1.11.121
    const dir = project('{:paths ["src"] :deps {thi.ng/color {:mvn/version "1.5.1"}}}');
    const cmd = await compilerCommand({ cwd: dir, log: () => {} });
    assert.ok(cmd.classpath.includes(path.join(compilerDir, 'src', 'main', 'clojure')));
    assert.ok(cmd.classpath.some(p => /thi[/\\]ng[/\\]color/.test(p)));
    assert.deepEqual(cmd.classpath.filter(p => STOCK.test(p) || CLOSURE_COMPILER.test(p)), []);
    // and builds, passing cljf.esm's check for a second compiler
    const build = spawnSync(cmd.command, [...cmd.args, '-m', 'cljf.esm', 'build', '{:main demo.core :output-dir "out"}'],
      { cwd: dir, encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    assert.equal(execFileSync('node', [path.join(dir, 'out', 'demo', 'core.js')], { encoding: 'utf8' }), 'hi\n');
  });

  test('applies aliases, and warns about undefined ones', async () => {
    const dir = project('{:paths ["src"] :aliases {:extra {:extra-paths ["extra"] :jvm-opts ["-Dcljf.test=1"]}}}');
    const { lines, log } = logs();
    const cp = await classpath({ cwd: dir, aliases: ['extra', 'missing'], java, log });
    assert.deepEqual(cp.classpath.slice(0, 2), ['extra', 'src']);
    assert.deepEqual(cp.jvmOpts, ['-Dcljf.test=1']);
    assert.ok(lines.includes('cljf: alias :missing isn\'t defined in deps.edn'), lines.join('\n'));
  });

  test('a project listing com.whimsical/clojurific uses its own', async () => {
    const own = project('{:paths ["src"]}');
    const dir = project(`{:deps {com.whimsical/clojurific {:local/root ${JSON.stringify(own)}}
                                 thi.ng/color {:mvn/version "1.5.1"}}}`);
    const cp = await classpath({ cwd: dir, java, log: () => {} });
    assert.ok(cp.classpath.includes(path.join(own, 'src')));
    assert.ok(!cp.classpath.includes(path.join(compilerDir, 'src', 'main', 'clojure')));
    assert.deepEqual(cp.classpath.filter(p => STOCK.test(p)), []);
  });

  test('caches the classpath until a deps.edn changes', async () => {
    const local = project('{:paths ["src"]}');
    const dir = project(`{:paths ["src"] :deps {local/lib {:local/root ${JSON.stringify(local)}}}}`);
    const first = await classpath({ cwd: dir, java, log: () => {} });
    assert.ok(readFileSync(path.join(dir, '.cljf', '.gitignore'), 'utf8').startsWith('*'));
    assert.deepEqual((await classpath({ cwd: dir, java: noJava() })).classpath, first.classpath);
    // other aliases, --force
    await assert.rejects(classpath({ cwd: dir, aliases: ['x'], java: noJava() }), /resolved again/);
    await assert.rejects(classpath({ cwd: dir, force: true, java: noJava() }), /resolved again/);
    // a local dependency's deps.edn
    writeFileSync(path.join(local, 'deps.edn'), '{:paths ["src" "resources"]}');
    await assert.rejects(classpath({ cwd: dir, java: noJava() }), /resolved again/);
    assert.ok((await classpath({ cwd: dir, java, log: () => {} })).classpath.includes(path.join(local, 'resources')));
    // the project's
    writeFileSync(path.join(dir, 'deps.edn'), '{:paths ["src" "more"]}');
    await assert.rejects(classpath({ cwd: dir, java: noJava() }), /resolved again/);
  });

  test('resolves offline when the local repository has everything', async () => {
    const dir = project(`{:paths ["src"] :deps {thi.ng/color {:mvn/version "1.5.1"}}
                          :mvn/repos {"central" {:url "https://127.0.0.1:1/central"}
                                      "clojars" {:url "https://127.0.0.1:1/clojars"}}}`);
    const cp = await classpath({ cwd: dir, java, log: () => {} });
    assert.ok(cp.classpath.some(p => /thi[/\\]ng[/\\]color/.test(p)));
  });

  test('names the URL when the resolver can\'t be downloaded', async () => {
    const dir = project(`{:mvn/local-repo ${JSON.stringify(path.join(tmpDir(), 'm2'))}}`);
    await assert.rejects(classpath({ cwd: dir, java, env: { ...process.env, CLJF_MAVEN_REPO: 'http://127.0.0.1:1/maven2' }, log: () => {} }),
      { name: 'LauncherError', message: /downloading http:\/\/127\.0\.0\.1:1\/maven2\/.*\.jar failed.*CLJF_MAVEN_REPO/s });
  });

  test('explains that git dependencies need git', { skip: process.platform === 'win32' }, async () => {
    const dir = project('{:deps {example/lib {:git/url "https://example.invalid/lib.git" :git/sha "0000000000000000000000000000000000000000"}}}');
    const { lines, log } = logs();
    await assert.rejects(classpath({ cwd: dir, java, env: { ...process.env, PATH: '', GITLIBS: tmpDir() }, log }),
      /resolving the classpath failed/);
    assert.ok(lines.some(l => l.includes('git dependencies need git, which isn\'t on PATH')), lines.join('\n'));
  });

  test('downloads the resolver and the compiler\'s dependencies into an empty local repository',
    { skip: process.env.CLJF_TEST_DOWNLOADS !== '1' }, async () => {
      const m2 = path.join(tmpDir(), 'm2');
      const dir = project(`{:paths ["src"] :mvn/local-repo ${JSON.stringify(m2)}}`);
      const { lines, log } = logs();
      const cmd = await compilerCommand({ cwd: dir, log });
      assert.ok(lines.some(l => /downloading the dependency resolver, \d+ jars/.test(l)), lines.join('\n'));
      assert.ok(cmd.classpath.every(p => !p.endsWith('.jar') || p.startsWith(m2)));
      const build = spawnSync(cmd.command, [...cmd.args, '-m', 'cljf.esm', 'build', '{:main demo.core :output-dir "out"}'],
        { cwd: dir, encoding: 'utf8' });
      assert.equal(build.status, 0, build.stderr);
    });
});
