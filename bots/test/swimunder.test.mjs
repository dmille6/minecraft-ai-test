// SWIMUNDER-01: a bot pinned in a wet-ceiling pocket swims out under the wall (src/swimunder.mjs; design and evidence in
// docs/reports/dropdig-design-2026-11-03.md). 72 h to 11-03 21Z: 120.2 of 302.7 still bot-h were the climb-flood chain;
// isolated-d-Delta and -Echo spent 41.7 h and 38.0 h in ONE cell (358,58,180), every rung refused.
//
// The scenes are REAL: three sites cut from the 11-03 03:16Z nightly backup's region copies (test/fixtures/swimunder-*.json),
// run through prismarine-physics (the same physics the bot moves by) with the actuator itself driving a fake bot.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'
import { swimUnderPlan, swimUnderAdmit, swimUnderStep, swimUnderAbort, swimBackRoute, swimUnder, swimUnderOn, exitKind, swimFits,
  swimUnderBackoffMs, SU_MAX_WET_RUN, SU_ABORT_OXYGEN } from '../src/swimunder.mjs'

const require = createRequire(import.meta.url)
const Block = require('prismarine-block')('1.21.8')
const mcData = require('minecraft-data')('1.21.8')
const { Physics, PlayerState } = require('prismarine-physics')

let pass = 0, fail = 0
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const SRC = new URL('../src/swimunder.mjs', import.meta.url)
const REFLEX = new URL('../src/reflex.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// ---- worlds ---------------------------------------------------------------------------------------------------------
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
function worldOf (fx, edits = new Map()) {
  const cache = new Map()
  const stateAt = (x, y, z) => edits.get(`${x},${y},${z}`) ?? fx.cells[`${x},${y},${z}`] ?? fx.outside
  const get = (x, y, z) => {
    const k = `${x},${y},${z}`, st = stateAt(x, y, z)
    const hit = cache.get(k)
    if (hit && hit.st === st) return hit.b
    const b = Block.fromString(st, 0); b.position = new Vec3(x, y, z)
    cache.set(k, { st, b })
    return b
  }
  return { at: (x, y, z) => get(x, y, z), getBlock: p => get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), edits }
}
// a synthetic world from a function (x,y,z) -> state string
function synth (fn) {
  const cache = new Map()
  const get = (x, y, z) => { const k = `${x},${y},${z}`; if (!cache.has(k)) { const b = Block.fromString(fn(x, y, z), 0); b.position = new Vec3(x, y, z); cache.set(k, b) } return cache.get(k) }
  return { at: get, getBlock: p => get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) }
}

// ---- a fake bot that moves by prismarine-physics -------------------------------------------------------------------
function simBot (world, feet) {
  const physics = Physics(mcData, world)
  const control = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
  const listeners = []
  const bot = {
    version: '1.21.8',
    entity: { position: new Vec3(feet[0], feet[1], feet[2]), velocity: new Vec3(0, 0, 0), onGround: false, isInWater: true, isInLava: false,
              isInWeb: false, isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false, yaw: 0, pitch: 0,
              effects: {}, attributes: {} },
    inventory: { slots: [] }, jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0,
    health: 20, air: 300, get oxygenLevel () { return Math.round(this.air / 15) },
    setControlState (k, v) { control[k] = v },
    lookAt (p) { const d = p.minus(this.entity.position.offset(0, 1.62, 0)); this.entity.yaw = Math.atan2(-d.x, -d.z); this.entity.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) },
    blockAt (p) { return world.getBlock(p) },
    once (ev, fn) { if (ev === 'physicsTick') listeners.push(fn) },
    removeListener (ev, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1) },
    ticks: 0, control, trail: [],
  }
  bot.tick = () => {
    const st = new PlayerState(bot, control)
    physics.simulatePlayer(st, world).apply(bot)
    const eye = world.getBlock(bot.entity.position.offset(0, 1.62, 0))
    const wet = /water|bubble|kelp|seagrass/.test(eye.name) || eye.isWaterlogged === true
    bot.air = wet ? Math.max(0, bot.air - 1) : Math.min(300, bot.air + 4)
    if (bot.air === 0 && bot.ticks % 20 === 0) bot.health -= 2
    bot.ticks++
    bot.trail.push([bot.entity.position.x, bot.entity.position.y, bot.entity.position.z])
    const ls = listeners.splice(0); for (const fn of ls) fn()
  }
  return bot
}
// drive the async actuator: tick the physics every microtask turn until it resolves (or maxTicks)
async function runActuator (bot, opts, maxTicks = 2000) {
  let done = false, res = null
  const p = swimUnder(bot, { now: () => bot.ticks * 50, ...opts }).then(r => { done = true; res = r })   // the sim's clock: 50 ms a tick (Codex r1 note 1)
  for (let i = 0; i < maxTicks && !done; i++) { await new Promise(r => setImmediate(r)); bot.tick() }
  if (!done) throw new Error(`actuator still running after ${maxTicks} ticks`)
  await p
  return res
}
// let a fresh body settle (float) for n ticks, holding jump like the float hold does
function settle (bot, n = 60, jump = true) { bot.control.jump = jump; for (let i = 0; i < n; i++) bot.tick(); bot.control.jump = false }
const feetCell = b => [Math.floor(b.entity.position.x), Math.floor(b.entity.position.y + 1e-6), Math.floor(b.entity.position.z)]

