// THE CHEST LID (lidclear-01). Pure: no bot, no world reads -- skills.mjs clearChestLid reads the cells and digs.
//
// WHY (measured 10-16, docs/reports/lidclear-2026-10-16.md): 7 of 16 pools' `count_town` rows failed `lid_blocked`
// (placebo-b 357 of 360 in 24 h, hive-a 91/105, board-a 76/92, board-b 53/57, placebo-c 33/67, hive-c 18/24, board-c
// 6/21). A town container that is never opened keeps the town's stock UNKNOWN, and cobblecap.mjs admits nothing until
// every container has a fresh count -- so ONE blocked lid closes the whole town's cobble bank at any cap. The offline
// census (region files, 13 worlds, 277 town containers, a double chest counted once) found 18 lid-blocked containers in 7
// worlds, and the block on EVERY one of the 18 is cobblestone: bot-placed (the chests are bot-placed, and nothing
// generates cobblestone on top of one). Two independent defects kept them blocked:
//   1. THE RECOUNT never tried: reconcileCobble failed a lid-blocked chest before walking to it (`lid blocked`).
//   2. THE DEPOSIT'S AND THE WITHDRAW'S CLEAR normally timed out without a pickaxe in hand: bot.dig does not equip, a bare
//      hand breaks dry, grounded cobblestone in 10,000 ms (hardness 2 x 5, prismarine-block digTime; wooden pickaxe 1,500,
//      stone 750), and both sites raced the dig -- whose timer starts only after mineflayer's own look -- against a
//      10,000 ms timeout: "has cobblestone on its lid and it would not break" (5 deposit lid digs in 8 days fleet-wide:
//      4 aborted, 1 confirmed).
//
// THE SERVER'S RULE (vanilla ChestBlock.isChestBlockedAt): a chest or trapped chest does not open when the block above is a
// redstone conductor -- by default any block whose collision shape is a full cube, except the blocks that opt out (glass,
// leaves, the redstone block, observer, piston, ...) and plus the two that opt in without a full cube (soul sand, mud) --
// or when a cat sits on it (Paper can switch the cat check off). A double chest is blocked when EITHER half is. A chest on a
// chest does NOT block it (not a full cube): measured, placebo-b 280,63,-378 and placebo-c 355,71,149 each carry a chest
// and were counted. Barrels open under anything. mineflayer adds nothing: openContainer clicks and waits for a window.
//
// THE BOT'S RULE stays chestLidBlocked (a single full-height box): it under-reads soul sand and mud, and until
// cobblekeep-01 it over-read glass and leaves as blocking -- the fleet then found oak_leaves on town chests (422 refusals
// in 60 h), so leaves and glass (LID_OPENS) no longer block: the bot opens, and the open is the proof. The clear never breaks
// them (LID_BREAKABLE below). serverLidBlocks is a hand-kept APPROXIMATION of the server's rule: the census uses it, and
// the bot uses it only as one more condition before a break (skills.mjs lidJudge: a block the server would not block on
// is never broken).

/** The bot's lid test (was skills.mjs chestLidBlocked; re-exported there). A solid block with one full-height box --
 *  except leaves and glass (LID_OPENS below; vanilla marks them never-conductor, NOT_CONDUCTOR), which never stop a chest
 *  opening on the server (cobblekeep-01, measured 10-19: 422 of 4,200 `_lid_clear` refusals in 60 h were oak_leaves, and
 *  placebo-b's 284,65,-389 under leaves had gone uncounted 30 h, so the town's cobble was UNKNOWN). The OPEN is the proof:
 *  a chest that still does not open fails as any unopenable container does. */
export function chestLidBlocked (above) {
  if (!above || above.boundingBox !== 'block') return false
  if (typeof above.name === 'string' && LID_OPENS.test(above.name)) return false
  const shapes = Array.isArray(above.shapes) ? above.shapes : null
  if (!shapes || !shapes.length) return true                                  // a solid we cannot inspect: assume a full cube
  return shapes.length === 1 && shapes[0][1] <= 0 && shapes[0][4] >= 1         // exactly one full-height box
}

const FULL_CUBE = b => Array.isArray(b?.shapes) && b.shapes.length === 1 &&
  b.shapes[0][0] <= 0 && b.shapes[0][1] <= 0 && b.shapes[0][2] <= 0 && b.shapes[0][3] >= 1 && b.shapes[0][4] >= 1 && b.shapes[0][5] >= 1
