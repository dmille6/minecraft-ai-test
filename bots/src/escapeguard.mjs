// ESCAPEGUARD-01: A TRAPPED BOT'S ESCAPE DOES NOT DIG THROUGH A PROTECTED STRUCTURE OR A BUILD RECORD (tier 3).
//
// WHY. OWNER DECISION 2026-10-31 ~13:35Z (option B). showcase-Frost, entombed at 47,18,66 (02:24:50Z), dug three cells of the
// trial chambers (zone trial-chambers-home-se): pillar_out's headroom dig took 47,20,66 oak_planks, then the flood branch's
// sidestep took 47,19,67 oak_fence and 47,20,67 oak_planks. The tripwire's S4 BREACH stopped the showcase for 11 h. On 10-30 a
// walled-in escape dug two ziggurat foundation cobblestone (record cells). Both went through for one reason: protectzone.mjs
// lets every SURVIVAL dig through (zoneDecision: "the scenery absorbs that damage"), and no dig guard reads the build records
// for a survival dig at all. `_protect_zone` counted it: survival_allowed=6 in that minute.
//
// THE RULE, for a dig whose purpose is `survival` (digtown.mjs digPurpose: a reflex holding the body, or the reflex tick):
//   GUARDED cells   a build-record cell (a project record's placed or planned cell -- workshop, house, ziggurat, paths, wall,
//                   town stair -- except its `air` cells, the town plan's placed and reserved furniture, the tree farm's
//                   columns near ground level), or a protected-zone cell (protectzone.mjs blocked: its deep exemption kept)
//                   holding a block that is NOT ordinary terrain. A record that cannot be read is UNKNOWN, and unknown is
//                   guarded near home (RECORD_RADIUS) -- the records are a town's, so nothing far away can be one.
//   ORDINARY rock   inside a zone, stone, deepslate, tuff, dirt, gravel, ores and the like are never part of a structure (the
//                   tripwire's own structure palette has none of them): a survival dig of one is allowed. That is the "dig
//                   up/down through ordinary blocks" remedy, and it is what lets a bot inside a big zone (the trial chambers
//                   box is 108 x 96 x 100) cut its way out without touching the chambers.
//   THE ORDER       the planners ask first (bot.escapeGuard.mayBreak): the escape ramp, its sidestep and breach, the pool
//                   escape, the head-wall breach and both scaffold harvests pass over a guarded cell and try ANOTHER
//                   bearing; the pillar refuses a guarded ceiling as `guarded` and the entombed and marooned arms send that
//                   to the ramp (guardBranch in reflex.mjs) -- never to the pickaxe ask, which no pickaxe would answer. The
//                   dig wrapper below is the backstop for every other survival dig.
//   AIR FIRST       a bot with its head in a solid block (suffocating), or with its head under water and AIR_GUARD_SECONDS
//                   or less of air left, may dig any cell: the structure absorbs that damage (owner: never drown or
//                   suffocate it).
//   NEVER FOREVER   every guarded refusal starts (or feeds) a WAIT clock at that place: the bot holds still, the reflex
//                   backs off, the walk out stays open to it, and a `needs_rescue` row calls for help. If it is still
//                   refused within MOVE_RESET blocks of the same place after WAIT_MS, the LAST RESORT opens for GRANT_MS:
//                   guarded survival digs are allowed again (as before this change), each one logged. Moving away, or
//                   QUIET_MS without a refusal, ends the wait. So the guard can delay an escape by at most WAIT_MS, and it
//                   never takes away the escape that existed before it.
// ESCAPEGUARD=off is the kill switch: every answer here is "allow", exactly the base's behaviour.
import { blocked } from './protectzone.mjs'
import { digPurpose, currentDigScope } from './digtown.mjs'

export const ESCAPE_GUARD_WAIT_MS = 10 * 60_000     // under the tripwire's Z1 (a bot still inside a zone 15 min trips it)
export const ESCAPE_GUARD_GRANT_MS = 90_000         // the last resort's window, then the clock starts again
export const ESCAPE_GUARD_HELP_MS = 2 * 60_000      // still refused here this long: one `needs_rescue` row calls for help
export const ESCAPE_GUARD_MOVE_RESET = 4            // blocks from the place the wait began: farther is somewhere else
export const ESCAPE_GUARD_QUIET_MS = 3 * 60_000     // no guarded refusal this long: the bot is no longer trying to dig out here
/** The entombed / marooned arms' back-off after a guarded refusal never exceeds this (under QUIET_MS: the wait keeps running). */
export const GUARD_BACKOFF_CAP_MS = ESCAPE_GUARD_QUIET_MS - 60_000
export const AIR_GUARD_SECONDS = 8                  // of 15 (air.mjs MAX_AIR_SECONDS): head under with this little left is an emergency
export const RECORD_RADIUS = 160                    // an unreadable record is unknown within this of home; beyond, no record reaches
export const TREEFARM_BAND = [-4, 24]               // a tree-farm column is guarded from home.y - 4 to home.y + 24 (its trees)
/** A row per (cell, why) at most this often per bot (the refusal rows; the counts ride in `_escape_guard` each minute). */
export const ROW_EVERY_MS = 60_000

