"""Rule-based first pass over the trunk merge (showcase line into main). Run in the merge worktree.
Rule (plan of record, one-trunk-plan 11-14): protected scope takes the FLEET side (ours = main) on a conflict;
everything else in bots/ takes the SHOWCASE side (theirs); tooling outside bots/ takes main. Non-conflicting
changes from both sides are kept by the three-way merge either way. Every conflict block is written to a ledger."""
import json, os, re, subprocess, sys, tempfile, fnmatch
SP = sys.argv[1]
sys.path.insert(0, SP)
import protected_main as P

def git(*a, check=True):
    r = subprocess.run(['git', *a], capture_output=True)
    if check and r.returncode:
        raise SystemExit(f'git {a}: {r.stderr.decode()[:300]}')
    return r

def stage(n, path):
    r = git('show', f':{n}:{path}', check=False)
    return r.stdout.decode('utf-8', 'surrogateescape') if r.returncode == 0 else None

# protected patterns: the union of both sides' lists
pats = set()
for n in (2, 3):
    t = stage(n, 'config/protected-paths.txt')
    if t:
        pats |= set(P.parse_patterns(t))
whole = [(p, tier) for p, s, tier in pats if s is None]
syms = {}
for p, s, tier in pats:
    if s is not None:
        syms.setdefault(p, set()).add(s)

def whole_protected(path):
    return any(P.glob_match(path, p) for p, _ in whole)

def sym_protected(path, names):
    for p, ss in syms.items():
        if P.glob_match(path, p):
            for nm in names:
                if nm and any(P.glob_match(P._norm(nm), P._norm(s)) for s in ss):
                    return nm
    return None

prot_modules = {os.path.basename(p)[:-4] for p, _ in whole if p.startswith('bots/src/') and p.endswith('.mjs')}
ROW = re.compile(r"""^  (['"]?)([A-Za-z_$][\w$]*)\1\s*:""")
TABLES = {'SKILLS', 'SKILL_CONTRACTS'}

def merge3(ours, base, theirs):
    with tempfile.TemporaryDirectory() as d:
        fs = []
        for nm, tx in (('ours', ours), ('base', base or ''), ('theirs', theirs)):
            f = os.path.join(d, nm); open(f, 'w', encoding='utf-8', errors='surrogateescape').write(tx); fs.append(f)
        r = subprocess.run(['git', 'merge-file', '-p', '--diff3', *fs], capture_output=True)
        return r.stdout.decode('utf-8', 'surrogateescape')

def blocks(text):
    """yield ('ctx', lines) | ('conf', ours, base, theirs)"""
    cur, mode, o, b, t = [], None, [], [], []
    for ln in text.split('\n'):
        if mode is None and ln.startswith('<<<<<<< '):
            if cur: yield ('ctx', cur)
            cur, mode, o, b, t = [], 'o', [], [], []
        elif mode == 'o' and ln.startswith('||||||| '):
            mode = 'b'
        elif mode in ('o', 'b') and ln == '=======':
            mode = 't'
        elif mode == 't' and ln.startswith('>>>>>>> '):
            yield ('conf', o, b, t); mode = None
        elif mode == 'o': o.append(ln)
        elif mode == 'b': b.append(ln)
        elif mode == 't': t.append(ln)
        else: cur.append(ln)
    assert mode is None, 'unterminated conflict block'
    if cur: yield ('ctx', cur)

def owners_of(prefix_lines, hunk):
    text = '\n'.join(prefix_lines + hunk)
    ow = P.decl_owners(text)
    n0 = len(prefix_lines)
    got = set(ow[n0 + 1: n0 + len(hunk) + 1]) if hunk else set()
    got.add(ow[min(n0, len(ow) - 1)] if n0 else None)
    return got

def row_key(prefix_lines, hunk):
    keys = {m.group(2) for ln in hunk for m in [ROW.match(ln)] if m}
    for ln in reversed(prefix_lines[-400:]):
        m = ROW.match(ln)
        if m:
            keys.add(m.group(2)); break
    return keys

ledger, summary = [], {}
conflicted = [l for l in open(SP + '/conflicts.txt').read().split('\n') if l]
for path in conflicted:
    ours, base, theirs = stage(2, path), stage(1, path), stage(3, path)
    assert ours is not None and theirs is not None, path
    in_src = path.startswith('bots/src/')
    in_bots = path.startswith('bots/')
    if not in_bots:
        mode = 'ours'; why = 'tooling/docs outside bots/: main carries the current tooling'
    elif whole_protected(path):
        mode = 'ours'; why = 'whole file in protected scope: fleet side'
    elif in_src and any(P.glob_match(path, p) for p in syms):
        mode = 'bysym'; why = 'protected per symbol'
    elif path.startswith('bots/test/') and any(os.path.basename(path).startswith(m) for m in prot_modules):
        mode = 'ours'; why = 'test of a protected module: fleet side'
    else:
        mode = 'theirs'; why = 'outside protected scope: showcase side'
    merged = merge3(ours, base, theirs)
    out, n = [], 0
    for blk in blocks(merged):
        if blk[0] == 'ctx':
            out += blk[1]; continue
        _, o, b, t = blk
        n += 1
        take, note = mode, ''
        own = sorted(x for x in (owners_of(out, o) | owners_of(out, t)) if x)
        if P.IMPORTS in own and all(re.match(r'^\s*(import\b.*|[\w$,\s{}]*|\}\s*from\s.*)$', x) for x in o + t):
            # an import block: keep both sides' lines (duplicates dropped); lint settles the rest
            seen, uni = set(), []
            for x in o + t:
                if x not in seen:
                    seen.add(x); uni.append(x)
            out += uni; take = 'union-imports'
        else:
            if mode == 'bysym':
                names = set(own)
                if names & TABLES:
                    names |= row_key(out, o) | row_key(out, t)
                hit = sym_protected(path, names)
                take = 'ours' if hit else 'theirs'
                note = f'protected symbol {hit}' if hit else ''
            out += (o if take == 'ours' else t)
        ledger.append({'file': path, 'block': n, 'took': take, 'owners': own[:6], 'ours_lines': len(o), 'theirs_lines': len(t),
                       'base_lines': len(b), 'note': note})
    res = '\n'.join(out)
    assert '<<<<<<< ' not in res and '\n>>>>>>> ' not in res
    open(path, 'w', encoding='utf-8', errors='surrogateescape').write(res)
    summary[path] = {'mode': mode, 'why': why, 'blocks': n, 'aa': base is None}
json.dump({'summary': summary, 'ledger': ledger}, open(SP + '/merge-ledger.json', 'w'), indent=1)
import collections
print(collections.Counter(v['mode'] for v in summary.values()))
print(collections.Counter(l['took'] for l in ledger), 'blocks', len(ledger))
dropped_show = sum(l['theirs_lines'] for l in ledger if l['took'] == 'ours')
dropped_fleet = sum(l['ours_lines'] for l in ledger if l['took'] == 'theirs')
print('showcase lines set aside by the fleet-side rule:', dropped_show, '| fleet lines set aside by the showcase-side rule:', dropped_fleet)
