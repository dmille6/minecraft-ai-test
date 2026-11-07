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
  // decorator-02 (OWNER 11-05 "yes": wild ferns cut with shears near home and replanted along paths)
  fernR: 48,                 // the fern gather's reach from home (Chebyshev)
  fernMax: 12,               // fern digs a visit
  fernWant: 24,              // the bag's ferns the gather fills to
  fernRunMin: 3,             // a fern cluster is at least this many cells
  // decorator-03 (leaf hedges + lantern posts; Paper 11-05 01:19Z: placed leaves persistent, a lantern stands on a fence)
  hedgeMax: 8,               // hedge cells a batch (behind its flower runs: path | flowers | hedge)
  leafMax: 16,               // leaf digs a visit (shears)
  leafWant: 16,              // the bag's leaves the gather fills to
  postsMax: 2,               // lantern posts a batch (beside a finished building's doorway, the pots' spots while pots are off)
})
/** The leaves a hedge takes (any species the bag holds: park.mjs HEDGE_ITEMS, spruce first -- the taiga's). */
export const HEDGE_LEAVES = Object.freeze(['spruce_leaves', 'oak_leaves', 'birch_leaves', 'dark_oak_leaves', 'jungle_leaves', 'acacia_leaves', 'cherry_leaves', 'mangrove_leaves', 'azalea_leaves', 'flowering_azalea_leaves'])
export const leavesOf = (held = {}) => HEDGE_LEAVES.reduce((t, n) => t + Math.max(0, Number(held?.[n]) || 0), 0)
export const FENCES = Object.freeze(['spruce_fence', 'oak_fence', 'birch_fence', 'dark_oak_fence', 'jungle_fence', 'acacia_fence', 'cherry_fence', 'mangrove_fence', 'bamboo_fence', 'pale_oak_fence'])
export const fencesOf = (held = {}) => FENCES.reduce((t, n) => t + Math.max(0, Number(held?.[n]) || 0), 0)
/** decorator-03: the lantern posts' switch (DECOR_POSTS=on|off, default on) and the hedges' (DECOR_HEDGES, default on). Pure. */
export const decorPostsOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.DECOR_POSTS ?? '').trim())
export const decorHedgesOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.DECOR_HEDGES ?? '').trim())
/** decorator-02: THE COMPOST DRIVE (OWNER 11-05: "the park keeps its 4 bone meal, add a compost drive ... only true surplus, never
 *  park/decor stock"). Measured 11-05 00:30Z: the 15 showcase bags hold ONE item the composter's allowance would take (a brown
 *  mushroom): the saplings are all inside the tree farm's reserve, the seeds the crop farm's, no rotten food in a peaceful world. The
 *  real surplus is what a MEAL leaves: ~17 short grass a meal (Paper, decorator-01's proof), which shears turn into items (a 30%
 *  input: ~21 a bone meal) -- so the nursery funds ~80% of its own next meal. Any bot at town whose bag holds DRIVE.feedMin
 *  composter junk composts it (whatever its fullness) while the town's bone meal is under DRIVE.target. */
export const DRIVE = Object.freeze({ feedMin: 8, target: 16 })
/** decorator-02: is the compost drive's case met? -> bool. Pure. The bag's composter junk (composter.mjs compostAllowance: the junk,
 *  saplings above their reserve, the peaceful kit's plants -- never the decorator's flowers or ferns, never the crop farm's seeds) at
 *  least DRIVE.feedMin and the town's bone meal (read) under DRIVE.target; an unread town never drives. */
export const driveWants = ({ junk = 0, townMeal = null, coverage = 0 } = {}) => Number(junk) >= DRIVE.feedMin && Number.isFinite(townMeal) && Number(coverage) >= 0.8 && townMeal < DRIVE.target
/** decorator-02 (OWNER 11-05: "SKIP pots for now ... revisit after bucketfix-01"): DECOR_POTS=on|off, default OFF -- no pot is sited
 *  or filled; a sited pot stays guarded. Pure. */
export function decorPotsOn (env = process.env) {
  const v = String(env?.DECOR_POTS ?? '').trim().toLowerCase()
  return v === 'on' || v === '1' || v === 'true'
}
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
  const phase = Math.floor(r() * n) % n
  // decorator-02: FERN CLUSTERS -- a seeded share of the batches alternate flower runs with fern runs (the taiga's own green)
  const fern = r() < 0.7
  // decorator-03: a seeded half of the batches back their flower runs with a hedge
  const hedge = r() < 0.5
  return { pattern, n, phase, scheme, run, fern, hedge }
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
    out.push({ at: r.at, ground: r.ground, out: [dx, dz], d: Math.max(Math.abs(s[0] - home.x), Math.abs(s[1] - home.z)), inside: !!inside(s[0], s[1]) })
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
export function decorInstance (id, { border = [], pots = [], design, kinds = null, hedges = [], posts = [] }) {
  const list = SCHEMES[design?.scheme] ?? SCHEMES.mixed
  const roles = {}
  for (let k = 0; k < 4; k++) roles[`${id}-f${k}`] = [...rotList(list, k * 3), 'fern']
  // decorator-02: a fern cluster's role (`kinds[i] === 'g'`)
  if (kinds?.includes('g')) roles[`${id}-g`] = ['fern']
  roles[`${id}-pot`] = ['flower_pot']
  const cells = [], segments = [], zones = [], cols = []
  let run = -1, prev = null
  border.forEach((c, i) => {
    if (!prev || cheb(prev.at, c.at) > Math.max(2, design?.n ?? 1)) { run++; segments.push({ seg: `${id}-B${run}`, deps: [] }) }
    cells.push({ at: c.at.slice(), role: kinds?.[i] === 'g' ? `${id}-g` : `${id}-f${i % 4}`, seg: `${id}-B${run}` })
    prev = c
  })
  if (pots.length) segments.push({ seg: `${id}-P`, deps: [] })
  for (const p of pots) cells.push({ at: p.at.slice(), role: `${id}-pot`, seg: `${id}-P` })
  // decorator-03: the hedge (one segment, after the flowers: they are reached across the hedge's column no more) and the lantern posts
  if (hedges.length) { roles[`${id}-h`] = HEDGE_LEAVES.slice(); segments.push({ seg: `${id}-H`, deps: segments.filter(q => /-B\d+$/.test(q.seg)).map(q => q.seg) }) }
  for (const h of hedges) cells.push({ at: h.at.slice(), role: `${id}-h`, seg: `${id}-H` })
  if (posts.length) { roles[`${id}-post`] = FENCES.slice(); roles[`${id}-lamp`] = ['lantern'] }
  posts.forEach((q, k) => {
    segments.push({ seg: `${id}-L${k}`, deps: [] })
    cells.push({ at: q.at.slice(), role: `${id}-post`, seg: `${id}-L${k}` }, { at: [q.at[0], q.at[1] + 1, q.at[2]], role: `${id}-lamp`, seg: `${id}-L${k}` })
  })
  for (const c of cells) { zones.push({ box: [c.at[0], -64, c.at[2], c.at[0], 320, c.at[2]], why: `project:decor:${id}` }); cols.push([c.at[0], c.at[2]]) }
  const xs = cells.map(c => c.at[0]), zs = cells.map(c => c.at[2])
  const counts = cells.reduce((m, c) => (m[c.role] = (m[c.role] ?? 0) + 1, m), {})
  return { cells, segments, palette: roles, counts, clear: [], zones: dedupeZones(zones), cols, pots: pots.map(p => ({ at: p.at, door: p.door, plot: p.plot })), posts: posts.map(q => ({ at: q.at, door: q.door, plot: q.plot })),
    box: cells.length ? [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] : null }
}
const dedupeZones = zs => { const seen = new Set(); return zs.filter(z => { const k = z.box.join(','); if (seen.has(k)) return false; seen.add(k); return true }) }
/**
 * decorator-03: THE HEDGE BEHIND A FLOWER RUN -> [{ at, ground }]. Pure. For each chosen flower cell, the column one further out from
 * the path (its candidate's `out`) under the border's own rules (borderAt: no path, record, door front, reservation, a step of 1 from
 * the flower's ground, open, dry), never a cell of the batch; at most `max`.
 */
