/**
 * WHAT THE PATHFINDER IS ALLOWED TO BUILD WITH.
 *
 * mineflayer-pathfinder seeds `Movements.scafoldingBlocks` (its spelling) with
 * exactly two item ids -- dirt and cobblestone -- and `getMoveUp` refuses to
 * plan a 1x1 tower when `node.remainingBlocks === 0`. Nothing in this codebase
 * ever extended that list, so `allow1by1towers = true` was inert for a bot
 * holding anything else, and A* answered NO PATH rather than "you could climb
 * out of there".
 *
 * Measured 2026-08-31 against the 32 permanently frozen bots: 7 of 10 sampled
 * carried zero pathfinder-usable scaffold while holding plenty of blocks --
 * board-a-Bravo on 83 sand, isolated-b-Comet on 75 sand, hive-b-Comet on 24
 * andesite. `surface` succeeded 490 of 913 times above y=60 and **0 of 1,902
 * times below it**.
 *
 * FALLING BLOCKS ARE DELIBERATELY EXCLUDED, and this is the whole reason the
 * list is not simply "everything placeable". `scafoldingBlocks` is used for
 * horizontal BRIDGING as well as vertical towering, and sand or gravel placed
 * over a gap falls out from under the bot -- turning a planned bridge into a
 * fall. Straight-up pillaring with sand is perfectly safe, so `shaftAscend`
 * keeps its own wider SCAFFOLD set for that case. This list is only what A* may
 * plan a bridge with.
 */
export const PATHFINDER_SCAFFOLD = [
  'stone', 'andesite', 'diorite', 'granite', 'deepslate', 'cobbled_deepslate',
  'tuff', 'netherrack', 'sandstone', 'red_sandstone', 'dripstone_block',
  'coarse_dirt', 'rooted_dirt',
]

/** Blocks that obey gravity: never plannable as a bridge. */
export const FALLING = ['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel']

/**
 * Add every safe scaffold block to a Movements profile, in place.
 * Returns the number of ids added, so a caller can log it and a test can pin it.
 */
export function extendScaffolding (moves, registry) {
  if (!moves || !Array.isArray(moves.scafoldingBlocks) || !registry) return 0
  let added = 0
  for (const name of PATHFINDER_SCAFFOLD) {
    const item = registry.itemsByName?.[name]
    if (!item) continue
    if (moves.scafoldingBlocks.includes(item.id)) continue
    moves.scafoldingBlocks.push(item.id)
    added += 1
  }
  return added
}

/**
 * MAY THE CLIMB BREAK THE BLOCK OVERHEAD?
 *
 * Breaking a block whose neighbour is liquid floods the shaft, and that is a
 * real way to drown a climbing bot. The defect was never the rule -- it was
 * that the rule ran on EVERY step, before anything had decided to dig.
 *
 * Most steps of a pillar break nothing: the cell overhead is already air, the
 * bot jumps and places underfoot, and no neighbour can flood a shaft that was
 * never opened. Refusing those steps because water sits nearby is an opinion
 * about being near water, and it cost 561 of 566 pillar attempts below y=60
 * over 18 hours -- 99.1% -- while 32 of 80 bots stayed frozen for days behind
 * it. Same shape as the kelp widening that tripled drownings and was rolled
 * back: a water predicate answering a question nobody asked.
 *
 * So the rule keeps its full strictness and applies exactly when it is true.
 *
 * @param head  block at head+1 (the one a dig would break), or null
 * @param sides the four horizontal neighbours at that same level
 * @returns a refusal reason, or null when the step is safe
 */
export function overheadBreakRisk ({ head = null, sides = [], isLiquid = b => false } = {}) {
  // Liquid first: it has an EMPTY boundingBox, so a `solid` test would fall
  // straight through and this branch would be unreachable. Water directly
  // overhead ends the climb whatever else is true -- pillaring into it puts the
  // head under, which is the state the air reflex exists to end.
  if (head && isLiquid(head)) return `liquid overhead (${head.name})`
  const solid = !!head && head.name !== 'air' && head.boundingBox !== 'empty'
  if (!solid) return null                 // nothing will be broken; nothing can flood
  for (const s of sides) {
    if (s && isLiquid(s)) return `liquid beside the block overhead (${s.name})`
  }
  return null
}
