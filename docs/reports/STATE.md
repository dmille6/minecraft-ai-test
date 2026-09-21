# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-21 11:00 UTC — **NO LIVE CANARY; 80 bots on cfc1c58, one version, ledger clear.** The night's real finding is NOT the canary: **81% of the fleet cannot mine**, and the root of it is wood gather at 10% success. See `tool-starvation-2026-09-21.md` before picking up anything else._

> **TWO COPIES OF THIS FILE EXIST AND THEY DIVERGED YESTERDAY.** The daily task reads
> `mcai-rl02/docs/reports/STATE.md` first and falls back to the repo copy; on 20 Sep the **repo copy was the
> newer one** (20:45Z vs 16:00Z) and the stale one named the wrong canary. Both are written together today.
> **If the two disagree, take the later `_updated` stamp, not the documented order.**


## OVERNIGHT 21 Sep — what changed while the owner slept

### needsdrop-01 (b72781e) — REVERTED 10:28Z, torn down 10:39Z. ITS PREMISE WAS REFUTED.
**The harvest watchdog is now OPT-IN.** `withTimeout`'s `needsDrop` installed `watchDigging`, a 1 Hz
poller calling `pathfinder.stop()` + `stopDigging()` whenever the HELD item cannot harvest the
**bot-global** `bot.targetDigBlock`. It defaulted to TRUE.

