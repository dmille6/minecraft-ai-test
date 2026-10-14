# Town floor: the bots fill the ground they dug from under their towns (2026-10-14, design + build, r1 DRAFT)

OWNER 10-14: "lets absolutely do what you recommend with the cobblestones". Surplus cobble is to be USED; the junk well
is the overflow, not the main outlet. This document: the scale (measured, read-only), the design of the town-floor job
(A), the first simple build (B, design only), the tests, the sandbox evidence and the canary registration.

Nothing in this work changed a fleet world. Region files were copied read-only from 10.0.0.30 (`cat` of
`/srv/block2/<pool>/world/region/r.*.mca`, 18:00Z); logs were read on 10.0.0.31 under `nice -n 19` with
`lib/telemetry.Events`. World edits happened only on the Paper sandbox, under the sandbox lock.

## 0. Answers first

**How big is it?** _(r1: final numbers in section 1; the planner run is being repeated on the final code)_
- Inside the repair box -- Chebyshev 16 around home (the town-ground zone's square), from the floor level
  L = home.y - 2 (the platform's top) down 10 layers (the zone's band) -- there are **3,300-8,100 open cells per town,
  ~103,000 over 16 towns**; 80% of them were solid in the seed's terrain (dug), 20% are natural (caves, dips).
- Under the 13x13 platform alone: 340-1,430 open cells per town; the platform floats.
- What the job can actually fill **without digging and without sealing anything**, by the production planner run
  offline on the 10-14 18:00Z region copies: see the table in 1.3 (first towns: placebo-a 2,947 of 4,873; hive-b
  4,322 of 5,896; isolated-c 4,315 of 7,531 -- about 45-75%). The rest is sealed voids (no stand reaches them on foot),
  water and protected cells.
- **Cost = one stone block per cell: ~3,000-5,000 cobble per town, ~60,000 for the fleet.**

**Can the fleet pay for it?** Yes, from flow, in weeks: the bots pick up **47,833 cobble a day** (24 h, all 16 pools,
2,059-3,952 per town), and hold **13,762 above the 64 reserve** in their bags right now (80 bots, 18,468 held). At the
job's rate limit (one builder per town, at most 32 blocks per visit, a 10-minute cooldown per bot) a town fills at most
~190 blocks an hour, so the job, not the cobble, is the limit; and the cobble that is not placed still goes to the well
or stays in the bag as today.

**Does it make the bots safer?** The trap rows say the town ground matters: in 7 days, **9,822 of 29,527 `_fall_path`
rows (33%)** and **7,159 of 81,433 `_entombed` rows (9%)** were within Chebyshev 16 of home -- a 33x33 square that is a
tiny fraction of the ground the bots cover. Deaths near town are rare (7 of 283 in 7 days within 16: drowning 2,
fall 2, suffocation 3). This is reported, not claimed: the canary reads it as a secondary metric.

**Do drownings cluster near towns (for B)?** No. 2 of 118 drownings in 7 days were within 16 of home, 9 within 17-32,
107 beyond 32. A path ring around town would not address drowning; B is not justified on drowning.

## 1. Measurements (read-only)

### 1.1 Open cells in the repair box (`an/profile.mjs`, region copies 10-14 18:00Z vs the seed's fresh terrain)

Chebyshev <= 16, y in [L-10, L]. "Dug" = solid in the fresh seed terrain (regenerated 10-13 by the townground agent).

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

Positive control: every town's 1,089 columns were read (unknown 0); in the planner's own classification (floorCells) open + plant + solid + liquid equals
the box (33 x 33 x 11 = 11,979). The 10 shared-seed towns differ by bot digging only.

### 1.2 Supply, bags, traps and deaths (`an/tfscale.py` on 10.0.0.31; 9,100,837 rows, 80 bots, 7 days)

Positive control for every count below: the walk read 9.1 M rows from 80 bots; each table has nonzero cells.

- **Cobble collected (24 h, `_pickups` summaries; collection, not mining):** 47,833 fleet-wide; per town 1,867
  (isolated-c) to 3,952 (board-d).
- **Bags (latest row per bot in 24 h):** 18,468 cobble held by 80 bots; 13,762 above the 64 reserve; per town 196
  (board-d) to 2,640 (placebo-b) above the reserve.
- **Deaths, 7 days, by Chebyshev ring from home:** drowning <=16: 2, 17-32: 9, >32: 107; fall 2 / 1 / 47; suffocation
  3 / 2 / 14; fire 0 / 9 / 69.
- **Trap rows, 7 days:** `_fall_path` <=16: 9,822, 17-32: 6,495, >32: 13,210; `_entombed` 7,159 / 21,033 / 53,241;
  `_stranded_underground` 159 / 1,486 / 3,155.

### 1.3 What the job can fill: the production planner offline (`an/sim.mjs`)

The REAL `planFloor` (bots/src/townfloor.mjs on the canary sha) run to exhaustion on each town's region copy, no
entities: every cell it plans has a support, a stand reached on foot that walks back to the town after the click, and
no seal. _(table filled in from `an/out-sim-*.txt` once the final run completes)_

## 2. Design (A): the town-floor job

### 2.1 Which cells
- **The box** = the town-ground zone's protected band exactly: Chebyshev 16 (`TOWN_GROUND_HALF`) around home, y from
  home.y-12 (`TOWN_GROUND_DEPTH`) to L = home.y-2. A test asserts every corner of the box is `inTownBox` and every
  floor block (`andesite`, `diorite`, `granite`, `cobbled_deepslate`, `cobblestone`) is zone `ground`: **the zone
  protects every cell the floor fills** (from gather/mine/ore-tunnel target digs; transit digs stay as the zone
  defines them).
- **A target** is an open cell in the box: air or a plant a placement replaces (short/tall grass, fern, dead bush).
  Never a liquid, a flower, a sapling, a torch, snow.
- **Protected (never filled):** any open cell with a liquid below it in its column (every water surface stays open to
  the sky); a sapling's growth column (its cell and 7 above: growth needs the vertical shaft, measured 09-2x); the cell
  over farmland; anything within Chebyshev 1 (3D) of town furniture (containers, crafting/smithing tables, furnaces,
  the composter, doors, trapdoors, beds, lectern, bell, anvil, ...: a lid must open, a door swing, a bed be used); the
  junk well (every well the town has, breached too, and the recorded site: 5x5 from 3 below the cap to 3 above); and,
  when a plinth record exists (plinth-01), its cap's 7x7 from 4 below to 3 above and its stair cells. A cell not loaded
  makes the whole visit plan nothing.

### 2.2 How a placement is chosen (pure: `planFloorSteps`, re-run every visit on the world as it is)
- **Supported, bottom-up, never a bridge:** a cell is placed only when the block directly below it is solid. The click
  is that block's top face, or a solid neighbour's side face; never a bottom face.
- **A stand the town reaches on foot and that walks back after the click** (the plinth planner's probe: cardinal walk,
  step up 1, drop 1-3, no dig, no place, no swim): eye within 4.5 of the clicked face's centre, above a top face, a
  clear line of sight. The builder can never wall itself in.
- **Never seals anything** (`sealRefusal`): after the placement every open neighbour of the cell must still reach the
  open air at or above L+1 (a 6-neighbour flood inside the box + 8 around and 8 below); the only exception is an EMPTY
  dead end of at most 8 cells. A pocket holding a body or an item, a larger void, and any space whose end is not known
  (it leaves the region -- a mine tunnel -- or a cell is not loaded) refuse. A player who walks to the town before a
  placement must still after it; a cell holding a body or an item is never placed into.
- **Order:** the platform square (Chebyshev <= 6) first; then the HIGHEST eligible cell (a column is topped out
  before the next is started: a 1-high gap under a roof can never be stood in, so filling a layer everywhere first
  strands the layer above it -- found by the cavern test); then FAR FIRST (the walk distance of the nearest stand);
  and a placement that would cost any other stand its way there and back (a CUT) waits while anything else can be
  placed -- so a tunnel or a cavern is filled from its far end back to its mouth.
- **Re-proved at the click** (`stepRefusal`): the world moves between plan and click (other bots, gatherers,
  falling blocks): the cell still open, the floor still solid, the ref usable, nothing protected by now, nobody in it,
  the stand standable, in reach with sight, no seal, the stand still walks to the town after. A refusal replans
  (at most 2 replans per visit).

### 2.3 The visit (`fill_town`, skills.mjs)
- A deterministic town order, never the model's (chatOnly, housekeeping). At town only (TOWN_RADIUS), never a trip.
- **One builder per town:** lease generations created exclusively (the plinth's protocol: `link()` fails on EEXIST, so
  two bots that both read the lease free race for one file name and one wins), renewed at every placement, 3-minute
  expiry, released in `finally`.
- **Bounded:** at most 32 placements and 100 s per visit; one placement per 4 ticks (a vanilla client's pace: Paper
  dropped faster placements in the plinth's S1); each read back from the world (10 ticks); a drop is retried by a
  replan; a cell dropped twice is skipped for 24 h (the record's `stuck`).
- **On foot only:** the town deposit's walk profile (no digging, no towers, no scaffold).
- **Funding (bag only):** andesite/diorite/granite first (the well's junk), then cobble while the bag keeps
  COBBLE_RESERVE = 64 (the exit contract's reserve is never spent). A visit needs 8 spendable blocks.
- **The record** `<pool dir>/townfloor-<home>.json` (holder-written): placed and visit counters, stuck cells, and
  `noneAt` -- a visit that found nothing the town can reach holds every bot's order for an hour (no re-planning storm).
  The plan itself is not stored: the floor is a stock of holes, re-derived from the world each visit.
- **Rows:** `_town_floor` per visit (stage, placed, planned, refused, dropped, budget, left, why, ms) and
  `_town_floor_step` per block (at, block, stand, tier, L, home): the read checks every placed cell against the box.

### 2.4 The order (`floorOrder`, cognitive.mjs)
After every other order: the town deposit, the recount, wear-out, the composter, the junk well (close/dispose/build),
chest pruning and the room order all come first; a milestone conversion that is ready is never preempted (the loop
test proves the stone-pickaxe craft goes first). Fires at town, budget >= 8, no other live lease, the town not held,
not inside a well; 10-minute cooldown per bot; outcome backoffs: nothing to do 1 h, a fault 30 min, a lost lease 10 min.
Away from town it reads nothing (tested).

### 2.5 Composition
- **The zone (townzone-01, queued):** filled cells are terrain inside the zone box, so the zone refuses every target
  dig of them. **Without the zone, gather and the ore tunnel may dig the fill back** (cobblestone is a gather target);
  so the canary prerequisite is townzone-01 KEPT and promoted, and the read measures fill retention (region diff of
  placed cells) either way.
- **plinth-01 (queued, not on this base):** the plinth record's cells are keep-outs (above); the plinth's funding and
  the floor's are the same bag surplus -- whichever order runs first spends it; the plinth runs ahead of the town
  deposit, the floor after everything, so a town that wants a plinth builds it first.
- **stocktarget (fleet):** unchanged. The floor spends only bag surplus above 64; the town's 256 cobble cap and the
  "surplus refused to chests" rule are untouched. Chest withdrawal for the floor is NOT in v1 (bag surplus is 13,762,
  enough for weeks at the rate limit).
- **The junk well:** stays the overflow -- it runs before the floor in the cascade (34+ slots), the floor takes what
  is left at any bag size above the reserve.
- **digtown (fleet):** the floor never digs, so the `_dig_town` counters are unaffected.

### 2.6 What v1 deliberately does not do
- No digging, ever (the sealed voids under the floating lattice stay voids; they would need dig-and-rebuild).
- No edge stands (sneaking to the rim to see a deep pit's floor): a centred eye cannot see the floor of a pit 2+ deep
  past its rim, so such a pit is filled only if a stand reaches into it. v2 could add sneak stands (prismarine-physics
  clamps at edges while sneaking).
- No caps over voids (bridging the walking surface over an unfillable cavern). Not proposed: it seals a void.
- No chest withdrawal for funding.

## 3. Design (B): a first simple build -- design only
_(r1: proposal for review)_ The drowning check says a path ring would not reduce drowning (2 of 118 drownings within 16
of home). The first build that serves "cool structures" and needs no new mechanism beyond A: **a kerb**, a one-high
cobble wall on the box's boundary ring at L+1 with a 2-wide gap at the four cardinals -- 4 x 33 - 4 x 2 = 124 blocks
per town, built by the same planner (the cells are fixed targets, placed on solid ground, same stands/seal rules) once
the floor's tier 0 is done. It marks the town, keeps the fill visible, and is the blueprint builder's natural second
consumer. Not built in this change; both engines to agree it is cheap first.

## 4. Tests, mutants, sandbox, canary (r1: filled in as they complete)
## 5. Review record
