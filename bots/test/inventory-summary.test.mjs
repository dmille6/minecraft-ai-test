// THE MODEL WAS TOLD IT HAD "1x stone_pickaxe, 1x stone_pickaxe, 1x stone_pickaxe".
//
// It had seven, plus 147 oak logs, 48 crafting tables, and the 2 cobblestone
// that were the actual problem. The refusal message rendered
// `bot.inventory.items().slice(0, 3)` -- the first three SLOTS, unaggregated,
// unsorted, and unrelated to the decision.
//
// This string is the observation the model reads when deciding what to do about
// a failed craft. Measured 2026-09-07: 195 of 221 wooden-pickaxe craft attempts
// failed, on bots that already held one. Nothing ever told them.
import assert from 'node:assert'
import test from 'node:test'
import { inventorySummary } from '../src/skills.mjs'

// placebo-d-Echo's real inventory, one entry per slot as mineflayer reports it.
const REAL = [
  { name: 'stone_pickaxe', count: 1 }, { name: 'stone_pickaxe', count: 1 },
  { name: 'stone_pickaxe', count: 1 }, { name: 'stone_pickaxe', count: 1 },
  { name: 'stone_pickaxe', count: 1 }, { name: 'stone_pickaxe', count: 1 },
  { name: 'stone_pickaxe', count: 1 },
  { name: 'oak_log', count: 64 }, { name: 'oak_log', count: 64 }, { name: 'oak_log', count: 19 },
  { name: 'oak_planks', count: 5 }, { name: 'stick', count: 6 },
  { name: 'wooden_pickaxe', count: 1 }, { name: 'wooden_pickaxe', count: 1 },
  { name: 'cobblestone', count: 2 },
  { name: 'crafting_table', count: 48 },
]

test('stacks of the same item are summed, not listed separately', () => {
  const s = inventorySummary(REAL, { focus: ['stone_pickaxe'] })
  assert.match(s, /7x stone_pickaxe/, 'seven slots of one pickaxe is 7, not 1: ' + s)
  assert.doesNotMatch(s, /1x stone_pickaxe/, 'the old rendering must not survive')
  assert.match(s, /147x oak_log/, '64+64+19 = 147')
})

test('the item the decision turns on is always shown, even at zero', () => {
  // "you have 0x cobblestone" is the actionable fact. Its ABSENCE from a list
  // is not -- a reader cannot tell "none" from "not in the top six".
  const s = inventorySummary(REAL, { focus: ['diamond'] })
  assert.match(s, /0x diamond/, 'a focus item absent from the inventory reads as 0: ' + s)
})

test('focus items lead, then the largest holdings', () => {
  const s = inventorySummary(REAL, { focus: ['cobblestone', 'stone_pickaxe'] })
  assert.ok(s.startsWith('2x cobblestone, 7x stone_pickaxe'),
    'the blocker and the target come first: ' + s)
  assert.ok(s.indexOf('147x oak_log') < s.indexOf('6x stick'),
    'and the rest are ordered by how much is held')
})

test('the list is capped and says how much it hid', () => {
  const s = inventorySummary(REAL, { limit: 3 })
  assert.equal(s.split(', ').length, 3, 'limit is honoured: ' + s)
  assert.match(s, /\(\+\d+ more\)/, 'and the tail is declared, not silently dropped')
})

test('an empty or junk inventory says so rather than inventing', () => {
  assert.equal(inventorySummary([]), 'nothing')
  assert.equal(inventorySummary(null), 'nothing')
  assert.equal(inventorySummary(undefined), 'nothing')
  assert.equal(inventorySummary([{ count: 3 }, null, { name: '' }]), 'nothing',
    'entries with no name are not items')
})

test('a non-numeric count contributes nothing rather than NaN', () => {
  // NaN would render as "NaNx oak_log", which is worse than the bug this
  // replaces: it looks like a number and cannot be reasoned about.
  const s = inventorySummary([{ name: 'oak_log', count: 'lots' }, { name: 'oak_log', count: 5 }])
  assert.equal(s, '5x oak_log')
  assert.doesNotMatch(s, /NaN/)
})

test('POSITIVE CONTROL: the old rendering and the new one really do differ', () => {
  // If these agreed, every assertion above would be satisfied by the code this
  // file exists to replace.
  const old = REAL.slice(0, 3).map(i => `${i.count}x ${i.name}`).join(', ')
  const now = inventorySummary(REAL, { focus: ['cobblestone', 'stone_pickaxe'] })
  assert.notEqual(old, now)
  assert.doesNotMatch(old, /cobblestone/, 'the old one omitted the actual blocker entirely')
  assert.match(now, /2x cobblestone/, 'the new one leads with it')
})

test('duplicate focus entries do not duplicate output', () => {
  const s = inventorySummary(REAL, { focus: ['cobblestone', 'cobblestone'] })
  assert.equal(s.match(/cobblestone/g).length, 1, s)
})
