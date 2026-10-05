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
/**
 * NORMAL inbound position packets per 10s, measured across the fleet 2026-09-08:
 * bots that are MOVING sit at median 0, p90 1, max 1. Frozen bots run 30-67.
 * Eight is an order of magnitude above the norm and an order below the
 * pathology, which is the only kind of cutoff worth writing down.
 */
export const STOMP_POS_PKTS = 8

/**
 * IS THE SUPPORT CELL REAL, WHATEVER THE BLOCK CACHE SAYS?
 *
 * `harvestUnderfoot` refuses when the cached block under the feet is not solid.
 * Right almost always, and catastrophic in one case: mineflayer's
 * finishDigging writes AIR into the client's own world on a TIMER with no
 * server acknowledgement (digging.js:158 -- there is no acknowledge handler
 * anywhere in the library), and no API exists to re-read a block. A dig the
 * server refused poisons that cell permanently.
 *
 * Measured 2026-09-08: four bots frozen for hours with 0 successes. The server
 * says the cell under them is diorite or oak_log. Their own code says "nothing
 * solid underfoot". They see 24-46 blocks in their affordance scans, so chunk
 * data is loaded and a null read is ruled out.
 *
 * The proof is the position packets. hive-a-Bravo takes 67 per 10s against a
 * fleet norm of 0-1. That is a closed loop: the client believes the floor is
 * air, physics tries to fall, the server refuses and stomps it back, 67 times
 * every ten seconds. A bot being continuously corrected is standing on
 * something.
 *
 * BOTH SIGNALS ARE CACHE-FREE, deliberately. `restingY` is whether the feet sit
 * exactly on a block boundary -- a resting bot does, a falling one does not --
 * read from the entity position, not from any block. Using the cached support
 * flag would have asked the poisoned source to referee its own reliability.
 *
 * And this only ever votes toward TRYING. It can never introduce a refusal:
 * when the cache says solid the answer is unchanged.
 */
export function supportProbablyReal ({ cachedSolid = false, posPkts = null,
                                       restingY = false } = {}) {
  if (cachedSolid) return { real: true, why: 'cache says solid' }
  if (!restingY) return { real: false, why: 'cache says air and the feet are between blocks' }
  const n = Number(posPkts)
  if (Number.isFinite(n) && n >= STOMP_POS_PKTS) {
    return { real: true, why: `cache says air but the server is holding it up (${n} pos/10s)` }
  }
  return { real: false, why: 'cache says air and nothing contradicts it' }
}

/** Are the feet exactly on a block boundary? A resting bot is; a falling one is not. */
export function restingOnBoundary (y, eps = 1e-6) {
  // `typeof`, not Number(): Number(null) is 0, and 0 sits exactly on a boundary,
  // so a missing position would read as RESTING and could overrule the cache.
  // Same trap as pathFailureShape, hit twice in one day -- junk must never be
  // the answer that votes for action.
  if (typeof y !== 'number' || !Number.isFinite(y)) return false
  return Math.abs(y - Math.round(y)) < eps
}

export const PATHFINDER_SCAFFOLD = [
  'stone', 'andesite', 'diorite', 'granite', 'deepslate', 'cobbled_deepslate',
  'tuff', 'netherrack', 'sandstone', 'red_sandstone', 'dripstone_block',
  'coarse_dirt', 'rooted_dirt',
  // WOOD WAS MISSING, and wood is what this fleet actually carries.
  //
  // The list above is entirely stone-family. Measured across all 80 bots:
  // 81.2% already hold something on it -- so this is NOT the cause of the
  // fleet's no-legal-move events, and I am not claiming it is. But 16.2% (13
  // bots) hold WOOD and nothing else the pathfinder will accept, and for those
  // bots A* cannot plan a tower or a bridge at all. oak_log alone is carried by
  // 62 of 80 bots.
  //
  // Planks and logs are legitimate here for the same reason stone is: they do
  // not obey gravity, so a bridge built from them does not fall out from under
  // the bot. That is the ONLY property this list is about -- see FALLING below,
  // which is why sand and gravel stay off it despite being carried by 62 bots.
  'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks',
  'acacia_planks', 'dark_oak_planks', 'cherry_planks', 'mangrove_planks',
  'bamboo_planks', 'crimson_planks', 'warped_planks',
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log',
  'dark_oak_log', 'cherry_log', 'mangrove_log',
  // Common non-falling stone the list simply had not enumerated.
  'mossy_cobblestone', 'stone_bricks', 'smooth_stone', 'blackstone', 'basalt',
]

/** Blocks that obey gravity: never plannable as a bridge. */
export const FALLING = ['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel']

