// THE TOWN DEPOSIT: a full bag at town banks its surplus, deterministically, before other work.
//
// Measured 10-05 (docs/reports/bag-creep-analysis-2026-10-05.md, 24 h, 80 bots): bots at >= 34 of 36 slots made 829
// town stays (77 bots, median 9 min; town = 16 h / 12 v of home). In 715 of them a deposit would have freed at least
// one slot (median 4); only 231 tried any deposit, 130 succeeded, and the median bag LEFT TOWN AS FULL AS IT ARRIVED.
// Nothing deposits on its own: the composter and withdraw have town orders, deposit only runs when the model picks
// it (9,582 proposals a day, 527 successes, 3,338 of them for apples the bank refuses). Craftroom's 2,658 daily
// "deposit X" refusals were followed by any deposit 7% of the time -- advice printed is not advice taken.
//
// OWNER, 10-05 ~18:30Z: "yes add automatic town deposit". Expected 2-4 slots per full town stay (the report: of ~5.1
// freeable slots, 2.0 are pickaxes -- spent ones must stay -- and 1.6 are logs and cobble the ladder asks to hold).
//
// WHAT IT BANKS -- the fleet's own bankable rules (bankable.mjs depositPlan: standing targets, always-banked ores,
// spare tools; never ballast, never a station, never food), and of those only what NO OTHER RULE KEEPS:
//   - the stockpile rungs (milestones.mjs): wood (logs + planks/4) and the COBBLE family are kept to min(held, 64),
//     dirt 16 and sand 8 (the gatherer chain) -- a deposit below them re-opens a gather rung and the two rules fight;
//   - the iron ladder's inputs (raw_iron, iron_ingot, iron_ore, coal...) stay with the bot: the bank is write-only
//     today, and an ingot in a chest is not a bucket or a pickaxe;
//   - the active rung's wants and their ingredients, up to a stack each;
//   - the scaffold reserve (8 cheapest + 2 sticks, bankable.mjs scaffoldKeep);
//   - tools: never a copy at or below toolfor's FLOOR (a spent tool is the wear-out's, not the bank's), and the BEST
//     usable copy of each name always stays. The copy that moves is chosen by SLOT, because chest.deposit(type) takes
//     the first copy by slot and could bank the good pickaxe while keeping the spent one.
// WHOLE STACKS ONLY, smallest first: every transfer frees exactly one slot, so "frees >= 1 slot" is exact, and a
// partial stack -- which frees nothing -- is never moved.
//
// A property test (test/towndeposit.test.mjs) runs every gatherer and SUSTAINING rung's REAL done() over random full
// bags before and after the plan, at several laps: no rung changes state. That is the "do not fight the ladder" rule
// as a check rather than a promise.

import { depositPlan, scaffoldKeep, withdrawHolds } from './bankable.mjs'
import { remaining, FLOOR } from './toolfor.mjs'
import { TRIGGER_SLOTS } from './hygiene.mjs'

/** The bag the order acts on: the bot's own slot count (bot.inventory.items().length), never an estimate. */
export const TD_TRIGGER_SLOTS = TRIGGER_SLOTS
/** Town, as every bag/town measurement in the reports defines it: within 16 blocks of home horizontally, 12 vertically. */
export const TOWN_H = 16
export const TOWN_V = 12
/** A town container must be this close to the bot (3D): no walk across town, which is where deposits die. */
export const STORAGE_REACH = 16
/** Cooldown charged at ISSUE; backoff after a failed run (nothing banked because the town could not take it). */
export const TD_COOLDOWN_MS = 5 * 60 * 1000
export const TD_BACKOFF_MS = 15 * 60 * 1000
/** World scans (containers) at most this often per bot. */
export const TD_SCAN_MS = 30 * 1000
/** ONE attempt per town stay: re-armed by 60 s outside town, or 15 min after the last issue while still in town. */
export const TD_REARM_OUTSIDE_MS = 60 * 1000
export const TD_STAY_REARM_MS = 15 * 60 * 1000
/** The run's bounds: 45 s in all, 10 s to reach a container, 8 s to open it (deposit's measured open bound), at most two
 *  containers, and the last 5 s reserved for closing and reading the bag back. */
