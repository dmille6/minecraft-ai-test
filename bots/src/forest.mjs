// FOREST-01: THE TOWN'S MANAGED FOREST, outside the walls (OWNER 2026-11-06 ~13:40Z: "remove the tree farm from inside city walls, turn
// that area into something useful or nice to look at. make sure the bots level the land, clean up holes and junk, then when they cut
// down a tree outside the walls replant in an clean organized way"; design docs/reports/forest-design-2026-11-06.md, Claude + Codex).
// PURE: the switch, the geometry, the siting, the record, the strip census, the rotation, the harvest plan, the due test, the
// replant routing for felled outside trees, the old farm's retirement plan. Nothing here touches a bot or a file; the visit is
// skills.mjs buildForest (worked by the town's groundskeeper: groundskeeper.mjs keeperOrderPure).
//
// WHY THE IN-WALL FARM FAILED (measured 11-06, showcase): (1) its harvest never felled one grown tree -- 0 of 245 grown-harvest rows
// succeeded, 215 `no_safe_target`: the farm's own walk footprint (treefarm.mjs farmFootprint: every plot column + 10) priced 100 in
// exclusionAreasBreak, so mineflayer-pathfinder's safeToBreak refused every log of its own trees and collectManually threw
// `unsafe_now`; (2) a complete farm is only upkeep, after every open project and sink -- no visit since 11-02; (3) its record box
// was a zone from y -64 to 320, so 389 coal runs (of 5,556 coal_site rows since 10-31) were refused 20 blocks under it.
//
// THE ANSWERS. (1) every planted cell owns a FELLING STAND fixed in the record: the aisle cell beside it, at the forest's floor. The
// plot is SUNK one block (the sapling stands IN the floor, its soil one below), so a trunk of up to 8 logs -- every sapling-grown
// oak (4-6), birch (5-7) and spruce (5-8) -- has its logs at dy -1..+6 from the stand's feet. PAPER (sandbox4, 11-06,
// sandbox/forest/forest-proof.cjs): from that stand a bot never moving felled every log of every sunk spruce, 8-log trees included;
// on a FLAT plot the 8th log (dy +7) was refused every time. The harvest digs with the build effects' own dig (e.dig: no pathfinder
// price), top down, the stump last: an interrupted felling leaves a shorter tree, never a floating log. (2) the forest is the
// GROUNDSKEEPER's work, ahead of its tidy whenever due (groundskeeper.mjs keeperOrderPure), and it never completes into silence:
// `due` is read from the world every visit (a ripe strip, an open plot with a sapling to hand, leaves in an aisle, drops to pick up).
// (3) the record names its own ZONES, a band from the soil - 4 to the canopy + 4: siting keeps off it, a coal run 20 below does not.
//
// THE GEOMETRY (local, rows along x): trunks 3 apart along a row; rows 3 apart in z; a STRIP is two rows sharing a 2-wide aisle
// (row z0, aisle z0+1..z0+2, row z0+3), and strips are 6 apart with a 2-wide walk path between them (z0+4..z0+5). Every trunk is
// at least 3 from every other (Chebyshev), beyond spruce's growth room (vanilla TwoLayersFeatureSize(2, 0, 2): radius 2 from layer
// 2) and oak/birch's (radius 1 from layer 1); PAPER: 24 of 24 spruce at spacing 3 grew. A row's even-indexed tree stands on the aisle
// side +z, the odd row's on -z: each plot's stand is the aisle cell straight beside its trunk. The box keeps a 1-wide margin path.
// NO 2x2 SPRUCE (the owner's "where possible"): four adjacent spruce saplings grow a MEGA spruce (13-30+ logs, PAPER: see the
// design) that no stand reaches; spruce is planted single. No fancy oak handling: an oak that grows branches (vanilla: 10%) or any
// tree taller than the stand reaches is KEPT standing as a feature tree and its plot leaves the rotation (`waived`), never half felled.
//
// THE ROTATION: strip states are read from the world (plot census); the record keeps only each strip's `plantedAt` and the last
// harvest time. A strip is RIPE when FOREST.ripeShare of its live plots hold trees (or every live plot that is not open does); the
// forest harvests ONE strip at a time -- the one harvesting, else the ripe strip planted longest ago -- and starts a new one only
// FOREST.rotateMs after the last harvest began, so the strips stagger. A felled plot is replanted at once (runVisit plants every open
// plot with a sapling to hand). The leaves left decay by themselves (no log within 6); the aisles' feet and head leaves are dug.
//
// FOREST=off is the kill switch (never sited, never visited; a sited record stays a reservation). FLEET: on in every named pool
// (FOREST_POOLS narrows it).

import { pathColumn } from './paths.mjs'
import { plotState, FARM_SPECIES, PLANTABLE } from './treefarm.mjs'
import { digReachFrom } from './buildrun.mjs'   // forest-03: the stand leaves a bot may dig from where it stands

export const FOREST_PLOT = 'forest'
export const FOREST_BLUEPRINT = 'forest@1'
export const FOREST_BUILDERS = 1
/** THE SWITCH -> bool. FOREST=on|off; unset = on in the pools FOREST_POOLS names (FLEET default '*': every named pool -- the fleet
 *  build reaches only the canary's pools until its rollout; an unnamed pool, a test or scratch bot, stays off). Pure. */
export function forestOn (env = process.env, pool = '') {
  const v = String(env?.FOREST ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  const pools = String(env?.FOREST_POOLS ?? '*').split(',').map(s => s.trim()).filter(Boolean)
  return !!String(pool ?? '').trim() && (pools.includes('*') || pools.includes(String(pool)))
}

export const FOREST = Object.freeze({
  spacing: 3,          // trunk to trunk along a row, and row to row
  perRow: [6, 5, 4, 3],   // trees a row, the biggest that fits first (forest-02: down to 3 -- the showcase's free ground is broken by water)
  strips: [3, 2],      // strips, the most that fit first
  axes: ['x', 'z'],    // forest-02: rows along x, or along z (a site long north-south fits the other way)
  minPlots: 12,        // a site needs this many plots (2 strips x 2 rows x 3, or more)
  wallGap: 4,          // the box's nearest column at least this far outside every wall ring (Codex: 4-block buffer)
  chunkR: 5,           // (forest-01's rule, kept for a town with no wall record: chunks of home's chunk)
  // forest-02 THE TICKING RULE (LIVE showcase 11-06 20:38Z: 14,828 candidates refused `ticks` -- home's chunk +-5 sits inside a town that
  // is 9 chunks deep): Paper random-ticks a chunk within simulation-distance chunks of a player. The anchor is the WALLED AREA (the
  // bots' ground: measured 11-06, 24 h of showcase positions, every chunk within 4 of the walled chunks had a bot within 6 chunks in
  // 94-100% of minutes); a box's every chunk within simChunks - tickMargin of the walled area's chunks. simChunks: the server's
  // simulation-distance (showcase server.properties 6; spigot.yml `default`), FOREST_SIM_CHUNKS overrides
  simChunks: Number(process.env.FOREST_SIM_CHUNKS) > 0 ? Number(process.env.FOREST_SIM_CHUNKS) : 6,
  tickMargin: 2,
  scanR: 112,          // the siting scan's half-width round home
  rMax: 112,           // every column of the box within this of home (Chebyshev): the build's walk (forestWalkR) and the tidy's
                       // (forest-02: 72 -> 112: the showcase's only free ground is 75-110 west of home, past its yard and stepwell)
  reachTiers: [72, 92, 112],   // forest-02: the NEAREST tier that fits a good forest wins (just outside the walls where it can be)
  goodPlots: 16,       // ...a good forest: 2 strips x 2 rows x 4 or more; smaller ones only when no tier has one
  stripStep: 1,        // forest-02 TERRAIN: each strip its own level, the next strip's within this (the path between them a 1-block step)
  stripSpread: 2,      // ...and every strip's within this of the lowest (the read's leaf band, shopread FR2: level - 3 .. levelMax + 5)
  failMax: 3,          // a tree this bot failed this often (never on the clock) is KEPT: its plot waived, a farm tree a garden tree
  scanStep: 2,         // the scan's stride (the box is 14-20 wide: a 2-block shift costs nothing)
  fillMax: 3,          // the floor fills a column at most this many cells
  cutMax: 3,           // ...and cuts one at most this many (the hills stay: a steeper site is no site)
  earthMax: 320,       // fills + cuts in all
  reachUp: 6,          // the highest log a stand reaches, over its feet (PAPER 11-06: +6 always, +7 never, from the side)
  reachDown: 1,        // ...and the lowest, under its feet (the sunk plot's stump)
  siteTreesMax: 24,    // trunks felled at siting, at most
  siteLogsMax: 200,    // logs felled at siting, at most
  trunkMax: 12,        // logs followed up one trunk
  bandBelow: 4,        // the zone's floor: the soil - this
  bandAbove: 14,       // the zone's top: the floor + this (a spruce's 8 logs and its crown)
  ripeShare: 0.75,     // a strip is ripe when this share of its live plots are trees
  rotateMs: 2 * 60 * 60_000,   // a new strip's harvest starts at least this long after the last one began
  harvestMax: 4,       // trees felled a visit
  leafMax: 24,         // aisle leaves dug a visit
  sweepMax: 8,         // dropped saplings walked to a visit
  bmMax: 4,            // bone meal uses a visit (the newest strip's saplings)
  bmKeep: 8,           // bone meal the town keeps for the decorator's nursery (the forest uses only what is above it)
  saplingKeep: 4,      // saplings the bag keeps back from other uses while the forest has open plots
  idleMs: 20 * 60_000, // a forest visit that did nothing: not due for this bot again for this long
})

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const LOG = /_log$/
const LEAVES = /_leaves$/
const SAPLING = /_sapling$/
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'
const k2 = (x, z) => `${x},${z}`
const k3 = (x, y, z) => `${x},${y},${z}`
/** Ground a levelling cut may dig (natural ground and the bots' own scaffold): never an ore, a path, farmland, a log. */
export const FOREST_CUTTABLE = /^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mycelium|moss_block|mud|stone|andesite|diorite|granite|tuff|gravel|sand|red_sand|clay|cobblestone|mossy_cobblestone|cobbled_deepslate|snow_block|snow)$/
/** What a visit may dig out of an OPEN record cell before placing (buildrun.mjs foreign class): ground, plants, a foreign sapling,
 *  leaves, snow. Never a log (a grown tree is the harvest's). */