/** Full-cube blocks vanilla marks `isRedstoneConductor(never)` -- only the ones this file is SURE of. Anything else with a
 *  full cube reads as blocking: the census over-counts rather than under-counts. */
const NOT_CONDUCTOR = /(^|_)glass$|_leaves$|^(redstone_block|observer|piston|sticky_piston|[a-z_]*copper_grate)$/
/** ...and the two the bot OPENS under (cobblekeep-01): leaves (422 fleet refusals in 60 h; Paper 10-19 opened a chest under
 *  oak_leaves) and glass (Paper 10-19 lidglass). The rest of NOT_CONDUCTOR is unmeasured on Paper and stays a lid to the
 *  bot (Claude r1 P3: narrow it to what was proven). */
const LID_OPENS = /(^|_)glass$|_leaves$/
/** ...and the two that conduct without one. */
const CONDUCTOR_ALWAYS = /^(soul_sand|mud)$/
/** THE SERVER'S RULE, APPROXIMATED: does this block (or a sitting cat) stop a chest below it opening? Pure. */
export function serverLidBlocks (above, { cat = false } = {}) {
  if (cat) return true
  if (!above || typeof above.name !== 'string') return false
  if (CONDUCTOR_ALWAYS.test(above.name)) return true
  if (NOT_CONDUCTOR.test(above.name)) return false
  return above.boundingBox === 'block' && FULL_CUBE(above)
}

/**
 * WHAT A BOT MAY BREAK OFF A LID: cobblestone and cobbled deepslate -- the census's 18 of 18 -- and, since cobblekeep-01,
 * DIRT and the GRASS BLOCK it turns into in the light (vanilla spreads grass onto lit dirt): the `_lid_clear` row named
 * the next blocker, as designed -- 3,774 of 4,200 refusals in 60 h (10-17..19) were lid=dirt, on 10 containers in 7
 * worlds, and every one of the six towns whose cobble the cap called UNKNOWN had one (board-a 353,72,146 uncounted 50 h,
 * placebo-b 282,64,-388 68 h, placebo-c 355,72,149 60 h, ...). Nothing else (Codex design r1 P1: material is not
 * permission): a town structure in another material keeps its lid shut and the container is refused as before.
 */
export const LID_BREAKABLE = /^(cobblestone|cobbled_deepslate|dirt|grass_block)$/
/**
 * LIDPLANK-01 (owner 10-28/29): THE WOOD FAMILY, WHEN NO BUILD RECORD OWNS THE CELL. Codex's lidclear design r1 P1 ("material
 * is not permission") kept planks shut because a town STRUCTURE might be wood. The structures the bots build are recorded --
 * the town plan's cells, the workshop's record, the tree farm's columns, the junk well and its plinth -- so the permission is
 * the record, not the material: a full wood block (planks, logs, wood, stems, hyphae, bamboo block or mosaic) on a lid may be
 * broken when the caller has READ every record and none holds the cell. A record cell keeps the old refusal, named; records
 * that could not be read keep it too (never on a guess). Measured 10-28/29: 1,190 of 1,206 `_lid_clear` rows in 7 d (ES)
 * were `refused lid=oak_planks`, all one chest (placebo-a 250,74,-141, in no record; cleared by an owner one-off 10-29
 * 00:14Z); the region census then found 0 blocking lids on 306 town containers in 16 towns (non-air: vine 15, chest 3,
 * oak_leaves 2, none of which blocks).
 */
export const LID_WOOD = /^(stripped_)?[a-z_]+_(log|wood|stem|hyphae)$|^[a-z_]+_planks$|^bamboo_(block|mosaic)$|^stripped_bamboo_block$/
/**
 * MAY THIS MATERIAL COME OFF A LID? -> null (yes) or the reason. Pure.
 *   record  false: every build record was read and none holds the lid cell; a string: the record that holds it
 *           ('townplan', 'workshop', 'treefarm'); anything else: unknown (not read) -- refused as before
 */
