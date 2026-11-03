# towndress: lights and signs, docks and lighthouses, bee farms, a museum (2026-11-03)

**Owner, 11-03:** "towndress": four smaller world projects, designed together and shipped in order of value and effort.
They are:

1. lighting and town signs;
2. docks and lighthouses on lakes and coast;
3. bee farms;
4. a museum.

They should become sink-style projects that the picker offers idle bots. The first piece is lighting and signs on the
showcase. The owner's words: "design all using both claude and codex ... implement and deploy where you feel is right".

**Status:** the first piece is built as a showcase piece on branch `towndress-01show`, on the live showcase release
`showcase-gkpick-on-adbf9e41` (cbd2f51b). It is tier 2 and not released. The tripwire rule it needs is on main (this
commit). Ledger row: `towndress-1103`.

## 1. Measured (showcase, 10 bots, one town at 0,70,0, snowy taiga)

Window: 24 h to 11-03 20:49Z, 169,849 rows, 10 of 10 bots reporting.

### Materials

| What | Measured |
|---|---|
| Town chests (9 containers, town index replay) | cobblestone 953, spruce_log 364, copper_ingot 240, lapis 98, iron_ingot 97, **torch 71**, **coal 57**, cobbled_deepslate 47, glass_pane 36, stone_bricks 32 (17 distinct names) |
| Bags (10 bots, latest inventory row each) | cobblestone 4,445, spruce_planks 919, stone_bricks 488, spruce_log 227, iron_ingot 24, sticks 13, **torches 0**, coal 0–5 each |

- **Torch reserve and buffer:** reserve 32, mats buffer 64 (`mats_skip … torch:stocked`). There were 0 torch crafts in
  24 h (positive control: 45 crafts, 18 of them furnaces).
- **Torch users:** expedition kits (`kit=torch:6`) and the deep miner (`torch16`).

### Existing lights

| Record | Cells | Light cells |
|---|---|---|
| wall@1 (ring 82 × 60, 280 columns) | 936 | 1 |
| paths@1 | 503 | 0 |
| ziggurat@1 | 4,889 | 0 |
| storehouse | | 3 |
| copper hall (incomplete) | | 4 |
| house | | 1 |
| yard | | 8 |
| tree farm | | 9 |
| workshop | | 2 |

Torches placed live since 10-27: 24 of 7,584 `_build op=place` rows. Signs written live: 6 of 6 `store_sign` rows were
`written`. There were none in this window, because no label was due.

### The other three projects

- **Museum:** about 69 distinct item names have been seen in showcase bags since 10-27. The town chests hold 17.
- **Water:** today's log has 43 expedition starts and 4 crossings. They are at two rivers: z ≈ −88 north and
  z ≈ 214–220 south. 42 expedition markers stand.
- **Bees:** 0 bee or nest mentions in the showcase logs (taiga has no nests). Across the fleet (80 bots, 16 pools)
  today, bee *entities* were seen near home in 5 pools. In rows: board-b 1,901, placebo-d 491, hive-b 133, placebo-a 23,
  hive-a 3. There were 0 `bee_nest`, `beehive` or `honeycomb` rows (positive control: `oak_log` appears in 1.23 M of
  1.72 M rows).

### The picker is starved

Since the sink release (18:38Z, 2.3 h):

- 131 `_sink op=pick` rows wanted road, tower or shrine, and **0 instances were sited**.
- The 87 build visits went elsewhere:
  - the stair, 57 visits (41 of them `complete` repairs that dug 1 block each);
  - the tidy, 23;
  - the waiting copper hall, 7 (`replanned`).

  Each of these finite projects always had a free slot for the bot, and `activeProject` serves such a project before
  any sink.

## 2. The four projects: feasibility, value, order

