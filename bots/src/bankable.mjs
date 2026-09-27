import { PATHFINDER_SCAFFOLD } from './scaffold.mjs'
// WHAT IS ACTUALLY WORTH BANKING.
//
// "deposited items per bot-hour" is a CO-PRIMARY endpoint of this experiment and
// NO milestone has ever asked a bot to deposit. The closest, `return`, is scored
// on POSITION: a bot satisfies it by standing within 15 blocks of home with a
// full inventory and walking away again. 647 deposit calls across 1.18M events is
// the model occasionally choosing it unprompted.
//
// The obvious fix -- "deposit when your inventory is full" -- fails twice on this
// fleet's measured state:
//
//   inventories sit at a MEDIAN OF 16 of 36 stacks, so a fullness trigger would
//   almost never fire; and the median distance from town is 804 BLOCKS, with only
//   9% of samples within 100, so "walk home and bank" is a six-minute round trip
//   through the exact travel failures that already kill deposits (156 stuck, 107
//   drowning, 53 stagnation).
//
// WHY VALUE IS DERIVED AND NOT LISTED. Hand-maintaining a Minecraft economy is
// both endless and wrong: what is worth carrying depends on what the bot is
// trying to do. So bankable means "part of declared work" -- the milestone's
// wants, the ingredients of those wants, and the standing stockpile targets.
// Everything else is ballast. A bot carrying 99 crafting tables, leaf_litter and
// brown_egg is carrying 13% junk at the median and 42% at p90, and depositing
// that would inflate a co-primary endpoint without meaning anything.

/** Ballast: things a bot accumulates that no goal ever asked for. */
const NEVER_BANKABLE = new Set([
  'leaf_litter', 'brown_egg', 'egg', 'oak_sapling', 'short_grass', 'dead_bush',
  'seagrass', 'vine', 'poppy', 'dandelion', 'pointed_dripstone', 'rail', 'bamboo',
])

/** Always worth keeping in the town chest, whatever the current rung asks for. */
const STANDING_TARGETS = new Set([
  'oak_log', 'birch_log', 'jungle_log', 'oak_planks', 'stick', 'cobblestone',
  'cobbled_deepslate', 'stone', 'coal', 'raw_iron', 'iron_ingot', 'diamond',
])

/**
 * IS THIS A BLOCK THE PATHFINDER CAN BUILD WITH? Pure.
 *
 * `scaffold.mjs`'s PATHFINDER_SCAFFOLD is what `index.mjs` pushes into mineflayer's
 * `scafoldingBlocks`, so it is the authoritative answer — plus the stone family, which the
 * original reserve tested by regex. THE UNION IS LOAD-BEARING: `cobblestone` is NOT in
 * PATHFINDER_SCAFFOLD (only `mossy_cobblestone` is), so using set membership alone would
 * have silently removed the reserve this code was written for.
 */
const SCAFFOLD_SET = new Set(PATHFINDER_SCAFFOLD)
export function isScaffoldItem (name) {
  return SCAFFOLD_SET.has(name) || /^(cobblestone|cobbled_deepslate|stone)$/.test(name)
}

/** A stone pickaxe costs two sticks, and the rung gates on `stick >= 2 || planks >= 2`. */
import { remaining } from './toolfor.mjs'

/**
 * WHICH COPIES OF A TOOL GO IN THE CHEST, AND WHICH ONE STAYS. Pure and exported.
 *
 * MEASURED, and this is the whole reason it exists: held pickaxes sit at a MEDIAN 1.7%
 * durability (237 of 295 at <=10%) while BANKED ones sit at a median 48.1%, with 484 above 75%
 * and 112 never used at all. A durability-blind split cannot produce a 28x asymmetry by chance --
 * something was systematically keeping the worn copy.
 *
 * It was the absence of a choice. `bankableInventory` does `avail -= 1` per tool NAME and nothing
 * anywhere reads durability, so which copy survives is decided by mineflayer: `transfer` finds
 * source stacks with `findItemRange`, which scans ASCENDING from `inventoryStart`
 * (prismarine-windows Window.js:308), and the hotbar is the LAST range in a container window. So
 * the main-inventory copies are banked and the hotbar copy is kept, whatever its wear.
 *
 * `remaining` is toolfor.mjs's own, deliberately: `toolFor()` is what decides whether the kept
 * copy can dig anything, and a second implementation here would be the ninth time a producer and
 * a consumer disagreed about the same predicate. It treats unknown durability as Infinity -- full,
 * never spent -- which is the direction toolfor.mjs already chose.
 */
