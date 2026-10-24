// RESPAWNFALL-01 x JUNKOUT-01 (JIT 10-24, the likely-path variant on junkout-01 d55ce14d + lavastep + lavasight + ledger +
// ceilescape + plugcut + cavefall). junkout-01's town-visit orders (well / composter / the allowance's tail) latch the visit
// and charge their cooldowns when they ISSUE; keep-out's exit refunds one it displaces (visitDisplacedRefund). The sky descent
// overrides every order above it too, so a bot that spawned on a high platform inside the town with a tail due spent its visit
// on a run that never happened. The descent now refunds a displaced visit the same way.
//
// Behaviour through the REAL CognitiveLoop on found-compose.test's greenfield town with one chest (the tail's container) and a
// bag of rows only (torches, bone meal: no found order to give). The bot stands on a one-block pillar 10 up; the recording
// runner's sky_descend puts it on the grass. Positive controls both ways, and a mutant without the visit refund.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-rjc-logs-'))
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
delete process.env.BAG_ALLOWANCE
delete process.env.JUNK_VISIT
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-rjc-pool-')); process.env.POOL_STATE_DIR = d; return d }
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
const CHEST = { x: 3, y: 64, z: 2 }
function town ({ high = true, spawned = true } = {}) {
  freshPool(); S.resetPlanZones()
  const bag = [stack('torch', 11), stack('bone_meal', 30)]
  bag.forEach((it, i) => { it.slot = 9 + i })
  const w = fakeWorld({ bag, at: high ? [PILLAR.x + 0.5, PILLAR.y + 1, PILLAR.z + 0.5] : [2.5, 64, 0.5] })
  Object.assign(w.bot, { worldId: 'w', username: 'FoundBot', players: {} })
  const r = S.townPlanTick(w.bot, { now: Date.now() })
  assert.equal(r.op, 'root'); assert.equal(r.result, 'accepted', JSON.stringify(r))
  if (high) w.set(PILLAR.x, PILLAR.y, PILLAR.z, 'stone')
  w.set(CHEST.x, CHEST.y, CHEST.z, 'chest')
  const fb = w.bot.findBlock.bind(w.bot)
  w.bot.findBlock = (o = {}) => (typeof o.matching === 'function' ? fb(o) : null)   // the prompt's id scan is not the question
  Object.assign(w.bot, { health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
    recipesFor: () => [], recipesAll: () => [], clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 },
    lastSpawnAt: spawned ? Date.now() : null })
  return w
}
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-rjc-l-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
async function decisions (w, n, { Loop = COG.CognitiveLoop } = {}) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    ran.push({ skill, args })
    if (skill === 'sky_descend') w.bot.entity.position = new Vec3(2.5, 64, 0.5)   // climbed down: on the grass, still in town
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: ['probe'] }
  } }
  const loop = new Loop(w.bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 300 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  ran.loop = loop
  return ran
}
const isTail = r => r?.skill === 'town_deposit' && r.args?.tail === true

console.log('respawnfall x junkout: a junkout visit the descent displaces is refunded')
await t('THE SCENE: the pillar top reads elevated to respawnfall', () => {
  const w = town()
  const el = RF.elevation({ pos: w.bot.entity.position, at: (x, y, z) => w.bot.blockAt(new Vec3(x, y, z)), onGround: true })
  assert.equal(el.elevated, true, JSON.stringify(el))
})
await t('POSITIVE CONTROL (the tail is live): the same bot on the ground -> the tail', async () => {
  const ran = await decisions(town({ high: false }), 1)
  assert.ok(isTail(ran[0]), JSON.stringify(ran))
})
await t('POSITIVE CONTROL (the descent is live): on the pillar, freshly spawned -> sky_descend first, and the tail WAS issued and refunded on that decision (its latch is armed again)', async () => {
  const ran = await decisions(town(), 1)
  assert.equal(ran[0]?.skill, 'sky_descend', JSON.stringify(ran))
  assert.notEqual(ran.loop.tailState?.latched, true, `not spent: ${JSON.stringify(ran.loop.tailState)}`)
  assert.ok('lastIssuedAt' in (ran.loop.tailState ?? {}), `the tail issued on the pillar (its issue stamps lastIssuedAt): ${JSON.stringify(ran.loop.tailState)}`)
})
await t('THE CHAIN (real CognitiveLoop): sky_descend replaces the tail; once down (still in town) the tail runs, once', async () => {
  const ran = await decisions(town(), 3)
  assert.equal(ran[0]?.skill, 'sky_descend', JSON.stringify(ran))
  assert.ok(ran.slice(1).some(isTail), `the tail came after the descent: ${JSON.stringify(ran.map(r => r.skill))}`)
  assert.equal(ran.filter(isTail).length, 1)
})
await t('MUTANT KILLED: the descent without the visit refund -> the tail is spent behind it (no tail after the descent)', async () => {
  const old = ' Object.assign(this, visitDisplacedRefund(order, this)); order = sd } }'
  await withMutant(COG_PATH, old, ' order = sd } }', async M => {
    const ran = await decisions(town(), 3, { Loop: M.CognitiveLoop })
    assert.equal(ran[0]?.skill, 'sky_descend', JSON.stringify(ran))
    assert.ok(ran.length >= 2, `the loop made later decisions (a stall cannot read as killed): ${JSON.stringify(ran.map(r => r.skill))}`)
    assert.ok(!ran.some(isTail), `mutant: the tail never came: ${JSON.stringify(ran.map(r => r.skill))}`)
  })
})

console.log(`\nrespawnfall-junkout-compose: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
