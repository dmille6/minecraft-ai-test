# STATE — the operator's state file (regenerated at every verdict; a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-19 20:45 UTC — **LIVE CANARY digwatch-02. A two-engine review refuted most of today's endpoint study; read the RETRACTIONS section before acting on any of it.**_

## RETRACTIONS, 19 Sep evening — read this before using today's noise numbers
`docs/reports/endpoint-noise-floor-2026-09-19.md` measured the canary read's own
noise floor on placebo windows. **Codex refuted four of its five conclusions and
one of its positive controls. The report carries the review verdict inline; the
scripts are in `scripts/analysis/` with the defect banded in the source.**

- **The planted-effect positive control was an ARITHMETIC IDENTITY.** Multiplying
  the canary post window by `f` and reporting the log difference returns
  `log(f)` whatever the data says — measured spread 7e-16 across
  f in {1.05, 1.30, 1.77, 3.50, 0.40}, 162 fits. Every "planted +30% -> +30.0%
  ok" printed by `sweep/endpoints/candidates/halfdid/halfmix` is arithmetic, not
  evidence. Replacement: `scripts/analysis/realcontrol2.py`, which drops a
  canary bot's REAL per-bot items and bot-hours, must SCATTER (sd 0.303, median
  +0.050), and carries a mutant caught at exactly log(4/5). **Its own v1
  reproduced the same tautology** by scaling the dropped bot's items by the
  surviving pool fraction. Twice in one session a control was built out of the
  quantity it was meant to test.
- **CONCURRENT CANARIES ARE NOT CANCELLED.** I claimed concurrency shrinks each
  canary; it shrinks the CONTROL set. 1/2+1/8 vs 1/2+1/10 — about **2% worse SD
  for twice the experiments**. That was one bad inference stated twice. The
  workstream below stands on its merits; kill it for engineering cost or
  demonstrated interference, not on that argument.
- **The inference half is NOT cleared as a confounder.** `bots/src/llm.mjs:430`
  `EndpointPool.available()` preserves preference order, so the primary really
  does serve. "Both URLs are listed" means fallback capability only. The
  both-3090 bucket (n=312) comes from 3 pool pairs over overlapping windows —
  nothing like 312 independent units.
- **"Time is not a design lever" is UNVERIFIED** — the duration sweep confounds
  window length with which windows survive the contamination filter.
- **`decisions/bot-hour` is NOT cooldown-pinned** (`cognitive.mjs:846` schedules
  the cooldown at cycle END, so the ceiling is 120/h not 40-50) — my stated
  objection was wrong on the code. The real defect: **its direction is
  ambiguous**, since longer productive skills lower it and fast failures raise
  it, and `cognitive.mjs:561` counts synthesised work orders and rejected LLM
  results as decisions. Useful as an operational guard after separate
  validation; **not** a success criterion.
- **leaf-01 is the counterexample to gating on mechanism and harm alone**:
  mechanism improved, deaths held, acquired wood collapsed.

**What survives:** `items/bot-hour` is very dispersed at canary scale — null sd
0.70 at one pool, 0.51 at two, 0.41 at four — measured directly and independent
of the dead control. Also surviving: dropping ONE bot from a five-bot pool moves
the estimate with sd 0.30, so within-pool bot heterogeneity is a large share of
the noise. **Nothing else in that report should be acted on as written.**

## DRAW RULE CHANGED, 19 Sep 19:51Z — the inference half is no longer held constant
`~/mcai-analysis/drawrec.sh:72` no longer requires `h == '5080'`; the half is
printed per drawn pool and recorded as a read covariate. Backed up to
`drawrec.sh.bak-20260919T195135Z`. **The band STAYS** — it buys little on spread
(0.81 inside vs 0.84 outside) but removes a -10% median bias (regression to the
mean).

Today's decomposition, which is counting and not inference: 12 pools -> 9 on the
5080 half -> 8 after the placebo-c ban -> **2 after the 12 h exclusions** -> **0
after the band**. Dropping the half term alone made it 2 (board-d, placebo-d)
and unblocked the draw. Caveat per the review above: the justification for
dropping it is weaker than I first wrote — treat the half as an unadjusted
covariate, not as a cleared variable.

