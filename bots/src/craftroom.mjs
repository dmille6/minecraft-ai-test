// CRAFT ROOM: a craft must have somewhere to put what it makes, and must take back the table it put down.
//
// Measured 2026-10-02 (full day, 80 bots): 487 of 1,115 claimed stone_pickaxe crafts (44%) ended "crafted, but
// nothing changed". mineflayer's craftOnce ends in bot.putAway(0) (craft.js grabResult), which calls
// putSelectedItemRange(start, end, window, null); with no stack to join and no empty slot that is
// `clickWindow(-999)` -- the result is THROWN ON THE GROUND (inventory.js putSelectedItemRange, "no room => drop
// it"). A pickaxe never stacks, so a full bag loses every pickaxe it crafts. Median bag: 35 of 36 slots.
//
// And the table: craft placed the carried table and walked away -- 256 table decrements from craft in a day,
// 172 tables re-crafted (a log each, and wood is the scarce thing), 28 of 80 bots ended the day without the
// table they had started it with.
//
// Everything here is PURE so the decisions can be tested as behaviour; skills.mjs does the acting.

import { wearOutPlan, wearRank } from './hygiene.mjs'
import { TOOL_RE, tier, remaining } from './toolfor.mjs'

/** The slots putSelectedItemRange searches: inventoryStart..inventoryEnd, 27 main + 9 hotbar. */
export const BAG_SLOTS = 36
const DEFAULT_STACK = 64

const stackGuess = name => (TOOL_RE.test(String(name)) ? 1 : DEFAULT_STACK)

/**
 * A prismarine recipe in names and stack sizes, so craftRoom can stay pure.
 *   consumes  [{ name, count }]                net-negative delta entries (ingredients)
 *   outputs   [{ name, count, stackSize }]     net-positive delta entries (the result, plus any outShape leftover)
 *   result    the output named `item` (else the first output), with `durable` when it is a tool with durability
 * An id the registry cannot name is KEPT as `#<id>`: as an output it still needs a slot (fail closed), as an
 * ingredient it frees nothing (no stack in the bag carries that name).
 */
export function roomRecipe (registry, recipe, item = null) {
  const nameOf = id => registry?.items?.[id]?.name ?? `#${id}`
  const defOf = name => registry?.itemsByName?.[name]
  const consumes = []; const outputs = []
  for (const d of recipe?.delta ?? []) {
    if (!d || !d.count) continue
    const name = nameOf(d.id)
    if (d.count < 0) consumes.push({ name, count: -d.count })
    else outputs.push({ name, count: d.count, stackSize: defOf(name)?.stackSize ?? stackGuess(name) })
  }
  const r = outputs.find(o => o.name === item) ?? outputs[0] ?? null
  const result = r && { ...r, durable: !!(defOf(r.name)?.maxDurability || TOOL_RE.test(r.name)) }
  return { consumes, outputs, result }
}

/**
 * craftRoom(items, recipe, count) -> { ok, reason, rep, before, peak, after, short, missing }
 *   items   mineflayer Item[] (bot.inventory.items(): one entry per occupied slot)
 *   recipe  roomRecipe() output
 *   count   repetitions of the recipe (what bot.craft's count means)
 * Simulates the slots through `count` repetitions: ingredients leave first, then each output joins a compatible
 * non-full stack (same name, no NBT, below its stackSize -- what putSelectedItemRange's findItemRange(notFull)
 * looks for) and only then takes a new slot. `peak` is the most slots ever occupied; `ok` means no repetition
 * ever needed more than `capacity`, i.e. mineflayer would never reach its toss.
 *   reason  null | 'no_room' (short = slots that must be freed) | 'ingredients' (missing = the name that ran out)
 *
 * ONLY A SLOT THE RECIPE FULLY EMPTIES IS FREED. Ingredients are taken from the LARGEST stack first, which is the
 * order that empties the fewest slots: mineflayer takes them in slot order and sometimes merges a remainder into
 * another stack, so the real bag can end up with MORE free slots than this predicts, never fewer -- the occupancy
 * predicted here is an upper bound. A conservative answer refuses a craft that would have fitted; an optimistic one
 * throws a pickaxe on the ground.
 */
