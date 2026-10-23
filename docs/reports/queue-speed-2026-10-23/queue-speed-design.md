# Queue speed (2026-10-23): settle-based release and head-blocked lookahead — design + replay, NOTHING installed

OWNER 2026-10-23 ~13:00Z approved designing both; ~13:30Z set the acceptance criteria: **Q15** install design 1 only
if the replay flips ZERO past verdicts (tighten and replay again if any flips; report every iteration; say whether a
version meets the bar and which verdicts were reasoned rather than re-run). **Q16** the next ready entry may launch
once the head has been draw-blocked 30 min; the skipped head goes first at the next opening and is never skipped twice
in a row; every guard kept. Branch `queue-speed-1023`. On 10.0.0.31 only files were read, and read-only programs were
run through `ssh ... python3 -B -` (stdin; nothing written there).

## 0. The short version (round 3, after both engines' round-2 reviews)

| | design 1: settle-based release | design 2: head-blocked lookahead |
|---|---|---|
| rule | an extra way OUT of the post-canary exclusion (never a way in): a symmetric-build test instead of "one build in the last hour", bags and depth inside the controls' band, never sooner than a floor table | when the head's only obstacle is the draw for 30 min, the entry immediately behind it may launch if it passes every check the head would, with the head's pools reserved; a new R12 draw probe makes the draw wait visible to the scheduler |
| replay 10-12..10-23 | 34 draws (positive control 27/34). 9 iterations, each carried forward through the later draws (the cascade). **Zero flips is not demonstrable for any iteration that changes a draw.** Six of them (I3, I4, I6, I7, I8, I9) flip protectzone-01's recorded +180 KEEP (a cascaded predecessor takes board-b, it draws 3 pools, and a tier-2 +180 KEEP needs exactly 4); I2 and I5 find no flip, but keepout-01 is left with 1 pool and would have waited, which the replay cannot follow, and 6 changed verdicts stay reasoned only. I1 changes nothing | 6 draw-blocked episodes, checked every 10 min: **0 launches** — every entry behind a blocked head had `after: [head]`. Sensitivity (`after` read as order): 2 launches (plinth-02, chatgate-01), both of runs that never ran, so no duration or verdict exists |
| hours saved | not demonstrable; the one reasoned gain (ironpick-01 +180 KEEP on 4 pools, ~3 h, I2/I5) leaves keepout-01 with one pool, i.e. waiting | 0 under the rule; unknown in the sensitivity run |
| recommendation | **do not install** | **do not install the lookahead**; R12 alone is the part worth having, once reviewed (Q-2) |
| reviews | r1 both REQUEST CHANGES; r2 both REQUEST CHANGES (the conclusion held; the flips were mis-attributed); r3: section 5 | r1 both REQUEST CHANGES; r2 Claude APPROVE, Codex REQUEST CHANGES (head not revalidated); r3: section 5 |

**Facts observed since the first draft (in the replay period):** indexsearch-01 closed **INCONCLUSIVE early at +180**
(15:21Z, operator, owner 10-15 rule: unexposed on its smelt half), torn down 15:25Z. It could not have KEPT anyway (F3).
**Isolated phase 2** (isolated-a, -c, -d to shared towns) applied 15:26-15:28Z under an INSTALL-HOLD; the lane is held
(S8) until the 240-min quiet ends ~19:28Z (the hold file reads until 20:26Z). Lane accounting 10-19 00:00Z..16:45Z
(`out/lanetime-to-1645Z.out`): 112.8 h, live 88.0 h; idle: R11 6.1 h, install holds 5.7 h (+1.3 h today), loop draw
waits 5.2 h, other installs/deploys 2.2 h, H2 1.4 h, R10 1.2 h, H1 0.8 h. Neither design touches R11 or install holds.

## 1. Design 1 — settle-based release of the post-canary exclusions

### 1.1 What holds a pool today, and why each exclusion exists

