// Removes ClojureScript protocol method implementations and other compiler
// generated cljs$ properties never read in a bundle, together with the code
// only they reference, and maps the remaining ones to short names (renamed
// by the minifier).
//
// Bundlers treat every `Type.prototype.cljs$core$ISeq$_first$arity$1 = ...` as
// a side effect, the Closure Compiler removes them per property. Protocols are
// dispatched in one chunk and implemented in others, both passes work on all
// chunks of a bundle at once.
//
// Chunks are parsed (oxc's ESTree) and summarized in worker threads
// (prune-worker.js), propagation runs on all chunks' summaries.

const CLJS_PROP = /^cljs\$/;

function unwrap(node) {
  while (node && node.type === 'ParenthesizedExpression') node = node.expression;
  return node;
}

// `X.P = ...`, `X.prototype.P = ...` or `X.prototype[k] = ...`, returns
// {object: X, prop: P}, prop is null for properties other than cljs$ ones,
// which are live whenever X is.
function propAssignment(stmt) {
  if (stmt.type !== 'ExpressionStatement') return null;
  const e = unwrap(stmt.expression);
  if (!e || e.type !== 'AssignmentExpression' || e.operator !== '=') return null;
  const lhs = e.left;
  if (lhs.type !== 'MemberExpression') return null;
  let obj = lhs.object;
  if (obj.type === 'MemberExpression' && !obj.computed && obj.property.name === 'prototype') obj = obj.object;
  if (obj.type !== 'Identifier') return null;
  const prop = !lhs.computed && CLJS_PROP.test(lhs.property.name) ? lhs.property.name : null;
  return { object: obj.name, prop, lhs, rhs: e.right };
}

// defonce: `if (typeof X !== "undefined") {} else var X = <pure>;`
function defonceDecl(stmt, source) {
  if (stmt.type !== 'IfStatement' || !stmt.alternate) return null;
  const t = unwrap(stmt.test);
  if (t.type !== 'BinaryExpression' || unwrap(t.left).type !== 'UnaryExpression' || unwrap(t.left).operator !== 'typeof') return null;
  const arg = unwrap(t.left).argument;
  if (arg.type !== 'Identifier') return null;
  const cons = stmt.consequent;
  if (!(cons.type === 'BlockStatement' && cons.body.length === 0)) return null;
  let alt = stmt.alternate;
  if (alt.type === 'BlockStatement' && alt.body.length === 1) alt = alt.body[0];
  if (alt.type !== 'VariableDeclaration' || alt.declarations.length !== 1) return null;
  const d = alt.declarations[0];
  if (d.id.type !== 'Identifier' || d.id.name !== arg.name || !isPureInit(d.init, source)) return null;
  return { name: arg.name };
}

function isPureInit(node, source) {
  node = unwrap(node);
  if (!node) return true;
  switch (node.type) {
    case 'CallExpression':
      // /*@__PURE__*/ annotated, i.e. ClojureScript's multi-arity fns
      return /__PURE__\*\/\s*\(?\s*$/.test(source.slice(Math.max(0, node.start - 24), node.start)) &&
        node.arguments.every(a => isPureInit(a, source));
    case 'FunctionExpression': case 'ArrowFunctionExpression': case 'ClassExpression':
    case 'Literal': case 'Identifier': case 'TemplateLiteral':
      return true;
    case 'NewExpression':
      return node.arguments.every(a => isPureInit(a, source));
    case 'ObjectExpression':
      return node.properties.every(p => p.type === 'Property' && !p.computed && isPureInit(p.value, source));
    case 'ArrayExpression':
      return node.elements.every(el => el === null || isPureInit(el, source));
    case 'UnaryExpression':
      return isPureInit(node.argument, source);
    case 'MemberExpression':
      return !node.computed && isPureInit(node.object, source);
    default:
      return false;
  }
}

// Collects identifiers and cljs$ property reads in node.
function collect(node, ids, props) {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n.type !== 'string') continue;
    if (n.type === 'Identifier') ids.add(n.name);
    else if (n.type === 'MemberExpression' && !n.computed && CLJS_PROP.test(n.property.name)) props.add(n.property.name);
    else if (n.type === 'Literal' && typeof n.value === 'string' && CLJS_PROP.test(n.value)) props.add(n.value);
    for (const key in n) {
      if (key === 'start' || key === 'end' || key === 'range' || key === 'loc') continue;
      const v = n[key];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') stack.push(c); }
      else if (v && typeof v.type === 'string') {
        // a property name isn't a reference to the binding of the same name
        if (key === 'property' && n.type === 'MemberExpression' && !n.computed) continue;
        if (key === 'key' && n.type === 'Property' && !n.computed) continue;
        stack.push(v);
      }
    }
  }
}

/**
 * The top-level statements of a chunk (code, its ESTree AST) with what they
 * declare and reference: {start, end, kind, names, object, prop, ids, props},
 * plain data a worker can send.
 */
