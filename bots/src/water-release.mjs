// WHEN IS A BOT ACTUALLY OUT OF THE WATER?
//
// Measured over six hours on forty bots, the old answer was wrong 79% of the
// time. Of 3,245 terminal drowning releases:
//
//     drowning_escaped              676   reached land
//     drowning_surfaced_stranded  1,814   surfaced, no shore, released anyway
//     drowning_released_timeout     755   the 20s clock expired
//
// Only 676 ended on land. Re-entry into drowning after a release had a MEDIAN
// of 6 seconds and a p10 of ZERO, and 81% of the stranded releases re-entered.
// The reflex was handing an unowned bot back into open water, cognition
// re-proposed the same crossing, and the reflex fired again.
//
// So the release condition was "we ran out of clock", and it needs to be "the
// bot is somewhere it will still be safe a moment from now".
//
// WHY THIS IS NOT JUST "HOLD UNTIL SAFE"
//
// Peaceful difficulty removes death pressure but not opportunity cost, and an
// unbounded hold is its own failure: the reflex owns the body forever in an
// ocean, the 30s cognitive loop never regains control, and the bot cannot
// replan around a recovery that is not working. A bot held for an hour looks
// exactly like a bot that drowned, except it also cannot be rescued by anything
// upstream.
//
// So the hold is BOUNDED and ESCALATES. Each stage widens what the bot is
// willing to consider, and the last stage gives the body back with a DECLARED
// failure rather than a silent one -- `water_stuck` is a finding, and
// `drowning_surfaced_stranded` was noise that looked like a finding.
//
// The escalation ladder is deliberately coarse. The shore search costs block
// reads and the radii are what the reflex can afford per tick; widening early
// and often would spend the tick budget that keeps the bot breathing.

/** Out of water this long before a release counts as durable, not momentary. */
// WHAT IS ACTUALLY WIRED, AND WHAT IS NOT.
//
// This file shipped on 2026-08-24 and ran nothing for two days: the commit
// added the module and its unit tests and imported it from neither. Green
// tests on dead code read exactly like green tests on live code, so the split
// is written down here and asserted in water-release.test.mjs.
//
//   LIVE   updateDryMs, DRY_HOLD_MS   reflex.mjs advances dry time every tick
//                                     and will not call a rescue an escape
//                                     until the bot has stayed dry
//   LIVE   SEARCH_RADII               the shore scan's stopping point
//
//   DEAD   waterReleaseDecision       reflex.mjs keeps its own predicate
//   DEAD   radiusFor, WIDEN_AT_MS     time-earned radii were TRIED and REVERTED:
//                                     holding a bot thirty seconds to earn a
//                                     wider look is the paralysis that
//                                     water-travel.test.mjs forbids
//   DEAD   WATER_STUCK_MS             120s is past RESCUE_CEILING_MAX_MS (45s),
//                                     so `give_up` is unreachable by construction
//
// The dead half is kept because it is the written form of the policy and its
// fixtures are the measured failures. It is not kept because it runs.

export const DRY_HOLD_MS = 3_000

/** Shore search radii, in order. The first is what the old code always used. */
export const SEARCH_RADII = [24, 48, 96]

/** When to step to the next radius. */
export const WIDEN_AT_MS = [0, 15_000, 30_000]

/** Owning the body longer than this is its own failure; declare and hand back. */
export const WATER_STUCK_MS = 120_000

/**
 * What the reflex should do about a bot in water, as a value.
 *
 * `dryMs` is time CONTINUOUSLY out of water -- it resets the moment the bot is
 * back in, which is what makes "durable" mean anything. `shoreDist` is null
 * when the current radius found nothing.
 */
export function waterReleaseDecision ({
  inWater, ashore, inBoat = false, dryMs = 0, heldMs = 0,
  shoreDist = null, oxygenFraction = 1, healthDropped = false,
} = {}) {
  // A boat is a durable safe state: the bot floats, breathes, and travels.
  if (inBoat && !inWater) {
    return { action: 'release', kind: 'drowning_escaped', reason: 'in_boat' }
  }

  // THE DURABILITY CLAUSE. Standing on land for one tick is what
  // `drowning_escaped` used to mean, and 45% of those re-entered anyway. The
  // bot has to still be dry a few seconds later.
  if (ashore && !inWater) {
    if (dryMs >= DRY_HOLD_MS) {
      return { action: 'release', kind: 'drowning_escaped', reason: 'ashore_durable' }
    }
    return { action: 'hold', reason: 'ashore_but_not_yet_durable', dryMs }
  }

  // The hard ceiling. Declared, not silent: this is a bot the water beat, and
  // it should be counted as one rather than disappearing into a release kind
  // that also covers ordinary rescues.
  if (heldMs >= WATER_STUCK_MS) {
    return { action: 'give_up', kind: 'water_stuck', reason: 'held_too_long', heldMs }
  }

  // No shore at the current radius: widen rather than release. This is the
  // 3,397 `drowning_no_shore` events and the 1,814 stranded releases they
  // produced -- the bot was in open water and the answer was to look further,
  // not to stop looking.
  const radius = radiusFor(heldMs)
  if (shoreDist == null) {
    const next = nextRadius(radius)
    if (next != null) {
      return { action: 'widen', radius: next, reason: 'no_shore_at_current_radius' }
    }
    // NOTHING WITHIN THE WIDEST RADIUS: give the body back, and this is
    // deliberately NOT a hold.
    //
    // The first draft of this file held the bot at the surface here, and that
    // would have reinstated a failure this reflex already learned and wrote
    // down: holding a surfaced, full-lunged bot at `forward:false, jump:true`
    // for the ceiling, releasing it, and re-seizing on the next submersion --
    // so a bot crossing open water lost the whole ceiling out of every cycle to
    // a rescue that had already established there was nothing to rescue it to.
    // Doing that for WATER_STUCK_MS instead of 20s would have been six times
    // worse. Open water is terrain, and crossing it needs the body.
    //
    // So the contribution of this module is not "never release into water". It
    // is that the release happens only after the search has actually been
    // widened, instead of at the first radius that found nothing.
    return { action: 'release', kind: 'drowning_surfaced_stranded',
             reason: 'no_shore_within_widest_radius' }
  }

  return { action: 'swim', radius, shoreDist, reason: 'closing_on_shore' }
}

/** Which search radius applies after being held this long. */
export function radiusFor (heldMs) {
  let r = SEARCH_RADII[0]
  for (let i = 0; i < WIDEN_AT_MS.length; i++) {
    if (heldMs >= WIDEN_AT_MS[i]) r = SEARCH_RADII[i]
  }
  return r
}

function nextRadius (current) {
  const i = SEARCH_RADII.indexOf(current)
  return i >= 0 && i + 1 < SEARCH_RADII.length ? SEARCH_RADII[i + 1] : null
}

/**
 * Continuous dry time, given the previous value and this tick's observation.
 * A single tick back in the water resets it to zero -- that is the whole point.
 */
export function updateDryMs (prevDryMs, inWater, tickMs) {
  return inWater ? 0 : prevDryMs + tickMs
}
