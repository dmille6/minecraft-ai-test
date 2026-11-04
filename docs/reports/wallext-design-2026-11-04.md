# wallext-01: the wall extension round the storage hall (design + built, 2026-11-04)

**Owner 2026-11-04:** "lets do A then extend the wall around the new building leaving room for additional buildings." A = the
storage hall (storehub piece A, [`storehub-ab-2026-11-04.md`](storehub-ab-2026-11-04.md)), which the bots' own siting puts in the town
ring north of the showcase town, OUTSIDE the wall: box x -21..-3, z -49..-39. Ledger `wallext-1104`, memory `wallext-1104.md`.

**Status: READY TO STAGE (showcase), not staged.** Branch `wallext-show` @ `b1da40da` (code `d0f6ccf5`; the two commits after it touch tests only: the orphan manifest, house.test's order filter). Base: the live showcase release `f76158f2`
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
