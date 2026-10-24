// RESPAWNFALL-01 x FOUND-01 (JIT 10-24, respawnfall-on-21dd0ce): respawnfall-01 was built on townplan-01 2d1aa8c1; the fleet
// gained found-01 (21dd0ce1), whose found slot (found_store / found_work) charges its visit and 10-min cooldown when it ISSUES.
// The sky descent overrides every order above it (keep-out's exit excepted), so a bot that spawned on a high platform inside
// the town, with a found order due, had that order replaced -- and the found slot was spent on an order that never ran.
// found-01's JIT made keep-out's override refund a found order it replaces (refundDeclined); the descent now does the same.
//
// Behaviour through the REAL CognitiveLoop on found-compose.test's greenfield town: the bot stands on a one-block pillar 10 up
// (9 open below onto grass: respawnfall's elevation() reads it elevated; |dy| 10 <= TOWN_DY, so it is in town). The recording
// runner's sky_descend puts it on the ground. Positive controls both ways, and a mutant without the refund.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-rfc-logs-'))
process.env.BOT_NAME = 'FoundBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.MEMORY_SCOPE = 'board'
process.env.PLINTH_FIRST = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.FOUND ??= 'on'
delete process.env.RESPAWNFALL
delete process.env.KEEPOUT_TOWN_YIELD
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-rfc-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const S = await import('../src/skills.mjs')
const RF = await import('../src/respawnfall.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const COG = await import('../src/cognitive.mjs')
const { Vec3 } = await import('vec3')
const COG_PATH = new URL('../src/cognitive.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

const PILLAR = { x: 2, y: 73, z: 0 }
/** found-compose's greenfield town; the bot on a one-block stone pillar 10 up (or on the ground), freshly spawned or not. */
function town ({ high = true, spawned = true } = {}) {
  freshPool(); S.resetPlanZones()
  const bag = [stack('crafting_table', 2), stack('oak_log', 30)]
  const w = fakeWorld({ bag, at: high ? [PILLAR.x + 0.5, PILLAR.y + 1, PILLAR.z + 0.5] : [2.5, 64, 0.5] })
  Object.assign(w.bot, { worldId: 'w', username: 'FoundBot', players: {} })
  const r = S.townPlanTick(w.bot, { now: Date.now() })
  assert.equal(r.op, 'root'); assert.equal(r.result, 'accepted', JSON.stringify(r))
  if (high) w.set(PILLAR.x, PILLAR.y, PILLAR.z, 'stone')
  const fb = w.bot.findBlock.bind(w.bot)
  w.bot.findBlock = (o = {}) => (typeof o.matching === 'function' ? fb(o) : null)   // the prompt's id scan is not the question
  Object.assign(w.bot, { health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
    recipesFor: () => [], recipesAll: () => [], clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 },
    lastSpawnAt: spawned ? Date.now() : null })
  return w
}
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-rfc-l-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
async function decisions (w, n, { Loop = COG.CognitiveLoop } = {}) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    ran.push(skill)
    if (skill === 'sky_descend') w.bot.entity.position = new Vec3(2.5, 64, 0.5)   // climbed down: on the grass, still in town
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: ['probe'] }
  } }
  const loop = new Loop(w.bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 300 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  return ran
}

console.log('respawnfall x found: a found order the descent replaces is refunded')
await t('THE SCENE: the pillar top reads elevated to respawnfall, and it is in town', async () => {
  const w = town()
  const el = RF.elevation({ pos: w.bot.entity.position, at: (x, y, z) => w.bot.blockAt(new Vec3(x, y, z)), onGround: true })
  assert.equal(el.elevated, true, JSON.stringify(el))
  const { inTown } = await import('../src/chestfull.mjs')
  assert.equal(inTown({ x: 0, y: 64, z: 0 }, w.bot.entity.position), true, 'in town (the found slot can issue here)')
})
await t('POSITIVE CONTROL (found is live): the same bot on the ground -> found_work (F1)', async () => {
  const ran = await decisions(town({ high: false }), 1)
  assert.equal(ran[0], 'found_work', JSON.stringify(ran))
})
await t('POSITIVE CONTROL (the descent is live): on the pillar, freshly spawned -> sky_descend first', async () => {
  const ran = await decisions(town(), 1)
  assert.equal(ran[0], 'sky_descend', JSON.stringify(ran))
})
await t('THE CHAIN (real CognitiveLoop): sky_descend replaces found_work; once down (still in town) the next decision issues found_work', async () => {
  const ran = await decisions(town(), 2)
  assert.deepEqual(ran.slice(0, 2), ['sky_descend', 'found_work'], JSON.stringify(ran))
})
await t('MUTANT KILLED: the descent without the refund -> the found visit is spent on an order that never ran (no found_work after the descent)', async () => {
  const old = "{ const sd = this.#skyDescendOrder(order); if (sd) { if (order?.skill === 'found_store' || order?.skill === 'found_work') Object.assign(this, refundDeclined(order.skill, this)); order = sd } }"
  await withMutant(COG_PATH, old, '{ const sd = this.#skyDescendOrder(order); if (sd) order = sd }', async M => {
    const ran = await decisions(town(), 3, { Loop: M.CognitiveLoop })
    assert.equal(ran[0], 'sky_descend', JSON.stringify(ran))
    assert.ok(!ran.includes('found_work'), `mutant: found_work never came back: ${JSON.stringify(ran)}`)
  })
})

console.log(`\nrespawnfall-found-compose: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
