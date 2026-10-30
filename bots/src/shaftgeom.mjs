// THE TOWN STAIR (shaft-02; docs/reports/mineshaft-2026-10-30/design.md, both engines converged r2). PURE: the geometry, the
// siting survey, the record, what a step needs next, whether a landing is usable, and the keep-out part. Nothing here touches
// a bot or a file; skills.mjs supplies reads and effects (shaftvisit.mjs runs the visit on them).
//
// SHAPE: a 3x3 spiral round a solid central pillar, one full block down per step, eight steps a turn. Step k stands on
// perimeter cell P[(s0 + k) mod 8]: its TREAD is at y = g - k, its three AIR cells at g-k+1 .. g-k+3 (feet, head, the jump's
// head room). Only those three cells are dug per step; the rest of the 3x3 stays rock, so the walk is the pathfinder's ordinary
// drop-down and jump-up between face-neighbour cells, a drop never more than 1 inside, and a bot that steps in from the surface
// falls at most 3 and walks out. LANDINGS (feet 48, 32, 16) all sit on cell (1,2), the middle of the side away from home (16 is
// a multiple of 8), each with a STUB: 4 cells out (v = 3..6), 2 high, whose end face (v = 7) is NOT reserved -- mine, the iron
// gather and the ore tunnel dig on from there. LINING: every face neighbour of an air cell that is neither air nor tread, at or
// below ground (g); above ground is open by design.
//
// FRAME (from shaft-01's shaftplan.mjs): local (u, v), +v pointing AWAY from home; toWorld/toLocal are rotations.

export const SHAFT_BLUEPRINT = 'shaft@2'
export const SHAFT_PLOT = 'shaft'
export const STAIR_BOTTOM_FEET = 16             // the peak of 1.21's iron band (measured: 3.2 raw iron per skill-hour at 16-31)
export const LANDING_FEET = Object.freeze([48, 32, 16])
export const LANDING_MIN_DEPTH = 8              // a landing's feet at least this far below the ground
export const MIN_STEPS = 16                     // a stair shorter than this (a town below y=31) is not sited
export const STUB = Object.freeze({ v0: 3, v1: 6, h: 2 })
export const LANDING_CELL = 5                   // PERIM index of (1,2)
export const PERIM = Object.freeze([[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]])
export const PILLAR = Object.freeze([1, 1])
/** Siting: the stair's centre at Chebyshev RING.min..RING.max from home; every cell of the 5x5 and the stubs at >= OUTSIDE. */
export const RING = Object.freeze({ min: 19, max: 26 })
export const OUTSIDE = 17                       // the town's ground square is 16 (townground.mjs); mine's home refusal is 12
export const SITE_GAP = 2                       // clear of other records' zones, the plan's cells, wells and the farm by this
export const TORCH_EVERY = 8                    // a wall torch on the pillar, one a turn (never required)

// ---- frame --------------------------------------------------------------------------------------------------------------

/** Local (u, v) -> world (x, z) for an orientation: away = 'n'|'s'|'e'|'w' (the +v direction). Pure. */
export function toWorld (origin, away, u, v) {
  switch (away) {
    case 's': return { x: origin.x + u, z: origin.z + v }
    case 'n': return { x: origin.x - u, z: origin.z - v }
    case 'e': return { x: origin.x + v, z: origin.z - u }
    case 'w': return { x: origin.x - v, z: origin.z + u }
  }
  throw new Error(`bad orientation ${away}`)
}
/** World (x, z) -> local (u, v), the inverse of toWorld. Pure. */
export function toLocal (origin, away, x, z) {
  const dx = x - origin.x, dz = z - origin.z
  const n = (u, v) => ({ u: u || 0, v: v || 0 })
  switch (away) {
    case 's': return n(dx, dz)
    case 'n': return n(-dx, -dz)
    case 'e': return n(-dz, dx)
    case 'w': return n(dz, -dx)
  }
  throw new Error(`bad orientation ${away}`)
}
/** The direction from home to (x, z), as the +v of a site there. Pure. */
export function awayFrom (home, x, z) {
  const dx = x - home.x, dz = z - home.z
  return Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 'e' : 'w') : (dz >= 0 ? 's' : 'n')
}
/** The origin (local 0,0) of a stair whose pillar is at world (cx, cz). Pure. */
export function originFor (cx, cz, away) {
  const p = toWorld({ x: 0, z: 0 }, away, PILLAR[0], PILLAR[1])
  return { x: cx - p.x, z: cz - p.z }
}

