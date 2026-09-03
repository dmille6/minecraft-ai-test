// THE SMELT DECISION, TESTED BY BEHAVIOUR.
//
// CLAUDE.md: "Never assert decision logic by matching text. Extract the
// decision." Everything `smelt` decides before it touches the world lives in
// smeltPlan, so all of it can be driven from a plain {name: count} map with no
// bot, no server and no clock -- and every branch below is reachable by
// argument rather than by mocking.
//
// The refusal CHAIN is tested, not the individual guards. Every trap in this
// project's history passed its own unit tests and was created by two correct
// guards meeting where the bot had no legal move, so the interesting assertions
// here are the ones that walk a bot from "nothing" to "an ingot" one refusal at
// a time and check that each step names something it can actually do next.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import {
  SMELT_BATCH_MAX, SMELT_MS_PER_ITEM,
  chooseFuel, fuelTicks, smeltInputsFor, smeltPlan, smeltRecipeFor,
} from '../src/smelting.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// VERBATIM from test/climb-escape.test.mjs:447-458. A mutant that silently
// fails to apply reads as "killed", so the anchor is asserted present AND
// unique before a single byte is written, and the mutant lands in its own
// _mutant-<pid>-<rand>.mjs rather than anywhere near src/.
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  // test/ is one level under bots/, so './x.mjs' has to become '../src/x.mjs'.
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const SMELTING = new URL('../src/smelting.mjs', import.meta.url)

const HOUR = 60 * 60 * 1000        // a budget large enough never to be the binding constraint

// ---------------------------------------------------------------- recipes ---

t('the rung the fleet has never climbed: raw_iron becomes iron_ingot', () => {
  assert.deepEqual(smeltRecipeFor('raw_iron'), { input: 'raw_iron', output: 'iron_ingot' })
  assert.deepEqual(smeltRecipeFor('raw_copper'), { input: 'raw_copper', output: 'copper_ingot' })
})

t('every wood family smelts to charcoal without being listed one by one', () => {
  for (const w of ['oak_log', 'cherry_log', 'stripped_birch_log', 'warped_stem',
                   'crimson_hyphae', 'mangrove_wood']) {
    assert.equal(smeltRecipeFor(w)?.output, 'charcoal', `${w} should smelt to charcoal`)
  }
})

t('a furnace does not transform everything, and the refusal is total', () => {
  // POSITIVE CONTROL for the negatives below: the same function DOES answer.
  assert.ok(smeltRecipeFor('sand'), 'control: sand must smelt, or a null below means nothing')
  for (const bad of ['dirt', 'oak_planks', 'stick', 'diamond', '', null, undefined, 42]) {
    assert.equal(smeltRecipeFor(bad), null, `${JSON.stringify(bad)} must not smelt`)
  }
})

t('smeltInputsFor is the reverse of smeltRecipeFor, and includes the logs', () => {
  assert.ok(smeltInputsFor('iron_ingot').includes('raw_iron'))
  assert.ok(smeltInputsFor('iron_ingot').includes('iron_ore'))
  assert.ok(smeltInputsFor('charcoal').includes('oak_log'))
  // Nothing smelts INTO dirt. Control: the same call finds sand's output.
  assert.ok(smeltInputsFor('glass').includes('sand'), 'control')
  assert.deepEqual(smeltInputsFor('dirt'), [])
})

t('round trip: every input smeltInputsFor names really does produce that output', () => {
  let checked = 0
  for (const out of ['iron_ingot', 'copper_ingot', 'gold_ingot', 'charcoal', 'glass']) {
    for (const inp of smeltInputsFor(out)) {
      assert.equal(smeltRecipeFor(inp)?.output, out, `${inp} -> ${out}`)
      checked++
    }
  }
  assert.ok(checked >= 12, `only ${checked} pairs checked; the loop found nothing to test`)
})

// ------------------------------------------------------------------ fuels ---

