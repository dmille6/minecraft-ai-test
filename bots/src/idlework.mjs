// IDLEWORK-01: A BOT WITH NOTHING TO BUILD DOES A BATCH OF PRODUCTIVE WORK, NOT AN 80-BLOCK WALK (design
// docs/reports/idlework-design-2026-11-06.md). Pure: the needs table, the lap's pick, the batch's gain counter. milestones.mjs
// wires it into SUSTAINING as the `idle_work` rung, in place of `patrol`.
//
// MEASURED (fleet, 11-05 01Z..11-06 01Z, 80/80 bots, 1,906 bot-h of decision time): once dirtrung-01 stopped the dirt rung
// re-opening every lap, every rung before `patrol` was already met for most bots, so the sustaining lap became
// patrol -> deposit_surplus (vacuous 80 blocks out) -> return -> re-enter: patrol 963 bot-h, return 474, deposit_surplus 116,
// idle 57 = 1,610 of 1,906 (84%; 11-04: 1,072 of 1,878, 57%). Explore 138 -> 372 skill-h, gather 255 -> 44; value per bot-h
// 16.14 -> 9.90. A live prompt (board-a-Alpha, patrol#3506): explore 75 -> return home -> Nothing to do -> explore 76 ...
//
// THE RUNG: on each lap it asks for ONE bounded batch -- GAINED since the rung opened, never "hold N" (a bag that already holds
// N would pass at once and the lap would be the walk again) -- of a material the bot can use or the town banks:
//   iron  6 raw_iron/iron_ingot (8.0 in valuescore; iron pickaxes wear out ~440 a day), with a stone-or-better pickaxe that can
//         pay a trip (oretunnel.mjs hasTripPickaxe)
//   logs  16 logs of any kind (the town banks them up to 4,000 a type, stocktarget.mjs TOWN_WOOD_TARGET)
//   coal  8 coal (the bot's and the town's furnace fuel), with any usable pickaxe
//   scout the old patrol (80 blocks out), one lap in eight: the deposit sightings the frontier reads come from walking
// NEVER COBBLE: every town is at its 1,000 cap (38% of new cobble went down the junk well) -- a batch the bank refuses is not work.
//
// A KIND THAT FAILS IS BARRED, NOT THE RUNG (a refusal must name a remedy the bot can perform): the controller's own skip
// (45 min without serving progress, 25 serving failures, 3 h residence) bars that KIND for IDLE_BAR_MS and the next lap picks
// the next kind; the rung's id is never put on the controller's skip list. All kinds barred or without means -> `scout`
// (the old patrol rule, so the lap is never worse than today); scout barred too -> `none`: vacuously done and not re-opening,
// so the chain cannot spin.
//
// IDLEWORK=0 is the rollback: the rung is vacuously done, never re-opens, and `patrol` is exactly as before.

export const idleWorkOn = (env = process.env) => String(env?.IDLEWORK ?? '1').trim() !== '0'

export const LOG_NAMES = Object.freeze(['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
  'mangrove_log', 'cherry_log', 'pale_oak_log'])
/** The needs, each { kind, count: names counted, n: the batch, wants, wantsAny, label, hint }. */
export const IDLE_NEEDS = Object.freeze({
  iron: Object.freeze({ kind: 'iron', count: ['raw_iron', 'iron_ingot'], n: 6, wants: 'iron_ore',
    wantsAny: ['iron_ore', 'deepslate_iron_ore', 'raw_iron'], label: 'iron ore',
    describe: 'Mine 6 iron ore for tools (raw_iron; an iron pickaxe costs 3, and the fleet wears out hundreds a day).',
    hint: 'gather with block=iron_ore (or deepslate_iron_ore) when you see it; if none is in sight, mine down to y=16 and look again.' }),
  logs: Object.freeze({ kind: 'logs', count: LOG_NAMES, n: 16, wants: 'oak_log', wantsAny: [...LOG_NAMES], label: 'logs',
    describe: 'Cut 16 logs (any kind) for the town store and its builds.',
    hint: 'gather with block=oak_log, or any other _log you can see.' }),
  coal: Object.freeze({ kind: 'coal', count: ['coal'], n: 8, wants: 'coal_ore', wantsAny: ['coal_ore', 'deepslate_coal_ore', 'coal'],
    label: 'coal', describe: 'Mine 8 coal: fuel for smelting iron and stone.',
    hint: 'gather with block=coal_ore; it shows on cliffs and in caves near the surface.' }),
})
export const IDLE_KINDS = Object.freeze(Object.keys(IDLE_NEEDS))
/** One lap in eight is a scouting lap; the rest are work. Rotated by the chain's cycle so the kinds spread across bots. */
export const IDLE_ROTATION = Object.freeze(['iron', 'logs', 'iron', 'coal', 'logs', 'iron', 'coal', 'scout'])
export const IDLE_BAR_MS = 3 * 3600_000   // longer than three 45-min deadlines: kinds failing in turn reach the scout lap
export const SCOUT_DIST = 80

/**
 * THE LAP'S KIND -> 'iron' | 'logs' | 'coal' | 'scout' | 'none'. Pure. From the rotation slot `cycle` mod its length, the first
 * kind (walking the rotation forward) that has its means and is not barred at `now`; none of the work kinds -> 'scout' unless
 * scout is barred -> 'none'.
 *   means   { iron, logs, coal } booleans (absent = false)
 *   barred  Map kind -> until ms
 */
export function idlePick (cycle, { means = {}, barred = new Map(), now = Date.now(), rotation = IDLE_ROTATION } = {}) {
  const L = rotation.length
  const c = Number.isFinite(cycle) && cycle >= 0 ? Math.floor(cycle) : 0
  const isBarred = k => { const u = barred?.get?.(k); return Number.isFinite(u) && now < u }
  for (let i = 0; i < L; i++) {
    const k = rotation[(c + i) % L]
    if (k === 'scout') { if (!isBarred('scout') && i === 0) return 'scout'; continue }
    if (means[k] && !isBarred(k)) return k
  }
  return isBarred('scout') ? 'none' : 'scout'
}

/** How many of `names` a { name: n } count map holds. Pure. */
export const countOf = (counts = {}, names = []) => names.reduce((t, n) => t + (Number(counts?.[n]) || 0), 0)

/**
 * THE BATCH COUNTER -> the new state { cycle, kind, last, gained }. Pure. A new `cycle` (or no state) opens a batch at the bag's
 * count now (`gained` 0); after that only RISES count (a deposit, a craft or the pathfinder's scaffold spending the bag never
 * takes back what was gathered). `kind` is fixed when the batch opens.
 */
export function idleStep (state, cycle, kind, count) {
  const n = Number.isFinite(count) ? count : 0
  if (!state || state.cycle !== cycle) return { cycle, kind, last: n, gained: 0 }
  return { ...state, last: n, gained: state.gained + Math.max(0, n - state.last) }
}

/** Is the open batch met? Pure. scout: distance from home > SCOUT_DIST; none: always; a work kind: gained >= its n. */
export function idleMet (state, { dist = 0 } = {}) {
  if (!state) return false
  if (state.kind === 'none') return true
  if (state.kind === 'scout') return dist > SCOUT_DIST
  return state.gained >= (IDLE_NEEDS[state.kind]?.n ?? Infinity)
}

/** A skip of the rung bars its kind (never 'none'): -> the new barred map. Pure. */
export function idleBar (barred = new Map(), kind, now = Date.now(), ms = IDLE_BAR_MS) {
  const out = new Map(barred)
  if (kind && kind !== 'none') out.set(kind, now + ms)
  return out
}