/** The kill switch. ESCAPEGUARD=off (or 0/false) -> off. Default on. */
export const escapeGuardOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.ESCAPEGUARD ?? 'on').trim())

/**
 * ORDINARY TERRAIN -- never a structure's block. Every name here is absent from the showcase tripwire's structure palette
 * (infra trip structcount.py BUILT + showcase_trip.py TRIAL_RX: tuff_bricks/polished/chiseled tuff are, plain tuff is not).
 * Conservative: what is not listed (cobblestone, mossy cobblestone, planks, logs, bricks, terracotta, glass ...) is treated as
 * a structure's.
 */
export const ORDINARY = /^(stone|deepslate|granite|diorite|andesite|tuff|calcite|dripstone_block|smooth_basalt|basalt|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|clay|gravel|sand|red_sand|sandstone|red_sandstone|snow_block|snow|ice|packed_ice|moss_block|netherrack|soul_sand|soul_soil|end_stone|(deepslate_)?(coal|iron|copper|gold|redstone|lapis|diamond|emerald)_ore|nether_(gold|quartz)_ore)$/
export const isOrdinary = name => typeof name === 'string' && ORDINARY.test(name.replace(/^minecraft:/, ''))

const finite3 = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
const cellOf = p => (finite3(p) ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : null)

/**
 * WHAT A SURVIVAL DIG OF THIS CELL WOULD BREAK -> null (nothing guarded) | { kind: 'record', what } | { kind: 'unknown' } |
 * { kind: 'zone', zone, ordinary }. Pure.
 *   recordAt(cell) -> a record's name | false (no record holds it) | null (a record could not be read)
 *   zones          protectzone.mjs's live list; feet the bot's position (the zone's deep exemption)
 *   home           { x, y, z } | null: where an unknown record matters
 */
export function guardOf ({ cell, name = null, zones = [], feet = null, recordAt = null, home = null } = {}) {
  const c = cellOf(cell)
  if (!c) return null
  let rec = false
  if (typeof recordAt === 'function') { try { rec = recordAt(c) } catch { rec = null } }
  if (typeof rec === 'string' && rec) return { kind: 'record', what: rec }
  if (rec === null || rec === undefined) {
    // UNREADABLE RECORDS ARE UNKNOWN, AND UNKNOWN IS GUARDED -- where a record could be (lidplank-01's rule, bounded: an
    // unreadable town file must not freeze every escape in the world)
    const near = !home || !finite3(home) || Math.hypot(c.x - home.x, c.z - home.z) <= RECORD_RADIUS
    if (near) return { kind: 'unknown' }
  }
  let z = null
  try { z = zones?.length ? blocked(zones, c.x, c.y, c.z, feet) : null } catch { z = null }
  if (z) return { kind: 'zone', zone: z.id ?? '?', ordinary: isOrdinary(name) }
  return null
}

/**
 * THE GUARD'S ONE DECISION -> { allow, why }. Pure.
 *   why on allow:  off | not_survival | unguarded | ordinary | air | last_resort
 *   why on refuse: record | unknown | zone
 */
export function escapeDigDecision ({ on = true, purpose = 'survival', guard = null, air = false, lastResort = false } = {}) {
  if (!on) return { allow: true, why: 'off' }
  if (purpose !== 'survival') return { allow: true, why: 'not_survival' }
  if (!guard) return { allow: true, why: 'unguarded' }
  if (guard.kind === 'zone' && guard.ordinary) return { allow: true, why: 'ordinary' }
  if (air) return { allow: true, why: 'air' }
  if (lastResort) return { allow: true, why: 'last_resort' }
  return { allow: false, why: guard.kind }
}

/**
 * IS THE BOT OUT OF AIR? -> true when its head cell is a solid block (suffocating), or its head is under water with
 * AIR_GUARD_SECONDS or less of air (airstate.mjs publishes bot.airRescue; a stale or absent reading falls back to the
 * server's oxygen: 20 = 15 s). Pure over the readings.
 */
