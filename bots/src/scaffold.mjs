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

/**
 * WHERE ELSE COULD THIS COLUMN HAVE BEEN?
 *
 * `overheadBreakRisk` is right and stays untouched. What was missing is the
 * next sentence. A refusal ended `shaftAscend` outright, the skill reported
 * `liquid beside the block overhead (water)`, and the advice line told the
 * MODEL to "walk a few blocks away from the water" -- a deterministic move
 * handed to a decision loop that never made it.
 *
 * Measured 2026-09-01 over a full walk of every skill log: 262 such refusals,
 * all water and no lava, across 9 bots, and EVERY bot pinned to one or two
 * cells. board-c-Alpha stopped 71 times from exactly (1394, 44, 346);
 * isolated-a-Delta 66 times from (542, 7, 220); placebo-b-Delta 81 times from
 * (421, 44, -307). The guard refuses, the climb returns, the model re-proposes
 * `surface`, and the bot digs at the same wet ceiling forever. Nothing in the
 * loop ever tries a different column, so the correct refusal has become a
 * permanent trap.
 *
 * THIS DOES NOT MAKE A BOT MORE WILLING TO BE NEAR WATER, which is the failure
 * mode this project has paid for twice -- the kelp widening that tripled
 * drownings and the global reflex demotion that multiplied them 7.5x. It only
 * answers "which nearby column would the UNCHANGED guard already say yes to",
 * and every candidate must satisfy the same rule verbatim. The bot ends up
 * further from the water than it started, never closer, and the ceiling it
 * eventually breaks has no liquid beside it -- exactly the invariant the guard
 * has always enforced.
 *
 * The corridor must be dry AND walkable end to end. `clear` rejects liquid at
 * head and foot rather than treating it as swimmable: this is a walk, not a
 * swim, and a bot that wades sideways to reach a ladder has taken on a risk the
 * climb never needed. `standable` rejects a liquid floor for the same reason
 * and a missing one because a hole is a fall.
 *
 * LAVA CLOSES AN AXIS RATHER THAN SKIPPING A CELL. Water beside your feet is
 * harmless -- believing otherwise is the exact opinion that cost 99.1% of
 * pillar attempts -- but lava beside your feet burns, and a cell past lava can
 * only be reached by walking beside it. board-c-Alpha's own perception scan
 * reported 27 lava blocks at the frozen cell, so this is not hypothetical.
 *
 * @param at        (dx,dy,dz) -> block, relative to the bot's FEET
 * @param maxOut    how far along one axis to look; the walk is straight-line
 * @returns {dx,dz,dist} the nearest column the guard already allows, or null
 */
export function dryColumnStep ({
  at = () => null,
  isLiquid = () => false,
  isLava = b => /lava/.test(b?.name ?? ''),
  maxOut = 4,
} = {}) {
  const clear = b => !!b && !isLiquid(b) && b.boundingBox === 'empty'
  const standable = b => !!b && !isLiquid(b) && b.boundingBox === 'block'
  const AXES = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  let best = null
  for (const [ax, az] of AXES) {
    for (let d = 1; d <= maxOut; d++) {
      const x = ax * d, z = az * d
      if (!clear(at(x, 0, z)) || !clear(at(x, 1, z))) break   // wall or liquid: axis closed
      if (!standable(at(x, -1, z))) break                     // hole or liquid floor
      if (AXES.some(([sx, sz]) => isLava(at(x + sx, 0, z + sz)) || isLava(at(x + sx, 1, z + sz)))) break
      // THE ONE AUTHORITY. A candidate is dry because the shipped guard says
      // so, not because this function has its own opinion about water.
      const risk = overheadBreakRisk({
        head: at(x, 2, z),
        sides: AXES.map(([sx, sz]) => at(x + sx, 2, z + sz)),
        isLiquid,
      })
      if (risk) continue                                      // wet here too; keep walking
      if (!best || d < best.dist) best = { dx: ax, dz: az, dist: d }
      break
    }
  }
  return best
}

/**
 * MAY THE SELF-SOURCING DIG OPEN THIS CELL BELOW THE FEET?
 *
 * `harvestAdjacent` gained four DIAGONAL-DOWN offsets so a bot on flat ground
 * can reach the only solid blocks near it. Digging one does not drop the bot --
 * its own support block is deliberately not in the offset set -- but it does
 * OPEN A NEW CELL at foot-1 level, one block from where the bot is standing.
 * If lava sits against that cell it now flows into it, and its surface ends up
 * flush with the bot's feet. Fire is 12% of fleet deaths at 1.47 deaths per bot
 * per day, and this routine runs precisely when a bot is stuck and out of
 * options -- the worst moment to open a new lava vector.
 *
 * THE ASYMMETRY IS THE POINT, and it is `dryColumnStep`'s, not a new one:
 * water beside your feet is harmless -- believing otherwise is the exact
 * opinion that refused 561 of 566 pillar attempts, 99.1%, and kept 32 bots
 * frozen for days -- but lava beside your feet burns. So this tests for LAVA
 * ONLY. A liquid predicate here would be the kelp widening again.
 *
 * WHAT THIS IS NOT. `dryColumnStep` closes an AXIS because it is planning a
 * walk and a cell past lava can only be reached by walking beside it. There is
 * no walk here: each offset is an independent cell the bot digs from where it
 * already stands and never enters. So the refusal is per-cell, and that is a
 * deliberate departure from the shape rather than an oversight.
 *
 * @param at      (dx,dy,dz) -> block, relative to the bot's FEET
 * @param dx,dy,dz the candidate cell
 * @returns a refusal reason, or null when the dig is safe
 */
export function harvestSafe ({
  at = () => null,
  dx = 0, dy = 0, dz = 0,
  isLava = b => /lava/.test(b?.name ?? ''),
} = {}) {
  const here = at(dx, dy, dz)
  if (isLava(here)) return `lava in the cell itself (${here.name})`
  // The six faces of the candidate. [0,1,0] is the foot-level cell above it, so
  // lava the bot is already standing beside closes this offset too -- that is
  // the case where the dig would let it pour DOWN into the new hole.
  for (const [nx, ny, nz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
    const b = at(dx + nx, dy + ny, dz + nz)
    if (isLava(b)) return `lava against the block below (${b.name})`
  }
  return null
}
