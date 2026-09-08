// THE COMPOSED TEST: a bot in a birch forest must craft from birch.
//
// plank-affinity.test.mjs proves the pure decision. This proves the CHAIN --
// recipe selection, recursion, and the failure message -- because every trap
// this project has shipped passed its own unit test and died where two correct
// pieces met.
//
// The world here has TWO woods, which the oak-only fake in craft-tree.test.mjs
// cannot express, and that is exactly why the bug survived: the fixture had no
// way to represent choosing the wrong variant.
import assert from 'node:assert'
import { SKILLS } from '../src/skills.mjs'

const V = (x, y, z) => ({ x, y, z,
  offset: (a, b, c) => V(x + a, y + b, z + c),
  distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z) })

let pass = 0, fail = 0
const t = (name, fn) => fn().then(
  () => { pass++; console.log(`  PASS  ${name}`) },
  e  => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const ID = { oak_log: 1, oak_planks: 2, stick: 3, crafting_table: 4, wooden_pickaxe: 5,
             birch_log: 6, birch_planks: 7, oak_sapling: 8 }
const NAME = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]))

// Both plank recipes exist, and BOTH satisfy every wooden recipe -- which is
// how Minecraft actually works. Oak is listed LAST, matching the live registry
// order for wooden_pickaxe (oak is index 11 of 12).
const RECIPES = {
  birch_planks:   [{ needsTable: false, delta: [{ id: ID.birch_log, count: -1 }, { id: ID.birch_planks, count: 4 }] }],
  oak_planks:     [{ needsTable: false, delta: [{ id: ID.oak_log, count: -1 }, { id: ID.oak_planks, count: 4 }] }],
  stick: [
    { needsTable: false, delta: [{ id: ID.birch_planks, count: -2 }, { id: ID.stick, count: 4 }] },
    { needsTable: false, delta: [{ id: ID.oak_planks, count: -2 }, { id: ID.stick, count: 4 }] }],
  crafting_table: [
    { needsTable: false, delta: [{ id: ID.birch_planks, count: -4 }, { id: ID.crafting_table, count: 1 }] },
    { needsTable: false, delta: [{ id: ID.oak_planks, count: -4 }, { id: ID.crafting_table, count: 1 }] }],
  wooden_pickaxe: [
    { needsTable: true, delta: [{ id: ID.birch_planks, count: -3 }, { id: ID.stick, count: -2 },
                                { id: ID.wooden_pickaxe, count: 1 }] },
    { needsTable: true, delta: [{ id: ID.oak_planks, count: -3 }, { id: ID.stick, count: -2 },
                                { id: ID.wooden_pickaxe, count: 1 }] }],
}

function makeBot(inv = {}, { tableNearby = true } = {}) {
  const bag = { ...inv }
  const placedAt = []
  const bot = {
    entity: { position: V(0, 64, 0) },
    registry: {
      itemsByName: Object.fromEntries(Object.keys(ID).map(n => [n, { id: ID[n], name: n }])),
      items: Object.fromEntries(Object.entries(NAME).map(([id, n]) => [id, { name: n }])),
      blocks: {},
    },
    inventory: { items: () => Object.entries(bag).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count })) },
    recipesFor(id, _m, count = 1, table = null) {
      return (RECIPES[NAME[id]] ?? []).filter(r => (!r.needsTable || table) &&
        r.delta.every(d => d.count >= 0 || (bag[NAME[d.id]] ?? 0) >= -d.count * count))
    },
    recipesAll(id) { return RECIPES[NAME[id]] ?? [] },
    findBlock() { return tableNearby ? { position: V(1, 64, 0), name: 'crafting_table' } : null },
    blockAt(p) {
      if (p && placedAt.some(q => q.x === p.x && q.y === p.y && q.z === p.z)) {
        return { name: 'crafting_table', position: p, boundingBox: 'block' }
      }
      return { name: p && p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p && p.y < 64 ? 'block' : 'empty' }
    },
    async craft(recipe, count = 1) {
      for (const d of recipe.delta) { const n = NAME[d.id]; bag[n] = (bag[n] ?? 0) + d.count * count }
    },
    async equip() {},
    async placeBlock(ref, face) {
      placedAt.push({ x: ref.position.x + face.x, y: ref.position.y + face.y, z: ref.position.z + face.z })
      bag.crafting_table -= 1
    },
    async lookAt() {},
    pathfinder: { async goto() {} },
  }
  return { bot, bag }
}
const run = (bot, args) => SKILLS.craft.run({ bot }, args, { aborted: false })

// --- the live failure, reproduced ------------------------------------------

await t('186 birch logs + 27 oak saplings -> a pickaxe, not "gather oak_log"', async () => {
  const { bot, bag } = makeBot({ birch_log: 186, oak_sapling: 27 })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.status, 'success', `expected success, got: ${r.detail}`)
  assert.equal(bag.wooden_pickaxe, 1)
  assert.ok(bag.birch_log < 186, 'birch should have been consumed')
  assert.ok(!(bag.oak_planks > 0), 'it must not have gone looking for oak')
})

await t('the same bot can make a stick', async () => {
  const { bot, bag } = makeBot({ birch_log: 4, oak_sapling: 27 })
  const r = await run(bot, { item: 'stick', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.ok(bag.stick >= 4, `expected sticks, got ${bag.stick}`)
})

await t('and a crafting table', async () => {
  const { bot, bag } = makeBot({ birch_log: 4, oak_sapling: 27 }, { tableNearby: false })
  const r = await run(bot, { item: 'crafting_table', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.ok((bag.crafting_table ?? 0) >= 1)
})

// --- it must still be honest when there really is no wood -------------------

await t('a bot with saplings and NO logs is still told to gather, and names a real log', async () => {
  const { bot } = makeBot({ oak_sapling: 27 })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.status, 'failed')
  assert.ok(/gather \S+_log/.test(r.detail), `expected a log named, got: ${r.detail}`)
  assert.ok(r.gap && r.gap.length, 'the lessons store still needs a gap')
})

await t('an oak bot still uses oak', async () => {
  const { bot, bag } = makeBot({ oak_log: 31 })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.ok(bag.oak_log < 31, 'oak should have been consumed')
  assert.ok(!(bag.birch_planks > 0), 'it must not have invented birch it does not have')
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
