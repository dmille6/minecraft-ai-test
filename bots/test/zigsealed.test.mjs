// ZIGSEALED-01 (LIVE showcase 10-31 16:58Z to 11-01 01:40Z+, 8 h+): THE ZIGGURAT'S LAST FOUR CELLS. The record read 4885/4889; the
// four open cells are one column of the west skin (test/fixtures/zigsealed-showcase-1101.json, read from the world's region file):
//   -55,67,-35 F-W   grass_block   (foreign: the visit's foreign pass digs it first)
//   -55,68,-35 F-W   air           (open, over it)
//   -55,69,-35 L00-W dirt          (open: skin is cobblestone; L00-W waits on F-W)
//   -55,70,-35 L01-W dirt          (open; L01-W waits on L00-*)
// The grass's five other faces are cobblestone or dirt; its top opens only into the air cell, capped by the two dirt cells: no
// stand sees it. Every visit by every bot: `clear_failed ... result=no_stand` twice, then `outcome=blocked ... F-W: 2 open, 0
// placeable now`. wallstuck-01's sealed-column dig was the wall's only (`p.sealed`), and its column stopped at the first cell that
// was not THIS segment's open foreign block -- here the air cell, then two cells of segments that wait on F-W.
// The fix (buildrun.mjs sealedAbove `isOpenAbove`, runVisit's sealed branch; skills.mjs zigSealedOf on the monument visit): the open
// record cells above that this segment or a segment waiting on it owns are part of the column (air passed through, scaffold-class
// dug); those segments cannot be leased while this one is open (fell-01 r4's reasoning). Pure on the live geometry, chained on the
// fake server, each part killed by a mutant whose anchor is asserted present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const { R, PJ, G, HOME, server, bot, withMutant } = await import('./helpers/buildfake.mjs')
const B = await import('../src/buildsite.mjs')
const Z = await import('../src/ziggurat.mjs')
const mc = createRequire(import.meta.url)('minecraft-data')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const k = a => a.join(',')
const killedBy = async (old, neu, scenario) => {
  await scenario(R)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}

// ---- the live geometry -------------------------------------------------------------------------------------------------------
const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/zigsealed-showcase-1101.json', import.meta.url), 'utf8'))
const box = n => mc.blocksByName[n]?.boundingBox ?? 'block'
const over = new Map()
const live = (x, y, z) => { const key = `${x},${y},${z}`; const n = over.get(key) ?? FX.world[key]; return !n || n === '?' ? null : { name: n, boundingBox: box(n) } }
const rec = { cells: FX.cells, segments: FX.segments }
const isDone = c => { const b = live(...c.at); return !!b && (R.cellDone(b, Z.ZIG_PALETTE, c.role) || Z.zigHidden(c, live)) }
const cellKeys = new Set(FX.cells.map(c => k(c.at)))
const GRASS = [-55, 67, -35]
const aboveOf = (at, seg, deps = true) => new Set(FX.cells.filter(q => q.at[0] === at[0] && q.at[2] === at[2] && q.at[1] > at[1] && (q.seg === seg || (deps && R.dependsOn(rec, q.seg, seg))) && !isDone(q)).map(q => k(q.at)))
// the walk from the ground west of the base (the region the builders came from; the fixture is a box, not the town)
const GROUND = { x: -57, y: 66, z: -35 }
const nodes = () => { const m = new Map(); for (const key of B.walkFrom(live, GROUND, new Set(), 7)) { const [x, y, z] = key.split(',').map(Number); const c = `${x},${z}`; (m.get(c) ?? m.set(c, []).get(c)).push(y) } return m }

