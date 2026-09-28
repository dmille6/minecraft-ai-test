# The leaf-01 revert was a coin flip

**2026-09-21.** `leaf-01` (2850cde) was reverted on 19 Sep because its registered
deciding line, `logs_did >= -0.5`, read **-0.65**. That threshold had never been
checked against the estimator's own noise. It has now been, and it does not
survive.

## What was measured

`~/mcai-analysis/leafnull.py` runs **placebo canaries**: random 2-pool draws at
random cut points on windows where *no change was deployed*, so the true effect
is zero by construction. The estimator is `leafread`'s own, unchanged — additive
acquired-logs per bot-hour, `(canary_post − canary_pre) − (control_post −
control_pre)` — over the same 180 min pre / 180 min post geometry.

300 draws over 2026-09-19 07:15Z .. 2026-09-21 19:15Z, 12 pools, 1,508,207
usable rows:

| | |
|---|---|
| median | **+0.00** |
| sd | **3.00** |
| p5 | **−4.49** |
| p25 / p75 | −1.85 / +1.68 |

**leaf-01's −0.65 sits at p = 0.413.** 124 of 300 no-change windows were that
negative or worse. And the registered line itself:

> **130 of 300 windows with nothing deployed — 43.3% — would have tripped
> `logs_did >= -0.5` and reverted.**

## Two positive controls, because a null study that sees nothing proves nothing

1. **Replay.** The leaf-01 draw pushed through this same code path returns
   `-0.65`, matching what `leafread` reported on the day. The harness is
   computing the thing that made the decision.
2. **Injection.** Multiplying the canary arm's post-period logs by a known factor
   moves the estimate monotonically: ×0.25 → −0.75, ×0.5 → −0.72, ×1 → −0.65,
   ×2 → −0.52, ×4 → −0.25. A planted effect is recovered, so a real one could
   have been.

Note how *little* ×4 moves it. The canary arm banked 4 logs in the whole post
window against the control arm's 658. The estimator is responsive; the arm had
almost nothing in it to respond with.

## Why the band is so wide

The drawn pools were not comparable in level. Pre-period acquired logs per
bot-hour:

| arm | pre | post |
|---|---:|---:|
| canary (board-a, board-c) | 0.64 | 0.13 |
| control (10 pools) | 4.25 | 4.40 |

A **6.6x** gap before anything was deployed. Difference-in-differences does not
require equal levels, but it does require parallel trends, and the null spread
(sd 3.00) is roughly **five times the canary arm's entire baseline**. At two
pools and three hours this endpoint cannot see a change in these pools at all.

## What this does and does not say

- It does **not** say leaf-01 was good. It says the fleet never answered.
- It does **not** retract the code-level findings against leaf-01. Displacement
  through `probeReachable` (nearest 4, distance-only goal) and the `no_path`
  persistent-avoid path are both verified by executing the code, and both stand
  on their own.
- It **does** retract "leaf-01 made the fleet worse by 65%." That sentence has
  been used since 19 Sep and it is not supported.
- The mechanism half of leaf-01 demonstrably *worked*: buried refusals moved
  **−1.69 DiD**. It unburied the logs. What it did not do is deliver wood — and
  that, not the −0.65, is the finding worth carrying forward.

## Scope: how far does the defect reach

All 12 registrations were scanned for typed effect-size thresholds with
`on_fail: REVERT`. **leaf-01 is the only one.** Every other REVERT line is a
structural linkage guard of the form `control_*_rows <= 0` — "a control pool must
not emit the change's own row" — which is a fact about the deploy, not an effect
size, and needs no calibration.

This is the second gate on this project found to fire on noise. The death gate
was measured on 2026-09-13 to falsely revert **46%** of harmless 5-bot canaries,
which is why it now needs two deaths and >1.25x control. Same class of error:
a threshold typed from intuition onto a rare or noisy quantity.

## What replaces it (prospective only, per the amendment rule)

`leaf-02` is registered with:

- **Deciding line: `cover_productive_share >= 0.05`.** Of the rounds where the
  fallback actually attempted a foliage-covered log, what share banked one. A
  within-canary binomial at n >= 100 — no control arm, no DiD, no between-pool
  noise. It answers the only live question: whether breaking a log inside a
  canopy delivers wood, given `pickupNearbyItems` gives up on seeing the same
  drop entity twice.
- **Safety line: `logs_did >= -4.49`**, the placebo p5, where it is a real
  tripwire rather than a coin flip.
- **Exposure: `cover_outcomes_canary >= 100`** — *attempts*, not admissions.
  leaf-01 gated on `gather_runs`, which only proves `gather` ran.

No existing verdict is amended. `leaf-01` stays REVERTED in the journal; what
changes is what that revert is allowed to be cited as, which is nothing.