export function hedgeCells (read, chosen, { pathCols, guard, reserved = () => null, max = DECOR.hedgeMax } = {}) {
  const taken = new Set(chosen.map(c => k2(c.at[0], c.at[2])))
  const out = []
  for (const c of chosen) {
    if (out.length >= max || !Array.isArray(c.out)) continue
    const s = [c.at[0] + c.out[0], c.at[2] + c.out[1]]
    if (taken.has(k2(s[0], s[1]))) continue
    const r = borderAt(read, { x: c.at[0], y: c.ground[1], z: c.at[2] }, s, { pathCols, guard, reserved })
    if (r.why) continue
    taken.add(k2(s[0], s[1]))
    out.push({ at: r.at, ground: r.ground })
  }
  return out
}
/**
 * decorator-03: THE HEDGES' WALK PROOF -> the hedges kept. Pure. The town walk with the hedge cells solid must still hold every walk
 * node the walk held without them (but the hedges' own columns): a hedge never cuts a way off. Tested whole first; on a loss, cell by
 * cell (a cell that loses a node alone is dropped).
 */
export function proveHedges (read, home, hedges, { stood = [], walkR = 64, base = null } = {}) {
  if (!hedges.length) return []
  const before = base ?? decorNodes(read, home, { stood, walkR })
  const lost = hs => {
    const over = new Map(hs.map(h => [kOf(h.at), SOLID('spruce_leaves')]))
    const cols = new Set(hs.map(h => k2(h.at[0], h.at[2])))
    const after = decorNodes(overlay(read, over), home, { stood, walkR })
    for (const [c, ys] of before) { if (cols.has(c)) continue; const a = after.get(c) ?? []; if (ys.some(y => !a.includes(y))) return true }
    return false
  }
  if (!lost(hedges)) return hedges
  const keep = []
  for (const h of hedges) if (!lost([...keep, h])) keep.push(h)
  return keep
}
/** The border's RUNS (decorInstance's segments: a run breaks where two cells stand more than max(2, design.n) apart) -> [[index]]. Pure. */
export function borderRuns (border, design) {
  const out = []
  let prev = null
  border.forEach((c, i) => { if (!prev || cheb(prev.at, c.at) > Math.max(2, design?.n ?? 1)) out.push([]); out[out.length - 1].push(i); prev = c })
  return out
}
/**
 * decorator-02: WHICH RUN IS A FERN CLUSTER -> { kinds: ['f' | 'g' | null], flowers, ferns } (null: dropped, no plant for it). Pure.
 * With the design's `fern`, every other run (the second, the fourth ...) is ferns when the bag's ferns cover it (DECOR.fernRunMin at
 * least); every run otherwise takes flowers while they last, then ferns; a run neither covers is dropped from its end.
 */
export function assignKinds (border, design, { flowers = 0, ferns = 0 } = {}) {
  const kinds = border.map(() => null)
  let fl = Math.max(0, flowers), fe = Math.max(0, ferns)
  borderRuns(border, design).forEach((run, k) => {
    const wantFern = !!design?.fern && k % 2 === 1 && run.length >= DECOR.fernRunMin && fe >= run.length
    for (const i of run) {
      if (wantFern && fe > 0) { kinds[i] = 'g'; fe-- } else if (!wantFern && fl > 0) { kinds[i] = 'f'; fl-- } else if (fe > 0) { kinds[i] = 'g'; fe-- } else if (fl > 0) { kinds[i] = 'f'; fl-- }
    }
  })
  return { kinds, flowers: flowers - fl, ferns: ferns - fe }
}
/** Is a role a decor pot (`D3-pot`)? a decor border plant (`D3-f2`, a fern cluster's `D3-g`)? Pure. */
export const decorPotRole = role => /^D\d+-pot$/.test(String(role ?? ''))
// decorator-02: a fern cluster's cell (`D3-g`) is a border plant too (the bill, the owed count, the walk-through role read it)
// flowers-01: an upgraded cell (`D3-u1`) is a border flower too
export const decorFlowerRole = role => /^D\d+-(f\d|g|u\d)$/.test(String(role ?? ''))
export const decorFernRole = role => /^D\d+-g$/.test(String(role ?? ''))
/** decorator-03: a hedge cell (`D3-h`), a lantern post's fence (`D3-post`) and its lantern (`D3-lamp`); every decor role the bag
 *  supplies (never billed from a chest: the border's plants, the hedge's leaves, the post's fence and lantern). Pure. */
export const decorHedgeRole = role => /^D\d+-h$/.test(String(role ?? ''))
export const decorPostRole = role => /^D\d+-(post|lamp)$/.test(String(role ?? ''))
export const decorBagRole = role => decorFlowerRole(role) || decorHedgeRole(role) || decorPostRole(role)
/** The summary for the sited row: `b12/p2/alt:warm`. Pure. */
export const decorSummary = (border, pots, design, ferns = 0, hedges = 0, posts = 0) => `b${border.length}/p${pots.length}/${design.pattern}:${design.scheme}${ferns ? `/g${ferns}` : ''}${hedges ? `/h${hedges}` : ''}${posts ? `/l${posts}` : ''}`

