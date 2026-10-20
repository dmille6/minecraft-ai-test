// homefix-01 (docs/reports/expansion-plan-2026-10-19.md §2 and §5): the `home` diagnosis, as behaviour.
//
//   H1  an arrival graded as a failure: GoalNear ends on an integer node 2 out; home counted arrival only at <= 2.
//   H2  the watchdog's rescue never started (runner_busy while the cancelled skill unwound) or was cut at 15 s (check()
//       re-entered mid-rescue and judged the OLD window). The contract: pending from the verdict, cancel-and-reserve,
//       `current` always cleared, the level held on a rescue that did not start (capped), the window reset at the
//       rescue's start, attempt rows.
//   H3  a raw re-throw after the runner's own abort was filed skill_error.
//   H4  home's budget under the skill timeout, passed into nested goto / surface as `until`.
//
// Everything here runs through the REAL Runner and the REAL StagnationWatchdog (watchdog-busy.test.mjs fakes
// `run: async () => {}`, which can never be busy -- that is why H2a was invisible). Each mechanism has a mutant seen to
// fail (helpers/mutant.mjs: anchors present and unique).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'homefix-'))
process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'homefix-state-'))
process.env.BOT_NAME = 'HomefixBot'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL ??= 'error'

const { withMutant } = await import('./helpers/mutant.mjs')
const { SKILLS, arrivedAt, HOME_BUDGET_MS } = await import('../src/skills.mjs')
const { Runner } = await import('../src/runner.mjs')
const { StagnationWatchdog, rescueLevelStep, RESCUE_RESERVE_MS, RESERVE_EXPIRED_CAP } = await import('../src/watchdog.mjs')
const { config } = await import('../src/config.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { PRIORITY } = await import('../src/arbiter.mjs')
const { RUNNER_DECLINED } = await import('../src/declined.mjs')

const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const RUNNER_PATH = new URL('../src/runner.mjs', import.meta.url)
const WATCHDOG_PATH = new URL('../src/watchdog.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c),
                          distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z),
                          clone: () => V(x, y, z), floored: () => V(Math.floor(x), Math.floor(y), Math.floor(z)) })

/** A bot the runner, the watchdog and the travel skills can all drive. `pf` overrides pathfinder members. */
function fakeBot ({ at = V(0, 70, 0), pf = {}, extra = {} } = {}) {
  const bot = {
    entity: { position: at, onGround: true, velocity: V(0, 0, 0), isInWater: false },
    health: 20, food: 20, version: '1.21.8', username: 'HomefixBot',
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
  return bot
}
const moveTo = (bot, x, y, z) => { bot.entity.position = V(x, y, z) }

/** Every `_watchdog_rescue` / `_stagnation` record written while fn runs. */
async function recording (fn) {
  const rows = []
  const untap = tapRecords(r => { if (/^_(watchdog_rescue|stagnation|stagnation_reconnect)$/.test(r?.skill?.name ?? '')) rows.push(r) })
  try { await fn(rows) } finally { untap() }
  return rows
}
const phases = rows => rows.filter(r => r.skill.name === '_watchdog_rescue').map(r => r.skill.args.phase)

// A registered test skill: runs until aborted, then takes `unwindMs` to return (or never, if unwindMs is Infinity).
function stuckSkill (name, { unwindMs = 0, rawThrow = false } = {}) {
  SKILLS[name] = { run: (_ctx, _args, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => {
      if (unwindMs === Infinity) return
      setTimeout(() => {
        if (rawThrow) { const e = new Error('The goal was changed before it could be completed!'); e.name = 'GoalChanged'; reject(e) }
        else { const e = new Error('aborted'); e.aborted = true; reject(e) }
      }, unwindMs)
    }, { once: true })
  }) }
}
const quickSkill = (name, calls, ms = 30) => {
  SKILLS[name] = { run: async (_ctx, args) => { calls.push(args); await sleep(ms); return { status: 'success', detail: 'ok' } } }
}

// =====================================================================================================================
// H1 -- arrivedAt is goto's own final test, and home grades with it
// =====================================================================================================================
console.log('-- H1: arrival --')

await t('H1: a bot stopped on ANY GoalNear(range 2) end node, within the executor\'s 0.35 stop tolerance, is an arrival', async () => {
  const home = { x: 0, y: 70, z: 0 }
  let nodes = 0
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
    if (dx * dx + dy * dy + dz * dz > 4) continue        // GoalNear.isEnd on the integer node (pathfinder 2.4.5 lib/goals.js)
    nodes++
    for (const [jx, jz] of [[0, 0], [0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35], [0.25, 0.25]]) {
      const pos = { x: home.x + dx + 0.5 + jx, y: home.y + dy, z: home.z + dz + 0.5 + jz }   // the bot stands at the node centre
      assert.ok(arrivedAt(pos, home, 2), `node ${dx},${dy},${dz} at ${pos.x},${pos.y},${pos.z} must be an arrival`)
    }
  }
  assert.equal(nodes, 33, 'the enumeration covers every end node')
})

