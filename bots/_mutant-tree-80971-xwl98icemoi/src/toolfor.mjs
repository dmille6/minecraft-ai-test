// The cheapest tool that can do the job -- tool tiering and the durability floor (iron-retention plan v3).
//
// Every dig site used to equip the FASTEST tool (skills.bestTool, reflex.bestTool, and the pathfinder's own
// bestHarvestTool for travel digs), so an iron pickaxe was spent on dirt, cobble and coal until it broke: 16 iron
// pickaxes vanished during work in two days, none at a death or a deposit row. Eligibility comes from the server's
// block data (`block.harvestTools`, keyed by item type id; absent = hand-harvestable), never from a hand-written
// table: iron ore takes a stone pickaxe, gold/redstone/diamond/emerald need iron, obsidian needs diamond.
//
// Pure over (block, items). Never touches the bot.
export const TOOL_TIER = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite']
export const TOOL_RE = /_(pickaxe|axe|shovel|hoe)$/
/** Uses left at or below which a tool is RESERVED for blocks that need its tier. */
export const FLOOR = 10
/** Uses left at or below which a tool is never swung: it breaks on this dig or the next (durability lags a tick). */
export const HARD_STOP = 1
/**
 * SPENT TOOLS GET USED UP (owner, 10-03: full bags are the root blocker; never toss or drop). Axes, shovels and hoes are
 * CONSUMED, not kept: no block in the game needs one to drop (the hand harvests every log, soil and leaf), so the floor
 * reserve below -- "swing it only when nothing else can break the block" -- meant a spent axe or shovel was NEVER swung.
 * Measured 10-03 ~22:45Z on bots at >= 34/36 slots: ~118-170 copies at 2-10 uses, overwhelmingly SOLE axes (74) and
 * shovels (53), held forever. So for these three kinds: no floor reserve (every dig), and on a HARVEST dig the hard stop
 * is 0 -- the last use is spent ON the dig and the copy breaks in use. Travel and reflex digs keep HARD_STOP for every
 * kind (review, 10-03): the client shows a broken copy at 1 use until the slot update lands (> 1.5 s on the sandbox), so
 * back-to-back travel digs would re-pick a copy the server already broke and dig at hand speed server-side. A harvest
 * dig verifies the held copy and re-reads the block ~250 ms after (collectManually). The drop is unaffected: their blocks drop to the bare hand anyway, and
 * where a drop does need the tool (snow and a shovel) vanilla computes drops from a copy of the stack taken before the
 * damage (the same mechanism last_swing relies on for pickaxes, proved on the sandbox). PICKAXES ARE NOT CONSUMABLE:
 * they are the way out of a hole, and keep FLOOR, HARD_STOP, iron retention and the exit contract unchanged.
 */
export const CONSUMABLE_RE = /_(axe|shovel|hoe)$/
export const isConsumable = name => CONSUMABLE_RE.test(String(name ?? ''))
/** The hard stop for this copy: 0 for an axe/shovel/hoe on a HARVEST dig (`lastSwing`: a 1-use copy is swung and breaks);
 *  HARD_STOP for a pickaxe, and for every kind on travel and reflex digs. */
export const hardStopFor = (it, { lastSwing = false } = {}) => (lastSwing && isConsumable(it?.name) ? 0 : HARD_STOP)
/** Blocks whose drop is a stone-tool material (cobblestone / cobbled_deepslate / blackstone): the only ones a last swing may break. */
export const LAST_SWING_BLOCKS = new Set(['stone', 'cobblestone', 'deepslate', 'cobbled_deepslate', 'blackstone'])
/** A candidate slower than this multiple of the fastest eligible tool is "slow"; a cheaper tool within it wins. */
export const SLACK = 2.0

export const tier = name => TOOL_TIER.findIndex(t => String(name || '').startsWith(t + '_'))

/**
 * TOOL HYGIENE (owner, 2026-10-07; docs/reports/toolhygiene-design-2026-10-07.md): one switch, two parts --
 * no redundant crafts (toolhygiene.mjs, at admission) and the most-worn pickaxe first (here, in toolFor).
 * TOOL_HYGIENE=on|off, default on; anything else reads as on and the process says so in its `_tool_hygiene` row.
 * MEASURED 10-07 17:31Z: 338 pickaxe copies in 80 bags, 163 of them at 2-10 uses -- 133 beside a same-or-better copy
 * above FLOOR -- because byCost took the FULLEST copy of the cheapest tier and FLOOR reserved every worn one for good.
 */
