// mats-01 (building tier section 3): the materials job's decisions, by behaviour. Every decision is a pure export of
// mats.mjs and is driven here directly; the structural tests are the ones behaviour cannot reach (the forbidden set against
// the iron ladder and the kit, the registration of the skills). Each negative has a positive control beside it.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-mats'
process.env.BOT_NAME = process.env.BOT_NAME || 'MatsBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
delete process.env.MATS; delete process.env.MATS_RESERVE; delete process.env.MATS_BUFFERS

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const M = await import('../src/mats.mjs')
const { BUILD_RESERVE, PROJECT_PARTS, isProtected } = await import('../src/stocktarget.mjs')
const { IRON_LADDER } = await import('../src/towndeposit.mjs')
const { KIT } = await import('../src/toolkit.mjs')
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')

const MATS_PATH = new URL('../src/mats.mjs', import.meta.url)
// climb-escape.test.mjs's withMutant: the anchor must be present AND unique, or the "kill" is no kill
async function withMutant (old, neu, fn) {
  const src = readFileSync(MATS_PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-mats-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }

// a town with every input above the reserve and no part stocked: the order's positive control
const RICH = { cobblestone: 900, oak_log: 1400, copper_ingot: 1300, sand: 200, torch: 0, stone_bricks: 0, glass_pane: 0, cut_copper: 0, copper_door: 0 }
const T0 = 50_000_000
const base = (over = {}) => ({ now: T0, on: true, shared: true, atTown: true, holds: false, noteOpen: false, freeSlots: 10, bagSpare: {},
  town: { stock: RICH, coverage: 1 }, furnace: () => true, table: () => true, lease: () => true, bodyMs: 0, state: {}, ...over })

// ---- the kinds and the recipes -------------------------------------------------------------------------------------------
test('every smelt kind burns EXACTLY its planks (1.5 smelts per plank, nothing part-burnt) and every name is a real item', () => {
  for (const [kind, k] of Object.entries(M.KINDS)) {
    assert.ok(mcData.itemsByName[k.part], `${kind}: ${k.part} is an item`)
    if (k.smelt) assert.equal(k.smelt.n / 1.5, k.smelt.planks, kind)
    for (const c of k.crafts) if (c.out !== 'planks') assert.ok(mcData.itemsByName[c.out], `${kind}: ${c.out}`)
  }
  assert.equal(M.KINDS.bricks.smelt.n, 12); assert.equal(M.KINDS.bricks.smelt.planks, 8)
  assert.equal(M.KINDS.panes.smelt.n, 6); assert.equal(M.KINDS.panes.smelt.planks, 4)
  // the log budget of each wood kind covers its planks (fuel + sticks): 4 planks a log
  assert.ok(M.KINDS.bricks.inputs.log * 4 >= 8 && M.KINDS.panes.inputs.log * 4 >= 4)
  assert.equal(M.KINDS.torch.inputs.log, 6 + 1 + 1, 'torch: 6 smelted, 1 for the 4 fuel planks, 1 for the 8 sticks')
})

test('the buffered parts are building parts (always banked, protected) -- torch apart, already protected', () => {
  for (const p of M.BUFFERED_PARTS) {
    if (p === 'torch') { assert.ok(isProtected('torch')); continue }
    assert.ok(PROJECT_PARTS.includes(p), `${p} is a PROJECT_PART`)
  }
})

// ---- the never-inputs (structural: design 3.3) --------------------------------------------------------------------------
test('FORBIDDEN covers the whole iron ladder, every kit input and tool, and no input of any kind (B3: code, not configuration)', () => {
  for (const n of IRON_LADDER) assert.ok(M.isForbidden(n), `iron ladder ${n}`)
  for (const tool of Object.keys(KIT)) assert.ok(M.isForbidden(tool), `kit tool ${tool}`)
  for (const n of ['iron_ingot', 'stone_pickaxe', 'wooden_axe', 'shears', 'bucket', 'water_bucket', 'iron_chestplate']) assert.ok(M.isForbidden(n), n)
  for (const [kind, k] of Object.entries(M.KINDS)) for (const n of Object.keys(k.inputs)) assert.ok(!M.isForbidden(n === 'log' ? 'oak_log' : n), `${kind} input ${n}`)
  // positive control: the predicate is not "everything"
  for (const n of ['cobblestone', 'oak_log', 'oak_planks', 'sand', 'copper_ingot', 'stick']) assert.equal(M.isForbidden(n), false, n)
  // sticks are never an input (the kit's sticks): only logs make the torch kind's
  for (const k of Object.values(M.KINDS)) assert.ok(!('stick' in k.inputs))
})

// ---- the reserve as a setting --------------------------------------------------------------------------------------------
test('BUILD_RESERVE is the OWNER 10-23 table by default; MATS_RESERVE overrides a subset; anything malformed keeps the table', () => {
  assert.deepEqual(M.matsReserve({}), { table: { ...BUILD_RESERVE }, src: 'default' })
  assert.equal(BUILD_RESERVE.cobblestone, 256); assert.equal(BUILD_RESERVE.torch, 32)
  const e = M.matsReserve({ MATS_RESERVE: '{"cobblestone": 600, "torch": 0}' })
  assert.equal(e.src, 'env'); assert.equal(e.table.cobblestone, 600); assert.equal(e.table.torch, 0); assert.equal(e.table.logs, 512)
  for (const bad of ['{"cobble": 1}', '{"cobblestone": -1}', '{"cobblestone": 2.5}', '[1]', 'nope', '{"cobblestone": "9"}']) {
    const r = M.matsReserve({ MATS_RESERVE: bad })
    assert.equal(r.src, 'invalid', bad); assert.deepEqual(r.table, { ...BUILD_RESERVE }, bad)
  }
  assert.equal(M.matsBuffers({}).table.stone_bricks, 128)
  assert.equal(M.matsBuffers({ MATS_BUFFERS: '{"stone_bricks": 0}' }).table.stone_bricks, 0)
})

test('the switch: ON in shared scopes, OFF in isolated pools and by MATS=0|off', () => {
  assert.equal(M.matsEnabled({}, 'shared').on, true)
  assert.equal(M.matsEnabled({}, 'isolated').on, false)
  for (const v of ['0', 'off', 'false', 'no']) assert.equal(M.matsEnabled({ MATS: v }, 'shared').on, false, v)
})

// ---- inputs above the reserve (MAT-RES) -----------------------------------------------------------------------------------
test('MAT-RES: stock EXACTLY at the reserve -> no order; one batch above -> one batch; the bag\'s spare cobble goes first', () => {
  const R = BUILD_RESERVE
  const at = { cobblestone: R.cobblestone, oak_log: R.logs }
  assert.equal(M.orderInputs('bricks', { stock: at }), null, 'at the reserve: nothing is spendable')
  const one = { cobblestone: R.cobblestone + 12, oak_log: R.logs + 2 }
  assert.deepEqual(M.orderInputs('bricks', { stock: one }).take, { cobblestone: 12, oak_log: 2 })
  assert.equal(M.orderInputs('bricks', { stock: { cobblestone: R.cobblestone + 11, oak_log: R.logs + 2 } }), null, 'one short of a batch')
  // the bag's cobble above its keeps first: with 12 spare, the town is not drawn for cobble at all
  const own = M.orderInputs('bricks', { stock: at, bagSpare: { cobblestone: 40 } })
  assert.equal(own, null, 'the logs are still at the reserve')
  const ownOk = M.orderInputs('bricks', { stock: { ...at, oak_log: R.logs + 2 }, bagSpare: { cobblestone: 40 } })
  assert.deepEqual(ownOk.fromBag, { cobblestone: 12 }); assert.deepEqual(ownOk.take, { oak_log: 2 })
  const part = M.orderInputs('bricks', { stock: { cobblestone: R.cobblestone + 5, oak_log: R.logs + 2 }, bagSpare: { cobblestone: 7 } })
  assert.deepEqual(part.fromBag, { cobblestone: 7 }); assert.equal(part.take.cobblestone, 5, 'the rest from town')
  // only cobble comes from the bag: sand, logs and ingots in the bag are its keeps' or the deposit flows'
  assert.equal(M.orderInputs('panes', { stock: { sand: R.sand, oak_log: R.logs + 1 }, bagSpare: { sand: 64 } }), null)
  assert.equal(M.orderInputs('cut_copper', { stock: { copper_ingot: R.copper_ingot + 35 } }), null)
  assert.ok(M.orderInputs('cut_copper', { stock: { copper_ingot: R.copper_ingot + 36 } }))
})

test('a town holding ONLY iron and coal (and no input above the reserve) never gets an order', () => {
  const r = M.materialOrder(base({ town: { stock: { iron_ingot: 500, raw_iron: 300, coal: 900, charcoal: 40 }, coverage: 1 } }))
  assert.equal(r.order, null); assert.equal(r.skip, 'inputs')
  // positive control: the same town with cobble and logs above the reserve gets one
  assert.equal(M.materialOrder(base({ town: { stock: { iron_ingot: 500, coal: 900, cobblestone: 400, oak_log: 600 }, coverage: 1 } })).order?.args.kind, 'bricks')
})

test('the log species: the most-stocked one with enough, never below the logs reserve in total', () => {
  assert.equal(M.pickLog({ oak_log: 300, birch_log: 400 }, 2), 'birch_log')
  assert.equal(M.pickLog({ oak_log: 300, birch_log: 213 }, 2), null, 'total 513 - 512 = 1 spendable: short of 2')
  assert.equal(M.pickLog({ oak_log: 520, birch_log: 1 }, 2), 'oak_log')
})

// ---- the order ------------------------------------------------------------------------------------------------------------
test('the order: issued at town with a short part and its inputs; every reason it is not is named (skips, never refusals)', () => {
  const r = M.materialOrder(base())
  assert.equal(r.order?.skill, 'make_material'); assert.equal(r.order.args.kind, 'bricks'); assert.equal(r.state.lastIssuedAt, T0)
  const skip = over => M.materialOrder(base(over)).skip
  assert.equal(skip({ on: false }), 'off')
  assert.equal(skip({ shared: false }), 'isolated')
  assert.equal(skip({ holds: true }), 'milestone')
  assert.equal(skip({ atTown: false }), 'away')
  assert.equal(skip({ noteOpen: true }), 'note_open')
  assert.equal(skip({ state: { lastIssuedAt: T0 - 1000 } }), 'cooldown')
  assert.equal(skip({ state: { backoffUntil: T0 + 1 } }), 'cooldown')
  assert.equal(skip({ state: { pausedUntil: T0 + 1 } }), 'paused')
  assert.equal(skip({ bodyMs: M.MATS_BODY_MS_PER_HOUR }), 'body_budget')
  assert.equal(skip({ freeSlots: 2 }), 'room')
  assert.equal(skip({ town: null }), 'index_unreadable')
  assert.equal(skip({ town: { stock: RICH, coverage: 0.79 } }), 'index_coverage')
  assert.equal(skip({ lease: () => false }), 'lease_busy')
  // below the coverage with never-opened containers in reach: the REMEDY is the order (count them), not a skip
  const c = M.materialOrder(base({ town: { stock: RICH, coverage: 0.5 }, unknown: () => 3 }))
  assert.equal(c.order?.args.kind, 'count'); assert.match(c.order.why, /open the 3 never-opened/)
  assert.equal(M.materialOrder(base({ state: { lastIssuedAt: T0 - M.MATS_COOLDOWN_MS } })).order?.skill, 'make_material', 'the cooldown ends')
})

test('the order: the first SHORT part in KIND_ORDER whose inputs, furnace and table are there; buffers stop production', () => {
  const stocked = { ...RICH, stone_bricks: 128 }
  assert.equal(M.materialOrder(base({ town: { stock: stocked, coverage: 1 } })).order.args.kind, 'cut_copper', 'bricks at the buffer: the next part')
  assert.equal(M.materialOrder(base({ furnace: () => false })).order.args.kind, 'cut_copper', 'no furnace: a kind with no smelt')
  const r = M.materialOrder(base({ furnace: () => false, table: () => false }))
  assert.equal(r.order, null); assert.equal(r.skip, 'no_furnace', 'nothing makeable: the most informative reason')
  const full = { ...RICH, stone_bricks: 128, glass_pane: 32, cut_copper: 24, copper_door: 3, torch: 64 }
  assert.equal(M.materialOrder(base({ town: { stock: full, coverage: 1 } })).skip, 'stocked')
  // torch: Q3's part (charcoal from logs), only below its buffer
  const torches = { ...full, torch: 40 }
  assert.equal(M.materialOrder(base({ town: { stock: torches, coverage: 1 } })).order?.args.kind, 'torch')
  // cheap gates first: no town read when a gate fails
  let reads = 0
  M.materialOrder(base({ holds: true, town: () => { reads++; return { stock: RICH, coverage: 1 } } }))
  M.materialOrder(base({ freeSlots: 0, town: () => { reads++; return { stock: RICH, coverage: 1 } } }))
  assert.equal(reads, 0)
})

test('the outcome: success clears; failure backs off 20 min; six of one reason pause 6 h; a reflex costs nothing', () => {
  assert.equal(M.matsOutcome('failed', 'other', T0, {}).backoffUntil, T0 + M.MATS_BACKOFF_MS)
  let s = {}
  for (let i = 0; i < 5; i++) s = M.matsOutcome('no_effect', 'inputs', T0, s)
  assert.ok(!(s.pausedUntil > 0))
  s = M.matsOutcome('no_effect', 'inputs', T0, s)
  assert.equal(s.pausedUntil, T0 + M.MATS_PAUSE_MS)
  assert.equal(M.matsOutcome('aborted', 'interrupted', T0, { streak: { why: 'x', n: 5 } }).streak.n, 5)
  assert.equal(M.matsOutcome('success', 'done', T0, { streak: { why: 'x', n: 5 } }).streak, null)
})

test('the recovery order: only an OPEN note at town, at most once a minute', () => {
  assert.equal(M.returnOrder({ atTown: true, noteOpen: true, now: T0 }).order?.skill, 'mats_return')
  assert.equal(M.returnOrder({ atTown: false, noteOpen: true, now: T0 }).order, null)
  assert.equal(M.returnOrder({ atTown: true, noteOpen: false, now: T0 }).order, null)
  assert.equal(M.returnOrder({ atTown: true, noteOpen: true, now: T0, state: { lastReturnAt: T0 - 1000 } }).order, null)
})

// ---- the furnace (MAT-FURN, MAT-HOT) ----------------------------------------------------------------------------------------
test('a furnace qualifies only cold, input and fuel empty, output empty or the job\'s own (coal, foreign iron, lit: skips)', () => {
  const q = o => M.furnaceQualifies({ lit: false, ...o })
  assert.equal(q({}).ok, true, 'positive control: an empty cold furnace')
  assert.equal(q({ output: { name: 'stone', count: 3 }, own: 'stone' }).ok, true, 'its own leftover stone')
  assert.equal(q({ fuel: { name: 'coal', count: 2 } }).why, 'fuel:coal', 'coal already in the fuel slot')
  assert.equal(q({ fuel: { name: 'oak_planks', count: 2 } }).ok, false, 'mats-01 narrows to an EMPTY fuel slot')
  assert.equal(q({ output: { name: 'iron_ingot', count: 4 }, own: 'stone' }).why, 'output:iron_ingot', 'foreign iron output')
  assert.equal(q({ input: { name: 'raw_iron', count: 4 } }).why, 'input:raw_iron')
  assert.equal(M.furnaceQualifies({ lit: true }).why, 'lit', 'MAT-HOT: an empty fuel slot with coal still burning reads lit=true')
  assert.equal(M.furnaceQualifies({ lit: null }).why, 'lit_unknown', 'an unreadable block state is no proof of cold')
  assert.equal(q({ output: { name: 'charcoal', count: 1 }, own: null }).ok, false, 'the torch kind takes no charcoal it did not make')
})

test('the batch: the whole one, or the largest unit the clock affords (4 stone, 6 glass); planks rounded UP', () => {
  assert.equal(M.batchFor('bricks', 200_000), 12)
  assert.equal(M.batchFor('bricks', 95_000), 8)
  assert.equal(M.batchFor('bricks', 39_000), 0)
  assert.equal(M.batchFor('panes', 59_000), 0); assert.equal(M.batchFor('panes', 60_000), 6)
  assert.equal(M.batchFor('torch', 35_000), 3)
  assert.equal(M.batchFor('cut_copper', 999_999), 0, 'no smelt')
  assert.equal(M.planksToLoad(12), 8); assert.equal(M.planksToLoad(8), 6); assert.equal(M.planksToLoad(6), 4); assert.equal(M.planksToLoad(9), 6)
})

// ---- recovery (MAT-KILL's plan) ------------------------------------------------------------------------------------------
test('the return plan: stone crafted in fours, a 1-3 remainder KEPT under the note (never banked-and-closed); parts banked', () => {
  const note = M.newNote({ kind: 'bricks', bag0: { stone: 0, stone_bricks: 2, cobblestone: 80, oak_log: 10, oak_planks: 4 } })
  const p = M.returnPlan(note, { stone: 7, stone_bricks: 6, cobblestone: 80, oak_log: 10, oak_planks: 7 })
  assert.equal(p.craftStone, 4); assert.deepEqual(p.keep, { stone: 3 }); assert.equal(p.close, false)
  assert.equal(p.bank.stone_bricks, 4 + 4, 'the bricks already made + the four about to be'); assert.equal(p.bank.oak_planks, 3)
  assert.equal(p.bank.cobblestone, undefined, 'the bag\'s own cobble is the bag\'s')
  const clean = M.returnPlan(note, { stone: 8, stone_bricks: 2, cobblestone: 80, oak_log: 10, oak_planks: 4 })
  assert.equal(clean.craftStone, 8); assert.deepEqual(clean.keep, {}); assert.equal(clean.close, true)
  assert.deepEqual(M.returnPlan(null, {}), { craftStone: 0, bank: {}, keep: {}, close: true })
})

// ---- conservation ---------------------------------------------------------------------------------------------------------
test('the balance by family: a whole bricks order is ok; a short deposit is a LOSS; coal from the bag is FORBIDDEN', () => {
  const ok = { kind: 'bricks', bag0: { cobblestone: 100, oak_log: 0 }, withdrawn: { oak_log: 2 }, bag1: { cobblestone: 88 }, deposited: { stone_bricks: 12 }, burnedPlanks: 8, smelted: 12 }
  assert.equal(M.matsBalance(ok).verdict, 'ok')
  assert.equal(M.matsBalance({ ...ok, deposited: { stone_bricks: 11 } }).verdict, 'loss')
  assert.equal(M.matsBalance({ ...ok, forbidden0: { coal: 5 }, forbidden1: { coal: 4 } }).verdict, 'forbidden')
  assert.equal(M.matsBalance({ ...ok, forbidden0: { coal: 5 }, forbidden1: { coal: 4 }, uncertain: true }).verdict, 'forbidden', 'never excused by uncertainty')
  assert.equal(M.matsBalance({ ...ok, burnedPlanks: 9, withdrawn: { oak_log: 2, oak_planks: 1 } }).verdict, 'overburn')
  assert.equal(M.matsBalance({ ...ok, bag1: { cobblestone: 89 } }).verdict, 'gain', 'a gain is reported, not a defect')
  assert.equal(M.matsBalance({ ...ok, uncertain: true }).verdict, 'unreconciled')
  // prior output (the job's own stone) and what the furnace still holds close the boundary
  assert.equal(M.matsBalance({ ...ok, prior: { stone: 3 }, furnaceLeft: { stone: 3 } }).verdict, 'ok')
})

test('the balance: panes (16 per 6 glass), copper (9 per block, 2 per door) and torches (charcoal made and spent)', () => {
  assert.equal(M.matsBalance({ kind: 'panes', withdrawn: { sand: 6, oak_log: 1 }, deposited: { glass_pane: 16 }, burnedPlanks: 4, smelted: 6 }).verdict, 'ok')
  assert.equal(M.matsBalance({ kind: 'cut_copper', withdrawn: { copper_ingot: 36 }, deposited: { cut_copper: 4 } }).verdict, 'ok')
  assert.equal(M.matsBalance({ kind: 'copper_door', withdrawn: { copper_ingot: 6 }, deposited: { copper_door: 3 } }).verdict, 'ok')
  assert.equal(M.matsBalance({ kind: 'torch', withdrawn: { oak_log: 8 }, deposited: { torch: 24, stick: 2 }, burnedPlanks: 4, smelted: 6 }).verdict, 'ok')
  assert.equal(M.matsBalance({ kind: 'torch', withdrawn: { oak_log: 8 }, deposited: { torch: 20, stick: 3 }, burnedPlanks: 4, smelted: 6 }).verdict, 'loss')
  // the torch kind's charcoal is its own: the bag's own charcoal must not fall (the forbidden gate)
  assert.equal(M.matsBalance({ kind: 'torch', withdrawn: { oak_log: 8 }, deposited: { torch: 24, stick: 2 }, burnedPlanks: 4, smelted: 6, forbidden0: { charcoal: 2 }, forbidden1: { charcoal: 1 } }).verdict, 'forbidden')
})

test('touched names: the part, the inputs, the intermediate and every wood name for a wood kind', () => {
  const t = M.touchedNames('bricks', 'birch_log')
  for (const n of ['stone_bricks', 'cobblestone', 'stone', 'birch_log', 'birch_planks', 'oak_planks', 'oak_log']) assert.ok(t.includes(n), n)
  assert.deepEqual(M.touchedNames('copper_door').sort(), ['copper_door', 'copper_ingot'])
})

test('the row and the licence row carry the fields the read parses', () => {
  const d = M.matsDetail({ kind: 'bricks', stop: 'done', made: 12, took: { oak_log: 2 }, verdict: 'ok', families: { stone: 0 } })
  for (const k of ['kind=bricks', 'stop=done', 'made=12', 'took=oak_log:2', 'verdict=ok', 'forbidden=-', 'kept_lost=-']) assert.ok(d.includes(k), k)
  const m = M.matsModeDetail()
  assert.match(m, /^phase=mode v=1 on=1 kinds=bricks,cut_copper,copper_door,panes,torch reserve=cobblestone:256,logs:512,planks:71,sticks:40,copper_ingot:512,sand:16,torch:32 reserve_src=default/)
})

// ---- mutants on the decisions (each must be KILLED by the tests above, re-run against the mutant) -------------------------
test('MUTANTS: the reserve, the coverage rule, the forbidden gate, the qualify rule and the part buffer are each load-bearing', async () => {
  const cases = [
    ['spendable ignores the reserve', "Math.max(0, reserveCount(key, stock) - (Number(reserve?.[key]) || 0))", 'Math.max(0, reserveCount(key, stock))',
      X => assert.equal(X.orderInputs('bricks', { stock: { cobblestone: BUILD_RESERVE.cobblestone, oak_log: BUILD_RESERVE.logs } }), null)],
    ['coverage gate dropped', "if (!(t.coverage >= MATS_MIN_COVERAGE)) {", 'if (false) {',
      X => assert.equal(X.materialOrder(base({ town: { stock: RICH, coverage: 0.5 } })).skip, 'index_coverage')],
    ['forbidden gate dropped', "if (d > 0) forbidden[n] = d", '',
      X => assert.equal(X.matsBalance({ kind: 'bricks', withdrawn: { oak_log: 2, cobblestone: 12 }, deposited: { stone_bricks: 12 }, burnedPlanks: 8, smelted: 12, forbidden0: { coal: 5 }, forbidden1: { coal: 4 } }).verdict, 'forbidden')],
    ['a fuel slot with coal qualifies', "if (fuel) return { ok: false, why: `fuel:${fuel.name}` }", '',
      X => assert.equal(X.furnaceQualifies({ lit: false, fuel: { name: 'coal', count: 2 } }).ok, false)],
    ['lit unknown read as cold', "if (lit !== false) return", "if (lit === true) return",
      X => assert.equal(X.furnaceQualifies({ lit: null }).ok, false)],
    ['a stocked part is still made', "if (short <= 0) { reasons.push('stocked'); continue }", '',
      X => assert.equal(X.materialOrder(base({ town: { stock: { ...RICH, stone_bricks: 128, glass_pane: 32, cut_copper: 24, copper_door: 3, torch: 64 }, coverage: 1 } })).skip, 'stocked')],
    ['the kept remainder is banked', "if (st % 4) keep.stone = st % 4", '',
      X => assert.deepEqual(X.returnPlan(X.newNote({ kind: 'bricks', bag0: { stone: 0 } }), { stone: 3 }).keep, { stone: 3 })],
  ]
  for (const [name, old, neu, check] of cases) {
    check(M)      // the real module passes
    assert.ok(await withMutant(old, neu, async X => killed(() => check(X))), `mutant SURVIVED: ${name}`)
  }
})

test('STRUCTURAL: both skills are registered HOUSEKEEPING (chatOnly) with their own evidence, and the runner carries `made`', async () => {
  const { SKILLS, SKILL_CONTRACTS } = await import('../src/skills.mjs')
  const { HOUSEKEEPING } = await import('../src/hygiene.mjs')
  for (const s of ['make_material', 'mats_return']) {
    assert.equal(SKILLS[s]?.chatOnly, true, `${s} chatOnly`)
    assert.ok(HOUSEKEEPING.has(s), `${s} housekeeping`)
    assert.ok(SKILL_CONTRACTS[s]?.expects?.includes('mats_effect'), `${s} evidence`)
  }
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const runner = strip(readFileSync(new URL('../src/runner.mjs', import.meta.url), 'utf8'))
  assert.equal(runner.split('made: Number(result.made ?? 0)').length, 2, 'the runner passes the job\'s count to the evidence gate exactly once')
})
