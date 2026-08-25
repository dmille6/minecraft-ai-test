// ABORT HAS TO BE ENFORCEABLE, NOT ADVISORY.
//
// board-d-Alpha, 2026-08-25:
//
//     10:41:04  LLM -> gather {"block":"oak_log","count":12,"player":"<corrupt>"}
//     10:44:04  WARN  watchdog fired  skill=gather  ms=180000
//               ... no completion line, no further decisions
//     12:04     still emitting path_reset:"stuck" 17x/min, 83 minutes later
//
// The runner's watchdog fired exactly on time and called controller.abort().
// `gather` never returned. It ran 27x past its own timeout, awaiting a
// pathfinder goal that mineflayer kept resetting with reason "stuck", never
// reaching a line that checks the signal.
//
// Because runner.run() was still awaiting the skill, `this.current` never
// cleared, isBusy() stayed true, and the cognitive loop could not issue another
// decision for the rest of the bot's life. Every health signal said fine:
// systemd active, telemetry flowing at 1,026 events/hour, liveness satisfied.
// A permanently dead bot that looks perfectly healthy.
//
// THE SECOND NET WAS ALSO BLIND, and by my own hand. path-watchdog.mjs reads
//
//     if (busy) return false   // a SKILL owns the bot
//
// with the comment "a goal wedged underneath a running skill is cleaned up by
// that skill's own timeout". That assumption is precisely what failed here. The
// guard is right in general -- removing it dropped goto success from 47.2% to
// 41.8% -- so it stays, and gains an exception for a skill that is ALREADY past
// its own timeout, which is the only case where the assumption is known false.
//
// So: co-operative abort first, because a skill that unwinds cleanly releases
// its own resources. Then, after a grace period, the runner stops waiting.

/** How long a skill gets to honour abort before the runner stops waiting.
 *
 * Overridable so the test suite can exercise the real path in under a second
 * instead of thirty. A test that takes half a minute is a test people start
 * skipping.
 */
export const HARD_STOP_GRACE_MS = Number(process.env.SKILL_HARD_STOP_GRACE_MS || 30_000)

/**
 * Should the runner stop waiting on this skill?
 *
 * Deliberately a pure function of elapsed time and the two deadlines, so the
 * rule can be tested without a bot, a pathfinder or a wedged promise.
 */
export function shouldHardStop ({ elapsedMs, timeoutMs, graceMs = HARD_STOP_GRACE_MS }) {
  if (!(timeoutMs > 0)) return false
  return elapsedMs >= timeoutMs + graceMs
}

/**
 * May the path watchdog act even though a skill owns the bot?
 *
 * Only when that skill is already past its own timeout. Before that the skill's
 * own abort is the right mechanism and interfering with it is the regression
 * this guard was added to prevent.
 */
export function watchdogMayOverrideBusy ({ busy, skillElapsedMs, timeoutMs }) {
  if (!busy) return true
  if (!(timeoutMs > 0)) return false
  return skillElapsedMs >= timeoutMs
}

/**
 * The result a hard-stopped skill reports.
 *
 * A DISTINCT failClass, because this is not an ordinary timeout: an ordinary
 * timeout is a skill that gave up when asked. This is a skill that would not,
 * and the two need to be countable apart or the fix cannot be measured.
 */
export function hardStopResult (skillName, elapsedMs) {
  return {
    status: 'failed',
    failClass: 'abort_ignored',
    detail: `${skillName} did not return ${Math.round(elapsedMs / 1000)}s after its abort; ` +
            `the runner released the bot rather than hold it forever`,
    hardStopped: true,
  }
}
