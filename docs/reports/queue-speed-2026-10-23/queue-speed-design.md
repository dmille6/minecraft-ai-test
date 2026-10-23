# Queue speed (2026-10-23): settle-based release and head-blocked lookahead — design + replay, NOTHING installed

OWNER 2026-10-23 ~13:00Z approved designing both; ~13:30Z set the acceptance criteria (Q15: install design 1 only if the
replay flips ZERO past verdicts, tighten and replay again if any flips, report every iteration and say which verdicts
were only reasoned; Q16: the next ready entry may launch once the head has been draw-blocked 30 min, the skipped head
goes first at the next opening and is never skipped twice in a row, every guard kept). Branch `queue-speed-1023`. On
10.0.0.31 only files were read (and read-only programs run through `ssh ... python3 -B -`, writing nothing there).

## 0. The short version

| | design 1: settle-based release | design 2: head-blocked lookahead |
|---|---|---|
| rule | an extra way OUT of the post-canary exclusion: a symmetric-build test instead of "one build in the last hour", bags and depth inside the controls' band, never sooner than today's timer for a tier-3 incoming run (iteration I8) | when the head's only obstacle is the draw for 30 min, the entry immediately behind it may launch, if it passes every check the head would, with the head's pools reserved |
| replay 10-12..10-23 | 34 draws; positive control 27/34 reproduced (section 1.3). I8 changes 2 draws, 0 h saved. Every iteration that changes a tier-2 draw flips at least one recorded KEEP through the v36 baseline (I2-I7: 1-3 flips each) | 6 draw-blocked episodes; **0 launches**: in every one the entry behind the head had `after: [head]`. With `after` read as ordering (a sensitivity run, not the rule): 2 launches, ~2.9 h of idle lane filled, the head delayed 3-4 h |
| verdicts | I8: 0 re-runnable flips; 2 verdicts reasoned only (stocktarget-02, keepout-01) | none re-runnable (a lookahead run would have run on other pools at another time) |
| recommendation | **do not install** (I8 meets the bar and buys nothing measurable); fix the baseline's transition test first (finding F4), then replay I2 again | **do not install as is**: it buys nothing while `after` is used as queue order. Install only with the owner's `after` decision (Q-2) |

**Live, time-sensitive (F3):** `indexsearch-01` (deployed 12:17Z, 2 pools, tier 2) cannot KEEP. It cannot KEEP at +180
(2 pools), and its +360 baseline is NOT CLEAN under the gate's own loader on the host: placebo-a ran poolescape-01's
canary until 08:05Z, inside the +360 lookback (`out/livecheck-indexsearch.out`). Under v36 it reads NOT_YET and then
INCONCLUSIVE at its final read (+360 ~18:15Z, or +720 if exposure is short). Same cause as the tier doc's risk (iv).

## 1. Design 1 — settle-based release of the post-canary exclusions

### 1.1 What holds a pool today, and why each exclusion exists

| exclusion | where | its reason (incident) | can a settle check see that reason? |
|---|---|---|---|
| 12 h after any decision | drawrec.sh (rule v5, 09-13) | registered when reads were +360 against a 6-h PRE: 6 h of read + 6 h of baseline. The 10-08 carryover study could neither support nor refute it | **No.** It is arithmetic about the next run's PRE window: a past fact |
| 6 h after a steady KEEP+promoted (tier-3 incoming) | drawsteady v35 (10-10), withdraw2/toolhygiene 4-pool starvation | the next +360 read's PRE, plus bag carryover (D1: bag DiD off zero for 12 h after 4 bag canaries) | bags: **yes** (rule 3 already does it); the PRE: no |
| tier-2 240 min / 360 after a tier-3 KEEP (tier-2 incoming) | v36 (10-19) | immobiledid PRE 180 + 60 trailing = the +180 KEEP's lookback | **No** (arithmetic); v36's baseline_clean re-checks it at every tier-2 KEEP |
| restart lag: one build in the last hour (rule 2), one build for 240 min (v36 version_clean) | drawsteady | fixes-01 REVERT 10-01 on ONE old-build canary row before the restart (memory: restart-lag rows are not canary) | **Yes**, from the rows — and today's test is the wrong one (finding F2) |
| death-driven REVERT | (inside the 12 h) | R11; a rare harm, unmeasurable on 5 bots | **No** — kept at 12 h in every iteration |

### 1.2 Findings that decided the design