export function summarize(code, ast) {
  return ast.body.map(node => {
    const s = { start: node.start, end: node.end };
    const ids = new Set(), props = new Set();
    const pa = propAssignment(node);
    const defonce = defonceDecl(node, code);
    if (pa && isPureInit(pa.rhs, code) && (!pa.lhs.computed || isPureInit(pa.lhs.property, code))) {
      s.kind = 'prop'; s.object = pa.object; s.prop = pa.prop;
      collect(pa.rhs, ids, props);
      if (pa.lhs.computed) collect(pa.lhs.property, ids, props);
      ids.add(pa.object);
    } else if (defonce) {
      s.kind = 'decl'; s.names = [defonce.name];
      collect(node, ids, props);
    } else if (node.type === 'VariableDeclaration' && node.declarations.every(d => d.id.type === 'Identifier' && isPureInit(d.init, code))) {
      s.kind = 'decl'; s.names = node.declarations.map(d => d.id.name);
      collect(node, ids, props);
    } else if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
      s.kind = 'decl'; s.names = [node.id.name];
      collect(node, ids, props);
    } else {
      s.kind = 'root';
      collect(node, ids, props);
    }
    s.ids = [...ids]; s.props = [...props];
    return s;
  });
}

// A chunk's statements (summarize) indexed for propagate.
function index(code, summary) {
  const declared = new Set();
  const stmts = summary.map(s => ({ ...s, live: false, ids: new Set(s.ids), props: new Set(s.props) }));
  const byName = new Map(), propsByObject = new Map();
  for (const s of stmts) {
    if (s.kind === 'decl') for (const n of s.names) {
      declared.add(n);
      (byName.get(n) || byName.set(n, []).get(n)).push(s);
    }
    if (s.kind === 'prop') (propsByObject.get(s.object) || propsByObject.set(s.object, []).get(s.object)).push(s);
  }
  return { code, stmts, declared, byName, propsByObject, liveIds: new Set(), work: [] };
}

// Marks what's reachable from a chunk's roots given the cljs$ properties read
// anywhere in the bundle (liveProps, which this adds to). Returns whether
// anything changed.
function propagate(chunk, liveProps) {
  const { stmts, declared, byName, propsByObject, liveIds, work } = chunk;
  const propIsLive = s => (s.prop === null || liveProps.has(s.prop)) &&
    (liveIds.has(s.object) || !declared.has(s.object));
  const markLive = s => { if (!s.live) { s.live = true; work.push(s); } };
  let changed = false;
  if (!chunk.started) {
    chunk.started = true;
    for (const s of stmts) if (s.kind === 'root') markLive(s);
  }
  for (;;) {
    while (work.length) {
      changed = true;
      const s = work.pop();
      for (const id of s.ids) if (!liveIds.has(id)) {
        liveIds.add(id);
        for (const d of byName.get(id) || []) markLive(d);
        for (const p of propsByObject.get(id) || []) if (!p.live && propIsLive(p)) markLive(p);
      }
      for (const p of s.props) liveProps.add(p);
    }
    let more = false;
    for (const s of stmts) if (s.kind === 'prop' && !s.live && propIsLive(s)) { markLive(s); more = true; }
    if (!more) return changed;
  }
}

// Blanks code between start and end, keeping line breaks: positions of the
// rest, i.e. the bundler's source map of the chunk, stay valid.
function blank(code, start, end) {
  return code.slice(start, end).replace(/[^\n\r\u2028\u2029]/g, ' ');
}

/**
 * Prunes the chunks of a bundle, codes is an array of chunk sources,
 * summaries their statements (summarize), returns {codes, removed}. Removed
 * statements are blanked out.
 */
export function pruneChunks(codes, summaries) {
  const chunks = codes.map((code, i) => index(code, summaries[i]));
  const liveProps = new Set();
  // properties read in one chunk keep implementations alive in others
  for (let changed = true; changed;) {
    changed = false;
    for (const chunk of chunks) if (propagate(chunk, liveProps)) changed = true;
  }
  let removed = 0;
  const out = chunks.map(({ code, stmts }) => {
    let result = '', pos = 0;
    for (const s of stmts) {
      if (!s.live) { result += code.slice(pos, s.start) + blank(code, s.start, s.end); pos = s.end; removed++; }
    }
    return result + code.slice(pos);
  });
  return { codes: out, removed };
}

/**
 * Short names for the cljs$ properties (protocol methods, arities, ...) of all
 * chunks of a bundle, most used first: the cache of the minifier's property
 * mangling, one mapping for all chunks minified in parallel. The names are
 * found textually, a superset of the properties (bindings and strings named
 * cljs$... too), names already used as $<letters> are skipped.
 */
export function propertyRenames(codes) {
  const counts = new Map(), taken = new Set();
  for (const code of codes) {
    for (const [name] of code.matchAll(/(?<![\w$])cljs\$[\w$]*/g)) counts.set(name, (counts.get(name) || 0) + 1);
    for (const [name] of code.matchAll(/(?<![\w$])\$[A-Za-z]+(?![\w$])/g)) taken.add(name);
  }
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let i = 0;
  const nextName = () => {
    for (;;) {
      let n = i++, s = '';
      do { s = alphabet[n % alphabet.length] + s; n = Math.floor(n / alphabet.length); } while (n > 0);
      const name = '$' + s;
      if (!taken.has(name)) return name;
    }
  };
  const renames = {};
  for (const [name] of [...counts].sort((a, b) => b[1] - a[1])) renames[name] = nextName();
  return renames;
}
