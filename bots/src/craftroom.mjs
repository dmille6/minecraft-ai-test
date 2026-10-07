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
import { inPickupBox } from './pickupbox.mjs'

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
  // `bag`: the simulated stacks after every repetition -- the next step of a chain starts from it (chainPeak).
  return { ok: true, reason: null, rep: reps, before, peak, after: bag.length, short: 0, missing: null, bag }
}

/**
 * AN ITEM ON THE GROUND THAT CAN STILL LAND IN THE BAG during the craft -> true | false. Pure.
 * The server's auto-pickup cannot be refused; an item in the pickup box takes a slot the room check counted on
 * (Claude review). "Within pickup range" is vanilla's box (pickupbox.mjs) GROWN by PICKUP_MARGIN on every side: a drop
 * just outside it still falls, slides, or meets a bot that sways. Any item counts -- ballast takes a slot like anything.
 */
export const PICKUP_MARGIN = 1.0
/** The NEAREST such item -> { id, name, distance, position } | null (named so a refusal can say what it is waiting on). */
export function pickupNearest (feet, entities = {}) {
  if (!feet) return null
  let best = null
  for (const e of Object.values(entities ?? {})) {
    if (e?.name !== 'item' || !e.position || !inPickupBox(feet, e.position, -PICKUP_MARGIN, -PICKUP_MARGIN)) continue
    const distance = Math.hypot(e.position.x - feet.x, e.position.y - feet.y, e.position.z - feet.z)
    if (best && best.distance <= distance) continue
    let name = null, count = 1
    try { const d = e.getDroppedItem?.(); name = d?.name ?? null; count = Math.max(1, Number(d?.count) || 1) } catch { /* unnamed */ }
    best = { id: e.id ?? null, name: name ?? 'an item', count, distance, position: e.position }
  }
  return best
}
export const pickupPending = (feet, entities = {}) => pickupNearest(feet, entities) !== null

/**
 * THE ROOM PREDICATE, one execution -> craftRoom's answer plus `reserve`. Pure. Used twice per execution: before
 * bot.craft (to choose a remedy) and as craftsync's `admit`, on the bag the server holds after the baseline resync.
 *   owedTables  tables this call or a caller placed and will take back: one slot is held for them unless a
 *               crafting_table stack can take them
 *   pickupNear  pickupNearest()'s item (or true): ONE more slot is held back for what may land during the craft
 * Returns craftRoom's answer plus `reserve`, `held` ({ table, pickup }: why each slot is held back), `pickup` (the item)
 * and `pickupOnly`: the craft fits once the pickup slot is not held -- the caller must then deal with the ITEM (wait,
 * collect, or name it), never pay for the held slot by wearing out a tool (Claude review).
 */
export function admitRoom (items = [], recipe = {}, { owedTables = 0, pickupNear = false, capacity = BAG_SLOTS } = {}) {
  const list = Array.isArray(items) ? items : []
  const stackRoom = list.some(i => i?.name === 'crafting_table' && (i.count ?? 1) + owedTables <= (i.stackSize ?? DEFAULT_STACK))
  const held = { table: owedTables > 0 && !stackRoom ? 1 : 0, pickup: pickupNear ? 1 : 0 }
  const reserve = held.table + held.pickup
  const r = craftRoom(list, recipe, 1, { capacity: capacity - reserve })
  const pickupOnly = !r.ok && r.reason === 'no_room' && held.pickup > 0 &&
    craftRoom(list, recipe, 1, { capacity: capacity - held.table }).ok
  return { ...r, reserve, held, pickup: pickupNear && typeof pickupNear === 'object' ? pickupNear : null, pickupOnly }
}

/**
 * MAY THE CRAFT GO AND COLLECT THE ITEM IT IS HOLDING A SLOT FOR? -> { collect, why }. Pure.
 *   reach band  with a crafting table in use, only an item within stationReach - PICKUP_TABLE_BAND of the table's
 *               centre: the walk into its pickup box must not carry the bot out of the table's reach (both reviews: a
 *               craft run 5.02 blocks from its table waits 20 s for windowOpen and is filed as no_path, which votes)
 *   room        a free slot, or open room in stacks of the same name for the whole drop -- sized by the REGISTRY's
 *               stackSize for that item (`stackSizeOf`), never an assumed 64 (Codex: dirt x63 takes a dropped dirt)
 */
