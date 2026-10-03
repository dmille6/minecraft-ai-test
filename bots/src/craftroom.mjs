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
 * order that empties the fewest slots: mineflayer takes them in slot order and sometimes merges a remainder, so
 * the real bag can end up with a slot more than this says, never one fewer. A conservative answer refuses a craft
 * that would have fitted; an optimistic one throws a pickaxe on the ground.
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
 */
export function craftRoomRemedy (items = [], item = '') {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  const planned = wearOutPlan(list).tools[0]
  if (planned) return { tool: planned, why: 'spent' }
  if (/_pickaxe$/.test(String(item))) {
    const spent = list.filter(it => /_pickaxe$/.test(it.name) && remaining(it) === 1)
      .sort((a, b) => tier(a.name) - tier(b.name))
    if (spent.length) return { tool: spent[0], why: 'replaced' }
  }
  return null
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
 *   cheapest  the smallest stack of something the bot can PLACE (isBlock(name)) -- placing all of it frees its
 *             slot, which is a move from where the bot stands; null when nothing placeable is held
 */
export function bagFill (items = [], isBlock = () => false) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  const by = new Map()
  for (const it of list) by.set(it.name, (by.get(it.name) ?? 0) + 1)
  const line = [...by.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5)
    .map(([n, k], i) => `${n} ${k}${i === 0 ? (k === 1 ? ' slot' : ' slots') : ''}`).join(', ')
  const cheapest = list.filter(it => !TOOL_RE.test(it.name) && isBlock(it.name))
    .sort((a, b) => (a.count ?? 1) - (b.count ?? 1))[0] ?? null
  return { line, cheapest: cheapest && { name: cheapest.name, count: cheapest.count ?? 1 } }
}
