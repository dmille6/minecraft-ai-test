# homefix-02: why homefix-01 drowned two bots, and the targeted fix (2026-10-21, design r4)

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
2. **This is a base-code killer, not a homefix-01 invention.** Over 7 d (10-14 00Z .. 10-21 01Z, ES), the old code had
   **92 drowning deaths**, or 94 with the two homefix-01 deaths. **10 of them had the head cell under ice**, and death 1
   makes 11. All were hive-d bots at y = 61.2-61.4 under the same river sheets, and the route read `up` in every one.
   That is 10 of hive-d's 18 old-code drownings. **Every one of the 10 carried a stone or iron pickaxe with 8 or more
   uses left**, so the dig C1 adds is admissible for them (§4 C1).
3. **Death 2 (00:50:35Z) is not linked to homefix-01.** The brain's `explore` walked off a ledge into a pool whose magma
   floor drives downward bubble columns. The bot was dragged to y≈45 under single placed blocks (dirt, cobble, granite)
   that earlier bots' escape reflexes left in the pool. The route scan read `unscanned` (capped above, open water for 8
   on every side). The air-pocket dig was refused ("water beside the roof cell would fill the pocket"), and the bot
   drowned. No rescue or stagnation cancel was involved. The last rescue was a relocation that failed after 1.8 s,
   5.5 min earlier. **The same pool killed two old-code bots** (hive-d-Bravo 10-17 11:19 and 10-20 11:13).
4. **DiD: no excess observed, and it is very uncertain.** On the old code the four canary pools drown 2.5x as often as
   the control pools (0.0126 v 0.0050 per bot-h, 7 d). Against its own baseline the canary saw 2 drownings where 1.41
   were expected. The control saw 3 where 1.69 were expected. The ratio of ratios is 0.80. Counts this small establish
   neither an excess nor independence. The revert was legitimate under gate v23 (the two-death floor plus a licensed
   change row). There is one demonstrated mechanism link, death 1's relocation, and death 2 has none.
5. **Risk.** homefix-01 runs about 3.6x as many relocations per verdict (98% v 27%, H2a working as designed).
   - **The old relocation target is blind to terrain:** a random point 45-70 blocks away at the bot's current y.
   - **Canary relocations, where they ended.** Successful ones ended wet (in water, on ice, or within 2 blocks of either)
     in 16 of 85 (18.8%). That is about the canary's ambient rate of 19.8% (245/1240 bot-snapshots).
   - **Ice sheets in hive-d.** 4 of 26 hive-d relocation successes ended **on an ice sheet over water** (15.4%), against
     4.3% ambient there.
   - **Rescue-adjacent drownings on the old code.**
     - **By rescue.** A drowning within 180 s and 16 blocks of an uninterrupted watchdog rescue's end happened in 8 of 92
       drownings. That is 0.84 per 1,000 rescues (8 / 9,498 rows), a lower bound, because the trigger is lost on
       interrupted rows.
     - **By verdict.** A drowning within 180 s and 16 blocks AFTER a `_stagnation` verdict happened 6 times per 8,821
       verdicts in the canary pools (0.68 per 1,000) and 9 per 30,604 in control (0.29 per 1,000). homefix-01's canary
       counted 1 of 243 (death 1).
6. **homefix-02 makes three changes.**
   - **C1:** the route scan reads the head cell. A solid head cell caps `up`, and the air-pocket rung may break a head-cell
     ICE block that has air above it. This is the existing ice branch at dy = 1. The bug is old; it is fixed here because
     homefix sends more bots into hive-d's river.
   - **C2:** a relocation goes only to a dry, standable surface cell whose whole ARRIVAL REGION is dry. That means no
     water, ice or lava anywhere within Chebyshev 5 at dy -8..+7. That is goto's whole accepted arrival volume (≤ 3
     horizontally, |dy| ≤ 6) plus 2. The floor may not be ice, magma or leaves. If no such target turns up in 16 tries, the rescue goes straight to level-2 `home`.
   - **C3:** no watchdog rescue STARTS during a drowning in progress (`danger`: head under, ≤ 5 s of air, health
     falling) or while an air-pocket/flooded-pocket rung runs. The runner checks this at the moment the run would start.
     A running watchdog rescue is interrupted on every tick of `danger`. A chronic submerged bot at full health never
     reads `danger`, so it needs no counter (r4).

   H1-H4 are untouched. Tier 3, reads as homefix-01. New lines:
   - **G5:** defect lines on the build's invariants, using fields it now writes, plus two outcome checks from reflex rows.
   - **G6:** drownings within 180 s / 16 blocks after a verdict, on both arms. One blocks KEEP. REVERT needs two or more
     AND a positive DiD AND p < 0.05 against the registered baseline.

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

- `headBlock(bot)` is the cell at feet+1. At y 61.4 that is (-15,62,54): **ice**, four readings in 93 s. These
  readings come from the client's live world, while the bot was alive. That settles the phase-2 report's open class
  (underground-safety-phase2-2026-10-07.md §2.1: "21 head cell solid sites ... the hive-d bots at y 61.4 under ice at 62
  would have had their eyes in air"). The answer is the **pose**. A 1-high water gap (cell 61, between a dirt floor at
  60 and ice at 62) fits a player only in the swimming pose, which is 0.6 tall with the eye 0.4 up. The server's eye is
  therefore at about 61.8, in water, and the bot drowns. The phase-2 screen computed the eye at standing height (1.62),
  and so did my first reading. mineflayer models no poses.
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
- **The trap itself is old.** It killed 10 old-code hive-d bots in 7 d with this exact signature (§3.1); death 1 is the 11th. They reached the
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