await t('H1 MIRROR (G1b): more than 3 out horizontally, or more than 6 in y, is NOT an arrival (incl. the 2 pre-fix dy -10 successes)', async () => {
  const home = { x: 0, y: 70, z: 0 }
  assert.equal(arrivedAt({ x: 3.01, y: 70, z: 0 }, home, 2), false)
  assert.equal(arrivedAt({ x: 2.2, y: 70, z: 2.2 }, home, 2), false, 'hypot 3.11')
  assert.equal(arrivedAt({ x: 1, y: 60, z: 0 }, home, 2), false, 'dy -10 is not home')
  assert.equal(arrivedAt({ x: 1, y: 76.5, z: 0 }, home, 2), false)
  assert.equal(arrivedAt({ x: 1, y: 76, z: 0 }, home, 2), true, 'dy 6 is inside goto\'s VERT')
  assert.equal(arrivedAt({ x: 2.9, y: 64, z: 0 }, home, 2), true)
})

/** home's travel against a pathfinder that reaches GoalNear's end node 2.5 out and then cannot get any closer. */
function endNodeBot (startX = 40) {
  let calls = 0
  const bot = fakeBot({ at: V(startX, 70, 0.5) })
  bot.pathfinder.goto = async () => { calls++; moveTo(bot, 2.5, 70, 0.5) }   // node (2,70,0): an isEnd node for range 2
  return { bot, calls: () => calls }
}

await t('H1: home that ends on the end node 2.5 from home is a SUCCESS (it was travel_incomplete "3 still to go")', async () => {
  const { bot } = endNodeBot()
  const r = await SKILLS.home.run({ bot }, {}, new AbortController().signal)
  assert.equal(r.status, 'success', `${r.status}/${r.failClass}: ${r.detail}`)
})

await t('H1 MUTANT KILLED: home grading with the old `after <= 2` returns travel_incomplete from the same end node', async () => {
  await withMutant(SKILLS_PATH,
    'if (arrivedAt(bot.entity.position, { x: homeX, y: homeY, z: homeZ }, 2)) {',
    'if (after <= 2) {',
    async mod => {
      const { bot } = endNodeBot()
      const r = await mod.SKILLS.home.run({ bot }, {}, new AbortController().signal)
      assert.equal(r.failClass, 'travel_incomplete', `the mutant reproduces the H1 rows: ${r.status}/${r.failClass}: ${r.detail}`)
      assert.match(r.detail, /3 still to go/)
    })
})

await t('H1: goto\'s own final grading is unchanged (arrival at 2.9, wrong_elevation at dy 9)', async () => {
  const bot = fakeBot({ at: V(10, 70, 0) })
  bot.pathfinder.goto = async () => { moveTo(bot, 2.9, 70, 0) }
  const ok = await SKILLS.goto.run({ bot }, { x: 0, y: 70, z: 0, range: 2 }, new AbortController().signal)
  assert.equal(ok.status, 'success', ok.detail)
  const bot2 = fakeBot({ at: V(10, 79, 0) })
  bot2.pathfinder.goto = async () => { moveTo(bot2, 0.5, 79, 0.5) }
  const hi = await SKILLS.goto.run({ bot: bot2 }, { x: 0, y: 70, z: 0, range: 2 }, new AbortController().signal)
  assert.equal(hi.failClass, 'wrong_elevation', hi.detail)
})

// =====================================================================================================================
// H4 -- the home budget
// =====================================================================================================================
console.log('-- H4: the home budget --')

await t('H4: HOME_BUDGET_MS sits under the production skill timeout (180 s) with room for the runner', async () => {
  assert.equal(HOME_BUDGET_MS, 170_000)
  const src = fs.readFileSync(new URL('../src/config.mjs', import.meta.url), 'utf8')
  const prod = Number(src.match(/defaultTimeoutMs: Number\(req\('SKILL_TIMEOUT_MS', '(\d+)'\)\)/)?.[1])
  assert.equal(prod, 180_000, 'the production default the budget is set under')
  assert.ok(HOME_BUDGET_MS < prod)
})

/** A long walk on a virtual clock: every leg costs 50 s and closes 10 blocks; home starts 4,000 blocks out. */
async function longWalk (mod) {
  const realNow = Date.now
  let offset = 0
  Date.now = () => realNow() + offset
  try {
    let legs = 0
    const bot = fakeBot({ at: V(4000, 70, 0) })
    bot.pathfinder.goto = async () => {
      legs++; offset += 50_000
      const p = bot.entity.position
      moveTo(bot, p.x - 10, 70, 0)
    }
    const t0 = Date.now()
    const r = await mod.SKILLS.home.run({ bot }, {}, new AbortController().signal)
    return { r, legs, virtualMs: Date.now() - t0 }
  } finally { Date.now = realNow }
}

