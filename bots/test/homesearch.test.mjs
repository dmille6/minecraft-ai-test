// HOMES-02SHOW (slice 1b; bots/src/homeplots.mjs searchPlotLooks / plotSig / homeZones, buildsite.mjs makeWalkCache, cottage2.mjs
// cottageLooksAll; skills.mjs cottageSiteOn). LIVE showcase 11-13, the first hour of the layout's home plots: cottage2's three visits
// all ended `search_time` at the 100-s box and nothing was sited -- a visit tried three looks, the next visit the same three again, a
// plot that only ran out of time was put behind the others for 6 h, and every walk of a proof read the whole town.
// BEHAVIOUR: the kept walk IS walkFrom's (key for key, in order) and what it saves (walks counted, before and after); the family's
// 24 looks in one order; the plot's signature and the search's memory; THE CHAIN -- the real cottage siting (siteBlueprintAsync +
// cottageSitingPlan + the family's looks) over three visits on a fake clock: it resumes, reaches look 13 and sites the look that
// fits; `search_time` does not rotate the plot, exhaustion does, a changed world starts again, two bots; unfinished roads yield and
// finished ones do not. Structural assertions only for the wiring. Every mutant asserts its anchor present and unique first.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const F = await import('./helpers/buildfake.mjs')
const { B, G, HOME } = F
const C = await import('../src/cottage.mjs')
const K = await import('../src/cottage2.mjs')
const H = await import('../src/homeplots.mjs')
const S = await import('../src/shop.mjs')
const LP = await import('../src/landplan.mjs')
const PATHS = await import('../src/paths.mjs')
const T = await import('../src/tidy.mjs')
const SC = await import('../src/sitecanopy.mjs')
const R = await import('../src/buildrun.mjs')
const SRC = f => new URL(`../src/${f}`, import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
/** A mutant of a source module: its anchor present and unique (asserted BEFORE the mutant is written or run), imported from this directory. */
async function mutantOf (file, old, neu) {
  const src = readFileSync(SRC(file), 'utf8')
  assert.strictEqual(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE in ${file}: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-homesearch-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await import(out.href) } finally { try { unlinkSync(out) } catch { /* gone */ } }
}
const STOCK = { spruce_log: 505, oak_log: 76, stone_bricks: 358 }
const STONE = Object.freeze({ name: 'stone', boundingBox: 'block' }), AIR = Object.freeze({ name: 'air', boundingBox: 'empty' })
const meets = (b, q) => b[0] <= q[2] && b[2] >= q[0] && b[1] <= q[3] && b[3] >= q[1]

console.log('1. ONE KEPT WALK OF THE TOWN (buildsite.mjs makeWalkCache): walkFrom\'s own answer, and what it saves')
/** Rough ground round a flat town (deterministic): heights 68..71, a pit here and there; readable to 70. */
function rough (seed) {
  let s = seed
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  const h = new Map()
  for (let x = -70; x <= 70; x++) for (let z = -70; z <= 70; z++) h.set(`${x},${z}`, G + (Math.max(Math.abs(x), Math.abs(z)) <= 18 ? 0 : Math.floor(rnd() * 3) - (rnd() < 0.08 ? 3 : 0)))
  return { rnd, read: (x, y, z) => { if (Math.abs(x) > 70 || Math.abs(z) > 70 || y < 40 || y > 110) return null; return y <= h.get(`${x},${z}`) ? STONE : AIR } }
}
/** One question: cells dug, cells laid and cells blocked in a 9 x 9 patch at (cx, cz). */
const question = (rnd, cx, cz) => {
  const over = new Map(), block = new Set()
  for (let i = 0; i < 40; i++) { const k = `${cx + Math.floor(rnd() * 9)},${G - 2 + Math.floor(rnd() * 7)},${cz + Math.floor(rnd() * 9)}`; const r = rnd(); if (r < 0.4) over.set(k, AIR); else if (r < 0.8) over.set(k, { name: 'cobblestone', boundingBox: 'block' }); else block.add(k) }
  return { over, block }
}
const sameWalks = async (M, { trials = 6, per = 5 } = {}) => {
  let n = 0, diff = 0
  const s0 = { ...M.walkStats }
  for (let trial = 0; trial < trials; trial++) {
    const w = rough(1000 + trial), stood = [[1, G + 1, 1]]
    const walker = M.makeWalkCache().bind(w.read, HOME, 60, { stood })
    for (let q = 0; q < per; q++) {
      // away from the town, and (every fifth) inside it: the seeds may move there, and the walk is made the old way
      const near = q === per - 1
      const { over, block } = question(w.rnd, near ? 6 : 25 + Math.floor(w.rnd() * 30), near ? -4 : Math.floor(w.rnd() * 100) - 50)
      const Rn = M.overlay(w.read, over)
      const want = [...M.walkFrom(Rn, HOME, block, 60, { stood })], got = [...walker.walk(Rn, block, [over.keys()])]
      n++
      if (want.length !== got.length || want.some((k, i) => k !== got[i])) diff++
      assert.ok(want.length > 2000, 'POSITIVE CONTROL: the walk covers the town and the land')
    }
  }
  return { n, diff, full: M.walkStats.full - s0.full, local: M.walkStats.local - s0.local, fallback: M.walkStats.fallback - s0.fallback }
}
await t('the kept walk\'s answer is walkFrom\'s OWN, key for key and IN ORDER (30 questions over rough ground: cells dug, laid and blocked; a change inside the town falls back)', async () => {
  const r = await sameWalks(B)
  assert.deepStrictEqual([r.n, r.diff], [30, 0])
  assert.deepStrictEqual([r.full, r.local, r.fallback], [6, 24, 6], 'one kept walk a town, 24 questions answered from it, 6 inside the town made the old way')
})
await t('the common obstacles (the planned town: `staticBlock`, `noFloor`) are part of the kept walk; a question\'s own blocks are read again', () => {
  const w = rough(77), stood = [[1, G + 1, 1]]
  const planned = new Set(), noFloor = new Set()
  for (let z = -3; z <= 3; z++) { planned.add(`30,${G + 1},${z}`); planned.add(`30,${G + 2},${z}`) }
  for (let x = 40; x <= 44; x++) noFloor.add(`${x},${G},-20`)
  const walker = B.makeWalkCache().bind(w.read, HOME, 60, { stood })
  for (const [cx, cz] of [[26, -6], [35, 10], [-40, 30]]) {
    const { over, block } = question(w.rnd, cx, cz)
    const blk = new Set([...planned, ...block]), Rn = B.overlay(w.read, over)
    assert.deepStrictEqual([...walker.walk(Rn, blk, [over.keys()], { staticBlock: planned, noFloor })], [...B.walkFrom(Rn, HOME, blk, 60, { stood, noFloor })])
  }
})
await t('MUTANT the kept steps taken in the changed columns too: the answer is no longer walkFrom\'s', async () => {
  const M = await mutantOf('buildsite.mjs', "const kept = base.dirty.has(k2(q[i][0], q[i][2])) ? undefined : g.adj.get(k3(...q[i]))", 'const kept = g.adj.get(k3(...q[i]))')
  assert.ok((await sameWalks(M)).diff > 0, 'the mutant differs somewhere')
  assert.strictEqual((await sameWalks(B, { trials: 2 })).diff, 0)
})
// THE COUNT: one plot (9 x 9 east of home, flat), the family's 24 looks, the real siting -- walks that read the town
const NINE = Object.freeze({ id: 'H1', kind: 'house', layout: true, pad: [21, -3, 27, 3], box: [20, -4, 28, 4] })
const ALL = C.cottage2StylesAll(STOCK, { pool: 'fake', plot: 'cottage2', plotId: 'H1', others: [] })
const ctxOf = (plot, zones = [], extra = {}) => { const sp = C.cottageSitingPlan(HOME, plot, zones); return { zones: sp.zones, stood: [], sectors: sp.sectors, plot: 'cottage2', earth: sp.earth ?? C.COTTAGE_EARTH, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line, tries: 3, ...extra } }
const bpOf = cs => C.styledBlueprint(B.loadBlueprint(cs.id), cs.style)
const slim = s => (s.ok ? { ok: true, at: s.record.anchor, orient: s.record.orient, cells: s.record.cells.map(c => [c.at.join(','), c.stand.join(','), c.order].join('/')) } : { ok: false, why: s.why, fails: s.sectors.map(r => [r.screened, r.proofFails]) })
await t('WALKS THAT READ THE TOWN, one plot\'s 24 looks: every look\'s answer is the same (site, cells, stands, order) and the walks fall from one a proof step to one a plot', () => {
  const run = cache => { const w0 = B.walkStats.walks; const out = ALL.map(cs => slim(B.siteBlueprint(F.server().read, F.plan(), bpOf(cs), ctxOf(NINE, [], cache ? { walkCache: cache } : {})))); return { out, walks: B.walkStats.walks - w0 } }
  const before = run(null), after = run(B.makeWalkCache())
  assert.deepStrictEqual(after.out, before.out, 'not one answer differs: the proof is not weakened')
  const sited = before.out.filter(o => o.ok).length
  console.log(`        walks that read the town, 24 looks on one plot (${sited} sited, ${24 - sited} with no candidate): before ${before.walks}, after ${after.walks}`)
  assert.strictEqual(sited, 12, 'the twelve square looks site on a 9 x 9; the long bodies have no candidate')
  assert.ok(before.walks >= 12 * 8, `before: a walk a segment of every proof (${before.walks})`)
  assert.strictEqual(after.walks, 1, 'after: ONE walk of the town for the plot')
})
await t('...and a look with NO candidate costs no walk at all, before or after (the cheap refusals already come first)', () => {
  const long = ALL.find(cs => /cottage@2-L/.test(cs.id))
  for (const cache of [null, B.makeWalkCache()]) {
    const w0 = B.walkStats.walks
    const s = B.siteBlueprint(F.server().read, F.plan(), bpOf(long), ctxOf(NINE, [], cache ? { walkCache: cache } : {}))
    assert.deepStrictEqual([s.ok, s.why, s.sectors[0].screened, B.walkStats.walks - w0], [false, 'no_site', 0, 0])
  }
})
await t('a candidate under a canopy (sitecanopy.mjs: a walk a leaf it clears): the same answer, the walks from one a leaf to the kept ones', () => {
  const BOX = [20, -5, 30, 5], LEAF_Y = G + 5
  const leaf = { name: 'spruce_leaves', boundingBox: 'block', props: { persistent: 'false' } }
  const plain = F.server().read
  const read = (x, y, z) => { const b = plain(x, y, z); if (!b) return b; return y === LEAF_Y && x >= BOX[0] - 1 && x <= BOX[2] + 1 && z >= BOX[1] - 1 && z <= BOX[3] + 1 && b.name === 'air' ? leaf : b }
  const bp = B.loadBlueprint('cottage@1f')
  const run = cache => {
    const sp = C.cottageSitingPlan(HOME, { id: 'X9', box: BOX }, [])
    const walker = cache ? cache.bind(read, HOME, sp.walkR, { stood: [] }) : null
    const walk = (r, dirty) => (walker && dirty ? walker.walk(r, new Set(), dirty) : B.walkFrom(r, HOME, new Set(), sp.walkR, { stood: [] }))
    const reach = site => ({ cells: B.placeBlueprint(bp, site.anchor, site.s, site.orient), fill: site.fill ?? [], walk, stand: R.digStand })
    const hook = SC.cellClearsHook(read, { cellsOf: s => B.placeBlueprint(bp, s.anchor, s.s, s.orient).map(c => c.at), reached: (cl, site) => SC.clearsReachedBuilt(read, cl, reach(site)), reachedSteps: function * (cl, site) { return yield * SC.clearsReachedBuiltSteps(read, cl, reach(site)) } })
    const w0 = B.walkStats.walks
    const s = B.siteBlueprint(read, F.plan(), bp, { zones: [], stood: [], sectors: sp.sectors, plot: 'cottage1', earth: sp.earth ?? C.COTTAGE_EARTH, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line, tries: 2, cellClears: hook, ...(cache ? { walkCache: cache } : {}) })
    return { s: slim(s), leaves: s.ok ? s.record.clear.filter(c => /leaves/.test(c.name ?? '')).length : 0, walks: B.walkStats.walks - w0 }
  }
  const before = run(null), after = run(B.makeWalkCache())
  assert.ok(before.s.ok, 'POSITIVE CONTROL: the plot sites under its canopy')
  assert.deepStrictEqual(after.s, before.s)
  console.log(`        one candidate with ${before.leaves} leaves to clear: walks that read the town before ${before.walks}, after ${after.walks}`)
  assert.ok(before.leaves >= 10 && before.walks >= before.leaves, `a walk a leaf at least (${before.walks} for ${before.leaves})`)
  assert.ok(after.walks <= 3, `the kept walks only (${after.walks})`)
})

console.log('2. EVERY LOOK OF THE FAMILY, IN ONE ORDER (cottage2.mjs cottageLooksAll)')
await t('24 looks, each once, the same order every time; the first three are the three the siting tried before (cottage2Styles)', () => {
  const o = { pool: 'showcase', plot: 'cottage2', plotId: 'H4', others: [{ blueprint: 'cottage@1f', style: { wood: 'spruce' } }] }
  const all = C.cottage2StylesAll(STOCK, o), three = C.cottage2Styles(STOCK, o)
  assert.strictEqual(all.length, 24); assert.strictEqual(new Set(all.map(q => q.id)).size, 24)
  assert.deepStrictEqual(all.map(q => q.id).sort(), K.allLooks().map(K.cottage2Id).sort(), 'the whole family')
  assert.deepStrictEqual(all.slice(0, 3), three)
  assert.deepStrictEqual(three.map(q => q.id), ['cottage@2-Lsl0c', 'cottage@2-Csl1c', 'cottage@2-Lfl1-'], 'the three looks of the live row (H4, 11-13)')
  assert.deepStrictEqual(C.cottage2StylesAll(STOCK, o), all)
  for (const q of all) assert.ok(B.loadBlueprint(q.id).cells.length > 100, `${q.id} loads`)
  assert.deepStrictEqual(C.cottage2StylesAll({ spruce_log: 10 }, o), [], 'no wood to build from: no look')
  // with seven neighbours the looks that still differ in two axes come before the ones that do not; none is left out
  const others = all.slice(0, 7).map(q => ({ blueprint: q.id, style: q.style }))
  assert.strictEqual(C.cottage2StylesAll(STOCK, { ...o, others }).length, 24)
})

console.log('3. THE PLOT\'S SIGNATURE AND THE SEARCH\'S MEMORY')
await t('plotSig: the same ground, the same signature; a cut, a fill, a felled tree, a chunk now read, a reservation that moved or a moved box change it; a tuft of grass or a far column do not', () => {
  const sig = (srv, plot = NINE, zones = []) => H.plotSig(srv.read, plot, zones, HOME)
  const base = sig(F.server())
  assert.ok(base && base === sig(F.server()))
  const w = (at, name) => { const s = F.server(); s.set(at, name); return s }
  assert.notStrictEqual(sig(w([24, G, 0], 'air')), base, 'a cut')
  assert.notStrictEqual(sig(w([24, G + 1, 0], 'dirt')), base, 'a fill')
  assert.notStrictEqual(sig(w([24, G + 6, 0], 'oak_leaves')), base, 'a crown over the plot')
  assert.notStrictEqual(sig(w([30, G + 1, 0], 'cobblestone')), base, 'a block in the stands\' margin (box + 3)')
  assert.strictEqual(sig(w([24, G + 1, 0], 'short_grass')), base, 'a tuft of grass is not the ground')
  assert.strictEqual(sig(w([40, G + 1, 0], 'cobblestone')), base, 'a column beyond the margin')
  const hole = F.server(); const unread = (x, y, z) => (x === 24 && z === 0 ? null : hole.read(x, y, z))
  assert.notStrictEqual(H.plotSig(unread, NINE, [], HOME), base, 'a column not read (it is, later: the signature moves again)')
  const z = { box: [30, -64, 0, 31, 320, 1], why: 'project:decor:b1' }
  assert.notStrictEqual(sig(F.server(), NINE, [z]), base, 'a reservation within 4 of the box')
  assert.strictEqual(sig(F.server(), NINE, [{ box: [40, -64, 0, 41, 320, 1], why: 'project:decor:b2' }]), base, 'a reservation further off')
  assert.notStrictEqual(sig(F.server(), { ...NINE, box: [19, -4, 27, 4] }), base, 'the plot placed elsewhere')
  assert.strictEqual(H.plotSig(F.server().read, { id: 'x' }, [], HOME), '', 'no box, no signature')
})
await t('the memory: refused looks are passed over under the SAME signature inside 24 h; another signature, or a day, starts again; the tally', () => {
  const ids = ['a', 'b', 'c', 'd'], now = 1e12
  let m = {}
  assert.deepStrictEqual(H.searchLeft(m, 'H1', 's1', ids, now), { left: ids, refused: 0, first: 0, tally: '' })
  m = H.searchNoted(m, 'H1', 's1', 'a', 'no_site:liquid', { now, by: 'A' })
  m = H.searchNoted(m, 'H1', 's1', 'b', 'no_proven_site:cell_not_free', { now: now + 1000, by: 'B' })
  m = H.searchNoted(m, 'H1', 's1', 'c', 'no_site:liquid', { now: now + 2000, by: 'A' })
  assert.deepStrictEqual(H.searchLeft(m, 'H1', 's1', ids, now + 3000), { left: ['d'], refused: 3, first: 3, tally: 'no_site:liquid=2,no_proven_site:cell_not_free=1' })
  assert.deepStrictEqual([m.H1.at, m.H1.last, m.H1.by], [now, now + 2000, 'A'], 'the first refusal dates the memory')
  assert.deepStrictEqual(H.searchLeft(m, 'H2', 's1', ids, now).left, ids, 'another plot')
  assert.deepStrictEqual(H.searchLeft(m, 'H1', 's2', ids, now + 3000).left, ids, 'THE WORLD CHANGED: the plot\'s looks are all to try again')
  assert.deepStrictEqual(H.searchLeft(m, 'H1', 's1', ids, now + H.HOMEPLOT.searchKeepMs).left, ids, 'a day on: asked again')
  assert.deepStrictEqual(H.searchLeft(m, 'H1', 's1', ids, now + H.HOMEPLOT.searchKeepMs - 1).left, ['d'])
  assert.deepStrictEqual(H.searchLeft(m, 'H1', '', ids, now).left, ids, 'no signature is no memory')
  const m2 = H.searchNoted(m, 'H1', 's2', 'a', 'no_site', { now: now + 5000 })
  assert.deepStrictEqual(Object.keys(m2.H1.looks), ['a'], 'a look refused on the changed ground replaces the old ground\'s looks')
  const m3 = H.searchNoted(H.searchNoted(m, 'H2', 'q', 'a', 'no_site', { now: now + 10 }), 'H3', 'r', 'a', 'no_site', { now: now + H.HOMEPLOT.searchKeepMs + 20 })
  assert.deepStrictEqual(Object.keys(m3).sort(), ['H3'], 'entries older than a day are dropped on a write')
  assert.strictEqual(H.HOMEPLOT.searchKeepMs, 24 * 3_600_000)
  assert.deepStrictEqual(Object.keys(m.H1.looks), ['a', 'b', 'c']); assert.strictEqual(Object.isFrozen(H.SEARCH_STABLE), true)
})
await t('refusalOf: a finished search\'s reason with what refused most (the screen\'s when nothing was screened, the proof\'s when something was)', () => {
  assert.strictEqual(H.refusalOf({ why: 'no_site', sectors: [{ screened: 0, rejects: { domain: 28000, liquid: 30, zone: 6 }, proofFails: {} }] }), 'no_site:liquid')
  assert.strictEqual(H.refusalOf({ why: 'no_proven_site', sectors: [{ screened: 9, rejects: { domain: 1, liquid: 30 }, proofFails: { cell_not_free: 7, no_step: 2 } }] }), 'no_proven_site:cell_not_free')
  assert.strictEqual(H.refusalOf({ why: 'no_site', sectors: [{ screened: 0, rejects: { domain: 28900 }, proofFails: {} }] }), 'no_site', 'nothing fits the plot at all')
  assert.strictEqual(H.refusalOf(null), 'no_site')
})
await t('MUTANT the signature left out of the memory\'s test: a look refused on the old ground is passed over on the new', async () => {
  const M = await mutantOf('homeplots.mjs', 'return e && e.sig === sig && sig && Number.isFinite(at)', 'return e && Number.isFinite(at)')
  const m = H.searchNoted({}, 'H1', 's1', 'a', 'no_site', { now: 1e12 })
  assert.deepStrictEqual(M.searchLeft(m, 'H1', 's2', ['a', 'b'], 1e12 + 1).left, ['b'], 'the mutant never starts again')
  assert.deepStrictEqual(H.searchLeft(m, 'H1', 's2', ['a', 'b'], 1e12 + 1).left, ['a', 'b'])
})

console.log('4. THE CHAIN: THE REAL COTTAGE SITING OVER THREE VISITS ON A FAKE CLOCK')
// The plot: 9 x 9 east of home (the long bodies have no candidate). Four stone blocks hang where every square look but two has a
// cell: only Csl0- and Csl1- (one cell set) fit -- look 13 and look 20 of this plot's order.
const H2P = Object.freeze({ id: 'H2', kind: 'house', layout: true, pad: [-27, -3, -21, 3], box: [-28, -4, -20, 4] })
const BLOCKERS = [[27, 74, -2], [23, 75, 2], [27, 72, 2], [27, 74, 2]]
const world = (more = []) => { const srv = F.server(); for (const at of [...BLOCKERS, ...more]) srv.set(at, 'stone'); return srv }
const FIT = ALL.findIndex(cs => cs.id === 'cottage@2-Csl0-')
/** One VISIT: skills.mjs cottageSiteFor's own shape -- siteOverPlots over the offered plots, each plot searchPlotLooks with the real
 *  siteBlueprintAsync for a look; a 100-s search box on a fake clock (a finished look costs `cost`; a spent box gives the next
 *  search 0 ms, which the real search answers `search_time`). `mem`: the town file ({ fails, search }), shared by every visit. */
async function visit (srv, mem, plots, { cost = 22_000, boxMs = 100_000, now = Date.now(), who = 'A', looks = () => ALL, ctx = {} } = {}) {
  let spent = 0
  const box = { left: () => Math.max(0, boxMs - spent) }
  const rows = [], searched = []
  const siteOne = plot => {
    const all = looks(plot), sig = H.plotSig(srv.read, plot, [], HOME)
    return H.searchPlotLooks(all, { plotId: plot.id, sig, now: () => now, memory: () => mem.search,
      noteLook: (id, why) => { mem.search = H.searchNoted(mem.search, plot.id, sig, id, why, { now, by: who }) },
      row: f => rows.push(f),
      searchLook: async cs => {
        const bp = bpOf(cs)
        const s = await B.siteBlueprintAsync(srv.read, F.plan(), bp, ctxOf(plot, [], ctx), { sliceMs: 0, maxMs: box.left() })
        const end = B.siteLoopEnds(s)
        if (end) return { ok: false, why: end }
        spent += cost; searched.push(`${plot.id}:${all.indexOf(cs)}`)
        if (!s.ok) return { ok: false, why: s.why, more: true, ...(H.SEARCH_STABLE.includes(s.why) ? { refused: H.refusalOf(s) } : {}) }
        return { ok: true, why: 'ok', look: cs.id, record: C.cottageRecordOf(s.record, bp, cs.style, { plotId: plot.id }) }
      } }).then(r => (r?.why === 'search_time' ? { ...r, resume: true } : r))
  }
  const r = await H.siteOverPlots(plots, siteOne, { left: box.left, row: f => rows.push(f), noteFail: (p, why) => { mem.fails = H.failNoted(mem.fails, p.id, { why, project: 'cottage2', by: who, now }) } })
  return { r, rows: rows.map(f => [f.op, f.plot, f.look ?? f.why ?? ''].join(':').replace(/:$/, '')), searched }
}
await t('POSITIVE CONTROL: in this world exactly looks 13 and 20 of the plot\'s 24 fit; the first is past look 9', () => {
  assert.ok(FIT >= 9, `look ${FIT}`)
  const fits = ALL.map((cs, i) => (B.siteBlueprint(world().read, F.plan(), bpOf(cs), ctxOf(NINE)).ok ? i : null)).filter(i => i != null)
  assert.deepStrictEqual(fits, [13, 20]); assert.strictEqual(FIT, 13)
  assert.deepStrictEqual(ALL.map(cs => cs.id.slice(10, 11)).slice(0, 13).join(''), 'CLCLCCCLCLCCL', 'square and long looks before it, in the order tried')
})
await t('THREE VISITS: 0-4 refused and the box ends (`paused`, nothing noted against the plot); RESUMED at look 5, then at look 10; look 13 is SITED', async () => {
  const srv = world(), mem = { fails: {}, search: {} }
  const v1 = await visit(srv, mem, [NINE, H2P], { now: 1e12 })
  assert.deepStrictEqual([v1.r.ok, v1.r.why, v1.r.resume], [false, 'search_time', true])
  assert.deepStrictEqual(v1.searched, ['H1:0', 'H1:1', 'H1:2', 'H1:3', 'H1:4'], 'five looks in the 100 s')
  assert.deepStrictEqual(v1.rows, ['chosen:H1', 'paused:H1:search_time'])
  assert.deepStrictEqual(mem.fails, {}, '`search_time` is not the plot\'s failure')
  assert.deepStrictEqual(H.houseOffer({ layout: [NINE, H2P], fails: mem.fails, now: 1e12 + 1 }).plots.map(p => p.id), ['H1', 'H2'], 'the plot keeps its place: no rotation')
  assert.strictEqual(Object.keys(mem.search.H1.looks).length, 5)
  const v2 = await visit(srv, mem, [NINE, H2P], { now: 1e12 + 5 * 60_000, who: 'B' })
  assert.deepStrictEqual(v2.rows, ['chosen:H1', 'resumed:H1:5', 'paused:H1:search_time'])
  assert.deepStrictEqual(v2.searched, ['H1:5', 'H1:6', 'H1:7', 'H1:8', 'H1:9'], 'never the first five again')
  const v3 = await visit(srv, mem, [NINE, H2P], { now: 1e12 + 10 * 60_000 })
  assert.deepStrictEqual(v3.rows, ['chosen:H1', 'resumed:H1:10'])
  assert.deepStrictEqual(v3.searched, ['H1:10', 'H1:11', 'H1:12', 'H1:13'])
  assert.ok(v3.r.ok, v3.r.why)
  assert.deepStrictEqual([v3.r.plotId, v3.r.look, v3.r.record.blueprint, v3.r.record.plotId], ['H1', 'cottage@2-Csl0-', 'cottage@2-Csl0-', 'H1'])
  assert.ok(v3.r.record.cells.length > 150 && meets(NINE.box, v3.r.record.box), 'a whole cottage record on the plot')
  assert.strictEqual(Object.keys(mem.search.H1.looks).length, 13); assert.deepStrictEqual(mem.fails, {})
  assert.strictEqual(H.homePlotRowDetail({ project: 'cottage2', op: 'resumed', plot: 'H1', look: 10, of: 24, refused: 10 }), 'project=cottage2 op=resumed plot=H1 look=10 of=24 refused=10')
})
await t('WITHOUT THE MEMORY (slice 1: three looks a visit, the same three every visit) the fitting look is never reached -- the live failure', async () => {
  const srv = world()
  for (let i = 0; i < 3; i++) {
    const mem = { fails: {}, search: {} }   // nothing carried over
    const v = await visit(srv, mem, [NINE], { cost: 34_000, looks: () => ALL.slice(0, 3) })
    assert.deepStrictEqual(v.searched, ['H1:0', 'H1:1', 'H1:2']); assert.strictEqual(v.r.ok, false)
  }
})
await t('EXHAUSTION ROTATES: with nothing fitting, the plot\'s 24 looks are refused over five visits; then it is `exhausted` (the tally), noted failed, and the NEXT plot is tried in the same visit', async () => {
  const srv = world([[24, 73, 0], [24, 72, -1], [22, 72, 0], [26, 73, 1], [25, 74, 0]]), mem = { fails: {}, search: {} }
  let v = null, n = 0
  const firstOk = B.siteBlueprint(srv.read, F.plan(), bpOf(ALL[FIT]), ctxOf(NINE))
  assert.strictEqual(firstOk.ok, false, 'POSITIVE CONTROL: the fitting look is blocked too')
  for (; n < 8; n++) { v = await visit(srv, mem, [NINE, H2P], { now: 1e12 + n * 300_000 }); if (v.r.why !== 'search_time') break; assert.deepStrictEqual(mem.fails, {}) }
  assert.strictEqual(n, 4, 'four paused visits, the fifth ends the plot')
  assert.ok(v.rows.some(r => /^exhausted:H1:/.test(r)), JSON.stringify(v.rows))
  const ex = v.rows.find(r => /^exhausted:H1:/.test(r))
  assert.ok(/no_site=12/.test(ex) && /no_proven_site:cell_not_free=12/.test(ex), `the tally of reasons: ${ex}`)
  assert.deepStrictEqual([mem.fails.H1.why, mem.fails.H1.n], ['exhausted', 1])
  assert.ok(v.rows.includes('chosen:H2'), 'the next plot in the same visit')
  assert.ok(v.r.ok && v.r.plotId === 'H2', `...and it is sited (${v.r.why})`)
  assert.deepStrictEqual(H.houseOffer({ layout: [NINE, H2P], fails: mem.fails, now: 1e12 + n * 300_000 + 1 }).plots.map(p => p.id), ['H2', 'H1'], 'H1 behind the others for 6 h')
  // back at the plot after the 6 h, the ground unchanged: exhausted at once, WITHOUT a search (the memory is a day's)
  const again = await visit(srv, { fails: {}, search: mem.search }, [NINE], { now: 1e12 + 7 * 3_600_000 })
  assert.deepStrictEqual([again.r.why, again.searched, again.rows[1].split(':')[0]], ['exhausted', [], 'exhausted'])
  assert.strictEqual(H.homePlotRowDetail({ project: 'cottage2', op: 'exhausted', plot: 'H1', why: 'no_site=12,no_proven_site:cell_not_free=12' }), 'project=cottage2 op=exhausted plot=H1 why=no_site=12,no_proven_site:cell_not_free=12')
})
await t('A CHANGED WORLD RESETS THE MEMORY: the blockers gone after visit 1 (the signature moves) -> the search starts at look 0 again and look 0 is sited', async () => {
  const mem = { fails: {}, search: {} }
  const v1 = await visit(world(), mem, [NINE], { now: 1e12 })
  assert.strictEqual(Object.keys(mem.search.H1.looks).length, 5)
  const v2 = await visit(F.server(), mem, [NINE], { now: 1e12 + 300_000 })   // the same plot, the hanging blocks cut
  assert.deepStrictEqual(v2.rows, ['chosen:H1'], 'no `resumed` row: nothing is passed over')
  assert.deepStrictEqual(v2.searched, ['H1:0']); assert.ok(v2.r.ok); assert.strictEqual(v2.r.look, ALL[0].id)
  assert.strictEqual(v1.r.why, 'search_time')
})
await t('TWO BOTS ON ONE PLOT at once: both start at the same look (the work is done twice, never wrongly), neither drops the other\'s looks, and the next visit resumes past the union', async () => {
  const srv = world(), mem = { fails: {}, search: {} }
  const [a, b] = await Promise.all([visit(srv, mem, [NINE], { now: 1e12, who: 'A' }), visit(srv, mem, [NINE], { now: 1e12, who: 'B', cost: 34_000 })])
  assert.deepStrictEqual(a.searched, ['H1:0', 'H1:1', 'H1:2', 'H1:3', 'H1:4']); assert.deepStrictEqual(b.searched, ['H1:0', 'H1:1', 'H1:2'])
  assert.deepStrictEqual(Object.keys(mem.search.H1.looks).length, 5, 'the union: five looks refused')
  const v = await visit(srv, mem, [NINE], { now: 1e12 + 300_000 })
  assert.deepStrictEqual(v.rows.slice(0, 2), ['chosen:H1', 'resumed:H1:5'])
})
await t('the driver: a `resume` answer notes nothing and ends the visit; `exhausted` is noted and the next plot tried; the old `search_time` (no memory) is still the plot\'s failure', async () => {
  const plots = [NINE, H2P]
  const run = async answers => { const rows = [], noted = []; const r = await H.siteOverPlots(plots, p => answers[p.id], { row: f => rows.push(`${f.op}:${f.plot}`), noteFail: (p, why) => noted.push(`${p.id}:${why}`) }); return { r, rows, noted } }
  const a = await run({ H1: { ok: false, why: 'search_time', resume: true }, H2: { ok: true } })
  assert.deepStrictEqual([a.r.why, a.rows, a.noted], ['search_time', ['chosen:H1', 'paused:H1'], []])
  const b = await run({ H1: { ok: false, why: 'exhausted', detail: 'no_site=24' }, H2: { ok: true } })
  assert.deepStrictEqual([b.r.ok, b.r.plotId, b.rows, b.noted], [true, 'H2', ['chosen:H1', 'exhausted:H1', 'chosen:H2'], ['H1:exhausted']])
  const c = await run({ H1: { ok: false, why: 'search_time' }, H2: { ok: true } })
  assert.deepStrictEqual([c.r.why, c.rows, c.noted], ['search_time', ['chosen:H1', 'failed:H1'], ['H1:search_time']], 'HOMESEARCH off: slice 1 as it was')
})
await t('MUTANT `search_time` treated as the plot\'s failure again: the plot is noted and rotated after one visit -- the live failure', async () => {
  const M = await mutantOf('homeplots.mjs', "    if (last.resume === true && last.why === 'search_time') { row({ op: 'paused', plot: p.id, why: last.detail ?? last.why }); return last }\n", '')
  const noted = []
  await M.siteOverPlots([NINE, H2P], () => ({ ok: false, why: 'search_time', resume: true }), { noteFail: p => noted.push(p.id) })
  assert.deepStrictEqual(noted, ['H1'])
})
await t('MUTANT a refused look not passed over: the second visit searches look 0 again and the fitting look is never reached', async () => {
  const M = await mutantOf('homeplots.mjs', '    if (!left.has(look.id)) continue\n', '')
  const srv = world(), mem = { fails: {}, search: {} }
  const seen = []
  for (let i = 0; i < 2; i++) {
    let spent = 0
    await M.searchPlotLooks(ALL, { plotId: 'H1', sig: 's', memory: () => mem.search, noteLook: (id, why) => { mem.search = H.searchNoted(mem.search, 'H1', 's', id, why, { now: 1e12 }) },
      searchLook: async cs => { if (spent >= 100_000) return { ok: false, why: 'search_time' }; spent += 22_000; seen.push(ALL.indexOf(cs)); const s = B.siteBlueprint(srv.read, F.plan(), bpOf(cs), ctxOf(NINE)); return s.ok ? { ok: true } : { ok: false, why: s.why, refused: H.refusalOf(s) } } })
  }
  assert.deepStrictEqual(seen, [0, 1, 2, 3, 4, 0, 1, 2, 3, 4])
})

console.log('5. UNFINISHED ROADS YIELD TO HOMES (owner 11-13: "either, as long as the thing gets built")')
const HOME0 = { x: 0, y: 70, z: 0 }
const LAYOUT = H.layoutPlotsOf(H.readTownLayout(), 'showcase', HOME0)
const colsNS = (x0, x1, z0, z1) => { const out = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push([x, z, 70]); return out }
// the ring: three columns wide through the middle of H7 (x 26..28) and of H1 (x 15..17); the north spoke s0, finished, along H3's east edge
const RING = [...colsNS(26, 28, -60, -25), ...colsNS(15, 17, -40, 0)], SPOKE = colsNS(-28, -27, -70, -50)
const landOf = (ringOk, spokeOk = true) => {
  const roads = [{ id: 'ring', kind: 'ring', ok: ringOk, reached: ringOk ? 21 : 11, of: 21, cols: RING }, { id: 's0', kind: 'spoke', ok: spokeOk, reached: 6, of: 6, cols: SPOKE }]
  return { v: 1, blueprint: LP.LAND_BLUEPRINT, plot: 'land', home: HOME0, roads, corridors: PATHS.pathZones([...RING, ...SPOKE], LP.LAND.margin).map(z => ({ box: z.box, why: 'land:road' })), cells: [], structure_complete: true }
}
const placed = (land, on) => H.resolveHomePlots(LAYOUT, H.homeZones(S.recordZones([LP.landReservation(land)]), land, on), { home: HOME0 })
const at = (res, id) => res.find(p => p.id === id)
await t('H1 and H7 on the UNFINISHED ring: `road_no_shift` before; now OFFERED where they are drawn; the finished spoke still moves H3; a finished ring still skips them', () => {
  const unfinished = landOf(false)
  const before = placed(unfinished, false)
  assert.deepStrictEqual([at(before, 'H1').skip, at(before, 'H7').skip], ['road_no_shift', 'road_no_shift'], 'slice 1 (and HOMESEARCH off): the live skips')
  const now = placed(unfinished, true)
  assert.deepStrictEqual([at(now, 'H7').skip, at(now, 'H7').shift], [undefined, [0, 0]], 'H7 as drawn, on the corridor')
  assert.deepStrictEqual([at(now, 'H1').skip, at(now, 'H1').shift, at(now, 'H1').why], [undefined, [0, -1], 'door'], 'H1: only its door moves it')
  const offer = H.houseOffer({ layout: now, ext: null, now: 1e12 })
  assert.ok(offer.plots.some(p => p.id === 'H1') && offer.plots.some(p => p.id === 'H7'))
  assert.ok(H.homePlotZones(now).some(z => z.id === 'H7') && H.homePlotZones(now).some(z => z.id === 'H1'), 'and they are RESERVED (the paths\' router goes round them)')
  // the FINISHED spoke is a corridor as it was: H3 (x -37..-27) meets it at x -28..-27 +- 1 and is moved off it, before and now
  assert.deepStrictEqual([at(now, 'H3').why, at(before, 'H3').why, at(now, 'H3').shift, at(before, 'H3').shift], ['road', 'road', [-3, 0], [-3, 0]])
  assert.ok(!SPOKE.some(([x, z]) => meets(at(now, 'H3').box, [x - 1, z - 1, x + 1, z + 1])), `H3 clear of the finished road: ${at(now, 'H3').box}`)
  const finished = placed(landOf(true), true)
  assert.deepStrictEqual([at(finished, 'H1').skip, at(finished, 'H7').skip], ['road_no_shift', 'road_no_shift'], 'a FINISHED ring: skipped, as before')
  // an unfinished spoke yields too; a land record that does not name its roads\' columns is read as before
  assert.deepStrictEqual(at(placed(landOf(false, false), true), 'H3').shift, [0, 0])
  const legacy = { ...unfinished, roads: [{ id: 'ring', ok: false }] }, zs = S.recordZones([LP.landReservation(unfinished)])
  assert.strictEqual(H.homeZones(zs, legacy, true), zs); assert.strictEqual(H.homeZones(zs, null, true), zs); assert.strictEqual(H.homeZones(zs, unfinished, false), zs)
  assert.deepStrictEqual(LP.landReservation(unfinished).zones.filter(z => z.why === 'land:road').length, unfinished.corridors.length, 'the land plan\'s own reservation is untouched')
})
await t('the cottage\'s own siting on H7: refused `zone` by the unfinished corridor before, SITED with it yielding; a finished road still refuses its columns', () => {
  const flat = (x, y, z) => { if (y < G - 20 || y > G + 40) return null; const n = y < G ? 'stone' : y === G ? 'grass_block' : 'air'; return { name: n, boundingBox: n === 'air' ? 'empty' : 'block' } }
  const land = landOf(false), zs = S.recordZones([LP.landReservation(land)])
  const h7 = at(placed(land, true), 'H7')
  const site = zones => { const sp = C.cottageSitingPlan(HOME, h7, zones); return B.siteBlueprint(flat, { ...F.plan(), plots: [] }, C.styledBlueprint(B.loadBlueprint('cottage@2-Csl0-'), { wood: 'spruce', roof: 'dark_oak', stone: 'cobblestone' }), { zones: sp.zones, stood: [], sectors: sp.sectors, plot: 'cottage2', earth: sp.earth, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line, tries: 2 }) }
  const before = site(zs)
  assert.strictEqual(before.ok, false); assert.ok(before.sectors[0].rejects.zone > 0, JSON.stringify(before.sectors[0].rejects))
  assert.ok(site(H.homeZones(zs, land, true)).ok, 'the corridor of the unfinished ring refuses nothing')
  const fin = landOf(true)
  assert.strictEqual(site(H.homeZones(S.recordZones([LP.landReservation(fin)]), fin, true)).ok, false, 'a finished ring through the plot still refuses')
})
await t('the road\'s own stage leaves its columns on a reserved home plot alone (tidy.mjs siteStage `terrace.keepOff`); elsewhere it works them', async () => {
  const SMALL = Object.freeze({ ...LP.LAND, workR: 44, rimR: 20, rimStep: 12, legPops: 60_000 })
  const mk = () => { const srv = F.server(); for (const x of [30, 34]) { srv.set([x, G - 1, 0], 'air'); srv.set([x, G, 0], 'air') } return srv }   // two dips on the road
  const cols = [[30, 0, G], [31, 0, G], [32, 0, G], [33, 0, G], [34, 0, G]]
  const land = { home: HOME, roads: [{ id: 'ring', kind: 'ring', ok: false, cols }], corridors: [], zones: {}, ringR: 20, workR: 44, inner: 6 }
  const stage = o => T.siteStage(mk().read, { home: HOME, land, stage: LP.stageOf(2, SMALL), L: SMALL, ...o })
  const fills = s => (s.record?.cells ?? []).map(c => c.at[0]).filter((x, i, a) => a.indexOf(x) === i).sort()
  const open = await stage({})
  assert.deepStrictEqual(fills(open), [30, 34], 'POSITIVE CONTROL: both dips are filled')
  const kept = await stage({ terrace: { keepOff: (x, z) => (x >= 33 && x <= 43 && Math.abs(z) <= 5 ? 'H9' : null) } })
  assert.deepStrictEqual(fills(kept), [30], 'the dip on the home plot is left; the one before it is filled')
  await (async () => {
    const M = await mutantOf('tidy.mjs', '  const rcols = roadOff ? stageRoadCols(land, st, { L }).filter(([x, z]) => !roadOff(x, z)) : stageRoadCols(land, st, { L })\n', '  const rcols = stageRoadCols(land, st, { L }); void roadOff\n')
    const s = await M.siteStage(mk().read, { home: HOME, land, stage: LP.stageOf(2, SMALL), L: SMALL, terrace: { keepOff: (x, z) => (x >= 33 && x <= 43 && Math.abs(z) <= 5 ? 'H9' : null) } })
    assert.deepStrictEqual(fills(s), [30, 34], 'MUTANT: the road is graded across the home plot')
  })()
})
await t('MUTANT every road taken as finished: H1 and H7 are skipped `road_no_shift` again', async () => {
  const M = await mutantOf('homeplots.mjs', '    if (r.ok !== true) continue\n', '')
  const land = landOf(false)
  const res = H.resolveHomePlots(LAYOUT, M.homeZones(S.recordZones([LP.landReservation(land)]), land, true), { home: HOME0 })
  assert.deepStrictEqual([at(res, 'H1').skip, at(res, 'H7').skip], ['road_no_shift', 'road_no_shift'])
})

console.log('6. THE SWITCH AND THE WIRING')
await t('HOMESEARCH=on|off; unset = on; it acts only where HOMEPLOTS is on; the licence row says it', () => {
  assert.deepStrictEqual(H.homeSearchSwitches({}, true), { on: true })
  assert.deepStrictEqual(H.homeSearchSwitches({ HOMESEARCH: 'off' }, true), { on: false })
  assert.deepStrictEqual(H.homeSearchSwitches({ HOMESEARCH: 'on' }, false), { on: false }, 'no layout plots, no search to resume')
  assert.deepStrictEqual(H.homeSearchSwitches({}, false), { on: false })
  assert.strictEqual(H.HOMESEARCH.on, false, 'this process: no pool, no layout')
  assert.strictEqual(H.homePlotsModeDetail({ on: true, sw: true, layout: LAYOUT }, undefined, true), 'on=1 switch=1 plots=8 projects=8 later=open shift=4 retry_h=6 search=1')
  assert.strictEqual(H.homePlotsModeDetail({ on: true, sw: true, layout: LAYOUT }, undefined, false), 'on=1 switch=1 plots=8 projects=8 later=open shift=4 retry_h=6 search=0')
  assert.strictEqual(H.HOMEPLOT.resumeMs, 5 * 60_000)
})
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]+\/\/ .*$/gm, '')
const WIRES = {
  'skills.mjs': {
    'HOMESEARCH chooses the whole family or the three looks': ['HOMESEARCH.on ? cottage2StylesAll(stock, lookOpts) : cottage2Styles(stock, lookOpts)', 'cottage2Styles(stock, lookOpts)'],
    'the kept walk is made only under the switch': ['    const walkCache = HOMESEARCH.on ? makeWalkCache() : null\n', '    const walkCache = makeWalkCache()\n'],
    'the search and the canopy hook are given the kept walk, and the plot\'s one planned town': ['        ...(walkCache ? { walkCache, ...pa0, ...siteCanopyCtx(prd, bp, plan.home, stood, sp.walkR, null, walkCache) } : {}),', '        ...({}),'],
    'a finished, refused look carries its reason for the memory': ["more: true, ...(SEARCH_STABLE.includes(s.why) ? { refused: refusalOf(s) } : {}) }", 'more: true }'],
    'the plot is searched through the memory, its looks written to the town\'s file': ["      return await searchPlotLooks(all, { plotId: o.plot.id, sig, memory: () => homeSearch(dir), noteLook: (id, why) => homeSearchNote(dir, o.plot.id, sig, id, why, me), row: f => homePlotRow(bot, { project: plot, ...f }), searchLook: lookOn })\n", '      return await lookOn(all[0])\n'],
    'the signature is the plot\'s ground and reservations now': ['      const sig = plotSig(planReader(bot), o.plot, sp.zones, plan.home)\n', "      const sig = 'x'\n"],
    '`search_time` with the memory on is a resume, never the plot\'s failure': [".then(r => (HOMESEARCH.on && r?.why === 'search_time' ? { ...r, resume: true } : r))", ''],
    'a resumed search is asked again after resumeMs, not 30 min': ['siteWaitSet(plot, ss.resume === true ? HOMEPLOT.resumeMs : COTTAGE_NOSITE_MS, ss.why)', 'siteWaitSet(plot, COTTAGE_NOSITE_MS, ss.why)'],
    'the cottage on a layout plot is not refused by an unfinished road': ['return yieldRoads ? homeZones(zs, landHead()) : zs }', 'return zs }'],
    'only under the switch, only a layout plot': ['    const yieldRoads = HOMESEARCH.on && o.plot.layout === true\n', '    const yieldRoads = true\n'],
    'the placer is given the land record\'s roads': ['homeZones(recordZones(heads.map(x => x.head?.rec).filter(Boolean)), land)', 'recordZones(heads.map(x => x.head?.rec).filter(Boolean))'],
    'the canopy hook\'s walks go through the kept walk': ['  const walkOf = (r, dirty) => (walker && dirty ? walker.walk(r, new Set(), dirty) : siteWalkFrom(r, home, new Set(), walkR, { stood }))\n', '  const walkOf = r => siteWalkFrom(r, home, new Set(), walkR, { stood })\n'],
    'the band\'s road stage is given the home plots too': ['.then(() => check(signal)), keepOff: I.homePlot ?? null }   // homes-02show', '.then(() => check(signal)) }   // homes-02show'],
  },
  'buildsite.mjs': {
    'the search binds the kept walk': ["  const walker = ctx.walkCache && typeof ctx.walkCache.bind === 'function' ? ctx.walkCache.bind(read, home, walkR, { stood }) : null\n", '  const walker = null\n'],
    'the proof is handed the kept walk': ['...(ctx.planned ? { planned: ctx.planned } : {}), ...(walker ? { walker } : {}) }', '...(ctx.planned ? { planned: ctx.planned } : {}) }'],
  },
  'sitecanopy.mjs': {
    'the reach test names the cells its read differs in': ['for (const q of walk(rd, [dug.keys(), laid])) {', 'for (const q of walk(rd)) {'],
  },
}
const wired = (file, src) => { for (const [name, [line]] of Object.entries(WIRES[file])) assert.strictEqual(src.split(line).length - 1, 1, `not wired once (${file}): ${name}`) }
for (const file of Object.keys(WIRES)) {
  const raw = readFileSync(SRC(file), 'utf8')
  await t(`${file} is wired (structural; every anchor on an executable line, once)`, () => { wired(file, raw); for (const [name, [line]] of Object.entries(WIRES[file])) assert.ok(strip(raw).includes(strip(line).trim()), `executable: ${name}`) })
  for (const [name, [line, neu]] of Object.entries(WIRES[file])) {
    await t(`MUTANT (wiring, ${file}) ${name}`, () => {
      assert.strictEqual(raw.split(line).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(line.slice(0, 70))}`)
      const mutant = raw.replace(line, neu)
      assert.notStrictEqual(mutant, raw)
      assert.throws(() => wired(file, mutant), /not wired once/)
    })
  }
}
await t('HOMESEARCH off is slice 1 in the siting: the three looks, no memory, no kept walk (the off path\'s own loop, structural)', () => {
  const c = strip(readFileSync(SRC('skills.mjs'), 'utf8'))
  assert.strictEqual(c.split("    let last = null\n    for (const cs of all) {\n      const r = await lookOn(cs)\n      if (!r.more) return r\n      last = { ok: false, why: r.why, detail: r.detail, tried }\n    }\n    return last ?? { ok: false, why: 'no_site', tried }\n").length - 1, 1)
  assert.strictEqual(c.split('const pa0 = HOMESEARCH.on ? paSiteCtx(planReader(bot), plot) : null').length - 1, 1)
})

console.log(`\nhomesearch: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
