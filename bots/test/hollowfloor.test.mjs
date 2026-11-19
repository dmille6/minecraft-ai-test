// T11REACH2-01show (rig runs 19 and 21, 11-19): the T11 plateau was one cell, -33,68,-12 -- a hollow's core fill (it names its crust
// cut, `opener`) over a cave the survey never planned: grass at 69, air at 66-68, stone at 65 (the scene below, read from sandbox2's
// rig world over RCON, read-only). The visit could not lay it (no block below or beside: buildsite.mjs stepRefusal `no_support`) and
// no waiver could take it (tidy.mjs gkWaivable, gkwork.mjs stallWaive keep every opener cell): 85 + 34 + 3 deferred rows and every
// visit of Echo's ended stuck_on_cell. fillcolumn.mjs hollowFloor: (a) a floor at most 4 down -- the cells between are added as core;
// (b) deeper -- the column is a deep hollow, left to the waivers. The REFUSAL CHAIN is tested, not one guard: the visit's own order
// rules (planOrder), the stand search's support test (stepRefusal) and the waivers, before and after the repair, on the real scene.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
const { withMutant } = await import('./helpers/mutant.mjs')
const FC = await import('../src/fillcolumn.mjs')
const TD = await import('../src/tidy.mjs')
const GKW = await import('../src/gkwork.mjs')
const BS = await import('../src/buildsite.mjs')
const P = n => new URL(`../src/${n}`, import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; if (process.env.TEST_VERBOSE) console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e.stack ?? e).split('\n').slice(0, 3).join('\n        ')}`) }
}
const kills = (name, file, old, neu, scen) => t(`MUTANT KILLED: ${name}`, async () => {
  await withMutant(P(file), old, neu, async M => {
    let died = null
    try { await scen(M) } catch (e) { died = e }
    assert.ok(died, 'the mutant survived its scenario')
    assert.ok(died instanceof assert.AssertionError, `the mutant died of something else: ${died?.stack ?? died}`)
  })
})

const SOLID = new Set(['stone', 'dirt', 'grass_block', 'cobblestone', 'stone_bricks', 'dirt_path', 'andesite', 'diorite', 'granite', 'gravel', 'coarse_dirt'])
const blk = name => (name == null || name === '?') ? null : { name, boundingBox: SOLID.has(name) ? 'block' : 'empty' }
const scene = JSON.parse(readFileSync(new URL('./fixtures/hollow-t11-33_68_-12.json', import.meta.url), 'utf8')).cells
// the world as the visit would leave it: `placed` cells read as dirt
const readOf = (cells, placed = new Set()) => (x, y, z) => { const k = `${x},${y},${z}`; return placed.has(k) ? blk('dirt') : blk(cells[k] ?? null) }
const OPENER = [-33, 70, -12]
// the record's own two cells in that column (the rig record g209, T-142) and one ordinary fill elsewhere
const recOf = () => ({ blueprint: 'tidy@1', home: { x: 0, y: 70, z: 0 }, cells: [
  { at: [-33, 68, -12], role: 'core', seg: 'T-142-0', opener: OPENER },
  { at: [-33, 69, -12], role: 'earth', seg: 'T-142-1', opener: OPENER }], cut: [], clear: [], waived: {}, segments: [{ seg: 'T-142-0', deps: [] }, { seg: 'T-142-1', deps: ['T-142-0'] }] })
// the crust (the earth cell at 69) is grass already: done; everything else is open while air
const doneOf = read => c => { const b = read(...c.at); return !!b && b.boundingBox === 'block' }

// THE VISIT'S CHAIN, independently: lay every open cell the two rules allow (a support below or beside; never over an open cell of its
// column), each against the stand search's own support test -- stepRefusal must not answer `no_support` for any cell laid
function layAll (rec, cells) {
  const placed = new Set(), order = []
  for (let guard = 0; guard < 50; guard++) {
    const read = readOf(cells, placed)
    const open = rec.cells.filter(c => !doneOf(read)(c) && !placed.has(c.at.join(',')))
    const ready = open.filter(c => { const [x, y, z] = c.at; return !open.some(o => o.at[0] === x && o.at[2] === z && o.at[1] < y) })
      .filter(c => { const r = BS.stepRefusal(read, { x: 0, y: 70, z: 0 }, c.at, new Map(), () => true); return !r || r.class !== 'no_support' })
    if (!ready.length) return { order, left: open.map(c => c.at.join(',')) }
    for (const c of ready) { placed.add(c.at.join(',')); order.push(c.at.join(',')) }
  }
  return { order, left: ['loop'] }
}

const scenA = M => {
  const rec = recOf(), read = readOf(scene)
  // before: the cell is no_support, no order reaches it, and no waiver may take it -- the dead end
  assert.strictEqual(BS.stepRefusal(read, { x: 0, y: 70, z: 0 }, [-33, 68, -12], new Map(), () => true)?.class, 'no_support')
  assert.deepStrictEqual(layAll(rec, scene).left, ['-33,68,-12'], 'before: the core is the one cell nothing lays')
  assert.deepStrictEqual(TD.gkWaivable(rec, [{ k: '-33,68,-12' }]), [], 'before: an opener cell is never waivable')
  // the repair
  const r = M.hollowFloor(rec, read, { done: doneOf(read), now: 1 })
  assert.ok(r.rec, 'the repair changed the record')
  assert.deepStrictEqual(r.added.map(c => c.at.join(',')), ['-33,66,-12', '-33,67,-12'], 'the two air cells down to the stone at 65 are added')
  assert.ok(r.added.every(c => c.role === 'core' && c.seg === 'T-142-0' && c.opener === OPENER && c.ext), 'core (buried: cobble allowed), its own segment, its opener')
  assert.deepStrictEqual(r.hollow, [{ kind: 'under', cell: [-33, 68, -12], n: 2 }])
  // after: the whole column is laid bottom-up, every cell against a support the stand search accepts
  const L = layAll(r.rec, scene)
  assert.deepStrictEqual(L.left, [], 'after: nothing is left unlaid')
  assert.deepStrictEqual(L.order, ['-33,66,-12', '-33,67,-12', '-33,68,-12'])
  assert.ok(M.planOrder(r.rec.cells.filter(c => !doneOf(read)(c)), read).ok, 'the visit\'s own order check agrees')
  // and a second refresh adds nothing (the column now has an order)
  assert.strictEqual(M.hollowFloor(r.rec, read, { done: doneOf(read), now: 2 }).rec, null)
}
await t('(a) -33,68,-12 on the real scene: the cave under the core is filled from the stone up, and the core is laid', () => scenA(FC))
await t('(a) closed repair (the keep-out unread): nothing is added', () => {
  const read = readOf(scene)
  assert.strictEqual(FC.hollowFloor(recOf(), read, { done: doneOf(read), closed: 'excl_unread:zones' }).rec, null)
})
await t('(a) the refresh step runs it after columnRepair and names it for the row', () => {
  const read = readOf(scene), rec = recOf()
  const { res, fx } = FC.refreshRepair({ rec }, rec, read, { done: doneOf(read), now: 1 }, {})
  assert.deepStrictEqual(res.rec.cells.filter(c => c.ext).map(c => c.at.join(',')), ['-33,66,-12', '-33,67,-12'])
  assert.deepStrictEqual(fx.hollow.map(h => h.kind), ['under'])
  assert.strictEqual(FC.refreshRepair({ rec }, rec, read, { done: doneOf(read) }, { FILLCOLUMN: 'off' }).fx, null, 'FILLCOLUMN=off is the rollback')
})

// (b): the same column with the stone floor taken away down to 6 air under the core
const deepScene = () => { const c = { ...scene }; for (let y = 60; y <= 67; y++) c[`-33,${y},-12`] = y <= 61 ? 'stone' : 'air'; return c }
const scenB = ({ fc = FC, td = TD, gkw = GKW } = {}) => {
  const cells = deepScene(), rec = recOf(), read = readOf(cells)
  const r = fc.hollowFloor(rec, read, { done: doneOf(read), now: 5 })
  assert.ok(r.rec, 'the record is marked')
  assert.deepStrictEqual(r.added, [], 'nothing added: the cave is deeper than 4')
  assert.deepStrictEqual(r.hollow, [{ kind: 'deep', cell: [-33, 68, -12], n: 5 }], 'a row names the deep hollow')
  assert.ok(r.rec.cells.filter(c => c.opener).every(c => c.hollowDeep === 5), 'the column\'s opener cells are a deep hollow')
  // the crust is left alone: nothing cut, nothing added over it
  assert.deepStrictEqual(r.rec.cut, [])
  // ...and a crust cut still pending leaves the record with the column (Codex r1): it can never be dug after its fills are waived
  const pend = recOf(); pend.cut = [{ at: OPENER, kind: 'tidy', name: 'grass_block' }, { at: [5, 70, 5], kind: 'tidy', name: 'stone' }]
  const rp = fc.hollowFloor(pend, read, { done: doneOf(read), now: 6 })
  assert.deepStrictEqual(rp.rec.cut.map(q => q.at.join(',')), ['5,70,5'], 'the opener cut retired, the other kept')
  // the refusal chain: still nothing lays it, and now the waivers may take it
  assert.deepStrictEqual(layAll(r.rec, cells).left, ['-33,68,-12'])
  assert.deepStrictEqual(td.gkWaivable(r.rec, [{ k: '-33,68,-12' }]).map(d => d.k), ['-33,68,-12'], 'the keeper\'s waiver may take it')
  assert.deepStrictEqual(gkw.stallWaive(r.rec, [{ k: '-33,68,-12', visits: 99 }], { stalled: true }).map(d => d.k), ['-33,68,-12'], 'the stall waiver may take it')
  // and the unmarked record is still kept by both
  assert.deepStrictEqual(TD.gkWaivable(rec, [{ k: '-33,68,-12' }]), [])
  assert.deepStrictEqual(GKW.stallWaive(rec, [{ k: '-33,68,-12', visits: 99 }], { stalled: true }), [])
}
await t('(b) a 6-deep cave: a deep hollow, deferred, crust left alone, waivable', () => scenB())
await t('the bounds: exactly 4 of air is (a); water, a record cell or an unread cell below leaves the column as it is', () => {
  const four = { ...scene }; for (let y = 63; y <= 67; y++) four[`-33,${y},-12`] = y === 63 ? 'stone' : 'air'
  const r4 = FC.hollowFloor(recOf(), readOf(four), { done: doneOf(readOf(four)) })
  assert.strictEqual(r4.added.length, 4)
  const wet = { ...scene, '-33,66,-12': 'water' }
  assert.strictEqual(FC.hollowFloor(recOf(), readOf(wet), { done: doneOf(readOf(wet)) }).rec, null)
  const unread = { ...scene }; delete unread['-33,66,-12']
  const ru = { ...scene, '-33,66,-12': '?' }
  assert.strictEqual(FC.hollowFloor(recOf(), readOf(ru), { done: doneOf(readOf(ru)) }).rec, null)
  const rec = recOf(); rec.cells.push({ at: [-33, 66, -12], role: 'earth', seg: 'X-0' })
  assert.strictEqual(FC.hollowFloor(rec, readOf(scene), { done: doneOf(readOf(scene)) }).rec, null)
})

// THE COMPOSED CASE (rig run 24): the column is house1's (the survey's keepOff: `project:house1`) -- nothing may be added there, and the
// opener cell must not stay a never-waivable dead end. The chain: refresh -> the cell waived `fillcolumn:keepoff:project:house1` -> the
// visit's open list (openFills) and the executable-order check no longer hold it -> the stuck map has nothing left in that column
const scenK = M => {
  const read = readOf(scene), rec = recOf()
  rec.cut = [{ at: OPENER, kind: 'tidy', name: 'grass_block' }]   // (the crust cut still pending: it must leave with the cell)
  const keepOff = (x, z) => (x === -33 && z === -12 ? 'project:house1' : null)
  const { res, fx } = M.refreshRepair({ rec }, rec, read, { done: doneOf(read), keepOff, now: 9 }, {})
  assert.deepStrictEqual(fx.added.filter(c => c.at[0] === -33), [], 'nothing added in another project\'s columns')
  assert.deepStrictEqual(res.rec.waived['-33,68,-12']?.why, 'fillcolumn:keepoff:project:house1', 'the cell leaves the work list, named')
  assert.ok(fx.dropped.some(d => d.k === '-33,68,-12'), 'a waived row for it')
  assert.deepStrictEqual(fx.hollow.filter(h => h.kind === 'keepoff').map(h => h.cell), [[-33, 68, -12]])
  assert.deepStrictEqual(res.rec.cut, [], 'its crust cut retired with it')
  assert.deepStrictEqual(M.openFills(res.rec, { done: doneOf(read) }), [], 'the visit has nothing open there: not stuck forever')
  assert.ok(M.floatCells(res.rec, read, { done: doneOf(read) }).stuck.length === 0)
  // ...and a later refresh does not bring it back, nor touch it again
  const again = M.refreshRepair({ rec: res.rec }, res.rec, read, { done: doneOf(read), keepOff, now: 10 }, {})
  assert.strictEqual(again.res.rec.waived['-33,68,-12'].at, 9)
  // even once the ground has come back round it (a block under it and one beside it): still another project's ground
  const back = readOf({ ...scene, '-33,67,-12': 'stone', '-34,68,-12': 'stone' })
  const later = M.refreshRepair({ rec: res.rec }, res.rec, back, { done: doneOf(back), keepOff, now: 11 }, {})
  assert.strictEqual(later.res.rec.waived['-33,68,-12']?.why, 'fillcolumn:keepoff:project:house1', 'it never comes back')
  // without the keep-off the same column is filled from below instead (a)
  assert.strictEqual(M.refreshRepair({ rec: recOf() }, recOf(), read, { done: doneOf(read), now: 9 }, {}).fx.added.length, 2)
}
await t('(keepOff) -33,68,-12 in house1\'s columns: waived as another project\'s ground, its cut retired, nothing stuck', () => scenK(FC))
await kills('(keepOff) the cell skipped as before (the dead end)', 'fillcolumn.mjs', "    if (ko) { off[kOf(L.at)] = { why: `fillcolumn:keepoff:${String(ko).slice(0, 40)}`, at: now, by: 'fillcolumn' }; continue }", '    if (ko) continue', scenK)
await kills('(keepOff) the waiver comes back at the next refresh', 'fillcolumn.mjs', '(?!guarded$|excluded$|keepoff:)', '(?!guarded$|excluded$)', scenK)
await kills('(a) the floor\'s cells never added', 'fillcolumn.mjs', '    if (floor && gap.length && gap.length <= T.hollowMax) {', '    if (false) {', scenA)
await kills('(b) the deep mark never set', 'fillcolumn.mjs', '      deepCols.add(k)\n', '\n', M => scenB({ fc: M }))
await kills('(b) the opener cut kept', 'fillcolumn.mjs', '  const cut = retire.size ? (rec.cut ?? []).filter(q => !(Array.isArray(q?.at) && retire.has(kOf(q.at)))) : rec.cut\n', '  const cut = rec.cut\n', M => scenB({ fc: M }))
await kills('(b) gkWaivable keeps every opener cell again', 'tidy.mjs', '(!c.opener || c.hollowDeep) && !c.prev', '!c.opener && !c.prev', M => scenB({ td: M }))
await kills('(b) stallWaive keeps every opener cell again', 'gkwork.mjs', "c.role !== 'light' && (!c.opener || c.hollowDeep)", "c.role !== 'light' && !c.opener", M => scenB({ gkw: M }))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
