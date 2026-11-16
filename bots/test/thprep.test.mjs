// THPREP-01 (bots/src/sitecanopy.mjs volumeOf / cellEarthClears / clearsReachedBuilt; skills.mjs siteCanopyCtx for the town hall).
// LIVE showcase 11-08: the town hall never sited on X2 (92 of 92 visits site_wait). Offline replay of the live siting end to end on the
// region dump: the one home-facing candidate (-5,-46 W) PASSES the screen within TOWNHALL_EARTH (fill 10, cut 36 of 160/160 -- site prep
// is not needed) and fails its proof on natural leaves in its cells; listed, 10 of them are out of the town walk's reach until the floor
// is laid, 4 hide behind interior leaves, and then dirt of the plot's slope at y 70 (floor 64) and a stray sapling stand in its cells.
// With the building's volume listed (leaves, the slope above the floor within its cut limit, a stray sapling) and the reach tested as
// the visit digs (before the pad and again after it), it sites at -5,-46 W (cut 59 of 160); the cottage still sites (-3,-32 W).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, plan, server } = await import('./helpers/buildfake.mjs')
const B = await import('../src/buildsite.mjs')
const R = await import('../src/buildrun.mjs')
const C = await import('../src/cottage.mjs')
const RR = await import('../src/reroof.mjs')
const SC = await import('../src/sitecanopy.mjs')
const SC_PATH = new URL('../src/sitecanopy.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withScMutant (old, neu, fn) {
  const src = readFileSync(SC_PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const leaf = { name: 'spruce_leaves', boundingBox: 'block', props: { persistent: 'false' } }

console.log('THE PURE RULES')
await t('volumeOf: every position of the cells\' bounding box', () => {
  const v = SC.volumeOf([{ at: [0, 0, 0] }, [2, 1, 1]])
  assert.strictEqual(v.length, 3 * 2 * 2)
  assert.deepStrictEqual(SC.volumeOf([]), [])
})
await t('cellEarthClears: natural terrain ABOVE the floor only; never cobblestone or a listed cell; a stray sapling only when no record owes it', () => {
  const w = { '0,5,0': { name: 'dirt' }, '0,4,0': { name: 'grass_block' }, '1,6,0': { name: 'cobblestone' }, '2,6,0': { name: 'spruce_sapling' }, '0,7,0': { name: 'stone' } }
  const read = (x, y, z) => w[`${x},${y},${z}`] ?? { name: 'air' }
  const vol = Object.keys(w).map(k => k.split(',').map(Number))
  const at = o => o.map(c => `${c.kind}@${c.at.join(',')}`)
  assert.deepStrictEqual(at(SC.cellEarthClears(read, vol, { above: 4 })), ['cut@0,5,0', 'cut@0,7,0'], 'the floor (4) stays; cobble and an unjudged sapling stay')
  assert.deepStrictEqual(at(SC.cellEarthClears(read, vol, { above: 4, owned: () => false })), ['cut@0,5,0', 'plant@2,6,0', 'cut@0,7,0'])
  assert.deepStrictEqual(at(SC.cellEarthClears(read, vol, { above: 4, owned: a => a.join(',') === '2,6,0' })), ['cut@0,5,0', 'cut@0,7,0'], 'an owed sapling never')
  assert.deepStrictEqual(at(SC.cellEarthClears(read, vol, { above: 4, listed: new Set(['0,5,0']) })), ['cut@0,7,0'])
  // Codex r1 BLOCKER: the ground under a sapling that stays (owed, or unjudged) stays too; a record's own cell is never cut
  const w2 = { '3,5,0': { name: 'dirt' }, '3,6,0': { name: 'oak_sapling' }, '4,5,0': { name: 'dirt' } }
  const r2 = (x, y, z) => w2[`${x},${y},${z}`] ?? { name: 'air' }
  const v2 = Object.keys(w2).map(k => k.split(',').map(Number))
  assert.deepStrictEqual(at(SC.cellEarthClears(r2, v2, { above: 4, owned: a => a.join(',') === '3,6,0' })), ['cut@4,5,0'], 'an owed sapling keeps its ground')
  assert.deepStrictEqual(at(SC.cellEarthClears(r2, v2, { above: 4 })), ['cut@4,5,0'], 'unjudged: kept with its ground')
  assert.deepStrictEqual(at(SC.cellEarthClears(r2, v2, { above: 4, owned: () => false })), ['cut@3,5,0', 'cut@4,5,0', 'plant@3,6,0'], 'a stray one goes with it')
  assert.deepStrictEqual(at(SC.cellEarthClears(r2, v2, { above: 4, owned: a => a.join(',') === '4,5,0' })), ['cut@3,5,0', 'plant@3,6,0'], 'a record\'s cell is never cut')
})
await t('the hook: the earth is listed within the building\'s cut limit, else earth_over; no `earth`, no terrain listed', () => {
  const read = (x, y, z) => (y === 6 && x === 0 ? { name: 'dirt' } : { name: 'air' })
  const site = { s: 4, cut: [[9, 9, 9]], clear: [] }
  const mk = earth => SC.cellClearsHook(read, { cellsOf: () => [[0, 6, 0], [1, 6, 0]], reached: () => ({ ok: true }), earth })
  assert.deepStrictEqual(mk({ cut: 2 })(site).clear.map(c => c.kind), ['cut'])
  assert.deepStrictEqual(mk({ cut: 1 })(site), { fail: 'earth_over' }, 'the site\'s own cut counts')
  assert.strictEqual(mk(null)(site), null, 'no earth limit: nothing listed (the cottage: as before)')
})

// ---- the built reach on the fake server: a room whose middle holds leaves no ground stand reaches until its floor is laid --------
const PAD = [], LEAVES = []
for (let x = 20; x <= 30; x++) for (let z = -5; z <= 5; z++) PAD.push({ at: [x, G, z], seg: 'pad' })
for (let x = 24; x <= 26; x++) for (let z = -1; z <= 1; z++) LEAVES.push([x, G + 4, z])
function world () {
  const srv = server()
  const plain = srv.read
  // the plot is a pit three deep (the pad's top course at G; nothing walks down into it), a canopy at G + 4 over its middle
  const pit = (x, y, z) => x >= 20 && x <= 30 && z >= -5 && z <= 5 && y <= G && y >= G - 2   // 3 deep: no walk steps into it
  const lf = new Set(LEAVES.map(a => a.join(',')))
  return (x, y, z) => (lf.has(`${x},${y},${z}`) ? leaf : pit(x, y, z) ? { name: 'air', boundingBox: 'empty' } : plain(x, y, z))
}
const walk = read => B.walkFrom(read, HOME, new Set(), 64, { stood: [] })
const clears = () => LEAVES.map(at => ({ at, kind: 'leaves', name: 'spruce_leaves' }))
console.log('THE BUILT REACH (fake server, the real walkFrom + digStand)')
await t('POSITIVE CONTROL: from the town walk alone the middle leaves are unreached (reroof.mjs reroofClearsReached)', () => {
  const rc = RR.reroofClearsReached(world(), HOME, clears(), { stood: [], walkR: 64 })
  assert.strictEqual(rc.ok, false)
  assert.ok(rc.unreached.length > 0)
})
await t('clearsReachedBuilt: with the floor laid where it is free, every leaf is dug (the visit re-runs its clears after the pad)', () => {
  const rc = SC.clearsReachedBuilt(world(), clears(), { cells: PAD, walk, stand: R.digStand })
  assert.strictEqual(rc.ok, true, JSON.stringify(rc.unreached))
  assert.strictEqual(rc.padLaid, PAD.length)
})
await t('cells of another segment are no floor: nothing laid, still unreached', () => {
  const rc = SC.clearsReachedBuilt(world(), clears(), { cells: PAD.map(c => ({ ...c, seg: 'wall' })), walk, stand: R.digStand })
  assert.strictEqual(rc.ok, false, 'no pad segment: nothing laid, nothing reached')
  assert.strictEqual(rc.padLaid, 0)
})
await t('MUTANT: the floor is never laid -- the middle leaves stay unreached (killed for that reason)', async () => {
  await withScMutant('    for (const a of pad) if (!laid.has(k(a)) && free(rd(...a))) { laid.add(k(a)); moved = true }\n', '\n', async M => {
    assert.strictEqual(M.clearsReachedBuilt(world(), clears(), { cells: PAD, walk, stand: R.digStand }).ok, false)
  })
})
await t('MUTANT: the earth limit is ignored -- a slope beyond the building\'s cut would be listed (killed)', async () => {
  await withScMutant("        if ((site.cut?.length ?? 0) + ea.length > (Number(earth.cut) || 0)) return { fail: 'earth_over' }\n", '\n', async M => {
    const read = (x, y, z) => (y === 6 ? { name: 'dirt' } : { name: 'air' })
    const h = M.cellClearsHook(read, { cellsOf: () => [[0, 6, 0]], reached: () => ({ ok: true }), earth: { cut: 0 } })
    assert.ok(h({ s: 4, cut: [], clear: [] }).clear, 'the mutant lists earth past the limit')
  })
})

// SITEPROOF-02 (LIVE showcase 11-12 22:05Z: a bot kicked `Timed out` once a minute; its stack: walkFrom <- walk <-
// clearsReachedBuilt <- reached <- the siting hook <- siteBlueprintSteps). The built reach walks the town again after every clear it
// digs, straight through inside one step of the cooperative search. It is now a generator that yields after every walk.
console.log('SITEPROOF-02: the built reach, the hook and the search hand the event loop back after every walk')
const reachTrace = (M, cells = PAD) => {
  const ev = []
  const g = M.clearsReachedBuiltSteps(world(), clears(), { cells, walk: r => { ev.push('W'); return walk(r) }, stand: R.digStand })
  let r
  for (;;) { r = g.next(); if (r.done) break; ev.push('Y') }
  return { seq: ev.join(''), value: r.value }
}
await t('clearsReachedBuiltSteps IS clearsReachedBuilt, value for value (reached and unreached), and yields after EVERY walk; the walks are many (one a clear it digs); MUTANT (no yield): two walks in a row', async () => {
  const scenario = M => {
    const tr = reachTrace(M)
    assert.deepStrictEqual(tr.value, M.clearsReachedBuilt(world(), clears(), { cells: PAD, walk, stand: R.digStand }), 'the same answer')
    assert.strictEqual(tr.value.ok, true)
    const walks = tr.seq.split('W').length - 1
    assert.ok(walks >= LEAVES.length, `control: a walk for every clear dug -- ${walks} walks for ${LEAVES.length} leaves`)
    assert.ok(!tr.seq.includes('WW'), `NO-TWO-WALKS: ${tr.seq}`)
    assert.strictEqual(walks, tr.seq.split('Y').length - 1, 'a turn for every walk')
  }
  scenario(SC)
  const no = reachTrace(SC, PAD.map(c => ({ ...c, seg: 'wall' })))
  assert.strictEqual(no.value.ok, false); assert.ok(!no.seq.includes('WW'))
  assert.deepStrictEqual(no.value, SC.clearsReachedBuilt(world(), clears(), { cells: PAD.map(c => ({ ...c, seg: 'wall' })), walk, stand: R.digStand }))
  let why = null
  await withScMutant('m.get(col).push(y) } nodes = m; yield null }', 'm.get(col).push(y) } nodes = m }', async M => { try { scenario(M) } catch (e) { why = e } })
  assert.ok(why instanceof assert.AssertionError && /NO-TWO-WALKS/.test(why.message), `the mutant survived or died for another reason: ${why?.message?.slice(0, 90) ?? 'survived'}`)
})
await t('the hook: `hook(site)` and its steps give the same answer; with a stepping reach test its yields pass through; without one it is the old call straight through', () => {
  const read = (x, y, z) => (y === 6 ? { name: 'spruce_leaves', boundingBox: 'block', props: { persistent: false } } : { name: 'air', boundingBox: 'empty' })
  const site = { s: 4, cut: [], clear: [] }
  const mk = extra => SC.cellClearsHook(read, { cellsOf: () => [[0, 6, 0]], reached: () => ({ ok: true }), ...extra })
  const run = g => { let n = 0, r; for (;;) { r = g.next(); if (r.done) break; n++ } return { n, value: r.value } }
  const plain = mk({})
  assert.ok(plain(site)?.clear?.length === 1, 'control: the leaf is listed')
  assert.deepStrictEqual(run(plain.steps(site)), { n: 0, value: plain(site) }, 'no stepping test: no yield, the same answer')
  const stepping = mk({ reachedSteps: function * () { yield null; yield null; yield null; return { ok: true } } })
  assert.deepStrictEqual(run(stepping.steps(site)), { n: 3, value: plain(site) }, 'the reach test\'s three turns pass through')
  assert.deepStrictEqual(stepping(site), plain(site), 'the plain call runs the steps to their end')
  const refuse = mk({ reachedSteps: function * () { yield null; return { ok: false } } })
  assert.deepStrictEqual(refuse(site), { fail: 'leaves_unreached' })
  const boom = mk({ reachedSteps: function * () { yield null; throw new Error('x') } })
  assert.strictEqual(boom(site), null, 'a throw inside the steps: no listing, as before')
})
await t('THE SEARCH runs the hook\'s steps: every yield of the reach test is a turn of siteBlueprintSteps, and the site found is the same; MUTANT (the hook called straight through): the turns are gone', async () => {
  const BOX = [20, -5, 30, 5]
  const srv = server(), plain = srv.read
  const read = (x, y, z) => (x === 25 && z === 0 && y >= G + 1 && y <= G + 9 ? { name: 'dirt', boundingBox: 'block' } : plain(x, y, z))
  const bp = B.loadBlueprint('cottage@1f')
  const sp = C.cottageSitingPlan(HOME, { id: 'X9', box: BOX }, [])
  const base = { zones: [], stood: [], sectors: sp.sectors, plot: 'cottage1', earth: C.COTTAGE_EARTH, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line }
  const opts = s => ({ cells: B.placeBlueprint(bp, s.anchor, s.s, s.orient), fill: s.fill ?? [], walk: r => B.walkFrom(r, HOME, new Set(), sp.walkR, { stood: [] }), stand: R.digStand })
  let reachYields = 0
  const hook = SC.cellClearsHook(read, { cellsOf: s => SC.volumeOf(B.placeBlueprint(bp, s.anchor, s.s, s.orient)), earth: { ...C.COTTAGE_EARTH, owned: () => false },
    reached: (cl, s) => SC.clearsReachedBuilt(read, cl, opts(s)),
    reachedSteps: function * (cl, s) { const g = SC.clearsReachedBuiltSteps(read, cl, opts(s)); for (;;) { const r = g.next(); if (r.done) return r.value; reachYields++; yield null } } })
  const count = M => { reachYields = 0; const g = M.siteBlueprintSteps(read, plan(), bp, { ...base, cellClears: hook }); let n = 0, r; for (;;) { r = g.next(); if (r.done) break; n++ } return { n, reach: reachYields, r: r.value } }
  const real = count(B)
  assert.ok(real.r.ok, JSON.stringify(real.r.sectors?.map(q => q.proofFails)))
  assert.ok(real.reach > 0, 'control: the reach test walked (and yielded) in this search')
  const BS = new URL('../src/buildsite.mjs', import.meta.url)
  const OLD = "const xc = typeof ctx.cellClears.steps === 'function' ? yield * ctx.cellClears.steps(site) : ctx.cellClears(site)"
  const src = readFileSync(BS, 'utf8')
  assert.strictEqual(src.split(OLD).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-bs-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(OLD, 'const xc = ctx.cellClears(site)').replace(/from '\.\//g, "from '../src/").replace("new URL('.', import.meta.url)", "new URL('../src/', import.meta.url)"))
  try {
    const M = await import(out.href)
    const m = count(M)
    assert.deepStrictEqual(m.r.record, real.r.record, 'the same site either way')
    assert.strictEqual(m.reach, real.reach, 'the same reach test ran (the plain call runs its steps to their end, inside one step of the search)')
    assert.strictEqual(real.n, m.n + real.reach, `SEARCH-TURNS: ${real.n} = ${m.n} + the reach test's ${real.reach}`)
    assert.ok(real.n > m.n, 'the mutant search has none of those turns')
  } finally { try { unlinkSync(out) } catch {} }
})

console.log('THE CHAIN (fake server, the real siteBlueprint): a cottage with the slope\'s earth in its volume')
await t('a dirt pillar in the building refuses every candidate (cell_not_free); with the earth listed (its own limit) the cottage sites', () => {
  const BOX = [20, -5, 30, 5]
  const srv = server()
  const plain = srv.read
  // a dirt pillar through the middle of the plot, floor to ridge (the slope's earth standing in the building, in miniature)
  const read = (x, y, z) => (x === 25 && z === 0 && y >= G + 1 && y <= G + 9 ? { name: 'dirt', boundingBox: 'block' } : plain(x, y, z))
  const bp = B.loadBlueprint('cottage@1f')
  const sp = C.cottageSitingPlan(HOME, { id: 'X9', box: BOX }, [])
  const base = { zones: [], stood: [], sectors: sp.sectors, plot: 'cottage1', earth: C.COTTAGE_EARTH, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line }
  const off = B.siteBlueprint(read, plan(), bp, base)
  assert.strictEqual(off.ok, false)
  assert.ok(Object.assign({}, ...off.sectors.map(r => r.proofFails ?? {})).cell_not_free > 0, JSON.stringify(off.sectors.map(r => r.proofFails)))
  const hook = SC.cellClearsHook(read, { cellsOf: s => SC.volumeOf(B.placeBlueprint(bp, s.anchor, s.s, s.orient)),
    reached: (cl, s) => SC.clearsReachedBuilt(read, cl, { cells: B.placeBlueprint(bp, s.anchor, s.s, s.orient), fill: s.fill ?? [], walk: r => B.walkFrom(r, HOME, new Set(), sp.walkR, { stood: [] }), stand: R.digStand }),
    earth: { ...C.COTTAGE_EARTH, owned: () => false } })
  const on = B.siteBlueprint(read, plan(), bp, { ...base, cellClears: hook })
  assert.ok(on.ok, JSON.stringify(on.sectors?.map(r => [r.proofFails, r.proofEx])))
  const cuts = on.record.clear.filter(c => c.kind === 'cut' && c.at[0] === 25 && c.at[2] === 0)
  assert.ok(cuts.length > 0 && cuts.length <= C.COTTAGE_EARTH.cut, `the slope listed within the limit (${cuts.length})`)
})
await t('wired (structural, comments stripped): the town hall passes its earth limit and the owned test; SITEPAD gates the volume and the built reach', () => {
  const sk = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(sk.includes('...siteCanopyCtx(prd, bp, plan.home, stood, sp.walkR, { ...(sp.earth ?? TOWNHALL_EARTH), owned: recordOwned() }),'))
  assert.ok(sk.includes('cellsOf: site => (sitePadOn() ? volumeOf : c => c.map(q => q.at))(placeBlueprint(bp, site.anchor, site.s, site.orient)),'))
  assert.ok(/reached: \(cl, site\) => \(sitePadOn\(\) && site\n\s+\? clearsReachedBuilt\(read, cl, /.test(sk))
  assert.strictEqual(SC.sitePadOn({ SITEPAD: 'off' }), false); assert.strictEqual(SC.sitePadOn({}), true)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
