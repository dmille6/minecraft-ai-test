// homefix-01 r2 (the code reviews of r1: Codex CHANGE, Claude CHANGE): each finding as behaviour, through the REAL Runner /
// StagnationWatchdog / CognitiveLoop / skills, each with a mutant seen to fail (helpers/mutant.mjs: anchors present AND
// unique).
//
//   Codex P1   the owner's start re-checked after the arbiter await: a NEWER reservation wins; a merely EXPIRED one still
//              starts (nothing else could have started) and nothing overlaps it
//   Claude P2-2 the owner losing the body to the in-flight run it is about to turn away: one retry after a macrotask
//   Codex P2   the four issue-time cooldowns (prune, smelt_town, furnace_drain, plinth) refunded on a decline
//   Codex P2   home's deadline reaches goto's recovery rungs (dig retry, descent, ride-down): none STARTS after it
//   Claude P3-3 home: `wrong_elevation` below sea level climbs (the remedy the new |dy| failure names); a climb that lands
//              home is an arrival
//   Claude P3-4 the reserve_expired streak counts only recent declines
//   Claude P3-5 mutants for the window reset at rescue start and the busy-is-not-idle change; pending clears after a hard
//              stop
//   Claude P3-1 H3 keeps the thrown message in the detail
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'homefix-r2-'))
process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'homefix-r2-state-'))
process.env.BOT_NAME = 'HomefixR2Bot'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_SCOPE = 'isolated'
process.env.LOG_LEVEL ??= 'error'

