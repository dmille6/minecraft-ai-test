# Copper hall: the showcase landmark (showcase item 5), design 2026-11-01 (r2)

OWNER 11-01 ~22:15Z: "lets do 1,2,3,5, then work on 4". Item 5 is a **landmark copper hall** on the showcase. Item 4, the
whole-map expeditions, has its own design: [`wholemap-expeditions-design-2026-11-01.md`](wholemap-expeditions-design-2026-11-01.md).
The hall is designed to **serve item 4**: inside it are the expeditions' kit depot and a map room.

This is a design only. It changes no code, stages no showcase piece and touches no world. Every measurement is read-only,
taken on the showcase VM on 11-01 between 21:50Z and 22:15Z. The sources:

- the project records in the pool directory
- the town index
- the bots' skill logs, read with `scripts/lib/telemetry.py` (full walks)
- the server logs
- the region files

**r2** fixes four blockers from the two-engine review (§11):

- **the domain** (Codex): the old site was refused by the siting code's distance limit.
- **eave reach** (Codex and Claude): builders could not reach the eaves.
- **the reserve stall** (Claude): copper draws would have locked themselves out.
- **the over-door eaves** (Claude): they rested only on the copper lintel.

The r2 geometry is **proven by `buildsite.mjs proveSite` on a flat test world**: shell first then copper, and copper last
(§2.3).

---

## 0. Answers first

| | |
|---|---|
| **Site** | The town plan's **`hall` plot, sector SW** (planned, never built). It sits inside the wall, between the tree farm and the south wall: **pad x -21..-7, z 21..33**, stand ring x -22..-6, z 20..34, the wall at z 36. The ground is a lower terrace: median y 66, p10 65, p90 69, about 4 below the plaza. |
| **Size** | **Pad 15 x 13**, with the walls set back one cell (13 x 11), as house@1 is. A step ring at s+1 runs outside the walls. **Walls two courses, roof at s+3.** **477 cells.** Interior 11 x 9 x 2. It is the largest building in the town (house 7 x 7, workshop 9 x 7). |
| **Blueprint** | `hall@1`, in the house@1 / workshop@1 cell format (`u, v, y, role, seg`), plus two copper segments with **no fallback material**. Draft: [`copperhall-2026-11-01/hall@1.draft.json`](copperhall-2026-11-01/hall@1.draft.json). Generator: `make_hall.py`. |
| **Palette** | Stone-brick pad, step ring, base course and eaves. Spruce-plank upper course and roof. Glass panes in the bays. **10 cut-copper pilasters** (both courses), **10 cut-copper caps** in the eave line, and **a 3-cell copper lintel** over a 3-wide doorway. Unwaxed, so it **weathers by itself** from orange toward green. |
| **Bill** | stone_bricks 306, planks 117, cut_copper 33, glass_pane 13, torch 4, chest 4. **Copper: 33 cut copper, 297 ingots** (9 each: 36 ingots → 4 blocks → 4 cut). |
| **Copper stock now** | The town chests hold **130 copper_ingot + 10 cut_copper + 3 copper_block** (latest `obs` per chest, 9 chests). The reserve code counts **loose copper_ingot only** (`mats.mjs reserveKeyOf`), and the project floor is 20% of the 512 reserve, **103** (`reserve_draw floor_effective=103`). **Spendable now: 27 ingots**, less than one cut-copper batch (36). |
| **Opening rule** | The hall is **sited only when** `copper_ingot ≥ 103 + 36 x ceil((33 − cut_copper in town) / 4)`. Today that is **103 + 216 = 319**. Every copper draw then lands inside one active project window, so the 24 h stall rule (`PROJECT_STALL_MS`) cannot lock them out. |
| **Copper rate** | `smelt_town` made **403 ingots in 7 days**, but 194 of those came on 10-30 with the shaft on. Since SHAFT went off (10-31, 11-01) the rate is about **25 a day**. **The binding input is coal**: 1,302 smelt jobs stopped with "no coal in the town containers" in 10 days. |
| **Time to open** | **189 ingots short.** That is **about 7–8 days** at today's 25 a day, **3 days** at the 7-day mean (58), and 1–2 days at the shaft-on rate that item 2 (shaft + deep miner) should restore. **Build time once open: 5–10 active hours.** |
| **Interior purpose** | **The Expedition Hall.** (1) Four **depot chests** (two on each side wall) hold the trip kit: torches, cobble, and boats from S2. (2) The **9 x 9 inner floor** becomes **a physical map of the world**: each cell stands for a 1,111-block tile and changes block as the bots *see* that tile (v2, after expedition S0). (3) It is where showcase chat announces a trip's return. |
| **Lighting** | Four floor torches in the interior corners, plus the windows. Lanterns wait for spare iron. Copper bulbs need a blaze rod, which is out of reach. |
| **Camera** | `copperhall` centred about (-14.5, 68, 27.5), distance 50, `every: 2`, the doorway toward the camera. A slow `patina` close-up runs `every: 8`. |
| **Starves nothing** | Only the hall draws copper (the storehouse and house trim are complete), and only down to the 103 floor. The stone bricks come from the town's 1,000 cobble. The 80% rule applies to project draws only. |
| **Order** | After showcase items 1–3; the copper accrues while they are built. See the whole-map doc §10 for the order across everything. |