| # | Project | Peaceful + mineflayer | Must be proven in Paper | Value / effort | Order |
|---|---|---|---|---|---|
| 1 | **Lights and signs** | Yes. Torches on top or side faces have been placed live (24 rows; `buildrun.mjs` reads a wall_torch as a torch). Wall signs are proven: Paper 11-01 `sandbox/sortstore/sign-proof.cjs` (place, `open_sign_entity`, `updateSign`, server read-back) and 6 of 6 live | Nothing new for torches and wall signs. A **lantern** needs its recipe, the iron nugget, and placement on top and hanging (deferred) | High value, low effort, and the machinery exists | **First** (built) |
| 2 | **Docks and lighthouses** | Yes. Expeditions swim bounded crossings (expwater-01) | Placing from a shore or a deck over water; waterlogged blocks; a pier's support from the bank; ice in winter; a safe way back to shore. **Boats** are a separate capability (boarding and dismounting are unproven) | Medium-high value, medium effort | Second. Site at the recorded crossings (the two rivers) |
| 3 | **Museum** | Yes. Chests and signs are proven. Item frames are entities (unproven) | An exact-count deposit of one item; a museum chest excluded from withdraw and sort; for frames, entity placement, item insertion, persistence and recovery | High long-term value as a collecting goal. Medium effort for chests, high for frames | Third. Signed chests first |
| 4 | **Bee farms** | Bees exist in Peaceful and in 5 fleet pools. No nests on the showcase (taiga) | Silk Touch (no enchanting today) or relocating a hive; campfire smoke under a nest; shears interaction and the honeycomb drop; flowers; breeding; candles (string) | Low value now, high effort, and it depends on finding a nest | **Last.** Fleet pools with bees only, after an expedition finds a nest |

Codex ranked them the same: lighting/signs, then docks/lighthouses, then museum, then bees. Its notes:

- Smoke supports harvesting but does not replace Silk Touch for moving a nest.
- The museum collects names actually obtained in this world, not the registry.
- A museum container must be excluded from ordinary withdrawals and sorting.

## 3. The first piece: the `dress` sink (built)

### The model

A fourth town sink is added: plot `dress`, blueprint `dress@1`, instance letter `L`. The code is in
`bots/src/towndress.mjs` (pure) and plugs into `sinks.mjs`. Each instance is a **batch** of at most 8 fixtures, of
which at most 2 are signposts.

| Fixture | Cells | Where |
|---|---|---|
| **signpost** | A 2-high post (stone_bricks, else cobblestone). A torch on top when a stand's eye clears the top face, else hung on the post's upper side: along the path either way, or on its back. The first that `stepFor` reaches wins. A **wall sign** on the post's upper face toward the path, at head height over the path column (a wall sign has no collision box) | Beside the path column nearest a **finished, named** building's door (its palette `*_door`), else its nearest cell, within 12 |
| **lamp** | A 1-high post and a torch on top | Beside a laid path |
| **walltop** | A torch on a wall column's top (role `wall`): a crenel, placed from the wall walk | The town wall |

The signs read, for example, `STOREHOUSE / built by Juno / Nov 1`. The parts are the name, the bot that sited the
building (pool prefix dropped) and the UTC day it stood. A field the record does not have is left out.

The names are:

| Plot | Name |
|---|---|
| storehouse | STOREHOUSE |
| shop | WORKSHOP |
| house1 | HOUSE |
| hall | COPPER HALL |
| monument | ZIGGURAT |
| yard | STOCK YARD |
| treefarm | TREE FARM |
| shaft | MINE STAIR |
| tower | WATCHTOWER |
| shrine | SHRINE |

### Siting (`siteDress`)

**Candidates:** signposts (one per finished named building not yet signed), lamps beside every path column, and wall
tops.

A post never stands:

- on a path column;
- on any record's cell column at any y;
- within 2 of a door;
- in a record's clear or cut list;
- on a plan cell or stand, or in a soft keepout or path segment;
- in a land-plan corridor (the groundskeeper grades them);
- on an expedition marker, in a protected zone, within 3 of a well or within 2 of the farm;
- with water or a waterlogged block within one column.

A post's ground must be within 1 of the path beside it.

**The batch:**

- Signposts come first. Then lamps and wall tops alternate, each list nearest home first.
- Every light is at least **8** (Chebyshev, x/z) from every light already in the world. The world scan covers
  torches, lanterns, glowstone, campfires, froglights and so on. The batch also keeps 8 from lights planned in any
  record (role `light` or a light palette) and from its own lights. A signpost may stand 3 from another light, so a
  door's own torch does not keep a name off.
- A batch has no more fixtures than there are spare torches.
- **The proof:** each fixture's cells are proven from one town walk (`buildsite.mjs stepFor`, a stand outside the
  post's own column, each placed cell a support for the next). The sign writer's stand must be a walk node.

**Zones:** each fixture's column ±1 (a wall top: its own column). Never the batch's box, which spans the town. The
sapling guard reads the fixture columns.

### The gate

