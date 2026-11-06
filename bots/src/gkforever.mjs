// GKFOREVER-01: THE GROUNDS NEVER RUN OUT (owner 11-06 ~04:00Z: "there should always be projects the bots can work on, at the very
// least they can be greens keepers and clean up the town then branch out and clean up the area outside the town"; 04:30Z: "the area
// inside the town walls beautiful, clean, no holes, pits or unlevel ground ... outside the town walls when the town is clean they
// can clean up the country side the same way"). Design docs/reports/gkforever-design-2026-11-06.md (Claude + Codex reconciled).
// PURE: the switches, the perpetual clock, the dead-cell carry, the crew and the idle batch's rules. skills.mjs (buildTidy,
// shopActive, recordDamaged), shop.mjs (the tidy's builders, the order cooldown), tidy.mjs (the interior levelling) and
// milestones.mjs / idlework.mjs (the `grounds` batch) wire them.
//
// MEASURED (fleet 4f3b0f5c, 24 h full walk 11-05 04:10Z..11-06 04:10Z, 1,514,167 rows, 80 bots): all building 54.9 of 1,920
// bot-h; the tidy 1,099 visits / 3.0 bot-h / 363 placed, in 4 of 16 towns, 969 of the 1,099 on two dead cells. Tidy records:
// COMPLETE in 9 towns (1-82 h ago, re-surveyed only after 48 h), open in 2 (both dead cells), none in 5 (an unsited first project
// held the order: idlework-01 B). hourwatch 03:57Z: 81% of bot time on the idle lap, 10 of 16 towns with no workable project.
// groundskeeper-01 (ported under this) adds the outward stages, but its last stage completes too (48 h) and ONE keeper a town is
// the tidy's only builder.
//
// WHAT THIS CHANGES (each part its own switch; GKFOREVER=0 = groundskeeper-01 exactly):
//   CLOCK  (GKF_CLOCK)  a completed stage is never the end. The stage after it is due at once, but the INTERIOR (stage 0) is audited
//                       first whenever its last audit is GKF.interiorMs old; after the LAST band (out to GKF.radius, 128) the whole
//                       ring order is due again GKF.cycleMs after it completed (not 48 h). A survey that finds nothing anywhere is a
//                       `nothing` record due on the same clock.
//   DEAD   (GKF_DEAD)   a cell the record WAIVED (no stand reached it on the waiver's visits) is carried into every later generation
//                       for GKF.deadMs and never listed again, so a re-survey cannot re-open the dead cell it gave up on (Codex:
//                       "resurveying must not reset failure history"); after GKF.deadMs it is tried once more.
//   LEVEL  (GKF_LEVEL)  inside the walls (stage 0) the ground is LEVEL, not only free of pillars and pits: a lone step of the bots'
//                       material one block above all 8 neighbours is cut, and a one-deep hole (a column below all 8 neighbours) is
//                       filled to its lowest neighbour. Terraces stay: a terrace edge has neighbours at its own level.
//   CREW   (GKF_CREW)   the keeper works the grounds first, as before, and up to GKF.crew - 1 more bots a town may work them as
//                       HELPERS (the tidy's builders: the slot is the admission), never ahead of an open project.
//   IDLE   (GKF_IDLE)   idle_work asks for a `grounds` batch (GKF.batchVisits visits that changed the ground, or GKF.batchMs) in
//                       alternate laps when the town's grounds have work and a slot; a lap that finds no grounds work bars the kind
//                       GKF.barMs and gathers instead (iron / logs / coal, the scout lap one in eight).

import { GROUNDS_BATCH } from './idlework.mjs'

export const GKF = Object.freeze({
  interiorMs: 30 * 60_000,      // the town square's audit (Codex: interior 30 min)
  cycleMs: 30 * 60_000,         // after the last band: the ring order again (was TIDY_RESURVEY_MS 48 h)
  radius: 128,                  // the outermost band (groundskeeper-01: 80)
  deadMs: 24 * 60 * 60_000,     // a waived cell is not listed again for this long (Codex: one diagnostic retry after 24 h)
  crew: 2,                      // the tidy's builders: the keeper and one helper (Codex: min(2, ceil(idle/3)) of a 5-bot town)
  batchVisits: GROUNDS_BATCH.visits,   // a grounds batch: this many of the bot's visits that changed the ground ...
  batchMs: GROUNDS_BATCH.ms,           // ... or this long since it opened (idlework.mjs GROUNDS_BATCH: the rung's own numbers)
  barMs: 30 * 60_000,           // a grounds lap that found no work bars the kind this long
})
export const GKF_PARTS = Object.freeze(['clock', 'dead', 'level', 'crew', 'idle'])
/** THE SWITCHES -> bool. GKFOREVER=0|off: every part off; else GKF_<PART>=0|off turns that part off; default on. Pure. */
export function gkfOn (part, env = process.env) {
  const off = v => ['0', 'off', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
  if (off(env?.GKFOREVER)) return false
  if (part == null) return true
  return !off(env?.[`GKF_${String(part).toUpperCase()}`])
}

/** The land plan's stage table out to GKF.radius (landplan.mjs LAND with a wider workR: more 16-block bands). Pure. */
export const gkfLand = (L, radius = GKF.radius) => (Number.isFinite(radius) && radius > (L?.workR ?? 0) ? { ...L, workR: radius } : L)

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null)
/**
 * THE PERPETUAL CLOCK -> { due, from, why }. Pure. Is a tidy record due a new generation now, and from which stage does the survey
 * start (the survey walks forward from `from` to the first stage with work)?
 *   rec         the tidy record (any stage; a `nothing` record too)
 *   lastK       the last stage's number (landStages(...).at(-1).k; 0 with no land plan)
 *   interiorAt  ms of the last stage-0 siting (rec.gkf.interiorAt; absent = never: the interior is audited first)
 * Not complete, or a completion in the future (a bad clock) -> not due. A completed stage before the last -> due at once, from 0 when
 * the interior's audit is GKF.interiorMs old, else from the next stage. The last stage (or past it) -> due GKF.cycleMs after its
 * completion, from 0.
 */
