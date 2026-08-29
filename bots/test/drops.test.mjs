// GRADE THE DROP, NOT THE BLOCK.
//
// `gather` scored itself with countItem(bot, blockName). Stone does not drop
// stone. Lifetime, full walk of the fleet: gather stone 13,550 attempts and ZERO
// recorded successes, ever; coal_ore 0/266; iron_ore 0/106. 707 records show
// `gather stone` returning failed while the inventory gained cobblestone in the
// very next record.
//
// The cost was not just a wrong rate. It produced the false finding "zero iron
// ore in 23 days", quoted for days and used to justify two pieces of work,
// while 33 bots had been carrying raw_iron since 2026-08-26 and one had smelted
// an iron pickaxe. A counter that can only return zero carries no information.
import assert from 'node:assert'
import mcdata from 'minecraft-data'
import { dropsOf, sourcesOf, heldFromBlock } from '../src/drops.mjs'

const registry = mcdata('1.21.8')
let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

t('the blocks that never scored now resolve to what they actually give', () => {
  assert.deepEqual(dropsOf(registry, 'stone'), ['cobblestone'])
  assert.deepEqual(dropsOf(registry, 'iron_ore'), ['raw_iron'])
  assert.deepEqual(dropsOf(registry, 'coal_ore'), ['coal'])
})

t('deepslate variants give the same item as their stone counterparts', () => {
  // A hand-written table would have to remember this. minecraft-data already
  // knows, for the exact protocol version the bot is connected to.
  assert.deepEqual(dropsOf(registry, 'deepslate_iron_ore'), ['raw_iron'])
  assert.deepEqual(dropsOf(registry, 'deepslate_coal_ore'), ['coal'])
})

t('a block with no modelled drop falls back to its own name', () => {
  // Never to an empty list: that would make the block unscoreable, which is the
  // original bug wearing different clothes.
  assert.deepEqual(dropsOf(registry, 'oak_leaves'), ['oak_leaves'])
})

t('GRASS BLOCK DROPS DIRT — the trap that made dirt ungatherable', () => {
  // Natural dirt on a plain is capped by grass_block, so every dirt candidate
  // read as "buried": 66,170 lifetime gather-dirt calls at 10.5% success, for
  // the one item the exit contract, climbAdvice and climbPrerequisite all
  // demand. The bot was standing on its answer.
  assert.deepEqual(dropsOf(registry, 'grass_block'), ['dirt'])
  assert.ok(sourcesOf(registry, 'dirt').includes('grass_block'))
})

t('sources prefer the item itself before a block that yields it', () => {
  // Asking for cobblestone should still pick up loose cobblestone before
  // deciding to mine stone for it.
  assert.equal(sourcesOf(registry, 'cobblestone')[0], 'cobblestone')
  assert.ok(sourcesOf(registry, 'cobblestone').includes('stone'))
})

t('both ore variants are offered as sources of raw_iron', () => {
  const s = sourcesOf(registry, 'raw_iron')
  assert.ok(s.includes('iron_ore') && s.includes('deepslate_iron_ore'))
})

t('THE ORIGINAL DEFECT: mining stone and holding cobblestone now counts', () => {
  const bot = { registry, inventory: { items: () => [{ name: 'cobblestone', count: 12 }] } }
  assert.equal(heldFromBlock(bot, 'stone'), 12,
    'this returned 0 for the entire life of the experiment')
})

t('holding raw_iron counts as having gathered iron_ore', () => {
  const bot = { registry, inventory: { items: () => [{ name: 'raw_iron', count: 4 }] } }
  assert.equal(heldFromBlock(bot, 'iron_ore'), 4)
  assert.equal(heldFromBlock(bot, 'deepslate_iron_ore'), 4)
})

t('unrelated items are not credited', () => {
  const bot = { registry, inventory: { items: () => [{ name: 'bone', count: 30 }] } }
  assert.equal(heldFromBlock(bot, 'stone'), 0)
})

t('a missing registry degrades to the old behaviour rather than throwing', () => {
  assert.deepEqual(dropsOf(null, 'stone'), ['stone'])
  assert.deepEqual(sourcesOf(undefined, 'dirt'), ['dirt'])
  assert.equal(heldFromBlock({ inventory: { items: () => [] } }, 'stone'), 0)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
