// THE WATCHDOG RESCUE'S ATTEMPT ROW (homefix-01, docs/reports/expansion-plan-2026-10-19.md §2 "The H2 fix", item 8).
//
// One `_watchdog_rescue` row per phase of one attempt, its fields in skill.args (flattened in the mcai-skill mapping; no
// new top-level field): { attempt, level, remedy, phase, ... }. Phases: `requested` (the watchdog, at the verdict) ->
// `started` (the RUNNER, when the owner's skill begins -- so the watchdog never grades itself) | `declined:<class>` (the
// runner) -> a TERMINAL phase: `completed:<status>` / `interrupted:<reason>` (the runner), or `reconnected` (the
// watchdog, written BEFORE bot.quit). `tick_seen`: the first watchdog tick that landed while the started rescue ran.
// homefixread.py reconciles each attempt id: a `requested` with no terminal phase is a G4 defect.
import { logEvent } from './logger.mjs'
import { snapshot } from './state.mjs'

export const RESCUE_TERMINAL = /^(completed|interrupted|declined):|^reconnected$/

/** Is this phase terminal? Pure. */
export const rescueTerminal = phase => RESCUE_TERMINAL.test(String(phase ?? ''))

export function logRescueRow (bot, rescue, phase, extra = {}) {
  if (!rescue) return null
  const ok = phase === 'reconnected' || phase === 'completed:success'
  try {
    return logEvent({ kind: 'watchdog_rescue', status: ok ? 'success' : rescueTerminal(phase) ? 'failed' : 'no_effect',
                      detail: `attempt ${rescue.attempt} level ${rescue.level} ${rescue.remedy}: ${phase}`,
                      args: { attempt: String(rescue.attempt), level: Number(rescue.level), remedy: String(rescue.remedy), phase, ...extra },
                      snapshot: snapshot(bot) })
  } catch { return null }   // a log row must never break the runner or the watchdog
}
