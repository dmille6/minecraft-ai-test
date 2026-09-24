# The canary gate has been over-reverting: an audit of all 23 REVERTs

Read 2026-09-24, fleet unchanged throughout (`9b572aa`, no canary declared).
Ledger `/var/log/mcai/_canary-decisions.jsonl`, 59 decisions all-time, byte-identical
before and after. Nothing written to `~/digest/reads`.

## Why this was asked

Two facts arrived on the same day. The gate's false-positive rate, measured on real
single-build telemetry over 400 draws per direction where there is no treatment
effect, **swings 0.0% to 12.8% against a nominal 5%** depending only on which window
calibrated the threshold — while an in-window randomization p measures 5.5% / 4.0%,
nominal both ways. And the ledger holds **more REVERTs than KEEPs**.

If the gate fires false, some of those reverts discarded working changes. That would
matter more than anything else on the board, because it means the project has been
throwing away progress it earned.

## Denominators

59 decisions all-time (KEEP 17, REVERT 23, INCONCLUSIVE 19); 50 since 09-09
(KEEP 15, REVERT 23, INCONCLUSIVE 12), reproducing the nightly read exactly. Every
window is still readable — the oldest generation holds 09-10, the earliest revert is
09-11, so **nothing was lost to logrotate**. Each recompute walks 60 bots / 12 worlds
(`isolated-*` excluded, matching `gatep.py`), 10 canary vs 50 control,
C(12,2) = **66 same-shape assignments**.

## The finding that needs no statistics

**Four shas were REVERTed and later KEPT** — `933c594`, `8a2964a` (REVERT/KEEP/REVERT),
`6d843a1`, `b1659c0` (REVERT/REVERT/KEEP). Same code, opposite verdicts, differing only
in which pool and which window. Of 10 reverted shas checked, **8 eventually reached
`main`**.

## Margins, closest to the line first

| run | sha | typed line | threshold | realised | margin |
|---|---|---|---|---|---|
| carry-craft | `f310a23` | order-driven success | >=60% | 50% (7/14) | one more success passes |
| rl-08c | `dca6525` | explore rows/bot-h, one-sided | -30% | -34% | **1.13x** |
| leaf-01 | `2850cde` | `leafread.logs_did` | >= -0.5 | -0.6498 | **1.30x** |
| three-cell stair | `933c594` | `_entombed` ratio | >2x (n>=3) | 2.63x | **1.31x** |
| rl-08d | `2d5c83e` | explore rows/bot-h | -30% | -70% | 2.33x |
| rl-08 | `14c662d` | own refusals/bot-h | <3 | **18.77** | 6.26x |

The top four are exactly what a 12.8% false-positive rate produces.

11 of 23 were single-pool canaries. C(12,1) = 12 assignments, below `in_window_p`'s
20-draw minimum, so **a one-pool canary's threshold cannot be calibrated in-window at
all** (minimum attainable p = 1/12).

## Recomputed in-window p

- **leaf-01 `2850cde`** — items DiD 0.430x, p=0.18; logs 0.151x, p=0.12. **36.4% of that
  window's own 66 null assignments cross the -0.5 line (49.2% on logs).** Independently
  reproduces the project's own 43.3% placebo figure by a different method. The `-0.5`
  has **no recorded derivation anywhere**.
- **rl-08d `2d5c83e`** — explore 0.296x, **p=0.015 (real)**; but items 1.169x (p=0.80) and
  **gather 1.921x (p=0.03, significantly UP)**. The guard saw a true signal and drew the
  wrong conclusion. Typed line's own in-window FPR: 19.7%.
- **rl-08c `dca6525`** — explore 0.662x, p=0.15; typed line's in-window FPR 10.6%.
- **`b1659c0`, all three windows** — items 1.121x (p=0.67), 1.520x (p=0.29), 1.062x (p=0.88);
  explore and gather null throughout. Identical code, identically harmless: the two
  REVERTs came **entirely from the rule**, and the third was KEPT and promoted fleet-wide.
- **`14c662d`, `3810457`** — every productivity endpoint null (p=0.35-0.96).

## The decisive test for the 12 linkage/death reverts

Did the OLD code emit the row that licensed the trip? If control emits it too, the
linkage is not a test.

