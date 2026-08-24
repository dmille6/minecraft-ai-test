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
  bot.ownAirStats = { ours: 0, foreign: 0, repaired: 0, dropped: 0 }

  // WHOSE PACKET IS NOT ENOUGH. IT MUST ALSO BE A PACKET THAT WROTE.
  //
  // The first version of this guard asked only "was that packet ours?" and, if
  // so, adopted whatever was standing in bot.oxygenLevel. That is wrong, and
  // wrong in a way that quietly re-created the bug it was fixing: entity
  // metadata is a DELTA. Most packets about us carry a pose or a flag and no
  // air_supply at all, so mineflayer does not touch oxygenLevel, so the value
  // standing there is whatever the last write left -- frequently a fish. The
  // guard then latched that fish value as our own and defended it.
  //
  // Deployed, that half-fix moved airMax=20 from uncommon to the most common
  // value and still left 190 readings above 20 in ten bot-hours, on a scale
  // whose maximum is 20. Partly working is how this class of bug hides.
  //
  // So watch the VALUE, not just the sender. If oxygenLevel changed across the
  // dispatch of this packet, mineflayer wrote it, and the sender says whether
  // to keep it. No metadata keys are parsed, which is the point -- keys move
  // between versions and guessing them is how this breaks again.
  let last = bot.oxygenLevel ?? null
  const onMeta = (packet) => {
    const now = bot.oxygenLevel ?? null
    if (now === last) return                 // this packet carried no air_supply
    if (isOwnEntity(packet, bot.entity?.id)) {
      bot.ownOxygenLevel = now
      bot.ownAirStats.ours++
    } else {
      bot.ownAirStats.foreign++
      if (bot.ownOxygenLevel != null) {
        bot.oxygenLevel = bot.ownOxygenLevel
        bot.ownAirStats.repaired++
      } else {
        // Nothing of ours to restore yet. Put back whatever preceded rather
        // than adopting a fish -- at worst that is null, and null is honest:
        // assessAir falls back to the drain trend, which needs no scale.
        bot.oxygenLevel = last
        bot.ownAirStats.dropped++
      }
    }
    last = bot.oxygenLevel ?? null
  }
  bot._client?.on?.('entity_metadata', onMeta)
  return () => bot._client?.removeListener?.('entity_metadata', onMeta)
}