export function outOfAir ({ headSolid = false, headUnder = false, airSeconds = null, oxygen = null } = {}) {
  if (headSolid) return true
  if (!headUnder) return false
  if (Number.isFinite(airSeconds)) return airSeconds <= AIR_GUARD_SECONDS
  if (Number.isFinite(oxygen)) return oxygen * 15 / 20 <= AIR_GUARD_SECONDS
  return false
}

/** A fresh wait clock. */
export const waitClock = () => ({ since: null, anchor: null, last: null, grantUntil: null, helped: false, episodes: 0 })

/**
 * THE WAIT, ADVANCED -> { st, lastResort, began, help, granted, ended }. Pure (returns a new state).
 *   refused   this call is a guarded refusal (a planner's pass-over or the wrapper's refusal) -- it starts or feeds the wait
 *   pos       the bot's position now
 * began: the wait started now; help: it has run HELP_MS (once per wait: call for help); granted: the last resort opened now;
 * ended: a wait or grant ended now.
 */
export function waitStep (st0, { now = Date.now(), pos = null, refused = false,
  waitMs = ESCAPE_GUARD_WAIT_MS, grantMs = ESCAPE_GUARD_GRANT_MS, moveReset = ESCAPE_GUARD_MOVE_RESET, quietMs = ESCAPE_GUARD_QUIET_MS,
  helpMs = ESCAPE_GUARD_HELP_MS } = {}) {
  let st = { ...waitClock(), ...(st0 ?? {}) }
  let began = false, granted = false, ended = false, help = false
  const far = st.anchor && finite3(pos) ? Math.hypot(pos.x - st.anchor.x, pos.y - st.anchor.y, pos.z - st.anchor.z) > moveReset : false
  // THE GRANT ENDS ON ITS CLOCK OR WHEN THE BOT LEAVES -- never on quiet (a granted bot digs, it does not refuse)
  if (st.grantUntil != null) {
    if (now < st.grantUntil && !far) return { st, lastResort: true, began, help, granted, ended }
    st = { ...waitClock(), episodes: st.episodes }
    ended = true
  }
  if (st.since != null && (far || (st.last != null && now - st.last > quietMs))) { st = { ...waitClock(), episodes: st.episodes }; ended = true }
  if (refused) {
    if (st.since == null) { st = { ...st, since: now, anchor: finite3(pos) ? { x: pos.x, y: pos.y, z: pos.z } : null, episodes: st.episodes + 1 }; began = true }
    st = { ...st, last: now }
  }
  if (st.since != null && !st.helped && now - st.since >= helpMs) { st = { ...st, helped: true }; help = true }
  if (st.since != null && now - st.since >= waitMs) {
    st = { ...st, grantUntil: now + grantMs }
    granted = true
    return { st, lastResort: true, began, help, granted, ended }
  }
  return { st, lastResort: false, began, help, granted, ended }
}

/** How long until the last resort opens -> ms (0 when open, null when no wait runs). Pure. */
export function waitLeftMs (st, now = Date.now(), waitMs = ESCAPE_GUARD_WAIT_MS) {
  if (!st) return null
  if (st.grantUntil != null && now < st.grantUntil) return 0
  if (st.since == null) return null
  return Math.max(0, st.since + waitMs - now)
}

/** The refusal's words: what is guarded and what the bot does instead, from where it is. Pure. */
export function guardRemedy (g, cell, { leftMs = null } = {}) {
  const at = cell ? `${cell.x},${cell.y},${cell.z}` : '?'
  const what = g?.kind === 'record' ? `a build-record cell (${g.what})` : g?.kind === 'unknown' ? 'a cell of a build record that could not be read'
    : g?.kind === 'zone' ? `a structure block of the protected zone ${g.zone}` : 'a guarded cell'
  const wait = leftMs == null ? '' : leftMs > 0 ? `; if every way out stays guarded, the last resort opens in ${Math.ceil(leftMs / 60_000)} min` : '; the last resort is open'
  return `escape guard: ${at} is ${what} -- the escape tries another bearing, or ordinary rock, or walks out; the bot holds a dry cell and waits${wait}`
}

export class EscapeGuardError extends Error {
  constructor (g, cell, remedy) {
    super(remedy)
    this.name = 'EscapeGuardError'
    this.code = 'escape_guard'
    this.guard = g?.kind ?? null
    this.at = cell ?? null
  }
}

