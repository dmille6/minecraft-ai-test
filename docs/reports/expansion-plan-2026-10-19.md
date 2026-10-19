# Expansion: expeditions, then outposts, then rails (2026-10-19, design only, r2)

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

**1. The first step is `homefix-01`, a tier-2 correctness fix to `home` and the stagnation watchdog (§2, §5).**
- Going home is the return leg of every expedition and the overseer's RECALL. Today it fails for reasons that are ours, not
  the terrain's: an arrival graded as a failure (H1), watchdog rescues that never start or are cut at 15 s (H2a, H2b), and
  interruptions filed as skill bugs (H3). Each is a small change with a behaviour test and a deterministic KEEP gate.
- Alongside it, with no canary slot: **E0, the frontier census** (host-side, read-only; §4). It says where fresh land is
  and how far, before any expedition code is written.

**2. ORDER (one canary lane).** The owner's list for this week runs first, unchanged.

| # | step | tier | needs |
|---|---|---|---|
| — | **E0 frontier census** (host, read-only, no slot) | — | nothing; build now |
| first free slot | **homefix-01** (§5) | 2 | built + both reviews; inserted by the queue owner (the coordinator); never holds the head, exactly as shaftuse-01 (TP O2, unchanged) |
| — | the owner's list, unchanged: treefarm-02 → brain-01 → cobblekeep-01 → toolkit-03 (smeltfuel folded in) → bamboo-03 → townfloor-01 → monument-01 → stonewithdraw-01 → shaft-01 | | |
| after the owner's list | **expedition-01** (§6) | 3 | homefix-01 KEPT; cobblekeep-01 KEPT (bags; §1.3); E0 live 48 h |
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
  rows of ANY trigger, so at least 46% of level-2 rescues never ran; 33,459 escalation-1 events against at most 12,875
  goto rows that can be relocations, so at least 62% of level-1 rescues never ran. A probe of the real `Runner` (Claude r1,
  on a scratch copy) returned `runner_busy`. The watchdog's tests use a fake `run` that can never be busy.
- **H2b, the rescues that do start are cut at 15 s.** The watchdog's `check()` runs on a 15 s `setInterval` and is not
  guarded against re-entry. Escalation 2 *awaits* `home`; the next tick still holds the old stagnant window (it is reset
  only after the await) and convicts the rescue at its first sample. Shared towns: 404 of 610 `interrupt:stagnation` home
  runs lasted 10-20 s (all pools: 524 of 759). All pools: 634 of 1,815 escalation 2→3 steps (35%) came ≤ 20 s apart, and
  1,579 of 5,419 1→2 steps (29%), so the relocation `goto` is killed the same way. Level 3 reconnects when a route exists
  (1,628 `_stagnation_reconnect` in 7 d, all pools). Both H2a and H2b are the CLAUDE.md "Reachable" failure: a remedy
  named and not taken.
- **H3, reflex interrupts misfiled (225 runs).** 225 `skill_error` rows carry the pathfinder's raw "The goal was changed"
  message (206 under `interrupt:entombed`; 1 more `skill_error` is a raw Timeout). goto converts an aborted walk into
  "interrupted: GoalChanged"; the raw message escapes through `home` → `surface` → the climb stage's catch, which re-throws
  the raw error when the signal is aborted (skills.mjs ~14683; Codex r1 and Claude r1 independently). The runner then files
  an interruption as a skill bug, which also feeds `consecutiveFailures`, the auto-pause and the lessons store.
- **H4, real route failures:** `no_path` 144, `stranded` 92, `goal_changed` 74, `path_budget` 123 (extraction); deep starts
  succeed 23% against 41% at the surface.
