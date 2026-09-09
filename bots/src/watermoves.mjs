// A SWIMMING BOT IS TREATED AS STANDING AT THE BOTTOM OF THE WATER.
//
// Measured against the real `Movements` class on a synthetic shoreline: a bot
// floating at the surface beside land is offered 5 neighbours and NOT ONE of
// them is onto the land. Every offered move goes back out to sea. That holds
// for a shore flush with the surface, a one-block ledge and a two-block ledge
// alike -- all three fail identically, which is the tell that one shared test
// is rejecting them rather than three different limits.
//
// The shared test is `getMoveJumpUp`'s:
//
//     const block0 = this.getBlock(node, 0, -1, 0)
//     if (blockC.height - block0.height > 1.2) return   // Too high to jump
//
// `getBlock` derives height from the block's collision shapes:
//
//     b.height = pos.y + dy
//     for (const shape of b.shapes) b.height = Math.max(b.height, pos.y + dy + shape[4])
//
// Water has NO collision shape. So the water under a floating bot reports its
// height as the block's BASE -- y=61 for a bot floating at y=62 -- and a
// one-block step onto shore is measured as a two-block climb:
//
//     blockC.height - block0.height = 63 - 61 = 2   ->  2 > 1.2  ->  rejected
//
// The bot is not trapped in the sense of having no moves. It has plenty. It can
// paddle around the ocean indefinitely and can never leave it, which is exactly
// what the fleet does: 21% of all bot-time in water, and only 38.1% of water
// episodes ending ashore.
//
// WHY block0 AND NOTHING ELSE. `.height` is read in six places in movements.js
// and five of them compare against `block0`, which is `getBlock(node, 0, -1, 0)`
// at every one of its five definitions -- literally "what am I standing on".
// That is the value that is wrong, so that is the only value corrected. Raising
// the height of every water block instead would make ponds look like steppable
// terrain to a bot walking past on dry land. The sixth reader,
// getMoveParkourForward, returns early on `getBlock(node,0,0,0).liquid` -- it
// refuses to parkour out of water regardless -- so it is unaffected either way.

/**
 * Should this lookup report the water's SURFACE rather than its base?
 *
 * Only for the block directly beneath the node, and only for water. Pure so the
 * decision can be tested without a world; the repo has been bitten by
 * source-greps that matched the comment explaining a rule instead of the rule.
 */
export function floatsOnTopOf ({ dx, dy, dz, name }) {
  return dx === 0 && dy === -1 && dz === 0 && name === 'water'
}

/**
 * Correct the under-foot height for a floating bot, in place, on one Movements.
 *
 * Deliberately NOT lava. Lava is in pathfinder's `liquids` set too, and telling
 * the planner a bot can casually step off a lava surface is a different and
 * much worse bug than the one being fixed.
 */
export function installShoreEgress (movements) {
  if (!movements || movements.__shoreEgress) return movements
  // NOT `.bind(movements)`, AND THIS IS LOAD-BEARING. index.mjs derives every
  // other profile with `Object.create(getPrototypeOf(moves))` plus
  // `Object.assign(derived, moves)`, which copies own properties -- so a bound
  // wrapper would travel to gatherMoves/ascendMoves/descendMoves still pointing
  // at the BASE instance, and read the base's blocksToAvoid and canDig while
  // pretending to be the derived profile. A plain function keeps `this`
  // dynamic, so the copy behaves correctly wherever it lands.
  const base = Object.getPrototypeOf(movements).getBlock
  movements.getBlock = function (pos, dx, dy, dz) {
    const b = base.call(this, pos, dx, dy, dz)
    if (b && pos && floatsOnTopOf({ dx, dy, dz, name: b.name })) {
      // The top face of the water column -- where the bot actually floats --
      // rather than the base of the block, which is where it does not.
      b.height = pos.y + dy + 1
    }
    return b
  }
  movements.__shoreEgress = true
  return movements
}