/** The licence row's detail (`_escape_guard_mode`, once per spawn). Pure. */
export function escapeGuardModeDetail (env = process.env) {
  return `phase=mode escapeguard=${escapeGuardOn(env) ? 'on' : 'off'} wait_min=${ESCAPE_GUARD_WAIT_MS / 60_000} grant_s=${ESCAPE_GUARD_GRANT_MS / 1000} ` +
         `move_reset=${ESCAPE_GUARD_MOVE_RESET} quiet_min=${ESCAPE_GUARD_QUIET_MS / 60_000} air_s=${AIR_GUARD_SECONDS} record_radius=${RECORD_RADIUS}`
}

export const escapeGuardCounters = () => ({ refused: 0, passed_over: 0, ordinary: 0, air: 0, last_resort: 0, waits: 0, grants: 0 })

/**
 * INSTALL THE GUARD on one bot -> the guard object (also bot.escapeGuard) | null.
 *   zones()       protectzone's live list (bot.protectZones)
 *   recordAt(c)   the build records' answer for a cell (skills.mjs escapeRecordAt)
 *   home          { x, y, z } | null
 *   context()     { skill, args, holder, reflex } as digtown reads it
 *   onRow({ kind, status, detail, args })  telemetry (an escape_guard / needs_rescue row)
 * Installed AFTER attachProtectZone, so a refused dig never reaches it, the keep-out guard or the `_dig_town` instrument.
 */
