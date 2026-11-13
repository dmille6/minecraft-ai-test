// GLASS-01 (OWNER 2026-11-08: "build a sand-to-glass line ... so cottages and other buildings get real windows"). The town
// materials job (mats.mjs materialOrder) gets two GLASS KINDS beside its part kinds:
//   sand    dig shore sand into the town -- ONLY while the town's windows want panes the town cannot make, and only up to a cap
//   glaze   swap a finished building's FALLBACK window block (planks, a trapdoor) for a glass pane from town stock
// The smelt in between is the mats `panes` kind, unchanged (6 sand on 4 planks -> 6 glass -> 16 glass_pane; stoneworks-01 keeps
// glass on the planks rung). EVERY DECISION IS HERE AND PURE; skills.mjs walks, digs, places and banks.
//
// MEASURED 11-08 (read-only: live region files, the town index, the bots' records; report docs/reports/glass-2026-11-08.md):
//   - windows: 22 fleet buildings (house@1 3 + workshop@1 4 in 11 towns) = 77 window cells: 3 glass (hive-c house1), 74 PLANKS
//     (the `$wall` fallback). Showcase: 66 window cells in 7 buildings, 29 glass, 32 spruce planks (storehub 23, enchantshop 5,
//     house1 3, storehouse 1), cottage1 5 not built -- its 35 panes in stock cover them all with no sand.
//   - town stock (12 shared/board/placebo towns): sand 161 (10 of 12 hold 0; hive-d 126, hive-c 30), glass_pane 61 (hive-c 29,
//     hive-d 32), glass 6; showcase sand 92, panes 35. The panes kind works where sand exists: sand is the bottleneck.
//   - where the sand is (R 128 round each home, surface columns): dry or shore surface sand with a dry stand, ~20-90 cells per
//     town within 96 (hive-d a desert: 3,032; board-b 4, placebo-d 2); nearest 33-69 b, most past the town's own 24 b.
//     Seabed sand is 2-10x commoner but under water: never a target here (owner: shore or shallows only, never deep water).
//   - drowning (24 h to 11-08 ~21Z, 80 bots, 2.33 M rows): 2 of 13 deaths, both underground (y 15, y 47), > 16 b from any
//     candidate sand cell.
// THE NEED IS SMALL AND CAPPED (sandrung-01, KEPT 11-08: generic sand gathering was the fleet's most-failed rung, 7.5% of bot
// time): one 6-sand batch makes 16 panes; a fleet town's 7 windows take ONE batch. The town's sand TARGET is the BUILD_RESERVE's
// sand (16, the panes kind's floor) + 6 per batch the unglazed windows still need beyond the panes in stock, never above
// SAND_TOWN_CAP; with no unglazed window there is no sand order at all.
//
// Rollback: GLASS=off -> no sand and no glaze order (the panes kind and every blueprint as before).

import { COTTAGE_NAMES } from './homeplots.mjs'   // homes-01show: every cottage project's name (three without a layout)

export const GLASS_V = 1
export const glassMode = (env = {}) => ({ on: !['off', '0', 'false', 'no'].includes(String(env?.GLASS ?? '').trim().toLowerCase()) })
export const GLASS = Object.freeze(glassMode(typeof process !== 'undefined' ? process.env : {}))

export const PANES_PER_BATCH = 16
export const SAND_PER_BATCH = 6
/** The town's sand target never passes this (16 reserve + 4 batches = 64 panes: more windows than any town has). */
export const SAND_TOWN_CAP = 40
/** One sand order digs at most this many (one bag slot; ~12 digs fit the runner's 180 s with the walks). */
export const SAND_PER_ORDER = 12
/** Where the sand may be: past the town's own ground (the tidy's and the plan's), within a walk the 180 s order affords. */
export const SAND_R_MIN = 24
export const SAND_R_MAX = 96
/** No water this deep (blocks of liquid in one column) within SAND_DEEP_R of the cell: shallows only, never deep water. */
export const SAND_DEEP = 2
export const SAND_DEEP_R = 2
/** A failed target cell (walk, dig, pickup) is not tried again by this bot for this long. */
export const SAND_BAD_MS = 6 * 60 * 60 * 1000
/** After an order found no target, this bot asks again only after this long (a town without sand stops asking). */
export const SAND_NONE_MS = 2 * 60 * 60 * 1000
/** One glaze order places at most this many panes. */
export const GLAZE_PER_ORDER = 8
/** After a glaze order placed nothing, this bot asks again only after this long. */
export const GLAZE_NONE_MS = 60 * 60 * 1000

