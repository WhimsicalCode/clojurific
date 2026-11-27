# Converts transit-js's goog.provide sources into one ES module run against a
# module-local goog wired to clojurific's goog shims.
#   python3 transit2esm.py OUT TRANSIT_JS_ROOT SHIM_IMPORT_PREFIX VERSION
import re, sys

out, root, shim, version = sys.argv[1:]
files = ['com/cognitect/transit/util.js', 'com/cognitect/transit/delimiters.js',
         'com/cognitect/transit/caching.js', 'com/cognitect/transit/eq.js',
         'com/cognitect/transit/types.js', 'com/cognitect/transit/handlers.js',
         'com/cognitect/transit/impl/decoder.js', 'com/cognitect/transit/impl/reader.js',
         'com/cognitect/transit/impl/writer.js', 'com/cognitect/transit.js']
bodies = []
for f in files:
    src = open(f'{root}/{f}').read()
    src = re.sub(r'\A(//.*\n)+\n*', '', src)
    src = re.sub(r'^"use strict";\n', '', src, flags=re.M)
    src = re.sub(r'^goog\.require\("[^"]+"\);\n', '', src, flags=re.M)
    # build-target flags: neither node nor browser globals, no exportSymbol
    src = re.sub(r'^var TRANSIT_(DEV|NODE_TARGET|BROWSER_TARGET|BROWSER_AMD_TARGET) = \w+;\n', '', src, flags=re.M)
    bodies.append(f'// {f}\n\n' + src.strip('\n') + '\n')

prelude = f'''// Copyright 2014 Cognitect. All Rights Reserved.
// Licensed under the Apache License, Version 2.0
//
// transit-js {version} as an ES module, mechanically converted from its sources
// by running them against a module-local goog whose goog.math.Long and
// goog.object are the shims': large integers are cljs.core's goog.math.Long.
// com.cognitect.transit, com.cognitect.transit.types and
// com.cognitect.transit.eq re-export its namespaces' members.

import {{ typeOf }} from '{shim}goog.js';
import {{ Long }} from '{shim}goog/math.js';
import * as object from '{shim}goog/object.js';

const TRANSIT_DEV = false, TRANSIT_NODE_TARGET = false, TRANSIT_BROWSER_TARGET = false;
const com = {{}};
const goog = {{
  global: globalThis,
  typeOf,
  math: {{ Long }},
  object,
  scope(fn) {{ fn.call(globalThis); }},
  provide(name) {{
    const parts = name.split('.');
    let cur = parts[0] === 'com' ? com : goog;
    for (const p of parts.slice(1)) cur = cur[p] ??= {{}};
  }},
  exportSymbol() {{}},
}};
'''
footer = '''
const { transit } = com.cognitect;
const { types, eq } = transit;
export { transit, types, eq };
'''
open(out, 'w').write(prelude + '\n' + '\n'.join(bodies) + footer)
print('ok', len(files))
