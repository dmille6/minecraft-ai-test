#!/usr/bin/env python3
"""THE MANIFEST CONTRACT for a within-world canary, and the backward compatibility it must not break.

THE WHOLE RISK IS BACKWARD COMPATIBILITY. Every historical canary read, every registration and the
tripper itself resolve membership from `canary_pool` by prefix. So section 1 shows a legacy
declaration behaving identically rather than asserting that it does, and sections 3-4 show what an
older prefix-only reader does when it meets a split canary -- which is the property the design
turns on and the only one that cannot be fixed by updating a reader, because the reader that has
not been updated is the whole problem.

Run: python3 scripts/test_canary_manifest.py
"""
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))

import canary_manifest as cm                                              # noqa: E402
from version_split import Roster, canary_split_ok, in_canary_pool         # noqa: E402

ok = []


def check(name, got, want, why=''):
    good = got == want
    ok.append(good)
    print(f"  [{'PASS' if good else 'FAIL'}] {name}" + ('' if good else f'  got {got!r} want {want!r}'))
    if why:
        print(f'         {why}')


def raises(name, fn, needle=''):
    try:
        fn()
    except cm.InvalidManifest as e:
        good = needle.lower() in str(e).lower()
        ok.append(good)
        print(f"  [{'PASS' if good else 'FAIL'}] {name}")
        print(f'         {str(e)[:150]}')
        return
    except Exception as e:
        ok.append(False)
        print(f'  [FAIL] {name}  raised {type(e).__name__}, not InvalidManifest: {e}')
        return
    ok.append(False)
    print(f'  [FAIL] {name}  did NOT raise')