## Concurrent canaries — step 1 done, and NOT cancelled
`canary_split_ok` / `in_canary_pool` consolidated from `infra/guard/death-tripper.py`
into `scripts/lib/version_split.py` (20 new tests, 12 existing green, 5 mutants
dead). **It does NOT ride along with a deploy** — `deploy-fleet.sh:126` installs
the tripper from `$REPO/infra/guard/death-tripper.py` at the deployed sha, and
the consolidation is on `recovery-ladder-03`. Verified by grep, not assumed.
Remaining per `docs/reports/concurrent-canaries-design.md` §5: N-canary
classifier (pools pairwise disjoint, versions pairwise distinct, N<=3), per-run
canary trees, per-run loop locks with a manifest mutex, readers.

## leaf-01 — REVERT 15:48:55Z, torn down 15:52:31Z, one version verified 15:51Z
**Reverted on its registered primary endpoint and nothing else: `logs_did = -0.650` against a `-0.5` gate.**
- **Zero canary deaths against control 0.033/bh — it was SAFER than the fleet.** It reverted on wood, not on harm.
- **The mechanism line finished at -1.69: buried refusals fell all the way to the end.** Scored on "refusals avoided" — which is how queue item 3 and both review engines framed the problem — **this would have been promoted fleet-wide as a success while making the fleet gather less.** The endpoint was moved to acquired wood only because Codex pass 1 objected that a log can be broken and never collected; that single objection is the difference between a revert and a bad promotion.
- **What it established, which is not nothing:** `unreachable` halved (29.0% -> 13.1%) with control flat, so a trunk in its own canopy IS reachable and the diagnosis was right. What is ruled out is admitting it as a PEER of an open target — the freed attempts became `no_safe_target` (+15 pp) and `no_path` (+6.4 pp), never successes, and throughput fell because a leaf-covered log fails LATE where the old refusal was free. Full read: `docs/reports/leaf-01-mechanism-2026-09-19.md`.
- **Next version is designed and is Codex pass 2's unfixed proposal: admit leaf-covered logs only as FALLBACK, including in the probe.** Do not rebuild it as a peer-ranked filter; that experiment has run.

## digwatch-01 (1457f3a) — CLOSED INCONCLUSIVE. v1 was BLIND.
2,695 canary rows, 4 gather runs ending `Digging aborted`, **zero collision
rows**. Wrapping `bot.dig` sees only the cancellation `dig()` performs on its own
first line for a NEW request; the fleet's aborts come from direct
`bot.stopDigging()` calls in our own handlers. The two-concurrent-diggers reading
was withdrawn on that basis — **and digwatch-02 has now shown it was real after
all, as one mechanism of three.** Guessing from a blind instrument's silence was
wrong in both directions.

## LIVE CANARY — digwatch-02 (cfc1c58), deployed 20:09:38Z on board-d,placebo-d
Dig abort recorder v2: **listens** for `diggingAborted`, which `stopDigging`
emits synchronously, so the listener's own stack names the caller. Wraps nothing.
Suite 189/189, 10 cases, 7 mutants. Registration
`~/mcai-analysis/registrations/digwatch-02.json`. Reads +30/+90/+180/+360,
deadline +420.

- **FIRST CANARY EVER DRAWN FROM THE 3090 HALF.** Both pools are `-d`. Split
  verified: exactly two versions, 70 baseline / 10 canary, on precisely the two
  drawn pools. Exposure at deploy **0.93 dig-aborts/bot-hour** on the drawn pools
  against 187 fleet-wide in 3 h — measured, not assumed.
- **PROSPECTIVE AMENDMENT before deploy:** the registered guard "items/bot-h must
  not move" was replaced by **decisions/bot-hour, read as DiD**. items/bot-hour
  has null sd ~0.50 on this configuration and cannot fire; it is reported
  descriptively only. (Note the review above: decisions/bot-hour is a breakage
  guard of ambiguous direction, not a success criterion. It is used here only to
  detect the recorder breaking something.)
- **NOT BLIND — the check that killed v1 passes.** At +30 min: 3 canary aborts,
  **3 collision rows (100% capture)**, 0 rows on control. Guard DiD 1.031, well
  inside 0.78-1.22.
