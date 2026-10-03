// THE SAME BOT FAILING ON THE SAME SPOT: remember the column, refuse there, and WALK somewhere it worked.
//
// Measured 10-03: 696 of 1,062 hard gather failures (65.5%) were the same bot failing within 16 blocks of its own
// failure in the previous 30 min (town-map-plan-2026-10-03.md, stage 1). The decisions are pure and exported
// (cellmem.mjs); the wrapper is driven through SKILLS.gather.run and the real explore with a fake bot whose
// pathfinder walks it, so the CHAIN -- refuse, walk, gather, refuse again -- is tested as a chain.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-cellmem'
const M = await import('../src/cellmem.mjs')
const { familyOf, createCellMemory, recordGather, refusalFor, chooseTarget, cellOf, isRefusedCell, visit,
        REFUSE_WINDOW_MS, MAX_ENTRIES, MAX_VISITS, NIGHT_NEAR, TRIP_CAP, CELL } = M
const { SKILLS, gatherCell, aimLeg } = await import('../src/skills.mjs')
const { evidenceScope, EVIDENCE_ABOUT_THE_ACTION, EVIDENCE_ONLY_IF_STUCK, EVIDENCE_ONLY_IF_HERE } = await import('../src/cognitive.mjs')
const { UNKNOWN_FAIL_CLASSES } = await import('../src/skills.mjs')
const { createRequire } = await import('node:module')
const { Vec3 } = createRequire(import.meta.url)('vec3')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

const MIN = 60_000
const T0 = 1_000_000_000
const NOPATH = { status: 'failed', failClass: 'no_path', detail: 'oak_log found but unreachable after 3 attempts [collect threw nothing -- it returned without gathering]' }
const at = (x, z) => ({ x, y: 64, z })
const failTwice = (mem, pos, t0 = T0, family = 'log') => {
  recordGather(mem, { pos, family, result: NOPATH, now: t0 })
  recordGather(mem, { pos, family, result: NOPATH, now: t0 + MIN })
}

// ------------------------------------------------------------- the memory ---
await t('families: every log is one family (as explore-toward groups them); deepslate ores are their ore', () => {
  for (const b of ['oak_log', 'birch_log', 'spruce_log', 'minecraft:dark_oak_log', 'log']) assert.equal(familyOf(b), 'log', b)
  assert.equal(familyOf('deepslate_iron_ore'), 'iron_ore'); assert.equal(familyOf('sand'), 'sand'); assert.equal(familyOf(null), null)
})
await t('a hard failure is recorded with its reason; nothing_found and inventory_full are NOT failures (positive control first)', () => {
  const mem = createCellMemory()
  const e = recordGather(mem, { pos: at(5, 5), family: 'log', result: NOPATH, now: T0 })
  assert.equal(e.fail, 1, 'positive control: the same call shape records a no_path')
  assert.deepEqual(e.reasons, { 'no_path:collect_threw_nothing': 1 })
  for (const fc of ['unreachable', 'no_safe_target']) assert.equal(recordGather(mem, { pos: at(40, 5), family: 'log', result: { status: 'failed', failClass: fc }, now: T0 }).fail >= 1, true, fc)
  const m2 = createCellMemory()
  for (const fc of ['nothing_found', 'inventory_full', 'collect_budget', 'canopy_refused']) {
    assert.equal(recordGather(m2, { pos: at(5, 5), family: 'log', result: { status: fc === 'collect_budget' ? 'unknown' : 'failed', failClass: fc }, now: T0 }), null, fc)
  }
  assert.equal(m2.entries.size, 0); assert.equal(m2.visits.size, 1, 'but the column was visited')
})
await t('success is ITEMS GAINED, not the status: a "failed" with logs in the bag is a success; a "success" with none is not', () => {
  const mem = createCellMemory()
  assert.equal(recordGather(mem, { pos: at(5, 5), family: 'log', result: NOPATH, gained: 2, now: T0 }).ok, 1)
  assert.equal(recordGather(mem, { pos: at(40, 5), family: 'log', result: { status: 'success' }, gained: 0, now: T0 }), null)
})
await t('BOUNDED: 5,000 columns stay within MAX_ENTRIES and MAX_VISITS (oldest dropped)', () => {
  const mem = createCellMemory()
  for (let i = 0; i < 5000; i++) recordGather(mem, { pos: at(i * 16, 0), family: 'log', result: NOPATH, now: T0 + i })
  for (let i = 0; i < 5000; i++) visit(mem, at(0, i * 16), T0 + i)
  assert.ok(mem.entries.size <= MAX_ENTRIES && mem.entries.size > 0, `entries ${mem.entries.size}`)
  assert.ok(mem.visits.size <= MAX_VISITS, `visits ${mem.visits.size}`)
  assert.ok(mem.entries.has(`${4999},0|log`) && !mem.entries.has('0,0|log'), 'the newest kept, the oldest dropped')
})

