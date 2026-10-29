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
//   - the stockpile rungs (milestones.mjs): wood (logs + planks/4) to min(held, WOOD_KEEP = 16; logbank-01, OWNER 10-27) and
//     the COBBLE family to min(held, 64),
//     dirt 16 and sand 8 (the gatherer chain) -- a deposit below them re-opens a gather rung and the two rules fight;
//   - the iron ladder's inputs: since cobblekeep-01 (OWNER 10-19 ~14:10Z "coal and iron must get banked in town") only
//     what the bot's OWN next rungs need -- IRON_KEEP (3) iron units, ingots first, then raw iron, then ore, each name kept
//     WHOLE (the deposit moves whole stacks only), and coal/charcoal only while (coal: 8 of it, the rest split off -- coalfirst-01) the bot still holds raw iron or ore to
//     smelt itself; the rest (raw iron above three ingots, ore, coal) is banked for the town's smelt jobs and
//     toolkits. See ironKeeps below;
//   - the active rung's wants and their ingredients, up to a stack each;
//   - the scaffold reserve (8 cheapest + 2 sticks, bankable.mjs scaffoldKeep);
//   - tools: never a copy at or below toolfor's FLOOR (a spent tool is the wear-out's, not the bank's), and the BEST
//     usable copy of each name always stays. The copy that moves is chosen by SLOT, because chest.deposit(type) takes
//     the first copy by slot and could bank the good pickaxe while keeping the spent one.
// WHOLE STACKS ONLY, smallest first: every transfer frees exactly one slot, so "frees >= 1 slot" is exact, and a
// partial stack -- which frees nothing -- is never moved. ONE EXCEPTION, logs only (logbank-01): a log stack too big to
// leave whole is HALVED (a right click on it lifts ceil(n/2), exactly predictable) while the half still fits above the keep
// -- see logHalfSteps. A half frees no slot, so it never counts in `freed` and never fires an order on its own.
//
// A property test (test/towndeposit.test.mjs) runs every gatherer and SUSTAINING rung's REAL done() over random full
// bags before and after the plan, at several laps: no rung changes state. That is the "do not fight the ladder" rule
// as a check rather than a promise.

import { depositPlan, scaffoldKeep, withdrawHolds, setStockKeeps, NEVER_BANKABLE, STANDING_TARGETS, DEPOSIT_ALWAYS } from './bankable.mjs'
import { remaining, FLOOR, tier, isPickaxe } from './toolfor.mjs'
import { TRIGGER_SLOTS, NEVER_KEEP } from './hygiene.mjs'
// THE SLIM BAG ALLOWANCE (junkout-01, bagallowance.mjs): the rows' surplus leaves at the town deposit, at any bag size
import { ALLOWANCE, BAG_ALLOWANCE, allowanceSteps, visitId, visitLatchIssue, visitArmed } from './bagallowance.mjs'
// junk never enters a chest (owner 10-04): the well's list and the composter's own judgement, not a copy of them
import { WELL_JUNK } from './well.mjs'
import { isCompostJunk } from './composter.mjs'
import { PEACEFUL_COMPOST } from './peacefulkit.mjs'
import { groupOf } from './stocktarget.mjs'
import { RUNNER_DECLINED } from './declined.mjs'
// THE PEACEFUL KIT (peacefulkit.mjs, owner 10-07 ~19:50Z): while the food policy's switch is on no sword is ever banked.
import { peacefulFoodActive } from './foodskip.mjs'
// cobblekeep-01 (Codex r3 P2): the bot's OWN smelts, whatever they are, keep their fuel (smelting.mjs is pure, no imports)
import { smeltRecipeFor, smeltInputsFor } from './smelting.mjs'
// logbank-01: the personal wood keep, ONE number shared with milestones.mjs's stockpile_wood ceiling (a leaf module)
import { WOOD_KEEP, LOGBANK } from './woodkeep.mjs'
// coalfirst-01 (OWNER 10-29): the bag's coal keep and the coal split (coalrun.mjs is a leaf module)
import { COALFIRST, COAL_KEEP, coalKeepOf } from './coalrun.mjs'
export { WOOD_KEEP }

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
/** The stone family kept as a total by the stockpile_stone rung (milestones.mjs STOCKPILE_MAX). Wood keeps WOOD_KEEP. */
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
  let wood = Math.min(WOOD_KEEP, LOGS.reduce((t, n) => t + (counts[n] ?? 0), 0) + Math.floor(PLANKS.reduce((t, n) => t + (counts[n] ?? 0), 0) / 4))
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
  for (const [n, k] of Object.entries(ironKeeps(counts, { wanted }))) floor(n, k, 'iron_ladder')
  for (const n of new Set([wanted ?? []].flat().filter(x => typeof x === 'string'))) floor(n, WANTED_KEEP, 'wanted')
  for (const [n, k] of Object.entries(scaffoldKeep(counts))) floor(n, k, 'scaffold_reserve')
  return { keep, why }
}

