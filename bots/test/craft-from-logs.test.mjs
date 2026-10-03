// THE CRAFT PLAN (craftplan.mjs) and the resolver that executes it, on the REAL 1.21.8 recipes.
//
// History: with exact craft counts (craftsync) `craft wooden_pickaxe` from logs failed 6/6 on the sandbox -- the
// per-ingredient resolver had lived on over-crafting. The first planner (db359f2) fixed that case and both third
// reviews broke it five ways against the real recipes: root inventory subtracted, one-variant choice, a far table
// counted as ready, a one-craft station shortcut that spent planks, and iron cycles. Each has a test here.
//
// Planner tests use mineflayer's own recipe list (12 wooden_pickaxe variants, 13 stick, ...). Skill tests run
// skills.mjs's craft -> craftsync -> mineflayer's craft.js/inventory.js -> the fake Paper, in a flat fake world;
// the SERVER's counts are the oracle.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as CS from '../src/craftsync.mjs'
import { planCraft, mergeSteps } from '../src/craftplan.mjs'
import { FakePaper, craftBot, learnAll, fakeWorld } from './helpers/fake-paper-craft.mjs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-craftlogs-'))
process.env.SKILL_TIMEOUT_MS = '180000'   // the craft deadline is the runner's timeout; the suite's 300 ms leaves none
const { SKILLS } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// ------------------------------------------------------------------ the planner on the real recipes
const reg = craftBot(new FakePaper({})).registry
const probe = craftBot(new FakePaper({}))
const made = r => (r.delta ?? []).filter(d => d.count > 0).reduce((n, d) => n + d.count, 0)
const shape = r => ({ ref: r, yield: r.result?.count || made(r) || 1, table: !!r.requiresTable,
  ingredients: (r.delta ?? []).filter(d => d.count < 0).map(d => ({ name: reg.items[d.id]?.name, count: -d.count })) })
const recipesOf = name => { const d = reg.itemsByName[name]; return d ? probe.recipesAll(d.id, null, true).map(shape) : [] }
const prefer = r => r.ingredients.filter(i => /^oak_/.test(i.name)).length
const plan = (item, have, tableReady = false, count = 1, extra = {}) => planCraft({ item, count, recipesOf, have, tableReady, prefer, ...extra })
const total = (p, item) => p.steps.filter(s => s.item === item).reduce((n, s) => n + s.crafts, 0)
const woods = p => [...new Set(p.steps.flatMap(s => s.recipe.ingredients.map(i => i.name)).filter(n => /_planks$|_log$/.test(n)))].sort()

