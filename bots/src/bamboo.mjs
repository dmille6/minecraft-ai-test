// BAMBOO -> STICKS: a full bag's bamboo, folded into sticks to free a slot (owner 10-03, both engines agreed).
//
// Full bags hold ~66 bamboo slots fleet-wide. 2 bamboo make 1 stick (2x2, no table, the two stacked vertically), and
// sticks are what the tech tree spends. Folding bamboo frees a slot only when a bamboo stack EMPTIES and the sticks
// land on a stack that already exists (or the fold empties more stacks than it starts) -- most batches free nothing,
// so the decision is simulated, not guessed: craftroom.mjs's craftRoom runs the bag through the batch (ingredients off
// the largest stack first, the conservative order; outputs onto a non-full stack before a new slot), and its PEAK
// occupancy is the temporary room the batch needs on the way.
//
// Pure. skills.mjs's bamboo_sticks does the acting -- through craftroom's executor, with the bamboo recipe only.

import { craftRoom, BAG_SLOTS } from './craftroom.mjs'
import { TRIGGER_SLOTS } from './hygiene.mjs'

/** Never fold into more sticks than one stack holds: sticks beyond a stack are bag fill of their own. */
export const STICK_CAP = 64
/** The fold as craftroom sees it: 2 bamboo out, 1 stick in. */
export const BAMBOO_STICK = Object.freeze({
  consumes: [{ name: 'bamboo', count: 2 }],
  outputs: [{ name: 'stick', count: 1, stackSize: 64 }],
})

const countOf = (items, name) => items.reduce((n, it) => n + (it?.name === name ? (it.count ?? 1) : 0), 0)

/**
 * THE FOLD AS THE BOT REALLY RUNS IT -> { after, tossed, short, stickSlotsBefore, stickSlotsAfter, steps }. Pure.
 * One 2x1 craft in the 2x2 grid, repeated `crafts` times over the bag's ACTUAL slots (mineflayer 4.37.1 craft.js +
 * craftsync.mjs's put-away, window 0, inventory slots 9..44 in order):
 *   1. pick up the FIRST bamboo stack in slot order (findInventoryItem), whole; right-click one into each grid cell
 *      (an emptied cursor picks up the next bamboo stack)
 *   2. put the cursor's leftover away: onto the first NON-FULL bamboo stack in slot order, then the first empty slot,
 *      else it is thrown -- this is where split stacks CONSOLIDATE: [64,10] bamboo frees a slot after 5 crafts
 *   3. the stick: onto the first non-full stick stack, then the first empty slot, else it is thrown
 * craftRoom (craftroom.mjs) takes ingredients off the largest stack and so never sees that consolidation; it stays the
 * PEAK/safety check. Items without a `slot` are laid out in order from slot 9. `steps` is per craft: the bag's
 * occupancy and stick slots after it, for a caller scanning batch sizes without re-simulating; with `bags` each step
 * also carries the bag itself (`bag`: { slot, name, count, stackSize, nbt }[] -- nbt kept, so craftRoom on it never joins
 * an output onto a named or enchanted stack).
 */
