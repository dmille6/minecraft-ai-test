// ESCPOCKET-01 (bots/src/escdead.mjs pocketDigPlan / trapSiteFrom, reflex.mjs columnCapRisk + swimUnderTry, index.mjs trap
// price, worldfacts.mjs reportTrap): THE SELF-SEALED POCKET AND THE WAY BACK IN. Design and evidence:
// docs/reports/escpocket-2026-11-07.md.
//
// LIVE 11-07 (isolated-d-Echo, 358,58,180): escdead-01's wide swim got Delta, Bravo and Echo out at 05:52Z (canary). At
// 07:16:58Z Echo, back in the falling-water column under the pocket at feet y=56, pillared (`_marooned` "an open column
// above"): one dirt went into the column, the body rose into the pocket and the flood guard refused the granite roof. From
// then on, 5 h+: narrow AND wide swim "3 water cells searched", the breach "closed by air at y=62".
// The scene is REAL: test/fixtures/escpocket-isolated-d-358_58_180-1107.json is a read of the 11-07 03:16:21Z nightly backup's
// region copy (read-only; stone omitted = `outside`). LIVE = that cut + dirt at 358,55,180 + air at 358,62,180: it reproduces
// every live row exactly (R1), which is the evidence for where the plug is.
//
// Proven by BEHAVIOUR: the reconstruction; the pocket dig plans the plug and the swim then gets out in prismarine-physics;
// the pocket dig's rules (feet level or below, reach, furniture, gravity, lava, the caller's predicate); the pillar's column-cap
// preflight refuses at the re-entry cell BEFORE placing (the base places the plug); the COMPOSED refusal chain at both cells,
// each rung's remedy executable from there; the trap site, its price on the REAL mineflayer-pathfinder A*, the pool record;
// the wide tier in a known trap. Anchored mutants for each rule; structural asserts only for the reflex closure's wiring.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require = createRequire(import.meta.url)
const Block = require('prismarine-block')('1.21.8')
const mcData = require('minecraft-data')('1.21.8')
const registry = require('prismarine-registry')('1.21.8')
const { Physics, PlayerState } = require('prismarine-physics')
const { Movements, goals } = require('mineflayer-pathfinder')
const AStar = require('mineflayer-pathfinder/lib/astar')
const Move = require('mineflayer-pathfinder/lib/move')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }

const ED = await import('../src/escdead.mjs')
const { pocketDigPlan, pocketDigOk, trapSiteFrom, trapCellSet, trapStepCost, inTrap, swimTierFor, SU_WIDE, PIN_MIN_MS, TRAP_TTL_MS,
  TRAP_STEP_COST, POCKET_DIG_MS, breachPlan, escPocketOn, pocketDigDetail, escPocketModeDetail, pocketDig, POCKET_ABORT_OXYGEN } = ED
const { swimUnderPlan, swimUnder, startCells, exitKind, SU_MAX_WET_RUN } = await import('../src/swimunder.mjs')
const { overheadBreakRisk } = await import('../src/scaffold.mjs')
const { predictedDigMs } = await import('../src/digbudget.mjs')
const RX = await import('../src/reflex.mjs')
const { columnCapRisk, pillarOut } = RX

const SRC = {
  escdead: new URL('../src/escdead.mjs', import.meta.url), reflex: new URL('../src/reflex.mjs', import.meta.url),
  index: new URL('../src/index.mjs', import.meta.url), features: new URL('../src/features.mjs', import.meta.url),
}
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// ---- worlds -------------------------------------------------------------------------------------------------------------
const FX = JSON.parse(readFileSync(new URL('./fixtures/escpocket-isolated-d-358_58_180-1107.json', import.meta.url), 'utf8'))
const PLUG = [358, 55, 180]
const LIVE = { '358,55,180': 'minecraft:dirt', '358,62,180': 'minecraft:air' }       // Echo's pillar dirt; the y62 dirt gone
const PRE = { '358,62,180': 'minecraft:air' }                                         // before the pillar (07:16:58Z)
function worldOf (fx, editsObj = {}) {
  const edits = new Map(Object.entries(editsObj))
  const cache = new Map()
  const stateAt = (x, y, z) => edits.get(`${x},${y},${z}`) ?? fx.cells[`${x},${y},${z}`] ?? fx.outside
  const get = (x, y, z) => {
    const k = `${x},${y},${z}`, st = stateAt(x, y, z), hit = cache.get(k)
    if (hit && hit.st === st) return hit.b
    const b = Block.fromString(st, 0); b.position = new Vec3(x, y, z); cache.set(k, { st, b })
    return b
  }
  return { at: (x, y, z) => get(x, y, z), getBlock: p => get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), edits }
}
function synth (fn) {
  const cache = new Map()
  const get = (x, y, z) => { const k = `${x},${y},${z}`; if (!cache.has(k)) { const b = Block.fromString(fn(x, y, z), 0); b.position = new Vec3(x, y, z); cache.set(k, b) } return cache.get(k) }
  return { at: get, getBlock: p => get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) }
}
const FEET = FX.feet
const EYE = [358.7, 58.2 + 1.62, 180.7]   // the live rows' body: 358.7,58.2,180.7