# The real fleet: 16 worlds x 5 bots. The 8 dead Charlie log dirs are deliberately absent -- they
# are not bots, and a roster that contains one is a trap named in test_arms.py.
POOLS = [f'{a}-{b}' for a in ('hive', 'board', 'placebo', 'isolated') for b in 'abcd']
FLEET = [f'{p}-{s}' for p in POOLS for s in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')]
DRAWN = sorted([f'{p}-{s}' for p in POOLS for s in ('Alpha', 'Bravo')])
BASE, CAN = '16e7e77', '2705838'

print('\n1. LEGACY: a whole-pool declaration is unchanged in every respect')
leg = cm.declare('rl-13', BASE, canary_sha=CAN, pool='hive-a,board-c', notes='n')
check('canary_pool is the pool string, exactly as the heredoc wrote it',
      leg['canary_pool'], 'hive-a,board-c')
check('no split fields are added', ('canary_split' in leg or 'canary_roster' in leg), False)
dl = cm.load(leg)
check('membership is the STRING, so in_canary_pool takes its prefix branch',
      isinstance(dl.canary_members, str) and not isinstance(dl.canary_members, Roster), True)
check('and it selects all five bots of each named pool, as it always has',
      sorted(b for b in FLEET if in_canary_pool(b, dl.canary_members)),
      sorted(b for b in FLEET if b.startswith('hive-a-') or b.startswith('board-c-')))
check('pools_of is the comma split', dl.pools, ['hive-a', 'board-c'])
check('a manifest with no canary at all loads and says so',
      cm.load(cm.declare('rl-13', BASE)).has_canary, False)

print('\n2. WITHIN-WORLD: the roster is exact membership')
spl = cm.declare('rl-14', BASE, canary_sha=CAN, roster=DRAWN)
d = cm.load(spl)
check('canary_roster holds the drawn bots', spl['canary_roster'], DRAWN)
check('membership is a Roster, not a string', isinstance(d.canary_members, Roster), True)
check('a drawn bot is in it', in_canary_pool('hive-a-Alpha', d.canary_members), True)
check('its undrawn world-mate is NOT', in_canary_pool('hive-a-Comet', d.canary_members), False)
check('pools are DERIVED from the roster, not stored', d.pools, sorted(POOLS))
check('32 of 80 treated, 2 per world', (len(d.roster), len(set(d.pools))), (32, 16))
check('members_of hydrates straight from the raw manifest dict',
      isinstance(cm.members_of(spl), Roster), True,
      'this is the step without which the Roster branch is unreachable from any on-disk manifest')

print('\n3. THE STRUCTURAL GUARANTEE: an older prefix-only reader resolves a split canary to EMPTY')
sent = spl['canary_pool']
check('canary_pool is a sentinel', sent, 'split:rl-14')
old_reader = sorted(b for b in FLEET if in_canary_pool(b, sent))
check('a prefix reader selects NOBODY -- never five bots of a world', old_reader, [])
check('sentinel_is_unmatchable agrees, checked against the roster itself',
      cm.sentinel_is_unmatchable(sent, DRAWN), True)
# POSITIVE CONTROL. An empty result is only evidence if the same matcher can find something.
check('POSITIVE CONTROL: the same matcher finds 10 bots for a legacy pool spec',
      len([b for b in FLEET if in_canary_pool(b, 'hive-a,board-c')]), 10)

print('\n4. AND EMPTY FAILS CLOSED -- it is refused, not quietly accepted')
seen = {b: (CAN if b in DRAWN else BASE) for b in FLEET}
okk, why = canary_split_ok(seen, BASE, CAN, sent)
check('the split gate REFUSES a canary it cannot resolve', okk, False)
check('and it names bots rather than halting the fleet as ALL-undeclared',
      'on a canary build, not in its pool' in why, True, why[:140])
okk2, _ = canary_split_ok(seen, BASE, CAN, Roster(DRAWN))
check('while the hydrated Roster ACCEPTS the identical fleet', okk2, True,
      'same observation, same shas: the only difference is that membership was resolved')
# The alternative design, shown failing, because "we could have put the pools in canary_pool" is
# the obvious objection and it is the one that is silently wrong.
# Declare THE SAME 32 treated bots as their 16 pools -- the honest comparison. Naming only two of
# the sixteen would mix in a second, different fault ("on a canary build, not in its pool") for the
# other fourteen worlds and crowd the message, so the first attempt at this case asserted on a bot
# that fell outside the six-bot truncation.
okk3, why3 = canary_split_ok(seen, BASE, CAN, ','.join(POOLS))
check('DECLARING THE POOLS INSTEAD would flag every deliberate baseline as a violation', okk3, False)
# The message truncates at six bots, so assert on the world that sorts first rather than on a
# world that happens to fall outside the cut -- an assertion that depends on truncation order is
# the kind that passes for the wrong reason.
check('naming the 3 undrawn bots of the first world as faults',
      all(f'board-a-{s}' in why3 for s in ('Comet', 'Delta', 'Echo')), True,
      'that is a fleet halt, and it is why the pools cannot go in canary_pool')

print('\n5. fleet-recycle.sh reads canary_pool as RAW TEXT, and must still see a live canary')
# scripts/fleet-recycle.sh: grep -q '"canary_pool": *"[^"]\+"'. A JSON LIST of bot names would not
# match, the recycle would proceed, and every bot would restart onto $H/src -- dissolving the canary
# silently. This is the concrete reason the sentinel is a non-empty string.
import json                                                              # noqa: E402
import re                                                                # noqa: E402
RECYCLE = re.compile(r'"canary_pool": *"[^"]+"')
check('the sentinel matches the recycle guard, so the canary is protected',
      bool(RECYCLE.search(json.dumps(spl, indent=2))), True)
check('a legacy declaration matches it too, unchanged',
      bool(RECYCLE.search(json.dumps(leg, indent=2))), True)
check('CONTROL: a torn-down manifest does NOT match, so recycling is allowed again',
      bool(RECYCLE.search(json.dumps(cm.cleared(spl), indent=2))), False)
naive = dict(spl); naive['canary_pool'] = DRAWN
check('and the rejected alternative -- a JSON list -- would NOT match: recycle dissolves it',
      bool(RECYCLE.search(json.dumps(naive, indent=2))), False)

print('\n6. REFUSALS: every ambiguous declaration is INVALID, never a fallback')
raises('a split tag with no roster', lambda: cm.load(
    {'run_id': 'r', 'declared_code_version': BASE, 'canary_code_version': CAN,
     'canary_pool': 'split:r', 'canary_split': 'within-world'}), 'refused rather than falling back')
raises('a split tag whose canary_pool names real pools', lambda: cm.load(
    {'run_id': 'r', 'declared_code_version': BASE, 'canary_code_version': CAN,
     'canary_pool': 'hive-a', 'canary_split': 'within-world',
     'canary_roster': ['hive-a-Alpha']}), 'must declare canary_pool as split:')
raises('a roster with no split tag', lambda: cm.load(
    {'run_id': 'r', 'declared_code_version': BASE, 'canary_code_version': CAN,
     'canary_pool': '', 'canary_roster': ['hive-a-Alpha']}), 'ambiguous')
raises('a sentinel with no split tag', lambda: cm.load(
    {'run_id': 'r', 'declared_code_version': BASE, 'canary_code_version': CAN,
     'canary_pool': 'split:r'}), 'no reader can resolve')
raises('bot IDs in canary_pool (the deploy appends a dash and matches nobody)', lambda: cm.load(
    {'run_id': 'r', 'declared_code_version': BASE, 'canary_code_version': CAN,
     'canary_pool': 'hive-a-Alpha,hive-a-Bravo'}), 'carries bot id')
raises('a sentinel naming a different run', lambda: cm.load(
    {'run_id': 'rl-14', 'declared_code_version': BASE, 'canary_code_version': CAN,
     'canary_pool': 'split:rl-99', 'canary_split': 'within-world',
     'canary_roster': ['hive-a-Alpha']}), 'does not match this run')
raises('membership with no canary build', lambda: cm.load(
    {'run_id': 'r', 'declared_code_version': BASE, 'canary_pool': 'hive-a'}), 'no canary_code_version')
raises('a canary build with no membership', lambda: cm.load(
    {'run_id': 'r', 'declared_code_version': BASE, 'canary_code_version': CAN,
     'canary_pool': ''}), 'no membership')
raises('an unknown split design', lambda: cm.load(
    {'run_id': 'r', 'declared_code_version': BASE, 'canary_code_version': CAN,
     'canary_pool': 'split:r', 'canary_split': 'per-biome',
     'canary_roster': ['hive-a-Alpha']}), 'unknown canary_split')
raises('declaring a pool AND a roster', lambda: cm.declare(
    'r', BASE, canary_sha=CAN, pool='hive-a', roster=['hive-a-Alpha']), 'not both')

print('\n6b. worlds_touched: the two protective guards must not fail OPEN on a sentinel')
# drawrec.sh excludes pools a canary used in the last 12h; reseed-pool.sh refuses to DELETE a world
# a canary is using. Both split canary_pool on commas, which for a split canary yields the sentinel
# and no world -- so both would have allowed the thing they exist to prevent.
# DECLARATION ORDER, not sorted: for a legacy manifest this is exactly parse_pool_list, the same
# comma split every existing reader does, so the value is byte-identical to what they saw before.
# Only the roster-derived path sorts, because a set has no order to preserve.
check('a legacy manifest resolves to its pools in declaration order, unchanged',
      cm.worlds_touched(leg), ['hive-a', 'board-c'])
check('a split manifest resolves to all 16 worlds via the roster',
      cm.worlds_touched(spl), sorted(POOLS))
check('a LEDGER ROW with the roster resolves the same way',
      cm.worlds_touched({'canary_pool': 'split:rl-14', 'canary_roster': DRAWN}), sorted(POOLS))
check('a sentinel with NO roster is ALL_WORLDS, never an empty set',
      cm.worlds_touched({'canary_pool': 'split:rl-14'}), [cm.ALL_WORLDS],
      'an old ledger row must make these guards refuse, not wave a world deletion through')
check('THE OLD COMMA SPLIT would have resolved that to a non-world and excluded nothing',
      [p.strip() for p in 'split:rl-14'.split(',') if p.strip()] , ['split:rl-14'])
check('no canary touches no world', cm.worlds_touched(cm.cleared(spl)), [])
check('and it never raises, whatever it is handed',
      [cm.worlds_touched(x) for x in (None, {}, {'canary_pool': None}, 'nonsense')],
      [[], [], [], []], 'a protective guard that raises is a guard that did not run')

print('\n7. TEARDOWN clears all four fields, not the two a legacy teardown knew about')
cl = cm.cleared(spl)
check('canary_pool and canary_code_version are None',
      (cl['canary_pool'], cl['canary_code_version']), (None, None))
check('canary_split and canary_roster are GONE',
      ('canary_split' in cl or 'canary_roster' in cl), False)
check('and the result loads as no canary', cm.load(cl).has_canary, False)
half = dict(spl); half['canary_pool'] = None; half['canary_code_version'] = None
raises('THE OLD TWO-KEY CLEAR leaves an unreadable manifest', lambda: cm.load(half),
       'no canary_code_version')

# ---------------------------------------------------------------------------------------------
# MUTANTS. Every one asserts its anchor is PRESENT and UNIQUE, and the mutated source is written to
# a temp copy of lib/ -- never into the real tree. A mutant that silently fails to apply reads as
# "killed", and one that writes into src has killed a test runner in this repo before.
# ---------------------------------------------------------------------------------------------
print('\n8. MUTANTS: each guard is seen to fail')


def with_mutant(anchor, replacement, probe):
    """Apply one edit to a COPY of lib/canary_manifest.py and run `probe` against it."""
    src_path = os.path.join(HERE, 'lib', 'canary_manifest.py')
    with open(src_path) as fh:
        src = fh.read()
    n = src.count(anchor)
    assert n == 1, f'ANCHOR NOT UNIQUE ({n} occurrences): {anchor[:60]!r}'
    # SHADOW ONE FILE, NEVER COPY THE WHOLE lib/. Copying lib/ and putting the copy first on
    # sys.path also re-imports version_split, so `Roster` becomes a DIFFERENT CLASS OBJECT from the
    # one the fixture Declarations were built with -- `isinstance(spec, Roster)` then returns False,
    # in_canary_pool silently takes its prefix branch, and every mutant "dies" because membership
    # resolved to nobody. Two mutants scored as killed for exactly that reason before this was
    # found: a mutant that dies to a harness artefact is indistinguishable from a missing test.
    # Only the mutated module is shadowed; everything it imports stays the real object.
    tmp = tempfile.mkdtemp(prefix='cmmut.')
    try:
        with open(os.path.join(tmp, 'canary_manifest.py'), 'w') as fh:
            fh.write(src.replace(anchor, replacement, 1))
        saved = list(sys.path)
        sys.modules.pop('canary_manifest', None)
        sys.path.insert(0, tmp)
        try:
            import canary_manifest as mutated
            assert os.path.dirname(mutated.__file__) == tmp, \
                'the mutant did not shadow the real module'
            return probe(mutated)
        finally:
            sys.path[:] = saved
            sys.modules.pop('canary_manifest', None)
            import canary_manifest  # noqa: F401  restore the real one for later cases
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def survives(mod, man):
    """True when the mutant ACCEPTS a manifest the real loader refuses."""
    try:
        mod.load(man)
        return True
    except mod.InvalidManifest:
        return False


check('MUTANT: delete the missing-roster refusal -> a split canary with no roster is accepted',
      with_mutant(
          "        if not roster:\n            raise InvalidManifest(\n                'canary_split is set but canary_roster is empty",
          "        if False:\n            raise InvalidManifest(\n                'canary_split is set but canary_roster is empty",
          lambda m: survives(m, {'run_id': 'r', 'declared_code_version': BASE,
                                 'canary_code_version': CAN, 'canary_pool': 'split:r',
                                 'canary_split': 'within-world'})),
      True, 'the guard is load-bearing: without it the fallback this design forbids comes back')

# THE SENTINEL REQUIREMENT IS GUARDED THREE TIMES, discovered by this mutant surviving. Deleting
# `is_sentinel` alone changes nothing for the obvious probe, because the run-id match
# (pool != split_sentinel(run_id)) and then sentinel_is_unmatchable each refuse it independently.
# Recorded rather than hidden: a mutant that dies to a neighbouring line is not evidence about the
# line it edited. The probe below removes the other two from play -- no run_id, and a roster that
# cannot prefix-match the pool -- so `is_sentinel` is the only thing standing, and it is seen to be
# what refuses.
check('MUTANT: delete the sentinel requirement -> a non-sentinel split declaration is accepted',
      with_mutant(
          "        if not is_sentinel(pool):\n            raise InvalidManifest(",
          "        if False:\n            raise InvalidManifest(",
          lambda m: survives(m, {'declared_code_version': BASE,
                                 'canary_code_version': CAN, 'canary_pool': 'board-c',
                                 'canary_split': 'within-world',
                                 'canary_roster': ['hive-a-Alpha']})),
      True, 'and an older reader would then resolve that canary to all five bots of board-c')
check('CONTROL: the real module refuses that same manifest', survives(cm, {
          'declared_code_version': BASE, 'canary_code_version': CAN, 'canary_pool': 'board-c',
          'canary_split': 'within-world', 'canary_roster': ['hive-a-Alpha']}), False)

check('MUTANT: delete the bot-ID refusal -> a pasted roster in canary_pool is accepted',
      with_mutant(
          "    bad = [e for e in parse_pool_list(pool) if looks_like_bot_id(e)]",
          "    bad = []",
          lambda m: survives(m, {'run_id': 'r', 'declared_code_version': BASE,
                                 'canary_code_version': CAN,
                                 'canary_pool': 'hive-a-Alpha,hive-a-Bravo'})),
      True, 'the deploy appends a dash, so that canary would have targeted nobody')

check('MUTANT: a sentinel that can prefix-match is caught by sentinel_is_unmatchable',
      with_mutant("SENTINEL_PREFIX = 'split:'", "SENTINEL_PREFIX = 'split-'",
                  lambda m: survives(m, {'run_id': 'rl-14', 'declared_code_version': BASE,
                                         'canary_code_version': CAN,
                                         'canary_pool': 'split-rl-14',
                                         'canary_split': 'within-world',
                                         'canary_roster': ['split-rl-14-Alpha']})),
      False, 'the check is on what MATCHES, not on the spelling, so a dash sentinel is refused '
             'when a bot could live under it')

check('CONTROL: with no mutant the real module still refuses all four', all(
      not survives(cm, m) for m in (
          {'run_id': 'r', 'declared_code_version': BASE, 'canary_code_version': CAN,
           'canary_pool': 'split:r', 'canary_split': 'within-world'},
          {'run_id': 'r', 'declared_code_version': BASE, 'canary_code_version': CAN,
           'canary_pool': 'hive-a', 'canary_split': 'within-world',
           'canary_roster': ['hive-a-Alpha']},
          {'run_id': 'r', 'declared_code_version': BASE, 'canary_code_version': CAN,
           'canary_pool': 'hive-a-Alpha,hive-a-Bravo'},
          {'run_id': 'r', 'declared_code_version': BASE, 'canary_code_version': CAN,
           'canary_pool': 'split:r'})), True)

print(f'\n{sum(ok)}/{len(ok)} canary-manifest cases pass')
sys.exit(0 if all(ok) else 1)