export function toolBankOrder (copies = []) {
  const sorted = copies.slice().sort((a, b) => remaining(a) - remaining(b) || (a.slot ?? 0) - (b.slot ?? 0))
  return { bank: sorted.slice(0, -1), keep: sorted.at(-1) ?? null }
}

export const RESERVE_RECIPE = 2

/**
 * WHAT A DEPOSIT MUST LEAVE BEHIND, AS A TOTAL — not per item. Pure.
 *
 * The old reserve tested `/cobblestone|cobbled_deepslate|stone|dirt/`: the stone family and
 * nothing else, while STANDING_TARGETS banks `oak_log`, `birch_log`, `jungle_log`,
 * `oak_planks` and `stick` with no reserve at all. Two consequences, both measured:
 *
 *   THE PATHFINDER'S OWN BRIDGING BLOCKS. `scaffold.mjs` records that "16.2% (13 bots) hold
 *   WOOD and nothing else the pathfinder will accept, and for those bots A* cannot plan a
 *   tower or a bridge at all." And 817 of 819 deposit `skill_error` rows in 24 h are
 *   mineflayer-pathfinder prose. So a deposit that SUCCEEDS strips the blocks the next one
 *   needs in order to walk anywhere.
 *
 *   THE PICKAXE. 874 sticks went into chests in 24 h and 0 came back out.
 *
 * A TOTAL, BECAUSE THE INTENT WAS ALWAYS A TOTAL — the original comment reads "keep enough
 * to pillar out". Reserving 8 of EACH family would hoard ~24 blocks to pillar once, and
 * inventories already sit at 28 of 36 slots occupied (median, measured at deposit time), so
 * over-reserving re-creates the slot pressure deposit exists to relieve. Cheapest families
 * are spent first so the reserve is filled with the least valuable scaffold available.
 *
 * `dirt` is dropped: it was UNREACHABLE, being absent from STANDING_TARGETS while the branch
 * was gated on membership first.
 */
export function scaffoldKeep (counts = {}, reserveScaffold = 8) {
  const keep = {}
  if (reserveScaffold > 0) {
    let budget = reserveScaffold
    // DEPOSIT_VALUE is ordered MOST valuable first, so a higher index is cheaper and an
    // absent item is cheapest of all. Spend the reserve on the cheapest scaffold available,
    // so the budget never holds back iron when cobblestone would pillar just as well.
    const rank = n => { const i = DEPOSIT_VALUE.indexOf(n); return i < 0 ? Number.MAX_SAFE_INTEGER : i }
    const cheapestFirst = Object.keys(counts)
      .filter(isScaffoldItem)
      .sort((a, b) => rank(b) - rank(a) || a.localeCompare(b))
    for (const name of cheapestFirst) {
      if (budget <= 0) break
      const take = Math.min(budget, counts[name] ?? 0)
      if (take > 0) { keep[name] = take; budget -= take }
    }
  }
  if (counts.stick) keep.stick = Math.max(keep.stick ?? 0, Math.min(RESERVE_RECIPE, counts.stick))
  return keep
}

const TOOL_RE = /_(pickaxe|axe|shovel|sword|hoe)$/
/** One of each of these stays in the bot's hands whatever the wants say: the stations and the bucket are how it
 *  works, and banking the only copy disarms it the way banking the only pickaxe does (Codex, deposit pass 2). */
export const KEEP_ONE = new Set(['crafting_table', 'furnace', 'blast_furnace', 'smoker', 'bucket', 'water_bucket', 'lava_bucket'])

