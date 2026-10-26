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
await t('the chain with NO plantable cell in the band: the replant is recorded SKIPPED, the tree falls, the build completes', async () => {
  const f = floatingReplant(), srv = server({ [k3(f.at)]: 'oak_log' }), pr = project(f.record)
  const res = { column: () => 'plan_cell', zones: [] }   // every column of the band reserved by the town plan
  const stops = await visits(pr, srv, { res })
  assert.ok(!stops.includes('no_step'), `never a no_step stop (${stops})`)
  assert.strictEqual(stops[0], 'replanned'); assert.strictEqual(stops.at(-1), 'complete', `${stops}`)
  const rec = PJ.recordHead(pr.dir, pr.key).head.rec
  assert.strictEqual(rec.replant[0].state, 'skipped'); assert.ok(Number.isFinite(rec.replant[0].skippedAt))
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
await t('control: a REACHABLE replant cell is planted where the record put it (no move, no skip)', async () => {
  const f = floatingReplant(), rp = { ...f.rp, cell: [f.rp.cell[0], G + 1, f.rp.cell[2]] }
  const srv = server({ [k3(f.at)]: 'oak_log' }), pr = project({ ...f.record, replant: [rp] })
  const stops = await visits(pr, srv)
  assert.ok(!stops.includes('replanned'), `${stops}`); assert.strictEqual(stops.at(-1), 'complete')
  assert.strictEqual(srv.read(...rp.cell).name, 'oak_sapling')
})
await t('MUTANT the move dropped (the old stop): the visit stops no_step and nothing moves', () => both(
  "      const alt = replantAlternative(rd, home, record, nodes, p.res ?? null)",
  "      out.stop = 'no_step'; return out\n      const alt = replantAlternative(rd, home, record, nodes, p.res ?? null)", async M => {
    const f = floatingReplant(), srv = server({ [k3(f.at)]: 'oak_log' }), pr = project(f.record)
    const h = PJ.recordHead(pr.dir, pr.key)
    const r = await M.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen }, bot(srv, 'A'), { maxSteps: 200 })
    assert.notStrictEqual(r.stop, 'no_step')
  }))

await t('MUTANT a skipped replant still holds its tree: the build never completes', () => both(
  "  const replanted = () => (record.replant ?? []).every(r => r.state === 'skipped' || SAPLING.test(nm(rd(...r.cell))))",
  "  const replanted = () => (record.replant ?? []).every(r => SAPLING.test(nm(rd(...r.cell))))", async M => {
    const f = floatingReplant(), srv = server({ [k3(f.at)]: 'oak_log' }), pr = project(f.record)
    const res = { column: () => 'plan_cell', zones: [] }
    let last = null
    for (let i = 0; i < 4; i++) {
      const h = PJ.recordHead(pr.dir, pr.key)
      last = (await M.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, res }, bot(srv, 'A'), { maxSteps: 2000 })).stop
      if (last === 'complete') break
    }
    assert.strictEqual(last, 'complete')
  }))
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
