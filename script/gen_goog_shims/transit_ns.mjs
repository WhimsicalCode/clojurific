// Writes the com.cognitect.transit{,.types,.eq} shims re-exporting transit-js.js' namespaces,
// and their .d.ts
//   node transit_ns.mjs ABSOLUTE_DIR_OF_TRANSIT_JS_JS
import { writeFileSync } from 'node:fs';
const dir = process.argv[2];
const m = await import(dir + '/transit-js.js');
const skip = new Set(['util', 'delimiters', 'caching', 'eq', 'types', 'handlers', 'impl']);
for (const [ns, file, key, from] of [['com.cognitect.transit', 'transit.js', 'transit', './transit-js.js'],
  ['com.cognitect.transit.types', 'transit/types.js', 'types', '../transit-js.js'],
  ['com.cognitect.transit.eq', 'transit/eq.js', 'eq', '../transit-js.js']]) {
  const names = Object.keys(m[key]).filter((k) => key != 'transit' || !skip.has(k));
  writeFileSync(dir + '/' + file, `// ${ns}, see transit-js.js\n\nimport { ${key} as $ } from '${from}';\n\n` +
    names.map((n) => `export let ${n} = $.${n};\n`).join(''));
  writeFileSync(dir + '/' + file.replace(/\.js$/, '.d.ts'), `// ${ns}, see transit-js.d.ts\n\nimport { ${key} as $ } from '${from}';\n\n` +
    names.map((n) => `export import ${n} = $.${n};\n`).join(''));
}
