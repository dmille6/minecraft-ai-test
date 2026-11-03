# groundskeeper-01: the groundskeeper and the town land plan (2026-11-02)

Owner 11-02 (ledger `groundskeeper-1102`): "have one of the bots work on tidying the town first, then tidying the surrounding
area slowly working their way out to make the land more organized and easy to maneuver ... a grounds keeper", following a PLAN
for roads and organization. Accepted shape: deterministic code draws the plan, one leased bot executes it; the LLM mayor (not
live) may later choose only inside the plan (which spoke next, the monument site, names), never geometry.

Code: `bots/src/landplan.mjs` (the plan), `bots/src/groundskeeper.mjs` (the lease), `bots/src/tidy.mjs` (stages, road work,
replant, lights, cut order), `bots/src/buildrun.mjs` (two visit knobs), `bots/src/shop.mjs` + `bots/src/skills.mjs` (wiring),
`bots/src/wall.mjs` (a road is a gateway), `bots/src/paths.mjs` (`routeLeg` options, defaults unchanged). Offline proof:
`bots/scripts/landplan-offline.mjs`. Tests: `bots/test/groundskeeper.test.mjs`. Tier 2 (`protected.py`: not protected).
Rollback: `GROUNDSKEEPER=off` (tidy-01 exactly as before), `LANDPLAN=off` (the keeper, stage 0 only), or the base sha.

## Why tidy-01's visits died (11-02, 20 h, Events over 1,498,646 rows / 80 bots)

215 tidy `_build_visit` rows from 25 bots (of 2,125 build visits): **92 `deadline`** (median 129 s, 1-5 blocks cut, 0 placed)
and **89 `attempts_spent`** (`T-xx-0: 1 open, 0 placeable now`), 4 complete. Tidy `_build` rows: 1,098 place, 198 clear,
72 deferred, 41 `stuck_on_cell` (all `early=true`: named rows, not stops), 18 waived.

- `deadline`: runVisit dug the record's cuts **highest first across the whole 64x64 square** -- a walk across town between two
  digs, in a 120 s visit. Fix: `chainCuts` (column by column, nearest first from the bot, top first within a column) and
  `tidyKeepOrder`; the keeper's clear bound is 16 a visit so its fills run too.
- `attempts_spent`: one open cell whose attempts were spent ended the whole visit. Fix: `deferSpent` defers it like a cell no
  stand reaches (counted, waived after 3 visits) and the visit goes on. Reproduced on the fake server (two 1x1 pits, the
  near one's bottom refused or silent): `attempts_spent ... 1 open, 0 placeable now` without, the far pit laid with.
- Three builders shared one clear lease and the tidy was every bot's last pick, a 2-minute visit every 10+ minutes.

## The groundskeeper

A `keeper` lease on the tidy's record key (the yard clerk's pattern: the lease is the one admission slot, TIDY builders 1).
Its holder works the tidy FIRST (shopActive) and gets its order back every 2 min (SHOP_COOLDOWN_MS 10 min for everyone else);
every other bot sees the tidy full and builds the other projects. The lease lasts 30 min a renewal, a term 4 h (then it is
released and its holder rests 1 h: the town's bots take turns), lapses when the keeper leaves town, and is released as soon as
the grounds want nothing (the last stage complete, nothing due) -- it never holds a bot from the other projects for nothing.
Rows: `_keeper op=keeper_take|keeper_release` (new kind, the licence), `_land_plan op=land_planned` (one a town).

The work, stage by stage (the ring order):

| stage | id | what |
|---|---|---|
| 0 | town | tidy-01 as it is: pillars and pits in the 32 square, the paths' corridors to the chests and the well graded |
| 1 | roads | the ring road and every spoke out to 48: earthwork, head room, trunks felled (one sapling replanted in the tree-farm zone each, B4: never before it), torches beside the road when the town spares them |
| 2-4 | rim48, rim64, rim80 | each band's bot pillars and pits (tidy-01's survey with `rMin`), and the spokes through it |

