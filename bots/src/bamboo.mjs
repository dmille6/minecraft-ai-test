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
 * bambooPlan(items) -> { crafts, freed, why, before, after, peak }
 *   items  mineflayer Item[] (one entry per occupied slot)
 * crafts > 0 only when ALL hold:
 *   - the bag is at TRIGGER_SLOTS (34) or more occupied slots -- housekeeping, not a craft on a whim
 *   - at least 2 bamboo
 *   - sticks held + crafts <= STICK_CAP
 *   - the batch FREES a slot: occupied before - occupied after > 0, simulated by craftRoom, and its peak never exceeds
 *     the bag (a batch that needs a temporary slot the bag does not have is refused, not tried)
 * The SMALLEST such batch is chosen: it frees the slot and spends the least bamboo. Worked cases (both engines):
 *   bamboo [64] + sticks [32]  -> 32 crafts, frees 1 (the bamboo stack empties, the sticks top up to 64)
 *   bamboo [64], no sticks     -> nothing frees (the bamboo slot becomes the sticks' slot)
 *   bamboo [64,64], no sticks  -> 64 crafts frees 1, but needs a temporary slot for the first stick
 *   bamboo [63] + sticks [32]  -> 31 crafts leaves 1 bamboo: nothing frees; an odd remainder never empties a stack
 */
export function bambooPlan (items = [], { minSlots = TRIGGER_SLOTS, stickCap = STICK_CAP, capacity = BAG_SLOTS } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (it.count ?? 1) > 0)
  const before = list.length
  const none = why => ({ crafts: 0, freed: 0, why, before, after: before, peak: before })
  if (before < minSlots) return none(`bag at ${before} of ${capacity} slots, below ${minSlots}: nothing to free`)
  const bamboo = countOf(list, 'bamboo'), sticks = countOf(list, 'stick')
  if (bamboo < 2) return none(`${bamboo} bamboo: a stick takes 2`)
  const maxCrafts = Math.min(Math.floor(bamboo / 2), stickCap - sticks)
  if (maxCrafts < 1) return none(`already ${sticks} sticks, at the ${stickCap}-stick cap`)
  let needsRoom = null
  for (let k = 1; k <= maxCrafts; k++) {
    const r = craftRoom(list, BAMBOO_STICK, k, { capacity: Infinity })
    if (!r.ok) continue
    const freed = before - r.after
    if (freed <= 0) continue
    if (r.peak > capacity) { needsRoom ??= { k, peak: r.peak }; continue }
    return { crafts: k, freed, why: `${k} craft(s): ${2 * k} bamboo -> ${k} sticks frees ${freed} slot(s)`, before, after: r.after, peak: r.peak }
  }
  if (needsRoom) return none(`${needsRoom.k} craft(s) would free a slot but need ${needsRoom.peak - capacity} more slot(s) on the way`)
  return none(`no batch of up to ${maxCrafts} craft(s) frees a slot (${bamboo} bamboo, ${sticks} sticks)`)
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

/** One fold order per bot per two minutes at most (like wear_out); a fold that failed backs off half an hour. */
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