- **F1 — every registration reads past +360.** All 36 registrations of the period schedule extension reads
  (`extension.until_exposure`, extra reads +540..+1560, at least +720). Their read scripts take PRE = CUT − W, and
  homefixread, homefix2read and protectzoneread take a fixed 24-h PRE (lidclear/cobblekeep a 12-h exposure PRE). A floor
  that covers every read (iteration I1) is >= 720 min, i.e. today's 12 h: **it changes no draw**. Today's 6-h and 240-min
  releases already accept a dirty PRE for extension reads; v36 guards that only for tier-2 KEEPs.
- **F2 — the restart-lag test kills the steady release after every promotion.** A fleet-wide promotion restarts every
  pool, so "only the fleet build in the last 60 min" (and v36's 240) fails for every pool and every control for that
  long, and the scheduler launches the next run ~10 min after each promotion. `out/attrib.out`: of the pool-attempts lost
  to an exclusion while the pool was otherwise eligible, 141 were KEEP+promoted pools (most past their timer and refused
  only by restart lag or by "fewer than 4 qualified controls" — the controls fail the same test), 68 INCONCLUSIVE 12 h,
  1 REVERT, 1 death-REVERT. That is why ironpick-01, poolescape-01 and townindex-01 drew 3 pools.
- **F3 — indexsearch-01 cannot KEEP** (above). It was drawn on placebo-a at 245 min under the tier-2 240 rule, with 2 pools.
- **F4 — the v36 baseline test is fragile across a fleet restart.** It accepts a canary row on another build only in
  the bucket either side of a change of the control majority, and a tie in the vote fails it. A 16-min staggered restart
  straddles three 10-min buckets, so whether a pool set passes can turn on a one-vote majority — that is, on which pools
  are in the control. ironpick-01's actual set passed (control vote 33 v 32 in the 00:16Z bucket); the counterfactual set
  with two other pools failed (32 v 28 the other way) on 23 late rows of one bot. `out/fragility.out`: at 2 of 8 tier-2
  draw times, 13 and 42 of 330 four-pool sets fail on a tied vote alone. (Most other NOT-clean sets in that file contain
  a pool that really ran another canary in the window; its "restart straddle" column is a crude 40-min proximity label.)

### 1.3 Replay method (scripts in this folder; outputs in `out/`)

1. `hostscan.py` — one read-only pass over every bot's skill logs (live + rotated .gz, 10-11 00:00Z .. 10-23 15:00Z,
   18,069,506 rows, 80 bots), reduced to 5-min buckets: rows and items per full code.version, livelock/entombed rows,
   bag slots at the skill's end, position depth, every draw_exposure requirement of the period, deaths, corrupt lines.
2. `drawsim.py` — drawrec.sh at any past instant: poolrank2's band, immobiledid's exposure filter, drawexposure,
   the ledger exclusions through the host's OWN `drawsteady.parse_ledger / candidates / candidates_t2` and `tierrule`,
   the steady checks re-implemented on the buckets, draw_require_pools, the live canary, the rule epochs (v35.1
   10-13 16:21Z, v36 10-19 16:27Z).
3. **Positive control:** each of the 34 actual draws since 10-12 re-drawn 2 min before its `drawn` row. **27/34
   reproduced** (a <4-pool draw must equal the reconstruction, a 4-pool draw be inside it). The 7 misses are band-edge
   effects, 4 of them within 10 min of a promotion when poolrank2's band rests on a few minutes of rows on the new build.
   **Iterations are therefore compared with today's rule re-drawn the same way, never with the actual draw**, so the
   reconstruction's noise cancels; a change on a draw the control missed is marked as such.
4. `replay_settle.py` — each iteration re-draws at every attempt the loop made (1 min after `draw`, then every 22 min)
   and at the actual draw. `attrib.py` — which exclusion held which otherwise-eligible pool.
