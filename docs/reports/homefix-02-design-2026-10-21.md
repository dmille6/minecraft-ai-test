# homefix-02: why homefix-01 drowned two bots, and the targeted fix (2026-10-21, design r1)

homefix-01 (`a52d075e`, branch `homefix-on-9e7d998`) was REVERTED at 2026-10-21 00:57Z by gate v23: two canary deaths, one
with a licensed `_watchdog_rescue` row. Both deaths were hive-d-Echo, and both were drownings. This document gives each
death's causal chain from the rows, estimates the fleet-wide risk with denominators, and specifies homefix-02. homefix-02
is homefix-01 (H1-H4 unchanged) plus three targeted changes (C1-C3) and the read changes. OWNER approved homefix-02 to
build and run at ~01:20Z (the X1 exception now covers it); the coordinator queues it.

Evidence scripts are in `scripts/host/homefix02/` on this branch, and their outputs are on 10.0.0.31 in `~/mcai-analysis/homefix02/`.
World reads came from the saved region files on 10.0.0.30 (`/srv/block2/<pool>/world/region`), read-only and copied
for reading. The files are the live state at ~01:10Z.

## 0. Answers first

1. **Death 1 (20:19:20Z) was an ice-sheet trap that a homefix-01 relocation walked the bot into, and a base-code bug in
   the drowning rescue killed it.** A level-1 relocation took it 52 blocks onto a frozen river in hive-d (`frozen_river`
   biome: an ice sheet at y=62 over 1 block of water at y=61, dirt floor at y=60). On the base code that relocation would
   not have run, because it started 4.8 s after cancelling a live `gather`, which is the H2a case. The brain's own
   `gather dirt` then dug through the ice and dropped the bot into the 1-block water layer under the sheet. Once its head
   cell was ICE, the drowning rescue's route scan **skips the head cell**. It reported `up dist=1`, meaning the air above
   the ice, and held `jump` into the ice for 93 s. That one wrong answer switches off both rungs that could have helped:
   the air-pocket dig never triggers on an `up` route, and its plan refuses a head cell that is not water. The
   "yield at 17.5 HP" was a 0.5-s gap, not the cause (§1.3).
2. **This is a base-code killer, not a homefix-01 invention.** Over 7 d (10-14..10-21, ES), 92 drowning deaths on the
   old code included **11 with the head cell under ice**. All 11 were hive-d bots at y = 61.2-61.4 under the same river
   sheets, and the route read `up` in each. That is 11 of hive-d's 18 old-code drownings that week.
3. **Death 2 (00:50:35Z) is not linked to homefix-01.** The brain's `explore` walked off a ledge into a pool whose magma
   floor drives downward bubble columns. The bot was dragged to y≈45 under single placed blocks (dirt, cobble, granite)
   that earlier bots' escape reflexes left in the pool. The route scan read `unscanned` (capped above, open water for 8
   on every side). The air-pocket dig was refused ("water beside the roof cell would fill the pocket"), and the bot
   drowned. No rescue or stagnation cancel was involved. The last rescue was a relocation that failed after 1.8 s,
   5.5 min earlier. **The same pool killed two old-code bots** (hive-d-Bravo 10-17 11:19 and 10-20 11:13).
4. **DiD: no drowning excess.** The four canary pools drown 2.5x as often as the control pools on the old code (0.0126
   v 0.0050 per bot-h, 7 d). Against its own baseline the canary saw 2 drownings where 1.41 were expected. The control
   saw 3 where 1.69 were expected. The ratio of ratios is 0.80. The revert was legitimate under gate v23, which applies
   the two-death floor plus a licensed change row. On a difference-in-differences reading the deaths are hive-d's
   terrain, with one real mechanism link: death 1's relocation.
5. **Risk.** homefix-01 runs about 3.6x as many relocations per verdict (98% v 27%, H2a working as designed).
   - **The old relocation target is blind to terrain:** a random point 45-70 blocks away at the bot's current y.
   - **Canary relocations, where they ended.** Successful ones ended wet (in water, on ice, or within 2 blocks of either)
     in 16 of 85 (18.8%). That is about the canary's ambient rate of 19.8% (245/1240 bot-snapshots).
   - **Ice sheets in hive-d.** 4 of 26 hive-d relocation successes ended **on an ice sheet over water** (15.4%), against
     4.3% ambient there.
   - **Rescue-adjacent drownings on the old code.** A drowning within 180 s and 16 blocks of an uninterrupted watchdog
     rescue's end happened in 8 of 92 drownings (8.7%). That is 0.84 per 1,000 rescues (8 / 9,498).