export const PICKUP_TABLE_BAND = 1.5
export function collectDecision ({ items = [], pickup = null, tableCentre = null, stationReach = 4.5, stackSizeOf = () => null } = {}) {
  if (!pickup?.position) return { collect: false, why: 'no way to walk to it' }
  if (tableCentre) {
    const d = Math.hypot(pickup.position.x - tableCentre.x, pickup.position.y - tableCentre.y, pickup.position.z - tableCentre.z)
    if (d > stationReach - PICKUP_TABLE_BAND) {
      return { collect: false, why: `it lies ${d.toFixed(1)} blocks from the crafting_table, too far to collect and still craft there` }
    }
  }
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  if (list.length < BAG_SLOTS) return { collect: true, why: 'a free slot' }
  const size = Number(stackSizeOf(pickup.name))
  if (pickup.name && Number.isFinite(size) && size > 0) {
    const open = list.filter(i => i.name === pickup.name && !i.nbt).reduce((k, i) => k + Math.max(0, size - (i.count ?? 1)), 0)
    if (open >= Math.max(1, pickup.count ?? 1)) return { collect: true, why: `it joins the ${pickup.name} stack` }
  }
  return { collect: false, why: 'no free slot or open stack to collect it into' }
}

/** What the held-back slots are for, for a refusal: "1 for the crafting table ..., 1 for dirt on the ground 2.0 ...". */
export function heldLine (room = {}) {
  const parts = []
  if (room.held?.table) parts.push(`${room.held.table} for the crafting_table this craft will take back`)
  if (room.held?.pickup) {
    const p = room.pickup
    parts.push(`${room.held.pickup} for ${p?.name ?? 'an item'} on the ground${Number.isFinite(p?.distance) ? ` ${p.distance.toFixed(1)} blocks away` : ''} that can land in the bag`)
  }
  return parts.length ? `${room.reserve} slot(s) held back: ${parts.join(', ')}` : ''
}

/**
 * WHAT A FULL-BAG REFUSAL MAY TELL THE BOT TO DO -> { kind, text }. Pure (Codex P2: a refusal must name a remedy whose
 * precondition holds from where the bot is). In order:
 *   place    a ONE-block inert filler (bagFill's rules) AND a placement site exists next to the bot (the same scan
 *            place() runs -- the caller passes its answer as `placeSite`)
 *   eat      the food eat() would pick (foodOrder) is a single item, the bot is not full (eat refuses at 20), and the
 *            recipe does not need it
 *   deposit  `deposit <item>` for depositTarget's item: not needed by the craft (or its plan), and its deposit, as
 *            deposit() runs it, empties a stack. deposit walks home to the town chest from anywhere
 *   none     nothing holds -- said plainly, never a remedy that cannot run
 * THE ACTION COMES FIRST in every text (Codex): the refusal leads with it, and the prompt keeps 220 characters.
 * wear_out is never named: it is not a model action (chatOnly), and craft has already run it itself (makeCraftRoom).
 */
export function roomAdvice ({ items = [], consumes = [], isPlaceable = () => false, placeSite = false, foodOrder = [], hunger = 20, depositItem = null } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  const used = new Set((consumes ?? []).map(c => c.name))
  const fill = bagFill(list, isPlaceable, consumes)
  if (fill.cheapest && placeSite) {
    return { kind: 'place', text: `place ${fill.cheapest.name} -- placing your one ${fill.cheapest.name} frees its slot` }
  }
  const food = (foodOrder ?? []).map(n => list.find(i => i.name === n)).find(Boolean)
  if (food && (food.count ?? 1) === 1 && Number(hunger) < 20 && !used.has(food.name)) {
    return { kind: 'eat', text: `eat -- eating your one ${food.name} frees its slot` }
  }
  if (depositItem && !used.has(depositItem)) {
    return { kind: 'deposit', item: depositItem,
             text: `deposit ${depositItem} -- it walks home to the town chest and frees slots; nothing else frees one from where you stand` }
  }
  return { kind: 'none', text: 'no slot can be freed from here -- nothing in the bag can be freed from where you stand, and no deposit would empty a stack the craft does not need' }
}