/**
 * THE IRON LADDER'S KEEP (cobblekeep-01; OWNER 10-19 ~14:10Z "coal and iron must get banked in town") -> { name: n }. Pure.
 * Was every unit of IRON_LADDER, for good (`floor(n, Infinity)`), so towns ran dry while bags held it: 24 h to 10-19,
 * 484 town smelt jobs stopped "no coal in town" with a townmate carrying coal at 69% of them, and 253 toolkit "no iron"
 * refusals with a townmate carrying >= 3 ingots at 77%.
 *   IRON: IRON_KEEP (3) units for EACH iron craft the bag has not made yet -- the bucket and the iron pickaxe, 3 ingots
 *         each, counted as their rungs count them (countItem 'bucket', 'iron_pickaxe') -- and never fewer than 3 (the
 *         gather rung counts raw + ingots >= 3; the smelt rung 3 ingots). Claude r3 P1-1: a flat 3 banked the raw iron of a
 *         bot that lacked BOTH, which crafted the bucket and went back underground for the pickaxe's iron. Names in
 *         IRON_KEEP_ORDER, ingots first, each kept WHOLE until the units are covered: the town deposit moves whole stacks
 *         only, so a name is either kept or banked entire, never split. Measured 10-19 (80 bags): ingots 1-3 per bot
 *         (34 bots at exactly 3: their next craft), so ingots stay; raw iron above three ingots and ore go (nuggets are
 *         not on the bank's list: bankable.mjs).
 *   FUEL: coal and charcoal (the first name held, WHOLE; coal since coalfirst-01: always COAL_KEEP 8, see below) stay while the bot keeps something of its OWN to smelt -- the raw
 *         iron or ore kept above, or the active rung's wanted smelt (the inputs of an output it wants: glass -> sand;
 *         never wood, which is fuel and charcoal's input; a wanted input alone is a gather or craft, not a smelt). Codex r3 P2: 8 sand for wanted glass banked
 *         all the coal and turned the smelt into no_fuel. The KEPT wood does not count as the alternative: it is the
 *         stockpile rungs' (burning it re-opens them), so with nothing of its own to smelt the coal goes, else it stays.
 *         (Away from town the room order still keeps ROOM_FUEL_RESERVE 16 coal, skills.mjs roomDepositTarget: a different
 *         exit, a different reserve; and a raw-iron smelt with no coal may burn a few of the kept planks, as before.)
 */
