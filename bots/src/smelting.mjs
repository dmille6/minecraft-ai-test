// WHAT A FURNACE TURNS INTO WHAT, AND WHAT BURNS TO DO IT.
//
// THIS IS A HAND-MAINTAINED TABLE AND drops.mjs SAYS NOT TO WRITE ONE. The
// exemption is measured, not assumed.
//
// drops.mjs refuses a literal table because "minecraft-data already ships the
// mapping for the exact protocol version the bot is connected to, so it cannot
// rot against a server upgrade". That is true of mining drops. It is false of
// smelting: minecraft-data ships NO smelting data and NO fuel data, for any
// version. Checked against the vendored copy the fleet actually loads --
//
//     find node_modules/minecraft-data -iname '*smelt*' -o -iname '*fuel*'
//         -o -iname '*burn*'                                  ->  0 files
//     dataPaths.json pc/1.21.8 lists 21 datasets, none of them smelting or fuel
//
// with the positive control that the same tree is not simply empty: recipes.json
// resolves 3 crafting recipes for `furnace` and 2 for `iron_ingot`. And the
// clinching case is `charcoal`, which has ZERO crafting recipes -- so it is
// invisible to bot.recipesFor/recipesAll entirely. There is nothing to read.
//
// Two things keep the rot bounded, since the argument above only justifies the
// table's existence and not its correctness:
//
//   * EVERY NAME IS VALIDATED AGAINST THE LIVE REGISTRY before use, by
//     smeltRecipeFor's caller. A name this file gets wrong becomes a refusal
//     the model can read, never a silent mis-smelt.
//   * BURN TIMES ARE NEVER LOAD-BEARING FOR CORRECTNESS. They size a batch and
//     nothing else. The skill grades itself on the measured inventory delta, so
//     a burn time that is wrong costs a partial batch -- which is already a
//     first-class outcome ("call smelt again to continue") -- and can never
//     turn into a false success. This is deliberate: CLAUDE.md requires
//     independent review before resting a change on external Minecraft
//     behaviour, and that review has NOT been done for these numbers. So
//     nothing rests on them.

/** Ticks a vanilla furnace spends on one item. 200 ticks = 10 seconds. */
export const SMELT_TICKS = 200
export const MS_PER_TICK = 50
export const SMELT_MS_PER_ITEM = SMELT_TICKS * MS_PER_TICK      // 10_000

/**
 * Never smelt more than one coal's worth in a single call.
 *
 * Not a taste decision: a furnace holds the bot's body for 10s per item, the
 * runner's whole budget is 180s (config.skills.defaultTimeoutMs) and the hard
 * stop lands 30s after that. Four of this project's documented traps are a
 * skill that occupied the body longer than the layer above expected. Eight
 * items is 80 seconds, which leaves the travel there, the travel back and the
 * recovery inside one budget with room to spare.
 *
 * The skill takes the MINIMUM of this and what its own deadline can actually
 * afford, so the two can never silently disagree.
 */
export const SMELT_BATCH_MAX = 8

// ---------------------------------------------------------------- inputs ---

// Suffix families rather than 60 literal names: every wood type smelts to
// charcoal and every wood type burns, so keying on the family is both shorter
// and less rot-prone than enumerating cherry/mangrove/bamboo one by one -- a
// list that has grown in five of the last six Minecraft releases.
const WOOD_RE = /_(log|wood|stem|hyphae)$/
const PLANKS_RE = /_planks$/

const SMELTS = {
  // The rung this whole file exists for.
  raw_iron: 'iron_ingot',
  iron_ore: 'iron_ingot',
  deepslate_iron_ore: 'iron_ingot',
  raw_copper: 'copper_ingot',
  copper_ore: 'copper_ingot',
  deepslate_copper_ore: 'copper_ingot',
  raw_gold: 'gold_ingot',
  gold_ore: 'gold_ingot',
  deepslate_gold_ore: 'gold_ingot',
  nether_gold_ore: 'gold_ingot',
  ancient_debris: 'netherite_scrap',

  // Ores that drop themselves only when silk-touched; harmless to list.
  coal_ore: 'coal',
  deepslate_coal_ore: 'coal',
  redstone_ore: 'redstone',
  deepslate_redstone_ore: 'redstone',
  lapis_ore: 'lapis_lazuli',
  deepslate_lapis_ore: 'lapis_lazuli',
  diamond_ore: 'diamond',
  deepslate_diamond_ore: 'diamond',
  emerald_ore: 'emerald',
  deepslate_emerald_ore: 'emerald',
  nether_quartz_ore: 'quartz',

  // Building materials.
  sand: 'glass',
  red_sand: 'glass',
  cobblestone: 'stone',
  stone: 'smooth_stone',
  cobbled_deepslate: 'deepslate',
  clay_ball: 'brick',
  netherrack: 'nether_brick',
  cactus: 'green_dye',
  wet_sponge: 'sponge',
  sea_pickle: 'lime_dye',
  chorus_fruit: 'popped_chorus_fruit',
  // Not matched by WOOD_RE, and it does smelt. Caught by the registry probe in
  // test/smelt-recipes.test.mjs rather than by remembering.
  bamboo_block: 'charcoal',

  // Food. `eat` is a real skill and cooked food restores more.
  porkchop: 'cooked_porkchop',
  beef: 'cooked_beef',
  chicken: 'cooked_chicken',
  mutton: 'cooked_mutton',
  rabbit: 'cooked_rabbit',
  cod: 'cooked_cod',
  salmon: 'cooked_salmon',
  potato: 'baked_potato',
  kelp: 'dried_kelp',
}

