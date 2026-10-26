// (part 2 of buildrun-stuck: the stuck count on every exit, per holder, fail-closed -- split for the runner's 120 s budget)
// SHOP-01 F4 (Paper 10-26 SHOP-TERRAIN hive-c, a record sited by the older proof): AN ORDINARY RECORD CELL NO STAND REACHES MUST
// NOT STOP EVERY VISIT. The visit stopped `no_step earth: 1 open, 1 placeable now` every minute. Now the cell is DEFERRED -- the
// visit builds every segment that does not wait on its segment; later visits ask again (the walk grows with every stand the
// town's bots occupy); after STUCK_VISITS visits the build reports `stuck_on_cell` (a named row the read counts) and the order
// backs off SHOP_STUCK_RETRY_MS. These tests walk the chain visit by visit on the fake server.
import assert from 'node:assert'
import fs from 'node:fs'
const { R, PJ, S, both, withMutant, G, k3, server, bot, SITE, project, KIT } = await import('./helpers/buildfake.mjs').then(async m => ({ ...m, S: await import('../src/shop.mjs') }))

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
async function visit (Mod, pr, srv, { who = 'A', bag = inv() } = {}) {
  const h = PJ.recordHead(pr.dir, pr.key), e = bot(srv, who, { inv: bag })
  const r = await Mod.runVisit({ ...pr.p(who), record: h.head.rec, recordGen: h.head.gen }, e, { maxSteps: 4000 })
  return { r, e }
}
// A KILL MEANS AN ASSERTION (Codex r21: `both` took any thrown error as a kill): the mutant must fail the scenario's own assert
const bothA = async (old, neu, scenario) => {
  await scenario(R)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
// a mutant of buildproj.mjs (its anchor present and unique), imported from the test directory
async function withProjMutant (old, neu, fn) {
  const src = fs.readFileSync(new URL('../src/buildproj.mjs', import.meta.url), 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-proj-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}

console.log('THE COUNT ON EVERY EXIT, TWO BUILDERS, A MAP THAT CANNOT BE WRITTEN (Codex r21 P2 x3)')
const noBricks = () => ({ ...KIT(), stone_bricks: 0 })
const earlyChain = async Mod => {
  const srv = server(sealed()), pr = project(RECORD)
  const stops = []
  let last = null
  for (let i = 0; i < R.STUCK_VISITS; i++) { last = await visit(Mod, pr, srv, { bag: noBricks() }); stops.push(last.r.stop) }
  assert.deepStrictEqual(stops, Array(R.STUCK_VISITS).fill('no_material'), `each visit stops early (${stops})`)
  assert.strictEqual(PJ.stuckRead(pr.dir, pr.key)[k3(X)]?.visits, R.STUCK_VISITS, 'every early-exit visit counted')
  const row = last.e.logs.find(([k, d]) => k === '_build' && d.op === 'stuck_on_cell')
  assert.ok(row && row[1].early === true, 'the named row on the early exit that reached the threshold')
  // NO PROJECT BACK-OFF FROM AN EARLY EXIT (Claude r22 P2-1): the bricks arrive, the next visit builds the rest at once
  assert.strictEqual(PJ.stuckAt(pr.dir, pr.key), null, 'an early exit never stamps the project back-off')
  const { r } = await visit(Mod, pr, srv)
  assert.ok(r.placed > 100, `the rest built on the next visit (${r.placed})`)
  assert.strictEqual(r.stop, 'stuck_on_cell')
  assert.ok(Number.isFinite(PJ.stuckAt(pr.dir, pr.key)), 'the loop-end stuck stamps it')
}
await t('a visit that defers a cell and then stops early (no_material) still counts it; the third logs stuck_on_cell (early)', () => earlyChain(R))
await t('MUTANT the early-exit settle dropped: the count never reaches the threshold', () => bothA(
  "    if (!settled && !reachedEnd) {", "    if (false) {", earlyChain))
await t('MUTANT an early exit stamps the back-off (r22): stuckAt set after no_material', () => bothA(
  "stuckAt: worst.length && stalled ? t :", "stuckAt: worst.length ? t :", earlyChain))

const twoBuilders = async Mod => {
  const srv = server(sealed()), pr = project(RECORD, ['A', 'B'])
  const a1 = await visit(Mod, pr, srv, { who: 'A' }), b1 = await visit(Mod, pr, srv, { who: 'B' })
  assert.deepStrictEqual([a1.r.stop, b1.r.stop], ['cell_deferred', 'cell_deferred'])
  assert.strictEqual(PJ.stuckRead(pr.dir, pr.key)[k3(X)].visits, 2, 'two builders, two visits')
  const a2 = await visit(Mod, pr, srv, { who: 'A' })
  assert.strictEqual(a2.r.stop, 'stuck_on_cell', 'the SUM reaches the threshold')
}
await t('two builders: each writes its own file, the threshold is their sum (A, B, A -> deferred, deferred, stuck)', () => twoBuilders(R))
const race = async PJm => {
  const dir = fs.mkdtempSync(new URL('./', import.meta.url).pathname + '_stuckrace-')
  try {
    // INTERLEAVED: A and B both read an empty map, then both write one visit -- one shared map lost B's (or A's) increment
    const a = PJm.stuckRead(dir, 'k', { holder: 'A' }), b = PJm.stuckRead(dir, 'k', { holder: 'B' })
    assert.deepStrictEqual([a, b], [{}, {}])
    PJm.stuckWrite(dir, 'k', 'A', R.stuckAfter(a, ['1,2,3'], { now: 1, by: 'A' }).cells, { now: 1 })
    PJm.stuckWrite(dir, 'k', 'B', R.stuckAfter(b, ['1,2,3'], { now: 2, by: 'B' }).cells, { now: 2 })
    assert.strictEqual(PJm.stuckRead(dir, 'k')['1,2,3']?.visits, 2, 'no lost update')
    assert.strictEqual(PJm.stuckRead(dir, 'k', { exclude: 'A' })['1,2,3']?.visits, 1, 'exclude leaves the other holder')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
await t('the interleaved race: A reads, B reads, A writes, B writes -> 2 visits, none lost', () => race(PJ))
await t('MUTANT one shared file for every holder: the interleaved race loses an increment', async () => {
  await race(PJ)
  let why = null
  await withProjMutant("const stuckFile = (dir, key, holder) => path.join(dir, `${key}.stuck.${String(holder).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)",
    "const stuckFile = (dir, key, holder) => path.join(dir, `${key}.stuck.shared.json`)", async M => { try { await race(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived: ${why}`)
})

const unwritable = async Mod => {
  const srv = server(sealed()), pr = project(RECORD)
  // the holder's stuck file is a non-empty DIRECTORY: the rename into place fails, every time
  const f = `${pr.dir}/${pr.key}.stuck.A.json`
  fs.mkdirSync(f); fs.writeFileSync(`${f}/x`, '')
  const { r, e } = await visit(Mod, pr, srv)
  assert.strictEqual(r.stop, 'stuck_on_cell', `fails CLOSED, never cell_deferred forever (${r.stop})`)
  assert.ok(e.logs.some(([k, d]) => k === '_build' && d.op === 'stuck_unwritten'), 'a named stuck_unwritten row')
}
await t('a stuck map that cannot be written fails closed: stuck_on_cell with a named stuck_unwritten row', () => unwritable(R))
await t('MUTANT the write failure ignored: the visit says cell_deferred', () => bothA("    if (!ok) {", "    if (false) {", unwritable))


console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
