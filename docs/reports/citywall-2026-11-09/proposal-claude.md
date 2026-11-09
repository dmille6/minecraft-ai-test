# Town wall upgrade + landmarks: Claude proposal (2026-11-09)

## 0. Facts from the records that shape the design

- **The "main road" gate is not a crossing.** In `wallext.g5` the 18 `gate/road` columns (x=35, z -38..-21) exist because the land record's
  ring-road corridor boxes (`[32..35, -35..-28]`, `[30..35, -36..-34]`, ...) touch the wall line. The ring road itself runs *parallel*
  and inside, on x=33..34, and no road cell sits at x>=35 there. The real eastward exit is spoke **s1** at x=35, z -3..-2. It runs through a
  6-wide `reach` gap in `wall.g6` (z -6..-1), and the open tower T3 zone `[36..52, z -20..-4]` sits right against it.
- **Corners are mostly gaps.** wall@1: NW is the monument gap, NE is a pit, SE is `open/short`, and only SW (-46,39) is wall. In wallext,
  NW is `reach`, NE is a pit, and the S corners are joins.
- **The O-column profile** (body cells, y-b): -1:9, 0:58, 1/2/3: 215 each, merlon b+4: 131. That makes 843 O cells over 215 body
  columns in 24 runs of 5-12. Steps: 612.
- **The walls are 1 block thick.** "Re-facing" is therefore the same as replacing: there is no inner core to keep.

## A. Wall upgrade

### A1. Target cross-section (per body column, outside on the left)

```
 y      O (wall)                 S2 (walk)   S1 (fire-step)
 b+5   [lantern] on run-end merlons only
 b+4   MERLON stone_bricks / crenel air  (unchanged rhythm: every other col + run ends)
 b+3   BAND   deepslate_bricks           cobble (kept)
 b+2   BODY   stone_bricks (~10% mossy)   cobble top -> stone_bricks (phase 6)
 b+1   PLINTH deepslate_bricks           cobble        cobble top -> stone_bricks (phase 6)
 <=b   FOOT   deepslate_bricks           ground
       (+ phase 5, outside face at b+3: upside-down stone_brick_stairs corbel under each merlon, road-facing runs only)
```

Palette roles, chosen by seed per town (`wallStyle(seed, stock)`):
- **"grey"** (the showcase): stone body, deepslate plinth and band.
- **"dark"** (the fleet default when cobbled_deepslate covers more than 1.1x the bill): deepslate body, stone band and merlons. Deepslate
  bricks need no fuel: two 2x2 crafts take cobbled -> polished -> bricks at 1:1. The fleet holds about 14k cobbled deepslate against about
  3.4k cells per town-ring, so most towns can be dark.
- **"mossy"**: grey with 25% mossy in the plinth (stone_bricks + moss_block, a shapeless craft; showcase has 188 moss).

Mossy cells are placed by `hash(seed,x,y,z) < p(y-b)`, with p falling from 0.25 at the plinth to 0 at the band, so the moss "rises from
the ground". Crenellation stays as built: merlon on alternate columns and at both run ends. That keeps the one-way crenel escape (walk -> crenel ->
drop 3) that `wallEscape` already proves.

### A2. Towers

Footprint: **3 along the wall x 3 deep**. The tower's in-line row *is* three O columns, and the other two rows project **outside**. It never
sits on the steps, never on the inside plan, and never in a zone. Cells:
- courses foot..b+5 solid, with the hidden centre cell cobblestone (it uses junk)
- outer face deepslate_bricks (grey style) with stone-brick quoins on the two outer corners
- merlons at b+6 on the 4 corners plus the outer-middle cell
- one `iron_bars` arrow slit at b+2 on the outer face
- one standing lantern on the outer-middle merlon

Top floor feet are at b+6, so a bot that gets up there drops 3 to the walk (feet b+3) with no damage.

Build order (all faces visible, no scaffold):
1. Courses <= b+2 are placed from the outside ground.
2. b+3..b+4 are placed from the wall walk (eye b+4.62 sees top faces up to b+4).
3. The builder steps up 1 onto the tower's in-line b+4 cells (feet b+5) and places the b+5 course on visible top faces.
4. The builder steps onto b+5 and places the merlons and the lantern.

