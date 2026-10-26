// SHOP-01 F4 (Paper 10-26 SHOP-TERRAIN hive-c, a record sited by the older proof): AN ORDINARY RECORD CELL NO STAND REACHES MUST
// NOT STOP EVERY VISIT. The visit stopped `no_step earth: 1 open, 1 placeable now` every minute. Now the cell is DEFERRED -- the
// visit builds every segment that does not wait on its segment; later visits ask again (the walk grows with every stand the
// town's bots occupy); after STUCK_VISITS visits the build reports `stuck_on_cell` (a named row the read counts) and the order
// backs off SHOP_STUCK_RETRY_MS. These tests walk the chain visit by visit on the fake server.
import assert from 'node:assert'
const { R, PJ, S, both, G, k3, server, bot, SITE, project, KIT } = await import('./helpers/buildfake.mjs').then(async m => ({ ...m, S: await import('../src/shop.mjs') }))

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}

// one extra record cell, sealed in bedrock on all six sides (no stand can see a face), in its own segment FIRST; a second
// extra segment waits on it; the workshop's own segments are independent of both
const X = [5, G + 1, 25]       // inside the stand domain (Chebyshev >= 22 from home), clear of the workshop
const Y = [9, G + 1, 25]       // extra2's own cell: reachable, but its segment waits on X's
const sealed = () => Object.fromEntries([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(d => [k3(X.map((v, i) => v + d[i])), 'bedrock']))
const RECORD = { ...SITE.record,
  cells: [{ at: X, role: 'base', seg: 'extra', stand: [X[0] - 1, G + 1, X[2]], support: [X[0], G, X[2]], face: [0, 1, 0], order: -2 },
    { at: Y, role: 'base', seg: 'extra2', stand: [Y[0] - 1, G + 1, Y[2]], support: [Y[0], G, Y[2]], face: [0, 1, 0], order: -1 }, ...SITE.record.cells],
  segments: [{ seg: 'extra', deps: [] }, { seg: 'extra2', deps: ['extra'] }, ...SITE.record.segments] }
const inv = () => ({ ...KIT(), stone_bricks: 91 })
async function visit (Mod, pr, srv) {
  const h = PJ.recordHead(pr.dir, pr.key), e = bot(srv, 'A', { inv: inv() })
  const r = await Mod.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen }, e, { maxSteps: 4000 })
  return { r, e }
}

console.log('THE CELL NO STAND REACHES')
await t('the chain: deferred (the rest built) -> deferred -> stuck_on_cell at STUCK_VISITS; opened -> built -> complete, the map cleared', async () => {
  const srv = server(sealed()), pr = project(RECORD)
  const stops = []
  for (let i = 0; i < R.STUCK_VISITS; i++) { const { r, e } = await visit(R, pr, srv); stops.push(r.stop); if (i === 0) { assert.ok(r.placed > 100, `the first visit builds the rest (${r.placed})`); assert.ok(e.logs.some(([k, d]) => k === '_build' && d.op === 'deferred')) } }
  assert.deepStrictEqual(stops, [...Array(R.STUCK_VISITS - 1).fill('cell_deferred'), 'stuck_on_cell'], `${stops}`)
  assert.strictEqual(PJ.stuckRead(pr.dir, pr.key)[k3(X)].visits, R.STUCK_VISITS)
  assert.strictEqual(srv.read(...X).name, 'air', 'the sealed cell is never placed')
  // the town changes (the seal opens on one side): the next visit reaches it, builds it, the map clears
  srv.set([X[0], X[1] + 1, X[2]], 'air')   // the lid off: the floor's top face is seen from a stand beside it
  const { r } = await visit(R, pr, srv)
  assert.strictEqual(r.stop, 'complete', r.stop); assert.strictEqual(srv.read(...X).name, 'stone_bricks'); assert.strictEqual(srv.read(...Y).name, 'stone_bricks', 'the waiting segment built after it')
  assert.deepStrictEqual(PJ.stuckRead(pr.dir, pr.key), {}, 'the stuck map is empty again')
})
await t('the stuck row is NAMED, and the order backs off after it (no loop)', async () => {
  const srv = server(sealed()), pr = project(RECORD)
  let last = null
  for (let i = 0; i < R.STUCK_VISITS; i++) last = await visit(R, pr, srv)
  const row = last.e.logs.find(([k, d]) => k === '_build' && d.op === 'stuck_on_cell')
  assert.ok(row, 'a _build op=stuck_on_cell row'); assert.deepStrictEqual(row[1].cell, X); assert.strictEqual(row[1].visits, R.STUCK_VISITS)
  const base = { on: true, shared: true, atTown: true, holds: false, record: {}, planned: true, freeSlots: 30 }
  const now = 10 * 3600_000
  assert.strictEqual(S.buildOrder({ ...base, now, state: { lastAt: now - S.SHOP_COOLDOWN_MS - 1, lastStop: 'stuck_on_cell' } }).skip, 'stuck_on_cell')
  assert.ok(S.buildOrder({ ...base, now, state: { lastAt: now - S.SHOP_STUCK_RETRY_MS - 1, lastStop: 'stuck_on_cell' } }).order, 'after the back-off it asks again')
})
await t('stuckAfter: counts a visit per deferred cell, drops a cell that now reads done, carries the rest', () => {
  const a = R.stuckAfter({}, ['1,2,3', '1,2,3', '4,5,6'], { now: 1 })
  assert.strictEqual(a.cells['1,2,3'].visits, 1); assert.strictEqual(a.cells['4,5,6'].visits, 1)
  const b = R.stuckAfter(a.cells, ['1,2,3'], { now: 2, done: k => k === '4,5,6' })
  assert.deepStrictEqual(Object.keys(b.cells), ['1,2,3']); assert.strictEqual(b.cells['1,2,3'].visits, 2)
  const c = R.stuckAfter(b.cells, ['1,2,3'], { now: 3 })
  assert.deepStrictEqual(c.stuck, ['1,2,3'])
})
await t('MUTANT the old stop restored: the first visit stops no_step with the rest unbuilt', () => both(
  "          if (cand.length && !open.some(c => !isClear(c.at))) {",
  "          if (false) {", async M => {
    const srv = server(sealed()), pr = project(RECORD)
    const { r } = await visit(M, pr, srv)
    assert.ok(r.placed > 100, `the rest is built (${r.stop}, ${r.placed})`)
  }))
await t('MUTANT a segment waiting on a deferred one is not skipped: the visit stops deps_open, the rest unbuilt', () => both(
  "    if (deps.some(d => deferredSegs.has(d))) { deferredSegs.add(seg); continue }",
  "", async M => {
    const srv = server(sealed()), pr = project(RECORD)
    const { r } = await visit(M, pr, srv)
    assert.ok(r.placed > 100, `the rest is built (${r.stop}, ${r.placed})`)
  }))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