Brace-matched census at cfc1c58: **15 sites armed, 13 of them not digging for a drop** (11 ×
`pathfinder.goto`, one through a variable at :401; 2 × `placeBlock` at :5555/:5685) against 2 that
were (gather's dig :1195, collectBlock :1672, which now opt in explicitly).

**The mechanism**: `placeBlock` equips the block it is about to place, so the hand holds dirt; the
watchdog then asks whether dirt can harvest stone and cancels somebody else's in-flight dig.
Fleet-wide since digwatch-02 went to all 80 bots: **682 of 1,258 dig collisions (54.2%) are this
watchdog, 682/682 with a harvesting pickaxe in the bot's inventory**, held item dirt 67.9%, empty
19.8%, blocks stone 49.9% + cobblestone 34.0%.

- **PRIMARY (registered before deploy): share of gather runs ending `Digging aborted`**, expect −54%,
  KEEP at ≤ −25%, readability floor 200 canary gather runs. At deploy the canary pools ran **12.9%**
  abort share over 1,160 runs/3 h against control 8.4% — exposure measured, not assumed.
- **NO PRODUCTIVITY GATE.** items/bot-h null sd 0.313 at k=20 (MDE ~85%) and the ceiling for a perfect
  fix is ~+2.9%, because 83.9% of the affected blocks are stone and cobblestone. items and gather
  success are REPORTED. **Deaths are the only gate**, two-death floor.
- **Two Codex passes, both "deploy."** Pass 1 verified no dig becomes unbounded (gather keeps 20 s +
  cleanup; the disarmed navigation calls retain 25/10/15/6/12/8/20/20/5/12/40 s) and confirmed
  watchDigging is bot-global. Pass 2's residual: it also cancelled PATHS, so `surface`'s 40 s GoalY
  walk (:5976) loses an incidental early cancel — conditional, and general navigation is
  `canDig=false` (index.mjs:274, "deliberate and load-bearing"), which was verified not assumed.
- **Pass 2 corrected my framing**: I wrote the cost of disarming is "latency, never a hang". Too
  strong — extra delay while submerged or under attack can kill inside a finite budget. That is
  exactly why deaths are the gate.
- **NOT "equip rather than abort"** (the old queue item 4): both engines refused it. The equip already
  exists three lines above the watched dig at :1191-1192 and returns only harvesting tools, so a
  collision there proves the equip failed or was undone; changing the held item mid-dig resets the
  server's break progress while mineflayer's dig resolves on a local timer with no ack; and
  `digcollision.mjs` says "IT MUST NOT RETRY". Dig ownership belongs in the arbiter — i.e. **inside
  owner-01c**, whose `GATED_SYNC` already lists `stopDigging`.
- Suite 190/190 (baseline cfc1c58 is 189/189). **Two existing tests encoded the old contract and were
  updated deliberately** — `body-claim.test.mjs` asserted "the default must stay true", and
  `dig-approach-watchdog.test.mjs`'s CONTROL inherited the watchdog from the default, so flipping it
  would have made that control silently stop reproducing the defect while the FIX test beside it
  compared two identical configs and passed for nothing.
- **Reads scheduled DETACHED on the host** (`~/mcai-analysis/run-needsdrop-reads.sh`, pid confirmed
  with the anchored pgrep): +90 08:54Z, +180 10:24Z, +360 13:24Z, +540 16:24Z, deadline +660 18:24Z.
  Output accumulates in `~/digest/needsdrop-01-reads.txt`.

### ►►► THE HEADLINE: 81% OF THE FLEET CANNOT MINE, and wood is the root
Full account in `tool-starvation-2026-09-21.md`. Found while reading the wreckage of a canary aimed at
the wrong thing.

- **65 of 80 bots carry only dead pickaxes** — every one worn to **1 durability** of 131. **230 dead
  pickaxes fleet-wide**, 3.5 per starved bot, up to 8 each. **386 of 392 watchDigging cancels (98.5%)**
  happened in that state.
- **Three CORRECT policies compose into "cannot mine"**: `toolFor` reserves tools worn past `HARD_STOP`
  and returns no item → `applyToolPolicy` deliberately swaps a **non-tool into the hand** to stop the
  last tool being worn down → `watchDigging` cancels the dig because **dirt cannot harvest stone**. Each
  was added for a measured reason. The composition is the bug, not any part. The only trace in the logs
  is `Digging aborted`.
- **THIS CORRECTS A CLAIM I MADE TWICE.** "682 of 682 cancels had a harvesting pickaxe in the bot's
  inventory — the remedy was in its pocket" tested only that an item *named* `*pickaxe` EXISTED. It never
  read durability. The pocket held three stone pickaxes at 1/131. That framing is what aimed
  `needsdrop-01` at the watchdog instead of the tools.
- **The avoid-rule blacklist is STALE/REFUTED** — a full walk finds **no avoid or veto event kind at
  all** (positive control: the only `*refused` kinds present are canopy_drop, explore_blind_step,
  maroon_climb, maroon_dig). Nothing blocks the craft. Bots are trying: **875 failed crafts vs 150
  successes in 6 h**.
- The `wrong_wood` variant mismatch is real but **19%** (140 of 718), not the story; **81% genuinely lack
  the material.** I led with the mismatch after seeing `gather cobbled_deepslate` on a bot holding 56
  andesite, and that was over-reading it.
- **THE ROOT IS WOOD.** Gather runs targeting wood over 6 h: starved bots **10.8%** success (348/3208),
  healthy bots **9.7%** (58/601) — **the same rate, so starvation is downstream, not causal.** 72% of the
  failures are `unreachable` (39%) + `no_safe_target` (33%).
- **The chain**: wood at 10% → no sticks/planks → no wooden pickaxe → no stone → no cobblestone → no
  stone pickaxe → every pickaxe dead → the three-policy composition silently stops mining.
- **NEXT CANARY BELONGS AT QUEUE ITEM 3 (navigation/gather)**, which both review engines ranked top
  independently. Read it on **acquired wood**, never on refusals avoided — `leaf-01` halved `unreachable`
  and the freed attempts became `no_safe_target` and `no_path`, not successes. The refusals move; the
  10% does not.
- **Rival explanation this raises for the seed canary's +29 pp**: a reseed resets bot state, which
  includes handing bots working tools. Nobody has ruled out that the re-seeded pools were simply the only
  bots with live pickaxes. Check that before reading the seed effect as terrain.
- **NOT the fix**: raising `HARD_STOP` or disarming `watchDigging`. Both grind the last pickaxe to dust,
  which is what the iron-retention work removed on evidence.

### THE VERDICT, and what it actually found
**REVERT at +180.** Full account in `needsdrop-01-premise-refuted-2026-09-21.md`.
- **PRIMARY** abort-share ratio-DiD **−13%** (canary 12.5→6.3%, control 7.9→4.6%, 1,066 canary gather
  runs against a 200 floor) against a registered −54% and a KEEP of ≤−25%.
- **MECHANISM** ratio-DiD **+8%**: watchDigging cancels/bot-h canary 0.69→0.28 vs control 0.63→0.23,
  counts 40→16 vs 73→27. **Disarming 13 sites produced no reduction in the cancels they were meant to
  cause.**
- **THE TEST THAT SETTLES IT** — for every watchDigging cancel, which skill was running? canary post
  15/16 gather, control post 27/27, canary pre 38/40, control pre 67/73. **They are all `gather`**, i.e.
  the two sites that still OPT IN. The 13 disarmed sites were armed and never firing.
- **Inertness ruled out at source, not from the version string** (owner-01 ran 97 min as the baseline
  with every check green): canary tree `needsDrop=false` + 2 opt-ins, baseline `needsDrop=true` + 0,
  70 lines different, exactly the 4 pools on `harness-canary`.
- **HARM did not gate**: 2 canary deaths in 57.4 bot-h vs 2 control in 172.3 = 3.0x, exact Poisson split
  **p = 0.262**. All deaths are drownings with an identical signature including the control ones.
- Teardown verified in all three steps: 0 drop-ins, `canary_pool` cleared, 20 bots restarted staggered,
  **one version on all 80**, ex-canary bots back on `/srv/mcbots/harness`.

### ►► THE NEXT CHANGE, and it was in the review I under-weighted
**The bug is the silently-failing equip, not which sites arm the watchdog.** `bestTool` returns only
harvesting tools or `null`, so a watchDigging cancel at `skills.mjs:1195` **proves the equip three lines
above at `:1191-1192` failed or was undone** — and that equip is
`if (tool) await bot.equip(tool,'hand').catch(() => {})`, a swallowed error. 682 of 682 recorded cancels
had a harvesting pickaxe in the bot's inventory while the hand held dirt 67.9% of the time and nothing
19.8%. **First step is to stop swallowing it so the failure has a name**, then read why it fails. That is
a smaller change with the whole population behind it rather than none of it.

### TWO DEFECTS IN MY OWN READ SCRIPT, found by this canary and fixed
- It printed **"ratio 0.00x"** for 2 canary deaths against 0 control — it divided by a zero control rate
  and fell back to 0, so the most extreme possible input read as the safest number. Now reports the ratio
  as unbounded and decides on an exact Poisson split test.
- It dropped the **isolated pools from both arms**, which erased a real control drowning
  (isolated-d-Comet 08:29:23Z) and turned "2 vs 1" into "2 vs 0", biasing the gate toward tripping. Harm
  counts them now; productivity still does not.

### THE DRAW IS NOW FOUR POOLS / 20 BOTS
Measured null sd of the pool-mean ratio-DiD on items/bot-h, 300 random splits per cell:

| | k=5 | k=10 | k=20 | k=40 |
|---|---|---|---|---|
| 3 h | 0.608 | 0.443 | **0.313** | 0.292 |
| 9 h | 0.411 | 0.318 | 0.222 | 0.196 |

**k=20 at 3 h beats k=5 at 24 h at one eighth the wall clock**; past k=20 the control set shrinks and
the gain stalls. At k=5 the floor is sd 0.262 — MDE ~51% at ANY window — so a five-bot draw, not a
short read, is what made the committed endpoint unreadable. The 12 h per-pool exclusion already caps
the fleet near two canaries per 12 h, so this spends surplus CONTROL pools, not throughput.
`drawrec.sh` degrades 4 → 3 → 2 and says which. CLAUDE.md's "randomize five bots" was a choice; this
is the change to it, and the DiD rigor it protects is untouched.

### APPARATUS — the reason 17 of 55 ledger decisions name a failure rather than a result
- **`fleet-deploy --pool` now REFUSES unless a reader exists**: `canary-loop.sh` alive (anchored, because
  `pgrep -f canary-loop` self-matches) or `~/MANUAL-READS-UNTIL` holding a future UTC stamp.
  `READER_OK=1` overrides and must be typed. Tested on four paths; **it fired correctly on its first
  real use tonight.**
- **`canarywatch.py`** (cron */10) raises STALE (past `deadline_min` with no decision for that
  sha+pool) and ORPHANED (declared canary, no reader). 11/11 self-test cases, and **both alarms have
  been seen to fire** — the dead loop stayed invisible because its monitor never had.
- **`stuckwatch.py`** (cron :17/:47) pages on bots pinned ≥ 4 h. Live: **4 of 80** — hive-b-Comet (at
  y=0), hive-d-Delta, isolated-d-Alpha, isolated-d-Echo.
- `drawrec.sh` band centre is the all-pool median (was the 5080-half median, which judged the -d pools
  against a centre they do not contribute to).

### SEED CANARY — placebo-a +48 h (was 6 h overdue; taken 06:2xZ)
**gather success DiD +29.1 pp** (13.0% → 42.7% against control 20.1% → 20.7%), stock +9.7/bot-h,
immobile −4.5 pp, iron-pick share −18.7 pp. With the **six canary-contaminated control pools dropped**
(`SEED_CONTROL_EXCLUDE`): **+32.1 pp**, stock +9.8, immobile −9.6 pp — contamination was *diluting* the
effect, not creating it. Clean controls went 24.2% → 21.8% while their immobility doubled.
- **NOT yet attributable to the seed.** The reseed-plus-reset confound has not washed out at 48 h —
  the iron-pick collapse is the inventory wipe still unrecovered. And I could not separate "fresh
  terrain" from "fresh bot state": my avoid-rule discriminator found **zero** `learned_avoid` rows in
  either arm, i.e. the instrument could not see the thing it was built to test, so that hypothesis is
  UNTESTED, not refuted.
- placebo-b +48 h is **scheduled detached for 11:26Z** → `~/digest/seed-placebo-b-48h.txt`. Both +72 h
  reads land 22 Sep, clear of the 24–27 Sep program window.

### QUEUE CHANGES from the two-engine review
- **Queue 4 "equip rather than abort" is DEAD as written.** Its real remedy is a subset of queue 5
  (arbiter dig ownership). The `needsDrop` half shipped tonight as needsdrop-01.
- **Queue 10 concurrent canaries — DROP on engineering cost.** It buys ~2% worse SD for twice the
  experiments; raising k from 5 to 20 bought a 1.9× SD improvement for free tonight. (The *old*
  argument against it — "concurrency shrinks the canary" — was wrong and stays retracted.)
- **owner-01c has a pre-flight landmine, found and verified**: `index.mjs:259` calls
  `runner.arb.installActuatorGate(bot, …)` guarded only by `runner?.arb` existing, but
  **`installActuatorGate` does not exist in cfc1c58's `arbiter.mjs`** (115 lines; it is only on
  `movement-owner-1`). With `ARBITER=1` on today's main that is a TypeError mid-spawn, before the
  movement profiles are set. Attempts one and two died on apparatus; assert the method exists and
  `bot.dig.__arbiterGated` is true before declaring attempt three.