/**
 * What one `input` becomes in a furnace, or null.
 *
 * Pure and total: no bot, no registry, no I/O. The caller validates the
 * returned name against the live registry.
 */
export function smeltRecipeFor (input) {
  if (typeof input !== 'string' || !input) return null
  if (Object.hasOwn(SMELTS, input)) return { input, output: SMELTS[input] }
  // Every log, wood, stem and hyphae smelts to charcoal -- and charcoal is the
  // one fuel a bot with trees and no coal can always make, which makes this
  // family the bootstrap for the whole verb.
  if (WOOD_RE.test(input)) return { input, output: 'charcoal' }
  return null
}

/**
 * Every input that smelts to `output`. The reverse direction, and the one that
 * stops the milestone layer scoring the ore as busywork.
 *
 * cognitive.mjs's #wantedItems expands a milestone target through
 * bot.recipesAll -- the CRAFTING graph. raw_iron is not in iron_ingot's
 * crafting graph (that graph contains iron_nugget and iron_block), so a bot
 * asked for an ingot that went and dug the ore would have scored `off-target
 * gain` and had the work called busywork. Same class of composition defect as
 * the four traps in CLAUDE.md: two correct components meeting at a gap.
 */
export function smeltInputsFor (output) {
  if (typeof output !== 'string' || !output) return []
  const out = Object.keys(SMELTS).filter(k => SMELTS[k] === output)
  if (output === 'charcoal') out.push('oak_log', 'birch_log', 'spruce_log',
    'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log')
  return out
}

// ----------------------------------------------------------------- fuels ---

// Burn time in ticks. Only the fuels a Block-2 bot plausibly holds; a shorter
// list is a smaller thing to be wrong about, and an unlisted fuel costs a
// missed opportunity rather than a bad decision.
const FUEL_TICKS = {
  coal: 1600,
  charcoal: 1600,
  coal_block: 16000,
  blaze_rod: 2400,
  dried_kelp_block: 4001,
  stick: 100,
  bamboo: 50,
}

/** Burn time in ticks for one of `name`, or 0 if it does not burn. */
export function fuelTicks (name) {
  if (typeof name !== 'string' || !name) return 0
  if (Object.hasOwn(FUEL_TICKS, name)) return FUEL_TICKS[name]
  if (PLANKS_RE.test(name)) return 300
  if (WOOD_RE.test(name)) return 300
  return 0
}

/**
 * PREFERENCE IS ABOUT REGRET, NOT ABOUT EFFICIENCY.
 *
 * Ordered by what burning one costs the bot elsewhere. coal and charcoal have
 * essentially no other use in this fleet's tech tree, so they go first. Sticks
 * go LAST because two of them are half a pickaxe, and this project has already
 * shipped one change that quietly consumed the materials for the tool the bot
 * was trying to build.
 *
 * Planks before logs on both counts: one plank buys the same 300 ticks as one
 * log, and the log is worth four planks.
 */
const FUEL_ORDER = ['charcoal', 'coal', 'coal_block', 'blaze_rod',
                    'dried_kelp_block', 'bamboo', '*_planks', '*_log', 'stick']

const rank = name => {
  const i = FUEL_ORDER.indexOf(name)
  if (i >= 0) return i
  if (PLANKS_RE.test(name)) return FUEL_ORDER.indexOf('*_planks')
  if (WOOD_RE.test(name)) return FUEL_ORDER.indexOf('*_log')
  return FUEL_ORDER.length
}

/**
 * The best fuel this bot holds, ignoring `exclude`.
 *
 * `held` is a plain {name: count} map so this stays testable without a bot.
 * Returns { name, count, ticks } where `count` is how many are held and
 * `ticks` is the burn time of ONE -- the caller decides how many to spend.
 */
export function chooseFuel (held, { exclude = null } = {}) {
  let best = null
  for (const [name, count] of Object.entries(held ?? {})) {
    if (!(count > 0)) continue
    if (name === exclude) continue
    const ticks = fuelTicks(name)
    if (!ticks) continue
    const r = rank(name)
    if (!best || r < best.rank) best = { name, count, ticks, rank: r }
  }
  return best ? { name: best.name, count: best.count, ticks: best.ticks } : null
}

