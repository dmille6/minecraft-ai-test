/**
 * HOW LONG A CLIMB IS ALLOWED TO SPEND ON ONE BLOCK.
 *
 * `shaftAscend` gave every dig a flat 15,000ms and treated the timeout as a
 * refusal: `dig failed on <block>`, which `climbPrerequisite` then turns into
 * "get a pickaxe". That number is not a budget, it is a coin flip that a
 * toolless bot always loses, and it loses it in exactly the place where losing
 * is fatal.
 *
 * Minecraft's break time for a block that REQUIRES a tool you do not hold is
 * hardness x 5 seconds. Measured against the deployed registry (1.21.8,
 * prismarine-block digTime, bare hand):
 *
 *     stone                7,500ms     fits
 *     granite/diorite      7,500ms     fits
 *     andesite/tuff        7,500ms     fits
 *     cobblestone         10,000ms     fits
 *     deepslate           15,000ms     EXACTLY the budget -- never fits
 *     iron_ore            15,000ms     EXACTLY the budget -- never fits
 *     cobbled_deepslate   17,500ms     over the budget -- never fits
 *     obsidian           250,000ms     hopeless, and should be refused
 *
 * Deepslate replaces stone below y=0 and is most of what a deep bot has over
 * its head. So the rule was: a bot without a pickaxe may climb out of stone,
 * and may never climb out of deepslate -- and the deepslate case reported
 * itself as "this stone needs a pickaxe", sending the bot to fetch wood that
 * only exists on the surface it cannot reach. That is the ladder rule broken at
 * its root: the rung cost a failed attempt AND the failure named a remedy the
 * bot could not perform.
 *
 * BREAKING BY HAND IS THE POINT. Stone and deepslate broken bare-handed drop
 * NOTHING, and that is fine -- a climb wants the hole, not the cobble. The bot
 * is not mining, it is leaving.
 *
 * So price the dig from the block, not from a constant, and keep a cap so that
 * genuinely hopeless blocks are still refused promptly rather than eating the
 * whole ascent. The cap is what separates "slow but escapable" from
 * "obsidian" -- and it is a real distinction, not a tuning knob: everything a
 * bare hand can clear in under thirty seconds is ordinary terrain, and
 * everything above that needs a better tool no matter how long we wait.
 */

/** Never allow less than this: it is the old flat budget, kept as a floor. */
export const MIN_DIG_MS = 15_000

/**
 * Above this, refuse instead of waiting. Bare-handed obsidian is 250s and
 * bedrock is unbreakable; both must fail fast so the climb can report a
 * prerequisite rather than burn its whole 120s deadline on one block.
 */
export const MAX_DIG_MS = 30_000

/** Slack over the predicted time: server latency, re-targeting, block updates. */
export const DIG_MARGIN = 1.5
export const DIG_SLACK_MS = 2_000

/**
 * Decide whether to attempt a dig, and how long to allow it.
 *
 * Pure on purpose. The whole defect was a magic number nobody could test
 * against the registry, so the replacement is a function that takes the
 * registry's own answer and can be pinned by a test that never stands up a bot.
 *
 * @param predictedMs what prismarine-block says this dig will take with the
 *                    tool actually in hand, or null/NaN when unknown
 * @returns {{ budgetMs: number, refuse: boolean, predictedMs: number|null }}
 */
export function planDig (predictedMs, {
  floor = MIN_DIG_MS, cap = MAX_DIG_MS, margin = DIG_MARGIN, slack = DIG_SLACK_MS,
} = {}) {
  const p = Number(predictedMs)
  // UNKNOWN IS NOT HOPELESS. Test fakes, modded blocks and any registry gap
  // land here, and the honest answer is the old behaviour: try it, with the
  // floor as the budget. Refusing on a missing lookup would invent a trap.
  if (!Number.isFinite(p) || p <= 0) return { budgetMs: floor, refuse: false, predictedMs: null }
  if (p > cap) return { budgetMs: 0, refuse: true, predictedMs: p }
  return { budgetMs: Math.max(floor, Math.ceil(p * margin) + slack), refuse: false, predictedMs: p }
}