export function craftRoom (items = [], recipe = {}, count = 1, { capacity = BAG_SLOTS } = {}) {
  const bag = (Array.isArray(items) ? items : []).filter(it => it?.name && (it.count ?? 1) > 0)
    .map(it => ({ name: it.name, count: it.count ?? 1, stackSize: it.stackSize ?? stackGuess(it.name), nbt: !!it.nbt }))
  const before = bag.length
  let peak = before
  const reps = Math.max(1, Math.floor(Number(count) || 1))
  for (let rep = 0; rep < reps; rep++) {
    for (const c of recipe.consumes ?? []) {
      let need = c.count
      for (const s of bag.filter(x => x.name === c.name).sort((a, b) => b.count - a.count)) {
        if (need <= 0) break
        const take = Math.min(need, s.count)
        s.count -= take; need -= take
      }
      if (need > 0) return { ok: false, reason: 'ingredients', rep, before, peak, after: bag.length, short: 0, missing: c.name }
      for (let i = bag.length - 1; i >= 0; i--) if (bag[i].count === 0) bag.splice(i, 1)
    }
    for (const o of recipe.outputs ?? []) {
      let left = o.count
      for (const s of bag) {
        if (left <= 0) break
        if (s.name !== o.name || s.nbt || s.count >= s.stackSize) continue
        const put = Math.min(left, s.stackSize - s.count)
        s.count += put; left -= put
      }
      const size = Math.max(1, o.stackSize ?? stackGuess(o.name))
      while (left > 0) { const put = Math.min(left, size); bag.push({ name: o.name, count: put, stackSize: size, nbt: false }); left -= put }
      peak = Math.max(peak, bag.length)
    }
    if (peak > capacity) return { ok: false, reason: 'no_room', rep, before, peak, after: bag.length, short: peak - capacity, missing: null }
  }
  return { ok: true, reason: null, rep: reps, before, peak, after: bag.length, short: 0, missing: null }
}

/** Room for one more of `name` (the table retake): a non-full compatible stack, or a free slot. */
export function roomForOne (items, name, stackSize = DEFAULT_STACK, capacity = BAG_SLOTS) {
  return craftRoom(items, { consumes: [], outputs: [{ name, count: 1, stackSize }] }, 1, { capacity }).ok
}

/**
 * Did the craft's output ARRIVE? Pure over two inventory reads.
 * A tool must show up as a NEW copy at full durability (a fresh copy has durabilityUsed 0; a worn one already
 * in the bag does not count); anything else as a rise in the total held by the result's count.
 */
export function craftArrived (beforeItems = [], afterItems = [], result = null) {
  if (!result?.name) return false
  const of = list => (Array.isArray(list) ? list : []).filter(it => it?.name === result.name)
  const total = list => of(list).reduce((n, it) => n + (it.count ?? 1), 0)
  const fresh = list => of(list).filter(it => !it.maxDurability || (it.durabilityUsed ?? 0) === 0)
    .reduce((n, it) => n + (it.count ?? 1), 0)
  return result.durable
    ? fresh(afterItems) - fresh(beforeItems) >= result.count
    : total(afterItems) - total(beforeItems) >= result.count
}

/**
 * Which tool may craft wear out to free a slot? -> { tool, why } | null
 *   'spent'     the hygiene plan's own first pick (spent axe/shovel/hoe, or a spent pickaxe beyond the kept three)
 *   'replaced'  a pickaxe craft may go below SPENT_PICKAXES_KEPT by ONE copy: the one it is replacing (lowest tier
 *               first -- every copy at 1 use is worth the same one last swing)
 * Only copies at EXACTLY one use: a 0-use copy is a phantom the server already broke (hygiene.mjs).
 *
 * THE LAST DIGGING TOOL IS NEVER THE PRICE OF A SLOT (Codex review). The craft has not happened yet when the tool is
 * destroyed; if it then fails, a bot underground that wore out its last pickaxe has no way out. So no PICKAXE is worn
 * out unless another pickaxe with at least MIN_SURVIVOR_USES uses is still in the bag afterwards -- a real digging
 * tool, not another last swing. A spent axe, shovel or hoe is not an escape and may always go (owner decision,
 * review round 2).
 */
