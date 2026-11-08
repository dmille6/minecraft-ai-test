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
  assert.deepStrictEqual(at(SC.cellEarthClears(read, vol, { above: 4, owned: () => true })), ['cut@0,5,0', 'cut@0,7,0'], 'an owed sapling never')
  assert.deepStrictEqual(at(SC.cellEarthClears(read, vol, { above: 4, listed: new Set(['0,5,0']) })), ['cut@0,7,0'])
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
    earth: { ...C.COTTAGE_EARTH, owned: () => true } })
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