export const TD_BUDGET_MS = 45 * 1000
export const TD_WALK_MS = 10 * 1000
export const TD_OPEN_MS = 8 * 1000
export const TD_SETTLE_MS = 5 * 1000
export const TD_MAX_CONTAINERS = 2

/** depositPlan's creditCap (bankable.mjs bankableInventory default): the most of one name a VISIT banks. */
export const CREDIT_CAP = 64
/** Kept as totals by the stockpile rungs (milestones.mjs STOCKPILE_MAX). */
export const STOCKPILE_KEEP = 64
/** The gatherer chain's held counts for items that are never bankable anyway (asserted against the chain). */
export const HELD_TARGETS = Object.freeze({ dirt: 16, sand: 8 })
/** Planks kept whatever the logs: the pickaxe rungs' `stick >= 2 || planks >= 2` and the table's `planks >= 4`. */
export const PLANKS_MEANS = 4
/** A wanted item (active rung + ingredients) is kept up to one stack. */
export const WANTED_KEEP = 64
/** The iron ladder's inputs: the town deposit never banks them (the model's deposit verb still may). */
export const IRON_LADDER = Object.freeze(['raw_iron', 'iron_ingot', 'iron_nugget', 'iron_ore', 'deepslate_iron_ore', 'coal', 'charcoal'])

// THE SAME FAMILIES AS milestones.mjs (a test asserts equality): copied, not imported, because milestones imports
// skills.mjs, which imports this module.
export const LOGS = Object.freeze(['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'])
export const PLANKS = Object.freeze(['oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks'])
export const COBBLE = Object.freeze(['cobblestone', 'cobbled_deepslate', 'blackstone', 'stone', 'andesite', 'diorite', 'granite', 'tuff'])
/** Kept first within the stone family: a pickaxe and a furnace are made of these; smooth stone makes neither. */
const COBBLE_KEEP_ORDER = ['cobblestone', 'cobbled_deepslate', 'blackstone', 'andesite', 'diorite', 'granite', 'tuff', 'stone']

const TOOL_RE = /_(pickaxe|axe|shovel|sword|hoe)$/

/** At town? Pure: pos and home are {x, y, z}. */
export function inTownZone (pos, home, { h = TOWN_H, v = TOWN_V } = {}) {
  if (!pos || !home) return false
  return Math.hypot(pos.x - home.x, pos.z - home.z) <= h && Math.abs(pos.y - (home.y ?? pos.y)) <= v
}