// ---- block predicates (shaft-01's, kept) --------------------------------------------------------------------------------

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const WET = /^(water|flowing_water|lava|flowing_lava|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|.*concrete_powder|pointed_dripstone|anvil|chipped_anvil|damaged_anvil|scaffolding)$/
const NOT_LINING = /^(ladder|.*_leaves|.*_log|.*_wood|.*_stem|.*_hyphae|chest|trapped_chest|barrel|furnace|blast_furnace|smoker|crafting_table|.*_shulker_box|spawner|ice|packed_ice|blue_ice|frosted_ice|tnt|.*_bed|.*_door|.*_trapdoor|glass|.*_glass|.*_stained_glass)$/
/** Liquid, a bubble column, a water plant, or any waterlogged block. Pure. */
export const isWet = b => !!b && (WET.test(nm(b)) || b.props?.waterlogged === true || b.props?.waterlogged === 'true')
export const isLava = b => !!b && /lava/.test(nm(b))
export const isFalling = b => !!b && FALLING.test(nm(b))
/** A cell a body passes: empty collision and dry. Pure. */
export const isOpen = b => !!b && b.boundingBox === 'empty' && !isWet(b)
/** A full solid cube (the trunk's reads carry boundingBox only; a `full: false` read is a partial block). Pure. */
export const isFull = b => !!b && b.boundingBox === 'block' && b.full !== false && !isWet(b)
/**
 * GOOD LINING OR TREAD: a full cube, not liquid, not a container, log, leaf, ice or glass; a falling block only while the cell
 * under it is a full solid that is NOT planned air (shaft-02: a falling ceiling over a step drops into it the moment the step is
 * dug). Pure. `below` the read under the cell; `belowAir` whether that cell is one of the stair's air cells.
 */
export function goodSolid (b, below = null, belowAir = false) {
  if (!isFull(b) || NOT_LINING.test(nm(b))) return false
  if (isFalling(b)) return !belowAir && isFull(below)
  return true
}
/** The blocks the builder lines with, best first (never dirt, gravel or sand: dirt is a gather target, the others fall). */
export const LINING_ITEMS = Object.freeze(['cobblestone', 'cobbled_deepslate', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'deepslate', 'blackstone', 'netherrack'])

// ---- the plan -----------------------------------------------------------------------------------------------------------

const k3 = (x, y, z) => `${x},${y},${z}`
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]

/** The step count for ground g (bottom feet STAIR_BOTTOM_FEET) and the phase that puts every landing on (1,2). Pure. */
export function stairShape (g) {
  const K = g - (STAIR_BOTTOM_FEET - 1)
  const s0 = (((LANDING_CELL - K) % 8) + 8) % 8
  const landings = LANDING_FEET.filter(f => f <= g - LANDING_MIN_DEPTH).map(f => ({ feet: f, k: g - f + 1 })).filter(l => l.k >= 0 && l.k <= K)
  return { K, s0, landings }
}

/**
 * THE STAIR'S CELLS -> { K, s0, g, steps, landings, cells, byKey, air, box }. Pure. `site` = { origin, away, g } (+ `K` and
 * `landings` [feet] to plan a truncated stair: a stop's record). steps[k] = { k, uv, tread, air: [3 cells], lining: [cells] }
 * (world [x,y,z]); landings = [{ feet, k, stub: [[x,y,z]], lining, end }] (end: the unreserved face, surveyed only).
 * cells = [{ at, role: 'air'|'tread'|'lining', k }] -- k the first step (or landing step) whose work needs the cell.
 */
