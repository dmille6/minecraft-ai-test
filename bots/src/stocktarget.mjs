// PER-TOWN STOCK TARGETS (stocktarget-01; OWNER 10-08 ~17:20Z delegated: "do what you and codex think is right").
// Design: docs/reports/stocktargets-design-2026-10-08.md. The generalisation of stonecap's town cobble cap (cobblecap.mjs)
// to every BULK material: each GROUP of names has a per-town TARGET; the town's count of the group comes from the same
// reconciled container counts and the same claims journal as the cobble cap (one count per open records every group).
//   - below its target a group is banked as today, each transfer admitted by a CLAIM against the target;
//   - at its target it is no longer banked, never opens a new chest, and -- only where the junk well is in the build --
//     whole stacks above the bot's own STOCK_RESERVE go down the well at a full bag (owner-approved deletion);
//   - target 0 is at target by definition (0 >= 0): never banked, provable without any count.
// Cobble is the group `cobble` (target 256, the owner's cap) and keeps every stonecap behaviour exactly.
//
// MEASURED 10-08 (design section 1): the twelve town chest sets hold 4,696 slots, 2,136 of them in groups this table
// targets (cobble 674, oak_log 834, birch_log 173, oak_planks 168, stick 287); every town is over target on cobble, oak
// logs and sticks; no bulk material was withdrawn in 24 h (the bank is write-only for these).
//
// NEVER A TARGET (and so never disposed by this rule): iron and every ore, raw_*, ingots, nuggets, coal, gems, tools and
// armour, saplings/propagules, anything the composter takes, torches, stations, food, bone meal, bamboo itself.
// PROTECTED below is the runtime guard; stocktarget.test.mjs asserts no group names a protected or compostable kind.

import { remaining, FLOOR } from './toolfor.mjs'

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak']
const bulk = (names, target) => Object.freeze({ names: Object.freeze(names), target, kind: 'bulk' })
const tool = (name, target) => Object.freeze({ names: Object.freeze([name]), target, kind: 'tool' })

/**
 * THE TARGETS (per town; design r2 section 2 -- PROVISIONAL, re-derived from a blueprint's measured draw once it draws).
 * Each is at once the BANK CAP, the PRUNE FLOOR and the one-time clear's CAP. Measured 48 h to 10-10 12:00Z: the town
 * draw of every bulk material is ZERO; the only draws are pickaxes (~5/town/day stone, ~2 wooden), coal and a few sticks.
 *   A  cobble 256 (OWNER 10-04/10-07); each log type 64, each planks type 64 (by type, as the owner asked; the workshop
 *      needs ~7 logs + 28 planks, the mineshaft's ladders ~14 logs); stick 64 (withdraw2's iron pickaxe: 2); stone 64
 *   B  0: nothing draws them from a town (the bots' own scaffold/pillar/pit cover use them from the BAG, kept by the keeps)
 *   C  usable tools (> FLOOR uses): stone_pickaxe 16 (~3 days of the measured draw), wooden_pickaxe 4, stone axe/shovel 4,
 *      the other wood/stone axes, shovels and hoes 0. A tool is NEVER disposed or pruned: the target caps banking only.
 * andesite / diorite / granite stay junkwell-02's (well junk above STONE_GUARD; never bankable): one rule per item.
 */
export const STOCK_GROUPS = Object.freeze({
  cobble: bulk(['cobblestone', 'cobbled_deepslate'], 256),
  ...Object.fromEntries(WOODS.map(w => [`${w}_log`, bulk([`${w}_log`], 64)])),
  ...Object.fromEntries([...WOODS, 'bamboo'].map(w => [`${w}_planks`, bulk([`${w}_planks`], 64)])),
  stick: bulk(['stick'], 64),
  stone: bulk(['stone'], 64),
  dirt: bulk(['dirt'], 0),
  sand: bulk(['sand', 'red_sand'], 0),
  gravel: bulk(['gravel'], 0),
  deepslate: bulk(['deepslate'], 0),
  tuff: bulk(['tuff'], 0),
  calcite: bulk(['calcite'], 0),
  sandstone: bulk(['sandstone', 'red_sandstone'], 0),
  stone_pickaxe: tool('stone_pickaxe', 16),
  wooden_pickaxe: tool('wooden_pickaxe', 4),
  stone_axe: tool('stone_axe', 4),
  stone_shovel: tool('stone_shovel', 4),
  wooden_axe: tool('wooden_axe', 0),
  wooden_shovel: tool('wooden_shovel', 0),
  stone_hoe: tool('stone_hoe', 0),
  wooden_hoe: tool('wooden_hoe', 0),
})
export const STOCK_GROUP_NAMES = Object.freeze(Object.keys(STOCK_GROUPS))
export const kindOf = g => STOCK_GROUPS[g]?.kind ?? null
export const isToolGroup = g => kindOf(g) === 'tool'

