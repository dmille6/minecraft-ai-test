// SWIMCENTRE-01: A RISING BODY MUST BE UNDER THE HOLE IT IS RISING THROUGH.
//
// THE MECHANISM (7 days to 11-03 04:27Z, 63 drownings; docs/reports/swimcentre-01-2026-11-03.md):
//   - 56 of 63 drowned bots died at y = N.2 (falls die at .0, 21/27; suffocations .0, 28/31). N.2 + 1.8 = N+2.0: the top of
//     the 1.8-tall hitbox pressed against a solid block two cells above the feet, the eye (N+1.82) still in water.
//   - 12 of them were rescued with route `up` (air straight above the HEAD CELL): `drowningControls` returns jump with
//     forward=false, and the unowned hold clears forward, so nothing ever moves the body sideways. The 0.6-wide hitbox
//     overlaps a NEIGHBOUR column whose cell over the head is solid, and the bot holds jump into that edge until it dies
//     (14 of 14 rescue rows at one x,z: board-a-Comet 11-02, placebo-a-Comet 11-03, placebo-c-Alpha 11-02).
//   - 7 more had route `out` (air one column over). The stroke aims at the bot's FRACTIONAL position plus one block, so
//     it stops at the column boundary; once the centre crosses, the scan reads `up` from the new column and forward is
//     cleared while half the body is still under the old roof; the bot drifts back and the route flips to `out` again
//     (hive-b-Bravo 11-01: 50 to-air rows, z oscillating 161.7..162.1 around the 162.0 boundary).
//   The scan and the release ask about ONE column; the body occupies up to four.
//
// THE CHANGE: when the rescue (or the unowned float hold) rises, steer the body to the CENTRE of the column it is rising
// through -- the head column for `up` when a neighbour the hitbox overlaps is capped, the target column for `out` (always)
// -- and keep jump. Centred within CENTRE_TOL the 0.6 body is inside the 1.0 column on both axes and nothing else can cap
// it. The steering runs per PHYSICS TICK (the reflex loop is 500 ms; at ~0.1 block/tick in water one 500 ms stroke is a
// whole block, which is the ping-pong), with a coast-aware brake: water inertia 0.8 carries a body 4 ticks' worth of its
// speed after forward is released.
//
// What this is NOT: not a new reflex, not a new refusal, not a search. Water is terrain; the only water reflex is getting
// air, and this only makes the existing air rescue's own stroke land in the hole it already chose. SWIMCENTRE=0 restores
// the previous controls exactly.

export const CENTRE_TOL = 0.2          // hitbox half-width 0.3: |off| <= 0.2 keeps the body >= 0.1 inside a 1.0 column
export const COAST_TICKS = 4           // prismarine-physics waterInertia 0.8: coast = v * 0.8 / (1 - 0.8)
export const HALF_WIDTH = 0.3
export const AIM_TTL_MS = 700          // a goal the 500 ms reflex tick does not renew lapses (and releases forward)

export const swimCentreOn = (env = typeof process !== 'undefined' ? process.env : {}) =>
  !/^(0|off|false|no)$/i.test(String(env?.SWIMCENTRE ?? '1').trim())

/** The 1-4 columns a 0.6-wide body at (x, z) overlaps, as [cx, cz] pairs (own column first). */
export function bodyColumns (x, z, half = HALF_WIDTH) {
  const own = [Math.floor(x), Math.floor(z)]
  const xs = [...new Set([Math.floor(x - half + 1e-9), Math.floor(x + half - 1e-9)])]
  const zs = [...new Set([Math.floor(z - half + 1e-9), Math.floor(z + half - 1e-9)])]
  const out = [own]
  for (const cx of xs) for (const cz of zs) if (cx !== own[0] || cz !== own[1]) out.push([cx, cz])
  return out
}

/** A cell that stops a rising body: anything with a collision box, and an unreadable cell (unknown is never "clear"). */
export function caps (b) {
  if (b == null) return true
  if (b.name === 'water' || b.name === 'bubble_column') return false
  return b.boundingBox !== 'empty'
}

/**
 * WHICH COLUMN SHOULD THE RISING BODY BE CENTRED IN, or null for "leave the controls as they are".
 *   route  breathableRoute() result ({ dir, target })
 *   pos    the body's feet position {x, y, z}
 *   at     (x, y, z) -> block, absolute coordinates
 * `out`  -> always the TARGET column's centre (the old stroke aimed at a fractional point one block over).
 * `up`   -> the head column's centre, but only when a column the hitbox overlaps is capped at the cell over the head
 *           (or at head height: a body straddling a wall is also held there); an uncapped straddle rises anyway.
 */
export function riseCentreTarget ({ route, pos, at }) {
  if (!route || !pos) return null
  if (route.dir === 'out' && route.target) {
    return { cx: Math.floor(route.target.x), cz: Math.floor(route.target.z), why: 'out' }
  }
  if (route.dir !== 'up') return null
  const headY = Math.floor(pos.y + 1)
  const [own, ...others] = bodyColumns(pos.x, pos.z)
  for (const [cx, cz] of others) {
    if (caps(at(cx, headY + 1, cz)) || caps(at(cx, headY, cz))) return { cx: own[0], cz: own[1], why: 'edge', capAt: [cx, headY + 1, cz] }
  }
  return null
}

