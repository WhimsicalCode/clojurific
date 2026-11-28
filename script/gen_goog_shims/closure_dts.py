# Writes TypeScript declarations for a shim converted from goog.provide-style
# sources (closure2esm.py, convert_goog_date.py, transit2esm.py), from the
# Closure JSDoc on its definitions.
#
#   python3 closure_dts.py SHIM.js OUT.d.ts [--loose] [--extern goog.math.Long=../../goog/math.js#Long ...]
#
# A documented function without @return returns void, as the Closure Compiler
# checks; with --loose, for sources it doesn't check (transit-js), any when its
# body returns a value, and undocumented parameters are optional.
# The sources' namespaces become a module-local `declare namespace` tree and
# the shim's exports `export import` its members. Closure types map to their
# TypeScript counterparts; a name the shim doesn't define, a known global or an
# --extern doesn't name becomes any, as do undocumented parameters and values.
# Private members (@private, or a name ending in _) are left out.
import re, sys, bisect

args = sys.argv[1:]
loose = '--loose' in args
args = [a for a in args if a != '--loose']
externs = {}
while '--extern' in args:
    i = args.index('--extern')
    name, target = args[i + 1].split('=')
    externs[name] = target.split('#')
    del args[i:i + 2]
inp, out = args
src = open(inp).read()

# ---- source scanning -------------------------------------------------------

def skip_string(s, i):
    q = s[i]; i += 1
    while s[i] != q:
        i += 2 if s[i] == '\\' else 1
    return i + 1

def match_brace(s, i):
    """Index after the bracket closing the one at s[i], skipping strings,
    comments and regex literals."""
    pairs = {'{': '}', '(': ')', '[': ']'}
    stack, n = [], len(s)
    prev = ''  # last significant character, to tell a regex from a division
    while i < n:
        c = s[i]
        if s.startswith('//', i):
            i = s.index('\n', i); continue
        if s.startswith('/*', i):
            i = s.index('*/', i) + 2; continue
        if c in '"\'`':
            i = skip_string(s, i); prev = 'x'; continue
        if c == '/' and (prev == '' or prev in '(,=:[!&|?{};+-*%<>~^' or
                         re.search(r'\breturn\s*$', s[max(0, i - 10):i])):
            i += 1
            while s[i] != '/':
                if s[i] == '\\': i += 1
                elif s[i] == '[':
                    while s[i] != ']': i += 2 if s[i] == '\\' else 1
                i += 1
            i += 1; prev = 'x'; continue
        if c in pairs:
            stack.append(pairs[c])
        elif c in ')}]':
            assert stack.pop() == c
            if not stack:
                return i + 1
        if not c.isspace():
            prev = c
        i += 1
    raise ValueError('unbalanced')

comments = [(m.start(), m.end(), m.group(1)) for m in re.finditer(r'/\*([\s\S]*?)\*/', src)]
comment_starts = [c[0] for c in comments]
doc_ending_at = {e: t[1:] for _, e, t in comments if t.startswith('*')}

def in_comment(pos):
    k = bisect.bisect_right(comment_starts, pos) - 1
    return k >= 0 and comments[k][1] > pos

# goog.scope aliases (transit-js): `var types = com.cognitect.transit.types, ...;`
# hold until the next goog.scope
scopes = [m.start() for m in re.finditer(r'\bgoog\.scope\(', src)]
alias_decls = []
for m in re.finditer(r'\bvar\s+((?:[\w$]+\s*=\s*(?:goog|com)(?:\.[\w$]+)+\s*,\s*)*[\w$]+\s*=\s*(?:goog|com)(?:\.[\w$]+)+)\s*;', src):
    for a, p in re.findall(r'([\w$]+)\s*=\s*([\w$.]+)', m.group(1)):
        alias_decls.append((m.start(), a, p))

def resolve_alias(path, pos):
    head, _, rest = path.partition('.')
    scope = max([s for s in scopes if s <= pos], default=-1)
    hits = [p for at, a, p in alias_decls if a == head and scope <= at <= pos]
    if hits and head not in ('goog', 'com'):
        return hits[-1] + ('.' + rest if rest else '')
    return path

# ---- JSDoc -----------------------------------------------------------------

