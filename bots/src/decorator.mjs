// DECORATOR-01: ONE BOT A TOWN MAKES IT BEAUTIFUL (OWNER 11-04: "along with a grounds keeper, could we use one bot to maybe just be a
// 'decorator' sole purpose is to make things more beautiful. add flowers along paths, add decorations to buildings, unique and pretty
// things around our town first, then expand out"). Design: docs/reports/decorator-design-2026-11-04.md (Claude + Codex, reconciled).
//
// THE MODEL. A fifth TOWN SINK (sinks.mjs SINK_KINDS 'decor', plot `decor`, blueprint `decor@1`, letter D) worked by ONE bot a town:
// the `decorator` LEASE on the decor record's key (groundskeeper.mjs keeperDecision with DECOR's term and rest: one holder, renewed by
// every visit, released when there is no work or the term is over). The holder works the decor FIRST (behind repairs only); every other
// bot never sees the decor plot. Each INSTANCE is a small seeded BATCH of ORNAMENTS dressing what the town already built:
//   border   a flower (or a fern) on the soil beside a laid path -- runs of up to DECOR.runMax, the town's walls first, then outward rings
//   pot      a flower pot on the ground two columns beside a building's door, against its wall, filled with a flower or a spare sapling
// Every cell is a record cell (the tripwire judges every placement), the zones are each ornament's own column, the flowers are built by
// the ordinary sink visit (buildrun.mjs runVisit) and a pot's FILL is the decor visit's upkeep (an empty pot is placed, `due` until
// filled: skills.mjs decorPotFill).
//
// THE FLOWER SUPPLY (measured 11-04 on the showcase: 0 flowers in 15 bags and 9 town chests, 44 wild flowers within 160 of home, most in
// a protected village; bone meal 8 in town, the composter made 9 in 7 days). The decorator's NURSERY: a grass patch the land around it
// keeps clear (no record cell, no reservation within NURSERY.spread of its centre: bone meal's random walk never leaves grass, and never
// goes further), bone meal on its centre (Java GrassBlock: ~2.8 flowers + ~20 short grass a meal on open grass, simulated), the flowers
// that grew HARVESTED (`_build op=clear kind=bloom`), the short grass round the centre cleared so the next meal has room. Its centre and
// box are on the decor record (`nursery`), so the read judges every meal and every harvest against them.
//
// PURE: the switch, the names, the candidates, the pattern, the pots, the nursery, the instance, the gate, the order. Nothing here
// touches a bot or a file.

import { fnv1a, rng } from './zigdesign.mjs'
import { stepFor, overlay, walkFrom } from './buildsite.mjs'
import { isLiquid, replaceableCell, rot } from './townplan.mjs'
import { pathColumns, cellGuard } from './towndress.mjs'
import { SMALL_FLOWERS } from './park.mjs'

const k2 = (x, z) => `${x},${z}`
const kOf = a => `${a[0]},${a[1]},${a[2]}`
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[2] - b[2]))
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]

export const DECOR_KIND = 'decor'
export const DECOR_LEASE = 'decorator'
export const DECOR = Object.freeze({
  leaseTtlMs: 30 * 60_000,   // the lease lapses this long after its last renewal (a decorator that left town lets it go)
  termMs: 4 * 60 * 60_000,   // a holder's term; then it rests restMs (a town's bots take turns)
  restMs: 60 * 60_000,
  takeEveryMs: 5 * 60_000,   // a bot asks for a free lease at most this often
  cooldownMs: 2 * 60_000,    // the holder's order returns this often (the keeper's)
  batchMax: 16,              // ornaments an instance
  plantsMin: 4,              // a border batch needs at least this many plants in the bag
  runMax: 8,                 // a border run's length before the next run starts nearest home
  potsMax: 2,                // pots an instance
  stepMax: 1,                // a border's ground within this of the path beside it (the 1-block step rule)
  instancesMax: 40,
  saplingKeep: 16,           // a pot takes a sapling only above this many of its species (composter.mjs SAPLING_RESERVE)
  potFillMax: 4,             // pot fills a visit
})
export const NURSERY = Object.freeze({
  spread: 7,                 // bone meal's walk never goes further (Java GrassBlock: 128 tries, at most i/16 = 7 steps of one column)
  core: 4,                   // the landing cells counted for the quality (~all the flowers fall within 4: simulated)
  coreMin: 30,               // landing cells (grass with air above) within core a nursery needs (of 81)
  searchR: 64,               // the search's reach from home
  minR: 6,                   // never closer to home than this (the plaza)
  dy: 4,                     // a column's grass read within this of the centre's (the walk climbs or drops one a step)
  clearR: 2,                 // the short grass dug round the centre before a meal
  mealKeep: 4,               // the town's bone meal kept for the park's meadow (Codex design: reserve four)
  mealMax: 3,                // meals a visit
  harvestMax: 24,            // digs a visit (blooms + grass)
  flowersPerMeal: 2.8,       // the expected flowers a meal (the pressure's estimate only)
})

/** THE SWITCH -> bool. DECORATOR=on|off; unset = on in the pools DECORATOR_POOLS names (default 'showcase'). Off: no decor plot is
 *  offered and no lease taken; a sited batch's cells stay guarded (sinks.mjs: every sink plot is guarded whatever the switch). Pure. */
