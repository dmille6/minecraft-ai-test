#!/usr/bin/env python3
"""Behavioural tests for the amended death gate.

The cases that matter are the ones this project has actually lived through:
falls-01 (a report-only instrument reverted on two idle deaths), swim_to (real
harm that MUST still revert), and the owner's floor (one death is never a
verdict, however lopsided the rates look).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from deathgate import randomization_p, death_gate, ratio_lower_bound

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

    # ---------------------------------------------------------------------
    # 8. THE IN-WINDOW RANDOMIZATION p (owner decision 2026-09-24).
    #
    # The lower bound is a PARAMETRIC Poisson bound; deaths are not Poisson across worlds,
    # because bots in a world share terrain, a seed and a server, so one hazard puts several
    # deaths in one pool. Permuting whole pools preserves that clustering.
    POOLS = ['p%02d' % i for i in range(16)]
    BH = 11.6                    # 5 bots x ~2.3 h over a 3 h read, measured shape
    TREAT = ('p00', 'p01')

    def units(canary, control):
        u = {q: [0, BH] for q in POOLS}
        for i in range(canary):
            u[TREAT[i % 2]][0] += 1
        rest = [q for q in POOLS if q not in TREAT]
        for i in range(control):
            u[rest[i % len(rest)]][0] += 1
        return {k: tuple(v) for k, v in u.items()}

    # 8a. falls-01's shape: 2 canary deaths, 3 control, spread over distinct pools.
    #     Measured p = 10/120 = 0.083 > 0.05, so the gate must HOLD.
    pv, n = randomization_p(units(2, 3), TREAT)
    check('falls-01 shape: p = 10/120', abs(pv - 10 / 120) < 1e-9 and n == 120,
          'p=%.4f n=%d' % (pv, n))
    rev, why = death_gate(2, 2 * BH, 3, 14 * BH, units=units(2, 3), treat=TREAT)
    check('falls-01 shape does NOT revert', rev is False, why)
    #     ...but it is the LOWER BOUND that holds it (0.58x), not the p -- the p is never
    #     reached, because the bound returns first. Worth stating plainly: the parametric
    #     bound alone already fixes the incident that prompted this change. What the p adds
    #     is 8f below, and that is the case that justifies it.
    check('  and falls-01 is held by the BOUND, before the p is consulted',
          'lower 95% bound' in why and 'randomization p' not in why, why)

    # 8f. WHERE THE p EARNS ITS PLACE: deaths CLUSTERED across several pools, which is what
    #     one shared terrain hazard looks like across worlds that share a seed and a server.
    #     Measured: with 5 pools carrying 3 deaths each and the canary holding 2 of them, the
    #     lower bound clears (1.65x > 1.25) while the ranked p does not (0.083 > 0.05). The
    #     parametric Poisson bound cannot see clustering; permuting whole pools can.
    def clustered(nheavy, dper):
        u = {q: [0, BH] for q in POOLS}
        for i in range(nheavy):
            u[POOLS[i]][0] = dper
        return {k: tuple(v) for k, v in u.items()}

    for nheavy, dper, lbmin in ((5, 3, 1.65), (5, 4, 1.94), (6, 3, 1.30)):
        u = clustered(nheavy, dper)
        cd = sum(u[t][0] for t in TREAT)
        kd = sum(u[x][0] for x in u if x not in TREAT)
        lb = ratio_lower_bound(cd, 2 * BH, kd, 14 * BH)
        pv, _n = randomization_p(u, TREAT)
        rev, why = death_gate(cd, 2 * BH, kd, 14 * BH, units=u, treat=TREAT)
        check('clustered %d pools x %d deaths: the BOUND would trip (%.2fx > 1.25)'
              % (nheavy, dper, lb), lb > 1.25 and abs(lb - lbmin) < 0.05, 'lb=%.2f' % lb)
        check('  but the ranked p holds it (p=%.4f > 0.05)' % pv, rev is False, why)
        check('  and the reason says the p held it',
              'HELD by the in-window randomization p' in why, why)

    # 8f-bis. THE DENOMINATOR, WHICH EVERY FIXTURE ABOVE HIDES. Every case so far gives
    #     each pool the SAME exposure, so ranking DEATH COUNTS and ranking DEATH RATES are
    #     indistinguishable -- a mutant that ignored exposure entirely survived the whole
    #     suite. Real pools do not have equal exposure: bots crash and restart, so a pool's
    #     measured span varies several-fold. Here the canary is two SHORT-LIVED pools with a
    #     high rate, and one control pool has MORE deaths over five times the exposure.
    #     Ranked by rate p = 0.0083 and the gate reverts; ranked by count p = 0.1333 and a
    #     canary dying at 0.667/bot-h would have survived.
    uneq = {q: (0, BH) for q in POOLS}
    uneq['p00'] = (2, 3.0)
    uneq['p01'] = (2, 3.0)          # canary: 4 deaths / 6.0 bot-h = 0.667/bot-h
    uneq['p05'] = (5, 30.0)         # control: 5 deaths / 30.0 bot-h = 0.167/bot-h
    pv, _n = randomization_p(uneq, TREAT)
    check('unequal exposure: the p ranks the RATE, not the count (p = 1/120)',
          abs(pv - 1 / 120) < 1e-9, 'p=%.4f (ranking counts instead gives 0.1333)' % pv)
    _kd = sum(uneq[x][0] for x in uneq if x not in TREAT)
    _kbh = sum(uneq[x][1] for x in uneq if x not in TREAT)
    rev, why = death_gate(4, 6.0, _kd, _kbh, units=uneq, treat=TREAT)
    check('  and a high-RATE canary on short exposure still reverts', rev is True, why)

    # 8g. And clustering must NOT excuse concentrated harm. 3 heavy pools is a tighter
    #     cluster, the p is 0.025, and the gate must still revert -- otherwise the p has
    #     become a blanket excuse rather than a calibration.
    u = clustered(3, 3)
    cd = sum(u[t][0] for t in TREAT)
    kd = sum(u[x][0] for x in u if x not in TREAT)
    rev, why = death_gate(cd, 2 * BH, kd, 14 * BH, units=u, treat=TREAT)
    check('a TIGHT cluster (3 pools) still reverts at p=0.025', rev is True, why)

    # 8b. THE MONOTONICITY THE WHOLE IDEA DEPENDS ON, and the reason the first design was
    #     thrown away. A Codex pass found that using the gate's BINARY TRIP CONDITION as the
    #     statistic is not monotone: with deaths concentrated in the two treated pools every
    #     assignment containing either of them also fires -- C(16,2)-C(14,2) = 29 of 120 --
    #     so that p converges to 0.242 and the gate would go PERMANENTLY SILENT as harm got
    #     worse. Measured: the binary form reaches 0.150 at 9 canary deaths and 0.242 at 10,
    #     both above 0.05. A ranked statistic cannot do that.
    ps = [randomization_p(units(cd, 3), TREAT)[0] for cd in range(2, 11)]
    check('the ranked p never RISES as canary deaths rise (2..10)',
          all(ps[i] >= ps[i + 1] - 1e-12 for i in range(len(ps) - 1)),
          str([round(x, 4) for x in ps]))
    check('  and it reaches the 1/120 floor and stays there',
          abs(ps[-1] - 1 / 120) < 1e-9, 'p at 10 deaths = %.4f' % ps[-1])
    check('  so the gate still reverts at 10 canary deaths',
          death_gate(10, 2 * BH, 3, 14 * BH, units=units(10, 3), treat=TREAT)[0] is True,
          death_gate(10, 2 * BH, 3, 14 * BH, units=units(10, 3), treat=TREAT)[1])

    # 8c. THE SAFE DIRECTION WHEN THE p CANNOT EXIST. A one-pool canary has C(16,1) = 16
    #     assignments, so the smallest attainable p is 0.0625 > 0.05 and the condition can
    #     NEVER be met. For a statistical harm claim, refusing to decide is safe; for DEATHS
    #     it is not, because a lethal change would keep running. So the owner's rule stands
    #     alone and the verdict SAYS SO.
    one = {q: (1 if q == 'p00' else 0, BH) for q in POOLS}
    one['p00'] = (4, BH)
    rev, why = death_gate(4, BH, 1, 15 * BH, units=one, treat=('p00',))
    check('a one-pool canary still reverts (p unattainable)', rev is True, why)
    check('  and says the p was unattainable', 'unattainable' in why, why)
    check('  and names the remedy', '>= 2 pools' in why, why)

    # 8d. NOT SUPPLIED is not the same as PASSED. If no unit-level deaths reach the gate it
    #     must behave exactly as before and say that, or a plumbing failure would read as a
    #     clean randomization result -- this project's most repeated bug.
    rev, why = death_gate(9, 30.0, 3, 210.0)
    check('no units supplied -> the old behaviour', rev is True, why)
    check('  and it says the p was not supplied', 'NOT SUPPLIED' in why, why)

    # 8e. The p must not rescue a change from a floor failure or a missing control: those
    #     branches return before the p is ever consulted.
    check('below the floor still holds, p or no p',
          death_gate(1, BH, 0, 15 * BH, units=units(1, 0), treat=TREAT)[0] is False, '')
    check('no control exposure still holds',
          death_gate(3, BH, 0, 0.0, units=units(3, 0), treat=TREAT)[0] is False, '')

    print()
    if FAILS:
        print('FAILED: ' + ', '.join(FAILS))
        return 1
    print('all death-gate tests pass')
    return 0


if __name__ == '__main__':
    sys.exit(main())
