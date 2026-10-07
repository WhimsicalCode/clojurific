// The resolver's classpath: tools.deps resolves the project's dependencies,
// but can't download itself. Its jars are listed in resolver.lock.json with
// their SHA-256, and downloaded into the local Maven repository, where the
// Clojure CLI's are reused.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LauncherError } from './errors.js';
import { download, sha256File } from './files.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const resolverDir = path.join(here, 'resolver');

export function readLock(file = path.join(here, 'resolver.lock.json')) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function inParallel(items, limit, f) {
  const queue = [...items];
  const errors = [];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      try {
        await f(item);
      } catch (e) {
        errors.push(e);
      }
    }
  }));
  return errors;
}

/**
 * Downloads the lock's jars missing from localRepo (or not matching their
 * SHA-256) from repository, Maven Central or CLJF_MAVEN_REPO. Returns the
 * jars' paths.
 */
export async function bootstrapResolver({
  lock = readLock(),
  localRepo,
  repository = lock.repository,
  log = () => {},
  fetch,
}) {
  const base = repository.replace(/\/+$/, '');
  const missing = [];
  await inParallel(lock.jars, 8, async jar => {
    const file = path.join(localRepo, ...jar.path.split('/'));
    const sha256 = await sha256File(file);
    if (sha256 === jar.sha256) return;
    if (sha256) log(`cljf: ${file} doesn't match resolver.lock.json, downloading it again`);
    missing.push(jar);
  });
  if (missing.length) {
    const mb = missing.reduce((sum, jar) => sum + jar.size, 0) / 1e6;
    log(`cljf: downloading the dependency resolver, ${missing.length} jars (${mb.toFixed(1)} MB), from ${base}`);
    const errors = await inParallel(missing, 8, jar =>
      download(`${base}/${jar.path}`, path.join(localRepo, ...jar.path.split('/')), { sha256: jar.sha256, fetch }));
    if (errors.length) {
      throw new LauncherError(
        `cljf: ${errors[0].message}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''}\n` +
        'Check the network connection and proxy settings. For a Maven Central mirror, set CLJF_MAVEN_REPO ' +
        'to its URL; the project\'s own repositories come from :mvn/repos in deps.edn.',
        { cause: errors[0] });
    }
  }
  return lock.jars.map(jar => path.join(localRepo, ...jar.path.split('/')));
}
