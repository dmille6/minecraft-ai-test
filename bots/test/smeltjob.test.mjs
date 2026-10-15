// THE TOWN SMELT JOB AND THE FURNACE DRAIN (smeltjob-01, stage 1 of docs/reports/townprojects-design-2026-10-14.md).
//
// Behaviour, not text: every decision is a pure export of smeltjob.mjs and is driven here directly; the furnace lease is
// driven against a real directory (two holders, expiry, a torn record, a race through two generations); `smelt` is run
// against a fake furnace whose only furnace is leased by another bot; and the DISPATCH runs through the REAL
// CognitiveLoop: a ready rung wins, a bot away from town never gets the order, and a skip does not loop.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-smeltjob'
process.env.BOT_NAME = process.env.BOT_NAME || 'SmeltBot'
process.env.MEMORY_SCOPE = 'shared'
process.env.MEMORY_POOL = 'hive-test'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.FAILED_COOLDOWN_MS = '1'
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'sj-pool-'))
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
delete process.env.SMELT_JOB

import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')

const SJ = await import('../src/smeltjob.mjs')
const FL = await import('../src/furnacelease.mjs')
const CF = await import('../src/chestfull.mjs')
const W = await import('../src/well.mjs')
const { SKILLS, SKILL_CONTRACTS, UNKNOWN_FAIL_CLASSES, pickLeasedFurnace, classifyOutcome, closingContents, townFurnaces } = await import('../src/skills.mjs')
const { RUNNER_REFUSALS } = await import('../src/milestones.mjs')
const { HOUSEKEEPING } = await import('../src/hygiene.mjs')
const { tapRecords } = await import('../src/logger.mjs')

// ---- the switch, and the milestone gate --------------------------------------------------------------------------
test('ON by default in every shared-town scope; OFF in isolated pools (owner D2) and by SMELT_JOB=0|off', () => {
  for (const scope of ['shared', 'board', 'checkpoint', 'private']) assert.equal(SJ.smeltJobEnabled({}, scope).on, true, scope)
  assert.equal(SJ.smeltJobEnabled({}, 'isolated').on, false)
  for (const v of ['0', 'off', 'OFF', 'false', 'no']) assert.equal(SJ.smeltJobEnabled({ SMELT_JOB: v }, 'shared').on, false, v)
  assert.equal(SJ.smeltJobEnabled({ SMELT_JOB: '1' }, 'shared').on, true)
})

test('a ready milestone step HOLDS the job: an order already chosen, or a rung waiting only on room', () => {
  assert.equal(SJ.milestoneHolds({ order: { skill: 'craft' }, ready: {} }), true)
  assert.equal(SJ.milestoneHolds({ order: null, ready: { noRoom: { item: 'stone_pickaxe', short: 1 } } }), true)
  assert.equal(SJ.milestoneHolds({ order: null, ready: {} }), false)
  assert.equal(SJ.milestoneHolds({}), false)
})

// ---- the smelt order -----------------------------------------------------------------------------------------------
const T0 = 10_000_000
const base = { now: T0, on: true, atTown: true, holds: false, held: { coal: 3 }, freeSlots: 5, townMiss: false, state: {} }

test('the order: issued at town with room; the reasons it is not are named (skips, never refusals)', () => {
  const r = SJ.smeltTownOrder(base)
  assert.equal(r.order?.skill, 'smelt_town'); assert.equal(r.skip, null)
  assert.equal(r.state.lastIssuedAt, T0, 'the cooldown is charged when it is issued')
  assert.equal(SJ.smeltTownOrder({ ...base, on: false }).skip, 'off')
  assert.equal(SJ.smeltTownOrder({ ...base, holds: true }).skip, 'milestone')
  assert.equal(SJ.smeltTownOrder({ ...base, atTown: false }).skip, 'away')
  assert.equal(SJ.smeltTownOrder({ ...base, freeSlots: SJ.SMELT_JOB_MIN_FREE - 1 }).skip, 'room')
  assert.equal(SJ.smeltTownOrder({ ...base, state: { lastIssuedAt: T0 - 1000 } }).skip, 'cooldown')
  assert.equal(SJ.smeltTownOrder({ ...base, state: { backoffUntil: T0 + 1 } }).skip, 'cooldown')
  assert.equal(SJ.smeltTownOrder({ ...base, state: { pausedUntil: T0 + 1 } }).skip, 'paused')
  assert.equal(SJ.smeltTownOrder({ ...base, state: { lastIssuedAt: T0 - SJ.SMELT_JOB_COOLDOWN_MS } }).order?.skill, 'smelt_town', 'the cooldown ends')
})

test('the order: a town that showed no copper (complete coverage) is skipped -- unless the bag carries its own', () => {
  let scans = 0
  const miss = () => { scans++; return true }
  const r = SJ.smeltTownOrder({ ...base, townMiss: miss })
  assert.equal(r.order, null); assert.equal(r.skip, 'town_has_none'); assert.equal(scans, 1)
  assert.equal(r.state.lastIssuedAt, T0, 'the LOOK is charged, so the town memory is read once per cooldown, not every decision')
  const again = SJ.smeltTownOrder({ ...base, townMiss: miss, state: r.state, now: T0 + 1000 })
  assert.equal(again.skip, 'cooldown'); assert.equal(scans, 1, 'no second scan inside the cooldown')
  const carried = SJ.smeltTownOrder({ ...base, held: { raw_copper: 3, coal: 1 }, townMiss: miss })
  assert.equal(carried.order?.skill, 'smelt_town'); assert.match(carried.order.why, /holds 3 raw_copper/)
  // cheap gates first: a held order never reads the town
  scans = 0; SJ.smeltTownOrder({ ...base, holds: true, townMiss: miss }); SJ.smeltTownOrder({ ...base, freeSlots: 0, townMiss: miss })
  assert.equal(scans, 0)
})

