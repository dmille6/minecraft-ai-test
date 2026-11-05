# stepwell: the town stepwell -- a showcase landmark that becomes the miners' safe shared descent (design + piece 1, 2026-11-05)

**OWNER 2026-11-05:** asked whether an Indian-style stepwell is worth it; the control session recommended a showcase landmark that is
the miners' safe shared descent, in two phases -- (1) surface to the iron layer (~y 16): a terraced stepwell with railings, landings,
lighting and a water pool; (2) down to the lava layer with a SEALED lava/obsidian station -- after bucketfix-01 and the obsidian
proof ([`obsidian-design-2026-11-04.md`](obsidian-design-2026-11-04.md)). Owner: **"Yes"** (design it). Ledger row `stepwell-1105`.
Claude and Codex designed independently from the same facts; Codex's answer is
[`stepwell-2026-11-05/codex-design.txt`](stepwell-2026-11-05/codex-design.txt), the reconciliation is section 4.

## 0. Answer

**Worth it as a landmark now, and as a descent only below y 16.** The town stair (shaft-02) already takes miners to y 16; what fails
today is the miners' *personal* cut below it (82% of fleet `deepen` rows are "cut a step but could not stand in it") and the way back
up (13% of fleet trips, 18% on the showcase, end stranded). So:

- **Phase 1a (piece 1, built):** the TANK -- a 23 x 23 square stepped tank cut into the ground: a rim walled outside (a parapet with
  one 2-wide gate toward home), two terraces 4 deep with 2-wide walkways, a 2-wide full-block flight per tier turning a side each tier,
  cobblestone-wall railings on every drop, torches on the posts, a 9 x 9 court 8 below the rim with a 3 x 3 basin (dry until
  bucketfix-01; then the pool). Built stone floors and trim, natural stone or cobble faces. One builder, top down by layers, every
  walkway posted before the layer below it is cut.
- **Phase 1b:** an ENCLOSED descent from a portal in the court wall to y 16 (a 2-wide lined switchback, Codex's module; no opening in
  any walkway). Tier 2, a building piece. (A third terrace needs W 29+; the measured sites do not hold one.)
- **Phase 2:** the same enclosed descent on to feet y -53 and the sealed station (cast cells behind a partition, never lava beside a
  walkway). The *use* -- deep miners descending and returning by it instead of cutting their own stair -- is protected code
  (deepmine.mjs, skills.mjs deep*), tier 3: both engines, a fleet canary, a fleet KEEP before the showcase.

## 1. Measured

### 1.1 Deep miners today (3 days to 11-05 02:18Z, full walk, `stream_rows` per bot, rotation-aware)

| | Fleet (80 bots, 6,027,242 rows) | Showcase (15 bots, 716,321 rows) |
|---|---|---|
| deep-miner trips started | 618 | 77 |
| ended home (banked) | 511 (iron 269, diamond 242) | 50 (iron 41, diamond 9) |
| ended **stranded** on the return | **81 (13.1%)** | **14 (18.2%)** |
| ended at the collar / stair (descend failed) | 23 | 2 |
| `deepen` rows (the personal cut below y 16) | 855 | 76 |
| ... "reached_y" | 91 (10.6%) | 5 (6.6%) |
| ... "cut a step but could not stand in it" | **705 (82.5%)** | **58 (76.3%)** |
| deaths during a trip | 2 (lava swim at y -29 in work; drowned at y 51 on the return) | 0 |
| all deaths (positive control) | 55 (27 below y 16) | 0 (`_death` rows: also 0 in the 10-2x rotated files) |
| `_entombed` / `_marooned` rows during trips | 1,879 / 290 | 747 / 171 |
| `_entombed` / `_marooned` below y 16 outside trips | 5,793 / 2,929 | 131 / 29 |

Denominators: every count is out of the stated rows and bots; the zero showcase deaths have the fleet's 55 `_death` rows by the same
script as their positive control. Script: [`stepwell-2026-11-05/deepmeasure.py.txt`](stepwell-2026-11-05/deepmeasure.py.txt).
**Reading:** the deep miners die rarely (2 of 55 fleet deaths); what a shared descent would buy is *time and completed trips* -- the
personal stair below 16 mostly fails, and one trip in eight cannot get back. It is not a mortality fix (Codex said the same).

