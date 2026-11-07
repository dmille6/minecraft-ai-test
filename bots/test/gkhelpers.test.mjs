// GKHELPERS-01: THE GROUNDS CREW, THE STOREHOUSE FLOOR AND THE PARK GATHER (owner 11-03 "i agree to all those things, do it"; ledger
// gkhelpers-1103 / parkgather-1103). Behaviour on buildfake's flat world (stone below G, grass at G) and hand-built grounds; the
// crew's two bots run runVisit AT ONCE on one record; structural assertions only for wiring.
import assert from 'node:assert'
import fs, { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { G, HOME, server, bot, PJ, R } = await import('./helpers/buildfake.mjs')
const GK = await import('../src/groundskeeper.mjs')
const PK = await import('../src/park.mjs')
const TR = await import('../src/terrace.mjs')
const T = await import('../src/tidy.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const BUILDRUN_PATH = new URL('../src/buildrun.mjs', import.meta.url)
const GK_PATH = new URL('../src/groundskeeper.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
/** A mutant of `p` (its anchor present and unique: CLAUDE.md), imported from the test directory. */
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const L = (holder, { at = 0, until = Infinity, released = false } = {}) => ({ gen: 1, rec: { holder, at, until }, released, holdsUntil: released ? 0 : until, blocksUntil: released ? 0 : until + 60_000 })

console.log('THE HELPER DECISION (groundskeeper.mjs helperDecision)')
await t('a keeper is never its own helper; my live helper lease is mine; no keeper -> no helper', async () => {
  const now = 1000
  assert.deepStrictEqual(GK.helperDecision({ keeper: L('K', { until: 5000 }), helpers: {}, me: 'K', now }), { d: 'keeper', name: null })
  assert.deepStrictEqual(GK.helperDecision({ keeper: L('K', { until: 5000 }), helpers: { helper2: L('H', { until: 5000 }) }, me: 'H', now }), { d: 'mine', name: 'helper2' })
  assert.strictEqual(GK.helperDecision({ keeper: null, helpers: {}, me: 'H', now }).d, 'no_keeper')
  assert.strictEqual(GK.helperDecision({ keeper: L('K', { until: 500 }), helpers: {}, me: 'H', now }).d, 'no_keeper', 'a lapsed keeper is no keeper')
})
await t('take the first free helper lease; two others on both -> full; an unreadable one reads held (never a third helper)', async () => {
  const now = 1000, keeper = L('K', { until: 9000 })
  assert.deepStrictEqual(GK.helperDecision({ keeper, helpers: {}, me: 'H', now }), { d: 'take', name: 'helper1' })
  assert.deepStrictEqual(GK.helperDecision({ keeper, helpers: { helper1: L('A', { until: 9000 }) }, me: 'H', now }), { d: 'take', name: 'helper2' })
  assert.strictEqual(GK.helperDecision({ keeper, helpers: { helper1: L('A', { until: 9000 }), helper2: L('B', { until: 9000 }) }, me: 'H', now }).d, 'full')
  const torn = { gen: 3, rec: null, released: false, holdsUntil: 0, blocksUntil: Infinity }
  assert.strictEqual(GK.helperDecision({ keeper, helpers: { helper1: torn, helper2: L('B', { until: 9000 }) }, me: 'H', now }).d, 'full')
  // a lapsed lease inside its reclaim still blocks; past it, free
  assert.strictEqual(GK.helperDecision({ keeper, helpers: { helper1: L('A', { until: 900 }), helper2: L('B', { until: 9000 }) }, me: 'H', now }).d, 'full')
  assert.deepStrictEqual(GK.helperDecision({ keeper: L('K', { until: 1e9 }), helpers: { helper1: L('A', { until: 900 }), helper2: L('B', { until: 1e9 }) }, me: 'H', now: 70_000 }), { d: 'take', name: 'helper1' })
})
await t('no work, or resting from a released term -> none; the cap is GK.helpersMax', async () => {
  const keeper = L('K', { until: 9000 })
  assert.strictEqual(GK.helperDecision({ keeper, helpers: {}, me: 'H', now: 1000, work: false }).d, 'none')
  assert.strictEqual(GK.helperDecision({ keeper, helpers: {}, me: 'H', now: 1000, restUntil: 2000 }).d, 'none')
  assert.strictEqual(GK.helperDecision({ keeper, helpers: { helper1: L('A', { until: 9000 }) }, me: 'H', now: 1000, G: { ...GK.GK, helpersMax: 1 } }).d, 'full')
  assert.strictEqual(GK.GK.helpersMax, 2, 'the owner\'s cap: 1-2 helpers')
})
await t('the order: a helper sees the tidy free in its own (last) place; another bot sees it full; the keeper first', async () => {
  const list = [{ plot: 'shop' }, { plot: 'house1' }, { plot: 'tidy' }]
  const states = [{ plot: 'shop', exists: true, complete: true }, { plot: 'house1', exists: true, complete: true }, { plot: 'tidy', exists: true, complete: false, free: true }]
  const h = GK.keeperOrderPure(states, list, { d: 'helper' })
  assert.deepStrictEqual(h.order.map(p => p.plot), ['shop', 'house1', 'tidy'])
  assert.strictEqual(h.states[2].free, true)
  assert.strictEqual(GK.keeperOrderPure(states, list, { d: 'other' }).states[2].free, false)
  assert.strictEqual(GK.keeperOrderPure(states, list, { d: 'mine' }).order[0].plot, 'tidy')
})
await t('crewCaps: the keeper keeps the plan (site, complete, waive, digs, top-ups); a helper fills and gathers', async () => {
  const k = GK.crewCaps('keeper'), h = GK.crewCaps('helper')
  assert.deepStrictEqual([k.site, k.complete, k.waive, k.digs, k.topup, k.gather], [true, true, true, true, true, true])
  assert.deepStrictEqual([h.site, h.complete, h.waive, h.digs, h.topup, h.gather], [false, false, false, false, false, true])
  const hr = GK.helperRecord({ cells: [{ at: [1, 1, 1], seg: 'a' }, { at: [2, 1, 1], seg: 'T-PREV', prev: true }], clear: [{ at: [3, 3, 3] }], replant: [{ cell: [4, 4, 4] }] })
  assert.deepStrictEqual([hr.cells.length, hr.clear.length, hr.replant.length], [1, 0, 0], 'a helper\'s record: no digs, no prev cells')
})

console.log('DISJOINT SEGMENTS (groundskeeper.mjs segColumns / segsConflict / crewSegOk / crewYield)')
const segRec = () => ({
  cells: [
    ...[10, 11].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'A' })),
    ...[13, 14].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'B' })),   // 2 columns from A: too near
    ...[30, 31].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'C' })),
    ...[-20, -21].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'D' })),
    { at: [12, G + 1, 0], role: 'earth', seg: 'T-PREV', prev: true },
  ],
  segments: [{ seg: 'A', deps: [] }, { seg: 'B', deps: [] }, { seg: 'C', deps: [] }, { seg: 'D', deps: [] }],
  clear: [], cut: [], replant: [],
})
await t('two segments within GK.segGap columns conflict, farther ones do not; a prev cell is no segment', async () => {
  const cols = GK.segColumns(segRec())
  assert.ok(!cols.has('T-PREV'))
  assert.strictEqual(GK.segsConflict(cols, 'A', 'B'), true, '11 -> 13: 2 columns')
  assert.strictEqual(GK.segsConflict(cols, 'A', 'B', 1), false, 'control: the gap is what decides')
  assert.strictEqual(GK.segsConflict(cols, 'A', 'C'), false)
  assert.strictEqual(GK.crewSegOk({ cols, seg: 'B', me: 'H', live: { A: { holder: 'K', at: 1 } } }), false)
  assert.strictEqual(GK.crewSegOk({ cols, seg: 'C', me: 'H', live: { A: { holder: 'K', at: 1 } } }), true)
  assert.strictEqual(GK.crewSegOk({ cols, seg: 'B', me: 'K', live: { A: { holder: 'K', at: 1 } } }), true, 'my own lease never stops me')
})
await t('a raced take: any other bot\'s live conflicting segment after my take -> I yield, whatever its stamp (Codex r1 BLOCKER); far apart -> keep', async () => {
  const cols = GK.segColumns(segRec())
  assert.strictEqual(GK.crewYield({ cols, seg: 'B', me: 'H', live: { A: { holder: 'K', at: 10 }, B: { holder: 'H', at: 20 } } }), true)
  assert.strictEqual(GK.crewYield({ cols, seg: 'A', me: 'K', live: { A: { holder: 'K', at: 10 }, B: { holder: 'H', at: 5 } } }), true, 'an EARLIER stamp still yields: a stamp cannot order two writes')
  assert.strictEqual(GK.crewYield({ cols, seg: 'B', me: 'H', live: { A: { holder: '?', at: -Infinity } } }), true, 'a torn lease is someone\'s')
  assert.strictEqual(GK.crewYield({ cols, seg: 'C', me: 'H', live: { A: { holder: 'K', at: 10 } } }), false, 'control: far apart')
  assert.strictEqual(GK.crewYield({ cols, seg: 'B', me: 'H', live: { B: { holder: 'H', at: 20 } } }), false, 'only my own')
  // the interleaving Codex named: A checks (nothing), B checks (nothing), B writes, A writes, B re-checks after its write... each
  // re-check runs after its OWN write, so the second to re-check sees the first: never both keep
  const after = (me, seg, live) => GK.crewYield({ cols, seg, me, live })
  const both = { A: { holder: 'K', at: 100 }, B: { holder: 'H', at: 101 } }
  assert.ok(after('K', 'A', both) || after('H', 'B', both), 'whoever re-checks with both on disk yields')
  assert.strictEqual(after('H', 'B', { B: both.B }), false, 'the first to re-check (the other not yet written) keeps; the other then sees it')
  assert.strictEqual(after('K', 'A', both), true)
})
await t('liveLeases: the newest generation of each seg- lease, held now, in one listing (released and lapsed ones absent)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gkh-'))
  const key = PJ.projKey(HOME, 'tidy')
  const now = Date.now()
  const a = PJ.takeLease(dir, key, 'seg-T-00-0', 'K', { now })
  PJ.takeLease(dir, key, 'seg-T-01-0', 'H', { now, ttl: 10 })
  const c = PJ.takeLease(dir, key, 'seg-T-02-0', 'H', { now })
  PJ.releaseLease(dir, key, 'seg-T-02-0', 'H', c.gen)
  PJ.takeLease(dir, key, 'slot1', 'K', { now })
  const live = PJ.liveLeases(dir, key, 'seg-', now + 100)
  assert.deepStrictEqual(Object.keys(live), ['seg-T-00-0'])
  assert.strictEqual(live['seg-T-00-0'].holder, 'K'); assert.strictEqual(live['seg-T-00-0'].gen, a.gen)
  assert.deepStrictEqual(PJ.liveLeases(path.join(dir, 'nope'), key, 'seg-'), {}, 'no directory: no leases')
})

