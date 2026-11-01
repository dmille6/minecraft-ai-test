// TREEFARM-04: THE TOWN TREE FARM AS A PROJECT (owner showcase list 10-29, item 4: "tree farm near town"; camera `treefarm`).
// PURE: the switch, the species, the siting, the record, the plot states, the harvest plan, the due test. Nothing here touches
// a bot or a file. The visit is skills.mjs buildTreeFarm.
//
// LINEAGE: treefarm-01..03 (branch tf3-on-6e1afb5 @ 975e2ce5, parked since 10-23) built the farm as its OWN town order
// (cognitive.mjs farmOrder, a `treefarm-<home>` record, a tend_farm skill). Its measured rules are kept here -- a grid of
// single-sapling plots, a clear column above each (oak 5 air, birch 6: sapling-clearance-measured; spruce, unmeasured, from
// vanilla's tree config below), growth torches at the centre of every 2x2 group of plots (manhattan 5 from each sapling's
// light cell: 14 - 5 = 9, vanilla's minimum), no farm in a protected zone, the farm a reservation every other planner keeps
// off -- but the farm is now a SHOWCASE PROJECT (after the paths) on the project machinery the showcase already runs (shop.mjs
// PROJECTS, buildproj.mjs records and leases, buildrun.mjs runVisit, the showcase read's G1-G8): no protected file changes,
// and the paths project extends a leg to the farm's front by itself once it stands (paths.mjs pathDests `front`).
//
// WHAT THE RECORD IS (written once at siting, deterministic):
//   cells  soil  the ground under each plot (grass/dirt/podzol...: done as it is; a lost one gets dirt back)
//          plot  the cell the sapling goes in, one above the soil: DONE while it holds a farm sapling; a LOG there is a
//                grown tree -- also done for the build (farmAlsoDone), and the harvest's to fell
//          light a torch on the ground at the centre of each 2x2 group (only as many as the town spares at siting)
//   trees  the trunks standing in the farm's box at siting: felled by the harvest step before the farm counts complete
//   clear  low leaves in the plot columns and beside them (the stands): runVisit's clears
//   front  the two columns outside the box that face home: the paths' destination
//
// THE LOOP: a visit (skills.mjs buildTreeFarm) (1) HARVESTS -- every grown plot's trunk is felled, its upper logs first and
// the stump LAST (so the stump is the stance the top logs are dug from: standing on it, the eye is at plot+2.62 and a log at
// plot+7, the top of an 8-log spruce, is within the dig reach of 5), through the gather's own dig (collectManually: the
// stance search, the dig-approach, every dig guard) -- then (2) runs runVisit on the record: the empty plots get their
// sapling, a lost soil its dirt, the lights their torch. The logs go to the town chests (the visit banks what it felled).
// A complete farm is never "damaged"; its harvest and replant are UPKEEP (`due`: after every open project, shop.mjs
// activeProject), so the farm never holds a building project back.
//
// VANILLA'S TREE ROOM (TreeFeature.getMaxFreeTreeHeight over TwoLayersFeatureSize; a log or any non-leaf solid in it stops
// the growth attempt, leaves and plants do not): oak/birch (4-6 / 5-7 logs) need the 3x3 above the base free from layer 1;
// spruce (5-8 logs, SpruceFoliagePlacer) needs the 5x5 free from layer 2 up to its height + 1. So a plot needs its column clear
// to CLEAR_ABOVE (spruce's 8 + 1, + 1 margin) and no ground or log within GROW_R of it above layer 1: neighbouring trunks are
// SPACING (4) apart, beyond GROW_R (2), and a torch on the ground is at layer 1 (radius 0 there).
//
// TREEFARM=off is the kill switch (the order never picks the project; a visit refuses). On only in TREEFARM_POOLS (default
// 'showcase') until a fleet rollout.

import { pathColumn, pathAvoid } from './paths.mjs'

