// KITTRIM, THE BANK HALF (kittrim-01; kittrim.mjs says why and what was measured). At a town deposit -- the full bag's run and
// the not-full visit's tail -- the USABLE (> FLOOR) tool copies beyond the trimmed kit go into the town chests:
//   pickaxes  every working copy but the kept pair (kittrim.mjs kitPickKeep: the best + one spare)
//   axe / shovel / hoe  every working copy but the best of the KIND (withdrawpick bestToolCopy: >= 40 uses, then tier, then uses)
// Never a worn copy (<= FLOOR: the wear-out's, by use), never a name under a withdraw hold, never above the town's stock target
// for the name (stocktarget class C; the bank click's claim re-checks it), and never a copy whose leaving would make any of
// these WORSE for the bag (each one a rule some other layer acts on -- a trim that tripped one would start that layer's work
// at once, or close a door it keeps open):
//   usable_pickaxe   a pickaxe above FLOOR (withdraw_pick's 'pick' need)
//   escape_reserve   ESCAPE_RESERVE (2) pickaxes above HARD_STOP (reflex mayDigForEscape refuses a stone dig on one)
//   harvest_tier     the highest tier among working pickaxes (iron harvests gold/redstone/diamond; stone harvests iron)
//   trip_pickaxe     oretunnel hasTripPickaxe (the stone and iron rungs, the ore trip, withdraw_pick's 'trippick' line)
//   deep_trip        deepmine tripTarget (deepminer-01: the trip the bag pays for -- a diamond trip needs ~220 low uses)
//   craft_cover      toolhygiene redundantCraft for stone / wooden / iron pickaxes (a craft refused before stays refused:
//                    no bank-then-craft churn)
//   kit_need         toolkit kitNeeds (the iron pickaxe, axe and shovel the kit would draw town iron for)
// Each measure only falls as items leave the bag, so the trim adds back its best-ranked candidate until none is worse.
// Pure over mineflayer Items; the town's room comes through bankable.mjs's installed stock reader (or an injected `room`).

import { KITTRIM, kindOf, kitPickKeep, byTierUses, kitTag } from './kittrim.mjs'
import { remaining, FLOOR, HARD_STOP, ESCAPE_RESERVE, tier, isPickaxe } from './toolfor.mjs'
import { hasTripPickaxe } from './oretunnel.mjs'
import { redundantCraft } from './toolhygiene.mjs'
import { kitNeeds } from './toolkit.mjs'
import { tripKit, tripTarget } from './deepmine.mjs'
import { bestToolCopy } from './withdrawpick.mjs'
import { groupOf, isToolGroup, targetOf, roomUnder } from './stocktarget.mjs'
import { stockTownView, stockReaderInstalled } from './bankable.mjs'

const working = it => remaining(it) > FLOOR
const TRIP_RANK = { iron: 1, diamond: 2 }
const COVER = ['stone_pickaxe', 'wooden_pickaxe', 'iron_pickaxe']
/** The guards: name -> measure(bag) -> number. A trim may not lower any of them. */
export const KIT_GUARDS = Object.freeze({
  usable_pickaxe: b => (b.some(it => isPickaxe(it.name) && working(it)) ? 1 : 0),
  escape_reserve: b => Math.min(ESCAPE_RESERVE, b.filter(it => isPickaxe(it.name) && remaining(it) > HARD_STOP).reduce((n, it) => n + (it.count ?? 1), 0)),
  harvest_tier: b => Math.max(-1, ...b.filter(it => isPickaxe(it.name) && working(it)).map(it => tier(it.name))),
  trip_pickaxe: b => (hasTripPickaxe(b) ? 1 : 0),
  deep_trip: b => TRIP_RANK[tripTarget(tripKit(b))] ?? 0,
  craft_cover: b => COVER.filter(item => redundantCraft(item, b) != null).length,
  kit_need: b => -kitNeeds(b).length,
})
/** The first guard the trimmed bag makes worse -> its name, or null. Pure. */
export function kitGuardBroken (before = [], after = [], guards = KIT_GUARDS) {
  for (const [name, f] of Object.entries(guards)) if (f(after) < f(before)) return name
  return null
}