---

## 1. Site

### 1.1 What the plan says

The showcase town plan (`townplan-0_70_0.g27.json`, the same as `infra/showcase/town-plan-preview.json`) has ten plots:

| plot | sector | built as | state 11-01 |
|---|---|---|---|
| core | plaza | — | planned |
| store | core | storehouse@1 (-15..-8, -4..3) | complete 11-01 |
| work | core strip | stations | in use |
| well | E | junk well | in use |
| farm | S | composter (-1,71,9) | in use |
| gate | N | wall gate | complete (wall@1) |
| shaft | NE | — (SHAFT off since 10-30; showcase item 2) | planned |
| monument | NW | ziggurat@1 (-55..-26, -43..-14) | complete |
| pavilion | SE | **workshop@1** (20..28, 26..32) took the sector (buildsite D1) | complete |
| **hall** | **SW** | **nothing** | **planned** |

Two other records have no plot: house1 (W, -39..-33, -9..-3) and treefarm (-39..-23, 4..20). The wall ring is x -46..35,
z -20..39; its cobble stands at z 36..39 on this side.

### 1.2 The footprint and its domain

The pad is **x -21..-7 (u 0..14), z 21..33 (v 0..12)**, orient `E` (u along +x, v along +z). The doorway is in the front wall
(v 1, z 22), facing north toward the plaza.

- **Clearances:**
  - tree farm (x ≤ -23, z ≤ 20): the ring's west column is x -22, so one column stays clear. The pad was moved 3 east of the
    first r2 draft so the ring does not touch the tree farm's box.
  - wall: z 36, one free row beyond the ring.
  - storehouse and workshop: far away.
- **Ground** in the pad + ring (255 columns): median **y 66**. Of the top blocks, 228 are grass, 7 dirt and 6 spruce logs (trees,
  which the builder fells in project cells, per owner 10-27). The rest is a little gravel and stone, plus one bot crafting
  table, which is litter that `FOREIGN_CLEAR` clears. Fill is at most about 5 at the lowest cells.

**The domain (r2, Codex blocker 1).** `buildsite.mjs` `screenSite` refuses every cell outside `inDomain`, which allows
**Chebyshev ≥ 22 and straight-line ≤ 44 from home**. The r1 corner (-38, 32) was 49.7 out. This pad's far corner (-22, 34) is
40.5, which is fine. But its **near edge** (z 20..21 with |x| < 22) is **Chebyshev 20–21**, so it fails the ≥ 22 half.

No 15 x 13 pad in the SW quadrant passes both halves without crossing the wall. So the hall does what storehouse-01 does
(`storeSite` + `storeDomain`):

- **Its own siting** (`copperhall.mjs hallSite`): a fixed pad on the plan's hall plot.
- **Its own stand domain** for `proveSite`: the wall record's inside box, minus every other record's box (+1).
- **One small change**: `screenSite` takes an optional `domain` argument, default `inDomain`, so the hall's column checks
  (reservations, zones, earthwork) are the same code as the house's.

If siting fails (relief, a reservation or a zone), the record says why and the owner hears within 3 h (the fun-mode stuck rule).
The hall never falls back to any other place.

### 1.3 Alternatives considered

| alternative | rejected because |
|---|---|
| Outside the wall on a hill (a skyline landmark) | no plan plot, no wall protection, and paths would need a new gate |
| Replacing the pavilion | the workshop took that sector |
| Beside the plaza | no room: core is 13 x 13 keep-out |

---

