# Build style guide: what "beautiful" means in this world

Source: the owner's reference folder `minecraft-build-designs/` (2026-11-11), about 220 files in 12 folders plus 16 `.litematic` schematics. Owner direction: **complexity and build time are not the constraint; a beautiful world is.**

This is a style reference, not a design change. It adds no code, proposes no queue entries, and changes nothing under the 11-09 feature freeze. Anything that turns a section below into bot behaviour goes through the normal design review (Claude + Codex) first.

## How this was read, and its limits

- Every folder was reviewed as thumbnail contact sheets (about 4 x 3 per sheet). Individual images were not opened at full resolution. Block palettes below are what is legible at thumbnail scale, not block-exact.
- Nearly everything is third-party imagery (YouTube/TikTok stills, stock sites, bloxelizer previews). These are references for the look; do not republish them. The licence/author of the `.litematic` files is unknown. The two `*.prefab.json` files in `minecraft-houses/` were not inspected.
- Several folders overlap the earlier refs at `~/Documents/minecraft-style-refs/` (dock, farms, house, street and paths, topdown, townedge) and its pattern book (20 small + 16 landmark picks). **New here:** `minecraft-ziggurats`, `minecraft-walls-castles`, the `minecraft-*` house/farm/dock/path sets, and the 16 schematics.

## The one-paragraph look

A walled medieval-fantasy valley. Warm timber and cool grey stone against deep green. Steep dark-slate or terracotta roofs on timber-frame houses with stone bases. Every square of ground is finished: moss, flowers, hedges, vines, paths with planted edges. Towns follow a legible plan (plaza, radiating streets, plots, wall ring, farms outside, harbor on the water side) but no two buildings match. Lights are placed on purpose. Water, hills and cliffs are built *with*, not flattened.

## Cross-cutting rules (what every reference does)

1. **The ground is never bare.** Paths have planted edges; house footprints have a garden, hedge, planter or flower border; transitions between materials (stone to grass, dock to sand) are broken with moss, ferns, bushes.
2. **One palette per town, variety inside it.** Oak/spruce/dark-oak timber + stone brick/cobble/mossy + one roof family per street (dark slate, terracotta, or thatch). Houses differ in footprint, roof pitch, dormers and chimneys, not in material family.
3. **Irregular footprints.** L-shapes, jetties (upper floor overhangs), lean-tos, attached sheds, porches. Rectangles with a gable are the floor, not the target.
4. **Layered roofs.** Steep main gable, smaller cross-gables, dormers, chimneys with smoke, occasional turret or spire. Ridge lines are broken up.
5. **Terrain-adapted.** Terraces, retaining walls, stairs down slopes, buildings that step with the hill, stilts over water, cliff villages. Nothing sits on a flattened pad.
6. **Lighting is composition.** Lanterns on posts, wall sconces, lit windows, lamp posts at path junctions and bends, torches on wall faces and gate piers.
7. **Props signal life.** Barrels, crates, boats, hay, benches, signs, banners, market awnings, laundry, animals in pens.
8. **Landmarks give the eye somewhere to go.** Tower, keep, ziggurat, windmill, church spire, lighthouse, fountain plaza.

## By category

### Town plan (topdown, townedge)

- Seen layouts: (a) walled square/octagon with a keep and corner towers, a cross of main streets, quartered into plots; (b) organic hillside village following a dirt road and a river; (c) grid town with canals between rows; (d) harbor bay town with piers and a cherry-grove district; (e) cliff/terrace village with waterfalls and rope bridges; (f) forest clearing with a ring of farmland around a barn. Several references are annotated plot maps (coloured plot outlines on an octagonal wall).
- Plot-based plan with a centre feature (fountain, well, market square). Streets radiate or follow terrain. Farms and orchards outside the wall; docks where land meets water.
- Dense inside the wall, loose outside, with an obvious gradient (town, then gardens, then fields, then wild).
- Rolling terrain is kept. Wall lines follow ridges and water instead of ruling straight across.

### Houses (minecraft-houses, house)

- Two registers appear. **Cottage tier** (small survival houses): wood/stone mix, small porch, stairs to door, crop patch or pen beside it, chimney. **Medieval/fantasy tier**: jettied timber frame over stone base, dark slate roof, dormers, tall chimney, spire or turret, vines and moss, awnings over ground-floor windows, flower beds at the foot.
- Variants worth keeping as sub-styles: mossy/overgrown (green roof, vines), thatch/hay-roof cottage, stilt/water house, tree house, pink fantasy house, wizard house (dark spires), farmhouse with attached barn or workshop.
- Interiors are not visible in the references; assume at minimum bed(s), chest, light (matches the 11-08 cottage rule: 2-3 beds + chests).

### Streets and paths (minecraft-paths, street and paths)

- A path is a cross-section: a core strip (cobble, mossy cobble, dirt, brick, gravel) with **irregular edges**, planted borders (leaves, ferns, flowers, hedges), a lamp post every few blocks, occasional bench, planter or sign.
- Mix materials along the run (cobble to brick to dirt) and vary width by 1-2. Straight, uniform, single-material paths are the anti-pattern.
- Market streets: awnings and stalls, vines, flower boxes, a central drain or stream with lilies. Grand streets: brick centre, stone kerbs, lamp pairs, planters.
- Bridges: small timber bridges with planters and lanterns where a path crosses water.
- Hill stairs: brick/stone paths that follow the slope with planted steps.
- Lamp post patterns: lantern hung from a timber arm on a stone/log post; fence-and-post lanterns; paired lamps on a city street.

