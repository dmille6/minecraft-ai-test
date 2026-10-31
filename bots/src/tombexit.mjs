// TOMBEXIT-01 (F2 of docs/reports/mineshaft-safety-2026-10-23.md; OWNER 2026-10-23 O3 "yes", order lavastep -> tombexit).
// PURE: no bot, no clock -- reflex.mjs reads the world and calls these. Two parts, one switch (TOMBEXIT=0 restores the base).
//
// WHY (measured 7 d to 10-31 17:00Z, ES, 80 bots, 168 h, 211 deaths):
//   * 42 suffocation deaths. 37 of the 42 had an `_entombed` firing in the 300 s before death, 39 of 42 a pillar_out
//     scaffold pick (the entombed / marooned escape's climb), 23 a dig_straight_up, 17 picked up sand or gravel the escape
//     dug. The positive control: 300 random (bot, time) points in the same window -- all 300 with rows -- had an
//     `_entombed` in the prior 300 s 112 times (37%) and a pillar_out 126 times (42%). Fire (16 of 42 = 38%) and drowning
//     (21 of 57 = 37%) sit at that base rate; suffocation (88%) does not.
//   * The death itself comes LATER: the last full-health row is 58-128 s before death (median ~85 s), the escape's last
//     row about as old, then the bot is idle while its health falls about 0.3 HP/s to 0. `_reflex_low_health` fires ~22 s
//     before death and only interrupts a skill. Nothing watches a body inside a block (assessAir needs oxygen to drain,
//     and in-wall damage does not drain it; `unburySelf` runs only inside the escape ramp and only for FALLING blocks).
//
// PART 1 -- THE DECLINE (F2 as designed). `isEntombed` misfires on ordinary dug geometry (a tunnel's dead end, a 2-high
// stair tread, an alcove: probe-entombed.mjs), and each firing pillars or digs up -- the climbs that precede every
// suffocation above. The arm now fires only if the bot cannot WALK back to a cell where it was recently free:
//   freeRing    ground cells the bot stood on in the last RING_MS where isEntombed was false (its own sampler)
//   walkBack    a breadth-first search of at most MAX_NODES over the walk profile's own moves (same level; step up 1 with
//               headroom; drop <= DROP_MAX onto solid ground; no dig, no place; every cell known; no DANGER, no liquid in
//               the body) that reaches a ring cell >= MIN_FREE_DIST from the feet AND hits its node cap (an OPEN component).
//               A component that exhausts under the cap is closed (a sealed pocket or a sealed short tunnel): no decline.
//   boundDecide at most BOUND_N declines in BOUND_MS within BOUND_R of the area's first decline; the next firing there
//               runs today's arm. A large sealed cave (open past the cap, free cells inside) is delayed ~30 s, never stranded.
// A decline is not a refusal: it is "not entombed" -- the bot keeps its skill and its next decision, with the walk on record.
//
// PART 2 -- THE IN-WALL DIG (new; F3's investigation had no instrument, so this is one, plus the remedy the bot can
// perform from where it is). When the EYE cell holds a full-cube suffocating block AND health is falling, dig that cell
// now (refilled by a falling block -> dig again, bounded). When health is falling with nothing visible to explain it and
// the eye cell reads open, write `_inwall_unseen` (the ghost-block question: does the client see the block that is
// killing it?) -- an instrument only, no action.
import { LAVA_LIKE } from './lavaguard.mjs'

export const RING_MS = 120_000          // a free cell older than this is forgotten
export const RING_MAX = 64              // cells kept (newest win)
export const MAX_NODES = 64             // the walk search's cap; reaching it means the component is OPEN
export const MIN_FREE_DIST = 3          // a free cell nearer than this is "the same place"
export const DROP_MAX = 3               // the walk profile's longest drop
export const BOUND_N = 2                // declines per area per BOUND_MS
export const BOUND_MS = 10 * 60_000
export const BOUND_R = 8                // blocks from the area's first decline
export const JUMP_CLEAR = 6             // a body that moved farther than this between two samples was moved (death,
                                        // respawn, relocation, a long fall): the ring starts again

export const INWALL_DROP_HP = 0.4       // health lost over the trend window that counts as "falling"
export const INWALL_TREND_MS = 3000     // the trend window
export const INWALL_MAX_DIGS = 4        // digs per episode (a refilling column of sand / gravel)
export const INWALL_RETRY_MS = 2000     // after an episode, the next one may start this soon
export const INWALL_UNSEEN_ROW_MS = 60_000

