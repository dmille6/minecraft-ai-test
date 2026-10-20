// PROTECTED ZONES (protectzone-01; docs/reports/protectzone-01-design-2026-10-20.md). Scenery the bots never change or use.
//
// WHY. OWNER DECISION 2026-10-20 ~15:30Z ("option 1"): the showcase world's naturally generated taiga village is kept as
// scenery -- no bot digs, takes apart, builds in, opens, sleeps in or crafts at anything in it. The fleet had no
// data-driven protection a world could declare: townzone-01 is a fixed square around home, structureguard-01 (not kept)
// reads only the monument's record. So one per-world FILE names boxes, and one guard enforces them.
//
// THE FILE: `<poolStateDir(MEMORY_POOL)>/protected-zones.json` (the town's own directory: one pool = one world). No file ->
// every zone off and EVERY wrapper below passes straight through (the bench has no file: behaviour identical).
//   { "version": 1, "world": "showcase", "hashed_seed": "<the login packet's hashedSeed>",
//     "zones": [ { "id": "village-taiga-6_1", "kind": "village", "label": "the taiga village",
//                  "box": [x0, y0, z0, x1, y1, z1] } ] }        // inclusive, integers
//   hashed_seed binds the file to ONE world: a file whose seed is not this bot's world's is ignored (and said so).
//
// WHAT IS GUARDED, and where (every path that can change or consume a block or a container goes through one of these):
//   CHOKEPOINT (attachProtectZone): bot.dig, bot._genericPlace (placeBlock, _placeBlockWithOptions and placeEntity all
//     call it), bot.activateBlock, bot.openBlock (openContainer/openChest/openFurnace call it), bot.sleep, bot.craft with a
//     table. A refused call returns a REJECTED PROMISE (every caller, the pathfinder's included, already handles one) whose
//     error names the zone and the remedy. The block's cell decides; for a placement, the cell the block would occupy.
//   ENUMERATION (the same attach): bot.findBlocks (bot.findBlock calls it) never returns a cell inside a zone, so gather's
//     candidates, the crafting-table / furnace / chest / bed finders, the prompt's and the survey's resource lists never
//     offer one -- the chokepoint is the backstop, not the planner.
//   PATHFINDER (zoneCost): exclusionAreasBreak and exclusionAreasPlace answer 100 in a zone (mineflayer-pathfinder 2.4.5:
//     safeToBreak needs < 100; a move costing > 100 is dropped), so no path digs or scaffolds there. Walking is untouched:
//     the village's paths stay walkable, and a bot inside a zone always has its open surface to walk out over.
//   MINE (zoneKeepOut, skills.mjs): one more part of minewell's composed keep-out: no stair through a zone, a walk-off to
//     just beyond its side (zoneExitColumns), a per-dig stop.
//
// SURVIVAL KEEPS PRIORITY (as townzone-01): a dig, placement or block use whose purpose is `survival` (digtown.mjs
// digPurpose: a reflex holding the body, or the reflex tick's scope) is never refused -- a drowning or entombed bot gets
// air first and the scenery absorbs that damage. Opening a container, sleeping and crafting are never survival.
import fs from 'node:fs'
import path from 'node:path'
import { digPurpose, currentDigScope } from './digtown.mjs'

export const ZONES_FILE = 'protected-zones.json'
export const ZONES_VERSION = 1
/** The file is re-read at most this often (an install or an edit is honoured without a restart). */
export const RELOAD_MS = 30_000
export const MAX_ZONES = 64
/** A box wider (or taller) than this is refused as a typo: one bad digit must not freeze a world. */
export const MAX_SPAN = 1024
/** How far beyond a zone's side a walk-out point sits. */
export const EXIT_PAD = 3
/** pathfinder: >= 100 is "never" for a break (safeToBreak) and a dropped move for a place. */
export const ZONE_COST = 100

const isInt = v => Number.isInteger(v)

/**
 * THE FILE -> { zones, why, bad }. Pure. `raw` is the parsed JSON (or null: no file). A zone is
 * { id, kind, label, x0, y0, z0, x1, y1, z1 } (inclusive integers, x0 <= x1 ...). An invalid zone is dropped and NAMED in
 * `bad` (the valid ones still protect); a file for another world (hashed_seed differs from `worldId`) protects nothing.
 * `worldId` unknown ('' / null): the file is honoured -- it sits in this pool's own directory.
 */
