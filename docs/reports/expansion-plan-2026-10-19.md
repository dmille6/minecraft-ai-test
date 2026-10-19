# Expansion: expeditions, then outposts, then rails (2026-10-19, design only, r6)

OWNER 10-19 ~15:30Z: "yes, we need expansion." The goal is to "build cool structures, survive, and work together for long
periods of time". The worlds are peaceful. The diamond tier is held until the mineshaft and underground safety are done.

This is a plan, not a build. No bot code, no queue entry, no host service and no world was touched. Every number is
read-only, from Elasticsearch through `scripts/lib/estelemetry.py` on 10.0.0.31 (`~/estel`, `nice -n 19`), and from the
pool state directory `/var/lib/mcai/_pool-*/` (homes from the `town-chest-<home>` file names). The scripts and their raw
outputs are in `expansion-plan-2026-10-19.measure.txt`.

It builds on, and does not repeat:
- `townprojects-stages2-8-plan-2026-10-19.md` (r9.1, owner-approved; rails = stage 8, §4.7, §6, O11);
- `overseer-assigner-design-2026-10-19.md` (r3; RECALL gated on `home` ≥ 70%; S0 staffing census);
- `ziggurat-mineshaft-2026-10-15.md` (r5.1; shaft §4, shaftuse-01 §4.4).

**Windows.** "7 d" is 10-12 15:00Z (or 16:00Z) to 10-19 15:00Z: ≈ 9.9 M skill docs from 80 bots; it crosses 7 log rotations
(≈ 40-60 rows lost each) and lies after ES's validated range (completeness assumed, not reconciled). "Shared towns" are the
12 board, hive and placebo worlds; isolated pools are excluded unless a line says otherwise.

---

## 0. Answers first

**1. The first step is `homefix-01`, a correctness fix to `home`, the stagnation watchdog and the runner, read as tier 3
on deterministic gates (§2, §5).**
- Going home is the return leg of every expedition and the overseer's RECALL. Today it fails for reasons that are ours, not
  the terrain's: an arrival graded as a failure (H1), watchdog rescues that never start or are cut at 15 s (H2a, H2b), and
  interruptions filed as skill bugs (H3). Each is a small change with a behaviour test and a deterministic KEEP gate.
- Alongside it, with no canary slot: **E0, the frontier census** (host-side, read-only; §4). It says where fresh land is
  and how far, before any expedition code is written.

**2. ORDER (one canary lane).** The owner's list for this week keeps its order. The one insertion into it, homefix-01 at the
first free slot, is an owner decision (X9), as TP's O2 was for shaftuse-01.

| # | step | tier | needs |
|---|---|---|---|
| — | **E0 frontier census** (host, read-only, no slot) | — | nothing; build now |
| first free slot (X9) | **homefix-01** (§5) | 3 (v36: long reads register tier 3; X1) | built + both reviews + X1/X9; inserted by the queue owner (the coordinator); never holds the head, as shaftuse-01 (TP O2) |
| — | the owner's list as queued on origin/main **STATE 10-19 15:20Z** (TP §0.4 and STATE 12:45Z's owner list put shaft-01 before stonewithdraw-01; the 15:20Z queue has them the other way round, with shaft-01 HELD; no insertion here depends on which): treefarm-02 → brain-01 → cobblekeep-01 → toolkit-03 → bamboo-03 → townfloor-01 → monument-01 → stonewithdraw-01 → shaft-01. smeltfuel-01's fuel sweep is inside toolkit-03 ("kit iron + smelt coal through every-container search", same entry; the owner's brief says "smeltfuel (folded into toolkit-03)"); if the coordinator un-folds it, smeltfuel-01 keeps its TP place before pavilion-01 | | |
| after the owner's list | **expedition-01** (§6) | 3 | homefix-01 KEPT; cobblekeep-01 KEPT (bags; §1.3); E0 live 48 h; K0 kit replay passed (§6.3) |
| then | pavilion-01 → crown-01 (TP stages 3-4, unchanged) | 3 | — |
| then | **outpost-01** (§7) | 3 | expedition-01 KEPT; monument-01 KEPT (structureguard + builder.mjs) |
| then | hall-01 (TP 5); storehouse-01 and projectdemand-01 stay CONDITIONAL (TP 6-7, unchanged) | 3/3/2 | — |
| last, gated | **rails** (§8: R0 → R0b → R1 town↔shaft; R2 town↔outpost) | 2/3 | shaftuse-01 KEPT (TP §4.7); outpost-01 KEPT; O11 rail junk lifted; iron reserve |

This is a recommendation for the owner (X2); it amends nothing in the queue by itself.

**3. The `home` diagnosis (§2).** Over 7 d (10-12 15Z .. 10-19 15Z) in the shared towns `home` ran 2,338 times and succeeded
581 (24.9%). It is not mostly a terrain problem:
- **Who calls it.** 1,565 of the rows (67%) start within 30 s after a stagnation-watchdog escalation to level 2, so they
  are rescues of bots that are already stuck. At least 393 (17%) are the brain's own choice (`llm:idle`; a lower bound, since an interrupted run's trigger is overwritten). (Counts in this
  point marked "extraction" are from the 2,346-row pull that ran to 15:24Z; the 24 extra minutes change no share.)
- **H1, the arrival bar (224 runs).** 224 of the 253 `travel_incomplete` failures ended 2.1-2.7 blocks from home at home's
  level. The pathfinder's `GoalNear` ends on an integer NODE within 2 blocks; the bot then stands at the node's centre
  (+0.5), and `home` measures ≤ 2 from the integer home point. 2.5 > 2, so an arrival is graded a failure.
- **H2a, most watchdog rescues never start (Claude r1 P1-1).** `#escalate` calls `runner.cancel('stagnation')` and then
  `runner.run(<rescue>)` at once. `cancel()` only aborts the controller; `runner.current` is cleared later, when the skill
  unwinds, and `run()` refuses with `runner_busy` while it is set (runner.mjs:150-157, 182-185, 491). That refusal returns
  before any row is logged, and the watchdog ignores it. All pools, 7 d: 5,436 escalation-2 events against 2,939 `home`
  rows of ANY trigger, so at least 45.9% of level-2 rescues never ran; 33,459 escalation-1 events against at most 25,867
  goto rows that can be relocations (counting the reflex-interrupted ones), so at least 22.7% of level-1 rescues never ran.
  Polling for idle would lose the race to the cognitive loop; the fix is a runner reservation (§2). A probe of the real `Runner` (Claude r1,
  on a scratch copy) returned `runner_busy`. The watchdog's tests use a fake `run` that can never be busy.
- **H2b, the rescues that do start are cut at 15 s.** The watchdog's `check()` runs on a 15 s `setInterval` and is not
  guarded against re-entry. Escalation 2 *awaits* `home`; the next tick still holds the old stagnant window (it is reset
  only after the await) and convicts the rescue at its first sample. Shared towns: 404 of 610 `interrupt:stagnation` home
  runs lasted 10-20 s (all pools: 524 of 759). All pools: 634 of 1,815 escalation 2→3 steps (35%) came ≤ 20 s apart, and
  1,579 of 5,419 1→2 steps (29%), so the relocation `goto` is killed the same way. Level 3 reconnects when a route exists
  (1,628 `_stagnation_reconnect` in 7 d, all pools). Both H2a and H2b are the CLAUDE.md "Reachable" failure: a remedy
  named and not taken.
- **H3, reflex interrupts misfiled (225 `home` runs; 3,660 runs of all skills, h12).** Fleet-wide over 7 d, 3,660 of 91,313
  interrupted runs (4.0%) were filed `failed / skill_error`: `surface` 2,579 of 3,509 (73.5%), `smelt_town` 291 of 388,
  `home` 265 of 1,421, `deposit` 225 of 374, `craft` 183 of 1,099 (all pools). In the shared towns' `home` rows, 225 `skill_error` rows carry the pathfinder's raw "The goal was changed"
  message (206 under `interrupt:entombed`; 1 more `skill_error` is a raw Timeout). goto converts an aborted walk into
  "interrupted: GoalChanged"; the raw message escapes through `home` → `surface` → the climb stage's catch, which re-throws
  the raw error when the signal is aborted (skills.mjs ~14683; Codex r1 and Claude r1 independently). The runner then files
  an interruption as a skill bug, which also feeds `consecutiveFailures`, the auto-pause and the lessons store.
- **H4, real route failures:** `no_path` 144, `stranded` 92, `goal_changed` 74, `path_budget` 123 (extraction); deep starts
  succeed 23% against 41% at the surface.
- **What fixing H1 alone gives**, replaying the proposed predicate itself (goto's: horizontal ≤ 3, |dy| ≤ 6) over every
  row, successes included: 2 current successes fail it (dy −10) and 235 failures pass it. 11 of the 235 are
  `unknown / no_measurable_change`: the runner's evidence gate (`home` expects position, ≥ 2 blocks moved; skills.mjs:13720,
  runner.mjs ~353-364) downgrades them whatever the geometry, so they stay. That is 581 → **803 of 2,338 (34.3%)**, and
  on the rows whose trigger survived (no interrupt) 581 of 1,201 (48.4%) → 803 of 1,201 (66.9%). A static, geometric
  estimate, not a projected log (Codex r2 P2-5, Claude r2 P3). **That is not S0's
  filter** (Claude r1 P2-2): S0 also drops rows with health unknown or ≤ 10 at the start and rows flagged trap, drowning
  or low health in the 5 min before (24 h: 21 of 54, 39%). On S0's own 24 h window, before its flag filter, H1 moves the
  non-interrupted rows from 64 of 172 (37%) to 101 of 172 (59%); `llm:idle` alone from 6 of 66 to 15. **H1 does not by
  itself reach RECALL's 70%**; S0 re-measures after homefix-01, and reports rows entering the filter (H2 moves cut rescues
  from `interrupt:stagnation`, which S0 excludes, into `watchdog_home`, which it keeps) separately from per-row success.
- **For expeditions the decisive fact is different: there is almost no evidence beyond 200 blocks.** Healthy surface
  starts at 100-200 succeed 46-59% (n = 26 and 27). Beyond 200 the clean samples are 13 runs. Bots spend 0.6% of their
  time beyond 300 (§1.1). So an expedition's return cannot rest on `home` as it is, and its read must measure the return.

**4. The overseer should NOT take expeditions as its first real multi-bot job (§9).** An expedition v1 is one bot per town
under a lease, the "which bot" selection where the shadow mayor's rule tied random. The deterministic eligibility below is
enough. The foreman's design already names its first job (a multi-bot project: monument-01 or the pavilion). An outpost's
supply hauling is a later candidate for a `SUPPLY` lease, once S0 passes.

**5. What the land out there is worth is measured, and it is modest (§1.2).** Per gather body-hour, logs come at about
the same rate everywhere (140-165 per body-hour in every band); what falls near home is the success rate (30% within 48,
58% at 48-100). Ore per gather body-hour rises with distance (30 within 48, 43 at 100-200, 57 at 200-300, on 13 body-hours
beyond 100). Deaths per 1,000 bot-hours are 11 within 48 and 22-33 beyond 100. So expeditions are a bet on the long run
(the depletion front moves out; "fresh worlds buy one week") and on ore, not a measured gain in log yield. Their read is
pre-registered to say INCONCLUSIVE if it is.

**6. Open owner decisions** are in §10 (X1-X10). The biggest: X1 (homefix-01 needs the owner's 09-30 "no more stuck
hunts" rule lifted for it, and its watchdog change is fleet-wide), X9 (its insertion into this week's list), X3 (expedition
v1 is surface-and-shallow only: no `mine` staircase far from home while the diamond hold stands), X6 (rails cost ≈ 0.375
iron a block, so a 400-block outpost line is ≈ 150 iron, 160 with two carts: 82-87% of a median town's observed iron; gold for powered
rails is 0 in the census).

---

## 1. What was measured (denominators first)

### 1.1 Where the bots are: 168 hourly snapshots × 80 bots (10-12 16Z .. 10-19 15Z)
One sample = the newest row per bot in the 10 minutes before each hour (`EsEvents.latest`), 13,438 samples, 10,078 in the
shared towns. Distance is horizontal from home.

| | shared towns | all pools |
|---|---:|---:|
| median / p75 / p90 / p99 / max | 54 / 98 / 163 / 275 / 931 | 56 / 99 / 164 / 291 / 931 |
| time within 48 | 45.1% | 43.9% |
| 48-100 | 30.9% | 31.6% |
| 100-200 | 17.5% | 17.8% |
| 200-300 | 6.0% | 5.7% |
| beyond 300 | **0.6%** | 0.9% |
| deep (feet more than 8 below home.y) | **56.9%** | 57.7% |

- **Farthest sample per shared world (7 d):** board-a 420, board-b 305, board-c 365, board-d 418, hive-a 389, hive-b 931,
  hive-c 311, hive-d 332, placebo-a 475, placebo-b 373, placebo-c 511, placebo-d 319. The owner's 4-a-day sample (median
  ≈ 57, p75 ≈ 95, p90 130-180) agrees.
- **Median by day (shared):** 51, 54, 53, 55, 54, 63, 49, 55. Flat: the bots are not drifting outward on their own.
- **64 × 64 regions touched per shared world in 7 d** (hourly samples, so a floor): 34-56; beyond 200 blocks 5-27.
- **The border** is 1,950 from the world ORIGIN (config `WORLD_BORDER_RADIUS`, measured by `horizontalDistanceFromSpawn`,
  state.mjs:72, which is the origin; the world spawn itself is set at town, place-town.py:524); the homes are 96-480 from the origin, so every town has
  at least ≈ 1,470 blocks of room on its far side.

### 1.2 What the land yields, and what it costs, by distance band (7 d)
**Gather, shared towns, every status, the target block's family only** (body time = the rows' `duration_ms`; position =
the row's END snapshot, so a band is where the gather ended):

| band | log gathers | ok | body-h | logs | **logs / body-h** | ore gathers | ok | body-h | ore items | **ore / body-h** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0-48 | 7,629 | 30.0% | 51.5 | 7,995 | 155 | 6,135 | 13.1% | 23.9 | 729 | 30.5 |
| 48-100 | 7,292 | 58.4% | 94.9 | 15,674 | 165 | 6,541 | 12.2% | 22.9 | 717 | 31.3 |
| 100-200 | 5,115 | 50.3% | 57.2 | 8,704 | 152 | 3,275 | 13.4% | 11.1 | 478 | 43.1 |
| 200-300 | 3,349 | 15.5% | 11.6 | 1,816 | 157 | 875 | 10.9% | 1.8 | 103 | 56.8 |
| > 300 | 302 | 51.7% | 4.1 | 570 | 140 | 109 | 11.9% | 0.3 | 18 | 51.8 |