Buried fill cells take **cobblestone first** (role `core`; the top stays dirt and greens): a sink for resource-model-1102.
Nothing beyond the band being worked is touched; protected zones, the plan, wells, the farm, every project's record and
reservation stay refused (tidy-01's `avoid`); no sapling in a corridor. A stage whose road work would make walking from the
town WORSE (the same BFS as the offline proof) drops its road work and keeps its pillars and pits (`road_walk_worse`).

## The land plan

Seeded per town (`landSeed(pool, home)`, the ziggurat-variety rule): ring radius 20-28 (never inside the inner plan + 4) and
its octagon chamfer; 3-5 spokes -- the plan's gate (the expedition road; each spoke names its `rail` on to the next ~400-block
outpost), its shaft (the mine), then seeded bearings at least 60 degrees apart, none through the monument sector; per-sector
zones (monument, industry, farms pinned by the plan; yard, two homes, a tree farm seeded; the rest wild). Roads are routed by
the paths' own router over a grading allowance of 6 (spokes from the plaza's edge outward, within 8 of their ray; the ring as
arcs between the spokes' crossings, within 12 of its radius), A* with a Manhattan bound, a blocked waypoint passed. Corridors
(road columns + 1) are a reservation every later siting reads (`projectHeads`); the wall opens a gateway on one. The plan is
published once as `project-<home>.land`; `choices` holds what a mayor may pick later.

## Offline proof on region copies of the 16 fleet towns (11-02 ~18:48Z)

Region files copied read-only on the worlds host and dumped (home +- 112, y home-16 .. +20); pool records copied from the canary
host. `node scripts/landplan-offline.mjs <dump> <pool>`, every stage applied in order on the ground the last one left.
**Along roads** = the plan's road columns a walker reaches from the town (the inner plan walked freely, then road columns only;
step up 1 / down 3, two cells of head room). **Walk** = read ground columns within 80 reached from the plaza's edge.

