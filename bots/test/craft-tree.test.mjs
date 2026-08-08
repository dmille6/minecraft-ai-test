// CRAFT MUST WALK THE RECIPE TREE.
//
// Measured on the rebuilt world, one run of instance #1:
//
//     craft oak_planks       4/4    100%
//     craft stick            2/2    100%
//     craft wooden_pickaxe   0/16     0%
//
// while Gather01 held THIRTY-ONE oak logs. Every ingredient was craftable and
// the tool never was: the model asks for the goal item, the skill answered "you
// are missing planks", and nothing ever made the planks. At one decision per
// 70 seconds the model would have needed three correct steps in a row from a
// prompt that never names the next one.
//
// These tests drive the REAL craft skill against a fake registry modelling the
// actual vanilla chain:
//
//     oak_log --(1:4)--> oak_planks --(2:4)--> stick
//     3 oak_planks + 2 stick + a PLACED table --> wooden_pickaxe
//     4 oak_planks --> crafting_table
import assert from 'node:assert'
import { SKILLS } from '../src/skills.mjs'

// Minimal vector: craft() calls position.offset() and position.distanceTo(),
// so a plain object is not enough of a stand-in.
const V = (x, y, z) => ({
  x, y, z,
  offset: (a, b, c) => V(x + a, y + b, z + c),
  distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z),
})

let pass = 0, fail = 0
const t = (name, fn) => fn().then(
  () => { pass++; console.log(`  PASS  ${name}`) },
  e  => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

// --- the fake world -------------------------------------------------------
const ID = { oak_log: 1, oak_planks: 2, stick: 3, crafting_table: 4, wooden_pickaxe: 5 }
const NAME = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]))

// delta uses mineflayer's convention: negative counts are consumed, positive produced.
const RECIPES = {
  oak_planks:     [{ needsTable: false, delta: [{ id: ID.oak_log, count: -1 }, { id: ID.oak_planks, count: 4 }] }],
  stick:          [{ needsTable: false, delta: [{ id: ID.oak_planks, count: -2 }, { id: ID.stick, count: 4 }] }],
  crafting_table: [{ needsTable: false, delta: [{ id: ID.oak_planks, count: -4 }, { id: ID.crafting_table, count: 1 }] }],
  wooden_pickaxe: [{ needsTable: true,  delta: [{ id: ID.oak_planks, count: -3 }, { id: ID.stick, count: -2 },
                                                { id: ID.wooden_pickaxe, count: 1 }] }],
}

function makeCraftBot(inv = {}, { tableNearby = false } = {}) {
  const bag = { ...inv }
  const placed = []
  const bot = {
    entity: { position: V(0, 64, 0) },
    registry: {
      itemsByName: Object.fromEntries(Object.keys(ID).map(n => [n, { id: ID[n], name: n }])),
      items: Object.fromEntries(Object.entries(NAME).map(([id, n]) => [id, { name: n }])),
      blocks: {},
    },
    inventory: { items: () => Object.entries(bag).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count })) },
    // A recipe is only returned when its station requirement is satisfied AND
    // the bot actually holds the ingredients -- which is what mineflayer does.
    recipesFor(id, _meta, count = 1, table = null) {
      const rs = RECIPES[NAME[id]] ?? []
      return rs.filter(r => (!r.needsTable || table) &&
        r.delta.every(d => d.count >= 0 || (bag[NAME[d.id]] ?? 0) >= -d.count * count))
    },
    recipesAll(id) { return RECIPES[NAME[id]] ?? [] },
    findBlock() { return tableNearby || placed.includes('crafting_table')
      ? { position: V(1, 64, 0), name: 'crafting_table' } : null },
    blockAt(p) { return { name: p && p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p && p.y < 64 ? 'block' : 'empty' } },
    async craft(recipe, count = 1) {
      for (const d of recipe.delta) {
        const n = NAME[d.id]
        bag[n] = (bag[n] ?? 0) + d.count * count
      }
    },
    async equip() {},
    async placeBlock() { placed.push('crafting_table'); bag.crafting_table -= 1 },
    async lookAt() {},
    pathfinder: { async goto() {} },
  }
  return { bot, bag, placed }
}

const run = (bot, args) => SKILLS.craft.run({ bot }, args, { aborted: false })