/**
 * SITE THE NEXT DECOR BATCH -> { ok, inst, meta, tried } | { ok: false, why, tried }. Pure over `read`. ctx:
 *   id, n, home, seed, records [{ plot, rec }] (every OTHER project's head record: the paths, the buildings, the cell guard),
 *   doorOf({ plot, rec }) -> doorwayOf's answer (the caller loads the blueprint),
 *   rec (the decor record so far), plants (the bag's border plants), pots (flower pots the bag and the town hold),
 *   reserved(x, z), inside(x, z) (the town's walls), stood, walkR.
 */
export function siteDecor (read, ctx = {}) {
  const { id, n = 1, home, seed = 0, records = [], rec = null, pots: potN = 0, reserved = () => null, inside = () => false, stood = [] } = ctx
  // decorator-03: the bag's leaves (hedges) and lantern posts (fences + lanterns: the fewer of the two)
  const leaves = Math.max(0, Number(ctx.leaves) || 0), postN = Math.max(0, Number(ctx.posts) || 0)
  // decorator-02: the bag's flowers and ferns (an older caller's `plants` reads as flowers)
  const flowers = Math.max(0, Number(ctx.flowers ?? ctx.plants) || 0), ferns = Math.max(0, Number(ctx.ferns) || 0)
  const plants = flowers + ferns
  const tried = []
  const byPlot = new Map(records.filter(r => r?.rec).map(r => [r.plot, r.rec]))
  const paths = byPlot.get('paths') ?? null
  if (!paths) return { ok: false, why: 'no_paths', tried }
  const recs = [...records.map(r => r.rec).filter(Boolean), ...(rec ? [rec] : [])]
  const guard = cellGuard(recs)
  // reroof-02 (a, REROOF_DECOR_AVOID): the cells a pending retrofit will add (reroof.mjs reroofPendingCells) are guarded like record
  // cells -- a pot or a lantern post never stands where (or under where) a new roof will go (LIVE 11-05: two posts held two roofs)
  for (const k of ctx.avoid ?? []) guard.cells.add(k)
  const design = decorDesign(seed)
  const pathCols = pathColumns(paths)
  const wantB = plants >= DECOR.plantsMin ? Math.min(DECOR.batchMax, plants) : 0
  const cands = wantB ? borderCandidates(read, paths, home, { guard, reserved, inside }) : []
  const potted = new Set((rec?.instances ?? []).flatMap(i => (i.pots ?? []).map(p => kOf(p.at ?? []))))
  const postAt = new Set((rec?.instances ?? []).flatMap(i => (i.posts ?? []).map(p => kOf(p.at ?? []))))
  const doorOf = ctx.doorOf ?? (r => doorwayOf(r.rec))
  const spots = potN > 0 ? records.flatMap(r => potSpots(read, r.plot, r.rec, doorOf(r), { pathCols, guard, reserved })).filter(p => !potted.has(kOf(p.at))) : []
  tried.push(`b${cands.length}/p${spots.length}/${design.pattern}:${design.scheme}`)
  // decorator-03: the lantern posts stand on the pots' spots (beside a finished doorway) -- never both: pots first when they are on
  const postSpots = !potN && postN > 0 ? records.flatMap(r => potSpots(read, r.plot, r.rec, doorOf(r), { pathCols, guard, reserved })).filter(p => !potted.has(kOf(p.at)) && !postAt.has(kOf(p.at))) : []
  if (!wantB && !spots.length && !postSpots.length) return { ok: false, why: plants < DECOR.plantsMin ? 'no_plants' : 'no_pots', tried }
  // the pots nearest home first (the doors the town walks through most)
  const potPick = spots.sort((a, b) => cheb(a.at, [home.x, 0, home.z]) - cheb(b.at, [home.x, 0, home.z]) || a.at[0] - b.at[0] || a.at[2] - b.at[2]).slice(0, Math.min(DECOR.potsMax, potN))
  const postPick = postSpots.sort((a, b) => cheb(a.at, [home.x, 0, home.z]) - cheb(b.at, [home.x, 0, home.z]) || a.at[0] - b.at[0] || a.at[2] - b.at[2]).slice(0, Math.min(DECOR.postsMax, postN))
  const border = pickBorder(cands, { design, max: Math.max(0, wantB) })
  const far = Math.max(0, ...[...border, ...potPick, ...postPick].map(c => cheb(c.at, [home.x, 0, home.z])))
  const walkR = Math.max(ctx.walkR ?? 0, Math.min(128, far + 8))
  // the posts are proven as pots are (solid: a fence; the doorway's front still walked to); a lantern on top is placed on the fence
  const pr0 = proveDecor(read, home, { border, pots: [...potPick, ...postPick], stood, walkR })
  const isPost = new Set(postPick.map(q => kOf(q.at)))
  const pr = { ...pr0, pots: pr0.pots.filter(q => !isPost.has(kOf(q.at))), posts: pr0.pots.filter(q => isPost.has(kOf(q.at))) }
  tried.push(`proved b${pr.border.length}/p${pr.pots.length}`)
  if (!pr.ok) return { ok: false, why: 'no_site', tried }
  if (pr.border.length && pr.border.length < Math.min(DECOR.plantsMin, wantB) && !pr.pots.length && !pr.posts.length) return { ok: false, why: 'no_site', tried }
  // decorator-02: the fern clusters, as far as the bag's ferns cover them; a cell no plant covers is dropped
  const ak = assignKinds(pr.border, design, { flowers, ferns })
  const keep = pr.border.map((c, i) => ak.kinds[i] ? i : -1).filter(i => i >= 0)
  const border2 = keep.map(i => pr.border[i]), kinds2 = keep.map(i => ak.kinds[i])
  if (!border2.length && !pr.pots.length && !pr.posts.length) return { ok: false, why: 'no_site', tried }
  // decorator-03: the hedge behind the flower runs (the design's `hedge`, the bag's leaves), kept only where the town walk loses nothing
  const flowersRun = border2.filter((c, i) => kinds2[i] === 'f')
  const hedge0 = design.hedge && leaves > 0 ? hedgeCells(read, border2, { pathCols, guard, reserved, max: Math.min(DECOR.hedgeMax, leaves) }).filter(h => flowersRun.some(c => cheb(c.at, h.at) <= 1)) : []
  // Codex r1 BLOCKER 1: proven over the batch's pots and posts already standing (fence + lantern solid): the walk with them is the
  // baseline, and a hedge that loses any node of it -- a doorway front among them -- is dropped
  const solids = new Map([...pr.pots.map(q => [kOf(q.at), SOLID('flower_pot')]), ...pr.posts.flatMap(q => [[kOf(q.at), SOLID('spruce_fence')], [kOf([q.at[0], q.at[1] + 1, q.at[2]]), SOLID('lantern')]])])
  const hedges = proveHedges(solids.size ? overlay(read, solids) : read, home, hedge0, { stood, walkR })
  const inst = decorInstance(id, { border: border2, pots: pr.pots, design, kinds: kinds2, hedges, posts: pr.posts })
  const meta = { id, n, kind: DECOR_KIND, seed, design: { kind: DECOR_KIND, ...design }, summary: decorSummary(border2, pr.pots, design, ak.ferns, hedges.length, pr.posts.length), box: inst.box, zones: inst.zones,
    cols: inst.cols, pots: inst.pots, posts: inst.posts, hedges: hedges.length, approach: [inst.cells[0].at], centre: [inst.cells[0].at[0], inst.cells[0].at[2]], plants: border2.length, flowers: ak.flowers, ferns: ak.ferns, inside: border2.filter(c => c.inside).length }
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
/** decorator-02 (Claude tripwire r1 BLOCKER): THE DECOR RECORD'S BASE -> the record (unchanged) | a nothing-to-build base naming the town's
 *  home -- published before the first fern is cut, so the read's DC4 has a generation (and a home) in force at every fern row. Pure. */
export const decorBase = (cur, { home, blueprint = 'decor@1', plot = 'decor' } = {}) => cur ?? { v: 1, blueprint, plot, kind: DECOR_KIND, home, instances: [], cells: [], segments: [], palette: {}, clear: [], replant: [], zones: [], builders_max: 1, structure_complete: true, state: 'complete' }
export function withNursery (cur, nursery, { home, now = Date.now(), blueprint = 'decor@1', plot = 'decor' } = {}) {
  const base = decorBase(cur, { home, blueprint, plot })
  const old = base.nursery ? [...(base.nurseries ?? []), base.nursery] : (base.nurseries ?? [])
  return { ...base, nursery: { ...nursery, sitedAt: now }, nurseries: old }
}

// ---- decorator-02: the fern gather ----------------------------------------------------------------------------------------------------
/** The blocks the fern gather cuts (with shears: a fern drops itself, a large fern two). */
export const FERN_BLOCKS = Object.freeze(['fern', 'large_fern'])
/**
 * THE FERN GATHER'S TARGETS -> [{ at, name, n }] nearest `from` first, at most `max` digs and `want` ferns. Pure.
 *   cands     [{ at, name }] the world's fern / large_fern blocks (the bot's findBlocks)
 *   read      the world read; reserved(x, z) a reservation; guard (towndress.mjs cellGuard) every record's cells and columns
 * A fern stands on soil (park.mjs SOIL_RE's blocks) and is cut in its own cell (no collision: the gatherer stands in it); a large
 * fern at its LOWER half (its upper half above it), counted 2. Never a reserved column, a record's column or cell, never beyond
 * DECOR.fernR of home.
 */
export function fernTargets (cands, { read, reserved = () => null, guard = { cols: new Set(), cells: new Set() }, home, from = null, max = DECOR.fernMax, want = DECOR.fernWant, r = DECOR.fernR, minR = 0 } = {}) {
  const f = from ?? [home.x, home.y, home.z]
  const order = (cands ?? []).filter(c => Array.isArray(c?.at)).slice().sort((a, b) => (Math.abs(a.at[0] - f[0]) + Math.abs(a.at[1] - f[1]) + Math.abs(a.at[2] - f[2])) - (Math.abs(b.at[0] - f[0]) + Math.abs(b.at[1] - f[1]) + Math.abs(b.at[2] - f[2])) || a.at[0] - b.at[0] || a.at[2] - b.at[2] || a.at[1] - b.at[1])
  const out = [], seen = new Set()
  let got = 0
  for (const c of order) {
    if (out.length >= max || got >= want) break
    let [x, y, z] = c.at
    // flowers-01 r4 (coordinator 11-07, the owner asked): no fern is cut within minR of home (FLOWER.fernMinR) -- the town's own green
    const dh = Math.max(Math.abs(x - home.x), Math.abs(z - home.z))
    if (dh > r || dh <= minR) continue
    const here = nm(read(x, y, z))
    if (!FERN_BLOCKS.includes(here)) continue
    if (here === 'large_fern' && nm(read(x, y - 1, z)) === 'large_fern') y--
    if (!/^(grass_block|dirt|podzol|coarse_dirt|rooted_dirt|moss_block|mycelium|mud)$/.test(nm(read(x, y - 1, z)))) continue
    const k = kOf([x, y, z])
    if (seen.has(k)) continue
    if (reserved(x, z) || guard.cols.has(k2(x, z)) || guard.cells.has(k) || guard.cells.has(kOf([x, y + 1, z]))) continue
    seen.add(k)
    const n = here === 'large_fern' ? 2 : 1
    got += n
    out.push({ at: [x, y, z], name: here, n })
  }
  return out
}

// ---- the gate, the lease's order --------------------------------------------------------------------------------------------------------
/**
 * THE DECOR "PRESSURE" for sinks.mjs sinkNextGate -> { p, plants, meal, pots }. Pure. A batch wants DECOR.plantsMin border plants: the
 * bag's own, plus what the bone meal the decorator can use would grow (the bag's, and the town's above NURSERY.mealKeep, read, at
 * NURSERY.flowersPerMeal) -- or a pot (the bag's or the town's) with a plant to fill it.
 */
export function decorPressure ({ held = {}, townMeal = null, townPots = 0, coverage = 0, potsOn = false, wildFerns = 0 } = {}) {
  const known = Number.isFinite(townMeal) && Number(coverage) >= 0.8
  const meal = Math.max(0, Number(held.bone_meal) || 0) + (known ? Math.max(0, townMeal - NURSERY.mealKeep) : 0)
  const plants = borderPlantsOf(held)
  // decorator-02: pots only with DECOR_POTS on (owner 11-05: skipped); the wild ferns a gather can reach (the caller's count)
  const pots = potsOn ? Math.max(0, Number(held.flower_pot) || 0) + (known ? Math.max(0, Number(townPots) || 0) : 0) : 0
  const grow = Math.floor(Math.min(meal, NURSERY.mealMax) * NURSERY.flowersPerMeal) + Math.min(DECOR.fernMax, Math.max(0, Number(wildFerns) || 0))
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
export const decorStalled = (f = {}) => !(Number(f.placed) > 0 || Number(f.pots) > 0 || Number(f.meals) > 0 || Number(f.blooms) > 0 || Number(f.cleared) > 0 || Number(f.composted) > 0)
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

/**
 * REROOF-02 (b): A RETROFIT TAKES ITS ROOF'S CELLS BACK -> the decor generation without them | null (nothing of `keys` is a decor cell).
 * Pure. The cells at `keys` ('x,y,z') leave `cells` and are kept in `retired` ({ at, role, seg, by, retiredAt }); `retiredAt` the
 * newest retirement. The instances' own `posts` / `pots` are kept (siteDecor's `postAt` / `potted`: that spot is never sited again).
 * The decorator re-sites its posts at legal spots in a later batch (its ordinary posts, kept off a pending roof by REROOF_DECOR_AVOID).
 */
export function decorRetire (rec, keys = [], { by = 'reroof', now = Date.now() } = {}) {
  const want = new Set(keys)
  if (!rec || !Array.isArray(rec.cells) || !want.size) return null
  const gone = rec.cells.filter(c => Array.isArray(c?.at) && want.has(kOf(c.at)))
  if (!gone.length) return null
  return {
    ...rec,
    cells: rec.cells.filter(c => !(Array.isArray(c?.at) && want.has(kOf(c.at)))),
    retired: [...(rec.retired ?? []), ...gone.map(c => ({ at: c.at.slice(), role: c.role, seg: c.seg, by, retiredAt: now }))],
    retiredAt: now,
  }
}

// ==== FLOWERS-01: THE FLOWER SUPPLY AND THE BORDER UPGRADE (OWNER 11-07: "lawns with flowers and tall grass scattered, paths edged with
// flowers"; design docs/reports/flowers-design-2026-11-07.md, Claude + Codex reconciled). MEASURED 11-07: all 61 live border cells were
// ferns (role D<n>-g) because the town had NO flowers -- 2 in 13 bags, 0 in 27 chests, bone meal 4 (the park's reserve); 7 days: 8 meals,
// 2 flowers. Paper (sandbox5 11-07, flower-proof.cjs): a meal on open taiga grass grows 2.75 flowers (poppy, dandelion) + 17 short grass
// + 2.5 tall grass; on half-broken ground 1.25; a SECOND meal on a centre whose top a plant now covers is REFUSED (the meal is not spent);
// bone meal on a small flower does nothing (the meal is kept); a fern cell takes a flower placed on its soil (the fern is replaced).
// THE UPGRADE: a fern border cell is re-roled to a flower role `D<n>-u<k>` (the batch's scheme, NO fern in its palette) when the bag holds
// the flower for it -- two cells in three of a run (one in three stays a fern: the green between the flowers). A `u` cell holding its
// fern while the bag holds no flower is DONE for that visit (upgradeWaits): nothing is ever dug for a flower the bot does not hold, and
// no record reads damaged for want of flowers (the refusal chain: no flowers -> the ferns stay, nobody stalls).
export const FLOWER = Object.freeze({
  keepEvery: 3,      // one cell in three of a fern run stays a fern (Codex design: two flowers per retained fern)
  upgradeMax: 8,     // fern cells re-roled a visit (never more than the bag's flowers)
  wildR: 128,        // the wild pick's reach from home (Chebyshev; the decor visit's walk)
  wildMax: 12,       // wild picks a visit
  wildWant: 16,      // the bag's flowers a wild pick fills to
  feedKeep: 8,       // ferns the bag keeps from the compost drive (a fern cell's repair)
  fernMinR: 32,      // no fern is cut within this of home (coordinator 11-07, pending the owner: the town's ferns stay): the gather takes 33..DECOR.fernR
  feedMax: 12,       // feed-fern digs a visit (shears: a large fern is two)
  feedWant: 24,      // the bag's feed ferns the gather fills to (~2.3 bone meal: 1 + 6/0.65 ferns a meal)
  coreOpen: 0.8,     // a meal waits until this share of the nursery's core landing cells is open (Paper: a covered centre refuses it)
  harvestMax: 40,    // nursery digs a visit (the whole spread is cleared before a meal: was NURSERY.harvestMax 24, clearR 2)
})
/** THE SWITCH: FLOWERS=on|off, default on (the decorator's own pools only: decorOn decides whether any decor runs). Pure. */
export const flowersOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.FLOWERS ?? '').trim())
/** An upgraded border cell (`D3-u1`): a flower cell whose fern waits for a flower. Pure. */
export const decorUpgradeRole = role => /^D\d+-u\d$/.test(String(role ?? ''))
const SMALL_SET2 = new Set(SMALL_FLOWERS)
/** The bag's small flowers -> n (never a fern). Pure. */
export const flowersOf = (held = {}) => SMALL_FLOWERS.reduce((t, n) => t + Math.max(0, Number(held?.[n]) || 0), 0)
/**
 * IS AN UPGRADED CELL DONE FOR THIS VISIT ALTHOUGH IT HOLDS NO FLOWER? -> bool. Pure. A `u` cell standing a fern (or nothing a flower
 * could replace: air, short grass) while `held` has no small flower: it waits -- never damage, never an item the visit lacks. With a
 * flower in the bag it is open (the visit's placement replaces the fern: Paper P2). Anything else is the cell's ordinary done test.
 */
