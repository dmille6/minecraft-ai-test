// CROPFARM-01: THE TOWN WHEAT FARM AS A SHOWCASE PROJECT (farms design docs/reports/farms-design-2026-11-03.md; owner 11-03, ledger
// farms-1103). PURE: the layout, the siting, the record, the crops read, the harvest list, the due test, the seed gather's
// targets, the rows. Nothing here touches a bot or a file. The visit is skills.mjs buildCropFarm. The switch and the seed keep are
// cropkeep.mjs (a leaf: hygiene.mjs reads it).
//
// THE PATTERN is the tree farm's (treefarm.mjs): a record sited once (shop.mjs PROJECTS, buildproj.mjs records and leases), built
// by buildrun.mjs runVisit, and kept by UPKEEP (`due`, after every open project) -- the harvest and the replant. The till and the
// planting are the park's (townterrace-01): the hoe's `useFor` turns a `till` cell's grass into farmland, and the seeds are placed
// on it (a crop block reads as its seed: park.mjs plantedAs).
//
// PAPER PROOF (sandbox3, 11-03, sandbox/farms/farm-proof.cjs): activateBlock(grass, up) holding a hoe -> farmland; placeBlock(farmland,
// up) holding wheat_seeds -> wheat; dig(wheat age 7) -> 1 wheat + 1-4 seeds, the farmland kept; replant -> wheat.
//
// THE LAYOUT (vanilla CropBlock.getGrowthSpeed: a crop with the same crop diagonal to it, or on both axes, grows at HALF speed):
// ROWS. CROP.rows rows of CROP.len crops, each between two 1-wide WALKWAYS (also the stands: a crop is dug and planted from the
// walkway beside it, and its drop lands within the pickup reach of a bot standing there). The rows run along x (orient 'x') or z;
// walkways close both ends. Box (len + 2) x (2 rows + 1): 9 x 9 at 4 x 7. Every column of the box is FLAT at the bed's level L (a
// fall onto farmland tramples it; level walkways never fall), natural ground, no tree, no water, no furniture.
//
// WATER: none is placed (a bucket fill is unproven here: bucket.mjs). A crop cell within HYDRATE_R of still water at L or L + 1 is
// hydrated (vanilla FarmBlock.isNearWater); the site with the most hydrated crops wins, then the nearest. Dry rows still grow
// (vanilla: ~23 random ticks a stage dry, ~8 wet, for a row crop; to be measured).

import { pathColumn } from './paths.mjs'
import { cropfarmOn, KEPT_SEEDS } from './cropkeep.mjs'

export { cropfarmOn, KEPT_SEEDS }
export const CROPFARM_PLOT = 'cropfarm'
export const CROPFARM_BLUEPRINT = 'cropfarm@1'
export const CROPFARM_BUILDERS = 2
export const CROP = Object.freeze({
  rows: 4, len: 7,          // 4 rows of 7 crops: 28 (a 9 x 9 box)
  rMin: 10, rMax: 48,       // the box's nearest column from home at least rMin (Chebyshev); its centre within rMax
  hydrateR: 4,              // vanilla: water within 4 horizontally, at the farmland's level or one above
  harvestMax: 12,           // mature crops dug a visit
  gatherMax: 24,            // grass plants dug for seeds a visit (12.5% a seed)
  gatherR: 24,              // ... within this of the farm's box (Chebyshev)
  seedSpare: 8,             // seeds kept beyond one full planting (the rest banked)
  wheatTownCap: 128,        // the town's wheat (chests): at or above, the harvest waits (two stacks)
  minFree: 4,               // free bag slots a harvest needs
  gatherBackoffMs: 30 * 60_000,
  headroom: 3,              // cells above the ground that must hold nothing but plants (a canopy above is shade, priced)
  earthMax: 24,             // the most cuts + floor fills a site may need (each column at most one off the bed's level)
  // the bed sizes, biggest first (rows x len): LIVE 11-04 offline, no 4 x 7 fits the showcase's crowded, wooded ground; 3 x 5 does
  grids: Object.freeze([[4, 7], [3, 7], [3, 5], [2, 7], [2, 5]]),
})
/** Natural ground a cut may dig (the bed's bumps). */
export const CUTTABLE = /^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mycelium|moss_block|dirt_path|stone|andesite|diorite|granite|tuff|gravel|sand|cobblestone|mossy_cobblestone)$/
/** The record's palette (buildrun.mjs cellDone / blockFor): a till cell is done as farmland; a crop cell takes wheat seeds (a wheat
 *  block of any age reads as its seed: buildrun.mjs blockFamily). */