console.log('THE LIVE COLUMN (pure, on the fixture)')
await t('the four open cells are the ones the record reads open (4885/4889), one column; the grass has no dig stand', () => {
  over.clear()
  assert.deepStrictEqual(FX.cells.filter(c => !isDone(c)).map(c => `${k(c.at)}:${c.seg}:${live(...c.at).name}`),
    ['-55,67,-35:F-W:grass_block', '-55,68,-35:F-W:air', '-55,69,-35:L00-W:dirt', '-55,70,-35:L01-W:dirt'])
  assert.strictEqual(R.digStand(live, GRASS, nodes()), null, 'the live failure: no_stand')
  // positive control: the same walk finds a stand for the cap's top cell
  assert.ok(R.digStand(live, [-55, 70, -35], nodes()), 'the walk reaches the column')
})
await t('CONTROL: without isOpenAbove (the live code) the column is the grass alone -- nothing to open, the cell sealed', () => {
  over.clear()
  const sa = R.sealedAbove(live, GRASS, { isOpenForeign: () => false, isCell: q => cellKeys.has(k(q)), scaffold: Z.ZIG_FOREIGN })
  assert.deepStrictEqual(sa.digs.map(d => k(d.at)), [k(GRASS)])
})
await t('with isOpenAbove the column is dug from its top (the two dirt cells, then the grass); then a stand sees the grass and every cell has a placement step', () => {
  over.clear()
  const above = aboveOf(GRASS, 'F-W')
  assert.deepStrictEqual([...above].sort(), ['-55,68,-35', '-55,69,-35', '-55,70,-35'])
  const sa = R.sealedAbove(live, GRASS, { isOpenForeign: () => false, isOpenAbove: q => above.has(k(q)), isCell: q => cellKeys.has(k(q)), scaffold: Z.ZIG_FOREIGN })
  assert.ok(sa.ok, sa.why)
  assert.deepStrictEqual(sa.digs.map(d => `${k(d.at)}:${d.name}`), ['-55,70,-35:dirt', '-55,69,-35:dirt', '-55,67,-35:grass_block'])
  for (const d of sa.digs.slice(0, -1)) { assert.ok(R.digStand(live, d.at, nodes()), `a stand for ${k(d.at)}`); over.set(k(d.at), 'air') }
  assert.deepStrictEqual(R.digStand(live, GRASS, nodes()), [-56, 69, -35], 'the column open: the grass is seen from the west')
  over.set(k(GRASS), 'air')
  for (const y of [67, 68, 69, 70]) {
    const at = [-55, y, -35]
    assert.ok(B.stepFor(live, GROUND, at, nodes(), () => true), `a placement step for ${k(at)}`)
    over.set(k(at), 'cobblestone')
  }
  over.clear()
})
await t('only segments that WAIT on this one: a segment with no such dependency is never dug through (the chain ends, the cap refuses)', () => {
  over.clear()
  const own = aboveOf(GRASS, 'F-W', false)
  assert.deepStrictEqual([...own], ['-55,68,-35'], 'F-W alone owns only the air cell')
  const sa = R.sealedAbove(live, GRASS, { isOpenAbove: q => own.has(k(q)), isCell: q => cellKeys.has(k(q)), scaffold: Z.ZIG_FOREIGN })
  assert.strictEqual(sa.ok, false)
  assert.match(sa.why, /^record_cell -55,69,-35/)
})

// ---- refusals (pure, a synthetic column) -------------------------------------------------------------------------------------
await t('sealedAbove with isOpenAbove refuses: an unread open cell (soft), a vetoed open cell (hard); a non-scaffold block ends the chain', () => {
  const col = names => (x, y, z) => { if (x || z) return { name: 'cobblestone', boundingBox: 'block' }; const n = names[y - 1]; return n === null ? null : { name: n ?? 'air', boundingBox: box(n ?? 'air') } }
  const at = [0, 1, 0], openAbove = q => q[1] <= 3
  assert.deepStrictEqual(R.sealedAbove(col(['grass_block', null]), at, { isOpenAbove: openAbove, scaffold: Z.ZIG_FOREIGN }), { ok: false, digs: [], why: 'unknown 0,2,0', hard: false })
  const v = R.sealedAbove(col(['grass_block', 'air', 'dirt']), at, { isOpenAbove: openAbove, mayDig: q => q[1] !== 3, scaffold: Z.ZIG_FOREIGN })
  assert.deepStrictEqual([v.ok, v.why, v.hard], [false, 'vetoed 0,3,0', true])
  const kept = R.sealedAbove(col(['grass_block', 'air', 'chest']), at, { isOpenAbove: openAbove, isCell: q => q[1] <= 3, scaffold: Z.ZIG_FOREIGN })
  assert.deepStrictEqual([kept.ok, kept.why], [false, 'record_cell 0,3,0'])
  const ok = R.sealedAbove(col(['grass_block', 'air', 'dirt']), at, { isOpenAbove: openAbove, isCell: q => q[1] <= 3, scaffold: Z.ZIG_FOREIGN })
  assert.deepStrictEqual(ok.digs.map(d => k(d.at)), ['0,3,0', '0,1,0'])
})