def parse_doc(text):
    lines = [re.sub(r'^\s*\*(?!/) ?', '', l) for l in text.split('\n')]
    body = '\n'.join(lines).strip()
    parts = re.split(r'(?:^|(?<=\s))@(\w+)', body)
    doc = {'desc': parts[0].strip(), 'tags': []}
    for tag, rest in zip(parts[1::2], parts[2::2]):
        rest = rest.strip()
        typ = None
        if rest.startswith('{'):
            end = match_brace(rest, 0)
            typ, rest = rest[1:end - 1].strip(), rest[end:].strip()
        doc['tags'].append((tag, typ, rest))
    return doc

def tag(doc, *names):
    return next((t for t in doc['tags'] if t[0] in names), None) if doc else None

def has(doc, *names):
    return tag(doc, *names) is not None

# ---- definitions -----------------------------------------------------------

class Node:
    def __init__(self, path):
        self.path, self.children, self.decl = path, {}, None

root = Node('')
def node(path, create=True):
    n = root
    for part in path.split('.'):
        if part not in n.children:
            if not create: return None
            n.children[part] = Node((n.path + '.' if n.path else '') + part)
        n = n.children[part]
    return n

classes = {}  # path -> {'doc', 'params', 'members': {name: decl}, 'pos'}
spans = []    # (start, end, class path) of constructor and method bodies

def private(name, doc):
    return name.endswith('_') or has(doc, 'private')

def rhs_info(pos):
    """What an assignment's right hand side at pos is: function parameters and
    body span, an object literal's span, or a value expression."""
    m = re.match(r'\s*function\b\s*[\w$]*\s*\(', src[pos:])
    if m:
        open_paren = pos + m.end() - 1
        close = match_brace(src, open_paren)
        body = src.index('{', close)
        return {'kind': 'fn', 'params': src[open_paren + 1:close - 1],
                'body': (body, match_brace(src, body))}
    m = re.match(r'\s*\{', src[pos:])
    if m:
        start = pos + m.end() - 1
        return {'kind': 'obj', 'span': (start, match_brace(src, start))}
    m = re.match(r'\s*([^;\n]*)', src[pos:])
    return {'kind': 'value', 'expr': m.group(1).strip()}

for m in re.finditer(r'^[ \t]*(goog\.provide\([\'"]([\w.]+)[\'"]\)|((?:this|[A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)+)\s*(=(?!=)|;))', src, re.M):
    if in_comment(m.start()):
        continue
    if m.group(2):
        node(m.group(2))
        continue
    path, pos = resolve_alias(m.group(3), m.start()), m.start(3)
    before = src[:m.start()].rstrip()
    doc = parse_doc(doc_ending_at[len(before)]) if len(before) in doc_ending_at else None
    rhs = rhs_info(m.end()) if m.group(4) == '=' else {'kind': 'decl'}
    if path.startswith('this.'):
        owners = [s for s in spans if s[0] <= pos < s[1]]
        name = path[5:]
        if not owners or '.' in name or private(name, doc):
            continue
        cls = classes[owners[-1][2]]
        if owners[-1][3] or doc:  # fields: any in constructors, documented ones in methods
            cls['members'].setdefault(name, {'kind': 'field', 'doc': doc, 'rhs': rhs, 'pos': pos})
        continue
    if not path.startswith(('goog.', 'com.')):
        continue
    if '.prototype.' in path:
        owner, name = path.split('.prototype.')
        if '.' in name or private(name, doc) or owner not in classes:
            continue
        member = {'kind': 'method' if rhs['kind'] == 'fn' or has(doc, 'param', 'return', 'returns') and not has(doc, 'type') else 'field',
                  'doc': doc, 'rhs': rhs, 'pos': pos}
        classes[owner]['members'].setdefault(name, member)
        if rhs['kind'] == 'fn':
            spans.append((*rhs['body'], owner, False))
        continue
    if any(private(part, doc if part == path.split('.')[-1] else None) for part in path.split('.')):
        continue
    n = node(path)
    if n.decl:  # a later reassignment, such as a fallback in an else branch
        continue
    if has(doc, 'constructor', 'interface', 'record'):
        classes[path] = {'doc': doc, 'params': rhs.get('params', ''), 'members': {}, 'pos': pos}
        n.decl = {'kind': 'class', 'doc': doc, 'pos': pos}
        if rhs['kind'] == 'fn':
            spans.append((*rhs['body'], path, True))
    else:
        n.decl = {'kind': rhs['kind'], 'doc': doc, 'rhs': rhs, 'pos': pos}

# ---- Closure types to TypeScript -------------------------------------------