test('the outcome: success clears; a failure backs off; SIX of one reason pause the job for 6 h; a reflex costs nothing', () => {
  let s = SJ.smeltTownOutcome('failed', 'no_path', T0, {})
  assert.equal(s.backoffUntil, T0 + SJ.SMELT_JOB_BACKOFF_MS)
  s = {}
  for (let i = 0; i < SJ.SMELT_JOB_PAUSE_AFTER - 1; i++) s = SJ.smeltTownOutcome('no_effect', 'town_has_none', T0 + i, s)
  assert.ok(!(s.pausedUntil > 0), 'five are not a pause')
  s = SJ.smeltTownOutcome('no_effect', 'town_has_none', T0 + 10, s)
  assert.equal(s.pausedUntil, T0 + 10 + SJ.SMELT_JOB_PAUSE_MS, 'the sixth pauses')
  let m = {}
  for (const why of ['town_has_none', 'no_furnace', 'town_has_none', 'no_furnace', 'town_has_none', 'no_furnace']) m = SJ.smeltTownOutcome('no_effect', why, T0, m)
  assert.ok(!(m.pausedUntil > 0), 'alternating reasons are not one dead end repeating')
  let a = { streak: { why: 'town_has_none', n: 5 } }
  a = SJ.smeltTownOutcome('aborted', 'interrupted', T0, a)
  assert.equal(a.streak.n, 5, 'an interruption is no strike')
  assert.equal(SJ.smeltTownOutcome('success', 'done', T0, { streak: { why: 'x', n: 4 } }).streak, null)
})

// ---- the drain -----------------------------------------------------------------------------------------------------
test('the drain pick: unlit, unleased, within the town radius, not known empty (unless lit since or stale); nearest first', () => {
  const F = (k, dist, lit = false) => ({ k, dist, lit })
  const furnaces = [F('a', 30), F('b', 10, true), F('c', 12), F('d', 60), F('e', 5)]
  const seen = { e: { empty: true, at: T0 - 1000, litSince: false } }
  const p = SJ.drainPick({ furnaces, leased: k => k === 'c', seen, now: T0 })
  assert.equal(p.k, 'a', 'e known empty, b cooking, c leased, d outside the radius')
  assert.equal(SJ.drainPick({ furnaces, leased: () => false, seen: { e: { ...seen.e, litSince: true } }, now: T0 }).k, 'e', 'lit since it was seen empty: look again')
  assert.equal(SJ.drainPick({ furnaces, leased: () => false, seen: { e: { ...seen.e, at: T0 - SJ.DRAIN_EMPTY_TTL_MS } }, now: T0 }).k, 'e', 'an old look expires')
  assert.equal(SJ.drainPick({ furnaces: [F('b', 1, true)], now: T0 }), null)
  const lit = SJ.noteFurnacesLit(seen, [F('e', 5, true)])
  assert.equal(lit.e.litSince, true)
})

test('the drain order: the same gates as the smelt order; nothing to drain is a skip', () => {
  const b = { now: T0, on: true, atTown: true, holds: false, freeSlots: 4, state: {} }
  const o = SJ.drainOrder({ ...b, pick: { k: '1,70,2' } }).order
  assert.equal(o?.skill, 'furnace_drain'); assert.deepEqual(o.args, {}, 'housekeeping declares no args: the skill re-picks'); assert.match(o.why, /1,70,2/)
  assert.equal(SJ.drainOrder({ ...b, pick: null }).skip, 'nothing_to_drain')
  assert.equal(SJ.drainOrder({ ...b, holds: true, pick: { k: 'x' } }).skip, 'milestone')
  assert.equal(SJ.drainOrder({ ...b, freeSlots: 1, pick: { k: 'x' } }).skip, 'room')
  assert.equal(SJ.drainOrder({ ...b, atTown: false, pick: { k: 'x' } }).skip, 'away')
  assert.equal(SJ.drainOutcome('failed', 'no_path', T0, {}).backoffUntil, T0 + SJ.DRAIN_BACKOFF_MS)
})

// ---- the copper balance (the read's C1, one boundary) ------------------------------------------------------------
test('the copper balance: one boundary, no in-flight allowance; a loss and a gain are both defects; uncertain is never ok', () => {
  const ok = SJ.copperBalance({ bag0: 0, withdrawn: 8, prior: 0, deposited: 8, bag1: 0 })
  assert.equal(ok.verdict, 'ok')
  assert.equal(SJ.copperBalance({ bag0: 0, withdrawn: 8, deposited: 7, bag1: 0 }).verdict, 'loss')
  assert.equal(SJ.copperBalance({ bag0: 2, withdrawn: 8, deposited: 10, bag1: 1 }).verdict, 'gain')
  assert.equal(SJ.copperBalance({ bag0: 0, withdrawn: 8, deposited: 9, bag1: 0, pickedUp: 1 }).verdict, 'ok', 'a pickup on the walk explains a gain')
  assert.equal(SJ.copperBalance({ bag0: 0, withdrawn: 8, prior: 3, deposited: 11, bag1: 0 }).verdict, 'ok', 'prior furnace stock is IN')
  assert.equal(SJ.copperBalance({ bag0: 0, withdrawn: 8, deposited: 8, bag1: 0, uncertain: true }).verdict, 'unreconciled')
})

test('the row formats stay under the logger\'s 300-char detail cap with every field at its widest', () => {
  const wide = SJ.smeltTownDetail({ stop: 'smelt:furnace_window', n: 8, bag0: 64, withdrawn: 8, coal: 1, smelted: 8, prior: 64, deposited: 136, bag1: 0,
    furnaceLeft: '?', furnace: '-12345,-64,-12345', lease: 'unleased', verdict: 'unreconciled', diff: -128, chest: '-12345,-64,-12345', t0: 1760500000000 })
  assert.ok(wide.length < 300, `${wide.length}`)
  const d = SJ.drainDetail({ stop: 'drain_timeout', furnace: '-12345,-64,-12345', lease: 'unleased', out: 'copper_ingot:64', inp: 'raw_copper:64', fuel: 'coal:64', taken: 192, left: 'timeout', t0: 1760500000000 })
  assert.ok(d.length < 300, `${d.length}`)
})