export const TREEFARM_PLOT = 'treefarm'
export const TREEFARM_BLUEPRINT = 'treefarm@1'
export const TREEFARM_BUILDERS = 2
/** THE SWITCH -> bool. TREEFARM=on|off; unset = on only in the pools TREEFARM_POOLS names (default 'showcase'). Pure. */
export function treefarmOn (env = process.env, pool = '') {
  const v = String(env?.TREEFARM ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  const pools = String(env?.TREEFARM_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes(String(pool))
}

export const FARM = Object.freeze({
  grids: Object.freeze([[4, 4], [4, 3], [3, 4], [3, 3]]),   // plots per side, the biggest that fits first
  spacing: 4,          // trunk to trunk: beyond spruce's GROW_R, and every plot within manhattan 5 of a growth torch
  margin: 2,           // the walkway ring round the plots (inside the farm's box)
  clearAbove: 10,      // clear cells above a plot cell (spruce 8 logs + 1, + 1)
  growR: 2,            // spruce's foliage room from layer 2 (TwoLayersFeatureSize(2, 0, 2))
  dy: 2,               // a plot's ground may sit this far from the farm's median ground
  rMin: 8,             // the box's nearest column at least this far from home (bots idle there)
  rMax: 48,            // ...and its centre within this (a gather from town reaches it)
  minPlots: 10,        // a fit needs this many usable plots (terrain may cost a few)
  fillMax: 6,          // the floor fills a column at most this many cells (a bot's pit)...
  cutMax: 5,           // ...and cuts one at most this many (a bot's pillar)
  earthMax: 260,       // fills + cuts in all, at most
  trunkMax: 12,        // logs followed up one trunk
  reach: 7,            // logs up to ground + reach + 1 come down (the stump stance: see the header)
  siteTreesMax: 12,    // trunks felled at siting, at most (the cheapest site wins anyway)
  siteLogsMax: 90,     // logs felled at siting, at most
})
/** Saplings the farm plants, in preference order (a straight single trunk the harvest fells from the stump up). Acacia
 *  (a bent trunk), cherry (branches), dark oak and pale oak (2x2 only), jungle (unmeasured, giant) and mangrove are not
 *  farm species. */
export const FARM_SPECIES = Object.freeze(['birch_sapling', 'spruce_sapling', 'oak_sapling'])
export const PLANTABLE = /^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|moss_block|mud|muddy_mangrove_roots)$/
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const LOG = /_log$/
const LEAVES = /_leaves$/
const SAPLING = /_sapling$/
const k2 = (x, z) => `${x},${z}`
const k3 = (x, y, z) => `${x},${y},${z}`
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'

/**
 * WHAT THE FARM'S BOX MUST KEEP OFF -> (x, z) -> reason | null. Pure. The paths' own refusals (paths.mjs pathAvoid: zones, plan
 * cells and boxes, the core, wells, the composter, the old farm's columns + 2, every other project's record columns) and every
 * other project's siting zone (shop.mjs recordZones: a record's box + PROJECT_GAP, the paths' and the wall's columns + 1).
 */
export function farmBlocked ({ plan = null, zones = [], caps = [], plinth = [], composter = null, farm = [], records = [], pzones = [] } = {}) {
  const avoid = pathAvoid({ plan, zones, caps, plinth, composter, farm, records, home: plan?.home ?? { y: 70 } })
  const boxes = (pzones ?? []).map(z => z?.box ?? z).filter(b => Array.isArray(b) && b.length === 6)
  return (x, z) => avoid(x, z) ?? (boxes.some(b => x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) ? 'project' : null)
}
/** THE BOUNDS: a town wall's ring less its own line ([x0, z0, x1, z1]: the farm stands inside the wall), or null. Pure. */
export function farmBounds (records = []) {
  const w = (records ?? []).find(r => r?.blueprint === 'wall@1' && Array.isArray(r.ring) && r.ring.length === 4)
  return w ? [w.ring[0] + 1, w.ring[1] + 1, w.ring[2] - 1, w.ring[3] - 1] : null
}
/** THE LIGHTS THE TOWN SPARES -> n: half its torches above the PROJECT floor of their reserve (OWNER 10-27: a project in progress
 *  may spend 80% of a reserve, so 20% stays). Pure. */
export const lightsFor = (torches = 0, reserve = 0) => Math.floor(Math.max(0, (Number(torches) || 0) - Math.ceil(0.2 * (Number(reserve) || 0))) / 2)

/** THE SPECIES -> a FARM_SPECIES name. Pure. The farm species with the most saplings the town and the bags hold (`counts`),
 *  ties by preference; none held: the native trees' sapling (`native`: the log species seen most near home), else birch. */
export function pickSpecies (counts = {}, native = null) {
  let best = null
  for (const s of FARM_SPECIES) { const n = Number(counts?.[s]) || 0; if (n > 0 && (!best || n > best.n)) best = { s, n } }
  if (best) return best.s
  const nat = typeof native === 'string' ? native.replace(/_log$/, '_sapling') : null
  return FARM_SPECIES.includes(nat) ? nat : FARM_SPECIES[0]
}
/** THE PALETTE of a farm record (buildrun.mjs cellDone / blockFor): a plot takes any farm sapling, its own species first; the
 *  soil is done as natural ground and placed as dirt; a light is a torch. Pure. */
export function farmPalette (species = FARM_SPECIES[0]) {
  const sp = FARM_SPECIES.includes(species) ? species : FARM_SPECIES[0]
  return Object.freeze({
    soil: Object.freeze(['dirt', 'grass_block', 'coarse_dirt', 'podzol', 'rooted_dirt', 'moss_block', 'mud']),
    floor: Object.freeze(['dirt', 'cobblestone', '*solid']),
    plot: Object.freeze([sp, ...FARM_SPECIES.filter(s => s !== sp)]),
    light: Object.freeze(['torch']),
  })
}
export const FARM_PALETTE = farmPalette()
/** What a visit may dig out of an OPEN record cell before placing (buildrun.mjs foreignKind's scaffold class): ground blocks, a
 *  plant, a foreign sapling, leaves. Never a LOG (a grown tree is the harvest's, read done by farmAlsoDone). */
export const FARM_FOREIGN = /^(cobblestone|mossy_cobblestone|dirt|coarse_dirt|grass_block|podzol|rooted_dirt|mycelium|moss_block|stone|andesite|diorite|granite|tuff|gravel|sand|red_sand|clay|mud|snow_block|dirt_path|farmland|netherrack|cobbled_deepslate|deepslate|[a-z_]+_sapling|mangrove_propagule|[a-z_]+_leaves|brown_mushroom|red_mushroom|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|sunflower|lilac|rose_bush|peony|sweet_berry_bush|bush|firefly_bush|leaf_litter|wildflowers|pink_petals|moss_carpet|short_grass|tall_grass|fern|large_fern|dead_bush|short_dry_grass|tall_dry_grass|torchflower|snow|[a-z_]+_planks)$/
/** A grown tree in a plot cell is DONE for the build (the harvest fells it; runVisit never takes a farm tree). -> (cell, read)
 *  -> bool. Pure. */
export const farmAlsoDone = (cell, read) => cell?.role === 'plot' && LOG.test(nm(read?.(...cell.at)))

/** The grid's plot columns from the first plot (x0, z0). Pure. */
export function plotCols (x0, z0, gx, gz, sp = FARM.spacing) {
  const out = []
  for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) out.push({ x: x0 + i * sp, z: z0 + j * sp, i, j })
  return out
}
/** The growth torches: the centre of every 2x2 group of plots. Pure. */
export function lightCols (x0, z0, gx, gz, sp = FARM.spacing) {
  const out = []
  const h = Math.floor(sp / 2)
  for (let j = 0; j + 1 < gz; j++) for (let i = 0; i + 1 < gx; i++) out.push({ x: x0 + i * sp + h, z: z0 + j * sp + h })
  return out
}
/** The farm's box [x0, z0, x1, z1]: the plots and the walkway ring. Pure. */
export const farmBox = (x0, z0, gx, gz, sp = FARM.spacing, m = FARM.margin) => [x0 - m, z0 - m, x0 + (gx - 1) * sp + m, z0 + (gz - 1) * sp + m]

