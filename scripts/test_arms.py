#!/usr/bin/env python3
"""lib/arms.py -- and above all, that a POOL spec still behaves EXACTLY as it always has.

The load-bearing test is backward compatibility. Every historical canary read, every
registration and every recorded verdict depends on

    K = lambda b, era: (('canary' if b.rsplit('-', 1)[0] in CANS else 'control'), era)

so if arms.arm_of differs from that on any pool spec, the meaning of every past read changes
silently. The comparison below is against that exact expression, over the real roster.

Roster measured on the fleet 2026-09-23: 88 log directories, 80 bots actually deciding, exactly
5 live bots in each of 16 worlds. The 8 directories with no rows are all the `Charlie` bots in
the -a and -b pools -- a roster built from directories therefore contains 8 dead bots, and a
draw made from it would assign a canary to a bot that cannot run. That is a trap case here.
"""
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from arms import arm_of, pool_of, parse_spec, split_within_world, splits_a_world  # noqa: E402

WORLDS = [f'{p}-{s}' for p in ('board', 'hive', 'isolated', 'placebo') for s in 'abcd']
LIVE = [f'{w}-{n}' for w in WORLDS for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')]
DEAD = [f'{p}-{s}-Charlie' for p in ('board', 'hive', 'isolated', 'placebo') for s in 'ab']

ok = []
def check(name, got, want, why=''):
    good = got == want
    ok.append(good)
    print(f"  [{'PASS' if good else 'FAIL'}] {name}" + ('' if good else f'  got {got!r} want {want!r}'))
    if not good and why:
        print(f'         {why}')

print(f'roster: {len(LIVE)} live bots, {len(WORLDS)} worlds, {len(DEAD)} dead directories')
check('16 worlds, 5 live bots each', (len(WORLDS), len(LIVE) // len(WORLDS)), (16, 5))

# ---- 1. BACKWARD COMPATIBILITY, the one that matters -------------------------------------
old = lambda b, cans: 'canary' if b.rsplit('-', 1)[0] in cans else 'control'
HISTORICAL = [
    'placebo-d,hive-c,board-b,board-c',   # banktruth-01
    'hive-b,hive-a,board-c,hive-d',       # shoreline-01
    'board-c', 'hive-b,board-b', 'placebo-b,board-a', 'hive-c,board-b',
    'isolated-a', 'placebo-a',
]
print('\n1. a POOL spec must behave identically to the expression every read has used')
for spec in HISTORICAL:
    cans = parse_spec(spec)
    diffs = [b for b in LIVE + DEAD if arm_of(b, spec) != old(b, cans)]
    check(f'{spec[:38]:38s} identical over {len(LIVE)+len(DEAD)} bots', diffs, [])

# ---- 2. bot-level specs, which is the whole point ----------------------------------------
print('\n2. a BOT spec selects exactly those bots (the old expression could not)')
spec = 'hive-a-Alpha,hive-a-Bravo,board-c-Delta'
chosen = [b for b in LIVE if arm_of(b, spec) == 'canary']
check('exactly the three named', chosen, ['board-c-Delta', 'hive-a-Alpha', 'hive-a-Bravo'])
check('the old expression selected NONE of them', [b for b in LIVE if old(b, parse_spec(spec)) == 'canary'], [],
      'hive-a-Alpha.rsplit(-,1)[0] is hive-a, so an exact bot name never matched')
check("a sibling in the same world stays control", arm_of('hive-a-Comet', spec), 'control')

# ---- 3. the isolated arm, where pool and bot name collide ---------------------------------
print('\n3. the isolated arm: exp.pool holds single-bot values, so both rules are needed')
check('a single-bot pool value matches its bot', arm_of('isolated-a-Alpha', 'isolated-a-Alpha'), 'canary')
check('and its pool still matches the whole world', arm_of('isolated-a-Echo', 'isolated-a'), 'canary')

# ---- 4. the within-world draw -------------------------------------------------------------
print('\n4. split_within_world takes from EVERY world, reproducibly')
pick = split_within_world(LIVE, 2, random.Random(7))
byworld = {}
for b in pick:
    byworld.setdefault(pool_of(b), []).append(b)
check('32 bots drawn', len(pick), 32)
check('every world represented', len(byworld), 16)
check('exactly 2 per world', sorted({len(v) for v in byworld.values()}), [2])
check('reproducible from the seed', pick, split_within_world(LIVE, 2, random.Random(7)))
check('a different seed draws differently', pick != split_within_world(LIVE, 2, random.Random(8)), True)
check('the split gives 32 canary / 48 control',
      (len(pick), len(LIVE) - len(pick)), (32, 48))

print('\n5. it refuses rather than quietly under-treating a world')
try:
    split_within_world(LIVE, 6, random.Random(1))
    check('6 of 5 raises', 'returned', 'ValueError', 'a skipped world reintroduces the between-world term')
except ValueError as e:
    check('6 of 5 raises', 'ValueError', 'ValueError')
    print(f'         {str(e)[:100]}')

print('\n6. THE TRAP: a roster from log directories contains 8 dead bots')
bad = split_within_world(LIVE + DEAD, 2, random.Random(3))
drew_dead = sorted(set(bad) & set(DEAD))
check('a dead bot CAN be drawn from a directory roster', len(drew_dead) > 0, True,
      'the roster is the caller\'s responsibility; pass bots that decide, not directories')
print(f'         drew {len(drew_dead)} dead: {drew_dead[:3]}')

print('\n7. splits_a_world is derived from the roster, not guessed from the spec')
check('a pool spec does NOT split a world', splits_a_world('hive-a,board-c', LIVE), False)
check('a bot spec DOES split a world', splits_a_world('hive-a-Alpha,hive-a-Bravo', LIVE), True)
check('the 32-bot within-world draw splits every world',
      splits_a_world(','.join(split_within_world(LIVE, 2, random.Random(7))), LIVE), True)
check('an empty spec splits nothing', splits_a_world('', LIVE), False)
check('naming EVERY bot of a world does not split it',
      splits_a_world(','.join(b for b in LIVE if pool_of(b) == 'hive-a'), LIVE), False)

print(f'\n{sum(ok)}/{len(ok)} arms cases pass')
sys.exit(0 if all(ok) else 1)