/**
 * DOES THIS BLOCK FALL WHEN THE CELL UNDER IT OPENS?
 *
 * `FALLING` above is the BRIDGING list -- what A* may not plan a bridge with --
 * and it is deliberately short. This is the SAFETY question, and it has to be
 * complete rather than short, because the cost of missing a member is a bot
 * buried in its own escape hole.
 *
 * A falling-block entity is not stopped by a bot. It passes through every
 * entity and every non-solid cell and materialises on top of the first solid
 * block beneath it -- which, for a bot standing on a floor, is the floor, so
 * the block lands INSIDE the bot's feet cell. `skills.mjs` already knows this:
 * `shaftAscend` waits 500ms and re-checks whenever the cell overhead is one of
 * these. Nothing in the escape ramp did, and the ramp breaks a ceiling.
 *
 * Concrete powder is here because it is a falling block that is not sand or
 * gravel and reads as neither; anvils and the dragon egg because they fall too;
 * `pointed_dripstone` and `scaffolding` because they collapse when unsupported.
 * `_concrete_powder` is matched by suffix rather than enumerating sixteen dyes,
 * which is the one place a name test here is shorter than the list it replaces.
 */
const FALLING_EXACT = new Set([
  ...FALLING, 'anvil', 'chipped_anvil', 'damaged_anvil', 'dragon_egg',
  'pointed_dripstone', 'scaffolding',
])

export function isFallingBlock (block) {
  const n = block?.name
  if (!n) return false
  return FALLING_EXACT.has(n) || n.endsWith('_concrete_powder')
}

/**
 * CAN A BOT'S BODY OCCUPY THIS CELL WITHOUT BREAKING ANYTHING?
 *
 * ONE PREDICATE, BECAUSE TWO DRIFTED. Before this existed the codebase asked
 * the question two ways: `stairUpStep` tested `boundingBox === 'empty'`, and
 * `passableFor` in reflex.mjs held a list of NAMES. They leaked in both
 * directions, and the leaks were not symmetric curiosities:
 *
 *   - lava, cobweb, vine, torch, short_grass, snow, kelp and powder_snow all
 *     report `boundingBox: 'empty'` and appear in no name list. Lava is the one
 *     that matters: the bounding-box test called a lava ceiling "already open"
 *     and let the ramp jump a bot up through it.
 *   - `leaves` reports `boundingBox: 'block'` and IS in the name list. That is
 *     the canopy dead end -- see `isEntombed`.
 *
 * So: geometry first, then two named subtractions. Lava is not a cell a body
 * may occupy, whatever the registry says its bounding box is, and cobweb is not
 * a cell a body may MOVE through -- a bot that enters one stops.
 *
 * NULL IS NOT PASSABLE. An unloaded chunk is not evidence of open sky; every
 * caller here refuses on `null` separately and says so, because "I cannot see"
 * and "it is open" are the confident zero this project keeps paying for.
 *
 * This answers a question about a BODY. It is deliberately not the same
 * question as "is this cell a wall for the purpose of deciding a bot is sealed
 * in" -- see `notAWall` in reflex.mjs, which is wider on purpose and says why.
 */
export function bodyPassable (block) {
  if (!block) return false
  if (/lava/.test(block.name ?? '')) return false
  if (block.name === 'cobweb') return false
  return block.boundingBox === 'empty' || block.name === 'air' || block.name === 'cave_air'
}

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
 * WATER, IN EVERY FORM A DIG CAN LET IN. (climbflood-01, 2026-10-05)
 *
 * A name test for `water` alone misses three ways the same water reaches a
 * bot: `flowing_water` on older registries, a bubble column, and a WATERLOGGED
 * block -- a stair, slab or fence holding a source that is released when the
 * block is broken, or that pours out of it when a neighbour opens. Kelp and
 * seagrass are water blocks that report a plant's name. prismarine-block sets
 * `isWaterlogged` from the block state (verified on 1.21.8: oak_stairs
 * waterlogged=true -> true, false -> false, stone -> undefined).
 */
