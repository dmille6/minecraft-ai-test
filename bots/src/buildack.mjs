// SETTLEMENT BY ACKNOWLEDGEMENT (shop-01 stage B; design 4.1 "Settlement is the server's ACKNOWLEDGEMENT of that click", Codex
// design r4 P1). Since 1.19 every use-item-on (block_place) and every dig carries a `sequence`; the server processes the
// connection's packets in order and answers `acknowledge_player_digging { sequenceId }` with the HIGHEST sequence it has handled
// that tick (after the block updates it caused). mineflayer 4.37 writes block_place with sequence 0 and keeps its own rising
// counter for use_item, so:
//   - a click's sequence is ONE MORE THAN EVERY SEQUENCE ALREADY WRITTEN on this connection (watched on the client's write), so
//     an acknowledgement >= it, received after the send, can only follow the server handling this click;
//   - a fresh read of the cell settles nothing (the click may still be in flight): only the acknowledgement does.
// r2 (Codex r1 P2 x3, Claude r1 P2-2): ONE TRACKER PER CONNECTION, installed before login (index.mjs) and kept for the
// connection's life, so no sequence written before a visit goes unseen; an acknowledgement that comes after the click stopped
// waiting still SETTLES that intent (the `open` map and the settler); and what this bot has seen of other holders (playerLeft,
// offline since) lives as long as the connection -- a rejoin never erases a playerLeft.

/** THE TRACKER, pure: what was sent, what was acknowledged, and who is waiting. */
export class AckTracker {
  constructor () { this.maxSent = 0; this.acked = 0; this.waiters = [] }
  /** A packet carrying `seq` went out (ours or anyone's). */
  sent (seq) { if (Number.isInteger(seq) && seq > this.maxSent) this.maxSent = seq }
  /** The next sequence for a click of ours: above everything written. */
  next () { const s = this.maxSent + 1; this.maxSent = s; return s }
  /** The server acknowledged up to `id`. Wakes every waiter at or below it. */
  ack (id) {
    if (!Number.isInteger(id) || id <= this.acked) return
    this.acked = id
    const keep = []
    for (const w of this.waiters) { if (w.seq <= id) { clearTimeout(w.timer); w.resolve('acked') } else keep.push(w) }
    this.waiters = keep
  }
  /** -> 'acked' | 'timeout'. Already acknowledged: at once. */
  wait (seq, ms) {
    if (this.acked >= seq) return Promise.resolve('acked')
    return new Promise(resolve => {
      const w = { seq, resolve, timer: null }
      w.timer = setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); resolve('timeout') }, ms)
      this.waiters.push(w)
    })
  }
}

/**
 * INSTALL ON A BOT, ONCE PER CONNECTION -> { tracker, conn, track, untrack, onSettle, seen, open, leftAt, stop }.
 * Watches every outgoing packet's `sequence` (the client's write), every inbound acknowledge_player_digging, and every
 * playerLeft / playerJoined. Never throws into the packet path.
 *   track(id, seq) / untrack(id)   this bot's own open intents; an acknowledgement >= seq calls the settler with id, however late
 *   onSettle(fn)                    the settler (skills.mjs: closes the intent in the project's file)
 *   seen(holder, now)               -> { online, offlineSince, leftAt } for buildproj.mjs intentRetired
 */
export function installAckTracker (bot, { now = () => Date.now() } = {}) {
  const tracker = new AckTracker()
  const open = new Map()
  const leftAt = new Map(), offlineSince = new Map()
  let settler = null
  const settleUpTo = upTo => { for (const [id, seq] of [...open]) if (seq <= upTo) { open.delete(id); try { settler?.(id) } catch { /* the barrier waits: safe */ } } }
  const client = bot?._client
  const origWrite = client?.write?.bind(client)
  if (client && origWrite) {
    client.write = (name, params, ...rest) => {
      try { if (params && Number.isInteger(params.sequence)) tracker.sent(params.sequence) } catch { /* never break the write */ }
      return origWrite(name, params, ...rest)
    }
  }
  const onPacket = (data, meta) => { try { if (meta?.name === 'acknowledge_player_digging') { tracker.ack(data?.sequenceId); settleUpTo(tracker.acked) } } catch { /* telemetry-grade */ } }
  const onLeft = p => { try { const u = p?.username; if (u) { const t = now(); leftAt.set(u, t); if (!offlineSince.has(u)) offlineSince.set(u, t) } } catch { /* ignore */ } }
  // a rejoin ends "offline since" but NEVER the playerLeft: the old connection's intents stay retired
  const onJoined = p => { try { if (p?.username) offlineSince.delete(p.username) } catch { /* ignore */ } }
  try { client?.on?.('packet', onPacket); bot?.on?.('playerLeft', onLeft); bot?.on?.('playerJoined', onJoined) } catch { /* no client yet */ }
  return {
    tracker,
    conn: null,
    open,
    leftAt,
    track: (id, seq) => { open.set(id, seq); if (tracker.acked >= seq) settleUpTo(tracker.acked) },
    untrack: id => open.delete(id),
    onSettle: fn => { settler = fn },
    seen: (holder, t = now()) => {
      const online = !!bot?.players?.[holder]
      if (online) offlineSince.delete(holder)
      else if (!offlineSince.has(holder)) offlineSince.set(holder, t)
      return { online, offlineSince: offlineSince.get(holder) ?? null, leftAt: leftAt.get(holder) ?? null }
    },
    stop: () => {
      try { if (client && origWrite) client.write = origWrite } catch { /* gone */ }
      try { const off = (o, ev, fn) => (o?.off ?? o?.removeListener)?.call(o, ev, fn); off(client, 'packet', onPacket); off(bot, 'playerLeft', onLeft); off(bot, 'playerJoined', onJoined) } catch { /* gone */ }
    },
  }
}