export function planStair (site) {
  const { origin, away, g } = site
  const shape = stairShape(g)
  const K = Number.isInteger(site.K) ? Math.min(site.K, shape.K) : shape.K
  const s0 = shape.s0
  const keepFeet = Array.isArray(site.landings) ? new Set(site.landings) : null
  const W = (u, y, v) => { const w = toWorld(origin, away, u, v); return [w.x, y, w.z] }
  const air = new Map(), tread = new Map()
  const steps = []
  for (let k = 0; k <= K; k++) {
    const [u, v] = PERIM[(s0 + k) % 8]
    const t = W(u, g - k, v)
    const a = [1, 2, 3].map(d => W(u, g - k + d, v))
    tread.set(k3(...t), k)
    for (const c of a) if (!air.has(k3(...c))) air.set(k3(...c), k)
    steps.push({ k, uv: [u, v], tread: t, air: a, lining: [] })
  }
  const landings = []
  for (const l of shape.landings) {
    if (l.k > K || (keepFeet && !keepFeet.has(l.feet))) continue
    const stub = [], cols = []
    for (let v = STUB.v0; v <= STUB.v1; v++) {
      const col = []
      for (let h = 0; h < STUB.h; h++) col.push(W(1, l.feet + h, v))
      cols.push({ v, air: col, lining: [], end: [] })
      stub.push(...col)
    }
    for (const c of stub) if (!air.has(k3(...c))) air.set(k3(...c), l.k)
    const end = [0, 1].map(h => W(1, l.feet + h, STUB.v1 + 1))
    cols[cols.length - 1].end = end
    landings.push({ feet: l.feet, k: l.k, stub, cols, lining: [], end })
  }
  const endFaces = new Set(landings.flatMap(l => l.end.map(c => k3(...c))))
  const lining = new Map()
  const addLining = (c, k) => { const key = k3(...c); if (!lining.has(key) || lining.get(key) > k) lining.set(key, k) }
  const owner = new Map()   // air key -> step index or 'L<k>' for a stub cell
  for (const s of steps) for (const c of s.air) owner.set(k3(...c), s.k)
  for (const l of landings) for (const col of l.cols) for (const c of col.air) owner.set(k3(...c), `L${l.k}:${col.v}`)
  const linOf = new Map()   // owner -> lining cells
  for (const [key, own] of owner) {
    const [x, y, z] = key.split(',').map(Number)
    for (const [dx, dy, dz] of N6) {
      const n = [x + dx, y + dy, z + dz], nk = k3(...n)
      if (air.has(nk) || tread.has(nk) || n[1] > g || endFaces.has(nk)) continue
      const kk = typeof own === 'number' ? own : Number(own.slice(1).split(':')[0])
      addLining(n, kk)
      if (!linOf.has(own)) linOf.set(own, new Map())
      linOf.get(own).set(nk, n)
    }
  }
  for (const s of steps) s.lining = [...(linOf.get(s.k)?.values() ?? [])]
  for (const l of landings) {
    for (const col of l.cols) col.lining = [...(linOf.get(`L${l.k}:${col.v}`)?.values() ?? [])]
    l.lining = [...new Map(l.cols.flatMap(col => col.lining.map(c => [k3(...c), c]))).values()]
  }
  const cells = []
  for (const [key, k] of air) cells.push({ at: key.split(',').map(Number), role: 'air', k })
  for (const [key, k] of tread) cells.push({ at: key.split(',').map(Number), role: 'tread', k })
  for (const [key, k] of lining) cells.push({ at: key.split(',').map(Number), role: 'lining', k })
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const c of cells) { x0 = Math.min(x0, c.at[0]); x1 = Math.max(x1, c.at[0]); z0 = Math.min(z0, c.at[2]); z1 = Math.max(z1, c.at[2]); y0 = Math.min(y0, c.at[1]); y1 = Math.max(y1, c.at[1]) }
  const byKey = new Map(cells.map(c => [k3(...c.at), c]))
  return { K, s0, g, origin, away, steps, landings, cells, byKey, air, box: { x0, x1, y0, y1, z0, z1 } }
}

/** The stand of step k (feet cell). Pure. */
export const standOf = (plan, k) => { const t = plan.steps[k].tread; return [t[0], t[1] + 1, t[2]] }
/** A landing's stub-end stand (the cell a miner arrives on and mines on from). Pure. */
export const stubEnd = l => l.stub[l.stub.length - 2]   // (1, feet, v1): the stub's last column, feet level

// ---- what is done, what a step needs ----------------------------------------------------------------------------------