- **Drowning deaths, old code: 92** (of 260 old-code deaths of all causes). Adding the 2 homefix-01 deaths makes 94.
  By pool, all builds (94): hive-d 20 (2 of them homefix-01), placebo-d 11, placebo-b 9, hive-c 5, board-c 3, and the
  rest 2-5 each. Old code only (92): the canary arm's four pools (20 bots) had 41 and the other 60 bots had 51.
- **Rates per bot-hour on the old code.** Canary pools 41 / 3,268 bh = 0.0126; control pools 51 / 10,140 bh = 0.0050.
  - **Canary window, expected v observed.** At its baseline the canary expected 1.41 drownings in 112 bh and saw 2. The
    control expected 1.69 in 336 bh and saw 3. The ratio of ratios is 0.80.
- **The head-cell evidence in the 180 s before each drowning.** The reflex rows print it: `_air_drowning_observed`,
  `_water_surface` and `_water_no_air_route`.
  - This count was run over the window to 10-21 00Z, which includes death 1, so it is 92 drownings = 91 old code + death 1.
  - **Water only:** 80.
  - **Under ice: 11** = 10 old-code + death 1. All were hive-d, all at y 61.2-61.4, and every one had
    `_drowning_route up` (dist 1).
    - **Pickaxes.** At each of the 10 old-code ice deaths, the last inventory row within 180 s held a stone or iron
      pickaxe with 8 or more uses left. es_g6verdict.py selects hive-d deaths at y 61.0-61.5, which prints 11 rows;
      the 10 were matched by time to the head-ice list. The 11th (hive-d-Comet 10-14 17:36) had a water head. Uses left per death (es_g6verdict.py): 130, 120 + iron 8, 93 + iron 8, 104, 29,
      131, 130, 17 + iron 1, 131 + iron 10, 86 + iron 19.
  - **Under dirt:** 1 (placebo-d-Bravo 10-17).
  - **Population:** 94,925 `_water_surface` rows, of which 58 read "(head ice", and 9,017 `_air_drowning_observed` rows,
    of which 22 read "head block ice". So ice heads are rare and lethal.
- **Rescue-adjacent drownings** (death within 180 s after an uninterrupted `trigger: watchdog_*` row ended, within 16
  blocks of its end). The old code had **8** drownings plus 2 lava deaths, out of **9,498** such rows (8,593 relocate,
  905 home). Per 1,000 rescues that is 0.84 drownings. The trigger is lost on interrupted rows, so this is a lower
  bound.
  - **This population does not match homefix's attempt rows** (both reviews r1): it has no interrupted rescues and no
    in-flight ones. So G6 anchors on the `_stagnation` VERDICT instead, which both builds write with a position.
- **Verdict-adjacent drownings** (death within 180 s AFTER a `_stagnation` row, within 16 blocks of its position;
  es_g6verdict.py):
  - **Canary pools: 6 of 8,821 old-code verdicts (0.68 per 1,000).** Control: 9 of 30,604 (0.29 per 1,000).
  - homefix-01's canary: **1 of 243 verdicts** (death 1, 100 s after the 20:17:40 L2 verdict, 0 blocks). Death 2 is 333 s
    after its last verdict, so it is not counted. At the old canary-pool rate 0.17 were expected, P(≥1) = 0.15.

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

- **C2 finds a dry target within 16 tries for almost every verdict.**
  - **Arrival region R = 5, dy -3..+2 (the r2 rule):** canary L1 verdicts 215 of 224 (96.0%), mean 3.7 tries. By pool,
    the shared pools are 94-100% (hive-d 58 of 61, hive-b 81 of 85).
  - **R = 2 (the r1 rule):** 221 of 224.
  - **So the fallback to `home` is about 4-6%.** These are saved-world reads with block names approximating shapes
    (sim.py), not a live-client estimate. The build logs each rejection reason (`dry_reasons`), so the read measures
    the live rate. Isolated pools were not classified: their pool names do not map to a world dir.
- **A naive "head under" decline would starve chronic cases.** Under the r1 predicate (head not breathable and wet)
  control verdicts read submerged 24 of 723 at L1 and the canary 0 of 224. Both reviews flagged that P(0) ≈ 0.0006 at an
  equal rate. **The gap is clustering, not a reading artefact.** 34 of the 40 control hits come from TWO bots:
  board-a-Comet (23) and placebo-c-Bravo (11), chronically "submerged" bots that are alive. A decline keyed on head
  geometry would have denied those two their rescues for hours. So r2 keys C3a on the AIR REFLEX being engaged, not on
  geometry (§4 C3). Its live rate is measured by the read (`declined:air_rescue`); death 1's 20:17:40 L2 verdict came 9 s
  BEFORE the air rescue seized, so C3a would not have declined it. C3b covers that case.

## 4. homefix-02 — the changes

Base: the fleet sha in the manifest at 01:35Z, **9e7d9980** (toolkit-03 `34d3e5e9` is live as a canary on
board-a, placebo-a and hive-b; if it KEEPs and is promoted before homefix-02 launches, homefix-02 needs a re-stack onto
the new fleet sha). Branch **`homefix02-on-9e7d998`** = homefix-01's head `a52d075e` + the commits below. **H1, H2 (the
whole contract), H3 and H4 are unchanged**; every homefix-01 test still runs.

### C1 — the drowning rescue reads its own head cell (reflex.mjs, airpocket.mjs)

- **`scanBreathableRoute`** reads `at(0,0,0)`, the head cell, first.
  - A head cell that is **not swimmable** (ice, dirt, any solid: `swimmable()` false) caps the up scan at dy 0. So
    **`up` is never answered through a solid head cell**.
  - The sideways scan runs unchanged. With all four sides closed the answer is `sealed`, which lets the air-pocket rung
    fire at once.
  - A null head cell sets `unknown`, like any null cell, so it is never `sealed`.
  - A swimmable head cell gives exactly today's answer.
  - The result carries `headCap: <name>`. `breathableRoute` forwards `axes` and `headCap`, which it drops today
    (reflex.mjs:998, Codex r1). `_drowning_route` prints `head=<name>`, `cap=head` and the axes, so the read can see C1.
