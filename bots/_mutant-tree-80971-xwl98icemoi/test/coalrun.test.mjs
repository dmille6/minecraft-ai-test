// COALFIRST-01 (OWNER 10-29 "Add Coal to the list of things that can be picked up, mined and deposited"): behaviour of every
// decision that makes coal a first-class resource -- pickup (never skipped), mine (the tunnel and the coal run) and deposit
// (keep 8, split the rest, the tail banks it). Pure functions over plain data; one wiring check for the cognitive slot.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-coalrun'
process.env.BOT_NAME = process.env.BOT_NAME || 'CoalBot'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'coal-pool-'))
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const C = await import('../src/coalrun.mjs')
const TD = await import('../src/towndeposit.mjs')
const OT = await import('../src/oretunnel.mjs')
const { NEVER_KEEP, neverPickUp } = await import('../src/hygiene.mjs')
const { NEVER_BANKABLE, STANDING_TARGETS } = await import('../src/bankable.mjs')
const { isWellJunk } = await import('../src/well.mjs')
const { allowanceRow } = await import('../src/bagallowance.mjs')
const { skipFoodDrop } = await import('../src/foodskip.mjs')
const { SMELT_JOB_FUEL, JOB_FUELS } = await import('../src/smeltjob.mjs')

const drop = name => ({ name: 'item', getDroppedItem: () => ({ name }) })
let slot = 9
const it = (name, count) => ({ name, count, slot: slot++ })
const sum = (list, n) => list.filter(x => x.name === n).reduce((t, x) => t + x.count, 0)

// ---- 1. PICKUP ---------------------------------------------------------------------------------------------------------
test('PICKUP: coal is on no skip, junk, disposal or allowance list (positive controls: each list does skip its own junk)', () => {
  for (const n of ['coal', 'coal_ore', 'deepslate_coal_ore']) {
    assert.equal(NEVER_KEEP.has(n), false, `${n}: hygiene NEVER_KEEP`)
    assert.equal(neverPickUp(drop(n)), false, `${n}: pickupNearbyItems would skip it`)
    assert.equal(NEVER_BANKABLE.has(n), false, `${n}: ballast`)
    assert.equal(isWellJunk(n), false, `${n}: the junk well`)
    assert.equal(TD.notForChest(n), false, `${n}: never into a chest`)
    assert.equal(allowanceRow(n), null, `${n}: a slim bag-allowance row`)
    assert.equal(skipFoodDrop(drop(n), { active: true }), false, `${n}: the peaceful food skip`)
  }
  assert.ok(STANDING_TARGETS.has('coal'), 'coal is a standing bank target')
  // positive controls: the same predicates do skip what they are for
  assert.equal(neverPickUp(drop('leaf_litter')), true)
  assert.equal(TD.notForChest('leaf_litter'), true)
  assert.equal(allowanceRow('torch'), 'torch')
})

// ---- 2. MINE (the pure coal-run decision; the tunnel and the cognitive slot: coalrun-mine.test.mjs) ----------------------
test('TOWN COAL: the index total over every container\'s latest observation; charcoal is not the job\'s fuel', () => {
  const e = obs => ({ obs: { names: obs, at: 1 } })
  assert.deepEqual(C.townCoalTotal({ a: e({ coal: [5, 1], cobblestone: [64, 1] }), b: e({ coal: [20, 1] }), c: e({ charcoal: [9, 1] }), d: { last: {} } }),
    { total: 25, containers: 3, withCoal: 2 })
  assert.deepEqual(C.townCoalTotal({}), { total: 0, containers: 0, withCoal: 0 })
  assert.deepEqual(C.townCoalTotal(null), { total: 0, containers: 0, withCoal: 0 })
  assert.equal(SMELT_JOB_FUEL, 'coal'); assert.deepEqual([...JOB_FUELS], ['coal'], 'the town job draws exactly what the run banks')
})

const base = { now: 1e9, holds: false, heldCoal: 0, freeSlots: 10, tripPick: true,
  townCoal: { ok: true, total: 0, containers: 4, site: { ok: true, hit: null } }, ore: { block: 'coal_ore', dist: 9.4 }, state: {} }
