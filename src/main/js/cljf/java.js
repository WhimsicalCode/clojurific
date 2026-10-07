// Finding a Java runtime for the compiler, and installing one (setup-java)
// when there's none.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { LauncherError } from './errors.js';
import { cacheDir, download } from './files.js';

export const MIN_VERSION = 17;

const exe = process.platform === 'win32' ? 'java.exe' : 'java';

// The feature version of a java.specification.version: 1.8 is 8, 21 is 21
export function featureVersion(spec) {
  const [first, second] = String(spec).trim().split('.');
  return Number(first === '1' ? second : first);
}

// Runs java -XshowSettings:properties -version: {version, home} or {error}
export function probe(java, { timeout = 15000 } = {}) {
  return new Promise(resolve => {
    let out = '';
    let child;
    try {
      child = spawn(java, ['-XshowSettings:properties', '-version'], { stdio: ['ignore', 'pipe', 'pipe'], timeout });
    } catch (e) {
      resolve({ error: e.message });
      return;
    }
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    child.on('error', e => resolve({ error: e.message }));
    child.on('close', code => {
      const spec = out.match(/^\s*java\.specification\.version = (.+)$/m)?.[1];
      if (code !== 0 || !spec) {
        resolve({ error: out.trim().split('\n')[0] || `exited with ${code}` });
      } else {
        resolve({ version: featureVersion(spec), home: out.match(/^\s*java\.home = (.+)$/m)?.[1]?.trim() });
      }
    });
  });
}

// The java binary of an installed runtime: bin/java, or on macOS
// Contents/Home/bin/java
export function javaIn(dir) {
  return [path.join(dir, 'bin', exe), path.join(dir, 'Contents', 'Home', 'bin', exe)].find(f => existsSync(f));
}

function onPath(env) {
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (dir && existsSync(path.join(dir, exe))) return path.join(dir, exe);
  }
  return null;
}

// The runtimes setup-java installed, the newest first
async function installed(env) {
  const dir = cacheDir(env);
  const entries = await fs.readdir(dir).catch(() => []);
  return entries
    .map(name => [name, Number(name.match(/^jre-(\d+)$/)?.[1])])
    .filter(([, version]) => version)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => javaIn(path.join(dir, name)))
    .filter(Boolean);
}

// The places to look for java, in order
export async function candidates(env = process.env) {
  return [
    ...(env.CLJF_JAVA ? [{ source: 'CLJF_JAVA', java: env.CLJF_JAVA, strict: true }] : []),
    ...(env.JAVA_HOME ? [{ source: 'JAVA_HOME', java: path.join(env.JAVA_HOME, 'bin', exe) }] : []),
    ...(onPath(env) ? [{ source: 'java on PATH', java: onPath(env) }] : []),
    ...(await installed(env)).map(java => ({ source: 'cljf setup-java', java })),
  ];
}

function describe({ source, java }, problem) {
  return `  ${source} (${java}): ${problem}`;
}

export function installInstructions(rejected = [], platform = process.platform) {
  const commands = {
    darwin: '  brew install --cask temurin@25',
    win32: '  winget install EclipseAdoptium.Temurin.25.JDK',
    linux: '  your distribution\'s OpenJDK package, e.g. sudo apt install openjdk-25-jdk or sudo dnf install java-25-openjdk',
  };
  return [
    `cljf: the ClojureScript compiler needs Java ${MIN_VERSION} or later, and found ${rejected.length ? 'only:' : 'none.'}`,
    ...rejected,
    'Install it with',
    ...(commands[platform] ? [commands[platform]] : []),
    '  SDKMAN (https://sdkman.io): sdk install java 25-tem',
    'or let cljf download Eclipse Temurin into its own cache, without admin rights: npx cljf setup-java',
    `(CLJF_INSTALL_JDK=1 does that without asking). CLJF_JAVA can point to a java binary.`,
  ].join('\n');
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * The first Java at least MIN_VERSION: CLJF_JAVA (which must be usable),
 * JAVA_HOME, java on PATH, then the runtimes setup-java installed. Without
 * one, installs one with setup-java when CLJF_INSTALL_JDK=1 or the user
 * agrees (interactive), or fails with instructions. Returns {java, version,
 * home, source}.
 */
export async function findJava({ env = process.env, interactive = false, log = () => {}, install = setupJava } = {}) {
  const rejected = [];
  for (const candidate of await candidates(env)) {
    const exists = existsSync(candidate.java);
    const result = exists ? await probe(candidate.java) : {};
    if (result.version >= MIN_VERSION) return { ...candidate, ...result };
    const problem = !exists ? 'not found'
      : result.error ? `doesn't run: ${result.error}`
      : `Java ${result.version}, older than ${MIN_VERSION}`;
    if (candidate.strict) throw new LauncherError(`cljf: CLJF_JAVA ${candidate.java} ${problem}`);
    rejected.push(describe(candidate, problem));
  }
  const instructions = installInstructions(rejected);
  if (env.CLJF_INSTALL_JDK !== '1') {
    if (!interactive) throw new LauncherError(instructions);
    // a closed stdin is a no
    const answer = await ask(`${instructions}\n\nDownload Eclipse Temurin into ${cacheDir(env)} now? [Y/n] `).catch(() => 'n');
    if (!/^(y|yes|)$/i.test(answer)) throw new LauncherError(`cljf: no Java ${MIN_VERSION} or later, see above`);
  }
  return { ...(await install({ env, log })), source: 'cljf setup-java' };
}

function adoptiumPlatform(platform = process.platform, arch = process.arch) {
  const musl = platform === 'linux' && !process.report?.getReport().header.glibcVersionRuntime;
  const os = { darwin: 'mac', win32: 'windows', linux: musl ? 'alpine-linux' : 'linux' }[platform];
  const architecture = { x64: 'x64', arm64: 'aarch64' }[arch];
  if (!os || !architecture) throw new LauncherError(`cljf: setup-java doesn't support ${platform} on ${arch}, install Java ${MIN_VERSION} or later yourself`);
  return { os, architecture };
}

async function json(url, fetch) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new LauncherError(`cljf: ${url} failed: ${e.cause?.message ?? e.message}`);
  }
  if (!res.ok) throw new LauncherError(`cljf: ${url} failed: HTTP ${res.status}`);
  return res.json();
}