export const IRON_KEEP = 3
export const IRON_KEEP_ORDER = Object.freeze(['iron_ingot', 'raw_iron', 'iron_ore', 'deepslate_iron_ore'])
export const FUEL_KEEP_ORDER = Object.freeze(['coal', 'charcoal'])
export const IRON_CRAFTS = Object.freeze(['bucket', 'iron_pickaxe'])
export function ironUnitsNeeded (counts = {}) {
  return Math.max(IRON_KEEP, IRON_KEEP * IRON_CRAFTS.filter(n => !((Number(counts[n]) || 0) > 0)).length)
}
export function ironKeeps (counts = {}, { wanted = [] } = {}) {
  const keep = {}
  const held = n => Math.max(0, Number(counts[n]) || 0)
  let need = ironUnitsNeeded(counts), toSmelt = 0
  for (const n of IRON_KEEP_ORDER) {
    if (need <= 0) break
    const h = held(n)
    if (!h) continue
    keep[n] = h; need -= h
    if (n !== 'iron_ingot') toSmelt += h
  }
  // THE ACTIVE RUNG'S OWN SMELT: the inputs of a wanted OUTPUT (glass -> sand; never wood: it is the fuel). A wanted item
  // that is merely smeltable is not a smelt (Claude r4 P3-1: the cobble stockpile, furnace and stone pickaxe rungs all want
  // cobblestone, and the gatherer's sand rung sand -- none of them burns coal)
  const isOre = n => IRON_KEEP_ORDER.includes(n)
  const smeltable = n => { const r = smeltRecipeFor(n); return !!r && r.output !== 'charcoal' && !isOre(n) }
  const inputs = new Set()
  for (const w of new Set([wanted ?? []].flat().filter(x => typeof x === 'string'))) {
    for (const i of smeltInputsFor(w)) if (smeltable(i)) inputs.add(i)
  }
  for (const i of inputs) toSmelt += held(i)
  // coalfirst-01 (OWNER 10-29 "a bot keeps only a small allowance for its own tool/smelt needs"): while the bot smelts, COAL keeps
  // COAL_KEEP (8) of the stack, not all of it -- the spare is banked for the town's smelt jobs (the stack above the keep is
  // split: townDepositPlan `coalSplit`); charcoal is kept whole as before; nothing to smelt: all the coal goes, as before
  if (toSmelt > 0) for (const n of FUEL_KEEP_ORDER) { const h = held(n); if (h) { keep[n] = n === 'coal' ? coalKeepOf(h, toSmelt) : h; break } }
  return keep
}