// a fake bot moved by prismarine-physics (swimunder.test.mjs's simBot)
function simBot (world, feet) {
  const physics = Physics(mcData, world)
  const control = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
  const ls = []
  const bot = {
    version: '1.21.8',
    entity: { position: new Vec3(...feet), velocity: new Vec3(0, 0, 0), onGround: false, isInWater: true, isInLava: false, isInWeb: false,
              isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false, yaw: 0, pitch: 0, effects: {}, attributes: {} },
    inventory: { slots: [] }, jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0, health: 20, air: 300,
    get oxygenLevel () { return Math.round(this.air / 15) },
    setControlState (k, v) { control[k] = v },
    lookAt (p) { const d = p.minus(this.entity.position.offset(0, 1.62, 0)); this.entity.yaw = Math.atan2(-d.x, -d.z); this.entity.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) },
    blockAt (p) { return world.getBlock(p) },
    once (ev, fn) { if (ev === 'physicsTick') ls.push(fn) },
    removeListener (ev, fn) { const i = ls.indexOf(fn); if (i >= 0) ls.splice(i, 1) },
    ticks: 0, control, stopped: 0, stopDigging () { this.stopped++ },
  }
  bot.tick = () => {
    physics.simulatePlayer(new PlayerState(bot, control), world).apply(bot)
    const eye = world.getBlock(bot.entity.position.offset(0, 1.62, 0))
    const wet = /water|bubble|kelp|seagrass/.test(eye.name) || eye.isWaterlogged === true
    bot.air = wet ? Math.max(0, bot.air - 1) : Math.min(300, bot.air + 4)
    if (bot.air === 0 && bot.ticks % 20 === 0) bot.health -= 2
    bot.ticks++
    const q = ls.splice(0); for (const fn of q) fn()
  }
  return bot
}
function settle (bot, n = 60) { bot.control.jump = true; for (let i = 0; i < n; i++) bot.tick(); bot.control.jump = false }
const feetCell = b => [Math.floor(b.entity.position.x), Math.floor(b.entity.position.y + 1e-6), Math.floor(b.entity.position.z)]
async function runSwim (bot, plan, maxTicks = 2000) {
  let done = false, res = null
  const p = swimUnder(bot, { plan, oxygen: () => bot.oxygenLevel, now: () => bot.ticks * 50 }).then(r => { done = true; res = r })
  for (let i = 0; i < maxTicks && !done; i++) { await new Promise(r => setImmediate(r)); bot.tick() }
  if (!done) throw new Error(`actuator still running after ${maxTicks} ticks`)
  await p
  return res
}
// the pillar's fake bot (swimunder.test.mjs pillarBot): records placements, never moves
function pillarBot (world, pos) {
  const placed = []
  const bot = {
    entity: { position: new Vec3(...pos), velocity: new Vec3(0, 0, 0), onGround: false, isInWater: true, yaw: 0, pitch: 0 },
    health: 20, heldItem: null, placed,
    inventory: { items: () => [{ name: 'dirt', count: 64, type: 1 }], emptySlotCount: () => 30, slots: [] },
    blockAt: p => world.getBlock(p),
    async equip (it) { bot.heldItem = it }, async unequip () {}, async placeBlock (b) { placed.push(b.position?.toString?.()) },
    async dig () {}, stopDigging () {}, setControlState () {}, clearControlStates () {}, async look () {}, async lookAt () {},
    pathfinder: { setGoal () {}, stop () {}, goal: null, isMoving: () => false }, once () {}, on () {}, removeListener () {},
  }
  return bot
}
const withEnv = async (k, v, fn) => { const prev = process.env[k]; process.env[k] = v; try { return await fn() } finally { if (prev === undefined) delete process.env[k]; else process.env[k] = prev } }

// ---- R: the reconstruction -------------------------------------------------------------------------------------------------
await t('R1 LIVE = the 11-07 cut + dirt 358,55,180 + air 358,62,180 reproduces EVERY live row (narrow and wide "3 water cells", startCells, the breach)', () => {
  const w = worldOf(FX, LIVE)
  const n = swimUnderPlan({ at: w.at, start: FEET }), wide = swimUnderPlan({ at: w.at, start: FEET, ...SU_WIDE })
  assert.equal(n.reason, 'no way out within 4 cells (3 water cells searched)')
  assert.equal(wide.reason, 'no way out within 8 cells (3 water cells searched)')
  assert.equal(startCells(w.at, FEET), 'feet=water below=water head=air roof=granite N=furnace S=crafting_table E=dirt W=stone')
  // the live text said "closed by air at y=62": the refusal was right, its reason named the air cell; the lid is diorite y63
  assert.equal(breachPlan({ at: w.at, feet: FEET }).reason, 'the water over the roof is closed by diorite at y=63 (one air cell under it): a breach would flood the pocket and open nothing')
})
await t('R2 positive control: the same cut WITHOUT the plug has the canary\'s wide exit (10 cells to dry 356,55,177, as at 05:52Z), and a plug one higher would read "2 water cells", not the live 3', () => {
  const w = worldOf(FX, PRE)
  const wide = swimUnderPlan({ at: w.at, start: FEET, ...SU_WIDE })
  assert.ok(wide.ok, wide.reason); assert.equal(wide.exit, 'dry'); assert.deepEqual(wide.route.at(-1), [356, 55, 177]); assert.equal(wide.route.length, 10)
  assert.match(swimUnderPlan({ at: worldOf(FX, { ...PRE, '358,56,180': 'minecraft:dirt' }).at, start: FEET, ...SU_WIDE }).reason, /\(2 water cells searched\)/)
})