const { withMutant } = await import('./helpers/mutant.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const { Runner } = await import('../src/runner.mjs')
const { StagnationWatchdog, rescueLevelStep } = await import('../src/watchdog.mjs')
const { CognitiveLoop, refundDeclined } = await import('../src/cognitive.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { config } = await import('../src/config.mjs')
const { PRIORITY } = await import('../src/arbiter.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { RUNNER_DECLINED } = await import('../src/declined.mjs')

const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const RUNNER_PATH = new URL('../src/runner.mjs', import.meta.url)
const WATCHDOG_PATH = new URL('../src/watchdog.mjs', import.meta.url)
const COG_PATH = new URL('../src/cognitive.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c),
                          distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z),
                          clone: () => V(x, y, z), floored: () => V(Math.floor(x), Math.floor(y), Math.floor(z)) })
function fakeBot ({ at = V(0, 70, 0), pf = {}, extra = {} } = {}) {
  return {
    entity: { position: at, onGround: true, velocity: V(0, 0, 0), isInWater: false },
    health: 20, food: 20, version: '1.21.8', username: 'HomefixR2Bot',
    registry: { blocksByName: {}, itemsByName: {}, blocks: {} },
    inventory: { items: () => [] },
    blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
    findBlock: () => null, findBlocks: () => [], entities: {}, players: {},
    time: { day: 1, age: 1 }, game: { dimension: 'overworld' },
    assertNav: () => {}, chat: () => {}, clearControlStates: () => {}, setControlState: () => {},
    quits: 0, quit () { this.quits++ },
    pathfinder: { movements: {}, setMovements () {}, stop () {}, setGoal () {}, goto: async () => {},
                  getPathTo: () => ({ status: 'success', path: [1] }), ...pf },
    ...extra,
  }
}
const moveTo = (bot, x, y, z) => { bot.entity.position = V(x, y, z) }
const quickSkill = (name, calls, ms = 30) => { SKILLS[name] = { run: async (_c, args) => { calls.push(args); await sleep(ms); return { status: 'success', detail: 'ok' } } } }
async function withArbiter (fn) { const was = config.reflex.arbiter; config.reflex.arbiter = true; try { return await fn() } finally { config.reflex.arbiter = was } }

// =====================================================================================================================
console.log('-- the owner\'s start after the arbiter await --')

/** The rescue waits at arb.acquire (preempting a 300 ms idle holder) while a NEWER same-owner reservation lands. */
async function newerReservation (RunnerClass) {
  return withArbiter(async () => {
    const ran = []; quickSkill('__ownerOld', ran)
    const r = new RunnerClass(fakeBot())
    await r.arb.acquire({ owner: 'idle-thing', priority: PRIORITY.idle, onCancel: () => sleep(300) })
    r.reserve('watchdog', 2000, 'stagnation')
    const p = r.run('__ownerOld', { who: 'old' }, { trigger: 'watchdog_home', owner: 'watchdog' })
    await sleep(50)
    r.reserve('watchdog', 2000, 'stranded')          // a newer reservation (the stranding ladder shares the owner)
    const res = await p
    return { res, ran, r }
  })
}

await t('NEWER RESERVATION: the stale rescue gives the body back and is declined runner_reserved; the newer one stands', async () => {
  const { res, ran, r } = await newerReservation(Runner)
  assert.equal(res.failClass, 'runner_reserved', `${res.status}/${res.failClass}: ${res.detail}`)
  assert.equal(ran.length, 0, 'the stale attempt never ran')
  assert.equal(r.arb.holder, null, 'its grant was released')
  assert.ok(r.activeReservation(), 'the newer reservation is still live')
})

await t('NEWER RESERVATION MUTANT KILLED: without the generation re-check the stale rescue starts', async () => {
  await withMutant(RUNNER_PATH, '      if (myGen != null && landed && landed.gen !== myGen) {', '      if (false) {', async mod => {
    const { res, ran } = await newerReservation(mod.Runner)
    assert.ok(!RUNNER_DECLINED.has(res.failClass), `the mutant lets it through: ${res.failClass}`)
    assert.deepEqual(ran.map(a => a.who), ['old'])
  })
})

await t('EXPIRED DURING THE WAIT: the rescue still starts (nothing else could), and a run arriving after the expiry overlaps nothing', async () => {
  await withArbiter(async () => {
    const ran = []; quickSkill('__ownerLate', ran, 100); quickSkill('__brainLate', ran)
    const r = new Runner(fakeBot())
    await r.arb.acquire({ owner: 'idle-thing', priority: PRIORITY.idle, onCancel: () => sleep(300) })
    r.reserve('watchdog', 100, 'stagnation')
    const p = r.run('__ownerLate', { who: 'owner' }, { trigger: 'watchdog_home', owner: 'watchdog' })
    await sleep(200)
    assert.equal(r.activeReservation(), null, 'precondition: the reservation has expired while the owner waits for the body')
    const other = await r.run('__brainLate', { who: 'brain' }, { trigger: 'llm:idle' })
    const res = await p
    assert.ok(!RUNNER_DECLINED.has(res.failClass), `the owner started: ${res.status}/${res.failClass}: ${res.detail}`)
    assert.ok(RUNNER_DECLINED.has(other.failClass), `the late run was turned away, not overlapped: ${other.failClass}`)
    assert.deepEqual(ran.map(a => a.who), ['owner'])
  })
})

/** Claude r1 P2-2: the brain's run waits at acquire behind a preemption; the reservation and the owner's run land with no
 *  await between them, so both wait on the SAME preemption and the brain is granted first. */
async function sharedPreemption (RunnerClass) {
  return withArbiter(async () => {
    const ran = []; quickSkill('__brainP', ran); quickSkill('__ownerP', ran)
    const r = new RunnerClass(fakeBot())
    await r.arb.acquire({ owner: 'idle-thing', priority: PRIORITY.idle, onCancel: () => sleep(300) })
    const brain = r.run('__brainP', { who: 'brain' }, { trigger: 'llm:idle' })
    await sleep(50)
    r.reserve('watchdog', 2000, 'stagnation')
    const owner = r.run('__ownerP', { who: 'watchdog' }, { trigger: 'watchdog_home', owner: 'watchdog' })   // straight after reserve()
    return { brain: await brain, owner: await owner, ran }
  })
}

await t('SHARED PREEMPTION: the in-flight brain run is turned away and the rescue STARTS (it was body_held, a lost window)', async () => {
  const { brain, owner, ran } = await sharedPreemption(Runner)
  assert.equal(brain.failClass, 'runner_reserved', `${brain.failClass}`)
  assert.ok(!RUNNER_DECLINED.has(owner.failClass), `the rescue started: ${owner.status}/${owner.failClass}: ${owner.detail}`)
  assert.deepEqual(ran.map(a => a.who), ['watchdog'])
})

await t('SHARED PREEMPTION MUTANT KILLED: without the one retry the rescue is refused body_held', async () => {
  await withMutant(RUNNER_PATH, '      if (!grant && myGen != null && !this.current && (by == null || by.priority === PRIORITY.work)) {', '      if (false) {', async mod => {
    const { owner, ran } = await sharedPreemption(mod.Runner)
    assert.equal(owner.failClass, 'body_held', `the mutant reproduces the probe: ${owner.failClass}`)
    assert.equal(ran.length, 0)
  })
})

await t('H3 keeps the thrown message: a raw re-throw after the abort is `interrupted` and its detail still names the throw', async () => {
  SKILLS.__rawR2 = { run: (_c, _a, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => setTimeout(() => {
    const e = new Error('The goal was changed before it could be completed!'); e.name = 'GoalChanged'; rej(e) }, 10), { once: true })) }
  const r = new Runner(fakeBot())
  const p = r.run('__rawR2', {}, { trigger: 'test' })
  await sleep(20); r.interrupt('entombed')
  const res = await p
  assert.equal(res.failClass, 'interrupted')
  assert.match(res.detail, /^entombed \(threw GoalChanged: The goal was changed/)
})

// =====================================================================================================================
console.log('-- the issue-time refunds --')

const loopBot = () => ({
  entity: { position: { x: 0, y: 70, z: 0, distanceTo: () => 0, offset: () => ({}), clone () { return this } }, velocity: { x: 0, y: 0, z: 0 } },
  health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
  inventory: { items: () => [] },
  registry: { blocksByName: { oak_log: { id: 17 } }, itemsByName: {}, blocks: {}, items: {}, biomesArray: [], biomes: {} },
  recipesFor: () => [], recipesAll: () => [], findBlock: () => null, findBlocks: () => [],
  blockAt: () => ({ name: 'air', boundingBox: 'empty' }), setControlState: () => {}, clearControlStates: () => {},
  players: {}, entities: {}, experience: { level: 0 },
})
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(process.env.STATE_DIR, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
const CHARGE = { prune_town: ['pruneState', 'lastIssuedAt'], smelt_town: ['smeltJobState', 'lastIssuedAt'],
                 furnace_drain: ['drainState', 'lastIssuedAt'], build_plinth: ['plinthState', 'lastAt'] }

/** One real decision with the order's cooldown ALREADY CHARGED at issue (as the order functions do), answered `result`. */
async function chargedDecision (Loop, skill, result) {
  const [field, key] = CHARGE[skill]
  const runner = { isBusy: () => false, run: async () => ({ detail: 'probe', ...result }) }
  const loop = new Loop(loopBot(), runner, freshLessons(), null)
  const issued = Date.now()
  loop[field] = { [key]: issued }
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill, args: {}, reason: 'probe' } }) }
  loop.start(); await sleep(150); loop.stop()
  return { at: loop[field]?.[key], issued }
}