export function parseZones (raw, { worldId = null } = {}) {
  if (raw == null) return { zones: [], why: 'absent', bad: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { zones: [], why: 'not_an_object', bad: [] }
  if (raw.version !== ZONES_VERSION) return { zones: [], why: `bad_version:${raw.version}`, bad: [] }
  const seed = raw.hashed_seed
  if (seed != null && worldId != null && worldId !== '' && String(seed) !== String(worldId)) return { zones: [], why: 'world_mismatch', bad: [] }
  if (!Array.isArray(raw.zones)) return { zones: [], why: 'no_zones', bad: [] }
  const zones = [], bad = []
  for (const [i, z] of raw.zones.slice(0, MAX_ZONES).entries()) {
    const b = z?.box
    const id = typeof z?.id === 'string' && z.id ? z.id.slice(0, 64) : null
    if (!id || !Array.isArray(b) || b.length !== 6 || !b.every(isInt)) { bad.push(`${i}:shape`); continue }
    const [x0, y0, z0, x1, y1, z1] = b
    if (x0 > x1 || y0 > y1 || z0 > z1) { bad.push(`${id}:order`); continue }
    if (x1 - x0 > MAX_SPAN || y1 - y0 > MAX_SPAN || z1 - z0 > MAX_SPAN) { bad.push(`${id}:span`); continue }
    const kind = typeof z.kind === 'string' && /^[a-z_]{1,24}$/.test(z.kind) ? z.kind : 'scenery'
    const label = typeof z.label === 'string' && z.label ? z.label.slice(0, 60) : `the protected ${kind}`
    zones.push({ id, kind, label, x0, y0, z0, x1, y1, z1 })
  }
  if (raw.zones.length > MAX_ZONES) bad.push(`over_${MAX_ZONES}`)
  return { zones, why: zones.length ? 'ok' : 'empty', bad }
}

/** The zone holding the cell (integers by floor) -> zone | null. Pure, allocation-free (the A* hot path calls it). */
export function zoneAt (zones, x, y, z) {
  if (!zones || !zones.length) return null
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z)
  if (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fz)) return null
  for (let i = 0; i < zones.length; i++) {
    const q = zones[i]
    if (fx >= q.x0 && fx <= q.x1 && fy >= q.y0 && fy <= q.y1 && fz >= q.z0 && fz <= q.z1) return q
  }
  return null
}
export const zoneAtPos = (zones, p) => (p ? zoneAt(zones, p.x, p.y, p.z) : null)

/** Is the bot's column (any y) inside this zone's footprint, grown by `margin`? Pure. */
export function overFootprint (zone, p, margin = 0) {
  return !!zone && !!p && Math.floor(p.x) >= zone.x0 - margin && Math.floor(p.x) <= zone.x1 + margin &&
         Math.floor(p.z) >= zone.z0 - margin && Math.floor(p.z) <= zone.z1 + margin
}

/** Does any zone's box meet the sphere (point, r)? Pure (the findBlocks pass-through test: a search far away is untouched). */
export function zonesNear (zones, point, r) {
  if (!zones || !zones.length || !point) return false
  const R = Number.isFinite(r) ? r + 1 : Infinity
  return zones.some(q => point.x >= q.x0 - R && point.x <= q.x1 + 1 + R && point.y >= q.y0 - R && point.y <= q.y1 + 1 + R &&
                         point.z >= q.z0 - R && point.z <= q.z1 + 1 + R)
}

/**
 * THE WAY OUT -> { x, z, side } | null: the nearest point EXIT_PAD beyond the footprint's nearest side, at the bot's own
 * coordinate on the other axis. Pure. null when p is not over the footprint (then "outside" is where it already is).
 */