- **The composed drowning trap is NOT a program priority.** isolated-d-Alpha sat at exactly one
  integer position for 4 h, sealed in water, the pocket rung refusing to dig because "cell y=54 would
  let liquid in" while the bot was already submerged. Vivid, but measured fleet-wide it is **1 bot in
  80 (~0.9% of items)**, and 15 other bots hit `sealed_in_liquid` and keep moving. Logged as an
  operations alarm, not a canary.

## Fleet
- 80 bots / 16 Peaceful worlds. **`cfc1c58` fleet-wide, ONE version on all 80 (`cfc1c58+e1d1b2`)**, verified
  11:30Z and again after promotion. `main` = cfc1c58. Previous mains: **main-pre-2026-09-20 (b1659c0)**,
  main-pre-2026-09-17 (1d6c97d), main-pre-2026-09-16b (08a3da2), main-pre-2026-09-16 (426058d).
- 11:30Z digest: one version, 80 bots, 2 deaths in 2 h (0.012/bot-h), 3 immobile, 7 zero-item bots in 2 h.
- **keepInventory=true and doImmediateRespawn=true on every world** (deliberate, place-town.py): deaths cost
  time, not items. Owner 18 Sep: it stays ON through the seed canary's 72 h, then goes OFF fleet-wide as its
  own registered program change (a world rule, never a canary) — queue item 7 moves it to after 27 Sep.