// ---- the lease ---------------------------------------------------------------------------------------------------
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sj-lease-'))
const P = { x: 10, y: 64, z: -3 }

test('lease: one holder at a time; release frees it; a held lease is busy for another; the holder may renew', () => {
  const dir = tmp()
  const a = FL.acquireFurnaceLease(dir, P, 'A', { now: T0 })
  assert.equal(a.ok, true); assert.equal(a.n, 1)
  const b = FL.acquireFurnaceLease(dir, P, 'B', { now: T0 + 1 })
  assert.equal(b.ok, false); assert.equal(b.busy, true); assert.equal(b.holder, 'A')
  assert.equal(FL.furnaceLeaseState(dir, P, { now: T0 + 2 }).live, true)
  const a2 = FL.acquireFurnaceLease(dir, P, 'A', { now: T0 + 3 })
  assert.equal(a2.ok, true, 'the holder takes its own furnace again (a placed replacement, a retry)')
  a.release(); a2.release()
  assert.equal(FL.furnaceLeaseState(dir, P, { now: T0 + 4 }).live, false)
  const b2 = FL.acquireFurnaceLease(dir, P, 'B', { now: T0 + 5 })
  assert.equal(b2.ok, true); assert.ok(b2.n > a2.n, 'a NEW generation, never a reused number')
  assert.equal(FL.acquireFurnaceLease(dir, { x: 11, y: 64, z: -3 }, 'C', { now: T0 }).ok, true, 'another furnace is independent')
})

test('lease: a crashed holder frees the furnace by TTL; a torn record is live until it is older than any lease', () => {
  const dir = tmp()
  FL.acquireFurnaceLease(dir, P, 'A', { now: T0 })
  assert.equal(FL.acquireFurnaceLease(dir, P, 'B', { now: T0 + FL.FURNACE_LEASE_TTL_MS - 1 }).ok, false)
  assert.equal(FL.acquireFurnaceLease(dir, P, 'B', { now: T0 + FL.FURNACE_LEASE_TTL_MS }).ok, true, 'expired')
  assert.equal(FL.leaseLive({ rec: null, mtimeMs: T0, now: T0 + 1000 }), true, 'torn and young: held')
  assert.equal(FL.leaseLive({ rec: null, mtimeMs: T0, now: T0 + FL.FURNACE_LEASE_TTL_MS }), false, 'torn and old: free')
  assert.equal(FL.leaseLive({ rec: { until: T0 + 10 }, released: true, now: T0 }), false, 'released')
})

test('lease: a writer that loses to a HIGHER generation steps back (the race through two numbers); old generations are pruned', () => {
  const dir = tmp()
  FL.acquireFurnaceLease(dir, P, 'A', { now: T0 }).release()
  // B is about to create g2; meanwhile C (who read g1 too) jumps to g3 -- simulated by writing g3 first
  fs.writeFileSync(path.join(dir, 'furnace-leases', '10_64_-3.g3.json'), JSON.stringify({ holder: 'C', until: T0 + 100_000 }))
  const b = FL.acquireFurnaceLease(dir, P, 'B', { now: T0 + 1 })
  assert.equal(b.ok, false, 'g3 is live and not B\'s'); assert.equal(b.holder, 'C')
  const d = tmp()
  for (let i = 0; i < 9; i++) FL.acquireFurnaceLease(d, P, 'A', { now: T0 + i }).release()
  const left = fs.readdirSync(path.join(d, 'furnace-leases')).filter(n => n.endsWith('.json'))
  assert.equal(left.length, FL.KEEP_GENERATIONS); assert.ok(left.includes('10_64_-3.g9.json'), 'the newest is never pruned')
})

test('lease: the race AFTER the create -- a rival writes g(N+1) between this writer\'s create of gN and its re-list: this writer steps back', () => {
  const dir = tmp()
  FL.acquireFurnaceLease(dir, P, 'A', { now: T0 }).release()          // g1, released
  const orig = fs.writeFileSync
  fs.writeFileSync = function (file, data, opts) {
    const r = orig.call(fs, file, data, opts)
    if (String(file).endsWith('10_64_-3.g2.json')) orig.call(fs, path.join(dir, 'furnace-leases', '10_64_-3.g3.json'), JSON.stringify({ holder: 'C', until: T0 + 100_000 }), { flag: 'wx' })
    return r
  }
  let b
  try { b = FL.acquireFurnaceLease(dir, P, 'B', { now: T0 + 1 }) } finally { fs.writeFileSync = orig }
  assert.equal(b.ok, false, 'B created g2 but C holds g3'); assert.equal(b.holder, 'C')
  assert.ok(fs.existsSync(path.join(dir, 'furnace-leases', '10_64_-3.g2.released')), 'B marked its own generation released')
  assert.equal(FL.furnaceLeaseState(dir, P, { now: T0 + 2 }).holder, 'C')
})

test('lease: FAIL-OPEN when the directory is unusable -- the session runs as on the base, flagged unleased', () => {
  const file = path.join(tmp(), 'not-a-dir'); fs.writeFileSync(file, 'x')
  const r = FL.acquireFurnaceLease(file, P, 'A', { now: T0 })
  assert.equal(r.ok, true); assert.equal(r.unleased, true)
})

// ---- smelt with a leased furnace -----------------------------------------------------------------------------------
function furnaceWorld ({ furnaces = [new Vec3(2, 70, 0)], bag = { raw_iron: 4, coal: 2 } } = {}) {
  const inv = { ...bag }
  return {
    entity: { position: new Vec3(0, 70, 0), velocity: { y: 0 } }, username: 'SmeltBot', health: 20, food: 20,
    registry: mcData,
    inventory: { items: () => Object.entries(inv).filter(([, c]) => c > 0).map(([name, count], i) => ({ name, count, type: mcData.itemsByName[name].id, slot: 9 + i })) },
    findBlocks: ({ maxDistance }) => furnaces.filter(p => p.distanceTo(new Vec3(0, 70, 0)) <= maxDistance),
    findBlock: ({ matching }) => { const p = furnaces[0]; if (!p) return null; const b = { type: mcData.blocksByName.furnace.id, position: p }; return matching(b) ? b : null },
    blockAt: p => (furnaces.some(q => q.equals(p)) ? { type: mcData.blocksByName.furnace.id, name: 'furnace', position: p } : { type: 0, name: 'air', position: p }),
  }
}