export const FOREST_FOREIGN = /^(cobblestone|mossy_cobblestone|dirt|coarse_dirt|grass_block|podzol|rooted_dirt|mycelium|moss_block|stone|andesite|diorite|granite|tuff|gravel|sand|red_sand|clay|mud|snow_block|snow|powder_snow|dirt_path|farmland|cobbled_deepslate|[a-z_]+_sapling|mangrove_propagule|[a-z_]+_leaves|brown_mushroom|red_mushroom|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|sweet_berry_bush|bush|firefly_bush|leaf_litter|wildflowers|pink_petals|moss_carpet|short_grass|tall_grass|fern|large_fern|dead_bush|short_dry_grass|tall_dry_grass)$/
/** The palette (buildrun.mjs cellDone / blockFor): a plot takes any straight-trunk sapling, the forest's own species first; the soil
 *  is natural ground (placed as dirt); a floor fill any full solid (dirt first). Pure. */
export function forestPalette (species = 'spruce_sapling') {
  const sp = FARM_SPECIES.includes(species) ? species : FARM_SPECIES[0]
  return Object.freeze({
    soil: Object.freeze(['dirt', 'grass_block', 'coarse_dirt', 'podzol', 'rooted_dirt', 'moss_block', 'mud']),
    floor: Object.freeze(['dirt', 'cobblestone', '*solid']),
    plot: Object.freeze([sp, ...FARM_SPECIES.filter(s => s !== sp)]),
  })
}
/** A grown tree in a plot cell is DONE for the build (the harvest fells it; runVisit never takes a forest log). Pure. */
export const forestAlsoDone = (cell, read) => cell?.role === 'plot' && LOG.test(nm(read?.(...cell.at)))

// ---- the geometry ---------------------------------------------------------------------------------------------------------------

/**
 * THE LAYOUT from the first trunk (x0, z0) -> { box: [x0, z0, x1, z1], plots: [{ x, z, s, j, i, stand: [x, z] }], aisles: Set,
 * paths: Set, stripOf: (x, z) -> s }. Pure. In LOCAL axes (u along a row, v across): `perRow` trunks 3 apart along u, `strips` strips of
 * two rows (v = 6s, 6s + 3); the even row's stand at +1 in v, the odd row's at -1 (the strip's shared 2-wide aisle); a 2-wide path
 * between strips; a 1-wide margin round all. forest-02: `axis` 'x' maps u to x (rows along x, as forest-01), 'z' maps u to z. Each
 * column of the box belongs to one strip (`stripOf`: v from 6s - 1 to 6s + 4, the path after it and the margin included), the strip
 * whose level the column takes (forestFitAt's terrain-following floor).
 */
export function forestLayout (x0, z0, { perRow = FOREST.perRow[0], strips = FOREST.strips[0], sp = FOREST.spacing, axis = 'x' } = {}) {
  const at = axis === 'z' ? (u, v) => [x0 + v, z0 + u] : (u, v) => [x0 + u, z0 + v]
  const plots = [], aisles = new Set(), paths = new Set()
  for (let s = 0; s < strips; s++) {
    for (let j = 0; j < 2; j++) {
      const v = 2 * sp * s + sp * j
      for (let i = 0; i < perRow; i++) {
        const [x, z] = at(sp * i, v)
        const [sx, sz] = at(sp * i, v + (j === 0 ? 1 : -1))
        plots.push({ x, z, s, j, i, stand: [sx, sz] })
      }
    }
  }
  const u1 = sp * (perRow - 1), v1 = 2 * sp * (strips - 1) + sp
  const [ax, az] = at(-1, -1), [bx, bz] = at(u1 + 1, v1 + 1)
  const box = [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)]
  const trunk = new Set(plots.map(p => k2(p.x, p.z)))
  for (let s = 0; s < strips; s++) for (let u = -1; u <= u1 + 1; u++) for (const dv of [1, 2]) aisles.add(k2(...at(u, 2 * sp * s + dv)))
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) if (!trunk.has(k2(x, z)) && !aisles.has(k2(x, z))) paths.add(k2(x, z))
  const vOf = (x, z) => (axis === 'z' ? x - x0 : z - z0)
  const stripOf = (x, z) => Math.max(0, Math.min(strips - 1, Math.floor((vOf(x, z) + 1) / (2 * sp))))
  return { box, plots, aisles, paths, stripOf, axis }
}
/** The layout's box alone (forestLayout's, without building its plots) -> [x0, z0, x1, z1]. Pure. The scan's cheap first test. */
export function layoutBox (x0, z0, { perRow = FOREST.perRow[0], strips = FOREST.strips[0], sp = FOREST.spacing, axis = 'x' } = {}) {
  const u1 = sp * (perRow - 1), v1 = 2 * sp * (strips - 1) + sp
  return axis === 'z' ? [x0 - 1, z0 - 1, x0 + v1 + 1, z0 + u1 + 1] : [x0 - 1, z0 - 1, x0 + u1 + 1, z0 + v1 + 1]
}
/** Every pair of trunks at least `min` apart (Chebyshev)? The growth-room invariant. Pure. */
export function trunksApart (plots, min = FOREST.spacing) {
  for (let a = 0; a < plots.length; a++) for (let b = a + 1; b < plots.length; b++) {
    if (Math.max(Math.abs(plots[a].x - plots[b].x), Math.abs(plots[a].z - plots[b].z)) < min) return false
  }
  return true
}
/** Can a bot whose feet are at `feet` fell the log at `log` WITHOUT MOVING (the measured rule: the log's column orthogonally beside
 *  the stand's, dy from -reachDown to +reachUp)? Pure. */
export function standReaches (feet, log, F = FOREST) {
  if (!Array.isArray(feet) || !Array.isArray(log)) return false
  const dx = Math.abs(log[0] - feet[0]), dz = Math.abs(log[2] - feet[2]), dy = log[1] - feet[1]
  return dx + dz === 1 && dy >= -F.reachDown && dy <= F.reachUp
}
/** Chunk of a block coordinate. Pure. */
export const chunkOf = v => Math.floor(v / 16)
/** Is every column of the box within `r` chunks (Chebyshev) of home's chunk? The ticking rule: random ticks reach a chunk only
 *  within the simulation distance of a player, and the town is where the bots stand. Pure. */
export function boxTicks (box, home, r = FOREST.chunkR, rings = []) {
  // forest-02: anchored on the WALLED AREA's chunks when the town has walls (the rings' union), within simChunks - tickMargin
  const rs = (rings ?? []).filter(g => Array.isArray(g) && g.length === 4)
  if (rs.length) {
    // every chunk of the box within m (Chebyshev) of SOME ring's chunk rectangle -- the rings' union, never their bounding box (Codex
    // forest-02 r1: an L-shaped town's bounding box admitted a chunk 6 from every wall)
    const m = FOREST.simChunks - FOREST.tickMargin
    const rc = rs.map(g => [chunkOf(g[0]), chunkOf(g[1]), chunkOf(g[2]), chunkOf(g[3])])
    for (let cx = chunkOf(box[0]); cx <= chunkOf(box[2]); cx++) for (let cz = chunkOf(box[1]); cz <= chunkOf(box[3]); cz++) {
      if (!rc.some(a => Math.max(a[0] - cx, cx - a[2], 0) <= m && Math.max(a[1] - cz, cz - a[3], 0) <= m)) return false
    }
    return true
  }
  const hx = chunkOf(Math.floor(home.x)), hz = chunkOf(Math.floor(home.z))
  return [box[0], box[2]].every(x => Math.abs(chunkOf(x) - hx) <= r) && [box[1], box[3]].every(z => Math.abs(chunkOf(z) - hz) <= r)
}
/** The box's farthest column from home (Chebyshev). Pure. */
export const boxReach = (box, home) => Math.max(Math.abs(box[0] - home.x), Math.abs(box[2] - home.x), Math.abs(box[1] - home.z), Math.abs(box[3] - home.z))
/** THE BUILD'S WALK RADIUS for a forest record (buildrun.mjs runVisit `walkR`: its stand search stops there; WALK_R 48 would leave a
 *  forest past it unbuildable -- Claude + Codex r1): the box's reach + 6 (the stands and the walk round the margin). Pure. */
