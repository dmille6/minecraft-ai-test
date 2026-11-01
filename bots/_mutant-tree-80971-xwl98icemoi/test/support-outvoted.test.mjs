// FOUR BOTS FROZE FOR HOURS BECAUSE THEIR OWN WORLD MODEL LIED ABOUT THE FLOOR.
//
// mineflayer's finishDigging writes AIR into the client's world on a TIMER with
// no server acknowledgement (digging.js:158; there is no acknowledge handler
// anywhere in the library), and there is no API to re-read a block. So a dig the
// server refused leaves the client believing air permanently.
//
// Measured 2026-09-08. The server says the cell under these bots is diorite or
// oak_log. Their own code says "nothing solid underfoot". They can see 24-46
// blocks around them, so chunk data is loaded and a null read is ruled out.
//
// The proof is the position packets: hive-a-Bravo takes 67 inbound per 10s
// against a fleet norm of 0-1 (moving bots: median 0, p90 1, max 1). That is a
// closed loop -- the client thinks the floor is air, physics tries to fall, the
// server refuses and stomps it back, 67 times every ten seconds. A bot being
// continuously corrected is a bot standing on something.
import assert from 'node:assert'
import test from 'node:test'
import { supportProbablyReal, restingOnBoundary, STOMP_POS_PKTS } from '../src/scaffold.mjs'

test('a solid cache reading is respected unchanged', () => {
  // The overwhelmingly common case must not change at all.
  const r = supportProbablyReal({ cachedSolid: true, posPkts: 0, restingY: true })
  assert.equal(r.real, true)
  assert.match(r.why, /cache says solid/)
  assert.equal(supportProbablyReal({ cachedSolid: true, posPkts: 999, restingY: false }).real, true)
})

test('cache says air and nothing contradicts it: still refuses', () => {
  // POSITIVE CONTROL for the whole file. If this passed, the change would be
  // "always dig", which is a different and much worse feature.
  const r = supportProbablyReal({ cachedSolid: false, posPkts: 0, restingY: true })
  assert.equal(r.real, false)
  assert.match(r.why, /nothing contradicts/)
})

test('the real case: air in cache, server holding the bot up', () => {
  const r = supportProbablyReal({ cachedSolid: false, posPkts: 67, restingY: true })
  assert.equal(r.real, true)
  assert.match(r.why, /server is holding it up \(67/)
})

test('restingOnBoundary is cache-free — it reads the entity position, not a block', () => {
  // The signal that says "not falling" must NOT come from the block cache, or
  // the poisoned source referees its own reliability. Feet exactly on a block
  // boundary is a resting bot; anything between is falling or mid-step.
  assert.equal(restingOnBoundary(94.0), true)
  assert.equal(restingOnBoundary(100.000000), true)
  assert.equal(restingOnBoundary(94.4), false, 'mid-fall')
  assert.equal(restingOnBoundary(195.5), false, 'standing on a slab is not a boundary')
  // 1e-6 is the epsilon `supportCell` already uses in this repo, and the tight
  // one is deliberate HERE: excluding a float-error case only means refusing,
  // which is the status quo, while a loose epsilon could overrule the cache for
  // a bot that is genuinely falling. The frozen bots sit at exactly 94.000000
  // and 100.0, so 1e-6 covers the population this was built for.
  assert.equal(restingOnBoundary(196.99999), false, '1e-5 of drift is outside the epsilon')
  assert.equal(restingOnBoundary(196.9999995), true, 'but 5e-7 is inside it')
  for (const junk of [null, undefined, NaN, 'x', {}]) {
    assert.equal(restingOnBoundary(junk), false, String(junk))
  }
})

test('BOTH conditions are required — a falling bot is never overruled', () => {
  // A high packet rate while genuinely descending is a bot being corrected
  // MID-FALL. Digging then is the wrong move, and this is the assertion that
  // keeps the change from becoming "dig whenever the server is chatty".
  assert.equal(supportProbablyReal({ cachedSolid: false, posPkts: 999, restingY: false }).real, false)
  assert.equal(supportProbablyReal({ cachedSolid: false, posPkts: 67, restingY: false }).real, false)
})

test('the threshold sits between the measured norm and the measured pathology', () => {
  // Never type a cutoff. Fleet norm 0-1, frozen bots 30-67.
  assert.equal(STOMP_POS_PKTS, 8)
  const at = n => supportProbablyReal({ cachedSolid: false, posPkts: n, restingY: true }).real
  assert.equal(at(0), false, 'the fleet norm must never trip it')
  assert.equal(at(1), false, 'nor the observed maximum for a moving bot')
  assert.equal(at(7), false)
  assert.equal(at(8), true, 'the boundary is inclusive')
  assert.equal(at(30), true, 'board-d-Delta')
  assert.equal(at(67), true, 'hive-a-Bravo')
})

test('a missing or junk packet count never overrules the cache', () => {
  // If the witness is not attached the counter is null, and absence of evidence
  // must not read as evidence of support.
  for (const p of [null, undefined, NaN, 'lots', {}]) {
    assert.equal(supportProbablyReal({ cachedSolid: false, posPkts: p, restingY: true }).real,
      false, String(p))
  }
  assert.equal(supportProbablyReal({}).real, false)
  assert.equal(supportProbablyReal().real, false)
})

test('it only ever turns a refusal into an attempt, never the reverse', () => {
  // The safety property. For every input where the cache says SOLID, the answer
  // must be real:true -- this change can never introduce a new refusal.
  for (const posPkts of [0, 1, 8, 67, null]) {
    for (const restingY of [true, false]) {
      assert.equal(supportProbablyReal({ cachedSolid: true, posPkts, restingY }).real, true,
        `cachedSolid must always pass (${posPkts}, ${restingY})`)
    }
  }
})

test('WIRING: the call site reads the witness the way the witness is shaped', () => {
  // THE TEST THAT WAS MISSING, THREE TIMES RUNNING. Every assertion above feeds
  // supportProbablyReal a number directly, so all of them passed while the call
  // site read `.posPackets` off a FUNCTION and got undefined. The pure function
  // was never the bug; the wiring was, and hand-built inputs cannot reach it.
  //
  // attachPacketWitness returns `() => ({posPackets, physicsTicks, blockChanges})`.
  const witness = () => ({ posPackets: 67, physicsTicks: 177, blockChanges: 0 })
  const bot = { packetWitness: witness }

  assert.equal(bot.packetWitness?.posPackets, undefined,
    'reading it as a property is undefined — this is the bug being guarded')
  assert.equal(bot.packetWitness?.()?.posPackets, 67,
    'it must be CALLED')

  // And the decision must come out right when read correctly.
  assert.equal(supportProbablyReal({
    cachedSolid: false,
    posPkts: bot.packetWitness?.()?.posPackets ?? null,
    restingY: true,
  }).real, true)

  // A bot with no witness attached must still refuse, never crash.
  assert.equal(supportProbablyReal({
    cachedSolid: false,
    posPkts: ({}).packetWitness?.()?.posPackets ?? null,
    restingY: true,
  }).real, false)
})