The gate is **torches, not stone**. `dressPressure` counts the town's torches above the reserve (32), when the town
index has been read, plus the bag's. A batch needs 4. It goes through `sinkNextGate` like the stone sinks (open
instance, maxOpen 2, instancesMax 12, the no-site wait). `SINK_ROTATION` puts `dress` first, because it spends
torches, never the stone the other sinks wait on.

### The visit (`buildSink`, kind `dress`)

1. **The signs first.** At most 2 spots whose post stands and whose sign is missing or wrong (`sortstore.mjs
   spotNeed`), each under `SIGN_TRIES`. The storehouse's label writer does them:
   - `sortGetSigns`: the bag's sign, or three crafted from its planks;
   - `sortLabelOne`: place on the post face, the editor packet, `updateSign`, the text read back. Its rows are
     `_town_sign`.

   Each placed sign is logged `_build op=place project=dress kind=sign` on its record cell. This runs before the slot
   and the bag accounting, so `_build_bag` never sees the sign crafting.
2. **The posts and lights.** The ordinary sink visit builds them (`runVisit`, 3 slots, one segment per fixture). Sign
   cells are `alsoDone` for the runner and billed nothing.
3. **An unwritten sign is upkeep.** `recordDamaged` skips sign cells. A signs-due record is `due`, never a repair.

**Rollback:** `SINK_KINDS=road,tower,shrine` drops the dress sink, and `SINKS=off` drops every sink. Sited fixtures
stay guarded, because `projectsGuarded` keeps every sink plot.

### The sink turn (`shop.mjs activeProject`)

After `SINK_TURN_AFTER` (3) finite visits in a row (`bot.finiteStreak`), a bot's next pick is the sink, when one is
offered. The order is:

1. repairs;
2. the sink turn;
3. the free finite project;
4. the rest, unchanged.

This fixes the starvation measured above. **It also lets the picker-01 stone sinks run for the first time live** (road,
tower, shrine: released 18:38Z, never sited).

### Offline on the showcase

Source: the world copy and pool state from 11-03 15:36Z, run with `bots/scripts/dress-offline.mjs`.

**Result:** 4 batches and 32 fixtures (62 cells), each siting about 150 ms.

| Batch | Fixtures | Signed |
|---|---|---|
| L1 | 2 signposts, 3 lamps, 3 wall tops | storehouse, mine stair |
| L2 | the same mix | workshop, ziggurat |
| L3 | the same mix | tree farm, house |
| L4 | 1 signpost, 2 lamps, 5 wall tops | stock yard |

- **Candidates at the start:** 7 signposts, 211 lamps, 141 wall tops.
- **Lights already lit in range:** 48.
- **Torches:** 32 in all, against 39 spare today. The mats buffer refills 24 per batch from charcoal.
- A fifth batch finds no spot 8 from every light. The town is lit at that spacing.

## 4. Codex's independent design, and the reconciliation

Codex was given the goal and the measurements, not this design.

