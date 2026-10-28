// mats-01: THE DISPATCH, through the REAL CognitiveLoop (smeltjob.test.mjs's CHAIN harness). A bot at a town whose index KNOWS a
// chest with cobble and logs above the reserve and a cold furnace: make_material is issued after the town's own orders and
// before the model; a ready rung wins; away from town it never comes; an open carry note gets mats_return FIRST; and the
// readings it acts on are the real ones (the index file, the scan, the furnace's block state).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-mats-chain-logs-'))
process.env.BOT_NAME = 'MatsChainBot'
process.env.MEMORY_SCOPE = 'shared'
process.env.MEMORY_POOL = 'mats-chain'
process.env.PLINTH_FIRST = '0'
process.env.SMELT_JOB = '0'            // the town smelt job would take the same slot first (its own suite drives it)
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.FAILED_COOLDOWN_MS = '1'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-mats-chain-pool-'))
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
delete process.env.MATS

import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')

const TI = await import('../src/townindex.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const S = await import('../src/skills.mjs')

const CHEST = [2, 70, 2], FURNACE = [-2, 70, 3]
const HK = TI.indexHomeKey({ x: 0, y: 70, z: 0 })
const item = (name, count, slot) => ({ name, count, slot, type: mcData.itemsByName[name].id, stackSize: mcData.itemsByName[name].stackSize })
function seedIndex (names) {
  TI.appendIndex(process.env.POOL_STATE_DIR, HK, null, { t: 'obs', id: `o-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, k: CHEST.join(','), h: [CHEST.join(',')], at: Date.now(), bot: 'Other', by: 'count_town', names, used: 9, size: 27 })
  TI.resetIndexCache()
}
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-mats-l-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }

/** A bot at town (or not): a light bag, a known chest and a cold furnace in its world. */
// the ladder bag: smeltjob.test.mjs's CHAIN bag (its active rung is the stone pickaxe), without the copper
const LADDER = [['dirt', 16], ['oak_log', 6], ['oak_log', 10], ['sand', 8], ['cobblestone', 64], ['cobblestone', 20], ['crafting_table', 1],
  ['wooden_pickaxe', 1], ['stick', 8], ['furnace', 1], ['coal', 3]]
function chainBot ({ at = new Vec3(1, 70, 0), craftReady = false, lit = false, bag = null } = {}) {
  const rows = bag ?? [['bread', 5], ['torch', 8], ['iron_pickaxe', 1], ['iron_axe', 1], ['iron_shovel', 1], ['coal', 3]]
  const items = rows.map(([n, c], i) => item(n, c, 9 + i))
  for (const t of items.filter(i => /_(pickaxe|axe|shovel)$/.test(i.name))) { t.maxDurability = mcData.itemsByName[t.name].maxDurability; t.durabilityUsed = t.name === 'wooden_pickaxe' ? t.maxDurability - 50 : 10 }
  const cells = { [CHEST.join(',')]: 'chest', [FURNACE.join(',')]: 'furnace' }
  const blockAt = p => {
    const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`
    const name = cells[k] ?? 'air'
    return { type: mcData.blocksByName[name].id, name, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), boundingBox: name === 'air' ? 'empty' : 'block',
             getProperties: () => (name === 'furnace' ? { lit: lit ? 'true' : 'false', facing: 'north' } : {}) }
  }
  // mineflayer's matching: a function of the block, or a block id / list of ids
  const match = (m, b) => (typeof m === 'function' ? m(b) : Array.isArray(m) ? m.includes(b.type) : m === b.type)
  const findBlocks = ({ matching, point, maxDistance = 16, count = 1 } = {}) => Object.keys(cells).map(k => blockAt(new Vec3(...k.split(',').map(Number))))
    .filter(b => match(matching, b) && b.position.distanceTo(point ?? at) <= maxDistance).slice(0, count).map(b => b.position)
  return {
    entity: { position: at, velocity: { x: 0, y: 0, z: 0 } }, registry: mcData, controlState: {}, currentWindow: null,
    inventory: { inventoryStart: 9, items: () => items },
    health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
    recipesFor: id => (craftReady && id === mcData.itemsByName.stone_pickaxe.id ? [{ delta: [] }] : []), recipesAll: () => [],
    findBlock: o => { const ps = findBlocks({ ...o, count: 1 }); return ps.length ? blockAt(ps[0]) : null }, findBlocks, blockAt,
    clearControlStates: () => {}, setControlState: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'MatsChainBot',
    pathfinder: { goto: async () => {}, setGoal: () => {} }, removeListener: () => {}, once: () => {}, on: () => {}, _client: {},
  }
}
async function decisions (bot, n, answer = () => ({ status: 'success', detail: 'ok' })) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    ran.push({ skill, args })
    const r = answer(skill, args)
    return { delta: {}, contractEvidence: r.status === 'success' ? [`${skill}: probe`] : [], ...r }
  } }
  const loop = new CognitiveLoop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 300 && ran.length < n; i++) await new Promise(r => setTimeout(r, 20))
  loop.stop()
  return { ran, loop }
}
const TOWN_FIRST = new Set(['build_well', 'dispose_well', 'close_well', 'town_deposit', 'count_town', 'compost', 'build_composter', 'withdraw_pick', 'wear_out', 'prune_town', 'toolkit', 'furnace_drain'])
const skipTown = skill => (TOWN_FIRST.has(skill) ? { status: 'no_effect', detail: 'skip' } : { status: 'success', detail: 'ok' })
const noteFile = () => path.join(process.env.POOL_STATE_DIR, 'mats-carry-MatsChainBot.json')

