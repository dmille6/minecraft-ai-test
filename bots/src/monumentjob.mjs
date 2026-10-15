// THE MONUMENT JOB (monument-01; docs/reports/ziggurat-mineshaft-2026-10-15.md 3.2-3.8; OWNER 10-15: a SOLID ziggurat per
// shared world, by layers). PURE: the site, the frozen plan, the record's generations, the layer barrier and the cover rule,
// segments, funding, admission and the visit row. skills.mjs build_monument supplies the world and the clicks; the generic
// builder (builder.mjs runPlacements) places; structureguard (structures.mjs) keeps target digs off what is recorded.
//
// THE RECORD is `monument-<home>.g<N>.json` in the pool state dir (structures.mjs structureKey; blueprint's generation
// files: created with link(), one writer wins each number). It carries the SITE (corner, base, stair face), the frozen FILL
// (foundation, apron, the stair approach and the edge guards: terrain-dependent, read once when the site is recorded), the
// open LAYER (the frontier: it only ever moves up), and the per-cell visit counts that WAIVE a cell no bot can complete.
// Progress is never stored: every visit re-reads the world.
import fs from 'node:fs'
import path from 'node:path'
import { ZIG, zigCells, scoreSite, faceToward, profileAt, MAX_EDGE_DROP, inApproach } from './monument.mjs'
import { structureKey, readStructureRecord } from './structures.mjs'
import { solid, replaceable, bk } from './builder.mjs'
import { STONE_GUARD, RESERVE_STONE } from './well.mjs'

export const MONUMENT_VERSION = 1
export const MONUMENT_ORDERS = new Set(['build_monument'])

// ---- the sites (stage 1, Z0: offline on read-only copies of the 12 shared worlds, 10-15 04:14Z; operator rules) ---------
/**
 * The site each shared world's offline gate chose (docs/reports/zig-z0m0-2026-10-15.json, both engines APPROVE), keyed by
 * pool, with its next candidates (centres). The live job VERIFIES a site with the same scoreSite on its own reads before it
 * records it: the world has changed since the snapshot. Isolated pools have none (design D2): the lane is off there.
 */
export const MONUMENT_SITES = Object.freeze({
  'board-a': { corner: { x: 289, z: 51 }, baseY: 69, stairFace: 's', next: [[315, 75], [311, 75], [309, 75]] },
  'board-b': { corner: { x: -353, z: 58 }, baseY: 71, stairFace: 'e', next: [[-329, 80], [-329, 78], [-329, 76]] },
  'board-c': { corner: { x: 287, z: 59 }, baseY: 69, stairFace: 's', next: [[309, 83], [311, 85], [311, 79]] },
  'board-d': { corner: { x: 289, z: 53 }, baseY: 69, stairFace: 's', next: [[311, 77], [313, 81], [313, 79]] },
  'hive-a': { corner: { x: 287, z: 55 }, baseY: 69, stairFace: 's', next: [[313, 79], [307, 79], [309, 79]] },
  'hive-b': { corner: { x: 287, z: 71 }, baseY: 68, stairFace: 's', next: [[311, 93], [309, 95], [311, 89]] },
  'hive-c': { corner: { x: -12, z: -156 }, baseY: 68, stairFace: 'w', next: [[12, -130], [10, -132], [10, -130]] },
  'hive-d': { corner: { x: 120, z: -36 }, baseY: 75, stairFace: 's', next: [[146, -12], [148, -12], [142, -12]] },
  'placebo-a': { corner: { x: 189, z: -112 }, baseY: 77, stairFace: 'n', next: [[211, -88], [211, -90], [215, -88]] },
  'placebo-b': { corner: { x: 186, z: -384 }, baseY: 65, stairFace: 'e', next: [[204, -360], [202, -360], [210, -362]] },
  'placebo-c': { corner: { x: 287, z: 55 }, baseY: 69, stairFace: 's', next: [[315, 77], [313, 77], [309, 79]] },
  'placebo-d': { corner: { x: 245, z: -45 }, baseY: 71, stairFace: 's', next: [[267, -21], [269, -19], [267, -19]] },
})
/** The operator-relaxed siting rules stage 1 used (owner told; stand unless they object): centre <= 80 (placebo-d 96). */
export const SITE_RULES = Object.freeze({ maxWater: 150, maxCut: 250 })