/**
 * A TRUNK STANDING ON A COLUMN -> [[x, y, z], ...] lowest first, or null (an unread cell, or a tree past `max` logs): the logs
 * above `ground` connected to the column's own lowest log (26 neighbours), never into a column `keep(x, z)` names (outside the
 * box: the tree is cut at the boundary). Pure.
 */
export function trunkLogs (read, x, z, ground, { max = FARM.trunkMax * 3, keep = () => false, top = ground + 24 } = {}) {
  let start = null
  for (let y = ground + 1; y <= top; y++) {
    const b = read(x, y, z)
    if (!b) return null
    if (LOG.test(nm(b))) { start = [x, y, z]; break }
  }
  if (!start) return []
  const got = new Map([[start.join(','), start]]), q = [start]
  for (let h = 0; h < q.length && got.size <= max; h++) {
    const [px, py, pz] = q[h]
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const p = [px + dx, py + dy, pz + dz], key = p.join(',')
      if (got.has(key) || p[1] <= ground) continue
      if ((p[0] !== x || p[2] !== z) && keep(p[0], p[2])) continue
      const b = read(...p)
      if (b && LOG.test(nm(b))) { got.set(key, p); q.push(p) }
    }
  }
  if (got.size > max) return null
  return [...got.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2])
}

/** Ground a level's CUT may dig (natural ground and the bots' own scaffold pillars). */
export const CUTTABLE = /^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mycelium|moss_block|mud|stone|andesite|diorite|granite|tuff|gravel|sand|red_sand|clay|cobblestone|mossy_cobblestone|cobbled_deepslate|dirt_path)$/
/**
 * ONE PLOT'S REFUSAL on the levelled floor at L -> reason | null. Pure. THE ROOM: the column clear from the sapling's cell (L + 1)
 * to L + 1 + CLEAR_ABOVE, and the GROW_R square from layer 2 (L + 3) up: no log the farm does not fell and no other solid above
 * the column's own ground (a cut removes what is below it; leaves are no obstruction). The box is level, so every plot has its
 * stands and no ground rises round it.
 */
