// PICKER-01 + THE FIRST TOWN SINKS (OWNER 11-02 resource model §12 Q3 "roads, wall towers AND ziggurat growth", towers and
// ziggurats with DESIGN CREATIVITY -- seeded variety, never one template; OWNER 11-03 "i agree to all those things, do it").
// Design: docs/reports/picker-sinks-2026-11-03.md (Claude + Codex, reconciled), from docs/reports/resource-management-2026-11-02.md
// rows 6 (picker-01) and 7 (sinkrate-01) and its Sinks catalogue.
//
// PURE: the switch, the pressure, the picker's gate and order, the three sinks' seeded designs, their cells and segments, the
// siting screen and the build proof (over a `read(x, y, z)`), the growing record, the visit's options and the rows. Nothing here
// touches a bot or a file: shop.mjs puts the sinks in the project order, skills.mjs buildSink sites and builds them with the
// project machinery every other building uses (buildproj.mjs records, slots and segment leases; buildrun.mjs runVisit).
//
// THE MODEL. A sink is a PROJECT PLOT whose record GROWS: each sited INSTANCE (a tower, a shrine, a road segment) is appended to the
// plot's one record chain (`project-<home>.tower` / `.shrine` / `.road`) -- its cells, its segments, its palette roles (namespaced
// by the instance id, `T2-b0`), its reservation zone -- and the record reads open until that instance stands. Nothing is ever
// removed from a record, so every finished instance stays protected (keep-outs, the footprint, the tidy's guard, siting zones, the
// escape guard: skills.mjs escapeRecordSnapshot reads every PROJECTS plot) and is REPAIRED by the ordinary visit (a damaged complete
// record is a repair, first). Each instance's bill is BOUNDED (SINK.billMax): an instance is its own phase.
//
// THE PICKER (shop.mjs activeProject): repairs first; then the town's finite projects in their order; then the bounded upkeeps
// that go first (`dueFirst`); then a SINK -- an open instance first, else the next instance of the kind this rotation names --
// only while the town's stone is above its target (sinkPressure > 0); then every other upkeep (`due`; after SINK_STREAK sink
// visits a bot's next pick is an upkeep, so neither starves the other). The tidy stays last. A waiting finite project (the copper
// hall) is served first by its own ask (the copper run), before any sink order.
//
// THE THROUGHPUT (sinkrate-01): SINK_BUILDERS slots per plot, a layer split in four quadrant segments (the ziggurat's layer
// barrier), bills drawn from the bag first (the bags hold 400-800 cobblestone on the showcase), solid repetitive bodies a builder
// fills standing on the layer below: the ziggurat's 41 blocks a placing visit is the rate this is built for.

import { fnv1a, rng } from './zigdesign.mjs'
import { walkFrom, stepFor, overlay, solidFloor } from './buildsite.mjs'
import { isLiquid, isPassable, isTreeish, replaceableCell, isFurniture } from './townplan.mjs'
import { TOWN_COBBLE_CAP } from './stocktarget.mjs'
import { matsReserve } from './mats.mjs'   // the owner's reserve table, read through its one reader (matset.test)
import { siteDress, DRESS } from './towndress.mjs'   // towndress-01: the fourth sink, lights and signs
import { siteDecor, DECOR, decorFlowerRole } from './decorator.mjs'   // decorator-01: the fifth sink, the decorator's flowers and pots

const k3 = (x, y, z) => `${x},${y},${z}`
const kOf = a => `${a[0]},${a[1]},${a[2]}`
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const wet = b => !!b && (isLiquid(b) || /waterlogged/.test(String(b.name ?? '')))

// ---- the plots, the switch, the constants -------------------------------------------------------------------------------------
// towndress-01: `dress` -- batches of lamps, wall-top torches and named signposts (towndress.mjs)
// decorator-01: `decor` -- the decorator's flower borders and door pots (decorator.mjs; one bot a town on the `decorator` lease)
export const SINK_KINDS = Object.freeze(['road', 'tower', 'shrine', 'dress', 'decor'])
export const SINK_PLOTS = Object.freeze({ road: 'road', tower: 'tower', shrine: 'shrine', dress: 'dress', decor: 'decor' })
export const SINK_BLUEPRINTS = Object.freeze({ road: 'road@1', tower: 'tower@1', shrine: 'shrine@1', dress: 'dress@1', decor: 'decor@1' })
const KIND_OF_PLOT = Object.freeze(Object.fromEntries(SINK_KINDS.map(k => [SINK_PLOTS[k], k])))
const KIND_OF_BP = Object.freeze(Object.fromEntries(SINK_KINDS.map(k => [SINK_BLUEPRINTS[k], k])))
export const isSinkPlot = plot => Object.prototype.hasOwnProperty.call(KIND_OF_PLOT, plot)
export const isSinkBlueprint = id => Object.prototype.hasOwnProperty.call(KIND_OF_BP, id)
export const sinkKindOf = plotOrBp => KIND_OF_PLOT[plotOrBp] ?? KIND_OF_BP[plotOrBp] ?? null
/** The instance id's letter per kind (a segment name `T2-L03-N`; buildproj's lease names take [A-Za-z0-9-] only). */
export const SINK_LETTER = Object.freeze({ road: 'R', tower: 'T', shrine: 'Z', dress: 'L', decor: 'D' })
export const SINK_BUILDERS = 3
/** After this many sink visits in a row a bot's next pick lets an upkeep (`due`) go first (Codex design: neither starves). */
export const SINK_STREAK = 3
export const SINK = Object.freeze({
  maxOpen: 2,                 // open instances a town at once (resource model §6), across the three plots
  billMax: 512,               // an instance's whole bill: its own bounded phase (the town's chests hold 1,000 cobblestone)
  bagKeep: 64,                // the bag's cobblestone the pressure never counts (the escape stone: STONE_GUARD, COBBLE_RESERVE)
  target: TOWN_COBBLE_CAP,    // TARGET: the town's chests at their cap
  low: Number(matsReserve().table?.cobblestone) || 256,   // LOW: the owner's reserve (10-23, MATS_RESERVE) -- funding never counts below it
  highSpan: 512,              // HIGH - TARGET without a yard read (the 1x yard holds 304, the 2x 656)
  instancesMax: Object.freeze({ road: 6, tower: 8, shrine: 6, dress: DRESS.instancesMax, decor: DECOR.instancesMax }),
  noSiteMs: 6 * 60 * 60_000,  // a kind that found no site waits this long (per bot) before it is searched again
  cooldownMs: 3 * 60_000,     // the order's cooldown on a sink visit (the stair's is 2 min; every other project's 10)
  proofTries: 12,             // proofs per siting (each a construction simulation)
  proofsPerCandidate: 2,      // sinkfix-02: one bad spot never spends every proof (LIVE 11-04: `corner:proof_no_step6`, 6 of 6 on one corner)
})
/** The rotation the picker walks (owner 11-02 Q3: roads first -- useful for the way home, flat, a high placement rate). */
// towndress-01: the dress batch first (OWNER 11-03: lighting + signs the first piece; it spends torches, never the stone the others wait on)
// decorator-01: the decor last (only its decorator is ever offered it: skills.mjs decorOrder)
export const SINK_ROTATION = Object.freeze(['dress', 'road', 'tower', 'shrine', 'decor'])
/**
 * SINKFIX-04: THE TOWN'S NO-SITE STAMPS (LIVE showcase 11-04 10:44-11:47Z, 15 bots restarted 10:43: road 17, shrine 15, dress 12
 * visits, every one `no_site` -- one a bot a kind, because the no-site wait and the idle marks live in each bot's memory). A kind
 * that found no site is held for every bot of the town for TOWN_NOSITE_MS (a town file); each bot's own SINK.noSiteMs wait stays.
 * Pure: the stamps are a { kind: until } map.
 */
export const TOWN_NOSITE_MS = 2 * 60 * 60_000
export const noSiteStamped = (map = {}, kind, now = Date.now()) => ({ ...(map && typeof map === 'object' ? map : {}), [kind]: now + TOWN_NOSITE_MS })
/** The wait a kind is under for this bot -> ms: the later of its own and the town's. Pure. */
export const noSiteUntilOf = (own = {}, town = {}, kind) => Math.max(Number(own?.[kind]) || 0, Number(town?.[kind]) || 0)

/**
 * THE SWITCH -> bool. SINKS=on|off; unset = on in the pools SINKS_POOLS names (default 'showcase': a showcase piece first, the
 * fleet only after its read). SINKS=off is the rollback: no sink in the project order, the order quiet when the list stands,
 * exactly as before; a sited instance's cells stay protected (shop.mjs projectsGuarded keeps every sink plot). Pure.
 */