/**
 * What could this bot bank right now, and how much of it is real?
 *
 * Reserves are subtracted BEFORE counting, because a bot that banks the pickaxe
 * it is mining with, or the blocks it needs to pillar out, has not made a
 * deposit -- it has disarmed itself. That is the same class of mistake as the
 * descent contract spending its own exit.
 *
 * `creditCap` stops one absurd stack from dominating the endpoint: 99 crafting
 * tables is worth at most what the goals actually want, not 99.
 */
export function bankableInventory (items = [], { wants = [], creditCap = 64,
                                                 reserveScaffold = 8 } = {}) {
  const want = new Set([...wants, ...STANDING_TARGETS].filter(Boolean))
  const counts = {}
  for (const it of items) {
    if (!it?.name) continue
    counts[it.name] = (counts[it.name] ?? 0) + (it.count ?? 0)
  }

  // Reserve the single best tool of each family. Banking your only pickaxe
  // underground is how a bot spends ten hours entombed with the answer in its
  // pockets.
  const keptTool = new Set()
  for (const name of Object.keys(counts)) {
    const m = TOOL_RE.exec(name)
    if (m && !keptTool.has(m[1])) keptTool.add(m[1])
  }

  const scaffoldReserve = scaffoldKeep(counts, reserveScaffold)
  const detail = {}
  let bankable = 0, junk = 0
  for (const [name, n] of Object.entries(counts)) {
    if (NEVER_BANKABLE.has(name)) { junk += n; continue }
    let avail = n
    const m = TOOL_RE.exec(name)
    if (m) avail -= 1                       // keep one of each tool family
    if (KEEP_ONE.has(name)) avail -= 1      // and one of each station / bucket, even when wanted
    avail -= (scaffoldReserve[name] ?? 0)
    if (avail <= 0) continue
    // A SPARE TOOL IS REAL OUTPUT. Tools are never in the standing-target list
    // (that list is materials), and without this a second pickaxe -- which costs
    // wood, sticks and a crafting table to make -- was scored as ballast.
    const isTool = !!m
    if (!isTool && !want.has(name)) { junk += avail; continue }
    const credited = Math.min(avail, creditCap)
    detail[name] = credited
    bankable += credited
  }
  return { count: bankable, junk, detail }
}

/**
 * Should this bot deposit NOW?
 *
 * The load-bearing clause is the second one. "Carrying a lot" alone would walk a
 * bot home from 1,000 blocks out to bank three cobblestone, and travel is where
 * deposits already die. So a deposit is due only when the bot has real surplus
 * AND banking is cheap -- storage in sight, already near town, or under a
 * deposit goal it accepted.
 */
export function depositDue ({ bankable, distHome, storageWithin48 = false,
                              onDepositMilestone = false, occupiedSlots = 0,
                              minBankable = 12, nearHome = 96 }) {
  if (bankable < minBankable && occupiedSlots < 30) return false
  return !!storageWithin48 || distHome <= nearHome || !!onDepositMilestone
}

/**
 * WHAT TO HAND OVER, IN WHAT ORDER. The deposit loop used to hand over EVERY
 * stack in inventory order: measured 2026-09-13 over 24 h, the fleet deposited
 * 81 pickaxes, 62 furnaces, 59 crafting tables and 17 buckets into chests --
 * "iron produced but not kept" was partly the bots banking their own tools. The
 * plan is bankableInventory's allowance (one tool of each family kept, 8
 * scaffold kept, stations and junk never banked), restricted to the named item
 * when one is named, and ordered so the valuable stacks land first when the
 * chest is short of room. Pure.
 */
