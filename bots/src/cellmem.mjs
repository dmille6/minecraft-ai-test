// REMEMBER WHERE IT FAILED, GO WHERE IT WORKED (town map, stage 1; docs/reports/town-map-plan-2026-10-03.md).
//
// Measured 10-03 (80 bots, 3 h, full walk): of 1,290 failed log gathers, 1,248 had a log within 40 blocks (median 5)
// -- the bots see wood and fail to REACH it -- and 696 of 1,062 hard failures (65.5%) were the same bot failing within
// 16 blocks of its own failure in the previous 30 min. The admission cooldown (45 s, keyed on skill+args, no place)
// cannot see that. This is a per-bot, in-memory grid of gather outcomes by 16x16 column, and the two decisions it
// feeds: refuse a gather here, and where to walk instead.
//
// Everything below is pure (the clock is a parameter) so the decisions are tested by behaviour, not by source text.
//
// READ NOTES (for the canary read; both reviews of fa1016f):
//   - NO HOME TETHER. A trip goes up to TRIP_CAP from wherever the bot stands, not from home. Read deaths (the
//     two-death floor) and the time spent on deposit/home walks per bot-hour, canary vs control, DiD.
//   - A refusal is a `no_effect` gather with class cell_refused; the runner's skill row carries no failClass for a
//     no_effect, so the refusal is identified by its `_cell_refused` row (and `_cell_target` for the walk).
//     EXCLUDE no_effect gather rows from every gather success/failure denominator, or the refusals read as failures.
//   - Never refused (exemptReason): ores, gathers under rock or soil (a rock/soil ROOF counts too: names cannot tell
//     it from terrain), and anything at night without a bed. Each would-be refusal it waives is a `_cell_exempt` row,
//     at most one per reason, column and family every EXEMPT_LOG_MS per bot. FOUR reason values:
//       reason=ore | underground | night   -- the three exemptions
//       reason=unknown                     -- the check itself threw (e.g. a block read failed); waived, not refused
//     Read them as the population the change did NOT touch; iron numbers should not move by it, and night gathers
//     behave as before. A rising `unknown` share is an instrument fault, not a behaviour.

export const CELL = 16
/** The measured hard-failure classes: the bot found the material and could not reach it. Not nothing_found (a
 *  fact about the search radius, place-scoped in lessons.mjs) and not inventory_full (a fact about the bag). The
 *  "A* reached a candidate [collect threw nothing]" failure is a no_path (barrenFailClass) and is named in `reason`. */
export const HARD_FAIL = new Set(['no_path', 'unreachable', 'no_safe_target'])
export const REFUSE_FAILS = 2
export const REFUSE_WINDOW_MS = 30 * 60_000
export const VISIT_FRESH_MS = 4 * 3600_000
/** The frontier ring: a cell centre at least FRONTIER_MIN away (gather searches 32 by default, so a nearer cell
 *  searches mostly the same ground) and at most FRONTIER_MAX. */
export const FRONTIER_MIN = 32
export const FRONTIER_MAX = 96
/** What ONE explore call can actually cover (14 legs of 12, less detours); a target past it is never arrived at. */
export const TRIP_CAP = 120
/** A success older than this is not "where it works now": forests are cut, and other bots cut them. */
export const SUCCESS_FRESH_MS = 2 * 3600_000
export const BEARING_WALK = 60
/** Bounds. A (cell, family) entry is ~100 bytes; a visit is one Map slot. LRU by last touch. */
export const MAX_ENTRIES = 1024
export const MAX_VISITS = 4096
const FAIL_TIMES_KEPT = 4

const norm = s => String(s ?? '').toLowerCase().replace(/^minecraft:/, '')

/** The kind family a gather counts toward. Logs are one family, as explore-toward groups them (any log serves a
 *  wood rung); deepslate ores are their ore. Everything else is its own name. */
export function familyOf (block) {
  const b = norm(block)
  if (!b) return null
  if (b === 'log' || b === 'wood' || /_(log|wood)$/.test(b)) return 'log'
  return b.replace(/^deepslate_(?=.*_ore$)/, '')
}