export function decorOn (env = process.env, pool = '') {
  const v = String(env?.DECORATOR ?? '').trim().toLowerCase()
  if (v === 'on' || v === '1' || v === 'true') return true
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  const pools = String(env?.DECORATOR_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}

// ---- the plants -------------------------------------------------------------------------------------------------------------------
/** What a border cell takes: every small flower, then a fern (a taiga town's own green). Never a sapling (it grows into the path),
 *  never a sweet berry bush, a cactus or a vine (owner 11-03). */
export const BORDER_PLANTS = Object.freeze([...SMALL_FLOWERS, 'fern'])
const SAPLINGS = Object.freeze(['spruce_sapling', 'oak_sapling', 'birch_sapling', 'cherry_sapling', 'acacia_sapling', 'jungle_sapling', 'dark_oak_sapling'])
/** What a pot takes (vanilla FlowerPotBlock's pottables we carry), flowers first. */
export const POT_PLANTS = Object.freeze([...SMALL_FLOWERS, 'fern', 'azalea', 'flowering_azalea', ...SAPLINGS])
/** The potted block a plant makes. Pure. */
export const pottedOf = item => (item === 'azalea' ? 'potted_azalea_bush' : item === 'flowering_azalea' ? 'potted_flowering_azalea_bush' : `potted_${item}`)
export const POTTED = Object.freeze(POT_PLANTS.map(pottedOf))
/** The blocks the nursery's harvest digs: a flower that grew, the grass a meal leaves. */
export const BLOOM_BLOCKS = Object.freeze([...SMALL_FLOWERS, 'short_grass', 'tall_grass'])
const BLOOM_SET = new Set(BLOOM_BLOCKS), FLOWER_SET = new Set(SMALL_FLOWERS)
/** A border palette rotation per colour scheme (buildrun.mjs blockFor takes a role's first HELD name, cellDone any of them). */
const SCHEMES = Object.freeze({
  mixed: SMALL_FLOWERS,
  warm: ['poppy', 'red_tulip', 'orange_tulip', 'dandelion', 'pink_tulip', 'allium', 'oxeye_daisy', 'white_tulip', 'azure_bluet', 'cornflower', 'blue_orchid', 'lily_of_the_valley'],
  cool: ['cornflower', 'blue_orchid', 'azure_bluet', 'allium', 'lily_of_the_valley', 'white_tulip', 'oxeye_daisy', 'pink_tulip', 'poppy', 'dandelion', 'red_tulip', 'orange_tulip'],
  sun: ['dandelion', 'oxeye_daisy', 'orange_tulip', 'white_tulip', 'poppy', 'azure_bluet', 'red_tulip', 'pink_tulip', 'cornflower', 'allium', 'blue_orchid', 'lily_of_the_valley'],
})
const rotList = (list, i) => list.slice(i % list.length).concat(list.slice(0, i % list.length))
/** The bag's border plants -> n (every BORDER_PLANTS name held). Pure. */
export const borderPlantsOf = (held = {}) => BORDER_PLANTS.reduce((s, n) => s + Math.max(0, Number(held?.[n]) || 0), 0)
/**
 * THE PLANT A POT TAKES FROM THIS BAG -> item | null. Pure. A flower first (the seed picks which, so neighbouring pots differ) -- only
 * from the flowers above `flowerKeep` (what the record's open border cells still need) -- then a
 * fern or an azalea, then a sapling only above DECOR.saplingKeep of its species (the tree planters' reserve stays whole).
 */
export function potPlantFor (held = {}, seed = 0, flowerKeep = 0) {
  const have = n => (Number(held?.[n]) || 0) > 0
  // Codex r1 BLOCKER 2: the flowers an open border still needs (`flowerKeep`) are the border's, never a pot's
  // Codex r2: every BORDER plant counts (a fern too), and none is a pot's until the border's are covered
  const spare = borderPlantsOf(held) > flowerKeep
  const fl = spare ? SMALL_FLOWERS.filter(have) : []
  if (fl.length) return fl[Math.abs(seed) % fl.length]
  for (const n of [...(spare ? ['fern'] : []), 'flowering_azalea', 'azalea']) if (have(n)) return n
  const sp = SAPLINGS.filter(n => (Number(held?.[n]) || 0) > DECOR.saplingKeep)
  return sp.length ? sp[Math.abs(seed) % sp.length] : null
}

// ---- the seeded design ----------------------------------------------------------------------------------------------------------------
/**
 * A BATCH'S DESIGN from its seed -> { pattern, n, phase, scheme, run }. Pure. `pattern` solid (every column), alt (every other), sparse
 * (every third) -- along a straight path the parity of x + z steps once a column, so alt and sparse read as a rhythm -- the colour
 * scheme's rotation, and the run length. Variety by seed: never the same everywhere.
 */
export function decorDesign (seed) {
  const r = rng(seed >>> 0)
  const pattern = ['solid', 'alt', 'alt', 'sparse'][Math.floor(r() * 4) % 4]
  const n = pattern === 'solid' ? 1 : pattern === 'alt' ? 2 : 3
  const scheme = Object.keys(SCHEMES)[Math.floor(r() * 4) % 4]
  const run = 4 + Math.floor(r() * (DECOR.runMax - 3))
  return { pattern, n, phase: Math.floor(r() * n) % n, scheme, run }
}
/** Does a column keep its flower under the design's pattern? Pure. */
export const patternKeeps = (design, x, z) => (((x + z) % design.n) + design.n) % design.n === design.phase

// ---- the border ------------------------------------------------------------------------------------------------------------------------
export const BORDER_SOIL = /^(grass_block|dirt|podzol|coarse_dirt|rooted_dirt|moss_block|mycelium)$/
const openCell = b => !!b && !isLiquid(b) && !/waterlogged/.test(String(b.name ?? '')) && (AIRN(nm(b)) || (replaceableCell(b) && !/^snow$/.test(nm(b)) && !FLOWER_SET.has(nm(b))))
const wetAt = (read, x, y, z) => {
  for (const [dx, dz] of [[0, 0], ...SIDES]) for (let dy = -1; dy <= 1; dy++) { const b = read(x + dx, y + dy, z + dz); if (b && (isLiquid(b) || /waterlogged/.test(String(b.name ?? '')))) return true }
  return false
}
/**
 * A BORDER CELL BESIDE PATH COLUMN p -> { at, ground } | { why }. Pure. The side column s is no path column, no record's column, not in
 * front of a door (cellGuard: +-2), not reserved; its ground is soil within DECOR.stepMax of the path's surface; the cell above the soil
 * is open (air, or short grass a placement replaces -- never a snow layer or a flower already there) and is no record cell; nothing wet
 * beside it (a flowing source washes a flower away).
 */
export function borderAt (read, p, s, { pathCols, guard, reserved = () => null }) {
  const ks = k2(s[0], s[1])
  if (pathCols.has(ks)) return { why: 'path' }
  if (guard.cols.has(ks)) return { why: 'record' }
  if (guard.doors.has(ks)) return { why: 'door' }
  const why = reserved(s[0], s[1])
  if (why) return { why: `reserved:${String(why).slice(0, 24)}` }
  for (let g = p.y + DECOR.stepMax; g >= p.y - DECOR.stepMax; g--) {
    const f = read(s[0], g, s[1]), a = read(s[0], g + 1, s[1]), h = read(s[0], g + 2, s[1])
    if (!f || !a || !h) return { why: 'unread' }
    if (!BORDER_SOIL.test(nm(f))) continue
    if (!openCell(a)) return { why: 'occupied' }
    if (!(AIRN(nm(h)) || replaceableCell(h))) return { why: 'covered' }
    const at = [s[0], g + 1, s[1]]
    if (guard.cells.has(kOf(at)) || guard.cells.has(kOf([s[0], g + 2, s[1]]))) return { why: 'record_cell' }
    if (wetAt(read, ...at)) return { why: 'wet' }
    return { at, ground: [s[0], g, s[1]] }
  }
  return { why: 'no_soil' }
}
/**
 * THE BORDER CANDIDATES -> [{ at, ground, d, inside }] one per side column, the town's walls first (`inside(x, z)`), then by ring
 * (Chebyshev from home). Pure. `paths` the laid paths' record (towndress.mjs pathColumns: each column's surface).
 */
export function borderCandidates (read, paths, home, { guard, reserved = () => null, inside = () => false }) {
  const pathCols = pathColumns(paths)
  const out = [], seen = new Set()
  for (const p of pathCols.values()) for (const [dx, dz] of SIDES) {
    const s = [p.x + dx, p.z + dz]
    const ks = k2(s[0], s[1])
    if (seen.has(ks)) continue
    seen.add(ks)
    const r = borderAt(read, p, s, { pathCols, guard, reserved })
    if (r.why) continue
    out.push({ at: r.at, ground: r.ground, d: Math.max(Math.abs(s[0] - home.x), Math.abs(s[1] - home.z)), inside: !!inside(s[0], s[1]) })
  }
  return out.sort((a, b) => (b.inside - a.inside) || a.d - b.d || a.at[0] - b.at[0] || a.at[2] - b.at[2])
}
/**
 * PICK THE BORDER RUNS -> [cand]. Pure. Under the design's pattern only; a run starts at the first candidate left (the walls first,
 * nearest home) and grows by the nearest candidate within 2 columns of its newest cell, up to `design.run`; then the next run. At most
 * `max` cells; `ok(c)` the proof.
 */
export function pickBorder (cands, { design, max = DECOR.batchMax, ok = () => true } = {}) {
  const left = cands.filter(c => patternKeeps(design, c.at[0], c.at[2]))
  const used = new Set(), out = []
  const take = c => { used.add(kOf(c.at)); if (ok(c)) { out.push(c); return true } return false }
  while (out.length < max) {
    const start = left.find(c => !used.has(kOf(c.at)))
    if (!start) break
    if (!take(start)) continue
    let last = start, n = 1
    while (n < design.run && out.length < max) {
      let best = null, bd = Infinity
      for (const c of left) { if (used.has(kOf(c.at))) continue; const d = cheb(c.at, last.at); if (d <= Math.max(2, design.n) && d < bd) { best = c; bd = d } }
      if (!best) break
      if (take(best)) { last = best; n++ }
    }
  }
  return out
}

// ---- the pots by the doors ----------------------------------------------------------------------------------------------------------------
/** The plots whose doorways take pots (buildings, never the wall's gates, a farm or a sink). */
export const POT_PLOTS = Object.freeze(new Set(['shop', 'house1', 'storehouse', 'hall', 'storehub', 'enchantshop']))
const solidFull = b => !!b && b.boundingBox === 'block' && !isLiquid(b)
/**
 * A BUILDING'S DOORWAY -> { cells: [[x, y, z]], out: [dx, dz], t: [dx, dz] } | null. Pure. A blueprint record: the blueprint's
 * `doorway` cells (their lowest y: the feet) placed like its cells (anchor, s, orient: buildsite.mjs placeBlueprint's rule), the
 * outward side its local v < 0 (the front: buildsite.mjs's doorway faces the front), t along the facade (its local u). The storehouse
 * (no blueprint): its `door` and its `front` column.
 */
export function doorwayOf (rec, bp = null) {
  if (!rec) return null
  if (Array.isArray(rec.door) && Array.isArray(rec.front?.[0])) {
    const [dx, dz] = [Math.sign(rec.front[0][0] - rec.door[0]), Math.sign(rec.front[0][1] - rec.door[2])]
    if (Math.abs(dx) + Math.abs(dz) !== 1) return null
    return { cells: [rec.door.slice()], out: [dx, dz], t: [dz, dx] }
  }
  if (!Array.isArray(bp?.doorway) || !bp.doorway.length || !Array.isArray(rec.anchor) || !Number.isFinite(rec.s) || !rec.orient) return null
  const y0 = Math.min(...bp.doorway.map(c => c[2]))
  const cells = bp.doorway.filter(c => c[2] === y0).map(([u, v, y]) => { const { dx, dz } = rot(rec.orient, u, v); return [rec.anchor[0] + dx, rec.s + y, rec.anchor[1] + dz] })
  const o = rot(rec.orient, 0, -1), t = rot(rec.orient, 1, 0)
  return { cells, out: [o.dx, o.dz], t: [t.dx, t.dz] }
}
/**
 * THE POT SPOTS OF A BUILDING -> [{ at, door, front, wall, plot }]. Pure. Beside the doorway (`dw`: doorwayOf), one column out from
 * the facade (the apron the doorway's step stands on), two columns past each end of the doorway -- one column clear between a pot
 * and the way in, never the way in itself -- at the doorway's feet height (or one up, on the ledge of a raised step row), on a full block, with
 * the building's own record cell behind it (it hugs the wall); a finished building only. Never a record cell (any project's, the cell or the one above), never
 * another project's column, a path column or a reservation (the building's own apron columns are its own: no reservation is read
 * there); the doorway's front stays open (the proof checks it is still walked to).
 */
export function potSpots (read, plot, rec, dw, { pathCols, guard, reserved = () => null }) {
  if (!POT_PLOTS.has(plot) || !rec?.structure_complete || !dw?.cells?.length) return []
  const ownCols = new Set((rec.cells ?? []).filter(c => Array.isArray(c?.at)).map(c => k2(c.at[0], c.at[2])))
  const ownCells = new Set((rec.cells ?? []).filter(c => Array.isArray(c?.at)).map(c => kOf(c.at)))
  const [nx, nz] = dw.out, [tx, tz] = dw.t
  const along = c => c[0] * tx + c[2] * tz
  const ends = dw.cells.slice().sort((a, b) => along(a) - along(b))
  const lo = ends[0], hi = ends[ends.length - 1]
  const mid = ends[Math.floor(ends.length / 2)]
  const front = [mid[0] + nx, mid[1], mid[2] + nz]
  const out = []
  for (const [e, s] of [[lo, -2], [hi, 2]]) {
    const ka = k2(e[0] + nx + s * tx, e[2] + nz + s * tz)
    const own = ownCols.has(ka)
    if (pathCols.has(ka)) continue
    const rz = reserved(e[0] + nx + s * tx, e[2] + nz + s * tz)
    if (!own && (guard.cols.has(ka) || rz)) continue
    // the showcase atlas+decorator fold (Codex fold r2 BLOCKER): a HOLD (the wall demolition's `hold:walldemo`) refuses even the
    // building's own apron column -- its own reservation does not
    if (own && /^hold:/.test(String(rz ?? ''))) continue
    // the doorway's feet height, or one up: a blueprint's front row is a raised STEP beside the way in (the pot stands on its ledge)
    for (const dy of [0, 1]) {
      const at = [e[0] + nx + s * tx, e[1] + dy, e[2] + nz + s * tz]
      const wall = [e[0] + s * tx, e[1] + dy, e[2] + s * tz]
      if (guard.cells.has(kOf(at)) || guard.cells.has(kOf([at[0], at[1] + 1, at[2]]))) continue
      if (!ownCells.has(kOf(wall))) continue
      // one up only ON the building's own step (its record cell): never on a block someone left beside the door
      if (dy === 1 && !ownCells.has(kOf([at[0], at[1] - 1, at[2]]))) continue
      if (!openCell(read(...at)) || !openCell(read(at[0], at[1] + 1, at[2])) || !solidFull(read(at[0], at[1] - 1, at[2]))) continue
      if (wetAt(read, ...at)) break
      out.push({ at, door: mid, front, wall, plot })
      break
    }
  }
  return out
}

// ---- the proof -----------------------------------------------------------------------------------------------------------------------------
const SOLID = name => Object.freeze({ name, boundingBox: 'block' })
const EMPTY = name => Object.freeze({ name, boundingBox: 'empty' })
/** The town walk's nodes by column (buildsite.mjs walkFrom over `read` from home and `stood`). Pure. */
export function decorNodes (read, home, { stood = [], walkR = 64 } = {}) {
  const m = new Map()
  for (const k of walkFrom(read, home, new Set(), walkR, { stood })) { const [x, y, z] = k.split(',').map(Number); const c = k2(x, z); if (!m.has(c)) m.set(c, []); m.get(c).push(y) }
  return m
}
/**
 * THE BATCH'S PROOF -> { ok, cells, why }. Pure. Every ornament has a STEP (buildsite.mjs stepFor: a support below or beside it the
 * builder clicks, the eye in reach on its open side, a clear sight line) from a town walk stand; the pots go in first (solid) and the
 * walk is read again over them: every door front the batch's pots sit by is still a walk node (a pot never shuts a door). An ornament
 * with no step is dropped (`cells` the provable ones); a pot that would shut its door drops the pot.
 */
export function proveDecor (read, home, { border = [], pots = [], stood = [], walkR = 64 } = {}) {
  const nodes = decorNodes(read, home, { stood, walkR })
  const dom = c => (x, z) => Math.abs(x - c[0]) <= 6 && Math.abs(z - c[2]) <= 6
  const over = new Map()
  const okPots = []
  for (const p of pots) if (stepFor(overlay(read, over), home, p.at, nodes, dom(p.at))) { okPots.push(p); over.set(kOf(p.at), SOLID('flower_pot')) }
  // the walk over the pots: each pot's door front still a node
  const R = overlay(read, over)
  const after = okPots.length ? decorNodes(R, home, { stood, walkR }) : nodes
  const pots2 = okPots.filter(p => (after.get(k2(p.front[0], p.front[2])) ?? []).includes(p.front[1]))
  const over2 = new Map(pots2.map(p => [kOf(p.at), SOLID('flower_pot')]))
  const R2 = overlay(read, over2)
  const nodes2 = pots2.length ? decorNodes(R2, home, { stood, walkR }) : nodes
  const okBorder = []
  for (const c of border) if (stepFor(R2, home, c.at, nodes2, dom(c.at))) { okBorder.push(c); over2.set(kOf(c.at), EMPTY('poppy')) }
  return { ok: okBorder.length + pots2.length > 0, border: okBorder, pots: pots2, why: okBorder.length + pots2.length ? 'ok' : 'no_step' }
}

// ---- the instance ----------------------------------------------------------------------------------------------------------------------------
/**
 * A BATCH AS AN INSTANCE -> { cells, segments, palette, counts, clear, zones, cols, pots, box }. Pure. The border cells in runs, each run
 * one segment (`D3-B0` ...; three runs, three builders), their roles `D3-f0`..`D3-f3` the scheme's rotation (neighbours differ); the
 * pots one segment `D3-P` (role `D3-pot`: a flower_pot; its fill is the visit's upkeep). Zones: each ornament's own column.
 */
export function decorInstance (id, { border = [], pots = [], design }) {
  const list = SCHEMES[design?.scheme] ?? SCHEMES.mixed
  const roles = {}
  for (let k = 0; k < 4; k++) roles[`${id}-f${k}`] = [...rotList(list, k * 3), 'fern']
  roles[`${id}-pot`] = ['flower_pot']
  const cells = [], segments = [], zones = [], cols = []
  let run = -1, prev = null
  border.forEach((c, i) => {
    if (!prev || cheb(prev.at, c.at) > Math.max(2, design?.n ?? 1)) { run++; segments.push({ seg: `${id}-B${run}`, deps: [] }) }
    cells.push({ at: c.at.slice(), role: `${id}-f${i % 4}`, seg: `${id}-B${run}` })
    prev = c
  })
  if (pots.length) segments.push({ seg: `${id}-P`, deps: [] })
  for (const p of pots) cells.push({ at: p.at.slice(), role: `${id}-pot`, seg: `${id}-P` })
  for (const c of cells) { zones.push({ box: [c.at[0], -64, c.at[2], c.at[0], 320, c.at[2]], why: `project:decor:${id}` }); cols.push([c.at[0], c.at[2]]) }
  const xs = cells.map(c => c.at[0]), zs = cells.map(c => c.at[2])
  const counts = cells.reduce((m, c) => (m[c.role] = (m[c.role] ?? 0) + 1, m), {})
  return { cells, segments, palette: roles, counts, clear: [], zones, cols, pots: pots.map(p => ({ at: p.at, door: p.door, plot: p.plot })),
    box: cells.length ? [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] : null }
}
/** Is a role a decor pot (`D3-pot`)? a decor border flower (`D3-f2`)? Pure. */
export const decorPotRole = role => /^D\d+-pot$/.test(String(role ?? ''))
export const decorFlowerRole = role => /^D\d+-f\d$/.test(String(role ?? ''))
/** The summary for the sited row: `b12/p2/alt:warm`. Pure. */
export const decorSummary = (border, pots, design) => `b${border.length}/p${pots.length}/${design.pattern}:${design.scheme}`

/**
 * SITE THE NEXT DECOR BATCH -> { ok, inst, meta, tried } | { ok: false, why, tried }. Pure over `read`. ctx:
 *   id, n, home, seed, records [{ plot, rec }] (every OTHER project's head record: the paths, the buildings, the cell guard),
 *   doorOf({ plot, rec }) -> doorwayOf's answer (the caller loads the blueprint),
 *   rec (the decor record so far), plants (the bag's border plants), pots (flower pots the bag and the town hold),
 *   reserved(x, z), inside(x, z) (the town's walls), stood, walkR.
 */
export function siteDecor (read, ctx = {}) {
  const { id, n = 1, home, seed = 0, records = [], rec = null, plants = 0, pots: potN = 0, reserved = () => null, inside = () => false, stood = [] } = ctx
  const tried = []
  const byPlot = new Map(records.filter(r => r?.rec).map(r => [r.plot, r.rec]))
  const paths = byPlot.get('paths') ?? null
  if (!paths) return { ok: false, why: 'no_paths', tried }
  const recs = [...records.map(r => r.rec).filter(Boolean), ...(rec ? [rec] : [])]
  const guard = cellGuard(recs)
  const design = decorDesign(seed)
  const pathCols = pathColumns(paths)
  const wantB = plants >= DECOR.plantsMin ? Math.min(DECOR.batchMax, plants) : 0
  const cands = wantB ? borderCandidates(read, paths, home, { guard, reserved, inside }) : []
  const potted = new Set((rec?.instances ?? []).flatMap(i => (i.pots ?? []).map(p => kOf(p.at ?? []))))
  const doorOf = ctx.doorOf ?? (r => doorwayOf(r.rec))
  const spots = potN > 0 ? records.flatMap(r => potSpots(read, r.plot, r.rec, doorOf(r), { pathCols, guard, reserved })).filter(p => !potted.has(kOf(p.at))) : []
  tried.push(`b${cands.length}/p${spots.length}/${design.pattern}:${design.scheme}`)
  if (!wantB && !spots.length) return { ok: false, why: plants < DECOR.plantsMin ? 'no_plants' : 'no_pots', tried }
  // the pots nearest home first (the doors the town walks through most)
  const potPick = spots.sort((a, b) => cheb(a.at, [home.x, 0, home.z]) - cheb(b.at, [home.x, 0, home.z]) || a.at[0] - b.at[0] || a.at[2] - b.at[2]).slice(0, Math.min(DECOR.potsMax, potN))
  const border = pickBorder(cands, { design, max: Math.max(0, wantB) })
  const far = Math.max(0, ...[...border, ...potPick].map(c => cheb(c.at, [home.x, 0, home.z])))
  const walkR = Math.max(ctx.walkR ?? 0, Math.min(128, far + 8))
  const pr = proveDecor(read, home, { border, pots: potPick, stood, walkR })
  tried.push(`proved b${pr.border.length}/p${pr.pots.length}`)
  if (!pr.ok) return { ok: false, why: 'no_site', tried }
  if (pr.border.length && pr.border.length < Math.min(DECOR.plantsMin, wantB) && !pr.pots.length) return { ok: false, why: 'no_site', tried }
  const inst = decorInstance(id, { border: pr.border, pots: pr.pots, design })
  const meta = { id, n, kind: DECOR_KIND, seed, design: { kind: DECOR_KIND, ...design }, summary: decorSummary(pr.border, pr.pots, design), box: inst.box, zones: inst.zones,
    cols: inst.cols, pots: inst.pots, approach: [inst.cells[0].at], centre: [inst.cells[0].at[0], inst.cells[0].at[2]], plants: pr.border.length, inside: pr.border.filter(c => c.inside).length }
  return { ok: true, inst, meta, tried }
}

// ---- the nursery -----------------------------------------------------------------------------------------------------------------------------
const GRASS = b => !!b && nm(b) === 'grass_block'
/** A column's grass top near y (y+dy .. y-dy) with an open cell above -> its y | null. Pure. */
export function grassTop (read, x, z, y, dy = NURSERY.dy) {
  for (let g = y + dy; g >= y - dy; g--) {
    const b = read(x, g, z)
    if (!b) return null
    if (GRASS(b)) { const a = read(x, g + 1, z); return a && !isLiquid(a) && (AIRN(nm(a)) || BLOOM_SET.has(nm(a))) ? g : null }
    if (b.boundingBox === 'block' && !/leaves$/.test(nm(b))) return null
  }
  return null
}
/**
 * ONE COLUMN AS THE NURSERY'S GROUND -> 'none' (nothing a meal could seed: no grass block with an open cell above) | 'land' (a landing
 * cell a meal may seed, and nothing guards it) | a refusal ('reserved:<why>' | 'record' | 'unread'). Pure. A landing column is refused when it is
 * reserved (`reserved(x, z)`: a zone, a corridor, the park, a farm ...), is another record's column (a building's, a lamp's), or its
 * landing cell (or the one above) is a record cell. A column with no grass is never a refusal: a meal's walk steps only onto grass.
 */
export function nurseryColumn (read, x, z, y, { guard, reserved = () => null } = {}) {
  // Codex r1 BLOCKER 1: EVERY grass block with an open cell above within NURSERY.spread of the centre's height (the walk climbs or drops
  // one a step, at most 7 steps) -- never only the column's top: grass under an overhang is a landing cell too. An unread cell there
  // is a refusal (never "nothing to seed").
  const lands = []
  for (let g = y - NURSERY.spread; g <= y + NURSERY.spread; g++) {
    const b = read(x, g, z)
    if (!b) return 'unread'
    if (!GRASS(b)) continue
    const a = read(x, g + 1, z)
    if (!a) return 'unread'
    if (!isLiquid(a) && (AIRN(nm(a)) || BLOOM_SET.has(nm(a)))) lands.push(g)
  }
  if (!lands.length) return 'none'
  const why = reserved(x, z)
  if (why) return `reserved:${String(why).slice(0, 24)}`
  if (guard.cols.has(k2(x, z)) || lands.some(g => guard.cells.has(kOf([x, g + 1, z])) || guard.cells.has(kOf([x, g + 2, z])))) return 'record'
  return 'land'
}
/**
 * IS THIS A NURSERY? -> { ok, landing, why }. Pure. The centre [x, y, z] is a grass block with an open cell above; no column within
 * NURSERY.spread is a refused landing column (nurseryColumn); `landing` counts the landing cells within NURSERY.core (the quality,
 * at least NURSERY.coreMin).
 */
export function nurseryOk (read, centre, { guard, reserved = () => null } = {}) {
  const [cx, cy, cz] = centre
  if (!GRASS(read(cx, cy, cz))) return { ok: false, why: 'not_grass' }
  const up = read(cx, cy + 1, cz)
  if (!up || !(AIRN(nm(up)) || BLOOM_SET.has(nm(up)))) return { ok: false, why: 'covered' }
  let landing = 0
  const R = NURSERY.spread
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
    const v = nurseryColumn(read, cx + dx, cz + dz, cy, { guard, reserved })
    if (v === 'none') continue
    if (v !== 'land') return { ok: false, why: v }
    if (Math.max(Math.abs(dx), Math.abs(dz)) <= NURSERY.core) landing++
  }
  if (landing < NURSERY.coreMin) return { ok: false, why: `thin:${landing}`, landing }
  return { ok: true, landing, why: 'ok' }
}
/**
 * SITE THE NURSERY -> { ok, nursery: { at, box, landing } } | { ok: false, why, tried }. Pure. Every column within NURSERY.searchR +
 * NURSERY.spread of home is classified once (nurseryColumn at home's height), summed (a refusal count and a landing count per window by
 * prefix sums), and the centres are taken by ring from home (NURSERY.minR .. searchR): the first whose spread window holds no refusal
 * and whose core holds NURSERY.coreMin landing cells -- then confirmed by nurseryOk at the centre's own height.
 */