const countsOf = items => {
  const c = {}
  for (const it of items) if (it?.name) c[it.name] = (c[it.name] ?? 0) + (it.count ?? 0)
  return c
}
const byHeldDesc = counts => (a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || (a < b ? -1 : a > b ? 1 : 0)

/**
 * WHAT STAYS IN THE BAG, as a TOTAL per name -> { keep: {name: n}, why: {name: rule} }. Pure. Every rule is a
 * floor; the strongest wins (never a sum). Each rule keeps min(held, its target): a deposit never deepens a deficit.
 */
export function townKeeps (counts = {}, { wanted = [] } = {}) {
  const keep = {}, why = {}
  const floor = (name, n, rule) => {
    const k = Math.min(counts[name] ?? 0, Math.max(0, n))
    if (k > (keep[name] ?? 0)) { keep[name] = k; why[name] = rule }
  }
  // wood: units = logs + floor(planks / 4) (milestones.mjs woodUnits); logs first, most-held species first.
  let wood = Math.min(STOCKPILE_KEEP, LOGS.reduce((t, n) => t + (counts[n] ?? 0), 0) + Math.floor(PLANKS.reduce((t, n) => t + (counts[n] ?? 0), 0) / 4))
  for (const n of [...LOGS].sort(byHeldDesc(counts))) { const k = Math.min(wood, counts[n] ?? 0); if (k > 0) { floor(n, k, 'stockpile_wood'); wood -= k } }
  for (const n of [...PLANKS].sort(byHeldDesc(counts))) { const k = Math.min(wood * 4, counts[n] ?? 0); if (k > 0) { floor(n, k, 'stockpile_wood'); wood -= Math.floor(k / 4) } }
  // stone: the family total, cobblestone kept first.
  let stone = Math.min(STOCKPILE_KEEP, COBBLE.reduce((t, n) => t + (counts[n] ?? 0), 0))
  for (const n of COBBLE_KEEP_ORDER) { const k = Math.min(stone, counts[n] ?? 0); if (k > 0) { floor(n, k, 'stockpile_stone'); stone -= k } }
  // THE LADDER'S MEANS (milestones.mjs TECH_LADDER): the pickaxe rungs ask `stick >= 2 || planks >= 2` and the table
  // rung `planks >= 4 || logs >= 1` -- with the logs kept above, a few planks keep every one of them reachable.
  let means = Math.min(PLANKS_MEANS, PLANKS.reduce((t, n) => t + (counts[n] ?? 0), 0))
  for (const n of [...PLANKS].sort(byHeldDesc(counts))) { const k = Math.min(means, counts[n] ?? 0); if (k > 0) { floor(n, k, 'ladder_means'); means -= k } }
  for (const [n, t] of Object.entries(HELD_TARGETS)) floor(n, t, 'gather_rung')
  for (const n of IRON_LADDER) floor(n, Infinity, 'iron_ladder')
  for (const n of new Set([wanted ?? []].flat().filter(x => typeof x === 'string'))) floor(n, WANTED_KEEP, 'wanted')
  for (const [n, k] of Object.entries(scaffoldKeep(counts))) floor(n, k, 'scaffold_reserve')
  return { keep, why }
}

/** Uses left on one copy (Infinity for an undamageable item). */
const usesOf = it => remaining(it)

/**
 * WHICH COPIES OF ONE TOOL NAME MAY BE BANKED -> their slots. Pure. Spent copies (<= FLOOR uses) never; the best usable
 * copy (most uses, then the lower slot) always stays; every other usable copy may go, best first, up to `allowance`.
 */
export function toolSlotsToBank (copies = [], allowance = Infinity) {
  const usable = copies.filter(c => usesOf(c) > FLOOR).sort((a, b) => usesOf(b) - usesOf(a) || a.slot - b.slot)
  return usable.slice(1, 1 + Math.max(0, allowance)).map(c => c.slot)
}

/**
 * THE PLAN -> { steps: [{ slot, name, count }], freed, slots, keep, why, banked: {name: n} }. Pure over mineflayer
 * Items ({ name, count, slot, maxDurability, durabilityUsed }). `wanted` is the active rung's wanted set.
 *   allowance  depositPlan(items, null, { wants: [] }): the fleet's bankable rules and creditCap 64, unchanged -- so a
 *              future change to what deposit may bank (withdraw's hold, its usable-tool rule) applies here too --
 *              less `already`, what this visit has already banked by name.
 *   keeps      townKeeps; the iron ladder never moves.
 *   steps      WHOLE stacks, smallest first, while what remains >= the keep and the allowance lasts. One step = one
 *              slot emptied, so freed = steps.length.
 */
export function townDepositPlan (items = [], { wanted = [], already = {} } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (it.count ?? 0) > 0)
  const counts = countsOf(list)
  const { keep, why } = townKeeps(counts, { wanted })
  // ONE ALLOWANCE PER VISIT (Codex review 1): the plan is recomputed for a second container, and creditCap must cap the
  // VISIT -- what an earlier container of this run already took (`already`, name -> items) is spent.
  // depositPlan already judges the REDUCED bag, so the visit's spend comes off the cap, not off that count (Codex round 2).
  const allowance = Object.fromEntries(depositPlan(list, null, { wants: [] })
    .map(({ name, count }) => [name, Math.min(count, Math.max(0, CREDIT_CAP - (Math.max(0, Number(already?.[name]) || 0))))]))
  const steps = [], banked = {}
  const holds = withdrawHolds()
  for (const name of Object.keys(allowance).sort()) {
    const copies = list.filter(it => it.name === name)
    if (TOOL_RE.test(name)) {
      // A TOOL JUST WITHDRAWN (withdraw's 10-min hold): NO copy of that name moves while the hold lasts. The hold is a
      // count, not a copy, and the copies are chosen here by uses -- with 130/40 held and a 120 just withdrawn, the
      // count rule alone would bank the withdrawn 120 (rebase review, Codex P2).
      if ((holds[name] ?? 0) > 0) { why[name] = 'withdraw_hold'; continue }
      for (const slot of toolSlotsToBank(copies, allowance[name])) {
        const it = copies.find(c => c.slot === slot)
        steps.push({ slot, name, count: it.count ?? 1 }); banked[name] = (banked[name] ?? 0) + (it.count ?? 1)
      }
      continue
    }
    let room = Math.min(allowance[name], (counts[name] ?? 0) - (keep[name] ?? 0))
    for (const it of [...copies].sort((a, b) => (a.count ?? 0) - (b.count ?? 0) || a.slot - b.slot)) {
      if ((it.count ?? 0) > room) break
      steps.push({ slot: it.slot, name, count: it.count }); banked[name] = (banked[name] ?? 0) + it.count; room -= it.count
    }
  }
  steps.sort((a, b) => a.slot - b.slot)
  return { steps, freed: steps.length, slots: list.length, keep, why, banked }
}

