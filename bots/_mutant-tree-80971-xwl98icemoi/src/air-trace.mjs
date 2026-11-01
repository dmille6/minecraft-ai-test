// A RECORDER, NOT A FIX. Nothing here changes what any bot does.
//
// I spent an afternoon shipping four fixes to the drowning reflex's oxygen
// signal against a prediction I only ever checked AFTER each deploy. All four
// failed, the last one made `drowning_surfaced_stranded` 5.7x worse, and the
// whole lot was reverted. The review's verdict was exact: I optimized the
// estimator before validating the sensor. Fixes two and three were circular --
// they used `bot.oxygenLevel` as both the corrupted variable and the instrument
// for judging the corruption.
//
// So this writes down what actually arrives on the wire, and asserts nothing.
//
// THE CLAIM UNDER TEST. mineflayer 4.37.1 lib/plugins/entities.js does:
//
//     const entity = fetchEntity(packet.entityId)
//     if (metas.air_supply != null) bot.oxygenLevel = Math.round(metas.air_supply / 15)
//
// with no check that `entity` is the bot. If that is what is happening, this
// trace shows a row where `own` is false, `before` differs from `after`, and
// `name` is a cod. If it is not happening, no such row exists and I was wrong.
//
// TWO LISTENERS, DELIBERATELY. `prependListener` runs before mineflayer's
// handler and captures the value going in; the ordinary listener runs after and
// captures what it wrote. The pair is the measurement -- it needs no metadata
// decoding on my part, which matters because metadata keys move between
// versions and guessing them is its own class of bug.
//
// The raw metadata array is kept for OUR OWN packets only. Those are the ones
// that answer "what is a player's real air scale" and "how often does the
// server actually tell us", and the second question is open: the counter I
// trusted before said `5 ours to 2156 foreign`, but it watched a derived value
// changing rather than raw packets, so it cannot support that conclusion.
//
// Off unless AIR_TRACE_MIN is set. Self-limiting in both time and lines,
// because an unbounded recorder on forty bots is its own outage.
import fs from 'node:fs'
import path from 'node:path'

export const MAX_ROWS = 40_000

/**
 * One row per entity_metadata packet. Returns a stop() function.
 * `sink` is injected so this is testable without a filesystem.
 */
export function traceAir (bot, { minutes = 30, sink, now = () => Date.now(),
                                 maxRows = MAX_ROWS } = {}) {
  const started = now()
  let rows = 0
  let before = null
  let stopped = false

  const pre = (packet) => { if (!stopped) before = bot.oxygenLevel ?? null }
  const post = (packet) => {
    if (stopped) return
    if (rows >= maxRows || now() - started > minutes * 60_000) { stop(); return }
    const after = bot.oxygenLevel ?? null
    const id = packet?.entityId
    const own = bot.entity?.id != null && id === bot.entity.id
    // Only rows where something happened, or that are ours. A pose update about
    // a distant sheep is not evidence about anything.
    if (before === after && !own) return
    rows++
    const ent = bot.entities?.[id]
    sink({
      ms: now() - started,
      id,
      own,
      // WHICH CREATURE. If the claim is right this column says `cod` on the
      // rows where a foreign packet moved the value, and that is the whole
      // finding in one field.
      name: ent?.name ?? ent?.displayName ?? ent?.type ?? null,
      before,
      after,
      changed: before !== after,
      // Raw metadata for our own packets: the true scale, undecoded.
      meta: own ? summarise(packet?.metadata) : undefined,
    })
  }

  function stop () {
    if (stopped) return
    stopped = true
    bot._client?.removeListener?.('entity_metadata', pre)
    bot._client?.removeListener?.('entity_metadata', post)
  }

  bot._client?.prependListener?.('entity_metadata', pre)
  bot._client?.on?.('entity_metadata', post)
  return stop
}

/** Numeric metadata entries only, keyed by index. Small enough to log. */
export function summarise (metadata) {
  if (!Array.isArray(metadata)) return null
  const out = {}
  for (const m of metadata) {
    const v = m?.value
    if (typeof v === 'number') out[String(m.key)] = v
  }
  return out
}

/** Wire it to a file next to the bot's other logs. */
export function installAirTrace (bot, { dir, name, minutes }) {
  const file = path.join(dir, `air-trace-${name}.jsonl`)
  let stream
  try { stream = fs.createWriteStream(file, { flags: 'a' }) }
  catch { return () => {} }
  const stop = traceAir(bot, {
    minutes,
    sink: (row) => { try { stream.write(JSON.stringify(row) + '\n') } catch { /* full disk */ } },
  })
  return () => { stop(); try { stream.end() } catch { /* already closed */ } }
}
