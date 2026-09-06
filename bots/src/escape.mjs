// EVERY REACHABLE STATE MUST NAME AN ACTION. THAT IS THE WHOLE MODULE.
//
// This project's named bug class is "two individually-correct guards meeting
// where the bot had no legal move". Five separate traps have had that shape, and
// today four more fixes to individual guards moved the mechanism and left the
// endpoint flat: stranded 17 -> 19 across matched windows, with the trap detected
// thousands of times and the remedy succeeding zero times.
//
// Fixing guards one at a time cannot close that class, because the defect is not
// in any guard. It is in the COMPOSITION -- the fact that the set of admissible
// actions can be empty. So the fix is a type, not a patch: a function over the
// bot's state that returns a member of a closed enum and NEVER returns nothing.
//
// The literature calls this nonblockingness (Ramadge-Wonham 1988) and shielding
// with a guaranteed-nonempty safe set (Alshiekh 2018, "the shield must always
// report at least one available action"). Both engines' reviews converged on it
// independently, and both independently proposed the same bottom rung.
//
// THE BOTTOM RUNG IS DEATH, AND IT IS NOT A COP-OUT.
//
// A bot on a one-block platform at y=197 with no inventory, nothing solid below
// it for more than the probe can see, and no lateral tread, has no move that
// preserves its life. Measured 2026-09-05: 734 of 1,205 underfoot attempts came
// from bots at y>=125, median y=145, and 16.3% of all attempts reported the drop
// as UNMEASURED -- no floor within 24 blocks. That is the population.
//
// Its alternatives are: die and respawn with an empty inventory near spawn, or
// burn ~565 decisions an hour forever at zero output. The fleet measured 8,477
// wasted decisions in six hours from fifteen such bots -- 21% of all inference.
// Respawn is a GAME MECHANIC, not a world edit, so it does not touch the owner's
// standing rule against teleporting, /give or setblock. `index.mjs` already
// handles the respawn event.
//
// A lattice without a bottom is not total, and non-total is how this fleet got
// here. `step_off` is the bottom.

/**
 * The closed set of escapes. Every one names a routine that EXISTS:
 *
 *   none            not trapped; nothing to do
 *   dig_down        `harvestUnderfoot` -- break the block underfoot, descend,
 *                   and gain material. Cheapest: costs nothing, helps twice.
 *   ride_floor_down `rideFloorDown` -- its free branch breaks the floor and
 *                   lands on it; its bridge branch places one block first.
 *   stair_up        `escapeStairUp` -- a bare-handed ascending ramp. THE answer
 *                   for a bot sealed in rock, and a null op for one stranded in
 *                   open air, because it needs a solid lateral neighbour to cut.
 *   pillar_up       `pillarOut` -- places `climbNeed` blocks and climbs them.
 *   surface_swim    hold a heading and pulse jump when the head submerges. NOT
 *                   `swim_to`, which sprint-swims submerged and is preempted by
 *                   the air reflex: 2.5% success over 5,623 calls.
 *   step_off        walk off the edge. The bottom.
 */
export const ESCAPES = Object.freeze([
  'none', 'dig_down', 'ride_floor_down', 'stair_up',
  'pillar_up', 'surface_swim', 'step_off',
])

/** Raised when a reachable state admits no action. The `ZeroLooksWrong` of this module. */
export class EscapeIsNotTotal extends Error {}

/** Minecraft deals `blocks - 3` damage; a drop of 3 or less is free. */
const FALL_FREE = 3

/** Deepest drop survivable with `margin` damage points to spare. */
function survivable (health, margin = 6) {
  const hp = Number.isFinite(health) ? health : 20
  const budget = hp - margin
  return budget <= 0 ? FALL_FREE : budget + FALL_FREE
}

/**
 * WHAT SHOULD THIS BOT DO TO GET OUT?
 *
 * Pure, total, and ordered by cost: the cheapest move that can work wins, and
 * the ordering is the design. Descending options come before ascending ones
 * because climbing is what stranded this population in the first place.
 *
 * Every input is optional and every unknown is treated as "cannot rely on it",
 * so a caller that cannot measure something never gets a MORE dangerous answer
 * because of the gap. The one exception is `trapped`: if the caller does not
 * claim the bot is trapped, the answer is `none`.
 */
