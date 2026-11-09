**Proposal: a spruce-taiga town with pale masonry, dark foundations, warm lights, and useful civic landmarks.** Keep the stepped rampart and its openings; give it a consistent architectural face. Concentrate the first investment at the road entrance, then finish complete wall runs.

I inspected both wall records and the supplied views. This is a design proposal; the new assemblies still require bot-built Paper proofs and owner preview pictures.

**A. Wall upgrade**

Use local coordinates `(u,v,h)`: `u` follows a wall run, `v` increases inward, and `h=y−b`. Existing O occupies `v=0`, S2 `v=1`, S1 `v=2`. Add the permanent face at `v=−1`.

```text
                    outside → inside
h=4, merlon column       B C . .
h=3                     B C . .
h=2                     B C C .
h=1                     D C C C
                        face O S2 S1

B stone_bricks; D deepslate_bricks; C retained cobblestone
```

Mirror each existing O cell into the outer face, including lower foundation cells and the existing alternating merlons. Make the lowest mirrored cell in each column deepslate bricks; everything above it stone bricks. Preserve end merlons and existing crenellation phase. Never restart the alternation independently halfway through a run.

This produces a dark terrain-following base and a continuous pale upper course. Avoid random material speckling: use chiseled stone bricks only at run-end accents, replacing ordinary face bricks one-for-one. Keep the 612 cobble step cells as an intentional working interior. Later, optional stone-brick replacement of exposed walk surfaces can improve the courtyard view.

The skin requires an extra outward column. Reject any segment whose face or construction access intersects water, another reservation, or an opening’s approach. Such segments remain cobble until a backed replacement design passes proof. Never fill a natural gap merely to improve the silhouette.

**Towers**

Use a compact, square **5×5 tower**, with a one-cell construction apron and a separate unobstructed approach:

- Floor: `(u,v)=0..4`, `h=0`, deepslate bricks.
- Perimeter: `u∈{0,4}` or `v∈{0,4}`, `h=1..6`.
- Entrance: omit `(u=1..2,v=4,h=1..2)`.
- Perimeter `h=1`: deepslate bricks; higher courses: stone bricks.
- Roof deck: all 25 cells at `h=7`, stone bricks.
- Merlons: four corners and four side midpoints at `h=8`.
- Two standing lanterns on opposite corner merlons, `h=9`.

Baseline shell bill: **111 stone bricks, 39 deepslate bricks, two lanterns**. Add terrain foundations and the separately designed access stair. A permanent external stair must preserve two-wide circulation; otherwise this is a maintenance-access tower, reached using removable construction stairs.

Prioritize two corner-associated towers, but site them beside the nearest suitable run, with their footprints wholly outside protected gaps. Candidate areas are the extension’s northeast shoulder and the old ring’s southeast shoulder. These are search areas, not approved footprints. Leave the northwest monument corner untouched. Do not build a tower at every historical ring corner, particularly the retired seam.

Long runs already have frequent ports; they need lighting and end treatments, not repeated towers. Add another tower only where a junction or useful lookout justifies it.

**The 18-wide road gatehouse**

Build twin towers and an overhead gallery. Preserve **every column `z=−38..−21`** through the gateway.

Candidate tower footprints are `x=33..37`, with north `z=−43..−39` and south `z=−20..−16`. Both require reservation and terrain checks; the southern footprint also requires explicit reconciliation with existing wall cells. Move towers farther apart if necessary, never inward into the gateway.

Let `G` be the highest road surface beneath the gallery. Use common tower floor datum `G`, with foundations beneath:

- Gallery: `x=34..36,z=−38..−21,y=G+7`: 54 stone bricks.
- Edge rails: `x∈{34,36}`, same z range, `y=G+8`: 36 stone-brick walls.
- Four lanterns on selected rail positions, outside the central walking lane.
- Optional raised-portcullis ornament: 18 iron bars at `x=35,y=G+6`, one per opening column.

The bars hang overhead; there is no gate or fence across ground travel. This broad, low gallery suits an 18-wide entrance better than a steep arch. Its lowest decoration remains well above bot headroom.

Baseline gatehouse bill: **276 stone bricks, 78 deepslate bricks, 36 stone-brick walls, eight lanterns, optionally 18 iron bars**, plus foundations and access.

Build the gallery outward from completed tower decks using already placed gallery cells as stands. Install rails behind the advancing builder. Prove safe return after every extension; no ground-level scaffold may occupy the road reservation.

**Lights**

Place lanterns on selected merlons at intervals no greater than eight wall columns, plus run ends and gateway flanks. Never occupy S2’s walking cells. Budget 48 new wall lanterns initially, adjusting after a night survey.

Acceptance target: measured block light at least eight along designated walking surfaces and port approaches. Tall lamps alone may leave shadowed ground; add low side lights where measured results demand them. Do not infer adequate lighting from attractive screenshots.

**Retrofit and records**