await t('PLAN: wooden_pickaxe from 3 oak logs, no table -> 3 plank crafts, 1 stick, 1 table, the pickaxe last', () => {
  const p = plan('wooden_pickaxe', { oak_log: 3 })
  assert.ok(p.ok, JSON.stringify(p.shortfall))
  assert.deepEqual([total(p, 'oak_planks'), total(p, 'stick'), total(p, 'crafting_table'), total(p, 'wooden_pickaxe')], [3, 1, 1, 1])
  assert.equal(p.steps.at(-1).item, 'wooden_pickaxe')
})
await t('ROOT DEMAND: holding a wooden_pickaxe, asking for one plans ANOTHER', () => {
  const p = plan('wooden_pickaxe', { wooden_pickaxe: 1, oak_log: 2 }, true)
  assert.ok(p.ok, JSON.stringify(p.shortfall))
  assert.equal(total(p, 'wooden_pickaxe'), 1, 'the held pickaxe was subtracted from the request')
})
await t('VARIANTS BY QUANTITY: 2 oak_log + 1 birch_log makes a wooden_pickaxe (needs 9 planks of two kinds)', () => {
  const p = plan('wooden_pickaxe', { oak_log: 2, birch_log: 1 })
  assert.ok(p.ok, `refused: ${JSON.stringify(p.shortfall)}`)
  assert.deepEqual(woods(p), ['birch_log', 'birch_planks', 'oak_log', 'oak_planks'])
})
await t('VARIANTS BY QUANTITY: 1 oak_log + 2 birch_log too', () => {
  assert.ok(plan('wooden_pickaxe', { oak_log: 1, birch_log: 2 }).ok)
})
await t('VARIANTS BY QUANTITY: 1 birch_planks + 3 oak_log takes the oak path and leaves the birch alone', () => {
  const p = plan('wooden_pickaxe', { birch_planks: 1, oak_log: 3 })
  assert.ok(p.ok, JSON.stringify(p.shortfall))
  assert.deepEqual(woods(p), ['oak_log', 'oak_planks'])
})
await t('STATION + BATCH: 4 planks + 2 sticks, no table, no logs -> refused up front, naming the log; nothing planned', () => {
  const p = plan('wooden_pickaxe', { oak_planks: 4, stick: 2 })
  assert.equal(p.ok, false, 'the planks would have become a table and then a refusal')
  assert.deepEqual(p.shortfall, [{ item: 'oak_log', count: 1 }])
  assert.deepEqual(p.steps, [])
})
await t('BATCH: the full quantity is planned -- 3 pickaxes need 13 planks: 3 logs short, 4 logs enough', () => {
  const short = plan('wooden_pickaxe', { oak_log: 3 }, true, 3)
  assert.equal(short.ok, false)
  assert.deepEqual(short.shortfall, [{ item: 'oak_log', count: 1 }])
  const p = plan('wooden_pickaxe', { oak_log: 4 }, true, 3)
  assert.ok(p.ok); assert.equal(total(p, 'wooden_pickaxe'), 3)
})
await t('CYCLES: iron_pickaxe with 1 iron_ingot + 2 sticks -> exactly "2x iron_ingot", no loop', () => {
  const p = plan('iron_pickaxe', { iron_ingot: 1, stick: 2 }, true)
  assert.equal(p.ok, false)
  assert.deepEqual(p.shortfall, [{ item: 'iron_ingot', count: 2 }])
  assert.equal(p.limit, false, 'it ran into the node budget: the cycle was walked')
})
await t('CYCLES: an iron_ingot is never "made" from the held one (ingot -> nuggets -> ingot)', () => {
  const p = plan('iron_ingot', { iron_ingot: 1 }, true)
  assert.equal(p.ok, false, `planned a conversion loop: ${p.steps.map(s => s.item).join(' > ')}`)
})
await t('CYCLES: iron_pickaxe with 3 ingots is one craft; with 27 nuggets it goes through ingots', () => {
  const a = plan('iron_pickaxe', { iron_ingot: 3, stick: 2 }, true)
  assert.ok(a.ok); assert.deepEqual(a.steps.map(s => s.item), ['iron_pickaxe'])
  const b = plan('iron_pickaxe', { iron_nugget: 27, stick: 2 }, true)
  assert.ok(b.ok); assert.deepEqual(b.steps.map(s => `${s.item}x${s.crafts}`), ['iron_ingotx3', 'iron_pickaxex1'])
})
await t('LIMITS: an exhausted node budget fails the plan explicitly and plans nothing', () => {
  const p = plan('wooden_pickaxe', { oak_log: 3 }, false, 1, { maxNodes: 1 })
  assert.equal(p.ok, false)
  assert.equal(p.limit, true)
  assert.deepEqual(p.steps, [])
  assert.ok(p.shortfall.length > 0, 'a limit must still say what is short')
})
await t('mergeSteps: same recipe joins an earlier step unless something between makes its inputs', () => {
  const A = { ingredients: [{ name: 'oak_log', count: 1 }] }, B = { ingredients: [{ name: 'oak_planks', count: 4 }] }
  assert.deepEqual(mergeSteps([{ item: 'p', crafts: 1, recipe: A }, { item: 't', crafts: 1, recipe: B }, { item: 'p', crafts: 2, recipe: A }])
    .map(s => `${s.item}x${s.crafts}`), ['px3', 'tx1'])
  const C = { ingredients: [{ name: 'p', count: 1 }] }
  assert.deepEqual(mergeSteps([{ item: 'x', crafts: 1, recipe: C }, { item: 'p', crafts: 1, recipe: A }, { item: 'x', crafts: 1, recipe: C }])
    .map(s => `${s.item}x${s.crafts}`), ['xx1', 'px1', 'xx1'])
})