/** -> 'open' | 'blocked' | 'wet' | 'unknown' for an air cell. Pure. */
function airState (read, at) {
  const b = read(...at)
  if (!b) return 'unknown'
  if (isWet(b)) return 'wet'
  return b.boundingBox === 'empty' ? 'open' : 'blocked'
}
/** Is a lining or tread cell good as it stands? -> true | false | null (unknown). Pure. */
function solidState (read, plan, at) {
  const b = read(...at)
  if (!b) return null
  const below = read(at[0], at[1] - 1, at[2])
  return goodSolid(b, below, plan.air.has(k3(at[0], at[1] - 1, at[2])))
}
/** Step k (its air open and dry, its tread and lining good)? -> true | false | null (an unknown read). Pure. */
export function stepDone (read, plan, k) {
  const s = plan.steps[k]
  for (const c of s.air) { const st = airState(read, c); if (st === 'unknown') return null; if (st !== 'open') return false }
  for (const c of [s.tread, ...s.lining]) { const st = solidState(read, plan, c); if (st == null) return null; if (!st) return false }
  return true
}
/** One stub column (its 2 cells open, its lining good)? -> true | false | null. Pure. */
export function colDone (read, plan, col) {
  for (const c of col.air) { const st = airState(read, c); if (st === 'unknown') return null; if (st !== 'open') return false }
  for (const c of col.lining) { const st = solidState(read, plan, c); if (st == null) return null; if (!st) return false }
  return true
}
/** A landing's whole stub? -> true | false | null. Pure. */
export function stubDone (read, plan, l) {
  for (const col of l.cols) { const d = colDone(read, plan, col); if (d !== true) return d }
  return true
}
/**
 * THE FIRST THING NOT DONE, top down -> { kind: 'step', k } | { kind: 'stub', k, landing } | { kind: 'unknown', k } | null (all
 * done). Pure. Repairs are the same scan: a damaged step above the frontier is found first.
 */
export function firstUndone (read, plan) {
  const lAt = new Map(plan.landings.map(l => [l.k, l]))
  for (let k = 0; k <= plan.K; k++) {
    const d = stepDone(read, plan, k)
    if (d == null) return { kind: 'unknown', k }
    if (!d) return { kind: 'step', k }
    const l = lAt.get(k)
    if (l) {
      for (let i = 0; i < l.cols.length; i++) {
        const sd = colDone(read, plan, l.cols[i])
        if (sd == null) return { kind: 'unknown', k }
        if (!sd) return { kind: 'stub', k, landing: l, col: i }
      }
    }
  }
  return null
}

/**
 * THE NEXT MUTATION FOR A UNIT OF WORK (a step or a stub column set) -> { op: 'stop', why, at } | { op: 'wait', at } |
 * { op: 'place', at } | { op: 'dig', at, then? } | { op: 'done' }. Pure over read(x,y,z) -> {name, boundingBox, props?} | null.
 * THE ORDER IS THE SAFETY (shaft-01 T8/T9, kept): survey first (a liquid in an AIR or TREAD cell stops the stair above it;
 * an unknown read waits), then every lining cell made good (a liquid one sealed by a placement; a bad solid dug and then
 * placed), then the tread, then the air cells TOP DOWN -- so no cell is opened next to anything but good lining.
 *   cells   { air: [...], tread: cell|null, lining: [...], end: [...] (surveyed: a liquid end face is sealed, never reserved) }
 *   standing  the bot's feet cell (never dug, nor the cell under it)
 */
export function nextOp (read, plan, cells, standing = null) {
  const { air = [], tread = null, lining = [], end = [] } = cells
  // 1. SURVEY: the cells that will be opened (and the tread they stand on) must not be liquid
  for (const c of [...air, ...(tread ? [tread] : [])]) {
    const b = read(...c)
    if (!b) return { op: 'wait', at: c }
    if (isWet(b)) return { op: 'stop', why: isLava(b) ? 'lava' : 'water', at: c }
  }
  // 1b. EVERY FACE NEIGHBOUR of a cell about to open: a liquid there is sealed first, whatever its role -- a LATER step's air
  // cell beside this step's is not this step's lining, and water in it would pour in the moment this step opens (found by the
  // truncation test, 10-30). A sealed later cell is dug again at its own step, which surveys what is behind it.
  const own = new Set(air.map(c => k3(...c)))
  for (const c of air) {
    for (const [dx, dy, dz] of N6) {
      const n = [c[0] + dx, c[1] + dy, c[2] + dz]
      if (own.has(k3(...n))) continue
      const b = read(...n)
      if (!b) return { op: 'wait', at: n }
      if (isWet(b)) return { op: 'place', at: n, why: 'seal' }
    }
  }
  // 2. LINING (and a liquid end face): good, or made good
  for (const c of [...lining, ...end]) {
    const b = read(...c)
    if (!b) return { op: 'wait', at: c }
    const isEnd = end.some(e => e[0] === c[0] && e[1] === c[1] && e[2] === c[2])
    if (isEnd) { if (isWet(b)) return { op: 'place', at: c, why: 'seal' }; continue }
    const below = read(c[0], c[1] - 1, c[2])
    if (goodSolid(b, below, plan.air.has(k3(c[0], c[1] - 1, c[2])))) continue
    if (b.boundingBox === 'empty' || isWet(b) || replaceable(b)) return { op: 'place', at: c, why: isWet(b) ? 'seal' : 'line' }
    return { op: 'dig', at: c, then: 'place', why: 'bad_lining' }
  }
  // 3. THE TREAD
  if (tread) {
    const b = read(...tread)
    const below = read(tread[0], tread[1] - 1, tread[2])
    if (!goodSolid(b, below, plan.air.has(k3(tread[0], tread[1] - 1, tread[2])))) {
      if (b.boundingBox === 'empty' || replaceable(b)) return { op: 'place', at: tread, why: 'tread' }
      return { op: 'dig', at: tread, then: 'place', why: 'bad_tread' }
    }
  }
  // 4. THE AIR CELLS, top down (never the bot's own cells)
  const sorted = [...air].sort((a, b) => b[1] - a[1])
  for (const c of sorted) {
    const b = read(...c)
    if (b.boundingBox === 'empty') continue
    if (standing && c[0] === standing[0] && c[2] === standing[2] && (c[1] === standing[1] || c[1] === standing[1] + 1 || c[1] === standing[1] - 1)) return { op: 'stop', why: 'own_cell', at: c }
    return { op: 'dig', at: c, why: 'air' }
  }
  return { op: 'done' }
}
/** Plants, snow layers and the like a placement replaces. Pure. */
export const replaceable = b => /^(short_grass|grass|tall_grass|fern|large_fern|dead_bush|snow|vine|glow_lichen|.*_carpet|leaf_litter|short_dry_grass|tall_dry_grass|bush|firefly_bush|wildflowers|pink_petals|.*_tulip|dandelion|poppy|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|torch|wall_torch|cave_air|air|void_air)$/.test(nm(b))