Bill per tower: about 38 bricks + 7 cobble + 1 lantern + 1 iron_bars.

Siting (`towerSites(rec)`):
1. A ring corner whose column is `wall`.
2. Where a corner is a gap: the **first wall column of each run that faces the corner gap**, within 6 columns of the corner. At most one per
   side, so a gapped corner reads as two flanking bastions.
3. Both flanks of the gatehouse.
4. A side with more than 40 wall columns and no tower gets one at its middle run's end.

Every candidate's two outside rows must be clear of zones, paths and water. If not, it falls to the next run end.

Showcase sites: SW corner (-46,39); NE wallext run end near (35,-89); NW wallext run end near (-40,-89); SE run end near (35,28). That is
4 towers, plus 2 at the gatehouse.

### A3. Gatehouse

The design is parametric in passage width P (P = the opening's width; the gate keeps every column open from the ground to g+3).

```
 plan (P=6, wall line = row O, outside up)     elevation from outside
   T T T . . . . . . T T T   <- outer row       m . m . m  m . m . m      (m merlon, b+6)
   T T T d d d d d d T T T                      T T T = = = = = = T T T   deck top feet g+5
   T T T d d d d d d T T T   <- row O           T T T v . . . . v T T T   v upside-down stair haunch at g+3
   (towers 3x3)  (deck 3 deep at g+4)           T T T . . L L . . T T T   L hanging lantern, outer row only
                                                ----- road g ------
```

Parts:
- **Deck:** stone_bricks at g+4, 3 deep, where g is the highest ground across the passage. Headroom is g+1..g+3, three blocks.
- **Edges:** merlons on the deck's outer edge and a stone_brick_wall parapet on its inner edge.
- **Arch:** a **chiseled_stone_bricks keystone** at the deck's outer-face centre, plus upside-down stone_brick_stairs **haunches** at g+3
  in the passage's two edge columns, outer and inner face. Feet g+1 and head g+2 stay clear under them.
- **Portcullis look:** iron_bars slits in the towers, never across the passage.
- **Lights:** hanging lanterns under the deck's **outer** row only (off the path cells), every 3 columns, plus the tower lanterns.

Build method:
- The deck is built **from the road underneath**. Each deck cell is clicked on the passage-facing side face of the tower, or of the last
  deck cell. The builder stands in the passage in front of that face (eye g+2.62, so the face is visible and about 2.5 away). The deck
  cantilevers in from both towers and closes in the middle. The passage stays open the whole time, because the builder is standing in it.
- Parapets and merlons are then placed from the deck itself, which is walkable once it closes.

Bill:
- P=6: 2 towers (76) + deck 18 + parapet and merlons 9 + 4 haunch stairs + keystone = **about 110 bricks**, 4 lanterns.
- P=18 (the "long gate"): deck 54 + edges 27, so **about 160 bricks**.

Showcase siting: we need an owner decision.
- **(a) Default: the east "road" opening**, as a *long gate*: P=18 over the ring-road corridor. It is ceremonial (the road runs alongside
  it, not through it), but it is the most visible place and the owner named it. Nothing below g+4 is touched, so the corridor's
  reservation is respected.
- **(b) The real exit, s1 at z -3..-2.** This conflicts with the T3 tower zone on its north flank. The north gate tower would have to wait
  for T3 to close or be re-sited.

Recommend (a) now, with `gateSite()` choosing by measured crossings for the fleet. That is the same crossing observer bridges uses.

### A4. Lights

1. A **standing lantern on top of each run's two end merlons**, so every sally port and gate is flanked by a pair of lamps. That gives a
   rhythm instead of a spray.
2. One lantern per tower and gatehouse lanterns as above.
3. `LIGHT_ICE_R` (3, taxicab) is respected near the N/SW ice: there the run end gets a **wall_torch** on the merlon's inner face
   instead (light 14 vs 15).

Showcase count: 24 runs x 2 = 48, plus 6 towers and 6 gate lanterns, minus those near ice: **about 55 lanterns**. Stock is 12 lanterns.
Each lantern is 8 nuggets + 1 torch, so the 43 to craft cost about 39 iron ingots (85 in stock) and 43 torches (63 in stock).

A merlon top is at b+5 and the walk eye is at b+4.62, so the click is **blind** (risk C2). The fallback is a wall_torch on the merlon's
inner face, which is visible from the walk.

### A5. Retrofit: never a gap

Method: **in-place swap, one cell at a time, from outside.**
- The builder stands on the outside ground (eye about b+2.62 sees and reaches every O cell's outer face from the foot up to the b+4 merlon).
- It digs a cobble cell, then immediately places the brick. The support is the cell below's top face, a neighbour column's side face, or
  the merlon's underside, all chosen by the existing `stepFor` solver.

Per-column order: top-down (merlon, band, body, plinth, foot). Invariants:
- **at most one open cell per column**
- **never two open cells vertically adjacent in neighbouring columns**

So the worst transient is a 1x1 hole in a 4-high wall. That is not a passage (a bot needs 2 high) and it is not visible from a distance.
If a visit dies mid-swap, the hole is an ordinary open record cell, which repair fills.

Record expression: **one generation per active segment.**
- `restyleGeneration(rec, segs, style, stock)` bumps the generation and marks every cell of the active segments (at most `builders_max`,
  each a run of up to 12 columns) as `{at, role, seg, replace:'cobblestone', want:'stone_bricks', st?}`. The tripwire treats a dig of a
  `replace` cell as allowed, and a dig of any other built cell as HARM, exactly as today.
- When the segments read done (every cell matches its new palette), the next generation moves the `replace` set on. No more than about 24
  O-cells of cobble digs are licensed at any time.
- New cells (towers, gatehouse, corbels, lanterns) are added like reroof's roof: pure additions in the same record. They are proven with
  `proveSite` over the added cells, and the tower/gatehouse cells are checked by `wallEscape`, which must report `cut=0` and `trapped=0`.

Cobble that comes out (about 840 on the showcase) is ordinary drops. The digger picks it up, the tower cores take about 50, and the rest
goes to the yard and well by the normal rules. It is surplus, so no special banking is needed.

Steps: keep them cobble (they are behind the wall and hidden from outside). Phase 6 optionally swaps only the **top** cell of S1 and S2 to
stone_bricks (430 cells) for the top-down picture, same method, stood on from inside.

### A6. Phases (each one ends looking finished)

1. **Gatehouse** (the long gate east).
2. **The 4 towers.** A grey wall with brick bastions looks like a deliberate mixed-material castle.
3. **Re-face the runs, spreading outward from the towers and gate.** The runs adjoining them go first, and each run is finished whole (one
   segment) before the next starts.
4. **Lanterns per run**, as each run completes.
5. **Corbel table** on the road-facing runs (east and wallext north): about 60 upside-down stairs.
6. **Optional walk paving.**

### A7. Showcase bill

| item | stone_bricks | deepslate_bricks | other |
|---|---|---|---|
| runs: band 215, plinth + foot 282 | — | 497 | — |
| runs: body 215 (~22 mossy), merlons 131 | 346 | — | 22 moss_block |
| 4 towers + 2 gate towers | 60 (quoins, merlons) | 168 | 42 cobble, 6 iron_bars |
| long-gate deck + edges + arch | 160 | — | 1 chiseled |
| lanterns | — | — | ~55 (43 crafted) |
| corbels (ph5) | 90 (60 stairs) | — | — |
| **total** | **~656** | **~665** | |

Against stock: stone_bricks 582 plus stone 312 gives 894, and deepslate_bricks 288 plus cobbled_deepslate 1,010 gives 1,298. **Fits
without new smelting.** Phase 6 would add 430 bricks.

The fleet, about 2,000 cells per town, needs the "dark" style. Its bricks come from cobbled deepslate (no fuel) and the cobble core
absorbs junk.

## B. Landmarks catalogue

Common rules:
- Every landmark is a record with seeded `design`.
- Bills are stone-first, because the showcase has only about 110 spare logs above the 512 reserve.
- Cells are solved by `stepFor` and no stand is ever above a structure's own top.
- Each landmark is sited on an existing plan box. It is never on paths or zones and never within 3 of the wall's steps.

### B1. Plaza and fountain. Rank 1

**Site:** the core plaza, x -6..6, z -6..6 (13x13). The paving skips any record cell already there (home chest, well).

```
 D D D D D D D D D D D D D     D deepslate_bricks border, lamp post at each corner
 D s S s S s S s S s S s D     s/S stone / stone_bricks checker (seed: checker | rings | radial)
 D S . . . . . . . . . S D
 D s . R R R R R . . . s D     R rim stone_bricks at g+1
 ...   R w w w R           w water (8 cells), P centre pillar: stone_brick_wall g+1..g+2,
       R w P w R             slab cap g+3, 1 water source on the cap (spout)
       R w w w R
       R R R R R
```

Variants:
- paving pattern: checker, rings, or radial
- fountain: spout, pool only, or dry (a lantern pillar)
- rim: full block, or stairs facing out to make a bench

Use: an **infinite water source** (2 buckets into the basin, then the infinite-source rule fills it) that bots refill buckets from. That
serves obsidian casts and gives the park and garden cane water (both records show `cane: no_water`). The paving also replaces the
grass-and-dirt scatter the top-down picture shows at the town centre.

Bill: about 145 paving, 16 rim, 9 floor, 2 walls, 1 slab, 4 lamp posts (8 walls + 4 lanterns), 2 water buckets. **About 180 bricks.**

### B2. Well house over the town well. Rank 2

**Site:** the well record's rim box (WxW, W 3..5), with the opening untouched up to rim+3.

- 4 corner posts (stone_brick_wall x3, or spruce log x3 when wood allows)
- a lintel ring of stone_brick_slab (top) at +4
- a hip or gable roof of deepslate_brick_stairs with a slab ridge
- 2 hanging lanterns on the lintel corners (never over the opening)

Variants: roof hip or gable; posts wall or log; lantern chain length 0 or 1.

Use: it *is* the junk/water well. Deposits are unchanged and the well becomes findable. Bill: about 50 stairs or slabs and 12 walls.

### B3. Market cross and stalls. Rank 3

**Site:** the market record's square.

- **Cross:** a 3x3 stepped base of deepslate_brick_stairs facing out, a centre pillar of stone_brick_wall x3, chiseled_stone_bricks on
  top, and a lantern.
- **Stalls:** 2-4 of them, each 3x2: a stone_brick_slab (top) counter on walls, 2 log posts, and an awning of spruce trapdoors (open=false,
  placed on the posts' side faces).

Variants: cross height 3 or 4; stall count; awning trapdoor or slab.

Use: the market's exchange point. A trade or request served at a stall cell logs its site. Bill: about 40 bricks per cross; per stall
6 slabs, 2 logs and 3 trapdoors (about 8 logs for 4 stalls).

### B4. Lighthouse on the north lake shore. Rank 4

- **Shaft:** 5x5 at the base, stepping to 3x3 at +8, 14 high, with alternating 2-course bands of stone/deepslate bricks.
- **Lantern room:** glass_pane walls at the top and 4 lanterns inside.
- **Climb:** an internal ladder is the builder's stand (ladders have not been proven here, see C5).

Variants: banding; round-chamfer or square; gallery of slabs or walls.

Use: a navigation landmark for expeditions. It is honestly mostly a picture. It sits outside `LIGHT_ICE_R` of ice it should not melt.
Bill: about 190 bricks, 16 panes, 4 lanterns.

### B5. Belfry and watch tower at the plaza's north edge. Rank 5

5x5, 12 high, with deepslate corners, stone walls, 4 open belfry arches (haunch stairs) and lanterns.

- **No clock:** a clock needs gold (none in stock) and an item frame (unproven).
- **No bell:** bells cannot be crafted. A trade is possible later.

Use: the town's rally point, with a top stand that doubles as a builder stand for later overhead work. About 220 bricks.

### B6. Park pavilion. Rank 6

**Site:** the park box (x -41..-34, z 24..32).

5x5 with 4 log posts, a stair roof, slab benches and a hanging lantern. Variants: roof form; bench layout. Use: none functional.
About 12 logs and 40 stairs.

### B7. Copper statue. Rank 7

A 3x3 deepslate plinth topped by a 2-wide figure, 5 tall, made of copper blocks (182 ingots gives 20 blocks). It **weathers green over
weeks**, so it is a living landmark. Site: a path junction. Use: none.

**Build first:** B1 plaza and fountain, B2 well house, B3 market cross. They are central, cheap, stone-only, and each has a measurable use.
The fountain's water is gated behind sandbox proof C1; until then the plaza ships with the dry variant.

## C. Risks: unproven on Paper and mineflayer, with a proof for each

1. **Water source placement and containment (fountain).** Proof: on Paper, a bot empties 2 buckets into a built 3x3 basin. After 10 s,
   all 8 cells must read source. The spout's flow must stay inside the 3x3 for 120 s (scan 7x7x4). 3 bots refill buckets from it 20
   times with no level drop.
2. **Blind lantern on a merlon top** (eye below the face plane). Proof: 40 lanterns, accepted plus standing state. Fallback: wall torch
   on the inner face.
3. **The swap dig under the tripwire.** Proof: a 60-column swap on Paper with shopread live. Expect 0 HARM. `wallEscape` reach0 must equal
   reach1 before and after, with trapped=0. Assert the one-open-cell invariant from the read-back.
4. **Deck cantilever from below** (a side-face click with the eye 1.4-2 below the face), plus hanging lanterns under it, plus the
   pathfinder routing through a 3-high covered passage. Proof: build P=6 and P=18 on Paper. 50 bot crossings with 0 stuck. The pathfinder
   must never path onto the deck.
5. **Height above 10** (lighthouse, belfry). Proof: a 14-high build with an internal ladder as the stand. Count falls and deaths, and
   check that the ladder state (facing from the clicked face) and scaffold removal work.
6. **Crafting chains:** mossy_stone_bricks (moss + brick), the cobbled -> polished -> deepslate brick chain, lanterns (nuggets), chiseled
   bricks (2 slabs). Proof: each run by a bot's own craft call.
7. **Excluded unless proven separately:** item frames and clocks (entity placement, gold), bells (not craftable), campfires (burn bots),
   signs on walls.
8. **Light vs ice:** lanterns melt ice within about 3. That changes the lake terrain the bots swim. Proof: a scan around lights after 24 h.
9. **Stock contention:** the wall bill takes about 70% of the showcase's brick stock. Towers T1-T3 and roads compete for it. The design
   needs a stock gate: a run's generation opens only when its full bill is in town.

## D. Effect metrics

- **wallrestyle:**
  - `wall_restyle` rows per segment: {seg, swapped, mins, builders, harm=0}.
  - KEEP if ring-line crossings per bot-hour through the openings (the crossing observer) stay within -10% of the 3-day pre baseline,
    `wallEscape.trapped=0`, and deaths within 8 of the ring are not above control.
  - Worth: builder-hours absorbed from `no_work_now`, and the fraction of O cells in brick.
- **walltower / gatehouse:** `gate_cross` rows under the deck (must be greater than 0 and not below pre), and 0 `stuck` events in the
  gate box.
- **plaza/fountain:** `bucket_fill` rows at fountain cells (more than 0 per day by day 2), and cane planted from it.
- **wellhouse:** junk deposits at the well per day not below pre (no regression).
- **market cross:** trades or requests served at stall cells per day.
- **lighthouse, belfry, pavilion, statue:** no bot metric. Declared as `owner_verdict` (picture approved), plus `landmark_repair` rows as
  the cost.

## Pure functions to write

- `wallStyle(seed, stock)`
- `restylePalette(style, seed, cell, b)`
- `swapPlan(rec, segs)`, which carries the order and the one-open invariant
- `restyleGeneration(rec, segs, style)`
- `towerSites(rec, zones)`
- `towerCells(site, style)`
- `gateSite(recs, crossings)`
- `gatehouseCells(site, P, style)`
- `runLights(rec, iceAt)`
- `wallBill(rec, style)`
- one `<kind>Cells(site, design)` and `<kind>Site(plan, taken)` per landmark
- `landmarkUse(kind, events)`

All are tested by behaviour: escape proofs on synthetic rings, `stepFor` solvability for every cell, bills against counts.