test('pickLeasedFurnace: the nearest UNLEASED furnace; every one leased -> busy with their holders', () => {
  const dir = tmp()
  const near = new Vec3(2, 70, 0), far = new Vec3(9, 70, 0)
  const bot = furnaceWorld({ furnaces: [far, near] })
  FL.acquireFurnaceLease(dir, near, 'Other', { now: Date.now() })
  const p = pickLeasedFurnace(bot, { dir })
  assert.ok(p.block.position.equals(far), 'the near one is leased: the far one'); assert.equal(p.unleased, false)
  p.lease.release()
  FL.acquireFurnaceLease(dir, far, 'Third', { now: Date.now() })
  const q = pickLeasedFurnace(bot, { dir })
  assert.equal(q.block, null); assert.deepEqual(q.busy.sort(), ['Other', 'Third'])
})

test('smelt: the only furnace in reach is in another bot\'s session and none is carried -> furnace_busy (no_effect: no lesson, no attempt, no craft)', async () => {
  const pos = new Vec3(2, 70, 0)
  const bot = furnaceWorld({ furnaces: [pos] })
  const dir = process.env.POOL_STATE_DIR
  const held = FL.acquireFurnaceLease(dir, pos, 'OtherBot:1', { now: Date.now() })
  try {
    const r = await SKILLS.smelt.run({ bot }, { item: 'raw_iron', count: 4 }, null)
    assert.equal(r.status, 'no_effect'); assert.equal(r.failClass, 'furnace_busy')
    assert.ok(RUNNER_REFUSALS.has('furnace_busy'), 'not an executed attempt at the rung')
    assert.match(r.detail, /smelt again in a few minutes/)
    assert.ok(!/craft/.test(r.detail), 'never "craft a furnace" for a busy one')
    assert.ok(UNKNOWN_FAIL_CLASSES.has('furnace_busy'))
    assert.equal(bot.inventory.items().find(i => i.name === 'raw_iron')?.count, 4, 'nothing moved')
  } finally { held.release() }
})

// ---- the copper miss in the town's memory --------------------------------------------------------------------------
test('copper miss: per container, 2 h, cleared when the container takes items; town-wide only with COMPLETE coverage', () => {
  const e = {}
  CF.noteItemMisses(e, SJ.COPPER_MISS_KEY, SJ.COPPER_MISS_TTL_MS, ['1,70,1', '2,70,2'], T0)
  assert.equal(CF.containerItemMiss(e, SJ.COPPER_MISS_KEY, SJ.COPPER_MISS_TTL_MS, '1,70,1', T0 + 1), true)
  assert.equal(CF.containerItemMiss(e, SJ.COPPER_MISS_KEY, SJ.COPPER_MISS_TTL_MS, '1,70,1', T0 + SJ.COPPER_MISS_TTL_MS), false, 'expired')
  assert.equal(CF.townItemMissComplete(e, SJ.COPPER_MISS_KEY, SJ.COPPER_MISS_TTL_MS, ['1,70,1', '2,70,2'], T0 + 1), true)
  assert.equal(CF.townItemMissComplete(e, SJ.COPPER_MISS_KEY, SJ.COPPER_MISS_TTL_MS, ['1,70,1', '2,70,2', '3,70,3'], T0 + 1), false, 'a container never looked in')
  e['2,70,2'] = { o: 'took', at: T0 + 5 }
  assert.equal(CF.containerItemMiss(e, SJ.COPPER_MISS_KEY, SJ.COPPER_MISS_TTL_MS, '2,70,2', T0 + 6), false, 'a deposit since may have brought copper')
  assert.equal(CF.containerPickMiss(e, '1,70,1', T0 + 1), false, 'the pickaxe miss is a different key')
})

// ---- D8: building stone off the junk list ----------------------------------------------------------------------
test('D8: stone_bricks and smooth_stone are not junk (the well and the prune leave them); the other scaffold decorations still are', () => {
  for (const n of ['stone_bricks', 'smooth_stone']) {
    assert.equal(W.isWellJunk(n), false, n); assert.equal(W.WELL_JUNK.has(n), false, n)
    assert.equal(W.disposePlan([{ name: n, count: 30, slot: 9 }, { name: 'cobblestone', count: 64, slot: 10 }]).stacks.length, 0, `${n} is never thrown`)
  }
  // POSITIVE CONTROL: the same plan still throws a decoration that stayed listed
  assert.equal(W.isWellJunk('andesite'), true)
  assert.deepEqual(W.disposePlan([{ name: 'mossy_cobblestone', count: 30, slot: 9 }, { name: 'cobblestone', count: 64, slot: 10 }]).stacks.map(s => s.name), ['mossy_cobblestone'])
  assert.deepEqual([...W.BUILDING_STONES], ['stone_bricks', 'smooth_stone'])
})

// ---- wiring --------------------------------------------------------------------------------------------------------
test('wiring: both are housekeeping, chatOnly (the model can never choose them), with contracts the runner can grade', () => {
  for (const s of ['smelt_town', 'furnace_drain']) {
    assert.ok(HOUSEKEEPING.has(s), s); assert.equal(SKILLS[s]?.chatOnly, true, s); assert.ok(SKILL_CONTRACTS[s], s)
  }
  const graded = classifyOutcome('smelt_town', 'success', { inventory: {}, smelted: 8 }, null)
  assert.ok((graded.because ?? graded.evidence ?? []).join?.(' ').includes('smelt_effect') || JSON.stringify(graded).includes('smelt_effect'), JSON.stringify(graded))
  const none = classifyOutcome('smelt_town', 'success', { inventory: {}, smelted: 0 }, null)
  assert.ok(!JSON.stringify(none).includes('smelt_effect'), 'nothing smelted is no evidence')
})

