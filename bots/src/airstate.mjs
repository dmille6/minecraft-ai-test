// HOMEFIX-02 C3: A WATCHDOG RESCUE NEVER STARTS INTO, OR KEEPS RUNNING THROUGH, A DROWNING IN PROGRESS
// (docs/reports/homefix-02-design-2026-10-21.md §4 C3, r5).
//
// Death 1 (hive-d-Echo 10-20 20:19Z): the level-2 `home` rescue started with the bot under an ice sheet, found no path,
// and sat 52 s inside the drowning until `_reflex_stuck` cut it -- the base's one-shot `mayAct` interrupt latch had fired
// on an observe-only tick. C3 keys on a drowning IN PROGRESS -- head under, <= 5 s of air, health fallen within the last
// 3 s (airEmergency's healthFalling arm, air.mjs, with a 3-s window: a peaceful drowning loses 2-HP steps against
// regeneration) -- or the air-pocket / flooded-pocket rung running. Those end on their own (a peaceful drowning ends in
// breath or death in ~100 s; the rungs are budget-bounded), and a per-kind CAP makes it deterministic anyway (Codex r4
// P1: a rung can hang on an unbounded await, and a recurring non-lethal damage source can coincide with every verdict):
// after AIR_DECLINE_CAP consecutive declines of one rescue kind the next start is admitted, with no exemption from C3b.
// A bot merely wet, swimming, or chronically "submerged" at full health (seagrass heads; board-a-Comet, placebo-c-Bravo)
// never reads `danger`: its rescue runs.
import { LOW_SECONDS } from './air.mjs'

/** Published state older than this reads `danger` false (the reflex tick is 500 ms). */
export const AIR_STATE_FRESH_MS = 1500
/** Health must have fallen within this window. */
export const AIR_HEALTH_WINDOW_MS = 3000
/** Consecutive `air_rescue` declines of one rescue kind after which the next start is admitted. */
export const AIR_DECLINE_CAP = 2

/** Is this tick a drowning in progress? Pure. */
export function airDanger ({ headUnder = false, airSeconds = Infinity, healthFell = false } = {}) {
  return headUnder === true && Number(airSeconds) <= LOW_SECONDS && healthFell === true
}

/** Did health fall within the window? `samples` = [{t, h}] oldest first: the newest is below the window's max. Pure. */
export function healthFellWithin (samples = [], now = Date.now(), windowMs = AIR_HEALTH_WINDOW_MS) {
  const recent = samples.filter(s => now - s.t <= windowMs && Number.isFinite(s.h))
  if (recent.length < 2) return false
  const last = recent[recent.length - 1].h
  return last < Math.max(...recent.map(s => s.h))
}

/**
 * THE WATCHDOG'S ADMISSION (runner `admit`), read at the instant the rescue would start. Pure.
 * `declines` = consecutive `air_rescue` declines of this rescue kind so far.
 * -> { refuse, failClass, detail, fields } -- `fields` go on the `started` or `declined:air_rescue` row either way.
 */
export function airAdmission (state, now = Date.now(), { declines = 0, cap = AIR_DECLINE_CAP } = {}) {
  const fresh = !!state && Number.isFinite(state.at) && now - state.at <= AIR_STATE_FRESH_MS
  const danger = fresh && state.danger === true
  const pocketing = !!state && state.pocketing === true          // held by the rung's own flag, not by freshness
  const capped = (danger || pocketing) && declines >= cap
  const fields = { air_danger: danger ? 1 : 0, air_pocketing: pocketing ? 1 : 0, air_capped: capped ? 1 : 0,
                   air_declines: declines,
                   air_seconds: fresh && Number.isFinite(state.airSeconds) ? Math.round(state.airSeconds * 10) / 10 : -1 }
  if ((!danger && !pocketing) || capped) return { refuse: false, failClass: null, detail: null, fields }
  return { refuse: true, failClass: 'air_rescue', fields,
           detail: pocketing ? 'the air reflex is digging or pumping a breathing pocket; the rescue did not start'
                             : `a drowning is in progress (${fields.air_seconds} s of air, health falling); the air reflex owns the body` }
}

/** The per-kind decline counter after one rescue's outcome. Pure: +1 on an air_rescue decline, 0 on a start. */
export function airDeclineNext (declines = 0, { started = false, failClass = null } = {}) {
  if (started) return 0
  if (failClass === 'air_rescue') return declines + 1
  return declines
}

/** C3b: should the reflex interrupt this run now? Only a watchdog-owned run, only on a `danger` tick. Pure. */
export function airYieldsRun ({ danger = false, owner = null } = {}) {
  return danger === true && owner === 'watchdog'
}
