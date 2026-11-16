// THE SHOWCASE WALLEXT + ACCESS FOLD (wallext-01 + access-01 onto batch 4 d3773f8b; Codex fold review BLOCKERS 2):
//  1. accessNoStair took the wall EXTENSION's rampart cells as a build footprint (its box = the extension's whole interior), so no
//     staircase could be built inside it -- the ring wall `wall` was already exempt; `wallext` is now too.
//  2. mergeSurveys (wallext: one inside-the-wall survey per box) kept each box's pit/pillar ids (`h0`, `a0`, `b0`); tidyRecord groups
//     fills by `pit` and cuts by `pillar`, so the same id from two boxes became one group (Codex's probe: four record cells from two
//     fills). Each part's ids are namespaced before the join. Anchored mutants for both.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const TD = await import('../src/tidy.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
const SRC = new URL('../src/tidy.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = readFileSync(SRC, 'utf8')
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
// Codex's probe: two boxes, each with one pit `a0` (an access stair cell) and one pillar `b0`
const part = x => ({ ok: true, cut: [{ at: [x, 66, 5], name: 'dirt', pillar: 'b0' }], fill: [{ at: [x, 65, 0], pit: 'a0', access: true }], pillars: [{ id: 'b0', col: [x, 5] }], pits: [{ id: 'a0', cols: [[x, 0]], n: 1, access: true }], access: [{ col: [x, 0], top: 65, h: 1, dir: [1, 0], cells: [[x, 65, 0]] }], skipped: { a: 1 } })
const home = { x: 0, y: 65, z: 0 }
const cellsOf = rec => rec.cells.map(c => c.at.join(','))
await t('two boxes, the same box-local ids: one record cell a fill, one cut a cut, both staircases kept', () => {
  const s = TD.mergeSurveys([part(0), part(20)])
  const r = TD.tidyRecord(s, { home })
  assert.deepStrictEqual(cellsOf(r).sort(), ['0,65,0', '20,65,0'])
  assert.strictEqual(new Set(cellsOf(r)).size, r.cells.length, 'no cell twice')
  assert.deepStrictEqual(r.cut.map(c => c.at.join(',')).sort(), ['0,66,5', '20,66,5'])
  assert.strictEqual(s.access.length, 2); assert.strictEqual(s.skipped.a, 2)
  assert.strictEqual(s.pits.length, 2, 'each box keeps its own pit'); assert.strictEqual(s.pillars.length, 2, 'and its own pillar')
  assert.deepStrictEqual(s.pits.map(q => s.fill.filter(f => f.pit === q.id).length), [1, 1], 'each pit groups only its own fill')
  assert.ok(s.fill.every(f => f.access === true), 'the access flag survives the namespacing')
})
await t('POSITIVE CONTROL: one box is unchanged (no namespacing)', () => {
  const s = TD.mergeSurveys([part(0)])
  assert.strictEqual(s.pits[0].id, 'a0'); assert.strictEqual(s.fill[0].pit, 'a0')
})
await t('MUTANT KILLED: without the namespacing the two boxes\' fills are one group (Codex\'s probe)', async () => {
  await withMutant('    const p = parts.length > 1 ? { ...p0,', '    const p = false ? { ...p0,', async M => {
    const m = M.mergeSurveys([part(0), part(20)])
    // the two boxes' pits are one `a0` (deduped by id) grouping both fills -- or, deduped by value, both and the cells twice
    assert.ok(m.pits.length !== 2 || M.tidyRecord(m, { home }).cells.length > 2, `pits ${m.pits.length}`)
    assert.ok(m.pits.map(q => m.fill.filter(f => f.pit === q.id).length).some(n => n !== 1))
  })
})
const WX = { plot: 'wallext', cells: [{ at: [-10, 65, -30] }, { at: [10, 65, -12] }] }
await t('a staircase may stand inside the wall extension (its ring is no footprint); a build\'s footprint still refuses', () => {
  assert.strictEqual(TD.accessNoStair([WX])(0, -20), false)
  assert.strictEqual(TD.accessNoStair([{ plot: 'house1', cells: [{ at: [-10, 65, -30] }, { at: [10, 65, -12] }] }])(0, -20), true, 'POSITIVE CONTROL: a house box refuses')
  assert.strictEqual(TD.accessNoStair([{ plot: 'wall', cells: WX.cells }])(0, -20), false, 'as the ring wall')
})
await t('MUTANT KILLED: without `wallext` in FOOTPRINT_SKIP the extension\'s interior refuses every staircase', async () => {
  await withMutant("new Set(['wall', 'wallext', 'paths', 'tidy', 'land'])", "new Set(['wall', 'paths', 'tidy', 'land'])", async M => {
    assert.strictEqual(M.accessNoStair([WX])(0, -20), true)
  })
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
