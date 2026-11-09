# roads-01 + lamps-01: stone-brick roads on the bots' travel lines, and lantern posts (2026-11-09)

**Owner (11-09 ~12:45Z, "i want all of those things done"):**

1. Stone-brick roads linking town, mine, forest, village and farm, and the showcase's landmarks.
   - Routes come from the bots' real travel lines: measure the most-walked corridors.
   - Grade the roads gently, with stair or slab steps and no 1-block jumps.
   - Build them from stone bricks, slabs and stairs, with cobble as the fallback. Add edging and verges.
   - Tie them into the existing paths records.
   - Goals: fewer pathfinder dirt pillars, less walk time, and surplus cobble used up.
2. Lamp posts along the roads, paths and town walls: fence or log posts with lanterns, spaced to light the route at night and to look good in the timelapse.

**Status:**

| Branch | Tip | Tier | State |
|---|---|---|---|
| `roads-01show` (showcase tip `b9fa002e`) | `cde69b81` | 2, not protected (`protected.py`: not protected) | Ready to stage, not released |
| `roads-01-on-bcdba35f` (the fleet port) | `0c8911a8` | 2 | Built. Registration and draft queue entry in `~/mcai-analysis/roads-01.*` on the canary host. Not queued |

Ledger row: `roads-1109`.

## 1. Designs, reconciled

Three designs were written from the same brief: Claude (this one), Codex, and an independent Claude subagent. Each was written without seeing the others.

| Point | Codex | Independent Claude | Built |
|---|---|---|---|
| Where the traffic comes from | A host reporter, daily; the bots read it | The bots keep their own trail grids | **Host** (`scripts/host/roadtraffic.py`). It is cheap and testable, and it works the same in every pool. The bot-side grid is a later option. |
| Route | The most-walked line, a router with a `discount`, within 6 of the line | The polyline fed to `routeLeg` | The bot's own router (`roads.mjs routeRoad`) within 12 of the host's line. The band is wider because the showcase yard and ziggurat sit across their lines. |
| Width | 3 tread + 2 kerb + verges = 7 | The same | The same: verge, kerb, tread ×3, kerb, verge. Flush, never raised. |
| Grade | At most 1:2, bottom slabs, a flat landing at corners | 1:3, stairs, and slabs at ridges | **1:2 with bottom slabs.** A slab sits at the first row of each new level (a top-face click, so always the bottom half); a level holds at least 2 rows; corners are a flat 5×5. `gradeOf` re-measures the finished cells: no 4-neighbour step over half a block. |
| Wall | Never cut a wall | Add a gate to the wall record | **Never cut a wall.** A route leaves through a gap: the landing is a column with no wall cell, up to 14 along the ring and up to 24 out from it. |
| Cells of other projects | Single ownership | Never a cell on another record | **Never on another record's cell column.** `own` covers the paths, the yard's piles, the ziggurat and a tower. Records without zones (the yard, the ziggurat) are covered by their cells. |
| Lamps | Fence + lantern, roads every 10 | Log + fence + lantern, staggered every 12 | **One-block fence or log post + lantern**, every 12 rows, sides alternating. A two-high post failed the proof: the lantern's top face is above the eye of a bot on the road, so no stand can place it. |
| Lamps on paths and walls | Extend `dress` | Extend `dress` with new fixture kinds | **LAMPS2**: a new dress lamp is a fence post + lantern (`L<n>-fpost`, `L<n>-lamp`), and a wall top gets a lantern. A signpost keeps its stone post and torch, because its torch may hang on the post's side and a lantern cannot. |

## 2. Measured (showcase, 7 days to 11-09 12:35Z)

The traffic picture is [`traffic-7d.png`](roads-design-2026-11-09/traffic-7d.png). It covers 2,142,324 rows, 1,471,259 of them with `bot.pos`, from 15 bots, with 305 bot-hours of surface walking.

- **Traffic is a starburst**: straight rays from the town centre to each destination.
- **Pathfinder scaffold**: `_place_town reason=pathfinder outcome=placed` gave 9,562 in 7 days in the town zone (pillar 5,056, step 4,372, bridge 134).

**Trips from the ring to destinations outside the walls** (`roadtraffic.py`):

| Destination | Trips | Median seconds | Route length |
|---|---|---|---|
| stepwell | 1,417 | 17.5 | no route (it touches the wall extension) |
| yard | 1,368 | 13.4 | no route (beside the wall) |
| village-taiga-6_1 | 1,176 | 11.9 | 35 |
| forest | 751 | 32.8 | 28 |
| shrine Z1 | 102 | 33.6 | 42 |

**Stock**:

