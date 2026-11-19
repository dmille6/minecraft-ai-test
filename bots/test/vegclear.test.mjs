// VEGCLEAR-01show: wild vegetation (a mushroom, a stray flower or sapling, grass, a fern) in an OPEN record cell is dug like scaffold
// and the cell laid -- never from a cell whose role names vegetation (a design's own flower bed, pot, sapling or meadow). Behaviour
// through buildfake's runVisit, plus an anchored mutant.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, server, bot, project, R } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')

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
const visit = async (RR, block, role, palette) => {
  const srv = server({ [`5,${G},5`]: block, [`5,${G - 1},5`]: 'dirt' })
  const rec = { cells: [{ at: [5, G, 5], role, seg: 'T' }], segments: [{ seg: 'T', after: [] }], cut: [], clear: [], replant: [] }
  const inv = { stone_pickaxe: 1, dirt: 4, poppy: 2 }
  const digDrops = async (c, expect) => { const n = srv.read(...c)?.name; if (expect && n !== expect) return 'refused'; srv.set(c, 'air'); inv[n] = (inv[n] ?? 0) + 1; return 'confirmed' }
  const e = bot(srv, 'A', { inv, feet: [6, G + 1, 3], dig: digDrops })
  const { p } = project(rec)
  const r = await RR.runVisit({ ...p('A'), palette, blockLayer: false, domain: () => true, walkR: 30 }, e, { maxSteps: 60 })
  return { top: srv.read(5, G, 5).name, stop: r.stop }
}
await t('a brown mushroom in an open fill cell is dug, then the cell is laid (T11 11,69,-30: `blocked` for good before)', async () => {
  const r = await visit(R, 'brown_mushroom', 'topsoil', T.TIDY_PALETTE)
  assert.strictEqual(r.top, 'dirt')
  for (const n of ['poppy', 'sweet_berry_bush', 'red_mushroom']) assert.strictEqual((await visit(R, n, 'topsoil', T.TIDY_PALETTE)).top, 'dirt', n)
  // Codex vegclear r1: never a sapling (a replant somebody owes), never a block a placement already replaces
  assert.strictEqual((await visit(R, 'oak_sapling', 'topsoil', T.TIDY_PALETTE)).top, 'oak_sapling', 'a sapling stays')
  assert.strictEqual(R.vegForeign('short_grass', T.TIDY_PALETTE, 'topsoil'), null)
  assert.strictEqual((await visit(R, 'short_grass', 'topsoil', T.TIDY_PALETTE)).top, 'dirt', 'grass is placed into, as before')
})
await t('a design\'s own plant cell is never dug: a flower bed holding another flower stays as it is; one holding its flower is done', async () => {
  const pal = { bed: ['poppy'], pot: ['$bed'] }
  const r = await visit(R, 'dandelion', 'bed', pal)
  assert.strictEqual(r.top, 'dandelion', 'the bed\'s dandelion stays (never dug by the wild-vegetation rule)')
  assert.strictEqual((await visit(R, 'dandelion', 'pot', pal)).top, 'dandelion', 'through a $role too')
  assert.strictEqual(R.vegForeign('dandelion', pal, 'bed'), null)
  assert.strictEqual(R.vegForeign('dandelion', { earth: ['dirt'] }, 'earth'), 'scaffold')
  assert.strictEqual(R.vegForeign('oak_planks', { earth: ['dirt'] }, 'earth'), null, 'not vegetation: as before')
})
await t('the list never names a block a design places as a solid, and the overburden and cover digs do not take it', () => {
  const src = readFileSync(P('buildrun.mjs'), 'utf8')
  assert.ok(!R.FOREIGN_CLEAR.test('poppy') && !R.FOREIGN_CLEAR.test('brown_mushroom'), 'FOREIGN_CLEAR itself is unchanged')
  assert.strictEqual(R.foreignKind('brown_mushroom'), null)
  assert.ok(/foreignKind\(nm\(rd\(\.\.\.c\.at\)\), scaffoldRe\) \?\? vegForeign\(nm\(rd\(\.\.\.c\.at\)\), palette, c\.role\)/.test(src))
})
await t('MUTANT: without the open-cell rule the mushroom cell stays blocked', async () => {
  await withMutant(P('buildrun.mjs'), ' ?? vegForeign(nm(rd(...c.at)), palette, c.role))', ')', async M => {
    const r = await visit(M, 'brown_mushroom', 'topsoil', T.TIDY_PALETTE)
    assert.strictEqual(r.top, 'brown_mushroom')
  })
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