const WATER_CELL = /^(water|flowing_water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/
export function isWaterCell (b) {
  if (!b) return false
  return WATER_CELL.test(b.name ?? '') || b.isWaterlogged === true
}

/**
 * LAVA, ONE CLASSIFIER. Flowing lava is `lava` with a level on 1.21, and
 * `flowing_lava` on older registries; the guard this replaced matched
 * `name === 'lava'` only (Codex, underground-safety design pass 2).
 */
export function isLavaCell (b) {
  return !!b && /lava/.test(b.name ?? '')
}

/**
 * MAY AN UPWARD DIG BREAK THIS BLOCK? -- the ONE flood check every upward dig
 * asks immediately before it breaks a block (climbflood-01).
 *
 * MEASURED 2026-10-05 (docs/reports/underground-safety-design-2026-10-05.md):
 * every one of 109 drownings in 72 h was a sealed pocket, and the largest single
 * way in (30 deaths, 28% of drownings) was the bot's OWN escape climb breaking
 * the block over its head. `pillarOut` and `digStraightUp` never asked this;
 * the escape ramp's ceiling breach ignored water; and the skill climb that did
 * ask read the target and its four sides but NOT THE CELL ABOVE IT -- which is
 * exactly the face that opens when the bot breaks into the bottom of a pocket.
 *
 * `at(dx, dy, dz)` is relative to THE BLOCK TO BE BROKEN, so every caller --
 * the pillar's head cell, the ramp's ceiling, a ramp step cell, the gravel
 * resting on a ceiling -- asks the same question about the same neighbourhood.
 * It reads:
 *   - the target itself;
 *   - the cell ABOVE it (0,1,0), which is new;
 *   - its four horizontal sides;
 *   - when the target or the cell above it is a FALLING block, the cell that
 *     then opens above that (0,2,0) and its four sides, and the four sides of
 *     the falling block above -- a falling column leaves its cells open behind
 *     it, so their faces become faces of the shaft.
 *
 * WATER, LAVA, UNKNOWN. Water in any form refuses (see `isWaterCell`); lava in
 * any form always refuses; an unloaded cell (null) refuses, because "I cannot
 * see" and "it is dry" are the confident zero this project keeps paying for.
 *
 * THE SUBMERGED EXEMPTION IS KEPT, FOR WATER ONLY. A bot whose feet AND head
 * are already in water may still dig toward air: the guard protects a state it
 * no longer has, and forbidding the only way out is the dead end measured on
 * 2026-09-07 (see below). Lava still refuses: water meeting lava is a new harm.
 *
 * NOTHING CHANGES FOR A DRY BOT WHOSE OVERHEAD IS DRY, and a step that breaks
 * nothing asks nothing: most steps of a pillar break nothing, and refusing them
 * because water sits nearby cost 561 of 566 pillar attempts below y=60 over 18
 * hours (99.1%) while 32 of 80 bots stayed frozen for days. The rule applies
 * exactly when a block is about to be broken.
 *
 * @param at        (dx,dy,dz) -> block, relative to the block to be broken
 * @param submerged the digging bot's feet AND head cells are water
 * @returns a refusal reason, or null when the dig may go ahead
 */
export function overheadBreakRisk ({ at = () => null, submerged = false } = {}) {
  const wet = b => isWaterCell(b) && !submerged
  const target = at(0, 0, 0)
  if (!target) return 'terrain not loaded at the block overhead'
  // A FLOOD GUARD MUST NOT FIRE WHEN THE BOT IS ALREADY FLOODED.
  //
  // The rule is right for a bot with its head in air: digging into water puts
  // the head under, which is the state the air reflex exists to end. For a bot
  // ALREADY fully submerged it forbids the only way out, to prevent a
  // transition into the state it is already in. Measured 2026-09-07: a
  // submerged sealed bot gets ZERO moves from A* (mineflayer-pathfinder refuses
  // every vertical move from a liquid node, and `canDig = false` makes
  // safeToBreak refuse every horizontal one), a refusal from this guard, and
  // `surface_swim` from a lattice branch that assumes it is floating. 23.8% of
  // all pathfinding failures on the fleet were bots in exactly this state.
  //
  // LAVA STILL REFUSES, ALWAYS. Breaking into lava from water is a NEW harm --
  // the two meet, and the bot is standing where they meet.
  if (isLavaCell(target) || wet(target)) return `liquid overhead (${target.name})`
  // A WATERLOGGED BLOCK IS STILL A BLOCK (Codex r1): it is broken, so its
  // neighbours are read like any other -- a submerged bot breaking waterlogged
  // stairs beside lava must be refused for the lava.
  const solid = target.name !== 'air' && target.boundingBox !== 'empty'
  if (!solid) return null                 // nothing will be broken; nothing can flood
  const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  const faces = [[0, 1, 0, 'above'], ...SIDES.map(([x, z]) => [x, 0, z, 'beside'])]
  const above = at(0, 1, 0)
  if (isFallingBlock(target) || isFallingBlock(above)) {
    // A FALLING COLUMN OPENS THE CELLS IT LEAVES. Gravel above the ceiling
    // drops through the hole into the bot's own cells, and whatever sat on the
    // gravel -- water, in the measured case -- follows it down.
    faces.push([0, 2, 0, 'over the falling block above'],
               ...SIDES.map(([x, z]) => [x, 2, z, 'over the falling block above']),
               ...SIDES.map(([x, z]) => [x, 1, z, 'beside the falling block above']))
  }
  for (const [x, y, z, where] of faces) {
    const c = at(x, y, z)
    if (!c) return `terrain not loaded ${where} the block overhead`
    if (isLavaCell(c) || wet(c)) return `liquid ${where} the block overhead (${c.name})`
  }
  return null
}

/**
 * WHERE ELSE COULD THIS COLUMN HAVE BEEN?
 *
 * `overheadBreakRisk` is the one authority and is asked verbatim. What was missing is the
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
      const risk = overheadBreakRisk({ at: (dx, dy, dz) => at(x + dx, 2 + dy, z + dz) })
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

/**
 * THE ONE ASCENT THAT COSTS NOTHING: A WALKABLE RAMP.
 *
 * Every way out of a hole this codebase owns spends an item the trapped bot
 * has not got. `pillarOut` places blocks. `shaftAscend` places blocks.
 * `digStraightUp` opens a ceiling the bot then cannot climb without blocks, and
 * refuses outright without a spare pickaxe. `harvestAdjacent` -- the routine
 * that was supposed to MAKE the blocks -- skips every stone-class neighbour at
 * its `canHarvest` line, correctly, because bare-handed stone drops nothing.
 * Measured over a full walk of the fleet logs (37,778 parsed failures), 71.4%
 * of its failures are exactly that shape: eight neighbours offered, eight in
 * the vocabulary, none harvestable by an empty hand.
 *
 * So the deadlock is a MATERIALS deadlock, and the way out of a materials
 * deadlock is a move that needs no materials.
 *
 * A 1:1 staircase is that move. Break the two cells above the block one step
 * ahead, and walk up into them. Nothing is placed, so no inventory is required;
 * nothing is collected, so dropping nothing is not a failure. `digbudget.mjs`
 * already wrote down the fact this rests on -- "BREAKING BY HAND IS THE POINT.
 * Stone and deepslate broken bare-handed drop NOTHING, and that is fine -- a
 * climb wants the hole, not the cobble." The fleet has had bare-handed digging,
 * and it has had walkable staircases (`mine` cuts one, downward), since before
 * these bots were stuck. It has never had the two combined pointing UP.
 *
 * THE ASYMMETRY WITH `mine`'s DESCENDING STAIR IS DELIBERATE AND IS THE WHOLE
 * SAFETY ARGUMENT. Descending, the dangerous cell is the FLOOR -- break it over
 * a cave and the bot falls, which is why `mine` carries a hollow-floor probe.
 * Ascending, the floor is the tread the bot is about to stand on, and this
 * refuses unless it is ALREADY solid, so there is no fall vector to probe for.
 * What ascending opens instead is the two cells the bot WALKS INTO, which is
 * why lava is checked on their faces the way `dryColumnStep` checks a walk and
 * not the way `harvestSafe` checks a cell nobody enters.
 *
 * WATER IS NOT A REFUSAL HERE, and that is not an oversight. "Swimming is
 * travel, not danger" is a standing owner directive; widening a wet predicate
 * multiplied drownings sevenfold on 2026-08-29, and a global reflex demotion
 * multiplied them 7.5x; and `mine`'s stair bearing meeting its own water check
 * is one of the four named cases where two individually-correct guards left the
 * bot no legal move. A water cell is simply passable -- there is nothing to
 * break -- and a water TREAD is refused for the one honest reason that it
 * cannot be stood on, which is a standability fact and not an opinion about
 * water. Wetness only ever ORDERS the cardinals; see `chooseStairUpBearing`.
 *
 * @param at       (dx,dy,dz) -> block, relative to the bot's FEET
 * @param bear     {x,z} unit cardinal the stair runs along
 * @param canBreak (block) -> bool: may a bare hand clear this in useful time?
 *                 Defaults to yes; the reflex passes digbudget's `planDig`, so
 *                 bedrock and obsidian are refused by the registry's own
 *                 numbers rather than by a hand-kept list here.
 * @returns {{ok: true, dig: number[][]}} with the cells to break, head first,
 *          or {{ok: false, reason: string}}
 */
export function stairUpStep ({
  at = () => null,
  bear = { x: 0, z: 0 },
  isLava = b => /lava/.test(b?.name ?? ''),
  canBreak = () => true,
  submerged = false,
} = {}) {
  const passable = bodyPassable
  const solid = b => !!b && b.boundingBox === 'block'
  const bx = bear?.x ?? 0, bz = bear?.z ?? 0
  if (!bx && !bz) return { ok: false, reason: 'no bearing' }

  // The bot's own headroom. A jump-up needs feet+2 free; without it the bot
  // cuts a perfect step and then head-butts its own ceiling forever, which is
  // the exact shape of the "dug the tread and never took it" failure `mine`
  // has already paid for once.
  const over = at(0, 2, 0)
  if (!passable(over)) return { ok: false, reason: `no headroom to climb (${over?.name ?? 'unknown'})` }

  const tread = at(bx, 0, bz)
  const feet = at(bx, 1, bz)
  const head = at(bx, 2, bz)
  // THE THIRD CELL IS THE ONE THAT MAKES THE RAMP A RAMP AND NOT ONE STEP.
  //
  // The first version of this cut two cells -- the new feet and the new head --
  // and it stalled after exactly one step in solid rock, every time. The reason
  // is that the headroom check above is asked at the bot's CURRENT column, and
  // after a step that column is the one this step never opened: standing at
  // `bear + y`, `at(0,2,0)` resolves to `bear + 3y`, which two cells leave as
  // untouched stone. So the ramp cut a perfect step, climbed it, and then
  // refused itself for want of the cell it had just declined to dig.
  //
  // That is the same defect `pillarOut` records under a different name -- one
  // block placed per invocation, ninety minutes in the hole -- and it is worth
  // naming because it is invisible to a single-step test. Only a RUNWAY over
  // several steps can see it, which is why `stairUpRunway` exists and why it is
  // tested to four rather than to one.
  const clearance = at(bx, 3, bz)

  // UNKNOWN TERRAIN CLOSES THIS BEARING, NEVER THE CAPABILITY. A null block is
  // an unloaded chunk, and digging into one is a decision made on no evidence.
  // Refusing costs nothing here because three other cardinals remain -- and if
  // all four refuse, the caller is left in precisely the state it was already
  // in. This routine can subtract no option the bot had before it.
  if (!tread || !feet || !head || !clearance) return { ok: false, reason: 'terrain not loaded' }

  // LAVA CLOSES THE STEP. Water beside your feet is harmless; lava beside your
  // feet burns, and fire is 12% of fleet deaths at 1.47 per bot per day. The
  // three upper cells are ones the bot ENTERS or jumps through, so their faces
  // are checked the way `dryColumnStep` checks a walk -- not the way
  // `harvestSafe` checks a cell the bot only ever reaches into.
  const FACES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]
  for (const [cell, dy, what] of [[tread, 0, 'tread'], [feet, 1, 'step'],
                                  [head, 2, 'step headroom'], [clearance, 3, 'jump clearance']]) {
    if (isLava(cell)) return { ok: false, reason: `lava in the ${what} (${cell.name})` }
    if (dy === 0) continue                    // the tread is stood on, never entered
    for (const [nx, ny, nz] of FACES) {
      const n = at(bx + nx, dy + ny, bz + nz)
      if (isLava(n)) return { ok: false, reason: `lava against the ${what} (${n.name})` }
    }
  }

  // NO FALL VECTOR, BY REFUSAL. The tread must ALREADY be solid: this routine
  // never breaks a floor and never steps into a cell it has not proved has one.
  if (!solid(tread)) return { ok: false, reason: `no tread to stand on (${tread.name})` }

  // TOP DOWN. `mine` learned this on the way down and it is the same fact going
  // up: a falling-block column over an already-open cell pours gravel into the
  // space the bot is about to occupy, so the highest cell is cleared first and
  // whatever falls, falls before the bot is under it.
  const dig = []
  for (const [cell, dy, what] of [[clearance, 3, 'jump clearance'], [head, 2, 'headroom'], [feet, 1, 'step']]) {
    if (passable(cell)) continue
    if (!canBreak(cell)) return { ok: false, reason: `cannot clear ${cell.name} in the ${what} by hand` }
    // EVERY RAMP DIG ASKS THE SAME FLOOD CHECK as the pillar and the ceiling
    // breach (climbflood-01). A step cell with water above or beside it floods
    // the step and then the bot's own column -- the delayed entry by the ramp
    // that a 20 s breach window cannot see. Only a cell this step BREAKS is
    // asked: water IN a step is passable and swum through, never a refusal.
    const risk = overheadBreakRisk({ at: (x, y, z) => at(bx + x, dy + y, bz + z), submerged })
    if (risk) return { ok: false, reason: `flood risk in the ${what}: ${risk}`, flood: true, cell: [bx, dy, bz] }
    dig.push([bx, dy, bz])
  }
  return { ok: true, dig }
}