await t('H4: home passes its remaining budget into goto: no leg starts after 170 s, so home ends on its own budget', async () => {
  const { r, legs, virtualMs } = await longWalk({ SKILLS })
  assert.equal(r.failClass, 'travel_incomplete', `${r.status}/${r.failClass}: ${r.detail}`)
  assert.ok(legs <= 4, `legs walked ${legs}: 50 s each, so the 4th leg starts at 150 s and a 5th would start past 170 s`)
  assert.ok(virtualMs <= HOME_BUDGET_MS + 50_000, `home ran ${virtualMs} ms of virtual time`)
})

await t('H4 MUTANT KILLED: without `until`, the one goto walks all its legs, far past the skill timeout', async () => {
  await withMutant(SKILLS_PATH,
    'last = await goto(ctx, { x: homeX, y: homeY, z: homeZ, range: 2 }, signal, { until: deadline })',
    'last = await goto(ctx, { x: homeX, y: homeY, z: homeZ, range: 2 }, signal)',
    async mod => {
      const { legs, virtualMs } = await longWalk(mod)
      assert.ok(legs >= 8, `the mutant should walk goto's whole leg budget, walked ${legs}`)
      assert.ok(virtualMs > 180_000, `and run past the 180 s timeout: ${virtualMs}`)
    })
})

await t('H4: surface honours `until`: a spent budget climbs nothing; MUTANT without it climbs', async () => {
  const mk = () => { const bot = fakeBot({ at: V(0, 40, 0) }); bot.withAscentMovements = async f => f(); bot.ascentMovements = {}; let n = 0; bot.pathfinder.goto = async () => { n++; moveTo(bot, 0, bot.entity.position.y + 5, 0) }; return { bot, n: () => n } }
  const a = mk()
  await SKILLS.surface.run({ bot: a.bot }, {}, new AbortController().signal, { until: Date.now() - 1 })
  assert.equal(a.n(), 0, 'no stage ran past the caller\'s deadline')
  await withMutant(SKILLS_PATH,
    'const DEADLINE = Math.min(CLIMB_T0 + 120_000, until ?? Infinity)',
    'const DEADLINE = CLIMB_T0 + 120_000',
    async mod => {
      const b = mk()
      await mod.SKILLS.surface.run({ bot: b.bot }, {}, new AbortController().signal, { until: Date.now() - 1 })
      assert.ok(b.n() > 0, 'the mutant ignores the deadline and climbs')
    })
})

// =====================================================================================================================
// H3 -- the runner files a throw under its own aborted signal as an interruption
// =====================================================================================================================
console.log('-- H3: classification --')

async function rawRethrowRun (RunnerClass) {
  stuckSkill('__raw', { unwindMs: 10, rawThrow: true })
  const r = new RunnerClass(fakeBot())
  const p = r.run('__raw', {}, { trigger: 'test' })
  await sleep(30)
  r.interrupt('entombed')
  const res = await p
  return { res, r }
}

await t('H3: a skill that re-throws the raw GoalChanged after runner.interrupt() is filed aborted/interrupted', async () => {
  const rows = []
  const untap = tapRecords(rec => { if (rec?.skill?.name === '__raw') rows.push(rec) })
  const { res, r } = await rawRethrowRun(Runner)
  untap()
  assert.equal(res.status, 'aborted', `${res.status}/${res.failClass}`)
  assert.equal(res.failClass, 'interrupted')
  assert.equal(res.interruptedBy, 'entombed')
  assert.equal(r.consecutiveFailures, 0, 'an interruption does not feed the failure pause')
  assert.equal(rows[0]?.trigger, 'interrupt:entombed')
  assert.equal(rows[0]?.skill?.fail_class, 'interrupted')
})

await t('H3 positive control: the same raw throw WITHOUT an abort is still a skill bug (skill_error)', async () => {
  SKILLS.__rawNoAbort = { run: async () => { const e = new Error('The goal was changed before it could be completed!'); e.name = 'GoalChanged'; throw e } }
  const res = await new Runner(fakeBot()).run('__rawNoAbort', {}, { trigger: 'test' })
  assert.equal(res.failClass, 'skill_error')
})

await t('H3 MUTANT KILLED: without the signal check the raw re-throw is filed skill_error again', async () => {
  await withMutant(RUNNER_PATH, 'result = (e?.aborted || controller.signal.aborted)', 'result = (e?.aborted)', async mod => {
    const { res } = await rawRethrowRun(mod.Runner)
    assert.equal(res.failClass, 'skill_error', 'the mutant reproduces the 225 rows')
  })
})

// =====================================================================================================================
// H2 at the runner: cancel-and-reserve, the in-flight start, `current` always cleared
// =====================================================================================================================
console.log('-- H2: the runner --')

