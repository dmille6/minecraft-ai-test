# plinth-01 (the raised junk well) -- Paper sandbox evidence, 2026-10-13

Branch `plinth-on-baa9487` (on wellsite-01's canary sha baa94879). The canary sha is **4774bec1**.
Driver: `sandbox/well/plinth-e2e.mjs`. Tables: `sandbox/well/plinth-evidence.py <results.jsonl> <run>`, rendered unedited below.
Server: Paper 1.21.8 sandboxes on 10.0.0.30. sandbox2 ran the plinth alone; sandbox3 ran the townzone-01 composition.
The sandbox lock `/tmp/mcai-sandbox.lock` on 10.0.0.31 was held as `plinth` for the whole series.
World edits were made only in the sandbox arena, which is x/z 2374..2426. No fleet world was touched.

## Method

- **The bot is the real one.** It runs `src/index.mjs` from the branch, unmodified. `trace.cjs` only observes packets.
  A loopback brain answers `status`, so every plinth action comes from the bot's own deterministic town order:
  `#plinthOrder`, then `build_plinth`, which is the path the fleet would take.
- **The trigger is the base's own record.** Each scene begins with the town's `junkwell-nosite-<home>.json`, as
  wellsite-01 writes it.
- **The truth is read from the server, not from bot rows.** Every count below is an RCON read:
  - `execute if block` for every plan cell, and for cobblestone in every cell of a 15x15x6 box around the cap (cap +-7, y cap-4..cap+1), so a placement outside the plan shows up as cobble that is neither planned nor in the fixture;
  - an entity census for the items, inside and outside the shaft;
  - `data get entity` for positions.
- **Three fixtures:**
  - `slab2` is dug-out ground: a 2-thick dirt slab, giving a raise of k=2 with 32 placements.
  - `slab4` has dirt under sand. No shell cell may be sand, so this is the full raise: k=4, 84 placements, 3 of them
    stair cells.
  - `boarda` is board-a's real town, a read-only region copy from 10-13 pasted into the arena. It has leaves in the plan:
    k=3, 62 placements and 2 leaf clears.
- **The `:kill` reps** SIGKILL the bot twice in mid-build, once before the walling-in step and once after it where the
  timing allows, then restart it. They test resume and lease recovery: a restarted bot waits out the 4-minute lease of
  its dead self.
- **Funding.** Bags were pre-filled with cobble, so the chest-withdraw funding path was **not** exercised on Paper. Only
  the skill tests (`plinth-skill.test.mjs`) cover it.

## Runs

| run | sha | server | scenes |
|---|---|---|---|
| 1013T165120 | 3d9448f6 (review r3) | sandbox2 | builds slab4 x3 (1 kill), boarda x3 (1 kill), slab2; well x2; path x3; tomb/pit |
| 1013T174115 | 0e288720 (review r5; Codex APPROVE) | sandbox2 | the same 13 scenes |
| 1013T180541 | a81034e6 (plinth r8 x townzone-01 b945226a) | sandbox3 | build slab4; tomb/pit; tomb/pit CONTROL (no plinth) |
| 1013T183526 | 4774bec1 (final) | sandbox2 | build slab4 x2 (1 kill), well slab4, path slab4, build boarda, path boarda |

Code that changed after 0e288720:
- grass, mycelium and podzol count as a pit cover;
- a late landing of the builder's own click is no longer charged to another hand;
- the stair veto moved into `wellBreakCost`, through the well column's `stair` field;
- test-only changes.

The confirmation run at 4774bec1 covers the path and stair change on the final sha.

## Summary (all runs at the plinth's own shas: 1013T165120 + 1013T174115 + 1013T183526)

| measure | result | denominator |
|---|---|---|
| builds complete, every planned cell on the server, 0 outside the plan | **17 of 17** | builds (slab4, boarda, slab2); 5 of them SIGKILLed twice and restarted |
| planned placements read back on the server | 1170 / 1170 | placements in those plans |
| planned leaf clears read back as air | 14 / 14 | clears (boarda) |
| new cobblestone outside the plan (server; 15x15x6 box around the cap) | 0 | 1,350 cells per build x 17 builds |
| cap left open at the end | 1 of 17 | builds (the 1 is the r4 kill rep at 3d9448f6; see Caveats) |
| plan identical to the offline planner on the same world | 17 of 17 | builds |
| build_well on the finished plinth: cap + floor read on the server | 5 of 5 | wells (k=4 x3, k=2 x2) |
| junk items in the shaft after a dispose visit, at +1.5 s / +30 s | 2880 / 2880 in; 0 / 0 outside | 5 visits x 576 items thrown |
| items a walker picked up beside the shaft (60 passes + 4 ledge cells x 10 s) | 0 | 5 runs. POSITIVE CONTROL: an egg on the top is collected in 5 of 5 |
| pathfinder trips ok (to the stand + home) | 800 / 800 | 8 runs x 100 trips |
| path nodes in the well column | 0 | every node of those 800 trips |
| plinth cells lost to an entombed or pit bot (server) | 0 | 4 scenes against the slab4 plinth (84 cells); plus 2 in the townzone composition |

## Per-run tables (rendered by plinth-evidence.py, unedited)

### Run 1013T183526

**S1 build** (a plan from the no-site record to complete; the server read after every visit)

| fixture | rep | kills | k | plan steps (place+clear+stair) | server: placed / planned | cleared | outside the plan (server) | block_place packets | retries | alt stands | visits | complete (s) | pit rows | cap open at end | same plan as offline |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| slab4 | 1 | - | 4 | 84 (84+0, stair 3) | 84/84 | 0/0 | 0 | 85 | 0 | 0 | 3 | 98 | well_pit_dug plinth; well_pit_covered build | False | True |
| slab4 | 2 | 17 placed, 84 placed (walled in) | 4 | 84 (84+0, stair 3) | 84/84 | 0/0 | 0 | 85 | 0 | 0 | 2 | 337 | well_pit_dug plinth; well_pit_covered build | False | True |
| boarda | 1 | - | 3 | 64 (62+2, stair 0) | 62/62 | 2/2 | 0 | 69 | 0 | 0 | 2 | 66 | well_pit_dug plinth; well_pit_covered build | False | True |

Builds complete with every planned cell on the server and nothing outside the plan: **3 of 3**.

**S2 the well on the plinth** (build_well on the finished plinth: the cover dug out, the floor trapdoor, the cap)

- slab4: built=True facing=north cap+floor read on the server: True (at=2393,123,2399 facing=north floor=1 wood=carried pit_first=0 pit_tossed=0 pit_items=0 free=33)

| fixture | raise k | items in the shaft (+1.5 s) | outside | at +30 s in / out | bot row |
|---|---|---|---|---|---|
| slab4 | 4 | 576 | 0 | 576 / 0 | slots=36->27 offlist=0 gclicked=448 stone=576 swords=0 sword_lost=0 sword_kept=0 offlist_i |

| fixture | raise k | positive control (egg on the top, collected) | 60 passes beside the shaft: items in/out after, walker bag | the LEDGE (4 cells, feet g, 10 s each): walker bag | shaft after |
|---|---|---|---|---|---|
| slab4 | 4 | {'egg': 1} | 576/0, {} | [{}, {}, {}, {}] | 576/0 |

**S3 pathing** (mineflayer-pathfinder with the fleet's well step cost; a bare walker, 50 round trips town <-> throwing stand)

| fixture | to the stand ok | home ok | path nodes in the well column | body samples in the column (100 ms) | p50 ms to the stand | fails |
|---|---|---|---|---|---|---|
| slab4 | 50/50 | 50/50 | 0 | 0 | 2199 | 0 |
| boarda | 50/50 | 50/50 | 0 | 17 | 3550 | 0 |

### Run 1013T174115

**S1 build** (a plan from the no-site record to complete; the server read after every visit)

| fixture | rep | kills | k | plan steps (place+clear+stair) | server: placed / planned | cleared | outside the plan (server) | block_place packets | retries | alt stands | visits | complete (s) | pit rows | cap open at end | same plan as offline |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| slab4 | 1 | - | 4 | 84 (84+0, stair 3) | 84/84 | 0/0 | 0 | 85 | 0 | 0 | 3 | 108 | well_pit_dug plinth; well_pit_covered build | False | True |
| slab4 | 2 | 17 placed, 84 placed (walled in) | 4 | 84 (84+0, stair 3) | 84/84 | 0/0 | 0 | 85 | 0 | 0 | 2 | 339 | well_pit_dug plinth; well_pit_covered build | False | True |
| slab4 | 3 | - | 4 | 84 (84+0, stair 3) | 84/84 | 0/0 | 0 | 85 | 0 | 0 | 3 | 98 | well_pit_dug plinth; well_pit_covered build | False | True |
| boarda | 1 | - | 3 | 64 (62+2, stair 0) | 62/62 | 2/2 | 0 | 69 | 0 | 0 | 2 | 66 | well_pit_dug plinth; well_pit_covered build | False | True |
| boarda | 2 | 23 placed | 3 | 64 (62+2, stair 0) | 62/62 | 2/2 | 0 | 75 | 0 | 0 | 1 | 310 | well_pit_dug plinth; well_pit_covered build | False | True |
| boarda | 3 | - | 3 | 64 (62+2, stair 0) | 62/62 | 2/2 | 0 | 69 | 0 | 0 | 2 | 66 | well_pit_dug plinth; well_pit_covered build | False | True |
| slab2 | 1 | - | 2 | 32 (32+0, stair 0) | 32/32 | 0/0 | 0 | 33 | 0 | 0 | 1 | 40 | well_pit_dug plinth; well_pit_covered build | False | True |

Builds complete with every planned cell on the server and nothing outside the plan: **7 of 7**.

**S2 the well on the plinth** (build_well on the finished plinth: the cover dug out, the floor trapdoor, the cap)

- slab4: built=True facing=north cap+floor read on the server: True (at=2393,123,2399 facing=north floor=1 wood=carried pit_first=0 pit_tossed=0 pit_items=0 free=33)
- slab2: built=True facing=north cap+floor read on the server: True (at=2393,121,2399 facing=north floor=1 wood=carried pit_first=0 pit_tossed=0 pit_items=0 free=33)

| fixture | raise k | items in the shaft (+1.5 s) | outside | at +30 s in / out | bot row |
|---|---|---|---|---|---|
| slab4 | 4 | 576 | 0 | 576 / 0 | slots=36->27 offlist=0 gclicked=448 stone=576 swords=0 sword_lost=0 sword_kept=0 offlist_i |
| slab2 | 2 | 576 | 0 | 576 / 0 | slots=36->27 offlist=0 gclicked=448 stone=576 swords=0 sword_lost=0 sword_kept=0 offlist_i |

| fixture | raise k | positive control (egg on the top, collected) | 60 passes beside the shaft: items in/out after, walker bag | the LEDGE (4 cells, feet g, 10 s each): walker bag | shaft after |
|---|---|---|---|---|---|
| slab4 | 4 | {'egg': 1} | 576/0, {} | [{}, {}, {}, {}] | 576/0 |
| slab2 | 2 | {'egg': 1} | 576/0, {} | [{}, {}, {}, {}] | 576/0 |

**S3 pathing** (mineflayer-pathfinder with the fleet's well step cost; a bare walker, 50 round trips town <-> throwing stand)

| fixture | to the stand ok | home ok | path nodes in the well column | body samples in the column (100 ms) | p50 ms to the stand | fails |
|---|---|---|---|---|---|---|
| slab4 | 50/50 | 50/50 | 0 | 0 | 2200 | 0 |
| boarda | 50/50 | 50/50 | 0 | 19 | 3550 | 0 |
| slab2 | 50/50 | 50/50 | 0 | 0 | 1794 | 0 |

**S4 tomb** (slab4): out=None plinth cells lost (server)=0; rows: _livelock_escape fixated on one action; relocating to 2419,2377 -- moved 0 of the 32 blocks asked for (dig; la

**S4 pit** (slab4): out=None plinth cells lost (server)=0; rows: _marooned_self_sourced no route from y=117; dug 4 of 4 neighbouring block(s) and gained 72 placeable — haveBlo; _livelock_escape fixated on one action; relocating to 2420,2381 -- moved 0 of the 35 blocks asked for (dig; la

### Run 1013T165120

**S1 build** (a plan from the no-site record to complete; the server read after every visit)

| fixture | rep | kills | k | plan steps (place+clear+stair) | server: placed / planned | cleared | outside the plan (server) | block_place packets | retries | alt stands | visits | complete (s) | pit rows | cap open at end | same plan as offline |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| slab4 | 1 | - | 4 | 84 (84+0, stair 3) | 84/84 | 0/0 | 0 | 85 | 0 | 0 | 3 | 98 | well_pit_dug plinth; well_pit_covered build | False | True |
| slab4 | 2 | 19 placed, 84 placed (walled in) | 4 | 84 (84+0, stair 3) | 84/84 | 0/0 | 0 | 84 | 0 | 0 | 2 | 330 | well_pit_dug plinth | True | True |
| slab4 | 3 | - | 4 | 84 (84+0, stair 3) | 84/84 | 0/0 | 0 | 85 | 0 | 0 | 3 | 98 | well_pit_dug plinth; well_pit_covered build | False | True |
| boarda | 1 | - | 3 | 64 (62+2, stair 0) | 62/62 | 2/2 | 0 | 69 | 0 | 0 | 2 | 66 | well_pit_dug plinth; well_pit_covered build | False | True |
| boarda | 2 | 23 placed | 3 | 64 (62+2, stair 0) | 62/62 | 2/2 | 0 | 75 | 0 | 0 | 1 | 312 | well_pit_dug plinth; well_pit_covered build | False | True |
| boarda | 3 | - | 3 | 64 (62+2, stair 0) | 62/62 | 2/2 | 0 | 69 | 0 | 0 | 2 | 66 | well_pit_dug plinth; well_pit_covered build | False | True |
| slab2 | 1 | - | 2 | 32 (32+0, stair 0) | 32/32 | 0/0 | 0 | 33 | 0 | 0 | 1 | 40 | well_pit_dug plinth; well_pit_covered build | False | True |

Builds complete with every planned cell on the server and nothing outside the plan: **7 of 7**.

**S2 the well on the plinth** (build_well on the finished plinth: the cover dug out, the floor trapdoor, the cap)

- slab4: built=True facing=north cap+floor read on the server: True (at=2393,123,2399 facing=north floor=1 wood=carried pit_first=0 pit_tossed=0 pit_items=0 free=33)
- slab2: built=True facing=north cap+floor read on the server: True (at=2393,121,2399 facing=north floor=1 wood=carried pit_first=0 pit_tossed=0 pit_items=0 free=33)

| fixture | raise k | items in the shaft (+1.5 s) | outside | at +30 s in / out | bot row |
|---|---|---|---|---|---|
| slab4 | 4 | 576 | 0 | 576 / 0 | slots=36->27 offlist=0 gclicked=448 stone=576 swords=0 sword_lost=0 sword_kept=0 offlist_i |
| slab2 | 2 | 576 | 0 | 576 / 0 | slots=36->27 offlist=0 gclicked=448 stone=576 swords=0 sword_lost=0 sword_kept=0 offlist_i |

| fixture | raise k | positive control (egg on the top, collected) | 60 passes beside the shaft: items in/out after, walker bag | the LEDGE (4 cells, feet g, 10 s each): walker bag | shaft after |
|---|---|---|---|---|---|
| slab4 | 4 | {'egg': 1} | 576/0, {} | [{}, {}, {}, {}] | 576/0 |
| slab2 | 2 | {'egg': 1} | 576/0, {} | [{}, {}, {}, {}] | 576/0 |

**S3 pathing** (mineflayer-pathfinder with the fleet's well step cost; a bare walker, 50 round trips town <-> throwing stand)

| fixture | to the stand ok | home ok | path nodes in the well column | body samples in the column (100 ms) | p50 ms to the stand | fails |
|---|---|---|---|---|---|---|
| slab4 | 50/50 | 50/50 | 0 | 0 | 2200 | 0 |
| boarda | 50/50 | 50/50 | 0 | 12 | 3553 | 0 |
| slab2 | 50/50 | 50/50 | 0 | 0 | 1801 | 0 |

**S4 tomb** (slab4): out=None plinth cells lost (server)=0; rows: _livelock_escape fixated on one action; relocating to 2439,2368 -- moved 0 of the 53 blocks asked for (dig; la

**S4 pit** (slab4): out=None plinth cells lost (server)=0; rows: _marooned_self_sourced no route from y=117; dug 4 of 4 neighbouring block(s) and gained 72 placeable — haveBlo; _livelock_escape fixated on one action; relocating to 2403,2357 -- moved 0 of the 44 blocks asked for (dig; la

### The townzone-01 composition (sandbox3, a81034e6 = plinth r8 merged into tz-on-82aef34 b945226a)

**S1 build** (a plan from the no-site record to complete; the server read after every visit)

| fixture | rep | kills | k | plan steps (place+clear+stair) | server: placed / planned | cleared | outside the plan (server) | block_place packets | retries | alt stands | visits | complete (s) | pit rows | cap open at end | same plan as offline |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| slab4 | 1 | - | 4 | 84 (84+0, stair 3) | 84/84 | 0/0 | 0 | 85 | 0 | 0 | 3 | 98 | well_pit_dug plinth; well_pit_covered build | False | True |

Builds complete with every planned cell on the server and nothing outside the plan: **1 of 1**.

**S4 tomb** (slab4): out=None plinth cells lost (server)=0; rows: _livelock_escape fixated on one action; relocating to 2400,2426 -- moved 0 of the 26 blocks asked for (dig; la

**S4 pit** (slab4): out=None plinth cells lost (server)=0; rows: _marooned_self_sourced no route from y=117; dug 4 of 4 neighbouring block(s) and gained 72 placeable — haveBlo; _livelock_escape fixated on one action; relocating to 2353,2386 -- moved 0 of the 40 blocks asked for (dig; la

**S4 tomb-control** (slab4): out={'x': -1.5, 'y': 77, 'z': 6.5} plinth cells lost (server)=0; rows: _livelock_escape fixated on one action; relocating to 2400,2426 -- moved 0 of the 26 blocks asked for (dig; la

**S4 pit-control** (slab4): out=None plinth cells lost (server)=0; rows: _marooned_self_sourced no route from y=117; dug 4 of 4 neighbouring block(s) and gained 72 placeable — haveBlo; _livelock_escape fixated on one action; relocating to 2353,2386 -- moved 0 of the 40 blocks asked for (dig; la; _livelock_escape fixated on one action; relocating to 2336,2396 -- moved 0 of the 55 blocks asked for (dig; la

## S4: an entombed bot and a pit bot beside the plinth

The two S4 scenes test one thing: whether the escape reflexes dig the plinth.

- **Result.** Plinth cells lost were **0 in every run**: 1013T165120, 1013T174115, and the townzone composition
  1013T180541.
- **The bot did not get out in any run.** Neither the tomb bot (300 s) nor the pit bot (180 s) escaped. That is base
  behaviour, not a plinth effect:
  - **The pit CONTROL**, the same pit with no plinth in the world, also did not get out in 180 s. Its rows are the same
    `_marooned_self_sourced` / `_livelock_escape` chain.
  - **The tomb CONTROL is not a valid comparison**, so it is not evidence either way. The tomb is sealed by stone on
    every side *except* the shell cells, which the plinth supplies. With no plinth those cells are air, so the control
    pocket is open on one side. The bot walked out of it, off the floating fixture, and died of a 48-block fall
    (bot log: `died ... cause=was doomed to fall fell_blocks=48`). Its `out` position (-1.5, 77, 6.5) is the world
    spawn, not an escape.
- **Read.** A plinth wall is one more wall of solid stone. A bot entombed against it is exactly as entombed as one
  against natural stone. The defect gate, which checks that no escape digs the shell, holds.

## Offline replay at r6 (`bots/scripts/plinth-replay.mjs --verify --astar`, 16 real towns, 10-13 region copies)

- 16 of 16 towns get a plan.
- Every plan is replayed step by step:
  - supports below or to the side;
  - the stand is proved;
  - the stand walks back to town.
- The A* route has 0 nodes in the column.
- Planning blocks the event loop for at most 58 ms at a time; it is a generator that yields after each ordered step.

```
board-a     cap=364,73,137 k=3 place=62 clear=2 stair=0 hazardStep=62 facing=north stands=15 tried=1 ms=337 block=57 verify=OK astar=OK(12 nodes, stair 0/0, column 0)
board-b     cap=-262,68,136 k=1 place=72 clear=0 stair=0 hazardStep=null facing=north stands=22 tried=7 ms=385 block=43 verify=OK astar=OK(21 nodes, stair 0/0, column 0)
board-c     cap=365,73,137 k=4 place=60 clear=0 stair=0 hazardStep=58 facing=north stands=11 tried=1 ms=308 block=57 verify=OK astar=OK(20 nodes, stair 0/0, column 0)
board-d     cap=362,73,134 k=3 place=58 clear=3 stair=1 hazardStep=59 facing=north stands=13 tried=1 ms=256 block=50 verify=OK astar=OK(17 nodes, stair 0/1, column 0)
hive-a      cap=356,64,135 k=0 place=2 clear=0 stair=0 hazardStep=null facing=south stands=2 tried=1 ms=57 block=49 verify=OK astar=OK(19 nodes, stair 0/0, column 0)
hive-b      cap=356,65,138 k=0 place=0 clear=0 stair=0 hazardStep=null facing=north stands=0 tried=1 ms=52 block=52 verify=OK astar=OK(12 nodes, stair 0/0, column 0)
hive-c      cap=-79,59,-74 k=0 place=0 clear=0 stair=0 hazardStep=null facing=north stands=0 tried=1 ms=44 block=44 verify=OK astar=OK(17 nodes, stair 0/0, column 0)
hive-d      cap=77,59,77 k=0 place=8 clear=0 stair=0 hazardStep=null facing=north stands=6 tried=1 ms=49 block=19 verify=OK astar=OK(11 nodes, stair 0/0, column 0)
isolated-a  cap=361,73,133 k=4 place=62 clear=0 stair=1 hazardStep=60 facing=north stands=14 tried=1 ms=301 block=41 verify=OK astar=OK(19 nodes, stair 1/1, column 0)
isolated-b  cap=359,74,158 k=1 place=76 clear=7 stair=1 hazardStep=null facing=north stands=28 tried=15 ms=8829 block=49 verify=OK astar=OK(10 nodes, stair 0/1, column 0)
isolated-c  cap=342,70,138 k=3 place=70 clear=0 stair=0 hazardStep=68 facing=north stands=14 tried=2 ms=661 block=42 verify=OK astar=OK(14 nodes, stair 0/0, column 0)
isolated-d  cap=369,72,144 k=3 place=62 clear=0 stair=1 hazardStep=60 facing=north stands=12 tried=1 ms=258 block=58 verify=OK astar=OK(22 nodes, stair 1/1, column 0)
placebo-a   cap=257,75,-131 k=4 place=68 clear=0 stair=0 hazardStep=66 facing=north stands=16 tried=1 ms=314 block=43 verify=OK astar=OK(19 nodes, stair 0/0, column 0)
placebo-b   cap=291,59,-396 k=1 place=7 clear=0 stair=0 hazardStep=null facing=north stands=3 tried=5 ms=88 block=41 verify=OK astar=OK(11 nodes, stair 0/0, column 0)
placebo-c   cap=363,75,159 k=3 place=83 clear=22 stair=11 hazardStep=103 facing=north stands=34 tried=8 ms=1680 block=42 verify=OK astar=OK(13 nodes, stair 0/11, column 0)
placebo-d   cap=181,66,66 k=0 place=3 clear=0 stair=0 hazardStep=null facing=east stands=3 tried=1 ms=44 block=32 verify=OK astar=OK(11 nodes, stair 0/0, column 0)
```

## Caveats

- Bags were pre-filled; chest funding is proved only in unit tests.
- One builder per scene. The single-builder lease under contention is proved in `plinth-skill.test.mjs` (exclusive
  generations, tokens, the settle wait), not on Paper.
- k=4 at most, on three fixtures and 16 replayed towns. A town needing more than the planner's search will write
  `_plinth` refusal rows, and the read counts them.
- **S3 body samples.** On `boarda` the body was in the column at 12 (r4), 19 (r6) and 17 (final) of the 100-ms samples, with
  0 path nodes in the column. Two explanations fit and were not separated: the walker's 0.6-wide hitbox overlapping
  the column cells from the adjacent stand, or the walker stepping on the covered cap. No item was collected and no
  fall occurred. On both slab fixtures the count was 0.
- **The r4 kill rep** (slab4 rep 2, 3d9448f6) had its second kill after the walling-in step but before the record said complete.
  The restarted bot finished and completed the plan. The run ended with the cap OPEN: `_well_pit_dug` was written but
  no `_well_pit_covered` followed. At 0e288720 the same scene, killed at the same point, ended covered
  (`_well_pit_covered by=build`, cap open at end False). Both review rounds between those shas (r5, r6) touched
  ownership and the cover path. This document does not attribute the fix to a single change. The canary read gate P3
  (a pit open more than 10 min) catches the r4 behaviour if it recurs.
