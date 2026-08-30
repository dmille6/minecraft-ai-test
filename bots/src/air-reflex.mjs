/**
 * THE ONLY WATER REFLEX: GET AIR. NOT GET OUT.
 *
 * Owner's model, and the whole design follows from it: "walking, running,
 * jumping, swimming are all methods to move in minecraft. Getting air,
 * returning to the surface of the water when air is low, is a reflex action."
 *
 * So swimming is a locomotion mode, identical in kind to walking, and being in
 * water is not a state this system needs an opinion about. A bot in water is
 * either moving (the pathfinder already swims: it aims at the next node, holds
 * `forward`, and holds `jump` whenever isInWater) or idle -- and idle in water
 * is no more remarkable than idle in a field, right up until the air runs out.
 *
 * WHAT THIS REPLACES, measured over 12 hours on 80 bots, 151,895 water events:
 *
 *     _drowning_to_shore           20,764  }  going OUT of the water
 *     _drowning_swim_to_known_land  6,031  }
 *     _drowning_up                 23,877     going toward AIR
 *     _drowning_escaped             1,585     succeeded
 *     _drowning_reentry            12,506     came straight back in
 *
 * The reflex spent more effort reaching shore than reaching air, succeeded
 * about 6% of the time, and the bot re-entered the water eight times for every
 * escape. "Get air" and "get out of the water" were treated as one goal. They
 * are not remotely the same problem: air is a metre straight up and almost
 * always available; shore is a navigation problem that mostly fails.
 *
 * THE INVARIANT THAT KEEPS THIS FROM GROWING BACK, and it is asserted in the
 * tests rather than trusted:
 *
 *     the target is breathable head space within 3 horizontal blocks.
 *
 * Never land, never shore, never a known-safe location, never a pathfinder
 * route, never anything remembered. If a future version of this file scores a
 * candidate by anything except "can I breathe there and how far is it", it has
 * become the thing that was deleted.
 */

export const ENTER_AIR_SECONDS = 6      // start rising with a real margin
export const RELEASE_MS = 1000          // head must STAY out, not blink out
export const STALL_MS = 1500            // no ascent for this long -> look sideways
export const MAX_LATERAL = 3            // blocks. Beyond this it is navigation.
export const LATERAL_BUDGET_MS = 4000

/**
 * What should the body do this tick?
 *
 * Pure: takes a described situation, returns an action. No bot, no clock, no
 * world. Everything that decides is visible to a test.
 *
 * Returns one of:
 *   null                      not an emergency; do nothing at all
 *   {act:'rise'}              hold jump, no horizontal input
 *   {act:'rise_toward', dx, dz}  ascent is blocked; there is air within reach
 *   {act:'release'}           head has been out long enough; give the body back
 */
export function airAction ({
  headUnder,          // is the head in a non-breathable block right now
  airSeconds,         // derived, from the bot's own head block and a clock
  healthFalling = false,
  active = false,     // is the reflex already holding the body
  headOutMs = 0,      // how long the head has been in air
  stalledMs = 0,      // how long ascent has made no progress
  airNear = null,     // {dx, dz, dist} nearest breathable head space, or null
} = {}) {
  if (active && !headUnder) {
    // NOT ON THE FIRST TICK. A bot bobbing at the surface breaks the plane for
    // a moment and goes straight back under; releasing there hands the body
    // back mid-drown.
    return headOutMs >= RELEASE_MS ? { act: 'release' } : { act: 'rise' }
  }
  const emergency = headUnder && (airSeconds <= ENTER_AIR_SECONDS || healthFalling)
  if (!active && !emergency) return null
  if (active && !emergency && headUnder) return { act: 'rise' }

  // Ascent blocked -- under ice, an overhang, a flooded ceiling. Look sideways
  // for AIR, and only for air.
  if (stalledMs >= STALL_MS && airNear && airNear.dist <= MAX_LATERAL) {
    return { act: 'rise_toward', dx: airNear.dx, dz: airNear.dz }
  }
  return { act: 'rise' }
}

/**
 * Nearest breathable head space, bounded to MAX_LATERAL.
 *
 * `breathableAt(dx, dz)` is supplied by the caller so this stays pure. The
 * bound is the point: three blocks is a lunge, not a journey, and anything that
 * needs a route is out of scope for a reflex.
 */
export function nearestAir (breathableAt, max = MAX_LATERAL) {
  let best = null
  for (let r = 1; r <= max; r++) {
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      if (!breathableAt(dx, dz)) continue
      const dist = Math.abs(dx) + Math.abs(dz)
      if (!best || dist < best.dist) best = { dx, dz, dist }
    }
    if (best) return best        // nearest ring wins; do not survey the world
  }
  return best
}
