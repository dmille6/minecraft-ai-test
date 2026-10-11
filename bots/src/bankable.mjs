import { PATHFINDER_SCAFFOLD } from './scaffold.mjs'
import { remaining, FLOOR } from './toolfor.mjs'
// The peaceful kit's sword rule: `noSwords` defaults to THE SWITCH (foodskip.mjs, this process's last decision).
import { unwantedSword } from './peacefulkit.mjs'
import { peacefulFoodActive } from './foodskip.mjs'
import { admitStacks } from './cobblecap.mjs'
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

/**
 * THE COBBLE RULE (OWNER 10-04: "keep 256/town reserve, bank only when it frees a slot (both-engine no-ledger design)";
 * docs/reports/cobble-rule-design-2026-10-07.md). Cobblestone and cobbled deepslate enter storage ONLY as WHOLE STACKS
 * -- each one empties a bag slot -- and only while the bag keeps COBBLE_RESERVE of the two together:
 *   - measured 10-06/07 (30 h, 80 bots): 299 deposit runs banked 10,997 cobble; 216 of them moved an amount that was not a
 *     whole stack, and 238 left the bot under 64 (the reserve would have kept 6,350 of the 10,997);
 *   - 64 is the reserve the escape code relies on: the exit contract refuses a descent to iron depth (y 16 at sea level
 *     63) below debt 47 + reserve 12 = 59 scaffold blocks (exit-contract.mjs canContinueDescent), the stockpile rung asks
 *     for at most 64 of the stone family (milestones.mjs STOCKPILE_MAX), the town deposit keeps 64 (towndeposit.mjs) and
 *     the junk well keeps 64 reserve stone (well.mjs STONE_GUARD) -- one number in four places, and 64 is one slot.
 * Smallest stacks first (the transfer moves exactly these, by slot: skills.mjs deposit), so the most cobble stays for the
 * fewest slots. No town ledger: both engines dropped it on 10-04 (lost updates, per-bot towns, stale lower bounds).
 */
export const COBBLE_NAMES = Object.freeze(['cobblestone', 'cobbled_deepslate'])
export const COBBLE_RESERVE = 64
const COBBLE_SET = new Set(COBBLE_NAMES)
export const isCobble = name => COBBLE_SET.has(name)

/**
 * WHICH COBBLE STACKS MAY BE BANKED -> [{ slot, name, count }]. Pure over mineflayer Items ({ name, count, slot }; a
 * missing slot is the list index). Whole stacks, smallest first (count, then slot), each taken only while the bag keeps
 * `reserve` of the two names together and the name's total stays within `creditCap`.
 */
