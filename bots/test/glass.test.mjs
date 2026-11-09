// glass-01 (OWNER 2026-11-08 "a sand-to-glass line ... so cottages and other buildings get real windows"): glass.mjs's decisions by
// behaviour -- the window reading, the capped sand want, the order (glaze first, then sand), the shore rule (dry stand, one-deep
// hole, no deep water near), the dig walk, the pane's reference faces -- the materials job's wiring, and the mutants that prove
// each rule is load-bearing.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-glass'
process.env.BOT_NAME = process.env.BOT_NAME || 'GlassBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
delete process.env.MATS; delete process.env.MATS_RESERVE; delete process.env.MATS_BUFFERS; delete process.env.GLASS

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const G = await import('../src/glass.mjs')
const M = await import('../src/mats.mjs')
const mcData = createRequire(import.meta.url)('minecraft-data')('1.21.8')

const GLASS_PATH = new URL('../src/glass.mjs', import.meta.url)
const MATS_PATH = new URL('../src/mats.mjs', import.meta.url)
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-glass-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }

// ---- a small world: a sand beach at y 63 over sand, a sea to the east, grass to the west ------------------------------------------
const SOLID = { boundingBox: 'block' }
function world (cells = {}, dflt = (x, y, z) => (y <= 62 ? { name: 'stone', ...SOLID } : { name: 'air', boundingBox: 'empty' })) {
  const m = new Map(Object.entries(cells))
  return (x, y, z) => { const k = `${x},${y},${z}`; return m.has(k) ? m.get(k) : dflt(x, y, z) }
}
const sand = { name: 'sand', ...SOLID }
const water = { name: 'water', boundingBox: 'empty' }
const air = { name: 'air', boundingBox: 'empty' }
// a 9x9 beach centred on (100, 63, 0): sand at y 63 and 62, air above; `sea(x0)` makes every column with x >= x0 water from y 63
// down to y 63 - depth + 1
function beach ({ seaFrom = null, depth = 1, extra = {} } = {}) {
  const c = {}
  for (let x = 90; x <= 110; x++) for (let z = -10; z <= 10; z++) {
    if (seaFrom != null && x >= seaFrom) { for (let d = 0; d < depth; d++) c[`${x},${63 - d},${z}`] = water; continue }
    c[`${x},63,${z}`] = sand; c[`${x},62,${z}`] = sand
  }
  return world({ ...c, ...extra })
}
const HOME = { x: 40, y: 70, z: 0 }

test('the switch: on by default; off|0|false|no -> off; the licence row says so; the window palette is glass, trapdoor, wall', () => {
  assert.equal(G.GLASS.on, true)
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.equal(G.glassMode({ GLASS: v }).on, false, v)
  for (const v of [undefined, '', 'on', '1']) assert.equal(G.glassMode({ GLASS: v }).on, true, String(v))
  assert.match(G.glassModeDetail(false), /on=0/); assert.match(G.glassModeDetail(true), /on=1 cap=40 per=12 r=24-96 deep=2\/2 glaze=8/)
  assert.deepEqual(G.windowPalette(), ['glass_pane', '%wood_trapdoor', '$wall'])
  for (const n of ['sand', 'red_sand', 'glass', 'glass_pane', 'oak_trapdoor', 'spruce_trapdoor']) assert.ok(mcData.itemsByName[n], n)
})

test('the window roles and their fallbacks: planks through $wall, a trapdoor through %wood_trapdoor; never glass, never air', () => {
  const house = { wall: ['$planks'], window: ['glass_pane', '$wall'], base: ['stone_bricks'] }
  const cottage = { wall: ['spruce_planks', '$planks'], window: ['glass_pane', '%wood_trapdoor', '$wall'], gablewin: ['glass_pane', '$gable'], gable: ['spruce_planks', '$planks'] }
  assert.deepEqual(G.windowRoles(house), ['window'])
  assert.deepEqual(G.windowRoles(cottage).sort(), ['gablewin', 'window'])
  assert.equal(G.isFallback('oak_planks', house, 'window'), true)
  assert.equal(G.isFallback('spruce_trapdoor', cottage, 'window'), true)
  assert.equal(G.isFallback('oak_trapdoor', house, 'window'), false, 'house@1 names no trapdoor')
  assert.equal(G.isFallback('stone_bricks', house, 'window'), false, 'a base block is no window fallback')
  for (const n of ['glass_pane', 'glass', 'air', '']) assert.equal(G.isFallback(n, cottage, 'window'), false, n)
  assert.equal(G.isFallback('birch_planks', cottage, 'gablewin'), true, '$gable -> $planks: any planks')
})