export function upgradeWaits (cell, block, held = {}) {
  if (!decorUpgradeRole(cell?.role)) return false
  const n = nm(block)
  if (SMALL_SET2.has(n)) return false
  if (!(n === 'fern' || AIRN(n) || n === 'short_grass')) return false
  return flowersOf(held) <= 0
}
/** The instance id of a decor role (`D3-g` -> 'D3'). Pure. */
const instOf = role => String(role ?? '').replace(/-.*$/, '')
/** The keep phase of a run (its segment's name): which cell in FLOWER.keepEvery stays a fern. Pure. */
export const keepPhase = seg => fnv1a(`flowers@1|${seg ?? ''}`) % FLOWER.keepEvery
/**
 * THE FERN CELLS AN UPGRADE MAY TAKE -> [{ cell, i, k }] in the record's order (the walls first: the batches' own order). Pure.
 * A fern cluster's cell (role D<n>-g) standing its FERN now (`read`), never a held column (`held(x, z)`: the wall demolition), and not
 * the run's kept fern: within its segment the cells are counted in the record's order and the (i % keepEvery) === keepPhase(seg) one
 * stays. `k` the flower role's rotation (i % 4: neighbours differ).
 */
export function upgradeCandidates (rec, read, { held = () => false } = {}) {
  // Codex r1 BLOCKER: the run's positions count its UPGRADED cells too (every u cell was a fern cell: withUpgrade converts only g), so
  // the kept third is the same cell at every visit -- counting the ferns left alone shifted it and the last ferns went too
  const bySeg = new Map()
  for (const c of rec?.cells ?? []) {
    if (!(decorFernRole(c?.role) || decorUpgradeRole(c?.role)) || !Array.isArray(c.at)) continue
    const s = String(c.seg ?? instOf(c.role))
    if (!bySeg.has(s)) bySeg.set(s, [])
    bySeg.get(s).push(c)
  }
  const out = []
  for (const c of rec?.cells ?? []) {
    if (!decorFernRole(c?.role) || !Array.isArray(c.at)) continue
    const s = String(c.seg ?? instOf(c.role))
    const i = bySeg.get(s).indexOf(c)
    if (i % FLOWER.keepEvery === keepPhase(s)) continue
    if (held(c.at[0], c.at[2])) continue
    if (nm(read(...c.at)) !== 'fern') continue
    out.push({ cell: c, i, k: i % 4 })
  }
  return out
}
/** The flower palette of an upgraded role: the batch's scheme rotated (decorInstance's f roles) WITHOUT the fern. Pure. */
export function upgradePalette (rec, id, k) {
  const inst = (rec?.instances ?? []).find(q => q?.id === id)
  const list = SCHEMES[inst?.design?.scheme] ?? SCHEMES.mixed
  return rotList(list, k * 3)
}
/**
 * THE UPGRADE -> the new record | null (nothing to do). Pure. At most min(`flowers`, FLOWER.upgradeMax) candidates (upgradeCandidates,
 * in order) are re-roled `D<n>-u<k>` (their palette upgradePalette: added once per role), each kept in `upgraded` ({ at, from, role,
 * at time }) so the read can judge the cell's history; the cells keep their seg (the batch's runs) and zones (their own columns).
 */