| Where | What |
|---|---|
| Showcase chests | stone bricks 582, stone 312, deepslate bricks 288, cobbled deepslate 1,010, cobblestone 52, iron ingots 85, lanterns 12, torches 67 |
| Showcase bags | cobblestone 1,831 |
| Fleet | 15k cobblestone surplus. The fleet towns all have walls, paths and shafts. There are no forest or farm records, so the work places come from dwell bins. |

**The fleet's ground** (copies of the region files): east of board-b, 167 of the 480 top blocks around the route start are cobblestone. Much of it hangs 3–7 blocks over the grass with air under it: the pathfinder's scaffold.

## 3. How it works

**The host.** `roadtraffic.py` (stdlib, read-only, one atomic write) writes `roadtraffic-<home>.json` into the pool dir. It runs daily on the showcase VM and on the canary host. It contains:

- the traffic grid, as one traversal per 1×1 column per row pair at most 20 s apart;
- the destinations: records outside the town, villages from `_merchant_seen`, and work places (the 8×8 dwell bins);
- the trips and their medians;
- the routes: the least-cost line over the traffic from the ring to each destination with ≥ 40 trips. Wall columns are impassable, so a line leaves through a gap.

**The bot** (`roads.mjs`, pure):

1. `trafficRoutes` reads the file; one older than 14 days counts as no traffic.
2. `siteRoad2` takes the route with the most trips that has not ended. It continues from the end of that route's last instance, or from `routeStarts`, which looks for a landing in a gap with open head room.
3. `routeRoad` finds the next ≤ 16 centreline nodes. It is a Dijkstra over (x, z, level, direction, rows-at-level, rows-since-turn) within the band.
   - Each node's cross-section must pass `crossSection`: its columns read and unreserved, fill ≤ 2, natural cut ≤ 2, a stack of the bots' cobble ≤ 8, no liquid within one column, the verge no more than 3 low.
   - If the goal cannot be reached, the road goes as far as it can. The route then ends `blocked_<why>` and is retried after 3 days. An unread chunk never ends a route.
4. `roadInstance` lays out the cells: tread, accent, kerb, slab, core fill, verge fill, lamps. The clears are logs, leaves, cuts and floating litter in the head room.
5. `sinks.mjs proveBuild`, with the road's slab rows as floors, proves the instance. An unreachable pit-bottom fill cell, or an unplaceable lamp, is left out of the instance. Any other unbuildable column makes the router go round it (4 retries).

**The record.** It is the road sink's own (plot `road`; R1, the old spoke segment, is kept).

- Node-square zones, never a box.
- `front` is the landings. The paths read a record's `front` as a destination (`paths.mjs pathDests`), so the town's paths extend a leg to each road. That is the tie-in.
- `ROADS.instancesMax` is 60.

**The visit** (`skills.mjs buildSink`):

1. `roadKit` runs before the bag accounting opens. It crafts slabs at a table (stone bricks 3 → 6, or cobblestone), spruce fences, and lanterns from town iron above 32 and torches above their reserve.
2. The bill is drawn.
3. `runVisit` runs with `floors: roadFloors(rec)`.

## 4. Pictures (the bots' own siting code over copies of the worlds; `render.py` in the scratch dir)

| Picture | What it shows |
|---|---|
| [`show-top-before.png`](roads-design-2026-11-09/show-top-before.png) and [`show-top-after.png`](roads-design-2026-11-09/show-top-after.png) | The showcase village road: 52 rows in 3 instances, arrived, 4 lanterns, a deepslate-brick centre line, a cobbled-deepslate kerb |
| [`show-village-side.png`](roads-design-2026-11-09/show-village-side.png) | The village road's profile: a climb from 65 to 71 in half steps |
| [`boardb-top-before.png`](roads-design-2026-11-09/boardb-top-before.png) and [`boardb-top-after.png`](roads-design-2026-11-09/boardb-top-after.png) | The fleet's board-b road to its work place: 70 rows, 381 clears (mostly the bots' floating cobble), 4 lanterns |

Offline results on the showcase copy:

- **Village**: 52 rows, arrived.
- **Forest**: 4 rows, then `blocked_reserved`. The yard and its piles sit across the walked line.
- **Shrine**: `blocked_path`. The ziggurat's cells are in the way.

hive-c: 20 rows.

## 5. Materials

