// TIDYTOP-01show (item 8, 11-18): the clean-up's own fills paved the showcase grey -- a column's top fill was role `earth`, whose
// palette lays cobblestone when the bag has no dirt and reads any solid done. Behaviour of tidytop.mjs, the refusal chain a top fill
// takes with no dirt (never stone), the re-top pass, plus anchored mutants and one wiring check.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const TT = await import('../src/tidytop.mjs')
const T = await import('../src/tidy.mjs')
const { cellDone, blockFor } = await import('../src/buildrun.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const P = n => new URL(`../src/${n}`, import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
// a tiny world: grass at y=64 everywhere, air above; `set` overrides
const world = (set = {}) => (x, y, z) => ({ name: set[`${x},${y},${z}`] ?? (y < 64 ? 'stone' : y === 64 ? 'grass_block' : 'air') })
const has = list => n => list.includes(n)

await t('surfaceFills: a column\'s top earth fill is topsoil, the lower ones core; other roles kept', () => {
  const rec = { cells: [{ at: [0, 62, 0], role: 'earth' }, { at: [0, 63, 0], role: 'earth' }, { at: [0, 64, 0], role: 'earth' }, { at: [1, 64, 0], role: 'access' }, { at: [2, 64, 0], role: 'light' }] }
  const out = TT.surfaceFills(rec)
  assert.deepStrictEqual(out.cells.map(c => c.role), ['core', 'core', 'topsoil', 'access', 'light'])
})
await t('coreFills (the siting and the refresh path) leaves no earth top; TIDYTOP=off restores the old roles', () => {
  const rec = { cells: [{ at: [5, 63, 5], role: 'earth' }, { at: [5, 64, 5], role: 'earth' }] }
  assert.deepStrictEqual(T.coreFills(rec).cells.map(c => c.role), ['core', 'topsoil'])
  const was = process.env.TIDYTOP; process.env.TIDYTOP = 'off'
  try { assert.deepStrictEqual(T.coreFills(rec).cells.map(c => c.role), ['core', 'earth']) } finally { if (was == null) delete process.env.TIDYTOP; else process.env.TIDYTOP = was }
})
await t('THE CHAIN with no dirt: a top fill is never laid with stone, is passed (not deferred), stays open, and is laid once dirt comes', () => {
  const pal = T.TIDY_PALETTE
  const q = { at: [0, 64, 0], role: 'topsoil' }
  // the old role: a bag of cobblestone lays cobblestone, which then reads done (the grey town)
  assert.strictEqual(blockFor(pal, 'earth', has(['cobblestone'])), 'cobblestone')
  assert.strictEqual(cellDone({ name: 'cobblestone', boundingBox: 'block' }, pal, 'earth'), true)
  // the new: no block for it from a bag of stone ...
  assert.strictEqual(blockFor(pal, 'topsoil', has(['cobblestone', 'cobbled_deepslate'])), null)
  // ... so the visit passes it (alsoDone: never tried, never deferred, so never counted toward a waiver) ...
  assert.strictEqual(T.soilSkip(q, has(['cobblestone'])), true)
  // ... the completion still counts it open (a stone block there is not done either) ...
  const rd = world({ '0,64,0': 'air' })
  assert.strictEqual(T.tidyProgress({ cells: [q] }, rd, { fillDone: c => cellDone(rd(...c.at), pal, c.role) }).fillLeft, 1)
  assert.strictEqual(cellDone({ name: 'cobblestone', boundingBox: 'block' }, pal, 'topsoil'), false)
  // ... and the remedy -- the town's dirt drawn (the visit bills topsoil as dirt) or the visit's own cuts' spoil in the bag -- lays it
  assert.strictEqual(T.soilSkip(q, has(['dirt'])), false)
  assert.strictEqual(blockFor(pal, 'topsoil', has(['cobblestone', 'dirt'])), 'dirt')
  assert.strictEqual(cellDone({ name: 'dirt' }, pal, 'topsoil'), true)
  assert.strictEqual(cellDone({ name: 'grass_block' }, pal, 'topsoil'), true)
})
const grey = (extra = {}) => world({ '0,64,0': 'cobblestone', ...extra })
const rec0 = (cells, more = {}) => ({ home: { x: 0, z: 0 }, cells, cut: [], ...more })
await t('retopCells: a grey top fill beside grass becomes topsoil (retop stamped); its grey block reads open, dirt reads done', () => {
  const { rec, n } = TT.retopCells(rec0([{ at: [0, 64, 0], role: 'earth', seg: 'T-00-0' }, { at: [0, 63, 0], role: 'core', seg: 'T-00-0' }]), grey(), { now: 7 })
  assert.strictEqual(n, 1)
  assert.deepStrictEqual(rec.cells.map(c => c.role), ['topsoil', 'core'])
  assert.strictEqual(rec.cells[0].retop, 7)
  assert.deepStrictEqual(rec.cut, [])
  assert.strictEqual(cellDone({ name: 'cobblestone', boundingBox: 'block' }, T.TIDY_PALETTE, 'topsoil'), false)
  assert.strictEqual(cellDone({ name: 'dirt', boundingBox: 'block' }, T.TIDY_PALETTE, 'topsoil'), true)
})
await t('retopCells: a surface core cell (its earth above waived) is re-topped; a buried one under an open fill is not', () => {
  const r = rec0([{ at: [0, 64, 0], role: 'core' }, { at: [0, 65, 0], role: 'earth' }], { waived: { '0,65,0': { why: 'x' } } })
  assert.strictEqual(TT.retopCells(r, grey()).n, 1)
  const open = rec0([{ at: [0, 64, 0], role: 'core' }, { at: [0, 65, 0], role: 'topsoil' }])
  const o = TT.retopCells(open, grey())
  assert.strictEqual(o.n, 0); assert.strictEqual(o.skipped.buried, 1)
})
await t('retopWhy: every cell it must leave is left, each with its reason', () => {
  const c = { at: [0, 64, 0], role: 'earth' }
  const rd = grey()
  assert.strictEqual(TT.retopWhy(c, rd), null)
  assert.strictEqual(TT.retopWhy({ ...c, role: 'topsoil' }, rd), 'role')
  assert.strictEqual(TT.retopWhy({ ...c, role: 'access' }, rd), 'role')
  assert.strictEqual(TT.retopWhy({ ...c, prev: true }, rd), 'not_tidy')
  assert.strictEqual(TT.retopWhy({ ...c, landmark: true }, rd), 'not_tidy')
  assert.strictEqual(TT.retopWhy(c, rd, { waived: { '0,64,0': {} } }), 'waived')
  assert.strictEqual(TT.retopWhy(c, rd, { guard: new Set(['0,64,0']) }), 'guarded')
  assert.strictEqual(TT.retopWhy(c, rd, { cutK: new Set(['0,64,0']) }), 'cut_named')
  assert.strictEqual(TT.retopWhy(c, rd, { keepOff: () => 'zone' }), 'kept_off')
  assert.strictEqual(TT.retopWhy(c, world({ '0,64,0': 'dirt' })), 'not_grey')
  assert.strictEqual(TT.retopWhy(c, grey({ '0,65,0': 'oak_planks' })), 'covered')
  const stoneAround = grey({ '1,64,0': 'cobblestone', '-1,64,0': 'cobblestone', '0,64,1': 'stone', '0,64,-1': 'andesite' })
  assert.strictEqual(TT.retopWhy(c, stoneAround), 'no_soil_beside')
  // a step down onto grass counts as beside
  assert.strictEqual(TT.retopWhy(c, grey({ '1,64,0': 'air', '1,63,0': 'grass_block', '-1,64,0': 'stone', '0,64,1': 'stone', '0,64,-1': 'stone' })), null)
})
await t('retopCells: nearest home first, at most `max`; a complete record is never touched', () => {
  const cells = [[9, 0], [1, 0], [5, 0]].map(([x, z]) => ({ at: [x, 64, z], role: 'earth' }))
  const rd = world({ '9,64,0': 'cobblestone', '1,64,0': 'cobblestone', '5,64,0': 'cobblestone' })
  const { rec, n, skipped } = TT.retopCells(rec0(cells), rd, { max: 2 })
  assert.strictEqual(n, 2); assert.strictEqual(skipped.retop_max, 1)
  assert.deepStrictEqual(rec.cells.filter(c => c.retop).map(c => c.at[0]).sort((a, b) => a - b), [1, 5])
  assert.strictEqual(TT.retopCells({ ...rec0(cells), structure_complete: true }, rd).n, 0)
})
await t('MUTANT: without the soil-beside test a grey fill in a stone yard is re-topped (the test above sees it)', async () => {
  const c = { at: [0, 64, 0], role: 'earth' }
  const stoneAround = grey({ '1,64,0': 'cobblestone', '-1,64,0': 'cobblestone', '0,64,1': 'stone', '0,64,-1': 'andesite' })
  await withMutant(P('tidytop.mjs'), "  if (!soilBeside(read, cell.at)) return 'no_soil_beside'\n", '', M => assert.strictEqual(M.retopWhy(c, stoneAround), null))
})
await t('MUTANT: an earth top kept as earth (the old rule) lays cobblestone again', async () => {
  await withMutant(P('tidytop.mjs'), "  return cell.at[1] < top ? 'core' : 'topsoil'", "  return cell.at[1] < top ? 'core' : 'earth'", M => {
    const r = M.surfaceFills({ cells: [{ at: [0, 64, 0], role: 'earth' }] })
    assert.strictEqual(blockFor(T.TIDY_PALETTE, r.cells[0].role, has(['cobblestone'])), 'cobblestone')
  })
})
await t('WIRED: the keeper\'s refresh runs retopCells inside its publish; coreFills applies surfaceFills (comments stripped)', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const sk = strip(readFileSync(P('skills.mjs'), 'utf8'))
  const i = sk.indexOf('async function tidyRefresh'), j = sk.indexOf('refreshClaimed(refreshStamp(', i)
  assert.ok(i > 0 && j > i)
  assert.ok(/retopCells\(res\.rec \?\? cur, read,/.test(sk.slice(i, j)), 'retopCells is not called in tidyRefresh before the stamp')
  const td = strip(readFileSync(P('tidy.mjs'), 'utf8'))
  assert.ok(/return tidyTopOn\(\) \? surfaceFills\(cored\) : cored/.test(td))
})

const twoGrey = async () => {
  const B = await import('./helpers/buildfake.mjs')
  const srv = B.server({ [`0,${B.G},0`]: 'cobblestone', [`4,${B.G},0`]: 'cobblestone' })
  const { rec } = TT.retopCells({ cells: [{ at: [0, B.G, 0], role: 'earth', seg: 'T' }, { at: [4, B.G, 0], role: 'earth', seg: 'T' }], segments: [{ seg: 'T', after: [] }], cut: [], clear: [], replant: [] }, srv.read)
  return { B, srv, rec }
}
const visit = async (M, dirt) => {
  const { B, srv, rec } = await twoGrey()
  const { p } = B.project(rec)
  const e = B.bot(srv, 'A', { inv: { dirt, cobblestone: 64 } })
  const passed = q => T.soilSkip(q, e.has)
  const held = M.retopHeld(rec.cells, srv.read, dirt)
  await B.R.runVisit({ ...p('A'), palette: T.TIDY_PALETTE, alsoDone: q => passed(q) || held.has(q.at.join(',')), blockLayer: false, domain: () => true, walkR: 20 }, e, { maxSteps: 100 })
  const done = q => TT.soilPassDone(passed(q), srv.read(...q.at)) || cellDone(srv.read(...q.at), T.TIDY_PALETTE, q.role)
  return { names: rec.cells.map(q => srv.read(...q.at).name).sort(), prog: T.tidyProgress(rec, srv.read, { fillDone: done }) }
}
await t('Codex r1 BLOCKER: two grey tops, one dirt -> one swapped, one left grey (never a hole); the record stays open', async () => {
  const one = await visit(TT, 1)
  assert.deepStrictEqual(one.names, ['cobblestone', 'dirt'])
  assert.strictEqual(one.prog.fillLeft, 1)
  const two = await visit(TT, 2)
  assert.deepStrictEqual(two.names, ['dirt', 'dirt'])
  assert.strictEqual(two.prog.fillLeft, 0)
  const none = await visit(TT, 0)
  assert.deepStrictEqual(none.names, ['cobblestone', 'cobblestone'])
  assert.strictEqual(none.prog.fillLeft, 2)
  // a hole is never read done by the no-dirt pass; a block that is not air is (the lawn rule as before)
  assert.strictEqual(TT.soilPassDone(true, { name: 'air' }), false)
  assert.strictEqual(TT.soilPassDone(true, null), false)
  assert.strictEqual(TT.soilPassDone(true, { name: 'cobblestone' }), false)
  assert.strictEqual(TT.soilPassDone(true, { name: 'oak_planks', boundingBox: 'block' }), true)
  assert.strictEqual(TT.soilPassDone(true, { name: 'water', boundingBox: 'empty' }), false)
  assert.strictEqual(TT.soilPassDone(true, { name: 'short_grass', boundingBox: 'empty' }), false)
  assert.strictEqual(TT.soilPassDone(false, { name: 'cobblestone' }), false)
})
await t('MUTANT: re-tops not held by the dirt budget -> one dirt digs both greys and leaves a hole', async () => {
  await withMutant(P('tidytop.mjs'), '    if (left > 0) { left--; continue }\n    out.add(kOf(c.at))', '    continue', async M => {
    const r = await visit(M, 1)
    assert.deepStrictEqual(r.names, ['air', 'dirt'])
  })
})
await t('WIRED: the visit holds re-tops by dirt in its alsoDone and the completion uses soilPassDone (comments stripped)', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const sk = strip(readFileSync(P('skills.mjs'), 'utf8'))
  assert.ok(/retopHeld\(visitRec\.cells, read, spare\('dirt'\) \+ \(took\.dirt \?\? 0\), \{ waived: rec\.waived, open: q => !buildCellDone\(read\(\.\.\.q\.at\), palette, q\.role\) \}\)/.test(sk))
  assert.ok(/alsoDone: q => [^\n]*retopPass\.has\(q\.at\.join\(','\)\)/.test(sk))
  assert.ok(/soilPassDone\(noSoil\(q\), read2\(\.\.\.q\.at\), q\)/.test(sk))
})
await t('Codex r2 BLOCKER 1: one dirt, an open topsoil hole and a grey re-top -> the hole gets the dirt, the grey is never dug', async () => {
  const B = await import('./helpers/buildfake.mjs')
  const srv = B.server({ [`2,${B.G},0`]: 'air', [`4,${B.G},0`]: 'cobblestone' })
  const rec = { cells: [{ at: [2, B.G, 0], role: 'topsoil', seg: 'T' }, { at: [4, B.G, 0], role: 'topsoil', seg: 'T', retop: 1 }], segments: [{ seg: 'T', after: [] }], cut: [], clear: [], replant: [] }
  const held = TT.retopHeld(rec.cells, srv.read, 1)
  assert.deepStrictEqual([...held], [`4,${B.G},0`])
  const { p } = B.project(rec)
  const e = B.bot(srv, 'A', { inv: { dirt: 1, cobblestone: 64 } })
  await B.R.runVisit({ ...p('A'), palette: T.TIDY_PALETTE, alsoDone: q => T.soilSkip(q, e.has) || held.has(q.at.join(',')), blockLayer: false, domain: () => true, walkR: 20 }, e, { maxSteps: 100 })
  assert.deepStrictEqual(rec.cells.map(q => srv.read(...q.at).name), ['dirt', 'cobblestone'])
  // with dirt for both, both are laid; a waived hole spends no dirt
  assert.strictEqual(TT.retopHeld(rec.cells, B.server({ [`4,${B.G},0`]: 'cobblestone', [`2,${B.G},0`]: 'air' }).read, 2).size, 0)
  assert.strictEqual(TT.retopHeld(rec.cells, srv.read, 1, { waived: { [`2,${B.G},0`]: {} } }).size, 0)
})
await t('Codex r2 BLOCKER 2: a cell waiting for dirt is never a strike toward a waiver (dirtWait) and the visit wires it (comments stripped)', () => {
  assert.strictEqual(TT.dirtWait(true, false), true); assert.strictEqual(TT.dirtWait(false, true), true); assert.strictEqual(TT.dirtWait(false, false), false)
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const sk = strip(readFileSync(P('skills.mjs'), 'utf8'))
  assert.ok(/const town = strikes\(tidyTopOn\(\) \? tidyLeftKeys\(rw, read2, \{ \.\.\.progOpts, fillDone: q => !!progOpts\.fillDone\(q\) \|\| dirtWait\(noSoil\(q\), retopPass\.has\(q\.at\.join\(','\)\)\) \}\) : left\)/.test(sk))
})
await t('MUTANT: re-tops not charged for the other holes -> the grey is dug with the hole\'s dirt', async () => {
  const B = await import('./helpers/buildfake.mjs')
  const srv = B.server({ [`2,${B.G},0`]: 'air', [`4,${B.G},0`]: 'cobblestone' })
  const cells = [{ at: [2, B.G, 0], role: 'topsoil', seg: 'T' }, { at: [4, B.G, 0], role: 'topsoil', seg: 'T', retop: 1 }]
  await withMutant(P('tidytop.mjs'), '    if (open(c, read)) left--\n', '', M => assert.strictEqual(M.retopHeld(cells, srv.read, 1).size, 0))
})
await t('Codex rel3 r1 BLOCKER 1: a re-top already dug (air) and a core hole are charged too; one dirt never digs a second grey', async () => {
  const B = await import('./helpers/buildfake.mjs')
  const srv = B.server({ [`2,${B.G},0`]: 'air', [`4,${B.G},0`]: 'cobblestone' })
  const cells = [{ at: [2, B.G, 0], role: 'topsoil', seg: 'T', retop: 1 }, { at: [4, B.G, 0], role: 'topsoil', seg: 'T', retop: 1 }]
  assert.deepStrictEqual([...TT.retopHeld(cells, srv.read, 1)], [`4,${B.G},0`])
  const core = [{ at: [2, B.G, 0], role: 'core', seg: 'T' }, { at: [4, B.G, 0], role: 'topsoil', seg: 'T', retop: 1 }]
  assert.deepStrictEqual([...TT.retopHeld(core, srv.read, 1)], [`4,${B.G},0`])
  const rec = { cells, segments: [{ seg: 'T', after: [] }], cut: [], clear: [], replant: [] }
  const { p } = B.project(rec)
  const e = B.bot(srv, 'A', { inv: { dirt: 1 } })
  const held = TT.retopHeld(rec.cells, srv.read, 1)
  await B.R.runVisit({ ...p('A'), palette: T.TIDY_PALETTE, alsoDone: q => T.soilSkip(q, e.has) || held.has(q.at.join(',')), blockLayer: false, domain: () => true, walkR: 20 }, e, { maxSteps: 100 })
  assert.deepStrictEqual(rec.cells.map(q => srv.read(...q.at).name), ['dirt', 'cobblestone'])
})
await t('Codex rel3 r2 BLOCKER: a short-grass or water topsoil cell is charged too; one dirt never digs the grey', async () => {
  const B = await import('./helpers/buildfake.mjs')
  for (const fill of ['short_grass', 'water']) {
    const srv = B.server({ [`2,${B.G},0`]: fill, [`4,${B.G},0`]: 'cobblestone' })
    const cells = [{ at: [2, B.G, 0], role: 'topsoil', seg: 'T' }, { at: [4, B.G, 0], role: 'topsoil', seg: 'T', retop: 1 }]
    assert.deepStrictEqual([...TT.retopHeld(cells, srv.read, 1)], [`4,${B.G},0`], fill)
    // and with the visit's own done test
    assert.deepStrictEqual([...TT.retopHeld(cells, srv.read, 1, { open: q => !cellDone(srv.read(...q.at), T.TIDY_PALETTE, q.role) })], [`4,${B.G},0`], fill)
  }
  const srv = B.server({ [`2,${B.G},0`]: 'short_grass', [`4,${B.G},0`]: 'cobblestone' })
  const rec = { cells: [{ at: [2, B.G, 0], role: 'topsoil', seg: 'T' }, { at: [4, B.G, 0], role: 'topsoil', seg: 'T', retop: 1 }], segments: [{ seg: 'T', after: [] }], cut: [], clear: [], replant: [] }
  const { p } = B.project(rec)
  const e = B.bot(srv, 'A', { inv: { dirt: 1 } })
  const held = TT.retopHeld(rec.cells, srv.read, 1)
  await B.R.runVisit({ ...p('A'), palette: T.TIDY_PALETTE, alsoDone: q => T.soilSkip(q, e.has) || held.has(q.at.join(',')), blockLayer: false, domain: () => true, walkR: 20 }, e, { maxSteps: 100 })
  assert.deepStrictEqual(rec.cells.map(q => srv.read(...q.at).name), ['dirt', 'cobblestone'])
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
