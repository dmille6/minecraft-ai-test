// A BOT WITH 150 OAK LOGS FAILED TO SMELT BECAUSE IT PICKED 2 BAMBOO.
//
// `chooseFuel` returned the lowest-REGRET fuel it could find and left the
// caller to discover, in front of the furnace, that there was not enough of it.
// Bamboo outranks planks and logs on regret -- correctly, it has no other use
// in this tech tree -- but it burns 50 ticks against their 300, so one item
// needs FOUR bamboo.
//
// Measured 2026-09-08: "not enough bamboo to smelt even one raw_iron" was 12 of
// 27 smelt failures. Smelting is the rung between raw iron and every tool above
// stone, and 49 of 80 bots are parked at furnace.
import assert from 'node:assert'
import test from 'node:test'
import { chooseFuel, fuelTicks, smeltPlan, SMELT_TICKS } from '../src/smelting.mjs'

test('the burn times that make this a bug at all', () => {
  assert.equal(fuelTicks('bamboo'), 50)
  assert.equal(fuelTicks('oak_planks'), 300)
  assert.equal(fuelTicks('oak_log'), 300)
  assert.equal(fuelTicks('coal'), 1600)
  assert.equal(SMELT_TICKS, 200, 'one item needs 200 ticks = 4 bamboo, or 1 plank')
})

test('THE BUG: 2 bamboo is not chosen over 150 logs', () => {
  const held = { bamboo: 2, oak_log: 150, raw_iron: 3 }
  const f = chooseFuel(held, { needTicks: SMELT_TICKS })
  assert.equal(f.name, 'oak_log', 'bamboo cannot finish one item; the logs can')
})

test('...and bamboo IS chosen when there is enough of it', () => {
  // The regret ordering is right and must survive. Four bamboo is 200 ticks.
  const f = chooseFuel({ bamboo: 4, oak_log: 150 }, { needTicks: SMELT_TICKS })
  assert.equal(f.name, 'bamboo', 'affordable bamboo still beats a log on regret')
})

test('coal still wins outright — the preference order is unchanged', () => {
  const f = chooseFuel({ coal: 1, bamboo: 64, oak_planks: 64 }, { needTicks: SMELT_TICKS })
  assert.equal(f.name, 'coal')
})

test('sticks stay last: two of them are half a pickaxe', () => {
  const f = chooseFuel({ stick: 64, oak_planks: 1 }, { needTicks: SMELT_TICKS })
  assert.equal(f.name, 'oak_planks', 'a single plank is affordable and cheaper to lose')
})

test('when NOTHING is affordable it still returns the best available', () => {
  // Falling back preserves the old behaviour, so this change can only turn a
  // refusal into an attempt -- never the reverse. The batch loop downstream
  // makes the final call.
  const f = chooseFuel({ bamboo: 2, stick: 1 }, { needTicks: SMELT_TICKS })
  assert.ok(f, 'must not return null just because the job is unaffordable')
  assert.equal(f.name, 'bamboo', 'the most total ticks available: 2x50 beats 1x100')
})

test('nothing burnable is still nothing', () => {
  assert.equal(chooseFuel({ raw_iron: 64, cobblestone: 64 }, { needTicks: SMELT_TICKS }), null)
  assert.equal(chooseFuel({}, { needTicks: SMELT_TICKS }), null)
  assert.equal(chooseFuel(null), null)
  assert.equal(chooseFuel({ oak_log: 0 }), null, 'a zero count is not held')
})

test('exclude still works, and composes with affordability', () => {
  const f = chooseFuel({ oak_log: 150, bamboo: 8 }, { exclude: 'oak_log', needTicks: SMELT_TICKS })
  assert.equal(f.name, 'bamboo')
})

test('END TO END: the real inventory that produced the failure now plans', () => {
  // POSITIVE CONTROL for the whole file — the pure function is only useful if
  // the plan it feeds actually succeeds.
  const held = { raw_iron: 3, bamboo: 2, oak_log: 150, cobblestone: 40 }
  const plan = smeltPlan({ held, item: 'raw_iron', count: 1,
                           budgetMs: 240000, hasFurnace: true })
  assert.ok(plan.ok, 'must plan, not refuse: ' + JSON.stringify(plan))
  assert.equal(plan.fuel.name, 'oak_log')
  assert.ok(plan.batch >= 1)
})

test('and the same inventory WITHOUT logs still refuses honestly', () => {
  // If this passed too, the change would be "always succeed", which is worse.
  const plan = smeltPlan({ held: { raw_iron: 3, bamboo: 2 }, item: 'raw_iron',
                           count: 1, budgetMs: 240000, hasFurnace: true })
  assert.equal(plan.ok, false)
  assert.match(plan.detail, /not enough bamboo/)
})
