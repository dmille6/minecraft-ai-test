// THE FIRST VERSION OF THIS GUARD WAS INERT FOR ITS ENTIRE LIFE.
//
// It assumed it ran AFTER mineflayer's entity_metadata handler, so it read the
// value the library had just written and put back the bot's own. But mineflayer
// injects its plugins on `setTimeout(() => bot.emit('inject_allowed'), 0)`
// (loader.js:134) -- a LATER tick than the createBot call that installs this.
// The guard therefore ran FIRST, wrote back a number mineflayer had not yet
// touched, and was then overwritten by the axolotl.
//
// The old test passed because IT registered the fake mineflayer handler first,
// encoding the one ordering that never happens. So every test here now runs in
// BOTH orderings, and the real one is named as such.
//
// Why it matters: air_supply is metadata index 1 for every entity type and
// mineflayer divides it by 15. A player's 300 ticks -> 20. An AXOLOTL's 6000 ->
// 400; a DOLPHIN's 4800 -> 320. Those are exactly the out-of-scale values in our
// telemetry, and they latch airMax = max(20, ...samples) to 400, putting the
// low-air threshold at 160 so a genuinely full 20 reads as critical forever.
import assert from 'node:assert'
import test from 'node:test'
import { EventEmitter } from 'node:events'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { installOxygenGuard, isOurPacket } = await import('../src/oxygen.mjs')

const AXOLOTL = 400   // 6000 air_supply / 15
const DOLPHIN = 320   // 4800 / 15
const PLAYER_FULL = 20

/**
 * @param realOrder true  -> guard registers FIRST, mineflayer second (production)
 *                  false -> mineflayer first (what the old test wrongly assumed)
 */
function fleet ({ realOrder = true } = {}) {
  const client = new EventEmitter()
  const bot = { _client: client, entity: { id: 7 }, oxygenLevel: PLAYER_FULL }
  // mineflayer's handler, transcribed from entities.js:494 -- unguarded.
  const mineflayer = p => { if (p.air != null) bot.oxygenLevel = p.air }
  if (realOrder) { installOxygenGuard(bot); client.on('entity_metadata', mineflayer) }
  else { client.on('entity_metadata', mineflayer); installOxygenGuard(bot) }
  return { bot, client }
}

test('an axolotl cannot set a bot to 400 — in EITHER handler order', () => {
  for (const realOrder of [true, false]) {
    const { bot, client } = fleet({ realOrder })
    client.emit('entity_metadata', { entityId: 7, air: PLAYER_FULL })
    assert.equal(bot.oxygenLevel, 20, `own reading kept (realOrder=${realOrder})`)
    client.emit('entity_metadata', { entityId: 99, air: AXOLOTL })
    assert.equal(bot.oxygenLevel, 20,
      `an axolotl's 400 must never land (realOrder=${realOrder}) — this is the case ` +
      `that latches airMax to 400 and makes full air read as drowning forever`)
    client.emit('entity_metadata', { entityId: 51, air: DOLPHIN })
    assert.equal(bot.oxygenLevel, 20, `nor a dolphin's 320 (realOrder=${realOrder})`)
  }
})

test('a REAL drowning still gets through, in either order', () => {
  for (const realOrder of [true, false]) {
    const { bot, client } = fleet({ realOrder })
    client.emit('entity_metadata', { entityId: 7, air: 5 })
    assert.equal(bot.oxygenLevel, 5,
      `the bot's own low reading must not be filtered (realOrder=${realOrder})`)
    client.emit('entity_metadata', { entityId: 99, air: PLAYER_FULL })
    assert.equal(bot.oxygenLevel, 5,
      `and a comfortable neighbour must not cancel it (realOrder=${realOrder})`)
  }
})

test('PRODUCTION ORDER SPECIFICALLY: guard first, mineflayer second', () => {
  // Named separately because this is the ordering that actually ships and the
  // one the previous implementation silently failed in.
  const { bot, client } = fleet({ realOrder: true })
  client.emit('entity_metadata', { entityId: 99, air: AXOLOTL })
  assert.notEqual(bot.oxygenLevel, AXOLOTL,
    'the guard must survive being registered before the thing it guards against')
})