await t('H2 RESERVE: a 100 ms unwind -- a livelock rung trying to start in between gets runner_reserved; the owner\'s run starts after the unwind', async () => {
  stuckSkill('__brainSkill', { unwindMs: 100 })
  const ran = []; quickSkill('__rescue', ran)
  const r = new Runner(fakeBot())
  const brain = r.run('__brainSkill', {}, { trigger: 'llm:idle' })
  await sleep(20)
  const rows = await recording(async () => {
    r.reserve('watchdog', 1000, 'stagnation')
    assert.equal(r.isBusy(), true)
    const rung = await r.run('goto', { x: 50, y: 70, z: 0 }, { trigger: 'livelock_escape' })
    assert.equal(rung.failClass, 'runner_reserved', `${rung.failClass}: ${rung.detail}`)
    assert.ok(RUNNER_DECLINED.has(rung.failClass), 'in the one declined set')
    const res = await r.run('__rescue', { n: 1 }, { trigger: 'watchdog_home', owner: 'watchdog', rescue: { attempt: 'a1', level: 2, remedy: 'home' } })
    assert.ok(!RUNNER_DECLINED.has(res.failClass), `${res.status}/${res.failClass}: ${res.detail}`)
  })
  const b = await brain
  assert.equal(b.status, 'aborted')
  assert.deepEqual(ran, [{ n: 1 }], 'the rescue really ran')
  assert.deepEqual(phases(rows), ['started', 'completed:unknown'], 'the runner writes (unknown: a test skill has no contract evidence) started and the terminal phase')
  assert.equal(r.reservation, null, 'the reservation was consumed')
  assert.equal(r.isBusy(), false)
})

await t('H2 RESERVE: before homefix-01 the same handoff was runner_busy (positive control on the old shape: cancel, then run)', async () => {
  stuckSkill('__brainSkill2', { unwindMs: 100 })
  const r = new Runner(fakeBot())
  const brain = r.run('__brainSkill2', {}, { trigger: 'llm:idle' })
  await sleep(20)
  r.cancel('stagnation')
  const res = await r.run('home', {}, { trigger: 'watchdog_home' })   // no reservation, no owner: today's #escalate
  assert.equal(res.failClass, 'runner_busy', 'the H2a mechanism: the rescue never started')
  await brain
})

await t('H2 RESERVE: an unwind longer than the reservation -> the owner gets reserve_expired (not runner_busy), the runner stays usable', async () => {
  stuckSkill('__slowUnwind', { unwindMs: 400 })
  const ran = []; quickSkill('__rescue2', ran)
  const r = new Runner(fakeBot())
  const brain = r.run('__slowUnwind', {}, { trigger: 'llm:idle' })
  await sleep(20)
  const rows = await recording(async () => {
    r.reserve('watchdog', 150, 'stagnation')
    const res = await r.run('__rescue2', {}, { trigger: 'watchdog_home', owner: 'watchdog', rescue: { attempt: 'a2', level: 2, remedy: 'home' } })
    assert.equal(res.failClass, 'reserve_expired', `${res.failClass}: ${res.detail}`)
  })
  assert.deepEqual(phases(rows), ['declined:reserve_expired'])
  assert.equal(ran.length, 0)
  await brain
  assert.equal(r.isBusy(), false, 'the expired reservation does not hold the runner')
  const after = await r.run('__rescue2', {}, { trigger: 'llm:idle' })
  assert.ok(!RUNNER_DECLINED.has(after.failClass), after.failClass)
})

await t('H2 RESERVE: the cap is RESERVE_MAX_MS (20 s); the watchdog asks for 20 s', async () => {
  const r = new Runner(fakeBot())
  r.reserve('watchdog', 10 * 60_000)
  assert.ok(r.reservation.until - Date.now() <= 20_000)
  assert.equal(RESCUE_RESERVE_MS, 20_000)
  r.releaseReservation(r.reservation.gen)
})

/** A run() suspended at arb.acquire (preempting a slow idle holder) while a reservation lands. */
async function inFlightStart (RunnerClass) {
  const was = config.reflex.arbiter
  config.reflex.arbiter = true
  try {
    const ran = []; quickSkill('__inflight', ran); quickSkill('__owner', ran)
    const r = new RunnerClass(fakeBot())
    // the body is held at idle priority by something whose cancel takes 300 ms: a work-priority run must wait for it
    const slow = await r.arb.acquire({ owner: 'idle-thing', priority: PRIORITY.idle, onCancel: () => sleep(300) })
    assert.ok(slow)
    const p = r.run('__inflight', { who: 'brain' }, { trigger: 'llm:idle' })
    await sleep(50)
    assert.equal(r.current, null, 'suspended at acquire: no current yet, so interrupt() can abort nothing')
    r.reserve('watchdog', 2000, 'stagnation')
    const res = await p
    const owner = await r.run('__owner', { who: 'watchdog' }, { trigger: 'watchdog_home', owner: 'watchdog' })
    return { res, owner, ran }
  } finally { config.reflex.arbiter = was }
}

await t('H2 IN-FLIGHT START: a run suspended at arb.acquire when the reservation lands is declined runner_reserved after the grant', async () => {
  const { res, owner, ran } = await inFlightStart(Runner)
  assert.equal(res.failClass, 'runner_reserved', `${res.status}/${res.failClass}: ${res.detail}`)
  assert.ok(!RUNNER_DECLINED.has(owner.failClass), `${owner.status}/${owner.failClass}: ${owner.detail}`)
  assert.deepEqual(ran.map(a => a.who), ['watchdog'], 'only the owner ran')
})