t('fuel burn times, and non-fuels burn for zero', () => {
  assert.equal(fuelTicks('coal'), 1600)
  assert.equal(fuelTicks('charcoal'), 1600)
  assert.equal(fuelTicks('oak_planks'), 300)
  assert.equal(fuelTicks('cherry_planks'), 300)      // family rule, not a literal
  assert.equal(fuelTicks('oak_log'), 300)
  assert.equal(fuelTicks('stick'), 100)
  // Control first: the function is capable of returning non-zero.
  assert.ok(fuelTicks('coal') > 0, 'control')
  for (const n of ['raw_iron', 'dirt', 'iron_ingot', '', null]) {
    assert.equal(fuelTicks(n), 0, `${JSON.stringify(n)} must not burn`)
  }
})

t('one coal smelts exactly SMELT_BATCH_MAX items', () => {
  // The constant is not arbitrary: it is one coal's worth, and if either
  // number moves without the other this fails.
  assert.equal(Math.floor(fuelTicks('coal') / (SMELT_MS_PER_ITEM / 50)), SMELT_BATCH_MAX)
})

t('fuel preference is about REGRET: sticks are burned last', () => {
  // A bot holding coal and sticks must burn the coal -- two sticks are half a
  // pickaxe and this project has already shipped one change that quietly
  // consumed the materials for the tool the bot was building.
  assert.equal(chooseFuel({ stick: 64, coal: 1 }).name, 'coal')
  assert.equal(chooseFuel({ stick: 64, oak_planks: 1 }).name, 'oak_planks')
  // Planks before logs: same 300 ticks, and the log is worth four planks.
  assert.equal(chooseFuel({ oak_log: 64, oak_planks: 1 }).name, 'oak_planks')
  // Charcoal before coal: charcoal has no other use in this tech tree.
  assert.equal(chooseFuel({ coal: 64, charcoal: 1 }).name, 'charcoal')
  // Only sticks left? Then sticks, rather than refusing.
  assert.equal(chooseFuel({ stick: 4 }).name, 'stick')
  assert.equal(chooseFuel({ raw_iron: 64, dirt: 64 }), null)
})

// ------------------------------------------------------- the refusal chain ---
//
// One bot, walked from nothing to an ingot. At every step the refusal must
// name something the bot can DO from where it is standing, and the next step
// must be the state that doing it produces.

t('CHAIN: each refusal names the exact next move, and taking it advances', () => {
  const item = 'raw_iron'

  // 0. asked to smelt something no furnace will ever transform
  const dirt = smeltPlan({ held: { dirt: 64 }, item: 'dirt', budgetMs: HOUR })
  assert.equal(dirt.ok, false)
  assert.equal(dirt.reason, 'not_smeltable')
  assert.equal(dirt.need, undefined, 'a permanent truth needs no prerequisite to fetch')

  // 1. nothing to smelt -> go and get the ore
  const empty = smeltPlan({ held: {}, item, budgetMs: HOUR })
  assert.equal(empty.reason, 'no_input')
  assert.deepEqual(empty.need.items, ['raw_iron'])
  assert.ok(empty.need.count >= 1)

  // 2. holds the ore, no furnace -> the remedy is `craft furnace`, which the
  //    existing TECH_LADDER already treats as reachable from 8 cobblestone.
  const noStation = smeltPlan({ held: { raw_iron: 3, coal: 1 }, item, budgetMs: HOUR,
                               hasFurnace: false })
  assert.equal(noStation.reason, 'no_furnace')
  assert.deepEqual(noStation.need.items, ['furnace'])

  // 3. ore and furnace, nothing to burn -> the remedy names FOUR fuels, three of
  //    which a surface bot gets from a tree and one from an ore. Executable
  //    above ground and below it, which is what "from where it is" means.
  const noFuel = smeltPlan({ held: { raw_iron: 3 }, item, budgetMs: HOUR })
  assert.equal(noFuel.reason, 'no_fuel')
  assert.ok(noFuel.need.items.includes('coal'))
  assert.ok(noFuel.need.items.some(n => /_log$|_planks$/.test(n)),
    'a sealed-in bot needs an ore route AND a surface bot needs a wood route')

  // 4. everything present -> a plan, not a refusal. THE CHAIN TERMINATES.
  const go = smeltPlan({ held: { raw_iron: 3, coal: 1 }, item, count: 3, budgetMs: HOUR })
  assert.equal(go.ok, true)
  assert.equal(go.output, 'iron_ingot')
  assert.equal(go.batch, 3)
  assert.equal(go.fuel.name, 'coal')
  assert.equal(go.fuel.count, 1, 'one coal covers 8 items, so 3 needs one')
})