test('before spawn nothing is accepted', () => {
  const client = new EventEmitter()
  const bot = { _client: client, entity: undefined, oxygenLevel: 20 }
  installOxygenGuard(bot)
  client.on('entity_metadata', p => { if (p.air != null) bot.oxygenLevel = p.air })
  client.emit('entity_metadata', { entityId: 99, air: AXOLOTL })
  assert.equal(bot.oxygenLevel, 20, 'with no bot entity, ownership cannot be established')
})

test('isOurPacket is exact', () => {
  assert.ok(isOurPacket({ packetEntityId: 7, botEntityId: 7 }))
  assert.ok(!isOurPacket({ packetEntityId: 99, botEntityId: 7 }))
  assert.ok(!isOurPacket({ packetEntityId: null, botEntityId: 7 }))
  assert.ok(!isOurPacket({ packetEntityId: 7, botEntityId: null }))
  assert.ok(!isOurPacket({ packetEntityId: 0, botEntityId: undefined }))
})

test('the scale is fixed, and a violation raises instead of recalibrating', async () => {
  const { AIR_SCALE, outOfScale } = await import('../src/oxygen.mjs')
  assert.equal(AIR_SCALE, 20, "a player's 300 air ticks / 15 = 20 bubbles")
  assert.ok(!outOfScale(20), 'full air is in scale')
  assert.ok(!outOfScale(0), 'empty is in scale')
  assert.ok(outOfScale(DOLPHIN), 'a dolphin reading is proof the guard leaked')
  assert.ok(outOfScale(AXOLOTL), 'and so is an axolotl reading')
  assert.ok(!outOfScale(null) && !outOfScale(undefined) && !outOfScale(NaN),
    'absence is not a violation — it must not raise a false alarm')
})

test('the reflex no longer calibrates its threshold from observed samples', async () => {
  // The old code did `airMax = Math.max(20, ...airSamples)` over a rolling
  // two-minute window, so one axolotl put the low-air trigger at 160 and a
  // genuinely full 20 read as critical for that whole window. Measured before
  // the fix: 81% of critical-air events carried a denominator above 20.
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const src = fs.readFileSync(path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'reflex.mjs'), 'utf8')
  const exec = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/airMax\s*=\s*Math\.max\(20,\s*\.\.\.airSamples\)/.test(exec),
    'the self-calibrating latch must be gone from executable code')
  assert.match(exec, /const airMax = AIR_SCALE/, 'the scale is a constant')
  assert.match(exec, /outOfScale\(bot\.oxygenLevel\)/,
    'and an impossible reading raises rather than being absorbed')
})

test('assessAir behaves at both ends of the real scale', async () => {
  const { assessAir } = await import('../src/reflex.mjs')
  const mk = ox => ({
    oxygenLevel: ox, health: 20,
    entity: { position: { offset: () => ({}) }, isInWater: true },
    blockAt: () => ({ name: 'water', boundingBox: 'empty' }),
  })
  // Full air must NOT trip the reflex. This is the case that fired 74.2% of the
  // time with the head in open air before the scale was pinned.
  assert.equal(assessAir(mk(20), { airMax: 20 }).losing, false,
    'a bot at full air is not drowning, whatever else is true')
  // Genuinely low air still must.
  assert.equal(assessAir(mk(3), { airMax: 20 }).losing, true,
    'a real drain must still be caught — the point was never to silence the reflex')
})

test('stop() detaches — so the tests above prove the guard, not the fake', () => {
  const { bot, client } = fleet({ realOrder: true })
  bot.__oxygenGuard.stop()
  client.emit('entity_metadata', { entityId: 99, air: AXOLOTL })
  assert.equal(bot.oxygenLevel, AXOLOTL,
    'without the guard the axolotl wins — proving the guard is what stops it')
})