export const forestWalkR = (rec, home) => (Array.isArray(rec?.box) && home ? Math.max(48, boxReach(rec.box, home) + 6) : 48)
/** THE WALL RINGS a town has -> [[x0, z0, x1, z1]] (the wall and every extension: wall.mjs records' `ring`). Pure. */
export function wallRings (records = []) {
  return (records ?? []).filter(r => /^wall(ext)?@1$/.test(String(r?.blueprint ?? '')) && Array.isArray(r.ring) && r.ring.length === 4 && r.ring.every(Number.isFinite)).map(r => r.ring)
}
/** Is the box clear of every ring by `gap` columns (the box outside the walls, with a buffer)? Pure. */
export function outsideRings (box, rings = [], gap = FOREST.wallGap) {
  return (rings ?? []).every(g => box[2] < g[0] - gap || box[0] > g[2] + gap || box[3] < g[1] - gap || box[1] > g[3] + gap)
}

// ---- the siting ----------------------------------------------------------------------------------------------------------------

/**
 * A TREE STANDING ON A COLUMN -> { base, logs: [[x, y, z]] lowest first, straight } | null (unread) | { logs: [] } (no tree). The
 * logs above `ground` connected to the column's lowest log (26 neighbours), at most `max`. `straight`: every log in the column. Pure.
 */
export function standingTree (read, x, z, ground, { max = FOREST.trunkMax * 3, top = ground + 30 } = {}) {
  let start = null
  for (let y = ground + 1; y <= top; y++) {
    const b = read(x, y, z)
    if (!b) return null
    if (LOG.test(nm(b))) { start = [x, y, z]; break }
    if (!AIRN(nm(b)) && !LEAVES.test(nm(b)) && b.boundingBox === 'block') return { logs: [] }
  }
  if (!start) return { logs: [] }
  const got = new Map([[start.join(','), start]]), q = [start]
  for (let h = 0; h < q.length && got.size <= max; h++) {
    const [px, py, pz] = q[h]
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const p = [px + dx, py + dy, pz + dz], key = p.join(',')
      if (got.has(key) || p[1] <= ground) continue
      const b = read(...p)
      if (b && LOG.test(nm(b))) { got.set(key, p); q.push(p) }
    }
  }
  if (got.size > max) return { base: start, logs: [...got.values()], straight: false, big: true }
  const logs = [...got.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2])
  return { base: start, logs, straight: logs.every(p => p[0] === x && p[2] === z) }
}
/** A SITE TREE's felling stand -> [x, y, z] feet | null: an orthogonal neighbour column whose ground is within 1 of the trunk's,
 *  feet and head open (air, a plant, or leaves -- dug first), from which every log is within standReaches. Pure. */
export function siteTreeStand (read, tree, col, free = () => true) {
  const [bx, by, bz] = tree.base
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    // forest-02 release fold (Codex r2 BLOCKER): a stand never on a reserved column (a marker's margin outside the checked box)
    if (!free(bx + dx, bz + dz)) continue
    const c = col(bx + dx, bz + dz)
    if (!c || c.why || c.y == null || Math.abs(c.y + 1 - by) > 1) continue
    const feet = [bx + dx, c.y + 1, bz + dz]
    let open = true
    for (const y of [feet[1], feet[1] + 1]) { const b = read(feet[0], y, feet[2]); if (!b || (!AIRN(nm(b)) && !LEAVES.test(nm(b)) && b.boundingBox === 'block')) { open = false; break } }
    if (open && tree.logs.every(l => standReaches(feet, l))) return feet
  }
  return null
}
/**
 * ONE CANDIDATE: the layout with its first trunk at (x0, z0) -> { ok, why, ...fit }. Pure.
 *   col(x, z)      pathColumn's answer (cached by the caller); blocked(x, z) -> reason | null (every reservation, zone, corridor)
 *   rings, home    the walls (the box outside them by wallGap; the ticking rule anchored on them: boxTicks) and home (the reach)
 *   zone(x, z)     the land plan's sector kind | null: the box must lie in `treefarm` or `wild`; `treefarm` is preferred
 *   axis           'x' (rows along x) | 'z' (forest-02)
 * THE FLOOR FOLLOWS THE TERRAIN (forest-02): each STRIP has its own level W_s, the median ground of its columns (forestLayout
 * stripOf: its rows, its aisle, the path after it), the next strip's within stripStep and every strip's within stripSpread of the
 * lowest -- the path between two strips is a 1-block step, a hill is a flight of strips, never one flattened box. A column fills
 * at most fillMax and cuts at most cutMax to its strip's level. THE PLOT is sunk: its soil at W_s - 1, the sapling at W_s. THE TREES
 * in the box: every one straight and fellable from a stand (siteTreeStand), else the site is refused.
 */
export function forestFitAt (read, { x0, z0, perRow, strips, home, col, blocked, rings = [], zone = null, axis = 'x', F = FOREST } = {}) {
  const box = layoutBox(x0, z0, { perRow, strips, axis })
  if (!outsideRings(box, rings)) return { ok: false, why: 'walls' }
  if (!boxTicks(box, home, F.chunkR, rings)) return { ok: false, why: 'ticks' }
  if (boxReach(box, home) > F.rMax) return { ok: false, why: 'far' }
  // the strip of a column (forestLayout stripOf, by arithmetic: the layout itself is built only for a box whose levels pass)
  const sOf = (x, z) => Math.max(0, Math.min(strips - 1, Math.floor(((axis === 'z' ? x - x0 : z - z0) + 1) / (2 * F.spacing))))
  let zoneCost = 0
  const gs = Array.from({ length: strips }, () => [])
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    const r = blocked(x, z)
    if (r) return { ok: false, why: `box:${r}` }
    if (zone) { const zk = zone(x, z); if (zk !== 'treefarm' && zk !== 'wild') return { ok: false, why: `zone:${zk}` }; if (zk !== 'treefarm') zoneCost += 0.05 }
    const c = col(x, z)
    if (c.why === 'unknown') return { ok: false, why: 'unknown' }
    if (c.why) return { ok: false, why: `box:${c.why}` }
    gs[sOf(x, z)].push(c.y)
  }
  const Ws = gs.map(g => { const q = [...g].sort((a, b) => a - b); return q[Math.floor(q.length / 2)] })
  for (let i = 1; i < Ws.length; i++) if (Math.abs(Ws[i] - Ws[i - 1]) > F.stripStep) return { ok: false, why: 'level' }
  if (Math.max(...Ws) - Math.min(...Ws) > F.stripSpread) return { ok: false, why: 'level' }
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) { const c = col(x, z), W = Ws[sOf(x, z)]; if (W - c.y > F.fillMax || c.y - W > F.cutMax) return { ok: false, why: 'level' } }
  const L = forestLayout(x0, z0, { perRow, strips, axis })
  const floor = [], cuts = []
  const plotCols = new Set(L.plots.map(p => k2(p.x, p.z)))
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    const c = col(x, z)
    const W = Ws[L.stripOf(x, z)]
    if (W - c.y > F.fillMax || c.y - W > F.cutMax) return { ok: false, why: 'level' }
    for (let y = c.y + 1; y <= W; y++) if (!(plotCols.has(k2(x, z)) && y === W)) floor.push([x, y, z])
    for (let y = W + 1; y <= c.y; y++) {
      const b = read(x, y, z)
      if (!b) return { ok: false, why: 'unknown' }
      const n = nm(b)
      if (AIRN(n) || b.boundingBox === 'empty' || LOG.test(n)) continue
      if (LEAVES.test(n)) continue
      if (!FOREST_CUTTABLE.test(n)) return { ok: false, why: 'level' }
      cuts.push({ at: [x, y, z], kind: 'cut', name: n })
    }
  }
  if (floor.length + cuts.length > F.earthMax) return { ok: false, why: 'earth' }
  // THE SOIL under every sunk plot (W_s - 1): natural plantable ground, or a fill's dirt -- never stone under a plot (the soil cell is
  // buried under the plot cell's ground: a build could not reach it to replace it)
  for (const p of L.plots) {
    const c = col(p.x, p.z), W = Ws[p.s]
    if (c.y < W - 1) continue
    const b = read(p.x, W - 1, p.z)
    if (!b) return { ok: false, why: 'unknown' }
    if (!PLANTABLE.test(nm(b))) return { ok: false, why: 'soil' }
  }
  // THE TREES standing in the box (felled before the floor under them is worked): straight, fellable from a stand, few enough
  const trees = [], seen = new Set()
  let logs = 0
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    const c = col(x, z)
    if (!c.above.some(a => a.kind === 'tree')) continue
    const t = standingTree(read, x, z, c.y)
    if (t == null) return { ok: false, why: 'unknown' }
    if (!t.logs.length || seen.has(t.base.join(','))) continue
    for (const p of t.logs) seen.add(p.join(','))
    if (t.big || !t.straight) return { ok: false, why: 'tree_big' }
    if (t.logs.some(p => p[0] < box[0] || p[0] > box[2] || p[2] < box[1] || p[2] > box[3])) return { ok: false, why: 'tree_edge' }
    const stand = siteTreeStand(read, t, col, (x, z) => !(typeof blocked === 'function' && blocked(x, z)))
    if (!stand) return { ok: false, why: 'tree_tall' }
    trees.push({ base: t.base, logs: t.logs, stand, name: nm(read(...t.base)) })
    logs += t.logs.length
  }
  if (trees.length > F.siteTreesMax || logs > F.siteLogsMax) return { ok: false, why: 'too_many_trees' }
  const d = Math.hypot((box[0] + box[2]) / 2 - home.x, (box[1] + box[3]) / 2 - home.z)
  // THE COST: earthwork, distance, a wild (not treefarm) sector, a terrace step; an existing stand of trees is PREFERRED (owner:
  // "preferring existing forest" -- the trees are the saplings' supply and the site is already a wood), up to the felling bound
  const steps = Ws.reduce((t, w, i) => t + (i ? Math.abs(w - Ws[i - 1]) : 0), 0)
  const cost = floor.length * 0.3 + cuts.length * 0.25 + d * 0.4 + zoneCost * 20 + steps * 4 - Math.min(trees.length, 12) * 3 + logs * 0.05
  return { ok: true, why: null, box, W: Math.min(...Ws), Ws, plots: L.plots, aisles: L.aisles, stripOf: L.stripOf, paths: L.paths, floor, cuts, trees, cost, perRow, strips, axis }
}
/** A summed-area table over the scan square of "a column no forest can take" (a reservation, water, built ground, unread, a
 *  refused sector) -> (box) -> count. Pure. forest-02: the scan grew to rMax 112 and four sizes x two axes; a box is refused at once
 *  when any column is bad, instead of walking its columns (the siting stays a ~2 s step of a visit). */
