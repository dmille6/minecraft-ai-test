// 39 OF 80 BOTS READ AS SHORT OF WOOD WHILE CARRYING HUNDREDS OF LOGS.
//
// `stockpile_wood` counted `oak_log` alone. Measured 2026-09-08: the fleet held
// 2,966 oak and 4,105 logs of every other kind, so 58% of its wood was
// invisible to the check, and 49% of bots read as below the 8-log floor while
// carrying birch and spruce. They were then sent to gather more oak
// specifically -- 33.5% of every gather request on the fleet, by bots holding
// 7,218 logs between them.
//
// Every log crafts to planks and every plank is interchangeable for the table,
// the sticks and the pickaxes above. The TECH_LADDER directly below already
// knew this and used countAny(b, LOGS). Same defect as counting the BLOCK
// instead of its DROP: one specific name standing in for a functional category.
import assert from 'node:assert'
import test from 'node:test'
import { SUSTAINING } from '../src/milestones.mjs'

const bot = inv => ({
  inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })) },
})
const wood = SUSTAINING.find(m => m.id === 'stockpile_wood')
const stone = SUSTAINING.find(m => m.id === 'stockpile_stone')

test('POSITIVE CONTROL: both milestones exist', () => {
  assert.ok(wood, 'stockpile_wood must be in SUSTAINING')
  assert.ok(stone, 'stockpile_stone must be in SUSTAINING')
})

test('THE BUG: birch logs count as wood', () => {
  // The real shape that produced this: plenty of wood, almost no oak.
  const b = bot({ birch_log: 400, oak_log: 3 })
  assert.equal(wood.done(b, 0), true, 'a bot with 400 birch is not short of wood')
})

test('every log type counts, not just birch', () => {
  for (const n of ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log']) {
    assert.equal(wood.done(bot({ [n]: 64 }), 0), true, n)
  }
})

test('planks count at a quarter — that is the crafting exchange rate', () => {
  assert.equal(wood.done(bot({ oak_planks: 32 }), 0), true, '32 planks = 8 logs')
  assert.equal(wood.done(bot({ oak_planks: 28 }), 0), false, '28 planks = 7 logs, one short')
  assert.equal(wood.done(bot({ oak_log: 4, oak_planks: 16 }), 0), true, '4 + 16/4 = 8')
})

test('a genuinely empty bot is still asked — the milestone must survive', () => {
  // POSITIVE CONTROL. If this passed, the fix would be "never ask for wood",
  // which is worse than the bug.
  assert.equal(wood.done(bot({}), 0), false)
  assert.equal(wood.done(bot({ dirt: 64, cobblestone: 64 }), 0), false, 'dirt is not wood')
  assert.equal(wood.done(bot({ oak_log: 7 }), 0), false, 'one short is still short')
})

test('the target still scales with the lap', () => {
  const b = bot({ oak_log: 20 })
  assert.equal(wood.done(b, 0), true, 'lap 0 wants 8')
  assert.equal(wood.done(b, 3), true, 'lap 3 wants 20')
  assert.equal(wood.done(b, 4), false, 'lap 4 wants 24')
})

test('progress reports the category, so the model can see it move', () => {
  const b = bot({ birch_log: 5, oak_planks: 8 })
  assert.match(wood.progress(b, 0), /7\/8/, 'got: ' + wood.progress(b, 0))
})

test('stockpile_stone has the same defect and the same fix', () => {
  // A bot mining below y=0 gets deepslate and read as having nothing.
  assert.equal(stone.done(bot({ cobbled_deepslate: 64 }), 0), true, 'deepslate is stone')
  assert.equal(stone.done(bot({ blackstone: 64 }), 0), true)
  assert.equal(stone.done(bot({ cobblestone: 16 }), 0), true, 'plain cobble still counts')
  assert.equal(stone.done(bot({ dirt: 64 }), 0), false, 'dirt is not stone')
  assert.equal(stone.done(bot({}), 0), false)
})

test('MUTANT: reverting to the single-name count is caught', () => {
  // A category assertion that has never been seen to fail is not a test.
  const singleName = (b, n) => (b.inventory.items().find(i => i.name === 'oak_log')?.count ?? 0) >= 8 + n * 4
  const b = bot({ birch_log: 400, oak_log: 3 })
  assert.equal(singleName(b, 0), false, 'sanity: the old logic really did fail this bot')
  assert.equal(wood.done(b, 0), true, 'and the new logic does not')
})