function extract(archive, dir) {
  return new Promise((resolve, reject) => {
    // bsdtar on macOS and Windows reads zip archives too
    const child = spawn('tar', ['-xf', archive, '-C', dir], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => (err += d));
    child.on('error', e => reject(new LauncherError(`cljf: extracting ${archive} needs tar: ${e.message}`)));
    child.on('close', code => (code === 0 ? resolve() : reject(new LauncherError(`cljf: extracting ${archive} failed: ${err.trim()}`))));
  });
}

/**
 * Installs Eclipse Temurin's JRE, version (the latest LTS by default), from
 * the Adoptium API into the cache (jre-<version>), checking the archive's
 * SHA-256 against the API's. Reuses an installed one that runs. Returns
 * {java, version, home}.
 */
export async function setupJava({
  version,
  env = process.env,
  log = () => {},
  api = 'https://api.adoptium.net',
  fetch = globalThis.fetch,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const feature = version ? Number(version) : (await json(`${api}/v3/info/available_releases`, fetch)).most_recent_lts;
  if (!(feature >= MIN_VERSION)) throw new LauncherError(`cljf: setup-java installs Java ${MIN_VERSION} or later, not ${version}`);
  const dir = cacheDir(env);
  const target = path.join(dir, `jre-${feature}`);
  const existing = javaIn(target);
  if (existing) {
    const result = await probe(existing);
    if (result.version) {
      log(`cljf: Java ${result.version} is installed in ${target}`);
      return { java: existing, ...result };
    }
  }
  const { os, architecture } = adoptiumPlatform(platform, arch);
  const assets = await json(
    `${api}/v3/assets/latest/${feature}/hotspot?architecture=${architecture}&image_type=jre&os=${os}&vendor=eclipse`, fetch);
  const pkg = assets[0]?.binary?.package;
  if (!pkg) throw new LauncherError(`cljf: Adoptium has no Temurin ${feature} JRE for ${os} on ${architecture}`);
  log(`cljf: downloading Eclipse Temurin ${assets[0].version?.openjdk_version ?? feature} JRE (${(pkg.size / 1e6).toFixed(0)} MB)`);
  await fs.mkdir(dir, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(dir, '.setup-'));
  try {
    const archive = path.join(tmp, pkg.name);
    try {
      await download(pkg.link, archive, { sha256: pkg.checksum, fetch });
    } catch (e) {
      throw new LauncherError(`cljf: ${e.message}`, { cause: e });
    }
    const unpacked = path.join(tmp, 'unpacked');
    await fs.mkdir(unpacked);
    await extract(archive, unpacked);
    const [top] = await fs.readdir(unpacked);
    if (!top || !javaIn(path.join(unpacked, top))) throw new LauncherError(`cljf: ${pkg.name} has no bin/java`);
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(path.join(unpacked, top), target);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  const java = javaIn(target);
  const result = await probe(java);
  if (!result.version) throw new LauncherError(`cljf: the installed ${java} doesn't run: ${result.error}`);
  log(`cljf: installed Java ${result.version} in ${target}`);
  return { java, ...result };
}