export function withUpgrade (rec, cands, { flowers = 0, now = Date.now(), max = FLOWER.upgradeMax } = {}) {
  const take = (cands ?? []).slice(0, Math.max(0, Math.min(Math.floor(Number(flowers) || 0), max)))
  if (!rec || !take.length) return null
  const want = new Map(take.map(q => [kOf(q.cell.at), q]))
  const palette = { ...(rec.palette ?? {}) }
  const log = []
  const cells = (rec.cells ?? []).map(c => {
    const q = Array.isArray(c?.at) ? want.get(kOf(c.at)) : null
    if (!q || !decorFernRole(c.role)) return c
    const id = instOf(c.role), role = `${id}-u${q.k}`
    palette[role] ??= upgradePalette(rec, id, q.k)
    log.push({ at: c.at.slice(), from: c.role, role, upgradedAt: now })
    return { ...c, role }
  })
  if (!log.length) return null
  return { ...rec, cells, palette, upgraded: [...(rec.upgraded ?? []), ...log], upgradedAt: now }
}
/**
 * THE WILD FLOWER PICK'S TARGETS -> [{ at, name }] nearest `from` first, at most `max` and `want`. Pure (decorator-02 fernTargets'
 * rule for a small flower). A small flower standing on soil, picked in its own cell (no collision: the picker stands in it); never a
 * reserved column (zones, the plan, the park), a record's column or cell (the decor's own borders, the park's beds), inside the town's
 * walls (`inside`: the lawns are the town's), within NURSERY.spread of a nursery centre (`nurseries`: the nursery's own harvest), or
 * beyond `r` of home.
 */
