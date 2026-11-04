// Scaffolding a project from a template: its name, its namespace, the files,
// and the package manager's commands.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

// The version of clojurific the projects depend on, released with this package
export const version = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;

export const templatesDir = path.join(packageRoot, 'templates');

export const TEMPLATES = ['react', 'reagent', 'uix', 'hono', 'vanilla'];

export const DEFAULT_PROJECT = 'clojurific-project';

export const addonsDir = path.join(packageRoot, 'addons');

// Files of every template: the coding agents' MCP configuration and notes,
// and README-agents.md, the section on them appended to the README
export const commonDir = path.join(packageRoot, 'common');

// What AGENTS.md says of the app's runtimes: a backend's is its server
function agentVars(template) {
  return template === 'hono'
    ? {
      kind: 'backend',
      runtimes: 'server (and its worker threads)',
      runtimeNoun: 'runtimes (the server, its worker threads)',
      openPage: '',
      openPageStep: '',
      evalExample: ' or call a handler',
    }
    : {
      kind: 'app',
      runtimes: 'browser tabs',
      runtimeNoun: 'tabs',
      openPage: ' Open the dev server\'s page if there\'s none.',
      openPageStep: ', and open its page: each tab is a runtime the tools evaluate in',
      evalExample: ' or the DOM',
    };
}

// Add-ons scaffolded over a template: the templates each applies to
export const ADDONS = {
  unistyle: ['react', 'reagent', 'uix'],
};

// The uni.style version the unistyle add-on depends on
export const UNISTYLE_VERSION = '1.0.0';

// Trimmed, without trailing slashes
export function formatTargetDir(dir) {
  return dir.trim().replace(/[/\\]+$/g, '');
}

// A valid npm package name from a directory's name
export function packageName(name) {
  return name.trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]/, '')
    .replace(/[^a-z\d\-~]+/g, '-') || DEFAULT_PROJECT;
}

// Names whose namespace would be munged (JavaScript's reserved words) or
// collide with the compiler's own (cljs.core, clojure.core)
const RESERVED = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import',
  'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public',
  'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield', 'cljs', 'clojure', 'goog',
]);

// The app's namespace from the package's name: my-app.core, in
// src/my_app/core.cljs
export function namespace(pkg) {
  let name = pkg.replace(/^@[^/]*\//, '').replace(/[^a-z\d]+/g, '-').replace(/^-+|-+$/g, '');
  if (!name) name = 'app';
  else if (/^\d/.test(name) || RESERVED.has(name)) name = `app-${name}`;
  return { ns: `${name}.core`, nsDir: name.replace(/-/g, '_') };
}

// Whether dir is missing or has nothing but .git
export function isEmpty(dir) {
  const files = existsSync(dir) ? readdirSync(dir) : [];
  return files.length === 0 || (files.length === 1 && files[0] === '.git');
}

// Removes the directory's files but .git
export async function emptyDir(dir) {
  for (const file of await fs.readdir(dir)) {
    if (file !== '.git') await fs.rm(path.join(dir, file), { recursive: true, force: true });
  }
}

async function copy(src, dest, replace) {
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    // npm leaves .gitignore files out of packages
    const name = replace(entry.name === '_gitignore' ? '.gitignore' : entry.name);
    const from = path.join(src, entry.name);
    const to = path.join(dest, name);
    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      await copy(from, to, replace);
    } else {
      await fs.writeFile(to, replace(await fs.readFile(from, 'utf8')));
    }
  }
}

// Replaces the text matching pattern in root's file, which must match
async function patch(root, file, pattern, replacement) {
  const to = path.join(root, file);
  const content = await fs.readFile(to, 'utf8');
  if (!pattern.test(content)) throw new Error(`${file} has no ${pattern}`);
  await fs.writeFile(to, content.replace(pattern, replacement));
}

