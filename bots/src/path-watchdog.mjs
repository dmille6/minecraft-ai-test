// IS THE PATHFINDER WEDGED WITH A GOAL IT WILL NEVER REACH?
//
// mineflayer-pathfinder 2.4.5, index.js ~465:
//
//     if (path.length === 0) {
//       ...
//       } else if (!pathUpdated) {
//         const results = bot.pathfinder.getPathTo(stateMovements, stateGoal)
//         path = results.path
//         pathUpdated = true            // <-- latch
//       }
//     }
//     if (path.length === 0) { return }
//
// `pathUpdated` is reset ONLY inside resetPath(), which runs on a goal change.
// So when the recomputed path also comes back empty, the bot sits with
// stateGoal set, path empty, returning from every tick, forever. Upstream
// issue #273 records that this state emits NO events at all -- no error, no
// goal_reached, no path_update, no path_reset -- which is exactly why our
// telemetry cannot see it and why this check is position-based rather than
// event-based.
//
// Measured alongside it: goto succeeds ~34% of 943 attempts and _path_reset runs
// at ~95 per bot-hour. This file's own comment already records the workaround
// someone found the hard way: "cannot reach its next node never stops --
// setGoal(null) is what actually stops it".
//
// THE DETECTION IS CHEAP because isMoving() is literally `path.length > 0`, so
// the wedged state is visible from the public API without forking anything.
//
// THE FALSE POSITIVE TO AVOID is a bot that is legitimately standing still.
// The pathfinder holds position while digging, placing, equipping, and during a
// search that has only just started -- so mining and building are excluded, and
// a bot must be motionless for a sustained window rather than a single sample.

/**
 * Wedged = holds a goal, has no path, NOBODY IS WORKING, and has not moved.
 *
 * MEASURED CORRECTION, 2026-08-23. The first version excluded only
 * pathfinder.isMining() and isBuilding(), and it was too narrow: those are
 * PATHFINDER-INTERNAL states, set while the pathfinder itself digs or places as
 * part of executing a path. The `mine` and `gather` skills dig with bot.dig()
 * directly, outside the pathfinder, so both flags stay false -- and the watchdog
 * cleared their goal mid-work.
 *
 * Live result over 328 firings: 31% happened while a work skill was active, and
 * `_path_reset` rose from 82.3 to 108.9 per bot-hour while goto success FELL from
 * 47.2% to 41.8%. That was the exact failure this was tested for, and the test
 * could not see it because it only knew about the pathfinder's own flags.
 *
 * `busy` is the runner's answer -- does any skill own this bot right now -- and it
 * is the correct question. A goal wedged underneath a running skill is cleaned up
 * by that skill's own timeout; the case only this watchdog can fix is a goal left
 * set with nothing running, which was 58% of firings.
 *
 * EXCEPT WHEN THAT TIMEOUT HAS ALREADY FAILED, 2026-08-25. board-d-Alpha held a
 * `gather` for 83 minutes against a 3-minute timeout: the abort fired on time
 * and the skill never returned, so `busy` stayed true forever and this watchdog
 * -- the only other thing that could have looked -- declined to, on the strength
 * of the sentence above. Two nets, both bypassed, for the same bot.
 *
 * So the exemption now ends where its own justification does. Past the skill's
 * timeout, "its own timeout will handle it" is a statement the evidence has
 * already refuted, and the watchdog is allowed to act.
 *
 * The floor also rises. Half of all firings came in at the 6s minimum, which is
 * short enough to catch an ordinary pause.
 */
export function pathfinderWedged({ hasGoal, moving, mining, building, busy,
                                   stillFor = 0, stillThresholdMs = 15000,
                                   skillElapsedMs = 0, skillTimeoutMs = 0 }) {
  if (!hasGoal) return false
  if (moving) return false          // isMoving() === path.length > 0
  if (mining || building) return false   // pathfinder is digging/placing for a path
  // A skill owns the bot -- unless it is already past its own timeout, in which
  // case the mechanism this exemption defers to has demonstrably not worked.
  if (busy && !(skillTimeoutMs > 0 && skillElapsedMs >= skillTimeoutMs)) return false
  return stillFor >= stillThresholdMs
}

/**
 * How long has the bot been effectively motionless?
 *
 * 3D, and that is deliberate. A horizontal-only test calls a bot that is
 * pillaring or mining downward "stuck" -- the same mistake that nearly made me
 * exclude a working bot from the exposure denominator, caught only because a
 * control bot in that check had moved 6 blocks vertically and zero horizontally.
 */
export function stillnessMs(samples, now, moveThreshold = 1.0) {
  if (!samples || samples.length < 2) return 0
  let since = now
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i]
    const last = samples[samples.length - 1]
    const d = Math.hypot(s.x - last.x, s.y - last.y, s.z - last.z)
    if (d >= moveThreshold) break
    since = s.t
  }
  return now - since
}