export function flowerTargets (cands, { read, reserved = () => null, guard = { cols: new Set(), cells: new Set() }, home, from = null, inside = () => false, nurseries = [], max = FLOWER.wildMax, want = FLOWER.wildWant, r = FLOWER.wildR } = {}) {
  const f = from ?? [home.x, home.y, home.z]
  const order = (cands ?? []).filter(c => Array.isArray(c?.at)).slice().sort((a, b) => (Math.abs(a.at[0] - f[0]) + Math.abs(a.at[1] - f[1]) + Math.abs(a.at[2] - f[2])) - (Math.abs(b.at[0] - f[0]) + Math.abs(b.at[1] - f[1]) + Math.abs(b.at[2] - f[2])) || a.at[0] - b.at[0] || a.at[2] - b.at[2] || a.at[1] - b.at[1])
  const out = [], seen = new Set()
  for (const c of order) {
    if (out.length >= Math.min(max, want)) break
    const [x, y, z] = c.at
    const here = nm(read(x, y, z))
    if (!SMALL_SET2.has(here) || here !== nm({ name: c.name })) continue
    if (Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) > r) continue
    if (!BORDER_SOIL.test(nm(read(x, y - 1, z)))) continue
    if (reserved(x, z) || inside(x, z)) continue
    if (guard.cols?.has?.(k2(x, z)) || guard.cells?.has?.(kOf([x, y, z]))) continue
    if ((nurseries ?? []).some(a => Array.isArray(a) && Math.max(Math.abs(x - a[0]), Math.abs(z - a[2])) <= NURSERY.spread)) continue
    const k = kOf([x, y, z])
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ at: [x, y, z], name: here })
  }
  return out
}
/**
 * THE NURSERY'S CLEARING BEFORE A MEAL -> { digs: [{ at, name, d }], open, landing, ready }. Pure. Paper 11-07: a meal lands only on
 * open cells over grass and is refused outright when the centre's top is covered, so the WHOLE spread is cleared (was NURSERY.clearR 2):
 * every flower and short/tall grass standing on grass within NURSERY.spread (never a record cell), the core's first (nearest the centre).
 * `ready`: the centre's top is open and at least FLOWER.coreOpen of the core's landing cells are open.
 */
export function nurseryClearing (read, nursery, { guard = { cells: new Set() } } = {}) {
  const [cx, cy, cz] = nursery.at
  const R = NURSERY.spread
  const digs = []
  let open = 0, landing = 0, centreOpen = false
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
    const x = cx + dx, z = cz + dz
    const g = grassTop(read, x, z, cy)
    if (g == null) continue
    const at = [x, g + 1, z]
    const n = nm(read(...at))
    const d = Math.max(Math.abs(dx), Math.abs(dz))
    const plant = BLOOM_SET.has(n) && !guard.cells.has(kOf(at))
    if (d <= NURSERY.core) { landing++; if (AIRN(n)) open++ }
    if (!dx && !dz) centreOpen = AIRN(n)
    if (plant) digs.push({ at, name: n, d })
  }
  digs.sort((a, b) => a.d - b.d || a.at[0] - b.at[0] || a.at[2] - b.at[2])
  return { digs, open, landing, ready: centreOpen && landing > 0 && open >= FLOWER.coreOpen * landing }
}
/**
 * THE DECORATOR'S FLOWER WORK -> { want, why }. Pure. Is there a border to upgrade (`cands` upgrade candidates, `owed` upgraded cells
 * still holding their fern) AND a supply step this visit can take: flowers in the bag (place them), bone meal to use (the bag's, the
 * town's above NURSERY.mealKeep), composter feed in the bag (DRIVE.feedMin), wild flowers in reach (`wild`), or feed ferns to cut
 * (shears or iron for them, `wildFerns`, the town's meal under DRIVE.target)? A visit that then changes nothing is the decor's stall
 * (decorStalled: the no-site wait) -- the decorator is let go; the ferns stay.
 */
