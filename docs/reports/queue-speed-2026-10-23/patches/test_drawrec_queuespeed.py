#!/usr/bin/env python3
"""test_drawrec_queuespeed.py <PATCHED drawrec.sh> <drawrequire.py> [--mutants] -- the REAL drawrec.sh Python block
(patched by drawrec.sh.patch) against a fixture, exactly as scripts/test_drawrequire.py runs it: /tmp/drawrec.txt
rewritten to a fixture file, HOME a fixture tree with a stub drawexposure.py / drawsteady.py and the registration.
Nothing live is read or written. Covers the four proposed switches and that the unset path is unchanged:
  DRAW_RESERVE  the reserved pools are excluded from THIS draw (and a malformed value refuses);
  DRAW_REGDIR   the registration is read from the given dir (and handed to drawsteady as STEADY_REGDIR);
  DRAW_PROBE    a steady refusal is NOT paged (and IS paged without it: the positive control);
  instruments   the line the scheduler's probe reads, before the DRAW line (the loop's tail -4 is unchanged)."""
import datetime as dt, json, os, re, shutil, subprocess, sys, tempfile

DRAWREC, DRQ = sys.argv[1], sys.argv[2]
NOW = dt.datetime.now(dt.timezone.utc)
POOLS = {'board-a': 60.0, 'board-b': 61.0, 'board-c': 59.5, 'board-d': 60.2, 'hive-a': 59.0, 'hive-b': 60.5,
         'hive-c': 61.5, 'placebo-a': 60.1, 'placebo-c': 60.0}
T = []