export function toolHygieneMode (env = {}) {
  const raw = env?.TOOL_HYGIENE
  if (raw == null || String(raw).trim() === '') return { on: true, mode: 'on', note: 'TOOL_HYGIENE unset' }
  const v = String(raw).trim().toLowerCase()
  if (v === 'on' || v === 'off') return { on: v === 'on', mode: v, note: null }
  return { on: true, mode: 'on', note: `TOOL_HYGIENE=${String(raw).slice(0, 20)} unreadable, using on` }
}
export const TOOL_HYGIENE = Object.freeze(toolHygieneMode(typeof process !== 'undefined' ? process.env : {}))
export const isPickaxe = name => /_pickaxe$/.test(String(name ?? ''))
/** reflex.mjs ESCAPE_PICKAXES_NEEDED, restated (reflex imports this module); toolhygiene.test.mjs holds them equal.
 *  mayDigForEscape refuses a tool-requiring escape dig while the bag holds exactly ONE pickaxe above HARD_STOP. */
export const ESCAPE_RESERVE = 2
/**
 * PART 2: is this worn pickaxe (HARD_STOP < uses <= FLOOR) open? Two conditions, both reserves kept (reviews):
 *   a KEEPER in `pool` -- a different pickaxe copy of the same-or-higher tier above FLOOR, which harvests everything
 *     the worn copy can, so the reserve FLOOR exists for stays in the bag; and
 *   ESCAPE_RESERVE OTHER pickaxes that NO DEPOSIT CAN TAKE (depositSurvivors), so wearing this copy down to 1 never takes
 *     a bag -- even after the next deposit -- from two usable pickaxes to one: the escape reflex refuses to dig stone on
 *     exactly one (reflex.mjs mayDigForEscape), and in the deployed policy the hoard of worn copies is that spare.
 *     Counting merely "usable" copies was not enough (Codex round 2): {120, 60, 8} worn to {120, 60, 1}, then a deposit
 *     banked the 60 (the worst usable copy; bankable keeps one per name), leaving one usable where the deployed
 *     {113, 60, 8} kept two after the same deposit.
 * `pool` holds candidates { it, r, tier, name } (the block's eligible tools); `bag` the bag's items (default: the pool).
 */
export function hasKeeper (x, pool = [], bag = null) {
  const list = Array.isArray(pool) ? pool : []
  if (!list.some(y => y.it !== x.it && isPickaxe(y.name) && y.tier >= x.tier && y.r > FLOOR)) return false
  const items = Array.isArray(bag) ? bag : list.map(y => y.it)
  return depositSurvivors(items.filter(it => it !== x.it)) >= ESCAPE_RESERVE
}
/**
 * How many usable pickaxes (above HARD_STOP) a deposit can never take from this bag (bankable.mjs bankableInventory):
 * every copy at or under FLOOR ("spent tools never move"), plus ONE copy above FLOOR per pickaxe name (it banks at
 * most usable - 1 of a name). Pure; a test holds it to the real depositPlan + the transfer's worst-first selection.
 */
export function depositSurvivors (items = []) {
  const names = new Set()
  let worn = 0
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!isPickaxe(it?.name)) continue
    const r = remaining(it)
    if (r > FLOOR) names.add(it.name)
    else if (r > HARD_STOP) worn += (it.count ?? 1)
  }
  return worn + names.size
}
/** Uses left; Infinity when the server reports no durability (unknown counts as full, never as spent). */
export function remaining (it) {
  const max = it?.maxDurability
  if (!max) return Infinity
  return max - (it.durabilityUsed ?? 0)
}
const digTime = (block, typeId) => {
  if (typeof block?.digTime !== 'function') return 0
  try { const t = block.digTime(typeId, false, false, false); return Number.isFinite(t) ? t : Infinity } catch { return Infinity }
}