/**
 * A WHOLE CHAIN OF CRAFTS, SIMULATED IN ORDER -> { ok, peak, before, slotsNeeded, step } | { ok: false, reason, step }.
 * Pure. Each step is { recipe: { consumes, outputs }, times } (a recipe with no outputs models a block put down, e.g.
 * the crafting table placed between the planks and the slabs); each starts from the bag the previous one left
 * (craftRoom's `bag`). `slotsNeeded` is how many free slots the chain needs NOW: its highest occupancy minus today's,
 * at least 0 -- a chain that empties a stack before it needs a new one can need none (composter.mjs's build plan).
 */
export function chainPeak (items = [], steps = []) {
  let bag = (Array.isArray(items) ? items : []).filter(it => it?.name && (it.count ?? 1) > 0)
  const before = bag.length
  let peak = before
  for (let i = 0; i < (steps ?? []).length; i++) {
    const st = steps[i]
    const r = craftRoom(bag, st.recipe, Math.max(1, st.times ?? 1), { capacity: Infinity })
    if (!r.ok) return { ok: false, reason: r.reason, step: i, missing: r.missing }
    peak = Math.max(peak, r.peak)
    bag = r.bag
  }
  return { ok: true, peak, before, slotsNeeded: Math.max(0, peak - before), step: null }
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

/** THE STACK place() PUTS DOWN: the first stack of that name in the bag's slot order. Shared by place() and the advice. */
export const placeStackOf = (items, name) => (Array.isArray(items) ? items : []).find(i => i?.name === name) ?? null

/**
 * WOULD THIS DEPOSIT FREE A SLOT? -> true | false. Pure (Codex review: a plan that banks 2 of 10 cobblestone and 3 of 5
 * sticks leaves both stacks and the bag still full). Walks the plan exactly as deposit() executes it: per entry, the
 * stacks of that name in slot order, min(left, stack) from each. A stack it takes whole is a freed slot.
 */
export function depositFreesSlot (items = [], plan = []) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  for (const { name, count } of plan ?? []) {
    let left = Number(count) || 0
    for (const it of list.filter(x => x.name === name)) {
      if (left <= 0) break
      const n = Math.min(left, it.count ?? 1)
      if (n >= (it.count ?? 1)) return true
      left -= n
    }
  }
  return false
}

/**
 * WHICH ITEM TO DEPOSIT -> its name | null. Pure. The first entry of the deposit plan (deposit()'s own order) that the
 * craft does NOT need -- `keep` is the step's ingredients and, for a plan, every step's -- and whose deposit, run as
 * deposit() runs it, empties a stack. A plain `deposit` banks the plan whole (the pickaxe's planks, a plan's logs) and a
 * remedy that spends the craft's own ingredients is the dead end it was meant to break (both reviews).
 */
