#!/usr/bin/env python3
"""THE DEPLOY VERIFIER, which until now could only count distinct version strings.

The count is blind to identity. Section 2 is the whole point of this file: a within-world canary
where ONE drop-in of the declared set silently failed still shows exactly two builds, so the count
passes and the canary runs on fewer bots than it declared, for hours, with the manifest saying
otherwise. Nothing but the declared roster can see it, and section 2 shows the count passing on the
same fleet the roster rejects.

Run: python3 scripts/test_deployverify.py
"""
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))

import canary_manifest as cm                                              # noqa: E402
import deployverify as dv                                                 # noqa: E402

ok = []


def check(name, got, want, why=''):
    good = got == want
    ok.append(good)
    print(f"  [{'PASS' if good else 'FAIL'}] {name}" + ('' if good else f'  got {got!r} want {want!r}'))
    if why:
        print(f'         {why}')


def msgs(findings, level=None):
    return ' | '.join(m for lv, m in findings if level is None or lv == level)


POOLS = ['hive-a', 'hive-b', 'board-c', 'board-d']
FLEET = [f'{p}-{s}' for p in POOLS for s in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')]
DRAWN = sorted(f'{p}-{s}' for p in POOLS for s in ('Alpha', 'Bravo'))
BASE, CAN = '16e7e77+aa11bb', '2705838+cc22dd'
SPLIT = cm.load(cm.declare('rl-14', '16e7e77', canary_sha='2705838', roster=DRAWN))
LEGACY = cm.load(cm.declare('rl-13', '16e7e77', canary_sha='2705838', pool='hive-a'))
NOCAN = cm.load(cm.declare('rl-12', '16e7e77'))


def fleet(treated):
    return {b: (CAN if b in treated else BASE) for b in FLEET}


print('\n1. A clean within-world deploy verifies')
good, f = dv.verify(fleet(DRAWN), SPLIT, live=FLEET)
check('verified', good, True)
check('and it says so per bot, not just per build',
      'every one of 8 reporting declared bot(s)' in msgs(f), True, msgs(f, 'OK')[:180])

print('\n2. ONE DROP-IN OF THE DECLARED SET FAILED -- what a count cannot see')
broke = set(DRAWN) - {'hive-a-Bravo'}
seen = fleet(broke)
check('POSITIVE CONTROL: the fleet still shows exactly TWO builds, so a count check PASSES',
      len(set(seen.values())), 2)
good, f = dv.verify(seen, SPLIT, live=FLEET)
check('the roster check FAILS', good, False)
check('and it names the one bot', 'hive-a-Bravo is a DECLARED canary' in msgs(f), True,
      msgs(f, 'FAIL')[:190])
check('the green summary line is SUPPRESSED when something failed',
      'within-world split verified by roster' in msgs(f), False,
      'it used to print unconditionally, ending a failed deploy on a green line')

print('\n3. SILENCE: reported for a control, FATAL for a treated bot')
quiet_ctl = {b: v for b, v in fleet(DRAWN).items() if b != 'hive-a-Echo'}
good, f = dv.verify(quiet_ctl, SPLIT, live=FLEET)
check('a quiet CONTROL does not fail the deploy', good, True)
check('it is reported as not-yet-logged', 'have not logged since the restart yet' in msgs(f, 'WARN'),
      True)
quiet_tr = {b: v for b, v in fleet(DRAWN).items() if b != 'hive-a-Alpha'}
good, f = dv.verify(quiet_tr, SPLIT, live=FLEET)
check('a quiet TREATED bot FAILS it', good, False)
check('because its drop-in is unverified, and it is named',
      'hive-a-Alpha' in msgs(f, 'FAIL') and 'unverified' in msgs(f, 'FAIL'), True,
      'silence on a treated bot cannot be told from a drop-in that never applied')

print('\n4. CONTAMINATION: a control that restarted onto canary source')
seen = fleet(DRAWN); seen['hive-a-Echo'] = CAN
good, f = dv.verify(seen, SPLIT, live=FLEET)
check('refused', good, False)
check('and the contaminated control is NAMED, not reported as a second baseline',
      'hive-a-Echo' in msgs(f, 'FAIL') and 'contamination' in msgs(f, 'FAIL').lower(), True,
      'the 2026-08-30 case: board-d-Bravo ran canary code as a control for hours')

print('\n5. LEGACY whole-pool: unchanged')
leg_treated = [b for b in FLEET if b.startswith('hive-a-')]
good, f = dv.verify(fleet(leg_treated), LEGACY, live=FLEET)
check('a clean pool canary verifies', good, True)
good, f = dv.verify(fleet(leg_treated[:4]), LEGACY, live=FLEET)
check('a pool member left on baseline still fails', good, False)
check('naming it', 'hive-a-Echo' in msgs(f, 'FAIL'), True)

print('\n6. FLEET DEPLOY (no canary declared): exactly ONE build')
good, f = dv.verify({b: BASE for b in FLEET}, NOCAN, live=FLEET)
check('one build verifies', good, True)
split = {b: BASE for b in FLEET}; split['hive-a-Alpha'] = CAN
good, f = dv.verify(split, NOCAN, live=FLEET)
check('two builds with no declaration fails', good, False)
check('with the fleet-split wording', 'aggregates blend two builds' in msgs(f), True)
good, f = dv.verify({}, NOCAN, live=FLEET)
check('nothing observed is UNKNOWN, never confirmed', good, False)
check('and says exactly that', 'convergence is UNKNOWN' in msgs(f), True)

print('\n7. TEARDOWN asserts ONE build, not the remembered two')
good, f = dv.teardown_ok({b: BASE for b in FLEET}, NOCAN)
check('all bots on the single declared build: verified', good, True)
still = {b: BASE for b in FLEET}
for b in DRAWN[:3]:
    still[b] = CAN
good, f = dv.teardown_ok(still, NOCAN)
check('bots still on canary code FAIL the teardown', good, False)
check('and they are named as step 3 not having happened',
      all(b in msgs(f) for b in DRAWN[:3]) and 'step 3' in msgs(f), True,
      'the 2026-09-04 case: a "complete" two-step teardown left five bots on the canary build')
good, f = dv.teardown_ok({b: BASE for b in FLEET}, SPLIT)
check('a manifest that still declares a canary FAILS teardown', good, False)
check('naming step 2', 'step 2 did not happen' in msgs(f), True)
good, f = dv.teardown_ok({}, NOCAN)
check('no reports after the restarts is UNVERIFIED, not success', good, False)

print('\n8. latest_per_bot: the restart mark, and newest-wins')
t = datetime(2026, 9, 23, 12, 0, tzinfo=timezone.utc)
rows = [('a', t - timedelta(minutes=5), 'OLD'), ('a', t + timedelta(minutes=1), 'NEW'),
        ('b', t - timedelta(minutes=5), 'OLD')]
got = dv.latest_per_bot(rows, since=t)
check('a pre-restart line is dropped, so a quiet bot is quiet rather than "on the old code"',
      got, {'a': 'NEW'})
check('without a mark, the newest line wins', dv.latest_per_bot(rows), {'a': 'NEW', 'b': 'OLD'})

# ---------------------------------------------------------------------------------------------
print('\n9. MUTANTS: each check is seen to fail')


def with_mutant(anchor, replacement, probe):
    src_path = os.path.join(HERE, 'lib', 'deployverify.py')
    with open(src_path) as fh:
        src = fh.read()
    n = src.count(anchor)
    assert n == 1, f'ANCHOR NOT UNIQUE ({n} occurrences): {anchor[:70]!r}'
    # SHADOW ONE FILE, NEVER COPY THE WHOLE lib/. Copying lib/ and putting the copy first on
    # sys.path also re-imports version_split, so `Roster` becomes a DIFFERENT CLASS OBJECT from the
    # one the fixture Declarations were built with -- `isinstance(spec, Roster)` then returns False,
    # in_canary_pool silently takes its prefix branch, and every mutant "dies" because membership
    # resolved to nobody. Two mutants scored as killed for exactly that reason before this was
    # found: a mutant that dies to a harness artefact is indistinguishable from a missing test.
    # Only the mutated module is shadowed; everything it imports stays the real object.
    tmp = tempfile.mkdtemp(prefix='dvmut.')
    try:
        with open(os.path.join(tmp, 'deployverify.py'), 'w') as fh:
            fh.write(src.replace(anchor, replacement, 1))
        saved = list(sys.path)
        sys.modules.pop('deployverify', None)
        sys.path.insert(0, tmp)
        try:
            import deployverify as mutated
            assert os.path.dirname(mutated.__file__) == tmp, \
                'the mutant did not shadow the real module'
            return probe(mutated)
        finally:
            sys.path[:] = saved
            sys.modules.pop('deployverify', None)
            import deployverify  # noqa: F401
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


check('MUTANT: drop the per-bot build check -> the failed drop-in is accepted',
      with_mutant(
          "        if seen[bot] != want:",
          "        if False:",
          lambda m: m.verify(fleet(set(DRAWN) - {'hive-a-Bravo'}), SPLIT, live=FLEET)[0]),
      True, 'this is the identity check; without it only the count remains, and the count passes')

check('MUTANT: treat a silent declared bot as merely quiet -> accepted',
      with_mutant(
          "    if treated_quiet:\n        add(FAIL,",
          "    if False:\n        add(FAIL,",
          lambda m: m.verify({b: v for b, v in fleet(DRAWN).items() if b != 'hive-a-Alpha'},
                             SPLIT, live=FLEET)[0]),
      True, 'the asymmetry between control silence and treated silence is load-bearing')

check('MUTANT: teardown expecting TWO builds -> a correct teardown is called a failure',
      with_mutant(
          "    if len(versions) != 1:",
          "    if len(versions) != 2:",
          lambda m: m.teardown_ok({b: BASE for b in FLEET}, NOCAN)[0]),
      False, "CLAUDE.md's remembered 'exactly two' is the count while a canary IS declared; "
             'after step 2 cleared it, two live builds is the failure, not the goal')

check('CONTROL: unmutated, all three of those verdicts are the opposite', (
      dv.verify(fleet(set(DRAWN) - {'hive-a-Bravo'}), SPLIT, live=FLEET)[0],
      dv.verify({b: v for b, v in fleet(DRAWN).items() if b != 'hive-a-Alpha'}, SPLIT, live=FLEET)[0],
      dv.teardown_ok({b: BASE for b in FLEET}, NOCAN)[0]), (False, False, True))

print(f'\n{sum(ok)}/{len(ok)} deploy-verify cases pass')
sys.exit(0 if all(ok) else 1)
