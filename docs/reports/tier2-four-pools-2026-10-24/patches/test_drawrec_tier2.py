#!/usr/bin/env python3
"""test_drawrec_tier2.py <PATCHED drawrec.sh> <drawrequire.py> <tierrule.py> [--mutants] -- the REAL drawrec.sh Python
block (patched by drawrec.sh.patch) on a fixture, as scripts/test_drawrequire.py runs it: /tmp/drawrec.txt rewritten to
a fixture file, HOME a fixture tree (registration, drawrequire.py, tierrule.py, stub drawexposure/drawsteady). Nothing
live is read or written. The pick is parsed from drawrec's `DRAW (...): [...]` line by this test's own regex (the loop's
pipeline is exercised in test_loop_tier2.py). Every pool is in band; only `n_in` pass the exposure filter."""
import json, os, re, shutil, subprocess, sys, tempfile

DRAWREC, DRQ, TRM = sys.argv[1:4]
T = []


def t(n, ok, d=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', n, '' if ok else '\n        -> ' + str(d)[-600:]))


ALL = ['board-a', 'board-b', 'board-c', 'board-d', 'hive-a', 'hive-b', 'hive-c', 'placebo-a']


def txt(n_in):
    """Every pool in the band (60 items/bh); only the first n_in pass drawrec's exposure filter (livelock >= 8), so
    exactly n_in are ELIGIBLE. hive-b is last in ALL order below, so a required hive-b is never one of the eligible."""
    order = [p for p in ALL if p != 'hive-b'] + ['hive-b']
    L = ['%s 5080 bots 5 items/bh 60.0' % p for p in order]
    L.append('5080-half median items/bh: 60.0')
    L += ['  %s   livelock %d climbs %d immobile>=30m 0' % (p, 9 if i < n_in else 0, 30 if i < n_in else 0)
          for i, p in enumerate(order)]
    L += ['=== LEDGER', '=== MANIFEST', json.dumps({'canary_pool': None})]
    return '\n'.join(L) + '\n'


def run(src, reg, n_in, tierrule=True):
    d = tempfile.mkdtemp(prefix='drt2-')
    try:
        ma = os.path.join(d, 'mcai-analysis'); os.makedirs(os.path.join(ma, 'registrations')); os.makedirs(os.path.join(d, 'digest'))
        shutil.copy(DRQ, os.path.join(ma, 'drawrequire.py'))
        if tierrule:
            shutil.copy(TRM, os.path.join(ma, 'tierrule.py'))
        json.dump(dict({'sha': 'x'}, **reg), open(os.path.join(ma, 'registrations', 'r1.json'), 'w'))
        open(os.path.join(ma, 'drawexposure.py'), 'w').write('print("no requirement")\n')
        open(os.path.join(ma, 'drawsteady.py'), 'w').write('print("STEADY RELEASE []")\n')
        tf = os.path.join(d, 'drawrec.txt'); open(tf, 'w').write(txt(n_in))
        py = src.split("python3 - <<'PY'\n", 1)[1].split('\nPY', 1)[0].replace('/tmp/drawrec.txt', tf)
        open(os.path.join(d, 'block.py'), 'w').write(py)
        env = dict(os.environ, HOME=d, DRAW_RUN='r1', PYTHONDONTWRITEBYTECODE='1')
        r = subprocess.run([sys.executable, '-B', os.path.join(d, 'block.py')], capture_output=True, text=True, env=env, timeout=120)
        out = r.stdout + r.stderr
        m = re.search(r'DRAW \((.*?)\): (\[.*\]|NONE.*)$', r.stdout, re.M)
        drawn = re.findall(r"'([a-z]+-[a-z])'", m.group(2)) if m and m.group(2).startswith('[') else []
        return drawn, out
    finally:
        shutil.rmtree(d, ignore_errors=True)


def cases(src):
    p, o = run(src, {}, 3)
    t('positive control: no tier, 3 pools in band -> 3 drawn (as today)', len(p) == 3, o)
    p, o = run(src, {'tier': 3}, 3)
    t('tier 3 declared, 3 in band -> 3 drawn (as today)', len(p) == 3, o)
    p, o = run(src, {'tier': 2}, 3)
    t('TIER 2, 3 in band -> NOTHING drawn (waits)', p == [] and 'tier 2: exactly 4 pools' in o and 'fewer than 4 eligible' in o, o)
    p, o = run(src, {'tier': 2}, 2)
    t('TIER 2, 2 in band -> nothing drawn', p == [], o)
    p, o = run(src, {'tier': 2}, 6)
    t('TIER 2, 6 in band -> exactly 4 drawn', len(p) == 4, o)
    p, o = run(src, {'tier': 2}, 4)
    t('TIER 2, exactly 4 in band -> those 4 drawn', len(p) == 4, o)
    p, o = run(src, {'tier': 2, 'class': 'bag-fix'}, 3)
    t('tier 2 on a class (not tier 2 by tierrule) -> today\'s rule (3 drawn)', len(p) == 3, o)
    p, o = run(src, {'tier': True}, 3)
    t('tier True (not the integer 2) -> today\'s rule (3 drawn)', len(p) == 3, o)
    p, o = run(src, {'tier': 2, 'draw_k': 2}, 6)
    t('TIER 2 with draw_k 2 -> nothing drawn (a contradiction, refused)', p == [] and 'contradiction' in o, o)
    for k in (4, 5, 0, False):
        p, o = run(src, {'tier': 2, 'draw_k': k}, 6)
        t('TIER 2 with draw_k %r (allows 4, or ignored by drawrec) -> exactly 4 drawn' % (k,), len(p) == 4, o)
    p, o = run(src, {'tier': 2, 'draw_k': True}, 6)
    t('TIER 2 with draw_k True (an int to drawrec: caps at 1) -> nothing (the loop refuses it too)', p == [], o)
    p, o = run(src, {'tier': 2}, 6, tierrule=False)
    t('a tier declared but tierrule.py unreadable -> nothing drawn (fail closed)', p == [] and 'unreadable' in o, o)
    p, o = run(src, {}, 6, tierrule=False)
    t('positive control: no tier key, tierrule.py absent -> today\'s draw (4)', len(p) == 4, o)
    p, o = run(src, {'tier': 2, 'draw_require_pools': ['hive-b']}, 3)
    t('TIER 2 + draw_require_pools [hive-b] (out of band), 3 others in band -> 4 drawn incl. hive-b',
      len(p) == 4 and 'hive-b' in p, o)
    p, o = run(src, {'tier': 2, 'draw_require_pools': ['hive-b']}, 2)
    t('TIER 2 + required hive-b + only 2 others in band -> nothing (waits; never 3)', p == [], o)
    p, o = run(src, {'draw_require_pools': ['hive-b']}, 2)
    t('positive control: tier 3 + required hive-b + 2 others -> 3 drawn (as today)', len(p) == 3, o)


MUTANTS = [
    ("                TARGET_K = 4; MIN_K = 4", "                TARGET_K = 4; MIN_K = 2"),
    ("            if TARGET_K < 4:", "            if False:"),
    ("            _t2 = _TRM.tier_of(_r) == 2", "            _t2 = bool(_r.get('tier'))"),
    ("            _t2 = None\n            TARGET_K = 0; MIN_K = 1", "            _t2 = None\n            pass"),
    ("    if _r is not None and 'tier' in _r:", "    if False:"),
]


def main():
    src = open(DRAWREC).read()
    cases(src)
    ok = all(T)
    print('test_drawrec_tier2: %d/%d pass' % (sum(T), len(T)))
    if '--mutants' not in sys.argv:
        sys.exit(0 if ok else 1)
    fired = 0
    try:
        assert src.count('this anchor is absent') == 1, 'ANCHOR MISSING'
    except AssertionError:
        fired = 1
    assert fired, 'the anchor assertion did not fire on an absent anchor'
    print('positive control: the anchor assertion fires on an absent anchor')
    surv = 0
    import io, contextlib
    for old, new in MUTANTS:
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: %r (%d)' % (old, src.count(old))
        del T[:]
        with contextlib.redirect_stdout(io.StringIO()):
            cases(src.replace(old, new, 1))
        killed = not all(T)
        print('  mutant %-70r %s' % (old.strip()[:70], 'killed' if killed else 'SURVIVED'))
        surv += not killed
    print('mutants: %d of %d killed' % (len(MUTANTS) - surv, len(MUTANTS)))
    sys.exit(0 if ok and not surv else 1)


if __name__ == '__main__':
    main()