test('windowsOf: every window cell counted; planks in a COMPLETE building are glaze targets, an open one\'s are not; unknown is never glazed', () => {
  const pal = { wall: ['$planks'], window: ['glass_pane', '$wall'] }
  const rec = cells => ({ cells })
  const read = world({ '1,2,1': { name: 'oak_planks', ...SOLID }, '2,2,1': { name: 'glass_pane', boundingBox: 'block' }, '3,2,1': air, '5,2,1': { name: 'oak_planks', ...SOLID } },
    (x, y, z) => (x === 4 ? null : air))
  const b = [
    { plot: 'house1', palette: pal, complete: true, rec: rec([{ at: [1, 2, 1], role: 'window' }, { at: [2, 2, 1], role: 'window' }, { at: [3, 2, 1], role: 'window' }, { at: [4, 2, 1], role: 'window' }, { at: [9, 9, 9], role: 'wall' }]) },
    { plot: 'house2', palette: pal, complete: false, rec: rec([{ at: [5, 2, 1], role: 'window' }]) },
  ]
  const w = G.windowsOf(b, read)
  assert.equal(w.cells, 5); assert.equal(w.glazed, 1); assert.equal(w.unknown, 1); assert.equal(w.unglazed, 3)
  assert.deepEqual(w.fallback.map(f => f.at), [[1, 2, 1]], 'air is the build\'s own repair; the open building is its builders\'')
})

test('sandWant: the windows the panes cannot cover, in whole 6-sand batches over the reserve, capped; nothing with no unglazed window', () => {
  // the fleet town: 7 planks windows, no panes, no sand -> one batch: 16 + 6 = 22
  assert.deepEqual(G.sandWant({ unglazed: 7, panes: 0, sand: 0, reserveSand: 16 }), { want: 22, target: 22, short: 7, batches: 1 })
  assert.equal(G.sandWant({ unglazed: 7, panes: 7, sand: 0 }).want, 0, 'the panes in town cover them')
  assert.equal(G.sandWant({ unglazed: 7, panes: 0, sand: 22 }).want, 0)
  assert.equal(G.sandWant({ unglazed: 7, panes: 0, sand: 30 }).want, 0, 'more sand than the target is never a negative want')
  assert.equal(G.sandWant({ unglazed: 0, panes: 0, sand: 0 }).want, 0, 'no window, no sand')
  assert.equal(G.sandWant({ unglazed: 74, panes: 0, sand: 0 }).target, 40, 'the cap')
  assert.equal(G.sandWant({ unglazed: 17, panes: 0, sand: 0, reserveSand: 16 }).target, 28, 'two batches')
})