// ---- the skill: the cheap exit (the full run is the Paper scene) --------------------------------------------------
test('smelt_town: no copper in the bag and no town container -> a no_effect SKIP with its row; nothing moves', async () => {
  const bot = {
    entity: { position: new Vec3(1, 70, 1), velocity: { y: 0 } }, username: 'SmeltBot', registry: mcData,
    inventory: { items: () => [{ name: 'coal', count: 2, type: mcData.itemsByName.coal.id, slot: 9 }] },
    findBlock: () => null, findBlocks: () => [], blockAt: p => ({ type: 0, name: 'air', position: p }),
  }
  const rows = []
  const untap = tapRecords?.(r => rows.push(r))
  try {
    const r = await SKILLS.smelt_town.run({ bot }, {}, null)
    assert.equal(r.status, 'no_effect'); assert.equal(r.stop, 'town_has_none')
  } finally { untap?.() }
  const row = rows.find(x => x?.skill?.name === '_smelt_town')
  if (tapRecords) {
    assert.ok(row, 'one _smelt_town row, always')
    assert.match(row.skill.detail, /stop=town_has_none .* verdict=ok/)
  }
})

// ---- the CHAIN, through the REAL CognitiveLoop --------------------------------------------------------------------
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-sj-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
const item = (name, count, slot) => ({ name, count, slot, type: mcData.itemsByName[name].id, stackSize: mcData.itemsByName[name].stackSize })

/** A bot at town (or not) carrying raw copper and coal; `craftReady` makes the stone-pickaxe rung a ready work order. */
function chainBot ({ at = new Vec3(3, 70, 0), craftReady = false } = {}) {
  // the towndeposit CHAIN's bag (its active rung is the stone pickaxe), plus copper and coal, at 12 of 36 slots
  const rows = [['dirt', 16], ['oak_log', 64], ['oak_log', 64], ['sand', 8], ['cobblestone', 64], ['cobblestone', 20], ['crafting_table', 1],
    ['wooden_pickaxe', 1], ['stick', 8], ['furnace', 1], ['raw_copper', 6], ['coal', 3]]
  const items = rows.map(([n, c], i) => item(n, c, 9 + i))
  const wp = items.find(i => i.name === 'wooden_pickaxe'); wp.maxDurability = mcData.itemsByName.wooden_pickaxe.maxDurability; wp.durabilityUsed = wp.maxDurability - 50
  return {
    entity: { position: at, velocity: { x: 0, y: 0, z: 0 } }, registry: mcData, controlState: {}, currentWindow: null,
    inventory: { inventoryStart: 9, items: () => items },
    health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
    recipesFor: id => (craftReady && id === mcData.itemsByName.stone_pickaxe.id ? [{ delta: [] }] : []), recipesAll: () => [],
    findBlock: () => null, findBlocks: () => [], blockAt: p => ({ type: 0, name: 'air', position: p, boundingBox: 'empty' }),
    clearControlStates: () => {}, setControlState: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'SmeltBot',
    pathfinder: { goto: async () => {}, setGoal: () => {} }, removeListener: () => {}, once: () => {}, on: () => {}, _client: {},
  }
}
/** n real decisions; the runner records each dispatched skill and returns `answer(skill)` (default success). */
async function decisions (bot, n, answer = () => ({ status: 'success', detail: 'ok' })) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    ran.push(skill)
    const r = answer(skill, args)
    return { delta: {}, contractEvidence: r.status === 'success' ? [`${skill}: probe`] : [], ...r }
  } }
  const loop = new CognitiveLoop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 300 && ran.length < n; i++) await new Promise(r => setTimeout(r, 20))
  loop.stop()
  return { ran, loop }
}

const TOWN_FIRST = new Set(['build_well', 'dispose_well', 'close_well', 'town_deposit', 'count_town', 'compost', 'build_composter', 'withdraw_pick', 'wear_out', 'prune_town'])
test('CHAIN: at town, no ready rung, copper and coal carried -> smelt_town runs after the town\'s own orders and BEFORE the model', async () => {
  // the town's earlier orders (here: the junk well's build, which this bag can start) answer no_effect so the chain moves on
  const { ran } = await decisions(chainBot(), 4, skill => (TOWN_FIRST.has(skill) ? { status: 'no_effect', detail: 'skip' } : { status: 'success', detail: 'ok' }))
  const i = ran.indexOf('smelt_town')
  assert.ok(i >= 0, JSON.stringify(ran))
  assert.ok(ran.slice(0, i).every(s => TOWN_FIRST.has(s)), `only the town's own orders come before it: ${JSON.stringify(ran)}`)
  assert.ok(!ran.slice(0, i).includes('status'), 'the model never takes the turn first')
})

test('CHAIN: a READY RUNG WINS -- the same bot with a craft-ready stone pickaxe gets the craft, never the smelt job', async () => {
  const { ran, loop } = await decisions(chainBot({ craftReady: true }), 1)
  assert.match(loop.milestones.current()?.id ?? '', /stone_pickaxe/)
  assert.equal(ran[0], 'craft', JSON.stringify(ran))
  assert.ok(!ran.includes('smelt_town'))
})

test('CHAIN CONTROL: the same bot away from town never gets the order (never a trip)', async () => {
  const { ran } = await decisions(chainBot({ at: new Vec3(200, 70, 0) }), 3)
  assert.ok(!ran.includes('smelt_town') && !ran.includes('furnace_drain'), JSON.stringify(ran))
})

test('CHAIN, A SKIP DOES NOT LOOP: smelt_town finding nothing (no_effect) -> the next decisions go to the model, not the job', async () => {
  const { ran, loop } = await decisions(chainBot(), 6, skill => (skill === 'smelt_town' ? { status: 'no_effect', detail: 'nothing', stop: 'town_has_none' } : TOWN_FIRST.has(skill) ? { status: 'no_effect', detail: 'skip' } : { status: 'success', detail: 'ok' }))
  assert.ok(ran.includes('smelt_town'), JSON.stringify(ran))
  assert.equal(ran.filter(s => s === 'smelt_town').length, 1, `one order per cooldown: ${JSON.stringify(ran)}`)
  assert.equal(loop.smeltJobState?.streak?.why, 'town_has_none', 'the outcome reached the state (the pause counter)')
})