await t('H2 IN-FLIGHT START MUTANT KILLED: without the re-check after the grant the brain\'s run starts into the reservation', async () => {
  await withMutant(RUNNER_PATH, 'if (landed && landed.owner !== owner) {', 'if (false) {', async mod => {
    const { res, ran } = await inFlightStart(mod.Runner)
    assert.ok(!RUNNER_DECLINED.has(res.failClass), 'the mutant lets the in-flight run through')
    assert.equal(ran[0]?.who, 'brain')
  })
})

/** A skill whose post-run processing throws (the bag read after it returned). */
async function postRunThrow (RunnerClass) {
  const bot = fakeBot()
  let armed = false
  bot.inventory.items = () => { if (armed) throw new Error('inventory unreadable after a disconnect'); return [] }
  SKILLS.__thenThrow = { run: async () => { armed = true; return { status: 'success', detail: 'ok' } } }
  const r = new RunnerClass(bot)
  let threw = null
  try { await r.run('__thenThrow', {}, { trigger: 'test' }) } catch (e) { threw = e }
  return { r, threw }
}

await t('H2 `current` ALWAYS CLEARED: an exception in post-run processing leaves the runner idle', async () => {
  const { r, threw } = await postRunThrow(Runner)
  assert.ok(threw, 'precondition: the post-run processing threw')
  assert.equal(r.current, null, 'a throw in processing must not leave the runner busy forever')
  assert.equal(r.isBusy(), false)
})

await t('H2 `current` MUTANT KILLED: without the outer finally the runner stays busy after the throw', async () => {
  await withMutant(RUNNER_PATH, 'if (this.current === mine) { this.current = null; this.interruptedReason = null }', 'if (false) {}', async mod => {
    const { r, threw } = await postRunThrow(mod.Runner)
    assert.ok(threw)
    assert.notEqual(r.current, null, 'the mutant reproduces the stuck runner')
  })
})

await t('H2 a skill that ignores its abort is hard-stopped; an expired reservation never outlives it', async () => {
  stuckSkill('__wedged', { unwindMs: Infinity })
  const r = new Runner(fakeBot())
  const p = r.run('__wedged', {}, { trigger: 'llm:idle' })
  await sleep(20)
  r.reserve('watchdog', 100, 'stagnation')
  const res = await r.run('__rescue2', {}, { owner: 'watchdog', trigger: 'watchdog_home' })
  assert.equal(res.failClass, 'reserve_expired')
  const w = await p
  assert.equal(w.failClass, 'abort_ignored', `${w.failClass}`)
  assert.equal(r.isBusy(), false)
})

// =====================================================================================================================
// H2 at the watchdog, through the real Runner
// =====================================================================================================================
console.log('-- H2: the watchdog --')

// Test-scale clocks: a 1.2 s window judged every 100 ms; the reservation 250 ms; the skill timeout long enough that the
// runner's own timeout never cuts the scripted skills (restored at the end of the file).
const savedWatch = { ...config.watchdog }
const savedTimeout = config.skills.defaultTimeoutMs
config.watchdog.windowMs = 1200
config.watchdog.sampleMs = 100
config.skills.defaultTimeoutMs = 3000
const TICK = 100

function rig ({ WatchdogClass = StagnationWatchdog, bot = fakeBot() } = {}) {
  const runner = new Runner(bot)
  const wd = new WatchdogClass(bot, runner, { running: true, milestones: { allDone: false } })
  wd.reserveMs = 250
  runner.watchdog = wd
  const timer = setInterval(() => { wd.check().catch(() => {}) }, TICK)   // as StagnationWatchdog.start(): no in-flight guard
  return { bot, runner, wd, stop: async () => { clearInterval(timer); await until(() => !wd.pending, 6000, 'pending to clear').catch(() => {}) } }
}
async function until (cond, ms, what) {
  const t0 = Date.now()
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(20) }
}

await t('P0/H2 a 100 ms unwind: the verdict reserves, the rescue STARTS, and requested -> started -> terminal rows exist', async () => {
  const relocations = []
  const savedGoto = SKILLS.goto
  SKILLS.goto = { run: async (_c, args) => { relocations.push(args); await sleep(50); return { status: 'failed', failClass: 'no_path', detail: 'x' } } }
  stuckSkill('__stuckA', { unwindMs: 100 })
  const { runner, wd, stop } = rig()
  try {
    const rows = await recording(async () => {
      const brain = runner.run('__stuckA', {}, { trigger: 'llm:idle' })
      await until(() => relocations.length > 0, 4000, 'the relocation to start')
      await brain
      await until(() => !wd.pending, 2000, 'the rescue to end')
    })
    const p = phases(rows)
    assert.deepEqual(p.filter(x => x !== 'tick_seen').slice(0, 3), ['requested', 'started', 'completed:failed'], p.join(','))
    const stag = rows.find(r => r.skill.name === '_stagnation')
    assert.ok(stag?.skill.args.window_from, 'the verdict row carries its window\'s first-sample time')
    assert.equal(stag.skill.args.attempt, rows.find(r => r.skill.args?.phase === 'requested').skill.args.attempt)
  } finally { await stop(); SKILLS.goto = savedGoto }
})