5. `flips.py` — for every changed draw, what CAN be re-run exactly (the canary arm of a changed draw holds pools that
   never ran that canary, so its own reads cannot be):
   - R1 the v36 baseline (the gate's own `tierrule.asymmetric_rows`) for the counterfactual set at the counterfactual
     time, at the deciding read and at +180;
   - R2 the death gate (the bundle's `deathgate.death_gate`, md5 450d32bf) at every 5-min poll — the 10-08 method
     generalised: pools move between arms, every death is a recorded death, a pool that did not run the canary keeps its
     own deaths (a null-effect assumption, stated: it dilutes a harmful canary);
   - R3 a tier-2 +180 KEEP (`tierrule.keep_early`) with the recorded +180 artifact's lines — REASONED;
   - R4 everything else — REASONED.
   Positive controls: the actual arms reproduce every recorded death line exactly (deaths and bot-h, 7 of 7 runs) and
   every tier-2 run's recorded `tier 2 baseline` CLEAN.
6. `hostcontrol_settle.py` — the PATCHED drawsteady.py run read-only on the host (STEADY_NOW = keepout-01's draw,
   10-22 07:00Z; the manifest of that instant served from memory). It prints today's lines unchanged and releases
   board-b, board-c, placebo-d — exactly the replay's I8 answer (`out/hostcontrol-keepout.out`).

**Re-running it.** The snapshot is not committed (the scan is 42 MB). To rebuild it, read-only:
`ssh 10.0.0.31 'nice -n 19 python3 -B - 2026-10-11T00:00:00Z 2026-10-23T15:00:00Z' < hostscan.py > scan.jsonl`;
copy `~/canary-journal.jsonl`, `/var/log/mcai/_canary-decisions.jsonl` (as `ledger.jsonl`), `~/digest/sched.log`
(under `digest/`), `~/mcai-analysis/registrations/*.json` (under `regs/`), `~/digest/reads/*-verdict-*.json` (under
`reads/`), `~/canary-queue.json*` (a `queues/` dir), `~/mcai-analysis/{drawsteady,tierrule,drawrequire}.py` and
`~/gate-v36/` into one snapshot dir; then `python3 replay_settle.py SNAP scan.jsonl SNAP/mcai-analysis patches --json
settle.jsonl`, `python3 flips.py SNAP scan.jsonl SNAP/mcai-analysis patches settle.jsonl`, `python3 replay_lookahead.py
SNAP scan.jsonl SNAP/mcai-analysis patches SNAP/queues [--after-ordering]`, `python3 attrib.py ...`,
`python3 lanetime.py SNAP 2026-10-19T00:00:00Z 2026-10-23T12:17:00Z`. Runtime ~5 min each on a laptop.

### 1.4 The iterations (`out/settle.out`, `out/flips.out`)

| it. | rule | draws changed | re-runnable flips | lane time |
|---|---|---|---|---|
| I1 | floor = every read the run can take (extensions too) | **0** | 0 | 0 |
| I2 | today's timers; symmetric build test S2 (240 min) instead of one build | 4: stocktarget-02 2->3 pools; ironpick-01 3->4; keepout-01 (composition); poolescape-01 drawn 23 min EARLIER on 2 pools (board-d, hive-a) instead of 3 | **1**: ironpick-01 KEEP +360 -> the 4-pool set's baseline NOT CLEAN at +180 and +360 (F4: 23 late rows of one bot across the 00:28Z restart) | ~0.4 h, and poolescape-01 loses a pool |
| I3 | I2 + INCONCLUSIVE / non-death REVERT at 240 (tier 2) / 360 (tier 3) | 7 (+ townsearch-01 4.5 h earlier; bagbudget-01 composition; toolkit-03 3->4) | **2**: + toolkit-03 KEEP +720 -> NOT CLEAN at +720 (hive-a ran bagbudget-01's canary 434 min before: a GENUINE contamination) | — |
| I4 | I3 + tier-2 incoming after a tier-3 KEEP at 240 | 8 (+ townindex-01 3->4) | **3**: + townindex-01 KEEP +360 -> NOT CLEAN (placebo-a ran keepout-01's canary 334 min before: genuine) | — |
| I5-I7 | I2-I4 with the bag reference "every settled pool except the candidate's siblings" | as I2-I4, except I7 draws townindex-01 70 min earlier on 2 pools (clean) | 1 / 2 / 2 | — |
| **I8** | **I2 for TIER-3 incoming runs only**; a tier-2 draw keeps today's v36 release exactly | 2: stocktarget-02 (10-14) +1 pool, board-a; keepout-01 (10-22) composition board-b instead of hive-b (a draw the control did not reproduce) | **0**: R1 CLEAN, R2 no trip on both | **0 h** |
| I9 | I3 for tier-3 incoming only | 3 (+ townsearch-01 drawn 00:25Z instead of 04:57Z) | 0 re-runnable; townsearch-01 closed by hand INCONCLUSIVE, so nothing to re-run, and hive-d ran plinth-01's canary 457 min before the counterfactual deploy, inside its +540/+720 extension PRE (tier 3: no gate checks it) | 4.5 h, on a run that was INCONCLUSIVE |

The tightening path the owner asked for was followed: I2-I4 flipped (1, 2, 3 verdicts, each found by R1); the bag
reference change (I5-I7) did not remove a flip; restricting to tier-3 incoming runs (I8) leaves no re-runnable flip.
I9 is not offered: its one time saving lands a released pool inside an unguarded extension PRE. A second cost showed
up that is not a flip: an earlier draw is made at the FIRST attempt that reaches two pools, so the settle path can turn
a 3-pool draw into an earlier 2-pool one (poolescape-01 in I2, townindex-01 in I7) — less power, and no +180 KEEP.

**Does a version meet the bar? I8 does — 0 re-runnable flips — with two verdicts reasoned only** (stocktarget-02 KEEP
+360 and keepout-01 KEEP +360: their reads on the added/swapped pools cannot be re-run; their baselines are clean and
the death gate holds on the counterfactual arms). It saves no lane time in this period: it adds one pool to one run.

### 1.5 The proposed rule (I8) — `patches/settlerule.py`, `patches/drawsteady.py.patch`

A pool comes out on the settle path for an incoming run R when R opts in (`"settle": {"lookback_min": N}`, N = the
longest FIXED pre-window of its read scripts) and is not a bag fix, underground-safety or model-env run, and EVERY ledger
decision naming the pool in 12 h is closed (its last teardown, or the fleet-wide promotion of its sha), not a
death-driven REVERT or an unpromoted KEEP, and at least FLOOR past that close: FLOOR = 360 for a tier-3 KEEP promoted
fleet-wide (today's 6 h, counted from the promotion), raised to N; no other cell (so INCONCLUSIVE / REVERT keep 12 h and
tier-2 incoming draws keep v36 exactly). Then, measured: S1 every enabled bot active, >= 20 rows, no corrupt line, bag
readings in both halves; S2 every row of the pool on its bucket's fleet-majority build over max(240, FLOOR) —
`tierrule.asymmetric_rows` with the pool as the canary arm (replaces "one build in the hour"); S3 bag fill, halves and
change inside the qualified controls' min..max; S4 the share of position rows below y=50 inside the same band. Controls:
untouched pools passing S1 + S2(240), >= 4. Releases are UNIONED with today's; a settle failure never costs today's
release. The wider tables (I3) are kept in the module for the record, marked rejected.

### 1.6 Residuals (named)

(i) Extension reads beyond +360 on a released pool have a dirty PRE — as today's 6-h release already accepts for tier 3.
(ii) The bag/depth bands are min..max of >= 4 controls: lenient by construction. (iii) The replay uses today's unit
roster (the `-Charlie` units of 10-12..10-21 are not in it), as the 10-10 replay did. (iv) World state and pool memory
persist at any timer; no check here sees them. (v) The steady() reason text printed on a settle line still says "on X
only for 60 min" — cosmetic, S2 is what was measured.

## 2. Design 2 — head-blocked lookahead in the scheduler

### 2.1 Why the scheduler cannot do this today

The draw wait happens INSIDE the loop: the scheduler launches the head as soon as R10 passes, and the loop then sits in
`draw` holding the loop lock (S2/S3/S7 busy) re-drawing every 20 min. Of the 5.2 h of draw-wait in 10-19..10-23, 4.4 h
was the loop in `draw` (indexsearch-01 2.4 h, townindex-01 2.0 h), 1.2 h the scheduler's R10 WAIT. So the design adds
**R12, a draw probe**: before launching, the scheduler runs drawrec.sh for the head (read-only; against a temp
registrations dir holding only the queued bytes, `DRAW_REGDIR`, exactly as R10 does with `--registrations`; at most every
20 min, cached in sched-state `drawprobe` rows). A probe that draws fewer than the run's minimum (2; 3 for a bag fix,
whose loop never deploys on 2; a draw_k cap) makes the head WAIT in the scheduler instead of parking a loop.

### 2.2 The rule — `patches/lookahead.py` (pure), `patches/canary-sched.py.patch`, `patches/drawrec.sh.patch`

- L0 the slot is free by every S-check; no R11 death-hold; no SCHED-PAUSE / INSTALL-HOLD; no NEXT-SLOT reservation.
- L1 the head's ONLY obstacles are R10 WAIT or R12 WAIT (`draw_wait`); a head with a hold, not_before, unmet `after`,
  missing variant, refusal / blocked attempt, or H3-H6 is never looked past (a WAIT on H1 not_before is not a draw wait).
- L2 draw-blocked continuously >= 30 min: the scheduler writes `drawwait` on entering and `drawclear` on leaving; the
  episode starts at the first `drawwait` of the current run of them.
- L3 never twice in a row: the `launching` row of a lookahead launch records `lookahead_past: <head>`; while the most
  recent launch is that one, the head is not skipped again — it goes first at the next opening and waits there for
  its draw. Starvation is bounded by ONE run's duration.
- L4 the candidate is the entry IMMEDIATELY behind the head (done/cancelled entries are not positions). It must be
  `ready`, unheld, not_before passed, every `after` closed, a variant keyed by the full fleet base, and pass the head's
  full checks (variant_checks H3/H4, head_blockers, R10, R12 with the head's pools RESERVED). Any hard blocker stops the
  lookahead: nothing further back is considered.
- The reserve = the head's drawexposure pools (R10's `eligible on exposure`) plus whatever its own probe found eligible.
  The scheduler launches the candidate's loop with `DRAW_RESERVE`; the loop's drawrec inherits it and excludes those
  pools from this draw only (they stay in its control arm). The slot, the head, the base and the candidate are re-read
  after the minutes of checks, before anything is touched.
- Interactions: still one canary at a time (it only ever launches into a free slot), so the one-canary-pool rule, the
  tripper (two builds), the bag-fix and underground rules are untouched; INSTALL-HOLD / holdtoken: S8 makes the slot busy,
  so nothing launches, and holdtoken's claim waits on the same tick lock the probes run under; R11 blocks everything.
- `after` and variant keys when the base moves under the skipped head: a lookahead run that KEEPs and is promoted moves
  the fleet base; the head's variant keyed on the old base no longer matches, so the head blocks on H2 until a variant on
  the new base exists (the separate pre-build work must then build the head on every possible lookahead sha). An entry
  that names the head in `after` is never a candidate. A REVERT / INCONCLUSIVE lookahead leaves the base unchanged.

### 2.3 Replay (`replay_lookahead.py`, `out/lookahead.out`)

The queue at each episode is rebuilt from the host's backups (`canary-queue.json.bak-<op>-<stamp>`, one per edit: the
queue at T = the earliest backup after T). Episodes 10-12..10-23 with the head draw-blocked >= 30 min and the slot free:
gridfix-01 6.0 h, townsearch-01 5.7 h, toolkit-02 1.2 h, townindex-01 2.0 h, indexsearch-01 0.9 h (R10) + 2.4 h (draw).

**Under the rule: 0 launches.** In all six the entry behind the head had `after: [head]` (bamboo-01, plinth-02, wellcare-01,
indexsearch-01, chatgate-01), and in four of them it also had no variant on the base. The queue uses `after` as ORDER.

**Sensitivity (`--after-ordering`, not the rule; `out/lookahead-after-ordering.out`):** reading `after` as satisfied when
the entry already has a variant on the base gives 2 launches: plinth-02 at 10-16 23:48Z (it was in fact rolled out
owner-direct the next day, never as a canary) and chatgate-01 at 10-23 09:20Z on board-b, board-c, hive-a with board-a,
placebo-a reserved. chatgate-01 has not run, so its duration is unknown: at a typical 3-pool tier-2 6.2 h it would close
~15:30Z, filling ~2.9 h of idle lane, and indexsearch-01 would then start ~3-4 h later than it did — and, if chatgate-01
KEPT, only after a re-variant onto chatgate's sha (H2). Its verdict, and indexsearch-01's, are REASONED only.

## 3. Tests (all pass; every mutant killed; positive controls in each)

| suite | result |
|---|---|
| `patches/test_settlerule.py --mutants` | 34/34; 9/9 anchored, unique mutants killed; an absent anchor is refused (positive control) |
| `patches/test_lookahead.py --mutants` | 27/27; 16/16 killed; positive control |
| scripts/host/test_canary_sched.py, patched (`patches/test_canary_sched.py.patch`) | 109/109 (93 existing + 16 new); mutants: see section 5 |
| scripts/test_threepool.py, patched (one mutant re-anchored: qualify's `one_build`) | 163/163, as at v36 |
| scripts/test_tiers.py on the patched drawsteady | 127/127 (7 host-only mutants skipped, as before) |
| host positive control (patched drawsteady, read-only, 10-22 07:00Z) | today's lines unchanged; settle RELEASE = the replay's |

The fixture's drawrec stub now prints drawrec's own DRAW line (R12), and `t_h6_bagfix_needs_k4` now expects a bag fix
with a 2-pool draw to WAIT (R12) and to launch on 3.

## 4. If the owner approves — install steps for the operator

Nothing here changes a gate bundle file (verdict.py, deathgate, singledeath, arms, bagfixrule, usaferule, tierrule,
bagfixgate, changerowcheck, usafegate): the digest must read **635ad8d866a6e4a772351961bd5bd997 before and after**.

1. In an empty slot (no canary declared, `check-open-loop.py` clear, no loop/drawrec process):
   `TOKEN=qs1023-$$-$(date +%s%N); python3 ~/holdtoken.py claim "$TOKEN" 90` (rc 0, else stop), then
   `exec 9>/tmp/mcai-canary.lock; flock -n 9 || exit 1` for the whole install.
2. `python3 ~/verdict.py --gate-digest | head -1` -> 635ad8d8...; record it.
3. Stage in `~/qs1023/stage/`: settlerule.py, drawsteady.py (patch applied to the live 7f34cbad), drawrec.sh (patch
   applied to the live d0d4d51c — NOTE the repo's scripts/host/drawrec.sh is the older 986e18d2), lookahead.py,
   canary-sched.py (patch applied to the live 0d9a87f3), and the patched tests.
4. Run there: test_settlerule.py --mutants, test_lookahead.py --mutants, test_canary_sched.py --mutants,
   test_threepool.py, test_tiers.py, test_holdtoken.py (it loads canary-sched.py), test_drawrequire.py and
   test_bagfix_loop.py (drawrec changed). All must pass.
5. Positive controls on the live inputs: staged drawsteady with DRAW_RUN unset and with a run that has no `settle` block
   prints byte-for-byte the installed one's output; `hostcontrol_settle.py` at 10-22 07:00Z prints RELEASE ['board-b',
   'board-c', 'placebo-d']; staged drawrec with DRAW_RESERVE and DRAW_REGDIR unset prints the installed one's
   eligible/DRAW lines for the same instant; staged `canary-sched.py tick --no-act` and `status` run, and the only
   difference from the installed one is an R12 line.
6. Back up (`*.bak-qs1023-<stamp>`) and install by tmp+rename: ~/mcai-analysis/{settlerule.py,drawsteady.py,drawrec.sh},
   ~/{lookahead.py,canary-sched.py}. Re-read the gate digest: unchanged. Append a line to ~/digest/gate-installs.log and a
   paragraph to ~/digest/RULES-IN-FORCE.md (draw rules, not gate rules).
7. `flock -u 9`; `python3 ~/holdtoken.py release "$TOKEN"`. The next tick shows R12; a registration opts into the settle
   path only by declaring `settle.lookback_min`.
Rollback: restore the five backups (the gate digest is untouched either way).

## 5. Reviews

See section 6 (filled in after the review rounds).

## 6. Questions for the owner

1. **Design 1: install I8 or not?** It meets your bar (0 re-runnable flips, 2 reasoned) and saves nothing measurable.
   *Recommendation: not now.* The lever it was meant to pull (3-pool tier-2 draws) is held by two things a release rule
   cannot fix safely: the v36 baseline's fragile transition test (F4: a fleet restart straddles three buckets; a tie
   fails it) and genuinely dirty PRE windows (toolkit-03, townindex-01 in I3/I4). Fix F4 first — a gate change with its
   own design and replay — then re-run this replay (the scripts take any rule table).
2. **Design 2: is `after` a dependency or an order?** The lookahead buys nothing while every entry names the one before
   it. *Recommendation:* keep `after` for real code dependencies only (an entry built on another's sha), and order by
   queue position; then install design 2 (R12 is useful even alone: it stops parking a loop, holding the lock, in `draw`).
3. **indexsearch-01 (live):** it cannot KEEP (F3). Close it INCONCLUSIVE early under the 10-15 rule, or read on for its
   mechanism evidence? *Recommendation:* read to +360 for the evidence, then close; and, prospectively, do not let the
   tier-2 240-min release put a pool into a tier-2 draw of fewer than 4 pools (it can neither KEEP at +180 nor have a
   clean +360).
4. **The other idle (23.5 h in 10-19..10-23):** R11 holds 6.1 h, install holds 4.4 h + other installs 2.2 h, JIT variants
   1.4 h, draw waits 5.2 h, R10 1.2 h. The two designs address at most the last two.
