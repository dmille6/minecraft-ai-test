// THE FLEET CARRIES THE ANSWER AND CANNOT USE IT.
//
// Measured 2026-09-26: 3,605 logs gathered a day, 485 saplings picked up a day, ZERO
// planted -- no sapling has ever appeared in a place attempt. 100% of sampled
// inventory rows held saplings, all 80 bots, median peak 100 and one bot at 330.
// The two pools given fresh worlds on 19 Sep jumped log-gather 4.9% -> 57.6% on
// identical code and fell back 67% in six days: a fresh world buys about a week.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { isPlantable, plantableSpotNear, soilOk, needsSoil, saplingClearance, SAPLING_CLEARANCE_DEFAULT } from '../src/skills.mjs'
import { plantingOrder, PLANT_RESERVE, PLANT_COOLDOWN_MS } from '../src/workorder.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// THE `above` ARGUMENT IS GONE AND THESE ASSERTIONS CHANGED WITH IT. The reason is
// measured, not stylistic: on the sandbox rig a sapling with a ceiling at +2..+5 grew
// 0/3 every time and one at +6 grew 3/3 (birch needed +7), against an unceilinged
// control that grew 6/6. A single air block above was never the requirement -- oak
// needs FIVE and birch SIX -- so a predicate that asked for one admitted every
// dirt-floored tunnel and roofed excavation on the fleet as if it were open meadow.
// isPlantable now takes the COLUMN above the cell, and `item`, because the two species
// differ.
const AIR = n => Array(n).fill('air')

t('isPlantable needs soil, a replaceable cell, and the MEASURED clearance above', () => {
  assert.equal(isPlantable({ soil: 'grass_block', cell: 'air', column: AIR(5) }), true, 'oak needs 5')
  assert.equal(isPlantable({ soil: 'dirt', cell: 'short_grass', column: AIR(5) }), true, 'grass is replaceable')
  assert.equal(isPlantable({ soil: 'podzol', cell: 'air', column: AIR(9) }), true, 'more than enough is fine')
  assert.equal(isPlantable({ soil: 'stone', cell: 'air', column: AIR(9) }), false, 'stone is not soil')
  assert.equal(isPlantable({ soil: 'grass_block', cell: 'oak_sapling', column: AIR(9) }), false,
    'a sapling already there is not a second tree')
  assert.equal(isPlantable({ soil: 'water', cell: 'air', column: AIR(9) }), false)
  assert.equal(isPlantable({}), false)

  // the cliff, at the measured height and one short of it
  assert.equal(isPlantable({ soil: 'grass_block', cell: 'air', column: AIR(4) }), false,
    'four air blocks is one short for oak and NOTHING grew one short')
  assert.equal(isPlantable({ soil: 'grass_block', cell: 'air', column: ['air'] }), false,
    'ONE air block above is the old predicate, and it admitted tunnels')
  assert.equal(isPlantable({ soil: 'grass_block', cell: 'air', column: [...AIR(3), 'stone', 'air'] }), false,
    'a solid block anywhere inside the needed column blocks growth')

  // species differ, and the default is conservative for the untested one
  assert.equal(isPlantable({ soil: 'grass_block', cell: 'air', column: AIR(5), item: 'birch_sapling' }), false,
    'birch grew 0/3 at a ceiling of +6, so five air blocks is not enough')
  assert.equal(isPlantable({ soil: 'grass_block', cell: 'air', column: AIR(6), item: 'birch_sapling' }), true)
  assert.equal(isPlantable({ soil: 'grass_block', cell: 'air', column: AIR(6), item: 'jungle_sapling' }), false,
    'jungle is unmeasured (15 of 10,125 held) so it takes the conservative default, not a guess')
  assert.equal(isPlantable({ soil: 'grass_block', cell: 'air', column: AIR(7), item: 'jungle_sapling' }), true)
})

t('saplingClearance carries the measured numbers and a conservative default', () => {
  assert.equal(saplingClearance('oak_sapling'), 5)
  assert.equal(saplingClearance('birch_sapling'), 6)
  assert.equal(saplingClearance('jungle_sapling'), SAPLING_CLEARANCE_DEFAULT)
  assert.ok(saplingClearance('cherry_sapling') >= 6,
    'an unknown species must not get a laxer rule than the strictest measured one')
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
  assert.match(c, /order = plantingOrder\(\{ saplings: sap, spot,/)
  // THIS ASSERTION WAS INVERTED AND IT LOCKED IN THE DEFECT. It used to demand
  // `if (order) this.lastPlantedAt = Date.now()` and call that "charged on ISSUE".
  // It is charged on issue only when there IS an issue; a bot that finds no spot
  // never advances the clock and therefore re-runs the 72-cell sweep on every
  // decision, for ever. Both review engines found it independently. The clock is
  // now advanced for the SCAN, which is the only version of the rule that bounds
  // the cost at the 6/bot-hour the cap claims.
  assert.match(c, /\n\s*this\.lastPlantedAt = Date\.now\(\)\n/,
    'the clock must be advanced unconditionally, not inside `if (order)`')
  assert.doesNotMatch(c, /if \(order\) this\.lastPlantedAt = Date\.now\(\)/,
    'charging the clock only on a successful order is the re-sweep bug')
})
t('MUTANT: letting planting pre-empt a craft rung is caught', () => {
  const anchor = 'let order = orderFor(readyFor(this.bot, milestone))'
  assert.equal(COG.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  assert.ok(!/let order = orderFor\(readyFor\(this\.bot, milestone\)\)/.test(strip(COG.replace(anchor, 'let order = null'))))
})
t('MUTANT: charging the cooldown only when an order was produced is caught', () => {
  const anchor = '        this.lastPlantedAt = Date.now()\n'
  assert.equal(COG.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  // The mutant is the shape this code had before review: the clock inside `if (order)`.
  const mutant = strip(COG.replace(anchor, '        if (order) this.lastPlantedAt = Date.now()\n'))
  assert.match(mutant, /if \(order\) this\.lastPlantedAt = Date\.now\(\)/,
    'the mutant did not apply, so this test proves nothing')
  assert.doesNotMatch(mutant, /\n\s{8}this\.lastPlantedAt = Date\.now\(\)\n/,
    'the unconditional charge must be GONE in the mutant, or the assertion above cannot fail')
})

// Appended after review: the cooldown must gate the 75-call world scan, not just the order.
t('MUTANT: running the world scan before the cooldown check is caught', () => {
  const anchor = 'if (plantingEnabled(process.env) && Object.keys(sap).length && sinceLast >= PLANT_COOLDOWN_MS) {'
  assert.equal(COG.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const mutant = strip(COG.replace(anchor, 'if (plantingEnabled(process.env) && Object.keys(sap).length) {'))
  assert.ok(!/sinceLast >= PLANT_COOLDOWN_MS/.test(mutant),
    'dropping the cooldown from the guard must fail this assertion')
  assert.match(strip(COG), /const sinceLast = Date\.now\(\) - \(this\.lastPlantedAt \?\? 0\)/)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
