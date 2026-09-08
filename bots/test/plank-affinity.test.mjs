// ONE OAK SAPLING SENT A BOT WITH 186 BIRCH LOGS TO FIND AN OAK TREE.
//
// `craft` picks among the 12 wooden_pickaxe recipes -- one per wood type -- by
// preferring the variant whose missing ingredients the bot is closest to being
// able to make. That affinity test was a string-prefix match:
//
//     const held = bot.inventory.items().map(i => i.name.split('_')[0])
//
// so `oak_sapling`, `oak_leaves` and `oak_boat` all read as "this bot has oak".
// A bot holding 186 birch_log and 27 oak_sapling scored oak and birch EQUAL,
// and the `canonical` tiebreak -- which exists to point a WOODLESS bot at the
// common wood -- then broke the tie for oak.
//
// Measured over 6h on 80 bots: 134 of 211 `gather oak_* first` craft failures
// (63.5%) were bots holding a different log type at that moment. It is the
// largest craft-failure shape in the fleet, and it feeds the gather loop --
// oak_log is 32.5% of all gather requests at 8.9% success.
//
// Behaviour test on the exported decision, not a grep: a source assertion here
// would match the comment above it.
import assert from 'node:assert'
import { sourcesFor, heldCounts, canProduce } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const held = inv => heldCounts(Object.entries(inv).map(([name, count]) => ({ name, count })))

// --- the live case, exactly as logged --------------------------------------

t('THE LIVE CASE: 186 birch_log + 27 oak_sapling can make birch planks, not oak', () => {
  const h = held({ birch_log: 186, oak_sapling: 27, cobblestone: 194, leaf_litter: 129 })
  assert.equal(canProduce(h, '3x birch_planks'), true, 'birch_log makes birch_planks')
  assert.equal(canProduce(h, '3x oak_planks'), false,
    'an oak SAPLING is not a source of oak planks -- this is the whole bug')
})

t('a sapling, leaves and a boat are never sources', () => {
  for (const junk of ['oak_sapling', 'oak_leaves', 'oak_boat', 'oak_button', 'oak_sign']) {
    assert.equal(canProduce(held({ [junk]: 64 }), '3x oak_planks'), false, `${junk} is not a log`)
  }
})

// --- what IS a source -------------------------------------------------------

t('every log form of the right wood counts', () => {
  for (const src of ['oak_log', 'oak_wood', 'stripped_oak_log', 'stripped_oak_wood']) {
    assert.equal(canProduce(held({ [src]: 1 }), '3x oak_planks'), true, `${src} makes oak_planks`)
  }
})

t('holding the ingredient itself counts', () => {
  assert.equal(canProduce(held({ oak_planks: 3 }), '3x oak_planks'), true)
})

t('the wrong wood does not count', () => {
  assert.equal(canProduce(held({ spruce_log: 64 }), '3x oak_planks'), false,
    'spruce logs do not make oak planks')
})

t('bamboo planks come from bamboo, not a log', () => {
  assert.deepEqual(sourcesFor('bamboo_planks').sort(), ['bamboo', 'bamboo_block'])
  assert.equal(canProduce(held({ bamboo_block: 4 }), '3x bamboo_planks'), true)
  assert.equal(canProduce(held({ bamboo_log: 4 }), '3x bamboo_planks'), false,
    'there is no bamboo_log in Minecraft')
})

// --- failing closed ---------------------------------------------------------

t('a zero count is not possession', () => {
  assert.equal(canProduce(held({ oak_log: 0 }), '3x oak_planks'), false,
    'a 0-count entry must not read as holding it')
})

t('an unmodelled ingredient scores zero affinity, never a guessed one', () => {
  assert.deepEqual(sourcesFor('cobbled_deepslate'), [])
  assert.deepEqual(sourcesFor('stick'), [])
  assert.deepEqual(sourcesFor(null), [])
  assert.equal(canProduce(held({ cobblestone: 290 }), '3x cobbled_deepslate'), false)
})

t('holding cobblestone still satisfies a cobblestone gap directly', () => {
  assert.equal(canProduce(held({ cobblestone: 290 }), '3x cobblestone'), true)
})

t('heldCounts aggregates across slots', () => {
  const h = heldCounts([{ name: 'birch_log', count: 64 }, { name: 'birch_log', count: 64 },
                        { name: 'birch_log', count: 58 }])
  assert.equal(h.get('birch_log'), 186, 'three stacks are one total')
})

t('empty and malformed inventories do not throw', () => {
  assert.equal(canProduce(heldCounts([]), '3x oak_planks'), false)
  assert.equal(canProduce(heldCounts(null), '3x oak_planks'), false)
  assert.equal(canProduce(heldCounts([{ count: 5 }, null]), '3x oak_planks'), false)
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