## No live code canary — the slot is FREE and the ledger is closed
`check-open-loop.py` clear at 11:26Z and after the promotion; `canary_pool` empty; no `canary-loop` process.
Last decisions: **digwatch-02 KEEP / PROMOTED** 20 Sep 11:26Z. **digwatch-01 INCONCLUSIVE** 19 Sep (v1 was
blind). **leaf-01 REVERT** 19 Sep 15:48:55Z. **owner-01b REVERT** 18 Sep 16:38:45Z.

## digwatch-02 (cfc1c58) — KEEP, PROMOTED FLEET-WIDE, and what it found
Closed by hand on 20 Sep: **the loop was dead and the canary had run 15 h against a 420-min deadline with no
read**. Full account in `status-report-2026-09-20.md`; the read itself is the registered +360 window.
- Death gate HELD (v21): 3 deaths / 60.0 bot-h (0.050/bh) vs 9 / 300.0 (0.030/bh), ratio 1.67x, lower bound
  0.39x < 1.25x. **Same 1.67x over the full 902 min** (5/150.7 vs 21/1054.7) — the registered window is not
  flattering it.
- **Hand-read passed**: 77 canary aborts -> 15 `_dig_collision` rows; control 825 aborts -> **0** rows.
- **THE FINDING: 15 of 15 collisions had a harvesting pickaxe in the bot's inventory while it held the wrong
  block.** 13/15 are `skills.mjs:169` `watchDigging` (`!b.canHarvest(heldItem)` -> `stopDigging`); 1 is
  `reflex.mjs:4601` (the concurrent digger, wrongly retired when v1 came back blind); 1 is `index.mjs:531`.
  This is the CLAUDE.md refusal-without-a-remedy class: **the remedy was in the pocket and the code aborted
  instead of equipping.** Accumulator: `~/mcai-analysis/collisions.py`. The recorder is now fleet-wide, so
  n grows 8x from here. **A fix is a BUILD CANDIDATE and has not been through review.**