export function simulateFold (items = [], crafts = 0, { first = 9, last = 44, stackSize = 64, bags = false } = {}) {
  const slots = new Map()
  let next = first
  for (const it of (Array.isArray(items) ? items : []).filter(i => i?.name && (i.count ?? 1) > 0)) {
    let at = Number.isInteger(it.slot) && it.slot >= first && it.slot <= last && !slots.has(it.slot) ? it.slot : null
    while (at == null && next <= last) { if (!slots.has(next)) at = next; next++ }
    if (at == null) continue
    slots.set(at, { name: it.name, count: it.count ?? 1, size: it.stackSize ?? (it.name === 'bamboo' || it.name === 'stick' ? stackSize : 64), nbt: !!it.nbt })
  }
  const order = () => [...slots.keys()].sort((x, y) => x - y)
  const firstOf = (name, notFull = false) => order().find(k => slots.get(k).name === name && (!notFull || slots.get(k).count < slots.get(k).size))
  const firstEmpty = () => { for (let k = first; k <= last; k++) if (!slots.has(k)) return k; return null }
  const stickSlots = () => [...slots.values()].filter(v => v.name === 'stick').length
  const put = (name, n) => {          // put-away: non-full stacks of that name in slot order, then the first empty slot
    let left = n
    for (let k = firstOf(name, true); left > 0 && k != null; k = firstOf(name, true)) {
      const v = slots.get(k); const add = Math.min(left, v.size - v.count); v.count += add; left -= add
    }
    while (left > 0) {
      const e = firstEmpty()
      if (e == null) return left       // thrown on the ground
      const add = Math.min(left, stackSize); slots.set(e, { name, count: add, size: stackSize }); left -= add
    }
    return 0
  }
  const out = { after: slots.size, tossed: 0, short: false, stickSlotsBefore: stickSlots(), stickSlotsAfter: stickSlots(), steps: [] }
  for (let c = 0; c < crafts; c++) {
    let cursor = 0
    for (let cell = 0; cell < 2; cell++) {
      if (cursor === 0) {
        const src = firstOf('bamboo')
        if (src == null) { out.short = true; break }
        cursor = slots.get(src).count; slots.delete(src)
      }
      cursor -= 1
    }
    if (out.short) break
    out.tossed += put('bamboo', cursor)
    out.tossed += put('stick', 1)
    const step = { after: slots.size, stickSlots: stickSlots(), tossed: out.tossed }
    // `bags` (foldForCraft): the bag after this craft, slot by slot, for a caller that must test another craft on it
    if (bags) step.bag = order().map(k => ({ slot: k, name: slots.get(k).name, count: slots.get(k).count, stackSize: slots.get(k).size, nbt: slots.get(k).nbt }))
    out.steps.push(step)
  }
  out.after = slots.size
  out.stickSlotsAfter = stickSlots()
  return out
}

/**
 * bambooPlan(items) -> { crafts, freed, why, before, after, peak }
 *   items  mineflayer Item[] (one entry per occupied slot, with its `slot`)
 * crafts > 0 only when ALL hold:
 *   - the bag is at TRIGGER_SLOTS (34) or more occupied slots -- housekeeping, not a craft on a whim
 *   - at least 2 bamboo
 *   - the batch FREES a slot, as the bot really runs it (simulateFold: the actual slot order and the put-away's
 *     consolidation), and throws nothing
 *   - the STICK CAP: sticks held + crafts <= STICK_CAP -- or, past it, the fold provably needs no new stick slot (it
 *     only tops up partial stick stacks)
 *   - craftRoom's conservative PEAK fits the bag: a batch that needs a temporary slot the bag does not have is refused
 * The SMALLEST such batch is chosen: it frees the slot and spends the least bamboo. Worked cases (both engines):
 *   bamboo [64] + sticks [32]  -> 32 crafts, frees 1 (the bamboo stack empties, the sticks top up to 64)
 *   bamboo [64], no sticks     -> nothing frees (the bamboo slot becomes the sticks' slot)
 *   bamboo [64,64], no sticks  -> 64 crafts frees 1, but needs a temporary slot for the first stick
 *   bamboo [63] + sticks [32]  -> 31 crafts leaves 1 bamboo: nothing frees; an odd remainder never empties a stack
 *   bamboo [64,10] + sticks [32] (split) -> 5 crafts: the put-away consolidates the bamboo into one stack (Claude)
 * Fuel (report only): smelting ranks bamboo ahead of planks/logs and sticks last, so a fold moves fuel use onto wood --
 * same burn time per item, a different item burned.
 */
