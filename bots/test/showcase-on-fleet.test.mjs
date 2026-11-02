// SHOWCASE-ON-FLEET (control session 10-31): the showcase runs the FLEET line plus its own pieces. Its policy is the code's own
// defaults for the `showcase` pool (the env carries no feature keys): the tree farm and the expeditions on there, off in the fleet;
// the town stair (shaft-02, on in every fleet pool) OFF in the showcase town unless named -- the owner's showcase list has none.
// The project list the showcase's records are read against: the same six plots it has built, no `shaft`.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

for (const k of ['SHAFT', 'SHAFT_POOLS', 'TREEFARM', 'TREEFARM_POOLS', 'EXPEDITION', 'EXPEDITION_POOLS', 'MONUMENT', 'MONUMENT_POOLS',
  'HOUSE', 'PATHS', 'PATHS_POOLS', 'WALL', 'WALL_POOLS', 'STOREHOUSE', 'STOREHOUSE_POOLS', 'SHOPCHEST', 'SHOPCHEST_POOLS']) delete process.env[k]
process.env.MEMORY_POOL = 'showcase'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-sof-pool-'))
const S = await import('../src/shop.mjs')
const F = await import('../src/treefarm.mjs')
const E = await import('../src/expedition.mjs')

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) } }

t('shaftOn: unset leaves the showcase pool out, every fleet pool in; SHAFT and SHAFT_POOLS still decide', () => {
  assert.strictEqual(S.shaftOn({}, 'showcase'), false)
  assert.strictEqual(S.shaftOn({}, 'hive-a'), true, 'POSITIVE CONTROL: the fleet default is unchanged')
  assert.strictEqual(S.shaftOn({}, ''), true)
  assert.strictEqual(S.shaftOn({ SHAFT: 'on' }, 'showcase'), true)
  assert.strictEqual(S.shaftOn({ SHAFT_POOLS: 'showcase' }, 'showcase'), true)
  assert.strictEqual(S.shaftOn({ SHAFT_POOLS: '*' }, 'showcase'), true, 'an explicit list is taken as written')
  assert.strictEqual(S.shaftOn({ SHAFT: 'off' }, 'hive-a'), false)
})
t('the tree farm and the expeditions: on in the showcase pool by default, off in a fleet pool', () => {
  assert.strictEqual(F.treefarmOn({}, 'showcase'), true)
  assert.strictEqual(F.treefarmOn({}, 'hive-a'), false)
  assert.strictEqual(E.expeditionOn({}, 'showcase'), true)
  assert.strictEqual(E.expeditionOn({}, 'hive-a'), false)
})
t('at load in the showcase pool: SHAFT off, and the project list is the six plots the showcase has built, then the materials chests, the storehouse (storehouse-01) the copper hall (copperhall-01) and the stockpile yard (stockyard-01), in order', () => {
  assert.strictEqual(S.SHAFT.on, false)
  assert.strictEqual(S.TREEFARM.on, true)
  assert.deepStrictEqual(S.projectsOn().map(p => p.plot), ['shop', 'house1', 'monument', 'paths', 'wall', 'treefarm', 'shopchest', 'storehouse', 'hall', 'yard'])
  // the stair stays GUARDED when off (a sited stair's cells keep their protection); with no record it guards nothing
  assert.ok(S.projectsGuarded().some(p => p.plot === 'shaft'))
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