An unbacked “dig then replace” creates a temporary hole. Use these stages:

1. Publish a new generation of each affected wall record, retaining existing cells and protected openings. List additions, exact authorized replacements, temporary works, dependencies, and final cleanup.
2. Build foundations and the outward face bottom-up, completing one run between openings.
3. Verify face cells and states before permitting any original-wall replacement.
4. For optional walk or inner-face refinishing, replace one backed cell at a time. Never dig beneath an occupied stand.
5. Remove temporary works in reverse dependency order; verify every bot can exit.

Use the actual supported replacement schema; prose annotations alone must not authorize digs. One authoritative record owns each overlapping cell, including tower interfaces.

Keep sally ports two-wide through the thicker wall, including their approaches. Test the maximum solid-run length against the final footprint, not merely the original centerline. Preserve the retired north seam as retired.

The default skin removes no cobble. Bank any cobble recovered during later replacement for stoneworks or reusable scaffolds, with bounded pickup attempts; do not divert this supply to the junk well.

**Showcase wall budget and phases**

The records contain 843 O cells and 612 step cells. Their O cells map to **215 populated wall columns**, although the column classification totals are higher. Therefore derive quantities from live cells, not classification counts.

| Work | Stone bricks | Deepslate bricks | Other |
|---|---:|---:|---|
| One-for-one outer skin | 628 | 215 | Before siting exclusions |
| Road gatehouse | 276 | 78 | 36 walls, 8 lanterns |
| Two additional towers | 222 | 78 | 4 lanterns |
| Wall lighting | — | — | Allow 48 lanterns |
| **Baseline** | **1,126** | **371** | **36 walls, 60 lanterns** |

Reserve another **128 masonry blocks** for end returns and foundations, subject to terrain measurement. Temporary stairs/scaffolds are reusable inventory, budgeted separately.

Crafting the 312 stone into bricks brings available stone bricks to 894: the baseline shortfall is 232, before walls, contingencies, and landmarks. Deepslate can cover its allocation without furnace fuel. The 48 additional lanterns require 384 nuggets and 48 torches; protect other iron commitments.

First complete the gatehouse, then one nearby wall run. Follow with one eligible corner tower and complete runs as stoneworks supplies them. Build the second tower later. Each finished unit has a complete base, crown, and lighting; avoid spreading unfinished courses across town.

**B. Landmark catalogue**

All coordinates below are local; `h=0` is the finished ground surface. Bills describe the baseline variant, excluding terrain work and reusable scaffolds. Every kind reserves a construction apron and an accessible service position.

Use a stable seed from town ID, kind, and instance ID. Choose separately among orientation, trim palette, and roof/detail pattern; persist the choice. Material shortages pause a design rather than silently rerolling it.

**1. Working well pavilion — build first**

**5×5, height 5.** Site around an existing water-service well only after mapping bucket interaction stands. A junk well needs its own service-specific variant; do not combine drinking-water imagery with an item-destruction mechanism.

Layout: stone-brick ring around `u,v=1..3,h=0`, leaving center open; logs at `(0,0),(4,0),(0,4),(4,4),h=1..3`; 25 top spruce slabs at `h=4`; two hanging lanterns beneath the roof, away from service positions.

Bill: **8 stone bricks, 12 logs, 25 spruce slabs, 2 lanterns**. Uses existing planks and limited surplus logs. Variants: entrance direction, spruce/oak posts, flat or separately proven gabled roof.

Build curb, posts, temporary side steps, roof, lights; remove steps last. Preserve the existing shaft and water. **Use:** weather-sheltered service destination. **Effect:** `well_service` logs successful bucket/disposal operations, approach failures, and median service time.

**2. Market court — build second**

**9×9, height 4.** Site beside the core plaza and storehouse, outside their footprints and hauling routes.

Pave `u,v=0..8,h=0` with deepslate bricks. Keep `u=3..5` clear as the central aisle. Two stall counters occupy `(u=1,v=2..6)` and `(u=7,v=2..6),h=1`. Four log posts at `(0,1),(2,1),(6,7),(8,7),h=1..3`; slab canopies cover `u=0..2,v=1..3` and `u=6..8,v=5..7` at `h=4`.

Bill: **81 deepslate bricks, 10 stone bricks, 12 logs, 18 spruce slabs, 2 lanterns**. Variants: stall rotation, wood species, counter trim. Allocate actual market interaction positions before construction; add containers only through the market’s supported workflow.

Ground stands and temporary side steps reach the canopies. **Effect:** `market_service` records completed exchanges, queue delay, and route failures.

**3. Park court — build third**

**7×7, height 2.** Fits inside park box `x=−41..−34,z=24..32`, subject to current reservations.

At `h=0`, pave the two-wide cross `u∈{2,3}` or `v∈{2,3}`: 24 stone bricks. Use moss in the remaining 25 cells. Put four inward-facing spruce stairs on corner planting beds as benches. Add two stone-brick posts with standing lanterns at opposite corners.

