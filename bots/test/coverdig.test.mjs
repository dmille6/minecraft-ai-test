// COVERDIG-01 (LIVE showcase 11-05 05:03Z to 17:14Z+, 12 h+): THE COPPER HALL'S PAD BASE -7,66,33. The record (hall@1, 283 cells
// open) waited on one cell: `stuck_on_cell cell=-7,66,33 visits=22 ... waiting=283 stalled=true`. The cell is AIR; its five other
// faces are stone bricks (-8,66,33, a done pad cell), grass and coal ore -- and a grass_block stands in the RING cell above it,
// -7,67,33, set there after siting (test/fixtures/coverdig-hall-1105.json, read from a copy of the world's region files). The
// base's only sight line ran through that ring cell, so no stand reached it; the ring waits on the pad, so the ring's own foreign
// pass could never dig the grass: pad waits on ring, ring waits on pad.
// The fix (buildrun.mjs coverAbove, runVisit's no-stand branch): a placeable cell no stand reaches whose cover is a scaffold-class
// block in an OPEN record cell above it -- this segment's or one that waits on it -- has that cover dug under this segment's lease,
// then the segment is read again. Pure on the live geometry, chained on the fake server, each part killed by a mutant whose anchor
// is asserted present and unique (helpers/buildfake.mjs withMutant).
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
const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/coverdig-hall-1105.json', import.meta.url), 'utf8'))
const PAL = FX.palette ?? B.loadBlueprint(FX.blueprint).palette
const box = n => mc.blocksByName[n]?.boundingBox ?? 'block'
const over = new Map()
const live = (x, y, z) => { const key = `${x},${y},${z}`; const n = over.get(key) ?? FX.world[key]; return !n || n === '?' ? null : { name: n, boundingBox: box(n) } }
const rec = { cells: FX.cells, segments: FX.segments }
const isDone = c => { const b = live(...c.at); return !!b && R.cellDone(b, PAL, c.role) }
const BASE = [-7, 66, 33], RING = [-7, 67, 33]
const aboveOf = (at, seg, deps = true) => new Set(FX.cells.filter(q => q.at[0] === at[0] && q.at[2] === at[2] && q.at[1] > at[1] && (q.seg === seg || (deps && R.dependsOn(rec, q.seg, seg))) && !isDone(q)).map(q => k(q.at)))
// the walk from the ground east of the corner (a stand the live read found), the open record cells obstacles as in runVisit
const GROUND = { x: -4, y: 67, z: 32 }
const nodes = () => {
  const open = new Set(FX.cells.filter(c => !isDone(c)).map(c => k(c.at)))
  const m = new Map(); for (const key of B.walkFrom(live, GROUND, open, 7)) { const [x, y, z] = key.split(',').map(Number); const c = `${x},${z}`; (m.get(c) ?? m.set(c, []).get(c)).push(y) } return m
}

console.log('THE LIVE CORNER (pure, on the fixture)')
await t('the base is open air under the ring cell\'s grass; the ring waits on the pad; no placement step reaches the base', () => {
  over.clear()
  const base = FX.cells.find(c => k(c.at) === k(BASE)), ring = FX.cells.find(c => k(c.at) === k(RING))
  assert.deepStrictEqual([base.seg, live(...BASE).name, ring.seg, live(...RING).name], ['pad', 'air', 'ring', 'grass_block'])
  assert.ok(R.dependsOn(rec, 'ring', 'pad'), 'the ring waits on the pad')
  assert.strictEqual(B.stepFor(live, GROUND, BASE, nodes(), () => true), null, 'the live failure: no stand')
  // positive control: the same walk has a dig stand for the grass above it
  assert.ok(R.digStand(live, RING, nodes()), 'the walk reaches the cover')
})
await t('coverAbove names the ring cell\'s grass; dug, the base has a placement step', () => {
  over.clear()
  const above = aboveOf(BASE, 'pad')
  assert.ok(above.has(k(RING)))
  const cv = R.coverAbove(live, BASE, { isOpenAbove: q => above.has(k(q)), scaffold: R.FOREIGN_CLEAR })
  assert.ok(cv.ok, cv.why)
  assert.deepStrictEqual(cv.digs.map(d => `${k(d.at)}:${d.name}`), ['-7,67,33:grass_block'])
  over.set(k(RING), 'air')
  assert.ok(B.stepFor(live, GROUND, BASE, nodes(), () => true), 'a placement step once the cover is gone')
  over.clear()
})
await t('only open cells of this segment or one waiting on it: without the dependency the cover is kept', () => {
  over.clear()
  const own = aboveOf(BASE, 'pad', false)
  const cv = R.coverAbove(live, BASE, { isOpenAbove: q => own.has(k(q)), scaffold: R.FOREIGN_CLEAR })
  assert.deepStrictEqual([cv.ok, cv.why], [false, 'kept grass_block -7,67,33'])
})