/** A tool copy counts toward its group only while it is USABLE (toolfor FLOOR): a spent copy is never banked anyway. */
export const countsToward = it => !!it?.name && GROUP_OF.has(it.name) && (!isToolGroup(GROUP_OF.get(it.name)) || remaining(it) > FLOOR)

/** The bot keeps one stack of each group (the 64 of the exit contract, the stockpile rung, the town deposit and the
 *  well's STONE_GUARD); the well takes only whole stacks above it. */
export const STOCK_RESERVE = 64

const GROUP_OF = new Map()
for (const [g, e] of Object.entries(STOCK_GROUPS)) for (const n of e.names) GROUP_OF.set(n, g)

/** name -> its group, or null (an untargeted name: today's rules exactly). */
export const groupOf = name => GROUP_OF.get(name) ?? null
export const isTargeted = name => GROUP_OF.has(name)
/** A group's town target. An unknown group is 0: never banked (fail closed). */
export const targetOf = g => STOCK_GROUPS[g]?.target ?? 0
export const namesOf = g => STOCK_GROUPS[g]?.names ?? []

/**
 * NEVER DISPOSED, whatever any table says (the owner's list: iron, ores, ingots, tools, saplings, the composter's inputs;
 * and everything else with a use the bulk table does not model). The well also refuses anything the composter takes.
 */
export const PROTECTED = /(_ore$|^raw_|_ingot$|_nugget$|^(coal|charcoal|diamond|emerald|lapis_lazuli|redstone|quartz|amethyst_shard|netherite_scrap|ancient_debris)$|_(pickaxe|axe|shovel|hoe|sword)$|_(helmet|chestplate|leggings|boots)$|^(bow|crossbow|shield|shears|flint_and_steel|fishing_rod|bucket|water_bucket|lava_bucket|milk_bucket)$|_sapling$|_propagule$|^(torch|crafting_table|furnace|blast_furnace|smoker|chest|barrel|composter|bed|bone_meal|bamboo|wheat|wheat_seeds|apple|bread)$|_bed$)/
export const isProtected = name => typeof name === 'string' && PROTECTED.test(name)

/** How many of a group a list of items ({ name, count }) holds. */
export function groupIn (items = [], g) {
  const names = new Set(namesOf(g))
  let n = 0
  for (const it of (Array.isArray(items) ? items : [])) if (it?.name && names.has(it.name) && countsToward(it)) n += Number(it.count) || 0
  return n
}

/** Every group's count in a list of items -> { group: n } (groups with 0 omitted). */
export function stockCounts (items = []) {
  const out = {}
  for (const it of (Array.isArray(items) ? items : [])) {
    const g = it?.name ? GROUP_OF.get(it.name) : null
    if (g && countsToward(it)) out[g] = (out[g] ?? 0) + (Number(it.count) || 0)
  }
  return out
}

/**
 * WHOLE STACKS OF ONE GROUP ABOVE THE RESERVE -> [{ slot, name, count }]. Pure over mineflayer Items ({ name, count, slot };
 * a missing slot is the list index). Smallest first (count, then slot), each taken only while the bag keeps `reserve` of
 * the group's names together and the name's total stays within `creditCap`. The cobble rule's choice
 * (bankable.mjs cobbleBankStacks) is this with group 'cobble' and creditCap 64.
 */
export function groupWholeStacks (items = [], g, { reserve = STOCK_RESERVE, creditCap = Infinity } = {}) {
  const names = new Set(namesOf(g))
  const list = (Array.isArray(items) ? items : []).map((it, i) => ({ it, i, n: Number(it?.count) || 0 }))
    .filter(x => x.it && names.has(x.it.name) && x.n > 0)
  let left = list.reduce((t, x) => t + x.n, 0)
  const per = {}, out = []
  for (const x of list.sort((a, b) => a.n - b.n || (a.it.slot ?? a.i) - (b.it.slot ?? b.i))) {
    if (left - x.n < reserve) break                       // smallest first: no bigger stack fits either
    if ((per[x.it.name] ?? 0) + x.n > creditCap) continue
    out.push({ slot: x.it.slot ?? null, name: x.it.name, count: x.n })
    per[x.it.name] = (per[x.it.name] ?? 0) + x.n
    left -= x.n
  }
  return out
}

/**
 * HOW MANY MORE THE TOWN MAY TAKE OF A GROUP -> a number >= 0, or null when it cannot be judged (an incomplete count below
 * the target). Pure over a town view { lb, complete, reserved }. Proven at target (lb + reserved >= target) is 0 with no
 * completeness needed; target 0 is always 0.
 */
export function roomUnder (view, target) {
  const base = (Number(view?.lb) || 0) + (Number(view?.reserved) || 0)
  if (!(target > 0) || base >= target) return 0
  if (!view?.complete) return null
  return target - base
}

/** Is the town PROVEN at target for disposal: the COUNTED lower bound itself (never what is on its way: stonecap's well rule,
 *  Codex r1 P1 on the coupling). Target 0 always is. */
export const provenAtTarget = (view, target) => !(target > 0) || (Number(view?.lb) || 0) >= target
