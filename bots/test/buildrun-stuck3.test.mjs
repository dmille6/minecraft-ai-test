// (part 3 of buildrun-stuck: an earth cell stalls the project, named; the age-out; the order's back-off read -- split for the 120 s budget)
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

console.log('AN EARTH CELL NO STAND REACHES STALLS THE PROJECT -- NAMED, NOT HIDDEN (Claude r22 P2-2)')
// the motivating field case: an earth (fill) cell; pad waits on earth and every other segment on pad
const E = [5, G + 1, 25]
const sealedE = () => Object.fromEntries([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(d => [k3(E.map((v, i) => v + d[i])), 'bedrock']))
const EARTH = { ...SITE.record,
  cells: [{ at: E, role: 'fill', seg: 'earth', stand: [E[0] - 1, G + 1, E[2]], support: [E[0], G, E[2]], face: [0, 1, 0], order: -1 }, ...SITE.record.cells],
  segments: [{ seg: 'earth', deps: [] }, ...SITE.record.segments.map(sg => sg.seg === 'pad' ? { ...sg, deps: ['earth'] } : sg)] }
const earthChain = async Mod => {
  const srv = server(sealedE()), pr = project(EARTH)
  const out = []
  let last = null
  for (let i = 0; i < R.STUCK_VISITS; i++) { last = await visit(Mod, pr, srv); out.push([last.r.stop, last.r.placed]) }
  assert.deepStrictEqual(out, [...Array(R.STUCK_VISITS - 1).fill(['cell_deferred', 0]), ['stuck_on_cell', 0]], `nothing can be built (${JSON.stringify(out)})`)
  const row = last.e.logs.find(([k, d]) => k === '_build' && d.op === 'stuck_on_cell')
  assert.ok(row && row[1].stalled === true, 'the row says STALLED: every open segment waits on the stuck cell')
  assert.strictEqual(row[1].waiting, EARTH.cells.length, 'and what it costs: every record cell waits on it')
  assert.match(last.r.why, /STALLED/)
  assert.ok(Number.isFinite(PJ.stuckAt(pr.dir, pr.key)), 'and the project backs off')
}
await t('a sealed EARTH cell: deferred (nothing placed), deferred, stuck_on_cell stalled=true -- the project stall is named', () => earthChain(R))
await t('MUTANT the stall flag dropped: the row does not say stalled', () => bothA(
  "...(stalled ? { stalled: true } : {}), ", "", earthChain))
await t('the extra-segment stuck: the rest built, only its own chain waits (waiting 2 of 169)', async () => {
  const srv = server(sealed()), pr = project(RECORD)
  let last = null
  for (let i = 0; i < R.STUCK_VISITS; i++) last = await visit(R, pr, srv)
  const row = last.e.logs.find(([k, d]) => k === '_build' && d.op === 'stuck_on_cell')
  assert.strictEqual(row?.[1].waiting, 2, `X and the segment waiting on it (${JSON.stringify(row?.[1])})`)
})

console.log('AGE-OUT, A FUTURE STAMP, THE LAZY READ (Claude r22 P3s)')
await t('a deferral older than STUCK_FORGET_MS (another holder\'s file) no longer counts: a fresh count', async () => {
  const srv = server(sealed()), pr = project(RECORD)
  const old = Date.now() - R.STUCK_FORGET_MS - 60_000
  assert.ok(PJ.stuckWrite(pr.dir, pr.key, 'Z', { [k3(X)]: { visits: 9, firstAt: old, lastAt: old, by: 'Z' } }, { now: old }))
  const { r } = await visit(R, pr, srv)
  assert.strictEqual(r.stop, 'cell_deferred', `the stale 9 visits do not count (${r.stop})`)
})
await t('buildOrder: a stuckAt more than a minute in the future is ignored; a function is read only past the cheap skips', () => {
  const base = { on: true, shared: true, atTown: true, holds: false, record: {}, planned: true, freeSlots: 30, state: {} }
  const now = 10 * 3600_000
  assert.ok(S.buildOrder({ ...base, now, stuckAt: now + 3600_000 }).order, 'a future stamp holds nothing')
  assert.strictEqual(S.buildOrder({ ...base, now, stuckAt: now + 30_000 }).skip, 'stuck_on_cell', 'within a minute: skew tolerated')
  let reads = 0
  const fn = () => { reads++; return now - 60_000 }
  assert.strictEqual(S.buildOrder({ ...base, now, stuckAt: fn }).skip, 'stuck_on_cell'); assert.strictEqual(reads, 1)
  S.buildOrder({ ...base, now, complete: true, stuckAt: fn }); S.buildOrder({ ...base, now, state: { lastAt: now - 1 }, stuckAt: fn })
  assert.strictEqual(reads, 1, 'complete / cooldown never read the stuck files')
})

await t('age-out per holder BEFORE the sum: stale B (9) + fresh C (1) + A now -> 2, not 11 (Codex r23 P2)', async () => {
  const srv = server(sealed()), pr = project(RECORD)
  const old = Date.now() - R.STUCK_FORGET_MS - 60_000, fresh = Date.now() - 60_000
  assert.ok(PJ.stuckWrite(pr.dir, pr.key, 'B', { [k3(X)]: { visits: 9, firstAt: old, lastAt: old, by: 'B' } }, { now: old }))
  assert.ok(PJ.stuckWrite(pr.dir, pr.key, 'C', { [k3(X)]: { visits: 1, firstAt: fresh, lastAt: fresh, by: 'C' } }, { now: fresh }))
  assert.strictEqual(PJ.stuckRead(pr.dir, pr.key, { since: Date.now() - R.STUCK_FORGET_MS })[k3(X)].visits, 1, 'only C counts')
  const { r } = await visit(R, pr, srv)
  assert.strictEqual(r.stop, 'cell_deferred', `C's 1 + A's 1 = 2 < 3 (${r.stop})`)
})
await t('a FUTURE stamp beside a valid one: the valid one still backs the project off (Codex r23 P2)', () => {
  const pr = project(RECORD), now = Date.now()
  assert.ok(PJ.stuckWrite(pr.dir, pr.key, 'A', {}, { now, stuckAt: now + 10 * 3600_000 }))
  assert.ok(PJ.stuckWrite(pr.dir, pr.key, 'B', {}, { now, stuckAt: now - 60_000 }))
  assert.strictEqual(PJ.stuckAt(pr.dir, pr.key, { before: now + 60_000 }), now - 60_000)
  const base = { on: true, shared: true, atTown: true, holds: false, record: {}, planned: true, freeSlots: 30, state: {} }
  assert.strictEqual(S.buildOrder({ ...base, now, stuckAt: n => PJ.stuckAt(pr.dir, pr.key, { before: n + 60_000 }) }).skip, 'stuck_on_cell')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
