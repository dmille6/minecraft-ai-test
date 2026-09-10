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
  'climb_ladder', 'pillar_up', 'surface_swim', 'float_up', 'step_off',
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
  // A PASSABLE CELL AT HEAD HEIGHT, in any of the four cardinals.
  //
  // The discriminator between "afloat with somewhere to swim" and "afloat in a
  // one-block air pocket". Reconstructed from the live world at 1809,61,666
  // (hive-b-Comet, zero items in 40 minutes, 20/20 health for hours): feet in
  // water at y=61, head in an air pocket at y=62, and every cardinal at head
  // height SOLID. Open water above at y=63.
  lateralHeadOpen = true,
  // A SINGLE DERIVED FLAG, ON PURPOSE.
  //
  // It means all of: there is a wall a ladder can actually attach to, the
  // column above is clear for the whole climb, and the bot holds enough
  // ladders with a reserve. The caller computes it from ladder.mjs, where each
  // of those is a tested pure function.
  //
  // ONE flag rather than three inputs because this lattice has been bitten
  // already: `lateralTread` and `canStepOff` were admitted as independent axes,
  // and the totality property immediately found 344 states asserting both that
  // there IS a solid lateral neighbour and that there ISN'T. Three ladder
  // variables would multiply the state space by eight and invite the same
  // contradiction. Default false, so every state that does not positively
  // qualify behaves exactly as it did before this rung existed.
  ladderReady = false,
  // INVARIANT: `lateralTread` and `canStepOff` are complements, not independent
  // axes. A foot-level lateral cell is solid (a tread) or passable (somewhere to
  // step). Treating them as free variables admitted 344 impossible states.
  canStepOff = true,         // default TRUE: absent evidence, open air is assumed
  // RUNGS THIS BOT HAS ALREADY TRIED AND WHICH REFUSED.
  //
  // THE LATTICE WAS STATELESS, AND THAT IS ITS OWN TRAP. A rung whose routine
  // refuses does not change the world, so the next consultation sees exactly
  // the state that chose it and chooses it again. Forever.
  //
  // placebo-b-Comet is the proof: 1x1 flooded slot at y=-19, four days at
  // (652.7, -18.8, 106.7), 20/20 health. `underfootSolid` and `drop=1` are
  // permanent facts of that slot, so `dig_down` wins every consultation where
  // it is not afloat and `surface_swim` wins every one where it is. Between
  // them they cover every tick, and `stair_up` -- the rung for a bot with walls
  // and no material, and the one established answer for a bare-handed material
  // deadlock -- is structurally unreachable. It has never been offered once.
  //
  // Kept PURE and kept TOTAL: this is an input, not a field, and `step_off` is
  // never skipped. Excluding every survivable rung therefore cannot produce an
  // empty admissible set -- it produces the bottom, which is the same guarantee
  // this module already makes. The caller is responsible for not walking a bot
  // to its death on a transient refusal; see the note on the escape loop in
  // reflex.mjs, which never lets an exclusion reach `step_off`.
  exclude = [],
} = {}) {
  if (!trapped) return 'none'
  const skip = new Set(exclude)

  // WATER FIRST, and it is not a hazard. The owner's directive is that swimming
  // is travel and the only water reflex is getting air, so a floating bot is not
  // "drowning" -- it is somewhere that needs traversing.
  //
  // BUT SWIMMING NEEDS SOMEWHERE TO SURFACE TO.
  //
  // placebo-b-Delta has floated in a sealed flooded pocket at y=44 for thirteen
  // days: four walls and a solid cap. The first escape attempt it has ever been
  // given, once the ceiling gate stopped excluding it, chose this rung and
  // reported "swam 0.0 blocks on a fixed heading" -- because there is nowhere to
  // swim TO. A capped bot in water is not traversing, it is entombed and wet,
  // and the answer is the same as for any other entombment: cut a way out.
  //
  // `columnOpen` is the discriminator and it is already observed. Open water
  // keeps this rung exactly as it was; a lid sends the bot to the digging rungs
  // below, which is what it needed all along.
  // RISE BEFORE YOU SWIM, WHEN SWIMMING IS NOT AVAILABLE.
  //
  // `surface_swim` used to win every afloat state with an open column, and for
  // a bot in a one-block air pocket it is precisely wrong: there is nowhere to
  // swim TO, so it reports "swam 0.0 blocks on a fixed heading" and the bot
  // stays for hours. Confirmed against the real Movements class over the
  // reconstructed world: ZERO legal moves with canDig=false, with canDig=true,
  // and with 64 scaffold blocks in hand.
  //
  // Three of pathfinder's own rules meet there. getMoveUp returns early when
  // the current node is liquid (movements.js:525) and getMoveDown does the same
  // (:516), so A* cannot plan a vertical move out of water at all; and with all
  // four cardinals blocked at head height every diagonal would corner-cut and is
  // refused. The bot is not trapped in the WORLD -- mineflayer's own tick holds
  // `jump` whenever isInWater, so it could float out in seconds. It is trapped
  // in the PLANNER.
  //
  // So this rung is deliberately not a path: it is physics. Hold jump until the
  // feet clear the water, then let ordinary travel resume from a cell A* can
  // actually reason about.
  //
  // Ordered ABOVE surface_swim because surface_swim would otherwise claim the
  // state and do nothing, which is how this went unnoticed for days.
  if (afloat && columnOpen && !lateralHeadOpen && !skip.has('float_up')) return 'float_up'
  if (afloat && columnOpen && !skip.has('surface_swim')) return 'surface_swim'

  // DOWN BEFORE UP. Climbing produced this population.
  const cap = survivable(health)
  const dropOk = Number.isFinite(underfootDrop) && underfootDrop >= 0 &&
                 (underfootDrop <= FALL_FREE || underfootDrop <= cap)
  if (underfootSolid && dropOk && !skip.has('dig_down')) return 'dig_down'
  if (floorBelowSolid && !skip.has('ride_floor_down')) return 'ride_floor_down'

  // A LADDER BEATS CUTTING A RAMP, WHEN ONE IS ACTUALLY BUILDABLE.
  //
  // It costs no tool durability, digs nothing, and mineflayer-pathfinder
  // already treats a ladder as climbable -- so unlike a ramp or a pillar, what
  // it leaves behind is a permanent TWO-WAY route the navigator can use to come
  // back down. A pillar is one-way and strands the next bot on top of it.
  //
  // Above `stair_up` because the ramp needs a tool and spends it; above
  // `pillar_up` because a ladder is one item per level against one block per
  // level with a jump-place at every step. Below the DOWN rungs, because
  // climbing is what produced this population in the first place.
  if (ladderReady && !skip.has('climb_ladder')) return 'climb_ladder'

  // The ramp needs something to cut into. A bot on a pillar has air on all four
  // cardinals BY THE DEFINITION of stranded, which is why this is not first.
  if (lateralTread && !skip.has('stair_up')) return 'stair_up'

  // Placing is last of the survivable options because it is the only one that
  // spends inventory, and `canFinishClimb` refuses a climb it cannot finish --
  // a half-built pillar seals the bot higher than it started, holding nothing.
  if (columnOpen && blocks >= climbNeed && !skip.has('pillar_up')) return 'pillar_up'

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
  // AN EXCLUSION MUST NEVER BE ABLE TO EMPTY THE SET. The structural argument
  // below reads "no solid lateral neighbour means an open one", and it holds --
  // but it holds because the `stair_up` branch above returns for the other case.
  // Once a caller can EXCLUDE that branch, a bot with `lateralTread: true` and
  // `canStepOff: false` falls through to the throw, and the whole point of this
  // module is that no reachable state does that. So the bottom is unconditional
  // whenever anything has been excluded.
  if (skip.size || canStepOff !== false || !lateralTread) return 'step_off'

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