export function sinksOn (env = process.env, pool = '') {
  const v = String(env?.SINKS ?? '').trim().toLowerCase()
  if (v === 'on' || v === '1' || v === 'true') return true
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  const pools = String(env?.SINKS_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}
/** Which kinds are on (SINK_KINDS, a comma list; default all three). Pure. */
export function sinkKindsOn (env = process.env) {
  const raw = String(env?.SINK_KINDS ?? '').trim()
  if (!raw) return SINK_KINDS.slice()
  const want = new Set(raw.split(',').map(s => s.trim().toLowerCase()))
  return SINK_KINDS.filter(k => want.has(k))
}

// ---- the pressure (resource model §6: (available - TARGET) / (HIGH - TARGET) of the main material) -----------------------------
const COBBLE_FAMILY = ['cobblestone', 'cobbled_deepslate']
const famOf = m => COBBLE_FAMILY.reduce((t, n) => t + Math.max(0, Number(m?.[n]) || 0), 0)
/**
 * THE STONE PRESSURE -> { p, avail, known, town, bag }. Pure. `town` the town index's stock ({ name: n }) with its `coverage`; `bag`
 * this bot's bag. Available = the town's cobble family + THIS bot's own bag cobble family above SINK.bagKeep (the bag is where the
 * surplus sits: 5,551 cobblestone in 10 showcase bags on 11-03; other bots' bags are never counted -- each bot pledges only its
 * own). An UNREAD town (no stock, or coverage below 0.8) counts as exactly TARGET -- neither surplus nor shortage -- so only the
 * bag's own surplus can open a sink there. p > 0 opens a sink; p is clamped to [-1, 2] (the rows print it).
 */
export function sinkPressure ({ town = null, coverage = 0, bag = {}, yardSlots = null, target = SINK.target } = {}) {
  const known = !!town && Number(coverage) >= 0.8
  const t = known ? famOf(town) : target
  const b = Math.max(0, famOf(bag) - SINK.bagKeep)
  const span = Number.isFinite(yardSlots) && yardSlots > 0 ? yardSlots : SINK.highSpan
  const avail = t + b
  const p = Math.max(-1, Math.min(2, (avail - target) / span))
  return { p: Math.round(p * 100) / 100, avail, known, town: known ? t : null, bag: b }
}
/**
 * CAN THE INSTANCE'S WHOLE BILL BE PAID? -> bool. Pure. The cobble family the bill takes, out of the town's stock ABOVE LOW (the
 * owner's BUILD_RESERVE: projects never draw the town below it) plus this bot's own bag above SINK.bagKeep; an unread town
 * contributes nothing. Codex design: "require its complete bill coverable".
 */
export function sinkFundable (bill = 0, { town = null, coverage = 0, bag = {} } = {}) {
  const known = !!town && Number(coverage) >= 0.8
  const t = known ? Math.max(0, famOf(town) - SINK.low) : 0
  return t + Math.max(0, famOf(bag) - SINK.bagKeep) >= bill
}

// ---- the picker: may a kind open its next instance, and in what order are the sinks offered ------------------------------------
/** A sink record's instances -> [] (an older or foreign record: none). Pure. */
export const instancesOf = rec => (Array.isArray(rec?.instances) ? rec.instances : [])
/** Is a sink record OPEN (its newest instance not standing)? A record with no instance is not. Pure. */
export const sinkOpen = rec => !!rec && instancesOf(rec).length > 0 && !rec.structure_complete
/**
 * MAY THIS KIND SITE ITS NEXT INSTANCE NOW? -> { want, why }. Pure. Never while its own record is open (one open instance a plot),
 * never past SINK.maxOpen open instances in the town, never past the kind's instancesMax, never inside this bot's no-site wait,
 * only on a positive pressure, never with the kind switched off or its precondition missing (`ready`: a road needs the land
 * plan's rails, a shrine the ziggurat, towers nothing).
 */
export function sinkNextGate ({ kind, rec = null, pressure = null, openCount = 0, noSiteUntil = 0, now = 0, ready = true, on = true } = {}) {
  if (!on) return { want: false, why: 'off' }
  if (!SINK_KINDS.includes(kind)) return { want: false, why: 'kind' }
  if (!ready) return { want: false, why: 'not_ready' }
  if (sinkOpen(rec)) return { want: false, why: 'open' }
  // decorator-01: a decor batch spends flowers and pots, never stone: no stone sink holds it back
  if (kind !== 'dress' && kind !== 'decor' && openCount >= SINK.maxOpen) return { want: false, why: 'max_open' }
  if (instancesOf(rec).length >= (SINK.instancesMax[kind] ?? 0)) return { want: false, why: 'max_instances' }
  if (now < (Number(noSiteUntil) || 0)) return { want: false, why: 'no_site_wait' }
  if (!(Number(pressure?.p) > 0)) return { want: false, why: 'no_pressure' }
  return { want: true, why: 'ok' }
}
/** THE OPEN STONE SINKS counted against SINK.maxOpen -> n. Pure. A dress batch (towndress.mjs) spends torches, never the stone the
 *  others wait on, so it never holds a stone sink back -- nor is it held back by them (sinkfix-02, LIVE 11-04: dress never ran). */
export const stoneOpenCount = (recs = {}) => SINK_KINDS.filter(k => k !== 'dress' && k !== 'decor' && sinkOpen(recs[k])).length
/** The kind sited most recently in this town (the rotation's position) -> kind | null. `recs` { kind: record }. Pure. */
export function lastSitedKind (recs = {}) {
  let best = null, at = -Infinity
  for (const k of SINK_KINDS) for (const i of instancesOf(recs[k])) if (Number(i?.sitedAt) > at) { at = Number(i.sitedAt); best = k }
  return best
}
/**
 * THE SINKS IN THE ORDER THE PICKER OFFERS THEM -> [kind]. Pure. An OPEN instance first (finish what stands half built: the oldest
 * sited first), then the kinds that may site next in rotation order after the last kind sited (SINK_ROTATION: road -> tower ->
 * shrine -> road), so consecutive instances vary; a kind that is neither open nor wanted is left out.
 *   st  { kind: { open: bool, want: bool, sitedAt?: ms } }
 */
export function sinkOrder (st = {}, last = null) {
  const open = SINK_KINDS.filter(k => st[k]?.open).sort((a, b) => (Number(st[a].sitedAt) || 0) - (Number(st[b].sitedAt) || 0))
  const i0 = last ? SINK_ROTATION.indexOf(last) + 1 : 0
  const rot = SINK_ROTATION.map((_, i) => SINK_ROTATION[(i0 + i) % SINK_ROTATION.length])
  return [...open, ...rot.filter(k => !st[k]?.open && st[k]?.want)]
}

// ---- seeds and stones ------------------------------------------------------------------------------------------------------------
/** THE INSTANCE'S SEED: kind, pool, home and instance number (a home repeats between worlds, the pool does not). Pure. */
export const sinkSeed = (kind, pool, home, n) => fnv1a(`${kind}@1|${pool ?? ''}|${home?.x},${home?.y},${home?.z}|${n}`)
const pickOf = (r, xs) => xs[Math.floor(r() * xs.length) % xs.length]
/** The accent stones a design may use, each only when the town and the siting bot can pay for its cells (affordable). */
export const SINK_STONES = Object.freeze(['stone_bricks', 'mossy_cobblestone', 'andesite', 'diorite', 'granite', 'cobbled_deepslate', 'tuff', 'stone',
  'mossy_stone_bricks', 'polished_andesite', 'polished_diorite', 'polished_granite', 'deepslate_bricks', 'calcite', 'sandstone', 'smooth_stone'])
/** The share of an available stone one design may spend (the ziggurat v2's ZIG2.share). */
export const STONE_SHARE = 0.6
/** The hidden core and the foundation fill: any full solid is done; placed from whatever stone or dirt the bag carries. */
export const CORE_NAMES = Object.freeze(['*solid', 'cobblestone', 'cobbled_deepslate', 'dirt', 'andesite', 'diorite', 'granite', 'tuff', 'stone', 'coarse_dirt'])
/** What a visit may dig out of an open record cell: terrain, the pathfinder's scaffold, and the plants a placement does not replace. */
export const SINK_FOREIGN = /^(cobblestone|mossy_cobblestone|dirt|coarse_dirt|grass_block|podzol|rooted_dirt|mycelium|moss_block|stone|andesite|diorite|granite|tuff|netherrack|cobbled_deepslate|deepslate|gravel|sand|red_sand|clay|mud|snow_block|calcite|dripstone_block|smooth_basalt|[a-z_]+_sapling|mangrove_propagule|brown_mushroom|red_mushroom|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|sweet_berry_bush|bush|firefly_bush|leaf_litter|wildflowers|pink_petals|moss_carpet|short_dry_grass|tall_dry_grass|snow|torch|wall_torch|[a-z_]+_planks|sandstone|red_sandstone)$/
/**
 * THE STONES A DESIGN MAY CHOOSE FROM -> [name], in SINK_STONES order. Pure. `avail` { name: n } (the town's stock above its floor
 * plus the siting bot's bag above its keeps); `need` the cells the role would take. Cobblestone is never an accent (it is every
 * role's fallback, so no cell ever waits on a stone the town lacks).
 */
export const affordable = (avail = {}, need = 1) => SINK_STONES.filter(n => (Number(avail?.[n]) || 0) * STONE_SHARE >= need)

// ---- the stepped body: towers and shrines (a pyramid of square tiers built layer by layer, every climb +1) ---------------------
/**
 * A STEPPED SHAPE g = { B, S, H, n, W, stairs, spin, face0, all4 }:
 *   B odd base side; S the step-in per tier side (1|2); H layers a tier (1..4); n tiers (side B - 2S(n-1) >= 3)
 *   faces  the stair faces of tier t: one face per tier, turning `spin` (+1 clockwise, -1 counter) from face0 (toward home) -- a
 *          spiral round the tower -- or all four faces (`all4`: a shrine's grand stairs)
 *   W      stair width (1|3)
 *   stairs 'perp' (the ziggurat's: steps outward from the wall, d = 1..H-1, needs S >= H-1) | 'along' (a run of H-1 steps ALONG
 *          the terrace beside the wall, heights 1..H-1: a 1-wide terrace climbs H 3)
 * Every climb is +1: ground -> tier 0 by its stair, terrace t -> tier t+1 by its stair, and inside a tier each layer rests on the
 * last. Every drop off an edge is at most H (designs use H <= 3: no fall damage, Codex design "drops at most three"). Pure.
 */
const FACES = ['n', 'e', 's', 'w']
export const sideOf = (g, t) => g.B - 2 * g.S * t
export function stepShapeWhy (g) {
  if (!g || !Number.isInteger(g.B) || g.B % 2 === 0 || g.B < 3 || g.B > 15) return 'B'
  if (![1, 2].includes(g.S)) return 'S'
  if (!Number.isInteger(g.H) || g.H < 1 || g.H > 4) return 'H'
  if (!Number.isInteger(g.n) || g.n < 1 || sideOf(g, g.n - 1) < 3) return 'n'
  if (![1, 3].includes(g.W)) return 'W'
  if (!['perp', 'along'].includes(g.stairs)) return 'stairs'
  if (g.stairs === 'perp' && g.H - 1 > g.S && g.n > 1) return 'perp_needs_S'
  if (g.stairs === 'along' && (g.W !== 1 || g.H - 1 > sideOf(g, g.n - 1))) return 'along_run'
  // four stair faces on 1-wide terraces: tier t's stair lands on the cell tier t+1's stair stands in -- a +2 (sinks.test's climb)
  if (g.all4 && g.S === 1 && g.H > 1 && g.n > 1) return 'all4_needs_S2'
  if (!FACES.includes(g.face0)) return 'face0'
  if (![1, -1].includes(g.spin) && g.all4 !== true) return 'spin'
  return null
}
/** The stair faces of tier t. Pure. */
export const facesAt = (g, t) => (g.all4 ? FACES.slice() : [FACES[(((FACES.indexOf(g.face0) + g.spin * t) % 4) + 4) % 4]])
/** Is column (i, j) inside tier t's square? Pure. */
const inTier = (g, t, i, j) => { const o = g.S * t; return i >= o && j >= o && i <= g.B - 1 - o && j <= g.B - 1 - o }
/** The layers of solid at column (i, j) above the base (0 outside the base). Pure. */
export function stepProfile (g, i, j) {
  let l = 0
  for (let t = 0; t < g.n; t++) if (inTier(g, t, i, j)) l = (t + 1) * g.H
  return l
}
/** The quadrant of (i, j) about the base's centre -> N|E|S|W. Pure. */
export function quadOf (g, i, j) {
  const c = (g.B - 1) / 2, dx = i - c, dz = j - c
  if (Math.abs(dz) >= Math.abs(dx)) return dz < 0 ? 'N' : 'S'
  return dx > 0 ? 'E' : 'W'
}
/**
 * THE STAIR CELLS of tier t (the climb ONTO tier t: from the ground for t 0, from terrace t-1 above) -> [{ i, j, l }] (column offset,
 * layer). Pure. 'perp': W columns centred on the face, d = 1..H-1 out from tier t's wall, a stack H-d high from layer tH (the
 * ziggurat's stairSteps). 'along': H-1 steps beside the wall, centred on the face, k = 0..H-2 along it (spin's direction), each a
 * stack k+1 high. H 1: none (every tier is a +1 step).
 */
export function stairCells (g, t) {
  if (g.H <= 1) return []
  const o = g.S * t, L = sideOf(g, t), l0 = t * g.H, out = []
  for (const f of facesAt(g, t)) {
    const at = { n: (a, d) => [a, o - d], s: (a, d) => [a, g.B - 1 - o + d], w: (a, d) => [o - d, a], e: (a, d) => [g.B - 1 - o + d, a] }[f]
    const mid = o + (L - 1) / 2
    if (g.stairs === 'perp') {
      const w0 = mid - (g.W - 1) / 2
      for (let d = 1; d <= g.H - 1; d++) for (let w = 0; w < g.W; w++) { const [i, j] = at(w0 + w, d); for (let k = 0; k < g.H - d; k++) out.push({ i, j, l: l0 + k }) }
    } else {
      const run = g.H - 1, dir = g.spin === -1 ? -1 : 1
      const start = mid - dir * Math.floor((run - 1) / 2)
      for (let k = 0; k < run; k++) { const [i, j] = at(start + dir * k, 1); for (let h = 0; h <= k; h++) out.push({ i, j, l: l0 + h }) }
    }
  }
  return out
}
/**
 * THE STEPPED BODY -> [{ i, j, l, cat, t }] (column offset from the NW corner, layer above the base). Pure. Categories: core (hidden),
 * skin (exposed), quoin (a tier's corner column, exposed), trim (a tier's top edge), stair. The palette maps categories to roles.
 */
export function stepBody (g) {
  const top = g.n * g.H
  const solid = (i, l, j) => l >= 0 && l < stepProfile(g, i, j)
  const stairs = new Set()
  for (let t = 0; t < g.n; t++) for (const s of stairCells(g, t)) stairs.add(k3(s.i, s.l, s.j))
  const exposed = (i, l, j) => {
    for (let di = -1; di <= 1; di++) for (let dl = -1; dl <= 1; dl++) for (let dj = -1; dj <= 1; dj++) {
      if ((!di && !dl && !dj) || l + dl < 0) continue
      if (!solid(i + di, l + dl, j + dj) && !stairs.has(k3(i + di, l + dl, j + dj))) return true
    }
    return false
  }
  const out = []
  for (let l = 0; l < top; l++) {
    const t = Math.floor(l / g.H)
    for (let i = 0; i < g.B; i++) for (let j = 0; j < g.B; j++) {
      if (!solid(i, l, j)) continue
      if (!exposed(i, l, j)) { out.push({ i, j, l, cat: 'core', t }); continue }
      const o = g.S * t, L = sideOf(g, t)
      const corner = (i === o || i === o + L - 1) && (j === o || j === o + L - 1)
      const edge = l === (t + 1) * g.H - 1 && (i === o || j === o || i === o + L - 1 || j === o + L - 1)
      out.push({ i, j, l, cat: corner ? 'quoin' : edge ? 'trim' : 'skin', t })
    }
    for (let tt = 0; tt < g.n; tt++) for (const s of stairCells(g, tt)) if (s.l === l) out.push({ i: s.i, j: s.j, l, cat: 'stair', t: tt })
  }
  return out
}
/**
 * THE CROWN AND THE LIGHTS -> [{ i, j, l, cat }]. Pure. On the summit (tier n-1's top, layer nH):
 *   merlons  the summit ring's corners, and every other ring cell on a summit of 5+   (cat crown)
 *   brazier  a centre block, a campfire on it when `fire`                              (crown, fire)
 *   spire    a 2-high centre column                                                    (crown)
 *   temple   four corner posts 2 high (5+ summit), a brazier between them              (crown, fire)
 *   beacon   torches on the summit's corners                                           (light)
 * and, with `lights`, a torch on every terrace corner (the cell on tier t's top beside tier t+1's corner) -- the ziggurat v2's
 * corner lights. A builder places every crown cell standing on the summit (eye nH + 1.62): nothing above nH + 1 (a support's top
 * face must be below the eye).
 */
export function stepCrown (g, crown, { fire = false, lights = false } = {}) {
  const t = g.n - 1, o = g.S * t, L = sideOf(g, t), l = g.n * g.H, out = []
  const c = o + (L - 1) / 2
  const ring = (i, j) => i === o || j === o || i === o + L - 1 || j === o + L - 1
  const corners = [[o, o], [o + L - 1, o], [o, o + L - 1], [o + L - 1, o + L - 1]]
  if (crown === 'merlons') {
    for (let i = o; i < o + L; i++) for (let j = o; j < o + L; j++) {
      if (!ring(i, j)) continue
      const isCorner = corners.some(([a, b]) => a === i && b === j)
      if (isCorner || (L >= 5 && (i + j - 2 * o) % 2 === 0)) out.push({ i, j, l, cat: 'crown' })
    }
  } else if (crown === 'brazier') {
    out.push({ i: c, j: c, l, cat: 'crown' })
    if (fire) out.push({ i: c, j: c, l: l + 1, cat: 'fire' })
  } else if (crown === 'spire') {
    out.push({ i: c, j: c, l, cat: 'crown' }, { i: c, j: c, l: l + 1, cat: 'crown' })
  } else if (crown === 'temple') {
    if (L >= 5) for (const [a, b] of corners) out.push({ i: a, j: b, l, cat: 'crown' }, { i: a, j: b, l: l + 1, cat: 'crown' })
    out.push({ i: c, j: c, l, cat: 'crown' })
    if (fire) out.push({ i: c, j: c, l: l + 1, cat: 'fire' })
  } else if (crown === 'beacon') {
    for (const [a, b] of corners) out.push({ i: a, j: b, l, cat: 'light' })
  }
  if (lights) {
    for (let tt = 0; tt < g.n - 1; tt++) {
      const o1 = g.S * (tt + 1), L1 = sideOf(g, tt + 1), lt = (tt + 1) * g.H
      for (const [a, b] of [[o1 - 1, o1 - 1], [o1 + L1, o1 - 1], [o1 - 1, o1 + L1], [o1 + L1, o1 + L1]]) out.push({ i: a, j: b, l: lt, cat: 'light' })
    }
  }
  // a stair cell never holds a light (an `along` run may end on a terrace corner)
  const st = new Set()
  for (let tt = 0; tt < g.n; tt++) for (const s of stairCells(g, tt)) st.add(k3(s.i, s.l, s.j))
  return out.filter(q => !st.has(k3(q.i, q.l, q.j)))
}

// ---- the designs: the seeded knobs, fixed at siting -----------------------------------------------------------------------------
/**
 * A TOWER'S DESIGN from its seed -> { kind: 'tower', g, crown, palette: { pattern, a, b, quoin, trim, moss }, lights, fire }. Pure.
 * SHAPE: base 5|7|9, step-in 1, tier height 2|3 (a slim stepped tower 4..12 high, no drop over 3), the stair a spiral round it
 * (clockwise or not) starting on the face toward home -- 'along' runs on its 1-wide terraces. CROWN: merlons | brazier | spire |
 * beacon. PALETTE (from what the town can pay for): a pattern (solid | alternate | gradient | base), quoins and a trim course in a
 * second stone, moss. The bill is capped at SINK.billMax (a too-large draw steps the base down). `face0` toward home.
 */
export function towerDesign (seed, { avail = {}, face0 = 's', torch = false, campfire = false, pinB = null } = {}) {
  const r = rng(seed)
  let B = pickOf(r, [5, 7, 7, 9])
  // siteprep-01: a prepared plot's base (the draw is still made: every other knob stays the seed's)
  if ([5, 7, 9].includes(pinB)) B = pinB
  const H = pickOf(r, [2, 3, 3])
  const spin = r() < 0.5 ? 1 : -1
  const crown = pickOf(r, ['merlons', 'brazier', 'spire', 'beacon'])
  const pattern = pickOf(r, ['solid', 'alternate', 'gradient', 'base'])
  const quoinDraw = r(), trimDraw = r(), mossDraw = r(), stoneDraw = [r(), r(), r()]
  let g = null
  for (; B >= 5; B -= 2) {
    g = { B, S: 1, H, n: (B - 3) / 2 + 1, W: 1, stairs: H >= 3 ? 'along' : 'perp', spin, face0, all4: false }
    if (stepBody(g).length <= SINK.billMax - 16) break
  }
  const palette = stonePalette({ avail, cells: stepBody(g).length, pattern, quoin: quoinDraw < 0.6, trim: trimDraw < 0.5, moss: mossDraw < 0.4, draws: stoneDraw })
  return { kind: 'tower', g, crown: crown === 'beacon' && !torch ? 'merlons' : crown, palette, lights: !!torch, fire: !!campfire }
}
/**
 * A SHRINE'S DESIGN (ziggurat growth: a satellite step pyramid beside the town's ziggurat) from its seed -> the same shape as a
 * tower's design. Pure. SHAPE: base 7..13, (S, H) one of (1,1) (2,1) (2,2) (1,2), stairs on one face (toward home) or all four,
 * 1 or 3 wide, optionally truncated to a broad dais. SUMMIT: temple | brazier | spire | beacon. PALETTE: a pattern over the town's
 * stones, as a tower's. Twins: the caller seeds a mirrored PAIR with one seed.
 */
export function shrineDesign (seed, { avail = {}, face0 = 's', torch = false, campfire = false, pinB = null } = {}) {
  const r = rng(seed)
  let B = pickOf(r, [7, 9, 9, 11, 11, 13])
  if ([7, 9, 11, 13].includes(pinB)) B = pinB   // siteprep-01 (as towerDesign)
  const [S, H] = pickOf(r, [[1, 1], [2, 1], [2, 2], [1, 2], [2, 2]])
  const all4 = r() < 0.5
  const wide = r() < 0.5
  const trunc = pickOf(r, [0, 0, 1])
  const crown = pickOf(r, ['temple', 'brazier', 'spire', 'beacon'])
  const pattern = pickOf(r, ['solid', 'alternate', 'gradient', 'base'])
  const quoinDraw = r(), trimDraw = r(), mossDraw = r(), stoneDraw = [r(), r(), r()]
  let g = null
  for (; B >= 7; B -= 2) {
    const n = Math.max(1, Math.floor((B - 3) / (2 * S)) + 1 - trunc)
    const top = B - 2 * S * (n - 1)
    g = { B, S, H, n, W: wide && top >= 3 && H >= 2 ? 3 : 1, stairs: 'perp', spin: 1, face0, all4 }
    if (stepShapeWhy(g) === 'all4_needs_S2') g = { ...g, all4: false }
    if (stepShapeWhy(g)) g = { ...g, W: 1 }
    if (stepBody(g).length <= SINK.billMax - 24) break
  }
  const palette = stonePalette({ avail, cells: stepBody(g).length, pattern, quoin: quoinDraw < 0.5, trim: trimDraw < 0.6, moss: mossDraw < 0.5, draws: stoneDraw })
  return { kind: 'shrine', g, crown: crown === 'beacon' && !torch ? 'temple' : crown, palette, lights: !!torch, fire: !!campfire }
}
/**
 * THE STONES OF A DESIGN -> { pattern, a, b, quoin, trim, moss }. Pure. `a` the main stone, `b` the second (null: cobblestone alone),
 * each one the town can pay for at `cells` (a half of them, b a third); the draws pick among the affordable ones. A pattern needing a
 * second stone the town lacks falls back to `solid`; quoins/trim/moss only with a stone for them.
 */
export function stonePalette ({ avail = {}, cells = 0, pattern = 'solid', quoin = false, trim = false, moss = false, draws = [0, 0, 0] } = {}) {
  const big = affordable(avail, Math.ceil(cells * 0.5)).filter(n => n !== 'mossy_cobblestone')
  const small = affordable(avail, Math.ceil(cells / 3)).filter(n => n !== 'mossy_cobblestone')
  const pick = (xs, d) => (xs.length ? xs[Math.floor(d * xs.length) % xs.length] : null)
  const a = draws[0] < 0.5 ? 'cobblestone' : (pick(big, draws[1]) ?? 'cobblestone')
  const b = pick(small.filter(n => n !== a), draws[2])
  const mossOk = moss && affordable(avail, Math.ceil(cells / 5)).includes('mossy_cobblestone')
  return { pattern: b ? pattern : 'solid', a, b, quoin: quoin && !!b, trim: trim && !!b, moss: mossOk }
}
/** The stone a skin cell of tier t takes under a pattern (a / b; the gradient: b at the base tiers, a above). Pure. */
export function bandStone (pal, t, n) {
  const { pattern, a, b } = pal
  if (!b || pattern === 'solid') return a
  if (pattern === 'alternate') return t % 2 === 0 ? a : b
  if (pattern === 'gradient') return t < Math.ceil(n / 2) ? b : a
  if (pattern === 'base') return t === 0 ? b : a
  return a
}
/** A cell's own hash (the weathering's scatter). Pure. */
const cellHash = (seed, i, l, j) => fnv1a(`${seed}|${i},${l},${j}`)

// ---- an instance's world cells, segments and palette roles ----------------------------------------------------------------------
/** A design's ROLE NAME for a category: the instance id and a short tag (`T2-b0`, `T2-q`). Pure. */
export const roleOf = (id, tag) => `${id}-${tag}`
/** Is a role a walk-through one (a light or a fire: never an obstacle in the visit's walk)? Pure. */
// decorator-01: a decor border flower (`D3-f2`) is walked through like a light
export const sinkOpenRole = role => /-(light|fire)$/.test(String(role ?? '')) || decorFlowerRole(role)
/**
 * A STEPPED INSTANCE ON ITS SITE -> { cells, segments, palette, counts }. Pure. corner { x, z } the base's NW corner; baseY the y of
 * layer 0; fill [[x, y, z]] the foundation's cells (segment F). Segments: `<id>-F` first; one per layer and quadrant
 * `<id>-L03-N`, each waiting on every segment of the layer below (the layer barrier: 3 builders on 3 quadrants); the crown `<id>-C`
 * after the top layer; the lights and fire `<id>-D` last (a builder without a torch stops there, never before the body).
 */
export function stepInstance (id, design, { corner, baseY, fill = [], seed = 0, clear = [] } = {}) {
  const g = design.g, pal = design.palette
  const roles = {}
  const role = (tag, names) => { const r = roleOf(id, tag); roles[r] ??= names; return r }
  const cellsOut = []
  const at = (i, l, j) => [corner.x + i, baseY + l, corner.z + j]
  const segL = (l, q) => `${id}-L${String(l).padStart(2, '0')}-${q}`
  for (const f of fill) cellsOut.push({ at: f, role: role('core', CORE_NAMES.slice()), seg: `${id}-F` })
  const mossPct = pal.moss ? 15 : 0
  for (const c of stepBody(g)) {
    let r
    if (c.cat === 'core') r = role('core', CORE_NAMES.slice())
    else if (c.cat === 'stair') r = role('st', uniq([pal.b && pal.pattern !== 'solid' ? pal.b : pal.a, 'cobblestone']))
    else if (c.cat === 'quoin' && pal.quoin) r = role('q', uniq([pal.b, 'cobblestone']))
    else if (c.cat === 'trim' && pal.trim) r = role('tr', uniq([pal.b, 'cobblestone']))
    else {
      const s = bandStone(pal, c.t, g.n)
      if (mossPct && s === 'cobblestone' && cellHash(seed, c.i, c.l, c.j) % 100 < mossPct) r = role('m', ['mossy_cobblestone', 'cobblestone'])
      else r = role(`b${c.t}`, uniq([s, 'cobblestone']))
    }
    cellsOut.push({ at: at(c.i, c.l, c.j), role: r, seg: segL(c.l, quadOf(g, c.i, c.j)) })
  }
  for (const c of stepCrown(g, design.crown, { fire: design.fire, lights: design.lights })) {
    const r = c.cat === 'light' ? role('light', ['torch']) : c.cat === 'fire' ? role('fire', ['campfire']) : role('cr', uniq([pal.b ?? pal.a, 'cobblestone']))
    cellsOut.push({ at: at(c.i, c.l, c.j), role: r, seg: c.cat === 'crown' ? `${id}-C` : `${id}-D` })
  }
  return { cells: cellsOut, segments: segmentsFor(id, cellsOut), palette: roles, counts: countsOf(cellsOut), clear }
}
const uniq = xs => [...new Set(xs.filter(Boolean))]
const countsOf = cells => cells.reduce((m, c) => (m[c.role] = (m[c.role] ?? 0) + 1, m), {})
/** THE SEGMENTS of an instance's cells -> [{ seg, deps }] in build order. Pure. */
export function segmentsFor (id, cells) {
  const has = new Set(cells.map(c => c.seg))
  const out = []
  const F = `${id}-F`
  if (has.has(F)) out.push({ seg: F, deps: [] })
  const re = new RegExp(`^${id}-L(\\d\\d)-[NESW]$`)
  const layers = [...new Set(cells.map(c => re.exec(c.seg)?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b)
  let prev = has.has(F) ? [F] : []
  for (const l of layers) {
    const segs = ['N', 'E', 'S', 'W'].map(q => `${id}-L${String(l).padStart(2, '0')}-${q}`).filter(s => has.has(s))
    for (const s of segs) out.push({ seg: s, deps: prev })
    prev = segs
  }
  for (const tail of [`${id}-C`, `${id}-D`]) if (has.has(tail)) { out.push({ seg: tail, deps: prev }); prev = [tail] }
  // a road's segments: one per stretch, no barrier between them (`<id>-P<k>`), its lamps last (`<id>-PL`)
  const ps = [...has].filter(s => new RegExp(`^${id}-P\\d+$`).test(s)).sort((a, b) => Number(a.split('-P')[1]) - Number(b.split('-P')[1]))
  for (const s of ps) out.push({ seg: s, deps: [] })
  if (ps.length && has.has(`${id}-PL`)) out.push({ seg: `${id}-PL`, deps: ps })
  return out
}

// ---- the ground and the siting screen ------------------------------------------------------------------------------------------
/**
 * A COLUMN'S GROUND -> { y, logs: [{ y, name }], leaves: [{ y, name }] } | { why }. Pure. Scanned from yHi down: air, plants and
 * snow layers pass (a placement replaces them); LOGS and LEAVES pass too and are listed (the site's clears: a trunk standing in the
 * site's own columns is felled, its canopy there cleared -- the monument's and the wall's rule, no replant owed); the first other
 * block is the ground when it is a full-cube floor (natural or placed: buildsite.mjs solidFloor), else the column refuses:
 * `liquid` (a sink never builds in or beside water: stricter than the tidy's 11-01 rule, nothing to dam), `tree` (a mangrove root,
 * a stem, bamboo), `built` (furniture, a torch, a partial block), `unknown` (an unread cell: never a guess).
 */
export function groundAt (read, x, z, yHi, yLo) {
  const logs = [], leaves = []
  for (let y = yHi; y >= yLo; y--) {
    const b = read(x, y, z)
    if (!b) return { why: 'unknown' }
    const n = nm(b)
    if (n === 'air' || n === 'cave_air' || replaceableCell(b)) continue
    if (wet(b)) return { why: 'liquid' }
    if (/_(log|wood)$/.test(n) && !/^stripped_/.test(n)) { logs.push({ y, name: n }); continue }
    if (/_leaves$/.test(n)) { leaves.push({ y, name: n }); continue }
    if (/_sapling$|^mangrove_propagule$/.test(n)) { leaves.push({ y, name: n, plant: true }); continue }
    if (/^mangrove_roots$|_stem$|^bamboo$/.test(n) || isTreeish(b)) return { why: 'tree' }
    if (isPassable(b) && !/torch|lantern|rail|_sign$|_button$|lever|_carpet$|_pressure_plate$|campfire/.test(n) && !isFurniture(b)) continue
    if (solidFloor(b)) return { y, logs, leaves }
    return { why: 'built' }
  }
  return { why: 'no_ground' }
}
/** A site's clears from its columns' ground reads -> [{ at, kind: 'tree' | 'leaves', name }] (above each column's ground). Pure. */
export function clearsOf (cols) {
  const out = []
  for (const [x, z, gr] of cols) {
    for (const l of gr.logs ?? []) if (l.y > gr.y) out.push({ at: [x, l.y, z], kind: 'tree', name: l.name })
    for (const l of gr.leaves ?? []) if (l.y > gr.y) out.push({ at: [x, l.y, z], kind: l.plant ? 'plant' : 'leaves', name: l.name })
  }
  return out.sort((a, b) => a.at[1] - b.at[1])
}
export const SITE_LIM = Object.freeze({ fillCol: 3, baseFillCol: 2, cutCol: 3, fillShare: 0.4, cutMax: 120, apron: 2, scanUp: 30, scanDown: 14, liquidPad: 1, logsMax: 60 })
const GRAVITY = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]+_concrete_powder)$/
/** Natural ground a cut may dig (never a placed material, a gravity block, ore, or anything that is not terrain). Pure. */
export const CUTTABLE = /^(dirt|coarse_dirt|grass_block|podzol|rooted_dirt|mycelium|moss_block|stone|andesite|diorite|granite|tuff|deepslate|calcite|dripstone_block|clay|mud|snow_block|packed_ice|terracotta|[a-z_]+_terracotta|sandstone|red_sandstone|smooth_basalt|dirt_path)$/
/**
 * THE SCREEN OF A STEPPED SITE -> { ok, why, L, fill, clear, logs, cut, box } | { ok: false, why }. Pure. The base square
 * [x0..x0+B-1] x [z0..z0+B-1] and its APRON (Chebyshev 1..apron: the stand ring and the ground stair):
 *   - every column of the base, the apron and one more is clear of every reservation (`guard(x, z, y0, y1)` -> reason | null: the
 *     protected zones, the plan, wells, the farm, every other record + PROJECT_GAP, the land plan's corridors, a copper hall's pad,
 *     the markers) and of any liquid within one column from the level - 2 to the level + 2;
 *   - the LEVEL L (the base's floor; layer 0 at L+1) is the one of [lowest ground .. highest ground] with the least earthwork (fill
 *     + 2 x cut; ties: the higher): a base column below L is FILLED up to L (<= fillCol), one above is CUT down to L (<= cutCol, only
 *     CUTTABLE natural terrain, never under a gravity block); an apron column stands at L-1..L+1 or is cut to L; a ground-stair
 *     column stands exactly at L (or is cut to it);
 *   - the site's logs and leaves above the ground in its columns are its clears (at most logsMax logs).
 */
export function screenStepped (read, { x0, z0, g, guard = () => null, hy = 70, stairCols = [] } = {}) {
  const B = g.B, A = SITE_LIM.apron
  const yHi = hy + SITE_LIM.scanUp, yLo = hy - SITE_LIM.scanDown
  const ground = new Map()
  const gAt = (x, z) => { const k = `${x},${z}`; if (!ground.has(k)) ground.set(k, groundAt(read, x, z, yHi, yLo)); return ground.get(k) }
  for (let x = x0 - A - 1; x <= x0 + B + A; x++) for (let z = z0 - A - 1; z <= z0 + B + A; z++) {
    const why = guard(x, z, hy - SITE_LIM.scanDown, hy + SITE_LIM.scanUp)
    if (why) return { ok: false, why: `reserved:${String(why).slice(0, 40)}` }
  }
  const inBase = (x, z) => x >= x0 && x < x0 + B && z >= z0 && z < z0 + B
  const stairSet = new Set(stairCols.map(([x, z]) => `${x},${z}`))
  const cols = []
  for (let x = x0 - A; x < x0 + B + A; x++) for (let z = z0 - A; z < z0 + B + A; z++) {
    const gr = gAt(x, z)
    if (gr.why) return { ok: false, why: `${inBase(x, z) ? 'base' : 'apron'}_${gr.why}` }
    cols.push([x, z, gr])
  }
  const baseYs = cols.filter(([x, z]) => inBase(x, z)).map(([, , gr]) => gr.y)
  const lo = Math.min(...baseYs), hi = Math.max(...baseYs)
  // a column cut from its ground down to `to`: every block CUTTABLE, none under a gravity block (it would fall into the cut)
  const cutOk = (x, z, from, to) => {
    for (let y = from; y > to; y--) { const n = nm(read(x, y, z)); if (!CUTTABLE.test(n)) return false }
    return !GRAVITY.test(nm(read(x, from + 1, z)))
  }
  let best = null
  for (let L = hi; L >= lo; L--) {
    let fillN = 0, cutN = 0, filledCols = 0, bad = null
    for (const [x, z, gr] of cols) {
      const y = gr.y
      if (inBase(x, z) || stairSet.has(`${x},${z}`)) {
        // sinkfix-02: a base hole at most baseFillCol deep -- the bottom cell of a 3-deep 1-wide hole has no stand in reach (LIVE 11-04:
        // the tower's only proof failure, `no_step: T1-F ... T1-core@47,67,-28`); the ziggurat's FOUND_DEPTH is 2 for the same reason
        if (y < L) { if (L - y > SITE_LIM.baseFillCol || !inBase(x, z)) { bad = 'fill_deep'; break } fillN += L - y; filledCols++ }
        if (y > L) { if (y - L > SITE_LIM.cutCol || !cutOk(x, z, y, L)) { bad = 'cut_deep'; break } cutN += y - L }
      } else if (y < L - 1) { if (L - 1 - y > SITE_LIM.fillCol - 1) { bad = 'apron_low'; break } fillN += L - 1 - y } else if (y > L + 1) { if (y - L > SITE_LIM.cutCol || !cutOk(x, z, y, L)) { bad = 'apron_high'; break } cutN += y - L }
    }
    if (!bad && filledCols > Math.ceil(B * B * SITE_LIM.fillShare)) bad = 'fill_share'
    if (!bad && cutN > SITE_LIM.cutMax) bad = 'cut_max'
    if (bad) { best ??= { why: bad }; continue }
    const cost = fillN + 2 * cutN
    if (!best || best.why || cost < best.cost) best = { L, cost }
  }
  if (!best || best.why) return { ok: false, why: best?.why ?? 'level' }
  const L = best.L
  if (L + 1 + g.n * g.H + 3 > yHi) return { ok: false, why: 'too_high' }
  // liquid anywhere from L-2 to one above the highest ground the site cuts (Codex r1 BLOCKER 1: a cut at L+3 beside water released it)
  const P = SITE_LIM.liquidPad
  const yTop = Math.max(L + 2, ...cols.map(([, , gr]) => gr.y + 1))
  for (let x = x0 - A - P; x < x0 + B + A + P; x++) for (let z = z0 - A - P; z < z0 + B + A + P; z++) {
    for (let y = L - 2; y <= yTop; y++) if (wet(read(x, y, z))) return { ok: false, why: 'liquid' }
  }
  const fill = [], cut = []
  for (const [x, z, gr] of cols) {
    const y = gr.y
    if (inBase(x, z)) for (let fy = y + 1; fy <= L; fy++) fill.push([x, fy, z])
    else for (let fy = y + 1; fy <= L - 1; fy++) fill.push([x, fy, z])   // an apron below L-1 is raised to it: the stand ring's step
    const to = inBase(x, z) || stairSet.has(`${x},${z}`) ? L : y > L + 1 ? L : y
    for (let cy = y; cy > to; cy--) cut.push({ at: [x, cy, z], kind: 'cut', name: nm(read(x, cy, z)) })
  }
  const trees = clearsOf(cols)
  const logs = trees.filter(c => c.kind === 'tree').length
  if (logs > SITE_LIM.logsMax) return { ok: false, why: 'logs_over_max' }
  // the cuts top down after the trees and leaves above them (buildrun.mjs digs a record's clears low before high: a cut's column
  // is listed top first so each dig opens the next one's face)
  const clear = [...trees, ...cut.sort((a, b) => b.at[1] - a.at[1])]
  return { ok: true, why: 'ok', L, fill, clear, logs, cut: cut.length, box: [x0 - A, z0 - A, x0 + B - 1 + A, z0 + B - 1 + A] }
}

// ---- the build proof: a construction sequence over the world (buildsite.mjs proveSite's rule, for a generated instance) ----------
const SOLID = name => Object.freeze({ name, boundingBox: 'block' })
const EMPTY = name => Object.freeze({ name, boundingBox: 'empty' })
/**
 * CAN THE INSTANCE BE BUILT FROM WHERE A BOT CAN WALK? -> { ok, why, detail?, walks }. Pure. Two stages:
 *   1. REACH: the town walk (buildsite.mjs walkFrom from home and the stood cells, radius `walkR`, over the world with the
 *      foundation laid) reaches one of the instance's `approach` stands;
 *   2. ORDER: the segments in order, each cell lowest first with a STEP (buildsite.mjs stepFor: a support the builder would click,
 *      the eye within reach on the face's open side, a clear sight line) from a stand the LOCAL walk (from the approach, radius
 *      `localR`) reaches, the cells still to place obstacles and never floors; every placed cell is a floor from then on.
 * `domain(x, z)` the stands' domain (the instance's box + 6). Lights and fires are walk-through (never obstacles, never floors).
 */
export function proveBuild (read, home, inst, { stood = [], walkR = 48, domain = () => true, approach = [], localR = 14, reach = true } = {}) {
  const over = new Map()
  for (const c of inst.clear ?? []) over.set(kOf(c.at), EMPTY('air'))
  const R = overlay(read, over)
  const nameOf = c => (inst.palette[c.role] ?? ['cobblestone']).find(n => n !== '*solid') ?? 'cobblestone'
  const open = c => sinkOpenRole(c.role)
  let town0 = new Set()
  if (reach) {
    const ov = new Map([...(inst.clear ?? []).map(c => [kOf(c.at), EMPTY('air')]), ...inst.cells.filter(c => /-F$/.test(c.seg)).map(c => [kOf(c.at), SOLID('cobblestone')])])
    town0 = walkFrom(overlay(read, ov), home, new Set(), walkR, { stood })
    if (!approach.some(a => town0.has(kOf(a)))) return { ok: false, why: 'unreachable', detail: `approach ${approach.map(kOf).slice(0, 2).join('/')}`, walks: 1 }
  }
  const byCol = keys => { const m = new Map(); for (const k of keys) { const [x, y, z] = k.split(',').map(Number); const c = `${x},${z}`; if (!m.has(c)) m.set(c, []); m.get(c).push(y) } return m }
  let a0 = approach[0] ?? null
  if (reach) a0 = approach.find(a => town0.has(kOf(a))) ?? a0
  const local = a0 ? { x: a0[0], y: a0[1], z: a0[2] } : home
  let walks = 0
  for (const sg of inst.segments) {
    const left = inst.cells.filter(c => c.seg === sg.seg).sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])
    const walkNow = () => { walks++; return byCol(walkFrom(R, local, new Set(left.filter(c => !open(c)).map(c => kOf(c.at))), localR, { stood: approach })) }
    let nodes = walkNow(), fresh = true
    while (left.length) {
      let pick = -1, step = null
      for (let i = 0; i < left.length; i++) { step = stepFor(R, local, left[i].at, nodes, domain); if (step) { pick = i; break } }
      if (pick < 0 && !fresh) { nodes = walkNow(); fresh = true; continue }
      if (pick < 0) return { ok: false, why: 'no_step', detail: `${sg.seg} ${left.length} left, first ${left[0].role}@${kOf(left[0].at)}`, walks }
      fresh = false
      const c = left.splice(pick, 1)[0]
      over.set(kOf(c.at), open(c) ? EMPTY(nameOf(c)) : SOLID(nameOf(c)))
    }
  }
  return { ok: true, why: 'ok', walks }
}