export function badCounter (x0, z0, x1, z1, bad) {
  const nx = x1 - x0 + 2, nz = z1 - z0 + 2
  const S = new Int32Array(nx * nz)
  for (let i = 1; i < nx; i++) for (let j = 1; j < nz; j++) S[i * nz + j] = (bad(x0 + i - 1, z0 + j - 1) ? 1 : 0) + S[(i - 1) * nz + j] + S[i * nz + j - 1] - S[(i - 1) * nz + j - 1]
  return b => {
    const a0 = Math.max(0, b[0] - x0), c0 = Math.max(0, b[1] - z0), a1 = Math.min(nx - 2, b[2] - x0), c1 = Math.min(nz - 2, b[3] - z0)
    if (a0 > b[0] - x0 || c0 > b[1] - z0 || a1 < b[2] - x0 || c1 < b[3] - z0) return Infinity   // past the scan square: refuse
    return S[(a1 + 1) * nz + c1 + 1] - S[a0 * nz + c1 + 1] - S[(a1 + 1) * nz + c0] + S[a0 * nz + c0]
  }
}
/**
 * THE SITING -> { ok, why, record, tried }. Pure over `read`. Every size (the most strips, the longest rows first), both axes; for each,
 * every first trunk on the scan grid round home whose box passes forestFitAt; the cheapest fit of a size wins, ties by scan order
 * (deterministic). A box with any bad column (badCounter) is refused without a fit.
 */
export function siteForest (read, { home, blocked = () => null, rings = [], zone = null, species = 'spruce_sapling', yHi = null, yLo = null, now = 0, F = FOREST } = {}) {
  if (!home || typeof read !== 'function') return { ok: false, why: 'no_home', record: null }
  if (!rings.length) return { ok: false, why: 'no_wall', record: null }
  const hi = yHi ?? Math.floor(home.y) + 24, lo = yLo ?? Math.floor(home.y) - 20
  const cache = new Map()
  const col = (x, z) => { const k = k2(x, z); let c = cache.get(k); if (!c) { c = pathColumn(read, x, z, { yHi: hi, yLo: lo }); cache.set(k, c) } return c }
  const bcache = new Map()
  const blk = (x, z) => { const k = k2(x, z); if (!bcache.has(k)) bcache.set(k, blocked(x, z) ?? null); return bcache.get(k) }
  const R = F.scanR, st = F.scanStep, hx = Math.floor(home.x), hz = Math.floor(home.z)
  const inRing = (x, z) => rings.some(g => x >= g[0] && x <= g[2] && z >= g[1] && z <= g[3])
  const badCount = badCounter(hx - R - 24, hz - R - 24, hx + R + 24, hz + R + 24, (x, z) => {
    if (inRing(x, z) || blk(x, z)) return true
    const c = col(x, z)
    if (c.why) return true
    if (zone) { const zk = zone(x, z); if (zk !== 'treefarm' && zk !== 'wild') return true }
    return false
  })
  const why = {}
  let tried = 0, small = null
  // THE TIERS (forest-02): nearest first; within a tier every size, the most strips and the longest rows first, both axes; the first
  // tier with a GOOD fit (goodPlots) wins; with none in any tier, the nearest smaller fit (a forest of 12 beats none)
  for (const tier of F.reachTiers ?? [F.rMax]) {
    const T = Math.min(tier, F.rMax)
    for (const strips of F.strips) for (const perRow of F.perRow) {
      if (strips * 2 * perRow < F.minPlots) continue
      let best = null
      for (const axis of F.axes) {
        for (let x0 = hx - T; x0 <= hx + T; x0 += st) {
          for (let z0 = hz - T; z0 <= hz + T; z0 += st) {
            const box = layoutBox(x0, z0, { perRow, strips, axis })
            if (boxReach(box, home) > T) { why.far = (why.far ?? 0) + 1; continue }
            if (!outsideRings(box, rings)) { why.walls = (why.walls ?? 0) + 1; continue }
            if (!boxTicks(box, home, F.chunkR, rings)) { why.ticks = (why.ticks ?? 0) + 1; continue }
            if (badCount(box) > 0) { why.box = (why.box ?? 0) + 1; continue }
            tried++
            const f = forestFitAt(read, { x0, z0, perRow, strips, home, col, blocked: blk, rings, zone, axis, F: { ...F, rMax: T } })
            if (!f.ok) { const w = String(f.why).split(':')[0]; why[w] = (why[w] ?? 0) + 1; continue }
            if (!best || f.cost < best.cost - 1e-9) best = f
          }
        }
      }
      if (best && best.plots.length >= (F.goodPlots ?? 0)) return { ok: true, why: null, tried, tier: T, record: forestRecord(best, { home, species, now }) }
      if (best && !small) small = { f: best, T }
    }
  }
  if (small) return { ok: true, why: null, tried, tier: small.T, small: true, record: forestRecord(small.f, { home, species, now }) }
  const top = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(' ')
  return { ok: false, why: `no fit (${tried} tried: ${top || '-'})`, tried, record: null }
}

/** THE RECORD from a fit. Pure. Segment F (the floor's fills) first; one segment a strip (S1..Sn: its plots' soil then sapling), each
 *  strip at its own level (forest-02: `strips[].level`; `level` the lowest, `levelMax` the highest; an aisle cell [x, z, level]). */
export function forestRecord (f, { home, species = 'spruce_sapling', now = 0 } = {}) {
  const cells = [], segments = []
  const fl = f.floor ?? []
  const Ws = f.Ws ?? [f.W]
  const WOf = s => Ws[s] ?? Ws[0]
  if (fl.length) { segments.push({ seg: 'F', deps: [] }); for (const a of fl) cells.push({ at: a, role: 'floor', seg: 'F' }) }
  const nS = Math.max(...f.plots.map(p => p.s)) + 1
  const strips = []
  for (let s = 0; s < nS; s++) {
    const seg = `S${s + 1}`
    segments.push({ seg, deps: fl.length ? ['F'] : [] })
    const mine = f.plots.filter(p => p.s === s)
    const W = WOf(s)
    for (const p of mine) {
      cells.push({ at: [p.x, W - 1, p.z], role: 'soil', seg })
      cells.push({ at: [p.x, W, p.z], role: 'plot', seg, stand: [p.stand[0], W + 1, p.stand[1]] })
    }
    const xs = mine.map(p => p.x), zs = mine.map(p => p.z)
    strips.push({ s, seg, level: W, box: [Math.min(...xs) - 1, Math.min(...zs) - 1, Math.max(...xs) + 1, Math.max(...zs) + 1], plantedAt: now - (nS - s) })
  }
  const box = f.box
  const lo = Math.min(...Ws), hi = Math.max(...Ws)
  const aisleCells = [...f.aisles].map(k => { const [x, z] = k.split(',').map(Number); return [x, z, f.stripOf ? WOf(f.stripOf(x, z)) : lo] })
  return {
    v: 1, blueprint: FOREST_BLUEPRINT, plot: FOREST_PLOT, home: { x: home.x, y: home.y, z: home.z }, species,
    anchor: [f.plots[0].x, f.plots[0].z], axis: f.axis ?? 'x', perRow: f.perRow, nStrips: nS, box, level: lo, levelMax: hi, cells, segments, strips,
    aisles: aisleCells,
    clear: f.cuts, trees: f.trees,
    // the zone: the box + 1, from the lowest soil - bandBelow to the highest floor + bandAbove (a coal run under it is no business of the forest's)
    zones: [{ box: [box[0] - 1, lo - 1 - FOREST.bandBelow, box[1] - 1, box[2] + 1, hi + FOREST.bandAbove, box[3] + 1], why: `project:${FOREST_PLOT}` }],
    rotation: { harvesting: null, lastAt: null },
    waived: {},
    counts: { plots: f.plots.length, strips: nS, trees: f.trees.length, logs: f.trees.reduce((t, x) => t + x.logs.length, 0), floor: fl.length, cut: f.cuts.length },
    bom: { [species]: f.plots.length },
    builders_max: FOREST_BUILDERS,
    sitedAt: now,
  }
}