### 1.2 Where it can go (a read-only copy of the showcase's region files, 11-05 02:13Z, +-110 round home, y -64..110)

The survey is the bot's own code (`bots/scripts/stepwell-offline.mjs` runs stepwell.mjs `surveyStepwell` + tidy.mjs `plotPrep` /
`replantCells` over the copy and the pool's 20 records): 8,184 centres (every 2 blocks, Chebyshev 30..94 from home) x 4 orientations =
32,736 candidates; full table in [`stepwell-2026-11-05/site-survey.json`](stepwell-2026-11-05/site-survey.json).

| Refusal (W 23, two tiers) | candidates |
|---|---:|
| another record's reservation (+2): roads, the ziggurat, the wall, towers, expedition markers, the village and trial chambers, ... | ~23,600 |
| the land plan's zone is town / homes / farms / tree farm (allowed: industry, monument, wild) | ~4,270 |
| water at the ground in the rim | 3,664 |
| the gate's front not a dry floor within 1 of the rim | 1,066 |
| the rim more than 2 under its level / water in a tier's cut or faces | 375 / 85 |
| **surveyed sites** | **26** |
| ... whose felling keeps a tree (no stand) / a stand on a tank cell | 22 / 2 |
| **sites with a complete felling** | **2** (the cheapest chosen) |

Without felling no site exists at all (every candidate with dry ground had a tree; W 27, 25 and 21 the same), and with the rim walled
outside no W 27 or W 25 site has a complete felling: **W 23** is the size the showcase holds. The taiga is forest everywhere, so the
felling is part of piece 1 (section 2.4).

**The chosen site (W 23):** centre **-52, -74**, rim y **62**, gate facing home, north of the ziggurat in
the land plan's *monument* zone, 90 from home (Codex's independent candidate was -49, -63: the same place). Footprint x -63..-41,
z -85..-63, reservation +2 at every height; exit -52, 63, -62; 0 record cells in another reservation; the walk proof passes.

| per tier | solid cuts | soft faces (dirt/gravel/sand: laid) | caves met | falling blocks | ore | water | lava |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 (with the terrain above the rim) | 2,852 | 208 | 3 | 179 | 8 | 0 | 0 |
| 2 | 270 | 0 | 11 | 0 | 0 | 0 | 0 |

The phase-2 column (a 9 x 9 under the court centre, down to y -64): solid with iron at y -8..40; caves 6-30% of the cells at y -32..-56;
diamond 5 at the -40s; **lava at y -56..-64** (one cell inside the column, more beside it: the section picture); no water.

### 1.3 Cost and time (piece 1: the felling + tiers 1-2)