// ---- P: the pocket dig ---------------------------------------------------------------------------------------------------------
await t('P1 POCKET DIG on LIVE (wide tier): the one block dug is Echo\'s own plug (dirt 358,55,180); the swim then reaches dry 356,55,177, head-wet run <= the base bound', () => {
  const w = worldOf(FX, LIVE)
  const pd = pocketDigPlan({ at: w.at, start: FEET, eye: EYE, ...SU_WIDE })
  assert.ok(pd.ok, pd.reason); assert.deepEqual(pd.dig, [PLUG]); assert.deepEqual(pd.names, ['dirt'])
  assert.equal(pd.plan.exit, 'dry'); assert.deepEqual(pd.plan.route.at(-1), [356, 55, 177])
  assert.ok(pd.plan.route.some(c => c.join(',') === PLUG.join(',')), 'the route passes the dug cell')
  assert.ok(pd.plan.wetRun <= SU_MAX_WET_RUN, `wet run ${pd.plan.wetRun}`)
  assert.equal(pocketDigDetail(pd), ' dig=358,55,180:dirt')
})
await t('P2 BEHAVIOUR: after the dig (the column refills: falling water) the swim is re-planned on the world as it is and prismarine-physics swims it to dry ground, health 20, air >= 10', async () => {
  const w = worldOf(FX, { ...LIVE, '358,55,180': 'minecraft:water[level=8]' })
  const bot = simBot(w, [358.5, 58.2, 180.5]); settle(bot)
  assert.deepEqual(feetCell(bot), FEET)
  const plan = swimUnderPlan({ at: w.at, start: feetCell(bot), ...SU_WIDE })
  assert.ok(plan.ok, plan.reason)
  const res = await runSwim(bot, plan)
  assert.equal(res.outcome, 'out', `${res.outcome}: ${res.why} at ${feetCell(bot)}`)
  assert.equal(exitKind(w.at, feetCell(bot)), 'dry'); assert.equal(bot.health, 20); assert.ok(res.minAir >= 10, `min air ${res.minAir}`)
})
await t('P3 the dig is reachable and fits its bound from the floating stance: eye 4.33 from the plug centre (<= 4.5), dirt by hand floating <= POCKET_DIG_MS, a pocket dig\'s kind', () => {
  const w = worldOf(FX, LIVE)
  const d = Math.hypot(PLUG[0] + 0.5 - EYE[0], PLUG[1] + 0.5 - EYE[1], PLUG[2] + 0.5 - EYE[2])
  assert.ok(d <= 4.5 && d > 4.0, `reach ${d.toFixed(2)}`)
  const ms = predictedDigMs(w.at(...PLUG), null, { notOnGround: true, inWater: false })
  assert.ok(Number.isFinite(ms) && ms <= POCKET_DIG_MS, `dig ${ms} ms`)
  assert.equal(pocketDigOk(w.at(...PLUG)), true)
})
// drive an async actuator over the physics ticks
async function drive (bot, promiseOf, maxTicks = 1500, each = () => {}) {
  let done = false, res = null
  const p = promiseOf().then(r => { done = true; res = r })
  for (let i = 0; i < maxTicks && !done; i++) { await new Promise(r => setImmediate(r)); bot.tick(); each(bot) }
  if (!done) throw new Error(`actuator still running after ${maxTicks} ticks`)
  await p
  return res
}
await t('P6 BEHAVIOUR (prismarine-physics): the pocket dig on LIVE floats the body in place for a 3.75 s swing (the head never under), the plug becomes falling water, and the re-planned swim reaches dry 356,55,177', async () => {
  const w = worldOf(FX, LIVE)
  const bot = simBot(w, [358.5, 58.2, 180.5]); settle(bot)
  const pd = pocketDigPlan({ at: w.at, start: feetCell(bot), eye: [bot.entity.position.x, bot.entity.position.y + 1.62, bot.entity.position.z], ...SU_WIDE })
  assert.deepEqual(pd.dig, [PLUG])
  let wetTicks = 0, minFeet = 99, calls = 0
  const dig = (b) => { calls++; const t0 = bot.ticks; return new Promise(resolve => { const poll = () => { if (bot.ticks - t0 >= 75) { w.edits.set(PLUG.join(','), 'minecraft:water[level=8]'); resolve() } else bot.once('physicsTick', poll) }; poll() }) }
  const r = await drive(bot, () => pocketDig(bot, { pd, dig, oxygen: () => bot.oxygenLevel }), 400, b => {
    const eye = w.getBlock(b.entity.position.offset(0, 1.62, 0)); if (/water/.test(eye.name)) wetTicks++; minFeet = Math.min(minFeet, b.entity.position.y)
  })
  assert.equal(r.outcome, 'dug', r.why); assert.equal(r.dug, 1); assert.equal(calls, 1)
  assert.equal(wetTicks, 0, `the head was under water ${wetTicks} ticks (lowest feet y ${minFeet.toFixed(2)})`)
  assert.ok(r.minAir >= 19, `min air ${r.minAir}`); assert.equal(bot.control.jump, false, 'jump released after the dig')
  const plan = swimUnderPlan({ at: w.at, start: feetCell(bot), ...SU_WIDE })
  assert.ok(plan.ok, plan.reason)
  const s2 = await runSwim(bot, plan)
  assert.equal(s2.outcome, 'out', `${s2.why} at ${feetCell(bot)}`); assert.deepEqual(feetCell(bot), [356, 55, 177]); assert.equal(bot.health, 20)
})
await t('P7 OWNERSHIP: a yield mid-swing stops the dig and ends the firing (jump left to the new owner); a yield after the first of two swings never starts the second; the swing gets lost() to check around its equip', async () => {
  const w = worldOf(FX, LIVE)
  const bot = simBot(w, [358.5, 58.2, 180.5]); settle(bot)
  let owned = true, got = null
  const pd = { dig: [PLUG], plan: { route: [] } }
  const r = await drive(bot, () => pocketDig(bot, { pd, alive: () => owned, dig: (b, lost) => { got = lost; return new Promise(() => {}) } }), 200, b => { if (b.ticks > 20) owned = false })
  assert.equal(r.outcome, 'yielded'); assert.equal(bot.stopped, 1); assert.equal(typeof got, 'function'); assert.equal(bot.control.jump, true, 'the new owner\'s controls are not touched')
  // two cells: the first swing completes, ownership is lost, the second never starts
  const two = synth((x, y, z) => (x === 0 && z === 0) ? (y === 10 ? 'minecraft:water[level=0]' : y === 11 ? 'minecraft:air' : 'minecraft:stone') : 'minecraft:dirt')
  const b2 = { blockAt: p => two.getBlock(p), setControlState () {}, once (e, fn) { setTimeout(fn, 1) }, removeListener () {}, stopDigging () {} }
  let calls = 0, own2 = true
  const r2 = await pocketDig(b2, { pd: { dig: [[1, 9, 0], [1, 10, 0]] }, alive: () => own2, dig: async () => { calls++; own2 = false } })
  assert.equal(r2.outcome, 'yielded'); assert.equal(calls, 1)
  // the new owner's own dig is never cancelled: ownership moves and another dig target is current -> no stopDigging
  const b3 = { blockAt: p => two.getBlock(p), setControlState () {}, once (e, fn) { setTimeout(fn, 1) }, removeListener () {}, stops: 0, stopDigging () { this.stops++ }, targetDigBlock: null }
  let own3 = true, n = 0
  const r3 = await pocketDig(b3, { pd: { dig: [[1, 9, 0]] }, alive: () => { if (++n > 2) { own3 = false; b3.targetDigBlock = { position: { x: 5, y: 5, z: 5 } } } return own3 }, dig: () => new Promise(() => {}) })
  assert.equal(r3.outcome, 'yielded'); assert.equal(b3.stops, 0, 'the new owner\'s dig was stopped')
})
await t('P8 AIR: a swing that runs while the air falls under POCKET_ABORT_OXYGEN is stopped and the firing fails (the swim never starts on a short breath)', async () => {
  const two = synth((x, y, z) => (x === 0 && z === 0) ? (y === 10 ? 'minecraft:water[level=0]' : y === 11 ? 'minecraft:air' : 'minecraft:stone') : 'minecraft:dirt')
  let ox = 20, stopped = 0
  const b = { blockAt: p => two.getBlock(p), setControlState () {}, once (e, fn) { ox -= 1; setTimeout(fn, 1) }, removeListener () {}, stopDigging () { stopped++ } }
  const r = await pocketDig(b, { pd: { dig: [[1, 9, 0]] }, oxygen: () => ox, dig: () => new Promise(() => {}) })
  assert.equal(r.outcome, 'failed'); assert.match(r.why, /air \d+ of 20/); assert.equal(stopped, 1); assert.ok(ox < POCKET_ABORT_OXYGEN)
})
// a synthetic pocket: feet water at y=10 (x=0,z=0), head air, stone everywhere; the way out is a water room at x=2 behind ONE
// block at x=1 (feet level) -- or, in variants, behind a block at head height, far away, or of a kind never dug
const room = (opener, { y = 10, roomX = 2 } = {}) => synth((x, yy, z) => {
  if (x === 0 && z === 0) return yy === 10 ? 'minecraft:water[level=0]' : yy === 11 ? 'minecraft:air' : 'minecraft:stone'
  if (x >= roomX && x <= roomX + 1 && z === 0) {   // the exit: a 2-cell water room open to air above (an 'open' surface)
    if (yy >= y && yy <= y + 1) return 'minecraft:water[level=0]'
    if (yy >= y + 2 && yy <= y + 4) return 'minecraft:air'
  }
  if (x > 0 && x < roomX && z === 0 && (yy === y || yy === y + 1)) return opener(x, yy)
  return 'minecraft:stone'
})
await t('P4 RULES: a feet-level opening is dug (both cells when the head cell is a block too, never above the start\'s feet: the pocket\'s air is the breath)', () => {
  // the opening at feet level y=10 with its head cell y=11: y11 is ABOVE the start's feet -> never dug -> refused
  const head = room(() => 'minecraft:dirt')
  const r = pocketDigPlan({ at: head.at, start: [0, 10, 0], ...SU_WIDE })
  assert.equal(r.ok, false, `dug ${JSON.stringify(r.dig)}`); assert.match(r.reason, /no pocket dig opens one/)
  // the same opening one level DOWN (feet y=9 -> head y=10 = the start's feet level): both cells dug
  const low = synth((x, y, z) => {
    if (x === 0 && z === 0) return y === 9 || y === 10 ? 'minecraft:water[level=0]' : y === 11 ? 'minecraft:air' : 'minecraft:stone'
    if (x === 1 && z === 0 && (y === 9 || y === 10)) return 'minecraft:dirt'
    if (x >= 2 && x <= 3 && z === 0) return y >= 9 && y <= 10 ? 'minecraft:water[level=0]' : y >= 11 && y <= 13 ? 'minecraft:air' : 'minecraft:stone'
    return 'minecraft:stone'
  })
  const ok = pocketDigPlan({ at: low.at, start: [0, 10, 0], ...SU_WIDE })
  assert.ok(ok.ok, ok.reason); assert.deepEqual(ok.dig, [[1, 9, 0], [1, 10, 0]])
})
await t('P5 RULES: never furniture, a falling block, a block beside lava, or one the caller refuses; never out of reach', () => {
  const low = (name, lava = false) => synth((x, y, z) => {
    if (lava && x === 1 && z === 1 && y === 9) return 'minecraft:lava[level=0]'
    if (x === 0 && z === 0) return y === 9 || y === 10 ? 'minecraft:water[level=0]' : y === 11 ? 'minecraft:air' : 'minecraft:stone'
    if (x === 1 && z === 0 && y === 9) return name
    if (x === 1 && z === 0 && y === 10) return 'minecraft:water[level=0]'
    if (x >= 2 && x <= 3 && z === 0) return y >= 9 && y <= 10 ? 'minecraft:water[level=0]' : y >= 11 && y <= 13 ? 'minecraft:air' : 'minecraft:stone'
    return 'minecraft:stone'
  })
  // positive control: a dirt opener at (1,9,0) under water (1,10,0) is dug -- so each refusal below is the rule, not the world
  const ctl = pocketDigPlan({ at: low('minecraft:dirt').at, start: [0, 10, 0], ...SU_WIDE })
  assert.ok(ctl.ok && ctl.dig?.length >= 1, ctl.reason)
  for (const n of ['minecraft:furnace[facing=north,lit=false]', 'minecraft:crafting_table', 'minecraft:chest[facing=north,type=single,waterlogged=false]', 'minecraft:gravel', 'minecraft:bedrock']) {
    const r = pocketDigPlan({ at: low(n).at, start: [0, 10, 0], ...SU_WIDE })
    assert.ok(!r.ok || !(r.dig ?? []).some(c => c.join(',') === '1,9,0'), `${n} dug`)
  }
  const lv = pocketDigPlan({ at: low('minecraft:dirt', true).at, start: [0, 10, 0], ...SU_WIDE })
  assert.ok(!lv.ok || !(lv.dig ?? []).some(c => c.join(',') === '1,9,0'), 'a block with lava on a face is never dug')
  assert.equal(pocketDigPlan({ at: low('minecraft:dirt').at, start: [0, 10, 0], digOk: () => false, ...SU_WIDE }).ok, false, 'the caller\'s predicate (the guard, the dig time) decides too')
  assert.equal(pocketDigPlan({ at: low('minecraft:dirt').at, start: [0, 10, 0], eye: [0.5, 30, 0.5], ...SU_WIDE }).ok, false, 'out of reach of the eye')
})