/** The town's room for copies of a tool name -> a number (Infinity: uncapped -- an untargeted name, or no stock reader, as
 *  bankable.mjs's tool cap), or null when the town's count is unknown (the trim then banks none: bankable's 'town_stock_unknown'). */
export function kitToolRoom (name) {
  const g = groupOf(name)
  if (!g || !isToolGroup(g) || !stockReaderInstalled()) return Infinity
  return roomUnder(stockTownView(g), targetOf(g))
}

/**
 * THE KIT TRIM AT A TOWN DEPOSIT -> { steps: [{ slot, name, count, uses, tag }], kept: [slot], held: { why: n } }. Pure but for
 * the default `room`.
 *   items    the bag the trim judges (towndeposit passes the bag LESS what its plan already moves)
 *   holds    withdraw holds (name -> count): no copy of a held name moves
 *   room     name -> copies the town may take (kitToolRoom); less `planned[name]`, the copies the plan already moves
 * Within a name the better copies are banked first (the bag keeps the worn ones for tool hygiene to dig with first).
 */
export function kitTrimBank (items = [], { on = KITTRIM.on, holds = {}, room = kitToolRoom, planned = {}, guards = KIT_GUARDS } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (it.count ?? 1) > 0 && Number.isInteger(it.slot))
  const held = {}
  const hold = why => { held[why] = (held[why] ?? 0) + 1 }
  if (!on) return { steps: [], kept: [], held }
  const keep = new Set()
  const cand = []
  {
    const { best, spare } = kitPickKeep(list)
    if (best) {
      keep.add(best); if (spare) keep.add(spare)
      cand.push(...list.filter(it => isPickaxe(it.name) && !keep.has(it) && working(it)))
    }
  }
  for (const k of ['axe', 'shovel', 'hoe']) {
    const of = list.filter(it => kindOf(it.name) === k)
    const best = bestToolCopy(of)
    if (!best) continue
    keep.add(best)
    cand.push(...of.filter(it => it !== best && working(it)))
  }
  cand.sort(byTierUses)
  // holds, then the town's room per name (better copies first), then the guards
  const used = {}, rooms = {}
  const roomOf = name => (name in rooms ? rooms[name] : (rooms[name] = room(name)))   // one town read per name
  let bank = []
  for (const it of cand) {
    if ((holds?.[it.name] ?? 0) > 0) { hold('withdraw_hold'); continue }
    const rr = roomOf(it.name)
    if (rr == null || !(Number(rr) >= 0)) { hold('town_stock_unknown'); continue }
    const r = Number(rr) - Math.max(0, Number(planned?.[it.name]) || 0)
    if ((used[it.name] ?? 0) >= r) { hold('town_stock_target'); continue }
    used[it.name] = (used[it.name] ?? 0) + 1
    bank.push(it)
  }
  while (bank.length) {
    const left = list.filter(it => !bank.includes(it))
    const broken = kitGuardBroken(list, left, guards)
    if (!broken) break
    hold(`guard_${broken}`)
    bank = bank.slice(1)   // the best-ranked banked copy stays, and the guards are asked again
  }
  const steps = bank.sort((a, b) => a.slot - b.slot)
    .map(it => ({ slot: it.slot, name: it.name, count: it.count ?? 1, uses: Number.isFinite(remaining(it)) ? remaining(it) : null, tag: kitTag(it) }))
  return { steps, kept: [...keep].map(it => it.slot).sort((a, b) => a - b), held }
}
/** The held reasons as one field -> 'guard_trip_pickaxe:1,town_stock_target:2' | ''. Pure. */
export const kitHeldField = (held = {}) => Object.entries(held).filter(([, n]) => n > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, n]) => `${k}:${n}`).join(',')