export function flowerWork ({ cands = 0, owed = 0, flowers = 0, meal = 0, feed = 0, wild = 0, wildFerns = 0, shears = false, townMeal = null } = {}) {
  if (!(Number(cands) > 0 || Number(owed) > 0)) return { want: false, why: 'no_border' }
  if (Number(flowers) > 0) return { want: true, why: 'flowers' }
  if (Number(meal) > 0) return { want: true, why: 'meal' }
  if (Number(feed) >= DRIVE.feedMin) return { want: true, why: 'feed' }
  if (Number(wild) > 0) return { want: true, why: 'wild' }
  if (shears && Number(wildFerns) > 0 && Number.isFinite(townMeal) && townMeal < DRIVE.target) return { want: true, why: 'fern_feed' }
  return { want: false, why: 'no_supply' }
}
/** The feed ferns the gather fills the bag to -> n: FLOWER.feedKeep (kept for fern repairs) + FLOWER.feedWant while the town's bone
 *  meal (read) is under DRIVE.target and there is a border to upgrade; else 0. Pure. */
export const feedFernNeed = ({ held = {}, townMeal = null, work = false } = {}) => (work && Number.isFinite(townMeal) && townMeal < DRIVE.target ? Math.max(0, FLOWER.feedKeep + FLOWER.feedWant - (Number(held?.fern) || 0)) : 0)
/** THE COMPOST DRIVE'S FERN ALLOWANCE -> the ferns above FLOWER.feedKeep go in (the rest stay the border's). Pure. */
export const feedFerns = (held = {}) => Math.max(0, (Number(held?.fern) || 0) - FLOWER.feedKeep)

// ==== FLOWERS-02: THE LAWN SCATTER (OWNER 11-07: "lawns with flowers and tall grass scattered"; coordinator 11-07: "never on paths/
// plots/farms/records; density cap so lawns aren't overgrown; supply from the fixed nursery/composter"). Design
// docs/reports/flowers-design-2026-11-07.md section 8 (Claude + Codex reconciled). MEASURED 11-07: inside the wall ring 1,661 grass-
// topped columns, 68 with a plant (4.1%, 52 of them the border's ferns), ONE flower. Paper (sandbox8, flower-proof3.cjs): one meal on a
// taiga lawn with a dirt path and a cobble path through its spread grows 18-23 plants (short grass, 1-4 tall grass, 0-6 flowers), ALL
// within 4 columns of the centre, NONE on a path and none beyond the dirt path (the walk steps only onto grass): density 0.09-0.12 over
// the spread's grass, ~0.25 over its core. THE MECHANISM: the decorator's bone meal on a LAWN CENTRE -- the vanilla scatter is the
// natural density -- ONE meal a centre for good, the centre published on the decor record (`lawns`) before the meal (the read's DC7),
// only inside the walls, only on a window the survey proves clear of every record, reservation, path, park and nursery, only while the
// window is still sparse (the gate), and only when the border wants no flower (its upgrade first: the bone meal's priority).
export const LAWN = Object.freeze({
  spread: 7,          // the meal's reach (NURSERY.spread: the walk's 7 steps)
  core: 4,            // where the plants land (Paper: all within 4)
  coreMin: 60,        // grass supports a lawn's core needs (of 81)
  spreadMin: 150,     // ...and its spread (of 225)
  coreMax: 0.10,      // the gate: plants per grass support in the core (the vanilla meal leaves ~0.25 there: a lawn is fed once)
  spreadMax: 0.12,    // ...in the spread (a neighbour's scatter, ~0.10, passes; two meals on one window do not)
  flowersMax: 4,      // ...flowers standing in the spread
  gap: 10,            // centres at least this far apart (Chebyshev): the cores never overlap
  searchR: 64,        // the search's reach from home (inside the walls only)
  step: 2,            // the search grid
  stallMs: 2 * 60 * 60_000,
})
/** The lawn scatter's switch: LAWNS=on|off, default on (under FLOWERS and the decorator's own switch). Pure. */
export const lawnsOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.LAWNS ?? '').trim())
const PLANT_ANY = new Set([...SMALL_FLOWERS, 'short_grass', 'tall_grass', 'fern', 'large_fern', 'bush', 'sweet_berry_bush', 'dead_bush', 'firefly_bush'])
const TALL_ANY = new Set(['tall_grass', 'large_fern', 'lilac', 'rose_bush', 'peony', 'sunflower'])
/**
 * ONE COLUMN FOR THE LAWN -> 'refused:<why>' | 'unread' | { y, plant: name | null } | null (no grass support: nothing lands there).
 * Pure. The reservations FIRST, whatever the ground (Codex design: a refused column is refused even when nothing could land on it now):
 * outside the walls (`inside`), reserved (zones, the plan, corridors, the park, wells, the farm, markers: decorReservedFor), a record's
 * column or a record cell on it (`guard`), a nursery's or another lawn's box (`avoid(x, z)`). Then its ground: the highest grass block
 * within LAWN.spread of the centre's height with an open cell or a plant above (a plant counts: the support is the lawn's).
 */
export function lawnColumn (read, x, z, y, { guard, reserved = () => null, inside = () => true, avoid = () => false } = {}) {
  if (!inside(x, z)) return 'refused:outside'
  const why = reserved(x, z)
  if (why) return `refused:${String(why).slice(0, 24)}`
  if (guard?.cols?.has?.(k2(x, z))) return 'refused:record'
  if (avoid(x, z)) return 'refused:avoid'
  for (let g = y + LAWN.spread; g >= y - LAWN.spread; g--) {
    const b = read(x, g, z)
    if (!b) return 'unread'
    if (GRASS(b)) {
      const a = read(x, g + 1, z)
      if (!a) return 'unread'
      const n = nm(a)
      if (guard?.cells?.has?.(kOf([x, g + 1, z])) || guard?.cells?.has?.(kOf([x, g, z]))) return 'refused:record_cell'
      if (AIRN(n)) return { y: g, plant: null }
      if (PLANT_ANY.has(n)) return { y: g, plant: n }
      return null
    }
    if (b.boundingBox === 'block' && !/leaves$/.test(nm(b))) return null
  }
  return null
}
/**
 * THE LAWN SURVEY OF A CENTRE -> { ok, why, L, P, F, T, coreL, coreP }. Pure. Every column within LAWN.spread (lawnColumn): any refusal
 * or an unread column refuses the window; L the grass supports, P those carrying a plant, F flowers, T tall plants, and the core's L and P.
 * The centre must be a grass support with an OPEN top (Paper: a covered centre refuses the meal).
 */
