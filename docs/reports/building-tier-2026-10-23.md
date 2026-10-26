# The building tier: count what is built, make the materials, build from plans (design only, 2026-10-23, r7.1: r7 approved by both engines; P3 polish applied after)

OWNER 2026-10-23 ~12:40Z approved the building tier. The goal it serves is the owner's: "build cool structures, survive,
and work together for long periods of time", in peaceful worlds.

OWNER ANSWERS 2026-10-23 ~13:30Z (relayed by the coordinator). These are decisions, and this design is built to them:
- **B1 order:** one shared building per town first (a workshop/storehouse on its plot); then a house per bot; then walls and
  lit paths. Earlier owner decision 6 (10-21) still stands: a real storehouse building only in hive-a/b.
- **B2 palette:** a small set per town: stone bricks, planks, glass, and copper for trim.
- **B3 budget:** building spends only the surplus above each town's reserve, never iron, coal or the tool kit. The reserve is a
  setting ("yes for now").
- **B4 clearing:** trees and small hills may be cleared inside the plan's plots only, never in protected zones or village
  areas, and the trees are replanted elsewhere.
- **B5 the count:** "a building" is enclosed, has a roof, a door and a light inside. Anything less is "a structure". Both are
  counted.
- **B6 showcase:** runs the same code as the fleet and is built first, so the timelapse shows what the fleet does.
- **Cooperation (branch cooperation-1023):** the first multi-bot project is 2-3 bots building their town's workshop together.
  This design exposes the interfaces it needs: a blueprint, and a claimable sub-task unit.

Where an answer meets measured evidence or an earlier decision it does not fit, §8 says so. Nothing is silently picked.

