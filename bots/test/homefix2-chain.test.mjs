// homefix-02 (docs/reports/homefix-02-design-2026-10-21.md §7), the composed pieces (Codex code r1 P2-4):
//   A. the air publisher (C3b) by BEHAVIOUR: a later danger tick interrupts, one yield row per run, a brain run is left
//      alone, every sampled danger row records interrupt_issued, `pocketing` is LIVE (a rung started between ticks is
//      seen by the next admission -- Codex code r1 P1-1);
//   B. WIRING (structural, comments stripped, each with a mutant): the reflex tick calls publishAir FIRST;
//   C. the C1 chain composed from the real functions: scan (head ice) -> sealed -> trigger -> plan (dy 1) -> step;
//   D. the C2 + C3 chain through the real Runner and StagnationWatchdog: no dry target -> level-2 home (fallback) ->
//      declined air_rescue x2 -> the capped start -> the next verdict is level 3.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'homefix2-chain-'))
process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'homefix2-chain-state-'))
process.env.BOT_NAME = 'Homefix2ChainBot'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_SCOPE = 'isolated'
process.env.LOG_LEVEL ??= 'error'

const { withMutant } = await import('./helpers/mutant.mjs')
const { makeAirPublisher, airAdmission } = await import('../src/airstate.mjs')
const { makeAirClock } = await import('../src/air.mjs')
const { scanBreathableRoute } = await import('../src/reflex.mjs')
const { airPocketTrigger, airPocketPlan, airPocketStep } = await import('../src/airpocket.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const { Runner } = await import('../src/runner.mjs')
const { StagnationWatchdog } = await import('../src/watchdog.mjs')
const { config } = await import('../src/config.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const AIRSTATE_PATH = new URL('../src/airstate.mjs', import.meta.url)
const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z),
                          clone: () => V(x, y, z), floored: () => V(Math.floor(x), Math.floor(y), Math.floor(z)) })
const WATER = { name: 'water', boundingBox: 'empty' }, AIR = { name: 'air', boundingBox: 'empty' }, STONE = { name: 'stone', boundingBox: 'block' }

