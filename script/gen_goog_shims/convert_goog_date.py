# Converts Closure Library's goog/date/date.js and utcdatetime.js into the
# goog.date shim (cljf/esm/goog/date.js): the sources run unchanged against a
# module-local goog object holding what they use.
#   python3 convert_goog_date.py CLOSURE_LIBRARY_ROOT OUT
import re, sys
cl, out = sys.argv[1], sys.argv[2]
def body(path):
    src = open(path).read()
    # drop the license header (restated once below), provides and requires
    src = re.sub(r"^goog\.(provide|require|requireType)\('[^']+'\);\n", '', src, flags=re.M)
    return src[src.index('*/') + 2:].lstrip('\n') if src.startswith('/**') else src
date, utc = body(f'{cl}/goog/date/date.js'), body(f'{cl}/goog/date/utcdatetime.js')
known = {'goog.string.padNumber', 'goog.string.trim', 'goog.asserts.assert', 'goog.asserts.assertNumber', 'goog.i18n.DateTimeSymbols.FIRSTDAYOFWEEK', 'goog.i18n.DateTimeSymbols.FIRSTWEEKCUTOFFDAY', 'goog.now', 'goog.isObject', 'goog.inherits'}
# names only in comments (@param types, @see) don't matter; any other is unhandled
code_refs = set(re.findall(r'\bgoog\.(?!date\b)[\w.]+', re.sub(r'/\*[\s\S]*?\*/|//.*', '', date + utc)))
assert code_refs <= known, code_refs - known
names = sorted(set(re.findall(r'^goog\.date\.([A-Za-z]\w*) = ', date + utc, re.M)))
header = '''// Copyright The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// goog.date, goog.date.Date, goog.date.DateTime, goog.date.Interval and
// goog.date.UtcDateTime as an ES module, mechanically converted from the
// Closure Library sources (date.js, utcdatetime.js) by running them against a
// module-local goog. The week settings are the en locale's, goog.LOCALE's
// default, which the Closure Library's goog.i18n.DateTimeSymbols picks: the
// Closure Library loaded all locales' symbols for these two numbers.

import { padNumber, trim } from './string.js';
import { isObject } from '../goog.js';

function assert(condition, opt_message) {
  if (!condition) throw new Error('Assertion failed' + (opt_message ? ': ' + opt_message : ''));
  return condition;
}

// goog.inherits: Closure Library classes are constructor functions, which
// subclasses and protocol extensions (cljs-time) use as they are
function inherits(childCtor, parentCtor) {
  childCtor.superClass_ = parentCtor.prototype;
  childCtor.prototype = Object.create(parentCtor.prototype);
  childCtor.prototype.constructor = childCtor;
  childCtor.base = function(me, methodName, ...args) {
    return parentCtor.prototype[methodName].apply(me, args);
  };
}

const goog = {
  date: {},
  string: { padNumber, trim },
  asserts: { assert, assertNumber: (value) => assert(typeof value === 'number', 'Expected number') && value },
  i18n: { DateTimeSymbols: { FIRSTDAYOFWEEK: 6, FIRSTWEEKCUTOFFDAY: 5 } },
  now: () => Date.now(),
  isObject,
  inherits,
};

'''
exports = [n for n in names if not n.endswith('_')]
footer = '\nlet {\n' + ''.join(f'  {n}: {n}$,\n' for n in exports) + '} = goog.date;\n\n// goog.date.Date isn\'t a local binding: the sources use the global Date\nexport {\n' + ''.join(f'  {n}$ as {n},\n' for n in exports) + '};\n'
open(out, 'w').write(header + date.rstrip('\n') + '\n\n' + utc.rstrip('\n') + '\n' + footer)
print(len(exports), 'exports:', ' '.join(exports))
