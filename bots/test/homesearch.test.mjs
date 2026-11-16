// HOMES-02SHOW (slice 1b; bots/src/homeplots.mjs searchPlotLooks / plotSig / homeZones, buildsite.mjs makeWalkCache, cottage2.mjs
// cottageLooksAll; skills.mjs cottageSiteOn). LIVE showcase 11-13, the first hour of the layout's home plots: cottage2's three visits
// all ended `search_time` at the 100-s box and nothing was sited -- a visit tried three looks, the next visit the same three again, a
// plot that only ran out of time was put behind the others for 6 h, and every walk of a proof read the whole town.
// BEHAVIOUR: the kept walk IS walkFrom's (key for key, in order) and what it saves (walks counted, before and after); the family's
// 24 looks in one order; the plot's signature and the search's memory; THE CHAIN -- the real cottage siting (siteBlueprintAsync +
// cottageSitingPlan + the family's looks) over three visits on a fake clock: it resumes, reaches look 13 and sites the look that
// fits; `search_time` does not rotate the plot, exhaustion does, a changed world starts again, two bots; unfinished roads yield and
// finished ones do not. REVIEW r3 (section 4b): THE PASS -- its marks have no age while it is under way, it is bounded in visits
// (the plot is passed with its progress kept), and the box is the bound by name (a look cut with a whole box: row `slow`, refused
// 6 h); both of the reviewer's sequences as written, on the project's own clock (`visits`: a paused visit asked again after 5 min, a
// failed one after 30). Structural assertions only for the wiring. Every mutant asserts its anchor present and unique first.
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
// REVIEW r1 (Codex 1a, 3): THE BACKING WORLD MOVES after the walk was kept -- no overlay, no dirty key: another bot's trench
/** A world another bot can dig in: the fake server, and the witness this bot's connection would keep (buildbot.mjs
 *  installServerBlockWitness: seq(), moved(since, { x, z, r })). */
