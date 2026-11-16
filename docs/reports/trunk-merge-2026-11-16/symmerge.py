"""Symbol-level three-way merge of one .mjs file whose protection is per top-level declaration (bots/src/skills.mjs).
Each side is cut into its top-level declarations; a declaration changed on one side only takes that side; one changed on
both takes the fleet side when it is protected and the showcase side otherwise, with a line merge inside it first."""
import json, os, re, subprocess, sys, tempfile, collections
SP, PATH = sys.argv[1], sys.argv[2]
sys.path.insert(0, SP)
import protected_main as P

def stage(n, path):
    r = subprocess.run(['git', 'show', f':{n}:{path}'], capture_output=True)
    return r.stdout.decode('utf-8') if r.returncode == 0 else None

pats = set()
for n in (2, 3):
    pats |= set(P.parse_patterns(stage(n, 'config/protected-paths.txt')))
SYMS = {s for p, s, _ in pats if s is not None and P.glob_match(PATH, p)}
WHOLE = any(sy is None and P.glob_match(PATH, p) for p, sy, _ in pats)
def prot(name):
    return WHOLE or any(P.glob_match(P._norm(name), P._norm(s)) for s in SYMS)
ROW = re.compile(r"""^  (['"]?)([A-Za-z_$][\w$]*)\1\s*:""")
TABLES = {'SKILLS', 'SKILL_CONTRACTS'}
LOOSE = re.compile(r'^\s*(//.*)?$')

def segments(text):
    lines = text.split('\n')
    ow = P.decl_owners(text)
    segs, cur, buf, nimp = [], '__head__', [], 0
    def key(o):
        return '__head__' if o is None else o
    last = None
    for i, ln in enumerate(lines, 1):
        o = ow[i] if i < len(ow) else ow[-1]
        k = '__imports__' if o == P.IMPORTS else key(o)
        if k != last:
            if buf or last is not None:
                segs.append([last, buf])
            buf, last = [], k
        buf.append(ln)
    segs.append([last, buf])
    # a comment block or blank lines at the tail of a segment introduce the NEXT declaration: move them there
    for a, b in zip(segs, segs[1:]):
        if a[0] == '__imports__' or b[0] == '__imports__':
            continue
        n = len(a[1])
        while n > 0 and LOOSE.match(a[1][n - 1]):
            n -= 1
        if 0 < n < len(a[1]):
            b[1][:0] = a[1][n:]
            del a[1][n:]
    out, seen = collections.OrderedDict(), collections.Counter()
    for k, ls in segs:
        seen[k] += 1
        kk = k if seen[k] == 1 else f'{k}#{seen[k]}'
        out[kk] = '\n'.join(ls)
    return out

def mergefile(o, b, t, favor):
    with tempfile.TemporaryDirectory() as d:
        fs = []
        for nm, tx in (('o', o), ('b', b or ''), ('t', t)):
            f = os.path.join(d, nm); open(f, 'w').write(tx + '\n'); fs.append(f)
        r = subprocess.run(['git', 'merge-file', '-p', '--diff3', *fs], capture_output=True)
        return r.stdout.decode()[:-1], r.returncode

def blocks(text):
    cur, mode, o, b, t = [], None, [], [], []
    for ln in text.split('\n'):
        if mode is None and ln.startswith('<<<<<<< '):
            yield ('ctx', cur); cur, mode, o, b, t = [], 'o', [], [], []
        elif mode == 'o' and ln.startswith('||||||| '): mode = 'b'
        elif mode in ('o', 'b') and ln == '=======': mode = 't'
        elif mode == 't' and ln.startswith('>>>>>>> '):
            yield ('conf', o, b, t); mode = None
        elif mode == 'o': o.append(ln)
        elif mode == 'b': b.append(ln)
        elif mode == 't': t.append(ln)
        else: cur.append(ln)
    assert mode is None
    yield ('ctx', cur)

_b = stage(1, PATH)
B, O, T = (segments(_b) if _b is not None else {}), segments(stage(2, PATH)), segments(stage(3, PATH))
led, res = [], collections.OrderedDict()
def decide(name):
    b, o, t = B.get(name), O.get(name), T.get(name)
    if o == t: return o, 'same'
    if o == b: return t, 'showcase-only change' if t is not None else 'showcase removed it'
    if t == b: return o, 'fleet-only change' if o is not None else 'fleet removed it'
    if o is None or t is None:
        # one side removed it, the other changed it: keep the changed text on the side the rule favours
        p = prot(name)
        keep = (o if p else t)
        if keep is None: keep = o if o is not None else t     # never lose a changed declaration silently
        return keep, f'removed on one side, changed on the other: kept ({"fleet rule" if p else "showcase rule"})'
    base = name.split('#')[0]
    if base == '__imports__':
        return t + '\n' + o, 'imports: both sides kept whole (duplicates folded afterwards)'
    if base in TABLES:
        merged, rc = mergefile(o, b, t, None)
        out, n_o, n_t, key = [], 0, 0, None
        for blk in blocks(merged):
            if blk[0] == 'ctx':
                out += blk[1]
                for ln in blk[1]:
                    m = ROW.match(ln)
                    if m: key = m.group(2)
                continue
            _, oo, bb, tt = blk
            keys = {m.group(2) for ln in oo + tt for m in [ROW.match(ln)] if m} | ({key} if key else set())
            if any(prot(k) for k in keys): out += oo; n_o += 1
            else: out += tt; n_t += 1
        return '\n'.join(out), f'table merged by row: {n_o} blocks fleet (protected rows), {n_t} blocks showcase'
    p = prot(base)
    merged, rc = mergefile(o, b, t, None)
    if rc == 0:
        return merged, 'both changed, merged cleanly inside'
    out, n = [], 0
    for blk in blocks(merged):
        if blk[0] == 'ctx': out += blk[1]
        else:
            n += 1; out += (blk[1] if p else blk[3])
    return '\n'.join(out), f'both changed: {n} block(s) took the {"FLEET side (protected)" if p else "showcase side"}'

# order: the showcase's order, fleet-only declarations placed after their fleet predecessor
for name in T:
    txt, why = decide(name)
    if txt is not None: res[name] = txt
    led.append({'sym': name, 'why': why, 'protected': prot(name.split('#')[0]), 'o': None if O.get(name) is None else O[name].count('\n') + 1,
                't': T[name].count('\n') + 1, 'b': None if B.get(name) is None else B[name].count('\n') + 1})
order = list(res)
prev = None
for name in O:
    if name in T:
        if name in res: prev = name
        continue
    txt, why = decide(name)
    led.append({'sym': name, 'why': why + ' (fleet-only declaration)', 'protected': prot(name.split('#')[0]), 'o': O[name].count('\n') + 1, 't': None,
                'b': None if B.get(name) is None else B[name].count('\n') + 1})
    if txt is None: continue
    i = order.index(prev) + 1 if prev in order else 0
    order.insert(i, name); res[name] = txt; prev = name
final = '\n'.join(res[k] for k in order)
open(PATH, 'w').write(final)
json.dump(led, open(SP + '/symledger-' + os.path.basename(PATH) + '.json', 'w'), indent=1)
c = collections.Counter(re.sub(r'\d+ block\(s\)', 'N block(s)', re.sub(r'\d+ blocks', 'N blocks', l['why'])) for l in led)
for k, v in c.most_common(): print(f'{v:5d}  {k}')
print('lines:', final.count('\n') + 1, '| declarations:', len(order))
print('whole-file protected' if WHOLE else 'per symbol', '| both changed, fleet side:', sorted(l['sym'] for l in led if 'FLEET side' in l['why'])[:40])