| exclusion | where | its reason (incident) | can a settle check see that reason? |
|---|---|---|---|
| 12 h after any decision | drawrec.sh (rule v5, 09-13) | registered when reads were +360 against a 6-h PRE: 6 h of read + 6 h of baseline. The 10-08 carryover study could neither support nor refute it | **No.** It is arithmetic about the next run's PRE window, a past fact |
| 6 h after a steady KEEP+promoted (tier-3 incoming) | drawsteady v35 (10-10): withdraw2/toolhygiene four-pool starvation | the next +360 read's PRE, plus bag carryover (D1: bag DiD off zero for 12 h after 4 bag canaries) | bags **yes** (rule 3 already); the PRE no |
| tier-2 240 min / 360 after a tier-3 KEEP (tier-2 incoming) | v36 (10-19) | immobiledid PRE 180 + 60 trailing = the +180 KEEP's lookback | **No** (arithmetic); v36 baseline_clean re-checks it at every tier-2 KEEP |
| restart lag: one build in the last hour (rule 2), one build for 240 min (v36 version_clean) | drawsteady | fixes-01 REVERT 10-01 on ONE old-build canary row before the restart | **Yes**, from the rows; today's test is the wrong one (F2) |
| death-driven REVERT | inside the 12 h | R11; a rare harm, unmeasurable on 5 bots | **No** — 12 h in every iteration |

### 1.2 Findings

- **F1 — every registration reads past +360.** All 36 registrations of the period schedule extension reads (at least
  +720). homefixread, homefix2read and protectzoneread take a fixed 24-h PRE (lidclear/cobblekeep a 12-h exposure PRE).
  A floor covering every read (I1) is >= 720 min, i.e. today's 12 h: it changes no draw. Today's 6-h and 240-min
  releases already accept a dirty PRE for extension reads; v36 guards that only for tier-2 KEEPs.
- **F2 — what actually keeps otherwise-eligible pools out** (`out/attrib.out`; corrected in round 2): 211 pool-attempts
  lost while the pool was in band and exposed: KEEP+promoted 141 — **95 still inside their timer** (36 < 240, 59 < 360)
  and 46 past it but refused by a steady check (22 restart lag, 14 too few qualified controls, the rest bags);
  INCONCLUSIVE 12 h 68; REVERT 1; death-REVERT 1. So the timers, not the restart-lag test, are the main constraint;
  the restart-lag test still kills every steady release for an hour after each fleet-wide promotion (it fails every
  pool and every control at once), and the next canary launches ~10 min after each promotion.
- **F3 — indexsearch-01 could not KEEP** (`out/livecheck-indexsearch.out`, the gate's own loader on the host): 2 pools,
  so no +180 KEEP; its +360 baseline NOT CLEAN (placebo-a ran poolescape-01's canary until 08:05Z, inside the 360-min
  lookback), its 240 clean (positive control). It closed INCONCLUSIVE at +180 at 15:21Z for exposure. A REVERT stayed
  possible throughout; only the KEEP paths were closed.
- **F4 — the v36 baseline test fails on tied control votes.** Re-measured in round 2 with the gate's own loader on the
  host (`fragility_host.py`, `out/fragility-host.out`): of the 330 four-pool sets at ironpick-01's actual declared time,
  **35 are first refused on a tied control majority** (at both +180 and +360; the tie check returns before any canary
  row is examined, so some of them may also hold a real asymmetric row), 261 on a real asymmetric row, 34 clean; at
  poolescape-01's, 0 ties. A 16-min staggered fleet restart puts the vote near 50/50 in one bucket. The round-1 claims
  that ironpick-01's and poolescape-01's 4-pool sets flip on F4 were an artefact of the 5-min-bucket approximation
  (Codex r1 P1): with the exact loader both are CLEAN.

### 1.3 Replay method (scripts in this folder; `run_all.sh` runs them in order; outputs in `out/`)

1. `hostscan.py` — one read-only pass over every bot's skill logs (live + rotated, 10-11 00:00Z..10-23 15:00Z,
   18,069,506 rows, 80 bots) into 5-min buckets: rows and items per full code.version, livelock/entombed rows, bag
   slots at the skill's end, position depth, every draw_exposure requirement of the period, deaths, corrupt lines.