export function siteNursery (read, home, { guard, reserved = () => null, searchR = NURSERY.searchR } = {}) {
  const R = NURSERY.spread, C = NURSERY.core, M = searchR + R
  const W = 2 * M + 1
  const bad = new Int32Array((W + 1) * (W + 1)), land = new Int32Array((W + 1) * (W + 1))
  const fails = {}
  const at = (i, j) => i * (W + 1) + j
  for (let i = 0; i < W; i++) for (let j = 0; j < W; j++) {
    const v = nurseryColumn(read, home.x - M + i, home.z - M + j, home.y + 0, { guard, reserved })
    const b = v !== 'none' && v !== 'land' ? 1 : 0, l = v === 'land' ? 1 : 0
    bad[at(i + 1, j + 1)] = b + bad[at(i, j + 1)] + bad[at(i + 1, j)] - bad[at(i, j)]
    land[at(i + 1, j + 1)] = l + land[at(i, j + 1)] + land[at(i + 1, j)] - land[at(i, j)]
  }
  const sum = (A, i0, j0, i1, j1) => A[at(i1 + 1, j1 + 1)] - A[at(i0, j1 + 1)] - A[at(i1 + 1, j0)] + A[at(i0, j0)]
  for (let r = NURSERY.minR; r <= searchR; r++) {
    const ring = []
    for (let d = -r; d <= r; d++) ring.push([d, -r], [d, r], ...(Math.abs(d) < r ? [[-r, d], [r, d]] : []))
    ring.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    for (const [dx, dz] of ring) {
      const i = dx + M, j = dz + M
      if (sum(bad, i - R, j - R, i + R, j + R) > 0) { fails.window = (fails.window ?? 0) + 1; continue }
      if (sum(land, i - C, j - C, i + C, j + C) < NURSERY.coreMin) { fails.thin = (fails.thin ?? 0) + 1; continue }
      const x = home.x + dx, z = home.z + dz
      const g = grassTop(read, x, z, home.y)
      if (g == null) continue
      const v = nurseryOk(read, [x, g, z], { guard, reserved })
      if (v.ok) return { ok: true, nursery: { at: [x, g, z], box: [x - R, z - R, x + R, z + R], landing: v.landing } }
      const k = String(v.why).replace(/:.*$/, '')
      fails[k] = (fails[k] ?? 0) + 1
    }
  }
  return { ok: false, why: 'no_nursery', tried: fails }
}
/**
 * THE NURSERY'S DIGS NOW -> { blooms, grass }. Pure over `read`. Blooms: every flower standing on grass within NURSERY.spread (what
 * the meals grew), nearest the centre first; grass: the short and tall grass within NURSERY.clearR of the centre (a meal's first tries
 * land there). Never a record cell (`guard.cells`): a flower the town planted stays.
 */