// ---- the forest, read -----------------------------------------------------------------------------------------------------------

export const forestPlots = rec => (rec?.cells ?? []).filter(c => c.role === 'plot')
const plotKey = c => `plot:${c.at.join(',')}`
/** The strip of a plot cell (its segment) -> index | -1. Pure. */
export const stripOf = (rec, c) => (rec?.strips ?? []).findIndex(s => s.seg === c.seg)
/** A plot is LIVE unless waived (a kept feature tree). Pure. */
export const plotLive = (rec, c) => !rec?.waived?.[plotKey(c)]
/**
 * THE STRIPS' CENSUS -> [{ s, seg, n, tree, sapling, open, other, unknown, ripe }]. Pure. `ripe`: trees >= ripeShare of the live
 * plots, or trees > 0 and nothing else is growing (no sapling, no open plot that could take one).
 */
export function stripCensus (read, rec, F = FOREST) {
  const out = (rec?.strips ?? []).map(st => ({ s: st.s, seg: st.seg, n: 0, tree: 0, sapling: 0, open: 0, other: 0, unknown: 0, ripe: false, plantedAt: st.plantedAt ?? 0 }))
  for (const c of forestPlots(rec)) {
    const i = stripOf(rec, c)
    if (i < 0 || !plotLive(rec, c)) continue
    const o = out[i]
    o.n++
    const s = plotState(read, c)
    if (s === 'tree') o.tree++
    else if (s === 'sapling') o.sapling++
    else if (s === 'open' || s === 'soil_lost') o.open++
    else if (s === 'unknown') o.unknown++
    else o.other++
  }
  for (const o of out) o.ripe = o.unknown === 0 && o.tree > 0 && (o.tree >= Math.ceil(F.ripeShare * o.n) || (o.sapling === 0 && o.open === 0))
  return out
}
/**
 * THE STRIP TO HARVEST NOW -> index | null. Pure. The one the rotation names `harvesting` while it still has a tree; else, once
 * rotateMs has passed since the last harvest began, the ripe strip planted longest ago (ties by index).
 */
export function harvestStrip (census, rotation = {}, { now = 0, F = FOREST } = {}) {
  const h = rotation?.harvesting
  if (Number.isInteger(h) && census[h] && census[h].tree > 0) return h
  if (Number.isFinite(rotation?.lastAt) && now - rotation.lastAt < F.rotateMs) return null
  const ripe = census.filter(c => c.ripe).sort((a, b) => (a.plantedAt ?? 0) - (b.plantedAt ?? 0) || a.s - b.s)
  return ripe.length ? ripe[0].s : null
}
/**
 * ONE PLOT'S FELLING -> { stand, order, big } | null. Pure. The trunk standing in the plot cell, followed up its column (and any
 * log touching it: a branch); `order` its logs TOP DOWN (the stump last -- an interrupted felling leaves a shorter tree, never a
 * floating log). `big`: a log off the column, or one the stand does not reach (standReaches) -- such a tree is kept, never felled.
 */
export function plotFelling (read, rec, c, F = FOREST) {
  const [x, y, z] = c.at
  if (!LOG.test(nm(read(x, y, z)))) return null
  const stand = c.stand ?? null
  if (!stand) return { stand: null, order: [], big: true }
  const col = []
  for (let k = 0; k <= F.trunkMax; k++) { const b = read(x, y + k, z); if (!b) return null; if (!LOG.test(nm(b))) break; col.push([x, y + k, z]) }
  // a branch: any log beside the column's logs (fancy oak, a neighbour's limb) makes the tree big
  for (const p of col) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (const dy of [-1, 0, 1]) {
      if (p[1] + dy < y) continue
      const b = read(p[0] + dx, p[1] + dy, p[2] + dz)
      if (b && LOG.test(nm(b))) return { stand, order: [], big: true }
    }
  }
  const top = col.at(-1)
  const above = read(top[0], top[1] + 1, top[2])
  if (above && LOG.test(nm(above))) return { stand, order: [], big: true }   // past trunkMax
  if (!col.every(p => standReaches(stand, p, F))) return { stand, order: [], big: true }
  return { stand, order: [...col].reverse(), big: false }
}
/** The leaves to dig so a stand can be walked to and stood in: the stand's feet and head, then the aisle cells between it and the
 *  aisle's previous stand along x (feet and head). -> [[x, y, z]] in walking order. Pure. */
export function standLeaves (read, stand, { from = null } = {}) {
  const out = []
  const add = (x, y, z) => { const b = read(x, y, z); if (b && LEAVES.test(nm(b))) out.push([x, y, z]) }
  if (from && from[2] === stand[2]) {
    const step = Math.sign(stand[0] - from[0])
    for (let x = from[0] + step; step && x !== stand[0]; x += step) { add(x, stand[1], stand[2]); add(x, stand[1] + 1, stand[2]) }
  }
  add(stand[0], stand[1], stand[2]); add(stand[0], stand[1] + 1, stand[2])
  return out
}
/**
 * forest-03 THE STANDS A TREE CAN BE FELLED FROM -> [[x, y, z] feet], the recorded stand first, then every other orthogonal neighbour
 * of the trunk column at the same feet height whose ground is solid (LIVE showcase 11-06 22:58-23:00Z: every felling failed
 * `off_stand` -- 7 of 7 retirement trees and 1 of 1 site tree: the walk to the recorded stand stopped 1-3 blocks short, its head
 * cell a leaf the walk does not dig, and the felling then required the feet to equal that one cell). Pure.
 */
export function fellStands (read, t, reserved = () => false) {
  const st = t?.stand, base = t?.cell ?? t?.base
  if (!Array.isArray(st) || !Array.isArray(base)) return []
  // forest-04 (Codex fold BLOCKER 1): every stand, the recorded one too, off the reserved columns (siteTreeStand's `free` filter: a
  // marker's margin, a protected zone, another record's ground); (BLOCKER 5) its ground footing that stays (standGround)
  const out = reserved(st[0], st[2]) || !standGround(read(st[0], st[1] - 1, st[2])) ? [] : [st]
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c = [base[0] + dx, st[1], base[2] + dz]
    if (c[0] === st[0] && c[2] === st[2]) continue
    if (reserved(c[0], c[2])) continue
    const g = read(c[0], c[1] - 1, c[2]), f = read(...c), h = read(c[0], c[1] + 1, c[2])
    if (!g || !f || !h || !standGround(g)) continue
    if (![f, h].every(q => AIRN(nm(q)) || LEAVES.test(nm(q)) || q.boundingBox === 'empty')) continue
    out.push(c)
  }
  return out
}
/** Can feet at `feet` fell every log of `logs` without moving (forest-01's measured rule, from wherever the bot actually stands)? */
export const feetFells = (feet, logs, F = FOREST) => Array.isArray(feet) && (logs ?? []).length > 0 && logs.every(p => standReaches(feet, p, F))
const LAVA = n => n === 'lava' || n === 'flowing_lava'
/** forest-04: ground a felling stand may stand on -> bool. Pure. A full solid block that stays: never leaves (they decay once the tree
 *  is down: the bot drops), never a log (a felling may take it), never unread. */
export const standGround = g => !!g && g.boundingBox === 'block' && !LEAVES.test(nm(g)) && !LOG.test(nm(g)) && !LAVA(nm(g))
/** forest-04 (Claude review note): ground lower than a full block that a bot stands ON inside its floored cell (buildbot.mjs feet
 *  floors the body's y: on a dirt path at y 64 the body is at 64.94, its feet cell 64) -- the feet are the cell above. */