// ------------------------------------------------------------------ the skill, for real
async function skill (inv, item, count = 1, { tableAt = null } = {}) {
  const server = new FakePaper({ lagClicks: 3, fallbackMs: 60, inventory: inv })
  const bot = craftBot(server)
  const placed = fakeWorld(bot, server)
  if (tableAt) placed.set(tableAt, 'crafting_table')
  await server.sync()
  CS.installCraftSync(bot, {})
  learnAll(bot, server, ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'stick', 'crafting_table', 'oak_planks', 'birch_planks', 'iron_ingot'])
  const out = await SKILLS.craft.run({ bot }, { item, count }, new AbortController().signal)
  await server.settle(); server.stop()
  return { out, n: name => server.count(name), placed: [...placed.values()] }
}
const NEXT_TO = '1,64,0', FAR = '10,64,0'

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
await t('SKILL: stone_pickaxe from 2 logs + 3 cobblestone, no table -> success', async () => {
  const { out, n } = await skill({ 36: ['oak_log', 2], 37: ['cobblestone', 3], 9: ['dirt', 64] }, 'stone_pickaxe')
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual([n('stone_pickaxe'), n('oak_planks'), n('stick'), n('cobblestone'), n('oak_log')], [1, 2, 2, 0, 0])
})
await t('SKILL ROOT DEMAND: 1 wooden_pickaxe held + 2 logs + a table beside it -> a second pickaxe', async () => {
  const { out, n } = await skill({ 36: ['oak_log', 2], 37: ['wooden_pickaxe', 1], 9: ['dirt', 64] }, 'wooden_pickaxe', 1, { tableAt: NEXT_TO })
  assert.equal(out.status, 'success', out.detail)
  assert.equal(n('wooden_pickaxe'), 2)
})
await t('SKILL VARIANTS: 2 oak_log + 1 birch_log -> wooden_pickaxe', async () => {
  const { out, n } = await skill({ 36: ['oak_log', 2], 37: ['birch_log', 1], 9: ['dirt', 64] }, 'wooden_pickaxe')
  assert.equal(out.status, 'success', out.detail)
  assert.equal(n('wooden_pickaxe'), 1)
})
await t('SKILL VARIANTS: 1 birch_planks + 3 oak_log -> the oak path; the birch plank is untouched', async () => {
  const { out, n } = await skill({ 36: ['oak_log', 3], 37: ['birch_planks', 1], 9: ['dirt', 64] }, 'wooden_pickaxe')
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual([n('wooden_pickaxe'), n('birch_planks')], [1, 1])
})
await t('SKILL KEEPS THE CHOSEN RECIPES: 3 birch + 2 oak planks at a table -> sticks from OAK, head from birch', async () => {
  // The only plan: the head takes all 3 birch, so the sticks must be oak. Re-choosing at execution (mineflayer's
  // first satisfiable stick variant is birch) spends the head's birch on sticks and the head then cannot be made.
  const { out, n } = await skill({ 36: ['birch_planks', 3], 37: ['oak_planks', 2], 9: ['dirt', 64] }, 'wooden_pickaxe', 1, { tableAt: NEXT_TO })
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual([n('wooden_pickaxe'), n('birch_planks'), n('oak_planks'), n('stick')], [1, 0, 0, 2])
})
await t('SKILL STATION GATE: 4 planks + 2 sticks, no table, no logs -> refused, nothing spent, the log named', async () => {
  const { out, n, placed } = await skill({ 36: ['oak_planks', 4], 37: ['stick', 2], 9: ['dirt', 64] }, 'wooden_pickaxe')
  assert.notEqual(out.status, 'success')
  assert.match(out.detail, /oak_log/)
  assert.deepEqual([n('oak_planks'), n('stick'), n('crafting_table')], [4, 2, 0])
  assert.deepEqual(placed, [])
})
await t('SKILL TABLE READINESS: a table out of reach is not ready -- 2 logs are refused, nothing spent', async () => {
  const { out, n } = await skill({ 36: ['oak_log', 2], 9: ['dirt', 64] }, 'wooden_pickaxe', 1, { tableAt: FAR })
  assert.notEqual(out.status, 'success')
  assert.equal(n('oak_log'), 2, 'logs were spent on a tree that needed the far table')
})
await t('SKILL TABLE READINESS: ... and 3 logs make a new table beside the bot', async () => {
  const { out, n, placed } = await skill({ 36: ['oak_log', 3], 9: ['dirt', 64] }, 'wooden_pickaxe', 1, { tableAt: FAR })
  assert.equal(out.status, 'success', out.detail)
  assert.equal(n('wooden_pickaxe'), 1)
  assert.equal(placed.length, 2)
})
await t('SKILL CYCLES: iron_pickaxe from 3 ingots + 2 sticks at a table -> made; from 1 ingot -> "2x iron_ingot"', async () => {
  const a = await skill({ 36: ['iron_ingot', 3], 37: ['stick', 2], 9: ['dirt', 64] }, 'iron_pickaxe', 1, { tableAt: NEXT_TO })
  assert.equal(a.out.status, 'success', a.out.detail)
  assert.equal(a.n('iron_pickaxe'), 1)
  const b = await skill({ 36: ['iron_ingot', 1], 37: ['stick', 2], 9: ['dirt', 64] }, 'iron_pickaxe', 1, { tableAt: NEXT_TO })
  assert.notEqual(b.out.status, 'success')
  assert.match(b.out.detail, /2x iron_ingot/)
  assert.equal(b.n('iron_ingot'), 1)
})
await t('SKILL: a direct request stays exact, and the success line states what was PRODUCED', async () => {
  const { out, n } = await skill({ 36: ['oak_planks', 4], 9: ['dirt', 64] }, 'stick', 5)
  assert.equal(out.status, 'success', out.detail)
  assert.equal(n('stick'), 8, '5 sticks is 2 crafts of 4')
  assert.match(out.detail, /^crafted 8x stick/)
})

