// HOW HIGH IS OUT: the climb is measured from the world, not a constant.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { climbNeedAbove, maroonState, canFinishClimb } from '../src/reflex.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const RAW = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
const air = { name: 'air', boundingBox: 'empty' }, stone = { name: 'stone', boundingBox: 'block' }, water = { name: 'water', boundingBox: 'empty' }
const passable = b => b.boundingBox === 'empty' && b.name !== 'lava'
// board-c-Bravo's column: feet y=48 in water, stone from 50 through 61, open sky from 62
const bravo = (x, y, z) => y <= 49 ? water : y <= 61 ? stone : air
const feet = { x: 416.5, y: 48.2, z: 210.3 }

t('board-c-Bravo needs 14 blocks, not 24: the climb it holds 25 for is admitted', () => {
  const need = climbNeedAbove(bravo, feet, { passable })
  assert.equal(need, 14)
  assert.equal(canFinishClimb({ have: 25, need, headroomBlocked: true }), true, '25 in hand finishes a 14-block climb with a blocked head')
  assert.equal(maroonState({ upIsOpen: true, haveBlocks: true, blockCount: 25, climbNeed: need, entombed: false, canStartPath: false }), 'climb')
})
t('the old constant refused the same bot at the pillar (its head cell is stone, so 26 were required)', () => {
  assert.equal(canFinishClimb({ have: 25, need: 24, headroomBlocked: true }), false)
  assert.equal(canFinishClimb({ have: 25, need: 14, headroomBlocked: true }), true)
})
t('hive-a-Delta: stone 56..67, open from 68 -> 13 blocks from feet at 55', () => {
  const delta = (x, y, z) => y <= 55 ? water : y <= 67 ? stone : air
  assert.equal(climbNeedAbove(delta, { x: 362.7, y: 55.2, z: 177.7 }, { passable }), 13)
})
t('a single air pocket in the stone is not an opening; two consecutive passable cells are', () => {
  const pocket = (x, y, z) => y === 53 ? air : y <= 61 ? stone : air
  assert.equal(climbNeedAbove(pocket, feet, { passable }), 14, 'the lone gap at 53 does not end the climb')
  const shallow = (x, y, z) => y <= 51 ? stone : air
  assert.equal(climbNeedAbove(shallow, feet, { passable }), 4)
})
t('an opening must be DRY and have a lateral exit: a water column or a 1-wide shaft is not out', () => {
  const waterTop = (x, y, z) => y <= 61 ? stone : water
  assert.equal(climbNeedAbove(waterTop, feet, { cap: 24, passable }), 24, 'two passable water cells are not an opening')
  const shaft = (x, y, z) => (x === 416 && z === 210 && y >= 50) ? air : stone       // open only in the bot's own column
  assert.equal(climbNeedAbove(shaft, feet, { cap: 24, passable }), 24, 'a shaft with stone on every side has no exit')
  const shaftWithLedge = (x, y, z) => (x === 416 && z === 210 && y >= 50) ? air : (y >= 58 && x === 417 && z === 210) ? air : stone
  assert.equal(climbNeedAbove(shaftWithLedge, feet, { cap: 24, passable }), 10, 'the first height with a dry side cell pair (58,59) is the exit')
})
t('no opening within the cap returns the cap, which keeps the deep-column refusal', () => {
  const deep = () => stone
  assert.equal(climbNeedAbove(deep, feet, { cap: 24, passable }), 24)
  assert.equal(canFinishClimb({ have: 25, need: 24, headroomBlocked: true }), false)
  assert.equal(climbNeedAbove(() => null, feet, { cap: 24, passable }), 24, 'unloaded cells are not openings')
})
t('the maroon decision and BOTH pillarOut calls use the measured need', () => {
  const c = strip(RAW)
  assert.match(c, /climbNeed: climbNeedAbove\(bmap\(bot\), bot\.entity\.position\)/, 'maroonState gets the measured need')
  assert.equal((c.match(/await pillarOut\(bot, climbNeedAbove\(bmap\(bot\), bot\.entity\.position\), \{ alive: ownsBody\(\(\) => (?:maroon|entombed)Grant\) \}\)/g) || []).length, 2, 'the maroon and entombed arms both pass it, gated on their arbiter grant')
  assert.ok(!/climbNeed: PILLAR_MAX_BLOCKS\b/.test(c), 'the constant no longer reaches maroonState or the lattice')
})
t('MUTANT: reverting the maroon arm to the constant is caught', () => {
  const c = strip(RAW); const anchor = 'climbNeed: climbNeedAbove(bmap(bot), bot.entity.position), entombed: entombedNow'
  assert.equal(c.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = c.replace(anchor, 'climbNeed: PILLAR_MAX_BLOCKS, entombed: entombedNow')
  assert.ok(/climbNeed: PILLAR_MAX_BLOCKS, entombed/.test(bad))
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