/** TOMBEXIT=0 (or off/false/no) restores the base exactly: no decline, no in-wall dig, no sampler. Default on. */
export const tombexitOn = (env = typeof process !== 'undefined' ? process.env : {}) =>
  !/^(0|off|false|no)$/i.test(String(env?.TOMBEXIT ?? '1').trim())
/** TOMBEXIT_INWALL=0 turns off part 2 alone (the decline stays). */
export const inwallOn = (env = typeof process !== 'undefined' ? process.env : {}) =>
  tombexitOn(env) && !/^(0|off|false|no)$/i.test(String(env?.TOMBEXIT_INWALL ?? '1').trim())

export function tombexitModeDetail (env = typeof process !== 'undefined' ? process.env : {}) {
  return `on=${tombexitOn(env) ? 1 : 0} inwall=${inwallOn(env) ? 1 : 0} ring_ms=${RING_MS} nodes=${MAX_NODES} ` +
         `min_free=${MIN_FREE_DIST} drop=${DROP_MAX} bound=${BOUND_N}/${BOUND_MS / 60_000}min/${BOUND_R}b ` +
         `inwall_drop=${INWALL_DROP_HP}/${INWALL_TREND_MS}ms digs=${INWALL_MAX_DIGS}`
}

const LIQUID = new Set(['water', 'flowing_water', 'bubble_column', 'lava', 'flowing_lava'])
const isDanger = b => !!b && LAVA_LIKE.has(b.name)
/** A body may stand in it: geometry empty, not liquid, not DANGER, not a cobweb. null (unknown) is NOT open. */
export const bodyOpen = b => !!b && (b.boundingBox === 'empty' || b.name === 'air' || b.name === 'cave_air') &&
  !LIQUID.has(b.name) && !isDanger(b) && b.name !== 'cobweb' && b.name !== 'powder_snow'
/** A body may stand ON it: solid, not DANGER. null is unknown, never a floor. */
export const floorOk = b => !!b && b.boundingBox === 'block' && !isDanger(b)

const key = (x, y, z) => `${x},${y},${z}`
const cellOf = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) })
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const cellStr = c => `${c.x},${c.y},${c.z}`

/**
 * THE FREE-CELL RING. note() a cell the bot stood on, on the ground, where isEntombed was FALSE. A declined firing never
 * adds a cell (the caller notes only while the predicate is false). `fresh(now)` is the cells young enough to count.
 */
export function makeFreeRing ({ ringMs = RING_MS, max = RING_MAX } = {}) {
  const cells = new Map()          // key -> { x, y, z, t, inputs }
  let last = null                  // the last sample's position (any verdict), for the jump clear
  return {
    note (cell, t, inputs = null) {
      const c = cellOf(cell); const k = key(c.x, c.y, c.z)
      cells.delete(k); cells.set(k, { ...c, t, inputs })
      while (cells.size > max) cells.delete(cells.keys().next().value)
    },
    /** Every sample, entombed or not: a body that jumped farther than JUMP_CLEAR was moved -> forget the ring. */
    touch (pos) {
      const c = { x: pos.x, y: pos.y, z: pos.z }
      const moved = !!last && dist(last, c) > JUMP_CLEAR
      if (moved) cells.clear()
      last = c
      return moved
    },
    clear () { cells.clear(); last = null },
    fresh (now) {
      const out = []
      for (const [k, v] of cells) { if (now - v.t <= ringMs) out.push(v); else cells.delete(k) }
      return out
    },
    get size () { return cells.size },
  }
}

const CARD = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/**
 * THE WALK PROFILE'S MOVES from a stand cell (feet at c, floor at c.y-1). -> [{ x, y, z, move }]. `at` returns a block
 * ({ name, boundingBox }) or null for an unknown cell; unknown is never stepped into, onto or under.
 *   walk   same level: feet + head open, floor ok
 *   up     step up 1: the cell over the head open (headroom for the jump), the target's feet + head open, its floor ok
 *   drop   1..DROP_MAX down: the neighbour column open from head height to the landing feet, landing floor ok
 */
