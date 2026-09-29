// `count` IS ITEMS, AND bot.craft TAKES REPETITIONS.
//
// mineflayer's recipesFor(id, meta, minResultCount) checks ingredients for
// ceil(minResultCount / result.count) crafts (craft.js requirementsMetForRecipe), but
// bot.craft(recipe, count) runs the recipe `count` TIMES (craft.js: for i < count, craftOnce).
// The skill passed the same `count` to both, so "craft 4 oak_planks" with one log passed the
// check, made 4 planks, and threw "missing ingredient" on the second repetition.
//
// The fake below implements BOTH halves exactly as mineflayer does -- the older craft-tree fake
// checked ingredients per repetition, which is why no test could see this.
import assert from 'node:assert'

process.env.LOG_DIR = '/tmp/mcbot-test-logs-craftcount'
process.env.BOT_NAME = 'TestBot'
const { SKILLS, craftRepetitions } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const ID = { oak_log: 1, oak_planks: 2, stick: 3, chest: 4 }
const NAME = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]))
// result.count and per-craft ingredients, as minecraft-data gives them
const RECIPES = {
  oak_planks: { result: { id: 2, count: 4 }, delta: [{ id: 1, count: -1 }, { id: 2, count: 4 }], requiresTable: false },
  stick:      { result: { id: 3, count: 4 }, delta: [{ id: 2, count: -2 }, { id: 3, count: 4 }], requiresTable: false },
}

function makeBot (bag) {
  const calls = []
  const bot = {
    registry: { itemsByName: Object.fromEntries(Object.entries(ID).map(([n, id]) => [n, { id, name: n }])), blocks: {} },
    inventory: { items: () => Object.entries(bag).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count })) },
    // mineflayer: craftCount = ceil(minResultCount / result.count); every ingredient x craftCount
    recipesFor (id, _meta, minResultCount = 1) {
      const r = RECIPES[NAME[id]]; if (!r) return []
      const n = Math.ceil(minResultCount / r.result.count)
      return r.delta.every(d => d.count >= 0 || (bag[NAME[d.id]] ?? 0) >= -d.count * n) ? [r] : []
    },
    // mineflayer: `count` repetitions of craftOnce, each of which needs its own ingredients
    async craft (recipe, count = 1) {
      calls.push(count)
      for (let i = 0; i < count; i++) {
        if (!recipe.delta.every(d => d.count >= 0 || (bag[NAME[d.id]] ?? 0) >= -d.count)) throw new Error('missing ingredient')
        for (const d of recipe.delta) bag[NAME[d.id]] = (bag[NAME[d.id]] ?? 0) + d.count
      }
    },
    findBlock: () => null, lookAt: async () => {}, pathfinder: { goto: async () => {} },
  }
  return { bot, bag, calls }
}
const run = (bot, args) => SKILLS.craft.run({ bot }, args, { aborted: false })

await t('craftRepetitions: items -> repetitions, rounding up, never below one', () => {
  assert.equal(craftRepetitions(RECIPES.oak_planks, 4), 1)
  assert.equal(craftRepetitions(RECIPES.oak_planks, 5), 2)
  assert.equal(craftRepetitions(RECIPES.oak_planks, 8), 2)
  assert.equal(craftRepetitions({ result: { count: 1 } }, 3), 3)
  assert.equal(craftRepetitions({}, 2), 2, 'no result count: one item per craft')
  assert.equal(craftRepetitions(RECIPES.stick, 0), 1)
})

await t('"craft 4 oak_planks" with ONE log succeeds and makes 4 planks (it threw before)', async () => {
  const { bot, bag, calls } = makeBot({ oak_log: 1 })
  const r = await run(bot, { item: 'oak_planks', count: 4 })
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(calls, [1], 'one repetition')
  assert.equal(bag.oak_planks, 4)
  assert.equal(bag.oak_log, 0)
})

await t('"craft 8 stick" with 4 planks makes 8 sticks from 2 repetitions', async () => {
  const { bot, bag, calls } = makeBot({ oak_planks: 4 })
  const r = await run(bot, { item: 'stick', count: 8 })
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(calls, [2])
  assert.equal(bag.stick, 8)
  assert.match(r.detail, /crafted 8x stick/)
})

await t('the success line names what was MADE, not what was asked', async () => {
  const { bot } = makeBot({ oak_log: 1 })
  const r = await run(bot, { item: 'oak_planks', count: 1 })
  assert.match(r.detail, /crafted 4x oak_planks/, r.detail)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
