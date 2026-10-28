// SHOP-01 F2, PART 2 (the runner's 120 s per-file budget): the MUTANTS of the replant chain. See buildrun-replant.test.mjs.
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

console.log('MUTANTS OF THE REPLANT CHAIN (anchored, unique; both ways)')
await t('MUTANT the move dropped (the old stop): the visit stops no_step and nothing moves', () => both(
  "if (!step || step.support[1] !== r.cell[1] - 1) return replantRemedy(r, nodes, 'no_step')",
  "if (!step || step.support[1] !== r.cell[1] - 1) { out.stop = 'no_step'; return out }", async M => {
    const f = floatingReplant(), srv = server({ [k3(f.at)]: 'oak_log' }), pr = project(f.record)
    const h = PJ.recordHead(pr.dir, pr.key)
    const r = await M.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen }, bot(srv, 'A'), { maxSteps: 200 })
    assert.notStrictEqual(r.stop, 'no_step')
  }))

/** The walk-failure chain as a scenario (for its mutant): every visit's walk stops short of any replant stand. */
async function walkNeverArrives (Mod) {
  const f = floatingReplant(), srv = server({ [k3(f.at)]: 'oak_log' }), pr = project(f.record)
  const seq = [f.rp.cell.join(',')]
  for (let i = 0; i < Mod.REPLANT_MOVES + Mod.REPLANT_DEFERS + 4; i++) {
    const h = PJ.recordHead(pr.dir, pr.key), e = bot(srv, 'A')
    const cells = (h.head.rec.replant ?? []).filter(x => x.state !== 'skipped').map(x => x.cell)
    const walk = e.walkTo
    e.walkTo = async st => (cells.some(c => Math.max(Math.abs(c[0] - st[0]), Math.abs(c[2] - st[2])) <= 6) ? true : walk(st))
    const r = await Mod.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen }, e, { maxSteps: 2000 })
    const now = PJ.recordHead(pr.dir, pr.key).head.rec.replant[0].cell.join(',')
    if (now !== seq.at(-1)) seq.push(now)
    if (r.stop === 'complete') break
  }
  // the replant's successive cells: every one new (a refused cell never comes back: no A -> B -> A)
  assert.strictEqual(new Set(seq).size, seq.length, `never the same cell twice (${seq.join(' -> ')})`)
}
await t('MUTANT the tried list not passed to the search: a refused cell comes back', () => both(
  "replantAlternative(rd, home, record, nodes, p.res ?? null, tried)", "replantAlternative(rd, home, record, nodes, p.res ?? null, [])", walkNeverArrives))
await t('replantAlternative never returns an excluded cell, nor a footprint or another replant\'s column', () => {
  const f = floatingReplant(), srv = server()
  const nodes = new Map([[`${SITE.record.box[2] + 11},${SITE.record.box[1]}`, [G + 1]], [`${SITE.record.box[2] + 12},${SITE.record.box[1]}`, [G + 1]]])
  const c1 = B.replantAlternative(srv.read, HOME, f.record, nodes, null, [f.rp.cell])
  const c2 = B.replantAlternative(srv.read, HOME, f.record, nodes, null, [f.rp.cell, c1])
  assert.ok(c1 && c2 && c1.join(',') !== c2.join(','), `${c1} then ${c2}`)
  const foot = new Set(SITE.record.cells.map(c => `${c.at[0]},${c.at[2]}`))
  for (const c of [c1, c2]) assert.ok(!foot.has(`${c[0]},${c[2]}`))
})
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
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
