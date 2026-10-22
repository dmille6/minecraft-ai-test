// homefix-02 C3 (docs/reports/homefix-02-design-2026-10-21.md §4 C3, r6): a watchdog rescue never STARTS into a drowning
// in progress or a running pocket rung (C3a, the runner's admission at the instant of the start), is capped at 2
// consecutive such declines per rescue kind, and a running watchdog rescue is interrupted on every `danger` tick (C3b).
// Behaviour through the REAL Runner / StagnationWatchdog, each mechanism with an anchored mutant (helpers/mutant.mjs).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'homefix2-c3-'))
process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'homefix2-c3-state-'))
process.env.BOT_NAME = 'Homefix2C3Bot'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_SCOPE = 'isolated'
process.env.LOG_LEVEL ??= 'error'

const { withMutant } = await import('./helpers/mutant.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const { Runner } = await import('../src/runner.mjs')
const { StagnationWatchdog, rescueLevelStep, AIR_REFUND_CAP, strandRefund } = await import('../src/watchdog.mjs')
const { airDanger, healthFellWithin, airAdmission, airDeclineNext, airYieldsRun, AIR_DECLINE_CAP } = await import('../src/airstate.mjs')
const { RUNNER_DECLINED, runnerDeclined } = await import('../src/declined.mjs')
const { config } = await import('../src/config.mjs')
const { tapRecords } = await import('../src/logger.mjs')

const RUNNER_PATH = new URL('../src/runner.mjs', import.meta.url)
const WATCHDOG_PATH = new URL('../src/watchdog.mjs', import.meta.url)
const AIRSTATE_PATH = new URL('../src/airstate.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c),
                          distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z),
                          clone: () => V(x, y, z), floored: () => V(Math.floor(x), Math.floor(y), Math.floor(z)) })