def t(n, ok, d=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', n, '' if ok else '\n        -> ' + str(d)[-500:]))


def txt():
    L = ['%s 5080 bots 5 items/bh %.1f' % (p, v) for p, v in POOLS.items()]
    L.append('5080-half median items/bh: 60.0')
    L += ['  %s   livelock 9 climbs 30 immobile>=30m 0' % p for p in POOLS]
    L += ['=== LEDGER', '=== MANIFEST', json.dumps({'canary_pool': None})]
    return '\n'.join(L) + '\n'


def run(src, env_extra=None, reg=None, regdir_reg=None, steady=None):
    d = tempfile.mkdtemp(prefix='drq-qs-')
    try:
        ma = os.path.join(d, 'mcai-analysis'); os.makedirs(os.path.join(ma, 'registrations')); os.makedirs(os.path.join(d, 'digest'))
        shutil.copy(DRQ, os.path.join(ma, 'drawrequire.py'))
        if reg is not None:
            json.dump(dict({'sha': 'x'}, **reg), open(os.path.join(ma, 'registrations', 'r1.json'), 'w'))
        alt = os.path.join(d, 'alt'); os.makedirs(alt)
        if regdir_reg is not None:
            json.dump(dict({'sha': 'x'}, **regdir_reg), open(os.path.join(alt, 'r1.json'), 'w'))
        open(os.path.join(ma, 'drawexposure.py'), 'w').write('print("no requirement")\n')
        open(os.path.join(ma, 'drawsteady.py'), 'w').write(
            steady or 'import os\nprint("STEADY regdir=%s" % os.environ.get("STEADY_REGDIR", ""))\nprint("STEADY RELEASE []")\n')
        tf = os.path.join(d, 'drawrec.txt'); open(tf, 'w').write(txt())
        py = src.split("python3 - <<'PY'\n", 1)[1].split('\nPY', 1)[0].replace('/tmp/drawrec.txt', tf)
        open(os.path.join(d, 'block.py'), 'w').write(py)
        env = dict(os.environ, HOME=d, DRAW_RUN='r1')
        for k in ('DRAW_RESERVE', 'DRAW_REGDIR', 'DRAW_PROBE', 'DRAW_TXT', 'STEADY_REGDIR'):
            env.pop(k, None)
        env.update({k: (v.replace('@ALT', alt) if isinstance(v, str) else v) for k, v in (env_extra or {}).items()})
        r = subprocess.run([sys.executable, os.path.join(d, 'block.py')], capture_output=True, text=True, env=env, timeout=120)
        pg = os.path.join(d, 'digest', 'page.jsonl')
        return r.returncode, r.stdout + r.stderr, (open(pg).read() if os.path.exists(pg) else '')
    finally:
        shutil.rmtree(d, ignore_errors=True)


def drawn(out):
    m = re.search(r'DRAW \((.*?)\): (\[.*\]|NONE.*)$', out, re.M)
    return re.findall(r"'([a-z]+-[a-z])'", m.group(2)) if m and m.group(2).startswith('[') else []


def cases(src):
    rc, o, _ = run(src, reg={})
    base = set(drawn(o))
    t('positive control: the unset path draws (4 pools from the band)', rc == 0 and len(base) == 4, o)
    t('instruments line printed BEFORE the DRAW line', re.search(r'^instruments: band rows 9, exposure rows 9$', o, re.M)
      and o.index('instruments:') < o.index('DRAW ('), o)
    rc, o, _ = run(src, {'DRAW_RESERVE': 'board-a,board-b,board-c,board-d,hive-a'}, reg={})
    d2 = set(drawn(o))
    t('DRAW_RESERVE: the reserved pools are never drawn', rc == 0 and d2 and not (d2 & {'board-a', 'board-b', 'board-c', 'board-d', 'hive-a'}), o)
    rc, o, _ = run(src, {'DRAW_RESERVE': 'board-a;rm -rf'}, reg={})
    t('DRAW_RESERVE malformed: refuses to draw', rc != 0 and 'DRAW_RESERVE malformed' in o, o)
    rc, o, _ = run(src, {'DRAW_REGDIR': '@ALT'}, reg={'draw_k': 1}, regdir_reg={})
    t('DRAW_REGDIR: the registration is read from the given dir (its draw, not the staged one\'s draw_k 1)',
      rc == 0 and len(drawn(o)) == 4 and 'draw_k: registration caps' not in o, o)
    t('DRAW_REGDIR: handed to drawsteady as STEADY_REGDIR', 'STEADY regdir=' in o and '/alt' in o.split('STEADY regdir=')[1].split('\n')[0], o)
    refuse = 'print("STEADY inputs unreadable or malformed (x): 12 h for every pool")\nprint("STEADY RELEASE []")\n'
    rc, o, pages = run(src, {}, reg={}, steady=refuse)
    t('positive control: a steady refusal IS paged by an ordinary draw', 'drawsteady REFUSED' in pages, (o, pages))
    rc, o, pages = run(src, {'DRAW_PROBE': '1'}, reg={}, steady=refuse)
    t('DRAW_PROBE: a steady refusal is NOT paged by the probe', pages == '' and 'NOT paged' in o, (o, pages))


MUTANTS = [
    ("    for _p in _rp:\n        excl.add(_p)", "    for _p in _rp:\n        pass"),
    ("    if not all(re.match(r'^[a-z]+-[a-z]$', x) for x in _rp):", "    if False:"),
    ("_REGDIR = os.environ.get('DRAW_REGDIR') or os.path.expanduser('~/mcai-analysis/registrations')",
     "_REGDIR = os.path.expanduser('~/mcai-analysis/registrations')"),
    ("    os.environ['STEADY_REGDIR'] = _REGDIR", "    pass"),
    ("if _refused and os.environ.get('DRAW_PROBE') == '1':", "if False:"),
    ("print('instruments: band rows %d, exposure rows %d' % (len(band), len(expo)))", "pass"),
]


def main():
    src = open(DRAWREC).read()
    cases(src)
    ok = all(T)
    print('test_drawrec_queuespeed: %d/%d pass' % (sum(T), len(T)))
    if '--mutants' not in sys.argv:
        sys.exit(0 if ok else 1)
    surv = 0
    for old, new in MUTANTS:
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: %r (%d)' % (old, src.count(old))
        del T[:]
        import io, contextlib
        with contextlib.redirect_stdout(io.StringIO()):
            cases(src.replace(old, new, 1))
        killed = not all(T)
        print('  mutant %-70r %s' % (old.strip()[:70], 'killed' if killed else 'SURVIVED'))
        surv += not killed
    print('mutants: %d of %d killed' % (len(MUTANTS) - surv, len(MUTANTS)))
    sys.exit(0 if ok and not surv else 1)


if __name__ == '__main__':
    main()
