// TOWNIRON-01: THE TOWN IRON RESERVE (docs/reports/towniron-01-design-2026-10-23.md; OWNER 2026-10-23 answers A "option 1" and
// B "build it now"). ONE setting, two consumers:
//   1. the IRON TASK stays open for the town: a rung after the bot's own iron rungs (milestones.mjs gather_iron_ore_town) asks
//      the bot to mine iron ore while its town's iron is below the reserve, until it carries TOWN_IRON_CARRY above its own
//      keep -- the town deposit banks raw iron above that keep (towndeposit.mjs ironKeeps), so the iron reaches the chests;
//   2. the TOOLKIT'S SHOVEL TIER drops to stone while the town's iron is below the reserve (toolkit.mjs kitNeeds): no iron
//      shovel is drawn for, and a bag with no usable shovel at all and a cobblestone-family block makes a stone one.
//
// MEASURED 10-23 (ES 24 h, the town index, the 00:15Z census): the toolkit drew 710 iron ingots in 24 h -- 277 iron shovels
// (1 each; 289 iron shovels broke in the same window, so they wear out at the rate they are made: 209 of the 277 were made for
// a bag holding no shovel at all), 141 iron pickaxes, 5 axes -- against ~476-543 raw iron mined; 184 of 667 kit runs failed
// no_iron, all of them in towns whose index-known ingots were <= 86 (placebo-a 51: 55 of 63 runs; placebo-c 38: 49 of 78;
// isolated-c 30: 21 of 22); towns at >= 94 index-known ingots had none.
//
// THE TOWN'S IRON is what the town index (townindex-01) KNOWS: per container KNOWN (townindex.mjs indexStateOf: its latest
// observation -- server-sent contents at an open, any bot -- newer than every mutation mark and younger than 6 h), iron_ingot
// + raw_iron. A container mutated since its last open (dirty), stale or never opened counts NOTHING (Codex r1 P2: a withdrawal
// after the observation would otherwise keep its iron counted), so the reading under-counts what bots can see -- both
// consumers then err toward keeping iron in town -- and it is a lower bound of the town's stock as long as only bots move town
// iron (a non-bot mutation is the exception; none in these towns). Fewer than TOWN_IRON_MIN_CONTAINERS known containers, or an
// unreadable index, is UNKNOWN: both consumers then do exactly the base.
//
// TOWNIRON=off is the one-setting rollback (both consumers off: the base). TOWN_IRON_RESERVE=<units> sets the reserve.
import { TOWNINDEX, indexStateOf } from './townindex.mjs'

const envInt = (name, dflt, min = 0) => {
  const v = Number(typeof process !== 'undefined' ? process.env[name] : undefined)
  return Number.isFinite(v) && v >= min && String(process.env[name]).trim() !== '' ? Math.floor(v) : dflt
}
/** TOWNIRON=on|off, default on; anything else reads as on, said in the mode row. Pure. */
export function townIronMode (env = {}) {
  const raw = env?.TOWNIRON
  if (raw == null || String(raw).trim() === '') return { on: true, mode: 'on', note: 'TOWNIRON unset' }
  const v = String(raw).trim().toLowerCase()
  if (['off', '0', 'false', 'no'].includes(v)) return { on: false, mode: 'off', note: null }
  if (['on', '1', 'true', 'yes'].includes(v)) return { on: true, mode: 'on', note: null }
  return { on: true, mode: 'on', note: `TOWNIRON=${String(raw).slice(0, 20)} unreadable, using on` }
}
export const TOWNIRON = Object.freeze(townIronMode(typeof process !== 'undefined' ? process.env : {}))
/** The reserve, in iron units (iron_ingot + raw_iron) per town. 64: no kit no_iron in any town at >= 94 index-known ingots,
 *  all 184 at <= 86; a kit draw takes 1-7 and keeps 4 per container; one stack. */
export const TOWN_IRON_RESERVE = envInt('TOWN_IRON_RESERVE', 64, 1)
/** What the town task asks a bot to carry ABOVE its own iron keep before it is done (the deposit banks it). */
export const TOWN_IRON_CARRY = 16
/** The bot's own iron the rung leaves aside: the deposit keeps 3 per iron craft not made yet (towndeposit.mjs ironKeeps). */
export const TOWN_IRON_SELF = 3
/** An observation counts while younger than this (the index's own INDEX_STALE_MS). */
export const TOWN_IRON_OBS_MS = 6 * 60 * 60 * 1000
/** Fewer fresh observations than this: the town's iron is unknown (both consumers: the base). */
export const TOWN_IRON_MIN_CONTAINERS = 3
/** The reader's memo (one index fold per this long, not per call: the ladder asks on every decision). */
export const TOWN_IRON_MEMO_MS = 30_000

