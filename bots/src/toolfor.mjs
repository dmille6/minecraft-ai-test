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
/** Blocks whose drop is a stone-tool material (cobblestone / cobbled_deepslate / blackstone): the only ones a last swing may break. */
export const LAST_SWING_BLOCKS = new Set(['stone', 'cobblestone', 'deepslate', 'cobbled_deepslate', 'blackstone'])
/** A candidate slower than this multiple of the fastest eligible tool is "slow"; a cheaper tool within it wins. */
export const SLACK = 2.0

export const tier = name => TOOL_TIER.findIndex(t => String(name || '').startsWith(t + '_'))
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
 *          'reserved_required' (only a floor-reserved tool can harvest this block) | 'hand' | 'none'
 * Order: non-reserved eligible within the speed cap, cheapest tier first; else the cheapest non-reserved eligible
 * even if slow; else a reserved tool (the block needs its tier); else the hand if the block allows it; else none.
 * A tool at or below HARD_STOP uses is never a candidate.
 */
// Eligibility: the block's own canHarvest(type) when it has one (prismarine-block: true when no tool is required,
// else harvestTools[type]); the raw harvestTools table otherwise. null = the bare hand.
const canHarvest = (block, typeId) => {
  if (typeof block?.canHarvest === 'function') { try { return !!block.canHarvest(typeId) } catch { return false } }
  const harvest = block?.harvestTools
  return !harvest || (typeId != null && !!harvest[typeId])
}
export function toolFor (block, items = [], { lastSwing = false } = {}) {
  const handOk = canHarvest(block, null)
  const tools = (Array.isArray(items) ? items : []).filter(it => it?.name && TOOL_RE.test(it.name))
  const eligible = tools.filter(it => canHarvest(block, it.type) && remaining(it) > HARD_STOP)
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
  const timed = eligible.map(it => ({ it, t: digTime(block, it.type), r: remaining(it), tier: tier(it.name) }))
  const fastest = Math.min(...timed.map(x => x.t), handOk ? digTime(block, null) : Infinity)
  const cap = fastest > 0 && Number.isFinite(fastest) ? fastest * SLACK : Infinity
  const byCost = (a, b) => (a.tier - b.tier) || (b.r - a.r)   // cheaper tier first; among equals the fuller tool
  const open = timed.filter(x => x.r > FLOOR).sort(byCost)
  const withinCap = open.filter(x => x.t <= cap)
  if (handOk && digTime(block, null) <= cap) return { item: null, hand: true, reason: 'hand' }   // the hand is the cheapest tool of all
  if (withinCap.length) return { item: withinCap[0].it, hand: false, reason: 'cheapest' }
  if (open.length) return { item: open[0].it, hand: false, reason: 'slow' }
  if (handOk) return { item: null, hand: true, reason: 'hand' }
  const reserved = timed.filter(x => x.r <= FLOOR).sort(byCost)
  return { item: reserved[0].it, hand: false, reason: 'reserved_required' }
}

const isTool = it => !!(it?.name && TOOL_RE.test(it.name))
const cheapestOpen = items => (Array.isArray(items) ? items : []).filter(it => isTool(it) && remaining(it) > FLOOR).sort((a, b) => (tier(a.name) - tier(b.name)) || (remaining(b) - remaining(a)))[0] ?? null

/**
 * The decision APPLIED: returns the item to equip (or null) and, when the answer is the hand or nothing, takes a
 * held tool OUT of the hand -- otherwise "dig by hand" digs with whatever pickaxe happened to be held, which was the
 * whole bug (Codex pass 1). The unequip is fire-and-forget: it is a window click, and the socket delivers it before
 * the dig-start packet that follows, so the server sees an empty hand at dig time.
 */
export function applyToolPolicy (bot, block, opts = {}) {
  const items = bot?.inventory?.items?.() ?? []
  const d = toolFor(block, items, opts)
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
export function travelTool (block, items, held) {
  const d = toolFor(block, items)
  if (d.item) return d.item
  if (!isTool(held)) return null
  // WHEN THE HAND IS THE ANSWER, HOLD A BLOCK, NOT A PICKAXE (both engines, 09-30: ~1,630 pickaxe uses/day went on dirt,
  // leaves and logs -- this returned the cheapest open tool, a wooden pickaxe, ahead of the dirt stack in the bag). Only
  // when the hand cannot break it does a tool of any kind beat a filler.
  if (d.hand) return handFiller(items) ?? cheapestOpen(items)
  return cheapestOpen(items) ?? handFiller(items)   // a block in the hand beats a spent pickaxe in the hand (the pathfinder equips whatever this returns)
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