function liveWorld (srv = F.server()) {
  const told = []
  return { srv, read: srv.read, seq: () => told.length, moved: (since, at) => told.slice(since).some(([x, z]) => Math.abs(x - at.x) <= at.r && Math.abs(z - at.z) <= at.r),
    dig: (x, z, depth = 3) => { for (let y = G; y > G - depth; y--) srv.set([x, y, z], 'air'); told.push([x, z]) } }
}
/** The trench: two columns wide, three deep, right across the fake world between the town and the east plots (inside the town circle). */
const TRENCH_X = [14, 15]   // west of the plots' own margin (the signature reads box + 3: from x 17)
const trench = w => { for (let z = -60; z <= 60; z++) for (const x of TRENCH_X) w.dig(x, z) }
await t('THE WORLD MOVES UNDER THE KEPT WALK (a trench cut after it was made, nothing declared): with the connection\'s witness the kept walk is DROPPED and the answer is a fresh walk\'s; with no witness, after WALK_KEEP_MS; inside it the kept walk is stale (what the fresh final proof is for)', () => {
  const far = k => Number(k.split(',')[0]) > 20
  const run = (opts, { tick = 0 } = {}) => {
    const w = liveWorld(); let now = 1e12
    const walker = B.makeWalkCache(opts(w, () => now)).bind(w.read, HOME, 48, { stood: [] })
    const before = [...walker.walk(w.read, new Set(), [])]
    assert.ok(before.some(far), 'POSITIVE CONTROL: the kept walk reaches the land east of the trench\'s line')
    trench(w); now += tick
    return { got: [...walker.walk(w.read, new Set(), [])], want: [...B.walkFrom(w.read, HOME, new Set(), 48, { stood: [] })] }
  }
  const d0 = B.walkStats.dropped
  const witnessed = run(w => ({ seqNow: w.seq, movedSince: w.moved }))
  assert.ok(!witnessed.want.some(far), 'POSITIVE CONTROL: a fresh walk does not cross the trench')
  assert.deepStrictEqual(witnessed.got, witnessed.want, 'the witness: dropped, made again -- the fresh walk\'s answer, key for key')
  assert.strictEqual(B.walkStats.dropped - d0, 1)
  const aged = run((w, now) => ({ now }), { tick: B.WALK_KEEP_MS })
  assert.deepStrictEqual(aged.got, aged.want, 'no witness: dropped at its age limit')
  const young = run((w, now) => ({ now }), { tick: B.WALK_KEEP_MS - 1 })
  assert.ok(young.got.some(far) && !young.want.some(far), 'no witness, inside the limit: STALE -- never published on its word (siteAgainFresh)')
  // a change the witness places OUTSIDE the walk's square drops nothing; a witness that throws reads as moved
  const w = liveWorld(), walker = B.makeWalkCache({ seqNow: w.seq, movedSince: w.moved }).bind(w.read, HOME, 48, { stood: [] })
  walker.walk(w.read, new Set(), []); const d1 = B.walkStats.dropped
  w.dig(58, 58); walker.walk(w.read, new Set(), []); assert.strictEqual(B.walkStats.dropped, d1, 'a block beyond the walk\'s square')
  const boom = B.makeWalkCache({ seqNow: () => 0, movedSince: () => { throw new Error('x') } }).bind(w.read, HOME, 48, { stood: [] })
  boom.walk(w.read, new Set(), []); boom.walk(w.read, new Set(), []); assert.strictEqual(B.walkStats.dropped, d1 + 1)
  assert.strictEqual(B.WALK_KEEP_MS, 10_000)
})
await t('MUTANT the witness\'s word ignored: after the trench the kept walk still answers, and it is not the fresh walk\'s answer', async () => {
  const M = await mutantOf('buildsite.mjs', "    if (witnessed && b.seq != null) { try { return !!movedSince(b.seq, { x: home.x, z: home.z, r: radius + 2 }) } catch { return true } }\n", '    if (witnessed && b.seq != null) return false\n')
  const w = liveWorld(), walker = M.makeWalkCache({ seqNow: w.seq, movedSince: w.moved }).bind(w.read, HOME, 48, { stood: [] })
  walker.walk(w.read, new Set(), []); trench(w)
  assert.notDeepStrictEqual([...walker.walk(w.read, new Set(), [])], [...B.walkFrom(w.read, HOME, new Set(), 48, { stood: [] })])
})
// THE COUNT: one plot (9 x 9 east of home, flat), the family's 24 looks, the real siting -- walks that read the town
const NINE = Object.freeze({ id: 'H1', kind: 'house', layout: true, pad: [21, -3, 27, 3], box: [20, -4, 28, 4] })
const ALL = C.cottage2StylesAll(STOCK, { pool: 'fake', plot: 'cottage2', plotId: 'H1', others: [] })
const ctxOf = (plot, zones = [], extra = {}) => { const sp = C.cottageSitingPlan(HOME, plot, zones); return { zones: sp.zones, stood: [], sectors: sp.sectors, plot: 'cottage2', earth: sp.earth ?? C.COTTAGE_EARTH, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line, tries: 3, ...extra } }
const bpOf = cs => C.styledBlueprint(B.loadBlueprint(cs.id), cs.style)
const slim = s => (s.ok ? { ok: true, at: s.record.anchor, orient: s.record.orient, cells: s.record.cells.map(c => [c.at.join(','), c.stand.join(','), c.order].join('/')) } : { ok: false, why: s.why, fails: s.sectors.map(r => [r.screened, r.proofFails]) })
await t('WALKS THAT READ THE TOWN, one plot\'s 24 looks: every look\'s answer is the same (site, cells, stands, order); a plot REFUSED after its proofs: one walk a proof step -> ONE; the look that is ACCEPTED: the kept walk + one fresh proof\'s walks', async () => {
  const all = (srv, cache) => { const w0 = B.walkStats.walks; const out = ALL.map(cs => slim(B.siteBlueprint(srv.read, F.plan(), bpOf(cs), ctxOf(NINE, [], cache ? { walkCache: cache } : {})))); return { out, walks: B.walkStats.walks - w0 } }
  // every answer the same, kept walk or not (flat ground: the twelve square looks site, the long bodies have no candidate)
  const flatB = all(F.server(), null), flatA = all(F.server(), B.makeWalkCache())
  assert.deepStrictEqual(flatA.out, flatB.out, 'not one answer differs: the proof is not weakened')
  assert.strictEqual(flatB.out.filter(o => o.ok).length, 12)
  // REFUSED AFTER ITS PROOFS: the doorway walled up outside the plot -- every square look is proven segment by segment, then refused
  const walled = () => { const srv = F.server(); for (const z of [-1, 0, 1]) for (const y of [G + 1, G + 2]) srv.set([20, y, z], 'stone'); return srv }
  const before = all(walled(), null), after = all(walled(), B.makeWalkCache())
  assert.deepStrictEqual(after.out, before.out)
  assert.deepStrictEqual([before.out.filter(o => o.ok).length, before.out.filter(o => o.why === 'no_proven_site').length], [0, 12])
  assert.ok(before.walks >= 12 * 8, `before: a walk a segment of every proof (${before.walks})`)
  assert.strictEqual(after.walks, 1, 'after: ONE walk of the town for the plot')
  // THE ACCEPTED LOOK (review r1): the kept walk's site is proven AGAIN with plain walks before it is published (siteAgainFresh)
  const one = cache => { const w0 = B.walkStats.walks; const s = B.siteBlueprint(F.server().read, F.plan(), bpOf(ALL[0]), ctxOf(NINE, [], cache ? { walkCache: cache } : {})); return { s, walks: B.walkStats.walks - w0 } }
  const plain = one(null), kept = one(B.makeWalkCache())
  const w1 = B.walkStats.walks
  const again = await B.siteAgainFresh(kept.s, F.server().read, F.plan(), bpOf(ALL[0]), ctxOf(NINE, [], { walkCache: B.makeWalkCache() }), { sliceMs: 0 })
  const fresh = B.walkStats.walks - w1
  assert.deepStrictEqual(slim(again), slim(plain.s), 'the fresh proof\'s record is the plain search\'s')
  assert.deepStrictEqual([kept.walks, fresh], [1, plain.walks], 'the kept walk, then exactly one proof\'s walks')
  console.log(`        walks that read the town -- 24 looks on a plot refused after its proofs: before ${before.walks}, after ${after.walks}; the look that is accepted: before ${plain.walks}, after ${kept.walks} + ${fresh} (its fresh proof)`)
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
  assert.deepStrictEqual(H.searchLeft(m, 'H1', 's1', ids, now), { left: ids, refused: 0, first: 0, tally: '', proofs: [], softs: [], soft: null, slow: [], done: 0, visits: 0, promoted: null })
  m = H.searchNoted(m, 'H1', 's1', 'a', 'no_site:liquid', { now, by: 'A' })
  m = H.searchNoted(m, 'H1', 's1', 'b', 'no_proven_site:cell_not_free', { now: now + 1000, by: 'B' })
  m = H.searchNoted(m, 'H1', 's1', 'c', 'no_site:liquid', { now: now + 2000, by: 'A' })
  assert.deepStrictEqual(H.searchLeft(m, 'H1', 's1', ids, now + 3000), { left: ['d'], refused: 3, first: 3, tally: 'no_site:liquid=2,no_proven_site:cell_not_free=1', proofs: [], softs: [], soft: null, slow: [], done: 0, visits: 0, promoted: null })
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
await t('REVIEW r3 -- THE PASS (pure): a proof\'s refusal and a soft answer are marks of the PASS -- no age of their own while it is under way (every step stamps it), and the screen\'s refusals do not age out from under it; a pass with no step for 6 h is abandoned; `end` drops the marks, `rest` keeps them; the cut look is first until it is marked; the box\'s refusal is 6 h', () => {
  const ids = ['a', 'b', 'c', 'd'], now = 1e12, P = H.HOMEPLOT.passKeepMs, HOUR = 3_600_000
  assert.deepStrictEqual([P, H.HOMEPLOT.passVisits, H.HOMEPLOT.slowKeepMs, H.HOMEPLOT.proofKeepMs, H.HOMEPLOT.softKeepMs], [6 * HOUR, 4, 6 * HOUR, undefined, undefined])
  let m = H.searchNoted({}, 'H1', 's1', 'a', 'no_site:liquid', { now, life: 'ground' })
  assert.strictEqual(m.H1.pass, undefined, 'the screen\'s refusal is the plot\'s own: no pass holds it')
  m = H.searchNoted(m, 'H1', 's1', null, null, { now: now + 500, pass: 'visit' })
  m = H.searchNoted(m, 'H1', 's1', 'b', 'no_proven_site:no_step', { now: now + 1000, life: 'proof' })
  m = H.searchNoted(m, 'H1', 's1', 'c', 'approach_unread', { now: now + 2000, life: 'soft' })
  assert.deepStrictEqual(m.H1.pass, { at: now + 500, last: now + 2000, visits: 1, done: { b: { why: 'no_proven_site:no_step', kind: 'proof' }, c: { why: 'approach_unread', kind: 'soft' } } })
  assert.deepStrictEqual(m.H1.looks, { a: 'no_site:liquid' })
  const at = (t0, mm = m) => H.searchLeft(mm, 'H1', 's1', ids, t0)
  const st = at(now + 3000)
  assert.deepStrictEqual([st.left, st.refused, st.proofs, st.softs, st.soft, st.done, st.visits, st.tally, st.first], [['d'], 2, ['b'], ['c'], 'approach_unread', 2, 1, 'no_proven_site:no_step=1,no_site:liquid=1', 3])
  // NO AGE OF THEIR OWN: 30 min (the life they had), an hour, 5 h 59 on -- the pass is under way
  for (const dt of [30 * 60_000, HOUR, P - 1]) assert.deepStrictEqual(at(now + 2000 + dt).left, ['d'], `${dt / 60_000} min after the pass's last step`)
  // ABANDONED (no step for 6 h): the pass's marks are gone, the screen's refusal stands
  assert.deepStrictEqual([at(now + 2000 + P).left, at(now + 2000 + P).done, at(now + 2000 + P).visits], [['b', 'c', 'd'], 0, 0])
  // a pass that is being worked lasts as long as it takes: a step every 5 h for 30 h -- and the screen's refusal (a day's) stays under it
  let long = m
  for (let h = 5; h <= 30; h += 5) long = H.searchNoted(long, 'H1', 's1', null, null, { now: now + h * HOUR, pass: h % 10 ? 'visit' : 'rest' })
  assert.deepStrictEqual([at(now + 31 * HOUR, long).left, long.H1.looks, Object.keys(long.H1.pass.done), long.H1.pass.at], [['d'], { a: 'no_site:liquid' }, ['b', 'c'], now + 500])
  assert.deepStrictEqual(at(now + 25 * HOUR).left, ids, 'POSITIVE CONTROL: with no pass under way the entry is a day\'s')
  assert.deepStrictEqual(H.searchLeft(m, 'H1', 's2', ids, now + 3000).left, ids, 'another signature forgets all of it')
  // the pass's steps
  const rest = H.searchNoted(m, 'H1', 's1', null, null, { now: now + 4000, pass: 'rest' })
  assert.deepStrictEqual([rest.H1.pass.visits, Object.keys(rest.H1.pass.done), rest.H1.pass.at, rest.H1.pass.last], [0, ['b', 'c'], now + 500, now + 4000], '`rest`: the count back to 0, the progress kept')
  const end = H.searchNoted(m, 'H1', 's1', null, null, { now: now + 4000, pass: 'end' })
  assert.deepStrictEqual([end.H1.pass, end.H1.looks, at(now + 5000, end).left], [undefined, { a: 'no_site:liquid' }, ['b', 'c', 'd']], '`end`: the pass and its marks dropped, the screen\'s refusal kept')
  // the look the box cut: first next time, until it is marked
  const cut = H.searchNoted(m, 'H1', 's1', null, null, { now: now + 4000, first: 'd' })
  assert.deepStrictEqual([cut.H1.pass.first, at(now + 5000, cut).promoted, at(now + 5000).promoted], ['d', 'd', null])
  const marked = H.searchNoted(cut, 'H1', 's1', 'd', 'no_proven_site:no_step', { now: now + 6000, life: 'proof' })
  assert.deepStrictEqual([marked.H1.pass.first, at(now + 7000, marked).promoted, at(now + 7000, marked).left], [undefined, null, []])
  // a soft answer now outweighs a proof's older word; the screen's refusal of a look replaces its mark
  assert.deepStrictEqual(H.searchNoted(m, 'H1', 's1', 'b', 'approach_unread', { now: now + 4000, life: 'soft' }).H1.pass.done.b, { why: 'approach_unread', kind: 'soft' })
  const g = H.searchNoted(m, 'H1', 's1', 'b', 'no_site', { now: now + 4000, life: 'ground' })
  assert.deepStrictEqual([g.H1.looks, Object.keys(g.H1.pass.done)], [{ a: 'no_site:liquid', b: 'no_site' }, ['c']])
  // THE BOX'S REFUSAL: done for the pass it was cut in, and 6 h from its stamp after it
  const slow = H.searchNoted(m, 'H1', 's1', 'd', 'slow', { now: now + 4000, life: 'slow', ms: 100_000 })
  assert.deepStrictEqual([slow.H1.slow, slow.H1.pass.done.d], [{ d: { at: now + 4000, ms: 100_000 } }, { why: 'slow', kind: 'slow' }])
  const ss = at(now + 5000, slow)
  assert.deepStrictEqual([ss.left, ss.refused, ss.slow, ss.tally], [[], 3, ['d'], 'no_proven_site:no_step=1,no_site:liquid=1,slow=1'])
  const over = H.searchNoted(slow, 'H1', 's1', null, null, { now: now + 6000, pass: 'end' })
  const S6 = H.HOMEPLOT.slowKeepMs
  assert.deepStrictEqual([at(now + 4000 + S6 - 1, over).left, at(now + 4000 + S6 - 1, over).slow, at(now + 4000 + S6, over).left], [['b', 'c'], ['d'], ['b', 'c', 'd']], 'after its pass: refused until 6 h from the cut, then tried again')
})
await t('REVIEW r1 -- how a refused look is remembered (refusalKind): the SCREEN\'s refusal with every cell read -> `ground`; a PROOF\'s -> `proof`; an unread cell, an unread approach, an unreadable guard, a stale kept walk -> `soft` (written nowhere)', () => {
  const screen = (rejects = { domain: 9, liquid: 30 }) => ({ ok: false, why: 'no_site', sectors: [{ screened: 0, rejects, proofFails: {} }] })
  const proof = (proofFails = { no_step: 3 }) => ({ ok: false, why: 'no_proven_site', sectors: [{ screened: 3, rejects: { domain: 9 }, proofFails }] })
  assert.deepStrictEqual(H.refusalKind(screen()), { why: 'no_site:liquid', life: 'ground' })
  assert.deepStrictEqual(H.refusalKind(screen(), { unread: 40, guardUnread: true }), { why: 'no_site:liquid', life: 'ground' }, 'the screen reads the plot alone: the approach and the guard do not touch it')
  assert.deepStrictEqual(H.refusalKind(screen({ domain: 9, unknown: 2, liquid: 30 })), { soft: 'unknown_cell' }, 'the screen met an unread cell')
  assert.deepStrictEqual(H.refusalKind(proof()), { why: 'no_proven_site:no_step', life: 'proof' })
  assert.deepStrictEqual(H.refusalKind(proof(), { unread: 1 }), { soft: 'approach_unread' }, 'Claude (ii): ground the siting bot has not loaded')
  assert.deepStrictEqual(H.refusalKind(proof(), { guardUnread: true }), { soft: 'guard_unread' }, 'Claude (iii): the tree guard could not be read')
  assert.deepStrictEqual(H.refusalKind(proof({ unknown: 1, no_step: 2 })), { soft: 'unknown_cell' })
  assert.deepStrictEqual(H.refusalKind({ ...proof(), stale: true }), { soft: 'kept_walk_stale' })
  assert.strictEqual(H.refusalKind({ ok: true }), null); assert.strictEqual(H.refusalKind({ ok: false, why: 'search_time', sectors: [] }), null)
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
/** The marks of a plot's pass under way, of one kind ('proof', 'soft', 'slow'). */
const marksOf = (mem, kind, id = 'H1') => Object.values(mem.search[id]?.pass?.done ?? {}).filter(q => q.kind === kind).length
/** How many looks of a plot the memory holds refused: the screen's, and the pass's own (a proof's, the box's). */
const refusedN = (mem, id = 'H1') => Object.keys(mem.search[id]?.looks ?? {}).length + marksOf(mem, 'proof', id) + marksOf(mem, 'slow', id)
/** A reader that KEEPS what it read, as skills.mjs planReader does (`memo: false`: one that keeps nothing). `after(walks)`: called on a
 *  read once that many walks of the town have been made since the reader was made (what another bot does while a proof runs). */
function keptReader (srv, M, { memo = true, after = null } = {}) {
  const kept = new Map(), w0 = M.walkStats.walks
  let fired = false
  return (x, y, z) => {
    if (after && !fired && M.walkStats.walks - w0 >= after.walks) { fired = true; after.then() }
    if (!memo) return srv.read(x, y, z)
    const k = `${x},${y},${z}`
    if (!kept.has(k)) kept.set(k, srv.read(x, y, z))
    return kept.get(k)
  }
}
/** One VISIT: skills.mjs cottageSiteFor's own shape -- siteOverPlots over the offered plots, each plot searchPlotLooks, and for a
 *  look skills.mjs lookOn's steps with the real pieces: the search with the plot's ONE kept walk (siteBlueprintAsync), what it
 *  accepts proven AGAIN fresh on a world that held still (siteAgainSteady) and only that record answered, a refusal remembered as
 *  refusalKind says. A 100-s box on a fake clock (a finished look costs `cost` -- a number, or (plot, look index) -> ms; a spent box
 *  gives the next search 0 ms, which the real search answers `search_time`). `need(plot, i)`: the ms this look's SEARCH needs -- more
 *  than is left of the box and the box cuts it there; `proof(plot, i)`: the ms its FRESH PROOF needs after an accepted search --
 *  likewise. `tried`: the looks begun with any of the box left, `searched`: the ones whose search finished. `mem`: the town file ({ fails, search }). `w`: a liveWorld (its witness is the connection's)
 *  or a fake server. `between(i, plot)`: what another bot does after look i's kept-walk search and before its fresh proof;
 *  `during(plot, run)`: after the first walk of a fresh proof (its `run`-th). `unread`: a number, or plot -> number. */
async function visit (w, mem, plots, { cost = 22_000, need = null, proof = null, boxMs = 100_000, now = Date.now(), who = 'A', looks = () => ALL, witness = false, unread = 0, guardUnread = false, between = null, during = null, M = B, MH = H } = {}) {
  const srv = w.srv ?? w
  let spent = 0
  const box = { left: () => Math.max(0, boxMs - spent) }
  const rows = [], searched = [], tried = [], published = []
  const cut = () => { spent = boxMs; return { ok: false, why: 'search_time' } }
  const siteOne = plot => {
    const all = looks(plot), sig = H.plotSig(srv.read, plot, [], HOME), boxFresh = searched.length === 0
    const cache = M.makeWalkCache(witness ? { seqNow: w.seq, movedSince: w.moved } : { now: () => now + spent })
    const note = (id, why, o) => { mem.search = MH.searchNoted(mem.search, plot.id, sig, id, why, { now, by: who, ...o }) }
    return MH.searchPlotLooks(all, { plotId: plot.id, sig, boxFresh, boxMs: boxFresh ? box.left() : null, now: () => now, memory: () => mem.search, note,
      row: f => rows.push(f),
      searchLook: async cs => {
        const bp = bpOf(cs), i = all.indexOf(cs), ctx = ctxOf(plot, [], { walkCache: cache })
        if (box.left() > 0) tried.push(`${plot.id}:${i}`)
        if (need && need(plot, i) > box.left()) return cut()   // the box ends while the look's search runs
        const s = await M.siteBlueprintAsync(srv.read, F.plan(), bp, ctx, { sliceMs: 0, maxMs: box.left() })
        if (M.siteLoopEnds(s)) return { ok: false, why: M.siteLoopEnds(s) }
        spent += typeof cost === 'function' ? cost(plot, i) : cost; searched.push(`${plot.id}:${i}`)
        if (!s.ok) { const k = H.refusalKind(s, { unread: typeof unread === 'function' ? unread(plot) : unread, guardUnread }); return { ok: false, why: s.why, more: true, ...(k?.life ? { refused: k.why, life: k.life } : k?.soft ? { soft: k.soft } : {}) } }
        between?.(i, plot)
        if (proof && proof(plot, i) > box.left()) return cut()   // ...or while its fresh proof does
        if (proof) spent += proof(plot, i)
        let run = 0
        const s2 = await M.siteAgainSteady(s, F.plan(), bp, { readOf: ro => { run++; const n = run; return keptReader(srv, M, { ...ro, after: during ? { walks: 2, then: () => during(plot, n) } : null }) },
          ctxOf: () => ctx, optsOf: () => ({ sliceMs: 0, maxMs: box.left() }), ...(witness ? { seqNow: w.seq, movedSince: w.moved, area: { x: HOME.x, z: HOME.z, r: ctx.walkR + 2 } } : {}) })
        if (M.siteLoopEnds(s2)) return { ok: false, why: M.siteLoopEnds(s2) }
        if (s2.moved) { cache.drop(); return { ok: false, why: 'no_proven_site', soft: H.refusalKind(s2).soft } }
        if (!s2.ok) { cache.drop(); return { ok: false, why: 'no_proven_site', more: true, soft: H.refusalKind({ ...s2, stale: true }).soft } }
        published.push(`${plot.id}:${i}`)
        return { ok: true, why: 'ok', look: cs.id, record: C.cottageRecordOf(s2.record, bp, cs.style, { plotId: plot.id }) }
      } }).then(r => (r?.why === 'search_time' ? { ...r, resume: true } : r))
  }
  const fail = (p, why, soft) => { mem.fails = H.failNoted(mem.fails, p.id, { why, project: 'cottage2', by: who, now, soft }) }
  const r = await MH.siteOverPlots(plots, siteOne, { left: box.left, row: f => rows.push(f), noteFail: (p, why) => fail(p, why, false), noteSoft: (p, why) => fail(p, `soft:${why}`, true) })
  return { r, rows: rows.map(f => [f.op, f.plot, f.look ?? f.why ?? ''].join(':').replace(/:$/, '')), raw: rows, searched, tried, published }
}
/** THE PROJECT'S VISITS on the fake clock: the offer rotated as the town's file says (houseOffer); a paused visit is asked again after
 *  its 100-s box + HOMEPLOT.resumeMs (5 min), a failed one after the box + the project's own 30 min (skills.mjs COTTAGE_NOSITE_MS).
 *  It stops when the cottage is sited, or at the visit `stop(visit)` says. -> { out: [{ at, order, ...visit }], mem } */
async function visits (w, n, { layout = [NINE, H2P], mem = { fails: {}, search: {} }, t0 = 1e12, stop = null, ...opts } = {}) {
  const out = []
  let now = t0
  for (let i = 0; i < n; i++) {
    const plots = H.houseOffer({ layout, fails: mem.fails, now }).plots
    const v = await visit(w, mem, plots, { now, ...opts })
    out.push({ at: now - t0, order: plots.map(p => p.id).join(''), ...v })
    if (v.r.ok || stop?.(v)) break
    now += 100_000 + (v.r.resume === true ? H.HOMEPLOT.resumeMs : 30 * 60_000)
  }
  return { out, mem }
}
/** The looks of one plot the visits began, in order (their indices). */
const triedOf = (out, id = 'H1') => out.flatMap(v => v.tried.filter(x => x.startsWith(`${id}:`)).map(x => Number(x.slice(id.length + 1))))
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
  assert.strictEqual(refusedN(mem), 5); assert.deepStrictEqual([Object.keys(mem.search.H1.looks).length, marksOf(mem, 'proof'), mem.search.H1.pass.visits, mem.search.H1.pass.first], [2, 3, 1, ALL[5].id], 'the long bodies by the screen (the plot\'s own), the square looks by proof (the pass\'s); the look the box cut is first next time')
  const v2 = await visit(srv, mem, [NINE, H2P], { now: 1e12 + 5 * 60_000, who: 'B' })
  assert.deepStrictEqual(v2.rows, ['chosen:H1', 'resumed:H1:5', 'paused:H1:search_time'])
  assert.deepStrictEqual(v2.searched, ['H1:5', 'H1:6', 'H1:7', 'H1:8', 'H1:9'], 'never the first five again')
  const v3 = await visit(srv, mem, [NINE, H2P], { now: 1e12 + 10 * 60_000 })
  assert.deepStrictEqual(v3.rows, ['chosen:H1', 'resumed:H1:10'])
  assert.deepStrictEqual(v3.searched, ['H1:10', 'H1:11', 'H1:12', 'H1:13'])
  assert.ok(v3.r.ok, v3.r.why)
  assert.deepStrictEqual([v3.r.plotId, v3.r.look, v3.r.record.blueprint, v3.r.record.plotId], ['H1', 'cottage@2-Csl0-', 'cottage@2-Csl0-', 'H1'])
  assert.ok(v3.r.record.cells.length > 150 && meets(NINE.box, v3.r.record.box), 'a whole cottage record on the plot')
  assert.strictEqual(refusedN(mem), 13); assert.deepStrictEqual(mem.fails, {})
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
await t('EXHAUSTION ROTATES: with nothing fitting, the plot\'s 24 looks are refused over four visits (16 s a look: seven a visit, inside the visits\' bound); then it is `exhausted` (the tally), noted failed, and the NEXT plot is tried -- and sited -- in the same visit', async () => {
  const srv = world([[24, 73, 0], [24, 72, -1], [22, 72, 0], [26, 73, 1], [25, 74, 0]]), mem = { fails: {}, search: {} }
  let v = null, n = 0
  const firstOk = B.siteBlueprint(srv.read, F.plan(), bpOf(ALL[FIT]), ctxOf(NINE))
  assert.strictEqual(firstOk.ok, false, 'POSITIVE CONTROL: the fitting look is blocked too')
  for (; n < 8; n++) { v = await visit(srv, mem, [NINE, H2P], { now: 1e12 + n * 300_000, cost: 16_000 }); if (v.rows.some(r => /^exhausted:H1:/.test(r))) break; assert.deepStrictEqual(mem.fails, {}); assert.deepStrictEqual([v.r.why, v.r.resume], ['search_time', true]) }
  assert.strictEqual(n, 3, 'three paused visits, the fourth ends the plot')
  const ex = v.rows.find(r => /^exhausted:H1:/.test(r))
  assert.ok(/no_site=12/.test(ex) && /no_proven_site:cell_not_free=12/.test(ex), `the tally of reasons: ${ex}`)
  assert.deepStrictEqual([mem.fails.H1.why, mem.fails.H1.n, mem.search.H1.pass], ['exhausted', 1, undefined], 'the pass is over: its marks are dropped')
  assert.ok(v.rows.includes('chosen:H2'), 'the next plot in the same visit')
  assert.ok(v.r.ok && v.r.plotId === 'H2' && v.published.join() === 'H2:0', `...and it is sited (${v.r.why})`)
  assert.deepStrictEqual(H.houseOffer({ layout: [NINE, H2P], fails: mem.fails, now: 1e12 + n * 300_000 + 1 }).plots.map(p => p.id), ['H2', 'H1'], 'H1 behind the others for 6 h')
  // back at the plot after the 6 h, the ground unchanged: the SCREEN's twelve refusals still stand (a day, under the signature); the
  // twelve a PROOF refused were that pass's word and are searched again -- never answered from memory
  const again = await visit(srv, { fails: {}, search: mem.search }, [NINE], { now: 1e12 + 7 * 3_600_000 })
  assert.deepStrictEqual([again.r.why, again.rows[1]], ['search_time', 'resumed:H1:0'])
  assert.deepStrictEqual(again.searched, ['H1:0', 'H1:2', 'H1:4', 'H1:5', 'H1:6'], 'the square looks only: the long bodies\' refusal is the plot\'s own')
  assert.strictEqual(H.homePlotRowDetail({ project: 'cottage2', op: 'exhausted', plot: 'H1', why: 'no_site=12,no_proven_site:cell_not_free=12' }), 'project=cottage2 op=exhausted plot=H1 why=no_site=12,no_proven_site:cell_not_free=12')
})
await t('A CHANGED WORLD RESETS THE MEMORY: the blockers gone after visit 1 (the signature moves) -> the search starts at look 0 again and look 0 is sited', async () => {
  const mem = { fails: {}, search: {} }
  const v1 = await visit(world(), mem, [NINE], { now: 1e12 })
  assert.strictEqual(refusedN(mem), 5)
  const v2 = await visit(F.server(), mem, [NINE], { now: 1e12 + 300_000 })   // the same plot, the hanging blocks cut
  assert.deepStrictEqual(v2.rows, ['chosen:H1'], 'no `resumed` row: nothing is passed over')
  assert.deepStrictEqual(v2.searched, ['H1:0']); assert.ok(v2.r.ok); assert.strictEqual(v2.r.look, ALL[0].id)
  assert.strictEqual(v1.r.why, 'search_time')
})
await t('TWO BOTS ON ONE PLOT at once: both start at the same look (the work is done twice, never wrongly), neither drops the other\'s looks, and the next visit resumes past the union', async () => {
  const srv = world(), mem = { fails: {}, search: {} }
  const [a, b] = await Promise.all([visit(srv, mem, [NINE], { now: 1e12, who: 'A' }), visit(srv, mem, [NINE], { now: 1e12, who: 'B', cost: 34_000 })])
  assert.deepStrictEqual(a.searched, ['H1:0', 'H1:1', 'H1:2', 'H1:3', 'H1:4']); assert.deepStrictEqual(b.searched, ['H1:0', 'H1:1', 'H1:2'])
  assert.deepStrictEqual(refusedN(mem), 5, 'the union: five looks refused')
  const v = await visit(srv, mem, [NINE], { now: 1e12 + 300_000 })
  assert.deepStrictEqual(v.rows.slice(0, 2), ['chosen:H1', 'resumed:H1:5'])
})
await t('REVIEW r1 (Codex 1b) THE TRENCH, end to end: the kept walk accepts look 0; another bot cuts a trench before it is published; the fresh proof refuses it -- NOTHING is published for the plot, the look is not remembered, the plot is passed (not failed) and the next plot is sited', async () => {
  const w = liveWorld(), mem = { fails: {}, search: {} }
  let cut = false
  const v = await visit(w, mem, [NINE, H2P], { now: 1e12, cost: 1_000, between: (i, plot) => { if (plot.id === 'H1' && !cut) { cut = true; trench(w) } } })
  assert.ok(cut, 'POSITIVE CONTROL: the kept walk DID accept look 0 on H1 (the reviewer\'s `ok: true`)')
  assert.ok(!v.published.some(x => /^H1:/.test(x)), `nothing published on H1: ${v.published}`)
  assert.ok(!Object.hasOwn(mem.search.H1?.looks ?? {}, ALL[0].id) && !Object.hasOwn(mem.search.H1?.slow ?? {}, ALL[0].id), 'look 0 is NOT remembered as refused')
  assert.ok(v.searched.length > 12 && v.searched.includes('H1:2'), 'the search went on to the next looks')
  assert.deepStrictEqual([mem.fails.H1.soft, mem.fails.H1.why], [true, 'soft:kept_walk_stale'], 'the plot is not failed: passed, behind the others for 30 min')
  assert.ok(v.rows.some(x => /^passed:H1:kept_walk_stale/.test(x)), JSON.stringify(v.rows.filter(x => !/^chosen|^resumed/.test(x))))
  assert.ok(v.r.ok && v.r.plotId === 'H2', 'the next plot, west of the town, is sited in the same visit')
  assert.deepStrictEqual(v.published, ['H2:0'])
  // the looks after it were refused on a walk made AGAIN (the stale one was dropped): the long bodies by the screen, the square by proof;
  // look 0's own mark (done for this pass) and the eleven proofs' are gone with the pass
  assert.deepStrictEqual([Object.keys(mem.search.H1.looks).length, mem.search.H1.pass, mem.search.H1.slow], [12, undefined, undefined])
})
await t('...with the connection\'s witness (Codex 1a) the trench drops the kept walk before the next look: that look is refused by its own search, exactly as a fresh search refuses it', async () => {
  const w = liveWorld()
  const cache = B.makeWalkCache({ seqNow: w.seq, movedSince: w.moved })
  const s0 = B.siteBlueprint(w.read, F.plan(), bpOf(ALL[0]), ctxOf(NINE, [], { walkCache: cache }))
  assert.ok(s0.ok, 'the kept walk is warm: look 0 sites')
  trench(w)
  const kept = B.siteBlueprint(w.read, F.plan(), bpOf(ALL[2]), ctxOf(NINE, [], { walkCache: cache })), fresh = B.siteBlueprint(w.read, F.plan(), bpOf(ALL[2]), ctxOf(NINE))
  assert.deepStrictEqual([fresh.ok, fresh.why], [false, 'no_proven_site'])
  assert.deepStrictEqual(slim(kept), slim(fresh))
  // the reviewer's reproduction, with no witness and inside the age limit: the kept walk says ok, the fresh proof says no
  const w2 = liveWorld(), c2 = B.makeWalkCache({ now: () => 1e12 })
  B.siteBlueprint(w2.read, F.plan(), bpOf(ALL[0]), ctxOf(NINE, [], { walkCache: c2 })); trench(w2)
  const stale = B.siteBlueprint(w2.read, F.plan(), bpOf(ALL[2]), ctxOf(NINE, [], { walkCache: c2 }))
  assert.strictEqual(stale.ok, true, 'REPRODUCED: cached ok:true')
  const again = await B.siteAgainFresh(stale, w2.read, F.plan(), bpOf(ALL[2]), ctxOf(NINE, [], { walkCache: c2 }), { sliceMs: 0 })
  assert.deepStrictEqual([again.ok, again.why], [false, 'no_proven_site'], '...and the fresh proof refuses it before anything is published')
})
await t('MUTANT the fresh proof made with the kept walk left in: the site behind the trench is PUBLISHED', async () => {
  const M = await mutantOf('buildsite.mjs', "  const { walkCache, ...rest } = ctx\n  void walkCache\n", '  const rest = ctx\n')
  const w = liveWorld(), mem = { fails: {}, search: {} }
  let cut = false
  const v = await visit(w, mem, [NINE, H2P], { now: 1e12, cost: 1_000, M, between: (i, plot) => { if (plot.id === 'H1' && !cut) { cut = true; trench(w) } } })
  assert.deepStrictEqual(v.published, ['H1:0'], 'the mutant publishes a cottage no bot can walk to')
})
await t('REVIEW r1 (Codex 2) THE APPROACH BROKEN, THEN RESTORED: with the trench every look is refused and the plot is exhausted (a real search); the trench filled in, the SAME signature -- the next visit searches the proof-refused looks again and SITES look 0 (it read `exhausted` for 24 h before)', async () => {
  const w = liveWorld(), mem = { fails: {}, search: {} }
  trench(w)
  const sig0 = H.plotSig(w.read, NINE, [], HOME)
  const v1 = await visit(w, mem, [NINE], { now: 1e12, cost: 1_000 })
  assert.deepStrictEqual([v1.r.why, v1.searched.length, v1.published], ['exhausted', 24, []])
  assert.deepStrictEqual([Object.keys(mem.search.H1.looks).length, mem.search.H1.pass, mem.fails.H1.why, v1.rows.find(x => /^exhausted/.test(x))], [12, undefined, 'exhausted', 'exhausted:H1:no_proven_site:no_step=12,no_site=12'], 'exhausted on the pass\'s own searches; the proofs\' refusals end with it')
  for (let z = -60; z <= 60; z++) for (const x of TRENCH_X) for (let y = G; y > G - 3; y--) w.srv.set([x, y, z], y === G ? 'grass_block' : 'stone')   // another bot fills the trench in
  assert.strictEqual(H.plotSig(w.read, NINE, [], HOME), sig0, 'the plot\'s own signature has not moved: the trench is far from it')
  const v2 = await visit(w, mem, [NINE], { now: 1e12 + 10 * 60_000, cost: 1_000 })
  assert.deepStrictEqual(v2.rows.slice(0, 2), ['chosen:H1', 'resumed:H1:0'], 'the proofs\' refusals are searched again, never answered from memory')
  assert.ok(v2.r.ok, v2.r.why); assert.deepStrictEqual([v2.r.look, v2.published], [ALL[0].id, ['H1:0']])
  // and with ONLY the screen's refusals (a plot no look has a candidate on) the answer from memory is right: exhausted, no search
  const pond = F.server(); for (let x = 17; x <= 31; x++) for (let z = -7; z <= 7; z++) pond.set([x, G, z], 'water')
  const mem2 = { fails: {}, search: {} }
  const p1 = await visit(pond, mem2, [NINE], { now: 1e12, cost: 1_000 }), p2 = await visit(pond, mem2, [NINE], { now: 1e12 + 3_600_000, cost: 1_000 })
  assert.deepStrictEqual([p1.r.why, p1.searched.length, mem2.search.H1.pass, p2.r.why, p2.searched], ['exhausted', 24, undefined, 'exhausted', []])
})
await t('MUTANT a proof\'s refusal kept like the screen\'s: after the approach is restored the plot is answered `exhausted` from memory and never searched', async () => {
  const M = await mutantOf('homeplots.mjs', "    if (life === 'proof' || life === 'soft') { if (!Object.hasOwn(looks, id) && !Object.hasOwn(slow, id)) begin().done[id] = { why: w, kind: life } } else {\n", "    if (life === 'soft') { if (!Object.hasOwn(looks, id) && !Object.hasOwn(slow, id)) begin().done[id] = { why: w, kind: life } } else {\n")
  const passOver = async MH => {
    let search = {}
    for (const [i, cs] of ALL.entries()) search = MH.searchNoted(search, 'H1', 's', cs.id, 'no_proven_site:no_step', { now: 1e12 + i, life: 'proof' })
    search = MH.searchNoted(search, 'H1', 's', null, null, { now: 1e12 + 30, pass: 'end' })   // the pass that refused them all is over
    let ran = 0
    const r = await H.searchPlotLooks(ALL, { plotId: 'H1', sig: 's', now: () => 1e12 + 600_000, memory: () => search, searchLook: async () => { ran++; return { ok: true } } })
    return [r.ok, r.why, ran]
  }
  assert.deepStrictEqual(await passOver(M), [false, 'exhausted', 0], 'the mutant\'s memory: exhausted, no search')
  assert.deepStrictEqual(await passOver(H), [true, undefined, 1], 'the real memory: the looks are searched again')
})
await t('REVIEW r1 (Claude ii, iii) GROUND NOT LOADED / A GUARD UNREADABLE: the proofs\' refusals are written NOWHERE, the plot is passed (not failed, not exhausted), and the next visit searches it again', async () => {
  const w = liveWorld(); trench(w)   // every candidate unreached, as on ground the siting bot has not loaded
  for (const opts of [{ unread: 40 }, { guardUnread: true }]) {
    const mem = { fails: {}, search: {} }
    const v = await visit(w, mem, [NINE, H2P], { now: 1e12, cost: 1_000, ...opts })
    assert.deepStrictEqual([mem.search.H1.pass, mem.search.H1.slow], [undefined, undefined], 'no proof refusal is stored; the pass\'s own marks are cleared at its end')
    assert.strictEqual(Object.keys(mem.search.H1.looks).length, 12, 'the screen\'s refusals (the long bodies) are the plot\'s own: kept')
    assert.deepStrictEqual([mem.fails.H1.soft, Object.keys(mem.fails)], [true, ['H1']], 'passed, not failed'); assert.ok(v.rows.some(x => new RegExp(`^passed:H1:${opts.unread ? 'approach_unread' : 'guard_unread'}`).test(x)), JSON.stringify(v.rows.slice(-4)))
    assert.ok(v.r.ok && v.r.plotId === 'H2')
    const v2 = await visit(w, mem, [NINE], { now: 1e12 + 300_000, cost: 1_000, ...opts })
    assert.strictEqual(v2.searched.length, 12, 'the twelve square looks are searched again, every visit, until the ground can be read')
    assert.notStrictEqual(v2.r.why, 'exhausted')
  }
})
await t('`exhausted` is never answered from a proof\'s word in memory: a pass found complete but never closed (the visit ended between the two writes) is dropped and its proof looks are searched now; a search that met an unread approach leaves the plot un-exhausted', async () => {
  let search = {}
  for (const [i, cs] of ALL.entries()) search = H.searchNoted(search, 'H1', 's', cs.id, i % 2 ? 'no_site' : 'no_proven_site:no_step', { now: 1e12, life: i % 2 ? 'ground' : 'proof' })
  assert.deepStrictEqual([H.searchLeft(search, 'H1', 's', ALL.map(q => q.id), 1e12 + 1).left, Object.keys(search.H1.pass.done).length], [[], 12], 'every look is refused in memory, twelve by a proof')
  const ran = [], rows = []
  const note = at => (id, why, o) => { search = H.searchNoted(search, 'H1', 's', id, why, { now: at, ...o }) }
  const r = await H.searchPlotLooks(ALL, { plotId: 'H1', sig: 's', now: () => 1e12 + 60_000, memory: () => search, row: f => rows.push(`${f.op}:${f.look}:${f.refused}`), note: note(1e12 + 60_000),
    searchLook: async cs => { ran.push(ALL.indexOf(cs)); return { ok: false, why: 'no_proven_site', more: true, refused: 'no_proven_site:no_step', life: 'proof' } } })
  assert.deepStrictEqual(ran, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], 'the proof-refused looks only')
  assert.deepStrictEqual([r.why, r.detail, rows, search.H1.pass], ['exhausted', 'no_proven_site:no_step=12,no_site=12', ['resumed:0:12'], undefined], 'exhausted after a real search, on that pass\'s own word')
  const soft = await H.searchPlotLooks(ALL, { plotId: 'H1', sig: 's', now: () => 1e12 + 120_000, memory: () => search, note: note(1e12 + 120_000), searchLook: async () => ({ ok: false, why: 'no_proven_site', more: true, soft: 'approach_unread' }) })
  assert.deepStrictEqual([soft.why, soft.soft, search.H1.pass], ['no_proven_site', 'approach_unread', undefined], 'never exhausted on a search that could not read the approach')
  const d = await H.siteOverPlots([NINE, H2P], p => (p.id === 'H1' ? soft : { ok: true }), { noteFail: () => { throw new Error('a soft plot is never noted') }, row: () => {} })
  assert.deepStrictEqual([d.ok, d.plotId], [true, 'H2'])
  // the screen's and the box's refusals alone ARE answered from memory: no pass is needed, no search is made
  let g = {}
  for (const [i, cs] of ALL.entries()) g = H.searchNoted(g, 'H1', 's', cs.id, 'no_site', { now: 1e12, life: i ? 'ground' : 'slow', ms: 100_000 })
  g = H.searchNoted(g, 'H1', 's', null, null, { now: 1e12 + 1, pass: 'end' })
  const mem = await H.searchPlotLooks(ALL, { plotId: 'H1', sig: 's', now: () => 1e12 + 60_000, memory: () => g, searchLook: async () => { throw new Error('no search') } })
  assert.deepStrictEqual([mem.why, mem.detail], ['exhausted', 'no_site=23,slow=1'])
})
await t('REVIEW r2 (Codex 1) THE TRENCH ARRIVES DURING THE FRESH PROOF (after its first walk; its reader keeps what it read): the witness is asked at the proof\'s END, the proof is made once more on a new reader and refuses -- nothing is published', async () => {
  // the reproduction on the fresh proof as it was (siteAgainFresh, a reader that keeps its reads): ok, though a fresh search refuses
  const w0 = liveWorld()
  const s = B.siteBlueprint(w0.read, F.plan(), bpOf(ALL[0]), ctxOf(NINE, [], { walkCache: B.makeWalkCache({ seqNow: w0.seq, movedSince: w0.moved }) }))
  const was = await B.siteAgainFresh(s, keptReader(w0.srv, B, { after: { walks: 2, then: () => trench(w0) } }), F.plan(), bpOf(ALL[0]), ctxOf(NINE), { sliceMs: 0 })
  assert.strictEqual(was.ok, true, 'REPRODUCED: the fresh proof after the cut is true')
  assert.deepStrictEqual([B.siteBlueprint(w0.read, F.plan(), bpOf(ALL[0]), ctxOf(NINE)).why], ['no_proven_site'], '...an independent fresh search is false')
  // the same sequence through the visit: WITH the witness
  const w = liveWorld(), mem = { fails: {}, search: {} }
  let cuts = 0
  const v = await visit(w, mem, [NINE, H2P], { now: 1e12, cost: 1_000, witness: true, during: (plot, run) => { if (plot.id === 'H1' && !cuts) { cuts++; assert.strictEqual(run, 1); trench(w) } } })
  assert.strictEqual(cuts, 1, 'POSITIVE CONTROL: the trench did arrive during H1\'s first fresh proof')
  assert.ok(!v.published.some(x => /^H1:/.test(x)), `nothing published on H1: ${v.published}`)
  assert.deepStrictEqual(v.published, ['H2:0']); assert.ok(v.r.ok && v.r.plotId === 'H2')
  assert.ok(!Object.hasOwn(mem.search.H1.looks, ALL[0].id) && mem.search.H1.pass === undefined && mem.search.H1.slow === undefined, 'the look is not remembered as refused')
  assert.strictEqual(mem.fails.H1.soft, true)
  // WITH NO WITNESS the fresh proof's reader keeps nothing: its later walks read the trench, and it refuses by itself
  const w2 = liveWorld(), mem2 = { fails: {}, search: {} }
  let cut2 = 0
  const v2 = await visit(w2, mem2, [NINE, H2P], { now: 1e12, cost: 1_000, witness: false, during: plot => { if (plot.id === 'H1' && !cut2) { cut2++; trench(w2) } } })
  assert.deepStrictEqual([cut2, v2.published], [1, ['H2:0']])
})
await t('...the world moves under the SECOND fresh proof too: nothing is published, nothing is remembered, the plot\'s turn ends and it is passed (`world_moving`); the next plot is sited', async () => {
  const w = liveWorld(), mem = { fails: {}, search: {} }
  const runs = []
  const v = await visit(w, mem, [NINE, H2P], { now: 1e12, cost: 1_000, witness: true, during: (plot, run) => { if (plot.id === 'H1') { runs.push(run); w.dig(40, 40 + run, 1) } } })
  assert.deepStrictEqual(runs, [1, 2], 'two fresh proofs, the world told of a change under each')
  assert.deepStrictEqual(v.searched.filter(x => /^H1:/.test(x)), ['H1:0'], 'no other look of the plot is searched this visit')
  assert.deepStrictEqual([v.published, mem.search.H1.looks, mem.search.H1.pass.done, mem.search.H1.slow, mem.fails.H1.why, mem.fails.H1.soft], [['H2:0'], {}, {}, undefined, 'soft:world_moving', true], 'the visit is counted; no look is marked')
  assert.ok(v.rows.includes('passed:H1:world_moving:no_proven_site'), JSON.stringify(v.rows))
  // told of nothing in the walk's square (the witness's own word: a change elsewhere is none), the FIRST fresh proof stands: one run
  const calm = liveWorld(), s0 = B.siteBlueprint(calm.read, F.plan(), bpOf(ALL[0]), ctxOf(NINE))
  let made = 0
  const one = await B.siteAgainSteady(s0, F.plan(), bpOf(ALL[0]), { readOf: () => { made++; return calm.read }, ctxOf: () => ctxOf(NINE), optsOf: () => ({ sliceMs: 0 }), seqNow: () => 7, movedSince: () => false, area: { x: 0, z: 0, r: 92 } })
  assert.deepStrictEqual([one.ok, made], [true, 1])
  assert.strictEqual(B.STEADY_TRIES, 2)
})
await t('MUTANT the witness never asked at the fresh proof\'s end: the cottage behind the trench that arrived during the proof is PUBLISHED', async () => {
  const M = await mutantOf('buildsite.mjs', '    if (!witnessed || mark == null) return s2\n', '    return s2\n')
  const w = liveWorld(), mem = { fails: {}, search: {} }
  let cuts = 0
  const v = await visit(w, mem, [NINE, H2P], { now: 1e12, cost: 1_000, witness: true, M, during: plot => { if (plot.id === 'H1' && !cuts) { cuts++; trench(w) } } })
  assert.deepStrictEqual(v.published, ['H1:0'], 'the mutant publishes it')
})
// REVIEW r2 (Codex 2): H1 cannot be reached and its approach is unread for the siting bot (every proof look answers soft); H2 is usable
const softWorld = () => { const w = liveWorld(); trench(w); return w }
const softVisits = async (n, { MH = H, cost = 16_000 } = {}) => {
  const w = softWorld(), mem = { fails: {}, search: {} }, out = []
  for (let i = 0; i < n; i++) {
    const now = 1e12 + i * 300_000
    const plots = H.houseOffer({ layout: [NINE, H2P], fails: mem.fails, now }).plots
    out.push({ order: plots.map(p => p.id).join(''), ...(await visit(w, mem, plots, { now, MH, cost, unread: p => (p.id === 'H1' ? 40 : 0) })) })
    if (out.at(-1).r.ok) break
  }
  return { out, mem }
}
const idx = (v, id = 'H1') => v.searched.filter(x => x.startsWith(`${id}:`)).map(x => Number(x.slice(3)))
await t('REVIEW r2 (Codex 2) SOFT LOOKS NO LONGER STARVE THE NEXT PLOT (16 s a look, seven a visit): every visit goes on after the last look it finished (0-6, 7-13, 14-20, 21-23); the pass over, H1 is PASSED and goes behind H2, which is tried and sited in that same fourth visit', async () => {
  const { out, mem } = await softVisits(8)
  assert.deepStrictEqual(out.map(v => idx(v)), [[0, 1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12, 13], [14, 15, 16, 17, 18, 19, 20], [21, 22, 23]], 'progress always moves')
  for (const v of out.slice(0, 3)) { assert.deepStrictEqual([v.order, v.r.why, v.r.resume], ['H1H2', 'search_time', true]); assert.ok(!v.rows.includes('chosen:H2')) }
  assert.ok(out[3].rows.some(x => /^passed:H1:approach_unread/.test(x)) && out[3].rows.includes('chosen:H2'), `visit 4: H1 passed, H2 tried -- ${JSON.stringify(out[3].rows.slice(-4))}`)
  assert.deepStrictEqual([mem.fails.H1.soft, mem.fails.H1.why, mem.search.H1.pass], [true, 'soft:approach_unread', undefined], 'a pass, not a failure; its marks cleared')
  assert.deepStrictEqual([out.length, out[3].r.ok, out[3].r.plotId, out[3].published], [4, true, 'H2', ['H2:0']])
  assert.deepStrictEqual(H.houseOffer({ layout: [NINE, H2P], fails: mem.fails, now: 1e12 + 4 * 300_000 }).plots.map(p => p.id), ['H2', 'H1'], 'H1 behind H2')
  // the pass's marks while it runs: the square looks done soft, the long bodies refused by the screen
  const { mem: m1 } = await softVisits(1)
  assert.deepStrictEqual([marksOf(m1, 'soft'), Object.keys(m1.search.H1.looks).length, marksOf(m1, 'proof'), m1.search.H1.pass.visits, m1.search.H1.pass.first, m1.fails], [5, 2, 0, 1, ALL[7].id, {}])
  assert.strictEqual(H.homePlotRowDetail({ project: 'cottage2', op: 'passed', plot: 'H1', why: 'approach_unread:no_proven_site' }), 'project=cottage2 op=passed plot=H1 why=approach_unread:no_proven_site')
})
await t('the rotation and the box (pure): a soft pass sends the plot behind the others for 30 min, never 6 h, and never shortens a real failure; a look the box cuts with PART of a box is promoted (no row, no refusal), with a WHOLE box it is refused `slow` by name (row: its index, the box)', async () => {
  const now = 1e12, ids = ['a', 'b', 'c']
  const P2 = [{ id: 'A', box: [0, 0, 10, 10] }, { id: 'B', box: [20, 0, 30, 10] }]
  const soft = H.failNoted({}, 'A', { why: 'soft:approach_unread', now, soft: true })
  assert.strictEqual(H.HOMEPLOT.softRetryMs, 30 * 60_000)
  const order = t0 => H.rotatePlots(P2, soft, t0).map(p => p.id).join('')
  assert.deepStrictEqual([order(now + 1), order(now + H.HOMEPLOT.softRetryMs - 1), order(now + H.HOMEPLOT.softRetryMs)], ['BA', 'BA', 'AB'])
  const real = H.failNoted({}, 'A', { why: 'exhausted', now })
  assert.deepStrictEqual(H.failNoted(real, 'A', { why: 'soft:x', now: now + 1000, soft: true }).A, real.A, 'a real failure inside its 6 h is left as it is')
  assert.strictEqual(H.rotatePlots(P2, real, now + H.HOMEPLOT.softRetryMs).map(p => p.id).join(''), 'BA', 'POSITIVE CONTROL: a real failure holds 6 h')
  for (const [boxFresh, want] of [[true, { slow: ['a'], promoted: null, rows: ['slow:H1:0:100000'] }], [false, { slow: [], promoted: 'a', rows: [] }]]) {
    let mm = {}
    const rows = []
    const r = await H.searchPlotLooks(ids.map(id => ({ id })), { plotId: 'H1', sig: 's', boxFresh, boxMs: boxFresh ? 100_000 : null, now: () => now, memory: () => mm, row: f => rows.push(`${f.op}:${f.plot}:${f.look}:${f.ms}`),
      note: (id, why, o) => { mm = H.searchNoted(mm, 'H1', 's', id, why, { now, ...o }) }, searchLook: async () => ({ ok: false, why: 'search_time' }) })
    const st = H.searchLeft(mm, 'H1', 's', ids, now)
    assert.deepStrictEqual([r.why, { slow: st.slow, promoted: st.promoted, rows }, st.visits], ['search_time', want, 1])
  }
})
await t('MUTANT a soft look not marked done for the pass (the cursor does not advance): every later visit searches the square looks 0, 2 and 4 again', async () => {
  const MH = await mutantOf('homeplots.mjs', "else { softNow ??= String(r.soft ?? 'not_kept'); step(look.id, String(r.soft ?? 'not_kept'), { life: 'soft' }) }", "else { softNow ??= String(r.soft ?? 'not_kept') }")
  const { out } = await softVisits(4, { MH, cost: 22_000 })
  assert.deepStrictEqual(idx(out[0]), [0, 1, 2, 3, 4])
  for (const v of out.slice(1)) assert.ok([0, 2, 4].every(i => idx(v).includes(i)), `the mutant searches them again: ${idx(v)}`)
  const real = await softVisits(4, { cost: 22_000 })
  assert.deepStrictEqual(real.out.map(v => idx(v)), [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19]], 'POSITIVE CONTROL: no look twice')
})
await t('MUTANT a soft pass that does not rotate: H1 is first again at the next visit', async () => {
  const MH = await mutantOf('homeplots.mjs', "    if (last.soft) { try { noteSoft(p, last.soft) } catch { /* no memory: it is first again next visit */ } row(", '    if (last.soft) { row(')
  const next = async M => {
    let fails = {}
    const r = await M.siteOverPlots([NINE, H2P], p => (p.id === 'H1' ? { ok: false, why: 'no_proven_site', soft: 'approach_unread' } : { ok: false, why: 'search_time', resume: true }),
      { noteSoft: (p, why) => { fails = H.failNoted(fails, p.id, { why: `soft:${why}`, now: 1e12, soft: true }) } })
    return [r.why, H.houseOffer({ layout: [NINE, H2P], fails, now: 1e12 + 300_000 }).plots.map(p => p.id).join('')]
  }
  assert.deepStrictEqual(await next(MH), ['search_time', 'H1H2'], 'the mutant: H1 still first after its soft pass')
  assert.deepStrictEqual(await next(H), ['search_time', 'H2H1'])
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
await t('MUTANT a refused look not passed over: the second visit searches looks 0-3 again and the fitting look is never reached', async () => {
  const M = await mutantOf('homeplots.mjs', '    if (!todo.has(look.id)) continue\n', '')
  const two = async MH => {
    const srv = world(), mem = { fails: {}, search: {} }, seen = []
    for (let i = 0; i < 2; i++) {
      let spent = 0
      await MH.searchPlotLooks(ALL, { plotId: 'H1', sig: 's', now: () => 1e12, memory: () => mem.search, note: (id, why, o) => { mem.search = H.searchNoted(mem.search, 'H1', 's', id, why, { now: 1e12, ...o }) },
        searchLook: async cs => { if (spent >= 100_000) return { ok: false, why: 'search_time' }; spent += 22_000; seen.push(ALL.indexOf(cs)); const s = B.siteBlueprint(srv.read, F.plan(), bpOf(cs), ctxOf(NINE)); return s.ok ? { ok: true } : { ok: false, why: s.why, more: true, refused: H.refusalOf(s) } } })
    }
    return seen
  }
  assert.deepStrictEqual(await two(M), [0, 1, 2, 3, 4, 5, 0, 1, 2, 3], 'the mutant: the look the box cut, then from look 0 again')
  assert.deepStrictEqual(await two(H), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

console.log('4b. REVIEW r3 (Codex): A SLOW PASS AND A SLOW LOOK -- the pass keeps its marks and is bounded in visits; the box is the bound, by name')
const noFit = () => world([[24, 73, 0], [24, 72, -1], [22, 72, 0], [26, 73, 1], [25, 74, 0]])   // H1 takes no look at all
const once = xs => new Set(xs).size === xs.length
const upTo = n => [...Array(n).keys()]
const exhausted = v => v.r.why === 'exhausted'
await t('REVIEW r3 (Codex 1) THE REVIEWER\'S SEQUENCE: 24 looks, each using its WHOLE 100-s box, a 5-min re-ask (15a0e70c2 began looks 0,1,2,3,4,0,1,2,3,4,... over 18 visits and never tried H2): now one look a visit is refused `slow` by name (0,1,2,3), the FIFTH visit passes H1 by the visits\' bound and H2 is tried -- and sited -- in it', async () => {
  const { out, mem } = await visits(world(), 18, { need: plot => (plot.id === 'H1' ? 120_000 : 0) })
  assert.deepStrictEqual(triedOf(out), [0, 1, 2, 3], 'no look of H1 is begun twice')
  for (const [i, v] of out.slice(0, 4).entries()) {
    assert.deepStrictEqual([v.order, v.r.why, v.r.resume, v.at, v.tried], ['H1H2', 'search_time', true, i * 400_000, [`H1:${i}`]])
    assert.ok(v.rows.includes(`slow:H1:${i}`) && !v.rows.includes('chosen:H2'), JSON.stringify(v.rows))
  }
  assert.strictEqual(out.length, 5, 'the fifth visit is the last: the cottage is sited')
  assert.deepStrictEqual(out[4].rows, ['chosen:H1', 'passed:H1:pass_visits:no_proven_site', 'chosen:H2'], 'H1 is passed without a search; H2 is tried')
  assert.deepStrictEqual([out[4].r.ok, out[4].r.plotId, out[4].published, out[4].tried], [true, 'H2', ['H2:0'], ['H2:0']], 'H2 has the fifth visit\'s whole box')
  assert.deepStrictEqual([mem.fails.H1.soft, mem.fails.H1.why, mem.search.H1.pass.visits, marksOf(mem, 'slow'), Object.keys(mem.search.H1.slow).length], [true, 'soft:pass_visits', 0, 4, 4], 'H1 is passed, not failed; its pass rests with its progress kept')
})
await t('...and with H2 as slow as H1 the two plots take TURNS of four visits: over the 18 visits no look is begun twice (H1 looks 0-9, H2 looks 0-7) and every one is a named `slow` row', async () => {
  const { out } = await visits(world(), 18, { need: () => 120_000 })
  assert.strictEqual(out.length, 18)
  assert.deepStrictEqual(out.map(v => v.tried.join()), ['H1:0', 'H1:1', 'H1:2', 'H1:3', 'H2:0', 'H2:1', 'H2:2', 'H2:3', 'H1:4', 'H1:5', 'H1:6', 'H1:7', 'H2:4', 'H2:5', 'H2:6', 'H2:7', 'H1:8', 'H1:9'])
  assert.deepStrictEqual([triedOf(out), triedOf(out, 'H2')], [upTo(10), upTo(8)])
  const slow = out.flatMap(v => v.raw.filter(f => f.op === 'slow'))
  assert.deepStrictEqual([slow.length, slow.every(f => f.ms === 100_000), H.homePlotRowDetail({ project: 'cottage2', ...slow[5] })], [18, true, 'project=cottage2 op=slow plot=H2 look=1 ms=100000'])
  assert.deepStrictEqual(out.filter(v => v.rows.some(x => /^passed:H\d:pass_visits/.test(x))).map(v => v.at / 400_000), [4, 8, 12, 16], 'a plot is passed every fourth visit; the visit itself goes to the other plot')
})
await t('MUTANT no bound on a pass\'s visits: H1 holds every one of the 18 visits (looks 0-17) and H2 is never tried -- the reviewer\'s starvation', async () => {
  const MH = await mutantOf('homeplots.mjs', "  if (st.visits >= maxVisits) { step(null, null, { pass: 'rest' }); return { ok: false, why: 'no_proven_site', soft: 'pass_visits' } }\n", '')
  const { out } = await visits(world(), 18, { MH, need: plot => (plot.id === 'H1' ? 120_000 : 0) })
  assert.deepStrictEqual([out.length, triedOf(out), out.some(v => v.rows.includes('chosen:H2'))], [18, upTo(18), false])
})
await t('THE LIVE-SHAPED PASS (34 s a look, three a visit: eight visits of ~6.7 min, 53 min -- longer than the 30 min a mark lived): H1 alone, nothing fitting -- looks 0-11 in four visits, H1 passed by the bound, 12-23 in four more; the pass completes WITHOUT repeating a look and the plot is `exhausted` on its own word, 78 min after it began', async () => {
  const { out, mem } = await visits(noFit(), 20, { layout: [NINE], cost: 34_000, stop: exhausted })
  assert.deepStrictEqual(out.map(v => idx({ searched: v.tried })), [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11], [], [12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23]])
  assert.ok(once(triedOf(out)) && triedOf(out).length === 24)
  assert.deepStrictEqual(out.map(v => v.at / 1000), [0, 400, 800, 1200, 1600, 3500, 3900, 4300, 4700], 'a paused visit is asked again after 5 min, the passed plot after the project\'s 30')
  assert.ok(out.at(-1).at > 2 * H.HOMEPLOT.softRetryMs, 'POSITIVE CONTROL: the pass outlived the 30 min its marks had before')
  assert.deepStrictEqual(out[4].rows, ['chosen:H1', 'passed:H1:pass_visits:no_proven_site'])
  assert.deepStrictEqual([out[8].r.why, out[8].rows.at(-1), mem.fails.H1.why, mem.search.H1.pass], ['exhausted', 'exhausted:H1:no_proven_site:cell_not_free=12,no_site=12', 'exhausted', undefined])
  // 22 s a look (five a visit): the 24 looks need a fifth visit on the plot -- it comes after the bound's rest, at look 20
  const five = await visits(noFit(), 20, { layout: [NINE], stop: exhausted })
  assert.deepStrictEqual(five.out.map(v => v.tried.length), [5, 5, 5, 5, 0, 4]); assert.ok(once(triedOf(five.out)) && exhausted(five.out[5]))
})
await t('THE WORST CASE, one FINISHED look a visit (100 s each; H1 alone): 24 visits in six turns of four with the project\'s 30-min wait between turns -- the pass is 5.2 h old when it ends, no look is searched twice, and the plot is `exhausted`', async () => {
  const { out, mem } = await visits(noFit(), 40, { layout: [NINE], cost: 100_000, stop: exhausted })
  assert.deepStrictEqual([triedOf(out), out.length], [upTo(24), 29])
  assert.deepStrictEqual(out.map((v, i) => (v.tried.length ? null : i)).filter(i => i != null), [4, 9, 14, 19, 24], 'the five rests: every fifth visit is the bound\'s')
  assert.deepStrictEqual([out[28].at, out[28].r.why, mem.fails.H1.why], [23 * 400_000 + 5 * 1_900_000, 'exhausted', 'exhausted'])
  assert.ok(out[28].at > 5 * 3_600_000 && out[28].at < H.HOMEPLOT.passKeepMs)
})
await t('MUTANT the pass\'s marks expiring by AGE while it is under way (30 min from its start, as they did): in the worst case looks 0, 2, 4, 5 are searched every turn, for ever -- no pass ever completes; in the live shape the square looks of the first four visits are searched twice', async () => {
  const MH = await mutantOf('homeplots.mjs', "now - t < passMs && p.done && typeof p.done === 'object' ? p : null }", "now - Number(p.at) < HOMEPLOT.softRetryMs && p.done && typeof p.done === 'object' ? p : null }")
  const worst = await visits(noFit(), 40, { layout: [NINE], cost: 100_000, stop: exhausted, MH })
  assert.deepStrictEqual([worst.out.length, worst.out.some(exhausted)], [40, false], 'never exhausted')
  assert.deepStrictEqual(triedOf(worst.out).slice(0, 16), [0, 1, 2, 3, 0, 2, 4, 5, 0, 2, 4, 5, 0, 2, 4, 5], 'the screen\'s refusals (looks 1, 3) stand; the proofs\' are forgotten at every turn')
  const live = await visits(noFit(), 20, { layout: [NINE], cost: 34_000, stop: exhausted, MH })
  assert.ok(!once(triedOf(live.out)), `the mutant repeats looks: ${triedOf(live.out)}`)
})
await t('REVIEW r3 (Codex 2) THE REVIEWER\'S SEQUENCE: H1 accepts only looks whose search + fresh proof need 110 s (60 + 50; 15a0e70c2 marked such a look soft, dropped the mark with the pass and began the look again under the same box, for ever): cut in its FRESH PROOF with part of a box the look goes FIRST in the next visit; cut again with the WHOLE box it is refused `slow` by name; the plot exhausts honestly, and the look is tried again only after its 6 h', async () => {
  const cost = (plot, i) => (plot.id === 'H1' && (i === 13 || i === 20) ? 60_000 : 22_000), proof = plot => (plot.id === 'H1' ? 50_000 : 0)
  const srv = world()
  const { out, mem } = await visits(srv, 20, { layout: [NINE], cost, proof, stop: exhausted })
  assert.deepStrictEqual(out.map(v => v.tried.map(x => Number(x.slice(3)))), [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13], [13], [], [14, 15, 16, 17, 18], [19, 20], [20], [21, 22, 23]])
  assert.ok(out[2].searched.includes('H1:13') && !out[2].rows.some(x => /^slow/.test(x)), 'visit 3: look 13\'s search FINISHED (the kept walk accepted it); the box cut its fresh proof, behind three other looks -- no refusal')
  assert.deepStrictEqual(out[3].rows, ['chosen:H1', 'resumed:H1:13', 'slow:H1:13', 'paused:H1:search_time'], 'visit 4: it goes first, alone with the whole box -- cut again: the named limit')
  assert.deepStrictEqual(out[3].raw.find(f => f.op === 'slow'), { op: 'slow', plot: 'H1', look: 13, ms: 100_000 })
  assert.deepStrictEqual([out[6].rows.some(x => /^slow/.test(x)), out[7].rows.includes('slow:H1:20')], [false, true], 'the same for look 20: promoted, then refused')
  assert.deepStrictEqual([out[8].r.why, out[8].rows.at(-1)], ['exhausted', 'exhausted:H1:no_site=12,no_proven_site:cell_not_free=10,slow=2'], 'THE PLOT EXHAUSTS HONESTLY: the tally names the box\'s two refusals')
  assert.deepStrictEqual([mem.fails.H1.why, mem.fails.H1.soft, out.flatMap(v => v.published), triedOf(out).filter(i => i === 13).length], ['exhausted', undefined, [], 2], 'failed 6 h like any exhausted plot; nothing published; look 13 begun twice, never a third time')
  // the 6 h are each look's own: 13 was cut at 1,200 s, 20 at 4,300 s
  const ids = ALL.map(q => q.id), sig = H.plotSig(srv.read, NINE, [], HOME), S6 = H.HOMEPLOT.slowKeepMs
  const slowAt = at => H.searchLeft(mem.search, 'H1', sig, ids, 1e12 + at).slow.map(id => ids.indexOf(id))
  assert.deepStrictEqual([slowAt(4_700_000), slowAt(1_200_000 + S6 - 1), slowAt(1_200_000 + S6), slowAt(4_300_000 + S6)], [[13, 20], [13, 20], [20], []])
  // back at the plot two hours after it began (a rotation's turn): the proofs' looks are searched again, the slow looks are NOT begun
  const ground = new Set(Object.keys(mem.search.H1.looks)), squares = upTo(24).filter(i => !ground.has(ids[i]) && i !== 13 && i !== 20)
  const hour = await visits(srv, 5, { layout: [NINE], cost, proof, mem: { fails: {}, search: structuredClone(mem.search) }, t0: 1e12 + 2 * 3_600_000, stop: exhausted })
  assert.deepStrictEqual([squares.length, triedOf(hour.out), hour.out.at(-1).rows.at(-1)], [10, squares, 'exhausted:H1:no_site=12,no_proven_site:cell_not_free=10,slow=2'], 'the ten square looks, each once; 13 and 20 are passed over')
  // after the 6 h look 13 is begun again (the ground may have changed by then)
  const later = await visits(srv, 3, { layout: [NINE], cost, proof, mem: { fails: {}, search: structuredClone(mem.search) }, t0: 1e12 + 1_200_000 + S6 })
  assert.ok(triedOf(later.out).includes(13), `look 13 again: ${triedOf(later.out)}`)
})
await t('A VALID LOOK THAT NEEDS MOST OF A BOX IS BUILT (60 s + 30 s): cut in its fresh proof behind three other looks in visit 3, it goes first in visit 4, alone with the whole box, and is SITED', async () => {
  const cost = (plot, i) => (i === 13 || i === 20 ? 60_000 : 22_000), proof = () => 30_000
  const { out } = await visits(world(), 8, { layout: [NINE], cost, proof })
  assert.deepStrictEqual(out.map(v => v.tried.map(x => Number(x.slice(3)))), [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13], [13]])
  assert.deepStrictEqual([out[2].r.why, out[2].published, out[3].r.ok, out[3].r.look, out[3].published, out[3].rows], ['search_time', [], true, ALL[13].id, ['H1:13'], ['chosen:H1', 'resumed:H1:13']])
})
await t('a look the box cut goes FIRST in the plot\'s next visit WHATEVER ORDER the looks come in then (the stock moved: the family is ranked anew); searched there, it is no longer the first', async () => {
  const refused = { ok: false, why: 'no_proven_site', more: true, refused: 'no_proven_site:no_step', life: 'proof' }, cutNow = { ok: false, why: 'search_time' }
  const run = async MH => {
    let mm = {}
    const seen = []
    const go = (ids, cutId) => MH.searchPlotLooks(ids.map(id => ({ id })), { plotId: 'H1', sig: 's', boxFresh: true, boxMs: 100_000, now: () => 1e12, memory: () => mm, note: (id, why, o) => { mm = H.searchNoted(mm, 'H1', 's', id, why, { now: 1e12, ...o }) }, searchLook: async q => { seen.push(q.id); return q.id === cutId ? cutNow : refused } })
    await go(['a', 'b', 'c', 'd'], 'b')   // a refused; b cut in its proof with part of the box
    const first = mm.H1.pass.first ?? null
    await go(['d', 'c', 'b', 'a'], 'c')   // the family ranked anew
    return { seen: seen.join(''), first, then: mm.H1.pass.first ?? null, slow: mm.H1.slow }
  }
  assert.deepStrictEqual(await run(H), { seen: 'abbdc', first: 'b', then: 'c', slow: undefined }, 'b first with the whole box (refused there); then d; c cut behind them is the next one\'s first')
  const MH = await mutantOf('homeplots.mjs', "      if (!(boxFresh && !searched)) { step(null, null, { first: look.id }); return r }\n", '      if (!(boxFresh && !searched)) return r\n')
  assert.deepStrictEqual(await run(MH), { seen: 'abdc', first: null, then: null, slow: undefined }, 'MUTANT the cut look not promoted: the next visit begins at d, and b never has a whole box')
})
await t('THE SLOW LOOK\'S ROW AND ITS REFUSAL (pure): `_homeplot op=slow plot= look= ms=`; cut as the pass\'s LAST look, the pass is over in that same visit -- `exhausted` with `slow` in the tally, or passed where a look of it was soft; refused for 6 h, then searched again', async () => {
  assert.strictEqual(H.homePlotRowDetail({ project: 'cottage2', op: 'slow', plot: 'H1', look: 13, ms: 100_000 }), 'project=cottage2 op=slow plot=H1 look=13 ms=100000')
  const now = 1e12, ids = ['a', 'b', 'c'], S6 = H.HOMEPLOT.slowKeepMs
  const answers = { proof: { ok: false, why: 'no_proven_site', more: true, refused: 'no_proven_site:no_step', life: 'proof' }, soft: { ok: false, why: 'no_proven_site', more: true, soft: 'approach_unread' } }
  for (const [kind, want] of [['proof', ['exhausted', undefined, 'no_proven_site:no_step=2,slow=1']], ['soft', ['no_proven_site', 'approach_unread', undefined]]]) {
    let mm = {}
    const rows = [], seen = []
    const go = at => H.searchPlotLooks(ids.map(id => ({ id })), { plotId: 'H1', sig: 's', boxFresh: true, boxMs: 100_000, now: () => at, memory: () => mm, row: f => rows.push(H.homePlotRowDetail({ project: 'cottage2', ...f })),
      note: (id, why, o) => { mm = H.searchNoted(mm, 'H1', 's', id, why, { now: at, ...o }) }, searchLook: async q => { seen.push(q.id); return q.id === 'c' ? { ok: false, why: 'search_time' } : answers[kind] } })
    const v1 = await go(now)
    assert.deepStrictEqual([v1.why, rows, mm.H1.pass.first, mm.H1.slow], ['search_time', [], 'c', undefined], `${kind}: cut behind two looks -- promoted, no row, no refusal`)
    const v2 = await go(now + 400_000)
    assert.deepStrictEqual([v2.why, v2.soft, v2.detail], want, `${kind}: cut with the whole box as the pass's last look`)
    assert.deepStrictEqual([rows, seen.join(''), mm.H1.pass, mm.H1.slow], [[`project=cottage2 op=resumed plot=H1 look=2 of=3 refused=${kind === 'proof' ? 2 : 0}`, 'project=cottage2 op=slow plot=H1 look=2 ms=100000'], 'abcc', undefined, { c: { at: now + 400_000, ms: 100_000 } }])
    const left = at => H.searchLeft(mm, 'H1', 's', ids, at).left
    assert.deepStrictEqual([left(now + 400_000 + S6 - 1), left(now + 400_000 + S6)], [['a', 'b'], ['a', 'b', 'c']], 'c: not for 6 h, then again')
  }
  assert.strictEqual(S6, H.HOMEPLOT.retryMs, 'a real failure\'s wait')
})
await t('THE VISITS\' BOUND (pure): four visits on a plot; the fifth answers { soft: `pass_visits` } WITHOUT a search and puts the count back to 0 with the progress kept; the sixth goes on where the pass stopped. FOUR is the most that stays under the 30 min a failed siting holds the project for', async () => {
  const N = H.HOMEPLOT.passVisits, perVisit = 100_000 + H.HOMEPLOT.resumeMs
  assert.strictEqual(N, 4); assert.ok(N * perVisit < 30 * 60_000 && (N + 1) * perVisit > 30 * 60_000, '4 x 6.7 min = 26.7 min < 30 min < 33.3 min')
  assert.deepStrictEqual([Math.ceil(24 / 3 / N), Math.ceil(24 / N)], [2, 6], 'the live-shaped pass (3 looks a visit, 8 visits): two turns; the worst case (one a visit): six')
  const ids = upTo(10).map(i => `l${i}`)
  let mm = {}
  const seen = []
  const go = i => H.searchPlotLooks(ids.map(id => ({ id })), { plotId: 'H1', sig: 's', boxFresh: true, boxMs: 100_000, now: () => 1e12 + i * perVisit, memory: () => mm, note: (id, why, o) => { mm = H.searchNoted(mm, 'H1', 's', id, why, { now: 1e12 + i * perVisit, ...o }) },
    searchLook: (() => { let n = 0; return async q => { if (n++) return { ok: false, why: 'search_time' }; seen.push(q.id); return { ok: false, why: 'no_proven_site', more: true, refused: 'no_proven_site:no_step', life: 'proof' } } })() })
  for (let i = 0; i < 4; i++) assert.deepStrictEqual([(await go(i)).why, mm.H1.pass.visits, mm.H1.pass.first], ['search_time', i + 1, `l${i + 1}`])
  const fifth = await go(4)
  assert.deepStrictEqual([fifth, seen.join(), mm.H1.pass.visits, Object.keys(mm.H1.pass.done), mm.H1.pass.first], [{ ok: false, why: 'no_proven_site', soft: 'pass_visits' }, 'l0,l1,l2,l3', 0, ['l0', 'l1', 'l2', 'l3'], 'l4'])
  assert.deepStrictEqual([(await go(5)).why, seen.at(-1), mm.H1.pass.visits], ['search_time', 'l4', 1], 'it goes on at l4')
  // the remedy is the driver's, in the same visit: the next plot is tried, and the passed plot is behind it for 30 min
  const rows = []
  let fails = {}
  const d = await H.siteOverPlots([NINE, H2P], p => (p.id === 'H1' ? fifth : { ok: true }), { row: f => rows.push(`${f.op}:${f.plot}:${f.why ?? ''}`), noteFail: () => { throw new Error('a passed plot is never noted failed') }, noteSoft: (p, why) => { fails = H.failNoted(fails, p.id, { why: `soft:${why}`, now: 1e12, soft: true }) } })
  assert.deepStrictEqual([d.ok, d.plotId, rows, fails.H1.soft, fails.H1.why], [true, 'H2', ['chosen:H1:', 'passed:H1:pass_visits:no_proven_site', 'chosen:H2:'], true, 'soft:pass_visits'])
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
    'the kept walk is made only under the switch, with the connection\'s witness': ['    const walkCache = HOMESEARCH.on ? makeWalkCache(witness ? { seqNow: () => witness.seq(), movedSince: (since, at) => witness.moved(since, at) } : {}) : null\n', '    const walkCache = HOMESEARCH.on ? makeWalkCache() : null\n'],
    'the witness listens for the plot\'s search and is stopped after it': ["    if (HOMESEARCH.on && typeof bot._client?.on === 'function') { try { witness = installServerBlockWitness(bot) } catch { witness = null } }\n", '\n'],
    'the witness is stopped however the search ends': ['  } finally { try { witness?.stop() } catch { /* gone with the connection */ } }\n', '  } finally { /* never stopped */ }\n'],
    'what the kept walk accepted is proven again fresh, each time on a new reader': ['        const s2 = await siteAgainSteady(s, plan, bp, { readOf: ro => planReader(bot, ro),', '        const s2 = await Promise.resolve(s, plan, bp, { readOf: ro => planReader(bot, ro),'],
    'the fresh proof is given the connection\'s witness and the walk\'s square': ['          ...(witness ? { seqNow: () => witness.seq(), movedSince: (since, at) => witness.moved(since, at), area: { x: plan.home.x, z: plan.home.z, r: sp.walkR + 2 } } : {}) })\n', '          })\n'],
    'a world that moved under both fresh proofs ends the plot\'s turn: nothing published, nothing remembered': ["        if (s2.moved) { walkCache.drop(); return { ok: false, why: 'no_proven_site', detail: 'world_moving', tried, soft: refusalKind(s2).soft } }", ''],
    'a plot passed soft is put behind the others for a short while': ["noteSoft: (p, why) => homeFailNote(dir, p.id, `soft:${why}`, plot, me, true)", 'noteSoft: () => {}'],
    'the reader can be made to keep nothing': ['    if (keep && memo.has(k)) return memo.get(k)\n', '    if (memo.has(k)) return memo.get(k)\n'],
    'a site the fresh proof refuses is not published, not refused, and the kept walks are dropped': ["        if (!s2.ok) { walkCache.drop(); return { ok: false, why: 'no_proven_site', detail: `kept_walk_stale ${s2.why}`, tried, more: true, soft: refusalKind({ ...s2, stale: true }).soft } }\n", '\n'],
    'the record published is the fresh proof\'s': ['      return { ok: true, why: \'ok\', record: cottageRecordOf(rec, bp, cs.style, { plotId: o.plot.id ?? null, walkR: sp.walkR }), tried }\n', '      return { ok: true, why: \'ok\', record: cottageRecordOf(s.record, bp, cs.style, { plotId: o.plot.id ?? null, walkR: sp.walkR }), tried }\n'],
    'a refusal is remembered as its kind says, given the unread approach and the guard': ['        const k = HOMESEARCH.on ? refusalKind(s, { unread: unreadSeen, guardUnread }) : null\n', '        const k = HOMESEARCH.on ? refusalKind(s) : null\n'],
    'the approach\'s unread columns are counted across the plot\'s looks': ['        unreadSeen = Math.max(unreadSeen, prd.unreadIn(approach))\n', '\n'],
    'the tree guard\'s unreadable answer is asked once a plot': ['    if (HOMESEARCH.on && LEAFFELL_ON) { try { guardUnread = !!trunkReservations(bot, plan).why } catch { guardUnread = true } }\n', '\n'],
    'the search and the canopy hook are given the kept walk, and the plot\'s one planned town': ['        ...(walkCache ? { walkCache, ...pa0, ...siteCanopyCtx(prd, bp, plan.home, stood, sp.walkR, null, walkCache) } : {}),', '        ...({}),'],
    'a finished, refused look carries its reason and its life, or says it is soft': ["tried, more: true, ...(k?.life ? { refused: k.why, life: k.life } : k?.soft ? { soft: k.soft } : {}) }", 'tried, more: true }'],
    'the plot is searched through the memory, every step of its pass written to the town\'s file': ["      return await searchPlotLooks(all, { plotId: o.plot.id, sig, boxFresh, boxMs: boxFresh ? box.left() : null, memory: () => homeSearch(dir), note: (id, why, opts) => homeSearchNote(dir, o.plot.id, sig, id, why, me, opts), row: f => homePlotRow(bot, { project: plot, ...f }), searchLook: lookOn })\n", '      return await lookOn(all[0])\n'],
    'the step\'s own options (the pass, the look\'s life, the box) reach the memory': ['search: searchNoted(m.search ?? {}, plotId, sig, lookId, why, { ...opts, by }) })', 'search: searchNoted(m.search ?? {}, plotId, sig, lookId, why, { by }) })'],
    'the plot\'s turn knows whether it began with the whole box': ['  const boxFresh = tried.length === 0\n', '  const boxFresh = false\n'],
    'the signature is the plot\'s ground and reservations now': ['      const sig = plotSig(planReader(bot), o.plot, sp.zones, plan.home, { extra: plan.gen ?? \'\' })\n', "      const sig = 'x'\n"],
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
