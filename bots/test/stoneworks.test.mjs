// stoneworks-01 (OWNER 2026-11-05 "smelt cobblestone into stone for trading ... produce stone bricks for construction"): the
// switch ON. mats.test.mjs pins the base (STONEWORKS=off) exactly; this file drives the new decisions by behaviour -- the stone
// kind, the buffers, ore first, the fuel ladder (bamboo, surplus saplings, planks from surplus logs, coal above its keep; lava a
// disabled hook), the ladder fuel's accounting and the stone kind's recovery -- and the mutants that prove each is load-bearing.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-stoneworks'
process.env.BOT_NAME = process.env.BOT_NAME || 'StoneworksBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
delete process.env.MATS; delete process.env.MATS_RESERVE; delete process.env.MATS_BUFFERS; delete process.env.STONEWORKS

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const M = await import('../src/mats.mjs')
const ST = await import('../src/stocktarget.mjs')
const { SAPLING_RESERVE } = await import('../src/composter.mjs')
const { COAL_FLOOR } = await import('../src/coalrun.mjs')
const mcData = createRequire(import.meta.url)('minecraft-data')('1.21.8')

const MATS_PATH = new URL('../src/mats.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = readFileSync(MATS_PATH, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-stoneworks-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }

const R = ST.BUILD_RESERVE
// a town whose bricks sit at the new buffer, every other part stocked, cobble and logs above the reserve: the stone kind's town
const FULL = { cobblestone: 900, oak_log: 1400, copper_ingot: 0, sand: 0, stone_bricks: 256, glass_pane: 32, cut_copper: 24, copper_door: 3, torch: 64, stone: 0 }
const T0 = 50_000_000
const base = (over = {}) => ({ now: T0, on: true, shared: true, atTown: true, holds: false, noteOpen: false, freeSlots: 10, bagSpare: {},
  town: { stock: FULL, coverage: 1 }, furnace: () => true, table: () => true, lease: () => true, bodyMs: 0, state: {}, stoneworks: true, ...over })

test('the switch: on by default; off|0|false|no -> off; the kind order and the buffers follow it (off = the base exactly)', () => {
  assert.equal(M.STONEWORKS.on, true)
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.equal(M.stoneworksMode({ STONEWORKS: v }).on, false, v)
  for (const v of [undefined, '', 'on', '1', 'yes']) assert.equal(M.stoneworksMode({ STONEWORKS: v }).on, true, String(v))
  assert.deepEqual([...M.kindOrder(false)], ['bricks', 'cut_copper', 'copper_door', 'panes', 'torch'])
  assert.deepEqual([...M.kindOrder(true)], ['bricks', 'stone', 'cut_copper', 'copper_door', 'panes', 'torch'])
  assert.equal(M.buffersDefault(false).stone_bricks, 128); assert.equal(M.buffersDefault(true).stone_bricks, 256)
  assert.equal(M.buffersDefault(true).stone, 320, 'one apprentice mason restock: 16 uses x 20 stone')
  // the bricks' buffer rises while a project is active, never below the table; nothing else moves; off: the table
  assert.equal(M.effectiveBuffer('stone_bricks', M.buffersDefault(true), { project: true, on: true }), 512)
  assert.equal(M.effectiveBuffer('stone_bricks', M.buffersDefault(true), { project: false, on: true }), 256)
  assert.equal(M.effectiveBuffer('stone_bricks', { stone_bricks: 900 }, { project: true, on: true }), 900)
  assert.equal(M.effectiveBuffer('stone', M.buffersDefault(true), { project: true, on: true }), 320)
  assert.equal(M.effectiveBuffer('stone_bricks', M.buffersDefault(false), { project: true, on: false }), 128)
})

test('the stone kind is a real recipe: 12 cobblestone -> 12 stone (smelted), banked as stone; every name is an item', () => {
  const k = M.KINDS.stone
  assert.equal(k.part, 'stone'); assert.equal(k.smelt.input, 'cobblestone'); assert.equal(k.smelt.out, 'stone'); assert.equal(k.smelt.n, 12)
  for (const n of ['stone', 'cobblestone', 'bamboo', 'oak_sapling', 'coal', 'lava_bucket']) assert.ok(mcData.itemsByName[n], n)
  for (const r of M.FUEL_RUNGS) for (const n of r.names) assert.ok(mcData.itemsByName[n], `${r.rung}: ${n}`)
  assert.deepEqual(M.obligations('stone'), ['stone'], 'the stone it made is all the order owes')
  // the town banks the trading stock: the stone group's target holds the whole buffer (it was 64), not under the switch
  assert.ok(ST.targetOf('stone') >= M.STONE_BUFFER, `stone target ${ST.targetOf('stone')} >= ${M.STONE_BUFFER}`)
  assert.equal(ST.groupOf('stone'), 'stone'); assert.equal(ST.groupOf('cobbled_deepslate'), 'cobble', 'positive control: another group')
  // cobbled deepslate is never the stone kind's input (it smelts to deepslate, which no mason buys)
  assert.ok(!('cobbled_deepslate' in k.inputs))
})

test('THE FUEL LADDER: bamboo, then one species of surplus sapling, then planks from surplus logs, then coal above its keep', () => {
  // bamboo first, from the bag: 48 bamboo smelt exactly 12 (50 ticks each)
  const b = M.fuelPlan({ bagSpare: { bamboo: 60, oak_sapling: 99 }, stock: { oak_log: 2000, coal: 900 } })
  assert.equal(b.rung, 'bamboo'); assert.equal(b.count, 48); assert.equal(b.batch, 12); assert.deepEqual(b.fromBag, { bamboo: 48 }); assert.deepEqual(b.take, {})
  // too little bamboo for a whole batch -> the next rung; saplings above the composter's own keep, the most spare species
  const s = M.fuelPlan({ bagSpare: { bamboo: 47, oak_sapling: 30, birch_sapling: 50 }, stock: { oak_log: 2000 } })
  assert.equal(s.rung, 'sapling'); assert.equal(s.name, 'birch_sapling'); assert.equal(s.count, 24)
  assert.equal(M.SAPLING_FUEL_KEEP, SAPLING_RESERVE, 'the keep is the composter\'s per-species reserve')
  assert.equal(M.fuelPlan({ bagSpare: { oak_sapling: SAPLING_RESERVE + 23 }, stock: {} }), null, 'one short above the keep: no rung')
  assert.equal(M.fuelPlan({ bagSpare: { oak_sapling: SAPLING_RESERVE + 24 }, stock: {} }).rung, 'sapling', 'positive control')
  // saplings are never mixed across species
  assert.equal(M.fuelPlan({ bagSpare: { oak_sapling: 28, birch_sapling: 28 }, stock: {} }), null)
  // planks: two logs above the wood reserve -> 8 planks (the base path exactly)
  const p = M.fuelPlan({ bagSpare: {}, stock: { oak_log: R.logs + 2, coal: 900 } })
  assert.equal(p.rung, 'planks'); assert.deepEqual(p.take, { oak_log: 2 }); assert.equal(p.count, 8); assert.equal(p.name, 'oak_planks')
  assert.equal(M.fuelPlan({ bagSpare: {}, stock: { oak_log: R.logs + 1 } }), null, 'one log above the reserve is not a batch')
  // coal: only above COAL_FUEL_KEEP, one coal = a batch of 8
  const c = M.fuelPlan({ bagSpare: {}, stock: { coal: M.COAL_FUEL_KEEP + 1 } })
  assert.equal(c.rung, 'coal'); assert.equal(c.count, 1); assert.equal(c.batch, 8); assert.deepEqual(c.take, { coal: 1 })
  assert.equal(M.fuelPlan({ bagSpare: {}, stock: { coal: M.COAL_FUEL_KEEP } }), null, 'at the keep: none')
  assert.ok(M.COAL_FUEL_KEEP >= 64 + COAL_FLOOR, 'the coal-sale keep (64) and the smelt job\'s floor both stand')
  // the bag's own coal is never fuel (coal is a town rung only)
  assert.equal(M.fuelPlan({ bagSpare: { coal: 500 }, stock: {} }), null)
  // lava is a hook: never chosen while off, even with buckets in the bag
  assert.equal(M.FUEL_RUNGS.find(r => r.rung === 'lava').on, false)
  assert.equal(M.fuelPlan({ bagSpare: { lava_bucket: 5 }, stock: {} }), null)
  // the switch off: planks only, whatever the bag holds
  assert.equal(M.fuelPlan({ bagSpare: { bamboo: 99 }, stock: { oak_log: 2000 }, on: false }).rung, 'planks')
  assert.equal(M.fuelPlan({ bagSpare: { bamboo: 99 }, stock: {}, on: false }), null)
})

test('fuelBatch: the largest batch of fours whose fuel is a whole number of items', () => {
  assert.deepEqual(M.fuelBatch(12, 50), { batch: 12, count: 48 })
  assert.deepEqual(M.fuelBatch(12, 100), { batch: 12, count: 24 })
  assert.deepEqual(M.fuelBatch(12, 1600), { batch: 8, count: 1 })
  assert.deepEqual(M.fuelBatch(12, 20000), { batch: 0, count: 0 }, 'a lava bucket smelts 100: no exact batch of 12 or less')
  assert.equal(M.fuelToLoad(12, 50), 48); assert.equal(M.fuelToLoad(8, 1600), 1); assert.equal(M.fuelToLoad(7, 100), 14); assert.equal(M.fuelToLoad(5, 1600), 1)
})

test('orderInputs with a ladder fuel: the fuel replaces the log input; cobble from the bag first, then the town above its reserve', () => {
  const fb = M.fuelPlan({ bagSpare: { bamboo: 48 }, stock: {} })
  const i = M.orderInputs('stone', { bagSpare: { bamboo: 48, cobblestone: 5 }, stock: { cobblestone: R.cobblestone + 7 }, fuel: fb })
  assert.deepEqual(i.fromBag, { bamboo: 48, cobblestone: 5 }); assert.deepEqual(i.take, { cobblestone: 7 }); assert.equal(i.log, null); assert.equal(i.fuel.rung, 'bamboo')
  assert.equal(M.orderInputs('stone', { bagSpare: { bamboo: 48 }, stock: { cobblestone: R.cobblestone + 11 }, fuel: fb }), null, 'one cobble short')
  // the coal batch is 8: 8 cobble
  const fc = M.fuelPlan({ stock: { coal: 200 } })
  assert.deepEqual(M.orderInputs('bricks', { stock: { cobblestone: 900, coal: 200 }, fuel: fc }).take, { coal: 1, cobblestone: 8 })
  // planks keep the kind's own inputs exactly (the base path)
  const fp = M.fuelPlan({ stock: { oak_log: 2000 } })
  assert.deepEqual(M.orderInputs('bricks', { stock: { cobblestone: 900, oak_log: 2000 }, fuel: fp }).take, { cobblestone: 12, oak_log: 2 })
  assert.deepEqual(M.orderInputs('bricks', { stock: { cobblestone: 900, oak_log: 2000 } }).take, { cobblestone: 12, oak_log: 2 }, 'no fuel given: the base')
  // the ladder never fuels glass or torches
  assert.deepEqual(M.orderInputs('panes', { stock: { sand: 200, oak_log: 2000 }, fuel: fb }).take, { sand: 6, oak_log: 1 })
})

test('the coal keep is never lowered by a project; every other family is', () => {
  const E = M.effectiveReserve(M.withFuelReserve(R), { active: true, forProject: true })
  assert.equal(E.table.coal, M.COAL_FUEL_KEEP)
  assert.equal(E.table.logs, Math.ceil(R.logs * 0.2), 'positive control: logs are lowered')
  assert.equal(M.reserveKeyOf('coal'), 'coal')
  assert.equal(M.takeAllowed('coal', 5, { others: { coal: M.COAL_FUEL_KEEP }, here: { coal: 3 }, reserve: M.withFuelReserve(R) }), 3)
  assert.equal(M.takeAllowed('coal', 5, { others: { coal: M.COAL_FUEL_KEEP - 3 }, here: { coal: 3 }, reserve: M.withFuelReserve(R) }), 0)
})

test('THE ORDER: bricks first; stone once bricks are stocked; ore first; no fuel names itself; a project raises the bricks', () => {
  const o = M.materialOrder(base({ bagSpare: { bamboo: 64 } }))
  assert.equal(o.order?.args.item, 'stone'); assert.equal(o.inputs.fuel.rung, 'bamboo')
  // bricks below their 256: bricks first
  assert.equal(M.materialOrder(base({ town: { stock: { ...FULL, stone_bricks: 200 }, coverage: 1 } })).order?.args.item, 'bricks')
  // stone stocked at its 320 -> nothing (every other part stocked)
  assert.equal(M.materialOrder(base({ town: { stock: { ...FULL, stone: 320 }, coverage: 1 } })).skip, 'stocked')
  assert.equal(M.materialOrder(base({ town: { stock: { ...FULL, stone: 308 }, coverage: 1 } })).order?.args.item, 'stone', '12 headroom: one batch')
  // ore first: raw iron or raw copper in town -> the cobble kinds wait; gold does not count
  for (const ore of ['raw_iron', 'raw_copper']) {
    const r = M.materialOrder(base({ town: { stock: { ...FULL, stone_bricks: 0, [ore]: 3 }, coverage: 1 } }))
    assert.equal(r.order, null, ore); assert.match(r.kinds, /bricks:ore_first/); assert.match(r.kinds, /stone:ore_first/); assert.equal(r.skip, 'inputs')
  }
  assert.equal(M.materialOrder(base({ town: { stock: { ...FULL, raw_gold: 20 }, coverage: 1 } })).order?.args.item, 'stone', 'gold is no smelt-job input')
  // no fuel anywhere: no_fuel, said in kinds
  const nf = M.materialOrder(base({ town: { stock: { ...FULL, oak_log: R.logs }, coverage: 1 } }))
  assert.equal(nf.order, null); assert.match(nf.kinds, /stone:no_fuel/)
  // a project active (partReserve passed): bricks rise to 512, so a town at 256 makes bricks again
  const pr = M.effectiveReserve(R, { active: true, forProject: true }).table
  assert.equal(M.materialOrder(base({ partReserve: pr })).order?.args.item, 'bricks')
  // the switch off: no stone kind, bricks at 128 -- a town at 256 bricks is stocked
  assert.equal(M.materialOrder(base({ stoneworks: false, bagSpare: { bamboo: 64 } })).skip, 'stocked')
})

test('THE BALANCE with a ladder fuel: the fuel is its own family; burned within fuelToLoad is ok, more is overburn; the gate stands', () => {
  // 12 cobble from the bag on 48 bamboo from the bag -> 12 stone deposited
  const ok = M.matsBalance({ kind: 'stone', bag0: { cobblestone: 40, bamboo: 60 }, bag1: { cobblestone: 28, bamboo: 12 }, deposited: { stone: 12 }, burnedPlanks: 48, smelted: 12, fuel: { name: 'bamboo', ticks: 50 } })
  assert.equal(ok.verdict, 'ok', JSON.stringify(ok)); assert.equal(ok.families.fuel, 0); assert.equal(ok.fuel.expected, 48)
  const over = M.matsBalance({ kind: 'stone', bag0: { cobblestone: 40, bamboo: 60 }, bag1: { cobblestone: 28, bamboo: 8 }, deposited: { stone: 12 }, burnedPlanks: 52, smelted: 12, fuel: { name: 'bamboo', ticks: 50 } })
  assert.equal(over.verdict, 'overburn')
  const lost = M.matsBalance({ kind: 'stone', bag0: { cobblestone: 40, bamboo: 60 }, bag1: { cobblestone: 28, bamboo: 2 }, deposited: { stone: 12 }, burnedPlanks: 48, smelted: 12, fuel: { name: 'bamboo', ticks: 50 } })
  assert.equal(lost.verdict, 'loss', 'ten bamboo gone unburned')
  // the coal rung: one coal from town burned; the bag's own coal untouched -> ok; the bag's coal spent -> forbidden
  const coal = { kind: 'bricks', bag0: { cobblestone: 0, coal: 5 }, withdrawn: { cobblestone: 8, coal: 1 }, bag1: { coal: 5 }, deposited: { stone_bricks: 8 }, burnedPlanks: 1, smelted: 8, fuel: { name: 'coal', ticks: 1600 }, forbidden0: { coal: 5 }, forbidden1: { coal: 5 } }
  assert.equal(M.matsBalance(coal).verdict, 'ok', JSON.stringify(M.matsBalance(coal)))
  assert.equal(M.matsBalance({ ...coal, withdrawn: { cobblestone: 8 }, bag1: { coal: 4 }, forbidden1: { coal: 4 } }).verdict, 'forbidden')
  // the planks path is the base's: wood family, planks expected
  const pl = M.matsBalance({ kind: 'stone', bag0: { cobblestone: 0 }, withdrawn: { cobblestone: 12, oak_log: 2 }, deposited: { stone: 12 }, burnedPlanks: 8, smelted: 12 })
  assert.equal(pl.verdict, 'ok', JSON.stringify(pl)); assert.equal(pl.fuel.expected, 8)
  // the touched names book the fuel
  assert.ok(M.touchedNames('stone', null, 'bamboo').includes('bamboo')); assert.ok(!M.touchedNames('stone', null, null).includes('bamboo'))
})

test('THE STONE KIND\'S RECOVERY: the stone is banked, never crafted; part = intermediate is counted once', () => {
  const note = { ...M.newNote({ kind: 'stone', bag0: { stone: 2, cobblestone: 0 } }), furnace: '1,2,3', loaded: { input: { name: 'cobblestone', n: 12 }, fuel: { name: 'bamboo', n: 48 }, out: 'stone', inputAfter: 0 } }
  const p = M.returnPlan(note, { stone: 14 })
  assert.deepEqual(p.bank, { stone: 12 }); assert.equal(p.craftStone, 0)
  assert.equal(M.noteSettled(note, { stone: 2 }), true); assert.equal(M.noteSettled(note, { stone: 14 }), false)
  // half the batch in the bag and nothing else anywhere: a loss of 6 (the double count would read 12 = ok)
  const half = M.recoveryBalance(note, { bag: { stone: 8 } })
  assert.equal(half.verdict, 'loss'); assert.equal(half.short, 6)
  assert.equal(M.recoveryBalance(note, { bag: { stone: 14 } }).verdict, 'ok', 'positive control: the whole batch')
  assert.equal(M.recoveryContentsOk(note.loaded, { fuel: { name: 'bamboo', count: 20 }, output: { name: 'stone', count: 7 } }).ok, true)
  assert.equal(M.recoveryContentsOk(note.loaded, { fuel: { name: 'coal', count: 1 } }).ok, false, 'another session\'s coal')
})

test('THE SCAFFOLD (Codex code r1 BLOCKER): the stone kind runs only when the deposit keeps no stone as the bag\'s scaffold', () => {
  // the Codex case: 64 stone the bag's only scaffold -> the deposit would keep 8 of the stone
  assert.equal(M.stoneScaffoldHeld({ stone: 64, bamboo: 48 }, { fromBag: { bamboo: 48 } }), 8)
  // cobble the order spends from the bag does not count: 12 cobble, all spent -> nothing cheaper left
  assert.equal(M.stoneScaffoldHeld({ cobblestone: 12 }, { fromBag: { cobblestone: 12 } }), 8)
  assert.equal(M.stoneScaffoldHeld({ cobblestone: 15 }, { fromBag: { cobblestone: 12 } }), 5)
  // positive controls: 8 cobble (or cobbled deepslate) left after the order -> the stone is free to bank
  assert.equal(M.stoneScaffoldHeld({ cobblestone: 20, stone: 64 }, { fromBag: { cobblestone: 12 } }), 0)
  assert.equal(M.stoneScaffoldHeld({ cobbled_deepslate: 8, stone: 64 }, { fromBag: {} }), 0)
  assert.equal(M.stoneScaffoldHeld({ dirt: 64, stone: 64 }, { fromBag: {} }), 8, 'dirt is no pathfinder scaffold (scaffold.mjs): it does not count')
})

test('MUTANTS: the ladder order, the coal keep, the sapling keep, ore first, the project coal floor and the single count are load-bearing', async () => {
  const cases = [
    ['planks before bamboo', "Object.freeze({ rung: 'bamboo', names: Object.freeze(['bamboo']), ticks: 50, from: 'bag', keep: 0, on: true }),",
      "Object.freeze({ rung: 'bamboo', names: Object.freeze(['bamboo']), ticks: 50, from: 'bag', keep: 0, on: false }),",
      X => assert.equal(X.fuelPlan({ bagSpare: { bamboo: 60 }, stock: { oak_log: 2000 } }).rung, 'bamboo')],
    ['coal keep ignored', "(Number(stock?.[name]) || 0) - Math.max(r.keep ?? 0, Number(withFuelReserve(reserve)[name]) || 0)", "(Number(stock?.[name]) || 0)",
      X => assert.equal(X.fuelPlan({ stock: { coal: 50 } }), null)],
    ['sapling keep ignored', "const have = r.from === 'bag' ? (Number(bagSpare?.[name]) || 0) - r.keep", "const have = r.from === 'bag' ? (Number(bagSpare?.[name]) || 0)",
      X => assert.equal(X.fuelPlan({ bagSpare: { oak_sapling: 30 }, stock: {} }), null)],
    ['ore first dropped', "if (stoneworks && oreWaiting(kind, t.stock)) { why('ore_first'); continue }", '',
      X => assert.equal(X.materialOrder(base({ town: { stock: { ...FULL, raw_iron: 3 }, coverage: 1 } })).order, null)],
    ['a project lowers the coal keep', "[k, k === 'coal' ? v : projectFloor(v)]", '[k, projectFloor(v)]',
      X => assert.equal(X.effectiveReserve(X.withFuelReserve(R), { active: true, forProject: true }).table.coal, X.COAL_FUEL_KEEP)],
    ['stone counted twice in recovery', "const partUnits = k.part === k.smelt.out ? 0 : (", "const partUnits = (",
      X => assert.equal(X.recoveryBalance({ ...X.newNote({ kind: 'stone', bag0: { stone: 0 } }), furnace: '1,2,3', loaded: { input: { name: 'cobblestone', n: 12 }, fuel: { name: 'bamboo', n: 48 }, out: 'stone', inputAfter: 0 } }, { bag: { stone: 6 } }).verdict, 'loss')],
    ['the fuel family not burned', "if (lf) families.fuel += burnedPlanks", "if (lf) families.fuel += 0",
      X => assert.equal(X.matsBalance({ kind: 'stone', bag0: { cobblestone: 40, bamboo: 60 }, bag1: { cobblestone: 28, bamboo: 12 }, deposited: { stone: 12 }, burnedPlanks: 48, smelted: 12, fuel: { name: 'bamboo', ticks: 50 } }).verdict, 'ok')],
    ['the scaffold share ignored', "  return Number(scaffoldKeep(after).stone) || 0\n", "  return 0\n",
      X => assert.equal(X.stoneScaffoldHeld({ stone: 64 }, {}), 8)],
    ['the bag\'s spent cobble still counted', "for (const [n, c] of Object.entries(fromBag ?? {})) after[n] = Math.max(0, (Number(after[n]) || 0) - (Number(c) || 0))", "",
      X => assert.equal(X.stoneScaffoldHeld({ cobblestone: 12 }, { fromBag: { cobblestone: 12 } }), 8)],
    ['the project bricks buffer ignored', "return on && project && part === 'stone_bricks' ? Math.max(b, BRICKS_PROJECT_BUFFER) : b", 'return b',
      X => assert.equal(X.effectiveBuffer('stone_bricks', X.buffersDefault(true), { project: true, on: true }), 512)],
  ]
  for (const [name, old, neu, check] of cases) {
    // the positive control on the real module first: the check passes unmutated
    await check(M)
    assert.ok(await withMutant(old, neu, X => killed(() => check(X))), `mutant survived: ${name}`)
  }
})

test('STRUCTURAL: make_material wires the ladder (the skill revalidates the order\'s rules; the stone kind is banked)', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const body = src.slice(src.indexOf('async function makeMaterial ('), src.indexOf('async function matsReturnDrain ('))
  assert.ok(body.length > 1000, 'makeMaterial found')
  assert.match(body, /const fuelP = ladder \? fuelPlan\(\{ n: K\.smelt\.n, bagSpare: spare, stock: town\.stock, reserve: E\.table, on: true \}\) : null/, 'the skill plans the fuel on the effective reserve')
  assert.match(body, /if \(ladder && oreWaiting\(kind, town\.stock\)\)/, 'the skill re-checks ore first')
  assert.match(body, /effectiveBuffer\(K\.part, B\.table, \{ project: !!PR\.active \}\)/, 'the skill re-checks the buffer the order used')
  assert.match(body, /const RT = ladder \? withFuelReserve\(R\.table\) : R\.table/, 'the coal keep reaches the take')
  assert.match(body, /matsWithdraw\(ctx, inp\.take, signal, reserveMs, RT,/, 'the withdraw is judged on it')
  assert.match(body, /obligations\(kind\)\.filter\(n => \(kind === 'stone' \|\| n !== 'stone'\) && n !== 'charcoal'\)/, 'the stone kind banks its stone')
  assert.match(body, /fuel: LFacct,/, 'the balance books the ladder fuel')
  assert.match(body, /if \(kind === 'stone' && stoneScaffoldHeld\(heldMap\(bot\), \{ fromBag: inp\.fromBag, made: LF \? LF\.batch : K\.smelt\.n \}\) > 0\)/, 'the skill refuses a stone order the deposit could not bank')
})