/**
 * What the registry thinks this dig costs with `tool` in hand.
 *
 * Wrapped because `digTime` is optional on the block objects the tests build
 * and on anything the registry does not know; a missing answer must read as
 * "unknown" (see above), never as zero.
 *
 * `env` IS NOT OPTIONAL IN PRACTICE, AND OMITTING IT PRICED A FICTION.
 *
 * This used to call `digTime(type, false, false, false)` -- creative, inWater
 * and notOnGround all hardcoded false -- while mineflayer's own `bot.digTime`
 * (lib/plugins/digging.js:248) passes the REAL `!bot.entity.onGround`, and
 * `prismarine-block` (index.js:350) does `blockBreakingSpeed /= 5.0` when that
 * is true. So the budget was computed with one formula and the dig ran on
 * another, differing by exactly 5x for the population that matters: an escape
 * routine is used precisely when the bot is NOT standing on solid ground.
 *
 *   stone, bare hand    on ground  7,500ms   airborne  37,500ms   budget 15,000
 *   stone, stone pick   on ground    600ms   airborne   2,850ms   budget 15,000
 *
 * Measured 2026-09-06: `dig_down` chose 337 times, succeeded 0, and 86% ended
 * `dig exceeded 15000ms`. Those digs were not slow, they were impossible -- and
 * `digHand` could not fall back to the tool, because the fiction it was fed
 * said bare hands would fit. Feeding it the truth repairs that on its own.
 *
 * Use `digEnv(bot)` to build this; it mirrors mineflayer argument for argument.
 */
export function predictedDigMs (block, tool = null, env = {}) {
  try {
    if (typeof block?.digTime !== 'function') return null
    const { creative = false, inWater = false, notOnGround = false,
            enchantments = [], effects } = env
    const ench = [...(tool?.enchants ?? []), ...enchantments]
    const t = block.digTime(tool?.type ?? null, creative, inWater, notOnGround, ench, effects)
    return Number.isFinite(t) ? t : null
  } catch { return null }
}

/**
 * WHICH HAND DIGS THIS, AND FOR HOW LONG?
 *
 * The escape routines break blocks to make a HOLE, not to collect a drop: the
 * postcondition of `harvestUnderfoot` is `fell`, and of `pillarOut` is the rise.
 * Neither cares what the block yields, so equipping a pickaxe buys nothing they
 * need -- and it costs the one resource the fleet cannot replace on a pillar.
 *
 * Measured 2026-09-05 over every archive: of 8,803 pickaxes that ever left an
 * inventory, 5,951 (68%) were destroyed during escape activity against 55 lost
 * to death, at a mean health of 20.0/20 at the moment of loss. Healthy bots
 * grinding tools to dust digging their way out. By type: wooden 3,775, stone
 * 2,170, iron 5, diamond 1.
 *
 * But bare hands are SLOWER, and a tool is genuinely required for some blocks,
 * so this is a preference and not a prohibition. Bare first; the tool comes
 * back only when the registry says the bare-handed swing exceeds the budget
 * ceiling. Removing the tool outright would take away a dig the bot can
 * currently make, which is this repo's named bug class -- a new guard leaving a
 * bot with no legal move -- and the durability saving is already banked by the
 * common case, where the block underfoot is cobble the bot placed itself.
 *
 * Pure so the decision can be pinned without standing up a bot. Pass the
 * registry's own predictions; `null` for either means "unknown", which
 * `planDig` treats as try-it rather than as hopeless.
 *
 * @returns {{ hand: 'bare'|'tool'|null, budgetMs: number, refuse: boolean }}
 */
export function digHand ({ bareMs = null, toolMs = null } = {}) {
  const bare = planDig(bareMs)
  if (!bare.refuse) return { hand: 'bare', budgetMs: bare.budgetMs, refuse: false }
  const tooled = planDig(toolMs)
  if (!tooled.refuse) return { hand: 'tool', budgetMs: tooled.budgetMs, refuse: false }
  return { hand: null, budgetMs: 0, refuse: true }
}