// ---- the crew's two bots on one record, AT ONCE (the composition: runVisit's segment leases + the crew rule) -------------------
const PAL = T.TIDY_PALETTE
/** Every pair of segment leases by different bots on conflicting segments whose held intervals overlap -> [pair]. */
function overlaps (dir, key, cols) {
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.seg-([^.]+)\\.lease\\.g(\\d+)\\.json$`)
  const ivs = []
  for (const n of fs.readdirSync(dir)) {
    const m = re.exec(n); if (!m) continue
    const rec = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
    let end = rec.until
    try { end = Number(fs.readFileSync(path.join(dir, `${n}.released`), 'utf8')) || end } catch { /* lapsed */ }
    ivs.push({ seg: m[1], holder: rec.holder, a: rec.at, b: end })
  }
  const bad = []
  for (const x of ivs) for (const y of ivs) if (x.holder < y.holder && GK.segsConflict(cols, x.seg, y.seg) && x.a < y.b && y.a < x.b) bad.push(`${x.holder}:${x.seg} ${y.holder}:${y.seg}`)
  return bad
}
function crewHooks (dir, key, me, cols, { okAlways = false } = {}) {
  const live = () => { const L0 = PJ.liveLeases(dir, key, 'seg-', Date.now()); if (!L0) return null; const o = {}; for (const [n, v] of Object.entries(L0)) if (n !== 'seg-clear') o[n.slice(4)] = v; return o }
  return {
    segOk: sg => { if (okAlways) return true; const L0 = live(); return !!L0 && GK.crewSegOk({ cols, seg: sg, me, live: L0 }) },
    segYield: sg => { const L0 = live(); return !L0 || GK.crewYield({ cols, seg: sg, me, live: L0 }) },
    skipOpenDeps: true,
  }
}
async function crewRun (Rm, { hooks = true } = {}) {
  const srv = server()
  const record = segRec()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gkh-run-'))
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const cols = GK.segColumns(record)
  const visit = (me, feet) => {
    const slot = PJ.takeSlot(dir, key, me, 3)
    // a slow server (each placement acked after 15 ms) so the two visits overlap in time
    const e = bot(srv, me, { inv: { cobblestone: 64 }, feet, ack: () => 15 })
    return Rm.runVisit({ dir, key, me, home: HOME, stood: [], record, recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 64, ...(hooks ? crewHooks(dir, key, me, cols) : {}) }, e, { maxSteps: 200 })
  }
  const [k, h] = await Promise.all([visit('K', [10, G + 1, 2]), visit('H', [12, G + 1, 2])])
  return { k, h, bad: overlaps(dir, key, cols), done: record.cells.filter(c => !c.prev).every(c => R.cellDone(srv.read(...c.at), PAL, c.role)) }
}
await t('COMPOSITION: keeper and helper at once fill the record with NO two conflicting segments held together (mutant: no segOk)', async () => {
  const r = await crewRun(R)
  assert.deepStrictEqual(r.bad, [], 'no overlapping neighbours')
  assert.ok(r.done, `every cell filled (K ${r.k.stop} ${r.k.placed}, H ${r.h.stop} ${r.h.placed})`)
  assert.ok(r.k.placed > 0 && r.h.placed > 0, `both bots worked (K ${r.k.placed}, H ${r.h.placed}): the helper is a second pair of hands`)
  // the control: the same run without the crew rule puts two bots on neighbouring segments at once
  const c = await crewRun(R, { hooks: false })
  assert.ok(c.bad.length > 0, 'control: without the crew rule two bots hold neighbouring segments together')
  // and the runner's own hook is what holds it (the anchored mutant)
  await withMutant(BUILDRUN_PATH, "    if (p.segOk && !p.segOk(seg)) { out.segsNear = (out.segsNear ?? 0) + 1; continue }\n", '', async M => {
    const m = await crewRun(M)
    assert.ok(m.bad.length > 0, 'the mutant (no segOk check) lets the helper onto the keeper\'s neighbour')
  })
})
await t('a raced take is given back: a segment whose neighbour another bot took FIRST is released unworked (mutant: no segYield)', async () => {
  const scenario = async Rm => {
    const srv = server()
    const record = segRec()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gkh-yield-'))
    const key = PJ.projKey(HOME, 'tidy')
    const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
    const cols = GK.segColumns(record)
    PJ.takeLease(dir, key, 'seg-B', 'X', { now: Date.now() - 5000 })       // X took B first (and never works it here)
    const slot = PJ.takeSlot(dir, key, 'H', 3)
    const e = bot(srv, 'H', { inv: { cobblestone: 64 }, feet: [10, G + 1, 2] })
    // the race: H's own check passed before X's lease was seen (okAlways); only the after-take test can save it
    const r = await Rm.runVisit({ dir, key, me: 'H', home: HOME, stood: [], record, recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 64, ...crewHooks(dir, key, 'H', cols, { okAlways: true }) }, e, { maxSteps: 200 })
    const inA = record.cells.filter(c => c.seg === 'A').some(c => R.cellDone(srv.read(...c.at), PAL, c.role))
    return { r, inA, inC: record.cells.filter(c => c.seg === 'C').every(c => R.cellDone(srv.read(...c.at), PAL, c.role)) }
  }
  const ok = await scenario(R)
  assert.strictEqual(ok.inA, false, 'A (beside X\'s B) is never worked')
  assert.strictEqual(ok.inC, true, 'the visit went on to C')
  await withMutant(BUILDRUN_PATH, "    if (p.segYield && p.segYield(seg, lease.gen)) { PJ.releaseLease(dir, key, `seg-${seg}`, me, lease.gen); out.segsNear = (out.segsNear ?? 0) + 1; continue }\n", '', async M => {
    const m = await scenario(M)
    assert.strictEqual(m.inA, true, 'the mutant works A beside X\'s B')
  })
})
await t('skipOpenDeps: a segment whose layer below is another bot\'s is passed and the next independent one worked (mutant: deps_open)', async () => {
  const scenario = async (Rm, skip = true) => {
    const srv = server()
    const record = {
      cells: [{ at: [10, G + 1, 0], role: 'earth', seg: 'A0' }, { at: [10, G + 2, 0], role: 'earth', seg: 'A1' }, { at: [30, G + 1, 0], role: 'earth', seg: 'C' }],
      segments: [{ seg: 'A0', deps: [] }, { seg: 'A1', deps: ['A0'] }, { seg: 'C', deps: [] }], clear: [], cut: [], replant: [],
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gkh-deps-'))
    const key = PJ.projKey(HOME, 'tidy')
    const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
    PJ.takeLease(dir, key, 'seg-A0', 'K', { now: Date.now() })
    const slot = PJ.takeSlot(dir, key, 'H', 3)
    const e = bot(srv, 'H', { inv: { cobblestone: 64 }, feet: [28, G + 1, 2] })
    const r = await Rm.runVisit({ dir, key, me: 'H', home: HOME, stood: [], record, recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 64, skipOpenDeps: skip }, e, { maxSteps: 100 })
    return { r, c: R.cellDone(srv.read(30, G + 1, 0), PAL, 'earth') }
  }
  const a = await scenario(R)
  assert.strictEqual(a.c, true, 'C worked'); assert.strictEqual(a.r.stop, 'deps_open', 'and the visit names what it passed')
  const ctl = await scenario(R, false)
  assert.strictEqual(ctl.c, false, 'control: without the option the visit stops at A1'); assert.strictEqual(ctl.r.stop, 'deps_open')
  await withMutant(BUILDRUN_PATH, "      if (p.skipOpenDeps) { out.depsWaited = (out.depsWaited ?? 0) + 1; continue }\n", '', async M => {
    assert.strictEqual((await scenario(M)).c, false, 'the mutant stops at the open layer')
  })
})
await t('workableSeg with skipOpenDeps names the independent segment (the bill is drawn for it); without, null', async () => {
  const srv = server()
  const record = { cells: [{ at: [10, G + 1, 0], role: 'earth', seg: 'A0' }, { at: [10, G + 2, 0], role: 'earth', seg: 'A1' }, { at: [30, G + 1, 0], role: 'earth', seg: 'C' }], segments: [{ seg: 'A0', deps: [] }, { seg: 'A1', deps: ['A0'] }, { seg: 'C', deps: [] }] }
  assert.strictEqual(R.workableSeg(record, srv.read, PAL, s => s !== 'A0'), null)
  assert.strictEqual(R.workableSeg(record, srv.read, PAL, s => s !== 'A0', null, { skipOpenDeps: true }), 'C')
})

console.log('THE STOREHOUSE FLOOR FIRST (groundskeeper.mjs storeFloorHoles / withFloorFix / floorOpen)')
// the LIVE showcase storehouse's shape (11-03): floor 70, baseY 71, stands at 71/72, the door, two approach columns
const STORE = () => ({ floor: G, baseY: G + 1, inside: [[-9, G + 1, 2], [-9, G + 2, 2], [-10, G + 1, 2], [-10, G + 2, 2], [-10, G + 1, 1]], door: [-10, G + 1, 3], frontOpen: [[-10, 4], [-9, 4]], structure_complete: true })
await t('the holes under the chests\' stands, the door and the approach are found, deepest first, down to the first solid block', async () => {
  const srv = server()
  // the 13:00Z dig: up through the approach (-10,4: 3 deep), the door (-10,3: 2 deep) and a stand (-10,2: 1 deep)
  for (const y of [G - 2, G - 1, G]) srv.set([-10, y, 4], 'air')
  for (const y of [G - 1, G]) srv.set([-10, y, 3], 'air')
  srv.set([-10, G, 2], 'air')
  const h = GK.storeFloorHoles(STORE(), srv.read)
  const ks = h.cells.map(c => c.at.join(','))
  assert.deepStrictEqual(ks.slice().sort(), [`-10,${G - 2},4`, `-10,${G - 1},3`, `-10,${G - 1},4`, `-10,${G},2`, `-10,${G},3`, `-10,${G},4`].sort())
  assert.ok(!ks.some(k => k.endsWith(`,${G + 1},2`)), 'never a stand cell')
  assert.deepStrictEqual(h.segments, [{ seg: 'T-F0', deps: [] }, { seg: 'T-F1', deps: ['T-F0'] }, { seg: 'T-F2', deps: ['T-F1'] }], 'bottom layer first')
  assert.ok(h.cells.every(c => c.floorFix && c.role === 'earth'))
  assert.strictEqual(h.cells.find(c => c.at[1] === G).seg, 'T-F2', 'the floor goes in last')
  assert.deepStrictEqual(GK.storeFloorHoles(STORE(), server().read).cells, [], 'control: an intact floor has no holes')
  assert.deepStrictEqual(GK.storeFloorHoles({ ...STORE(), floor: undefined }, srv.read).cells, [], 'a record without a floor: none')
})
await t('a water-filled hole is a hole; an unread column is left for a later visit; depth is bounded', async () => {
  const srv = server()
  srv.set([-9, G, 4], 'water'); srv.set([-9, G - 1, 4], 'water')
  srv.set([-10, G, 4], 'air')
  const read = (x, y, z) => (x === -10 && z === 4 && y < G ? null : srv.read(x, y, z))
  const h = GK.storeFloorHoles(STORE(), read)
  assert.deepStrictEqual(h.cells.map(c => c.at.join(',')).sort(), [`-9,${G - 1},4`, `-9,${G},4`].sort())
  const deep = server(); for (let y = G - 10; y <= G; y++) deep.set([-9, y, 4], 'air')
  assert.strictEqual(GK.storeFloorHoles(STORE(), deep.read).cells.length, GK.FLOOR_DEPTH + 1)
})
await t('withFloorFix: the holes join the record FIRST, once, renumbered after earlier repairs; the record reopens; floorOpen lists them', async () => {
  const srv = server(); srv.set([-10, G, 3], 'air'); srv.set([-10, G - 1, 3], 'air')
  const holes = GK.storeFloorHoles(STORE(), srv.read)
  const rec = { cells: [{ at: [5, G + 1, 5], role: 'earth', seg: 'T-00-0' }], segments: [{ seg: 'T-00-0', deps: [] }], structure_complete: true, state: 'complete' }
  const r1 = GK.withFloorFix(rec, holes, 7)
  assert.deepStrictEqual(r1.segments.map(s => s.seg), ['T-F0', 'T-F1', 'T-00-0'])
  assert.strictEqual(r1.structure_complete, false); assert.strictEqual(r1.floorFixAt, 7)
  assert.strictEqual(GK.withFloorFix(r1, holes), null, 'a hole already on the record is not added twice')
  srv.set([-9, G, 2], 'air')
  const r2 = GK.withFloorFix(r1, GK.storeFloorHoles(STORE(), srv.read))
  assert.deepStrictEqual(r2.segments.slice(0, 1), [{ seg: 'T-F3', deps: [] }], 'a later repair numbers on past the record\'s T-F0/T-F1 (its one new hole waits on no layer: the one below it is not new)')
  assert.deepStrictEqual(GK.floorOpen(r2, c => c.at[1] === G - 1).map(c => c.at.join(',')).sort(), [`-10,${G},3`, `-9,${G},2`].sort())
})
await t('the floor holes are worked bottom-up by runVisit in a floor-only visit (each layer waits on the one below)', async () => {
  const srv = server(); for (const y of [G - 2, G - 1, G]) srv.set([-10, y, 4], 'air')
  const holes = GK.storeFloorHoles(STORE(), srv.read)
  const record = GK.withFloorFix({ cells: [{ at: [20, G + 1, 0], role: 'earth', seg: 'T-00-0' }], segments: [{ seg: 'T-00-0', deps: [] }], clear: [], cut: [], replant: [] }, holes)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gkh-floor-'))
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slot = PJ.takeSlot(dir, key, 'K', 3)
  const e = bot(srv, 'K', { inv: { cobblestone: 64 }, feet: [-12, G + 1, 4] })
  const order = []
  const log0 = e.log
  e.log = (k, d) => { if (k === '_build' && d.op === 'place') order.push(d.cell[1]); log0(k, d) }
  const floorRec = { ...record, cells: record.cells.filter(c => c.floorFix), segments: record.segments.filter(s => /^T-F/.test(s.seg)) }
  await R.runVisit({ dir, key, me: 'K', home: HOME, stood: [], record: floorRec, recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 64, intoWater: true }, e, { maxSteps: 100 })
  assert.deepStrictEqual(order, [G - 2, G - 1, G], 'bottom-up')
  assert.ok(R.cellDone(srv.read(-10, G, 4), PAL, 'earth'), 'the floor is back')
  assert.ok(!R.cellDone(srv.read(20, G + 1, 0), PAL, 'earth'), 'the floor-only visit did nothing else')
})

console.log('THE PARK GATHER (park.mjs gatherKind / parkWant / gatherTargets / gatherStand / pantrySum / parkHeldByCrew)')
await t('what may be gathered: flowers, tall flowers, azalea, cane and bamboo above the root, leaves (shears); never berries, cactus, vines, crops, saplings', async () => {
  for (const n of ['poppy', 'cornflower', 'rose_bush', 'azalea', 'sugar_cane', 'bamboo', 'oak_leaves']) assert.ok(PK.gatherKind(n), n)
  for (const n of ['sweet_berry_bush', 'cactus', 'vine', 'wheat', 'carrots', 'oak_sapling', 'oak_log', 'short_grass', 'torchflower']) assert.strictEqual(PK.gatherKind(n), null, n)
  assert.ok(!PK.GATHER_NAMES.some(n => /berry|cactus|vine/.test(n)))
})
const LIVE_PARK = { box: [-41, 24, -34, 32], kinds: { q0: 'meadow' }, placed: { meadow: 4 }, skipped: { flowers: 'no_flowers', tall_flowers: 'no_tall_flowers', azalea: 'no_azalea', trees: 'no_sapling', bamboo: 'no_bamboo', crops: 'no_seeds', cane: 'no_sugar_cane', lily_pads: 'no_actuator', hedge: 'no_leaves' } }
await t('parkWant on the LIVE showcase park: every material-skipped element up to its cap, less what the town and the crew hold', async () => {
  const w = PK.parkWant(LIVE_PARK, { spruce_sapling: 16, azalea: 1 })
  assert.deepStrictEqual(w, { azalea: 7, bamboo: 9, cane: 6, hedge: 24 }, 'trees: 16 saplings already beat the cap of 4; flowers never gathered (owner 11-04)')
  assert.deepStrictEqual(PK.parkWant({ ...LIVE_PARK, skipped: { flowers: 'no_room', cane: 'no_water' } }, {}), {}, 'a skip for room or water is no want')
  assert.strictEqual(PK.parkWant({ ...LIVE_PARK, placed: { flowers: 3 } }, {}).flowers, undefined, 'a placed element is no want')
})
await t('gatherTargets: nearest first, a cane taken above its root, a tall flower at its lower half, reserved columns and caps kept', async () => {
  const srv = server()
  srv.set([5, G + 1, 0], 'poppy'); srv.set([6, G + 1, 0], 'dandelion'); srv.set([40, G + 1, 0], 'poppy')
  for (const y of [G + 1, G + 2, G + 3]) srv.set([8, y, 3], 'sugar_cane')
  srv.set([9, G + 1, 9], 'sugar_cane')                                                    // a lone root: left
  srv.set([12, G + 1, 0], 'lilac'); srv.set([12, G + 2, 0], 'lilac')
  srv.set([-5, G + 1, 0], 'poppy')                                                       // in a reserved column
  srv.set([7, G + 1, 7], 'sweet_berry_bush')
  const cands = [[5, G + 1, 0, 'poppy'], [6, G + 1, 0, 'dandelion'], [40, G + 1, 0, 'poppy'], [8, G + 3, 3, 'sugar_cane'], [9, G + 1, 9, 'sugar_cane'], [12, G + 2, 0, 'lilac'], [-5, G + 1, 0, 'poppy'], [7, G + 1, 7, 'sweet_berry_bush']].map(([x, y, z, name]) => ({ at: [x, y, z], name }))
  const ts = PK.gatherTargets(cands, { read: srv.read, reserved: (x) => (x === -5 ? 'zone' : null), home: HOME, r: 32, from: [0, G + 1, 0], want: { flowers: 2, cane: 6, tall_flowers: 1 }, max: 12 })
  const at = ts.map(q => `${q.name}@${q.at.join(',')}`)
  assert.deepStrictEqual(at, [`poppy@5,${G + 1},0`, `dandelion@6,${G + 1},0`, `sugar_cane@8,${G + 2},3`, `lilac@12,${G + 1},0`])
  assert.strictEqual(ts[2].n, 2, 'the two canes above the root come with it')
  // the cap per element: one flower wanted -> one
  assert.strictEqual(PK.gatherTargets(cands, { read: srv.read, home: HOME, r: 32, from: [0, G + 1, 0], want: { flowers: 1 } }).length, 1)
  // a reserved cell ABOVE the cut (the cane's top in a zone) refuses the whole column
  assert.strictEqual(PK.gatherTargets(cands, { read: srv.read, reserved: (x, y) => (x === 8 && y === G + 3 ? 'zone' : null), home: HOME, r: 32, want: { cane: 6 } }).length, 0)
  // leaves only with shears
  srv.set([3, G + 2, 3], 'oak_leaves')
  const lv = [{ at: [3, G + 2, 3], name: 'oak_leaves' }]
  assert.strictEqual(PK.gatherTargets(lv, { read: srv.read, home: HOME, want: { hedge: 4 } }).length, 0)
  assert.strictEqual(PK.gatherTargets(lv, { read: srv.read, home: HOME, want: { hedge: 4 }, shears: true }).length, 1)
})
await t('gatherStand: a flower in its own cell; a cane beside its root; nothing with no floor', async () => {
  const srv = server()
  assert.deepStrictEqual(PK.gatherStand(srv.read, { at: [5, G + 1, 0], el: 'flowers' }), [5, G + 1, 0])
  assert.deepStrictEqual(PK.gatherStand(srv.read, { at: [8, G + 2, 3], el: 'cane' }), [9, G + 1, 3])
  const hole = server(); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) hole.set([8 + dx, G, 3 + dz], 'air')
  assert.strictEqual(PK.gatherStand(hole.read, { at: [8, G + 1, 3], el: 'azalea' }), null)
})
await t('the crew pantry: fresh pantries of live crew bots summed (never mine, never stale, never a non-park item); the files round-trip', async () => {
  const p = { K: { at: 100, items: { poppy: 3 } }, H: { at: 100, items: { poppy: 2, cobblestone: 64, bamboo: 5 } }, Old: { at: -1e9, items: { poppy: 9 } }, Gone: { at: 100, items: { poppy: 9 } } }
  assert.deepStrictEqual(PK.pantrySum(p, { now: 200, fresh: 1000, live: h => h !== 'Gone', me: 'K' }), { poppy: 2, bamboo: 5 })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gkh-pantry-'))
  const key = PJ.projKey(HOME, 'tidy')
  assert.ok(PJ.pantryWrite(dir, key, 'showcase-Iris', PK.parkItemsOf({ poppy: 4, cobblestone: 12 }), { now: 5 }))
  assert.deepStrictEqual(PJ.pantryRead(dir, key), { 'showcase-Iris': { at: 5, items: { poppy: 4 } } })
})
await t('parkHeldByCrew: an open planting skipped for want of material while a crew bot carries it holds the completion', async () => {
  const rec = { cells: [{ at: [1, G + 1, 1], role: 'flower0', seg: 'T-PU0-P' }, { at: [2, G + 1, 1], role: 'shrub', seg: 'T-PU0-P' }, { at: [3, G + 1, 1], role: 'flower1', seg: 'X', prev: true }] }
  const skip = c => (c.role.startsWith('flower') ? 'no_flowers' : 'no_azalea')
  assert.strictEqual(PK.parkHeldByCrew(rec, { skip, others: { poppy: 2 } }).length, 1)
  assert.strictEqual(PK.parkHeldByCrew(rec, { skip, others: {} }).length, 0, 'nobody carries it: the stage may close over it')
  assert.strictEqual(PK.parkHeldByCrew(rec, { skip: () => 'occupied', others: { poppy: 2 } }).length, 0, 'another skip reason never holds it')
})

console.log('THE PARK TOPPED UP (terrace.mjs parkTopUp)')
await t('the LIVE meadow-only park gets flowers and a tree in its own box, never on a taken column; nothing new -> null', async () => {
  const srv = server()
  const park = { box: [10, 10, 20, 20], seed: 252649055, kinds: { q0: 'meadow', q1: 'meadow', q2: 'meadow', q3: 'meadow' }, placed: { meadow: 4 }, skipped: { ...LIVE_PARK.skipped } }
  const taken = new Set(['12,12', '14,12'])
  const t1 = TR.parkTopUp(srv.read, { park, have: { poppy: 10, oak_sapling: 2, cobblestone: 64 }, taken: (x, z) => taken.has(`${x},${z}`), segN: 0, y0: G - 8, y1: G + 8 })
  assert.ok(t1, 'a top-up')
  assert.ok(t1.cells.every(c => c.at[0] >= 10 && c.at[0] <= 20 && c.at[2] >= 10 && c.at[2] <= 20), 'inside the box')
  assert.ok(!t1.cells.some(c => taken.has(`${c.at[0]},${c.at[2]}`)), 'never a taken column')
  assert.ok(t1.cells.every(c => c.at[1] === G + 1), 'planted on the ground')
  const els = new Set(t1.cells.map(c => c.el))
  assert.ok(els.has('flowers') && els.has('trees'), [...els].join(','))
  assert.ok(t1.cells.filter(c => c.el === 'flowers').length <= 10, 'never more flowers than the town holds')
  assert.deepStrictEqual(t1.segments.map(s => s.seg), ['T-PU0-P'])
  assert.ok(!t1.park.skipped.flowers && !t1.park.skipped.trees && t1.park.skipped.bamboo, 'the skips follow')
  assert.strictEqual(t1.park.trees.length, 1, 'the park tree is kept (never felled by a later stage)')
  assert.strictEqual(TR.parkTopUp(srv.read, { park: t1.park, have: { poppy: 10, oak_sapling: 2 }, segN: 1, y0: G - 8, y1: G + 8 }), null, 'placed elements are not added again')
  assert.strictEqual(TR.parkTopUp(srv.read, { park, have: { poppy: 3 }, y0: G - 8, y1: G + 8 }), null, 'below TOPUP_MIN: nothing')
  assert.strictEqual(TR.parkTopUp(srv.read, { park: { box: null }, have: { poppy: 30 } }), null)
  // sugar cane held but no water in the box: the flowers go in, the cane keeps the layout's reason (no_water: no more gathering it)
  const t2 = TR.parkTopUp(srv.read, { park, have: { poppy: 10, sugar_cane: 6 }, segN: 0, y0: G - 8, y1: G + 8 })
  assert.ok(t2.cells.some(c => c.el === 'flowers') && !t2.cells.some(c => c.el === 'cane'))
  assert.strictEqual(t2.park.skipped.cane, 'no_water')
  assert.strictEqual(PK.parkWant(t2.park, {}).cane, undefined, 'the crew stops gathering cane the park cannot use')
})

console.log('GKSTAGE-01: THE LOGGED RECORD (LIVE showcase tidy gen 20, 11-04: 326 visits, 0 placed)')
const G20 = JSON.parse(readFileSync(new URL('./fixtures/gkstage-tidy-g20-20261104.json', import.meta.url), 'utf8'))
// the world as the rows say: the floor's five upper holes filled, the waived bottom one (-10,68,3, under the filled -10,69,3) air;
// the roads stage's open fills air
const g20read = () => {
  const done = new Set(G20.cells.filter(c => c.floorFix && c.at.join(',') !== '-10,68,3').map(c => c.at.join(',')))
  return (x, y, z) => ({ name: done.has(`${x},${y},${z}`) ? 'cobblestone' : 'air', boundingBox: done.has(`${x},${y},${z}`) ? 'block' : 'empty' })
}
const g20waived = q => !!q.prev || Object.prototype.hasOwnProperty.call(G20.waived ?? {}, q.at.join(','))
await t('the logged record: a WAIVED floor hole is no open hole -- the visit works the roads stage, not the floor (control: the old test)', async () => {
  assert.strictEqual(G20.stageId, 'roads'); assert.deepStrictEqual(Object.keys(G20.waived), ['-10,68,3'])
  const rd = g20read()
  const doneNow = q => g20waived(q) || R.cellDone(rd(...q.at), PAL, q.role)
  const v = GK.floorView(G20, doneNow)
  assert.strictEqual(v.floorOnly, false, 'no open hole')
  assert.strictEqual(v.visitRec, G20, 'the whole record is the visit\'s')
  const seg = R.workableSeg(v.visitRec, rd, PAL, () => true, doneNow, { skipOpenDeps: true })
  assert.ok(seg && !/^T-F/.test(seg), `a roads segment is workable (${seg})`)
  // the bug as it ran: the block-only test kept the waived hole open and the visit floor-only, where runVisit read it done
  const old = GK.floorView(G20, q => R.cellDone(rd(...q.at), PAL, q.role))
  assert.strictEqual(old.floorOnly, true)
  assert.ok(old.visitRec.cells.every(c => c.floorFix) && old.visitRec.cells.every(doneNow), 'control: every cell of the old floor-only view reads done to the visit -> `complete`, nothing placed')
  assert.strictEqual(R.workableSeg(old.visitRec, rd, PAL, () => true, doneNow, { skipOpenDeps: true }), null, 'control: nothing to work in it')
})
await t('the logged record: an open, unwaived floor hole still makes the visit floor-first', async () => {
  const rd0 = g20read()
  const rd = (x, y, z) => (x === -10 && y === 70 && z === 3 ? { name: 'air', boundingBox: 'empty' } : rd0(x, y, z))
  const v = GK.floorView(G20, q => g20waived(q) || R.cellDone(rd(...q.at), PAL, q.role))
  assert.strictEqual(v.floorOnly, true); assert.deepStrictEqual(v.floorNow.map(c => c.at.join(',')), ['-10,70,3'])
})
await t('spareOf: the pantry names only what the bag spares above its keeps; the gather never seeks flowers (owner: a park without flowers)', async () => {
  assert.deepStrictEqual(PK.spareOf({ azalea: 2, bamboo: 10, poppy: 1 }, { azalea: 2, bamboo: 4 }), { bamboo: 6, poppy: 1 })
  const w = PK.parkWant(LIVE_PARK, {})
  assert.strictEqual(w.flowers, undefined); assert.strictEqual(w.tall_flowers, undefined)
  assert.ok(w.hedge > 0 && w.bamboo > 0, 'the rest still wanted')
})

console.log('GKSTAGE-01: INSIDE THE WALL (tidy.mjs surveyInwall) AND THE CYCLE (landplan.mjs nextStageCycle)')
const LPm = await import('../src/landplan.mjs')
const IW = (srv, { avoid = () => null, cells = new Set(), box = [-10, -10, 10, 10] } = {}) => T.surveyInwall(srv.read, { home: HOME, box, avoid, cells })
await t('stray blocks: a 1-high dirt step and a 3-high pillar on open ground go, top first; a record cell or a natural block never', async () => {
  const srv = server()
  srv.set([2, G + 1, 2], 'dirt')                                            // a 1-high step (tidy-01 leaves it: pillarMin 2)
  for (const y of [G + 1, G + 2, G + 3]) srv.set([5, y, 5], 'cobblestone')  // a pillar
  srv.set([-4, G + 1, -4], 'stone')                                         // natural: no SPOIL
  srv.set([-6, G + 1, 6], 'dirt')                                           // a record cell (another project's)
  const s = IW(srv, { cells: new Set([`-6,${G + 1},6`]) })
  const ks = s.cut.map(c => c.at.join(','))
  assert.ok(ks.includes(`2,${G + 1},2`), 'the 1-high step')
  assert.deepStrictEqual(ks.filter(k => k.startsWith('5,')), [`5,${G + 3},5`, `5,${G + 2},5`, `5,${G + 1},5`], 'top first')
  assert.ok(!ks.includes(`-4,${G + 1},-4`) && !ks.includes(`-6,${G + 1},6`), 'never natural, never a record cell')
  assert.strictEqual(s.skipped.stray_natural, 1); assert.strictEqual(s.skipped.stray_guarded, 1)
  const rec = T.tidyRecord(s, { home: HOME })
  assert.ok(rec && rec.cut.length === ks.length, 'tidyRecord takes it')
})
await t('holes: a 1-deep hole and a 3-deep one are filled to their lowest neighbour; a terrace step (a neighbour as low) is no hole', async () => {
  const srv = server()
  srv.set([3, G, 3], 'air')                                                 // 1 deep
  for (const y of [G - 2, G - 1, G]) srv.set([-3, y, 3], 'air')             // 3 deep
  // a terrace: the row z = -5 one lower along x -2..2 (every column has a neighbour as low as itself)
  for (let x = -2; x <= 2; x++) srv.set([x, G, -5], 'air')
  const s = IW(srv)
  const ks = s.fill.map(c => c.at.join(',')).sort()
  assert.deepStrictEqual(ks, [`-3,${G - 2},3`, `-3,${G - 1},3`, `-3,${G},3`, `3,${G},3`].sort())
  assert.ok(!ks.some(k => k.endsWith(',-5')), 'the lower terrace row is no hole')
  const deep = server(); for (let y = G - 6; y <= G; y++) deep.set([0, y, 0], 'air')
  assert.strictEqual(IW(deep).fill.length, 0); assert.strictEqual(IW(deep).skipped.hole_deep, 1)
})
await t('on a build: a dirt step on a roof, path or wall top goes (2 stacked); never on the yard, the tree farm, a zone, a well or a farm; never a record cell', async () => {
  const srv = server()
  // a "roof" record cell at G+4 over columns 1..3 (z 0); a dirt step on it; a 2-stack on another
  for (const x of [1, 2, 3]) srv.set([x, G + 4, 0], 'oak_planks')
  srv.set([1, G + 5, 0], 'dirt'); srv.set([3, G + 5, 0], 'cobblestone'); srv.set([3, G + 6, 0], 'dirt')
  const cells = new Set([1, 2, 3].map(x => `${x},${G + 4},0`))
  const proj = (x, z) => (z === 0 && x >= 1 && x <= 3 ? 'project:house1' : null)
  const s = IW(srv, { cells, avoid: proj })
  assert.deepStrictEqual(s.cut.map(c => c.at.join(',')), [`1,${G + 5},0`, `3,${G + 6},0`, `3,${G + 5},0`])
  assert.strictEqual(s.litter, 2)
  for (const why of ['project:yard', 'project:treefarm', 'zone', 'well', 'farm', 'treefarm']) assert.strictEqual(IW(srv, { cells, avoid: (x, z) => (z === 0 && x >= 1 && x <= 3 ? why : null) }).cut.length, 0, why)
  srv.set([2, G + 5, 0], 'dirt')
  assert.ok(!IW(srv, { cells: new Set([...cells, `2,${G + 5},0`]), avoid: proj }).cut.some(c => c.at[0] === 2), 'a record cell on a record cell is the build')
})
await t('beside a build: a 2-high dirt step against a wall goes; a grass bump there, a record column and a 4-high stack stay', async () => {
  const srv = server()
  for (let x = -2; x <= 2; x++) for (let y = G + 1; y <= G + 4; y++) srv.set([x, y, 0], 'stone_bricks')   // a wall z=0, 4 high
  const cells = new Set(); for (let x = -2; x <= 2; x++) for (let y = G + 1; y <= G + 4; y++) cells.add(`${x},${y},0`)
  srv.set([0, G + 1, 1], 'dirt'); srv.set([0, G + 2, 1], 'dirt')          // the climb against it
  srv.set([2, G + 1, 1], 'grass_block')                                    // a natural bump beside it
  for (let y = G + 1; y <= G + 4; y++) srv.set([-2, y, 1], 'dirt')         // 4 high: past INWALL.litterMax
  const avoid = (x, z) => (z >= -1 && z <= 1 && x >= -3 && x <= 3 ? 'project:wall' : null)
  // access-01: with the staircase off (its own test file builds the stair instead); the cut rule is the fallback
  const s = T.surveyInwall(srv.read, { home: HOME, box: [-5, -5, 5, 5], avoid, cells, T: { ...T.INWALL, access: false } })
  const ks = s.cut.map(c => c.at.join(','))
  assert.deepStrictEqual(ks.filter(k => k.endsWith(',1')), [`0,${G + 2},1`, `0,${G + 1},1`])
  assert.ok(!ks.some(k => k.endsWith(',0')), 'never the wall')
})
await t('Codex r1 BLOCKERS: the yard\'s piles are never litter even when the guard says only `project`; the bands keep their legacy numbers', async () => {
  const srv = server()
  for (const x of [1, 2, 3]) srv.set([x, G + 1, 0], 'cobblestone')            // the yard's floor (record cells)
  srv.set([2, G + 2, 0], 'cobblestone')                                       // a pile block on a floor slot (no record cell)
  const cells = new Set([1, 2, 3].map(x => `${x},${G + 1},0`))
  const yard = { plot: 'yard', cells: [1, 2, 3].map(x => ({ at: [x, G + 1, 0] })) }
  const avoid = (x, z) => (z === 0 && x >= 1 && x <= 3 ? 'project' : null)   // pathAvoid's word for a yard column
  assert.strictEqual(T.surveyInwall(srv.read, { home: HOME, box: [-5, -5, 5, 5], avoid, cells }).cut.length, 1, 'control: by the guard alone the pile reads as litter')
  assert.strictEqual(T.surveyInwall(srv.read, { home: HOME, box: [-5, -5, 5, 5], avoid, cells, noLitter: T.inwallNoLitter([yard]) }).cut.length, 0, 'the yard\'s box refuses it')
  // the land plan's siteStage hands the records' yard over
  const st = LPm.landStages().find(s => s.id === 'inwall')
  const s = T.siteStage(srv.read, { home: HOME, land: { seed: 1 }, stage: st, avoid, cells, terrace: { wall: { ring: [-6, -6, 6, 6] }, records: [yard] } })
  assert.ok(!s.record || !s.record.cut.some(c => c.at[0] === 2 && c.at[1] === G + 2), 'siteStage keeps the pile')
  const L = LPm.landStages(); const legacy = T.legacyStage
  assert.deepStrictEqual(L.map(q => [q.id, legacy(q)]).slice(0, 6).map(([i, n]) => `${i}:${n}`), ['town:0', 'terrace:0', 'roads:1', 'inwall:1', `${L[4].id}:2`, `${L[5].id}:3`], 'rim bands 2, 3, ... as before the insertion')
  for (const q of L) if (q.k) assert.strictEqual(LPm.recStageK({ stage: legacy(q), stageId: q.id, terraceV: 1 }), q.k, `${q.id} by its id`)
})
await t('the stage order: inside the wall right after the roads; the cycle wraps to it after the last band, once complete 30 min', async () => {
  const st = LPm.landStages()
  assert.deepStrictEqual(st.slice(0, 4).map(s => s.id), ['town', 'terrace', 'roads', 'inwall'])
  assert.strictEqual(LPm.nextStageCycle({ stageId: 'roads', terraceV: 1, structure_complete: true }).id, 'inwall', 'the LIVE showcase head (roads) goes inside next')
  const last = st.at(-1)
  const rec = { stageId: last.id, terraceV: 1, structure_complete: true, completeAt: 1000 }
  assert.strictEqual(LPm.nextStageCycle(rec, 1000 + 60_000), null, 'not yet')
  assert.strictEqual(LPm.nextStageCycle(rec, 1000 + LPm.LAND_CYCLE_MS).id, 'inwall', 'the cycle')
  assert.strictEqual(LPm.nextStageCycle({ ...rec, structure_complete: false }, 1e12), null)
})
await t('siteStage inwall on the wall\'s interior: a record with the stage id; nothing to do -> null record', async () => {
  const srv = server(); srv.set([2, G + 1, 2], 'dirt')
  const st = LPm.landStages().find(s => s.id === 'inwall')
  const s = T.siteStage(srv.read, { home: HOME, land: { seed: 1 }, stage: st, terrace: { wall: { ring: [-12, -12, 12, 12] } } })
  assert.ok(s.ok && s.record && s.record.stageId === 'inwall' && s.record.cut.length === 1, JSON.stringify(s.record?.inwall))
  assert.deepStrictEqual(s.record.inwall.box, [-11, -11, 11, 11])
  const n = T.siteStage(server().read, { home: HOME, land: { seed: 1 }, stage: st, terrace: { wall: { ring: [-12, -12, 12, 12] } } })
  assert.ok(n.ok && !n.record && n.why === 'nothing')
})

await t('inside the wall: anchored mutants (the 1-high step, the yard kept, the cycle) are killed', async () => {
  const TIDY_PATH = new URL('../src/tidy.mjs', import.meta.url), LAND_PATH = new URL('../src/landplan.mjs', import.meta.url)
  const srv = server(); srv.set([2, G + 1, 2], 'dirt')
  await withMutant(TIDY_PATH, "    if (c.y > base && !c.tree) {", "    if (c.y > base + 1 && !c.tree) {", async M => {
    assert.strictEqual(M.surveyInwall(srv.read, { home: HOME, box: [-10, -10, 10, 10] }).cut.length, 0, 'the mutant leaves the 1-high step')
  })
  const roof = server(); roof.set([1, G + 4, 0], 'oak_planks'); roof.set([1, G + 5, 0], 'cobblestone')
  await withMutant(TIDY_PATH, "^project:(?!yard$|treefarm$|land$|tidy$)/", "^project:/", async M => {
    assert.strictEqual(M.surveyInwall(roof.read, { home: HOME, box: [0, -1, 2, 1], cells: new Set([`1,${G + 4},0`]), avoid: (x, z) => (x === 1 && z === 0 ? 'project:yard' : null) }).cut.length, 1, 'the mutant digs the yard\'s stock')
  })
  await withMutant(LAND_PATH, "  if (rec?.structure_complete && Number.isFinite(at) && now - at >= cycleMs) return", "  if (false) return", async M => {
    const st = M.landStages().at(-1)
    assert.strictEqual(M.nextStageCycle({ stageId: st.id, terraceV: 1, structure_complete: true, completeAt: 0 }, 1e12), null, 'the mutant never cycles')
  })
})

console.log('GKHANDOVER-01: THE HELPER -> KEEPER HAND-OVER WAITS FOR THE RELEASE ON DISK (LIVE H4 11-04 15:12Z, showcase-Frost)')
await t('a release that did not reach the disk (the marker cannot be written) is NOT confirmed; once written it is', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gkh-hand-'))
  const key = PJ.projKey(HOME, 'tidy')
  const tk = PJ.takeLease(dir, key, 'helper2', 'Frost', { now: Date.now(), ttl: 12 * 60_000 })
  assert.ok(tk.ok)
  fs.chmodSync(dir, 0o555)                                                   // the `.released` marker cannot be written
  try {
    PJ.releaseLease(dir, key, 'helper2', 'Frost', tk.gen)                     // never throws: the release silently did not take
    assert.strictEqual(GK.releaseConfirmed(PJ.leaseState(dir, key, 'helper2'), 'Frost'), false, 'the LIVE case: logged, not on disk')
  } finally { fs.chmodSync(dir, 0o755) }
  PJ.releaseLease(dir, key, 'helper2', 'Frost', tk.gen)
  assert.strictEqual(GK.releaseConfirmed(PJ.leaseState(dir, key, 'helper2'), 'Frost'), true)
})
await t('releaseConfirmed: unreadable -> no; another bot\'s later take or a lapsed lease -> yes; none -> yes', async () => {
  assert.strictEqual(GK.releaseConfirmed({ gen: null, rec: null, released: false, holdsUntil: 0, blocksUntil: Infinity }, 'F'), false)
  assert.strictEqual(GK.releaseConfirmed({ gen: 3, rec: { holder: 'G' }, released: false, holdsUntil: 9e15 }, 'F'), true)
  assert.strictEqual(GK.releaseConfirmed({ gen: 3, rec: { holder: 'F' }, released: false, holdsUntil: 10 }, 'F', 20), true)
  assert.strictEqual(GK.releaseConfirmed({ gen: 3, rec: { holder: 'F' }, released: false, holdsUntil: 30 }, 'F', 20), false)
  assert.strictEqual(GK.releaseConfirmed(null, 'F'), true)
  await withMutant(GK_PATH, "  if (state.released) return true\n  if (!state.rec || state.rec.holder !== me) return !!state.rec\n  return now >= (state.holdsUntil ?? 0)", "  return true", async M => {
    assert.strictEqual(M.releaseConfirmed({ gen: 3, rec: { holder: 'F' }, released: false, holdsUntil: 30 }, 'F', 20), true, 'the mutant confirms a live lease')
  })
})
await t('WIRED: takeKeeper returns before the keeper take when a helper release is unconfirmed; dropHelperLeases re-reads after each release', async () => {
  const s = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/const hl = dropHelperLeases\(bot\)\n\s*if \(!hl\.ok\) \{[^\n]*return \{ ok: false, why: 'helper_release_unconfirmed' \} \}\n(?:\s*\/\/[^\n]*\n)*\s*now = Math\.max\(now, Date\.now\(\)\)\n\s*\}\n\s*const r = projTakeLease\(townDir\(\), projKeyOf\(TIDY_PLOT\), GK_LEASE/.test(s), 'the deferral precedes the take')
  assert.ok(/done = releaseConfirmed\(projLeaseState\(dir, key, name, \{ ttl: GK\.helperTtlMs \}\), me, Date\.now\(\)\)/.test(s), 're-read after the release')
})

console.log('WIRING (skills.mjs buildTidy / keeperOrder, shop.mjs; structural)')
await t('buildTidy: the crew role, helpers never site, the keeper\'s plan additions, the visit record, the hooks, the gather', async () => {
  const s = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/const h = crewState\(bot, true\)\n\s*if \(h\.d !== 'mine' && h\.d !== 'take'\) return out\('no_effect', 'keeper_held'/.test(s), 'a non-keeper helps or is turned away')
  assert.ok(/const caps = crewCaps\(role\)/.test(s), 'the role\'s caps')
  assert.ok(/if \(\(!rh\.head \|\| tidyDue\(rh\.head\.rec\) \|\| gkNext\) && !caps\.site\) return out\(/.test(s), 'a helper never sites')
  assert.ok(/if \(GROUNDS\.on && caps\.topup\) \{\n\s*const r2 = gkPlanAdditions\(bot, dir, key, rec, me\)/.test(s), 'the keeper\'s plan additions')
  assert.ok(/if \(!caps\.digs\) visitRec = helperRecord\(visitRec\)/.test(s), 'a helper\'s record')
  assert.ok(/\.\.\.\(GROUNDS\.on \? \{ segOk: crew\.segOk, segYield: crew\.segYield, skipOpenDeps: true \} : \{\}\) \}, effects,/.test(s), 'the crew hooks reach runVisit')
  assert.ok(/const cuts = !caps\.digs \|\| floorOnly \? \[\] :/.test(s), 'the cuts are the keeper\'s')
  assert.ok(/const waive0 = !caps\.waive \? \[\] :/.test(s), 'the waiver is the keeper\'s')
  assert.ok(/if \(caps\.complete && !crewHolds && !platformUp\(rw\) && !prog\.cutLeft/.test(s), 'the completion is the keeper\'s (gkstage-01: a bounded wait for crew plants)')
  assert.ok(/let crewHolds = crewHeld > 0 && parkWaits <= GK_PARK_WAITS/.test(s), 'gkstage-01: the wait is bounded')
  assert.ok(/gathered = await parkGather\(ctx, signal, \{ deadline: t0 \+ budget - ZIG_VISIT_TAIL_MS, effects \}\)/.test(s), 'the gather')
  assert.ok(/if \(helper && r\.placed === 0 && !\(gathered\?\.n > 0\)\) \{ releaseHelper\(bot, helper\.name, helper\.gen, 'idle'\)/.test(s), 'an idle helper lets go')
  assert.ok(/if \(GROUNDS\.on\) \{ try \{ pantryWrite\(dir, key, me, parkItemsOf\(spareOf\(held0, keep\)\)\) \}/.test(s), 'the pantry: what the bag spares (gkstage-01)')
  assert.ok(/const floorDone = q => waivedK\(q\) \|\| buildCellDone\(read\(\.\.\.q\.at\), palette, q\.role\)\n\s*const fv = GROUNDS\.on \? floorView\(rec, floorDone\)/.test(s), 'gkstage-01: the floor view reads the visit\'s own done test')
  // decorator-01: never the decorator's bot (one role a bot)
  // gklease-01: an unfit bot never helps (and an unfit helper lets its lease go)
  assert.ok(/if \(d === 'other'\) \{\n\s*const h = crewState\(bot, work, now\)\n[^\n]*else if \(h\.d === 'mine' \|\| \(h\.d === 'take' && !decorHeld && !\(GKL_ON && unfit\)\)\) d = 'helper'\n\s*\}/.test(s), 'shopActive offers the tidy to a helper')
  assert.ok(/if \(!renewal\) \{\n\s*const hl = dropHelperLeases\(bot\)/.test(s), 'a helper becoming keeper lets its helper lease go first')
  const sh = strip(readFileSync(SHOP_PATH, 'utf8'))
  assert.ok(/builders: GROUNDS\.on \? 1 \+ GK\.helpersMax : TIDY_BUILDERS/.test(sh), 'the keeper and its helpers have slots')
  assert.ok(/'crew', 'gathered', 'floor'/.test(sh), 'the visit row names the crew')
  // the helper's idle stop is an IDLE stop (the copper run and the expedition are asked as before)
  const SH = await import('../src/shop.mjs')
  assert.ok(SH.IDLE_STOPS.includes('keeper_held'))
})
await t('the helper decision\'s anchored mutant: a keeper that may also be a helper is caught', async () => {
  await withMutant(GK_PATH, "  if (liveOf(keeper, now) && keeper.rec.holder === me) return { d: 'keeper', name: null }\n", '', async M => {
    const d = M.helperDecision({ keeper: L('K', { until: 9000 }), helpers: {}, me: 'K', now: 1000 })
    assert.notStrictEqual(d.d, 'keeper', 'the mutant lets the keeper take a helper lease')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