- **What fixing H1 alone gives**, replaying the proposed predicate itself (goto's: horizontal ≤ 3, |dy| ≤ 6) over every
  row, successes included: 2 current successes fail it (dy −10), 235 failures pass it, so 581 → **814 of 2,338 (34.8%)**.
  On the rows whose trigger survived (no interrupt) 581 of 1,201 (48.4%) → 814 of 1,201 (67.8%). **That is not S0's
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

**6. Open owner decisions** are in §10 (X1-X8). The biggest: X1 (homefix-01's watchdog change is fleet-wide), X3 (expedition
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
- **The border** is 1,950 from spawn (config `WORLD_BORDER_RADIUS`); the homes are 96-480 from spawn, so every town has
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
Expedition safety is §6.4.

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
room never leaves. So expedition-01 starts with its own bank-down at town (§6.2), and it is ordered after cobblekeep-01, the
owner's bag fix already queued.

### 1.4 What the bots already know about far land: almost nothing
- **Resource sightings** (`world-facts-<pool>.json`, capped at 200 per world, `MAX_RESOURCES`): 2,400 in the 12 shared
  worlds; distance from home median 95, p90 184, max 334; 169 beyond 200 and 17 beyond 300. They are where the bots have
  been. They cannot seed targets at 300-800.
- **Explore** (`skills.mjs` explore): 20-120 blocks in 12-block legs, toward a known sighting or away from SPAWN.
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
  failures and 235 failures to arrivals (§0.3). Behaviour test: a bot stopped on each node with isEnd true is an arrival.

### H2a — the watchdog's rescue usually never starts (≥ 46% of level 2, ≥ 62% of level 1)
- `#escalate` (watchdog.mjs ~392-411): `this.runner.cancel('stagnation')`, `this.runner.resume()`, then
  `await this.runner.run('goto' | 'home', …)`. `cancel` → `interrupt` aborts the controller and returns (runner.mjs
  150-157); `this.current` is cleared only in the run's `finally` after the skill unwinds (~491). `run()` returns
  `{failed, runner_busy}` while `current` is set (~182-185), before any `logSkill`. The watchdog discards the result and
  resets its window. Level 3 (`surface` / `mine` at ~503) and `judgeStranding`'s climb-out (~166-169) share the shape.
- Evidence: 5,436 escalation-2 events vs 2,939 `home` rows of any trigger (all pools, 7 d); 33,459 escalation-1 events vs
  ≤ 12,875 goto rows that could be relocations (8,913 `watchdog_relocate` + 3,962 `interrupt:stagnation`). Positive
  control: the same stream finds 1,565 shared-town `home` rows that DID follow an escalation 2, so a started rescue is
  visible when it exists.
- Why the tests missed it: `test/watchdog-busy.test.mjs` fakes `run: async () => {}`, which can never be busy.
- **Fix:** after `cancel`, wait (bounded: until `runner.current` is null, at most 10 s, polling) before `run`; if still
  busy, log `_watchdog_rescue status=busy` and keep the escalation level so the next verdict retries it. Log EVERY
  rescue's outcome as a `_watchdog_rescue` row (level, remedy, status). Same for level 3 and the stranding climb-out.
  Behaviour test on the REAL `Runner` with a skill that takes 2 s to unwind after abort: the rescue starts.

### H2b — the rescue that does start is cut at 15 s (404 of 610 cut at 10-20 s; also its relocations)
- `StagnationWatchdog.start()` runs `check()` every 15 s with `setInterval` (watchdog.mjs ~79). `check()` is async and has no
  in-flight guard. At escalation 1 and 2 it `await`s `runner.run('goto' | 'home')`, and it resets `this.samples` only
  after that await returns.
- So 15 s into the rescue, the next tick judges a window that is still the old stagnant one, plus 15 s of the rescue. Unless
  the rescue has already moved 8 blocks, it is "stagnant" again: `escalation++`, `runner.cancel('stagnation')` aborts the
  rescue, and the next level runs.
- Evidence (fixed window): shared towns, 404 of 610 `interrupt:stagnation` home runs lasted 10-20 s (median 15); all
  pools 524 of 759. Escalation gaps (all pools): 1→2 ≤ 20 s in 1,579 of 5,419 (29%), 2→3 in 634 of 1,815 (35%); the other
  mode is the designed 160-200 s (3,731 and 1,082). Level 3 reconnects when a route exists: 1,628 `_stagnation_reconnect`
  in 7 d. Up to ≈ 630 of those a week follow a rescue cut at 15 s.
- Positive control: the same stream finds the designed ≈ 180 s gaps, so the instrument resolves both modes.
- **Fix, with an explicit liveness contract (Codex r1 P2-3):**
  - a `pending` flag set when an escalation starts a rescue and released in a `finally` (also when `runner.run` refuses:
    `runner_busy`, `body_held`, `runner_paused`, and when `#escalate` itself throws, e.g. reading
    `this.bot.entity.position` after a disconnect; otherwise one throw would switch the watchdog off for good);
  - while `pending`, a tick still SAMPLES both histories, but issues no verdict and no cancel from EITHER judgement:
    `judgeStranding` is gated too (ungated, its climb-out could still cancel the rescue). Stranding history is pushed
    inside `#strandingVerdict` (~236), so that push is split out into its own sampler called every tick;
  - the window is reset when the rescue STARTS, so the next verdict is on the rescue's own samples;
  - the bound on `pending` is the runner's: the skill timeout (180 s) plus the hard-stop grace (30 s), after which the
    runner releases the body and the `finally` clears the flag;
  - one rescue at a time: a pending stagnation rescue also holds the stranding rescue, and the reverse.
  - Controlled-clock tests: a rescue moving 1 block per 15 s is not cancelled before its own window; a skill that ignores
    its abort reaches hard-stop and the flag clears; a refused escalation clears the flag; stranding history keeps
    accumulating while pending.
- This is the CLAUDE.md "local policy composition" class: the trigger's own next tick refuses the remedy it chose.

### H3 — reflex interruptions filed as skill bugs (225 runs)
- 225 `skill_error` rows carry the raw pathfinder message "The goal was changed before it could be completed!" (206 under
  `interrupt:entombed`, 19 under `interrupt:stuck`; over all 226 `skill_error` rows, median 9.7 s and moved median 5). One more `skill_error` is a raw Timeout.
  The entombment reflex set its own goal mid-walk.
- **The path (corrected in r2, Codex r1 P1-1).** goto's dig-retry re-throw (skills.mjs ~650) sits inside the leg's outer
  try, whose catch (~771) converts an aborted signal into "interrupted: GoalChanged" with `aborted: true`; that path never
  emits the raw message. `home` calls `surface` below sea level, and the climb stage's catch (skills.mjs ~14683,
  `if (e.aborted || signal?.aborted) throw e`) re-throws the RAW error; the runner (runner.mjs ~256) then sees no `aborted`
  mark and files `skill_error`. The rows fit this path; they do not prove every row took it.
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
homefix-01 does not touch them; the expedition's breadcrumb return (§6.5) is the remedy for the trip's own path.
- `HOME_BUDGET_MS` is 200 s but the skill timeout is 180 s (skills.mjs:379, config.mjs:182), so a long walk ends as
  `interrupt:timeout` (13 rows) rather than by its own budget. homefix-01 sets the budget under the timeout.
- `home` grades itself inconsistently today: a trip that closed < 16 blocks returns goto's own result (`return last`,
  skills.mjs ~2620-2628), so goto's ≤ 3 success passes through. That is why some successes end at up to 2.7, and why 11
  rows read "arrived … but nothing changed".