- Felling: 9 spruces, 56 logs, 3 stands (5 stone), 15 leaves, 9 saplings replanted (the tree farm, else the wild zone).
- Digs: 3,158 solid cuts + 601 bad blocks in floor/trim/face cells + 56 logs = **~3,800**.
- Placements (the record's 1,514 cells less what already stands): floors and trim **~530** (cobblestone or stone bricks), faces and
  fills ~120, posts **195 cobblestone walls** (crafted 6 -> 6 from cobblestone), **46 torches**, 5 stand blocks -- **~900** in all.
  Stone bricks are optional (the palette falls back to cobblestone: the town's bricks stay with their bills).
- Rates measured on the showcase (4 days of `_build_visit` / `_shaft op=visit`): the stair's visits 3.6 digs/min, the tower sink 5
  placed per visit-minute; the Paper proof's first visits ran faster (section 7). **3,800 / 3.6 + 900 / 5 = 1,235 min = ~21 active
  builder-hours**, + 30-60% walking and checking = **27-33 builder-hours**: at one builder working it a quarter of its time, about
  five days (Codex: one to two weeks for its larger court). Cobble is not the constraint (bags hold ~6,000); labour is.

## 2. The design (Claude)

### 2.1 Shape (stepwell.mjs `columnMap`, `planTank`; pure)
Local frame (u, v), +v away from the gate's side (shaftgeom.mjs toWorld); r = a column's ring index from the outer edge. The RIM is
4 rings: an outer PARAPET (a wall post on every column but a 2-wide GATE in the middle of side 0, facing home when the site allows),
a 2-wide walkway, an inner RAIL ring. Below it every 3 rings are a BAND: band t (r from 4 + 3(t-1)) is a terrace 4 below band t-1,
band T the COURT; in a band below T the two outer rings are the WALKWAY, the inner ring the RAIL ring. FLIGHT t (one per
tier) joins band t-1 to band t on side (t-1) mod 4 (side 0 faces home): a HEAD raised to band t-1's level and posted, two TOP treads
at +3, then +2, +1, band t's floor; its inner ring raised to the tread heights and posted (the balustrade); band t-1's rail ring has a
2-wide GAP over the top treads. The court's centre 3 x 3 is a BASIN one lower. Every step is a full block (no orientation).
**The walk proof** (`walkCheck`): every walkway column's four neighbours are walkway within 1, higher, or a post standing at least as
high; and every walkway is reached from the gate by steps of 1 (no pocket a bot can stand in and not walk out of). It holds for every
width and tier count the shape allows (W 21..33, the test), and a missing post or a 2-deep tread fails it (the positive control).

### 2.2 Cells and roles (the record; tripwire SW1)
`floor` (walkways, built stone), `trim` (the top course under a post), `wall` (a face over a lower neighbour: natural stone kept, dirt,
gravel, sand, clay or ore dug and laid), `body` (a raised flight's hidden fill), `under` (the cell under every top: a cave there is
filled), `post` (a wall), `light` (a torch on a post: never holds a layer -- a town without torches still gets its tank), `stand` (a
felling stand). The CUT is the record's `clear` list: every cell from a column's top up to g + 3, and above that only what stood at
siting (terrain and trunks); the felling's logs and leaves are clear entries of kind tree / leaves with the record's `replant`.

### 2.3 The safety order (stepwell.mjs `stepwellNext`; the visit `runStepwellVisit`)
Top down by LAYER. A layer's unit: (1) SURVEY every cell to cut and its six neighbours -- **lava anywhere stops the tank above it**
(the record's `stopped` generation: it stands as built, never cut deeper); water beside a cut is **sealed by a placement first** (a
record cell, or a cut cell: SW1); water outside the record stops it too; an unread cell ends the visit; (2) the CUTS (never the bot's
own body or floor: the visit moves to another stand for those); (3) faces and bodies, (4) the cells under the tops, (5) the tops,
(6) the POSTS, (7) the lights. Band t-1's posts therefore stand before tier t is cut a second layer deep: **no walkway ever meets a
drop of more than 1 during the build**, and the flight -- never cut -- is the way in and out at every stage. The visit ends at the
exit (the rim stand outside side 0's middle). One builder (`builders: 1`): one frontier, no body races.

### 2.4 The site and its trees
The nearest dry, unreserved site in the industry / monument / wild zones (never town, homes, farms, the tree farm), in four
orientations (the gate toward home first), the rim at the rim ring's most common ground (2 below .. 9 above it: cut), the gate's front a
dry solid floor within 1 of the rim (the exit stands on it), no water in the cut of the tiers it builds, no lava anywhere it surveys;
then the FELLING: the groundskeeper's own plotprep code (tidy.mjs `plotPrep`: every trunk on the footprint, a stone stand beside one
too tall for a ground stand, up to 5 steps) and its replants (`replantCells`: the tree farm, else the wild zone). A site whose felling
would keep any tree, or put a stand on the tank's own cells or above its cut, is refused. The felling runs as the visit's first phase through buildrun.mjs `runVisit` on the record's felling
view (`fellView`): every sapling planted before a trunk is cut (B4), its rows `kind=tree saplings=a/b` judged by the tripwire's G5
over the HEAD record's replants -- the same rows the groundskeeper writes.

### 2.5 The pool, the descent, the station (later pieces)
- Pool: the basin filled by bucket pours once bucketfix-01 is KEPT and on the showcase (a 3 x 3, 1 deep, open sky; the court around it
  dry; a bot steps out of it). Not built in piece 1.
- Descent (phase 1b to y 16, phase 2 to -53): ENCLOSED behind a court wall portal, 2-wide treads, three air cells over each, lined on
  every face (shaft-02's line-before-dig), no opening in any walkway; landings at the iron band and at -53.
- Station (phase 2): the obsidian design's contained cast (a 1x1 hole over an isolated lava source, water poured and scooped back,
  dug from a dry stand) from a walled side room at feet -53, never lava beside a walkway; bucket work needs bucketfix-01.

### 2.6 How the deep miners use it (protected, later)
Today: the town stair to 16, then `mine` cuts a personal stair to -53 (the measured failures). With the descent built: deepmine.mjs
chooses the stepwell's route when its record says `traversal verified` (a separate state from `complete`), walks it a few stands at a
time (the stair's hop walk), and returns by it; `deepen` is skipped while the shared route reaches the trip's depth. This touches
deepmine.mjs and skills.mjs deep* (tier 3). Not before phase 1b stands and is walked on Paper.

## 3. Codex's independent design (summary; full text in `stepwell-2026-11-05/codex-design.txt`)

Worth it as a modest landmark attached to verified transport; not as a monumental open pit to y 16. A 33 x 33 court, three terraces 4
deep (F-4, F-8, F-12), four cardinal 3-wide flights each descending 12 one-block steps through every terrace, wall railings, a 7 x 7
bottom court with a 3 x 3 pool (dry until bucketfix). Below it an enclosed 2-wide switchback stack (a 16-block module, 16 x 7, solid
partition) entered from a court portal, to y 16 and later -53. Site: x -49, z -63 (NW, north of the ziggurat). Safety: one frontier,
shallow lifts with a maintained ramp, retaining faces and guards before the next public edge, seal-before-dig with the seals in the
record, stop on liquid, separate `complete` / `traversal verified` / `transport enabled` states. Miner use tier 3 later. First piece:
a 4-step entrance module (an overlook). Cost: 6,000-9,000 digs and 45-90 builder-hours for the court plus the route to 16; the dry
lower route has more transport value than ornament; do not make the dry descent wait for bucketfix.

## 4. Reconciliation

| Point | Codex | Claude | Taken |
|---|---|---|---|
| Worth it | landmark + verified transport; not an open pit to 16 | the same (the stair already reaches 16; the value is below it) | **agreed** |
| Size | 33 x 33, 3 terraces | 27 x 27 first, then 23 | **23 x 23, 2 terraces**: the only size the showcase holds once the rim is walled (section 1.2) |
| Flights | four 3-wide straight flights, 12 steps through every terrace | one 2-wide flight per tier, turning a side each tier | **Claude's** for piece 1 (2 wide meets the brief's 2+; one flight per tier keeps each terrace a closed ring with one gap, the walk proof covers it); Codex's four-fold symmetry is the look to add in a later generation if the owner wants it |
| Railings | walls on every high edge and shoulder; the outer ring walled but the entrances | inner rails, head and flight balustrade; the walk proof | **both**: Codex's r1 review found the open rim beside 2+ drops outside -- the rim is now walled outside with one 2-wide gate (Codex's own design) |
| Below the court | enclosed switchback stack from a court portal | first sketch: a spiral under the court | **Codex's**: enclosed behind a portal, no opening in the court floor |
| Site | -49, -63 (NW, north of the ziggurat) | -50, -72 (the survey's pick) | **agreed** (the same place; the survey's exact centre) |
| Trees | measure them | every site is forest: fell with plotprep's stands and replants (G5) | **Claude's** (measured: 0 sites otherwise) |
| Safety | one frontier, lifts with a ramp, guards before the next edge, seals recorded, stop on liquid | the same, by layer; posts before the second layer; seals in cut cells (SW1); lava stops | **agreed** |
| States | complete / traversal verified / transport enabled | complete; `stopped` | **agreed**: the use (phase 2) adds the two Codex names |
| bucketfix | only the pool and the station wait for it | the same | **agreed** |
| First piece | a 4-step entrance module | the felling + tiers 1-2 (the brief: "the first 1-2 tiers") | **Claude's**: top down, so tier 1 (the rim, its walls and the first terrace) stands first and tier 2 follows; T is the record's (SW.tiers 2) |
| Cost | 45-90 builder-hours for court + route to 16 | 27-33 for the felling + 2 tiers (W 23) | **agreed** order of magnitude: about a week at one builder |

## 5. Pictures

- Top view of the planned site (natural ground round it, the tank's columns by depth, posts dark, torches yellow, flights brown, the
  basin blue, the exit pink, felling stands red; the parapet ring outermost): [`stepwell-2026-11-05/top.png`](stepwell-2026-11-05/top.png)
- Side cross-section through the centre, y -64 .. 74, real blocks from the region copy, the tank cut into them, the enclosed
  descent (schematic, tan; phases 1b and 2) and the station (purple) -- note the lava (orange) beside the column at -53: [`stepwell-2026-11-05/section.png`](stepwell-2026-11-05/section.png)
- Isometric view of tiers 1-2 as built: [`stepwell-2026-11-05/iso.png`](stepwell-2026-11-05/iso.png)
- Renderer: [`stepwell-2026-11-05/render.py.txt`](stepwell-2026-11-05/render.py.txt) over `stepwell-offline.mjs --grid`.

## 6. Pieces, tiers, queue

| Piece | What | Tier / lane |
|---|---|---|
| **stepwell-01show** (built) | record + siting + felling + tiers 1-2 + rails + lights | 2, showcase |
| stepwell-02show | the court portal + the enclosed descent to y 16 (lined, 2-wide switchback) | 2, showcase; Paper e2e |
| stepwell-pool | the basin filled (bucket pours) | 2, after bucketfix-01 KEEP on the showcase |
| stepwell-03show | the enclosed descent 16 -> -53 + the station room (dry) | 2, showcase |
| stepuse-01 | deep miners descend/return by the verified route (deepmine.mjs, skills.mjs deep*) | **3**, fleet canary with it off outside the showcase pool |
| obsidian-01 at the station | the contained cast from the station | 3 (the obsidian design's O-L decision) |

**Queue.** Claude: stepwell-01show in the showcase lane after the current fold batch -- the stepwell is the last of the finite projects
in PROJECTS (after the enchanting workshop, before the yard and the sinks), with one builder slot, so it takes only a builder the
town's buildings leave free and never starves them; install SW1 with it. Codex's design view (section 3): the dry lower route has more
transport value than ornament -- so stepwell-02show (the enclosed descent) should follow piece 1 directly, before any ornament
(Codex's four-fold flights), and the pool and the station wait for bucketfix-01 only. Agreed: 01show -> 02show -> (pool | 03show) ->
stepuse-01 (tier 3, fleet canary with the job off outside the showcase pool).

## 7. Piece 1 as built: stepwell-01show

- **Branch** `stepwell-01show` on the live showcase release `8b4ea9cc` (pushed). Tier 2: no protected file or function touched
  (`skills.mjs` gains `buildStepwell` and one line each in the dispatch, the project states and `recordDamaged`; none is listed).
- **Code.** `bots/src/stepwell.mjs` (pure: switch `STEPWELL` / `STEPWELL_POOLS` default showcase, `columnMap`, `walkCheck`, `planTank`,
  `stepwellNext`, `standsFor`, `surveyStepwell`, `standsFit`, the record, `fellView`, `fellPending`, `stepwellDamaged`, `stepwellStopped`);
  `bots/src/stepwellvisit.mjs` (`runStepwellVisit` + `stepwellBotEffects`, the bot-facing clicks: a torch may click the top of the wall
  post under it); `skills.mjs buildStepwell` (siting with a 6-h town-wide wait on no site, the felling through runVisit, the tank,
  walls crafted 6 -> 6 from cobble up to 48 a visit, torches drawn from town, rows `_build`, `_stepwell op=fell|visit|no_site|stop|egress`,
  `_build_visit`, `_build_bag`); `shop.mjs` (PROJECTS: one builder, after the enchanting workshop; guarded whatever its switch);
  `features.mjs` (`_stepwell_mode`); `bots/scripts/stepwell-offline.mjs` and `stepwell-landmap.mjs` (the survey and the pictures' data).
  Rollback `STEPWELL=off` (a sited record stays a reservation).
- **Tests** `bots/test/stepwell.test.mjs` 31: the walk proof for every allowed shape + a missing-post positive control; flights, gate,
  parapet; the plan (cells and cuts disjoint, the record's clear list is the plan's cuts, stands are record cells); the safety order
  (lava stops, water sealed before a cut, a skipped seal blocks, own cells move the bot, a felled cell is never sealed, a post waits for
  its trim); siting (lava/water refusals with positive controls, reservations, zones, trees, the gate's front, stands that do not fit);
  the W 21 tank built END TO END by the real visit loop on a fake world (every cell done, the rim's posts before any cut 2 below them,
  the visit ends at the exit); another body's cell never dug; wiring (9 anchored lines, each with a one-character mutant). 4 anchored
  module mutants (seal survey, posts before depth, egress, the comment-stripper control). Project-order tests run with STEPWELL=off.
- **Reviews.** Codex r1: 3 BLOCKERS (a skipped seal let cuts proceed beside water; other bots' bodies; the open rim beside 2+ drops) --
  fixed (sealOp, `occupied`, the walled rim with one gate). Claude r1 (independent subagent, two engines on the tripwire): 3 BLOCKERS (a
  stand on a tank cell dropped -> a tree never felled; a stand above the cut top never cut -> never complete; a seal in a felled log's
  cell trips SW1) -- fixed (`standsFit`, `sealKeys`). Codex r2: 2 BLOCKERS (water at the gate's front read as ground; the exit's feet
  fixed at g+1 on slopes) -- fixed (a dry solid front, `site.exitY`). **Codex r3: NO BLOCKERS. Claude r2: NO BLOCKERS** (its two notes --
  `unsealed` backs off; a waterlogged good block is never sealed into -- fixed). Reviews:
  [`stepwell-2026-11-05/reviews.txt`](stepwell-2026-11-05/reviews.txt).
- **Suite** ci2 at `bfb600da`: **426/429**, the known trio (ceilescape, nothing-important-is-orphaned, protected-paths: the copies have
  no .git). The first run (9c370c65) failed 4 more (paths-wiring, wall-wiring, ziggurat-project list the showcase's projects;
  plinth02's licence-row window): fixed in bfb600da.
- **Paper (sandbox3, `sandbox/stepwell/stepwell-e2e.mjs`, the real visit loop and effects over a real mineflayer bot, W 21 one tier on
  flat ground):** **3/3 PASS** at `85d50721` (bot code = `bfb600da`; results
  [`stepwell-2026-11-05/paper-results.jsonl`](stepwell-2026-11-05/paper-results.jsonl)).
  - `build`: the one-tier tank from flat ground in 10 visits (24 min, 1,245 digs, 771 placements); the server's truth: every cut air
    4,443/4,443, floors 302/302, trim 139/139, **posts 139/139, torches ON the posts 33/33** (the new click on a wall's top face),
    faces 158/158, unders 380/380, bodies 10/10; the builder ends at the exit.
  - `cave`: a 3-cell cave under the court's floor and a water source in a tier wall's face: the water sealed before the cut beside it
    (0 water left in any record or cut cell), the cave's under cells laid, every cell as planned, the builder at the exit.
  - `lava`: a lava source under a cut of the last layer: the tank STOPPED (onStop at layer 67, `lava at 7200,66,7600`), the lava still
    there (nothing dug beside it), the builder at the exit.
  - Found and fixed on the way: stands chosen at the click's 4.5 left 48 posts `no_reach` (stands now within 3.8); the driver's kit
    and truth. Not fixed (by design, measured): a W 21 tier fills the bag with ~900 dirt -- the bag's own junk/deposit rules carry it.
- **Tripwire: SW1** in main's `docs/reports/shop-01-2026-10-25/shopread.py.txt` (selftest ok; 5 new anchored mutants in
  `shopread-mutants.py.txt`, all 167 killed): the stepwell's placements on its cells, its cuts on its clear list (default G1/G2), its
  felling's rows by G2/G5 as for every record, and ONE addition -- a `kind=seal` placement in a cut cell (kind cut) of any generation.
  **NOT installed: install it with the release** (the first seal would otherwise TRIP H1).
- **Siting on the live world.** The offline pick is -52,-74 (rim 62), but the bot sites from the chunks it has loaded; a no-site visit
  waits 6 h town-wide. Expect the first `_build op=sited project=stepwell` only when the builder is near the north-west.

## 8. Owner decisions

1. **The site**: north-west, 90 from home, beyond the ziggurat in the land plan's monument zone (no closer site exists: the town's
   reservations, homes and farms zones, water and forest fill the rest). OK, or reserve a plot for it nearer the town stair (the
   industry sector is 16 wide between the town and the village)?
2. **Felling 9 spruces** on the site (replanted in the tree farm / wild zone, as the groundskeeper does). OK?
3. **Phase order**: piece 2 = the enclosed dry descent to y 16 before any ornament (Codex's and Claude's view), the pool after
   bucketfix-01, the miners' use (tier 3) after the descent is walked on Paper.

## 9. Owner decisions (11-05, via the coordinator) and piece 2 as built: stepwell-02show

**Owner 11-05: agrees with all three** -- the north-west site (-52,-74) is OK; felling the 9 spruces (replanted) is OK; the walled
descent comes before any decoration. stepwell-01show joins the showcase release after townstyle-02/03 with SW1 installed -- **take
`d83fd8b1`, not 85d50721** (it carries the torch fix found by piece 2's Paper run, below; Codex r3 NO BLOCKERS on it).

- **Branch** `stepwell-02show` @ `499278e0` on the live tip `0e8a1cfa` (+ stepwell-01 merged beside townstyle-01's cottage). Tier 2.
  Rollback of the descent alone: `STEPWELL_DESCENT=off`.
- **The descent** (Codex's module, section 3): a 2-wide, 2-high PORTAL in the court wall (side 2, away from the gate) at the court's feet
  (g-7); two 2-wide flights of 8 a module (three air over every step), 3-long landings, a solid partition between the flights, every
  other face lined (natural stone kept, dirt/gravel/sand/ore laid), a torch on each landing; modules to feet **16**, the last flight
  cut short onto a 3-long landing in its own lane. Under side 2's terraces and rim, inside the footprint. At the showcase site: **395 air
  cells, reaching feet 16; 3 caves beside it, 5 ores, no water, no lava**.
- **Built as STATIONS** (one per tread, its air top down, its lining, its tread, its torch), in walking order from the portal (breadth
  first): a layer order cannot cut a tunnel -- the far end has no stand until the near end is open (found by the fake-world e2e).
- **The upgrade**: a stepwell-01 record (no descent) gains it as its next generation (`stepwellWithDescent`): tank cells and the felling
  kept, the portal's 4 wall cells become cuts, the record open again until the descent stands (`descent_built`). The siting surveys the
  descent too (`surveyDescent`: lava or flooded air raises the bottom 3 above it). The stair's body claim is held while a descent is
  planned (the entombment reflex stands down, as in the town stair). The visit's egress walks the descent up by hops of 6 stands.
- **Proofs**: `descentCheck` (treads, two air, steps of 1, a third air over every step up, AND the way in from the court) for six rim
  heights; every cell in exactly one unit; the tank and descent built end to end on a fake world; a mutant each for the jump room and
  the shut portal.
- **Reviews**: Codex r1 and Claude r1 found the SAME blocker -- the descent's lining claimed the court's feet/head in front of the portal
  and walled it shut (fixed: a neighbour above its tank column's top is never lined; the proof checks the way in). Codex r2, Claude r2:
  NO BLOCKERS. The Paper run then found torches refused (a side click made a wall_torch) holding the descent for 40 visits -- fixed (a
  torch clicks only the top of what is under it; torches never hold a unit); Codex r3: NO BLOCKERS.
- **Paper (sandbox3, `sandbox/stepwell/descent-e2e.mjs` on the branch; the tank carved by RCON as stepwell-01 builds it, the real visit
  loop builds the descent; W 23, rim 70, to feet 16): 3/3 PASS** at `499278e0`
  ([`stepwell-2026-11-05/paper-results-descent.jsonl`](stepwell-2026-11-05/paper-results-descent.jsonl)):
  - `descent`: 3 visits, 8 min, 478 digs: every cut air 472/472, treads 192/192, lining 590/590, **torches 6/6**, the builder walked up
    from feet 16 and out of the gate.
  - `water`: a water source in the lining mid-descent: sealed before the cut beside it, complete, 0 water left.
  - `lava`: a lava source in a flight's air at y 30: the descent STOPPED there (`lava at 7301,30,7606`), the lava untouched, the builder out.
- **Tripwire SW1, extended** (main, NOT installed): the stepwell's CLEARS are judged over the record chain too (`stepwell_clear_ok`: a
  foreign dig on a cell of any generation, any other dig on a clear entry of any generation) -- the upgrade moves the portal's wall cells
  from `cells` to `clear`. Selftest ok, 4 more anchored mutants, all 171 killed. Install it with stepwell-01show (one rule for both).
- **Suites**: ci2 at 27b5c390 433/437 (the known three + lavastep, a known flake); final-sha runs below.

Next: the pool after bucketfix-01; **stepuse-01** (tier 3: deepmine.mjs descends and returns by the verified descent instead of its own
stair below 16; a fleet canary with the job off outside the showcase pool) after the bucket fix, per the owner's order.
