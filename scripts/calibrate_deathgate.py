#!/usr/bin/env python3
"""Calibrate the amended death gate before it is allowed to revert anything.

The gate is not read once. `canary-loop.sh` polls it every 5 minutes for up to
nine hours -- about 108 looks -- and reverts the first time it fires. Any
false-positive figure quoted from a SINGLE read understates it badly, so this
simulates the sequence the fleet actually runs.

Death process: homogeneous Poisson per bot-hour, rate measured from the fleet
(16 deaths / 824 bot-h = 0.019/bh over the 620-minute walk on 2026-09-18).
Canary = 2 pools = 10 bots; control = the other 70.

Reported for each rule: how often a HARMLESS canary is reverted (want low), and
how often a genuinely harmful one is caught (want high). A gate is only worth
having if the second is much larger than the first.
"""
import random, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from deathgate import ratio_lower_bound

BASE = 0.019          # deaths per bot-hour, measured
CANARY_BOTS, CONTROL_BOTS = 10, 70
POLL_MIN, HOURS = 5, 9
FLOOR, THRESH = 2, 1.25


def one_canary(harm, rng, rule):
    """Run one canary to completion under `rule`; True if it reverted."""
    cd = kd = 0
    steps = int(HOURS * 60 / POLL_MIN)
    dt = POLL_MIN / 60.0
    for s in range(1, steps + 1):
        cd += sum(rng.random() < BASE * harm * dt for _ in range(CANARY_BOTS))
        kd += sum(rng.random() < BASE * dt for _ in range(CONTROL_BOTS))
        ch, kh = CANARY_BOTS * s * dt, CONTROL_BOTS * s * dt
        if cd < FLOOR:
            continue
        cr, kr = cd / ch, (kd / kh if kh else 0)
        if rule == 'old':
            if kr is not None and cr > THRESH * kr:
                return True
        else:
            if ratio_lower_bound(cd, ch, kd, kh) > THRESH:
                return True
    return False


def main():
    rng = random.Random(20260918)
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
    print("death gate calibration -- %d simulated canaries per cell" % N)
    print("base rate %.3f/bot-h, %d canary bots vs %d control, polled every %d min for %d h\n"
          % (BASE, CANARY_BOTS, CONTROL_BOTS, POLL_MIN, HOURS))
    print("%-28s %14s %14s" % ("true canary harm", "OLD gate", "AMENDED gate"))
    print("%-28s %14s %14s" % ("", "(point ratio)", "(lower bound)"))
    rows = []
    for harm, label in ((1.0, "none (1.0x) FALSE REVERT"), (1.5, "1.5x"), (2.0, "2.0x"),
                        (3.0, "3.0x"), (5.0, "5.0x"), (10.0, "10x (swim_to-scale)")):
        a = sum(one_canary(harm, random.Random(rng.random()), 'old') for _ in range(N)) / N
        b = sum(one_canary(harm, random.Random(rng.random()), 'new') for _ in range(N)) / N
        rows.append((harm, a, b))
        print("%-28s %13.1f%% %13.1f%%" % (label, a * 100, b * 100))
    null_old, null_new = rows[0][1], rows[0][2]
    print("\nfalse-revert rate: %.1f%% -> %.1f%%" % (null_old * 100, null_new * 100))
    for harm, a, b in rows[1:]:
        ro = (a / null_old) if null_old else float('inf')
        rn = (b / null_new) if null_new else float('inf')
        print("  at %4.1fx harm, detection:false = %5.1f:1 (old) vs %6s:1 (amended)"
              % (harm, ro, ('%.1f' % rn) if rn != float('inf') else 'inf'))


if __name__ == '__main__':
    main()