export function plotRefusal (read, p, { col, L, felled = new Set() } = {}) {
  for (let dx = -FARM.growR; dx <= FARM.growR; dx++) for (let dz = -FARM.growR; dz <= FARM.growR; dz++) {
    const centre = dx === 0 && dz === 0
    const g = col(p.x + dx, p.z + dz).y
    for (let y = Math.max(centre ? L + 1 : L + 3, g + 1); y <= L + 1 + FARM.clearAbove; y++) {
      const b = read(p.x + dx, y, p.z + dz)
      if (!b) return 'unknown'
      const n = nm(b)
      if (LOG.test(n)) { if (!felled.has(k3(p.x + dx, y, p.z + dz))) return 'room_log'; continue }
      if (!AIRN(n) && !LEAVES.test(n) && b.boundingBox === 'block') return 'room'
    }
  }
  return null
}
/**
 * ONE CANDIDATE: the grid with its first plot at (x0, z0) -> { ok, why, box, L, plots, lights, floor, trees, clear, cost }. Pure.
 *   col(x, z)     pathColumn's answer for the column (cached by the caller)
 *   blocked(x, z) -> reason | null   another project, a plan cell, a zone, a well... (the whole box must be free)
 * THE FLOOR: the whole box is levelled to L, the median ground of its columns -- a column below is FILLED (dirt, cobblestone when
 * the bag has no dirt: a floor cell is done by any full solid) at most FILL_MAX, one above is CUT (its ground dug, listed with
 * the clears) at most CUT_MAX; a plot's soil is the floor's top at L (natural ground kept, else dirt). The showcase's town ground
 * is pitted and pillared by two weeks of bots (offline 10-31: a 7-deep trench, pillars to +5 in the first site found): a level
 * floor is what makes the rows read as a farm. A grid position whose room refuses a plot is LEFT OUT (the old farm's rule:
 * terrain may cost a few plots); the fit needs FARM.minPlots.
 */