/**
 * THE 500 ms DECISION (pure): what the rescue/hold stroke does this tick, and what happens to the steerer's aim.
 *   may    () -> bool: nobody else holds the body (centreMay in reflex.mjs)
 *   guard  (feet {x,y,z}, step [dx,dz]) -> { safe, why, cell }: lava guard 2 (holdForwardSafe over the block map)
 * -> { act: 'release', why } -- keep the caller's old controls, and the caller MUST release any live aim NOW
 *      (a stale aim re-pressing forward for the rest of its TTL is the r1 blocker B1);
 *    { act: 'guarded', why, hv } -- forward off, no look, release the aim;
 *    { act: 'aim', cx, cz, why, forward, look } -- aim the steerer there and use forward/look this tick.
 */
export function riseCentreDecision ({ may = () => true, route, pos, vel, at, guard }) {
  if (!may()) return { act: 'release', why: 'yielded' }
  const t = riseCentreTarget({ route, pos, at })
  if (!t) return { act: 'release', why: 'no_target' }
  // a stroke INTO another column is swept; centring inside the column the feet occupy enters no new cell (dir 0,0)
  const feet = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }
  const dir = [Math.sign(t.cx - feet.x), Math.sign(t.cz - feet.z)]
  const step = dir[0] && dir[1] ? (Math.abs(t.cx + 0.5 - pos.x) >= Math.abs(t.cz + 0.5 - pos.z) ? [dir[0], 0] : [0, dir[1]]) : dir
  const hv = guard ? guard(feet, step) : { safe: true }
  if (!hv?.safe) return { act: 'guarded', why: 'lava', hv }
  const s = centreSteer({ pos, vel, cx: t.cx, cz: t.cz })
  return { act: 'aim', cx: t.cx, cz: t.cz, why: t.why, forward: s.forward, look: s.look, centred: s.centred }
}

/**
 * ONE PHYSICS TICK OF CENTRING (pure). Forward only while the remaining distance exceeds what the current speed will
 * coast; look level at the centre. Returns { centred, forward, look: {x, z} | null, off: [dx, dz] }.
 */
export function centreSteer ({ pos, vel = { x: 0, z: 0 }, cx, cz, tol = CENTRE_TOL, coast = COAST_TICKS }) {
  const tx = cx + 0.5, tz = cz + 0.5
  const dx = tx - pos.x, dz = tz - pos.z
  const off = [dx, dz]
  if (Math.abs(dx) <= tol && Math.abs(dz) <= tol) return { centred: true, forward: false, look: null, off }
  const dist = Math.hypot(dx, dz)
  const vToward = ((vel?.x ?? 0) * dx + (vel?.z ?? 0) * dz) / dist
  // aim for the middle half of the tolerance, so a coasting stop lands inside it
  const forward = dist - coast * Math.max(0, vToward) > tol / 2
  return { centred: false, forward, look: { x: tx, z: tz }, off }
}

/**
 * The per-physics-tick steerer. The 500 ms reflex tick calls aim() while its rescue/hold wants a centre; the steerer
 * then writes `forward` and a level look every physics tick until the goal lapses (AIM_TTL_MS) or is released. It never
 * touches jump (the caller owns it) and, when a goal ends, it clears forward only if its own last write set it.
 */
export function makeCentreSteer (bot, { now = () => Date.now(), emit = () => {}, may = () => true } = {}) {
  let goal = null
  let wroteForward = false
  const end = (how) => {
    if (!goal) return
    if (wroteForward) { try { bot.setControlState('forward', false) } catch { /* not connected */ } }
    wroteForward = false
    try { emit({ phase: 'end', how, goal, ms: now() - goal.since }) } catch { /* telemetry */ }
    goal = null
  }
  const onTick = () => {
    if (!goal) return
    if (now() > goal.until || !bot.entity) { end(goal.centredAt != null ? 'centred' : 'lapsed'); return }
    // ANOTHER OWNER TOOK THE BODY between two reflex ticks (a skill's path goal, the air pocket, a danger move): yield now,
    // not at the lapse -- and do not clear a forward someone else may have written since
    let ok = true
    try { ok = may() !== false } catch { ok = false }
    if (!ok) { wroteForward = false; end('yielded'); return }
    const pos = bot.entity.position
    const s = centreSteer({ pos, vel: bot.entity.velocity, cx: goal.cx, cz: goal.cz })
    if (s.centred && goal.centredAt == null) goal.centredAt = now()
    if (s.look) { try { bot.lookAt(pos.offset(s.look.x - pos.x, 1.62, s.look.z - pos.z), true) } catch { /* not connected */ } }
    try { bot.setControlState('forward', s.forward) } catch { /* not connected */ }
    wroteForward = s.forward
  }
  try { bot.on?.('physicsTick', onTick) } catch { /* a stub bot */ }
  return {
    aim (cx, cz, why = 'edge', ttlMs = AIM_TTL_MS) {
      const t = now()
      if (goal && (goal.cx !== cx || goal.cz !== cz)) end('retargeted')
      if (!goal) { goal = { cx, cz, why, since: t, until: t + ttlMs, centredAt: null }; try { emit({ phase: 'start', goal }) } catch { /* telemetry */ } }
      else goal.until = t + ttlMs
      return goal
    },
    release (how = 'released') { end(how) },
    active: () => goal,
    tick: onTick,            // tests drive it without a physics loop
    detach () { end('detached'); try { bot.removeListener?.('physicsTick', onTick) } catch { /* stub */ } },
  }
}