export function attachEscapeGuard (bot, { zones = () => [], recordAt = () => false, home = null, context = () => ({}), onRow = () => {},
  env = process.env, now = () => Date.now() } = {}) {
  if (!bot || typeof bot.dig !== 'function' || bot.dig.__escapeGuard) return null
  const on = () => escapeGuardOn(env)
  let clock = waitClock()
  const counts = escapeGuardCounters()
  const said = new Map()
  const purposeOf = () => {
    let c = {}
    try { c = context() ?? {} } catch { c = {} }
    if (c && c.reflex === 'eat') c = { ...c, reflex: null }   // eating holds no body (protectzone.mjs, Claude r1 P3)
    let mining = false, tag = null
    try { mining = !!bot.pathfinder?.isMining?.(); tag = bot.pathfinder?.movements?.digPurpose ?? null } catch { /* fine */ }
    return digPurpose({ scope: currentDigScope(), pathfinderMining: mining, movementsPurpose: tag, ...c })
  }
  const air = () => {
    try {
      const p = bot.entity?.position
      if (!p) return false
      const head = bot.blockAt?.(p.offset(0, 1, 0))
      const headSolid = !!head && head.boundingBox === 'block'
      const r = bot.airRescue
      const fresh = r && Number.isFinite(r.at) && now() - r.at <= 1500
      const headUnder = fresh ? !!r.headUnder : !!head && /^(water|bubble_column)$/.test(head.name ?? '')
      return outOfAir({ headSolid, headUnder, airSeconds: fresh ? r.airSeconds : null, oxygen: Number.isFinite(bot.oxygenLevel) ? bot.oxygenLevel : null })
    } catch { return false }
  }
  const row = (kind, status, detail, args, key = null) => {
    if (key) { const t = now(); if (t - (said.get(key) ?? -Infinity) < ROW_EVERY_MS) return; said.set(key, t); if (said.size > 256) said.clear() }
    try { onRow({ kind, status, detail: String(detail).slice(0, 300), args }) } catch { /* telemetry */ }
  }
  const pos = () => { const p = bot.entity?.position; return finite3(p) ? { x: p.x, y: p.y, z: p.z } : null }
  const tick = (refused, g, cell) => {
    const r = waitStep(clock, { now: now(), pos: pos(), refused })
    clock = r.st
    const at = cellOf(pos())
    if (r.began) counts.waits++
    if (r.help) {
      row('needs_rescue', 'failed', `arm=escape_guard at=${at ? `${at.x},${at.y},${at.z}` : '?'} block=${cell ? `${cell.x},${cell.y},${cell.z}` : '?'} guard=${g?.kind ?? '?'}${g?.zone ? ` zone=${g.zone}` : ''}${g?.what ? ` record=${g.what}` : ''} -- every escape dig here has crossed a guarded cell for ${ESCAPE_GUARD_HELP_MS / 60_000} min; holding a dry cell, the walk out stays open, last resort in ${Math.round((waitLeftMs(clock, now()) ?? 0) / 60_000)} min`,
          { arm: 'escape_guard', guard: g?.kind ?? null, episode: clock.episodes })
    }
    if (r.granted) {
      counts.grants++
      row('escape_guard', 'failed', `phase=last_resort_open at=${at ? `${at.x},${at.y},${at.z}` : '?'} waited_min=${ESCAPE_GUARD_WAIT_MS / 60_000} grant_s=${ESCAPE_GUARD_GRANT_MS / 1000} -- still refused at the same place: guarded survival digs are allowed for the window (the escape the bot had before the guard)`,
          { phase: 'last_resort_open', episode: clock.episodes })
    }
    return r.lastResort
  }
  /** The decision for one block -> { allow, why, guard, cell }. `refusing` true: a refusal feeds the wait clock. */
  const judge = (block, { purpose = null, refusing = true } = {}) => {
    const cell = cellOf(block?.position)
    if (!on() || !cell) return { allow: true, why: on() ? 'unguarded' : 'off', guard: null, cell }
    const p = purpose ?? purposeOf().purpose
    if (p !== 'survival') return { allow: true, why: 'not_survival', guard: null, cell }
    let list = []
    try { list = zones() ?? [] } catch { list = [] }
    const g = guardOf({ cell, name: block?.name ?? null, zones: list, feet: bot.entity?.position ?? null, recordAt, home })
    if (!g) { tick(false); return { allow: true, why: 'unguarded', guard: null, cell } }
    const pre = escapeDigDecision({ on: true, purpose: 'survival', guard: g, air: air(), lastResort: false })
    if (pre.allow) return { ...pre, guard: g, cell }
    const last = tick(refusing, g, cell)
    return { ...escapeDigDecision({ on: true, purpose: 'survival', guard: g, air: false, lastResort: last }), guard: g, cell }
  }
  const guard = {
    /** May an escape planner break this block? false: pass it over and try another bearing. Always survival. */
    mayBreak (block) {
      const d = judge(block, { purpose: 'survival' })
      if (!d.allow) counts.passed_over++
      return d.allow
    },
    /** The refusal reason for a block (null when allowed): the planners' words. */
    why (block) {
      const d = judge(block, { purpose: 'survival', refusing: false })
      return d.allow ? null : guardRemedy(d.guard, d.cell, { leftMs: waitLeftMs(clock, now()) })
    },
    state: () => ({ ...clock, left_ms: waitLeftMs(clock, now()) }),
    counts: () => ({ ...counts }),
    take: () => { const c = { ...counts }; for (const k of Object.keys(counts)) counts[k] = 0; return c },
  }
  const inner = bot.dig
  const w = function (block, ...rest) {
    let d
    try { d = judge(block) } catch { d = { allow: true, why: 'error' } }
    if (!d.allow) {
      counts.refused++
      const remedy = guardRemedy(d.guard, d.cell, { leftMs: waitLeftMs(clock, now()) })
      row('escape_guard', 'refused', `phase=refused why=${d.why} cell=${d.cell ? `${d.cell.x},${d.cell.y},${d.cell.z}` : '?'} block=${block?.name ?? '?'}${d.guard?.zone ? ` zone=${d.guard.zone}` : ''}${d.guard?.what ? ` record=${d.guard.what}` : ''} | ${remedy}`,
          { phase: 'refused', why: d.why, at: d.cell, block: block?.name ?? null }, `r:${d.cell?.x},${d.cell?.y},${d.cell?.z}`)
      const p = Promise.reject(new EscapeGuardError(d.guard, d.cell, remedy))
      p.catch(() => {})
      return p
    }
    if (d.guard && (d.why === 'air' || d.why === 'last_resort' || d.why === 'ordinary')) {
      counts[d.why]++
      if (d.why !== 'ordinary') {
        row('escape_guard', 'success', `phase=${d.why} cell=${d.cell.x},${d.cell.y},${d.cell.z} block=${block?.name ?? '?'} guard=${d.guard.kind}${d.guard.zone ? ` zone=${d.guard.zone}` : ''}${d.guard.what ? ` record=${d.guard.what}` : ''} -- ${d.why === 'air' ? 'out of air: the dig goes ahead' : 'the last resort: the dig goes ahead'}`,
            { phase: d.why, at: d.cell, block: block?.name ?? null, guard: d.guard.kind })
      }
    }
    return inner.call(this, block, ...rest)
  }
  w.__escapeGuard = inner
  bot.dig = w
  bot.escapeGuard = guard
  return guard
}

/** A planner's question, safe on a bot without the guard (tests, the bench): true = may break. */
export const guardMay = (bot, block) => { try { return bot?.escapeGuard ? bot.escapeGuard.mayBreak(block) !== false : true } catch { return true } }