6. **homefix-02 makes three changes.**
   - **C1:** the route scan reads the head cell. A solid head cell caps `up`, and the air-pocket rung may break a head-cell
     ICE block that has air above it. This is the existing ice branch at dy = 1. The bug is old; it is fixed here because
     homefix sends more bots into hive-d's river.
   - **C2:** a relocation goes only to a dry, standable surface cell. That means no ice floor, no water or ice within 2,
     and no liquid overhead. If no such target turns up in 16 tries, the rescue goes straight to level-2 `home`.
   - **C3:** no runner rescue starts while the bot is submerged. The decline is capped at 2 in a row. A running watchdog
     rescue gives way when the air reflex seizes the body.

   H1-H4 are untouched. Tier 3, reads as homefix-01. A new defect gate G5 checks the mechanism's own invariants, and a
   new G6 counts rescue-adjacent drownings (1 blocks KEEP, 2 REVERT).

## 1. Death 1 — hive-d-Echo, 20:19:20Z, (-14.5, 61.4, 54.3), "drowned; idle"

Rows: `/var/log/mcai/hive-d-Echo/skill-hive-d-Echo.jsonl-20261021.gz` (10-20 data), 448 rows 20:00-20:22. A row's
`@timestamp` is its START and its snapshot its END.

### 1.1 Terrain (saved world, read-only)

`frozen_river`. Columns x=-22..-8, z=48..60: **ice at y=62 in every column**, air above it, **water at y=61**, and a dirt or
sand floor at y=60 (deeper water to the east). In the bot's column (-15, *, 54): y=60 dirt, y=61 water, **y=62 ice**,
y=63+ air. The holes the bot dug are all ice again at the 01:10Z save. A frozen river refreezes an exposed water
surface on random ticks, about every 200 s per column on average. A placed dirt block at (-15,61,52) is the
`maroon_escape` placement at 20:17:21. Positive control: the same reader finds stone bricks and a chest at the town
cell (67,64,69) and plain water at the death-2 pool.

### 1.2 Chain

| time (start) | row | what it says |
|---|---|---|
| 20:12:55 | `gather dirt` (llm:idle) | at 28.5,62,84.4, about 40 blocks W of town; dirt found but unreachable |
| 20:14:07 | `gather dirt` | **failed / interrupt:stagnation**, d=36.4 s (ends 20:14:43.4) |
| 20:14:39 | `_stagnation` L1 + `_watchdog_rescue requested` | moved 2.5 blocks in 90 s of active time |
| 20:14:44.3 | `_watchdog_rescue started` | 4.8 s after the cancel, i.e. after the gather unwound. **On the base code this `run()` returns `runner_busy` and nothing moves (H2a).** |
| 20:14:44 | `goto` watchdog_relocate → success d=12.6 s | target (-16,64,53) chosen at random; **"arrived at -15,63,55": standing on the ice sheet** |
| 20:16:07 | `gather dirt` (llm:idle) | `_dig_approach dirt -15,58,53: planned 1 block ... attempted=ice dug=ice` → **the brain's gather dug the ice**; the bot is in the water layer at y 61.8 |
| 20:16:14 | `_water_surface` | head water, health 20 |
| 20:16:49 | `mine y59` failed | "water in the headroom ahead — and in every other direction" |
| 20:16:57 | `_path_no_legal_move sealed_in_liquid`, `_marooned` | climbs; places dirt at 20:17:21 |
| 20:17:30 | `gather dirt` | digs ice again (`_dig_approach ... dug=ice`); the bot drifts to z 54.3 |
| 20:17:32-37 | `_water_surface` x4 | bobs 61.2 → 63.6 (it reaches air in the hole) |
| 20:17:40 | `_stagnation` L2 → `_watchdog_rescue` requested + started (same ms) | **the bot is in water with its head under**; `home` starts |
| 20:17:40 | `_path_no_legal_move sealed_in_liquid startLiquid=true` | home's goto cannot plan |
| 20:17:43 | `_goto_float_dig` | "ice at -15,62,55 ... confirmed=true": home opened the ice BESIDE the head, not over it |
| 20:17:47 | `_air_drowning_observed` | "oxygen 8, **head block ice**, health 20" |
| 20:17:49 | `_oxygen_critical_state`, `_drowning_route` | "**up dist=1** at -15,61,54"; phase `up` (hold jump) |
| 20:18:09 | `_drowning_ceiling_no_air` | held 21 s, never reached air, health 19 |
| 20:18:29 | ceiling 2 → `_drowning_rescue_yielded` | "2 ceilings ... no harm (health 17.5)" |
| 20:18:30 | `_water_surface` "(head ice)" → `_drowning_route up dist=1` | re-seized 0.5 s later |
| 20:18:32 | `_watchdog_rescue interrupted:stuck` | `home` aborted by `_reflex_stuck` (no movement 35 s), d=51.6 s |
| 20:18:50, 20:19:11 | ceilings 3, 4 (health 10.5, 3.2); yield again at 20:19:11 | each followed within 0.5-1 s by `_water_surface (head ice)` + `up dist=1` |
| 20:19:20 | `_death` | drowned; hp 1.5 → 0 over 4 s |