const ISOD = fixture('swimunder-isolated-d-358_58_180')
const ISOC = fixture('swimunder-isolated-c-355_47_186')
const HIVED = fixture('swimunder-hive-d-100_54_149')

// ---- the planner ----------------------------------------------------------------------------------------------------
await ta('P1 isolated-d 358,58,180 (Delta 41.7 h + Echo 38.0 h): a way out to DRY ground, sinking first, the head under water at most 4 cells in a row', () => {
  const w = worldOf(ISOD)
  const r = swimUnderPlan({ at: w.at, start: ISOD.feet })
  assert.ok(r.ok, r.reason); assert.equal(r.exit, 'dry')
  assert.deepEqual(r.route[0], [358, 57, 180], 'the first move is DOWN, under the head-level wall')
  assert.ok(r.wetRun <= 4 && r.wetRun <= SU_MAX_WET_RUN, `wet run ${r.wetRun}`)
  const last = r.route.at(-1)
  assert.equal(exitKind(w.at, last), 'dry')
  assert.ok(Math.max(...r.route.map(c => Math.max(Math.abs(c[0] - 358), Math.abs(c[2] - 180)))) <= 4)
})

await ta('P2 the trap really is sealed for every older rung: the head cell is walled on all four sides, the roof solid, water over the roof', () => {
  const w = worldOf(ISOD), [x, y, z] = ISOD.feet
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.equal(w.at(x + dx, y + 1, z + dz).boundingBox, 'block', `head wall ${dx},${dz}`)
  assert.equal(w.at(x, y + 2, z).boundingBox, 'block'); assert.equal(w.at(x, y + 3, z).name, 'water'); assert.equal(w.at(x, y, z).name, 'water')
})

await ta('P3 hive-d 100,54,149 (failmine 7-day stuck cluster #1, 82.6 bot-h): a way out to dry ground', () => {
  const w = worldOf(HIVED)
  const r = swimUnderPlan({ at: w.at, start: HIVED.feet })
  assert.ok(r.ok, r.reason); assert.equal(r.exit, 'dry')
})

await ta('P4 isolated-c 355,47,186 (Bravo 19.2 h): NO swim exit within reach -> refused with the reason (the existing back-off stands; no new move is invented)', () => {
  const w = worldOf(ISOC)
  const r = swimUnderPlan({ at: w.at, start: ISOC.feet })
  assert.equal(r.ok, false); assert.match(r.reason, /no way out within 4 cells/)
})