/**
 * How many consecutive steps a ramp from here along `bear` could cut, capped at
 * `depth`. `mine`'s `stairRunway` replayed upward: nothing is dug and nothing
 * moves, and at step i the bot stands at `bear * i` and `y + i`.
 *
 * A bearing that dies at its first step has only moved the refusal one cell
 * along, which is why the chooser ranks on this before anything else.
 */
export function stairUpRunway ({ at = () => null, bear, depth = 4, ...opts } = {}) {
  // A PLAN MUST SEE ITS OWN EXCAVATION, and getting this wrong reads as the
  // ramp being impossible rather than as the lookahead being wrong. Step i+1
  // stands where step i has already cut three cells; a replay against the
  // UNTOUCHED world asks step 2 for headroom in the cell step 1 was about to
  // clear, finds stone, and reports a runway of 1 through open rock. The first
  // version of this did exactly that, and the symptom was every bearing
  // scoring 1 -- an instrument that could not have seen a longer run.
  const opened = new Set()
  const AIR = { name: 'air', boundingBox: 'empty' }
  const bx = bear?.x ?? 0, bz = bear?.z ?? 0
  const seen = (dx, dy, dz) => (opened.has(`${dx},${dy},${dz}`) ? AIR : at(dx, dy, dz))
  let n = 0
  for (let i = 0; i < depth; i++) {
    const from = (dx, dy, dz) => seen(bx * i + dx, i + dy, bz * i + dz)
    const step = stairUpStep({ ...opts, at: from, bear })
    if (!step.ok) break
    for (const [dx, dy, dz] of step.dig) opened.add(`${bx * i + dx},${i + dy},${bz * i + dz}`)
    n++
  }
  return n
}

