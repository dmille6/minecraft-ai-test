// IRON WAS EIGHTH AND THE SCAN ONLY REACHED SIX.
//
// nearbyBlocks stops at `limit` (8) entries and actionableBlocks stops at
// ACTIONABLE_TOTAL (48) checked positions = six types at eight each. Both walk
// INTERESTING_BLOCKS in LIST ORDER, and iron_ore is eighth of thirteen. In a
// forest world the logs, dirt, grass and stone ahead of it eat the whole budget.
//
// Measured 2026-09-08, 6h, 80 bots: iron_ore present in 29,656 affordance scans,
// USABLE 11,501 times, requested by `gather` 73 times. 0.6%. Meanwhile 2,000
// gather attempts went to dirt.
import assert from 'node:assert'
import { scanOrder } from '../src/prompt.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const FULL = scanOrder(null)

t('with no milestone the order is unchanged', () => {
  assert.deepEqual(scanOrder(null), FULL)
  assert.deepEqual(scanOrder(undefined), FULL)
})

t('THE LIVE CASE: iron_ore is hoisted from eighth to first', () => {
  assert.ok(FULL.indexOf('iron_ore') >= 6,
    'precondition: iron_ore must be past the six-type budget in the base list')
  assert.equal(scanOrder('iron_ore')[0], 'iron_ore')
  assert.ok(scanOrder('iron_ore').slice(0, 6).includes('iron_ore'),
    'it must survive a six-type budget')
})

t('nothing is dropped, only reordered', () => {
  const o = scanOrder('iron_ore')
  assert.equal(o.length, FULL.length, 'same number of entries')
  assert.deepEqual([...o].sort(), [...FULL].sort(), 'same set')
})

t('no duplicates when the wanted block is already first', () => {
  const o = scanOrder('oak_log')
  assert.equal(o[0], 'oak_log')
  assert.equal(o.filter(x => x === 'oak_log').length, 1)
  assert.equal(o.length, FULL.length)
})

t('an ITEM the bot wants is not turned into a block scan', () => {
  // Milestones want raw_iron and iron_ingot too. Those are not blocks and must
  // not be hoisted into a findBlocks call.
  for (const item of ['raw_iron', 'iron_ingot', 'stick', 'wooden_pickaxe']) {
    assert.deepEqual(scanOrder(item), FULL, `${item} is not a block in this list`)
  }
})

t('several wants keep their given order, then the rest', () => {
  const o = scanOrder(['iron_ore', 'coal_ore'])
  assert.deepEqual(o.slice(0, 2), ['iron_ore', 'coal_ore'])
  assert.equal(o.length, FULL.length)
})

t('junk input degrades to the base order rather than throwing', () => {
  for (const junk of [42, {}, [null, undefined, 7], '', [], NaN]) {
    assert.deepEqual(scanOrder(junk), FULL, `${JSON.stringify(junk)} must be inert`)
  }
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