2. `drawsim.py` — drawrec.sh at any past instant: poolrank2's band, immobiledid's exposure filter, drawexposure, the
   ledger exclusions through the host's OWN `drawsteady.parse_ledger / candidates / candidates_t2` and `tierrule`, the
   steady checks on the buckets, draw_require_pools, the live canary, the rule epochs (v35.1 10-13 16:21Z, v36 10-19
   16:27Z). **Positive control:** the 34 actual draws re-drawn 2 min before `drawn`: **27/34** (a <4-pool draw must
   equal the reconstruction, a 4-pool draw be inside it). The 7 misses are band-edge effects, 4 within 10 min of a
   promotion. Iterations are compared with **today's rule re-drawn the same way**, never with the actual draw; "draws
   changed" is a lower bound (the misses cluster where the settle path acts).
3. `replay_settle.py` — each iteration re-draws at every attempt the loop made (1 min after `draw`, then every 22 min)
   and at the actual draw, and **carries every changed draw forward** (round 2, Claude r1 P1): its run decides on its
   counterfactual pools, which then sit in the 12-h exclusion and the live set for all later draws. The counterfactual
   set (round 3, Claude r2): an EARLIER draw (only against a reconstruction that itself drew) takes the pools eligible
   at its first attempt; otherwise the actual pools still drawable in this world, plus pools this world made drawable
   that today's rule re-drawn at the same instant did not have (released, then freed by the cascade), up to the target;
   flagged when it is one of several valid draws. A run left below its minimum is **UNMODELLED** (it would have waited);
   every later changed draw in that iteration is marked **CONDITIONAL** on it.
4. `flips.py` — for every changed draw, what can be re-run exactly, and what is reasoned:
   - rule: a tier-2 +180 KEEP needs exactly 4 pools (deterministic);
   - **R1** the v36 baseline, computed **on the host by the gate's own code** (`hostbaseline.py`: `tierrule.load_buckets`
     + `asymmetric_rows`, verdict.py's arms; `out/r1-host.json`, 17 queries, 0 corrupt lines) — a recorded tier-2 KEEP on
     a NOT CLEAN baseline is a flip. For a tier-3 run no gate checks it: a dirty PRE there is reasoned risk, not a flip.
     R1 reads the REAL logs, so where a run this iteration changed (or left unmodelled) was live inside the lookback it
     describes the wrong world: such an R1 is **CASCADE-BLIND** and counts as reasoned (round 3, Claude r2 P2 — this
     removed the round-2 townindex-01 and poolescape-01 flips);
   - **R2** the death gate (the bundle's `deathgate.death_gate`, md5 450d32bf) at every 5-min poll on the counterfactual
     arms — the 10-08 method generalised; pools that never ran the canary keep their own deaths (null-effect
     assumption, stated: it dilutes a harmful canary). It re-runs the gate's arithmetic, not counterfactual deaths;
   - **R3** a tier-2 +180 KEEP (`tierrule.keep_early`) with the recorded +180 artifact's lines — REASONED;
   - everything else (own lines, exposure, guards on pools that never ran the canary) — REASONED.
   Positive controls: the actual arms reproduce **11 of 11** recorded death lines exactly (deaths and bot-h; the other
   changed runs were closed by hand) and all 6 tier-2 runs' recorded `tier 2 baseline` CLEAN with the host loader.
5. `hostcontrol_settle.py` — the PATCHED drawsteady.py run read-only on the host at keepout-01's draw (10-22 07:00Z):
   today's lines unchanged; settle RELEASE board-b, board-c, placebo-d (the replay's answer); 36 s wall time.

### 1.4 The iterations (round 3: cascade, host R1, cascade-blind R1, conditional draws; `out/settle.out`, `out/flips.out`)

| it. | rule | draws changed | flips (re-runnable) | reasoned only | notes |
|---|---|---|---|---|---|
| I1 | floor = every read the run can take | 0 | 0 | 0 | buys nothing (F1) |
| I2 | today's timers; S2 symmetric build (240 min) instead of one build | 6 | 0 | 6 | ironpick-01 draws 4 (adds hive-b; R3: a +180 KEEP, ~3 h earlier, reasoned); keepout-01 then has 1 pool — **UNMODELLED**; poolescape-01 and indexsearch-01 CONDITIONAL on it |
| I3 | I2 + INCONCLUSIVE / non-death REVERT at 240 (t2) / 360 (t3) | 15 | **1** protectzone-01 | 14 | |
| I4 | I3 + tier-2 after a tier-3 KEEP at 240 | 16 | **1** protectzone-01 | 15 | townindex-01's round-2 flip is now CASCADE-BLIND (reasoned) |
| I5 | I2 + a siblings-out bag reference | 6 | 0 | 6 | as I2 |
| I6 / I7 | I3 / I4 + siblings-out | 15 / 15 | **1** / **1** protectzone-01 | 14 / 14 | |
| I8 | I2 for tier-3 incoming only | 6 | **1** protectzone-01 | 5 | keepout-01 draws board-b, hive-b, placebo-a; protectzone-01 then draws 3 pools and its recorded +180 KEEP cannot happen (exactly 4 needed) |
| I9 | I3 for tier-3 incoming only | 10 | **1** protectzone-01 | 9 | |