/**
 * WHERE EACH STACK GOES -> the steps that fit, in order, each with `dest` (a container slot). Pure. EMPTY SLOTS ONLY,
 * one per step, so the move is two left clicks (pick the stack up, put it down) whose result the client can predict
 * exactly: an empty slot takes any whole stack, components and all. Merging into a partial stack is deliberately not
 * done (Codex review 1, P1): a stack whose components differ swaps instead of merging on the server while the client
 * believes it merged, and a stack that does not fit leaves the rest on the cursor -- a loaded close is a drop.
 *   containerSlots  the window's slots [0, inventoryStart): Item | null
 */
export function fitToContainer (steps = [], containerSlots = []) {
  const free = []
  for (let i = 0; i < containerSlots.length; i++) if (!containerSlots[i]) free.push(i)
  return steps.slice(0, free.length).map((s, k) => ({ ...s, dest: free[k] }))
}

/**
 * THE OTHER HALF OF A DOUBLE CHEST -> its position, or null for a single chest / a barrel. Pure over the block state's
 * properties ({ type: single|left|right, facing }). Vanilla ChestBlock.getConnectedDirection: LEFT -> facing turned
 * clockwise, RIGHT -> counter-clockwise. Two adjacent chests are one container only when they name each other.
 */
const CW = { north: 'east', east: 'south', south: 'west', west: 'north' }
const CCW = { north: 'west', west: 'south', south: 'east', east: 'north' }
const STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }
export function doubleChestPartner (pos, props = {}) {
  const t = props?.type, f = props?.facing
  if (!pos || !STEP[f] || (t !== 'left' && t !== 'right')) return null
  const [dx, dz] = STEP[t === 'left' ? CW[f] : CCW[f]]
  return { x: pos.x + dx, y: pos.y, z: pos.z + dz }
}

/**
 * THE WALK TO A TOWN CHEST: the shared walk profile, cloned, that never digs, towers or bridges (Codex review 1: the
 * walk profile enables 1x1 towers and scaffold, so a chest one block up or across a gap would cost blocks the keeps
 * exist to protect, and "never place" would be false). Pure: the base profile is not touched.
 */
export function townWalkMovements (base) {
  if (!base) return base
  const m = Object.assign(Object.create(Object.getPrototypeOf(base)), base)
  m.canDig = false
  m.allow1by1towers = false
  m.scafoldingBlocks = []
  return m
}