export const CROP_PALETTE = Object.freeze({ till: Object.freeze(['farmland']), wheat: Object.freeze(['wheat_seeds']), floor: Object.freeze(['dirt', 'cobblestone', '*solid']) })
/** What a visit may dig out of an OPEN crop cell before planting (buildrun.mjs foreignKind's scaffold class): a plant only. */
export const CROP_FOREIGN = /^(short_grass|tall_grass|fern|large_fern|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|leaf_litter|wildflowers|pink_petals|short_dry_grass|tall_dry_grass|bush|dead_bush|snow)$/
/** The crop blocks a farm harvests and their mature age (vanilla CropBlock.MAX_AGE 7; beetroots 3). */
export const MATURE_AGE = Object.freeze({ wheat: 7, carrots: 7, potatoes: 7, beetroots: 3 })
export const CROP_BLOCKS = new Set(Object.keys(MATURE_AGE))
/** A grass plant the seed gather digs (vanilla: short/tall grass and ferns drop wheat seeds at 12.5%). */
export const SEED_GRASS = /^(short_grass|tall_grass|fern|large_fern)$/
/** The ground a hoe tills (vanilla HoeItem: grass, dirt, a dirt path with air above). */
export const TILLABLE = /^(grass_block|dirt|dirt_path)$/

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'
const k2 = (x, z) => `${x},${z}`
const ageOf = b => { const a = b?.age ?? b?.props?.age ?? b?.getProperties?.()?.age; const n = Number(a); return Number.isFinite(n) ? n : null }

// ---- the layout -------------------------------------------------------------------------------------------------------------

/**
 * THE BED AT (x0, z0) -> { box, crops: [{ x, z, row, i }], walk: [[x, z]] }. Pure. orient 'x': the rows run along x from x0 (the
 * first crop) for `len`; the walkways are the even z offsets 0, 2, .. 2 rows and the end columns x0 - 1, x0 + len. orient 'z': the
 * same with x and z swapped. The box is [minX, minZ, maxX, maxZ].
 */
export function bedLayout (x0, z0, orient = 'x', { rows = CROP.rows, len = CROP.len } = {}) {
  const at = (u, v) => (orient === 'x' ? [x0 + u, z0 + v] : [x0 + v, z0 + u])
  const crops = [], walk = []
  for (let v = 0; v <= 2 * rows; v++) {
    for (let u = -1; u <= len; u++) {
      const [x, z] = at(u, v)
      if (v % 2 === 1 && u >= 0 && u < len) crops.push({ x, z, row: (v - 1) / 2, i: u })
      else walk.push([x, z])
    }
  }
  const a = at(-1, 0), b = at(len, 2 * rows)
  return { box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], crops, walk }
}

/**
 * ONE CANDIDATE -> { ok, why, L, crops, walk, clear, hydrated, box, cost }. Pure.
 *   col(x, z)      pathColumn's answer (cached by the caller)
 *   blocked(x, z)  -> reason | null: every reservation the box keeps off (the caller composes)
 *   zoneOk(x, z)   -> bool: the land plan's zone allows the column
 *   water(x, y, z) -> bool: still water in the cell
 */
