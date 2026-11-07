// THE SHOWCASE GKSTAGE FOLD (gkstage-01show on the siteprep-02 fold 3a332742; Codex fold review BLOCKER): inwall's litter rule reads a
// column `avoid` names a build's (`project`, BUILD_WHY) as litter ON a build -- and a site-prep reservation (a prepping or prepared
// plot) under a project cell is masked by that `project` (tidyAvoid returns pathAvoid's reason first): Codex's read-only repro scheduled
// dirt at [0,71,0] for cutting inside SP1's prepared plot. Now the reservations are checked on their own, first. Anchored mutant.
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
// Codex's repro: a prep fill (a record cell) at 0,70,0 with a dirt block on it, the column named `project`, SP1's plot reserved
const home = { x: 0, y: 70, z: 0 }
const read = (x, y, z) => (y <= 70 || (x === 0 && z === 0 && y === 71) ? { name: 'dirt', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
const cells = new Set(['0,70,0'])
const avoid = (x, z) => (x === 0 && z === 0 ? 'project' : null)
const inSP1 = (x, z) => x >= -10 && x <= 10 && z >= -10 && z <= 10
await t('POSITIVE CONTROL (the repro): without the reservation check the dirt on the prep fill is litter on a build', () => {
  const s = TD.surveyInwall(read, { home, box: [0, 0, 0, 0], avoid, cells })
  assert.deepStrictEqual(s.cut.map(c => c.at.join(',')), ['0,71,0'])
})
await t('a reserved plot is never inwall\'s: no cut, no fill there, the skip named', () => {
  const s = TD.surveyInwall(read, { home, box: [0, 0, 0, 0], avoid, cells, reserved: inSP1 })
  assert.strictEqual(s.cut.length, 0); assert.strictEqual(s.fill.length, 0)
  assert.strictEqual(s.skipped.reserved, 1)
})
await t('outside the reservation the litter rule is unchanged', () => {
  const s = TD.surveyInwall(read, { home, box: [0, 0, 0, 0], avoid, cells, reserved: (x, z) => x > 5 })
  assert.strictEqual(s.cut.length, 1)
})
await t('MUTANT KILLED: without the reservation check the prepared plot is cut again', async () => {
  await withMutant("    if (reserved(x, z)) { skip('reserved'); continue }\n", '', async M => {
    assert.strictEqual(M.surveyInwall(read, { home, box: [0, 0, 0, 0], avoid, cells, reserved: inSP1 }).cut.length, 1)
  })
})
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
await t('WIRED: siteStage passes `reserved` to surveyInwall; skills.mjs builds it from the siteprep reservation and hands it to siteStage', () => {
  const td = strip(readFileSync(SRC, 'utf8'))
  // the wallext + access fold: one survey per box inside the walls, each with the reservations and access-01's noStair
  assert.ok(td.includes('noLitter: inwallNoLitter(terrace?.records ?? []), reserved: reservedP, noStair, water, waterOk, T: { ...INWALL, hollowRough: roughOn(env) } }))'), 'access-01: + noStair, every box (roughground-1b: + hollowRough)')
  assert.ok(td.includes('const reservedP = (x, z) => pp.cols.has(k2(x, z)) || reserved(x, z)'), 'plotprep-01: the site-prep reservation still reaches every rule')
  assert.ok(td.includes('const noStair = accessNoStair(terrace?.records ?? [], { plan, land })'), 'access-01: the refusals built once')
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(sk.includes('const rz = [...recordZones(recs.filter(r => r?.plot === SITEPREP_PLOT)).filter(z => !(prepExcept && z?.id === prepExcept)), ...townMarkerZones()]'))   // gkmarker-01: + the markers
  assert.ok(sk.includes('terrace, reserved: I.reserved, forest: forestRecNow() })'))   // forest-01: the forest rides along for the replants
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