export function fitAt (read, { x0, z0, gx, gz, home, col, blocked, lights = 0, sp = FARM.spacing } = {}) {
  const box = farmBox(x0, z0, gx, gz, sp)
  const gs = []
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    const r = blocked(x, z)
    if (r) return { ok: false, why: `box:${r}` }
    const c = col(x, z)
    if (c.why === 'unknown') return { ok: false, why: 'unknown' }
    if (c.why) return { ok: false, why: `box:${c.why}` }
    gs.push(c.y)
  }
  gs.sort((a, b) => a - b)
  const L = gs[Math.floor(gs.length / 2)]
  // THE FLOOR: fills below L, cuts above it
  const floor = [], cuts = []
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    const c = col(x, z)
    if (L - c.y > FARM.fillMax || c.y - L > FARM.cutMax) return { ok: false, why: 'level' }
    for (let y = c.y + 1; y <= L; y++) floor.push([x, y, z])
    for (let y = L + 1; y <= c.y; y++) {
      const b = read(x, y, z)
      if (!b) return { ok: false, why: 'unknown' }
      const n = nm(b)
      if (AIRN(n) || b.boundingBox === 'empty' || LOG.test(n)) continue                 // open, a plant, or a trunk (felled first)
      if (LEAVES.test(n)) { cuts.push({ at: [x, y, z], kind: 'leaves', name: n }); continue }
      if (!CUTTABLE.test(n)) return { ok: false, why: 'level' }
      cuts.push({ at: [x, y, z], kind: 'cut', name: n })
    }
  }
  if (floor.length + cuts.length > FARM.earthMax) return { ok: false, why: 'earth' }
  // THE TREES IN THE BOX (felled by the harvest step before the floor is laid): every trunk standing on a box column, followed to
  // its connected logs inside the box; a log past the stump stance's reach, or a tree too big, refuses the site (it would float)
  const keep = (x, z) => x < box[0] || x > box[2] || z < box[1] || z > box[3]
  const trees = [], felled = new Set()
  let logs = 0
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    const c = col(x, z)
    if (!c.above.some(a => a.kind === 'tree')) continue
    const t = trunkLogs(read, x, z, c.y, { keep })
    if (t == null) return { ok: false, why: 'tree_big' }
    const fresh = t.filter(p => !felled.has(p.join(',')))
    if (!fresh.length) continue
    for (const p of fresh) felled.add(p.join(','))
    if (fresh.some(p => p[1] - Math.max(c.y, L) > FARM.reach + 1)) return { ok: false, why: 'tree_tall' }
    trees.push({ base: fresh[0], logs: fresh })
    logs += fresh.length
  }
  if (trees.length > FARM.siteTreesMax || logs > FARM.siteLogsMax) return { ok: false, why: 'too_many_trees' }
  const grid = plotCols(x0, z0, gx, gz, sp)
  const plots = [], refused = {}
  for (const p of grid) {
    const r = plotRefusal(read, p, { col, L, felled })
    if (r === 'unknown') return { ok: false, why: 'unknown' }
    if (r) { refused[r] = (refused[r] ?? 0) + 1; continue }
    plots.push({ ...p, y: L })
  }
  if (plots.length < Math.min(FARM.minPlots, grid.length)) return { ok: false, why: `plots:${Object.entries(refused).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-'}` }
  // THE CLEARS: the cuts; the leaves in each plot column (the cell above the sapling to + 3: the head room a planter looks
  // through) and in the plot's four stands (feet and head). The plot cell's own plant or leaf is the record cell's foreign dig
  const clear = [...cuts], seenC = new Set(cuts.map(c => c.at.join(',')))
  const addClear = (x, y, z) => {
    const k = k3(x, y, z)
    if (seenC.has(k) || felled.has(k)) return
    const b = read(x, y, z)
    if (b && LEAVES.test(nm(b))) { seenC.add(k); clear.push({ at: [x, y, z], kind: 'leaves', name: nm(b) }) }
  }
  for (const p of plots) {
    for (let y = L + 2; y <= L + 4; y++) addClear(p.x, y, p.z)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let y = L + 1; y <= L + 2; y++) addClear(p.x + dx, y, p.z + dz)
  }
  // THE LIGHTS: on the floor (never a plot's column), as many as the town spares
  const lightCells = []
  for (const l of lightCols(x0, z0, gx, gz, sp)) {
    if (lightCells.length >= lights) break
    const above = read(l.x, L + 1, l.z)
    if (!above || !(AIRN(nm(above)) || col(l.x, l.z).y > L)) continue
    lightCells.push({ x: l.x, y: L + 1, z: l.z })
  }
  const d = Math.hypot((box[0] + box[2]) / 2 - home.x, (box[1] + box[3]) / 2 - home.z)
  if (d > FARM.rMax) return { ok: false, why: 'far' }
  const cost = (grid.length - plots.length) * 8 + trees.length * 6 + logs * 0.4 + clear.length * 0.1 + floor.length * 0.3 + cuts.length * 0.2 + d * 0.5
  return { ok: true, why: null, box, L, plots, lights: lightCells, floor, trees, clear, cost }
}

/** THE FRONT: two columns just outside the box on the side that faces home, at its middle (the paths' destination); the next
 *  side when every column of one is blocked. Pure. */
export function farmFront (box, home, blocked = () => null) {
  const [x0, z0, x1, z1] = box
  const cx = Math.floor((x0 + x1) / 2), cz = Math.floor((z0 + z1) / 2)
  const sides = [
    { d: (home.x < x0 ? 0 : 100) + Math.abs(home.x - x0), cols: [[x0 - 1, cz], [x0 - 1, cz + 1]] },
    { d: (home.x > x1 ? 0 : 100) + Math.abs(home.x - x1), cols: [[x1 + 1, cz], [x1 + 1, cz + 1]] },
    { d: (home.z < z0 ? 0 : 100) + Math.abs(home.z - z0), cols: [[cx, z0 - 1], [cx + 1, z0 - 1]] },
    { d: (home.z > z1 ? 0 : 100) + Math.abs(home.z - z1), cols: [[cx, z1 + 1], [cx + 1, z1 + 1]] },
  ].sort((a, b) => a.d - b.d)
  for (const s of sides) { const ok = s.cols.filter(([x, z]) => !blocked(x, z)); if (ok.length) return ok }
  return sides[0].cols
}

/**
 * THE SITING -> { ok, why, record, tried }. Pure over `read`.
 *   home     the plan's home { x, y, z }
 *   blocked  (x, z) -> reason | null: every reservation the farm's box must keep off (paths.mjs pathAvoid over the plan, zones,
 *            wells, the composter and every other project's record columns, plus the other records' zones -- the caller composes)
 *   bounds   [x0, z0, x1, z1] | null: the box must lie inside (a town wall's inside)
 *   lights   torches the town spares; species the sapling species
 * Every grid size, biggest first; for each, every first-plot column whose box lies in bounds, at least rMin from home at its
 * nearest and within rMax at its centre; the cheapest fit wins (trunks, logs, leaves, distance, unevenness); ties by the scan
 * order (x, then z: deterministic). An unread column refuses that candidate only; no fit at all -> { ok: false, why } naming the
 * commonest refusals.
 */