// ------------------------------------------------------------ the refusal ---
await t('THRESHOLD: one hard failure in the column is not a refusal; two are', () => {
  const mem = createCellMemory()
  recordGather(mem, { pos: at(5, 5), family: 'log', result: NOPATH, now: T0 })
  assert.equal(refusalFor(mem, at(9, 9), 'log', T0 + MIN), null)
  recordGather(mem, { pos: at(6, 6), family: 'log', result: NOPATH, now: T0 + MIN })
  const r = refusalFor(mem, at(9, 9), 'log', T0 + 2 * MIN)
  assert.equal(r?.fails, 2); assert.equal(r.cell, '0,0'); assert.equal(r.reason, 'no_path:collect_threw_nothing')
})
await t('NO SUCCESS SINCE: fail, fail, then a success clears it; one fail after the success is not a refusal', () => {
  const mem = createCellMemory()
  failTwice(mem, at(5, 5))
  assert.ok(refusalFor(mem, at(5, 5), 'log', T0 + 2 * MIN), 'positive control: refused before the success')
  recordGather(mem, { pos: at(5, 5), family: 'log', result: { status: 'success' }, gained: 3, now: T0 + 3 * MIN })
  assert.equal(refusalFor(mem, at(5, 5), 'log', T0 + 4 * MIN), null, 'a success since clears the column')
  recordGather(mem, { pos: at(5, 5), family: 'log', result: NOPATH, now: T0 + 5 * MIN })
  assert.equal(refusalFor(mem, at(5, 5), 'log', T0 + 6 * MIN), null)
})
await t('WINDOW: two failures 31 min old are not a refusal; another family and the next column are unaffected', () => {
  const mem = createCellMemory()
  failTwice(mem, at(5, 5))
  assert.ok(refusalFor(mem, at(5, 5), 'log', T0 + 29 * MIN))
  assert.equal(refusalFor(mem, at(5, 5), 'log', T0 + MIN + REFUSE_WINDOW_MS + 1), null)
  assert.equal(refusalFor(mem, at(5, 5), 'sand', T0 + 2 * MIN), null)
  assert.equal(refusalFor(mem, at(20, 5), 'log', T0 + 2 * MIN), null)
})
await t('NON-VOTING: cell_refused is in no evidence set and is not an unknown class, so it can teach no lesson', () => {
  assert.equal(evidenceScope('cell_refused'), null)
  for (const s of [EVIDENCE_ABOUT_THE_ACTION, EVIDENCE_ONLY_IF_STUCK, EVIDENCE_ONLY_IF_HERE, UNKNOWN_FAIL_CLASSES]) assert.ok(!s.has('cell_refused'))
  assert.equal(evidenceScope('no_path'), 'action', 'positive control: the class it replaces DOES vote')
})

