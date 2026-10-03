// THE CRAFT TREE FROM LOGS (sandbox, c5c2dc5): with exact craft counts, `craft wooden_pickaxe` from logs alone
// failed 6/6 -- "needs 3x oak_planks (you have 2x)". The resolver made each missing ingredient for its parent
// alone and had been living on the old over-crafting for slack: planks +4, sticks -2, planks +4, table -4,
// retry -> MAX_CRAFT_DEPTH. craftplan.mjs sums the demand of the whole remaining tree and crafts each
// intermediate once.
//
// The skill runs for real: skills.mjs's craft -> craftsync -> mineflayer's craft.js/inventory.js -> the fake
// Paper, in a flat fake world where it can put the table it makes down. Server counts are the oracle.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as CS from '../src/craftsync.mjs'
import { planCraftTree, chooseRecipe } from '../src/craftplan.mjs'
import { FakePaper, craftBot, learnAll, fakeWorld } from './helpers/fake-paper-craft.mjs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-craftlogs-'))
process.env.SKILL_TIMEOUT_MS = '180000'   // the craft deadline is the runner's timeout; the suite's 300 ms leaves none
const { SKILLS } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// ------------------------------------------------------------------ the planner, pure
const R = {
  wooden_pickaxe: { yield: 1, table: true, ingredients: [{ name: 'oak_planks', count: 3 }, { name: 'stick', count: 2 }] },
  stone_pickaxe: { yield: 1, table: true, ingredients: [{ name: 'cobblestone', count: 3 }, { name: 'stick', count: 2 }] },
  stick: { yield: 4, table: false, ingredients: [{ name: 'oak_planks', count: 2 }] },
  crafting_table: { yield: 1, table: false, ingredients: [{ name: 'oak_planks', count: 4 }] },
  oak_planks: { yield: 4, table: false, ingredients: [{ name: 'oak_log', count: 1 }] },
}
const recipeOf = n => R[n] ?? null
const plan = (item, have, tableReady = false) => planCraftTree({ item, count: 1, rootRecipe: R[item], recipeOf, have, tableReady })
const crafts = p => Object.fromEntries(p.steps.map(s => [s.item, s.crafts]))

await t('PLAN: wooden_pickaxe from 3 logs, no table -> 3 plank crafts (3 + 2 + 4 planks), 1 stick, 1 table', () => {
  const p = plan('wooden_pickaxe', { oak_log: 3 })
  assert.deepEqual(crafts(p), { oak_planks: 3, stick: 1, crafting_table: 1 })
  assert.equal(p.rootCrafts, 1)
  assert.deepEqual(p.raw, [])
  assert.equal(p.steps[0].item, 'oak_planks', 'producers first')
})
await t('PLAN: with a table in reach the table\'s planks are not made', () => {
  assert.deepEqual(crafts(plan('wooden_pickaxe', { oak_log: 3 }, true)), { oak_planks: 2, stick: 1 })
})
await t('PLAN: what is held is used first; a shortfall of a raw material is reported, not crafted around', () => {
  assert.deepEqual(crafts(plan('wooden_pickaxe', { oak_log: 1, oak_planks: 5, stick: 2 })), { oak_planks: 1, crafting_table: 1 })
  const short = plan('wooden_pickaxe', { oak_log: 2 })
  assert.deepEqual(short.raw, [{ item: 'oak_log', count: 1 }])
})
await t('PLAN: stone_pickaxe from logs + cobblestone, no table -> 2 plank crafts (2 + 4), 1 stick, 1 table', () => {
  assert.deepEqual(crafts(plan('stone_pickaxe', { oak_log: 2, cobblestone: 3 })), { oak_planks: 2, stick: 1, crafting_table: 1 })
})
await t('chooseRecipe: a variant made from what is held beats one that is not', () => {
  const birch = { yield: 4, table: false, ingredients: [{ name: 'birch_planks', count: 2 }] }
  const oak = { yield: 4, table: false, ingredients: [{ name: 'oak_planks', count: 2 }] }
  const recipes = n => n === 'oak_planks' ? [R.oak_planks] : n === 'birch_planks' ? [{ yield: 4, table: false, ingredients: [{ name: 'birch_log', count: 1 }] }] : []
  assert.equal(chooseRecipe([birch, oak], { oak_log: 2 }, recipes), oak)
  assert.equal(chooseRecipe([birch, oak], { birch_planks: 2 }, recipes), birch)
})