/**
 * toolFor(block, items) -> { item, hand, reason }
 *   item   the inventory item to equip, or null
 *   hand   true when the block should be dug bare-handed (item is null)
 *   reason 'cheapest' | 'slow' (no cheaper tool within SLACK, still the cheapest eligible) |
 *          'reserved_required' (only a floor-reserved tool can harvest this block) | 'hand' | 'none' |
 *          'use_up' (a spent axe/shovel/hoe that is faster than the hand, taken where the hand would otherwise win) |
 *          'last_swing' / 'spend_spent' (harvest digs only, `lastSwing`; see below)
 * Order: non-reserved eligible within the speed cap, cheapest tier first; else the cheapest non-reserved eligible
 * even if slow; else a reserved tool (the block needs its tier); else the hand if the block allows it; else none.
 * A pickaxe at or below HARD_STOP uses is never a candidate; an axe/shovel/hoe at 0 is never one (hardStopFor).
 * Axes, shovels and hoes are never reserved, and among copies of the SAME NAME the most-worn goes first, so a spent
 * copy is finished before a fuller one is started. Across tiers and kinds the order is unchanged: cheapest tier first.
 */
// Eligibility: the block's own canHarvest(type) when it has one (prismarine-block: true when no tool is required,
// else harvestTools[type]); the raw harvestTools table otherwise. null = the bare hand.
const canHarvest = (block, typeId) => {
  if (typeof block?.canHarvest === 'function') { try { return !!block.canHarvest(typeId) } catch { return false } }
  const harvest = block?.harvestTools
  return !harvest || (typeId != null && !!harvest[typeId])
}
export function toolFor (block, items = [], { lastSwing = false, hygiene = TOOL_HYGIENE.on } = {}) {
  const handOk = canHarvest(block, null)
  const tools = (Array.isArray(items) ? items : []).filter(it => it?.name && TOOL_RE.test(it.name))
  // SPEND A SPENT PICKAXE WHILE A WORKING ONE IS HELD (harvest digs on the stone family only): the working pickaxe
  // stays whole, the spent copy's last use mines the cobblestone the bot wants, and the slot empties. Never the last
  // pickaxe with uses: spentPickaxeFor requires another copy above FLOOR.
  if (lastSwing && LAST_SWING_BLOCKS.has(block?.name)) {
    const spare = spentPickaxeFor(block, tools)
    if (spare) return { item: spare, hand: false, reason: 'spend_spent' }
  }
  const eligible = tools.filter(it => canHarvest(block, it.type) && remaining(it) > hardStopFor(it, { lastSwing }))
  if (!eligible.length) {
    if (handOk) return { item: null, hand: true, reason: 'hand' }
    // THE LAST SWING, for a HARVEST dig only (the caller opts in). Measured 2026-09-28 by both engines over
    // ~22 h: 92% of 3,393 failed stone/cobblestone gathers happened while every pickaxe the bot held had
    // exactly 1 use left, and 61 of 80 bots were in that state at their last row. HARD_STOP kept those
    // copies out of the hand, so gather dug stone BARE-HANDED, watchDigging aborted it ("Digging aborted"),
    // no cobblestone was ever obtained, and no stone_pickaxe could be crafted: a replenishment trap. A copy
    // with one use still breaks one block and the drop survives (vanilla computes drops from a COPY of the
    // stack taken before damage -- proved on the sandbox before this shipped), so three spent pickaxes are
    // three cobblestone, which with two sticks is a fresh 131-use pickaxe. Travel digs and the exit
    // contract (usableTools) keep HARD_STOP: this changes only what a harvest dig may hold.
    // STONE FAMILY ONLY (both implementation reviews): the last use exists to buy the material for a new
    // stone pickaxe. On coal_ore or anything else it would spend the way out and buy nothing that rebuilds it.
    if (lastSwing && LAST_SWING_BLOCKS.has(block?.name)) {
      const last = tools.filter(it => canHarvest(block, it.type) && remaining(it) >= 1)
        .sort((a, b) => (tier(a.name) - tier(b.name)) || (remaining(a) - remaining(b)))
      if (last.length) return { item: last[0], hand: false, reason: 'last_swing' }
    }
    return { item: null, hand: false, reason: 'none' }
  }
  const timed = eligible.map(it => ({ it, t: digTime(block, it.type), r: remaining(it), tier: tier(it.name), name: it.name, spend: isConsumable(it.name), pk: isPickaxe(it.name) }))
  const handT = handOk ? digTime(block, null) : Infinity
  const fastest = Math.min(...timed.map(x => x.t), handT)
  const cap = fastest > 0 && Number.isFinite(fastest) ? fastest * SLACK : Infinity
  // A SPENT axe/shovel/hoe is open only where it is FASTER than the hand (its own block class), so no branch below --
  // `slow` included -- spends one on a block the hand digs as fast. Above FLOOR they are open as before.
  // TOOL HYGIENE, PART 2: a worn pickaxe (HARD_STOP < uses <= FLOOR) is open while the bag keeps a KEEPER -- another
  // pickaxe of the same-or-higher tier above FLOOR (hasKeeper). Without one it stays reserved, as before.
  const open = timed.filter(x => x.r > FLOOR || (x.spend && x.t < handT) || (hygiene && x.pk && hasKeeper(x, timed, tools))).sort(byCost)
  const withinCap = open.filter(x => x.t <= cap)
  // THE CHOICE IS MADE WITH THE TRANSITIVE ORDER, THEN the most-worn copy of the SAME NAME is swapped in (same name =
  // same tier and speed, so the swap cannot change which kind or tier digs). A comparator that reversed wear only within
  // a name was a cycle across kinds (both reviews: stone_axe@3 < stone_axe@90 < stone_pickaxe@50 < stone_axe@3), and the
  // pick depended on slot order.
  // TOOL HYGIENE, PART 2: pickaxes take the same swap -- the most-worn copy of the chosen name digs, the fullest is kept.
  const worn = x => x.spend || (hygiene && x.pk)
  const pick = (x, pool) => (worn(x) ? mostWornOfName(x, pool) : x).it
  if (handOk && handT <= cap) {
    // THE HAND IS THE CHEAPEST TOOL OF ALL -- except against a spent axe/shovel/hoe that is actually faster on this
    // block: its last uses are worth nothing kept and a slot used up. Real 1.21 dig times: a wooden axe takes a log
    // in 1.5 s against the hand's 3.0 s, inside SLACK, so without this a wooden axe never touched a log at all.
    const useUp = open.find(x => x.spend && x.r <= FLOOR)
    if (useUp) return { item: pick(useUp, open), hand: false, reason: 'use_up' }
    return { item: null, hand: true, reason: 'hand' }
  }
  if (withinCap.length) return { item: pick(withinCap[0], withinCap), hand: false, reason: 'cheapest' }
  if (open.length) return { item: pick(open[0], open), hand: false, reason: 'slow' }
  if (handOk) return { item: null, hand: true, reason: 'hand' }
  const reserved = timed.filter(x => !open.includes(x)).sort(byCost)
  // NOT most-worn here (round 1 reviews): among copies all at or under FLOOR, the deployed fullest-first keeps two of them
  // usable longest -- the escape reflex's reserve (mayDigForEscape) counts copies, not uses.
  return { item: reserved[0].it, hand: false, reason: 'reserved_required' }
}