// uni.style: its dependency, the build hook writing the CSS its macros
// compile, which index.html loads instead of src/style.css, and the
// add-on's sources (core.cljs styled with it, and theme.cljs)
async function unistyle({ root, template, replace }) {
  const dir = path.join(addonsDir, 'unistyle');
  await copy(path.join(dir, 'common'), root, replace);
  await copy(path.join(dir, template), root, replace);
  // the last of :deps, the map closing deps.edn's
  await patch(root, 'deps.edn', /\}\}\n?$/, `
        ;; compile-time atomic CSS, see vite.config.ts
        com.whimsical/uni.style {:mvn/version "${UNISTYLE_VERSION}"}}}
`);
  await patch(root, 'vite.config.ts', /^( *)compilerOptions: \{\n/m, (m, indent) => `${m}${indent}  `
    + '// writes the CSS of uni.style\'s macros after every compile, which\n'
    + `${indent}  // index.html loads (and the dev server's pages reload)\n`
    + `${indent}  buildHooks: [["'uni.style.build/esm-hook", { outputTo: 'public/css/bundle.css' }]],\n`);
  await patch(root, 'index.html', /<link rel="stylesheet" href="\/src\/style\.css" \/>/,
    '<link id="bundle-css" rel="stylesheet" href="/css/bundle.css" />');
  await fs.rm(path.join(root, 'src', 'style.css'));
  await fs.appendFile(path.join(root, '.gitignore'), '# uni.style\'s CSS, written by the build\npublic/css\n');
  await fs.appendFile(path.join(root, 'README.md'), replace(await fs.readFile(path.join(dir, 'README.md'), 'utf8')));
}

const addons = { unistyle };

/**
 * Writes the template into root (created if missing): {{name}}, {{ns}} and
 * {{nsDir}} in files and paths are the package's name and namespace, and
 * package.json gets the name and clojurific's version. Then the add-ons
 * (ADDONS' keys) over it.
 */
export async function scaffold({ root, template, name = packageName(path.basename(root)), addons: selected = [] }) {
  if (!TEMPLATES.includes(template)) throw new Error(`Unknown template ${template}, expected one of ${TEMPLATES.join(', ')}`);
  for (const addon of selected) {
    if (!ADDONS[addon]) throw new Error(`Unknown add-on ${addon}, expected one of ${Object.keys(ADDONS).join(', ')}`);
    if (!ADDONS[addon].includes(template)) throw new Error(`The ${addon} add-on is for the ${ADDONS[addon].join(', ')} templates, not ${template}`);
  }
  const vars = { name, ...namespace(name) };
  // the add-ons' sources also name the app's my-app.theme namespace
  const names = { ...vars, themeNs: vars.ns.replace(/\.core$/, '.theme'), ...agentVars(template) };
  const replace = s => s.replace(/\{\{(\w+)\}\}/g, (m, v) => names[v] ?? m);
  await fs.mkdir(root, { recursive: true });
  await copy(path.join(templatesDir, template), root, replace);
  await copy(commonDir, root, replace);
  await fs.rm(path.join(root, 'README-agents.md'));
  for (const addon of selected) await addons[addon]({ root, template, replace });
  // a section of its own, after the template's and the add-ons' paragraphs
  await fs.appendFile(path.join(root, 'README.md'),
    replace(await fs.readFile(path.join(commonDir, 'README-agents.md'), 'utf8')));
  const pkgFile = path.join(root, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgFile, 'utf8'));
  pkg.name = name;
  pkg.devDependencies.clojurific = `^${version}`;
  await fs.writeFile(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  return vars;
}

// The package manager running this (npm_config_user_agent, e.g.
// "pnpm/9.1.0 npm/? node/v22.3.0"), and its commands
export function packageManager(userAgent = process.env.npm_config_user_agent ?? '') {
  const name = userAgent.split(' ')[0]?.split('/')[0];
  const pm = ['pnpm', 'yarn', 'bun'].includes(name) ? name : 'npm';
  return {
    name: pm,
    install: [pm, 'install'],
    dev: pm === 'npm' || pm === 'bun' ? [pm, 'run', 'dev'] : [pm, 'dev'],
  };
}