export const DEPOSIT_VALUE = ['diamond', 'iron_ingot', 'raw_iron', 'iron_ore', 'coal', 'oak_log', 'birch_log', 'jungle_log', 'oak_planks', 'stick', 'stone', 'cobbled_deepslate', 'cobblestone']
/** Banked whenever carried, wanted or not: ores and rare drops are never ballast. */
export const DEPOSIT_ALWAYS = ['iron_ore', 'deepslate_iron_ore', 'raw_copper', 'copper_ingot', 'raw_gold', 'gold_ingot', 'redstone', 'lapis_lazuli', 'emerald', 'amethyst_shard']
export function depositPlan (items = [], item = null, { wants = [], ...opts } = {}) {
  // the same wants admission judged with, plus the always-banked list (Codex: a bot carrying wanted iron_ore
  // passed admission and transferred nothing because ore is not a standing target)
  const { detail } = bankableInventory(items, { ...opts, wants: [...wants, ...DEPOSIT_ALWAYS] })
  const rank = name => { const i = DEPOSIT_VALUE.indexOf(name); return i < 0 ? (TOOL_RE.test(name) ? DEPOSIT_VALUE.length : DEPOSIT_VALUE.length + 1) : i }
  return Object.entries(detail)
    .filter(([name]) => !item || name === item)   // EXACT: a named item never sweeps in its substrings
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => rank(a.name) - rank(b.name))
}

/**
 * WHY WAS THERE NOTHING TO HAND OVER — the sentence the bot is actually owed.
 *
 * THE SENTENCE IS FALSE BY CONSTRUCTION, WHICH IS STRONGER THAN A COUNT.
 * `admission.mjs:326` refuses `deposit <item>` with `deposit_item_missing`
 * whenever the bot holds none of the named item, BEFORE the skill runs, and both
 * the model path and the work-order path go through that gate. So every named
 * refusal that reaches this point is a bot that HAS the item. "nothing matching
 * <item> to hand over" cannot be true on the fleet path.
 *
 * My first framing of this cited 2,078 of 2,079 runs where the bot held the item
 * -- 100.0%. That number is real but it is a restatement of the upstream guard,
 * not evidence, and the one `dirt` exception is a gate/skill race rather than a
 * positive control. The claim rests on the guard.
 *
 * WHAT IS MEASURED, on the deployed 9b572aa over 3,226 deposit runs / 54 bots /
 * 24 h: 2,079 of those runs end in this refusal, `apple` alone is 1,494 of the
 * 2,587 named runs, and 1,874 of the refusals (90.1%) are a bot re-proposing an
 * item it has already been refused -- one of them 151 times in a day. The model
 * cannot learn a rule it is never told.
 *
 * The `carrying no <item>` branch below is therefore UNREACHABLE from the fleet
 * path and reachable only from chat (`commands.mjs:105`). It is kept because it
 * is correct for that caller, not because it is expected to fire.
 *
 * ONE DEFINITION, EVALUATED TWICE, AND THAT WORDING IS DELIBERATE. This calls
 * `depositPlan` itself, so the sentence and the transfer cannot disagree for any
 * input admission can produce. They can differ only for a non-array `wants` (a
 * consumed generator), which admission never passes. The previous attempt at
 * this patch computed bankability by two different routes and was refused in
 * review for it.
 *
 * NO COUNT IN THE MESSAGE. An embedded number splits one refusal into one
 * distinct `detail` string per quantity held, and this project's own refusal
 * reads bucket on `Counter(detail[:95])` (`sneak.py`, `wo5.py`): the largest
 * refusal on the fleet would fall out of every top-N the day this shipped.
 *
 * NOT THE PHRASE "worth banking". `prompt.mjs:619` puts "CARRYING: N items worth
 * banking" in the same prompt, computed WITHOUT wants; re-using the phrase here
 * produces two lines that are semantically consistent and read as a flat
 * contradiction, with nothing naming the scope.
 *
 * It suggests NO remedy: that machinery produced five findings in the review of
 * the larger patch.
 *
 * Returns null when there IS something to hand over, so the caller keeps its own
 * wording rather than this one asserting something it cannot see.
 */
export function depositNoopReason (items = [], item = null, { wants = [], ...opts } = {}) {
  if (depositPlan(items, item, { wants, ...opts }).length) return null
  if (!item) return 'nothing worth banking — nothing to deposit'
  let held = 0
  for (const it of items) if (it?.name === item) held += (it.count ?? 0)
  if (held <= 0) return `you are carrying no ${item} — nothing to deposit`
  return `you are carrying ${item}, but ${item} is not a banking target right now — nothing to deposit`
}