/**
 * THE SITE TO TRY for a pool -> [{ corner, stairFace }] best first: the recorded override (MONUMENT_SITE env, sandbox only),
 * else the offline site, then its next candidates (corner = centre - B/2, face toward home). Pure.
 */
export function siteCandidates (pool, home, { override = null, g = ZIG } = {}) {
  if (override) return [override]
  const s = MONUMENT_SITES[pool]
  if (!s) return []
  const out = [{ corner: { ...s.corner }, stairFace: s.stairFace }]
  for (const [cx, cz] of s.next ?? []) out.push({ corner: { x: cx - g.B / 2, z: cz - g.B / 2 }, stairFace: faceToward({ x: cx, z: cz }, home) })
  return out
}

/**
 * VERIFY ONE SITE ON LIVE READS and freeze its fill -> { ok, why, site, fill, score }. Pure over col(x, z) (scanColumn
 * results from the bot's own world): scoreSite with the operator rules picks the base height; the fill runs are then
 * derived exactly as scoreSite costs them (foundation and apron from the ground to baseY-1, the stair approach up to a +1
 * step, a 2-high guard on the apron's outer cell where the ground beyond falls more than MAX_EDGE_DROP).
 */
export function verifySite ({ col, corner, stairFace, avoid = [], g = ZIG, rules = SITE_RULES }) {
  const s = scoreSite({ col, corner, g, avoid, ...rules, stairFace })
  if (!s.ok) return { ok: false, why: s.why, score: s }
  const baseY = s.baseY, A = g.APRON, B = g.B
  const fill = []
  const tops = new Map()
  for (let i = -A - 1; i < B + A + 1; i++) for (let j = -A - 1; j < B + A + 1; j++) tops.set(`${i},${j}`, col(corner.x + i, corner.z + j)?.top)
  // foundation (inside) and apron: ground+1 .. baseY-1
  for (let i = -A; i < B + A; i++) for (let j = -A; j < B + A; j++) {
    const top = tops.get(`${i},${j}`), inner = i >= 0 && i < B && j >= 0 && j < B
    if (top < baseY - 1) fill.push([corner.x + i, corner.z + j, top + 1, baseY - 1, inner ? 'foundation' : 'apron'])
  }
  // the ring: the stair approach (filled to a +1 step) and the guard walls (2 high on the apron's outer cell)
  const guarded = new Set()
  for (let i = -A - 1; i < B + A + 1; i++) for (let j = -A - 1; j < B + A + 1; j++) {
    const outer = i === -A - 1 || j === -A - 1 || i === B + A || j === B + A
    if (!outer) continue
    const top = tops.get(`${i},${j}`)
    const ii = Math.min(Math.max(i, -A), B + A - 1), jj = Math.min(Math.max(j, -A), B + A - 1)
    const surf = Math.max(tops.get(`${ii},${jj}`) ?? baseY - 1, baseY - 1)
    const drop = surf - top
    if (inApproach(i, j, stairFace, g)) {
      if (drop > 1) fill.push([corner.x + i, corner.z + j, top + 1, surf - 1, 'approach'])
    } else if (drop > MAX_EDGE_DROP && !guarded.has(`${ii},${jj}`)) {
      guarded.add(`${ii},${jj}`)
      fill.push([corner.x + ii, corner.z + jj, surf + 1, surf + 2, 'guard'])
    }
  }
  return { ok: true, why: 'ok', site: { corner: { ...corner }, baseY, stairFace }, fill, score: s }
}

// ---- the frozen plan --------------------------------------------------------------------------------------------------