/** The work cells of a unit: a step's, or a landing stub's next column (2 cells at v) with its lining. Pure. */
export function unitCells (plan, work) {
  if (work.kind === 'step') { const s = plan.steps[work.k]; return { air: s.air, tread: s.tread, lining: s.lining, end: [] } }
  const col = work.landing.cols[work.col]
  return { air: col.air, tread: null, lining: col.lining, end: col.end }
}
/** Where the bot stands for a unit: step k-1's stand (step 0: the collar exit); a stub column: the column before it (the first:
 *  the landing step's stand). Pure. */
export function standFor (plan, work, exit) {
  if (work.kind === 'step') return work.k === 0 ? exit : standOf(plan, work.k - 1)
  return work.col === 0 ? standOf(plan, work.k) : work.landing.cols[work.col - 1].air[0]
}

// ---- siting -------------------------------------------------------------------------------------------------------------

/** Candidate pillar columns at Chebyshev RING from home, in `sector` (townplan sectorOf) when given, nearest first. Pure. */
export function siteCandidates (home, { sectorOf = null, sector = null, ring = RING } = {}) {
  const out = []
  for (let dx = -ring.max; dx <= ring.max; dx++) for (let dz = -ring.max; dz <= ring.max; dz++) {
    const d = Math.max(Math.abs(dx), Math.abs(dz))
    if (d < ring.min || d > ring.max) continue
    const x = home.x + dx, z = home.z + dz
    if (sector && sectorOf && sectorOf(home, x, z) !== sector) continue
    out.push({ x, z, away: awayFrom(home, x, z), d: Math.hypot(dx, dz) })
  }
  return out.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z)
}
/** The collar exit: a standable surface cell beside the 5x5 on the home side (then the sides), or null. Pure. */
export function collarExit (read, site) {
  const { origin, away, g } = site
  for (const [u, v] of [[1, -2], [0, -2], [2, -2], [-2, 1], [4, 1], [-2, 0], [4, 0]]) {
    const w = toWorld(origin, away, u, v)
    for (const y of [g + 1, g, g + 2]) {
      const fl = read(w.x, y - 1, w.z), f = read(w.x, y, w.z), h = read(w.x, y + 1, w.z)
      if (isFull(fl) && isOpen(f) && isOpen(h)) return [w.x, y, w.z]
    }
  }
  return null
}
/** The ground top at (x, z): the highest full non-leaf non-log block from yHi down to yLo, or null (unknown). Pure. */
export function groundTop (read, x, z, yHi, yLo) {
  for (let y = yHi; y >= yLo; y--) {
    const b = read(x, y, z)
    if (!b) return null
    if (isWet(b)) return { y, wet: true }
    if (isFull(b) && !/_leaves$|_log$|_wood$/.test(nm(b))) return { y, wet: false }
  }
  return null
}
/**
 * SURVEY ONE SITE -> { ok, why, site, stopK, landings, lining, digs, exit }. Pure over read. The 5x5 ground within g-2..g+1
 * of the pillar's, dry; nothing above ground to g+4 but air and plants over the 3x3; then the steps top down: the first air or
 * tread cell that is liquid sets stopK (landings below it are dropped); an unknown read is `unknown` (ask again later).
 * `forbid(x, z)` -> true for a column the stair must not take (zones, records, plan cells, wells, farm, the town square).
 */
