#!/usr/bin/env python3
"""test_drawrequire.py -- `draw_require_pools` (gate v35; coordinator 10-10), on the REAL drawrec.sh Python block run
against a fixture (as test_patch_drawrec.py does): /tmp/drawrec.txt is rewritten to a fixture file, HOME points at a
fixture tree with drawrequire.py, a stub drawexposure.py, an optional stub drawsteady.py and the registration. The pick is
then parsed by the LOOP'S OWN pipeline, cut from canary-loop.sh. Nothing live is read or written.
Mutants on copies (anchors asserted present and unique) after an unmutated control passes."""
import os, sys, re, json, shutil, subprocess, tempfile, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))


def find(n, host=False):
    for d in ((os.path.join(HERE, 'host'), HERE) if host else (HERE, os.path.join(HERE, 'host'))):
        if os.path.exists(os.path.join(d, n)):
            return os.path.join(d, n)
    raise SystemExit('missing ' + n)


DRAWREC, LOOP, DRQ = find('drawrec.sh', host=True), find('canary-loop.sh', host=True), find('drawrequire.py')
T = []
NOW = dt.datetime.now(dt.timezone.utc)
POOLS = {'board-a': 60.0, 'board-b': 61.0, 'board-c': 59.5, 'board-d': 60.2, 'hive-a': 59.0, 'hive-b': 60.5,
         'hive-c': 61.5, 'placebo-a': 60.1, 'placebo-c': 60.0, 'isolated-a': 60.0,
         'hive-d': 20.0}                       # hive-d: far outside the band and below the exposure filter


