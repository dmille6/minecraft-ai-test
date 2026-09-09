// A PASSING FISH OWNED THE BOT'S BREATH METER.
//
// mineflayer writes bot.oxygenLevel from ANY entity's metadata with no
// self-check (entities.js:494), while the very same handler DOES check
// `entityId === bot.entity?.id` three lines above for firework rockets. 151
// entity types carry air_supply on 1.21.8 and this fleet lives on ocean worlds.
//
// Cost so far: three drowning fixes built on this field, all reverted; a
// standing rule to distrust it; and 61.6% of 5,964 drowning reflex fires
// happening with the bot's head in open air across 72 of 80 bots -- because the
// reflex's ENTRY gate reads this value.
import assert from 'node:assert'
import test from 'node:test'
import { EventEmitter } from 'node:events'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { reconcileOxygen, installOxygenGuard } = await import('../src/oxygen.mjs')

test('a reading about the bot itself is kept', () => {
  assert.equal(reconcileOxygen({ packetEntityId: 7, botEntityId: 7, reported: 12, lastOwn: 20 }), 12)
})

test('a reading about anything else is discarded', () => {
  // The cod case, exactly.
  assert.equal(reconcileOxygen({ packetEntityId: 99, botEntityId: 7, reported: 3, lastOwn: 20 }), 20,
    "a fish at 3 bubbles must not become the bot's reading")
})

test('before spawn, hold rather than guess', () => {
  // No bot entity means nothing can be established. Adopting a stranger's value
  // is the bug; inventing 20 would be a different one.
  assert.equal(reconcileOxygen({ packetEntityId: 99, botEntityId: null, reported: 3, lastOwn: 15 }), 15)
  assert.equal(reconcileOxygen({ packetEntityId: null, botEntityId: 7, reported: 3, lastOwn: null }), null)
})

test('end to end: a fish swims past a drowning-free bot', () => {
  // The guard runs AFTER mineflayer's handler, so it sees what the library just
  // wrote. This fake reproduces that ordering exactly.
  const client = new EventEmitter()
  const bot = { _client: client, entity: { id: 7 }, oxygenLevel: 20 }
  // mineflayer's handler, transcribed: writes from whoever spoke, unguarded.
  client.on('entity_metadata', p => { if (p.air != null) bot.oxygenLevel = p.air })
  installOxygenGuard(bot)

  client.emit('entity_metadata', { entityId: 7, air: 20 })   // the bot, breathing
  assert.equal(bot.oxygenLevel, 20)

  client.emit('entity_metadata', { entityId: 99, air: 2 })   // a cod, suffocating
  assert.equal(bot.oxygenLevel, 20,
    "the fish's 2 bubbles must not seize this bot's body")

  client.emit('entity_metadata', { entityId: 7, air: 5 })    // the bot, genuinely low
  assert.equal(bot.oxygenLevel, 5, 'a real drowning must still get through')

  client.emit('entity_metadata', { entityId: 42, air: 20 })  // a squid, fine
  assert.equal(bot.oxygenLevel, 5,
    'and a comfortable neighbour must not cancel a real drowning either')
})

test('the guard can be removed', () => {
  const client = new EventEmitter()
  const bot = { _client: client, entity: { id: 7 }, oxygenLevel: 20 }
  client.on('entity_metadata', p => { if (p.air != null) bot.oxygenLevel = p.air })
  const g = installOxygenGuard(bot)
  g.stop()
  client.emit('entity_metadata', { entityId: 99, air: 1 })
  assert.equal(bot.oxygenLevel, 1, 'stop() really detaches, so the test above proves the guard')
})