// ---- C: the pillar's column cap and the composed chain --------------------------------------------------------------------
const REENTRY = [358.5, 56.2, 180.5]   // live 07:16:58.033Z `_marooned` pos
await t('C1 THE COLUMN CAP: from the re-entry cell (feet y=56, water) the open column\'s cap is the granite at y=60 with water over it -> refused; a dry start and a cap at feet+2 are the existing checks\' (null)', () => {
  const w = worldOf(FX, PRE)
  const r = columnCapRisk({ at: w.at, feet: [358, 56, 180], maxUp: 24 })
  assert.ok(r, 'refused'); assert.deepEqual(r.cap, [358, 60, 180]); assert.match(r.reason, /liquid above/)
  assert.equal(r.reason, overheadBreakRisk({ at: (dx, dy, dz) => w.at(358 + dx, 60 + dy, 180 + dz), submerged: false }), 'the same reason the climb gets at the top')
  assert.equal(columnCapRisk({ at: w.at, feet: [358, 58, 180], maxUp: 24 }), null, 'cap at feet+2: restRoofFloodRisk / the head0 check own it')
  const dry = synth((x, y, z) => (x === 0 && z === 0 && y >= 10 && y <= 13) ? 'minecraft:air' : (x === 0 && z === 0 && y === 15) ? 'minecraft:water[level=0]' : 'minecraft:stone')
  assert.equal(columnCapRisk({ at: dry.at, feet: [0, 10, 0], maxUp: 24 }), null, 'a dry start is unchanged')
  const open = synth((x, y, z) => (x === 0 && z === 0 && y >= 10 && y <= 11) ? 'minecraft:water[level=0]' : (x === 0 && z === 0 && y >= 12 && y <= 13) ? 'minecraft:air' : (x === 0 && z === 0 && y === 14) ? 'minecraft:stone' : 'minecraft:stone')
  assert.equal(columnCapRisk({ at: open.at, feet: [0, 10, 0], maxUp: 24 }), null, 'positive control: a dry cap (stone over stone) is no refusal')
})
await t('C1b A SIDE WAY OUT BELOW THE CAP is the climb\'s (it stops there): a wet shaft with a dry side passage 3 up and a wet cap 6 up is NOT refused; the same shaft without the passage is', () => {
  const shaft = (passage) => synth((x, y, z) => {
    if (x === 0 && z === 0) return y <= 9 ? 'minecraft:stone' : y <= 11 ? 'minecraft:water[level=0]' : y <= 15 ? 'minecraft:air' : y === 16 ? 'minecraft:stone' : y === 17 ? 'minecraft:water[level=0]' : 'minecraft:stone'
    if (passage && x === 1 && z === 0 && (y === 13 || y === 14)) return 'minecraft:air'
    return 'minecraft:stone'
  })
  assert.equal(columnCapRisk({ at: shaft(true).at, feet: [0, 10, 0], maxUp: 24 }), null)
  assert.ok(columnCapRisk({ at: shaft(false).at, feet: [0, 10, 0], maxUp: 24 }), 'positive control: no passage -> refused')
})
await t('C2 BEHAVIOUR: the pillar at the re-entry cell is refused BEFORE it places anything; the base (ESCPOCKET=0) places the block that became the plug', async () => {
  const w = worldOf(FX, PRE)
  const bot = pillarBot(w, REENTRY)
  const out = await Promise.race([pillarOut(bot, 24), new Promise(r => setTimeout(() => r('timeout'), 3000))])
  assert.equal(out, 'flood_risk'); assert.equal(bot.placed.length, 0, `placed ${bot.placed}`)
  await withEnv('ESCPOCKET', '0', async () => {
    const b0 = pillarBot(w, REENTRY)
    await Promise.race([pillarOut(b0, 24), new Promise(r => setTimeout(() => r('timeout'), 3000))])
    assert.ok(b0.placed.length >= 1, 'the base placed nothing: the live seal would not be reproduced')
  })
})
await t('C3 COMPOSED CHAIN at the re-entry cell: the cap refuses the pillar, and the next rung (the swim, narrow, from y=56) has a way out -- the remedy is executable from there', () => {
  const w = worldOf(FX, PRE)
  assert.ok(columnCapRisk({ at: w.at, feet: [358, 56, 180], maxUp: 24 }))
  const s = swimUnderPlan({ at: w.at, start: [358, 56, 180] })
  assert.ok(s.ok, s.reason); assert.equal(s.exit, 'dry')
})
await t('C4 COMPOSED CHAIN in the sealed pocket (LIVE): flood guard, narrow swim, wide swim, breach all refuse; the pocket dig plans, and its remedy is executable from the cell (head in air, in reach, in bound)', () => {
  const w = worldOf(FX, LIVE)
  assert.match(overheadBreakRisk({ at: (dx, dy, dz) => w.at(358 + dx, 60 + dy, 180 + dz), submerged: false }), /liquid above/, 'the flood guard')
  assert.equal(swimUnderPlan({ at: w.at, start: FEET }).ok, false, 'narrow swim')
  assert.equal(swimUnderPlan({ at: w.at, start: FEET, ...SU_WIDE }).ok, false, 'wide swim')
  assert.equal(breachPlan({ at: w.at, feet: FEET }).ok, false, 'breach')
  assert.equal(w.at(358, 59, 180).name, 'air', 'the head is in air at the start: the dig is done breathing')
  const pd = pocketDigPlan({ at: w.at, start: FEET, eye: EYE, ...SU_WIDE })
  assert.ok(pd.ok); assert.ok(pd.dig.every(c => c[1] <= FEET[1]), 'no dig above the feet')
  // the tier: a 30-min pin, or a recorded trap at once
  assert.deepEqual(swimTierFor(PIN_MIN_MS, { known: false, on: true, pocketOn: true, minMs: PIN_MIN_MS }), SU_WIDE)
  assert.deepEqual(swimTierFor(0, { known: true, on: true, pocketOn: true, minMs: PIN_MIN_MS }), SU_WIDE)
})

