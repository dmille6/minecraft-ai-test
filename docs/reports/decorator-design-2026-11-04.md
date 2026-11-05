# The decorator: one bot a town that makes it beautiful (decorator-1104)

**Owner, 2026-11-04:** "along with a grounds keeper, could we use one bot to maybe just be a 'decorator' sole purpose is to make
things more beautiful. add flowers along paths, add decorations to buildings, unique and pretty things around our town first, then
expand out".

**Status:** the design is reconciled (Claude and Codex). The first piece, **decorator-01show**, is built on the live showcase
release `8b4ea9cc` as branch `decorator-01show`, tip `b73667ea`. It is ready to stage. Nothing is recorded, staged or installed.
The tripwire rules DC1–DC3 are on main in `docs/reports/shop-01-2026-10-25/shopread.py.txt`, reviewed by two engines. They are
not installed yet.

**The picture.** This is what the first piece would site on the showcase now: `decorator-design-2026-11-04/decorated-town.png`,
with the ASCII version in `decorator-design-2026-11-04/decorated-town.txt`. It comes from the bot's own code
(`bots/scripts/decor-offline.mjs`) run on a copy of the showcase world taken 11-04 at 23:11Z. The view is home ±36, north up.

---

## 1. Measured (showcase, 11-04; denominators and positive controls)

| What | Measured | Out of / control |
|---|---|---|
| Flowers in bags | **0** | 15 bots' newest snapshots, 8,991 items (control: spruce_planks 873, spruce_sapling 87 in 15 bags) |
| Flowers in town chests | **0** | 9 indexed containers, 2,268 items (control: stone_bricks 395, iron_ingot 299) |
| Bone meal in town | **8** | the same 9 containers; 0 in the 15 bags |
| Bone meal made | **9 in 7 days**, about 1.3 a day | 60 compost rows carrying the `bonemeal=` field, of 120 compost rows in 1.13 M skill rows (7 d) |
| Wild flowers | poppy 30 + dandelion 14 in the box | box x/z −160..160, y 50..100 (5.26 M cells), most of them inside the protected village 49..157 × −59..45; 4 within 40 of home |
| Ferns | fern 809 + large fern 940; **149 within 40** | the same box (control: short_grass 467, spruce_leaves about 68,000) |
| Clay | 3,730 blocks, 668 within 96 | in lake beds, under water |
| Flower pots, bricks, clay balls | 0, 0, 4 (in one bag) | bags + chests |
| Surface within 40 of home | grass_block 2,129 columns, dirt_path 187 | 6,561 columns |
| The park's flower gather | `GATHER_SKIP` on the showcase | 222 gather visits 11-03 found no free flower |

**Bone meal on grass, simulated** (Java `GrassBlock.performBonemeal`: 128 random-walk tries, 1 in 8 a biome flower): on open flat
grass a meal grows **2.8 flowers + 20 short grass**, almost all within Chebyshev 4. On a strip one block wide it grows about 1 flower.
**Measured in Paper** (sandbox6, taiga biome, 6 meals): **16 flowers (2.7 a meal), poppy and dandelion; about 17 short grass a meal;
the farthest new plant at Chebyshev 5.** The walk can reach Chebyshev 7 (`i/16` steps), so 7 is the guard's bound.

**What this means for supply.** At today's rate, flowers are limited by bone meal. The 8 meals in town, less the park's 4, give
about 11 flowers. The composter adds about 3.6 flowers a day. Ferns and spruce leaves are effectively unlimited, but only with
shears. Pots need clay that sits under water.

## 2. The design (Claude)

**One bot a town, on a lease.** The `decorator` lease sits on the decor record's key. It uses groundskeeper.mjs `keeperDecision`
with a 4 h term and a 1 h rest, and is let go when there is no work. A bot holding a grounds-crew lease never takes it, and the
decorator never takes a crew lease. While the decor wants work, **the holder's order is the decor**, behind repairs only.
`decorOrderPure` marks every other project full and owing no upkeep, so this gets past `activeProject`'s finite tier. No other
bot ever sees the decor plot.

