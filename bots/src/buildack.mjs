// SETTLEMENT BY ACKNOWLEDGEMENT (shop-01 stage B; design 4.1 "Settlement is the server's ACKNOWLEDGEMENT of that click", Codex
// design r4 P1). Since 1.19 every use-item-on (block_place) and every dig carries a `sequence`; the server processes the
// connection's packets in order and answers `acknowledge_player_digging { sequenceId }` with the HIGHEST sequence it has handled
// (cumulative, at the end of the tick, after the block updates it caused). mineflayer 4.37 writes block_place with sequence 0
// and keeps its own rising counter for use_item, so:
//   - a click's sequence is ONE MORE THAN EVERY SEQUENCE ALREADY WRITTEN on this connection (watched on the client's write), so
//     an acknowledgement >= it, received after the send, can only follow the server handling this click;
//   - a fresh read of the cell settles nothing (the click may still be in flight): only the acknowledgement does.
// RETIREMENT: another builder's connection is retired by the server's player_remove / playerLeft for it, seen here; after
// RETIRE_MS it can deliver nothing more (buildproj.mjs barrierClear).

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
 * INSTALL ON A BOT -> { tracker, retiredAt: Map(name -> ms), stop }. Watches every outgoing packet's `sequence` (the client's
 * write), every inbound acknowledge_player_digging, and every playerLeft. Never throws into the packet path.
 */
export function installAckTracker (bot) {
  const tracker = new AckTracker()
  const retiredAt = new Map()
  const client = bot?._client
  const origWrite = client?.write?.bind(client)
  if (client && origWrite) {
    client.write = (name, params, ...rest) => {
      try { if (params && Number.isInteger(params.sequence)) tracker.sent(params.sequence) } catch { /* never break the write */ }
      return origWrite(name, params, ...rest)
    }
  }
  const onPacket = (data, meta) => { try { if (meta?.name === 'acknowledge_player_digging') tracker.ack(data?.sequenceId) } catch { /* telemetry-grade */ } }
  const onLeft = p => { try { if (p?.username) retiredAt.set(p.username, Date.now()) } catch { /* ignore */ } }
  const onJoined = p => { try { if (p?.username) retiredAt.delete(p.username) } catch { /* ignore */ } }
  try { client?.on?.('packet', onPacket); bot?.on?.('playerLeft', onLeft); bot?.on?.('playerJoined', onJoined) } catch { /* no client yet */ }
  return {
    tracker,
    retiredAt,
    stop: () => {
      try { if (client && origWrite) client.write = origWrite } catch { /* gone */ }
      try { const off = (o, ev, fn) => (o?.off ?? o?.removeListener)?.call(o, ev, fn); off(client, 'packet', onPacket); off(bot, 'playerLeft', onLeft); off(bot, 'playerJoined', onJoined) } catch { /* gone */ }
    },
  }
}