test('THE COAL RUN: issues gather of the ore in reach while the town is short; every skip names its reason', () => {
  const r = C.coalRunOrder(base)
  assert.equal(r.skip, null)
  assert.deepEqual(r.order.args, { block: 'coal_ore', count: C.COAL_RUN_COUNT, coalrun: true })
  assert.equal(r.order.skill, 'gather')
  assert.match(r.order.why, /0 coal \(< 32\)/)
  assert.equal(r.state.lastIssuedAt, base.now)
  assert.equal(C.coalRunOrder({ ...base, ore: { block: 'deepslate_coal_ore', dist: 3 } }).order.args.block, 'deepslate_coal_ore')
  const skip = (o, why) => { const x = C.coalRunOrder({ ...base, ...o }); assert.equal(x.order, null, why); assert.equal(x.skip, why) }
  skip({ on: false }, 'off')
  skip({ shared: false }, 'isolated')
  skip({ holds: true }, 'milestone')
  skip({ state: { lastIssuedAt: base.now - C.COAL_RUN_COOLDOWN_MS + 1 } }, 'cooldown')
  skip({ state: { backoffUntil: base.now + 1 } }, 'cooldown')
  skip({ heldCoal: C.COAL_RUN_CARRY }, 'carrying')
  skip({ freeSlots: C.COAL_RUN_MIN_FREE - 1 }, 'room')
  skip({ tripPick: false }, 'pickaxe')
  skip({ state: { lastScanAt: base.now - 1000 } }, 'scan')
  skip({ townCoal: { ok: false } }, 'index')
  skip({ townCoal: { ok: true, total: 0, containers: 0 } }, 'index_empty')
  skip({ townCoal: { ok: true, total: C.COAL_FLOOR, containers: 3 } }, 'stocked')
  skip({ ore: null }, 'no_ore')
  skip({ ore: { block: 'iron_ore', dist: 2 } }, 'no_ore')
  // boundaries: just under the floor issues; just under the carry issues; exactly the cooldown issues
  assert.ok(C.coalRunOrder({ ...base, townCoal: { ok: true, total: C.COAL_FLOOR - 1, containers: 1, site: { ok: true, hit: null } } }).order)
  assert.ok(C.coalRunOrder({ ...base, heldCoal: C.COAL_RUN_CARRY - 1 }).order)
  assert.ok(C.coalRunOrder({ ...base, state: { lastIssuedAt: base.now - C.COAL_RUN_COOLDOWN_MS } }).order)
  // the readings are lazy and taken only when everything cheap would issue
  let reads = 0
  C.coalRunOrder({ ...base, tripPick: false, townCoal: () => { reads++; return base.townCoal }, ore: () => { reads++; return base.ore } })
  C.coalRunOrder({ ...base, townCoal: () => { reads++; return { ok: true, total: 99, containers: 2 } }, ore: () => { reads++; return base.ore } })
  assert.equal(reads, 1, 'no read without a pickaxe; a stocked town never scans for ore')
})

test('THE COAL RUN OUTCOME: coal gained clears the backoff; none gained or a failure backs off; a decline refunds', () => {
  const issued = C.coalRunOrder({ ...base, heldCoal: 3 }).state
  const ok = C.coalRunOutcome('success', 11, base.now + 60_000, issued)
  assert.equal(ok.backoffUntil, 0); assert.equal(ok.lastGained, 8)
  const none = C.coalRunOutcome('success', 3, base.now + 60_000, issued)
  assert.equal(none.backoffUntil, base.now + 60_000 + C.COAL_RUN_BACKOFF_MS, 'a "success" that brought no coal is no success')
  const failed = C.coalRunOutcome('failed', 3, base.now + 60_000, issued)
  assert.equal(failed.backoffUntil, base.now + 60_000 + C.COAL_RUN_BACKOFF_MS)
  assert.equal(C.coalRunOrder({ ...base, now: base.now + 20 * 60_000, state: failed }).skip, 'cooldown', 'backed off past the cooldown')
  const declined = C.coalRunOutcome('failed', 3, base.now + 1, issued, { declined: true })
  assert.equal(declined.lastIssuedAt, -Infinity)
  assert.ok(C.coalRunOrder({ ...base, now: base.now + C.COAL_RUN_SCAN_MS, state: declined }).order, 'a declined run is eligible again')
})

// ---- 3. DEPOSIT --------------------------------------------------------------------------------------------------------
test('COAL KEEP: 8 of the stack while the bot smelts its own, none with nothing to smelt; COALFIRST off = the whole stack', () => {
  assert.equal(C.coalKeepOf(20, 3), C.COAL_KEEP)
  assert.equal(C.coalKeepOf(5, 3), 5, 'never more than held')
  assert.equal(C.coalKeepOf(20, 0), 0, 'nothing to smelt: every piece is the town\'s (cobblekeep-01)')
  assert.equal(C.coalKeepOf(20, 3, { on: false }), 20, 'the base rule')
  assert.deepEqual(TD.ironKeeps({ raw_iron: 3, coal: 20 }), { raw_iron: 3, coal: C.COAL_KEEP })
  assert.deepEqual(TD.ironKeeps({ raw_iron: 3, coal: 6 }), { raw_iron: 3, coal: 6 })
  assert.deepEqual(TD.ironKeeps({ raw_iron: 3, charcoal: 20 }), { raw_iron: 3, charcoal: 20 }, 'charcoal stays whole (not the town fuel)')
  assert.deepEqual(TD.ironKeeps({ iron_ingot: 2, coal: 30 }), { iron_ingot: 2 }, 'nothing raw: all the coal goes')
  assert.deepEqual(TD.ironKeeps({ raw_iron: 3, coal: 4, charcoal: 9 }), { raw_iron: 3, coal: 4 }, 'coal first; charcoal not kept beside it (the base)')
})