- **THE PAYOFF: three rows, THREE DISTINCT CALLERS.** All verified against the
  deployed sha, not the working tree (the line numbers differ by branch and
  reading the wrong tree first produced nonsense):
  1. `skills.mjs:169` — `watchDigging`, `!b.canHarvest(bot.heldItem?.type)` ->
     `stopDigging`. Cancelled **coal_ore** on a bot **holding dirt with a
     stone_pickaxe AND wooden_pickaxe in inventory**, 1 s earlier. The approach
     walk already disables this watchdog (`skills.mjs:1096-1108`); this is the
     TARGET block, which `gather` legitimately guards. **The remedy was in the
     bot's pocket and the code aborted instead of equipping** — the CLAUDE.md
     refusal-without-a-remedy class.
  2. `reflex.mjs:4601 -> digBounded:4877 -> digging.js:127` — the escape reflex
     starts a second `bot.dig()` while one is in flight and mineflayer cancels
     the in-flight one. **This is the concurrent-digger collision, now named.**
     Cancelled `dirt@369,52,170`.
  3. `skills.mjs:1197 <- :233` — the gather dig's own **20 s `withTimeout`**
     expiring. Cancelled `iron_ore@362,47,164`. Connects to
     `dig-budget-prices-a-fiction`: `predictedDigMs` hardcodes
     `notOnGround=false` and a real dig off the ground runs ~5x slower.
- **n=3. Do not build on it yet.** `~/mcai-analysis/collisions.py` accumulates
  every row with the held item and whether a harvesting tool was in inventory.
- Watch: canary items/bot-h 36.0 -> 21.7 while control went 50.2 -> 56.4. That is
  a -46% DiD, but the MDE on this endpoint and configuration is ~304%, so it is
  **inside the noise and is not a signal**. Flagged for the +180 read, not acted
  on.

## Fleet
- 80 bots / 16 Peaceful worlds. **b1659c0 fleet-wide, ONE version live on all 80 (`b1659c0+ab74e7`), no code canary.** Verified 11:30Z. main = b1659c0. Previous mains: main-pre-2026-09-17 (1d6c97d), main-pre-2026-09-16b (08a3da2), main-pre-2026-09-16 (426058d).
- 11:30Z digest: one version, 80 bots, 3 deaths in 2 h (0.019/bot-h), 3 immobile, 5 zero-item bots in 2 h.
- **keepInventory=true and doImmediateRespawn=true on every world** (deliberate, place-town.py): deaths cost time, not items. Owner decision 18 Sep 02:10Z: it stays ON through the seed canary's 72 h, then is turned OFF fleet-wide as its own registered program change (a world rule, never a canary) — and queue item 7 moves it to after 27 Sep.

## No live code canary — the slot is FREE and the ledger is closed
`check-open-loop.py` clear at 11:30Z, `canary_pool` null, no `canary-loop` process, journal ends at owner-01b's teardown 18 Sep 16:42:21Z. Nothing was open when this session started and nothing is open now.
- Last decisions: **owner-01b REVERT** 18 Sep 16:38:45Z (torn down 16:42:21Z; the mechanism did not support it and v10 already forbade it — every rung in the fatal episode was `refused` or `preempted blocks=0`; the honest verdict was INCONCLUSIVE, but gates are honoured and amendments are prospective). **owner-01 INCONCLUSIVE / SHIPPED INERT** 18 Sep 12:59Z. **falls-01 REVERT** 18 Sep 04:39Z.

## SEED CANARY — BOTH POOLS LIVE, and the read is registered
- **placebo-a: live 19 Sep 00:00:44Z**, `level-seed=8948499624371160708`, town 249,-144 (y=74). Verified at +11 h before pool two started: 5/5 alive, 24,165 rows, all five ranging x[72,478] z[-279,29], **1 death in 55 bot-h (0.018/bot-h) vs fleet 19 in 880 (0.022)**. Positive control for that walk: 343,216 rows / 80 bots / 110 kinds.
- **placebo-b: live 19 Sep 11:25:23Z**, `level-seed=7843072457371465157`, town 282,65,-388, 5/5 confirmed in-world by RCON.
- **Both pools re-checked at 12:05Z**: 5/5 bots each, all five in each pool moved >6 blocks in the last 40 min, 0 deaths. Positive control for that walk: 20,911 rows / 80 bots / 102 kinds.
- **Windows: pool one closes 22 Sep 00:00Z, pool two 22 Sep 11:25Z.** Both clear of the 24-27 Sep program read. Draw exclusions stamped in `~/mcai-analysis/draw-exclude.txt` on .31.
- **Reads due at 24/48/72 h from each pool's own start**, DiD by pool set (the two re-seeded vs the fourteen), split at every `declared_code_version` change, never pooled across an epoch. The 24-h read includes a reseed-PLUS-RESET "fresh start" effect (registered confound); the 48- and 72-h reads are the ones that speak to terrain. KEEP/REVERT do not apply — there is no code change. Output is a table plus a captured fixture for every death class first seen on the new seeds.
- **AMENDMENT 19 Sep (prospective, in `seed-canary-registration.md`): the sample is seeds on which the town SITES.** placebo-b's first seed (`2308430494737375791`) had no placeable town — every candidate rejected for relief or water — so the population is "random seeds where a colony can be founded", i.e. flat, dry, low relief. That filter silently removes the terrain the experiment most wants, and **1 of the 2 seeds drawn today hit it**. A null at 72 h is therefore weaker than it looks. Siting criteria deliberately NOT relaxed. Rejected seeds are now journaled (`seed-rejected` lines).