## SEED CANARY — +24 h READ DONE ON BOTH POOLS, and it is the week's biggest number
Full read `seed-canary-24h-2026-09-20.md`; readers `~/mcai-analysis/seedread.py`, `seedtraj.py`, `seedfails.py`
(written 20 Sep — the registration had no standing script).
- **Gather success DiD +29.1 pp (placebo-a) and +30.1 pp (placebo-b)**; the pools read 41.6% and 43.1%
  against a fleet of 19-22% and a >=40% two-week gate. Two seeds, two pools, agreeing within 1 pp.
- **The +24 h read cannot attribute this to the seed** (registered reseed-plus-reset confound). But the shape
  test does not wait: fresh-start decays, terrain is flat. **Neither pool decays over 24-30 h; placebo-b
  rises** (+10.8 -> +30.0 pp). The short transient is ruled out, a multi-day one is not.
- **Stock is NOT a finding**: +13.6/+13.1 at 24 h but the trajectories disagree (a decays 23.5->4.5, b rises).
  **Iron-pickaxe share moves in opposite directions in the two pools — noise.** Deaths are under-powered at
  five bots in both.
- **Composition, per bot-hour** (reseeded vs control): SUCCESS 7.55 vs 3.41 (2.2x); **`no_safe_target` 1.19 vs
  3.85 (-69%)**; `unreachable` 3.15 vs 4.90 (-36%); **`no_path` 3.20 vs 2.71 (+18%)**; **`nothing_found` 1.82
  vs 0.99 (+84%)**. Attempts comparable (18.0 vs 16.7 terminal/bot-h). The fresh worlds are **not uniformly
  easier** — and the biggest single gain is a **safety refusal that queue item 3 explicitly excludes from its
  denominator.** See queue item 3, which this changes.
- **Remaining reads: placebo-a +48 h 21 Sep 00:00Z, +72 h 22 Sep 00:00Z; placebo-b +48 h 21 Sep 11:25Z,
  +72 h 22 Sep 11:25Z.** These are the registered discriminators. KEEP/REVERT do not apply (no code change).
  Both windows close clear of the 24-27 Sep program read.
- Sample caveat (amendment 19 Sep): the population is **seeds on which the town SITES** — flat, dry, low
  relief. 1 of the 2 seeds drawn hit the rejection. A later null is weaker than it looks.

## RETRACTIONS still in force — read before using any 19 Sep noise number
From `endpoint-noise-floor-2026-09-19.md`; Codex refuted four of five conclusions and a positive control.
- **The planted-effect positive control was an ARITHMETIC IDENTITY** (spread 7e-16 across f). Every
  "planted +30% -> +30.0% ok" from `sweep/endpoints/candidates/halfdid/halfmix` is arithmetic, not evidence.
  Replacement `scripts/analysis/realcontrol2.py` must SCATTER (sd 0.303). **Its own v1 reproduced the same
  tautology.** Twice in one session a control was built from the quantity it was meant to test.
- **Concurrent canaries are NOT cancelled** — concurrency shrinks the CONTROL set, ~2% worse SD for twice the
  experiments. Kill that workstream on engineering cost if at all, never on the old argument.
- **The inference half is NOT cleared as a confounder** (`llm.mjs:430` preserves preference order). Treat it
  as an UNADJUSTED covariate. The draw no longer holds it constant (`drawrec.sh:72`, changed 19 Sep 19:51Z);
  the ±band STAYS (it removes a -10% median bias).
- **"Time is not a design lever" is UNVERIFIED.** **`decisions/bot-hour` is not cooldown-pinned**, but its
  direction is ambiguous — an operational breakage guard only, never a success criterion.
- **`items/bot-hour` survives as very dispersed**: null sd 0.70 at one pool, 0.51 at two, 0.41 at four.
  Dropping ONE bot from a five-bot pool moves the estimate with sd 0.30.
- **leaf-01 is the counterexample to gating on mechanism and harm alone**: mechanism improved, deaths held,
  acquired wood collapsed -0.650 against a -0.5 gate. Scored on "refusals avoided" it would have been
  promoted while making the fleet gather less. Next version, if any: admit leaf-covered logs only as
  FALLBACK, never as a peer of an open target — that experiment has run.

## Queue
1. ~~Seed canary~~ **+24 h DONE 20 Sep, both pools.** Remaining: 48 h and 72 h reads (times above).
2. **v23 suite — what remains**: make uncalibrated linkage WATCH-only (v19 already demoted rung-linkage;
   confirm no other uncalibrated path can revert), and **calibrate or amend the invented 7x control
   denominator** (item 16). The 16-case / 11-mutant suite itself is DONE.