def t(n, ok, d=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', n, '' if ok else '\n        -> ' + str(d)[-700:]))


def txt(ledger=(), manifest_pool=None, drop=()):
    L = ['%s 5080 bots 5 items/bh %.1f' % (p, v) for p, v in POOLS.items() if p not in drop]
    L.append('5080-half median items/bh: 60.0')
    L += ['  %s   livelock %d climbs 30 immobile>=30m 0' % (p, 2 if p == 'hive-d' else 9) for p in POOLS if p not in drop]
    L.append('=== LEDGER')
    L += [json.dumps({'canary_sha': 'x', 'canary_pool': p, 'decision': dcs, 'note': 'r: x', 'ts': (NOW - dt.timedelta(hours=h)).isoformat()})
          for p, dcs, h in ledger]
    L.append('=== MANIFEST')
    L.append(json.dumps({'canary_pool': manifest_pool}))
    return '\n'.join(L) + '\n'


def loop_pipeline():
    src = open(LOOP).read()
    m = re.search(r'P=\$\(echo "\$D" \| grep -o "DRAW \(\.\*owner C\): \\\[\.\*\\\]"[^\n]*?paste -sd, -\)', src)
    assert m, 'the loop\'s pick pipeline was not found'
    return m.group(0)


PIPE = loop_pipeline()


def run(drawrec, drq, reg=None, run_id='r1', ledger=(), manifest_pool=None, drop=(), manual=None, steady_release=None,
        steady_text=None, home=None, env=None):
    d = home or tempfile.mkdtemp(prefix='drawreq-')
    try:
        ma = os.path.join(d, 'mcai-analysis'); os.makedirs(os.path.join(ma, 'registrations'), exist_ok=True); os.makedirs(os.path.join(d, 'digest'), exist_ok=True)
        shutil.copy(drq, os.path.join(ma, 'drawrequire.py'))
        if reg == 'corrupt':
            open(os.path.join(ma, 'registrations', run_id + '.json'), 'w').write('{"draw_require_pools": ["hive-d"')
        elif reg is not None:
            json.dump(dict({'sha': 'x', 'lab': True}, **reg), open(os.path.join(ma, 'registrations', run_id + '.json'), 'w'))
        open(os.path.join(ma, 'drawexposure.py'), 'w').write('print("no requirement")\n')
        if steady_release is not None:
            open(os.path.join(ma, 'drawsteady.py'), 'w').write('print("STEADY RELEASE %r")\n' % (steady_release,))
        if steady_text is not None:
            open(os.path.join(ma, 'drawsteady.py'), 'w').write('print(%r)\n' % steady_text)
        if manual:
            open(os.path.join(ma, 'draw-exclude.txt'), 'w').write('%s %s fixture\n' % (manual, (NOW + dt.timedelta(hours=5)).strftime('%Y-%m-%dT%H:%M:%SZ')))
        tf = os.path.join(d, 'drawrec.txt'); open(tf, 'w').write(txt(ledger, manifest_pool, drop))
        src = open(drawrec).read()
        py = src.split("python3 - <<'PY'\n", 1)[1].split('\nPY', 1)[0].replace('/tmp/drawrec.txt', tf)
        open(os.path.join(d, 'block.py'), 'w').write(py)
        r = subprocess.run([sys.executable, os.path.join(d, 'block.py')], capture_output=True, text=True,
                           env=dict(os.environ, HOME=d, DRAW_RUN=run_id, **(env or {})), timeout=120)
        out = r.stdout + r.stderr
        tail4 = '\n'.join(r.stdout.strip().splitlines()[-4:])
        p = subprocess.run(['bash', '-c', 'D=$(cat); ' + PIPE + '; echo "$P"'], input=tail4, capture_output=True, text=True).stdout.strip()
        pg = os.path.join(d, 'digest', 'page.jsonl')
        return (p.split(',') if p else []), out + ('\nPAGES:' + open(pg).read() if os.path.exists(pg) else '\nPAGES:')
    finally:
        if home is None:
            shutil.rmtree(d, ignore_errors=True)


def cases(drawrec, drq):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    R = {'draw_require_pools': ['hive-d']}
    P, o = run(drawrec, drq, reg={})
    c('no field: an ordinary four-pool draw without hive-d (out of band, low exposure)', len(P) == 4 and 'hive-d' not in P, (P, o))
    for _ in range(3):
        P, o = run(drawrec, drq, reg=R)
        c('required hive-d (out of band, below the exposure filter) is IN the draw, plus 3 from the eligible set',
          len(P) == 4 and 'hive-d' in P and not ({'placebo-c', 'isolated-a'} & set(P)), (P, o))
    P, o = run(drawrec, drq, reg=R, ledger=[('hive-d', 'KEEP', 3)])
    c('required hive-d inside its 12-h exclusion -> NO draw (waits; never substitutes)', P == [] and 'excluded' in o, (P, o))
    P, o = run(drawrec, drq, reg=R, ledger=[('hive-d', 'KEEP', 7)], steady_release=['hive-d'])
    c('hive-d released at 6 h by drawsteady -> drawn', 'hive-d' in P, (P, o))
    P, o = run(drawrec, drq, reg=R, ledger=[('hive-d', 'REVERT', 7)], steady_release=[])
    c('hive-d at 7 h, not released (12 h) -> NO draw', P == [] and 'excluded' in o, (P, o))
    P, o = run(drawrec, drq, reg=R, manifest_pool='hive-d,board-a')
    c('hive-d is the live canary -> NO draw', P == [], (P, o))
    P, o = run(drawrec, drq, reg=R, manual='hive-d')
    c('hive-d manually excluded (draw-exclude.txt) -> NO draw', P == [], (P, o))
    P, o = run(drawrec, drq, reg=R, drop=('hive-d',))
    c('hive-d has no band row (no data) -> NO draw', P == [] and 'no band row' in o, (P, o))
    P, o = run(drawrec, drq, reg={'draw_require_pools': 'hive-d'})
    c('a malformed field (a string) -> NO draw (fail closed), says REFUSED', P == [] and 'draw_require_pools REFUSED' in o, (P, o))
    P, o = run(drawrec, drq, reg={'draw_require_pools': ['hive-d', 'hive-d']})
    c('duplicate names -> NO draw', P == [] and 'draw_require_pools REFUSED' in o, (P, o))
    P, o = run(drawrec, drq, reg={'draw_require_pools': ['placebo-c']})
    c('placebo-c required -> NO draw (never drawable)', P == [] and 'never drawable' in o, (P, o))
    P, o = run(drawrec, drq, reg={'draw_require_pools': ['board-a', 'board-b', 'board-c', 'board-d', 'hive-a']})
    c('five required pools (> the 4-pool target) -> NO draw', P == [], (P, o))
    P, o = run(drawrec, drq, reg=None, run_id='r2')     # r2 has no registration file at all
    c('the registration is missing -> NO draw (fail closed)', P == [] and 'unreadable' in o, (P, o))
    P, o = run(drawrec, drq, reg='corrupt')
    c('the registration is corrupt JSON -> NO draw (fail closed)', P == [] and 'unreadable' in o, (P, o))
    every = [(p, 'KEEP', 1) for p in POOLS if p != 'hive-d']
    P, o = run(drawrec, drq, reg=R, ledger=every)
    c('hive-d free but every other pool excluded -> 1 pool < 2: NO draw', P == [] and 'waiting' in o, (P, o))
    P, o = run(drawrec, drq, reg={'draw_require_pools': ['hive-d', 'board-a']}, ledger=[(p, 'KEEP', 1) for p in POOLS if p not in ('hive-d', 'board-a')])
    c('two required pools, nothing else eligible -> exactly those two (MIN_K 2)', sorted(P) == ['board-a', 'hive-d'], (P, o))
    # v37 FUN MODE: draw_require_pools is lab-only; the fallback draw keeps only the hard exclusions
    P, o = run(drawrec, drq, reg={'draw_require_pools': ['hive-d'], 'lab': False})
    c('fun mode: draw_require_pools is not applied (hive-d not forced in)', len(P) == 4 and 'hive-d' not in P and
      'draw_require_pools are not applied' in o, (P, o))
    every = [(p, 'KEEP', 1) for p in POOLS]
    P, o = run(drawrec, drq, reg={'lab': False}, ledger=every)
    c('fun mode, every pool inside its 12-h exclusion -> the ordinary draw finds nothing', P == [], (P, o))
    for _ in range(3):
        P, o = run(drawrec, drq, reg={'lab': False}, ledger=every, manifest_pool='board-a', manual='board-b',
                   env={'DRAW_FUN_FALLBACK': '1'})
        c('fun fallback: four pools despite the 12-h exclusions; never the live canary, a manual exclusion, placebo-c '
          'or isolated', len(P) == 4 and not ({'board-a', 'board-b', 'placebo-c'} & set(P)) and
          not any(p.startswith('isolated') for p in P) and 'FUN FALLBACK' in o, (P, o))
    P, o = run(drawrec, drq, reg=R, ledger=every, env={'DRAW_FUN_FALLBACK': '1'})
    c('lab registration: the fallback still honours draw_require_pools (hive-d in, others from the fallback set)',
      'hive-d' in P, (P, o))
    # v35.1 (round 1, Claude): a drawsteady REFUSAL pages once per 6 h; a normal answer never pages
    h = tempfile.mkdtemp(prefix='drawreq-page-')
    REF = 'STEADY inputs unreadable or malformed (ValueError: x): 12 h for every pool\nSTEADY RELEASE []'
    P, o = run(drawrec, drq, reg={}, steady_text=REF, home=h)
    c('a drawsteady REFUSAL is PAGED (level error, names the refusal)', o.count('"level": "error"') == 1 and 'drawsteady REFUSED' in o, o[-500:])
    P, o = run(drawrec, drq, reg={}, steady_text=REF, home=h)
    c('a second refusal within 6 h is NOT paged again (one page)', o.split('PAGES:')[1].count('drawsteady REFUSED') == 1, o[-500:])
    shutil.rmtree(h, ignore_errors=True)
    h = tempfile.mkdtemp(prefix='drawreq-page-')
    P, o = run(drawrec, drq, reg={}, steady_text='STEADY no KEEP+promoted pool between 6 and 12 h\nSTEADY RELEASE []', home=h)
    c('a normal "no candidate" answer never pages', 'drawsteady REFUSED' not in o, o[-300:])
    P, o = run(drawrec, drq, reg={}, steady_text='STEADY something without a release line', home=h)
    c('an answer with NO RELEASE line pages (a crash is a refusal)', 'drawsteady REFUSED' in o, o[-300:])
    shutil.rmtree(h, ignore_errors=True)
    return out


MUTANTS = [
    ('drawrequire.py', 'exclusion ignored for required pools', "        if p in excluded:\n", "        if False:\n"),
    ('drawrequire.py', 'no band row accepted', "        if p not in band_pools:\n", "        if False:\n"),
    ('drawrequire.py', 'placebo-c/isolated accepted', "        if p == 'placebo-c' or p.startswith('isolated'):\n", "        if False:\n"),
    ('drawrequire.py', 'malformed accepted', "    if not isinstance(v, list) or not v or not all(", "    if False and not all("),
    ('drawrequire.py', 'over-target accepted', "    if len(required) > target_k:\n", "    if False:\n"),
    ('drawrequire.py', 'MIN_K ignored', "    if len(out) < min_k:\n", "    if False:\n"),
    ('drawrequire.py', 'required dropped from the draw', "    out = list(required) + (sample(rest, k) if k > 0 else [])", "    out = (sample(rest, min(target_k, len(rest))) if rest else [])"),
    ('drawrec.sh', 'a refusal is never paged', "if _refused:\n    try:\n        _st =", "if False:\n    try:\n        _st ="),
    ('drawrec.sh', 'no 6-h dedupe', "        if now.timestamp() - _last > 6 * 3600:", "        if True:"),
    ('drawrec.sh', 'a missing RELEASE line not treated as a refusal', "    if not any(l.startswith('STEADY RELEASE ') for l in _sr.stdout.splitlines()):", "    if False:"),
    ('drawrec.sh', 'requirement never applied', "    elif _REQ:\n", "    elif False:\n"),
    ('drawrec.sh', 'unreadable registration draws anyway', "    if _REQ is None:\n        pick = None;", "    if False:\n        pick = None;"),
]

if __name__ == '__main__':
    for n, ok, d in cases(DRAWREC, DRQ):
        t(n, ok, d)
    tmp = tempfile.mkdtemp(prefix='drawreq-m-')
    cd = {f: shutil.copy(p, os.path.join(tmp, f)) for f, p in (('drawrec.sh', DRAWREC), ('drawrequire.py', DRQ))}
    ctl = cases(cd['drawrec.sh'], cd['drawrequire.py'])
    t('mutant runner control: the unmutated copies pass (%d)' % len(ctl), ctl and all(ok for _n, ok, _d in ctl), [n for n, ok, _d in ctl if not ok])
    ok_all = all(T)
    FILES = {'drawrec.sh': DRAWREC, 'drawrequire.py': DRQ}
    for f, name, old, new in MUTANTS:
        src = open(FILES[f]).read()
        assert src.count(old) == 1, 'ANCHOR %s: %s (%d)' % (f, name, src.count(old))
        if not ok_all:
            t('mutant NOT SCORED: ' + name, False); continue
        dm = tempfile.mkdtemp(dir=tmp)
        mp = {g: shutil.copy(p, os.path.join(dm, g)) for g, p in FILES.items()}
        open(mp[f], 'w').write(src.replace(old, new, 1))
        try:
            killed = not all(ok for _n, ok, _d in cases(mp['drawrec.sh'], mp['drawrequire.py']))
        except Exception:
            killed = True
        t('mutant killed: %s: %s' % (f, name), killed, 'SURVIVED')
    shutil.rmtree(tmp, ignore_errors=True)
    print('\n%d/%d pass' % (sum(T), len(T)))
    sys.exit(0 if all(T) else 1)
