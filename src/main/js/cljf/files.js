// Files and directories shared by the launcher's parts.
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// The per-user cache, for the Java runtimes setup-java installs
export function cacheDir(env = process.env, platform = process.platform) {
  if (env.CLJF_CACHE_DIR) return path.resolve(env.CLJF_CACHE_DIR);
  const home = os.homedir();
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'cljf');
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'cljf');
  return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'cljf');
}

// The user's deps.edn, where tools.deps looks for it
export function userDepsEdn(env = process.env) {
  if (env.CLJ_CONFIG) return path.join(env.CLJ_CONFIG, 'deps.edn');
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'clojure', 'deps.edn');
  return path.join(os.homedir(), '.clojure', 'deps.edn');
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// The local Maven repository: :mvn/local-repo of the project's or the user's
// deps.edn, as tools.deps uses it, or ~/.m2/repository
export async function localRepository(project, env = process.env) {
  for (const file of [path.join(project, 'deps.edn'), userDepsEdn(env)]) {
    const match = (await readIfExists(file))?.match(/:mvn\/local-repo\s+"((?:[^"\\]|\\.)*)"/);
    if (match) return path.resolve(project, JSON.parse(`"${match[1]}"`));
  }
  return path.join(os.homedir(), '.m2', 'repository');
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  try {
    await pipeline(createReadStream(file), hash);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  return hash.digest('hex');
}

// Writes content to file through a temporary file, so readers never see a
// partial one
export async function writeAtomically(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, file);
}

// Downloads url to file, through a temporary file that's renamed once the
// download is complete and its SHA-256 is sha256 (when given). Returns the
// SHA-256.
export async function download(url, file, { sha256, fetch = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`downloading ${url} failed: ${e.cause?.message ?? e.message}`, { cause: e });
  }
  if (!res.ok) throw new Error(`downloading ${url} failed: HTTP ${res.status}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.part`;
  const hash = createHash('sha256');
  try {
    await pipeline(
      Readable.fromWeb(res.body),
      new Transform({ transform(chunk, _, done) { hash.update(chunk); done(null, chunk); } }),
      createWriteStream(tmp),
    );
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw new Error(`downloading ${url} failed: ${e.cause?.message ?? e.message}`, { cause: e });
  }
  const actual = hash.digest('hex');
  if (sha256 && actual !== sha256) {
    await fs.rm(tmp, { force: true });
    throw new Error(`${url} has SHA-256 ${actual}, expected ${sha256}`);
  }
  await fs.rename(tmp, file);
  return actual;
}
