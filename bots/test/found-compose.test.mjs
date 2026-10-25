// FOUND-01 ON THE 10-23 FLEET (JIT 10-23c): found-01 was built on townplan-01 37d5aff6 (on indexsearch-01 d0a27a5e); since then
// the fleet gained ironpick-01, keepout-01, protectzone-01, townindex-01's JIT line and poolescape-01. Where the found slot meets
// them, behaviour first, through the REAL CognitiveLoop where the chain is the question:
//
//   1. KEEPOUT (owner C12): inside a live fire column that covers the town, keep-out's `_keepout_exit` stands down for town jobs.
//      The found slot is a town order like the rest; it was not in TOWN_JOB_SKILLS, so the exit overrode every found order a bot
//      in such a town took inside the column (the one production line of this re-stack). Pure decision + the chain + a mutant;
//      control: a column that does NOT cover the town still sends the found bot out first.
//   2. THE RUNNER RESERVATION (poolescape-01's firing, the watchdog's rescue: Runner.reserve -> `runner_reserved`): a found order
//      the runner declined never ran -- the slot's visit and cooldown come back and the next decision issues it again; control:
//      a found order that RAN and failed keeps its visit.
//   3. THE SHOWCASE ZONES: the deployable infra file now carries the owner's trial-chambers zone (#18), byte-identical to the
//      live /var/lib/mcai/_pool-showcase/protected-zones.json on 10.0.0.40 (showcase start 10-25; the gap this test pinned is
//      closed). Pinned now as: the fixture and the infra file hold the same zone ids with the same boxes (the fixture's labels may
//      differ), and the seed's avoid box is the trial-chambers zone's box.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-fdc-logs-'))
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
delete process.env.KEEPOUT_TOWN_YIELD
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-fdc-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const KO = await import('../src/keepout.mjs')
const S = await import('../src/skills.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const KO_PATH = new URL('../src/keepout.mjs', import.meta.url)

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
async function killedBy (fn) { try { await fn(); return false } catch { return true } }

/** A fresh greenfield town (found.test's): the planner tick writes the root plan (flat grass, home 0,64,0). */
function town (bag = [], at = [2.5, 64, 0.5]) {
  freshPool(); S.resetPlanZones()
  const w = fakeWorld({ bag, at })
  Object.assign(w.bot, { worldId: 'w', username: 'FoundBot', players: {} })
  const r = S.townPlanTick(w.bot, { now: Date.now() })
  assert.equal(r.op, 'root'); assert.equal(r.result, 'accepted', JSON.stringify(r))
  return w
}
const loopBot = w => Object.assign(w.bot, { health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
  recipesFor: () => [], recipesAll: () => [], clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 } })
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-fdc-l-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
async function decisions (bot, n, { Loop = CognitiveLoop, result = () => ({ status: 'success', detail: 'ok', delta: {}, contractEvidence: ['probe'] }) } = {}) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => { ran.push({ skill, args }); return result(ran.length, skill) } }
  const loop = new Loop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 300 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  return ran
}