const tunnel = (wetLen, extra = () => null) => synth((x, y, z) => {
  const e = extra(x, y, z); if (e) return e
  // a 1x1 pocket at x=0 (feet water y=10, head air y=11, roof y=12); a 2-high water tunnel at y=9..10 running +x for
  // wetLen cells under a stone ceiling at y=11; then dry ground at the tunnel's height (floor y=8 stone, air y=9..11)
  if (x === 0 && z === 0) return y === 10 ? 'minecraft:water[level=0]' : y === 11 ? 'minecraft:air' : y === 9 ? 'minecraft:water[level=0]' : 'minecraft:stone'
  if (z === 0 && x >= 1 && x <= wetLen) return (y === 9 || y === 10) ? 'minecraft:water[level=0]' : 'minecraft:stone'
  if (z === 0 && x === wetLen + 1) return (y >= 9 && y <= 11) ? 'minecraft:air' : 'minecraft:stone'
  return 'minecraft:stone'
})
await ta('P5 the breath bound: a tunnel whose head-under-water stretch is <= SU_MAX_WET_RUN is taken; one cell longer is refused', () => {
  const ok = swimUnderPlan({ at: tunnel(SU_MAX_WET_RUN - 1).at, start: [0, 10, 0], radius: 8 })
  assert.ok(ok.ok, ok.reason); assert.ok(ok.wetRun <= SU_MAX_WET_RUN)
  const no = swimUnderPlan({ at: tunnel(SU_MAX_WET_RUN + 1).at, start: [0, 10, 0], radius: 8 })
  assert.equal(no.ok, false, `a ${SU_MAX_WET_RUN + 1}+ cell wet stretch was planned: ${JSON.stringify(no.route)}`)
})

await ta('P6 never beside lava, never through a bubble column, never into an unloaded cell', () => {
  const lava = swimUnderPlan({ at: tunnel(2, (x, y, z) => (x === 2 && y === 8 && z === 0) ? 'minecraft:lava[level=0]' : null).at, start: [0, 10, 0] })
  assert.equal(lava.ok, false, 'routed past lava')
  const bubble = swimUnderPlan({ at: tunnel(2, (x, y, z) => (x === 1 && (y === 9 || y === 10) && z === 0) ? 'minecraft:bubble_column[drag=true]' : null).at, start: [0, 10, 0] })
  assert.equal(bubble.ok, false, 'routed through a bubble column')
  const base = tunnel(2)
  const unloaded = swimUnderPlan({ at: (x, y, z) => (x === 2 ? null : base.at(x, y, z)), start: [0, 10, 0] })
  assert.equal(unloaded.ok, false, 'routed through an unloaded cell')
  assert.equal(swimFits(null), false)
})

await ta('P7 the start must be in water: a dry entombed bot is not this move', () => {
  const r = swimUnderPlan({ at: synth(() => 'minecraft:stone').at, start: [0, 10, 0] })
  assert.equal(r.ok, false); assert.match(r.reason, /not in water/)
})

// ---- admission, abort, the way back ---------------------------------------------------------------------------------
await ta('A1 admission: full air and health 14+; SWIMUNDER=0 is off; a missing plan refuses with its reason', () => {
  const plan = { ok: true, route: [[1, 1, 1]] }
  assert.equal(swimUnderAdmit({ plan, oxygen: 20, health: 20, env: {} }).ok, true)
  assert.match(swimUnderAdmit({ plan, oxygen: 15, health: 20, env: {} }).why, /breathe first/)
  assert.match(swimUnderAdmit({ plan, oxygen: 20, health: 10, env: {} }).why, /health/)
  assert.match(swimUnderAdmit({ plan, oxygen: 20, health: 20, env: { SWIMUNDER: '0' } }).why, /SWIMUNDER=0/)
  assert.equal(swimUnderAdmit({ plan: { ok: false, reason: 'no way out' }, oxygen: 20, health: 20, env: {} }).why, 'no way out')
  assert.equal(swimUnderOn({}), true); assert.equal(swimUnderOn({ SWIMUNDER: 'off' }), false)
})

await ta('A2 abort: low air, lost health, a stalled cell, the budget, a yield, a changed way each turn the firing back; otherwise none', () => {
  assert.equal(swimUnderAbort({ oxygen: 18 }), null)
  assert.match(swimUnderAbort({ oxygen: SU_ABORT_OXYGEN }), /air/)
  assert.match(swimUnderAbort({ oxygen: 18, health: 16, health0: 20 }), /health/)
  assert.match(swimUnderAbort({ oxygen: 18, stepMs: 99_999 }), /no progress/)
  assert.match(swimUnderAbort({ oxygen: 18, elapsedMs: 99_999 }), /budget/)
  assert.match(swimUnderAbort({ yielded: 'the drowning rescue' }), /yielded/)
  assert.equal(swimUnderAbort({ oxygen: SU_ABORT_OXYGEN, wetAhead: 1, wetBack: 3 }), null, 'low air with the nearer breath ahead presses on')
  assert.match(swimUnderAbort({ oxygen: SU_ABORT_OXYGEN, wetAhead: 3, wetBack: 1 }), /air/, 'low air with the nearer breath behind turns back')
  assert.deepEqual([1, 2, 5].map(swimUnderBackoffMs), [300_000, 600_000, 3_600_000])
})

