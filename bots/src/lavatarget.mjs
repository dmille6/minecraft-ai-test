// LAVATARGET-01 (F5a of docs/reports/mineshaft-safety-2026-10-23.md; OWNER 2026-10-23 O3 "yes"). PURE but for the ring.
//
// WHY (measured 7 d to 10-31 17:00Z, ES, 80 bots, 168 h): 42 fire deaths. In 41 of 42 the bot's own lava guard refused a
// leg naming lava (`_lava_corridor`) in the 120 s before death; 29 of 42 had an `_explore_toward_known` in the 120 s before
// (24 of 42 heading for iron_ore in the last 60 s). The positive control: 300 random (bot, time) points in the same window
// (all with rows): `_explore_toward_known` in the prior 120 s 82 times (27%), iron-toward in the prior 60 s 44 (15%),
// `_lava_corridor` in the prior 120 s 3 (1%). Explore steers at a remembered sighting; the guard then refuses the legs
// that cross the lava beside it; the bot ends up idle on the pool's edge (81 of 84 idle at death, 10-23).
//
// THE CHANGE. `knownTarget` (skills.mjs, explore's heading) skips a sighting that has a lava cell THIS BOT SAW within
// NEAR_R blocks of it, or whose straight bearing from the bot passes within LINE_R of one (horizontal distance, the lava
// within LINE_DY of the segment's height band). It then takes the next sighting, or today's random bearing. Every kind,
// not only iron (a deviation from the design text: lava beside a log is the same pool). The ring holds RING_MAX cells
// for RING_MS, fed at the source by the guards that already found the lava: the executed-route corridor guard
// (index.mjs, every refusal whose reason names lava, not only the 5 s-throttled row) and explore's blind-step guard.
// It refuses nothing: the fallback is today's bearing. LAVATARGET=0 restores the base.
export const NEAR_R = 6
export const LINE_R = 2
export const LINE_DY = 8
export const RING_MS = 2 * 60 * 60_000
export const RING_MAX = 256

export const lavatargetOn = (env = typeof process !== 'undefined' ? process.env : {}) =>
  !/^(0|off|false|no)$/i.test(String(env?.LAVATARGET ?? '1').trim())
export const lavatargetModeDetail = (env = typeof process !== 'undefined' ? process.env : {}) =>
  `on=${lavatargetOn(env) ? 1 : 0} near=${NEAR_R} line=${LINE_R} dy=${LINE_DY} ring=${RING_MAX}/${RING_MS / 60_000}min`

/** A guard's reason names lava (not "unknown", not a drop): only then is its cell a lava cell. */
export const namesLava = why => typeof why === 'string' && /lava/.test(why) && !/unknown/.test(why)

/** The ring of lava cells this bot has seen. note([x,y,z] | {x,y,z}, t). cells(now) -> the fresh ones. */
export function makeLavaRing ({ ms = RING_MS, max = RING_MAX } = {}) {
  const m = new Map()
  return {
    note (c, t) {
      const x = Array.isArray(c) ? c[0] : c?.x, y = Array.isArray(c) ? c[1] : c?.y, z = Array.isArray(c) ? c[2] : c?.z
      if (![x, y, z].every(Number.isFinite)) return false
      const k = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`
      m.delete(k); m.set(k, { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), t })
      while (m.size > max) m.delete(m.keys().next().value)
      return true
    },
    cells (now) {
      const out = []
      for (const [k, v] of m) { if (now - v.t <= ms) out.push(v); else m.delete(k) }
      return out
    },
    get size () { return m.size },
  }
}

/** The bot's ring (created on first use; LAVATARGET=0 -> null, nothing is kept). */
export function lavaRingOf (bot, env) {
  if (!bot || !lavatargetOn(env)) return null
  if (!bot.lavaSeenRing) bot.lavaSeenRing = makeLavaRing()
  return bot.lavaSeenRing
}

/** Note a guard's finding: only when its reason names lava and it carries a cell. -> true when noted. */
export function noteLavaFinding (bot, verdict, now = Date.now()) {
  if (!verdict || verdict.safe !== false || !namesLava(verdict.why)) return false
  const ring = lavaRingOf(bot)
  return !!ring && ring.note(verdict.at ?? verdict.cell, now)
}

const segDist2D = (p, a, b) => {
  const vx = b.x - a.x, vz = b.z - a.z
  const L = vx * vx + vz * vz
  const u = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / L)) : 0
  return Math.hypot(a.x + u * vx - p.x, a.z + u * vz - p.z)
}

/**
 * IS THIS TARGET BESIDE OR BEHIND LAVA THE BOT HAS SEEN? -> null (clear) | { why: 'near'|'line', cell, distance }.
 *   from    the bot's position; target  the sighting { x, y, z }; lava  the ring's fresh cells
 */
export function lavaBlocksTarget ({ from, target, lava = [] } = {}) {
  if (!target || !lava.length) return null
  const ty = Number.isFinite(target.y) ? target.y : from?.y
  let best = null
  for (const c of lava) {
    const d = Math.hypot(c.x + 0.5 - target.x, c.y + 0.5 - (ty ?? c.y), c.z + 0.5 - target.z)
    if (d <= NEAR_R && (!best || best.why !== 'near' || d < best.distance)) best = { why: 'near', cell: c, distance: d }
  }
  if (best) return best
  if (!from) return null
  const lo = Math.min(from.y, ty ?? from.y) - LINE_DY, hi = Math.max(from.y, ty ?? from.y) + LINE_DY
  for (const c of lava) {
    if (c.y < lo || c.y > hi) continue
    const d = segDist2D({ x: c.x + 0.5, z: c.z + 0.5 }, from, target)
    if (d <= LINE_R && (!best || d < best.distance)) best = { why: 'line', cell: c, distance: d }
  }
  return best
}
