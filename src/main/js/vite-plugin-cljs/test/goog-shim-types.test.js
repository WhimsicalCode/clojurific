// The declarations of the shims converted from the Closure Library's and
// transit-js' sources (src/main/cljs/cljf/esm/**/*.d.ts, which
// script/gen-goog-shims writes from their JSDoc): they type-check with
// --strict, and type a TypeScript module using the shims, which a wrong use
// fails. Needs TypeScript 5 or 6, see ts-completions.test.js; skipped without.
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
    return require('typescript');
  } catch {
    return null;
  }
})();

const user = `
import { parse, Uri, QueryData } from '${esm}goog/Uri.js';
import { XhrIo, EventType, ErrorCode, Jsonp, cookies } from '${esm}goog/net.js';
import { DateTime, Interval, UtcDateTime, Date as GDate } from '${esm}goog/date.js';
import { reader, writer, isKeyword } from '${esm}com/cognitect/transit.js';
import { TaggedValue } from '${esm}com/cognitect/transit/types.js';

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
`;

test('the converted shims are typed', { skip: ts ? false : 'no typescript (set CLJF_TEST_NODE_MODULES)' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cljf-shim-types-'));
  const file = path.join(dir, 'user.ts');
  fs.writeFileSync(file, user);
  const dts = fs.globSync('**/*.d.ts', { cwd: esm }).map(f => path.join(esm, f));
  assert.ok(dts.length >= 7, dts.join(' '));
  const program = ts.createProgram([file, ...dts], {
    strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program).map(d => {
    const where = d.file ? `${path.relative(d.file.fileName.startsWith(esm) ? esm : dir, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}: ` : '';
    return where + ts.flattenDiagnosticMessageText(d.messageText, '\n');
  });
  assert.deepEqual(diagnostics, []);
});