await ta('A3 the way back is the wake reversed to the last cell with the head in air (the start if none)', () => {
  const taken = [[0, 9, 0], [1, 9, 0], [2, 9, 0], [3, 9, 0]]
  assert.deepEqual(swimBackRoute({ taken, start: [0, 10, 0], headAirAt: () => false }), [[2, 9, 0], [1, 9, 0], [0, 9, 0], [0, 10, 0]])
  assert.deepEqual(swimBackRoute({ taken, start: [0, 10, 0], headAirAt: c => c[0] === 1 }), [[2, 9, 0], [1, 9, 0]])
})

await ta('C1 the controller: a sideways move outside its height band does not stroke into the next column (the head would catch the wall)', () => {
  const s = swimUnderStep({ pos: { x: 0.5, y: 10.2, z: 0.5 }, from: [0, 9, 0], to: [1, 9, 0] })
  assert.equal(s.forward, false); assert.equal(s.jump, false, 'above the band: sink')
  const s2 = swimUnderStep({ pos: { x: 0.5, y: 9.1, z: 0.5 }, from: [0, 9, 0], to: [1, 9, 0] })
  assert.equal(s2.forward, true)
  // an OPEN passage (first ceiling 5 over the feet): a body floating at the surface strokes (Codex r1 note 1: the old 0.25
  // band was never held at a surface and the firing stalled)
  const s3 = swimUnderStep({ pos: { x: 0.5, y: 9.6, z: 0.5 }, from: [0, 9, 0], to: [1, 9, 0], ceil: 14 })
  assert.equal(s3.forward, true)
  const up = swimUnderStep({ pos: { x: 3.5, y: 9.0, z: 0.5 }, from: [3, 9, 0], to: [3, 10, 0] })
  assert.equal(up.jump, true); assert.equal(up.forward, false)
  const off = swimUnderStep({ pos: { x: 3.9, y: 9.0, z: 0.5 }, from: [3, 9, 0], to: [3, 10, 0] })
  assert.equal(off.forward, true, 'centre before rising'); assert.ok(off.look)
})

// ---- behaviour: the real geometry under prismarine-physics ----------------------------------------------------------
await ta('B1 BASE (control): at isolated-d the float hold (jump held) keeps the body pinned in its cell for 60 s -- the sim reproduces the pin', () => {
  const w = worldOf(ISOD)
  const bot = simBot(w, [358.5, 58.2, 180.5])
  settle(bot, 1200, true)
  assert.deepEqual(feetCell(bot), [358, 58, 180], `the base body left the cell: ${feetCell(bot)}`)
  assert.equal(bot.health, 20)
})

await ta('B2 BEHAVIOUR: at isolated-d the actuator swims the plan and stands on dry ground, air never below 12 of 20, health 20', async () => {
  const w = worldOf(ISOD)
  const bot = simBot(w, [358.5, 58.2, 180.5]); settle(bot)
  const plan = swimUnderPlan({ at: w.at, start: feetCell(bot) })
  assert.ok(plan.ok, plan.reason)
  const res = await runActuator(bot, { plan, oxygen: () => bot.oxygenLevel })
  assert.equal(res.outcome, 'out', `${res.outcome}: ${res.why} after ${res.done}/${res.len} cells, at ${feetCell(bot)}`)
  assert.deepEqual(feetCell(bot), plan.route.at(-1))
  assert.equal(exitKind(w.at, feetCell(bot)), 'dry')
  assert.ok(res.minAir >= 12, `min air ${res.minAir}`); assert.equal(bot.health, 20)
  assert.ok(bot.ticks < 600, `took ${bot.ticks} ticks`)
})

