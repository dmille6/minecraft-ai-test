/**
 * EVICT STALE CHUNK COLUMNS.
 *
 * Fifteen hours into a forty-bot run, every process sat at its 1GB cgroup
 * ceiling, twenty-nine bots had been dropped by their servers, and the host was
 * at load 35. The telemetry said exactly where it went:
 *
 *     heap_used_mb=172  heap_total_mb=189  external_mb=325  array_buffers_mb=321
 *
 * The JS heap was FINE and stable. The growth was entirely in ArrayBuffers --
 * chunk column data -- which `--max-old-space-size` does not bound at all. That
 * is why the 768MB heap cap did nothing, why no heap snapshot was ever written
 * (the heap never approached its limit), and why the process still hit the
 * cgroup ceiling and began thrashing until the server timed it out.
 *
 * THE CORRECTNESS ARGUMENT MATTERS MORE THAN THE MEMORY ONE. A column outside
 * the server's view distance is STALE: the server has stopped sending block
 * updates for it. A bot that reasons about ore it "remembers" seeing there is
 * reasoning about a world that no longer exists, and `gather` failing with
 * `unreachable` on a block that was mined out an hour ago is indistinguishable
 * in the telemetry from a real navigation failure.
 *
 * So the radius is not a memory tuning knob. It is "how far away can data be
 * before it is fiction", and it is deliberately set beyond the server's own
 * view distance so the bot never loses anything the server would still update.
 */
import { log, logEvent } from './logger.mjs'

// server.properties runs view-distance=8. Keeping 12 leaves a four-chunk margin
// so ordinary movement never evicts something the server is still updating.
const KEEP_CHUNK_RADIUS = 12
const SWEEP_MS = 60_000

export function startChunkEvictor(bot, { radius = KEEP_CHUNK_RADIUS, everyMs = SWEEP_MS } = {}) {
  let evictedTotal = 0

  const sweep = () => {
    const at = bot.entity?.position
    if (!at || !bot.world?.getColumns) return
    const cx = Math.floor(at.x / 16)
    const cz = Math.floor(at.z / 16)

    let columns
    try { columns = bot.world.getColumns() } catch { return }
    if (!columns) return

    // prismarine-world keys columns as "x,z"; be tolerant of shape changes
    // rather than silently evicting nothing forever.
    const keys = Array.isArray(columns)
      ? columns.map(c => c?.chunkX != null ? `${c.chunkX},${c.chunkZ}` : null).filter(Boolean)
      : Object.keys(columns)

    let evicted = 0
    for (const key of keys) {
      const [xs, zs] = String(key).split(',')
      const x = Number(xs), z = Number(zs)
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) <= radius) continue
      try { bot.world.unloadColumn(x, z); evicted++ } catch { /* already gone */ }
    }

    if (evicted > 0) {
      evictedTotal += evicted
      const mem = process.memoryUsage()
      log('info', 'evicted stale chunk columns', {
        evicted, kept: keys.length - evicted, total: evictedTotal,
        array_buffers_mb: Math.round(mem.arrayBuffers / 1048576),
        rss_mb: Math.round(mem.rss / 1048576),
      })
      // Logged as an event so the leak is VISIBLE in the same telemetry the
      // gate reads. A fix whose effect cannot be measured is a hope.
      logEvent({ kind: 'chunks_evicted', status: 'success',
                 detail: `evicted ${evicted} columns beyond ${radius} chunks, kept ` +
                         `${keys.length - evicted}; arrayBuffers now ` +
                         `${Math.round(mem.arrayBuffers / 1048576)}MB, rss ` +
                         `${Math.round(mem.rss / 1048576)}MB` })
    }
  }

  const t = setInterval(sweep, everyMs)
  t.unref?.()
  return () => clearInterval(t)
}
