# wallext-01: the wall extension round the storage hall (design + built, 2026-11-04)

**Owner 2026-11-04:** "lets do A then extend the wall around the new building leaving room for additional buildings." A = the
storage hall (storehub piece A, [`storehub-ab-2026-11-04.md`](storehub-ab-2026-11-04.md)), which the bots' own siting puts in the town
ring north of the showcase town, OUTSIDE the wall: box x -21..-3, z -49..-39. Ledger `wallext-1104`, memory `wallext-1104.md`.

**Status (r3, 11-04 evening -- section 13 supersedes sections 2, 12's ring and plots): READY TO STAGE (showcase), not staged.**
Branch `wallext-v2-show` @ `a2e0e91e` = the batch-5 fold `fdbd19e6` (showcase-wallext-on-d3773f8b) + the demolition HOLD (Codex fold
blocker) + the hall's new site (storehub-site-fix `a9877f4e` merged) + the re-sited extension. The storage hall now sites NE (x 10..28,
z -59..-49, floor 70); the extension: ring x -36..34, z -89..-20, **639 cobblestone**, X1 workshop / X2 town hall (hall size) + 3
houses; the old line's demolition 15 columns / 114 blocks, held until done. Tripwire WX1 + WD1 + the hold in this commit's
`shopread.py.txt` (NOT installed). ci2 suite at `a2e0e91e`: 419/422 (the known base three).

**r2 status (superseded):** Branch `wallext-show` @ `029fea43`; ring x -43..27, z -75..-20, 670 cobblestone (hall at the old north-field site).

**r1 status (kept for the record):** Branch `wallext-show` @ `b1da40da` (code `d0f6ccf5`; the two commits after it touch tests only: the orphan manifest, house.test's order filter).. Base: the live showcase release `f76158f2`
(batch 3) with `storehub-ab-show` `e23c5cef` merged on top as a TRIAL FOLD (`b4c89685`: the fold containing storehub was not live
yet; one skills.mjs conflict, both sides kept -- yarduse's `cobbleReserve` and storehub's `keepOf`; the two structural anchors on that
line updated to the merged text). Tier 2 (not protected). Rollback `WALLEXT=off` (a sited extension stays guarded). Tripwire rule WX1
in this commit's `shop-01-2026-10-25/shopread.py.txt` (NOT installed).

## 1. Measured first (region copy of the showcase world, 11-04 15:00:32Z; the pool's record heads; home 0,70,0)

- **The town wall** (`project-0_70_0.wall`, complete 10-31 01:12Z after 19 h): ring x -46..35, z -20..39, 280 columns -- wall 141,
  post 1, gate 12, open 51, gap 75; 941 cells (936 cobblestone, 4 stone bricks, 1 torch), 1 waived cell.
- **Its north line z = -20**, the line the extension shares: of the 59 columns x -35..23, **13 are built** (x 3..8, a post at 3; x 17..22,
  the run 17..25 that the extension's east side meets at 23) and **46 are already open** (the zig road's gateway x -19..-12, the spoke's
  x -1..2, sally ports, pits, short runs). West of x -22 the ziggurat's reservation is the line.
- **The ground north of the town:** a basin at y 62-63 from x -40 to 0, z -40..-72 (the hall sits in it, floor 64); a ridge at y 69-71
  along z -73..-80; y 66-70 east of the spoke (x 5..30); 64 -> 70 between the hall and the old line. Water only north of z -88.
- **What holds it** (the bots' own refusals): the ziggurat's reservation (x -58..-23, z -46..-11) on the west, the hall's (x -24..0,
  z -52..-36), the land plan's spoke corridor (north, x -1..7) and ring-road corridor (z -37..-33 east of x 5, then x 9..20 south to
  z -21), the shaft's reservation (x 20..30, z -34..-21), dress lamp zones, the paths' zig leg (x -17..-14), 60 expedition markers
  (one at -33,64,-45), the road sink R1 (z -87..-80, outside).