# global types and how many type arguments they take; None for those that are any
GLOBALS = {
    'Array': 1, 'ArrayBuffer': 0, 'ArrayBufferView': 0, 'Arguments': 0, 'BigInt': 0, 'Blob': 0,
    'Boolean': 0, 'DataView': 0, 'Date': 0, 'Document': 0, 'Element': 0, 'Error': 0, 'Event': 0,
    'EventTarget': 0, 'FormData': 0, 'Function': 0, 'Headers': 0, 'IArrayLike': 1, 'IThenable': 1,
    'Iterable': 1, 'Iterator': 1, 'Location': 0, 'Map': 2, 'Node': 0, 'Number': 0, 'Object': None,
    'ProgressEvent': 0, 'Promise': 1, 'ReadableStream': 1, 'RegExp': 0, 'Response': 0, 'Set': 1,
    'Storage': 0, 'String': 0, 'Symbol': 0, 'URLSearchParams': 0, 'Uint8Array': 0, 'Window': 0,
    'XMLHttpRequest': 0, 'ActiveXObject': None, 'Buffer': None,
}
RENAMES = {'IArrayLike': 'ArrayLike', 'IThenable': 'PromiseLike', 'Arguments': 'IArguments'}
PRIMS = {'string', 'number', 'boolean', 'undefined', 'null', 'void', 'symbol', 'bigint'}
TOKEN = re.compile(r'\s*(\.\.\.|\.<|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|"[^"]*"|\'[^\']*\'|-?\d+|\S)')
unknown = {}
leaf_names = set()

def templates_of(doc):
    t = tag(doc, 'template')
    return [n.strip() for n in re.split(r'\s*:=', t[2])[0].split(',')] if t else []

def class_templates(path):
    return templates_of(classes[path]['doc']) if path in classes else []

def global_ref(name):
    name = RENAMES.get(name, name)
    return '$' + name if name in leaf_names else name

class TypeParser:
    def __init__(self, text, pos, tmpl):
        self.toks, self.i, self.pos, self.tmpl = [t for t in TOKEN.findall(text)], 0, pos, tmpl

    def peek(self, k=0):
        return self.toks[self.i + k] if self.i + k < len(self.toks) else None

    def next(self):
        t = self.peek(); self.i += 1; return t

    def expect(self, t):
        got = self.next()
        assert got == t, f'expected {t}, got {got} in {" ".join(self.toks)}'

    def starts_type(self):
        t = self.peek()
        return t is not None and (t in '({*!?' or t[0].isalpha() or t[0] in '$"\'' or t == '...')

    def top(self):
        """A parameter's type: (ts, optional, rest)."""
        if self.peek() == '...':
            self.next()
            return (self.union() if self.starts_type() else 'any'), False, True
        t = self.union()
        opt = self.peek() == '='
        if opt: self.next()
        assert self.peek() is None, f'trailing {self.toks[self.i:]}'
        return t, opt, False

    def union(self):
        parts = [self.unary()]
        while self.peek() == '|':
            self.next(); parts.append(self.unary())
        if 'any' in parts:
            return 'any'
        return ' | '.join(dict.fromkeys(parts))

    def unary(self):
        t = self.peek()
        if t == '?':
            self.next()
            if self.starts_type() and self.peek() != '=':
                inner = self.unary()
                return inner if inner in ('any', 'null') else f'{inner} | null'
            return 'any'
        if t == '!':
            self.next(); return self.unary()
        r = self.primary()
        if self.peek() == '?' and self.peek(1) in (None, ',', ')', '|', '>', '}', '='):
            self.next(); r = f'{r} | null'
        return r

    def args(self):
        out = []
        if self.peek() in ('<', '.<'):
            self.next()
            out.append(self.union())
            while self.peek() == ',':
                self.next(); out.append(self.union())
            self.expect('>')
        return out

    def primary(self):
        t = self.next()
        if t == '(':
            r = self.union(); self.expect(')')
            return f'({r})' if '|' in r else r
        if t == '*':
            return 'any'
        if t == '{':
            fields = []
            while self.peek() != '}':
                key = self.next().strip('"\'')
                if self.peek() == ':':
                    self.next(); fields.append(f'{key}: {self.union()}')
                else:
                    fields.append(f'{key}: any')
                if self.peek() == ',': self.next()
            self.next()
            return '{ ' + '; '.join(fields) + ' }' if fields else '{}'
        if t == 'function':
            self.expect('(')
            params, this, ctor, k = [], None, None, 0
            while self.peek() != ')':
                if self.peek() in ('this', 'new') and self.peek(1) == ':':
                    which = self.next(); self.next()
                    if which == 'this': this = self.union()
                    else: ctor = self.union()
                elif self.peek() == '...':
                    self.next()
                    params.append(f'...p{k}: Array<{self.union() if self.starts_type() else "any"}>')
                else:
                    pt = self.union()
                    opt = self.peek() == '='
                    if opt: self.next()
                    params.append(f'p{k}{"?" if opt else ""}: {pt}')
                k += 1
                if self.peek() == ',': self.next()
            self.next()
            ret = 'any'
            if self.peek() == ':':
                self.next(); ret = self.union()
            if this:
                params.insert(0, f'this: {this}')
            return f'({"new " if ctor else ""}({", ".join(params)}) => {ctor or ret})'
        if t[0] in '"\'' or t[0].isdigit() or t[0] == '-':
            return t
        args = self.args()
        return self.name(t, args)

    def name(self, t, args):
        if t in PRIMS:
            return t
        if t in self.tmpl:
            return t
        path = resolve_alias(t, self.pos)
        if path in externs:
            return '$' + path.replace('.', '_')
        n = node(path, create=False)
        if n and n.decl and (n.decl['kind'] == 'class' or has(n.decl['doc'], 'typedef', 'enum')):
            want = len(class_templates(path))
            return path + (f'<{", ".join(args[:want])}>' if args and want else '')
        if t == 'Object':
            return f'Record<{args[0]}, {args[1]}>' if len(args) == 2 else 'any'
        if t in GLOBALS and GLOBALS[t] is not None:
            want = GLOBALS[t]
            args = (args + ['any'] * want)[:want]
            return global_ref(t) + (f'<{", ".join(args)}>' if args else '')
        unknown[t] = unknown.get(t, 0) + 1
        return 'any'