export function surveySite (read, home, cand, { forbid = () => false } = {}) {
  const away = cand.away
  const origin = originFor(cand.x, cand.z, away)
  const gt = groundTop(read, cand.x, cand.z, home.y + 12, home.y - 16)
  if (!gt) return { ok: false, why: 'unknown' }
  if (gt.wet) return { ok: false, why: 'wet' }
  const g = gt.y
  const shape = stairShape(g)
  if (shape.K < MIN_STEPS || !shape.landings.length) return { ok: false, why: 'too_low' }
  // the 5x5 and the stub columns: outside the town square, not forbidden, ground near g and dry
  const cols = []
  for (let u = -1; u <= 3; u++) for (let v = -1; v <= 3; v++) cols.push([u, v])
  for (let v = STUB.v0; v <= STUB.v1 + 1; v++) for (const u of [0, 1, 2]) cols.push([u, v])
  for (const [u, v] of cols) {
    const w = toWorld(origin, away, u, v)
    if (Math.max(Math.abs(w.x - home.x), Math.abs(w.z - home.z)) < OUTSIDE) return { ok: false, why: 'town' }
    if (forbid(w.x, w.z)) return { ok: false, why: 'reserved' }
    if (v > 3) continue
    const t = groundTop(read, w.x, w.z, g + 4, g - 6)
    if (!t) return { ok: false, why: 'unknown' }
    if (t.wet) return { ok: false, why: 'wet' }
    if (t.y < g - 2 || t.y > g + 1) return { ok: false, why: 'uneven' }
  }
  const site = { origin, away, g, center: [cand.x, cand.z] }
  const plan = planStair(site)
  let stopK = null, lining = 0, digs = 0
  // a liquid in a cell beside an EARLIER step's air is sealed while that step is built (nextOp 1b), so it stops nothing
  const sealedEarlier = (c, k) => N6.some(([dx, dy, dz]) => { const o = plan.air.get(k3(c[0] + dx, c[1] + dy, c[2] + dz)); return o != null && o < k })
  for (let k = 0; k <= plan.K && stopK == null; k++) {
    const s = plan.steps[k]
    for (const c of [...s.air, s.tread]) {
      const b = read(...c)
      if (!b) return { ok: false, why: 'unknown' }
      if (isWet(b)) { if (sealedEarlier(c, k)) { lining++; continue } stopK = k; break }
      if (s.air.includes(c) && b.boundingBox !== 'empty') digs++
    }
    if (stopK != null) break
    for (const c of s.lining) { const b = read(...c); if (!b) return { ok: false, why: 'unknown' }; if (!goodSolid(b, read(c[0], c[1] - 1, c[2]), plan.air.has(k3(c[0], c[1] - 1, c[2])))) lining++ }
  }
  const landings = plan.landings.filter(l => stopK == null || l.k < stopK).map(l => l.feet)
  if (!landings.length) return { ok: false, why: 'no_landing', stopK }
  const exit = collarExit(read, site)
  if (!exit) return { ok: false, why: 'no_exit' }
  return { ok: true, why: null, site, stopK, landings, lining, digs, exit, K: stopK == null ? plan.K : stopK - 1 }
}
/** The better of two surveys: deeper bottom, then fewer lining placements, then the nearer. Pure. */
export function betterSurvey (a, b) {
  if (!a?.ok) return b
  if (!b?.ok) return a
  const da = Math.min(...a.landings), db = Math.min(...b.landings)
  if (da !== db) return da < db ? a : b
  if (a.lining !== b.lining) return a.lining < b.lining ? a : b
  return a
}

// ---- the record ---------------------------------------------------------------------------------------------------------

