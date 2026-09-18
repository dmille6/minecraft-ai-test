#!/usr/bin/env python3
"""Behavioural tests for the amended death gate.

The cases that matter are the ones this project has actually lived through:
falls-01 (a report-only instrument reverted on two idle deaths), swim_to (real
harm that MUST still revert), and the owner's floor (one death is never a
verdict, however lopsided the rates look).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from deathgate import death_gate, ratio_lower_bound

FAILS = []


def check(name, cond, detail=''):
    print(('  ok   ' if cond else '  FAIL ') + name + (('  -- ' + detail) if detail and not cond else ''))
    if not cond:
        FAILS.append(name)


def main():
    # 1. falls-01, the real numbers: 2 canary deaths in 23.9 bot-h against 3
    #    control deaths in 168 bot-h. Point ratio 4.7x, which the old gate
    #    reverted on. Two deaths cannot distinguish that from noise.
    rev, why = death_gate(2, 23.9, 3, 168)
    check('falls-01 (2 vs 3 deaths) does NOT revert', not rev)
    check('...and the reason names the denominator', 'bot-h' in why and '23.9' in why, why[:70])

    # 2. The owner's floor is untouched: one death is never a verdict, even
    #    against a control fleet that has not died at all.
    rev, why = death_gate(1, 5.0, 0, 500)
    check('one death never reverts, however lopsided', not rev)
    check('...and says it is the floor', 'floor' in why, why[:60])

    # 3. REAL HARM MUST STILL REVERT. swim_to tripled drowning deaths; at that
    #    effect size, once enough deaths have accrued, the bound clears 1.25x.
    rev, _ = death_gate(12, 240, 20, 1200)
    check('a sustained 3x with 12 deaths still reverts', rev)
    rev, _ = death_gate(6, 100, 4, 700)
    check('a large effect with 6 deaths still reverts', rev)

    # 4. A canary at exactly the control rate never reverts, at any scale.
    for a, ta, b, tb in ((2, 100, 20, 1000), (10, 500, 20, 1000), (40, 2000, 80, 4000)):
        rev, _ = death_gate(a, ta, b, tb)
        check('equal rates do not revert (%d/%d vs %d/%d)' % (a, ta, b, tb), not rev)

    # 5. No control exposure is not evidence of harm.
    rev, why = death_gate(3, 30, 0, 0)
    check('no control exposure does not revert', not rev)
    check('...and says so rather than dividing by zero', 'no control exposure' in why, why[:60])

    # 6. The bound is a bound: it never exceeds the point estimate.
    for a, ta, b, tb in ((2, 24, 3, 168), (12, 240, 20, 1200), (5, 50, 5, 500)):
        point = (a / ta) / (b / tb)
        lb = ratio_lower_bound(a, ta, b, tb)
        check('lower bound <= point estimate (%d vs %d deaths)' % (a, b), lb <= point + 1e-9,
              'lb=%.3f point=%.3f' % (lb, point))

    # 7. More evidence at the same ratio tightens the bound -- monotone, which
    #    is the property that makes a longer canary worth running.
    bounds = [ratio_lower_bound(k * 3, k * 60, k * 10, k * 600) for k in (1, 2, 4, 8)]
    check('the bound tightens as deaths accumulate at a fixed ratio',
          all(bounds[i] < bounds[i + 1] for i in range(len(bounds) - 1)),
          str([round(x, 3) for x in bounds]))

    print()
    if FAILS:
        print('FAILED: ' + ', '.join(FAILS))
        return 1
    print('all death-gate tests pass')
    return 0


if __name__ == '__main__':
    sys.exit(main())
