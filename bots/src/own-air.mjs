// READ THE AIR OFF THE WIRE. `bot.oxygenLevel` does not track it.
//
// This is what a 4,653-packet recorded trace from eight live bots says, and it
// is not what I believed before recording one.
//
// WHAT I BELIEVED, AND SHIPPED FOUR TIMES: that mineflayer's entities.js writes
// `bot.oxygenLevel` from ANY entity's air_supply, so the drowning reflex was
// thresholding on nearby fish. The code has no entity guard, fish carry 4800
// air (= 320 after mineflayer's /15), and readings of exactly 320 and 400 were
// everywhere. Every fix failed; the last made `drowning_surfaced_stranded` 5.7x
// worse and the lot was reverted.
//
// WHAT THE TRACE SAYS:
//
//     own rows 4598, foreign rows 0, foreign packets that moved oxygen: 0
//
// Not one. The fish hypothesis is dead, and it died on the first measurement I
// took instead of reasoned about. Both models I consulted also failed to find
// the real cause from the same evidence.
//
// WHAT IS ACTUALLY TRUE. Our own entity's metadata carries the air supply at
// key 1, and it is unmistakable:
//
//     key1 range across the trace: -19 .. 300, never above
//     per-bot sequences: 299, 298, 297, 296, 295, 294, ... (985 of 1125 steps falling)
//
// That is a player's air in ticks -- 300 full, negative below zero before
// drowning damage lands at -20. Meanwhile:
//
//     of 4058 packets carrying key 1, bot.oxygenLevel changed in 0 of them
//
// mineflayer never reads it on this server. `bot.oxygenLevel` is a STALE value
// left over from something else, sitting at 20 or 318 or 400 while the real air
// drains from 300 to -19 underneath it. Every threshold the reflex computed was
// a fraction of a frozen number, which is why three separate attempts to tune
// the detector each failed differently, and why `airMax` appeared to take a
// dozen values that no server air scale could.
//
// I do not know WHY mineflayer misses it -- most likely minecraft-data's
// metadata naming for 1.21.8 does not match what this Paper build sends, so
// `metas.air_supply` is undefined and the write is skipped. It does not matter.
// Key 1 is observed, bounded, monotonic under water, and independent of
// whatever mineflayer is doing.
//
// THE SCALE IS NOW KNOWN AND FIXED, not calibrated. 300 ticks, from the
// protocol, confirmed by the trace. No self-calibration, no rolling window, no
// third-highest heuristic -- all of that existed to paper over a signal that was
// never the right signal.

/** A player's full air supply, in ticks. Confirmed against a live packet trace. */
export const AIR_FULL = 300

/** Drowning damage begins here; air keeps counting down past zero. */
export const AIR_DAMAGE = -20

/**
 * The air supply carried by one entity_metadata packet, or null if it carried
 * none. `selfId` is required: another entity's air is not ours, and while the
 * trace shows mineflayer's own handler is not the leak I thought it was, this
 * reader must still only speak for this bot.
 */
export function airFromPacket (packet, selfId) {
  if (selfId == null || packet == null || packet.entityId !== selfId) return null
  const meta = packet.metadata
  if (!Array.isArray(meta)) return null
  for (const m of meta) {
    // Key 1 is the air supply in the entity metadata layout, and the trace
    // confirms it on this exact server: -19..300, counting down under water.
    if (m?.key !== 1) continue
    const v = m.value
    if (typeof v !== 'number') return null
    // A plausibility bound derived from the protocol, not remembered: anything
    // outside it is not a player's air and must not be believed. Nothing in
    // 4,653 recorded packets violated it.
    if (v > AIR_FULL || v < AIR_DAMAGE * 4) return null
    return v
  }
  return null
}

/** Fraction of a full breath, 0..1. Clamped, because air goes negative. */
export function airFraction (air) {
  if (typeof air !== 'number') return null
  return Math.max(0, Math.min(1, air / AIR_FULL))
}

/**
 * Track this bot's real air on `bot.airTicks` (0..300) and mirror it into
 * `bot.oxygenLevel` on the same 0..20 scale the rest of the code already reads.
 *
 * The mirror is deliberate. Twenty-five call sites across reflex.mjs and
 * skills.mjs and every water test's fake bot read `bot.oxygenLevel`, and a
 * parallel property that callers must remember to prefer is one more thing to
 * forget -- with a quietly wrong number and no error as the failure, which is
 * the whole class of bug being fixed. One writer, at the only place that knows.
 */
export function installOwnAir (bot) {
  // A BOT THAT HAS NOT HEARD OTHERWISE IS BREATHING, and starting at null is
  // how the last attempt failed: assessAir returns "not losing air" on a null
  // reading, so a guard that left the value unset did not clean the signal, it
  // deleted it, and `drowning_surfaced_stranded` went to 5.7x. Air metadata is
  // only sent when air CHANGES, so a bot standing on dry land legitimately
  // hears nothing for minutes. Full is the truthful default for that state, and
  // the first packet corrects it within a tick if it is wrong.
  bot.airTicks = AIR_FULL
  bot.ownAirStats = { packets: 0, updates: 0, lowest: null }
  const mirror = () => {
    // Same units and rounding the rest of the code already expects.
    bot.oxygenLevel = Math.round(Math.max(0, bot.airTicks) / 15)
  }
  mirror()
  const onMeta = (packet) => {
    bot.ownAirStats.packets++
    const air = airFromPacket(packet, bot.entity?.id)
    if (air != null) {
      bot.airTicks = air
      bot.ownAirStats.updates++
      if (bot.ownAirStats.lowest == null || air < bot.ownAirStats.lowest) {
        bot.ownAirStats.lowest = air
      }
    }
    // ON EVERY PACKET, not only ones carrying air. mineflayer writes
    // bot.oxygenLevel from its own reading of the metadata, and whatever it is
    // reading is not key 1 -- it produced 318 and 400 on a scale whose maximum
    // is 20. Our listener registers after its plugins, so re-asserting here on
    // every packet means its value never survives to be read by the reflex.
    mirror()
  }
  bot._client?.on?.('entity_metadata', onMeta)
  return () => bot._client?.removeListener?.('entity_metadata', onMeta)
}
