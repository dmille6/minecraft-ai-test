# shoreline-01: KEEP, promoted, and what it actually taught

**Closed 2026-09-22 18:14Z.** `9b572aa` promoted fleet-wide, 80/80 verified on one
version, `canary_pool` cleared, open-loop check clear, loop exited cleanly.

## The change

`Movements.safeToBreak` ORs `dontCreateFlow` (liquid on any of five faces) with
`dontMineUnderFallingBlock`. Written for flooded mineshafts; it also vetoes an ordinary
tree beside a pond. Measured before building: 994 candidates, **0.0% lava**, 43.1%
side-water-only. The exemption admits a log when the bot stands on dry ground, nothing
heavy is overhead, and the block still passes a probe with `dontCreateFlow` off.

## The reads

| read | primary DiD | n | exempt E | ceiling E/n | absorbed |
|------|------------:|----:|---------:|------------:|---------:|
| +30  | +25.0 pp | 82  | 4  | **4.9 pp** | −48% |
| +90  | +13.4 pp | 199 | 14 | **7.0 pp** | 29% |
| +180 | +7.6 pp  | 411 | 42 | 10.2 pp | 1% |
| +360 | **+1.6 pp** | 844 | 63 | 7.5 pp | **49%** |

Null for this geometry: median +0.8, sd 9.0, p95 +16.3.

## Verdict: KEEP, by the pre-registered lines, and I dissent on the promotion

`verdict.py` returned KEEP at +360: the deciding line `absorbed_fraction <= 0.5` passed
at 0.49, exposure passed at 63 (min 40), and the death gate held — in the canary's favour,
2 deaths in 120.0 bot-h (0.017/bh) vs 6 in 240.0 (0.025/bh).

**The verdict is correct and I let it stand.** The registration named the conservation
line as deciding precisely because the calibration showed DiDs are blind at this pool
count. Overriding it after seeing a primary I dislike is moving the goalposts, and that is
what makes pre-registration worth having. leaf-01 was reverted this month on a gate later
measured to fire on 43.3% of no-change windows; the discipline protects against my
judgement in both directions.

**My dissent, for the record, not for the gate:**

1. **The primary is flat.** +1.6 pp at n=844 against sd 9.0. No measured wood gain.
2. **The deciding line nearly failed and is trending the wrong way**: 1% absorbed at +180,
   **49% at +360**, against a 50% REVERT limit. More exposure made displacement visible.
3. The change is safe and benefit-unproven, now on 80 bots.

## Two errors of mine this canary exposed

**The early reads were mechanically impossible.** +25.0 pp at +30 exceeded its own ceiling
(4 exempt rows in 82 gathers caps any direct effect at 4.9 pp) by **5x**; +13.4 pp exceeded
7.0 pp by 1.9x. I reported both as signal and then narrated the decline as "a noisy
estimator converging". The reads are also NESTED, so a high start must decay — convergence
was guaranteed by construction. The exposure interlock (min 40) existed to stop exactly
this and I quoted the numbers anyway because the loop printed them. See
`effect-ceiling-check` in memory: print E, n and E/n beside every primary, and never state
a DiD larger than its ceiling.

**I called the conservation line clean too early.** At +180 I reported "1% absorbed against
a 50% line" as the strong part of the case. At +360 it is 49%. The line was not wrong; my
confidence at 42 exempt rows outran it.

## What this actually taught, which is worth more than the change

**Removing part of the candidate filter does not convert refusals into logs. It relocates
them.** At +360, `no_safe_target` fell 5.2 pp while `no_path + unreachable +
collect_budget + nothing_found` rose 2.6 pp. The exemption lets the bot *accept* a
waterside log as a target; it then cannot *route* to it, so the veto moves one stage
downstream.

I have been treating the ~71–76% candidate-filter refusal rate as the wall. This says the
bots also cannot reach trees they can already target. **Routing, not target selection, is
the next binding constraint on wood** — and that is a larger and different problem than
the water veto. The next wood work should attack routing, and should not assume a filter
fix converts into logs, because this one did not.

## Residual to watch on the fleet

`absorbed_fraction` at 0.49 was measured on 4 pools. Now that the change is fleet-wide,
re-read `no_safe_target` against `no_path + unreachable` over the next 24 h. If absorption
keeps climbing, this is a revert candidate on fresh evidence — which is legitimate, unlike
moving the gate retroactively.