export function gkfDue (rec, { now = Date.now(), lastK = 0, interiorAt = null, G = GKF } = {}) {
  if (!rec || rec.structure_complete !== true) return { due: false, from: null, why: 'open' }
  const ca = num(rec.completeAt)
  if (ca == null || ca > now + 60_000) return { due: false, from: null, why: 'no_clock' }
  const k = num(rec.stage) ?? 0
  const ia = num(interiorAt)
  const interiorStale = ia == null || ia > now + 60_000 || now - ia >= G.interiorMs
  if (k < lastK) return { due: true, from: interiorStale ? 0 : k + 1, why: interiorStale ? 'interior_audit' : 'next_band' }
  if (now - ca >= G.cycleMs) return { due: true, from: 0, why: 'cycle' }
  return { due: false, from: null, why: 'cycle_wait' }
}

/**
 * THE DEAD-CELL CARRY -> { "x,y,z": { why, at } }. Pure. The previous generation's carried cells and its waived cells (each with
 * the time it was given up), kept while younger than GKF.deadMs at `now`; a stamp in the future (a bad clock) is kept as now.
 */
export function gkfDeadCarry (prev, { now = Date.now(), G = GKF } = {}) {
  const out = {}
  const add = (k, v) => {
    if (typeof k !== 'string' || !/^-?\d+,-?\d+,-?\d+$/.test(k)) return
    let at = num(v?.at)
    if (at == null) return
    if (at > now) at = now
    if (now - at >= G.deadMs) return
    if (!out[k] || out[k].at < at) out[k] = { why: String(v?.why ?? 'waived').slice(0, 40), at }
  }
  for (const [k, v] of Object.entries(prev?.gkfDead ?? {})) add(k, v)
  for (const [k, v] of Object.entries(prev?.waived ?? {})) add(k, v)
  return out
}
/** A survey's lists without the dead cells -> { fill, cut, clear, dropped }. Pure. `dead` is gkfDeadCarry's map. */
export function gkfDropDead ({ fill = [], cut = [], clear = [] } = {}, dead = {}) {
  const isDead = c => Object.prototype.hasOwnProperty.call(dead, (c?.at ?? []).join(','))
  const f = fill.filter(c => !isDead(c)), cu = cut.filter(c => !isDead(c)), cl = clear.filter(c => !isDead(c))
  return { fill: f, cut: cu, clear: cl, dropped: fill.length - f.length + cut.length - cu.length + clear.length - cl.length }
}

/** The tidy's builders (shop.mjs PROJECTS): the keeper alone (groundskeeper-01), or the crew. Pure. */
export const gkfBuilders = (crewOn, G = GKF) => (crewOn ? Math.max(1, G.crew) : 1)

/**
 * IS THIS VISIT'S RESULT GROUNDS WORK DONE? -> bool. Pure. A visit that placed, cleared or cut anything changed the ground (the
 * batch counts it); `cut` is the cuts that came down this visit.
 */
export const gkfVisitWorked = ({ placed = 0, cleared = 0, cut = 0 } = {}) => (Number(placed) || 0) + (Number(cleared) || 0) + (Number(cut) || 0) > 0
/** The stops that say the grounds have no work for this bot now (the batch bars the kind and gathers). Pure. */
export const GKF_NO_WORK = Object.freeze(new Set(['complete', 'slots_full', 'keeper_held', 'keeper_rest', 'no_site', 'land_unplanned', 'off', 'no_plan', 'zones_unknown', 'stuck_on_cell', 'site_unread', 'record_unreadable']))
export const gkfNoWork = stop => GKF_NO_WORK.has(String(stop ?? ''))

/**
 * THE GROUNDS BATCH'S MEANS -> bool. Pure. A bot may take a grounds lap when the part is on, the town's grounds have work (an open
 * record, or one due now), a builder slot is free for it, and its last grounds lap did not find "no work" within GKF.barMs.
 */
export function gkfMeans ({ on = true, work = false, slotFree = true, noWorkAt = null, now = Date.now(), G = GKF } = {}) {
  if (!on || !work || !slotFree) return false
  const t = num(noWorkAt)
  return !(t != null && t <= now + 60_000 && now - t < G.barMs)
}
/** Is a grounds batch met? Pure. `gained` visits that changed the ground >= GKF.batchVisits, or GKF.batchMs since it opened. */
export const gkfBatchMet = ({ gained = 0, at = null } = {}, now = Date.now(), G = GKF) =>
  (Number(gained) || 0) >= G.batchVisits || (num(at) != null && now - num(at) >= G.batchMs)