for (const skill of Object.keys(CHARGE)) {
  await t(`REFUND ${skill}: a declined run gives the issue-time cooldown back; control (skill_error) keeps it charged`, async () => {
    const d = await chargedDecision(CognitiveLoop, skill, { status: 'failed', failClass: 'runner_reserved' })
    assert.equal(d.at, -Infinity, `the ${skill} cooldown was left charged by a run that never started`)
    const c = await chargedDecision(CognitiveLoop, skill, { status: 'failed', failClass: 'skill_error' })
    assert.equal(c.at, c.issued, 'control: a real failure keeps the charge')
  })
}

await t('REFUND MUTANT KILLED: without the refund line the declined prune order stays on cooldown', async () => {
  await withMutant(COG_PATH, '        Object.assign(this, refundDeclined(admitted.skill, this))\n', '', async mod => {
    const d = await chargedDecision(mod.CognitiveLoop, 'prune_town', { status: 'failed', failClass: 'runner_reserved' })
    assert.equal(d.at, d.issued, 'the mutant keeps the charge')
  })
})

await t('refundDeclined is pure and scoped: only the four issue-time orders, only an existing state', async () => {
  assert.deepEqual(refundDeclined('build_plinth', { plinthState: { lastAt: 5, backoffUntil: 9 } }), { plinthState: { lastAt: -Infinity, backoffUntil: 9 } })
  assert.deepEqual(refundDeclined('gather', { pruneState: { lastIssuedAt: 5 } }), {})
  assert.deepEqual(refundDeclined('prune_town', {}), {})
})

// =====================================================================================================================
console.log('-- home\'s deadline through goto\'s recovery rungs --')

/** goto on a virtual clock whose one leg spends the caller's budget and goes nowhere (an empty path): which rungs start? */
async function spentLeg (mod) {
  const realNow = Date.now
  let offset = 0
  Date.now = () => realNow() + offset
  try {
    const rungs = []
    const untap = tapRecords(r => { if (/^_(goto_dig_retry|goto_float_dig|descent_escape|ride_floor_down)$/.test(r?.skill?.name ?? '')) rungs.push(r.skill.name) })
    const bot = fakeBot({ at: V(100, 120, 0) })
    bot.pathfinder.goto = async () => { offset += 1000 }            // the leg resolves with no movement, 1 s later
    bot.withAscentMovements = async f => { rungs.push('dig_retry'); return f() }
    bot.ascentMovements = {}
    bot.withDescentMovements = async f => { rungs.push('descent'); return f() }
    let r
    try { r = await mod.SKILLS.goto.run({ bot }, { x: 0, y: 70, z: 0, range: 2 }, new AbortController().signal, { until: Date.now() + 500 }) }
    finally { untap() }
    return { r, rungs }
  } finally { Date.now = realNow }
}