/** The building plots whose records may name window cells (fleet: shop, house1; the showcase's styled buildings too). */
export const GLASS_PLOTS = Object.freeze(['shop', 'house1', 'house2', 'house3', ...COTTAGE_NAMES, 'hall', 'townhall', 'storehub', 'enchantshop', 'storehouse'])

/** THE WINDOW PALETTE (glass-01): glass when the town has it, else a wood TRAPDOOR of the building's species (crafted by the
 *  build visit, townstyle.mjs woodPartsPlan), else the wall itself -- a window never stalls a building. Blueprints share it. */
export const windowPalette = (wall = '$wall') => ['glass_pane', '%wood_trapdoor', wall]

const nm = b => String(b?.name ?? '')
const wlogged = b => b?.props?.waterlogged === true || b?.props?.waterlogged === 'true'
const WATERISH = /^(water|bubble_column|flowing_water|kelp|kelp_plant|seagrass|tall_seagrass)$/
const isWater = b => !!b && (WATERISH.test(nm(b)) || wlogged(b))
const isLiquid = b => !!b && (isWater(b) || /^(lava|flowing_lava)$/.test(nm(b)))
export const isSand = b => /^(sand|red_sand)$/.test(nm(b))
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]+_concrete_powder|anvil|chipped_anvil|damaged_anvil|pointed_dripstone)$/
/** A cell a body passes through (air and the plants a step walks into). */
const PASSABLE = /^(air|cave_air|void_air|short_grass|tall_grass|grass|fern|large_fern|dead_bush|snow|[a-z_]+_sapling|dandelion|poppy|[a-z_]+_tulip|cornflower|azure_bluet|oxeye_daisy|allium|lily_of_the_valley|blue_orchid|short_dry_grass|tall_dry_grass|bush|leaf_litter|firefly_bush)$/
const passable = b => !!b && PASSABLE.test(nm(b)) && !wlogged(b)
const solidFloor = b => !!b && b.boundingBox === 'block' && !isLiquid(b) && !/_leaves$/.test(nm(b))

/** The roles of a palette that are WINDOWS: their first choice is a glass pane. Pure. */
export const windowRoles = (palette = {}) => Object.entries(palette ?? {}).filter(([, l]) => Array.isArray(l) && l[0] === 'glass_pane').map(([r]) => r)

/**
 * IS `name` A FALLBACK THIS WINDOW ROLE ALLOWS -> true | false. Pure. Every choice after the glass: a concrete name, '%wood_x' (a
 * token: any species' `_x`), '$planks' (any planks), '$role' (that role's own choices, once each). Never the glass itself, never air.
 */
export function isFallback (name, palette = {}, role = 'window', seen = new Set()) {
  const n = String(name ?? '')
  if (!n || n === 'air' || n === 'glass_pane' || n === 'glass') return false
  if (seen.has(role)) return false
  seen.add(role)
  for (const choice of palette?.[role] ?? []) {
    const c = String(choice)
    if (c === 'glass_pane' || c === '*solid') continue
    if (c === '$planks') { if (/_planks$/.test(n)) return true; continue }
    if (c.startsWith('$')) { if (isFallback(n, palette, c.slice(1), seen)) return true; continue }
    if (c.startsWith('%')) { const suf = c.replace(/^%[a-z]+/, ''); if (suf && n.endsWith(suf)) return true; continue }
    if (c === n) return true
  }
  return false
}

/**
 * THE TOWN'S WINDOWS -> { cells, glazed, unglazed, fallback: [{ at, name, plot, role }], unknown }. Pure.
 *   buildings  [{ plot, rec, palette, complete }] -- the record and its palette (the record's own when it carries one: a styled
 *              build resolved its tokens at siting; else the blueprint's)
 *   read(x, y, z) the world (null: unknown -- never counted glazed, never a target)
 * `unglazed` is every window cell that is not glass (built or not); `fallback` the cells of COMPLETE buildings standing a
 * fallback block -- the glaze's targets.
 */
export function windowsOf (buildings = [], read = () => null) {
  const out = { cells: 0, glazed: 0, unglazed: 0, fallback: [], unknown: 0 }
  for (const b of buildings ?? []) {
    const pal = b?.palette ?? {}
    const roles = new Set(windowRoles(pal))
    if (!roles.size) continue
    for (const c of b?.rec?.cells ?? []) {
      if (!roles.has(c?.role) || !Array.isArray(c?.at)) continue
      out.cells++
      const blk = read(...c.at)
      if (!blk) { out.unknown++; continue }
      if (nm(blk) === 'glass_pane') { out.glazed++; continue }
      out.unglazed++
      if (b.complete && isFallback(nm(blk), pal, c.role)) out.fallback.push({ at: c.at.slice(), name: nm(blk), plot: b.plot, role: c.role })
    }
  }
  return out
}