/** Never refuse an ore: the buried copy is the only copy and the ore tunnel (oretunnel.mjs) is its remedy. */
const NEVER_REFUSED = /(_ore|^ancient_debris)$/
export const refusable = family => !!family && !NEVER_REFUSED.test(family)

/**
 * Pure: why a refusal that would otherwise fire is waived, or null. A refusal must name a remedy the bot can perform
 * from where it is (CLAUDE.md), and the remedy here is a horizontal walk:
 *   ore          the buried copy is the only copy; the ore tunnel is its remedy, not a walk
 *   underground  under rock or soil a horizontal walk is a walk through stone
 *   night        no trips at night without a bed (owner/coordinator decision 10-03): the gather runs as before
 */
export function exemptReason (block, { underground = false, night = false, hasBed = false } = {}) {
  if (!refusable(familyOf(block))) return 'ore'
  if (underground) return 'underground'
  if (night && !hasBed) return 'night'
  return null
}

/**
 * Pure: is the bot under ROCK OR SOIL, given the solid blocks above its head (nearest first)? Tree cover is not
 * underground: the main population this change exists for is a bot under an oak canopy, and the old test (any
 * boundingBox 'block' overhead) read every canopy as a cave and never refused there (both second reviews).
 */
// ONLY ROCK OR SOIL COUNTS: leaves, logs, planks, glass, bricks and other built blocks never match, so a canopy, a
// trunk or a timber roof reads as open sky. An allowlist of what IS underground (as cognitive.mjs keeps its evidence
// classes): an unlisted block can only ever fail to waive a refusal, never wrongly waive one.
//
// THE CONTRACT, ACCEPTED (Codex, third pass): a name cannot tell a built roof from terrain. A bot under a COBBLESTONE
// (or dirt, or stone) roof is treated as underground: exempt, never refused. That errs toward the old behaviour --
// the gather runs and the row says reason=underground -- which is the safe direction for a refusal.
// Terracotta counts in its plain and sixteen dyed forms (badlands generate them); GLAZED terracotta is smelted, never
// natural, and does not.
const DYES = 'white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black'
const ROCK_OR_SOIL = new RegExp(
  '^(stone|deepslate|cobblestone|mossy_cobblestone|cobbled_deepslate|tuff|calcite|andesite|diorite|granite|dripstone_block|' +
  'gravel|suspicious_gravel|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|clay|sand|suspicious_sand|red_sand|' +
  'sandstone|red_sandstone|netherrack|basalt|smooth_basalt|blackstone|bedrock|obsidian|magma_block|soul_sand|soul_soil|' +
  'end_stone|sculk|amethyst_block|budding_amethyst|ice|packed_ice|blue_ice|snow_block|moss_block)$' +
  '|^infested_' + '|_ore$' + `|^((${DYES})_)?terracotta$`)
export function undergroundFrom (namesAbove) {
  return (namesAbove ?? []).some(n => ROCK_OR_SOIL.test(norm(n)))
}

/** One `_cell_exempt` row per reason, column and family per bot in this long. */
export const EXEMPT_LOG_MS = 10 * 60_000
export function exemptLogDue (mem, key, now) {
  if (!mem) return false
  const last = mem.exemptLogged.get(key)
  if (last != null && now - last < EXEMPT_LOG_MS) return false
  touch(mem.exemptLogged, key, now, MAX_ENTRIES)
  return true
}

/** Does inventory item `name` count as a gain for `family`? Logs by suffix; otherwise the caller's drop names. */
export function countsFor (family, name, dropNames = null) {
  const n = norm(name)
  if (family === 'log') return /_(log|wood)$/.test(n)
  return dropNames ? dropNames.has(n) : n === family
}

export function cellOf (pos) {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return null
  return { cx: Math.floor(pos.x / CELL), cz: Math.floor(pos.z / CELL) }
}
export const cellKey = (cx, cz) => `${cx},${cz}`
const centre = (cx, cz) => ({ x: cx * CELL + CELL / 2, z: cz * CELL + CELL / 2 })
const entryKey = (cx, cz, family) => `${cx},${cz}|${family}`