export function bambooPlan (items = [], { minSlots = TRIGGER_SLOTS, stickCap = STICK_CAP, capacity = BAG_SLOTS } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (it.count ?? 1) > 0)
  const before = list.length
  const none = why => ({ crafts: 0, freed: 0, why, before, after: before, peak: before })
  if (before < minSlots) return none(`bag at ${before} of ${capacity} slots, below ${minSlots}: nothing to free`)
  const bamboo = countOf(list, 'bamboo'), sticks = countOf(list, 'stick')
  if (bamboo < 2) return none(`${bamboo} bamboo: a stick takes 2`)
  const maxCrafts = Math.floor(bamboo / 2)
  const sim = simulateFold(list, maxCrafts)
  let needsRoom = null, capped = null
  for (let k = 1; k <= sim.steps.length; k++) {
    const st = sim.steps[k - 1]
    const freed = before - st.after
    if (st.tossed > 0) { needsRoom ??= { k }; break }          // every larger batch passes through this toss too
    if (freed <= 0) continue
    if (!(sticks + k <= stickCap || st.stickSlots <= sim.stickSlotsBefore)) { capped ??= k; continue }
    const peak = craftRoom(list, BAMBOO_STICK, k, { capacity: Infinity }).peak
    if (peak > capacity) { needsRoom ??= { k, peak }; continue }
    return { crafts: k, freed, why: `${k} craft(s): ${2 * k} bamboo -> ${k} sticks frees ${freed} slot(s)`, before, after: st.after, peak }
  }
  if (needsRoom) return none(`${needsRoom.k} craft(s) would need ${needsRoom.peak ? needsRoom.peak - capacity : 1} more slot(s) on the way`)
  if (capped) return none(`${capped} craft(s) would free a slot but pass the ${stickCap}-stick cap with a new stick slot`)
  return none(`no batch of up to ${maxCrafts} craft(s) frees a slot (${bamboo} bamboo, ${sticks} sticks)`)
}

/**
 * A FOLD AS CRAFT'S MAKE-ROOM STEP (bamboocraft-01) -> { fold, crafts, freed, before, after, reason, why }. Pure.
 * A room-blocked milestone craft wins the decision every time, so the housekeeping order (bambooOrder) is never asked
 * even when folding would free the slot the craft needs (review of bamboo-01). craft() asks this BEFORE wearing out a
 * tool: a fold destroys nothing, a wear-out destroys a tool copy, so the cheapest safe remedy goes first.
 *   items     the bag (mineflayer Item[] with `slot`)
 *   recipe    the pending craft as craftroom sees it ({ consumes, outputs }: roomRecipe)
 *   protect   more ingredients to keep (a whole-tree plan's later steps)
 *   reserve   slots the room check holds back (a table to take back, an item on the ground): the craft must fit in
 *             capacity - reserve, exactly as admitRoom asks it
 *   leftMs    the time the craft has left for the fold (its window must fit, foldWindow)
 *   verifiable  the server's bag can be read back after the fold (craftsync installed). Default FALSE: a caller must
 *             say so (Codex r1: a fold only the local bag can confirm is not a remedy)
 * fold is true only when ALL hold:
 *   - the craft does not consume bamboo, nor does anything in `protect` (the fold spends bamboo; sticks it ADDS are
 *     fine for a craft that needs sticks -- the after-bag below decides)
 *   - the craft is blocked by ROOM, not ingredients, on the bag as it is now
 *   - a batch exists that bambooPlan would also run: frees a slot as the bot really runs it (simulateFold), throws
 *     nothing, keeps to the stick cap (sticks + crafts <= STICK_CAP, or no new stick slot), and its craftRoom PEAK fits
 *   - its window fits the time left (foldWindow)
 *   - THE CRAFT FITS ON THE BAG THE FOLD LEAVES (craftRoom on simulateFold's after-bag, capacity - reserve): a fold that
 *     frees a slot the craft's output cannot use (a stick stack the fold just filled, a table slot still short) is no
 *     remedy
 * The SMALLEST such batch is chosen. No minimum bag size: the craft's own room check already said the bag is full.
 */
