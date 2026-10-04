// A CLICK IS IN FLIGHT UNTIL IT HAS SETTLED -- not until somebody stopped waiting for it.
//
// mineflayer's clickWindow (and anything built on it) goes on after its caller gives up: a cap, a fence timeout or a
// teardown ends the WAIT, never the click. Two branches met this the same way: withdraw (round 3, Codex: a recovery
// clicked again, and a probe closed the window, with the first click still pending) and the grid fix (gf-on-1918bb5,
// Codex: a fence timeout released inventory ownership while mineflayer still held a click, which later moved items).
// One tracker, shared: every click's promise is registered here and leaves only when it resolves or rejects. Ownership
// and closes wait on `size === 0`, never on a timer alone.
//
// Self-contained on purpose (no imports), so craftsync.mjs, skills.mjs (withdraw) and the grid fix use one
// implementation.

/** -> { track(p), size, settled(), waitSettled(ms, cancelled) }. */
export function inflightTracker () {
  const set = new Set()
  return {
    /** Register a click's promise; it stays counted until it settles. Returns the promise. */
    track (p) {
      set.add(p)
      const gone = () => { set.delete(p) }
      Promise.resolve(p).then(gone, gone)
      return p
    },
    get size () { return set.size },
    /** Every click registered so far, settled (rejections included). */
    settled: () => Promise.allSettled([...set]),
    /** Bounded wait for size === 0 -> true when it is; a cancellation ends the wait early (false). */
    async waitSettled (ms, cancelled = () => false, pollMs = 25) {
      const until = Date.now() + Math.max(0, ms)
      while (set.size) {
        if (cancelled() || Date.now() >= until) return false
        await new Promise(resolve => setTimeout(resolve, pollMs))
      }
      return true
    },
  }
}