/** The cost order, TRANSITIVE: cheaper tier first; among equal tiers the fuller copy (unknown durability ties). */
export function byCost (a, b) {
  const d = (a.tier - b.tier) || (b.r - a.r)
  return Number.isNaN(d) ? 0 : d
}
/**
 * The most-worn candidate in `pool` with x's name (x itself when none is more worn): an axe/shovel/hoe finishes one
 * copy before starting the next. Same name = same tier and dig time, so this never changes the kind or tier chosen.
 */
export function mostWornOfName (x, pool = []) {
  let best = x
  for (const y of pool) if (y.name === x.name && y.r < best.r) best = y
  return best
}
/**
 * WAS THE CHOSEN COPY THE ONE THAT WENT INTO THE HAND? -> 'swing' | 'hand' | 'refuse'. For a copy at or below
 * HARD_STOP (a last swing, a spent pickaxe spent, a 1-use axe/shovel/hoe), compared by name AND uses, captured BEFORE
 * the equip: a name-only check let a failed equip of a 1-use stone_pickaxe dig with the 100-use stone_pickaxe already
 * in hand (both reviews). On a mismatch an axe/shovel/hoe on a hand-harvestable block falls back to the HAND (its block
 * drops to the hand anyway); a pickaxe, or a block that needs the tool, is refused -- never dug with the working copy.
 */