const lazy = v => (typeof v === 'function' ? v() : v)

/**
 * THE ORDER -> { order, state }. Pure; cognitive.mjs supplies the readings and keeps `state`.
 *   now, slots (items.length), pos, home       cheap, first
 *   plan       townDepositPlan(...) -- value or function, evaluated lazily, at most once per TD_SCAN_MS
 *   container  is there a town container within STORAGE_REACH of the bot -- value or function, lazy
 *   state      { lastScanAt, lastIssuedAt, backoffUntil, latched, outsideSince }
 */
export function townDepositOrder ({ now = 0, slots = 0, pos = null, home = null, plan = null, container = false, state = {} } = {}) {
  const s = { ...state }
  const none = () => ({ order: null, state: s })
  if (!inTownZone(pos, home)) {
    if (s.outsideSince == null) s.outsideSince = now
    if (now - s.outsideSince >= TD_REARM_OUTSIDE_MS) s.latched = false
    return none()
  }
  s.outsideSince = null
  if (slots < TD_TRIGGER_SLOTS) return none()
  if (s.latched && now - (s.lastIssuedAt ?? -Infinity) < TD_STAY_REARM_MS) return none()
  if (now - (s.lastIssuedAt ?? -Infinity) < TD_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return none()
  if (now - (s.lastScanAt ?? -Infinity) < TD_SCAN_MS) return none()
  s.lastScanAt = now
  const p = lazy(plan)
  if (!p || !(p.freed >= 1)) return none()
  if (!lazy(container)) return none()
  s.lastIssuedAt = now
  s.latched = true
  return { order: { skill: 'town_deposit', args: {},
                    why: `at town with ${slots} of 36 slots used; ${p.freed} whole stack(s) of surplus to bank` }, state: s }
}

/** The runner declined to start it: the stay is not spent (the cooldown charged at issue still applies). */
export const TD_RUNNER_DECLINED = new Set(['runner_paused', 'runner_busy', 'body_held'])

/** After the order ran -> the new state. failed backs off; success clears the backoff; a skip or an interruption is free. */
export function townDepositOutcome (status, failClass = null, now = 0, state = {}) {
  const s = { ...state }
  if (TD_RUNNER_DECLINED.has(failClass)) { s.latched = false; return s }
  if (status === 'success') s.backoffUntil = 0
  else if (status === 'failed') s.backoffUntil = now + TD_BACKOFF_MS
  return s
}

/** The run's row: slots, what moved, the containers, why it stopped, the cursor. Under the logger's 300-char cap. */
export function townDepositDetail ({ slotsBefore = 0, slotsAfter = 0, banked = {}, stacks = 0, tried = [], stop = 'done', unsettled = 0, bagDelta = null, planned = 0, tools = [], clicked = null, unverified = 0 } = {}) {
  const moved = Object.entries(banked).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, n]) => `${k}:${n}`).join(',') || '-'
  const t = tried.map(c => `${c.at}=${c.result}`).join(';') || '-'
  // THE TOOLS GO FIRST after the counts: the read's spent-tool gate parses `tools name@uses,...` and must never lose it
  // to the 300-char cut; the containers and the stop reason are the ones that may be truncated.
  // `stacks` = stacks the SERVER showed in the chest on a re-open; `clicked` = stacks the client moved; bagdelta = the
  // bag's loss over the banked names in the SERVER's copy of the bag on that re-open (bagdelta > banked = items that left
  // the bag and are not in the chest).
  return `slots ${slotsBefore}->${slotsAfter} stacks ${stacks}/${planned} clicked ${clicked ?? stacks} bagdelta ${bagDelta ?? '?'} tools ${tools.join(',') || '-'} banked ${moved} stop ${stop}${unsettled ? ` cursor_unsettled ${unsettled}` : ''}${unverified ? ` unverified ${unverified}` : ''} containers ${t}`.slice(0, 300)
}