test('CHAIN, A FAILURE BACKS OFF: smelt_town failed -> backoff set; the bot goes on with other work', async () => {
  const { ran, loop } = await decisions(chainBot(), 3, skill => (skill === 'smelt_town' ? { status: 'failed', failClass: 'no_path', detail: 'x', stop: 'error' } : { status: 'success', detail: 'ok' }))
  assert.equal(ran.filter(s => s === 'smelt_town').length, 1, JSON.stringify(ran))
  assert.ok(loop.smeltJobState?.backoffUntil > Date.now())
})

// ---- the stagnation watchdog honours a declared stationary window (smeltjob-01: an 80 s furnace session) ------------
test('WATCHDOG: busy and motionless for a whole window inside a DECLARED stationary window is not stagnant; the same without it is (control)', async () => {
  const { StagnationWatchdog } = await import('../src/watchdog.mjs')
  const { config } = await import('../src/config.mjs')
  const realNow = Date.now
  async function run (declared) {
    let now = realNow()
    Date.now = () => now
    try {
      const cancels = []
      const bot = { entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20, inventory: { items: () => [] },
        time: { age: 1, day: 1 }, game: { dimension: 'overworld' }, pathfinder: { getPathTo: () => null, movements: {} }, quit () {},
        stationaryUntil: 0 }
      const wd = new StagnationWatchdog(bot, { isBusy: () => true, cancel: r => cancels.push(r), resume () {}, run: async () => {} },
        { running: true, milestones: { allDone: false } })
      for (let i = 0; i * config.watchdog.sampleMs <= config.watchdog.windowMs * 1.05; i++) {
        bot.stationaryUntil = declared ? now + 60_000 : 0; bot.furnaceWindowUntil = declared ? now + 60_000 : 0
        wd.lastActionAt = now
        await wd.check()
        now += config.watchdog.sampleMs
      }
      return cancels
    } finally { Date.now = realNow }
  }
  assert.ok((await run(false)).includes('stagnation'), 'positive control: the same stillness without a window IS judged stagnant')
  assert.deepEqual(await run(true), [], 'inside a declared window it is not')
})

// ---- the runner carries the job's own count into the evidence gate (Paper 10-15: a real job graded `unknown`) -------
test('RUNNER: a smelt_town that smelted 8 (its own count, the bag back where it began) passes the evidence gate; one that smelted 0 does not', async () => {
  const { Runner } = await import('../src/runner.mjs')
  const bot = { entity: { position: new Vec3(0, 70, 0) }, health: 20, food: 20, entities: {}, inventory: { items: () => [] },
    registry: { blocksByName: {}, itemsByName: {}, items: {}, blocks: {} }, blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
    findBlock: () => null, pathfinder: { setGoal () {} }, chat () {} }
  const original = SKILLS.smelt_town.run
  try {
    SKILLS.smelt_town.run = async () => ({ status: 'success', detail: 'smelted 8', smelted: 8 })
    const ok = await new Runner(bot).run('smelt_town', {})
    assert.equal(ok.status, 'success', ok.detail); assert.match(ok.contractEvidence.join(';'), /smelt_effect: 8/)
    SKILLS.smelt_town.run = async () => ({ status: 'success', detail: 'nothing', smelted: 0 })
    const none = await new Runner(bot).run('smelt_town', {})
    assert.equal(none.status, 'unknown', 'a claimed success with nothing smelted is downgraded')
  } finally { SKILLS.smelt_town.run = original }
})

// ---- the fixes of code review r1 ---------------------------------------------------------------------------------
const W2 = await import('../src/watchdog.mjs')
test('WATCHDOG (Codex r1 P1-2): busy history BEFORE a furnace session cannot cancel it; a declared window is not busy time; a genuinely stuck bot after it is still judged', async () => {
  const { config } = await import('../src/config.mjs')
  const realNow = Date.now
  const STEP = config.watchdog.sampleMs, WIN = config.watchdog.windowMs
  async function scenario (plan) {   // plan(i, now) -> 'busy' | 'furnace' | 'idle'
    let now = realNow(); Date.now = () => now
    try {
      const cancels = []; let busy = false
      const bot = { entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20, inventory: { items: () => [] },
        time: { age: 1, day: 1 }, game: { dimension: 'overworld' }, pathfinder: { getPathTo: () => null, movements: {} }, quit () {}, stationaryUntil: 0, furnaceWindowUntil: 0 }
      const wd = new W2.StagnationWatchdog(bot, { isBusy: () => busy, cancel: r => cancels.push(r), resume () {}, run: async () => {} }, { running: true, milestones: { allDone: false } })
      for (let i = 0; i * STEP <= WIN * 2; i++) {
        const st = plan(i)
        busy = st !== 'idle'
        bot.furnaceWindowUntil = st === 'furnace' ? now + 60_000 : 0; bot.stationaryUntil = st === 'furnace' ? now + 60_000 : 0
        wd.lastActionAt = now
        await wd.check()
        now += STEP
      }
      return cancels
    } finally { Date.now = realNow }
  }
  const n = Math.ceil(WIN / STEP)
  // busy and still for most of a window, then a furnace session for the rest: never cancelled mid-session
  assert.deepEqual(await scenario(i => (i < n - 2 ? 'busy' : 'furnace')), [], 'the session is not judged; its busy prelude is not judged while it runs')
  // short busy (withdraw) + a furnace session + short busy (deposit), repeated: the furnace time is not busy time
  assert.deepEqual(await scenario(i => (i % 8 === 0 || i % 8 === 7 ? 'busy' : 'furnace')), [])
  // POSITIVE CONTROL: busy and still the whole time with no furnace session IS stagnant
  assert.ok((await scenario(() => 'busy')).includes('stagnation'))
  // ...and a furnace session that ENDS, followed by a genuinely stuck stretch, is judged again
  assert.ok((await scenario(i => (i < 4 ? 'furnace' : 'busy'))).includes('stagnation'), 'stuck after the session is still caught')
  assert.equal(W2.activeSpanMs([{ t: 0 }, { t: 10 }, { t: 20 }], 0, 20), 20, 'no furnace samples: exactly the base span')
  assert.equal(W2.activeSpanMs([{ t: 0 }, { t: 10, furnace: true }, { t: 20 }], 0, 20), 0)
})

