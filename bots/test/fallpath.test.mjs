// fallpath.mjs, pure: the drop profile of a planned path (landings read at planning time, the planner's own policy)
// and its one-line description.
import assert from 'node:assert/strict'
import { pathDropProfile, describeFallPath, WALK_MAX_DROP } from '../src/fallpath.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const WATER = { name: 'water', liquid: true }, LAVA = { name: 'lava', liquid: true }, STONE = { name: 'stone', boundingBox: 'block' }, AIR = { name: 'air', boundingBox: 'empty' }
t('a flat walk and a one-block slope are not drops', () => {
  const p = pathDropProfile([{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }, { x: 2, y: 63, z: 0 }, { x: 3, y: 62, z: 0 }], () => STONE)
  assert.equal(p.steps, 3); assert.equal(p.maxDrop, 0); assert.deepEqual(p.drops, []); assert.equal(p.deepDrops, 0)
})
t('a 40-block drop onto water is deep and liquid; a 3-block drop onto stone is shallow and solid; lava counts as liquid; the policy is the planner\'s', () => {
  const at = (x, y, z) => (y === 30 ? WATER : y === 61 ? STONE : y === 50 ? LAVA : AIR)
  const p = pathDropProfile([{ x: 0, y: 70, z: 0 }, { x: 1, y: 30, z: 0 }, { x: 2, y: 30, z: 0 }, { x: 3, y: 64, z: 0 }, { x: 4, y: 61, z: 0 }, { x: 5, y: 50, z: 0 }], at, { maxDrop: 6 })
  assert.equal(p.maxDrop, 40); assert.equal(p.liquidLandings, 2); assert.equal(p.deepDrops, 2, '40 and 11 exceed 6; 3 does not'); assert.equal(p.policy, 6)
  assert.deepEqual(p.drops.map(d => [d.drop, d.land]), [[40, 'water'], [3, 'solid'], [11, 'lava']])
  assert.equal(WALK_MAX_DROP, 4, 'the library default, used only when no policy is given')
})
t('an unloaded landing is unknown, never dry; malformed nodes and a throwing reader never throw', () => {
  const p = pathDropProfile([{ x: 0, y: 70, z: 0 }, { x: 1, y: 60, z: 0 }], () => { throw new Error('unloaded') })
  assert.equal(p.steps, 1); assert.equal(p.maxDrop, 10); assert.equal(p.unknownLandings, 1); assert.equal(p.liquidLandings, 0); assert.equal(p.drops[0].land, '?')
  assert.equal(pathDropProfile(null).steps, 0); assert.equal(pathDropProfile([{ x: 0, y: 1, z: 0 }]).steps, 0)
  const q = pathDropProfile([{ x: 0, y: 70, z: 0 }, { x: 'a', y: 1, z: 0 }, { x: 1, y: 60, z: 0 }], () => STONE)
  assert.equal(q.steps, 0, 'both pairs touch the bad node and are skipped')
})
t('the description names age, whether the path ended and why, the policy, the drops with w/L/s/a/? marks, and the goal; no path says so', () => {
  const last = { t: 1000, status: 'partial', profile: 'gather', goal: '10,40,10', nodes: 6, maxDropDown: 6, liquidDropdown: true, active: false, endedBy: 'reset:goal_reached', endedAt: 3000,
    drops: { steps: 5, maxDrop: 12, policy: 6, deepDrops: 1, liquidLandings: 1, unknownLandings: 0, drops: [{ to: [1, 58, 0], drop: 12, land: 'water' }] } }
  const d = describeFallPath(last, { now: 4000 })
  assert.match(d, /^path 3s old, ended 1s ago by reset:goal_reached \(partial, 6 nodes, gather maxDropDown=6 liquidDrop=true\): max drop 12, 1 beyond 6, 1 onto liquid, 0 unknown \[12w@1,58,0\]; goal 10,40,10$/)
  assert.match(describeFallPath({ ...last, active: true }, { now: 4000 }), /still active/)
  assert.ok(d.length < 220, `under the row budget: ${d.length}`)
  assert.equal(describeFallPath(null), 'no planned path on record')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