export function siteFarm (read, { home, blocked = () => null, bounds = null, lights = 0, species = FARM_SPECIES[0], yHi = null, yLo = null } = {}) {
  if (!home || typeof read !== 'function') return { ok: false, why: 'no_home', record: null }
  const hi = yHi ?? Math.floor(home.y) + 24, lo = yLo ?? Math.floor(home.y) - 14
  const cache = new Map()
  const col = (x, z) => { const k = k2(x, z); let c = cache.get(k); if (!c) { c = pathColumn(read, x, z, { yHi: hi, yLo: lo }); cache.set(k, c) } return c }
  const bcache = new Map()
  const blk = (x, z) => { const k = k2(x, z); if (!bcache.has(k)) bcache.set(k, blocked(x, z) ?? null); return bcache.get(k) }
  const R = FARM.rMax
  const why = {}
  let tried = 0
  for (const [gx, gz] of FARM.grids) {
    let best = null
    const span = [(gx - 1) * FARM.spacing, (gz - 1) * FARM.spacing]
    for (let x0 = Math.floor(home.x) - R; x0 <= Math.floor(home.x) + R - span[0]; x0++) {
      for (let z0 = Math.floor(home.z) - R; z0 <= Math.floor(home.z) + R - span[1]; z0++) {
        const box = farmBox(x0, z0, gx, gz)
        if (bounds && (box[0] < bounds[0] || box[1] < bounds[1] || box[2] > bounds[2] || box[3] > bounds[3])) continue
        const nx = Math.max(box[0], Math.min(home.x, box[2])), nz = Math.max(box[1], Math.min(home.z, box[3]))
        if (Math.hypot(nx - home.x, nz - home.z) < FARM.rMin) continue
        tried++
        const f = fitAt(read, { x0, z0, gx, gz, home, col, blocked: blk, lights })
        if (!f.ok) { const w = String(f.why).split(':')[0]; why[w] = (why[w] ?? 0) + 1; continue }
        if (!best || f.cost < best.f.cost - 1e-9) best = { f, x0, z0, gx, gz }
      }
    }
    if (best) return { ok: true, why: null, tried, record: farmRecord(best, { home, species, blocked: blk }) }
  }
  const top = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(' ')
  return { ok: false, why: `no fit (${tried} tried: ${top || '-'})`, tried, record: null }
}

/** THE RECORD from a fit. Pure. One segment per plot row (soil before plot: lowest first) and the lights last. */
export function farmRecord ({ f, x0, z0, gx, gz }, { home, species = FARM_SPECIES[0], blocked = () => null } = {}) {
  const cells = [], segments = []
  for (let j = 0; j < gz; j++) {
    const seg = `R-${j + 1}`
    segments.push({ seg, deps: [] })
    for (const p of f.plots.filter(q => q.j === j)) {
      cells.push({ at: [p.x, p.y, p.z], role: 'soil', seg })
      cells.push({ at: [p.x, p.y + 1, p.z], role: 'plot', seg })
    }
  }
  // THE FLOOR's fills (a plot's own top is its soil cell, above): their own segment, first -- every row and the lights wait on it
  // (a soil or a torch over a filled column needs the fill under it)
  const soilKeys = new Set(cells.filter(c => c.role === 'soil').map(c => c.at.join(',')))
  const fl = (f.floor ?? []).filter(a => !soilKeys.has(a.join(',')))
  if (fl.length) {
    segments.unshift({ seg: 'F', deps: [] })
    for (const s of segments) if (s.seg !== 'F') s.deps = ['F']
    cells.unshift(...fl.map(a => ({ at: a, role: 'floor', seg: 'F' })))
  }
  if (f.lights.length) {
    segments.push({ seg: 'L', deps: fl.length ? ['F'] : [] })
    for (const l of f.lights) cells.push({ at: [l.x, l.y, l.z], role: 'light', seg: 'L' })
  }
  const box = f.box
  return {
    v: 1, blueprint: TREEFARM_BLUEPRINT, plot: TREEFARM_PLOT, home: { x: home.x, y: home.y, z: home.z }, species,
    grid: [gx, gz], spacing: FARM.spacing, anchor: [x0, z0], box, cells, segments,
    clear: f.clear, trees: f.trees, replant: [],
    front: farmFront(box, home, blocked),
    level: f.L,
    counts: { plots: f.plots.length, lights: f.lights.length, trees: f.trees.length, logs: f.trees.reduce((t, x) => t + x.logs.length, 0), clear: f.clear.length, floor: fl.length, cut: f.clear.filter(c => c.kind === 'cut').length },
    bom: { [species]: f.plots.length, ...(f.lights.length ? { torch: f.lights.length } : {}) },
    builders_max: TREEFARM_BUILDERS,
  }
}

