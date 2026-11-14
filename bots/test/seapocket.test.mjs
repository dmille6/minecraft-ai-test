// SEAPOCKET-01 (bots/src/escdead.mjs longBreathPlan, reflex.mjs swimUnderTry): THE OPEN-SEA BUBBLE. Design and evidence:
// docs/reports/seapocket-2026-11-09.md. LIVE 11-09 placebo-d-Bravo pinned 4 h+ at 46,59,69: feet in the open sea, head in a
// one-cell bubble its own air-pocket rescue made (4 head-level seals + the cobble over its head dug), roof cobble with water
// beside it and dirt over it. The scene is REAL: test/fixtures/seapocket-placebo-d-46_59_69-1109.json is a read of the 11-09
// 03:16:22Z backup's region copy; LIVE = that + the five edits, and reproduces the live rows (92 / 110 water cells).
// (helpers copied from escpocket.test.mjs) ESCPOCKET-01 (bots/src/escdead.mjs pocketDigPlan / trapSiteFrom, reflex.mjs columnCapRisk + swimUnderTry, index.mjs trap
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
  TRAP_STEP_COST, POCKET_DIG_MS, breachPlan, escPocketOn, pocketDigDetail, escPocketModeDetail, pocketDig, POCKET_ABORT_OXYGEN, longBreathPlan, SU_LONG_WET_RUN, seaPocketModeDetail } = ED
const { swimUnderPlan, swimUnder, startCells, exitKind, SU_MAX_WET_RUN, swimUnderAbort, SU_BACK_TICKS, SU_BACK_RESERVE } = await import('../src/swimunder.mjs')
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