await t('H4 RUNGS: after the caller\'s budget is spent no recovery rung starts (dig retry, descent)', async () => {
  const { r, rungs } = await spentLeg({ SKILLS })
  assert.deepEqual(rungs, [], `rungs started after the deadline: ${rungs}`)
  assert.ok(r.status !== 'success', r.detail)
})

await t('H4 RUNGS MUTANT KILLED: without the budget check the dig retry starts past the deadline', async () => {
  await withMutant(SKILLS_PATH, '        if (!diggingRetry && bot.withAscentMovements && !spent()) {', '        if (!diggingRetry && bot.withAscentMovements) {', async mod => {
    const { rungs } = await spentLeg(mod)
    assert.ok(rungs.includes('_goto_dig_retry'), `the mutant enters the dig retry (and writes its row): ${rungs}`)
  })
})

/** home from deep under its own column: goto answers wrong_elevation; does home climb? */
async function deepUnder (mod) {
  const bot = fakeBot({ at: V(1.5, 40, 0.5) })
  bot.withAscentMovements = async f => f(); bot.ascentMovements = {}
  let climbs = 0
  bot.pathfinder.goto = async goal => {
    if (goal?.constructor?.name === 'GoalY') { climbs++; moveTo(bot, 1.5, 66, 0.5) }   // surface's stage: up and out
  }
  const r = await mod.SKILLS.home.run({ bot }, {}, new AbortController().signal)
  return { r, climbs }
}

await t('H1 COMPOSED: home deep under its own column (wrong_elevation, below sea level) climbs, and the landing is an arrival', async () => {
  const { r, climbs } = await deepUnder({ SKILLS })
  assert.ok(climbs >= 1, 'surface ran')
  assert.equal(r.status, 'success', `${r.status}/${r.failClass}: ${r.detail}`)
})

await t('H1 COMPOSED MUTANT KILLED: without wrong_elevation in the climb trigger home ends wrong_elevation with no climb', async () => {
  await withMutant(SKILLS_PATH, " || last?.failClass === 'wrong_elevation'\n", '\n', async mod => {
    const { r, climbs } = await deepUnder(mod)
    assert.equal(climbs, 0)
    assert.equal(r.failClass, 'wrong_elevation', `${r.status}/${r.failClass}`)
  })
})

// =====================================================================================================================
console.log('-- the watchdog --')

await t('rescueLevelStep: an OLD reserve_expired does not count toward the cap', async () => {
  assert.deepEqual(rescueLevelStep({ failClass: 'reserve_expired', level: 1, streak: 1, sinceLastMs: 1000, ttlMs: 590_000 }), { streak: 2, hold: false, jump: true })
  assert.deepEqual(rescueLevelStep({ failClass: 'reserve_expired', level: 1, streak: 1, sinceLastMs: 3_600_000, ttlMs: 590_000 }), { streak: 1, hold: true, jump: false })
})

// test-scale clocks (restored at the end)
const savedWatch = { ...config.watchdog }
const savedTimeout = config.skills.defaultTimeoutMs
config.watchdog.windowMs = 1200
config.watchdog.sampleMs = 100
config.skills.defaultTimeoutMs = 3000
const TICK = 100
async function until (cond, ms, what) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(20) } }
function rig (WatchdogClass, bot = fakeBot()) {
  const runner = new Runner(bot)
  const wd = new WatchdogClass(bot, runner, { running: true, milestones: { allDone: false } })
  wd.reserveMs = 250; runner.watchdog = wd
  const timer = setInterval(() => { wd.check().catch(() => {}) }, TICK)
  return { bot, runner, wd, stop: () => clearInterval(timer) }
}
function stuckSkill (name, unwindMs) {
  SKILLS[name] = { run: (_c, _a, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => {
    if (unwindMs === Infinity) return
    setTimeout(() => { const e = new Error('aborted'); e.aborted = true; rej(e) }, unwindMs) }, { once: true })) }
}

