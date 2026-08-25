// SWIMMING AND NOT DROWNING ARE THE SAME PROBLEM, AND TWO LAYERS WERE SOLVING
// IT SEPARATELY.
//
// `swim_to` travels SUBMERGED on purpose: sprint-swimming reaches 3.92 m/s and
// surface swimming caps at 2.20, so speed and air are a real trade. The 500ms
// drowning reflex exists to seize a bot whose air is running out. Over six
// hours those two fought 174 times: of 279 started crossings, the largest
// single outcome was `drowning` -- the skill deliberately creating the state
// the reflex exists to interrupt, then losing the body to it mid-crossing.
//
// The old rule surfaced at 35% air while the reflex fires at 25%. That is a ten
// point margin on a signal sampled every 500ms, and surfacing is not
// instantaneous -- the bot has to rise. So the reflex usually won the race, and
// the crossing was abandoned a few metres further along every time.
//
// The fix is not to raise the margin by five points. It is to stop arriving at
// the threshold at all: dive on a FULL breath, come up on a HALF one, breathe,
// dive again. A swimmer porpoises; it does not swim until it is drowning and
// then panic.
//
//     dive 100% -> 55%   ~6.8s submerged at 3.92 m/s
//     surface, breathe    ~1.7s at 2.20 m/s (air refills 4/tick)
//     average             ~3.6 m/s, against 2.20 for staying up the whole way
//
// So it keeps most of the speed advantage that made submerging attractive, and
// never approaches the threshold that hands the body to the reflex.

/** Dive while air is above this. Comfortably clear of the reflex threshold. */
export const DIVE_UNTIL = 0.55

/** Once up, stay up until air is at least this. Refilling is fast. */
export const BREATHE_TO = 0.95

/**
 * The reflex's critical threshold, mirrored here so the margin is checkable.
 * If these ever drift together the skill starts losing races again, and
 * swim-breath.test.mjs fails rather than the fleet discovering it.
 */
export const REFLEX_CRITICAL = 0.25

/** How much clear air must separate the dive floor from the reflex. */
export const MIN_MARGIN = 0.20

/**
 * What to do with the body this tick, given air and whether the head is up.
 *
 * `phase` is carried between ticks so surfacing does not oscillate: once the
 * decision to come up is made it holds until the bot has actually breathed,
 * rather than flipping the moment air ticks back over the threshold.
 */
export function breathPlan ({ airFraction, headUp, phase = 'dive', canSurface = true } = {}) {
  if (typeof airFraction !== 'number') {
    // No trustworthy air reading. Travel at the surface: slower, and it cannot
    // drown. An unknown must not be treated as a full breath -- that is how a
    // stale reading sent bots under on an empty lung.
    return { phase: 'breathe', jump: true, sprint: false,
             reason: 'no air reading; surface travel is the safe default' }
  }

  // Nowhere to surface TO -- under ice, in a flooded cave, beneath an overhang.
  // Porpoising cannot help here and pretending otherwise burns the last of the
  // air against a ceiling. Give the body up while there is margin to act.
  if (!canSurface && airFraction <= DIVE_UNTIL) {
    return { phase: 'trapped', jump: false, sprint: false, abort: true,
             reason: 'submerged with no route to air' }
  }

  if (phase === 'breathe') {
    // Keep coming up until actually breathing, then top up before diving again.
    if (!headUp) {
      return { phase: 'breathe', jump: true, sprint: false, reason: 'rising to air' }
    }
    if (airFraction < BREATHE_TO) {
      return { phase: 'breathe', jump: false, sprint: false, reason: 'topping up at the surface' }
    }
    return { phase: 'dive', jump: false, sprint: true, reason: 'full breath; diving' }
  }

  // phase === 'dive'
  if (airFraction <= DIVE_UNTIL) {
    return { phase: 'breathe', jump: true, sprint: false, reason: 'half a breath; surfacing early' }
  }
  return { phase: 'dive', jump: false, sprint: true, reason: 'submerged sprint' }
}

/** Is the dive floor still clear of the reflex by a usable margin? */
export function marginOk (diveUntil = DIVE_UNTIL, reflex = REFLEX_CRITICAL) {
  return diveUntil - reflex >= MIN_MARGIN
}