// --- the case that was failing 16 times out of 16 -------------------------
await t('logs + a nearby table -> a wooden pickaxe, walking the whole tree', async () => {
  const { bot, bag } = makeCraftBot({ oak_log: 31 }, { tableNearby: true })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.status, 'success', `expected success, got: ${r.detail}`)
  assert.equal(bag.wooden_pickaxe, 1, 'the pickaxe should exist')
  assert.ok(bag.oak_log < 31, 'logs should have been consumed')
})

await t('the detail records which intermediates it made', async () => {
  const { bot } = makeCraftBot({ oak_log: 31 }, { tableNearby: true })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.match(r.detail, /first made/, `detail should name the subtree: ${r.detail}`)
  assert.match(r.detail, /oak_planks|stick/, `detail should name an intermediate: ${r.detail}`)
})

// --- a table in the pack is not a table on the ground ---------------------
await t('a carried crafting_table gets PLACED rather than reported as missing', async () => {
  const { bot, placed } = makeCraftBot({ oak_log: 31, crafting_table: 1 })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.status, 'success', `expected success, got: ${r.detail}`)
  assert.ok(placed.includes('crafting_table'), 'the table should have been placed')
})

// --- the case that was live after the first version of this fix -----------
await t('ingredients but NO table anywhere: makes one, places it, succeeds', async () => {
  // Exactly Miner01's live inventory: enough planks and sticks for the pickaxe,
  // no crafting table in the pack and none on the ground.
  const { bot, bag, placed } = makeCraftBot({ oak_planks: 14, stick: 5 })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.status, 'success', `expected success, got: ${r.detail}`)
  assert.ok(placed.includes('crafting_table'), 'it should have built and placed a table')
  assert.equal(bag.wooden_pickaxe, 1)
})

await t('it does not build a table for a recipe that never needed one', async () => {
  const { bot, placed } = makeCraftBot({ oak_log: 4 })
  await run(bot, { item: 'oak_planks', count: 1 })
  assert.equal(placed.length, 0, 'a tableless recipe must not trigger station building')
})

// --- direct crafts must not regress --------------------------------------
await t('crafting planks directly still works and needs no recursion', async () => {
  const { bot, bag } = makeCraftBot({ oak_log: 4 })
  const r = await run(bot, { item: 'oak_planks', count: 1 })
  assert.equal(r.status, 'success')
  assert.equal(bag.oak_planks, 4)
  assert.ok(!/first made/.test(r.detail), 'a one-step craft should not claim a subtree')
})

await t('sticks from logs is a two-step tree and resolves', async () => {
  const { bot, bag } = makeCraftBot({ oak_log: 4 })
  const r = await run(bot, { item: 'stick', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.ok(bag.stick >= 4, `expected sticks, got ${bag.stick}`)
})

// --- it must still fail honestly when the tree bottoms out ---------------
await t('no raw material: fails, names the gap, does not hang', async () => {
  const { bot } = makeCraftBot({})
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'missing_ingredients')
  assert.ok(r.gap && r.gap.length, 'a failure must still name its gap for the lessons store')
})

await t('the reported gap reflects state AFTER any partial resolution', async () => {
  // Enough logs for planks but the pickaxe also wants sticks, and there is no
  // table anywhere -- so it should get further, then still fail.
  const { bot } = makeCraftBot({ oak_log: 1 })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.status, 'failed')
  assert.ok(!/31x/.test(r.detail), 'must not report a stale pre-resolution gap')
})

await t('an unknown item is still rejected immediately', async () => {
  const { bot } = makeCraftBot({ oak_log: 8 })
  const r = await run(bot, { item: 'nether_star', count: 1 })
  assert.equal(r.status, 'failed')
  assert.match(r.detail, /unknown item/)
})

// --- recursion must terminate --------------------------------------------
await t('recursion is bounded: a self-referential recipe cannot loop', async () => {
  RECIPES.loop_item = [{ needsTable: false, delta: [{ id: 99, count: -1 }, { id: 99, count: 1 }] }]
  ID.loop_item = 99; NAME[99] = 'loop_item'
  const { bot } = makeCraftBot({})
  const done = await Promise.race([
    run(bot, { item: 'loop_item', count: 1 }),
    new Promise(r => setTimeout(() => r('TIMEOUT'), 4000)),
  ])
  assert.notEqual(done, 'TIMEOUT', 'craft looped forever on a self-referential recipe')
  delete RECIPES.loop_item; delete ID.loop_item; delete NAME[99]
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