## 2. The blueprint (hall@1)

The cell format is that of `bots/src/blueprints/house@1.json`: `footprint`, `pad`, `front`, `doorway`, `interior`, `palette`,
`segments`, `structural`, and `cells[{u,v,y,role,seg}]`. The draft also carries `mapfloor` (§7). It was generated by
[`copperhall-2026-11-01/make_hall.py`](copperhall-2026-11-01/make_hall.py). It is **not** in `bots/src/blueprints/`, so no
bot loads it.

### 2.1 Layers

| y | content | cells |
|---|---|---|
| 0 | pad: stone_bricks, 15 x 13 | 195 |
| 1 | **step ring** outside the walls: stone_bricks, open in front of the doorway (u 6..8) | 49 |
| 1 | wall course 1: stone_bricks; the 10 pilaster cells cut_copper; doorway u 6..8 open | 31 + 10 copper |
| 2 | wall course 2: planks, with glass panes in alternate bay cells; pilasters cut_copper; doorway open | 18 + 13 windows + 10 copper |
| 3 | **eave line** over the walls: stone_bricks, with **pilaster caps** cut_copper (10) and the **lintel** cut_copper over the doorway (3); **roof-inner**: planks, 11 x 9 | 31 + 13 copper + 99 |
| 1 (inside) | 4 floor torches in the interior corners; 4 depot chests, at (u 2, v 4/8) and (u 12, v 4/8) | 8 |

**Total: 477 cells.**

- **Pilasters** stand at the four corners, at u 5 and 9 on the front and back walls, and at v 6 on both side walls.
- **The doorway** (3 wide, 2 high) sits between the u 5 and u 9 pilasters, so the entrance is framed in copper.
- **The shell without copper** is the remaining **444 cells**.

### 2.2 Segments and their order

```
pad -> ring, wall-F, wall-B, wall-L, wall-R -> roof-edge -> roof-inner -> fit-out
   \-> copper-trim (deps: pad, ring) ---------------------------\-> copper-lintel (deps: roof-inner, copper-trim)
```

**The copper segments carry no fallback material.** The storehouse's `corner` role falls back to stone bricks. On a landmark
that would freeze the copper look out for good, because a placed cell is never rebuilt.

