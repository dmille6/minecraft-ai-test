// ENCHANTSHOP-01: THE ENCHANTING + ANVIL WORKSHOP (bots/src/enchantshop.mjs; blueprints/enchantshop@1.json; shop.mjs PROJECTS;
// skills.mjs enchantSiteFor / enchantGateRows / enchantUpkeepDue / enchantFitOne wiring; requests.mjs `_enchantshop_gate`).
// Behaviour: the blueprint's shelf geometry against the vanilla rule; the opening rule; the siting on the wall extension's hall-size
// plot by the real planner on the fake flat world (the plot's own zone the one dropped) and the shell built end to end by the real
// visit runner; the fit-out's materials plan with the keeps; its states (placed, open, lost); the fitter's choice and its gates; the
// gate rows through the real requests board into town requests (open per input, met when no longer short); one furnishing placed by
// the real visit runner on its one-cell record. STRUCTURAL source assertions only for the wiring (comments stripped, anchored on
// executable lines), each shown to fail by an anchored mutant.
import assert from 'node:assert'
import fs, { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { B, R, HOME, G, server, bot, plan, project } = await import('./helpers/buildfake.mjs')
const E = await import('../src/enchantshop.mjs')
const RQ = await import('../src/requests.mjs')
const SHOPM = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const EN_PATH = new URL('../src/enchantshop.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const k3 = a => a.join(',')

const BP = B.loadBlueprint(E.ENCHANT_BLUEPRINT)
console.log('THE BLUEPRINT')
await t('a 17 x 11 shell of 459 cells (its ring = the 19 x 13 plot); the fit-out is 17 slots, NONE of them a cell', () => {
  assert.deepStrictEqual(BP.footprint, { u: 17, v: 11 })
  assert.strictEqual(BP.cells.length, 459)
  assert.strictEqual(BP.fit.length, 17)
  assert.deepStrictEqual(BP.fit.map(f => f.item).reduce((m, i) => ({ ...m, [i]: (m[i] ?? 0) + 1 }), {}), { anvil: 1, enchanting_table: 1, bookshelf: 15 })
  const cells = new Set(BP.cells.map(c => `${c.u},${c.v},${c.y}`))
  for (const f of BP.fit) assert.ok(!cells.has(`${f.u},${f.v},${f.y}`), `fit slot ${f.slot} is never a record cell`)
  assert.strictEqual(BP.cells.filter(c => c.role === 'chest').length, 1, 'the book chest')
  assert.strictEqual(BP.cells.filter(c => c.role === 'table').length, 1, 'the crafting table the fitter crafts at')
})
await t('THE SHELF RULE (vanilla): every shelf at max(|du|,|dv|) = 2 from the table, at its level, the cell between in the kept-air gap; 15 = level 30', () => {
  const table = BP.fit.find(f => f.item === 'enchanting_table')
  const gap = new Set(BP.gap.map(g => g.join(',')))
  const shelves = BP.fit.filter(f => f.item === 'bookshelf')
  assert.strictEqual(shelves.length, 15)
  for (const s of shelves) {
    const du = s.u - table.u, dv = s.v - table.v
    assert.strictEqual(Math.max(Math.abs(du), Math.abs(dv)), 2, `${s.slot}`)
    assert.strictEqual(s.y, table.y, 'at the table\'s level')
    assert.ok(gap.has(`${table.u + Math.trunc(du / 2)},${table.v + Math.trunc(dv / 2)},${s.y}`), `${s.slot}: the cell between is kept air`)
  }
  // the way in: the ring's one free cell is the front middle, open at both heights
  assert.deepStrictEqual(BP.entry, [table.u, table.v - 2, 1])
  assert.ok(!shelves.some(s => s.u === BP.entry[0] && s.v === BP.entry[1]))
  // nothing that blocks (a torch, a sign, a cell) is ever in the gap
  const cellsXY = BP.cells.filter(c => c.y >= 1).map(c => `${c.u},${c.v},${c.y}`)
  for (const k of cellsXY) assert.ok(!gap.has(k), `cell ${k} in the gap`)
  for (const s of BP.signs) assert.ok(!gap.has(s.at.join(',')), 'a sign in the gap')
})
await t('the signs hang on plank wall cells (never glass), their stands are open aisle (no cell, no slot)', () => {
  const byCell = new Map(BP.cells.map(c => [`${c.u},${c.v},${c.y}`, c]))
  const slots = new Set(BP.fit.map(f => `${f.u},${f.v},${f.y}`))
  for (const s of BP.signs) {
    assert.strictEqual(byCell.get(s.wall.join(','))?.role, 'wall', `${s.lines[0]}: the wall is planks`)
    assert.ok(!byCell.has(s.at.join(',')), 'the sign cell is open')
    assert.ok(!byCell.has(s.stand.join(',')) && !slots.has(s.stand.join(',')), `${s.lines[0]}: the stand is free`)
    for (const l of s.lines) assert.ok(l.length <= 15)
  }
})

console.log('THE OPENING AND THE SITING (the real planner, the fake flat world)')
const PLOT = { id: 'X1', kind: 'hall', box: [-22, -45, -4, -33], y: [G, G] }
const EXT = { plot: 'wallext', blueprint: 'wallext@1', plots: [PLOT, { id: 'X2', kind: 'house', box: [20, -30, 30, -20], y: [G, G] }] }
await t('the opening: no extension -> no_extension; no hall-size plot -> no_hall_plot; a 19 x 13 plot -> open', () => {
  assert.deepStrictEqual(E.enchantOpening(null), { open: false, why: 'no_extension', plot: null })
  assert.strictEqual(E.enchantOpening({ plots: [EXT.plots[1]] }).why, 'no_hall_plot')
  assert.strictEqual(E.enchantOpening({ plots: [{ ...PLOT, box: [0, 0, 10, 10] }] }).why, 'plot_11x11')
  assert.deepStrictEqual(E.enchantOpening(EXT), { open: true, why: 'ok', plot: PLOT })
  // wallext-01 r2: TWO hall-size plots -- X2 (13 x 19) is the town hall's, the workshop takes X1 whatever the order
  const X2 = { id: 'X2', kind: 'hall', box: [6, -56, 18, -38], y: [G, G] }
  assert.strictEqual(E.enchantPlotOf({ plots: [X2, PLOT] }).id, 'X1')
  assert.strictEqual(E.enchantPlotOf({ plots: [X2] }), null, 'the town hall\'s 13 x 19 alone is not the workshop\'s')
})
const ZONES = [{ box: [PLOT.box[0], -64, PLOT.box[1], PLOT.box[2], 320, PLOT.box[3]], why: 'land:plot', id: 'X1' },
  { box: [20, -64, -30, 30, 320, -20], why: 'land:plot', id: 'X2' }]
await t('the siting plan drops the plot\'s OWN land zone only (positive control: the other plot\'s zone is kept)', () => {
  const sp = E.enchantSitingPlan(HOME, PLOT, ZONES)
  assert.deepStrictEqual(sp.zones.map(z => z.id), ['X2'])
  assert.ok(sp.domain(-22, -45) && sp.domain(-4, -33) && !sp.domain(-23, -40) && !sp.domain(-10, -32), 'the plot exactly')
})
const SP = E.enchantSitingPlan(HOME, PLOT, ZONES)
const S0 = B.siteBlueprint(server().read, plan(), BP, { tries: 3, zones: SP.zones, sectors: SP.sectors, plot: E.ENCHANT_PLOT, earth: SP.earth, domain: SP.domain, standDomain: SP.standDomain, walkR: SP.walkR, line: SP.line })
const REC = S0.ok ? E.enchantRecordOf(S0.record, BP, { plotId: 'X1', walkR: SP.walkR }) : null
await t('sited by the real planner: the pad + ring is the plot, the door toward home, the fit/gap/signs in world cells', () => {
  assert.ok(S0.ok, JSON.stringify(S0.sectors?.map(s => [s.screened, s.tried, s.rejects, s.proofFails])))
  assert.deepStrictEqual(REC.box, [-21, -44, -5, -34])
  assert.strictEqual(REC.orient, 'W')
  assert.strictEqual(REC.fit.length, 17)
  const table = REC.fit.find(f => f.item === 'enchanting_table').at
  for (const s of REC.fit.filter(f => f.item === 'bookshelf')) assert.strictEqual(Math.max(Math.abs(s.at[0] - table[0]), Math.abs(s.at[2] - table[2])), 2)
  assert.strictEqual(REC.gap.length, 16)
  assert.strictEqual(REC.plotId, 'X1')
  // a negative control: the same planner refuses the plot when its own zone is NOT dropped
  const N = B.siteBlueprint(server().read, plan(), BP, { tries: 3, zones: ZONES, sectors: SP.sectors, plot: E.ENCHANT_PLOT, earth: SP.earth, domain: SP.domain, standDomain: SP.standDomain, walkR: SP.walkR, line: SP.line })
  assert.strictEqual(N.ok, false)
})
const SHELL_KIT = () => ({ cobblestone: 300, stone_bricks: 100, oak_planks: 140, glass_pane: 20, torch: 6, chest: 1, crafting_table: 1 })
let BUILT = null
await t('the shell is built end to end by the real visit runner: complete, every cell once, every fit cell and gap cell still AIR', async () => {
  const srv = server(), { p } = project(REC)
  const e = bot(srv, 'A', { inv: SHELL_KIT() })
  const r = await R.runVisit({ ...p('A'), palette: BP.palette, ...E.enchantVisitOpts(REC) }, e, { maxSteps: 6000 })
  assert.strictEqual(r.stop, 'complete', JSON.stringify({ stop: r.stop, why: r.why, placed: r.placed }))
  assert.strictEqual(r.placed, REC.cells.length)
  assert.ok([...srv.placedAt.values()].every(n => n === 1))
  for (const f of REC.fit) assert.strictEqual(srv.read(...f.at).name, 'air', `${f.slot} open`)
  for (const g of REC.gap) assert.strictEqual(srv.read(...g).name, 'air', 'gap open')
  assert.strictEqual(srv.read(...REC.cells.find(c => c.role === 'chest').at).name, 'chest')
  BUILT = srv
})

console.log('THE FIT-OUT: THE MATERIALS PLAN (the keeps), THE STATES, THE CHOICE')
const TOWN = { iron_ingot: 197, diamond: 18, lapis_lazuli: 114, spruce_log: 356, oak_planks: 15, cobblestone: 923 }
const BAG = { iron_ingot: 3, sugar_cane: 4, spruce_planks: 120, bucket: 1 }
await t('the anvil: 31 town iron (3 blocks + 4) drawn above the keep of 64; at 94 iron it waits (short 1), at 95 it is whole', () => {
  const a = E.fitAvail(BAG, TOWN)
  assert.strictEqual(a.town.iron_ingot, 197 - E.IRON_KEEP)
  assert.ok(!('iron_ingot' in a.bag) && !('sugar_cane' in a.bag) && !('spruce_planks' in a.bag), 'the bag\'s kit iron, park cane and wood are never the fitter\'s')
  const p = E.fitPlan('anvil', 1, a)
  assert.ok(p.ok)
  assert.deepStrictEqual(p.take, { iron_ingot: 31 })
  assert.deepStrictEqual(p.crafts, [{ item: 'iron_block', count: 3 }, { item: 'anvil', count: 1 }])
  assert.deepStrictEqual(E.fitPlan('anvil', 1, E.fitAvail({}, { iron_ingot: 94 })).short, { iron_ingot: 1 })
  assert.ok(E.fitPlan('anvil', 1, E.fitAvail({}, { iron_ingot: 95 })).ok)
})
await t('the table: diamonds above the keep, but obsidian 4 and a book (leather 1 + 3 cane) are short; a book in the bag leaves obsidian', () => {
  const p = E.fitPlan('enchanting_table', 1, E.fitAvail(BAG, TOWN))
  assert.deepStrictEqual(p.short, { obsidian: 4, leather: 1, sugar_cane: 3 })
  assert.deepStrictEqual(E.fitPlan('enchanting_table', 1, E.fitAvail({ book: 1 }, TOWN)).short, { obsidian: 4 })
  assert.deepStrictEqual(E.fitPlan('enchanting_table', 1, E.fitAvail({}, { diamond: 4, obsidian: 4, book: 1 })).short, { diamond: 1 }, 'the diamond keep (3)')
  const ok = E.fitPlan('enchanting_table', 1, E.fitAvail({ obsidian: 4 }, { diamond: 5, leather: 1, sugar_cane: 3 }))
  assert.ok(ok.ok)
  assert.deepStrictEqual(ok.crafts, [{ item: 'paper', count: 3 }, { item: 'book', count: 1 }, { item: 'enchanting_table', count: 1 }])
})
await t('the 15 shelves: 45 books = 45 leather + 135 cane short; 90 planks from the town\'s logs (23 logs) are not', () => {
  const p = E.fitPlan('bookshelf', 15, E.fitAvail(BAG, TOWN))
  assert.deepStrictEqual(p.short, { leather: 45, sugar_cane: 135 })
  assert.strictEqual(p.take.planks, 15, 'the town\'s 15 oak planks first')
  assert.strictEqual(p.take.log, 19, 'then 75 planks = 19 logs')
  // TOWN cane counts (positive control for the bag's cane above)
  assert.deepStrictEqual(E.fitPlan('book', 1, E.fitAvail({}, { sugar_cane: 3, leather: 1 })).short, {})
})
await t('THE ANVIL WEARS OUT (coordinator 11-04): chipped and damaged read placed; gone (air) after its stamp it is OPEN again -- a new anvil is requested (31 iron) and placed; a table never', () => {
  const rec = { fit: [{ slot: 'anvil', item: 'anvil', at: [0, 0, 0] }], placed: ['anvil'] }
  for (const n of ['anvil', 'chipped_anvil', 'damaged_anvil']) assert.strictEqual(E.fitStates(rec, () => ({ name: n }))[0].state, 'placed', n)
  const st = E.fitStates(rec, () => ({ name: 'air' }))
  assert.strictEqual(st[0].state, 'open')
  const g = E.fitGates(st, E.fitAvail({}, { iron_ingot: 80 }))[0]
  assert.deepStrictEqual([g.why, g.short], ['wait', { iron_ingot: 15 }], 'the request for the new anvil: 31 above the keep')
  assert.ok(E.fitNext(st, E.fitAvail({}, { iron_ingot: 95 })).slot, 'iron there: the fitter places a new one')
})
await t('the states: placed / open / blocked / unknown; a chipped anvil is placed; a stamped TABLE that reads open is LOST', () => {
  const rec = { fit: [{ slot: 'anvil', item: 'anvil', at: [0, 0, 0] }, { slot: 'table', item: 'enchanting_table', at: [1, 0, 0] }, { slot: 's1', item: 'bookshelf', at: [2, 0, 0] }, { slot: 's2', item: 'bookshelf', at: [3, 0, 0] }], placed: ['table'] }
  const world = { '0,0,0': 'chipped_anvil', '1,0,0': 'air', '2,0,0': 'dirt' }
  const st = E.fitStates(rec, (x, y, z) => (world[`${x},${y},${z}`] ? { name: world[`${x},${y},${z}`] } : null))
  assert.deepStrictEqual(st.map(s => s.state), ['placed', 'lost', 'blocked', 'unknown'])
})
const stOf = (rec, read) => E.fitStates(rec, read)
await t('the fitter\'s choice: the anvil first; with the anvil placed and the shelves short, nothing (inputs_short); a book set lets a shelf through', () => {
  const read0 = (x, y, z) => BUILT.read(x, y, z)
  const a = E.fitAvail(BAG, TOWN)
  assert.strictEqual(E.fitNext(stOf(REC, read0), a).slot.slot, 'anvil')
  const anvilAt = REC.fit[0].at
  const read1 = (x, y, z) => (k3([x, y, z]) === k3(anvilAt) ? { name: 'anvil' } : BUILT.read(x, y, z))
  assert.deepStrictEqual(E.fitNext(stOf(REC, read1), a), { slot: null, why: 'inputs_short' })
  const nx = E.fitNext(stOf(REC, read1), E.fitAvail({ book: 3 }, TOWN))
  assert.strictEqual(nx.slot.item, 'bookshelf', 'the table is still short obsidian: a shelf goes first')
  assert.strictEqual(nx.slot.slot, 'shelf-01')
})
await t('the gates: one per furnishing, the ROOT shortfall of every open slot (the request\'s size)', () => {
  const g = E.fitGates(stOf(REC, (x, y, z) => BUILT.read(x, y, z)), E.fitAvail(BAG, TOWN))
  const by = Object.fromEntries(g.map(x => [x.fit, x]))
  assert.strictEqual(by.anvil.why, 'ok')
  assert.deepStrictEqual(by.table.short, { obsidian: 4, leather: 1, sugar_cane: 3 })
  assert.deepStrictEqual(by.shelves.short, { leather: 45, sugar_cane: 135 })
  assert.deepStrictEqual(by.shelves.need, { log: 23, leather: 45, sugar_cane: 135 })
  assert.match(E.gateDetail(by.shelves), /^fit=shelves item=bookshelf why=wait placed=0\/15 open=15 lost=0 short=sugar_cane:135,leather:45 need=sugar_cane:135,leather:45,log:23$/)
})
await t('the gate is `placed` only when every slot stands; nothing open but a lost/blocked slot is `held` (Codex r1 note)', () => {
  const st = [{ item: 'anvil', state: 'lost' }]
  assert.strictEqual(E.fitGates(st, E.fitAvail({}, {}))[0].why, 'held')
  assert.strictEqual(E.fitGates([{ item: 'anvil', state: 'placed' }], E.fitAvail({}, {}))[0].why, 'placed')
})
await t('fitDue: off, incomplete, no index, the gap, the idle back-off, a full bag or nothing whole -> false; else true', () => {
  const states = stOf(REC, (x, y, z) => BUILT.read(x, y, z))
  const a = E.fitAvail(BAG, TOWN)
  const base = { on: true, complete: true, states, avail: a, now: 1e9, lastAt: 0, idleUntil: 0, freeSlots: 20 }
  assert.strictEqual(E.fitDue(base), true)
  for (const over of [{ on: false }, { complete: false }, { avail: null }, { lastAt: 1e9 - 1000 }, { idleUntil: 1e9 + 1 }, { freeSlots: 2 }, { avail: E.fitAvail({}, { iron_ingot: 10 }) }]) assert.strictEqual(E.fitDue({ ...base, ...over }), false, JSON.stringify(Object.keys(over)))
})

await t('THE CARGO (Codex code r1 BLOCKER): drawn iron left in a bag is the next plan\'s (31 owed + 64 town = whole); crafting it away owes nothing; never the kit', () => {
  const bag = { iron_ingot: 34 }
  assert.deepStrictEqual(E.fitPlan('anvil', 1, E.fitAvail(bag, { iron_ingot: 64 })).short, { iron_ingot: 31 }, 'the repro: without the cargo, 31 short')
  const owed = E.cargoOwed({ iron_ingot: 31 }, bag)
  assert.deepStrictEqual(owed, { iron_ingot: 31 })
  const p = E.fitPlan('anvil', 1, E.fitAvail(bag, { iron_ingot: 64 }, { owed }))
  assert.ok(p.ok, JSON.stringify(p.short))
  assert.deepStrictEqual(p.fromBag, { iron_ingot: 31 }, 'from the bag, the town untouched')
  // the chain: 27 ingots -> 3 blocks, then 3 blocks + 4 ingots -> the anvil: the cargo goes to the anvil, the kit's 3 stay the kit's
  const c1 = E.cargoAfter({ iron_ingot: 31 }, { iron_ingot: -27, iron_block: 3 }, { iron_ingot: 7, iron_block: 3 })
  assert.deepStrictEqual(c1, { iron_ingot: 4, iron_block: 3 })
  const c2 = E.cargoAfter(c1, { iron_ingot: -4, iron_block: -3, anvil: 1 }, { iron_ingot: 3, anvil: 1 })
  assert.deepStrictEqual(c2, { anvil: 1 })
  assert.deepStrictEqual(E.cargoOwed(c2, { iron_ingot: 3 }), {}, 'placed: nothing owed, the kit iron never cargo')
  assert.deepStrictEqual(E.cargoOwed({ iron_ingot: 31 }, { iron_ingot: 10 }), { iron_ingot: 10 }, 'what left the bag is gone from the cargo')
})
console.log('THE REQUESTS (the real board: one request per furnishing and input, closed when no longer short)')
await t('gate rows -> open table:obsidian, table:leather, shelves:leather ...; the anvil (ok) opens none; obsidian arriving closes it; placed closes all', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enchreq-'))
  const rows = []
  let now = 1_000_000
  const board = RQ.makeBoard({ bot: { username: 'A' }, dir, emit: r => rows.push(r), now: () => now })
  const g = E.fitGates(stOf(REC, (x, y, z) => BUILT.read(x, y, z)), E.fitAvail(BAG, TOWN))
  const rec = d => ({ skill: { name: '_enchantshop_gate', status: 'success', detail: d } })
  for (const x of g) board.onRecord(rec(E.gateDetail(x)))
  const opened = rows.filter(r => /op=open/.test(r.detail)).map(r => /for=(\S+) item=(\S+)/.exec(r.detail).slice(1).join(':')).sort()
  assert.deepStrictEqual(opened, ['enchant_shelves:leather', 'enchant_shelves:sugar_cane', 'enchant_table:leather', 'enchant_table:obsidian', 'enchant_table:sugar_cane'])
  const st = JSON.parse(fs.readFileSync(path.join(dir, RQ.STATE_FILE), 'utf8'))
  assert.strictEqual(st.open['project:enchant_table:obsidian'].qty, 4)
  assert.strictEqual(st.open['project:enchant_shelves:leather'].qty, 45)
  // obsidian arrives (4 in a bag): the table's obsidian request is met, its leather/cane stay open
  now += 60_000
  const g2 = E.fitGates(stOf(REC, (x, y, z) => BUILT.read(x, y, z)), E.fitAvail({ obsidian: 4 }, TOWN)).find(x => x.fit === 'table')
  board.onRecord(rec(E.gateDetail(g2)))
  const met = rows.filter(r => /op=met/.test(r.detail)).map(r => /item=(\S+)/.exec(r.detail)[1])
  assert.deepStrictEqual(met, ['obsidian'])
  // the shelves placed: every shelves request is met
  board.onRecord(rec('fit=shelves item=bookshelf why=placed placed=15/15 open=0 lost=0 short=- need=-'))
  const met2 = rows.filter(r => /op=met/.test(r.detail) && /for=enchant_shelves/.test(r.detail)).map(r => /item=(\S+)/.exec(r.detail)[1]).sort()
  assert.deepStrictEqual(met2, ['leather', 'sugar_cane'])
  // the journal holds them for the town
  const j = fs.readFileSync(path.join(dir, RQ.JOURNAL_FILE), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  assert.ok(j.some(x => x.op === 'open' && x.for === 'enchant_table' && x.item === 'obsidian'))
  // a malformed row is no event (positive control above)
  assert.strictEqual(RQ.eventFor(rec('fit=bad!x why=wait short=obsidian:4')), null)
  assert.strictEqual(RQ.eventFor(rec('fit=table why=maybe short=obsidian:4')), null)
  assert.strictEqual(RQ.eventFor(rec('fit=table why=wait short=broken need=-')), null, 'a wait that names nothing short closes nothing (Codex r1 note)')
  assert.strictEqual(RQ.eventFor(rec('fit=shelves why=held placed=14/15 open=0 lost=1 short=- need=-')), null, 'held: the board keeps its requests')
})

console.log('ONE FURNISHING PLACED (the real visit runner on the one-cell record)')
await t('the anvil on its slot: one placement, the slot reads placed, nothing else changed', async () => {
  const slot = REC.fit.find(f => f.item === 'anvil')
  const fv = E.fitVisitRecord(REC, slot)
  assert.strictEqual(fv.record.cells.length, 1)
  assert.deepStrictEqual(fv.palette, { fit_anvil: ['anvil'] })
  const { p } = project(fv.record, ['F'])
  const e = bot(BUILT, 'F', { inv: { anvil: 1 } })
  const before = BUILT.placedAt.size
  const r = await R.runVisit({ ...p('F'), palette: fv.palette, ...E.enchantVisitOpts(REC) }, e, { maxSteps: 200 })
  assert.strictEqual(r.stop, 'complete', JSON.stringify({ stop: r.stop, why: r.why }))
  assert.strictEqual(r.placed, 1)
  assert.strictEqual(E.slotState(slot, BUILT.read(...slot.at)), 'placed')
  assert.strictEqual(BUILT.placedAt.size, before + 1)
})

console.log('THE ORDER (shop.mjs)')
await t('the project: after the storage hall, after the wall extension (and its demolition); off with its switch; a WAITING workshop is never offered', () => {
  const i = SHOPM.PROJECTS.findIndex(p => p.plot === E.ENCHANT_PLOT)
  assert.ok(i > SHOPM.PROJECTS.findIndex(p => p.plot === 'wallext') && i > SHOPM.PROJECTS.findIndex(p => p.plot === 'walldemo'), 'after the extension and its demolition')
  assert.strictEqual(SHOPM.PROJECTS[i].after, 'storehub')
  const list = SHOPM.PROJECTS.filter(p => ['shop', 'wallext', E.ENCHANT_PLOT].includes(p.plot)).map(p => ({ ...p, after: undefined }))
  const done = { plot: 'shop', exists: true, complete: true, damaged: false }
  const ext = { plot: 'wallext', exists: true, complete: true, damaged: false }
  assert.strictEqual(SHOPM.activeProject([done, ext, { plot: E.ENCHANT_PLOT, exists: false, complete: false, damaged: false, waiting: true }], list).plot !== E.ENCHANT_PLOT, true)
  assert.strictEqual(SHOPM.activeProject([done, ext, { plot: E.ENCHANT_PLOT, exists: false, complete: false, damaged: false }], list).plot, E.ENCHANT_PLOT, 'positive control: open, it is offered')
  assert.ok(!SHOPM.projectsOn(true, true, true, true, true, true, true, true, true, true, true, true, [], true, true, true, true, false).some(p => p.plot === E.ENCHANT_PLOT))
  assert.ok(SHOPM.projectsOn(true, true, true, true, true, true, true, true, true, true, true, true, [], true, true, true, true, true).some(p => p.plot === E.ENCHANT_PLOT))
  assert.ok(SHOPM.projectsGuarded([]).some(p => p.plot === E.ENCHANT_PLOT), 'a sited workshop stays guarded whatever the switch')
})
await t('the switches: on only in the showcase pool; ENCHANTSHOP=off / ENCHANTSHOP_FIT=off', () => {
  assert.deepStrictEqual(E.enchantSwitches({}, 'showcase'), { on: true, fit: true })
  assert.deepStrictEqual(E.enchantSwitches({}, 'hive-a'), { on: false, fit: false })
  assert.deepStrictEqual(E.enchantSwitches({ ENCHANTSHOP: 'off' }, 'showcase'), { on: false, fit: false })
  assert.deepStrictEqual(E.enchantSwitches({ ENCHANTSHOP_FIT: 'off' }, 'showcase'), { on: true, fit: false })
})

console.log('MUTANTS ON THE MODULE (anchors present and unique)')
await t('the iron keep, the bag allowlist, the gap rule, the lost stamp, the plot zone drop: each mutant fails its behaviour', async () => {
  await withMutant(EN_PATH, 'if (t.iron_ingot != null) t.iron_ingot = Math.max(0, t.iron_ingot - ironKeep)', '', async M => {
    assert.ok(M.fitPlan('anvil', 1, M.fitAvail({}, { iron_ingot: 40 })).ok, 'without the keep 40 iron would make the anvil')
  })
  assert.ok(!E.fitPlan('anvil', 1, E.fitAvail({}, { iron_ingot: 40 })).ok)
  await withMutant(EN_PATH, 'if (BAG_SPENDABLE.has(k) && (Number(v) || 0) > 0) b[k] = Number(v)', 'if ((Number(v) || 0) > 0) b[k] = Number(v)', async M => {
    assert.ok('sugar_cane' in M.fitAvail(BAG, TOWN).bag)
  })
  await withMutant(EN_PATH, "if (st === 'open' && stamped.has(s.slot) && s.item !== 'anvil') st = 'lost'", '', async M => {
    assert.strictEqual(M.fitStates({ fit: [{ slot: 't', item: 'enchanting_table', at: [0, 0, 0] }], placed: ['t'] }, () => ({ name: 'air' }))[0].state, 'open')
  })
  await withMutant(EN_PATH, "if (st === 'open' && stamped.has(s.slot) && s.item !== 'anvil') st = 'lost'", "if (st === 'open' && stamped.has(s.slot)) st = 'lost'", async M => {
    assert.strictEqual(M.fitStates({ fit: [{ slot: 'a', item: 'anvil', at: [0, 0, 0] }], placed: ['a'] }, () => ({ name: 'air' }))[0].state, 'lost', 'the mutant never re-files a worn-out anvil')
  })
  await withMutant(EN_PATH, "const mine = z => String(z?.why ?? '') === 'land:plot' && String(z?.id ?? '') === String(plot.id ?? '')", "const mine = z => String(z?.why ?? '') === 'land:plot'", async M => {
    assert.strictEqual(M.enchantSitingPlan(HOME, PLOT, ZONES).zones.length, 0, 'the mutant drops the OTHER plot too')
  })
  await withMutant(EN_PATH, "if (n === 'air' || n === 'cave_air') return 'open'", '', async M => {
    assert.strictEqual(M.slotState({ item: 'anvil' }, { name: 'air' }), 'blocked')
  })
})

console.log('THE WIRING (structural)')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const SH = strip(readFileSync(new URL('../src/shop.mjs', import.meta.url), 'utf8'))
const RQS = strip(readFileSync(new URL('../src/requests.mjs', import.meta.url), 'utf8'))
const WIRES = {
  'the project': [SH, /Object\.freeze\(\{ plot: ENCHANT_PLOT, blueprint: ENCHANT_BLUEPRINT, after: HUB_PLOT, builders: ENCHANT_BUILDERS \}\)/],
  'its switch': [SH, /p\.plot === ENCHANT_PLOT \? ench && ext && wall && hub && store && paths && on :/],
  'it waits unsited': [SK, /if \(p\.plot === ENCHANT_PLOT && !rec && !enchantOpenNow\(dir\)\) return \{ plot: p\.plot, exists: false, complete: false, damaged: false, due: false, dueFirst: false, waiting: true \}/],
  'its gate rows': [SK, /if \(p\.plot === ENCHANT_PLOT && rec && b\) enchantGateRows\(b, rec, now\)/],
  'the siting': [SK, /const ss = await enchantSiteFor\(bot, \{ \.\.\.h\.head\.plan, gen: h\.head\.gen \}, c, stood, signal\)/],
  'not the generic siting': [SK, /plot !== HUB_PLOT && plot !== ENCHANT_PLOT\) \{/],
  'the upkeep visit': [SK, /if \(plot === ENCHANT_PLOT && rec\.structure_complete && !recordDamaged\(bot, rec, \{ tidy: false \}\) && enchantUpkeepDue\(bot, rec\)\) return enchantUpkeepVisit\(ctx, rec, rh\.head\.gen, signal, out\)/],
  'the order sees the upkeep': [SK, /if \(tidy && r\.blueprint === ENCHANT_BLUEPRINT && enchantUpkeepDue\(bot, r\)\) return true/],
  'the shell\'s stands': [SK, /const storeOpts = rec\.blueprint === ENCHANT_BLUEPRINT \? enchantVisitOpts\(rec\) :/],
  'the stamp only when the slot reads placed': [SK, /const ok = slotState\(slot, enchantRead\(bot\)\(\.\.\.slot\.at\)\) === 'placed'/],
  'the board reads the gate': [RQS, /if \(kind === '_enchantshop_gate'\) \{/],
  'a failed siting waits (no no_site loop)': [SK, /if \(!ss\.ok && ss\.why !== 'aborted'\) enchNoSiteUntil = Date\.now\(\) \+ ENCHANT_NOSITE_MS/],
  'the wait is read by the order': [SK, /return ENCH\.on && Date\.now\(\) >= enchNoSiteUntil && enchantOpening\(enchantExtNow\(dir\)\)\.open/],
  'the anvil + table skills find the workshop\'s stations': [SK, /return b \?\? enchantStationAt\(bot, names\)/],
  'an unreached station is not offered again (Codex r2)': [SK, /if \(Date\.now\(\) - \(bot\.enStationFail\?\.get\?\.\(s\.at\.join\(','\)\) \?\? -Infinity\) < ENCHANT_STATION_BAN_MS\) continue/],
  'the walk records the failure': [SK, /try \{ \(bot\.enStationFail \?\?= new Map\(\)\)\.set\(`\$\{p\.x\},\$\{p\.y\},\$\{p\.z\}`, Date\.now\(\)\) \}/],
}
await t('wiring: the project, its switch, the wait, the gate rows, the siting, the upkeep, the stands, the stamp, the board', () => {
  for (const [what, [src, re]] of Object.entries(WIRES)) assert.strictEqual((src.match(new RegExp(re.source, 'g')) ?? []).length, 1, `${what}`)
})
await t('MUTANTS KILLED: each wiring check fails on its line broken (anchor present and unique)', () => {
  const lines = {
    'it waits unsited': [SK, 'if (p.plot === ENCHANT_PLOT && !rec && !enchantOpenNow(dir)) return', 'if (false) return'],
    'the upkeep visit': [SK, 'enchantUpkeepDue(bot, rec)) return enchantUpkeepVisit(ctx, rec, rh.head.gen, signal, out)', 'false) return null'],
    'the stamp only when the slot reads placed': [SK, "const ok = slotState(slot, enchantRead(bot)(...slot.at)) === 'placed'", 'const ok = true'],
    'not the generic siting': [SK, 'plot !== HUB_PLOT && plot !== ENCHANT_PLOT) {', 'plot !== HUB_PLOT) {'],
    'the board reads the gate': [RQS, "if (kind === '_enchantshop_gate') {", "if (kind === '_never') {"],
    'the wait is read by the order': [SK, 'return ENCH.on && Date.now() >= enchNoSiteUntil && enchantOpening', 'return ENCH.on && enchantOpening'],
    'the anvil + table skills find the workshop\'s stations': [SK, 'return b ?? enchantStationAt(bot, names)', 'return b'],
    'an unreached station is not offered again (Codex r2)': [SK, "< ENCHANT_STATION_BAN_MS) continue", ') continue'],
  }
  for (const [what, [src, old, neu]] of Object.entries(lines)) {
    assert.strictEqual(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${what}`)
    const mut = src.replace(old, neu)
    assert.notStrictEqual((mut.match(new RegExp(WIRES[what][1].source, 'g')) ?? []).length, 1, `the check survives the mutant: ${what}`)
  }
})

console.log(`\nenchantshop: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
