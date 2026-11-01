// A RECORDER, NOT A FIX. Nothing here changes what any bot does.
//
// THE MEASUREMENT. 1,928 gather runs in 24 h (5.7% of all of them, 1,892 classed
// `failed/no_path`) end with mineflayer's string `Digging aborted`, every one
// after a walk that SUCCEEDED -- "probe: success, A* reached a candidate". Two
// hypotheses were tested against controls and both died: reflexes are not doing
// it (3.8% of aborted digs have a reflex row in the prior 15 s against 3.7% of
// successful gathers -- no association), and it is not a timeout (durations run
// smooth from p10 3.1 s to p90 17 s with no cluster).
//
// WHAT IT ACTUALLY IS, verified by reading mineflayer 4.37.1:
//
//     lib/plugins/digging.js:127   if (bot.targetDigBlock) bot.stopDigging()
//     lib/plugins/digging.js:189   diggingTask.cancel(new Error('Digging aborted'))
//
// `dig()` cancels the dig already in flight, at its own first line. So these are
// TWO CONCURRENT DIGGERS on one bot and the loser is the one that was already
// working. The cancellation-face variable is even named
// `stoppedBecauseOfNewDigRequest`.
//
// WHY THIS EXISTS RATHER THAN A FIX. Which second digger is INFERRED, not known.
// It emits no telemetry: ranking every row in the 15 s before an abort against
// the same window before a success found nothing that discriminates (best was
// `_prereq_satisfied`, 5.8% vs 1.5%, on small numbers). An unlogged digger is
// exactly what mineflayer-pathfinder is -- it equips and breaks obstructing
// blocks internally (index.js:483-492) with no logEvent of its own -- and the
// block mix fits: cobblestone 1,209, stone 385, coal_ore 110, which is what a
// pathfinder tunnels through and not what a bot is asked to gather.
//
// A 5.7% failure mode currently inferred from an upstream library's wording is
// not a thing to fix. It is a thing to measure first. This turns the inference
// into a row that names both parties, and asserts nothing.
//
// IT MUST NOT RETRY. The loser was cancelled because something else wants the
// body; a retry without ownership makes two diggers into three. The remedy is
// to gate `dig` in the arbiter the way `setControlState` is already gated, and
// that is a behaviour change for a later canary, judged on items and not on the
// absence of this error.

/** Stack frames outside this file and node internals, nearest first. */
function frames (limit = 4) {
  const out = []
  for (const l of String(new Error().stack || '').split('\n').slice(2)) {
    if (l.includes('digcollision.mjs') || l.includes('node:internal')) continue
    const m = l.match(/([^/\\)]+\.(?:mjs|js)):(\d+):\d+/)
    if (m) { out.push(`${m[1]}:${m[2]}`); if (out.length >= limit) break }
  }
  return out
}

const where = b => (b?.position ? `${Math.floor(b.position.x)},${Math.floor(b.position.y)},${Math.floor(b.position.z)}` : '?')

/**
 * Record WHO cancelled a dig, by listening rather than wrapping.
 *
 * V1 WRAPPED `bot.dig` AND SAW NOTHING. Deployed as digwatch-01 at 15:55Z on
 * 2026-09-19; by 16:06Z the canary had logged THREE gather runs ending
 * `Digging aborted` and ZERO collision rows. That is the exact condition the
 * registration named as meaning the instrument is blind, and it is: wrapping
 * `dig` catches only the cancellation `dig()` performs on its own first line
 * for a NEW dig request, and almost nothing arrives that way. The fleet's
 * aborts come from direct `bot.stopDigging()` calls in our own timeout and
 * abort handlers -- skills.mjs:165, :515, :1204, :2792, :5324, :5520 -- and a
 * wrapper on `dig` never sees them.
 *
 * SO THE "TWO CONCURRENT DIGGERS" READING IS WITHDRAWN. It was inferred from
 * mineflayer's wording plus digging.js:127, and the instrument built to confirm
 * it refuted it instead. What actually cancels these digs is still open, and
 * the candidates are our own handlers, which do not log.
 *
 * WHY A LISTENER AND NOT A WRAPPER ON stopDigging. `digging.js` REASSIGNS
 * `bot.stopDigging` inside `dig()` and sets it to `noop` afterwards, so a
 * wrapper installed once is replaced by the next dig. But that same function
 * calls `bot.emit('diggingAborted', block)` SYNCHRONOUSLY, so a listener's own
 * stack still contains whoever called stopDigging. Listening costs nothing,
 * cannot alter the dig, and reaches every caller including mineflayer's.
 */
export function installDigCollisionWatch (bot, logEvent, { throttleMs = 0 } = {}) {
  if (typeof bot?.on !== 'function') return () => {}
  let lastLog = 0
  const onAborted = (block) => {
    if (Date.now() - lastLog < throttleMs) return
    lastLog = Date.now()
    try {
      logEvent({
        kind: 'dig_collision', status: 'failed',
        detail: `dig of ${block?.name ?? '?'}@${where(block)} cancelled — ` +
                `stopDigging called from ${frames().join(' <- ') || 'unknown'}`,
      })
    } catch { /* a recorder never breaks the thing it records */ }
  }
  bot.on('diggingAborted', onAborted)
  return () => bot.removeListener('diggingAborted', onAborted)
}
