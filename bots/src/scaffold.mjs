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
  // Water is not consulted at all. Swimming is travel, and widening a wet
  // predicate multiplied drownings sevenfold on 2026-08-29.
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
  if (isFalling(above)) {
    if (!canBreak(above)) {
      return { ok: false, reason: `cannot clear the ${above.name} resting on the ceiling by hand` }
    }
    return { ok: true, dig: [[0, 3, 0]], settling: true }
  }

  // The registry's own numbers decide, not a hand-kept list: bedrock and
  // obsidian are refused here for the same reason, and through the same
  // function, that refuses them inside the ramp.
  if (!canBreak(over)) return { ok: false, reason: `cannot clear ${over.name} overhead by hand` }
  return { ok: true, dig: [[0, 2, 0]] }
}