export function depositTarget (items = [], plan = [], keep = []) {
  const used = new Set((keep ?? []).map(c => c?.name ?? c))
  for (const e of plan ?? []) {
    if (!e?.name || used.has(e.name)) continue
    if (depositFreesSlot(items, [e])) return e.name
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
 *   cheapest  a ONE-block stack the bot could place away (the filler rules above): advice naming one move;
 *             null when nothing qualifies
 */
export function bagFill (items = [], isPlaceable = () => false, consumes = []) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  const by = new Map()
  for (const it of list) by.set(it.name, (by.get(it.name) ?? 0) + 1)
  const line = [...by.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5)
    .map(([n, k], i) => `${n} ${k}${i === 0 ? (k === 1 ? ' slot' : ' slots') : ''}`).join(', ')
  // ONE block: a stack of 64 is 64 placements, not a move from where the bot stands (sandbox: 'placing your 64 diorite').
  // And the one block must be THE STACK place() TAKES (placeStackOf): with dirt x64 ahead of dirt x1, `place dirt`
  // spends the 64 and frees nothing (Codex review).
  const names = [...new Set(fillerCandidates(list, consumes, isPlaceable).map(it => it.name))]
  const cheapest = names.map(n => placeStackOf(list, n)).find(it => it && (it.count ?? 1) === 1) ?? null
  return { line, cheapest: cheapest && { name: cheapest.name, count: cheapest.count ?? 1 } }
}

/**
 * ONE EXECUTION'S VERDICT -> { ok, source, verdict, produced, retry }. Pure. THE VERIFIER IS craftsync.mjs.
 *   synced    craftsync is installed (bot.craftSync). Then bot.craft RESOLVES only when both of its window-0 resyncs
 *             were answered and the result count rose by a full execution, and THROWS CraftSyncError otherwise.
 *   got       what bot.craft resolved with (craftsync: { produced, requested })
 *   error     what it threw (never an abort: the caller rethrows those first)
 *   arrived   craftArrived() over the local bag -- consulted ONLY when craftsync is not installed
 *   perCraft  items one execution makes
 * `source` is what the _craft_room row prints as source=<x> -- WHO CONFIRMED the row's statement, `none` when nothing
 * did; `verdict` is the row's verdict=<x>, taken from craftsync's own reason:
 *   synced, resolved                        ok      server  'server'   produced = ONE execution: got.produced capped
 *                                                                      at perCraft, so an item the server's pickup
 *                                                                      added during the craft is not counted as made
 *   synced, craft_unconfirmed               NOT ok  server  'denied'   reason not_in_inventory: the server's own count
 *     not_in_inventory                                                 did not rise; retried once when NOTHING arrived
 *   synced, craft_unconfirmed unverified    NOT ok  none    'unanswered'    the resync went unanswered: craftsync's
 *                                                                      rule, a local count can never confirm -- so no
 *                                                                      verified_local under craftsync
 *   synced, craft_unconfirmed click_timeout NOT ok  none    'click_timeout' (its counts may have been answered; the
 *                                                                      craft is still unconfirmed)
 *   synced, craft_room (admission refused)  NOT ok  none    <its reason, e.g. no_room_after_resync>, `refused`
 *   any other error (window, busy, deadline) NOT ok  none   'error'    the caller's craftFailureOutcome names it
 *   not synced, resolved, arrived           ok      local   'none'     verified_local: mineflayer's bag is all there is
 *   not synced, resolved, nothing arrived   NOT ok  none    'none'
 */
export function executionVerdict ({ synced = false, got = null, error = null, arrived = false, perCraft = 1 } = {}) {
  const per = Math.max(1, Number(perCraft) || 1)
  if (error) {
    if (synced && error.failClass === 'craft_room') {
      return { ok: false, source: 'none', verdict: String(error.reason ?? 'refused'), produced: 0, retry: false, refused: true }
    }
    if (!synced || error.failClass !== 'craft_unconfirmed') return { ok: false, source: 'none', verdict: 'error', produced: 0, retry: false }
    if (error.reason === 'not_in_inventory') {
      return { ok: false, source: 'server', verdict: 'denied', produced: 0, retry: !(Number(error.produced) > 0) }
    }
    return { ok: false, source: 'none', verdict: error.reason === 'unverified' ? 'unanswered' : String(error.reason ?? 'unconfirmed'), produced: 0, retry: false }
  }
  if (synced) {
    const n = Number(got?.produced)
    return { ok: true, source: 'server', verdict: 'server', produced: Number.isFinite(n) ? Math.min(n, per) : per, retry: false }
  }
  return arrived
    ? { ok: true, source: 'local', verdict: 'none', produced: per, retry: false }
    : { ok: false, source: 'none', verdict: 'none', produced: 0, retry: false }
}
