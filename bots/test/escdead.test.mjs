// ESCDEAD-01 (bots/src/escdead.mjs + the one usable-pickaxe rule in toolfor.mjs + terrain depth in protectzone.mjs): BREAK
// THE ESCAPE DEAD ENDS. Design and evidence: docs/reports/escdead-design-2026-11-06.md.
//
// LIVE 11-06 (fleet, 7 d, 13,409 online bot-h): 124 pins >= 1 h = 457.1 bot-h, 335.7 (73%) carry the climb-flood chain;
// isolated-d-Delta 103.8 h and -Echo 101.8 h at 358,58,180 (ongoing), hive-c-Bravo 16.1 h under a lake (ongoing).
// The scenes are REAL: test/fixtures/escdead-*-1106.json are failmine cuts of the 11-06 03:16Z nightly backup's region copy
// (read-only; cropped; stone omitted = `outside`). The rise runs through prismarine-physics (the physics the bot moves by).
//
// Proven by BEHAVIOUR: the pin clock; the wide swim on the live isolated-d cut (no exit at radius 4, a 10-cell dry exit at
// radius 8 / descent 4); the breach refused there (the water over the roof is closed by dirt) and admitted under hive-c's
// lake only after 30 min, full air, HP >= 18, no lava, nobody else in the pocket; the rise itself in physics; the COMPOSED
// refusal chain on both cuts; the one pickaxe rule across all five modules (and ESCDEAD=0 = the base); the craft room on
// hive-c-Bravo's bag; terrain depth on a Gale-shaped zone. Anchored mutants for each rule.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require = createRequire(import.meta.url)
const Block = require('prismarine-block')('1.21.8')
const mcData = require('minecraft-data')('1.21.8')
const { Physics, PlayerState } = require('prismarine-physics')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

const ED = await import('../src/escdead.mjs')
const { pinStep, pinnedFor, swimSearchFor, SU_WIDE, PIN_MIN_MS, breachPlan, breachAdmit, floodBreach, breachTicks, BREACH_TICKS, BREACH_MAX_WATER } = ED
const { swimUnderPlan, SU_MAX_WET_RUN, exitKind } = await import('../src/swimunder.mjs')
const { overheadBreakRisk } = await import('../src/scaffold.mjs')
const TF = await import('../src/toolfor.mjs')
const { toolFor, usablePickaxes, swingsLeft, escDeadOn } = TF
const { mayDigForEscape } = await import('../src/reflex.mjs')
const { poolToolOk } = await import('../src/poolescape.mjs')
const { pickaxeUses } = await import('../src/exit-contract.mjs')
const { craftRoomRemedy, MIN_SURVIVOR_USES } = await import('../src/craftroom.mjs')
const PZ = await import('../src/protectzone.mjs')

const SRC = {
  escdead: new URL('../src/escdead.mjs', import.meta.url), toolfor: new URL('../src/toolfor.mjs', import.meta.url),
  reflex: new URL('../src/reflex.mjs', import.meta.url), craftroom: new URL('../src/craftroom.mjs', import.meta.url),
  protectzone: new URL('../src/protectzone.mjs', import.meta.url), poolescape: new URL('../src/poolescape.mjs', import.meta.url),
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
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
function worldOf (fx, edits = new Map()) {
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
  const get = (x, y, z) => { const k = `${x},${y},${z}`; if (!cache.has(k)) { const s = fn(x, y, z); const b = s == null ? null : Block.fromString(s, 0); if (b) b.position = new Vec3(x, y, z); cache.set(k, b) } return cache.get(k) }
  return { at: get, getBlock: p => get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) }
}
const ISOD = fixture('escdead-isolated-d-358_58_180-1106')
const HIVEC = fixture('escdead-hive-c-124_52_64-1106')
const ISOD_OLD = fixture('swimunder-isolated-d-358_58_180')   // the 11-03 cut swimunder-01 was proven on
const HC_FEET = [124, 52, 64]