test('THE P1 DEAD END (Claude code r1 P1), through the REAL loop: a bot whose iron rung is smelt-ready and whose only furnace is busy is NOT driven to the give-up; the same smelt failing for a real reason is (positive control)', async () => {
  const fpos = new Vec3(4, 70, 0)
  function ironBot () {
    const rows = [['dirt', 16], ['oak_log', 64], ['oak_log', 64], ['sand', 8], ['cobblestone', 64], ['cobblestone', 64], ['crafting_table', 1],
      ['stone_pickaxe', 1], ['stick', 16], ['furnace', 1], ['raw_iron', 5], ['coal', 6], ['stone_axe', 1], ['stone_shovel', 1], ['torch', 8]]
    const items = rows.map(([n, c], i) => item(n, c, 9 + i))
    for (const it of items) if (/_(pickaxe|axe|shovel)$/.test(it.name)) { it.maxDurability = mcData.itemsByName[it.name].maxDurability; it.durabilityUsed = 0 }
    const b = chainBot()
    b.inventory = { inventoryStart: 9, items: () => items }
    b.findBlock = ({ matching }) => { const x = { type: mcData.blocksByName.furnace.id, name: 'furnace', position: fpos }; const ok = typeof matching === 'function' ? matching(x) : Array.isArray(matching) ? matching.includes(x.type) : matching === x.type; return ok ? x : null }
    b.blockAt = p => (p.equals?.(fpos) ? { type: mcData.blocksByName.furnace.id, name: 'furnace', position: p } : { type: 0, name: 'air', position: p, boundingBox: 'empty' })
    return b
  }
  const run = async answer => decisions(ironBot(), 6, (skill, args) => (skill === 'smelt' ? answer : { status: 'success', detail: 'ok' }))
  const busy = await run({ status: 'no_effect', failClass: 'furnace_busy', detail: 'busy' })
  const rung = busy.loop.milestones.current()?.id
  assert.match(rung ?? '', /^smelt_iron_ingot/, `the iron rung is active (${rung})`)
  assert.ok(busy.ran.filter(s => s === 'smelt').length >= 4, `the rung's smelt order was dispatched repeatedly: ${JSON.stringify(busy.ran)}`)
  assert.equal(busy.loop.milestones.attempts[rung] ?? 0, 0, 'a busy furnace is not an attempt: no progress toward the give-up')
  const real = await run({ status: 'failed', failClass: 'other', detail: 'broken' })
  assert.ok((real.loop.milestones.attempts[real.loop.milestones.current()?.id] ?? 0) >= 4, 'positive control: a real failure DOES count')
})

test('FUEL (Claude code r1 P2-2): the job\'s smelt burns only coal or charcoal -- a bag of planks and logs is NO fuel for it; the rung\'s smelt still burns them (base)', async () => {
  const bot = furnaceWorld({ bag: { raw_copper: 4, oak_planks: 20, oak_log: 10 } })
  const job = await SKILLS.smelt.run({ bot }, { item: 'raw_copper', count: 4 }, null, { fuels: ['coal', 'charcoal'] })
  assert.equal(job.failClass, 'missing_ingredients'); assert.equal(job.gap, 'fuel', job.detail)
  const base = await SKILLS.smelt.run({ bot: furnaceWorld({ bag: { raw_copper: 4, oak_planks: 20 } }) }, { item: 'raw_copper', count: 4 }, null)
  assert.notEqual(base.gap, 'fuel', 'positive control: without the allow-list planks are fuel (the walk to the fake furnace follows)')
})

test('THE CLOSING READ (Codex code r1 P1-3): empty only when every slot was read empty; leftovers named; an unreadable slot is unreconciled', () => {
  assert.deepEqual(closingContents({ output: null, input: null, fuel: null }), { items: {}, unreadable: false, empty: true })
  const left = closingContents({ output: null, input: { name: 'raw_copper', count: 8 }, fuel: { name: 'coal', count: 1 } })
  assert.equal(left.empty, false); assert.equal(left.items.raw_copper, 8)
  assert.equal(closingContents({ output: undefined, input: null, fuel: null }).unreadable, true)
  assert.equal(closingContents(null).unreadable, true)
})

test('DRAIN HEIGHT (Claude code r1 P2-3): a furnace more than TOWN_DY below (or above) home is never a drain target; one at town level is', () => {
  const near = new Vec3(5, 70, 5), deep = new Vec3(6, 30, 6)
  const bot = { registry: mcData, findBlocks: () => [near, deep],
    blockAt: p => ({ type: mcData.blocksByName.furnace.id, name: 'furnace', position: p, getProperties: () => ({ lit: false }) }) }
  const ks = townFurnaces(bot).map(f => f.k)
  assert.deepEqual(ks, ['5,70,5'])
})

test('CARRY RECOVERY (Codex code r1 P2-6): an interrupted job costs no strike, and once the cooldown passes the next order takes the bag\'s carried copper first -- even when the town shows none', () => {
  let s = SJ.smeltTownOrder({ ...base, state: {} }).state                     // issued at T0
  s = SJ.smeltTownOutcome('aborted', 'interrupted', T0 + 1000, s)
  assert.ok(!(s.backoffUntil > T0) && !s.streak, 'no backoff, no strike')
  const soon = SJ.smeltTownOrder({ ...base, now: T0 + 60_000, held: { raw_copper: 8, coal: 0 }, townMiss: true, state: s })
  assert.equal(soon.skip, 'cooldown')
  const next = SJ.smeltTownOrder({ ...base, now: T0 + SJ.SMELT_JOB_COOLDOWN_MS, held: { raw_copper: 8, coal: 0 }, townMiss: true, state: s })
  assert.equal(next.order?.skill, 'smelt_town'); assert.match(next.order.why, /bag holds 8 raw_copper/)
})