// THE STOCK TARGETS' KEEPS (stocktarget-01, design 3.2): the ordinary deposit, the town deposit and the well leave the SAME
// bag behind -- these keeps -- for every targeted name. Installed here (bankable.mjs cannot import this module: a cycle).
setStockKeeps((counts, wants) => townKeeps(counts, { wanted: Array.isArray(wants) ? wants : [] }).keep)

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
export function townDepositPlan (items = [], { wanted = [], already = {}, noSwords = peacefulFoodActive(), valve = false,
                                               tail = null, peaceful = noSwords, bagAllowance = BAG_ALLOWANCE.on, halves = LOGBANK.on, coalSplit = COALFIRST.on } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (it.count ?? 0) > 0)
  const counts = countsOf(list)
  const { keep, why } = townKeeps(counts, { wanted })
  // ONE ALLOWANCE PER VISIT (Codex review 1): the plan is recomputed for a second container, and creditCap must cap the
  // VISIT -- what an earlier container of this run already took (`already`, name -> items) is spent.
  // depositPlan already judges the REDUCED bag, so the visit's spend comes off the cap, not off that count (Codex round 2).
  // noSwords: the switch's reading (default) -- excluding can only lower the plan, so neither the order nor the run banks a
  // sword while it is on, and no order fires that would not have fired without the kit.
  // logbank-01 r3 (LIVE 10-27, showcase-e8525ca4): EVERY log species is bankable here while the switch is on. bankable.mjs's
  // STANDING_TARGETS name oak, birch and jungle logs only, so the showcase's spruce (all ten bots: 64-73 spruce_log, no other
  // log) read `not_wanted` -- no step, no count, no order, for an hour. Wood is wood (milestones.mjs LOGS).
  // ...as bankable, NOT as wanted: a want is kept up to a stack (Paper r3, a well town: only the 9 left, 64 kept)
  const allowance = Object.fromEntries(depositPlan(list, null, { wants: [], bankableToo: halves ? [...LOGS] : [], noSwords })
    .map(({ name, count }) => [name, Math.min(count, Math.max(0, CREDIT_CAP - (Math.max(0, Number(already?.[name]) || 0))))]))
  const steps = [], banked = {}
  const holds = withdrawHolds()
  // THE ROWS' MODE (junkout-01): 'only' -- the not-full visit's tail order (tailOrder): the rows' steps and nothing else (no
  // base plan, no valve); otherwise (a full bag's town deposit, or a chat order) the base plan THEN the rows; off -- today.
  // A TAIL RUN NEVER BANKS THE BASE PLAN, whatever the switch says (a not-full bag's base plan is not this change's)
  const baseOn = tail !== 'only'
  const rowsMode = !bagAllowance || tail === false ? null : tail === 'only' ? 'only' : 'append'
  // logbank-01 r2 (OWNER 10-27 "implement ... all the changes"): a NOT-FULL visit's tail also banks the LOGS above the personal
  // keep (whole stacks, then halves) -- at any bag size, under the same switch. Nothing else of the base plan joins the tail.
  const logsTail = tail === 'only' && halves
  // coalfirst-01 (OWNER 10-29 "coal ... deposited"): the not-full visit's tail banks the COAL above the keep too (whole stacks,
  // then halves), as logbank-01 r2 does the logs -- coal reached town only in a full bag, and a smelting bot's never
  const coalTail = tail === 'only' && coalSplit && (counts.coal ?? 0) > COAL_KEEP   // no churn: a handful stays for the full bag
  const tailName = n => (logsTail && LOGS.includes(n)) || (coalTail && n === 'coal')
  const baseNames = baseOn ? Object.keys(allowance).sort() : (logsTail || coalTail) ? Object.keys(allowance).filter(tailName).sort() : []
  for (const name of baseNames) {
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
    const left = []
    for (const it of [...copies].sort((a, b) => (a.count ?? 0) - (b.count ?? 0) || a.slot - b.slot)) {
      if ((it.count ?? 0) > room) { left.push(it); continue }
      steps.push({ slot: it.slot, name, count: it.count }); banked[name] = (banked[name] ?? 0) + it.count; room -= it.count
    }
    // coalfirst-01: the coal stack above the keep is HALVED as the logs are (logHalfSteps: never below the keep) -- a bot with 20
    // coal and a keep of 8 banked nothing before (room 12 < 20); now 10, keeping 10
    if ((halves && LOGS.includes(name)) || (coalSplit && name === 'coal')) {
      for (const st of logHalfSteps(left, room)) { steps.push({ ...st, name }); banked[name] = (banked[name] ?? 0) + st.count }
    }
  }
  // THE VALVE (stocktarget design 3.2): when nothing else frees a slot and the caller has PROVEN it (`valve`: no well-able,
  // compostable or bankable stack), ONE tool copy that TODAY's tool rule would bank (the best usable copy of each name
  // stays, spent copies never move) goes in above the town's tool target -- tools are never destroyed, so a full bag of
  // spare tools keeps this one move. Its claim is a `valve` claim (skills.mjs bankInto); the read gates it.
  if (!steps.some(st => !st.half) && valve && baseOn) {   // logbank-01: a log half frees no slot, so it never blocks the valve
    const free = depositPlan(list, null, { wants: [], noSwords, noToolCap: true })
    for (const { name, count } of free) {
      if (!TOOL_RE.test(name) || (holds[name] ?? 0) > 0) continue
      const slot = toolSlotsToBank(list.filter(it => it.name === name), Math.min(1, count))[0]
      if (slot == null) continue
      const it = list.find(c => c.slot === slot)
      steps.push({ slot, name, count: it.count ?? 1, valve: true }); banked[name] = (banked[name] ?? 0) + (it.count ?? 1); why[name] = 'valve'
      break
    }
  }
  // THE ROWS (junkout-01, bagallowance.mjs): stations 1 each, torch 0, bone meal 0 -- whole stacks, smallest first, the goal's
  // and every townKeeps floor kept, the visit's CREDIT_CAP per name -- and row P, the stone pickaxes beyond the best working
  // pickaxe and two spares (stonePickSteps). Never a name another layer owns (bankOwned), never junk (notForChest), never a
  // name the base plan already moves this visit, never a name a withdraw hold covers. After the valve: the valve is only for a
  // bag with nothing else to free.
  let keepPicks = null
  if (rowsMode) {
    const planned = new Set(steps.map(st => st.name))
    const owned = n => planned.has(n) || bankOwned(n) || notForChest(n, { peaceful }) || (holds[n] ?? 0) > 0
    const room = n => Math.max(0, CREDIT_CAP - (Math.max(0, Number(already?.[n]) || 0)))
    for (const st of allowanceSteps(list, { owned, keeps: keep, room })) {
      steps.push({ slot: st.slot, name: st.name, count: st.count, allowance: st.row })
      banked[st.name] = (banked[st.name] ?? 0) + st.count
      why[st.name] = `allowance_${st.row}`
    }
    if (!planned.has('stone_pickaxe')) {
      // the tool rule's own room under the town's stone_pickaxe target (depositPlan above), less what this visit moved
      const toolRoom = Math.max(0, Math.min(allowance.stone_pickaxe ?? 0, CREDIT_CAP) - (Math.max(0, Number(already?.stone_pickaxe) || 0)))
      const sp = stonePickSteps(list, { holds, room: toolRoom })
      keepPicks = sp.keepPicks
      for (const st of sp.steps) {
        steps.push({ slot: st.slot, name: st.name, count: st.count, allowance: 'pickaxe' })
        banked[st.name] = (banked[st.name] ?? 0) + st.count
        why[st.name] = 'allowance_pickaxe'
      }
    }
  }
  // THE BASE PLAN'S STACKS FIRST (bagbudget-01, Claude design r1 P2-3): fitToContainer takes the first free container slots in
  // step order, so a short chest takes the coal, iron and cobble before a torch; within each part, by bag slot as before
  // logbank-01: a log half after every whole stack, the rows' included (it frees no slot, so a short chest takes the
  // slot-freeing stacks first); the halves of one slot keep their order (a stable sort), the second reading the slot the first left
  const rank = st => (st.half ? 2 : st.allowance ? 1 : 0)   // halves LAST: every slot-freeing stack takes chest room first (Codex r1 P2)
  steps.sort((a, b) => rank(a) - rank(b) || a.slot - b.slot)
  return { steps, freed: steps.filter(st => !st.half).length, slots: list.length, keep, why, banked, keepPicks }
}

