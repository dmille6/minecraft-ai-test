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

/** Wedged = holds a goal, has no path, is not working, and has not moved. */
export function pathfinderWedged({ hasGoal, moving, mining, building,
                                   stillFor = 0, stillThresholdMs = 6000 }) {
  if (!hasGoal) return false
  if (moving) return false          // isMoving() === path.length > 0
  if (mining || building) return false   // legitimately stationary
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