- **`airPocketPlan`** gains one case. When the HEAD cell is plain `ice`/`frosted_ice` (the existing `ICE` regex; packed
  and blue ice do not melt) with **air directly above it**, the plan returns `{ok, kind: 'ice', dy: 1}`. The feet cell
  must be water or air, as today. Everything after the plan is the existing, Paper-proven ice branch
  (airpocket-03-paper: ice broke in 4.7 s, breathing at about 17-19.5 s, lived):
  - the health-budget admission;
  - the bounded equip, then the dig at `cellPos = fy + 1` (airpocket.mjs:249);
  - `opened` = water or air (:316);
  - the rise and confirm;
  - `standInPocket` with `airY = fy + 2`, so one block is placed under the bot (:409-410).
- **Why the dig is admissible here, against the review's pricing concern** (Claude r1 P2-3).
  - The step prices floating and in water. Bare-handed ice would need 18.75 s × 1.5 + 3 = 31 s, which is over budget
    below about 19.6 HP. With a stone pickaxe it is 4.7 s × 1.5 + 3 ≈ 10 s, admitted at HP ≥ 9 (peaceful, 0.5 HP/s).
  - **All 10 old-code ice deaths held a stone or iron pickaxe with ≥ 8 uses left** (§3.1), and so did death 1.
  - `airPocketTools` drops a worn copy only when a healthier copy of the same kind exists (toolhygiene composition).
  - No on-ground re-pricing is added. A client that prices on-ground while the server sees a swimming body would send
    "finished" early, and the server would refuse the dig: ghost air, the failure the step's worst-case pricing exists
    to avoid.
- **The confirm after a dy=1 dig is not proof by itself** (Claude r1 P3-9). The step's eye test uses standing height
  (`pos.y + 1.62`, :320). Once the ice is gone the column is 2-3 cells high, so the server's pose is standing again and
  the test is meaningful. But at full health `airPocketConfirmed` passes the moment the eye cell is air. So the read
  does not count `_air_pocket success kind=ice` as proof that C1 works. Paper S1 reads the server's `Air` by RCON.
- **What changes for other rescues.** Only rescues whose head cell is not swimmable change: 83 of 106,268 reflex
  head-block readings in 7 d (81 ice, 2 dirt). For those, `sealed` instead of `up` also makes the ceiling suppression
  persist across movement while still sealed (`drownRescueSuppressed` sealedHere, reflex.mjs:1179), and health loss
  still overrides it. `airPocketPreempt` stops an escape only when `stepWouldRun()` is true (airpocket.mjs:182), so a
  dirt head (plan refused) never cancels an escape. Composed regression tests cover these cases (§7).
- **Breaking ice from below gives water.** In Java, ice broken without silk touch becomes water when the block under
  it blocks motion or is liquid, as water does here. Paper S1 confirms this on 1.21.8.

### C2 — a relocation goes somewhere dry (relocate.mjs, new and pure; watchdog.mjs)

