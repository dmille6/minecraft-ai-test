// CLIMB FLOOD (climbflood-01, 2026-10-05): the refusal chain around the one flood check every upward dig asks.
//
// MEASURED (docs/reports/underground-safety-design-2026-10-05.md, 72 h, 80 bots): every one of 109 drownings was a
// sealed pocket, and the largest single way in -- 30 deaths, 28% of drownings, 16% of all deaths, 30/29/58 per day
// -- was the bot's own escape climb breaking the block over its head with no water check. The check itself is
// `overheadBreakRisk` (scaffold.mjs). This module holds what the reflex DOES with a refusal, as pure decisions the
// tests can drive, plus the two telemetry rows that make the guard readable on the fleet.
//
// THE CHAIN (design 4.1, Codex's second pass):
//   1. pillarOut / digStraightUp return FLOOD_RISK before anything is dug, and never fall through to the next dig;
//   2. the entombed and marooned handlers route FLOOD_RISK to its own branch: straight to the escape ramp, whose
//      every dig asks the same check (so it cannot re-breach the refused cell);
//   3. if the ramp gains nothing: one `climb_flood_refused` row per back-off, the existing escalating back-off,
//      NO prerequisite (neither blocks nor a pickaxe would help -- the bot usually holds both), and the row names
//      the move that is still legal from where the bot is: leave the cell sideways or downward, or wait;
//   4. the terminal state is "dry and entombed", not "flooded" -- measured on the fleet as stranded minutes.
import { logEvent } from './logger.mjs'
import { snapshot } from './state.mjs'
import { isWaterCell, isLavaCell } from './scaffold.mjs'

/** What pillarOut / digStraightUp return when the shared flood check refused the dig. */
export const FLOOD_RISK = 'flood_risk'

/** The move a refused bot can still make from where it is (design 4.1 step 5). */
export const FLOOD_REMEDY = 'leave this cell sideways or downward (mine or goto away from the water), or wait'

/**
 * WHICH BRANCH OF A HANDLER AN ESCAPE OUTCOME BELONGS TO.
 *
 * The entombed handler used to know only `needs_blocks` / `needs_pickaxe`; anything else fell to the failure
 * counter, and four of those ask the goal layer for a pickaxe the bot already holds (reflex.mjs, the
 * `escapeFailures >= ESCAPE_GIVE_UP_AFTER` arm). A flood refusal is neither: nothing was attempted, so nothing
 * failed, and no material fixes wet rock.
 *
 * @returns 'flood' | 'refusal' | 'preempted' | 'attempt'
 */
export function climbOutcomeRoute (outcome) {
  if (outcome === FLOOD_RISK) return 'flood'
  if (outcome === 'needs_blocks' || outcome === 'needs_pickaxe') return 'refusal'
  if (outcome === 'preempted') return 'preempted'
  return 'attempt'
}

/**
 * WHAT THE FLOOD BRANCH DOES AFTER THE RAMP HAS TRIED (pure).
 *
 * `refusals` is the lifetime count of flood refusals that gained nothing, INCLUDING this one when the ramp gained
 * nothing; it drives the same escalating back-off curve the material refusals use (`refusalEscalation`'s
 * `backoffMs`: refusals/4 minutes, capped at 10), so a bot pinned under a wet ceiling is retried less and less
 * often and never spins. A ramp that cut a step is progress: no row, no back-off, the counters reset.
 *
 * `prereq` is ALWAYS null. That is the point of the branch, and a test holds it there.
 */
export function floodChainStep ({ refusals = 1, stair = null, every = 4, capMs = 10 * 60_000 } = {}) {
  const progressed = !!stair && stair.steps > 0
  if (progressed) return { progressed: true, refused: false, backoffMs: 0, prereq: null, remedy: null }
  const n = Math.max(1, refusals)
  return {
    progressed: false,
    refused: true,
    backoffMs: Math.min((n / every) * 60_000, capMs),
    prereq: null,
    remedy: FLOOD_REMEDY,
  }
}

/** Both of the bot's own cells are water: the submerged exemption (water only) applies to its digs. */
export function submergedAt (bot) {
  try {
    const p = bot.entity.position
    return isWaterCell(bot.blockAt(p.offset(0, 0, 0))) && isWaterCell(bot.blockAt(p.offset(0, 1, 0)))
  } catch { return false }
}

const cellText = c => (c ? `${Math.floor(c.x)},${Math.floor(c.y)},${Math.floor(c.z)}` : '?')

/**
 * ONE ROW PER GUARD FIRING, at the dig site: which upward-dig path asked, what it would have broken, and why not.
 * The read's instrument (guard firings per 100 climb opportunities, by caller and reason).
 * callers: pillar_out | dig_straight_up | ramp_breach | ramp_step | shaft_ascend
 */
export function logFloodGuard (bot, { caller, reason, cell = null, submerged = false }) {
  try {
    logEvent({ kind: 'climb_flood_guard', status: 'failed',
               detail: `caller=${caller} cell=${cellText(cell)} submerged=${submerged ? 1 : 0} ` +
                       `y=${Math.round(bot.entity?.position?.y ?? 0)} reason=${reason}`,
               snapshot: snapshot(bot) })
  } catch { /* telemetry must never break an escape */ }
}

/**
 * DID AN UPWARD DIG LET LIQUID IN? Read the opened cell back ~1.6 s after the dig, without blocking the escape.
 *
 * The correctness line of the read is "0 upward digs into water or lava by the canary". A guard cannot report
 * the digs it failed to refuse, so this OBSERVES the outcome of every dig it allowed: water reaches an opened
 * cell in 5 ticks, lava in 30 (1.5 s), so 1.6 s sees either. A water breach by a submerged bot is the exemption
 * working as designed and is labelled, not counted.
 */
export function watchClimbDig (bot, { caller, cell, submerged = false, delayMs = 1600 }) {
  if (!cell) return
  const at = { x: cell.x, y: cell.y, z: cell.z }
  const t = setTimeout(() => {
    try {
      const b = bot.blockAt(cell)
      const lava = isLavaCell(b)
      const water = isWaterCell(b)
      if (!lava && !water) return
      logEvent({ kind: 'climb_flood_breach', status: 'failed',
                 detail: `caller=${caller} cell=${cellText(at)} liquid=${b.name} submerged=${submerged ? 1 : 0} ` +
                         `exempt=${water && !lava && submerged ? 1 : 0}`,
                 snapshot: snapshot(bot) })
    } catch { /* a disconnected bot has nothing to report */ }
  }, delayMs)
  t.unref?.()
}