/** The planned core materials (design 2.3: cobble and stone-family; never dirt, gravel or sand). */
export const CORE_ITEMS = Object.freeze(['cobbled_deepslate', 'andesite', 'diorite', 'granite', 'tuff', 'cobblestone'])
const CORE_SET = new Set(CORE_ITEMS)
const SKIN_ROLES = new Set(['skin', 'stair', 'guard'])
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]+_concrete_powder)$/
const WATER = /^(water|flowing_water|bubble_column)$/

const planMemo = new Map()
/**
 * THE PLAN OF A RECORD -> { cells: [{x,y,z,role,i,j}], byY: Map(y -> cells), ys: [y ascending], key: Map(bk -> cell),
 * stairs: Set(bk) }. Pure and memoised per record generation: the body (zigCells) plus the record's fill runs.
 */
export function monumentPlan (rec) {
  const memoKey = `${rec?.key ?? ''}|${rec?.gen ?? ''}|${JSON.stringify(rec?.site)}|${(rec?.fill ?? []).length}`
  if (planMemo.has(memoKey)) return planMemo.get(memoKey)
  const g = rec.geom ?? ZIG, s = rec.site
  const cells = []
  for (const c of zigCells({ corner: s.corner, baseY: s.baseY, stairFace: s.stairFace }, g)) cells.push({ x: c.x, y: c.y, z: c.z, role: c.role })
  for (const [x, z, y0, y1, role] of rec.fill ?? []) for (let y = y0; y <= y1; y++) cells.push({ x, y, z, role })
  const byY = new Map(), key = new Map(), stairs = new Set()
  for (const c of cells) {
    const k = bk(c.x, c.y, c.z)
    if (key.has(k)) continue                      // a fill run never doubles a body cell
    c.i = c.x - s.corner.x; c.j = c.z - s.corner.z
    key.set(k, c)
    if (c.role === 'stair') stairs.add(k)
    if (!byY.has(c.y)) byY.set(c.y, [])
    byY.get(c.y).push(c)
  }
  const out = { cells: [...key.values()], byY, ys: [...byY.keys()].sort((a, b) => a - b), key, stairs, g }
  if (planMemo.size > 8) planMemo.clear()
  planMemo.set(memoKey, out)
  return out
}

/**
 * WHAT A PLAN CELL IS NOW -> 'done' | 'degraded' | 'foreign' | 'open' | 'clear' | 'blocked' | 'unknown'. Pure.
 *   done      skin/stair/guard holding cobblestone; core/foundation/apron/approach holding a planned core material
 *   degraded  a core-like cell holding any other full solid (dirt from an escape pillar, a log, leaves): kept (design 3.3)
 *   foreign   a skin-like cell holding another full solid: kept and counted (Z8, never dug in v1)
 *   open      replaceable now (air, short grass) or water (placing into water replaces it)
 *   clear     a non-solid, non-liquid block a bare hand removes at once (a flower, a sapling, a torch): cleared, then placed
 *   blocked   anything else (lava, a non-full block that is not instant): waited on, waived after WAIVE_BOTS bots
 *   unknown   not loaded (never a guess)
 */
