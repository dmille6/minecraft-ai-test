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
 * What `oxygenLevel` should be after a metadata packet.
 *
 * Pure, because a source-grep cannot tell a correct guard from a comment about
 * one. `reported` is whatever mineflayer has JUST written -- trustworthy only
 * when the packet was about the bot itself.
 */
export function reconcileOxygen ({ packetEntityId, botEntityId, reported, lastOwn }) {
  // Before spawn there is no bot entity to compare against, so nothing can be
  // established either way. Holding the last known value is the honest move:
  // adopting a stranger's reading would be the bug, and inventing 20 would be a
  // different one.
  if (botEntityId == null || packetEntityId == null) return lastOwn
  return packetEntityId === botEntityId ? reported : lastOwn
}

/**
 * Undo foreign writes to bot.oxygenLevel.
 *
 * Registered AFTER mineflayer's own handler (this runs post-createBot, and
 * emitter callbacks fire in registration order), so it sees the value the
 * library just set and either keeps it or puts back the bot's own.
 */
export function installOxygenGuard (bot) {
  let lastOwn = null
  const onMeta = (packet) => {
    const next = reconcileOxygen({
      packetEntityId: packet?.entityId,
      botEntityId: bot.entity?.id,
      reported: bot.oxygenLevel,
      lastOwn,
    })
    lastOwn = next
    // Never write null over a real reading. A missing value makes assessAir
    // return `none`, which is safe, but it would also mask a genuine drowning.
    if (next != null) bot.oxygenLevel = next
  }
  bot._client?.on?.('entity_metadata', onMeta)
  return { stop: () => bot._client?.removeListener?.('entity_metadata', onMeta) }
}