export function exitPoint (zone, p) {
  if (!overFootprint(zone, p)) return null
  const x = Math.floor(p.x), z = Math.floor(p.z)
  const opts = [
    { d: x - zone.x0, x: zone.x0 - EXIT_PAD, z, side: 'west' }, { d: zone.x1 - x, x: zone.x1 + EXIT_PAD, z, side: 'east' },
    { d: z - zone.z0, x, z: zone.z0 - EXIT_PAD, side: 'north' }, { d: zone.z1 - z, x, z: zone.z1 + EXIT_PAD, side: 'south' },
  ].sort((a, b) => a.d - b.d)
  const { d, ...o } = opts[0]
  return o
}

/** The refusal's words: what is protected, and a move the bot can make from where it stands. Pure. */
export function zoneRemedy (zone, op, at, from = null) {
  const where = at ? `${Math.floor(at.x)},${Math.floor(at.y)},${Math.floor(at.z)}` : '?'
  const box = `x ${zone.x0}..${zone.x1}, z ${zone.z0}..${zone.z1}`
  const ex = from ? exitPoint(zone, from) : null
  const fy = from && Number.isFinite(from.y) ? Math.floor(from.y) : null
  const go = ex ? `walk out first (goto ${ex.x} ${fy ?? '<y>'} ${ex.z}, ${EXIT_PAD} blocks past its ${ex.side} side) and ` : ''
  const what = op === 'open' ? 'open its containers' : op === 'sleep' ? 'sleep in its beds' : op === 'craft' ? 'use its crafting tables'
    : op === 'use' ? 'use its blocks' : op === 'place' ? 'build in it' : 'dig it'
  return `protected zone: ${zone.label} (${box}) is kept as scenery -- bots never ${what} (cell ${where}); ${go}` +
         `${op === 'open' ? 'use the town\'s chests' : op === 'sleep' ? 'sleep at home' : op === 'craft' ? 'craft at your own table' : 'take blocks or build anywhere outside it'}`
}

export class ProtectedZoneError extends Error {
  constructor (zone, op, at, remedy) {
    super(remedy)
    this.name = 'ProtectedZoneError'
    this.code = 'protected_zone'
    this.zone = zone?.id ?? null
    this.op = op
    this.at = at ? { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) } : null
  }
}

/** Ops a survival purpose may still perform inside a zone (a reflex's air, pillar or wall). Never open/sleep/craft. */
export const SURVIVAL_OPS = new Set(['dig', 'place', 'use'])

/**
 * THE GUARD'S ONE DECISION -> null (allowed) | { zone }. Pure. `op` in dig | place | use | open | sleep | craft; `cell` the
 * block's cell; `purpose` digPurpose's answer for this call.
 */
export function zoneDecision ({ zones, op, cell, purpose = null }) {
  const z = cell ? zoneAt(zones, cell.x, cell.y, cell.z) : null
  if (!z) return null
  if (purpose === 'survival' && SURVIVAL_OPS.has(op)) return null
  return { zone: z }
}

/**
 * THE PATHFINDER'S PRICE -> (block) => 0 | ZONE_COST, for exclusionAreasBreak AND exclusionAreasPlace. `zones()` returns
 * the live list (a cached array: no fs, no allocation in the A* step). Zones off -> always 0.
 */
export function zoneCost (zones) {
  return (block) => {
    const list = zones()
    if (!list || !list.length) return 0
    const p = block?.position
    return p && zoneAt(list, p.x, p.y, p.z) ? ZONE_COST : 0
  }
}

/**
 * A ZONE AS A KEEP-OUT PART for minewell's composeKeepOut -> { forbid(cell) -> 'protected' | null, bottom }. Pure over
 * the list: EVERY cell of a zone's box is forbidden (air too: a stair never runs through a zone, and never starts in one).
 */
export function zoneKeepOut (zones) {
  if (!zones || !zones.length) return { forbid: null, bottom: null }
  return { forbid: c => (c && zoneAt(zones, c.x, c.y, c.z) ? 'protected' : null), bottom: Math.min(...zones.map(q => q.y0)) }
}

/**
 * THE COLUMNS JUST BEYOND A ZONE a bot over it may start a stair from -> [{ x, z }], nearest first. Pure. For every zone
 * whose footprint (grown by `margin`) holds the bot: its exit point, then the ring EXIT_PAD outside the box every `step`
 * blocks (the planner judges each against every keep-out, so a well or a second zone beside one is passed over).
 */