- **Logs:** per body-hour flat. The near ring's 30% success is the depletion signal (more failed attempts per success), not
  a slower harvest. The 200-300 band's 15.5% is unexplained here (3,349 rows: not a small sample); E0 splits it.
- **Ore:** +41% at 100-200 and +86% at 200-300 per body-hour, on few body-hours. A hint, not a finding.
- **Per bot-hour of presence (all pools, every skill, gather + mine items, hourly-sample bot-hours):** logs 1.88 within
  48, 5.20 at 48-100, 5.37 at 100-200, 4.05 at 200-300, 9.27 beyond 300 (121 bot-h); mine ore 0.31, 0.46, 0.46, 0.24,
  0.78. Selection-biased (why a bot is where it is), so the plan does not lean on it.

**Deaths (all pools, 258 in 7 d, all with a position):**

| band | deaths | bot-h | per 1,000 bot-h | top causes |
|---|---:|---:|---:|---|
| 0-48 | 65 | 5,902 | 11.0 | drowning 27, fall 13, fire 10 |
| 48-100 | 117 | 4,249 | 27.5 | **fire 53**, drowning 41 |
| 100-200 | 55 | 2,395 | 23.0 | drowning 26, fire 10, fall 9 |
| 200-300 | 17 | 771 | 22.0 | **fall 11** |
| > 300 | 4 | 121 | 33.1 | fire 2, fall 2 |

Away from home a bot dies about twice as often per hour present. At 100-200 the top cause is still drowning (26 of 55);
beyond 200 it is falls (13 of 21) and lava. **These bands mix in underground time** (56.9% of all time is deep, §1.1), so
they are not the hazard of a surface trip; E0 splits them by depth (deep / surface) before expedition-01's gates are set.
Expedition safety is §6.5.

### 1.3 Who could go: 24 hourly snapshots of the last 24 h, shared towns (1,439 bot-snapshots)
Bag slots are estimated from `bot.inventory` (64 per stack, 16 for eggs and the like, unstackables one each).

| condition | share |
|---|---:|
| health ≥ 18 | 99.9% |
| an axe | 82.2% |
| a pickaxe at ≥ 40% durability | 68.6% |
| bag ≤ 30 slots | 26.2% |
| **bag ≤ 24 slots** (12 free) | **1.1%** |
| at town (≤ 48 h, ≤ 12 v) | 21.9% |
| all of: bag ≤ 24, pickaxe, health, at town | **0.42%** of bot-snapshots (6 of 1,439); 6 of 288 town-hours (2.1%) had one |

**Bags bind, not health.** STATE 11:07Z agrees (41 of 80 bots at ≥ 34 slots). An expedition that waits for a bot with
room never leaves. So expedition-01 starts with its own kit step at town (§6.3), which replaces the stockpile keeps in
every planner layer. **How many bags that step can empty is not yet measured:** r3's replay (`e5`) was a stack-count
estimate that did not model the planner's transfer rules, and r4 withdraws its 98% (§6.3); gate K0 replays the real
functions before expedition-01 is queued. Expedition-01 is also ordered after cobblekeep-01, the owner's bag fix already
queued.

### 1.4 What the bots already know about far land: almost nothing
- **Resource sightings** (`world-facts-<pool>.json`, capped at 200 per world, `MAX_RESOURCES`): 2,400 in the 12 shared
  worlds; distance from home median 95, p90 184, max 334; 169 beyond 200 and 17 beyond 300. They are where the bots have
  been. They cannot seed targets at 300-800.
- **Explore** (`skills.mjs` explore): 20-120 blocks in 12-block legs, toward a known sighting or away from the world
  origin (the code calls it "spawn").
  131,048 explore rows in 7 d. It is a local wander, not a trip.

### 1.5 Travel
- **goto** successes in 7 d: 52,580. Distance moved p50 63, p90 108, p99 167, max 668. Speed on the 27,675 that moved
  ≥ 60: p25 2.84, **median 3.32**, p75 3.69 blocks/s.
- **One skill call** is capped at 180 s (`SKILL_TIMEOUT_MS`) and goto at 16 legs of 45. At 3.3 b/s a call covers ≤ ≈ 590
  blocks of pure walking, less with terrain. **An 800-block return takes at least two calls**, and between calls today the
  brain is free to do something else. The return must therefore be a deterministic multi-call errand, never advice.

---

## 2. `home`: the diagnosis from rows

**Population:** the extraction pulled 2,346 `home` rows in the shared towns (2,939 in all pools), 10-12 15:00Z to 10-19
15:24Z; the fixed window to 15:00Z holds 2,338 (2,931). The tables below are the extraction; the H1 replay and the H2
durations are the fixed window. Each row was joined to the same bot's previous row within 15 minutes, a PROXY for the
start position (a row's snapshot is its END; logger.mjs:59, runner.mjs:431). 1,090 rows had no earlier row in 15
minutes; they are kept as "start unknown".

| outcome | rows | share |
|---|---:|---:|
| success | 582 | 24.8% |
| aborted / interrupted | 838 | 35.7% (stagnation 538, entombed 169, stuck 114, timeout 13) |
| failed / travel_incomplete | 253 | 10.8% |
| failed / skill_error (225 "The goal was changed…", 1 raw Timeout) | 226 | 9.6% |
| failed / no_path | 144 | 6.1% |
| unknown / path_budget | 123 | 5.2% |
| failed / stranded | 92 | 3.9% |
| failed / goal_changed | 74 | 3.2% |
| other | 14 | 0.6% |

**Triggers.** The runner overwrites a row's trigger with `interrupt:<reason>` when a run is interrupted (runner.mjs:444), so
the original caller of an interrupted run is lost. Joined to the `_stagnation` events instead:
- 741 `watchdog_home` + 534 `interrupt:stagnation` + 235 `interrupt:entombed` + 55 `interrupt:stuck` = **1,565 runs (67%)
  began ≤ 30 s after an escalation-2 event**: the watchdog's rescue.
- 393 `llm:idle` (17%); the rest `llm:<reflex>` restarts and reflex triggers.
- Not one `interrupt:*` row is a success (0 of 1,141), true by construction: the overwrite happens only on interrupted
  runs. For the same reason 393 `llm:idle` is a LOWER bound on the brain's own calls.

**By start distance (shared, rows with a known start):**

| start band | n | success |
|---|---:|---:|
| ≤ 16 | 84 | 35 (42%) |
| 16-48 | 495 | 162 (33%) |
| 48-100 | 376 | 108 (29%) |
| 100-200 | 202 | 46 (23%) |
| 200-400 | 99 | 8 (8%) |

**Healthy-surface subsets** (start ≥ home.y − 8): `llm:idle` 48-100 15/28 (54%), 100-200 12/26 (46%), > 200 2/8; watchdog
rescues that were not interrupted: 48-100 54/81 (67%), 100-200 16/27 (59%), > 200 2/5. Deep starts (feet more than 8 below
home): 202 of 877 (23%) against 151 of 369 (41%) at the surface.

### H1 — an arrival graded as a failure (224 runs)
- 224 of the 253 `travel_incomplete` rows end 2.1-2.7 blocks from home (p10 2.1, median 2.5, p75 2.7), at home's level
  (dy −1..0), and say "3 still to go" (161) or "2 still to go" (63). Successes end at a median 1.6.
- Mechanism: `GoalNear` (mineflayer-pathfinder 2.4.5, `lib/goals.js:67`) tests `isEnd` on the integer NODE: dx² + dy² + dz²
  ≤ 4. A node at dx = 2 is an end; the bot then stands at the node centre, 2.5 from the integer home. `home` (skills.mjs
  ~2560) counts arrival only at `after <= 2`, re-runs goto, which finds itself at its goal (an empty path) and moves 0; two
  no-progress rounds later it returns `travel_incomplete`. goto's own arrival test uses `max(range, 3)` (skills.mjs ~830),
  so the two disagree.
- Positive control: the same rows' successes end at 0.6-2.7, so the instrument sees arrivals.
- Geometry bound (Claude r1): the bot stops within ≈ 0.35 of the node centre (pathfinder index.js ~579), so an isEnd node
  leaves it at most ≈ 2.87 from the integer target: under 3.
- **Fix:** grade `home`'s arrival with goto's own final test (≤ max(range, 3) horizontally, |dy| ≤ VERT), as one exported
  pure function. goto's LOOP BREAK (skills.mjs ~464, `dist <= max(range, 2)`) is not routed through it, so no other goto
  caller's stopping distance changes. Replayed on the fixed window, the |dy| term flips 2 current successes (dy −10) to
  failures and 224 failures to arrivals (§0.3; 11 more pass the geometry but stay evidence-gated). Paper adds a bot that
  starts already inside the arrival radius (the evidence gate then says `no_measurable_change`, which is correct). Behaviour test: a bot stopped on each node with isEnd true is an arrival.

### H2a — the watchdog's rescue often never starts (≥ 45.9% of level 2, ≥ 22.7% of level 1)
- `#escalate` (watchdog.mjs ~392-411): `this.runner.cancel('stagnation')`, `this.runner.resume()`, then
  `await this.runner.run('goto' | 'home', …)`. `cancel` → `interrupt` aborts the controller and returns (runner.mjs
  150-157). `this.current = null` runs only at ~491, AFTER the skill unwinds and after the evidence processing and
  `logSkill` (it is not in the `finally` at ~264-270; Codex r2). `run()` returns `{failed, runner_busy}` while `current`
  is set (~182-185), before any `logSkill`. The watchdog discards the result and resets its window. Level 3 (`surface` /
  `mine` at ~503) and `judgeStranding`'s climb-out (~166-169) share the shape.
- Evidence (all pools, 7 d): 5,436 escalation-2 events vs 2,939 `home` rows of ANY trigger, so ≥ 2,497 (45.9%) level-2
  rescues never ran. Level 1: 33,459 escalation-1 events vs at most 25,867 goto rows that could be relocations
  (`watchdog_relocate` 8,913, and the interrupted ones, whose trigger is overwritten: `interrupt:stagnation` 3,962,
  `interrupt:entombed` 9,641, `interrupt:stuck` 3,351), so ≥ 7,592 (22.7%) never ran (r3; r2 said ≥ 62% by leaving out
  the reflex-interrupted relocations, Claude r2 N-2). Positive control: the same stream finds 1,565 shared-town `home` rows
  that DID follow an escalation 2. Probes (Claude r1 and r2, scratch copies): the real `Runner` returns `runner_busy`
  after `cancel`; and a level-1 relocation after a cancelled brain `home` got `runner_busy`.
- Why the tests missed it: `test/watchdog-busy.test.mjs` fakes `run: async () => {}`, which can never be busy.
- **The handoff race (Claude r2 N-3).** Polling for idle loses to the cognitive loop: in `#escape` (cognitive.mjs ~461-484)
  a cancelled rung 1 returns and rung 2 starts a new goto at once (`livelockNext` → `'dig'`), before any timer poll fires
  (26,785 livelock-escape rows in 7 d). So the fix is a **runner reservation**, not a poll.

### H2b — the rescue that does start is cut at 15 s (404 of 610 cut at 10-20 s; also its relocations)
- `StagnationWatchdog.start()` runs `check()` every 15 s with `setInterval` (watchdog.mjs ~79). `check()` is async and has no
  in-flight guard. At escalation 1 and 2 it `await`s `runner.run('goto' | 'home')`, and it resets `this.samples` only
  after that await returns (~383-384).
- So 15 s into the rescue, the next tick judges a window that is still the old stagnant one, plus 15 s of the rescue. Unless
  the rescue has already moved 8 blocks, it is "stagnant" again: `escalation++` (~370), `runner.cancel('stagnation')`
  aborts the rescue, and the next level runs.
- Evidence (fixed window): shared towns, 404 of 610 `interrupt:stagnation` home runs lasted 10-20 s (median 15); all
  pools 524 of 759. Escalation gaps (all pools): 1→2 ≤ 20 s in 1,579 of 5,419 (29%), 2→3 in 634 of 1,815 (35%); the other
  mode is the designed 160-200 s (3,731 and 1,082). Level 3 reconnects when a route exists: 1,628 `_stagnation_reconnect`
  in 7 d. Up to ≈ 630 of those a week follow a rescue cut at 15 s. **Not every short `interrupt:stagnation` row is a cut
  rescue:** a brain `home` or `goto` that began seconds before a legitimate verdict is cut the same way and looks the same
  (Claude r2 probe), which is why G3 (§5) joins rows to the rescue's own attempt record.
- Positive control: the same stream finds the designed ≈ 180 s gaps, so the instrument resolves both modes.

### The H2 fix, as one contract (r4: Codex r1-r3, Claude r1-r3)
1. **Pending from the verdict.** On a stagnant verdict the watchdog sets `pending` (with an attempt id) BEFORE it cancels
   anything. While `pending`, a tick samples both histories (the stranding push is split out of `#strandingVerdict`,
   ~236) and issues no verdict and no cancel from EITHER judgement (`judgeStranding` is gated too). `pending` is released
   in a `finally` that wraps the whole escalation, including a throw inside `#escalate` (e.g. reading
   `this.bot.entity.position` after a disconnect).
2. **Cancel and reserve in one step.** A new `runner.reserve(owner, ms)` aborts the current skill and marks the runner
   reserved for `owner` for ≤ 20 s. Any other `run()` returns a new declined class `runner_reserved`. Only the owner's
   `run()` passes once `current` is null. **Measured basis (r4, `h11`):** over 7 d, 23,234 skill rows ended by
   `interrupt:stagnation`; the time from the `_stagnation` event to the row's end is p50 1.9 s, p90 10.1 s, p99 47.6 s;
   1,358 (5.8%) took more than 15 s and 108 more than 60 s. So 20 s covers ≈ 95% of unwinds, and the rest is item 4.
   - **The in-flight start (Codex r3).** A `run()` already past its entry check and suspended at
     `await this.arb.acquire(...)` (runner.mjs ~194) has no `current` yet (~203), so `interrupt()` returns false (~151).
     `run()` therefore re-checks the reservation (a generation number) AFTER the grant, releases the grant if it lost, and
     returns `runner_reserved`. Test: that interleaving, through the real Runner.
   - **`isBusy()` reports the reservation** (the cognitive tick at cognitive.mjs ~827 and several reflexes read it), so
     nothing else starts work into a reserved runner.
   - **One declined set (Claude r3 P2-B).** Today five separately named sets decide "the runner declined, this is not a
     failure": `RUNNER_DECLINED` (composter.mjs:646, also well.mjs), `RUNNER_REFUSALS` (milestones.mjs:51), private sets in
     toolkit.mjs ~135 and recount.mjs ~30, and `TD_RUNNER_DECLINED` (towndeposit.mjs:286). And more handlers treat ANY
     `failed` as a backoff: `roomOutcome` (workorder.mjs ~309), `plinthOrderOutcome` (plinth.mjs ~988), `smeltTownOutcome`
     (smeltjob.mjs ~119, with a pause streak), `pruneOutcome` (prune.mjs ~135), the `wear_out` backoff (cognitive.mjs
     ~1219), and `admission.noteFailure` (~1249, ~1255) (Claude r4 P2-3). So, r5: homefix-01 exports ONE set
     (`runner_reserved` included; milestones' `RUNNER_REFUSALS` imports it and EXTENDS it with its own `unknown_skill`,
     `superseded`, `furnace_busy`), and **the brain's outcome HANDLER block skips on it** (one check after `runner.run` at
     ~1214, wrapping the handlers at ~1216-1230 and the `noteFailure` calls at ~1249 / ~1255), while the decision row,
     `lessons.save` and the milestone accounting (~1460) still run; `roomOutcome` (~1436, after that block) gets the
     shared set too. So no handler, cooldown or lesson treats a declined run as a failure. `#escape` decides from displacement, not
     from the run result (~461-470), so it gets its own check: a declined rung is RETRIED next tick, never counted as "did
     not escape", and `livelockNext` never latches on it. Behaviour tests drive a declined answer through the real outcome
     block for each named handler and through `#escape` (no backoff, no cooldown, no latch); a source test only backs them up.
