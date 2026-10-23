# The building tier: count what is built, make the materials, build from plans (design only, r1, 2026-10-23)

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
- 408,372 placed-palette cells persist within 96 blocks of the 16 homes. 93.5% of them are cobblestone.
- They group into 6,276 structures of 12 or more cells: 1,533 at the surface, 4,743 buried. 178,035 cells are "litter" in
  smaller groups.
- There are **0 buildings (B5).** One unlit room was found, which B5 classifies as a structure.
- In the 74 h from 10-20 12:12Z to 10-23 ~14:30Z, within 48 of home: +31,057 cells and -7,274 cells, about +7,700 net a
  day. 96.6% of the added cells are cobblestone: pathfinder scaffold, mine stairs and backfill.
- The rows agree that no build happens: 0 `build` rows in 24 h, with `place` (336 rows) and 1.54 M documents as the positive
  control.
- **Correction to the brief:** of the 305 successful `place` actions, 274 placed saplings, 23 crafting tables, 7 dirt and 1
  granite. Torches: 0 successes (4 failures). Wells are not built through `place` at all.

**2. The instrument passes its controls.**

| control | what | result |
|---|---|---|
| positive | the operator's town stamp (place-town.py: 207 cells per town) | 2,940 of 3,312 found (88.8%), detected and masked. The rest were dug by bots since |
| positive | 10 complete plinth wells (the bots' own records) | 535 of 591 placed cells found (90.5%), each well as ONE component. All 56 misses are andesite, diorite or granite, which the plinth may place (`PLINTH_BLOCKS`) and the palette cannot see (§2.7). 0 of 10 called a building. An unbuilt record (state `plan`) finds 0 |
| positive | the showcase village, scored against its own piece list | of 8 house pieces: 7 have a room, 6 are B5 buildings (lit). 0 rooms in 84 non-house pieces (streets 40, terminators 22, decorations, the centre) |
| negative | the showcase world: no bot has ever joined (`usercache` holds only the owner's spectator; 0 player files) | 0 built cells in a 385 x 385 box. All 20,627 palette cells there are inside 995 generated pieces or 19 dungeons. 0 structures, 0 rooms, 0 dirt paths |
| negative | chunks no player ever ticked (InhabitedTime 0): 120 per bench world and 150 on the showcase | 0 surface false positives in 2,070 chunks; 652 buried ones (mineshaft wood and dungeon fringe). So buried structures are reported, never scored |

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
- one deterministic job, `make_material`. It runs at the workshop, makes only what an admitted blueprint still needs (or a
  small buffer), and spends only what is above the reserve.

Its fuel is **planks**: 1 log makes 4 planks, which smelt 6 items. That respects B3 (never coal) and the 10-15 "no charcoal"
decision (D4).

**4. Structures (§4).** One generic, fenced placement builder: builder.mjs, built and Paper-proven 10-15 and never shipped.
Blueprints are JSON, built from the world (progress is what the world shows), split into claimable SEGMENTS. In B1 order:
- **workshop@1** is the shared building: 7x5 shell, stone-brick pad and step ring, plank walls, glass-pane windows, plank roof
  with a cut-copper trim ring, two torches, a table and two furnaces inside, and an open doorway.
  - A 9x7 pad fits inside the 16 circle in 4 of 16 bench towns, at Chebyshev 17-30 in 13, and at 22-44 in 16 (§4.3).
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
| 2 | `mats-01` | tier 2 |
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
- the showcase's "built first" versus "only kept code";
- whether shop-01 is solo or multi-builder (cooperation's first project would otherwise already be built);
- the reserve's numbers;
- the wall's gaps.

---

## 1. What was measured (denominators first)

### 1.1 Rows, 24 h to 10-23 14:00Z (ES; 1,540,540 skill documents, 80 bots, one rotation crossed)

| kind | rows | success | note |
|---|---:|---:|---|
| `build` | **0** | 0 | the brain's single-bot verb (skills.mjs `build`, `BLUEPRINTS`): never chosen |
| `place` | 336 | 305 | oak_sapling 269, birch_sapling 5, crafting_table 23, dirt 7, granite 1. torch 0 of 4. 20 crafting tables failed "placing exceeded 3000ms" |
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
| isolated-a..d | 32,119-37,306 each | ~13,000 each | 113-129 / 341-393 | 0 | 181-183 | 63/56, (k=0), 64/64, 66/66 |
| placebo-a | 26,248 | 11,804 | 46 / 393 | 0 | 170 | (natural well) |
| placebo-b | 16,110 | 9,348 | 86 / 166 | 0 | 183 | 16 / 0 (unbuilt: state `plan`) |
| placebo-c | 24,023 | 10,742 | 117 / 258 | 0 | 173 | 80 / 64 / 64 |
| placebo-d | 23,924 | 11,609 | 97 / 282 | 0 | 189 | (natural well) |

- Every chunk read: 169-185 per world, 0 unreadable.
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

### 2.2 BUILT: a block a bot placed that persists

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

Why "BUILT = a bot placed it" holds in these worlds:
- Nobody else places blocks. There are no players (the owner joins as a spectator), `mobGriefing` is false, and peaceful means
  no endermen.
- Fluids can make cobblestone, but only where lava meets water. The uninhabited-chunk control measures that and finds it
  only underground.

### 2.3 Grouping: litter, structures, surface and buried

- **Structure:** a 26-connected component of BUILT cells with 12 or more cells. Fewer than 12 is **litter**: a lone table, a
  scaffold stub.
- **Buried:** more than 25% of its cells lie below the column's highest NATURAL solid block. It is a mine stair, a tunnel
  lining or backfill. Buried structures are reported, never scored. They are what the negative controls contaminate
  (dungeons, mineshaft fringe).
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

**BUILDING (B5):** a structure with a room that is LIT: a light source in the room or on its ring. **Anything less is a
structure.** Both are counted, as B5 asks. The read also reports "rooms (unlit)" as a separate line.

**Blueprint conformance** (for a structure the bots built from a record; prior art §9: IGLU's F1, Mindcraft's denominator):
- The world is read at every cell of the record at a fixed origin.
- precision = cells in-family / all non-air cells that the record claims or that fill record air; recall = cells in-family /
  record cells; F1 is reported.
- Both a NAME score and a full STATE score (door facing and half, slab half) are reported. mineflayer's own place check is
  type-only (§9).
- Cells where both the record and the world are air are skipped. A record-air cell that has been filled counts against
  precision.
- Families follow TP 3.2: a weathered cut copper cell is in-family for cut copper.

### 2.5 Per town and per day

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

### 2.6 The controls (run 10-23; numbers in §0 item 2; tools `structcount.py.txt` `scan` / `village` / `negctl` / `delta`)

**Every daily run repeats two controls and alarms on them:**
- stamp cells present must not fall by more than 10% in a day;
- the uninhabited-chunk sample (120 chunks per world) must give 0 surface false positives.

**Weekly:** the showcase's pre-start world is fixed as the clean negative control until bots start there, and the village
test re-runs whenever the classifier changes.

**Known false positive, named.** The only room found on the bench (board-b, 76 from home) is a cobble scaffold under a
jungle canopy, whose walls and roof are logs. B5's light rule makes it a structure.
- A lit canopy hollow could still pass. That is why blueprint conformance, not the room test, is what judges the bots' own
  buildings.
- Raising the bar for BUILT roofs would also fail the village control: 14-50% of village roof cells are BUILT, the rest are
  logs.

### 2.7 What it cannot see, and the rule that follows

- **Natural-kind placements are invisible.** The plinth control misses exactly these: 56 of 591 cells were andesite, diorite
  or granite.
  - **Rule:** every blueprint material is in BUILT. A structural test asserts it for every enabled blueprint, with an anchored
    mutant that adds andesite.
- **Fluid cobble generators at the surface** would be false positives. 0 were seen in 2,070 uninhabited chunks.
- **A structure dug away between two copies** is seen as removed cells, never as a building lost. So the read pairs removed
  cells with the records they belonged to.

### 2.8 Wiring into the daily scoreboard (PROPOSAL; nothing installed)

1. **10.0.0.30, mike's crontab, 03:45Z** (after the 03:15Z backup has staged every world):
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
   - each line names its source, window and denominator, and the day's controls (stamp present, uninhabited false positives).
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
| stone (intermediate) | smelt 1 cobblestone | furnace | 1 of 1.5 per plank |
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

**Fuel is planks.** 1 log gives 4 planks, and 4 x 1.5 = 6 smelts. Charcoal would give about 6.9 smelts per log, after paying
its own smelt, so it gains nothing for smelting.
- Planks respect B3 (never coal) and D4 (no charcoal) as they stand.
- A stone brick costs 1 cobble and 1/6 log.
- Torches are the one part that needs coal or charcoal (§8 C3).

### 3.2 Who, when, how much

**`make_material`** is a deterministic town JOB in the TP §5 pattern. It is not a model verb: the brain's `build` verb
already went unchosen in 24 h, and advice printed is not advice taken.
- It is a pure `materialOrder(readings) -> { order | skip }`, issued as a HOUSEKEEPING proposal through admission.
- It runs in cognitive.mjs after the town deposit, the town orders, the well and prune, and only when no milestone rung is
  ready. The rung always wins.

**Eligible when all hold:**
- the bot is at town, with 3 or more free slots after keeps;
- this bot's cooldown (10 min) has passed;
- the town's materials lease is free (one maker per town; 4 min TTL, renewed);
- **a part is short**: either the remaining bill of materials of the town's admitted, claimed blueprint (net of finished
  parts and claims), or, with no project, the part below its BUFFER;
- the inputs exist above the reserve in the town index;
- a furnace is free under the furnace lease: the workshop's, or any town furnace within 16 until the workshop exists.

**One order, inside one 180 s skill budget** (as smelt_town):
1. Withdraw inputs, never more than one batch: 8 cobble, or up to 6 sand, plus 2 logs.
2. Craft the planks.
3. Run one furnace session (`smelt`'s own, with its lease): load the batch and the planks, collect.
4. Craft at once: stone into stone bricks, glass into panes, ingots into copper blocks and then cut copper or doors.
5. In a `finally`, deposit the parts and every unspent input.

Rules inside the order:
- **Stone never leaves the job as stone.** It is in PATHFINDER_SCAFFOLD and would be spent as scaffold. It is a KEEP for the
  duration and is crafted before the deposit.
- **Copper parts need no furnace.** Copper orders are table-only and skip step 3.

**Bounds:**
- 1 order per bot per 10 min; a 20 min backoff on failure.
- Town jobs share the TP body budget of at most 10 min per bot-hour (measured from the job rows).
- BUFFERS, per town, a setting: stone_bricks 128, glass_pane 32, cut_copper 24, copper_door 3. Planks and sticks keep the
  existing stock targets.
- With no admitted project nothing is made beyond the buffers, so a town cannot be hollowed into parts.

### 3.3 The reserve (B3) and why it cannot eat the tools

**`BUILD_RESERVE` is a setting** (an env JSON with the defaults below, read at spawn and logged in the `_mats_mode` licence
row). Defaults per town: cobble 256, logs 512, planks 64, sticks 64, copper ingots 256, sand 16, torches 32.

**Spendable** = indexed town stock (townindex-01: known and fresh entries) − reserve − outstanding claims. A container whose
index entry is `unknown`, `stale` or `dirty` counts 0 until count_town re-reads it. So admission can only under-count.

**Never inputs, whatever the setting says** (code, not configuration):
- the iron ladder: raw iron, iron ingots and nuggets, iron ores, coal, charcoal;
- every tool, bucket and shears;
- sticks below the reserve (the kit's sticks);
- anything under a live claim: toolkit draws, withdraw holds, cobblecap claims.

A structural test asserts the forbidden set against `IRON_LADDER` and the toolkit's inputs. A behaviour test runs
`materialOrder` on an index fixture that holds only iron and coal, and must return a skip.

**Admission** (TP 3.2's 80% rule, one claim set): a blueprint is admitted in a town only when spendable stock covers 80% of
its remaining raw bill. **Copper is an UPGRADE with a fallback** (TP §4 common rule): a copper-short town builds the trim in
stone-brick slabs and the door as an open doorway. No town waits for a metal.

**Funding today** (`tools/funding.py.txt`, census 10-23, default reserve, chests only):
- workshop@1 needs 89 cobble, 29 logs (fuel included), 6 sand, and 180 copper ingots or its fallback.
- With copper as an upgrade, the workshop is funded in **14 of 16 towns**. hive-b (252 logs) and hive-d (67) are short of
  logs at a 512 reserve.
- Workshop plus five houses (360 cobble, 149 logs) is funded in 12 of 16.
- Copper trim is funded in 9 of 16. The isolated worlds hold raw copper, not ingots.
- **Sand is 0 everywhere today:** glass waits on matset-01's sand target, and the windows wait with it (they are an upgrade
  as well: a plank cell takes their place after 24 h, the pavilion's `roof_shortfall` pattern).

### 3.4 Settings that ship first (matset-01, tier 1)

- **sand** stock target 0 -> 64 per town, so the 574 sand a day stops being pruned.
- **glass and glass_pane** leave `DECORATIONS` (the junk-well list) and join `NEVER_DISPOSE`, as D8 did for stone bricks.
  cut_copper*, copper_block and copper_door join `NEVER_DISPOSE` too.
- **Stock targets** for stone_bricks, glass_pane and cut_copper equal the buffers, so a bank refuses nothing the job makes.
- `BUILD_RESERVE` is declared. Nothing reads it until mats-01.

---

## 4. Real structures from plans

### 4.1 The blueprint (format) and the record

A **blueprint** is a versioned JSON file in `bots/src/blueprints/`. It holds:
- `id@version`, the plot kind, the footprint, `pad: {w, d}`;
- `palette`: ROLES mapped to blocks, with fallbacks. For example `base: stone_bricks`; `wall: planks` (the town's most-stocked
  species); `window: glass_pane -> wall`; `trim: cut_copper -> stone_brick_slab`; `door: copper_door -> doorway`;
  `light: torch`;
- `cells`: `[{u, v, y, role, state?}]` relative to the anchor, orientation E. Rotations are as ring@1's;
- `segments` and a **proven sequence** per segment.

The block-state rule is TP 4.0's:
- only blocks whose state is irrelevant, or set by a top-face click;
- the door is the one stateful exception. Its predicted state (facing from the stand's yaw, the lower half, the hinge from
  neighbours) is checked by a pure function, then read back as full state.

A **record** is the fitted, frozen instance: absolute cells, with the stand and face per cell, written once by the planner as
generation files (`project-<home>.<plot>.g<N>.json`, blueprint.mjs's link() protocol, never pruned). Progress is the world,
never a saved index (Baritone's rule, §9), so an abort, a restart or a different bot resumes from the same truth.

**SEGMENT** is the claimable sub-task unit that the cooperation design asks for:

| field | meaning |
|---|---|
| `id` | `pad`, `ring`, `wall-N`/`wall-E`/..., `roof-edge`, `roof-inner`, `fit-out` (stations and torches), `door` |
| `cells` | the cells it places (and the clears it may make, B4) |
| `deps` | segments that must read COMPLETE in the world first (roof-edge needs every wall; door needs fit-out) |
| `bom` | its materials, claimed from the town's one claim set when the segment is leased |
| `lease` | `project-<home>.<plot>.seg-<id>.lease.g<N>.json`: holder, record generation, claim id, 4 min TTL, renewed per placement. Its generation is the fencing token, checked immediately before every click |

Rules:
- A segment is claimable when its deps are complete, its lease is free, and its bill is claimable.
- **`BUILD_MAX_BUILDERS`** (a setting) caps live segment leases per project. 1 gives TP's "one builder"; the cooperation
  design's first project sets 3 (§8 C5).
- Two segments run concurrently only when no cell, stand or support of one lies in the other's cells.
- Each segment's sequence is proven offline with the other running segments' cells marked as bodies (§4.4).

### 4.2 The blueprints (B2 palette)

**workshop@1, the shared building (bench).** Pavilion geometry, which TP stage 3 proved offline, closed in:
- pad 9x7 stone bricks at s (63), and a step ring at s+1 (26, a gap at the doorway);
- walls 7x5, 2 high: 34 planks and 4 glass panes at s+2, with a 1x2 open doorway on the core side;
- roof 7x5 at s+3: 15 planks inside a 20-cell cut-copper trim ring;
- inside: 2 torches, 1 crafting table, 2 furnaces on the back row, the standing row in front.

That is 167 placements. The bill: 89 cobble, ≈ 13 logs of planks plus 16 of fuel (29), 6 sand, 180 copper ingots (fallback:
stone-brick slabs), 2 torches, a table and 2 furnaces (bags carry 178 tables and 87 furnaces). It is the town's
`make_material` site from then on.

**storehouse@ring, the shared building (showcase, greenfield).** The town plan's §7.4 shape around found-01's founding chests:
- 9x9 pad, step ring, 7x7 walls 2 high, plank roof at s+3 (O6);
- signs above each section;
- B2 swaps the pad and ring to stone bricks and the walls to planks with panes.

Its own gates are the town plan's: construction proven with the containers present, nothing solid above a container, labels
read back.

**house@1, a house per bot (B1 step 2):**
- pad 7x7 stone bricks (49) and ring (23);
- walls 5x5, 2 high: 26 planks and 3 panes;
- roof 5x5 at s+3: 21 planks and 4 cut-copper corners;
- 1 torch inside; a **copper door placed last, from outside** (fallback: doorway).

That is 129 placements. Five per town: 360 cobble, ≈ 120 logs, ≈ 192 ingots, 15 panes, 5 torches. Nothing is stored inside,
and no bed: beds would move respawn.

**wall@1 (B1 step 3):**
- 2-high stone-brick segments of at most 12 cells, each followed by a 2-cell gap;
- a torch on top of every 6th cell;
- a gate at every path spoke;
- traced at Chebyshev 44, skipping every plot box + 1, zone, liquid and the monument apron.

A full ring is ≈ 352 cells x 2 = 704 bricks (≈ 117 logs of fuel). It is built per segment as the reserve allows.

**paths (B1 step 3):** paths-01 as designed in the town plan (§7.6): a shovel's use, `dirt_path`, never a dig, and a torch
beside the path every 6 cells.

### 4.3 Siting: plots, sectors, clearing (B4)

**The plan.** Every blueprint is sited in a town-plan plot (townplan-01's siting file; §4.1 of the plan's protocol):
- workshop@1 takes the **pavilion's sector** (the outer plots are assigned in a fixed preference order). The pavilion becomes
  unnecessary, because the workshop proves the roof.
- Houses are a new plot kind, `house`, appended to the plan (append-only; no committed plot changes). Five pads 7x7 with
  2-cell gaps sit in the sectors either side of the gate path, at Chebyshev 17-40.
- Walls are a `wall` plot traced as above. Paths are the plan's own.

**Where the 9x7 pad fits today** (`tools/fitb.py.txt` on the region copies, `data/fit-sharedbuilding-20261023.jsonl`: an
offline screen under B4's limits):

| band | towns with a site | notes |
|---|---:|---|
| inside the 16 circle (7-16) | **4 / 16** (board-b, board-d, hive-d, placebo-a) | town furniture (crafting tables, furnaces, chests) is the blocker, as the town plan found for 9x9 (0 / 16) |
| near (17-30) | 13 / 16 | not board-c, isolated-d, placebo-c |
| outer (22-44) | **16 / 16** | best earthwork 0-30 cells; up to 342 tree cells to clear |

So the bench workshop is outside the town-storage circle in 12 of 16 towns. That is fine: it holds no containers, so no
town-storage semantics change, and its furnaces are named by the record, not found by radius. The runtime planner's proof
(stands, sight lines, walk-back) is still required. The screen only rejects.

**Clearing (B4).** It happens only inside the claimed plot box, by its builder under the fenced lease, from the record's
CLEAR LIST. Never in a protected zone, the showcase's village boxes, or another plot.
- **Trees:** a log or leaf cell in the box is cleared top-down. This is TP's class `structure`, widened to logs inside a
  claimed plot.
  - **Replant:** for every trunk felled, one sapling of that species (else any) is planted outside every plan cell, within
    8-24 of the plot, by `plantableSpotNear` with the plan's keep-outs.
  - A felling needs the sapling in the bag. Without one, the remedy is a withdraw from town (640 oak and 323 birch saplings
    in chests) or the leaves' own drops. Until then the clear waits and the other segments go on.
- **Small hills:** terrain above s, at most 3 high per column and 30 cells per plot (the screen's limits), is dug. Holes, at
  most 3 deep and 40 cells, are filled with cobble.
  - Larger relief refuses the site: re-fit.
  - Inside Chebyshev 16, townzone-01 refuses target digs of town ground. The builder's clears pass by AUTHORITY (the fenced
    lease and its clear list, TP §8 exemption (c)), never by a label.

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
  - every B4 clear is confirmed by packet before any stand or support relies on it;
  - no dig is made in the first 3 s after a spawn or respawn (no `player_loaded` is sent; cause #1 of the ghosts);
  - a dig with no confirmation within 3 s marks the cell unknown and re-reads it, never "cleared".
- **The pathfinder never edits a footprint.** Every record's cells + 1 go into `exclusionAreasBreak` and `exclusionAreasPlace`
  for every movements clone, as treefarm and the well already do. Build parts are removed from scaffolding during visits.
  Without this, a stray scaffold block gets "fixed" in a loop (Baritone #2173), or a house gets dug through.
- **structureguard-01** (in the same branch) refuses TARGET digs of recorded cells (mine, gather, the ore tunnel,
  make-room). Transit and survival digs stay untouched. Damage is absorbed and rebuilt next visit, because progress is the
  world.
- **Bodies:** a cell waits while any entity box touches it or the cell above. `wouldEnclose` refuses a solid placement that
  leaves any body without a cardinal exit.
- **The sealed house:** the door is the last cell, placed from outside after `fit-out` reads complete and no body is inside.
- **Order:** bottom-up per column, nearest-first within a segment, as plinth and the monument do. A cell is placeable when its
  support and its stand exist now.

### 4.5 Composition with the zones and the neighbours

| neighbour | rule |
|---|---|
| protected zones (protectzone-01), showcase villages | never sited, cleared or placed into; the plan's fit refuses a plot meeting a zone |
| keepout-01 (fire columns) | a plot never meets a recorded fire column; a segment stand inside one is refused, as mine's exit is |
| townzone-01 (no-dig zone, ≤ 16) | the builder's clears pass by authority only (§4.3); every other target dig of a plot cell stays refused |
| plinth wells, the farm, the monument apron, the shaft collar | their records + 1 are occupied for siting (town plan §4.6) |
| lids (lidrule, lidclear) | nothing solid directly above a TOWN container (the showcase storehouse); a bench workshop or house holds no containers |
| found-01 and the workshop strip | found-01's station strip inside 16 stays. workshop@1 is an extra site, not a move |
| `smelt` (milestone), smelt_town | the furnace lease; workshop furnaces are named by the record and preferred by `make_material` |
| the junk well, prune, cobblekeep | parts are NEVER_DISPOSE (§3.4); claimed inputs are holds (TP 3.3) |
| the town floor (townfloor-01) | never fills a plot box (the plan's adopters) |

### 4.6 Failure and refusal chains: every refusal names the next legal move

The CLAUDE.md composition class. Each row is a chain test through the real CognitiveLoop, plus a Paper scene where marked.

| # | meets | what happens | next legal move |
|---|---|---|---|
| M1 | inputs above the reserve too low | `make_material` not eligible | the bot's other work; the deposit flows refill the town; admission is retried at the next tick |
| M2 | the furnace is leased | `furnace_busy`, a free skip | another furnace within 16, or the next decision |
| M3 | interrupted mid-session | the `finally` deposits; prior output is collected by the next session or `furnace_drain` (within 48) | as today |
| M4 | the bag fills during a job | the job never withdraws more than one batch, so 3 free slots fit it | town_deposit first |
| A1 | a blueprint not admitted (reserve) | no project; nothing is claimed | the buffers fill slowly; admission is re-checked every 30 min |
| A2 | copper short | the fallback role block | none needed |
| A3 | glass short (sand) | windows wait 24 h, then become wall cells (`window_shortfall`) | none needed |
| S1 | no site in any band | `build:no_site` per plot, re-fit daily | the town builds the other plots |
| S2 | the site needs more earthwork than B4 allows | refused; next candidate | S1 |
| C1 | a tree to fell and no sapling | the clear waits | withdraw saplings from town, or collect the leaves' drops; other segments go on |
| C2 | a clear cell is in a zone or another plot | never planned (the fit refuses it) | — |
| C3 | a dig is unconfirmed (ghost risk) | the cell is unknown and re-read; never stood on | the next visit, after the server's word |
| B1 | a cell is occupied by a body | waits (at most 2 tries per visit) | another cell in the segment |
| B2 | a cell is occupied by a foreign block not in the clear list | the segment stalls | stall 72 h -> abandon -> re-site (twice) -> skip (TP 3.2) |
| B3 | no stand, face or sight line now | `no_step`; the segment yields its lease | another segment; the proof guaranteed a sequence, so a `no_step` on a fresh record is a defect |
| B4 | the lease is lost (fencing) | stop before the click | the next claim |
| B5 | a bot inside when a wall or roof would enclose it | `wouldEnclose` refuses the cell | the bot leaves by the doorway; the house door waits for an empty interior |
| B6 | the entombment reflex fires against a wall | survival digs are allowed; damage is rebuilt | exits by the doorway (Paper ENTOMB); the workshop has an open doorway |
| B7 | the pathfinder wants a footprint cell | the exclusion areas refuse it | it routes around; wall gaps every 12 keep a way through within 6 cells |
| B8 | mine or gather targets a recorded cell | structureguard refuses | mine's walk-off (`exitCell`); gather's search moves on |
| P1 | the segment's parts are not made | `make_material` is eligible (a part is short) | the builder takes another segment, or waits; never a model-advice loop |
| D1 | the door would face wrong | predicted before the click; the read-back by full state is the judge | a wrong door is removed by its builder (a fenced yield) and re-placed once, then `door: doorway` |

---

## 5. How bots cooperate on a build (the interfaces cooperation-1023 asks for)

- **The unit of work is a SEGMENT** (§4.1). A bot claims one through its lease file, with the record generation as the fencing
  token. It claims the segment's bill from the town's one claim set and withdraws those materials. It builds what the world
  shows open, and returns what is left in a `finally`.
- **No bot knows about another's plans.** The world and the lease files are the whole protocol, so a crash leaves no orphaned
  coordination state. A segment's lease lapses, and the next claimant reads the world.
- **What a foreman (the overseer design's role leases) can do:** it may REORDER which segment a bot prefers, by writing role
  leases. It never names a coordinate and never bypasses a lease, as that design already requires.
- **Measures the cooperation design will need**, all written as rows:
  - segment claims, completions and yields per bot;
  - overlap defects (two live leases on one segment, or a click outside the holder's segment);
  - wall-clock time to complete per project with 1 and with 3 builders.
- **Exposed functions** (pure): `claimableSegments(record, world, leases)`, `segmentDone(record, seg, read)`,
  `segmentBom(record, seg)`, `concurrentOk(segA, segB)`.

---

## 6. Ordering and canary plan

### 6.1 The order

| # | piece | tier | needs | what | read: exposure; effect (structure count); gates |
|---|---|---|---|---|---|
| 0 | **structcount** | host script, no canary | — | §2: the daily count + controls + BUILD lines | ≥ 3 days of baseline before #3; controls every day |
| 1 | **matset-01** | 1 (owner-direct + tripwire) | — | §3.4: sand target, glass off the junk list, NEVER_DISPOSE, part stock targets, `BUILD_RESERVE` declared | tripwire: 0 well disposals of glass, panes or copper parts; sand banked > 0 in 24 h; gather and rung rates within the null |
| 2 | **mats-01** | 2 (4 pools, KEEP at +180 if exposed) | 1; townindex-01 (KEPT) | §3.2-3.3, buffers only (no project yet) | exposure ≥ 20 parts made with exact conservation (furnace session equations, TP §5). REVERT: any forbidden input consumed; the reserve crossed (index); stone left in a bag after an order. No-harm DiD: rung completions, gather, smelt `furnace_busy`, bag fill |
| 3 | **shop-01** | 3 | 2; townplan-01 (KEPT: plots, sectors); builder.mjs + structureguard-01 (carried here) | §4: the record, segments, workshop@1 (bench) and storehouse@ring (greenfield), B4 clearing and replant | **effect:** B5 buildings complete in canary towns (structcount), control = 0 by construction. Exposure ≥ 1 complete workshop in ≥ 2 canary towns, conformance F1 ≥ 0.98 (name and state). REVERT: an off-record placement; a clear outside the clear list or a plot; any zone cell touched; two leases live on one segment; builder bag delta ≠ confirmed placements + scaffold; a tree felled without its replant within 24 h; an unconfirmed dig stood on. No-harm DiD: deaths (two-death floor), immobile bot-h, gather and rung, litter cells added (structcount) |
| 4 | **house-01** | 3 | 3 KEPT | house plots + house@1 + the sealed-door rule | exposure ≥ 3 complete houses in each canary town; REVERT also on a body inside a sealed house (structcount room test + positions) |
| 5 | **paths-01** | 3 | 3 | the town plan's paths + torches | the plan's gates; lit path cells (structcount) |
| 6 | **wall-01** | 3 | 3, 5 | wall@1 segments | REVERT: any wall segment longer than 12 without a gap; immobile DiD near the wall line |
| 7 | **storehouse-01b** | 3 | 3 KEPT; owner C1 | hive-a/b only: the real storehouse building at the O3(b) pad, town storage widened to include it | the town plan's storehouse gates + every town-container test re-run |

### 6.2 Draws and exposure

- **The pool must hold the population the fix targets** (CLAUDE.md). shop-01 draws only towns that are funded at draw time
  (`draw_require`: an admitted workshop@1 and a site from the planner): 14 of 16 by today's census.
- **Expected time:** 167 placements at 1.14 s is ≈ 3 min of clicks. With TP's 3-5x production overhead, the material jobs
  (89 smelts ≈ 15 furnace-minutes on 1 furnace) and the clearing, that is a few bot-hours per town.
- **Reads:** +360, extended to +720 / +1080 / +1440 until the exposure is met. Deadline: INCONCLUSIVE.
- **Tier 3 pools as drawn.** Tier 2 (mats-01) needs exactly 4 pools and ≥ 48 bot-h.
- **The effect is a demonstration on 1-4 towns, labelled as one** (TP §7). Causal claims come only from the DiD no-harm rows.
  A building is binary per town, so the read reports per-town completion, never a rate across towns.
- **Deaths stay tripwires** (two-death floor). Building work is surface work at ≤ 3 blocks of drop, peaceful.

### 6.3 Risks

| risk | where | guard |
|---|---|---|
| the roof sequence fails on real terrain | shop-01 | Paper on terrain fixtures cut from region copies (board-a, hive-c) before launch, as TP stage 3 requires |
| the pathfinder digs through or scaffolds into a footprint | all | exclusion areas (§4.4); Paper BYSTANDER and SCAFFOLD scenes |
| ghost blocks from clears | shop-01 B4 | packet confirmation; no digs in the 3 s after a spawn |
| towns short of logs (hive-b, hive-d) never build | shop-01 | reported by name; the reserve is a setting (owner) |
| body time displaces gathering | mats-01, shop-01 | the 10 min per bot-hour budget; DiD on gather and rung |
| tree clearing strips the jungle towns | shop-01 | the replant rule; the read counts felled against replanted |
| one canary lane, many pieces | all | each is small; matset-01 is tier 1 and can go in the gap after indexsearch-01 |

---

## 7. Paper scenes (the sandbox, the real bot, RCON as the oracle; sandbox 1 also has CoreProtect)

| scene | piece | must show |
|---|---|---|
| SC-CTL | structcount | on a sandbox arena: a bot-built workshop, a house, a scaffold pillar and a plinth. The count gives exactly 2 buildings, the structures, the litter, and F1 = 1.0 for both records. **CoreProtect's placed-and-not-broken set (sandbox 1) agrees with the BUILT set cell for cell** (precision and recall reported) |
| MAT-1 | mats-01 | a town with cobble, logs, sand and copper above the reserve: stone bricks, panes, cut copper and a door made, by server bag and chest deltas. 0 iron, coal or kit consumed, with iron and coal present in the same chest as the positive control |
| MAT-RES | mats-01 | stock exactly at the reserve: no order; one item above: one batch |
| SHOP-FLAT / SHOP-TOWN | shop-01 | the whole workshop on flat ground and on two dug-out fixtures; every cell read in family |
| SHOP-CLEAR | shop-01 | a plot with 2 trees and a 3-high hill: cleared, trees replanted outside the plan, no cell outside the clear list touched |
| SHOP-ZONE | shop-01 | a plot candidate meeting a protected zone is never chosen |
| SHOP-KILL | shop-01 | SIGKILL during a clear, a placement and a lease renewal: resumes from the world, nothing placed twice |
| SHOP-COOP3 | shop-01 (C5) | 3 bots on 3 segments: no overlap defect, the deps respected, complete |
| HOUSE-SEAL | house-01 | the door last from outside; a bot inside the interior delays it; a door facing wrong is re-placed once, then doorway |
| ENTOMB | shop-01, house-01 | the entombment reflex against a wall exits by the doorway |
| WALL-GAP | wall-01 | a bot 30 out walks home through a gap within 6 cells, 0 digs of wall cells |

---

## 8. Where the owner's answers meet the evidence or an earlier decision (named, not silently picked)

- **C1. B1 ("a workshop/storehouse first") and decision 6 ("a real storehouse only in hive-a/b").**
  - Measured: a 9x9 storehouse pad fits inside the 16 circle in 0 of 16 bench towns (town plan §1.6). A storehouse outside 16
    widens "town storage", which touches every town-container test (tier 3 on its own).
  - Reconciled: the first shared building is the WORKSHOP in every bench town, hive-a/b included. The showcase's is the
    greenfield STOREHOUSE shell (inside 16 by design). hive-a/b's real storehouse follows as storehouse-01b.
  - **Owner:** confirm, or make hive-a/b's first building the storehouse and accept the wider change first.
- **C2. B5 ("a door") and the bots' pathfinding.** mineflayer-pathfinder ships `canOpenDoors = false` ("Causes issues"), and
  the fleet never enables it. A door block is an obstacle: a bot inside a closed building cannot path out, and the pathfinder
  may dig the door.
  - Designed: the workshop has an open doorway, and the count's door test accepts a 1x2 doorway or a door block. Houses get a
    real copper door, placed LAST from outside, so no bot needs to enter again.
  - **Owner:** does a doorway count as "a door" for the shared building? Or should real doors wait for a door-opening
    movement change, proven on Paper?
- **C3. B3 ("never coal") and lit paths.**
  - Torches need coal or charcoal, and D4 (10-15) said no charcoal yet. Buildings need 2 torches (workshop) and 1 per house,
    which the town torch stock (64 per town, a 32 reserve) covers.
  - Paths need 20-60 torches per town, which it does not.
  - **Owner:** allow charcoal from surplus logs for torches (a `make_material` part), or light paths only to the stock.
- **C4. B6 ("same code as the fleet" and "built first").**
  - The showcase follower takes a promoted sha after 24 h, and runs only kept code. So it cannot run building code before the
    fleet, and the showcase has not started yet (its start gate waits on the town plan's pieces).
  - Read here as: the showcase gets each building piece the moment the fleet does (the 24 h follower lag waived for
    building-tier pieces). Its founding storehouse is the first building it makes, so the timelapse shows it.
  - The alternative is the O9 pattern (Paper + a bench no-harm read, before the bench KEEP).
  - **Owner:** which.
- **C5. The cooperation decision and TP's "one builder, never a second".**
  - If shop-01 builds workshops solo, its KEEP auto-promotes, and within a day every town has one. The cooperation design's
    first project (2-3 bots building the workshop) would be gone.
  - Designed: segments and `BUILD_MAX_BUILDERS` from the start. Recommended: shop-01 ships at 3, with the Paper COOP3 scene
    and the overlap defect gate, so the first workshop IS the first multi-bot project.
  - **Owner** (and the cooperation design's authors): 3, or 1 and pick another first multi-bot project.
- **C6. B2 (planks) and the TP pavilion (log walls).** Taken as B2: planks. The TP plan is superseded on that point.
- **C7. The brief: "300 successful place actions are crafting tables, torches and wells".** Measured, they are 274 saplings,
  23 tables, 7 dirt and 1 granite; torches 0. It changes nothing in the design.
- **C8. CLAUDE.md "no new analysis while a canary is deployed and unread".** indexsearch-01 is live (12:17Z). This work was
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
| **Q2** (C2) | a 1x2 open doorway counts as B5's "door" on the shared building (bots must walk in and out); houses get real copper doors placed last | **yes**. Real doors on working buildings only after a Paper-proven door-opening change |
| **Q3** (C3) | charcoal from surplus logs, for torches only (lit paths need 20-60 a town) | **yes**, as a `make_material` part, reserve-bounded |
| **Q4** (C4) | the showcase gets building pieces at promotion with the 24 h follower lag waived, or on Paper + a bench no-harm read (the O9 pattern) | **at promotion, lag waived**: "same code as the fleet" stays literally true |
| **Q5** (C5) | shop-01 ships multi-builder (3) so the workshop is the first multi-bot project | **yes, 3**, with the COOP3 scene and the overlap gate |
| **Q6** (B3) | the reserve defaults: cobble 256, logs 512, planks 64, sticks 64, copper ingots 256, sand 16, torches 32. hive-b and hive-d are log-short at 512 | **as listed**; revisit hive-b/d after a week of the BUILD line |
| **Q7** | the wall: 2-high segments of ≤ 12 with 2-cell gaps (bots range a median 57 blocks from home, so a closed ring at 44 would be crossed by digging) | **gaps every 12** |
| **Q8** | carrying structcount's daily file (and the chest census) from 10.0.0.30 to goalboard on 10.0.0.31: a forced-command key, or a copy from the controller | **a forced-command key on .30 that only cats the two newest files** |
| **Q9** | CoreProtect on the fleet servers, for attribution by player | **no**. The region read and its controls are enough, and the bench does not need another plugin; the sandbox copy validates the count (SC-CTL) |

---

## 11. Reviews

Rounds are recorded in `docs/reports/building-tier-reviews-2026-10-23.txt`.
- **Round 0:** the prior-art search (§9).
- (rounds follow)
