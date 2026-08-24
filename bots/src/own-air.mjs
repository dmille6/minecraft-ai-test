// OUR OXYGEN, NOT WHATEVER SWAM PAST.
//
// mineflayer 4.37.1, lib/plugins/entities.js:
//
//     const entity = fetchEntity(packet.entityId)
//     ...
//     if (metas.air_supply != null) {
//       bot.oxygenLevel = Math.round(metas.air_supply / 15)
//       bot.emit('breath')
//     }
//
// There is no check that `entity` is the bot. ANY entity that reports
// air_supply overwrites the bot's own oxygen reading. The older code path in
// breath.js does guard it (`if (bot.entity.id !== packet.entityId) return`);
// the newer metadata path that supersedes it on 1.21.8 does not.
//
// A player's air supply is 300, so `bot.oxygenLevel` should never exceed
// 300/15 = 20. Fish and dolphins carry 4800, which is 320. Measured over six
// hours on this fleet, the reflex's oxygen readings were 400, 320, 319, 318,
// 315, 308, 303, 290, 284, 271, 241, 189 and 20 -- and 41% of all decisions had
// an aquatic mob within 24 blocks. Only the 20s were ours.
//
// What that did: the drowning reflex derives every threshold from a fraction of
// the largest value it has seen. A cod swimming past sets 320. A bot at 3 of 20
// units of air -- seconds from drowning -- then computes 3/320 or, worse, sits
// above a threshold scaled to a fish and gets no rescue at all. This is why
// releases were logged as `oxygen 20, health 20` and read as safe: 20 is FULL
// air for a player, and the code had been taught that full was 320.
//
// THE FIX NEEDS NO METADATA PARSING. Metadata keys move between versions and
// guessing them is how this kind of thing breaks again. Instead: mineflayer has
// already decoded the packet and written `bot.oxygenLevel` by the time our
// listener runs, because its plugins register at createBot and ours registers
// after. So all we have to know is WHOSE packet just wrote it. If it was ours,
// the value standing in bot.oxygenLevel is correct and we keep it. If it was
// anything else, we ignore it and hold the last reading that was really ours.
//
// Upstream should guard the assignment; until it does, this is the whole fix.

/** Whether this metadata packet is about the bot itself. */
export function isOwnEntity (packet, selfId) {
  return selfId != null && packet != null && packet.entityId === selfId
}

/**
 * Track the bot's OWN oxygen on `bot.ownOxygenLevel`.
 *
 * Null until the first packet about the bot arrives, and null is meaningful:
 * assessAir treats an unestablished reading as "use the drain trend", which is
 * the honest behaviour when we genuinely have not heard from the server about
 * this bot yet. It is never populated from another entity, at any point.
 */
export function installOwnAir (bot) {
  bot.ownOxygenLevel = null
  const onMeta = (packet) => {
    if (isOwnEntity(packet, bot.entity?.id)) {
      // mineflayer has already decoded this one and it really is ours.
      if (typeof bot.oxygenLevel === 'number') bot.ownOxygenLevel = bot.oxygenLevel
    } else if (bot.ownOxygenLevel != null) {
      // A foreign entity just overwrote our reading. Put ours back.
      //
      // REPAIRING THE PROPERTY RATHER THAN ADDING A SECOND ONE is deliberate.
      // `bot.oxygenLevel` is read in twenty-five places across reflex.mjs and
      // skills.mjs and in every water test's fake bot. A parallel
      // `ownOxygenLevel` that callers must remember to prefer is one more thing
      // to forget, and the next reader of the wrong property gets no error --
      // just a quietly wrong number, which is the entire failure mode being
      // fixed here. One repair, at the only place that can tell the difference.
      bot.oxygenLevel = bot.ownOxygenLevel
    }
  }
  bot._client?.on?.('entity_metadata', onMeta)
  return () => bot._client?.removeListener?.('entity_metadata', onMeta)
}
