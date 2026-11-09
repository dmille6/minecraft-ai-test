// PIPELINED DECISIONS (pipeline.mjs, pipeline-01): the rules as pure decisions, the gate's dry run, then the REAL cognitive
// loop (a fake runner whose skill takes time, a counting LLM) in off / shadow / on, then mutants of the rules and the wiring.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-pipeline'
process.env.BOT_NAME = process.env.BOT_NAME || 'PipeBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.LLM_DECISION_COOLDOWN_MS = '40'
process.env.PAUSE_RECOVERY_MS = '600'
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
const PL = await import('../src/pipeline.mjs')
const FD = await import('../src/fewerdec.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { config } = await import('../src/config.mjs')

const PL_PATH = new URL('../src/pipeline.mjs', import.meta.url)
const COG_PATH = new URL('../src/cognitive.mjs', import.meta.url)
const ADM_PATH = new URL('../src/admission.mjs', import.meta.url)
/** The repo's withMutant (climb-escape.test.mjs): the anchor must be present AND unique, or the mutant reads as killed. */
async function withMutant (p, old, neu, fn) {
  const src = fs.readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const out = new URL(`./_mutant-pl-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------- the rules
test('CONFIG: unset or junk = off; shadow and on prefetch, only on skips the wait; knobs parse with defaults', () => {
  assert.equal(PL.pipelineConfig({}).mode, 'off'); assert.equal(PL.pipelineConfig({}).prefetch, false)
  assert.equal(PL.pipelineConfig({ PIPELINE: 'yes' }).mode, 'off')
  const sh = PL.pipelineConfig({ PIPELINE: 'shadow' }); assert.equal(sh.prefetch, true); assert.equal(sh.on, false)
  const on = PL.pipelineConfig({ PIPELINE: ' ON ' }); assert.equal(on.on, true); assert.equal(on.prefetchAfterMs, 3000)
  assert.equal(PL.pipelineConfig({ PIPELINE: 'on', PIPELINE_MAX_PER_MIN: 'x' }).maxPerMin, 4)
  assert.equal(PL.pipelineConfig({ PIPELINE: 'on', PIPELINE_MIN_P: '7' }).minP, 1)
})
const ON = PL.pipelineConfig({ PIPELINE: 'on' })
test('PREFETCH AT START: only a MODEL run, one in flight at most, never a skill this bot rarely finishes', () => {
  assert.equal(PL.prefetchAtStart({ cfg: PL.pipelineConfig({}), source: 'model', skill: 'mine' }).why, 'off')
  assert.equal(PL.prefetchAtStart({ cfg: ON, source: 'order', skill: 'mine' }).why, 'not_model')
  assert.equal(PL.prefetchAtStart({ cfg: ON, source: 'model', skill: 'mine', pending: true }).why, 'in_flight')
  assert.equal(PL.prefetchAtStart({ cfg: ON, source: 'model', skill: 'mine', stats: { mine: 0.1 } }).why, 'low_p')
  assert.equal(PL.prefetchAtStart({ cfg: ON, source: 'model', skill: 'mine', stats: {} }).go, true, 'prior 0.5 prefetches')
  let st = {}
  for (let i = 0; i < 12; i++) st = PL.noteRunP(st, 'bucket', false)
  assert.ok(PL.skillP(st, 'bucket') < 0.3 && PL.prefetchAtStart({ cfg: ON, source: 'model', skill: 'bucket', stats: st }).why === 'low_p')
  for (let i = 0; i < 12; i++) st = PL.noteRunP(st, 'bucket', true)
  assert.ok(PL.skillP(st, 'bucket') > 0.5, 'successes bring it back')
})
test('ARM AFTER RUN: only a run that ran and ENDED success, long enough, no reflex in it or waiting, not paused', () => {
  const base = { cfg: ON, executed: true, declined: false, status: 'success', interruptedBy: null, pendingTrigger: null, paused: false, runMs: 5000 }
  assert.deepEqual(PL.armAfterRun(base), { arm: true, why: 'success' })
  assert.equal(PL.armAfterRun({ ...base, interruptedBy: 'drowning' }).why, 'interrupted')
  assert.equal(PL.armAfterRun({ ...base, pendingTrigger: 'entombed' }).why, 'trigger_pending')
  assert.equal(PL.armAfterRun({ ...base, status: 'failed' }).why, 'run_failed')
  assert.equal(PL.armAfterRun({ ...base, status: 'unknown' }).why, 'run_unknown')
  assert.equal(PL.armAfterRun({ ...base, declined: true }).why, 'not_run')
  assert.equal(PL.armAfterRun({ ...base, paused: true }).why, 'paused')
  assert.equal(PL.armAfterRun({ ...base, runMs: 200 }).why, 'short_run')
  assert.equal(PL.armAfterRun({ ...base, cfg: PL.pipelineConfig({}) }).why, 'off')
})
test('NO-WAIT GUARD: at most maxPerMin no-wait decisions per rolling minute, and never outside `on`', () => {
  assert.equal(PL.noWaitAllowed({ cfg: ON, recent: [1, 2, 3], now: 10_000 }), true)
  assert.equal(PL.noWaitAllowed({ cfg: ON, recent: [1, 2, 3, 4], now: 10_000 }), false)
  assert.equal(PL.noWaitAllowed({ cfg: ON, recent: [1, 2, 3, 4], now: 70_000 }), true, 'a minute later the old ones are gone')
  assert.equal(PL.noWaitAllowed({ cfg: PL.pipelineConfig({ PIPELINE: 'shadow' }), recent: [], now: 1 }), false)
})
test('PREFETCH USABLE: the run that armed it, an idle tick, the same task, young, with a proposal', () => {
  const pf = { armId: 7, milestoneId: 'm1', startedAt: 1000, done: true, res: { schemaValid: true, proposal: { skill: 'mine', args: {} } } }
  const ok = { cfg: ON, pf, arm: { id: 7 }, trigger: 'idle', pendingTrigger: null, milestoneId: 'm1', now: 5000 }
  assert.deepEqual(PL.prefetchUsable(ok), { use: true, why: 'ready' })
  assert.equal(PL.prefetchUsable({ ...ok, arm: { id: 8 } }).why, 'not_armed')
  assert.equal(PL.prefetchUsable({ ...ok, arm: null }).why, 'not_armed')
  for (const t of ['death', 'entombed', 'drowning', 'startup', 'liveness_restart']) assert.equal(PL.prefetchUsable({ ...ok, trigger: t }).why, 'trigger', t)
  assert.equal(PL.prefetchUsable({ ...ok, pendingTrigger: 'stuck' }).why, 'trigger')
  assert.equal(PL.prefetchUsable({ ...ok, milestoneId: 'm2' }).why, 'task_changed')
  assert.equal(PL.prefetchUsable({ ...ok, now: 1000 + 60_001 }).why, 'too_old')
  assert.equal(PL.prefetchUsable({ ...ok, pf: { ...pf, res: { schemaValid: false, proposal: null } } }).why, 'no_proposal')
  assert.equal(PL.prefetchUsable({ ...ok, pf: { ...pf, done: false, res: null } }).why, 'in_flight')
})

// ---------------------------------------------------------------- the gate's dry run
function fieldBot () {
  // far from home (no town orders), a pickaxe (no withdraw), a few slots used (no hygiene)
  const inv = [{ name: 'stone_pickaxe', count: 1, slot: 9, type: mcData.itemsByName.stone_pickaxe.id, maxDurability: 131, durabilityUsed: 11 },
    { name: 'cobblestone', count: 20, slot: 10, type: mcData.itemsByName.cobblestone.id }]
  return {
    entity: { position: new Vec3(400, 70, 400), velocity: { x: 0, y: 0, z: 0 } }, health: 20, food: 20, oxygenLevel: 300,
    time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, serverDifficulty: 'peaceful',
    inventory: { items: () => inv }, registry: mcData, recipesFor: () => [], recipesAll: () => [],
    findBlock: () => null, findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    setControlState: () => {}, clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'PipeBot',
  }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-pl-'))
let seq = 0
const freshLessons = () => { const L = new Lessons(path.join(dir, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
const gateState = A => JSON.stringify({ recent: A.recent, vetoStreak: A.vetoStreak ?? 0, forced: A.forcedAdmissions ?? 0, blocked: A.blockedCount,
  persisted: A.lessons?.data?.progress?.blocked ?? null, crit: A.milestoneCriticalAdmissions ?? 0 })

test('DRY CHECK: the verdict check() would give, and the gate is left exactly as it was (window, streaks, probation)', () => {
  const A = new AdmissionControl(freshLessons()); const bot = fieldBot()
  const p = { skill: 'gather', args: { block: 'dirt', count: 1 } }
  for (let i = 0; i < 6; i++) {
    const before = gateState(A)
    const d = A.dryCheck(p, bot, new Set(['dirt']))
    assert.equal(gateState(A), before, `dry run ${i} wrote to the gate`)
    const r = A.check(p, bot, new Set(['dirt']))
    assert.equal(d.ok, r.ok, `dry ${d.reason ?? 'ok'} vs real ${r.reason ?? 'ok'} at ${i}`)
    assert.equal(d.reason, r.reason)
  }
  assert.equal(A.check(p, bot, new Set(['dirt'])).reason, 'repeat_loop', 'positive control: the sequence reached a refusal')
})
test('DRY CHECK: learned_avoid probation is peeked, never bumped (the persisted counter does not move)', () => {
  const L = freshLessons(); const A = new AdmissionControl(L); const bot = fieldBot()
  const p = { skill: 'goto', args: { x: 10, y: 70, z: 10 } }
  L.failCount = () => 9
  const before = gateState(A)
  const verdicts = []
  for (let i = 0; i < 7; i++) verdicts.push(A.dryCheck(p, bot, null).reason ?? 'ok')
  assert.equal(gateState(A), before, 'seven dry runs moved the probation counter')
  const real = A.check(p, bot, null)
  assert.equal(real.reason ?? 'ok', verdicts[0], 'the real check agrees with the dry run before it')
  assert.notEqual(gateState(A), before, 'positive control: the REAL check does write the gate')
})
test('DRY CHECK MUTANT KILLED: without the restore, a dry run fills the repeat window', async () => {
  await withMutant(ADM_PATH, '      Object.assign(this, keep)\n', '', async M => {
    const A = new M.AdmissionControl(freshLessons()); const bot = fieldBot()
    const before = gateState(A)
    A.dryCheck({ skill: 'gather', args: { block: 'dirt', count: 1 } }, bot, new Set(['dirt']))
    assert.notEqual(gateState(A), before)
  })
})

// ---------------------------------------------------------------- the REAL loop
const COG = await import('../src/cognitive.mjs')
/** A runner whose every skill takes `ms`, busy meanwhile. `script(i)` -> the result of run i (default success). */
function slowRunner (ms, script = () => ({})) {
  const r = { ran: 0, busy: false, paused: false, starts: [], ends: [], skills: [], isBusy () { return r.busy },
    async run (skill, args) {
      const i = r.ran++; r.busy = true; r.starts.push(Date.now()); r.skills.push(skill)
      await sleep(ms)
      r.busy = false; r.ends.push(Date.now())
      return { status: 'success', detail: 'ok', contractEvidence: ['position: moved 3 blocks'], ...script(i) }
    } }
  return r
}
/** Drive a real loop. The model answers `gather dirt x(1 + n % 7)` (a key the repeat window never fills); a prefetch prompt is told apart by its line. */
async function drive (mod, { mode, runner, ms = 1200, cooldown = 400, extra = {}, answer = null }) {
  const was = config.llm.decisionCooldownMs
  config.llm.decisionCooldownMs = cooldown
  const rows = [], calls = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_pipeline') rows.push(r.skill.detail) })
  try {
    const loop = new mod.CognitiveLoop(fieldBot(), runner, freshLessons(), null)
    loop.fewerDec = FD.fewerDecConfig({ FEWERDEC_PAUSEWAIT: '0', FEWERDEC_VETOSKIP: '0', FEWERDEC_CONTINUE_DELAY_MS: '20' })
    loop.pipe = PL.pipelineConfig({ PIPELINE: mode, PIPELINE_PREFETCH_AFTER_MS: '20', PIPELINE_NEXT_DELAY_MS: '10', PIPELINE_MIN_RUN_MS: '0',
                                    PIPELINE_MAX_PER_MIN: '1000', PIPELINE_WAIT_CAP_MS: '500', ...extra })
    let n = 0
    loop.llm = { decide: async ({ user }) => {
      const pre = /running now; plan the NEXT action/.test(user ?? '')
      calls.push({ t: Date.now(), pre, trig: (/TRIGGER: (\w+)/.exec(user ?? '') ?? [])[1] })
      await sleep(5); n++
      const proposal = (answer && answer({ pre, n })) ?? { skill: 'gather', args: { block: 'dirt', count: 1 + (n % 7) }, reason: 'p' }
      return { schemaValid: true, latencyMs: 5, raw: '{}', proposal, prompt_tokens: 100, completion_tokens: 10 }
    } }
    loop.start(); await sleep(ms); loop.stop(); await sleep(30)
    return { rows, calls, runner, loop }
  } finally { untap(); config.llm.decisionCooldownMs = was }
}
/** Gaps between one run's end and the next run's start. */
const gaps = r => r.ends.slice(0, r.starts.length - 1).map((e, i) => r.starts[i + 1] - e)

test('LOOP ON: after a successful run the next skill starts at once, on the prefetched pick (no fresh call between runs)', async () => {
  const { rows, calls, runner } = await drive(COG, { mode: 'on', runner: slowRunner(100) })
  const g = gaps(runner)
  assert.ok(runner.ran >= 5, `runs ${runner.ran}`)
  assert.ok(g.length >= 4 && g.every(x => x < 200), `every gap well under the 400 ms cooldown: ${g}`)
  const used = rows.filter(d => /use=used/.test(d))
  assert.ok(used.length >= 3, `used prefetches: ${rows.join(' | ')}`)
  const fresh = calls.filter(c => !c.pre && c.trig !== 'startup')
  assert.ok(fresh.length <= 1, `fresh calls after startup: ${fresh.length} (the prefetch should stand in)`)
})
test('LOOP OFF (positive control): the same runner waits the cooldown between runs and never prefetches', async () => {
  const { rows, calls, runner } = await drive(COG, { mode: 'off', runner: slowRunner(100) })
  const g = gaps(runner)
  assert.ok(g.length >= 1 && g.every(x => x >= 390), `gaps ${g}`)
  assert.equal(calls.filter(c => c.pre).length, 0); assert.equal(rows.length, 0)
})
test('LOOP SHADOW: the pacing is the old one, every decision is fresh, and the row says the prefetch would be used and agrees or not', async () => {
  const { rows, calls, runner } = await drive(COG, { mode: 'shadow', runner: slowRunner(100) })
  const g = gaps(runner)
  assert.ok(g.length >= 1 && g.every(x => x >= 390), `gaps ${g}`)
  assert.ok(calls.some(c => c.pre), 'prefetches were made')
  const w = rows.filter(d => /use=would_use/.test(d))
  assert.ok(w.length >= 1, rows.join(' | '))
  assert.ok(w.every(d => /agree=[01]/.test(d) && /fresh=gather/.test(d) && /saved_ms=\d+/.test(d)), w.join(' | '))
  assert.equal(rows.filter(d => /use=used/.test(d)).length, 0)
})
test('LOOP ON x REFLEX: a run a reflex interrupted voids the prefetch -- the next decision is fresh, with the reflex trigger, after the cooldown', async () => {
  const runner = slowRunner(100, i => (i === 1 ? { status: 'aborted', detail: 'interrupted', failClass: 'interrupted', interruptedBy: 'drowning' } : {}))
  const { rows, calls } = await drive(COG, { mode: 'on', runner, ms: 1500 })
  assert.ok(rows.some(d => /use=dropped why=interrupted/.test(d)), rows.join(' | '))
  const d = calls.find(c => c.trig === 'drowning')
  assert.ok(d && !d.pre, `the drowning decision was asked fresh: ${JSON.stringify(calls.map(c => c.trig + (c.pre ? '*' : '')))}`)
  assert.ok(runner.starts[2] - runner.ends[1] >= 390, `no early tick after an interrupt: ${runner.starts[2] - runner.ends[1]} ms`)
})
test('LOOP ON x FAILURE: a failed run keeps the cooldown and drops its prefetch', async () => {
  const runner = slowRunner(100, i => (i === 1 ? { status: 'failed', detail: 'no', failClass: 'unreachable' } : {}))
  const { rows } = await drive(COG, { mode: 'on', runner, ms: 1500 })
  assert.ok(rows.some(d => /use=dropped why=run_failed/.test(d)), rows.join(' | '))
  assert.ok(runner.starts[2] - runner.ends[1] >= 390, `gap after the failure ${runner.starts[2] - runner.ends[1]} ms`)
})
test('LOOP ON x GATE: a prefetch the dry run refuses falls back to ONE fresh call; the gate judges one proposal per decision', async () => {
  // the prefetch proposes a goto the gate refuses (no coordinates); the fresh call proposes a fine gather
  const answer = ({ pre, n }) => (pre ? { skill: 'goto', args: {}, reason: 'p' } : { skill: 'gather', args: { block: 'dirt', count: 1 + (n % 7) }, reason: 'p' })
  const runner = slowRunner(100)
  const was = AdmissionControl.prototype.check; let checks = 0
  AdmissionControl.prototype.check = function (...a) { checks++; return was.apply(this, a) }
  try {
    const { rows, calls } = await drive(COG, { mode: 'on', runner, answer })
    const fb = rows.filter(d => /use=fallback why=dry_/.test(d))
    assert.ok(fb.length >= 2, rows.join(' | '))
    assert.equal(rows.filter(d => /use=used/.test(d)).length, 0)
    const decisions = calls.filter(c => !c.pre).length
    assert.equal(checks, decisions, `check() ran ${checks} times for ${decisions} decisions`)
    assert.ok(gaps(runner).slice(0, 3).every(x => x < 200), `the fallback is asked at once, not after the cooldown: ${gaps(runner)}`)
  } finally { AdmissionControl.prototype.check = was }
})
test('LOOP ON x RUNAWAY GUARD: past maxPerMin no-wait decisions the cooldown comes back', async () => {
  const { runner } = await drive(COG, { mode: 'on', runner: slowRunner(60), extra: { PIPELINE_MAX_PER_MIN: '2' }, ms: 1500 })
  const g = gaps(runner)
  assert.ok(g.filter(x => x < 200).length === 2 && g.slice(2).every(x => x >= 390), `gaps ${g}`)
})

// ---------------------------------------------------------------- mutants
test('ARM MUTANT KILLED: without the interrupt check an interrupted run would arm the next decision', async () => {
  await withMutant(PL_PATH, "  if (interruptedBy) return { arm: false, why: 'interrupted' }\n", '', async M => {
    assert.equal(M.armAfterRun({ cfg: ON, executed: true, declined: false, status: 'success', interruptedBy: 'drowning', runMs: 5000 }).arm, true)
  })
})
test('USABLE MUTANT KILLED: without the trigger check a death would be answered by the prefetch', async () => {
  await withMutant(PL_PATH, "  if (trigger !== 'idle' || pendingTrigger) return { use: false, why: 'trigger' }\n", '', async M => {
    const pf = { armId: 1, milestoneId: null, startedAt: 0, done: true, res: { schemaValid: true, proposal: { skill: 'mine', args: {} } } }
    assert.equal(M.prefetchUsable({ cfg: ON, pf, arm: { id: 1 }, trigger: 'death', milestoneId: null, now: 1 }).use, true)
  })
})
test('LOOP WIRING MUTANT KILLED: with the prefetch unwired at the model call, `on` makes a fresh call every decision', async () => {
  await withMutant(COG_PATH, '      : pipeTake?.res ?? await this.llm.decide(', '      : await this.llm.decide(', async M => {
    const { rows, calls } = await drive(M, { mode: 'on', runner: slowRunner(100) })
    assert.ok(calls.filter(c => !c.pre && c.trig !== 'startup').length >= 3, 'fresh calls')
    assert.ok(rows.some(d => /use=used/.test(d)), 'the row still claims use: the wiring, not the rule, is what the mutant removed')
  })
})
test('LOOP WIRING MUTANT KILLED: with the no-wait unwired, `on` waits the cooldown after a success', async () => {
  await withMutant(COG_PATH, '      const w = Math.max(pipeNoWait ? 0 : continueWait(', '      const w = Math.max(false ? 0 : continueWait(', async M => {
    const { runner } = await drive(M, { mode: 'on', runner: slowRunner(100) })
    assert.ok(gaps(runner).some(x => x >= 390), `gaps ${gaps(runner)}`)
  })
})
