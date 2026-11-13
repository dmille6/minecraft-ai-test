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
  assert.deepStrictEqual(H.searchLeft(m, 'H1', 's1', ids, now), { left: ids, refused: 0, first: 0, tally: '', proofs: [], softs: [], soft: null })
  m = H.searchNoted(m, 'H1', 's1', 'a', 'no_site:liquid', { now, by: 'A' })
  m = H.searchNoted(m, 'H1', 's1', 'b', 'no_proven_site:cell_not_free', { now: now + 1000, by: 'B' })
  m = H.searchNoted(m, 'H1', 's1', 'c', 'no_site:liquid', { now: now + 2000, by: 'A' })
  assert.deepStrictEqual(H.searchLeft(m, 'H1', 's1', ids, now + 3000), { left: ['d'], refused: 3, first: 3, tally: 'no_site:liquid=2,no_proven_site:cell_not_free=1', proofs: [], softs: [], soft: null })
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
await t('REVIEW r1 -- a PROOF\'s refusal is believed 30 min, never a day: its own stamp, its own life; the SCREEN\'s refusal of the same look outlives it; the looks only a proof refused are named', () => {
  const ids = ['a', 'b', 'c'], now = 1e12, P = H.HOMEPLOT.proofKeepMs
  assert.strictEqual(P, 30 * 60_000); assert.ok(P > 3 * H.HOMEPLOT.resumeMs && P < H.HOMEPLOT.searchKeepMs)
  let m = H.searchNoted({}, 'H1', 's1', 'a', 'no_site:liquid', { now, life: 'ground' })
  m = H.searchNoted(m, 'H1', 's1', 'b', 'no_proven_site:no_step', { now: now + 1000, life: 'proof' })
  assert.deepStrictEqual(m.H1.looks, { a: 'no_site:liquid' }); assert.deepStrictEqual(m.H1.proofs, { b: { why: 'no_proven_site:no_step', at: now + 1000 } })
  const at = t0 => H.searchLeft(m, 'H1', 's1', ids, t0)
  assert.deepStrictEqual([at(now + 2000).left, at(now + 2000).proofs, at(now + 2000).tally], [['c'], ['b'], 'no_proven_site:no_step=1,no_site:liquid=1'])
  assert.deepStrictEqual([at(now + 1000 + P - 1).left, at(now + 1000 + P).left], [['c'], ['b', 'c']], 'the proof\'s refusal is over after 30 min; the screen\'s stands')
  assert.deepStrictEqual(H.searchLeft(m, 'H1', 's2', ids, now + 2000).left, ids, 'another signature forgets both')
  // a later write keeps the proofs still believed and drops the ones that are over; a screen refusal of a look replaces its proof
  const later = H.searchNoted(m, 'H1', 's1', 'c', 'no_proven_site:no_step', { now: now + 1000 + P, life: 'proof' })
  assert.deepStrictEqual(Object.keys(later.H1.proofs), ['c'])
  assert.deepStrictEqual(H.searchNoted(m, 'H1', 's1', 'b', 'no_site', { now: now + 5000, life: 'ground' }).H1, { sig: 's1', at: now, last: now + 5000, by: '', looks: { a: 'no_site:liquid', b: 'no_site' } })
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
/** How many looks of a plot the memory holds refused: the screen's and the proofs'. */
const refusedN = (mem, id = 'H1') => Object.keys(mem.search[id]?.looks ?? {}).length + Object.keys(mem.search[id]?.proofs ?? {}).length
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
 *  refusalKind says. A 100-s box on a fake clock (a finished look costs `cost`; a spent box gives the next search 0 ms, which the
 *  real search answers `search_time`). `mem`: the town file ({ fails, search }). `w`: a liveWorld (its witness is the connection's)
 *  or a fake server. `between(i, plot)`: what another bot does after look i's kept-walk search and before its fresh proof;
 *  `during(plot, run)`: after the first walk of a fresh proof (its `run`-th). `unread`: a number, or plot -> number. */
async function visit (w, mem, plots, { cost = 22_000, boxMs = 100_000, now = Date.now(), who = 'A', looks = () => ALL, witness = false, unread = 0, guardUnread = false, between = null, during = null, M = B, MH = H } = {}) {
  const srv = w.srv ?? w
  let spent = 0
  const box = { left: () => Math.max(0, boxMs - spent) }
  const rows = [], searched = [], published = []
  const siteOne = plot => {
    const all = looks(plot), sig = H.plotSig(srv.read, plot, [], HOME), boxFresh = searched.length === 0
    const cache = M.makeWalkCache(witness ? { seqNow: w.seq, movedSince: w.moved } : { now: () => now + spent })
    const note = (id, why, o) => { mem.search = H.searchNoted(mem.search, plot.id, sig, id, why, { now, by: who, ...o }) }
    return MH.searchPlotLooks(all, { plotId: plot.id, sig, boxFresh, now: () => now, memory: () => mem.search,
      noteLook: (id, why, life) => note(id, why, { life }), clearSoft: () => note(null, null, { life: 'soft', clearSoft: true }),
      row: f => rows.push(f),
      searchLook: async cs => {
        const bp = bpOf(cs), i = all.indexOf(cs), ctx = ctxOf(plot, [], { walkCache: cache })
        const s = await M.siteBlueprintAsync(srv.read, F.plan(), bp, ctx, { sliceMs: 0, maxMs: box.left() })
        if (M.siteLoopEnds(s)) return { ok: false, why: M.siteLoopEnds(s) }
        spent += cost; searched.push(`${plot.id}:${i}`)
        if (!s.ok) { const k = H.refusalKind(s, { unread: typeof unread === 'function' ? unread(plot) : unread, guardUnread }); return { ok: false, why: s.why, more: true, ...(k?.life ? { refused: k.why, life: k.life } : k?.soft ? { soft: k.soft } : {}) } }
        between?.(i, plot)
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
  return { r, rows: rows.map(f => [f.op, f.plot, f.look ?? f.why ?? ''].join(':').replace(/:$/, '')), searched, published }
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
  assert.strictEqual(refusedN(mem), 5); assert.deepStrictEqual([Object.keys(mem.search.H1.looks).length, Object.keys(mem.search.H1.proofs).length], [2, 3], 'the long bodies by the screen, the square looks by proof')
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
await t('EXHAUSTION ROTATES: with nothing fitting, the plot\'s 24 looks are refused over five visits; then it is `exhausted` (the tally), noted failed, and the NEXT plot is tried in the same visit', async () => {
  const srv = world([[24, 73, 0], [24, 72, -1], [22, 72, 0], [26, 73, 1], [25, 74, 0]]), mem = { fails: {}, search: {} }
  let v = null, n = 0
  const firstOk = B.siteBlueprint(srv.read, F.plan(), bpOf(ALL[FIT]), ctxOf(NINE))
  assert.strictEqual(firstOk.ok, false, 'POSITIVE CONTROL: the fitting look is blocked too')
  for (; n < 8; n++) { v = await visit(srv, mem, [NINE, H2P], { now: 1e12 + n * 300_000 }); if (v.rows.some(r => /^exhausted:H1:/.test(r))) break; assert.deepStrictEqual(mem.fails, {}) }
  assert.strictEqual(n, 4, 'four paused visits, the fifth ends the plot')
  assert.ok(v.rows.some(r => /^exhausted:H1:/.test(r)), JSON.stringify(v.rows))
  const ex = v.rows.find(r => /^exhausted:H1:/.test(r))
  assert.ok(/no_site=12/.test(ex) && /no_proven_site:cell_not_free=12/.test(ex), `the tally of reasons: ${ex}`)
  assert.deepStrictEqual([mem.fails.H1.why, mem.fails.H1.n], ['exhausted', 1])
  assert.ok(v.rows.includes('chosen:H2'), 'the next plot in the same visit')
  assert.deepStrictEqual([v.r.why, v.r.resume, v.rows.at(-1)], ['search_time', true, 'paused:H2:search_time'], 'H2\'s look is accepted as the box ends: its fresh proof is the next visit\'s (never published unproven)')
  const next = await visit(srv, mem, H.houseOffer({ layout: [NINE, H2P], fails: mem.fails, now: 1e12 + (n + 1) * 300_000 }).plots, { now: 1e12 + (n + 1) * 300_000 })
  assert.ok(next.r.ok && next.r.plotId === 'H2' && next.rows[0] === 'chosen:H2', `...and it is sited (${next.r.why})`)
  assert.deepStrictEqual(H.houseOffer({ layout: [NINE, H2P], fails: mem.fails, now: 1e12 + n * 300_000 + 1 }).plots.map(p => p.id), ['H2', 'H1'], 'H1 behind the others for 6 h')
  // back at the plot after the 6 h, the ground unchanged: the SCREEN's twelve refusals still stand (a day, under the signature); the
  // twelve a PROOF refused are over (30 min) and are searched again -- never answered from memory
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
  assert.ok(!Object.hasOwn(mem.search.H1?.looks ?? {}, ALL[0].id) && !Object.hasOwn(mem.search.H1?.proofs ?? {}, ALL[0].id), 'look 0 is NOT remembered as refused')
  assert.ok(v.searched.length > 12 && v.searched.includes('H1:2'), 'the search went on to the next looks')
  assert.deepStrictEqual([mem.fails.H1.soft, mem.fails.H1.why], [true, 'soft:kept_walk_stale'], 'the plot is not failed: passed, behind the others for 30 min')
  assert.ok(v.rows.some(x => /^passed:H1:kept_walk_stale/.test(x)), JSON.stringify(v.rows.filter(x => !/^chosen|^resumed/.test(x))))
  assert.ok(v.r.ok && v.r.plotId === 'H2', 'the next plot, west of the town, is sited in the same visit')
  assert.deepStrictEqual(v.published, ['H2:0'])
  // the looks after it were refused on a walk made AGAIN (the stale one was dropped): the long bodies by the screen, the square by proof;
  // look 0's own mark (done for this pass) is gone with the pass
  assert.deepStrictEqual([Object.keys(mem.search.H1.looks).length, Object.keys(mem.search.H1.proofs).length, mem.search.H1.softs], [12, 11, undefined])
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
  assert.deepStrictEqual([Object.keys(mem.search.H1.looks).length, Object.keys(mem.search.H1.proofs).length, mem.fails.H1.why], [12, 12, 'exhausted'])
  for (let z = -60; z <= 60; z++) for (const x of TRENCH_X) for (let y = G; y > G - 3; y--) w.srv.set([x, y, z], y === G ? 'grass_block' : 'stone')   // another bot fills the trench in
  assert.strictEqual(H.plotSig(w.read, NINE, [], HOME), sig0, 'the plot\'s own signature has not moved: the trench is far from it')
  const v2 = await visit(w, mem, [NINE], { now: 1e12 + 10 * 60_000, cost: 1_000 })
  assert.deepStrictEqual(v2.rows.slice(0, 2), ['chosen:H1', 'resumed:H1:0'], 'the proofs\' refusals are searched again, never answered from memory')
  assert.ok(v2.r.ok, v2.r.why); assert.deepStrictEqual([v2.r.look, v2.published], [ALL[0].id, ['H1:0']])
  assert.strictEqual(H.homePlotRowDetail({ project: 'cottage2', op: 'resumed', plot: 'H1', look: 0, of: 24, refused: 12, why: 'proofs_again' }), 'project=cottage2 op=resumed plot=H1 look=0 of=24 refused=12 why=proofs_again')
  // and with ONLY the screen's refusals (a plot no look has a candidate on) the answer from memory is right: exhausted, no search
  const pond = F.server(); for (let x = 17; x <= 31; x++) for (let z = -7; z <= 7; z++) pond.set([x, G, z], 'water')
  const mem2 = { fails: {}, search: {} }
  const p1 = await visit(pond, mem2, [NINE], { now: 1e12, cost: 1_000 }), p2 = await visit(pond, mem2, [NINE], { now: 1e12 + 3_600_000, cost: 1_000 })
  assert.deepStrictEqual([p1.r.why, p1.searched.length, mem2.search.H1.proofs, p2.r.why, p2.searched], ['exhausted', 24, undefined, 'exhausted', []])
})
await t('MUTANT a proof\'s refusal kept like the screen\'s: after the approach is restored the plot is answered `exhausted` from memory and never searched', async () => {
  const M = await mutantOf('homeplots.mjs', "else if (life === 'proof') { if (!Object.hasOwn(looks, id)) proofs[id] = { why: w, at: now }; delete softs[id] } else { looks[id] = w; delete proofs[id]; delete softs[id] }\n", 'else { looks[id] = w; delete proofs[id]; delete softs[id] }\n')
  let search = {}
  for (const [i, cs] of ALL.entries()) search = M.searchNoted(search, 'H1', 's', cs.id, 'no_proven_site:no_step', { now: 1e12 + i, life: 'proof' })
  let ran = 0
  const r = await H.searchPlotLooks(ALL, { plotId: 'H1', sig: 's', now: () => 1e12 + 600_000, memory: () => search, searchLook: async () => { ran++; return { ok: true } } })
  assert.deepStrictEqual([r.why, ran], ['exhausted', 0], 'the mutant\'s memory: exhausted, no search')
  let real = {}
  for (const [i, cs] of ALL.entries()) real = H.searchNoted(real, 'H1', 's', cs.id, 'no_proven_site:no_step', { now: 1e12 + i, life: 'proof' })
  const ok = await H.searchPlotLooks(ALL, { plotId: 'H1', sig: 's', now: () => 1e12 + 600_000, memory: () => real, searchLook: async () => ({ ok: true }) })
  assert.strictEqual(ok.ok, true, 'the real memory: the looks are searched again')
})
await t('REVIEW r1 (Claude ii, iii) GROUND NOT LOADED / A GUARD UNREADABLE: the proofs\' refusals are written NOWHERE, the plot is passed (not failed, not exhausted), and the next visit searches it again', async () => {
  const w = liveWorld(); trench(w)   // every candidate unreached, as on ground the siting bot has not loaded
  for (const opts of [{ unread: 40 }, { guardUnread: true }]) {
    const mem = { fails: {}, search: {} }
    const v = await visit(w, mem, [NINE, H2P], { now: 1e12, cost: 1_000, ...opts })
    assert.deepStrictEqual([mem.search.H1.proofs, mem.search.H1.softs], [undefined, undefined], 'no proof refusal is stored; the pass\'s own marks are cleared at its end')
    assert.strictEqual(Object.keys(mem.search.H1.looks).length, 12, 'the screen\'s refusals (the long bodies) are the plot\'s own: kept')
    assert.deepStrictEqual([mem.fails.H1.soft, Object.keys(mem.fails)], [true, ['H1']], 'passed, not failed'); assert.ok(v.rows.some(x => new RegExp(`^passed:H1:${opts.unread ? 'approach_unread' : 'guard_unread'}`).test(x)), JSON.stringify(v.rows.slice(-4)))
    assert.ok(v.r.ok && v.r.plotId === 'H2')
    const v2 = await visit(w, mem, [NINE], { now: 1e12 + 300_000, cost: 1_000, ...opts })
    assert.strictEqual(v2.searched.length, 12, 'the twelve square looks are searched again, every visit, until the ground can be read')
    assert.notStrictEqual(v2.r.why, 'exhausted')
  }
})
await t('`exhausted` is never reached on a proof\'s word without a search in THIS visit: a plot whose every look is refused in memory, some by a proof, has those looks searched now; a search that met an unread approach leaves it un-exhausted', async () => {
  let search = {}
  for (const [i, cs] of ALL.entries()) search = H.searchNoted(search, 'H1', 's', cs.id, i % 2 ? 'no_site' : 'no_proven_site:no_step', { now: 1e12, life: i % 2 ? 'ground' : 'proof' })
  const ran = [], rows = []
  const r = await H.searchPlotLooks(ALL, { plotId: 'H1', sig: 's', now: () => 1e12 + 60_000, memory: () => search, row: f => rows.push(`${f.op}:${f.look}:${f.refused}:${f.why}`),
    noteLook: (id, why, life) => { search = H.searchNoted(search, 'H1', 's', id, why, { now: 1e12 + 60_000, life }) }, searchLook: async cs => { ran.push(ALL.indexOf(cs)); return { ok: false, why: 'no_proven_site', more: true, refused: 'no_proven_site:no_step', life: 'proof' } } })
  assert.deepStrictEqual(ran, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], 'the proof-refused looks only')
  assert.deepStrictEqual([r.why, rows], ['exhausted', ['resumed:0:12:proofs_again']], 'exhausted after a real search')
  const soft = await H.searchPlotLooks(ALL, { plotId: 'H1', sig: 's', now: () => 1e12 + 120_000, memory: () => search, searchLook: async () => ({ ok: false, why: 'no_proven_site', more: true, soft: 'approach_unread' }) })
  assert.deepStrictEqual([soft.why, soft.soft], ['no_proven_site', 'approach_unread'], 'never exhausted on a search that could not read the approach')
  const d = await H.siteOverPlots([NINE, H2P], p => (p.id === 'H1' ? soft : { ok: true }), { noteFail: () => { throw new Error('a soft plot is never noted') }, row: () => {} })
  assert.deepStrictEqual([d.ok, d.plotId], [true, 'H2'])
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
  assert.ok(!Object.hasOwn(mem.search.H1.looks, ALL[0].id) && !Object.hasOwn(mem.search.H1.proofs ?? {}, ALL[0].id), 'the look is not remembered as refused')
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
  assert.deepStrictEqual([v.published, mem.search.H1, mem.fails.H1.why, mem.fails.H1.soft], [['H2:0'], undefined, 'soft:world_moving', true])
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
const softVisits = async (n, { MH = H } = {}) => {
  const w = softWorld(), mem = { fails: {}, search: {} }, out = []
  for (let i = 0; i < n; i++) {
    const now = 1e12 + i * 300_000
    const plots = H.houseOffer({ layout: [NINE, H2P], fails: mem.fails, now }).plots
    out.push({ order: plots.map(p => p.id).join(''), ...(await visit(w, mem, plots, { now, MH, unread: p => (p.id === 'H1' ? 40 : 0) })) })
    if (out.at(-1).r.ok) break
  }
  return { out, mem }
}
await t('REVIEW r2 (Codex 2) SOFT LOOKS AT 22 s EACH NO LONGER STARVE THE NEXT PLOT: every visit goes on after the last look it finished (0-4, 5-9, 10-14, 15-19, 20-23); the pass over, H1 is PASSED and goes behind H2; H2 is tried in visit 5 and sited in visit 6', async () => {
  const { out, mem } = await softVisits(8)
  assert.deepStrictEqual(out.slice(0, 5).map(v => v.searched.filter(x => /^H1:/.test(x)).map(x => Number(x.slice(3)))), [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23]], 'progress always moves')
  for (const v of out.slice(0, 4)) { assert.deepStrictEqual([v.order, v.r.why, v.r.resume], ['H1H2', 'search_time', true]); assert.ok(!v.rows.includes('chosen:H2')) }
  assert.ok(out[4].rows.some(x => /^passed:H1:approach_unread/.test(x)) && out[4].rows.includes('chosen:H2'), `visit 5: H1 passed, H2 tried -- ${JSON.stringify(out[4].rows.slice(-4))}`)
  assert.deepStrictEqual([mem.fails.H1.soft, mem.fails.H1.why, mem.search.H1.softs], [true, 'soft:approach_unread', undefined], 'a pass, not a failure; its marks cleared')
  assert.strictEqual(out.length, 6)
  assert.deepStrictEqual([out[5].order, out[5].r.ok, out[5].r.plotId, out[5].published], ['H2H1', true, 'H2', ['H2:0']], 'visit 6: H2 first, sited')
  // the pass's marks while it runs: the square looks done soft, the long bodies refused by the screen
  const { mem: m1 } = await softVisits(1)
  assert.deepStrictEqual([Object.keys(m1.search.H1.softs).length, Object.keys(m1.search.H1.looks).length, m1.search.H1.proofs, m1.fails], [3, 2, undefined, {}])
  assert.strictEqual(H.homePlotRowDetail({ project: 'cottage2', op: 'passed', plot: 'H1', why: 'approach_unread:no_proven_site' }), 'project=cottage2 op=passed plot=H1 why=approach_unread:no_proven_site')
})
await t('the pass and the rotation (pure): a soft mark is not a refusal and lives 30 min; a soft pass sends the plot behind the others for 30 min, never 6 h, and never shortens a real failure; a look too long for a whole box is done for the pass', async () => {
  const now = 1e12, ids = ['a', 'b', 'c']
  let m = H.searchNoted({}, 'H1', 's', 'a', 'approach_unread', { now, life: 'soft' })
  m = H.searchNoted(m, 'H1', 's', 'b', 'no_site', { now, life: 'ground' })
  let st = H.searchLeft(m, 'H1', 's', ids, now + 1)
  assert.deepStrictEqual([st.left, st.refused, st.softs, st.soft, st.first], [['c'], 1, ['a'], 'approach_unread', 2])
  assert.deepStrictEqual(H.searchLeft(m, 'H1', 's', ids, now + H.HOMEPLOT.softKeepMs).left, ['a', 'c'], 'a mark left by an interrupted pass ages out')
  assert.deepStrictEqual(H.searchNoted(m, 'H1', 's', null, null, { now: now + 5, life: 'soft', clearSoft: true }).H1.softs, undefined)
  assert.deepStrictEqual(H.searchNoted(H.searchNoted({}, 'H1', 's', 'a', 'no_proven_site:no_step', { now, life: 'proof' }), 'H1', 's', 'a', 'approach_unread', { now: now + 1, life: 'soft' }).H1, { sig: 's', at: now, last: now + 1, by: '', looks: {}, softs: { a: { why: 'approach_unread', at: now + 1 } } }, 'a soft answer now outweighs a proof\'s older word')
  // the rotation
  const P2 = [{ id: 'A', box: [0, 0, 10, 10] }, { id: 'B', box: [20, 0, 30, 10] }]
  const soft = H.failNoted({}, 'A', { why: 'soft:approach_unread', now, soft: true })
  assert.deepStrictEqual([H.HOMEPLOT.softRetryMs, H.HOMEPLOT.softKeepMs], [30 * 60_000, 30 * 60_000])
  const order = t0 => H.rotatePlots(P2, soft, t0).map(p => p.id).join('')
  assert.deepStrictEqual([order(now + 1), order(now + H.HOMEPLOT.softRetryMs - 1), order(now + H.HOMEPLOT.softRetryMs)], ['BA', 'BA', 'AB'])
  const real = H.failNoted({}, 'A', { why: 'exhausted', now })
  assert.deepStrictEqual(H.failNoted(real, 'A', { why: 'soft:x', now: now + 1000, soft: true }).A, real.A, 'a real failure inside its 6 h is left as it is')
  assert.strictEqual(H.rotatePlots(P2, real, now + H.HOMEPLOT.softRetryMs).map(p => p.id).join(''), 'BA', 'POSITIVE CONTROL: a real failure holds 6 h')
  // a look the search cannot finish in a whole box: marked, so the next visit starts after it; with part of a box, it is not
  for (const [boxFresh, want] of [[true, ['a']], [false, []]]) {
    let mm = {}
    const r = await H.searchPlotLooks(ids.map(id => ({ id })), { plotId: 'H1', sig: 's', boxFresh, now: () => now, memory: () => mm, noteLook: (id, why, life) => { mm = H.searchNoted(mm, 'H1', 's', id, why, { now, life }) }, searchLook: async () => ({ ok: false, why: 'search_time' }) })
    assert.deepStrictEqual([r.why, H.searchLeft(mm, 'H1', 's', ids, now).softs], ['search_time', want])
  }
})
await t('MUTANT a soft look not marked done for the pass (the cursor does not advance): the second visit begins at look 0 again and H2 is never tried -- the reviewer\'s starvation', async () => {
  const MH = await mutantOf('homeplots.mjs', "else { softNow ??= String(r.soft ?? 'not_kept'); mark(look.id, String(r.soft ?? 'not_kept'), 'soft') }", "else { softNow ??= String(r.soft ?? 'not_kept') }")
  const { out } = await softVisits(4, { MH })
  assert.deepStrictEqual(out.map(v => v.searched.filter(x => /^H1:/.test(x)).map(x => Number(x.slice(3)))), [[0, 1, 2, 3, 4], [0, 2, 4, 5, 6], [0, 2, 4, 5, 6], [0, 2, 4, 5, 6]], 'the square looks 0, 2, 4 every visit, for ever')
  assert.ok(out.every(v => !v.rows.includes('chosen:H2')))
})
await t('MUTANT a soft pass that does not rotate: H1 is first again at the next visit', async () => {
  const MH = await mutantOf('homeplots.mjs', "    if (last.soft) { try { noteSoft(p, last.soft) } catch { /* no memory: it is first again next visit */ } row(", '    if (last.soft) { row(')
  const { out, mem } = await softVisits(6, { MH })
  assert.deepStrictEqual(mem.fails, {}); assert.strictEqual(out[5].order, 'H1H2', 'the mutant: H1 still first after its soft pass')
  assert.strictEqual((await softVisits(6)).out[5].order, 'H2H1')
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
  const M = await mutantOf('homeplots.mjs', '    if (!todo.has(look.id)) continue\n', '')
  const srv = world(), mem = { fails: {}, search: {} }
  const seen = []
  for (let i = 0; i < 2; i++) {
    let spent = 0
    await M.searchPlotLooks(ALL, { plotId: 'H1', sig: 's', memory: () => mem.search, noteLook: (id, why) => { mem.search = H.searchNoted(mem.search, 'H1', 's', id, why, { now: 1e12 }) },
      searchLook: async cs => { if (spent >= 100_000) return { ok: false, why: 'search_time' }; spent += 22_000; seen.push(ALL.indexOf(cs)); const s = B.siteBlueprint(srv.read, F.plan(), bpOf(cs), ctxOf(NINE)); return s.ok ? { ok: true } : { ok: false, why: s.why, more: true, refused: H.refusalOf(s) } } })
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
    'the plot is searched through the memory, its looks written to the town\'s file': ["      return await searchPlotLooks(all, { plotId: o.plot.id, sig, boxFresh, memory: () => homeSearch(dir), noteLook: (id, why, life) => homeSearchNote(dir, o.plot.id, sig, id, why, me, life), clearSoft: () => homeSearchNote(dir, o.plot.id, sig, null, null, me, 'soft', true), row: f => homePlotRow(bot, { project: plot, ...f }), searchLook: lookOn })\n", '      return await lookOn(all[0])\n'],
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