export function nurseryDigs (read, nursery, { guard = { cells: new Set() } } = {}) {
  const [cx, cy, cz] = nursery.at
  const R = NURSERY.spread
  const blooms = [], grass = []
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
    const x = cx + dx, z = cz + dz
    const g = grassTop(read, x, z, cy)
    if (g == null) continue
    const at = [x, g + 1, z]
    const n = nm(read(...at))
    if (!BLOOM_SET.has(n) || guard.cells.has(kOf(at))) continue
    const d = Math.max(Math.abs(dx), Math.abs(dz))
    if (FLOWER_SET.has(n)) blooms.push({ at, name: n, d })
    else if (d <= NURSERY.clearR) grass.push({ at, name: n, d })
  }
  const by = (a, b) => a.d - b.d || a.at[0] - b.at[0] || a.at[2] - b.at[2]
  return { blooms: blooms.sort(by), grass: grass.sort(by) }
}
/** Is a nursery on the record still one now (its centre grass, nothing reserved or recorded in reach since)? Pure. */
export const nurseryStill = (read, nursery, opts) => !!nursery?.at && nurseryOk(read, nursery.at, opts).ok
/**
 * THE NURSERY ON THE RECORD -> the new record (a nursery-only base when there is none: no instance, nothing to build). Pure. The old
 * nursery, if any, goes to `nurseries` (the read judges a harvest against every nursery a generation in force names).
 */