3. **NAVIGATION / GATHER — the only failing committed metric. REFRAMED 20 Sep, read this before building.**
   The seed read says the largest single component recovered by a fresh world is **`no_safe_target`
   (-2.66/bot-h, -69%)**, which this item's own denominator excludes as "a safety refusal, not a reachability
   failure" — while `no_path` and `nothing_found` got WORSE on fresh terrain. The pathfinder framing
   (`mineflayer-pathfinder` issues #222/#273/PR #380) may be aimed at the smaller half. **Leading hypothesis:
   the bots excavate and flood their own surroundings, the safety check correctly refuses targets in it, and
   that is the collapse.** Exposure is not the constraint: navigation-class failures run ~7.6/bot-h.
   **Needs the registered dual review before a build is proposed.**
4. **NEW — the watchDigging equip remedy.** 13/15 recorded dig collisions are `skills.mjs:169` aborting a dig
   because the held item cannot harvest, with a pickaxe in the inventory. Remedy: equip rather than abort.
   The recorder is fleet-wide now, so n grows before anything ships. **Dual review first.**
5. **owner-01c — the movement owner, third attempt.** Never failed a guard; failed the apparatus twice.
   Needs item 2 and a draw with headroom on the primary endpoint (item 8). **ARBITER is authorised** (owner
   18 Sep) — do not re-ask.
6. **DROWNING — demoted.** Do the one-hour read of the interrupt tax before spending a slot (the air reflex
   once aborted 9.8% of every run; nobody has recomputed it). Deaths cost 0.04% of bot-h. The health floor is
   **"not at full health", NOT "below 5"**. `floatDigTargets()` returns `[]` without a pathfinder plan, so the
   remedy is new code. Endpoint: reached and sustained breathable space within a fixed horizon per eligible
   episode; pre-register the MDE. **Do not bundle the floor with the dig.**
7. **falls-02 — the falls instrument FLEET-WIDE.** Behaviour-inert, needs no slot. 7 fall deaths at
   23/31/31/36/40/40/42 blocks of 48, ~0.0036/bot-h. Worktree `mcai-falls` (fc28885), rebase onto cfc1c58.
8. **`keepInventory` OFF — after 27 Sep.**
9. **Extend `drawexposure.py` — two checks, NOT a new script.** (a) a non-degenerate pre-period on the
   primary metric (owner-01b drew 0.0% and printed `+nan% FAIL`); (b) exposure against the MDE-implied n.
   REPORT-only until calibrated against draws whose outcome is known (-13b, -13c, 1011b).
10. **Concurrent canaries (owner-approved, build it).** Step 1 done: `canary_split_ok` / `in_canary_pool`
    consolidated into `scripts/lib/version_split.py` (20 new tests, 5 mutants dead) on `recovery-ladder-03`.
    **It does NOT ride along with a deploy** — `deploy-fleet.sh:126` installs the tripper at the deployed sha,
    so it must be merged into the branch actually deployed. Remaining per `concurrent-canaries-design.md` §5:
    N-canary classifier (pools pairwise disjoint, versions pairwise distinct, N<=3), per-run canary trees,
    per-run loop locks with a manifest mutex, readers.
11. Pocket-rung block floor (need+4 with 5 held). **12.** Pooling rule -12 (iron).
13. ~~Delete exptest.json~~ **DONE 20 Sep.**
14. **Teach the analyst the two-part OpenLoop test** (`pgrep -f canary-loop` AND the deadline). Today the
    deadline half fired correctly and alone; the slot is free, so editing its rule is safe now.
    **TRAP, hit on 20 Sep: `pgrep -f canary-loop` SELF-MATCHES.** Any command line containing the string —
    including the check itself, and any `ssh host '... pgrep -f canary-loop ...'` — is matched by its own
    pattern, so the naive test returns "loop alive" unconditionally and would suppress exactly the alarm it
    exists for. Verify against the real thing (`pgrep -af` and inspect, or match on `canary-loop.sh` with the
    pattern split), and **prove the detector reports DEAD when the loop is dead** before trusting it.
15. **CLAUDE.md's byte-offset rule is under-scoped** — it names `deploy-fleet.sh`; the hazard is any
    long-running shell script edited in place. Run them from a copy.
16. **The death gate's invented control denominator**: `control_bot_h = canary_bot_h * 7` when control reports
    no rate, reverting on 3 deaths against an assumed 0. Calibrate or amend to UNREADABLE; prospective,
    pinned by `test_verdict_acceptance.py`.
17. **Keep RULE.md and RULES-IN-FORCE.md synced on every rule change** — two `scp`s, part of step D.
    Verified current 20 Sep (both md5-match their sources).
18. **NEW, and it cost 15 fleet-hours — a hand deploy leaves no loop.** `fleet-deploy` does not start
    `canary-loop.sh`. digwatch-02 was deployed at 20:09:38Z with no loop attached and sat unread until the
    next session. Either `fleet-deploy --pool` starts the loop, or it refuses to declare a canary without one.

## Rules in force (docs/reports/recovery-ladder-registration.md)
**v24** (an own-line value that is None, NaN or ±inf is UNREADABLE, not a failure) — LIVE. **v23** (no single
canary death reverts by ANY path; gates carry `role: deciding|tripwire`) — LIVE in the verdict path. v22
WITHDRAWN unregistered. v12 linkage, v14c, v15c movement guards (calibrated 2% false-revert / 97% detection),
v16 (calibrate before revert; trace refusals to fallbacks; histogram slot order; bundles of two disjoint
changes), v17/v18, v19 (a change/linkage row must DISCRIMINATE — `changerowcheck.py` pre-deploy,
`license_change_rows()` at read time), **v21** (the death gate on the LOWER BOUND of the rate ratio), the
owner's floor of **two** canary deaths, draws at deploy (12-h ledger exclusions, ±25% then ±40%, the inference
half now an unadjusted covariate, never placebo-c/isolated), `fleet-deploy` refuses a `--pool` sha not
descending from `declared_code_version`, `CANARY_ENV` + the `/proc/<pid>/environ` assertion so a flagged
canary cannot ship inert.

