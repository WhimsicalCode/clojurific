// The shims' declarations (src/main/cljs/cljf/esm/**/*.d.ts: the converted
// shims' script/gen-goog-shims writes from their JSDoc, the others' are hand
// written): they type-check with --strict, type a TypeScript module using the
// shims, which a wrong use fails, and declare the values each shim exports, no
// more, no less. Needs TypeScript 5 or 6, see ts-completions.test.js; skipped
// without.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const esm = fileURLToPath(new URL('../../../cljs/cljf/esm/', import.meta.url));
const ts = (() => {
  try {
    const require = createRequire(process.env.CLJF_TEST_NODE_MODULES
      ? path.resolve(process.env.CLJF_TEST_NODE_MODULES, 'x.js')
      : import.meta.url);
    const ts = require('typescript');
    // TypeScript 7 (the native port) has no JavaScript API
    return ts.ScriptTarget ? ts : null;
  } catch {
    return null;
  }
})();

const user = `
import { parse, Uri, QueryData } from '${esm}goog/Uri.js';
import { XhrIo, EventType, ErrorCode, Jsonp, cookies } from '${esm}goog/net.js';
import { DateTime, Interval, UtcDateTime, Date as GDate } from '${esm}goog/date.js';
import { reader, writer, isKeyword, integer } from '${esm}com/cognitect/transit.js';
import { TaggedValue } from '${esm}com/cognitect/transit/types.js';
import { Long } from '${esm}goog/math.js';
import { typeOf, Uri as UriStub } from '${esm}goog.js';
import { padNumber, StringBuffer } from '${esm}goog/string.js';
import { getKeys } from '${esm}goog/object.js';
import { listen, unlistenByKey, BrowserEvent } from '${esm}goog/events.js';
import { CLICK } from '${esm}goog/events/EventType.js';
import { Sha256, byteArrayToHex } from '${esm}goog/crypt.js';
import { encodeString, Alphabet } from '${esm}goog/crypt/base64.js';
import { format } from '${esm}goog/date/duration.js';

const uri: Uri = parse('https://example.com/a?b=1');
const domain: string = uri.getDomain();
const port: number | null = uri.getPort();
const query: QueryData = uri.getQueryData();
const keys: string[] = query.getKeys();
uri.setDomain('example.org').setPath('/c');

const xhr = new XhrIo();
xhr.setTimeoutInterval(1000);
xhr.listen(EventType.COMPLETE, () => undefined);
const status: number = xhr.getStatus();
const error: ErrorCode = xhr.getLastErrorCode();
XhrIo.send('/x', function () { const text: string = this.getResponseText(); });
new Jsonp('/x').send({ a: 1 });
const none: undefined = cookies;

const date = new DateTime(2026, 10, 27);
date.add(new Interval(Interval.DAYS, 5));
const iso: string = date.toIsoString();
const time: number = new UtcDateTime().getTime();
const base: GDate = date;

const json: string = writer('json').write(reader('json').read('[1]'));
const tagged = new TaggedValue('t', 1);
isKeyword(tagged);
const big = integer('9007199254740993');
if (typeof big !== 'number') { const l: Long = big; }

const sum: string = Long.fromNumber(1).add(Long.getOne()).toString(16);
const kind: 'array' | 'null' | string = typeOf(null);
if (uri instanceof UriStub) { const d: string = uri.getDomain(); }
const padded: string = new StringBuffer('a').append(padNumber(1, 2)).toString();
const keys2: string[] = getKeys({ a: 1 });
const key = listen(document, CLICK, (e) => { const b: BrowserEvent = e; e.preventDefault(); });
unlistenByKey(key);
const sha = new Sha256();
sha.update('abc');
const hex: string = byteArrayToHex(sha.digest());
const b64: string = encodeString('abc', Alphabet.WEBSAFE);
const took: string = format(90060000);

// @ts-expect-error a port isn't a string
const portString: string = uri.getPort();
// @ts-expect-error XhrIo has no such method
xhr.sendAll();
// @ts-expect-error the interval is milliseconds
xhr.setTimeoutInterval('1s');
// @ts-expect-error add takes an Interval
date.add(5);
// @ts-expect-error parse takes a URI
parse();
// @ts-expect-error add takes a Long
Long.getOne().add(1);
// @ts-expect-error not an alphabet
encodeString('abc', 7);
// @ts-expect-error goog.Uri's namespace isn't exported
import { goog } from '${esm}goog/Uri.js';
`;

test('the shims are typed', { skip: ts ? false : 'no TypeScript 5 or 6 (set CLJF_TEST_NODE_MODULES)' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cljf-shim-types-'));
  const file = path.join(dir, 'user.ts');
  fs.writeFileSync(file, user);
  const dts = fs.globSync('**/*.d.ts', { cwd: esm }).map(f => path.join(esm, f));
  assert.ok(dts.length >= 22, dts.join(' '));
  const program = ts.createProgram([file, ...dts], {
    strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program).map(d => {
    const where = d.file ? `${path.relative(d.file.fileName.startsWith(esm) ? esm : dir, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}: ` : '';
    return where + ts.flattenDiagnosticMessageText(d.messageText, '\n');
  });
  assert.deepEqual(diagnostics, []);

  const checker = program.getTypeChecker();
  for (const f of dts) {
    const declared = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(f)))
      .filter(s => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s).flags & ts.SymbolFlags.Value)
      .map(s => s.name).sort();
    // $$set is the build's, see cljf.esm/install-goog-shims
    const exported = Object.keys(await import(f.replace(/\.d\.ts$/, '.js'))).filter(k => k !== '$$set').sort();
    assert.deepEqual(declared, exported, path.relative(esm, f));
  }
});