/**
 * How many water faces the ramp would touch along `bear`.
 *
 * A TIE-BREAK, NOT A GUARD -- the same role, and deliberately the same wording,
 * as `stairFlowRisk` in skills.mjs. The distinction is load bearing. As a veto,
 * a water test refused 561 of 566 pillar attempts below y=60 and kept 32 bots
 * frozen for days. As an ORDERING it costs nothing: where two cardinals both
 * run the full depth the drier one is chosen, and where only a wet one runs at
 * all the bot still climbs. This function can never add a refusal, and the
 * chooser must never let it.
 */
export function stairUpWetness ({ at = () => null, bear, depth = 4,
                                  isWater = b => b?.name === 'water', ...opts } = {}) {
  let wet = 0
  const n = stairUpRunway({ at, bear, depth, ...opts })
  for (let i = 0; i < n; i++) {
    for (const dy of [1, 2, 3]) {
      if (isWater(at((bear?.x ?? 0) * (i + 1), i + dy, (bear?.z ?? 0) * (i + 1)))) wet++
    }
  }
  return wet
}

/**
 * WHICH WAY THE ESCAPE RAMP SHOULD RUN.
 *
 * `bearings` arrives already in the caller's preference order -- the reflex
 * passes the way the bot is facing first, then the two ninety-degree turns,
 * then the reverse, exactly as `stairBearings` does for the descent. Ranked
 * lexicographically:
 *
 *   1. the longest RUNWAY, because a bearing that dies in one step has only
 *      moved the refusal;
 *   2. then the fewest WATER faces, which is a preference and never a veto;
 *   3. then the order given, so a bot already facing a usable direction does
 *      not turn for nothing and the ramp stays predictable.
 *
 * Returns `{ bear, runway, wet }`, with `runway === 0` meaning every cardinal
 * refused its first step. That is a fact about where the bot is standing, and
 * the caller reports it rather than acting on it.
 */