// ---- refusals (pure, a synthetic column) -------------------------------------------------------------------------------------
await t('coverAbove refuses: clear above (open), unread, a non-scaffold block, a veto, deeper than max; digs highest first', () => {
  const col = names => (x, y, z) => { if (x || z) return { name: 'cobblestone', boundingBox: 'block' }; const n = names[y - 1]; return n === null ? null : { name: n ?? 'air', boundingBox: box(n ?? 'air') } }
  const at = [0, 0, 0], openAbove = q => q[1] <= 4
  assert.deepStrictEqual(R.coverAbove(col(['air']), at, { isOpenAbove: openAbove }).why, 'open')
  assert.deepStrictEqual(R.coverAbove(col([null]), at, { isOpenAbove: openAbove }).why, 'unknown 0,1,0')
  assert.deepStrictEqual(R.coverAbove(col(['chest']), at, { isOpenAbove: openAbove }).why, 'kept chest 0,1,0')
  assert.deepStrictEqual(R.coverAbove(col(['dirt']), at, { isOpenAbove: () => false }).why, 'kept dirt 0,1,0')
  assert.deepStrictEqual(R.coverAbove(col(['dirt', 'dirt']), at, { isOpenAbove: openAbove, mayDig: q => q[1] !== 2 }).why, 'vetoed 0,2,0')
  assert.deepStrictEqual(R.coverAbove(col(['dirt', 'dirt', 'dirt', 'dirt', 'air']), at, { isOpenAbove: () => true }).why, 'deep 3+ above')
  assert.deepStrictEqual(R.coverAbove(col(['dirt', 'grass_block', 'air']), at, { isOpenAbove: openAbove }).digs.map(d => k(d.at)), ['0,2,0', '0,1,0'])
})

await t('batch-11 fold (Codex BLOCKER 2): a cover that holds liquid back is never dug -- water or lava beside it or over it, or an unread neighbour (POSITIVE CONTROL: the same cover with stone around digs)', () => {
  const at = [0, 0, 0], openAbove = q => q[1] <= 4
  const world = side => (x, y, z) => {
    if (x === 0 && z === 0) return y === 1 ? { name: 'grass_block', boundingBox: 'block' } : y === 2 ? (side.above ? { name: side.above, boundingBox: 'empty' } : { name: 'air', boundingBox: 'empty' }) : y === 0 ? { name: 'air', boundingBox: 'empty' } : { name: 'stone', boundingBox: 'block' }
    if (y === 1 && x === 1 && z === 0 && side.east !== undefined) return side.east === null ? null : { name: side.east, boundingBox: /water|lava/.test(side.east) ? 'empty' : 'block' }
    return { name: 'stone', boundingBox: 'block' }
  }
  const ok = R.coverAbove(world({}), at, { isOpenAbove: openAbove })
  assert.ok(ok.ok && ok.digs.length === 1, JSON.stringify(ok))
  for (const [side, why] of [[{ east: 'water' }, /^liquid water beside 0,1,0$/], [{ east: 'lava' }, /^liquid lava beside 0,1,0$/], [{ above: 'water' }, /^liquid water beside 0,1,0$/], [{ east: null }, /^unknown 1,1,0$/]]) {
    const r = R.coverAbove(world(side), at, { isOpenAbove: openAbove })
    assert.ok(!r.ok && why.test(r.why), `${JSON.stringify(side)}: ${JSON.stringify(r)}`)
  }
})
await t('MUTANT: the liquid check cut -- the cover beside water is dug (the test fails for that reason)', async () => {
  await withMutant("if (isLiquid(nb) || /waterlogged/.test(String(nb.name ?? '')) || nb.props?.waterlogged === true || nb.props?.waterlogged === 'true') return { ok: false, digs: [], why: `liquid ${nm(nb)} beside ${kOf(q)}` }", '', async M => {
    const read = (x, y, z) => (x === 0 && z === 0 ? (y === 1 ? { name: 'grass_block', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }) : x === 1 && y === 1 && z === 0 ? { name: 'water', boundingBox: 'empty' } : { name: 'stone', boundingBox: 'block' })
    assert.ok(M.coverAbove(read, [0, 0, 0], { isOpenAbove: q => q[1] <= 4 }).ok)
  })
})