test('THE TALLY (Codex code r1 P2-8): every at-town decision is counted by what happened to the job slot (taken / issued / the skip), before any cooldown', async () => {
  const { loop } = await decisions(chainBot(), 4, skill => (TOWN_FIRST.has(skill) ? { status: 'no_effect', detail: 'skip' } : { status: 'success', detail: 'ok' }))
  const c = loop.smeltTally?.c ?? {}
  assert.ok((c.issued ?? 0) >= 1, JSON.stringify(c))
  assert.ok(Object.values(c).reduce((a, b) => a + b, 0) >= 4, `every decision tallied: ${JSON.stringify(c)}`)
  const away = await decisions(chainBot({ at: new Vec3(200, 70, 0) }), 2)
  assert.equal(away.loop.smeltTally, undefined, 'away from town nothing is tallied (the denominator is at-town decisions)')
})

test('FAIL CLOSED (Codex code r1 P2-5): when the lease cannot be recorded, the JOB\'s smelt does not share the furnace (furnace_busy); the rung\'s smelt keeps the base behaviour (fail-open)', async () => {
  const pos = new Vec3(2, 70, 0)
  const saved = process.env.POOL_STATE_DIR
  const file = path.join(tmp(), 'not-a-dir'); fs.writeFileSync(file, 'x')
  process.env.POOL_STATE_DIR = file
  try {
    const job = await SKILLS.smelt.run({ bot: furnaceWorld({ furnaces: [pos], bag: { raw_copper: 4, coal: 2 } }) }, { item: 'raw_copper', count: 4 }, null, { requireLease: true, fuels: ['coal', 'charcoal'] })
    assert.equal(job.failClass, 'furnace_busy', job.detail); assert.match(job.detail, /could not be recorded|in use/)
    const p2 = pickLeasedFurnace(furnaceWorld({ furnaces: [pos] }))
    assert.equal(p2.unleased, true, 'positive control: the base path is fail-open (the rung smelts as before)')
  } finally { process.env.POOL_STATE_DIR = saved }
})

test('a COMPOST/DEPOSIT window is not a furnace window, even after a hard-stopped furnace session (Claude code r2 P3): the exemption keys on its own deadline', () => {
  const now = Date.now()
  assert.equal(W2.furnaceWindow({ stationaryUntil: now + 30_000, furnaceWindowUntil: now - 1 }), false, 'a later compost window, a stale furnace one')
  assert.equal(W2.furnaceWindow({ stationaryUntil: now + 30_000, furnaceWindowUntil: now + 30_000 }), true)
})

test('HOLDS WIRING through the REAL loop (Codex code r1/r2 P2-9): a stone-pickaxe rung withheld for room (readyFor -> noRoom, short 1) on a bag with 2 free slots -- the smelt job, which has its two slots, does NOT take the turn', async () => {
  const id = n => mcData.itemsByName[n].id
  const b = chainBot()
  const items = [item('cobblestone', 64, 9), item('stick', 10, 10), item('crafting_table', 1, 11), item('raw_copper', 6, 12), item('coal', 3, 13),
    item('dirt', 16, 14), item('oak_log', 64, 15), item('oak_log', 64, 16), item('sand', 8, 17), item('furnace', 1, 18), item('wooden_pickaxe', 1, 19)]
  const wp = items.find(i => i.name === 'wooden_pickaxe'); wp.maxDurability = mcData.itemsByName.wooden_pickaxe.maxDurability; wp.durabilityUsed = wp.maxDurability - 50
  for (let i = 0; items.length < 34; i++) items.push(item('white_wool', 1 + (i % 3), 20 + i))
  b.inventory = { inventoryStart: 9, items: () => items }
  // a recipe whose result needs three new stacks: a genuine `noRoom` from the real craftRoomCheck at 34 of 36 slots
  const recipe = { delta: [{ id: id('cobblestone'), count: -3 }, { id: id('stick'), count: -2 }, { id: id('stone_pickaxe'), count: 1 }, { id: id('oak_button'), count: 1 }, { id: id('stone_button'), count: 1 }],
    result: { id: id('stone_pickaxe'), count: 1 }, inShape: null, ingredients: null, requiresTable: false }
  b.recipesFor = iid => (iid === id('stone_pickaxe') ? [recipe] : [])
  const rows = []; const untap = tapRecords(r => rows.push(r))
  let res
  try { res = await decisions(b, 4, skill => (TOWN_FIRST.has(skill) ? { status: 'no_effect', detail: 'skip' } : { status: 'success', detail: 'ok' })) } finally { untap() }
  assert.match(res.loop.milestones.current()?.id ?? '', /stone_pickaxe/, 'the stone-pickaxe rung is active')
  assert.ok(rows.some(r => r?.skill?.name === '_craft_noroom'), 'the rung really was withheld for room (craft_noroom row): the condition was reached')
  assert.ok(!res.ran.includes('smelt_town'), `the job never took the turn: ${JSON.stringify(res.ran)}`)
  assert.ok((res.loop.smeltTally?.c?.milestone ?? 0) >= 1, `the job's slot saw the milestone hold: ${JSON.stringify(res.loop.smeltTally?.c)}`)
})

test('THE CARRY RETURN (Codex code r2 P2-6): ingots alone in the bag make the order eligible even when the town shows no copper', () => {
  const r = SJ.smeltTownOrder({ ...base, held: { copper_ingot: 6 }, townMiss: true })
  assert.equal(r.order?.skill, 'smelt_town'); assert.match(r.order.why, /6 copper ingots from an earlier job/)
  assert.equal(SJ.smeltTownOrder({ ...base, held: {}, townMiss: true }).skip, 'town_has_none', 'control: nothing carried, nothing in town')
})
