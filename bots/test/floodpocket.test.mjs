import assert from 'node:assert/strict'
import { oxygenFitsOperation, pocketPlan, pocketDone, BREATH_MS } from '../src/floodpocket.mjs'
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
  assert.equal(p.ok, true, p.why); assert.equal(p.need, 5); assert.equal(p.blocks, 7); assert.equal(p.timeMs, 5 * 6_000 + 5 * 800)
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
  assert.match(pocketPlan({ ...base, blocksHeld: 6 }).why, /need 7 placeable/)
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
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