### What homefix-01 is worth, and what it is not
- H1 alone, replaying the proposed predicate on every row of the fixed window: 581 → 814 of 2,338 (24.9% → 34.8%); on the
  non-interrupted rows 48.4% → 67.8%.
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
   death in 7 d is marked. **Water is not visible from positions alone** (an ocean region and an unvisited forest look the
   same): a region is labelled by its `_region_scan` (water / land counts) once a trip has scanned it, and by the
   `perception.blocks.water` counts of rows that ended near it; until then it is "unknown", ranked after scanned land.
4. **Baselines the expedition read needs:** log and ore per gather body-hour by band (§1.2, rolling), deaths per bot-hour
   by band, `home` success by start band and trigger (as §2), and bag-eligibility per town-hour (§1.3).

**Output.** `/var/lib/mcai/_pool-<pool>/frontier-<home>.json`, a generation file written atomically (the blueprint
`link()` protocol), plus a daily text. Nothing reads it until expedition-01.

**Why first.** It fixes the denominators before the design is coded (the 200-300 band's 15.5% log success, the ore hint),
and the expedition's target rule (§6.3) needs it. It costs no slot and touches no bot.

**Positive controls.** A fixture world with a known path and known visits; live, the census must reproduce §1.1's band
shares within 2 points over the same window.

---

## 5. E1 — homefix-01 (tier 2; the first step)

**What changes (each an exported pure function or a single decision point with a behaviour test):**
1. **H1:** `arrivedAt(pos, target, range)`, goto's existing final test, used by `home`'s grading (not goto's loop break).
2. **H2a:** every watchdog rescue (levels 1-3, the stranding climb-out) waits ≤ 10 s for the runner to go idle after the
   cancel, logs `_watchdog_rescue` with its outcome, and keeps its level if it could not start.
3. **H2b:** the watchdog's `pending` flag, released in `finally`, with sampling (both histories) but no verdict from
   either judgement while it is set, and the window reset at rescue start (§2 H2b, the liveness contract).
4. **H3:** the runner files any throw under its own aborted signal as `aborted / interrupted` (§2 H3).
5. `HOME_BUDGET_MS` below the skill timeout (170 s), so `home` ends on its own budget with its honest partial credit.

**Refusal chain (CLAUDE.md).** homefix-01 adds no refusal. H2 changes which remedy runs: a rescue that is genuinely stuck is
still judged on its own window, at most 180 s + 30 s hard-stop grace later, and escalates as today. Composed test: watchdog
+ `home` + an entombment reflex firing mid-walk → the reflex holds the body, home is interrupted and filed `interrupted`,
the watchdog does not escalate during the pending rescue, and escalates on the rescue's own window if the bot then stays
put.

**Paper scenes.**
- P0: a skill that takes 2 s to unwind after abort, then a stagnation verdict → the rescue starts (not `runner_busy`) and
  a `_watchdog_rescue` row is written.
- P1: a bot 3 blocks from an occupied home cell (chests at the home point) → `home` success.
- P2: a bot boxed in so it moves ≈ 1 block per 15 s → no cancel before the rescue's own window; then escalation 3.
- P3: an entombment reflex during `home` → `interrupted`, not `skill_error`.

**Read (tier 2: 20 bots, KEEP at +180, ≈ 3 h cool-off). KEEP rests on DETERMINISTIC per-mechanism checks in the arm**
(the owner's 09-29 rule: fixes get a correctness gate; Claude r1 P2-3), each 0 unless stated:
- G1: `home` rows ending `travel_incomplete` within 3 horizontally and 6 vertically of home: 0;
- G2: `skill_error` rows whose trigger is `interrupt:*`: 0 (any skill);
- G3: `home` / relocation rows cut by `interrupt:stagnation` within 20 s of their start: 0;
- G4: `_watchdog_rescue` rows: every escalation has one (rows = escalation events in the arm), and `busy` < 10% of them.
Positive control for each: the same query must find its defect on the control arm over the same window, or on the arm's
own 24 h pre-period (G1-G3 > 0, G4 rows absent); otherwise the gate is VOID, not passed. (G1 is ≈ 32 a day fleet-wide,
so a 3 h control window may hold none; the pre-period is the usual control.) **DiD as guards only:** deaths (two-death floor), `_stranded` per
bot-hour (a rescue that now lasts longer must not hide a stranding), stagnation level-1 events per bot-hour,
`_stagnation_reconnect` per bot-hour (expected to fall), and `home` success (reported, all rows and S0's filter).

**Exposure (corrected, Codex r1 P2-7).** The shared towns make ≈ 334 `home` rows a day in 60 bots, so 20 bots make
≈ 111 a day: ≈ 14 by +180, ≈ 28 by +360, ≈ 42 by +540. Exposure is **≥ 12 `home` rows AND ≥ 6 watchdog escalation-2
rescues in the arm** (5,436 escalation-2 events / 7 d / 80 bots × 20 bots ≈ 194 a day, so ≈ 24 by +180). Unexposed at +180 → extend to +360
and +540; still unexposed at +540 → INCONCLUSIVE (the owner's 10-15 early-close rule). The read never claims a `home` rate
from fewer than 12 arm rows.

**Dependencies.** None in flight. It also serves the overseer's RECALL gate (S0 measures `home` success).

---

## 6. E2 — expedition-01 (tier 3)

### 6.1 What it is
A bounded errand by **one bot per shared town at a time**: bank down at town → walk out 300-800 blocks on the surface to a
frontier region → scan and gather there → walk back along its own breadcrumbs → deposit at town (later, at an outpost).
Deterministic: a town job with its own order and lease, not a brain choice and not advice.

### 6.2 Who goes, and how many
- **One per town** (12 towns, ≤ 12 bots fleet-wide: 20% of the 60 shared-town bots, 15% of the fleet).
- **Three separate pieces of state (r2, Codex r1 P1-2):**
  - **Ownership** — `expedition-<home>.lease.json`, the treefarm/plinth lease pattern: one holder, a 10-minute TTL renewed
    only by PROGRESS (a breadcrumb gained outbound, one regained on the return, a gather success at the region). It
    fences two bots from both going; it is never what keeps a bot's return alive.
  - **The trip deadline** — absolute, written at departure: work ends at +45 min and the trip must be home by +90 min.
    Renewal never moves it.
  - **The return state** — `expedition-return-<bot>.json` in the pool state dir (survives a restart): the trail, the phase
    (`out` / `work` / `return` / `stranded`), the deadline. It is the bot's, not the lease's. Revocation, lease expiry
    and the deadline all switch the phase to `return`; nothing but ARRIVAL (home's predicate, or an outpost's), the bot's
    death (respawn is at home), or an operator `closed` deletes it.
  - **The return phase is a deterministic order** ranked above the brain's idle choice and below reflexes and the
    bag-full / spent-tool / no-pickaxe orders (the overseer design's starvation rule), on every decision until the file is
    gone.
  - **A town with an unresolved return state sends no one.** One expedition per town means one bot outside on an
    expedition, lease or not. A return state older than 6 h pages the operator (`_expedition_overdue`) and still blocks.
- **Eligible bot** (pure `expeditionEligible(readings)`, re-checked fresh at departure): health ≥ 18; no trap, drowning or
  low-health flag in 10 min; no other lease (builder, furnace, farm); a pickaxe ≥ 40% durability and an axe; at town;
  not the town's last bot at town (≥ 1 other stays for town jobs).
- **Bank-down first: new code, specified (Claude r1 P2-8).** `town_deposit` today fires only at ≥ 34 slots
  (towndeposit.mjs:38, 262, `TD_TRIGGER_SLOTS` = hygiene's 34), only inside 16 h / 12 v of home (towndeposit.mjs:40-41, 84), and never moves the iron ladder. So the
  expedition's bank-down is its own step, `expedition_kit`, a call of `town_deposit`'s plan function with a KEEP SET
  passed in, run only inside the town zone (16 h / 12 v, not the 48-block "at town" of §1.3):
  - the keep set: 1 pickaxe (the best), 1 axe, the scaffold reserve (32 cobble or dirt), 1 crafting table, 1 chest,
    torches, and the IRON_LADDER items exactly as today (no new iron policy);
  - everything else bankable goes to town containers; what the cobble cap refuses goes to the well (cobblekeep-01's
    path), never a new chest;
  - **departs only with ≥ 16 free slots.** Otherwise `_expedition_skip bag`: no refusal of anything else, the bot
    continues its normal order, and the next eligible bot is tried at the next tick. That is not a dead end: nothing is
    asked of the bot that it cannot do.
  - Paper: a 36-slot bag with cobble, logs, ore and tools → the kit, the cap refusal into the well, ≥ 16 free or a skip.
- **Selection among eligible bots:** the most free slots after a dry-run of the kit rule; ties by name rotation.
- **Cadence.** Next departure ≥ 30 min after the last return. Peaceful: no day/night rule.

### 6.3 How a target is chosen
- **From E0's frontier file:** the nearest unvisited region in the 300-800 ring, preferring the bearing away from spawn;
  never a region within 32 of a death in 7 d; never within 64 of the border.
- **Scouting is part of the trip.** At the region the bot runs a bounded scan of loaded chunks (logs, iron/copper/coal ore
  visible within 12 below its feet, water and lava counts) and writes a `_region_scan` row. E0 folds the scans, so the next
  trip from that town can prefer a region scanned rich over an unscanned one (score = scanned logs + ore, decayed by age).
- **The first trip from a town** goes to 300; each completed trip may step the ring out by 100 to 800. A failed trip
  (not home by the trip deadline, or a death) steps it back by 100.

### 6.4 Safety
- **Never sent** while trapped, drowning, low on health or with a full bag (§6.2). Peaceful: no mobs; hunger regenerates.
- **Bounded-risk surface travel, v1 (X3). Not a guarantee (Codex r1 P2-4).** `GoalNearXZ` does not constrain elevation,
  and goto can retry a leg with digging or a larger drop, so "surface" is a set of limits, not a promise:
  - outbound legs run with goto's **larger-drop retry OFF** and its dig retry ON (a dig can be climbed back through; a
    7-block drop cannot be climbed without scaffold);
  - every outbound leg records its net dy and whether it was a drop the walking profile cannot climb (> 1 block per
    step: `oneWay`); the trip keeps a **scaffold reserve** of 32 + the sum of its one-way drops, and a leg that would
    exceed what the bag holds turns the trip back;
  - an outbound leg ending more than 12 below the departure level, or under a solid ceiling, is refused and the trip turns
    to another bearing (the trip never goes underground on purpose);
  - no `mine` staircase on the trip; ore only by `gather` within 12 below the arrival level;
  - today's lava corridor guard (`lavaguard`), death-site pricing (`deathsites.mjs`) and blind-step guards, unchanged.
  This keeps the owner's diamond hold and the underground-safety order intact: the deaths are underground (TP §1.5) and at
  48-100 they are lava (§1.2).
- **Water is terrain** (owner standing rule): swimming is travel; the only water reflex is air.
- **Falls** are the outer bands' death (11 of 17 at 200-300). The return leg keeps goto's larger-drop retry (health ≥ 18,
  skills.mjs ~700), because going down on the way home is the cheap direction.
- **Hazard turn-back:** two hazard reflexes (drowning, lava, entombed, fall damage) on one trip → turn back.

### 6.5 Breadcrumbs, the return, and turning back
- **Breadcrumbs.** Every ≈ 32 blocks walked out, the bot records the standable cell it stands on (feet in air, solid below,
  no liquid) and the leg's dy / `oneWay` mark. The trail lives in the return state (survives a restart).
- **Return** walks the trail backwards, one breadcrumb per leg (`GoalNear` range 2 on a cell it has stood on). Standing on
  a cell proves it existed, not that the reverse leg is walkable; a `oneWay` leg is climbed with the reserved scaffold
  (the existing ascent profile), and §6.6 is the chain when a leg still fails. The last leg is `home`. It is one
  deterministic composite across as many skill calls as it needs, driven by the return state (§6.2).
- **Turn back on the first of:** bag ≥ 30 slots; 15 min of work at the region; the trip deadline's work end (+45 min);
  health < 14; two hazard reflexes; the pickaxe below a return reserve (the swing count of the scaffold reserve); the
  scaffold reserve not held; three consecutive failed outbound legs; the border margin; the lease revoked (a host-side
  `revoke` file, for the operator).
- **Between 30 slots and the shed rule at 34 (Codex r1 P2-5).** At 30 the trip is in `return`, and the return IS the
  executable remedy for a filling bag. If pickups during the return reach 34, the existing ballast shed applies (it sheds
  junk only), and the return continues. No new refusal sits in the gap.
- **The bag at the far end is never "advice".** Today's `deposit` admission is conditional (`farFromBank`, skills.mjs:5450,
  measures from SPAWN and looks for a usable chest within 48), and the `deposit` skill itself walks `home` first
  (skills.mjs ~2723). An expedition bot does not rely on either: its return phase is the remedy, and it runs.

### 6.6 What to do when lost
"Lost" here means no route, never unknown coordinates (the bot always knows x, z).
1. A breadcrumb leg fails → try the next breadcrumb (skip one), then the one after.
2. Then direct `GoalNearXZ` legs toward home at the bearing ±30°.
3. Below sea level → `surface` once (home's existing repair).
4. Still no progress after 3 rounds → phase `stranded` (`_expedition_stranded`). The return state stays; the bot works
   locally between attempts (gather by hand: it can always gather or wait), and the return order re-fires every 10 min,
   each attempt starting from step 1 with the trail re-read. It never teleports or edits the world.
5. The lease's TTL lapses (no progress), but the return state does not: **the town sends no one else** while it exists
   (§6.2). Past 6 h the operator is paged; a human `closed` or the bot's arrival or death ends it. The watchdog keeps
   running throughout; with homefix-01 its rescue gets its full window.

Every step names a remedy executable from where the bot stands; the composed test runs the whole chain (§6.8).

### 6.7 Interaction with the "go home" problem
- The trip does not depend on `home` except for the final ≤ 32 blocks, which are inside the band where healthy-surface
  `home` succeeds (and homefix-01's H1 is exactly that leg).
- **The watchdog and a trip (Claude r1 P3).** A walking bot is not stagnant (it moves ≥ 8 blocks per window), so the
  watchdog fires only when a trip is already stuck. Then, after homefix-01: level 1's random 45-70-block relocation may
  take the bot off the trail, and the return state re-plans from the nearest breadcrumb; level 2's `home` is the return's
  own destination; level 3's reconnect restarts the bot, which resumes from the return state. Before homefix-01 most of
  those rescues never start (H2a) or are cut at 15 s (H2b), which is why homefix-01 comes first.
- RECALL (the overseer) and expeditions share homefix-01; neither shares an instrument with the other.

### 6.8 Paper tests
- X-P1: a 400-block route across a river, a 6-block drop and a lava pool → out, scan, gather, back along the trail, deposit.
- X-P2: a breadcrumb blocked after departure (a placed block) → skip, then direct legs.
- X-P3: kill / disconnect mid-trip → restart resumes from the return state; lease TTL lapse does not end the return.
- X-P4: bag fills at the far end → turn back, return, deposit.
- X-P5: target region at the border margin → refused at selection, not on the way.
- X-P6 (composed refusal chain): a bot at the far end below an irreversible 7-block drop, scaffold spent and pickaxe broken
  → it still has a legal move (gather by hand, wait, retry the chain), the town sends no second bot, the overdue page fires.
- X-P7: revocation mid-outbound → phase `return`, the return order runs; revocation never strands.
- X-P8: two eligible bots at departure time → exactly one lease; the other continues its normal order.
- X-P9: repeated failed return legs → the order re-fires each 10 min and the lease never renews without progress.

### 6.9 Read and metric (tier 3; unit = the town; 4 drawn shared towns = 20 bots, randomized; DiD)
- **Primary:** ore (raw iron, raw copper, coal) + logs **banked into TOWN (or outpost-record) containers** per bot-hour
  in the arm, DiD against control towns, pre-registered null from a pre-period. INCONCLUSIVE is a legitimate close.
  Containers are matched by position: `deposit` will bank into any non-deep chest within 48 at home's level band
  (skills.mjs ~2687-2693; `depositTargetOk` has no horizontal term), so a haul banked into a village chest out there is
  NOT banked (Claude r1 P2-6).
- **Exposure:** ≥ 8 completed expeditions (returned and deposited) in the arm, of which ≥ 2 reached beyond 400. The ring
  starts at 300 and steps out by 100 per success, so a first read exercises mostly 300-400; 500-800 is a later read's
  claim, not this one's.
- **Secondary:** new 64-regions visited per town-day (E0); items gathered beyond 200 per bot-hour; median distance
  reached; trip time split (out / work / back).
- **Gates:** deaths beyond 200 (two-death floor, > 1.25× control; a death within 120 s of an expedition row is
  mechanism-linked); `_expedition_stranded` lasting > 30 min; bots not back within the TTL; town job coverage
  (`town_deposit`, `smelt_town` per town-hour must not fall beyond its null band).

**Dependencies.** homefix-01 KEPT; cobblekeep-01 KEPT (bags); E0 live 48 h with its self-test passed.

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
  - its refusals name remedies executable there: "outpost chests full" → continue the return to town (the return phase
    is already the next order); "nothing the outpost takes" → continue to town.
  - Admission and `farFromBank` are not changed in v1: a non-expedition bot near an outpost banks at town as today.
- **What an outpost chest takes:** only DEPOSIT_ALWAYS and project materials (logs, saplings, raw metals, ingots, coal) —
  never cobble, dirt or junk. So the town's cobble cap and stock targets are not bypassed and the outpost never becomes a
  dump. Paper: an outpost 9 blocks below home's level, full outpost chests, and a blocked return from the outpost.
- **Stock.** The outpost has its own journal (`outpost-chest-<id>.jsonl`); the town's stock targets do not count it in v1.
  A haul job (outpost → town; a later foreman `SUPPLY` candidate, or rails) brings it home.
- **Expedition after an outpost:** turn back to the outpost when it is nearer than home; return home every Nth trip or
  when a town job needs the bot.

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
- Refusal: "outpost chest refuses cobble" names a remedy executable there: carry it home, or (with a well) the well; with
  neither, the bag's existing shed rule at 34+ slots. Composed test: an expedition bot at an outpost with a cobble-full bag.
- Paper: OP-P1 found and build; OP-P2 deposit to the outpost from the expedition return; OP-P3 cobble refused, logs taken;
  OP-P4 a `mine` near the outpost turns its bearing (keep-out); OP-P5 the outpost destroyed by a bystander → record marks
  it lost, no rebuild loop.
- Read: primary as expedition-01's (banked per bot-hour, outpost banking counted when hauled or as its own line); exposure
  ≥ 1 outpost founded in the arm and ≥ 5 deposits into it; gates as §6.9 plus 0 outpost cells lost (world read, arm only).

**Dependencies.** expedition-01 KEPT; monument-01 KEPT (structureguard + builder.mjs on the fleet).

---

## 8. E4 — rails (tier 2 / 3; gated; last)

**Cost against iron.**
- Rail: 6 iron + 1 stick → 16, so **0.375 iron per block**. A minecart is 5 iron.
- Town ↔ shaft collar (TP §4.7): 17-21 blocks surface, ≈ 8 iron; one landing per town ≈ 29 iron (TP's figure); a full
  shaft 175-205.
- **Town ↔ outpost at 300 / 400 / 800 blocks: ≈ 113 / 150 / 300 iron** + 2 carts (10) per line. Observed iron per shared
  town: median 184 (TP §1.1); net fleet inflow ≈ +50 a day (TP §1.3), i.e. ≈ 4 a town a day. **A 400-block line is 150
  iron of rail, 160 with two carts: 82-87% of a median town's observed iron stock, about five to six weeks of its
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
- homefix-01 takes the first free slot once built and approved (tier 2, ≈ 3 h + cool-off); it never holds the head. The
  queue owner inserts it. **Tie-break with shaftuse-01** (also first-free-slot, TP O2): whichever is approved first; if
  both are ready, homefix-01 first (tier 2, ≈ 3 h, and shaftuse-01's routing legs inherit its watchdog fix).
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
| **X1** | homefix-01 changes the stagnation watchdog fleet-wide (no judging while a rescue is pending). It will reduce reconnects and lengthen rescues | **yes**, tier 2 |
| **X2** | expedition-01 before pavilion-01, or after crown-01 | **before pavilion-01** |
| **X3** | expedition v1 surface-and-shallow only (no `mine` staircase on the trip, ore within 12 below arrival), while the diamond hold and underground safety stand | **yes** |
| **X4** | one expedition per shared town at a time; isolated pools excluded in v1 | **yes** |
| **X5** | outposts accept only valuables (no cobble or junk), one per town in v1 | **yes** |
| **X6** | rails: build a line only when R0 shows ≥ N trips a day on it (N proposed 12); unpowered (no gold) | **yes**; the owner sets N |
| **X7** | O11 (TP): lift `rail` from the junk list before R1, or rails crafted only inside the placing skill | decide at R0b |
| **X8** | an expedition that reads INCONCLUSIVE twice (unmoved banked ore + logs) closes the line of work until E0 shows the near ring depleted further | **yes** |

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

**r2 takes in every finding; none rejected.**

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

### Round 2 (r2): pending.