## Done today (19 Sep)
- **Both seed-canary pools deployed** (above). Pool two needed a second seed; `scripts/reseed-pool.sh` gained a guarded `--new-seed` (four refusals each SEEN to fire; the fifth verified at its predicate, because end-to-end means aiming a destructive path at a live pool). The run's timestamp is deliberately never redrawn — every archive is named for it.
- **`programread.py`'s stock line is now the program's metric** (queue item 9, due before 24 Sep). It reported a deposit success RATE against an **items/bot-h** gate. Now the negative side of `inventory_delta`: **10,421 items net into chests / 1,920 bot-h = 5.43/bot-h against a ≥20 two-week gate**, with the composition beside it (cobblestone 6,077, oak_log 1,297, dirt 837 — 58% cobblestone). Two things a success-only count gets wrong and this does not: **1,153 units (10.8%) moved on rows that ended `failed`/`no_effect`**, and the row's own prose disagreed with the delta on **222 of 397 successes**. The old percentage survives on its own line, relabelled an OUTCOME RATE. **Not claimed:** that stock has fallen — the 12-14 Sep "14.7/bot-h" was derived differently and has not been re-derived.
- **Throughput has a standing read** (queue item 10): `51 decisions in 14 d = 3.64/day, 35 results = 2.50/day, 16 INCONCLUSIVE`, with the 7-day beside it (`27 = 3.86/day, 20 results`) because a fortnight mean hides a slowdown. **"Two canaries, zero results" is about yesterday, not the fortnight.** What it does expose: **14 REVERTs vs 6 KEEPs in 7 days**, several of them the harness's own instrument. Both refusal branches exercised.
- **The tier-1 analyst's false stall is fixed, at both doors** (see below).
- **v23's REPLAY ACCEPTANCE SUITE is built** (queue item 2), and it found a live bug. **16 cases, 11 mutants, all killed**, driving the REAL `verdict.py` through four environment overrides production never sets — it also passes against `~/verdict.py` on .31, which is the copy that decides.
  - **v24 REGISTERED (prospective): an own-line value that is `None`, NaN or ±inf is UNREADABLE, not a failure.** A NaN fails every comparison, so an `on_fail: REVERT` endpoint **reverted on an arithmetic hole**. That is owner-01b's `+nan%`, written up yesterday as a *draw* problem (queue item 8) with the verdict-path half missed. Not an amendment needing calibration: the registered rule already said a missing own-line value is UNREADABLE, and a NaN is missing-ness arriving as a float. Prospective regardless — no canary was live.
  - **`scripts/singledeath.py` was never committed**, so the repo's `verdict.py` has carried an unsatisfiable import since v23 landed, with `test_singledeath.py` beside it testing a module that was not there. "The two copies are reconciled" was true of the text and false of the thing you can run. Committed; `sys.path` now also takes the file's own directory.
  - **Two Codex passes, then stopped.** Most of what they found was a case green for the wrong reason: `one canary death` had no logs at all (the linkage rules rescan the pools' own logs, not the evidence objects), so it never reached v23; the v19 rung-linkage branch was entirely unexercised while the suite claimed "no single death reverts by ANY path"; the registration-sha mutant survived behind the manifest-binding check one line above it; the 21x regression case passes a threshold raised to 5. A kill now requires the WHOLE baseline to pass, the case to MOVE, and to land on the predicted verdict; the artifact is parsed, not counted.
  - **PINNED, NOT FIXED:** with no control rate the gate assumes `control_bot_h = canary_bot_h * 7` and reverts on 3 deaths against an assumed 0. A guess where a measurement should be. Changing a gate is an amendment — queued; the case pins the outcome so it cannot change silently.
- **The analyst's rule window had shrunk to three versions.** Syncing v23 to `~/digest/RULE.md` (last synced 18 Sep 11:27Z, so it predated the rule that is live) exposed that `analyst.py` slices `rule[-20000:]` off a 93 KB document: the tail reached back only to v21, and v12-v20 were simply not in the prompt. Widening it is not the fix — it was cut to 20 KB on 16 Sep because the full document overflowed the context. **`~/digest/RULES-IN-FORCE.md` is now authoritative** (one paragraph, synced beside RULE.md, naming every rule in force and which are WITHDRAWN — v22 is in the document and is not in force). When it is absent the analyst is told so rather than judging against a rule set it cannot see. Both branches exercised with the tail asserted present in each.
- Vendored `nightwatch.sh`, `analyst.py`, `programread.py` into `scripts/host/` — they page the owner and lived nowhere but `/home/mike` with dated `.bak` copies.

## Verified live at 12:03Z after every instrument change today
The analyst's 12:00Z cycle: `page_claude: False`, `declared: False`, `versions_ok: True`, `fleet_healthy: True`, prompt 6,803 tokens (well inside `num_ctx` 24576), its one anomaly a genuine fleet observation. The 11:30Z digest header reads **NO LIVE CANARY**. `verdict.py` on .31 passes all 16 acceptance cases. The fleet is on one version with the ledger clear.

## Instrument fixed today — the analyst paged SIX times overnight at a free slot
Of twelve tier-1 verdicts 05:30-11:00Z, **six carried `page_claude: true`**, every one about owner-01b, torn down the previous afternoon. Cause: **the three-step teardown clears `canary_pool` and `canary_code_version` but not `run_id` or `declared_at`.** Two doors, both shut:
1. **`nightwatch.sh`'s header** printed `run_id=...` and an elapsed clock unconditionally, so it named a dead run with a `+1315 min` that reads as a live deadline, three lines above its own "no open canary". Now LIVE vs history, and the closed case says no deadline is running and no read is due. Both branches exercised; the live branch reproduces the old line exactly.
2. **`analyst.py`'s read glob.** The 18 Sep fix scoped "latest canary reads" to the manifest's `run_id`; a closed canary keeps its `run_id`, so the same defect returned through the other door and served **owner-01b's nine reads** as current. **`run_id` does not mean a canary is live; `canary_pool` does.** Six branches exercised, positive control first (a live canary with reads really does find them); unreadable manifest fails closed; **behavioural mutant** against the pre-fix copy served 2 reads from the closed run.
**Verified live on the real path, not only in the harness: the 11:30Z digest header reads "NO LIVE CANARY" and the 11:33Z verdict came back `page_claude: False`, `declared: False`**, with its one anomaly a genuine fleet observation (3 immobile, 5 zero-item bots).
Backups on .31: `~/nightwatch.sh.bak-20260919`, `~/analyst.py.bak-20260919`, `~/programread.py.bak-20260919`.

## Known false alarm — the analyst pages OpenLoop for the whole life of every canary
`check-open-loop.py` reports OpenLoop whenever the manifest declares a canary with no decision recorded, which is the NORMAL state of a live canary from deploy until verdict. **It is not an alarm while the loop is alive and the deadline has not passed.** The discriminating test is `pgrep -f canary-loop` plus the deadline: OpenLoop with **no loop running**, or past `deadline_min`, is the real thing. Still queued: give the analyst that two-part test. (Today's six pages were a *different* bug, fixed above.)

## Queue — the 18 Sep two-engine review's order, with today's items struck
1. ~~Seed canary~~ **DONE 19 Sep, both pools.** Reads due 24/48/72 h per pool; next is placebo-a's +24 h at **20 Sep 00:00Z**.
2. ~~Implement v23's replay acceptance suite~~ **DONE 19 Sep, 16 cases / 11 mutants.** What remains of this item: **make uncalibrated linkage WATCH-only** (v19 already demoted the rung-linkage override; confirm no other uncalibrated path can revert), and **calibrate or amend the invented 7x control denominator** (pinned today, see above). ~~Original text:~~ v23 itself is LIVE in the verdict path and the two `verdict.py` copies are reconciled (`a67a387`, verified today: both import `singledeath.licence_reverts` and `deathgate.death_gate`). **What is NOT built is the suite.** ChatGPT's bounded version: one engineer-day, then stop adding harness scope. Build it from incidents already on record, each of which must come out right: inert deployment → invalid experiment, close early; wrong-run or stale evidence → unreadable; undefined primary endpoint → unreadable, **not** an efficacy failure; background drowning + irrelevant rung → report, never an automatic linkage revert; a changed refusal blocking an executable rescue → retain a harm signal; an injected known regression → REVERT. Make uncalibrated linkage WATCH-only until it passes. **Costs zero fleet time.** Today's throughput line is the argument for it: 14 REVERTs to 6 KEEPs in a week.
3. **NAVIGATION / GATHER — the only committed metric that is failing, and still untouched.** **19.0% today against a ≥40% two-week gate** (6,298 of 33,104 terminal). Navigation-class failures run ~7.6/bot-h, so a 10-bot 6-h canary sees **~455 events** against drowning's ~12 — ~38x the exposure, on the metric that actually fails. Denominator: `unreachable` 10,502 + `no_path` 4,848 are reachability failures; `no_safe_target` (8,175) is a *safety* refusal and is NOT one. Upstream has characterised the territory: `mineflayer-pathfinder` does not dig, place, swim or parkour, and issues #222, #273 and PR #380 are the bulk. **Do not require the movement owner as a prerequisite unless that dependency can be demonstrated.**
4. **owner-01c — the movement owner, third attempt.** Never failed a guard; failed the apparatus twice. Needs v23's suite (item 2) and a draw with **headroom on the primary endpoint** (item 8). **ARBITER is authorised** — owner's word 18 Sep; no need to re-ask.
5. **DROWNING — demoted, design changed.** Its read-corruption argument evaporates now v23 is live. **Do the one-hour read of the interrupt tax before spending a slot** (memory says the air reflex once aborted 9.8% of every run; nobody has recomputed it). Deaths themselves cost 0.04% of bot-h. **The health floor is "not at full health", NOT "below 5"** (under 5 → 19 yields 100% fatal; 15-19.9 → 27 yields 70.4% fatal; full → 271 yields 0.7%). `floatDigTargets()` returns `[]` without a pathfinder plan, and the drowning rescue has no path, so the remedy is new code. Endpoint: *reached and sustained breathable space within a fixed horizon per eligible episode*; pre-register the MDE. **Do not bundle the floor with the dig.**
6. **falls-02 — the falls instrument FLEET-WIDE.** Behaviour-inert, no canary slot, runs alongside anything. Denominator: 7 fall deaths at 23/31/31/36/40/40/42 blocks of 48, ~0.0036/bot-h.
7. **`keepInventory` OFF — after 27 Sep.** A program change that confounds the deaths line; it waits.
8. **Extend `drawexposure.py` — two checks, NOT a new script.** (a) a **non-degenerate pre-period** on the primary metric (owner-01b drew a 0.0% immobile pre-share and printed `+nan% FAIL`); (b) exposure against the MDE-implied n. REPORT-only until calibrated against draws whose outcome is known (-13b, -13c, 1011b).
9. ~~Fix `programread.py`'s stock-returned units~~ **DONE 19 Sep.**
10. ~~Verdicts per canary-day~~ **DONE 19 Sep.**
11. **Pocket-rung block floor** (need+4 with 5 held). **12.** Pooling rule -12 (iron). **13.** Housekeeping: delete `~/mcai-analysis/registrations/exptest.json` on .31.
16. **NEW — the death gate's invented control denominator.** `control_bot_h = canary_bot_h * 7` when control reports no rate. Calibrate it or amend the gate to report UNREADABLE instead; prospective, pinned by `test_verdict_acceptance.py`.
17. **NEW — keep RULE.md and RULES-IN-FORCE.md synced on every rule change.** RULE.md had drifted two days and a whole rule behind. Both are in `scripts/host/`; the sync is two `scp`s and belongs in step D of the daily task.
14. **NEW — teach the analyst the two-part OpenLoop test** (`pgrep -f canary-loop` plus the deadline), now that no canary is live and editing its rule is safe.
15. **NEW — CLAUDE.md's byte-offset rule is under-scoped.** It names `deploy-fleet.sh`; the hazard is any long-running shell script edited in place. I hit it today on `reseed-pool.sh` (see "An error I made" in the status report). The mechanical fix is to run these from a copy, like the deploy script.

## OWNER DECISIONS — BOTH TAKEN 2026-09-18 23:35 UTC
- **ARBITER STAYS ON for owner-01c.** `OWNER=1` (which implies `ARBITER=1` via `config.mjs:155`) is authorised for the movement-owner canary. The standing "ARBITER stays OFF" line is the **fleet default**, not a bar on the canary built to test it. Do not re-ask.
- **CONCURRENT CANARIES: APPROVED, build it.** The tripper is to accept a **set** of declared canaries instead of exactly one, so 2-3 **disjoint** canaries can run at once. Design in `concurrent-canaries-design.md`; implementation is a build, not yet started.

## Rules in force (docs/reports/recovery-ladder-registration.md)
**v24 (an own-line value that is None, NaN or ±inf is UNREADABLE, not a failure) — LIVE**, **v23 (no single canary death reverts by ANY path; gates carry `role: deciding|tripwire`) — LIVE in the verdict path**, v22 WITHDRAWN unregistered, v12 linkage, v14c, v15c movement guards (calibrated 2% false-revert / 97% detection), v16 (calibrate before revert; trace refusals to fallbacks; histogram slot order; bundles of two disjoint changes), v17/v18, v19 (a change/linkage row must DISCRIMINATE — `changerowcheck.py` pre-deploy, `license_change_rows()` at read time), **v21 (the death gate on the LOWER BOUND of the rate ratio)**, the owner's floor of **two** canary deaths, draws at deploy (12-h ledger exclusions, ±25% then ±40%, per inference half, never placebo-c/isolated), `fleet-deploy` refuses a `--pool` sha not descending from `declared_code_version`, `CANARY_ENV` + the `/proc/<pid>/environ` assertion so a flagged canary cannot ship inert.

## Standing wake-ups
- **Before any canary read, check `~/digest/RULE.md` and `~/digest/RULES-IN-FORCE.md` are current** against `docs/reports/recovery-ladder-registration.md` and STATE's rules-in-force paragraph. RULE.md was two days and one live rule stale on 19 Sep.
- **Run `python3 scripts/test_verdict_acceptance.py` before and after touching the verdict path**, and `test_verdict_acceptance_mutants.py` OFF the bots host (it refuses to score there, because `/home/mike/mcai-analysis` shadows a mutated helper).
- **Nightly 00:12Z: `~/programread.py 24` -> `~/digest/programread.log`.** Now carries the corrected **stock** line and the **throughput** line. Splits by `code.version`; the per-version split is NOT a canary read and says so.
- Nightly 00:07Z: iron-funnel line (`~/digest/ironfunnel.log`). Last: 40 raw iron / 45 ingots / 4 picks crafted, 16 gone (all during work), iron-pick share 14.7%.
- Tier-1 local analyst every 30 min (`~/digest/*.verdict.json`); tier-0 digest `~/digest/latest.md`. `versions_ok=False` is the known build-suffix false-fail (`<sha>+<buildhash>`), not an alarm.
- **Declare the two-week program read window: 72 h continuous, 24-27 Sep**, and keep promotions out of it. The two-week gate is 27 Sep. **Not yet registered — do it before 24 Sep.** Note the two re-seeded pools are a world-level confound inside it; their 72 h closes 22 Sep, so they are clear, but say so in the registration.
- **Seed-canary reads: placebo-a +24h 20 Sep 00:00Z, +48h 21 Sep 00:00Z, +72h 22 Sep 00:00Z; placebo-b +24h 20 Sep 11:25Z, +48h 21 Sep 11:25Z, +72h 22 Sep 11:25Z.**

## Daily session rotation
- Desktop scheduled task `mcai-daily-session` starts a FRESH session at 06:08 America/Chicago (11:08 UTC). It reads this file first, closes any open canary (**check the ledger and the journal BEFORE acting** — the loop may already have), re-arms the list below, does the queue, rewrites this file.
- `check-open-loop.py` lives at **`/opt/minecraft-ai/scripts/check-open-loop.py` on .31** and must run there with sudo. It is NOT in `~/mcai-analysis`.
- Only one session was live on the repo today (18 Sep had two; nothing was lost, but the rotation rule is one per day).

## Standing constraints (verbatim from the owner)
- Full autonomy: deploy, canary, promote, tear down without waiting. Wake the owner on every promote or revert and on anything needing a human hand.
- No world changes to fix a bot (sandbox 10.0.0.30:25599 only; the seed canary is the registered exception — the world IS the treatment). Swimming is travel. No 192.168.19x network; no UniFi API on 10.0.0.1; never disable rpcbind; never touch the apt timer. One code canary at a time (a bundle counts as one) until the concurrent-canary build lands. Teardown is THREE steps. Deploy only via `~/bin/fleet-deploy`. Commit with `git commit -F -` heredocs. Two Codex passes per patch, then a smaller patch. Never share a live canary's inference endpoint/model. Never `git add -A bots` in a worktree with a node_modules symlink. Readers include rotated `.gz` generations. logEvent kinds carry a leading underscore in `skill.name`. Lab SSH `mike@10.0.0.31` (bots) / `mike@10.0.0.30` (worlds); the lab key on the mini is `~/.ssh/id_ed25519`. Status reports live in docs/reports. Use `date -u` for clock labels.
- **And one the repo should adopt:** run any long-running shell script from a copy outside the tree you may edit. CLAUDE.md says this of `deploy-fleet.sh`; bash re-reads by byte offset for all of them.

## Worktrees
mcai-owner (movement-owner-1, aa44514 — reverted twice, rebase for owner-01c), mcai-falls (falls-path-log, fc28885 — reverted, rebase for falls-02), mcai-owner-f (3b9ff25 = falls tip + owner, unused), mcai-deathsites (b1659c0 = main), mcai-rl02 (recovery-ladder-03 = docs/scripts branch), mcai-recovery (iron tools; pooling NOT started), mcai-rllava, mcai-rliron, mcai-rl10, mcai-canopy, mcai-scene (sandbox harness).
Scripts: `~/mcai-analysis` on this Mac (reads, and the reseed journals). On .31 `~/mcai-analysis` holds drawrec.sh, changerowcheck.py, drawexposure.py, deathgate.py, singledeath.py, registrations, and **`lib/` — the golden analysis library restored after every deploy**. The three nightly/host instruments now also live in the repo at `scripts/host/`.

## Re-arm on a fresh session (monitors are session-local)
0. **Nothing to re-arm for a code canary today — there is none.** Items 1-4 apply only once one is deployed.
1. **Loop pages AND journal phases**: Monitor tailing **both** `~/digest/page.jsonl` **and `~/canary-journal.jsonl`** on .31, filtered to `verdict|error|flag|PROMOTED|REVERT|deployed|torn-down|KEEP|INCONCLUSIVE|read-|phase`. **Filter on new lines only** (`tail -n 0 -F`). **`page.jsonl` ALONE IS NOT A HEARTBEAT** — the loop pages decisions and errors only; a routine read writes to the journal and nothing to page.jsonl, so a quiet watch is indistinguishable from a dead loop. The journal is the heartbeat; page.jsonl is the alarm. Treat unexpected silence as a reason to `pgrep -f canary-loop`.
2. **Local analyst**: Monitor running `bash ~/analystwatch.sh` on .31. **DO NOT FILTER IT ON MESSAGE TEXT** — a filter added 18 Sep to drop expected OpenLoop noise suppressed a verdict carrying `page_claude: True` and `fleet_healthy: False`, because that string appears in the *evidence* field of an unrelated anomaly. ~20 lines over a canary's life is cheaper than one suppressed alarm. Take it unfiltered and triage by hand.
3. **Death poll**: the loop runs `verdict.py <run> 0 --poll` every 5 min itself and pages on REVERT, so monitor 1 covers it. A separate poll is only needed if the loop is dead.
4. If the loop is dead (`pgrep -f canary-loop`) with a canary declared: read `~/canary-journal.jsonl`, take the reads by hand (`bash ~/mcai-analysis/arm-read.sh <M> <run> "..."`), record the verdict with `check-open-loop.py --record` under sudo **BEFORE** touching the manifest, then promote or tear down (THREE steps: `sudo /usr/local/sbin/mcai-canary-tree teardown`; clear `canary_pool` and `canary_code_version`; restart the pool's bots 12 s apart; confirm exactly one version is live).
5. **After any deploy, check the analysis library survived** — `python3 -c "import sys; sys.path.insert(0,'/opt/minecraft-ai/scripts'); from lib.telemetry import Events; print(len(Events.load(since_minutes=30).rows))"` on .31. `fleet-deploy` restores it now, but a deploy by any other path will not.
6. **The seed canary needs no monitor** — it is a world change with no tripper involvement. Its reads are calendar items (above), and a missed one is recoverable because the telemetry walk is retrospective.