/**
 * THE SAND THE TOWN WANTS NOW -> { want, target, short, batches }. Pure.
 *   unglazed  the window cells not yet glass; panes the town's glass_pane stock; sand its sand + red_sand; reserveSand the
 *             BUILD_RESERVE's sand (the panes kind spends only above it)
 * short = the panes the windows still lack; batches = whole 6-sand batches for them; target = reserve + 6 x batches, capped.
 */
export function sandWant ({ unglazed = 0, panes = 0, sand = 0, reserveSand = 16, cap = SAND_TOWN_CAP } = {}) {
  const short = Math.max(0, (Number(unglazed) || 0) - (Number(panes) || 0))
  if (short <= 0) return { want: 0, target: 0, short: 0, batches: 0 }
  const batches = Math.ceil(short / PANES_PER_BATCH)
  const target = Math.min(cap, Math.max(0, Number(reserveSand) || 0) + SAND_PER_BATCH * batches)
  return { want: Math.max(0, target - (Number(sand) || 0)), target, short, batches }
}

/**
 * THE GLASS ORDER -> { order, kind, why, n }. Pure; materialOrder calls it after its own gates (switch, town, cooldown, room,
 * coverage, bank room) with the town's stock and the glass reading (lazy: read only when the switch is on).
 *   reading  -> { unglazed, fallback: n, mem: { sandNoneUntil, glazeNoneUntil } } | null (unreadable: no glass order)
 * GLAZE FIRST (the windows show it; it spends stock the town holds), then SAND (only for windows the panes cannot cover).
 */
export function glassOrder ({ on = GLASS.on, now = 0, stock = {}, reading = null, reserveSand = 16, freeSlots = 0 } = {}) {
  if (!on) return { order: null, kind: null, why: 'off' }
  const r = typeof reading === 'function' ? reading() : reading
  if (!r) return { order: null, kind: null, why: 'unreadable' }
  const panes = Number(stock?.glass_pane) || 0
  const sand = (Number(stock?.sand) || 0) + (Number(stock?.red_sand) || 0)
  const mem = r.mem ?? {}
  if ((r.fallback ?? 0) > 0 && panes > 0 && now >= (mem.glazeNoneUntil ?? 0) && freeSlots >= 2) {
    const n = Math.min(r.fallback, panes, GLAZE_PER_ORDER)
    return { order: { skill: 'make_material', args: { item: 'glaze' }, why: `${r.fallback} window(s) of the town's finished buildings stand a fallback block and the town holds ${panes} glass pane(s): glaze ${n} (town materials job)` }, kind: 'glaze', why: null, n }
  }
  const w = sandWant({ unglazed: r.unglazed, panes, sand, reserveSand })
  if (w.want <= 0) return { order: null, kind: null, why: (r.unglazed ?? 0) > 0 ? 'sand_stocked' : 'no_windows' }
  if (now < (mem.sandNoneUntil ?? 0)) return { order: null, kind: null, why: 'sand_none_wait' }
  if (freeSlots < 2) return { order: null, kind: null, why: 'room' }
  const n = Math.min(w.want, SAND_PER_ORDER)
  return { order: { skill: 'make_material', args: { item: 'sand' }, why: `the town's windows want ${w.short} more glass pane(s) than it holds and it has ${sand} sand, below its target of ${w.target}: dig ${n} shore sand (town materials job)` }, kind: 'sand', why: null, n }
}

/** The depth of the deepest run of water in the column (x, z) from y + 1 down to y - max (blocks). Pure over `read`. */
export function waterDepth (read, x, y, z, max = 6) {
  let d = 0, best = 0
  for (let yy = y + 1; yy >= y - max; yy--) {
    if (isWater(read(x, yy, z))) { d++; if (d > best) best = d } else d = 0
  }
  return best
}

/**
 * IS THIS A SAND CELL THE TOWN MAY DIG -> { ok, why }. Pure over `read`. The bot STANDS ON the sand (feet y + 1), digs it, drops one
 * block into the hole and picks the sand up there. So:
 *   - the cell is sand with a passable, dry cell above it and above that (the stand: feet and head) -- the top of its column, so
 *     no falling block comes down after it
 *   - the cell below is a solid floor (the hole is ONE deep: the landing), never liquid
 *   - no liquid beside the cell or the stand (4 sides, at the cell's level and the stand's two): the hole stays dry
 *   - a way out: a side column whose floor is the cell's level with room over it (one step up from the landing)
 *   - no water SAND_DEEP deep within SAND_DEEP_R of it: shallows only, never deep water (the drowning rule)
 *   - inside the ring [rMin, rMax] of home, never `reserved(x, z, y)` (a record, a protect zone)
 */
