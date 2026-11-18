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
await t('retopCells: a grey top fill beside grass becomes topsoil with a tidy cut of its block on the same cell', () => {
  const { rec, n } = TT.retopCells(rec0([{ at: [0, 64, 0], role: 'earth', seg: 'T-00-0' }, { at: [0, 63, 0], role: 'core', seg: 'T-00-0' }]), grey(), { now: 7 })
  assert.strictEqual(n, 1)
  assert.deepStrictEqual(rec.cells.map(c => c.role), ['topsoil', 'core'])
  assert.deepStrictEqual(rec.cut, [{ at: [0, 64, 0], kind: 'tidy', name: 'cobblestone', retop: 7 }])
  // the cut stands while the cobble does; once dug and laid with dirt it reads done, and the cell too
  assert.strictEqual(T.cutStanding(grey(), rec.cut[0]), true)
  const after = world({ '0,64,0': 'dirt' })
  assert.strictEqual(T.cutStanding(after, rec.cut[0]), false)
  assert.strictEqual(cellDone(after(0, 64, 0), T.TIDY_PALETTE, 'topsoil'), true)
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
  assert.deepStrictEqual(rec.cut.map(c => c.at[0]).sort((a, b) => a - b), [1, 5])
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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