/**
 * THE LOG HALF-SPLIT (logbank-01, OWNER 10-27) -> [{ slot, count, from, half: true }]. Pure. `stacks` are the log copies the
 * whole-stack rule could not move (each bigger than `room`), `room` what may still leave above the keep. The deposit moves
 * whole stacks only, so a bot holding one 64 stack and a keep of 16 banked NOTHING: room 48 < 64. A right click on a bag
 * stack of n lifts ceil(n/2) onto the cursor and leaves floor(n/2) (vanilla, and prismarine-windows splitSlot predicts it);
 * the cursor then goes whole into an EMPTY chest slot, as every other step. Halving repeats while the half still fits:
 * 64 with room 48 -> 32 (room 16) -> 16 (room 0): the bag keeps exactly 16. Never below the keep (each half <= room), and
 * the largest stack first (fewest clicks). `from` is the slot's count before the click, which the runner re-checks.
 */
export function logHalfSteps (stacks = [], room = 0) {
  const out = []
  let r = Math.max(0, Math.floor(Number(room) || 0))
  for (const it of [...stacks].filter(x => (x?.count ?? 0) > 1).sort((a, b) => b.count - a.count || a.slot - b.slot)) {
    let cur = it.count
    while (cur > 1 && Math.ceil(cur / 2) <= r) {
      const take = Math.ceil(cur / 2)
      out.push({ slot: it.slot, count: take, from: cur, half: true })
      r -= take; cur -= take
    }
  }
  return out
}

/** The deposit row's wood fields (logbank-01) -> 'logs banked B kept K keep W'. Pure. */
export function logsField (banked = {}, after = {}) {
  const b = LOGS.reduce((t, n) => t + (Number(banked?.[n]) || 0), 0)
  const k = LOGS.reduce((t, n) => t + (Number(after?.[n]) || 0), 0)
  return `logs banked ${b} kept ${k} keep ${WOOD_KEEP}`
}

