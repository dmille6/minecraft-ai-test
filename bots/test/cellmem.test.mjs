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
        REFUSE_WINDOW_MS, MAX_ENTRIES, MAX_VISITS, TRIP_CAP, CELL } = M
const LIMIT32 = 32   // an explore cell-trip limit under test (explore enforces whatever limit it is given)
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
await t('EXEMPTIONS (pure): ore, then underground, then night without a bed; a surface log by day, or at night with a bed, is refusable', () => {
  assert.equal(typeof M.exemptReason, 'function')
  const R = M.exemptReason
  assert.equal(R('oak_log', {}), null, 'control: a surface log by day is refusable')
  assert.equal(R('iron_ore', {}), 'ore'); assert.equal(R('deepslate_iron_ore', {}), 'ore'); assert.equal(R('coal_ore', {}), 'ore')
  assert.equal(R('oak_log', { underground: true }), 'underground')
  assert.equal(R('oak_log', { night: true }), 'night')
  assert.equal(R('oak_log', { night: true, hasBed: true }), null, 'a bed makes a night trip acceptable')
  assert.equal(R('iron_ore', { underground: true, night: true }), 'ore')
})
await t('UNDER ROCK, NOT UNDER LEAVES: stone, deepslate or soil overhead is underground; leaves, logs and planks are tree cover', () => {
  const U = M.undergroundFrom
  assert.equal(typeof U, 'function')
  assert.equal(U(['stone']), true); assert.equal(U(['deepslate']), true); assert.equal(U(['oak_leaves', 'dirt']), true)
  assert.equal(U(['grass_block']), true, 'an overhang of turf is terrain')
  for (const cover of [['oak_leaves'], ['oak_leaves', 'oak_log'], ['birch_leaves', 'spruce_log', 'oak_planks'], ['azalea_leaves', 'vine'], []])
    assert.equal(U(cover), false, cover.join('+') || 'open sky')
})

