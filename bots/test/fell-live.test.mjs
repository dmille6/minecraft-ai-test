// FELL-01 r3: THE LIVE SHAPE (showcase 10-28, record project-0_70_0.shop.g2, fc300013 live): pad cell 25,72,28 holds a spruce log
// with the trunk 73..76 above it (75 is a roof-inner cell) and leaves 77-78, and the pad was BUILT ROUND IT: four sides stone
// bricks, ground below, the trunk on top. fc300013 dug the cell first: no face, no sight line, digStand null, `no_stand`
// silently, the cell's attempts spent, `blocked pad: 1 open, 0 placeable now` every visit with no row naming the cell.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
const { R, bot, project, k3, BP } = await import('./helpers/buildfake.mjs')
const B = await import('../src/buildsite.mjs')
const REC = JSON.parse(readFileSync(new URL('./fixtures/showcase-shop-g2-1028.json', import.meta.url), 'utf8'))
const CELL = [25, 72, 28]

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }

const mcData = (await import('node:module')).createRequire(import.meta.url)('minecraft-data')('1.21.8')
const box = n => mcData.blocksByName[n]?.boundingBox ?? 'block'
/** The live geometry on flat ground (top at the record's floor, 71): earth done, the pad done but for the tree cell. */
function liveWorld ({ trunk = true } = {}) {
  const cells = new Map()
  for (const c of REC.cells) {
    if (c.seg === 'earth') cells.set(k3(c.at), 'cobblestone')
    if (c.seg === 'pad' && k3(c.at) !== k3(CELL)) cells.set(k3(c.at), 'stone_bricks')
  }
  cells.set(k3(CELL), 'spruce_log')
  if (trunk) { for (let y = 73; y <= 76; y++) cells.set(k3([25, y, 28]), 'spruce_log'); for (const y of [77, 78]) cells.set(k3([25, y, 28]), 'spruce_leaves') }
  const read = (x, y, z) => {
    if (Math.abs(x) > 60 || Math.abs(z) > 60 || y < 50 || y > 110) return null
    const n = cells.get(`${x},${y},${z}`) ?? (y <= REC.floor ? (y === REC.floor ? 'grass_block' : 'stone') : 'air')
    return { name: n, boundingBox: box(n) }
  }
  return { read, cells, placedAt: new Map(), seen: new Map(), set: (a, n) => cells.set(k3(a), n) }
}
const stood = REC.cells.filter(c => c.seg === 'pad').map(c => c.stand).filter(Boolean)
const nodesOf = srv => { const m = new Map(); for (const key of B.walkFrom(srv.read, REC.home, new Set(), B.WALK_R, { stood })) { const [x, y, z] = key.split(',').map(Number); const c = `${x},${z}`; if (!m.has(c)) m.set(c, []); m.get(c).push(y) } return m }

