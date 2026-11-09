// SHOWCASE-ON-FLEET (control session 10-31): the showcase runs the FLEET line plus its own pieces. Its policy is the code's own
// defaults for the `showcase` pool (the env carries no feature keys): the tree farm and the expeditions on there, off in the fleet;
// the town stair (shaft-02, on in every fleet pool) ON in the showcase town too since showshaft-01 (owner 11-01 item 2, deepminer-01
// promoted fleet-wide 11-03): SHAFT=off / SHAFT_POOLS still turn it off there.
// The project list the showcase's records are read against: the six plots it has built with the stair right after the workshop.
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

t('shaftOn (showshaft-01): unset puts the showcase pool in as every fleet pool; SHAFT and SHAFT_POOLS still decide', () => {
  assert.strictEqual(S.shaftOn({}, 'showcase'), true)
  assert.strictEqual(S.shaftOn({ SHAFT: 'off' }, 'showcase'), false, 'the rollback')
  assert.strictEqual(S.shaftOn({ SHAFT_POOLS: 'hive-a' }, 'showcase'), false, 'a list without the showcase leaves it out')
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
t('at load in the showcase pool: SHAFT on (showshaft-01), and the project list is the workshop, the stair, the five plots the showcase has built, the crop farm (cropfarm-01), the cane bed (canefarm-01), the pens (pens-01), then the materials chests, the storehouse (storehouse-01), the copper hall (copperhall-01), the storage hall (storehub-01), the wall extension round it (wallext-01) and the old line demolition (wallext-02), the stepwell (stepwell-01), the stockpile yard (stockyard-01), the town sinks (picker-01, then the dress sink: towndress-01, then the decorator sink: decorator-01) and the tidy (tidy-01 + groundskeeper-01, last), in order', () => {
  assert.strictEqual(S.SHAFT.on, true)
  assert.strictEqual(S.TREEFARM.on, true)
  assert.deepStrictEqual(S.projectsOn().map(p => p.plot), ['shop', 'shaft', 'house1', 'monument', 'paths', 'wall', ...(S.FORESTP.on ? [] : ['treefarm']), 'cropfarm', 'canefarm', 'pens', 'shopchest', 'storehouse', 'hall', 'storehub', 'wallext', 'walldemo', 'enchantshop', 'townhall', 'cottage1', 'reroof', 'stepwell', 'yard', 'road', 'tower', 'shrine', 'dress', 'decor', ...(S.FORESTP.on ? ['forest'] : []), 'tidy']   /* forest-01: with the forest on (it needs the keeper) the in-wall farm leaves the order and the forest is before the tidy */)
  // the stair stays GUARDED when off (a sited stair's cells keep their protection); with no record it guards nothing
  assert.ok(S.projectsGuarded().some(p => p.plot === 'shaft'))
})
t('wiring (showshaft-01, Codex r1 BLOCKER): the stair\'s siting reserves an unsited hall pad and the expedition markers', () => {
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  assert.ok(/const boxes = \[\.\.\.c\.zones, \.\.\.recordZones\(others\), \.\.\.hallPadZones\(h\.head\.plan\), \.\.\.townMarkerZones\(\)\]\.map\(z => z\.box\)/.test(src))
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