export function walkMoves (at, c) {
  const out = []
  for (const [dx, dz] of CARD) {
    const x = c.x + dx, z = c.z + dz
    const feet = at(x, c.y, z), head = at(x, c.y + 1, z)
    if (bodyOpen(feet) && bodyOpen(head)) {
      const floor = at(x, c.y - 1, z)
      if (floorOk(floor)) { out.push({ x, y: c.y, z, move: 'walk' }); continue }
      if (bodyOpen(floor)) {
        // the drop: open below the neighbour's feet until a floor, at most DROP_MAX
        for (let d = 1; d <= DROP_MAX; d++) {
          const under = at(x, c.y - d - 1, z)
          if (!bodyOpen(at(x, c.y - d, z))) break
          if (floorOk(under)) { out.push({ x, y: c.y - d, z, move: 'drop' }); break }
          if (!bodyOpen(under)) break
        }
      }
      continue
    }
    // the step up: the neighbour's feet cell is the new floor; its feet + head one up, and headroom over this head
    if (floorOk(feet) && bodyOpen(head) && bodyOpen(at(x, c.y + 2, z)) && bodyOpen(at(c.x, c.y + 2, c.z))) {
      out.push({ x, y: c.y + 1, z, move: 'up' })
    }
  }
  return out
}

/**
 * CAN THE BOT WALK BACK TO WHERE IT WAS JUST FREE? -> { ok, reason, nodes, path, free_cell, free_t }.
 *   at        (x, y, z) -> block | null
 *   feet      the bot's position (any precision); the search starts at its cell
 *   free      the ring's fresh cells [{ x, y, z, t }]
 * ok only when a ring cell >= minFree from the feet is reached AND the search hit maxNodes (the component is open).
 * The search runs to the cap even after it finds a free cell, so a closed component is never mistaken for an open one.
 */
export function walkBack ({ at, feet, free = [], maxNodes = MAX_NODES, minFree = MIN_FREE_DIST } = {}) {
  const none = (reason, nodes = 0, free_cell = null) => ({ ok: false, reason, nodes, path: null, free_cell, free_t: null })
  if (typeof at !== 'function' || !feet) return none('no world')
  const start = cellOf(feet)
  if (!floorOk(at(start.x, start.y - 1, start.z))) return none('not standing on a floor')
  const freeKeys = new Map()
  for (const f of free) if (dist(f, start) >= minFree) freeKeys.set(key(f.x, f.y, f.z), f)
  if (!freeKeys.size) return none(`no free cell >= ${minFree} away in the ring`)
  const prev = new Map([[key(start.x, start.y, start.z), null]])
  const queue = [start]
  let found = null
  let nodes = 0
  while (queue.length && nodes < maxNodes) {
    const c = queue.shift()
    nodes++
    if (!found && freeKeys.has(key(c.x, c.y, c.z))) found = c
    for (const n of walkMoves(at, c)) {
      const nk = key(n.x, n.y, n.z)
      if (prev.has(nk)) continue
      prev.set(nk, { from: key(c.x, c.y, c.z), move: n.move })
      queue.push(n)
    }
  }
  const capped = nodes >= maxNodes
  // the cap may stop the search before it dequeues a free cell that is already queued: reachable all the same
  if (!found) found = queue.find(q => freeKeys.has(key(q.x, q.y, q.z))) ?? null
  if (!capped) return none(`closed component (${nodes} cells)`, nodes, found ? cellStr(found) : null)
  if (!found) return none(`no ring cell reachable within ${nodes} cells`, nodes)
  const path = []
  let k = key(found.x, found.y, found.z)
  while (k) { const p = prev.get(k); path.unshift(p ? `${k}:${p.move}` : k); k = p?.from ?? null }
  const f = freeKeys.get(key(found.x, found.y, found.z))
  return { ok: true, reason: 'walk back open', nodes, path, free_cell: cellStr(found), free_t: f?.t ?? null }
}

/**
 * THE BOUND, per area -> { decline, bound, area_n, areas }. `areas` is the caller's list [{ x, y, z, t0, n }] (returned
 * updated; the caller stores it). A firing within BOUND_R of an area started in the last BOUND_MS is that area's; once the
 * area has BOUND_N declines the firing runs today's arm (decline false, bound true). A firing in no live area starts one.
 */