def ts_type(text, pos, tmpl):
    return TypeParser(text, pos, tmpl).union()

# ---- emitting --------------------------------------------------------------

RESERVED = set('break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with'.split())

def doc_comment(doc, indent):
    if not doc:
        return ''
    lines = [l for l in doc['desc'].split('\n')] if doc['desc'] else []
    for tg, _, rest in doc['tags']:
        if tg == 'param' and rest:
            lines.append('@param ' + rest)
        elif tg in ('return', 'returns') and rest:
            lines.append('@returns ' + rest)
        elif tg == 'deprecated':
            lines.append(('@deprecated ' + rest).strip())
    lines = [l.replace('*/', '*\\/').rstrip() for l in '\n'.join(lines).strip().split('\n')]
    if not any(lines):
        return ''
    return f'{indent}/**\n' + ''.join(f'{indent} *{" " if l else ""}{l}\n' for l in lines) + f'{indent} */\n'

def signature(params_src, doc, pos, tmpl, ctor=False):
    tmpl = tmpl + templates_of(doc)
    given = {t[2].split()[0].lstrip('.'): t[1] for t in doc['tags'] if t[0] == 'param' and t[1] and t[2]} if doc else {}
    names = [p.strip() for p in re.sub(r'/\*[\s\S]*?\*/', '', params_src).split(',') if p.strip()]
    out, optional = [], False
    for p in names:
        rest = p.startswith('...')
        p = p.lstrip('.').split('=')[0].strip()
        if p in given:
            t, opt, r = TypeParser(given[p], pos, tmpl).top()
            rest = rest or r
        else:
            t, opt = 'any', optional or loose
        optional = optional or opt
        out.append(f'...{p}: Array<{t}>' if rest else f'{p}{"?" if opt or optional else ""}: {t}')
    this = tag(doc, 'this')
    if this:
        out.insert(0, f'this: {ts_type(this[1], pos, tmpl)}')
    gen = f'<{", ".join(templates_of(doc))}>' if templates_of(doc) else ''
    if ctor:
        return f'({", ".join(out)})'
    ret = tag(doc, 'return', 'returns')
    return f'{gen}({", ".join(out)}): {ts_type(ret[1], pos, tmpl) if ret else "any"}'

def returns(rhs):
    body = src[rhs['body'][0]:rhs['body'][1]] if rhs.get('body') else ''
    return re.search(r'\breturn\s+[^\s;]', body) is not None

def fn_signature(doc, rhs, pos, tmpl):
    if doc and not tag(doc, 'return', 'returns') and not (loose and rhs.get('body') and returns(rhs)):
        doc = dict(doc, tags=doc['tags'] + [('return', 'void', '')])
    return signature(rhs.get('params', ''), doc, pos, tmpl)

