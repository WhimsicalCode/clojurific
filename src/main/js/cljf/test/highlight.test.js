import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import readline from 'node:readline';
import { test } from 'node:test';
import { highlight, highlightInput, tokenize } from '../highlight.js';

const types = code => tokenize(code).map(({ type, start, end }) => [type, code.slice(start, end)]);
const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '');

test('tokenize', () => {
  assert.deepEqual(types('(defn f [x] (str "a\\"b" :k ::k/x 1.5 -2 \\a \\newline nil true #"\\d+") ; done'), [
    ['special', 'defn'], ['string', '"a\\"b"'], ['keyword', ':k'], ['keyword', '::k/x'], ['number', '1.5'],
    ['number', '-2'], ['character', '\\a'], ['character', '\\newline'], ['constant', 'nil'], ['constant', 'true'],
    ['regex', '#"\\d+"'], ['comment', '; done'],
  ]);
  // special forms only in call position
  assert.deepEqual(types('(let [if 1] if)'), [['special', 'let'], ['number', '1']]);
  assert.deepEqual(types('#(when % 1)'), [['special', 'when'], ['number', '1']]);
  // symbols with digits and signs aren't numbers
  assert.deepEqual(types('(+ a1 -x ##Inf)'), [['number', '##Inf']]);
  assert.deepEqual(types('\\( \\)'), [['character', '\\('], ['character', '\\)']]);
  // open strings run to the end, unmatched closing brackets stand out
  assert.deepEqual(types('"abc'), [['string', '"abc']]);
  assert.deepEqual(types('a))'), [['unmatched', ')'], ['unmatched', ')']]);
});

test('highlight', () => {
  assert.equal(highlight('(f :a)'), '(f \x1b[36m:a\x1b[39m)');
  // the line after context opening a string
  assert.equal(highlight('(f "ab\ncd" 1)', 7), '\x1b[32mcd"\x1b[39m \x1b[35m1\x1b[39m)');
  assert.equal(plain(highlight('(defn f [] "x")')), '(defn f [] "x")');
});

test('highlightInput redraws the line highlighted as it\'s typed', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  output.columns = 80;
  let out = '';
  output.on('data', d => (out += d));
  const rl = readline.createInterface({ input, output, terminal: true });
  assert.ok(highlightInput(rl, () => ''));
  rl.setPrompt('> ');
  rl.prompt();
  const line = new Promise(resolve => rl.once('line', resolve));
  input.write('(str :a');
  input.write('\x1b[D');
  input.write('b\r');
  assert.equal(await line, '(str :ba');
  rl.close();
  // the last redraw before Enter
  const redraws = out.split('\x1b[0J');
  assert.match(redraws.at(-1), /^> \(str \x1b\[36m:ba\x1b\[39m/);
  assert.equal(plain(out).includes(':ba'), true);
});

test('highlightInput without readline\'s internals', () => {
  assert.equal(highlightInput({}), false);
});