export function fitBed (read, { x0, z0, orient = 'x', home, col, blocked = () => null, zoneOk = () => true, water = () => false, rows = CROP.rows, len = CROP.len } = {}) {
  const lay = bedLayout(x0, z0, orient, { rows, len })
  const [bx0, bz0, bx1, bz1] = lay.box
  const ys = []
  for (let x = bx0; x <= bx1; x++) for (let z = bz0; z <= bz1; z++) {
    if (!zoneOk(x, z)) return { ok: false, why: 'zone' }
    const r = blocked(x, z)
    if (r) return { ok: false, why: `box:${r}` }
    const c = col(x, z)
    if (c.why === 'unknown') return { ok: false, why: 'unknown' }
    if (c.why) return { ok: false, why: `box:${c.why}` }
    ys.push(c.y)
  }
  // THE BED'S LEVEL (cropfarm-02fix, LIVE showcase 11-04: 30/30 visits no_site -- offline on the region copy, no 9 x 9 of the
  // town's graded ground is flat to the block): L is the median ground; a column one ABOVE is CUT to L (its ground block dug, a
  // listed `cut` clear: what is under it must be the soil a crop needs), a WALKWAY column one BELOW gets a FLOOR fill at L (dirt;
  // a crop column below L is refused: a fill cannot be tilled in the same cell). Anything further off refuses the site.
  ys.sort((a, b) => a - b)
  const L = ys[ys.length >> 1]
  const isCrop = new Set(lay.crops.map(p => k2(p.x, p.z)))
  const clear = [], floor = []
  let canopy = 0
  for (let x = bx0; x <= bx1; x++) for (let z = bz0; z <= bz1; z++) {
    const c = col(x, z)
    if (Math.abs(c.y - L) > 1) return { ok: false, why: 'level' }
    const crop = isCrop.has(k2(x, z))
    // HEAD ROOM (LIVE 11-04: 860 of 3,292 candidates `cover`, the farms zone under a spruce canopy): nothing but plants up to
    // L + CROP.headroom (the crop, a builder's body on the walkway); a canopy higher up is shade, priced, never a refusal
    if (c.above.some(a => a.kind !== 'plant' && a.y <= L + CROP.headroom)) return { ok: false, why: 'cover' }
    if (c.above.some(a => a.kind !== 'plant')) canopy++
    if (c.y === L + 1) {
      if (!CUTTABLE.test(c.name ?? '')) return { ok: false, why: 'cut' }
      clear.push({ at: [x, L + 1, z], kind: 'cut', name: c.name })
      if (crop && !TILLABLE.test(nm(read(x, L, z)))) return { ok: false, why: 'soil' }
    } else if (c.y === L - 1) {
      if (crop) return { ok: false, why: 'dip' }
      floor.push([x, L, z])
    } else if (crop && !TILLABLE.test(c.name ?? '')) return { ok: false, why: 'soil' }
    // a plant on a crop cell (or on a cut's top) is overburden runVisit digs first (listed); a two-high plant's upper half too
    if (crop || c.y === L + 1) for (const a of c.above) if (a.kind === 'plant' && a.y >= L + 1 && a.y <= L + 3) clear.push({ at: [x, a.y, z], kind: 'plant', name: a.name })
  }
  if (clear.filter(q => q.kind === 'cut').length + floor.length > CROP.earthMax) return { ok: false, why: 'earth' }
  // HYDRATION: crop cells with still water within hydrateR at L or L + 1 (outside the box: the box holds no water)
  const R = CROP.hydrateR
  let hydrated = 0
  const wet = new Map()
  const wetAt = (x, z) => { const k = k2(x, z); if (!wet.has(k)) wet.set(k, !!(water(x, L, z) || water(x, L + 1, z))); return wet.get(k) }
  for (const p of lay.crops) {
    let h = false
    for (let dx = -R; dx <= R && !h; dx++) for (let dz = -R; dz <= R && !h; dz++) if (wetAt(p.x + dx, p.z + dz)) h = true
    if (h) hydrated++
  }
  const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2
  const d = Math.hypot(cx - home.x, cz - home.z)
  if (d > CROP.rMax) return { ok: false, why: 'far' }
  const earth = clear.filter(q => q.kind === 'cut').length + floor.length
  const cost = d * 0.5 - hydrated * 2 + clear.length * 0.05 + canopy * 0.5 + earth * 0.3
  return { ok: true, why: null, L, crops: lay.crops, walk: lay.walk, clear, floor, hydrated, canopy, box: lay.box, orient, rows, len, cost }
}

/**
 * THE SITING -> { ok, why, record, tried, zone }. Pure over `read`.
 *   home       the plan's home
 *   blocked    (x, z) -> reason | null (the tree farm's farmBlocked composition: the plan, zones, wells, the composter, every other
 *              project's record columns and siting zones, the park, the corridors)
 *   zone       (x, z) -> the land plan's zone kind (landplan.mjs zoneAt) | null = the town has no land plan
 *   water      (x, y, z) -> bool
 * Two passes: first only columns in the land plan's `farms` zone, then (none fits there) the town ring (`town`); with no land plan,
 * one pass over any column. Within a pass every first-crop column and both orientations whose box lies at least rMin from home
 * at its nearest; the cheapest fit wins (distance, then hydration), ties by the scan order (deterministic).
 */