def value_type(decl, pos, tmpl):
    doc, rhs = decl['doc'], decl.get('rhs', {})
    t = next((t for t in doc['tags'] if t[1] and t[0] in ('type', 'const', 'define', 'protected', 'package', 'public', 'export')), None) if doc else None
    if t:
        return ts_type(t[1], pos, tmpl)
    expr = rhs.get('expr', '')
    if re.fullmatch(r'"[^"]*"|\'[^\']*\'', expr): return 'string'
    if re.fullmatch(r'-?[\d.]+(e\d+)?|0x[\da-fA-F]+', expr): return 'number'
    if expr in ('true', 'false'): return 'boolean'
    m = re.match(r'new\s+([\w$.]+)', expr)
    if m:
        return TypeParser(m.group(1), pos, tmpl).union()
    return 'any'

def enum_members(decl, pos):
    start, end = decl['rhs']['span']
    body = re.sub(r'/\*[\s\S]*?\*/|//.*', '', src[start + 1:end - 1])
    base = tag(decl['doc'], 'enum')[1] or 'number'
    members = []
    for entry in re.findall(r'([\w$]+|\'[^\']*\'|"[^"]*")\s*:\s*([^,]+)', body):
        key, val = entry[0].strip('\'"'), entry[1].strip()
        literal = re.fullmatch(r'"[^"]*"|\'[^\']*\'|-?\d+', val)
        members.append((key, val if literal else ts_type(base, pos, [])))
    return members, ts_type(base, pos, [])

def supertypes(cls_path):
    doc = classes[cls_path]['doc']
    for t in doc['tags']:
        if t[0] in ('extends', 'implements') and t[1]:
            sup = resolve_alias(re.sub(r'^[!?]|\.?<.*', '', t[1].strip()), classes[cls_path]['pos'])
            if sup in classes:
                yield sup
                yield from supertypes(sup)

def inherited(cls_path, name, m):
    """An @override's member without types of its own is its supertype's."""
    if not has(m['doc'], 'override', 'inheritDoc') or has(m['doc'], 'param', 'return', 'returns', 'type'):
        return m
    return next((classes[sup]['members'][name] for sup in supertypes(cls_path)
                 if name in classes[sup]['members']), m)

def member_lines(cls_path, indent):
    cls, out = classes[cls_path], []
    tmpl = class_templates(cls_path)
    interface = has(cls['doc'], 'interface', 'record')
    for name, m in cls['members'].items():
        m = inherited(cls_path, name, m)
        doc, rhs = m['doc'], m['rhs']
        pos = m['pos']
        key = name if re.fullmatch(r'[A-Za-z_$][\w$]*', name) else repr(name)
        prot = 'protected ' if has(doc, 'protected') and not interface else ''
        if m['kind'] == 'method' and (rhs['kind'] == 'fn' or doc):
            out.append(doc_comment(doc, indent) + f'{indent}{prot}{key}{fn_signature(doc, rhs, pos, tmpl)};\n')
        else:
            t = value_type(m, pos, tmpl)
            ro = 'readonly ' if has(doc, 'const') else ''
            out.append(doc_comment(doc, indent) + f'{indent}{prot}{ro}{key}: {t};\n')
    return ''.join(out)

def heritage(cls_path, interface):
    doc, tmpl, pos = classes[cls_path]['doc'], class_templates(cls_path), classes[cls_path]['pos']
    ext = [ts_type(t[1], pos, tmpl) for t in doc['tags'] if t[0] == 'extends' and t[1]]
    ext = [e for e in ext if e != 'any']
    impl = [ts_type(t[1], pos, tmpl) for t in doc['tags'] if t[0] == 'implements' and t[1]]
    impl = [i for i in impl if i != 'any']
    s = ''
    if interface and ext + impl:
        s += ' extends ' + ', '.join(ext + impl)
    elif ext:
        s += ' extends ' + ext[0]
    if not interface and impl:
        s += ' implements ' + ', '.join(impl)
    return s