export function withNursery (cur, nursery, { home, now = Date.now(), blueprint = 'decor@1', plot = 'decor' } = {}) {
  const base = cur ?? { v: 1, blueprint, plot, kind: DECOR_KIND, home, instances: [], cells: [], segments: [], palette: {}, clear: [], replant: [], zones: [], builders_max: 1, structure_complete: true, state: 'complete' }
  const old = base.nursery ? [...(base.nurseries ?? []), base.nursery] : (base.nurseries ?? [])
  return { ...base, nursery: { ...nursery, sitedAt: now }, nurseries: old }
}

// ---- the gate, the lease's order --------------------------------------------------------------------------------------------------------
/**
 * THE DECOR "PRESSURE" for sinks.mjs sinkNextGate -> { p, plants, meal, pots }. Pure. A batch wants DECOR.plantsMin border plants: the
 * bag's own, plus what the bone meal the decorator can use would grow (the bag's, and the town's above NURSERY.mealKeep, read, at
 * NURSERY.flowersPerMeal) -- or a pot (the bag's or the town's) with a plant to fill it.
 */
export function decorPressure ({ held = {}, townMeal = null, townPots = 0, coverage = 0 } = {}) {
  const known = Number.isFinite(townMeal) && Number(coverage) >= 0.8
  const meal = Math.max(0, Number(held.bone_meal) || 0) + (known ? Math.max(0, townMeal - NURSERY.mealKeep) : 0)
  const plants = borderPlantsOf(held)
  const pots = Math.max(0, Number(held.flower_pot) || 0) + (known ? Math.max(0, Number(townPots) || 0) : 0)
  const grow = Math.floor(Math.min(meal, NURSERY.mealMax) * NURSERY.flowersPerMeal)
  const p = plants + grow >= DECOR.plantsMin || (pots > 0 && !!potPlantFor(held)) ? 1 : -1
  return { p, plants, meal, pots, grow }
}
/** Does the decor plot want its decorator now (an open batch, a next one wanted, an upkeep or a repair)? Pure. */
export const decorWanted = s => !!s && !!(s.sinkOpen || s.sinkNext || (s.exists && s.complete && (s.due || s.damaged)))
/**
 * THE DECORATOR'S ORDER -> { order, states }. Pure. `d` is groundskeeper.mjs keeperDecision's answer for this bot on the decorator
 * lease ('mine' | 'other' | 'none' ...). For the HOLDER while the decor wants it: every other project reads full (`free: false`) and
 * owes no upkeep (`due` off) -- a repair still goes first (activeProject's first loop) -- and the decor leads the list, so the holder's
 * pick is the decor (Codex design: reordering alone cannot pass activeProject's finite tier). For EVERY OTHER bot the decor plot is
 * invisible (nothing open, nothing next, no upkeep, no repair): it is the decorator's alone.
 */