// ---- the farm, read ---------------------------------------------------------------------------------------------------------

export const plotCells = rec => (rec?.cells ?? []).filter(c => c.role === 'plot')
/**
 * WHAT A PLOT IS NOW -> 'sapling' | 'tree' | 'open' | 'soil_lost' | 'blocked' | 'unknown'. Pure.
 *   tree     a log in the plot cell (grown: the harvest's)
 *   open     the cell is air or a plant, the soil plantable: a sapling goes in
 *   blocked  something else in the cell (runVisit digs it first when it is FARM_FOREIGN)
 */
export function plotState (read, cell) {
  const [x, y, z] = cell.at
  const b = read(x, y, z), s = read(x, y - 1, z)
  if (!b || !s) return 'unknown'
  const n = nm(b)
  if (LOG.test(n)) return 'tree'
  if (FARM_SPECIES.includes(n)) return 'sapling'
  if (!PLANTABLE.test(nm(s))) return 'soil_lost'
  if (AIRN(n)) return 'open'
  return 'blocked'
}
/** The plots' census -> { sapling, tree, open, ... }. Pure. */
export function farmCensus (read, rec) {
  const out = {}
  for (const c of plotCells(rec)) { const s = plotState(read, c); out[s] = (out[s] ?? 0) + 1 }
  return out
}
/** The site trees still standing -> [{ base, logs }] (only the logs still there, or unread). Pure. */
export function siteTreesLeft (read, rec) {
  const out = []
  for (const t of rec?.trees ?? []) {
    if (rec?.waived?.[`site:${t.base.join(',')}`]) continue          // r2: a site tree no bot could fell (siteTreeWaive)
    const logs = (t.logs ?? []).filter(p => { const b = read(...p); return !b || LOG.test(nm(b)) })
    if (logs.length) out.push({ base: t.base, logs })
  }
  return out
}
/**
 * R2 (LIVE showcase 10-31 14:44Z, the first hour): A SITE TREE NO BOT CAN FELL -- a floating log the gather's dig guard refuses
 * (`no_safe_target`) -- would keep the farm open for ever. A bot that failed one SITE_WAIVE_AFTER times, for a reason other than
 * its visit's clock (`deadline`: the next visit goes on), names it WAIVED on the record (op=waived); siteTreesLeft then passes
 * it. Bounded: at most SITE_WAIVE_MAX waivers a record. -> true when this failure makes the waiver due. Pure over `fails` (Map
 * key -> n, the bot's own, mutated).
 */
export const SITE_WAIVE_AFTER = 3
export const SITE_WAIVE_MAX = 4
export function siteTreeWaive (fails, key, why, rec = null) {
  if (!fails || !String(key).startsWith('site:') || why === 'deadline') return false
  const n = (fails.get(key) ?? 0) + 1
  fails.set(key, n)
  return n >= SITE_WAIVE_AFTER && !rec?.waived?.[key] && Object.keys(rec?.waived ?? {}).length < SITE_WAIVE_MAX
}
/** THE COLUMNS A STANDING SITE TREE HOLDS (its logs' columns + 1): the build's record cells and clears there wait for its felling
 *  (r2, LIVE 14:50Z: two floor cells in the pit under a 2-wide trunk had no stand, were deferred three visits and stamped the
 *  project stuck_on_cell; a cut under a trunk would float it). -> Set "x,z". Pure. */
export const treeHeldCols = standing => new Set((standing ?? []).flatMap(t => t.logs.flatMap(p => [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dz => `${p[0] + dx},${p[2] + dz}`)))))
/**
 * R3 (LIVE showcase 14:46Z: the r1 stamp on the two pit cells under the standing trunk held the farm's order for its 6 h back-off
 * even after r2 left those cells to the felling): AN OPEN FARM'S STUCK STAMP IS STALE when every cell it names lies in a column a
 * standing site tree holds (treeHeldCols) -- the build no longer waits on them; the harvest does the work there. -> bool. Pure.
 */
export function farmStampHeld (keys = [], held = new Set()) {
  return keys.length > 0 && keys.every(k => { const [x, , z] = String(k).split(',').map(Number); return held.has(`${x},${z}`) })
}
/**
 * ONE PLOT'S HARVEST -> [[x, y, z], ...] in dig order: the trunk's logs straight up the plot column from one above the plot
 * cell (lowest first, at most trunkMax), then the stump (the plot cell) LAST -- the stump is the stance the upper logs are dug
 * from. Only the column: a branch (fancy oak) is left. An unread cell ends the trunk. Pure.
 */