### 1.3 Why the rescue never recovered (the code, `reflex.mjs` on a52d075e = base)

- `headBlock(bot)` is the cell at feet+1. At y 61.4 that is (-15,62,54): **ice**, four readings in 93 s.
  Server-side, the bot fits in the 1-high water gap only in the swimming pose, so its eye is in water and it drowns.
  The client believes it stands at 61.4.
- `scanBreathableRoute` starts at `dy = 1` **above the head cell** and never tests the head cell itself. At(0,1,0) is
  (-15,63,54): air, so it returns `{dir: 'up', dist: 1}`. `drowningControls` then holds `jump`, which pushes into the ice.
- `airPocketTrigger` returns false for `routeDir === 'up'`. `airPocketPlan` would have refused anyway: "head cell is
  ice, not water". Its existing ICE branch only looks at dy 2-3, ice ABOVE a water head cell. So the one rung that
  breaks ice never ran. Positive control: the same rung did run on the fleet this week. `_air_pocket_refused` rows
  appear in death 2.
- `_flooded_pocket_rung` refused: "no air to start with".
- **The "yield at 17.5 HP".** `drownRescueSuppressed` compares health with `drownFailHealth`, and that reference is
  re-stamped on the same tick at every ceiling expiry. So the check that runs right after an expiry always sees "no
  harm". The bot yields for one tick, health falls 0.5 s later, and the rescue re-seizes, as the 20:18:30 and
  20:19:12 rows show. The message is wrong and the yield is harmless. **It is not why the bot died.** It is not changed
  here; see follow-up F3.
- The level-2 `home` that started at 20:17:40 found no path (`sealed_in_liquid`). Its float-dig opened the ice at
  (-15,62,55), next to the head. A correct route scan would then have read `out dist=1` with air one up at (-15,63,55)
  (`AIRUP@1`) and swum the bot into that hole. The wrong `up` answer came first, so the sideways scan never ran.

### 1.4 Base-code comparison

- **The fatal step needed homefix-01's relocation.** On the base code, the 20:14:44 relocation starts 4.8 s after the
  cancel, and that is exactly H2a's `runner_busy`. Positive control for H2a in this window: control-arm level-1
  verdicts 723 against 196 control `goto watchdog_relocate` rows (27%), and canary verdicts 224 against 220 relocation
  runs (98%). Without the relocation the bot stays about 40 blocks W of town, at (28,62,84), not over the river.
- **The trap itself is old.** It killed 11 old-code hive-d bots in 7 d with this exact signature (§3.1). They reached the
  ice on their own: livelock rungs, `goto`, `mine`, or `gather` digging ice.
  - hive-d-Alpha 10-16 22:40 has a `_goto_float_dig ice at 169,62,205 ... confirmed=true` 59 s before its death.
  - hive-d-Echo 10-14 13:28 has a `_dig_approach` for dirt under the river at 33,58,62.

## 2. Death 2 — hive-d-Echo, 00:50:35Z, (99.2, 48.2, 109.7), "drowned; was running explore"

Rows: the live file `skill-hive-d-Echo.jsonl` (10-21), 474 rows 00:25-00:52.

### 2.1 Terrain

`snowy_beach`. A pool at x 92-103, z 108-116, water from y 45 to y 52-53, with air above. **Magma blocks at y=44** at
(95,44,111), (96,44,111), (94,44,112), (96,44,112), (95,44,113) and more. Above them sit **`bubble_column` cells
(downward, over magma) from y 45 to y 52**. Inside the pool are dozens of single dirt, cobble and granite blocks at
y 47-53, among them (98,48,110), (99,50,110), (98,50,109), (98,51,112) and (98,52,111). These are earlier escape-reflex
placements, matching `cause=entombed_escape cobblestone -1, granite -2` (00:48:58). They cap most straight-up routes
out of the deep water.

### 2.2 Chain