- **Two things the old siting never met** (both found by the offline run, both fixed in the extension's siting only):
  - **The pathfinder's floating bridge blocks:** dirt and cobblestone at y 70 over 6 cells of air all over the basin. The wall's
    column reader takes the first solid from the top as the ground, so a ring there stood on y 70 over a 63 basin (`tall`) and no
    plot read level. `extColumn` passes a spoil block with two or more cells of air under it.
  - **A dirt pillar on home's own column to y 75:** every walk from home was empty, so the reach proof made every column a gap.
    `walkFeet` seeds the walks from the nearest feet cell (it would hit a re-siting of the old wall the same way: not changed there).
- Positive controls: the same reader without the float rule reads the bridge block as ground (test); the storehub offline siting on
  the same copy finds the hall's ring site again (x -21..-3, z -49..-39, floor 64, 0 cells in a reservation).

## 2. What the bots will build (offline, the bots' own code on the copy: `bots/scripts/wall-offline.mjs --ext`)

The map: [`map-showcase-1104.txt`](wallext-2026-11-04/map-showcase-1104.txt) (north up, x -40..28, z -82..-16; `#` wall, `G` gateway, `o` opening, `x` a natural
gap, `:` walk / fire-step, `W` the old wall, `H` the hall, `1`-`4` the plots, `Z` the ziggurat, `S` the shaft, `=` road corridors.)

- **The ring:** a rectangle x -35..23, z -79..-20 (59 x 60), its south side ON the old north line. 234 ring columns: **101 built**
  (100 wall + 1 post), 14 gateway, 14 opening, 46 gap, 59 join (the old line, never built). North side 59 (39 built), east 58 (34),
  west 58 (28; 28 more are the ziggurat's: the wall meets its reservation as the old ring does).
- **The cross-section is the old wall's:** cobblestone to b+3 with a merlon at b+4 on every other column and run end, the walk at
  b+2 and the fire-step at b+1 inside; the base follows the ground (b 62..70, steps of at most 1 along a run; a column more than 7 tall
  is a gap). One stone-brick post (with its torch when the town spares torches).
- **Gateways:** the north spoke road (x 0..7 at z -79, 8 wide: the road north out of town), the ring road on the east (z -37..-35),
  the path to the shaft (z -25, -22..-21). Sally ports every <= 12 columns (owner Q7, 12 columns). **The hall itself is reached through
  the old line, which stays open** (x -35..2: 38 columns with no wall; x 9..16: 8), so the hall's door has no gate in front of it.
- **The plots** (reserved: every other siting keeps off them): **X1 hall size 19 x 13** at x -22..-4, z -65..-53 (y 62-63, north of
  the hall), **X2 house size 11 x 11** at x -15..-5, z -35..-25 (y 62-66, between the hall and the old town), **X3** x 6..16, z -49..-39
  (y 68-70) and **X4** x 6..16, z -63..-53 (y 67-70), both east of the spoke. Room left over after the four (want 4) is open ground.
- **Cost: 690 cobblestone, 4 stone bricks, 1 torch** (the bill: 404 wall, 286 walk/fire-step cells, 4 post, 1 light); 580 clears
  (445 leaves, 16 trunks = 114 logs felled whole, 20 plants). For scale: the town held 933 cobblestone at 12:45Z, the hall takes
  ~300; the old wall drew 936 over 19 h. A stone sink, as the owner wanted.
- **The proofs:** escape: nothing reachable from home is cut off (0 cut, 0 trapped; 7 pits of <= 4 cells, 24 canopy cells);
  reach: every cell has a stand the builders' walk reaches on the finished wall. **Built end to end offline** by 4 fake builders
  running the bots' own visit (`buildrun.mjs runVisit`): **695 / 695 placed in 4 rounds**, 3 clears left (spruce logs one stand does
  not see). The walk on the finished world (`wall-offline --build`): of 28,697 outside feet cells reached before, 13 are not reached
  after (pathfinder model; 15 with the builders' drop-1 walk), detour p95 0, worst +54 blocks.
- **An independent check** of every cell and clear against the raw sources (protected zones, every record's cells, columns, zones
  and box + 3, the land corridors, site prep, the hall's reservation, the markers' +1 zones, the wells): **0 hits**.

## 3. The design (Claude)

`bots/src/wall.mjs` (pure, all new code after the old wall's):
- **`extSide`**: the side of the old ring the hall is beyond (exactly one, within that side's span); else nothing to extend.
- **`extRects`**: the hall's box + margin 6, the shared side ON the old line, widened along it by {0..28 step 4} at each end (never
  past the old ring's span) and deepened outward by {0..24 step 4} -- 448 rectangles.
- **The screen** (1.6 s): each rectangle's plots (`wallExtPlots`: hall size 19 x 13 then house size 11 x 11, nearest the hall, every
  column free, dry, known and not refused, the 10th-90th percentile ground within 4 -- the bots' own pillars and pits are the
  groundskeeper's -- PLOT_GAP 3 apart and off the hall), then how LEVEL its line is (the share of free ring columns whose cross-section
  is within 2: the basin's rim fails), then the shortest.
- **The proof** (best 10, ~2 s each, `await pause()` between): `wallCandidate` with a `join` test (the shared line is never built)
  and the refusals (the old wall's cell columns, every other record's cell columns -- Codex r1 --, protected zones, the plan, wells,
  farm, every reservation but the old wall's own zones), the escape proof, the plots again on the built ring; scored plots x 100 +
  built share x 50 - length x 0.1 - cost x 0.05; a ring less than half wall (a side along a road corridor) is not taken.
- **The record** `project-<home>.wallext` (`wallext@1`): the wall record's shape (cells, clear, segments W-nn + W-L, zones, cols,
  gates, bom, escape) + side, join, ring, interior (the rectangle less its own line, up to AND including the shared line), plots, hub.
- **Order and opening:** `shop.mjs PROJECTS` puts it right after the hall (`after: storehub`, its record complete); unsited it
  WAITS (`wallextOpening`: a complete wall, the hall beyond one side) so the order never offers it early. 4 builder slots, the wall's.
- **The visit** is the wall's (`skills.mjs buildWall(ctx, args, signal, K)`, K = WALL_KIND | WALLEXT_KIND): the bill, the draw, the
  lights last, the blocked-segment wait, wallstuck's remedies and waiver, the rows (`project=wallext`). Every place the wall's
  blueprint was special (the palette, the waived-cell completeness, the stuck stamp rule, the footprint, the sapling keep-out) reads
  the extension as the wall.
- **The land plan learns the interior:** `landReservation(land, ext)` carries the plots as `land:plot` zones (every siting keeps
  off; the groundskeeper's own refusals never read the land plan's reservation, so it still tidies them); the tidy's inputs carry the
  extension and the **inwall stage surveys both interiors** (`tidy.mjs inwallBoxes`, `mergeSurveys`).
- **The old section is LEFT** (section 5).

## 4. Codex's independent design ([`codex-design.md`](wallext-2026-11-04/codex-design.md)) and the reconciliation

Codex was given the measurements and the goal, not this design.

| Point | Codex | Claude (built) | Chosen, why |
|---|---|---|---|
| Shape | A polygon: a new north boundary at z -78 from x -61 to 35, a western shoulder ENCLOSING the ziggurat; 1,400-1,900 cobble | A rectangle sharing the old north line, x -35..23, z -79..-20; the ziggurat closes its west side as it closes the old ring's corner | **Rectangle.** It reuses the proven rectangular ring (`ringLoop`, the terrace's inner rings) with one new state (join); a polygon needs concave-corner terraces nobody here has built. The ziggurat stays outside as the old wall's rule has it. Half the stone, and the visible enclosure is the same. |
| The old north line | Remove its cells (a phased demolition with a retirement record) | Leave it: 46 of 59 columns are already open | **Leave.** No removal actuator, no new dig rule in the tripwire, and the opening is already 38 + 8 wide. The two stubs (x 3..8, 17..22) are owner question O1. |
| Plots | Four 19 x 11 hand-placed pads (one rejected for water) | Found by the siting (4: one hall size, three house size), recorded on the extension | **Found**, so another town gets its own; the same reservation semantics Codex asked for (claimed by a later siting with its own exemption). |
| Interior | Bounds + a membership predicate replacing the single box | A list of boxes (the old interior, the extension's) | **Boxes**: the interiors are disjoint rectangles by construction; the predicate is the union. |
| West closure | "the impossible passage between monument and hall reservations" | The same fact, closed by the ziggurat's reservation (a gap of 3 between the wall's end at z -47 and the ziggurat) | Same finding; closure by the existing rule. |
| Proof | Expand the terrain copy; four builders; intermediate escape proofs | The copy is home +-112 (the ring is within 79); 4 fake builders end to end; the escape proof on the finished ring | Built as both asked, except intermediate escape proofs (the old wall shipped without them; nothing reachable is cut by the finished ring, and a partly built ring has more openings). |

## 5. The old section: left, not removed (and why)

The owner's choice was "remove it or leave it with wide openings ... organized, easily seen". The line between the old town and the
extension is already 78% open (46 of 59 columns): from the ziggurat to x 2 there is no wall at all (38 columns, the zig road's and
the spoke's gateways among them), and 9..16 is open. What stands is two short runs (x 3..8 with its post and torch, x 17..22). Removing
them needs a bot that digs record cells of a COMPLETE project on purpose, a record of what may be dug, and a tripwire rule that judges
it -- three new pieces, for 13 columns. Left, they read as the old wall's two towers between the quarters. **O1 to the owner.**

## 6. The tripwire: WX1 (two engines)

`shop-01-2026-10-25/shopread.py.txt` (this commit, NOT installed): `WALL_PLOTS = ('wall', 'wallext')` -- the extension is judged like
the wall: its placements G1 (its record cell, or the wall's footing 1..3 under a column's lowest record cell), its clears G2 (its
clear list, a foreign dig of its own cell, the cap over a sealed column: overburden any role). **The old wall's cells are not on the
extension's record**, so an extension placement onto, or a dig of, an old wall cell is off_record / clear_outside; no removal rule
is granted. Selftest fixtures for each (with positive controls: the old wall's own foreign dig, the same cell as a non-footing);
`shopread-mutants.py.txt` **121/121 killed** (4 new). Reviews (two engines): **Claude (independent subagent) APPROVE, no blockers**
([`claude-wx1-review-r1.md`](wallext-2026-11-04/claude-wx1-review-r1.md); notes: a cross-record disjointness report would make "never
the old wall's" mechanical; two negatives score 1 with or without WX1); **Codex APPROVE, no blockers**
([`codex-wx1-review-r1.md`](wallext-2026-11-04/codex-wx1-review-r1.md): no other `plot == 'wall'` case, the 4 mutants fail on the
intended assertions). Install: copy `shopread.py.txt` (and the mutants file) from this commit beside `showcase_trip.py` on .40.

## 7. Tests, reviews, suite

- `bots/test/wallext.test.mjs` (23 checks): the switch; the side; the rectangles and the interior; the join (with a positive
  control: `join: null` is the old record exactly); the float reader (positive control: pathColumn reads the bridge); the plots
  (hall first, refusals, gap, percentile level, a pit field refused); the walk seed (positive control: an empty walk from home); the
  siting on the fake server (no cell on the old line, on an old column, in the hall's reservation; escape clean; plots inside); its
  refusals; another record's zones and cells (Codex r1, with its positive control); **built end to end by runVisit** (every placement a
  record cell, never an old one); the opening rule; the land plan's plot zones; the inwall stage over both interiors (a pillar in the
  extension found; positive control without it); the order (after the hall, waiting, guarded when off); 9 wiring lines with mutants;
  5 anchored module mutants.
- Updated structural anchors where the wiring moved: wall-wiring, wallstuck, terrace, groundskeeper, showcase-on-fleet; the trial
  fold's one merged line: storehub, yarduse. Targeted: wall* 5/5, tidy 3/3, terrace, groundskeeper, gkstagefold, showcase-on-fleet,
  copperhall, storehub, yarduse, shop pass; eslint clean (`lint:movement`'s 3 files are the base's).
- **Codex code review r1: 1 BLOCKER, fixed** ([`codex-code-review-r1.md`](wallext-2026-11-04/codex-code-review-r1.md)): the ring
  read only reservations, so a record with cells and no zones (the tidy's stage record) could have a wall cell in its column and the
  visit would dig its fill as `foreign`. Fixed in `d0f6ccf5` (every other record's cell columns refused; the plots ignore the tidy's),
  regression + mutant; offline re-run: the same 695 cells, 0 hits.
- Full suite (scripts/host/suite-run.py, w30) at `d0f6ccf5`: **413/419**; the failures are ceilescape, nothing-important-is-orphaned,
  protected-paths, well (the known base four), plinth-skill (a known flake) and house.test (its project-order filter did not know the
  new PROJECTS entry: fixed in `b1da40da`, house 3/3 targeted).

## 8. Facts it rests on

No new Minecraft behaviour: the extension is built by the wall's own visit (live: the 941-cell wall completed 10-31; wallstuck's
remedies live since), placements onto faces as `buildsite.mjs stepFor`, digs as the wall's. The new reads are pure (floating blocks,
a seeded walk). No Paper sandbox proof is needed (fun-mode: a second engine only for protected scope or unseen behaviour).

## 9. Watch after release (2 h no-harm; the build over the next day)

After the hall stands: `_build project=wallext op=sited kind=m6/cols101/.../sideN/plots4` (the site; expected the ring above unless
the town changed), placements per hour against the old wall's first day, `stop=` mix (blocked / stuck_on_cell), `waived` rows (at most
12), `_structure_complete project=wallext`; WX1 off_record / clear_outside 0; deaths 0 linked; the inwall stage's record naming
`boxes` (two). Then the plots stay free: no sink, dress or site-prep instance inside X1-X4. Rollback `WALLEXT=off`.

## 10. Queue (showcase lane)

Claude: in the same fold as storehub-ab (it waits on its own opening rule until the hall is complete, so it changes nothing before
then) or the fold after. Codex (design): after the hall's completion. Reconciled: **fold it with or right after storehub-ab**; it
cannot start before the hall stands either way. Fleet: not before a showcase read (WALLEXT is showcase-only by default).

## 11. Owner decisions

- **O1: the two old stubs on the shared line** (x 3..8 and 17..22, 13 columns): leave (built) or a later piece removes them (a
  removal record + a bot that digs them + a tripwire rule)?
- **O2: what goes on the plots first** (X1 hall size; X2-X4 house size): houses 2-4, a second hall, the copper hall's successor?
  Nothing sites into them yet; they are reserved.

## 12. Owner answers 11-04 -> r2 (two hall-size plots) and wallext-02 (the old line comes down)

**O1 "remove left over blocks"; O2: 1) an enchanting + anvil workshop on the hall-size plot, 2) a new town / meeting hall, 3) houses.**
The town hall needs a second hall-size plot, so r2 changes the extension's siting before release (one branch line), and wallext-02
(the demolition) rides on the same branch, opening only when the extension stands. Another agent builds the workshop itself.