export function siteCropFarm (read, { home, blocked = () => null, zone = null, water = () => false, yHi = null, yLo = null, grids = CROP.grids } = {}) {
  if (!home || typeof read !== 'function') return { ok: false, why: 'no_home', record: null, tried: 0 }
  const hi = yHi ?? Math.floor(home.y) + 16, lo = yLo ?? Math.floor(home.y) - 16
  const cache = new Map()
  const col = (x, z) => { const k = k2(x, z); let c = cache.get(k); if (!c) { c = pathColumn(read, x, z, { yHi: hi, yLo: lo }); cache.set(k, c) } return c }
  const bcache = new Map()
  const blk = (x, z) => { const k = k2(x, z); if (!bcache.has(k)) bcache.set(k, blocked(x, z) ?? null); return bcache.get(k) }
  const zcache = new Map()
  const zk = (x, z) => { const k = k2(x, z); if (!zcache.has(k)) zcache.set(k, zone(x, z) ?? null); return zcache.get(k) }
  const passes = typeof zone === 'function' ? [['farms'], ['town']] : [null]
  const R = CROP.rMax
  const why = {}
  let tried = 0
  // the biggest bed first; for each size the farms zone, then the town ring (a smaller bed in the farms zone never loses to a bigger
  // one in the town: sizes outer, passes inner)
  for (const [rows, len] of grids) for (const kinds of passes) {
    let best = null
    const zoneOk = kinds ? (x, z) => kinds.includes(zk(x, z)) : () => true
    for (const orient of ['x', 'z']) {
      for (let x0 = Math.floor(home.x) - R; x0 <= Math.floor(home.x) + R; x0++) {
        for (let z0 = Math.floor(home.z) - R; z0 <= Math.floor(home.z) + R; z0++) {
          const box = bedLayout(x0, z0, orient, { rows, len }).box
          const nx = Math.max(box[0], Math.min(home.x, box[2])), nz = Math.max(box[1], Math.min(home.z, box[3]))
          if (Math.max(Math.abs(nx - home.x), Math.abs(nz - home.z)) < CROP.rMin) continue
          if (Math.hypot((box[0] + box[2]) / 2 - home.x, (box[1] + box[3]) / 2 - home.z) > R) continue
          // the zone of the box's four corners first: most candidates leave here without a column read
          if (kinds && ![[box[0], box[1]], [box[2], box[3]], [box[0], box[3]], [box[2], box[1]]].every(([x, z]) => zoneOk(x, z))) continue
          tried++
          const f = fitBed(read, { x0, z0, orient, home, col, blocked: blk, zoneOk, water, rows, len })
          if (!f.ok) { const w = String(f.why).split(':')[0]; why[w] = (why[w] ?? 0) + 1; continue }
          if (!best || f.cost < best.f.cost - 1e-9) best = { f, x0, z0 }
        }
      }
    }
    if (best) return { ok: true, why: null, tried, zone: kinds ? kinds[0] : null, record: cropRecord(best, { home }) }
  }
  const top = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(' ')
  return { ok: false, why: `no fit (${tried} tried: ${top || '-'})`, tried, record: null }
}

/** THE FRONT: the walkway column nearest home (the paths' destination). Pure. */
const frontOf = (walk, home) => walk.slice().sort((a, b) => Math.hypot(a[0] - home.x, a[1] - home.z) - Math.hypot(b[0] - home.x, b[1] - home.z) || a[0] - b[0] || a[1] - b[1]).slice(0, 2)

/** THE RECORD from a fit. Pure. One segment per row: its till cells (L) and its crop cells (L + 1, built after the till below). */
export function cropRecord ({ f, x0, z0 }, { home }) {
  const cells = [], segments = []
  // THE FLOOR (cropfarm-02fix): the walkway fills, their own segment first (a stand needs its floor)
  if (f.floor?.length) { segments.push({ seg: 'F', deps: [] }); for (const a of f.floor) cells.push({ at: a, role: 'floor', seg: 'F' }) }
  for (let r = 0; r < (f.rows ?? CROP.rows); r++) {
    const seg = `R-${r + 1}`
    const row = f.crops.filter(p => p.row === r)
    if (!row.length) continue
    segments.push({ seg, deps: [] })
    for (const p of row) cells.push({ at: [p.x, f.L, p.z], role: 'till', seg })
    for (const p of row) cells.push({ at: [p.x, f.L + 1, p.z], role: 'wheat', seg })
  }
  return {
    v: 1, blueprint: CROPFARM_BLUEPRINT, plot: CROPFARM_PLOT, home: { x: home.x, y: home.y, z: home.z },
    anchor: [x0, z0], orient: f.orient, grid: [f.rows ?? CROP.rows, f.len ?? CROP.len], box: f.box, level: f.L, cells, segments, clear: f.clear, replant: [],
    walk: f.walk.map(([x, z]) => [x, f.L + 1, z]),
    front: frontOf(f.walk, home),
    counts: { crops: f.crops.length, hydrated: f.hydrated, clear: f.clear.length, cut: f.clear.filter(q => q.kind === 'cut').length, floor: f.floor?.length ?? 0 },
    bom: { wheat_seeds: f.crops.length, ...(f.floor?.length ? { dirt: f.floor.length } : {}) },
    builders_max: CROPFARM_BUILDERS,
  }
}
/** The bed's CUTS still standing (a listed cut whose cell still holds the block it was listed with): the farm is not complete
 *  until they are dug (the tree farm's rule: runVisit may end `complete` past an unreachable clear). Pure. */