/** Is (x, z) inside a bridge site's footprint (bridge.mjs bridgeZones boxes, built or not: its banks and approaches)? Pure.
 *  glass-01 fold (Codex BLOCKER): the sand dig never takes a bridge's bank -- the tidy's own guard is per cell, the dig's is the zone. */
export const inBridgeZone = (zones = [], x, z) => (zones ?? []).some(q => Array.isArray(q?.box) && x >= q.box[0] && x <= q.box[3] && z >= q.box[2] && z <= q.box[5])
export function sandCellOk (read, at, { home = null, rMin = SAND_R_MIN, rMax = SAND_R_MAX, reserved = () => false } = {}) {
  const [x, y, z] = at
  if (home) {
    const d = Math.hypot(x - home.x, z - home.z)
    if (d < rMin) return { ok: false, why: 'town' }
    if (d > rMax) return { ok: false, why: 'far' }
  }
  if (!isSand(read(x, y, z))) return { ok: false, why: 'not_sand' }
  const a1 = read(x, y + 1, z), a2 = read(x, y + 2, z)
  if (!a1 || !a2) return { ok: false, why: 'unknown' }
  if (isLiquid(a1) || isLiquid(a2)) return { ok: false, why: 'wet' }
  if (FALLING.test(nm(a1)) || !passable(a1) || !passable(a2)) return { ok: false, why: 'covered' }
  const below = read(x, y - 1, z)
  if (!below) return { ok: false, why: 'unknown' }
  if (!solidFloor(below)) return { ok: false, why: 'no_floor' }
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const yy of [y, y + 1, y + 2]) {
      const n = read(x + dx, yy, z + dz)
      if (!n) return { ok: false, why: 'unknown' }
      if (isLiquid(n)) return { ok: false, why: 'wet' }
    }
  }
  // A WAY OUT OF THE HOLE (Codex r1 BLOCKER): from the landing (feet y) one step up onto a side column whose floor is the cell's own
  // level -- a solid block at y with two passable cells over it. A sand cell at the bottom of a dry dip would leave the bot two below
  // every side, and sand is no scaffold: never dug.
  if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => solidFloor(read(x + dx, y, z + dz)) && passable(read(x + dx, y + 1, z + dz)) && passable(read(x + dx, y + 2, z + dz)))) return { ok: false, why: 'no_exit' }
  for (let dx = -SAND_DEEP_R; dx <= SAND_DEEP_R; dx++) {
    for (let dz = -SAND_DEEP_R; dz <= SAND_DEEP_R; dz++) {
      if (waterDepth(read, x + dx, y, z + dz, SAND_DEEP + 2) >= SAND_DEEP) return { ok: false, why: 'deep_water' }
    }
  }
  if (reserved(x, z, y)) return { ok: false, why: 'reserved' }
  return { ok: true, why: null }
}

/**
 * THE ORDER'S DIG LIST -> { plan: [{ at }], eligible, refused: { why: n } }. Pure. `cands` [[x, y, z]] (a block search's sand),
 * filtered by sandCellOk and `bad` (cell keys this bot failed); then a WALK: the nearest to `from` first, each next the nearest to
 * the last (one patch of beach lowered, not pits all over it). Each cell is read again live before its dig.
 */
export function sandPlan (cands = [], { read, home, from = null, bad = new Set(), max = SAND_PER_ORDER, reserved = () => false } = {}) {
  const ok = []
  const refused = {}
  for (const c of cands ?? []) {
    if (!Array.isArray(c)) continue
    if (bad.has?.(c.join(','))) { refused.bad = (refused.bad ?? 0) + 1; continue }
    const r = sandCellOk(read, c, { home, reserved })
    if (!r.ok) { refused[r.why] = (refused[r.why] ?? 0) + 1; continue }
    ok.push(c)
  }
  const plan = []
  let cur = from ?? [home?.x ?? 0, home?.y ?? 0, home?.z ?? 0]
  const left = ok.slice()
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  while (plan.length < max && left.length) {
    let bi = 0
    for (let i = 1; i < left.length; i++) {
      const di = d2(left[i], cur), db = d2(left[bi], cur)
      if (di < db || (di === db && ((left[i][0] - left[bi][0]) || (left[i][2] - left[bi][2]) || (left[i][1] - left[bi][1])) < 0)) bi = i
    }
    const [c] = left.splice(bi, 1)
    plan.push({ at: c })
    cur = c
  }
  return { plan, eligible: ok.length, refused }
}