await t('THE MECHANISM: with the trunk on top the enclosed cell has NO dig stand; with the log above it gone it has one', () => {
  const w = liveWorld()
  assert.strictEqual(R.digStand(w.read, CELL, nodesOf(w)), null, 'enclosed: no face reachable (the live no_stand)')
  w.set([25, 73, 28], 'air')
  assert.ok(R.digStand(w.read, CELL, nodesOf(w)), 'the top face exposed: a stand')
})
await t('THE VISIT on the live record and geometry: the trunk felled first (all 4, 75 a roof cell that waits on pad), the cell dug, the pad completes', async () => {
  const w = liveWorld()
  const { p } = project(REC)
  const e = bot(w, 'A', { feet: [29, 72, 29] })
  const r = await R.runVisit({ ...p('A'), home: REC.home, stood }, e, { maxSteps: 4000 })
  assert.notStrictEqual(w.read(...CELL).name, 'spruce_log', `the cell's log is dug (${r.stop} ${r.why})`)
  assert.ok(R.cellDone(w.read(...CELL), BP.palette, 'base'), 'and built')
  // 75 is roof-inner's, which waits on pad (r4): felled with the trunk, then built by roof-inner
  assert.ok(R.cellDone(w.read(25, 75, 28), BP.palette, 'roof'), `the roof cell built (${w.read(25, 75, 28).name})`)
  for (const y of [73, 74]) assert.strictEqual(w.read(25, y, 28).name, 'air', `trunk ${y} felled`)
  assert.ok(R.segComplete(w.read, REC, BP.palette, 'pad'), 'the pad completes')
  const fell = e.logs.find(([k, d]) => k === '_build' && d.op === 'fell')
  assert.strictEqual(fell?.[1].n, 4, JSON.stringify(fell))
  assert.strictEqual(w.read(25, 76, 28).name, 'air', 'nothing left floating over the roof')
})
await t('MUTANT the r2 order (the cell dug before its trunk): the live shape blocks, and the failed dig is NAMED', async () => {
  const w = liveWorld()
  const { p } = project(REC)
  // the trunk loop disabled: the cell is tried enclosed, as on fc300013
  const { withMutant } = await import('./helpers/buildfake.mjs')
  await withMutant('            const trunk = trunkAbove(rd, f.at, { keep, skip }).map(', '            const trunk = [].map(', async M => {
    const e = bot(w, 'A', { feet: [29, 72, 29] })
    const r = await M.runVisit({ ...p('A'), home: REC.home, stood }, e, { maxSteps: 4000 })
    assert.strictEqual(w.read(...CELL).name, 'spruce_log', 'the log stands')
    assert.ok(!R.segComplete(w.read, REC, BP.palette, 'pad'), `the pad is open (${r.stop})`)
    assert.ok(e.logs.some(([k, d]) => k === '_build' && d.op === 'clear_failed' && d.cell.join(',') === CELL.join(',') && d.result === 'no_stand'), 'clear_failed result=no_stand names the cell')
  })
})
await t('trunkAbove skip: a skipped cell is walked through and not returned; keep still stops', () => {
  const col = { '0,1,0': 'oak_log', '0,2,0': 'oak_log', '0,3,0': 'oak_log' }
  const read = (x, y, z) => ({ name: col[`${x},${y},${z}`] ?? 'air' })
  assert.deepStrictEqual(R.trunkAbove(read, [0, 0, 0], { skip: c => c[1] === 2 }), [[0, 1, 0], [0, 3, 0]])
  assert.deepStrictEqual(R.trunkAbove(read, [0, 0, 0], { keep: c => c[1] === 2 }), [[0, 1, 0]])
})
await t('r4 THE WALL CASE (Codex/Claude r3 P2): an enclosed pad cell under a WALL log (wall-L waits on pad) is not a dead end', async () => {
  const C2 = [21, 72, 29]
  const at = REC.cells.find(c => c.at.join(',') === '21,73,29')
  assert.ok(at && at.seg === 'wall-L' && R.dependsOn(REC, 'wall-L', 'pad'), 'the live record: 21,73,29 is wall-L, which waits on pad')
  const w = liveWorld({ trunk: false })
  w.set(CELL, 'stone_bricks'); w.set(C2, 'spruce_log'); for (let y = 73; y <= 76; y++) w.set([21, y, 29], 'spruce_log')
  assert.strictEqual(R.digStand(w.read, C2, nodesOf(w)), null, 'enclosed (positive control of the shape)')
  const { p } = project(REC)
  const e = bot(w, 'A', { feet: [29, 72, 29] })
  const r = await R.runVisit({ ...p('A'), home: REC.home, stood }, e, { maxSteps: 4000 })
  assert.ok(R.segComplete(w.read, REC, BP.palette, 'pad'), `the pad completes (${r.stop} ${r.why})`)
  assert.ok(!/_log$/.test(w.read(21, 73, 29).name), 'the wall cell\'s log was dug under pad\'s lease (wall-L cannot be leased yet)')
})
await t('dependsOn: direct and transitive, never reflexive or upstream', () => {
  assert.ok(R.dependsOn(REC, 'wall-L', 'pad')); assert.ok(R.dependsOn(REC, 'roof-inner', 'pad')); assert.ok(R.dependsOn(REC, 'pad', 'earth'))
  assert.ok(!R.dependsOn(REC, 'pad', 'wall-L')); assert.ok(!R.dependsOn(REC, 'pad', 'pad'))
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