// ---- where a tower and a shrine may stand ----------------------------------------------------------------------------------------
function shuffle (r, xs) { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
/**
 * THE TOWER CANDIDATES -> [{ cx, cz, why }] (the base's centre), in the order they are tried. Pure. With a wall record: outside the
 * wall's ring at its four corners (diagonally out), then flanking each gateway outside, then the middle of each side -- the base
 * `off` columns clear of the wall's line (its zones are the wall's columns + 1; the tower's apron must not touch them). The corner
 * order is the seed's. Without a wall: the town ring's four diagonals at 30 (the town plan's outer plots stand 19-51 out).
 */
export function towerCandidates (wall, home, B, seed = 0) {
  const r = rng(seed)
  const off = Math.floor(B / 2) + SITE_LIM.apron + 3
  const out = []
  const ring = Array.isArray(wall?.ring) && wall.ring.length === 4 ? wall.ring : null
  if (!ring) {
    for (const [sx, sz] of shuffle(r, [[-1, -1], [1, -1], [1, 1], [-1, 1]])) out.push({ cx: home.x + sx * 30, cz: home.z + sz * 30, why: 'ring' })
    return out
  }
  const [x0, z0, x1, z1] = ring
  for (const [x, z, sx, sz] of shuffle(r, [[x0, z0, -1, -1], [x1, z0, 1, -1], [x1, z1, 1, 1], [x0, z1, -1, 1]])) out.push({ cx: x + sx * off, cz: z + sz * off, why: 'corner' })
  for (const gt of Array.isArray(wall?.gates) ? wall.gates : []) {
    const c = Array.isArray(gt?.cols) && gt.cols.length ? gt.cols : Array.isArray(gt?.at) ? [gt.at] : []
    if (!c.length) continue
    const gx = c.reduce((t, q) => t + q[0], 0) / c.length, gz = c.reduce((t, q) => t + (q.length === 3 ? q[2] : q[1]), 0) / c.length
    const side = Math.abs(gz - z0) < 1.5 ? 'n' : Math.abs(gz - z1) < 1.5 ? 's' : Math.abs(gx - x0) < 1.5 ? 'w' : Math.abs(gx - x1) < 1.5 ? 'e' : null
    if (!side) continue
    const span = Math.ceil(c.length / 2) + Math.floor(B / 2) + 2
    for (const s of [-1, 1]) {
      if (side === 'n' || side === 's') out.push({ cx: Math.round(gx + s * span), cz: side === 'n' ? z0 - off : z1 + off, why: 'gate' })
      else out.push({ cx: side === 'w' ? x0 - off : x1 + off, cz: Math.round(gz + s * span), why: 'gate' })
    }
  }
  const mx = Math.round((x0 + x1) / 2), mz = Math.round((z0 + z1) / 2)
  for (const [cx, cz] of shuffle(r, [[mx, z0 - off], [x1 + off, mz], [mx, z1 + off], [x0 - off, mz]])) out.push({ cx, cz, why: 'side' })
  // the sweep: every TOWER_SWEEP columns round the wall, at off and off + TOWER_SWEEP (a crowded, hilly ring: the fixed spots taken)
  for (const d of [off, off + TOWER_SWEEP]) {
    for (let x = x0 - d; x <= x1 + d; x += TOWER_SWEEP) out.push({ cx: x, cz: z0 - d, why: 'sweep' }, { cx: x, cz: z1 + d, why: 'sweep' })
    for (let z = z0 - d + TOWER_SWEEP; z < z1 + d; z += TOWER_SWEEP) out.push({ cx: x0 - d, cz: z, why: 'sweep' }, { cx: x1 + d, cz: z, why: 'sweep' })
  }
  return out
}
export const TOWER_SWEEP = 7
/**
 * THE SHRINE SLOTS round the town's ziggurat -> [{ cx, cz, slot, pair }] in the order they are tried. Pure. Eight slots -- the four
 * corners (diagonally out) and the four faces' middles -- `gap` columns of open ground clear of the ziggurat's box (its record zone
 * is the box + 3), never in front of a stair face (its approach); in MIRRORED PAIRS (the two corners flanking the stair face, the
 * two far corners, the two side faces, the far face alone), the pairs in the seed's order. A pair shares one design (twins).
 */
export function shrineSlots (zig, B, seed = 0, gap = 7) {
  const box = Array.isArray(zig?.box) && zig.box.length === 4 ? zig.box : null
  if (!box) return []
  const [x0, z0, x1, z1] = box
  const off = gap + Math.floor(B / 2) + 1
  const cx = Math.round((x0 + x1) / 2), cz = Math.round((z0 + z1) / 2)
  const stairFaces = zig?.design?.g?.FACES === 4 || zig?.geometry?.FACES === 4 ? ['n', 'e', 's', 'w'] : [String(zig?.face ?? 's')]
  const P = {
    nw: [x0 - off, z0 - off], ne: [x1 + off, z0 - off], se: [x1 + off, z1 + off], sw: [x0 - off, z1 + off],
    n: [cx, z0 - off], s: [cx, z1 + off], e: [x1 + off, cz], w: [x0 - off, cz],
  }
  const opp = { n: 's', s: 'n', e: 'w', w: 'e' }
  const f = stairFaces[0]
  const flank = { n: ['nw', 'ne'], s: ['sw', 'se'], e: ['ne', 'se'], w: ['nw', 'sw'] }
  const sides = { n: ['e', 'w'], s: ['e', 'w'], e: ['n', 's'], w: ['n', 's'] }[f] ?? []
  const pairs = shuffle(rng(seed), [flank[f] ?? [], flank[opp[f]] ?? [], sides, [opp[f]]]).filter(p => p.length)
  const out = []
  pairs.forEach((p, pi) => { for (const s of p) if (!stairFaces.includes(s)) out.push({ cx: P[s][0], cz: P[s][1], slot: s, pair: pi }) })
  // the outer ring: the same slots a base and a gap farther out (a second ring of the complex, its pairs after the first ring's)
  const o2 = off + B + gap
  const P2 = { nw: [x0 - o2, z0 - o2], ne: [x1 + o2, z0 - o2], se: [x1 + o2, z1 + o2], sw: [x0 - o2, z1 + o2], n: [cx, z0 - o2], s: [cx, z1 + o2], e: [x1 + o2, cz], w: [x0 - o2, cz] }
  pairs.forEach((p, pi) => { for (const s of p) if (!stairFaces.includes(s)) out.push({ cx: P2[s][0], cz: P2[s][1], slot: `${s}2`, pair: pairs.length + pi }) })
  return out
}
/** The face of a site toward a point (a tower's first stair toward home). Pure. */
export function faceToward (cx, cz, to) {
  const dx = to.x - cx, dz = to.z - cz
  return Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'e' : 'w') : (dz > 0 ? 's' : 'n')
}
/** The ground-stair columns of a stepped instance (world x, z) -- the screen holds them at L exactly. Pure. */
export const groundStairCols = (g, corner) => [...new Set(stairCells(g, 0).map(s => `${corner.x + s.i},${corner.z + s.j}`))].map(k => k.split(',').map(Number))
/** An instance's approach stands: the ground cell (feet level) just before each ground stair, else beside the base's face. Pure. */
export function approachOf (g, corner, L) {
  const feet = L + 1
  const m = (g.B - 1) / 2
  const out = []
  for (const f of facesAt(g, 0)) {
    let a = m, d = 1
    if (g.H > 1 && g.stairs === 'perp') d = g.H
    if (g.H > 1 && g.stairs === 'along') { const dir = g.spin === -1 ? -1 : 1; a = m - dir * Math.floor((g.H - 2) / 2) - dir; d = 1 }
    const [i, j] = { n: [a, -d], s: [a, g.B - 1 + d], w: [-d, a], e: [g.B - 1 + d, a] }[f]
    out.push([corner.x + i, feet, corner.z + j])
  }
  return out
}