await t('P0/H2 a 400 ms unwind (> the reservation): declined once, the level is HELD and backed off one window', async () => {
  const savedGoto = SKILLS.goto
  SKILLS.goto = { run: async () => ({ status: 'success', detail: 'x' }) }
  stuckSkill('__stuckB', { unwindMs: 400 })
  const { runner, wd, stop } = rig()
  try {
    const rows = await recording(async () => {
      const brain = runner.run('__stuckB', {}, { trigger: 'llm:idle' })
      await until(() => wd.reserveExpiredStreak === 1, 4000, 'one reserve_expired')
      await brain
    })
    assert.deepEqual(phases(rows), ['requested', 'declined:reserve_expired'])
    assert.equal(wd.escalation, 0, 'the level was held: escalation--')
    assert.ok(wd.backoffUntil > Date.now() + 500, 'and backs off one window')
    assert.ok(wd.samples.every(s => s.t >= wd.windowResetAt), 'the window was reset')
  } finally { await stop(); SKILLS.goto = savedGoto }
})

await t('rescueLevelStep: started ends the streak; one reserve_expired holds; the cap-th goes to level 3 unheld', async () => {
  assert.deepEqual(rescueLevelStep({ started: true, failClass: null, level: 2, streak: 1 }), { streak: 0, hold: false, jump: false })
  assert.deepEqual(rescueLevelStep({ started: false, failClass: 'reserve_expired', level: 1, streak: 0 }), { streak: 1, hold: true, jump: false })
  assert.deepEqual(rescueLevelStep({ started: false, failClass: 'reserve_expired', level: 1, streak: 1 }), { streak: 2, hold: false, jump: true })
  assert.deepEqual(rescueLevelStep({ started: false, failClass: 'reserve_expired', level: 3, streak: 1 }), { streak: 2, hold: false, jump: false })
  assert.deepEqual(rescueLevelStep({ started: false, failClass: 'body_held', level: 2, streak: 1 }), { streak: 0, hold: true, jump: false })
  assert.equal(RESERVE_EXPIRED_CAP, 2)
})

/** A skill that never unwinds + stagnation: how long until the level-3 reconnect (bot.quit)? */
async function neverUnwinds (WatchdogClass) {
  const savedGoto = SKILLS.goto
  SKILLS.goto = { run: async () => ({ status: 'success', detail: 'x' }) }
  stuckSkill('__never', { unwindMs: Infinity })
  const { bot, runner, wd, stop } = rig({ WatchdogClass })
  const t0 = Date.now()
  let rows
  try {
    rows = await recording(async () => {
      const p = runner.run('__never', {}, { trigger: 'llm:idle' })
      await until(() => bot.quits > 0, 3 * config.watchdog.windowMs + 1500, 'a reconnect').catch(() => {})
      await p
    })
  } finally { await stop(); SKILLS.goto = savedGoto }
  return { bot, rows, ms: Date.now() - t0 }
}

await t('H2 CAP (composed): a never-unwinding skill + stagnation -> a reconnect within 3 windows, its `reconnected` row written', async () => {
  const { bot, rows, ms } = await neverUnwinds(StagnationWatchdog)
  assert.equal(bot.quits, 1, `no reconnect within 3 windows (${ms} ms): ${phases(rows).join(',')}`)
  const p = phases(rows)
  assert.deepEqual(p.filter(x => x.startsWith('declined')), ['declined:reserve_expired', 'declined:reserve_expired'], p.join(','))
  assert.equal(p.at(-1), 'reconnected')
  const rec = rows.filter(r => r.skill.args?.phase === 'reconnected')[0]
  assert.equal(rec.skill.args.remedy, 'reconnect'); assert.equal(rec.skill.args.level, 3)
})

await t('H2 CAP MUTANT KILLED: holding the level on every reserve_expired removes the one remedy that needs no runner', async () => {
  await withMutant(WATCHDOG_PATH, '  if (n >= cap) return { streak: n, hold: false, jump: level < 3 }', '  if (false) return null', async mod => {
    const { bot } = await neverUnwinds(mod.StagnationWatchdog)
    assert.equal(bot.quits, 0, 'the mutant holds the level forever and never reconnects')
  })
})

