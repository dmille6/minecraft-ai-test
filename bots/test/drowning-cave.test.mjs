// DROWNING UNDER A CEILING.
//
// The drowning work on 2026-08-07 fixed three defects, all of them about
// DETECTION: a counter trusted over the world, water counted as a wall, and a
// rescue left behind a log throttle. After those, `reflex: drowning` fired
// correctly every time.
//
// Bots kept drowning anyway. On the rebuilt world, six deaths in forty minutes,
// and the coordinates say why:
//
//     Gather02  y=50      Miner01  y=56      Solo01  y=56
//     Gather02  y=49      Scout01  y=53      Solo01  y=48
//
// Sea level is 63. Every one was underground -- flooded caves, scattered across
// 125 blocks of x, so not one bad location either. The rescue held `jump`, which
// swims a bot up into a stone roof and holds it there. The reflex was right that
// the bot was drowning and wrong that up was an exit.
//
// Same shape as the other nine defects this repo documents: the remedy was
// selected from a PROXY ("head is in water", therefore up is air) instead of
// from the condition that decides whether the remedy can work at all.
import assert from 'node:assert'
import { breathableRoute, assessAir } from '../src/reflex.mjs'
import { makeBot, floodedCave, ocean, entombed } from './helpers/microworld.mjs'
import { Vec3 as V } from 'vec3'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// ---------------------------------------------------------------- open water
t('open ocean: up is an exit, so swim up', () => {
  const bot = makeBot({ blocks: ocean({ floor: 48, surface: 62 }), pos: new V(0, 50, 0), oxygen: 2 })
  const r = breathableRoute(bot)
  assert.equal(r.dir, 'up', `expected up, got ${r.dir}`)
})

t('open ocean: the route is the surface, not some sideways detour', () => {
  const bot = makeBot({ blocks: ocean({ floor: 48, surface: 62 }), pos: new V(0, 50, 0), oxygen: 2 })
  const r = breathableRoute(bot)
  assert.ok(r.target.y >= 62, `air should be at/above the surface, got y=${r.target.y}`)
})

// ------------------------------------------------------------- flooded cave
t('flooded cave: up is NOT an exit', () => {
  const bot = makeBot({ blocks: floodedCave({ floor: 47, ceiling: 52, ventAt: null }),
                        pos: new V(0, 49, 0), oxygen: 2 })
  const r = breathableRoute(bot)
  assert.notEqual(r.dir, 'up', 'a stone roof must never be reported as an exit')
})

t('flooded cave with a vent: route is sideways, toward the air', () => {
  const bot = makeBot({ blocks: floodedCave({ floor: 47, ceiling: 52, ventAt: 4 }),
                        pos: new V(0, 49, 0), oxygen: 2 })
  const r = breathableRoute(bot)
  assert.equal(r.dir, 'out', `expected out, got ${r.dir}`)
  assert.equal(r.target.x, 4, `expected the vent at x=4, got x=${r.target.x}`)
})

t('flooded cave with a vent: distance is reported, so the caller can give up', () => {
  const bot = makeBot({ blocks: floodedCave({ ventAt: 4 }), pos: new V(0, 49, 0), oxygen: 2 })
  assert.equal(breathableRoute(bot).dist, 4)
})

t('sealed flooded cave: returns null rather than inventing an exit', () => {
  const bot = makeBot({ blocks: floodedCave({ ventAt: null }), pos: new V(0, 49, 0), oxygen: 2 })
  const r = breathableRoute(bot)
  assert.equal(r.dir, null, `sealed water must report null, got ${r.dir}`)
})

t('a vent beyond scan range is not claimed as reachable', () => {
  const bot = makeBot({ blocks: floodedCave({ ventAt: 40 }), pos: new V(0, 49, 0), oxygen: 2 })
  assert.equal(breathableRoute(bot, { maxOut: 8 }).dir, null)
})

// ------------------------------------------ the detection half still stands
t('a drowning bot in a cave is still DETECTED as drowning', () => {
  const bot = makeBot({ blocks: floodedCave({ ventAt: 4 }), pos: new V(0, 49, 0), oxygen: 2 })
  const air = assessAir(bot)
  assert.equal(air.losing, true)
  assert.equal(air.kind, 'drowning')
  assert.equal(air.act, 'swim')
})

t('entombed in stone is suffocating, not drowning -- no route lookup applies', () => {
  const bot = makeBot({ blocks: entombed({ at: new V(0, 40, 0) }), pos: new V(0, 40, 0), oxygen: 1, health: 18 })
  const air = assessAir(bot)
  assert.equal(air.kind, 'suffocating')
})

// ---------------------------------------------------------------- stability
t('a bot with full air asks nothing of the router', () => {
  const bot = makeBot({ blocks: ocean(), pos: new V(0, 50, 0), oxygen: 300 })
  assert.equal(assessAir(bot).losing, false)
})

t('route lookup never throws on a disconnected bot', () => {
  assert.doesNotThrow(() => breathableRoute({}))
  assert.doesNotThrow(() => breathableRoute({ entity: null }))
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
