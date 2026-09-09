// bot.oxygenLevel BELONGS TO WHICHEVER ENTITY SPOKE LAST.
//
// mineflayer's entity-metadata handler writes the bot's own breath meter from
// ANY entity's metadata, with no check that the entity is the bot:
//
//     // node_modules/mineflayer/lib/plugins/entities.js:494
//     if (metas.air_supply != null) {
//       bot.oxygenLevel = Math.round(metas.air_supply / 15)
//       bot.emit('breath')
//     }
//
// The self-check pattern exists THREE LINES ABOVE in the same handler --
// `if (entityId === bot.entity?.id)` for firework rockets -- and was simply
// never applied to the breathing branch. It is a regression from upstream PR
// #3412 (2024-10-13); the older guarded implementation in breath.js is disabled
// on 1.19.4+. Filed as mineflayer#3985, open, no maintainer comment.
//
// 151 entity types carry `air_supply` on 1.21.8. A cod swimming past a bot
// rewrites that bot's oxygen every metadata tick. This fleet is on ocean worlds.
//
// WHAT IT COST US: three separate drowning fixes built on this field, all of
// which failed and were reverted; a standing rule to distrust the sensor
// entirely; and 61.6% of 5,964 drowning reflex fires happening with the bot's
// head in open air, across 72 of 80 bots. The reflex's ENTRY gate reads this
// value, so a passing fish can seize a bot's body.
//
// Patching node_modules was the other option and is worse: npm install wipes it
// silently, and a fix that disappears on a reinstall is a fix that will be
// re-diagnosed from scratch in a month.

/**
 * Was this metadata packet about the bot itself?
 *
 * Pure, because the whole defect below was an ORDERING assumption that looked
 * obviously true and was false.
 */
export function isOurPacket ({ packetEntityId, botEntityId }) {
  return packetEntityId != null && botEntityId != null && packetEntityId === botEntityId
}

/**
 * Refuse foreign writes to bot.oxygenLevel.
 *
 * THE FIRST VERSION OF THIS WAS INERT FOR ITS ENTIRE LIFE, and the reason is
 * worth more than the fix.
 *
 * It assumed it would run AFTER mineflayer's handler, so it read the value the
 * library had just written and put back the bot's own. But mineflayer injects
 * its plugins on a `setTimeout(() => bot.emit('inject_allowed'), 0)` --
 * loader.js:134 -- i.e. a LATER TICK than the `createBot` call that installs
 * this. So this handler is registered FIRST and runs FIRST, read a value
 * mineflayer had not written yet, wrote back the same number it had just read,
 * and then mineflayer clobbered it with the axolotl's.
 *
 * Its unit test passed because the test registered the fake mineflayer handler
 * first -- encoding the one ordering that never happens. A test that builds its
 * own ordering by hand cannot discover that the real ordering is the other way
 * round.
 *
 * So this version does not depend on order at all: the flag handler is added
 * with prependListener, so it runs first however it was registered, and
 * `oxygenLevel` becomes an
 * accessor whose setter REFUSES the assignment unless the packet in flight was
 * ours. mineflayer still executes its assignment; it simply stops landing.
 *
 * The scale is why it matters. air_supply is entity metadata index 1 for every
 * entity type (verified across player/cod/salmon/squid/axolotl/dolphin), and
 * mineflayer divides it by 15. A player's 300 ticks give 20. An AXOLOTL's 6000
 * give 400, and a DOLPHIN's 4800 give 320 -- which is exactly the 400 and the
 * 320/319/318/317 cluster in our telemetry. Those readings then latch
 * `airMax = Math.max(20, ...airSamples)` to 400, which sets the low-air
 * threshold to 160, and a bot at a genuinely full 20 reads as critically low
 * FOREVER. That is the phantom drowning: 61.8% of reflex fires with the head in
 * open air, 54.1% of them at full air, head not in water, and full health.
 */
export function installOxygenGuard (bot) {
  if (bot.__oxygenGuard) return bot.__oxygenGuard
  let ours = false
  let value = bot.oxygenLevel ?? null

  // prependListener, NOT on(). This must run before mineflayer's handler no
  // matter when either was registered, and `on()` only achieves that by luck of
  // ordering -- which is precisely the luck the previous version ran out of. A
  // test that exercises both orderings fails the `on()` version and passes this
  // one, which is the only reason to believe the difference is real.
  const onMeta = (packet) => {
    ours = isOurPacket({ packetEntityId: packet?.entityId, botEntityId: bot.entity?.id })
  }
  if (bot._client?.prependListener) bot._client.prependListener('entity_metadata', onMeta)
  else bot._client?.on?.('entity_metadata', onMeta)

  Object.defineProperty(bot, 'oxygenLevel', {
    configurable: true,
    enumerable: true,
    get: () => value,
    // A foreign write is DROPPED, not corrected afterwards. Correcting after the
    // fact is what the previous version tried, and it can only work if you win a
    // race you do not control.
    set: (v) => { if (ours) value = v },
  })

  const api = {
    /** For tests and for anyone who needs to know whether this is really live. */
    get accepting () { return ours },
    stop () {
      bot._client?.removeListener?.('entity_metadata', onMeta)
      delete bot.oxygenLevel
      bot.oxygenLevel = value
      bot.__oxygenGuard = null
    },
  }
  bot.__oxygenGuard = api
  return api
}