const CLEARABLE = /(^dandelion$|^poppy$|_tulip$|^azure_bluet$|^oxeye_daisy$|^cornflower$|^lily_of_the_valley$|^allium$|^blue_orchid$|^sunflower$|^lilac$|^rose_bush$|^peony$|^torchflower$|^pitcher_plant$|^sweet_berry_bush$|^bush$|^firefly_bush$|^leaf_litter$|^wildflowers$|^pink_petals$|_mushroom$|^vine$|^glow_lichen$|^moss_carpet$|_carpet$|^short_dry_grass$|^tall_dry_grass$|^cactus_flower$|_sapling$|^mangrove_propagule$|^torch$|^wall_torch$|^soul_torch$|^soul_wall_torch$|^redstone_torch$|^snow$|^cobweb$|^seagrass$|^tall_seagrass$|^lily_pad$)/
export const isClearable = b => !!b && !solid(b) && !WATER.test(b.name ?? '') && !/lava/.test(b.name ?? '') && CLEARABLE.test(b.name ?? '')
export const isFillable = b => !!b && (replaceable(b) || (WATER.test(b.name ?? '') && b.name !== 'bubble_column'))
export function cellState (b, cell) {
  if (!b) return 'unknown'
  if (SKIN_ROLES.has(cell.role)) {
    if (b.name === 'cobblestone') return 'done'
    if (solid(b)) return 'foreign'
  } else {
    if (CORE_SET.has(b.name)) return 'done'
    if (solid(b)) return 'degraded'
  }
  if (isFillable(b)) return 'open'
  if (isClearable(b)) return 'clear'
  return 'blocked'
}
/** What a cell accepts as placed: the skin's cobblestone, or any planned core material. */
export const cellWants = cell => (SKIN_ROLES.has(cell.role) ? 'cobblestone' : b => CORE_SET.has(b?.name))

// ---- the layer barrier and the cover rule ------------------------------------------------------------------------------

/**
 * THE OPEN LAYER'S CENSUS -> { total, done, degraded, foreign, waived, open, clear, blocked, unknown, closed, work: [cell] }.
 * Pure. `waived` = the record's waived set (keys 'x,y,z'). A layer CLOSES when nothing is open, to clear, blocked or unknown.
 */
export function layerCensus (read, cells, waived = new Set()) {
  const out = { total: 0, done: 0, degraded: 0, foreign: 0, waived: 0, open: 0, clear: 0, blocked: 0, unknown: 0, work: [] }
  for (const c of cells) {
    out.total++
    if (waived.has(`${c.x},${c.y},${c.z}`)) { out.waived++; continue }
    const st = cellState(read(c.x, c.y, c.z), c)
    out[st]++
    if (st === 'open' || st === 'clear') out.work.push(c)
  }
  out.closed = out.open === 0 && out.clear === 0 && out.blocked === 0 && out.unknown === 0
  return out
}

/**
 * THE COVER RULE (design 3.3, Codex r3 P1, Claude r5 P2) -> { held: Set(bk), covers: [{ cover, anchor, waived }] }. Pure.
 * Every waived cell at layer y-1 whose block has no full collision cube (air, a torch) obliges its COVER, the plan cell above
 * it at y: one ANCHOR (a side neighbour of the cover at y, placed first, against which the cover is placed) and then the
 * cover go before any other y-cell within Chebyshev 1 of the cover. So no drop deeper than 1 persists, except 2 beside an
 * anchor while its cover is pending. `held` = the cells that must wait. An already-standing side neighbour is the anchor.
 */
export function coverHold (read, plan, y, waived = new Set()) {
  const held = new Set(), covers = []
  const at = plan.byY.get(y) ?? []
  const atKey = new Map(at.map(c => [`${c.x},${c.z}`, c]))
  for (const w of plan.byY.get(y - 1) ?? []) {
    if (!waived.has(`${w.x},${w.y},${w.z}`)) continue
    if (solid(read(w.x, w.y, w.z))) continue                     // footing after all: no obligation
    const cover = atKey.get(`${w.x},${w.z}`)
    if (!cover) continue
    if (solid(read(cover.x, cover.y, cover.z))) continue          // already covered
    const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => atKey.get(`${cover.x + dx},${cover.z + dz}`)).filter(Boolean)
    const standing = sides.find(s => solid(read(s.x, s.y, s.z)))
    // the anchor: an already-standing side neighbour, else the first whose own footing (the cell below) is solid
    const anchor = standing ?? sides.find(s => solid(read(s.x, s.y - 1, s.z))) ?? null
    covers.push({ cover, anchor, waived: w })
    for (const c of at) {
      if (c === cover || c === anchor) continue
      if (Math.max(Math.abs(c.x - cover.x), Math.abs(c.z - cover.z)) <= 1) held.add(bk(c.x, c.y, c.z))
    }
    // the cover itself waits for its anchor (its only faces are the anchor's sides): builder support enforces it
  }
  return { held, covers }
}