export function decorOrderPure (states, list, { d, plot = 'decor' } = {}) {
  const i = states.findIndex(s => s?.plot === plot)
  const p = list.find(q => q.plot === plot)
  if (i < 0 || !p) return { order: list, states }
  const out = states.slice()
  if (d === 'mine' && decorWanted(out[i])) {
    for (let k = 0; k < out.length; k++) {
      if (k === i) continue
      const s = out[k]
      if (s?.exists && s.complete && s.damaged) continue
      out[k] = { ...s, free: false, due: false, dueFirst: false }
    }
    out[i] = { ...out[i], free: true, idle: false }
    return { order: [p, ...list.filter(q => q.plot !== plot)], states: out }
  }
  out[i] = { ...out[i], free: false, damaged: false, due: false, dueFirst: false, sinkOpen: false, sinkNext: false }
  return { order: list, states: out }
}
/** The border flowers a decor record still owes -> n: its flower cells (decorFlowerRole) that `done(cell)` does not read done. Pure. */
export const flowersOwed = (rec, done = () => false) => (rec?.cells ?? []).filter(c => decorFlowerRole(c.role) && !done(c)).length
/** A decor visit's NO-PROGRESS stamp (Codex r1 BLOCKER 2: an open batch the decorator cannot finish -- no flower, no meal -- must not
 *  hold the decorator and every other project for good): nothing placed, filled, used or harvested -> true. Pure. */