export function cobbleBankStacks (items = [], { creditCap = 64, reserve = COBBLE_RESERVE } = {}) {
  const list = (Array.isArray(items) ? items : []).map((it, i) => ({ it, i, n: Number(it?.count) || 0 }))
    .filter(x => x.it && COBBLE_SET.has(x.it.name) && x.n > 0)
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
 * THE TOWN COBBLE CAP (cobblecap.mjs: 256 per town from reconciled chest observations, with reservations). Read through a
 * reader skills.mjs installs per bot (it knows the town, the pool dir and the scan), like withdrawHolds: () -> the town
 * view { lb, complete, reserved, unknown } or null. No reader (a pure caller, a test) -> no town view: the whole-stack rule
 * alone. The deposit's TRANSFER re-judges every stack with a claim in the town's journal, so this is the plan's view, not
 * the gate.
 */
let COBBLE_TOWN = null
export function setCobbleTownReader (fn) { COBBLE_TOWN = typeof fn === 'function' ? fn : null }
/** The town view now, or null. A reader that throws is an UNKNOWN town (nothing admitted), never an open one. */
export function cobbleTownView () {
  if (!COBBLE_TOWN) return null
  try { return COBBLE_TOWN() ?? { lb: 0, complete: false, reserved: 0 } } catch { return { lb: 0, complete: false, reserved: 0 } }
}
/**
 * CAN A DEPOSIT HERE COUNT THE TOWN? (the cap's reconciliation) -> { can, note }. Installed per bot by skills.mjs: `can`
 * when the bot is in town and an uncounted town container is outside its backoff; `note` is the remedy or the stuck
 * container, for the refusal. No probe -> { can: false, note: null }.
 */
let COBBLE_RECONCILE = null
export function setCobbleReconcileProbe (fn) { COBBLE_RECONCILE = typeof fn === 'function' ? fn : null }
export function cobbleReconcileProbe () {
  if (!COBBLE_RECONCILE) return { can: false, note: null }
  try { return COBBLE_RECONCILE() ?? { can: false, note: null } } catch { return { can: false, note: null } }
}

/** A stone pickaxe costs two sticks, and the rung gates on `stick >= 2 || planks >= 2`. */
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

/**
 * WHICH RULE HELD THE ITEM BACK. A bounded vocabulary, and the phrases carry NO DIGITS.
 *
 * Measured on the deployed 8ed9450 over 4,483 deposit runs / 80 bots / 24 h: 2,203 runs
 * (49.2%) end in the "not a banking target" refusal, and in EVERY ONE of them the bot was
 * holding items the chests demonstrably accept -- a median of 32, up to 504, with `oak_log`
 * present in 1,275 and `cobblestone` in 606. The refusal is correct for the item the model
 * NAMED; what the row could not say was which of five separate rules removed it. "apple is
 * not a banking target" and "those eight cobblestone are the scaffold reserve" are the same
 * sentence today, and they need different answers.
 *
 * No digits, because `deposit-truth.test.mjs` forbids them and the reason is the same one it
 * gives: a quantity splits one refusal into one distinct `detail` string per amount held, and
 * this project's refusal reads bucket on `Counter(detail[:95])`. The rule goes FIRST in the
 * sentence for that reason too -- a long item name must not push it past the truncation.
 */
export const EXCLUSION_PHRASE = Object.freeze({
  withdraw_hold: 'just withdrawn',
  ballast: 'ballast',
  not_wanted: 'no goal wants it',
  scaffold_reserve: 'scaffold reserve',
  cobble_reserve: 'cobble reserve',
  town_cobble_cap: 'town cobble cap',
  town_cobble_unknown: 'town cobble not yet counted',
  last_of_tool_family: 'last of its tool family',
  the_only_station: 'the only station',
  peaceful_sword: 'swords are not banked in a peaceful world',
})

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
                                                 reserveScaffold = 8, noSwords = peacefulFoodActive() } = {}) {
  const want = new Set([...wants, ...STANDING_TARGETS].filter(Boolean))
  const counts = {}
  const usable = {}   // tool name -> copies above toolfor's FLOOR
  for (const it of items) {
    if (!it?.name) continue
    counts[it.name] = (counts[it.name] ?? 0) + (it.count ?? 0)
    if (TOOL_RE.test(it.name) && remaining(it) > FLOOR) usable[it.name] = (usable[it.name] ?? 0) + (it.count ?? 1)
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
  const hold = withdrawHolds()
  // THE COBBLE RULE: the whole stacks above the reserve, per name (cobbleBankStacks).
  const cobbleWhole = {}, cobbleCapped = {}
  const cobbleStacks = cobbleBankStacks(items, { creditCap })
  // THE TOWN CAP on top (cobblecap.mjs admitStacks: each admitted stack charged before the next is judged)
  const town = cobbleTownView()
  const admitted = town ? admitStacks(town, cobbleStacks.map(s => s.count)) : null
  let left = admitted ? admitted.bank.length : cobbleStacks.length
  for (const st of cobbleStacks) {
    if (left > 0 && (!admitted || admitted.bank.includes(st.count))) {
      if (admitted) admitted.bank.splice(admitted.bank.indexOf(st.count), 1)
      cobbleWhole[st.name] = (cobbleWhole[st.name] ?? 0) + st.count
      left--
    } else cobbleCapped[st.name] = admitted && admitted.refused.unknown > 0 && !admitted.refused.at_cap ? 'town_cobble_unknown' : 'town_cobble_cap'
  }
  const detail = {}
  // name -> the rule that removed it, recorded HERE so no second route can disagree with the
  // decision. Only the subtraction that actually zeroed the item is named: the reserve when it
  // alone suffices, otherwise the keep-one that applies.
  const excluded = {}
  let bankable = 0, junk = 0
  for (const [name, n] of Object.entries(counts)) {
    if (NEVER_BANKABLE.has(name)) { junk += n; excluded[name] = 'ballast'; continue }
    // COBBLE: whole stacks above the reserve, or nothing (a withdraw hold on the name holds every stack of it: a partial
    // hold would turn a whole stack into a partial one). Always a standing target, so never junk.
    if (COBBLE_SET.has(name)) {
      const whole = cobbleWhole[name] ?? 0
      if (whole <= 0 || (hold[name] ?? 0) > 0) { excluded[name] = whole > 0 ? 'withdraw_hold' : (cobbleCapped[name] ?? 'cobble_reserve'); continue }
      detail[name] = whole
      bankable += whole
      continue
    }
    let avail = n
    const m = TOOL_RE.exec(name)
    // KEEP ONE USABLE COPY OF EACH TOOL, whatever copy the transfer picks (both reviews, 10-04): mineflayer's
    // chest.deposit(type) takes the first copy by slot, so "bank n-1" could bank the good one and keep a spent one.
    // At most min(n-1, usable-1) copies are bankable -- so at least one usable copy always stays -- and with no
    // usable copy none are: spent tools never move either way.
    // THE PEACEFUL KIT (peacefulkit.mjs; OWNER 10-07 ~19:50Z: "no reason to store swords at all, this is a peaceful world"):
    // while the switch is on a sword is NEVER banked -- not even a spare copy. `noSwords` DEFAULTS TO THE SWITCH (Codex,
    // junkwell merge: the deposit-due test, the room advice, the prompt, the milestone and the withdraw planner all count
    // bankable items without passing it, so a spare sword still made a deposit due). Off = the base rule exactly, and
    // excluding can only lower a count, so no caller can be sent on a new trip by it.
    if (m && unwantedSword({ name }, noSwords)) { junk += n; excluded[name] = 'peaceful_sword'; continue }
    if (m) avail = Math.min(n - 1, (usable[name] ?? 0) - 1)
    if (KEEP_ONE.has(name)) avail -= 1      // and one of each station / bucket, even when wanted
    const reserved = scaffoldReserve[name] ?? 0
    avail -= reserved
    // JUST WITHDRAWN (withdrawpick.mjs): held back like a reserve, so the next deposit cannot hand it straight back.
    const held = Math.min(Math.max(0, avail), hold[name] ?? 0)
    avail -= held
    if (avail <= 0) {
      excluded[name] = held > 0 ? 'withdraw_hold'
        : reserved >= n ? 'scaffold_reserve'
        : m ? 'last_of_tool_family'
        : KEEP_ONE.has(name) ? 'the_only_station'
        : 'scaffold_reserve'
      continue
    }
    // A SPARE TOOL IS REAL OUTPUT. Tools are never in the standing-target list
    // (that list is materials), and without this a second pickaxe -- which costs
    // wood, sticks and a crafting table to make -- was scored as ballast.
    const isTool = !!m
    if (!isTool && !want.has(name)) { junk += avail; excluded[name] = 'not_wanted'; continue }
    const credited = Math.min(avail, creditCap)
    detail[name] = credited
    bankable += credited
  }
  return { count: bankable, junk, detail, excluded }
}

/**
 * WHAT WAS JUST WITHDRAWN, held back from deposit -> { name: count }. One bot per process, so module state is this
 * bot's. setWithdrawHold adds to a name's hold and restarts its clock; an expired hold is gone.
 */
let HOLDS = {}
export function setWithdrawHold (name, count, until) {
  if (!name || !(count > 0)) return
  const cur = HOLDS[name] && HOLDS[name].until > Date.now() ? HOLDS[name].count : 0
  HOLDS[name] = { count: cur + count, until }
}
export function withdrawHolds (now = Date.now()) {
  const out = {}
  for (const [name, h] of Object.entries(HOLDS)) if (h.until > now) out[name] = h.count
  return out
}
export function clearWithdrawHolds () { HOLDS = {} }

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
  // NOTHING BANKABLE IS NEVER DUE (nojunk SYNTHESIS: reject an empty plan before walking; both reviews of the cobble rule,
  // which makes it common -- a full bag whose cobble is all reserve): at 30+ slots this said "deposit" with 0 bankable.
  if (!(bankable > 0)) return false
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
/**
 * THE ONE WANTS AUGMENTATION, IN ONE PLACE. `depositPlan` and `bankableExclusion` must judge
 * the same inventory the same way; the previous attempt at naming the rule computed
 * bankability by two different routes and was refused in review for exactly that. Both now
 * go through here, so "what moves" and "why nothing moved" cannot disagree for any input.
 * (Codex: a bot carrying wanted iron_ore passed admission and transferred nothing because ore
 * is not a standing target -- hence DEPOSIT_ALWAYS.)
 */
function depositView (items, { wants = [], ...opts } = {}) {
  return bankableInventory(items, { ...opts, wants: [...wants, ...DEPOSIT_ALWAYS] })
}

/**
 * WHICH RULE REMOVED `item` FROM THIS DEPOSIT, or null when it did not. Pure.
 *
 * Reads the map `bankableInventory` fills in the pass that makes the decision, so this is a
 * lookup and not a re-derivation. Returns null when the item IS bankable and when the bot
 * holds none of it -- "held none" is a different sentence and `depositNoopReason` owns it.
 */
export function bankableExclusion (items = [], item = null, opts = {}) {
  if (!item) return null
  return depositView(items, opts).excluded[item] ?? null
}

export function depositPlan (items = [], item = null, { wants = [], ...opts } = {}) {
  const { detail } = depositView(items, { wants, ...opts })
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
  // SPREAD `wants` ONCE. The old comment noted the sentence and the plan can differ only for a
  // non-array `wants` (a consumed generator), which admission never passes. Naming the rule
  // means judging the inventory twice, which would consume such a generator on the first pass
  // and leave the second looking at an empty want set -- so materialise it here and the edge
  // closes for both callers rather than merely staying unlikely.
  const w = Array.isArray(wants) ? wants : [...(wants ?? [])]
  if (depositPlan(items, item, { wants: w, ...opts }).length) return null
  if (!item) {
    // the cobble cap's refusals are named even for a plain deposit (both reviews r2): the bot is carrying the cobble
    const why = COBBLE_NAMES.map(n => bankableExclusion(items, n, { wants: w, ...opts })).find(x => x === 'town_cobble_unknown' || x === 'town_cobble_cap')
    if (!why) {
      // SWORDS WHILE THE PEACEFUL SWITCH IS ON (the peacefulkit x cobble-cap composition, Codex P2): the rule is named, and the
      // move: none is needed, keep working. (No claim about the well: its own switch is stricter -- Claude r1 P3.)
      const sword = items.some(it => it?.name && bankableExclusion(items, it.name, { wants: w, ...opts }) === 'peaceful_sword')
      if (sword) return `nothing worth banking (${EXCLUSION_PHRASE.peaceful_sword}) — nothing to deposit, keep working`
      return 'nothing worth banking — nothing to deposit'
    }
    const note = why === 'town_cobble_unknown' ? cobbleReconcileProbe().note : null
    return `nothing worth banking (${EXCLUSION_PHRASE[why]}): the surplus cobble stays — nothing to deposit${note ? ` (${note})` : ''}`
  }
  let held = 0
  for (const it of items) if (it?.name === item) held += (it.count ?? 0)
  if (held <= 0) return `you are carrying no ${item} — nothing to deposit`
  // THE RULE GOES FIRST. `Counter(detail[:95])` is how this project's refusal reads bucket, and
  // a long item name would push a trailing reason past the cut -- every rule would merge back
  // into the one bucket this change exists to split.
  const phrase = EXCLUSION_PHRASE[bankableExclusion(items, item, { wants: w, ...opts })]
  if (!phrase) return `you are carrying ${item}, but ${item} is not a banking target right now — nothing to deposit`
  // THE COBBLE CAP'S UNKNOWN names its remedy (Codex r2 P3): count at town, or the container that could not be counted.
  const note = phrase === EXCLUSION_PHRASE.town_cobble_unknown ? cobbleReconcileProbe().note : null
  return `not a banking target (${phrase}): you are carrying ${item} — nothing to deposit${note ? ` (${note})` : ''}`
}