export function zoneExitColumns (zones, from, { step = 6, margin = 3 } = {}) {
  if (!zones || !zones.length || !from) return []
  const fx = Math.floor(from.x), fz = Math.floor(from.z), out = [], seen = new Set()
  const add = c => { const k = `${c.x},${c.z}`; if (!seen.has(k)) { seen.add(k); out.push(c) } }
  for (const q of zones) {
    if (!overFootprint(q, from, margin)) continue
    const ex = exitPoint(q, { x: Math.min(Math.max(fx, q.x0), q.x1), z: Math.min(Math.max(fz, q.z0), q.z1) })
    if (ex) add({ x: ex.x, z: ex.z })
    const ring = []
    const X0 = q.x0 - EXIT_PAD, X1 = q.x1 + EXIT_PAD, Z0 = q.z0 - EXIT_PAD, Z1 = q.z1 + EXIT_PAD
    for (let x = X0; x <= X1; x += step) ring.push({ x, z: Z0 }, { x, z: Z1 })
    for (let z = Z0; z <= Z1; z += step) ring.push({ x: X0, z }, { x: X1, z })
    const d = c => Math.hypot(c.x - fx, c.z - fz)
    ring.sort((a, b) => d(a) - d(b) || a.x - b.x || a.z - b.z).forEach(add)
  }
  return out
}

/**
 * THE LIVE LIST for one bot -> { zones(), state() }. Reads `file()` at most every RELOAD_MS (by mtime; `now` and `fsx`
 * injectable). A read error is "absent" (the zones go off, and state() says why) -- never a throw into a caller.
 */
export function zoneReader ({ file, worldId = () => null, now = () => Date.now(), fsx = fs } = {}) {
  let at = -Infinity, mtime = null, list = [], st = { why: 'unread', bad: [], file: null, n: 0 }
  const load = () => {
    const t = now()
    if (t - at < RELOAD_MS) return
    at = t
    let f = null
    try { f = file() } catch { f = null }
    try {
      const s = f ? fsx.statSync(f) : null
      const m = s ? `${s.mtimeMs}:${s.size}:${worldId() ?? ''}` : null
      if (m === mtime) return
      mtime = m
      const raw = s ? JSON.parse(fsx.readFileSync(f, 'utf8')) : null
      const r = parseZones(raw, { worldId: worldId() })
      list = r.zones; st = { why: r.why, bad: r.bad, file: f, n: r.zones.length, ids: r.zones.map(z => z.id) }
    } catch (e) {
      const absent = e?.code === 'ENOENT'
      mtime = null; list = []; st = { why: absent ? 'absent' : `unreadable:${String(e?.message ?? e).slice(0, 60)}`, bad: [], file: f, n: 0 }
    }
  }
  return { zones: () => { load(); return list }, state: () => { load(); return st } }
}

/** The licence row's detail (`_protectzone_mode`, one per spawn). Pure. */
export function protectZoneModeDetail (st, worldId = null) {
  return `zones=${st?.n ?? 0} why=${st?.why ?? '?'}${st?.ids?.length ? ` ids=${st.ids.join(',')}` : ''}${st?.bad?.length ? ` bad=${st.bad.join(',')}` : ''} world=${worldId || 'unknown'}`
}

/** Per-bot counters for the `_protect_zone` liveness row (one a minute, only when something was refused or filtered). */
export function protectZoneCounters () {
  return { dig: 0, place: 0, use: 0, open: 0, sleep: 0, craft: 0, survival_allowed: 0, find_filtered: 0, mine_refused: 0, mine_walkout: 0, mine_step_refused: 0 }
}
export function noteProtectZone (bot, key, n = 1) {
  try { if (bot) { bot.protectZone ??= protectZoneCounters(); bot.protectZone[key] = (bot.protectZone[key] ?? 0) + n } } catch { /* telemetry */ }
}

const cellOf = b => (b?.position ? { x: Math.floor(b.position.x), y: Math.floor(b.position.y), z: Math.floor(b.position.z) } : null)