export const decorStalled = (f = {}) => !(Number(f.placed) > 0 || Number(f.pots) > 0 || Number(f.meals) > 0 || Number(f.blooms) > 0 || Number(f.cleared) > 0)
/** The pot cells of a decor record standing EMPTY now (a flower_pot, not yet potted) -> [cell]. Pure. */
export const emptyPots = (rec, read) => (rec?.cells ?? []).filter(c => decorPotRole(c.role) && nm(read(...c.at)) === 'flower_pot')
/**
 * THE STANDS ROUND A CELL -> Map "x,z" -> [y] (buildrun.mjs digStand's `nodes`): feet cells within `r` columns and `dy` of the cell's
 * height with a full block under them and two passable cells (air, a plant, short grass) -- never the cell's own column. Pure. The
 * pot fill and the nursery walk to one (the build's walk: buildbot.mjs walkTo; an unreachable one is skipped).
 */
export function localStands (read, at, { r = 4, dy = 2 } = {}) {
  const m = new Map()
  const pass = b => !!b && !isLiquid(b) && (b.boundingBox === 'empty' || AIRN(nm(b)))
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (!dx && !dz) continue
    const x = at[0] + dx, z = at[2] + dz
    for (let y = at[1] - dy; y <= at[1] + dy; y++) {
      const f = read(x, y - 1, z)
      if (!f || f.boundingBox !== 'block' || isLiquid(f)) continue
      if (!pass(read(x, y, z)) || !pass(read(x, y + 1, z))) continue
      const k = k2(x, z)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(y)
    }
  }
  return m
}
/** The flowers a harvest still takes -> bool: under the storage hall's per-type plant cap (storehub.mjs PLANT_CAPS.flower, restated:
 *  decorator.test.mjs asserts the two agree) in this bag. Pure. */
export const DECOR_FLOWER_CAP = 32
export const harvestWants = (held = {}, name) => (Number(held?.[name]) || 0) < DECOR_FLOWER_CAP

/** The decor row detail (`_decor` rows). Pure. */
export const decorRowDetail = f => Object.entries(f).filter(([, v]) => v != null).map(([k, v]) => `${k}=${String(Array.isArray(v) ? v.join(',') : v).replace(/\s+/g, '_').slice(0, 80)}`).join(' ')
/** The instance's seed: kind, pool, home and instance number (sinks.mjs sinkSeed's rule, restated: no import cycle). Pure. */
export const decorSeed = (pool, home, n) => fnv1a(`decor@1|${pool ?? ''}|${home?.x},${home?.y},${home?.z}|${n}`)