// ---- the chain on the fake server --------------------------------------------------------------------------------------------
// The live shape: skin columns at G+1..G+3 (segments A: G+1, G+2; B, waiting on A: G+3), the middle one (11,·,10) holding grass
// (G+1, A), air (G+2, A) and dirt (G+3, B); west of it, as at -56,67..68,-35 live, two blocks that are no record cell's (10,G+1..
// G+2,10) with a stand on them, reached by a step from the ground (9,G+1,10)
const zigRec = cells => ({ v: 1, plot: 'monument', blueprint: 'ziggurat@1', cells, clear: [], replant: [], segments: [{ seg: 'A', deps: [] }, { seg: 'B', deps: ['A'] }] })
function scene () {
  const cells = [], srv = server()
  for (let x = 10; x <= 12; x++) for (let z = 9; z <= 11; z++) for (const y of [G + 1, G + 2, G + 3]) {
    if (x === 10 && z === 10) { if (y < G + 3) srv.set([x, y, z], 'dirt'); continue }
    cells.push({ at: [x, y, z], role: 'skin', seg: y === G + 3 ? 'B' : 'A' })
    const mid = x === 11 && z === 10
    srv.set([x, y, z], mid ? (y === G + 1 ? 'grass_block' : y === G + 2 ? 'air' : 'dirt') : 'cobblestone')
  }
  srv.set([9, G + 1, 10], 'cobblestone')
  return { srv, rec: zigRec(cells) }
}
function project (record) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/zigsealed-`)
  const key = PJ.projKey(HOME, 'monument')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slots = {}
  const p = (n, extra = {}) => {
    slots[n] ??= PJ.takeSlot(dir, key, n, 2)
    return { dir, key, me: n, home: HOME, stood: [], record, recordGen: pub.gen, palette: Z.ZIG_PALETTE, slot: slots[n].slot, slotGen: slots[n].gen,
      domain: () => true, walkR: 40, foreign: Z.ZIG_FOREIGN, blockLayer: false, stands: { pending: null, bans: {} }, ...extra }
  }
  return { dir, key, p }
}
const done = (srv, rec) => rec.cells.every(c => R.cellDone(srv.read(...c.at), Z.ZIG_PALETTE, c.role))
const chain = async (M, extra) => {
  const { srv, rec } = scene(), pr = project(rec), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
  const stops = []
  for (let v = 0; v < 3 && !done(srv, rec); v++) stops.push((await M.runVisit(pr.p('A', extra), e, { maxSteps: 400 })).stop)
  return { srv, rec, e, stops }
}
const SEALED = { sealed: { mayDig: () => true } }
console.log('THE CHAIN (runVisit on the fake server)')
await t('CONTROL (no p.sealed: the live monument visit): `clear_failed no_stand`, the visit stops `blocked`, every visit', async () => {
  const { srv, rec, e, stops } = await chain(R, {})
  assert.ok(!done(srv, rec))
  assert.deepStrictEqual(stops, ['blocked', 'blocked', 'blocked'])
  assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'clear_failed' && d.result === 'no_stand' && k(d.cell) === k([11, G + 1, 10])))
})
await t('with p.sealed the dependent segment\'s dirt, then the grass are dug and EVERY cell is built -- killed with isOpenAbove cut', async () => {
  const scenario = async M => {
    const { srv, rec, e, stops } = await chain(M, SEALED)
    assert.ok(done(srv, rec), `built (${stops})`)
    const digs = e.logs.filter(([kk, d]) => kk === '_build' && d.op === 'clear').map(([, d]) => k(d.cell))
    assert.deepStrictEqual(digs, [k([11, G + 3, 10]), k([11, G + 1, 10])])
  }
  await killedBy('    if (!isOpenAbove(q)) break\n', '    break\n', scenario)
})
await t('the dependent segments are what open the column -- killed with the column limited to this segment\'s own cells', async () => {
  await killedBy('(q.seg === seg || dependsOn(record, q.seg, seg))', '(q.seg === seg)', async M => {
    const { srv, rec } = await chain(M, SEALED)
    assert.ok(done(srv, rec), 'built')
  })
})
await t('a DONE cell over the column is never dug: the cell is sealed and deferred (never `blocked`)', async () => {
  const { srv, rec } = scene(), pr = project(rec), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
  srv.set([11, G + 3, 10], 'cobblestone')
  const r = await R.runVisit(pr.p('A', SEALED), e, { maxSteps: 400 })
  assert.strictEqual(srv.read(11, G + 3, 10).name, 'cobblestone', 'the done cell stands')
  assert.notStrictEqual(r.stop, 'blocked')
  assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'clear_failed' && d.result === 'sealed' && /^record_cell/.test(d.why)), JSON.stringify(e.logs.filter(([kk]) => kk === '_build').map(([, d]) => d).slice(-4)))
})

// ---- the monument visit's wiring ---------------------------------------------------------------------------------------------
const S = await import('../src/skills.mjs')
console.log('THE MONUMENT VISIT')
await t('zigSealedOf: on by default; ZIGSEALED=off is the rollback; mayDig vetoes a protected zone and another project\'s cell', () => {
  const others = () => new Set(['1,2,3'])
  const z = S.zigSealedOf({ zones: [{ box: [10, 60, 10, 20, 80, 20] }] }, others, {})
  assert.strictEqual(z.mayDig([0, 70, 0]), true)
  assert.strictEqual(z.mayDig([15, 70, 15]), false, 'a protected zone')
  assert.strictEqual(z.mayDig([1, 2, 3]), false, 'another project\'s record cell')
  assert.strictEqual(S.zigSealedOf({}, others, { ZIGSEALED: 'off' }), null)
  assert.strictEqual(S.zigSealedOf({}, () => { throw new Error('unread') }, {}).mayDig([0, 0, 0]), false, 'unreadable: refuse')
})
await t('buildMonument passes zigSealedOf to its visit (source, comments stripped)', () => {
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const m = src.match(/access: zigAccessOf\(bot, c\), sealed: zigSealedOf\(c, zigOtherCells\(\)\) \}, effects/g)
  assert.strictEqual(m?.length, 1)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