3. **`current` is always cleared.** The runner's post-run processing (evidence, logging) stays in the protected body; an
   OUTER `finally` (nested try/finally, so nothing in the processing can skip it) clears `current`, identity-guarded
   (`if (this.current === mine) this.current = null`), so a late zombie cannot clear a newer run's state.
4. **The level, with a cap (Claude r3 P1-A).** `escalation` is incremented at ~370 before `#escalate`. A rescue that did
   not START (`reserve_expired` with `current` still set, `body_held`, `runner_paused`) does `escalation--`, resets the
   window and backs off one window (180 s). **But after 2 consecutive `reserve_expired` declines the level is NOT held:**
   a skill that ignores its abort for 20 s twice is itself the wedge evidence, so the watchdog proceeds to level 3, and
   **level 3's reconnect bypasses the reservation** (it needs no runner: `bot.quit`). Level 3 reconnects only when a
   route is computable (watchdog.mjs ~440-452); otherwise it runs `surface` / `mine` through the runner, which a wedged
   skill still holds, and then the release is the runner's hard-stop at 210 s (runner.mjs ~222-236): stated, not fixed
   here. The consecutive-decline counter is its own field and survives the `escalation = 0` resets (watchdog.mjs ~335,
   ~361). Composed test: a never-unwinding
   skill + stagnation → a reconnect within 3 windows. Without the cap, holding the level would remove the one remedy that
   does not need the runner (today 1,628 reconnects a week), and a falling reconnect count would be the defect, not the fix.
5. **The window** is reset when the rescue STARTS (the post-await reset at ~384 is removed), so the next verdict is on the
   rescue's own samples.
6. **The bound on `pending`:** the reservation (≤ 20 s) + the rescue's skill timeout (180 s) + the hard-stop grace (30 s) =
   230 s, after which the runner releases the body and the `finally` clears the flag.
7. **One rescue at a time:** a pending stagnation rescue also holds the stranding rescue, and the reverse.
8. **Every attempt is logged** as a `_watchdog_rescue` row with its fields in `skill.args` (already mapped as flattened,
   logger.mjs ~131-133; no new top-level ES field): `{attempt, level, remedy, phase}`, phase `requested` → `started` |
   `declined:<class>` → a TERMINAL phase: `completed:<status>`, `interrupted:<reason>`, or `reconnected` (the level-3 row,
   written BEFORE `bot.quit`). `started` is written by the runner when the owner's skill begins, so the watchdog does not
   grade itself.
9. **Tests**, all through the REAL `Runner` (not the `async () => {}` fake), each with a mutant seen to fail: unwinds of 2 s
   and > 20 s; a livelock rung trying to start during the reservation (`runner_reserved`, no latch, no cooldown); a `run()`
   suspended at `arb.acquire` when the reservation lands; two `reserve_expired` in a row → level 3 → reconnect; an
   exception in post-run processing (`current` cleared); a rescue moving 1 block per 15 s (not cancelled before its own
   window); a skill that ignores its abort (hard-stop, flag clears); stranding history accumulating while pending.
- This is the CLAUDE.md "Reachable" and "local policy composition" class: the trigger names a remedy and then either
  never runs it or refuses it on its next tick.

### H3 — reflex interruptions filed as skill bugs (225 runs)
- 225 `skill_error` rows carry the raw pathfinder message "The goal was changed before it could be completed!" (206 under
  `interrupt:entombed`, 19 under `interrupt:stuck`; over all 226 `skill_error` rows, median 9.7 s and moved median 5). One more `skill_error` is a raw Timeout.
  The entombment reflex set its own goal mid-walk.
- **The path (corrected in r2, Codex r1 P1-1).** goto's dig-retry re-throw (skills.mjs ~650) sits inside the leg's outer
  try, whose catch (~771) converts an aborted signal into "interrupted: GoalChanged" with `aborted: true`; that path never
  emits the raw message. `home` calls `surface` below sea level, and the climb stage's catch (skills.mjs ~14683,
  `if (e.aborted || signal?.aborted) throw e`) re-throws the RAW error; the runner (runner.mjs ~256) then sees no `aborted`
  mark and files `skill_error`. The rows fit this path; they do not prove every row took it.
- **It is fleet-wide, not a `home` quirk (r5, h12; all pools, 7 d):** 3,660 of 91,313 interrupted runs (4.0%) were filed
  `failed / skill_error`. By skill: `surface` 2,579 of 3,509 (73.5%), `smelt_town` 291 of 388 (75.0%), `home` 265 of 1,421
  (18.7%), `deposit` 225 of 374 (60.2%), `craft` 183 of 1,099 (16.7%), `smelt` 7 of 710, `gather` 18 of 50,363; `goto`,
  `explore` and `mine` 0 (they mark their own aborts). Positive control: the same aggregation finds the 0-rate skills, so
  it separates the two behaviours.
- **Fix, in one place:** the runner classifies any throw while its own controller's signal is aborted as
  `aborted / interrupted`, whatever the error's shape. That covers this path and any other un-marked re-throw, for every
  skill. Behaviour test: a skill that re-throws a raw GoalChanged after `runner.interrupt()` is filed `interrupted`.
  A goto-level test would pass on today's code (a test never seen to fail), so the test is at the runner, with a mutant
  that removes the signal check. The same `if (e?.aborted || signal?.aborted) throw e` shape sits at 20+ sites
  (skills.mjs ~1224, ~1613, ~1760, ~2788, ~3629, …); the runner-level rule covers all of them. **It is not classification
  only:** `skill_error` feeds `consecutiveFailures` and the auto-pause (runner.mjs ~424-426) and the lessons store, so the
  fix also stops interruptions from pausing the bot. Fleet-wide, `skill_error` counts for other skills will fall; the read
  reports that as a classification change, not an effect.

### H4 — real failures (what is left)
`no_path` 144 (end p50 45 from home), `stranded` 92 (all underground, `llm:idle` 79), `goal_changed` 74, `path_budget` 123
(the 25 s per-leg wall). These are the terrain and the deep starts. `home` already calls `surface` once below sea level.
homefix-01 does not touch them; the expedition's breadcrumb return (§6.6) is the remedy for the trip's own path.
- `HOME_BUDGET_MS` is 200 s but the skill timeout is 180 s (skills.mjs:379, config.mjs:182), so a long walk ends as
  `interrupt:timeout` (13 rows) rather than by its own budget. homefix-01 sets the budget under the timeout.
- `home` grades itself inconsistently today: a trip that closed < 16 blocks returns goto's own result (`return last`,
  skills.mjs ~2620-2628), so goto's ≤ 3 success passes through. That is why some successes end at up to 2.7, and why 11
  rows read "arrived … but nothing changed".

### What homefix-01 is worth, and what it is not
- H1 alone, replaying the proposed predicate on every row of the fixed window and keeping the evidence gate: 581 → 803 of
  2,338 (24.9% → 34.3%); on the non-interrupted rows 48.4% → 66.9%. Geometric, static.
- H2 returns a rescue its 180 s. The 741 uninterrupted watchdog rescues succeed 60%; homefix-01's read measures what the
  cut ones do once they are not cut, rather than projecting it.
- **Start positions are a proxy.** A row's `@timestamp` is its start and its snapshot its end (logger.mjs:59); the start
  position used here is the bot's previous row's END snapshot, which can lag or lead the true start. Bands near a boundary
  are approximate.
- It does not make a 600-block walk reliable. Nothing in 7 d measures that: 99 runs started 200-400 out (8 successes), and
  they were mostly stuck bots. §6 treats the return as its own instrumented errand.

---

## 3. Prior art (searched 10-19)

- **mineflayer-pathfinder** #229 "Having any goal outside renderdistance crashes the bot with NoPath"
  (github.com/PrismarineJS/mineflayer-pathfinder/issues/229). The fleet's goto already uses the standard workaround:
  ≤ 45-block `GoalNearXZ` waypoint legs inside loaded chunks.
- **Baritone** (`FEATURES.md`): segmented paths that end at the goal, a timeout, or the render distance, with the next
  segment planned before the current one ends; a 2-bit chunk cache for "very-long-distance pathing". This is the
  argument for **breadcrumbs**: remember where you could stand on the way out, and return through it.
- **Frontier-based exploration** (Yamauchi, CIRA 1997): go to the boundary between known and unknown space. E0's region
  grid is the coarse version.
- **Voyager** (arXiv 2305.16291): an automatic curriculum that maximises exploration; it "travels 2.3× longer distances"
  than prior agents. Its exploration is single-agent and LLM-written; the lesson taken is novelty as a target, not its
  code-generation loop.
- **MineCollab** (arXiv 2504.17950) and **VillagerAgent** (arXiv 2406.05720), already cited by the overseer design:
  assignment pays with a task graph; plans passed in chat cost ≈ 15%. An expedition is not a task graph, so no foreman.
- **minecraft.wiki** (fetched 10-19): rails are 6 iron + 1 stick → 16; powered rails are gold + stick + redstone → 6; a
  rider "can slowly move the minecart forward at about 8 blocks per second" by pressing forward; minecarts freeze more than
  a chunk beyond the simulation distance of the nearest player. The riding claim is unproven for a mineflayer client
  (`bot.moveVehicle` → `player_input` on 1.21.6+, mineflayer 4.37.1 `entities.js:859`): R0b is a Paper proof.
- No mineflayer issue or forum thread found on multi-hundred-block round trips by bots, or on minecart riding by bots.

---

## 4. E0 — the frontier census (host-side, read-only, no canary slot; build now)

**What it is.** A `staffcensus.py`-style host job (cron 5 min, fixture self-test first, heartbeat; a stale heartbeat reads
VOID, never zero). Per shared town:
1. **Visit map.** A 64 × 64 region grid out to 1,000 from home, inside the border minus 64. From ES: every skill row's end
   position (not 5-min samples, which miss passing visits), folded per region: last observed visit and bot-minutes.