/** The next layer above y in the plan, or null when y is the top. Pure. */
export const nextLayer = (plan, y) => plan.ys.find(v => v > y) ?? null

// ---- segments ----------------------------------------------------------------------------------------------------------

/** SEGMENT of a cell (design 3.3): 0 = the centre 10 x 10 (built first), 1..4 = the quadrants NW, NE, SW, SE. Pure. */
export function segmentOf (cell, g = ZIG) {
  const c = (g.B - 1) / 2
  if (Math.abs(cell.i - c) <= 5 && Math.abs(cell.j - c) <= 5) return 0
  return 1 + (cell.i < g.B / 2 ? 0 : 1) + (cell.j < g.B / 2 ? 0 : 2)
}
export const SEGMENTS = [0, 1, 2, 3, 4]

// ---- the record (generations) -----------------------------------------------------------------------------------------

export const monumentKey = home => structureKey('monument', home)
/** The current record -> { gen, record } (gen 0 = none). */
export function readMonument (dir, key) {
  const r = readStructureRecord(dir, key)
  return r ? { gen: r.gen, record: r } : { gen: 0, record: null }
}
/** Create generation `gen` with link() (one writer wins) -> true when this call created it. */
export function createMonumentGen (dir, key, gen, body) {
  const file = path.join(dir, `${key}.g${gen}.json`)
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    fs.mkdirSync(dir, { recursive: true })
    const { gen: _g, ...clean } = body
    fs.writeFileSync(tmp, JSON.stringify({ ...clean, at: new Date().toISOString() }))
    fs.linkSync(tmp, file)
    return true
  } catch { return false } finally { try { fs.unlinkSync(tmp) } catch { /* never written */ } }
}

/** A new record from a verified site. Pure. */
export function newRecord ({ site, fill, home, world = null, g = ZIG, by = '?', now = 0 }) {
  const plan = monumentPlan({ site, fill, geom: g })
  return { v: MONUMENT_VERSION, structure: 'monument', world: world || null, home: { ...home }, site, geom: g, fill, version: MONUMENT_VERSION,
           state: 'building', layer_open: plan.ys[0], stuck: {}, waived: [], damage: {}, last_confirmed_at: null, created_at: now, sited_by: by }
}

/** Waive after this many DIFFERENT bots' visits could not complete a cell (design 3.3). */
export const WAIVE_BOTS = 3
/**
 * MERGE ONE VISIT INTO THE RECORD -> the next record body. Pure.
 *   failed   cell keys this visit could not complete (body-blocked cells excluded by the caller)
 *   placed   confirmed placements (last_confirmed_at moves)
 *   damage   counters to add
 *   advance  the new layer_open (only ever up), or null
 */
export function mergeVisit (rec, { me = '?', failed = [], placed = 0, damage = {}, advance = null, complete = false, now = 0 } = {}) {
  const out = { ...rec, stuck: { ...(rec.stuck ?? {}) }, waived: [...(rec.waived ?? [])], damage: { ...(rec.damage ?? {}) } }
  const waivedSet = new Set(out.waived)
  for (const k of failed) {
    if (waivedSet.has(k)) continue
    const bots = new Set(out.stuck[k] ?? [])
    bots.add(me)
    out.stuck[k] = [...bots].slice(0, 8)
    if (bots.size >= WAIVE_BOTS) { out.waived.push(k); waivedSet.add(k); delete out.stuck[k] }
  }
  for (const [k, v] of Object.entries(damage)) out.damage[k] = (out.damage[k] ?? 0) + (Number(v) || 0)
  if (placed > 0) out.last_confirmed_at = now
  if (advance != null && advance > (rec.layer_open ?? -Infinity)) {
    out.layer_open = advance
    // stuck counts below the new frontier are history (the frontier never moves back)
    for (const k of Object.keys(out.stuck)) if (Number(k.split(',')[1]) < advance) delete out.stuck[k]
  }
  if (complete) out.state = 'complete'
  return out
}

