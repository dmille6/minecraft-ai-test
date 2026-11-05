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
const FULL = { cobblestone: 900, oak_log: 1400, copper_ingot: 0, sand: 0, stone_bricks: 256, glass_pane: 32, cut_copper: 24, copper_door: 3, torch: 64, stone: 0, deepslate_bricks: 256, stone_brick_stairs: 32, stone_brick_slab: 48, stone_brick_wall: 16 }
const T0 = 50_000_000
const base = (over = {}) => ({ now: T0, on: true, shared: true, atTown: true, holds: false, noteOpen: false, freeSlots: 10, bagSpare: {},
  town: { stock: FULL, coverage: 1 }, furnace: () => true, table: () => true, lease: () => true, bodyMs: 0, state: {}, stoneworks: true, ...over })

test('the switch: on by default; off|0|false|no -> off; the kind order and the buffers follow it (off = the base exactly)', () => {
  assert.equal(M.STONEWORKS.on, true)
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.equal(M.stoneworksMode({ STONEWORKS: v }).on, false, v)
  for (const v of [undefined, '', 'on', '1', 'yes']) assert.equal(M.stoneworksMode({ STONEWORKS: v }).on, true, String(v))
  assert.deepEqual([...M.kindOrder(false)], ['bricks', 'cut_copper', 'copper_door', 'panes', 'torch'])
  assert.deepEqual([...M.kindOrder(true)], ['bricks', 'deepslate_bricks', 'stone', ...M.CUT_KINDS, 'cut_copper', 'copper_door', 'panes', 'torch'])
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
    ['a project lowers the coal keep', "[k, k === 'coal' || k === 'iron_ingot' ? v : projectFloor(v)]", '[k, projectFloor(v)]',
      X => assert.equal(X.effectiveReserve(X.withFuelReserve(R), { active: true, forProject: true }).table.coal, X.COAL_FUEL_KEEP)],
    ['stone counted twice in recovery', "const partUnits = k.part === k.smelt.out ? 0 : (", "const partUnits = (",
      X => assert.equal(X.recoveryBalance({ ...X.newNote({ kind: 'stone', bag0: { stone: 0 } }), furnace: '1,2,3', loaded: { input: { name: 'cobblestone', n: 12 }, fuel: { name: 'bamboo', n: 48 }, out: 'stone', inputAfter: 0 } }, { bag: { stone: 6 } }).verdict, 'loss')],
    ['the fuel family not burned', "if (lf) families.fuel += burnedPlanks", "if (lf) families.fuel += 0",
      X => assert.equal(X.matsBalance({ kind: 'stone', bag0: { cobblestone: 40, bamboo: 60 }, bag1: { cobblestone: 28, bamboo: 12 }, deposited: { stone: 12 }, burnedPlanks: 48, smelted: 12, fuel: { name: 'bamboo', ticks: 50 } }).verdict, 'ok')],
    ['the scaffold share ignored', "  return Number(scaffoldKeep(after).stone) || 0\n", "  return 0\n",
      X => assert.equal(X.stoneScaffoldHeld({ stone: 64 }, {}), 8)],
    ['the bag\'s spent cobble still counted', "for (const [n, c] of Object.entries(fromBag ?? {})) after[n] = Math.max(0, (Number(after[n]) || 0) - (Number(c) || 0))", "",
      X => assert.equal(X.stoneScaffoldHeld({ cobblestone: 12 }, { fromBag: { cobblestone: 12 } }), 8)],
    ['the project bricks buffer ignored', "  return project && part === 'stone_bricks' ? Math.max(b, BRICKS_PROJECT_BUFFER) : b", '  return b',
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
  assert.match(body, /effectiveBuffer\(K\.part, B\.table, \{ project: !!PR\.active, bill: /, 'the skill re-checks the buffer the order used')
  assert.match(body, /const RT = ladder \|\| \(STONEWORKS\.on && stoneworksKind\(kind\)\) \? withFuelReserve\(R\.table\) : R\.table/, 'the coal, deepslate, brick and iron keeps reach the take')
  assert.match(body, /matsWithdraw\(ctx, take, signal, reserveMs, RT,/, 'the withdraw is judged on it')
  assert.match(body, /obligations\(kind\)\.filter\(n => \(kind === 'stone' \|\| n !== 'stone'\) && n !== 'charcoal'\)/, 'the stone kind banks its stone')
  assert.match(body, /fuel: LFacct,/, 'the balance books the ladder fuel')
  assert.match(body, /if \(kind === 'stone' && stoneScaffoldHeld\(heldMap\(bot\), \{ fromBag: inp\.fromBag, made: LF \? LF\.batch : K\.smelt\.n \}\) > 0\)/, 'the skill refuses a stone order the deposit could not bank')
})

// ---- stoneworks-02 ----------------------------------------------------------------------------------------------------------
test('THE DEEPSLATE KIND: 16 cobbled deepslate -> 16 polished -> 16 deepslate bricks, crafting only; the bag first, then the town above 64', () => {
  const k = M.KINDS.deepslate_bricks
  assert.equal(k.smelt, null); assert.equal(k.table, false); assert.equal(k.makes, 16)
  for (const n of ['cobbled_deepslate', 'polished_deepslate', 'deepslate_bricks', 'deepslate_brick_stairs', 'deepslate_brick_slab', 'deepslate_brick_wall']) assert.ok(mcData.itemsByName[n], n)
  const i = M.orderInputs('deepslate_bricks', { bagSpare: { cobbled_deepslate: 10 }, stock: { cobbled_deepslate: M.DEEPSLATE_RESERVE + 6 }, reserve: M.withFuelReserve(R) })
  assert.deepEqual(i.fromBag, { cobbled_deepslate: 10 }); assert.deepEqual(i.take, { cobbled_deepslate: 6 })
  assert.equal(M.orderInputs('deepslate_bricks', { bagSpare: { cobbled_deepslate: 10 }, stock: { cobbled_deepslate: M.DEEPSLATE_RESERVE + 5 }, reserve: M.withFuelReserve(R) }), null, 'one short above the reserve')
  assert.deepEqual(M.orderInputs('deepslate_bricks', { bagSpare: { cobbled_deepslate: 40 }, stock: {}, reserve: M.withFuelReserve(R) }).fromBag, { cobbled_deepslate: 16 }, 'the bag alone')
  assert.deepEqual(M.obligations('deepslate_bricks').sort(), ['deepslate_bricks', 'polished_deepslate'])
  // always banked and never disposed: they are building parts now
  for (const n of ['deepslate_bricks', 'polished_deepslate', 'deepslate_brick_stairs']) { assert.ok(ST.PROJECT_PARTS.includes(n), n); assert.ok(ST.isProtected(n), n) }
  assert.ok(!ST.PROJECT_PARTS.includes('cobbled_deepslate'), 'the input is not a part (positive control)')
  // the order: bricks and deepslate below their buffers -> bricks first; bricks stocked -> deepslate (no fuel, no furnace needed)
  const o = M.materialOrder(base({ town: { stock: { ...FULL, deepslate_bricks: 0 }, coverage: 1 }, bagSpare: { cobbled_deepslate: 20 }, furnace: () => false }))
  assert.equal(o.order?.args.item, 'deepslate_bricks')
  // the order keeps the town's DEEPSLATE_RESERVE: 70 in town and none in the bag is not a batch; 80 is
  const dt = d => base({ town: { stock: { ...FULL, deepslate_bricks: 0, cobbled_deepslate: d }, coverage: 1 }, furnace: () => false })
  assert.match(M.materialOrder(dt(70)).kinds ?? '', /deepslate_bricks:inputs/)
  assert.equal(M.materialOrder(dt(80)).order?.args.item, 'deepslate_bricks')
  assert.equal(M.materialOrder(base({ stoneworks: false, buffers: M.buffersDefault(false), town: { stock: { ...FULL, stone_bricks: 128, deepslate_bricks: 0 }, coverage: 1 }, bagSpare: { cobbled_deepslate: 20 } })).skip, 'stocked', 'off: never ordered')
})

test('THE DEEPSLATE BALANCE AND RECOVERY: 1:1 units; before the craft write-ahead it is all input; polished deepslate is banked', () => {
  const n = { ...M.newNote({ kind: 'deepslate_bricks', took: { cobbled_deepslate: 6 }, fromBag: { cobbled_deepslate: 10 }, bag0: { cobbled_deepslate: 30, polished_deepslate: 0, deepslate_bricks: 0 } }), crafting: true }
  assert.equal(M.recoveryBalance(n, { bag: { cobbled_deepslate: 14, deepslate_bricks: 12, polished_deepslate: 4 } }).verdict, 'ok')
  const l = M.recoveryBalance(n, { bag: { cobbled_deepslate: 14, deepslate_bricks: 8 } })
  assert.equal(l.verdict, 'loss'); assert.equal(l.short, 8)
  assert.equal(M.recoveryBalance({ ...n, crafting: false }, { bag: { cobbled_deepslate: 14 } }).verdict, 'ok', 'never crafted: input only')
  assert.deepEqual(M.returnPlan(n, { cobbled_deepslate: 14, deepslate_bricks: 12, polished_deepslate: 4 }).bank, { deepslate_bricks: 12, polished_deepslate: 4 })
  const ok = M.matsBalance({ kind: 'deepslate_bricks', bag0: { cobbled_deepslate: 30 }, withdrawn: { cobbled_deepslate: 6 }, bag1: { cobbled_deepslate: 20 }, deposited: { deepslate_bricks: 16 } })
  assert.equal(ok.verdict, 'ok', JSON.stringify(ok))
  assert.equal(M.matsBalance({ kind: 'deepslate_bricks', bag0: { cobbled_deepslate: 30 }, withdrawn: { cobbled_deepslate: 6 }, bag1: { cobbled_deepslate: 20 }, deposited: { deepslate_bricks: 12 } }).verdict, 'loss')
})

test('THE BILLS DRIVE THE BRICKS: the open records\' remaining stone parts + 64, capped at 1024, never below the table', () => {
  assert.deepEqual(M.stoneBillDemand([{ stone_bricks: 306, planks: 117 }, { stone_bricks: 89, deepslate_bricks: 20 }, null]), { stone_bricks: 395, deepslate_bricks: 20 })
  const B = M.buffersDefault(true)
  assert.equal(M.effectiveBuffer('stone_bricks', B, { bill: { stone_bricks: 395 } }), 395 + M.BILL_MARGIN)
  assert.equal(M.effectiveBuffer('stone_bricks', B, { bill: { stone_bricks: 5000 } }), M.BILL_CAP)
  assert.equal(M.effectiveBuffer('stone_bricks', B, { bill: { stone_bricks: 50 } }), 256, 'never below the table')
  assert.equal(M.effectiveBuffer('stone_bricks', B, { bill: {}, project: true }), 256, 'a READ bill naming no bricks wins over the project rule')
  assert.equal(M.effectiveBuffer('stone_bricks', B, { bill: null, project: true }), 512, 'unreadable: the project rule')
  assert.equal(M.effectiveBuffer('deepslate_bricks', B, { bill: { deepslate_bricks: 400 } }), 464)
  assert.equal(M.effectiveBuffer('stone', B, { bill: { stone_bricks: 999 } }), 320, 'the trading stock is no bill part')
  assert.equal(M.effectiveBuffer('stone_bricks', M.buffersDefault(false), { bill: { stone_bricks: 999 }, on: false }), 128, 'off: the table')
  // through the order: a town at its 256 bricks with 400 still on the open bills makes bricks
  const bill = { stock: { ...FULL }, coverage: 1 }; Object.defineProperty(bill, 'bill', { value: { stone_bricks: 400 } })
  assert.equal(M.materialOrder(base({ town: bill, bagSpare: { bamboo: 64 } })).order?.args.item, 'bricks')
})

test('THE YARD: cobble from the bag, then the stock yard\'s piles, then the chests above their reserve', () => {
  const fb = M.fuelPlan({ bagSpare: { bamboo: 48 }, stock: {} })
  const i = M.orderInputs('stone', { bagSpare: { bamboo: 48, cobblestone: 2 }, stock: { cobblestone: R.cobblestone + 100 }, yard: 7, fuel: fb })
  assert.deepEqual(i.fromBag, { bamboo: 48, cobblestone: 2 }); assert.deepEqual(i.fromYard, { cobblestone: 7 }); assert.deepEqual(i.take, { cobblestone: 3 })
  assert.deepEqual(M.orderInputs('stone', { bagSpare: { bamboo: 48 }, stock: {}, yard: 200, fuel: fb }).fromYard, { cobblestone: 12 }, 'the yard alone')
  assert.equal(M.orderInputs('stone', { bagSpare: { bamboo: 48 }, stock: {}, yard: 11, fuel: fb }), null, 'the yard one short, the chests at their reserve')
  // through the order: a town whose chests hold no spare cobble, a yard with piles -> the order runs
  const t = { stock: { ...FULL, cobblestone: R.cobblestone }, coverage: 1 }; Object.defineProperty(t, 'yard', { value: 300 })
  assert.equal(M.materialOrder(base({ town: t, bagSpare: { bamboo: 64 } })).order?.args.item, 'stone')
  assert.equal(M.materialOrder(base({ town: { stock: { ...FULL, cobblestone: R.cobblestone }, coverage: 1 }, bagSpare: { bamboo: 64 } })).order, null, 'no yard: no order')
})

test('THE PALETTE HOOK: the trim stone the town stocks -- deepslate bricks, then stone bricks, then cobblestone', () => {
  assert.equal(M.trimStone({ deepslate_bricks: 80, stone_bricks: 500 }, 64), 'deepslate_bricks')
  assert.equal(M.trimStone({ deepslate_bricks: 60, stone_bricks: 500 }, 64), 'stone_bricks')
  assert.equal(M.trimStone({}, 64), 'cobblestone', 'nothing stocked: the last choice')
  assert.deepEqual([...M.TRIM_STONES], ['deepslate_bricks', 'stone_bricks', 'cobblestone'])
})

test('MUTANTS (stoneworks-02): the bill, the yard order, the deepslate balance, the deepslate reserve and the trim order are load-bearing', async () => {
  const fb = M.fuelPlan({ bagSpare: { bamboo: 48 }, stock: {} })
  const dn = { ...M.newNote({ kind: 'deepslate_bricks', took: { cobbled_deepslate: 6 }, fromBag: { cobbled_deepslate: 10 }, bag0: { cobbled_deepslate: 30 } }), crafting: true }
  const cases = [
    ['the bill ignored', "  if (bill && typeof bill === 'object' && BILL_PARTS.includes(part)) return", "  if (false) return",
      X => assert.equal(X.effectiveBuffer('stone_bricks', X.buffersDefault(true), { bill: { stone_bricks: 395 } }), 459)],
    ['the yard skipped', "if (fy > 0) { fromYard[name] = fy; rest -= fy }", "",
      X => assert.deepEqual(X.orderInputs('stone', { bagSpare: { bamboo: 48 }, stock: { cobblestone: R.cobblestone + 100 }, yard: 7, fuel: fb }).take, { cobblestone: 5 })],
    ['the deepslate balance blind', "  return { verdict: short > 0 ? 'loss' : 'ok', batch: n, out, back, short }\n}\n\n/** THE CUT KINDS'", "  return { verdict: 'ok', batch: n, out, back, short }\n}\n\n/** THE CUT KINDS'",
      X => assert.equal(X.recoveryBalance(dn, { bag: { cobbled_deepslate: 14, deepslate_bricks: 8 } }).verdict, 'loss')],
    ['the deepslate reserve dropped', ", cobbled_deepslate: DEEPSLATE_RESERVE,\n", ",\n",
      X => assert.equal(X.orderInputs('deepslate_bricks', { stock: { cobbled_deepslate: 70 }, reserve: X.withFuelReserve(R) }), null)],
    ['no town deepslate at all', "  if (name === 'cobbled_deepslate' && STONEWORKS.on) return 'cobbled_deepslate'\n", "",
      X => assert.equal(X.orderInputs('deepslate_bricks', { stock: { cobbled_deepslate: 1000 }, reserve: X.withFuelReserve(R) })?.take?.cobbled_deepslate, 16)],
    ['the trim order ignored', "  for (const n of choices) if ((Number(stock?.[n]) || 0) >= Math.max(1, Number(need) || 0)) return n", "",
      X => assert.equal(X.trimStone({ deepslate_bricks: 80 }, 64), 'deepslate_bricks')],
  ]
  for (const [name, old, neu, check] of cases) {
    await check(M)
    assert.ok(await withMutant(old, neu, X => killed(() => check(X))), `mutant survived: ${name}`)
  }
})

test('STRUCTURAL (stoneworks-02): the bill and yard readings are lazy and non-enumerable; the yard draw comes before the chests and is booked', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.match(src, /Object\.defineProperty\(out, 'bill', \{ get: \(\) => stoneBillNow\(bot\), enumerable: false \}\)/)
  assert.match(src, /Object\.defineProperty\(out, 'yard', \{ get: \(\) => yardCobbleNow\(bot\), enumerable: false \}\)/)
  const bill = src.slice(src.indexOf('export function stoneBillNow ('), src.indexOf('export function yardCobbleNow ('))
  assert.match(bill, /for \(const h of projectHeads\(\)\)/); assert.match(bill, /rec\.structure_complete\) continue/); assert.match(bill, /billOf\(rec, palette, read, \{ done: buildCellDone/)
  const body = src.slice(src.indexOf('async function makeMaterial ('), src.indexOf('async function matsReturnDrain ('))
  const yi = body.indexOf('await yardDrawFor(ctx, inp.fromYard.cobblestone'), wi = body.indexOf('await matsWithdraw(ctx, take,')
  assert.ok(yi > 0 && wi > yi, 'the yard draw precedes the chest withdraw')
  assert.match(body, /if \(yardGot > 0\) w\.took = \{ \.\.\.w\.took, cobblestone: \(w\.took\?\.cobblestone \?\? 0\) \+ yardGot \}/, 'the yard\'s cobble is booked as taken')
  assert.match(body, /bill: STONEWORKS\.on \? town\.bill \?\? null : null/, 'the skill re-checks the buffer on the bill')
})

// ---- stoneworks-03 ----------------------------------------------------------------------------------------------------------
test('THE CUT KINDS: 8 bricks a cut -- stairs and walls 1:1, slabs 1:2; a standing trim stock of the stone-brick parts; bills exact', () => {
  for (const k of M.CUT_KINDS) {
    const K = M.KINDS[k]
    assert.ok(mcData.itemsByName[k], k); assert.ok(ST.PROJECT_PARTS.includes(k), `${k} is a part (always banked)`)
    assert.equal(K.inputs[K.cut.from], 8); assert.equal(K.makes, 8 * K.cut.per); assert.equal(K.smelt, null)
  }
  assert.equal(M.KINDS.stone_brick_slab.cut.per, 2); assert.equal(M.KINDS.deepslate_brick_stairs.cut.from, 'deepslate_bricks')
  const B = M.buffersDefault(true)
  assert.equal(B.stone_brick_stairs, 32); assert.equal(B.deepslate_brick_stairs, 0, 'deepslate trims only by a bill')
  assert.equal(M.effectiveBuffer('deepslate_brick_stairs', B, { bill: { deepslate_brick_stairs: 40 } }), 40, 'a cut part\'s bill is exact')
  assert.equal(M.effectiveBuffer('stone_brick_stairs', B, { bill: { stone_brick_stairs: 10 } }), 32, 'never below the stock')
  // the cut takes town bricks only above their keep
  const i = M.orderInputs('stone_brick_stairs', { stock: { stone_bricks: M.CUT_BRICK_KEEP + 8 }, reserve: M.withFuelReserve(R) })
  assert.deepEqual(i.take, { stone_bricks: 8 })
  assert.equal(M.orderInputs('stone_brick_stairs', { stock: { stone_bricks: M.CUT_BRICK_KEEP + 7 }, reserve: M.withFuelReserve(R) }), null)
  assert.equal(M.swTakeAllowed('stone_bricks', 8, { others: { stone_bricks: 60 }, here: { stone_bricks: 10 }, reserve: M.withFuelReserve(R) }), 6)
  assert.equal(M.swTakeAllowed('stone_bricks', 8, { others: { stone_bricks: 0 }, here: { stone_bricks: 30 }, reserve: M.withFuelReserve(R) }), 0)
  // the reserve families' readers are unchanged: a brick is still no reserve family
  assert.equal(M.reserveKeyOf('stone_bricks'), null); assert.equal(M.reserveKeyOf('iron_ingot'), null); assert.equal(M.swKeepKey('stone_bricks'), 'stone_bricks')
})

test('THE STATION: no stonecutter in reach -> the order makes one (1 town iron above 32 + 3 stone at a table); with one -> the cut', () => {
  const T = (over = {}, cutter = false) => { const t = { stock: { ...FULL, stone_brick_stairs: 0, iron_ingot: 40, stone: 10, ...over }, coverage: 1 }; Object.defineProperty(t, 'cutter', { value: cutter }); return t }
  const st = M.materialOrder(base({ town: T(), furnace: () => false }))
  assert.equal(st.order?.args.item, 'stonecutter'); assert.deepEqual(st.inputs.take, { iron_ingot: 1, stone: 3 })
  assert.equal(M.materialOrder(base({ town: T({}, true), furnace: () => false })).order?.args.item, 'stone_brick_stairs')
  const lo = M.materialOrder(base({ town: T({ iron_ingot: M.STATION_IRON_KEEP }), furnace: () => false }))
  assert.equal(lo.order, null); assert.match(lo.kinds, /stone_brick_stairs:no_cutter/)
  assert.equal(M.materialOrder(base({ town: T(), furnace: () => false, table: () => false })).order, null, 'no table: no station')
  // the iron keep is never a project's to lower; the station owes nothing banked; its balance books the placed station
  assert.equal(M.effectiveReserve(M.withFuelReserve(R), { active: true, forProject: true }).table.iron_ingot, M.STATION_IRON_KEEP)
  assert.deepEqual(M.obligations('stonecutter'), [])
  const b = M.matsBalance({ kind: 'stonecutter', bag0: { iron_ingot: 2, stone: 0 }, withdrawn: { iron_ingot: 1, stone: 3 }, bag1: { iron_ingot: 2 }, deposited: { stonecutter: 1 }, forbidden0: { iron_ingot: 2 }, forbidden1: { iron_ingot: 2 } })
  assert.equal(b.verdict, 'ok', JSON.stringify(b))
  assert.equal(M.matsBalance({ kind: 'stonecutter', bag0: { iron_ingot: 2 }, withdrawn: { stone: 3 }, bag1: { iron_ingot: 1 }, deposited: { stonecutter: 1 }, forbidden0: { iron_ingot: 2 }, forbidden1: { iron_ingot: 1 } }).verdict, 'forbidden', 'the bag\'s own iron is never the station\'s')
})

test('THE CUT BALANCE AND THE BUTTON: input units (a slab half a brick); the recipe index is the one the probe saw', () => {
  const n = { ...M.newNote({ kind: 'stone_brick_slab', took: { stone_bricks: 8 }, bag0: { stone_bricks: 0, stone_brick_slab: 0 } }), crafting: true }
  assert.equal(M.recoveryBalance(n, { bag: { stone_brick_slab: 16 } }).verdict, 'ok')
  const l = M.recoveryBalance(n, { bag: { stone_brick_slab: 8 } }); assert.equal(l.verdict, 'loss'); assert.equal(l.short, 4)
  assert.equal(M.recoveryBalance(n, { bag: { stone_brick_slab: 8, stone_bricks: 4 } }).verdict, 'ok', 'uncut bricks back')
  assert.equal(M.matsBalance({ kind: 'stone_brick_slab', withdrawn: { stone_bricks: 8 }, deposited: { stone_brick_slab: 16 } }).verdict, 'ok')
  assert.equal(M.cutterButton([{ b: 0, name: 'chiseled_stone_bricks' }, { b: 1, name: 'stone_brick_slab' }, { b: 2, name: 'stone_brick_stairs' }], 'stone_brick_stairs'), 2)
  assert.equal(M.cutterButton([{ b: 0, name: 'chiseled_stone_bricks' }], 'stone_brick_wall'), -1)
})

test('THE CUT through the real matsCut against a fake stonecutter window (the Paper-proven protocol: transfer n, probe, shift-click)', async () => {
  const S = await import('../src/skills.mjs')
  const { Vec3 } = createRequire(import.meta.url)('vec3')
  const RECIPES = { stone_bricks: ['chiseled_stone_bricks', 'stone_brick_slab', 'stone_brick_stairs', 'stone_brick_wall'] }
  const PER = { stone_brick_slab: 2 }
  const bag = [{ name: 'stone_bricks', count: 20, type: 1 }]
  const writes = []
  const pos = new Vec3(2, 64, 0)
  const win = { id: 7, inventoryStart: 2, inventoryEnd: 38, slots: [null, null], closed: 0 }
  const bot = {
    registry: { itemsByName: { stone_bricks: { id: 1 }, deepslate_bricks: { id: 2 } }, blocks: { 9: { name: 'stonecutter' } } },
    entity: { position: new Vec3(1, 64, 0) },
    findBlock: () => ({ position: pos, type: 9 }),
    pathfinder: { goto: async () => {} },
    inventory: { items: () => bag.filter(b => b.count > 0) },
    openBlock: async () => win,
    transfer: async ({ itemType, count }) => { const nm = itemType === 2 ? 'deepslate_bricks' : 'stone_bricks'; const b = bag.find(x => x.name === nm); if (b) b.count -= count; win.slots[0] = { name: nm, count } },
    _client: { write: (name, p) => { writes.push([name, p.enchantment]); const out = RECIPES[win.slots[0]?.name]?.[p.enchantment]; win.slots[1] = out ? { name: out, count: PER[out] ?? 1 } : null } },
    clickWindow: async (slot, _b, mode) => { if (slot === 1 && mode === 1 && win.slots[1]) { const nm = win.slots[1].name; bag.push({ name: nm, count: win.slots[0].count * (PER[nm] ?? 1) }); win.slots[0] = null } },
    closeWindow: () => { win.closed++ },
  }
  const r = await S.matsCut({ bot }, 'stone_brick_stairs', 8, new AbortController().signal)
  assert.equal(r.stop, 'done'); assert.equal(r.button, 2)
  assert.deepEqual(writes.map(w => w[1]), [0, 1, 2], 'probed up to the first match, no further')
  assert.equal(bag.find(b => b.name === 'stone_brick_stairs')?.count, 8); assert.equal(bag[0].count, 12, 'exactly n went in')
  assert.equal(win.closed, 1, 'the window is closed')
  // a recipe the input cannot make: every button probed, nothing taken, still closed
  win.slots = [null, null]; writes.length = 0
  const bad = await S.matsCut({ bot }, 'deepslate_brick_wall', 4, new AbortController().signal)
  assert.equal(bad.stop, 'no_recipe'); assert.equal(writes.length, M.CUTTER_BUTTONS); assert.equal(win.closed, 2)
})

test('MUTANTS (stoneworks-03): the cutter gate, the brick keep, the cut balance and the probe are load-bearing', async () => {
  const T = (cutter) => { const t = { stock: { ...FULL, stone_brick_stairs: 0, iron_ingot: 40, stone: 10 }, coverage: 1 }; Object.defineProperty(t, 'cutter', { value: cutter }); return t }
  const n = { ...M.newNote({ kind: 'stone_brick_slab', took: { stone_bricks: 8 }, bag0: {} }), crafting: true }
  const cases = [
    ['no station first', "    if (k.cut && !t.cutter) {", "    if (false) {",
      X => assert.equal(X.materialOrder(base({ town: T(false), furnace: () => false })).order?.args.item, 'stonecutter')],
    ['the brick keep ignored', "  return Math.max(0, Math.min(Number(want) || 0, Number(here?.[name]) || 0, sum - (Number(reserve?.[name]) || 0)))", "  return Math.max(0, Math.min(Number(want) || 0, Number(here?.[name]) || 0))",
      X => assert.equal(X.swTakeAllowed('stone_bricks', 8, { others: {}, here: { stone_bricks: 30 }, reserve: X.withFuelReserve(R) }), 0)],
    ['slabs counted as bricks', "  const out = Math.min(n, Math.floor(parts / per))", "  const out = Math.min(n, parts)",
      X => assert.equal(X.recoveryBalance(n, { bag: { stone_brick_slab: 8 } }).verdict, 'loss')],
    ['the probe takes the first button', "for (const x of seen ?? []) if (x?.name === want) return x.b; return -1", "return seen?.[0]?.b ?? -1",
      X => assert.equal(X.cutterButton([{ b: 0, name: 'chiseled_stone_bricks' }, { b: 2, name: 'stone_brick_stairs' }], 'stone_brick_stairs'), 2)],
  ]
  for (const [name, old, neu, check] of cases) {
    await check(M)
    assert.ok(await withMutant(old, neu, X => killed(() => check(X))), `mutant survived: ${name}`)
  }
})

test('STRUCTURAL (stoneworks-03): the station is made only when no cutter is in reach; a carried cutter is placed by the cut', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const body = src.slice(src.indexOf('async function makeMaterial ('), src.indexOf('async function matsReturnDrain ('))
  assert.match(body, /if \(K\.station \? \(!!findCutter\(bot\) \|\| \(heldMap\(bot\)\.stonecutter \?\? 0\) > 0\) :/, 'the station is stocked by a cutter in reach')
  assert.match(body, /swKeepKey\(n2\) \? swTakeAllowed\(n2, w2, \{ \.\.\.o2, reserve: RT \}\) : PD\.allow\(n2, w2, o2\)/, 'the keeps reach the take')
  assert.match(body, /if \(K\.station && cw\.stationPlaced\) f\.deposited\.stonecutter = 1/)
  const cut = src.slice(src.indexOf('export async function matsCut ('), src.indexOf('/** What the bag holds ABOVE its keeps'))
  assert.match(cut, /if \(!block && \(heldMap\(bot\)\.stonecutter \?\? 0\) > 0\) \{ const put = await place\(ctx, \{ item: 'stonecutter' \}, signal\)/)
})