test('glassOrder: glaze first when the town holds panes, then sand for the rest; waits, room and the switch', () => {
  const rd = (over = {}) => ({ unglazed: 7, fallback: 7, mem: {}, ...over })
  const g = G.glassOrder({ now: 1, stock: { glass_pane: 3 }, reading: rd(), freeSlots: 5 })
  assert.equal(g.kind, 'glaze'); assert.equal(g.n, 3); assert.deepEqual(g.order.args, { item: 'glaze' }); assert.equal(g.order.skill, 'make_material')
  const s = G.glassOrder({ now: 1, stock: {}, reading: rd(), freeSlots: 5 })
  assert.equal(s.kind, 'sand'); assert.equal(s.n, 12, 'one order digs at most 12')
  assert.equal(G.glassOrder({ now: 1, stock: { sand: 20 }, reading: rd(), freeSlots: 5 }).n, 2)
  assert.equal(G.glassOrder({ now: 1, stock: {}, reading: rd({ mem: { sandNoneUntil: 5 } }), freeSlots: 5 }).why, 'sand_none_wait')
  assert.equal(G.glassOrder({ now: 1, stock: { glass_pane: 7 }, reading: rd({ mem: { glazeNoneUntil: 5 } }), freeSlots: 5 }).kind, null, 'a glaze wait; the panes cover the windows: no sand either')
  assert.equal(G.glassOrder({ now: 1, stock: {}, reading: rd(), freeSlots: 1 }).why, 'room')
  assert.equal(G.glassOrder({ now: 1, stock: {}, reading: rd({ unglazed: 0, fallback: 0 }), freeSlots: 5 }).why, 'no_windows')
  assert.equal(G.glassOrder({ on: false, now: 1, stock: {}, reading: rd(), freeSlots: 5 }).why, 'off')
  assert.equal(G.glassOrder({ now: 1, stock: {}, reading: null, freeSlots: 5 }).why, 'unreadable')
  assert.equal(G.glassOrder({ now: 1, stock: {}, reading: () => rd(), freeSlots: 5 }).kind, 'sand', 'a lazy reading')
})

test('materialOrder: the glass kinds come after the cheap gates and before the parts; off or unreadable = the base order exactly', () => {
  const FULL = { cobblestone: 900, oak_log: 1400, sand: 0, stone_bricks: 0, glass_pane: 0, cut_copper: 24, copper_door: 3, torch: 64, stone: 0 }
  const base = (over = {}) => ({ now: 50_000_000, on: true, shared: true, atTown: true, holds: false, noteOpen: false, freeSlots: 10, bagSpare: {},
    town: { stock: FULL, coverage: 1 }, furnace: () => true, table: () => true, lease: () => true, bodyMs: 0, state: {}, ...over })
  const rd = () => ({ unglazed: 7, fallback: 7, mem: {} })
  const off = M.materialOrder(base({ glass: false, glassReading: rd }))
  const none = M.materialOrder(base({ glassReading: () => null }))
  assert.equal(off.kind, 'bricks'); assert.equal(none.kind, 'bricks'); assert.deepEqual(none.order, off.order)
  const on = M.materialOrder(base({ glassReading: rd }))
  assert.equal(on.kind, 'sand'); assert.deepEqual(on.order.args, { item: 'sand' })
  assert.equal(M.materialOrder(base({ glassReading: rd, town: { stock: { ...FULL, glass_pane: 4 }, coverage: 1 } })).kind, 'glaze')
  assert.equal(M.materialOrder(base({ glassReading: rd, lease: () => false })).skip, 'lease_busy')
  // the cheap gates still come first: away, the cooldown, the index's coverage
  assert.equal(M.materialOrder(base({ glassReading: rd, atTown: false })).skip, 'away')
  assert.equal(M.materialOrder(base({ glassReading: rd, town: { stock: FULL, coverage: 0.5 } })).skip, 'index_coverage')
  let read = 0
  M.materialOrder(base({ glassReading: () => { read++; return rd() }, atTown: false }))
  assert.equal(read, 0, 'the reading is never taken away from town')
  // a town whose windows are all glass: the parts as before
  assert.equal(M.materialOrder(base({ glassReading: () => ({ unglazed: 0, fallback: 0, mem: {} }) })).kind, 'bricks')
})

