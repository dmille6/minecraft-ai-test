// SHOP-01 F2 (Paper 10-25 SHOP-TERRAIN hive-c, twice): A REPLANT CELL THE BUILDER CANNOT REACH MUST NEVER STOP THE BUILD.
// The visit stopped `no_step replant` every minute and placed nothing for 40 minutes: B4 forbids felling a tree before its
// sapling, the sapling cell had no stand, and every segment waited behind the tree. The remedy is a move the bot can make from
// where it stands: the record MOVES the replant to the nearest plantable cell in the band, or, with none, records it SKIPPED and
// the tree may fall. These tests run the CHAIN of refusals -- the unreachable cell, the move (or the skip), the next visit's
// planting, the felling, the build -- visit after visit on the fake server, not one guard.
import assert from 'node:assert'
const { B, R, PJ, both, G, HOME, k3, server, KIT, bot, BP, SITE, project, allDone } = await import('./helpers/buildfake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}

/** A tree on a pad cell and its replant cell FLOATING (air under it: no support, so no step can plant it). */
function floatingReplant () {
  const log = B.footprint(BP, { x: SITE.record.anchor[0], z: SITE.record.anchor[1] }, SITE.record.orient).pad[30]
  const at = [log[0], G + 1, log[1]]
  const rp = { cell: [SITE.record.box[2] + 10, G + 6, SITE.record.box[1]], species: 'oak', sapling: 'oak_sapling', state: 'pending' }
  return { at, rp, record: { ...SITE.record, clear: [{ at, kind: 'tree', name: 'oak_log' }], replant: [rp] } }
}
/** Visits until complete (each on the record's CURRENT head, as skills.mjs reads it) -> [stops]. */
async function visits (pr, srv, { res = null, max = 8, steps = 2000 } = {}) {
  const stops = []
  for (let i = 0; i < max; i++) {
    const h = PJ.recordHead(pr.dir, pr.key)
    const r = await R.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, ...(res ? { res } : {}) }, bot(srv, 'A'), { maxSteps: steps })
    stops.push(r.stop)
    if (r.stop === 'complete') break
  }
  return stops
}