/**
 * ROW P (junkout-01; OWNER 10-21 "at most 2 spare stone pickaxes beyond the best working pickaxe") -> { steps, keepPicks }.
 * Pure. The best WORKING pickaxe (> FLOOR uses; highest tier, then most uses, then the lower slot) stays; of the other stone
 * copies the ALLOWANCE.stoneSpares with the most uses stay; of the rest, only USABLE copies (> FLOOR) are listed -- a worn
 * or spent copy is never a chest's (the tool rule: toolSlotsToBank), it wears out at a full bag (hygiene wear_out). At most
 * `room` copies (the town's stone_pickaxe target, through depositPlan's tool cap; the bank click's stock claim re-checks it).
 * Never an iron (or any other) pickaxe: ironpick-01's toolkit flow owns those. `keepPicks`: the stone copies the rule keeps
 * whatever happens (the read's J2 floor).
 * MEASURED 10-21 (80 bags): 172 stone copies; beyond best + 2: 25 copies in 19 bags, ALL spent -- this row moves 0 today.
 */
export function stonePickSteps (items = [], { holds = {}, room = Infinity } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && isPickaxe(it.name) && Number.isInteger(it.slot))
  const working = list.filter(it => remaining(it) > FLOOR)
    .sort((a, b) => tier(b.name) - tier(a.name) || remaining(b) - remaining(a) || a.slot - b.slot)
  const best = working[0] ?? null
  const stone = list.filter(it => it.name === 'stone_pickaxe' && it !== best)
    .sort((a, b) => remaining(b) - remaining(a) || a.slot - b.slot)
  const kept = stone.slice(0, ALLOWANCE.stoneSpares)
  const keepPicks = kept.length + (best?.name === 'stone_pickaxe' ? 1 : 0)
  if ((holds?.stone_pickaxe ?? 0) > 0) return { steps: [], keepPicks }
  const steps = stone.slice(ALLOWANCE.stoneSpares).filter(it => remaining(it) > FLOOR).slice(0, Math.max(0, Number(room) || 0))
    .map(it => ({ slot: it.slot, name: it.name, count: it.count ?? 1, row: 'pickaxe' }))
  return { steps, keepPicks }
}

/**
 * NAMES ANOTHER LAYER OWNS (bagbudget-01): the rows never speak for them. Tools (the tool rule, the wear-out, the tool
 * target; row P is its own rule above), every targeted group (stocktarget: cobble, logs, planks, sticks, stone, dirt ...),
 * the iron ladder (ironKeeps), and the bank's standing targets and always-banked ores (bankable.mjs). Pure.
 */
export function bankOwned (name) {
  return typeof name !== 'string' || TOOL_RE.test(name) || !!groupOf(name) || IRON_LADDER.includes(name) ||
    STANDING_TARGETS.has(name) || DEPOSIT_ALWAYS.includes(name) || COBBLE.includes(name)
}
/**
 * NEVER INTO A CHEST BY THE ROWS (OWNER 10-04 "never deposit junk"; bagbudget-01, Codex design r1 P1-2/P1-3): the bank's
 * ballast, the junk well's list, hygiene's NEVER_KEEP, what the composter takes -- its plant litter always, and under the
 * peaceful switch its peaceful plants and the apples -- every sapling (the composter's reserve rule decides them) and
 * bamboo. The well and the composter stay their only exits. Pure.
 */