test('sandCellOk: a dry beach cell is dug from on top; water beside, deep water near, a cover, no floor, the town and a reserve are not', () => {
  const ok = G.sandCellOk(beach(), [100, 63, 0], { home: HOME })
  assert.deepEqual(ok, { ok: true, why: null })
  // the sea two columns east, ONE deep (the shallows): fine -- not beside the cell, and not deep
  assert.equal(G.sandCellOk(beach({ seaFrom: 102, depth: 1 }), [100, 63, 0], { home: HOME }).ok, true)
  // the sea beside it: the hole would flood
  assert.equal(G.sandCellOk(beach({ seaFrom: 101, depth: 1 }), [100, 63, 0], { home: HOME }).why, 'wet')
  // the sea two columns east and THREE deep: never beside deep water
  assert.equal(G.sandCellOk(beach({ seaFrom: 102, depth: 3 }), [100, 63, 0], { home: HOME }).why, 'deep_water')
  // ...three columns east is past the ring
  assert.equal(G.sandCellOk(beach({ seaFrom: 103, depth: 3 }), [100, 63, 0], { home: HOME }).ok, true)
  assert.equal(G.sandCellOk(beach({ extra: { '100,64,0': sand } }), [100, 63, 0], { home: HOME }).why, 'covered', 'not the top of its column')
  assert.equal(G.sandCellOk(beach({ extra: { '100,64,0': water } }), [100, 63, 0], { home: HOME }).why, 'wet')
  assert.equal(G.sandCellOk(beach({ extra: { '100,62,0': air } }), [100, 63, 0], { home: HOME }).why, 'no_floor', 'a hole two deep')
  assert.equal(G.sandCellOk(beach({ extra: { '100,62,0': water } }), [100, 63, 0], { home: HOME }).why, 'no_floor')
  assert.equal(G.sandCellOk(beach(), [100, 63, 0], { home: { x: 90, y: 70, z: 0 } }).why, 'town')
  assert.equal(G.sandCellOk(beach(), [100, 63, 0], { home: { x: -100, y: 70, z: 0 } }).why, 'far')
  assert.equal(G.sandCellOk(beach(), [100, 63, 0], { home: HOME, reserved: () => true }).why, 'reserved')
  assert.equal(G.sandCellOk(beach(), [100, 64, 0], { home: HOME }).why, 'not_sand')
  assert.equal(G.sandCellOk(world({ '100,63,0': sand }, () => null), [100, 63, 0], { home: HOME }).why, 'unknown', 'an unloaded neighbour is no yes')
  // a sand cell at the bottom of a dry dip: every side two up after the dig -- no way out (Codex r1 BLOCKER)
  const dip = {}
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { dip[`${100 + dx},64,${dz}`] = { name: 'stone', ...SOLID }; dip[`${100 + dx},63,${dz}`] = { name: 'stone', ...SOLID } }
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) dip[`${100 + dx},65,${dz}`] = { name: 'stone', ...SOLID }
  assert.equal(G.sandCellOk(beach({ extra: { ...dip, '100,64,0': air, '100,65,0': air } }), [100, 63, 0], { home: HOME }).why, 'no_exit', 'the bottom of a dry dip: every side two up after the dig')
  const dip2 = {}
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { dip2[`${100 + dx},63,${dz}`] = air; dip2[`${100 + dx},62,${dz}`] = { name: 'stone', ...SOLID } }
  assert.equal(G.sandCellOk(beach({ extra: dip2 }), [100, 63, 0], { home: HOME }).why, 'no_exit', 'a sand pillar: every side is a drop, nothing to step up onto')
  // one side at the cell's level is enough
  assert.equal(G.sandCellOk(beach({ extra: { ...dip2, '101,63,0': sand } }), [100, 63, 0], { home: HOME }).ok, true)
  // waterlogged and kelp read as water
  assert.equal(G.sandCellOk(beach({ extra: { '101,63,0': { name: 'kelp', boundingBox: 'empty' } } }), [100, 63, 0], { home: HOME }).why, 'wet')
})