test('CHAIN: at town with a known chest above the reserve and a cold furnace -> make_material (bricks) before the model', async () => {
  seedIndex({ cobblestone: [400, 7], oak_log: [600, 10] })
  const { ran } = await decisions(chainBot(), 4, skipTown)
  const i = ran.findIndex(r => r.skill === 'make_material')
  assert.ok(i >= 0, JSON.stringify(ran.map(r => r.skill)))
  assert.equal(ran[i].args.item, 'bricks')
  assert.ok(ran.slice(0, i).every(r => TOWN_FIRST.has(r.skill)), `only the town's own orders come before it: ${JSON.stringify(ran.map(r => r.skill))}`)
})

test('CHAIN: a READY RUNG WINS -- the same bot with a craft-ready stone pickaxe gets the craft, never the job', async () => {
  seedIndex({ cobblestone: [400, 7], oak_log: [600, 10] })
  const { ran, loop } = await decisions(chainBot({ craftReady: true, bag: LADDER }), 1)
  assert.match(loop.milestones.current()?.id ?? '', /stone_pickaxe/)
  assert.equal(ran[0].skill, 'craft', JSON.stringify(ran.map(r => r.skill)))
  // positive control: the same ladder bag WITHOUT the ready craft reaches the job (after the town's own orders)
  const ctl = await decisions(chainBot({ bag: LADDER }), 5, skipTown)
  assert.ok(ctl.ran.some(r => r.skill === 'make_material'), JSON.stringify(ctl.ran.map(r => r.skill)))
})

test('CHAIN CONTROL: away from town never; a LIT furnace only -> a kind with no smelt or nothing; at the reserve -> nothing', async () => {
  seedIndex({ cobblestone: [400, 7], oak_log: [600, 10] })
  const away = await decisions(chainBot({ at: new Vec3(200, 70, 0) }), 3)
  assert.ok(!away.ran.some(r => r.skill === 'make_material'), JSON.stringify(away.ran.map(r => r.skill)))
  const hot = await decisions(chainBot({ lit: true }), 3, skipTown)
  assert.ok(!hot.ran.some(r => r.skill === 'make_material' && r.args.item === 'bricks'), 'no bricks order without a cold furnace')
  seedIndex({ cobblestone: [256, 4], oak_log: [512, 8] })
  const res = await decisions(chainBot(), 3, skipTown)
  assert.ok(!res.ran.some(r => r.skill === 'make_material'), `the town at its reserve gets no order: ${JSON.stringify(res.ran.map(r => r.skill))}`)
})

test('CHAIN: an OPEN carry note at town -> mats_return comes first, and no new order while it is open', async () => {
  seedIndex({ cobblestone: [400, 7], oak_log: [600, 10] })
  fs.writeFileSync(noteFile(), JSON.stringify({ v: 1, bot: 'MatsChainBot', kind: 'bricks', took: { oak_log: 2 }, fromBag: {}, bag0: { stone: 0 }, at: Date.now(), phase: 'open', keep: {} }))
  try {
    const { ran } = await decisions(chainBot(), 3, skill => (skill === 'mats_return' ? { status: 'no_effect', detail: 'probe' } : skipTown(skill)))
    const i = ran.findIndex(r => r.skill === 'mats_return')
    assert.ok(i >= 0, JSON.stringify(ran.map(r => r.skill)))
    assert.ok(!ran.some(r => r.skill === 'make_material'), 'no new order while the note is open')
  } finally { fs.rmSync(noteFile(), { force: true }) }
})

test('CHAIN: mats_return goes FIRST even against the town deposit -- a near-full bag at town gets the deposit WITHOUT a note (positive control), the recovery WITH one', async () => {
  seedIndex({ cobblestone: [400, 7], oak_log: [600, 10] })
  const full = [['iron_pickaxe', 1], ['iron_axe', 1], ['iron_shovel', 1], ...Array.from({ length: 31 }, () => ['oak_log', 64])]
  const ctl = await decisions(chainBot({ bag: full }), 1, skill => skipTown(skill))
  assert.equal(ctl.ran[0]?.skill, 'town_deposit', `the competitor is real: ${JSON.stringify(ctl.ran.map(r => r.skill))}`)
  fs.writeFileSync(noteFile(), JSON.stringify({ v: 1, bot: 'MatsChainBot', kind: 'bricks', took: { oak_log: 2 }, fromBag: {}, bag0: { stone: 0 }, at: Date.now(), phase: 'open', tries: 0 }))
  try {
    const { ran } = await decisions(chainBot({ bag: full }), 1, skill => (skill === 'mats_return' ? { status: 'no_effect', detail: 'probe' } : skipTown(skill)))
    assert.equal(ran[0]?.skill, 'mats_return', JSON.stringify(ran.map(r => r.skill)))
  } finally { fs.rmSync(noteFile(), { force: true }) }
})

test('CHAIN: a skip does not loop -- make_material finding nothing (no_effect) -> one order per cooldown, the streak counted', async () => {
  seedIndex({ cobblestone: [400, 7], oak_log: [600, 10] })
  const { ran, loop } = await decisions(chainBot(), 6, skill => (skill === 'make_material' ? { status: 'no_effect', detail: 'x', stop: 'inputs' } : skipTown(skill)))
  assert.equal(ran.filter(r => r.skill === 'make_material').length, 1, JSON.stringify(ran.map(r => r.skill)))
  assert.equal(loop.matsState?.streak?.why, 'inputs')
})

test('RUNNER: the evidence gate passes a make_material that made parts (its own count) and not one that made none', async () => {
  const r1 = S.classifyOutcome('make_material', 'success', { inventory: {}, made: 12 }, null)
  const r0 = S.classifyOutcome('make_material', 'success', { inventory: {}, made: 0 }, null)
  assert.ok(JSON.stringify(r1).includes('mats_effect'), JSON.stringify(r1))
  assert.ok(!JSON.stringify(r0).includes('mats_effect'))
})