### r2: two hall-size plots (wall.mjs `plotValue`)
Each plot kind has a cap and a value (hall size 19 x 13: at most 2, worth 2; house size 11 x 11: at most 3, worth 1); the screen and
the score rank by that value. On the 15:00Z copy the siting now takes **ring x -43..27, z -75..-20** (71 x 56; was 59 x 60):

| | r1 (sections 2-11) | **r2 (built)** |
|---|---|---|
| ring columns / built / gateway / opening / gap / join | 234 / 101 / 14 / 14 / 46 / 59 | **250 / 103 / 12 / 14 / 50 / 71** |
| cells | 695 | **680** (376 wall, 294 walk/fire-step, 8 post, 2 lights) |
| **cost** | 690 cobble, 4 stone bricks, 1 torch | **670 cobblestone, 8 stone bricks, 2 torches** |
| clears | 580 (16 trunks, 114 logs) | 660 (18 trunks, 105 logs, 516 leaves, 38 plants) |
| plots | 1 hall + 3 house | **2 hall + 3 house** |

The cost does not rise: the north side moves onto the ridge top (z -75, level) and the east side to x 27, where the ring road and the
shaft's reservation make more of it gateway / gap. **Plots (O2 order):** **X1 (hall size, 19 x 13)** x -22..-4, z -65..-53, y 62-63, the
flat basin north of the storage hall -- **the enchanting + anvil workshop** (flat, next to the hall's iron/ingots); **X2 (hall size,
13 x 19)** x 6..18, z -56..-38, y 66-70 east of the spoke road -- **the town / meeting hall** (on the road north, seen from both town
quarters; the ground rises 4: a builder's earthwork); **X3-X5 (house size, 11 x 11)** x -15..-5 z -35..-25, x -36..-26 z -63..-53,
x 8..18 z -70..-60 -- houses. Gateways: the spoke road north (x 1..7 at z -75), the ring road east (z -38..-35), the path to the shaft
(z -21). Proofs: escape 0 cut / 0 trapped (1 pit); **built end to end offline 680 / 680** (4 fake builders, 5 rounds, 1 log left);
the walk on the finished world: of 25,572 outside feet cells reached before, 21 are not after (pathfinder model; pockets), detour p95 0;
the independent check (protected zones, every record's cells / columns / zones / box + 3, corridors, site prep, the hall's reservation,
markers, wells): **0 hits**. Map and record: [`map-showcase-1104.txt`](wallext-2026-11-04/map-showcase-1104.txt),
[`offline-record-showcase-1104.json`](wallext-2026-11-04/offline-record-showcase-1104.json) (both r2 now).

### wallext-02: the old line comes down (wall.mjs `demoCells`, `retireWall`, `demoRecord`, `demoMissing`, `demoDone`; skills.mjs `buildWallDemo`)
- **What:** the old wall's cells in a BUILT line column strictly inside the extension's join span (its ends, where the extension's
  sides meet the old line, stay), 0..3 in from the line toward the old town (body, walk, fire-step, approach), never a foundation. On the
  copy with the r2 ring: **15 columns (x 3..8 and 17..25), 114 blocks: 113 cobblestone + 1 torch** (58 wall, 51 step, 4 post, 1 light).
  (The owner's "13 columns" was r1's span; r2's east side at x 27 takes the whole 17..25 run.) The blocks go back to the bots' bags.
- **How:** a project `walldemo` after `wallext` (WAITS until the extension is complete). Its first visit (1) publishes a new generation
  of the OLD WALL record without those cells (`retired` names them, zones recomputed -- 62 -> 55 boxes -- the line columns read
  `retired`, 941 -> 827 cells), so no repair rebuilds them and the groundskeeper may level their ground; (2) sites the demolition record:
  no cells, a clear list of the blocks there now (kind `demolish`). The visit runner's clears dig them (2 builders). **Codex r2 BLOCKER
  (fixed):** a wall repair's placement sent before the retirement could land after the siting and be owned by nobody -> each visit
  appends any in-scope retired cell holding a wall block (`demoMissing`, a `late` row), and the record completes only when nothing
  listed or late stands AND the retirement is 5 min old (`demoDone`); it is never complete at siting.
- **Then:** the old interior (z >= -19) and the extension's interior (up to and including z -20) are both the inwall stage's boxes; the
  dug ground (the pre-wall terrain, uneven where terraces stood on low ground) is filled and levelled by its rules.
- **Offline on the copy** (`bots/scripts/walldemo-offline.mjs`): 114 / 114 dug by fake builders in one round, **0 digs off the list**,
  only kind `demolish`; the walk from home reaches all 15 line columns after. Record:
  [`offline-demolition-showcase-1104.json`](wallext-2026-11-04/offline-demolition-showcase-1104.json).

### WD1: the demolition's tripwire rule (two engines)
`shopread.py.txt`: a `_build op=clear project=walldemo` dig is on the record ONLY when kind=demolish, it is on a generation of the
walldemo chain's clear list, the line / span / inward come from the **extension's** record (join + side: never the demolition's own),
the cell's column is a built line column in the **old wall's own cols** (any generation) strictly inside the span, it lies 0..3 in, it
is an old wall cell (cells or retired, any generation) that is **not a foundation**, and a generation of the extension stood complete
(completeAt) at or before the dig (+60 s); else clear_outside (` demo`). The walldemo record has no cells: any placement is off_record.
The groundskeeper's guard (tidy_guard) reserves a retired cell only until its generation's retiredAt (`u|<cell>`), so levelling that
ground afterwards is not `guarded`. Selftest rows for each refusal (corner, flipped inward, base, outward, unlisted, before the
extension, no join, the guard before/after, the retirement/siting rows judge nothing); **shopread-mutants 136/136 killed** (15 new).
Reviews: **Claude r1 3 BLOCKERS** (the reader trusted the demolition's own line/cols; foundations; retired cells reserved from the
tidy forever) -- all fixed; Claude r2: **APPROVE, no blockers** ([`claude-wd1-review.md`](wallext-2026-11-04/claude-wd1-review.md)). **Codex** r1 (WD1 as first written): no WD1 blocker, mutants fail as intended;
Codex r2 (the whole r2 + wallext-02 diff, [`codex-r2-review.md`](wallext-2026-11-04/codex-r2-review.md)): 1 BLOCKER, the late repair placement (fixed, above); Codex fix confirmation ([`codex-r2-fix-confirmation.md`](wallext-2026-11-04/codex-r2-fix-confirmation.md)): 1 BLOCKER -- an unread (unloaded) in-scope cell let the demolition complete with a late block unseen -- fixed in `029fea43` (`demoDone` requires every in-scope cell read; regression).

### Tests, suite
`bots/test/wallext.test.mjs` +11 checks: plot value (and the caps, on the fake server); demo cells (only built line columns strictly
inside the span, 0..3 in, never a base; positive control: cells outside the span exist); the retirement (cells out, `retired`,
zones recomputed, idempotent; demoCells reads the retired list); the demolition record (air and other blocks passed, unread refuses;
the opening rule); **demolished end to end by runVisit** (every listed block dug, nothing else, nothing placed, the rest of the old
wall standing); the late block (positive control: the list alone reads done) and the settle; the order (after wallext, WALLDEMO=off);
4 anchored mutants (span ends, depth, base, records) and 6 more wiring lines. Full suite (w30) at `5d26e5b6`: **414/419** (ceilescape, nothing-important-is-orphaned, protected-paths, well: the known base four; craftsync: a known flake). `029fea43` adds only the unread rule + its regression (wallext targeted 1/1).

### Owner decisions now
None open from this piece. (O1 answered: removed; O2 answered: X1 workshop, X2 town hall, X3-X5 houses -- nothing sites into the
plots yet; the workshop's own piece will name X1 as its exception to the `land:plot` reservation.)

## 13. r3: the hall moved; the demolition hold (11-04 evening)

### The hall moved (storehub-site-fix `a9877f4e`)
LIVE batch 4: 21/21 hall sitings `no_site` -- the ziggurat's APRON (its record box + 8, `buildsite.mjs z0`: no building within it)
covers the north field the offline run (without z0) had picked. The fix sites the hall at **x 10..28, z -59..-49, floor 70** (NE, 57
from home). That overlapped r2's X2 town-hall plot, so the extension was re-sited round the new position, and its PLOTS now refuse
the apron too (a plot a building can never take is no plot); the ring keeps the ziggurat's box + 3 reservation as the old wall does.
Codex r3 BLOCKER (fixed, `a2e0e91e`): the apron came from `shopCtx().z0` and the reservation from the guarded heads, both empty with
MONUMENT=off -> the extension's inputs read the monument record directly (`wall.mjs extWithMonument`); Codex confirmation APPROVE.

**On an 18:15Z region copy + the live pool (the bots' own code; the hall at the fix's site, confirmed by the fix's own offline script):**
- **Ring x -36..34, z -89..-20** (71 x 70), south side on the old north line: 278 columns -- 96 wall, 18 gateway (the land plan's ring
  road runs along the east side's line, z -38..-21), 23 openings (sally ports, short runs), 70 gaps (15 water on the north shore at z
  -89, the road sink R1's reservation where the north spoke leaves, pits, markers, the shaft), 71 join. No post, so no torch.
- **Cost: 639 cobblestone** (400 wall, 239 walk / fire-step cells); 631 clears (12 trunks, 75 logs felled; 516 leaves).
- **Plots:** **X1 (hall size 19 x 13) x 10..28, z -75..-63, y 67-69 -- the enchanting + anvil workshop** (north of the hall, the
  same level as its floor); **X2 (hall size 13 x 19) x -16..-4, z -63..-45, y 63-64 -- the town hall**; X3 x -12..-2 z -41..-31, X4
  x -13..-3 z -81..-71, X5 x -30..-20 z -63..-53 (house size 11 x 11). All outside the apron.
- **Proofs:** escape 0 cut / 0 trapped (4 pits); independent check 0 hits; **built offline 638 / 639** by 4 fake builders (one wall cell
  at -36,66,-67 no stand reached: the live visit's waiver -- WALL_WAIVE_AFTER visits, at most 12 a record -- closes such a cell; the
  offline harness has no waiver); the walk on the finished world: of 34,452 outside feet cells reached before, 61 are not after
  (pathfinder model: pockets of <= 4 and canopy the siting's proof excludes), detour p95 0.
- **The demolition** is unchanged by the new ring: 15 columns (x 3..8, 17..25), 114 blocks (113 cobblestone, 1 torch), dug 114 / 114
  offline, 0 off the list. Map / records: [`map-showcase-1104-r3.txt`](wallext-2026-11-04/map-showcase-1104-r3.txt),
  [`offline-record-showcase-1104-r3.json`](wallext-2026-11-04/offline-record-showcase-1104-r3.json),
  [`offline-demolition-showcase-1104-r3.json`](wallext-2026-11-04/offline-demolition-showcase-1104-r3.json).

### The demolition HOLD (Codex batch-5 fold BLOCKER)
Releasing the old line's cells and zones at the rewrite let the groundskeeper's inwall fills and the access stairs place stone there
before the demolition dug -- which then dug THEIR stone as wall. Now: `retireWall` writes `hold:walldemo` zones over every retired
cell's column (all heights) in the SAME generation that drops the cells; the hold is the tidy's `reserved` (read before every inwall
rule and by the stairs' `free`: Claude hold r1 BLOCKER 1 -- a kept wall cell's `project:wall` zone, a "build's box", masked it); it is
live only while the walldemo head is open (`projectHeads` presents the wall record without it once the demolition is complete:
`wallAsHeld` -- Claude hold r1 BLOCKER 2, a lost release would have stranded it), the walldemo head is read whatever WALLDEMO says
(Codex hold r2 BLOCKER); the published release is cleanup. Tests: THE HOLD (an inwall fill on a held pit refused mid-demolition,
planned after the release), THE HOLD WINS (a held column under a kept cell's zone skipped as reserved; positive control), the no-hold
mutant, wiring lines. Reviews: Claude r1 2 BLOCKERS -> r2 APPROVE; Codex r1 2 BLOCKERS (the same two) -> confirmation 1 BLOCKER (the
switch) -> fixed. Files: [`claude-hold-review.md`](wallext-2026-11-04/claude-hold-review.md), [`codex-hold-review.md`](wallext-2026-11-04/codex-hold-review.md),
[`codex-hold-confirmation.md`](wallext-2026-11-04/codex-hold-confirmation.md), [`codex-r3-review.md`](wallext-2026-11-04/codex-r3-review.md),
[`codex-r3-fix-confirmation.md`](wallext-2026-11-04/codex-r3-fix-confirmation.md).

**The tripwire (two engines):** `tidy_guard` now keeps a retired cell reserved until the walldemo chain's first COMPLETE generation's
completeAt (was: the retirement), so a groundskeeper placement or dig on a retired cell mid-demolition reads `guarded`; no demolition
record, or none complete: held. WD1 unchanged. Selftest rows (complete at T0-2 s: free after, held between retirement and completion;
not complete / no record / a completeAt on an incomplete generation: held); **shopread-mutants 146/146 killed** (main's 144 incl.
enchantshop's EF1, + 2). Claude: correct (the hold review); Codex: no reader blocker (selftest + mutants pass).

### The fold's tidy.mjs resolution (fold commit `76f21002`), kept
Every inside-the-wall box applies access's no-stair check and the site-prep reservations; the extension is exempt from the
build-footprint rule so stairs may be built inside it. The hold sits on top of that: `reserved` is checked first.

### Suite
ci2 at `a2e0e91e`: **419/422** (ceilescape, nothing-important-is-orphaned, protected-paths: the known base three on a copied tree).

### For the enchantshop builder
**X1 = x 10..28, z -75..-63 (19 x 13), ground y 67-69**, a `land:plot` reservation with id `X1` once the extension is sited (the
workshop's siting names `X1` as its exception). Note: the plots are FOUND by the extension's siting at the moment it sites (after the
hall stands), so the live box can differ from this offline one if the town changes; read it from `project-<home>.wallext` `plots`.

## 14. r4 (11-05): why the live extension never sited, and the fix

**LIVE** (wallext-v2 since release `9295590e` 11-04 21:07Z; the hall complete 11-05 09:05Z): the first siting, 11-05 12:33Z (Comet,
110 s), was `no_site no_wall_ring` -- every rectangle failed the escape proof (`cut7/trap0` or `cut0/trap16`). Reproduced exactly on
a 12:39Z region copy + the live pool with the bots' own code.

**CAUSE.** The hall stands at x 10..28, **6 columns from the old ring's east end (x 35)**, and an extension's rectangle was not allowed
to pass that end. Every candidate's east side was at x 34 or 35:
- **x 34:** the wall's terrace (fire-step x 32, walk x 33) left a 3-wide strip x 29..31, z -57..-52 between the hall's east face
  and the terrace: a bot drops into it and cannot climb out (**16 cells trapped**);
- **x 35:** the strip x 32..34, z -51..-49 is closed off (**7 cells cut**).
The offline runs of r3 had the hall's offline site, not the live town (and only checked x <= 35 the same way).

**FIX** (branch `wallext-escape-show` @ `1c93d54f` on the live tip `0e8a1cfa`):
1. a rectangle may pass the old ring's span by `WALLEXT.over` (12) at each end; the JOIN is the old line's OWN span only (beyond it
   the shared side is ordinary wall -- here it meets the tower sink T3's reservation at x 36..38, z -20);
2. **Codex r4 BLOCKER (fixed):** the recorded `join.from/to` is clamped to the old span, else the old corner would read "strictly
   inside" and the demolition (and WD1, which reads the same span) would take the corner and the perpendicular side beside it;
   regression + Codex APPROVE;
3. the extension's height rule `tallMax` 5 (the old wall's 7): the offline BUILD on the live copy left a 1-wide 4-deep shaft through
   the east line as a 7-cell wall column + a 6-cell step column no stand could place -- 13 cells, past the waiver's 12, so the
   extension could never have completed; Codex APPROVE;
4. the escape proof's tries name their cut / trapped cells (in the `no_ring` why).

**Offline now (12:39Z copy + live pool):** ring **x -36..38, z -89..-20**; **621 cobblestone** (no post, no torch); escape 0 cut / 0
trapped; **built 621 / 621** by 4 fake builders; the independent check 0 hits; plots unchanged in place -- **X1 x 10..28, z -75..-63
(the workshop)**, X2 x -16..-4, z -63..-45 (the town hall), X3-X5 houses; the demolition 15 columns (x 3..8, 17..25), 114 blocks, dug
114 / 114 (held until done). The walk on the finished world: of 34,327 outside feet cells reached before, 464 are not after -- 435
on the east forest's CANOPY (tree tops the pathfinder walked on), 21 on a strip across the north water (z -91..-97; bots swim:
water is terrain, the walk model does not swim), 8 in pockets of <= 4. Map / record:
[`map-showcase-1105-r4.txt`](wallext-2026-11-04/map-showcase-1105-r4.txt), [`offline-record-showcase-1105-r4.json`](wallext-2026-11-04/offline-record-showcase-1105-r4.json).
Tripwire unchanged (WX1 / WD1 read the record's join, now clamped). ci2 at `1c93d54f`: **433/436** (the known base three on a copied tree).
