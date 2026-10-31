// ESCAPEGUARD-01: A TRAPPED BOT'S ESCAPE NEVER DIGS A BUILD RECORD OR A PROTECTED ZONE'S STRUCTURE (OWNER 10-31, option B).
//
// The incident (showcase 10-31 02:24:50Z): showcase-Frost entombed at 47,18,66 inside trial-chambers-home-se; pillar_out dug
// 47,20,66 oak_planks overhead, the flood branch's sidestep dug 47,19,67 oak_fence and 47,20,67 oak_planks. protectzone.mjs let
// every survival dig through, and nothing read the build records for one.
//
// What this file proves, by BEHAVIOUR (CLAUDE.md: the decision pulled into pure functions and driven; the chain, not the guard):
//   A. the pure parts: guardOf, escapeDigDecision, outOfAir, waitStep, ORDINARY against the tripwire's structure palette;
//   B. the dig wrapper: a survival dig of a guarded cell is refused and never sent; every other purpose, ordinary rock in a
//      zone, an air emergency and ESCAPEGUARD=off go through (positive controls for each refusal);
//   C. the record reader (skills.mjs escapeRecordAt): a record's cells, its `air` cells not, unknown when unreadable;
//   D. THE REFUSAL CHAIN on the incident's geometry: pillar -> `guarded` -> the ramp passes over the guarded cells and leaves
//      through ordinary rock (and, with the guard off, the base digs the planks -- the control); an all-guarded tomb: nothing
//      dug, no prerequisite, a capped back-off, a help row, then the last resort after the wait -- never forever;
//   E. the wiring (structural, comments stripped) and anchored mutants (present AND unique) for every decision line.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-eg-logs-'))
process.env.BOT_NAME ??= 'GuardBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-eg-pool-'))

const EG = await import('../src/escapeguard.mjs')
const { pillarOut, guardBranch, climbNeedAbove } = await import('../src/reflex.mjs')
const { climbOutcomeRoute, ESCAPE_GUARDED } = await import('../src/climbflood.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const SK = await import('../src/skills.mjs')
const { projKey } = await import('../src/buildproj.mjs')
const { SHOP_PLOT } = await import('../src/shop.mjs')
const { guardOf, escapeDigDecision, outOfAir, waitStep, waitClock, isOrdinary, attachEscapeGuard, escapeGuardOn,
        ESCAPE_GUARD_WAIT_MS, ESCAPE_GUARD_GRANT_MS, ESCAPE_GUARD_QUIET_MS, ESCAPE_GUARD_HELP_MS, GUARD_BACKOFF_CAP_MS, RECORD_RADIUS } = EG

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve()
  .then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const EG_PATH = new URL('../src/escapeguard.mjs', import.meta.url)
const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)
const CLIMBFLOOD_PATH = new URL('../src/climbflood.mjs', import.meta.url)