export function lawnSurvey (read, centre, opts = {}) {
  const [cx, cy, cz] = centre
  const c0 = lawnColumn(read, cx, cz, cy, opts)
  if (typeof c0 === 'string') return { ok: false, why: c0 }
  if (!c0 || c0.y !== cy || c0.plant) return { ok: false, why: 'centre' }
  let L = 0, P = 0, F = 0, T = 0, coreL = 0, coreP = 0
  for (let dx = -LAWN.spread; dx <= LAWN.spread; dx++) for (let dz = -LAWN.spread; dz <= LAWN.spread; dz++) {
    const v = lawnColumn(read, cx + dx, cz + dz, cy, opts)
    if (typeof v === 'string') return { ok: false, why: v }
    if (!v) continue
    const core = Math.max(Math.abs(dx), Math.abs(dz)) <= LAWN.core
    L++; if (core) coreL++
    if (v.plant) { P++; if (core) coreP++; if (SMALL_SET2.has(v.plant)) F++; if (TALL_ANY.has(v.plant)) T++ }
  }
  return { ok: true, why: 'ok', L, P, F, T, coreL, coreP }
}
/** THE GATE: is a surveyed window a sparse lawn a meal may scatter on? -> { ok, why }. Pure. */
export function lawnGate (s) {
  if (!s?.ok) return { ok: false, why: s?.why ?? 'unsurveyed' }
  if (s.coreL < LAWN.coreMin) return { ok: false, why: `thin_core:${s.coreL}` }
  if (s.L < LAWN.spreadMin) return { ok: false, why: `thin:${s.L}` }
  if (s.coreP / s.coreL > LAWN.coreMax) return { ok: false, why: 'dense_core' }
  if (s.P / s.L > LAWN.spreadMax) return { ok: false, why: 'dense' }
  if (s.F >= LAWN.flowersMax) return { ok: false, why: 'flowered' }
  return { ok: true, why: 'ok' }
}
/** The lawns' and nurseries' centres on a decor record -> [[x, y, z]]. Pure. */
export const lawnCentres = rec => (rec?.lawns ?? []).map(q => q?.at).filter(a => Array.isArray(a) && a.length === 3)
/** A box of a centre at radius r -> (x, z) -> bool. Pure. */
const nearAny = (centres, r) => (x, z) => centres.some(a => Math.max(Math.abs(x - a[0]), Math.abs(z - a[2])) <= r)
/**
 * SITE THE NEXT LAWN -> { ok, lawn: { at, box, L, P }, tried } | { ok: false, why, tried }. Pure. The centres on a LAWN.step grid by ring
 * from home (out to LAWN.searchR), each at least LAWN.gap from every lawn on the record and clear of every nursery's spread (its window
 * keeps 2 x spread off a nursery centre: no plant of a lawn is ever the nursery's harvest), whose survey passes the gate; the first wins.
 * `ground(x, z)` the centre's grass height (grassTop at home's height: the caller's).
 */
export function siteLawn (read, home, { guard, reserved = () => null, inside = () => true, lawns = [], nurseries = [], ground = null, searchR = LAWN.searchR } = {}) {
  const tried = {}
  const nearLawn = nearAny(lawns, LAWN.gap - 1), nearNursery = nearAny(nurseries, NURSERY.spread * 2)
  const avoid = nearAny(nurseries, NURSERY.spread)
  const gnd = ground ?? ((x, z) => grassTop(read, x, z, home.y))
  for (let r = 0; r <= searchR; r += LAWN.step) {
    const ring = []
    for (let d = -r; d <= r; d += LAWN.step) ring.push([d, -r], [d, r], ...(Math.abs(d) < r ? [[-r, d], [r, d]] : []))
    if (r === 0) ring.splice(0, ring.length, [0, 0])
    ring.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    for (const [dx, dz] of ring) {
      const x = home.x + dx, z = home.z + dz
      if (!inside(x, z)) continue
      if (nearLawn(x, z)) { tried.gap = (tried.gap ?? 0) + 1; continue }
      if (nearNursery(x, z)) { tried.nursery = (tried.nursery ?? 0) + 1; continue }
      const g = gnd(x, z)
      if (g == null) { tried.ground = (tried.ground ?? 0) + 1; continue }
      const s = lawnSurvey(read, [x, g, z], { guard, reserved, inside, avoid })
      const v = lawnGate(s)
      if (v.ok) return { ok: true, lawn: { at: [x, g, z], box: [x - LAWN.spread, z - LAWN.spread, x + LAWN.spread, z + LAWN.spread], L: s.L, P: s.P }, tried }
      const k = String(v.why).replace(/:.*$/, '')
      tried[k] = (tried[k] ?? 0) + 1
    }
  }
  return { ok: false, why: 'no_lawn', tried }
}
/** THE LAWN ON THE RECORD (claimed before its one meal: never fed again) -> the new record. Pure. */
export const withLawn = (cur, lawn, { now = Date.now(), by = null } = {}) => ({ ...cur, lawns: [...(cur?.lawns ?? []), { at: lawn.at.slice(), box: lawn.box.slice(), sitedAt: now, by, L: lawn.L, P: lawn.P }] })
/**
 * THE LAWN WORK -> { want, why }. Pure. Only when the border wants no flower (`border`: its upgrade candidates or upgraded cells still
 * standing a fern -- the nursery's meals go there first) and the lawn search is not stalled; then a meal to use (the bag's, the town's
 * above NURSERY.mealKeep), or the composter's feed to make one (the bag's feed, or a feed fern to cut while the town's meal is under
 * DRIVE.target).
 */
export function lawnWork ({ border = 0, stalled = false, meal = 0, feed = 0, shears = false, wildFerns = 0, townMeal = null } = {}) {
  if (Number(border) > 0) return { want: false, why: 'border_first' }
  if (stalled) return { want: false, why: 'stalled' }
  if (Number(meal) > 0) return { want: true, why: 'lawn_meal' }
  if (Number(feed) >= DRIVE.feedMin) return { want: true, why: 'lawn_feed' }
  if (shears && Number(wildFerns) > 0 && Number.isFinite(townMeal) && townMeal < DRIVE.target) return { want: true, why: 'lawn_fern_feed' }
  return { want: false, why: 'no_supply' }
}
/** Every lawn and nursery box of a decor record -> (x, z) -> reason | null: the fern gather, the wild pick and a new nursery keep off a
 *  lawn (its plants are the lawn's) and its 7-spread. Pure. */
export const lawnReserved = rec => { const c = lawnCentres(rec); return (x, z) => (c.some(a => Math.max(Math.abs(x - a[0]), Math.abs(z - a[2])) <= LAWN.spread) ? 'lawn' : null) }
