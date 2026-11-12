// SITECANOPY-01 (bots/src/sitecanopy.mjs; buildsite.mjs siteBlueprint `ctx.cellClears`; skills.mjs cottageSiteFor / townhallSiteFor).
// LIVE showcase 11-08: the cottage never sited in 3 days (80 of 80 visits site_wait, `no_proven_site`): every home-facing candidate on
// plot X3 failed `cell_not_free` on spruce leaves in its roof cells; replayed end to end on the region dump, the hook sites it.
// Here: the pure rules, then THE CHAIN on the fake server (the real siteBlueprint + cottageSitingPlan + reroofClearsReached): a canopy
// layer over the plot refuses every candidate (the positive control), the hook sites it with the leaves listed; a placed hedge is
// never listed; leaves no stand reaches fail by name; anchored mutants.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, plan, server } = await import('./helpers/buildfake.mjs')
const B = await import('../src/buildsite.mjs')
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
const leaf = (persistent = 'false') => ({ name: 'spruce_leaves', boundingBox: 'block', props: { persistent } })

console.log('THE PURE RULES')
await t('naturalLeafAt: grown leaves only (persistent false); a placed hedge, unread props, other blocks: never', () => {
  assert.strictEqual(SC.naturalLeafAt(leaf()), true)
  assert.strictEqual(SC.naturalLeafAt({ name: 'oak_leaves', props: { persistent: false } }), true)
  assert.strictEqual(SC.naturalLeafAt(leaf('true')), false)
  assert.strictEqual(SC.naturalLeafAt({ name: 'spruce_leaves' }), false)
  assert.strictEqual(SC.naturalLeafAt({ name: 'grass_block', props: { persistent: 'false' } }), false)
})
await t('cellLeafClears: the natural leaves in the cells, low before high, once each; never a cell the site lists; too many -> null', () => {
  const w = { '1,5,1': leaf(), '1,3,1': leaf(), '2,3,2': leaf('true'), '4,4,4': leaf() }
  const read = (x, y, z) => w[`${x},${y},${z}`] ?? { name: 'air' }
  const cells = [[1, 5, 1], [1, 3, 1], [1, 3, 1], [2, 3, 2], [4, 4, 4], [9, 9, 9]]
  assert.deepStrictEqual(SC.cellLeafClears(read, cells).map(c => c.at.join(',')), ['1,3,1', '4,4,4', '1,5,1'])
  assert.ok(SC.cellLeafClears(read, cells).every(c => c.kind === 'leaves' && c.name === 'spruce_leaves'))
  assert.deepStrictEqual(SC.cellLeafClears(read, cells, { listed: new Set(['4,4,4']) }).map(c => c.at.join(',')), ['1,3,1', '1,5,1'])
  assert.strictEqual(SC.cellLeafClears(read, cells, { max: 2 }), null)
})
await t('cellClearsHook: nothing in the cells -> null; reached -> { clear }; not reached -> leaves_unreached; the reach test gets the site\'s clears too', () => {
  const read = (x, y, z) => (y === 5 ? leaf() : { name: 'air' })
  const seen = []
  const ok = SC.cellClearsHook(read, { cellsOf: s => s.cells, reached: all => { seen.push(all.map(c => c.at[1])); return { ok: true } } })
  assert.strictEqual(ok({ cells: [[0, 1, 0]], clear: [] }), null)
  const r = ok({ cells: [[0, 5, 0]], clear: [{ at: [3, 2, 3], kind: 'tree', name: 'oak_log' }] })
  assert.deepStrictEqual(r.clear.map(c => c.at), [[0, 5, 0]])
  assert.deepStrictEqual(seen.at(-1), [2, 5], 'every clear, low before high')
  const no = SC.cellClearsHook(read, { cellsOf: s => s.cells, reached: () => ({ ok: false }) })
  assert.deepStrictEqual(no({ cells: [[0, 5, 0]], clear: [] }), { fail: 'leaves_unreached' })
  const boom = SC.cellClearsHook(read, { cellsOf: () => { throw new Error('x') }, reached: () => ({ ok: true }) })
  assert.strictEqual(boom({}), null, 'never throws')
  assert.strictEqual(SC.sitecanopyOn({ SITECANOPY: 'off' }), false); assert.strictEqual(SC.sitecanopyOn({}), true)
})

// ---- THE CHAIN: a cottage plot east of home on the fake server's flat ground, a canopy of natural leaves over it ------------------
const BOX = [20, -5, 30, 5]
const LEAF_Y = G + 5
function scene ({ persistent = 'false', y = LEAF_Y } = {}) {
  const srv = server()
  const plain = srv.read
  const read = (x, yy, z) => { const b = plain(x, yy, z); if (!b) return b; if (yy === y && x >= BOX[0] - 1 && x <= BOX[2] + 1 && z >= BOX[1] - 1 && z <= BOX[3] + 1 && b.name === 'air') return leaf(persistent); return b }
  return read
}
function site (read, { hook = true, mod = SC } = {}) {
  const bp = B.loadBlueprint('cottage@1f')
  const sp = C.cottageSitingPlan(HOME, { id: 'X9', box: BOX }, [])
  const ctx = { zones: [], stood: [], sectors: sp.sectors, plot: 'cottage1', earth: sp.earth ?? C.COTTAGE_EARTH, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line,
    ...(hook ? { cellClears: mod.cellClearsHook(read, { cellsOf: s => B.placeBlueprint(bp, s.anchor, s.s, s.orient).map(c => c.at), reached: cl => RR.reroofClearsReached(read, HOME, cl, { stood: [], walkR: sp.walkR }) }) } : {}) }
  return B.siteBlueprint(read, plan(), bp, ctx)
}
const fails = s => Object.assign({}, ...(s.sectors ?? []).map(r => r.proofFails ?? {}))