export function harvestOrder (read, cell, max = FARM.trunkMax) {
  const [x, y, z] = cell.at
  if (!LOG.test(nm(read(x, y, z)))) return []
  const up = []
  for (let k = 1; k <= max; k++) { const b = read(x, y + k, z); if (!b || !LOG.test(nm(b))) break; up.push([x, y + k, z]) }
  return [...up, [x, y, z]]
}
/** A site tree's dig order: its logs lowest first, except its base (the lowest log) LAST (the stump stance). Pure. */
export function siteTreeOrder (tree) {
  const logs = [...(tree?.logs ?? [])].sort((a, b) => a[1] - b[1])
  return logs.length > 1 ? [...logs.slice(1), logs[0]] : logs
}
/**
 * THE VISIT'S HARVEST LIST -> [{ kind: 'site' | 'grown', key, order }]: the site trees first (the farm is not complete until they
 * are down), then every grown plot; `skip(key)` leaves out a tree this bot failed lately; at most `max`. Pure.
 */
export const HARVEST_MAX = 3
export function harvestList (read, rec, { skip = () => false, max = HARVEST_MAX } = {}) {
  const out = []
  for (const t of siteTreesLeft(read, rec)) {
    const key = `site:${t.base.join(',')}`
    if (!skip(key)) out.push({ kind: 'site', key, order: siteTreeOrder(t) })
  }
  for (const c of plotCells(rec)) {
    if (plotState(read, c) !== 'tree') continue
    const key = `plot:${c.at.join(',')}`
    if (!skip(key)) out.push({ kind: 'grown', key, order: harvestOrder(read, c) })
  }
  return out.slice(0, Math.max(0, max))
}
/**
 * IS THE FARM DUE A VISIT? -> a reason | null. Pure. A grown tree or a site tree to fell (not skipped), an open or lost plot,
 * a plot holding something the visit digs (FARM_FOREIGN), an open light. A plot blocked by anything else is no visit (the visit
 * could only wait on it).
 */
export function farmDue (read, rec, { skip = () => false } = {}) {
  if (harvestList(read, rec, { skip, max: 1 }).length) return 'harvest'
  if (cutsLeft(read, rec).length) return 'level'
  for (const c of rec?.cells ?? []) {
    if (c.role === 'plot') {
      const s = plotState(read, c)
      if (s === 'open' || s === 'soil_lost' || (s === 'blocked' && FARM_FOREIGN.test(nm(read(...c.at))))) return 'replant'
    }
    if (c.role === 'light') { const b = read(...c.at); if (b && AIRN(nm(b))) return 'light' }
  }
  return null
}
/** The floor's CUTS still standing (a listed cut whose cell still holds the block it was listed with; unread is not standing):
 *  the farm is not complete, and stays due, until they are dug (Codex r1 BLOCK 2: runVisit may skip an unreachable cut or stop at
 *  its clear bound and still end `complete`). Leaves are not counted (a leaf no stand reaches would keep the farm due forever). */
export function cutsLeft (read, rec) {
  return (rec?.clear ?? []).filter(c => c.kind === 'cut' && nm(read(...c.at)) === c.name)
}
/** The farm's progress for the visit row -> { done, open } over the record cells. Pure. */
export function farmProgress (rec, isDone) {
  let done = 0, open = 0
  for (const c of rec?.cells ?? []) { if (isDone(c)) done++; else open++ }
  return { done, open }
}
/** The farm's footprint for the walks' price: the record cells and every plot's room up to CLEAR_ABOVE (no walk ever sets a
 *  scaffold in a tree's room, nor breaks the soil or a sapling). -> Set "x,y,z". Pure. */
export function farmFootprint (rec) {
  const out = new Set()
  for (const c of rec?.cells ?? []) {
    out.add(c.at.join(','))
    if (c.role === 'plot') for (let k = 1; k <= FARM.clearAbove; k++) out.add(k3(c.at[0], c.at[1] + k, c.at[2]))
  }
  return out
}
/** The `_build op=harvest` row's fields (shop.mjs buildRowDetail takes them). */
export const harvestRow = ({ cell, block, kind, n = null, why = null }) => ({ project: TREEFARM_PLOT, op: 'harvest', cell, block, kind, ...(n != null ? { n } : {}), ...(why ? { why } : {}) })
/** Is a name a farm species sapling? Pure. */
export const isFarmSapling = n => FARM_SPECIES.includes(String(n ?? ''))