// ----------------------------------------------------------- the target ---
await t('TARGET 1: the nearest column where the family worked for this bot', () => {
  const mem = createCellMemory()
  recordGather(mem, { pos: at(100, 8), family: 'log', result: {}, gained: 1, now: T0 })
  recordGather(mem, { pos: at(8, 60), family: 'log', result: {}, gained: 1, now: T0 })
  recordGather(mem, { pos: at(8, 30), family: 'sand', result: {}, gained: 1, now: T0 })
  failTwice(mem, at(8, 8), T0 + MIN)
  const g = chooseTarget(mem, { pos: at(8, 8), family: 'log', now: T0 + 3 * MIN })
  assert.equal(g.source, 'success'); assert.deepEqual([g.cx, g.cz], [0, 3])
})
await t('TARGET EXCLUSION: a success column with two hard failures since is not "where it worked"', () => {
  const mem = createCellMemory()
  recordGather(mem, { pos: at(8, 60), family: 'log', result: {}, gained: 1, now: T0 })
  failTwice(mem, at(8, 60), T0 + MIN)
  recordGather(mem, { pos: at(100, 8), family: 'log', result: {}, gained: 1, now: T0 })
  failTwice(mem, at(8, 8), T0 + 3 * MIN)
  const g = chooseTarget(mem, { pos: at(8, 8), family: 'log', now: T0 + 5 * MIN })
  assert.equal(g.source, 'success'); assert.deepEqual([g.cx, g.cz], [6, 0], `went to ${g.cx},${g.cz}: the failed forest was not excluded`)
  assert.ok(isRefusedCell(mem, 0, 3, 'log', T0 + 5 * MIN), 'and that column is refused')
})
await t('TARGET 2: no success known -> the nearest column in the ring not visited in 4 h, toward the bearing', () => {
  const mem = createCellMemory()
  failTwice(mem, at(8, 8))
  const g = chooseTarget(mem, { pos: at(8, 8), family: 'log', now: T0 + 2 * MIN, bearing: 0 })
  assert.equal(g.source, 'frontier'); assert.ok(g.dist >= 32 && g.dist <= 96, `${g.dist}`)
  assert.deepEqual([g.cx, g.cz], [2, 0], 'ties go toward the bearing (+x)')
  visit(mem, at(40, 8), T0 + 2 * MIN)
  const h = chooseTarget(mem, { pos: at(8, 8), family: 'log', now: T0 + 3 * MIN, bearing: 0 })
  assert.notDeepEqual([h.cx, h.cz], [2, 0], 'a column visited inside 4 h is not the frontier')
  const later = chooseTarget(mem, { pos: at(8, 8), family: 'log', now: T0 + 5 * 3600_000, bearing: 0 })
  assert.deepEqual([later.cx, later.cz], [2, 0], 'and is again after 4 h')
})
await t('TARGET 2 EXCLUSION: a refused column is never the frontier, even once its visit has aged out of the bounded map', () => {
  const mem = createCellMemory()
  failTwice(mem, at(8, 8))
  failTwice(mem, at(40, 8))
  mem.visits.delete('2,0')   // LRU eviction (MAX_VISITS) loses the visit; the failures are still inside 30 min
  const g = chooseTarget(mem, { pos: at(8, 8), family: 'log', now: T0 + 2 * MIN, bearing: 0 })
  assert.equal(g.source, 'frontier')
  assert.notDeepEqual([g.cx, g.cz], [2, 0], 'walked into a column refused minutes ago')
})
await t('TARGET 3: every ring column visited -> the explore bearing, turned away from a refused column', () => {
  const mem = createCellMemory()
  for (let cx = -8; cx <= 8; cx++) for (let cz = -8; cz <= 8; cz++) visit(mem, at(cx * 16 + 8, cz * 16 + 8), T0)
  failTwice(mem, at(8, 8), T0)
  const g = chooseTarget(mem, { pos: at(8, 8), family: 'log', now: T0 + 2 * MIN, bearing: 0 })
  assert.equal(g.source, 'bearing'); assert.equal(g.x, 68)
  failTwice(mem, at(68, 8), T0)
  const h = chooseTarget(mem, { pos: at(8, 8), family: 'log', now: T0 + 2 * MIN, bearing: 0 })
  assert.equal(h.source, 'bearing'); assert.ok(!isRefusedCell(mem, h.cx, h.cz, 'log', T0 + 2 * MIN))
  assert.notEqual(h.x, 68, 'the refused column at the end of the bearing is not walked into')
})
await t('CAP: a success column 200 blocks away is not a trip', () => {
  const mem = createCellMemory()
  recordGather(mem, { pos: at(208, 8), family: 'log', result: {}, gained: 1, now: T0 })
  failTwice(mem, at(8, 8), T0)
  const g = chooseTarget(mem, { pos: at(8, 8), family: 'log', now: T0 + 2 * MIN })
  assert.notEqual(g.source, 'success'); assert.ok(g.dist <= TRIP_CAP)
})
await t('NIGHT: no trip beyond 32 blocks without a bed; with a bed, or by day, the far success column is the target', () => {
  const mem = createCellMemory()
  recordGather(mem, { pos: at(108, 8), family: 'log', result: {}, gained: 1, now: T0 })
  failTwice(mem, at(8, 8), T0)
  const q = { pos: at(8, 8), family: 'log', now: T0 + 2 * MIN }
  assert.equal(chooseTarget(mem, q).source, 'success', 'positive control: by day it goes')
  assert.equal(chooseTarget(mem, { ...q, night: true, hasBed: true }).source, 'success')
  const n = chooseTarget(mem, { ...q, night: true })
  assert.ok(n.none || n.dist <= NIGHT_NEAR, `night walk of ${n.dist} to ${n.source}`)
})

