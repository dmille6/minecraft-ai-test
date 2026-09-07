// A BUCKET REMOVES ONE BLOCK OF WATER. THE QUESTION IS WHETHER IT STAYS GONE.
//
// Minecraft reforms a source cell that touches two or more horizontal sources,
// and water falls into any hole from above without limit. Water spreads one
// block per five game ticks, so a wrong "yes" here buys 0.25 seconds and spends
// the only bucket the bot will ever have -- 3 iron ingots, against a fleet that
// holds 15 in total.
//
// Every published implementation of bucket-filling omits the source check
// (Voyager's and Odyssey's both call findBlock on 'water', which returns
// flowing water too, and flowing water cannot fill a bucket at all). And
// FILLING is unvalidated across the whole mineflayer ecosystem: every test that
// exists, including the maintainer's own, covers EMPTYING.
import assert from 'node:assert'
import test from 'node:test'
import {
  isWaterSource, scoopLeavesAir, scoopRefusal, scoopAims, scoopSucceeded,
  REFORM_SOURCES, REACH,
} from '../src/bucket.mjs'

const src = { name: 'water', metadata: 0 }
const flow = { name: 'water', metadata: 3 }
const air = { name: 'air' }
const stone = { name: 'stone' }
const lava = { name: 'lava', metadata: 0 }

test('a source is level 0; flowing water is not a source', () => {
  assert.equal(isWaterSource(src), true)
  assert.equal(isWaterSource(flow), false, 'flowing water cannot fill a bucket')
  assert.equal(isWaterSource(lava), false, 'lava is not water')
  assert.equal(isWaterSource(stone), false)
  assert.equal(isWaterSource(null), false)
  assert.equal(isWaterSource({ name: 'water' }), false, 'no metadata is not level 0')
})

test('a sealed pocket keeps its air — this is the only population', () => {
  assert.equal(scoopLeavesAir({ target: src, above: stone, cardinals: [stone, stone, stone, stone] }), true)
  assert.equal(scoopLeavesAir({ target: src, above: stone, cardinals: [src, stone, stone, stone] }), true,
    'one source neighbour is below the reform threshold')
})

test('two horizontal sources reform the cell', () => {
  assert.equal(REFORM_SOURCES, 2)
  assert.equal(scoopLeavesAir({ target: src, above: stone, cardinals: [src, src, stone, stone] }), false)
  assert.equal(scoopLeavesAir({ target: src, above: stone, cardinals: [src, src, src, src] }), false,
    'open water: the hole is gone in five ticks')
})

test('water overhead refills the hole whatever the sides say', () => {
  // Downward flow is unlimited. This is the case a sides-only check misses.
  assert.equal(scoopLeavesAir({ target: src, above: src, cardinals: [stone, stone, stone, stone] }), false)
  assert.equal(scoopLeavesAir({ target: src, above: flow, cardinals: [stone, stone, stone, stone] }), false)
  assert.equal(scoopLeavesAir({ target: src, above: lava, cardinals: [stone, stone, stone, stone] }), false)
})

test('it never says yes when it cannot tell', () => {
  // A wrong yes spends the bucket. Absence of evidence is not air.
  assert.equal(scoopLeavesAir({}), false)
  assert.equal(scoopLeavesAir(), false)
  assert.equal(scoopLeavesAir({ target: flow, above: stone, cardinals: [] }), false)
  assert.equal(scoopLeavesAir({ target: null, above: stone, cardinals: [] }), false)
})

test('POSITIVE CONTROL: the predicate can answer BOTH ways', () => {
  const yes = scoopLeavesAir({ target: src, above: stone, cardinals: [stone, stone, stone, stone] })
  const no = scoopLeavesAir({ target: src, above: stone, cardinals: [src, src, stone, stone] })
  assert.equal(yes, true)
  assert.equal(no, false)
})

test('the refusal names the reason, and lava is refused before anything else', () => {
  const ok = { hasEmptyBucket: true, target: src, above: stone,
               cardinals: [stone, stone, stone, stone], distance: 2 }
  assert.equal(scoopRefusal(ok), null, 'the clear case must actually be clear')
  assert.match(scoopRefusal({ ...ok, hasEmptyBucket: false }), /no empty bucket/)
  assert.match(scoopRefusal({ ...ok, target: lava }), /lava/,
    'a lava scoop hands the bot a lava_bucket it will later try to empty')
  assert.match(scoopRefusal({ ...ok, target: flow }), /flowing/)
  assert.match(scoopRefusal({ ...ok, target: stone }), /not water \(stone\)/)
  assert.match(scoopRefusal({ ...ok, distance: 6 }), /out of reach/)
  assert.match(scoopRefusal({ ...ok, cardinals: [src, src, stone, stone] }), /refill/)
  assert.match(scoopRefusal({ ...ok, target: null }), /nothing to scoop/)
})

test('reach matches the server, and the boundary is inclusive', () => {
  assert.equal(REACH, 4.5)
  const at = d => scoopRefusal({ hasEmptyBucket: true, target: src, above: stone,
                                 cardinals: [stone, stone, stone, stone], distance: d })
  assert.equal(at(4.5), null)
  assert.match(at(4.51), /out of reach/)
  assert.match(at(Infinity), /out of reach/)
  assert.match(at(NaN), /out of reach/, 'an unknown distance is not a permitted one')
})

test('aims are block-centred and ordered centre, high, low', () => {
  const a = scoopAims({ x: 10, y: 64, z: -5 })
  assert.equal(a.length, 3, 'a single aim fails often enough that every working impl retries')
  assert.deepEqual(a[0], { x: 10.5, y: 64.5, z: -4.5 })
  assert.ok(a[1].y > a[0].y && a[2].y < a[0].y)
  assert.ok(a.every(p => p.x === 10.5 && p.z === -4.5), 'only the height varies')
})

test('success needs the world AND the right item — either alone lies', () => {
  assert.equal(scoopSucceeded({ blockNow: air, gainedItem: 'water_bucket' }), true)
  assert.equal(scoopSucceeded({ blockNow: { name: 'cave_air' }, gainedItem: 'water_bucket' }), true)
  // Flowing water arriving in the hole fires the same blockUpdate a success
  // does. Verifying by event alone fabricates successes.
  assert.equal(scoopSucceeded({ blockNow: flow, gainedItem: 'water_bucket' }), false)
  assert.equal(scoopSucceeded({ blockNow: src, gainedItem: 'water_bucket' }), false)
  // "a bucket" is not "a water bucket": lava and fish variants exist and would
  // otherwise read as success.
  assert.equal(scoopSucceeded({ blockNow: air, gainedItem: 'lava_bucket' }), false)
  assert.equal(scoopSucceeded({ blockNow: air, gainedItem: 'cod_bucket' }), false)
  assert.equal(scoopSucceeded({ blockNow: air, gainedItem: 'bucket' }), false)
  assert.equal(scoopSucceeded({ blockNow: air, gainedItem: null }), false)
  assert.equal(scoopSucceeded({}), false)
})