- **`pickRelocationTarget({ p, read, rand, tries = 16, minD = 45, maxD = 70, region = 5, dy0 = -3, dy1 = 2 })`**
  returns `{ ok, x, y, z, tries, reasons }` or `{ ok: false, why: 'no_dry_target', tries, reasons }`. Each try uses the
  old bearing and distance draw. A candidate passes only when ALL of these hold:
  1. `columnSurface(read, x, z, round(p.y))` (plinth.mjs) returns a floor `f` (not null or undefined). The feet are at
     `f + 1`. This is the highest open-over-solid cell within ±8 of the bot's y: a cave floor underground, the ground
     at the surface. A hill or ravine outside ±8 is a reject (`no_surface`).
  2. `standable(read, x, f + 1, z)` (plinth.mjs: feet and head passable and not liquid, floor solid).
  3. The floor is not ice, packed, blue or frosted ice, not magma, **and not leaves** (Claude r1 P3: `columnSurface`
     can stop on a canopy).
  4. The cell over the head (`f + 3`) is not liquid.
  5. **goto's whole ACCEPTED arrival volume is dry** (Codex r1 P1-2, r2 P2, r3 P1-3). goto grades `success` within 3
     horizontally and |dy| ≤ 6 (`arrivedAt`, skills.mjs:392). With 2 of margin the volume is **Chebyshev 5** around the
     target column, **from dy -8 to +7** of the target's feet. Any cell in it that is water, lava, a bubble column, a
     waterlogged block, an underwater plant, powder snow or ice refuses the candidate.
     - **No exemption for capped water** (r3's far-band exception is withdrawn): a 1-high layer under a cap is exactly
       the trap C1 is about.
     - The near band (dy -3..+2) is scanned first, and every scan returns on the first wet or unknown cell (Claude r3 P2).
  6. **Every cell of the volume is readable.** A null (unloaded) cell refuses the candidate (`unknown`); it is never
     taken as dry.
- **The goto target becomes the surface cell** `{x, y: f + 1, z}`, not `(x, p.y, z)`.
- **The `requested` row carries** `target_x/y/z`, `dry_tries` and `dry_reasons` (`no_surface:3,water:2`; reasons are
  counted per try).
- **A landing check** after the relocation run, using the SAME volume function as the picker (`landingCheck`; Claude
  r3 P3-6). One `_relocate_landed` row records `in_region`, `wet` (feet or head), `feet`, `head` and
  `region_dry_now`, where `region_dry_now` re-scans the target's volume.
  - **G5f:** a SUCCESS with `in_region = 1`, `wet = 1` and `region_dry_now = 1` is a defect, because the volume promised
    exactly that cell dry.
  - A region that now reads wet (the world changed) exempts the landing, and so does a landing outside the volume. Both
    are reported. A
  FAILED relocation stops wherever its leg stopped. That is a guard, not a defect: the path may cross water, and
  swimming is travel.
- **Sizing with the final predicate** (sim5.py, a faithful Python mirror). It uses R=5 and dy -8..+7 with any wet
  cell refusing, leaves/magma/ice floors and powder snow, and was run as `python3 sim5.py starts.jsonl` on 10.0.0.30
  `~/hf2-read` against the saved worlds.
  - Canary L1 verdicts: **207 of 224 (92.4%)**, mean 4.4 tries.
  - Shared pools: 84-100% (placebo-d 42 of 50, hive-b 79 of 85, hive-d 56 of 61).
  - **So the fallback to `home` is roughly 5-16%.**
  - The r1-r3 figures used looser predicates (sim.py R=2; sim4.py R=5 near -2..+2 by default, far exposed-only) and are
    superseded.
- **Cost** (Claude r3 P2). A full scan is 11 × 11 × 16 = 1,936 `blockAt` reads; most candidates exit early on the first
  wet cell. `pickRelocationTargetAsync` yields (`setImmediate`) between tries, so one stretch of the event loop holds at
  most one candidate. The requested row logs `dry_ms`, and a unit test bounds 16 worst-case scans.
- **No dry target in 16 tries: level 2 now.** The bot is in a wet, steep or unreadable place. The remedy it can still
  perform is `home`. Home is an executable attempt, not guaranteed reachable terrain (Codex r1 P2-6); if it fails,
  level 3 follows as today.
  - The watchdog sets `escalation = 2` and runs the level-2 plan with `reason: 'no_dry_relocation'`.
  - It writes **one** `requested` row with `level: 2, remedy: 'home', fallback: 'no_dry_relocation'`, so homefixread's
    G4 lifecycle (one requested, one terminal) holds.
  - **Row-shape note** (Claude r1 P3-11): that attempt's `_stagnation` row says escalation 1 while its `requested` row
    says level 2.
- **It does not check the WAY.** The path may cross water: swimming is travel. Levels 2 and 3 are unchanged.

### C3 — a watchdog rescue never starts into, or keeps running through, a drowning in progress (runner.mjs, watchdog.mjs, reflex.mjs)

**r4 simplification** (Codex r3 P1-1, P1-2). r2-r3 keyed C3 on "the air reflex holds the body". That made the
chronic "submerged but alive" bots a problem: board-a-Comet and placebo-c-Bravo (§3.3), and the 09-04 nine re-seized
every 32-37 s. Each round then needed a counter, a cap, a bypass latch, reset rules and exemptions. Codex r3 showed the
latch still fails: the base's own air actions interrupt a bypassed run, and the stagnation judgement clears a shared
counter between stranding verdicts. **r4 keys C3 on a drowning IN PROGRESS instead.** Every condition it refuses on ends
by construction within a window, so no counter is needed, and the base's air actions are left exactly as they are.

- **The air reflex publishes** `bot.airRescue = { danger, pocketing, airSeconds, headUnder, at }`.
  - **Every reflex tick writes it, BEFORE the tick's early returns** (reflex.mjs:1504, while the air-pocket step digs).
  - **`danger`** = the head is under AND `airSeconds ≤ LOW_SECONDS` (5 s) AND health fell since the previous tick. This
    is exactly `airEmergency`'s healthFalling arm (air.mjs:113; Claude r3 P3).
    - `airSeconds` comes from a SEPARATE publication clock updated every tick. The rescue's own `airClock`, updated only
      while `air.losing` (:2135), is untouched.
    - Health is the server's value.
    - **A chronic submerged bot at 20/20 HP never reads `danger`.** Peaceful heals, and nothing hurts it.
  - **`pocketing`** = the air-pocket step (`airPocketing`) or the flooded-pocket rung (`pocketing`) is running. It is
    independent of freshness.
  - **Freshness.** State older than 1.5 s reads `danger` false. `pocketing` is held by the flags themselves.
- **C3a, the admission.**
  - **Where it runs.** `Runner.run(skill, args, { owner: 'watchdog', admit })` calls `admit()` after the reservation wait
    and the body acquisition, with no await before `this.current` is installed (Codex r1 P1-1).
  - **What it refuses:** `danger || pocketing`.
  - **The refusal.** The runner writes `declined:air_rescue` with `air_danger` and `air_pocketing` fields, releases the
    reservation and (with the arbiter on) the grant, and returns `{status: 'failed', failClass: 'air_rescue'}`.
    `air_rescue` joins `RUNNER_DECLINED` (declined.mjs). The `started` row carries the same two fields, read at
    admission. That is G5a's input.
  - **The ladder.** `rescueLevelStep` treats `air_rescue` as a hold: the level held, one window (180 s) of backoff, and
    the reserve_expired streak untouched. A declined climb-out is refunded, as an unstarted one is today
    (watchdog.mjs:285).
  - **No counter, because no refusal can persist** (CLAUDE.md "a refusal must name a remedy"):
    - **`danger`** is a drowning in progress. In peaceful it ends in breath or death within about 100 s, i.e. 83-90 s
      after the air runs out (airpocket design, Paper sandbox2). That is shorter than the one-window backoff, so the
      next verdict meets a different bot.
    - **`pocketing`** is bounded: the step by its health budget (≤ about 30 s) with a 60-s fail cooldown, and the rung
      by its own budget with a 10-min cooldown.
    - **The remedy named is the air reflex**, already acting, and executable from the cell: swim up/out, the C1 ice
      dig, the flooded-pocket rung.
    - **The read reports the longest consecutive `air_rescue` streak per bot.** A streak ≥ 3 would contradict this
      argument and is named in the read.
- **C3b, level-triggered on `danger` only.**
  - **What it does.** On every reflex tick where `danger` is true and the runner's current run belongs to the watchdog
    (`current.owner === 'watchdog'`; the runner's `current` gains `owner` and `rescue`), the reflex calls
    `runner.interrupt('drowning')`. The FIRST interrupt decision per attempt writes one `_air_rescue_yield` row
    (`attempt`, `air_seconds`, `health`). That row starts G5d's deadline (Codex r3 P2-4).
  - **Why level-triggered.** The base's one-shot `if (mayAct) runner.interrupt(air.kind)` (reflex.mjs ~2103-2117) fires
    only on the first latched tick, and its latch clears on the untrustworthy `oxygenLevel` (:2360). That one-shot is
    why death 1's `home` sat 52 s inside the drowning. With C3b, death 1's `home` is interrupted at about 20:18:09, the
    first tick with air out and health falling (20 → 19).
  - **Everything else the air reflex already does is unchanged.** That covers the seizure's `setGoal(null)`, the
    one-shot latch, the air-pocket step's interrupt and guard (reflex.mjs:1415-1417), and the flooded-pocket rung's
    `takeBody`. These may still end a watchdog run as `interrupted:air_pocket` or `interrupted:<air kind>`, as on the
    base. The read reports those, and they are not C3b defects (Claude r3 P3-4).
  - **Brain-started runs are untouched** (F5; both reviewers accepted the deferral at r2).
- **The stranding refund is capped** (Claude r3 P3-3). A climb-out declined `air_rescue` never started, so it is
  refunded like any unstarted one. A climb-out that started and was ended `interrupted:drowning` is refunded at most
  twice per stranding episode (`AIR_REFUND_CAP`), and the count resets with `strandWindows = 0`. The refund
  count is in the `_stranded_underground` detail. After the cap, the attempts count toward `stranded_unrecoverable`
  as today.

### Not changed (named so nobody reads them as fixed)

- **F1, death 2's pool.** Fixing it needs a 3-D breathable-route search (BFS through swimmable cells to the nearest air
  within N), where today's scan is "straight up, or 8 cardinal cells at head height". It also needs a stop on escape
  reflexes placing blocks while submerged in open water. Both are drowning-rescue redesigns, out of this canary.
- **F2.** `gather`/`dig_approach` digs ice that has water under it. That is how death 1 and at least 2 of the 10 ice deaths
  got under the sheet. The fix is a dig veto for ice over water, in its own canary. C1 makes the consequence survivable.
- **F3.** `drownRescueSuppressed`'s health reference is re-stamped at each expiry, so the yield's "no harm" is always
  true on that tick. On its own that is a 0.5-s gap (§1.3). But a yield is also a window in which the brain can start a
  run (F5). Fix the stamp, separately.
- **F4.** `_death_site_route_crossed` is report-only. Explore legs still walk through a recorded drowning site.
- **F5.** The one-shot `mayAct` interrupt latch (reflex.mjs ~2103-2117, cleared by `oxygenLevel` at :2360) can leave a
  brain run alongside an air rescue: death 2's 3.7-HP explore. Repairing it touches every skill, so it is a separate
  change with its own measurement.

## 5. The refusal chain: every decline names a remedy the bot can perform from where it is

| refusal / guard | where the bot is | the remedy it names | executable from here? | composed with |
|---|---|---|---|---|
| C1: `up` capped by a solid head cell | in water, head in ice/solid | sideways `out` swim if air is within 8 (incl. one up); else `sealed` → air-pocket ice dig (C1) at once | yes: swim needs no tool; ice is about 4.7 s floating with a stone pickaxe (every observed ice victim held one), 18.75 s bare-handed. `airPocketAdmit` prices the actual tool and position against the health budget and refuses what does not fit | admission refused: the existing ceiling → yield → entombed/maroon handlers (unchanged); a solid non-ice head → entombed handler (as today) |
| C1 plan refuses packed/blue ice or a falling block over the head | same | entombed / flooded-pocket rungs (unchanged) | as today | unchanged |
| C2: no dry target in 16 tries | a wet, steep or unloaded region | level-2 `home` now | yes: an executable walk to the town; if it fails, L3 (unchanged) | home meeting an engaged air rescue → C3a (capped) |
| C2: a candidate rejected (wet / unknown / steep) | — | the next try | yes | → fallback above |
| C3a: rescue admission during `danger` or a pocket rung | drowning in progress (head under, ≤ 5 s air, health falling), or the air-pocket / flooded-pocket rung running | the air reflex; level held, one window | yes: its rungs (swim up/out, C1 ice dig, flooded pocket) | **bounded by construction**: a drowning ends (breath or death) in ~100 s < the 180-s backoff; the rungs are budget-bounded with cooldowns; a breathing or healthy-submerged bot is never refused; the read reports the longest decline streak |
| C3b: a watchdog run during `danger` | drowning in progress | the air reflex | yes | the next verdict starts a new rescue (C3a applies); a climb-out interrupted this way is refunded at most twice per stranding episode |
| H2 holds (unchanged): reserve_expired, body_held, runner_paused | — | as homefix-01 | as homefix-01 | `air_rescue` declines do not touch the reserve_expired streak |

The composed dead end that killed death 1: route `up` (wrong), so no ice dig; ceiling; yield; no rung; re-seize; and
round again. With C1 the same position reads `out` (the hole home dug at -15,62,55, `AIRUP@1`) or `sealed`, which
triggers the ice dig. Both are executable from the cell. The level-2 `home` that sat inside the drowning is interrupted
by C3b on the first tick of `danger` (about 20:18:09), or earlier by the air-pocket step's own guard once C1 makes
the route `sealed`.

## 6. The read: `homefix2read.py` (homefixread.py + the new gates)

Every homefix-01 gate and line is kept: G1, G1b, G2, G3, G4 and the reserve_expired Wilson line, plus rows_control,
licence_canary, readable, g3_unjoined and the controls. They keep their registered D and arm-size deadline (+540 at
4 pools, +720 at 3, +1080 at 2). `declined:air_rescue` is a terminal phase for G4 (`declined:*`, as today). New:

- **G5: the build's own invariants and two outcome checks (evidence=defect, REVERT on any).** Positive controls are
  fixtures, plus, for G5c, the same parser run over homefix-01's rows, which must find death 1's `up` route through
  ice. Missing required fields set **`g5_fields_missing` ≥ 1, which blocks KEEP**, so absence is never read as clean
  (Codex r1 P1-4).
  - **G5a.** A watchdog `started` row whose admission fields (`air_danger`, `air_pocketing`, written by the runner
    from `admit()`'s reading at the start) say 1: C3a let a rescue start into a drowning in progress.
  - **G5b.** A level-1 relocation `requested` row with no `target_x`/`dry_tries`, OR a `fallback` row whose
    `dry_tries` is not 16: C2 skipped.
  - **G5c (outcome, C1).** A `_drowning_route` row with `up` whose `head=` cell is not swimmable (ice, dirt, stone, ...):
    the route answered through a solid head cell. homefix-01's 20:17:49 row is the positive control. Its head
    (`_air_drowning_observed`, 2 s earlier) was ice, so the old code shows the defect.
  - **G5d (outcome, C3b).** An `_air_rescue_yield` row (the FIRST interrupt decision per attempt) whose attempt has
    no terminal phase within 60 s: C3b's interrupt did not take. 60 s is above the measured unwind p99 of 47.6 s (h11),
    and the read reports the yield→terminal times.
    - The independent half is **G5d'**: a tick-level observation from the read itself. It flags a watchdog attempt
      started and not terminal while the same bot's reflex rows show a drowning in progress (`_drowning_ceiling_no_air`
      or `_oxygen_critical_state` with health below the previous row's), with no `_air_rescue_yield` for that attempt
      within 2 s. It is reported, and it becomes a defect when the attempt's terminal is not `interrupted:*`.
    - A yield row cut by the read boundary (< 60 s before it) is censored, not counted.
- **G6: verdict-adjacent drownings on both arms (DiD).** A drowning death within 180 s AFTER a `_stagnation` verdict and
  within 16 blocks of the verdict's position, deduplicated per death. Both builds write the verdict with a position,
  so the old code's pre-period is counted with the same instrument.
  - **`g6_canary` ≥ 1 BLOCKS KEEP.** This is a conservative POLICY tripwire, not statistical evidence (Codex r1 P1-3,
    r2 P6): a human reads that death.
  - **REVERT (evidence=defect) only when all three hold:**
    1. `g6_canary` ≥ 2;
    2. the DiD per 1,000 verdicts, (canary post − canary pre) − (control post − control pre), is positive;
    3. P(X ≥ g6 | λ = r × canary post verdicts) < 0.05.
  - **The baseline r is registered per pool BEFORE the draw** (Codex r2 P6, Claude r2 P4). Its source is old code, 7 d
    (10-14..10-21), the same verdict instrument (es_g6pool.py). Each entry is adjacent drownings / verdicts:

    | pool | adjacent drownings / verdicts |
    |---|---|
    | board-a | 0 / 3,059 |
    | board-b | 0 / 2,491 |
    | board-c | 1 / 2,717 |
    | board-d | 2 / 1,786 |
    | hive-a | 2 / 2,791 |
    | hive-b | 0 / 3,405 |
    | hive-c | 2 / 2,794 |
    | hive-d | 2 / 2,046 |
    | placebo-a | 0 / 2,322 |
    | placebo-b | 1 / 2,159 |
    | placebo-c | 0 / 2,532 |
    | placebo-d | 2 / 1,899 |
    | isolated (all) | 3 / 9,424 |

    The read uses r = max(0.68/1,000, Σ hits / Σ verdicts over the DRAWN pools). The worst 4-pool draw is 8 / 8,525 =
    0.94/1,000.
  - **What the probabilities mean.** They are conditional on these rates holding, and they are not calibrated
    false-positive guarantees.
  - **Expected trip rates for a fix that is no safer than the old code.** At ~430 verdicts in a +540 read (homefix-01
    issued 243 in 5.6 h), λ ≈ 0.29: P(block) ≈ 0.25 and P(≥ 2) ≈ 0.035, of which the DiD condition removes more.
    **Stated plainly: about a quarter of correct-but-not-better runs would end INCONCLUSIVE on this line. That is the
    cost of the owner's ask** ("consider declaring rescue-adjacent drownings a defect gate"), and the owner can make it
    report-only.
  - **Positive control.** The reader on homefix-01's rows counts death 1 and not death 2 (fixture from the real rows).
  - **Reported alongside:** G6r, the attempt-anchored version, canary only (a death within 180 s of a terminal row, or
    during a started attempt, within 16 blocks of its last snapshot).
- **Guards (reported, never a verdict).**
  - `_relocate_landed wet=1` per relocation, by success or failure and by `in_region`.
  - Water reflex rows within 30 s of `completed:success`, canary v control. homefix-01: 15.1% v 11.4% at 120 s.
  - The `declined:air_rescue`, `_air_rescue_yield`, `interrupted:drowning` (and `interrupted:air_pocket` /
    `interrupted:<air kind>` from the base's own air actions) and `fallback` counts. Also the `dry_reasons` mix and
    `dry_ms` (p50/p99), the longest consecutive `air_rescue` streak per bot (≥ 3 named), and the refunds.
  - C1 exposure: `_drowning_route ... cap=head` and `_air_pocket_start kind=ice` at the head cell.
  - Deaths within 120 s of a rescue start, as homefix-01 reported them.
- **Change rows:** `change_rows: ["watchdog_rescue"]` WITHOUT the underscore (verdict.py compares `lstrip('_')`).
  Licence kind `_watchdog_rescue`. Both are the same as homefix-01.
- **Draw:** as homefix-01 (stagnation ≥ 20 and home ≥ 5 per 12 h). C1's exposure exists only if hive-d is drawn. That
  is not a requirement, and it is stated so that nobody reads "C1 unexposed" as "C1 worked".

Tier 3 (no `tier`, no `class`); reads 180 / 360, extension 540 / 720 / 1080, deadline_min 1140, as homefix-01.

## 7. Tests (node scripts/run-tests.mjs only; every mechanism with an anchored mutant)

- **C1, `scanBreathableRoute`.**
  - Head ice under air → not `up`, with `headCap` set. Sealed when the four sides are ice. `out` when one side is water
    with air one up (death 1 after home's float-dig).
  - Head water under air → `up dist=1` (unchanged).
  - A null head cell → never sealed.
  - **Existing fixtures.** drown-route-truth.test.mjs's `around()` defaults the head cell to STONE (:96-98), so ":158-165
    water and open air conduct the scan" and the up-scan mutant fixture (:463-466) set `'0,0,0': WATER` explicitly.
    They are NOT weakened, and their anchored mutants are re-run.
- **C1, `airPocketPlan`.**
  - Head ice + air above → `{kind: 'ice', dy: 1}`. Head packed ice, head ice under water, head ice under stone, and a
    head dirt → refused. A10 (the old "head cell ice refused") becomes the dy=1 acceptance.
  - The dy 2-3 cases are unchanged.
- **C1, composed** (Codex r1 P2-7), through the real reflex tick on a fake bot in a 1-high water layer under ice:
  - the air pocket starts on the first sealed tick and digs the head cell;
  - with two prior ceiling failures at the spot, it still digs (sealed + not suppressed while health falls);
  - with flat health and movement inside the sealed pocket, suppression holds and the escape handlers run;
  - for a non-ice solid head (dirt), no dig, and the entombed handler is reachable;
  - with admission refused (no tool, low HP), the cooldown applies and the ceiling/yield path is unchanged.
- **C2, `pickRelocationTarget`.**
  - Ice-river fixture: every candidate over the sheet or within 5 of it is refused, and a bank 6 off the water is
    accepted.
  - An unloaded cell refuses. A canopy floor refuses. Powder snow is wet.
  - A wet world → `no_dry_target` after exactly 16 tries.
  - Deterministic rand consumption.
  - A dry-bank target with a wet accepted endpoint (Codex r1 P1-2) is refused by the region rule.
- **C2, watchdog, through the real Runner.**
  - The L1 plan uses the target's surface y, and the requested row carries the fields.
  - `no_dry_target` → ONE level-2 `requested` row with `fallback`.
  - fallback → home declined (`air_rescue`) → retry → L3 (Codex r1 P2-6).
- **C3a.**
  - `airDanger` (pure): head under + ≤ 5 s + health fell → true. A chronic submerged bot at 20/20 → false, and so is a
    breathing swimmer (death 2's shape: the relocation runs). Stale state → false. `pocketing` → refused regardless of
    freshness.
  - **The race, through the real Runner** (Codex r1 P1-1): a dry request → a skill unwinding for 3 s → `danger` begins
    during the unwind → `declined:air_rescue`, and nothing starts. Admission during a multi-second air-pocket step →
    declined.
  - **The ladder:** an `air_rescue` decline holds the level and leaves the reserve_expired streak untouched, in both
    stagnation and stranding. A declined climb-out is refunded, with the cap of 2 per episode.
  - **Composed, the chronic case** (Codex r2-r3 P1): a seagrass-head bot at full health, re-seized by the air reflex
    every few seconds, gets its watchdog rescue admitted. C3b never interrupts it, so the run reaches its terminal. The
    base's own air actions are not changed and are not asserted beyond today's behaviour.
- **C3b.**
  - A watchdog-owned run is interrupted on a LATER `danger` tick, not only the first.
  - A run that starts while `danger` is already true is refused by C3a.
  - A brain-owned run is left alone.
  - One `_air_rescue_yield` row per attempt.
  - An interrupted climb-out is refunded, at most twice.
- **Read.**
  - G5a-f fixtures.
  - G5c on homefix-01's death-1 rows = 1.
  - G6 on homefix-01's rows: death 1 counted, death 2 not.
  - Missing fields → `g5_fields_missing`.
  - The DiD + Poisson line.

## 8. Paper scenes (sandbox, base 9e7d9980 v candidate; outcomes from RCON `data get entity` and the runner's rows)

- **S1 (C1): a 1-high water layer under an ice sheet, head cell ice.** Rebuild hive-d's river: dirt floor, 1 water,
  ice, air. The bot is placed in the gap by RCON `tp` on the sandbox only, where the server forces the swimming pose.
  - **Base:** route `up dist=1`, and the bot drowns, or the scene is stopped at a health floor.
  - **Candidate:** `sealed`, the air-pocket ice dig at the head cell, the server's `Air` back to 300 (RCON), and it
    lives. Run once with a stone pickaxe and once bare-handed at 20 HP; the bare-handed run should be admitted at
    20 HP and refused at 15 HP.
- **S1b:** the same with a hole one cell to the side. **Candidate:** `out dist=1`, and it swims into the hole and
  breathes.
- **S2 (C2): a stagnant bot beside a frozen river or lake.** Relocation targets are logged for N verdicts.
  - **Candidate:** every target is dry and standable in its region, read back by RCON `execute if block`.
  - **Base:** some targets on ice or water.
- **S3 (C3).**
  - (a) A stagnant bot in a drowning in progress at the verdict (capped water, air out, health falling): **candidate**
    `declined:air_rescue`, and the air reflex keeps the body.
  - (a') A healthy bot with its head in seagrass, stagnant: **candidate** the rescue STARTS (no `danger`).
  - (b) A bot whose L2 `home` is running when it meets an air emergency: **candidate** `interrupted:drowning` within a
    tick or two, and the air rescue proceeds.
- **S4: regression.** homefix-01's P1 (home 24 out) and P0 (2-s unwind + livelock rung) on the candidate.

## 9. Reviews

| round | Codex | Claude |
|---|---|---|
| design r1 (73019074) | CHANGE. P1: C3 admission race (check before reserve, edge-triggered C3b); C2 checks the target, not goto's ≤3/≤6 arrival region; G6's null population ≠ its event definition; G5/C1 telemetry contract unwritten (rows, axes dropped). P2: decline caps not independent (rescueLevelStep resets the streak); C2 limits overstated (columnSurface, sim approximations); C1 composed regressions. P3: wording (no observed DiD excess; denominators 92 v 94) | CHANGE. P1: a head-geometry decline starves breathing swimmers (death 2's shape) — key on the air reflex; G6's REVERT rests on a narrower null — anchor on verdicts or block-only. P2: bare-handed ice pricing (pickaxes?); caps not independent; C3b edge-triggered and the one-shot latch; 0/223 v 24/723 sizing unexplained; G5 self-consistency only — add outcome checks. P3: drown-route-truth fixtures default the head cell to stone; dy=1 confirm vacuous at full HP; leaves/powder snow; fallback row shape; 92 v 94 |
| design r2 (1fc8f0cf) | CHANGE. P1: C3b defeats C3a's bypass (chronic bots killed on the next re-seizure); C2's region misses goto's ±6 vertical acceptance. P2: air TTL shorter than the stranding cadence (720 s); state stale behind the airPocketing early return; G5d keyed on a seizure row only written on `!rescuing`; G6's fixed baseline not portable to a new draw. P3: 11 v 10, 92 v 94 wording | CHANGE. P1: the same bypass/C3b dead end. P2: state stale during the ice dig; airClock only updated while losing. P3: `air_rescue` into RUNNER_DECLINED and the grant release; G6 λ = max(0.68, the drawn arm's rate); say the pickaxe rows were matched. F5 deferral accepted |
| design r3 (af9a93ee) | CHANGE. P1: the base's own air actions (one-shot latch, air-pocket guard, re-seize goal clear) still kill a bypassed run; the shared counter is cleared by stagnation between stranding verdicts; the far-band exemption for capped water is unsound. P2: an exempt→interrupt transition is missed by G5d; the sizing is not a faithful replay | **APPROVE** (P2: region scan cost; P3: `danger` threshold text; cap the drowning refund; name the pocket rungs' interrupts; sim settings; G5f with the same predicate; which escalation zeroes reset the latch) |
| design r4 | | |

r2 answers every r1 finding:
- **C3a:** keyed on the air reflex, checked at the runner's start, with its own streak, cap and bypass latch. C3b is
  level-triggered.
- **C2:** the arrival region R = 5, dy -3..+2; leaves and powder snow; `dry_reasons`; the landing row.
- **G6:** verdict-anchored, with a DiD + Poisson REVERT and a one-death KEEP block named as policy.
- **G5:** the fields contract, `g5_fields_missing`, and the outcome checks G5c/G5d.
- **C1 pricing:** answered with the pickaxe counts.
- **Fixtures, wording and denominators:** fixed.
- **Not taken:** Claude's "interrupt every run on seize", deferred to F5 with its reason.

The expansion-plan spec lives on origin/main (`git show origin/main:docs/reports/expansion-plan-2026-10-19.md`). It is
not on this branch's base (Codex r1 P3).

r3 answers every r2 finding:
- **The chronic handoff.** A bypassed run is exempt from C3b unless `danger`. The bypass latches with no TTL until
  progress resets it. An interrupted climb-out is refunded.
- **C2's region.** It now covers goto's whole accepted volume: Chebyshev 5, a near band dy -3..+2 with any wet cell,
  and a far band dy -8..+7 with exposed wet cells. Sizing is unchanged at 96% (sim4.py). A wet landing after a success
  is a defect (G5f).
- **`bot.airRescue`.** Published before the early returns, with `owning` that includes the air-pocket and
  flooded-pocket rungs, and with its own publication clock.
- **G5d.** Keyed on an independent `_air_rescue_overlap` row.
- **G6.** A per-pool baseline registered before the draw (es_g6pool.py). The probabilities are labelled as
  conditional.
- **Smaller items.** `RUNNER_DECLINED` and the grant release; the wording; the pickaxe matching.

r4 answers r3:
- **C3 re-keyed on a drowning in progress** (`danger` = head under, ≤ 5 s of air, health falling), or on a pocket rung
  running. Each condition is bounded by construction, which removes the counter, the bypass, its latch and its reset
  rules (Codex r3 P1-1, P1-2). This also moots Claude r3 P3-7.
- **The base's air actions are unchanged**, and §4 names them (Claude r3 P3-4).
- **C2 rejects any wet cell in the whole accepted volume** (Codex r3 P1-3). Sizing from a faithful mirror (sim5.py) is
  92.4%.
- **Scan cost:** early exit, the near band first, a yield between tries, `dry_ms` and a timing test (Claude r3 P2).
- **G5f** uses the picker's own volume.
- **G5d** is keyed on the first interrupt decision, with a reflex-row cross-check, G5d'.
- **The drowning refund is capped at 2.**
- **`danger`** uses LOW_SECONDS, matching airEmergency's arm.