// --------------------------------------------- DRIVEN: gather -> refuse -> explore ---
// A bot whose pathfinder walks it to each leg's goal, and a world that says what a gather returns in each column.
function fakeBot (start = [8, 64, 8], { stall = false, time = 6000 } = {}) {
  const bag = []
  const bot = {
    entity: { position: new Vec3(...start) },
    time: { timeOfDay: time },
    registry: { blocksByName: { oak_log: { id: 17 }, birch_log: { id: 18 } }, itemsByName: {}, blocks: {}, items: {}, blocksArray: [] },
    inventory: { items: () => bag }, bag, heldItem: null, health: 20, food: 20,
    look: async () => {}, setControlState () {}, clearControlStates () {}, deathSitesNow: () => [],
    blockAt: () => ({ name: stall ? 'lava' : 'grass_block', boundingBox: 'block' }),
    findBlocks: () => [], findBlock: () => null,
    pathfinder: { setGoal () {}, stop () {}, goto: async g => {
      if (stall) throw new Error('no path')
      bot.entity.position = new Vec3(g.x, bot.entity.position.y, g.z) } },
  }
  return bot
}
const here = bot => { const c = cellOf(bot.entity.position); return `${c.cx},${c.cz}` }
function world (good = new Set()) {
  const calls = []
  const inner = async ctx => {
    const c = here(ctx.bot); calls.push(c)
    if (good.has(c)) { ctx.bot.bag.push({ name: 'birch_log', count: 2 }); return { status: 'success', detail: 'collected 2' } }
    return { ...NOPATH }
  }
  return { inner, calls }
}

