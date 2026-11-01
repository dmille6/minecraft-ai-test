// EMPTYING: the half that did not exist, and the half that makes water a TOOL.
//
// The fleet spends ~47% of its telemetry reacting to water -- 10,231 drowning
// reflex fires, 12,462 float events, and the two bots still immobile are sealed
// in water, not stone. A full bucket is the first thing this fleet has ever had
// that ACTS on water instead of fleeing it.
//
// Behaviour tests on the exported decisions, because a source grep here would
// match the comment that explains the code.
import assert from 'node:assert'
import { emptyTakes, emptyRefusal, emptyAims, emptySucceeded, REACH } from '../src/bucket.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const B = (name, extra = {}) => ({ name, boundingBox: 'block', metadata: 0, ...extra })
const AIR = { name: 'air', boundingBox: 'empty', metadata: 0 }
const SOURCE = { name: 'water', boundingBox: 'empty', metadata: 0 }
const FLOWING = { name: 'water', boundingBox: 'empty', metadata: 3 }

// --- what a cell must be to take a pour ------------------------------------

t('air takes it', () => assert.equal(emptyTakes(AIR), true))

t('A SOURCE BLOCK DOES NOT -- MC-181499', () => {
  // A bucket does not empty into an existing source. Aiming at one wastes the
  // attempt and reads as "nothing happened", which is indistinguishable from a
  // broken bucket.
  assert.equal(emptyTakes(SOURCE), false)
})

t('flowing water does, because it is replaceable', () => {
  assert.equal(emptyTakes(FLOWING), true)
})

t('lava does not', () => assert.equal(emptyTakes(B('lava', { boundingBox: 'empty' })), false))

t('a solid block does not', () => {
  for (const n of ['stone', 'dirt', 'oak_log']) assert.equal(emptyTakes(B(n)), false, n)
})

t('grass and ferns DO -- most of a forest floor is not "air"', () => {
  // `=== air` rejecting these cost this fleet its first tech-tree stall in a
  // different function; the same mistake must not be re-made here.
  for (const n of ['short_grass', 'fern', 'snow', 'dead_bush']) {
    assert.equal(emptyTakes({ name: n, boundingBox: 'empty', metadata: 0 }), true, n)
  }
})

t('a null cell is never poured into', () => assert.equal(emptyTakes(null), false))

// --- the refusal chain -------------------------------------------------------

t('no bucket is the first and cheapest refusal', () => {
  assert.equal(emptyRefusal({ hasWaterBucket: false, target: AIR, distance: 1 }), 'no water bucket')
})

t('out of reach is refused, and names the numbers', () => {
  const why = emptyRefusal({ hasWaterBucket: true, target: AIR, distance: REACH + 0.1 })
  assert.match(why, /out of reach/)
  assert.match(why, new RegExp(String(REACH)))
})

t('within reach is allowed', () => {
  assert.equal(emptyRefusal({ hasWaterBucket: true, target: AIR, distance: REACH }), null)
})

t('IT WILL NOT POUR INTO THE CELL IT IS STANDING IN', () => {
  // Manufacturing water around your own head is not "water is terrain", it is
  // drowning yourself on purpose.
  const target = { ...AIR, position: { x: 5, y: 64, z: 5 } }
  const why = emptyRefusal({ hasWaterBucket: true, target, distance: 0.5,
                             standingIn: { x: 5, y: 64, z: 5 } })
  assert.match(why, /standing in/)
})

t('...but pouring one block away is fine', () => {
  const target = { ...AIR, position: { x: 6, y: 64, z: 5 } }
  assert.equal(emptyRefusal({ hasWaterBucket: true, target, distance: 1.2,
                              standingIn: { x: 5, y: 64, z: 5 } }), null)
})

t('an existing source is refused with a reason, not a generic failure', () => {
  assert.match(emptyRefusal({ hasWaterBucket: true, target: SOURCE, distance: 1 }),
    /already a water source/)
})

t('lava is refused explicitly', () => {
  assert.match(emptyRefusal({ hasWaterBucket: true, target: B('lava', { boundingBox: 'empty' }), distance: 1 }),
    /lava/)
})

// --- aiming ------------------------------------------------------------------

t('it aims INSIDE the cell, and low first', () => {
  const aims = emptyAims({ x: 10, y: 64, z: -3 })
  assert.ok(aims.length >= 3, 'a single aim is not enough; every working implementation retries')
  for (const a of aims) {
    assert.ok(a.x > 10 && a.x < 11, `x ${a.x} outside the block`)
    assert.ok(a.y >= 64 && a.y < 65, `y ${a.y} outside the block`)
    assert.ok(a.z > -3 && a.z < -2, `z ${a.z} outside the block`)
  }
  assert.ok(aims[0].y < 64.5, 'biased LOW so the source lands in this cell, not the one above')
})

// --- verification ------------------------------------------------------------

t('success needs BOTH the water and the emptied bucket', () => {
  assert.equal(emptySucceeded({ blockNow: SOURCE, heldNow: 'bucket' }), true)
})

t('water appearing WITHOUT the bucket emptying is not success', () => {
  // Flowing water arriving from elsewhere fires the same block update. This is
  // the lie the scoop half already guards against.
  assert.equal(emptySucceeded({ blockNow: SOURCE, heldNow: 'water_bucket' }), false)
})

t('an emptied bucket over a dry cell is not success either', () => {
  assert.equal(emptySucceeded({ blockNow: AIR, heldNow: 'bucket' }), false)
})

t('missing readings are never success', () => {
  assert.equal(emptySucceeded({}), false)
  assert.equal(emptySucceeded({ blockNow: null, heldNow: null }), false)
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