/** climb-escape.test.mjs's withMutant: a separate module, never src/ in place; every anchor present AND unique. */
async function withMutants (path, pairs, fn) {
  let src = readFileSync(path, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}`)
    assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE: the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const withMutant = (path, old, neu, fn) => withMutants(path, [[old, neu]], fn)
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

// --- terrain (climb-flood-chain.test.mjs's fixtures, absolute coordinates) ---------------------------------------------
const Y0 = 40
const DIG_MS = { stone: 7500, cobblestone: 10_000, deepslate: 15_000, dirt: 750, gravel: 3000, sand: 2500 }
const BARE_HANDED = /^(dirt|sand|gravel)$/
function blk (name, pos) {
  if (name === null) return null
  if (name === 'air' || !name) return { name: 'air', boundingBox: 'empty', position: pos }
  if (/^(water|lava|flowing_lava|flowing_water|bubble_column|kelp)$/.test(name)) return { name, boundingBox: 'empty', position: pos }
  if (name === 'bedrock') return { name, boundingBox: 'block', position: pos, diggable: false, digTime: () => null }
  return { name, boundingBox: 'block', position: pos, diggable: true, digTime: () => DIG_MS[name] ?? 7500,
           canHarvest: type => (BARE_HANDED.test(name) ? true : type === 101) }
}
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), clone: () => V(x, y, z),
                          floored: () => V(Math.floor(x), Math.floor(y), Math.floor(z)),
                          distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z) })
function world (cells = {}, { fill = 'stone' } = {}) {
  const m = new Map(Object.entries(cells))
  return { get (x, y, z) { const k = `${x},${y},${z}`; return m.has(k) ? m.get(k) : fill }, set (x, y, z, name) { m.set(`${x},${y},${z}`, name) } }
}
const TOMB = (extra = {}) => world({ '0,0,0': 'air', '0,1,0': 'air', ...extra })
const COBBLE = n => ({ name: 'cobblestone', count: n, type: 1 })
const PICK = (left = 100) => ({ name: 'stone_pickaxe', count: 1, type: 101, maxDurability: 131, durabilityUsed: 131 - left })

/** A bot that digs, pillars (a placed block lifts it one), and walks a ramp step or a level step when the geometry allows. */
function makeBot (w, { y = Y0, inv = [] } = {}) {
  const digs = [], placed = []
  let yaw = 0
  const rel = p => ({ x: Math.floor(p.x), y: Math.floor(p.y) - y, z: Math.floor(p.z) })
  const bot = {
    digs, placed, world: w, pendingPrereq: undefined,
    entity: { position: V(0, y, 0), get yaw () { return yaw }, onGround: true, isInWater: false },
    health: 20, heldItem: null,
    inventory: { items: () => inv.filter(i => i.count > 0), emptySlotCount: () => 36 - inv.length },
    blockAt (p) { const r = rel(p); return blk(w.get(r.x, r.y, r.z), V(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) },
    async unequip () { bot.heldItem = null }, async equip (item) { bot.heldItem = item },
    async dig (b) {
      const r = rel(b.position)
      digs.push({ cell: `${r.x},${r.y},${r.z}`, name: b.name })
      w.set(r.x, r.y, r.z, 'air')
    },
    async placeBlock (below) {
      const r = rel(below.position ?? below)
      const it = inv.find(i => i.name === bot.heldItem?.name && i.count > 0)
      if (!it) throw new Error('nothing to place')
      it.count--
      w.set(r.x, r.y + 1, r.z, it.name)
      placed.push(`${r.x},${r.y + 1},${r.z}`)
      const p = bot.entity.position
      bot.entity.position = V(p.x, p.y + 1, p.z)
    },
    stopDigging () {}, clearControlStates () {},
    async look (a) { yaw = a }, async lookAt () {},
    setControlState (name, on) {
      if (name !== 'forward' || !on) return
      const bear = [{ x: 0, z: -1 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 0 }][((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4]
      const p = rel(bot.entity.position)
      const at = (dx, dy, dz) => blk(w.get(p.x + dx, p.y + dy, p.z + dz), null)
      const clear = b => b && b.boundingBox === 'empty'
      const q = bot.entity.position
      if (at(bear.x, -1, bear.z)?.boundingBox === 'block' && clear(at(bear.x, 0, bear.z)) && clear(at(bear.x, 1, bear.z))) {
        bot.entity.position = V(q.x + bear.x, q.y, q.z + bear.z); return
      }
      if (at(bear.x, 0, bear.z)?.boundingBox !== 'block' || !clear(at(bear.x, 1, bear.z)) || !clear(at(bear.x, 2, bear.z))) return
      bot.entity.position = V(q.x + bear.x, q.y + 1, q.z + bear.z)
    },
    pathfinder: { thinkTimeout: 1000, setGoal () {}, stop () {}, getPathTo () { return { path: [] } } },
  }
  return bot
}
// the protected zone around the scene (protectzone.mjs shape), absolute coordinates: the trial chambers' box in miniature
const ZONE = { id: 'trial-chambers-test', kind: 'trial_chambers', label: 'the test chambers', x0: -8, y0: Y0 - 8, z0: -8, x1: 8, y1: Y0 + 8, z1: 8, floorY: null }
// every cell round the tomb is a record cell (a sealed void in a project): nothing ordinary to cut through
const ALLREC = c => (Math.abs(c.x) <= 3 && Math.abs(c.z) <= 3 && c.y >= Y0 - 2 && c.y <= Y0 + 6 ? 'monument' : false)
const rows = []
tapRecords(r => { if (/^_(escape_guard|needs_rescue)/.test(r?.skill?.name ?? '')) rows.push(r.skill) })
/** The guard on a test bot: survival context (the entombed reflex holds the body), an injectable clock. */
function guarded (bot, { zones = [ZONE], recordAt = () => false, env = {}, clock = { t: Date.now() } } = {}) {
  const g = attachEscapeGuard(bot, { zones: () => zones, recordAt, home: { x: 0, y: 64, z: 0 }, env,
    context: () => ({ skill: 'gather', reflex: 'entombed' }), now: () => clock.t,
    onRow: ({ kind, status, detail }) => rows.push({ name: `_${kind}`, status, detail }) })
  return { g, clock }
}
/** One firing of the entombed arm's guarded path, as the handler runs it: the pillar, its route, then guardBranch. */
async function firing (bot, refusals) {
  const out = await pillarOut(bot, climbNeedAbove((x, y, z) => bot.blockAt(V(x, y, z)), bot.entity.position))
  if (climbOutcomeRoute(out) !== 'guarded') return { route: climbOutcomeRoute(out), out }
  return { route: 'guarded', ...(await guardBranch(bot, { handler: 'entombed', refusals })) }
}

// ================================================================================================================
// A. THE PURE PARTS
// ================================================================================================================
const P = (x, y, z) => ({ x, y, z })
await t('guardOf: a record cell, an unreadable record near home, a zone structure block, ordinary rock in a zone, the deep exemption', () => {
  const rec = c => (c.x === 1 ? 'monument' : false)
  assert.deepStrictEqual(guardOf({ cell: P(1, 40, 0), name: 'stone', recordAt: rec }), { kind: 'record', what: 'monument' }, 'a record cell, whatever block (stone too)')
  assert.strictEqual(guardOf({ cell: P(2, 40, 0), name: 'stone', recordAt: rec }), null, 'positive control: the next cell is no record and no zone')
  assert.deepStrictEqual(guardOf({ cell: P(2, 40, 0), name: 'stone', recordAt: () => null, home: P(0, 64, 0) }), { kind: 'unknown' }, 'unreadable near home: unknown')
  assert.strictEqual(guardOf({ cell: P(RECORD_RADIUS + 5, 40, 0), name: 'stone', recordAt: () => null, home: P(0, 64, 0) }), null, 'far from home no record reaches')
  assert.deepStrictEqual(guardOf({ cell: P(0, 42, 0), name: 'oak_planks', zones: [ZONE] }), { kind: 'zone', zone: ZONE.id, ordinary: false })
  assert.deepStrictEqual(guardOf({ cell: P(0, 42, 0), name: 'tuff', zones: [ZONE] }), { kind: 'zone', zone: ZONE.id, ordinary: true })
  const deep = { ...ZONE, floorY: Y0 }
  assert.strictEqual(guardOf({ cell: P(0, Y0 - 2, 0), name: 'oak_planks', zones: [deep], feet: P(0, Y0 - 3, 0) }), null, 'below a zone floor, a bot below it digs out (protectzone deep exemption)')
  assert.ok(guardOf({ cell: P(0, Y0 - 2, 0), name: 'oak_planks', zones: [deep], feet: P(20, Y0 - 3, 0) }), 'control: a bot outside may not dig in')
  assert.strictEqual(guardOf({ cell: P(30, 42, 0), name: 'oak_planks', zones: [ZONE] }), null, 'outside the box')
})
await t('ORDINARY never names a block of the tripwire\'s structure palette; plain rock and soil are ordinary', () => {
  for (const n of ['stone', 'deepslate', 'tuff', 'granite', 'andesite', 'dirt', 'gravel', 'iron_ore', 'deepslate_iron_ore', 'calcite', 'minecraft:stone']) assert.ok(isOrdinary(n), n)
  for (const n of ['oak_planks', 'oak_fence', 'cobblestone', 'mossy_cobblestone', 'tuff_bricks', 'polished_tuff', 'chiseled_tuff', 'tuff_stairs',
    'copper_block', 'cut_copper', 'oxidized_copper', 'stone_bricks', 'dirt_path', 'spruce_log', 'glass', 'torch', 'chest', 'trial_spawner', 'vault',
    'decorated_pot', 'smooth_stone', 'polished_andesite', 'bricks', 'red_glazed_terracotta', null, undefined]) assert.ok(!isOrdinary(n), String(n))
})
await t('escapeDigDecision: survival digs of a guarded cell are refused; off / other purposes / ordinary / air / last resort are allowed', () => {
  const rec = { kind: 'record', what: 'monument' }
  assert.deepStrictEqual(escapeDigDecision({ guard: rec }), { allow: false, why: 'record' })
  assert.deepStrictEqual(escapeDigDecision({ guard: { kind: 'unknown' } }), { allow: false, why: 'unknown' })
  assert.deepStrictEqual(escapeDigDecision({ guard: { kind: 'zone', zone: 'z', ordinary: false } }), { allow: false, why: 'zone' })
  assert.strictEqual(escapeDigDecision({ guard: { kind: 'zone', zone: 'z', ordinary: true } }).why, 'ordinary')
  assert.strictEqual(escapeDigDecision({ guard: rec, on: false }).why, 'off')
  for (const p of ['target', 'transit', 'other', null]) assert.strictEqual(escapeDigDecision({ guard: rec, purpose: p }).why, 'not_survival', String(p))
  assert.strictEqual(escapeDigDecision({ guard: rec, air: true }).why, 'air')
  assert.strictEqual(escapeDigDecision({ guard: rec, lastResort: true }).why, 'last_resort')
  assert.strictEqual(escapeDigDecision({ guard: null }).why, 'unguarded')
  assert.ok(escapeGuardOn({}) && escapeGuardOn({ ESCAPEGUARD: 'on' }) && !escapeGuardOn({ ESCAPEGUARD: 'off' }) && !escapeGuardOn({ ESCAPEGUARD: '0' }))
})
await t('outOfAir: a solid head cell, or the head under with <= 8 s of air; wet feet or a full breath are not', () => {
  assert.ok(outOfAir({ headSolid: true }))
  assert.ok(outOfAir({ headUnder: true, airSeconds: 8 }) && outOfAir({ headUnder: true, airSeconds: 2 }))
  assert.ok(!outOfAir({ headUnder: true, airSeconds: 9 }), 'control: 9 s left is not yet an emergency')
  assert.ok(!outOfAir({ headUnder: false, airSeconds: 0 }), 'head in air')
  assert.ok(outOfAir({ headUnder: true, oxygen: 10 }) && !outOfAir({ headUnder: true, oxygen: 20 }), 'the server oxygen fallback')
  assert.ok(outOfAir({ headUnder: true, airSeconds: 15, oxygen: 0 }), 'Codex r1: a fresh 15 s clock after a reconnect never hides the server\'s 0')
  assert.ok(outOfAir({ headUnder: true, airSeconds: 3, oxygen: 20 }), 'and the clock\'s low reading wins over a stale full oxygen')
})
await t('waitStep: a refusal starts the wait; help once at 2 min; the last resort at 10 min for 90 s; moving away or 3 min quiet ends it', () => {
  const at = P(0, 40, 0)
  let r = waitStep(waitClock(), { now: 0, pos: at, refused: true })
  assert.ok(r.began && !r.lastResort && !r.help)
  const feed = (st, t0, t1, every = 60_000) => { let x = { st }; for (let t = t0; t <= t1; t += every) x = waitStep(x.st, { now: t, pos: at, refused: true }); return x }
  r = feed(r.st, 60_000, ESCAPE_GUARD_HELP_MS)
  assert.ok(r.help, 'help at 2 min'); assert.strictEqual(r.lastResort, false)
  const helped = r.st
  assert.ok(!waitStep(helped, { now: ESCAPE_GUARD_HELP_MS + 60_000, pos: at, refused: true }).help, 'help is said once per wait')
  r = feed(helped, ESCAPE_GUARD_HELP_MS + 60_000, ESCAPE_GUARD_WAIT_MS)
  assert.ok(r.granted && r.lastResort, 'the last resort opens at the wait')
  const g = r.st
  assert.ok(waitStep(g, { now: ESCAPE_GUARD_WAIT_MS + ESCAPE_GUARD_GRANT_MS - 1, pos: at }).lastResort, 'open for the grant')
  const after = waitStep(g, { now: ESCAPE_GUARD_WAIT_MS + ESCAPE_GUARD_GRANT_MS, pos: at, refused: true })
  assert.ok(!after.lastResort && after.ended && after.began, 'after the grant the wait starts again')
  assert.ok(!waitStep(g, { now: ESCAPE_GUARD_WAIT_MS + 1, pos: P(9, 40, 0) }).lastResort, 'the grant ends when the bot has left')
  const moved = waitStep(feed(waitClock(), 0, 5 * 60_000).st, { now: 5 * 60_000 + 1, pos: P(5, 40, 0), refused: true })
  assert.ok(moved.ended && moved.began && moved.st.since === 5 * 60_000 + 1, 'moved > 4 blocks: a new wait from here')
  const quiet = waitStep(feed(waitClock(), 0, 5 * 60_000).st, { now: 5 * 60_000 + ESCAPE_GUARD_QUIET_MS + 1, pos: at })
  assert.ok(quiet.ended && quiet.st.since == null, 'quiet 3 min: the wait ends')
  assert.ok(GUARD_BACKOFF_CAP_MS < ESCAPE_GUARD_QUIET_MS, 'the arms\' back-off must stay under the quiet window or the wait never reaches the last resort')
})

// ================================================================================================================
// B. THE WRAPPER
// ================================================================================================================
await t('WRAPPER: a survival dig of a record cell is refused (rejected, never sent); a zone structure block too; ordinary rock in the zone goes', async () => {
  const w = TOMB({ '0,2,0': 'oak_planks', '1,0,0': 'tuff' })
  const bot = makeBot(w)
  guarded(bot, { recordAt: c => (c.x === -1 && c.y === Y0 ? 'monument' : false) })
  const e = await bot.dig(bot.blockAt(V(-1, Y0, 0))).then(() => null, x => x)
  assert.strictEqual(e?.code, 'escape_guard'); assert.match(e.message, /build-record cell \(monument\)/)
  const z = await bot.dig(bot.blockAt(V(0, Y0 + 2, 0))).then(() => null, x => x)
  assert.strictEqual(z?.code, 'escape_guard'); assert.match(z.message, /structure block of the protected zone/)
  assert.deepStrictEqual(bot.digs, [], 'a refused dig reached the inner dig')
  await bot.dig(bot.blockAt(V(1, Y0, 0)))
  assert.deepStrictEqual(bot.digs.map(d => d.cell), ['1,0,0'], 'positive control: ordinary tuff inside the zone is dug')
  assert.ok(rows.some(r => r.name === '_escape_guard' && /phase=refused why=record/.test(r.detail)))
})
await t('WRAPPER: every other purpose passes (the gate is survival only); ESCAPEGUARD=off passes; a suffocating bot digs', async () => {
  const w = TOMB({ '0,2,0': 'oak_planks' })
  const bot = makeBot(w)
  attachEscapeGuard(bot, { zones: () => [ZONE], home: { x: 0, y: 64, z: 0 }, context: () => ({ skill: 'mine' }) })
  await bot.dig(bot.blockAt(V(0, Y0 + 2, 0)))
  assert.strictEqual(bot.digs.length, 1, 'a target dig is protectzone\'s business, not this guard\'s')
  const b2 = makeBot(TOMB({ '0,2,0': 'oak_planks' }))
  guarded(b2, { env: { ESCAPEGUARD: 'off' } })
  await b2.dig(b2.blockAt(V(0, Y0 + 2, 0)))
  assert.strictEqual(b2.digs.length, 1, 'the kill switch')
  const b3 = makeBot(world({ '0,0,0': 'air', '0,1,0': 'gravel', '0,2,0': 'oak_planks' }))
  guarded(b3)
  await b3.dig(b3.blockAt(V(0, Y0 + 2, 0)))
  assert.strictEqual(b3.digs.length, 1, 'head in a solid block: suffocating, the structure absorbs the damage')
  assert.ok(rows.some(r => /phase=air/.test(r.detail)))
})

await t('WRAPPER: a dig by the drowning rescue or the flooded-pocket arm is never refused (it was admitted on the air state)', async () => {
  for (const reflex of ['drown_rescue', 'flooded_pocket']) {
    const bot = makeBot(TOMB({ '0,2,0': 'oak_planks' }))
    attachEscapeGuard(bot, { zones: () => [ZONE], home: { x: 0, y: 64, z: 0 }, context: () => ({ reflex }) })
    await bot.dig(bot.blockAt(V(0, Y0 + 2, 0)))
    assert.strictEqual(bot.digs.length, 1, reflex)
  }
  const ctl = makeBot(TOMB({ '0,2,0': 'oak_planks' }))
  attachEscapeGuard(ctl, { zones: () => [ZONE], home: { x: 0, y: 64, z: 0 }, context: () => ({ reflex: 'escape' }) })
  assert.strictEqual(await ctl.dig(ctl.blockAt(V(0, Y0 + 2, 0))).then(() => 'dug', e => e.code), 'escape_guard', 'control: the entombed escape is refused')
})
await t('WRAPPER: the real dig re-reads the records (fresh) -- a record written inside the planners\' cache window is still refused', async () => {
  const bot = makeBot(TOMB())
  let rec = false
  const asked = []
  attachEscapeGuard(bot, { zones: () => [], home: { x: 0, y: 64, z: 0 }, context: () => ({ reflex: 'escape' }),
    recordAt: (c, o) => { asked.push(!!o?.fresh); return o?.fresh ? rec : false } })
  assert.strictEqual(bot.escapeGuard.mayBreak(bot.blockAt(V(1, Y0, 0))), true, 'the cached answer: no record yet')
  rec = 'monument'
  assert.strictEqual(await bot.dig(bot.blockAt(V(1, Y0, 0))).then(() => 'dug', e => e.code), 'escape_guard')
  assert.deepStrictEqual(asked, [false, true], 'the planner used the snapshot, the dig asked fresh')
})
await t('MAROONED CADENCE (Claude + Codex r1): firings at the arm\'s real spacing (cap + its 60 s check + the ramp) still reach the last resort', async () => {
  const w = TOMB()
  const bot = makeBot(w, { inv: [PICK(100), COBBLE(64)] })
  const { clock } = guarded(bot, { recordAt: ALLREC, zones: [] })
  let refusals = 0, f = null
  const t0 = clock.t
  for (let k = 0; k < 12; k++) {
    f = await firing(bot, refusals)
    if (f.route !== 'guarded') break
    refusals = f.refusals ?? refusals
    clock.t += GUARD_BACKOFF_CAP_MS + 60_000 + 30_000
  }
  assert.notStrictEqual(f.route, 'guarded', 'the wait reset between firings: entombed forever at the marooned cadence')
  assert.ok(bot.digs.some(d => d.cell === '0,2,0'))
  assert.ok(clock.t - t0 <= ESCAPE_GUARD_WAIT_MS + GUARD_BACKOFF_CAP_MS + 90_000)
})

// ================================================================================================================
// C. THE RECORD READER
// ================================================================================================================
await t('RECORDS: a project record\'s cells read as that record, its air cells not; the town plan; unreadable -> unknown (null)', () => {
  const dir = process.env.POOL_STATE_DIR
  const bot = { worldId: null, townPlan: undefined }
  let now = Date.now() + 1e6
  const at = c => SK.escapeRecordAt(bot, c, (now += 20_000))
  assert.strictEqual(at(P(5, 65, 0)), false, 'positive control: a fresh town has no record')
  fs.writeFileSync(path.join(dir, `${projKey({ x: 0, y: 64, z: 0 }, SHOP_PLOT)}.g1.json`),
    JSON.stringify({ gen: 1, prev: null, cells: [{ at: [5, 65, 0], block: 'oak_planks', state: 'placed' }] }))
  const mon = path.join(dir, `${projKey({ x: 0, y: 64, z: 0 }, 'monument')}.g1.json`)
  fs.writeFileSync(mon, JSON.stringify({ gen: 1, prev: null, blueprint: 'ziggurat@2', cells: [{ at: [9, 65, 3], block: 'cobblestone', role: 'base', state: 'open' }] }))
  const st = path.join(dir, `${projKey({ x: 0, y: 64, z: 0 }, 'shaft')}.g1.json`)
  fs.writeFileSync(st, JSON.stringify({ gen: 1, prev: null, blueprint: 'stair@1', cells: [{ at: [2, 60, 2], role: 'air', k: 0 }, { at: [2, 59, 2], role: 'tread', k: 0 }] }))
  assert.strictEqual(at(P(5, 65, 0)), 'workshop')
  assert.strictEqual(at(P(9, 65, 3)), 'monument', 'an OPEN (planned) cell is guarded too: it is the project\'s')
  assert.strictEqual(at(P(9, 66, 3)), false, 'the cell above: no record')
  assert.strictEqual(at(P(2, 60, 2)), false, 'a record\'s air cell is not guarded (digging it is the record\'s own work)')
  assert.ok(at(P(2, 59, 2)), 'the stair\'s tread is')
  fs.writeFileSync(mon, '{ not json')
  assert.strictEqual(at(P(9, 66, 3)), null, 'an unparseable generation: unknown, never "no record"')
  fs.unlinkSync(mon); fs.unlinkSync(st)
  assert.strictEqual(at(P(9, 66, 3)), false)
})

// ================================================================================================================
// D. THE REFUSAL CHAIN
// ================================================================================================================
// Frost's cell in miniature: planks overhead, a fence and planks on the +z side, ordinary stone elsewhere, all inside the zone
const FROST = () => TOMB({ '0,2,0': 'oak_planks', '0,0,1': 'oak_fence', '0,1,1': 'oak_planks' })
const FROST_CELLS = ['0,2,0', '0,0,1', '0,1,1']
await t('THE CHAIN (Frost 10-31): pillar -> guarded -> the ramp leaves through ordinary stone; no structure block is dug, no prerequisite', async () => {
  const w = FROST()
  const bot = makeBot(w, { inv: [PICK(100), COBBLE(64)] })
  guarded(bot)
  const f = await firing(bot, 0)
  assert.strictEqual(f.route, 'guarded', `the pillar answered ${f.out}`)
  assert.strictEqual(f.progressed, true, `the ramp did not move the bot: ${f.stair?.stopped}`)
  assert.ok(f.stair.sidestepped === 1, JSON.stringify(f.stair))
  for (const c of FROST_CELLS) assert.ok(!bot.digs.some(d => d.cell === c), `dug the structure cell ${c}`)
  for (const c of FROST_CELLS) assert.notStrictEqual(w.get(...c.split(',').map(Number)), 'air', `${c} is gone`)
  assert.ok(bot.digs.length > 0 && bot.digs.every(d => d.name === 'stone'), `only ordinary rock is dug: ${JSON.stringify(bot.digs)}`)
  assert.strictEqual(bot.pendingPrereq, undefined)
})
await t('POSITIVE CONTROL: with ESCAPEGUARD=off the same cell is the base\'s -- the pillar digs the planks overhead', async () => {
  const w = FROST()
  const bot = makeBot(w, { inv: [PICK(100), COBBLE(64)] })
  guarded(bot, { env: { ESCAPEGUARD: 'off' } })
  const f = await firing(bot, 0)
  assert.notStrictEqual(f.route, 'guarded')
  assert.ok(bot.digs.some(d => d.cell === '0,2,0' && d.name === 'oak_planks'), `the base dig of the planks is gone: ${JSON.stringify(bot.digs)}`)
})
// every cell round the tomb is a record cell (a sealed void in a project): nothing ordinary to cut through
await t('ALL GUARDED: firings every 90 s hold the bot dry and in place, dig nothing, ask nothing, back off <= the cap, call for help once', async () => {
  const w = TOMB()
  const bot = makeBot(w, { inv: [PICK(100), COBBLE(64)] })
  const { clock } = guarded(bot, { recordAt: ALLREC, zones: [] })
  rows.length = 0
  let refusals = 0
  for (let k = 0; k < 5; k++) {
    const f = await firing(bot, refusals)
    assert.strictEqual(f.route, 'guarded', `firing ${k}: ${f.out}`)
    assert.strictEqual(f.progressed, false)
    assert.ok(f.backoffMs > 0 && f.backoffMs <= GUARD_BACKOFF_CAP_MS, `back-off ${f.backoffMs}`)
    refusals = f.refusals
    clock.t += 90_000
  }
  assert.deepStrictEqual(bot.digs, [], 'a guarded cell was dug before the wait ran out')
  assert.strictEqual(bot.pendingPrereq, undefined, 'a prerequisite: no item opens a guarded cell')
  assert.deepStrictEqual([bot.entity.position.x, bot.entity.position.y, bot.entity.position.z], [0, Y0, 0])
  assert.strictEqual(rows.filter(r => r.name === '_needs_rescue').length, 1, 'help is called once')
  assert.ok(rows.filter(r => r.name === '_escape_guard_refused').every(r => /prereq=none/.test(r.detail)))
})
await t('NEVER FOREVER: still refused at the same place after the wait, the last resort opens and the escape the bot had before runs', async () => {
  const w = TOMB()
  const bot = makeBot(w, { inv: [PICK(100), COBBLE(64)] })
  const { clock } = guarded(bot, { recordAt: ALLREC, zones: [] })
  rows.length = 0
  let refusals = 0, f = null
  const t0 = clock.t
  for (let k = 0; k < 20; k++) {
    f = await firing(bot, refusals)
    if (f.route !== 'guarded') break
    refusals = f.refusals ?? refusals
    clock.t += Math.min(f.backoffMs || GUARD_BACKOFF_CAP_MS, GUARD_BACKOFF_CAP_MS)
  }
  assert.notStrictEqual(f.route, 'guarded', 'twenty firings, the wait long past, and the pillar is still refused: entombed forever')
  assert.ok(clock.t - t0 >= ESCAPE_GUARD_WAIT_MS && clock.t - t0 <= ESCAPE_GUARD_WAIT_MS + 2 * GUARD_BACKOFF_CAP_MS, `opened at +${Math.round((clock.t - t0) / 1000)} s`)
  assert.ok(bot.digs.some(d => d.cell === '0,2,0'), `the last resort did not dig the ceiling: ${JSON.stringify(bot.digs)}`)
  assert.ok(rows.some(r => /phase=last_resort_open/.test(r.detail)), 'the grant is on the record')
})

// ================================================================================================================
// E. WIRING AND MUTANTS
// ================================================================================================================
await t('WIRED: index installs the guard after protectzone with the records and zones; both arms route `guarded` to guardBranch; the ramp, the pool escape, both harvests and the head wall ask', () => {
  const idx = stripComments(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
  const a = idx.indexOf('attachProtectZone(bot, {'), b = idx.indexOf('attachEscapeGuard(bot, {')
  assert.ok(a > 0 && b > a, 'the guard is installed, and after protectzone (outermost of the two)')
  assert.match(idx, /recordAt: \(c, o\) => escapeRecordAt\(bot, c, Date\.now\(\), o\)/)
  assert.match(idx, /zones: \(\) => bot\.protectZones\?\.\(\) \?\? \[\]/)
  const rf = stripComments(readFileSync(REFLEX_PATH, 'utf8'))
  assert.strictEqual((rf.match(/climbOutcomeRoute\((climbed|pillarOutcome)\) === 'guarded'/g) ?? []).length, 2, 'both arms route guarded')
  assert.strictEqual((rf.match(/await guardBranch\(bot, \{ handler: '(entombed|marooned)'/g) ?? []).length, 2)
  assert.match(rf, /if \(b\?\.position && !guardMay\(bot, b\)\) return false/, 'the ramp canBreak')
  assert.match(rf, /\(b\?\.position && !guardMay\(bot, b\)\) \? 'guarded/, 'the pool escape canClear')
  assert.match(rf, /if \(!guardMay\(bot, b\)\) \{ unsafe\+\+; continue \}/, 'harvestAdjacent')
  assert.match(rf, /if \(!guardMay\(bot, target\)\) return \{ ok: false/, 'harvestUnderfoot')
  assert.match(rf, /&& guardMay\(bot, b\)\)/, 'breach_head_wall')
})
await t('MUTANT KILLED: the decision allows a guarded cell -> the Frost chain digs a structure block', async () => {
  await withMutant(EG_PATH, "  return { allow: false, why: guard.kind }\n", "  return { allow: true, why: guard.kind }\n", async M => {
    const w = FROST(), bot = makeBot(w, { inv: [PICK(100), COBBLE(64)] })
    M.attachEscapeGuard(bot, { zones: () => [ZONE], home: { x: 0, y: 64, z: 0 }, context: () => ({ reflex: 'entombed' }) })
    await firing(bot, 0)
    assert.ok(bot.digs.some(d => FROST_CELLS.includes(d.cell)), 'the mutant must dig a structure cell, or this test proves nothing')
  })
})
await t('MUTANT KILLED: ordinary rock in a zone refused too -> the Frost bot cannot cut its way out (it stays)', async () => {
  await withMutant(EG_PATH, "  if (guard.kind === 'zone' && guard.ordinary) return { allow: true, why: 'ordinary' }\n", '', async M => {
    const w = FROST(), bot = makeBot(w, { inv: [PICK(100), COBBLE(64)] })
    M.attachEscapeGuard(bot, { zones: () => [ZONE], home: { x: 0, y: 64, z: 0 }, context: () => ({ reflex: 'entombed' }) })
    const f = await firing(bot, 0)
    assert.strictEqual(f.progressed, false, 'with ordinary rock refused the ramp has nowhere to go')
  })
})
await t('MUTANT KILLED: no last-resort grant -> the all-guarded bot is entombed forever', async () => {
  await withMutant(EG_PATH, "    st = { ...st, grantUntil: now + grantMs }\n    granted = true\n    return { st, lastResort: true, began, help, granted, ended }\n", '', async M => {
    const w = TOMB(), bot = makeBot(w, { inv: [PICK(100), COBBLE(64)] })
    const clock = { t: Date.now() }
    M.attachEscapeGuard(bot, { zones: () => [], recordAt: ALLREC, home: { x: 0, y: 64, z: 0 }, context: () => ({ reflex: 'entombed' }), now: () => clock.t })
    let refusals = 0
    for (let k = 0; k < 9; k++) { const f = await firing(bot, refusals); refusals = f.refusals ?? refusals; clock.t += GUARD_BACKOFF_CAP_MS }
    assert.deepStrictEqual(bot.digs, [], 'the mutant must never dig, or this test proves nothing')
  })
})
await t('MUTANT KILLED: the ramp ignores the guard -> its sidestep reaches the fence (refused at the dig) and the bot does not get out', async () => {
  await withMutant(REFLEX_PATH, '    if (b?.position && !guardMay(bot, b)) return false\n', '', async M => {
    const w = FROST(), bot = makeBot(w, { inv: [PICK(100), COBBLE(64)] })
    guarded(bot)
    const out = await M.pillarOut(bot, climbNeedAbove((x, y, z) => bot.blockAt(V(x, y, z)), bot.entity.position))
    assert.strictEqual(out, ESCAPE_GUARDED)
    const g = await M.guardBranch(bot, { handler: 'entombed', refusals: 0 })
    assert.strictEqual(g.progressed, false, 'the unguarded ramp plans the structure cells and is refused at the swing')
  })
})
await t('MUTANT KILLED: pillarOut digs a guarded ceiling instead of answering `guarded` -> the route is not the guard branch', async () => {
  await withMutants(REFLEX_PATH, [
    ["    if (head0 && head0.boundingBox === 'block' && !guardMay(bot, head0)) return ESCAPE_GUARDED\n", ''],
    ['      if (!guardMay(bot, head)) return ESCAPE_GUARDED   // escapeguard-01: a guarded ceiling RETURNS too, never digStraightUp\n', ''],
    ["  if (blocking && blocking.boundingBox === 'block' && !guardMay(bot, blocking)) return ESCAPE_GUARDED   // escapeguard-01\n", ''],
    ['      if (!guardMay(bot, above)) return ESCAPE_GUARDED   // escapeguard-01\n', ''],
  ], async M => {
    const w = FROST(), bot = makeBot(w, { inv: [PICK(100), COBBLE(64)] })
    guarded(bot)
    const out = await M.pillarOut(bot, climbNeedAbove((x, y, z) => bot.blockAt(V(x, y, z)), bot.entity.position))
    assert.notStrictEqual(climbOutcomeRoute(out), 'guarded', `the mutant still answered ${out}`)
  })
})
await t('MUTANT KILLED: the route forgets `guarded` -> it falls to the failure counter (the pickaxe ask)', async () => {
  await withMutant(CLIMBFLOOD_PATH, "  if (outcome === ESCAPE_GUARDED) return 'guarded'", '', async M => {
    assert.strictEqual(M.climbOutcomeRoute(ESCAPE_GUARDED), 'attempt')
  })
  assert.strictEqual(climbOutcomeRoute(ESCAPE_GUARDED), 'guarded')
})
await t('MUTANT KILLED: a guarded ceiling not sidestepped -> the Frost bot stays under the planks', async () => {
  await withMutant(REFLEX_PATH, '      if (plan.flood || ceilGuarded) {\n', '      if (plan.flood) {\n', async M => {
    const w = FROST(), bot = makeBot(w, { inv: [PICK(100), COBBLE(64)] })
    guarded(bot)
    await M.pillarOut(bot, climbNeedAbove((x, y, z) => bot.blockAt(V(x, y, z)), bot.entity.position))
    const g = await M.guardBranch(bot, { handler: 'entombed', refusals: 0 })
    assert.strictEqual(g.progressed, false)
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