/**
 * THE TOWN'S IRON -> { units, ingots, raw, containers, seen } | null. Pure. `entries` the town index's fold ({ k: entry },
 * townindex.mjs readIndex) or null (unreadable). A KNOWN container (indexStateOf) whose observation is not stamped more than 60 s
 * in the future counts; `seen` = every entry the fold holds (the coverage denominator); null when fewer than `min` count.
 */
export function townIronStock (entries, now = Date.now(), { obsMs = TOWN_IRON_OBS_MS, min = TOWN_IRON_MIN_CONTAINERS } = {}) {
  if (!entries || typeof entries !== 'object') return null
  let ingots = 0, raw = 0, containers = 0, seen = 0
  for (const e of Object.values(entries)) {
    seen++
    const o = e?.obs, at = Number(o?.at)
    if (indexStateOf(e, now, obsMs) !== 'known' || !Number.isFinite(at) || at > now + 60_000) continue
    containers++
    ingots += Number(o.names?.iron_ingot?.[0]) || 0
    raw += Number(o.names?.raw_iron?.[0]) || 0
  }
  if (containers < min) return null
  return { units: ingots + raw, ingots, raw, containers, seen }
}
/** Is the town below its reserve? -> true | false | null (unknown: the base). Pure. */
export const townIronLow = (stock, { on = TOWNIRON.on, reserve = TOWN_IRON_RESERVE } = {}) =>
  (!on || !stock ? null : stock.units < reserve)

// ---- the reader (one bot per process: skills.mjs installTownIron sets it from the bot's own town index) ----------------
let READER = null, MEMO = null
export function setTownIronReader (fn) { READER = typeof fn === 'function' ? fn : null; MEMO = null }
export const resetTownIronMemo = () => { MEMO = null }
/** The town's iron now -> stock | null (no reader, TOWNINDEX off, or unknown). */
export function townIronNow (now = Date.now()) {
  if (!READER || !TOWNINDEX.on) return null
  if (MEMO && now - MEMO.at < TOWN_IRON_MEMO_MS) return MEMO.stock
  let stock = null
  try { stock = READER(now) ?? null } catch { stock = null }
  MEMO = { at: now, stock }
  return stock
}
/** The consumers' one question -> true only when the switch is on and the town is KNOWN to be below the reserve. */
export const townIronLowNow = (now = Date.now()) => townIronLow(townIronNow(now)) === true

/** How much iron the bag carries (the rung's measure: raw + ingots). Pure over a { name: n } map or an items list. */
export function bagIron (items = []) {
  const list = Array.isArray(items) ? items : []
  return list.reduce((t, it) => t + (it?.name === 'raw_iron' || it?.name === 'iron_ingot' ? (Number(it.count) || 0) : 0), 0)
}
/** Is the town task done for this bag? -> bool. Pure: it carries TOWN_IRON_CARRY above its OWN keep -- the delivery's own
 *  calculation (deliverPlan / ironOwnKeep), so the round ends exactly where a delivery has a round to bank (Codex r2 P2). */
export const townTaskCarried = (items = []) => {
  const counts = {}
  for (const it of (Array.isArray(items) ? items : [])) if (it?.name) counts[it.name] = (counts[it.name] ?? 0) + (Number(it.count) || 0)
  return deliverPlan(counts).surplus >= TOWN_IRON_CARRY
}

// ---- THE DELIVERY (Codex r1 P1): the round's iron reaches the town chests ------------------------------------------------
/** The bag's OWN iron the deposit keeps: 3 units per iron craft not made yet (towndeposit.mjs ironUnitsNeeded, restated: that
 *  module's imports reach toolkit.mjs, which imports this one; towniron.test.mjs asserts the two agree). Pure. */
export function ironOwnKeep (counts = {}) {
  const missing = ['bucket', 'iron_pickaxe'].filter(n => !((Number(counts[n]) || 0) > 0)).length
  return Math.max(TOWN_IRON_SELF, TOWN_IRON_SELF * missing)
}
/**
 * WHAT A DELIVERY BANKS -> { iron_ingot: { deposit, own }, raw_iron: { deposit, own }, surplus }. Pure over a { name: n } map. The
 * own keep (ironOwnKeep) is ingots first, then raw iron -- the town deposit's order -- and everything above it goes, per NAME
 * (the town deposit moves whole stacks of a name or none: one stack of 19 raw iron would be kept whole, so the delivery uses
 * the deposit verb with the own count held back, ironsmelt-01's bank).
 */