2. **Frontier, stated as what it is (Codex r1 P2-6).** A region is "not observed visited" when no row in the COVERED
   window ended in it. That is not "unvisited", and not "reachable":
   - **Coverage.** The window starts 10-08 00:00Z (10-07 holds filebeat re-sends and `estelemetry` refuses it), so on
     10-19 it is 11.5 days, not 14; each day's coverage is checked by row counts per bot-day against the fleet median,
     and a day below 80% marks every region "unknown", never "unvisited".
   - **Warm-up.** The frontier file is written only after 48 h of live ticks with the self-test passed.
   - **Reachability** is unknown until a trip tries; a region whose trip turned back for "no route" twice is marked
     `unreached` and skipped for 7 days.
   - Ranked by distance and by bearing away from spawn (explore's existing preference).
3. **Hazard overlay.** Death sites from `world-facts-<pool>.json` `sites` and the `_death` rows; a region within 32 of a
   death in 7 d is marked. **Water is not visible from positions alone** (an ocean region and an unscanned forest look the
   same): a region is labelled by its `_region_scan` (water / land counts) once a trip has scanned it, and by the
   `perception.blocks.water` counts of rows that ended near it; until then it is "unknown", ranked after scanned land.
4. **Baselines the expedition read needs:** log and ore per gather body-hour by band (§1.2, rolling), deaths per bot-hour
   by band, `home` success by start band and trigger (as §2), and bag-eligibility per town-hour (§1.3).

**Output.** `/var/lib/mcai/_pool-<pool>/frontier-<home>.json`, a generation file written atomically (the blueprint
`link()` protocol), plus a daily text. Nothing reads it until expedition-01.

**Why first.** It fixes the denominators before the design is coded (the 200-300 band's 15.5% log success, the ore hint),
and the expedition's target rule (§6.4) needs it. It costs no slot and touches no bot.

**Positive controls.** A fixture world with a known path and known visits; live, the census's region and band reader,
  run on hourly latest-per-bot samples (the §1.1 estimator itself, not the row-end fold), must reproduce §1.1's band shares
  within 2 points over the same window; and the row-end fold must find every region the hourly samples found.

---

## 5. E1 — homefix-01 (tier 3 under gate v36; the first step)

**What changes (each an exported pure function or a single decision point with a behaviour test and a mutant):**
1. **H1:** `arrivedAt(pos, target, range)`, goto's existing final test, used by `home`'s grading (not goto's loop break).
   The arrival point is `config.world` home, which is the point the ES replay used (the `town-chest-<home>` key).
2. **H2:** the contract in §2 "The H2 fix": pending from the verdict, cancel-and-reserve, `current` always cleared, the
   level held and backed off on a declined rescue, the window reset at rescue start, attempt rows.
3. **H3:** the runner files any throw under its own aborted signal as `aborted / interrupted` (§2 H3).
4. **The home budget:** `home` passes its remaining budget into each nested goto and `surface` call (an `until`, as
   `deposit` already takes one), and `HOME_BUDGET_MS` sits under the skill timeout (170 s), so `home` ends on its own
   budget with its honest partial credit (Codex r2 and Claude r2 P3: one goto can run ≈ 145 s, so the constant alone is
   not enough).

**Refusal chain (CLAUDE.md).** homefix-01 adds one declined class, `runner_reserved`, which is a "not now" to every caller
except the reserving watchdog, lasts ≤ 20 s, and is in the one exported declined set that every outcome handler imports
(§2 item 2), so nothing counts it as a failure, a cooldown, a latch or a lesson.
Its remedy is the caller's next decision. H2 changes which remedy runs: a rescue that is genuinely stuck is still judged on
its own window (≤ 230 s later) and escalates as today. Composed test: watchdog + `home` + an entombment reflex firing
mid-walk → the reflex holds the body, home is interrupted and filed `interrupted`, the watchdog does not escalate during
the pending rescue, and escalates on the rescue's own window if the bot then stays put.

**Paper scenes.**
- P0: a skill that takes 2 s (and one that takes 20 s) to unwind after abort, a livelock rung trying to start in between,
  then a stagnation verdict → the rescue starts (or is declined once and backed off), and `_watchdog_rescue` rows exist.
- P1: a bot 3 blocks from an occupied home cell (chests at the home point) → `home` success.
- P2: a bot boxed in so it moves ≈ 1 block per 15 s → no cancel before the rescue's own window; then escalation 3.
- P3: an entombment reflex during `home` below sea level (through `surface`) → `interrupted`, not `skill_error`.

**Read: TIER 3 (r6; Claude r5 P2-1).** Gate v36 (installed 16:27Z, STATE on origin/main; docs/reports/canary-tiers-2026-10-19.md)
lets a tier-2 run KEEP only at +180 with exactly 4 pools, and says "runs needing long reads should register tier 3".
homefix-01 needs a long read (below), so it registers tier 3 (no `"tier"` field). Tier-3 draws are not guaranteed 4 pools
(recent ones drew 2), so the read is planned for both arm sizes. KEEP rests on DETERMINISTIC per-mechanism checks in the arm (the owner's 09-29 rule: fixes get a
correctness gate). **Each gate is "0 defects in ≥ D opportunities"**, and D is set so that the chance of seeing 0 defects
WITHOUT the fix is ≤ 5%, from the pre-fix defect rate p: D = ⌈ln 0.05 / ln(1 − p)⌉ (Claude r2 N-5, Claude r3 P2-C). The
read extends (+360, +540) until every gate has its D, and is INCONCLUSIVE at +540 if one does not (the owner's 10-15
early-close rule; for tier 3 the deadline is the registration's). **Read length (h13).** G1 is the slowest gate. With
G1 on the H1 band (below): 1.43 opportunities per 3 h at 20 bots, so P(D = 2 reached) = 0.42 / 0.78 / 0.93 by +180 / +360 /
+540; at 10 bots 0.16 / 0.42 / 0.63, and 0.93 by +1080. So the read is registered to +540 at 4 pools and +1080 at 2
pools (≈ 9 h or ≈ 18 h). G2 ≈ 22 opportunities per 3 h at 20 bots; G3 and G4 ≈ 180 attempts per 3 h.

| gate | opportunity (denominator) | defect | pre-fix p | D |
|---|---|---|---:|---:|
| G1 arrival | an arm `home` row, trigger NOT `interrupt:*`, that moved ≥ 2 blocks and ended in the H1 BAND: more than 2 and at most 3 horizontally, |dy| ≤ 6 (r6, Claude r5) | graded anything but success | h13: 224 / 240 = 93.3% | 2 |
| G2 classification | an arm `home` or `surface` row whose run was interrupted (`interrupt:*` trigger): the skills on the raw re-throw path | status `failed / skill_error` | pooled `home` ∪ `surface`, all pools, h12: 2,844 / 4,930 = 57.7% (formula D = 4; 5 is an added floor, and the read recomputes P(0 \| no fix) from the arm's own `home` / `surface` mix: an all-`home` arm at 18.7% needs D = 15) | 5, or the mix's D if larger |
| G3 rescue survives | a `_watchdog_rescue` attempt with phase `started`, joined to the runner's skill row (bot, start ±1 s), during which at least one watchdog tick landed (the `pending` tick writes `tick_seen` with the attempt id), OR that was cut by a stagnation cancel at any age | **by mechanism (r6, Claude r5 P3-5):** that skill row ended `interrupt:stagnation` from a verdict whose window held a sample from BEFORE the rescue started (the `_stagnation` row logs its window's first-sample time in `skill.args.window_from`); the old-code proxy uses < 150 s, not 165 s, because the earliest legitimate verdict on the rescue's own window lands ≈ 165 s after its start | proxy: 534 / 1,565 = 34% (on the old denominator; re-measured on the new one by the fixture-validated reader) | 8 |
| G4 rescue reachable | a `_watchdog_rescue` attempt with phase `requested` | no TERMINAL phase (`completed:*`, `interrupted:*`, `reconnected`, `declined:*`); or `declined:reserve_expired` > 8% of attempts | unwinds > 20 s: 958 / 23,234 = 4.1% (h12); the bar is 2× that, an engineering threshold, not the D formula | 20 |

- **G1 excludes interrupted runs**: a legitimate reflex interruption is not an arrival grading (Codex r3). h9 shows no
  aborted row ending inside 3 h / 6 v (Claude r3), so the filter loses nothing. **The band is the mechanism:** of 240
  pre-fix opportunities in (2, 3], 224 were graded failed; rows ending within 2 are successes today and are not evidence
  either way, so including them only slowed the gate (r5's D = 10 on 803 rows; h13).
- **G3 counts rescues only.** A brain `home` or `goto` cut by a legitimate verdict has no attempt record and is not an
  opportunity (Claude r2 N-1). **Duration does not filter it (Codex r4):** a rescue that starts 10 s after a slow unwind
  and is cut 5 s later is a defect, so every stagnation cut of a started rescue counts; fixtures include a delayed handoff
  and a cut before 10 s.
- **G4's rate bar counts only `reserve_expired`** (Claude r4 P2-2): `body_held` (a reflex legitimately holding the body)
  and `runner_paused` are reported with their rates but not barred, because their pre-fix rates are unmeasured (the fleet
  logs no arbiter-refusal row; h12's query for one found none, with near-miss kinds present).
- **G4 is not self-graded:** `started` is written by the runner; a reconnect has its own terminal phase `reconnected`,
  written before `bot.quit` (Claude r3 P2-C); `started` alone is not terminal (Codex r3). Each attempt id is reconciled
  individually; attempts requested < 230 s before the read boundary are excluded.
- **Positive controls, named for what they are (Codex r3 P1-1, Claude r3 P2-C).**
  - G1, G2: the SAME reader finds the defect on the arm's own 24 h pre-period (old code: G1 ≈ 32 a day in the shared
    towns, ≈ 48 in all pools; G2 ≈ 406 a day in `home` ∪ `surface`, all pools, h12).
  - G3: old code writes no attempt rows, so the new reader cannot run on the pre-period. Its control is in two parts:
    (a) a HISTORICAL PROXY reader (watchdog-origin rows: a skill row starting ≤ 30 s after an escalation event, cut by
    `interrupt:stagnation` < 165 s) must find the defect on the pre-period; (b) the NEW reader must pass a known-good
    fixture log and fail a known-defective one (a rescue cut at 15 s).
  - G4: fixtures only (an attempt with no terminal row; a reconnect with its row; a declined attempt) — old code has no
    rows, and "rows absent on control" is not a positive control.
  - Any gate whose control fails is VOID, not passed.
- **Guards (DiD, not decisive):** deaths (two-death floor) and deaths within 120 s after a `_watchdog_rescue` start;
  `_stranded` per bot-hour; stagnation level-1 events per bot-hour; `_stagnation_reconnect` per bot-hour (reported, not
  "expected to fall": item 4 of the H2 contract keeps the reconnect for wedged skills); relocation outcomes (H2a turns on
  ≥ 7.6k level-1 relocations a week that never started before: random 45-70 block walks, which must not raise deaths or
  strandings); `home` success, all rows and S0's filter (reported).

**Owner rule (Claude r2 N-10).** The owner said on 09-30: no more stuck / drowning hunts; tripwires only; work the
production chain. homefix-01 is a stuck-rescue change, so it needs the owner to lift that rule for this fix (X1). The case:
it is not a hunt but three measured defects in code that already runs ≈ 39k escalations a week, and it is the shared
prerequisite of expansion and the foreman's RECALL.

**Dependencies.** None in flight. It also serves the overseer's RECALL gate (S0 measures `home` success).

---

## 6. E2 — expedition-01 (tier 3)

### 6.1 What it is
A bounded errand by **one bot per shared town at a time**: kit up at town → walk out 300-800 blocks on the surface to a
frontier region → scan and gather there → walk back along its own breadcrumbs → **bank the haul at town** (later, at an
outpost first). Deterministic: a town job with its own order, lease and persistent trip state; not a brain choice, not
advice.

### 6.2 Who goes, the state that carries the trip, and its phases
- **One per town** (12 towns, ≤ 12 bots fleet-wide: 20% of the 60 shared-town bots, 15% of the fleet).
- **Three separate pieces of state (r2-r3; Codex r1 P1-2, Codex r2 P1-1/P1-2):**
  - **Ownership** — `expedition-<home>.lease.json`, the treefarm/plinth lease pattern: one holder, a 10-minute TTL renewed
    only by PROGRESS (a breadcrumb gained outbound, one regained on the return, a gather success at the region). It fences
    two bots from both going. It is never what keeps a trip alive, and its expiry never changes a phase.
  - **The trip deadline** — absolute, written at departure: work ends at +45 min, the bot should be home by +90 min.
    Renewal never moves it.
  - **The trip state** — `expedition-trip-<bot>.json` in the pool state dir (survives a restart): the trail, the phase, the
    deadline, the haul counted at departure and at work end. It is the bot's, not the lease's.
- **Phases, and the only transitions (r3):**

  | phase | entered when | leaves to | on |
  |---|---|---|---|
  | `kit` | selected at town | `out` / closed `skip` | kit complete with ≥ 16 free (§6.3) / kit refused |
  | `out` | kit done | `work` / `return` | arrival at the region / any turn-back rule, the deadline, revocation |
  | `work` | arrival | `return` | any turn-back rule, the work deadline, revocation |
  | `return` | from `out`, `work`, `stranded`, `contained` | `bank` / `stranded` | arrival (home's predicate) / §6.7 step 4 |
  | `stranded` | three failed return rounds | `return` / `contained` / `bank` | a return leg that makes PROGRESS (only that; not the lease, not the deadline) / escape resources gone (§6.7 step 5) / arrival |
  | `contained` | stranded with no scaffold, no usable pickaxe and the escape chain unable to run (§6.7 step 5) | `return` / `bank` | any progress (a reflex, a watchdog rescue) / arrival |
  | `bank` | arrival at town, from ANY phase | closed `done` | `expedition_bank` finished: banked, or ANY refusal class (each logged with what stayed unbanked; below) |

  **Arrival is checked on every decision in every phase AFTER DEPARTURE** (Claude r3, Codex r3): a watchdog `home`
  (watchdog.mjs:411) or a reflex can put a `stranded` or `contained` bot at home without a progressing return leg, and that
  is an arrival. **Departure guard (Codex r4):** the trip file carries `departed`, set the first time the bot is more than
  48 from home; before it, arrival is never reconciled (a bot selected at the home point is still in `kit` / `out`). An
  `out` that has not departed within 15 min closes `skip:no_departure`. Tests: selection and restart at the exact home
  point; the first outbound decision.

  The trip file is deleted only at `done`, `skip`, the bot's death (world spawn is set at town, place-town.py:524, so a
  respawn is at home; the haul is lost and counted), or an operator `closed`. **A town with a trip file sends no one.**
  A trip file older than 6 h pages the operator (`_expedition_overdue`) and still blocks.
- **Where the trip's order ranks (Claude r2 N-6).** `orderFor(ready)` (the milestone ladder) is first in the decision
  chain (cognitive.mjs ~900), and the plinth and town-deposit orders are placed ahead of it on purpose (the comment at
  ~905-908). The trip order (`kit`, `out`, `work`, `return`, `stranded`'s and `contained`'s retries, `bank`) goes **ahead of
  all of them**, below only the reflexes and the arbiter: it is assigned LAST in the chain, after the town recount's
  override at ~917, so nothing later replaces it (Codex r3). **Trip skills bypass the admission gate, and that bypass
  is NEW code** (r5, Codex r4 6, Claude r4 P2-7): `rescue: true` (skills.mjs:14852) only suppresses `lessons.recordFailure`
  and purges avoid entries (lessons.mjs ~217, ~503); `home` is NOT exempt from the cooldown (admission.mjs ~575-583) or
  `repeat_loop` (~754-756), and work orders ARE vetted (cognitive.mjs ~878). So the trip order dispatches its skills
  through an admission path keyed on the live trip file and the order's trip id: no cooldown, no `repeat_loop`, no
  `noteFailure`, so repeated rejections can never reach the livelock breaker (~1409-1421) and its random 25-60-block
  relocation off the trail. Test: a re-issued failed return leg through the REAL admission controller. While a trip file exists:
  - a milestone `mine` order is withheld (X3: no staircase on a trip), and a craft-ready rung's craft is withheld unless
    the trip itself needs it (none in v1: the escape is the spare pickaxe, §6.7);
  - a room order's remedies (`deposit`, `home`) are answered by the trip: the remedy named is "the trip's return", and it
    runs;
  - town jobs are skipped by an absent bot as today (they are town-gated).
  - Tests: a craft-ready rung during `out`; a milestone `mine` order during `work`; a 36/36 bag during `return`; a town
    recount due during `kit`; a re-issued failed return leg (no cooldown, no breaker); restarts in `kit`, `contained` and
    a failed `bank`.
- **Eligible bot** (pure `expeditionEligible(readings)`, re-checked fresh at departure): health ≥ 18; no trap, drowning or
  low-health flag in 10 min; no other lease (builder, furnace, farm); inside the town zone (16 h / 12 v); not the town's
  last bot at town (≥ 1 other stays for town jobs). Selection among eligible bots: the most free slots after a dry run of
  the kit (§6.3); ties by name rotation. Cadence: next departure ≥ 30 min after the last `done`. Peaceful: no day/night
  rule.

### 6.3 The kit and the bank: two new entry points with explicit contracts (Claude r1 P2-8, Codex r2 P2-6, Claude r2 N-8/N-9)
`town_deposit` today fires only at ≥ 34 slots (towndeposit.mjs:38, 262; `TD_TRIGGER_SLOTS` = hygiene's 34), only inside
16 h / 12 v of home (towndeposit.mjs:40-41, 84); its plan (`townDepositPlan`, ~150) takes no keep set; its keeps hold the
stockpile rungs (wood and the cobble family to 64), the iron ladder's inputs and the best usable copy of each tool NAME
(~100-137, 165-174). Neither entry point below changes `town_deposit`.

**The policy must reach BOTH planner layers (r4; Codex r3 P2-2, Claude r3 P1-B).** `townDepositPlan` first takes its
allowance from `depositPlan` → `bankableInventory` (towndeposit.mjs ~159; bankable.mjs ~252-375), which on its own keeps 64
cobble (`COBBLE_RESERVE`, bankable.mjs ~75, 84-95), re-applies the stockpile keeps for targeted groups through the
registered `townKeeps` callback (towndeposit.mjs ~126; bankable.mjs ~293-296, 359-361), keeps one usable copy per tool
NAME (`last_of_tool_family`, ~326), caps each name at 64 per visit, and never banks what is `not_wanted` (only oak, birch
and jungle logs are standing targets, ~40-43, so spruce, acacia, dark oak, cherry and mangrove logs, non-oak planks,
andesite, diorite and dirt never move) or ballast (saplings), nor swords in peaceful. A probe of the real functions
(Claude r3, scratch copy) freed 3 slots of a 21-slot bag. **Lowering only the final keep map cannot restore an allowance
removed upstream.** So both entry points pass ONE per-call policy object through `townDepositPlan`, `depositPlan` /
`bankableInventory`, and the well's plan; with no policy passed, every layer behaves exactly as today (a property test:
the default policy reproduces today's plans on random bags).

**`expedition_kit`** (phase `kit`; inside the town zone):
- **Minimum kit, present after the step or the trip does not go:** 1 pickaxe with ≥ 40% uses, **a spare pickaxe** (stone or
  better, ≥ 50% uses; the escape remedy, §6.7), 1 axe, **64 scaffold blocks** (one stack, cobble family or dirt: 32 is the
  fixed emergency reserve and 32 the descent budget, §6.5), torches if held. (r5 drops r4's 3 escape logs and table: the
  pathfinder's `getScaffoldingItem` places logs before mossy cobble, and the reflexes' `PLACEABLE` / `pickScaffold` and
  `rescueBlocks` list `_log` too, so the wood would be placed as scaffold before it was ever needed; Codex r4 probe, Claude
  r4 P2-5. A spare pickaxe is unplaceable, needs no table cell, no free slot and no craft chain.) A missing item is
  withdrawn from town containers by the existing withdraw / toolkit paths if it can be, else the trip closes
  `skip:kit:<item>` (no refusal of anything else; the bot continues its normal order and the next eligible bot is tried
  next tick).
- **The kit policy** REPLACES, in every layer: the stockpile keeps (wood 64 → 0; cobble 64 and `COBBLE_RESERVE` → the 64
  scaffold), the per-name tool rule (the best pickaxe, the spare and one axe ACROSS materials; other usable tools are
  banked; spent copies stay for wear-out), and `not_wanted` for all eight log species (towndeposit.mjs's own `LOGS`) and
  their planks. It PRESERVES: the iron ladder's inputs (no new iron policy; cobblekeep-01's coal and raw-iron rule applies
  if it is KEPT first), food, the withdraw hold, whole-stack moves, ballast (the well takes it) and the per-visit credit
  cap (a kit may take two visits, two containers).
- What the cobble cap refuses goes to the well (cobblekeep-01's path), never a new chest.
- **Departs only with ≥ 16 free slots.**
- **The kit's yield is NOT yet measured (r4 withdrew r3's "98%"). Gate K0, before expedition-01 is queued (r5; Codex r4
  P2-2, Claude r4 P2-6):**
  - **Real slots, from the server (r6; Codex r5 P2, Claude r5 P3-3).** ES holds per-item COUNTS (`inventorySummary` sums
    slots, state.mjs:8-13), and no layout rebuilt from counts is a bound (64 coal can be one stack or four of 16; r5's
    "+1 partial per name" was neither a minimum nor a maximum). So K0 reads each bot's actual slots from the server with
    the read-only RCON query `data get entity <bot> Inventory` (slot, id, count), the query `scripts/fleet-inventory.sh`
    and `observe-fleet.py` already run (multi-packet RCON read handled there), sampled when the bot is inside the town
    zone, ≥ 2 samples per bot over 24 h. A bot whose read fails or is truncated is UNKNOWN, never a pass. **Positive
    control:** the read's slot count must match the `slots=a->b` the bot's own `town_deposit` / `room_order` rows logged
    within 60 s of it (a reader that returned empty bags would fail this).
  - **The real planner, with the town's state installed:** the per-town stock readers (`STOCK_TOWN`, `STOCK_WELL`,
    `COBBLE_TOWN`; bankable.mjs ~105-154) loaded from that town's reconciled stock at the snapshot's time, or, where the
    stock is unknown, every target assumed AT its cap (the pessimistic side); destination capacity from the town census
    (free container slots) and the per-visit cap.
  - **Two failure causes reported apart:** ROOM (the kit policy cannot reach 16 free) and KIT AVAILABILITY (no second
    pickaxe or axe in bag or town). e3 found a pickaxe at ≥ 40% in 68.6% of snapshots and an axe in 82.2%; a spare is
    rarer, and a well / compost / wear-out step cannot fix availability, so the two have different remedies.
  - Pass: ≥ 50% of the sampled at-town bags (circular 16 h / 12 v zone, real slots, UNKNOWN excluded from the numerator
    and counted in the denominator) reach 16 free slots under the kit policy AND ≥ 50% of town-hours have a complete kit
    available. If ROOM fails, the kit gains a well / compost / wear-out step
    inside it, re-replayed; if AVAILABILITY fails, the kit asks the toolkit job for a spare (stone pickaxes cost cobble and
    sticks, which towns hold) before any canary.

**`expedition_bank`** (phase `bank`; inside the town zone; ANY slot count):
- The kit policy, minus the kit's own items: the haul's logs of every species, ores, raw metals and the scaffold above the
  64 are bankable; the iron ladder is preserved as in the kit.
- **Every refusal class ends the phase** (Codex r3): town containers full → the existing full-town recovery once; if that
  recovery itself refuses (no site, no chest to craft; skills.mjs ~3908-3946) or a container path fails twice → `done`
  with `_expedition_bank unbanked:<items>` (the haul stays in the bag, where `town_deposit` takes it at 34). No dead end:
  the bot is at town, where every town job is available.
- The trip's **haul** (bag delta of logs and ores between departure and arrival) is logged on `done`, banked or not.

### 6.4 How a target is chosen
- **From E0's frontier file:** the nearest region in the 300-800 ring that is **not observed visited** (§4), preferring
  the bearing away from the world origin (explore's preference); never a region within 32 of a death in 7 d; never
  within 64 of the border; never one marked `unreached`.
- **Scouting is part of the trip.** At the region the bot runs a bounded scan of loaded chunks (logs, iron/copper/coal ore
  visible within 12 below its feet, water and lava counts) and writes a `_region_scan` row. E0 folds the scans, so the next
  trip can prefer a region scanned rich over an unscanned one (score = scanned logs + ore, decayed by age).
- **The first trip from a town** goes to 300; each `done` trip may step the ring out by 100 to 800. A trip not home by its
  deadline, or a death, steps it back by 100.

### 6.5 Safety: bounded-risk surface travel (X3), checked BEFORE each step (Codex r2 P2-7)
- **Never sent** while trapped, drowning, low on health or without the kit (§6.2-6.3). Peaceful: no mobs; hunger
  regenerates.
- **Not a guarantee (Codex r1 P2-4).** `GoalNearXZ` does not constrain elevation, and goto can retry a leg with digging or
  a larger drop. So "surface" is a set of limits:
  - **the limits live in the MOVEMENT PROFILE, so every plan and every re-plan obeys them (r4-r5; Codex r3 P2-6, Codex r4
    P2-5, Claude r3 P2-D, Claude r4 P2-4).** A one-shot `getPathTo` pre-check does not hold: it returns `partial` for
    distant goals (index.js ~63-68), goto starts its own search (skills.mjs ~500), retries under the ascent profile
    (~626-635), and the pathfinder re-plans while walking (index.js ~466). Four things make the profile actually govern:
    1. **It is the BASE profile while a trip is live.** goto's first statement `bot.assertNav('goto')` (skills.mjs:426)
       fingerprints the movements (incl. `maxDropDown`, index.mjs ~849) and re-installs the fixed walking `moves` on any
       difference, and every movement wrapper restores the fixed `moves` in its `finally` (index.mjs ~639-795); only
       index.mjs may call `setMovements` (the dep-contract test). So index.mjs gains one accessor, `baseMovements()`,
       which returns the trip profile while the bot's trip is in `out` through `contained` (never in `kit` or `bank`, so
       walks to roofed town containers are not refused by the sky-light rule) and the fixed `moves` otherwise; `assertNav` and
       every wrapper's restore use it. The trip profile has its OWN exclusion arrays (the shaft design's T10 lesson:
       `exclusionAreasStep` is shared by reference otherwise).
    2. **The DESTINATION of every move is checked.** `getMoveDropDown` checks exclusions only on the cells beside the
       departure and emits its landing unchecked, and `getMoveDown` likewise (movements.js ~475-520; Codex r4 probe: a
       limit of y ≥ 9 still emitted a landing at y = 8). So the trip profile is a subclass whose `getNeighbors` drops any
       emitted move whose destination is more than 12 below the departure level or whose head cell has **sky light 0**
       (underground; sky light passes leaves, so forest floors stay open where the logs are), for every enabled move type.
       `maxDropDown` = 3, and `infiniteLiquidDropdownDistance` (default true, movements.js ~108) = false. `getMoveDown`'s
       liquid landings ignore that flag, so for water the bound is the destination filter's 12-below rule, not the drop
       limit (Claude r5 P3-8). The wrappers that install their own profiles DURING a call (ascent, gather, water) get trip
       variants carrying the same `getNeighbors` filter while a trip is live, and the `work` phase's gathers use a trip
       copy of `gatherMoves` (canDig, but the same destination filter and `maxDropDown` 3) (Codex r5 P3-2, Claude r5 P3-7).
    3. **No descent outside the profile.** goto's float dig and the `rideFloorDown` last rung (skills.mjs ~600-720)
       descend without any Movements; both are OFF while a trip is live (their remedy on a trip is the return chain).
    4. **Pre-commit debt.** Every `path_update` the pathfinder emits (initial plan and each re-plan) is read before the bot
       moves on it: if the planned path's one-way descents (steps down of 2-3 blocks) plus the debt already taken would
       exceed the budget, the leg is refused before the first such step. **A `setGoal(null)` inside the listener does not
       do it:** pathfinder index.js ~466-470 emits `path_update` and THEN assigns `path = results.path`, so the stop is
       overwritten (Claude r5 probe: goal null, still moving, forward control on for 6 ticks). The veto is a deferred stop
       (`queueMicrotask` → `haltPath`) plus a check before the first move, tested through the real pathfinder on initial
       and partial-search updates. (The fleet's LAVA GUARD 1, index.mjs ~962, uses the same in-listener pattern; it is
       flagged separately.)
  - **return debt** = the one-way descents taken; **budget** = the 64 scaffold carried − the **fixed emergency reserve** of
    32, so up to 32 blocks of one-way descent per trip; the pickaxes must keep uses ≥ 2 × debt + 20. Checked pre-commit (item
    4), at every leg end, and continuously during `work` (gathering spends scaffold and pickaxe uses): debt reaching the
    budget, or uses falling below the line, is a turn-back rule;
  - **Sky light, with a positive control (Claude r4 P3).** `block.skyLight` is populated by prismarine-chunk from the
    server's light data (ChunkColumn.js ~118; mineflayer blocks.js ~57-62, 263-273). A parser that always returned 15 would
    silently disable the rule, so the Paper world asserts a known cave cell reads 0 and open sky reads 15 before any trip
    scene runs; and E0 counts, on the X-P1 world, how often the rule fires on surface walks;
  - outbound legs run with goto's **larger-drop retry OFF** (a 7-block drop cannot be climbed without scaffold);
  - if a leg nevertheless ends below the 12-block limit or with sky light 0 (a fall, a reflex), the bot goes back to its
    last breadcrumb before trying a new bearing;
  - no `mine` staircase on the trip; ore only by `gather` within 12 below the arrival level;
  - today's lava corridor guard (`lavaguard`), death-site pricing (`deathsites.mjs`) and blind-step guards, unchanged.
  This keeps the owner's diamond hold and the underground-safety order intact.
- **Water is terrain** (owner standing rule): swimming is travel; the only water reflex is air.
- **Falls** are the outer bands' main death beyond 200 (13 of 21, §1.2). The return keeps goto's larger-drop retry
  (health ≥ 18, skills.mjs ~700): going down on the way home is the cheap direction.
- **Hazard turn-back:** two hazard reflexes (drowning, lava, entombed, fall damage) on one trip → `return`.

### 6.6 Breadcrumbs, the return, and turning back
- **Breadcrumbs.** Every ≈ 32 blocks walked out, the bot records the standable cell it stands on (feet in air, solid below,
  no liquid), the leg's dy and its one-way descent. The trail lives in the trip state.
- **Return** walks the trail backwards, one breadcrumb per leg (`GoalNear` range 2 on a cell it has stood on). Standing on
  a cell proves it existed, not that the reverse leg is walkable: a one-way leg is climbed with the reserved scaffold (the
  existing ascent profile), and §6.7 is the chain when a leg still fails. The last leg is `home`; arrival is home's
  predicate (H1), then phase `bank`.
- **Turn back (→ `return`) on the first of:** bag ≥ 30 slots; 15 min of work at the region; the work deadline (+45 min);
  health < 14; two hazard reflexes; scaffold or pickaxe uses below return debt + reserve; three consecutive refused or
  failed outbound legs; the border margin; the operator's `revoke` file.
- **A full bag is not a dead end (Codex r2, Claude r2 N-7).** There is no remote ballast shed: hygiene's step at 34 is
  `wear_out` of spent tools (hygiene.mjs:9-17, 49-66), composting and the well are town orders. None is needed: walking
  needs no free slot, pickups simply stop, and the return is the remedy. X-P4 tests a 36/36 return that includes a
  scaffold climb (the scaffold is in the bag already).
- **The bag at the far end is never "advice".** `deposit`'s admission is conditional (`farFromBank`, skills.mjs:5450,
  measures from the world origin and looks for a usable chest within 48), and the `deposit` skill itself walks `home`
  first (skills.mjs ~2723). Both are withheld while a trip file exists (§6.2): the return phase runs instead.

### 6.7 What to do when lost, and when contained
"Lost" here means no route, never unknown coordinates (the bot always knows x, z).
1. A breadcrumb leg fails → try the next breadcrumb (skip one), then the one after.
2. Then direct `GoalNearXZ` legs toward home at the bearing ±30°.
3. Below sea level, or under a ceiling → `surface` once (home's existing repair; it climbs with scaffold).
4. Still no progress after 3 rounds → phase `stranded`. The bot works locally (gather) between attempts; the return order
   re-fires every 10 min from step 1 with the trail re-read; only a return leg that makes progress leaves `stranded`.
5. **Scaffold spent or pickaxe broken: the spare pickaxe and `surface` (r5; Codex r2 P1-1, Codex r3 P2-4, Claude r4
   P2-5).** A pickaxe digs stone, and dug stone drops cobble, which is scaffold; `surface` (home's existing repair) already
   climbs by digging a staircase up. So the escape needs only a working pickaxe, and the kit carries two. The trip order,
   in `stranded`, equips the spare when the first is spent and re-arms step 3. **`surface` aims at sea level and refuses
   `already_surfaced` at y ≥ 63 (skills.mjs ~14565-14577), and surface trips strand mostly above 63**, so the trip calls
   it with the existing internal `_toY` set to the LAST BREADCRUMB's level (as `mine` already does, skills.mjs ~11978).
   Its no-route branch `shaftAscend` pillars with placed blocks and stops at "no scaffold blocks left" (~14300): the
   scaffold stack, once partly spent, has room for the cobble the climb digs even in a 36/36 bag, and the 32-block
   emergency reserve is that stack's floor. It is an order, not advice, and it runs
   through the trip's admission path (§6.2).
   - **When it cannot run:** both pickaxes spent (the uses line in §6.5 keeps them ≥ 2 × debt + 20, so this needs the
     line to fail), walls a stone pickaxe cannot break (obsidian, bedrock), or `surface` refusing from where the bot is →
     phase **`contained`**: counted (`_expedition_contained`), the town's fence kept, the operator paged at 6 h, the
     return re-tried on any progress or arrival. It is an ACCEPTED outcome of v1 that the read gates on (§6.10), not a
     recovery this plan claims; the profile limits (§6.5) exist to keep it rare.
6. The lease's TTL lapses (no progress) but changes no phase; the trip file keeps the town's fence. The watchdog keeps
   running throughout; with homefix-01 its rescue gets its full window, and its level-3 `surface` / `mine` branch
   (watchdog.mjs ~496-503) is a rescue of a stuck bot after which the trip order re-plans from the nearest breadcrumb.

### 6.8 Interaction with the "go home" problem
- The trip does not depend on `home` except for the final ≤ 32 blocks, which are inside the band where healthy-surface
  `home` succeeds (and homefix-01's H1 is exactly that leg).
- **The watchdog and a trip (Claude r1 P3).** A walking bot is not stagnant (it moves ≥ 8 blocks per window), so the
  watchdog fires only when a trip is already stuck. Then, after homefix-01: level 1's random 45-70-block relocation may
  take the bot off the trail, and the trip re-plans from the nearest breadcrumb; level 2's `home` is the return's own
  destination; level 3's reconnect restarts the bot, which resumes from the trip state. Before homefix-01 many of those
  rescues never start (H2a) or are cut at 15 s (H2b), which is why homefix-01 comes first.
- RECALL (the overseer) and expeditions share homefix-01; neither shares an instrument with the other.

### 6.9 Paper tests
- X-P1: a 400-block route across a river, a 6-block drop and a lava pool → kit, out, scan, gather, back along the trail,
  `expedition_bank` at 22 slots (below `town_deposit`'s 34), `done`.
- X-P2: a breadcrumb blocked after departure (a placed block) → skip, then direct legs.
- X-P3: kill / disconnect mid-trip, and again in phase `bank` → restart resumes from the trip state; lease TTL lapse
  changes no phase.
- X-P4: bag fills at the far end → `return` → a 36/36 return including a scaffold climb → `bank`.
- X-P5: target region at the border margin → refused at selection, not on the way.
- X-P6 (composed refusal chain), **above y = 63**: a bot below an irreversible 7-block drop, scaffold down to its
  reserve and the first pickaxe broken, 36/36 bag → it equips the spare, `surface` with `_toY` = the last breadcrumb's
  level climbs out, it returns. Variants: both pickaxes spent; walled in
  obsidian → `contained`, the town sends no second bot, the overdue page fires; then a watchdog `home` that happens to
  succeed → `bank` (arrival from `contained`).
- X-P6b: a mixed-material bag (mossy cobble, logs, dirt) whose cobble runs out mid-climb → the pickaxes are never placed or
  dropped, and the climb continues on dug stone.
- X-P7: revocation mid-outbound → `return`; revocation never strands.
- X-P8: two eligible bots at departure time → exactly one lease; the other continues its normal order.
- X-P9: repeated failed return legs → `stranded`, the order re-fires each 10 min, the lease never renews without
  progress, and lease expiry does not reset `stranded` to `return`.
- X-P10: a leg whose planned path dips 14 below the departure level → refused before the first move; another bearing.
- X-P11: during `out`, a craft-ready rung and a milestone `mine` order → both withheld; the trip order runs.

### 6.10 Read and metric (tier 3; unit = the town; 4 drawn shared towns = 20 bots, randomized; DiD)
- **Primary (r4, Claude r3 P2-F):** logs (all eight species) + ore (raw iron, raw copper, coal, and the other raw metals)
  **GATHERED per bot-hour by every bot in the arm**, everywhere (gather and mine bag deltas, the §1.2 instrument), DiD
  against control towns, pre-registered null from a pre-period. This asks the right question, does sending one bot out
  raise the town's output or only move it, and it sees iron and coal, which the iron ladder keeps in bags and no bank
  metric would. INCONCLUSIVE is a legitimate close.
- **Secondary:** the trips' haul (§6.3); what was **banked into TOWN (or outpost-record) containers** per bot-hour,
  matched by recorded position (`deposit` will bank into any non-deep chest within 48 at home's level band, skills.mjs
  ~2687-2693, so a village chest out there does not count; cobble-only and cap-bound targeted plans are kept to town
  containers at ~2691-2692); new 64-regions visited per town-day (E0); median distance reached; trip time split.
- **Exposure:** ≥ 8 `done` trips in the arm, of which ≥ 2 reached beyond 400. The ring starts at 300 and steps out by 100
  per `done`, so a first read exercises mostly 300-400; 500-800 is a later read's claim, not this one's.
- **Gates:** **the same exposure in both arms (Codex r3 P2-7):** deaths beyond 200 blocks per bot-hour spent beyond 200
  blocks, by ANY bot of the arm, against the same quantity in control (control bots spend ≈ 6.6% of their time there,
  §1.1), DiD, on the two-death floor and > 1.25×. Separately, as tripwires: every death in a trip phase, and a death within
  120 s of a trip row (mechanism-linked); `contained` trips: ≤ 1 per 8
  trips; trips not home by the deadline: ≤ 2 per 8; town job coverage (`town_deposit`, `smelt_town` per town-hour must
  not fall beyond its null band).

**Dependencies.** homefix-01 KEPT; cobblekeep-01 KEPT (bags, and the kit's cobble path into the well); E0 live 48 h with its
self-test passed; K0 passed.

---

## 7. E3 — outpost-01 (tier 3)

### 7.1 When to found one, and when not
- **Found** when a town's expeditions return to the same 3 × 3 block of regions ≥ 3 times in 72 h with scans above the
  town's median, the region is ≥ 300 from home, and a site passes the survey: a 7 × 7 surface pad, no liquid within 8, not
  within 32 of a death, ≥ 64 inside the border.
- **Do not found** when: the region is < 300 from home (go home instead); the town has an outpost already (v1: one per
  town); the region's last 3 scans fell (it is depleting); or the town's iron or chests are below their reserve.

### 7.2 What it is
`outpost@1`, a recorded structure built by builder.mjs (stage-2 code, already built in monument-01's lineage): 2 chests
(side by side, open air above: lid-free by construction), a crafting table, a 3-high cobble marker with a torch. ≈ 10
cobble, 2 chests the expedition bot carries (bots hold 4-11 chests today), 1 table. Later, a plinth junk well (plinth-first
applies to every new well) and, later still, a sapling ring.

### 7.3 How it becomes a "home" for deposits
- **An anchor list.** The outpost record `outpost-<home>-<id>.g<N>.json` makes the outpost a second deposit ANCHOR. The
  bot's configured home does not change (respawn, town jobs, the town zone, the stock journal).
- **One deterministic entry point, not a widened predicate (r2, Codex r1 P2-5).** The existing deposit paths do not share
  one rule: `depositTargetOk` is a home-relative level filter (chestfull.mjs:76, TOWN_DY 12); `farFromBank` measures
  from spawn and scans 48 (skills.mjs:5450); admission's storage probe (admission.mjs ~397-412) is its own; `town_deposit`
  acts only within 16 h / 12 v of the configured home (towndeposit.mjs:40-41, 84). Widening one of them would make the
  others disagree. So v1 leaves all four untouched and adds **`outpost_deposit`**, a town-job twin of `town_deposit`
  parameterised by an ANCHOR:
  - it runs only inside 16 h / 12 v of an outpost anchor from the outpost record, only on containers the record owns
    (by position), and only from the expedition's return phase or an arrival at the outpost;
  - its plan is `town_deposit`'s plan function with the anchor and the outpost item policy (below) passed in;
  - its refusals name remedies executable there: "outpost chests full" → continue the return to town; "nothing the
    outpost takes" → continue to town. Both are executable because the trip state carries the next phase (below).
  - Admission and `farFromBank` are not changed in v1: a non-expedition bot near an outpost banks at town as today.
- **The trip's phases with an outpost (r3, Codex r2 P1-2).** Arrival at an outpost does NOT end the trip:
  `return` → `outpost_bank` (inside 16 h / 12 v of the outpost anchor) → `return_town` → `bank` (at town) → `done`. The
  trip file and the town's fence persist through all of them, so a bot banking at an outpost 400 blocks out never frees
  the town to send a second bot. **Departures are from town only in v1**; a trip passes its town's outpost on the way back
  when the outpost lies within 64 of the trail.
- **The ownership test (r3).** `outpost_deposit` takes a container only if the outpost record names its position. Paper:
  an outpost **more than 12 blocks below** home's level (outside today's TOWN_DY band, so only the anchor rule admits it),
  an unrecorded chest 10 blocks from it (never used), full outpost chests, and arrival → full chests → a blocked town route
  → a restart (the trip resumes in `return_town`).
- **What an outpost chest takes:** only DEPOSIT_ALWAYS and project materials (logs, saplings, raw metals, ingots, coal) —
  never cobble, dirt or junk. So the town's cobble cap and stock targets are not bypassed and the outpost never becomes a
  dump.
- **Stock.** The outpost has its own journal (`outpost-chest-<id>.jsonl`); the town's stock targets do not count it in v1.
  A haul job (outpost → town; a later foreman `SUPPLY` candidate, or rails) brings it home.
- **Later (v2, not v1):** trips that start from an outpost, so a bot can work several bag-fills out there before a haul
  home. v1 keeps every departure at town, where the eligibility and the kit are defined.

### 7.4 Composition with the town rules (the dead-end table)

| neighbour | rule at an outpost |
|---|---|
| **town no-dig zone** (townzone, Chebyshev 16 of home) | unchanged at town. The outpost gets a Chebyshev-6 keep-out from its structure record (structureguard composeKeepOut), so `mine`, gather and the ore tunnel never undermine it |
| **cobble cap** (cobblecap-1000) | not involved: an outpost chest refuses cobble |
| **stock targets** | the town's only; the outpost journal is separate (v1) |
| **lidclear** | the outpost is lid-free by construction (open air above; structure placement refuses a cell above a container, TP §4 rule (a)); lidclear stays a town job |
| **plinth-first** | an outpost well (later) is a plinth, sited by the plinth planner anchored on the outpost (today it is anchored on home only) |
| **the farm** (treefarm-02) | none at the outpost in v1 |
| **mine's 12-block home refusal** | unchanged (home only); the outpost keep-out above is the outpost's equivalent |
| **full-town recovery** (new chests in rings around a town chest) | never at an outpost: a full outpost chest means "carry it home" |

### 7.5 Refusal chains, Paper tests, read
- Refusal: "outpost chest refuses cobble" names a remedy executable there: carry it home (`return_town` is already the next
  phase), or, once an outpost has one, its well. A full bag does not block the walk (§6.6). Composed test: a trip bot at an
  outpost with a cobble-full 36/36 bag → `outpost_bank` banks the logs and ores, refuses the cobble, `return_town`, `bank`.
- Paper: OP-P1 found and build; OP-P2 deposit to the outpost from the expedition return; OP-P3 cobble refused, logs taken;
  OP-P4 a `mine` near the outpost turns its bearing (keep-out); OP-P5 the outpost destroyed by a bystander → record marks
  it lost, no rebuild loop.
- Read: primary as expedition-01's (banked per bot-hour, outpost banking counted when hauled or as its own line); exposure
  ≥ 1 outpost founded in the arm and ≥ 5 deposits into it; gates as §6.10 plus 0 outpost cells lost (world read, arm only).

**Dependencies.** expedition-01 KEPT; monument-01 KEPT (structureguard + builder.mjs on the fleet).

---

## 8. E4 — rails (tier 2 / 3; gated; last)

**Cost against iron.**
- Rail: 6 iron + 1 stick → 16, so **0.375 iron per block**. A minecart is 5 iron.
- Town ↔ shaft collar (TP §4.7): 17-21 blocks surface, ≈ 8 iron; one landing per town ≈ 29 iron (TP's figure); a full
  shaft 175-205.
- **Town ↔ outpost at 300 / 400 / 800 blocks: ≈ 113 / 150 / 300 iron** + 2 carts (10) per line. Observed iron per shared
  town: median 184 (TP §1.1); net fleet inflow ≈ +50 a day (TP §1.3), i.e. ≈ 3-4 a pool a day (16 pools or 12 towns). **A 400-block line is
  150 iron of rail, 160 with two carts: 82-87% of a median town's observed iron stock, about five to seven weeks of its
  inflow.**
- **Powered rails need gold: 0 gold ingots in the census** (raw gold 15). So lines are unpowered; the rider's forward input
  (≈ 8 b/s per the wiki) is the only propulsion, which R0b must prove for a mineflayer client.

**What it would save.** 400 blocks walked at the measured 3.3 b/s ≈ 120 s; ridden at 8 b/s ≈ 50 s. ≈ 70 s each way per
trip. At one round trip per town-hour that is ≈ 0.04 bot-hours per town-hour. **Rails are a structure and a cooperation
project, not an efficiency one.** They should be judged on that, and on safety (falls on the outer bands).

**Order.**
- R0 (an instrument, host-side, no canary slot): trips per day on each candidate line (from E0 and expedition rows). A line is built
  only when it carries ≥ N trips a day (X6).
- R0b: the Paper riding proof (mount, forward input, dismount at the end, a cart left at either end, chunk unload).
- R1 (tier 3): town ↔ shaft collar, after **shaftuse-01 KEPT** (TP §4.7, unchanged).
- R2 (tier 3): town ↔ outpost, after outpost-01 KEPT, only on a line R0 qualifies.
- **O11 first:** `rail` (and powered/detector/activator rails) is on the owner's junk list (well.mjs `OWNER_JUNK_1004`),
  so any rail a bot carries goes down the well. Either it leaves the list, or rails are crafted only inside the placing
  skill and never carried (TP O11).

**Build and maintenance.** One builder (builder.mjs), ground-level track on a 1-wide bed with the walking lane beside it;
structureguard records every rail cell (no bot digs it); a bridge only across water (water is terrain: swimming is the
fallback); never elevated (falls). A damaged cell is a repair order for the line's builder; a line with > 5% of cells
missing is closed (record state) until repaired.

**Safety cases.** A cart off the end of the line (stops on a buffer block); a rider in a cart crossing into unloaded chunks
(the rider loads them; a cart left behind freezes, wiki); a cart at the wrong end (each end keeps one; a missing cart means
walk); a bot stuck in a cart (dismount after 10 s without motion); rails picked up as junk (O11).

---

## 9. Where it fits, and the overseer

**In the owner's queue.** The owner's list this week stays as it is. After it:
- homefix-01 takes the first free slot once built and approved (tier 3; a ≈ 9 h read at 4 pools, ≈ 18 h at 2, §5); it never holds the head. The
  queue owner inserts it. **Tie-break with shaftuse-01** (also first-free-slot, TP O2): whichever is approved first; if
  both are ready, homefix-01 first (deterministic gates, and shaftuse-01's routing legs inherit its watchdog fix).
- expedition-01 goes **before pavilion-01**: the owner asked for expansion now, it is independent of the copper parts
  chain, and the town projects that follow need iron the expedition may bring. If the owner prefers the TP order intact,
  expedition-01 goes after crown-01 (X2).
- outpost-01 after expedition-01 KEPT and monument-01 KEPT (its builder and guard).
- rails last, behind shaftuse-01 (TP §4.7) and outpost-01.

**Should expansion be the overseer's first real multi-bot job? No.**
- An expedition is one bot per town. Its only decision is *which* bot, and the shadow mayor's rule tied random on the one
  duty with selection content (GET_WOOD 0.72 vs 0.71). A deterministic eligibility function does it.
- The foreman needs a task graph (VillagerAgent) and a live multi-bot project; its design names that as monument-01 or
  the pavilion, with S0's headroom read first. Expansion would give it neither.
- The outpost's haul (outpost → town) is a fair later `SUPPLY` lease, after S0 passes and an outpost exists.
- Shared prerequisite: homefix-01 serves both the expedition's return and the foreman's RECALL gate.

---

## 10. Open owner decisions

| # | decision | recommendation |
|---|---|---|
| **X1** | **Lift the owner's 09-30 rule ("no more stuck / drowning hunts; tripwires only") for homefix-01 only.** homefix-01 changes the stagnation watchdog and the runner fleet-wide (tier 3, §5): rescues are reserved and actually run (H2a turns on ≥ 7.6k level-1 random 45-70-block relocations a week that never started before), are not cut at 15 s (H2b), and interruptions stop counting as skill errors (H3, which also stops them feeding the auto-pause). Expected: longer rescues, rescues that actually run, reconnects kept for wedged skills; guarded by deaths after a rescue and strandings. It registers **tier 3**: gate v36 (installed 10-19 16:27Z) keeps tier 2 for +180 KEEPs on 4 pools, and homefix-01's slowest gate needs ≈ 9 h at 4 pools or ≈ 18 h at 2 (h13) | **yes, tier 3**; KEEP rests on deterministic gates G1-G4, not on an effect estimate; it is three measured defects in code that already runs ≈ 39k escalations a week, not a hunt |
| **X9** | homefix-01 inserted into this week's list at the first free slot (never holding the head), as TP O2 did for shaftuse-01; tie-break with shaftuse-01: whichever is approved first, homefix-01 if both | **yes** |
| **X10** | on a trip, the kit policy replaces the stockpile keeps in every planner layer (wood 64 → 0, cobble 64 and `COBBLE_RESERVE` → one 64-stack of scaffold, a spare pickaxe kept; all eight log species bankable), so the gather rungs will ask for wood and cobble back after a trip; the trip order outranks the milestone ladder and is exempt from admission while a trip is live | **yes**, subject to gate K0 (the kit's yield replayed with the real planner functions on a conservative layout; ≥ 50% of at-town bags reach 16 free slots and ≥ 50% of town-hours have a complete kit, reported apart) |
| **X2** | expedition-01 before pavilion-01, or after crown-01 | **before pavilion-01** |
| **X3** | expedition v1 surface-and-shallow only (no `mine` staircase on the trip, ore within 12 below arrival), while the diamond hold and underground safety stand | **yes** |
| **X4** | one expedition per shared town at a time; isolated pools excluded in v1 | **yes** |
| **X5** | outposts accept only valuables (no cobble or junk), one per town in v1 | **yes** |
| **X6** | rails: build a line only when R0 shows ≥ N trips a day on it (N proposed 12); unpowered (no gold) | **yes**; the owner sets N |
| **X7** | O11 (TP): lift `rail` from the junk list before R1, or rails crafted only inside the placing skill | decide at R0b |
| **X8** | an expedition that reads INCONCLUSIVE twice on its primary (logs + ore GATHERED per arm bot-hour unmoved, §6.10) closes the line of work until E0 shows the near ring depleted further; banking is not the stopping rule | **yes** |

---

## 11. Reviews

### Round 1 (r1): Codex CHANGE, Claude CHANGE. Both: ORDER AGREE, FIRST STEP AGREE.

**Codex r1** (`codex exec --sandbox read-only`, 115k tokens):
- P1-1 H3's path was wrong: goto's dig-retry re-throw is inside the leg's outer try and is converted; the raw message comes
  through `home` → `surface` → the climb catch (~14683). 225 GoalChanged + 1 Timeout, not 226.
- P1-2 the lease's renewal, expiry and stranded recovery contradicted each other; separate ownership, an absolute
  deadline and a persistent return state; whether a stranded bot blocks the next departure.
- P2-3 H2's guard needs a liveness contract (stranding history lives in `#strandingVerdict`; hard-stop is 180 + 30 s;
  release in `finally`; arbitration between the two rescues).
- P2-4 "surface only" overclaimed (`GoalNearXZ` has no elevation; dig and drop retries; breadcrumbs do not prove the
  reverse leg).
- P2-5 outpost deposit composition (four predicates disagree; `town_deposit` is 16/12; the 30-34 slot gap; `deposit`
  walks home itself).
- P2-6 E0's 14-day negative crosses the refused 10-07; "not observed" is not "unvisited".
- P2-7 labels (526/762 is all pools; the window end; start is a proxy; replay the actual predicate on successes too;
  exposure below 30).
- P3-8 20% of 60 shared bots; 0.42% vs 2.1%; 160 iron with carts; keep smeltfuel, shaftuse and the conditional stages.

**Claude r1** (independent subagent, 60 tool calls, one probe on a scratch copy of `src`):
- P1-1 **most watchdog rescues never start**: `cancel` then `run` returns `runner_busy` while `runner.current` is set
  (runner.mjs:150-157, 182-185, 491); unlogged; ≥ 46% of level-2 and ≥ 62% of level-1 rescues; tests fake `run`.
- P2-1 H3's mechanism (same finding as Codex P1-1, found independently); fix in the runner; `skill_error` also feeds the
  auto-pause and lessons.
- P2-2 the 70% claim used the wrong population (S0's filter drops flagged and low-health rows).
- P2-3 exposure does not close; KEEP on deterministic per-mechanism checks, DiD as guards.
- P2-4 the in-flight guard: `finally`, gate `judgeStranding`, split the stranding push.
- P2-5 the H1 projection used ≤ 5; replay ≤ 3 with |dy|; the 2.87 bound.
- P2-6 `deposit` banks into any non-deep chest within 48 at home's level band: restrict the primary to town / outpost
  containers; `farFromBank` / `depositDue` measure from the origin.
- P2-7 the TTL could deadlock the town's slot (same class as Codex P1-2).
- P2-8 bank-down cannot fire as described (`town_deposit` at ≥ 34 and inside 16/12; the iron ladder).
- P3: 20% not 15%; drowning tops 100-200; label mixes; medians over 226; `llm:idle` is a lower bound and 0 of 1,141 is by
  construction; `home`'s `return last` explains successes to 2.7; do not route goto's loop break through ≤ 3;
  `HOME_BUDGET_MS` 200 > 180; a shaftuse tie-break; the watchdog-trip interplay; trips of 300-400 only in a first read;
  R0 is an instrument; E0 cannot see oceans; the death bands mix underground time.

**r2 takes in every finding; none rejected.** (Section numbers in this table are r2's; r3 renumbered §6.)

| finding | r2 |
|---|---|
| runner_busy (Claude P1-1) | new **H2a** (§0.3, §2): bounded wait for idle, `_watchdog_rescue` rows, keep the level; P0 scene; G4 gate |
| H3 path (Codex P1-1, Claude P2-1) | corrected to `surface`'s climb catch; the fix moves to the runner (all skills); a runner-level test with a mutant |
| lease / deadline / stranded (Codex P1-2, Claude P2-7) | §6.2 three pieces of state; the return phase is a deterministic order; a stranded return blocks the next departure; 6 h page; X-P7..X-P9 |
| H2b liveness (Codex P2-3, Claude P2-4) | §2 H2b: `pending` in `finally` incl. throws; both judgements gated; stranding push split out; hard-stop bound; one rescue at a time |
| surface overclaim (Codex P2-4) | §6.4 "bounded-risk": outbound larger-drop retry off, `oneWay` legs and a scaffold reserve, no outbound leg > 12 below departure; X-P6 irreversible drop |
| outpost deposit (Codex P2-5, Claude P2-6) | §7.3 `outpost_deposit`, a new anchor-parameterised entry point; the four predicates untouched; container-matched primary (§6.9); the 30-34 gap (§6.5) |
| E0 coverage (Codex P2-6) | §4: covered window from 10-08, per-day coverage, 48 h warm-up, "not observed" vs "unvisited" vs `unreached`; oceans by scan |
| H1 replay (Codex P2-7, Claude P2-5) | the actual predicate on every row: 581 → 814 of 2,338; non-interrupted 48.4% → 67.8% |
| 70% population (Claude P2-2) | S0's window: 37% → 59% before its flag filter; H1 alone does not reach 70%; S0 re-measures |
| exposure (Codex P2-7, Claude P2-3) | §5: G1-G4 deterministic KEEP gates with positive controls; exposure ≥ 12 home rows + ≥ 6 rescues; extend to +540 |
| bank-down (Claude P2-8) | §6.2 `expedition_kit`: `town_deposit`'s plan with a keep set, in the town zone, iron ladder unchanged; skip is not a refusal |
| P3s | all applied (§0, §1.2, §2, §6.7, §6.9, §8, §9) |

### Round 2 (r2): Codex CHANGE (ORDER DISAGREE, FIRST STEP AGREE); Claude CHANGE (ORDER AGREE, FIRST STEP AGREE).

**Codex r2** (97k tokens): R1 findings RESOLVED: H3 path, E0 coverage; PARTIAL: lease/recovery, H2 liveness, surface
return, outpost composition, labels, P3s. New: (1, P1) the stranded chain had no executable recovery when contained, and
there is no remote ballast shed; (2, P1) arrival deleted the trip state before banking, at town and at an outpost; (3) the
H2a wait and H2b `pending` did not compose (`current` is cleared at runner.mjs:491, not in the `finally`; pending must be
acquired before the cancel; level increments; post-body exceptions); (4) G1-G4 could pass for the wrong reason, G4 had no
positive control; (5) the 814 projection counted 11 evidence-gated rows: 803 / 34.3% / 66.9%; (6) the kit and outpost
entry points needed planner contracts (`townDepositPlan` takes no keep set; tool copies per name; iron ladder); an
outpost > 12 below home; (7) the reserve check came after the irreversible step: check pre-commit on the planned path;
(8) **ORDER: the owner list was mis-cited** (TP §0.4 has shaft → stonewithdraw → smeltfuel).

**Claude r2** (52 tool calls, one probe on a scratch copy): R1 findings RESOLVED: H3, lease/deadline, surface overclaim,
E0, labels, 70% population, in-guard, H1 replay, container-matched primary, TTL deadlock; PARTIAL: runner_busy, gates,
bank-down. New: (N-1, P1) G3 could never pass, because brain gotos cut by a legitimate verdict look like cut rescues (probe:
a brain `home` cut at 5 s); (N-2) the level-1 bound left out reflex-interrupted relocations: ≥ 22.7%, not ≥ 62%;
(N-3) a poll loses to the cognitive loop's next livelock rung: reserve the runner; (N-4) pending from the verdict,
`escalation--`, back off on a decline, remove the post-await reset; (N-5) gates need opportunity floors (P(0 | no fix)
≈ 26% for G1, 9% for G3) and G4 must not grade itself; the level-3 row before `quit`; (N-6) the trip order's rank vs
`orderFor(ready)`; (N-7) no ballast shed exists; (N-8) the haul is never banked (town_deposit at ≥ 34): the primary
could not move; (N-9) the kit's 16 free slots unmeasured; (N-10) the owner's 09-30 "no more stuck hunts" rule not cited.
P3: TTL wording, home budget propagation, 803, G1 boundary, 32 vs 48 a day, iron per pool, the X9 insertion, E0's
estimator, ceiling and pickaxe reserve definitions, back to the last breadcrumb, the death-gate denominator, "spawn".

**Disagreement on ORDER, and how r3 settles it.** Codex read the owner list from TP §0.4; Claude from STATE 15:20Z.
STATE 10-19 15:20Z on origin/main (the queue as the coordinator holds it) is later and has stonewithdraw-01 → shaft-01,
and toolkit-03 carries the smelt-coal sweep ("smelt coal through every-container search"); the owner's brief for this task
says "smeltfuel (folded into toolkit-03)". r3 cites that entry in §0.2, keeps smeltfuel's TP place if it is un-folded,
and makes homefix-01's insertion an explicit owner decision (X9). r3 asks both engines to re-check the order against it.

**r3 takes in every r2 finding; none rejected.**

| finding | r3 |
|---|---|
| contained / no remote shed (Codex 1, Claude N-7) | §6.7 step 5: the kit's 3 escape logs + table → wooden pickaxe → dig → climb; `contained` is a counted, gated, accepted outcome; §6.6 "a full bag is not a dead end"; X-P4, X-P6 |
| arrival before banking (Codex 2, Claude N-8) | §6.2 phase table with `bank` (`expedition_bank`, any slot count) before `done`; outpost phases `outpost_bank` → `return_town` → `bank` (§7.3); the fence holds to `done`; departures from town only |
| H2 composition (Codex 3, Claude N-3/N-4) | §2 "The H2 fix": pending from the verdict, `runner.reserve` + `runner_reserved` declined class, `current` cleared in a `finally`, `escalation--` + a window back-off, the post-await reset removed, the 225 s bound, real-Runner tests |
| gates (Codex 4, Claude N-1/N-5) | §5 table: opportunities with floors D; G3 joins rescues by attempt id; G4 `started` written by the runner, per-attempt reconciliation; fixture positive controls; level-3 row before `quit` |
| 803 (Codex 5, Claude P3) | §0.3, §2: 803 of 2,338 (34.3%), 66.9% non-interrupted, labelled geometric |
| kit / outpost contracts (Codex 6, Claude N-9) | §6.3: `townDepositPlan` gains a `keep` parameter; the kit minimum, what it replaces and preserves; the replay (157 of 161 reach 16 free); §7.3 an outpost > 12 below home and an unrecorded chest |
| pre-commit reserve (Codex 7) | §6.5: the planned path is read before the first move; return debt vs a fixed emergency reserve; back to the last breadcrumb |
| order (Codex 8) | above |
| level-1 bound (Claude N-2) | ≥ 22.7% (§0.3, §2) |
| trip order rank (Claude N-6) | §6.2: ahead of `orderFor(ready)`, plinth and town deposit; `mine` and crafts withheld; room remedies answered by the trip; X-P11 |
| owner 09-30 rule (Claude N-10) | X1 asks to lift it for homefix-01 only, with the relocation count and guards |
| P3s | applied: deadline wording, home budget `until`, G1 boundary, 32 / 48 a day, iron 3-4 a pool a day (5-7 weeks), X9, E0's estimator, ceiling and pickaxe reserve, last breadcrumb, the trip-hours death denominator, origin vs world spawn |

### Round 3 (r3): Codex CHANGE, Claude CHANGE. **Both: ORDER AGREE, FIRST STEP AGREE.**

**Codex r3:** RESOLVED: arrival before banking, 803, the queue citation (STATE 15:20Z supports stonewithdraw → shaft and the
smelt-coal sweep inside toolkit-03), N-1, N-2, N-4, N-7, N-8, N-10, P3s. Remaining: (1, P1) the gate table could not be the
acceptance contract (G3's mandatory pre-period control cannot run on code that writes no attempt rows; G1 counted
interrupted arrivals; G2's 50 arbitrary interruptions need not touch the raw path; G3's starts need not survive a tick; G4
treated `started` as terminal and had no reconnect outcome); (2) e5 does not support 98%, and a local `keep` cannot restore
an allowance removed upstream in `depositPlan` (synthetic probe: a bow, rod and water bucket bag read 36 free); (3) phase
gaps (`kit` missing from precedence, arrival from `stranded`, `contained` not in the table, full-town recovery refusals,
the recount at ~917); (4) escape wood is a reserve, not yet an executable remedy (station placement, room); (5) the
`finally` must be nested and the reservation must cover a `run()` suspended at `arb.acquire`; (6) a pre-check does not
constrain the executed / re-planned path; (7) the death comparison mixed exposure populations.

**Claude r3** (52 tool calls; probe of the real `townDepositPlan` / `depositPlan`: 3 slots freed of a 21-slot bag):
RESOLVED: arrival/banking, 803, outposts, the queue (note STATE 12:45Z's owner list has shaft before stonewithdraw), N-1,
N-2, N-6's chain place, N-7, N-10. New: (P1-A) holding the level on every decline removes the reconnect for a wedged skill;
(P1-B) the kit replay does not model `bankableInventory` (COBBLE_RESERVE 64, stock keeps via the callback, one copy per tool
name, 64 per visit, `not_wanted` log species, ballast); (P2-B) five declined sets, `noteFailure` cooldowns, livelock
latches, `isBusy`, identity-guarded clear; (P2-C) floors from the pre-fix rate (G1 D ≥ 10; G2 restricted to home/surface;
G3 control impossible; G4 reconnect phase); (P2-D) enforce limits in Movements, not `getPathTo`; 32 + 32 leaves no descent
budget; "leaves included" refuses forests; (P2-E) trip orders go through admission; (P2-F) the primary could not see iron,
coal or five log species. P3: e5's square zone and stacks; homes shared by six towns; tier 2 is the owner's call; fields in
`skill.args`.

**r4 takes in every r3 finding; none rejected.**

| finding | r4 |
|---|---|
| gates (Codex 1, Claude P2-C) | §5: D from the pre-fix rate (P(0 \| no fix) ≤ 5%): G1 non-interrupted arrivals, D 10; G2 interrupted `home` / `surface`, D ≥ 14; G3 rescues alive ≥ 10 s, D 8, proxy reader on the pre-period + fixtures for the new reader; G4 terminal phases incl. `reconnected`, fixtures only |
| kit replay and planner layers (Codex 2, Claude P1-B) | §6.3: ONE policy object through `townDepositPlan`, `depositPlan` / `bankableInventory` and the well; default reproduces today (property test); the 98% withdrawn; gate **K0**: replay the real functions on slot-level bags, ≥ 50% reach 16 free, before expedition-01 is queued |
| phase gaps (Codex 3) | §6.2: `contained` row; arrival to `bank` from every phase, checked each decision; every `bank` refusal class ends at `done`; `kit` in precedence; the trip order assigned after the recount (~917) |
| escape wood (Codex 4, Claude Codex-r2-1) | §6.7 step 5: logs reserved from scaffolding (the `#escape` override); `trip_escape` is a deterministic composite; room / table cell / logs / unbreakable walls → `contained`, accepted and gated; X-P6 variants incl. 36/36, X-P6b |
| runner contract (Codex 5, Claude P2-B) | §2 item 2-3: generation re-check after `arb.acquire`, the grant released; `isBusy` reports the reservation; ONE exported declined set + a source test; no `noteFailure`, no latch; nested `finally`, identity-guarded clear |
| reconnect kept (Claude P1-A) | §2 item 4: two consecutive `reserve_expired` → level 3; the reconnect bypasses the reservation; a never-unwinding-skill test; reconnects reported, not "expected to fall" |
| reservation length (Claude r2 N-3 residue) | measured (`h11`): unwind p50 1.9 s, p90 10.1 s, p99 47.6 s; reservation 20 s (≈ 95%) |
| executed-path limits (Codex 6, Claude P2-D) | §6.5: the limits live in the trip's own Movements (`exclusionAreasStep`, own arrays, sky light 0 = underground, `maxDropDown` 3), the dig retry uses a copy; scaffold 64 = 32 reserve + 32 descent budget |
| death exposure (Codex 7) | §6.10: deaths beyond 200 per bot-hour beyond 200, any bot, both arms; trip deaths and linked deaths as tripwires |
| admission (Claude P2-E) | §6.2: trip skills exempt like `home` (`rescue: true`) |
| primary visibility (Claude P2-F) | §6.10: logs (8 species) + ore GATHERED per bot-hour by every arm bot is the primary; banking is secondary |
| P3s | STATE 12:45Z vs 15:20Z noted (§0.2); tier 2 asked in X1; `skill.args`; the homes are per pool from each pool's own `town-chest-<home>` file (six towns do share 355,73,147, read from six separate pool directories, not the fallback) |

### Round 4 (r4): Codex CHANGE, Claude CHANGE, P2s only. **Both: ORDER AGREE, FIRST STEP AGREE** (second round running).

**Codex r4:** RESOLVED: runner concurrency, death exposure, P1-A, P2-B. PARTIAL with P2s: (1) G3's ≥ 10 s filter excluded
the very cut it should catch; G4's bars are thresholds, not the formula; (2) K0 rebuilt full stacks from counts that cannot
show slot layout (`inventorySummary` sums slots); (3) arrival from any phase would bank a bot selected at the home point;
(4) a count override does not stop `getScaffoldingItem` placing logs first (probe: 3 oak logs + 16 mossy cobble → it
places oak_log); (5) `getMoveDropDown` / `getMoveDown` emit landings without the exclusion (probe: limit y ≥ 9, landing
y = 8), `infiniteLiquidDropdownDistance` is on by default, and debt was checked after the leg; (6) `rescue: true` does not
exempt from admission; (7) X8 still used banked output.

**Claude r4** (63 tool calls, no probes): RESOLVED: gates' D arithmetic, phases, runner, death exposure, P1-A, gate
floors, primary. PARTIAL / NEW P2: (1) the read is ≈ 9 h, not +180 (G1 ≈ 4.8 per 3 h vs D = 10; G2 shrinks once H2b
lands; pool `home` ∪ `surface`); (2) G4's 10% declined bar can fail correct code (`body_held` unmeasured);
(3) `runner_reserved` still reaches `roomOutcome`, `plinthOrderOutcome`, `smeltTownOutcome`, `pruneOutcome`, the
`wear_out` backoff, and `#escape` decides from displacement: exit early in the brain's outcome block; (4) the trip profile
is clobbered by `assertNav` and the wrappers' fixed restore; float dig and `rideFloorDown` descend outside Movements;
(5) reflex `PLACEABLE`, `pickScaffold` and `rescueBlocks` place logs: carry a spare pickaxe instead; (6) K0 needs the
town's stock readers (or targets at cap) and must report kit availability apart from room; (7) the admission exemption
does not exist. P3: level 3 reconnects only when pathable; the decline counter must survive resets; 225 → 230 s; sky-light
positive control.

**r5 takes in every r4 finding; none rejected.** New measurement `h12`: interrupted runs filed `skill_error` are 3,660 of
91,313 fleet-wide (surface 73.5%), so H3 is larger than `home` and G2 pools `home` ∪ `surface` at p = 57.7% (D = 5); the
unwind tail past 20 s is 4.1%, which sets G4's `reserve_expired` bar at 8%.

| finding | r5 |
|---|---|
| G3 filter, G4 bars (Codex 1, Claude 2) | §5: G3 counts every stagnation cut of a started rescue, opportunities by `tick_seen`; G4 bars only `reserve_expired` at 8% (2 × h12's 4.1%), `body_held` / `runner_paused` reported |
| read length, G2 pool (Claude 1) | §5: planned at +540 (P(G1 decided) ≈ 90%); G2 pooled `home` ∪ `surface`, D 5; §9 tie-break restated |
| K0 layout, readers, availability (Codex 2, Claude 6) | §6.3: conservative layout (+1 partial stack per name); the town's stock readers or targets at cap; container capacity; ROOM and KIT AVAILABILITY reported apart; slot telemetry as the exact later version |
| departure guard (Codex 3) | §6.2: `departed` (> 48 from home once) before any arrival reconciliation; `skip:no_departure` at 15 min |
| escape (Codex 4, Claude 5) | §6.3, §6.7: a spare pickaxe replaces the logs and table; `surface` digs out; `contained` for both spent / unbreakable walls; X-P6 / X-P6b rewritten |
| Movements (Codex 5, Claude 4) | §6.5: `baseMovements()` in index.mjs so `assertNav` and the wrappers restore the trip profile; a `getNeighbors` subclass checks every emitted DESTINATION; `infiniteLiquidDropdownDistance` off; float dig and `rideFloorDown` off on trips; pre-commit debt on every `path_update`; sky-light positive control |
| admission (Codex 6, Claude 7) | §6.2: a new admission path keyed on the live trip file; tested through the real controller |
| declined handlers (Claude 3) | §2 item 2: one shared set (milestones extends it), an early exit in the brain's outcome block, `#escape`'s own check; behaviour tests per handler |
| X8 (Codex 7) | gathered-output primary is the stopping rule |
| P3s | level-3 pathable branch and hard-stop stated; decline counter separate; 230 s |

### Round 5 (r5): Codex CHANGE (one P2), Claude CHANGE (two P2). **Both: ORDER AGREE, FIRST STEP AGREE** (third round running).

**Codex r5:** RESOLVED: G3/G4 bars, the departure guard, the escape-log problem, admission, X8, and Claude's P2-2, P2-3,
P2-5 to P2-7. **P2:** K0's "+1 partial stack per name" is not a bound (64 coal can be 1 stack or 4 of 16), so K0 could pass
on the wrong bag. P3 for the build: a `setGoal(null)` in a `path_update` listener is overwritten (index.js ~446-470);
wrapper profiles during a call; `surface` is not a guaranteed staircase (sea-level target, `shaftAscend` pillars);
G2's formula D is 4, not 5; h11/h12 latency is a proxy.

**Claude r5** (66 tool calls; probe `r5probe/pu.cjs` drives the real pathfinder 2.4.5): **P2-1:** gate v36 (installed
16:27Z) keeps tier 2 for +180 KEEPs on exactly 4 pools and says long-read runs register tier 3; homefix-01 cannot KEEP at
+180 (P(G1) ≈ 2.4%), and tier-3 draws are often 2 pools (≈ 18 h); **P2-2:** `surface` refuses at y ≥ 63, so the escape
cannot run where surface trips strand: call it with `_toY` = the last breadcrumb (as `mine` does). P3: the declined early
exit would drop the decision row, `lessons.save` and milestone accounting; `roomOutcome` sits later; the pre-commit stop
is overwritten (probe: still moving 6 ticks; LAVA GUARD 1 uses the same pattern); K0's layout is not a bound, and slot
counts are already logged (`slots=a->b`); G2 from the arm's actual mix; G3's 165 s bound has no margin; the trip profile at
town; `work` gathers use `gatherMoves`; liquid drops ignore the flag.

**r6 takes in every r5 finding; none rejected.** New measurement `h13`: G1 on the H1 band (2, 3] has p = 224 / 240 =
93.3%, so D = 2, decided by +540 at 4 pools with P 0.93 (by +1080 at 2 pools).

| finding | r6 |
|---|---|
| tier under v36 (Claude P2-1) | §5, X1, §0.2, §9: homefix-01 registers TIER 3; reads planned to +540 at 4 pools and +1080 at 2 |
| G1 power (Claude P2-1) | §5: G1 on the H1 band, D 2 (h13) |
| escape above sea level (Claude P2-2, Codex P3) | §6.7: `surface` with `_toY` = the last breadcrumb; the partly spent scaffold stack takes dug cobble in a full bag; X-P6 above y = 63 |
| K0 layout (Codex P2, Claude P3) | §6.3: real slots from the read-only RCON `data get entity <bot> Inventory` (as `fleet-inventory.sh` already does); a failed read is UNKNOWN; positive control against the logged `slots=a->b` |
| pre-commit stop (Codex P3, Claude P3) | §6.5 item 4: a deferred stop + a pre-move check, tested on the real pathfinder; LAVA GUARD 1's same pattern flagged as its own task |
| declined placement (Claude P3) | §2 item 2: skip only the handler block; the decision row, `lessons.save` and milestone accounting still run; `roomOutcome` gets the set |
| G2 / G3 (Codex P3, Claude P3) | G2: formula D 4 + a floor of 5, recomputed from the arm's mix; G3: defect by mechanism (`window_from` before the rescue's start); proxy < 150 s |
| profiles (Codex P3, Claude P3) | §6.5: the trip profile only in `out`..`contained`; wrapper and `work`-gather trip variants; liquid landings bounded by the 12-below filter only |

### Round 6 (r6): pending.