// ---- funding -------------------------------------------------------------------------------------------------------------

/** The bag keeps STONE_GUARD of RESERVE_STONE plus one pit-cover block (design 3.4; well.mjs guardLeft's rule). */
export const FUND_KEEP = STONE_GUARD + 1
const RESERVE_SET = new Set(RESERVE_STONE)
const count = (items, name) => (items ?? []).reduce((n, it) => n + (it?.name === name ? (Number(it.count) || 0) : 0), 0)
const reserveIn = items => (items ?? []).reduce((n, it) => n + (RESERVE_SET.has(it?.name) ? (Number(it.count) || 0) : 0), 0)
/** Blocks this bag may spend on the monument now -> { total, cobble, byItem }. Pure. */
export function fundable (items = []) {
  const spareReserve = Math.max(0, reserveIn(items) - FUND_KEEP)
  const byItem = {}
  let fromReserve = 0
  for (const name of CORE_ITEMS) {
    const have = count(items, name)
    if (!have) continue
    if (RESERVE_SET.has(name)) { const n = Math.min(have, spareReserve - fromReserve); if (n > 0) { byItem[name] = n; fromReserve += n } } else byItem[name] = have
  }
  const total = Object.values(byItem).reduce((a, b) => a + b, 0)
  return { total, cobble: Math.min(count(items, 'cobblestone'), spareReserve), byItem }
}
/**
 * THE BLOCK TO HOLD FOR A CELL -> item name | null. Pure. Skin-like: cobblestone, only above the reserve. Core-like: the
 * other stone-family first (cobble is the skin's), then cobble -- every reserve item only above the reserve.
 */
export function fundPick (items, cell) {
  const spare = reserveIn(items) - FUND_KEEP
  const can = name => count(items, name) > 0 && (!RESERVE_SET.has(name) || spare > 0)
  if (SKIN_ROLES.has(cell.role)) return can('cobblestone') ? 'cobblestone' : null
  return CORE_ITEMS.find(can) ?? null
}
/** At least this much to spend before a visit is worth the walk (design 3.4). */
export const MIN_SPEND = 16

// ---- admission (one pure function decides; design 3.4) ------------------------------------------------------------------

export const MONUMENT_COOLDOWN_MS = Number(process.env.MONUMENT_COOLDOWN_MS ?? '') > 0 ? Number(process.env.MONUMENT_COOLDOWN_MS) : 10 * 60_000
export const MONUMENT_BUDGET_MS = 10 * 60_000          // body time per bot-hour (the projects lane's cap, shared)
export const NOTHING_BACKOFF_MS = 60 * 60_000
export const FAULT_BACKOFF_MS = 30 * 60_000
export const NO_SITE_BACKOFF_MS = 6 * 60 * 60_000
/** A bot within this (horizontal, of the site's centre) may be sent; the town (<= 48 of home) is inside it for every site. */
export const ORDER_RADIUS = 136
export const SLOTS = 3
export const SLOT_LEASE_MS = 4 * 60_000
export const VISIT_MS = 90_000
export const VISIT_MAX_PLACEMENTS = 48
export const REPAIR_PER_VISIT = 8
/**
 * MAY THIS BOT BE SENT NOW? -> { order | null, state, why }. Pure.
 *   enabled, siteKnown   the lane is on here (a pool with a site or a record; never an isolated pool)
 *   record               lazy: the current record (null: none yet -- the visit sites it)
 *   distSite             horizontal distance to the site centre
 *   items, slots         the bag; slots used
 *   noRoom               a conversion is waiting for room (a full bag with it pending goes to the well -- design 3.4)
 *   freeSlot             lazy: an admission slot is free
 */
