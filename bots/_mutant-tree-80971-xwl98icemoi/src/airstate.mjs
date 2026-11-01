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
import { LOW_SECONDS, makeAirClock, headBlock, breathable } from './air.mjs'

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

/**
 * THE AIR STATE PUBLISHER (reflex.mjs calls the returned `publish()` FIRST in every reflex tick, before the
 * inventoryUnsettled release await and every early return -- Claude r2 P2 / r4 P3-4, Codex r2 P4).
 *   - `bot.airRescue` = { danger, pocketing (a LIVE getter over the rungs' own flags: a rung that starts between ticks is
 *     seen by the very next admission -- Codex code r1 P1-1), airSeconds, headUnder, at }
 *   - its air clock is a SEPARATE publication clock; the rescue's own airClock (updated only while `air.losing`) is
 *     untouched, so the rescue behaves exactly as before
 *   - C3b, LEVEL-TRIGGERED: on every `danger` tick a WATCHDOG-owned current run is interrupted ('drowning'); the
 *     interrupt is ISSUED before the sampled `_air_danger` row, which records the result (read G5d'); one
 *     `_air_rescue_yield` per run (read G5d). Brain-started runs are not touched (F5 in the design).
 * `log(event)` writes a row (the caller adds the snapshot).
 */
export function makeAirPublisher ({ bot, runner, isPocketing = () => false, log = () => {}, now = () => Date.now(),
                                    clock = makeAirClock(), dangerRowMs = 2000 } = {}) {
  const health = []          // [{t, h}] over the last AIR_HEALTH_WINDOW_MS
  let yieldLoggedFor = null  // the runner `current` whose interrupt has been logged
  let dangerRowAt = -Infinity
  return function publish () {
    const t = now()
    const hb = headBlock(bot)
    const headUnder = hb != null && !breathable(hb)
    const airSeconds = clock.update(bot, t)
    const h = bot?.health ?? null
    if (h != null) health.push({ t, h })
    while (health.length && t - health[0].t > AIR_HEALTH_WINDOW_MS) health.shift()
    const danger = airDanger({ headUnder, airSeconds, healthFell: healthFellWithin(health, t) })
    bot.airRescue = { danger, get pocketing () { return isPocketing() === true }, airSeconds, headUnder, at: t }
    const cur = runner?.current ?? null
    const yields = !!cur && airYieldsRun({ danger, owner: cur.owner })
    // a run something else already interrupted (air_pocket, stuck, a hard stop) keeps ITS reason: the interrupt is not
    // re-issued and the reason is not overwritten (Claude code r1 P3-3); it counts as issued -- the run is ending
    const issued = yields ? (runner.isInterrupted?.() === true || runner.interrupt('drowning') === true) : false
    if (danger && cur?.owner === 'watchdog' && t - dangerRowAt >= dangerRowMs) {
      dangerRowAt = t
      log({ kind: 'air_danger', status: 'no_effect', detail: `a drowning in progress while the watchdog's ${cur.skill} runs`,
            args: { attempt: String(cur.rescue?.attempt ?? ''), owner: 'watchdog', head_under: headUnder ? 1 : 0,
                    air_seconds: Math.round(airSeconds * 10) / 10, health: h,
                    health_3s_max: Math.max(...health.map(s => s.h)), interrupt_issued: issued ? 1 : 0 } })
    }
    if (yields && yieldLoggedFor !== cur) {
      yieldLoggedFor = cur
      log({ kind: 'air_rescue_yield', status: 'success',
            detail: `a drowning in progress (${airSeconds.toFixed(1)} s air, health ${h}): the watchdog's ${cur.skill} is interrupted`,
            args: { attempt: String(cur.rescue?.attempt ?? ''), skill: String(cur.skill), air_seconds: Math.round(airSeconds * 10) / 10, health: h } })
    }
    return { danger, issued }
  }
}