/** A new record from a survey. Pure. */
export function stairRecord (sv, { home, now = 0, by = '?' } = {}) {
  const site = { origin: sv.site.origin, away: sv.site.away, g: sv.site.g, center: sv.site.center }
  const plan = planStair({ ...site, K: sv.K, landings: sv.landings })
  return {
    v: 1, blueprint: SHAFT_BLUEPRINT, plot: SHAFT_PLOT, home: { ...home }, site, K: plan.K, landings: plan.landings.map(l => l.feet),
    landings_built: [], exit: sv.exit, state: 'open', structure_complete: false, sitedAt: now, sitedBy: by,
    cells: plan.cells.map(c => ({ at: c.at, role: c.role })), box: [plan.box.x0, plan.box.z0, plan.box.x1, plan.box.z1],
    survey: { lining: sv.lining, digs: sv.digs, stopK: sv.stopK },
  }
}
/** The no-site record (Claude design r1 B1): complete, no cells, re-sited after retryAt. Pure. */
export const NO_SITE_RETRY_MS = 24 * 60 * 60_000
export function noSiteRecord ({ home, now = 0, by = '?', why = '' } = {}) {
  return { v: 1, blueprint: SHAFT_BLUEPRINT, plot: SHAFT_PLOT, home: { ...home }, state: 'no_site', structure_complete: true, completeAt: now,
    retryAt: now + NO_SITE_RETRY_MS, why: String(why).slice(0, 120), cells: [], landings: [], landings_built: [], sitedBy: by }
}
/** A stop at step k (Claude design r1 B2): the stair ends at step k-1; cells and landings below it are dropped. Pure. */
export function truncatedRecord (rec, stopK, { now = 0, why = 'liquid' } = {}) {
  const K = Math.max(0, stopK - 1)
  const keep = (rec.landings ?? []).filter(f => (rec.site.g - f + 1) <= K)
  const plan = planStair({ ...rec.site, K, landings: keep })
  return { ...rec, K: plan.K, landings: plan.landings.map(l => l.feet), landings_built: (rec.landings_built ?? []).filter(f => keep.includes(f)),
    cells: plan.cells.map(c => ({ at: c.at, role: c.role })), box: [plan.box.x0, plan.box.z0, plan.box.x1, plan.box.z1], stoppedAt: now, stopWhy: why, stopK }
}
/** A landing whose stub met a liquid is dropped (the steps go on below it). Pure. */
export function droppedLandingRecord (rec, feet, { now = 0, why = 'liquid' } = {}) {
  const keep = (rec.landings ?? []).filter(f => f !== feet)
  const plan = planStair({ ...rec.site, K: rec.K, landings: keep })
  return { ...rec, landings: plan.landings.map(l => l.feet), landings_built: (rec.landings_built ?? []).filter(f => keep.includes(f)),
    cells: plan.cells.map(c => ({ at: c.at, role: c.role })), box: [plan.box.x0, plan.box.z0, plan.box.x1, plan.box.z1],
    dropped: [...(rec.dropped ?? []), { feet, why, at: now }] }
}
/** The plan a record describes. Pure. */
export const planOf = rec => planStair({ ...rec.site, K: rec.K, landings: rec.landings })
/** Is a record a real stair (sited, with cells)? Pure. */
export const isStairRecord = rec => rec?.blueprint === SHAFT_BLUEPRINT && rec.state !== 'no_site' && !!rec.site && Number.isInteger(rec.K)

/** A stair record DAMAGED or (a no-site record past its retry) DUE? Pure over read. */
export function stairDamaged (read, rec) {
  if (!isStairRecord(rec) || !rec.structure_complete) return false
  const w = firstUndone(read, planOf(rec))
  return !!w && w.kind !== 'unknown'
}
export const stairDue = (rec, now = Date.now()) => rec?.blueprint === SHAFT_BLUEPRINT && rec.state === 'no_site' && now >= (rec.retryAt ?? Infinity)

// ---- use ----------------------------------------------------------------------------------------------------------------

/**
 * IS A LANDING USABLE NOW? -> { ok, why }. Pure over read. Every step from 0 to the landing's step reads walkable (air open and
 * dry, tread good) and the stub open: the route is verified at the start of each walk (Codex design r1: admission to a route
 * verified when the walk starts, not a promise that nothing breaks it mid-walk).
 */
