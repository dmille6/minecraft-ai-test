// STOP THE PATHFINDER WITHOUT POISONING THE NEXT WALK.
//
// mineflayer-pathfinder 2.4.5: `stop()` only sets a flag (index.js:162-164). The flag is consumed by resetPath() --
// i.e. by the next setGoal() -- or when the bot reaches a path node (index.js:139, 582). So `setGoal(null)` FOLLOWED
// by `stop()` (the order withTimeout used) resets while the flag is still clear, then sets it with no path left to
// clear it: the NEXT goto's setGoal finds it, stops, emits path_stop, and goto rejects PathStopped at once -- a walk
// that was never tried. Measured 2026-09-29 (Claude analysis, 6 h, 80 bots): at least 1,261 of 13,275 retired pickup
// drops failed in under 0.2 s straight after another failure, the signature of this; and the stuck reflex stops a bot
// that by definition is not reaching nodes, then calls unstick(), whose own walk inherits the flag.
//
// stop() THEN setGoal(null): the reset consumes the flag in the same call, whatever the path state. Pure w.r.t. us.
export function haltPath (bot) {
  try { bot?.pathfinder?.stop() } catch { /* not connected */ }
  try { bot?.pathfinder?.setGoal(null) } catch { /* not connected */ }
}