export const MIN_SURVIVOR_USES = 2
export function craftRoomRemedy (items = [], item = '') {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  const survives = tool => list.some(it => it !== tool && /_pickaxe$/.test(it.name) && remaining(it) >= MIN_SURVIVOR_USES)
  const planned = wearOutPlan(list).tools.find(t => !/_pickaxe$/.test(t.name) || survives(t))
  if (planned) return { tool: planned, why: 'spent' }
  if (/_pickaxe$/.test(String(item))) {
    const spent = list.filter(it => /_pickaxe$/.test(it.name) && remaining(it) === 1 && survives(it))
      .sort((a, b) => tier(a.name) - tier(b.name))
    if (spent.length) return { tool: spent[0], why: 'replaced' }
  }
  return null
}

/** Does this item name place as a solid block? (wheat names a crop block but the item does not place it.) */
export const placeableBlock = (registry, name) =>
  registry?.blocksByName?.[name]?.boundingBox === 'block' && !!registry?.itemsByName?.[name]

// What a refusal's ADVICE may name as a block to put down (craft itself never places one -- review round 2: a block
// put down to free a slot can seal a 1x2 tunnel or an escape stair). An ALLOWLIST of inert dirt/stone-family blocks
// (review round 3): no sand or gravel (they fall), no magma, TNT or anything else with a behaviour; and never
// anything the recipe itself consumes.
const ADVICE_OK = /^(dirt|coarse_dirt|rooted_dirt|cobblestone|cobbled_deepslate|stone|andesite|diorite|granite|tuff|deepslate|calcite|netherrack)$/
const fillerCandidates = (items, consumes, isPlaceable) => {
  const used = new Set((consumes ?? []).map(c => c.name))
  return (Array.isArray(items) ? items : []).filter(it => it?.name && ADVICE_OK.test(it.name) && !used.has(it.name) &&
    isPlaceable(it.name))
}
const ROCK = name => wearRank(name) === 0   // the stone family: every one of them drops nothing without a pickaxe
/**
 * Does wearing `toolName` out on `blockName` leave the freed slot free? The tool vanishes, but the BLOCK drops:
 * a pickaxe on stone drops cobblestone, anything on dirt drops dirt. Only two answers keep the slot:
 *   - nothing drops (a non-pickaxe on the stone family), or
 *   - every drop joins a non-full stack already in the bag.
 * `drops` is dropsOf(registry, blockName).
 */
export function wearKeepsSlot (items = [], toolName = '', blockName = '', drops = []) {
  if (!/_pickaxe$/.test(toolName) && ROCK(blockName)) return true
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  return (drops?.length ? drops : [blockName]).every(d =>
    list.some(it => it.name === d && !it.nbt && (it.count ?? 1) < (it.stackSize ?? stackGuess(it.name))))
}

/**
 * WHAT FILLS THE BAG, for a refusal that names it. -> { line, cheapest }
 *   line      "cobblestone 20 slots, dirt 8, stone_pickaxe 3, ..." (most slots first, top 5)
 *   cheapest  the smallest stack the bot could PLACE away (the filler rules above, any count): advice, so it names
 *             the move and its size; null when nothing qualifies
 */
export function bagFill (items = [], isPlaceable = () => false, consumes = []) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  const by = new Map()
  for (const it of list) by.set(it.name, (by.get(it.name) ?? 0) + 1)
  const line = [...by.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5)
    .map(([n, k], i) => `${n} ${k}${i === 0 ? (k === 1 ? ' slot' : ' slots') : ''}`).join(', ')
  const cheapest = fillerCandidates(list, consumes, isPlaceable).sort((a, b) => (a.count ?? 1) - (b.count ?? 1))[0] ?? null
  return { line, cheapest: cheapest && { name: cheapest.name, count: cheapest.count ?? 1 } }
}

// A packet's slot as (id, count): 1.21 sends { itemCount, itemId, ... } (itemCount 0 = empty); older protocols
// { present, itemId, itemCount }.
const packetSlot = it => {
  const n = Number(it?.itemCount ?? 0)
  return n > 0 && it?.present !== false ? { id: it.itemId, count: n } : { id: null, count: 0 }
}