test('THE FULL-BAG TOWN DEPOSIT banks the coal above the keep: the stack is split, never below 8 (it banked 0 of 20 before)', () => {
  slot = 9
  const filler = n => Array.from({ length: n }, (_, i) => it(`white_wool`, 1 + (i % 3)))   // unbankable filler slots
  const bagOf = coal => [it('raw_iron', 3), ...coal.map(n => it('coal', n)), it('stone_pickaxe', 1), ...filler(34 - coal.length)]
  for (const coal of [[20], [64], [13], [24, 16], [9]]) {
    const items = bagOf(coal)
    const p = TD.townDepositPlan(items, { noSwords: false })
    const moved = p.steps.filter(s => s.name === 'coal').reduce((t, s) => t + s.count, 0)
    const held = coal.reduce((a, b) => a + b, 0)
    assert.ok(held - moved >= C.COAL_KEEP, `${coal}: kept ${held - moved} >= ${C.COAL_KEEP}`)
    if (held >= 2 * (C.COAL_KEEP + 1)) assert.ok(moved > 0, `${coal}: some coal is banked`)
    // the base never banked any of it (positive control: the switch off)
    const off = TD.townDepositPlan(items, { noSwords: false, coalSplit: false })
    assert.equal(off.steps.filter(s => s.name === 'coal' && s.half).length, 0)
  }
  // 20 coal, keep 8: one half of 10 moves (12 may leave; the next half, 5, would still fit, but leaves only 5 -- logHalfSteps)
  slot = 9
  const p = TD.townDepositPlan(bagOf([20]), { noSwords: false })
  assert.deepEqual(p.steps.filter(s => s.name === 'coal').map(s => [s.count, s.from, s.half]), [[10, 20, true]])
})

test('THE NOT-FULL VISIT\'S TAIL banks coal above the keep, as it does logs; the order says so', () => {
  slot = 9
  const items = [it('raw_iron', 3), it('coal', 20), it('stone_pickaxe', 1), it('cobblestone', 30)]
  const p = TD.townDepositPlan(items, { tail: 'only', noSwords: false })
  assert.deepEqual(p.steps.map(s => [s.name, s.count]), [['coal', 10]], 'only the coal half (no other base-plan name in a tail)')
  const pos = { x: 1, y: 70, z: 1 }, home = { x: 0, y: 70, z: 0 }
  const r = TD.tailOrder({ now: 1e9, slots: items.length, pos, home, plan: p, container: true, on: true })
  assert.ok(r.order, 'a not-full bag with coal above the keep is a tail order')
  assert.equal(r.order.args.coal, true)
  assert.match(r.order.why, /coal above the bag's keep/)
  // nothing to smelt: the whole stack goes (keep 0), freeing a slot
  slot = 9
  const q = TD.townDepositPlan([it('coal', 20), it('stone_pickaxe', 1)], { tail: 'only', noSwords: false })
  assert.equal(sum(q.steps, 'coal'), 20)
  // no churn: a bag of COAL_KEEP or fewer coal is never a tail step (the full bag's deposit still banks it, as before)
  slot = 9
  assert.equal(TD.townDepositPlan([it('coal', C.COAL_KEEP), it('stone_pickaxe', 1)], { tail: 'only', noSwords: false }).steps.length, 0)
  slot = 9
  assert.equal(TD.townDepositPlan([it('coal', 3), it('stone_pickaxe', 1)], { noSwords: false }).steps.filter(s => s.name === 'coal').length, 1, 'positive control: the full-bag plan banks the 3')
  // positive control: with the split off the tail moves no coal
  slot = 9
  assert.equal(TD.townDepositPlan([it('raw_iron', 3), it('coal', 20)], { tail: 'only', noSwords: false, coalSplit: false }).steps.length, 0)
})

// ---- mutants: each guarded change, reverted, fails its behaviour (anchors asserted present and unique) -----------------
const { writeFileSync, unlinkSync } = await import('node:fs')
async function withMutant (rel, old, neu, fn) {
  const path = new URL(`../src/${rel}`, import.meta.url)
  const src = readFileSync(path, 'utf8')
  assert.equal(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 60))}`)
  const out = new URL(`./_mutant-coal-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
test('MUTANTS KILLED: the whole-stack coal keep, and no coal half, each bank no coal from a smelting bot', async () => {
  const bag = () => { slot = 9; return [it('raw_iron', 3), it('coal', 20)] }
  const banks = M => M.townDepositPlan(bag(), { tail: 'only', noSwords: false }).steps.some(s => s.name === 'coal')
  assert.equal(banks(TD), true, 'the real module banks the spare')
  await withMutant('towndeposit.mjs', "keep[n] = n === 'coal' ? coalKeepOf(h, toSmelt) : h", 'keep[n] = h', async M => assert.equal(banks(M), false))
  await withMutant('towndeposit.mjs', "|| (coalSplit && name === 'coal')", '', async M => assert.equal(banks(M), false))
})