/** A rescue that creeps (0.3 block per tick, under the 8-block threshold) for `ms`, then gives up. */
async function creepingRescue (WatchdogClass, ms = 2000) {
  const savedGoto = SKILLS.goto
  let rescue = null
  SKILLS.goto = { run: async (ctx, _args, signal) => {
    const t0 = Date.now(); rescue = { t0, aborted: false }
    while (Date.now() - t0 < ms) {
      if (signal.aborted) { rescue.aborted = true; const e = new Error('cut'); e.aborted = true; throw e }
      const p = ctx.bot.entity.position; moveTo(ctx.bot, p.x + 0.03, p.y, p.z)
      await sleep(10)
    }
    rescue.end = Date.now()
    return { status: 'failed', failClass: 'no_path', detail: 'boxed in' }
  } }
  stuckSkill('__stuckC', { unwindMs: 30 })
  const { runner, wd, stop } = rig({ WatchdogClass })
  const strandBefore = []
  let rows
  try {
    rows = await recording(async live => {
      const brain = runner.run('__stuckC', {}, { trigger: 'llm:idle' })
      await until(() => rescue, 4000, 'the rescue to start')
      await brain
      await sleep(300); strandBefore.push(wd.strandHistory.length)
      await sleep(500); strandBefore.push(wd.strandHistory.length)
      await until(() => rescue.end || rescue.aborted, ms + 2000, 'the rescue to end')
      // the bot then stays put while the brain keeps trying: the next verdict is on the rescue's own window
      stuckSkill('__stuckD', { unwindMs: 30 })
      const again = runner.run('__stuckD', {}, { trigger: 'llm:idle' })
      await until(() => rows2(live).length >= 2, 3000, 'a second verdict').catch(() => {})
      await again
    })
  } finally { await stop(); SKILLS.goto = savedGoto }
  return { rescue, rows, strandBefore }
}
const rows2 = rows => rows.filter(r => r.skill.name === '_stagnation')

await t('P2/H2 PENDING: a rescue creeping under the threshold is NOT cut before its own end; tick_seen is written; stranding history keeps sampling; the next verdict is on the rescue\'s own window', async () => {
  const { rescue, rows, strandBefore } = await creepingRescue(StagnationWatchdog)
  assert.equal(rescue.aborted, false, 'the rescue was cancelled mid-run: H2b')
  assert.ok(rescue.end - rescue.t0 >= 1900, 'it ran its whole 2 s (> the 1.2 s window)')
  const p = phases(rows)
  assert.ok(p.includes('tick_seen'), p.join(','))
  assert.ok(p.includes('completed:failed'), p.join(','))
  assert.ok(strandBefore[1] > strandBefore[0], `stranding history accumulates while pending: ${strandBefore}`)
  const verdicts = rows2(rows)
  assert.equal(verdicts.length, 2, `one verdict before, one after the rescue: ${verdicts.length}`)
  assert.ok(Date.parse(verdicts[1].skill.args.window_from) >= rescue.t0 - 5, 'the second verdict judged only samples from the rescue\'s start on')
  assert.equal(verdicts[1].skill.args.escalation, 2, 'and escalated from there')
})

await t('P2 MUTANT KILLED: without the pending guard, the next tick cuts the creeping rescue on the old window', async () => {
  await withMutant(WATCHDOG_PATH, '    if (this.pending) { this.#pendingTick(); return }', '    if (false) { return }', async mod => {
    const { rescue } = await creepingRescue(mod.StagnationWatchdog)
    assert.equal(rescue.aborted, true, 'the mutant reproduces H2b: the rescue is cut mid-run')
  })
})

await t('P2 MUTANT KILLED: a pending tick that does not sample the stranding history stops accumulating it', async () => {
  await withMutant(WATCHDOG_PATH, '    this.#strandSample(now)\n    const pd = this.pending', '    const pd = this.pending', async mod => {
      const { strandBefore } = await creepingRescue(mod.StagnationWatchdog, 1200)
      assert.equal(strandBefore[1], strandBefore[0], 'the mutant freezes the stranding history during a rescue')
    })
})

/** A rescue whose escalation throws (the position read after a disconnect): is pending released? */
async function throwingEscalation (WatchdogClass) {
  stuckSkill('__stuckE', { unwindMs: 30 })
  const bot = fakeBot()
  const { runner, wd, stop } = rig({ WatchdogClass, bot })
  try {
    const brain = runner.run('__stuckE', {}, { trigger: 'llm:idle' })
    const real = bot.entity
    // the verdict's own reads succeed; #escalate's position read throws
    await until(() => wd.samples.length > 8, 3000, 'samples')
    bot.entity = { get position () { if (wd.escalation > 0) throw new Error('disconnected'); return real.position }, onGround: true, velocity: V(0, 0, 0) }
    await until(() => wd.escalation > 0, 3000, 'a verdict')
    await sleep(300)
    runner.cancel('test'); await brain.catch(() => {})
    return wd
  } finally { await stop() }
}

await t('H2 PENDING is released by the finally when #escalate throws', async () => {
  const wd = await throwingEscalation(StagnationWatchdog)
  assert.equal(wd.pending, null)
})

await t('H2 PENDING MUTANT KILLED: without the identity-guarded release the watchdog stays pending (silenced) after a throw', async () => {
  await withMutant(WATCHDOG_PATH, '      if (this.pending === mine) this.pending = null', '      void mine', async mod => {
    const wd = await throwingEscalation(mod.StagnationWatchdog)
    assert.notEqual(wd.pending, null, 'the mutant leaves pending set')
  })
})