// ---- the chain on the fake server --------------------------------------------------------------------------------------------
// The live shape: a pad cell P (11,G+1,10, air) walled on four sides by cobblestone that is no record cell's, the ground under it,
// and a RING cell over it (11,G+2,10, segment `ring` waiting on `pad`) holding grass_block; a second ring cell beside the wall
const hallRec = cells => ({ v: 1, plot: 'monument', blueprint: 'ziggurat@1', cells, clear: [], replant: [], segments: [{ seg: 'pad', deps: [] }, { seg: 'ring', deps: ['pad'] }] })
const P = [11, G + 1, 10], C = [11, G + 2, 10]
function scene () {
  const srv = server()
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) srv.set([11 + dx, G + 1, 10 + dz], 'cobblestone')
  srv.set(C, 'grass_block')
  return { srv, rec: hallRec([{ at: P, role: 'skin', seg: 'pad' }, { at: C, role: 'skin', seg: 'ring' }]) }
}
function project (record) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/coverdig-`)
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
console.log('THE CHAIN (runVisit on the fake server)')
await t('CONTROL (p.cover false: the live code): the pad cell is deferred, the grass stands, nothing is built', async () => {
  const { srv, rec, e } = await chain(R, { cover: false })
  assert.ok(!done(srv, rec))
  assert.strictEqual(srv.read(...C).name, 'grass_block')
  assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'deferred' && k(d.cell) === k(P)))
})
await t('the cover (the ring cell\'s grass) is dug, then the pad and the ring are built -- killed with the remedy cut', async () => {
  await killedBy('          if (p.cover !== false && cand.length && !open.some(c => !isClear(c.at))) {\n', '          if (false) {\n', async M => {
    const { srv, rec, e, stops } = await chain(M, {})
    assert.ok(done(srv, rec), `built (${stops})`)
    const digs = e.logs.filter(([kk, d]) => kk === '_build' && d.op === 'clear').map(([, d]) => `${k(d.cell)}:${d.kind}`)
    assert.deepStrictEqual(digs, [`${k(C)}:cover`])
  })
})
await t('the waiting segment is what lets the cover go -- killed with the column limited to this segment\'s own cells', async () => {
  await killedBy('(dependsOn(record, q.seg, seg) || q.seg === seg)', '(q.seg === seg)', async M => {
    const { srv, rec } = await chain(M, {})
    assert.ok(done(srv, rec), 'built')
  })
})
await t('a DONE cell over the pad is never dug: the pad is deferred, the done cell stands', async () => {
  const { srv, rec } = scene(), pr = project(rec), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
  srv.set(C, 'cobblestone')
  await R.runVisit(pr.p('A', {}), e, { maxSteps: 400 })
  assert.strictEqual(srv.read(...C).name, 'cobblestone')
  assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'deferred' && k(d.cell) === k(P)))
  assert.ok(!e.logs.some(([kk, d]) => kk === '_build' && d.op === 'clear'))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
