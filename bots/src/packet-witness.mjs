// IS THE BOT'S WORLD MODEL WRONG, OR IS THE SERVER HOLDING IT STILL?
//
// The escape lattice reads `underfootSolid` from `bot.world` and gets `air` for
// bots that have not moved in hours. Two explanations survive, they predict the
// same telemetry, and every field we currently log is blind to the difference:
//
//   1. The local block cache is wrong. `finishDigging` writes air into
//      `bot.world` with no server acknowledgement (mineflayer digging.js:158),
//      so a dig the server refused leaves a hole that exists only in the bot's
//      head.
//   2. The server is correcting the bot's position. `instance1-movement-is-
//      protocol` records this fleet losing an entire instance to exactly that:
//      absolute teleports to byte-identical coordinates, twenty times a second.
//
// `onGround` CANNOT separate them, which is why the first attempt at this
// diagnosis was retracted. mineflayer's physics.js:418 sets
// `bot.entity.onGround = false` unconditionally on EVERY inbound position
// packet, with no reference to the world cache. So `onGround === false` is
// consistent with both stories, and reading it as evidence for one of them was
// a confounded measurement.
//
// These two counters are not confounded, because they come from different
// places than the block cache does:
//
//   posPackets    inbound server `position` packets. The server pushing the bot
//                 around. A bare mineflayer client digging normally measured
//                 ZERO of these in a 2s window (2026-09-06), grounded AND
//                 airborne, so any sustained non-zero here is the fleet doing
//                 something a plain client does not.
//   physicsTicks  our own physics loop firing. physics.js:81 returns early --
//                 silently, with no event and no error -- whenever
//                 `bot.blockAt(bot.entity.position)` is null, which is what an
//                 unloaded chunk looks like. A bot whose physics has stopped
//                 cannot fall no matter what the block under it is, and would
//                 look exactly like a bot standing on a floor it cannot see.
//
// Reading, once both are on the wire:
//
//   posPackets high                  -> the server is stomping position.
//                                       A cache fix cannot touch this.
//   physicsTicks ~0                  -> physics is disabled. Also not a cache bug.
//   both normal, underfoot still air -> the cache story, and only then.

/**
 * A count of events inside a trailing window, without keeping the events.
 *
 * Ring of fixed-width buckets: `bump` increments the current one, `count` sums
 * the ones still inside the window. Bounded memory and no array growth, because
 * this runs on the packet path of 80 bots and must not become the thing it is
 * measuring.
 *
 * Pure and exported so the arithmetic can be tested without a socket.
 */
export class RollingCount {
  constructor ({ windowMs = 10_000, buckets = 20 } = {}) {
    this.windowMs = windowMs
    this.n = Math.max(2, buckets)
    this.width = windowMs / this.n
    this.slots = new Array(this.n).fill(0)
    this.stamps = new Array(this.n).fill(-Infinity)
  }

  bump (now = Date.now()) {
    const i = Math.floor(now / this.width) % this.n
    // A slot older than one full window is stale: reset rather than add to a
    // count from a previous lap around the ring.
    if (now - this.stamps[i] >= this.windowMs) { this.slots[i] = 0; this.stamps[i] = now }
    this.slots[i]++
  }

  count (now = Date.now()) {
    let total = 0
    for (let i = 0; i < this.n; i++) {
      if (now - this.stamps[i] < this.windowMs) total += this.slots[i]
    }
    return total
  }
}

/**
 * Attach the witness. Returns a reader; never throws into the packet path.
 *
 * The `packet` event is used rather than named handlers so a protocol rename
 * cannot quietly turn this into an instrument that counts nothing -- this repo
 * has a long list of confident zeros produced by exactly that.
 */
export function attachPacketWitness (bot, { windowMs = 10_000 } = {}) {
  const pos = new RollingCount({ windowMs })
  const phys = new RollingCount({ windowMs })
  const blockChange = new RollingCount({ windowMs })
  let posTotal = 0, physTotal = 0

  try {
    bot._client?.on('packet', (_d, meta) => {
      try {
        const n = meta?.name
        if (n === 'position' || n === 'player_position') { pos.bump(); posTotal++ }
        else if (n === 'block_change' || n === 'block_update' ||
                 n === 'multi_block_change') blockChange.bump()
      } catch { /* never let instrumentation break the packet path */ }
    })
    bot.on('physicsTick', () => { try { phys.bump(); physTotal++ } catch {} })
  } catch { /* a bot without a client yet is not a reason to fail startup */ }

  return () => ({
    windowMs,
    posPackets: pos.count(),
    physicsTicks: phys.count(),
    blockChanges: blockChange.count(),
    posTotal,
    physTotal,
  })
}