export function createCellMemory () {
  return { entries: new Map(), visits: new Map(), trips: new Map(), exemptLogged: new Map() }
}

function touch (map, key, value, cap) {
  map.delete(key)
  map.set(key, value)
  while (map.size > cap) map.delete(map.keys().next().value)
}

export function visit (mem, pos, now) {
  const c = cellOf(pos)
  if (!mem || !c) return
  touch(mem.visits, cellKey(c.cx, c.cz), now, MAX_VISITS)
}

/** The hard-failure reason of a gather result, or null when the result is not a hard failure. */
export function hardFailReason (result) {
  if (!result || result.status === 'success') return null
  if (!HARD_FAIL.has(result.failClass)) return null
  return /collect threw nothing/.test(String(result.detail ?? '')) ? `${result.failClass}:collect_threw_nothing` : result.failClass
}

/**
 * Record one gather return. `pos` is where the gather STARTED (the refusal is asked there). Success is items
 * actually gained (`gained` > 0, measured by the caller from the inventory), whatever the status said; a hard failure
 * is a HARD_FAIL class with nothing gained. Anything else (nothing_found, inventory_full, budgets) is not recorded as
 * an outcome, only as a visit.
 */
export function recordGather (mem, { pos, family, result, gained = 0, now }) {
  const c = cellOf(pos)
  if (!mem || !c || !family) return null
  visit(mem, pos, now)
  const k = entryKey(c.cx, c.cz, family)
  const reason = gained > 0 ? null : hardFailReason(result)
  if (!(gained > 0) && !reason) return null
  const e = mem.entries.get(k) ?? { cx: c.cx, cz: c.cz, family, ok: 0, fail: 0, lastOk: 0, lastFail: 0, failTimes: [], reasons: {} }
  if (gained > 0) { e.ok++; e.lastOk = now } else {
    e.fail++; e.lastFail = now
    e.failTimes = [...e.failTimes, now].slice(-FAIL_TIMES_KEPT)
    e.reasons[reason] = (e.reasons[reason] ?? 0) + 1
  }
  touch(mem.entries, k, e, MAX_ENTRIES)
  return e
}

/** Hard failures in this entry inside the window AND after its last success. */
export function recentFails (e, now) {
  if (!e) return 0
  return e.failTimes.filter(t => t > now - REFUSE_WINDOW_MS && t > e.lastOk).length
}
/** A cell this bot should not gather `family` in right now. */
export function isRefusedCell (mem, cx, cz, family, now) {
  if (!refusable(family)) return false
  return recentFails(mem?.entries.get(entryKey(cx, cz, family)), now) >= REFUSE_FAILS
}

/**
 * Pure: refuse a gather of `family` at `pos`? Null, or { cell, fails, reason }. A trip out of this cell that already
 * failed inside the window ENDS THE CHAIN: the refusal stands down for that cell and the model has the bot back (a
 * refusal whose remedy just proved unexecutable from here is a dead end, CLAUDE.md).
 */
export function refusalFor (mem, pos, family, now) {
  const c = cellOf(pos)
  if (!mem || !c || !family) return null
  const e = mem.entries.get(entryKey(c.cx, c.cz, family))
  const fails = recentFails(e, now)
  if (fails < REFUSE_FAILS) return null
  const trip = mem.trips.get(entryKey(c.cx, c.cz, family))
  if (trip && trip.failedAt > now - REFUSE_WINDOW_MS) return null
  const reasons = Object.entries(e.reasons).sort((a, b) => b[1] - a[1]).map(([r]) => r)
  return { cell: cellKey(c.cx, c.cz), cx: c.cx, cz: c.cz, fails, reason: reasons[0] ?? 'unknown' }
}

/** The trip out of this cell failed (explore no_path): no refusal from that cell for the rest of the window. */
export function noteTripFailed (mem, cx, cz, family, now) {
  if (mem) touch(mem.trips, entryKey(cx, cz, family), { failedAt: now }, MAX_ENTRIES)
}

const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