/**
 * The dig environment as MINEFLAYER computes it, mirrored argument for argument
 * from `lib/plugins/digging.js:228-256` so the budget and the dig cannot drift
 * apart again.
 *
 * Two details that are easy to get wrong and are wrong if you guess:
 *   - `inWater` is water at EYE level, not at the feet.
 *   - helmet enchantments count, because Aqua Affinity affects dig speed.
 *
 * `notOnGround` defaults to TRUE when the flag cannot be read, because for the
 * call sites that use this, over-predicting makes `digHand` reach for the tool
 * (costing durability) while under-predicting produces a dig that cannot finish
 * (costing the bot). The second failure is the one that stranded the fleet.
 *
 * USE THIS ONLY WHERE THE CONSEQUENCE IS CHOOSING A HAND, NOT REFUSING.
 *
 * `planDig` refuses anything over MAX_DIG_MS, so feeding it a 5x airborne
 * prediction turns deepslate (15,000ms grounded, 75,000ms airborne) from a
 * block the climb breaks into one it declines -- and a bot that cannot break
 * its own ceiling is trapped with no remedy, which is this repo's named bug
 * class. The suite caught exactly that: five behaviour tests in
 * `dig-budget.test.mjs` went red on `the climb never attempted the block over
 * its head`.
 *
 * So the escape-stair and shaft-ascent budgets stay on the grounded prediction
 * deliberately. They were never the regression -- `marooned_ramp_cut` is flat
 * across the deploy -- and their failure mode from over-prediction is worse
 * than their failure mode from under-prediction. The cleaner long-term shape is
 * to split the two questions `planDig` currently answers at once: refuse on
 * BLOCK HARDNESS (a property of block and tool) and size the deadline on the
 * ACTUAL predicted time. That is a bigger change than this canary should carry.
 */
export function digEnv (bot) {
  const head = bot?.inventory?.slots?.[bot?.getEquipmentDestSlot?.('head')]
  return {
    creative: bot?.game?.gameMode === 'creative',
    inWater: ['water', 'flowing_water'].includes(bot?._getBlockAtEyeLevel?.()?.name),
    notOnGround: !bot?.entity?.onGround,
    enchantments: head?.enchants ?? [],
    effects: bot?.entity?.effects,
  }
}

/**
 * TWO QUESTIONS THAT `planDig` ANSWERS AT ONCE, AND THEY WANT DIFFERENT INPUTS.
 *
 *   "is this block breakable at all by this hand?"  -> a property of BLOCK+TOOL
 *   "how long will this dig actually take here?"    -> a property of the SITUATION
 *
 * Feeding the situation-aware prediction to both turns deepslate from a block
 * the escape ramp BREAKS (15,000ms grounded) into one it DECLINES (75,000ms
 * airborne, past the 30s ceiling) -- and a bot that cannot break its own ceiling
 * is trapped with no remedy, which is this repo's named bug class. That is why
 * `digEnv` was deliberately kept away from the ramp's budget when it was
 * introduced, and the cost of that caution was the other half of the problem:
 * the deadline stayed grounded too, so real airborne digs were cut short.
 *
 * Measured 2026-09-06: of 342 `escapeStairUp` attempts by the five permanently
 * entombed bots, 23.9% ended `dig exceeded`. Those digs were not refused and
 * were not impossible -- they were given a grounded deadline for an airborne
 * dig, and the gap is exactly the 5x `notOnGround` penalty.
 *
 * So: refuse on hardness, budget on reality. Neither question borrows the
 * other's input.
 */
export function planDigSplit ({ hardnessMs = null, actualMs = null } = {}) {
  // The refuse decision, on the grounded prediction. Unchanged behaviour.
  const hard = planDig(hardnessMs)
  if (hard.refuse) return { refuse: true, budgetMs: 0, hardnessMs: hard.predictedMs }

  // The deadline, on what will actually happen. Never SHORTER than the grounded
  // budget -- this may only ever lengthen a deadline, so it cannot introduce a
  // timeout that did not already exist.
  const a = Number(actualMs)
  const budgetMs = Number.isFinite(a) && a > 0
    ? Math.max(hard.budgetMs, Math.ceil(a * DIG_MARGIN) + DIG_SLACK_MS)
    : hard.budgetMs
  return { refuse: false, budgetMs, hardnessMs: hard.predictedMs, actualMs: Number.isFinite(a) ? a : null }
}
