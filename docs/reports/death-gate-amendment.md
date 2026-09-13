# Canary death gate — proposed prospective amendment, v3 (after two Codex passes; for the OWNER's decision)

Two independent review passes (Codex) rejected v1 and v2. v3 folds in every point; the review budget is spent, so
the remaining objections are listed honestly at the end rather than argued away.

## Definitions (frozen at registration, computed by canary-report.py, the reader types nothing)
- Window: `declared_at` to the read. e_c, e_k = canary / control bot-hours; d_c, d_k = `_death` rows.
- Mechanism list M written into the manifest at deploy; a death is mechanism-linked when the same bot has a row in M
  within the 600 s before it. M can only add trips.
- Looks: +30, +90, +180, +360.

## The gate
1. Backstops, any exposure, continuous: (a) a mechanism-linked canary death; (b) d_c >= 3; (c) d_c >= 2 while d_k = 0.
2. Rate test at each look once e_c >= 6 bot-h: exact conditional binomial d_c ~ Bin(d_c + d_k, e_c/(e_c + e_k)),
   one-sided, alpha 0.010 / 0.010 / 0.020 / 0.030 by look, plus observed ratio > 1.25. REVERT on a trip.
3. Calibration is EMPIRICAL, not assumed (Codex pass 2): the false-trip rate of every rule is measured on the
   fleet's own history with pseudo-canaries (every real pool x start times every 30 min, no change deployed), and
   the measured rates are written into the registration. Correlated deaths and death-dependent exposure are in
   that history, so the number is the fleet's, not a model's. (Result: see the calibration table below.)
4. KEEP at +360 requires ALL of: no trip; e_c >= 15 bot-h; the one-sided 90% upper confidence bound on the canary
   death rate (exact Poisson on d_c over e_c) <= 2x the control rate. Otherwise the disposition is mandatory:
   e_c < 15 bot-h -> INCONCLUSIVE and teardown; harm bound failed -> REVERT. No canary runs past +360.
5. Deaths are never excused.

## Calibration on 72 h of fleet history (false trips with no change deployed)
Measured 2026-09-13 16:47 UTC on today's logs (coverage 00:00-16:47 UTC after logrotate; 94 deaths in 80 bots over
17 h = 0.062 deaths/bot-h). Pseudo-canaries: 12 pools x start times every 30 min, 6-h windows, no change deployed
(a few windows overlap today's real canaries; they are a small minority). n = 264.

| Rule | false trips over the 6-h window | by look |
|---|---|---|
| Current (>= 2 canary deaths and > 1.25x control, any time) | 121 / 264 = 45.8% | +30: 2, +90: 19, +180: 47, +360: 53 |
| v3 (backstops + exact test with alpha spending) | 84 / 264 = 31.8% | +90: 4, +180: 14, +360: 66 |
| v3 KEEP harm bound failed at +360 | 98 / 264 = 37.1% | |

Why both are so high: deaths are not spread evenly. Today's per-pool deaths over 17 h run from 1 (placebo-b) to 15
(hive-b), and single bots die 4-6 times (hive-b-Bravo 6, board-d-Bravo 4, hive-a-Bravo 4). A 5-bot pool compared
to the fleet average is therefore mostly a test of WHICH BOTS ARE IN THE POOL, which is the same lesson the project
learned for productivity ("canary vs fleet is not the test"; DiD or no finding), now for deaths. Neither rule can
tell a harmful change from an unlucky pool inside six hours at this fleet's death rate and heterogeneity.

## What the calibration says the gate must be (recommendation, for the owner)
1. Mechanism-linked deaths only can trip a canary early (backstop 1a). A death with no row of the change's mechanism
   in the 600 s before it is reported, never a trip.
2. The unconditional backstop stays but at the fleet level: if the FLEET's deaths/bot-h over the last 2 h exceed 2x
   its pre-deploy 6-h rate, revert whatever is deployed (a change that hurts everyone shows there; a change confined
   to a pool cannot).
3. Pool-level deaths are judged only at +360 as DiD against the pool's own 6-h pre-period (the pool's chronic diers
   are in both periods), with the same 1.25x ratio and the two-death floor. Measured false-trip rate to be reported
   before adoption.
4. Or: 10-bot pools (two pools per canary) halve the heterogeneity problem at the cost of a second pool.

## What remains open after the final review pass (stated, not resolved)
- Codex pass 2 held that Bonferroni cannot repair an invalid p-value if deaths are correlated. v3's answer is the
  empirical calibration (3), which does not depend on the binomial being right; if the measured false-trip rate of
  the rate test is above 5% per canary, the alphas are halved before registration.
- The KEEP harm bound (4) is a confidence bound, as asked; with 15 bot-h and 0 canary deaths it is 2.3/15 = 0.15
  deaths/bot-h, which is <= 2x control only when the control rate is >= 0.077/bot-h. On a quieter day a clean
  canary cannot KEEP at +360 on harm alone; it becomes INCONCLUSIVE on exposure and needs a longer window. That is
  the price of a real bound; the alternative is the current rule's one-in-three chance revert.

## The decision (owner)
A. Keep the current rule (>= 2 canary deaths and > 1.25x at any time). Known cost: roughly one harmless canary in
   three is reverted inside 90 min, and the recovery ladder cannot be read on the fleet.
B. Adopt v3 prospectively (next registrations only), with the calibration numbers written in.
C. Something else (e.g. larger pools of 10 bots, which halves the base-rate problem at the cost of two pools).

## Calibration v2 (17:03 UTC): 10-bot pools, pool DiD, fleet backstop — with the 6-h pre-period reserved
132 five-bot and 726 ten-bot pseudo-canaries over the covered 11 h, no change deployed:

| Rule | 5-bot false trips | 10-bot false trips |
|---|---|---|
| Current (>= 2 deaths and > 1.25x, any time) | 53.8% | 53.2% |
| v3 exact binomial with alpha spending | 40.9% | 77.1% |
| Pool DiD at +360 vs the pool's own 6-h pre-period (two-death floor, 1.25x) | 37.9% | 38.4% |
| Fleet backstop: trailing 2-h fleet rate > 2x the pre-deploy 6-h rate | 45.5% of deploy times | |

Ten-bot pools do not help the death gate (the heterogeneity is between bots and hours, not sampling noise), and the
binomial gets WORSE with more exposure because the heterogeneity is real signal to it. Registered in RULE v9: no
death-rate test can auto-revert inside six hours on this fleet; only a mechanism-linked death does, and survival is
judged fleet-wide over 72 h after promotion. Ten-bot pools are kept for the primary metrics' power.