function fakeBot ({ at = V(0, 70, 0), extra = {} } = {}) {
  return {
    entity: { position: at, onGround: true, velocity: V(0, 0, 0), isInWater: false },
    health: 20, food: 20, version: '1.21.8', username: 'Homefix2C3Bot',
    registry: { blocksByName: {}, itemsByName: {}, blocks: {} },
    inventory: { items: () => [] },
    blockAt (p) { return p.y < Math.floor(this.entity.position.y) ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' } },
    findBlock: () => null, findBlocks: () => [], entities: {}, players: {},
    time: { day: 1, age: 1 }, game: { dimension: 'overworld' },
    assertNav: () => {}, chat: () => {}, clearControlStates: () => {}, setControlState: () => {},
    quits: 0, quit () { this.quits++ },
    pathfinder: { movements: {}, setMovements () {}, stop () {}, setGoal () {}, goto: async () => {},
                  getPathTo: () => ({ status: 'success', path: [1] }) },
    ...extra,
  }
}
const DANGER = () => ({ danger: true, pocketing: false, airSeconds: 1.5, headUnder: true, at: Date.now() })
const CALM = () => ({ danger: false, pocketing: false, airSeconds: 15, headUnder: false, at: Date.now() })
function stuckSkill (name, { unwindMs = 0 } = {}) {
  SKILLS[name] = { run: (_c, _a, signal) => new Promise((_res, rej) => {
    signal.addEventListener('abort', () => setTimeout(() => { const e = new Error('aborted'); e.aborted = true; rej(e) }, unwindMs), { once: true })
  }) }
}
const quickSkill = (name, calls, ms = 30) => { SKILLS[name] = { run: async (_c, args) => { calls.push(args); await sleep(ms); return { status: 'success', detail: 'ok' } } } }
async function rows (re, fn) {
  const out = []
  const untap = tapRecords(r => { if (re.test(r?.skill?.name ?? '')) out.push(r) })
  try { await fn(out) } finally { untap() }
  return out
}

// =====================================================================================================================
console.log('-- the predicates (pure) --')
await t('danger = head under AND <= 5 s air AND health fell within 3 s; each missing term is not danger', () => {
  assert.equal(airDanger({ headUnder: true, airSeconds: 4, healthFell: true }), true)
  assert.equal(airDanger({ headUnder: false, airSeconds: 0, healthFell: true }), false, 'head out: breathing')
  assert.equal(airDanger({ headUnder: true, airSeconds: 6, healthFell: true }), false, 'air left')
  assert.equal(airDanger({ headUnder: true, airSeconds: 0, healthFell: false }), false,
               'the CHRONIC case: a seagrass-head bot at 20/20 is never in danger')
})
await t('healthFellWithin: a 2-HP step 2.5 s ago still counts; one older than 3 s does not; regeneration after a fall still counts', () => {
  const now = 10_000
  assert.equal(healthFellWithin([{ t: now - 2500, h: 18 }, { t: now - 2000, h: 16 }, { t: now, h: 16 }], now), true)
  assert.equal(healthFellWithin([{ t: now - 3500, h: 18 }, { t: now - 2000, h: 16 }, { t: now, h: 16 }], now), false)
  assert.equal(healthFellWithin([{ t: now - 2000, h: 18 }, { t: now - 1000, h: 16 }, { t: now, h: 16.3 }], now), true)
  assert.equal(healthFellWithin([{ t: now - 1000, h: 20 }, { t: now, h: 20 }], now), false)
})
await t('admission: danger or a pocket rung refuses; stale state reads not-danger; the CAP admits after 2 declines', () => {
  assert.equal(airAdmission(DANGER()).refuse, true)
  assert.equal(airAdmission(CALM()).refuse, false)
  assert.equal(airAdmission({ ...DANGER(), at: Date.now() - 5000 }).refuse, false, 'stale danger fails open (the cap is the guarantee)')
  assert.equal(airAdmission({ ...CALM(), pocketing: true, at: 0 }).refuse, true, 'a pocket rung is held by its flag, not freshness')
  const capped = airAdmission(DANGER(), Date.now(), { declines: AIR_DECLINE_CAP })
  assert.equal(capped.refuse, false); assert.equal(capped.fields.air_capped, 1); assert.equal(capped.fields.air_danger, 1)
  assert.equal(airAdmission(DANGER(), Date.now(), { declines: AIR_DECLINE_CAP - 1 }).refuse, true)
})
await t('the per-kind counter: +1 on air_rescue, 0 on a start, unchanged by other holds', () => {
  assert.equal(airDeclineNext(0, { failClass: 'air_rescue' }), 1)
  assert.equal(airDeclineNext(1, { failClass: 'air_rescue' }), 2)
  assert.equal(airDeclineNext(2, { started: true }), 0)
  assert.equal(airDeclineNext(1, { failClass: 'reserve_expired' }), 1)
  assert.equal(airDeclineNext(1, { failClass: 'body_held' }), 1)
})
await t('C3b decision: only a watchdog-owned run, only on danger', () => {
  assert.equal(airYieldsRun({ danger: true, owner: 'watchdog' }), true)
  assert.equal(airYieldsRun({ danger: true, owner: null }), false, 'brain runs are not touched (F5)')
  assert.equal(airYieldsRun({ danger: false, owner: 'watchdog' }), false)
})
await t('air_rescue is a RUNNER_DECLINED class (no outcome handler treats it as a failure)', () => {
  assert.ok(RUNNER_DECLINED.has('air_rescue')); assert.equal(runnerDeclined({ failClass: 'air_rescue' }), true)
})
await t('the ladder: an air_rescue decline HOLDS and leaves the reserve_expired streak untouched', () => {
  assert.deepEqual(rescueLevelStep({ started: false, failClass: 'air_rescue', level: 1, streak: 1, sinceLastMs: 10, ttlMs: 1000 }),
                   { streak: 1, hold: true, jump: false })
  // reserve_expired -> air_rescue -> reserve_expired reaches the reserve cap
  let st = rescueLevelStep({ started: false, failClass: 'reserve_expired', level: 1, streak: 0 }).streak
  st = rescueLevelStep({ started: false, failClass: 'air_rescue', level: 1, streak: st, sinceLastMs: 10, ttlMs: 1000 }).streak
  const last = rescueLevelStep({ started: false, failClass: 'reserve_expired', level: 1, streak: st, sinceLastMs: 10, ttlMs: 1000 })
  assert.deepEqual(last, { streak: 2, hold: false, jump: true })
})
await t('MUTANT KILLED: without the air_rescue clause the decline resets the reserve_expired streak', async () => {
  await withMutant(WATCHDOG_PATH, "  if (failClass === 'air_rescue') return { streak, hold: true, jump: false }\n", '', async m => {
    assert.equal(m.rescueLevelStep({ started: false, failClass: 'air_rescue', level: 1, streak: 1, sinceLastMs: 10, ttlMs: 1000 }).streak, 0)
  })
})

// =====================================================================================================================
console.log('-- C3a through the real Runner: the admission at the instant of the start --')
await t('THE RACE (Codex r1 P1-1): dry at the request, danger begins during the unwind -> declined:air_rescue, nothing starts', async () => {
  const ran = []; quickSkill('__c3rescue', ran); stuckSkill('__c3brain', { unwindMs: 150 })
  const bot = fakeBot(); bot.airRescue = CALM()
  const r = new Runner(bot)
  const recs = await rows(/^_watchdog_rescue$/, async () => {
    const brain = r.run('__c3brain', {}, { trigger: 'llm:idle' })
    await sleep(20)
    r.reserve('watchdog', 2000, 'stagnation')
    setTimeout(() => { bot.airRescue = DANGER() }, 60)         // the drowning begins while the brain's skill unwinds
    const res = await r.run('__c3rescue', {}, { owner: 'watchdog', trigger: 'watchdog_relocate', rescue: { attempt: 'a1', level: 1, remedy: 'relocate' },
                                               admit: () => airAdmission(bot.airRescue) })
    await brain
    assert.equal(res.failClass, 'air_rescue', `${res.status}/${res.failClass}`)
  })
  assert.equal(ran.length, 0, 'the rescue never ran')
  assert.equal(r.activeReservation(), null, 'the reservation was released')
  assert.equal(r.isBusy(), false)
  const d = recs.find(x => x.skill.args.phase === 'declined:air_rescue')
  assert.ok(d, 'the decline is an attempt row'); assert.equal(d.skill.args.air_danger, 1)
})
await t('a capped admission STARTS and its started row says air_capped=1 (read G5a exempts it, G5g validates it)', async () => {
  const ran = []; quickSkill('__c3capped', ran)
  const bot = fakeBot(); bot.airRescue = DANGER()
  const r = new Runner(bot)
  const recs = await rows(/^_watchdog_rescue$/, async () => {
    const res = await r.run('__c3capped', {}, { owner: 'watchdog', trigger: 'watchdog_home', rescue: { attempt: 'a2', level: 2, remedy: 'home' },
                                               admit: () => airAdmission(bot.airRescue, Date.now(), { declines: 2 }) })
    assert.ok(!RUNNER_DECLINED.has(res.failClass), `${res.status}/${res.failClass}`)
    assert.equal(ran.length, 1, 'the capped rescue ran')
  })
  const s = recs.find(x => x.skill.args.phase === 'started')
  assert.equal(s.skill.args.air_capped, 1); assert.equal(s.skill.args.air_danger, 1)
})
await t('MUTANT KILLED: without the admission block the race starts the rescue into the drowning', async () => {
  await withMutant(RUNNER_PATH, "      if (admission?.refuse) {", '      if (false) {', async m => {
    const ran = []; quickSkill('__c3m', ran)
    const bot = fakeBot(); bot.airRescue = DANGER()
    const r = new m.Runner(bot)
    const res = await r.run('__c3m', {}, { owner: 'watchdog', trigger: 'watchdog_relocate', admit: () => airAdmission(bot.airRescue) })
    assert.notEqual(res.failClass, 'air_rescue'); assert.equal(ran.length, 1)
  })
})

// =====================================================================================================================
console.log('-- C3 at the watchdog: the per-kind cap and the stranding refund --')
const savedWatch = { ...config.watchdog }
const savedTimeout = config.skills.defaultTimeoutMs
config.watchdog.windowMs = 1200
config.watchdog.sampleMs = 100
config.skills.defaultTimeoutMs = 3000
async function until (cond, ms, what) {
  const t0 = Date.now()
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(20) }
}
await t('the CAP: a bot in persistent danger is declined twice, then the 3rd stagnation rescue STARTS (air_capped=1)', async () => {
  const savedGoto = SKILLS.goto
  const gotos = []
  SKILLS.goto = { run: async (_c, args) => { gotos.push(args); await sleep(30); return { status: 'failed', failClass: 'no_path', detail: 'x' } } }
  stuckSkill('__c3stuck', { unwindMs: 10 })
  const bot = fakeBot(); bot.airRescue = DANGER()
  const keep = setInterval(() => { bot.airRescue = DANGER() }, 100)      // a danger that never ends (a hung rung, a recurring source)
  const runner = new Runner(bot)
  const wd = new StagnationWatchdog(bot, runner, { running: true, milestones: { allDone: false } })
  wd.reserveMs = 250; runner.watchdog = wd
  const timer = setInterval(() => { wd.check().catch(() => {}) }, 100)
  try {
    const recs = await rows(/^_watchdog_rescue$/, async () => {
      // keep the brain stuck and busy so the watchdog keeps judging; the hold backs off a window each time, so shorten it
      const tEnd = Date.now() + 20000
      const brainLoop = (async () => { while (!gotos.length && Date.now() < tEnd) { await runner.run('__c3stuck', {}, { trigger: 'llm:idle' }).catch(() => {}); await sleep(20) } })()
      const t0 = Date.now()
      while (!gotos.length && Date.now() - t0 < 20000) { wd.backoffUntil = 0; await sleep(50) }
      await brainLoop
    })
    const declines = recs.filter(x => x.skill.args.phase === 'declined:air_rescue').length
    const started = recs.find(x => x.skill.args.phase === 'started')
    assert.equal(declines, 2, `declines ${declines}: ${recs.map(x => x.skill.args.phase).join(',')}`)
    assert.ok(started, 'the third rescue started'); assert.equal(started.skill.args.air_capped, 1)
    assert.ok(gotos.length >= 1, 'and it is the relocation (L1 held twice, then run)')
    await until(() => !wd.pending, 6000, 'the started rescue to end')
    assert.equal(wd.airDeclines.stagnation, 0, 'a start resets the kind\'s count')
  } finally { clearInterval(timer); clearInterval(keep); SKILLS.goto = savedGoto; await until(() => !wd.pending, 6000, 'pending').catch(() => {}) }
})
await t('MUTANT KILLED: without the cap the rescue is declined forever (the dead end Codex r4 named)', async () => {
  await withMutant(AIRSTATE_PATH, '  const capped = (danger || pocketing) && declines >= cap', '  const capped = false', async m => {
    for (let d = 0; d < 10; d++) assert.equal(m.airAdmission(DANGER(), Date.now(), { declines: d }).refuse, true)
  })
})
await t('the stranding refund (strandRefund, behaviour): unstarted always; interrupted:drowning at most AIR_REFUND_CAP times; nothing else', () => {
  assert.equal(AIR_REFUND_CAP, 2)
  assert.deepEqual(strandRefund({ out: { started: false, r: { failClass: 'air_rescue' } }, refunds: 5 }), { refund: true, refunds: 5 })
  let n = 0, refunded = 0
  for (let i = 0; i < 4; i++) { const r = strandRefund({ out: { started: true, r: { interruptedBy: 'drowning' } }, refunds: n }); n = r.refunds; refunded += r.refund }
  assert.equal(refunded, 2, 'two of four drowning-interrupted climb-outs refunded'); assert.equal(n, 2)
  assert.deepEqual(strandRefund({ out: { started: true, r: { interruptedBy: 'stagnation' } }, refunds: 0 }), { refund: false, refunds: 0 })
  assert.deepEqual(strandRefund({ out: null, refunds: 1 }), { refund: false, refunds: 1 })
})
await t('MUTANT KILLED: an uncapped drowning refund keeps refunding (stranded_unrecoverable never reached)', async () => {
  await withMutant(WATCHDOG_PATH, "  if (out.r?.interruptedBy === 'drowning' && refunds < cap) return { refund: true, refunds: refunds + 1 }",
    "  if (out.r?.interruptedBy === 'drowning') return { refund: true, refunds: refunds + 1 }", async m => {
      assert.equal(m.strandRefund({ out: { started: true, r: { interruptedBy: 'drowning' } }, refunds: 2 }).refund, true)
    })
})
await t('WIRED (structural, comments stripped): judgeStranding asks strandRefund and the episode reset clears the refunds', () => {
  const src = fs.readFileSync(WATCHDOG_PATH, 'utf8').replace(/\/\/[^\n]*/g, '')
  assert.ok(/const rf = strandRefund\(\{ out, refunds: this\.airRefunds \}\)\s*\n\s*if \(rf\.refund\) this\.surfaceAttempts--\s*\n\s*this\.airRefunds = rf\.refunds/.test(src))
  assert.ok(/this\.surfaceAttempts = 0\s*\n\s*this\.airRefunds = 0/.test(src))
})

config.watchdog.windowMs = savedWatch.windowMs; config.watchdog.sampleMs = savedWatch.sampleMs
config.skills.defaultTimeoutMs = savedTimeout
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