// ---- T: the trap site --------------------------------------------------------------------------------------------------------
await t('T1 TRAP SITE from the canary escape: the pocket\'s feet + head and the column it rose in by (358,54..59,180), not the way out; 12 h TTL; 101 per cell; never for a body inside', () => {
  const w = worldOf(FX, PRE)
  const plan = swimUnderPlan({ at: w.at, start: FEET, ...SU_WIDE })
  const s = trapSiteFrom({ start: FEET, route: plan.route, via: 'swim', by: 'isolated-d-Echo', now: 1000 })
  assert.deepEqual(s.cells, ['358,54,180', '358,55,180', '358,56,180', '358,57,180', '358,58,180', '358,59,180'])
  const set = trapCellSet([s], 1000 + TRAP_TTL_MS - 1)
  assert.equal(set.size, 6); assert.equal(trapCellSet([s], 1000 + TRAP_TTL_MS + 1).size, 0, 'gone after 12 h')
  const blk = (x, y, z) => ({ position: { x, y, z } })
  assert.equal(trapStepCost(set, blk(358, 56, 180)), TRAP_STEP_COST); assert.equal(TRAP_STEP_COST > 100, true)
  assert.equal(trapStepCost(set, blk(357, 54, 179)), 0, 'the way out is not priced')
  assert.equal(trapStepCost(set, blk(358, 56, 180), true), 0, 'a body inside is never priced out')
  assert.equal(inTrap(set, FEET), true); assert.equal(inTrap(set, [356, 55, 177]), false)
})
await t('T2 THE REAL A* (mineflayer-pathfinder 2.4.5 Movements + AStar) on the cut: from the lake under the pocket the base\'s best path ends IN the column (and the library walks a noPath partial path, holding jump in water: the body rises into the pocket); with the trap price no node is a trap cell; positive control: the swim exit is still reached', () => {
  const w = worldOf(FX, PRE)
  const s = trapSiteFrom({ start: FEET, route: swimUnderPlan({ at: w.at, start: FEET, ...SU_WIDE }).route })
  const set = trapCellSet([s], Date.now())
  const movesFor = (priced) => {
    const bot = { registry, version: '1.21.8', blockAt: p => w.getBlock(p), entity: { position: new Vec3(358.5, 52.4, 178.5), effects: {} }, entities: {},
      inventory: { items: () => [] }, pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
    const m = new Movements(bot); m.canDig = false; m.allowParkour = false
    if (priced) m.exclusionAreasStep = [...(m.exclusionAreasStep ?? []), b => trapStepCost(set, b)]
    return m
  }
  const plan = (m, from, goal) => { const a = new AStar(new Move(...from, 0, 0), m, goal, 10_000, 40, -1); let r = a.compute(); while (r.status === 'partial') r = a.compute(); return r }
  const into = r => (r.path ?? []).filter(n => set.has(`${n.x},${n.y},${n.z}`))
  // the lake cells both bots were afloat in before they were carried in (Bravo 05:53:24Z 358.4,52.4,178; Echo 07:16:52Z 358.7,52.5,177.5)
  for (const from of [[358, 52, 178], [359, 52, 177]]) {
    const base = plan(movesFor(false), from, new goals.GoalBlock(358, 57, 180))
    assert.ok(into(base).length > 0, `from ${from}: the base path never enters the column (${base.status})`)
    const priced = plan(movesFor(true), from, new goals.GoalBlock(358, 57, 180))
    assert.equal(into(priced).length, 0, `from ${from}: entered ${JSON.stringify(into(priced))}`)
  }
  assert.ok(readFileSync(require.resolve('mineflayer-pathfinder/index.js'), 'utf8').includes("if (bot.entity.isInWater) {\n      bot.setControlState('jump', true)"), 'the library holds jump in water (the rise)')
  const ctl = plan(movesFor(true), [356, 55, 177], new goals.GoalBlock(357, 54, 179))
  assert.equal(ctl.status, 'success', `positive control ${ctl.status}`); assert.equal(into(ctl).length, 0)
})
await t('T3 THE POOL RECORD (worldfacts.mjs): reportTrap writes one site per pocket, a later escape renews it and merges cells, trapSites drops it after 12 h; death sites and prompt lines never see it', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'escpocket-'))
  try {
    const { WorldFacts } = await import('../src/worldfacts.mjs')
    const wf = new WorldFacts(path.join(dir, 'world-facts.json'))
    const s = trapSiteFrom({ start: FEET, route: [[358, 57, 180], [358, 56, 180]], via: 'swim', by: 'a' })
    assert.ok(wf.reportTrap(s, 'a'))
    assert.ok(wf.reportTrap(trapSiteFrom({ start: FEET, route: [[358, 54, 180]], via: 'pocket_dig' }), 'b'))
    const fresh = new WorldFacts(path.join(dir, 'world-facts.json'))
    const got = fresh.trapSites()
    assert.equal(got.length, 1); assert.deepEqual(got[0].by, ['a', 'b']); assert.ok(got[0].cells.includes('358,54,180') && got[0].cells.includes('358,59,180'))
    assert.equal(fresh.trapSites(Date.now() + TRAP_TTL_MS + 60_000).length, 0)
    assert.equal(fresh.deathSites().length, 0); assert.equal(fresh.promptLines({ x: 358, y: 58, z: 180 }).some(l => /trap/.test(l)), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
await t('T4 THE SWITCH: ESCPOCKET=0 -> no wide tier from a trap, the licence row says on=0; ESCDEAD=0 -> no wide tier at all', () => {
  assert.equal(escPocketOn({ ESCPOCKET: '0' }), false); assert.equal(escPocketOn({}), true)
  assert.deepEqual(swimTierFor(0, { known: true, on: true, pocketOn: false, minMs: PIN_MIN_MS }), {})
  assert.deepEqual(swimTierFor(10 * PIN_MIN_MS, { known: true, on: false, pocketOn: true, minMs: PIN_MIN_MS }), {})
  assert.match(escPocketModeDetail({ ESCPOCKET: '0' }), /^on=0 /); assert.match(escPocketModeDetail({}), /^on=1 .*trap_ttl_h=12 trap_cost=101 pillar_cap=1$/)
})

// ---- W: wiring (structural: the reflex closure and index.mjs's profile are not reachable by behaviour) ---------------------
await t('W1 WIRED: the pocket dig only on the wide tier with the head in air; its actuator before the swim; the trap recorded on every way out; the pillar\'s cap preflight; the price in the shared step entry; the licence row', () => {
  const r = stripComments(readFileSync(SRC.reflex, 'utf8'))
  assert.equal(r.split('if (!plan.ok && wide.radius && pocketOn && headAirNow) {').length, 2)
  assert.equal(r.split('if (pocket) res = await pocketDigRun(pocket, {').length, 2)
  assert.equal(r.split("if (res.outcome === 'out' && pocketOn) recordTrap(trapSiteFrom({ start, route: plan.route, via: pocket ? 'pocket_dig' : 'swim', by: bot.username }))").length, 2)
  assert.equal(r.split('if (escPocketOn() && capFloodRisk(bot, maxBlocks)) return FLOOD_RISK').length, 2)
  assert.equal(r.split('const wide = swimTierFor(pinnedMsOf(bot), { known: trapHere })').length, 2)
  const i = stripComments(readFileSync(SRC.index, 'utf8'))
  assert.equal(i.split('const deathSitePenalty = (block) => deathSiteStepCost(deathSites, block) + keepoutStepPenalty(block) + trapPenalty(block)').length, 2)
  assert.ok(/waterMoves\.exclusionAreasStep = \[deathSitePenalty, wellPenalty\]/.test(i), 'the water profile keeps the death entry, so the trap price too')
  const f = stripComments(readFileSync(SRC.features, 'utf8'))
  assert.equal(f.split("kind: 'escpocket_mode'").length, 2)
})

// ---- M: mutants ------------------------------------------------------------------------------------------------------------
await t('M1 MUTANT KILLED: the pocket dig without the feet-level rule digs the head-height cell (P4 catches it)', async () => {
  await withMutant(SRC.escdead, '  const may = c => { if (c[1] > sy || !inReach(c)) return false;', '  const may = c => { if (!inReach(c)) return false;', async m => {
    const r = m.pocketDigPlan({ at: room(() => 'minecraft:dirt').at, start: [0, 10, 0], ...m.SU_WIDE })
    assert.equal(r.ok, true, 'the mutant still refused')
  })
})
await t('M2 MUTANT KILLED: the pocket dig without the reach rule plans a dig the arm cannot make (P5 catches it)', async () => {
  await withMutant(SRC.escdead, '  const inReach = c => Math.hypot(c[0] + 0.5 - e[0], c[1] + 0.5 - e[1], c[2] + 0.5 - e[2]) <= reach', '  const inReach = c => true', async m => {
    const w = worldOf(FX, LIVE)
    assert.equal(m.pocketDigPlan({ at: w.at, start: FEET, eye: [358.5, 90, 180.5], ...m.SU_WIDE }).ok, true, 'the mutant still refused')
  })
})
await t('M3 MUTANT KILLED: pocketDigOk without the furniture rule digs the furnace (P5 catches it)', async () => {
  await withMutant(SRC.escdead, ' || FURNITURE.test(n)', '', async m => {
    const b = Block.fromString('minecraft:furnace[facing=north,lit=false]', 0)
    assert.equal(m.pocketDigOk(b), true, 'the mutant still refused')
  })
})
await t('M4 MUTANT KILLED: pillarOut without the cap preflight places the plug at the re-entry cell (C2 catches it)', async () => {
  await withMutant(SRC.reflex, '    if (escPocketOn() && capFloodRisk(bot, maxBlocks)) return FLOOD_RISK\n', '', async m => {
    const bot = pillarBot(worldOf(FX, PRE), REENTRY)
    await Promise.race([m.pillarOut(bot, 24), new Promise(r => setTimeout(() => r('timeout'), 3000))])
    assert.ok(bot.placed.length >= 1, 'the mutant still refused before placing')
  })
})
await t('M5 MUTANT KILLED: swimTierFor ignoring the trap record waits the 30-min pin (C4 catches it)', async () => {
  await withMutant(SRC.escdead, '  if (on && pocketOn && known) return SU_WIDE\n', '', async m => {
    assert.deepEqual(m.swimTierFor(0, { known: true, on: true, pocketOn: true, minMs: m.PIN_MIN_MS }), {})
  })
})
await t('M6 MUTANT KILLED: a trap site without the column cells leaves the way back in unpriced (T1 catches it)', async () => {
  await withMutant(SRC.escdead, '    for (let cy = c[1]; cy < y; cy++) cells.add(`${x},${cy},${z}`)\n', '', async m => {
    const s = m.trapSiteFrom({ start: FEET, route: [[358, 57, 180], [358, 54, 180]] })
    assert.equal(s.cells.includes('358,56,180'), false)
  })
})
await t('M7 MUTANT KILLED: the column cap read at feet+2 too refuses where the base\'s own checks pass (C1 catches it)', async () => {
  await withMutant(SRC.reflex, '    if (cy <= y + 2) return null\n', '', async m => {
    const w = worldOf(FX, PRE)
    assert.notEqual(m.columnCapRisk({ at: w.at, feet: [358, 58, 180], maxUp: 24 }), null)
  })
})

await t('M8 MUTANT KILLED: the pocket dig without the float hold lets the body sink under during the swing (P6 catches it)', async () => {
  await withMutant(SRC.escdead, "      set('jump', true)\n      let done = false, err = null", "      let done = false, err = null", async m => {
    const w = worldOf(FX, LIVE)
    const bot = simBot(w, [358.5, 58.2, 180.5]); settle(bot)
    let wet = 0
    const dig = () => { const t0 = bot.ticks; return new Promise(resolve => { const poll = () => { if (bot.ticks - t0 >= 75) resolve(); else bot.once('physicsTick', poll) }; poll() }) }
    await drive(bot, () => m.pocketDig(bot, { pd: { dig: [PLUG] }, dig, oxygen: () => bot.oxygenLevel }), 400, b => { if (/water/.test(w.getBlock(b.entity.position.offset(0, 1.62, 0)).name)) wet++ })
    assert.ok(wet > 0, 'the mutant body kept its head in air: P6 would not catch it')
  })
})
await t('M9 MUTANT KILLED: the cap preflight without the side-exit read refuses a climb that steps off below the cap (C1b catches it)', async () => {
  await withMutant(SRC.reflex, '    for (let fy = y; fy <= cy - 2; fy++) if (sideOut(fy)) return null\n', '', async m => {
    const shaft = synth((x, y, z) => (x === 0 && z === 0) ? (y <= 9 ? 'minecraft:stone' : y <= 11 ? 'minecraft:water[level=0]' : y <= 15 ? 'minecraft:air' : y === 16 ? 'minecraft:stone' : y === 17 ? 'minecraft:water[level=0]' : 'minecraft:stone') : (x === 1 && z === 0 && (y === 13 || y === 14)) ? 'minecraft:air' : 'minecraft:stone')
    assert.notEqual(m.columnCapRisk({ at: shaft.at, feet: [0, 10, 0], maxUp: 24 }), null)
  })
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