- **The lintel is its own last segment.** It is placed off the roof-inner cells behind it, and **nothing rests on it** (r2 fix
  for Claude's blocker 1b): the cells beside it are copper caps and roof cells, which have their own supports.
- **The shell does not wait for copper.** It completes without any copper cell placed. The opening rule (§0) still means the
  copper is in the town before the project opens.

### 2.3 Reach: proven

The r1 geometry (walls flush with the pad edge, roof at s+4) failed. `stepFor` clicks only a side face or the face below a
cell, and the builder's eye (s+2.62 from the pad) was below the wall tops. Both reviewers found it; Claude ran `stepFor` and
saw every eave return null.

r2 is house@1's shape, scaled up:

- **The walls are set back one cell**, and a **step ring at s+1** stands outside them.
- **A builder on the step** (feet s+2, eye s+3.62) sees the wall-top faces at s+3 for the eave line.
- **Roof-inner cells** are placed from inside, off their neighbours.
- **Nothing is above s+3.** r1's lightning-rod crown had no stand and is dropped.

**Proof** (`buildsite.mjs proveSite`, flat grass world at y 69, home 0,70,0, the hall's own domain, s = 70, orient E,
anchor -21,21). The test script is in the session scratch and is not committed:

| run | result |
|---|---|
| **full blueprint** in segment order | **ok**: every segment placed, interior 95/95 open cells reachable from town |
| **shell without copper** | **ok** |
| **copper last** (the shell, roof and fit-out first, then copper-trim, then the lintel: the order the visit takes when copper arrives late) | **ok**: copper-trim 30 cells from 16 stands, lintel 3 from 3 |
| **control: r2 without the step ring** | **no_step** at the first copper pilaster at s+3 (`copper-trim 10 left`) |

The control proves the check can fail and that the ring is what makes it pass.

**What a flat world does not prove** is the live terrain's earthwork. That is the siting's own job (`screenSite` →
`levelFor`), and the piece's sandbox run proves it on the showcase dump before staging (§6).

### 2.4 Materials kinds

**No new mats kind is needed**: the r1 rod kind is dropped with the crown. **chest** (8 planks) exists in the shopchest piece's
fit-out.

**Optional:** let `mats.mjs` take **copper_block** as a cut-copper input (9 units each). The town's 3 copper blocks are stranded
today, because `reserveKeyOf('copper_block')` is null. The saving is 27 ingots, one day of today's rate. This is a small,
separately testable change.

---

## 3. Palette and the oxidation look

- **Unwaxed cut copper weathers in place:** exposed, then weathered, then oxidized. The aging runs on random ticks, which
  happen only in chunks within simulation distance of a player. The town is always loaded.
- **Aging timing (r2 correction, Claude):** a copper block does not age while a *less*-oxidized copper block is within taxicab
  distance 4 of it.
  - Each pilaster is a 3-block stack (two courses plus a cap). The lintel's three cells sit next to the u 5 and u 9 pilasters.
  - **So the copper will age slowly and roughly together**, not in a speckled way.
  - Expect the first visible change within days and full green in weeks. **We claim only that much**, and read the real
    timing off the `patina` camera.
- **The builder already treats weathered copper as placed:**
  - `buildrun.mjs` (~201–207) strips `exposed_/weathered_/oxidized_` and `waxed_` from copper names, so a weathered pilaster
    still verifies as placed and is never re-placed.
  - `well.mjs` NEVER_DISPOSE and `stocktarget.mjs` PROJECT_PART_RE protect every oxidation stage.
- **Lightning strips oxidation.** Moot: rods are dropped, and the showcase has no weather cycle.
- **Nothing scrapes the copper.** An axe used on copper reverts one stage. The only axe users near the hall are the tree
  fellers (`treefarm`, and felling in project cells), and they act on logs. **A structural source assertion** (CLAUDE.md) checks
  that no code path uses an axe on a copper block.
- **The other materials:**
  - glass panes: 13 (31 in stock)
  - planks: spruce (577 spruce logs in town)
  - stone bricks: 306 needed, 118 in stock, mats buffer target 128. Mats makes about 190 more from the town's 1,000 cobble, at
    12 cobble + 2 logs per 8, so about 24 mats runs. Those runs go **before** opening, from the brick buffer, and over the
    opening window.

---

## 4. Materials bill against the town

| item | need | town now (latest obs) | reserve / buffer | short | source |
|---|---|---|---|---|---|
| stone_bricks | 306 | 118 | buffer 128 | ~190 | mats from cobble (1,000) |
| planks | 117 | (577 spruce logs) | logs 512, project floor 102 | 0 | crafted at draw (~30 logs) |
| glass_pane | 13 | 31 | buffer 32 | 0 | — |
| torch | 4 | 94 | 32 | 0 | — |
| chest | 4 | — | — | 4 | 32 planks |
| **cut_copper** | **33** | **10** | buffer 24 | **23 = 6 mats batches** | **216 copper_ingot** |
| **copper_ingot (loose)** | 216 for the batches | **130** | **project floor 103** | **189** | `smelt_town` |

**The copper accounting, in the reserve code's own units (r2, Claude blocker 2).**

- **What counts:** `mats.mjs reserveCount('copper_ingot')` counts loose ingots only. Cut copper in town is used directly by the
  bill, and copper blocks are not a mats input.
- **What can be spent:** in a project, the floor is 20% of 512 = 103, so 130 − 103 = **27 spendable**.
- **What the batches need:** 23 more cut copper is 6 batches of 36, so **216**. The ingots must reach **319** before the hall
  opens.
- **Why gate the opening:** `PROJECT_STALL_MS` is 24 h. A project with no placement for a day stops being active, and its floor
  returns to 512, which the town has never held. Opening the hall early, with copper trickling in, would stall between batches
  and lock out its own copper draws. That is the "two correct guards compose into a dead end" case. **The opening rule avoids
  it with no change to the reserve code.**
- **The alternative, not chosen:** exempt from the stall a project whose only open cells are `no_material`. That changes
  reserve semantics for every project.

**Positive control for "the town has no raw copper":** `_copper_miss` is set on six of nine chests in
`town-chest-0_70_0.containers.json`, while the same index's obs rows do show copper_ingot, cut_copper and copper_block. So the
reader sees copper.

---

## 5. Copper income and time to open

From the showcase skill logs: a full walk, 7 days, 10 bots, `smelt_town` rows parsed for `smelted N raw copper`. The
denominator is all 3,828 `smelt_town` rows, of which 64 smelted copper.

| day | ingots smelted |
|---|---|
| 10-26 | 8 |
| 10-27 | 40 |
| 10-28 | 24 |
| 10-29 | 88 |
| 10-30 | **194** (shaft on; 575 `mine` rows that day) |
| 10-31 | 24 (SHAFT off) |
| 11-01 | 25 |

**Why the rate is low:**

- **Coal, not ore.** In 10 days, 1,302 `smelt_town` rows stopped with "no coal in the town containers", and 753 with
  `stop=no_fuel`. One coal smelts 8. The 189 ingots need about 24 coal; the town holds 56.
- **The ore comes from mining at depth.** Raw copper pickups were 478 in 7 days, 220 of them on 10-30, and 27 on 11-01.

**Time to the 319 opening level:**

| rate | days |
|---|---|
| 25 a day (today) | about 7.5 |
| 58 a day (the 7-day mean) | about 3 |
| shaft on (10-30) | 1–2 |

**Item 2** (showcase shaft on, plus a deep miner) is the lever, and it lands before the hall in the owner's order. **No new
copper work is proposed here.** A "coal to town" fix would help both copper and iron; it belongs to the existing smelt-job lane
and is noted for the queue.

**Build time once open.** Showcase placements per active hour (measured): storehouse 50 (99 cells in 66 min, 2 builders),
house 47, wall 106, monument 286. **The hall's 477 cells take about 5–10 active hours.** The pad and roof are large and easy;
the windows and the lintel are slow.

---

## 6. Build plan (tier and tests)

**Tier 2** (building, outside protected scope), **showcase first**. `python3 scripts/lib/protected.py --base origin/main`
decides. The expected touch:

- `bots/src/blueprints/hall@1.json`
- `bots/src/copperhall.mjs`: the switch, `hallSite` and `hallDomain` (the storehouse pattern), the opening rule, and the
  no-fallback palette
- the optional `domain` argument on `buildsite.mjs screenSite`
- the `features.mjs` install
- the `shop.mjs` build-order entry after storehouse

The visit is the ordinary blueprint visit (`buildrun.mjs runVisit`). The `skills.mjs` siting call follows storehouse-01's
(`proveSite` with the hall's domain); storehouse's equivalent is at ~17744.

**Kill switch:** `COPPERHALL=off`. It is on only in `COPPERHALL_POOLS` (default `showcase`).

**Tests:**

- **Behaviour:**
  - the bill from the blueprint matches §4
  - the opening rule refuses at 318 ingots with 10 cut, and opens at 319
- **Composition:**
  - the shell completes with the copper cells open, and the project is complete only when both are
  - the copper-last order proves, and so does the control without the ring (§2.3, as unit tests over a flat fixture)
  - a stall case: the opening rule means the copper draws never run outside the active window
- **Weathering:** `weathered_cut_copper` verifies as placed.
- **Siting:**
  - the pad sites inside the wall
  - a reserved cell, a zone or relief sites nothing, and says why
  - `screenSite` without a `domain` argument is unchanged (the house and workshop still use `inDomain`)
- **Sandbox run before staging:** `proveSite` on the showcase region dump (live terrain and earthwork) at the real pad.

**Showcase watch:** 2 h, in which the shell goal visibly moves. Then a ledger row and the camera.

---

## 7. Interior: the Expedition Hall

1. **Kit depot (v1).** Four chests on the side walls, at (u 2, v 4/8) and (u 12, v 4/8), each with its stand cell beside it on
   the floor. They are the town index's ordinary containers (`role: depot`), so deposits and withdrawals use the existing
   ledger.
   - The expedition kit draw (`expedition.mjs kitNeed` and the visit's kit step) prefers these chests over the storehouse.
   - They hold torches, cobble and logs now, **boats** from S2 (one per outbound bot), and the S2 outpost kit (a chest, a torch
     stack).
2. **The map floor (v2, after expedition S0).** The inner **9 x 9** of the pad (u 3..11, v 2..10, s+0; draft `mapfloor`) is
   the map.
   - **Scale:** cell (i, j) stands for the border tile of side 10,000 / 9 ≈ 1,111 blocks. The centre cell is home.
   - **What changes a cell:** when S0's coverage reads a tile as **≥ 25% seen**, a bot replaces that pad cell's stone brick with
     **spruce planks**. At **≥ 90% seen** (the S4 goal) it becomes **cut copper**.
   - **The mechanics:** an ordinary record mutation (`mutate.g*`), as the paths extensions are, and a pure function of the S0
     coverage file.
   - **Cost (r2 correction):** at most 81 cut copper = **729 ingots over the whole programme**. Those cells only turn copper
     as tiles reach 90%, so the cost is spread over weeks and drawn only above the floor.
   - **No torch stands on the map** (the corner torches are outside u 3..11).
3. **Showcase chat (item 3)** announces a return ("Iris is back from the south-west, 256 blocks, 3 logs") when a bot deposits
   in the depot. That is one more template line.
4. **No beds, signs or item frames in v1.**
   - Beds need wool and shears, and the respawn question is in the whole-map doc §3.5.
   - Signs have no code yet; the storehouse labels work builds it.
   - Item frames need leather.
   - All three are v2 candidates.

---

## 8. Lighting

- **Four floor torches** in the interior corners, plus 13 glass panes for daylight.
- **No exterior torches in v1.** The plaza and path lights cover the approach, and the builder places floor torches only.
- **Lanterns** (8 iron nuggets + a torch) are a v2 upgrade once iron is in surplus. The town holds 16 iron_ingot, and iron
  goes to pickaxes today.

---

## 9. Camera

`tl.conf` `cameras`. The project cameras use perspective, fov 20–40, `every: 2`.

```json
"copperhall": {"x": -14.5, "y": 68, "z": 27.5, "distance": 50, "rotation": 0.7854, "angle": 0.5, "ortho": 0,
               "mode": "perspective", "fov": 25, "width": 1440, "height": 1440, "every": 2, "phase": 1},
"patina":     {"x": -14.5, "y": 69, "z": 22.5, "distance": 22, "rotation": 0.7854, "angle": 0.35, "ortho": 0,
               "mode": "perspective", "fov": 20, "width": 1440, "height": 1440, "every": 8, "phase": 3}
```

- **Set the rotation** so the doorway (the front wall, facing north toward the plaza) faces the camera. Check it on the first
  frame.
- **Cadence:** `every: 2` and `every: 8` keep the timelapse run inside the service's 13-minute TimeoutStartSec. Expedition-01
  added the cadence rule after an eleventh camera pushed the run over.

---

## 10. What this design does not do

- **No copper roof.** 99 roof cells at 9 ingots each would be 891 ingots.
  - A stonecutter (1 block → 4 cut copper) is 4x cheaper, but mineflayer has no stonecutter window helper. It would take a
    recipe-select button packet, which is behaviour nobody here has seen work.
  - **A `stonecutter-01` spike could make a copper roof (~225 ingots) a v2.** It is listed in the whole-map doc's order as
    optional.
- **No height above s+3.** A taller hall needs a builder stand above the step: scaffolding or a second ring. That is a v2
  question for the build system, not this blueprint.
- **No copper doors in v1** (owner Q2: an open doorway counts as a door). There are 3 copper_door in stock, ready for v2.
- **No world edits.** Felling the trunks in the footprint is the builder's ordinary job.

---

## 11. Reviews

Two-engine, blockers only, both on r1.

**Codex (`codex exec`, read-only), BLOCK:**

1. The domain: the r1 corner was 49.7 out (the limit is 44). **Fixed:** own siting and domain (§1.2).
2. The eaves: no stand reached them (`proveSite` gave `no_step` on all 34 roof-edge cells). **Fixed:** r2 geometry, proven
   (§2.3).
3. The last three Codex blockers concern the whole-map doc and are answered there.

Non-blocking points taken:

- the shell count
- the stranded copper blocks (§2.4)

**Claude (independent subagent), BLOCK:**

1. Eaves and caps at s+4 unreachable, confirmed by running `stepFor`; the over-door eaves rested on the lintel. **Fixed:** r2
   (§2.2, §2.3).
2. The reserve accounting counts loose ingots only, and the 24 h stall locks out copper draws. **Fixed:** the opening rule, and
   the bill restated in ingots (§0, §4).

Non-blocking points taken:

- rods have no stand: dropped
- the oxidation-proximity rule (§3)
- the map floor's copper cost (§7)

**r2 re-check (blocker fixes only): Codex APPROVE, Claude APPROVE.** All seven blockers are fixed and no new blocker was found.
Both noted that the flat-world proof does not cover the live pad's earthwork (up to about 5 fill); that is the sandbox gate in
the copper hall doc §6.