The protectzone-01 flip is decided by the tier-2 pool-count rule. In I8 and I9 it rests on an unambiguous upstream
draw (keepout-01 drew the pools it actually drew plus the released board-b; Claude r2: in the other consistent model
protectzone-01 draws 4 and its change is composition only). In I3, I4, I6 and I7 it also depends on ironpick-01's
counterfactual set, which is one of several valid draws (Claude r3 P3).

**Does a version meet the bar? No version that changes a draw can be shown to.** Six flip a recorded KEEP. I2 and I5
find no flip, but each strands keepout-01 below two pools — a wait the replay cannot follow — and leaves 6 changed
verdicts reasoned only (stocktarget-02, wellsite-02, ironpick-01, keepout-01, poolescape-01, indexsearch-01). That is
"not knowable from this history", not "zero flips". I1 meets the bar trivially and changes nothing. The wider tables
(I3/I4/I6/I7/I9) add townsearch-01, kitshrink-01, smeltjob-01, wellcare-01, bagbudget-01, homefix-01, toolkit-03,
homefix-02 and townindex-01 to the reasoned list.

### 1.5 The mechanism (offered for a later replay, not for install) — `patches/settlerule.py`, `drawsteady.py.patch`

A pool comes out on the settle path for an incoming run R when R opts in (`"settle": {"lookback_min": N}`, N = its
reads' longest FIXED pre-window), is not a bag fix / underground-safety / model-env run / draw_k cap, and EVERY ledger
decision naming the pool in 12 h is closed (last teardown, or the fleet-wide promotion of its sha), not a death-driven
REVERT or unpromoted KEEP, and at least FLOOR past that close (a table by incoming tier, predecessor kind and
predecessor tier, raised to N; a floor past 720 is no release). Measured: S1 every enabled bot active, >= 20 rows, no
corrupt line, bag readings in both halves; S2 every row of the pool on its bucket's fleet-majority build over
max(240, FLOOR) — `tierrule.asymmetric_rows` with the pool as the canary arm; S3 bag fill, halves and change inside the
qualified controls' min..max; S4 the share of position rows below y=50 inside the same band. Controls: untouched pools
passing S1 + S2(240), >= 4. The release is UNIONED with today's. Isolation: the settle measurement runs under a HARD
240-s deadline (SIGALRM interrupts the log scans themselves; round 3, Codex r2 P2), well inside drawrec's 600-s
drawsteady timeout; any settle failure or timeout releases nothing early and keeps today's release (tested with a
hanging scan); with no today's candidate a settle failure is not printed as a steady refusal (drawrec does not page it).
The host run at 10-22 07:00Z took 36 s in all.

### 1.6 Residuals (named)

(i) Extension reads beyond +360 on a released pool have a dirty PRE (as today's 6-h release already accepts for tier 3).
(ii) Bag/depth bands are min..max of >= 4 controls: lenient. (iii) The replay uses today's unit roster (the `-Charlie`
units of 10-12..10-21 are not in it), as the 10-10 replay did. (iv) World state and pool memory persist at any timer.
(v) `settle.lookback_min` is declared by the registrant and not derived (Claude r1 P2): an under-declared value fails
open — a reason more not to install as is; a `queue add` check that greps the read scripts' fixed PRE windows would be
needed. (vi) steady()'s reason text on a settle line says "on X only for 60 min"; S2 is what was measured.

## 2. Design 2 — head-blocked lookahead in the scheduler