// ---- roads: a segment of a raised causeway along a land-plan spoke's rail ---------------------------------------------------------
export const ROAD = Object.freeze({ len: 16, width: 3, minLen: 6, fillCol: 3, rMax: 112, lampEvery: 8, leadMax: 8 })
/** The land plan's rails -> [{ spoke, from: [x, z], to: [x, z] }] (each spoke's expedition rail, outward from workR). Pure. */
export function roadRails (land) {
  return (land?.roads ?? []).filter(r => r?.kind === 'spoke' && Array.isArray(r?.rail?.from) && Array.isArray(r?.rail?.to))
    .map(r => ({ spoke: String(r.id), from: r.rail.from.slice(0, 2), to: r.rail.to.slice(0, 2) }))
}
/**
 * A ROAD'S STYLE from its spoke's seed (every segment of one road looks alike) -> { pattern, main, accent, post, lamp }. Pure.
 * pattern: edged (accent edges) | centre (an accent centre line) | checker | bands (an accent band every 4) | plain.
 */
export function roadStyle (seed, { avail = {}, torch = false } = {}) {
  const r = rng(seed)
  const pattern = pickOf(r, ['edged', 'centre', 'checker', 'bands', 'plain'])
  const acc = affordable(avail, 24)
  const accent = acc.length ? acc[Math.floor(r() * acc.length) % acc.length] : null
  const post = affordable(avail, 8)
  return { pattern: accent ? pattern : 'plain', main: 'cobblestone', accent, post: post.length ? post[Math.floor(r() * post.length) % post.length] : 'cobblestone', lamp: !!torch }
}
/** The surface role tag of road cell (t, w) under a style ('main' | 'acc'). Pure. */
export function roadStone (style, t, w) {
  if (!style?.accent || style.pattern === 'plain') return 'main'
  if (style.pattern === 'edged') return Math.abs(w) === 1 ? 'acc' : 'main'
  if (style.pattern === 'centre') return w === 0 ? 'acc' : 'main'
  if (style.pattern === 'checker') return ((t + w) % 2 + 2) % 2 === 0 ? 'acc' : 'main'
  if (style.pattern === 'bands') return t % 4 === 0 ? 'acc' : 'main'
  return 'main'
}
/**
 * ONE ROAD SEGMENT -> { ok, cells, segments, palette, box, end, approach, why, len, full } | { ok: false, why }. Pure. The causeway
 * runs along the rail's dominant axis from distance t0 = k * ROAD.len, 3 wide (the centre line follows the rail), its surface ONE
 * ABOVE the highest ground of each cross-section and never more than 1 from the last (an upper 1-Lipschitz envelope: every step
 * +-1), the dips under it filled (<= ROAD.fillCol). It STOPS -- the segment ends -- at the first cross-section that meets water
 * within one column, a tree or furniture, a reservation (`guard`), a fill too deep, or Chebyshev ROAD.rMax from home; a start more
 * than 1 from the previous segment's end (`prevY`) refuses. Shorter than ROAD.minLen there is no segment (the spoke has ended).
 * Lamps (`style.lamp`): a post and a torch on alternating edges every ROAD.lampEvery, in their own last segment.
 */