export function escapePlan ({
  trapped = false,
  afloat = false,
  health = 20,
  blocks = 0,
  climbNeed = 25,
  underfootSolid = false,
  underfootDrop = null,      // null = probe found no floor. NOT "zero".
  floorBelowSolid = false,   // rideFloorDown's free branch: is there a floor to land on
  lateralTread = false,      // ANY solid neighbour at foot level, for the ramp
  solidLateralCount = null,  // how MANY of the four cardinals are solid, 0..4
  columnOpen = false,        // open sky above, for pillaring
  // INVARIANT: `lateralTread` and `canStepOff` are complements, not independent
  // axes. A foot-level lateral cell is solid (a tread) or passable (somewhere to
  // step). Treating them as free variables admitted 344 impossible states.
  canStepOff = true,         // default TRUE: absent evidence, open air is assumed
  y = null,                  // elevation, only used to refuse a pointless climb
  climbCeiling = null,
} = {}) {
  if (!trapped) return 'none'

  // WATER FIRST, and it is not a hazard. The owner's directive is that swimming
  // is travel and the only water reflex is getting air, so a floating bot is not
  // "drowning" -- it is somewhere that needs traversing.
  if (afloat) return 'surface_swim'

  const cap = survivable(health)
  const dropOk = Number.isFinite(underfootDrop) && underfootDrop >= 0 &&
                 (underfootDrop <= FALL_FREE || underfootDrop <= cap)
  const dropFree = Number.isFinite(underfootDrop) && underfootDrop >= 0 &&
                   underfootDrop <= FALL_FREE

  // ---------------------------------------------------------------- geometry --
  // ONE ORDERING FOR TWO DIFFERENT PROBLEMS WAS THE DEFECT. THREE BANDS, NOT A
  // BOOLEAN, IS THE CORRECTION TO THE CORRECTION.
  //
  // Server-side scans of all 14 stuck bots on 2026-09-06 (RCON `execute if
  // block`, against the SERVER, not the bot's cache) found two dominant shapes
  // and one state in between:
  //
  //   6 bots  PILLAR    0 of 4 cardinals solid, open above. A 1x1 tower.
  //                     Nothing to cut into; down is the answer and it works --
  //                     isolated-a-Echo descended y=201 -> 186 riding its own
  //                     column one block at a time.
  //   7 bots  ENTOMBED  4 of 4 solid AND capped. A two-block pocket at the
  //                     bottom of a one-wide shaft. Down goes deeper and wood is
  //                     above ground; the bare-handed ramp needs no material.
  //   1 bot   MIXED     hive-b-Bravo: 1 of 4 solid, capped, head blocked.
  //
  // THE FIRST VERSION OF THIS SPLIT USED `lateralTread`, AND THE PROOF WAS
  // WRONG. That flag means "ANY one cardinal is solid", so it lumped the middle
  // band in with the sealed one and applied the entombed policy -- refuse a
  // survivable drop, never step off -- to a bot with three open sides. The
  // justification given was that `lateralTread` and "somewhere to step" are
  // complements. They are not: with one solid and three open, BOTH a ramp anchor
  // and an open cell exist. Review caught it; the scan showed the band is real
  // rather than hypothetical.
  //
  // So the bands are separated and the middle one CHANGES NOTHING from the
  // deployed ordering except that a free ramp now outranks the death rung.
  // Policy without measurement behind it is the thing to avoid here.
  const walls = Number.isFinite(solidLateralCount)
    ? solidLateralCount
    // A caller that can only report the boolean gets the LEAST-ASSUMING band:
    // "some wall exists" is evidence of an anchor, never of being sealed.
    : (lateralTread ? 1 : 0)
  const sealed = walls >= 4
  const open = walls === 0

  if (sealed) {
    // ENTOMBED. Walls on every side, so the ramp is affordable and terminal, and
    // there is nowhere to step even if the bottom rung were offered.
    //
    // A FREE drop is still taken first: it costs nothing, needs no material, and
    // the floor of one of these pockets often opens straight into a cave
    // (isolated-a-Delta has open space two blocks under its floor). Anything
    // deeper is refused even when survivable, because it buys depth in the one
    // direction the endpoint does not live -- the recorded lesson is that the
    // staircase work drove the endpoint down, and `surface` works 12% of the
    // time.
    if (underfootSolid && dropFree) return 'dig_down'
    return 'stair_up'
  }

  // OPEN. Air on every side, so there is nothing to cut a ramp into -- the ramp
  // routine is a null op here by its own precondition, which is why it is absent
  // from this branch rather than merely ranked lower.
  if (underfootSolid && dropOk) return 'dig_down'

  // `rideFloorDown` REQUIRES A SOLID BLOCK UNDERFOOT. Its first line reads y-1
  // and refuses with `nothing underfoot to stand on` if that is not solid,
  // because that is the block it BREAKS. Gating this rung on `floorBelowSolid`
  // (y-2) was a defect: y-2 only picks which branch runs once it is going --
  // solid means ride down free, air means bridge by placing one block. Measured
  // 2026-09-06: 821 of 821 consultations that chose this rung returned
  // `rode down 0.0 (placed 0, nothing underfoot to stand on)`. Not some. All.
  if (underfootSolid && (floorBelowSolid || blocks > 0)) return 'ride_floor_down'

  // MIXED (1..3 solid): it HAS a ramp anchor, and the ramp is free. Preferring
  // it over the death rung needs no new evidence -- it is strictly cheaper than
  // dying. What this band does NOT inherit is the sealed policy above: a
  // survivable drop was already taken by the branch above this one, exactly as
  // the deployed lattice would have.
  if (!open) return 'stair_up'

  // PILLARING UP IS REFUSED ABOVE THE CEILING, and that is not a detail. This
  // rung was chosen for `stranded_high` bots -- a branch whose own log line says
  // "climbing cannot help; this bot needs to descend" -- and scored a 22-block
  // climb FURTHER above the ceiling as a success.
  const tooHigh = Number.isFinite(y) && Number.isFinite(climbCeiling) && y >= climbCeiling
  if (columnOpen && blocks >= climbNeed && !tooHigh) return 'pillar_up'

  // THE BOTTOM, AND IT IS UNCONDITIONAL FOR THIS GEOMETRY ONLY.
  //
  // Reaching this line means no lateral tread, and a lateral cell that is not
  // solid is somewhere to walk into. That is the whole proof of availability.
  //
  // It is also why the geometry split matters for safety rather than only for
  // effectiveness: an entombed bot can no longer arrive here. It used to,
  // through the old global ordering, and `step_off` was measured causing 6 of
  // 14 fall deaths with 21% of its firings carrying an UNMEASURED drop -- a bot
  // walked off a 59-block drop it had never priced.
  // `canStepOff` is kept only as an override for a caller that can positively
  // prove otherwise. Absent that the GEOMETRY decides, because reaching this
  // line already means `lateralTread` is false and the two are complements: a
  // foot-level cell is solid (a tread) or passable (somewhere to step). The
  // first version of this module gated the bottom rung on the flag alone and
  // the totality property immediately found 344 states with no action, every
  // one of them carrying both as false -- a pair that cannot both be true of
  // the world.
  if (canStepOff !== false || !lateralTread) return 'step_off'

  // Unreachable given the above. Kept as a RAISE and never a silent `none`,
  // because a quiet "do nothing" here would be precisely the empty admissible
  // set this module exists to make impossible.
  throw new EscapeIsNotTotal(
    'no escape for: ' + JSON.stringify({ afloat, health, blocks, underfootSolid,
      underfootDrop, floorBelowSolid, lateralTread, columnOpen, canStepOff }))
}

/**
 * Is the lattice total over a state space?
 *
 * Returns the list of states that admit no action -- empty means total. Exported
 * so the property can be asserted in a test AND checked at runtime against real
 * observed states, rather than only against the ones a test author imagined.
 */
export function untotalStates (states) {
  const bad = []
  for (const s of states) {
    try {
      const a = escapePlan(s)
      if (!ESCAPES.includes(a)) bad.push({ state: s, reason: `unknown action ${a}` })
      if (s.trapped && a === 'none') bad.push({ state: s, reason: 'trapped but told to do nothing' })
    } catch (e) {
      bad.push({ state: s, reason: e.message })
    }
  }
  return bad
}
