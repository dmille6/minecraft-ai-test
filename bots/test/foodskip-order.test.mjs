// THE PEACEFUL FOOD POLICY THROUGH THE REAL COGNITIVE LOOP: the compost town order counts apples above the reserve as
// compostable only while the policy is on. Separate file: the loop needs its own env (log dir, role, home, cadence).
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-foodskip-order'
process.env.BOT_NAME = process.env.BOT_NAME || 'FoodBot'
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-fso-'))
let seq = 0
function townBot (difficulty) {
  const items = [{ name: 'apple', count: 10, slot: 9, type: mcData.itemsByName.apple.id },
    // a usable pickaxe, so withdraw's withdraw_pick town order (when withdraw is underneath) has nothing to fetch
    { name: 'stone_pickaxe', count: 1, slot: 10, type: mcData.itemsByName.stone_pickaxe.id, maxDurability: 131, durabilityUsed: 11 },
    ...Array.from({ length: 33 }, (_, i) => ({ name: 'white_wool', count: 1, slot: 11 + i, type: mcData.itemsByName.white_wool.id }))]
  const composter = { name: 'composter', type: mcData.blocksByName.composter.id, position: new Vec3(3, 70, 3), getProperties: () => ({ level: 0 }) }
  const chest = { name: 'chest', type: mcData.blocksByName.chest.id, position: new Vec3(-3, 70, 0) }
  return {
    entity: { position: new Vec3(1, 70, 1), velocity: { x: 0, y: 0, z: 0 } }, health: 20, food: 20, oxygenLevel: 300,
    time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, serverDifficulty: difficulty,
    inventory: { items: () => items }, registry: mcData, recipesFor: () => [], recipesAll: () => [],
    findBlock: ({ matching }) => [composter, chest].find(b => { try { return typeof matching === 'function' ? matching(b) : matching === b.type } catch { return false } }) ?? null,
    findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    setControlState: () => {}, clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'FoodBot',
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

test('PEACEFUL: a town bot at 35/36 holding 10 apples gets the compost order (apples above 4 are compostable)', async () => {
  assert.equal(await firstSkill(townBot('peaceful')), 'compost')
})
test('HARD / UNKNOWN: the same bot gets no compost order -- apples are food again, exactly as today', async () => {
  assert.equal(await firstSkill(townBot('hard')), 'status')
  assert.equal(await firstSkill(townBot(undefined)), 'status')
})
