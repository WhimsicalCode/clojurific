# Converts goog.provide-style Closure Library files into one ES module: the
# sources run unchanged against a module-local goog that the prelude defines
# (goog.provide creating the namespaces, plus the helpers they use).
#
#   python3 closure2esm.py OUT CLOSURE_ROOT PRELUDE.js EXPORTS FILE... [--post POSTLUDE.js]
#
# EXPORTS is a comma-separated list of name=goog.path, exported as name. The
# prelude's `// provides:` line lists the goog names it defines; any other
# goog name the sources use fails the conversion.
import re, sys

args = sys.argv[1:]
post = ''
if '--post' in args:
    i = args.index('--post')
    post = open(args[i + 1]).read().strip('\n') + '\n'
    del args[i:i + 2]
out, root, prelude_path, exports_spec, *files = args
prelude = open(prelude_path).read()
code_of = lambda s: re.sub(r'/\*[\s\S]*?\*/|//.*', '', s)

bodies, provided, defined, refs = [], set(), set(), set()
for f in files:
    src = open(f'{root}/{f}').read()
    assert 'goog.module(' not in src, f + ' is a goog.module'
    # license headers are restated once in the module's header
    src = re.sub(r'\A/\*\*[\s\S]*?@license[\s\S]*?\*/\n*', '', src)
    src = re.sub(r"^goog\.(require|requireType)\('[^']+'\);\n", '', src, flags=re.M)
    provided |= set(re.findall(r"goog\.provide\('([^']+)'\)", src))
    defined |= set(re.findall(r'^\s*(goog\.[\w.]+)\s*=', code_of(src), re.M))
    refs |= set(re.findall(r'\bgoog\.[\w.]+', code_of(src)))
    bodies.append(f'// {f}\n\n' + src.strip('\n') + '\n')

# what the prelude defines: goog.x.y = or goog = { x: { y ...: crude, names listed in a comment
known = set(re.findall(r'^// provides: (.*)$', prelude, re.M)[0].split())
def covered(r):
    return any(r == n or r.startswith(n + '.') for n in known | provided | defined) or \
        any(d.startswith(r + '.') for d in provided | defined)
missing = sorted(r for r in refs if not covered(r))
assert not missing, 'unhandled: ' + ' '.join(missing)

exports = [e.split('=') for e in exports_spec.split(',')]
footer = '\n' + ''.join(f'let {n}$ = {p};\n' for n, p in exports) + \
    'export {\n' + ''.join(f'  {n}$ as {n},\n' for n, _ in exports) + '};\n'
prelude = re.sub(r'^//\n// provides: .*\n', '', prelude, flags=re.M)
open(out, 'w').write(prelude.rstrip('\n') + '\n\n' + '\n\n'.join(bodies) + ('\n' + post if post else '') + footer)
print('ok', len(files), 'files,', len(exports), 'exports')
