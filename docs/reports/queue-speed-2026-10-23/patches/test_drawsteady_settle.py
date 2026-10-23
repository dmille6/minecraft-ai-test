#!/usr/bin/env python3
"""test_drawsteady_settle.py <PATCHED drawsteady.py> <settlerule.py> <tierrule.py> <bagread.py> [--mutants]

Design 1's WIRING (Codex r1 P2, Claude r1 P2): the patched drawsteady.py end to end on fixture files -- ledger,
journal, manifest, a registration dir, a unit list, an enabled-units roster and 7 h of skill logs for six pools of five
bots -- as scripts/test_threepool.py's steady_cli does it. Nothing live is read or written.

The world: pool-a decided KEEP 7 h ago and was promoted fleet-wide (build aaa1111); 30 min ago a SECOND fleet-wide
promotion moved EVERY pool to bbb2222. Today's rule therefore holds pool-a (and fails every control) on "one build in
the last hour"; the settle path's symmetric test (S2) sees a fleet transition and may release it.
  1 positive control: the incoming run has NO settle block -> today's answer (RELEASE [])
  2 the settle block -> RELEASE ['pool-a'] (S1-S4 pass)
  3 pool-a ran ANOTHER build until 100 min ago (asymmetric) -> held by S2
  4 pool-a's bag sits above the controls -> held by S3
  5 pool-a's bots are all deep (y 20) while the controls are at y 70 -> held by S4
  6 UNION: a second pool today's rule releases (pool-g, KEEP 7 h ago, NO second promotion in its own... ) -- see below
  7 ISOLATION: the settle measurement raises -> today's release is still printed
  8 a 1440-min declared lookback -> no settle candidate (floor past 12 h)"""
import datetime as dt, json, os, shutil, subprocess, sys, tempfile

DS, SR, TR, BR = sys.argv[1:5]
UTC = dt.timezone.utc
NOW = dt.datetime.now(UTC).replace(microsecond=0, second=0)
NAMES = ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')
T = []


def t(n, ok, d=''):
    T.append(bool(ok)); print('%s  %s%s' % ('PASS' if ok else 'FAIL', n, '' if ok else '\n        -> ' + str(d)[-900:]))


