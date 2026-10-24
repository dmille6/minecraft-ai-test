# Tier 2 draws exactly four pools or waits (2026-10-24) — design + replay, NOTHING installed

OWNER POLICY (adopted from queue-speed Q3, via the coordinator 10-24): a tier-2 fix that cannot draw exactly 4 pools
waits for 4 or is registered tier 3. Nothing enforces it; ironsmelt-01 (tier 2) drew 3 pools at 02:21Z today because the
draw takes what is free. This is the smallest mechanical enforcement, its replay over 10-12..10-24, and the comparison
with auto-registering tier 3 at draw time. Branch `tier2-min4-1024` (on `queue-speed-1023`, whose replay tools it
reuses). Host 10.0.0.31: files read, read-only programs over ssh stdin; nothing written there.

## 0. Short version

| | |
|---|---|
| rule | **derived, no new field**: `tierrule.tier_of(reg) == 2` (the one definition verdict.py and drawsteady use) makes drawrec draw exactly 4 or nothing; the loop journals each short draw and **refuses after 12 h** with a page naming the two remedies; R10 waits in the scheduler (not in the loop, holding the lock) when fewer than 4 pools can expose a tier-2 head |
| replay 10-12..10-24 | 10 tier-2 draws (all after v36, 10-19 16:27Z; none before — no registration had a tier). 3 drew 4. **The other 7 would have waited: 0.7, 0.7, 0.7, 1.1, 7.3 h, and two "at least" (>= 6.3 h, >= 3.3 h)**. None demonstrably past the 12-h bound; two unknowable past their windows |
| lane cost | **>= +20.2 h of waits** in 4.5 days, against one reasoned gain (ironpick-01's KEEP 3 h sooner): **net >= +17.2 h** (first order) |
| verdicts | no re-runnable check can see a changed verdict (every 4-pool counterfactual contains the run's own pools, which in the logs ran its canary); **zero flips shown, all 7 changed verdicts reasoned** |
| auto-tier-3 at draw | neither simpler nor safer: the tier lives in hashed registration bytes read by the gate, so a draw-time downgrade needs a new trusted marker in verdict.py (a gate change), and a tier-3 verdict drops the v36 baseline check on pools drawn under tier-2's 240-min release — indexsearch-01's dirty +360 would then KEEP unchecked. Not proposed |
| recommendation | install the wait if the owner accepts ~+3.8 h/day of lane; the cheap half of the gain is in the first 70 min (4 of 7 short draws found a 4th pool by then) — see Q1 |

## 1. The rule

1. **drawrec.sh** (`patches/drawrec.sh.patch`, against the live d0d4d51c). After the draw_k block: if the incoming
   registration has a `tier` key, it is classified with `tierrule.tier_of`; tier 2 sets `TARGET_K = MIN_K = 4`, so the
   draw is exactly 4 or `NONE (fewer than 4 eligible)`. Tier 2 with `draw_k` < 4 is a contradiction and draws nothing.
   A `tier` key that cannot be classified (tierrule.py unreadable) draws nothing (fail closed). **No `tier` key: byte-for-
   byte today's code path** (the new block is skipped without importing anything).
2. **canary-loop.sh** (`patches/canary-loop.sh.patch`, against the live 344b1074). `TIER2` is computed once with the
   same `tier_of` (a tier that cannot be classified refuses before the draw). Before the draw, tier 2 with `draw_k` < 4
   is refused (`refused-tier2-k`, nothing drawn). In the draw loop, each tier-2 attempt that draws nothing is journalled
   `draw-short` ("tier 2 needs exactly 4 pools ... drawrec: <its NONE line>"), so the scheduler's existing draw-stall
   page fires at 3 h with the reason. **After 12 h** (`T2_DRAW_MAX_H`; why 12: every ledger exclusion has lapsed by
   then, so a longer wait is structural) the loop journals `refused-tier2-draw`, pages an error naming the remedies —
   re-register tier 3 (`queue replace-variant` with a registration without `"tier": 2`, then `rearm`) or `rearm` to wait
   again — and exits 2 with nothing deployed. The entry is then `blocked`; the scheduler never retries (its rule).
3. **canary-sched.py R10** (`patches/canary-sched.py.patch`, against the live 0d9a87f3). For a tier-2 head whose
   registration declares `draw_exposure`, fewer than 4 pools "eligible on exposure" is a `WAIT` in the scheduler (paged
   at 3 h by W4, as every R10 wait), so a structurally narrow head never parks a loop in `draw` holding the loop lock
   (which shuts installers out) for 12 h. A `tier` it cannot classify BLOCKS with its fix. Separable: without it the
   loop's 12-h bound still holds.

Why derived and not a `draw_min_pools` field: the policy is "tier 2 means 4"; a field would be a second definition that
can disagree with `tier_of` (and every queued tier-2 entry would need re-registering, which changes its sha256). A
registrant who wants fewer pools registers tier 3 — the policy's own remedy.

## 2. Interactions

- **R10 / draw_exposure:** today R10 needs 2 exposure pools; with (3) a tier-2 head needs 4 before it launches. In the
  replay only indexsearch-01 had fewer (2: board-a, placebo-a over 24 h) — it would have waited in the scheduler.
- **draw_require_pools** (towniron needs hive-b, board-a fixes need board-a): `drawrequire.pick` already takes `MIN_K`;
  with 4 it needs the required pools drawable (they obey every exclusion) **plus** enough eligible others to make 4, or
  it waits — never a substitute, never 3 (tested). poolescape-01 (required board-d) is the replay's case: >= 6.3 h.
- **The 6-h / 12-h / 240-min exclusions and restart lag:** unchanged. A tier-2 draw keeps v36's release (240 min after
  a tier-2 close, 360 after a tier-3 promotion) and every steady check (one build in the hour, 240-min version_clean,
  bags). Waiting for 4 is waiting for more of them to lapse; after each promotion the restart-lag check holds every pool
  ~1 h, so a tier-2 head launched just after a promotion often waits ~1 h (bagbudget, townindex, ironsmelt: 0.7 h).
- **Bag fixes / model-env / underground-safety:** have a `class`, so they are never tier 2 (`tier_of`); unchanged.
- **One canary pool, the tripper, install holds:** unchanged — nothing launches while a tier-2 loop waits in its draw;
  a waiting loop holds the loop lock as a bag fix does today (bounded at 12 h; (3) keeps the structural cases out).
- **Resume:** a loop restarted during its draw starts a new 12-h clock (the bound is per loop attempt; `rearm` likewise).

## 3. Replay (`replay_min4.py`, `out/replay_min4.out`)

Method: the queue-speed reconstruction (`drawsim.py`: positive control 27/34 actual draws reproduced), a fresh read-only
log scan 10-11 00:00Z..10-24 03:30Z (18.9 M rows), re-drawn every 22 min (the loop's cadence) from each short draw.
**The faithful window:** while the run waits, the real fleet is the waiting world until the run's ACTUAL close (then a
promotion restarts every pool and the next run deploys); the run's own pools, which in reality ran its canary, are taken
as still eligible, as they were at its draw. A wait not found inside the window is reported as AT LEAST the window.

| run | drew | 4-pool draw | wait | recorded | 4-pool +180 KEEP (R3, reasoned) |
|---|---|---|---|---|---|
| cobblekeep-01 | 4 | — | 0 | KEEP +360 | — |
| bagbudget-01 | 2 | 10-20 12:14Z (+hive-b, placebo-b) | 0.7 h | INCONCLUSIVE (by hand) | — |
| toolkit-03 | 3 | 10-21 08:25Z (+hive-a) | **7.3 h** | KEEP +720 | no (death gate WATCH) |
| ironpick-01 | 3 | 10-22 01:36Z (+board-a; one of 6) | 1.1 h | KEEP +360 | **yes** -> the same KEEP 3 h sooner |
| protectzone-01 | 4 | — | 0 | KEEP +180 | — |
| townindex-01 | 3 | 10-22 19:34Z (+board-d) | 0.7 h | KEEP +360 | no (exposure 0 at +180) |
| poolescape-01 | 3 | none before its close | **>= 6.3 h** | KEEP +360 | — |
| indexsearch-01 | 2 | none before its close | **>= 3.3 h** (R10 would have held it in the scheduler) | INCONCLUSIVE (by hand) | — |
| chatgate-01 | 4 | — | 0 | KEEP +360 | — |
| ironsmelt-01 (live) | 3 | 10-24 02:59Z (+board-b) | 0.7 h | — | — |

- **Unbounded waits:** none demonstrably past 12 h. poolescape-01 and indexsearch-01 are unknowable past 6.3 h /
  3.3 h; either could have hit the bound (refusal + page) — the replay cannot say.
- **Verdict changes:** the R1 baseline and R2 death gate cannot be re-run for any 4-pool counterfactual: each contains
  the run's own pools, whose logs inside the counterfactual windows hold the run's real canary (CASCADE-BLIND, as in the
  queue-speed method). So **no re-runnable flip, and all 7 changed verdicts are reasoned**. R3 (keep_early on the recorded
  +180 lines, baseline taken as clean) says one run (ironpick-01) would have KEPT at +180 instead of +360.
- **Lane time (first order):** waits >= 20.2 h (the two lower bounds capped at the 12-h bound), minus 3.0 h (ironpick's
  earlier KEEP) = **net >= +17.2 h over 4.5 days**. Later draws are not re-simulated against the shifted lane.

## 4. Alternative: auto-register tier 3 at draw time

- **Not simpler.** The tier is in the registration bytes, hashed at `queue add` (H3) and read by verdict.py
  (`tier_of(reg)`) and drawsteady. A draw-time downgrade must either edit the registration (H3 then refuses and the
  run-id-is-one-deployment rules bind it) or add a downgrade marker that verdict.py trusts from the journal — a gate
  bundle change, a new digest, and a journal line deciding a gate rule (this project's "read the line, not the field"
  failure class).
- **Not safer.** The short draw was made under tier 2's 240-min early release. Judged as tier 3, the run loses the v36
  baseline_clean check that tier 2 carries at every KEEP — indexsearch-01's dirty +360 baseline (placebo-a ran
  poolescape-01's canary inside the lookback) would have been KEEP-able unchecked. It would also keep the lane moving
  exactly as today, i.e. not enforce the policy at all.
- **An untested middle option (Q2):** on a short draw, re-draw under TIER-3 exclusions (6 h / 12 h) and keep judging it
  as tier 2 — no gate change, cleaner +360 baselines, no +180 KEEP. Not designed or replayed here.

## 5. Tests (all pass; every mutant killed; positive controls)

| suite | result |
|---|---|
| `patches/test_drawrec_tier2.py <patched drawrec> drawrequire tierrule --mutants` — the REAL drawrec Python block on fixtures | 14/14 (no tier / tier 3 unchanged; tier 2 with 2, 3, 4, 6 eligible; class / `True` tiers ignored; draw_k contradiction; tierrule missing with and without a tier key; draw_require + tier 2 with 3 and 2 others; tier-3 draw_require positive control); 5/5 mutants |
| `patches/test_loop_tier2.py <patched loop> tierrule --mutants` — the loop's OWN tier-2 code cut from the patched canary-loop.sh, fake clock | 10/10 (drawn at once; draw-short rows then drawn; refusal at exactly 12 h with both remedies paged; the bound is the configured value; tier-3 positive control; draw_k refusal; unclassifiable tier refused); 6/6 mutants |
| scripts/host/test_canary_sched.py patched (`test_canary_sched.py.patch`) | 96/96 (93 + 3: tier-2 R10 waits on 2 exposure pools and launches on 4; tier 3 unchanged; unclassifiable tier blocks); 66/66 mutants killed (62 + 4 new) |
| scripts/test_drawrequire.py on the patched drawrec | 35/35 |
| scripts/test_threepool.py with the patched loop + drawrec | 163/163 (2 host-only skipped, as before) |

Reproduce: apply the three host patches to copies of the live files (md5s in section 1; they apply cleanly and only
there), then run the suites as in the table; outputs are in `out/test_*.out`. The replay: `python3 replay_min4.py`
(needs the queue-speed scan and host copies; `out/replay_min4.out`).

## 6. Install steps (if approved)

None of these files is in the gate bundle: the digest must read 635ad8d866a6e4a772351961bd5bd997 before and after.
**canary-loop.sh must never be replaced while a loop runs** (bash re-reads a running script by byte offset): install
only with no `canary-loop.sh` process — ironsmelt-01's loop is live now.
1. Empty slot, no loop/drawrec process, no INSTALL-HOLD. `python3 ~/holdtoken.py claim <token> 60`; hold
   `flock -n /tmp/mcai-canary.lock` for the whole install. Record the gate digest.
2. Stage in `~/t2min4/stage/`: apply `drawrec.sh.patch` to ~/mcai-analysis/drawrec.sh (d0d4d51c), `canary-loop.sh.patch`
   to ~/canary-loop.sh (344b1074), `canary-sched.py.patch` to ~/canary-sched.py (0d9a87f3); `patch --dry-run` first.
3. Run the three new suites with `--mutants`, test_canary_sched.py --mutants, test_drawrequire, test_threepool,
   test_bagfix_loop and test_holdtoken (host-only loop suites included).
4. Positive control on live inputs: the staged drawrec for the current head prints the installed one's lines (plus the
   `tier 2:` line for a tier-2 run); `canary-sched.py status` from the staged copy matches except an R10 line.
5. Back up (`*.bak-t2min4-<stamp>`), install by tmp+rename, re-read the digest, log to gate-installs.log and a
   draw-rules paragraph to RULES-IN-FORCE.md; release the lock and the hold. Rollback: restore the backups.

## 7. Reviews

(filled in per round)

## 8. Questions for the owner

1. **Accept the cost?** Waiting for 4 cost >= 17 h net of lane over 4.5 days in this replay (about 3.8 h/day), for one
   reasoned 3-h gain and cleaner tier-2 reads. *Recommendation:* install it as designed (12-h bound) only if that cost
   is acceptable; otherwise the cheap half — 4 of the 7 short draws found a 4th pool within 70 min — could be had with a
   short bound (e.g. 90 min) whose refusal sends the run back to be registered tier 3. That shortens the waits but adds
   a human step for each refusal (3 of 7 here), so it is the owner's trade.
2. **The middle option** (section 4: a short tier-2 draw re-draws under tier-3 exclusions, still judged as tier 2) —
   design and replay it?
3. **R10 part:** install it with the rest (recommended: a structurally narrow tier-2 head then waits without holding the
   lock), or leave R10 at 2?
