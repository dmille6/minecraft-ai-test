// REPEATWORK-01 (repeatwork.mjs; idlegap): the repeat window as a pure decision, then the REAL gate (check + memoryRefuses +
// the outcome notes the cognitive layer makes), then the REAL cognitive loop (a fake runner, a scripted model), then anchored
// mutants of the rule and of the wiring.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-repeatwork'
process.env.BOT_NAME = process.env.BOT_NAME || 'RepeatBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.LLM_DECISION_COOLDOWN_MS = '300'
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
const RW = await import('../src/repeatwork.mjs')
const FD = await import('../src/fewerdec.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { tapRecords } = await import('../src/logger.mjs')

const RW_PATH = new URL('../src/repeatwork.mjs', import.meta.url)
const ADM_PATH = new URL('../src/admission.mjs', import.meta.url)
/** The repo's withMutant (climb-escape.test.mjs): the anchor must be present AND unique, or the mutant reads as killed.
 *  A mutant of repeatwork.mjs is loaded THROUGH a copy of admission.mjs that imports it (`via`), so the gate runs it. */
async function withMutant (p, old, neu, fn, { via = null } = {}) {
  const src = fs.readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const tag = `${process.pid}-${Math.random().toString(36).slice(2)}`
  const out = new URL(`./_mutant-rw-${tag}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  const files = [out]
  try {
    if (!via) return await fn(await import(`${out.href}?${Date.now()}_${Math.random()}`))
    const vsrc = fs.readFileSync(via, 'utf8')
    const name = path.basename(p.pathname)
    assert.ok(vsrc.includes(`from './${name}'`), `the importer does not import ${name}`)
    const vout = new URL(`./_mutant-rwv-${tag}.mjs`, import.meta.url)
    fs.writeFileSync(vout, vsrc.replace(`from './${name}'`, `from './_mutant-rw-${tag}.mjs'`).replace(/from '\.\/(?!_mutant)/g, "from '../src/"))
    files.push(vout)
    return await fn(await import(`${vout.href}?${Date.now()}_${Math.random()}`))
  } finally { for (const f of files) try { fs.unlinkSync(f) } catch {} }
}

const ON = RW.repeatWorkConfig({})
const D = (over = {}) => RW.repeatDecision({ cfg: ON, skill: 'gather', repeats: 4, window: 4, last: { gain: true, milestoneId: 'gather_dirt_16', targeted: true }, milestoneId: 'gather_dirt_16', ...over })

test('CONFIG: unset = on; REPEATWORK=0 is off', () => {
  assert.equal(RW.repeatWorkConfig({}).on, true)
  assert.equal(RW.repeatWorkConfig({ REPEATWORK: '0' }).on, false)
})

test('DECISION: below the window nothing is refused; at the window a gather whose last run gained on this rung is admitted', () => {
  assert.deepEqual(D({ repeats: 3 }), { refuse: false, why: null })
  assert.deepEqual(D({ repeats: 3, last: undefined }), { refuse: false, why: null })
  assert.deepEqual(D(), { refuse: false, why: 'progress' })
  assert.deepEqual(D({ repeats: 8 }), { refuse: false, why: 'progress' })
})

test('DECISION: everything else at the window is refused exactly as before', () => {
  const R = { refuse: true, why: 'repeat_loop' }
  assert.deepEqual(D({ last: undefined }), R, 'no run recorded')
  assert.deepEqual(D({ last: { gain: false, milestoneId: 'gather_dirt_16', targeted: true } }), R, 'the last run did not gain')
  assert.deepEqual(D({ last: { gain: true, milestoneId: 'gather_dirt_16', targeted: false } }), R, 'a rung with no target: any gain is "valuable"')
  assert.deepEqual(D({ milestoneId: 'stockpile_wood#4' }), R, 'the rung changed')
  assert.deepEqual(D({ milestoneId: null, last: { gain: true, milestoneId: null, targeted: true } }), R, 'no rung')
  for (const skill of ['mine', 'explore', 'goto', 'craft', 'deposit']) assert.deepEqual(D({ skill }), R, skill)
  assert.deepEqual(D({ cfg: RW.repeatWorkConfig({ REPEATWORK: '0' }) }), R, 'off')
})

test('LEDGER: bounded, newest kept, a re-set key moves to the newest place', () => {
  const m = new Map()
  for (let i = 0; i < RW.LEDGER_MAX + 10; i++) RW.ledgerSet(m, `k${i}`, { gain: true })
  assert.equal(m.size, RW.LEDGER_MAX); assert.ok(!m.has('k0')); assert.ok(m.has(`k${RW.LEDGER_MAX + 9}`))
  RW.ledgerSet(m, 'k10', { gain: false }); RW.ledgerSet(m, 'new', { gain: true })
  assert.ok(m.has('k10'), 'the refreshed key survived the next eviction'); assert.ok(!m.has('k11'))
})

test('TALLY: the read line names checks, refusals per check, admissions per bot-h, repeat refusals and progress admits', () => {
  const l = RW.tallyLine({ secs: 600, c: { checks: 40, refused: 10, admitted: 30, repeat_refused: 4, progress_admits: 3, gains: 12, fails: 5 } })
  for (const want of ['secs=600', 'checks=40', 'checks_per_min=4.00', 'refused=10', 'refusals_per_check=0.250', 'admitted=30', 'admitted_per_bot_h=180.0',
    'repeat_refused=4', 'progress_admits=3', 'gains=12', 'fails=5']) assert.ok(l.includes(want), `${want} in ${l}`)
})

// ---- the real gate --------------------------------------------------------------------------------------------------------
function fieldBot () {
  const inv = [{ name: 'stone_pickaxe', count: 1, slot: 9, type: mcData.itemsByName.stone_pickaxe.id, maxDurability: 131, durabilityUsed: 11 },
    { name: 'dirt', count: 3, slot: 10, type: mcData.itemsByName.dirt.id }]
  return {
    entity: { position: new Vec3(400, 70, 400), velocity: { x: 0, y: 0, z: 0 } }, health: 20, food: 20, oxygenLevel: 300,
    time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, serverDifficulty: 'peaceful',
    inventory: { items: () => inv }, registry: mcData, recipesFor: () => [], recipesAll: () => [],
    findBlock: () => null, findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    setControlState: () => {}, clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'RepeatBot',
  }
}
const DIRT = { skill: 'gather', args: { block: 'dirt', count: 16 } }
const WANT = new Set(['dirt'])
/** n proposals of `p`, each admitted run followed by `after(A, p)` (the cognitive layer's outcome note); -> reasons */
function seq (A, n, { p = DIRT, after = (G, q) => G.noteSuccess(q.skill, q.args), wanted = WANT, bot = fieldBot() } = {}) {
  const out = []
  for (let i = 0; i < n; i++) {
    const r = A.check({ skill: p.skill, args: { ...p.args } }, bot, wanted)
    out.push(r.ok ? 'ok' : r.reason)
    if (r.ok) after(A, { skill: r.skill, args: r.args })
  }
  return out
}
const gate = (ms = 'gather_dirt_16', M = AdmissionControl) => { const A = new M(null); A.activeMilestoneId = ms; return A }

test('GATE: a gather that gains every run is not refused by the window (the old gate refused the 5th)', () => {
  assert.deepEqual(seq(gate(), 8), Array(8).fill('ok'))
})
test('GATE POSITIVE CONTROL: REPEATWORK=0 refuses the 5th exactly as the old gate', () => {
  const A = gate(); A.repeatWork = RW.repeatWorkConfig({ REPEATWORK: '0' })
  assert.deepEqual(seq(A, 6), ['ok', 'ok', 'ok', 'ok', 'repeat_loop', 'repeat_loop'])
})
test('GATE: a run that gained nothing wanted (no note: neutral, declined, aborted) re-arms the window at once', () => {
  const A = gate()
  let i = 0
  const out = seq(A, 7, { after: (G, q) => { if (++i !== 5) G.noteSuccess(q.skill, q.args) } })
  assert.deepEqual(out, ['ok', 'ok', 'ok', 'ok', 'ok', 'repeat_loop', 'repeat_loop'], 'the 5th run gained nothing: the 6th is refused')
})
test('GATE: never gaining = the old window (the cooldown of a failure answers first, as before)', () => {
  assert.deepEqual(seq(gate(), 6, { after: () => {} }), ['ok', 'ok', 'ok', 'ok', 'repeat_loop', 'repeat_loop'])
  const f = seq(gate(), 2, { after: (G, q) => G.noteFailure(q.skill, q.args) })
  assert.deepEqual(f, ['ok', 'cooldown'])
})
test('GATE: the rung changing resets it; a rung with no target never earns it', () => {
  const A = gate()
  assert.deepEqual(seq(A, 4), Array(4).fill('ok'))
  A.activeMilestoneId = 'gather_dirt_16#2'
  assert.deepEqual(seq(A, 1), ['repeat_loop'], 'gains on the old rung do not carry over')
  assert.deepEqual(seq(gate('idle'), 6, { wanted: null }), ['ok', 'ok', 'ok', 'ok', 'repeat_loop', 'repeat_loop'], 'idle: wants nothing')
})
test('GATE: mine and explore keep the old window even when every run is noted valuable', () => {
  const bot = fieldBot()
  const M = { skill: 'mine', args: { y: 20 } }
  assert.deepEqual(seq(gate(), 6, { p: M, bot }), ['ok', 'ok', 'ok', 'ok', 'repeat_loop', 'repeat_loop'])
  const E = { skill: 'explore', args: { blocks: 60 } }
  assert.deepEqual(seq(gate(), 6, { p: E }), ['ok', 'ok', 'ok', 'ok', 'repeat_loop', 'repeat_loop'])
})
test('MEMORYREFUSES = CHECK: an order asking "would the gate refuse this?" gets the window answer check() gives', () => {
  for (const [name, after] of [['gaining', (G, q) => G.noteSuccess(q.skill, q.args)], ['not gaining', () => {}]]) {
    const A = gate()
    seq(A, 4, { after })
    const mr = A.memoryRefuses(DIRT.skill, DIRT.args)
    const ck = A.check({ ...DIRT, args: { ...DIRT.args } }, fieldBot(), WANT)
    assert.equal(mr === 'repeat_loop', ck.reason === 'repeat_loop', `${name}: memoryRefuses ${mr} vs check ${ck.reason ?? 'ok'}`)
  }
  const A = gate(); seq(A, 4); assert.equal(A.memoryRefuses(DIRT.skill, DIRT.args), null)
  const B = gate(); seq(B, 4, { after: () => {} }); assert.equal(B.memoryRefuses(DIRT.skill, DIRT.args), 'repeat_loop', 'positive control')
})
test('ROWS: a progress admit writes a repeat_progress row; the tally row carries the counts after 10 min', () => {
  const rows = []
  const untap = tapRecords(r => { const n = r?.skill?.name; if (n === '_repeat_progress' || n === '_repeatwork_tally') rows.push([n, r.skill.detail]) })
  try {
    const A = gate()
    seq(A, 5)
    assert.equal(rows.filter(r => r[0] === '_repeat_progress').length, 1)
    assert.match(rows.find(r => r[0] === '_repeat_progress')[1], /^gather:\{"block":"dirt","count":16\} repeats=4 rung=gather_dirt_16/)
    A.rwTally.t0 -= 11 * 60 * 1000
    seq(A, 1)
    const t = rows.filter(r => r[0] === '_repeatwork_tally')
    assert.equal(t.length, 1)
    const f = Object.fromEntries(t[0][1].split(' ').map(kv => kv.split('=')))
    // 6 proposals, all admitted, 2 of them past the window by progress; 5 gains noted before the 6th check (its own note comes after)
    assert.equal(f.checks, '6'); assert.equal(f.admitted, '6'); assert.equal(f.refused, '0'); assert.equal(f.progress_admits, '2'); assert.equal(f.gains, '5')
  } finally { untap() }
})

// ---- mutants of the rule and of the wiring ---------------------------------------------------------------------------------
test('RULE MUTANT KILLED: without the same-rung condition, gains on the old rung admit on the new one', async () => {
  await withMutant(RW_PATH, ' && milestoneId != null && last.milestoneId === milestoneId', '', async M => {
    const A = gate('gather_dirt_16', M.AdmissionControl); seq(A, 4)
    A.activeMilestoneId = 'gather_dirt_16#2'
    assert.deepEqual(seq(A, 1), ['ok'])
  }, { via: ADM_PATH })
})
test('RULE MUTANT KILLED: without the gather-only set, a mine that only descended is admitted past the window', async () => {
  await withMutant(RW_PATH, "export const PROGRESS_SKILLS = new Set(['gather'])", "export const PROGRESS_SKILLS = new Set(['gather', 'mine'])", async M => {
    assert.deepEqual(seq(gate('gather_dirt_16', M.AdmissionControl), 6, { p: { skill: 'mine', args: { y: 20 } } }).slice(4), ['ok', 'ok'])
  }, { via: ADM_PATH })
})
test('RULE MUTANT KILLED: without the target condition, an idle-rung gather earns it', async () => {
  await withMutant(RW_PATH, ' && last.targeted === true', '', async M => {
    assert.deepEqual(seq(gate('idle', M.AdmissionControl), 6, { wanted: null }).slice(4), ['ok', 'ok'])
  }, { via: ADM_PATH })
})
test('WIRING MUTANT KILLED: without the reset at admission, a neutral run after a gain keeps the key admitted', async () => {
  await withMutant(ADM_PATH, '    ledgerSet(this.lastRun, key, { gain: false, milestoneId: this.activeMilestoneId ?? null,\n', '    if (false) ledgerSet(this.lastRun, key, { gain: false, milestoneId: this.activeMilestoneId ?? null,\n', async M => {
    let i = 0
    const A = gate('gather_dirt_16', M.AdmissionControl)
    seq(A, 4)   // gains
    const out = seq(A, 3, { after: (G, q) => { if (++i > 99) G.noteSuccess(q.skill, q.args) } })   // no gains now
    assert.notDeepEqual(out, ['ok', 'repeat_loop', 'repeat_loop'], `the mutant keeps admitting: ${out}`)
  })
})
test('WIRING MUTANT KILLED: with noteSuccess not recording the run, nothing is ever admitted past the window', async () => {
  await withMutant(ADM_PATH, '    this.#noteRun(skill, args, true)\n', '', async M => {
    assert.deepEqual(seq(gate('gather_dirt_16', M.AdmissionControl), 6).slice(4), ['repeat_loop', 'repeat_loop'])
  })
})
test('WIRING MUTANT KILLED: memoryRefuses on the old count disagrees with check()', async () => {
  await withMutant(ADM_PATH, "    if (this.#repeat(skill, key).refuse) return 'repeat_loop'\n", "    if (this.recent.filter(k => k === key).length >= REPEAT_WINDOW) return 'repeat_loop'\n", async M => {
    const A = gate('gather_dirt_16', M.AdmissionControl); seq(A, 4)
    assert.equal(A.memoryRefuses(DIRT.skill, DIRT.args), 'repeat_loop')
    assert.equal(A.check({ ...DIRT, args: { ...DIRT.args } }, fieldBot(), WANT).ok, true)
  })
})

// ---- the real cognitive loop ---------------------------------------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-rw-'))
let lseq = 0
const RUNG = { id: 'gather_dirt_16', wants: 'dirt', wantsAny: null, describe: 'Collect 16 dirt.', progress: '3/16 dirt', hint: 'gather with block=dirt.' }
async function drive ({ gain = true, cfg = null, ms = 2600 } = {}) {
  const COG = await import('../src/cognitive.mjs')
  const { config } = await import('../src/config.mjs')
  const was = config.llm.decisionCooldownMs
  config.llm.decisionCooldownMs = 300
  try {
    const out = []
    const runner = { isBusy: () => false, run: async () => gain
      ? { status: 'success', detail: 'collected 3 dirt', delta: { inventory: { dirt: 3 } }, contractEvidence: ['inventory_gain: dirt +3'] }
      : { status: 'success', detail: 'collected 3 gravel', delta: { inventory: { gravel: 3 } }, contractEvidence: ['inventory_gain: gravel +3'] } }
    const L = new Lessons(path.join(dir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}
    const loop = new COG.CognitiveLoop(fieldBot(), runner, L, null)
    loop.fewerDec = FD.fewerDecConfig({ FEWERDEC_PAUSEWAIT: '0', FEWERDEC_VETOSKIP: '0', FEWERDEC_CONTINUE: '0' })
    if (cfg) loop.admission.repeatWork = cfg
    loop.milestones.status = () => ({ ...RUNG })
    loop.milestones.refresh = () => false
    const realCheck = loop.admission.check.bind(loop.admission)
    loop.admission.check = (p, b, w) => { const r = realCheck(p, b, w); if (p?.skill === 'gather') out.push(r.ok ? 'ok' : r.reason); return r }
    loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, raw: '{}', proposal: { ...DIRT, args: { ...DIRT.args }, reason: 'p' } }) }
    loop.start(); await new Promise(r => setTimeout(r, ms)); loop.stop()
    return out
  } finally { config.llm.decisionCooldownMs = was }
}
test('LOOP: the model asking for the gather that keeps gaining dirt on gather_dirt_16 is never refused by the window', async () => {
  const out = await drive()
  assert.ok(out.length >= 6, `enough decisions: ${out}`)
  assert.ok(!out.includes('repeat_loop'), out.join(','))
})
test('LOOP POSITIVE CONTROLS: REPEATWORK=0, or a gather gaining only off-target items, is refused from the 5th on', async () => {
  for (const o of [{ cfg: RW.repeatWorkConfig({ REPEATWORK: '0' }) }, { gain: false }]) {
    const out = await drive(o)
    assert.ok(out.length >= 6, `enough decisions: ${out}`)
    assert.deepEqual(out.slice(0, 5), ['ok', 'ok', 'ok', 'ok', 'repeat_loop'], `${JSON.stringify(o)}: ${out}`)
  }
})