export function spentEquipOutcome ({ chosen, held, handOk = false } = {}) {
  if (!chosen) return 'swing'
  if (held && held.name === chosen.name && remaining(held) === chosen.left) return 'swing'
  return isConsumable(chosen.name) && handOk ? 'hand' : 'refuse'
}
/** The bare hand harvests this block (prismarine canHarvest(null), else no harvestTools). */
export const handHarvests = block => canHarvest(block, null)
/**
 * PART 2 (harvest digs on the stone family): the 1-use pickaxe to swing INSTEAD of a working one, or null. Only while
 * ANOTHER pickaxe above FLOOR that can harvest the block is held -- so the copy swung is never the last pickaxe with
 * uses -- and only a copy at exactly 1 use (a 0 is a phantom the server already broke). Cheapest tier first.
 */
export function spentPickaxeFor (block, items = []) {
  if (!LAST_SWING_BLOCKS.has(block?.name)) return null
  const picks = (Array.isArray(items) ? items : []).filter(it => /_pickaxe$/.test(it?.name ?? '') && canHarvest(block, it.type))
  if (!picks.some(it => remaining(it) > FLOOR)) return null
  return picks.filter(it => remaining(it) === 1).sort((a, b) => tier(a.name) - tier(b.name))[0] ?? null
}

const isTool = it => !!(it?.name && TOOL_RE.test(it.name))
// TOOL HYGIENE: the travel fallback follows the same two rules as toolFor -- a worn pickaxe beside a keeper is open, and
// within a tier the most-worn copy goes first (Codex review, round 1: otherwise the fallback wore the fullest copy).
const cheapestOpen = (items, hygiene = TOOL_HYGIENE.on) => {
  const list = (Array.isArray(items) ? items : []).filter(isTool)
  const pool = list.map(it => ({ it, r: remaining(it), tier: tier(it.name), name: it.name }))
  // THE DEPLOYED CHOICE FIRST (cheapest tier, fullest first, copies above FLOOR only), THEN for a pickaxe the most-worn
  // copy of that same NAME that the hygiene rule opens. Never a shift across kinds or tiers (Claude rounds 1 and 2: a
  // worn copy added before the sort put wooden_pickaxe@5 ahead of stone_axe@100), and never a copy at HARD_STOP.
  const first = pool.filter(x => x.r > FLOOR).sort((a, b) => (a.tier - b.tier) || (b.r - a.r))[0]
  if (!first) return null
  if (!(hygiene && isPickaxe(first.name))) return first.it
  const open = pool.filter(x => x.name === first.name && (x.r > FLOOR || (x.r > HARD_STOP && hasKeeper(x, pool, list))))
  return mostWornOfName(first, open).it
}

/**
 * PART 2's LIVENESS TALLY: digs where hygiene chose a different copy than the base policy (hygiene off) would have.
 * index.mjs writes it as at most one `_worn_first` row per process per WORN_FIRST_ROW_MS while it is non-zero.
 */
export const WORN_FIRST_ROW_MS = 10 * 60 * 1000
const wornFirst = { n: 0, last: null, ctx: null }
const usesTag = it => `${it.name}@${Number.isFinite(remaining(it)) ? remaining(it) : 'full'}`
export function noteWornFirst (block, items, d, opts = {}, mode = 'harvest') {
  if (!(opts?.hygiene ?? TOOL_HYGIENE.on) || !d?.item) return false
  const base = toolFor(block, items, { ...opts, hygiene: false })
  if (base.item === d.item) return false
  wornFirst.n++
  wornFirst.last = `${usesTag(d.item)} over ${base.item ? usesTag(base.item) : base.reason} on ${block?.name ?? '?'} (${d.reason})`
  // THE CONTEXT OF THE LAST CHANGED PICK, as structured args: the read re-derives the choice from it (G3) -- the chosen
  // copy, the reason, and every pickaxe in the bag at that moment.
  wornFirst.ctx = { block: block?.name ?? null, chosen: usesTag(d.item), base: base.item ? usesTag(base.item) : base.reason, reason: d.reason, mode,
                    picks: (Array.isArray(items) ? items : []).filter(it => isPickaxe(it?.name)).map(usesTag).join(',') }
  return true
}
/** Read and reset the tally -> { n, last, ctx }. */
export function takeWornFirst () { const out = { n: wornFirst.n, last: wornFirst.last, ctx: wornFirst.ctx }; wornFirst.n = 0; wornFirst.last = null; wornFirst.ctx = null; return out }