// ------------------------------------------------------------------ mutants: each must reproduce its defect
const SRC = new URL('../src/craftplan.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = fs.readFileSync(SRC, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const mplan = (mod, item, have, tableReady = false, extra = {}) => mod.planCraft({ item, count: 1, recipesOf, have, tableReady, prefer, ...extra })
await t('MUTANT KILLED: the root drawn from the bag -> a held pickaxe answers the request', async () => {
  await withMutant('  const done = make({ inv: { ...have }, steps: [], station: false }, item,',
    '  const done = obtain({ inv: { ...have }, steps: [], station: false }, item,', async mod => {
      assert.equal(total(mplan(mod, 'wooden_pickaxe', { wooden_pickaxe: 1, oak_log: 2 }, true), 'wooden_pickaxe'), 0)
    })
})
await t('MUTANT KILLED: no cycle filter -> an ingot is "made" by melting the held one into nuggets', async () => {
  await withMutant('  const usable = (name, anc) => shapes(name).filter(r => !r.ingredients.some(i => anc.has(i.name)))',
    '  const usable = (name, anc) => shapes(name)', async mod => {
      const p = mplan(mod, 'iron_ingot', { iron_ingot: 1 }, true)
      assert.equal(p.ok, true, 'the mutant did not take the conversion loop')
    })
})
await t('MUTANT KILLED: the station left out of the plan -> 4 planks + 2 sticks is "ok"', async () => {
  await withMutant('          let t = c.r.table ? station(st, a2) : st', '          let t = st', async mod => {
    assert.equal(mplan(mod, 'wooden_pickaxe', { oak_planks: 4, stick: 2 }).ok, true)
  })
})
await t('MUTANT KILLED: no node budget -> the limit test sees no limit', async () => {
  await withMutant('    if (++nodes > maxNodes) { limit = true; return null }', '    ++nodes', async mod => {
    assert.equal(mplan(mod, 'wooden_pickaxe', { oak_log: 3 }, false, { maxNodes: 1 }).limit, false)
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