export const cropCutsLeft = (read, rec) => (rec?.clear ?? []).filter(c => c.kind === 'cut' && nm(read(...c.at)) === c.name)

// ---- the farm, read ---------------------------------------------------------------------------------------------------------

export const cropCells = rec => (rec?.cells ?? []).filter(c => c.role === 'wheat')
export const tillCells = rec => (rec?.cells ?? []).filter(c => c.role === 'till')
/**
 * WHAT A CROP CELL IS NOW -> 'mature' | 'growing' | 'open' | 'till_lost' | 'blocked' | 'unknown'. Pure. `read` answers
 * { name, age? } (the age from the block's properties).
 *   mature    a crop at its mature age (the harvest's)
 *   growing   a crop below it
 *   open      air (or a plant runVisit digs) over farmland: seeds go in
 *   till_lost the ground below is no longer farmland (trampled, dried out): the till cell is open again
 */
export function cropState (read, cell) {
  const [x, y, z] = cell.at
  const b = read(x, y, z), s = read(x, y - 1, z)
  if (!b || !s) return 'unknown'
  const n = nm(b)
  if (CROP_BLOCKS.has(n)) { const a = ageOf(b); return a != null && a >= MATURE_AGE[n] ? 'mature' : 'growing' }
  if (nm(s) !== 'farmland') return 'till_lost'
  if (AIRN(n) || CROP_FOREIGN.test(n)) return 'open'
  return 'blocked'
}
/** The crops' census -> { mature, growing, open, ... }. Pure. */
export function cropCensus (read, rec) {
  const out = {}
  for (const c of cropCells(rec)) { const s = cropState(read, c); out[s] = (out[s] ?? 0) + 1 }
  return out
}
/** THE HARVEST -> the mature crop cells, at most `max`, nearest `from` first (ties x, z). Pure. */
export function harvestCells (read, rec, { max = CROP.harvestMax, from = null } = {}) {
  const f = from ?? [rec?.home?.x ?? 0, 0, rec?.home?.z ?? 0]
  return cropCells(rec).filter(c => cropState(read, c) === 'mature')
    .sort((a, b) => Math.hypot(a.at[0] - f[0], a.at[2] - f[2]) - Math.hypot(b.at[0] - f[0], b.at[2] - f[2]) || a.at[0] - b.at[0] || a.at[2] - b.at[2])
    .slice(0, Math.max(0, max))
}
/** The walkway stand beside a crop cell -> [x, y, z] (feet) | null: the record's walkway cell 4-adjacent to it (the row's sides
 *  first, then its ends). Pure. */
export function cropStand (rec, cell) {
  const walk = new Set((rec?.walk ?? []).map(w => w.join(',')))
  const [x, y, z] = cell.at
  const side = rec?.orient === 'z' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[0, 1], [0, -1], [1, 0], [-1, 0]]
  for (const [dx, dz] of side) { const s = [x + dx, y, z + dz]; if (walk.has(s.join(','))) return s }
  return null
}
/** Seeds the bag needs for the open crop cells -> n (0 when it holds enough). Pure. */
export function seedNeed (read, rec, held = 0) {
  const open = cropCells(rec).filter(c => { const s = cropState(read, c); return s === 'open' || s === 'till_lost' }).length
  return Math.max(0, open - (Number(held) || 0))
}
/** The seeds a bag keeps after a visit -> n: one full planting + seedSpare (the rest is banked). Pure. */
export const seedKeep = rec => cropCells(rec).length + CROP.seedSpare
/**
 * IS THE FARM DUE A VISIT? -> 'harvest' | 'replant' | 'seed' | null. Pure. A mature crop (while the town's wheat is under its cap and
 * the bag has room); an open / lost cell while there are seeds to plant it (`seeds`: the bag's and the town's); an open cell with no
 * seed anywhere while this bot's seed gather is out of its back-off (`gatherOk`: a bounded retry, at most once per
 * CROP.gatherBackoffMs a bot -- Codex r1 BLOCKER 2: a farm completed over a gather that found nothing must not stay empty for
 * good). Otherwise quiet (a till with nothing to plant would only dry back to dirt).
 */