/**
 * The decision APPLIED: returns the item to equip (or null) and, when the answer is the hand or nothing, takes a
 * held tool OUT of the hand -- otherwise "dig by hand" digs with whatever pickaxe happened to be held, which was the
 * whole bug (Codex pass 1). The unequip is fire-and-forget: it is a window click, and the socket delivers it before
 * the dig-start packet that follows, so the server sees an empty hand at dig time.
 */
export function applyToolPolicy (bot, block, opts = {}) {
  const items = bot?.inventory?.items?.() ?? []
  const d = toolFor(block, items, opts)
  try { noteWornFirst(block, items, d, opts, opts?.lastSwing ? 'harvest' : 'dig') } catch {}
  if (opts?.decision && typeof opts.decision === 'object') opts.decision.reason = d.reason   // the caller names its row by it
  if (!d.item && isTool(bot?.heldItem)) {
    // NEVER bot.unequip('hand') blindly: mineflayer's unequip tosses the stack when the inventory is full (Codex
    // pass 2). A non-tool item swapped INTO the hand is the safe form; unequip only with a free slot to receive it.
    const filler = handFiller(items)
    try {
      const p = filler ? bot.equip?.(filler, 'hand') : ((bot.inventory?.emptySlotCount?.() ?? 0) > 0 ? bot.unequip?.('hand') : null)
      if (p?.catch) p.catch(() => {})
    } catch {}
  }
  return d.item
}
/** Something harmless to hold instead of a tool: the first non-tool stack (a block, food, a stick). */
export const handFiller = items => (Array.isArray(items) ? items : []).find(it => it?.name && !isTool(it) && !/_(sword|bow|crossbow|trident|shield)$/.test(it.name)) ?? null

/**
 * For the pathfinder's travel digs, which equip whatever this returns and dig at once (no unequip step exists there):
 * the decision's item; else, when a tool is held and would otherwise stay in the hand, the cheapest open tool of any
 * kind (a wooden shovel digging stone slowly costs less than an iron pickaxe digging it fast), else a non-tool filler
 * so a hard-stopped pickaxe is never the thing that digs; else null.
 */
export function travelTool (block, items, held, { hygiene = TOOL_HYGIENE.on } = {}) {
  const d = toolFor(block, items, { hygiene })
  // NOT tallied here: the pathfinder calls bestHarvestTool while PLANNING (movements.js prices every candidate dig), so a
  // tally would count plans, not digs (Codex round 2), and double toolFor on the planner's hot path.
  if (d.item) return d.item
  if (!isTool(held)) return null
  // WHEN THE HAND IS THE ANSWER, HOLD A BLOCK, NOT A PICKAXE (both engines, 09-30: ~1,630 pickaxe uses/day went on dirt,
  // leaves and logs -- this returned the cheapest open tool, a wooden pickaxe, ahead of the dirt stack in the bag). Only
  // when the hand cannot break it does a tool of any kind beat a filler.
  if (d.hand) return handFiller(items) ?? cheapestOpen(items, hygiene)
  return cheapestOpen(items, hygiene) ?? handFiller(items)   // a block in the hand beats a spent pickaxe in the hand (the pathfinder equips whatever this returns)
}

/**
 * EMPTY THE HAND WITHOUT THROWING ANYTHING AWAY. mineflayer's unequip('hand') (simple_inventory.js equipEmpty) TOSSES the
 * held stack when neither the hotbar nor the inventory has a free slot -- PROVED on the sandbox 2026-09-30 (36/36: the
 * stone pickaxe on the ground; 35/36: kept) and against mineflayer's own code on a real window (tool-safe-window test).
 * The fleet lost ~45-94 good stone pickaxes a day this way. Order of preference (Codex review: even with a free slot,
 * unequip can toss if a pickup fills that slot between its clicks, so it is the LAST resort, not the first):
 *   'empty'        nothing held;
 *   'kept'         a non-tool in hand (a block digs like the hand) -- never unequipped, so never tossed;
 *   'filler'       a harmless non-tool stack swapped INTO the hand (equip swaps; it never uses the -999 drop);
 *   'unequip'      no filler, a KNOWN free slot: the plain unequip;
 *   'hotbar_other' a bag of only tools: select a hotbar item that is NOT a pickaxe (no click at all) -- the escape
 *                  must not swing the last pickaxe (mayDigForEscape's reserve);
 *   'kept_tool'    nothing else possible: keep it (a use spent beats a tool thrown away);
 *   'failed'       the swap/unequip did not take (checked after, not assumed).
 */
