// The project reserve (OWNER DECISION 2026-10-27): while a building project is active, project draws may spend 80% of the
// town reserve (each family's floor is 20% of normal, rounded up); complete, stalled 24 h or switched off -> the full reserve;
// non-project draws always keep the full reserve. Behaviour of the pure exports of mats.mjs and shop.mjs.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-projres'
process.env.BOT_NAME = process.env.BOT_NAME || 'ProjResBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
delete process.env.MATS; delete process.env.MATS_RESERVE; delete process.env.MATS_BUFFERS; delete process.env.RESERVE_PROJECT

import assert from 'node:assert/strict'
import test from 'node:test'
import * as M from '../src/mats.mjs'
import { spendableFor, shopAllow } from '../src/shop.mjs'
import { BUILD_RESERVE } from '../src/stocktarget.mjs'

const NOW = 100 * 3600_000
const H = 3600_000
const R = BUILD_RESERVE

test('active project: each family floor is 20% of normal, rounded up (80% spendable)', () => {
  const st = M.projectReserveState({ exists: true, complete: false, progressAt: NOW - H, now: NOW })
  assert.deepEqual(st, { active: true, why: 'active' })
  const E = M.effectiveReserve(R, { active: st.active, forProject: true })
  assert.equal(E.lowered, true)
  assert.deepEqual(E.table, { cobblestone: 52, logs: 103, planks: 15, sticks: 8, copper_ingot: 103, sand: 4, torch: 7 })
  for (const [k, v] of Object.entries(R)) assert.equal(E.table[k], Math.ceil(v * 0.2), k)
})

test('complete project -> full reserve; no project -> full; switch off -> full', () => {
  for (const [o, why] of [[{ exists: true, complete: true, progressAt: NOW }, 'complete'], [{ exists: false }, 'no_project'],
    [{ on: false, exists: true, complete: false, progressAt: NOW }, 'off'], [{ exists: true, complete: false, progressAt: null }, 'no_clock']]) {
    const st = M.projectReserveState({ ...o, now: NOW })
    assert.deepEqual(st, { active: false, why })
    const E = M.effectiveReserve(R, { active: st.active, forProject: true })
    assert.equal(E.lowered, false); assert.deepEqual(E.table, { ...R })
  }
})

test('stalled 24 h -> full reserve; 1 ms short of 24 h -> still active', () => {
  assert.deepEqual(M.projectReserveState({ exists: true, progressAt: NOW - 24 * H, now: NOW }), { active: false, why: 'stalled' })
  assert.deepEqual(M.projectReserveState({ exists: true, progressAt: NOW - 24 * H + 1, now: NOW }), { active: true, why: 'active' })
})

test('non-project draw keeps the full floor even while a project is active', () => {
  const E = M.effectiveReserve(R, { active: true, forProject: false })
  assert.equal(E.lowered, false); assert.deepEqual(E.table, { ...R })
  // the mats kinds: building parts are project work, torches are not
  assert.equal(M.matsKindForProject('bricks'), true); assert.equal(M.matsKindForProject('panes'), true)
  assert.equal(M.matsKindForProject('cut_copper'), true); assert.equal(M.matsKindForProject('copper_door'), true)
  assert.equal(M.matsKindForProject('torch'), false); assert.equal(M.matsKindForProject('nope'), false)
})

test('the kill switch: RESERVE_PROJECT=off|0|false|no is off; unset or anything else is on', () => {
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.equal(M.projectReserveOn({ RESERVE_PROJECT: v }), false, v)
  for (const v of [undefined, '', '1', 'on']) assert.equal(M.projectReserveOn({ RESERVE_PROJECT: v }), true, String(v))
})

test('the lowered floor changes what the take and the bill may spend (positive control: the full floor refuses)', () => {
  const stock = { cobblestone: 200, oak_log: 300 }      // both below the normal floor (256, 512), above the lowered (52, 103)
  const L = M.effectiveReserve(R, { active: true, forProject: true }).table
  assert.equal(M.takeAllowed('cobblestone', 64, { here: stock, reserve: R }), 0, 'full floor: nothing')
  assert.equal(M.takeAllowed('cobblestone', 64, { here: stock, reserve: L }), 64)
  assert.equal(M.takeAllowed('cobblestone', 999, { here: stock, reserve: L }), 200 - 52, 'never below the lowered floor')
  assert.equal(shopAllow('oak_log', 500, { here: stock, reserve: L }), 300 - 103)
  assert.equal(spendableFor('cobblestone', stock, { reserve: R }), 0)
  assert.equal(spendableFor('cobblestone', stock, { reserve: L }), 148)
})

test('bricks order: refused at the full reserve, issued under the lowered table; torch never lowered', () => {
  const stock = { cobblestone: 987, oak_log: 300, stone_bricks: 0, torch: 0 }
  const L = M.effectiveReserve(R, { active: true, forProject: true }).table
  const base = { now: 50_000_000, on: true, shared: true, atTown: true, freeSlots: 10, town: { stock, coverage: 1 }, state: {} }
  const full = M.materialOrder(base)
  assert.equal(full.order, null); assert.equal(full.skip, 'inputs')
  const low = M.materialOrder({ ...base, partReserve: L })
  assert.equal(low.order?.args.item, 'bricks')
  // ZERO TOWN LOGS (the showcase today): bricks stay blocked even under the lowered floor
  const noLogs = M.materialOrder({ ...base, town: { stock: { cobblestone: 987, stone_bricks: 0, torch: 0 }, coverage: 1 }, partReserve: L })
  assert.equal(noLogs.order, null); assert.equal(noLogs.skip, 'inputs')
  // torch is judged on the full table: logs 300 < 512 -> still refused even with partReserve
  const t = M.materialOrder({ ...base, town: { stock: { cobblestone: 0, oak_log: 300, torch: 0, stone_bricks: 128 }, coverage: 1 }, partReserve: L })
  assert.match(t.kinds ?? '', /torch:inputs/)
})

test('rows name the mode and every draw', () => {
  assert.match(M.reserveModeDetail({ active: false, why: 'stalled', gen: 7, progressAt: NOW - 25 * H, now: NOW }), /^phase=mode active=0 why=stalled gen=7 idle_min=1500 keep=0.2$/)
  assert.equal(M.reserveDrawDetail({ by: 'b1', name: 'oak_log', n: 2, family: 'logs', normal: 512, effective: 103, gen: 7 }),
    'phase=draw by=b1 name=oak_log n=2 family=logs floor_normal=512 floor_effective=103 gen=7')
})