export function cropDue (read, rec, { seeds = 0, townWheat = 0, freeSlots = 36, gatherOk = false } = {}) {
  if ((Number(townWheat) || 0) < CROP.wheatTownCap && freeSlots >= CROP.minFree && harvestCells(read, rec, { max: 1 }).length) return 'harvest'
  const open = seedNeed(read, rec, 0) > 0
  if ((Number(seeds) || 0) > 0 && open) return 'replant'
  if (gatherOk && open) return 'seed'
  return null
}
/** A crop cell or a till cell the visit passes over now (`noSeed`: no seed to plant it) -> bool. A till cell under a crop is done
 *  (the farmland is there); a till cell whose crop cell cannot be planted is passed (never tilled for nothing). Pure. */
export function cropAlsoDone (cell, read, { noSeed = false } = {}) {
  if (cell?.role === 'till') {
    const up = read(cell.at[0], cell.at[1] + 1, cell.at[2])
    if (up && CROP_BLOCKS.has(nm(up))) return true
    return !!noSeed
  }
  if (cell?.role === 'wheat') return !!noSeed && !CROP_BLOCKS.has(nm(read(...cell.at)))
  return false
}

// ---- the seed gather --------------------------------------------------------------------------------------------------------

/**
 * THE SEED GATHER'S TARGETS -> [{ at, name }]: grass plants (SEED_GRASS) within `r` of the farm's box (Chebyshev), on soil, never a
 * reserved cell (`reserved(x, y, z)` -> truthy: a zone, another project's record cell or box, the park, a road), a two-high plant
 * at its lower half; nearest `from` first, at most `max`. A grass plant on the farm's OWN crop cell is allowed (it is the till's
 * overburden). Pure.
 */
export function seedGrassTargets (cands, { read, box, reserved = () => null, from = null, r = CROP.gatherR, max = CROP.gatherMax } = {}) {
  if (!Array.isArray(box) || box.length !== 4) return []
  const f = from ?? [(box[0] + box[2]) / 2, 0, (box[1] + box[3]) / 2]
  const out = [], seen = new Set()
  const dist = ([x, , z]) => Math.max(box[0] - x, x - box[2], 0, box[1] - z, z - box[3])
  const order = (cands ?? []).filter(c => Array.isArray(c?.at)).slice()
    .sort((a, b) => Math.hypot(a.at[0] - f[0], a.at[2] - f[2]) - Math.hypot(b.at[0] - f[0], b.at[2] - f[2]) || a.at[0] - b.at[0] || a.at[2] - b.at[2] || a.at[1] - b.at[1])
  for (const c of order) {
    if (out.length >= max) break
    if (dist(c.at) > r) continue
    let [x, y, z] = c.at
    const here = nm(read(x, y, z))
    if (!SEED_GRASS.test(here)) continue
    if (nm(read(x, y - 1, z)) === here) y--                                     // a tall plant: its lower half
    if (!/^(grass_block|dirt|podzol|coarse_dirt|rooted_dirt|moss_block|mud|farmland)$/.test(nm(read(x, y - 1, z)))) continue
    const k = `${x},${y},${z}`
    if (seen.has(k)) continue
    if (reserved(x, y, z) || (/^(tall_grass|large_fern)$/.test(here) && reserved(x, y + 1, z))) continue
    seen.add(k)
    out.push({ at: [x, y, z], name: here })
  }
  return out
}

// ---- the rows ---------------------------------------------------------------------------------------------------------------

/** The `_build op=harvest` row's fields (shop.mjs buildRowDetail takes them). */
export const harvestRow = ({ cell, block, n = null, why = null }) => ({ project: CROPFARM_PLOT, op: 'harvest', cell, block, kind: 'crop', ...(n != null ? { n } : {}), ...(why ? { why } : {}) })
/** The `_build op=clear kind=seedgrass` row's fields. */
export const seedRow = ({ cell, block }) => ({ project: CROPFARM_PLOT, op: 'clear', cell, block, kind: 'seedgrass' })