### 2.1 Why the scheduler cannot do this today

The draw wait happens INSIDE the loop: the scheduler launches the head once R10 passes, and the loop sits in `draw`
holding the lock (S2/S3/S7 busy), re-drawing every 20 min. In 10-19..10-23: 5.2 h of loop draw-wait plus 1.2 h of
scheduler R10 WAIT (6.4 h in all). So the design adds **R12, a draw probe**: before launching, the scheduler runs
drawrec.sh for the head against a temp registrations dir holding only the queued bytes (`DRAW_REGDIR`, as R10 does),
with `DRAW_PROBE=1` and `DRAW_TXT` in the temp dir, so it writes nothing outside it and pages nothing (round 1, both).
At most every 20 min (cached `drawprobe` rows). Its answer:
- **WAIT** only on scarcity: drawrec's own `NONE (fewer than N eligible)` or a required pool still excluded / without
  data (`...: waiting` — this includes a required pool under a manual `draw-exclude.txt` exclusion, e.g. reseed-pool.sh's
  72 h, so the lookahead may launch past such a head; Claude r2 P3), or fewer pools than the run's minimum (2; 3 for a
  bag fix; a draw_k cap);
- **BLOCK** (with its remedy) on everything else: a non-zero exit, a drawexposure / draw_k / reserve / draw-exclude
  refusal line, any other NONE (Codex r1 P1: a refusal is never skippable), and **missing instruments**: drawrec now
  prints `instruments: band rows N, exposure rows M` before the DRAW line, and fewer than 2 of either blocks with
  "restore them (~/bin/restore-reads.sh)" (Claude r1 P1: a wiped /tmp read would otherwise read as scarcity forever);
- an R12 wait older than 3 h **pages** (W5), replacing the loop's draw-stall page, which can no longer fire.

### 2.2 The rule — `patches/lookahead.py` (pure), `canary-sched.py.patch`, `drawrec.sh.patch`

- L0 the slot is free by every S-check; no R11 death-hold; no SCHED-PAUSE / INSTALL-HOLD; no NEXT-SLOT reservation.
- L1 the head's ONLY obstacles are R10 WAIT or R12 WAIT. A head with a hold, not_before, unmet `after`, missing variant,
  refusal / blocked attempt, H3-H6, or an R12 BLOCK is never looked past.
- L2 draw-blocked continuously >= 30 min: `drawwait` on entering, `drawclear` on leaving.
- L3 never twice in a row: a lookahead launch's `launching` row records `lookahead_past: <head>`; while that is the
  most recent launch the head is not skipped again — it goes first at the next opening. Starvation is bounded by ONE
  run's duration.
- L4 the candidate is the entry IMMEDIATELY behind the head (depth 1: a stricter reading of "the next ready entry",
  flagged; done/cancelled entries are not positions). It must be `ready`, unheld, not_before passed, every `after`
  closed, a variant keyed by the full fleet base, and pass the head's full checks (variant_checks, head_blockers, R10,
  R12 with the head's pools RESERVED). Any hard blocker stops the lookahead.
- A failed candidate try is cached for 20 min (Claude r1 P2: the tick lock that holdtoken and the human verbs wait on).
- After the minutes of checks, `revalidate()` decides everything again on a FRESH gather (Codex r1 P1): the slot
  (S1-S8, R11), the head and base unchanged, **the head's own variant, variant_checks, head_blockers and state** (round
  3, Codex r2 P1: a head held or stripped of its variant during the probe is never looked past), `lookahead.decide` on
  fresh entries naming the same candidate, and the candidate's variant (same registration bytes), variant_checks and
  head_blockers. Tests change the candidate's hold, the HEAD's hold, the head's variant, NEXT-SLOT, SCHED-PAUSE, the
  episode and the candidate's registration DURING the probe and see no launch (positive control: a harmless hook still
  launches).
- Reserve = the head's drawexposure pools + its own probe's eligible pools; the loop is launched with `DRAW_RESERVE`
  (an ordinary launch strips any inherited one); its drawrec excludes them from that draw only (they stay in control).