// a fake bot moved by prismarine-physics (the swimunder test's simBot)
function simBot (world, pos) {
  const physics = Physics(mcData, world)
  const control = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
  const ls = []
  const bot = {
    version: '1.21.8',
    entity: { position: new Vec3(...pos), velocity: new Vec3(0, 0, 0), onGround: true, isInWater: false, isInLava: false, isInWeb: false,
              isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false, yaw: 0, pitch: 0, effects: {}, attributes: {} },
    inventory: { slots: [] }, jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0, health: 20, air: 300,
    get oxygenLevel () { return Math.round(this.air / 15) },
    setControlState (k, v) { control[k] = v },
    lookAt (p) { const d = p.minus(this.entity.position.offset(0, 1.62, 0)); this.entity.yaw = Math.atan2(-d.x, -d.z); this.entity.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) },
    blockAt (p) { return world.getBlock(p) },
    once (ev, fn) { if (ev === 'physicsTick') ls.push(fn) },
    removeListener (ev, fn) { const i = ls.indexOf(fn); if (i >= 0) ls.splice(i, 1) },
    ticks: 0, control,
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
async function drive (bot, promiseOf, maxTicks = 1500) {
  let done = false, res = null
  const p = promiseOf().then(r => { done = true; res = r })
  for (let i = 0; i < maxTicks && !done; i++) { await new Promise(r => setImmediate(r)); bot.tick() }
  if (!done) throw new Error(`actuator still running after ${maxTicks} ticks`)
  await p
  return res
}
// the flood the breach lets in: the roof and the head cell become falling water, the pocket floor floods
const flood = (w, [x, y, z]) => async () => {
  for (const dy of [2, 1, 0]) w.edits.set(`${x},${y + dy},${z}`, 'minecraft:water[level=8]')
}

// ---- the pin clock ------------------------------------------------------------------------------------------------------
await t('PIN CLOCK: one 3-block box is one episode; leaving it starts a new one; a body with no position has no clock', () => {
  let st = pinStep(null, { x: 358.6, y: 58.2, z: 180.7 }, 0)
  st = pinStep(st, { x: 360.5, y: 59.9, z: 178.0 }, 10 * 60_000)        // inside the box: the same episode
  assert.equal(pinnedFor(st, 31 * 60_000), 31 * 60_000)
  const moved = pinStep(st, { x: 362.0, y: 58.2, z: 180.7 }, 31 * 60_000)   // 3.4 blocks out
  assert.equal(pinnedFor(moved, 31 * 60_000), 0)
  assert.equal(pinStep(st, null, 1), null)
  assert.equal(pinnedFor(null, 5), 0)
})
await t('WIDE SEARCH: the base search below 30 min, radius 8 / descent 4 from 30 min, the base again with ESCDEAD=0', () => {
  assert.deepEqual(swimSearchFor(PIN_MIN_MS - 1, { on: true, minMs: PIN_MIN_MS }), {})
  assert.deepEqual(swimSearchFor(PIN_MIN_MS, { on: true, minMs: PIN_MIN_MS }), SU_WIDE)
  assert.deepEqual(SU_WIDE, { radius: 8, maxDown: 4 }, 'geometry only: the route length, the ascent and the breath bound stay the base\'s')
  assert.deepEqual(swimSearchFor(10 * PIN_MIN_MS, { on: false, minMs: PIN_MIN_MS }), {})
  assert.equal(escDeadOn({ ESCDEAD: '0' }), false); assert.equal(escDeadOn({ ESCDEAD: 'off' }), false); assert.equal(escDeadOn({}), true)
})

// ---- (a) the wide swim on the live isolated-d cut ----------------------------------------------------------------------
await t('ISOLATED-D 11-06 (Delta 103.8 h + Echo 101.8 h): the base search finds NO way out (as live: 12 water cells); the wide one finds dry ground, head-wet run <= 4', () => {
  const w = worldOf(ISOD)
  const base = swimUnderPlan({ at: w.at, start: ISOD.feet })
  assert.equal(base.ok, false); assert.match(base.reason, /no way out within 4 cells \(12 water cells searched/)
  const wide = swimUnderPlan({ at: w.at, start: ISOD.feet, ...SU_WIDE })
  assert.ok(wide.ok, wide.reason); assert.equal(wide.exit, 'dry')
  assert.ok(wide.wetRun <= 4 && wide.wetRun <= SU_MAX_WET_RUN, `wet run ${wide.wetRun}`)
  assert.ok(wide.route.length <= 14, `route ${wide.route.length}`)
  assert.equal(exitKind(w.at, wide.route.at(-1)), 'dry')
  assert.ok(Math.min(...wide.route.map(c => c[1])) >= ISOD.feet[1] - 4, 'descent <= 4')
})
await t('positive control: the 11-03 cut (before the bots placed stone at 357,58,180) has a base-search exit, so the zero above is the world, not the planner', () => {
  const w = worldOf(ISOD_OLD)
  assert.equal(swimUnderPlan({ at: w.at, start: ISOD_OLD.feet }).ok, true)
  const now = worldOf(ISOD)
  assert.equal(now.at(357, 58, 180).name, 'stone'); assert.equal(w.at(357, 58, 180).name, 'water')
})

// ---- (a) the breach: plan ------------------------------------------------------------------------------------------------
await t('ISOLATED-D: the breach is REFUSED -- the water over the granite roof is one cell closed by dirt (a breach floods the pocket and opens nothing)', () => {
  const w = worldOf(ISOD)
  const p = breachPlan({ at: w.at, feet: ISOD.feet })
  assert.equal(p.ok, false); assert.match(p.reason, /closed by dirt at y=62/)
})
await t('HIVE-C (Bravo, under a lake): the breach PLANS -- roof dirt y54, 8 water cells, the surface at y63; the rise fits the breath budget', () => {
  const w = worldOf(HIVEC)
  const p = breachPlan({ at: w.at, feet: HC_FEET })
  assert.ok(p.ok, p.reason)
  assert.deepEqual(p.roof, [124, 54, 64]); assert.equal(w.at(...p.roof).name, 'dirt')
  assert.equal(p.water, 8); assert.deepEqual(p.top, [124, 62, 64]); assert.equal(p.route.length, 10)
  assert.ok(p.ticks <= BREACH_TICKS.air - BREACH_TICKS.reserve, `${p.ticks} ticks`)
})
const pocket = ({ roof = 'minecraft:dirt', water = 4, cap = 'minecraft:air', lavaAt = null, head = 'minecraft:air', feet = 'minecraft:air' } = {}) => synth((x, y, z) => {
  if (lavaAt && x === lavaAt[0] && y === lavaAt[1] && z === lavaAt[2]) return 'minecraft:lava[level=0]'
  if (x === 0 && z === 0) {
    if (y === 10) return feet
    if (y === 11) return head
    if (y === 12) return roof
    if (y >= 13 && y < 13 + water) return 'minecraft:water[level=0]'
    if (y === 13 + water) return cap
    if (y > 13 + water) return 'minecraft:air'
    return 'minecraft:stone'
  }
  if (y >= 13 && y < 13 + water) return 'minecraft:water[level=0]'   // a lake over the roof
  return y > 12 + water ? 'minecraft:air' : 'minecraft:stone'
})
await t('breach plan NEGATIVES: head under water, an unbreakable roof, no water over the roof, too deep, a cap, lava within 4, an unloaded cell', () => {
  assert.match(breachPlan({ at: pocket({ head: 'minecraft:water[level=0]' }).at, feet: [0, 10, 0] }).reason, /head is under water/)
  assert.match(breachPlan({ at: pocket({ roof: 'minecraft:bedrock' }).at, feet: [0, 10, 0] }).reason, /bedrock/)
  assert.match(breachPlan({ at: pocket({ water: 0 }).at, feet: [0, 10, 0] }).reason, /no water over the roof/)
  assert.match(breachPlan({ at: pocket({ water: BREACH_MAX_WATER + 1 }).at, feet: [0, 10, 0] }).reason, /more than 8 cells/)
  assert.match(breachPlan({ at: pocket({ cap: 'minecraft:stone' }).at, feet: [0, 10, 0] }).reason, /closed by stone/)
  assert.match(breachPlan({ at: pocket({ lavaAt: [3, 11, -2] }).at, feet: [0, 10, 0] }).reason, /lava within 4/)
  assert.match(breachPlan({ at: (x, y, z) => (y > 14 ? null : pocket().at(x, y, z)), feet: [0, 10, 0] }).reason, /not loaded/)
  // positive control: the same pocket with nothing wrong plans
  assert.equal(breachPlan({ at: pocket().at, feet: [0, 10, 0] }).ok, true)
  assert.equal(breachPlan({ at: pocket({ water: BREACH_MAX_WATER }).at, feet: [0, 10, 0] }).ok, true, 'eight cells of water is inside the bound')
  assert.equal(BREACH_MAX_WATER, 8)
})
await t('breath budget: 20 launch + 30 for each of the two flooded cells + 20 per still cell, at most 240 of 300 ticks', () => {
  assert.equal(breachTicks(new Array(10).fill([0, 0, 0])), 240)
  assert.equal(breachTicks(new Array(3).fill([0, 0, 0])), 20 + 30 * 2 + 20)
})

// ---- (a) the breach: admission ------------------------------------------------------------------------------------------
await t('ADMISSION (owner rule): 30 min pinned, the head in air, full air, health >= 18, nobody else in the pocket; each one alone refuses', () => {
  const plan = breachPlan({ at: worldOf(HIVEC).at, feet: HC_FEET })
  const ok = { plan, pinnedMs: PIN_MIN_MS, oxygen: 20, health: 18, headAir: true, others: 0, on: true, minMs: PIN_MIN_MS }
  assert.deepEqual(breachAdmit(ok), { ok: true, why: null })
  assert.match(breachAdmit({ ...ok, pinnedMs: PIN_MIN_MS - 1 }).why, /pinned 30 min, below 30|below 30/)
  assert.match(breachAdmit({ ...ok, health: 17 }).why, /health 17/)
  assert.match(breachAdmit({ ...ok, oxygen: 19 }).why, /air 19/)
  assert.match(breachAdmit({ ...ok, headAir: false }).why, /head is not in air/)
  assert.match(breachAdmit({ ...ok, others: 1 }).why, /share the pocket/)
  assert.match(breachAdmit({ ...ok, on: false }).why, /ESCDEAD=0/)
  assert.equal(breachAdmit({ ...ok, oxygen: null }).ok, true, 'air unreported with the head in air is full air (swimunder Paper 11-03)')
})

// ---- the COMPOSED refusal chain (flood guard -> swim-under -> wide swim / breach) ---------------------------------------
await t('COMPOSED CHAIN, isolated-d: the flood guard refuses the roof, the base swim finds nothing, and the remedy that runs is the wide swim at 30 min -- never the breach', () => {
  const w = worldOf(ISOD), [x, y, z] = ISOD.feet
  assert.match(overheadBreakRisk({ at: (dx, dy, dz) => w.at(x + dx, y + 2 + dy, z + dz) }) ?? '', /liquid above the block overhead/)
  assert.equal(swimUnderPlan({ at: w.at, start: ISOD.feet }).ok, false)
  assert.equal(swimUnderPlan({ at: w.at, start: ISOD.feet, ...swimSearchFor(29 * 60_000, { on: true, minMs: PIN_MIN_MS }) }).ok, false, 'not before 30 min')
  assert.equal(swimUnderPlan({ at: w.at, start: ISOD.feet, ...swimSearchFor(PIN_MIN_MS, { on: true, minMs: PIN_MIN_MS }) }).ok, true)
  assert.equal(breachAdmit({ plan: breachPlan({ at: w.at, feet: ISOD.feet }), pinnedMs: 99 * PIN_MIN_MS, oxygen: 20, health: 20, headAir: true, on: true, minMs: PIN_MIN_MS }).ok, false)
})
await t('COMPOSED CHAIN, hive-c: the flood guard refuses, swim-under has no start (feet not in water), and the breach is admitted ONLY at 30 min -- denied with lava, low HP, low air, the head under water', () => {
  const w = worldOf(HIVEC), [x, y, z] = HC_FEET
  assert.match(overheadBreakRisk({ at: (dx, dy, dz) => w.at(x + dx, y + 2 + dy, z + dz) }) ?? '', /liquid above the block overhead/)
  assert.equal(swimUnderPlan({ at: w.at, start: HC_FEET, ...SU_WIDE }).ok, false)
  const base = { pinnedMs: PIN_MIN_MS, oxygen: 20, health: 20, headAir: true, on: true, minMs: PIN_MIN_MS }
  const plan = breachPlan({ at: w.at, feet: HC_FEET })
  assert.equal(breachAdmit({ ...base, plan, pinnedMs: 29 * 60_000 }).ok, false)
  assert.equal(breachAdmit({ ...base, plan }).ok, true)
  const lava = worldOf(HIVEC, new Map([['127,56,66', 'minecraft:lava[level=0]']]))
  assert.equal(breachAdmit({ ...base, plan: breachPlan({ at: lava.at, feet: HC_FEET }) }).ok, false, 'lava within 4 of the column')
  assert.equal(breachAdmit({ ...base, plan, health: 12 }).ok, false)
  assert.equal(breachAdmit({ ...base, plan, oxygen: 14 }).ok, false)
  const wetHead = worldOf(HIVEC, new Map([['124,53,64', 'minecraft:water[level=0]']]))
  assert.equal(breachPlan({ at: wetHead.at, feet: HC_FEET }).ok, false)
})

// ---- (a) the rise, in physics --------------------------------------------------------------------------------------------
await t('THE RISE (prismarine-physics, hive-c cut): roof dug, the pocket floods as falling water, the body swims 10 cells to the surface -- eye out, health 20, air never under 10', async () => {
  for (const off of [[0, 0], [0.25, -0.12], [-0.28, 0.14]]) {
    const w = worldOf(HIVEC)
    const plan = breachPlan({ at: w.at, feet: HC_FEET })
    const bot = simBot(w, [124.5 + off[0], 52, 64.5 + off[1]])
    for (let i = 0; i < 10; i++) bot.tick()
    const res = await drive(bot, () => floodBreach(bot, { plan, dig: flood(w, HC_FEET), now: () => bot.ticks * 50 }))
    assert.equal(res.outcome, 'out', `${off}: ${res.why}`)
    assert.ok(bot.entity.position.y >= 62 - 0.2, `y ${bot.entity.position.y}`)
    assert.equal(bot.health, 20); assert.ok(res.minAir >= 10, `min air ${res.minAir}`)
    assert.ok(bot.ticks < BREACH_TICKS.air - BREACH_TICKS.reserve, `${bot.ticks} ticks`)
  }
})
await t('the rise NEGATIVES: a failed dig rises nothing and keeps the pocket dry; a roof already gone is not dug; a yield hands the body over untouched', async () => {
  const w = worldOf(HIVEC)
  const plan = breachPlan({ at: w.at, feet: HC_FEET })
  const bot = simBot(w, [124.5, 52, 64.5])
  const r1 = await drive(bot, () => floodBreach(bot, { plan, dig: async () => { throw new Error('dig exceeded 12000ms') }, now: () => bot.ticks * 50 }))
  assert.equal(r1.outcome, 'failed'); assert.match(r1.why, /roof dig failed/); assert.equal(w.at(124, 53, 64).name, 'air')
  const gone = worldOf(HIVEC, new Map([['124,54,64', 'minecraft:air']]))
  let dug = 0
  const b2 = simBot(gone, [124.5, 52, 64.5])
  const r2 = await drive(b2, () => floodBreach(b2, { plan, dig: async () => { dug++ }, now: () => b2.ticks * 50 }))
  assert.equal(r2.outcome, 'failed'); assert.equal(dug, 0); assert.match(r2.why, /no longer a block/)
  const w3 = worldOf(HIVEC), b3 = simBot(w3, [124.5, 52, 64.5])
  let n = 0
  const r3 = await drive(b3, () => floodBreach(b3, { plan, dig: flood(w3, HC_FEET), yieldTo: () => (++n > 20 ? 'drowning rescue' : null), now: () => b3.ticks * 50 }))
  assert.equal(r3.outcome, 'yielded')
})

await t('A DIG THAT REJECTS AFTER THE BLOCK BROKE STILL RISES (Claude r1 note 1): the roof\'s state decides, not the promise', async () => {
  const w = worldOf(HIVEC)
  const plan = breachPlan({ at: w.at, feet: HC_FEET })
  const bot = simBot(w, [124.5, 52, 64.5])
  const res = await drive(bot, () => floodBreach(bot, { plan, dig: async () => { await flood(w, HC_FEET)(); throw new Error('dig exceeded 12000ms') }, now: () => bot.ticks * 50 }))
  assert.equal(res.outcome, 'out', res.why); assert.match(res.digError, /exceeded/)
})
await t('OWNERSHIP FIRST (Codex r1 blocker 1): a body another owner holds is never flooded -- no dig, no control written', async () => {
  for (const [alive, yieldTo] of [[() => false, () => null], [() => true, () => 'drowning rescue']]) {
    const w = worldOf(HIVEC)
    const plan = breachPlan({ at: w.at, feet: HC_FEET })
    const bot = simBot(w, [124.5, 52, 64.5])
    const writes = []
    const set0 = bot.setControlState.bind(bot); bot.setControlState = (k, v) => { writes.push([k, v]); set0(k, v) }
    let dug = 0
    const res = await drive(bot, () => floodBreach(bot, { plan, dig: async () => { dug++ }, alive, yieldTo, now: () => bot.ticks * 50 }))
    assert.equal(res.outcome, 'yielded'); assert.equal(dug, 0); assert.deepEqual(writes, [])
    assert.equal(w.at(124, 54, 64).name, 'dirt', 'the roof stands')
  }
})
await t('MUTANT KILLED: without the ownership check before the dig, a held body is flooded', async () => {
  await withMutant(SRC.escdead, "    if (l1) { res.outcome = 'yielded'; yielded = true; res.why = `${l1} before the dig`; return res }\n", '', async m => {
    const w = worldOf(HIVEC)
    const plan = m.breachPlan({ at: w.at, feet: HC_FEET })
    const bot = simBot(w, [124.5, 52, 64.5])
    let calls = 0, dug = 0
    // alive for the first check, gone for the second: only the second check stands between the rescue and the flood
    await drive(bot, () => m.floodBreach(bot, { plan, dig: async () => { dug++ }, alive: () => (++calls <= 1), now: () => bot.ticks * 50 }))
    assert.equal(dug, 1, 'the mutant digs a roof under a body it no longer owns')
  })
})

// ---- (b) the one usable-pickaxe rule, all five modules ------------------------------------------------------------------
const pick = (left, name = 'stone_pickaxe', max = 131) => ({ name, type: mcData.itemsByName[name].id, maxDurability: max, durabilityUsed: max - left, count: 1, slot: 9 + left })
const IRON_ORE = Block.fromString('minecraft:iron_ore', 0)
const STONE = Block.fromString('minecraft:stone', 0)
const DIRT = Block.fromString('minecraft:dirt', 0)
await t('ONE RULE, unpinned = the base: [] and [0] dig by hand, [1] counts zero usable, [2] one, [2,1] one, unknown durability counts as full', () => {
  const unknown = { name: 'iron_pickaxe', type: mcData.itemsByName.iron_pickaxe.id, count: 1 }
  const cases = [[[], 0], [[pick(0)], 0], [[pick(1)], 0], [[pick(1), pick(1)], 0], [[pick(2)], 1], [[pick(2), pick(1)], 1], [[pick(50), pick(9)], 2], [[unknown], 1]]
  for (const [items, n] of cases) {
    assert.equal(usablePickaxes(items), n, JSON.stringify(items.map(i => i.maxDurability - i.durabilityUsed)))
    assert.equal(mayDigForEscape(items, STONE), n !== 1, 'mayDigForEscape: refuse at exactly one usable (the reserve)')
  }
  assert.equal(poolToolOk(pick(9), [pick(9)], 1), false, 'pool rung: never the last usable pickaxe')
  assert.equal(poolToolOk(pick(9), [pick(9), pick(40)], 1), true)
  assert.equal(pickaxeUses([pick(9), pick(1), pick(0)]), 8, 'exit contract: uses minus HARD_STOP per copy')
  assert.equal(toolFor(IRON_ORE, [pick(1)]).reason, 'none', 'an unpinned escape never swings the last use')
})
await t('ONE RULE, PINNED: the reserve does not bind and the last swing is open -- in mayDigForEscape, poolToolOk and toolFor alike; ESCDEAD=0 is the base', () => {
  assert.equal(mayDigForEscape([pick(9)], STONE, { pinned: true, on: true }), true)
  assert.equal(mayDigForEscape([pick(9)], STONE, { pinned: true, on: false }), false)
  assert.equal(poolToolOk(pick(1), [pick(1)], 1, { pinned: true, on: true }), true)
  assert.equal(poolToolOk(pick(1), [pick(1)], 2, { pinned: true, on: true }), false, 'two digs on a one-use copy: no')
  assert.equal(poolToolOk(pick(1), [pick(1)], 1, { pinned: true, on: false }), false)
  const d = toolFor(IRON_ORE, [pick(1)], { pinned: true, escdead: true })
  assert.equal(d.reason, 'reserved_required'); assert.equal(d.item.durabilityUsed, 130)
  assert.equal(toolFor(IRON_ORE, [pick(1)], { pinned: true, escdead: false }).reason, 'none')
  assert.equal(toolFor(DIRT, [pick(1)], { pinned: true, escdead: true }).reason, 'hand', 'the 1-use copy is reserved: the hand still digs what it harvests')
  assert.equal(toolFor(STONE, [pick(1)], { pinned: true, escdead: true }).reason, 'reserved_required', 'stone (no hand harvest): the pinned last swing')
  assert.equal(swingsLeft(pick(1), { pinned: true, on: true }), 1); assert.equal(swingsLeft(pick(1)), 0)
  assert.equal(toolFor(IRON_ORE, [pick(0)], { pinned: true, escdead: true }).reason, 'none', 'a 0-use copy is a phantom, never swung')
})
await t('CRAFT ROOM on hive-c-Bravo\'s bag (36/36, two iron_pickaxes at 249/250, making planks): one copy may go (the other keeps the pinned last swing); ESCDEAD=0 keeps both', () => {
  const bag = [pick(1, 'iron_pickaxe', 250), pick(1, 'iron_pickaxe', 250)]
  for (let i = 0; i < 34; i++) bag.push({ name: i < 5 ? 'cobblestone' : `filler_${i}`, count: 64, slot: 20 + i })
  bag[1].slot = 8
  const on = craftRoomRemedy(bag, 'oak_planks', { escdead: true })
  assert.ok(on, 'escdead: a copy is spared'); assert.equal(on.tool.name, 'iron_pickaxe'); assert.equal(on.why, 'spare')
  assert.equal(craftRoomRemedy(bag, 'oak_planks', { escdead: false }), null, 'the base: the last digging pickaxe is kept')
  assert.equal(craftRoomRemedy([pick(1, 'iron_pickaxe', 250), ...bag.slice(2)], 'oak_planks', { escdead: true }), null, 'a SOLE 1-use copy is never worn: it is the pinned last swing')
  assert.equal(MIN_SURVIVOR_USES, 2)
})

// ---- (c) terrain depth --------------------------------------------------------------------------------------------------
const ZONE = PZ.parseZones({ version: 1, zones: [{ id: 'village', kind: 'village', box: [40, -64, 20, 90, 90, 60], floor_y: 54 }] }).zones
const galeWorld = (cap = ['minecraft:stone', 'minecraft:stone']) => synth((x, y, z) => {
  if (x === 64 && z === 38 && y >= 58 && y <= 62) return 'minecraft:air'        // Gale's 5-tall shaft
  if (x === 64 && z === 38 && y >= 63 && y < 63 + cap.length) return cap[y - 63]
  if (x === 64 && z === 38 && y >= 63 + cap.length) return 'minecraft:air'
  if (y >= 70) return 'minecraft:air'
  return 'minecraft:stone'
})
await t('TERRAIN DEPTH (Gale\'s shape): feet 4 above floor_y but under two blocks of stone -> deep; a place in the shaft and the table cell open; the base (no `deep`) refuses both', () => {
  const w = galeWorld()
  const deep = (x, y, z) => PZ.terrainDeep(w.at, x, y, z)
  const feet = { x: 64.5, y: 58, z: 38.5 }
  assert.equal(deep(64, 58, 38), true)
  assert.equal(PZ.blocked(ZONE, 64, 59, 38, feet), ZONE[0], 'the floor_y rule alone refuses')
  assert.equal(PZ.blocked(ZONE, 64, 59, 38, feet, deep), null)
  assert.equal(PZ.zoneDecision({ zones: ZONE, op: 'place', cell: { x: 64, y: 59, z: 38 }, purpose: 'transit', feet, deep }), null)
  assert.ok(PZ.zoneDecision({ zones: ZONE, op: 'place', cell: { x: 64, y: 59, z: 38 }, purpose: 'transit', feet }), 'without deep: refused')
})
await t('TERRAIN DEPTH negatives: a single layer of ground is the surface; a village block over the cell is not ground; open sky is not depth; a bot on the surface opens nothing', () => {
  const one = galeWorld(['minecraft:stone'])
  assert.equal(PZ.terrainDeep(one.at, 64, 58, 38), false)
  const roof = galeWorld(['minecraft:spruce_planks', 'minecraft:stone'])
  assert.equal(PZ.terrainDeep(roof.at, 64, 58, 38), false)
  const mixed = galeWorld(['minecraft:stone', 'minecraft:cobblestone', 'minecraft:stone'])
  assert.equal(PZ.terrainDeep(mixed.at, 64, 58, 38), false, 'cobblestone is a village block: the run of ground is broken')
  const buried = synth((x, y, z) => (x === 64 && z === 38 && y === 57 ? 'minecraft:cobblestone' : y >= 70 ? 'minecraft:air' : 'minecraft:stone'))
  assert.equal(PZ.terrainDeep(buried.at, 64, 57, 38), false, 'Codex r1 blocker 2: a buried village foundation under ground is never deep')
  const bdeep = (x, y, z) => PZ.terrainDeep(buried.at, x, y, z)
  assert.equal(PZ.blocked(ZONE, 64, 57, 38, { x: 64.5, y: 58, z: 40.5 }, bdeep), ZONE[0], 'a dig of it stays refused')
  assert.equal(PZ.terrainDeep(buried.at, 64, 56, 38), false, 'the cell under it: the foundation breaks the run of ground')
  const sky = synth(() => 'minecraft:air')
  assert.equal(PZ.terrainDeep(sky.at, 0, 60, 0), false)
  const w = galeWorld()
  const deep = (x, y, z) => PZ.terrainDeep(w.at, x, y, z)
  assert.equal(PZ.blocked(ZONE, 64, 59, 38, { x: 64.5, y: 72, z: 38.5 }, deep), ZONE[0], 'the bot\'s feet are not deep: the cell stays closed')
})

// ---- wiring (structural: behaviour cannot reach the reflex closure) --------------------------------------------------------
await t('WIRING: both flood arms try the breach after a swim-under that did not get out; the swim takes the pin\'s search; the escape digs take the pin', () => {
  const s = stripComments(readFileSync(SRC.reflex, 'utf8'))
  assert.equal(s.split("await floodBreachTry('marooned', () => maroonGrant)").length, 2)
  assert.equal(s.split("await floodBreachTry('entombed', () => entombedGrant)").length, 2)
  // escpocket-01 re-anchored: the tier is swimTierFor (the pin's search, or the wide one in a recorded trap)
  assert.equal(s.split('const wide = swimTierFor(pinnedMsOf(bot), { known: trapHere })').length, 2)
  assert.equal(s.split('let plan = swimUnderPlan({ at, start, ...wide })').length, 2)
  assert.equal(s.split('return applyToolPolicy(bot, block, { pinned: pinnedNow(bot) })').length, 2)
  assert.equal(s.split("mayDigForEscape(bot.inventory?.items?.() ?? [], blocking, { pinned: pinnedNow(bot) })").length, 2)
  assert.equal(s.split('try { pinTick(bot) } catch').length, 2)
  const ps = stripComments(readFileSync(SRC.protectzone, 'utf8'))
  assert.equal(ps.split('const z = blocked(list, cell.x, cell.y, cell.z, bot.entity?.position ?? null, deepAt)').length, 2)
})

// ---- mutants ------------------------------------------------------------------------------------------------------------
await t('MUTANT KILLED: the breach without the "closed above" check digs isolated-d\'s roof', async () => {
  await withMutant(SRC.escdead, "  if (!(swimFits(top1) && !isWaterCell(top1) && swimFits(top2) && !isWaterCell(top2))) {", '  if (false) {', async m => {
    assert.equal(m.breachPlan({ at: worldOf(ISOD).at, feet: ISOD.feet }).ok, true, 'the mutant plans the breach')
  })
})
await t('MUTANT KILLED: the admission without the pin clock breaches at once', async () => {
  await withMutant(SRC.escdead, '  if (!(pinnedMs >= minMs))', '  if (false)', async m => {
    const plan = m.breachPlan({ at: worldOf(HIVEC).at, feet: HC_FEET })
    assert.equal(m.breachAdmit({ plan, pinnedMs: 0, oxygen: 20, health: 20, headAir: true, on: true, minMs: PIN_MIN_MS }).ok, true)
  })
})
await t('MUTANT KILLED: the admission without the health floor breaches at 12 HP', async () => {
  await withMutant(SRC.escdead, '  if (!(health >= BREACH_MIN_HEALTH))', '  if (false)', async m => {
    const plan = m.breachPlan({ at: worldOf(HIVEC).at, feet: HC_FEET })
    assert.equal(m.breachAdmit({ plan, pinnedMs: PIN_MIN_MS, oxygen: 20, health: 12, headAir: true, on: true, minMs: PIN_MIN_MS }).ok, true)
  })
})
await t('MUTANT KILLED: the plan without the lava scan breaches beside lava', async () => {
  await withMutant(SRC.escdead, '        if (isLavaCell(at(x + dx, cy, z + dz))) return no(', '        if (false) return no(', async m => {
    assert.equal(m.breachPlan({ at: pocket({ lavaAt: [3, 11, -2] }).at, feet: [0, 10, 0] }).ok, true)
  })
})
await t('MUTANT KILLED: the wide search keyed off the pin is the base search -> isolated-d stays pinned', async () => {
  await withMutant(SRC.escdead, '  return on && pinnedMs >= minMs ? SU_WIDE : {}', '  return {}', async m => {
    assert.equal(swimUnderPlan({ at: worldOf(ISOD).at, start: ISOD.feet, ...m.swimSearchFor(PIN_MIN_MS, { on: true, minMs: PIN_MIN_MS }) }).ok, false)
  })
})
await t('MUTANT KILLED: toolFor without the pinned hard stop never swings the last use', async () => {
  await withMutant(SRC.toolfor, '  (pinned && isPickaxe(it?.name) ? 0 : lastSwing', '  (false ? 0 : lastSwing', async m => {
    assert.equal(m.toolFor(IRON_ORE, [pick(1)], { pinned: true, escdead: true }).reason, 'none')
  })
})
await t('MUTANT KILLED: mayDigForEscape without the pinned arm keeps the reserve on a pinned body', async () => {
  const s = readFileSync(SRC.reflex, 'utf8')
  const old = '  if (pinned && on) return true\n  // Unknown durability counts as FULL'
  assert.equal(s.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  // the function is pure: evaluate the mutated body alone (reflex.mjs needs the runner's env to import twice)
  const body = s.slice(s.indexOf('export function mayDigForEscape'), s.indexOf('function bestTool(bot, block)')).replace(old, '  // Unknown durability counts as FULL')
  const fn = new Function('usablePickaxes', 'ESCDEAD_ON', 'SOFT_BLOCK', `${body.replace('export function', 'return function')}`)(usablePickaxes, true, /^(dirt|sand|gravel)$/)
  assert.equal(fn([pick(9)], STONE, { pinned: true, on: true }), false, 'the mutant refuses')
  const real = new Function('usablePickaxes', 'ESCDEAD_ON', 'SOFT_BLOCK', `${s.slice(s.indexOf('export function mayDigForEscape'), s.indexOf('function bestTool(bot, block)')).replace('export function', 'return function')}`)(usablePickaxes, true, /^(dirt|sand|gravel)$/)
  assert.equal(real([pick(9)], STONE, { pinned: true, on: true }), true, 'positive control: the extracted real body admits')
})
await t('MUTANT KILLED: the craft room without the spare branch keeps hive-c-Bravo full', async () => {
  await withMutant(SRC.craftroom, '  if (escdead || /_pickaxe$/.test(String(item))) {', '  if (/_pickaxe$/.test(String(item))) {', async m => {
    const bag = [pick(1, 'iron_pickaxe', 250), { ...pick(1, 'iron_pickaxe', 250), slot: 8 }]
    for (let i = 0; i < 34; i++) bag.push({ name: `filler_${i}`, count: 64, slot: 20 + i })
    assert.equal(m.craftRoomRemedy(bag, 'oak_planks', { escdead: true }), null)
  })
})
await t('MUTANT KILLED: terrain depth on the first solid block alone calls a one-layer surface deep', async () => {
  await withMutant(SRC.protectzone, '    if (++n >= cover) return true', '    return true', async m => {
    assert.equal(m.terrainDeep(galeWorld(['minecraft:stone']).at, 64, 58, 38), true)
  })
})
await t('MUTANT KILLED: terrain depth without the cell\'s own check opens a buried cobblestone foundation', async () => {
  await withMutant(SRC.protectzone, "  if (self.boundingBox === 'block' && !NATURAL_TERRAIN.test(self.name ?? '')) return false\n", '', async m => {
    const buried = synth((x, y, z) => (x === 64 && z === 38 && y === 57 ? 'minecraft:cobblestone' : y >= 70 ? 'minecraft:air' : 'minecraft:stone'))
    assert.equal(m.terrainDeep(buried.at, 64, 57, 38), true)
  })
})
await t('MUTANT KILLED: blockedIn ignoring `deep` refuses Gale\'s shaft', async () => {
  await withMutant(SRC.protectzone, '  if (cy >= q.floorY && !(deep && deep(cx, cy, cz))) return true', '  if (cy >= q.floorY) return true', async m => {
    const w = galeWorld()
    assert.ok(m.blocked(ZONE, 64, 59, 38, { x: 64.5, y: 58, z: 38.5 }, (x, y, z) => m.terrainDeep(w.at, x, y, z)))
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
