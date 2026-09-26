// THE FLEET CARRIES THE ANSWER AND CANNOT USE IT.
//
// Measured 2026-09-26: 3,605 logs gathered a day, 485 saplings picked up a day, ZERO
// planted -- no sapling has ever appeared in a place attempt. 100% of sampled
// inventory rows held saplings, all 80 bots, median peak 100 and one bot at 330.
// The two pools given fresh worlds on 19 Sep jumped log-gather 4.9% -> 57.6% on
// identical code and fell back 67% in six days: a fresh world buys about a week.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { isPlantable, plantableSpotNear, soilOk, needsSoil } from '../src/skills.mjs'
import { plantingOrder, PLANT_RESERVE, PLANT_COOLDOWN_MS } from '../src/workorder.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

t('isPlantable needs soil under, a replaceable cell, and room above', () => {
  assert.equal(isPlantable({ soil: 'grass_block', cell: 'air', above: 'air' }), true)
  assert.equal(isPlantable({ soil: 'dirt', cell: 'short_grass', above: 'air' }), true, 'grass is replaceable')
  assert.equal(isPlantable({ soil: 'podzol', cell: 'air', above: 'air' }), true)
  assert.equal(isPlantable({ soil: 'stone', cell: 'air', above: 'air' }), false, 'stone is not soil')
  assert.equal(isPlantable({ soil: 'grass_block', cell: 'oak_sapling', above: 'air' }), false,
    'a sapling already there is not a second tree')
  assert.equal(isPlantable({ soil: 'grass_block', cell: 'air', above: 'stone' }), false, 'no room above')
  assert.equal(isPlantable({ soil: 'water', cell: 'air', above: 'air' }), false)
  assert.equal(isPlantable({}), false)
})

t('plantingOrder respects the reserve, the cooldown, and picks the species held most', () => {
  const spot = { x: 1, y: 64, z: 2 }
  // below the reserve -> nothing
  assert.equal(plantingOrder({ saplings: { oak_sapling: PLANT_RESERVE }, spot, now: 1e9 }), null,
    'the reserve is a floor, not a target')
  const o = plantingOrder({ saplings: { oak_sapling: 32, birch_sapling: 10 }, spot, now: 1e9 })
  assert.equal(o.skill, 'place')
  assert.equal(o.args.item, 'oak_sapling', 'the species held most is spent first')
  assert.deepEqual([o.args.x, o.args.y, o.args.z], [1, 64, 2])
  // cooldown
  assert.equal(plantingOrder({ saplings: { oak_sapling: 32 }, spot, now: 1e9, lastPlantedAt: 1e9 - 1 }), null)
  assert.ok(plantingOrder({ saplings: { oak_sapling: 32 }, spot, now: 1e9, lastPlantedAt: 1e9 - PLANT_COOLDOWN_MS - 1 }))
  // no spot -> nothing, and non-saplings are never planted
  assert.equal(plantingOrder({ saplings: { oak_sapling: 32 }, spot: null, now: 1e9 }), null)
  assert.equal(plantingOrder({ saplings: { dirt: 400 }, spot, now: 1e9 }), null, 'dirt is not a sapling')
})

t('the cap bounds the cost: at most 6 plants per bot-hour', () => {
  assert.equal(PLANT_COOLDOWN_MS, 10 * 60 * 1000)
  const perHour = 3600_000 / PLANT_COOLDOWN_MS
  assert.equal(perHour, 6)
  // measured 91 decisions/bot-h, so the worst case is ~6.6% of decisions
  assert.ok(perHour / 91 < 0.07, 'the worst case must stay under 7% of decisions')
})

t('plantableSpotNear skips the cell the bot stands in, and returns null with no world', () => {
  assert.equal(plantableSpotNear(null), null)
  assert.equal(plantableSpotNear({}), null)
  // a world where ONLY the bot's own cell would qualify must yield nothing
  const at = (x, y, z) => ({ name: (x === 0 && z === 0) ? (y === 63 ? 'grass_block' : 'air') : 'stone',
                             position: { x, y, z } })
  const bot = { entity: { position: { x: 0, y: 64, z: 0, offset: (dx, dy, dz) => ({ x: dx, y: 64 + dy, z: dz }) } },
                blockAt: p => at(p.x, p.y, p.z) }
  assert.equal(plantableSpotNear(bot), null, 'the bot\'s own cell is excluded')
})

t('plantableSpotNear finds a real neighbouring spot', () => {
  // grass at y=63 everywhere, air above: any neighbour qualifies
  const bot = { entity: { position: { x: 0, y: 64, z: 0, offset: (dx, dy, dz) => ({ x: dx, y: 64 + dy, z: dz }) } },
                blockAt: p => ({ name: p.y === 63 ? 'grass_block' : 'air', position: p }) }
  const s = plantableSpotNear(bot)
  assert.ok(s, 'a spot must be found')
  assert.ok(!(s.x === 0 && s.z === 0), 'and it is not the cell the bot occupies')
})

t('soilOk gates the place candidate list for saplings only', () => {
  assert.equal(needsSoil('oak_sapling'), true)
  assert.equal(needsSoil('crafting_table'), false)
  assert.equal(soilOk('oak_sapling', 'stone'), false)
  assert.equal(soilOk('oak_sapling', 'grass_block'), true)
  assert.equal(soilOk('crafting_table', 'stone'), true, 'unchanged for everything else')
})

const COG = readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8')
t('the loop offers a planting order ONLY when there is no rung to advance', () => {
  const c = strip(COG)
  assert.match(c, /let order = orderFor\(readyFor\(this\.bot, milestone\)\)/, 'the rung order comes first')
  assert.match(c, /if \(!order\) \{/, 'and planting is only reached when there is none')
  assert.match(c, /order = plantingOrder\(\{ saplings: sap, spot: plantableSpotNear\(this\.bot\)/)
  assert.match(c, /if \(order\) this\.lastPlantedAt = Date\.now\(\)/,
    'the cooldown is charged on ISSUE, so a bad spot costs one decision per 10 min')
})
t('MUTANT: letting planting pre-empt a craft rung is caught', () => {
  const anchor = 'let order = orderFor(readyFor(this.bot, milestone))'
  assert.equal(COG.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  assert.ok(!/let order = orderFor\(readyFor\(this\.bot, milestone\)\)/.test(strip(COG.replace(anchor, 'let order = null'))))
})
t('MUTANT: charging the cooldown on success instead of issue is caught', () => {
  const anchor = 'if (order) this.lastPlantedAt = Date.now()'
  assert.equal(COG.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  assert.ok(!/if \(order\) this\.lastPlantedAt = Date\.now\(\)/.test(strip(COG.replace(anchor, ''))))
})

// Appended after review: the cooldown must gate the 75-call world scan, not just the order.
t('MUTANT: running the world scan before the cooldown check is caught', () => {
  const anchor = 'if (Object.keys(sap).length && sinceLast >= PLANT_COOLDOWN_MS) {'
  assert.equal(COG.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const mutant = strip(COG.replace(anchor, 'if (Object.keys(sap).length) {'))
  assert.ok(!/sinceLast >= PLANT_COOLDOWN_MS/.test(mutant),
    'dropping the cooldown from the guard must fail this assertion')
  assert.match(strip(COG), /const sinceLast = Date\.now\(\) - \(this\.lastPlantedAt \?\? 0\)/)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
