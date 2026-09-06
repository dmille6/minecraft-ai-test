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
 */
export function predictedDigMs (block, tool = null) {
  try {
    if (typeof block?.digTime !== 'function') return null
    const t = block.digTime(tool?.type ?? null, false, false, false)
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
