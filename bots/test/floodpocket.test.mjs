import assert from 'node:assert/strict'
import { oxygenFitsOperation, pocketPlan, pocketDone, BREATH_MS, sideExit } from '../src/floodpocket.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const col = (n, digMs, extra = {}) => Array.from({ length: n }, (_, i) => ({ y: 45 + i, solid: true, digMs, inflowRisk: false, ...extra }))
t('oxygen per operation: a 6-s tooled dig fits one breath, a 37.5-s bare-hand dig never does, and the swim back counts', () => {
  assert.equal(oxygenFitsOperation({ oxygenLevel: 20, opMs: 6_000 }), true)
  assert.equal(oxygenFitsOperation({ oxygenLevel: 20, opMs: 37_500 }), false)
  assert.equal(oxygenFitsOperation({ oxygenLevel: 20, opMs: 9_000, swimBackMs: 3_000 }), false, '12 s > 75% of 15 s')
  assert.equal(oxygenFitsOperation({ oxygenLevel: 10, opMs: 6_000 }), false, 'half a lungful is 5.6 s of work')
  assert.equal(oxygenFitsOperation({ oxygenLevel: 0, opMs: 1 }), false); assert.equal(BREATH_MS, 15_000)
})
t('Delta-class pocket (pickaxe in hand, 5 stone cells at 6 s each, 12 blocks): feasible, priced', () => {
  const p = pocketPlan({ floorY: 44, feetY: 48, firstDryY: 50, columnCells: col(5, 6_000), blocksHeld: 12, toolInHand: true, oxygenLevel: 18 })
  assert.equal(p.ok, true, p.why); assert.equal(p.need, 5); assert.equal(p.blocks, 9); assert.equal(p.timeMs, 5 * 6_000 + 5 * 800)
})
t('Bravo-class pocket (no tool) is refused before anything moves, by name', () => {
  const p = pocketPlan({ floorY: 44, feetY: 48, firstDryY: 50, columnCells: col(5, 37_500), blocksHeld: 25, toolInHand: false, oxygenLevel: 20 })
  assert.equal(p.ok, false); assert.match(p.why, /no pickaxe/)
  const q = pocketPlan({ floorY: 44, feetY: 48, firstDryY: 50, columnCells: col(5, 37_500), blocksHeld: 25, toolInHand: true, oxygenLevel: 20 })
  assert.equal(q.ok, false); assert.match(q.why, /exceeds one breath/, 'a tool in hand does not make a 37.5-s dig fit')
})
t('every other refusal is named: no floor, no opening, too few blocks, inflow, the wall clock', () => {
  const base = { floorY: 44, feetY: 48, firstDryY: 50, columnCells: col(5, 6_000), blocksHeld: 12, toolInHand: true, oxygenLevel: 20 }
  assert.match(pocketPlan({ ...base, floorY: null }).why, /no floor/)
  assert.match(pocketPlan({ ...base, floorY: 40 }).why, /no floor/, 'a floor 8 below is out of reach (max 6)')
  assert.match(pocketPlan({ ...base, firstDryY: null }).why, /no dry opening/)
  assert.match(pocketPlan({ ...base, blocksHeld: 6 }).why, /need 9 placeable/)
  assert.match(pocketPlan({ ...base, columnCells: col(5, 6_000).map((c, i) => i === 2 ? { ...c, inflowRisk: true } : c) }).why, /y=47 would let liquid in/)
  assert.match(pocketPlan({ ...base, columnCells: col(41, 6_000), firstDryY: 86, blocksHeld: 60 }).why, /exceeds the 240-s budget/)
  assert.match(pocketPlan({ ...base, oxygenLevel: 0 }).why, /no air/)
})
t('done needs all four: rose >= 4, dry, breathing, supported', () => {
  const before = { x: 0, y: 44, z: 0, wet: true }
  assert.equal(pocketDone({ before, after: { x: 0, y: 49, z: 0, wet: false }, headBreathable: true, feetSupported: true }), true)
  assert.equal(pocketDone({ before, after: { x: 0, y: 47, z: 0, wet: false }, headBreathable: true, feetSupported: true }), false, 'only 3 up')
  assert.equal(pocketDone({ before, after: { x: 0, y: 49, z: 0, wet: true }, headBreathable: true, feetSupported: true }), false, 'still wet')
  assert.equal(pocketDone({ before, after: { x: 0, y: 49, z: 0, wet: false }, headBreathable: false, feetSupported: true }), false, 'not breathing')
  assert.equal(pocketDone({ before, after: { x: 0, y: 49, z: 0, wet: false }, headBreathable: true, feetSupported: false }), false, 'not standing')
})
// step 4b: the side exit
const STONE = { name: 'stone', boundingBox: 'block' }, AIR = { name: 'air', boundingBox: 'empty' }, WATER = { name: 'water', boundingBox: 'empty' }, LAVA = { name: 'lava', boundingBox: 'empty' }
// a pocket: floor y=44, water 45..48, air above 48; the pillar's own column (fx=0,fz=0) is solid up to 47 (feet in the water cell 48)
const pocket = (over = {}) => (x, y, z) => over[`${x},${y},${z}`] !== undefined ? over[`${x},${y},${z}`] : (x === 0 && z === 0 && y >= 45 && y <= 47) ? STONE : y <= 44 ? STONE : y <= 48 ? WATER : AIR
t('4b: picks the side with the shallowest floor, fills bottom-up to feet level, and names the seal cell', () => {
  const r = sideExit(pocket({ '1,47,0': STONE }), 0, 0, 48)
  assert.deepEqual(r, { n: [1, 0], fill: [48], seal: [0, 48, 0] }, 'east has a floor one below: one fill')
  const r2 = sideExit(pocket({ '-1,46,0': STONE }), 0, 0, 48)
  assert.deepEqual(r2, { n: [-1, 0], fill: [47, 48], seal: [0, 48, 0] }, 'west: two fills')
  assert.deepEqual(sideExit(pocket({ '1,47,0': STONE, '-1,46,0': STONE }), 0, 0, 48).n, [1, 0], 'fewest fills wins')
})
t('4b: refuses without headroom, with a floor deeper than two, with lava in the column, or unknown cells; and never picks a cell already solid at feet level', () => {
  assert.match(sideExit(pocket({ '1,47,0': STONE, '1,49,0': STONE, '-1,47,0': STONE, '-1,50,0': STONE, '0,47,1': STONE, '0,49,1': WATER, '0,47,-1': STONE, '0,50,-1': WATER }), 0, 0, 48).why, /no headroom/)
  assert.match(sideExit(pocket(), 0, 0, 48).why, /no side/, 'the pocket floor is four below feet: too deep everywhere')
  assert.match(sideExit(pocket({ '1,47,0': LAVA }), 0, 0, 48).why, /lava/)
  assert.match(sideExit(pocket({ '1,47,0': STONE, '1,48,0': { name: 'torch', boundingBox: 'empty' }, '-1,46,0': STONE, '-1,47,0': { name: 'oak_sign', boundingBox: 'empty' }, '0,47,1': { name: 'tall_seagrass', boundingBox: 'empty' }, '0,46,-1': { name: 'sea_pickle', boundingBox: 'empty' } }), 0, 0, 48).why, /not fillable/, 'a torch or a sign in the fill column is not assumed replaceable; seagrass is water-like and is')
  assert.match(sideExit(pocket({ '1,47,0': null, '-1,47,0': null, '0,47,1': null, '0,47,-1': null }), 0, 0, 48).why, /unknown/)
  const already = sideExit(pocket({ '1,48,0': STONE, '-1,46,0': STONE }), 0, 0, 48); assert.deepEqual(already.n, [-1, 0], 'east is solid at feet level (a wall): west with two fills')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