| revert | licensing row | control (old code) rate | verdict |
|---|---|---|---|
| owner-01b `aa44514` | `_escape_rung` | **0** in 178.0 bot-h | **discriminates -- correct** |
| falls-01 `fc28885` | `_fall_path` | **0** in 115.4 bot-h | discriminates, but the revert fired on the *death gate* |
| rl-13 `b1659c0` | `_death_site_recorded` | written **by** the death | **P(trip \| any canary death) = 1.0 -- not a test** |
| rl-13b `b1659c0` | `_flooded_pocket_rung` | 0.027/bot-h (6 post, 3 pre) | **does not discriminate** |
| rl-04 `6d843a1` | `_entombed*` | **6.16/bot-h** | **64.2%** chance of a coincidental 600 s link |
| rl-03 `612d1c8` | `_marooned*` | **4.77/bot-h** | **54.8%** chance |

The linkage rule was **never calibrated**, and its own registration already records
"3 reverts, 3 false positives." These rates are why.

## Positive controls

**A correct revert, found by the same instruments.** rl-08 `14c662d`: `_lava_corridor`
**278 rows / 14.9 canary bot-h = 18.77/bot-h against a registered <3/bot-h line (6.3x)**,
with a clean **zero** in canary-pre (29.9 bot-h) and in control in both eras (74.6 bot-h).
Three empty cells and one enormous one. No calibration instability touches that.

**The method is not a null-machine.** Injecting a -30% effect into the real windows drops
p to 0.015-0.046 every time, and it independently found rl-08d's real explore drop
(p=0.015) and gather rise (p=0.03).

## Verdict: 7 confirmed false, 5 strongly suspect, 5 correct, 5 mislabelled

- **Confirmed false (7):** `612d1c8`, `6d843a1`, `b1659c0` x2, `fc28885`, `2850cde`, `2d5c83e`
- **Strongly suspect (5):** `38bebdd`, `590e68d` (both one-death, pre-dating the two-death
  floor -- neither would trip today), `933c594`, `9339a48`, `dca6525`
- **Correct (5):** `3eb1bec`, `14c662d`, `3810457`, `aa44514`, `b72781e`
- **Not harm findings at all (5):** `f310a23`, `bb1af53` x2, `8a2964a` x2 -- the mechanism
  did not deliver.

That last row matters for how the headline reads: **the ledger's single REVERT label
conflates "this is harmful" with "this missed its KEEP bar".** That is most of why
"more reverts than keeps" sounds worse than it is -- and none of why the seven false
ones are false.

## The one change that deserves a second look and has no successor

**`fc28885` (falls-01) is the only reverted sha still not on `main` with nothing
replacing it.** Reverted on 2 canary deaths (0.086 vs 0.013/bot-h), and it is
**observability-only**: source-read, the sole consumer of the path-active flag is
line 873 writing `descentOnset`, consumed only by `composeFallRow` for a log string;
`markPathEnded` is pure; nothing in movement, pathfinding, skill selection or the
reflexes reads any of it. **It cannot have caused those deaths.** The fall-path
recorder is still missing, and the falls analysis has been proceeding without it.

`2850cde` (leaf-01) was reworked into `9fc3968`, which is on `main` -- the capability
was recovered, but the false revert cost a rework. `2d5c83e` (the lava guards) is on
`main`, and across four canaries those guards **never once read as harmful**.

## What this changes

1. **A typed threshold is not evidence.** Retire the typed `own_line` as a sufficient
   condition for REVERT; require an in-window randomization p with the sign checked
   separately. A one-pool canary cannot supply one, so a one-pool canary cannot revert
   on a threshold.
2. **A linkage rule must be calibrated against the control arm's own rate for the
   licensing row** before it can revert anything. Three of the six above fail that test
   outright, and one is arithmetically incapable of passing it.
3. **Split the REVERT label** into `harmful` and `missed-bar`. Five of 23 are the latter.
4. **`fc28885` is owed a re-read**, not a re-canary: it is observability-only and the
   gate that rejected it has now been measured.

Claims are measured except where marked: the discrimination census and all p-values are
measured; falls-01's report-only status and the missing `-0.5` derivation are source-read;
the 54.8% / 64.2% coincidence rates are computed from the control arm's own measured rates.
