"""Fold duplicate named imports of one module into the first statement (after a union of two sides' import blocks)."""
import re, sys
path = sys.argv[1]
lines = open(path).read().split('\n')
stmts, i = [], 0          # (start, end, text)
while i < len(lines):
    if re.match(r'^import\b', lines[i]):
        j = i
        while not re.search(r"""(\bfrom\s*['"][^'"]+['"]|^import\s*['"][^'"]+['"])\s*;?\s*(//.*)?$""", lines[j]) and j + 1 < len(lines):
            j += 1
        stmts.append((i, j, '\n'.join(lines[i:j + 1]))); i = j + 1
    else:
        i += 1
NAMED = re.compile(r"""^import\s*\{(?P<names>[^}]*)\}\s*from\s*(?P<q>['"])(?P<mod>[^'"]+)(?P=q)\s*;?\s*(?P<tail>//.*)?$""", re.S)
first, drop, changed, whole = {}, set(), 0, set()
for k, (a, b, txt) in enumerate(stmts):
    m = NAMED.match(txt)
    if not m:
        norm = ' '.join(txt.split())
        if norm in whole:
            drop.add(k); changed += 1
        whole.add(norm)
        continue
    names = [n.strip() for n in ' '.join(re.sub(r'//.*$', '', ln) for ln in m.group('names').split('\n')).split(',')]
    names = [n for n in names if n]
    mod = m.group('mod')
    if mod not in first:
        first[mod] = {'k': k, 'names': list(dict.fromkeys(names)), 'multi': '\n' in txt, 'tail': m.group('tail') or ''}
    else:
        f = first[mod]
        for n in names:
            if n not in f['names']:
                f['names'].append(n)
        drop.add(k); changed += 1
# a local name bound twice across different modules or forms would still be an error: report it
local = {}
for mod, f in first.items():
    for n in f['names']:
        ln = n.split(' as ')[-1].strip()
        local.setdefault(ln, []).append(mod)
dups = {k: v for k, v in local.items() if len(v) > 1}
out, cut = [], {}
for k, (a, b, txt) in enumerate(stmts):
    cut[a] = (b, k)
i = 0
while i < len(lines):
    if i in cut:
        b, k = cut[i]
        if k in drop:
            i = b + 1; continue
        m = NAMED.match(stmts[k][2])
        if m and first[m.group('mod')]['k'] == k:
            f = first[m.group('mod')]
            one = f"import {{ {', '.join(f['names'])} }} from '{m.group('mod')}'" + (('   ' + f['tail']) if f['tail'] else '')
            if len(one) > 160:
                rows, cur = [], '  '
                for n in f['names']:
                    if len(cur) + len(n) > 150:
                        rows.append(cur.rstrip()); cur = '  '
                    cur += n + ', '
                rows.append(cur.rstrip())
                one = 'import {\n' + '\n'.join(rows) + "\n} from '" + m.group('mod') + "'" + (('   ' + f['tail']) if f['tail'] else '')
            out.append(one)
        else:
            out += lines[i:b + 1]
        i = b + 1; continue
    out.append(lines[i]); i += 1
open(path, 'w').write('\n'.join(out))
print(path, 'import statements', len(stmts), 'folded', changed, 'same local name from two modules:', dups)