export const PARTIAL_GROUND = /^(dirt_path|farmland|mud|soul_sand|[a-z_]+_slab|chest|trapped_chest|ender_chest|enchanting_table|stonecutter|[a-z_]+_bed|composter|lectern|honey_block)$/
/** The feet a body stands at -> [x, y, z]: `feet` (floored), one up when its floored cell is PARTIAL_GROUND it stands on. Pure. */
export function bodyFeet (read, feet) {
  if (!Array.isArray(feet) || feet.length < 3 || !feet.every(Number.isFinite)) return feet
  const b = read(feet[0], feet[1], feet[2])
  return b && b.boundingBox === 'block' && PARTIAL_GROUND.test(nm(b)) ? [feet[0], feet[1] + 1, feet[2]] : feet
}
/** forest-04 (Codex fold BLOCKER 5): may a bot whose feet are at `feet` fell from there, the tree's stands at feet height `standY`?
 *  -> bool. Pure. Reach alone (feetFells) admitted a 2-deep pit beside the trunk (the town walk cannot dig or tower out of it) and a
 *  perch on leaves. The feet at the stands' floor or one above it, on standGround. */
export function standFooting (read, feet, standY) {
  if (!Array.isArray(feet) || feet.length < 3 || !feet.every(Number.isFinite) || !Number.isFinite(standY)) return false
  const dy = feet[1] - standY
  if (dy < 0 || dy > 1) return false
  return standGround(read(feet[0], feet[1] - 1, feet[2]))
}
/** forest-04 (Codex fold BLOCKER 3): is lava on a face of the cell (or a face unread)? -> bool. Pure. A leaf or log that holds back
 *  lava is never dug: the lava flows into the hole, at the bot's feet or head. */
export function lavaBeside (read, q) {
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const b = read(q[0] + dx, q[1] + dy, q[2] + dz)
    if (!b || LAVA(nm(b))) return true
  }
  return false
}
/** forest-04 (Codex fold BLOCKERS 2, 3): may a stand's leaf clearing dig the leaf at `q`, the bot's feet at `feet`? -> bool. Pure.
 *  Never a cell under the bot (below its feet in the 3x3 round it: the leaf it stands on, or the one its edge rests on -- the ring's
 *  dig dropped a bot perched above the stand), never one beside lava, never out of reach. */
export function clearLeafOk (read, feet, q) {
  if (!Array.isArray(feet) || feet.length < 3 || !feet.every(Number.isFinite)) return false
  if (q[1] < feet[1] && Math.abs(q[0] - feet[0]) <= 1 && Math.abs(q[2] - feet[2]) <= 1) return false
  if (lavaBeside(read, q)) return false
  return digReachFrom(feet, q)
}
/**
 * forest-04 (Codex fold BLOCKERS 1, 4): THE COLUMNS A FELLING NEVER STANDS ON OR CLEARS -> (x, z) -> bool. Pure.
 *   boxes    zone boxes [x0, y0, z0, x1, y1, z1] (the town's expedition markers' margins, the protected zones)
 *   records  every project record; `own` the plots whose ground the felling may work (the forest; the farm being retired)
 * Another record's box (its x/z box) and every column of its cells (a decorator's hedge leaves, a light post, a path): never cleared,
 * never a stand. A record's own `zones` (a path's columns + 1, a wall's margin) are siting gaps, not ground, and are not read here.
 */
export function fellReserved ({ boxes = [], records = [], own = [] } = {}) {
  const bx = (boxes ?? []).map(q => q?.box ?? q).filter(b => Array.isArray(b) && b.length === 6 && b.every(Number.isFinite))
  const ownSet = new Set(own ?? [])
  const rb = [], cols = new Set()
  for (const r of records ?? []) {
    if (!r || ownSet.has(r.plot)) continue
    if (Array.isArray(r.box) && r.box.length === 4 && r.box.every(Number.isFinite)) rb.push(r.box)
    for (const c of r.cells ?? []) if (Array.isArray(c?.at) && c.at.length === 3) cols.add(k2(c.at[0], c.at[2]))
  }
  return (x, z) => cols.has(k2(x, z)) || rb.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]) || bx.some(b => x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5])
}
/**
 * forest-03 FELL ONE TREE -> { n, why, from }. The effects `e` (buildbot.mjs botBuildEffects: walkTo, dig, feet), the world `read`.
 * For each stand of fellStands (nearest the bot first after the recorded one, at most `tries`): already on a cell from which every
 * remaining log is reachable (feetFells) -- fell; else dig that stand's feet and head leaves within reach (never where `guard`
 * refuses), walk to it, dig what the walk brought within reach, walk again, and judge the ACTUAL feet by feetFells -- never by
 * equality with one cell. Then the logs top down, the stump last, each re-read and re-judged from the actual feet. A tree no stand
 * reaches ends `off_stand` (the visit's keepDue counts it).
 */
export async function fellTree (e, read, t, { deadline = Infinity, guard = () => false, log = () => {}, check = () => {}, tries = 3, F = FOREST } = {}) {
  let n = 0
  const feetAt = () => bodyFeet(read, e.feet())   // forest-04: the cell the body stands in (a dirt path, mud: one up)
  const left = () => (t.order ?? []).filter(p => LOG.test(nm(read(...p))))
  // the leaves a walk to `st` may need gone (Paper 11-07: a walk that digs no leaf stopped 1-3 short 5 of 11 times): the stand's
  // feet and head, the ring round it at feet and head, and the cells on the straight line from the bot to it -- those within reach
  const clearCells = st => {
    const f = feetAt(), out = [[st[0], st[1], st[2]], [st[0], st[1] + 1, st[2]]]
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) for (const dy of [0, 1]) out.push([st[0] + dx, st[1] + dy, st[2] + dz])
    const steps = Math.max(Math.abs(st[0] - f[0]), Math.abs(st[2] - f[2]))
    for (let i = 1; i < steps; i++) { const x = Math.round(f[0] + (st[0] - f[0]) * i / steps), z = Math.round(f[2] + (st[2] - f[2]) * i / steps); for (const dy of [0, 1]) out.push([x, st[1] + dy, z]) }
    return out
  }
  const clearAt = async st => {
    for (const q of clearCells(st)) {
      if (Date.now() > deadline) return
      if (guard(q[0], q[2])) continue
      const b = read(...q)
      if (!b || !LEAVES.test(nm(b)) || !clearLeafOk(read, feetAt(), q)) continue
      if ((await e.dig(q, nm(b))) === 'confirmed') log({ op: 'clear', cell: q, block: nm(b), kind: 'stand' })
    }
  }
  const dist = st => { const f = feetAt(); return Math.abs(f[0] - st[0]) + Math.abs(f[2] - st[2]) + Math.abs(f[1] - st[1]) }
  // forest-04 (Codex fold BLOCKER 3): a log that holds back lava is never dug -- the tree is not started (a skip, then kept: keepDue)
  if (left().some(p => lavaBeside(read, p))) return { n, why: 'lava', from: feetAt() }
  // forest-04 (BLOCKERS 1, 5): the stands off the reserved columns (`guard`), on ground that stays; the actual feet judged by reach,
  // footing and the same columns -- never a pit beside the trunk, a leaf perch, or a marker's margin
  const all = fellStands(read, t, guard)
  const cands = [all[0], ...all.slice(1).sort((a, b) => dist(a) - dist(b))].filter(Boolean).slice(0, tries)
  const fells = f => feetFells(f, left(), F) && standFooting(read, f, t.stand?.[1]) && !guard(f[0], f[2])
  let ok = fells(feetAt())
  for (const st of cands) {
    if (ok || Date.now() > deadline) break
    await clearAt(st)
    await e.walkTo(st)
    check()
    ok = fells(feetAt())
    if (ok) break
    await clearAt(st)
    await e.walkTo(st)
    check()
    ok = fells(feetAt())
    if (ok) break
    await clearAt(st)   // a third try: each walk brings more of the way's leaves within reach
    await e.walkTo(st)
    check()
    ok = fells(feetAt())
  }
  if (!left().length) return { n, why: null, from: feetAt() }
  if (!ok) return { n, why: Date.now() > deadline ? 'deadline' : 'off_stand', from: feetAt() }
  const from = feetAt()
  for (const p of t.order) {
    check()
    if (Date.now() > deadline) return { n, why: 'deadline', from }
    const b = read(...p)
    if (!b || !LOG.test(nm(b))) continue
    if (!standReaches(feetAt(), p, F) || !standFooting(read, feetAt(), t.stand?.[1])) return { n, why: 'reach', from }
    const v = await e.dig(p, nm(b))
    if (v !== 'confirmed') return { n, why: v, from }
    n++
    log({ op: 'harvest', cell: p, block: nm(b) })
  }
  return { n, why: null, from }
}
/**
 * THE VISIT'S HARVEST LIST -> { strip, trees: [{ key, cell, stand, order }], big: [cell] }. Pure. The site trees first (the forest's
 * rows are not laid until they are down), then the harvest strip's grown plots in walking order (row, then x); `skip(key)` leaves out a
 * tree this bot failed lately; at most `max` trees. A big tree is returned in `big` (the caller waives its plot: a feature tree).
 */
