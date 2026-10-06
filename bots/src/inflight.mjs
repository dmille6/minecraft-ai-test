// A CLICK IS IN FLIGHT UNTIL IT HAS SETTLED -- not until somebody stopped waiting for it.
//
// mineflayer's clickWindow (and anything built on it) goes on after its caller gives up: a cap, a fence timeout or a
// teardown ends the WAIT, never the click. Two branches met this the same way: withdraw (round 3, Codex: a recovery
// clicked again, and a probe closed the window, with the first click still pending) and the grid fix (gf-on-1918bb5,
// Codex: a fence timeout released inventory ownership while mineflayer still held a click, which later moved items).
// One tracker, shared: every click's promise is registered here and leaves only when it resolves or rejects. Ownership
// and closes wait on `size === 0`, never on a timer alone.
//
// A CLICK IS BOUND TO THE WINDOW IT WAS ISSUED FOR (withdraw round 5, Codex P1): mineflayer 4.37.1 reads
// `bot.currentWindow || bot.inventory` only AFTER its dig-cooldown sleep, so a click issued for a chest that closes
// meanwhile goes to window 0, and one whose chest is replaced goes to the new window -- moving items nobody chose.
// Ownership guards cannot stop a click that is already inside mineflayer. So: `bind` a ticket at issue time,
// `dispatch` the click with that ticket current, and let the write hook `admit` or drop the packet. `invalidate`
// (a release, a cancel, the end of a visit) makes every ticket issued before it droppable, so an owner may unlock at
// once: nothing stale can land.
//
// VALIDATE BEFORE THE CLICK RUNS (round 6, Codex P1): mineflayer applies a click to its LOCAL window before it writes
// the packet, so a stale click dropped only at the wire has already corrupted the client's slots -- and an equip right
// after a release then chose its slots from that corruption. The caller checks `validate(ticket, windowNow)` before it
// invokes mineflayer; `admit` (the wire) stays as the backstop and uses the same decision.
//
// Self-contained on purpose (no imports), so craftsync.mjs, skills.mjs (withdraw) and the grid fix use one
// implementation. The round-4 API (track/size/settled/waitSettled) is unchanged; everything below it is additive.

/**
 * -> { track(p, ticket?), size, settled(), waitSettled(ms, cancelled),
 *      epoch, bind({ windowId, slot, button, mode, epoch? }), invalidate(reason), validate(ticket, windowId),
 *      dispatch(ticket, fn), admit(packet), current, live }.
 */
export function inflightTracker () {
  const set = new Set()
  const tickets = new Set()                 // bound tickets whose click has not settled
  let epoch = 0                             // bumped by invalidate(); a ticket from an older epoch is stale
  const reasons = new Map()                 // epoch -> why it was invalidated
  let current = null                        // the ticket whose click is being dispatched (a synchronous span)
  return {
    /** Register a click's promise; it stays counted until it settles. Returns the promise. A ticket, if given,
     *  leaves the live set when the promise settles. */
    track (p, ticket = null) {
      set.add(p)
      const gone = () => { set.delete(p); if (ticket) tickets.delete(ticket) }
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

    get epoch () { return epoch },
    /** Tickets bound and not yet settled. */
    get live () { return tickets.size },
    /** The ticket being dispatched right now (null outside a dispatch). */
    get current () { return current },
    /** A ticket for a click about to be issued: the window it is FOR, and the epoch it was issued in (pass the epoch
     *  read when the caller decided to click, if anything awaits between that and the bind). */
    bind ({ windowId, slot = null, button = null, mode = null, epoch: at = epoch } = {}) {
      const ticket = { windowId, slot, button, mode, epoch: at, dropped: null }
      tickets.add(ticket)
      return ticket
    },
    /** Every click issued before now becomes droppable at its send. Returns how many live tickets that touched. */
    invalidate (reason = 'invalidated') {
      reasons.set(epoch, String(reason))
      epoch++
      return tickets.size
    },
    /** May this ticket's click run now, the open window being `windowId`? -> { ok: true } | { ok: false, why }. Pure:
     *  no side effect, so a caller can ask before invoking a click that mutates local state. */
    validate (ticket, windowId) {
      if (!ticket) return { ok: true }
      if (ticket.epoch < epoch) return { ok: false, why: `invalidated (${reasons.get(ticket.epoch) ?? 'invalidated'})` }
      if (windowId !== ticket.windowId) return { ok: false, why: `bound to window ${ticket.windowId}, written to window ${windowId}` }
      return { ok: true }
    },
    /** Run fn() -- the click -- with `ticket` current for its SYNCHRONOUS part, which is where mineflayer writes the
     *  packet once no sleep precedes it. Returns fn()'s result. */
    dispatch (ticket, fn) {
      const prev = current
      current = ticket
      try { return fn() } finally { current = prev }
    },
    /** For the write hook: may this window_click go out? -> { ok: true } | { ok: false, why }. A packet written
     *  outside a dispatch is not ours to judge (ok). A refusal is recorded on the ticket (`dropped`). */
    admit (packet) {
      const t = current
      if (!t) return { ok: true }
      const v = this.validate(t, packet?.windowId)
      if (!v.ok) t.dropped = v.why
      return v
    },
  }
}