| town | ring R | roads routed (waypoints) | along roads before -> after | walk before -> after | ring waypoints walked | cut + fill | road work dropped (never worse) | plan ms |
|---|---|---|---|---|---|---|---|---|
| board-a | 20 | ring:6/13 s0:1/7 s1:1/7 s2:3/7 | 167/314 (53.2%) -> 268/314 (85.4%) | 47.3% -> 48.7% | 6/12 -> 8/12 | 388 + 1253 | - | 1395 |
| board-b | 26 | ring:18/18 s0:7/7 s1:7/7 s2:1/7 | 316/986 (32%) -> 908/986 (92.1%) | 74.5% -> 75.5% | 14/16 -> 15/16 | 305 + 743 | - | 3323 |
| board-c | 26 | ring:2/21 s0:7/7 s1:1/7 s2:2/7 s3:1/7 | 28/270 (10.4%) -> 27/270 (10%) | 35.1% -> 36.9% | 10/20 -> 11/20 | 207 + 870 | - | 1618 |
| board-d | 23 | ring:3/18 s0:7/7 s1:7/7 s2:1/7 s3:1/7 | 74/480 (15.4%) -> 100/480 (20.8%) | 16.6% -> 16.9% | 5/16 -> 6/16 | 164 + 727 | - | 1326 |
| hive-a | 20 | ring:1/17 s0:7/7 s1:3/7 s2:1/7 s3:5/7 | 1/412 (0.2%) -> 1/412 (0.2%) | 62.5% -> 63.6% | 10/16 -> 10/16 | 159 + 1104 | - | 1346 |
| hive-b | 23 | ring:5/17 s0:6/7 s1:1/7 s2:1/7 | 58/262 (22.1%) -> 167/262 (63.7%) | 68.8% -> 69.5% | 12/16 -> 11/16 | 99 + 1074 | 2,3 | 1508 |
| hive-c | 25 | ring:8/17 s0:2/7 s1:7/7 s2:5/7 | 58/492 (11.8%) -> 152/492 (30.9%) | 4.9% -> 61% | 5/16 -> 12/16 | 216 + 842 | - | 1658 |
| hive-d | 21 | ring:5/17 s0:5/7 s1:2/7 s2:7/7 | 38/308 (12.3%) -> 38/308 (12.3%) | 51% -> 51.7% | 13/16 -> 15/16 | 32 + 891 | 1 | 1717 |
| isolated-a | 24 | ring:1/16 s0:5/7 s1:1/7 s2:4/7 | 31/298 (10.4%) -> 31/298 (10.4%) | 8.4% -> 10.4% | 4/16 -> 5/16 | 138 + 841 | - | 1199 |
| isolated-b | 27 | ring:5/15 s0:3/7 s1:1/7 s2:1/7 | 24/176 (13.6%) -> 24/176 (13.6%) | 3.2% -> 3.2% | 2/16 -> 2/16 | 189 + 710 | - | 1310 |
| isolated-c | 27 | ring:5/18 s0:2/7 s1:5/7 s2:3/7 | 0/434 (0%) -> 0/434 (0%) | 46.1% -> 46.9% | 10/16 -> 11/16 | 144 + 628 | - | 2616 |
| isolated-d | 24 | ring:17/17 s0:7/7 s1:7/7 s2:7/7 | 63/1138 (5.5%) -> 116/1138 (10.2%) | 24.3% -> 46.3% | 4/16 -> 12/16 | 251 + 1435 | - | 2848 |
| placebo-a | 20 | ring:3/19 s0:7/7 s1:3/7 s2:7/7 s3:7/7 | 154/675 (22.8%) -> 365/675 (54.1%) | 75.1% -> 75.6% | 16/16 -> 16/16 | 133 + 901 | 3 | 2350 |
| placebo-b | 21 | ring:6/13 s0:1/7 s1:1/7 s2:1/7 s3:3/7 | 96/248 (38.7%) -> 96/248 (38.7%) | 73.7% -> 74.3% | 8/12 -> 8/12 | 147 + 552 | 1 | 766 |
| placebo-c | 27 | ring:5/19 s0:1/7 s1:1/7 s2:1/7 s3:1/7 | 56/140 (40%) -> 78/140 (55.7%) | 16.6% -> 17% | 3/20 -> 3/20 | 133 + 555 | - | 580 |
| placebo-d | 27 | ring:4/20 s0:7/7 s1:1/7 s2:3/7 s3:2/7 | 102/579 (17.6%) -> 556/579 (96%) | 64.5% -> 67.2% | 19/20 -> 19/20 | 271 + 1662 | - | 2059 |

Totals: along the roads **1,266 -> 2,927 of 7,212 road columns (17.6% -> 40.6%)**, better in 9 towns, unchanged in 6, one
column fewer in board-c (its stage-0 survey); walk over the land **163,659 -> 185,615 of 392,082 columns (41.7% -> 47.3%)**,
never lower in any town. The guard dropped a stage's road work in 4 towns (hive-b 2-3, hive-d 1, placebo-a 3, placebo-b 1).

What did not work, measured first: an unbounded router wandered round every earthwork (hive-c's ring 1,624 columns, filled 4
over the plaza's edge, cutting the town off its roads); bounding fill to 1-2 routed almost nothing (12-200 road columns a town).
Rings close in 2 of 16 towns (board-b, isolated-d): the fleet towns' rings run into wells, walls, houses and quarries; the ring
is worked where it routes. Planning costs 0.6-2.9 s a town offline, in legs of at most 150k router pops with a pause between.

## Reviews

Codex (codex exec, blockers only) r1: 2 BLOCKERS -- road work ignored a zone or reservation sited after the plan; a stage
completed with road clears still standing -- both fixed (`roadWork` takes the tidy's `avoid`; `tidyClearsLeft` + `GK_CLEAR_VISITS`),
r2 BLOCKERS: none. r1 note acted on: the walk guard shares one column scan per ground, radius = the stage's reach + 8.

## The read

Generic +90/+180 (tripper, death gate, crash loops). Own lines: `_keeper` rows (the licence; never two holders' terms
overlapping in one pool), `_land_plan` rows (at most one a pool), tidy `_build_visit` stops (`deadline` + `attempts_spent` were
84% of tidy visits on 11-02), `_build project=tidy op=sited` rows with `seg=stageN`, `deferred why=attempts_spent`.