t('CHAIN: no state satisfies two refusals at once with no move between them', () => {
  // The trap shape from CLAUDE.md is two correct guards meeting where the bot
  // has no legal move. Enumerate the corners and assert every refusal carries a
  // need, and that acting on that need does not land on the SAME refusal again.
  const corners = [
    {},
    { raw_iron: 1 },
    { coal: 1 },
    { raw_iron: 1, coal: 1 },
    { raw_iron: 1, furnace: 1 },
  ]
  let seen = 0
  for (const held of corners) {
    for (const hasFurnace of [true, false]) {
      const r = smeltPlan({ held, item: 'raw_iron', budgetMs: HOUR, hasFurnace })
      if (r.ok) continue
      seen++
      assert.ok(r.need, `refusal ${r.reason} for ${JSON.stringify(held)} names no remedy`)
      // Grant the remedy and re-plan. The new state must not produce the same
      // refusal -- that is the definition of a dead end.
      const after = { ...held }
      for (const it of r.need.items.slice(0, 1)) after[it] = (after[it] ?? 0) + r.need.count
      const again = smeltPlan({ held: after, item: 'raw_iron', budgetMs: HOUR,
                               hasFurnace: hasFurnace || r.reason === 'no_furnace' })
      assert.notEqual(again.reason, r.reason,
        `granting the remedy for ${r.reason} left the bot on ${r.reason} again`)
    }
  }
  assert.ok(seen >= 4, `only ${seen} refusals exercised; the corners found nothing`)
})

// ------------------------------------------------------------ the batching ---

t('THE CLOCK IS A CEILING: a short budget shrinks the batch, it does not refuse', () => {
  const held = { raw_iron: 64, coal: 64 }
  assert.equal(smeltPlan({ held, item: 'raw_iron', count: 64, budgetMs: HOUR }).batch,
               SMELT_BATCH_MAX, 'capped at one coal even with an hour')
  assert.equal(smeltPlan({ held, item: 'raw_iron', count: 64,
                          budgetMs: 3 * SMELT_MS_PER_ITEM }).batch, 3)
  assert.equal(smeltPlan({ held, item: 'raw_iron', count: 64,
                          budgetMs: SMELT_MS_PER_ITEM }).batch, 1)
})

t('no time for even one item is a REFUSAL, never a batch of zero', () => {
  const r = smeltPlan({ held: { raw_iron: 8, coal: 8 }, item: 'raw_iron', count: 8,
                       budgetMs: SMELT_MS_PER_ITEM - 1 })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'budget_too_small')
})

t('the batch never exceeds what the held fuel can actually burn', () => {
  // 1 oak_planks = 300 ticks = one item and a half. Asking for 8 must not
  // promise 8, or the skill reports a batch it can never finish and the
  // shortfall reads as a failure instead of a smaller job.
  const r = smeltPlan({ held: { raw_iron: 8, oak_planks: 1 }, item: 'raw_iron',
                        count: 8, budgetMs: HOUR })
  assert.equal(r.ok, true)
  assert.equal(r.batch, 1)
  assert.equal(r.fuel.name, 'oak_planks')
  assert.equal(r.fuel.count, 1)
})

t('the batch never exceeds what is held', () => {
  const r = smeltPlan({ held: { raw_iron: 2, coal: 64 }, item: 'raw_iron', count: 64,
                        budgetMs: HOUR })
  assert.equal(r.batch, 2)
})

t('BURNING THE INPUT: a bot with one log does not burn the log it is smelting', () => {
  // oak_log is both the input (-> charcoal) and a valid fuel. With exactly one,
  // spending it as fuel leaves nothing to smelt -- a plan that consumes its own
  // subject. This is the composition bug in miniature.
  const one = smeltPlan({ held: { oak_log: 1 }, item: 'oak_log', budgetMs: HOUR })
  assert.equal(one.ok, false)
  assert.equal(one.reason, 'no_fuel', 'one log cannot be both the fuel and the input')

  // With two, the split is legal and must be exactly one each.
  const two = smeltPlan({ held: { oak_log: 2 }, item: 'oak_log', count: 2, budgetMs: HOUR })
  assert.equal(two.ok, true)
  assert.equal(two.output, 'charcoal')
  assert.equal(two.batch + two.fuel.count, 2,
    `the plan spends ${two.batch} + ${two.fuel.count} of 2 held logs`)

  // And with a real fuel present the log is never burned at all.
  const withCoal = smeltPlan({ held: { oak_log: 1, coal: 1 }, item: 'oak_log', budgetMs: HOUR })
  assert.equal(withCoal.ok, true)
  assert.equal(withCoal.fuel.name, 'coal')
  assert.equal(withCoal.batch, 1)
})

