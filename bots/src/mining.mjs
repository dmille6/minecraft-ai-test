// `mine` descends to an ELEVATION. It is not "dig the block under me".
//
// That distinction cost 82,699 vetoes -- 75.6% of every `bad_args` the fleet has
// ever produced. Measured over 84 bots: of 907 sampled "only digs DOWNWARD"
// refusals, 626 asked for exactly `here - 1` and 74 for `here` itself. The model
// was asking to descend one block, which is the one descent this verb cannot
// perform.
//
// The gate was RIGHT and the skill agrees with it. `mine` clamps the request to
// `floor(here) - 1`, then refuses outright when `position.y <= goalY + 1`, so the
// shallowest descent it can execute lands the target two below the feet. Both
// halves were correct; neither was ever told to the model.
//
// So this is not a new rule. It is the existing rule, named once, in a form the
// prompt can print and the gate can enforce from the same expression -- because a
// constraint the observation does not carry is a constraint the model cannot obey.
// The refusal already named a remedy ("use a LOWER y"), and it was printed 626
// times without being taken. Advice printed is not advice taken.

/** Bedrock. Nothing below this exists to dig. */
export const WORLD_FLOOR = -59

/**
 * The highest `y` that `mine` can actually act on from `hereY`.
 *
 * Derived from the skill, not guessed: `mine` proceeds only while
 * `position.y > goalY + 1`, so it needs `goalY < hereY - 1`, and the largest
 * integer strictly below `hereY - 1` is `ceil(hereY - 2)`.
 *
 *   hereY 63.0 -> 61   (standing on flat ground; y=62 is REFUSED, not a bug)
 *   hereY 62.7 -> 61   (mid-fall or on a slab)
 *   hereY 58.0 -> 56
 *
 * Returns null when the position is unknown, so callers can tell "no ceiling
 * applies" from "the ceiling is bedrock".
 */
export function mineTargetCeiling (hereY) {
  if (!Number.isFinite(hereY)) return null
  return Math.max(WORLD_FLOOR, Math.ceil(hereY - 2))
}

/** Is `y` a target `mine` can actually descend to from `hereY`? */
export function mineTargetOk (hereY, y) {
  if (!Number.isFinite(y)) return false
  if (y < WORLD_FLOOR) return false
  const cap = mineTargetCeiling(hereY)
  return cap === null ? true : y <= cap
}

/**
 * The one line the model was missing. Printed in the observation next to the
 * bot's elevation so the constraint arrives BEFORE the proposal, rather than as
 * a refusal afterwards.
 */
export function mineTargetHint (hereY) {
  const cap = mineTargetCeiling(hereY)
  if (cap === null) return ''
  if (cap <= WORLD_FLOOR) {
    return 'mine cannot descend further — you are at the bottom of the world.'
  }
  return `To mine you must pass y=${cap} or lower (mine descends to an elevation; ` +
         `it cannot dig a single block).`
}