- Interactions: still one canary at a time, so one-canary-pool, the tripper (two builds), bag-fix and underground rules
  are untouched; INSTALL-HOLD (today's isolated phase 2 included) makes the slot busy (S8), so nothing launches;
  holdtoken's claim waits on the same tick lock; R11 blocks everything.
- `after` and variant keys when the base moves under the skipped head: a lookahead run that KEEPs and is promoted moves
  the base, and the head's old-base variant no longer matches — it blocks on H2 until a variant on the new base exists
  (pre-building would have to build the head on every possible lookahead sha). An entry naming the head in `after` is
  never a candidate. A REVERT / INCONCLUSIVE lookahead leaves the base unchanged.

### 2.3 Replay (`replay_lookahead.py`, `out/lookahead*.out`)

Queue state at each instant from the host's backups (`canary-queue.json.bak-<op>-<stamp>`, one per edit: the queue at T
= the earliest backup after T). Every 10 min through each episode (round 2, Codex r1 P2) of the six where the head was
draw-blocked >= 30 min with the slot free: gridfix-01 6.0 h (34 checks), townsearch-01 5.7 h (31), toolkit-02 1.2 h (4),
townindex-01 2.0 h (9), indexsearch-01 0.9 h R10 (3) + 2.4 h draw (12). The slot is taken as free (that defines an
episode); no R11 / NEXT-SLOT in these windows (sched.log); no launch occurred, so no skip history to carry.

**Under the rule: 0 launches in 93 checks.** In all six, the entry behind the head had `after: [head]` (bamboo-01,
plinth-02, wellcare-01, indexsearch-01, chatgate-01); in 3 of 6 it also had no variant on the base.

**Sensitivity (`--after-ordering`, not the rule):** reading `after` as satisfied when the entry already has a base
variant: 2 launches — plinth-02 at 10-16 23:48Z (it was rolled out owner-direct the next day, never a canary) and
chatgate-01 at 10-23 09:20Z on board-b, board-c, hive-a (reserve placebo-a). The later indexsearch-01 draw episode is
not this world (the slot would have been busy; round 3, Claude r2 P3). Neither run has ever run, so durations and
verdicts are unknown; any lane-time figure would be HYPOTHETICAL. Had chatgate-01 run 09:20Z-~15:30Z, indexsearch-01 would have started after placebo-a's
contamination aged out of its +360 lookback (F3) — and after a re-variant if chatgate-01 KEPT.

## 3. Tests (all pass; every mutant killed; positive controls in each)