export function chooseStairUpBearing ({ at = () => null, bearings = [], depth = 4, ...opts } = {}) {
  let best = null
  for (const bear of bearings) {
    const runway = stairUpRunway({ at, bear, depth, ...opts })
    const wet = runway === 0 ? 0 : stairUpWetness({ at, bear, depth, ...opts })
    if (!best || runway > best.runway || (runway === best.runway && wet < best.wet)) {
      best = { bear, runway, wet }
    }
  }
  return best
}

/**
 * OPEN YOUR OWN CEILING, SO THE RAMP HAS A FIRST STEP.
 *
 * THIS EXISTS BECAUSE THE RAMP AND THE TRAP DISAGREE ABOUT ONE CELL, AND IT IS
 * THE SAME CELL.
 *
 * `stairUpStep` refuses unless `at(0, 2, 0)` -- the bot's own headroom -- is
 * passable, and it is right to: a bot without it cuts a perfect step and then
 * head-butts its own ceiling forever. `isEntombed` in reflex.mjs is DEFINED by
 * that cell being solid; it is the first thing it tests and the only condition
 * its own comment calls load bearing. The two are exact complements, so wiring
 * the ramp into the entombment handler without this is not a weak fix, it is a
 * no-op: every cardinal refuses `no headroom to climb`, in every world, always.
 *
 * Measured on the built tree before this function existed, against a 1x1 stone
 * pocket that `isEntombedForTest` calls entombed: all four bearings refused and
 * `chooseStairUpBearing` returned `runway: 0`. Removing this ONE cell and
 * changing nothing else took the same world to `runway: 4`. That is the whole
 * distance between the rescue and the bots it was written for, which is why the
 * fix is one more cell of control flow and not a wider predicate somewhere.
 *
 * ONE CELL, AND NOTHING PLACED. The materials argument the ramp rests on
 * survives intact: breaking the cell overhead costs no item, and dropping
 * nothing is not a failure when what is wanted is the hole. A bot that could
 * not afford to pillar can still afford this. A first step that had to spend
 * something would be the same deadlock wearing a different name.
 *
 * DOING NOTHING IS A PLAN. When the headroom is already open this returns
 * `{ok: true, dig: []}` rather than a refusal, because "there is nothing to
 * break" and "I cannot break it" are different worlds and a caller that folds
 * them together rebuilds the confident zero this project keeps paying for. The
 * maroon branch runs with `upIsOpen` true and takes exactly that path, so this
 * changes its behaviour by nothing at all.
 *
 * @param at       (dx,dy,dz) -> block, relative to the bot's FEET
 * @param canBreak (block) -> bool: may a bare hand clear this in useful time?
 * @returns {{ok: true, dig: number[][]}} | {{ok: false, reason: string}}
 */
