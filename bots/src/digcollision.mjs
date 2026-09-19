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

/** The first stack frame that is neither this file nor node internals. */
function requester () {
  const lines = String(new Error().stack || '').split('\n').slice(2)
  for (const l of lines) {
    if (l.includes('digcollision.mjs') || l.includes('node:internal')) continue
    // `    at Foo.bar (file:///srv/.../skills.mjs:1195:24)` -> `skills.mjs:1195`
    const m = l.match(/([^/\\)]+\.(?:mjs|js)):(\d+):\d+/)
    if (m) return `${m[1]}:${m[2]}`
  }
  return 'unknown'
}

const where = b => (b?.position ? `${Math.floor(b.position.x)},${Math.floor(b.position.y)},${Math.floor(b.position.z)}` : '?')

/**
 * Wrap `bot.dig` to see who asks, and listen for mineflayer's own abort event.
 *
 * The wrapper is the only way to name the REQUESTER: the cancellation happens
 * inside `dig()` before any event fires, so by the time `diggingAborted` lands
 * the caller is gone from the stack. It preserves `this`, every argument and
 * the returned promise, and never swallows a rejection -- a recorder that
 * changes an error path is a fix, and this is not one.
 */
export function installDigCollisionWatch (bot, logEvent, { throttleMs = 0 } = {}) {
  const original = bot.dig
  if (typeof original !== 'function') return () => {}
  let inflight = null          // { name, at, by }
  let lastLog = 0

  bot.dig = function (block, ...rest) {
    const by = requester()
    // Read the incumbent BEFORE calling through: dig()'s first line clears it.
    const victim = bot.targetDigBlock
    if (victim && inflight && (Date.now() - lastLog >= throttleMs)) {
      lastLog = Date.now()
      try {
        logEvent({
          kind: 'dig_collision', status: 'failed',
          detail: `${inflight.name ?? '?'}@${where(victim)} cancelled after ` +
                  `${Date.now() - inflight.at}ms by a new dig of ${block?.name ?? '?'}@${where(block)}` +
                  ` — incumbent asked by ${inflight.by}, requester ${by}`,
        })
      } catch { /* a recorder never breaks the thing it records */ }
    }
    inflight = { name: block?.name, at: Date.now(), by }
    return original.call(this, block, ...rest)
  }

  const onDone = () => { inflight = null }
  bot.on('diggingCompleted', onDone)
  bot.on('diggingAborted', onDone)

  return () => {
    bot.dig = original
    bot.removeListener('diggingCompleted', onDone)
    bot.removeListener('diggingAborted', onDone)
  }
}
