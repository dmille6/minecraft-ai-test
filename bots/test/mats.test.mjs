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
  assert.equal(M.materialOrder(base({ town: { stock: { iron_ingot: 500, coal: 900, cobblestone: 400, oak_log: 600 }, coverage: 1 } })).order?.args.item, 'bricks')
})

test('the log species: the most-stocked one with enough, never below the logs reserve in total', () => {
  assert.equal(M.pickLog({ oak_log: 300, birch_log: 400 }, 2), 'birch_log')
  assert.equal(M.pickLog({ oak_log: 300, birch_log: 213 }, 2), null, 'total 513 - 512 = 1 spendable: short of 2')
  assert.equal(M.pickLog({ oak_log: 520, birch_log: 1 }, 2), 'oak_log')
})

// ---- the order ------------------------------------------------------------------------------------------------------------
test('the order: issued at town with a short part and its inputs; every reason it is not is named (skips, never refusals)', () => {
  const r = M.materialOrder(base())
  assert.equal(r.order?.skill, 'make_material'); assert.equal(r.order.args.item, 'bricks'); assert.equal(r.state.lastIssuedAt, T0)
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
  assert.equal(c.order?.args.item, 'count'); assert.match(c.order.why, /does not know 3 of the town's containers in reach/)
  // AT ANY COVERAGE (Codex r2 P2-5): above 80% with an unknown container in reach, it is counted first -- it may hold the buffer
  assert.equal(M.materialOrder(base({ town: { stock: RICH, coverage: 0.9 }, unknown: () => 1 })).order?.args.item, 'count')
  assert.equal(M.materialOrder(base({ town: { stock: RICH, coverage: 0.9 }, unknown: () => 0 })).order?.args.item, 'bricks', 'none in reach: the order')
  // EVERY KIND'S OWN REASON travels with the skip (Claude r2 P2-A): a lit-only town with cobble and logs but no sand or copper
  const hot = M.materialOrder(base({ town: { stock: { cobblestone: 900, oak_log: 1400, torch: 64 }, coverage: 1 }, furnace: () => false }))
  assert.equal(hot.skip, 'inputs'); assert.match(hot.kinds, /bricks:no_furnace/); assert.match(hot.kinds, /cut_copper:inputs/); assert.equal(hot.coverage, 1)
  assert.equal(M.materialOrder(base({ state: { lastIssuedAt: T0 - M.MATS_COOLDOWN_MS } })).order?.skill, 'make_material', 'the cooldown ends')
})

test('the order: the first SHORT part in KIND_ORDER whose inputs, furnace and table are there; buffers stop production', () => {
  const stocked = { ...RICH, stone_bricks: 128 }
  assert.equal(M.materialOrder(base({ town: { stock: stocked, coverage: 1 } })).order.args.item, 'cut_copper', 'bricks at the buffer: the next part')
  assert.equal(M.materialOrder(base({ furnace: () => false })).order.args.item, 'cut_copper', 'no furnace: a kind with no smelt')
  const r = M.materialOrder(base({ furnace: () => false, table: () => false }))
  assert.equal(r.order, null); assert.equal(r.skip, 'no_furnace', 'nothing makeable: the most informative reason')
  const full = { ...RICH, stone_bricks: 128, glass_pane: 32, cut_copper: 24, copper_door: 3, torch: 64 }
  assert.equal(M.materialOrder(base({ town: { stock: full, coverage: 1 } })).skip, 'stocked')
  // torch: Q3's part (charcoal from logs), only below its buffer
  const torches = { ...full, torch: 40 }
  assert.equal(M.materialOrder(base({ town: { stock: torches, coverage: 1 } })).order?.args.item, 'torch')
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
test('the return plan: stone crafted in fours (a 1-3 remainder is ORDINARY stone, reported); the part banked; unspent inputs are NOT obligations', () => {
  const loaded = { input: { name: 'cobblestone', n: 12 }, fuel: { name: 'oak_planks', n: 8 }, out: 'stone', inputAfter: 80 }
  const note = { ...M.newNote({ kind: 'bricks', bag0: { stone: 0, stone_bricks: 2, cobblestone: 80, oak_log: 10, oak_planks: 4 } }), loaded }
  const p = M.returnPlan(note, { stone: 7, stone_bricks: 6, cobblestone: 84, oak_log: 10, oak_planks: 7 })
  assert.equal(p.craftStone, 4); assert.equal(p.stoneLeft, 3)
  assert.deepEqual(p.bank, { stone_bricks: 4 + 4 }, 'the bricks already made + the four about to be')
  assert.deepEqual(p.inputsLeft, { cobblestone: 4, oak_planks: 3 }, 'booked, never an obligation')
  assert.equal(M.noteSettled(note, { stone: 3, stone_bricks: 2, cobblestone: 84, oak_planks: 7 }), true, 'leftover inputs and a 1-3 stone remainder do not hold the note open')
  assert.equal(M.noteSettled(note, { stone: 4, stone_bricks: 2 }), false, 'four stone still owe a craft')
  assert.equal(M.noteSettled(note, { stone_bricks: 3 }), false, 'a brick above bag0 is still owed to town')
  assert.equal(M.noteSettled({ ...note, furnace: '1,2,3' }, { stone_bricks: 2 }, { furnaceDone: false }), false, 'a furnace not yet drained holds it open')
  // CAPPED BY THE NOTE (Claude r2 P2-D): stone the bot got later is not the order's -- at most the loaded batch
  assert.equal(M.returnPlan(note, { stone: 30 }).craftStone, 12)
  assert.equal(M.returnPlan({ ...note, loaded: null }, { stone: 8 }).craftStone, 0, 'never loaded: no stone is the order\'s')
  // the torch kind: its charcoal and ITS sticks only; charcoal with no stick of the order's is OWED (Codex r2 P2-8)
  const tl = { input: { name: 'oak_log', n: 6 }, fuel: { name: 'oak_planks', n: 4 }, out: 'charcoal' }
  const tn = { ...M.newNote({ kind: 'torch', bag0: { charcoal: 1, stick: 0, torch: 8 } }), loaded: tl, sticks: 6 }
  const tp = M.returnPlan(tn, { charcoal: 7, stick: 6, torch: 8 })
  assert.equal(tp.torches, 6); assert.deepEqual(tp.bank, { torch: 24 }); assert.ok(!('charcoal' in tp.bank)); assert.equal(tp.charcoalLeft, 0)
  assert.equal(M.returnPlan(tn, { charcoal: 30, stick: 6 }).charcoalLeft, 0, 'charcoal got later for the ladder is not the order\'s')
  const kit = M.returnPlan({ ...tn, sticks: 2 }, { charcoal: 7, stick: 6 })
  assert.equal(kit.torches, 2, 'the kit\'s sticks are never spent'); assert.equal(kit.charcoalLeft, 4)
  assert.equal(M.noteSettled({ ...tn, sticks: 2 }, { charcoal: 3, stick: 0, torch: 8 }), false, 'the order\'s charcoal is owed to torches: the note stays open')
  assert.deepEqual(M.returnPlan(null, {}), { craftStone: 0, torches: 0, panes: 0, cutCopper: 0, bank: {}, stoneLeft: 0, charcoalLeft: 0, sticksShort: 0, stickWood: null, inputsLeft: {} })
  assert.deepEqual(M.obligations('bricks').sort(), ['stone', 'stone_bricks']); assert.deepEqual(M.obligations('copper_door'), ['copper_door'])
  // THE MISSING STICKS' REMEDY (Codex r3 P2-5): from wood ABOVE bag0 -- the order's planks, else its log; never the kit's
  const short = { ...tn, bag0: { charcoal: 1, stick: 8, torch: 8, oak_planks: 4, oak_log: 0 } }
  const rs = M.returnPlan(short, { charcoal: 7, stick: 12, torch: 8, oak_planks: 4, oak_log: 1 })
  assert.equal(rs.sticksShort, 2); assert.deepEqual(rs.stickWood, { log: 'oak_log', planks: 'oak_planks', crafts: 1 }, 'the 4 planks are the kit\'s (bag0): the log above it is the order\'s')
  assert.deepEqual(M.returnPlan(short, { charcoal: 7, stick: 12, torch: 8, oak_planks: 6 }).stickWood, { planks: 'oak_planks', crafts: 1 })
  assert.equal(M.returnPlan(short, { charcoal: 7, stick: 12, torch: 8, oak_planks: 4 }).stickWood, null, 'no wood of the order\'s: the note owes (and is given up, counted)')
  // CUT COPPER'S INTERMEDIATE (Codex r3 P2-6): four blocks cut in recovery; fewer are banked (a project part), never unowed
  assert.deepEqual(M.obligations('cut_copper').sort(), ['copper_block', 'cut_copper'])
  const cn = M.newNote({ kind: 'cut_copper', bag0: { copper_block: 0, cut_copper: 0, copper_ingot: 0 } })
  const cp = M.returnPlan(cn, { copper_block: 4 })
  assert.equal(cp.cutCopper, 4); assert.deepEqual(cp.bank, { cut_copper: 4 })
  assert.deepEqual(M.returnPlan(cn, { copper_block: 3 }).bank, { copper_block: 3 }); assert.equal(M.noteSettled(cn, { copper_block: 3 }), false)
  assert.equal(M.noteSettled(cn, { copper_ingot: 36 }), true, 'unspent ingots are inputs, never owed')
})

test('THE COPPER RECOVERY BALANCE (Codex r3 P2-6): the ingots taken are ingots, blocks, cut copper or doors -- else a LOSS', () => {
  const note = { ...M.newNote({ kind: 'cut_copper', took: { copper_ingot: 36 }, bag0: { copper_ingot: 0, copper_block: 0, cut_copper: 0 } }), crafting: true }
  assert.equal(M.copperBalance(note, { bag: {}, banked: { cut_copper: 4 } }).verdict, 'ok')
  assert.equal(M.copperBalance(note, { bag: { copper_ingot: 36 } }).verdict, 'ok', 'the ingots are back')
  assert.equal(M.copperBalance(note, { bag: { copper_block: 2 }, banked: {} }).verdict, 'loss', 'two blocks of four lost')
  assert.equal(M.copperBalance({ ...note, deposited: { cut_copper: 4 } }, { bag: {} }).verdict, 'ok', 'an earlier attempt banked them')
  // A CRAFT IS INTERRUPTIBLE (Codex r5 P2-1): one block made, 27 ingots kept -> ok; crafting begun and nothing anywhere -> loss
  assert.equal(M.copperBalance(note, { bag: { copper_ingot: 27 }, banked: { copper_block: 1 } }).verdict, 'ok')
  assert.equal(M.copperBalance(note, { bag: {} }).verdict, 'loss', 'crafting begun: the copper must be somewhere')
  // INPUT ONCE SEEN BACK STAYS BACK (Codex r6 P2): 27 ingots seen by an earlier attempt, then banked by a town deposit
  assert.equal(M.copperBalance({ ...note, backSeen: 27, deposited: { copper_block: 1 } }, { bag: {} }).verdict, 'ok')
  const sm = { ...M.newNote({ kind: 'bricks', bag0: { stone: 0, stone_bricks: 0, cobblestone: 80 } }), loaded: { input: { name: 'cobblestone', n: 12 }, out: 'stone', inputAfter: 80 }, backSeen: 3, deposited: { stone_bricks: 8 } }
  assert.equal(M.recoveryBalance(sm, { bag: { cobblestone: 80, stone: 1 } }).verdict, 'ok', 'the 3 cobble seen back earlier, banked since')
  assert.equal(M.copperBalance({ ...note, crafting: false }, { bag: {} }).verdict, 'ok', 'the write-ahead never written: only inputs, wherever they went')
  const door = { ...M.newNote({ kind: 'copper_door', took: { copper_ingot: 6 }, bag0: {} }), crafting: true }
  assert.equal(M.recoveryBalance(door, { bag: {}, banked: { copper_door: 3 } }).verdict, 'ok'); assert.equal(M.recoveryBalance(door, { bag: {}, banked: { copper_door: 2 } }).verdict, 'loss')
})

test('r5: A WAITING RECOVERY YIELDS (Codex r4 P1); NO ROOM IN TOWN, NO ORDER (Claude r3 P2-5); a kill before the load is input BACK (Codex r4 P2-4)', () => {
  assert.equal(M.returnOrder({ atTown: true, noteOpen: true, now: 1000, waitUntil: 5000 }).skip, 'waiting')
  assert.equal(M.returnOrder({ atTown: true, noteOpen: true, now: 6000, waitUntil: 5000 }).order?.skill, 'mats_return', 'positive control: the wait ends')
  assert.equal(M.matsReturnWaitMs('lit'), 90_000); assert.equal(M.matsReturnWaitMs('busy'), 90_000); assert.equal(M.matsReturnWaitMs('bag_full'), M.MATS_RETURN_WAIT_MS)
  assert.equal(M.materialOrder(base({ bankRoom: () => false })).skip, 'town_full')
  assert.equal(M.materialOrder(base({ bankRoom: () => true })).order?.args.item, 'bricks')
  const note = { ...M.newNote({ kind: 'bricks', bag0: { stone: 0, stone_bricks: 0, cobblestone: 80 } }), loaded: { input: { name: 'cobblestone', n: 12 }, out: 'stone', inputBefore: 92 } }
  assert.equal(M.recoveryBalance(note, { bag: { cobblestone: 92 } }).verdict, 'ok', 'never loaded: the 12 are back')
  assert.equal(M.recoveryBalance(note, { bag: { cobblestone: 80 } }).verdict, 'loss', 'positive control: loaded, nothing came out')
  // the stick wood funds the crafts it is asked for, from the surplus only (Codex r4 P3)
  const tn = { ...M.newNote({ kind: 'torch', bag0: { charcoal: 0, stick: 0, oak_planks: 6, birch_planks: 0 } }), loaded: { input: { name: 'oak_log', n: 6 }, out: 'charcoal' }, sticks: 0 }
  assert.deepEqual(M.returnPlan(tn, { charcoal: 6, oak_planks: 8, birch_planks: 4 }).stickWood, { planks: 'birch_planks', crafts: 2 }, 'birch funds both crafts; oak has 2 over bag0')
  assert.deepEqual(M.returnPlan(tn, { charcoal: 6, oak_planks: 8 }).stickWood, { planks: 'oak_planks', crafts: 1 }, 'only one craft is funded above bag0')
})

test('r5 (Claude r4 P3s): placed input is back; a copper note with no part made is never crafted; the stick deficit; TAKEN', () => {
  const note = { ...M.newNote({ kind: 'bricks', bag0: { stone: 0, stone_bricks: 0, cobblestone: 80 } }), loaded: { input: { name: 'cobblestone', n: 12 }, out: 'stone', inputAfter: 80 } }
  assert.equal(M.recoveryBalance(note, { bag: { cobblestone: 80, stone: 9 } }).verdict, 'loss', 'positive control: 3 short')
  assert.equal(M.recoveryBalance(note, { bag: { cobblestone: 80, stone: 9 }, placed: { cobblestone: 3 } }).verdict, 'ok', 'the 3 back were placed by the recovery')
  const cu = M.newNote({ kind: 'cut_copper', took: { copper_ingot: 36 }, bag0: {} })
  assert.equal(M.copperBalance(cu, { bag: {} }).verdict, 'ok', 'no crafting write-ahead: never crafted (the ingots went to town by a deposit)')
  assert.equal(M.copperBalance({ ...cu, crafting: true }, { bag: { cut_copper: 2 } }).verdict, 'loss', 'crafted, two of four missing')
  const tn = { ...M.newNote({ kind: 'torch', bag0: { charcoal: 0, stick: 8 } }), loaded: { input: { name: 'oak_log', n: 6 }, out: 'charcoal' }, sticks: 8 }
  assert.equal(M.returnPlan(tn, { charcoal: 6, stick: 4, oak_log: 1 }).sticksShort, 6 + 4, 'the bag\'s own deficit below bag0 is refilled first')
  assert.equal(M.recoveryVerdict({ verdict: 'loss', out: 0, back: 0 }, 'empty'), 'unreconciled', 'an empty furnace proves neither a drain nor a loss (Codex r5 P2-2)')
  assert.equal(M.recoveryVerdict({ verdict: 'loss', out: 4, back: 0 }, 'empty'), 'loss', 'part of it found: judged')
  assert.equal(M.recoveryVerdict({ verdict: 'loss', out: 0, back: 0 }, 'drained:12'), 'loss', 'positive control: drained, then lost')
  assert.equal(M.recoveryVerdict({ verdict: 'loss', out: 0, back: 0 }, '-', 'cut_copper'), 'unreconciled', 'copper: nothing anywhere is the same ambiguity (Claude r6 P3-1)')
  assert.equal(M.recoveryVerdict({ verdict: 'loss', out: 9, back: 0 }, '-', 'cut_copper'), 'loss', 'copper: part of it found is judged')
  assert.equal(M.recoveryVerdict({ verdict: 'loss', out: 0, back: 0 }, '-', 'bricks'), 'loss', 'a smelt kind needs the empty furnace')
})

test('backSeen IS RECORDED ONLY WHEN THE DRAIN TOUCHED THE FURNACE (Claude r7 P3-1, Codex r8 P2, Claude r9 P3-1/P3-2)', () => {
  const fn = { furnace: '1,2,3' }
  for (const d of ['drained:4', 'drained:12', 'empty', 'gone']) assert.equal(M.backSeenTouched(fn, d), true, d)
  for (const d of ['lit', 'busy', 'unloaded', 'bag_full', 'unreadable_or_lit', 'window', 'unreachable', '-', 'no_bank_target', 'foreign:output:iron_ingot']) assert.equal(M.backSeenTouched(fn, d), false, d)
  assert.equal(M.backSeenTouched({ furnace: null }, '-'), true, 'no furnace: nothing is inside one')
})

test('THE RECOUNT TRIGGER HONOURS ITS BACKOFF (Claude r3 P2-3): a container that could not be counted is not a reason to count', () => {
  const failed = new Map([['T|a', { until: 2000 }], ['T|b', { until: 500 }]])
  assert.deepEqual(M.matsRecountable(['a', 'b', 'c'], failed, 1000, k => `T|${k}`), ['b', 'c'])
  // and the order: an unreachable last container in backoff (0 recountable) at 90% coverage -> bricks, not a count
  assert.equal(M.materialOrder(base({ town: { stock: RICH, coverage: 0.9 }, unknown: () => M.matsRecountable(['a'], failed, 1000, k => `T|${k}`).length })).order?.args.item, 'bricks')
})

test('THE RECOVERY BALANCE (Codex r2 P1-4): the loaded batch is out units in the bag, banked or deposited, or input back -- else a LOSS', () => {
  const loaded = { input: { name: 'cobblestone', n: 12 }, fuel: { name: 'oak_planks', n: 8 }, out: 'stone', inputAfter: 80 }
  const note = { ...M.newNote({ kind: 'bricks', bag0: { stone: 0, stone_bricks: 0, cobblestone: 80 } }), loaded }
  assert.equal(M.recoveryBalance(note, { bag: { cobblestone: 80 }, banked: { stone_bricks: 12 } }).verdict, 'ok')
  assert.deepEqual(M.recoveryBalance(note, { bag: { cobblestone: 83, stone: 1 }, banked: { stone_bricks: 8 } }), { verdict: 'ok', batch: 12, out: 9, back: 3, short: 0 }, 'a short burn: the input came back')
  assert.deepEqual(M.recoveryBalance(note, { bag: { cobblestone: 80, stone: 1 }, banked: { stone_bricks: 8 } }), { verdict: 'loss', batch: 12, out: 9, back: 0, short: 3 }, 'three stone spent on the way back')
  assert.equal(M.recoveryBalance({ ...note, deposited: { stone_bricks: 8 } }, { bag: { cobblestone: 80 }, banked: { stone_bricks: 4 } }).verdict, 'ok', 'what the order banked before it stopped counts')
  assert.equal(M.recoveryBalance({ ...note, loaded: null }, { bag: {} }).verdict, 'ok', 'never loaded: nothing in flight')
  const tn = { ...M.newNote({ kind: 'torch', bag0: { charcoal: 0, torch: 0 } }), loaded: { input: { name: 'oak_log', n: 6 }, out: 'charcoal' } }
  assert.equal(M.recoveryBalance(tn, { bag: {}, banked: { torch: 24 } }).verdict, 'ok', '24 torches = 6 charcoal')
  assert.equal(M.recoveryBalance(tn, { bag: {}, banked: { torch: 20 } }).verdict, 'loss')
})

test('the reserve AT THE TAKE (Codex r1 P1-1): the other known containers plus what the server shows here, never below the reserve', () => {
  const R = BUILD_RESERVE
  // the order read 514 logs; another bot has since taken 2 from this chest: here shows 30, the others 482 -> 512, none to spare
  assert.equal(M.takeAllowed('oak_log', 2, { others: { oak_log: 482 }, here: { oak_log: 30 } }), 0)
  assert.equal(M.takeAllowed('oak_log', 2, { others: { oak_log: 484 }, here: { oak_log: 30 } }), 2, 'positive control: 514 -> 2 to spare')
  assert.equal(M.takeAllowed('oak_log', 2, { others: { birch_log: 600 }, here: { oak_log: 1 } }), 1, 'never more than the container holds')
  assert.equal(M.takeAllowed('cobblestone', 12, { others: { cobblestone: R.cobblestone }, here: { cobblestone: 5 } }), 5)
  assert.equal(M.takeAllowed('iron_ingot', 5, { others: {}, here: { iron_ingot: 64 } }), 0, 'never a name with no reserve key (no input)')
  // THE OUTSTANDING DRAWS (Codex r2 P1-3): another bot's confirmed draw of 2 logs, not yet clicked, is already leaving
  assert.equal(M.takeAllowed('oak_log', 2, { others: { oak_log: 484 }, here: { oak_log: 30 }, taking: { logs: 2 } }), 0)
  assert.equal(M.takeAllowed('oak_log', 2, { others: { oak_log: 486 }, here: { oak_log: 30 }, taking: { logs: 2 } }), 2, 'positive control')
})

test('a recovery drains ONLY the note\'s own load (Codex r1 P1-5): its names, at most its counts', () => {
  const loaded = { input: { name: 'cobblestone', n: 12 }, fuel: { name: 'oak_planks', n: 8 }, out: 'stone', prior: 0 }
  assert.equal(M.recoveryContentsOk(loaded, { input: { name: 'cobblestone', count: 3 }, fuel: { name: 'oak_planks', count: 2 }, output: { name: 'stone', count: 9 } }).ok, true)
  assert.equal(M.recoveryContentsOk(loaded, { output: { name: 'iron_ingot', count: 1 } }).why, 'output:iron_ingot')
  assert.equal(M.recoveryContentsOk(loaded, { fuel: { name: 'coal', count: 1 } }).why, 'fuel:coal')
  assert.equal(M.recoveryContentsOk(loaded, { input: { name: 'cobblestone', count: 13 } }).why, 'input:cobblestone', 'more than it loaded')
  assert.equal(M.recoveryContentsOk(null, {}).why, 'no_load_record')
})

test('the recipe that uses only what it may: sticks from the order\'s own planks; the torch from charcoal, never coal', () => {
  const ids = { 1: 'oak_planks', 2: 'cherry_planks', 3: 'stick', 4: 'coal', 5: 'charcoal' }
  const nameOf = i => ids[i]
  const sticks = [{ id: 'cherry', delta: [{ id: 2, count: -2 }, { id: 3, count: 4 }] }, { id: 'oak', delta: [{ id: 1, count: -2 }, { id: 3, count: 4 }] }]
  assert.equal(M.recipeUsing(sticks, nameOf, { allowed: ['oak_planks'], must: 'oak_planks' }).id, 'oak')
  const torches = [{ id: 'coal', delta: [{ id: 4, count: -1 }, { id: 3, count: -1 }] }, { id: 'charcoal', delta: [{ id: 5, count: -1 }, { id: 3, count: -1 }] }]
  assert.equal(M.recipeUsing(torches, nameOf, { allowed: ['charcoal', 'stick'], must: 'charcoal' }).id, 'charcoal')
  assert.equal(M.recipeUsing(torches.slice(0, 1), nameOf, { allowed: ['charcoal', 'stick'], must: 'charcoal' }), null, 'only coal on offer: no recipe')
})

test('HEADROOM (Codex r1 P2-10): an order runs only when its whole batch fits under the buffer', () => {
  const at = n => M.materialOrder(base({ town: { stock: { ...RICH, stone_bricks: n, glass_pane: 32, cut_copper: 24, copper_door: 3, torch: 64 }, coverage: 1 } }))
  assert.equal(at(116).order?.args.item, 'bricks', '116 + 12 = 128')
  assert.equal(at(117).skip, 'stocked', '117 + 12 would pass 128')
})

// ---- conservation ---------------------------------------------------------------------------------------------------------
test('the balance by family: a whole bricks order is ok; a short deposit is a LOSS; coal from the bag is FORBIDDEN', () => {
  const ok = { kind: 'bricks', bag0: { cobblestone: 100, oak_log: 0 }, withdrawn: { oak_log: 2 }, bag1: { cobblestone: 88 }, deposited: { stone_bricks: 12 }, burnedPlanks: 8, smelted: 12 }
  assert.equal(M.matsBalance(ok).verdict, 'ok')
  assert.equal(M.matsBalance({ ...ok, deposited: { stone_bricks: 11 } }).verdict, 'loss')
  assert.equal(M.matsBalance({ ...ok, forbidden0: { coal: 5 }, forbidden1: { coal: 4 } }).verdict, 'forbidden')
  assert.equal(M.matsBalance({ ...ok, forbidden0: { coal: 5 }, forbidden1: { coal: 4 }, uncertain: true }).verdict, 'forbidden', 'never excused by uncertainty')
  // a pickaxe that wears out on the order's walk is booked apart (tools_lost), never a forbidden input (Claude r1 P2)
  assert.deepEqual(M.forbiddenCounts({ stone_pickaxe: 2, coal: 3, iron_ingot: 1, oak_log: 9 }), { coal: 3, iron_ingot: 1 })
  assert.deepEqual(M.toolCounts({ stone_pickaxe: 2, coal: 3, bucket: 1 }), { stone_pickaxe: 2, bucket: 1 })
  assert.equal(M.matsBalance({ ...ok, burnedPlanks: 9, withdrawn: { oak_log: 2, oak_planks: 1 } }).verdict, 'overburn')
  assert.equal(M.matsBalance({ ...ok, bag1: { cobblestone: 89 } }).verdict, 'gain', 'a gain is reported, not a defect')
  assert.equal(M.matsBalance({ ...ok, uncertain: true }).verdict, 'unreconciled')
  // prior output (the job's own stone) and what the furnace still holds close the boundary
  assert.equal(M.matsBalance({ ...ok, prior: { stone: 3 }, furnaceLeft: { stone: 3 } }).verdict, 'ok')
  // A CLOCK CUT (Claude r2 P2-B): 9 smelted on 7 planks with the batch cut -- one freshly lit plank is the clock's, not overburn
  const cutRow = { kind: 'bricks', bag0: { cobblestone: 100 }, withdrawn: { oak_log: 2 }, bag1: { cobblestone: 91, stone: 1, oak_planks: 1 }, deposited: { stone_bricks: 8 }, burnedPlanks: 7, smelted: 9 }
  assert.equal(M.matsBalance(cutRow).verdict, 'overburn', 'the same row, not cut')
  assert.equal(M.matsBalance({ ...cutRow, cut: true }).verdict, 'ok')
  // THE ORDER'S OWN PLACEMENTS (Claude r2 P2-C): two cobble placed as scaffold on its walks -> scaffold (reported), never a loss
  assert.equal(M.matsBalance({ ...ok, bag1: { cobblestone: 86 }, placed: { cobblestone: 2 } }).verdict, 'scaffold')
  assert.equal(M.matsBalance({ ...ok, bag1: { cobblestone: 86 }, placed: { cobblestone: 1 } }).verdict, 'loss', 'a shortfall beyond the placements is a loss')
  assert.equal(M.matsBalance({ ...ok, bag1: { cobblestone: 86 } }).verdict, 'loss', 'positive control: nothing placed')
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
  for (const k of ['kind=bricks', 'stop=done', 'made=12', 'took=oak_log:2', 'verdict=ok', 'forbidden=-', 'stone_left=-', 'inputs_left=-', 'tools_lost=-']) assert.ok(d.includes(k), k)
  assert.ok(d.indexOf('stock=') < d.indexOf('stop='), 'stock= comes before stop= (the 300-char cut)')
  assert.ok(d.indexOf('smelted=') < d.indexOf('stock='), 'smelted= is among the gate fields (Codex r2 P2-7)')
  assert.ok(M.matsDetail({ placed: { cobblestone: 2 }, cut: true, burned: 7, expected: 6 }).includes('placed=cobblestone:2'))
  const m = M.matsModeDetail()
  assert.match(m, /^phase=mode v=1 on=1 kinds=bricks,cut_copper,copper_door,panes,torch reserve=cobblestone:256,logs:512,planks:71,sticks:40,copper_ingot:512,sand:16,torch:32 reserve_src=default/)
})

// ---- mutants on the decisions (each must be KILLED by the tests above, re-run against the mutant) -------------------------
test('MUTANTS: the reserve, the coverage rule, the forbidden gate, the qualify rule and the part buffer are each load-bearing', async () => {
  const cases = [
    ['spendable ignores the reserve', "Math.max(0, reserveCount(key, stock) - (Number(reserve?.[key]) || 0))", 'Math.max(0, reserveCount(key, stock))',
      X => assert.equal(X.orderInputs('bricks', { stock: { cobblestone: BUILD_RESERVE.cobblestone, oak_log: BUILD_RESERVE.logs } }), null)],
    ['coverage gate dropped', "if (!(t.coverage >= MATS_MIN_COVERAGE)) return no('index_coverage', { coverage: t.coverage })", '',
      X => assert.equal(X.materialOrder(base({ town: { stock: RICH, coverage: 0.5 } })).skip, 'index_coverage')],
    ['forbidden gate dropped', "if (d > 0) forbidden[n] = d", '',
      X => assert.equal(X.matsBalance({ kind: 'bricks', withdrawn: { oak_log: 2, cobblestone: 12 }, deposited: { stone_bricks: 12 }, burnedPlanks: 8, smelted: 12, forbidden0: { coal: 5 }, forbidden1: { coal: 4 } }).verdict, 'forbidden')],
    ['a fuel slot with coal qualifies', "if (fuel) return { ok: false, why: `fuel:${fuel.name}` }", '',
      X => assert.equal(X.furnaceQualifies({ lit: false, fuel: { name: 'coal', count: 2 } }).ok, false)],
    ['lit unknown read as cold', "if (lit !== false) return", "if (lit === true) return",
      X => assert.equal(X.furnaceQualifies({ lit: null }).ok, false)],
    ['a stocked part is still made', "if (short < k.makes) { why('stocked'); continue }", '',
      X => assert.equal(X.materialOrder(base({ town: { stock: { ...RICH, stone_bricks: 128, glass_pane: 32, cut_copper: 24, copper_door: 3, torch: 64 }, coverage: 1 } })).skip, 'stocked')],
    ['no headroom check', "if (short < k.makes) { why('stocked'); continue }", "if (short <= 0) { why('stocked'); continue }",
      X => assert.equal(X.materialOrder(base({ town: { stock: { ...RICH, stone_bricks: 117, glass_pane: 32, cut_copper: 24, copper_door: 3, torch: 64 }, coverage: 1 } })).skip, 'stocked')],
    ['the take ignores the reserve', "return Math.max(0, Math.min(Number(want) || 0, Number(here?.[name]) || 0, spendable(rk, sum, reserve) - out))", "return Math.max(0, Math.min(Number(want) || 0, Number(here?.[name]) || 0))",
      X => assert.equal(X.takeAllowed('oak_log', 2, { others: { oak_log: 482 }, here: { oak_log: 30 } }), 0)],
    ['recovery takes a foreign output', "if (output && (output.name !== loaded.out || output.count > loaded.input.n)) return { ok: false, why: `output:${output.name}` }", '',
      X => assert.equal(X.recoveryContentsOk({ input: { name: 'cobblestone', n: 12 }, fuel: { name: 'oak_planks', n: 8 }, out: 'stone' }, { output: { name: 'iron_ingot', count: 1 } }).ok, false)],
    ['coal allowed in the torch recipe', "if (!used.length || used.some(n => !ok.has(n))) continue", "if (!used.length) continue",
      X => assert.equal(X.recipeUsing([{ id: 'coal', delta: [{ id: 4, count: -1 }, { id: 3, count: -1 }] }], i => ({ 3: 'stick', 4: 'coal' })[i], { allowed: ['charcoal', 'stick'] }), null)],
    ['a leftover input holds the note', "p.charcoalLeft === 0 && !Object.keys(p.bank).length", "p.charcoalLeft === 0 && !Object.keys(p.bank).length && !Object.keys(p.inputsLeft).length",
      X => assert.equal(X.noteSettled({ ...X.newNote({ kind: 'bricks', bag0: { stone: 0, stone_bricks: 0, cobblestone: 0 } }), loaded: { input: { name: 'cobblestone', n: 12 }, out: 'stone' } }, { stone: 3, cobblestone: 4 }), true)],
    ['the recount waits for the coverage floor', "if (u > 0) return {", "if (u > 0 && !(t.coverage >= MATS_MIN_COVERAGE)) return {",
      X => assert.equal(X.materialOrder(base({ town: { stock: RICH, coverage: 0.9 }, unknown: () => 1 })).order?.args.item, 'count')],
    ['the take ignores outstanding draws', "spendable(rk, sum, reserve) - out))", "spendable(rk, sum, reserve)))",
      X => assert.equal(X.takeAllowed('oak_log', 2, { others: { oak_log: 484 }, here: { oak_log: 30 }, taking: { logs: 2 } }), 0)],
    ['the intermediate is not capped by the batch', "const mid = k.smelt ? Math.min(above(k.smelt.out), batch) : 0", "const mid = k.smelt ? above(k.smelt.out) : 0",
      X => assert.equal(X.returnPlan({ ...X.newNote({ kind: 'torch', bag0: { charcoal: 0, stick: 0 } }), loaded: { input: { name: 'oak_log', n: 6 }, out: 'charcoal' }, sticks: 6 }, { charcoal: 30, stick: 6 }).charcoalLeft, 0)],
    ['the kit\'s sticks are spent', "out.torches = Math.min(mid, above('stick'), Math.max(0, Number(note.sticks) || 0))", "out.torches = Math.min(mid, above('stick'))",
      X => assert.equal(X.returnPlan({ ...X.newNote({ kind: 'torch', bag0: { charcoal: 0, stick: 0 } }), loaded: { input: { name: 'oak_log', n: 6 }, out: 'charcoal' }, sticks: 2 }, { charcoal: 6, stick: 6 }).torches, 2)],
    ['charcoal is not owed', "&& p.charcoalLeft === 0 ", "",
      X => assert.equal(X.noteSettled({ ...X.newNote({ kind: 'torch', bag0: { charcoal: 0, stick: 0 } }), loaded: { input: { name: 'oak_log', n: 6 }, out: 'charcoal' }, sticks: 0 }, { charcoal: 4 }), false)],
    ['a clock cut reads overburn', "planksToLoad(smelted) + (cut ? 1 : 0)", "planksToLoad(smelted)",
      X => assert.equal(X.matsBalance({ kind: 'bricks', bag0: { cobblestone: 100 }, withdrawn: { oak_log: 2 }, bag1: { cobblestone: 91, stone: 1, oak_planks: 1 }, deposited: { stone_bricks: 8 }, burnedPlanks: 7, smelted: 9, cut: true }).verdict, 'ok')],
    ['the placements are not booked', "const lost = Object.entries(families).some(([f, d]) => d + (pu[f] ?? 0) < -1e-9)", "const lost = lostRaw",
      X => assert.equal(X.matsBalance({ kind: 'bricks', bag0: { cobblestone: 100, oak_log: 0 }, withdrawn: { oak_log: 2 }, bag1: { cobblestone: 86 }, deposited: { stone_bricks: 12 }, burnedPlanks: 8, smelted: 12, placed: { cobblestone: 2 } }).verdict, 'scaffold')],
    ['the copper balance is blind', "  return { verdict: short > 0 ? 'loss' : 'ok', batch: n, out, back, short }\n}\n\n/** MAY THIS ATTEMPT", "  return { verdict: 'ok', batch: n, out, back, short }\n}\n\n/** MAY THIS ATTEMPT",
      X => assert.equal(X.copperBalance({ ...X.newNote({ kind: 'cut_copper', took: { copper_ingot: 36 }, bag0: {} }), crafting: true }, { bag: { copper_block: 2 } }).verdict, 'loss')],
    ['copper retained ingots not back', "  const back = Math.min(n - out, Math.max(above('copper_ingot'), Number(note.backSeen) || 0))\n  const short = Math.max(0, n - out - back)", "  const back = 0\n  const short = Math.max(0, n - out - back)",
      X => assert.equal(X.copperBalance({ ...X.newNote({ kind: 'cut_copper', took: { copper_ingot: 36 }, bag0: {} }), crafting: true }, { bag: { copper_ingot: 27 }, banked: { copper_block: 1 } }).verdict, 'ok')],
    ['copper_block is booked as an unspent input', "...(kind === 'cut_copper' ? ['copper_block'] : [])", "",
      X => assert.deepEqual(X.returnPlan(X.newNote({ kind: 'cut_copper', bag0: { copper_block: 0, cut_copper: 0 } }), { copper_block: 3 }).inputsLeft, {})],
    ['leftover blocks are not owed', "if (bl - out.cutCopper > 0) out.bank.copper_block = bl - out.cutCopper", "",
      X => assert.equal(X.noteSettled(X.newNote({ kind: 'cut_copper', bag0: { copper_block: 0, cut_copper: 0 } }), { copper_block: 3 }), false)],
    ['the stick wood is the kit\'s', "const pls = ACCT_PLANKS.filter(n => above(n) >= 2)", "const pls = ACCT_PLANKS.filter(n => (Number(bag?.[n]) || 0) >= 2)",
      X => assert.equal(X.returnPlan({ ...X.newNote({ kind: 'torch', bag0: { charcoal: 0, stick: 0, oak_planks: 4 } }), loaded: { input: { name: 'oak_log', n: 6 }, out: 'charcoal' }, sticks: 0 }, { charcoal: 6, oak_planks: 4 }).stickWood, null)],
    ['the recount ignores its backoff', "return keys.filter(k => !((failed?.get?.(keyOf(k))?.until ?? 0) > now))", "return keys",
      X => assert.deepEqual(X.matsRecountable(['a'], new Map([['a', { until: 9e15 }]]), 1), [])],
    ['a waiting recovery does not yield', "if (now < (Number(waitUntil) || 0)) return { order: null, state: s, skip: 'waiting' }", "",
      X => assert.equal(X.returnOrder({ atTown: true, noteOpen: true, now: 1000, waitUntil: 5000 }).skip, 'waiting')],
    ['an order into a full town', "if (!lazy(bankRoom)) return no('town_full', { coverage: t.coverage })", "",
      X => assert.equal(X.materialOrder(base({ bankRoom: () => false })).skip, 'town_full')],
    ['a kill before the load reads lost', ": Number.isFinite(Number(note.loaded.inputBefore)) && note.loaded.inputBefore != null ? Number(note.loaded.inputBefore) - n : NaN", ": NaN",
      X => assert.equal(X.recoveryBalance({ ...X.newNote({ kind: 'bricks', bag0: { cobblestone: 80 } }), loaded: { input: { name: 'cobblestone', n: 12 }, out: 'stone', inputBefore: 92 } }, { bag: { cobblestone: 92 } }).verdict, 'ok')],
    ['stick crafts not capped by the surplus', "{ planks: pls[0], crafts: Math.min(crafts, Math.floor(above(pls[0]) / 2)) }", "{ planks: pls[0], crafts }",
      X => assert.deepEqual(X.returnPlan({ ...X.newNote({ kind: 'torch', bag0: { charcoal: 0, stick: 0, oak_planks: 6 } }), loaded: { input: { name: 'oak_log', n: 6 }, out: 'charcoal' }, sticks: 0 }, { charcoal: 6, oak_planks: 8 }).stickWood, { planks: 'oak_planks', crafts: 1 })],
    ['the recovery\'s placements are not back', "(Number(bag?.[inName]) || 0) + (Number(placed?.[inName]) || 0) - after", "(Number(bag?.[inName]) || 0) - after",
      X => assert.equal(X.recoveryBalance({ ...X.newNote({ kind: 'bricks', bag0: { cobblestone: 80 } }), loaded: { input: { name: 'cobblestone', n: 12 }, out: 'stone', inputAfter: 80 } }, { bag: { cobblestone: 80, stone: 9 }, placed: { cobblestone: 3 } }).verdict, 'ok')],
    ['an empty furnace read as a loss', "if (nowhere && (drained === 'empty' || (KINDS[kind] && !KINDS[kind].smelt))) return 'unreconciled'", "",
      X => assert.equal(X.recoveryVerdict({ verdict: 'loss', out: 0, back: 0 }, 'empty'), 'unreconciled')],
    ['an empty furnace excuses a partial loss', "const nowhere = bal.verdict === 'loss' && bal.out === 0 && bal.back === 0", "const nowhere = bal.verdict === 'loss'",
      X => assert.equal(X.recoveryVerdict({ verdict: 'loss', out: 4, back: 0 }, 'empty'), 'loss')],
    ['input seen back is forgotten', "const back = Math.min(n - out, Math.max(above('copper_ingot'), Number(note.backSeen) || 0))", "const back = Math.min(n - out, above('copper_ingot'))",
      X => assert.equal(X.copperBalance({ ...X.newNote({ kind: 'cut_copper', took: { copper_ingot: 36 }, bag0: {} }), crafting: true, backSeen: 27, deposited: { copper_block: 1 } }, { bag: {} }).verdict, 'ok')],
    ['a partial drain does not count', "return /^(drained:\\d+|empty|gone)$/.test(String(drained ?? ''))", "return /^(empty|gone)$/.test(String(drained ?? ''))",
      X => assert.equal(X.backSeenTouched({ furnace: '1,2,3' }, 'drained:4'), true)],
    ['a lit wait counts', "return /^(drained:\\d+|empty|gone)$/.test(String(drained ?? ''))", "return true",
      X => assert.equal(X.backSeenTouched({ furnace: '1,2,3' }, 'lit'), false)],
    ['the recovery balance is blind', "return { verdict: short > 1e-9 ? 'loss' : 'ok', batch: n,", "return { verdict: 'ok', batch: n,",
      X => assert.equal(X.recoveryBalance({ ...X.newNote({ kind: 'bricks', bag0: { stone: 0, stone_bricks: 0, cobblestone: 80 } }), loaded: { input: { name: 'cobblestone', n: 12 }, out: 'stone', inputAfter: 80 } }, { bag: { cobblestone: 80, stone: 1 }, banked: { stone_bricks: 8 } }).verdict, 'loss')],
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
  // WIRING (Claude r1 P3): make_material's one furnace session takes NO output as its own -- any output is another session's.
  // matsSession's behaviour for own=null is tested in mats-session.test; this asserts make_material passes it (the Paper
  // `furn` scene is the world check). The executable call, comments stripped, exactly one session call.
  const skills = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  // MATS-01 x JUNKOUT-01 (re-stack 10-25): junkout's town visit yields to a materials recovery (and still to its own list)
  const { visitYieldsTo } = await import('../src/cognitive.mjs')
  assert.equal(visitYieldsTo({ skill: 'mats_return' }), true, 'the visit yields to mats_return')
  assert.equal(visitYieldsTo({ skill: 'found_work' }), true); assert.equal(visitYieldsTo({ skill: 'make_material' }), false, 'a new order is not first')
  // WIRING (Codex r5 P2-4): make_material's own bank books each deposit as it lands (onBanked), as mats_return's does
  assert.match(skills, /await matsBank\(ctx, obligations\(kind\)[^\n]*\{\s*\n?\s*onBanked:/, 'make_material passes onBanked')
  // WIRING (Codex r5 P2-1): the copper kinds' write-ahead is written BEFORE the crafts (copperBalance judges a note that says it)
  assert.match(skills, /if \(!K\.smelt\) \{ note\.crafting = true; writeMatsNote\(bot, note\) \}\s*\n\s*f\.made = await matsCrafts\(/, 'the crafting write-ahead precedes the crafts')
  // WIRING (Codex r6 P2): every attempt keeps the high-water mark of input seen back in the note (recoveryBalance reads it)
  // the gate's DECISION is backSeenTouched (tested on its own); this pins only that the recovery uses it before recording backSeen
  assert.match(skills, /if \(backSeenTouched\(note, drained\) && balNow\.back > \(Number\(note\.backSeen\) \|\| 0\)\) note\.backSeen = balNow\.back/, 'the recovery records backSeen through backSeenTouched')
  const calls = skills.match(/await matsSession\(ctx, \{[^}]*\}/g) ?? []
  assert.equal(calls.length, 1, 'one session call in make_material')
  assert.match(calls[0], /\bown: null\b/, 'own: null')
})