| time | row | what it says |
|---|---|---|
| 00:25-00:39 | 10 x `gather sand` failed | "all 6 candidates are beside water or under falling blocks" (at 103.5,53,105.5) |
| 00:41:35 | `explore` → iron_ore at 120,49,87 | legs refused by `_lava_corridor` (magma counts as lava) and `blind_step` ("death:drowning x1 recorded at 99,52,117 on the line") |
| 00:42-00:44 | about 80 `_water_surface`/`_water_float` rows | bobbing at 96.7, 50-52.6, 110.3, air 19-20/20: swimming, not drowning |
| 00:45:02 | `_stagnation` L1 → rescue requested + **started in the same ms** (the runner was idle) | `goto` watchdog_relocate target 86,52,166 |
| 00:45:02 | goto **failed / goal_changed after 1.8 s**, 0 legs | "a competing goal replaced the route"; `_lava_corridor` refused the leg at 00:45:03.978. Terminal `completed:failed` 00:45:04 |
| 00:45:36 | `gather sand` success | ends 98.5,56,108.5, dry |
| 00:46:34, 00:47:47 | `explore` x2 | **aborted / interrupt:entombed** (walled in at y 53/54; escapes place granite) |
| 00:48:38 | `explore` → iron_ore at 70,49,109 | the planned route crosses the recorded drowning site; `_death_site_route_crossed no_effect` |
| 00:48:46-47 | blind steps refused, the bot descends 48.7 → 45.9 | `_reflex_danger_block bubble_column` → explore **aborted / interrupt:danger_block**; `_fall_path` "fell 8 ... liqdrop=true ... feet bubble_column head bubble_column" |
| 00:48:50 | `_water_no_air_route` | head water |
| 00:48:58 | `_air_drowning_observed` oxygen 8; `_inventory_mutation entombed_escape` | escape placed blocks while submerged |
| 00:49:01 | `_drowning_route` **unscanned dist=-1** at 98,46,110 | capped by dirt at (98,48,110); all four sides water for 8 |
| 00:49:09, :40, 00:50:12, :33 | `_air_pocket_refused` x4 | "water beside the roof cell would fill the pocket" |
| 00:49:21-00:50:24 | ceilings 1-4; yields at 18.3 and 4.7 HP (the §1.3 artefact) | `_flooded_pocket_rung refused: cell y=48 would let liquid in` |
| 00:50:27 | `explore` (the brain, at 3.7 HP) | moves 2 blocks, row ends interrupt:death |
| 00:50:35 | `_death` | drowned at 99.2,48.2,109.7 |

### 2.3 What death 2 did not involve (each with its positive control)

- **No rescue in the fatal 5.5 min.** The bot's `_watchdog_rescue` rows sit at 00:45:02-04 (attempt -17) and at
  00:50:48 (attempt -18, after the respawn), and none between. The same stream logged 251 canary terminal rows in the
  window, so the instrument sees rescues.
- **No stagnation cancel.** The four explore runs ended `interrupt:entombed` x2, `interrupt:danger_block` and
  `interrupt:death`. Positive control: the same bot's 20:14:07 gather ended `interrupt:stagnation`, so the
  classification is visible.
- **No H2a dependence.** The 00:45:02 relocation was requested and started in the same millisecond with the runner idle,
  so the base code runs it too.
- **On the base code.** The same pool drowned hive-d-Bravo at 98.7,50.2,111.3 on 10-17 11:19. That death came after an
  old-code `goto watchdog_relocate` "arrived at 97,50,109" at 11:11, i.e. a base relocation INTO this pool. It drowned
  hive-d-Bravo again at 99.5,52.2,117.3 on 10-20 11:13. **Death 2 would very plausibly have happened on the base
  code.** C2 would refuse a relocation target like 97,50,109, which is water.

## 3. The risk estimate (denominators first)

### 3.1 Drownings, 7 d, old code (ES, 10-14 00Z .. 10-21 01Z; 10.18 M skill docs, 80 bots)

- **Drowning deaths: 92** (of 260 deaths of all causes). By pool: hive-d 20 (2 of them homefix-01), placebo-d 11,
  placebo-b 9, hive-c 5, board-c 3, and the rest 2-5 each. The canary arm's four pools are 20 bots with 43; the other
  60 bots have 51.
- **Rates per bot-hour on the old code.** Canary pools 41 / 3,268 bh = 0.0126; control pools 51 / 10,140 bh = 0.0050.
  - **Canary window, expected v observed.** At its baseline the canary expected 1.41 drownings in 112 bh and saw 2. The
    control expected 1.69 in 336 bh and saw 3. The ratio of ratios is 0.80.
- **The head-cell evidence in the 180 s before each drowning.** The reflex rows print it: `_air_drowning_observed`,
  `_water_surface` and `_water_no_air_route`.
  - **Water only:** 80.
  - **Under ice: 11**, all hive-d, all at y 61.2-61.4, all with `_drowning_route up` (dist 1).
  - **Under dirt:** 1 (placebo-d-Bravo 10-17).
  - **Population:** 94,925 `_water_surface` rows, of which 58 read "(head ice", and 9,017 `_air_drowning_observed` rows,
    of which 22 read "head block ice". So ice heads are rare and lethal.
- **Rescue-adjacent drownings** (death within 180 s after an uninterrupted `trigger: watchdog_*` row ended, within 16
  blocks of its end). The old code had **8** drownings plus 2 lava deaths, out of **9,498** such rows (8,593 relocate,
  905 home). Per 1,000 rescues that is 0.84 drownings. The trigger is lost on interrupted rows, so this is a lower
  bound.

### 3.2 Where homefix-01's rescues ended v where the bots stand (files, 19:21:21Z .. 00:57Z, 338,016 rows, 80 bots)