console.log('found x keepout: the found slot is a town job (owner C12)')
const site = { kind: KO.FIRE_KIND, x: 7, y: 60, z: 0, count: 4, deaths: 1, last: Date.now(), by: ['x'] }
const inside = { x: 7.5, y: 64, z: 0.5 }   // 7.5 from home (HOME_YIELD_RADIUS 4: not "at home"), 4 above the site
await t('THE DECISION: a found order inside a column that covers the town is a town job (the exit stands down); a column that does not cover it sends the bot out', () => {
  assert.ok(KO.columnAt([site], inside), 'POSITIVE CONTROL: inside the column')
  for (const skill of ['found_store', 'found_work']) {
    assert.ok(KO.TOWN_JOB_SKILLS.has(skill), skill)
    assert.equal(KO.exitDecision({ sites: [site], pos: inside, home: { x: 0, y: 64, z: 0 }, skill, yielded: () => true, yieldOn: true }).why, 'town_job', skill)
    assert.equal(KO.exitDecision({ sites: [site], pos: inside, home: { x: 0, y: 64, z: 0 }, skill, yielded: () => false, yieldOn: true }).start, true, `${skill}: no cover, no yield`)
  }
  assert.equal(KO.exitDecision({ sites: [site], pos: inside, home: { x: 0, y: 64, z: 0 }, skill: 'gather', yielded: () => true, yieldOn: true }).start, true, 'CONTROL: not a town job')
})
const inColumnTown = (yields) => {
  const w = town([stack('crafting_table', 2), stack('oak_log', 30)], [inside.x, inside.y, inside.z])
  loopBot(w)
  Object.assign(w.bot, { fireSitesNow: () => [site], keepoutYields: () => yields })
  return w
}
await t('THE CHAIN (real CognitiveLoop): a bot with 2 tables inside a town-covering column gets found_work (F1), not `_keepout_exit`', async () => {
  const ran = await decisions(inColumnTown(true).bot, 1)
  assert.equal(ran[0]?.skill, 'found_work', JSON.stringify(ran))
})
await t('THE CHAIN CONTROL: the same bot in a column that does NOT cover the town is sent out first (`keepout_exit`)', async () => {
  const ran = await decisions(inColumnTown(false).bot, 1)
  assert.equal(ran[0]?.skill, 'keepout_exit', JSON.stringify(ran))
})
await t('THE OVERRIDDEN ORDER IS REFUNDED (Codex JIT r1 P2): in a column that does NOT cover the town the exit replaces F1; once out of the column (still in town) the next decision issues F1', async () => {
  const w = inColumnTown(false)
  const { Vec3 } = await import('vec3')
  const ran = await decisions(w.bot, 2, { result: (n, skill) => {
    if (skill === 'keepout_exit') w.bot.entity.position = new Vec3(-7.5, 64, 0.5)   // out of the column (14.5 from the site), in town
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: ['probe'] }
  } })
  assert.deepEqual(ran.map(r => r.skill), ['keepout_exit', 'found_work'], JSON.stringify(ran))
})
await t('MUTANT KILLED: the overridden found order not refunded -> the visit is spent on an order that never ran', async () => {
  const COG_PATH = new URL('../src/cognitive.mjs', import.meta.url)
  const src = readFileSync(COG_PATH, 'utf8')
  const old = " if (order?.skill === 'found_store' || order?.skill === 'found_work') Object.assign(this, refundDeclined(order.skill, this));"
  assert.ok(src.includes(old) && src.split(old).length === 2, 'ANCHOR MISSING or not unique')
  const k = await withMutant(COG_PATH, old, '', async M => killedBy(async () => {
    const w = inColumnTown(false)
    const { Vec3 } = await import('vec3')
    const ran = await decisions(w.bot, 2, { Loop: M.CognitiveLoop, result: (n, skill) => {
      if (skill === 'keepout_exit') w.bot.entity.position = new Vec3(-7.5, 64, 0.5)
      return { status: 'success', detail: 'ok', delta: {}, contractEvidence: ['probe'] }
    } })
    assert.deepEqual(ran.map(r => r.skill), ['keepout_exit', 'found_work'])
  }))
  assert.ok(k, 'the mutant survived')
})
await t('MUTANT KILLED: the found slot dropped from TOWN_JOB_SKILLS -> the exit overrides F1 inside the town\'s own column', async () => {
  const k = await withMutant(KO_PATH, "  'found_store', 'found_work'])", "  ])", async M => killedBy(() => {
    assert.equal(M.exitDecision({ sites: [site], pos: inside, home: { x: 0, y: 64, z: 0 }, skill: 'found_work', yielded: () => true, yieldOn: true }).why, 'town_job')
  }))
  assert.ok(k, 'the mutant survived')
})

console.log('found x the runner reservation (poolescape-01 / the watchdog: runner_reserved)')
await t('DECLINED BY A RESERVATION: the found order the runner declined never ran -> the next decision issues it again (the visit and the cooldown refunded)', async () => {
  const w = town([stack('crafting_table', 2), stack('oak_log', 30)])
  loopBot(w)
  const ran = await decisions(w.bot, 2, { result: n => (n === 1 ? { status: 'failed', failClass: 'runner_reserved', detail: 'the runner is reserved for poolescape' } : { status: 'success', detail: 'ok', delta: {}, contractEvidence: ['probe'] }) })
  assert.deepEqual(ran.map(r => r.skill), ['found_work', 'found_work'], JSON.stringify(ran))
})
await t('CONTROL: a found order that RAN and failed keeps its visit -> the next decision is not found', async () => {
  const w = town([stack('crafting_table', 2), stack('oak_log', 30)])
  loopBot(w)
  const ran = await decisions(w.bot, 2, { result: n => (n === 1 ? { status: 'failed', failClass: 'no_path', detail: 'could not reach the plan cell' } : { status: 'success', detail: 'ok', delta: {}, contractEvidence: ['probe'] }) })
  assert.equal(ran[0]?.skill, 'found_work')
  assert.notEqual(ran[1]?.skill, 'found_work', JSON.stringify(ran))
})

console.log('found x protectzone: the showcase zones files')
await t('THE SHOWCASE ZONES: the infra file and the fixture hold the same zones (trial-chambers-home-se included, owner #18); the seed avoid box is that box', () => {
  const infra = JSON.parse(readFileSync(new URL('../../infra/showcase/protected-zones.showcase.json', import.meta.url), 'utf8'))
  const fix = JSON.parse(readFileSync(new URL('./fixtures/protected-zones.showcase.json', import.meta.url), 'utf8'))
  const site = JSON.parse(readFileSync(new URL('../../infra/showcase/town-site.json', import.meta.url), 'utf8'))
  const ids = d => d.zones.map(z => z.id).sort()
  assert.deepEqual(ids(infra), ids(fix), 'the deployable file and the fixture name the same zones')
  assert.ok(ids(infra).includes('trial-chambers-home-se'), 'the trial chambers are in the deployable file')
  assert.equal(ids(infra).length, 8, 'positive control: seven villages + the trial chambers were compared')
  for (const z of infra.zones) assert.deepEqual(fix.zones.find(q => q.id === z.id).box, z.box, z.id)
  const tc = infra.zones.find(z => z.id === 'trial-chambers-home-se')
  const av = (site.town_plan?.avoid ?? site.avoid ?? []).find(a => a.id === 'trial-chambers-home-se')
  assert.ok(av, 'the seed avoid box'); assert.deepEqual(av.box, tc.box)
})

console.log(`\nfound-compose: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