export function roadSegment (read, { id, rail, k = 0, style, prevY = null, guard = () => null, hy = 70, home = null } = {}) {
  const [fx, fz] = rail.from, [tx, tz] = rail.to
  const ux = tx - fx, uz = tz - fz
  const alongX = Math.abs(ux) >= Math.abs(uz)
  const s = Math.sign(alongX ? ux : uz) || 1
  const t0 = k * ROAD.len
  const yHi = hy + SITE_LIM.scanUp, yLo = hy - SITE_LIM.scanDown
  const secs = []
  let lead = null
  for (let t = t0; t < t0 + ROAD.len + (k === 0 ? ROAD.leadMax : 0) && secs.length < ROAD.len; t++) {
    const a = (alongX ? fx : fz) + s * t
    const b = Math.round((alongX ? fz : fx) + (alongX ? uz / ux : ux / uz) * (s * t))
    const cols = [-1, 0, 1].map(w => (alongX ? [a, b + w, w] : [b + w, a, w]))
    if (home && cols.some(([x, z]) => Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) > ROAD.rMax)) break
    let stop = null, G = -Infinity
    const gs = [], grs = []
    for (const [x, z] of cols) {
      const gr = groundAt(read, x, z, yHi, yLo)
      if (gr.why) { stop = gr.why; break }
      gs.push(gr.y); grs.push(gr); G = Math.max(G, gr.y)
      if (guard(x, z, gr.y - 2, gr.y + 4)) { stop = 'reserved'; break }
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) for (let y = gr.y - 1; y <= gr.y + 3; y++) if (wet(read(x + dx, y, z + dz))) stop = 'liquid'
      if (stop) break
    }
    // the first segment may begin a few columns out (a land-plan corridor or a marker on the rail's first cells)
    if (stop) { if (!secs.length && k === 0 && t - t0 < ROAD.leadMax) { lead = stop; continue } if (!secs.length) return { ok: false, why: `start_${stop}` }; break }
    secs.push({ t, cols, gs, grs, y: G + 1 })
  }
  if (!secs.length) return { ok: false, why: 'short', len: 0 }
  for (let i = 0; i < secs.length; i++) { const before = i ? secs[i - 1].y : prevY; if (Number.isFinite(before)) secs[i].y = Math.max(secs[i].y, before - 1) }
  for (let i = secs.length - 2; i >= 0; i--) secs[i].y = Math.max(secs[i].y, secs[i + 1].y - 1)
  if (Number.isFinite(prevY) && Math.abs(secs[0].y - prevY) > 1) return { ok: false, why: 'step_from_prev' }
  let n = 0
  for (; n < secs.length; n++) { const q = secs[n]; if (q.gs.some(g => q.y - 1 - g > ROAD.fillCol)) break }
  const keep = secs.slice(0, n)
  if (keep.length < ROAD.minLen) return { ok: false, why: n < secs.length ? 'fill_deep' : 'short', len: keep.length }
  const roles = { [roleOf(id, 'main')]: uniq([style.main, 'cobblestone']), [roleOf(id, 'core')]: CORE_NAMES.slice() }
  if (style.accent) roles[roleOf(id, 'acc')] = uniq([style.accent, 'cobblestone'])
  const cells = []
  const clear = clearsOf(keep.flatMap(q => q.cols.map(([x, z], ci) => [x, z, q.grs[ci]])))
  if (clear.filter(c => c.kind === 'tree').length > SITE_LIM.logsMax) return { ok: false, why: 'logs_over_max' }
  keep.forEach((q, i) => {
    const seg = `${id}-P${Math.floor(i / 8)}`
    q.cols.forEach(([x, z, w], ci) => {
      for (let y = q.gs[ci] + 1; y < q.y; y++) cells.push({ at: [x, y, z], role: roleOf(id, 'core'), seg })
      cells.push({ at: [x, q.y, z], role: roleOf(id, roadStone(style, q.t, w)), seg })
    })
  })
  if (style.lamp) {
    roles[roleOf(id, 'post')] = uniq([style.post, 'cobblestone'])
    roles[roleOf(id, 'light')] = ['torch']
    for (const q of keep) {
      if ((q.t % ROAD.lampEvery) !== ROAD.lampEvery / 2) continue
      const w = Math.floor(q.t / ROAD.lampEvery) % 2 === 0 ? 1 : -1
      const [x, z] = q.cols.find(c => c[2] === w)
      cells.push({ at: [x, q.y + 1, z], role: roleOf(id, 'post'), seg: `${id}-PL` }, { at: [x, q.y + 2, z], role: roleOf(id, 'light'), seg: `${id}-PL` })
    }
  }
  const xs = cells.map(c => c.at[0]), zs = cells.map(c => c.at[2])
  const first = keep[0], mid = first.cols[1]
  const back = alongX ? [mid[0] - s, first.gs[1] + 1, mid[1]] : [mid[0], first.gs[1] + 1, mid[1] - s]
  return {
    ok: true, why: n < secs.length || keep.length < ROAD.len ? 'cut_short' : 'ok', cells, clear, segments: segmentsFor(id, cells), palette: roles,
    box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], end: { t: keep[keep.length - 1].t, y: keep[keep.length - 1].y },
    approach: [back, [back[0], back[1] + 1, back[2]], [mid[0], first.y + 1, mid[1]]], len: keep.length, full: keep.length === ROAD.len && n === secs.length,
  }
}