export function deliverPlan (counts = {}) {
  const c = n => Math.max(0, Number(counts[n]) || 0)
  let keep = ironOwnKeep(counts)
  const ownIngot = Math.min(c('iron_ingot'), keep); keep -= ownIngot
  const ownRaw = Math.min(c('raw_iron'), keep)
  const out = { iron_ingot: { deposit: c('iron_ingot') - ownIngot, own: ownIngot }, raw_iron: { deposit: c('raw_iron') - ownRaw, own: ownRaw } }
  out.surplus = out.iron_ingot.deposit + out.raw_iron.deposit
  return out
}
export const DELIVER_COOLDOWN_MS = 10 * 60 * 1000
export const DELIVER_BACKOFF_MS = 30 * 60 * 1000
/** The town task's id, whatever lap or detour suffix (`#n`, `+prereq`) the controller adds. */
export const TOWN_TASK_ID = 'gather_iron_ore_town'
/** A town ROUND is recorded when the town task is the bot's active task (cognitive.mjs, every decision) -> new state. Pure. Only
 *  a recorded round's iron is town cargo (Codex r2 P2: a bag's own surplus is never delivered on a town it never mined for). */
export const noteTownRound = (state = {}, taskId = null) =>
  (String(taskId ?? '').split(/[#+]/)[0] === TOWN_TASK_ID && !state.round ? { ...state, round: true } : state)
/**
 * THE DELIVERY ORDER -> { order, state, skip }. Pure. At town, with the switch on, a bot with a RECORDED town round (state.round)
 * and any iron above its own keep delivers it, whatever the town's reading now (the iron was mined for it), and keeps retrying
 * the remainder (Codex r2 P1) until a delivery leaves none (deliverOutcome clears the round). Never a trip: the ladder's lap
 * (stockpile_stone, patrol, deposit_surplus, return) brings the bot home; this banks at home.
 */
export function deliverOrder ({ now = 0, on = TOWNIRON.on, atTown = false, counts = {}, state = {} } = {}) {
  const s = { ...state }
  if (!on) return { order: null, state: s, skip: 'off' }
  if (!s.round) return { order: null, state: s, skip: 'no_round' }
  if (!atTown) return { order: null, state: s, skip: 'away' }
  const p = deliverPlan(counts)
  // nothing above the keep: no order -- and the round STAYS (Codex r3 P1: at town before the mining, a cleared round left the
  // cargo mined next unrecorded); only a delivery that leaves none ends it (deliverOutcome)
  if (!(p.surplus > 0)) return { order: null, state: s, skip: 'none' }
  if (now - (s.lastIssuedAt ?? -Infinity) < DELIVER_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return { order: null, state: s, skip: 'cooldown' }
  s.lastIssuedAt = now
  return { order: { skill: 'deliver_iron', args: {}, why: `carrying ${p.surplus} iron above its own ${p.iron_ingot.own + p.raw_iron.own} for the town: bank it (town iron task)` }, state: s, skip: null }
}
/** After the delivery ran -> new state: a failure backs off; the round ends only when the run left NO surplus (`surplusLeft`
 *  0); anything else keeps it for the next town visit. Pure. */
export function deliverOutcome (status, now = 0, state = {}, { surplusLeft = null } = {}) {
  const s = status === 'failed' ? { ...state, backoffUntil: now + DELIVER_BACKOFF_MS } : { ...state }
  if (surplusLeft === 0) delete s.round
  return s
}
/** The `_deliver_iron` row. Pure. */
export const deliverRow = ({ stop = '-', ingot0 = 0, raw0 = 0, ingot1 = 0, raw1 = 0, depI = 0, depR = 0, keepI = 0, keepR = 0 } = {}) =>
  `stop=${stop} bag=${ingot0}/${raw0}>${ingot1}/${raw1} dep=${depI}/${depR} keep=${keepI}/${keepR}`

/** The `_towniron_mode` licence row (once per spawn): a kind the base cannot write. */
export const townIronModeDetail = (m = TOWNIRON) =>
  `phase=mode on=${m.on ? 1 : 0} mode=${m.mode} reserve=${TOWN_IRON_RESERVE} carry=${TOWN_IRON_CARRY} self=${TOWN_IRON_SELF} min_ctrs=${TOWN_IRON_MIN_CONTAINERS} obs_h=${TOWN_IRON_OBS_MS / 3600000} consumers=iron_task,shovel_tier${m.note ? ` note=${m.note.replace(/\s+/g, '_')}` : ''}`
/** The `_town_iron` change row: the reading, when this bot's view of the town flips (low <-> ok <-> unknown). Pure. */
export const townIronRow = (stock, low) =>
  `state=${low == null ? 'unknown' : low ? 'low' : 'ok'} units=${stock?.units ?? '-'} ingots=${stock?.ingots ?? '-'} raw=${stock?.raw ?? '-'} ctrs=${stock?.containers ?? '-'} seen=${stock?.seen ?? '-'} reserve=${TOWN_IRON_RESERVE}`