| Point | Claude | Codex | Built |
|---|---|---|---|
| Model | A fourth sink kind in `sinks.mjs` | A `towndress.mjs` planner and a `dress@1` growing record, sink-style with its own demand gate | Both: pure `towndress.mjs`, wired as sink kind `dress` |
| Batch | Up to 8 fixtures | "One open batch, capped at eight lights and two signs" | 8 fixtures, 2 signposts |
| Gate | Torches | Its own demand gate, never the stone pressure; fund the actual bill | Torch gate. The stone funding is skipped for dress |
| Anchors | Wall tops, paths, building doors; ziggurat corners later | Paths, wall, buildings; ziggurat terraces later (the ziggurat's tidy knows only its own record); defer the incomplete hall | The same. No ziggurat lights, and only finished buildings |
| Zones | Per fixture | "Small local protection zones, never a town-spanning box" | Per fixture |
| Signs | Off-record at first | Every physical placement, the custom sign too, must be an acknowledged `_build op=place` judged by the tripwire; a blank sign cannot finish the batch | **Codex's rule:** sign cells are record cells and their placement is a `_build op=place` row. *Difference:* an unwritten sign is upkeep after the posts stand, not a block on completion. A sign that cannot be written would otherwise hold the batch open and starve the next one |
| Supply | Raise the torch buffer if needed | Keep the 64 buffer and charcoal from surplus logs; never coal runs | Codex's: no buffer change. The batch is capped at the spare torches |
| Picker | Flag it to the picker's owner | **A release prerequisite:** bounded service after 3 finite visits; fix the stale shaft repair; instrument the final selection | The sink turn is built. The stair's repeated 1-block repair and a final-selection row are left to their owners (§7) |
| Lanterns | Later | Later, gated by proven recipes and iron above reserve | Later |
| Read | 2 h | 30 min, 2 h and 24 h; acceptance needs a finished batch with readable names surviving the tidy and a restart; zero visits is a scheduling failure | Adopted (§6) |

## 5. Facts the design rests on

- **Wall signs:** `oak_wall_sign`, `spruce_wall_sign` and the rest have boundingBox `empty` (minecraft-data 1.21.4 to
  1.21.11). `torch` and `wall_torch` are empty too. The walk (`buildsite.mjs isPassable`) and mineflayer-pathfinder
  (`boundingBox === 'empty'` is safe) pass through them, so a sign at head height over a path does not block it.
- **Sign writing:** Paper 11-01 `sandbox/sortstore/sign-proof.cjs`. An update with no editor open is refused, so the
  writer waits for `open_sign_entity` at the cell.
- **Torches:** placed live on top faces (yard, tree farm) and on side faces (wall gate posts), 24 placements.
  `buildrun.mjs` reads a `wall_torch` as done for a torch cell.
- **A 2-high post's top is not reachable from the ground:** a ground eye is at feet + 1.62 and the top face is at
  feet + 2. The fake world's proof found this, so a signpost's torch goes on the post's side when no raised stand sees
  the top.
- **Still to see live:** a sign placed on a post face over a path, read back; the torch on a post side. The mechanism
  is the same as the proven storehouse labels (a full block's side face). No new Paper proof is needed. The 2-h read
  checks every `_town_sign` row.

## 6. The tripwire, the read

**Tripwire (tooling, main, this commit):** `shopread.py` `SINK_PLOTS` gains `dress`. A dress placement, the sign
included, is judged against the generations of the dress chain in force when it was written (`sink_place_ok`).

The new selftest fixtures cover:

- a post and its torch;
- a sign on its record cell;
- a sign and a torch off the record (each trips);
- a wall-top torch of an instance sited after the row (trips), and the same torch after its siting (passes).

The selftest passes. The mutants are 79 of 79 killed, one of them new: `SINK_PLOTS` without `dress`.

**Read after release:**

- **+30 min:**
  - at least 1 `_sink op=sited kind=dress`, or else the `_sink op=pick` and `build_visit` rows that explain why (0
    visits is a scheduling failure);
  - H1–H8 at 0.
- **+2 h:**
  - `_build_visit project=dress`: placed per placing visit, with the denominator stated;
  - `_town_sign`: written out of tried;
  - the `_dress op=signs` rows;
  - every sited building named;
  - town torches never below 32;
  - no new deaths;
  - stone-sink rows (road, tower, shrine), now that the turn lets them run.
- **+24 h:**
  - lights and signs still standing after a tidy pass and a restart (the record's damage test, plus a look);
  - repair churn on dress records.

## 7. Queue placement and what is left

**The showcase lane.** The current order is:

1. the copper hall's finish and signs;
2. showcase 10;
3. 15 bots;
4. a second brain past 15.

The storage hub (storehub) is proposed after the 15-bot step.

- **Claude:** fold `towndress-01show` into the next showcase restack, beside the copper hall's finish. It is
  independent of the hall, and the hall's own sign comes free once the hall stands (COPPER HALL is in the names). The
  sink turn should go **with** it or before it. Without the turn, no sink (dress or stone) is ever sited on the
  showcase.
- **Codex:** lighting and signs first, with picker service a release prerequisite.
- **Agreed:** the next showcase fold, the sink turn included.

**The fleet lane.** After the showcase read, the change goes owner-direct (tier 2) with `SINKS_POOLS` widened. The
sinks are showcase-only today, so it waits for picker-01's own fleet step.

**Left to their owners:**

- **The stair's repair loop:** 41 `complete` visits digging 1 block each in 2.3 h. It is a stale or recurring damage
  test in `shaftgeom.mjs stairDamaged`.
- **A final-selection row:** the plot `activeProject` chose and why (Codex).

**Next pieces:**

- **docks-01:** a pier and a torch-lit lookout at a recorded crossing, from the shore, never a bridge. The Paper proof
  comes first.
- **museum-01:** signed display chests, one specimen per obtained name, excluded from withdraw and sort.
- **bees-01:** fleet pools with nests only, after an expedition finds one.
- **Lanterns:** a palette option for lights once the recipe and placement are proven and iron is above reserve.