// ======================================================================================================== A. the publisher
console.log('-- A. the air publisher --')
function pubRig ({ owner = 'watchdog' } = {}) {
  let now = 1_000_000
  const bot = { entity: { position: V(0.5, 60, 0.5) }, health: 20, blockAt: () => WATER }      // head under from the start
  const interrupts = []
  const runner = { current: owner ? { owner, skill: 'home', rescue: { attempt: 'a1' } } : null, interrupt (r) { interrupts.push(r); return !!this.current } }
  const rows = []
  let rungs = false
  const publish = makeAirPublisher({ bot, runner, isPocketing: () => rungs, log: e => rows.push(e), now: () => now, clock: makeAirClock() })
  const tick = (ms = 500) => { now += ms; return publish() }
  return { bot, runner, rows, interrupts, tick, setRungs: v => { rungs = v }, now: () => now }
}
await t('A1 danger needs head under + <= 5 s air + health fallen within 3 s: a LATER tick interrupts the watchdog run, not only the first', () => {
  const r = pubRig()
  for (let i = 0; i < 24; i++) r.tick()                      // 12 s under, health flat: air runs down, no danger yet
  assert.equal(r.interrupts.length, 0, 'flat health is not danger (the lag the design states)')
  r.bot.health = 18; r.tick()                                 // the first 2-HP step
  assert.ok(r.interrupts.length >= 1, 'danger on the first falling tick')
  const n = r.interrupts.length
  r.tick(); r.tick()                                          // health flat again, but fell within 3 s: still danger
  assert.ok(r.interrupts.length > n, 'level-triggered: later danger ticks interrupt again')
  assert.equal(r.rows.filter(x => x.kind === 'air_rescue_yield').length, 1, 'one yield row per run')
  const d = r.rows.filter(x => x.kind === 'air_danger')
  assert.ok(d.length >= 1 && d.every(x => x.args.interrupt_issued === 1 && x.args.attempt === 'a1' && x.args.health_3s_max === 20))
})
await t('A2 a BRAIN-owned run is never interrupted and no danger row is written for it (F5)', () => {
  const r = pubRig({ owner: null }); r.runner.current = { owner: null, skill: 'explore' }
  for (let i = 0; i < 24; i++) r.tick()
  r.bot.health = 16; r.tick(); r.tick()
  assert.equal(r.interrupts.length, 0); assert.equal(r.rows.length, 0)
  assert.equal(r.bot.airRescue.danger, true, 'the state is still published (the admission reads it)')
})
await t('A3 a chronic submerged bot at 20/20 never reads danger: no interrupt in 5 min of ticks', () => {
  const r = pubRig()
  for (let i = 0; i < 600; i++) r.tick()
  assert.equal(r.interrupts.length, 0); assert.equal(r.bot.airRescue.danger, false)
})
await t('A4 `pocketing` is LIVE: a rung that starts after the tick is seen by the next admission without another tick', () => {
  const r = pubRig(); r.tick()
  assert.equal(airAdmission(r.bot.airRescue, r.now()).refuse, false)
  r.setRungs(true)
  assert.equal(r.bot.airRescue.pocketing, true)
  assert.equal(airAdmission(r.bot.airRescue, r.now()).refuse, true, 'refused from the rung\'s own flag')
})
await t('A5 MUTANT KILLED: a snapshot pocketing (r1 build) misses the rung started between ticks', async () => {
  await withMutant(AIRSTATE_PATH, 'get pocketing () { return isPocketing() === true }', 'pocketing: isPocketing() === true', async m => {
    let rungs = false
    const bot = { entity: { position: V(0, 60, 0) }, health: 20, blockAt: () => AIR }
    const pub = m.makeAirPublisher({ bot, runner: null, isPocketing: () => rungs })
    pub(); rungs = true
    assert.equal(bot.airRescue.pocketing, false, 'the mutant reproduces the race')
  })
})
await t('A6 MUTANT KILLED: without the interrupt the watchdog run keeps running through the drowning (and the row says so)', async () => {
  await withMutant(AIRSTATE_PATH, "const issued = yields ? (runner.isInterrupted?.() === true || runner.interrupt('drowning') === true) : false", 'const issued = false', async m => {
    let now = 0; const bot = { entity: { position: V(0, 60, 0) }, health: 20, blockAt: () => WATER }
    const calls = []; const rows = []
    const runner = { current: { owner: 'watchdog', skill: 'home', rescue: { attempt: 'a' } }, interrupt: r => calls.push(r) }
    const pub = m.makeAirPublisher({ bot, runner, log: e => rows.push(e), now: () => now })
    for (let i = 0; i < 24; i++) { now += 500; pub() }
    bot.health = 18; now += 500; pub()
    assert.equal(calls.length, 0)
    assert.ok(rows.some(x => x.kind === 'air_danger' && x.args.interrupt_issued === 0), 'G5d\' sees interrupt_issued=0')
  })
})

await t('A7 a run something else already interrupted keeps its reason (no re-interrupt, no relabel), and counts as issued', () => {
  const r = pubRig()
  r.runner.isInterrupted = () => true                         // e.g. the air-pocket step interrupted it ('air_pocket')
  for (let i = 0; i < 24; i++) r.tick()
  r.bot.health = 18; r.tick()
  assert.equal(r.interrupts.length, 0, 'not re-interrupted: interruptedReason is not overwritten')
  assert.ok(r.rows.filter(x => x.kind === 'air_danger').every(x => x.args.interrupt_issued === 1))
})