/**
 * WHAT DOES THIS SERVER PACKET SAY ABOUT THE RESULT IN THE BAG? -> 'shows' | 'denies' | null (says nothing). Pure.
 *   pkt          { kind: 'set_slot', windowId, slot, item } | { kind: 'window_items', windowId, items, carriedItem }
 *   resultId     the result's item id
 *   expect       { [bagSlot]: count } -- the bag slots (player-window numbering, 9..44) the client predicts the result
 *                in after the craft, and the count it predicts there
 *   craftWindow  the id of the crafting window this craft opened (null: the 2x2 grid of window 0, or unknown)
 * READ FROM THE PACKET'S OWN CONTENT, never from bot.inventory: mineflayer stashes a window_items for a window it has
 * already closed without applying it (inventory.js), so after a table craft the bag can still show the prediction.
 * Window -> bag mapping (prismarine-windows): window 0 is the player window, bag slot = slot (9..44); the 3x3
 * crafting window has nine grid cells where window 0 has four grid cells plus four armour slots, so its bag
 * region is 10..45 and bag slot = slot - 1. Any other window says nothing.
 * A window_items is only a FINAL statement when its grid is empty and nothing is on the cursor: Paper sends the whole
 * window on CraftItemEvent with the result still on the cursor, before the put-away click -- a mid-click state.
 * A set_slot for the crafting result cell (slot 0) is about the grid, never the bag, and says nothing.
 */
export function packetSays (pkt, ctx = {}) {
  const per = packetSlots(pkt, ctx)
  if (!per) return null
  const v = Object.values(per)
  return v.includes('denies') ? 'denies' : 'shows'
}

/**
 * The same reading PER SLOT -> { [bagSlot]: 'shows' | 'denies' } for every expected slot the packet states, or null
 * when it says nothing. A set_slot states one slot; a final-state window_items states every expected slot.
 */
export function packetSlots (pkt, { resultId, expect = {}, craftWindow = null } = {}) {
  if (!pkt) return null
  const off = pkt.windowId === 0 ? 0 : (craftWindow == null || pkt.windowId === craftWindow ? 1 : null)
  if (off == null) return null
  const holds = (it, want) => { const s = packetSlot(it); return s.id === resultId && s.count >= want }
  const bags = Object.keys(expect).map(Number)
  if (!bags.length) return null
  if (pkt.kind === 'set_slot') {
    const bag = pkt.slot - off
    if (!Object.hasOwn(expect, bag)) return null
    return { [bag]: holds(pkt.item, expect[bag]) ? 'shows' : 'denies' }
  }
  if (pkt.kind === 'window_items') {
    if (packetSlot(pkt.carriedItem).count > 0) return null
    const gridEnd = pkt.windowId === 0 ? 4 : 9
    for (let i = 1; i <= gridEnd; i++) if (packetSlot(pkt.items?.[i]).count > 0) return null
    const out = {}
    for (const b of bags) {
      const it = pkt.items?.[b + off]
      if (it === undefined) return null          // a malformed or truncated window says nothing
      out[b] = holds(it, expect[b]) ? 'shows' : 'denies'
    }
    return out
  }
  return null
}

/**
 * SERVER VERDICT on one craft execution -> 'wait' | 'server' | 'denied' | 'none'. Pure.
 *   seen   packets in arrival order, each with `seq` (arrival order, shared with the clicks) and `t` (ms)
 *   ctx    packetSlots' context plus `afterSeq`: the sequence number of the FINAL put-away click
 * Only packets after the final click count (an opening snapshot cannot be an answer to it). Evidence is kept PER
 * EXPECTED SLOT, the latest statement for each (review round 4: a denial on one slot is not erased by a confirmation
 * on another). Nothing is decided until the stream has been quiet for quietMs since the last packet of ANY kind --
 * the quiet restarts on every packet, so a rejection inside a burst is read, not raced. Then:
 *   any slot's latest statement denies            -> 'denied'
 *   every expected slot's latest statement shows  -> 'server'
 * THE DEADLINE NEVER BYPASSES THE QUIET (review round 4): reached with the burst unsettled, or without every slot
 * stated, it is 'none' and the caller's local count decides.
 */
export function serverVerdict (seen = [], ctx = {}, now = 0, startedAt = 0, { quietMs = 250, deadlineMs = 2500 } = {}) {
  const rel = seen.filter(p => p.seq > (ctx.afterSeq ?? -1))
  const latest = {}
  for (const p of rel) Object.assign(latest, packetSlots(p, ctx) ?? {})
  const last = rel.length ? rel[rel.length - 1].t : startedAt
  if (now - last >= quietMs) {
    const states = Object.values(latest)
    if (states.includes('denies')) return 'denied'
    const want = Object.keys(ctx.expect ?? {})
    if (want.length && want.every(b => latest[b] === 'shows')) return 'server'
  }
  if (now - startedAt >= deadlineMs) return 'none'
  return 'wait'
}
