// Pruning (prune.js) of a chunk's statements, by the JavaScript summarizer and,
// when built (script/build-native-prune), the native one. Needs Rolldown's oxc
// parser (rolldown/utils, as the plugin resolves it from the project), from
// CLJF_TEST_NODE_MODULES (script/test-launcher's project) or above this
// directory; skipped without, failed when CLJF_TEST_NODE_MODULES has none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { pruneChunks, summarize } from '../prune.js';

const require = createRequire(process.env.CLJF_TEST_NODE_MODULES
  ? path.resolve(process.env.CLJF_TEST_NODE_MODULES, 'x.js')
  : import.meta.url);
const oxc = await (async () => {
  try {
    // from Vite's install, as the plugin resolves it (index.js resolveFromProject)
    const vite = createRequire(require.resolve('vite'));
    return await import(pathToFileURL(vite.resolve('rolldown/utils')).href);
  } catch (e) {
    if (process.env.CLJF_TEST_NODE_MODULES) throw e;
    return null;
  }
})();
const native = (() => {
  try {
    return createRequire(import.meta.url)(`../native/cljf-prune.${process.platform}-${process.arch}.node`);
  } catch {
    return null;
  }
})();

// The native summaries as prune.js' (index.js decodeSummary).
function decode({ strings, statements: a }) {
  const out = [];
  let i = 0;
  const list = () => {
    const r = [];
    for (let n = a[i++]; n > 0; n--) r.push(strings[a[i++]]);
    return r;
  };
  while (i < a.length) {
    const s = { start: a[i++], end: a[i++], kind: ['root', 'decl', 'prop'][a[i++]] };
    const object = a[i++], prop = a[i++], names = list();
    if (s.kind === 'prop') { s.object = strings[object]; s.prop = prop === 0xFFFFFFFF ? null : strings[prop]; }
    if (s.kind === 'decl') s.names = names;
    s.ids = list();
    s.props = list();
    out.push(s);
  }
  return out;
}

const summarizers = [
  ['JavaScript', code => summarize(code, oxc.parseSync('chunk.js', code, { sourceType: 'module', lang: 'js' }).program), !oxc],
  ...(native ? [['native', code => decode(native.summarizeChunks([code])[0]), false]] : []),
];

// The statements left of code, without the blanked out ones.
function kept(code, summarizer) {
  return pruneChunks([code], [summarizer(code)]).codes[0].split('\n').map(l => l.trim()).filter(Boolean);
}

for (const [name, summarizer, skip] of summarizers) {
  test(`${name}: a property set through a binding of an existing value is kept`, { skip }, () => {
    // uni.core.time's (let [^js p (.-prototype goog.date.Date)] (set! (.-toJSON p) ...)) at top level
    const code = [
      'import * as goog$date from "./goog/date.js";',
      'const date_1 = goog$date.Date.prototype;',
      'const date_time_2 = (goog$date.DateTime).prototype;',
      '(date_1.toJSON = (function () { return 1; }));',
      '(date_time_2.toJSON = (function () { return 2; }));',
    ].join('\n');
    assert.deepEqual(kept(code, summarizer), code.split('\n'));
  });

  test(`${name}: a cljs$ property set through a binding doesn't keep other types' implementations`, { skip }, () => {
    const code = [
      'export function A() {}',
      'export function B() {}',
      'const p = A.prototype;',
      'p.cljs$core$IFoo$_foo$arity$1 = (function () { return 1; });',
      'B.prototype.cljs$core$IFoo$_foo$arity$1 = (function () { return 2; });',
    ].join('\n');
    assert.deepEqual(kept(code, summarizer), code.split('\n').slice(0, 4));
  });

  test(`${name}: an unused object's properties and unused cljs$ implementations still go`, { skip }, () => {
    const code = [
      'const unused = {};',
      'unused.x = (function () { return 1; });',
      'const alias = Foo;',
      'export function Foo() {}',
      'Foo.prototype.cljs$core$IFoo$_foo$arity$1 = (function () { return 1; });',
      'Foo.prototype.toString = (function () { return "foo"; });',
    ].join('\n');
    assert.deepEqual(kept(code, summarizer), [
      'export function Foo() {}',
      'Foo.prototype.toString = (function () { return "foo"; });',
    ]);
  });
}
