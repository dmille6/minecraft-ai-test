import assert from 'node:assert/strict'
import { cellLavaSafe, cellSupported, corridorSafe, holdForwardSafe, lavaStandOff, dropLavaSafe, stepLineSafe } from '../src/lavaguard.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const STONE = { name: 'stone', boundingBox: 'block' }, AIR = { name: 'air', boundingBox: 'empty' }, LAVA = { name: 'lava', boundingBox: 'empty' }, WATER = { name: 'water', boundingBox: 'empty' }, MAGMA = { name: 'magma_block', boundingBox: 'block' }
// a flat stone world at y<=63, air above; overrides by "x,y,z"
const world = (over = {}) => (x, y, z) => (over[`${x},${y},${z}`] !== undefined ? over[`${x},${y},${z}`] : y <= 63 ? STONE : AIR)
t('a plain cell is safe and supported; lava beside, below, or unknown is not', () => {
  assert.equal(cellLavaSafe(world(), 5, 64, 5).safe, true); assert.equal(cellSupported(world(), 5, 64, 5), true)
  assert.match(cellLavaSafe(world({ '6,64,5': LAVA }), 5, 64, 5).why, /beside/)
  assert.match(cellLavaSafe(world({ '5,63,5': AIR, '5,62,5': LAVA }), 5, 64, 5).why, /below/)
  assert.match(cellLavaSafe(world({ '5,64,5': null }), 5, 64, 5).why, /unknown/)
  assert.equal(cellSupported(world({ '5,63,5': AIR, '5,62,5': AIR, '5,61,5': AIR }), 5, 64, 5), false, 'no floor within 3')
})
t('corridor: water and plain drops are terrain -- a swim leg and a four-block drop pass; lava five below an overhang refuses (the -08 false positive)', () => {
  const pond = {}; for (let x = 2; x <= 6; x++) for (let dy = 0; dy <= 6; dy++) pond[`${x},${63 - dy},5`] = WATER
  assert.equal(corridorSafe(world(pond), [{ x: 0.5, y: 64, z: 5.5 }, { x: 8.5, y: 64, z: 5.5 }]).safe, true, 'a leg across a pond is not refused')
  const shaft = {}; for (let dy = 0; dy <= 3; dy++) shaft[`4,${63 - dy},5`] = AIR
  assert.equal(corridorSafe(world(shaft), [{ x: 0.5, y: 64, z: 5.5 }, { x: 8.5, y: 64, z: 5.5 }]).safe, true, 'a four-deep shaft onto stone is a drop, not lava')
  const deep = {}; for (let dy = 0; dy <= 4; dy++) deep[`4,${63 - dy},5`] = AIR; deep['4,58,5'] = LAVA
  const r = corridorSafe(world(deep), [{ x: 0.5, y: 64, z: 5.5 }, { x: 8.5, y: 64, z: 5.5 }]); assert.equal(r.safe, false); assert.match(r.why, /lava below/); assert.deepEqual(r.at, [4, 58, 5])
  assert.equal(dropLavaSafe(world({ '4,63,5': null }), 4, 64, 5).safe, false, 'unknown within 3 is still unsafe')
  const far = {}; for (let dy = 0; dy <= 3; dy++) far[`4,${63 - dy},5`] = AIR; far['4,59,5'] = null
  assert.equal(dropLavaSafe(world(far), 4, 64, 5).safe, true, 'unknown beyond 3 is out of the loaded world, not lava')
  assert.equal(corridorSafe(world(), [{ x: 0.5, y: 64, z: 5.5 }, { x: 8.5, y: 64, z: 5.5 }]).why, undefined)
  const column = {}; for (let dy = 0; dy <= 5; dy++) column[`4,${63 - dy},5`] = WATER; column['4,57,5'] = MAGMA
  const c = dropLavaSafe(world(column), 4, 64, 5); assert.equal(c.safe, false, 'a bubble column over magma is refused: water does not end the scan'); assert.deepEqual(c.cell, [4, 57, 5])
  const landing = {}; for (let dy = 0; dy <= 3; dy++) landing[`4,${63 - dy},5`] = AIR; landing['5,60,5'] = LAVA
  const l = dropLavaSafe(world(landing), 4, 64, 5); assert.equal(l.safe, false, 'lava beside the landing cell of a four-block drop is refused'); assert.match(l.why, /beside/)
  const side = {}; for (let dy = 0; dy <= 3; dy++) side[`4,${63 - dy},5`] = AIR; side['4,61,6'] = LAVA
  const sd = dropLavaSafe(world(side), 4, 64, 5); assert.equal(sd.safe, false, 'lava beside an intermediate fall cell is refused'); assert.deepEqual(sd.cell, [4, 61, 6])
  const chasm = {}; for (let dy = 0; dy <= 14; dy++) chasm[`4,${63 - dy},5`] = AIR
  assert.equal(dropLavaSafe(world(chasm), 4, 64, 5).safe, true, 'no landing within reach: not this guard\'s call')
})
t('corridor: a leg over a ledge with lava two below fails at the sample, a leg across solid ground passes', () => {
  const pit = {}; for (let x = 3; x <= 5; x++) { pit[`${x},63,5`] = AIR; pit[`${x},62,5`] = LAVA }
  const r = corridorSafe(world(pit), [{ x: 0.5, y: 64, z: 5.5 }, { x: 8.5, y: 64, z: 5.5 }])
  assert.equal(r.safe, false); assert.match(r.why, /lava_corridor/); assert.ok(r.at[0] >= 2 && r.at[0] <= 6, `named the cell: ${r.at}`)
  assert.equal(corridorSafe(world(), [{ x: 0.5, y: 64, z: 5.5 }, { x: 8.5, y: 64, z: 5.5 }]).safe, true)
  assert.equal(corridorSafe(world({ '4,64,5': null }), [{ x: 0.5, y: 64, z: 5.5 }, { x: 8.5, y: 64, z: 5.5 }]).safe, false, 'unknown is unsafe')
  assert.equal(corridorSafe(world(), [{ x: 0.5, y: 64, z: 5.5 }]).safe, true, 'a one-node path is trivially safe')
})
t('the water hold: lava within three cells ahead (any of the three lateral cells, feet or below) refuses; behind does not', () => {
  const feet = { x: 5, y: 64, z: 5 }
  assert.equal(holdForwardSafe(world(), feet, [1, 0]).safe, true)
  assert.match(holdForwardSafe(world({ '8,64,6': LAVA }), feet, [1, 0]).why, /lava ahead/)
  assert.match(holdForwardSafe(world({ '7,63,5': LAVA }), feet, [1, 0]).why, /lava ahead/)
  assert.match(holdForwardSafe(world({ '7,64,5': null }), feet, [1, 0]).why, /unknown/)
  assert.equal(holdForwardSafe(world({ '2,64,5': LAVA }), feet, [1, 0]).safe, true, 'lava behind is not ahead')
  assert.equal(holdForwardSafe(world({ '8,64,5': LAVA }), feet, [0, 0]).safe, true, 'no push, no check')
})
t('stand-off: lava east retreats west onto verified ground; no lava means no move; lava all round or a cliff means no move with a reason', () => {
  const feet = { x: 5, y: 64, z: 5 }
  assert.deepEqual(lavaStandOff(world({ '6,64,5': LAVA }), feet).move, [-1, 0])
  assert.equal(lavaStandOff(world(), feet).move, null)
  const ring = { '6,64,5': LAVA, '4,64,5': LAVA, '5,64,6': LAVA, '5,64,4': LAVA }
  assert.equal(lavaStandOff(world(ring), feet).why, 'lava_adjacent_no_retreat')
  const cliff = { '6,64,5': LAVA, '4,63,5': AIR, '4,62,5': AIR, '4,61,5': AIR, '5,64,6': STONE, '5,64,4': STONE }
  assert.equal(lavaStandOff(world(cliff), feet).move, null, 'west is a cliff, north/south are walls: stay')
  assert.deepEqual(lavaStandOff(world({ '5,63,5': MAGMA }), feet).move[0] !== undefined, true, 'magma underfoot retreats somewhere')
})
t('blind step: the seven-block line along the heading is judged like a route, with prismarine-physics\'s yaw convention (0 = -z north, -pi/2 = +x east, pi/2 = -x west, pi = +z south)', () => {
  const pit = {}; for (let x = 7; x <= 9; x++) { pit[`${x},63,5`] = AIR; pit[`${x},62,5`] = LAVA }
  const east = stepLineSafe(world(pit), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2)
  assert.equal(east.safe, false); assert.match(east.why, /blind_step/); assert.ok(east.at[0] >= 6 && east.at[0] <= 9, `named the cell: ${east.at}`)
  assert.equal(stepLineSafe(world(pit), { x: 5.5, y: 64, z: 5.5 }, Math.PI / 2).safe, true, 'west is plain ground')
  assert.equal(stepLineSafe(world({ '5,64,2': LAVA }), { x: 5.5, y: 64, z: 5.5 }, 0).safe, false, 'yaw 0 walks north (-z): lava at z=2 is on the line')
  assert.equal(stepLineSafe(world({ '5,64,2': LAVA }), { x: 5.5, y: 64, z: 5.5 }, Math.PI).safe, true, 'yaw pi walks south (+z): the lava at z=2 is behind')
  assert.equal(stepLineSafe(world({ '5,64,9': LAVA }), { x: 5.5, y: 64, z: 5.5 }, Math.PI).safe, false, 'south: lava at z=9 is on the line')
  assert.equal(stepLineSafe(world({ '1,64,5': LAVA }), { x: 5.5, y: 64, z: 5.5 }, Math.PI / 2).safe, false, 'west: lava at x=1 is on the line')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
