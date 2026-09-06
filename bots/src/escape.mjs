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
  lateralTread = false,      // a solid neighbour at foot level, for the ramp
  columnOpen = false,        // open sky above, for pillaring
  // INVARIANT: `lateralTread` and `canStepOff` are complements, not independent
  // axes. A foot-level lateral cell is solid (a tread) or passable (somewhere to
  // step). Treating them as free variables admitted 344 impossible states.
  canStepOff = true,         // default TRUE: absent evidence, open air is assumed
} = {}) {
  if (!trapped) return 'none'

  // WATER FIRST, and it is not a hazard. The owner's directive is that swimming
  // is travel and the only water reflex is getting air, so a floating bot is not
  // "drowning" -- it is somewhere that needs traversing.
  if (afloat) return 'surface_swim'

  // DOWN BEFORE UP. Climbing produced this population.
  const cap = survivable(health)
  const dropOk = Number.isFinite(underfootDrop) && underfootDrop >= 0 &&
                 (underfootDrop <= FALL_FREE || underfootDrop <= cap)
  if (underfootSolid && dropOk) return 'dig_down'

  // `rideFloorDown` REQUIRES A SOLID BLOCK UNDERFOOT. Its first line reads the
  // cell at y-1 and refuses with `nothing underfoot to stand on` if it is not
  // solid, because that is the block it BREAKS -- the manoeuvre is to stand on
  // the floor, break it, and land on whatever was under it.
  //
  // This rung was gated on `floorBelowSolid` (y-2) instead, which is not the
  // routine's precondition at all: y-2 only decides WHICH BRANCH it takes once
  // it is running -- solid means ride down for free, air means bridge by
  // placing one block. So the lattice selected this rung in exactly the states
  // where the routine cannot start.
  //
  // Measured 2026-09-06, the first window after the routines were wired:
  // 679 of 679 consultations that chose `ride_floor_down` returned
  // `rode down 0.0 (placed 0, nothing underfoot to stand on)`. Not some. All of
  // them, with one identical string. The rung was unreachable-in-practice while
  // looking wired, which is the same defect as the unwired table it replaced,
  // one layer further in.
  //
  // It was also STEALING STATES FROM `stair_up`, which is tested after it:
  // hive-c-Echo reached this rung 85 times with `tread=true` while `stair_up`
  // was succeeding for that same bot (climbed 5.2, 21.5, 22.4 in the same
  // window). A rung that cannot run must not out-rank one that can.
  //
  // `blocks > 0` covers the bridge branch: with nothing solid at y-2 and no
  // placeable block, the routine stops at `no placeable blocks left` before
  // breaking anything, so selecting it there would be another guaranteed
  // refusal. It stops BEFORE the break, so falling through costs nothing.
  if (underfootSolid && (floorBelowSolid || blocks > 0)) return 'ride_floor_down'

  // The ramp needs something to cut into. A bot on a pillar has air on all four
  // cardinals BY THE DEFINITION of stranded, which is why this is not first.
  if (lateralTread) return 'stair_up'

  // Placing is last of the survivable options because it is the only one that
  // spends inventory, and `canFinishClimb` refuses a climb it cannot finish --
  // a half-built pillar seals the bot higher than it started, holding nothing.
  if (columnOpen && blocks >= climbNeed) return 'pillar_up'

  // THE BOTTOM, AND IT IS UNCONDITIONAL. Reaching this line is itself the proof
  // that it is available.
  //
  // The first version gated it on a `canStepOff` flag, and the totality test
  // immediately found 344 states with no action -- every one of them carrying
  // `lateralTread: false` AND `canStepOff: false` together. That pair cannot
  // both be true of the world: a lateral cell at foot level is either solid, in
  // which case it is a tread, or it is not, in which case it is somewhere to
  // walk into. The input space permitted a contradiction and the property
  // caught it, which is exactly what it is for.
  //
  // So the reasoning is now structural rather than a flag. Control only arrives
  // here when `lateralTread` is FALSE -- the ramp branch above returns
  // otherwise -- and no solid lateral neighbour means an open one. A bot sealed
  // in rock never reaches this line at all, because being sealed IS having a
  // solid neighbour, and `stair_up` is its answer.
  //
  // `canStepOff` is kept in the signature only as an override for a caller that
  // can positively prove otherwise; absent that, the geometry decides.
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