export function foldForCraft ({ items = [], recipe = {}, protect = [], reserve = 0, leftMs = Infinity, stickCap = STICK_CAP, capacity = BAG_SLOTS, verifiable = false } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (it.count ?? 1) > 0)
  const before = list.length
  const none = (reason, why) => ({ fold: false, crafts: 0, freed: 0, before, after: before, reason, why })
  if (!verifiable) return none('unverifiable', 'no server recount (craftsync) to confirm a fold made room: a fold nobody can confirm is not a remedy')
  const uses = [...(recipe?.consumes ?? []), ...(protect ?? [])].map(c => c?.name ?? c)
  if (uses.includes('bamboo')) return none('craft_uses_bamboo', 'the craft consumes bamboo: a fold would spend its ingredient')
  const room = craftRoom(list, recipe, 1, { capacity: capacity - reserve })
  if (room.ok) return none('fits', 'the craft already fits')
  if (room.reason !== 'no_room') return none('ingredients', `the craft lacks ${room.missing}: no room problem to solve`)
  const bamboo = countOf(list, 'bamboo'), sticks = countOf(list, 'stick')
  if (bamboo < 2) return none('no_bamboo', `${bamboo} bamboo: a stick takes 2`)
  const sim = simulateFold(list, Math.floor(bamboo / 2), { bags: true })
  let first = null
  const note = (reason, why) => { first ??= { reason, why } }
  for (let k = 1; k <= sim.steps.length; k++) {
    const st = sim.steps[k - 1]
    if (st.tossed > 0) { note('needs_room', `${k} craft(s) would throw an item on the ground`); break }
    const freed = before - st.after
    if (freed <= 0) continue
    if (!(sticks + k <= stickCap || st.stickSlots <= sim.stickSlotsBefore)) {
      note('stick_cap', `${k} craft(s) would pass the ${stickCap}-stick cap with a new stick slot`); continue
    }
    const peak = craftRoom(list, BAMBOO_STICK, k, { capacity: Infinity }).peak
    if (peak > capacity) { note('needs_room', `${k} craft(s) would need ${peak - capacity} more slot(s) on the way`); continue }
    if (!foldWindow(k, { leftMs }).fits) { note('too_long', `${k} craft(s) cannot finish in the ${Math.round(Math.max(0, leftMs) / 1000)} s the craft has left`); break }
    if (!craftRoom(st.bag, recipe, 1, { capacity: capacity - reserve }).ok) {
      note('not_enough', `${k} craft(s) free ${freed} slot(s) but the craft still does not fit`); continue
    }
    return { fold: true, crafts: k, freed, before, after: st.after, reason: 'fold',
             why: `${k} craft(s): ${2 * k} bamboo -> ${k} sticks frees ${freed} slot(s) for the craft` }
  }
  return none(first?.reason ?? 'frees_nothing', first?.why ?? `no batch of up to ${Math.floor(bamboo / 2)} craft(s) frees a slot (${bamboo} bamboo, ${sticks} sticks)`)
}

/**
 * THE GATE BEFORE EVERY EXECUTION -> null (go on) | { reason, detail }. Pure. Asked by craftroom's executor before each
 * execution AND inside craftsync's admission, against the bag the server holds after the baseline resync (Codex: 36
 * slots, bamboo x2, sticks x63, one stick arriving during the baseline made 65 sticks and freed nothing). The REMAINING
 * batch must still free a slot as the bot really runs it, throw nothing, and keep to the stick cap; otherwise the
 * fold stops there and what it already made stays.
 */
export function bambooGate (items = [], remaining = 0, { stickCap = STICK_CAP } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (it.count ?? 1) > 0)
  if (remaining <= 0) return null
  const sim = simulateFold(list, remaining)
  if (sim.short) return { reason: 'gate_short', detail: `fewer than ${2 * remaining} bamboo left for the batch` }
  if (sim.tossed > 0) return { reason: 'gate_no_room', detail: 'the rest of the batch would throw an item on the ground' }
  if (list.length - sim.after <= 0) return { reason: 'gate_no_longer_frees', detail: `the remaining ${remaining} craft(s) no longer free a slot` }
  const sticks = countOf(list, 'stick')
  if (!(sticks + remaining <= stickCap || sim.stickSlotsAfter <= sim.stickSlotsBefore)) {
    return { reason: 'gate_stick_cap', detail: `${sticks} sticks + ${remaining} would pass the ${stickCap}-stick cap with a new stick slot` }
  }
  return null
}

