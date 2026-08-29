// AIR THAT CANNOT BE OVERWRITTEN BY A FISH.
//
// `bot.oxygenLevel` is written from the `air_supply` metadata of ANY nearby
// entity. Confirmed, three fixes failed, reverted. Every threshold built on it
// has been measuring the local wildlife in part. This model derives air from
// the bot's own head block and a clock, which no other entity can touch.
import assert from 'node:assert'
import { V, AIR, WATER, STONE } from './helpers/microworld.mjs'
import { breathable, headIsBreathable, makeAirClock, airEmergency,
         MAX_AIR_SECONDS, CRITICAL_SECONDS } from '../src/air.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const botWithHead = block => ({
  entity: { position: new V(0, 64, 0) },
  blockAt: p => (p.y === 65 ? block : STONE),
})

// --- what counts as breathable -------------------------------------------

t('air is breathable, water is not', () => {
  assert.equal(breathable(AIR), true)
  assert.equal(breathable(WATER), false)
})

t('kelp and seagrass are NOT air, however empty they look', () => {
  // boundingBox 'empty' and not named water — the exact shape that let a head
  // underwater read as afloat.
  for (const name of ['kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']) {
    assert.equal(breathable({ name, boundingBox: 'empty' }), false, name)
  }
})

t('a waterlogged block is not breathable, and unknown ones count as wet', () => {
  const wet = { name: 'stone_brick_slab', boundingBox: 'empty',
                getProperties: () => ({ waterlogged: 'true' }) }
  const dry = { name: 'stone_brick_slab', boundingBox: 'empty',
                getProperties: () => ({ waterlogged: 'false' }) }
  assert.equal(breathable(wet), false)
  assert.equal(breathable(dry), true, 'a dry slab must not be called wet')
})

t('a bubble column is water, not air', () => {
  assert.equal(breathable({ name: 'bubble_column', boundingBox: 'empty' }), false)
})

t('a solid block is not breathable either — that is suffocation, not air', () => {
  assert.equal(breathable(STONE), false)
})

// --- the clock ------------------------------------------------------------

t('air drains only while the head is under, and refills on surfacing', () => {
  const clock = makeAirClock()
  const under = botWithHead(WATER)
  let now = 1000
  clock.update(under, now)
  assert.equal(clock.seconds, MAX_AIR_SECONDS, 'first sample establishes the baseline')
  now += 4000; clock.update(under, now)
  assert.ok(Math.abs(clock.seconds - (MAX_AIR_SECONDS - 4)) < 0.01,
    `expected ~${MAX_AIR_SECONDS - 4}s, got ${clock.seconds}`)
  now += 1000; clock.update(botWithHead(AIR), now)
  assert.equal(clock.seconds, MAX_AIR_SECONDS, 'surfacing refills')
})

t('air never goes negative', () => {
  const clock = makeAirClock()
  const under = botWithHead(WATER)
  clock.update(under, 0)
  clock.update(under, 999_000)
  assert.equal(clock.seconds, 0)
})

t('a bot standing in air never loses any', () => {
  const clock = makeAirClock()
  const dry = botWithHead(AIR)
  clock.update(dry, 0); clock.update(dry, 60_000)
  assert.equal(clock.seconds, MAX_AIR_SECONDS)
})

t('the clock reads the HEAD, not the feet', () => {
  // Feet in water with the head out is floating, and must not drain.
  const floating = {
    entity: { position: new V(0, 64, 0) },
    blockAt: p => (p.y === 65 ? AIR : WATER),
  }
  const clock = makeAirClock()
  clock.update(floating, 0); clock.update(floating, 10_000)
  assert.equal(clock.seconds, MAX_AIR_SECONDS)
  assert.equal(headIsBreathable(floating), true)
})

// --- what counts as an emergency -----------------------------------------

t('BEING WET IS NOT AN EMERGENCY', () => {
  // The whole point. Water is terrain; a bot travelling through it is fine.
  assert.equal(airEmergency({ headUnder: false, airSeconds: 0 }), false,
    'head above water is never an air emergency, whatever the clock says')
  assert.equal(airEmergency({ headUnder: true, airSeconds: MAX_AIR_SECONDS }), false,
    'submerged with a full breath is swimming, not drowning')
})

t('a submerged bot that is CLOSING ON AIR is left alone', () => {
  // It is already solving the problem. Seizing it destroys the solution — that
  // is how 231 crossings became 11.
  assert.equal(airEmergency({ headUnder: true, airSeconds: 1, closingOnAir: true }), false)
  assert.equal(airEmergency({ headUnder: true, airSeconds: 1, closingOnAir: false }), true)
})

t('critical air with no progress IS an emergency', () => {
  assert.equal(airEmergency({ headUnder: true, airSeconds: CRITICAL_SECONDS - 0.1 }), true)
  assert.equal(airEmergency({ headUnder: true, airSeconds: CRITICAL_SECONDS + 0.1 }), false)
})

t('falling health while submerged acts earlier than the critical line', () => {
  // Damage is ground truth: it means the model is already wrong.
  assert.equal(airEmergency({ headUnder: true, airSeconds: 4, healthFalling: true }), true)
  assert.equal(airEmergency({ headUnder: true, airSeconds: 4, healthFalling: false }), false)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