// ======================================================================================================== B. wiring
console.log('-- B. wiring --')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
await t('B1 WIRED: the reflex tick calls publishAir() FIRST (before the inventoryUnsettled release await); the publisher is built from the rungs\' flags', () => {
  const src = strip(fs.readFileSync(REFLEX_PATH, 'utf8'))
  assert.ok(/if \(!bot\.entity\) return\s*\n\s*try \{\s*\n\s*publishAir\(\)\s*\n\s*if \(bot\.inventoryUnsettled\?\.release\)/.test(src), 'publishAir is the first statement of the tick')
  assert.ok(/makeAirPublisher\(\{ bot, runner, isPocketing: \(\) => airPocketing \|\| pocketing,/.test(src), 'pocketing comes from both rungs\' flags')
})
await t('B2 MUTANT KILLED: moving the call after the release await fails B1 (the wiring check can fail)', async () => {
  const src = fs.readFileSync(REFLEX_PATH, 'utf8')
  const old = '      publishAir()\n'
  assert.ok(src.includes(old) && src.split(old).length === 2, 'anchor present and unique')
  const mutated = strip(src.replace(old, ''))
  assert.ok(!/if \(!bot\.entity\) return\s*\n\s*try \{\s*\n\s*publishAir\(\)/.test(mutated))
})

// ======================================================================================================== C. the C1 chain
console.log('-- C. the C1 chain --')
await t('C1 death 1 composed: head ice -> the scan says SEALED (not up) -> the trigger fires at once -> the plan digs dy 1 -> the step breathes', async () => {
  const cells = { '0,0,0': 'water', '0,1,0': 'ice', '0,2,0': 'air', '0,3,0': 'air' }        // relative to the FEET
  const B = n => ({ name: n, boundingBox: /^(air|water)$/.test(n) ? 'empty' : 'block' })
  const atFeet = (dx, dy, dz) => B(cells[`${dx},${dy},${dz}`] ?? 'ice')                       // the sheet: ice all round
  const route = scanBreathableRoute({ at: (dx, dy, dz) => atFeet(dx, dy + 1, dz) })               // the scan is head-relative
  assert.notEqual(route.dir, 'up'); assert.equal(route.sealed, true)
  assert.equal(airPocketTrigger({ rescuing: true, routeDir: route.dir, routeSealed: route.sealed, heldMs: 0 }), true)
  const plan = airPocketPlan(atFeet)
  assert.deepEqual([plan.ok, plan.kind, plan.dy], [true, 'ice', 1])
  // the step on a fake bot: the dig opens the head cell to water; the bot rises 0.6 and its eye is in the air above
  const map = new Map(Object.entries(cells))
  const P0 = { x: 100.5, y: 60.2, z: 100.5 }
  class Vx { constructor (x, y, z) { this.x = x; this.y = y; this.z = z } equals (o) { return o && o.x === this.x && o.y === this.y && o.z === this.z } offset (a, b, c) { return new Vx(this.x + a, this.y + b, this.z + c) } }
  const bot = { health: 18, entity: { position: new Vx(P0.x, P0.y, P0.z), onGround: false }, controls: {}, inventory: { items: () => [{ name: 'stone_pickaxe' }] },
    heldItem: null, setControlState (n, v) { this.controls[n] = v }, stopDigging () {}, lookAt: async () => {},
    equip: async it => { bot.heldItem = it },
    blockAt (v) { const k = `${Math.floor(v.x) - 100},${Math.floor(v.y) - 60},${Math.floor(v.z) - 100}`; const n = map.get(k) ?? 'ice'; return { ...B(n), position: new Vx(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)) } },
    dig: async blk => { await sleep(30); map.set(`${blk.position.x - 100},${blk.position.y - 60},${blk.position.z - 100}`, 'water'); setTimeout(() => { bot.entity.position = new Vx(P0.x, 60.6, P0.z) }, 20) } }
  const hp = setInterval(() => { bot.health = Math.min(20, bot.health + 0.2) }, 50)
  const fastNow = (() => { const s = Date.now(); return () => s + (Date.now() - s) * 10 })()
  const r = await airPocketStep(bot, plan, { Vec3: Vx, predict: (b, it) => (/_pickaxe$/.test(it?.name ?? '') ? 300 : 7500), envelope: 0.5, now: fastNow, sleep: ms => sleep(ms / 10) })
  clearInterval(hp)
  assert.equal(r.ok, true, r.why); assert.equal(r.cell, '100,61,100', 'the head cell itself is dug')
})

// ======================================================================================================== D. the C2 + C3 chain
console.log('-- D. no dry target -> home -> air declines -> capped start -> level 3 --')
const savedWatch = { ...config.watchdog }, savedTimeout = config.skills.defaultTimeoutMs
config.watchdog.windowMs = 1200; config.watchdog.sampleMs = 100; config.skills.defaultTimeoutMs = 3000
async function until (cond, ms, what) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(20) } }
await t('D1 an all-water world: L1 finds no dry target -> ONE level-2 home request (fallback, 16 tries) -> 2 air declines -> the capped start -> level 3 next', async () => {
  const savedHome = SKILLS.home
  const homes = []
  SKILLS.home = { run: async () => { homes.push(Date.now()); await sleep(30); return { status: 'failed', failClass: 'no_path', detail: 'x' } } }
  SKILLS.__chainStuck = { run: (_c, _a, signal) => new Promise((_r, rej) => signal.addEventListener('abort', () => setTimeout(() => { const e = new Error('aborted'); e.aborted = true; rej(e) }, 10), { once: true })) }
  const bot = { entity: { position: V(0, 60, 0), onGround: true, velocity: V(0, 0, 0), isInWater: true }, health: 20, food: 20, version: '1.21.8',
    registry: { blocksByName: {}, itemsByName: {}, blocks: {} }, inventory: { items: () => [] },
    blockAt: p => (p.y <= 62 ? WATER : AIR),                                              // an ocean: no standable dry cell anywhere
    findBlock: () => null, findBlocks: () => [], entities: {}, players: {}, time: { day: 1, age: 1 }, game: { dimension: 'overworld' },
    assertNav: () => {}, chat: () => {}, clearControlStates: () => {}, setControlState: () => {}, quits: 0, quit () { this.quits++ },
    pathfinder: { movements: {}, setMovements () {}, stop () {}, setGoal () {}, goto: async () => {}, getPathTo: () => ({ status: 'noPath', path: [] }) } }
  const keep = setInterval(() => { bot.airRescue = { danger: true, pocketing: false, airSeconds: 1, headUnder: true, at: Date.now() } }, 50)
  const runner = new Runner(bot)
  const wd = new StagnationWatchdog(bot, runner, { running: true, milestones: { allDone: false } }); wd.reserveMs = 250; runner.watchdog = wd
  const timer = setInterval(() => { wd.check().catch(() => {}) }, 100)
  const rows = []
  const untap = tapRecords(r => { if (/^_(watchdog_rescue|stagnation)$/.test(r?.skill?.name ?? '')) rows.push(r) })
  try {
    const tEnd = Date.now() + 25000
    const brain = (async () => { while (Date.now() < tEnd && !rows.some(r => r.skill.name === '_stagnation' && Number(r.skill.args?.escalation) >= 3)) { await runner.run('__chainStuck', {}, { trigger: 'llm:idle' }).catch(() => {}); await sleep(20) } })()
    while (Date.now() < tEnd && !rows.some(r => r.skill.name === '_stagnation' && Number(r.skill.args?.escalation) >= 3)) { wd.backoffUntil = 0; await sleep(50) }
    await brain
  } finally { clearInterval(timer); clearInterval(keep); untap(); SKILLS.home = savedHome; await until(() => !wd.pending, 6000, 'pending').catch(() => {}) }
  const req = rows.filter(r => r.skill.name === '_watchdog_rescue' && r.skill.args.phase === 'requested')
  const first = req[0]?.skill.args
  assert.equal(first?.level, 2, `the first request is level 2 (${JSON.stringify(first)})`); assert.equal(first?.fallback, 'no_dry_relocation'); assert.equal(first?.dry_tries, 16)
  const phases = rows.filter(r => r.skill.name === '_watchdog_rescue').map(r => r.skill.args.phase)
  const si = phases.indexOf('started')
  assert.ok(si > 0, phases.join(','))
  assert.equal(phases.slice(0, si).filter(p => p === 'declined:air_rescue').length, 2, `two declines, then the start: ${phases.join(',')}`)
  const started = rows.find(r => r.skill.name === '_watchdog_rescue' && r.skill.args.phase === 'started')
  assert.equal(started?.skill.args.air_capped, 1)
  assert.ok(homes.length >= 1, 'the capped home ran')
  assert.ok(rows.some(r => r.skill.name === '_stagnation' && Number(r.skill.args?.escalation) >= 3), 'and the ladder reached level 3')
  // level 3's runner rescue is a NEW kind-count after the start: it may be declined again (the count restarted), never stuck
  assert.ok(req.some(r => Number(r.skill.args.level) >= 3), 'a level-3 request was made')
})
config.watchdog.windowMs = savedWatch.windowMs; config.watchdog.sampleMs = savedWatch.sampleMs; config.skills.defaultTimeoutMs = savedTimeout

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
