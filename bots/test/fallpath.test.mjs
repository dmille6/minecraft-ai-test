// fallpath.mjs, pure: the drop profile of a planned path (landings read at planning time, the planner's own policy)
// and its one-line description.
import assert from 'node:assert/strict'
import { pathDropProfile, describeFallPath, composeFallRow, markPathEnded, WALK_MAX_DROP, ROW_BUDGET } from '../src/fallpath.mjs'
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
  assert.equal(p.maxDrop, 40); assert.equal(p.liquidLandings, 2); assert.equal(p.waterLandings, 1); assert.equal(p.lavaLandings, 1); assert.equal(p.deepDrops, 2, '40 and 11 exceed 6; 3 does not'); assert.equal(p.policy, 6)
  assert.equal(pathDropProfile([{ x: 0, y: 70, z: 0 }, { x: 1, y: 60, z: 0 }], () => ({ name: 'magma_block', boundingBox: 'block' })).drops[0].land, 'solid', 'magma is a solid block, not lava')
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
    drops: { steps: 5, maxDrop: 12, policy: 6, deepDrops: 1, liquidLandings: 1, waterLandings: 1, lavaLandings: 0, unknownLandings: 0, drops: [{ to: [1, 58, 0], drop: 12, land: 'water' }] } }
  const d = describeFallPath(last, { now: 4000 })
  assert.match(d, /^path 3s old, ended by reset:goal_reached 1s ago \(partial 6n gather mdd=6 liqdrop=true\): max 12, 1>6, water 1, lava 0, unk 0 \[12w@1,58,0\]; goal 10,40,10$/)
  assert.match(describeFallPath({ ...last, active: true }, { now: 4000 }), /still active/)
  assert.ok(d.length < 220, `under the row budget: ${d.length}`)
  assert.equal(describeFallPath(null), 'no planned path on record')
})
t('markPathEnded ends a record once with the first terminal event and is a no-op afterwards or on nothing', () => {
  const rec = { t: 0, active: true }
  assert.equal(markPathEnded(rec, 'goal_reached', 500), rec); assert.equal(rec.active, false); assert.equal(rec.endedBy, 'goal_reached'); assert.equal(rec.endedAt, 500)
  markPathEnded(rec, 'reset:stuck', 900); assert.equal(rec.endedBy, 'goal_reached', 'the first terminal event wins')
  assert.equal(markPathEnded(null, 'x'), null)
})
t('composeFallRow puts the evidence first, labels a damage row as a candidate, states the descent association, and never exceeds the budget', () => {
  const last = { t: 1000, status: 'success', profile: 'walk', goal: '300,40,300', nodes: 12, maxDropDown: 6, liquidDropdown: true, active: false, endedBy: 'reset:stuck', endedAt: 3000,
    drops: { steps: 11, maxDrop: 38, policy: 6, deepDrops: 1, liquidLandings: 1, waterLandings: 1, lavaLandings: 0, unknownLandings: 0, drops: [{ to: [305, 30, 300], drop: 38, land: 'water' }] } }
  const r = composeFallRow({ kind: 'damage', fell: 37, dHealth: -9.5, last, descentAt: 3000, pathActiveAtDescent: false, skill: 'explore', controls: 'forward+jump', feet: 'air', head: 'air', now: 4000 })
  assert.equal(r, 'candidate damage: fell 37, hp -9.5; descent 1s ago: path none; path 3s old, ended by reset:stuck 1s ago (success 12n walk mdd=6 liqdrop=true): max 38, 1>6, water 1, lava 0, unk 0 [38w@305,30,300]; goal 300,40,300; running explore; ctl forward+jump; feet air head air')
  assert.ok(r.length <= ROW_BUDGET)
  const d = composeFallRow({ kind: 'death', cause: 'fall', fell: 40, last: null, pathActiveAtDescent: null, skill: null, now: 4000 })
  assert.equal(d, 'death (fall): fell 40; descent: path unknown; no planned path on record; idle; ctl ?; feet ? head ?')
  const long = composeFallRow({ kind: 'damage', fell: 9, last: { ...last, goal: 'G'.repeat(120), endedBy: 'reset:' + 'x'.repeat(80) }, pathActiveAtDescent: true, descentAt: 3900, controls: 'c'.repeat(200), feet: 'f'.repeat(50), head: 'h'.repeat(50), now: 4000 })
  assert.ok(long.length <= ROW_BUDGET, `budget: ${long.length}`); assert.ok(long.startsWith('candidate damage: fell 9; descent 0s ago: path ACTIVE'), 'evidence survives, the tail is what truncates'); assert.ok(long.endsWith('~'))
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
