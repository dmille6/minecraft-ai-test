#!/usr/bin/env python3
"""test_settlerule.py [--mutants] -- behaviour tests for settlerule.py (design 1, proposed). Pure; runs anywhere.

The helpers settlerule takes as arguments are the REAL ones: tierrule.py (repo scripts/, = the live bundle part ec878a51)
and drawsteady.pools_in (repo scripts/drawsteady.py, = the live 7f34cbad). --mutants: each mutant edits ONE anchored,
UNIQUE line (asserted before it is applied, CLAUDE.md "Mutants must assert their anchor"), reloads the module and must
make at least one test fail; a surviving mutant fails the run. The positive control proves the harness can see a
missing anchor."""
import datetime as dt, importlib.util, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'settlerule.py')
REPO_SCRIPTS = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..', 'scripts'))
for d in (REPO_SCRIPTS, os.path.expanduser('~/mcai-analysis')):
    if os.path.exists(os.path.join(d, 'tierrule.py')):
        sys.path.insert(0, d)
        break
import tierrule, drawsteady

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 22, 7, 0, tzinfo=UTC)
Z = lambda t: t.isoformat().replace('+00:00', 'Z')
ago = lambda m: NOW - dt.timedelta(minutes=m)


def load(path):
    spec = importlib.util.spec_from_file_location('settlerule_under_test_%d' % abs(hash(path)), path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def row(run, pools, decision, mins_ago, note=None, sha='abcdef1'):
    return {'ts': Z(ago(mins_ago)), 'canary_pool': pools, 'decision': decision, 'canary_sha': sha,
            'note': note if note is not None else '%s: VERDICT %s (+360) :: deaths 0' % (run, decision)}


def jrow(run, phase, mins_ago, note=''):
    return {'ts': Z(ago(mins_ago)), 'run': run, 'phase': phase, 'note': note}


REG3 = {'run_id': 'x', 'read_minutes': [180, 360], 'settle': {'lookback_min': 0}}
REG2 = dict(REG3, tier=2)


def cands(S, ledger, journal, reg, tier, table=None):
    return S.candidates_settle(ledger, journal, NOW, reg, tier, drawsteady.pools_in, tierrule.close_of, tierrule.closes,
                               tierrule.run_of, table, tierrule.ledger_tier)


def tests(S):
    out = []

    def t(name, cond, detail=''):
        out.append((name, bool(cond), detail))

    # kind_of
    t('kind: KEEP promoted', S.kind_of({'decision': 'KEEP'}, 'promoted') == 'keep-promoted')
    t('kind: KEEP torn down (unpromoted) keeps today\'s rule', S.kind_of({'decision': 'KEEP'}, 'torn-down') is None)
    t('kind: INCONCLUSIVE', S.kind_of({'decision': 'INCONCLUSIVE'}, 'torn-down') == 'inconclusive')
    t('kind: a defect REVERT', S.kind_of({'decision': 'REVERT', 'note': 'own line x declares evidence=defect'}, 'torn-down') == 'revert')
    t('kind: a death-gate REVERT keeps 12 h', S.kind_of({'decision': 'REVERT', 'note': 'x: VERDICT REVERT (+180) :: death gate: 3 canary deaths'}, 'torn-down') is None)
    t('kind: a rung-linked death REVERT keeps 12 h', S.kind_of({'decision': 'REVERT', 'note': 'rung-linked death on a non-ladder change'}, 'torn-down') is None)
    # incoming_ok
    t('incoming: no settle block = today\'s rule (opt-in)', not S.incoming_ok({'read_minutes': [180]})[0])
    t('incoming: a bag fix keeps its own draw', not S.incoming_ok(dict(REG3, **{'class': 'bag-fix'}))[0])
    t('incoming: an underground-safety run keeps its own draw', not S.incoming_ok(dict(REG3, **{'class': 'underground-safety'}))[0])
    t('incoming: a draw_k cap keeps today\'s rule', not S.incoming_ok(dict(REG3, draw_k=2))[0])
    t('incoming: a bool lookback is malformed', not S.incoming_ok(dict(REG3, settle={'lookback_min': True}))[0])
    t('incoming: a well-formed tier-3 run opts in', S.incoming_ok(REG3)[0])
    # floor_for (the PROPOSED table)
    keep = {'decision': 'KEEP', 'note': ''}
    t('floor: tier-3 incoming, tier-3 KEEP promoted -> 360', S.floor_for(REG3, 3, keep, 'promoted') == 360)
    t('floor: tier-3 incoming, INCONCLUSIVE -> none (12 h, I8)', S.floor_for(REG3, 3, {'decision': 'INCONCLUSIVE'}, 'torn-down') is None)
    t('floor: tier-2 incoming -> none (today\'s v36 release only)', S.floor_for(REG2, 2, keep, 'promoted') is None)
    t('floor: a declared lookback raises the floor', S.floor_for(dict(REG3, settle={'lookback_min': 600}), 3, keep, 'promoted') == 600)
    t('floor: past 12 h there is no settle release (today\'s 12 h is shorter; no 24-h log read in drawrec\'s timeout)',
      S.floor_for(dict(REG3, settle={'lookback_min': 1440}), 3, keep, 'promoted') is None)
    t('floor: the wider I3 table reads a predecessor-tier cell',
      S.floor_for(REG2, 2, keep, 'promoted', S.TABLE_I3, 2) == 240 and S.floor_for(REG2, 2, keep, 'promoted', S.TABLE_I3, 3) == 360)
    # hold_settle
    t('hold: no floor holds', S.hold_settle(keep, 'promoted', 999, None) is not None)
    t('hold: inside the floor holds', S.hold_settle(keep, 'promoted', 359, 360) is not None)
    t('hold: at the floor releases', S.hold_settle(keep, 'promoted', 360, 360) is None)
    # candidates_settle, end to end through the real tierrule / drawsteady helpers
    led = [row('r1', 'board-a,board-b', 'KEEP', 400)]
    jr = [jrow('r1', 'promoted', 390, 'abcdef1 fleet-wide')]
    ok, held = cands(S, led, jr, REG3, 3)
    t('cands: a tier-3 KEEP promoted 390 min ago is a candidate', set(ok) == {'board-a', 'board-b'}, (ok, held))
    ok, held = cands(S, led, [jrow('r1', 'promoted', 300, 'abcdef1 fleet-wide')], REG3, 3)
    t('cands: promoted 300 min ago is held (floor 360 from the PROMOTION)', not ok and 'board-a' in held, (ok, held))
    ok, held = cands(S, led, [jrow('r1', 'promoted', 390, 'fffffff fleet-wide')], REG3, 3)
    t('cands: a promotion of ANOTHER sha does not close it', not ok, (ok, held))
    ok, held = cands(S, led + [row('r2', 'board-b', 'INCONCLUSIVE', 200)], jr + [jrow('r2', 'torn-down', 195)], REG3, 3)
    t('cands: a pool held by any other in-window decision is not released', set(ok) == {'board-a'} and 'board-b' in held, (ok, held))
    ok, held = cands(S, led, jr, {'read_minutes': [180, 360]}, 3)
    t('cands: no opt-in, no candidates', not ok and not held)
    ok, held = cands(S, [row('r1', 'board-a', 'KEEP', 13 * 60)], [jrow('r1', 'promoted', 13 * 60 - 10, 'abcdef1 fleet-wide')], REG3, 3)
    t('cands: a decision older than 12 h is not this path\'s business', not ok and not held, (ok, held))
    ok, held = cands(S, [dict(row('r1', 'board-a', 'KEEP', 400), ts='garbage')], jr, REG3, 3)
    t('cands: an unreadable ts holds', 'board-a' in held and not ok, (ok, held))
    # band_ok / depth_share
    t('band: < 4 qualified controls refuses', not S.band_ok(0.3, [0.2, 0.4, 0.5], 'd')[0])
    t('band: outside refuses', not S.band_ok(0.9, [0.2, 0.4, 0.5, 0.6], 'd')[0])
    t('band: inside passes', S.band_ok(0.45, [0.2, 0.4, 0.5, 0.6], 'd')[0])
    t('band: unmeasured candidate refuses', not S.band_ok(None, [0.2, 0.4, 0.5, 0.6], 'd')[0])
    t('depth: < 20 position rows is unmeasured', S.depth_share(19, 5) is None and abs(S.depth_share(20, 5) - 0.25) < 1e-9)
    # symmetric_build through the GATE's own asymmetric_rows (S2): a fleet transition is symmetric, a canary is not
    since = ago(240)
    nb = 24
    fleet = lambda i: 'NEW+1' if i >= 12 else 'OLD+1'
    pool = {'p-a-%d' % k: {i: {fleet(i): 30} for i in range(nb)} for k in range(5)}
    ctl = {'c-%d' % k: {i: {fleet(i): 30} for i in range(nb)} for k in range(20)}
    ok_, why = S.symmetric_build(tierrule.asymmetric_rows, pool, ctl, sorted(pool), since, NOW)
    t('S2: a pool that crossed a fleet promotion WITH the fleet is settled', ok_, why)
    pool2 = {b: {i: {('CANARY+1' if i < 6 else fleet(i)): 30} for i in range(nb)} for b in pool}
    ok_, why = S.symmetric_build(tierrule.asymmetric_rows, pool2, ctl, sorted(pool2), since, NOW)
    t('S2: a pool still on a canary build in the window is not settled', not ok_, why)
    return out


MUTANTS = [
    ("        return None if DEATH_REVERT.search(str(row.get('note') or '')) else 'revert'", "        return 'revert'"),
    ("    if mins_since_close < floor:", "    if mins_since_close < 0:"),
    ("    for p in held:\n        ok.pop(p, None)", "    for p in ():\n        ok.pop(p, None)"),
    ("    if len(cs) < MIN_CONTROLS:", "    if len(cs) < 1:"),
    ("    2: {},\n    3: {'keep-promoted': 360},", "    2: {'keep-promoted': 240},\n    3: {'keep-promoted': 360},"),
    # opt-in: an absent settle block treated as {'lookback_min': 0} (the equivalent "if False:" is not a mutant: the
    # malformed check below refuses None too -- found by this harness, round 0)
    ("    if st is None:\n        return False,", "    if st is None:\n        st = {'lookback_min': 0}\n    if False:\n        return False,"),
    ("    f = max(f, lb) if _int(lb) else f", "    f = f"),
    ("    return f if f <= MAX_FLOOR_MIN else None", "    return f"),
    ("        if how == 'promoted' and s != str(sha or '')[:7]:", None),     # lives in tierrule: see the positive control
    ("    if (reg.get('class') or '') in NO_SETTLE_CLASSES:", "    if False:"),
    ("        if age_s < -600 or age_s >= EXCL_H * 3600:", "        if age_s < -600:"),
]


def run_suite(S):
    res = tests(S)
    return [r for r in res if not r[1]], len(res)


def main():
    S = load(SRC)
    bad, n = run_suite(S)
    for name, ok, d in run_suite(S)[0]:
        print('FAIL', name, d)
    print('test_settlerule: %d/%d pass' % (n - len(bad), n))
    if '--mutants' not in sys.argv:
        sys.exit(1 if bad else 0)
    src = open(SRC).read()
    # POSITIVE CONTROL of the harness: an anchor that is not in this file must be reported, never scored as killed
    # the harness's own anchor assertion must FIRE on an anchor that is not in the file (Claude r1 P3: asserting the
    # string's absence is not the same as seeing the guard refuse it)
    missing = [a for a, b in MUTANTS if b is None]
    fired = 0
    for a in missing:
        try:
            assert src.count(a) == 1, 'ANCHOR MISSING OR NOT UNIQUE'
        except AssertionError:
            fired += 1
    assert missing and fired == len(missing), 'the anchor assertion did not fire on an absent anchor'
    print('positive control: the anchor assertion fired on %d absent anchor(s); they are refused, never scored' % fired)
    survived = 0
    for old, new in MUTANTS:
        if new is None:
            continue
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: %r (%d)' % (old, src.count(old))
        p = SRC + '.mutant.py'
        open(p, 'w').write(src.replace(old, new, 1))
        try:
            fails, _ = run_suite(load(p))
        except Exception as e:
            fails = [('crash', False, repr(e))]
        finally:
            os.remove(p)
        print('  mutant %-70r %s' % (old.strip()[:70], 'killed by %d test(s)' % len(fails) if fails else 'SURVIVED'))
        survived += not fails
    print('mutants: %d of %d killed' % (len([m for m in MUTANTS if m[1]]) - survived, len([m for m in MUTANTS if m[1]])))
    sys.exit(1 if (bad or survived) else 0)


if __name__ == '__main__':
    main()