console.log('THE CHAIN (fake server, the real siteBlueprint)')
await t('POSITIVE CONTROL: with no canopy the plot sites (the flat ground and the plan are good)', () => {
  const s = site(server().read, { hook: false })
  assert.ok(s.ok, JSON.stringify(s.sectors))
})
await t('POSITIVE CONTROL (the live dead end): a canopy over the roof refuses every candidate, cell_not_free', () => {
  const s = site(scene(), { hook: false })
  assert.strictEqual(s.ok, false)
  assert.strictEqual(s.why, 'no_proven_site')
  assert.ok(fails(s).cell_not_free > 0, JSON.stringify(fails(s)))
})
await t('the hook: the cottage sites, its record lists the leaves in its cells (kind leaves) and nothing else of the canopy', () => {
  const read = scene()
  const s = site(read)
  assert.ok(s.ok, JSON.stringify(s.sectors?.map(r => r.proofFails)))
  const lv = s.record.clear.filter(c => c.kind === 'leaves')
  assert.ok(lv.length > 0, 'leaves listed')
  const cells = new Set(s.record.cells.map(c => c.at.join(',')))
  assert.ok(lv.every(c => cells.has(c.at.join(',')) && c.at[1] === LEAF_Y), 'only the leaves in the building\'s own cells')
})
await t('a PLACED hedge layer (persistent true) is never listed: the candidates stay refused', () => {
  const s = site(scene({ persistent: 'true' }))
  assert.strictEqual(s.ok, false)
  assert.ok(!(fails(s).leaves_unreached > 0) && fails(s).cell_not_free > 0, JSON.stringify(fails(s)))
})
await t('leaves no stand reaches: the candidate fails by name (leaves_unreached), never sited blind', () => {
  // the reach test answers no: a canopy the town walk cannot see
  const read = scene()
  const bp = B.loadBlueprint('cottage@1f')
  const sp = C.cottageSitingPlan(HOME, { id: 'X9', box: BOX }, [])
  const s = B.siteBlueprint(read, plan(), bp, { zones: [], stood: [], sectors: sp.sectors, plot: 'cottage1', earth: sp.earth ?? C.COTTAGE_EARTH, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line,
    cellClears: SC.cellClearsHook(read, { cellsOf: x => B.placeBlueprint(bp, x.anchor, x.s, x.orient).map(c => c.at), reached: () => ({ ok: false }) }) })
  assert.strictEqual(s.ok, false)
  assert.ok(fails(s).leaves_unreached > 0, JSON.stringify(fails(s)))
})
await t('MUTANT: naturalLeafAt never true -- the hook lists nothing and the cottage stays unsited (killed for that reason)', async () => {
  await withScMutant("  return p?.persistent === false || p?.persistent === 'false'\n}", '  return false\n}', async M => {
    const s = site(scene(), { mod: M })
    assert.strictEqual(s.ok, false); assert.ok(fails(s).cell_not_free > 0)
  })
})
await t('MUTANT: the hook skips its reach test -- an unreached canopy would be sited blind (the test above fails for that reason)', async () => {
  await withScMutant("      return reached(all, site)?.ok ? { clear: cl } : { fail: 'leaves_unreached' }", '      return { clear: cl }', async M => {
    const read = scene()
    const h = M.cellClearsHook(read, { cellsOf: x => x.cells, reached: () => ({ ok: false }) })
    assert.ok(h({ cells: [[20, LEAF_Y, 0]], clear: [] }).clear, 'the mutant lists leaves it never reaches')
  })
})
await t('wired (structural: comments stripped): the cottage and the town hall siting pass the hook; siteBlueprint asks it before the proof', () => {
  const strip = f => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const sk = strip('../src/skills.mjs')
  assert.strictEqual(sk.split('...siteCanopyCtx(prd, bp, plan.home, stood, sp.walkR),').length, 2, 'the cottage')
  assert.strictEqual(sk.split('...siteCanopyCtx(prd, bp, plan.home, stood, sp.walkR, { ...(sp.earth ?? TOWNHALL_EARTH), owned: recordOwned() }),').length, 2, 'the town hall (thprep-01: its earth limit too)')
  assert.ok(/else if \(\/_leaves\$\/\.test\(name\)\) \{ try \{ props = b\.getProperties\?\.\(\) \?\? null \}/.test(sk), 'planReader reads a leaf\'s persistent')
  const bs = strip('../src/buildsite.mjs')
  assert.ok(/const xc = ctx\.cellClears\(site\)\n\s+if \(xc\?\.fail\) \{ proofFails\[xc\.fail\] = \(proofFails\[xc\.fail\] \?\? 0\) \+ 1; continue \}\n\s+if \(xc\?\.clear\?\.length\) site = \{ \.\.\.site, clear: \[\.\.\.site\.clear, \.\.\.xc\.clear\] \}\n\s+\}\n\s+let p = yield \* proveSiteSteps/.test(bs))   // siteproof-01: the proof's own steps (the same proof, a turn after every walk)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