export function lidMaterialRefusal (name, { record } = {}) {
  if (LID_BREAKABLE.test(name)) return null
  if (!LID_WOOD.test(name)) return `${name} is not a block a bot may break off a lid`
  if (record === false) return null
  if (typeof record === 'string' && record) return `${name} is part of the ${record} record`
  return `${name} is not a block a bot may break off a lid (the build records were not read)`
}
const LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column|seagrass|tall_seagrass|kelp|kelp_plant)$/
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|anvil|chipped_anvil|damaged_anvil|pointed_dripstone|dragon_egg|scaffolding)$|_concrete_powder$/
/** A cell that holds water: a liquid, or a waterlogged block (the props say so, as prismarine-block or a region read gives them). */
const wet = b => LIQUID.test(b?.name ?? '') || b?.props?.waterlogged === true || b?.props?.waterlogged === 'true'

/**
 * MAY THE BOT BREAK THE BLOCK ON THIS LID? -> null (yes) or the reason it may not. Pure.
 *   lid    the block on the lid ({ name, props })
 *   above  the block above the lid
 *   sides  the lid's four horizontal neighbours
 *   well   true when the lid cell is part of a known junk well (well.mjs wellBreakCost > 0): never broken
 *   record lidplank-01: the build record holding the lid cell, false for none (all read), else unknown (lidMaterialRefusal)
 * Every unknown cell refuses (never on a guess); water or lava above or beside -- a liquid, or a waterlogged block --
 * refuses (the break would let it flow into the lid cell and onto the bot); a falling block above refuses (it would drop
 * straight back onto the lid).
 */
export function lidClearRefusal ({ lid = null, above = null, sides = [], well = false, record = undefined } = {}) {
  if (!lid || typeof lid.name !== 'string') return 'lid unknown'
  const material = lidMaterialRefusal(lid.name, { record })   // lidplank-01: wood only off a cell no build record holds
  if (material) return material
  if (well) return 'the lid cell is part of the junk well'
  if (!above || typeof above.name !== 'string') return 'the cell above the lid is unknown'
  if (!Array.isArray(sides) || sides.length !== 4 || sides.some(b => !b || typeof b.name !== 'string')) return 'a cell beside the lid is unknown'
  if ([above, ...sides].some(wet)) return 'water or lava beside the lid'
  if (FALLING.test(above.name)) return `${above.name} above the lid would fall onto it`
  return null
}

/**
 * THE LID DIG'S BUDGET -> ms, or null when the dig is too slow to start. Pure. `digMs` is bot.digTime(lid) AFTER the equip
 * (the held tool, water, standing on ground). The budget is the dig plus a margin for the server's tick and the look;
 * past LID_DIG_MAX_MS (a bare hand in water or off the ground: x5) the bot does not start a dig it cannot finish.
 */
export const LID_DIG_MAX_MS = 15_000
export const LID_DIG_MARGIN_MS = 2_500
export function lidDigBudgetMs (digMs) {
  const d = Number(digMs)
  if (!Number.isFinite(d) || d < 0) return null
  if (d + LID_DIG_MARGIN_MS > LID_DIG_MAX_MS) return null
  return Math.ceil(d + LID_DIG_MARGIN_MS)
}

/**
 * WHAT A FAILED CLEAR SAYS ABOUT THE CONTAINER -> 'unavailable' | null. Pure. Only evidence about the LID marks the
 * container unavailable for the town (30 min, chestfull.mjs): a rule refusal (the block, a hazard, the well) or a dig that
 * ran its full budget and did not break it. The CALLER'S limits are not evidence (Codex design r1 P1): our own clock
 * (`no_time`), a bot off the ground or in water (`slow`), out of reach (`reach`), a hand it could not free (`hand`), a dig
 * mineflayer cancelled (`interrupted`: another dig, a reflex, a death -- code reviews r2), the town's well cells unreadable
 * (`unknown`) or an abort -- those leave the town's memory alone and the next order retries from a better stance.
 */
export const LID_OUTCOMES = Object.freeze(['dug', 'not_blocked', 'refused', 'failed', 'unconfirmed', 'slow', 'no_time', 'reach', 'hand', 'interrupted', 'unknown', 'aborted'])
export function lidFailMemory (outcome) {
  return outcome === 'refused' || outcome === 'failed' || outcome === 'unconfirmed' ? 'unavailable' : null
}

/** The `_lidclear_mode` licence row (once per spawn): a kind the baseline cannot write. */
export const lidClearModeDetail = () => `phase=mode recount=clear dig=equip breakable=cobble budget_max=${LID_DIG_MAX_MS}`