// ---------------------------------------------------------------- mutants ---
//
// Each proves a specific line is load-bearing. A source test that has never
// been seen to fail is not a test.

await ta('MUTANT KILLED: without the clock ceiling, the batch outruns the budget',
  () => withMutant(SMELTING,
    '    byClock,\n',
    '',
    m => {
      const r = m.smeltPlan({ held: { raw_iron: 64, coal: 64 }, item: 'raw_iron',
                              count: 8, budgetMs: m.SMELT_MS_PER_ITEM })
      // The mutant plans 8 items -- 80 seconds -- against a 10-second budget.
      // That is the trap shape: a skill holding the body far longer than the
      // layer above it expects.
      assert.ok(r.ok && r.batch > 1,
        'mutant should have planned a batch the clock cannot afford')
      const real = smeltPlan({ held: { raw_iron: 64, coal: 64 }, item: 'raw_iron',
                               count: 8, budgetMs: SMELT_MS_PER_ITEM })
      assert.equal(real.batch, 1, 'the real thing must bound the batch by the clock')
    }))

await ta('MUTANT KILLED: without the fuel solve, a plan promises more than it can burn',
  () => withMutant(SMELTING,
    '    if (fuelCount <= affordable) break\n    batch--',
    '    break',
    m => {
      const r = m.smeltPlan({ held: { raw_iron: 8, oak_planks: 1 }, item: 'raw_iron',
                              count: 8, budgetMs: HOUR })
      assert.ok(r.ok, 'mutant still plans')
      // The mutant plans to burn 6 planks it does not have: ceil(8*200/300).
      assert.ok(r.fuel.count > 1,
        `mutant should promise to burn fuel it lacks, planned ${r.fuel.count}x from 1 held`)
      const real = smeltPlan({ held: { raw_iron: 8, oak_planks: 1 }, item: 'raw_iron',
                              count: 8, budgetMs: HOUR })
      assert.ok(real.fuel.count <= 1, 'the real thing never spends fuel it does not hold')
      assert.ok(real.batch * 200 <= real.fuel.count * 300, 'and the batch fits the burn time')
    }))

await ta('MUTANT KILLED: without the same-stack guard, the bot burns its only log',
  () => withMutant(SMELTING,
    "  const usable = fuel && fuel.name === input && fuel.count < 2\n    ? chooseFuel(held, { exclude: input })\n    : fuel",
    '  const usable = fuel',
    m => {
      const r = m.smeltPlan({ held: { oak_log: 1 }, item: 'oak_log', budgetMs: HOUR })
      // The mutant is happy to nominate the single log as its own fuel.
      assert.ok(r.ok === false ? r.reason !== 'no_fuel' : true,
        'mutant must not reach the correct no_fuel refusal')
      const real = smeltPlan({ held: { oak_log: 1 }, item: 'oak_log', budgetMs: HOUR })
      assert.equal(real.reason, 'no_fuel', 'the real thing refuses rather than self-consuming')
    }))

await ta('MUTANT KILLED: without the stick demotion, a bot burns half a pickaxe',
  () => withMutant(SMELTING,
    "                    'dried_kelp_block', 'bamboo', '*_planks', '*_log', 'stick']",
    "                    'dried_kelp_block', 'bamboo', 'stick', '*_planks', '*_log']",
    m => {
      assert.equal(m.chooseFuel({ stick: 2, oak_planks: 64 }).name, 'stick',
        'mutant should reach for the sticks')
      assert.equal(chooseFuel({ stick: 2, oak_planks: 64 }).name, 'oak_planks',
        'the real thing spends the planks')
    }))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