### Docks and shore (minecraft-docks, dock)

- Plank piers on log posts, with railings, lanterns, barrels, crates. Variations: L- and T-shaped piers; marinas with moored boats; fishing huts or boathouses on the pier; beach pier-houses on stilts; fisher's dock with nets/boats.
- The shore is built, not just the pier: sand, stone steps, bushes, a path up to town, boats tied alongside.
- Water-side buildings stand on stilts or stone foundations with stairs to the water.

### Farms (minecraft-farms, farms)

- Fenced or terraced plots, **mixed crops** in contrasting rows, lanterns at plot corners, a water channel or irrigation line, a farmhouse or barn, animal pens next to it. Variants: circular farm around a barn, terraced hillside farm, cave/underground farm with waterfalls, a red barn with silos, a hedge-maze field.
- Plots sit in the landscape with grass and flowers up to the fence, with dirt paths linking plots to the barn.

### Walls, gates and castles (minecraft-walls-castles + 6 castle schematics)

- Walls are **segmented and varied**: crenellated stone with timber posts, buttresses, arched alcoves with lanterns, small wall-top walkways, spruce-beam and planter detailing. Gatehouses have flanking towers, banners and a plank bridge/approach.
- Corner and gate towers carry the silhouette. The reference towns put a keep inside and a river or sea on one side.
- Hilltop castles (dark roofs, many spires, stone with timber) appear on ridges outside town as landmarks.
- Iron-bar and stone-post fences exist for low boundaries and gardens.

### Ziggurats and ancient monuments (minecraft-ziggurats)

- Stepped sandstone or white-stone terraces, one grand central stair (sometimes two), planted terraces (palms/vines), water at the base, a shrine or small temple on top. Variants: sandstone with blue/orange accent, Mayan-style stone pyramid overgrown with moss, an ancient-ruin pavilion with leaf crown.
- These are a separate register from the timber-and-stone town: a **landmark** to place in desert/arid or jungle zones or on a hill, not inside the medieval wall.

## Schematic inventory (`.litematic`)

Real block-level blueprints. Size is the `EnclosingSize` in each file's metadata (many are round multiples of 16, so it is the bounding box and not necessarily tight). Block count is the metadata `TotalBlocks`.

### Houses (`minecraft-houses/`)

| File | Bounding box (x, y, z) | Blocks |
|---|---|---|
| Mosshouse 2 | 16 x 16 x 16 | 926 |
| casa | 16 x 32 x 32 | 2,310 |
| Medieval Farm House | 32 x 32 x 32 | 2,629 |
| Greywatch Homestead | 32 x 32 x 32 | 2,684 |
| Survival Abode | 32 x 32 x 48 | 3,847 |
| 0_0_0_Medieval house | 48 x 32 x 48 | 5,337 |
| aeron medieval house | 32 x 48 x 32 | 6,289 |
| Medieval house | 48 x 48 x 48 | 6,697 |
| Medieval Outpost House | 64 x 64 x 32 | 9,545 |
| big medieval house | 48 x 64 x 48 | 12,262 |

### Castles, fortresses and one house (`minecraft-farms/`, filed there by the owner)

| File | Bounding box (x, y, z) | Blocks |
|---|---|---|
| tiny fortress | 48 x 32 x 48 | 4,019 |
| Fantasy house sheep | 48 x 48 x 48 | 6,993 |
| Violet Castle | 64 x 48 x 48 | 11,425 |
| Mini Castle Medieval | 48 x 48 x 64 | 13,903 |
| fantasy castle | 64 x 64 x 80 | 21,805 |
| Medieval Castle | 64 x 64 x 80 | 24,682 |

Note: `Fantasy house sheep` is the odd one (a house, in the castle/farm folder); it sits with the farm refs, which suggests a farmhouse-with-pasture use.

Possible uses, none decided: seed the pattern book with the smaller houses (<= 3k blocks) first; use the castles as hilltop landmarks; treat the large houses as landmark-tier. Importing any of them is a code and design decision, not a doc decision.

## Anti-patterns (what the references avoid)

- Bare, flat, single-material roads; uniform wall segments; identical houses in rows.
- Flat building pads with visible cut-and-fill scars; pillars, holes, floating dirt beams (matches the 11-07 "pretty land" circles).
- Unplanted edges: stone meeting grass with no moss, bush or flower.
- Unlit paths, docks and walls.
- Dock or shore with nothing built on the shore side.

## Open questions for the owner

1. Is a ziggurat/ancient-monument landmark wanted in the current worlds, and if so in which biome (the freshworld sites are cherry/forest/river, not desert)?
2. Are the 16 schematics meant as templates to place, or only as reference for the look? (Licence/attribution is unknown either way.)
3. Is the `Fantasy house sheep` file in the farms folder deliberate (farmhouse-with-pasture) or a stray?
4. Which of the new sub-styles should be added to the 20 + 16 pattern-book picks (mossy cottage, stilt house, wizard house, thatch cottage, circular barn farm, marina)?