// ------------------------------------------------------------------ the skill, for real
async function skill (inv, item, count = 1) {
  const server = new FakePaper({ lagClicks: 3, fallbackMs: 60, inventory: inv })
  const bot = craftBot(server)
  const placed = fakeWorld(bot, server)
  await server.sync()
  CS.installCraftSync(bot, {})
  learnAll(bot, server, ['wooden_pickaxe', 'stone_pickaxe', 'stick', 'crafting_table', 'oak_planks'])
  const out = await SKILLS.craft.run({ bot }, { item, count }, new AbortController().signal)
  await server.settle(); server.stop()
  const n = name => server.count(name)
  return { out, n, placed: [...placed.values()] }
}

await t('SKILL: wooden_pickaxe from 3 logs, no table -> success; 3 planks + 2 sticks left, table placed', async () => {
  const { out, n, placed } = await skill({ 36: ['oak_log', 3], 9: ['dirt', 64] }, 'wooden_pickaxe')
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual([n('wooden_pickaxe'), n('oak_planks'), n('stick'), n('oak_log'), n('crafting_table')], [1, 3, 2, 0, 0])
  assert.deepEqual(placed, ['crafting_table'])
})
await t('SKILL: wooden_pickaxe from 4 logs, no table -> success; 1 log left over', async () => {
  const { out, n } = await skill({ 36: ['oak_log', 4], 9: ['dirt', 64] }, 'wooden_pickaxe')
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual([n('wooden_pickaxe'), n('oak_planks'), n('stick'), n('oak_log')], [1, 3, 2, 1])
})
await t('SKILL: stone_pickaxe from 2 logs + 3 cobblestone, no table -> success; 2 planks + 2 sticks left', async () => {
  const { out, n } = await skill({ 36: ['oak_log', 2], 37: ['cobblestone', 3], 9: ['dirt', 64] }, 'stone_pickaxe')
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual([n('stone_pickaxe'), n('oak_planks'), n('stick'), n('cobblestone'), n('oak_log')], [1, 2, 2, 0, 0])
})
await t('SKILL: wooden_pickaxe from 2 logs says which raw material is short and crafts nothing', async () => {
  const { out, n } = await skill({ 36: ['oak_log', 2], 9: ['dirt', 64] }, 'wooden_pickaxe')
  assert.notEqual(out.status, 'success')
  assert.match(out.detail, /oak_log/)
  assert.equal(n('oak_log'), 2, 'logs were spent on a tree that could not finish')
})
await t('SKILL: a direct request stays exact, and the success line states what was PRODUCED', async () => {
  const { out, n } = await skill({ 36: ['oak_planks', 4], 9: ['dirt', 64] }, 'stick', 5)
  assert.equal(out.status, 'success', out.detail)
  assert.equal(n('stick'), 8, '5 sticks is 2 crafts of 4')
  assert.match(out.detail, /^crafted 8x stick/)
})

// ------------------------------------------------------------------ mutants: each must reproduce the regression
const SRC = new URL('../src/craftplan.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = fs.readFileSync(SRC, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
await t('MUTANT KILLED: per-ingredient minimal crafting (each consumer alone) under-makes the shared planks', async () => {
  await withMutant('    for (const ing of r.ingredients) demand[ing.name] = (demand[ing.name] ?? 0) + ing.count * n',
    '    for (const ing of r.ingredients) demand[ing.name] = Math.max(demand[ing.name] ?? 0, ing.count * n)', async mod => {
      const p = mod.planCraftTree({ item: 'wooden_pickaxe', count: 1, rootRecipe: R.wooden_pickaxe, recipeOf, have: { oak_log: 3 } })
      assert.ok(crafts(p).oak_planks < 3, 'the mutant still sums the demand; the plan test proves nothing')
    })
})
await t('MUTANT KILLED: the table\'s planks left out of the plan', async () => {
  await withMutant("  if (needsTable) demand.crafting_table = (demand.crafting_table ?? 0) + 1\n", '', async mod => {
    const p = mod.planCraftTree({ item: 'wooden_pickaxe', count: 1, rootRecipe: R.wooden_pickaxe, recipeOf, have: { oak_log: 3 } })
    assert.ok(!crafts(p).crafting_table && crafts(p).oak_planks < 3, 'the mutant still plans the table')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