Rows walked completely: hive-d-Echo 4,295 and placebo-a-Alpha 4,392, both identical by an independent per-file count.
World classification is from the saved region files. "Wet" means feet or head in water, OR standing on ice, OR
water/ice within Chebyshev 2 at dy -2..+1. Positive control: death 1's cell reads `feet water, head ice`, and the
arrival cell (-14.5,63,54.5) reads `below ice, ice_over_water`.

| set | n | wet (any) | on ice over water | feet/head in water |
|---|---:|---:|---:|---:|
| canary: L1 relocation, completed:success (end) | 85 | 16 (18.8%) | 4 (4.7%) | 6 (7.1%) |
| canary: all terminal rescues (end) | 251 | 40 (15.9%) | 4 (1.6%) | 23 (9.2%) |
| canary: L2 home (end) | 15 | 3 (20.0%) | 0 | 3 (20.0%) |
| control: goto watchdog_relocate success (end) | 103 | 4 (3.9%) | 0 | 4 (3.9%) |
| canary ambient (1 per bot per 5 min) | 1,240 | 245 (19.8%) | 13 (1.0%) | 152 (12.3%) |
| control ambient | 3,704 | 475 (12.8%) | 0 | 363 (9.8%) |
| hive-d: relocation successes / ambient | 26 / 303 | 42.3% / 34.7% | **15.4% / 4.3%** | 15.4% / 21.5% |
| old relocation TARGETS: canary / control | 171 / 196 | 15.8% / 4.1% | 1.2% / 0 | 4.7% / 2.6% |

- **Rows after a rescue ended (120 s).** Water reflex rows followed 27 of 179 canary and 24 of 210 control uninterrupted
  rescue rows. Drowning-signal rows (`_air_drowning_observed`, `_oxygen_critical_state`, `_drowning_route`, ceilings)
  followed 2 of 251 canary terminal rows and 0 of 210 control rows. The ambient rates are 8/1,240 canary and 7/3,704
  control. The two canary hits are death 1's home rescue and placebo-b-Delta's 23:09 relocation, which ended in water
  and survived.
- **Reading.** A canary relocation lands about as wet as a canary bot already stands (18.8% v 19.8%). The added risk is
  **volume**: 3.6x more relocations per verdict. On top of that, **hive-d's ice sheets attract relocations**: flat, open
  and pathable at the bot's own y. The target rule ignores terrain. Simulated on the saved worlds (sim.py), the old
  rule's target is a dry standable surface cell for only 102 of 224 canary L1 verdicts. Of the rest, 99 have no surface
  within ±8 of the bot's y, 9 have an ice floor, 9 are not standable and 5 have water nearby.
- **Control has no ice world.** Its ambient on-ice count is 0 of 3,704, while the same classifier finds 16 of 303 in
  hive-d. So the ice trap is a hive-d phenomenon, and C1's exposure exists only when hive-d is drawn.

### 3.3 Sizing C2 and C3 on the same starts (sim.py, read-only on the saved worlds)

- **C2 finds a dry target within 16 tries for almost every verdict.** Canary L1 verdicts: 221 of 224 (98.7%), at a mean
  of 3.0 tries. Shared control pools: 451-469 of 476-486. hive-b is lowest at 81 of 85; hive-d is 61 of 61. The
  fallback to `home` is therefore about 1-5%. Isolated pools were not classified: their pool names do not map to a
  world dir.
- **C3a would decline, as "submerged":**
  - **Canary L1:** 0 of 223 requested rescues. Positive control: control L1 verdicts 24 of 723 (3.3%).
  - **Canary L2:** 2 of 16, one of them death 1's.
  - **Control L2:** 9 of 123.
  - **Control L3:** 6 of 45.

## 4. homefix-02 — the changes

Base: the fleet sha in the manifest at 01:35Z, **9e7d9980** (toolkit-03 `34d3e5e9` is live as a canary on
board-a, placebo-a and hive-b; if it KEEPs and is promoted before homefix-02 launches, homefix-02 needs a re-stack onto
the new fleet sha). Branch **`homefix02-on-9e7d998`** = homefix-01's head `a52d075e` + the commits below. **H1, H2 (the
whole contract), H3 and H4 are unchanged**; every homefix-01 test still runs.

### C1 — the drowning rescue reads its own head cell (reflex.mjs, airpocket.mjs)

- **`scanBreathableRoute`** gets `at(0,0,0)`, the head cell. A head cell that is **not swimmable** (solid: ice,
  dirt, ...) caps the up scan at dy 0, so **`up` is never answered through a solid head cell**. The sideways scan runs
  unchanged. With all four sides closed the answer is `sealed`, which is what lets the air-pocket rung fire at once.
  A null head cell sets `unknown`, as any null cell does, so it is never `sealed`. A swimmable head cell gives exactly
  today's answer, and a test pins that.