await t('DRIVEN THROUGH SKILLS.gather.run: the registry runs the wrapper; a real nothing_found is a visit, not a failure', async () => {
  assert.equal(SKILLS.gather.run, gatherCell)
  const bot = fakeBot()
  const r = await SKILLS.gather.run({ bot }, { block: 'oak_log', count: 4 }, new AbortController().signal)
  assert.equal(r.failClass, 'nothing_found')
  assert.equal(bot.cellMemory.visits.size, 1, 'positive control: the wrapper ran and saw the column')
  assert.equal(bot.cellMemory.entries.size, 0)
})
await t('DRIVEN: two hard failures, then the third gather is REFUSED and the bot WALKS (no gather in the refused column)', async () => {
  let clock = T0; const now = () => (clock += MIN)
  const bot = fakeBot(); const w = world()
  const go = () => gatherCell({ bot }, { block: 'oak_log', count: 4 }, new AbortController().signal, { inner: w.inner, now })
  await go(); await go()
  assert.equal(w.calls.length, 2)
  const r = await go()
  assert.equal(w.calls.length, 2, 'the refused gather did not run')
  assert.equal(r.status, 'no_effect'); assert.equal(r.failClass, 'cell_refused')
  assert.match(r.detail, /refused gather oak_log here \(column 0,0\): 2 no_path:collect_threw_nothing failures/)
  assert.match(r.detail, /\(frontier, \d+b\): arrived/)
  assert.notEqual(here(bot), '0,0', 'the remedy was executed: the bot left the column')
})
await t('DRIVEN: with a success column known, the walk goes THERE and the next gather succeeds', async () => {
  let clock = T0; const now = () => (clock += MIN)
  const bot = fakeBot([8, 64, 90]); const w = world(new Set(['0,5']))
  const go = () => gatherCell({ bot }, { block: 'oak_log', count: 4 }, new AbortController().signal, { inner: w.inner, now })
  assert.equal((await go()).status, 'success')
  bot.entity.position = new Vec3(8, 64, 8)
  await go(); await go()
  const r = await go()
  assert.match(r.detail, /column 0,5 \(success/); assert.equal(here(bot), '0,5')
  assert.equal((await go()).status, 'success', 'the gather after the walk ran and worked')
})
await t('THE CHAIN: refuse -> walk -> gather -> refuse again never returns to a column refused inside 30 min', async () => {
  let clock = T0; const now = () => (clock += 20_000)
  const bot = fakeBot(); const w = world()
  const go = () => gatherCell({ bot }, { block: 'oak_log', count: 4 }, new AbortController().signal, { inner: w.inner, now })
  const refusedAt = []   // [cell, time]
  let refusals = 0
  for (let i = 0; i < 30; i++) {
    const from = here(bot)
    const r = await go()
    if (r.failClass === 'cell_refused') {
      refusals++
      refusedAt.push([from, clock])
      const to = here(bot)
      for (const [c, tc] of refusedAt) assert.ok(!(c === to && clock - tc < REFUSE_WINDOW_MS), `walked back into ${c} refused ${Math.round((clock - tc) / MIN)} min ago`)
    }
  }
  assert.ok(refusals >= 5, `the chain must actually run (refusals ${refusals})`)
  assert.equal(new Set(refusedAt.map(([c]) => c)).size, refusals, 'never refused twice in one column: no loop on one spot')
})
await t("THE CHAIN ENDS on explore's own no_path: the model gets the bot back, and the column stops refusing", async () => {
  let clock = T0; const now = () => (clock += MIN)
  const bot = fakeBot(undefined, { stall: true }); const w = world()
  const go = () => gatherCell({ bot }, { block: 'oak_log', count: 4 }, new AbortController().signal, { inner: w.inner, now })
  await go(); await go()
  const r = await go()
  assert.equal(r.failClass, 'cell_refused'); assert.match(r.detail, /not arrived — could not explore/)
  assert.equal(here(bot), '0,0')
  const again = await go()
  assert.equal(w.calls.length, 3, 'the next gather RAN: no second refusal from a spot the walk could not leave')
  assert.equal(again.failClass, 'no_path')
})
await t('DRIVEN NIGHT: no bed, a success column 100 blocks off -> the walk stays within 32 blocks', async () => {
  let clock = T0; const now = () => (clock += MIN)
  const bot = fakeBot([108, 64, 8], { time: 18000 }); const w = world(new Set(['6,0']))
  const go = () => gatherCell({ bot }, { block: 'oak_log', count: 4 }, new AbortController().signal, { inner: w.inner, now })
  await go()
  bot.entity.position = new Vec3(8, 64, 8)
  await go(); await go()
  const r = await go()
  assert.equal(r.failClass, 'cell_refused')
  const moved = Math.hypot(bot.entity.position.x - 8, bot.entity.position.z - 8)
  assert.ok(moved <= NIGHT_NEAR + 1, `walked ${moved.toFixed(0)} at night without a bed`)
  bot.bag.push({ name: 'red_bed', count: 1 })
  bot.entity.position = new Vec3(8, 64, 8); clock += 40 * MIN
  await go(); await go()
  const withBed = await go()
  assert.equal(here(bot), '6,0', `with a bed it goes to the success column: ${withBed.detail}`)
})

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
await t('WIRED: explore aims a cell trip with its own legs (aimLeg), and no milestone row is written for it', () => {
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.match(sk, /const aimAt = cellTarget\?\.kind \? cellTarget : intended && known\?\.kind \? known : null/)
  assert.match(sk, /if \(aimAt && !cellTarget\) logEvent\(\{ kind: 'explore_toward_milestone_end'/)
  assert.ok(aimLeg({ x: 0, z: 0 }, { x: 3, z: 0 }).arrived)
  assert.equal(CELL, 16)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
