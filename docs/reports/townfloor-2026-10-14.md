# Town floor: the bots fill the ground they dug from under their towns (2026-10-14, design + build, r2)

OWNER 10-14: "lets absolutely do what you recommend with the cobblestones". Surplus cobble is to be USED; the junk well
is the overflow, not the main outlet. This document holds the scale, measured read-only; the design of the town-floor
job (A); the first simple build (B, design only); the tests and mutants; the Paper sandbox evidence; and the canary
registration.

Nothing in this work changed a fleet world. Region files were copied read-only from 10.0.0.30 (`cat` of
`/srv/block2/<pool>/world/region/r.*.mca`, 10-14 18:00Z). Logs were read on 10.0.0.31 under `nice -n 19` with
`lib/telemetry.Events`. World edits happened only in the Paper sandbox arena (sandbox2, x/z 2370..2430), under the
sandbox lock.

## 0. Answers first

**How big is the hole?**
- The repair box is the town-ground zone's protected band: Chebyshev 16 around home, from the floor level
  L = home.y - 2 (the platform's top) down 10 layers.
- It holds **3,300-8,100 open cells per town, 103,340 over 16 towns.** 82,778 of them (80%) were solid in the seed's
  terrain, so the bots dug them; the other 20% are natural caves and dips.
- Under the 13x13 platform alone there are 337-1,435 open cells per town (17,705 in all). The platform floats.

**How much can the job fill?** The production planner was run offline on the 10-14 copies until it stopped (table 1.3).
- A cell is fillable only if it rests on a solid block and can be placed from a stand reached on foot. The stand must
  walk back to town afterwards. Nothing may be sealed, and nobody's way home may be cut.
- **52,388 of 98,116 target cells (53%) over 16 towns are fillable**, between 43% and 69% per town; under the platform 7,996 of 16,431 (49%); the rest under it is sealed or reached only over furniture.
- **The cost is one block per cell.** Most of the rest is sealed voids, such as the cavern under the platform and the
  lattice under floating grass, which can only be filled by digging. The remainder is cells around water, chests,
  saplings and the well.

**Can the fleet pay for it?** Yes, quickly, and after that the fill is limited by supply.
- The bags hold **13,465 cobble above the 64 reserve** (80 bots, 18,091 held).
- The bots pick up **47,559 cobble a day**, about 124 per town-hour. This is a gross collection figure: re-pickups
  count, and net new supply is not measured.
- The job's ceiling is far above that. Each bot's order runs at most once per 10 minutes, at 32 blocks per visit, with
  one builder per town at a time. Five bots therefore allow up to ~960 blocks per town-hour; bot-time at town is the
  practical limit.
- So the bag surplus goes in hours to days, and after that the floor takes what the bots collect beyond the reserve.
- The canary reports the cobble held per bot (DiD) and gather displacement (the harm line's `gather_ratio`).

**Does it make the bots safer?** Possibly; the canary reports it, the design does not claim it.
- The town square is where falls concentrate. Per bot-hour actually spent there, `_fall_path` episodes are 2.5x more frequent within 16 of home (34.4 per 100 bot-hours) than beyond 32 (13.7), while entombment is lower (18.9 vs 30.9) and deaths are far lower (3.7 vs 31.9 per 1,000 bot-hours).
- Deaths near town are rare: 7 of 281 deaths in 7 days happened within Chebyshev 16 of home.

**Do drownings cluster near towns (for B)?** No.
- Over 7 days, 2 of 117 drownings were within 16 of home, 9 within 17-32, and 106 beyond 32.
- A path ring would not address drowning, so B is not justified on drowning.

## 1. Measurements (read-only)

### 1.1 Open cells in the repair box (`an/profile.mjs`, region copies 10-14 18:00Z vs the seed's fresh terrain)

Chebyshev <= 16, y in [L-10, L]. "Dug" means the cell is solid in the fresh seed terrain, which the townground agent
regenerated on 10-13.

| Town | Open | of which dug | natural | liquid | roofed | open to sky | under the platform |
|---|---|---|---|---|---|---|---|
| board-a | 8,068 | 6,210 | 1,858 | 0 | 5,990 | 2,078 | 1,384 |
| board-c | 7,890 | 6,115 | 1,775 | 0 | 5,593 | 2,297 | 1,364 |
| board-d | 8,025 | 6,185 | 1,840 | 0 | 5,933 | 2,092 | 1,435 |
| hive-a | 7,316 | 5,430 | 1,886 | 0 | 3,577 | 3,739 | 1,070 |
| hive-b | 6,089 | 4,385 | 1,704 | 0 | 3,180 | 2,909 | 858 |
| placebo-c | 7,120 | 5,458 | 1,662 | 0 | 5,431 | 1,689 | 1,279 |
| isolated-a | 7,502 | 5,740 | 1,762 | 0 | 5,184 | 2,318 | 1,311 |
| isolated-b | 7,327 | 5,549 | 1,778 | 0 | 5,245 | 2,082 | 1,283 |
| isolated-c | 7,984 | 6,158 | 1,826 | 0 | 5,200 | 2,784 | 1,330 |
| isolated-d | 7,600 | 5,860 | 1,740 | 0 | 5,340 | 2,260 | 1,325 |
| hive-d | 3,508 | 3,461 | 47 | 0 | 2,080 | 1,428 | 337 |
| placebo-d | 5,569 | 4,764 | 805 | 0 | 4,018 | 1,551 | 915 |
| placebo-a | 5,130 | 4,207 | 923 | 0 | 3,610 | 1,520 | 1,198 |
| placebo-b | 5,074 | 4,950 | 124 | 570 | 3,525 | 1,549 | 1,104 |
| board-b | 3,294 | 3,294 | 0 | 0 | 3,015 | 279 | 617 |
| hive-c | 5,844 | 5,012 | 832 | 794 | 3,764 | 2,080 | 895 |
| **all** | **103,340** | **82,778** | **20,562** | **1,364** | **70,685** | **32,655** | **17,705** |

Denominator: 1,089 columns x 11 layers = 11,979 cells per town; every cell was read (unknown 0). "Open" is air or a
plant; "roofed" means a solid non-tree block lies above it within L+6.

### 1.2 Supply, bags, presence, traps and deaths (`an/tfscale.py` on 10.0.0.31)

The positive control for every count below is the walk itself: it read 9,104,643 rows from 80 bots, and every table has
nonzero cells.
- **Cobble collected (24 h, `_pickups` summaries; collection, not mining):** 47,559 fleet-wide. Per town it ranges from
  1,916 (isolated-c) to 3,864 (board-b).
- **Bags (latest row per bot in 24 h):** 18,091 cobble held by 80 bots, 13,465 of it above the 64 reserve. Per town the
  surplus ranges from 178 (board-d) to 2,717 (placebo-b).
- **Presence (the denominator).** Bot-minutes with a positioned row: 112,056 within 16 of home, 124,467 at 17-32 and
  474,440 beyond 32. That is 1,868, 2,074 and 7,907 bot-hours, so 16% of bot-time is spent inside the town square.
  Rows that carry no position are excluded and counted separately (e.g. 1.1 M `_affordance_scan`).
- **Trap episodes per 100 bot-hours present** (one episode per bot per kind per 10 minutes):

  | Ring | `_fall_path` | `_entombed` | `_entombed_unrecoverable` | `_stranded_underground` |
  |---|---|---|---|---|
  | <=16 | **34.4** (642 episodes) | 18.9 (354) | 6.1 (113) | 1.4 (26) |
  | 17-32 | 20.5 (426) | 45.6 (946) | 11.7 (242) | 6.6 (137) |
  | >32 | 13.7 (1,082) | 30.9 (2,446) | 7.6 (602) | 5.3 (416) |

  Falls are 2.5x more frequent per bot-hour in the town square than beyond 32; entombment is less frequent there.
- **Deaths per 1,000 bot-hours present:** 3.7 within 16 (7 deaths), 10.6 at 17-32 (22), 31.9 beyond 32 (252).
  Drowning: 2 / 9 / 106. The town square is the safest place the bots go.

### 1.3 What the job can fill: the production planner offline (`an/sim.mjs`)

The real `planFloor` from bots/src/townfloor.mjs, at the canary's code, was run to exhaustion on each town's 10-14
region copy, with no entities. Every planned cell rests on a solid block and has a stand reached on foot that walks back
afterwards. No placement seals a pocket of more than 8 cells, and no placement cuts any stand's way to the town.
"Targets" is the open cells left after the protected cells and the hazards (section 2.1) are removed.

| Town | Open | Protected or hazard | Targets | Fillable | % of targets | Platform square: targets / fillable | Stop |
|---|---|---|---|---|---|---|---|
| board-a | 7,964 | 306 | 7,658 | 3,930 | 51% | 1,299 / 564 | none_feasible |
| board-c | 7,735 | 230 | 7,505 | 4,097 | 55% | 1,235 / 490 | none_feasible |
| board-d | 7,926 | 138 | 7,788 | 4,212 | 54% | 1,331 / 563 | none_feasible |
| hive-a | 7,152 | 180 | 6,972 | 4,244 | 61% | 998 / 641 | none_feasible |
| hive-b | 5,975 | 79 | 5,896 | 4,049 | 69% | 855 / 730 | none_feasible |
| placebo-c | 6,983 | 146 | 6,837 | 3,140 | 46% | 1,212 / 246 | none_feasible |
| isolated-a | 7,364 | 68 | 7,296 | 3,810 | 52% | 1,280 / 633 | none_feasible |
| isolated-b | 7,258 | 193 | 7,065 | 3,632 | 51% | 1,163 / 619 | none_feasible |
| isolated-c | 7,895 | 364 | 7,531 | 3,574 | 47% | 1,142 / 547 | none_feasible |
| isolated-d | 7,494 | 205 | 7,289 | 3,889 | 53% | 1,255 / 416 | none_feasible |
| hive-d | 3,482 | 111 | 3,371 | 1,518 | 45% | 323 / 196 | none_feasible |
| placebo-d | 5,538 | 124 | 5,414 | 3,077 | 57% | 910 / 641 | none_feasible |
| placebo-a | 5,064 | 191 | 4,873 | 2,086 | 43% | 1,104 / 330 | none_feasible |
| placebo-b | 5,057 | 902 | 4,155 | 2,632 | 63% | 1,036 / 623 | none_feasible |
| board-b | 3,292 | 83 | 3,209 | 1,575 | 49% | 602 / 391 | none_feasible |
| hive-c | 5,800 | 543 | 5,257 | 2,923 | 56% | 686 / 366 | none_feasible |
| **all (16)** | **101,979** | **3,863** | **98,116** | **52,388** | **53%** | **16,431 / 7,996** | |

## 2. Design (A): the town-floor job

### 2.1 Which cells
- **The box is the town-ground zone's protected band exactly:** Chebyshev 16 (`TOWN_GROUND_HALF`) around home, y from
  home.y-12 (`TOWN_GROUND_DEPTH`) to L = home.y-2.
  - A test asserts that every corner of the box is `inTownBox`.
  - It also asserts that every floor block is zone `ground`: andesite, diorite, granite, cobbled_deepslate and
    cobblestone.
  - With the zone in the build, every one of them is refused as a gather, mine or ore-tunnel target
    (`townTargetPermit`).
- **A target** is an open cell in the box: air, or a plant that a placement replaces (short or tall grass, fern, dead
  bush). Never a liquid, flower, sapling, torch or snow.
- **Protected cells are never filled:**
  - any open cell with a liquid below it, up to the first solid block;
  - a sapling's growth column: its cell and 7 above;
  - the cell over farmland;
  - anything within Chebyshev 1 (3D) of town furniture: containers, tables, furnaces, the composter, doors, trapdoors,
    beds, lectern, bell, anvil, ...;
  - every junk well the town has, breached ones included, and the recorded well site: 5x5 from 3 below the cap to 3
    above;
  - when a plinth record exists (plinth-01), its cap's 7x7 from 4 below to 3 above, and its stair cells.
- **Hazards (`cellHazard`, Codex r1 P1) also refuse a cell:**
  - a sand- or gravel-like block beside or below it with nothing solid under it, because the placement's block update
    would drop it;
  - any liquid within 2 horizontally and 1 vertically, because a flow could be redirected.
- A cell that is not loaded makes the whole visit plan nothing.

### 2.2 How a placement is chosen (pure: `planFloorSteps`, re-run every visit on the world as it is)
- **Supported, never a bridge.** A cell is placed only when the block directly below it is solid. The click is that
  block's top face, or a side face of a solid neighbour; never a bottom face. A support must be a full cube.
- **The town** is an ANCHOR SET: every cell within 4 of home where a body can stand on or above the floor (feet
  L+1..L+4). A single start cell was walled off by chests and tables in hive-b. A hole beside home is never "the town"
  (Claude r5).
- **A stand the town reaches on foot, and that walks back after the click.** This is the plinth planner's walk probe:
  cardinal walk, step up 1, drop 1-3, no dig, no place, no swim. The eye must be within 4.5 of the clicked face's
  centre, above a top face, with a clear line of sight. The builder can never wall itself in.
- **Two walk models.**
  - The BUILDER's own reach and way home are STRICT: full-cube floors, steps only onto full cubes, and never through
    anything the pathfinder avoids (cobweb, fire, berry bushes, pressure plates, ...).
  - The ways `lostWay` protects are PERMISSIVE: any solid floor, beds and chests included. They therefore over-protect.
  - The split was found on Paper: on board-a's real town the first planned stand was reachable in the model only over
    beds, and mineflayer-pathfinder could not reach it.
- **No way is cut (`lostWay`, Codex r1 P1).** Every stand that walks to the town before a placement must still walk to
  it after, the filled cell's own excepted.
  - This holds whoever stands there: another bot, a bot coming up from the mines, or nobody yet.
  - The walk box is the repair box plus 8 around and 8 below, so a route home that leaves the box and comes back is seen.
- **Never seals a void (`sealRefusal`).** After the placement, every open neighbour of the cell must still reach the
  SKY, or be an EMPTY pocket of at most 8 cells.
  - The sky is an open cell at or above L+1 whose whole column is open up to the world's top (y 319). Neither height
    nor a finite scan counts (Codex r2 and r3 each found a roofed pocket that the weaker rules sealed).
  - A cell that is not loaded closes its column. Space that leaves the flood region (the box + 8 around, 8 below and
    10 above) without finding the sky is "unbounded" and is never cut.
  - Air connectivity is the rule for items and empty space.
  - Bodies are protected by `lostWay`.
  - A cell holding a body or an item is never placed into.
- **Order:**
  1. cells refused on an earlier visit (the record's `cold` set, 24 h) go behind every untried cell. Otherwise refused
     platform cells could eat every visit's tries and starve the rest (Codex r4). A refusal for a body or an item never
     makes a cell cold.
  2. then the platform square (Chebyshev <= 6) first. This holds among untried cells only: a platform cell refused
     once waits behind untried cells elsewhere.
  3. then the HIGHEST eligible cell, so a column is topped out before the next is started. A 1-high gap under a roof
     can never be stood in, so filling a layer everywhere first strands the layer above it; the cavern test found this.
  4. then FAR FIRST: the walk distance of the nearest stand.
- **Bounded:** the planner yields after every candidate. A 32-step plan on the real towns (10-14 copies) took
  1.6-2.2 s, and its longest slice was 58-84 ms. Under a canopy covering the whole region the sky scans are heavy: the
  Claude r3 probe saw 451 ms, so the column above the region is now read raw, not memoised. The search allows 400
  tries per step.
- **A stand the pathfinder fails to reach is no stand for the rest of the visit (`badStands`).** The cell is skipped for
  the rest of the visit and made cold. A refusal for a body, an item, a push or an unreachable stand never holds the
  town.
- **Re-proved at the click (`stepRefusal`).** All of it is asked again on the world as it is at the click, with reads
  memoised: still open, floor solid, ref usable, nothing protected or hazardous by now, nobody in it, the stand
  standable and in reach with sight, no seal, and no way cut. A refusal replans, at most 2 replans per visit. A cheap
  local version runs before the walk to the stand.

### 2.3 The visit (`fill_town`, skills.mjs)
- **A deterministic town order, never the model's** (chatOnly, housekeeping). It runs at town only: within TOWN_RADIUS
  horizontally and within FLOOR_DEPTH + 6 of home's height. Never a trip.
- **One builder per town.** Lease generations are created exclusively (the plinth's protocol). The lease is renewed
  before every walk and checked again immediately before every click; it expires after 3 minutes and is released in
  `finally`. A stale holder places nothing more and writes no record, and a test covers the takeover.
- **Bounded:** at most 32 placements and 100 s per visit, one placement per 4 ticks. Each placement is read back from
  the world within 10 ticks. A drop is retried by a replan; a cell dropped twice is skipped for 24 h (`stuck`).
- **On foot only:** the town deposit's walk profile, with no digging, no towers and no scaffold.
- **Funding comes from the bag only.** Andesite, diorite and granite go first (the well's junk). Cobble is spent only
  while the bag keeps COBBLE_RESERVE = 64, so the exit contract's reserve is never spent. A visit needs 8 spendable
  blocks.
- **The record** is `<pool dir>/townfloor-<home>.json`, written only by the lease holder. It holds counters, `stuck`,
  `cold` and `noneAt`.
  - `noneAt`: a visit that found nothing the town can reach holds every bot's order for an hour.
  - The plan itself is not stored. The floor is a stock of holes, re-derived from the world on every visit.
- **The stagnation watchdog counts a verified placement as progress** (watchdog.mjs, `bot.worldWorkAt`).
  - On Paper, back-to-back visits looked stagnant to it: the bot was motionless and its bag was shrinking. It cancelled
    the skill and forced a relocation.
  - A block read back since the window's first busy sample now counts as progress, for at most one 180-s window.
  - Stranding is judged separately and is unaffected.
- **Rows:**
  - `_town_floor`, one per visit: stage, placed, planned, refused, dropped, spent, tier0, budget, left, ms and why.
  - `_town_floor_step`, one per block: at, block, stand, tier, L, home, plus the evidence the read re-judges. `col` is
    the cells below; `nb` is the non-terrain neighbours.

### 2.4 The order (`floorOrder`, cognitive.mjs)
- **Where it sits in the cascade:**
  - It comes after the town deposit, the recount, wear-out, the composter's orders, the junk well's orders, chest
    pruning and the room order.
  - It comes before planting and the model.
  - A milestone conversion that is ready always goes first; the real-loop test proves that the stone-pickaxe craft
    wins.
  - A structural test (comments stripped) asserts this order.
- **It fires only when all of these hold:**
  - the town-ground zone is in the build;
  - the bot is at town;
  - its budget is at least 8;
  - no other live lease exists;
  - the town is not held;
  - the bot is not inside a well.
- **Timing:** a 10-minute cooldown per bot. Outcome backoffs: nothing to do 1 h; a fault 30 min; a lost lease 10 min.
  A search that ran out of tries costs nothing extra; the cold rotation moves it on.
- Away from town it reads nothing (tested).
- **The admission gate's repeat guard** refuses a 5th identical action within the last 8 admitted. At the fleet's
  10-minute cooldown, with about 20 model decisions between visits, fill_town cannot reach that. The sandbox needed a
  60-s rhythm: at 15 s the guard refused the 5th visit, and the livelock breaker walked the bot off the arena.

### 2.5 Composition
- **The zone (townzone-01, queued after stocktarget/wellsite).** The floor's ORDER never fires without the zone in the
  build (`zoneLive`).
  - Without the zone, gather and the ore tunnel would dig the fill back out (cobblestone is a gather target), and the
    job would churn (Claude r1 P2-4).
  - The base branch `tf-on-5e66386` is therefore inert on its own. Its real-loop test asserts that no fill_town is
    issued, with a positive control that the skill itself works.
  - The canary build is `tf-x-tz`: townfloor merged onto tz-on-5e66386 @ 3b1ae8bb. There the zone protects every
    floor block in the box, and a test asserts `townTargetPermit` refuses each one.
- **plinth-01 (queued, not on this base).** The plinth record (`junkwell-plinth-<home>.json`, the plinth agent's
  format) is a keep-out in ANY state, because a foreign block in a plan cell voids the plinth plan:
  - every `plan.steps[].c`;
  - the cap's column from cap.y-1 to cap.y+2, and the cap's 7x7 from 4 below to 3 above;
  - `plan.stair`;
  - every `prev[]` column with its stair.
  - Both jobs spend bag surplus; the plinth runs ahead of the town deposit and the floor after everything, so a town
    that wants a plinth builds it first.
  - Merging later is mechanical: `floorKeepOut` already reads `junkwell-plinth-<home>.json`.
- **stocktarget (fleet):** unchanged. The floor spends only bag surplus above 64. The town's 256 cap and the
  "surplus refused to chests" rule are untouched. There is no chest withdrawal in v1.
- **The junk well:** stays the overflow. Its orders run before the floor's in the cascade, and the floor takes surplus
  at any bag size.
- **digtown (fleet):** the floor never digs, so the `_dig_town` counters are unaffected.

### 2.6 What v1 deliberately does not do
- **No digging, ever.** Sealed voids stay voids.
- **No edge (sneak) stands.** A centred eye cannot see the floor of a 2+-deep pit past its rim, so such a pit is filled
  only when a stand reaches into it.
- **No caps** over unfillable voids.
- **No chest withdrawal.**
- **Ladders and water columns are not in the walk model.** A route home that needs a ladder is not protected by
  `lostWay`; that is rare.

## 3. Design (B): a first simple build -- design only
- **Why not a path ring:** the drowning check (1.2) says it would not reduce drowning.
- **The proposal: a kerb.** A one-high wall of the floor's blocks on the box's boundary ring at L+1, with 2-wide gaps
  at the four cardinals: 128 ring cells - 8 = **120 blocks** per town.
  - It is a fixed target list outside `floorBox`, so it needs its own target list with the same keep-out, hazard,
    support, stand, seal and way rules.
  - Each kerb cell must rest on solid ground.
  - The cardinal gaps must stay walkable on both sides, which `lostWay` enforces for every existing route.
  - A 1-high wall can be stepped over, so it traps nobody.
  - It marks the town and is the blueprint builder's natural second consumer.
  - **Success criterion:** 120/120 cells read on the server in a canary town within 48 h, with no route lost
    (`lostWay` on the region copy before and after).
- Not built in this change. Both engines say build A first (their B notes: P3 arithmetic, fixed; the boundary rules
  above).

## 4. Tests, mutants, sandbox
### 4.1 Tests (`npm test` = `node scripts/run-tests.mjs`, from bots/)
- **`npm test`:** **255/255 files on `tf-x-tz` @ a2d6972f** (the canary) and **254/254 on `tf-on-5e66386` @ da99ec95**, the inert base branch. The townfloor files run 31-58 s each under load, inside the runner's 120-s limit; the two heavy replays live in their own files.
- **`test/townfloor.test.mjs` (39) + `townfloor-cavern.test.mjs` (1) + `townfloor-pits.test.mjs` (1), pure, by behaviour on synthetic towns.** Every planned step is REPLAYED, and at its
  turn the replay asserts:
  - the cell is inside the box, and `stepRefusal` (the click's own judge) passes;
  - the cell rests on a full cube, and the click is never on a bottom face;
  - the stand walks back after the click.
- **An INDEPENDENT oracle runs at the end of every replay.** It is written apart from townfloor.mjs and checks:
  - every stand that walked home before the plan still does, using a forward search per cell;
  - no new closed pocket of more than 8 cells exists, where "closed" means it never leaves a box topped at L+12;
  - no entity is sealed in.
- **Fixtures:**
  - a pit with a stair;
  - a cavern under the platform, which proves the highest-first order;
  - dead-end tunnels, which prove far-first;
  - a tunnel mouth (Codex r1's repro);
  - a mine tunnel leaving the region;
  - water, a sapling, farmland, furniture and keep-outs;
  - floating sand;
  - Codex r2's roofed pocket and r3's shaft roofed at L+11;
  - slabs; a bed route (strict versus permissive walking);
  - a chest and a sapling at the bottom of stair pits, filled to exhaustion;
  - cold rotation and Codex r4's three-visit starvation repro;
  - the platform first among untried cells;
  - a stand that never walked home (`walled_in`).
- **Property tests:** `walkBack(r,t).has(c)` iff `walkDist(r,c).has(t)` on 30 random rough towns, in both walk modes;
  `accessIndex` equals a brute-force search.
- **Funding, lease, record, order and outcome tables** are tested directly.
- **The zone composition** is tested directly: every corner of the box is `inTownBox`; every floor block is zone ground;
  with the zone in the build, `townTargetPermit` refuses each one.
- **The wiring order**, with comments stripped: the floor order comes after the town deposit, the recount, the
  composter's, the well's, pruning and the room order, and before planting.
- **`test/townfloor-skill.test.mjs` (18)** runs the REAL SKILLS table on a fake town whose server refuses what Paper
  refuses:
  - the visit chain: bounded at 32, decorations first, the reserve kept to the block, every block a target, one row per
    block, the hold;
  - a dropped placement leads to a replan, and two drops make the cell stuck;
  - a body, or a chest set down mid-visit;
  - the click re-proved after its pacing;
  - a lease taken over mid-visit; two builders racing; a well site recorded mid-visit;
  - the builder pushed off its stand;
  - a stand the pathfinder cannot reach (skipped for the visit, made cold);
  - refusals; an abort.
  - **In the REAL CognitiveLoop:** the order fires at town (zone build) or never (base build); a ready milestone craft
    goes first; nothing fires away from town or at the reserve; a floor that cannot progress backs off once and the
    model's work resumes.
- **`test/watchdog-busy.test.mjs` (+1):** a bot placing blocks is not stagnant. Positive control: a block placed before
  the window is no excuse.

### 4.2 Mutants (`scripts/mutants/mutants-townfloor.py`, every anchor asserted present exactly once)
- **74 mutants, every anchor present exactly once:**
  - **72 KILLED.** The full battery ran on an export of the canary's bot code (144038a2): 70 killed and 4 survived. Two
    of the survivors (strict transit through a cobweb; a plinth plan cell as a keep-out) exposed tests that did not
    isolate their rule. Those tests were fixed, and both mutants were killed on a re-run against a2d6972f.
  - **2 SURVIVE**, both in the bed-route corner of the strict/permissive split:
    - "the builder plans over beds": its reach is permissive, its way home strict;
    - "protected ways judged strictly": `backNow` is strict.
  - In every fixture built here, the other half of the pair masks the mutation. For the first, the strict way home
    rejects every stand that only a bed reaches. For the second, no bed-only way was plannable to cut.
  - The split is tested directly, at the function level: the bed and bed-trench tests run `walkDist`/`walkBack` in both
    modes. Killing these two through the planner is a follow-up; it needs a ledge reachable only over a bed, with a
    strict exit.
- **The mutants span the full design:**
  - the box and the zone; every protected-cell rule and the hazards;
  - full-cube supports; the sky (height, finite scan); pockets, items, unbounded space, cuts, walled_in;
  - the order: highest, far, tier, cold, the builder's preference;
  - funding and the reserve; the lease; the hold; the stuck and cold records; the order's gates;
  - the skill's re-proof, moved check, read-back, lease release and the plinth record;
  - the watchdog; the loop wiring; housekeeping.

### 4.3 Lint
eslint no-undef over townfloor.mjs, skills.mjs, cognitive.mjs, hygiene.mjs, watchdog.mjs, reflex.mjs and the two tests
finds exactly one hit: the pre-existing, typeof-guarded `reflex.mjs:2384 withinBody`, which is the positive control.

### 4.4 Paper sandbox (`sandbox/townfloor/floor-e2e.mjs`)

**Setup**
- Paper 1.21.8 on sandbox2 (10.0.0.30:25600). The arena is x/z 2370..2430 and y 96..140, forceloaded for the run and
  released afterwards.
- The sandbox lock on 10.0.0.31 was held as `townfloor` from 19:08Z to 00:05Z, then released. No fleet world was
  touched.
- **The bot is the real one:** `src/index.mjs` from the branch, unmodified. A loopback brain answers status or a goto
  beside home, so every placement comes from the bot's own `floorOrder` -> `fill_town`.
- **Final run:** the bot code at 187fe6a4, which is the canary's bot code. Commits after it changed only tests and the
  read.
- **The truth is RCON:** `execute if block` reads every open cell the fixture had in the box + 4, from the box bottom to
  L+2, for the five floor blocks.
- **The judge is independent of the rows:**
  - outside the plan: a placed cell that was not a target of the fixture;
  - a bridge: a placed cell with no full block under it at the end;
  - a cut way: a stand that walked to the floor anchor before and no longer does, recomputed on the fixture plus the
    server-read placements;
  - protected cells read back unchanged;
  - the reserve, from the rows' bag snapshots.
- **The reader has a positive control:** zero placements before the scene, and one RCON-set block is seen.

| Scene | Placed (server) | Rows | Outside | Bridges | Cut ways | Protected intact | Reserve breaches | Scene-specific | ok |
|---|---|---|---|---|---|---|---|---|---|
| town fill | 241 | 241 | 0 | 0 | 0 | 8/8 | 0 | 9 visits; the last one found nothing (none_feasible); 51 targets left, sealed or unreachable | **yes** |
| town + walker standing at the cavern's far end | 243 | 243 | 0 | 0 | 0 | 8/8 | 0 | the walker walked home on mineflayer-pathfinder (no digging) after 40+ placements | **yes** |
| town, SIGKILLed twice (at 22 and 76 placements) | 241 | 241 | 0 | 0 | 0 | 8/8 | 0 | 2 kills; 165 placed after the last restart (the dead self's lease expired) | **yes** |
| board-a's real town (10-14 region copy) | 211 | 205 | 0 | 1 * | 0 | -- | 0 | 9 visits; 6 refused, 0 dropped | no * |

\* **board-a, explained.** The 6 server blocks without a row, and the one "bridge", were placed by the base's entombment
reflex, not by fill_town.
- At 23:32:45Z, 12 s after a floor visit ended, the bot was walking to a chest for the base's `count_town` order. It was
  reported `_entombed` ("walled in at y=116") in the cavern under the platform.
- It pillared (the cobble without rows; the pillar block is the "bridge") and dug out through one platform brick
  (`_dig_town purpose=survival by=reflex:escape`).
- Every one of the 205 `_town_floor_step` cells is on the server, and none is outside the plan or a bridge.
- The entombment cell lies within 4 of a cell filled in that visit, so on the canary it is exactly what **F5** names.
  F5 needs two episodes to revert; this is one, named here. Whether the fill made the pocket is not established.
- The base rate is 18.9 entombment episodes per 100 bot-hours within 16 of home (1.2), so about 0.2 would be expected in
  a 1-hour scene.

**What Paper found that changed the code:**
1. The fleet's **stagnation watchdog** cancelled back-to-back visits and relocated the bot: it was motionless while its
   bag shrank. A verified placement now counts as progress.
2. On board-a the planner's first stand was **unreachable to the pathfinder**: the model's route went over beds. The
   result is strict walking for the builder, and a stand the pathfinder fails is excluded for the rest of the visit.
3. **The admission gate's repeat guard and the livelock breaker** in a 15-s order rhythm. This is a harness rhythm and
   cannot occur at the fleet's 10-minute cooldown.
4. A **single start cell** beside home was walled off by chests. The town is now an anchor set on the floor.

**Earlier runs:** run5 at cff62f7e, before strict walking, passed all three town scenes the same way (241/243/241,
171 placed after the last restart). Board-a at 4fbb86d9 placed 0 (finding 2).

**Pace:** one block per 0.5 s (median) to 1.2 s (p90) on the synthetic town. A 32-block visit took 19-27 s there and
35-86 s on board-a under a loaded host. The 100-s cap held: three board-a visits stopped on time.

## 5. Canary
- **Variant:** `tf-x-tz` @ a2d6972f. That is townfloor-01 (`tf-on-5e66386`) merged onto townzone-01's variant for the
  5e663860 fleet (`tz-on-5e66386` @ 3b1ae8bb). The only conflict was the import block.
  - The base branch alone is inert: the order needs the zone.
- **Prerequisite:** townzone-01 KEPT and PROMOTED from that variant, then at least 180 min for a one-build pre-window.
  Any other fleet tip needs a new variant.
- **Registration:** `docs/reports/townfloor-01.a2d6972f.json` (copy for `~/mcai-analysis/`).
  - Licence: `_town_floor` rows. The base never writes them.
  - Draw: any pool. Every town is dug out, and 79 of 80 bags hold surplus.
  - Exposure: a canary town with 50 or more blocks placed, in a window of at least 180 min.
  - Reads: `townfloorread` (md5 8cbc47d5) and `immobiledid`.
  - Change rows: `town_floor`, `town_floor_step`.
- **Defect gates (REVERT), each judged by the read's OWN classifier from the row's evidence:**
  - F1: a placement outside its row's box (the plan's box, re-derived);
  - F2: a bridge (the cell below, per `col=`, not solid);
  - F3: a protected cell (furniture within 1, over farmland, a sapling below);
  - F4: a cobble placement that left the bag under 64;
  - F5: two or more stuck episodes within 4 of a cell filled in the 30 min before. One is named, not a verdict;
  - F6: control `_town_floor` rows (a leak; blocks KEEP).
- **Positive controls:**
  - the read's self-tests on the bot's own row strings run every read;
  - the stuck-row selector must see rows anywhere. Dry run 10-14 18:10Z, hive-a +60: 125,450 rows walked, stuck rows
    canary 34 and control 780, licence 0 on the base (as it must be), F1-F6 all 0.
- **Primary (reported, not gated):**
  - blocks placed per canary town and tier;
  - cobble held per bot, DiD (expected to fall);
  - `_fall_path` inside the box per bot-hour, DiD (secondary; noisy at canary length);
  - visits and their stop reasons.
- **Harm:** unchanged. The two-death floor applies, and `gather_ratio` < 0.43 of control (canary-report.py) is the
  displacement check.
- **Teardown:** the usual three steps. Filled cells stay in the world, where they are stone where the bots had dug, and
  the zone protects them. The base never reads `townfloor-<home>.json` or its lease files.
- **Checks on the final file (10-15 00:42Z):** licence PASS (`_town_floor`: 0 baseline rows in 6 h; 360,080 rows, 80 bots) and change-row check PASS. Registration sha256 a3fe3315....
- **If wellsite-02 is kept and promoted first** (fleet -> 8cd0bc62), townzone-01 needs its own variant there; townfloor is then merged onto it (`git merge tf-on-5e66386`). The plinth record format on 8cd0bc62 (b4174a09) is already a keep-out.
- **Queue entry:** `docs/reports/townfloor-01.queue-entry.json`, after townzone-01. It is NOT queued: that is the
  operator's call.

## 6. Review record
Full record: `docs/reports/townfloor-01-reviews-2026-10-14.txt`. Codex ran with `codex exec ... < /dev/null` in the branch
checkout. Claude was a separate subagent, read-only, with a fresh pass every round.

| Round | sha | Codex | Claude |
|---|---|---|---|
| 1 | 7a59c3d5 (design + first build) | REJECT | APPROVE-WITH-CHANGES |
| 2 | 4f504e77 | REJECT (roofed pocket at L+1) | APPROVE-WITH-CHANGES |
| 3 | 424ce0cc / ca93296f | REJECT (shaft roofed at L+11) | APPROVE-WITH-CHANGES |
| 4 | 424ce0cc | APPROVE-WITH-CHANGES (cold starvation, scene verdicts) | -- |
| 5 | ca93296f | (no verdict produced) | -- |
| 6 | 4fbb86d9 (after the Paper board-a finding) | APPROVE-WITH-CHANGES (strict transit) | APPROVE-WITH-CHANGES |
| 7 | 85e7388b | APPROVE-WITH-CHANGES (P3 preference) | APPROVE-WITH-CHANGES (P1 anchor below the floor) |
| 8 | 187fe6a4 (canary bot code) | **APPROVE** | **APPROVE** |

**Findings that changed the design**, in order:
1. A tunnel mouth cut a player's way out. That led to `lostWay`, a hard refusal at plan and click time.
2. Gravity and liquid hazards; full-cube supports.
3. The search starved on its first 400 candidates, which led to `search_budget` and cold cells.
4. Connecting to air above L+1 counted as outside. That led to the sky rule, first with a finite scan, then up to the
   world top.
5. Slabs could be foundations or builder floors.
6. The final proof was made from the planned stand instead of where the builder actually stood.
7. The test oracle shared the planner's rules.
8. The harness could report false successes.
9. Cold ordering starved later tiers.
10. On Paper, board-a's builder routed over beds, which led to strict walking for the builder. The ways `lostWay`
    protects stay permissive.
11. A single anchor cell was walled off by chests, so the anchor became a set.
12. The anchor counted holes below the floor as the town, so it was restricted to cells on the floor.
13. On Paper, the stagnation watchdog counted building as being stuck.

**Accepted residuals:**
- Lease fencing is client-side.
- Ladders, doors and swimming are not in the walk model.
- Physics is handled by exclusions, not simulation.
- Reservations shared with plinth-01 are re-read for every click, not atomic.
- A parked entity makes the job re-plan every 10 minutes.
- A crater around home: no anchor, reported as `no_start` (a tripwire in the read; the fix is a follow-up).