await ta('B3 BEHAVIOUR: hive-d 100,54,149 swims out to dry ground the same way', async () => {
  const w = worldOf(HIVED)
  const s = HIVED.feet
  const bot = simBot(w, [s[0] + 0.5, s[1] + 0.2, s[2] + 0.5]); settle(bot)
  const plan = swimUnderPlan({ at: w.at, start: feetCell(bot) })
  assert.ok(plan.ok, plan.reason)
  const res = await runActuator(bot, { plan, oxygen: () => bot.oxygenLevel })
  assert.equal(res.outcome, 'out', `${res.outcome}: ${res.why} at ${feetCell(bot)}`)
  assert.equal(bot.health, 20)
})

await ta('B4 THE WAY BACK: the way closes behind the wall mid-swim -> the firing turns back to air, health 20 (never a new drowning)', async () => {
  const w = worldOf(ISOD)
  const bot = simBot(w, [358.5, 58.2, 180.5]); settle(bot)
  const plan = swimUnderPlan({ at: w.at, start: feetCell(bot) })
  // close the 4th cell of the route once the body has reached the 2nd
  const c3 = plan.route[3]
  const close = () => { if (bot.trail.length && feetCell(bot)[0] === plan.route[1][0] && feetCell(bot)[2] === plan.route[1][2]) w.edits.set(c3.join(','), 'minecraft:stone') }
  const tick0 = bot.tick; bot.tick = () => { close(); tick0() }
  const res = await runActuator(bot, { plan, oxygen: () => bot.oxygenLevel })
  assert.equal(res.outcome, 'returned', `${res.outcome}: ${res.why}`)
  settle(bot, 40, true)   // the float hold takes the body back (it stands aside only while the swim steers)
  const h = w.at(feetCell(bot)[0], feetCell(bot)[1] + 1, feetCell(bot)[2])
  assert.equal(h.name, 'air', `ended with the head in ${h.name} at ${feetCell(bot)}`)
  assert.equal(bot.health, 20)
})

await ta('B6 THE DRY EXIT CLOSES at the last step -> the firing stops before it; it ends at air (an open surface on the way counts as out), health 20', async () => {
  const w = worldOf(ISOD)
  const bot = simBot(w, [358.5, 58.2, 180.5]); settle(bot)
  const plan = swimUnderPlan({ at: w.at, start: feetCell(bot) })
  const dry = plan.route.at(-1), pen = plan.route.at(-2)
  const tick0 = bot.tick; bot.tick = () => { const f = feetCell(bot); if (f[0] === pen[0] && f[1] === pen[1] && f[2] === pen[2]) w.edits.set(dry.join(','), 'minecraft:stone'); tick0() }
  const res = await runActuator(bot, { plan, oxygen: () => bot.oxygenLevel })
  assert.match(res.why, /no longer dry ground|no longer fits/)
  assert.ok(res.outcome === 'returned' || (res.outcome === 'out' && res.exit === 'open'), `${res.outcome} ${res.exit}: a closed dry exit must end at air (an open surface counts as out)`)
  settle(bot, 40, true)
  const f = feetCell(bot)
  assert.equal(w.at(f[0], f[1] + 1, f[2]).name, 'air', `ended with the head in ${w.at(f[0], f[1] + 1, f[2]).name} at ${f}`)
  assert.equal(bot.health, 20)
})

await ta('B5 A YIELD STOPS STEERING AT ONCE: the drowning rescue taking the body ends the firing with every control released', async () => {
  const w = worldOf(ISOD)
  const bot = simBot(w, [358.5, 58.2, 180.5]); settle(bot)
  const plan = swimUnderPlan({ at: w.at, start: feetCell(bot) })
  let n = 0
  const res = await runActuator(bot, { plan, oxygen: () => bot.oxygenLevel, yieldTo: () => (++n > 20 ? 'the drowning rescue' : null) })
  assert.equal(res.outcome, 'yielded')
  assert.equal(bot.control.forward, false); assert.equal(bot.control.jump, false)
})