- **`airPocketPlan`** gains one case. If the HEAD cell is plain `ice`/`frosted_ice` (the existing `ICE` regex: not
  packed or blue ice, which do not melt) with **air directly above it**, the plan returns `{ok, kind: 'ice', dy: 1}`.
  The feet cell must be water or air, as today. Everything after the plan is the existing ice branch:
  - the health-budget admission;
  - the bounded equip, then the dig;
  - `opened` = water or air (breaking ice over water leaves water);
  - the rise and confirm;
  - `standInPocket` with `airY = fy + 2`, i.e. one block placed under the bot so it stands with its eye in air.

  Packed or blue ice and every other solid head cell keep refusing. They are left to the entombed and suffocation
  handlers, which own a solid head.
- Why this is safe:
  - The air-pocket gates are unchanged: never on `up`, admission by the health envelope, a 60-s fail cooldown, and
    `airPocketPreempt` only on `sealed`.
  - The only rescues whose answer changes are those with a non-swimmable head cell. That is 83 of 106,268 reflex
    head-block readings in 7 d: 81 ice, 2 dirt. glow_lichen (6) is swimmable and unchanged.
  - Breaking ice from below in Java turns it into water only when a solid or liquid block is under it, and here water
    is under it. Paper scene S1 confirms this on 1.21.8.

### C2 — a relocation goes somewhere dry (relocate.mjs, new and pure; watchdog.mjs)