// --------------------------------------------- DRIVEN: gather -> refuse -> explore ---
// A bot whose pathfinder walks it to each leg's goal, and a world that says what a gather returns in each column.
// Ground: solid below y=64, air above (so there is sky -- not underground). `stall`: every leg fails and the ground is
// lava, so the blind step is refused too and the bot cannot move. `blind`: every leg fails, but the blind fallback
// step really walks BLIND blocks along the yaw it looked at (mineflayer's convention, as stepLineSafe checks it). `ceiling`: 'stone' overhead (underground) or an oak 'canopy' (a trunk and leaves: not underground). `trail`
// records every position the body reached.
const BLIND = 6
function fakeBot (start = [8, 64, 8], { stall = false, blind = false, time = 6000, ceiling = false, short = 0 } = {}) {
  const bag = []
  let yaw = 0
  const bot = {
    entity: { position: new Vec3(...start) }, trail: [],
    time: { timeOfDay: time },
    registry: { blocksByName: { oak_log: { id: 17 }, birch_log: { id: 18 }, iron_ore: { id: 19 } }, itemsByName: {}, blocks: {}, items: {}, blocksArray: [] },
    inventory: { items: () => bag }, bag, heldItem: null, health: 20, food: 20,
    look: async a => { yaw = a },
    setControlState (k, on) {
      if (k !== 'forward' || !on) return
      const p = bot.entity.position
      bot.entity.position = new Vec3(p.x - Math.sin(yaw) * BLIND, p.y, p.z - Math.cos(yaw) * BLIND); bot.trail.push(bot.entity.position)   // mineflayer: yaw 0 faces -z
    },
    clearControlStates () {}, deathSitesNow: () => [],
    blockAt: v => stall ? { name: 'lava', boundingBox: 'empty' }
      : v.y < 64 ? { name: 'stone', boundingBox: 'block' }
      : ceiling === 'stone' && v.y >= start[1] + 3 ? { name: 'stone', boundingBox: 'block' }
      : ceiling === 'canopy' && v.y >= start[1] + 3 && v.y <= start[1] + 7 ? { name: v.y === start[1] + 3 ? 'oak_log' : 'oak_leaves', boundingBox: 'block' }
      : { name: 'air', boundingBox: 'empty' },
    findBlocks: () => [], findBlock: () => null,
    pathfinder: { setGoal () {}, stop () {}, goto: async g => {
      if (stall || blind) throw new Error('no path')
      const p = bot.entity.position, d = Math.hypot(g.x - p.x, g.z - p.z) || 1, k = Math.max(0, d - short) / d
      bot.entity.position = new Vec3(p.x + (g.x - p.x) * k, p.y, p.z + (g.z - p.z) * k); bot.trail.push(bot.entity.position) } },
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
await t('DRIVEN NIGHT: no bed -> no refusal and no trip, the gather runs as before and a cell_exempt row says why; with a bed it walks', async () => {
  let clock = T0; const now = () => (clock += MIN)
  const rows = []; const emit = row => rows.push(row)
  const bot = fakeBot([108, 64, 8], { time: 18000 }); const w = world(new Set(['6,0']))
  const go = () => gatherCell({ bot }, { block: 'oak_log', count: 4 }, new AbortController().signal, { inner: w.inner, now, emit })
  await go()
  bot.entity.position = new Vec3(8, 64, 8)
  await go(); await go()
  const r = await go()
  assert.equal(w.calls.length, 4, 'the third failing gather RAN')
  assert.equal(r.failClass, 'no_path'); assert.equal(here(bot), '0,0', 'no night trip')
  assert.ok(rows.some(x => x.kind === 'cell_exempt' && /reason=night/.test(x.detail)), JSON.stringify(rows.map(x => x.kind)))
  assert.ok(!rows.some(x => x.kind === 'cell_refused'))
  bot.bag.push({ name: 'red_bed', count: 1 })
  const withBed = await go()
  assert.equal(withBed.failClass, 'cell_refused', 'positive control: the same column with a bed in the bag is refused')
  assert.equal(here(bot), '6,0', `with a bed it goes to the success column: ${withBed.detail}`)
  assert.deepEqual([...new Set(rows.map(x => x.kind))].sort(), ['cell_exempt', 'cell_refused', 'cell_target'],
    'every row kind as logEvent expects it: it prefixes the underscore itself (`_${kind}`), so these land as _cell_*')
})

// ------------------------------------------------ review fixes (fa1016f, both engines) ---
const SK = await import('../src/skills.mjs')
const refuseHere = async (bot, w, now) => {
  const go = () => gatherCell({ bot }, { block: 'oak_log', count: 4 }, new AbortController().signal, { inner: w.inner, now })
  await go(); await go(); return go()
}
await t('ORDINARY EXPLORE DOES NOT UNDO IT: knownTarget skips a sighting in a column this bot refuses for that family', () => {
  const bot = fakeBot([8, 64, 56])
  bot.worldFacts = { resourcesNear: kind => kind === 'oak_log' ? [{ x: 8, y: 64, z: 8 }, { x: 8, y: 64, z: 200 }] : [], deathSites: () => [] }
  assert.equal(SK.knownTarget(bot, ['oak_log']).z, 8, 'positive control: nothing refused, the near sighting wins')
  bot.cellMemory = createCellMemory(); failTwice(bot.cellMemory, at(5, 5), Date.now() - 2 * MIN)
  const k = SK.knownTarget(bot, ['oak_log', 'birch_log'])
  assert.equal(k.z, 200, `walked back to the refused column: ${JSON.stringify(k)}`)
  assert.equal(k.cellSkipped, 1)
  assert.equal(SK.knownTarget(bot, ['sand']), null, 'another family is not affected')
})
await t('MIXED SEQUENCE: refuse -> walk -> the model explores toward logs -> it does not walk back into the refused column', async () => {
  let clock = Date.now() - 10 * MIN; const now = () => (clock += 20_000)
  const bot = fakeBot(); const w = world()
  bot.worldFacts = { resourcesNear: kind => kind === 'oak_log' ? [{ x: 8, y: 64, z: 8 }, { x: 8, y: 64, z: 200 }] : [], deathSites: () => [] }
  const r = await refuseHere(bot, w, now)
  assert.equal(r.failClass, 'cell_refused'); assert.notEqual(here(bot), '0,0')
  await SKILLS.explore.run({ bot }, { blocks: 60, toward: ['oak_log', 'birch_log', 'spruce_log'] }, new AbortController().signal)
  assert.notEqual(here(bot), '0,0', 'the ordinary explore walked the bot back to the column it was refused in')
})
await t('THE TRIP LIMIT HOLDS DURING MOVEMENT: every leg blocked, the blind fallback steps never carry the body past the limit', async () => {
  // A target beyond the limit, every pathfinder leg refused, blind steps that really walk: the blocked-leg turn
  // alternates (+60, -60), so the fallback walks steadily outward -- the case the limit exists for.
  const bot = fakeBot(undefined, { blind: true })
  const seq = [0.2, 0.8]; let i = 0
  const realRandom = Math.random; Math.random = () => seq[i++ % 2]
  try { await SKILLS.explore.run({ bot }, { blocks: 120, cellTarget: { x: 108, z: 8, kind: 'log cell 6,0', limit: LIMIT32 } }, new AbortController().signal) } finally { Math.random = realRandom }
  assert.ok(bot.trail.length >= 3, `positive control: the blind steps really moved the body (${bot.trail.length})`)
  const far = Math.max(...bot.trail.map(p => Math.hypot(p.x - 8, p.z - 8)))
  assert.ok(far <= LIMIT32, `the body reached ${far.toFixed(0)} blocks from the trip start against a limit of ${LIMIT32}`)
  assert.ok(far >= LIMIT32 - 2 * BLIND, `and it did walk out toward the limit (${far.toFixed(0)})`)
})
await t('THE LIMIT HOLDS FOR LEGS THAT WORK: a target past the limit, every leg walkable -> the body stops at the limit', async () => {
  const bot = fakeBot()
  const r = await SKILLS.explore.run({ bot }, { blocks: 120, cellTarget: { x: 108, z: 8, kind: 'log cell 6,0', limit: LIMIT32 } }, new AbortController().signal)
  const far = Math.max(...bot.trail.map(p => Math.hypot(p.x - 8, p.z - 8)))
  assert.ok(far <= LIMIT32, `the body reached ${far.toFixed(0)} against a limit of ${LIMIT32}: ${r.detail}`)
  assert.ok(far >= LIMIT32 - 4, `positive control: it walked out to the limit (${far.toFixed(0)})`)
})
await t('THE CAP IS PASSED: by day and at night with a bed the trip carries TRIP_CAP; at night without one there is no walk', async () => {
  const limits = []
  const walk = async (_ctx, a) => { limits.push(a.cellTarget.limit); return { status: 'success', detail: 'x' } }
  for (const [time, bed] of [[18000, false], [6000, false], [18000, true]]) {
    let clock = T0; const now = () => (clock += MIN)
    const bot = fakeBot(undefined, { time }); if (bed) bot.bag.push({ name: 'white_bed', count: 1 })
    const w = world()
    const go = () => gatherCell({ bot }, { block: 'oak_log', count: 4 }, new AbortController().signal, { inner: w.inner, now, walk })
    await go(); await go(); await go()
  }
  assert.deepEqual(limits, [TRIP_CAP, TRIP_CAP])
})
await t('ABORTED WALK: a walk that throws and leaves the bot in the refused column ends the chain', async () => {
  let clock = T0; const now = () => (clock += MIN)
  const bot = fakeBot(); const w = world()
  const go = walk => gatherCell({ bot }, { block: 'oak_log', count: 4 }, new AbortController().signal, { inner: w.inner, now, walk })
  await go(); await go()
  await assert.rejects(go(async () => { throw Object.assign(new Error('aborted'), { aborted: true }) }))
  assert.equal(w.calls.length, 2)
  await go()
  assert.equal(w.calls.length, 3, 'the next gather was refused again from the same spot')
})
await t('BARELY MOVED: a walk of 6 blocks that stays in the column ends the chain (no second refusal from there)', async () => {
  let clock = T0; const now = () => (clock += MIN)
  const bot = fakeBot([2, 64, 2]); const w = world()
  const go = walk => gatherCell({ bot }, { block: 'oak_log', count: 4 }, new AbortController().signal, { inner: w.inner, now, walk })
  await go(); await go()
  const r = await go(async ctx => { ctx.bot.entity.position = new Vec3(8, 64, 2); return { status: 'no_effect', failClass: 'stuck', detail: 'barely moved' } })
  assert.equal(r.failClass, 'cell_refused'); assert.equal(here(bot), '0,0')
  await go()
  assert.equal(w.calls.length, 3, 'refused again from the column the walk could not leave')
})
await t('UNDERGROUND / ORE, DRIVEN: an ore and a gather under a stone ceiling are never refused, and each says so in a cell_exempt row', async () => {
  let clock = T0; const now = () => (clock += MIN)
  const rows = []; const emit = row => rows.push(row)
  const iron = fakeBot(); const wi = world()
  const gi = () => gatherCell({ bot: iron }, { block: 'iron_ore', count: 3 }, new AbortController().signal, { inner: wi.inner, now, emit })
  await gi(); await gi(); await gi()
  assert.equal(wi.calls.length, 3, 'an iron gather was refused')
  const deep = fakeBot(undefined, { ceiling: 'stone' }); const wd = world()
  const gd = () => gatherCell({ bot: deep }, { block: 'oak_log', count: 3 }, new AbortController().signal, { inner: wd.inner, now, emit })
  await gd(); await gd(); await gd()
  assert.equal(wd.calls.length, 3, 'a gather under rock was refused')
  assert.deepEqual(rows.filter(x => x.kind === 'cell_exempt').map(x => /reason=(\w+)/.exec(x.detail)[1]), ['ore', 'underground'])
})
await t('UNDER AN OAK CANOPY (the main population): repeated failures ARE refused -- leaves and trunks overhead are not underground', async () => {
  let clock = T0; const now = () => (clock += MIN)
  const bot = fakeBot(undefined, { ceiling: 'canopy' }); const w = world()
  assert.equal(bot.blockAt(new Vec3(8, 68, 8)).boundingBox, 'block', 'positive control: there IS a solid canopy overhead')
  const r = await refuseHere(bot, w, now)
  assert.equal(w.calls.length, 2, 'the third gather under the canopy ran: a tree read as rock')
  assert.equal(r.failClass, 'cell_refused')
})
await t('EXEMPT ROWS ARE THROTTLED, AND EVERY ROW IS NAMED AS LOGGED (logEvent prefixes one underscore)', async () => {
  let clock = T0; const now = () => (clock += 10_000)   // every call reads the clock; 8 gathers stay well inside 10 min
  const rows = []; const emit = row => rows.push(row)
  const bot = fakeBot(undefined, { time: 18000 }); const w = world()
  const go = () => gatherCell({ bot }, { block: 'oak_log', count: 4 }, new AbortController().signal, { inner: w.inner, now, emit })
  for (let i = 0; i < 8; i++) await go()
  assert.ok(clock - T0 < M.EXEMPT_LOG_MS, 'the window under test')
  const ex = rows.filter(x => x.kind === 'cell_exempt')
  assert.ok(ex.length >= 1, 'positive control: the exemption was logged')
  assert.ok(ex.length <= 1, `${ex.length} exempt rows for 6 exemptions inside ${M.EXEMPT_LOG_MS / MIN} min`)
  clock += M.EXEMPT_LOG_MS; await go()
  assert.equal(rows.filter(x => x.kind === 'cell_exempt').length, 2, 'after the window the next exemption is logged again')
  for (const x of rows) assert.ok(!x.kind.startsWith('_'), `${x.kind} would be logged as _${x.kind}`)
})
await t('SUCCESS TARGETS: not nearer than 32 blocks (same search disc) and not older than 2 h', () => {
  const mem = createCellMemory()
  recordGather(mem, { pos: at(8, 26), family: 'log', result: {}, gained: 1, now: T0 })        // 18 blocks off
  failTwice(mem, at(8, 8), T0)
  const near = chooseTarget(mem, { pos: at(8, 8), family: 'log', now: T0 + 2 * MIN })
  assert.notEqual(near.source, 'success', `a success column ${near.dist} blocks off is the same search`)
  recordGather(mem, { pos: at(8, 70), family: 'log', result: {}, gained: 1, now: T0 })
  assert.equal(chooseTarget(mem, { pos: at(8, 8), family: 'log', now: T0 + 2 * MIN }).source, 'success', 'control: 62 blocks off is a target')
  const stale = chooseTarget(mem, { pos: at(8, 8), family: 'log', now: T0 + 2 * MIN + 2 * 3600_000 + 1 })
  assert.notEqual(stale.source, 'success', 'a success 2 h old is not where it works now')
  assert.equal(M.SUCCESS_FRESH_MS, 2 * 3600_000)
})
await t('REACHABLE CAP: the trip is capped at what one explore covers, and a target at the cap registers arrival', async () => {
  assert.ok(TRIP_CAP <= 120, `cap ${TRIP_CAP}`)
  let clock = T0; const now = () => (clock += MIN)
  const bot = fakeBot([8, 64, 8 + TRIP_CAP - 5], { short: 3 }); const w = world(new Set([here({ entity: { position: { x: 8, z: 8 + TRIP_CAP - 5 } } })]))
  const go = () => gatherCell({ bot }, { block: 'oak_log', count: 4 }, new AbortController().signal, { inner: w.inner, now })
  assert.equal((await go()).status, 'success')
  const goal = here(bot)
  bot.entity.position = new Vec3(8, 64, 8)
  await go(); await go()
  const r = await go()
  assert.match(r.detail, /\(success, \d+b\): arrived/, r.detail)
  assert.equal(here(bot), goal)
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
