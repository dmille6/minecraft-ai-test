// FEWER LLM DECISIONS (fewerdec.mjs; serving D, owner 11-01): the two rules as pure decisions, then through the REAL
// cognitive loop (a fake runner and a counting LLM), then mutants of both the rule and the wiring.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-fewerdec'
process.env.BOT_NAME = process.env.BOT_NAME || 'FewerBot'
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
const FD = await import('../src/fewerdec.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { tapRecords } = await import('../src/logger.mjs')

const FD_PATH = new URL('../src/fewerdec.mjs', import.meta.url)
const COG_PATH = new URL('../src/cognitive.mjs', import.meta.url)
/** The repo's withMutant (climb-escape.test.mjs): the anchor must be present AND unique, or the mutant reads as killed. */
async function withMutant (p, old, neu, fn) {
  const src = fs.readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const out = new URL(`./_mutant-fd-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}

const cfg = (over = {}) => ({ ...FD.fewerDecConfig({}), ...over })
const items = [{ name: 'cobblestone', count: 20 }, { name: 'stone_pickaxe', count: 1 }]
const SIG = FD.decisionSig({ milestoneId: 'm1', pos: { x: 3, y: 64, z: 3 }, items })
const vetoed = (over = {}) => ({ sig: SIG, skill: 'explore', args: { blocks: 60 }, reason: 'repeat_loop', at: 1000, skips: 0, ...over })
const stillFull = () => 'repeat_loop'

// ---------------------------------------------------------------- config
test('CONFIG: unset = both rules on, repeat_loop only, one skip, 10 s delay; each switch turns its own rule off', () => {
  const d = FD.fewerDecConfig({})
  assert.equal(d.pauseWait, true); assert.equal(d.vetoSkip, true)
  assert.deepEqual([...d.vetoReasons], ['repeat_loop']); assert.equal(d.vetoSkipMax, 1); assert.equal(d.vetoSkipDelayMs, 10_000)
  const a = FD.fewerDecConfig({ FEWERDEC_PAUSEWAIT: '0' }); assert.equal(a.pauseWait, false); assert.equal(a.vetoSkip, true)
  const b = FD.fewerDecConfig({ FEWERDEC_VETOSKIP: '0' }); assert.equal(b.vetoSkip, false); assert.equal(b.pauseWait, true)
  assert.deepEqual([...FD.fewerDecConfig({ FEWERDEC_VETOSKIP_REASONS: 'repeat_loop, unreachable_elevation' }).vetoReasons], ['repeat_loop', 'unreachable_elevation'])
  assert.equal(FD.fewerDecConfig({ FEWERDEC_VETOSKIP_MAX: 'junk' }).vetoSkipMax, 1, 'a bad number falls back to the default')
})

// ---------------------------------------------------------------- PAUSEWAIT
test('PAUSEWAIT: an idle tick inside the pause skips and wakes at its end (+ margin); after it, or with no pause, it asks', () => {
  const base = { cfg: cfg(), trigger: 'idle', paused: true, pausedAt: 10_000, recoveryMs: 120_000 }
  assert.deepEqual(FD.pauseWaitDecision({ ...base, now: 80_000 }), { skip: true, wakeInMs: 50_250 })
  assert.equal(FD.pauseWaitDecision({ ...base, now: 130_000 }).skip, false, 'expired: the next run() auto-resumes')
  assert.equal(FD.pauseWaitDecision({ ...base, paused: false, now: 40_000 }).skip, false)
  assert.equal(FD.pauseWaitDecision({ ...base, pausedAt: null, now: 40_000 }).skip, false, 'no timestamp, no guess')
})
test('PAUSEWAIT: a non-idle trigger (death, entombed, startup) always reaches the model; the switch turns it off', () => {
  const base = { cfg: cfg(), paused: true, pausedAt: 10_000, recoveryMs: 120_000, now: 40_000 }
  for (const t of ['death', 'entombed', 'startup', 'liveness_restart', 'stagnation']) assert.equal(FD.pauseWaitDecision({ ...base, trigger: t }).skip, false, t)
  assert.equal(FD.pauseWaitDecision({ ...base, cfg: cfg({ pauseWait: false }), trigger: 'idle' }).skip, false)
})
test('PAUSEWAIT MUTANT KILLED: without the idle-only guard a death inside the pause would be held up to 120 s', async () => {
  await withMutant(FD_PATH, "if (!cfg?.pauseWait || trigger !== 'idle') return", 'if (!cfg?.pauseWait) return', async M => {
    assert.equal(M.pauseWaitDecision({ cfg: cfg(), trigger: 'death', paused: true, pausedAt: 10_000, recoveryMs: 120_000, now: 40_000 }).skip, true)
  })
})

// ---------------------------------------------------------------- signature
test('SIGNATURE: same cell and same count buckets are the same decision; a cell, a bucket, a new item or the task breaks it', () => {
  const s = (o = {}) => FD.decisionSig({ milestoneId: 'm1', pos: { x: 3, y: 64, z: 3 }, items, ...o })
  assert.equal(s({ pos: { x: 6.9, y: 67.5, z: 0.2 } }), SIG, 'inside the same 8x4x8 cell')
  assert.equal(s({ items: [{ name: 'cobblestone', count: 30 }, { name: 'stone_pickaxe', count: 1 }] }), SIG, '20 -> 30 is the same bucket')
  assert.notEqual(s({ pos: { x: 9, y: 64, z: 3 } }), SIG)
  assert.notEqual(s({ items: [{ name: 'cobblestone', count: 64 }, { name: 'stone_pickaxe', count: 1 }] }), SIG)
  assert.notEqual(s({ items: [...items, { name: 'raw_iron', count: 1 }] }), SIG)
  assert.notEqual(s({ milestoneId: 'm2' }), SIG)
})

// ---------------------------------------------------------------- VETOSKIP
test('VETOSKIP: a recent repeat_loop veto, same state, key still in the window, idle -> skip once', () => {
  assert.deepEqual(FD.vetoSkipDecision({ cfg: cfg(), trigger: 'idle', last: vetoed(), sig: SIG, now: 20_000, memoryRefuses: stillFull }), { skip: true, why: 'repeat_loop' })
})
test('VETOSKIP: every way out asks the model -- admitted, other reason, already skipped, stale, moved, window cleared, non-idle, off', () => {
  const ask = (o) => FD.vetoSkipDecision({ cfg: cfg(), trigger: 'idle', last: vetoed(), sig: SIG, now: 20_000, memoryRefuses: stillFull, ...o })
  assert.equal(ask({ last: vetoed({ reason: null }) }).why, 'not_vetoed')
  assert.equal(ask({ last: null }).why, 'not_vetoed')
  assert.equal(ask({ last: vetoed({ reason: 'learned_avoid' }) }).why, 'reason')
  assert.equal(ask({ last: vetoed({ skips: 1 }) }).why, 'max_skips', 'the chain is never closed: one skip, then the model')
  assert.equal(ask({ now: 1000 + 90_001 }).why, 'stale')
  assert.equal(ask({ sig: SIG + 'x' }).why, 'state_changed')
  assert.equal(ask({ memoryRefuses: () => null }).why, 'window_cleared', 'an escape or other admitted keys emptied the window')
  assert.equal(ask({ memoryRefuses: () => 'learned_avoid' }).why, 'window_cleared', 'a peer failure can make it milestone-critical')
  assert.equal(ask({ memoryRefuses: () => { throw new Error('x') } }).why, 'window_cleared', 'a read that throws never skips')
  assert.equal(ask({ trigger: 'entombed' }).why, 'trigger')
  assert.equal(ask({ cfg: cfg({ vetoSkip: false }) }).why, 'off')
})
test('VETOSKIP: a reason added by FEWERDEC_VETOSKIP_REASONS skips on the signature alone (no memory check applies)', () => {
  const c = FD.fewerDecConfig({ FEWERDEC_VETOSKIP_REASONS: 'repeat_loop,unreachable_elevation' })
  assert.equal(FD.vetoSkipDecision({ cfg: c, trigger: 'idle', last: vetoed({ reason: 'unreachable_elevation' }), sig: SIG, now: 20_000, memoryRefuses: () => null }).skip, true)
})
test('VETOSKIP MUTANT KILLED: without the window re-check a cleared repeat window would still be skipped', async () => {
  await withMutant(FD_PATH, "if (still !== 'repeat_loop') return { skip: false, why: 'window_cleared' }", '', async M => {
    assert.equal(M.vetoSkipDecision({ cfg: cfg(), trigger: 'idle', last: vetoed(), sig: SIG, now: 20_000, memoryRefuses: () => null }).skip, true)
  })
})
test('VETOSKIP MUTANT KILLED: without the skip cap the rule would close the chain for good', async () => {
  await withMutant(FD_PATH, "if ((last.skips ?? 0) >= (cfg.vetoSkipMax ?? 0)) return { skip: false, why: 'max_skips' }", '', async M => {
    assert.equal(M.vetoSkipDecision({ cfg: cfg(), trigger: 'idle', last: vetoed({ skips: 5 }), sig: SIG, now: 20_000, memoryRefuses: stillFull }).skip, true)
  })
})

// ---------------------------------------------------------------- the REAL loop
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-fd-'))
let seq = 0
function fieldBot () {
  // far from home (no town orders), a pickaxe (no withdraw), a few slots used (no hygiene)
  const inv = [{ name: 'stone_pickaxe', count: 1, slot: 9, type: mcData.itemsByName.stone_pickaxe.id, maxDurability: 131, durabilityUsed: 11 },
    { name: 'cobblestone', count: 20, slot: 10, type: mcData.itemsByName.cobblestone.id }]
  return {
    entity: { position: new Vec3(400, 70, 400), velocity: { x: 0, y: 0, z: 0 } }, health: 20, food: 20, oxygenLevel: 300,
    time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, serverDifficulty: 'peaceful',
    inventory: { items: () => inv }, registry: mcData, recipesFor: () => [], recipesAll: () => [],
    findBlock: () => null, findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    setControlState: () => {}, clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'FewerBot',
  }
}
async function drive (mod, { runner, proposal, fewer, ms }) {
  const calls = [], skips = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_decision_skipped') skips.push({ t: Date.now(), d: r.skill.detail }) })
  const L = new Lessons(path.join(dir, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}
  const loop = new mod.CognitiveLoop(fieldBot(), runner, L, null)
  if (fewer) loop.fewerDec = fewer
  loop.llm = { decide: async ({ user }) => { if (!/TRIGGER: startup/.test(user ?? '')) calls.push(Date.now()); return { schemaValid: true, latencyMs: 1, raw: '{}', proposal: { ...proposal } } } }
  loop.start()
  await new Promise(r => setTimeout(r, ms))
  loop.stop(); untap()
  return { calls, skips }
}
function pausedRunner (pauseMs) {
  const r = { paused: true, pausedAt: Date.now(), ran: 0, isBusy: () => false,
    run: async () => { r.ran++; if (Date.now() - r.pausedAt >= pauseMs) { r.paused = false; r.pausedAt = null; return { status: 'success', detail: 'ok', contractEvidence: ['position: moved 3 blocks'] } }
                       return { status: 'failed', failClass: 'runner_paused', detail: 'paused after repeated failures; 1s until auto-resume' } } }
  return r
}
const okRunner = () => ({ ran: 0, isBusy: () => false, run: async function () { this.ran++; return { status: 'success', detail: 'ok', contractEvidence: ['position: moved 3 blocks'] } } })
const COG = await import('../src/cognitive.mjs')

test('LOOP PAUSEWAIT: inside a 600 ms pause no idle model call is made (startup still asks); the first call comes right after the pause ends', async () => {
  const runner = pausedRunner(600)
  const t0 = runner.pausedAt
  const { calls, skips } = await drive(COG, { runner, proposal: { skill: 'status', args: {}, reason: 'p' }, ms: 1100 })
  assert.equal(calls.filter(t => t < t0 + 600).length, 0, `calls inside the pause: ${calls.map(t => t - t0)}`)
  assert.ok(calls.length >= 1, 'the model is asked again once the pause is over')
  assert.ok(calls[0] - t0 < 600 + 250 + 150, `woke ${calls[0] - t0} ms after the pause began`)
  assert.ok(skips.some(s => /rule=pausewait/.test(s.d)), 'each skip writes a decision_skipped row')
})
test('LOOP PAUSEWAIT OFF (positive control): the same pause makes the old loop ask the model and be refused', async () => {
  const runner = pausedRunner(600)
  const t0 = runner.pausedAt
  const { calls, skips } = await drive(COG, { runner, proposal: { skill: 'status', args: {}, reason: 'p' }, fewer: FD.fewerDecConfig({ FEWERDEC_PAUSEWAIT: '0' }), ms: 900 })
  assert.ok(calls.filter(t => t < t0 + 600).length >= 2, `the old cadence asks inside the pause (${calls.length} calls)`)
  assert.deepEqual(skips.filter(s => /pausewait/.test(s.d)), [], JSON.stringify(skips))
})
test('LOOP PAUSEWAIT WIRING MUTANT KILLED: with the skip unwired, the loop asks inside the pause', async () => {
  await withMutant(COG_PATH, "      if (pw.skip) return this.#skipDecision(", "      if (false) return this.#skipDecision(", async M => {
    const runner = pausedRunner(600)
    const t0 = runner.pausedAt
    const { calls } = await drive(M, { runner, proposal: { skill: 'status', args: {}, reason: 'p' }, ms: 700 })
    assert.ok(calls.filter(t => t < t0 + 600).length >= 1)
  })
})

// the same action every time: four admissions fill the repeat window, then every proposal is a repeat_loop veto
const fast = FD.fewerDecConfig({ FEWERDEC_VETOSKIP_DELAY_MS: '40', FEWERDEC_PAUSEWAIT: '0' })
test('LOOP VETOSKIP: after the window fills, every repeat_loop veto is followed by exactly one skipped tick, then a call', async () => {
  const { calls, skips } = await drive(COG, { runner: okRunner(), proposal: { skill: 'status', args: {}, reason: 'p' }, fewer: fast, ms: 1500 })
  const vs = skips.filter(s => /rule=vetoskip repeat_loop: status/.test(s.d))
  assert.ok(calls.length >= 8, `enough decisions (${calls.length})`)
  assert.ok(vs.length >= 2, `skips ${vs.length}`)
  // alternation: never two skips without a model call between them (max one skip)
  const ev = [...calls.map(t => ({ t, k: 'c' })), ...vs.map(s => ({ t: s.t, k: 's' }))].sort((a, b) => a.t - b.t).map(e => e.k).join('')
  if (process.env.FD_DEBUG) console.log("EV", ev)
  assert.ok(!/ss/.test(ev), `two skips in a row: ${ev}`)
  assert.match(ev, /^cccc/, `the first four (admitted) calls are never skipped: ${ev}`)
  const after = ev.slice(5)
  assert.ok(Math.abs((after.match(/s/g) ?? []).length - (after.match(/c/g) ?? []).length) <= 1, `one skip per veto: ${ev}`)
})
test('LOOP VETOSKIP OFF (positive control): the same proposals make the old loop ask every tick', async () => {
  const { calls, skips } = await drive(COG, { runner: okRunner(), proposal: { skill: 'status', args: {}, reason: 'p' }, fewer: FD.fewerDecConfig({ FEWERDEC_VETOSKIP: '0', FEWERDEC_PAUSEWAIT: '0' }), ms: 800 })
  assert.ok(calls.length >= 8); assert.equal(skips.length, 0)
})
test('LOOP VETOSKIP: an admitted action never arms a skip (a varied model is asked every tick)', async () => {
  let n = 0
  const runner = okRunner()
  const calls = [], skips = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_decision_skipped') skips.push(r) })
  const loop = new COG.CognitiveLoop(fieldBot(), runner, new Lessons(path.join(dir, `l${seq++}.json`)), null)
  loop.fewerDec = fast
  loop.llm = { decide: async () => { calls.push(1); n++; return { schemaValid: true, latencyMs: 1, raw: '{}', proposal: { skill: 'gather', args: { block: 'dirt', count: 1 + (n % 7) }, reason: 'p' } } } }
  loop.start(); await new Promise(r => setTimeout(r, 600)); loop.stop(); untap()
  assert.ok(calls.length >= 5); assert.equal(skips.length, 0)
})
test('LOOP VETOSKIP WIRING MUTANT KILLED: with the skip unwired, no tick is skipped', async () => {
  await withMutant(COG_PATH, '      if (vs.skip) {', '      if (false) {', async M => {
    const { skips } = await drive(M, { runner: okRunner(), proposal: { skill: 'status', args: {}, reason: 'p' }, fewer: fast, ms: 900 })
    assert.equal(skips.length, 0)
  })
})

// ---------------------------------------------------------------- CONTINUE
test('CONTINUE AFTER RUN: only a successful, serving, gaining gather from the model (or its continuation) is remembered', () => {
  const c = cfg()
  const base = { cfg: c, source: 'model', skill: 'gather', args: { block: 'dirt', count: 1 }, status: 'success', serving: true, gained: 1, prev: null }
  assert.deepEqual(FD.continueAfterRun(base), { skill: 'gather', args: { block: 'dirt', count: 1 }, n: 0 })
  assert.deepEqual(FD.continueAfterRun({ ...base, source: 'continue', prev: { skill: 'gather', n: 0 } }), { skill: 'gather', args: { block: 'dirt', count: 1 }, n: 1 })
  for (const o of [{ status: 'failed' }, { status: 'not_run' }, { serving: false }, { gained: 0 }, { skill: 'explore' }, { source: 'order' }, { cfg: cfg({ cont: false }) }])
    assert.equal(FD.continueAfterRun({ ...base, ...o }), null, JSON.stringify(o))
})
test('CONTINUE ORDER: below the cap and admitted by the gate memory -> the same gather; at the cap or refused -> none', () => {
  const cont = { skill: 'gather', args: { block: 'dirt', count: 1 }, n: 0 }
  const o = FD.continueOrder({ cfg: cfg(), trigger: 'idle', cont, memoryRefuses: () => null })
  assert.equal(o.skill, 'gather'); assert.deepEqual(o.args, { block: 'dirt', count: 1 }); assert.equal(o.continuation, true)
  assert.equal(FD.continueOrder({ cfg: cfg(), trigger: 'idle', cont: { ...cont, n: 2 }, memoryRefuses: () => null }), null)
  for (const why of ['cooldown', 'learned_avoid', 'repeat_loop']) assert.equal(FD.continueOrder({ cfg: cfg(), trigger: 'idle', cont, memoryRefuses: () => why }), null, why)
  assert.equal(FD.continueOrder({ cfg: cfg(), trigger: 'idle', cont, memoryRefuses: () => { throw new Error('x') } }), null, 'a read that throws never continues')
  assert.equal(FD.continueOrder({ cfg: cfg({ cont: false }), trigger: 'idle', cont, memoryRefuses: () => null }), null)
})
test('CONTINUE SCHEDULE: a success opens the cooldown window with early ticks; a failure is the plain cooldown; the model is never asked before the window ends', () => {
  const c = cfg()
  const s1 = FD.continueSchedule({ cfg: c, ranOk: true, window: null, now: 0, cooldownMs: 30_000 })
  assert.deepEqual(s1, { delayMs: 500, window: { until: 30_000, early: 1 } })
  const s3 = FD.continueSchedule({ cfg: c, ranOk: true, window: { until: 30_000, early: 3 }, now: 2_000, cooldownMs: 30_000 })
  assert.deepEqual(s3, { delayMs: 28_000, window: { until: 30_000, early: 3 } }, 'early ticks spent: wait the rest of the window')
  assert.deepEqual(FD.continueSchedule({ cfg: c, ranOk: false, window: { until: 30_000, early: 1 }, now: 2_000, cooldownMs: 30_000 }), { delayMs: 30_000, window: null })
  assert.equal(FD.continueSchedule({ cfg: c, ranOk: true, window: null, now: 0, cooldownMs: 40 }).delayMs, 40, 'never slower than the cooldown')
  assert.deepEqual(FD.continueSchedule({ cfg: c, ranOk: true, window: { until: 30_000, early: 3 }, now: 31_000, cooldownMs: 30_000 }), { delayMs: 500, window: null },
    'a spent window closes: the next tick decides as usual, and a success there opens a fresh budget')
  assert.equal(FD.continueWait({ cfg: c, window: { until: 30_000 }, now: 1_000, trigger: 'idle' }), 29_000)
  assert.equal(FD.continueWait({ cfg: c, window: { until: 30_000 }, now: 31_000, trigger: 'idle' }), 0)
  assert.equal(FD.continueWait({ cfg: c, window: { until: 30_000 }, now: 1_000, trigger: 'entombed' }), 0, 'a reflex handoff is not held')
  assert.deepEqual(FD.continueSchedule({ cfg: cfg({ cont: false }), ranOk: true, window: null, now: 0, cooldownMs: 30_000 }), { delayMs: 30_000, window: null })
})
test('CONTINUE MUTANT KILLED: without the gate-memory check a cooling-down gather would be continued', async () => {
  await withMutant(FD_PATH, '  if (refused) return null\n', '', async M => {
    assert.notEqual(M.continueOrder({ cfg: cfg(), trigger: 'idle', cont: { skill: 'gather', args: { block: 'dirt', count: 1 }, n: 0 }, memoryRefuses: () => 'cooldown' }), null)
  })
})

function dirtRunner (status = 'success') {
  const r = { seq: '', isBusy: () => false, bot: null,
    run: async (skill, args) => {
      r.seq += skill === 'gather' ? 'g' : 'x'
      if (skill === 'gather' && status === 'success') {
        const inv = r.bot.inventory.items(); const d = inv.find(i => i.name === 'dirt')
        if (d) d.count++; else inv.push({ name: 'dirt', count: 1, slot: 20, type: mcData.itemsByName.dirt.id })
        return { status: 'success', detail: 'collected 1 dirt', contractEvidence: ['inventory_gain: dirt +1'] }
      }
      return { status: 'failed', detail: 'dirt found but unreachable', failClass: 'unreachable' }
    } }
  return r
}
async function driveDirt (mod, { status = 'success', fewer, ms = 700 }) {
  const runner = dirtRunner(status)
  const bot = fieldBot(); runner.bot = bot
  const L = new Lessons(path.join(dir, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}
  const loop = new mod.CognitiveLoop(bot, runner, L, null)
  loop.fewerDec = fewer ?? FD.fewerDecConfig({ FEWERDEC_PAUSEWAIT: '0', FEWERDEC_VETOSKIP: '0' })
  loop.llm = { decide: async () => { runner.seq += 'c'; return { schemaValid: true, latencyMs: 1, raw: '{}', proposal: { skill: 'gather', args: { block: 'dirt', count: 1 }, reason: 'p' } } } }
  loop.start(); await new Promise(r => setTimeout(r, ms)); loop.stop()
  return runner.seq
}
test('LOOP CONTINUE: a model gather that gains dirt for gather_dirt_16 is continued twice before the model is asked again', async () => {
  const s = await driveDirt(COG, {})
  assert.match(s, /^cgggcg/, s)
  assert.ok(!/gggg/.test(s), `never more than two continuations: ${s}`)
})
test('LOOP CONTINUE OFF (positive control): the old loop asks the model before every gather', async () => {
  const s = await driveDirt(COG, { fewer: FD.fewerDecConfig({ FEWERDEC_PAUSEWAIT: '0', FEWERDEC_VETOSKIP: '0', FEWERDEC_CONTINUE: '0' }) })
  assert.match(s, /^cgcgcg/, s); assert.ok(!/gg/.test(s), s)
})
test('LOOP CONTINUE: a failing gather is never continued (the failure takes the plain cooldown)', async () => {
  const s = await driveDirt(COG, { status: 'failed', ms: 500 })
  assert.ok(s.length >= 4 && !/gg/.test(s), s)
})
test('LOOP CONTINUE WIRING MUTANT KILLED: with the continuation unwired, every gather is the model\'s', async () => {
  await withMutant(COG_PATH, '    if (!order) { const co = continueOrder(', '    if (false) { const co = continueOrder(', async M => {
    const s = await driveDirt(M, {})
    assert.ok(!/gg/.test(s), s)
  })
})
test('LOOP CONTINUE WINDOW: with a 400 ms cooldown, early ticks after a success never ask the model before the cooldown ends', async () => {
  const { config } = await import('../src/config.mjs')
  const was = config.llm.decisionCooldownMs
  config.llm.decisionCooldownMs = 400
  try {
    const runner = okRunner(); const at = []
    const orig = runner.run.bind(runner)
    runner.run = async (...a) => { const r = await orig(...a); at.push(['run', Date.now()]); return r }
    const L = new Lessons(path.join(dir, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}
    const loop = new COG.CognitiveLoop(fieldBot(), runner, L, null)
    loop.fewerDec = FD.fewerDecConfig({ FEWERDEC_PAUSEWAIT: '0', FEWERDEC_VETOSKIP: '0', FEWERDEC_CONTINUE_DELAY_MS: '20' })
    let n = 0
    loop.llm = { decide: async () => { at.push(['call', Date.now()]); n++; return { schemaValid: true, latencyMs: 1, raw: '{}', proposal: { skill: 'status', args: { n }, reason: 'p' } } } }
    loop.start(); await new Promise(r => setTimeout(r, 1500)); loop.stop()
    const calls = at.filter(e => e[0] === 'call').map(e => e[1])
    assert.ok(calls.length >= 3, `calls ${calls.length}`)
    for (let i = 1; i < calls.length; i++) assert.ok(calls[i] - calls[i - 1] >= 390, `model asked ${calls[i] - calls[i - 1]} ms after the previous call`)
  } finally { config.llm.decisionCooldownMs = was }
})

test('PAUSEWAIT: the wake is capped below the liveness limit (a long pause skips once more instead of tripping loop_restart)', () => {
  const d = FD.pauseWaitDecision({ cfg: cfg(), trigger: 'idle', paused: true, pausedAt: 0, recoveryMs: 120_000, now: 0 })
  assert.equal(d.skip, true); assert.equal(d.wakeInMs, FD.PAUSE_WAKE_CAP_MS); assert.ok(FD.PAUSE_WAKE_CAP_MS < 120_000)
})
test('CONTINUE x REPEAT WINDOW (Claude review note 1): model, 2 continuations, model, model -- the model repeat is not vetoed earlier than without continuations', async () => {
  const { AdmissionControl } = await import('../src/admission.mjs')
  const A = new AdmissionControl(null)
  const bot = fieldBot(); const k = ['gather', { block: 'dirt', count: 1 }]
  const model = () => A.check({ skill: k[0], args: k[1] }, bot, new Set(['dirt']))
  const cont = () => { const r = A.check({ skill: k[0], args: k[1] }, bot, new Set(['dirt'])); if (r.ok && r.kind === 'normal') A.forgetLastAdmitted(AdmissionControl.key(...k)); return r }
  const seq = [model(), cont(), cont(), model(), model(), model()].map(r => r.ok ? 'ok' : r.reason)
  assert.deepEqual(seq, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'], 'four model proposals admitted, as before the change')
  assert.equal(model().reason, 'repeat_loop', 'the fifth model proposal is the first veto, exactly as without continuations')
  A.forgetLastAdmitted('gather:{"block":"sand"}'); assert.equal(A.recent.length, 4, 'another key is never removed')
})

test('CONTINUE (Codex r1 BLOCKER): a death, a reflex handoff, startup or a liveness restart is never answered by a continuation', () => {
  const cont = { skill: 'gather', args: { block: 'dirt', count: 1 }, n: 0 }
  for (const t of ['death', 'entombed', 'drowning', 'startup', 'liveness_restart', 'stagnation']) assert.equal(FD.continueOrder({ cfg: cfg(), trigger: t, cont, memoryRefuses: () => null }), null, t)
})
test('CONTINUE MUTANT KILLED: without the idle-only guard a death would get the stale gather', async () => {
  await withMutant(FD_PATH, "  if (trigger !== 'idle') return null\n", '', async M => {
    assert.notEqual(M.continueOrder({ cfg: cfg(), trigger: 'death', cont: { skill: 'gather', args: { block: 'dirt', count: 1 }, n: 0 }, memoryRefuses: () => null }), null)
  })
})
test('LOOP CONTINUE x DEATH: a death notified right after a continuable gather reaches the model (TRIGGER: death)', async () => {
  const runner = dirtRunner('success'); const bot = fieldBot(); runner.bot = bot
  const L = new Lessons(path.join(dir, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}
  const loop = new COG.CognitiveLoop(bot, runner, L, null)
  loop.fewerDec = FD.fewerDecConfig({ FEWERDEC_PAUSEWAIT: '0', FEWERDEC_VETOSKIP: '0', FEWERDEC_CONTINUE_MAX: '50' })
  const triggers = []
  loop.llm = { decide: async ({ user }) => { triggers.push((/TRIGGER: (\w+)/.exec(user ?? '') ?? [])[1]); return { schemaValid: true, latencyMs: 1, raw: '{}', proposal: { skill: 'gather', args: { block: 'dirt', count: 1 }, reason: 'p' } } } }
  loop.start()
  await new Promise(r => setTimeout(r, 150))
  // wait for a moment the runner is idle, then die
  loop.notify('death', 'died and respawned')
  await new Promise(r => setTimeout(r, 200)); loop.stop()
  assert.ok(triggers.includes('death'), `the model saw: ${triggers}`)
})