// ---- the sea pocket ------------------------------------------------------------------------------------------------------
const PD = JSON.parse(readFileSync(new URL('./fixtures/seapocket-placebo-d-46_59_69-1109.json', import.meta.url), 'utf8'))
for (const k of Object.keys(PD.cells)) if (!PD.cells[k].includes(':')) PD.cells[k] = 'minecraft:' + PD.cells[k]
const PF = PD.feet
const CB = 'minecraft:cobblestone'
const SEA = { '46,60,69': 'minecraft:air', '45,60,69': CB, '47,60,69': CB, '46,60,68': CB, '46,60,70': CB }   // seal=4 + the dug cobble (11:07Z)
await t('S1 LIVE = the 11-09 cut + the air-pocket rescue\'s 4 seals and dug cobble reproduces the live rows (narrow 92, wide 110 water cells; startCells; the breach)', () => {
  const w = worldOf(PD, SEA)
  assert.equal(swimUnderPlan({ at: w.at, start: PF }).reason, 'no way out within 4 cells (92 water cells searched)')
  assert.equal(swimUnderPlan({ at: w.at, start: PF, ...SU_WIDE }).reason, 'no way out within 8 cells (110 water cells searched)')
  assert.equal(startCells(w.at, PF), 'feet=water below=water head=air roof=cobblestone N=water S=water E=water W=water')
  assert.match(breachPlan({ at: w.at, feet: PF }).reason, /no water over the roof/)
  assert.equal(w.at(46, 63, 69).name, 'air'); assert.equal(w.at(46, 62, 69).name, 'dirt')
})
await t('S2 positive control: without the rescue\'s four head-level seals (the 03:16 cut) the planner finds this sea\'s way out within 3 head-wet cells -- the seals are what made it 6, so the zero in S1 is the world, not the planner', () => {
  const p = swimUnderPlan({ at: worldOf(PD).at, start: PF })
  assert.ok(p.ok, p.reason); assert.ok(p.wetRun <= 3, `run ${p.wetRun}`)
})
await t('S3 THE LONG-BREATH TIER on LIVE: 9 cells to dry 46,63,69 (onto the dirt), head-wet run 6 = the long bound; the base bound (5) refuses it', () => {
  const w = worldOf(PD, SEA)
  const lb = longBreathPlan({ at: w.at, start: PF, tier: SU_WIDE, on: true })
  assert.ok(lb.ok, lb.reason); assert.equal(lb.exit, 'dry'); assert.deepEqual(lb.route.at(-1), [46, 63, 69])
  assert.equal(lb.wetRun, 6); assert.ok(lb.wetRun > SU_MAX_WET_RUN && lb.wetRun <= SU_LONG_WET_RUN)
  assert.equal(longBreathPlan({ at: w.at, start: PF, tier: {}, on: true }), null, 'never on the narrow tier')
  assert.equal(longBreathPlan({ at: w.at, start: PF, tier: SU_WIDE, on: false }), null, 'ESCPOCKET=0')
})
await t('S4 BEHAVIOUR (prismarine-physics): the body swims the 6-wet-cell route out of the bubble and stands on the dirt in the air, health 20, air never under 10', async () => {
  const w = worldOf(PD, SEA)
  const bot = simBot(w, [46.5, 59.2, 69.5]); settle(bot)
  assert.deepEqual(feetCell(bot), PF)
  const plan = longBreathPlan({ at: w.at, start: feetCell(bot), tier: SU_WIDE, on: true })
  const res = await runSwim(bot, plan)
  assert.equal(res.outcome, 'out', `${res.outcome}: ${res.why} at ${feetCell(bot)}`)
  assert.deepEqual(feetCell(bot), [46, 63, 69]); assert.equal(bot.health, 20); assert.ok(res.minAir >= 10, `min air ${res.minAir}`); console.log(`        (min air ${res.minAir}, ${bot.ticks} ticks)`)
})
await t('S5 COMPOSED CHAIN at 46,59,69 (LIVE): the flood guard (water beside the roof), the breach, the narrow and wide swims and the pocket dig all refuse; the long-breath swim plans, from a cell with the head in air', () => {
  const w = worldOf(PD, SEA)
  assert.match(overheadBreakRisk({ at: (dx, dy, dz) => w.at(46 + dx, 61 + dy, 69 + dz), submerged: false }), /liquid beside/)
  assert.equal(breachPlan({ at: w.at, feet: PF }).ok, false)
  assert.equal(swimUnderPlan({ at: w.at, start: PF }).ok, false); assert.equal(swimUnderPlan({ at: w.at, start: PF, ...SU_WIDE }).ok, false)
  const pd = pocketDigPlan({ at: w.at, start: PF, ...SU_WIDE })
  assert.equal(pd.ok, false); assert.match(pd.reason, /0 of 0 block/)
  assert.equal(w.at(46, 60, 69).name, 'air')
  assert.ok(longBreathPlan({ at: w.at, start: PF, tier: SU_WIDE, on: true }).ok)
})
await t('S6 THE LONG TIER NEVER REPLACES A SHORT PLAN: wherever the base bound plans, the reflex never asks the long tier (structural), and on Echo\'s cut the base plan is unchanged', () => {
  const r = stripComments(readFileSync(SRC.reflex, 'utf8'))
  assert.ok(/if \(plan\.ok \|\| !wide\.radius \|\| !pocketOn\) return\n\s*const lb = longBreathPlan\(\{ at, start, tier: wide \}\)\n\s*if \(lb\?\.ok\) \{ plan = lb; breath = SU_LONG_WET_RUN \}/.test(r), 'long breath only after the wide plan failed')
  assert.ok(/const longFirst = !\(st0\?\.breath > 0\)\n[\s\S]*if \(longFirst\) tryLong\(\)\n\s*let pocket = null[\s\S]*const pd = pocketDigPlan\([\s\S]*if \(!longFirst\) tryLong\(\)/.test(r), 'before the pocket dig, after it once a long firing failed here')
  assert.ok(r.includes('wide: !!wide.radius, breath })'), 'a failed firing remembers its tier')
  assert.equal(r.split("${breath ? ` breath=${breath}` : ''}").length, 3, 'the start AND outcome rows say breath=')
  const w = worldOf(FX, PRE)
  assert.equal(swimUnderPlan({ at: w.at, start: FEET, ...SU_WIDE }).wetRun <= SU_MAX_WET_RUN, true)
  assert.match(seaPocketModeDetail({}), /^on=1 long_wet_run=6 base_wet_run=5 tier=wide_only$/)
  const f = stripComments(readFileSync(SRC.features, 'utf8')); assert.equal(f.split("kind: 'seapocket_mode'").length, 2)
})
// ---- the way back is paid for (Codex r1 BLOCKER) ------------------------------------------------------------------------
// a 1x1 pocket at x=0 (feet water y=10, head air y=11), a 2-high water tunnel y=9..10 running +x for n cells under stone, then
// dry ground (swimunder.test.mjs's tunnel)
const tunnel = (n, extra = () => null) => synth((x, y, z) => {
  const e = extra(x, y, z); if (e) return e
  if (x === 0 && z === 0) return y === 10 ? 'minecraft:water[level=0]' : y === 11 ? 'minecraft:air' : y === 9 ? 'minecraft:water[level=0]' : 'minecraft:stone'
  if (z === 0 && x >= 1 && x <= n) return (y === 9 || y === 10) ? 'minecraft:water[level=0]' : 'minecraft:stone'
  if (z === 0 && x === n + 1) return (y >= 9 && y <= 11) ? 'minecraft:air' : 'minecraft:stone'
  return 'minecraft:stone'
})
await t('A1 THE RULE: on a long plan, air that no longer pays the wet cells behind (30 ticks each + 60) turns back -- unless the nearer breath is ahead; base plans never ask it', () => {
  assert.equal(SU_BACK_TICKS, 30); assert.equal(SU_BACK_RESERVE, 60)
  assert.match(swimUnderAbort({ oxygen: 13, wetAhead: 5, wetBack: 5, longRun: true }), /no longer pays the way back \(5 wet cells\)/)   // 195 < 210
  assert.equal(swimUnderAbort({ oxygen: 14, wetAhead: 5, wetBack: 5, longRun: true }), null)                                         // 210 = 210
  assert.equal(swimUnderAbort({ oxygen: 13, wetAhead: 1, wetBack: 5, longRun: true }), null, 'the nearer breath is ahead: press on')
  assert.equal(swimUnderAbort({ oxygen: 13, wetAhead: 5, wetBack: 5, longRun: false }), null, 'a base plan keeps the base rule')
})
await t('A2 ADVERSE (prismarine-physics): a 5-cell tunnel (6 head-wet cells with the dip) whose dry exit closes as the body reaches cell 5 -- the body turns back along its wake to the pocket, health 20, air never at 0', async () => {
  let closed = false
  const w = tunnel(5, (x, y, z) => (closed && x === 6 && z === 0 && y === 9) ? 'minecraft:stone' : null)
  const world = { getBlock: p => { const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z); if (closed && x === 6 && z === 0 && y === 9) { const b = Block.fromString('minecraft:stone', 0); b.position = new Vec3(x, y, z); return b } return w.getBlock(p) } }
  const bot = simBot(world, [0.5, 10.2, 0.5]); settle(bot)
  const plan = longBreathPlan({ at: (x, y, z) => world.getBlock(new Vec3(x, y, z)), start: feetCell(bot), tier: { radius: 8, maxDown: 4 }, on: true })
  assert.ok(plan.ok, plan.reason); assert.equal(plan.wetRun, 6)
  let res = null, done = false
  const p = swimUnder(bot, { plan, oxygen: () => bot.oxygenLevel, now: () => bot.ticks * 50, onStep: ({ i }) => { if (i >= 4) closed = true } }).then(r => { res = r; done = true })
  let minAir = 300
  for (let i = 0; i < 2000 && !done; i++) { await new Promise(r => setImmediate(r)); bot.tick(); minAir = Math.min(minAir, bot.air) }
  await p
  assert.notEqual(res.outcome, 'out'); assert.equal(bot.health, 20, `health ${bot.health} (${res.outcome}: ${res.why})`); assert.ok(minAir > 0, `air hit 0`)
  console.log(`        (${res.outcome}: ${res.why}; min air ${minAir} ticks)`)
})
await t('A3 ADVERSE (prismarine-physics): the worst turn-back -- the exit closes at the LAST cell, the body STALLS there 3 s (Codex r1 scenario), set out on 2/3 air (200 of 300 ticks): it swims the whole wake back to the pocket, health 20, >= 60 ticks of air left', async () => {
  let closed = false
  const w = tunnel(5)
  const world = { getBlock: p => { const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z); if (closed && x === 6 && z === 0 && y === 9) { const b = Block.fromString('minecraft:stone', 0); b.position = new Vec3(x, y, z); return b } return w.getBlock(p) } }
  const bot = simBot(world, [0.5, 10.2, 0.5]); settle(bot)
  const plan = longBreathPlan({ at: (x, y, z) => world.getBlock(new Vec3(x, y, z)), start: feetCell(bot), tier: { radius: 8, maxDown: 4 }, on: true })
  bot.air = 200
  let res = null, done = false, minAir = 300
  const p = swimUnder(bot, { plan, oxygen: () => bot.oxygenLevel, now: () => bot.ticks * 50, onStep: ({ i, back }) => { if (!back && i >= plan.route.length - 1) closed = true } }).then(r => { res = r; done = true })
  for (let k = 0; k < 2000 && !done; k++) { await new Promise(r => setImmediate(r)); bot.tick(); minAir = Math.min(minAir, bot.air) }
  await p
  console.log(`        (${res.outcome}: ${res.why}; at ${feetCell(bot)} min air ${minAir} ticks hp ${bot.health})`)
  assert.equal(res.outcome, 'returned', `${res.outcome}: ${res.why}`)
  const fc = feetCell(bot); assert.ok(fc[0] === 0 && fc[2] === 0 && (fc[1] === 9 || fc[1] === 10), `home column, at ${fc}`)   // the body bobs in the start column
  assert.equal(bot.health, 20); assert.ok(minAir >= 60, `min air ${minAir} ticks`)
})
await t('M3 MUTANT KILLED: without the paid-way-back rule the short-air long swim presses on (A3 catches it)', async () => {
  const SW = new URL('../src/swimunder.mjs', import.meta.url)
  await withMutant(SW, "  if (longRun && Number.isFinite(oxygen) && Number.isFinite(wetBack) && oxygen * 15 <", "  if (false && longRun && Number.isFinite(oxygen) && Number.isFinite(wetBack) && oxygen * 15 <", async m => {
    assert.equal(m.swimUnderAbort({ oxygen: 13, wetAhead: 5, wetBack: 5, longRun: true }), null)
  })
})
await t('M1 MUTANT KILLED: the long tier without its breath override is the wide search again (S3 catches it)', async () => {
  await withMutant(SRC.escdead, '  return swimUnderPlan({ at, start, ...tier, maxWetRun: SU_LONG_WET_RUN })', '  return swimUnderPlan({ at, start, ...tier })', async m => {
    assert.equal(m.longBreathPlan({ at: worldOf(PD, SEA).at, start: PF, tier: m.SU_WIDE, on: true }).ok, false)
  })
})
await t('M2 MUTANT KILLED: the long tier armed on the narrow tier (S3 catches it)', async () => {
  await withMutant(SRC.escdead, '  if (!on || !tier?.radius) return null\n  return swimUnderPlan({ at, start, ...tier, maxWetRun', '  if (!on) return null\n  return swimUnderPlan({ at, start, ...tier, maxWetRun', async m => {
    assert.notEqual(m.longBreathPlan({ at: worldOf(PD, SEA).at, start: PF, tier: {}, on: true }), null)
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
