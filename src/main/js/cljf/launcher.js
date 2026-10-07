// The command starting the ClojureScript compiler for a project: Java, and
// the project's classpath as tools.deps resolves its deps.edn, with the
// compiler added and stock ClojureScript (org.clojure/clojurescript) removed.
// Classpaths are cached in the project's .cljf/cpcache, like the Clojure
// CLI's .cpcache, until a deps.edn they were resolved from changes.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapResolver, readLock, resolverDir } from './bootstrap.js';
import { LauncherError } from './errors.js';
import { localRepository, sha256File, writeAtomically } from './files.js';
import { findJava } from './java.js';

export { LauncherError } from './errors.js';
export { findJava, setupJava, MIN_VERSION } from './java.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const version = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;

// The compiler's sources: compiler/ in the npm package, the fork itself
// (src/main/js is the package's root) when run from its repository
export const compilerDir = existsSync(path.join(packageRoot, 'compiler', 'deps.edn'))
  ? path.join(packageRoot, 'compiler')
  : path.resolve(packageRoot, '../../..');

const log = line => process.stderr.write(`${line}\n`);

// Aliases as keywords: "cljs", ":cljs" and ":a:b" (the Clojure CLI's -A) are
// all accepted
export function normalizeAliases(aliases = []) {
  return [].concat(aliases).flatMap(a => String(a).split(':')).filter(Boolean).map(a => `:${a}`);
}

function cacheKey(aliases) {
  return createHash('sha256')
    .update(JSON.stringify({ version, compiler: compilerDir, aliases }))
    .digest('hex')
    .slice(0, 32);
}

async function manifestHashes(files) {
  return Object.fromEntries(await Promise.all(files.map(async f => [f, await sha256File(f)])));
}

async function readCache(file) {
  let cached;
  try {
    cached = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    return null;
  }
  const current = await manifestHashes(Object.keys(cached.manifests));
  return Object.entries(cached.manifests).every(([f, hash]) => current[f] === hash) ? cached : null;
}

function edn(x) {
  if (Array.isArray(x)) return `[${x.map(edn).join(' ')}]`;
  if (x && typeof x === 'object') return `{${Object.entries(x).map(([k, v]) => `${k} ${edn(v)}`).join(' ')}}`;
  return typeof x === 'string' && x.startsWith(':') ? x : JSON.stringify(x);
}

// Runs the resolver (clojurific.resolve) with java in the project's directory
async function resolve({ project, aliases, java, cache, env, log }) {
  const jars = await bootstrapResolver({
    lock: readLock(),
    localRepo: await localRepository(project, env),
    repository: env.CLJF_MAVEN_REPO || undefined,
    log,
  });
  const input = `${cache}.resolve.edn`;
  const output = `${cache}.resolve.json`;
  await fs.writeFile(input, edn({
    ':aliases': aliases,
    ':compiler': { ':local/root': compilerDir },
    ':no-clojurescript': { ':local/root': path.join(compilerDir, 'no-clojurescript') },
    ':output': output,
  }));
  log('cljf: resolving dependencies');
  try {
    const code = await new Promise((done, fail) => {
      const child = spawn(java, ['-cp', [...jars, resolverDir].join(path.delimiter), 'clojure.main', '-m', 'clojurific.resolve', input], {
        cwd: project,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      for (const stream of [child.stdout, child.stderr]) {
        let buffer = '';
        stream.on('data', chunk => {
          const lines = (buffer + chunk).split('\n');
          buffer = lines.pop();
          for (const line of lines) if (line.trim()) log(line);
        });
        stream.on('end', () => buffer.trim() && log(buffer));
      }
      child.on('error', fail);
      child.on('close', done);
    });
    if (code !== 0) throw new LauncherError('cljf: resolving the classpath failed, see above');
    return JSON.parse(await fs.readFile(output, 'utf8'));
  } finally {
    await Promise.all([input, output].map(f => fs.rm(f, { force: true })));
  }
}

/**
 * The project's classpath: {classpath, jvmOpts, argfile}, from the cache or
 * resolved with java, a promise of findJava's result.
 */
export async function classpath({ cwd = process.cwd(), aliases = [], force = false, env = process.env, java, log: logLine = log }) {
  // only a cache miss needs java
  java?.catch(() => {});
  const project = path.resolve(cwd);
  const normalized = normalizeAliases(aliases);
  const dir = path.join(project, '.cljf');
  const cache = path.join(dir, 'cpcache', cacheKey(normalized));
  let entry = force ? null : await readCache(`${cache}.json`);
  if (!entry) {
    await fs.mkdir(path.dirname(cache), { recursive: true });
    if (!existsSync(path.join(dir, '.gitignore'))) await fs.writeFile(path.join(dir, '.gitignore'), '*\n');
    const resolved = await resolve({ project, aliases: normalized, java: (await java).java, cache, env, log: logLine });
    entry = { ...resolved, manifests: await manifestHashes(resolved.manifests) };
    // Java argument file: Windows limits command lines to 32K characters
    await writeAtomically(`${cache}.args`, `-cp\n${JSON.stringify(entry.classpath.join(path.delimiter))}\n`);
    await writeAtomically(`${cache}.json`, JSON.stringify(entry, null, 2));
  }
  return { ...entry, argfile: `${cache}.args` };
}

/**
 * The command starting clojure.main with the compiler on the project's
 * classpath: {command, args, java, classpath}, cljs.esm's arguments go after
 * args, i.e. [...args, '-m', 'cljs.esm', 'build']. Options: cwd (the
 * project, with its deps.edn), aliases, force (resolve the classpath again),
 * interactive (offer to install Java), env and log.
 */
export async function compilerCommand({ cwd = process.cwd(), aliases = [], force = false, interactive = false, env = process.env, log: logLine = log } = {}) {
  const java = findJava({ env, interactive, log: logLine });
  const cp = await classpath({ cwd, aliases, force, env, java, log: logLine });
  const { java: command, version: javaVersion } = await java;
  return {
    command,
    args: ['-XX:-OmitStackTraceInFastThrow', ...cp.jvmOpts, `@${cp.argfile}`, 'clojure.main'],
    java: { path: command, version: javaVersion },
    classpath: cp.classpath,
  };
}