// ---- siting one instance (the bot's call at a visit, and bots/scripts/sinks-offline.mjs's) ------------------------------------------
const spiral = r => { const out = [[0, 0]]; for (let d = 1; d <= r; d++) for (let dx = -d; dx <= d; dx++) for (let dz = -d; dz <= d; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === d) out.push([dx, dz]); return out }
/**
 * SITE THE NEXT INSTANCE OF A KIND -> { ok, inst, meta, tried } | { ok: false, why, tried }. Pure over `read`. ctx:
 *   kind, n (the instance number, 1-based), id, home, pool, avail { stone: n } (the town above its floor + this bot's bag spare),
 *   torch / campfire (the town or bag can light it), guard(x, z, y0, y1) -> reason (every reservation, the ziggurat's +8 apron
 *   among them), guardShrine (the same without that apron: a shrine belongs to the ziggurat; its record zone, box + 3, stays),
 *   wall (the wall record), zig (the ziggurat record), land (the land plan), rec (this plot's record: instances so far),
 *   stood (the walk's seeds), walkR, tries (proofs; SINK.proofTries).
 * Towers: each candidate (towerCandidates) and up to 3 columns round it, screened, then proven; the first proven wins. Shrines: the
 * next free slot round the ziggurat (shrineSlots; a pair shares its design: twins). Roads: the rail with the fewest segments first,
 * its next 16-column segment from the last one's end.
 */