export function forestHarvestList (read, rec, { now = 0, skip = () => false, max = FOREST.harvestMax, F = FOREST } = {}) {
  const trees = [], big = []
  for (const t of siteTreesStanding(read, rec)) {
    const key = `site:${t.base.join(',')}`
    if (skip(key)) continue
    trees.push({ key, cell: t.base, stand: t.stand, order: [...t.logs].sort((a, b) => b[1] - a[1]), kind: 'site' })
  }
  const census = stripCensus(read, rec, F)
  const s = siteTreesStanding(read, rec).length ? null : harvestStrip(census, rec?.rotation, { now, F })
  if (s != null) {
    const seg = rec.strips[s].seg
    const mine = forestPlots(rec).filter(c => c.seg === seg && plotLive(rec, c)).sort((a, b) => a.at[2] - b.at[2] || a.at[0] - b.at[0])
    for (const c of mine) {
      if (plotState(read, c) !== 'tree') continue
      const key = plotKey(c)
      if (skip(key)) continue
      const f = plotFelling(read, rec, c, F)
      if (!f) continue
      if (f.big) { big.push(c); continue }
      trees.push({ key, cell: c.at, stand: f.stand, order: f.order, kind: 'grown' })
    }
  }
  return { strip: s, trees: trees.slice(0, Math.max(0, max)), big }
}
/** The site trees still standing (only logs still there; unread counts as standing). Pure. */
export function siteTreesStanding (read, rec) {
  const out = []
  for (const t of rec?.trees ?? []) {
    if (rec?.waived?.[`site:${t.base.join(',')}`]) continue
    const logs = (t.logs ?? []).filter(p => { const b = read(...p); return !b || LOG.test(nm(b)) })
    if (logs.length) out.push({ ...t, logs })
  }
  return out
}
/** EVERY recorded site tree whose logs still stand, waived (kept) ones too (Claude r2 BLOCKER: a kept site tree still holds its
 *  columns -- the levelling cut under its base would float it). Pure. */
export function siteTreesHolding (read, rec) {
  const out = []
  for (const t of rec?.trees ?? []) {
    const logs = (t.logs ?? []).filter(p => { const b = read(...p); return !b || LOG.test(nm(b)) })
    if (logs.length) out.push({ ...t, logs })
  }
  return out
}
/** The columns a standing site tree holds (its logs' columns + 1): the build's cells there wait for its felling. Pure. */
export const siteHeldCols = standing => new Set((standing ?? []).flatMap(t => t.logs.flatMap(p => [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dz => `${p[0] + dx},${p[2] + dz}`)))))
/** The aisle leaves at feet and head height (the walk's way through the rows) -> [[x, y, z]]. Pure. */
export function aisleLeaves (read, rec) {
  const out = []
  const W0 = rec?.level
  if (!Number.isFinite(W0)) return out
  // forest-02: an aisle cell carries its strip's level ([x, z, level]); a forest-01 record's cells are [x, z] at the record's level
  for (const [x, z, w] of rec?.aisles ?? []) { const W = Number.isFinite(w) ? w : W0; for (const y of [W + 1, W + 2]) { const b = read(x, y, z); if (b && LEAVES.test(nm(b))) out.push([x, y, z]) } }
  return out
}
/** The floor's cuts still standing (a listed cut whose cell still holds its block; unread is not standing). Pure. */
export function forestCutsLeft (read, rec) {
  return (rec?.clear ?? []).filter(c => c.kind === 'cut' && nm(read(...c.at)) === c.name)
}
/**
 * IS THE FOREST DUE A VISIT? -> a reason | null. Pure. In order: a tree to fell (site trees, the harvest strip's), a cut left, an open
 * plot while a sapling is to hand (`saplings`: the bag's and the town's), leaves in the aisles, a sapling dropped in the box to pick
 * up (`drops`). An open plot with no sapling anywhere is no visit (the visit could only wait); a big tree is (its plot is waived).
 */
export function forestDue (read, rec, { now = 0, saplings = 0, drops = 0, retire = false, skip = () => false, F = FOREST } = {}) {
  // the in-wall farm not yet retired (its trees, saplings or torches still stand, or only its record waits): the forest's keeper's,
  // due until the farm is retired and its garden sited (Codex r1: else a quiet forest left the retirement for good)
  if (retire) return 'retire'
  const h = forestHarvestList(read, rec, { now, skip, max: 1, F })
  if (h.trees.length) return 'harvest'
  if (h.big.length) return 'waive'
  if (forestCutsLeft(read, rec).length) return 'level'
  for (const c of rec?.cells ?? []) {
    if (c.role === 'floor') { const b = read(...c.at); if (b && (AIRN(nm(b)) || b.boundingBox !== 'block')) return 'level' }
  }
  if (saplings > 0) for (const c of forestPlots(rec)) { if (!plotLive(rec, c)) continue; const s = plotState(read, c); if (s === 'open' || s === 'soil_lost' || (s === 'blocked' && FOREST_FOREIGN.test(nm(read(...c.at))))) return 'replant' }
  // (the aisles' leaves are no due of their own: a living spruce's crown fills the aisle's head height for good -- Claude r1 -- the
  // visit digs them where it walks, the stands before each felling)
  if (drops > 0) return 'sweep'
  return null
}
/** The open plots that want a sapling -> [cell], harvest strip last (replanted after it is felled). Pure. */
export function openPlots (read, rec) {
  return forestPlots(rec).filter(c => plotLive(rec, c) && ['open', 'soil_lost'].includes(plotState(read, c)))
}
/**
 * THE RECORD A BUILD WORKS NOW -> the record with only the plots this visit can plant (Pure). runVisit digs an open record cell's
 * foreign block before it places (a plot's floor grass), whether or not the bag holds what goes in -- so a plot is in the build only
 * while a sapling is to hand for it: every plot already planted or grown (done), then the first `saplings` others in strip and row
 * order; the floor's fills always. No sapling: no plot is dug (no hole without its sapling).
 */
export function forestBuildRecord (rec, read, { saplings = 0 } = {}) {
  const want = new Set()
  let n = Math.max(0, Number(saplings) || 0)
  for (const c of forestPlots(rec).sort((a, b) => stripOf(rec, a) - stripOf(rec, b) || a.at[2] - b.at[2] || a.at[0] - b.at[0])) {
    if (!plotLive(rec, c)) continue
    const s = plotState(read, c)
    if (s === 'tree' || s === 'sapling') { want.add(k2(c.at[0], c.at[2])); continue }
    if (n > 0 && s !== 'unknown') { want.add(k2(c.at[0], c.at[2])); n-- }
  }
  const cells = (rec?.cells ?? []).filter(c => (c.role !== 'plot' && c.role !== 'soil') || want.has(k2(c.at[0], c.at[2])))
  return { ...rec, cells }
}
/** The newest strip's saplings (bone meal goes there: the strip planted last grows first, the rotation stays staggered) -> [cell]. */
export function bonemealCells (read, rec, census = stripCensus(read, rec)) {
  const st = [...census].filter(c => c.sapling > 0).sort((a, b) => (b.plantedAt ?? 0) - (a.plantedAt ?? 0) || b.s - a.s)[0]
  if (!st) return []
  return forestPlots(rec).filter(c => c.seg === rec.strips[st.s].seg && plotLive(rec, c) && plotState(read, c) === 'sapling')
}
/** Bone meal the forest may use now -> n: the bag's, and the town's above FOREST.bmKeep (the decorator's nursery keeps its share),
 *  at most bmMax a visit. Pure. */
export const bonemealBudget = ({ bag = 0, town = 0 } = {}, F = FOREST) => Math.max(0, Math.min(F.bmMax, (Number(bag) || 0) + Math.max(0, (Number(town) || 0) - F.bmKeep)))
/**
 * THE ROTATION AFTER A VISIT -> the record's new `rotation` and `strips` | null (unchanged). Pure. A harvest that began on a strip
 * names it `harvesting` (lastAt: now); a harvesting strip with no tree left is done: `harvesting` null and its `plantedAt` now (its
 * plots were replanted this visit or are open for the next).
 */
export function rotationAfter (rec, census, { began = null, now = 0 } = {}) {
  const rot = { ...(rec?.rotation ?? { harvesting: null, lastAt: null }) }
  let strips = rec?.strips ?? []
  let changed = false
  if (Number.isInteger(began) && rot.harvesting !== began) { rot.harvesting = began; rot.lastAt = now; changed = true }
  const h = rot.harvesting
  if (Number.isInteger(h) && census[h] && census[h].tree === 0 && census[h].unknown === 0) {
    strips = strips.map((st, i) => (i === h ? { ...st, plantedAt: now } : st))
    rot.harvesting = null
    changed = true
  }
  return changed ? { rotation: rot, strips } : null
}
/** The forest's footprint for the walks' price (shop.mjs footprintCost): every plot's column from its soil to the crown (no walk
 *  digs a trunk, a sapling or its soil, nor sets a scaffold there). The stands and aisles are NOT in it: a walk may dig an aisle's
 *  leaves. The harvest digs its logs with the build effects' own dig, which no walk price touches. -> Set "x,y,z". Pure. */
