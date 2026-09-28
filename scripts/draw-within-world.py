#!/usr/bin/env python3
"""Draw `per_world` bots from EVERY world, reproducibly, and print the roster.

THE DRAW IS THE RANDOMIZATION, so it has to be recorded in a form that can be re-run. An unseeded
draw cannot be re-checked afterwards, and a randomization p-value is a statement about the draw --
if the recorded assignment and the realised one differ, the p-value is not conservative, it is
simply about a different experiment. So the seed is printed with the roster and belongs in the
journal beside it.

THE ROSTER COMES FROM ACTIVE SYSTEMD UNITS, NEVER FROM LOG DIRECTORIES. The fleet is 16 worlds x 5
live bots = 80, but there are 88 directories under /var/log/mcai: the 8 extra are dead `Charlie`
bots in the -a/-b pools, which have logs because they once ran. A roster built by listing
directories draws a bot that does not exist, and the deploy then treats 1 bot in that world instead
of 2 -- under-treating exactly the world the within-world design exists to pair within. This is a
named trap in scripts/test_arms.py and it is the reason --source defaults to systemd.

`split_within_world` RAISES rather than under-treating a world, so a world that is short of live
bots stops the draw here instead of producing a quietly unbalanced assignment.

  draw-within-world.py [--per-world 2] [--seed N] [--source systemd|-] [--bots "a b c"]
"""
import argparse
import os
import random
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from arms import pool_of, split_within_world                              # noqa: E402


def active_units():
    """Bot names from systemd, which is the only authority on what is running."""
    out = subprocess.run(
        ['systemctl', 'list-units', 'mcbot@*', '--state=active', '--no-legend'],
        capture_output=True, text=True, check=True).stdout
    bots = []
    for line in out.splitlines():
        unit = line.split()[0] if line.split() else ''
        if unit.startswith('mcbot@') and unit.endswith('.service'):
            bots.append(unit[len('mcbot@'):-len('.service')])
    return sorted(set(bots))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--per-world', type=int, default=2)
    ap.add_argument('--seed', type=int, default=None)
    ap.add_argument('--source', default='systemd',
                    help="'systemd' (default) or '-' to read bot names from stdin")
    ap.add_argument('--bots', default='', help='explicit roster, for testing')
    a = ap.parse_args(argv)

    if a.bots:
        roster = sorted({b for b in a.bots.replace(',', ' ').split() if b})
    elif a.source == '-':
        roster = sorted({b for b in sys.stdin.read().replace(',', ' ').split() if b})
    else:
        roster = active_units()
    if not roster:
        print('REFUSED: no active bots to draw from', file=sys.stderr)
        return 2

    worlds = {}
    for b in roster:
        worlds.setdefault(pool_of(b), []).append(b)

    seed = a.seed if a.seed is not None else random.SystemRandom().randrange(2 ** 31)
    try:
        drawn = split_within_world(roster, a.per_world, random.Random(seed))
    except ValueError as e:
        print(f'REFUSED: {e}', file=sys.stderr)
        return 2

    # A POSITIVE CONTROL ON THE DRAW ITSELF, printed so a reader does not have to trust it: every
    # world contributed, and it contributed exactly per_world bots. "16 worlds" is a claim about
    # the fleet; "16 worlds, 2 each, 32 of 80" is the same claim with its denominator.
    per = {}
    for b in drawn:
        per[pool_of(b)] = per.get(pool_of(b), 0) + 1
    bad = {w: n for w, n in per.items() if n != a.per_world}
    missing = sorted(set(worlds) - set(per))
    if bad or missing:
        print(f'REFUSED: draw is not balanced; wrong counts {bad}, worlds missed {missing}',
              file=sys.stderr)
        return 2

    print(f'SEED {seed}')
    print(f'WORLDS {len(worlds)} treated {len(drawn)} of {len(roster)} '
          f'({a.per_world} per world, {len(roster) - len(drawn)} control)')
    for w in sorted(per):
        print(f'   {w}: ' + ' '.join(b for b in drawn if pool_of(b) == w)
              + '   | control: ' + ' '.join(b for b in sorted(worlds[w]) if b not in drawn))
    print('ROSTER ' + ','.join(drawn))
    return 0


if __name__ == '__main__':
    sys.exit(main())