## Standing wake-ups
- **Before any canary read, check `~/digest/RULE.md` and `~/digest/RULES-IN-FORCE.md` are current** against
  `recovery-ladder-registration.md` and the paragraph above. Both verified current 20 Sep by md5.
- **Run `python3 scripts/test_verdict_acceptance.py` before and after touching the verdict path**, and
  `test_verdict_acceptance_mutants.py` OFF the bots host (`/home/mike/mcai-analysis` shadows a mutated helper).
- **Nightly 00:12Z `~/programread.py 24` -> `~/digest/programread.log`** (stock line and throughput line;
  splits by `code.version`, and that split is NOT a canary read).
- Nightly 00:07Z iron-funnel (`~/digest/ironfunnel.log`). Last fleet line: 73 raw iron / 92 ingots / 10 picks
  crafted, 14 gone, iron-pick share 15.3%.
- Tier-1 local analyst every 30 min (`~/digest/*.verdict.json`); tier-0 digest `~/digest/latest.md`.
  `versions_ok=False` is the known build-suffix false-fail (`<sha>+<buildhash>`), not an alarm.
- **Declare the two-week program read window: 72 h continuous, 24-27 Sep**, and keep promotions out of it.
  The two-week gate is 27 Sep. **STILL NOT REGISTERED — do it before 24 Sep.** Note in the registration that
  the two re-seeded pools are a world-level confound whose 72 h closes 22 Sep, so they are clear.
- **Seed-canary reads: placebo-a +48 h 21 Sep 00:00Z, +72 h 22 Sep 00:00Z; placebo-b +48 h 21 Sep 11:25Z,
  +72 h 22 Sep 11:25Z.**

## Known false alarm — the analyst pages OpenLoop for the whole life of every canary
`check-open-loop.py` reports OpenLoop whenever the manifest declares a canary with no decision, which is the
NORMAL state from deploy to verdict. The discriminating test is `pgrep -f canary-loop` **plus** the deadline:
OpenLoop with no loop running, or past `deadline_min`, is real. **On 20 Sep it was real** — the deadline half
fired at 11:00Z and was right. Queue item 14 builds the other half.

## Daily session rotation
- Desktop task `mcai-daily-session` starts a FRESH session at 06:08 America/Chicago (11:08 UTC). It reads this
  file first, closes any open canary (**check the ledger AND the journal AND `pgrep -f canary-loop` before
  acting**), re-arms below, does the queue, rewrites this file to BOTH copies.
- `check-open-loop.py` lives at **`/opt/minecraft-ai/scripts/check-open-loop.py` on .31** and needs sudo. It
  is NOT in `~/mcai-analysis`.
- **`~/mcai-analysis/arm-read.sh` DOES NOT EXIST** despite older re-arm text naming it. The loop takes a read
  as `cd /opt/minecraft-ai/scripts && python3 /tmp/<read>.py <M>` then `python3 ~/verdict.py <run> <M>`, where
  the read scripts clamp `W = min(elapsed, M)` — so a missed read can be taken late at its registered minute.

## Standing constraints (verbatim from the owner)
- Full autonomy: deploy, canary, promote, tear down without waiting. Wake the owner on every promote or revert
  and on anything needing a human hand.