// ------------------------------------------------------------------ plan ---

/**
 * THE WHOLE DECISION, IN ONE PURE FUNCTION.
 *
 * CLAUDE.md: "Never assert decision logic by matching text. Extract the
 * decision." Everything the skill decides before it touches the world is here,
 * so it can be tested by behaviour and mutated. The skill itself only walks,
 * opens, transfers, waits and measures.
 *
 * Refusals name a remedy and a `need` the cognitive layer can ADOPT AS THE
 * TASK, because CLAUDE.md's own evidence is that printed advice is not taken
 * (one refusal printed the right remedy 262 times and was never acted on).
 *
 * @param held      {name: count} inventory map
 * @param item      what the model asked to smelt
 * @param count     how many it asked for
 * @param budgetMs  wall clock this call may spend in front of the furnace
 * @param hasFurnace whether a usable furnace is available (block or carried)
 */
export function smeltPlan ({ held = {}, item, count = 1, budgetMs = 0, hasFurnace = true } = {}) {
  const recipe = smeltRecipeFor(item)
  if (!recipe) {
    return { ok: false, reason: 'not_smeltable', item,
             detail: `${item} does not smelt -- a furnace cannot turn it into anything` }
  }
  const { input, output } = recipe

  const have = Number(held[input] ?? 0)
  if (have < 1) {
    return { ok: false, reason: 'no_input', item: input, output,
             need: { items: [input], count: 1,
                     describe: `Get 1 ${input} before smelting -- the furnace has nothing to work on.`,
                     because: 'smelt has no input' },
             detail: `no ${input} to smelt` }
  }

  if (!hasFurnace) {
    // The remedy is EXECUTABLE FROM ANYWHERE A BOT CAN GATHER STONE, and it is
    // the rung the existing TECH_LADDER already treats as reachable
    // (`ladder('furnace', 1, ...)` fires only when the bot holds 8 cobble and is
    // vacuously satisfied otherwise). Naming `furnace` rather than `cobblestone`
    // keeps `craft`'s own prerequisite walker in charge of the level below,
    // which is the component that already resolves ingredient subtrees.
    return { ok: false, reason: 'no_furnace', item: input, output,
             need: { items: ['furnace'], count: 1,
                     describe: 'Get a furnace before smelting: craft item=furnace (8 cobblestone), ' +
                               'then smelt again -- smelt places it for you.',
                     because: 'smelt found no furnace' },
             detail: 'no furnace within reach and none in your inventory' }
  }

  // Fuel may not be the input itself unless there is enough for both jobs; a
  // bot smelting its last log into charcoal must not burn that same log.
  const fuel = chooseFuel(held, { exclude: null })
  const usable = fuel && fuel.name === input && fuel.count < 2
    ? chooseFuel(held, { exclude: input })
    : fuel
  if (!usable) {
    return { ok: false, reason: 'no_fuel', item: input, output,
             need: { items: ['coal', 'charcoal', 'oak_planks', 'oak_log'], count: 1,
                     describe: 'Get fuel before smelting: coal from coal_ore, or any planks or ' +
                               'log will burn. One coal smelts 8 items.',
                     because: 'smelt has no fuel' },
             detail: `nothing to burn: ${input} needs fuel (coal, charcoal, planks or logs)` }
  }

  // THREE CEILINGS, AND THE CLOCK IS ONE OF THEM ON PURPOSE.
  //
  // Deriving the batch from the deadline rather than trusting SMELT_BATCH_MAX
  // is what stops the constant and the budget drifting apart -- the failure
  // mode CLAUDE.md asks to make mechanical instead of remembered.
  const byClock = Math.floor(Math.max(0, budgetMs) / SMELT_MS_PER_ITEM)
  let batch = Math.min(
    Math.max(1, Math.floor(Number(count) || 1)),
    have,
    byClock,
    SMELT_BATCH_MAX,
  )

  // Fuel the bot can actually spare. If the fuel IS the input, every unit spent
  // burning is one fewer to smelt, so solve for the split rather than
  // double-counting the same stack.
  const sameStack = usable.name === input
  let fuelCount = 0
  for (;;) {
    if (batch < 1) break
    fuelCount = Math.ceil((batch * SMELT_TICKS) / usable.ticks)
    const affordable = sameStack ? have - batch : usable.count
    if (fuelCount <= affordable) break
    batch--
  }

  if (batch < 1) {
    return { ok: false, reason: 'budget_too_small', item: input, output,
             detail: byClock < 1
               ? 'not enough time left in this call to smelt even one item'
               : `not enough ${usable.name} to smelt even one ${input}` }
  }

  return {
    ok: true,
    input,
    output,
    batch,
    fuel: { name: usable.name, count: fuelCount },
    estMs: batch * SMELT_MS_PER_ITEM,
  }
}