**Sibling designs, reconciled at their current heads** (coordinator 10-23): `mineshaft-safety-1023` r10, APPROVED (8bffc295),
and `cooperation-1023` r8 (ad1aa9ef). §5 answers cooperation's asks A1-A9 and its open items for shop-01; §5a composes with the
mineshaft fixes (the deep stair's envelope, the `tombexit` predicate, rung 0, seal-block claims) and §6.1 the shared canary
lane.

This is design only:
- No bot code was written. No queue entry, deploy, world edit or bot change was made.
- RCON was not used.
- Every world read was of COPIES of region files, made with `cp` (the live files were only read), on 10.0.0.30 (the 16 bench
  worlds) and 10.0.0.40 (the showcase).
- Rows came from Elasticsearch through `scripts/lib/estelemetry.py`, and the chest census from
  `~/chestclear3/census-goal-20261023T0015Z.json` (10.0.0.30, read-only).
- **The live canary.** indexsearch-01 was deployed at 12:17Z on board-a and placebo-a. Its reads belong to the host loop. Nothing
  here reads it or touches it. The board-a region copy includes the canary pool's town, as every world does.

Tools are in `docs/reports/building-tier-2026-10-23/tools/` (`.py.txt`), outputs in `data/`. Reviews are in
`docs/reports/building-tier-reviews-2026-10-23.txt` and summarised in §11.

---

## 0. Answers first

**1. Today the fleet builds nothing that is a building, but it places a great deal.** The structure count (§2) reads the
worlds, not the rows:
- 408,788 cells of the OBSERVABLE placed palette persist within 96 blocks of the 16 homes (an estimate of what bots placed:
  §2.2 says what it can and cannot attribute). 93.5% are cobblestone.
- They group into 6,282 structures of 12 or more cells: 1,534 at the surface, 4,748 buried. 178,222 cells are "litter" in
  smaller groups.
- There are **0 buildings (B5).** One unlit room was found, which B5 classifies as a structure.
- In the 74 h from 10-20 12:12Z to 10-23 ~14:30Z, within 48 of home: +31,057 cells and -7,274 cells, about +7,700 net a
  day. 96.6% of the added cells are cobblestone: pathfinder scaffold, mine stairs and backfill.
- The rows agree that no build happens: 0 `build` rows in 24 h, with `place` (336 rows) and 1.54 M documents as the positive
  control.
- **Correction to the brief:** of the 305 successful `place` actions, 274 placed saplings, 23 crafting tables, 7 dirt and 1
  granite. Torches: 0 successes (4 failures). Wells are not built through `place` at all.

**2. The instrument passes its controls** (rerun 10-23 ~15:35-16:05Z after review rounds 1-3).

| control | what | result |
|---|---|---|
| positive | the operator's town stamp (place-town.py: 207 cells per town) | 2,940 of 3,312 found (88.8%), detected and masked. The rest were dug by bots since |
| positive | plinth wells: the one `complete` record per world that has place steps (10 worlds; `tools/pickplinth.py.txt`) | 588 of 650 planned cells hold a plinth block the palette can see (cobblestone or cobbled deepslate: 90.5%), each well as ONE component. All 62 others hold andesite, diorite or granite, which the plinth may place (`PLINTH_BLOCKS`) and the palette cannot see (§2.7); 0 hold anything else. 0 of 10 is a room. The one record still in state `plan` (placebo-b, 16 cells, never built) finds 0 |
| positive | synthetic fixtures with a known answer (`structcount.py selftest`, which exits nonzero on any failure) | **17 of 17**: one lit house = 1 building; two houses joined by cobble = 2; a house joined to a buried mine stair = 1; an unlit lamp only = 0 (1 unlit room); an unlit redstone torch only = 0; a lit lamp = 1; a light below the floor only = 0; a torch just outside the doorway only = 0; a "roof" of torches = 0 rooms; no doorway, no roof, no walls = 0; and the plinth check's own five (correct = pass; wrong block, disconnected cells = FAIL; never built = pass; empty plan = no_cells). **8 anchored mutants** (`tools/mutants.py.txt`, which also exits nonzero if any survives, crashes or loses its case line) each fail their case |
| positive | three showcase villages, each scored against its own piece list: the taiga village east of home (on which the mask padding was tuned), and two HELD-OUT ones, a second taiga and a snowy | first: of 8 house pieces 6 have a room, 5 are B5 buildings. Held-out taiga: 13 houses, 7 rooms, 7 B5. Held-out snowy: 18 houses (3 farm pieces excluded), 8 rooms, 8 B5; most misses are snow-block and packed-ice houses, outside the BUILT palette by design. In all: 21 of 39 houses have a room, 20 are B5 buildings, and **0 rooms in 364 non-house pieces**. The test is conservative: it misses houses, never invents them |
| negative | the two held-out villages scanned as towns (`scan` over each village's box, no bot ever there) | **0 BUILT cells** in both (2,097 and 3,296 palette cells, every one inside a padded piece), 0 dirt paths outside pieces: the padding holds out of sample |
| negative | the showcase world: no bot has ever joined (`usercache` holds only the owner's spectator; 0 player files) | 0 built cells in a 385 x 385 box. All 20,627 palette cells there are inside 995 generated pieces or 19 dungeons. 0 structures, 0 rooms, 0 dirt paths |
| negative | FULLY GENERATED (`Status` full) chunks no player ever ticked (InhabitedTime 0): 120 per bench world and 150 on the showcase | 0 surface false positives in 2,070 chunks; 1,311 buried ones (mineshaft wood and dungeon fringe; 5 of their starts lie in regions not copied). So buried structures are reported, never scored, and a surface count is the claim. This control cannot see fluid-made cobble (those chunks never ticked): §2.6 bounds it separately |
| negative | how much of each town the masks cover (`tools/maskarea.py.txt`, Chebyshev ≤ 44) | **0 mask columns reach within 8 of the surface in any of the 16 bench towns** (the masks there are mineshafts and trial chambers, underground: 0-54% of columns, all deep); showcase 0.8% (its village's edge). So the masks cannot hide a bench building |

**3. Materials (§3).** Town stock (10-23 00:15Z census, 341 containers):
- cobblestone 15,594 (plus 1,467 cobbled deepslate). Every town is at its cobble cap of about 1,000.
- logs 16,679; copper ingots 12,019 (plus 4,200 raw); coal 3,693; iron ingots 1,877.
- **0 sand, 0 glass, 0 stone bricks, 0 bricks, 0 clay.**

The reasons are code, not geography:
- sand's stock target is **0** (stocktarget.mjs), so it is never banked;
- glass and glass_pane are on the **junk-well list** (well.mjs DECORATIONS);
- nothing makes stone bricks.

Sand is gathered: 574 sand a day in 248 successful gathers. The 2,585 "beside water or under falling blocks" refusals are the
gather safety rule working, so it is not loosened. Glass demand is small, because 6 glass make 16 panes.

So materials need:
- two settings: sand banked, and glass off the junk list;
- one deterministic job, `make_material`. It runs at a qualifying town furnace (the workshop's once it exists), makes only
  what an admitted blueprint still needs (or a small buffer), and spends only what is above the reserve.

Funding today (PROVISIONAL: an executable allocation over a census of town storage, every draw integral and within 80% of its
pool, species kept, intermediates first; 13 shared towns): the workshop allocates in 10 of 13 (8 with copper trim; hive-b,
hive-d and placebo-d are plank-short at a 512 log reserve), and 26 of the 65 houses one at a time after it, before any refill.
Sites (the composed P0 SCREEN, §4.3): 5 of the 13 have a workshop candidate; 3 are both funded and screened (board-d,
isolated-b, placebo-a). The greedy screen found five house plots within straight-line 40 in no town, and within 60 in 4 of the
5 (owner Q10). The draw itself is qualified at draw time from the bots' own index, not from these numbers (§6.2).

**4. Structures (§4).** One generic, fenced placement builder: builder.mjs, built and Paper-proven 10-15 and never shipped.
Blueprints are JSON, built from the world (progress is what the world shows), split into claimable SEGMENTS. In B1 order:
- **workshop@1** is the shared building: 7x5 shell, stone-brick pad and step ring, plank walls, glass-pane windows, plank roof
  with a cut-copper trim ring, two torches, a table and two furnaces inside, and an open doorway.
  - A 9x7 pad is geometrically possible inside the 16 circle in 4 of 16 bench towns, at Chebyshev 17-30 in 13, and in the
    outer domain (Chebyshev 22-44 and straight-line ≤ 43, 44 with its stand ring) in 16 (§4.3). Those are candidates; the composed site gate runs on real plans.
  - It takes the pavilion's place as the first roofed build.
  - The showcase's shared building is the town plan's greenfield storehouse shell around its founding chests (B6).
  - hive-a/b's real storehouse comes after (§8 C1).
- **house@1**, one per bot: 5x5 shell, plank walls on a stone-brick base, panes, a copper door placed last from outside, a
  torch.
- **wall@1** segments with gaps every 12 cells, and **paths-01** (the town plan's) with torches.

**5. Order and tiers (§6).**

| step | piece | tier |
|---|---|---|
| 0 | `structcount` | host cron, no canary; the baseline starts now |
| 1 | `matset-01` | tier 1 settings |
| 2 | `mats-01` | tier 3 (r2: it carries allocation, furnace policy and recovery) |
| 3 | `shop-01` | tier 3 |
| 4 | `house-01` | tier 3 |
| 5 | `paths-01` | tier 3 |
| 6 | `wall-01` | tier 3 |
| 7 | `storehouse-01b`, hive-a/b only | tier 3 |

- shop-01 carries structureguard-01 and builder.mjs. monument-01, which was meant to carry them, is still HELD.
- The effect of every piece is read on the structure count: buildings, structure cells and blueprint conformance per canary
  town. No-harm is read as DiD on gather, rung, bag and death rates.

**6. What the owner has to decide (§10):**
- the door (a door block traps or gets dug, because the bots' pathfinder cannot open doors);
- hive-a/b's storehouse versus B1's single first building;
- charcoal for the torches that lit paths need;
- B6: "same code as the fleet" and "built first" cannot both hold; which one gives (§8 C4);
- 2 builders in shop-01, so the workshop is the cooperation design's first multi-bot project;
- the reserve's numbers;
- the wall's gaps;
- where the houses go: the screen packed five within straight-line 40 in no town, within 60 in most (Q10);
- the order of building and mineshaft-safety pieces in the one canary lane (Q11).

---

## 1. What was measured (denominators first)

### 1.1 Rows, 24 h to 10-23 14:00Z (ES; 1,540,540 skill documents, 80 bots, one rotation crossed)

| kind | rows | success | note |
|---|---:|---:|---|
| `build` | **0** | 0 | the brain's single-bot verb (skills.mjs `build`, `BLUEPRINTS`): never chosen |
| `place` | 336 | 305 | oak_sapling 269, birch_sapling 5, crafting_table 23, dirt 7, granite 1. torch 0 of 4. 20 crafting tables failed "placing exceeded 3000ms" |
| `gather` (all) | 28,223 | 12,725 | the positive control for the sand rows below |
| `gather` (sand) | 4,312 | 248 | 574 sand collected. 2,585 `no_safe_target` "beside water or under falling blocks", 713 "buried", 250 "could not stand within reach", 304 "no sand within N". 78 of 80 bots tried. The sand comes from the scout chain's `gather sand 8` rung (milestones.mjs) |
| `deposit` / `town_deposit` | 505 / 205 | 198 / 146 | |
| `_monument`, `_found`, `tend_farm`, `build_plinth` | 0 | | positive control for the kind names: `_protect_zone` 24,316; `_plinth_mode` 598 |

Tools: `tools/es_buildrows.py.txt`, `es_place.py.txt`, `es_gather_sand.py.txt`. Outputs: `data/bt-m1..m3.out`.

### 1.2 Stock: town chests (census 10-23 00:15Z) and bags (newest snapshot per bot, ES)

Per town, in `data/census-materials-20261023.txt`:

| | cobble | logs | planks | copper ingot | raw copper | iron ingot | coal | sand / glass / stone bricks | torches |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| chests, 16 towns | 17,061 | 16,679 | 1,142 | 12,019 | 4,200 | 1,877 | 3,693 | 0 / 0 / 0 | 960 (64 per town, the stamp's torch chest) |
| per-town range | 999-1,273 | 67-2,772 | 3-131 | 23-1,781 | 0-1,354 | 51-205 | 72-441 | 0 | 0-64 |
| bags, 80 bots | 12,719 (79 bots) | 5,173 (78) | 130 | 0 | | 183 | 46 | 190 sand (17 bots), 68 glass (4), 22 stone bricks (15) | 686 (71) |

- The census reads every item kind in the 341 containers. The same read finds 1,429 lapis and 640 oak saplings, so its zeros
  are real zeros.
- **Cobble sits at the cap** (cobblecap 1,000 per town). The surplus goes to the junk well (cobblekeep-01). Building is the
  sink the owner asked for on 10-14.
- **Logs are uneven:** hive-d 67, hive-b 252, against board-a 2,772.
- **Copper ingots are uneven:** the isolated worlds hold raw copper, not ingots (isolated-a, c and d: 23-64 ingots).

### 1.3 The world (structure count, §2), 10-23 ~14:30Z copies, home ±96

| world | built cells (core ≤16 / town ≤44 / out ≤96) | litter cells | structures surface / buried | rooms (B5 buildings) | stamp cells present (of 207) | plinth: planned / found / in one component |
|---|---|---:|---|---|---:|---|
| board-a | 31,438 (3,357 / 12,799 / 15,282) | 13,279 | 119 / 372 | 0 (0) | 186 | 62 / 46 / 46 |
| board-b | 21,865 | 9,961 | 93 / 274 | 1 unlit (0) | 181 | 70 / 70 / 70 |
| board-c | 29,959 | 12,495 | 154 / 326 | 0 | 194 | 60 / 44 / 44 |
| board-d | 24,901 | 10,431 | 139 / 283 | 0 | 185 | 60 / 60 / 60 |
| hive-a | 25,138 | 10,608 | 66 / 314 | 0 | 191 | (natural well) |
| hive-b | 15,759 | 7,668 | 31 / 203 | 0 | 199 | (natural well) |
| hive-c | 25,253 | 11,716 | 77 / 347 | 0 | 187 | (natural well) |
| hive-d | 8,110 | 5,424 | 23 / 73 | 0 | 172 | 66 / 65 / 65 |
| isolated-a..d | 32,183-37,343 each | ~13,000 each | 113-129 / 343-395 | 0 | 181-183 | 63/56, 59/53, 64/64, 66/66 (per-bot records: the first `complete` one) |
| placebo-a | 26,248 | 11,804 | 46 / 393 | 0 | 170 | (natural well) |
| placebo-b | 16,110 | 9,348 | 86 / 166 | 0 | 183 | 16 / 0 (unbuilt: state `plan`) |
| placebo-c | 24,069 | 10,734 | 117 / 260 | 0 | 173 | 80 / 64 / 64 |
| placebo-d | 23,924 | 11,609 | 97 / 282 | 0 | 189 | (natural well) |

- Every chunk read: 169-188 per world, 0 unreadable; 0 unresolved structure starts in any scan box.
- The table is the r1 run (14:30Z). The r2 rerun (~15:15Z, after the review fixes) moved each world's totals by under 0.2%
  (live worlds) and found the same single unlit room; `data/structcount-summary-20261023.txt` is the r2 run.
- The full table is `data/structcount-summary-20261023.txt`, and per world `data/scan/<world>.{scan,neg,delta}.out`.
- The largest surface structures are walkways and pillars: 848 cobble across 144 x 76 blocks in isolated-a, and a 75-cell flat
  line at y 82 in board-a. They are pathfinder bridges, not buildings.

---

## 2. The structure count (the measuring instrument; first)

### 2.1 Source and cadence

- **What it reads.** Region files only, read from a copy. In production it reads the nightly backup's staging copy
  (`/srv/world-backup/staging/<world>`, refreshed at 03:15Z by `~/bin/world-backup.sh` on 10.0.0.30). That is the most
  consistent copy available: a two-pass rsync whose residual skew is measured. It never reads the live world.
- **No RCON.** The census tools' `execute if block` is not needed. Chunk NBT already carries the block palette, structure
  starts and InhabitedTime.
- **Cost.** About 1.8 s per world at ±96 (pure Python, zlib and struct), 95 s for all 16 worlds with copies and negative
  controls.
- **Showcase.** Same tool on its own copy at 10.0.0.40 (`/srv/showcase/server/world/region`), after its 04:15Z backup.

### 2.2 BUILT: the observable placed palette, and what it can attribute

A cell is BUILT when all three hold:
1. **Its block is in the placed-only palette** (`BUILT` in `tools/structcount.py.txt`): cobblestone and cobbled deepslate
   with their slabs, stairs and walls; stone bricks; smooth stone; bricks; polished stones; planks and wooden
   slabs/stairs/fences/doors/trapdoors/signs; glass and panes; copper blocks, cut copper and copper doors (every
   oxidation); torches and lanterns; chests, barrels, tables, furnaces, composter, lectern, ladders, beds, wool, coloured
   carpets.
   - **Deliberately not in it:** logs, leaves, natural stone (andesite, diorite, granite, tuff, stone, deepslate), dirt,
     sand, gravel, mossy cobblestone (forest rocks), terracotta (badlands), moss carpet (lush caves), crops and saplings.
2. **It is not world generation.**
   - Every structure piece is found through each chunk's `structures.References` -> start chunk -> `Children[].BB`. Each BB is
     padded by 2 horizontally and 8 vertically, because terrain-matching village streets place blocks at the surface,
     outside their nominal y.
   - Each dungeon is found by its `spawner` and masked ±5. Dungeons are features with no structure BB.
3. **It is not the operator's stamp** (place-town.py `town_plan()`: the 13x13 stone-brick platform, 3 chests, 5 beds, 28
   torches and the lectern, from `TOWN-PLACED.json`'s home).
   - Protected zones are masked except the bench `fixture` strips, which are not scenery.

**What a BUILT cell means, stated as an estimate (Codex r1 P1).** A BUILT cell is a cell of the observable placed palette
outside the masks. It is an ESTIMATE of "a block a bot placed that persists", and the design claims no more:
- **Why it is mostly bot-placed:** nobody else places blocks here. There are no players (the owner joins as a spectator),
  `mobGriefing` is false, and peaceful means no endermen.
- **Where it is wrong in the "too many" direction:** natural palette blocks that survive the masks. The controls found 0 at
  the surface and 1,311 buried (mineshaft wood beyond a copied region, dungeon fringe), which is why only SURFACE structures and
  rooms are scored.
- **Where it is wrong in the "too few" direction:** (a) natural-kind placements (andesite, diorite, granite, dirt) are
  invisible (§2.7); (b) the masks hide every bot change inside them: a bot block placed inside a padded worldgen box or on a
  stamp cell is not counted. Inside the masks the read therefore reports a separate **inside-mask delta** (palette cells
  added or removed inside masked boxes between two copies) and never folds it into the totals.
- **Attribution for the building tier's own work is NOT this estimate.** It is the records: blueprint conformance (§2.4) reads
  the world at the cells a record names. The estimate is the fleet-wide context line; the records are the evidence.
- **Validation:** the Paper scene SC-CTL (§7) compares the BUILT set with CoreProtect's placed-and-not-broken set on sandbox 1
  (which runs CoreProtect), including bot placements inside a padded worldgen box and on a stamp cell, and reports precision
  and recall.

### 2.3 Grouping: litter, structures, surface and buried

- **Structure:** a 26-connected component of BUILT cells with 12 or more cells. Fewer than 12 is **litter**: a lone table, a
  scaffold stub.
- **Buried:** more than 25% of its cells lie below the column's highest NATURAL solid block. It is a mine stair, a tunnel
  lining or backfill. Buried structures are reported, never scored. They are what the negative controls contaminate
  (dungeons, mineshaft fringe).
- **Rooms are searched in EVERY component, buried or not** (Codex r1 P1): a house joined to a mine stair by one cobble cell is
  one component, and is still a house. Each room carries its own buried test.
- **Town:** each structure is assigned by its centre's Chebyshev distance from home: core ≤ 16, town ≤ 44, out ≤ 96.
  - Expedition outposts beyond 96 get their own box from their records when they exist (expansion plan E3).

### 2.4 Room, building (B5) and structure

The test is written as a pure function, so it can be tested on fixtures: `rooms_of` in the prototype.

A **ROOM** is a 6-connected set of passable cells that meets every rule below:
- each cell has building MATERIAL (BUILT, or a log) above it within 5;
- it is inside walls: from each cell, a horizontal ray meets a wall within 8 cells in at least 3 of the 4 directions. This
  drops the cells under the eaves;
- it has 4 or more standing cells (solid floor, 2 passable cells above);
- it is not buried (at most 25% of its standing cells under natural ground);
- its foot-and-head ring is at least 70% wall, and at least 60% of those wall cells are material;
- it has at least 1 doorway: a 1x2 passable gap in the ring over a solid floor. A door block counts, because doors are
  passable for this test;
- at least one of its roof or wall cells belongs to the structure.

**BUILDING (B5):** a ROOM that is LIT. **Anything less is a structure.** Both are counted, as B5 asks, and "rooms (unlit)" is
its own line.
- **Counted per distinct room, never per component** (Codex r1 P1). Two lit houses joined by a cobble line are two
  buildings. A building with two rooms separated by a wall with no doorway counts twice; the read lists rooms with their
  centres so that is visible.
- **LIT means lit** (Codex r1 P1, r2 P1). Block STATES are read from the palette. Torches, wall torches, lanterns, glowstone,
  sea lanterns, froglights, shroomlights, jack o'lanterns and end rods are always lit; redstone lamps, redstone torches, copper
  bulbs, campfires and candles count only with `lit=true`.
- **Inside means inside** (Claude r2 P3). A light counts in a room cell, or in the cell directly above a room cell (a hanging
  or ceiling light). A light in the ring counts only when the ring cell is WALL (an embedded lamp, glowstone in the wall): a
  torch beyond the doorway or a gap is outside. Never below the floor.
- **A roof is structural** (Codex r2 P1). A roof cell is building material a body cannot pass (`roofing`): never a torch, sign,
  ladder, door, carpet, lantern or chain, which are BUILT palette but roof nothing.
- **"A door" (B5).** The test accepts a 1x2 passable doorway or a door block in the ring. Whether an open doorway satisfies
  the owner's "a door" is owner question Q2 (§8 C2).

**Blueprint conformance** (for a structure the bots built from a record; prior art §9: IGLU's F1, Mindcraft's denominator):
- The world is read at every cell of the record at a fixed origin.
- precision = cells in-family / all non-air cells that the record claims or that fill record air; recall = cells in-family /
  record cells; F1 is reported.
- Both a NAME score and a full STATE score (door facing and half, slab half) are reported. mineflayer's own place check is
  type-only (§9).
- Cells where both the record and the world are air are skipped. A record-air cell that has been filled counts against
  precision.
- Families follow TP 3.2: a weathered cut copper cell is in-family for cut copper.

### 2.5 Per town and per day, and when a number is valid

The daily document, `structcount-<UTC day>.json`, carries per town:
- **buildings (B5)**, new buildings since yesterday, rooms (unlit);
- surface structures and their cells; buried structures and cells (reported only); litter cells;
- built cells added and removed since yesterday's copy (persisted = present in both copies);
- per blueprint record, the state (complete or partial), conformance F1 by name and by state, and missing cells by role;
- dirt_path cells outside worldgen pieces; light sources beside path cells;
- the denominators: chunks read and unreadable, worldgen pieces, unresolved starts, dungeons masked, the stamp cells present
  (a positive control every day), and the plinth cells found.

Yesterday's cell list is kept (gzip, roughly 30k cells per world), so the delta never depends on a second read of an older
world.

**Validity: a number is published only from a qualifying snapshot, else UNKNOWN** (Codex r1 P2):
- **The daily run** reads the backup's staging copy only after `world-backup.sh` has logged that world's completion line for
  the same UTC day (the script writes a per-world `done ... residual=N` line). A world with no completion line, or with
  `residual` above 20 files, is `UNKNOWN` for the day.
- **Every result carries** the snapshot's observation time (the newest region-file mtime it read) and its staleness.
- **Coverage gates:** a scan box with any unreadable chunk, or any unresolved structure start, marks the structures that touch
  the affected chunks `unknown` and excludes them from the totals. The totals then say how many cells were excluded. A town
  with more than 2% of its box unknown is `UNKNOWN`.
- **Atomic publication:** the JSON is written to a temporary file and renamed. A reader never sees half a day.
- **Canary reads do not wait for the night. A region copy is a SAVED-STATE observation, judged per CHUNK; persistence is
  verified separately, by a live survey** (Codex r2-r5 P1, Claude r2-r5). Paper serialises a chunk at a tick and writes it
  whole, so a copied chunk is exact as of its own save, whose time is in the region file's per-chunk table (the second 4 KB of
  every `.mca`). Paper saves only DIRTY chunks, on an interval counted in TICKS (bukkit.yml `ticks-per.autosave: 6000`,
  measured read-only), so quiet chunks keep old save times and the wall-clock lag is not fixed. So:
  - **Per chunk, its own watermark** (Claude r5 P2, Codex r5 P1). A chunk is CURRENT for a record when its save time is later
    than the newest witnessed `_build` row whose cell lies IN THAT CHUNK, plus a 5 s margin (the rows are timed on the bot
    host 10.0.0.31, the saves on 10.0.0.30; both run NTP). A chunk holding none of the record's placements is current at any
    save time. A record is SCORED from the copy when every chunk holding its cells is current; else `UNKNOWN: not yet saved`.
    A workshop finished in chunk A first and in chunk B last is scored as soon as B is saved, however old A's save is.
  - **What a saved-state observation says:** each chunk's part as of that chunk's save. A change by anything without a
    `_build` row (a transit dig, a reflex) after a chunk's save is not in the copy, and is at most one autosave old while the
    chunk stays loaded. The read reports the interval [oldest, newest] save time per record and claims nothing after it.
  - **Persistence is a live SURVEY, not a second copy** (Codex r5/r6). A `survey` order (TP §5's job: 30 min cooldown, any bot
    at town) reads every cell of a record from the server's chunk data as the bot has it loaded, skipping every cell in THAT
    bot's own unconfirmed-dig set (§4.4: a rejected dig's ghost air can outlive any time window; Claude r6 P3), and logs
    `_build_survey` (record, cells read, missing, foreign, unknown, the bot's position). Before it reports a cell missing it runs
    the resync probe on it once (§4.4), so its own stale view cannot fail a real building.
  - **An OBSERVATION of a record is either a scored region read or a clean survey** (Codex r6 P2: a final save inside the 5 s
    margin, in a chunk nothing touches again, would otherwise never score). **ONE rule, used everywhere** (§6.1, §7; Codex r7 P3):
    a building is PERSISTENT when its FIRST observation (a scored region read or a clean survey) and a SECOND observation that is
    a clean SURVEY at least one hour later both find every cell in family, the room intact and the light lit. So copy-then-survey
    and survey-then-survey both qualify, and a quiet building needs no further save. Damage before the second observation fails
    it; damage after it is the next one's.
  - **One read rule for the canary:** exposure counts PERSISTENT buildings; a building with only its first observation is
    reported, not counted; an UNKNOWN record is reported as UNKNOWN.
  - **Copies:** `cp -p` on 10.0.0.30 and the SOURCE file's mtime recorded before the copy. No RCON `save-all`.
  - Tests: CUTOFF-SPLIT (a record across two chunks, A finished first, the last placement in B: scored after B's save, with A
    unchanged and unsaved since); CUTOFF-QUIET (a finished building, its chunks unloaded and never re-saved: scored from the old
    saves, and a survey on the next visit verifies it; and a final placement whose chunk was saved INSIDE the 5 s margin and
    never dirtied again: unscored by the copy, made PERSISTENT by two surveys an hour apart, with nothing written to the world); CUTOFF-DAMAGE (placement -> save -> a transit dig -> copy before the
    next save: scored complete from the copy, the survey finds the hole and the building is not PERSISTENT); CUTOFF-SLOW (a
    save delayed by a slow tick rate: `UNKNOWN: not yet saved` until the chunk is saved).

### 2.6 The controls (run 10-23; numbers in §0 item 2; tools `structcount.py.txt` `scan` / `village` / `negctl` / `delta` / `selftest`)

**Every daily run repeats two controls and alarms on them:**
- stamp cells present must not fall by more than 10% in a day;
- the uninhabited-chunk sample (120 chunks per world) must give 0 surface false positives.

**Weekly:** the showcase's pre-start world is fixed as the clean negative control until bots start there, and the village
test re-runs whenever the classifier changes.

**Mask coverage, every run.** Per town, the share of columns within 44 covered by a padded piece BB, and the share whose BB
reaches within 8 of the surface (10-23: 0 in every bench town). A mask that reaches the surface in a town is named, and the cells
it hides are reported as the inside-mask delta (§2.2). Cells masked only by the padding (outside the raw BB): 28 oak planks in
most bench towns (a mineshaft edge), 657 cells in board-b, 445 in placebo-a, all inside masks that stay at least 8 below the surface within 44 of home.

**The fixtures are part of the instrument.** `selftest` (17 known-answer fixtures) and `mutants.py` (8 anchored mutants, each
asserted present and unique) run before every daily scan and every canary read. Both exit nonzero on any failure, survivor,
crash or missing case line, and the wrapper then publishes nothing for the day (the BUILD lines say UNKNOWN) and alarms.
The wrapper is `tools/daily.sh.txt` (r7), exercised on 10.0.0.30 (`data/daily-wrapper-demo.txt`; Codex r4-r6 P2).
- **The attempt is recorded first,** by an atomic rename into a SEPARATE attempts directory, before anything else. If that
  cannot be written the run stops, touching nothing, and exits 7 (the cron line's exit code reaches the fleetstatus alarm).
- **Each run writes an immutable generation directory** (the day's JSON, its gzip cell list, the controls' outputs) and
  publishes it by renaming ONE file, `manifest.json`: the day, the attempt, the status, the generation, every file's sha256, and
  `last_good` (the newest OK generation and its hash), carried forward through UNKNOWN runs.
- **Checks before OK:** both controls on the same instrument path; per world a scan and a negative control with FULL coverage
  (every chunk `ok`, no unresolved start), the stamp within 10% of `last_good` (hash-validated, so an UNKNOWN run cannot erase the
  baseline), and 0 surface false positives. A failed run publishes a manifest with status UNKNOWN and no files.
- **One run at a time** (Codex r7 P3): the wrapper takes a non-blocking host lock (`flock -n` on its own lock file, held by
  the wrapper's own process for its whole run, never wrapped around another tool's command); a second invocation exits 8 at
  once, touching nothing. Attempt ids carry the UTC stamp to the millisecond plus the process id, and temporary and generation
  names include the attempt id. An overlapping-run fixture runs before the cron line is installed.
- **"Run in progress"** (Claude r7 P3): while the newest attempt is younger than 60 min and has no manifest, the reader says
  `RUNNING` (not UNKNOWN) and goalboard's BUILD line prints "run in progress"; older than that, it is UNKNOWN.
- **The READER** (`tools/readmanifest.py.txt`, goalboard's rule) says OK only for a manifest of the expected day whose attempt
  equals the newest recorded attempt, with status OK and every hash matching. So a failed manifest replacement, or an unwritable
  output directory, after a same-day OK reads UNKNOWN (that attempt has no manifest), while the older generation stays readable
  as history by its name.
- **Nine demonstrations**, the two failures above each starting FROM a same-day OK, and OK -> a failed run -> a retry with a
  depleted stamp (1 of 186: refused) -> a normal retry (OK). Earlier rounds' demonstrations (each step's injected failure, a
  broken instrument, a missing region file) run the same code paths.

**Known false positive, named.** The only room found on the bench (board-b, 76 from home) is a cobble scaffold under a
jungle canopy, with log walls. B5's light rule makes it a structure.
- A lit canopy hollow could still pass. That is why blueprint conformance, not the room test, is what judges the bots' own
  buildings.
- Raising the bar for BUILT roofs would also fail the village control: 14-50% of village roof cells are BUILT, the rest are
  logs.

### 2.7 What it cannot see, and the rule that follows

- **Natural-kind placements are invisible.** The plinth control misses exactly these: 62 of 650 cells were andesite, diorite
  or granite.
  - **Rule:** every blueprint material is in BUILT. A structural test asserts it for every enabled blueprint, with an anchored
    mutant that adds andesite.
- **Fluid-made cobble at the surface** would be a false positive, and the uninhabited-chunk control cannot see it (those chunks
  never ticked, so no lava ever met water there: Claude r1 P2). Bounded instead: 3,761 surface cobblestone cells across the 16
  towns touch water, lava or obsidian (44-980 per town; `data/structcount-summary-20261023.txt`). Most are bot work (pathfinder
  bridges over water, poolescape's plugs, the wells), so that is an upper bound, reported every day as its own class and never
  scored as a building.
- **A structure dug away between two copies** is seen as removed cells, never as a building lost. So the read pairs removed
  cells with the records they belonged to.

### 2.8 Wiring into the daily scoreboard (PROPOSAL; nothing installed)

1. **10.0.0.30, mike's crontab, 03:45Z, then every 15 min until each world qualifies or 06:00Z** (§2.5's completion rule, not
   the clock, decides):
   `cd ~/structcount && nice -n 19 python3 structcount.py daily --staging /srv/world-backup/staging --out ~/structcount/out`
   (the `daily` mode is to be added: the prototype has `scan`, `village`, `negctl` and `delta`).
   - It writes `structcount-<day>.json` and alarms in `~/structcount/out/check.log`.
   - **Prerequisite:** the alarm must surface in the fleetstatus header, because an alarm in an unread log is no alarm (memory
     "alarm log nobody reads").
2. **The hop to 10.0.0.31.** goalboard reads `--census-dir`, and the chest census already needs the same hop, which is still
   unresolved (no ssh either way). structcount's file rides the same mechanism. Until the owner picks one, the BUILD lines
   say `no_structcount` (UNKNOWN), never 0.
3. **goalboard.py** gains a BUILD section (the owner's "build cool structures" line):
   - per town: buildings (B5); new buildings; structures (surface); structure cells added and removed; litter cells; records
     complete and their conformance;
   - each line names its source, window and denominator, the day's controls (stamp present, uninhabited false positives,
     selftest), the snapshot time, and the excluded (unknown) cells; an UNKNOWN town says so.
4. **scoreboard.py** (items) gets one line, "buildings (B5) fleet-wide, new today", read from the same JSON. It stays an item
   board.
5. **Weekly descriptive** (`townweekly.py`, TP §7): "did each world build something from its own materials?" now means a
   complete record with conformance F1 ≥ 0.98.

The instrument is a read script and is not canaried. It must run for at least 3 days before the first building canary, so the
baseline (0 buildings everywhere) is on record.

---

## 3. Materials processing

### 3.1 Recipes (minecraft-data 1.21.8, checked 10-23)

| part | recipe | where | fuel |
|---|---|---|---|
| stone (intermediate) | smelt 1 **cobblestone** (cobbled deepslate smelts to deepslate, not stone) | furnace | 1.5 smelts per plank |
| **stone_bricks** | 4 stone -> 4 (2x2) | inventory: no table | — |
| stone_brick_slab / stairs / wall | 3 -> 6 / 6 -> 4 / 6 -> 6 | table | — |
| **planks** | 1 log -> 4 | inventory | — |
| sticks | 2 planks -> 4 | inventory | — |
| glass | smelt 1 sand | furnace | as stone |
| **glass_pane** | 6 glass -> 16 (2x3) | table | — |
| copper_block | 9 ingots -> 1 | table | — |
| **cut_copper** | 4 copper_block -> 4 | table | — |
| **copper_door** | 6 ingots -> 3 | table | — |
| torch | coal **or charcoal** + stick -> 4 | inventory | — |

- Not used, because B3 forbids iron: the **stonecutter** (1 iron ingot + 3 stone) and the **lantern** (8 iron nuggets).
  mineflayer has no stonecutter window either (issue #237), and the 2x2 craft makes stone bricks 1:1 anyway.
- No bricks: there are 0 clay balls fleet-wide.

**Fuel is planks, in exact batches.** A batch is 12 cobblestone: one furnace session fuelled by exactly 8 planks (8 x 1.5 =
12 smelts, so no part-burnt plank is left), which is 2 logs, and gives 12 stone = 3 crafts of 4 bricks. Glass is one session of
6 sand on 4 planks (1 log; 6 smelts), which makes one 16-pane craft.
- Planks respect B3 (never coal) and D4 (no charcoal) as they stand.
- A stone brick costs 1 cobblestone and 1/6 log, exactly.
- Charcoal would give about 6.9 smelts per log after paying its own smelt, so it gains nothing for smelting. Torches are the
  one part that needs coal or charcoal (§8 C3).

### 3.2 Who, when, how much

**`make_material`** is a deterministic town JOB in the TP §5 pattern. It is not a model verb: the brain's `build` verb
already went unchosen in 24 h, and advice printed is not advice taken.
- It is a pure `materialOrder(readings) -> { order | skip }`, issued as a HOUSEKEEPING proposal through admission.
- It runs in cognitive.mjs after the town deposit, the town orders, the well and prune, and only when no milestone rung is
  ready. The rung always wins.

**Eligible when all hold:**
- the bot is in a SHARED town (isolated-a, c and d keep per-bot town state: TP D2, town plan O8), at town;
- it has the order's exact slot need free after keeps: one slot each for the inputs, the planks, the parts, and any furnace
  leftover it may collect. That is **4** for a stone or glass order and 3 for a copper order;
- this bot's cooldown (10 min) has passed, and the town's materials lease is free (one maker per town; 4 min TTL, renewed);
- **a part is short**: either the remaining bill of the town's admitted, claimed blueprint (net of finished parts and claims),
  or, with no project, the part below its BUFFER;
- the inputs exist above the reserve (§3.3), preferring the bag's own cobble above its keeps first (the owner's cobble-in-bags
  concern), then the town index;
- a table recipe needs a table in reach: the workshop's, or the bot's own carried one placed as craft does today;
- a FURNACE QUALIFIES (Codex r1 P1 and r2 P1, Claude r1 P2): the furnace lease is ACQUIRED (an unavailable lease store is a
  refusal, never an open path); the furnace is COLD: its block state reads `lit=false` from the server's own block update,
  and at the open the window's burn progress (mineflayer's `furnace.fuel`, separate from the fuel slot) is 0, because an empty
  fuel slot can coexist with coal still burning; its fuel slot is empty or planks, its input slot is empty, and its output
  slot is empty or this job's own part. Anything else is a free skip: `furnace_drain` owns foreign contents. Once the workshop
  exists, its furnaces are reserved for this job: the milestone `smelt` and `smelt_town` skip them (TP's yard-furnace rule).

**One order, inside one 180 s skill budget** (as smelt_town):
1. Write the durable **carry note** (`mats-carry-<bot>.json`, fsync), naming the batch, its inputs and expected outputs.
2. Withdraw one batch: 12 cobblestone, or 6 sand, plus the logs for its planks.
3. Craft exactly the planks the batch burns (8, or 4).
4. Run one furnace session with an EXPLICIT fuel list of planks only. The existing `smelt` session is not reused as it is,
   because `chooseFuel` (smelting.mjs) ranks coal and charcoal first and the bag may carry coal under the iron ladder's keep.
5. Take the output **only in multiples of 4 stone**, standing at the furnace, and craft the bricks at once, with no movement in
   between. A remainder of 1-3 stone stays in the furnace (this job's own) for the next session. In an ordinary town furnace
   (before the workshop exists) `furnace_drain` may take that remainder into a bag first; that is harmless (stone has a 64
   target) and MAT-FURN shows it.
6. Craft the parts: glass into panes; ingots into copper blocks and then cut copper or doors (copper orders skip 3-5).
7. In a `finally`, deposit the parts and every unspent input, then close the note.

**Recovery, `mats_return`** (the tidy-01 carry-note pattern, town plan §7.3): runs first at the next town visit, before any
other town order.
- It reconciles by looking (the bag, the furnace, the deposit target) and crafts any stone in the bag in fours.
- **A 1-3 stone remainder is never "banked and closed" when stone cannot bank** (Codex r2 P2: stone's 64 target may be full).
  It stays under the open note as a KEEP and is consumed by the bot's next order, which withdraws 12 minus the remainder.
- **Carry protection starts at spawn, and removes only what is the job's alone** (Codex r2 P2, Claude r3 P2). The scaffold list
  is TYPE-level (mineflayer's `scafoldingBlocks` has no counts), and `exit-contract.mjs` `scaffoldCount` counts the bag by
  name. Removing a base type a bot also carries (cobblestone, planks, logs) would leave the pathfinder unable to climb while the
  exit contract still counts the blocks: a composed dead end. So:
  - **only `stone`**, the job-only intermediate that bots almost never carry otherwise, leaves that bot's scaffold list while a
    note names it (index.mjs reads the note when it builds the bot's movements, on spawn and on every note change);
  - noted cobblestone, planks and logs stay scaffold. The KEEP still protects them from deposit, prune, the well and crafts;
    a pathfinder spend of them is booked from the bot's own place rows as a REPORTED loss of the note, never a defect;
  - chain test MINE-NOTE: a deposit fails with a note open, the bot goes mining, and the exit contract's count equals what the
    movements can place: the bot climbs out.
- **D8's unshipped half ships in matset-01:** `stone_bricks` and `smooth_stone` are still in `PATHFINDER_SCAFFOLD`
  (scaffold.mjs) although D8 made them building material; they leave it. Planks and stone stay scaffold for ordinary travel,
  and the claim/note exclusion above covers them while they are a job's or a segment's.
- A loss that the bag and furnace do not account for is booked as a conservation defect. A stone spent by a reflex's pillar
  is accounted from that reflex's own placement row and reported, not a defect.
- Tests: a restart mid-note followed by a long walk home (0 stone placed; any noted cobblestone or planks spent as scaffold
  booked as a reported loss, the note's accounting exact); a deposit that fails with the note
  open (the note stays open, the KEEP holds).

**Bounds:**
- 1 order per bot per 10 min; a 20 min backoff on failure.
- Town jobs share the TP body budget of at most 10 min per bot-hour (measured from the job rows).
- BUFFERS, per town, a setting: stone_bricks 128, glass_pane 32, cut_copper 24, copper_door 3. Buffers limit PRODUCTION; they
  are not stock targets (§3.4).
- With no admitted project nothing is made beyond the buffers, so a town cannot be hollowed into parts.
- **Exposure is reachable before the workshop exists** (Claude r3 P3): the region copies' furnace block entities
  (`tools/coldfurnace.py.txt`, `data/coldfurnace-20261023.jsonl`) show 1-5 town furnaces per town within 16 of home, 35
  in 16 towns, and 34 of them QUALIFY today (`lit_time_remaining` 0, empty input, empty or plank fuel, empty output; the one
  that does not holds iron output). One order makes 12 bricks, so mats-01's ≥ 20 parts need two orders per canary town.

### 3.3 The reserve (B3) and why it cannot eat the tools

**`BUILD_RESERVE` is a setting** (an env JSON with the defaults below, read at spawn and logged in the `_mats_mode` licence
row). Defaults per town: cobble 256, logs 512, planks 64, sticks 64, copper ingots 256, sand 16, torches 32.

**Spendable** = indexed town stock (townindex-01: known and fresh entries) − reserve − outstanding claims. A container whose
index entry is `unknown`, `stale` or `dirty` counts 0 until count_town re-reads it, so admission can only under-count.

**Never inputs, whatever the setting says** (code, not configuration):
- the iron ladder: raw iron, iron ingots and nuggets, iron ores, coal, charcoal;
- every tool, bucket and shears;
- sticks below the reserve (the kit's sticks);
- anything under a live claim: toolkit draws, withdraw holds, cobblecap claims.

Tests:
- a structural test asserts the forbidden set against `IRON_LADDER` and the toolkit's inputs;
- behaviour tests run `materialOrder` on index fixtures: one that holds only iron and coal (a skip); one with coal already in
  the furnace's fuel slot (a skip); one with foreign iron in the furnace (a skip); one with the lease store unavailable (a
  skip); one with coal and planks both in the bag (planks burned, coal untouched, by the session's own fuel booking);
- the conservation gate books fuel BY NAME, so any coal or charcoal burned by this job is a REVERT.

**Admission is TP 3.2's, unchanged** (Codex r1 P1: r1 had it reversed): a blueprint instance is admitted only when its WHOLE
bill of materials allocates within 80% of spendable stock, by recipe-aware allocation (finished parts first, then
intermediates, then raw inputs and their fuel). Each instance is admitted on its own: the workshop, then each house.
- **Copper is an UPGRADE with a fallback** (TP §4 common rule): a copper-short town builds the roof-edge trim in planks and the
  house corners in stone bricks, and the door as an open doorway. No town waits for a metal.
- **The bill is exact** (`tools/funding.py.txt`): it is computed from the blueprint's cells by executable batches, with the
  stations (a table, two furnaces) and the earthwork fill allowance (40 cobble per pad) included.

**Funding today, PROVISIONAL** (`tools/funding.py.txt` r5 over `data/census-species-20261023.jsonl`: TOWN STORAGE only
(straight-line 16, 12 vertical: 10-35 containers per town), an offline proxy for the runtime index, which adds freshness and
claims and alone qualifies a draw (§6.2); every pool clamped at 0 after the reserve and every draw INTEGRAL and within 80% of its
pool; whole logs crafted, spare planks kept per species; finished parts, then intermediates (banked stone, glass, copper
blocks), then raw inputs; a failed role rolled back before its fallback; 13 eligible towns). Its own fixtures
(`data/funding-selftest.out`, 10 of 10): oak walls never from birch planks; 523 oak logs + 172 oak planks (118 drawable) refused;
banked panes, banked glass, banked cut copper and banked copper blocks each used with no raw input; banked stone counts toward
bricks; a draw over 80% refused; a failed copper role leaves banked cut copper untouched; and (Codex r5 P2) glass in WHOLE
batches only: banked glass covers whole 6-glass crafts, every other craft is one full 6-sand session on 4 planks, so 2 banked
glass are never mixed with sand (12 of 12).

| | bill from the cells (copper trim / plank fallback) | towns admitted now |
|---|---|---|
| workshop@1 | 152 cobblestone (8 sessions of 12, 2 furnaces, the fill allowance); 57 or 77 wall-species planks + 64 fuel planks; 180 ingots or 0; 2 torches; windows as planks while sand is 0 | **10 of 13** (8 with copper trim). hive-b, hive-d and placebo-d are plank-short at a 512 log reserve; hive-d also has 0 torches in its chests |
| house@1, one at a time after the workshop | 112 cobblestone; 51 planks + 48 fuel planks; 42 ingots or 0 (stone-brick corners, an open doorway) | **26 of the 65** houses (13 towns x 5) admissible in sequence from today's town storage with no refill, 0-3 per town. Cobble refills at the cap daily, and the wood stockpile with gathering |

**Sand is 0 everywhere today:** glass waits on matset-01's sand target. Windows are an upgrade too: an unplaced window cell
becomes a plank wall cell after 24 h (`window_shortfall`, the pavilion's `roof_shortfall` pattern), written only by the crew
holder (§4.1).

### 3.4 Settings that ship first (matset-01, tier 1)

- **sand** stock target 0 -> 64 per town, so the 574 sand a day stops being pruned.
- **glass and glass_pane** leave `DECORATIONS` (the junk-well list).
- **Every part is PROTECTED and untargeted** (Codex r1 P1, Claude r1 P2). `stockWellStacks` and prune check
  `stocktarget.isProtected`, not `NEVER_DISPOSE`, so the protection goes where the disposal paths look:
  - stone_bricks (and its slabs, stairs and walls), glass, glass_pane, copper_block, cut_copper (with its slabs, stairs and
    every oxidation) and copper_door join stocktarget's `PROTECTED` and well.mjs's `NEVER_DISPOSE`;
  - they get NO stock target, so no cap can ever refuse or prune them;
  - they are always bankable (a `PROJECT_PARTS` set: town_deposit banks them; the deposit plan never keeps them as ballast),
    and `glass` itself gets a bank route, so an interrupted pane craft does not leave glass as bag ballast.
- **`stone_bricks` and `smooth_stone` leave `PATHFINDER_SCAFFOLD`** (scaffold.mjs still lists them: D8's second half never
  shipped), so the pathfinder never spends a finished building stone.
- `BUILD_RESERVE` is declared. Nothing reads it until mats-01.
- **Test:** a full bag in a town at every cap, holding each part: none is disposed, pruned or thrown; each is banked.

---

## 4. Real structures from plans

### 4.1 The blueprint (format), the record, and the claimable sub-task

A **blueprint** is a versioned JSON file in `bots/src/blueprints/`. It holds:
- `id@version`, the plot kind, the footprint, `pad: {w, d}`;
- `palette`: ROLES mapped to blocks, with fallbacks. For example `base: stone_bricks`; `wall: planks` (the town's most-stocked
  species); `window: glass_pane -> wall`; `trim: cut_copper -> planks`; `door: copper_door -> doorway`; `light: torch`;
- `cells`: `[{u, v, y, role, state?}]` relative to the anchor, orientation E. Rotations are as ring@1's;
- `segments` and a **proven sequence** per segment.

**A structural rule:** every material of every role and fallback is in the structure count's BUILT palette (§2.7), asserted
for every enabled blueprint, with an anchored mutant that adds andesite.

The block-state rule is TP 4.0's:
- only blocks whose state is irrelevant, or set by a top-face click;
- the door is the one stateful exception. Its predicted state (facing from the stand's yaw, the lower half, the hinge from
  neighbours) is checked by a pure function, then read back as full state from the server's packet.
- Conformance's STATE score counts door facing, half and hinge, and slab type. It skips cosmetic state (furnace facing and
  `lit`, pane and wall connections).

A **record** is the fitted, frozen instance: absolute cells, with the stand and face per cell, written once by the planner as
generation files (`project-<home>.<plot>.g<N>.json`, the town plan's planstore acceptance walk and link() protocol, never
pruned). Progress is the world, never a saved index (Baritone's rule, §9), so an abort, a restart or a different bot resumes
from the same truth.

**SEGMENT** is the claimable sub-task unit the cooperation design asks for. Its fields follow cooperation-1023 §5.2 (r2),
adopted as proposed except where §8 C5 says otherwise:

| field | meaning |
|---|---|
| `seg`, `layer` | the segment (`pad`, `ring`, `wall-N/E/S/W`, `roof-edge`, `roof-inner`, `fit-out`, `door`) and its dependency depth |
| `cells_open / cells_done / cells_waived` | from the world, every read. A cell is WAIVED only after `no_step` on 3 visits on different days with the reason recorded, and only for a non-structural role (window, trim); walls, roof, door or doorway and the light are never waived. A failed walk-probe is one such `no_step` (the cooperation design's question). `structure_complete` needs 0 open structural cells |
| `material_open` | the bill of the segment's open cells only |
| `deps` | segments that must read COMPLETE in the world first (roof-edge needs every wall; roof-inner needs roof-edge; door needs fit-out) |
| `lease` | `project-<home>.<plot>.seg<id>.lease.g<N>.json` |

The record also carries `structure_complete`, `layer_open`, `bom_open` (open cells only), `builders_max` and `slots`.

**Fencing and concurrency (Codex r1 P1, r2 P1):**
- **An admission SLOT first.** A builder takes one of `builders_max` slot leases (`project-<home>.<plot>.slot<k>.lease.g<N>`,
  k = 1..builders_max) before any segment. That is the atomic, project-wide builder cap.
- **A fresh epoch per acquisition.** Every acquisition of a slot or a segment links a NEW generation N. The fencing token
  checked immediately before every click is (that lease's own N, the record generation, the BARRIER generation below).
- **One OS mutex per project, around every final check and send** (Codex r3 P1). Every bot of a town runs on one host (the
  bench on 10.0.0.31, the showcase on 10.0.0.40) and the town's state directory is local there, so a kernel lock serves:
  `flock(LOCK_EX | LOCK_NB)` on `project-<home>.<plot>.mutate.lock`, taken **non-blocking** through a native binding (Node has
  no built-in flock; never by spawning the `flock` command around an await, the deadlock of memory "canary-sched takes its own
  lock"). Busy is a free skip of that click, retried at the next step; a bot never waits on it (Claude r4 P3). A sender, in
  this order: (1) appends its intent (cell, block, lease N, its **sequence number**) to its lease's intent log and fsyncs it;
  (2) takes the mutex; (3) checks its lease, the record generation and the barrier; (4) sends the click carrying that
  sequence number; (5) releases the mutex when the click is SETTLED (below), or after 5 s with the intent still open. If (3)
  fails it marks the intent `cancelled` and sends nothing. A process that dies releases the mutex in the kernel.
- **Settlement is the server's ACKNOWLEDGEMENT of that click, never a read of the cell** (Codex r4 P1). Since 1.19 every
  use-item-on carries a sequence number and the server answers it with `acknowledge_block_change` for that sequence, after it
  has processed the click, on the same TCP connection. The builder sets a unique sequence per click (one counter shared with
  digs: the ghost-block design's "one shared sequence counter"), and an intent is settled only by its own sequence's
  acknowledgement, recorded with the cell's resulting state. A fresh read that shows the cell unchanged settles nothing: the
  click may still be in flight.
- **The BARRIER** (`project-<home>.<plot>.barrier.g<N>.json`): a closer cell (a placement the proof marks as reducing a room's
  exits or closing a roof over one) and every fallback transition (`window_shortfall`, `trim_shortfall`, `door: doorway`)
  first take the mutex and write a new barrier generation; from then no other sender passes step (3). The holder then waits
  for EVERY intent that is neither settled nor cancelled, live or expired. Such an intent is released only by its
  acknowledgement, or by the RETIREMENT of its sender's connection: the server's `playerLeft` for that bot, seen by the holder,
  plus 1 s (a retired connection can deliver nothing more). Never on a timer. Only then does the holder re-evaluate
  `wouldEnclose` against every body and click, or write the transition.
- Tests (SHOP-BARRIER, on Paper): a sender SIGSTOPped right after its check while holding the mutex (the other builder SKIPS,
  it does not hang; no closer click until the stopped one resumes or dies); **a delayed click, then a fresh read, then a
  closer** (netem delays one bot's packets beyond 5 s: the read shows the cell unchanged, the barrier still waits for the
  acknowledgement, and the closer clicks only after it); an expired holder's in-flight click; an ordinary click racing the
  barrier take; a click crossing a `trim_shortfall` transition. Paper must also show that it acknowledges every
  use-item-on by sequence, including a refused one.
- **Concurrency otherwise:** two segments run concurrently only when no cell, stand or support of one lies in the other's cells.
- **Rows** (the cooperation design's "what the building tier must emit"): a positioned `_build` row per witnessed placement
  (project, segment, cell, block, bot); a row per slot and segment lease taken and lost; `_structure_complete` when the
  in-bot predicate flips. All carried in the detail string: no new ES fields, because an unmapped field rejects whole
  documents (town plan §4.2).
- **The in-bot predicate** is the structure count's: every record cell in family, and the record's interior passing the
  room test with a lit light. It is one pure function with one fixture suite, ported from `rooms_of`.
- **Exposed pure functions:** `buildEligible(bot, record, seg)` split into a host part (the segment's bill ALLOCATABLE from the bag,
  the site chest or any fresh, known town container in the index, under the claim set: Codex r3 P2, a free slot, the segment unleased, no flag, health > 10) and a bot part (a stand reachable by the walk
  probe); `segmentDone`; `segmentBom`; `concurrentOk`.

### 4.2 The blueprints (B2 palette)

Heights: g0 is the most common ground level of the pad's columns. The **pad sits at s = g0 + 1**. Walls are at s+1 and s+2,
the roof is at s+3, and the step ring (TP 4.0's terrace) is at s+1, outside the walls. fitb.py's `s` is g0, the ground.

**workshop@1, the shared building (bench).** TP stage 3's pavilion geometry, closed in. Its roof pattern is the one TP's r2
probe proved offline on the hall's 9x7; the pavilion itself was never built.
- pad 9x7 stone bricks at s (63), and a step ring at s+1 (26, a gap at the doorway);
- walls 7x5 at s+1 and s+2: 34 planks and 4 glass panes (at s+2), with a 1x2 open doorway on the side facing home;
- roof 7x5 at s+3: a 20-cell cut-copper ring as the roof EDGE (on the wall tops, from the ring), then 15 plank cells inside;
- inside: 2 torches, 1 crafting table, 2 furnaces on the back row, the standing row in front.

That is 167 placements. The bill (exact, §3.3): 152 cobble (89 bricks rounded to 92, the stations and the fill allowance), 31
logs, 6 sand, 180 copper ingots (fallback: planks). It is the town's `make_material` site from then on. The trim forms the roof
edge, so it has its own deadline: without copper parts 24 h after the walls complete, the edge goes planks (`trim_shortfall`),
because the inner roof cannot start without it.

**storehouse@ring, the shared building (showcase, greenfield).** The town plan's §7.4 shape around found-01's founding chests:
- 9x9 pad, step ring, 7x7 walls 2 high, plank roof at s+3 (O6);
- signs above each section;
- B2 swaps the pad and ring to stone bricks and the walls to planks with panes.

Its own gates are the town plan's: construction proven with the containers present, nothing solid above a container, labels
read back.

**house@1, a house per bot (B1 step 2):**
- pad 7x7 stone bricks (49) and ring (23);
- walls 5x5 at s+1 and s+2: 27 planks and 3 panes (16 wall columns x 2 = 32, less the 2 door cells and 3 panes);
- roof 5x5 at s+3: 21 planks and 4 cut-copper corners;
- 1 torch inside; a **copper door placed last, from outside** (fallback: doorway).

That is 129 placements (49 + 23 + 30 wall cells + 25 roof + torch + door). Per house: 112 cobblestone, 51 planks + 48 fuel planks (25 logs), 6 sand for 16 panes (one craft covers
five houses), 42 ingots. Nothing is
stored inside, and no bed: beds would move respawn. **Once its door is in, a house is not entered again by design** (§4.4 says
what happens if a bot gets in anyway).

**wall@1 (B1 step 3):**
- 2-high stone-brick segments of at most 12 cells, each followed by a 2-cell gap;
- a torch on top of every 6th cell;
- a gate at every path spoke;
- traced on the **straight-line-44 circle** (Claude r1 P2: the TP outer domain is straight-line ≤ 44; a Chebyshev-44 square
  reaches about 62 at its corners), skipping every plot box + 1, zone, liquid and the monument apron.

A full ring is ≈ 276 cells x 2 = ≈ 550 bricks (≈ 92 logs of fuel). It is built per segment as the reserve allows.

**paths (B1 step 3):** paths-01 as designed in the town plan (§7.6): a shovel's use, `dirt_path`, never a dig, and a torch
beside the path every 6 cells.

### 4.3 Siting: plots, sectors, clearing (B4)

**One domain for the shared building** (Claude r1 P2: r1 said both "the pavilion's sector" and "inside 16"). workshop@1 is
sited in the **outer domain**: Chebyshev ≥ 22 and straight-line ≤ 44 for every cell and stand, in the pavilion's sector, which
the workshop replaces as the first roofed build. Outside the 16 circle:
- it never meets townzone's no-dig square, so B4's clears need no townzone exemption;
- it holds no containers, so no town-storage semantics change;
- its furnaces are named by its record, and they are within the drain's 48.

Houses are a new plot kind, `house`, appended to the plan (append-only; no committed plot changes): five 7x7 pads with 2-cell
gaps in the sectors either side of the gate path, at Chebyshev ≥ 22 (TP 2-8: no structure inside 21, which keeps the plinth
re-site room and the shaft collar) and straight-line ≤ 60 (owner Q10: the screen packed five within 40 in no town). A house
build visit starts at town and walks out; its walk is not re-gated by the 48-block town radius, and every house stand must walk
back to town (TP 4.0), which the screen's two-way walk and the frozen-plan proof check. The wall is a `wall` plot.
Paths are the plan's own.

**Where a 9x7 pad is geometrically possible today** (`tools/fitb.py.txt` on the region copies,
`data/fit-sharedbuilding-20261023.jsonl`). This is a GEOMETRIC screen under B4's limits: town furniture ±1, plinth cells ±2,
zones, liquid, at most 3 high of cut and 3 deep of fill (30 and 40 cells). It is NOT composed with the plan's reservations
(sectors, paths, the farm and its trees + 3, the monument's Z0 apron, the shaft's M0 collar, keepout columns), because those
exist only once townplan-01 writes plans. So its counts are UPPER BOUNDS:

| band | towns with a candidate | notes |
|---|---:|---|
| inside the 16 circle (7-16) | 4 / 16 (board-b, board-d, hive-d, placebo-a) | reported, not used: town furniture blocks it, as the town plan found for 9x9 (0 / 16) |
| near (17-30) | 13 / 16 | not board-c, isolated-d, placebo-c |
| **outer (Chebyshev 22-44, straight-line ≤ 43)** | **16 / 16** | best earthwork 0-38 cells; up to 266 tree cells above the pad |

**The composed site gate (P0), run now as a screen** (`tools/fitc.py.txt`, `data/fitc-composed-20261023.jsonl`; Codex r2/r3 P2):
the geometry above composed with every record that exists today: every plinth record with its `prev[]` history (+2), the tree-
farm records (+2), the Z0 ziggurat footprints and M0 shaft origins (+8, TP 2-8), the structure count's own BUILT cells in the
pad volume (a container, station, torch, ladder, door or sign refuses the site; more than 40 cells of scaffold litter refuses
it; fewer are a fenced `scaffold` clear), the whole-tree reach rule, a legal replant cell per trunk, and a walk route from home
(steps up ≤ 1, down ≤ 3, no liquid). Every stand cell is checked:

| | towns (screening CANDIDATES, not qualified sites: Codex r4 P3) |
|---|---|
| workshop@1 candidate | **5 of the 13 eligible** (board-d, hive-b, isolated-b, placebo-a, placebo-d). The walk route is symmetric (steps of at most 1 up or down, so every stand also walks BACK to town: Claude r4 P3). What removes the rest after the geometry: trees too tall for a ground stand (board-b, board-c, hive-a, hive-c, placebo-b, ...), no two-way walk route (board-a, hive-c, hive-d, isolated-a, placebo-b, placebo-c), reservations |
| funded AND a candidate today | **3 of 13**: board-d, isolated-b, placebo-a |
| five house@1 plots, greedy packing, straight-line ≤ 40 | none found in any town (0-3 per town). A greedy failure does not prove five cannot fit |
| five house@1 plots, greedy packing, straight-line ≤ 60 | found in 4 of the 5 towns with a workshop candidate (board-d: 2) (`data/fitc-composed-house60-20261023.jsonl`) |

Not in the screen, because they exist only once townplan-01 writes plans: the ring@1 sector assignment (each candidate's 45°
sector is reported so the planner's choice can be checked against it), path segments, and the well and farm sectors. The walk
rule is a conservative proxy for the pathfinder (which can scaffold). The screen does not prove whole-tree reach from a real
stand, a jointly reserved set of replant cells, or a construction sequence: those are the frozen-plan proof's. **The runtime planner's run on frozen plans remains the
first step of building shop-01, before any actuator code, reported with both reviews.**

**Clearing (B4).** It happens only inside the claimed plot box, by its builder under the fenced lease, from the record's
CLEAR LIST. Never in a protected zone, the showcase's village boxes, or another plot.
- **Trees.** A tree is clearable only when EVERY log of it (the whole trunk and branches of any tree whose trunk enters the
  volume, Claude r2 P3) is reachable from a ground or pad stand (dig reach 5.0, as builder.mjs). A site needing a higher
  stand is refused by the gate: no floating trunks, and the builder places no temporary scaffold in v1. Leaves of a fully
  felled tree decay on their own.
- **Replant, durable and first** (Codex r1 P2, Claude r1 P2):
  - the gate reserves one legal replant cell per trunk in the record before anything is felled: outside every plan cell and
    reservation (including future house plots), not in a zone, soil with the sapling's clearance, reachable, in a band 8-24
    from the plot;
  - the record's generation that claims the plot carries `replant: [{cell, species, state: pending}]`;
  - the sapling is PLANTED (and its cell confirmed by packet) before its trunk is felled, and the obligation is marked done
    in the next generation;
  - felling needs the sapling in the bag first. The remedy is a withdraw from town (640 oak and 323 birch saplings in chests);
  - after a crash, the next visit plants pending obligations before any clear;
  - **no legal replant cell means no site** (re-fit), never a felled tree without its sapling.
  - **AMENDMENT S2 (owner sign-off 10-26, via the coordinator; shop-01 r18-r20, F2):** siting still refuses a site with no legal
    replant cell (the siting proof and the visit now share one test, `buildsite.mjs replantCellAt`). A replant that the
    VISIT cannot plant (the world changed since siting) is MOVED to another legal cell (the band, then the whole town walk,
    never nearer the pad than the band; at most 4 moves, never back to a cell already refused); with no legal cell anywhere
    in the walk it is DEFERRED for 3 visits and then SKIPPED -- its tree may then be felled without a sapling. Every move,
    deferral and skip is a named `_build` row (`replant_moved` / `replant_deferred` / `replant_skipped`) the read reports,
    and the read's G5 counts only the replants not skipped. If the town's reservations cannot be read, nothing moves or skips.
- **Small hills:** terrain above s-1, at most 3 high per column and 30 cells per plot (the screen's limits), is dug. Holes, at
  most 3 deep and 40 cells, are filled with cobble. Larger relief refuses the site (re-fit).
- **Foreign blocks after siting:** blocks of the pathfinder's scaffold list (cobble, dirt, natural stone) that appear inside a
  claimed volume are cleared under the fence as a `scaffold` clear class. A container or station that appears there stalls
  the segment (TP 3.2's stall -> abandon -> re-site). Placement paths (`place`, station placement, the full-town recovery)
  read every record's cells + 1 as occupied (TP §8 `projectReservedCells`, TP 2-8 rule (a)), so this should not happen.

### 4.4 The placement actuator

**builder.mjs / buildbot.mjs** (structureguard-on-835ef3f @ eb407fa0; Paper 10-15: 366 of 366 cells confirmed at 1.14 s per
placement, resume after a disconnect, bystanders) is rebased and extended:
- **Stands:** plinth's rules (`standFor`, `standOk`, `walkReachBack`), with reach 4.5 from the eye to the face centre.
  - TERRACED stands: ring at feet s+2, from TP stage 3. Roof edges sit on wall tops from the ring; inner roof cells go on
    the side faces of placed neighbours from inside.
- **Server truth for every mutation.** Raw `block_change` and `multi_block_change` packets name the wanted state at the cell.
  The last word wins; silence is a refusal, never a success.
  - mineflayer's `placeBlock` checks only the type and does not predict. Its DIG writes air before the server answers (memory
    "ghost blocks are rejected digs"). So:
  - every B4 clear is confirmed by a server packet before any stand or support relies on it;
  - no dig is made in the first 3 s after a spawn or respawn (no `player_loaded` is sent; cause #1 of the ghosts);
  - a dig with no confirmation within 3 s marks the cell unknown, and it is never stood on or built against.
  - **Recovery is a deterministic RESYNC PROBE** (Codex r2 P2: waiting is not recovery, because a loaded chunk does not resend
    an unchanged cell). The builder clicks (use-item-on) the face of a solid neighbour that points INTO the unknown
    cell, holding an EMPTY HOTBAR SLOT selected by `setQuickBarSlot` (never `unequip`: the unequip-on-full-bag toss bug), else
    its pickaxe (no use-on-block action); never an axe, shovel or hoe (they strip, path or till), and the clicked neighbour is
    never interactable (a container, station, door, trapdoor, gate, bed, button or lever). Vanilla's use-item-on handler answers every such click with block updates for the clicked block and the adjacent
    cell, so the server's true state arrives. At most 2 probes per cell per visit. Paper must prove it (scene GHOST-RESYNC)
    before any blueprint relies on it.
  - With no solid neighbour face in reach, or 2 probes unanswered, the cell stays unknown: the segment yields and the other
    segments go on. The bot's next trip out of town beyond view distance reloads the chunk (a fresh chunk resend), and the next
    visit starts with that cell. After 3 visits the stall rule applies (TP 3.2).
- **The pathfinder never edits a footprint.** Every record's cells + 1 go into `exclusionAreasBreak` and `exclusionAreasPlace`,
  as treefarm and the well already do, through a spatial index so the A* hot path stays cheap. Build parts are removed from
  scaffolding during visits. Without this, a stray scaffold block gets "fixed" in a loop (Baritone #2173), or a house gets dug
  through.
  - **Scope (Codex r1 P2):** the exclusions go on the WORK and TRAVEL movement profiles. The reflex and escape profiles keep
    survival digs, by authority (TP §8 (a): the reflex's own scope), so an entombed or trapped bot can still dig out. Damage
    is rebuilt on the next visit.
- **structureguard-01** (in the same branch) refuses TARGET digs of recorded cells (mine, gather, the ore tunnel,
  make-room). It carries the four changes TP 2-8 §4.1 lists: composed into the fleet's `planMineStart`, lidclear's
  reserved-cell test first, placement prevention, and plinth-first's re-site reading recorded structures.
- **Bodies:** a cell waits while any entity box touches it or the cell above. `wouldEnclose` refuses a solid placement that
  leaves any body without a cardinal exit.
- **The sealed house** (Claude r1 P2, Codex r1 P2):
  - the door is the last cell. Immediately before its click (after the adapter's last await), the record's INTERIOR cells are
    checked against every entity position, and the click waits while any body is inside;
  - a bot that is ever inside a sealed interior (it walked in through damage) gets a deterministic exit: `exit_house`, a
    reflex-scope step with its OWN trigger in the reflex tick, "the bot's feet are in a recorded house's interior cells and the
    house is sealed", independent of every escape detector (a bot in a house's middle is not `isEntombed`: it has open
    neighbours; Codex r5 P2, Claude r5 P3). It opens the door (`activateBlock`), walks out by direct control and closes it behind it (two cells, no pathfinder, which
    treats any door as an obstacle). If the door is missing, it leaves by the hole it came in;
  - a repair of a sealed house never places a cell that encloses a body (`wouldEnclose` over the interior), so the hole a bot
    came in by is the last cell repaired.
- **Order:** bottom-up per column, nearest-first within a segment, as plinth and the monument do. A cell is placeable when its
  support and its stand exist now.

### 4.5 Composition with the zones and the neighbours

| neighbour | rule |
|---|---|
| protected zones (protectzone-01), showcase villages | never sited, cleared or placed into; the gate refuses a plot meeting a zone |
| keepout-01 (fire columns) | a plot never meets a recorded fire column; a segment stand inside one is refused, as mine's exit is |
| townzone-01 (no-dig zone, ≤ 16) | not met: the bench building plots are outside 16. The showcase storehouse is placement only on READY cells (no dig) |
| plinth wells, the farm, the monument apron, the shaft collar | their records + 1 are occupied for siting (town plan §4.6) |
| lids (lidrule, lidclear) | nothing solid directly above a TOWN container (the showcase storehouse); a bench workshop or house holds no containers |
| found-01 and the workshop strip | found-01's station strip inside 16 stays. workshop@1 is an extra site, not a move |
| `smelt` (milestone), smelt_town | the furnace lease; workshop furnaces are reserved for `make_material` (§3.2) |
| the junk well, prune, cobblekeep | parts are PROTECTED and untargeted (§3.4); claimed inputs are holds (TP 3.3); the carry note is a keep |
| the town floor (townfloor-01) | never fills a plot box (the plan's adopters) |
| the cooperation site chest | a reserved container in the plan's `work` plot inside 16 (cooperation §5.3); every other picker skips it |

### 4.6 Failure and refusal chains: every refusal names the next legal move

The CLAUDE.md composition class. Each row is a chain test through the real CognitiveLoop, plus a Paper scene where marked.

| # | meets | what happens | next legal move |
|---|---|---|---|
| M1 | inputs above the reserve too low | `make_material` not eligible | the bot's other work; the deposit flows refill the town; admission is retried at the next tick |
| M2 | no furnace qualifies (leased, burning, coal in it, foreign contents, lease store down) | a free skip | another qualifying furnace within 16, or the next decision; `furnace_drain` empties foreign contents |
| M3 | interrupted mid-session, or killed | the carry note survives; `mats_return` runs first at the next visit | it reconciles by looking, crafts or banks the stone, closes the note |
| M4 | fewer free slots than the order needs | not eligible | town_deposit first |
| A1 | a blueprint not admitted (whole bill over 80% of spendable) | no project; nothing is claimed | the buffers fill slowly; admission is re-checked every 30 min |
| A2 | copper short | the fallback role block | none needed |
| A3 | glass short (sand) | windows wait 24 h, then become wall cells (`window_shortfall`) | none needed |
| S1 | no site in the frozen-plan proof | `build:no_site` per plot, re-fit daily | the town builds its other plots |
| S2 | the site needs more earthwork, a higher tree stand, or has no legal replant cell | refused at the gate | the next candidate, else S1 |
| C1 | a tree to fell and no sapling in the bag | the clear waits | withdraw saplings from town; other segments go on |
| C2 | a clear cell in a zone or another plot | never planned (the gate refuses it) | — |
| C3 | a dig unconfirmed (ghost risk) | the cell is unknown until a fresh server update; never stood on | the next visit |
| B1 | a cell occupied by a body | waits (at most 2 tries per visit) | another cell in the segment |
| B2 | a foreign block in the volume | scaffold class: cleared; container or station: the segment stalls | stall 72 h -> abandon -> re-site (twice) -> skip (TP 3.2) |
| B3 | no stand, face or sight line now | `no_step`; the segment yields its lease | another segment. A `no_step` on a fresh record is a defect: the proof guaranteed a sequence |
| B4 | the lease is lost (fencing) | stop before the click | the next claim |
| B5 | a bot inside when a closer would enclose it | the closer waits (`wouldEnclose` over every body) | the bot leaves by the doorway; the house door waits for an empty interior |
| B6 | the entombment reflex fires against a wall | survival digs are allowed (reflex profile); damage is rebuilt | exits by the doorway (Paper ENTOMB) |
| B7 | the pathfinder wants a footprint cell | the work and travel exclusions refuse it | it routes around; wall gaps every 12 keep a way through within 6 cells |
| B8 | mine or gather targets a recorded cell | structureguard refuses | mine's walk-off (`exitCell`); gather's search moves on |
| B9 | a bot inside a sealed house | `exit_house` (reflex scope) | out by the door, or the hole it came in by |
| P1 | the segment's parts are not made | `make_material` is eligible (a part is short) | the builder takes another segment, or waits; never a model-advice loop |
| P2 | the segment's materials are in the town but not in the bag (Claude r2 P2) | the BUILD VISIT withdraws its segment's bill itself, from the reserved site chest first when one exists, else from any fresh, known town container under the claim set (TP §5 build job: "withdraw, craft cheap parts, place up to 40, then deposit what is left"); `make_material` deposits CLAIMED parts into the site chest when it exists, else into ordinary town chests | no SUPPLY job is needed for shop-01; cooperation's SUPPLY only adds a second path. Chain test CHAIN-1: an admitted project -> make_material -> parts -> a build visit -> placements, with no other job present |
| G1 | a dig unconfirmed | the resync probe (§4.4), at most 2 per cell per visit | the other segments; the next trip out reloads the chunk |
| D1 | the door would face wrong | predicted before the click; the full-state read-back is the judge | a wrong door is removed by its builder (a fenced yield) and re-placed once, then `door: doorway` |

**If a piece is REVERTED** (TP §8's stated loss): the structures stay in the world, unguarded once structureguard's code is gone;
the footprint exclusions go with the code; sealed houses stay sealed; the parts stay banked (they are ordinary items to the
rollback build, and the junk list change of matset-01 is separate and tier 1). Nothing is lost from a bag: carry notes are
reconciled by the next build that has `mats_return`, and the rollback build simply banks or uses what it finds.

---

## 5. How bots cooperate on a build (the interfaces cooperation-1023 asks for)

- **The unit of work is a SEGMENT** (§4.1), taken after an admission slot. A bot claims the segment's bill from the town's one
  claim set and its build visit withdraws it: from the reserved site chest first when one exists, else from any fresh, known
  town container (§4.6 P2), so shop-01 never depends on cooperation's SUPPLY job. It builds what the world shows open, and returns what is
  left in a `finally`.
- **No bot knows another's plans.** The world and the lease files are the whole protocol, so a crash leaves no orphaned
  coordination state. A segment's lease lapses (TTL 4 min, reclaim after TTL + 60 s), and the next claimant reads the world.
- **What a foreman (role leases) can do:** REORDER which segment a bot prefers. It never names a coordinate, grants a slot or
  bypasses a lease, as both the overseer and cooperation designs already require.
- **The cooperation design's fields, reconciled** (cooperation-1023 r2, kept; the r8 asks A1-A9 answered below):

| it asks | here | reason |
|---|---|---|
| record fields `structure_complete`, `layer_open`, `segments[]` with `cells_open/done/waived`, `material_open`, `lease`; `bom_open` | **adopted** (§4.1) | — |
| admission slots, `builders_max` | **adopted**: slots are also this design's atomic builder cap | Codex r1 P1 |
| `buildEligible` split host / bot | **adopted**, same name | — |
| a `progress` row per witnessed placement; lease rows; a completion event | **adopted** as `_build` / lease / `_structure_complete` rows, detail-string only | no new ES fields |
| a reserved site chest in the plan's `work` plot, skipped by every other picker | **adopted**, inside 16 (a town container the index sees); the workshop itself is at 22-44 | the site chest must be indexed |
| the workshop on ring@1's workshop plot, d ≤ 13 | **not adopted** (cooperation r8 withdrew it): a 9x7 pad is free inside 16 in only 4 of 16 bench towns | measured |
| 2 builders first, a third later as a setting | **adopted**: `builders_max` 2 for shop-01 (§8 C5) | — |
| a layer frontier | `layer` = dependency depth; `layer_open` = the lowest layer with an open claimable segment | — |

**Cooperation r8's asks (its §5.2), answered:**

| # | ask | answer |
|---|---|---|
| A1 | the record generation changes only on transitions, never per placement or renewal | **adopted.** A record generation is written only for a dependency opening, a fallback transition, a waiver or a state change. Counts come from the world. A lease renewal writes the lease's own file, never the record |
| A2 | take from the bag only its surplus above the keep rules | **adopted.** The bag counts toward `buildEligible` and the bill only above every keep: the stockpile and scaffold reserve, `STONE_GUARD` (64 stone), the tool kit, the iron ladder, a note's KEEP |
| A3 | every site-chest mutation holds the site-chest lease; leftovers return to the site chest | **adopted.** `make_material`'s deposit and a build visit's withdraw and `finally` return take cooperation's site-chest lease. When that lease is held by another bot, or the chest is full, the return goes to ordinary town chests (cooperation's open item for B4), never kept as ballast |
| A4 | one `_build_seg` row per build visit: open cells and `material_open` as just read, `found_done`, `found_open` | **adopted**, detail-string fields only |
| A5 | waiver and failed probes | answered in r3 (§4.1) |
| A6 | `builders_max` ≥ 2 for wall@1's segments | **adopted.** Wall segments are independent (no shared cell, stand or support between segments), so `builders_max` is 2 there too |
| A7 | a licence row per spawn | **adopted, under the name `_build_mode`** (cooperation r8 wrote `_shop_mode` or per-blueprint; its B0b should read `_build_mode`): (`phase=mode v=1 blueprints=workshop@1,... builders_max=2 reserve=<sha of BUILD_RESERVE>`), beside `_mats_mode` |
| A8 | `buildEligible` from any fresh container | answered in r4 (§4.1) |
| A9 | an exported spendable function | **adopted:** `spendableFor(project, item, index, claims)` is pure and exported, and the host calls it through node over the town's index file and claim set. It is also what §6.2's draw uses |

**Its open items for shop-01 (its §6.3), answered:** `mats_return` writes its own `by=mats_return` tag on every mutation row, so
cooperation's site-chest defect line can tell the tier's recovery from a foreign job; the exclusion list covers furnace_drain's
deposit target and plain deposit and withdraw (they skip reserved containers); and `make_material`'s furnace opens and loads
write ledger window records and `station` entries once ledger-01 is on the fleet (its B2), so its furnaceseen-01 cannot skip a
furnace this job loaded.

### 5a. Composition with mineshaft-safety r10 (APPROVED, 8bffc295)

| mineshaft piece | meets | rule |
|---|---|---|
| F6 `deepstair-01`'s protected envelope (both lanes and the shell, inside a 10x10 spiral footprint near town; a structure in world facts) | building siting | the deep stair's footprint + 8 is a reservation for every plot, like M0's collar: a plot never meets it (this design reads the stair's world-facts record). **An ask of mineshaft's D0 siting** (its doc does not say it): a deep-stair site never meets a recorded plot. Its envelope guard refuses EVERY dig and place there, survival included; this design's records keep TP §8's rule (target digs refused, survival digs allowed, damage rebuilt). The two guards cover disjoint cells |
| F2 `tombexit-01` (the entombment arm fires only if `isEntombed` AND the bot cannot walk back to where it was just free) | `exit_house` (§4.4) | F2 NARROWS entombment: a bot in a house's middle is not `isEntombed` at all (open neighbours), so no escape rung would ever fire for it. `exit_house` therefore has its own trigger (feet in a recorded sealed interior), independent of the escape ladder, and runs before it. Against a wall, inside a closed house, F2's arm can still fire; `exit_house` is checked first in the same tick, so the bot leaves by the door rather than digging. It never overlaps F6's rung 0 `use_stair` (a house interior is never a stair lane). HOUSE-SEAL starts a bot in the middle of a closed house with `isEntombed` false |
| F1 `lavastep-01` (a verified bounded move replaces the blind sprint) | builders on terraces and roofs | building is surface work at ≤ 3 blocks of drop in peaceful worlds; F1 only removes a sprint that could take a builder off a roof edge. No change here |
| seal blocks (cooperation r8's open item M-b, raised for mineshaft: "under the building tier's claim set after mats-01"; mineshaft r10 itself says the deep miner withdraws them from town stock and never mentions a claim) | the claim set | **offered, and an ask of `deepminer-01`, open until mineshaft adopts it:** `spendableFor` and the claim set accept a deep miner's seal-block claim, taken before any project counts cobble. Until then the collision is small: cobble's 256 reserve and the 2-miner cap |
| F4 `minelava-01` and structureguard | `mine`'s keep-out | structureguard's record cells join the same `composeKeepOut` the shaft and the farm use; F4's six-face reads are unaffected |

## 6. Ordering and canary plan

### 6.1 The order

| # | piece | tier | needs | what | read: exposure; effect (structure count); gates |
|---|---|---|---|---|---|
| 0 | **structcount** | host script, no canary | — | §2: the daily count + controls + BUILD lines; SC-CTL first | ≥ 3 days of baseline before #3; controls, selftest and mutants every day |
| 1 | **matset-01** | 1 (owner-direct + tripwire) | — | §3.4: sand target, glass off the junk list, parts PROTECTED and untargeted, building stones out of the pathfinder scaffold list, `BUILD_RESERVE` declared | tripwire: 0 well disposals or prunes of any part; sand banked > 0 in 24 h; gather and rung rates within the null |
| 2 | **mats-01** | 3 (r2: allocation, withdrawals, furnace policy and recovery are not a small fix) | 1; townindex-01 (KEPT) | §3.2-3.3, buffers only (no project yet) | exposure ≥ 20 parts made with exact conservation, fuel booked by name. REVERT: any forbidden input consumed (coal burned included); the reserve crossed (index); a stone count in a bag that rose across an order with no open note. No-harm DiD: rung completions, gather, smelt `furnace_busy`, bag fill |
| 3 | **shop-01** | 3 | 2; **townplan-01 and found-01 KEPT** (not yet: their JIT re-variants come after chatgate-01); the composed P0 gate first (§4.3); builder.mjs + structureguard-01 (carried here, rebased, with TP 2-8 §4.1's four changes) | §4: the record, slots and segments (2 builders), workshop@1 (bench) and storehouse@ring (greenfield), B4 clearing and durable replant | **effect:** B5 buildings complete in canary towns (structcount at a read-time copy), control = 0 by construction. Exposure ≥ 1 PERSISTENT workshop (§2.5: a first observation, then a clean survey ≥ 1 h later) in ≥ 2 canary towns, conformance F1 ≥ 0.98 (name and state). REVERT: an off-record placement; a clear outside the clear list or a plot; any zone cell touched; two leases live on one segment or more holders than slots; builder bag delta ≠ confirmed placements + scaffold; a felling with no planted replant; an unconfirmed dig stood on. No-harm DiD: deaths (two-death floor), immobile bot-h, gather and rung, litter cells added |
| 4 | **house-01** | 3 | 3 KEPT; houses' composed P0 gate (5 pads per town) | house plots + house@1 + the sealed-door rule + `exit_house` | exposure ≥ 3 PERSISTENT houses in each canary town; REVERT also on a body inside a sealed interior at a door click |
| 5 | **paths-01** | 3 | 3 | the town plan's paths + torches | the plan's gates; lit path cells (structcount) |
| 6 | **wall-01** | 3 | 3, 5 | wall@1 segments | REVERT: any segment longer than 12 without a gap; immobile DiD near the wall line |
| 7 | **storehouse-01b** | 3 | 3 KEPT; owner Q1 | hive-a/b only: the real storehouse building at the O3(b) pad, town storage widened to include it | the town plan's storehouse gates + every town-container test re-run |

**The one canary lane, with mineshaft-safety's order** (F1 -> F2 -> F5a -> F4 -> F5b -> F6 + deep miner): matset-01 is tier 1
and takes no slot, and structcount is a host script. mats-01 needs nothing from the mineshaft pieces; shop-01 waits for
townplan-01 and found-01 anyway. The recommended interleave is owner question Q11: **F1, F2, then mats-01, F5a, then shop-01
when its prerequisites are KEPT, then F4.** The underground-safety fixes are small and cut deaths (the owner's "survive"),
and the building pieces are not blocked by them.

### 6.2 Draws, exposure and reads

- **The pool must hold the population the fix targets** (CLAUDE.md). shop-01 draws **at least 2** canary pools. A pool
  qualifies AT DRAW TIME (Codex r4 P2) only when the workshop allocates from the town's own index (fresh, known entries minus
  outstanding claims, by the exported `spendableFor`, A9) and the frozen-plan proof has a site. The census funding and the
  screen above are PROVISIONAL: they say which towns to expect (3 of 13 today: board-d, isolated-b, placebo-a), not which
  qualify. With 3, a 2-pool draw is possible and a 4-pool draw waits for stock and sites.
- **Expected time:** 167 placements at 1.14 s is ≈ 3 min of clicks. With TP's 3-5x production overhead, the material jobs
  (8 sessions ≈ 16 furnace-minutes on 1 furnace) and the clearing, that is a few bot-hours per town.
- **Reads:** +360, extended to +720 / +1080 / +1440 until the exposure is met. Deadline: INCONCLUSIVE. Each read copies the
  canary and control towns' region files at read time (§2.5's qualifying rule).
- **No piece is tier 2.** If a later narrowing makes one tier 2, it keeps every CLAUDE.md tier-2 condition: exactly 4 pools,
  ≥ 48 bot-h, a declared exposure met, no WATCH or HOLD, a licence that is not `rate`, a death rate no higher than control's,
  a clean baseline, and pools whose tier-2 predecessor closed ≥ 240 min earlier.
- **The effect is a demonstration on 2-4 towns, labelled as one** (TP §7). Causal claims come only from the DiD no-harm rows.
  A building is binary per town, so the read reports per-town completion, never a rate across towns.
- **Deaths stay tripwires** (two-death floor). Building work is surface work at ≤ 3 blocks of drop, peaceful.

### 6.3 Risks

| risk | where | guard |
|---|---|---|
| the roof sequence fails on real terrain | shop-01 | Paper on terrain fixtures cut from region copies (board-a, hive-c) before launch, as TP stage 3 requires |
| the pathfinder digs through or scaffolds into a footprint | all | work/travel exclusions (§4.4); Paper BYSTANDER and SCAFFOLD scenes |
| ghost blocks from clears | shop-01 B4 | packet confirmation; no digs in the 3 s after a spawn; fresh-update re-reads |
| towns short of logs (hive-b, hive-d) never build | shop-01 | reported by name; the reserve is a setting (owner Q6) |
| body time displaces gathering | mats-01, shop-01 | the 10 min per bot-hour budget; DiD on gather and rung |
| tree clearing strips the jungle towns | shop-01 | replant first and durable; the gate's tree-height rule |
| the prerequisites slip (townplan-01, found-01 unkept) | shop-01, house-01 | matset-01 and mats-01 do not need them and can run first |
| one canary lane, many pieces | all | matset-01 is tier 1 and can go in a gap |

---

## 7. Paper scenes (the sandbox, the real bot, RCON as the oracle; sandbox 1 also has CoreProtect)

| scene | piece | must show |
|---|---|---|
| SC-CTL | structcount | on sandbox 1: a bot-built workshop, a house, a scaffold pillar, a plinth, a bot block inside a padded worldgen box and one on a stamp cell. The count gives exactly 2 buildings, the structures and litter, and F1 = 1.0 for both records. **CoreProtect's placed-and-not-broken set agrees with the BUILT set**, precision and recall reported, with the two masked bot blocks named as known misses and seen in the inside-mask delta |
| MAT-1 | mats-01 | stone bricks, panes, cut copper and a door made, by server bag and chest deltas; 0 iron, coal or kit consumed, with iron and coal present in the same chest and coal in the bag |
| MAT-FURN | mats-01 | furnaces holding coal, foreign iron, and the job's own leftover stone: only the last is used; a remainder in an ordinary town furnace taken by `furnace_drain` |
| MAT-HOT | mats-01 | an EMPTY fuel slot with coal still burning (`lit=true`, burn progress > 0): a free skip, nothing loaded |
| MAT-TRAVEL | mats-01 | a restart with an open note, then a long walk home through terrain that needs scaffold: 0 stone placed (the protected intermediate); any noted cobblestone or planks the pathfinder places are booked from the bot's place rows as a reported loss, and the note's accounting closes exactly (Codex r4 P3) |
| CHAIN-1 | shop-01 | an admitted workshop, no other job running, the builder's bag EMPTY and no site chest: make_material makes the parts into town chests, `buildEligible` is true from the index, a build visit withdraws them and places them, the workshop completes |
| GHOST-RESYNC | shop-01 | a dig the server rejects (made in the first 3 s after spawn), then the probe: the server's block update arrives and the cell is known again; the no-neighbour case yields |
| SHOP-BARRIER | shop-01 | a sender SIGSTOPped after its check holding the mutex; a delivery delayed > 5 s; an expired holder's in-flight click meets a closer; an ordinary click races the barrier take; a click crosses a `trim_shortfall` transition: no enclosure, no stale click accepted |
| MINE-NOTE | mats-01 | a deposit fails with a note naming cobblestone open; the bot goes mining: the exit contract's count matches the movements' placeable blocks and the bot climbs out |
| CUTOFF-* | structcount | §2.5's four: SPLIT (two chunks, scored after the last chunk's save), QUIET (unloaded, never re-saved: scored then surveyed; and a save inside the margin: surveyed twice), DAMAGE (an unrowed dig after the save: scored from the copy, not PERSISTENT after the survey), SLOW (unsaved: UNKNOWN) |
| MAT-KILL | mats-01 | SIGKILL after the withdraw, during the session, and holding 1-3 stone: `mats_return` reconciles; nothing lost or thrown |
| MAT-RES | mats-01 | stock exactly at the reserve: no order; one batch above: one batch |
| SHOP-FLAT / SHOP-TOWN | shop-01 | the whole workshop on flat ground and on two dug-out fixtures; every cell read in family |
| SHOP-CLEAR | shop-01 | a plot with 2 trees and a 3-high hill: saplings planted first at reserved cells, then the clear; no cell outside the clear list touched; a site with a tree too tall is refused |
| SHOP-ZONE | shop-01 | a plot candidate meeting a protected zone is never chosen |
| SHOP-KILL | shop-01 | SIGKILL during a clear, a placement, a lease renewal, and between a replant and its felling: resumes from the world, nothing placed twice, no felling without its sapling |
| SHOP-COOP2 | shop-01 | 2 bots on 2 slots and segments: no overlap defect, deps respected; an expired holder's late click refused; two final walls closing at once serialised by the closer token; a click crossing a `trim_shortfall` transition judged by its token's generation |
| HOUSE-SEAL | house-01 | a bot started in the MIDDLE of a closed house (`isEntombed` false) leaves by `exit_house` on its own trigger; the door last from outside; a bot in the interior delays it; a door facing wrong is re-placed once, then doorway; a bot let in through a hole leaves by `exit_house`; the repair waits until it is out |
| ENTOMB | shop-01, house-01 | the entombment reflex against a wall exits by the doorway, or digs out on the reflex profile |
| WALL-GAP | wall-01 | a bot 30 out walks home through a gap within 6 cells, 0 digs of wall cells |

---

## 8. Where the owner's answers meet the evidence or an earlier decision (named, not silently picked)

- **C1. B1 ("a workshop/storehouse first") and decision 6 ("a real storehouse only in hive-a/b").**
  - Measured: a 9x9 storehouse pad fits inside the 16 circle in 0 of 16 bench towns (town plan §1.6). A storehouse outside 16
    widens "town storage", which touches every town-container test (tier 3 on its own).
  - Reconciled: the first shared building is the WORKSHOP in every bench town, hive-a/b included. The showcase's is the
    greenfield STOREHOUSE shell (inside 16 by design). hive-a/b's real storehouse follows as storehouse-01b.
  - **Owner (Q1):** confirm, or make hive-a/b's first building the storehouse and accept the wider change first.
- **C2. B5 ("a door") and the bots' pathfinding.** mineflayer-pathfinder ships `canOpenDoors = false` ("Causes issues"), and
  the fleet never enables it. A door block is an obstacle: a bot inside a closed building cannot path out, and the pathfinder
  may dig the door.
  - Designed: the workshop has an open doorway, and the count's door test accepts a 1x2 doorway or a door block. Houses get a
    real copper door, placed LAST from outside, and **are never entered again**: bots cannot use their own houses. A bot that
    gets in through damage leaves by `exit_house`.
  - **Owner (Q2):** does a doorway count as "a door" for the shared building, and are unenterable houses acceptable? Or should
    real doors wait for a door-opening movement change proven on Paper?
- **C3. B3 ("never coal") and lit paths.**
  - Torches need coal or charcoal, and D4 (10-15) said no charcoal yet. Buildings need 2 torches (workshop) and 1 per house.
    The town torch stock (64 per town in the stamp's torch chest, a 32 reserve) plus the 686 torches in 71 bags covers them.
  - Paths need 20-60 torches per town and the wall ≈ 46 more; the stock does not cover that without coal or charcoal.
  - **Owner (Q3):** allow charcoal from surplus logs for torches (a `make_material` part), or light paths only to the stock.
- **C4. B6: "same code as the fleet" and "built first" cannot both hold** (Codex r1 P2: r1 presented a promotion-first
  reading as if it satisfied B6; it does not).
  - Same code as the fleet means the showcase runs a sha only after the fleet does. Built first means the showcase builds
    before the fleet. A building piece reaches the fleet only through its canary and promotion, so with the same code the
    bench always builds first.
  - Also, the showcase has not started (its start gate waits on the town plan's pieces), and it never draws canaries.
  - **Two honest options:**
    - **(a) Showcase-first, a requested change to "kept builds only"** (gated: Paper + both reviews first, and on the showcase a
      daily structcount tripwire read of its own: conformance, zone cells touched, deaths, immobile bot-h; any defect pins the
      showcase back to the fleet sha): the showcase runs each building piece's CANDIDATE sha
      right after its Paper scenes and both reviews, before or alongside the bench canary of the same sha. It is then the
      piece's first exposure (and the only one for the greenfield storehouse shell, which no bench town can expose). A bench
      REVERT pins the showcase back to the fleet sha; what it built stays (the stated loss).
    - **(b) Fleet-first, same code:** the showcase takes each piece at promotion, with the 24 h follower lag waived for
      building pieces. B6's "built first" gives way.
  - **Owner (Q4):** which. Recommendation: (a), because the greenfield storehouse can only be exposed there, and B6 asks for
    it.
- **C5. The cooperation decision and TP's "one builder, never a second".**
  - If shop-01 builds workshops solo, its KEEP auto-promotes, and within a day every town has one. The cooperation design's
    first project (bots building the workshop together) would be gone.
  - Designed: slots, segments and `builders_max` from the start. shop-01 ships at **2**, cooperation-1023's own first-canary
    number (its VillagerBench evidence), with the SHOP-COOP2 scene and the overlap defect gates. A third builder is a later
    setting once the 2-builder run is read.
  - **Owner (Q5)** and the cooperation design: 2 in shop-01, or 1 and another first multi-bot project.
- **C6. B2 (planks) and the TP pavilion (log walls).** Taken as B2: planks. The TP plan is superseded on that point.
- **C7. TP D2 / town plan O8 (no projects in isolated worlds) and the denominators.** r1 counted isolated-a, c and d as
  eligible. They keep per-bot town state, so five bots there would run the job and the builder with no shared lease. They
  are out. isolated-b has been a shared town since 10-21 and is in: 13 eligible towns.
- **C8. The brief: "300 successful place actions are crafting tables, torches and wells".** Measured, they are 274 saplings,
  23 tables, 7 dirt and 1 granite; torches 0. It changes nothing in the design.
- **C9. CLAUDE.md "no new analysis while a canary is deployed and unread".** indexsearch-01 is live (12:17Z). This work was
  commissioned by the owner after the deploy, did not read or touch the canary, and ran nice'd on copies.

---

## 9. Prior art (searched 10-23: web, repositories, their issue trackers)

| source | what it does | borrow | leave |
|---|---|---|---|
| **Baritone BuilderProcess** (LGPL-3.0, Java; ideas only) | rescans the world each tick; places what is placeable NOW; `buildInLayers`; simulates `getStateForPlacement` before clicking; `buildIgnoreDirection` for stair shapes | progress = the world; place-what-is-placeable; **predict the state, then verify**; ignore neighbour-set shape properties | the code. Its issues: #2173 (place/break loop on its own scaffold: "tag your scaffold"), #822 (no temporary support), #4586 (loops; a maintainer calls the builder "not very good"), #4455 (directional blocks), #3995 (latency, falls) |
| **mineflayer-builder** (PrismarineJS, MIT; README: "not an usable package yet", creative mode) | y/z/x order, the nearest available action; a property-to-face filter (`getPossibleDirections`), an inverted-facing table, sneak on interactables; diffs full state ids | the face filter and the full-state diff | the creative inventory; error swallowing (it drops an action whether or not it succeeded). Issues #6 (null boundingBox), #5, #10 |
| **prismarine-schematic** (MIT) | Sponge v1-3 / MCEdit | a later importer, converted once into our own `{pos, state}` list | open **#82**: 1.21 int-typed properties mis-decoded (a pane round-trips as a repeater). A round-trip test against minecraft-data 1.21.8 before trusting any loaded file |
| **Voyager** (MIT) | `placeItem` counts success by the item count dropping; buildings only with human feedback | — | inventory delta as proof (memory "intent rows are not outcomes") |
| **Mindcraft / MineCollab** (MIT) | blueprints by level; score = matches / (matches + mismatches), name-only; best ≈ 36%; agents demolish each other's work and lose track past ≈ 20 steps; survival placeBlock has no orientation control and no read-back; #780 "No real house ever been build"; #462 survival schematic builder closed | the denominator rule (air-air skipped, filled record-air counts against) | name-only scoring; LLM-held geometry |
| **Project Sid** (Altera 2024) | the specialisation prompts forbid building ("You CANNOT BUILD"); names spatial reasoning as the limit | keep the model out of geometry: code builds, the model (later the foreman) chooses what | — |
| **IGLU** (AGPL, gridworld) | F1 between the build and the target, maximised over shifts and rotations | F1 at a FIXED origin (records are anchored) | the alignment search |
| **mineflayer** `place_block.js` | waits up to 5 s for `blockUpdate`; success = the TYPE changed | — | type-only success: a wrong-facing door "succeeds"; we read full state from the packet |
| **mineflayer-pathfinder** (MIT) | `exclusionAreasBreak` / `Place`, `canOpenDoors` (default false), scaffolding blocks; issues #296 (scaffold placement failures), #181 (placing mid-fall), #78 (falling blocks) | exclusion areas over every footprint; doors stay out of v1 paths (C2) | — |
| **GDMC / GDPC** | settlement generators that edit the world directly | layout ideas only (the town plan already took them) | everything that places by world edit |

Mechanics checked: stair and slab state comes from the face and cursor; a door needs two cells and a solid face below, with the
hinge from neighbours; a wall torch faces away from its support; stone bricks come from a 2x2 craft (no stonecutter needed);
reach is 4.5 plus a server leniency, so 4.5 to the face centre from the eye is the design's rule.

Unverified: the exact vanilla reach geometry, and whether a torch attaches to a glass side. Paper scenes settle both before any
blueprint relies on them.

The full search notes, with URLs, are in the reviews file, round 0.

---

## 10. Open owner decisions

| # | decision | recommendation |
|---|---|---|
| **Q1** (C1) | the first shared building in hive-a/b: the workshop as everywhere, with the real storehouse after; or the storehouse first, with the town-storage widening it needs | **workshop first, storehouse-01b after shop-01 KEEP** |
| **Q2** (C2) | a 1x2 open doorway counts as B5's "door" on the shared building (bots must walk in and out); houses get real copper doors placed last and are then never entered by bots | **yes to both**. Real doors on working buildings only after a Paper-proven door-opening change |
| **Q3** (C3) | charcoal from surplus logs, for torches only (paths need 20-60 a town, the wall ≈ 46) | **yes**, as a `make_material` part, reserve-bounded |
| **Q4** (C4) | B6's two halves conflict: (a) showcase-first on each building piece's candidate sha after Paper and both reviews (a change to "kept builds only"), or (b) fleet-first at promotion with the follower lag waived | **(a)**: the greenfield storehouse can only be exposed on the showcase, and B6 asks for the showcase first |
| **Q5** (C5) | shop-01 ships with 2 builders, so the workshop is the first multi-bot project (cooperation-1023's number) | **yes, 2**, with SHOP-COOP2 and the overlap gates; 3 later as a setting |
| **Q6** (B3) | the reserve defaults: cobble 256, logs 512, planks 64, sticks 64, copper ingots 256, sand 16, torches 32. hive-b and hive-d are log-short at 512 | **as listed**; revisit hive-b/d after a week of the BUILD line |
| **Q7** | the wall: 2-high segments of ≤ 12 with 2-cell gaps on the straight-line-44 circle (bots range a median 57 blocks from home, so a closed ring would be crossed by digging) | **gaps every 12** |
| **Q8** | carrying structcount's daily file (and the chest census) from 10.0.0.30 to goalboard on 10.0.0.31: a forced-command key, or a copy from the controller | **a forced-command key on .30 that only cats the two newest files** |
| **Q10** (B1 step 2) | where the houses go: the greedy screen packed five 7x7 house plots inside straight-line 40 in no town, and within straight-line 60 in 4 of the 5 towns with a workshop candidate (a greedy failure is not a proof). Houses hold no containers or furnaces, so nothing ties them to the 48-block town radius | **straight-line 22-60** for houses; the town wall (if any) then runs outside them or the houses sit outside it (Q7) |
| **Q11** (§6.1) | the order in the one canary lane between the building pieces and mineshaft-safety's F1-F6 | **F1, F2, mats-01, F5a, shop-01 (once townplan-01 and found-01 are KEPT), F4**, then the rest of each list; matset-01 (tier 1) in any gap |
| **Q9** | CoreProtect on the fleet servers, for attribution by player | **no**. The region read with its controls is the fleet-wide estimate, the records are the evidence for the tier's own work, and SC-CTL validates both against CoreProtect on sandbox 1 |

---

## 11. Reviews

Rounds are recorded in `docs/reports/building-tier-reviews-2026-10-23.txt`.
- **Round 0:** the prior-art search (§9).
- **Round 1 (r1):** Codex CHANGE (8 P1, 9 P2); Claude CHANGE (10 P2, P3s). Both engines found the same core problems, from
  different directions: the building count could change with incidental connections and a buried-component gate; "lit" did not
  mean lit; the negative controls could pass for the wrong reason (edge chunks, never-ticked fluids, masks tuned on the same
  village); parts as stock targets reach the well; the job could burn coal; isolated worlds were counted; the outer band was
  Chebyshev. Codex also: admission reversed; attribution overclaimed; fencing per record, not per acquisition; daily snapshots
  cannot serve +360 reads; the plinth control matched any palette block; B6 misread. Claude also: the cooperation interface was
  not reconciled; tall trees and replant could force a REVERT; the sealed house was a trap.
  - Addressed in r2:
    - **the instrument, rerun:** rooms searched in every component, buildings counted per distinct room; lit by block STATE
      inside the room or its ring; 9 known-answer fixtures and 3 anchored mutants (all killed); negctl on `full` chunks only,
      status histograms printed; mask coverage measured (0 surface-reaching mask columns in any bench town; underground
      mineshafts and trial chambers only), padding-only cells and surface fluid-touching cobble reported; two HELD-OUT villages
      (a second taiga, a snowy) scored; the plinth control by material family on `complete` records, with the unbuilt record
      as its negative (§0, §2);
    - **attribution stated as an estimate**, records as the evidence, an inside-mask delta, SC-CTL against CoreProtect (§2.2);
    - **validity:** completion markers, snapshot times, unknown-cell exclusion, atomic publication, read-time copies for
      canary reads (§2.5);
    - **materials:** exact batches and bills, TP's admission rule, qualifying furnaces with an acquired lease and plank-only
      fuel, fuel booked by name, durable carry notes and `mats_return`, parts PROTECTED and untargeted, isolated worlds out,
      mats-01 tier 3 (§3);
    - **structures:** admission slots, a fresh epoch per lease, the closer token, fallback transitions by the closer holder; the
      cooperation fields adopted or rejected with reasons; one outer domain on straight-line 44; the composed P0 gate;
      tree-height siting, replant planted first and durable; reflex-scope exclusions; `exit_house` and repair that never
      encloses; the revert story (§4, §5);
    - **ordering:** prerequisites marked unmet, ≥ 2 pools for shop-01, the tier-2 conditions restated, B6 put as a choice (§6,
      §8 C4).
- **Round 2 (r2, commit 27980d4e):** Codex CHANGE (5 P1, 5 P2: of its 17 r1 findings, 9 fixed and 7 partly fixed); Claude
  CHANGE (one new P2; 9 of its 10 r1 P2s verified fixed in code and data).
  - The P1s: redstone torches lit regardless of state and a roof of torches still roofed; a plain `cp` resets the mtime the
    freshness rule used; funding still ignored sand, pooled cobble kinds and priced the wrong fallback; an empty fuel slot can
    hide a burning furnace; the closer's settlement did not cover an expired holder's in-flight click. The P2s: failed
    controls did not stop the run; the plinth control matched by size, not identity; carried stone could be spent as
    scaffold on restart travel; the composed site proof had not run; ghost recovery was waiting, not recovery. Claude's P2: the
    builder had no way to get its materials without cooperation's SUPPLY job.
  - Addressed in r3:
    - **the instrument, rerun:** state-aware redstone lights; a structural roof predicate; ring lights only when the ring
      cell is wall; `plinth_check` by component identity, a pure function with its own five fixtures; 17 fixtures and 8
      mutants, both exiting nonzero on any failure; the held-out villages scanned as towns (0 BUILT cells); village counts
      re-scored under the stricter rules (21 rooms, 20 B5, of 39 houses; 0 in 364 non-house pieces) (§0, §2);
    - **freshness per chunk** from the region header's timestamp table, against placement rows; `cp -p` and source mtimes;
      no RCON (§2.5);
    - **funding from the cells** with chosen fallbacks, per-species planks, cobblestone alone, sand in admission, a parts
      pool and leftovers; 11 of 13 workshops, 42 of 65 houses (§3.3);
    - **a cold furnace** (`lit=false` and burn progress 0), MAT-HOT; **carry protection from spawn** (noted items out of the
      scaffold list), remainders kept under the note, building stones out of `PATHFINDER_SCAFFOLD` (§3.2, §3.4);
    - **a project-wide mutation barrier** with durable pre-send intents, reconciled for expired holders (§4.1);
    - **the build visit withdraws its own bill** (site chest first), CHAIN-1 (§4.6 P2, §5);
    - **the resync probe** for unconfirmed digs, GHOST-RESYNC (§4.4);
    - the composed P0 gate as shop-01's first step; every stand cell checked in fitb; whole trees reachable; houses at
      Chebyshev ≥ 22; the waiver rule; exit_house closes the door; the showcase's own tripwire read under C4(a).
- **Round 3 (r3, commit 7689a028):** Codex CHANGE (4 P1, 3 P2; its r2 #1, #3, #6, #7, #10 fixed); Claude CHANGE (one new P2;
  its r2 P2 and every r2 P3 verified fixed, by running selftest and mutants).
  - The P1s: the per-chunk freshness rule missed destructive changes with no `_build` row; funding still let birch planks pay
    for oak walls, bypassed the 80% cap on banked planks and never used banked cut copper or panes; funding summed the whole
    census box, not town storage; a sender could pass its barrier check and send after the barrier was taken. The P2s: the
    publication wrapper was not shown to refuse; the composed P0 proof had not run; `buildEligible` still required the bag or
    the site chest. Claude's P2: removing a noted base type (cobblestone, planks) from the type-level scaffold list would leave
    the pathfinder unable to climb while the exit contract still counted the blocks.
  - Addressed in r4:
    - **a read CUTOFF** two autosave passes before the copy (autosave measured at 5 min, unthrottled), with evidence per region
      that the autosave ran, so every mutation source is covered and a later change is outside the read (§2.5, CUTOFF scene);
    - **funding r4:** an allocation over town storage only (straight-line 16, 12 vertical), every pool clamped and every draw
      within 80%, species kept, parts first, five fixtures (all pass): 10 of 13 workshops, 26 of 65 houses (§3.3);
    - **one kernel mutex** (`flock`) around every final check and send, intent before check, `cancelled` intents, and unsettled
      intents released only on the sender's settlement or its disconnect; SIGSTOP and delayed-delivery scenes (§4.1);
    - **the wrapper** `daily.sh` exercised: shipped instrument publishes; a broken one publishes nothing, exits 3, status
      UNKNOWN (§2.6, `data/daily-wrapper-demo.txt`);
    - **the composed P0 screen run** (`fitc.py`): 8 of 13 eligible towns have a qualified workshop site, 5 of 13 are both
      funded and sited; five houses fit within 40 in no town and within 60 everywhere sited, so owner Q10 (§4.3);
    - `buildEligible` from the index; CHAIN-1 with an empty bag and no site chest (§4.1, §7);
    - **only `stone` leaves the scaffold list** under a note; base types stay scaffold and a spend is a reported loss;
      MINE-NOTE (§3.2);
    - Claude's P3s: intent-then-check order and `cancelled`; the resync probe with an empty hotbar slot or the pickaxe, never
      an axe, shovel or hoe, never an interactable neighbour; one clock (copies on the servers' host); cold town furnaces
      counted from the region copies (34 of 35 qualify today).
- **Round 4 (r4, commit 0514d3b1):** **Claude APPROVE** (0 P1, 0 P2; P3s: a non-blocking lock, the wrapper's instrument path
  and cell list, the 60-band houses' walk). Codex CHANGE (2 P1, 3 P2, 2 P3): a copy is not "the world as of a cutoff"
  (saves are per dirty chunk and tick-timed); funding still crafted fractional logs and ignored banked intermediates; the
  census proxy still qualified the draw; a fresh read could settle a delayed click before it arrived; the wrapper published
  a scan with missing regions. P3s: call the screen's results candidates; MAT-TRAVEL contradicted the carry policy.
  - Addressed in r5 (also reconciled with mineshaft-safety r10 and cooperation r8):
    - **per-record observation intervals** from the chunks' own save times, `UNKNOWN: not yet saved`, and exposure counted by
      PERSISTENCE across two reads (§2.5, CUTOFF scenes);
    - **funding r5:** integral crafts, intermediates (banked stone, glass, copper blocks) before raw, full rollback of a failed
      role, leftovers reused; ten fixtures including Codex's 523-log case; PROVISIONAL, with the draw qualified from the index
      by `spendableFor` (§3.3, §6.2);
    - **settlement by the server's acknowledgement** of each click's sequence number, release only by acknowledgement or
      connection retirement; a non-blocking mutex; the delayed-click scene (§4.1);
    - **the wrapper r5** validates coverage and controls, publishes the cell list atomically, and refuses five ways
      (`data/daily-wrapper-demo.txt`);
    - the screen relabelled as candidates, re-run with a two-way walk: 5 of 13 candidates, 3 funded and screened; houses at 60
      (Q10); MAT-TRAVEL fixed;
    - **cooperation r8:** A1-A4, A6, A7, A9 adopted, its shop-01 open items answered (§5); **mineshaft r10:** the deep stair's
      envelope as a reservation, `exit_house` as a pre-escape rung under F2, seal blocks in the claim set, the lane order (§5a,
      §6.1, Q11).
- **Round 5 (r5, commit 9012b452):** Codex CHANGE (1 P1, 3 P2, 1 P3); Claude CHANGE (1 P2, P3s). Both engines: a record-wide
  "every chunk saved after the newest placement" rule leaves a multi-chunk workshop unscored forever, because quiet chunks are
  not re-saved (about 81% of workshop positions span chunks). Codex also: a second copy cannot prove persistence; the wrapper's
  renames were separate; a central house occupant is not `isEntombed`, so `exit_house` needs its own trigger; mixed banked
  glass and sand made a batch the job does not run; two stale texts. Claude also: M-b and the deep-stair siting are asks of
  mineshaft, not adopted by it; F2 was described backwards; a clock margin; tell cooperation the licence row's name.
  - Addressed in r6: per-chunk watermarks with a 5 s cross-host margin; persistence by a live `survey` order, not a second copy;
    four CUTOFF scenes (§2.5); a manifest-published wrapper and reader with nine demonstrations (§2.6); `exit_house` on its own
    trigger, HOUSE-SEAL from the middle (§4.4, §5a); whole glass batches with two fixtures (§3.3); the stale texts; §5a's asks
    to mineshaft marked as asks; `_build_mode` named for cooperation's B0b.
- **Round 6 (r6, commit 65aafa41):** **Claude APPROVE** (one P3: the survey's 10 s skip window). Codex CHANGE (3 P2): a final
  save inside the 5 s margin strands a quiet building, since persistence required a scored copy first; a failed same-day retry
  (manifest replacement, unwritable directory) left an earlier same-day OK readable as current; an UNKNOWN manifest dropped the
  stamp control's baseline.
  - Addressed in r7: an observation is a scored copy OR a clean survey, and two observations an hour apart make a building
    PERSISTENT (CUTOFF-QUIET extended); the survey skips the bot's own unconfirmed-dig set and probes a cell before calling it
    missing; the wrapper records its attempt first in a separate directory, the reader requires the manifest's attempt to be
    the newest, and `last_good` is carried through UNKNOWN runs with its hash; nine demonstrations, both failures from a
    same-day OK and the depleted-stamp retry.
- **Round 7 (r7, commit f60ab0c1): Codex APPROVE, Claude APPROVE.** No P1 or P2 remains. Their P3s, applied after approval as
  r7.1: one persistence rule stated everywhere (first observation = a scored copy or a clean survey; second = a clean survey
  ≥ 1 h later); the wrapper serialised by a non-blocking host lock with unique attempt ids and temporary names, and an
  overlapping-run fixture before cron; the reader says RUNNING for a fresh attempt with no manifest.

---

## OWNER ANSWERS (2026-10-23, in chat)

Q1 yes (workshop first in hive-a/b; storehouse after shop-01 KEPT). Q2 "yes thats fine" (open doorway = a door; houses with a
copper door placed last from outside). Q3 yes (charcoal from surplus logs, torches only). Q4 yes (showcase gets each piece first,
gated by Paper + a showcase tripwire read). Q5 yes (2 builders). **Q6 "lets do 512 for each": the BUILD_RESERVE is 512 for every
reserved item** (replaces the design's 256/512/256... defaults; still a setting). Q7 yes (wall gaps every 12 blocks). Q8 yes
(restricted read-only ssh key on 10.0.0.30). Q9 yes (no CoreProtect). Q10 yes (houses 22-60 blocks out). Q11 yes (lane order
lavastep-01, tombexit-01, mats-01, lavatarget-01, shop-01, minelava-01; matset-01 in any gap).
