#!/usr/bin/env python3
"""A WITHIN-WORLD canary: 2 of 5 bots treated, 3 deliberately on baseline.

WHY. One pool is one Minecraft world, so a pool-level canary carries the whole between-world
difference in every comparison. Treating 2 of 5 bots in EVERY world removes that term -- measured
2026-09-23, the items MDE goes from +146% to +121% at 3h and +92% to +50% at 24h/arm. There is a
second reason that has nothing to do with variance: with only C(16,2)=120 possible two-pool
assignments, the smallest attainable randomization p-value is 1/120. A within-world design has no
such floor.

WHAT BREAKS WITHOUT A ROSTER. The tripper resolves arm membership from the POOL PREFIX, so all
five bots of a treated world look like canary members and the three deliberate baselines each
read as POOL_NOT_CANARY -- "canary pool bot not on canary build". That halts the fleet. The last
case below proves it, because the reason the Roster exists must be demonstrable and not merely
asserted.

THE SPLIT-SPECIFIC HAZARD, which pool-level assignment could never have: RIGHT COUNTS, WRONG
IDENTITY. Alpha and Bravo were drawn, but Alpha and Comet came up on the treatment build. The
world still shows two canary builds and three baselines, so any count-based check passes. Only an
exact roster can see it, and it must raise BOTH faults -- Bravo drawn but on baseline, Comet
treated but not drawn.

Run: python3 scripts/test_split_roster.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from version_split import Roster, canary_split_ok, in_canary_pool  # noqa: E402

BASE, CAN = '16e7e77', '2705838'
WORLD = ['hive-a-Alpha', 'hive-a-Bravo', 'hive-a-Comet', 'hive-a-Delta', 'hive-a-Echo']
OTHER = ['board-c-Alpha', 'board-c-Bravo', 'board-c-Comet']
DRAWN = Roster({'hive-a-Alpha', 'hive-a-Bravo'})

ok = []
def check(name, got, want, why=''):
    good = got == want
    ok.append(good)
    print(f"  [{'PASS' if good else 'FAIL'}] {name}" + ('' if good else f'  got {got!r} want {want!r}'))
    if not good and why:
        print(f'         {why}')


def fleet(treated):
    """Every bot's observed build. `treated` is who is actually ON the canary build."""
    s = {b: (CAN if b in treated else BASE) for b in WORLD}
    s.update({b: BASE for b in OTHER})
    return s


print('\n1. membership: a Roster is EXACT, a pool string is a prefix (unchanged)')
check('drawn bot is in the roster', in_canary_pool('hive-a-Alpha', DRAWN), True)
check('undrawn world-mate is NOT', in_canary_pool('hive-a-Comet', DRAWN), False)
check('the pool string still matches all five', 
      [in_canary_pool(b, 'hive-a') for b in WORLD], [True] * 5)
check('and a Roster is not confusable with a pool list',
      isinstance(DRAWN, Roster) and not isinstance('hive-a', Roster), True)

print('\n2. the clean split is accepted -- three baselines in the treated world are FINE')
okk, why = canary_split_ok(fleet({'hive-a-Alpha', 'hive-a-Bravo'}), BASE, CAN, DRAWN)
check('accepted', okk, True, why)
print(f'         {why}')

print('\n3. a drawn bot left on baseline is caught (its drop-in failed)')
okk, why = canary_split_ok(fleet({'hive-a-Alpha'}), BASE, CAN, DRAWN)
check('refused', okk, False)
check('it names the bot whose drop-in failed, and only that one',
      ('hive-a-Bravo' in why, 'hive-a-Comet' in why), (True, False), why)
print(f'         {why[:150]}')

print('\n4. an undrawn bot ON the canary build is caught')
okk, why = canary_split_ok(fleet({'hive-a-Alpha', 'hive-a-Bravo', 'hive-a-Comet'}), BASE, CAN, DRAWN)
check('refused', okk, False)
check('it names the undrawn bot that is on the canary build',
      ('hive-a-Comet' in why, 'hive-a-Delta' in why), (True, False), why)
print(f'         {why[:150]}')

print('\n5. THE SPLIT HAZARD: right counts, wrong identity (Bravo<->Comet swapped)')
okk, why = canary_split_ok(fleet({'hive-a-Alpha', 'hive-a-Comet'}), BASE, CAN, DRAWN)
check('refused despite an unchanged 2-of-5 count', okk, False,
      'a count-based check cannot see this; only an exact roster can')
check('BOTH bots are named -- the drawn-but-baseline and the treated-but-undrawn',
      ('hive-a-Bravo' in why and 'hive-a-Comet' in why), True, why)
print(f'         {why[:190]}')

print('\n6. everyone on baseline is not a canary')
okk, why = canary_split_ok(fleet(set()), BASE, CAN, DRAWN)
check('refused', okk, False)
print(f'         {why[:130]}')

print('\n7. WHY THE ROSTER IS NEEDED: the same fleet, declared as a whole POOL, halts')
okk, why = canary_split_ok(fleet({'hive-a-Alpha', 'hive-a-Bravo'}), BASE, CAN, 'hive-a')
check('a whole-pool declaration REFUSES the same clean split', okk, False,
      'this is the fleet-halting failure the Roster exists to prevent')
check('all three deliberate baselines are flagged as violations',
      all(b in why for b in ('hive-a-Comet', 'hive-a-Delta', 'hive-a-Echo')), True, why)
print(f'         {why[:190]}')

print(f'\n{sum(ok)}/{len(ok)} split-roster cases pass')
sys.exit(0 if all(ok) else 1)