export function monumentOrder ({ now = 0, enabled = true, siteKnown = false, record = null, distSite = Infinity, items = [], slots = 0, noRoom = false, freeSlot = () => true, state = {} } = {}) {
  const s = { ...state, spent: (state.spent ?? []).filter(v => now - v.t < 3_600_000) }
  const none = why => ({ order: null, state: s, why })
  if (!enabled || !siteKnown) return none('off')
  if (now < (s.backoffUntil ?? 0)) return none('backoff')
  if (now - (s.lastIssuedAt ?? -Infinity) < MONUMENT_COOLDOWN_MS) return none('cooldown')
  if (s.spent.reduce((a, v) => a + v.ms, 0) >= MONUMENT_BUDGET_MS) return none('budget')
  if (slots >= 34 && noRoom) return none('full_bag_conversion')
  if (!(distSite <= ORDER_RADIUS)) return none('far')
  const f = fundable(items)
  if (f.total < MIN_SPEND) return none('funds')
  const rec = typeof record === 'function' ? record() : record
  if (rec && rec.state !== 'building') return none(`state_${rec.state}`)
  if (rec && !(typeof freeSlot === 'function' ? freeSlot() : freeSlot)) return none('slots_full')
  s.lastIssuedAt = now
  return { order: { skill: 'build_monument', args: {}, why: `the town monument (the ziggurat): ${f.total} blocks to spend (${f.cobble} cobble), ${Math.round(distSite)} from its centre` }, state: s, why: 'ok' }
}
/** After a visit -> the new state. Pure. `ms` = the visit's body time (charged to the hourly budget). */
export function monumentOrderOutcome (status, failClass, now = 0, ms = 0, state = {}) {
  const s = { ...state, spent: [...(state.spent ?? []), { t: now, ms: Math.max(0, ms) }].filter(v => now - v.t < 3_600_000) }
  if (status === 'success') s.backoffUntil = 0
  else if (failClass === 'monument_no_site') s.backoffUntil = now + NO_SITE_BACKOFF_MS
  else if (failClass === 'monument_nothing_open') s.backoffUntil = now + NOTHING_BACKOFF_MS
  else if (status === 'failed') s.backoffUntil = now + FAULT_BACKOFF_MS
  // any other skip (slots full, nothing affordable this time, aborted): the cooldown alone
  return s
}

// ---- the visit row ------------------------------------------------------------------------------------------------------

/** THE `_monument` ROW, key=value (the read parses fields, never prose), cut at 400. */
export function monumentDetail (f = {}) {
  const kv = (k, v) => `${k}=${v ?? '-'}`
  const parts = [kv('gen', f.gen), kv('layer', f.layer), kv('seg', f.seg), kv('placed', f.placed ?? 0), kv('cleared', f.cleared ?? 0), kv('refused', f.refused ?? 0),
    kv('silent', f.silent ?? 0), kv('unreach', f.unreachable ?? 0), kv('repair', f.repair ?? 0), kv('open', f.open), kv('done', f.done), kv('degraded', f.degraded),
    kv('foreign', f.foreign), kv('waived', f.waived), kv('blocked', f.blocked), kv('held', f.held ?? 0), kv('fund', f.fund), kv('cobble0', f.cobble0), kv('cobble1', f.cobble1),
    kv('gate_ms_p95', f.gateP95), kv('gate_ms_max', f.gateMax), kv('lag_ms_max', f.lagMax), kv('advanced', f.advanced ?? 0), kv('slot', f.slot), kv('t0', Math.round(f.t0 ?? 0)),
    kv('stop', String(f.stop ?? 'done').replace(/\s+/g, '_').slice(0, 40)), kv('why', String(f.why ?? '-').replace(/\s+/g, '_').slice(0, 60))]
  return parts.join(' ').slice(0, 400)
}

/** p95 of a list of numbers (0 for none). Pure. */
export const p95 = xs => { if (!xs?.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(0.95 * (s.length - 1)))] }

export { profileAt }