// ---- wiring (structural: behaviour cannot reach the reflex closure) -------------------------------------------------
await ta('W1 WIRED: both flood-branch refusal arms try the swim before the back-off; the stand-asides know it steers', () => {
  const r = stripComments(readFileSync(REFLEX, 'utf8'))
  assert.equal((r.match(/await swimUnderTry\('marooned', \(\) => maroonGrant\)/g) || []).length, 1, 'marooned arm')
  assert.equal((r.match(/await swimUnderTry\('entombed', \(\) => entombedGrant\)/g) || []).length, 1, 'entombed arm')
  assert.ok(/owned: rescuing \|\| rampSteering \|\| swimmingUnder,/.test(r), 'the float hold counts it as an owner')
  assert.ok(/if \(!pocketing && !poolEscaping && !swimmingUnder && !dangerMovingNow\(\)\) \{/.test(r), 'the hold never jumps against it')
  assert.ok(/longEnough && !poolEscaping && !swimmingUnder && !dangerMovingNow\(\)/.test(r), 'the stranded ladder stands aside')
  assert.ok(/res = await swimUnder\(bot, \{ plan, alive: \(\) => ownsBody\(grantOf\)\(\) && !airPocketWanted\(\) && !runner\?\.current,\n\s*yieldTo: \(\) => drowningOwnsBody\(\) \|\| arbiterYield\(grantOf\)/.test(r), 'it yields to the drowning rescue')
})

// ---- mutants: each must break the behaviour test that guards it ------------------------------------------------------
await ta('M1 MUTANT KILLED: no DOWN move (the body never sinks under the wall) -> isolated-d has no way out (P1 catches it)', async () => {
  await withMutant(SRC, "      if (dy === 1 && !swimFits(at(x, y + 2, z))) continue\n", "      if (dy === 1 && !swimFits(at(x, y + 2, z))) continue\n      if (dy === -1) continue\n", async m => {
    const r = m.swimUnderPlan({ at: worldOf(ISOD).at, start: ISOD.feet })
    assert.equal(r.ok, false, 'the mutant still found a way: P1 would not catch it')
  })
})

await ta('M2 MUTANT KILLED: no breath bound -> the over-long tunnel is planned (P5 catches it)', async () => {
  await withMutant(SRC, '      if (run > maxWetRun) continue\n', '', async m => {
    const r = m.swimUnderPlan({ at: tunnel(SU_MAX_WET_RUN + 1).at, start: [0, 10, 0], radius: 8 })
    assert.equal(r.ok, true, 'the mutant still refused: P5 would not catch it')
  })
})

await ta('M3 MUTANT KILLED: a sideways stroke outside the height band -> C1 catches it', async () => {
  await withMutant(SRC, '    const go = !arrived && (fitsH || inToColumn) && stroke()\n', '    const go = !arrived && stroke()\n', async m => {
    const s = m.swimUnderStep({ pos: { x: 0.5, y: 10.2, z: 0.5 }, from: [0, 9, 0], to: [1, 9, 0] })
    assert.equal(s.forward, true, 'the mutant still held the stroke: C1 would not catch it')
  })
})

await ta('M4 MUTANT KILLED: no way back (a stopped firing just ends) -> B4 catches it: the head is left in water', async () => {
  await withMutant(SRC, '    const ret = await drive(back, true)\n', "    const ret = { stop: 'mutant: no way back' }\n", async m => {
    const w = worldOf(ISOD)
    const bot = simBot(w, [358.5, 58.2, 180.5]); settle(bot)
    const plan = m.swimUnderPlan({ at: w.at, start: feetCell(bot) })
    const c3 = plan.route[3]
    const tick0 = bot.tick; bot.tick = () => { if (feetCell(bot)[0] === plan.route[1][0] && feetCell(bot)[2] === plan.route[1][2]) w.edits.set(c3.join(','), 'minecraft:stone'); tick0() }
    let done = false, res = null
    const p = m.swimUnder(bot, { plan, oxygen: () => bot.oxygenLevel, now: () => bot.ticks * 50 }).then(r => { done = true; res = r })
    for (let i = 0; i < 2000 && !done; i++) { await new Promise(r => setImmediate(r)); bot.tick() }
    await p
    assert.notEqual(res.outcome, 'returned', 'the mutant still returned: B4 would not catch it')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