Bill: **26 stone bricks, 25 moss blocks, 4 spruce stairs, 2 lanterns**. Variants: cross rotation, bench wood, symmetric/asymmetric moss pattern. Build entirely from ground stands, with floor replacement recorded.

**Use:** lit through-route and explicit idle rendezvous outside freight traffic. **Effect:** `park_use` records routed visits, rendezvous arrivals, and nearby congestion change.

**4. Mason’s statue**

**5×5, height 6.** Site at the garden entrance or a road junction; avoid competing with the northwest monument.

Plinth `u,v=1..3,h=0`; two boots `(1,2),(3,2),h=1`; body `u=1..3,v=2,h=2..3`; head `(2,2),h=4..5`; arms `(0,2),(4,2),h=3`; hanging lantern beneath one arm.

Bill: **9 stone bricks, 12 deepslate bricks, 1 lantern**. Variants: facing, raised-arm pose, pale/dark figure palette. Temporary side stair supplies elevated stands.

**Use:** named navigation and muster point. **Effect:** `statue_waypoint` records assigned arrivals and navigation failures; owner picture rating measures its aesthetic contribution separately.

**5. Lake lantern tower**

**5×5, height 9.** Reuse the tower shell above, replacing eight upper-wall cells with glass panes. Site on surveyed dry northern shoreline with a permanent land approach; never on ice or a water bridge.

Bill: **103 stone bricks, 39 deepslate bricks, 8 glass panes, 4 lanterns**. Two additional lamps sit inside the upper chamber. Variants: shoreline-facing windows, dark/pale bands, merlon pattern.

Build with removable exterior stair and working platforms. **Use:** shoreline waypoint and illuminated arrival point, not a magical beacon. **Effect:** `shore_arrival` records successful returns and approach failures. Require visibility screenshots from relevant routes.

**6. Civic time tower**

**5×5, height 9.** Reuse the tower shell beside X2 town hall, preserving its entrances. Baseline bill: **111 stone bricks, 39 deepslate bricks, 2 lanterns**; optional functional display adds an item frame and clock.

Variants: display orientation, dial backing, parapet pattern. The baseline has a decorative dial only if clearly identified as such; an actual time display requires the item-frame proof.

Build with the tower scaffold sequence. **Use:** meeting waypoint; optional readable time display. **Effect:** `clock_visit` records muster arrivals and display interaction/readability checks. Do not claim productivity from timekeeping without evidence.

**7. Contained fountain**

**7×7, height 3.** Candidate for a clear portion of the core plaza only if routes survive; otherwise use the garden.

Floor `u,v=1..5,h=−1`: 25 deepslate bricks. Basin perimeter at `h=0`: 16 stone bricks. Center column `(3,3),h=0..1`: two chiseled stone bricks. One source at `h=2` flows into the contained basin.

Bill: **25 deepslate bricks, 16 stone bricks, 2 chiseled stone bricks, one reusable water bucket**. Variants: orientation, rim material, square or separately tested stepped basin.

Construct and inspect the dry basin first; place water last from a dry stand. **Use:** optional bucket service and civic focal point. **Effect:** `fountain_service` records successful fills, escapes, leaks, and screenshot rating. It remains last because water adds operational risk.

**C. Proofs, pictures, and fleet release**

Before showcase construction, bots build every selected variant on Paper using their own clicks. Capture daylight, night, overhead, and approach pictures from those actual builds for owner review.

Required proofs include:

- Interrupted retrofit recovery, head-generation authorization, and zero unauthorized digs.
- Full-width gate traversal during gallery construction; simultaneous opposing bot traffic.
- Scaffold ascent, descent, removal, and reconnect recovery. Heights above ten remain a separate qualification.
- Pane/bar connections and lantern support after adjacent edits.
- Fountain containment, bucket collection, freeze behavior, and swimming recovery with water-bridging disabled.
- Item-frame placement, facing, clock insertion, persistence, and recovery. Bells, campfires, and signs are omitted until separately proven.

Pure functions would include `wallFaceCells`, `towerCells`, `gatehouseCells`, `landmarkCells`, `seededStyle`, `siteCandidates`, `replacementGeneration`, `constructionDependencies`, `billOfMaterials`, and `accessInvariant`. Each cell carries material, `st`, support, stand, and dependency evidence.

**D. Acceptance and useful work**

Declare wall metrics in `wall_upgrade_effect`: verified cells, unauthorized digs, opening widths, reachable destinations, traversal failures, and lighting coverage. Gatehouses add traffic latency; towers add successful maintenance access. Compare before/after pictures from fixed viewpoints.

Release one proven style to one fleet town first, then expand. Reserve the showcase’s 512 logs. While masonry waits on fuel, bots can mine, process stone, supply materials, operate markets, maintain farms, and complete cheaper landmarks. Construction queues should consume surplus without manufacturing unnecessary work.