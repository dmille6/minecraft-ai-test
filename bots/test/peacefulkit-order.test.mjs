// THE PEACEFUL KIT THROUGH THE REAL COGNITIVE LOOP (peacefulkit.mjs, owner 10-07): the compost town order counts the kit's
// plants as compostable only while the food policy's switch is on. A bag holding ONLY kit plants as compostables (no
// apples, no ballast, saplings at the reserve): peaceful -> compost; hard/unknown -> nothing. Same harness as
// foodskip-order.test.mjs.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-peacefulkit-order'
process.env.BOT_NAME = process.env.BOT_NAME || 'KitBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-pko-'))
let seq = 0
function townBot (difficulty, { full = false, first = ['wildflowers', 30], pick = 'iron_pickaxe' } = {}) {
  const items = [{ name: first[0], count: first[1], slot: 9, type: mcData.itemsByName[first[0]].id },
    { name: 'oak_sapling', count: 16, slot: 44, type: mcData.itemsByName.oak_sapling.id }, { name: 'apple', count: 4, slot: 45, type: mcData.itemsByName.apple.id },
    // a usable IRON pickaxe, so withdraw's withdraw_pick town order has nothing to fetch -- and withdraw2's upgrade order
    // (a usable pickaxe BELOW iron) has nothing to upgrade (the rebase onto withdraw2, review 10-08: with a stone one every
    // `status` case below read withdraw_pick). A stone one is the composition test at the bottom.
    { name: pick, count: 1, slot: 10, type: mcData.itemsByName[pick].id, maxDurability: mcData.itemsByName[pick].maxDurability, durabilityUsed: 11 },
    ...Array.from({ length: full ? 32 : 31 }, (_, i) => ({ name: 'white_wool', count: 1, slot: 11 + i, type: mcData.itemsByName.white_wool.id }))]
  const composter = { name: 'composter', type: mcData.blocksByName.composter.id, position: new Vec3(3, 70, 3), getProperties: () => ({ level: 0 }) }
  const chest = { name: 'chest', type: mcData.blocksByName.chest.id, position: new Vec3(-3, 70, 0) }
  return {
    entity: { position: new Vec3(1, 70, 1), velocity: { x: 0, y: 0, z: 0 } }, health: 20, food: 20, oxygenLevel: 300,
    time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, serverDifficulty: difficulty,
    inventory: { items: () => items }, registry: mcData, recipesFor: () => [], recipesAll: () => [],
    findBlock: ({ matching }) => [composter, chest].find(b => { try { return typeof matching === 'function' ? matching(b) : matching === b.type } catch { return false } }) ?? null,
    findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    setControlState: () => {}, clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'KitBot',
  }
}
async function firstSkill (bot) {
  const ran = []
  const runner = { isBusy: () => false, run: async skill => { ran.push(skill); return { status: 'no_effect', detail: 'probe' } } }
  const L = new Lessons(path.join(dir, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}
  const loop = new CognitiveLoop(bot, runner, L, null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.start()
  for (let i = 0; i < 100 && !ran.length; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  return ran[0]
}

test('PEACEFUL: a town bot at 35/36 whose only compostables are 30 wildflowers gets the compost order', async () => {
  assert.equal(await firstSkill(townBot('peaceful')), 'compost')
})
test('HARD / UNKNOWN: the same bot gets no compost order -- the kit is off, exactly as today', async () => {
  assert.equal(await firstSkill(townBot('hard')), 'status')
  assert.equal(await firstSkill(townBot(undefined)), 'status')
})
test('PEACEFUL, 36/36 with the plants in one stack of 30: NO compost order -- no fill could start (no room for the bone meal)', async () => {
  assert.equal(await firstSkill(townBot('peaceful', { full: true })), 'status')
})

// THE GUARD IS GENERAL (owner 10-07 ~19:50Z): the real surplus after every reserve, whatever the switch says.
test('HARD, 36/36 with leaf_litter in one stack of 30: NO compost order (no fill could start) -- the guard with the switch off', async () => {
  assert.equal(await firstSkill(townBot('hard', { full: true, first: ['leaf_litter', 30] })), 'status')
})
test('HARD, 35/36 with leaf_litter 30 (room for the bone meal): the compost order, as before', async () => {
  assert.equal(await firstSkill(townBot('hard', { first: ['leaf_litter', 30] })), 'compost')
})
test('PEACEFUL, 35/36 with jungle saplings 5 (no reserve while on): the compost order', async () => {
  assert.equal(await firstSkill(townBot('peaceful', { first: ['jungle_sapling', 5] })), 'compost')
})

// WITHDRAW2 COMPOSITION (rebase onto withdraw2, 10-08): with a STONE pickaxe (below iron) the kit's compost order still comes
// first while peaceful; with the kit off (hard) the bot gets withdraw2's upgrade order, never compost.
test('WITHDRAW2 COMPOSITION: a STONE pickaxe -- peaceful composts the kit plants first; hard gets withdraw_pick', async () => {
  assert.equal(await firstSkill(townBot('peaceful', { pick: 'stone_pickaxe' })), 'compost')
  assert.equal(await firstSkill(townBot('hard', { pick: 'stone_pickaxe' })), 'withdraw_pick')
})