def emit(n, indent):
    out = []
    for name, child in n.children.items():
        d = child.decl
        pos = d['pos'] if d else 0
        kind = d and d['kind']
        doc = d and d['doc']
        safe = name not in RESERVED
        if kind == 'class':
            interface = has(doc, 'interface', 'record')
            tmpl = class_templates(child.path)
            gen = f'<{", ".join(t + " = any" for t in tmpl)}>' if tmpl else ''
            body = member_lines(child.path, indent + '  ')
            if interface:
                out.append(doc_comment(doc, indent) + f'{indent}export interface {name}{gen}{heritage(child.path, True)} {{\n{body}{indent}}}\n')
            else:
                params = classes[child.path]['params']
                ctor = f'{indent}  constructor{signature(params, doc, pos, tmpl, ctor=True)};\n'
                out.append(doc_comment(doc, indent) + f'{indent}export class {name}{gen}{heritage(child.path, False)} {{\n{ctor}{body}{indent}}}\n')
        elif kind and has(doc, 'typedef'):
            out.append(doc_comment(doc, indent) + f'{indent}export type {name} = {ts_type(tag(doc, "typedef")[1], pos, [])};\n')
        elif kind == 'obj' and has(doc, 'enum'):
            members, base = enum_members(d, pos)
            values = [v for _, v in members]
            vtype = ' | '.join(dict.fromkeys(values)) if all(re.fullmatch(r'"[^"]*"|\'[^\']*\'|-?\d+', v) for v in values) else base
            fields = ''.join(f'{indent}  export const {k}: {v};\n' for k, v in members)
            for k, _ in members:
                child.children.pop(k, None)  # members' own definitions
            statics = emit(child, indent + '  ')
            out.append(doc_comment(doc, indent) + f'{indent}export type {name} = {vtype};\n{indent}export namespace {name} {{\n{fields}{statics}{indent}}}\n')
            continue
        elif kind == 'fn' and safe:
            out.append(doc_comment(doc, indent) + f'{indent}export function {name}{fn_signature(doc, d["rhs"], pos, [])};\n')
        elif kind and safe and not child.children:
            t = value_type(d, pos, [])
            const = 'const' if has(doc, 'const', 'define') or re.fullmatch(r'[A-Z][A-Z\d_]*', name) else 'let'
            out.append(doc_comment(doc, indent) + f'{indent}export {const} {name}: {t};\n')
        if child.children:
            inner = emit(child, indent + '  ')
            if inner:
                out.append(f'{indent}export namespace {name} {{\n{inner}{indent}}}\n')
    return ''.join(out)

# exports: `let X$ = a.b;`, `let { X: X$, } = a.b;` and `const { a, b } = c.d;`,
# then `export { X$ as X, a }`
bindings = {}
for m in re.finditer(r'^(?:let|const) (\w+\$|\{[^}]*\}) = ([\w$.]+);', src, re.M):
    base = m.group(2)
    base = bindings.get(base.split('.')[0], base.split('.')[0]) + base[len(base.split('.')[0]):]
    if m.group(1).startswith('{'):
        for entry in re.findall(r'(\w+)(?:\s*:\s*(\w+\$?))?', m.group(1)[1:-1]):
            bindings[entry[1] or entry[0]] = f'{base}.{entry[0]}'
    else:
        bindings[m.group(1)] = base
exports = []
for block in re.findall(r'^export \{([^}]*)\};', src, re.M):
    for local, name in re.findall(r'(\w+\$?)(?:\s+as\s+(\w+))?', block):
        exports.append((name or local, bindings[local]))

def all_paths(n):
    for c in n.children.values():
        yield c.path; yield from all_paths(c)
leaf_names = {p.split('.')[-1] for p in all_paths(root)}

namespaces = ''.join(f'declare namespace {r} {{\n{emit(c, "  ")}}}\n' for r, c in root.children.items())
heads = ''.join(f"import type {{ {exp} as ${name.replace('.', '_')} }} from '{mod}';\n"
                for name, (mod, exp) in externs.items())
renamed = {RENAMES.get(g, g) for g in GLOBALS}
heads += ''.join(f'type ${g} = {g};\n' for g in sorted(set(re.findall(r'\$(\w+)', namespaces)) & renamed))
text = (f'// Generated by script/gen_goog_shims/closure_dts.py from the Closure JSDoc in\n'
        f'// {inp.split("/")[-1]}; regenerate with script/gen-goog-shims.\n\n' + heads + namespaces + '\n' +
        ''.join(f'export import {name} = {path};\n' if node(path, create=False) else
                f'/** {path} is undefined. */\nexport declare const {name}: undefined;\n' for name, path in exports))
open(out, 'w').write(text)
print('ok', out, len(exports), 'exports;', 'any for', ', '.join(f'{k}({v})' for k, v in sorted(unknown.items())) or 'nothing')