export async function emptyHand (bot) {
  const held = bot?.heldItem
  if (!held) return 'empty'
  if (!isTool(held)) return 'kept'
  const items = bot.inventory?.items?.()
  const filler = Array.isArray(items) ? handFiller(items) : null
  if (filler) {
    try { await bot.equip(filler, 'hand') } catch {}
    return isTool(bot.heldItem) ? 'failed' : 'filler'
  }
  if (freeSlots(bot) > 0) {
    try { await bot.unequip('hand') } catch {}
    return isTool(bot.heldItem) ? 'failed' : 'unequip'
  }
  const slots = bot.inventory?.slots
  if (Array.isArray(slots) && typeof bot.setQuickBarSlot === 'function') {
    for (let i = 0; i < 9; i++) {
      const it = slots[36 + i]
      if (it && !/_pickaxe$/.test(it.name)) { try { bot.setQuickBarSlot(i) } catch {} ; return /_pickaxe$/.test(bot.heldItem?.name ?? '') ? 'failed' : 'hotbar_other' }
    }
  }
  return 'kept_tool'
}
/** Free player slots (9..44, hotbar included): mineflayer's own count, else the stacks against 36; UNKNOWN is 0, never "free". */
export function freeSlots (bot) {
  try {
    const n = bot?.inventory?.emptySlotCount?.()
    if (Number.isFinite(n)) return n
    const items = bot?.inventory?.items?.()
    return Array.isArray(items) ? Math.max(0, 36 - items.length) : 0
  } catch { return 0 }
}
/** Pure: was a TOOL toss averted? Only on a FULL bag, only for a held tool, only when the hand was not simply unequipped. */
export const tossAverted = (heldName, how, full) => !!full && !!heldName && TOOL_RE.test(heldName) && ['filler', 'hotbar_other', 'kept_tool'].includes(how)

/**
 * THE SCAFFOLD A BOT PLACES, CHEAPEST FIRST (both engines, 09-30: escapes placed ~1,170-1,250 logs/day while cheaper blocks
 * were held -- the reflex took the first PLACEABLE stack in inventory order). Rank: cheap non-falling blocks, then
 * falling ones (sand, gravel -- every site places onto a solid top face, where they hold), then cobblestone (the pickaxe
 * material), then planks, then logs/wood/stems; within a rank the biggest stack. Never refuses: a bot holding only wood
 * still climbs with wood.
 */
const SCAFFOLD_RANK = [
  [0, /^(dirt|coarse_dirt|rooted_dirt|stone|andesite|diorite|granite|deepslate|tuff|netherrack|sandstone|red_sandstone|dripstone_block)$/],
  [1, /^(sand|gravel)$/],
  // COBBLESTONE AFTER THE OTHER CHEAP BLOCKS (Claude review): it is the stone-pickaxe material last-swing exists to
  // recover. Still before any wood.
  [2, /^(cobblestone|cobbled_deepslate)$/],
  [3, /_planks$/],
  [4, /(_log|_wood|_hyphae)$|^(crimson_stem|warped_stem|stripped_crimson_stem|stripped_warped_stem)$/],
]
export const scaffoldRank = name => { for (const [r, re] of SCAFFOLD_RANK) if (re.test(name)) return r; return null }
export function pickScaffold (items = [], placeable = /./) {
  const c = (Array.isArray(items) ? items : []).filter(it => it?.name && placeable.test(it.name) && scaffoldRank(it.name) != null)
  c.sort((a, b) => (scaffoldRank(a.name) - scaffoldRank(b.name)) || ((b.count ?? 0) - (a.count ?? 0)))
  return c[0] ?? null
}

/** Every tool the bot could still swing at this block (ignores the floor; honours the hard stop). Used by the exit contract. */
export function usableTools (block, items = []) {
  return (Array.isArray(items) ? items : []).filter(it => it?.name && TOOL_RE.test(it.name) && canHarvest(block, it.type) && remaining(it) > HARD_STOP)
}