def world(d, settle=True, asym=False, bag_a=31, deep_a=False, lookback=0, noflip=False):
    """noflip: no second promotion -- every row on aaa1111, so TODAY'S rule releases pool-a (the union test)."""
    w = tempfile.mkdtemp(dir=d); logs = os.path.join(w, 'logs')
    pools = {'pool-a': bag_a, 'pool-b': 28, 'pool-c': 30, 'pool-d': 32, 'pool-e': 34, 'pool-f': 29}
    units, roster = [], []
    flip = NOW + dt.timedelta(days=1) if noflip else NOW - dt.timedelta(minutes=30)
    for p, slots in pools.items():
        for i, n in enumerate(NAMES):
            b = '%s-%s' % (p, n)
            roster.append('mcbot@%s.service' % b)
            units.append('mcbot@%s.service loaded active running x' % b)
            os.makedirs(os.path.join(logs, b))
            with open(os.path.join(logs, b, 'skill-x.jsonl'), 'w') as f:
                tt = NOW - dt.timedelta(minutes=420)
                while tt < NOW:
                    # every bot restarts onto bbb2222 within the 16-min staggered window after the fleet flip
                    v = 'bbb2222+x' if tt >= flip + dt.timedelta(seconds=12 * (i + 5 * list(pools).index(p))) else 'aaa1111+x'
                    if asym and p == 'pool-a' and tt < NOW - dt.timedelta(minutes=100):
                        v = 'ccc3333+x'
                    y = 20 if (deep_a and p == 'pool-a') else 70
                    f.write(json.dumps({'@timestamp': tt.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'code': {'version': v},
                                        'bot': {'name': b, 'inventory': {'cobblestone': 64 * slots}, 'pos': {'x': 0, 'y': y, 'z': 0}},
                                        'skill': {'name': 'gather', 'duration_ms': 0}}) + '\n')
                    tt += dt.timedelta(minutes=1.5)
    open(os.path.join(w, 'units'), 'w').write('\n'.join(units) + '\n')
    os.makedirs(os.path.join(w, 'wants'))
    for n in roster + ['mcbot@.service']:
        open(os.path.join(w, 'wants', n), 'w').write('')
    dec = NOW - dt.timedelta(hours=7)
    led = [{'canary_sha': 'aaa1111', 'canary_pool': 'pool-a', 'decision': 'KEEP', 'note': 'x-01: VERDICT KEEP (+360) :: x',
            'ts': dec.isoformat()}]
    jr = [{'ts': (dec + dt.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ'), 'run': 'x-01', 'phase': 'promoted',
           'note': 'aaa1111 fleet-wide'},
          {'ts': (flip - dt.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ'), 'run': 'y-01', 'phase': 'promoted',
           'note': 'bbb2222 fleet-wide'}]
    # y-01's own decision row names a pool no candidate test reads (pool-f stays a control? no: it is touched) -- the
    # second promotion's run decided on pool-f; its pools are held (KEEP 40 min ago), the other four stay controls
    if noflip:
        jr = jr[:1]
    else:
        led.append({'canary_sha': 'bbb2222', 'canary_pool': 'pool-f', 'decision': 'KEEP', 'note': 'y-01: VERDICT KEEP (+360) :: x',
                    'ts': (flip - dt.timedelta(minutes=20)).isoformat()})
    open(os.path.join(w, 'ledger'), 'w').write('\n'.join(json.dumps(r) for r in led) + '\n')
    open(os.path.join(w, 'journal'), 'w').write('\n'.join(json.dumps(r) for r in jr) + '\n')
    json.dump({'declared_code_version': 'aaa1111' if noflip else 'bbb2222',
               'declared_at': (dec + dt.timedelta(minutes=10)).isoformat() if noflip else flip.isoformat(), 'canary_pool': ''},
              open(os.path.join(w, 'man'), 'w'))
    rd = os.path.join(w, 'regs'); os.makedirs(rd)
    reg = {'sha': 'zzz', 'read_minutes': [180, 360]}
    if settle:
        reg['settle'] = {'lookback_min': lookback}
    json.dump(reg, open(os.path.join(rd, 'inc-01.json'), 'w'))
    return w


def run(d, w, fault=False):
    env = dict(os.environ, STEADY_LEDGER=os.path.join(w, 'ledger'), STEADY_JOURNAL=os.path.join(w, 'journal'),
               STEADY_MANIFEST=os.path.join(w, 'man'), STEADY_LOGROOT=os.path.join(w, 'logs'),
               STEADY_UNITS_FILE=os.path.join(w, 'units'), STEADY_ROSTER_DIR=os.path.join(w, 'wants'),
               STEADY_REGDIR=os.path.join(w, 'regs'), DRAW_RUN='inc-01')
    if fault == 'slow':
        # the settle measurement HANGS (a slow log scan): the hard deadline must cut it (Codex r2 P2)
        prog = ('import sys, time; sys.path.insert(0, %r); import settlerule\n'
                'settlerule.SETTLE_BUDGET_S = 2\n'
                'def slow(*a, **k):\n    time.sleep(60)\n'
                'settlerule.symmetric_build = slow\nimport drawsteady; sys.exit(drawsteady.main())\n' % d)
        r = subprocess.run([sys.executable, '-c', prog], capture_output=True, text=True, env=env, timeout=50)
        rel = [l for l in r.stdout.splitlines() if l.startswith('STEADY RELEASE ')]
        return (rel[-1][len('STEADY RELEASE '):] if rel else 'NO_LINE'), r.stdout + r.stderr[-400:]
    if fault:
        # the settle measurement raises (monkeypatched in a wrapper; production has no fault switch)
        prog = ('import sys; sys.path.insert(0, %r); import settlerule\n'
                'def boom(*a, **k): raise RuntimeError("injected")\n'
                'settlerule.symmetric_build = boom\nimport drawsteady; sys.exit(drawsteady.main())\n' % d)
        r = subprocess.run([sys.executable, '-c', prog], capture_output=True, text=True, env=env, timeout=300)
    else:
        r = subprocess.run([sys.executable, os.path.join(d, 'drawsteady.py')], capture_output=True, text=True, env=env, timeout=300)
    rel = [l for l in r.stdout.splitlines() if l.startswith('STEADY RELEASE ')]
    return (rel[-1][len('STEADY RELEASE '):] if rel else 'NO_LINE'), r.stdout + r.stderr[-400:]


def cases(ds_src):
    d = tempfile.mkdtemp(prefix='dss-')
    try:
        open(os.path.join(d, 'drawsteady.py'), 'w').write(ds_src)
        for p in (SR, TR, BR):
            shutil.copy(p, d)
        g, o = run(d, world(d, settle=False))
        t('positive control: no settle block -> today\'s answer (pool-a held on restart lag, RELEASE [])',
          g == '[]' and 'restart lag' in o and 'STEADY settle' not in o.replace('STEADY settle path closed', ''), o)
        g, o = run(d, world(d))
        t('settle block: a pool that crossed the fleet promotion WITH the fleet is released', g == "['pool-a']" and 'settle REL pool-a' in o, o)
        g, o = run(d, world(d, asym=True))
        t('S2: pool-a ran another build until 100 min ago -> held', g == '[]' and 'settle held pool-a' in o and 'S2' in o, o)
        g, o = run(d, world(d, bag_a=40))
        t('S3: pool-a\'s bag above the controls -> held (carryover)', g == '[]' and 'carryover' in o, o)
        g, o = run(d, world(d, deep_a=True))
        t('S4: pool-a deep while the controls are shallow -> held (depth)', g == '[]' and 'depth' in o, o)
        g, o = run(d, world(d), fault=True)
        t('ISOLATION: a failing settle measurement releases nothing early and is not a steady refusal',
          g == '[]' and 'settle measurement failed' in o and 'STEADY measurement failed' not in o, o)
        g, o = run(d, world(d, noflip=True))
        t('UNION positive control: with no second promotion TODAY\'S rule releases pool-a (6 h)', g == "['pool-a']" and '6h pool-a' in o, o)
        g, o = run(d, world(d, noflip=True), fault=True)
        t('UNION: a failing settle measurement never costs today\'s release', g == "['pool-a']" and 'settle measurement failed' in o, o)
        try:
            g, o = run(d, world(d, noflip=True), fault='slow')
        except subprocess.TimeoutExpired as e:
            g, o = 'TIMEOUT', str(e)
        t('DEADLINE: a hanging settle measurement is cut at its budget and today\'s release still prints',
          g == "['pool-a']" and 'TimeoutError' in o, o)
        g, o = run(d, world(d, lookback=1440))
        t('a 1440-min declared lookback -> no settle candidate (past 12 h)', g == '[]' and 'settle REL' not in o, o)
    finally:
        shutil.rmtree(d, ignore_errors=True)


MUTANTS = [
    ("            ok, why = s2(p, max(240, c[5]))", "            ok, why = True, 'S2 skipped'"),
    ("            ok, bwhy = steady(c[:3], s, sctl, man.get('declared_code_version'), c[3])", "            ok, bwhy = True, 'S3 skipped'"),
    ("            ok, dwhy = settlerule.band_ok(s['deep']", "            ok, dwhy = True, 'S4 skipped'; _x = (s['deep']"),
    ("            except Exception as e:\n                print('STEADY settle measurement failed (%s: %s): today\\'s release only'",
     "            except ZeroDivisionError as e:\n                print('STEADY settle measurement failed (%s: %s): today\\'s release only'"),
    ("        s, why = qualify(st, by_pool.get(pool, {}), fv, one_build=False)", "        s, why = qualify(st, by_pool.get(pool, {}), fv)"),
    ("            signal.alarm(int(settlerule.SETTLE_BUDGET_S))", "            signal.alarm(0)"),
]


def main():
    src = open(DS).read()
    cases(src)
    ok = all(T)
    print('test_drawsteady_settle: %d/%d pass' % (sum(T), len(T)))
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