export function siteSink (read, ctx = {}) {
  const { kind, n = 1, id, home, pool = '', avail = {}, torch = false, campfire = false, guard = () => null, guardShrine = guard, stood = [] } = ctx
  const tries = ctx.tries ?? SINK.proofTries
  const tried = []
  let proofs = 0
  const prove = (inst, approach, box) => {
    proofs++
    const walkR = Math.max(ctx.walkR ?? 0, sinkWalkR(inst.cells, home))
    return proveBuild(read, home, inst, { stood, walkR, approach, domain: (x, z) => x >= box[0] - 6 && x <= box[2] + 6 && z >= box[1] - 6 && z <= box[3] + 6, localR: kind === 'road' ? 24 : 14 })
  }
  const prior = instancesOf(ctx.rec)
  let firstFail = null   // the first proof failure's detail (the `_sink op=no_site` row names it)
  // siteprep-01: every candidate refusal, tallied (the site request's `rejects`: siteprep.mjs prepWorthy reads it)
  const rejects = {}
  // siteprep-01: a PREPARED plot (`ctx.prep`: { id, cx, cz, B, seed, slot?, pair? }) is the one candidate, its spot exact and its base
  // pinned -- never a search (the keeper's grading made exactly this spot buildable)
  const prep = ctx.prep && Number.isFinite(ctx.prep.cx) && Number.isFinite(ctx.prep.cz) && Number.isFinite(ctx.prep.seed) ? ctx.prep : null
  // towndress-01: a dress batch is sited over the town's own records (towndress.mjs siteDress: its own candidates, spacing and proof)
  if (kind === 'dress') return siteDress(read, { ...ctx, walkR: ctx.walkR ?? 0 })
  // decorator-01: a decor batch is sited over the town's own records (decorator.mjs siteDecor: its own candidates, pattern and proof)
  if (kind === 'decor') return siteDecor(read, { ...ctx, walkR: ctx.walkR ?? 0 })
  if (kind === 'tower' || kind === 'shrine') {
    const seed0 = sinkSeed(kind, pool, home, n)
    let cands, seedOf
    if (prep) cands = [{ cx: prep.cx, cz: prep.cz, why: 'prep', seed: prep.seed, ...(prep.slot ? { slot: prep.slot, pair: prep.pair } : {}) }]
    else if (kind === 'tower') {
      const d0 = towerDesign(seed0, { avail, torch, campfire })
      cands = towerCandidates(ctx.wall, home, d0.g.B, seed0).map(c => ({ ...c, seed: seed0 }))
    } else {
      if (!Array.isArray(ctx.zig?.box)) return { ok: false, why: 'no_ziggurat', tried }
      const zs = sinkSeed('shrine', pool, home, 0)
      const used = new Set(prior.map(i => i.slot).filter(Boolean))
      // every slot sized for the largest base (13): a pair's twins then stand at the same offset whatever their design
      cands = shrineSlots(ctx.zig, 13, zs).filter(s => !used.has(s.slot)).map(s => ({ cx: s.cx, cz: s.cz, why: s.slot, slot: s.slot, pair: s.pair, seed: sinkSeed('shrine', pool, home, 1000 + s.pair) }))
    }
    seedOf = c => c.seed
    for (const c of cands) {
      const face0 = faceToward(c.cx, c.cz, home)
      const pinB = prep ? prep.B : null
      const d = kind === 'tower' ? towerDesign(seedOf(c), { avail, face0, torch, campfire, pinB }) : shrineDesign(seedOf(c), { avail, face0, torch, campfire, pinB })
      const g = d.g, B = g.B
      const why = {}
      let candProofs = 0
      for (const [dx, dz] of spiral(prep ? 0 : kind === 'tower' ? 5 : 4)) {
        if (candProofs >= SINK.proofsPerCandidate) break
        const corner = { x: c.cx + dx - (B - 1) / 2, z: c.cz + dz - (B - 1) / 2 }
        const sc = screenStepped(read, { x0: corner.x, z0: corner.z, g, guard: kind === 'shrine' ? guardShrine : guard, hy: home.y, stairCols: groundStairCols(g, corner) })
        if (!sc.ok) { why[sc.why] = (why[sc.why] ?? 0) + 1; rejects[sc.why] = (rejects[sc.why] ?? 0) + 1; continue }
        const inst = stepInstance(id, d, { corner, baseY: sc.L + 1, fill: sc.fill, seed: seedOf(c), clear: sc.clear })
        if (inst.cells.length > SINK.billMax) { why.bill = (why.bill ?? 0) + 1; rejects.bill = (rejects.bill ?? 0) + 1; continue }
        const approach = approachOf(g, corner, sc.L)
        const pr = prove(inst, approach, sc.box)
        candProofs++
        if (!pr.ok) { why[`proof_${pr.why}`] = (why[`proof_${pr.why}`] ?? 0) + 1; rejects[`proof_${pr.why}`] = (rejects[`proof_${pr.why}`] ?? 0) + 1; firstFail ??= `${pr.why}:${String(pr.detail ?? '').replace(/\s+/g, '_').slice(0, 60)}`; if (proofs >= tries) break; continue }
        tried.push(`${c.why}:ok`)
        const meta = { id, n, kind, seed: seedOf(c), design: { ...d, kind }, summary: designSummary(d), box: sc.box, centre: [corner.x + (B - 1) / 2, corner.z + (B - 1) / 2], baseY: sc.L + 1,
          approach, fill: sc.fill.length, logs: sc.logs, ...(c.slot ? { slot: c.slot, pair: c.pair } : {}), where: c.why, ...(prep?.id ? { prep: prep.id } : {}) }
        return { ok: true, inst, meta, tried, proofs, rejects }
      }
      tried.push(`${c.why}:${Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k}${v}`).join('+') || 'none'}`)
      if (proofs >= tries) break
    }
    return { ok: false, why: proofs >= tries ? 'no_proven_site' : 'no_site', tried: firstFail ? [...tried, `first:${firstFail}`] : tried, proofs, rejects }
  }
  if (kind === 'road') {
    const rails = roadRails(ctx.land)
    if (!rails.length) return { ok: false, why: 'no_rails', tried }
    const on = r => prior.filter(i => i.spoke === r.spoke)
    const order = rails.slice().sort((a, b) => on(a).length - on(b).length || a.spoke.localeCompare(b.spoke))
    for (const rail of order) {
      const done = on(rail)
      if (done.some(i => i.ended)) { tried.push(`${rail.spoke}:ended`); continue }
      const last = done[done.length - 1] ?? null
      const style = roadStyle(sinkSeed('road', pool, home, fnv1a(rail.spoke)), { avail, torch })
      const seg = roadSegment(read, { id, rail, k: done.length, style, prevY: last?.end?.y ?? null, guard, hy: home.y, home })
      if (!seg.ok) { tried.push(`${rail.spoke}:${seg.why}`); continue }
      const pr = prove(seg, seg.approach, seg.box)
      if (!pr.ok) { tried.push(`${rail.spoke}:proof_${pr.why}`); if (proofs >= tries) break; continue }
      tried.push(`${rail.spoke}:ok`)
      const design = { kind: 'road', spoke: rail.spoke, k: done.length, style }
      const meta = { id, n, kind, spoke: rail.spoke, k: done.length, seed: sinkSeed('road', pool, home, fnv1a(rail.spoke)), design, summary: designSummary(design), box: seg.box,
        end: seg.end, approach: seg.approach, len: seg.len, ...(seg.full ? {} : { ended: true }) }
      return { ok: true, inst: seg, meta, tried, proofs }
    }
    return { ok: false, why: 'no_site', tried, proofs }
  }
  return { ok: false, why: 'kind', tried }
}

/**
 * THE RECORDS A KIND IS SITED CLEAR OF -> the records less a road's own (Codex r1 BLOCKER 2: the last segment's zone, box + 1, held
 * the next segment's first column: every full segment ended its spoke). A tower or a shrine keeps its own earlier instances. Pure.
 */
export const guardRecords = (recs = [], kind) => (kind === 'road' ? recs.filter(r => r?.plot !== SINK_PLOTS.road) : recs)

// ---- the growing record ------------------------------------------------------------------------------------------------------------
export const PROJECT_GAP = 3
/**
 * APPEND AN INSTANCE to a sink plot's record -> the new record (the old one unchanged). Pure. The instance's cells, segments and
 * palette roles join the record's; its zone (the box + PROJECT_GAP; a road's: its box + 1) joins the record's `zones` (recordZones
 * reads a record's own zones: no whole-town box); the record reads open (`structure_complete: false`) until this instance stands.
 * `meta` is the instance's own row ({ id, n, seed, design, box, centre, baseY, approach, sitedBy, ... }).
 */
export function appendInstance (cur, { kind, home, inst, meta, plan = null, now = Date.now() }) {
  const base = cur && isSinkBlueprint(cur.blueprint) ? cur : {
    v: 1, blueprint: SINK_BLUEPRINTS[kind], plot: SINK_PLOTS[kind], kind, home, instances: [], cells: [], segments: [], palette: {}, clear: [], replant: [], zones: [],
    builders_max: SINK_BUILDERS, structure_complete: false, state: 'open',
  }
  const margin = kind === 'road' ? 1 : PROJECT_GAP
  const b = meta.box
  // towndress-01: a dress batch names its own zones (each fixture's column + 1: a town-wide box would fence the town off)
  // decorator-01: a decor batch too (each ornament's own column)
  const zs = (kind === 'dress' || kind === 'decor') && Array.isArray(meta.zones) ? meta.zones : [{ box: [b[0] - margin, -64, b[1] - margin, b[2] + margin, 320, b[3] + margin], why: `project:${SINK_PLOTS[kind]}:${meta.id}` }]
  const walkR = Math.max(Number(base.walkR) || 0, sinkWalkR(inst.cells, home))
  return {
    ...base, instances: [...instancesOf(base), { ...meta, cells: inst.cells.length, sitedAt: meta.sitedAt ?? now }],
    cells: [...base.cells, ...inst.cells], clear: [...(base.clear ?? []), ...(inst.clear ?? [])], segments: [...base.segments, ...inst.segments], palette: { ...base.palette, ...inst.palette },
    zones: [...(base.zones ?? []), ...zs], walkR, structure_complete: false, state: 'open', ...(plan ? { plan } : {}),
    bom: { ...(base.bom ?? {}), [meta.id]: inst.cells.length },
  }
}
/** The town walk's radius for cells: their farthest column (Chebyshev from home) + 10, at least 48, at most 128. Pure. */
export function sinkWalkR (cells, home) {
  let r = 0
  for (const c of cells ?? []) r = Math.max(r, Math.abs(c.at[0] - home.x), Math.abs(c.at[2] - home.z))
  return Math.max(48, Math.min(128, r + 10))
}
/** Mark the newest instance standing -> the new record (`structure_complete` true, the instance's completeAt) | null. Pure. */
export function completeInstance (cur, now = Date.now()) {
  if (!cur || cur.structure_complete) return null
  const ins = instancesOf(cur).map((i, k, a) => (k === a.length - 1 && !i.completeAt ? { ...i, completeAt: now } : i))
  return { ...cur, instances: ins, structure_complete: true, state: 'complete', completeAt: now }
}
/** The visit's options for a sink record (buildrun.mjs runVisit): the stands' domain (every instance's box + 6), the walk's radius,
 *  the layer rule, the foreign blocks a visit may dig from an open cell, the walk-through roles. Pure. */
export function sinkVisitOpts (rec, home) {
  const boxes = instancesOf(rec).map(i => i.box).filter(b => Array.isArray(b) && b.length === 4)
  const domain = (x, z) => boxes.some(b => x >= b[0] - 6 && x <= b[2] + 6 && z >= b[1] - 6 && z <= b[3] + 6)
  return { domain, walkR: Number(rec?.walkR) || sinkWalkR(rec?.cells, home), blockLayer: true, foreign: SINK_FOREIGN, openRole: sinkOpenRole, clearMax: 40 }
}
/** The record's sapling guard: every instance's box + 2 as COLUMNS (shop.mjs saplingAllowedAt's `cols`: a box over the whole
 *  record would forbid saplings across the town). Pure. */
export function sinkSaplingCols (rec) {
  const cols = new Set()
  for (const i of instancesOf(rec)) {
    // towndress-01: a dress batch guards its fixtures' columns + 2, never its box (the box spans the town)
    if (Array.isArray(i.cols)) { for (const [x, z] of i.cols) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) cols.add(`${x + dx},${z + dz}`); continue }
    const b = i.box
    if (!Array.isArray(b) || b.length !== 4) continue
    for (let x = b[0] - 2; x <= b[2] + 2; x++) for (let z = b[1] - 2; z <= b[3] + 2; z++) cols.add(`${x},${z}`)
  }
  return cols.size ? { cols } : null
}
/**
 * SINKWAIVE-01 (LIVE showcase 11-04/06: tower T3 at 684 of 693 from 11-04 11:01Z; crown cell 43,78,-11 `stuck_on_cell` (no stand
 * reached it, deferred by Iris x2, Alpha, Bravo, Maple: 5 visits over 19 h), the other 8 open cells waiting on its segment, and every
 * visit after the 3rd ending `stuck_on_cell` + the 6-h back-off -- the tower could never complete). The WALL's waiver (wall.mjs
 * wallWaiveDue, wallstuck-01), for the STONE sinks (road, tower, shrine; dress and decor keep their own stall rules): a cell the
 * visit deferred (runVisit `deferred`) that the stuck files have counted SINK_WAIVE.minVisits deferrals over EVERY holder, ever
 * (buildproj stuckRead with no `since`: a sink is visited a few times a day, so the 24-h forget window never sums 3), whose FIRST
 * deferral is SINK_WAIVE.afterMs old, is WAIVED: the record names it (`waived`: { 'x,y,z': { why, at, by } }, an `op=waived` row)
 * and every completeness, damage and stamp test reads it done, so the instance closes. Bounded: SINK_WAIVE.max cells a record.
 * SINKWAIVE=off is the rollback: no waiver, and a cell already waived reads open again (as before). Pure.
 */
export const SINK_WAIVE = Object.freeze({
  on: !['off', '0', 'false', 'no'].includes(String(process.env.SINKWAIVE ?? '').trim().toLowerCase()),
  minVisits: 3,               // buildrun STUCK_VISITS: the deferrals that make a cell stuck
  afterMs: 6 * 60 * 60_000,   // its first deferral at least this old (one F4 back-off: shop.mjs SHOP_STUCK_RETRY_MS)
  max: 12,                    // per record, ever (wall.mjs WALL_WAIVE_MAX)
})
/** Does this kind take the waiver? The stone sinks only. Pure. */
export const sinkWaiveKind = kind => kind === 'road' || kind === 'tower' || kind === 'shrine'
/** -> [{ k, why }] the cells to waive now. `deferred` runVisit's [{ k, why, visits }]; `counts` stuckRead's all-time summed map
 *  { k: { visits, firstAt } }. A cell not in the record, a light/fire cell (sinkOpenRole: walk-through), one already waived, or one
 *  this visit did not defer is never waived. Pure. */
export function sinkWaiveDue (rec, deferred = [], counts = {}, now = Date.now(), { minVisits = SINK_WAIVE.minVisits, afterMs = SINK_WAIVE.afterMs, max = SINK_WAIVE.max } = {}) {
  if (!sinkWaiveKind(sinkKindOf(rec?.blueprint ?? rec?.plot))) return []
  const cells = new Set((rec?.cells ?? []).filter(c => !sinkOpenRole(c.role)).map(c => c.at.join(',')))
  const have = rec?.waived ?? {}
  let room = max - Object.keys(have).length
  const out = []
  for (const d of deferred ?? []) {
    if (room <= 0) break
    const k = String(d?.k ?? '')
    if (!cells.has(k) || have[k] || out.some(o => o.k === k)) continue
    const c = counts?.[k] ?? null
    const visits = Math.max(Number(c?.visits) || 0, Number(d?.visits) || 0)
    const first = Number(c?.firstAt)
    if (visits < minVisits || !Number.isFinite(first) || now - first < afterMs) continue
    out.push({ k, why: String(d?.why ?? 'no_stand').slice(0, 80) }); room--
  }
  return out
}
/**
 * THE LIFETIME TALLY (Codex r1 BLOCKER: buildrun's settleStuck rewrites a holder's own stuck file through the 24-h forget window, so
 * the stuck files lose a holder's own old deferrals: one builder visiting 25 h apart read count 1, age 0, forever). Each holder keeps
 * its own lifetime file of the cells its visits deferred (never aged, never pruned but by done/waived cells); the waiver reads their
 * sum, merged with the stuck files' (the live state before this shipped). Pure.
 *   sinkDeferTally(prev, deferred, now, keep) -> the holder's next map { k: { n, firstAt, lastAt } } (`keep(k)`: still an open cell)
 *   sinkDeferMerge(maps)                     -> { k: { visits, firstAt } } summed over maps (visits added, firstAt the earliest)
 */
export function sinkDeferTally (prev = {}, deferred = [], now = Date.now(), keep = () => true) {
  const out = {}
  for (const [k, v] of Object.entries(prev ?? {})) if (keep(k) && v && Number.isFinite(Number(v.n))) out[k] = { n: Number(v.n), firstAt: Number(v.firstAt) || now, lastAt: Number(v.lastAt) || now }
  for (const k of new Set((deferred ?? []).map(d => String(d?.k ?? '')).filter(Boolean))) {
    if (!keep(k)) continue
    const v = out[k] ?? { n: 0, firstAt: now }
    out[k] = { n: v.n + 1, firstAt: v.firstAt, lastAt: now }
  }
  return out
}
export function sinkDeferMerge (maps = []) {
  const out = {}
  for (const m of maps ?? []) {
    for (const [k, v] of Object.entries(m ?? {})) {
      const n = Number(v?.visits ?? v?.n) || 0, f = Number(v?.firstAt)
      const o = out[k] ?? { visits: 0, firstAt: null }
      out[k] = { visits: o.visits + n, firstAt: Number.isFinite(f) ? (o.firstAt == null ? f : Math.min(o.firstAt, f)) : o.firstAt }
    }
  }
  return out
}
/** Is a record cell waived (a stone sink's own list, or -- prodserve-01 -- a dress batch's host-gone lights: towndress.mjs dressOrphans;
 *  SINKWAIVE=off: never)? Pure. */
export const sinkWaivedKind = kind => sinkWaiveKind(kind) || kind === 'dress'
export const sinkWaived = (rec, c, on = SINK_WAIVE.on) => on && !!rec?.waived && isSinkBlueprint(rec?.blueprint) && sinkWaivedKind(sinkKindOf(rec.blueprint)) &&
  Object.prototype.hasOwnProperty.call(rec.waived, c.at.join(','))
/** The record's progress -> { done, open } over its cells (the caller's `done(cell)`). Pure. */
export function sinkProgress (rec, done) {
  let d = 0, o = 0
  for (const c of rec?.cells ?? []) { if (done(c)) d++; else o++ }
  return { done: d, open: o }
}
/** A design's summary for the sited row (under 120 characters). Pure. */
export function designSummary (design) {
  if (!design) return '-'
  if (design.kind === 'road') return `${design.spoke}/k${design.k}/${design.style?.pattern}/${design.style?.accent ?? '-'}${design.style?.lamp ? '/lamps' : ''}`
  const g = design.g, p = design.palette
  return `B${g.B}S${g.S}H${g.H}n${g.n}/${g.stairs}${g.all4 ? '4' : g.spin > 0 ? 'cw' : 'ccw'}W${g.W}/${design.crown}/${p.pattern}:${p.a}${p.b ? `+${p.b}` : ''}${p.quoin ? '/q' : ''}${p.trim ? '/tr' : ''}${p.moss ? '/m' : ''}${design.lights ? '/lit' : ''}`
}

// ---- rows (detail strings only) ------------------------------------------------------------------------------------------------------
export const sinkModeDetail = (on, kinds = SINK_KINDS) => `phase=mode v=1 sinks=${on ? 'on' : 'off'} kinds=${kinds.join(',')} builders=${SINK_BUILDERS} max_open=${SINK.maxOpen} bill_max=${SINK.billMax} target=${SINK.target}`
const fmt = f => Object.entries(f).filter(([, v]) => v != null).map(([k, v]) => `${k}=${String(Array.isArray(v) ? v.join(',') : v).replace(/\s+/g, '_').slice(0, k === 'design' || k === 'why' || k === 'tried' ? 120 : 48)}`).join(' ')
/** `_sink` rows: op=pick (the picker's order and the pressure), op=sited, op=no_site. */
export const sinkRowDetail = f => fmt({ op: f.op, kind: f.kind, id: f.id, n: f.n, p: f.p, avail: f.avail, known: f.known, order: f.order, open: f.open, design: f.design, cell: f.cell, cells: f.cells, tried: f.tried, why: f.why })
