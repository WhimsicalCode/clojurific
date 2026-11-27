// JavaScript completions for the REPL's nREPL sessions from a TypeScript
// language service (the plugin's tsCompletions): the compiler translates the
// ClojureScript form at the cursor into a small TypeScript snippet
// (cljf.esm.repl.ts), this completes it over the project's tsconfig and
// node_modules, as Svelte's and Vue's tooling complete their templates. It
// needs TypeScript's JavaScript API, which TypeScript 7 (the Go port) doesn't
// have: the project's typescript of version 5 or 6, or
// @typescript/typescript6 next to TypeScript 7. Without one, the REPL keeps
// clj-suitable's completions from the runtime.
import { createRequire } from 'node:module';
import path from 'node:path';

// The snippet's file, in the project's root so that its imports resolve from
// there. It's never written.
const SNIPPET = '__cljf_completion__.ts';

// Loads TypeScript's JavaScript API resolved from root, null without one.
function loadTypeScript(root) {
  const require = createRequire(path.join(root, 'package.json'));
  for (const name of ['typescript', '@typescript/typescript6']) {
    try {
      const ts = require(name);
      if (typeof ts.createLanguageService === 'function') return ts;
    } catch {}
  }
  return null;
}

// The compiler options of the tsconfig named, or of root's tsconfig.json,
// with its declaration files, defaults without one. The snippet imports .ts files
// and packages as Vite resolves them.
function projectConfig(ts, root, tsconfig) {
  const atTypes = path.join(root, 'node_modules', '@types');
  const defaults = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    strict: true,
    // the installed @types (i.e. @types/node), which TypeScript 6 no
    // longer includes by default
    types: ts.sys.directoryExists(atTypes) ? ts.sys.getDirectories(atTypes) : [],
  };
  // root's own: a tsconfig.json further up (i.e. a monorepo's, for its other
  // projects) may not describe this one
  const file = tsconfig ? path.resolve(root, tsconfig) : path.join(root, 'tsconfig.json');
  if (!ts.sys.fileExists(file)) return { options: defaults, files: [] };
  const parse = f => ts.getParsedCommandLineOfConfigFile(f, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  let parsed = parse(file);
  // a solution-style tsconfig (create-vite's: no files, references to
  // tsconfig.app.json and tsconfig.node.json): its first reference's
  if (parsed && !parsed.fileNames.length && parsed.projectReferences?.length) {
    parsed = parse(ts.resolveProjectReferencePath(parsed.projectReferences[0])) ?? parsed;
  }
  if (!parsed) return { options: defaults, files: [] };
  return {
    options: { ...parsed.options, allowJs: true, allowImportingTsExtensions: true, noEmit: true },
    // global declarations (i.e. env.d.ts, vite/client's), not the sources
    files: parsed.fileNames.filter(f => f.endsWith('.d.ts')),
  };
}

// A language service over the snippet: update(code) sets its text.
function snippetService(ts, root, tsconfig) {
  const { options, files } = projectConfig(ts, root, tsconfig);
  const snippet = path.join(root, SNIPPET);
  let code = '';
  let version = 0;
  const host = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...files, snippet],
    // files by modification time: a .ts file the snippet imports is edited
    // while the dev server runs
    getScriptVersion: f => (f === snippet ? String(version) : String(ts.sys.getModifiedTime?.(f)?.getTime() ?? 0)),
    getScriptSnapshot: f => {
      const text = f === snippet ? code : ts.sys.readFile(f);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
    fileExists: f => f === snippet || ts.sys.fileExists(f),
    readFile: f => (f === snippet ? code : ts.sys.readFile(f)),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  return {
    snippet,
    service,
    update: text => {
      code = text;
      version++;
    },
  };
}

// TypeScript's kinds to cider's candidate types: functions and methods are
// "function", as clj-suitable has them
const FUNCTION_KINDS = new Set(['function', 'local function', 'method', 'construct', 'call']);
const candidateType = kind => (FUNCTION_KINDS.has(kind) ? 'function'
  : kind === 'class' ? 'class'
  : kind === 'module' ? 'namespace'
  : 'var');

/**
 * Returns complete(request): the completions of a snippet, request
 * {code, position, prefix, details}: the names TypeScript completes at
 * position that start with prefix, [{name, type, signature?, doc?,
 * deprecated?}], the first details of them with their signature and docs.
 * Values (not types or keywords), and none of the snippet's own names
 * (__cljf...). The language service starts on the first request (1-3s with
 * lib.dom), complete returns {error} without TypeScript's JavaScript API.
 */
export function tsCompletions({ root, tsconfig }) {
  let state;
  const start = () => {
    if (state === undefined) {
      const ts = loadTypeScript(root);
      state = ts ? { ts, ...snippetService(ts, root, tsconfig) } : null;
    }
    return state;
  };
  return function complete({ code, position, prefix = '', details = 0 }) {
    const s = start();
    if (!s) return { error: 'no TypeScript 5 or 6 in the project (typescript, or @typescript/typescript6 next to TypeScript 7)' };
    const { ts, service, snippet, update } = s;
    update(code);
    const info = service.getCompletionsAtPosition(snippet, position, {});
    const entries = (info?.entries ?? [])
      .filter(e => e.kind !== 'keyword' && e.kind !== 'warning' && e.kind !== 'type parameter'
        && e.kind !== 'interface' && e.kind !== 'type'
        && e.name.startsWith(prefix) && !e.name.startsWith('__cljf'))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return {
      entries: entries.map((e, i) => {
        const entry = { name: e.name, type: candidateType(e.kind) };
        if (e.kindModifiers?.split(',').includes('deprecated')) entry.deprecated = true;
        if (i < details) {
          const d = service.getCompletionEntryDetails(snippet, position, e.name, undefined, e.source, undefined, e.data);
          if (d) {
            entry.signature = ts.displayPartsToString(d.displayParts);
            const doc = ts.displayPartsToString(d.documentation);
            if (doc) entry.doc = doc;
          }
        }
        return entry;
      }),
    };
  };
}