/**
 * Pure: where to walk after a refusal. In order: the nearest cell where `family` succeeded for this bot with fewer
 * than REFUSE_FAILS hard failures since; else the nearest cell not visited in VISIT_FRESH_MS inside the frontier ring
 * (ties broken toward `bearing`); else `bearing` itself (the existing explore bearing), turned 90/-90/180 if its line
 * ends in or crosses a refused cell. Never a refused cell, never the current cell. A success column must be at least
 * FRONTIER_MIN away and no older than SUCCESS_FRESH_MS. Capped at TRIP_CAP. (Night is not a shorter trip; it is no
 * refusal at all -- exemptReason.)
 * Returns { x, z, cx, cz, source, dist, limit } or { none: why }.
 */
export function chooseTarget (mem, { pos, family, now, bearing = 0 }) {
  const here = cellOf(pos)
  if (!mem || !here || !family) return { none: 'no_position' }
  const cap = TRIP_CAP
  const refused = (cx, cz) => isRefusedCell(mem, cx, cz, family, now)
  const isHere = (cx, cz) => cx === here.cx && cz === here.cz
  const distTo = (cx, cz) => { const c = centre(cx, cz); return Math.hypot(c.x - pos.x, c.z - pos.z) }
  // `limit` travels with the target: explore enforces it on the BODY, fallback steps included.
  const point = (cx, cz, source) => { const c = centre(cx, cz); return { x: c.x, z: c.z, cx, cz, source, dist: distTo(cx, cz), limit: cap } }

  // 1. where it worked
  let best = null
  for (const e of mem.entries.values()) {
    if (e.family !== family || !(e.lastOk > 0) || isHere(e.cx, e.cz)) continue
    if (now - e.lastOk > SUCCESS_FRESH_MS) continue
    // NOT >= REFUSE_FAILS HARD FAILURES SINCE ITS LAST SUCCESS (any age): a forest that worked and then refused us
    // twice is not "where it worked". This subsumes the 30-min refusal for these cells.
    if (e.failTimes.filter(t => t > e.lastOk).length >= REFUSE_FAILS) continue
    const d = distTo(e.cx, e.cz)
    // NOT NEARER THAN THE FRONTIER RING: a column 16 blocks off is searched by the same 32-block gather.
    if (d < FRONTIER_MIN || d > cap) continue
    if (!best || d < best.d) best = { e, d }
  }
  if (best) return point(best.e.cx, best.e.cz, 'success')

  // 2. the frontier: not visited recently, inside the ring
  const hi = Math.min(FRONTIER_MAX, cap)
  const r = Math.ceil(hi / CELL) + 1
  let front = null
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      const cx = here.cx + dx, cz = here.cz + dz
      if (isHere(cx, cz) || refused(cx, cz)) continue
      const d = distTo(cx, cz)
      if (d < FRONTIER_MIN || d > hi) continue
      const seen = mem.visits.get(cellKey(cx, cz))
      if (seen != null && seen > now - VISIT_FRESH_MS) continue
      const c = centre(cx, cz)
      const off = angDiff(Math.atan2(c.z - pos.z, c.x - pos.x), bearing)
      if (!front || d < front.d - 1e-9 || (Math.abs(d - front.d) <= 1e-9 && off < front.off)) front = { cx, cz, d, off }
    }
  }
  if (front) return point(front.cx, front.cz, 'frontier')

  // 3. the existing explore bearing, never along a line that ends in or crosses a refused cell
  const len = Math.min(BEARING_WALK, cap)
  for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const a = bearing + turn
    let blocked = false
    for (let s = 8; s <= len; s += 8) {
      const c = cellOf({ x: pos.x + Math.cos(a) * s, z: pos.z + Math.sin(a) * s })
      if (!isHere(c.cx, c.cz) && refused(c.cx, c.cz)) { blocked = true; break }
    }
    const end = { x: pos.x + Math.cos(a) * len, z: pos.z + Math.sin(a) * len }
    const ec = cellOf(end)
    if (blocked || isHere(ec.cx, ec.cz) || refused(ec.cx, ec.cz)) continue
    return { x: Math.round(end.x), z: Math.round(end.z), cx: ec.cx, cz: ec.cz, source: 'bearing', dist: len, limit: cap }
  }
  return { none: 'every_bearing_refused' }
}