- No world changes to fix a bot (sandbox 10.0.0.30:25599 only; the seed canary is the registered exception —
  the world IS the treatment). Swimming is travel. No 192.168.19x network; no UniFi API on 10.0.0.1; never
  disable rpcbind; never touch the apt timer. One code canary at a time (a bundle counts as one) until the
  concurrent-canary build lands. Teardown is THREE steps. Deploy only via `~/bin/fleet-deploy`. Commit with
  `git commit -F -` heredocs. Two Codex passes per patch, then a smaller patch. Never share a live canary's
  inference endpoint/model; ARBITER stays OFF as the fleet default (authorised for owner-01c only). Never
  `git add -A bots` in a worktree with a node_modules symlink. Readers include rotated `.gz` generations.
  logEvent kinds carry a leading underscore in `skill.name`. Lab SSH `mike@10.0.0.31` (bots) /
  `mike@10.0.0.30` (worlds); the lab key on the mini is `~/.ssh/id_ed25519`. Status reports live in
  docs/reports. Use `date -u` for clock labels.
- Independent Claude **and** ChatGPT review, plus a real search of open source, issues and forums, before
  proposing to build — scoped to design changes, new research claims and deploy-impacting conclusions.
- **And one the repo should adopt:** run any long-running shell script from a copy outside the tree you may
  edit. CLAUDE.md says this of `deploy-fleet.sh`; bash re-reads by byte offset for all of them.

## Worktrees
`mcai-digwatch` (dig-collision, cfc1c58 = NOW MAIN), mcai-owner (movement-owner-1, aa44514 — reverted twice,
rebase for owner-01c), mcai-falls (falls-path-log, fc28885 — rebase for falls-02), mcai-owner-f (3b9ff25,
unused), mcai-deathsites (b1659c0 = old main), **mcai-rl02 (recovery-ladder-03 = docs/scripts branch)**,
mcai-recovery (iron tools; pooling NOT started), mcai-rllava, mcai-rliron, mcai-rl10, mcai-canopy, mcai-scene
(sandbox harness).
Scripts: `~/mcai-analysis` on this Mac (reads, reseed journals). On .31 `~/mcai-analysis` holds drawrec.sh,
changerowcheck.py, drawexposure.py, deathgate.py, singledeath.py, collisions.py, **seedread.py / seedtraj.py /
seedfails.py (new 20 Sep)**, registrations, and **`lib/` — the golden analysis library restored after every
deploy**. The nightly/host instruments are vendored in the repo at `scripts/host/`.

## Re-arm on a fresh session (monitors are session-local)
0. **No code canary is live, so items 1-4 do not apply today.** They apply the moment one is deployed.
1. **Loop pages AND journal phases**: Monitor tailing **both** `~/digest/page.jsonl` **and
   `~/canary-journal.jsonl`** on .31, filtered to
   `verdict|error|flag|PROMOTED|REVERT|deployed|torn-down|KEEP|INCONCLUSIVE|read-|phase`, **new lines only**
   (`tail -n 0 -F`). **`page.jsonl` ALONE IS NOT A HEARTBEAT** — the loop pages decisions and errors only, so
   a quiet watch is indistinguishable from a dead loop. The journal is the heartbeat. Treat silence as a
   reason to `pgrep -f canary-loop`.
2. **Local analyst**: Monitor running `bash ~/analystwatch.sh` on .31. **DO NOT FILTER IT ON MESSAGE TEXT** —
   a filter added 18 Sep suppressed a verdict carrying `page_claude: True`. ~20 lines over a canary's life is
   cheaper than one suppressed alarm. Triage by hand.
3. **Death poll**: the loop runs `verdict.py <run> 0 --poll` every 5 min and pages on REVERT, so monitor 1
   covers it — **only if the loop is actually alive.** Verify with `pgrep`, do not assume.
4. **If the loop is dead with a canary declared** (this happened 20 Sep): read `~/canary-journal.jsonl`, take
   the reads by hand at their registered minutes (see "Daily session rotation" above for the exact commands),
   record with `check-open-loop.py --record` under sudo **BEFORE** touching the manifest, then promote
   (`~/bin/fleet-deploy <sha> <run>-promote "..."`, which itself tears down the drop-ins and rewrites the
   manifest) or tear down (THREE steps: `sudo /usr/local/sbin/mcai-canary-tree teardown`; clear `canary_pool`
   and `canary_code_version`; restart the pool's bots 12 s apart; confirm exactly one version is live).
5. **After any deploy, check the analysis library survived** —
   `python3 -c "import sys; sys.path.insert(0,'/opt/minecraft-ai/scripts'); from lib.telemetry import Events; print(len(Events.load(since_minutes=30).rows))"`
   on .31. `fleet-deploy` restores it; a deploy by any other path will not.
6. **The seed canary needs no monitor** — its reads are calendar items and the telemetry walk is
   retrospective, so a missed read is recoverable. Use `~/mcai-analysis/seedread.py <pool> <hours>`.
