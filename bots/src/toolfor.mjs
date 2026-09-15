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
export function toolFor (block, items = []) {
  const handOk = canHarvest(block, null)
  const tools = (Array.isArray(items) ? items : []).filter(it => it?.name && TOOL_RE.test(it.name))
  const eligible = tools.filter(it => canHarvest(block, it.type) && remaining(it) > HARD_STOP)
  if (!eligible.length) return handOk ? { item: null, hand: true, reason: 'hand' } : { item: null, hand: false, reason: 'none' }
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
export function applyToolPolicy (bot, block) {
  const items = bot?.inventory?.items?.() ?? []
  const d = toolFor(block, items)
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
  return cheapestOpen(items) ?? handFiller(items)   // a block in the hand beats a spent pickaxe in the hand (the pathfinder equips whatever this returns)
}

/** Every tool the bot could still swing at this block (ignores the floor; honours the hard stop). Used by the exit contract. */
export function usableTools (block, items = []) {
  return (Array.isArray(items) ? items : []).filter(it => it?.name && TOOL_RE.test(it.name) && canHarvest(block, it.type) && remaining(it) > HARD_STOP)
}