// =====================================================================================================================
// THE REFUSAL CHAIN, COMPOSED (§5): watchdog + home + the entombment reflex firing mid-walk, below sea level
// =====================================================================================================================
console.log('-- composed: watchdog + home + entombment reflex --')

/**
 * The rescue (level 2, `home`) starts from y=40: goto finds no route (stranded), home calls `surface`, and while surface's
 * pathfinder stage walks, the entombment reflex takes the body (runner.interrupt + its own goal). The pathfinder rejects
 * with the RAW "goal was changed", which surface's catch re-throws unmarked. Then the bot stays put.
 */
async function composed (RunnerClass = Runner) {
  const bot = fakeBot({ at: V(30, 40, 0) })
  bot.withAscentMovements = async f => f(); bot.ascentMovements = {}
  let pendingGoto = null
  bot.pathfinder.goto = goal => {
    if (goal?.constructor?.name !== 'GoalY') return sleep(20)          // goto's legs: no movement -> stranded
    return new Promise((_resolve, reject) => { pendingGoto = reject })  // surface's stage: walking...
  }
  bot.pathfinder.setGoal = () => {                                        // ...until someone sets a goal
    if (pendingGoto) { const e = new Error('The goal was changed before it could be completed!'); e.name = 'GoalChanged'; const r = pendingGoto; pendingGoto = null; r(e) }
  }
  const runner = new RunnerClass(bot)
  const wd = new StagnationWatchdog(bot, runner, { running: true, milestones: { allDone: false } })
  wd.reserveMs = 250; runner.watchdog = wd
  wd.escalation = 1                                        // the relocation already failed: this verdict is level 2 (home)
  const timer = setInterval(() => { wd.check().catch(() => {}) }, TICK)
  const homeRows = []
  const untapHome = tapRecords(r => { if (r?.skill?.name === 'home') homeRows.push(r) })
  let reflexAt = null
  try {
    const rows = await recording(async live => {
      stuckSkill('__stuckF', { unwindMs: 30 })
      const brain = runner.run('__stuckF', {}, { trigger: 'llm:idle' })
      await until(() => pendingGoto, 5000, 'surface\'s stage to start walking')
      await brain
      await sleep(250)
      // THE ENTOMBMENT REFLEX: interrupts the runner and drives its own goal (reflex.mjs seizeBody).
      reflexAt = Date.now()
      runner.interrupt('entombed'); const pf = bot.pathfinder; pf.setGoal({})   // the fake pathfinder (not a movement writer in src/)
      await until(() => homeRows.length, 2000, 'home to end')
      // the bot stays put while the brain keeps trying
      stuckSkill('__stuckG', { unwindMs: 30 })
      const again = runner.run('__stuckG', {}, { trigger: 'llm:idle' })
      await until(() => rows2(live).some(r => r.skill.args.escalation === 3) || bot.quits, 4000, 'level 3').catch(() => {})
      runner.cancel('test'); await again
    })
    return { rows, homeRows, reflexAt, bot }
  } finally { clearInterval(timer); await until(() => !wd.pending, 6000, 'pending to clear').catch(() => {}); untapHome() }
}

await t('COMPOSED: home is filed `interrupted` (not skill_error), the watchdog does not escalate during the pending rescue, and escalates to 3 on the rescue\'s own window', async () => {
  const { rows, homeRows, reflexAt } = await composed()
  assert.equal(homeRows.length, 1)
  assert.equal(homeRows[0].skill.status, 'aborted', `${homeRows[0].skill.status}/${homeRows[0].skill.fail_class}: ${homeRows[0].skill.detail}`)
  assert.equal(homeRows[0].skill.fail_class, 'interrupted')
  assert.equal(homeRows[0].trigger, 'interrupt:entombed')
  const p = phases(rows)
  assert.ok(p.includes('interrupted:entombed'), p.join(','))
  const v = rows2(rows)
  const rescueStart = Date.parse(homeRows[0]['@timestamp'])
  assert.ok(!v.some(r => Date.parse(r['@timestamp']) > rescueStart && Date.parse(r['@timestamp']) < reflexAt), 'no verdict while the rescue was pending')
  const third = v.find(r => r.skill.args.escalation === 3)
  assert.ok(third, `escalated to 3 afterwards: ${v.map(r => r.skill.args.escalation)}`)
  assert.ok(Date.parse(third.skill.args.window_from) >= rescueStart - 5, 'on the rescue\'s own window')
})

await t('COMPOSED MUTANT KILLED: without H3 the same chain files home as skill_error', async () => {
  await withMutant(RUNNER_PATH, 'result = (e?.aborted || controller.signal.aborted)', 'result = (e?.aborted)', async mod => {
    const { homeRows } = await composed(mod.Runner)
    assert.equal(homeRows[0]?.skill?.fail_class, 'skill_error', 'the mutant reproduces the 225 rows')
  })
})

config.watchdog.windowMs = savedWatch.windowMs
config.watchdog.sampleMs = savedWatch.sampleMs
config.skills.defaultTimeoutMs = savedTimeout
for (const k of Object.keys(SKILLS)) if (k.startsWith('__')) delete SKILLS[k]
console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