| suite | result |
|---|---|
| `patches/test_settlerule.py --mutants` | 35/35; 10/10 anchored unique mutants killed; the anchor assertion seen to FIRE on an absent anchor |
| `patches/test_lookahead.py --mutants` | 28/28; 17/17; same positive control |
| `patches/test_drawsteady_settle.py <patched drawsteady> settlerule tierrule bagread --mutants` | 10/10 end to end on fixture files (no settle block = today's answer; release across a fleet promotion; S2/S3/S4 holds; isolation; the union keeps today's release when the settle path fails or HANGS inside a scanner past its deadline; a 1440 lookback gives no candidate); 7/7 mutants |
| `patches/test_drawrec_queuespeed.py <patched drawrec.sh> drawrequire.py --mutants` | 8/8 on the REAL drawrec Python block (as test_drawrequire does): reserve excluded, malformed reserve refuses, DRAW_REGDIR read and passed on, DRAW_PROBE does not page (and an ordinary draw does: positive control), instruments line before DRAW; 6/6 mutants |
| scripts/host/test_canary_sched.py patched (`test_canary_sched.py.patch`) | 126/126 (93 existing + 33 new); 89 anchored mutants (62 existing + 27 new): the full run on this code was in progress at commit time; its result is in the next commit (`out/sched-mutants.out`, the full run on the final code). Round 3's run found 2 survivors that the second line (`revalidate()`) covered; both tests were tightened to see the FIRST line (no probe of a refused candidate) |
| scripts/test_threepool.py patched (one mutant re-anchored on qualify's `one_build`) | 163/163, as at v36 |
| scripts/test_tiers.py on the patched drawsteady | 127/127 (7 host-only mutants skipped, as before) |
| host positive control (patched drawsteady, read-only, 10-22 07:00Z) | today's lines unchanged; settle RELEASE = the replay's; 36 s |

## 4. If the owner approves anything — install steps for the operator

Nothing here touches a gate bundle file: the digest must read **635ad8d866a6e4a772351961bd5bd997 before and after**.
For R12 alone (Q-2), install canary-sched.py + drawrec.sh and leave `lookahead.py` absent (the lookahead is then off by
construction: `LOOKAHEAD off: lookahead.py not loadable`, tested).

1. Empty slot: no canary declared, `check-open-loop.py` clear, no loop/drawrec, no INSTALL-HOLD (today's isolated
   phase-2 hold must have been released first). `TOKEN=qs1023-$$-$(date +%s%N); python3 ~/holdtoken.py claim "$TOKEN" 90`
   (rc 0, else stop); `exec 9>/tmp/mcai-canary.lock; flock -n 9 || exit 1` for the whole install.
2. `python3 ~/verdict.py --gate-digest | head -1` -> 635ad8d8...; record it.
3. Stage in `~/qs1023/stage/` by applying the patches to the LIVE files: canary-sched.py (0d9a87f3 = repo),
   drawrec.sh (the live d0d4d51c; the repo's scripts/host/drawrec.sh is the older 986e18d2), drawsteady.py (7f34cbad),
   plus settlerule.py / lookahead.py if those parts are approved. `patch --dry-run` first; any reject = stop.
4. Run there: the four new suites with `--mutants`, test_canary_sched.py --mutants, test_threepool.py, test_tiers.py,
   test_holdtoken.py (it loads canary-sched.py), test_drawrequire.py and test_bagfix_loop.py (drawrec changed).
5. Positive controls on live inputs: staged drawrec with DRAW_* unset prints the installed one's eligible/DRAW lines
   (plus the one new `instruments:` line, above DRAW, so the loop's `tail -4` is unchanged); staged drawsteady with no
   settle block prints the installed one's output byte for byte; staged `canary-sched.py status` — the only difference
   is the R12 line. Note `tick --no-act` now runs probes (read-only, private temp dir).
6. Back up (`*.bak-qs1023-<stamp>`), install by tmp+rename, re-read the digest (unchanged), append to
   ~/digest/gate-installs.log and a draw-rules paragraph to ~/digest/RULES-IN-FORCE.md.
7. `flock -u 9`; `python3 ~/holdtoken.py release "$TOKEN"`. Rollback: restore the backups.

## 5. Reviews

**Round 1** (independent Claude + Codex `--sandbox read-only`): both REQUEST CHANGES on both designs; both agreed "do
not install" was right. Findings and their answers:
- Codex P1 R1 not exact (5-min buckets) -> R1 now runs on the host with the gate's own loader; the ironpick/poolescape
  flips disappeared (1.2 F4, 1.4). Codex P1 "I8 meets the bar overstates" + Claude P1 no cascade -> the cascade; I8
  now flips protectzone-01; no version claimed to meet the bar. Codex P2 composition-only changes / invalid worst case
  -> changes are now any change of the counterfactual set; the set is capped and flagged ambiguous. Claude P2
  keepout-01's set from a missed reconstruction -> the actual pools are carried when still drawable; "changed" is a
  lower bound. Both P2 attrib crash -> fixed, re-run, F2 corrected (95 of 141 inside their timer). Both P2 settle
  wiring untested + Claude P2 timeout can cost today's release -> test_drawsteady_settle.py, a 240-s budget, floors
  > 720 refused, no false steady-refusal page. Claude P2 lookback_min typed by hand -> residual (v). Claude P3s
  (6 of 6 controls, tie claim, positive control of the anchor test) -> fixed.
- Codex P1 R12 converts refusals into waits -> scarcity vs refusal; Claude P1 a wiped /tmp read waits forever with no
  page -> the instruments line + W5 page. Codex P1 the re-gather does not revalidate -> `revalidate()` + 5 change-
  during-probe tests. Codex/Claude P2 probe not read-only -> DRAW_PROBE + DRAW_TXT. Claude P2 tick lock -> the 20-min
  candidate cache. Both P2 reserve handoff untested -> loop-env tests both ways + a real-drawrec reserve test. Codex P2
  replay sampled -> every 10 min. Doc fixes (5.2 + 1.2 h, 3 of 6 variants, the 09:20Z reserve) -> done.

**Round 2** (commit aa2c3a46): Codex REQUEST CHANGES / REQUEST CHANGES; Claude REQUEST CHANGES / **APPROVE**. Both
agreed the recommendations stand. Findings and answers (round 3):
- Codex P1 `revalidate()` did not re-check the head -> it now re-runs the head's variant_checks, head_blockers and
  state; two tests (head held, head variant removed during the probe) + a mutant.
- Codex P2 / Claude P2 the I4/I7 flips rested on real logs of a world the cascade had changed, after an unmodelled
  run -> R1 is CASCADE-BLIND (reasoned) where a changed run was live in the lookback; later draws are CONDITIONAL. Both
  round-2 flips (townindex-01, poolescape-01) are now reasoned.
- Claude P2 keepout-01's counterfactual took the reconstruction's pools (dropping hive-b) and freed pools were never
  added -> "earlier" only against a reconstruction that drew; freed pools are added. protectzone-01's flip now holds in
  this consistent model, and appears in 7 iterations.
- Codex P2 the 240-s budget could not interrupt a scan -> SIGALRM hard deadline + a hanging-scan test + mutant.
- Codex P2 / Claude P2 the scheduler mutant run aborted on a stale anchor -> retired; the run completes (section 3).
- Codex P2 / Claude P3 F4 "ties alone" -> "first refused on a tie". Claude P3 6 vs 7 controls -> 11 of 11 now (the
  changed set grew). Claude P3 chatgate-01 counted twice -> 2 launches. Claude P3 manual exclusions read as scarcity ->
  documented in 2.1.

**Round 3** (commit ea721e9a): Codex **APPROVE** / REQUEST CHANGES; Claude **APPROVE** / **APPROVE**. Answers (round 4):
- Codex P2 a valid REPLACEMENT head variant during the probe passed revalidation on stale draw evidence -> revalidate
  defers when the head's registration sha256 differs from the one probed; drawwait rows carry the head's registration
  and a replaced one starts its own 30 min (`lookahead.draw_blocked_since(..., reg=)`); 2 scheduler tests + 3 mutants,
  1 pure test + 1 mutant.
- Claude P2 the SIGALRM deadline raised an Exception the scanners swallow (load_buckets catches Exception, bot_rows
  OSError) -> it raises `SettleDeadline(BaseException)`, caught by name in the settle wrapper; the test now hangs INSIDE
  a scanner that swallows Exception per line; a mutant makes it an Exception and is killed.
- Codex P3 / Claude P3 counts (six, not seven; I6 15 / I9 10), the "losing both pools" cell, "mechanical" qualified,
  and the mutant evidence -> fixed; `out/sched-mutants.out` is the full run on the final code.

**Round 4:** both engines were asked to confirm; their verdicts are in the final report.

## 6. Questions for the owner

1. **Design 1: install?** *Recommendation: no.* Zero flips cannot be shown for any version that changes a draw: six
   flip protectzone-01's recorded +180 KEEP (a predecessor takes one of its four pools), and the two that find no flip
   (I2, I5) strand keepout-01 in a wait the replay cannot follow and leave six verdicts reasoned only. The lever it was
   meant to pull — more 4-pool tier-2 draws — is held mainly by the timers themselves (F2), by genuinely dirty PRE
   windows, and by the v36 baseline's tie rule (F4). If wanted later: fix F4 first (a gate change with its own design),
   then re-run `run_all.sh` with a new table.
2. **Design 2: is `after` a dependency or an order?** The lookahead buys nothing while every entry names the one before
   it. *Recommendation:* do not install the lookahead now. R12 on its own (the scheduler waits for a drawable head
   instead of parking a loop that holds the lock, and pages a 3-h wait) is worth a review round of its own; the
   lookahead could follow once `after` is kept for real code dependencies.
3. **Tier-2 draws of fewer than four pools.** indexsearch-01 (2 pools) could not KEEP at +180 by rule nor at +360
   (dirty baseline). *Recommendation:* a tier-2 run should wait for 4 pools, or register tier 3 — prospectively.
4. **The rest of the idle** (R11 6.1 h, install holds 5.7 h, other installs 2.2 h, JIT variants 1.4 h) is outside both
   designs.
