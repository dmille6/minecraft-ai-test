// NOTHING EVER ASKED THEM TO.
//
// 0 of 80 bots passed stone_pickaxe in 20 days. The cause was not the model,
// the skills, the prompt or the pathfinder: the `gatherer` chain is four gather
// rungs and NO craft rung -- deliberately, as its own comment says, "so it is
// the control case". Then every bot was assigned BOT_ROLE=gatherer and the
// diagnostic control became the entire fleet. The `miner` chain that does drive
// tool progression is assigned to nobody, and even it stops at stone_pickaxe.
import assert from 'node:assert'
import { MILESTONES_BY_ROLE, SUSTAINING } from '../src/milestones.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ids = ch => ch.map(r => r.id).filter(Boolean)
const inv = o => ({
  inventory: { items: () => Object.entries(o).map(([name, count], slot) => ({ name, count, slot })) },
  entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 0 } },
  registry: { blocks: {} }, findBlock: () => null,
})

t('EVERY ROLE IS ASKED TO CLIMB, not just the one nobody runs', () => {
  // The fix belongs in SUSTAINING precisely because every role receives it.
  for (const role of Object.keys(MILESTONES_BY_ROLE)) {
    const chain = ids([...MILESTONES_BY_ROLE[role], ...SUSTAINING])
    assert.ok(chain.some(id => id.startsWith('craft_stone_pickaxe')),
      `role '${role}' is never asked for a stone pickaxe`)
  }
})

t('THE LADDER REACHES THE FURNACE, which no chain had ever done', () => {
  assert.ok(ids(SUSTAINING).includes('craft_furnace_1'),
    'missing craft_furnace_1 — the ceiling is still written in')
})

t('NO RUNG CAN COST A FAILED ATTEMPT', () => {
  // Every ladder rung is a CRAFT gated on carrying the materials: actionable or
  // vacuously satisfied, never a 25-attempt failure. A `gather` rung here would
  // tax the primary endpoint every lap, which is why iron is not on it yet.
  const empty = inv({})
  for (const r of SUSTAINING) {
    if (!r.id?.startsWith('craft_') && !r.id?.startsWith('gather_iron')) continue
    assert.equal(r.done(empty, 0), true,
      `${r.id} is unmet for a bot with nothing — it will fail 25 times every lap`)
  }
})

t('a bot with an IRON pickaxe skips the whole ladder instantly', () => {
  // M.craft is satisfied by capability, so each rung is a no-op above it. This
  // is what stops the ladder re-doing work every SUSTAINING cycle.
  const b = inv({ iron_pickaxe: 1, crafting_table: 1, furnace: 1 })
  for (const r of SUSTAINING) {
    if (!r.id?.startsWith('craft_') || !r.id.includes('pickaxe')) continue
    assert.equal(r.done(b, 0), true, `${r.id} was not satisfied by a better tool`)
  }
})

t('A BOT WITH WOOD IS ASKED FOR A TABLE; a bot with nothing is not', () => {
  const withWood = inv({ oak_log: 20 })
  const empty = inv({})
  const table = SUSTAINING.find(r => r.id === 'craft_crafting_table_1')
  assert.equal(table.done(withWood, 0), false,
    'a bot carrying 20 logs was not asked to make a crafting table')
  assert.equal(table.done(empty, 0), true,
    'a bot with no wood was asked to craft anyway — that is 25 wasted attempts')
})

t('the ladder is ordered cheapest-first', () => {
  const chain = ids(SUSTAINING)
  const at = id => chain.indexOf(id)
  assert.ok(at('craft_crafting_table_1') < at('craft_wooden_pickaxe_1'), 'table after pickaxe')
  assert.ok(at('craft_wooden_pickaxe_1') < at('craft_stone_pickaxe_1'), 'stone before wood')
  assert.ok(at('craft_stone_pickaxe_1') < at('craft_furnace_1'),
    'the furnace is asked for before the pickaxe that supplies its cobblestone')
})

t('the ladder comes AFTER wood is stockpiled', () => {
  const chain = ids(SUSTAINING)
  assert.ok(chain.indexOf('stockpile_wood') < chain.indexOf('craft_crafting_table_1'),
    'asked for a crafting table before any wood was gathered')
})

t('NO RUNG IS A DEADLOCK: every done() returns a boolean on an empty bot', () => {
  // deposit_surplus once blocked the whole chain forever by being unsatisfiable.
  const empty = inv({})
  for (const r of SUSTAINING) {
    if (typeof r.done !== 'function') continue
    const v = r.done(empty, 0, null, 0)
    assert.equal(typeof v, 'boolean', `${r.id} returned ${typeof v}, not a boolean`)
  }
})

t('the gatherer chain itself is left alone as the control case', () => {
  // The role chain keeps its diagnostic character; the ladder is in SUSTAINING.
  const g = ids(MILESTONES_BY_ROLE.gatherer)
  assert.deepEqual(g, ['gather_dirt_16', 'gather_oak_log_12', 'gather_sand_8',
                       'gather_cobblestone_8'],
    'the gatherer control chain was modified; it should not be')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