**A fifth town sink, `decor`** (sinks.mjs; plot `decor`, blueprint `decor@1`, letter D). It is a growing record. Each instance is a
seeded batch of at most 16 ornaments, and every cell is a record cell. Zones are each ornament's own column. Batches are built by
the ordinary sink visit (`runVisit`).

- **Border.** A flower, or a fern when one is held, on the soil beside a laid path. Never on a path, another record's column, a door
  front (±2), a reservation (zones, corridors, park, farm, wells, plan cells, markers), a step over 1, or an occupied, snowed or wet
  cell. **The town's walls first** (wall.mjs `wallInteriors`: the ring and the extension), then ring by ring. Variety comes from the
  seed: the pattern (solid, alt or sparse; along a path the parity of x+z makes a rhythm), the colour scheme (mixed, warm, cool or
  sun), and the run length (4–8). Each run is one segment.
- **Pot.** A flower pot two columns past each end of a finished building's doorway. The blueprint's `doorway` is placed like its
  cells, and the storehouse uses its `door` and `front`. The pot stands on the apron or on the ledge of the step row, with the
  building's own wall cell behind it, so the way in stays clear. The proof walks the town again over the pots and drops any pot
  that would shut a doorway front. A pot is **filled** at the start of each decor visit: a flower, a fern, an azalea, or a sapling
  only above its reserve of 16. Border plants the open batch still owes are never used for a pot.

**The nursery** (the flower supply). It is a grass patch whose whole bone-meal reach (Chebyshev 7, and ±7 in height) holds no
reserved or recorded landing cell. A landing cell is every grass block with an open cell above, under an overhang too, and an
unread cell counts as a refusal. The search is one prefix-sum pass confirmed by `nurseryOk`; a brute-force test shows the same
answer. The nursery is published on the decor record (`nursery`, with old ones in `nurseries`) before any meal. On the showcase it
lands at −9,67,−33, outside the wall to the north, with 79 landing cells in its core.

A decor visit that is short of flowers does this, in order:

1. Takes bone meal above the park's 4.
2. Digs the short grass round the centre.
3. Uses the meal on the centre's grass block.
4. Harvests what grew (`_build op=clear kind=bloom`), up to the storage hall's cap of 32 flowers a type.

It runs before a new batch and whenever an open batch owes more flowers than the bag holds. **The flowers are kept**:
cropkeep.mjs drops the small flowers from `NEVER_KEEP` while the decorator is on, and the composter never takes one. Without
this, poppy and dandelion are junk the composter eats, and the peaceful kit composts every other flower.

**Nothing to do is not a loop.** A visit that places, fills, uses and harvests nothing stamps the decor as stalled. The stamp lasts
6 h for the bot and 2 h for the town (the no-site stamps). While it holds, the decor wants no decorator: the lease is let go and
no other bot takes it.

**Ownership.**

| Area | Owner | What the decorator does there |
|---|---|---|
| Lamps, wall torches, signposts | towndress | Its lights are kept 8 apart, and the dress reads every record's lights. |
| The park and its plants, terraces | the groundskeeper | The nursery refuses the park +1, the tidy's cells and the land plan's corridors. |
| Roofs, trim, windows, porches | townstyle-1104 | Nothing. Pots stand outside the building, against its wall, on no record cell. |
| Paths and road corridors | paths, land plan | Never on them. |

**Rollback.** `DECORATOR=off` removes the plot and the lease, and flowers become junk again. Dropping `decor` from `SINK_KINDS`
does the same for the plot. Sited ornaments stay guarded either way.

## 3. Codex's independent design (given the measurements and the goal, not the design above)

In short:

- **Lease:** reuse keeperDecision with mine, take, release, other and none; 4 h term, 1 h rest; exclusive with the keeper and
  helpers. Codex suggested **extending dress** rather than adding a fifth project. It said the holder needs explicit dispatch,
  because "merely reordering sinks cannot bypass activeProject's finite-project tier".
- **Supply:** the baseline is about 3.6 nursery flowers a day. Reserve four meals for the park. Use a nursery and transplant;
  bone-mealing the border directly wastes meal and spreads grass nobody controls. "Chebyshev four is typical spread, not a safety
  boundary": prove the full possible domain. Gather ferns with shears, and compost the surplus at about 11 ferns a meal. Keep
  saplings for the planters. Protect the nursery's flowers from the composter and from disposal.