**Per row:** 3 stone bricks (the accent stone on pattern cells), 2 kerb stones (cobbled deepslate, then deepslate bricks, then cobblestone), and the fill under it (any solid; the bag's cobblestone goes first). A riser row is 5 slabs.

**The showcase village road:** about 90 stone bricks, 75 cobbled deepslate, 35 deepslate bricks, 25 slabs and 4 lanterns.

**The fleet board-b road:** mostly cobble family and its own litter.

**Lanterns:** 8 nuggets and a torch each, about 1 ingot per lamp. The fleet keeps iron above 32.

## 6. Effect (owner rule 11-06: every new project kind declares one)

| Effect | Metric | Note |
|---|---|---|
| Primary | `_place_town reason=pathfinder outcome=placed` per bot-hour within 6 columns of a road cell, 7 days before against 7 days after | Showcase instrument. The fleet has no `_place_town` (placeaudit-fleet-01 is the instrument there) |
| Secondary | The route's median trip seconds from `roadtraffic.py` | Village 11.9 s before |
| Secondary | Cobble family placed by `project=road` per day | |
| Lamps | Lit share of tread cells at night | Read off the record against the light model; spot-checked by the night timelapse |

## 7. Paper (sandbox8, the bots' own code, the showcase line)

**Setup** (`sandbox/roads/roads-e2e.mjs`): a town ring with a 3-wide gap, a 2-deep pit, a 1:2 slope, a spruce on the line, a pond beside it.

**Run 3 (`X0` 6200): PASS.**

| Check | Result |
|---|---|
| Instances | R1 21 + R2 21 + R3 8, arrived |
| Cells read back by the server | 259/259: 35 bottom slabs, log posts with axis=y, 4 lanterns |
| Clears | 19/19 gone |
| Stray blocks | 0 |
| Pathfinder walks, landing to end and back (no dig, no scaffold) | 6, all arrived |
| Feet rise between 100 ms samples | max 0.5 |
| Jumps | 0 |
| Road cells changed by the walks | 0 |

**Run 2 (`X0` 6000)** ended R2 at 40 rows with `blocked_cut`. That was not reproduced offline or at 6200. The driver now prints the router's refusals when a route blocks.

## 8. Fleet port (`roads-01-on-bcdba35f`)

The fleet line has none of the showcase's sink machinery: no `sinks.mjs`, no `townstyle` aimed click, no reroof-04 slab floors.

**What was ported:**

- `roadsbase.mjs`: the proof, the growing record and the visit options, copied from `sinks.mjs` for the road's case.
- `buildsite.mjs walkFrom`: slab floors.
- `buildrun.mjs`: passes `p.floors`.
- `shop.mjs`: a `road` project after the paths. A town with no road record reads it as standing and only *due* (never an open project that holds the order).
- `skills.mjs buildRoad`: siting, kit, draw, `runVisit`, complete, and a 2-hour town no-site stamp.
- Fence posts only: without the aimed click, a log's axis follows the face that was clicked.

ROADS2 defaults to every pool on the fleet line, so the variant is the rollout.

**Paper on the fleet line** (sandbox8, the same driver):

| Run | Result |
|---|---|
| `X0` 6600 (the old turn rule) | Stalled. A road that jogged round the pit turned at the third row of a new level, so the corner's 5×5 covered the riser row, and its slabs deferred `retry` until `stuck_on_cell`. **Fixed on both lines:** a turn now needs 4 rows at its level (test plus anchored mutant). |
| `X0` 6800 and `X0` 7000 (`ac971eba`) | **PASS.** R1 21 + R2 21 + R3 8, arrived. 259/259 cells read back by the server. 34 clears, including a floating cobble beam and a 3-high pillar. 0 stray. 6 walks, max rise 0.5, 0 jumps. |

**Reviews (Codex, blockers only):**

- **Showcase r1:** 1 blocker. Verge columns beyond the cross-sections were not checked against `own`/`guard`. Fixed. r2: none.
- **Fleet r1:** 2 blockers. A waterlogged leaf could be cleared; a laid road dropped out of `projectsGuarded` with ROADS2 off. Both fixed, on both lines where they apply.
- **Fleet r2:** 1 left. The fleet `planReader` dropped a leaf's props. Fixed (`ba860677`). Later commits (`d5c8f603`, `0c8911a8`) only keep the suite's anchors and the ROADS2 default (named fleet pools only).

**Draw:** `drawrec.sh roads-01` with the registration staged gives `DRAW (2 pools = 10 bots): ['hive-c', 'board-d']`. board-b, which has the 70-row route, holds the live canary on 11-09.

**Before launch:** write the pools' traffic files and add the daily cron (with a `monitors.json` row):

```
roadtraffic.py --pool <p> --home=<hk>
```

## 9. Risks and what is not built

- **Ending on a temporary block.** A route that blocks is retried after 3 days.
- **Corridors are fixed until the host rewrites the file.** A road is never rerouted after it is built.
- **Bot-built cobble that is not on any record is cut as litter.** Pillars and beams, as the tidy does.
- **Not built:**
  - stairs (the slab grade satisfies "no 1-block jumps");
  - re-surfacing the in-town paths in stone brick (phase 2, at the same level);
  - a bridge where a road ends at water (bridges-01's traffic sites will see the road's end);
  - a bot-side trail grid.
