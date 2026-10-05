// INVENTORY HYGIENE, PHASE 1: never chase ballast, and wear spent tools out instead of carrying them.
//
// Measured 2026-09-28 by both engines independently (Claude and Codex, ~22 h, 80 bots): median 35 of 36 slots
// used, 50/80 bots at >= 34 and 25/80 completely full, every hour of the window. A full bot's gather succeeds
// 4.8% against 52.2% with room (same bot, same block, 74 of 76 pairs): collectManually breaks the block and the
// drop stays on the ground. Among the occupants: leaf_litter (~2.3 slots a bot) and SPENT TOOLS (216 of 492
// copies at <= 1 use, ~2.7 slots a bot).
//
// WHY NOT DROP THINGS (owner, 2026-09-29: "stop bots from collecting and keeping junk"). The first design tossed
// ballast; on the sandbox every tossed stack came back within 11-90 s, because the SERVER gives any item within
// ~1 block of a player's box to that player once the 2 s pickup delay ends, and mineflayer cannot refuse it. And
// as the owner pointed out, a pile left anywhere is picked up by the next bot that walks past. So Phase 1 creates
// no piles at all:
//   - pickupNearbyItems never walks to ballast (neverPickUp) -- the bot stops SEEKING it;
//   - a spent tool is destroyed by using it: any block with hardness > 0 costs a tool one use, so one dig
//     breaks a copy at 1 use. Nothing is dropped, so nothing can reach another bot.
// Stackable ballast (leaf_litter, eggs, seeds...) needs a pile-free disposal; both reviews laid out what burial
// would take (settle-before-seal, Paper's cross-wall merging, trap holes) -- that is Phase 2, a separate change.

/** Worth nothing to this fleet in any quantity: never walked to by pickupNearbyItems. */
export const NEVER_KEEP = new Set([
  'leaf_litter', 'egg', 'brown_egg', 'blue_egg', 'wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds',
  'flint', 'ink_sac', 'glow_ink_sac', 'pointed_dripstone', 'dead_bush', 'short_grass', 'tall_grass', 'fern',
  'large_fern', 'poppy', 'dandelion', 'vine', 'seagrass', 'rail',
])

/** An item entity on the floor that pickupNearbyItems should never walk to (prismarine-entity getDroppedItem). */
export function neverPickUp (entity) {
  try { return NEVER_KEEP.has(entity?.getDroppedItem?.()?.name) } catch { return false }
}

/** Spent pickaxes kept: last-swing turns up to three of them into the cobblestone for a new one. */
export const SPENT_PICKAXES_KEPT = 3
/** Wear-out starts only under slot pressure: a dig per tool is cheap, but not free. */
export const TRIGGER_SLOTS = 34
/** At most this many tools per order: an axe on stone is ~7.5 s a dig, and the runner's budget is finite. */
export const MAX_PER_ORDER = 4
const TOOL = /_(pickaxe|axe|shovel|hoe)$/   // swords lose durability on blocks too, but 2 per block: excluded, keep it simple
const usesLeft = it => (it?.maxDurability ? it.maxDurability - (it.durabilityUsed ?? 0) : Infinity)

/**
 * wearOutPlan(items) -> { slots, tools }
 *   items  mineflayer Item[] (one entry per occupied slot, as bot.inventory.items() returns)
 *   tools  the spent copies (<= 1 use) to destroy: every spent axe/shovel/hoe, and every spent pickaxe beyond
 *          the SPENT_PICKAXES_KEPT most-worn-last. Empty below TRIGGER_SLOTS. A tool with 2+ uses is never listed.
 */
export function wearOutPlan (items = []) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  const slots = list.length
  if (slots < TRIGGER_SLOTS) return { slots, tools: [] }
  // EXACTLY 1 use. A copy the client still shows at 0 has already broken on the server (durability lags); it is
  // not real, so it is neither worn out nor counted toward the three last-swing keeps (both reviews: the old
  // ascending sort KEPT the phantom 0-use copies and wore out working 1-use ones).
  const spent = list.filter(it => TOOL.test(it.name) && usesLeft(it) === 1)
  const picks = spent.filter(it => it.name.endsWith('_pickaxe'))
  return { slots, tools: [...spent.filter(it => !it.name.endsWith('_pickaxe')), ...picks.slice(SPENT_PICKAXES_KEPT)].slice(0, MAX_PER_ORDER) }
}

/**
 * Is this block a fair thing to wear a tool out on? Pure over a prismarine block.
 * Solid, hardness above 0 (so the swing costs a use) and at most 2 (dirt 0.5, stone 1.5, logs/planks 2: quick
 * even with the wrong tool), and never something a bot or a player built or needs.
 */
// AN ALLOWLIST OF NATURAL BLOCKS (Claude review: the old blocklist passed 543 blocks, including ice -- which
// leaves a water source -- infested stone, glass, wool, bookshelves and anything a player or bot built). Stone
// first in preference: an axe/shovel/hoe on stone drops NOTHING, so no drop refills the freed slot.
const NATURAL = /^(stone|andesite|diorite|granite|tuff|calcite|netherrack|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|[a-z_]+_log)$/
export function wearTarget (block) {
  return !!(block && block.name && block.boundingBox === 'block' && NATURAL.test(block.name) &&
            typeof block.hardness === 'number' && block.hardness > 0 && block.hardness <= 2)
}
/** Lower sorts first: stone family, then logs, then soils. */
export const wearRank = name => (/^(stone|andesite|diorite|granite|tuff|calcite|netherrack)$/.test(name) ? 0 : /_log$/.test(name) ? 1 : 2)

/**
 * DIAGNOSIS ONLY (10-03: 82 of 100 failed wear_out orders said just "no safe block within reach"). The per-guard tally
 * of the cells wear_out refused, most first: `12 cells: not_natural 9, room_liquid 2, occupied 1`. Never a decision.
 */
export function wearRefusals (refused = {}, cells = 0) {
  const parts = Object.entries(refused ?? {}).filter(([, n]) => n > 0)
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, n]) => `${k} ${n}`)
  return `${cells} cells: ${parts.join(', ') || 'none refused'}`
}

/**
 * DIAGNOSIS ONLY: what the copy's own slot SHOWS a few seconds after an unconfirmed wear-out dig -- an observation, not
 * an outcome (both reviews): an empty slot may be a late break or the copy moved; the same name at 1 use may be the same
 * copy or another. 'slot_empty' | 'same_name_at_one_use' | 'slot_changed' (ambiguous) | 'unknown' (no slot to read, or
 * the bot ended or is dead -- a respawn's empty bag says nothing about the dig).
 */
export function slotObservation ({ slotKnown = false, item = null, name = '', alive = true } = {}) {
  if (!slotKnown || !alive) return 'unknown'
  if (!item) return 'slot_empty'
  return item.name === name && usesLeft(item) === 1 ? 'same_name_at_one_use' : 'slot_changed'
}

/**
 * HOUSEKEEPING: deterministic orders the model can never choose (chatOnly). They are not attempts at the goal (no
 * milestone give-up either way) and never become a "reliable choice" in the prompt. cognitive.mjs asks this, so a
 * new housekeeping order cannot be wired into one of those sites and forgotten at the other.
 */
export const HOUSEKEEPING = new Set(['wear_out', 'compost', 'build_composter', 'dispose_well', 'build_well', 'close_well'])
export const isHousekeeping = skill => HOUSEKEEPING.has(skill)