console.log('THE REPLANT CELL NO STAND REACHES')
await t('the chain: unreachable -> the record MOVES the replant -> the next visit plants it -> the tree falls -> complete', async () => {
  const f = floatingReplant(), srv = server({ [k3(f.at)]: 'oak_log' }), pr = project(f.record)
  const stops = await visits(pr, srv)
  assert.ok(!stops.includes('no_step'), `never a no_step stop (${stops})`)
  assert.strictEqual(stops[0], 'replanned', `the first visit moves it (${stops})`)
  assert.strictEqual(stops.at(-1), 'complete', `the build completes (${stops})`)
  const rec = PJ.recordHead(pr.dir, pr.key).head.rec
  const rp = rec.replant[0]
  assert.deepStrictEqual(rp.movedFrom, f.rp.cell); assert.notDeepStrictEqual(rp.cell, f.rp.cell)
  assert.strictEqual(rp.cell[1], G + 1, 'on the ground')
  assert.ok(!rec.cells.some(c => c.at[0] === rp.cell[0] && c.at[2] === rp.cell[2]), 'never a record cell\'s column')
  assert.strictEqual(srv.read(...rp.cell).name, 'oak_sapling', 'the sapling stands at the new cell')
  assert.notStrictEqual(srv.read(...f.at).name, 'oak_log', 'the tree came down after it')
  assert.ok(allDone(srv), 'every record cell done')
})
await t('the chain with NO plantable cell anywhere: DEFERRED REPLANT_DEFERS-1 visits, then SKIPPED, the tree falls, complete', async () => {
  const f = floatingReplant(), srv = server({ [k3(f.at)]: 'oak_log' }), pr = project(f.record)
  const res = { column: () => 'plan_cell', zones: [] }   // every column of the town reserved by the plan
  const stops = await visits(pr, srv, { res, max: 10 })
  assert.ok(!stops.includes('no_step'), `never a no_step stop (${stops})`)
  assert.deepStrictEqual(stops.slice(0, R.REPLANT_DEFERS), Array(R.REPLANT_DEFERS).fill('replanned'), `${stops}`)
  assert.strictEqual(stops.at(-1), 'complete', `${stops}`)
  const rec = PJ.recordHead(pr.dir, pr.key).head.rec
  assert.strictEqual(rec.replant[0].state, 'skipped'); assert.ok(Number.isFinite(rec.replant[0].skippedAt))
  assert.strictEqual(rec.replant[0].deferred, R.REPLANT_DEFERS - 1, 'deferred before the skip')
  assert.notStrictEqual(srv.read(...f.at).name, 'oak_log'); assert.ok(allDone(srv))
})
await t('a felling after a skip reports saplings 0/0 (the read judges it: no obligation left)', async () => {
  const f = floatingReplant(), srv = server({ [k3(f.at)]: 'oak_log' }), pr = project(f.record)
  const res = { column: () => 'plan_cell', zones: [] }
  const logs = []
  for (let i = 0; i < 8; i++) {
    const h = PJ.recordHead(pr.dir, pr.key), e = bot(srv, 'A')
    const r = await R.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, res }, e, { maxSteps: 2000 })
    logs.push(...e.logs)
    if (r.stop === 'complete') break
  }
  const fell = logs.find(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'tree')
  assert.ok(fell, 'the tree was felled'); assert.strictEqual(fell[1].saplings, '0/0')
  assert.ok(logs.some(([k, d]) => k === '_build' && d.op === 'replant_skipped'), 'the skip is logged')
})
await t('the walk never reaches a replant stand (Codex r18 P2): bounded -- REPLANT_MOVES moves to NEW cells, deferrals, a skip, complete', async () => {
  const f = floatingReplant(), srv = server({ [k3(f.at)]: 'oak_log' }), pr = project(f.record)
  const stops = []
  for (let i = 0; i < R.REPLANT_MOVES + R.REPLANT_DEFERS + 4; i++) {
    const h = PJ.recordHead(pr.dir, pr.key), e = bot(srv, 'A')
    const cells = (h.head.rec.replant ?? []).filter(x => x.state !== 'skipped').map(x => x.cell)
    const walk = e.walkTo
    e.walkTo = async st => (cells.some(c => Math.max(Math.abs(c[0] - st[0]), Math.abs(c[2] - st[2])) <= 6) ? true : walk(st))   // never arrives near a replant
    const r = await R.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen }, e, { maxSteps: 2000 })
    stops.push(r.stop)
    if (r.stop === 'complete') break
  }
  assert.ok(!stops.includes('no_step') && !stops.includes('stand'), `${stops}`)
  assert.strictEqual(stops.at(-1), 'complete', `${stops}`)
  const rp = PJ.recordHead(pr.dir, pr.key).head.rec.replant[0]
  assert.strictEqual(rp.state, 'skipped'); assert.strictEqual(rp.moves, R.REPLANT_MOVES)
  const keys = rp.tried.map(c => c.join(','))
  assert.strictEqual(new Set(keys).size, keys.length, `never the same cell twice (${keys})`)
})
await t('the CAS re-checks the destination in the head it writes: a cell another replant took meanwhile is never shared', async () => {
  const f = floatingReplant(), srv = server({ [k3(f.at)]: 'oak_log' }), pr = project(f.record)
  const h0 = PJ.recordHead(pr.dir, pr.key)
  // a dry run on a copy finds the cell this visit will pick
  const dry = project(f.record), dsrv = server({ [k3(f.at)]: 'oak_log' })
  const dh = PJ.recordHead(dry.dir, dry.key)
  await R.runVisit({ ...dry.p('A'), record: dh.head.rec, recordGen: dh.head.gen }, bot(dsrv, 'A'), { maxSteps: 400 })
  const pick = PJ.recordHead(dry.dir, dry.key).head.rec.replant[0].cell
  // another builder's replant lands on that cell first (a newer head than the visit's own record)
  PJ.publishRecord(pr.dir, pr.key, cur => ({ ...cur, replant: [...cur.replant, { cell: pick, species: 'oak', sapling: 'oak_sapling', state: 'pending' }] }))
  const r = await R.runVisit({ ...pr.p('A'), record: h0.head.rec, recordGen: h0.head.gen }, bot(srv, 'A'), { maxSteps: 400 })
  const head = PJ.recordHead(pr.dir, pr.key).head.rec
  const cells = head.replant.filter(x => x.state !== 'skipped').map(x => x.cell.join(','))
  assert.strictEqual(new Set(cells).size, cells.length, `no two replants on one cell (${cells})`)
  assert.strictEqual(r.stop, 'replanned', r.stop)
})
await t('the town reservations unreadable: nothing moves or skips, the visit ends replant_wait (Claude r18 P2-2)', async () => {
  const f = floatingReplant(), srv = server({ [k3(f.at)]: 'oak_log' }), pr = project(f.record)
  const h = PJ.recordHead(pr.dir, pr.key)
  const r = await R.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, resFailed: true }, bot(srv, 'A'), { maxSteps: 400 })
  assert.strictEqual(r.stop, 'replant_wait')
  assert.deepStrictEqual(PJ.recordHead(pr.dir, pr.key).head.rec.replant[0], f.rp, 'the record is unchanged')
})
await t('control: a REACHABLE replant cell is planted where the record put it (no move, no skip)', async () => {
  const f = floatingReplant(), rp = { ...f.rp, cell: [f.rp.cell[0], G + 1, f.rp.cell[2]] }
  const srv = server({ [k3(f.at)]: 'oak_log' }), pr = project({ ...f.record, replant: [rp] })
  const stops = await visits(pr, srv)
  assert.ok(!stops.includes('replanned'), `${stops}`); assert.strictEqual(stops.at(-1), 'complete')
  assert.strictEqual(srv.read(...rp.cell).name, 'oak_sapling')
})
console.log('THE SITING PROOF AND THE VISIT AGREE')
await t('replantCellAt: a cell is accepted only with a step that places onto the soil under it (the visit\'s own rule)', () => {
  const srv = server()
  const x = SITE.record.box[2] + 10, z = SITE.record.box[1]
  const near = new Map([[`${x + 1},${z}`, [G + 1]]])
  assert.deepStrictEqual(B.replantCellAt(srv.read, HOME, x, z, null, near), [x, G + 1, z])
  assert.strictEqual(B.replantCellAt(srv.read, HOME, x, z, null, new Map()), null, 'no stand anywhere: refused at siting')
  assert.strictEqual(B.replantCellAt(srv.read, HOME, x, z, { column: () => 'plan_cell', zones: [] }, near), null, 'a reserved column')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