/**
 * THE BAMBOO RECIPE, never craft('stick')'s first pick (which may spend planks) -> the recipe | null. Pure.
 * Among `recipes` (mineflayer Recipe objects for a stick), the one whose ONLY ingredient is bamboo.
 */
export function bambooStickRecipe (recipes = [], registry) {
  const id = registry?.itemsByName?.bamboo?.id
  if (id == null) return null
  return (recipes ?? []).find(r => {
    const takes = (r?.delta ?? []).filter(d => d.count < 0)
    return takes.length > 0 && takes.every(d => d.id === id)
  }) ?? null
}

// ---- the order ------------------------------------------------------------------------------------------------------

/**
 * THE HOUSEKEEPING CHAIN'S PRECEDENCE -> the first order. Pure. `first` (the milestone work order) wins; otherwise each
 * step is asked IN ORDER and only while nothing has been chosen -- a step that charges a cooldown when it issues
 * (wear_out, bamboo) is never even asked once an earlier one has issued.
 */
export function firstOrder (first, ...steps) {
  let order = first ?? null
  for (const step of steps) {
    if (order) break
    order = step() ?? null
  }
  return order
}

/** One fold order per bot per two minutes at most (like wear_out); a fold that failed backs off half an hour. */
/**
 * THE FOLD'S DECLARED STATIONARY WINDOW (sandbox 10-04). A fold stands still on purpose, ~1.1 s per craft; the stuck
 * watchdog (fleet 20 s) cut a 32-craft fold at 15 crafts (freed nothing) and a 64-craft fold can never finish. Like the
 * compost visit, the fold declares bot.stationaryUntil -- bounded by its OWN budget: crafts x perCraftMs + marginMs,
 * capped at capMs and at the time the skill has left (leftMs). The fold also runs to that time as its deadline, so the
 * exemption never outlives the work. -> { ms, fits, maxCrafts }: `fits` false = the batch cannot finish inside the
 * window, and it is refused rather than started (bambooPlan's batch is already the SMALLEST that frees a slot: a cut
 * batch would free nothing). Pure.
 */
export const FOLD_MS_PER_CRAFT = 1300
export const FOLD_MARGIN_MS = 5000
export const FOLD_WINDOW_CAP_MS = 90_000
export function foldWindow (crafts, { leftMs = Infinity, perCraftMs = FOLD_MS_PER_CRAFT, marginMs = FOLD_MARGIN_MS, capMs = FOLD_WINDOW_CAP_MS } = {}) {
  const limit = Math.max(0, Math.min(capMs, leftMs))
  const need = Math.max(0, crafts) * perCraftMs + marginMs
  return { ms: Math.min(need, limit), fits: crafts > 0 && need <= limit, maxCrafts: Math.max(0, Math.floor((limit - marginMs) / perCraftMs)) }
}

export const BAMBOO_COOLDOWN_MS = 2 * 60 * 1000
export const BAMBOO_BACKOFF_MS = 30 * 60 * 1000

/**
 * THE HOUSEKEEPING ORDER -> { order | null, lastAt }. Pure; cognitive.mjs supplies the bag and keeps the state.
 * Deterministic and chatOnly (the model never chooses it): issued when the cooldown and any backoff are clear AND
 * bambooPlan finds a batch that frees a slot (which already requires 34+ slots). The cooldown is charged when the
 * order is ISSUED, like wear_out's. Runs where the bot stands: no table, no walk.
 */
export function bambooOrder ({ items = [], now = 0, lastAt = 0, backoffUntil = 0 } = {}) {
  if (now - (lastAt ?? 0) < BAMBOO_COOLDOWN_MS || now < (backoffUntil ?? 0)) return { order: null, lastAt }
  const plan = bambooPlan(items)
  if (!plan.crafts) return { order: null, lastAt }
  return { order: { skill: 'bamboo_sticks', args: {}, why: `inventory at ${plan.before} of 36 slots; ${plan.why}` }, lastAt: now }
}

/** After the order ran -> the new backoff deadline: a failure backs off; a skip, a success or an abort costs nothing. */
export function bambooOrderOutcome (status, now = 0) {
  return status === 'failed' ? now + BAMBOO_BACKOFF_MS : 0
}