/**
 * WHERE A PANE IS PLACED FROM -> [{ ref: [x, y, z], face: [dx, dy, dz] }] in order. Pure. The block below the window (its top face:
 * a pane stands on the wall course under it), then the wall cells either side (their side faces), then the one above; never a
 * liquid, leaves or a block without a full box.
 */
export function paneRefs (read, at) {
  const [x, y, z] = at
  const out = []
  if (solidFloor(read(x, y - 1, z))) out.push({ ref: [x, y - 1, z], face: [0, 1, 0] })
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (solidFloor(read(x + dx, y, z + dz))) out.push({ ref: [x + dx, y, z + dz], face: [-dx || 0, 0, -dz || 0] })
  }
  if (solidFloor(read(x, y + 1, z))) out.push({ ref: [x, y + 1, z], face: [0, -1, 0] })
  return out
}

/** The glaze's targets in order -> the nearest to `from` first (ties by cell), at most `max`, never a `bad` cell. Pure. */
export function glazePlan (fallback = [], { from = [0, 0, 0], max = GLAZE_PER_ORDER, bad = new Set() } = {}) {
  const d2 = a => (a[0] - from[0]) ** 2 + (a[1] - from[1]) ** 2 + (a[2] - from[2]) ** 2
  return (fallback ?? []).filter(f => Array.isArray(f?.at) && !bad.has?.(f.at.join(',')))
    .slice().sort((a, b) => d2(a.at) - d2(b.at) || a.at[0] - b.at[0] || a.at[2] - b.at[2] || a.at[1] - b.at[1]).slice(0, max)
}

/** A `_glass` row's detail (one line, `k=v`). Pure. */
export function glassDetail (f = {}) {
  const kv = (k, v) => `${k}=${v == null || v === '' ? '-' : typeof v === 'object' ? (Object.entries(v).map(([a, b]) => `${a}:${b}`).join(',') || '-') : v}`
  return ['op', 'stop', 'want', 'eligible', 'planned', 'dug', 'got', 'banked', 'walkfail', 'digfail', 'nopick', 'refused', 'targets', 'placed', 'dugwin', 'placefail', 'took', 'from', 'dist', 'unglazed', 'fallback', 'panes', 'sand', 'ms']
    .filter(k => f[k] !== undefined).map(k => kv(k, f[k])).join(' ')
}

/** The licence row's detail (`_glass_mode`, once per spawn). Pure. */
export const glassModeDetail = (on = GLASS.on) => `v=${GLASS_V} on=${on ? 1 : 0} cap=${SAND_TOWN_CAP} per=${SAND_PER_ORDER} r=${SAND_R_MIN}-${SAND_R_MAX} deep=${SAND_DEEP}/${SAND_DEEP_R} glaze=${GLAZE_PER_ORDER}`

// ---- this process's memory (the skill writes it, the reading carries it to the order) ------------------------------------------
const MEM = { bad: new Map(), glazeBad: new Map(), sandNoneUntil: 0, glazeNoneUntil: 0 }
const live = (m, now) => { for (const [k, t] of m) if (now >= t) m.delete(k); return new Set(m.keys()) }
/** -> { sandNoneUntil, glazeNoneUntil, bad: Set, glazeBad: Set } (expired cells forgotten). */
export const glassMem = (now = Date.now()) => ({ sandNoneUntil: MEM.sandNoneUntil, glazeNoneUntil: MEM.glazeNoneUntil, bad: live(MEM.bad, now), glazeBad: live(MEM.glazeBad, now) })
export function glassMemNote ({ badCell = null, glazeBadCell = null, sandNone = false, glazeNone = false, now = Date.now() } = {}) {
  if (badCell) MEM.bad.set(String(badCell), now + SAND_BAD_MS)
  if (glazeBadCell) MEM.glazeBad.set(String(glazeBadCell), now + SAND_BAD_MS)
  if (sandNone) MEM.sandNoneUntil = now + SAND_NONE_MS
  if (glazeNone) MEM.glazeNoneUntil = now + GLAZE_NONE_MS
}
/** Test hook: a fresh process. */
export function _resetGlassMem () { MEM.bad.clear(); MEM.glazeBad.clear(); MEM.sandNoneUntil = 0; MEM.glazeNoneUntil = 0 }

// ---- the reading's provider (features.mjs installs it per spawn: materialOrder's caller is protected, its arguments fixed) -------
let PROVIDER = null
export const setGlassReading = f => { PROVIDER = typeof f === 'function' ? f : null }
export const glassReadingNow = () => { try { return PROVIDER ? PROVIDER() : null } catch { return null } }