- **`pickRelocationTarget({ p, read, rand, tries = 16, minD = 45, maxD = 70, radius = 2 })`** → `{ ok, x, y, z, tries }`
  or `{ ok: false, why: 'no_dry_target', reasons }`. Each try picks the old bearing and distance. The candidate passes
  only when all of these hold:
  1. `columnSurface(read, x, z, round(p.y))` (plinth.mjs; the surface within ±8 of the bot's y) is a floor `f`, so
     the feet are at `f + 1`;
  2. `standable(read, x, f + 1, z)` (plinth.mjs: feet and head passable and not liquid, floor solid);
  3. the floor is not ice, packed, blue or frosted ice, nor magma;
  4. the cell over the head (`f + 3`) is not liquid;
  5. **no water, lava, bubble column, waterlogged block or ice within Chebyshev `radius` = 2 at dy -2..+1** of the feet;
  6. **every one of those cells is readable.** A null (unloaded) cell refuses the candidate; it is never taken as dry.
- **The goto target becomes the surface cell** `{x, y: f + 1, z}`, not `(x, p.y, z)`. The requested row records
  `target`, `dry_tries` and `fallback`.
- **No dry target in 16 tries, so go to level 2 now.** The bot is in a wet region (ocean, swamp, river delta). The
  remedy it can still perform is `home`, which is known terrain. The watchdog sets `escalation = 2` and runs the
  level-2 plan with `reason: 'no_dry_relocation'`, written as one `requested` row with `level: 2, remedy: 'home',
  fallback: 'no_dry_relocation'`. Measured at about 1-5% of L1 verdicts (§3.3).
- **What it does not do.**
  - It does not check the WAY. The pathfinder may still cross water: swimming is travel.
  - It does not check where a FAILED relocation stops. A failed goto ends wherever its leg stopped. G6 measures that
    outcome.
  - Level 2 (`home`) and level 3 are unchanged.

### C3 — a rescue does not take a submerged body; a running rescue gives way to the air reflex (watchdog.mjs, reflex.mjs, runner.mjs)

- **C3a.** Before `reserve()`, `#runRescue` asks `submergedNow(bot)`. The answer is true when the head cell is not
  `breathable()` AND the bot is in water, which means `entity.isInWater`, a wet feet or head cell, or an ice head cell
  over a wet feet cell.
  - **When submerged:** log `declined:submerged` with the head block's name and return `started: false`. The existing
    ladder holds the level and backs off one window.
  - **The cap.** A pure `submergedDecline({ submerged, streak, sinceLastMs, ttlMs, cap: 2 })` lets the 3rd consecutive
    submerged verdict (within the same TTL as reserve_expired) through. That covers a bot that has been "submerged" for
    2+ windows (6+ min). Such a bot is not drowning, since a drowning ends in about 100 s in peaceful. Its head is in
    seagrass or kelp, or it is a misread. It gets its rescue rather than a dead end.
  - **Scope.** It applies to every runner-based rescue: L1, L2, L3 `surface`/`mine`, and the stranding climb-out (a
    climb-out that does not start is not one of its two attempts, as today). The L3 reconnect needs no runner and is
    unchanged.
- **C3b.** When the air reflex SEIZES the body and the runner's current run belongs to the watchdog (`current.owner ===
  'watchdog'`, one field added to `current`), it calls `runner.interrupt('drowning')`. The rescue's terminal row reads
  `interrupted:drowning`, the pending rescue clears, and the next verdict is judged on the bot's own window. Today such
  a run sits inside the drowning: death 1's `home` sat there 52 s until `_reflex_stuck` cut it. Skills the brain
  started are untouched. Whether the reflex should also interrupt those is a different, unmeasured question.

### Not changed (named so nobody reads them as fixed)

- **F1, death 2's pool.** Fixing it needs a 3-D breathable route search (BFS through swimmable cells to the nearest air
  within N). Today's scan is "straight up, or 8 cardinal cells at head height". The fix also needs a stop on escape
  reflexes placing blocks while submerged in open water. Both are drowning-rescue redesigns outside this canary.
- **F2.** `gather`/`dig_approach` digs ice that has water under it, the way 2 of the 11 ice deaths and death 1 got under
  the sheet. The fix would be a dig veto for ice over water, in its own canary. C1 makes the consequence survivable.
- **F3.** `drownRescueSuppressed`'s health reference is re-stamped at each expiry, so the yield's "no harm" is always
  true on that tick. The effect is a 0.5-s gap (§1.3). Fix the stamp or the message, separately.
- **F4.** `_death_site_route_crossed` is report-only, and explore's leg still walks through a recorded drowning site.

## 5. The refusal chain: every decline names a remedy the bot can perform from where it is

| refusal / guard | where the bot is | the remedy it names | executable from here? | composed with |
|---|---|---|---|---|
| C1: `up` capped by a solid head cell | in water, head in ice/solid | sideways `out` swim if air is within 8 (incl. one up); else `sealed` → air-pocket ice dig (C1) at once | yes: swim needs no tool; ice (hardness 0.5) is 3.75 s bare-handed standing in water, ~19 s bare-handed floating, ~0.9 s / ~4.7 s with a stone pickaxe -- `airPocketAdmit` prices the actual tool and position against the health budget (peaceful 0.5 HP/s) and refuses what does not fit | if admission refuses (budget), the existing ceiling → yield → entombed/maroon handlers (unchanged); a solid non-ice head → entombed handler (as today) |
| C1 plan refuses packed/blue ice or a falling block over the head | same | entombed / flooded-pocket rungs (unchanged) | as today | unchanged |
| C2: no dry target in 16 tries | anywhere, usually a wet region | level-2 `home` now | yes: home is the town, reachable by construction; if it fails, L3 (unchanged) | home in water → C3a declines at most twice; then runs |
| C2: a candidate in an unloaded chunk | — | the next try (16) | yes | → fallback above |
| C3a: rescue requested while submerged | head under | the air reflex (already holds the body or will); level held, one window | yes: the air reflex's rungs (swim up/out, C1 dig, flooded pocket) | **cap 2**: the 3rd consecutive submerged verdict runs the rescue, so a never-surfacing bot is not left without one |
| C3b: a running rescue meets the air reflex | head under, emergency | the air reflex | yes | the watchdog's next verdict, on the bot's own window, starts a new rescue (C3a applies) |
| H2 holds (unchanged): reserve_expired, body_held, runner_paused | — | as homefix-01 | as homefix-01 | the two caps are independent counters; either reaching its cap lets the next rescue through |

The composed dead end that killed death 1 was: route `up` (wrong), so no ice dig; ceiling; yield; no rung; re-seize, and
round again. With C1 the same position reads `out` (the hole home dug at -15,62,55) or `sealed`, which brings the ice dig.
Both are executable from the cell. The level-2 rescue that started into the water was the second guard in that chain;
C3a declines it, and C3b would have handed the body back when the air reflex seized.

## 6. The read: `homefix2read.py` (homefixread.py + the new gates)

Every homefix-01 gate and line is kept: G1, G1b, G2, G3, G4 and the reserve_expired Wilson line, plus rows_control,
licence_canary, readable, g3_unjoined and the controls. They keep their registered D and arm-size deadline (+540 at
4 pools, +720 at 3, +1080 at 2). New:

- **G5: the mechanism's own invariants (evidence=defect, REVERT on any).** These are correctness checks on rows this
  build writes. Old-code rows cannot have them, so their positive controls are fixtures:
  - **G5a.** A `_watchdog_rescue started` row whose own `requested` row says `submerged=1` without
    `submerged_cap=1` (C3a let a submerged rescue through below the cap).
  - **G5b.** An L1 relocation `requested` row with no `target`/`dry_tries` and no `fallback` (C2 skipped).
- **G6: rescue-adjacent drownings (own line; 1 BLOCKS KEEP, 2 REVERT with evidence=defect).** A canary drowning death
  within 180 s after a `_watchdog_rescue` terminal row, or while a started rescue has no terminal row, AND within 16
  blocks of that rescue's last snapshot.
  - **Null.** The old code shows 0.84 per 1,000 rescues (§3.1). At homefix-01's measured volume (~45 rescues per 20
    bots per hour) a +540 read sees ~400 rescues. A fix no safer per rescue than the old code expects 0.34. P(≥1) = 0.29,
    which is why one event only blocks KEEP. P(≥2) = 0.046, which is the REVERT line.
  - **Positive control.** The reader on homefix-01's own rows (19:21Z-00:57Z, read from the files) counts death 1 (1) and
    not death 2. It also gets fixtures.
  - **Guard.** The control arm's equivalent (old-code `trigger: watchdog_*` rows), reported as DiD.
- **Guards (reported, never a verdict).**
  - L1 relocation ends that are wet by rows: a water reflex row within 30 s of `completed:success`. Canary v control
    per rescue; homefix-01 measured 15.1% v 11.4% at 120 s.
  - `declined:submerged` count and rate.
  - `fallback: no_dry_relocation` count and rate.
  - `interrupted:drowning` count.
  - C1 exposure: `_drowning_route` rows whose detail has `axes=` with a head-cell cap, and `_air_pocket_start kind=ice
    cell=<head>`.
  - Deaths within 120 s of a rescue start, as homefix-01 reported them.
- **Change rows.** `change_rows: ["watchdog_rescue"]` WITHOUT the underscore (verdict.py compares `lstrip('_')`).
  Licence kind `_watchdog_rescue`. These are the same as homefix-01: only this build line writes them.
- **Draw.** As homefix-01: stagnation ≥ 20 and home ≥ 5 per 12 h. C1's exposure exists only if hive-d is drawn. That is
  not a requirement (G1-G6 do not need it), and it is stated so that nobody reads "C1 unexposed" as "C1 worked".

Tier 3 (no `tier`, no `class`); reads 180 / 360, extension 540 / 720 / 1080, deadline_min 1140, as homefix-01.

## 7. Tests (node scripts/run-tests.mjs only; every mechanism with an anchored mutant)

- **C1, `scanBreathableRoute`.**
  - Head ice under air → not `up`. Sealed when the four sides are ice; `out` when one side is water with air one up.
  - Head water under air → `up dist=1`, unchanged. A null head cell → never sealed.
- **C1, `airPocketPlan`.**
  - Head ice with air above → `{kind: 'ice', dy: 1}`.
  - Head packed_ice, head ice under water, head ice under stone → refused.
  - The dy 2-3 cases are unchanged.
- **C1, through the real rescue tick** (a fake bot over a 1-deep water layer under ice): the air pocket starts on the
  first sealed tick and digs the head cell.
- **C2, `pickRelocationTarget`.**
  - An ice-river fixture: every candidate over the sheet is refused (ice floor or water near), and a bank 3 off the
    water is accepted.
  - An unloaded cell refuses. A wet world returns `no_dry_target` after exactly 16 tries.
  - The rand stream is consumed deterministically.
- **C2, watchdog.** The L1 plan uses the target's surface y, and `no_dry_target` → a level-2 `home` plan with the
  fallback field. Both go through the real Runner.
- **C3a.** `submergedDecline` (pure: below cap, at cap, TTL). Through the real Runner, a submerged bot gets
  `declined:submerged`, the level is held, and nothing is reserved or cancelled. The 3rd consecutive verdict runs.
- **C3b.** The reflex seizure interrupts a watchdog-owned run and leaves a brain-owned run alone.
- **Read.** G5a/G5b/G6 fixtures; G6 on a replay of homefix-01's death 1 rows = 1, death 2 = 0.

## 8. Paper scenes (sandbox, base 9e7d9980 v candidate; outcomes from RCON `data get entity` and the runner's rows)

- **S1 (C1): a bot in a 1-deep water layer under an ice sheet, head cell ice.** Base: route `up dist=1`; it drowns, or
  the scene is stopped at a health floor. Candidate: `sealed`, the air-pocket ice dig, breathing confirmed, and Air
  back to 300.
- **S1b: the same with a hole dug one cell to the side.** Candidate: `out dist=1`, and it swims into the hole.
- **S2 (C2): a stagnant bot beside a frozen river or lake.** Relocation targets are logged for N verdicts. Candidate:
  every target is dry and standable, read back by RCON `execute if block`. Base: some targets on ice or water.
- **S3 (C3): a stagnant bot whose L2 home would start while it is submerged** (in water under a 1-block cap).
  Candidate: `declined:submerged`, the air reflex keeps the body, and the 3rd verdict runs. Plus a run started dry
  that then walks into an air emergency: `interrupted:drowning`.
- **S4: regression.** homefix-01's P1 (home 24 out) and P0 (2-s unwind + livelock rung) on the candidate.

## 9. Reviews

Design r1 → Codex (`codex exec --sandbox read-only`) and an independent Claude subagent. Verdicts and rounds are appended
below as they land.