/** A never-unwinding skill: does the watchdog reach the level-3 reconnect, and is pending clear after the hard stop? */
async function neverUnwinds (WatchdogClass) {
  const savedGoto = SKILLS.goto
  SKILLS.goto = { run: async () => ({ status: 'success', detail: 'x' }) }
  stuckSkill('__neverR2', Infinity)
  const { bot, runner, wd, stop } = rig(WatchdogClass)
  try {
    const p = runner.run('__neverR2', {}, { trigger: 'llm:idle' })
    await until(() => bot.quits > 0, 3 * config.watchdog.windowMs + 1500, 'a reconnect').catch(() => {})
    await p
    stop()
    await until(() => !wd.pending, 6000, 'pending').catch(() => {})
    return { bot, wd }
  } finally { stop(); SKILLS.goto = savedGoto }
}

await t('BUSY IS NOT IDLE: a skill holding the runner past its timeout still earns the second verdict -> reconnect; pending clears after the hard stop', async () => {
  const { bot, wd } = await neverUnwinds(StagnationWatchdog)
  assert.equal(bot.quits, 1)
  assert.equal(wd.pending, null, 'pending is clear once the hard stop released the runner')
})

await t('BUSY IS NOT IDLE MUTANT KILLED: judging lastActionAt alone never reaches the second verdict', async () => {
  await withMutant(WATCHDOG_PATH, '    if (idleFor > config.watchdog.windowMs && !this.runner?.isBusy?.()) return', '    if (idleFor > config.watchdog.windowMs) return', async mod => {
    const { bot } = await neverUnwinds(mod.StagnationWatchdog)
    assert.equal(bot.quits, 0, 'the mutant goes quiet after the first decline')
  })
})

/** A SHORT rescue (400 ms, inside the 1.2 s window) creeping under the threshold, then the bot stays put: on what window is
 *  the next verdict? (A rescue longer than the window ages the old samples out by itself and could not see the reset.) */
async function nextVerdictWindow (WatchdogClass, ms = 400) {
  const savedGoto = SKILLS.goto
  let rescue = null
  SKILLS.goto = { run: async (ctx, _a, signal) => {
    const t0 = Date.now(); rescue = { t0 }
    while (Date.now() - t0 < ms && !signal.aborted) { const p = ctx.bot.entity.position; moveTo(ctx.bot, p.x + 0.03, p.y, p.z); await sleep(10) }
    rescue.end = Date.now()
    return { status: 'failed', failClass: 'no_path', detail: 'boxed in' }
  } }
  stuckSkill('__stuckR2a', 30)
  const { wd, runner, stop } = rig(WatchdogClass)
  const rows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_stagnation') rows.push(r) })
  try {
    const brain = runner.run('__stuckR2a', {}, { trigger: 'llm:idle' })
    await until(() => rescue?.end, 5000, 'the rescue to end')
    await brain
    stuckSkill('__stuckR2b', 30)
    const again = runner.run('__stuckR2b', {}, { trigger: 'llm:idle' })
    await until(() => rows.length >= 2, 3000, 'a second verdict').catch(() => {})
    runner.cancel('test'); await again
    stop(); await until(() => !wd.pending, 6000, 'pending').catch(() => {})
    return { rows, rescue }
  } finally { stop(); untap(); SKILLS.goto = savedGoto }
}

await t('WINDOW RESET AT START: the verdict after a rescue judges only samples from the rescue\'s start on', async () => {
  const { rows, rescue } = await nextVerdictWindow(StagnationWatchdog)
  assert.ok(rows.length >= 2, `two verdicts: ${rows.length}`)
  assert.ok(Date.parse(rows[1].skill.args.window_from) >= rescue.t0 - 5, `window_from ${rows[1].skill.args.window_from} vs start ${new Date(rescue.t0).toISOString()}`)
})

await t('WINDOW RESET AT START MUTANT KILLED: without the reset in onStart the next verdict reaches back before the rescue', async () => {
  await withMutant(WATCHDOG_PATH, 'onStart: () => { pd.startedAt = Date.now(); this.reserveExpiredStreak = 0; this.#resetWindow() },',
    'onStart: () => { pd.startedAt = Date.now(); this.reserveExpiredStreak = 0 },', async mod => {
      const { rows, rescue } = await nextVerdictWindow(mod.StagnationWatchdog)
      assert.ok(rows.length >= 2 && Date.parse(rows[1].skill.args.window_from) < rescue.t0, `the mutant judges old samples: ${rows[1]?.skill?.args?.window_from}`)
    })
})

config.watchdog.windowMs = savedWatch.windowMs
config.watchdog.sampleMs = savedWatch.sampleMs
config.skills.defaultTimeoutMs = savedTimeout
for (const k of Object.keys(SKILLS)) if (k.startsWith('__')) delete SKILLS[k]
console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
