# seapocket-01: the open-sea bubble (placebo-d-Bravo, 46,59,69), 2026-11-09

Protected scope (reflex.mjs, swimunder.mjs, escdead.mjs): tier 3. Branch `seapocket-01` on the live fleet `3d8ef9de`
(workboard-01, which already carries escpocket-01). `ESCPOCKET=0` turns it off.

## 1. What pins it

**The rows.** stuckwatch at 15:17Z: pinned for 240 min or more, 0 items. Bravo's skill file today has 15,340 rows.

| time (Z) | row | what happened |
|---|---|---|
| 10:35-11:04 | `_marooned` / `_entombed` (y 38 down to -35 and back) | deep-mine escapes |
| 11:04:58 | `surface` | "climbed 63 blocks to y=58, still 5 below sea level". The shaft came up into the **ocean floor** |
| 11:06:43-53 | `_water_no_air_route`, `_air_drowning_observed` oxygen 8, `_drowning_route` | under water, no air |
| 11:07:02-13 | `_air_pocket` kind=pocket **seal=4** cell=46,60,69 block=cobblestone, outcome success | the rescue seals the 4 head-level sides and digs the cobble over its head |
| 11:07:31 onward | `_entombed` "walled in at y=59", then the chain below, every 1-15 min | pinned |

**The cell.** The 11-09 03:16:22Z backup region copy (read-only) plus the five edits the rescue made: the four seals and the
dug cobble. This reproduces the live rows exactly.

| y | 46,y,69 | sides at that y |
|---|---|---|
| 63 | air (open sky) | air |
| 62 | dirt | water |
| 61 | cobblestone (the roof) | water |
| 60 | air (the head; dug 11:07) | **cobblestone x4** (the seals) |
| 59 | water (the feet) | water |
| 58 and below | water (open sea) | water |

The old cobble and dirt column at 46,61-62 is bot-built; a few blocks like it stand in this sea. The sea runs up to y62 and
the open surface is at y63.

**The dead end.** Every rung refuses, and none of the remedies they name can be carried out from this cell.

| rung | refusal (live row) | why it is correct, and why it is still a dead end |
|---|---|---|
| flood guard (pillar, ramp) | "liquid beside the block overhead (water)" | digging the roof floods the bubble from the side |
| plugcut | "4 wet faces, more than 3" | too many faces to plug |
| pathfinder | `sealed_in_liquid` | it cannot start from a liquid node |
| swim, narrow | "no way out within 4 cells (92 water cells searched)" | the reconstruction gives 92 too |
| swim, wide (from 30 min) | "no way out within 8 cells (110 water cells searched)" | the reconstruction gives 110 too |
| pocket dig (escpocket) | "0 of 0 block(s) tried" | open water: nothing at or below the feet to dig |
| breach (escdead) | "no water over the roof" | the water is beside the roof, not over it |

**The way out exists.** It is 9 cells: down 1, east 2, up 4, then step out onto the dirt at 46,63. Six of those cells
are head-under-water **in a row**. The swim's breath bound is `SU_MAX_WET_RUN = 5`, so the plan is one cell too long.

The rescue's seals are what made it 6. Without them, the 03:16 cut has a way out within 3 head-wet cells (test S2).

## 2. The fix

1. **The long-breath tier** (`escdead.mjs longBreathPlan`).
   - It runs on the wide tier only: a pin of 30 min or more, or a recorded trap.
   - It runs once the wide search has failed, and plans again with a head-wet run of up to **6**.
   - It runs before the pocket dig, unless a long firing already failed at this spot. A plan within 5 is always preferred.
2. **The way back is paid for** (`swimunder.mjs swimUnderAbort longRun`, Codex r1 blocker).
   - On a plan longer than 5, the air left must cover every head-wet cell behind (30 ticks each) plus 60 ticks.
   - If it does not, the swim turns back, unless the nearer breath is ahead.
   - Base plans are unchanged.
3. **Licence and rows.** The licence row is `_seapocket_mode on=1 long_wet_run=6 base_wet_run=5 tier=wide_only`. Both
   `_swim_under_start` and `_swim_under` carry `breath=6`.

## 3. Proof

**Tests:** `bots/test/seapocket.test.mjs`, 12 tests, 3 of them anchored mutants.

| test | result |
|---|---|
| S1 | LIVE reproduction: 92 / 110, startCells, the breach reason |
| S2 | positive control, without the seals: 3 head-wet cells |
| S3 | the long plan reaches dry 46,63,69 with a head-wet run of 6 |
| S4 | prismarine-physics: out onto the dirt, health 20, min air 16 of 20 |
| S5 | the composed chain: every rung refuses, the long tier plans |
| S6 | ordering and wiring |
| A1 | the paid-way-back rule |
| A2 | physics: the exit closes at cell 5, the body returns, min air 171 ticks |
| A3 | physics: the exit closes at the last cell, a 3-s stall, setting out on 200/300 ticks: the whole wake back, health 20, min air 109 ticks |

escpocket, escdead and swimunder tests are green.

**Reviews.**
- Codex r1: 1 blocker, the return-air budget. Fixed.
- Codex r2: no blockers.
- Independent Claude subagent r1: no blockers. It made two notes, both taken: the pocket dig goes first after a failed
  long firing, and `breath=` is on the outcome row.
- Claude r2: no blockers.

**Paper.** Sandbox5 and 6, scenes cut from the 11-09 region copy plus the five edits, Bravo's bag,
ESCDEAD_PIN_MS=60000 for both arms.

| scene | base 3d8ef9de | candidate e81becc4 |
|---|---|---|
| reconstruction (11-09 cut + the 5 edits) | stayed 1/1 | stayed 3/3 (no arm fires: see below) |
| `-pillar` (+ a synthetic stone pillar 4 east) | **stayed** 1/1, the live chain ("109 water cells", pocket dig 0) | **escaped 3/3**: `_swim_under_start wide=1 breath=6 wet=6 run=6`, then `_swim_under outcome=out cells=9/9 min_air=17 hp=20->20 ms=6043-6101 breath=6`, then `_trap_site_recorded` |

(A first lane copied the isolated-d scene's oracle start cell by mistake, and every arm read "escaped". It was discarded.)

The plain reconstruction does not fire `isEntombed`: no probe finds ground 4 or more above. So neither build acts there.
Base and candidate both stayed. This is the same gap escdead-01 recorded for hive-c's open lake. The `-pillar` scene adds a
synthetic stone pillar 4 cells east, so the arm fires as it did live.

## 4. Draw

`drawexposure.py`, 6 h to 11-09 15:40Z:

| requirement | eligible pools | result |
|---|---|---|
| `swim_under_refused` >= 1 | placebo-d only (19 rows) | REFUSED: two pools are needed |
| `climb_flood_refused` >= 3 | hive-c 4, hive-d 4, placebo-a 7, placebo-b 5, placebo-d 75 | **PASS** |

The registration declares the climb-flood requirement. It pins placebo-d (Bravo) and placebo-a. isolated-* and placebo-c are
never pinned.

## 5. Not covered

- **The rescue that made the trap.** The air-pocket rescue seals the head-level sides even when the open sea surface is 4
  cells away. A rescue that checks whether a swim plan exists before sealing is the root fix, in airpocket.mjs. It is not
  built here.
- **The probe gap.** `isEntombed`'s higher-ground probe does not see a sealed bubble under an open sea or lake unless some
  ground stands 4 or more above nearby.