export function boundDecide ({ areas = [], at, now, n = BOUND_N, ms = BOUND_MS, r = BOUND_R } = {}) {
  const live = areas.filter(a => now - a.t0 <= ms)
  const area = live.find(a => dist(a, at) <= r)
  if (area) {
    if (area.n >= n) return { decline: false, bound: true, area_n: area.n, areas: live }
    return { decline: true, bound: false, area_n: area.n + 1, areas: live.map(a => (a === area ? { ...a, n: a.n + 1 } : a)) }
  }
  return { decline: true, bound: false, area_n: 1, areas: [...live, { x: at.x, y: at.y, z: at.z, t0: now, n: 1 }] }
}

/**
 * THE WHOLE DECLINE -> { decline, why, walk, bound, areas }. Pure over its readings: the walk search first (no walk-back,
 * no decline, and the bound is not charged), then the bound.
 */
export function declineDecision ({ at, feet, free = [], areas = [], now } = {}) {
  const walk = walkBack({ at, feet, free })
  if (!walk.ok) return { decline: false, why: walk.reason, walk, bound: null, areas }
  const b = boundDecide({ areas, at: cellOf(feet), now })
  if (!b.decline) return { decline: false, why: `bound: ${b.area_n} declines here in ${BOUND_MS / 60_000} min`, walk, bound: b, areas: b.areas }
  return { decline: true, why: walk.reason, walk, bound: b, areas: b.areas }
}

// ---------------------------------------------------------------------------------------------- part 2: the in-wall dig

/** Full-collision blocks that do NOT suffocate in vanilla (isSuffocating never, or not a full cube). */
const NOT_SUFFOCATING = /(glass|leaves|^ice$|^packed_ice$|^blue_ice$|^frosted_ice$|barrier|beacon|slime_block|honey_block|scaffolding|powder_snow|soul_sand|^mud$|farmland|dirt_path|_pane$)/
const FULL = s => Array.isArray(s) && s.length === 6 && s[0] <= 0 && s[1] <= 0 && s[2] <= 0 && s[3] >= 1 && s[4] >= 1 && s[5] >= 1

/** Does this block suffocate a head inside it? A full-cube collision, not in the vanilla exceptions. null -> false. */
export function suffocates (b) {
  if (!b || b.boundingBox !== 'block' || !b.name) return false
  if (NOT_SUFFOCATING.test(b.name)) return false
  if (Array.isArray(b.shapes)) return b.shapes.length === 1 && FULL(b.shapes[0])
  return true                     // no shape data: a 'block' bounding box with no shapes is prismarine's full cube
}

/**
 * THE IN-WALL DECISION -> { act: 'dig' | 'unseen' | 'none', why }. Pure.
 *   eye         the block at the eye position
 *   healthNow, healthThen  health now and INWALL_TREND_MS ago (null when there is no trend yet)
 *   explained   something visible explains a health loss (in liquid, on fire, a DANGER cell at the feet or below, airborne)
 * dig      the eye cell suffocates and health is falling: the body is inside a block -- the one remedy is to break it
 * unseen   health is falling, nothing explains it, and the eye cell reads open: the instrument (no action)
 */
export function inwallDecision ({ eye = null, healthNow = null, healthThen = null, explained = false } = {}) {
  const falling = Number.isFinite(healthNow) && Number.isFinite(healthThen) && healthNow > 0 &&
                  healthThen - healthNow >= INWALL_DROP_HP
  if (!falling) return { act: 'none', why: 'health not falling' }
  if (suffocates(eye)) return { act: 'dig', why: `eye in ${eye.name}` }
  if (explained) return { act: 'none', why: 'health loss explained' }
  return { act: 'unseen', why: `health falling, eye reads ${eye?.name ?? 'unknown'}` }
}

/** A health trend: push(t, hp) every tick; then(now) is the newest reading at least `windowMs` old (or null). */
export function makeHealthTrend ({ windowMs = INWALL_TREND_MS, keepMs = 4 * INWALL_TREND_MS } = {}) {
  const s = []
  return {
    push (t, hp) { if (Number.isFinite(hp)) s.push([t, hp]); while (s.length && t - s[0][0] > keepMs) s.shift() },
    then (now) {
      let v = null
      for (const [t, hp] of s) { if (now - t >= windowMs) v = hp; else break }
      return v
    },
    clear () { s.length = 0 },
  }
}