test('the deep-water rule is load-bearing (mutant: no deep-water check -> the deep sea cell passes)', async () => {
  const anchor = "      if (waterDepth(read, x + dx, y, z + dz, SAND_DEEP + 2) >= SAND_DEEP) return { ok: false, why: 'deep_water' }\n"
  assert.ok(await killed(() => withMutant(GLASS_PATH, anchor, '', async G2 => {
    assert.equal(G2.sandCellOk(beach({ seaFrom: 102, depth: 3 }), [100, 63, 0], { home: HOME }).why, 'deep_water')
  })))
  // and the exit rule (mutant: no exit check -> a cell with no step out passes)
  const exitA = "  if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => solidFloor(read(x + dx, y, z + dz)) && passable(read(x + dx, y + 1, z + dz)) && passable(read(x + dx, y + 2, z + dz)))) return { ok: false, why: 'no_exit' }\n"
  const dip2 = {}
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { dip2[`${100 + dx},63,${dz}`] = air; dip2[`${100 + dx},62,${dz}`] = { name: 'stone', ...SOLID } }
  assert.ok(await killed(() => withMutant(GLASS_PATH, exitA, '', async G2 => {
    assert.equal(G2.sandCellOk(beach({ extra: dip2 }), [100, 63, 0], { home: HOME }).why, 'no_exit')
  })))
  // and the floor rule (mutant: no floor check -> a two-deep hole passes)
  const floor = "  if (!solidFloor(below)) return { ok: false, why: 'no_floor' }\n"
  assert.ok(await killed(() => withMutant(GLASS_PATH, floor, '', async G2 => {
    assert.equal(G2.sandCellOk(beach({ extra: { '100,62,0': air } }), [100, 63, 0], { home: HOME }).why, 'no_floor')
  })))
})

test('sandPlan: eligible cells only, a bad cell skipped, then a walk -- the nearest first, each next the nearest to the last', () => {
  const rd = beach({ seaFrom: 108, depth: 3 })
  const cands = [[100, 63, 0], [101, 63, 0], [95, 63, 0], [100, 63, 5], [107, 63, 0], [100, 62, 0]]
  const p = G.sandPlan(cands, { read: rd, home: HOME, from: [99, 64, 0], bad: new Set(['95,63,0']), max: 3 })
  assert.deepEqual(p.plan.map(q => q.at), [[100, 63, 0], [101, 63, 0], [100, 63, 5]])
  assert.equal(p.eligible, 3)
  assert.deepEqual(p.refused, { bad: 1, wet: 1, covered: 1 })
  assert.equal(G.sandPlan(cands, { read: rd, home: HOME, max: 12 }).plan.length, 4, 'the bad cell is this bot\'s only')
})

test('paneRefs: the course under the window first (top face), then the wall either side, then above; never a liquid or leaves', () => {
  const rd = world({ '0,1,0': { name: 'stone_bricks', ...SOLID }, '1,2,0': { name: 'oak_planks', ...SOLID }, '-1,2,0': { name: 'oak_leaves', ...SOLID }, '0,3,0': { name: 'oak_planks', ...SOLID } }, () => air)
  assert.deepEqual(G.paneRefs(rd, [0, 2, 0]), [{ ref: [0, 1, 0], face: [0, 1, 0] }, { ref: [1, 2, 0], face: [-1, 0, 0] }, { ref: [0, 3, 0], face: [0, -1, 0] }])
  assert.deepEqual(G.paneRefs(world({}, () => air), [0, 2, 0]), [])
})

test('glazePlan: nearest first, at most the order\'s, never a bad cell; the memory remembers and forgets', () => {
  const fb = [{ at: [10, 2, 0] }, { at: [1, 2, 0] }, { at: [5, 2, 0] }]
  assert.deepEqual(G.glazePlan(fb, { from: [0, 2, 0], max: 2 }).map(f => f.at), [[1, 2, 0], [5, 2, 0]])
  assert.deepEqual(G.glazePlan(fb, { from: [0, 2, 0], bad: new Set(['1,2,0']) }).map(f => f.at), [[5, 2, 0], [10, 2, 0]])
  G._resetGlassMem()
  G.glassMemNote({ badCell: '1,2,3', sandNone: true, now: 1000 })
  assert.ok(G.glassMem(1001).bad.has('1,2,3')); assert.equal(G.glassMem(1001).sandNoneUntil, 1000 + G.SAND_NONE_MS)
  assert.equal(G.glassMem(1000 + G.SAND_BAD_MS).bad.has('1,2,3'), false, 'forgotten after its time')
  G._resetGlassMem()
})