/**
 * INSTALL THE GUARD on one bot -> { stop } | null. `zones()` the live list; `context()` { skill, args, holder, reflex }
 * (as digtown reads it); `onRefuse({ op, zone, at, purpose, by, remedy })` telemetry. Installed AFTER attachDigTown so a
 * refused dig never reaches the instrument (it is not a dig). Every wrapper is a pass-through when no zone is loaded.
 */
export function attachProtectZone (bot, { zones, context = () => ({}), onRefuse = () => {} } = {}) {
  if (!bot || typeof zones !== 'function' || bot.__protectZone) return null
  bot.__protectZone = true
  const purposeOf = () => {
    let c = {}
    try { c = context() ?? {} } catch { c = {} }
    let mining = false, tag = null
    try { mining = !!bot.pathfinder?.isMining?.(); tag = bot.pathfinder?.movements?.digPurpose ?? null } catch { /* fine */ }
    return digPurpose({ scope: currentDigScope(), pathfinderMining: mining, movementsPurpose: tag, ...c })
  }
  const refuse = (op, zone, at) => {
    const { purpose, by } = purposeOf()
    const from = bot.entity?.position ?? null
    const remedy = zoneRemedy(zone, op, at, from)
    noteProtectZone(bot, op)
    try { onRefuse({ op, zone: zone.id, at, purpose, by, remedy }) } catch { /* telemetry */ }
    return Promise.reject(new ProtectedZoneError(zone, op, at, remedy))
  }
  /** -> a rejected promise, or null to proceed. */
  const gate = (op, cell) => {
    const list = zones()
    if (!list || !list.length || !cell) return null
    const z = zoneAt(list, cell.x, cell.y, cell.z)
    if (!z) return null
    const purpose = SURVIVAL_OPS.has(op) ? purposeOf().purpose : null
    if (!zoneDecision({ zones: list, op, cell, purpose })) { noteProtectZone(bot, 'survival_allowed'); return null }
    return refuse(op, z, cell)
  }
  const wrap = (name, op, cellFor) => {
    const orig = bot[name]
    if (typeof orig !== 'function') return
    const w = function (...a) {
      let cell = null
      try { cell = cellFor(...a) } catch { cell = null }
      return gate(op, cell) ?? orig.apply(this, a)
    }
    w.__protectZone = orig
    bot[name] = w
  }
  wrap('dig', 'dig', b => cellOf(b))
  // the cell the block would occupy: reference + face (mineflayer's own `dest`)
  wrap('_genericPlace', 'place', (ref, face) => (ref?.position && face ? cellOf({ position: { x: ref.position.x + face.x, y: ref.position.y + face.y, z: ref.position.z + face.z } }) : null))
  wrap('activateBlock', 'use', b => cellOf(b))
  wrap('openBlock', 'open', b => cellOf(b))
  wrap('sleep', 'sleep', b => cellOf(b))
  wrap('craft', 'craft', (_r, _n, table) => cellOf(table))
  // THE ENUMERATION: findBlocks never answers a zone cell. mineflayer calls `matching` twice per candidate: with a
  // position-less palette Block (the section pre-check: passed through), then with bot.blockAt(point) -- that call is
  // judged. A search whose sphere meets no zone is handed through untouched.
  const find = bot.findBlocks
  if (typeof find === 'function') {
    const w = function (options = {}) {
      const list = zones()
      if (!list || !list.length) return find.call(this, options)
      const point = options.point ?? bot.entity?.position
      if (!zonesNear(list, point, options.maxDistance ?? 16)) return find.call(this, options)
      const m = options.matching
      const inner = typeof m === 'function' ? m : (() => { const ids = Array.isArray(m) ? m : [m]; return b => (b == null ? false : ids.indexOf(b.type) >= 0) })()
      let filtered = 0
      const matching = b => {
        if (!inner(b)) return false
        const p = b?.position
        if (p && zoneAt(list, p.x, p.y, p.z)) { filtered++; return false }
        return true
      }
      const out = find.call(this, { ...options, matching })
      if (filtered) noteProtectZone(bot, 'find_filtered', filtered)
      return out
    }
    w.__protectZone = find
    bot.findBlocks = w
  }
  return { stop: () => {} }
}

/** The file's path for this bot's town (the pool's own directory). */
export const zonesFileIn = dir => path.join(dir, ZONES_FILE)
