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
t('blind step: the LINE as a whole may not kill the bot -- chained drops are capped by total fall damage', () => {
  const at = (over) => (x, y, z) => (over[`${x},${y},${z}`] !== undefined ? over[`${x},${y},${z}`] : y <= 63 ? STONE : AIR)
  // THE PER-STEP BOUND IS NOT A TOTAL. `feetY` is reassigned after every cell and the scan runs
  // ceil(7/0.5) = 14 samples, so nothing ever capped the DESCENT along a line: up to 14 x maxDrop.
  // That was harmless at maxDrop 3 for exactly one reason -- Minecraft fall damage is
  // (blocks - 3) half-hearts, so a 3-block drop costs ZERO and no chain of them can hurt. At 5
  // each landing costs 2 and TEN kill a 20 half-heart bot, so "bound 5" without a total would
  // admit a lethal staircase. These cases are that cap.
  //
  // A staircase of 4-block drops: each costs 1 half-heart, so the fifth exceeds the cap of 4.
  // The air must be carved from the SURFACE down to each new floor -- leaving stone above a step
  // makes the bot walk UP into it and the fixture measures nothing, which is how the first
  // version of this case passed while testing the opposite of its name.
  const stair = (drop, xs) => {
    const o = {}
    let f = 63 - drop                                  // floor of the first step
    for (const x of xs) { for (let y = 63; y > f; y--) o[`${x},${y},5`] = AIR; f -= drop }
    return o
  }
  const XS = [6, 7, 8, 9, 10, 11, 12]
  const rs = stepLineSafe(at(stair(4, XS)), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2)
  assert.equal(rs.safe, false, `a staircase of 4-block drops must refuse on accumulated damage: ${rs.why}`)
  assert.match(rs.why, /half-hearts of fall damage/, `refused for the right reason: ${rs.why}`)
  // ...but a SHORT chain inside the cap still walks: two 4-block drops = 2 half-hearts.
  const two4 = {}
  {
    let f = 59
    for (const x of [6, 7, 8]) for (let y = 63; y > f; y--) two4[`${x},${y},5`] = AIR
    f = 55
    for (const x of [9, 10, 11, 12]) for (let y = 63; y > f; y--) two4[`${x},${y},5`] = AIR
  }
  const r2 = stepLineSafe(at(two4), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2)
  assert.equal(r2.safe, true, `two four-block drops cost 2 half-hearts, inside the cap: ${r2.why}`)
  // The cap is a parameter and must be REACHABLE, or it is decoration.
  assert.equal(stepLineSafe(at(two4), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2, { maxFallHalfHearts: 1 }).safe, false,
               'a tighter cap refuses the same line')
  // A three-block staircase costs nothing however long it is -- the pre-existing behaviour, and
  // exactly why this cap was never needed at the old bound.
  const r3 = stepLineSafe(at(stair(3, XS)), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2)
  assert.equal(r3.safe, true, `chained THREE-block drops do zero damage and stay legal: ${r3.why}`)
})

t('blind step: the feet follow the floor -- a slope passes, three and four and five pass at the new bound, six refuses, a cliff refuses, water at any depth is a landing', () => {
  const at = (over) => (x, y, z) => (over[`${x},${y},${z}`] !== undefined ? over[`${x},${y},${z}`] : y <= 63 ? STONE : AIR)
  const slope = {}; for (let x = 6; x <= 12; x++) for (let y = 63; y > 63 - (x - 5); y--) slope[`${x},${y},5`] = AIR   // one block down per cell eastward
  assert.equal(stepLineSafe(at(slope), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2).safe, true, 'a staircase down is a walk')
  const drop3 = {}; for (let x = 8; x <= 12; x++) for (let dy = 0; dy <= 2; dy++) drop3[`${x},${63 - dy},5`] = AIR   // floor at 60: feet 64 -> 61, a fall of 3
  assert.equal(stepLineSafe(at(drop3), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2).safe, true, 'a three-block fall is allowed')
  // OWNER DECISION 2026-09-25: the bound is 5, not 3. A four-block drop is now a WALK.
  // Measured: 91.5% of refusals inside a boxed episode are drops, and the share of boxed
  // episodes with at least one admitted direction is 64.8% at a bound of 4, 80.6% at 5, 87.2%
  // at 6. This case used to assert the four-block refusal; that is the behaviour that changed.
  const drop4 = {}; for (let x = 8; x <= 12; x++) for (let dy = 0; dy <= 3; dy++) drop4[`${x},${63 - dy},5`] = AIR   // floor at 59: a fall of 4
  assert.equal(stepLineSafe(at(drop4), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2).safe, true, 'a four-block fall is now a walk (bound 5)')
  const drop5 = {}; for (let x = 8; x <= 12; x++) for (let dy = 0; dy <= 4; dy++) drop5[`${x},${63 - dy},5`] = AIR   // floor at 58: a fall of 5
  assert.equal(stepLineSafe(at(drop5), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2).safe, true, 'five is the boundary and is allowed')
  const drop6 = {}; for (let x = 8; x <= 12; x++) for (let dy = 0; dy <= 5; dy++) drop6[`${x},${63 - dy},5`] = AIR   // floor at 57: a fall of 6
  const r6 = stepLineSafe(at(drop6), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2)
  assert.equal(r6.safe, false, 'six is still refused'); assert.match(r6.why, /drop of 6 ahead \(limit 5\)/)
  // ...AND THE OLD BOUND IS STILL REACHABLE, so the parameter is real and not decoration.
  assert.equal(stepLineSafe(at(drop4), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2, { maxDrop: 3 }).safe, false,
               'passing maxDrop 3 restores the old refusal')
  const cliff = {}; for (let x = 8; x <= 12; x++) for (let dy = 0; dy <= 13; dy++) cliff[`${x},${63 - dy},5`] = AIR
  const rc = stepLineSafe(at(cliff), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2); assert.equal(rc.safe, false); assert.match(rc.why, /no floor within 12/); assert.ok(rc.at[0] >= 8, `named the cliff cell: ${rc.at}`)
  const pond = {}; for (let x = 8; x <= 12; x++) { for (let dy = 0; dy <= 5; dy++) pond[`${x},${63 - dy},5`] = AIR; for (let dy = 6; dy <= 8; dy++) pond[`${x},${63 - dy},5`] = WATER }
  assert.equal(stepLineSafe(at(pond), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2).safe, true, 'a six-block fall into water is a landing')
  const lavaAfterSlope = { ...slope, '12,57,5': LAVA }
  assert.equal(stepLineSafe(at(lavaAfterSlope), { x: 5.5, y: 64, z: 5.5 }, -Math.PI / 2).safe, false, 'the corridor rules still apply along the line (lava beside the slope refuses)')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