test('glaze before sand is load-bearing (mutant: no glaze branch -> a town with panes digs sand it does not need)', async () => {
  const anchor = "  if ((r.fallback ?? 0) > 0 && panes > 0 && now >= (mem.glazeNoneUntil ?? 0) && freeSlots >= 2) {"
  assert.ok(await killed(() => withMutant(GLASS_PATH, anchor, '  if (false) {', async G2 => {
    assert.equal(G2.glassOrder({ now: 1, stock: { glass_pane: 3 }, reading: { unglazed: 7, fallback: 7, mem: {} }, freeSlots: 5 }).kind, 'glaze')
  })))
  // and the cap (mutant: no cap -> 74 windows want 46 sand)
  const cap = '  const target = Math.min(cap, Math.max(0, Number(reserveSand) || 0) + SAND_PER_BATCH * batches)'
  assert.ok(await killed(() => withMutant(GLASS_PATH, cap, '  const target = Math.max(0, Number(reserveSand) || 0) + SAND_PER_BATCH * batches', async G2 => {
    assert.equal(G2.sandWant({ unglazed: 74, panes: 0, sand: 0 }).target, 40)
  })))
})

test('the materials job\'s glass gate is load-bearing (mutant: the gate off -> no sand order for a town that wants windows)', async () => {
  const anchor = '  if (glass) {\n    const g = glassOrder('
  const FULL = { cobblestone: 900, oak_log: 1400, sand: 0, stone_bricks: 0, glass_pane: 0 }
  const args = { now: 50_000_000, on: true, shared: true, atTown: true, freeSlots: 10, town: { stock: FULL, coverage: 1 }, glassReading: () => ({ unglazed: 7, fallback: 7, mem: {} }) }
  assert.equal(M.materialOrder(args).kind, 'sand')
  assert.ok(await killed(() => withMutant(MATS_PATH, anchor, '  if (false) {\n    const g = glassOrder(', async M2 => {
    assert.equal(M2.materialOrder(args).kind, 'sand')
  })))
})

// STRUCTURAL (behaviour cannot reach the spawn and the skill's routing without a server; Paper e2e proves them): the skill routes the
// two kinds to their walks under the switch, and the spawn installs the reading. Comments stripped; anchored on executable lines.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
test('the wiring: make_material routes sand and glaze to their walks under GLASS; the spawn installs the reading and the licence row', () => {
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.equal(sk.split("  if (kind === 'sand' && GLASS.on) return glassSand(ctx, signal)\n").length, 2)
  assert.equal(sk.split("  if (kind === 'glaze' && GLASS.on) return glassGlaze(ctx, signal)\n").length, 2)
  const fe = strip(readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8'))
  assert.equal(fe.split("setGlassReading(GLASS.on ? () => glassReading(bot) : null)").length, 2)
  assert.equal(fe.split("kind: 'glass_mode'").length, 2)
})

test('glass-01 fold (Codex BLOCKER): the sand dig never takes a bridge bank -- inside any bridge site footprint is reserved; the wiring', () => {
  const zones = [{ box: [10, -64, 20, 14, 320, 26], why: 'expedition:bridge' }]
  assert.equal(G.inBridgeZone(zones, 12, 22), true)
  assert.equal(G.inBridgeZone(zones, 10, 26), true, 'the box edges are inside')
  assert.equal(G.inBridgeZone(zones, 14, 20), true, 'the far edges too')
  assert.equal(G.inBridgeZone(zones, 15, 22), false, 'positive control: one past the box is free')
  assert.equal(G.inBridgeZone([], 12, 22), false)
  assert.equal(G.inBridgeZone(null, 12, 22), false)
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const at = src.indexOf('function glassReserved (bot) {')
  assert.ok(at > 0)
  const body = src.slice(at, src.indexOf('\n}\n', at))
  assert.match(body, /try \{ const bs = exBridgeSitesStrict\(\); bz = bs == null \? null : bridgeZones\(bs, 2\) \} catch \{ bz = null \}/, 'the footprints read once a plan, strictly')
  const st = src.slice(src.indexOf('function exBridgeSitesStrict () {'))
  assert.match(st.slice(0, 400), /return e\?\.code === 'ENOENT' \? \[\] : null/, 'no file: no bridges; an unreadable file: null (nothing dug)')
  assert.match(body, /if \(bz == null \|\| inBridgeZone\(bz, x, z\)\) return true/, 'unreadable or inside: reserved')
})