- **First piece:** a seeded **spruce-leaf hedge** border of 6–8 cells, from the abundant leaves. After that: fern clusters, then
  the nursery and sparse flower accents, then potted saplings and ferns by entrances, then neighbourhood compositions.
- **Pots:** at D+n±3t, outside the dress's ±2 door exclusion.
- **Tripwire:** an exact cell and block for every mutation; record pot placement and plant insertion separately; log bone-meal use
  against a pre-authorised effect domain; "never exempt a whole bounding box".
- **Paper proof:** leaf persistence, fern drops, pot crafting, insertion and restart recovery, nursery spread and yield, snow,
  collection, lease races.
- **Top risks:** supply stuck in bags or composted; ornament reservations conflicting with grading or growth; random growth or
  interrupted multi-step actions escaping the accounting.

## 4. Reconciliation

| Point | Claude | Codex | Decided |
|---|---|---|---|
| Record | its own `decor` sink | extend `dress` | **Its own sink.** Dress is built by any bot and decor by one. The tripwire rules differ (meal, bloom, fill). It reuses dress's helpers (`cellGuard`, `pathColumns`). |
| Holder's order | decor first | explicit dispatch, since reordering cannot pass the finite tier | **Codex's point taken.** `decorOrderPure` marks every other project `free: false` with no upkeep. A mutant shows reordering alone fails. |
| First visible piece | flowers from the nursery | spruce-leaf hedges | **Flowers.** The owner asked for flowers; 8 meals in town give about 11 flowers now; and leaves need shears plus a Paper proof of persistence. Hedges are piece 3. |
| Spread bound | 8 at first | "4 is typical, not a bound" | **7** (the Java walk's maximum), measured at most 5 in Paper. Codex round-1 blocker: grass under overhangs and ±7 in height also counts. |
| Park reserve | none at first | reserve 4 | **Reserve 4** (`NURSERY.mealKeep`). |
| Pot spot | ±2 along the facade | ±3, outside the door exclusion | **±2.** One column stays clear between the pot and the way in, the building's own wall is behind it, and the proof keeps the front walkable. The ±2 door exclusion is for dress posts in the walkway. |
| Flowers composted | missed | top risk | **Fixed in piece 1**: cropkeep and composter keep them. |
| Bounding-box exemption | DC2 allows blooms within 7 of a nursery centre | never a box | **Bounded.** Bloom blocks only, never a record cell, marker, park or tidy cell (Claude review blocker). Meals are exact-cell (DC1) and fills exact-cell with a potted block (DC3). |
| Pots | in piece 1, supply-gated | after clay is proven | **In piece 1, gated on supply.** The showcase has 0 pots, so none are sited until clay arrives. Filling is proven in Paper. |

## 5. Paper facts and the sandbox proof

`sandbox/decor/decor-proof.cjs` on the piece branch drives the bot's own `botBuildEffects`. Results are in `decor-proof.jsonl`.
It ran on sandbox6 at 23:51Z and 23:52Z on 11-04, under the lock `decorproof`, which has been released.

| | Result |
|---|---|
| F1 | A poppy placed on grass by clicking the grass's top face. **PASS** |
| P1 | A flower pot placed on grass. **PASS** |
| P2 | The use click on the pot's top face with a spruce sapling gives `potted_spruce_sapling`; saplings go 20 → 19. **PASS** |
| P3 | The same with a poppy gives `potted_poppy`. **PASS** |
| N1 | Bone meal on grass, 6 meals on fresh taiga grass: 16 flowers, about 17 short grass a meal, farthest at Chebyshev 5. **PASS** |
| H1 | A grown flower harvested by walking into its cell and digging; it is in the server's inventory record. **PASS** |

Already seen live on the showcase: runVisit plant placements (sapling, azalea) and the park's meadow bone-meal use (2 rows).

**Not proven, and not needed for piece 1:** stair, trapdoor and lantern orientation (waits for townstyle's helper), leaf
persistence (hedges), fern drops with shears, and clay digging (under water: protected scope).

## 6. The pieces, their tiers, and where they queue

| # | Piece | Tier | Lane |
|---|---|---|---|
| 1 | **decorator-01show**: lease, flower borders, door pots, nursery, kept flowers | 2 (`protected.py`: not protected) | **Showcase.** Built and ready to stage. |
| 2 | **Fern clusters**: gather ferns and large ferns with shears near home (the park gather's machinery; shears from 2 of the town's 299 iron), as border accents and pot plants | 2 | Showcase, after piece 1's read |
| 3 | **Hedges and fence posts**: spruce-leaf hedges (shears; Paper proof of `persistent=true`), fence posts with a lantern on top (iron nuggets + torch; Paper proof that a lantern stands on a fence; counts as a light for the dress) | 2 | Showcase |
| 4 | **Compost drive**: the decorator composts its surplus ferns, grass and leaves for more bone meal (Codex: about 11 ferns a meal) | 2 | Showcase |
| 5 | **Oriented ornaments**: window boxes (trapdoor + flower), benches (stairs), arches | 2 | After townstyle's orientation helper lands |
| 6 | **Unique pretty things per town**, seeded like the towers: a gazebo, a well-head canopy, a statue, a hedge maze | 2 | Later |
| 7 | **Water features** (fountains, ponds) | 2 | After bucketfix-01 |
| 8 | **Banners** | 2 | After sheep pens |
| 9 | **Pots at scale**: clay | 3 (under water) | Fleet canary or owner decision |

**Queue placement (Claude):** fold piece 1 into the next showcase batch. It sits outside protected scope, its rules are separate
(DC1–DC3), and it does not depend on townstyle; the two only meet at building faces, where pots never touch record cells. It needs
the DC1–DC3 rule installed in the same activation, or the tripwire's H2 trips on the first harvest. **Codex's view:** the fleet
gets none of this until the showcase shows a visible goal; its order is fern and leaf work before more flowers. **Reconciled:**
showcase only for now (`DECORATOR_POOLS` defaults to `showcase`); pieces 2 and 3 come next, after piece 1's 2 h read.

## 7. Tripwire rules (shopread.py.txt on main)

`decor` is added to `SINK_PLOTS`, so its placements are judged by G1 and its clears by G2 against the generations in force. Three
rules are added:

- **DC1 meal.** `_build op=meal` is on the record only on a nursery centre (`nursery.at`, or an entry in `nurseries[]`) of a
  generation in force. Anything else is off_record, tagged ` meal`. A meal counts as a mutation, so G3 judges it.
- **DC2 bloom.** `_build op=clear kind=bloom` must be a flower or the grass a meal leaves, within 7 columns (8 in height) of a
  nursery centre in force. It must never be a record cell or a marker that stood then (` guarded`), in the park's box +1
  (` in_park`), or a cell of the tidy head (` tidy_cell`). Anything else is clear_outside, tagged ` bloom`.
- **DC3 pot.** `_build op=place kind=pot_fill` is on the record only as a `potted_*` block on a pot cell (role `D<n>-pot`) in
  force. Anything else is off_record, tagged ` pot`.

The selftest passes, with positive controls for every refusal. There are 3 in-file mutants plus file-level mutants: the pot
branch, the meal branch, the bloom branch, `SINK_PLOTS`, the meal mutation, in_park, tidy_cell and guarded. A copy check
compares `DECOR_SPREAD` and `DECOR_BLOOMS` against decorator.mjs and park.mjs. Reviews: Codex in the code review found no
tripwire blocker. Claude's first round found one blocker (DC2 lacked the park and tidy refusals), which is fixed; its second
round says FIXED and finds no new blocker. **Install it with piece 1's activation.**

## 8. Owner decisions

1. **Ferns from the wild** (piece 2): the decorator would cut natural ferns near home with shears and replant them beside paths.
   This is fine under "bots changing the world is wanted". It costs 2 iron ingots for shears. Yes or no?
2. **The park's bone meal:** keep its 4 (the default), or let the decorator use all of it?
3. **Pots:** they need clay from lake beds, which is under-water digging. Make that a fleet canary (tier 3), or skip pots and use
   potted saplings only once pots arrive by trade or expedition?
