// PER-TOWN STOCK TARGETS (stocktarget-01; OWNER 10-08 ~17:20Z delegated: "do what you and codex think is right").
// Design: docs/reports/stocktargets-design-2026-10-08.md. The generalisation of stonecap's town cobble cap (cobblecap.mjs)
// to every BULK material: each GROUP of names has a per-town TARGET; the town's count of the group comes from the same
// reconciled container counts and the same claims journal as the cobble cap (one count per open records every group).
//   - below its target a group is banked as today, each transfer admitted by a CLAIM against the target;
//   - at its target it is no longer banked, never opens a new chest, and -- only where the junk well is in the build --
//     whole stacks above the bot's own STOCK_RESERVE go down the well at a full bag (owner-approved deletion);
//   - target 0 is at target by definition (0 >= 0): never banked, provable without any count.
// Cobble is the group `cobble` (target TOWN_COBBLE_CAP: 1000 since cobblecap-1000, the owner's cap) and keeps every stonecap behaviour exactly.
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
 *   A  cobble TOWN_COBBLE_CAP = 1000 (OWNER 10-14; was 256, OWNER 10-04/10-07); each log type and each planks type TOWN_WOOD_TARGET (4000 since logcap-01, OWNER 10-17; was 64) (by type, as the owner asked; the workshop
 *      needs ~7 logs + 28 planks, the mineshaft's ladders ~14 logs); stick 64 (withdraw2's iron pickaxe: 2); stone 64
 *   B  0: nothing draws them from a town (the bots' own scaffold/pillar/pit cover use them from the BAG, kept by the keeps)
 *   C  usable tools (> FLOOR uses): stone_pickaxe 16 (~3 days of the measured draw), wooden_pickaxe 4, stone axe/shovel 4,
 *      the other wood/stone axes, shovels and hoes 0. A tool is NEVER disposed or pruned: the target caps banking only.
 * andesite / diorite / granite stay junkwell-02's (well junk above STONE_GUARD; never bankable): one rule per item.
 */
/**
 * THE TOWN COBBLE CAP -- THE ONE PLACE IT IS WRITTEN (cobblecap-1000). OWNER 10-14 "can we up the chest limit for
 * cobblestones to 1000": was 256 (OWNER 10-04, stonecap-01). cobblecap.mjs re-exports it; the cobble group's target is it;
 * the bot's rows carry it (`_cobble_bank cap=`, the pruned cobble row's `target=`), and the reads take it from there or from
 * this module -- never a literal. The bag's own reserve (64 cobble + deepslate, bankable.mjs COBBLE_RESERVE) is unchanged.
 */
export const TOWN_COBBLE_CAP = 1000
/**
 * THE TOWN WOOD TARGET -- logs, planks and sticks, per type (logcap-01, OWNER 10-17 "Yup raise log limit": was 64). At 64 the
 * new plinth-02 wells turned the target into a log incinerator: prune_town sent 14,585 oak logs down the wells in 12 h. The
 * owner wants logs used (town projects, tree farm), not limited. Revert = set this back to 64.
 */
// The suite's arithmetic was written against 64; scripts/run-tests.mjs sets STOCK_WOOD_TARGET=64 so it still exercises the
// rules, and logcap.test.mjs proves the production default (no env) is 4000. No bot env file sets it.
const WOOD_ENV = String(process.env.STOCK_WOOD_TARGET ?? '').trim()
// >= 1: a 0 (or a blank that Number() reads as 0) would prune every log
export const TOWN_WOOD_TARGET = /^[0-9]+$/.test(WOOD_ENV) && Number(WOOD_ENV) >= 1 ? Number(WOOD_ENV) : 4000
export const STOCK_GROUPS = Object.freeze({
  cobble: bulk(['cobblestone', 'cobbled_deepslate'], TOWN_COBBLE_CAP),
  ...Object.fromEntries(WOODS.map(w => [`${w}_log`, bulk([`${w}_log`], TOWN_WOOD_TARGET)])),
  ...Object.fromEntries([...WOODS, 'bamboo'].map(w => [`${w}_planks`, bulk([`${w}_planks`], TOWN_WOOD_TARGET)])),
  stick: bulk(['stick'], TOWN_WOOD_TARGET),
  stone: bulk(['stone'], 64),
  dirt: bulk(['dirt'], 0),
  // matset-01 (building tier §3.4, OWNER 10-23): 0 -> 64, so the sand a town gathers stops going down the well before it can
  // become glass. Banked below 64 (sand is DEPOSIT_ALWAYS, bankable.mjs); the surplus above it goes as before. Revert = 0.
  sand: bulk(['sand', 'red_sand'], 64),
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
 * THE BUILDING PARTS (matset-01, building tier §3.4; OWNER 10-23). What the town's blueprints are built from once made:
 * stone bricks and their slab, stairs and wall; glass and glass panes; copper blocks, cut copper with its slabs and stairs,
 * and copper doors, in every oxidation, waxed or not. They are PROTECTED (never well, prune or stock-rule disposal), they
 * have NO stock target (no cap can refuse or prune them), and they are always bankable (bankable.mjs DEPOSIT_ALWAYS).
 * The list is the regex's whole match set in minecraft-data 1.21.8 (46 names; matset.test.mjs proves both directions).
 */
export const PROJECT_PART_RE = /^(stone_brick(s|_slab|_stairs|_wall)|glass|glass_pane|(waxed_)?(exposed_|weathered_|oxidized_)?(cut_copper(_slab|_stairs)?|copper_door)|(waxed_)?copper_block|(waxed_)?(exposed|weathered|oxidized)_copper)$/
const COPPER_STATES = ['', 'exposed_', 'weathered_', 'oxidized_']
export const PROJECT_PARTS = Object.freeze([
  'stone_bricks', 'stone_brick_slab', 'stone_brick_stairs', 'stone_brick_wall', 'glass', 'glass_pane',
  ...['', 'waxed_'].flatMap(w => COPPER_STATES.flatMap(o => [`${w}${o}cut_copper`, `${w}${o}cut_copper_slab`, `${w}${o}cut_copper_stairs`, `${w}${o}copper_door`])),
  'copper_block', 'waxed_copper_block', ...['', 'waxed_'].flatMap(w => ['exposed', 'weathered', 'oxidized'].map(o => `${w}${o}_copper`)),
])

/**
 * THE BUILD RESERVE (building tier §3.3, owner B3; OWNER 10-23: logs 512, copper ingots 512, cobblestone 256, torches 32,
 * sand 16, planks 71, sticks 40 -- the cobble-256 table of reserve-proposal-2026-10-23.md, superseding Q6's "512 for each",
 * which funded 0 of 13 workshops): what a town keeps that no
 * building job may spend. DECLARED here; NOTHING READS IT until mats-01, which adds the env override (a setting) and the
 * `_mats_mode` licence row. Keys are the reserved stock classes of §3.3, per town.
 */
export const BUILD_RESERVE = Object.freeze({ cobblestone: 256, logs: 512, planks: 71, sticks: 40, copper_ingot: 512, sand: 16, torch: 32 })

/**
 * NEVER DISPOSED, whatever any table says (the owner's list: iron, ores, ingots, tools, saplings, the composter's inputs;
 * and everything else with a use the bulk table does not model). The well also refuses anything the composter takes.
 */
export const PROTECTED = /(^(stone_brick(s|_slab|_stairs|_wall)|glass|glass_pane|(waxed_)?(exposed_|weathered_|oxidized_)?(cut_copper(_slab|_stairs)?|copper_door)|(waxed_)?copper_block|(waxed_)?(exposed|weathered|oxidized)_copper)$|_ore$|^raw_|_ingot$|_nugget$|^(coal|charcoal|diamond|emerald|lapis_lazuli|redstone|quartz|amethyst_shard|netherite_scrap|ancient_debris)$|_(pickaxe|axe|shovel|hoe|sword)$|_(helmet|chestplate|leggings|boots)$|^(bow|crossbow|shield|shears|flint_and_steel|fishing_rod|bucket|water_bucket|lava_bucket|milk_bucket)$|_sapling$|_propagule$|^(torch|crafting_table|furnace|blast_furnace|smoker|chest|barrel|composter|bed|bone_meal|bamboo|wheat|wheat_seeds|apple|bread)$|_bed$)/
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