// The parameter ORDER here is deliberately not `stairUpStep`'s. That function's
// `isLava`/`canBreak` pair is the anchor escape-stair.test.mjs mutates to prove
// the lava check has not been widened into a liquid check, and `withMutant`
// asserts its anchor is UNIQUE. Two identically-shaped signatures in one file
// make that anchor ambiguous and turn a real guard into an error about itself.
export function headroomBreach ({
  at = () => null,
  canBreak = () => true,
  isLava = b => /lava/.test(b?.name ?? ''),
  isFalling = isFallingBlock,
  submerged = false,
} = {}) {
  const passable = bodyPassable
  const over = at(0, 2, 0)
  const above = at(0, 3, 0)
  // UNKNOWN TERRAIN IS NOT AN OPEN CEILING. A null block is an unloaded chunk,
  // and calling it open would send the ramp on to refuse for a reason naming
  // the wrong cell -- the failure mode where the instrument answers uniformly.
  if (!over) return { ok: false, reason: 'terrain not loaded overhead' }
  // ...AND THE CELL ABOVE THE CEILING IS NOW LOAD BEARING TOO, so not seeing it
  // is a refusal for the same reason. See the gravel argument below.
  if (!above) return { ok: false, reason: 'terrain not loaded above the ceiling' }

  // LAVA OVERHEAD IS A REFUSAL, and getting this wrong was a way to burn a bot.
  //
  // An earlier version reasoned that lava reports an EMPTY boundingBox, so a
  // lava ceiling "has already answered nothing to break" -- true of the
  // arithmetic and false of the bot, because the ramp's first move is a jump
  // and the cell it jumps THROUGH is exactly this one. `bodyPassable` is the
  // fix: a body may not occupy lava whatever the registry says its bounding box
  // is, so the cell reads as closed and is refused here by name rather than
  // being silently climbed into. Fire is 12% of fleet deaths at 1.47 per bot
  // per day; there is no version of this where jumping into it is the move.
  if (isLava(over)) return { ok: false, reason: `lava overhead (${over.name})` }
  if (passable(over)) {
    // NOTHING TO BREAK -- unless something is on its way down into it. Gravel
    // resting on an OPEN cell is a column mid-fall, and the honest answer is
    // "wait", not "go". `shaftAscend` has taken the same 500ms and re-checked
    // since long before this function existed.
    if (isFalling(above)) {
      return { ok: false, reason: `a falling column is settling overhead (${above.name})` }
    }
    return { ok: true, dig: [] }
  }

  // LAVA ABOVE THE CEILING IS THE ONE WAY THIS CAN KILL BY FIRE, and it is the
  // only refusal here about heat rather than arithmetic. Breaking the cell
  // overhead is the one moment a column of lava resting on it gets a route down
  // onto the bot's head. So the faces of the cell about to be opened are
  // checked the way `stairUpStep` checks a cell the bot enters.
  //
  // Water is not consulted HERE. Swimming is travel, and widening a wet
  // predicate multiplied drownings sevenfold on 2026-08-29. Whether a cell may
  // be BROKEN is asked once, below, of the shared flood check every upward dig
  // uses (climbflood-01) -- never as an opinion about being near water.
  for (const [nx, ny, nz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
    const n = at(nx, 2 + ny, nz)
    if (isLava(n)) return { ok: false, reason: `lava against the ceiling (${n.name})` }
  }

  // GRAVEL ABOVE THE CEILING IS THE OTHER WAY THIS CAN KILL, and it kills more
  // quietly, which is why it was missed.
  //
  // A falling-block entity is not stopped by a bot -- it passes through every
  // entity and every non-solid cell and materialises on top of the first SOLID
  // block below. The bot stands on its floor at (0,-1,0), so a gravel column
  // released at (0,3,0) does not stop at the opened ceiling: it lands in
  // (0,0,0), the bot's own feet cell, and a three-block column fills (0,0,0),
  // (0,1,0) and (0,2,0). That is suffocation at 1 HP per half-second -- dead in
  // about ten seconds -- inside a routine that holds the body for up to a
  // minute. More entombed than before, which makes it strictly worse than the
  // no-op this replaced.
  //
  // TOP DOWN, THE SAME ANSWER `stairUpStep` ALREADY GIVES. The cell above is
  // taken FIRST, while the ceiling still holds the rest of the column up, so
  // whatever falls lands on the intact ceiling and not on the bot. The caller
  // re-plans after each swing and only reaches the ceiling once (0,3,0) is
  // stable, which is what makes a column of any depth safe rather than only a
  // single block.
  // THE ONE FLOOD CHECK, ON THE CELL THIS WILL ACTUALLY BREAK (climbflood-01).
  // Without it the ramp re-breached the very ceiling the pillar had just
  // refused (Codex, design pass 2): "else ramp" was the same dig by another
  // name. `flood: true` lets the reflex tell this refusal from arithmetic.
  const floodAt = (dy) => overheadBreakRisk({ at: (x, y, z) => at(x, dy + y, z), submerged })
  if (isFalling(above)) {
    if (!canBreak(above)) {
      return { ok: false, reason: `cannot clear the ${above.name} resting on the ceiling by hand` }
    }
    const risk = floodAt(3)
    if (risk) return { ok: false, reason: `flood risk: ${risk}`, flood: true, cell: [0, 3, 0] }
    return { ok: true, dig: [[0, 3, 0]], settling: true }
  }

  // The registry's own numbers decide, not a hand-kept list: bedrock and
  // obsidian are refused here for the same reason, and through the same
  // function, that refuses them inside the ramp.
  if (!canBreak(over)) return { ok: false, reason: `cannot clear ${over.name} overhead by hand` }
  const risk = floodAt(2)
  if (risk) return { ok: false, reason: `flood risk: ${risk}`, flood: true, cell: [0, 2, 0] }
  return { ok: true, dig: [[0, 2, 0]] }
}

/**
 * LEAVE THE CELL SIDEWAYS, SO THE RAMP HAS A DRY CEILING TO START UNDER. (climbflood-01, Codex r1)
 *
 * The escape ramp's first move is a jump, and a jump needs the bot's OWN ceiling open: `stairUpStep` refuses without
 * `at(0,2,0)` and `headroomBreach` exists to take it. When the flood check refuses that ceiling -- a pocket of water
 * over it, the design's scene A -- every bearing is unreachable from here, so "else ramp" was no move at all and the
 * bot could only wait. The design's own scene table expects A to exit dry by ramp and reserves "stays dry" for C,
 * where every bearing is wet; this is the one cell of control flow between the two.
 *
 * ONE STEP SIDEWAYS, ONLY TO A COLUMN THE SAME CHECK ALREADY ALLOWS. The step is taken only when:
 *   - the tread under the new cell is a solid, dry block (no fall, never a liquid floor);
 *   - the two cells the bot walks into are loaded, dry, and have no lava on any face;
 *   - each of them that must be dug passes `canBreak` and the shared flood check, read for THAT cell;
 *   - the new column's own ceiling is open and dry, or would itself pass the flood check -- otherwise the step only
 *     moves the refusal one cell over (scene C: the whole column above is wet, so no bearing qualifies and the bot
 *     stays where it is, dry).
 * Water is never walked into here: this exists to keep a dry bot dry, not to swim.
 *
 * @param at   (dx,dy,dz) -> block, relative to the bot's FEET
 * @param bear {x,z} unit cardinal
 * @returns {{ok: true, dig: number[][]}} (cells to break, top first) | {{ok: false, reason, flood?}}
 */
export function floodSidestep ({ at = () => null, bear = { x: 0, z: 0 }, canBreak = () => true, submerged = false } = {}) {
  const bx = bear?.x ?? 0, bz = bear?.z ?? 0
  if (!bx && !bz) return { ok: false, reason: 'no bearing' }
  const tread = at(bx, -1, bz), feet = at(bx, 0, bz), head = at(bx, 1, bz), ceil = at(bx, 2, bz)
  if (!tread || !feet || !head || !ceil) return { ok: false, reason: 'terrain not loaded' }
  if (tread.boundingBox !== 'block' || isWaterCell(tread) || isLavaCell(tread)) {
    return { ok: false, reason: `no dry floor to step onto (${tread.name})` }
  }
  const FACES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]
  const dig = []
  for (const [cell, dy, what] of [[head, 1, 'head'], [feet, 0, 'feet']]) {
    if (isWaterCell(cell) && cell.boundingBox === 'empty') return { ok: false, reason: `water in the ${what} cell (${cell.name})` }
    if (isLavaCell(cell)) return { ok: false, reason: `lava in the ${what} cell` }
    for (const [nx, ny, nz] of FACES) {
      const n = at(bx + nx, dy + ny, bz + nz)
      if (isLavaCell(n)) return { ok: false, reason: `lava against the ${what} cell (${n.name})` }
    }
    if (bodyPassable(cell)) continue
    if (!canBreak(cell)) return { ok: false, reason: `cannot clear ${cell.name} in the ${what} cell by hand` }
    const risk = overheadBreakRisk({ at: (x, y, z) => at(bx + x, dy + y, bz + z), submerged })
    if (risk) return { ok: false, reason: `flood risk in the ${what} cell: ${risk}`, flood: true }
    dig.push([bx, dy, bz])
  }
  // THE NEW COLUMN MUST BE ONE THE RAMP CAN START UNDER.
  if (isWaterCell(ceil) || isLavaCell(ceil)) return { ok: false, reason: `liquid over the side cell (${ceil.name})`, flood: true }
  if (!bodyPassable(ceil)) {
    if (!canBreak(ceil)) return { ok: false, reason: `cannot clear ${ceil.name} over the side cell by hand` }
    const risk = overheadBreakRisk({ at: (x, y, z) => at(bx + x, 2 + y, bz + z), submerged })
    if (risk) return { ok: false, reason: `the side column floods too: ${risk}`, flood: true }
  }
  return { ok: true, dig }
}

/** The first bearing (in the caller's preference order) `floodSidestep` allows, or why none did. */
export function chooseFloodSidestep ({ at = () => null, bearings = [], ...opts } = {}) {
  const why = []
  for (const bear of bearings) {
    const r = floodSidestep({ at, bear, ...opts })
    if (r.ok) return { ok: true, bear, dig: r.dig }
    why.push(r)
  }
  return { ok: false, reason: why.map(r => r.reason).join('; ') || 'no bearing', flood: why.some(r => r.flood) }
}