export function forestFootprint (rec, F = FOREST) {
  const out = new Set()
  for (const c of forestPlots(rec)) for (let k = -1; k <= F.bandAbove; k++) out.add(k3(c.at[0], c.at[1] + k, c.at[2]))
  return out
}

// ---- the groundskeeper's felled trees: replanted in the forest's rows -------------------------------------------------------------

/**
 * WHERE A FELLED OUTSIDE TREE'S SAPLING GOES (tidy.mjs replantCells, owner 11-06 "when they cut down a tree outside the walls replant
 * in an clean organized way") -> [{ cell, species, sapling, state, forest: true }]: the forest's open live plots, row order, none in
 * the strip being harvested (its own replant is the forest's), none already `claimed` (another debt's, "x,y,z"). Fewer plots than
 * trees: the rest go where replantCells puts them. Pure.
 */
export function forestReplantCells (read, rec, trees = [], { claimed = new Set(), now = 0, home = null, maxR = Infinity } = {}) {
  if (!rec || !trees.length) return []
  const h = rec.rotation?.harvesting
  const hs = Number.isInteger(h) ? rec.strips?.[h]?.seg : null
  const out = []
  for (const c of openPlots(read, rec).filter(q => plotState(read, q) === 'open').sort((a, b) => stripOf(rec, a) - stripOf(rec, b) || a.at[2] - b.at[2] || a.at[0] - b.at[0])) {
    if (out.length >= trees.length) break
    if (c.seg === hs || claimed.has(c.at.join(','))) continue
    if (home && Math.max(Math.abs(c.at[0] - home.x), Math.abs(c.at[2] - home.z)) > maxR) continue   // beyond the tidy's own walk
    const t = trees[out.length]
    const sap = /_log$|_wood$/.test(String(t?.name ?? '')) ? String(t.name).replace(/_(log|wood)$/, '_sapling') : null
    out.push({ cell: [...c.at], species: (sap && FARM_SPECIES.includes(sap) ? sap : rec.species ?? 'spruce_sapling').replace(/_sapling$/, ''), sapling: sap && FARM_SPECIES.includes(sap) ? sap : (rec.species ?? 'spruce_sapling'), state: 'pending', forest: true })
  }
  return out
}

// ---- the in-wall farm, retired ---------------------------------------------------------------------------------------------------

/**
 * THE OLD FARM'S RETIREMENT -> { trees: [{ key, cell, stand, order }], saplings: [cell], lights: [cell], kept: [{ key, cell, why }], done }.
 * Pure. The in-wall farm (treefarm.mjs record) is taken down: every grown plot's trunk felled top down, the stump last, from a stand
 * beside it; every planted sapling dug (picked up for the forest); every torch dug. A tree the side stand cannot fell WHOLE (a branch,
 * a log past dy +6 -- an 8-log spruce on the old FLAT plots -- or one the record waived after FOREST.failMax failures) is KEPT: it
 * stays standing as one of the garden's trees. `done`: nothing of it left but its kept trees (unread is not done).
 */
export function farmRetirePlan (read, farm, F = FOREST) {
  const trees = [], saplings = [], lights = [], kept = []
  let unread = 0
  const waived = farm?.waived ?? {}
  for (const c of farm?.cells ?? []) {
    const [x, y, z] = c.at
    const b = read(x, y, z)
    if (!b) { unread++; continue }
    const n = nm(b)
    if (c.role === 'light' && n === 'torch') lights.push(c.at)
    if (c.role !== 'plot') continue
    if (SAPLING.test(n)) { saplings.push(c.at); continue }
    // THE WHOLE COLUMN, gaps and all (Claude + Codex r1: an interrupted stump-stance felling leaves its upper logs over air; a scan
    // that stopped at the first gap read the tree done and retired the farm under them), up to trunkMax + 2
    const col = []
    for (let k = 0; k <= F.trunkMax + 2; k++) { const q = read(x, y + k, z); if (!q) { unread++; break } if (LOG.test(nm(q))) col.push([x, y + k, z]) }
    if (!col.length) continue
    const key = `farm:${c.at.join(',')}`
    if (waived[key]) { kept.push({ key, cell: c.at, why: waived[key]?.why ?? 'kept' }); continue }
    // a BRANCH (a log beside the column: a fancy oak) or a trunk too tall is never started: it stays, a garden tree (`kept`) -- never
    // half felled
    const branch = col.some(p => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dz]) => [-1, 0, 1].some(dy => p[1] + dy >= y && LOG.test(nm(read(p[0] + dx, p[1] + dy, p[2] + dz))))))
    const top = col.at(-1)[1]
    if (branch || top - y > F.reachUp + 1) { kept.push({ key, cell: c.at, why: branch ? 'branch' : 'tall' }); continue }
    // the stand: a plot neighbour whose feet cell (the plot's level) and head are open or leaves, its ground solid
    let stand = null
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const g = read(x + dx, y - 1, z + dz), f = read(x + dx, y, z + dz), hd = read(x + dx, y + 1, z + dz)
      if (!g || !f || !hd || g.boundingBox !== 'block' || LOG.test(nm(g))) continue
      if ([f, hd].every(q => AIRN(nm(q)) || LEAVES.test(nm(q)) || q.boundingBox === 'empty')) { stand = [x + dx, y, z + dz]; break }
    }
    if (!stand) { trees.push({ key, cell: c.at, stand: null, order: [], step: false }); continue }
    // a log the side stand does not reach (an 8-log spruce on a FLAT plot: its top at dy +7) -- the tree is KEPT, a garden tree, never
    // started (Codex r2: a stump-stance felling that failed after its lower logs left the top floating and was then waived as kept;
    // Paper proved the stump stance, but a tree kept whole is the one outcome that can never float). Else top down, the stump last
    if (col.some(p => !standReaches(stand, p, F))) { kept.push({ key, cell: c.at, why: 'tall' }); continue }
    trees.push({ key, cell: c.at, stand, order: [...col].reverse(), step: false, logs: col.length })
  }
  return { trees, saplings, lights, kept, done: !unread && !trees.length && !saplings.length && !lights.length }
}
/** A FARM TREE THIS BOT FAILED (forestFell's why, never the clock) -> true when it is due to be KEPT (waived on the farm record, a
 *  garden tree): FOREST.failMax failures. Pure over `fails` (Map key -> n, the bot's own, mutated). The forest's own plots the same. */
export function keepDue (fails, key, why, F = FOREST) {
  if (!fails || !key || why === 'deadline' || why === 'no_time' || why === 'zones_unknown') return false   // forest-04: unread zones are no failure
  const n = (fails.get(key) ?? 0) + 1
  fails.set(key, n)
  return n >= F.failMax
}
/** THE RETIRED FARM RECORD (published once its trees, saplings and torches are gone): no cells, no zones, no box reservation, the
 *  old box kept as `was` (the garden's site), the old cells and clears kept as `retired` / `retiredClear` with `retiredAt` (the
 *  showcase read judges the farm's earlier rows against them, and releases its cells to the groundskeeper from retiredAt: the wall's
 *  retirement convention). Pure. */
export const farmRetired = (farm, now = 0) => ({ ...farm, cells: [], clear: [], trees: [], zones: [], retired: [...(farm?.cells ?? [])], retiredClear: [...(farm?.clear ?? [])], was: farm?.was ?? farm?.box ?? null, box: null, state: 'retired', retiredAt: now, structure_complete: true })
/** Is a treefarm record retired? Pure. */
export const farmIsRetired = farm => farm?.state === 'retired'
/** THE GARDEN on the old farm's ground (the land plan's second park: terrace.mjs parkTopUp lays it, the groundskeeper builds it).
 *  -> { box, seed, placed, trees, at } | null. The box is the old farm's, less a 1-column margin inside (the hedge has its walk).
 *  Pure. */
export function gardenOf (farm, { seed = 0, now = 0, kept = [] } = {}) {
  const b = farm?.was ?? farm?.box
  if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite) || b[2] - b[0] < 6 || b[3] - b[1] < 6) return null
  // a farm tree KEPT (a branchy, too tall or unfellable one) is the garden's own tree: parkTopUp keeps every element off its column
  return { box: [b[0] + 1, b[1] + 1, b[2] - 1, b[3] - 1], seed: (Number(seed) >>> 0) ^ 0x6a09e667, placed: {}, skipped: {}, kinds: {}, trees: (kept ?? []).map(k => [...(k.cell ?? k)]), at: now }
}
/** (The garden's reservation is landplan.mjs gardenZones, beside the park's.) */

/** The `_build` row fields for a forest dig or planting op (shop.mjs buildRowDetail takes them). */
export const forestRow = ({ op, cell = null, block = null, kind = null, n = null, why = null, seg = null }) => ({ project: FOREST_PLOT, op, ...(seg ? { seg } : {}), ...(cell ? { cell } : {}), ...(block ? { block } : {}), ...(kind ? { kind } : {}), ...(n != null ? { n } : {}), ...(why ? { why } : {}) })
/** Is a name a sapling the forest plants? Pure. */
export const isForestSapling = n => FARM_SPECIES.includes(String(n ?? ''))
export { PLANTABLE }