export function notForChest (name, { peaceful = false } = {}) {
  return typeof name !== 'string' || NEVER_BANKABLE.has(name) || WELL_JUNK.has(name) || NEVER_KEEP.has(name) ||
    isCompostJunk(name) || /(_sapling|_propagule)$/.test(name) || name === 'bamboo' ||
    (peaceful && (Object.hasOwn(PEACEFUL_COMPOST, name) || name === 'apple'))
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
export function townDepositOrder ({ now = 0, slots = 0, pos = null, home = null, plan = null, container = false, state = {}, count = false } = {}) {
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
  // THE STOCK TARGETS' COUNT (design 3.7): nothing bankable yet, but a targeted surplus the town cannot judge (ceiling
  // unknown, or at target by the 6 h ceiling and not by the 1 h floor) -- count the town's containers first, so the plan or
  // the well can act (Codex r2 7, Claude r2 P1-2: no full bag waits for a count nobody takes)
  // logbank-01 (both reviews r1 P2): a full bag whose only surplus is a log stack above the keep (halves, freed 0) is a deposit
  // too -- the owner asked for the logs in town; without this a 64-stack never reached the chest
  const logsOnly = !!p && !(p.freed >= 1) && Array.isArray(p.steps) && p.steps.some(x => x.half)
  if (!p || (!(p.freed >= 1) && !logsOnly)) {
    if (!lazy(count) || !lazy(container)) return none()
    s.lastIssuedAt = now
    s.latched = true
    return { order: { skill: 'town_deposit', args: { recount: true },
                      why: `at town with ${slots} of 36 slots used; the town's stock of what is carried must be counted first` }, state: s }
  }
  if (!lazy(container)) return none()
  s.lastIssuedAt = now
  s.latched = true
  // A ROWS-ONLY PLAN STILL TAKES THE COUNT STEP (bagbudget-01, Claude design r1 P2-6): the rows made freed >= 1, which used to
  // mean "nothing to count first" -- uncounted cobble or wood is counted in the same run, then planned again
  const only = Array.isArray(p.steps) && p.steps.length > 0 && p.steps.every(x => x.allowance)
  const recount = only && !!lazy(count)
  return { order: { skill: 'town_deposit', args: { ...(recount ? { recount: true, count: 'allowance_only' } : {}) },
                    why: `at town with ${slots} of 36 slots used; ${p.freed} whole stack(s) of surplus to bank${logsOnly ? ' (logs above the personal keep)' : ''}${p.steps?.some(x => x.valve) ? ' (the valve: one spare tool)' : ''}` }, state: s }
}

/**
 * THE SLIM ALLOWANCE AT A NOT-FULL TOWN VISIT (junkout-01; OWNER 10-21 "do NOT require the bag to be full for this tail").
 * -> { order, state }. Pure; cognitive.mjs supplies the readings and keeps `state`.
 *   plan       townDepositPlan(items, { tail: 'only' }) -- the rows' steps ONLY (no base plan, no count, no valve); lazy
 *   container  a town container within STORAGE_REACH (lazy)
 *   state      { latched, issuedAt, outsideSince (bagallowance.mjs visitLatchTick, ticked on every decision with the town
 *              deposit's zone and its 15-min stay), lastIssuedAt, backoffUntil, lastScanAt }
 * In the town deposit's zone (16 h / 12 v) only, below TD_TRIGGER_SLOTS only (a full bag's town deposit appends the rows
 * itself), ONCE PER STAY (charged at issue), on the town deposit's own cooldown and backoff. A FREE-DECISION order in
 * cognitive.mjs's visit slot: never the reason for a trip, a walk across town or a new chest (depositPlan never sees it).
 */
export function tailOrder ({ now = 0, slots = 0, pos = null, home = null, plan = null, container = false, state = {}, on = BAG_ALLOWANCE.on, myName = '', logCount = false } = {}) {
  const s = { ...state }
  const none = () => ({ order: null, state: s })
  if (!on || !inTownZone(pos, home) || s.latched) return none()
  if (!(slots < TD_TRIGGER_SLOTS)) return none()
  if (now - (s.lastIssuedAt ?? -Infinity) < TD_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return none()
  if (now - (s.lastScanAt ?? -Infinity) < TD_SCAN_MS) return none()
  s.lastScanAt = now
  const p = lazy(plan)
  // logbank-01 r2: logs above the keep are a reason on their own (a half frees no slot)
  const logs = LOGBANK.on && !!p && Array.isArray(p.steps) && p.steps.some(x => LOGS.includes(x.name) && !x.allowance)
  // coalfirst-01: coal above the keep is a reason on its own (a half frees no slot; the town index needs no count for coal)
  const coal = COALFIRST.on && !!p && Array.isArray(p.steps) && p.steps.some(x => x.name === 'coal' && !x.allowance)
  // logbank-01 r2: logs above the keep that the town cannot judge yet (a well town, never counted: town_stock_unknown) --
  // count first, in the same run (`logCount`: cognitive.mjs's stockCountKeys over the bag's LOGS only), as the full-bag
  // order's count step does. Without it a well town's tail never banked a log.
  // independent of the rows (r2 reviews, both P2): a torch to bank must not spend the stay's latch while the logs wait uncounted
  const count = LOGBANK.on && !logs && !!lazy(logCount)
  if (!p || !(p.freed >= 1 || logs || coal || count)) return none()
  if (!lazy(container)) return none()
  const dh = Math.round(Math.hypot(pos.x - home.x, pos.z - home.z)), dy = Math.round(pos.y - (home.y ?? pos.y))
  s.lastIssuedAt = now
  return { order: { skill: 'town_deposit', args: { tail: true, armed: visitArmed(s), dh, dy, vid: visitId(myName, now), ...(count || logs ? { logs: true } : {}), ...(coal ? { coal: true } : {}), ...(count ? { recount: true, count: 'allowance_only' } : {}) },
                    why: `at town with ${slots} of 36 slots used; ${p.freed} whole stack(s) over the bag allowance (stations, torches, bone meal, spare stone pickaxes) to bank${logs ? '; logs above the personal keep' : count ? '; the town\'s logs to count, then logs above the personal keep' : ''}${coal ? '; coal above the bag\'s keep' : ''}` },
           state: visitLatchIssue(s, now) }
}

/** The runner declined to start it: the stay is not spent (the cooldown charged at issue still applies). */
export const TD_RUNNER_DECLINED = RUNNER_DECLINED   // the one shared set (declined.mjs, homefix-01)

/** After the order ran -> the new state. failed backs off; success clears the backoff; a skip or an interruption is free. */
export function townDepositOutcome (status, failClass = null, now = 0, state = {}) {
  const s = { ...state }
  if (TD_RUNNER_DECLINED.has(failClass)) { s.latched = false; return s }
  if (status === 'success') s.backoffUntil = 0
  else if (status === 'failed') s.backoffUntil = now + TD_BACKOFF_MS
  return s
}

/** The run's row: slots, what moved, the containers, why it stopped, the cursor. Under the logger's 300-char cap. */
export function townDepositDetail ({ slotsBefore = 0, slotsAfter = 0, banked = {}, stacks = 0, tried = [], stop = 'done', unsettled = 0, bagDelta = null, planned = 0, tools = [], clicked = null, unverified = 0, capRefused = null, stock = null, logs = null } = {}) {
  const moved = Object.entries(banked).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, n]) => `${k}:${n}`).join(',') || '-'
  const t = tried.map(c => `${c.at}=${c.result}`).join(';') || '-'
  // THE TOOLS GO FIRST after the counts: the read's spent-tool gate parses `tools name@uses,...` and must never lose it
  // to the 300-char cut; the containers and the stop reason are the ones that may be truncated.
  // `stacks` = stacks the SERVER showed in the chest on a re-open; `clicked` = stacks the client moved; bagdelta = the
  // bag's loss over the banked names in the SERVER's copy of the bag on that re-open (bagdelta > banked = items that left
  // the bag and are not in the chest).
  // `cobble_cap at_cap/unknown/outside`: cobble stacks the town cap refused in this run's transfer (cobblecap.mjs)
  const cap = capRefused && (capRefused.at_cap || capRefused.unknown || capRefused.outside) ? ` cobble_cap ${capRefused.at_cap ?? 0}/${capRefused.unknown ?? 0}/${capRefused.outside ?? 0}` : ''
  // stocktarget: claims admitted / refused for the other targeted names, the valve, and a count step
  const st = stock && (stock.claims || stock.refused || stock.valve || stock.counted != null) ? ` stock ${stock.claims ?? 0}/${stock.refused ?? 0}${stock.valve ? ` valve ${stock.valve} nothing_else=1` : ''}${stock.counted != null ? ` counted ${stock.counted}` : ''}` : ''
  return `slots ${slotsBefore}->${slotsAfter} stacks ${stacks}/${planned} clicked ${clicked ?? stacks} bagdelta ${bagDelta ?? '?'} tools ${tools.join(',') || '-'}${logs ? ` ${logs}` : ''}${cap}${st} banked ${moved} stop ${stop}${unsettled ? ` cursor_unsettled ${unsettled}` : ''}${unverified ? ` unverified ${unverified}` : ''} containers ${t}`.slice(0, 300)
}