export function landingUsable (read, rec, feet) {
  if (!isStairRecord(rec) || !(rec.landings_built ?? []).includes(feet)) return { ok: false, why: 'not_built' }
  const plan = planOf(rec)
  const l = plan.landings.find(q => q.feet === feet)
  if (!l) return { ok: false, why: 'no_landing' }
  for (let k = 0; k <= l.k; k++) {
    const s = plan.steps[k]
    for (const c of s.air) { const st = airState(read, c); if (st !== 'open') return { ok: false, why: `step${k}:${st}` } }
    const t = s.tread, b = read(...t)
    if (!b) return { ok: false, why: `step${k}:unknown` }
    if (!goodSolid(b, read(t[0], t[1] - 1, t[2]), false)) return { ok: false, why: `step${k}:tread` }
  }
  for (const c of l.stub) { const st = airState(read, c); if (st !== 'open') return { ok: false, why: `stub:${st}` } }
  return { ok: true, why: null, stand: stubEnd(l), landing: l }
}
/**
 * WHICH LANDING FOR A DESCENT -> feet | null. Pure. A real descent only (goalY at least DESCENT_MIN below the bot); landings at
 * least 4 below the bot; the deepest with feet >= goalY, else the deepest there is.
 */
export const DESCENT_MIN = 8
export const NEAR_STAIR = 64
export function chooseLanding (built = [], botY, goalY) {
  if (!Number.isFinite(botY) || !Number.isFinite(goalY) || goalY > botY - DESCENT_MIN) return null
  const below = built.filter(f => f <= botY - 4).sort((a, b) => a - b)
  if (!below.length) return null
  const atOrAbove = below.filter(f => f >= goalY)
  return atOrAbove.length ? atOrAbove[0] : below[0]
}
/** Is (x, z) within NEAR_STAIR (Chebyshev) of the stair's pillar? Pure. */
export const nearStair = (rec, x, z, r = NEAR_STAIR) => isStairRecord(rec) && Math.max(Math.abs(x - rec.site.center[0]), Math.abs(z - rec.site.center[1])) <= r
/**
 * IS THE BOT ROOFED (underground)? -> bool. Pure. A full solid in its column between its head and `top` (the stair's ground + 2):
 * the surface hop is for a bot under rock, never one standing in the open on a hill (design r2, both engines).
 */
export function roofed (read, feet, top) {
  for (let y = feet[1] + 2; y <= top; y++) { const b = read(feet[0], y, feet[2]); if (b && b.boundingBox === 'block') return true }
  return false
}

// ---- protection ---------------------------------------------------------------------------------------------------------

/**
 * THE STAIR AS ONE PART OF MINE'S COMPOSED KEEP-OUT (minewell.mjs composeKeepOut's shape) -> { forbid(cell) -> 'stair' | null,
 * bottom }. Pure. A bounding-box early-out and numeric keys (Claude design r1: the part is asked for every simulated stair cell
 * of every candidate start). No stair: { forbid: null, bottom: null }.
 */
export function stairKeepOut (rec) {
  if (!isStairRecord(rec) || !Array.isArray(rec.cells) || !rec.cells.length) return { forbid: null, bottom: null }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const c of rec.cells) { const [x, y, z] = c.at; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z }
  const W = x1 - x0 + 1, D = z1 - z0 + 1
  const set = new Set(rec.cells.map(c => ((c.at[1] - y0) * D + (c.at[2] - z0)) * W + (c.at[0] - x0)))
  return {
    forbid: c => {
      if (!c || c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1 || c.z < z0 || c.z > z1) return null
      return set.has(((c.y - y0) * D + (c.z - z0)) * W + (c.x - x0)) ? 'stair' : null
    },
    bottom: y0,
  }
}
/** The record's cell keys "x,y,z" (gather's target exclusion, the footprint). Pure. */
export const stairCellKeys = rec => (isStairRecord(rec) ? (rec.cells ?? []).map(c => k3(...c.at)) : [])

// ---- rows ---------------------------------------------------------------------------------------------------------------

/** The `_shaft` row's detail (the read's defect lines key on op=). Pure. */
export function shaftRowDetail ({ op = '-', k = '-', at = null, why = '-', feet = '-', gen = '-', n = '-', ms = '-', built = '-' } = {}) {
  return `op=${op} k=${k} at=${Array.isArray(at) ? at.join(',') : '-'} why=${why} feet=${feet} gen=${gen} n=${n} ms=${ms} built=${built}`.slice(0, 300)
}
/** The `_shaft_use` row's detail. Pure. */
export function shaftUseDetail ({ dir = '-', ok = false, why = '-', landing = '-', from = '-', to = '-', ms = '-', goal = '-' } = {}) {
  return `dir=${dir} ok=${ok ? 1 : 0} why=${why} landing=${landing} from=${from} to=${to} goal=${goal} ms=${ms}`.slice(0, 300)
}
