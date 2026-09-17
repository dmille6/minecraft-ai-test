// fallpath.mjs, pure: the drop profile of a planned path and its one-line description.
import assert from 'node:assert/strict'
import { pathDropProfile, describeFallPath, WALK_MAX_DROP } from '../src/fallpath.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const WATER = { name: 'water', liquid: true }, STONE = { name: 'stone' }, AIR = { name: 'air' }
t('a flat walk and a one-block slope are not drops', () => {
  const p = pathDropProfile([{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }, { x: 2, y: 63, z: 0 }, { x: 3, y: 62, z: 0 }], () => STONE)
  assert.equal(p.steps, 3); assert.equal(p.maxDrop, 0); assert.deepEqual(p.drops, []); assert.equal(p.deepDrops, 0)
})
t('a 40-block drop onto water is one drop, deep, with a liquid landing; a 3-block drop onto stone is shallow and dry', () => {
  const at = (x, y, z) => (y === 30 ? WATER : y === 61 ? STONE : AIR)
  const p = pathDropProfile([{ x: 0, y: 70, z: 0 }, { x: 1, y: 30, z: 0 }, { x: 2, y: 30, z: 0 }, { x: 3, y: 64, z: 0 }, { x: 4, y: 61, z: 0 }], at)
  assert.equal(p.maxDrop, 40); assert.equal(p.liquidLandings, 1); assert.equal(p.deepDrops, 1); assert.equal(p.drops.length, 2)
  assert.deepEqual(p.drops[0].to, [1, 30, 0]); assert.equal(p.drops[0].liquid, true); assert.equal(p.drops[1].drop, 3); assert.equal(p.drops[1].liquid, false)
  assert.equal(WALK_MAX_DROP, 4)
})
t('malformed nodes, an empty path, and a throwing block reader never throw', () => {
  assert.equal(pathDropProfile(null).steps, 0); assert.equal(pathDropProfile([{ x: 0, y: 1, z: 0 }]).steps, 0)
  const p = pathDropProfile([{ x: 0, y: 70, z: 0 }, { x: 'a', y: 1, z: 0 }, { x: 1, y: 60, z: 0 }], () => { throw new Error('unloaded') })
  assert.equal(p.steps, 0, 'both pairs touch the bad node and are skipped'); assert.equal(p.maxDrop, 0)
  const q = pathDropProfile([{ x: 0, y: 70, z: 0 }, { x: 1, y: 60, z: 0 }], () => { throw new Error('unloaded') })
  assert.equal(q.steps, 1); assert.equal(q.maxDrop, 10); assert.equal(q.liquidLandings, 0, 'an unreadable landing counts as dry, never throws')
})
t('the description names the age, status, profile, drops with a w for water, and the goal; no path says so', () => {
  const last = { t: 1000, status: 'partial', profile: 'gather', goal: '10,40,10', nodes: [] }
  const prof = { steps: 5, maxDrop: 12, deepDrops: 1, liquidLandings: 1, drops: [{ from: [0, 70, 0], to: [1, 58, 0], drop: 12, liquid: true }] }
  const d = describeFallPath(last, prof, { now: 4000 })
  assert.match(d, /last path 3s old \(partial, 5 steps, profile gather\): max drop 12, 1 beyond 4, 1 onto liquid \[12w@1,58,0\]; goal 10,40,10/)
  assert.equal(describeFallPath(null, prof), 'no planned path on record')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
