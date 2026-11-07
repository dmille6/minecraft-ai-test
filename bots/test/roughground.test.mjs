// ROUGHGROUND-01 (fleet variant; owner 11-07, the showcase's circled renders): the ground tidy-01's pillar and pit rules miss, taken by
// the same survey (tidy.mjs surveyTidy -> roughground.mjs surveyRough) in the town square and every band. Behaviour on buildfake's
// flat world (stone below G, grass at G, readable to +-60), ROUGH=off as the control (tidy-01 as it was).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, server } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const RG = await import('../src/roughground.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const RG_PATH = new URL('../src/roughground.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const site = (srv, { rough = true, avoid = () => null, cells = new Set(), r = 30 } = {}) => T.siteTidy(srv.read, { home: HOME, avoid, cells, r, rough })
const cutAt = rec => (rec?.cut ?? []).map(c => c.at.join(',')).sort()
const fillAt = rec => (rec?.cells ?? []).map(c => c.at.join(',')).sort()
const xyz = (...a) => a.join(',')
const col = srv => (x, z) => T.tidyColumn(srv.read, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 })
const rough = (srv, o = {}) => RG.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col: col(srv), spoil: T.SPOIL, yLo: HOME.y - 14, ...o })

// siteTidy passes `rough` through surveyTidy's options only when the survey is called with it: the switch is ROUGH in the env
const withEnv = async (v, fn) => { const o = process.env.ROUGH; process.env.ROUGH = v; try { return await fn() } finally { if (o === undefined) delete process.env.ROUGH; else process.env.ROUGH = o } }

await t('a dirt beam in the air, a 2-column clump, a 2x1 hole and a crafting table on a dirt pillar are taken; ROUGH=off (tidy-01) takes none', async () => {
  const srv = server()
  for (const x of [5, 6, 7]) srv.set([x, G + 4, 3], 'dirt')
  srv.set([3, G + 1, -8], 'dirt'); srv.set([4, G + 1, -8], 'dirt')
  srv.set([-5, G, 5], 'air'); srv.set([-4, G, 5], 'air')
  srv.set([2, G + 1, -14], 'dirt'); srv.set([2, G + 2, -14], 'crafting_table')
  const r = await withEnv('on', () => site(srv))
  assert.deepStrictEqual(cutAt(r.record), [xyz(2, G + 1, -14), xyz(2, G + 2, -14), xyz(3, G + 1, -8), xyz(4, G + 1, -8), xyz(5, G + 4, 3), xyz(6, G + 4, 3), xyz(7, G + 4, 3)].sort())
  assert.deepStrictEqual(fillAt(r.record), [xyz(-5, G, 5), xyz(-4, G, 5)].sort())
  assert.strictEqual(r.record.rough.floating, 3); assert.strictEqual(r.record.rough.stations, 1)
  const off = await withEnv('off', () => site(srv))
  assert.strictEqual(off.record, null, 'control: tidy-01 takes none of it')
})
await t('never: an avoided column, a record cell\'s column or its ring, natural stone, a hill, water in a hole\'s rim', async () => {
  const srv = server(); const cells = new Set([xyz(10, G + 1, 10)])
  srv.set([0, G + 1, 15], 'dirt'); srv.set([1, G + 1, 15], 'dirt')            // avoided
  srv.set([10, G + 1, 10], 'cobblestone'); srv.set([11, G + 1, 10], 'dirt'); srv.set([11, G + 1, 11], 'dirt')   // a record cell + its ring
  srv.set([-12, G + 1, -2], 'stone'); srv.set([-12, G + 1, -3], 'stone')       // natural
  for (let x = -12; x <= -4; x++) for (let z = 8; z <= 16; z++) srv.set([x, G + 1, z], 'grass_block')   // a 9x9 hill
  srv.set([14, G, -5], 'air'); srv.set([15, G, -5], 'air'); srv.set([16, G, -5], 'water')
  const avoid = (x, z) => (z === 15 && x >= -1 && x <= 2 ? 'zone' : null)
  const r = rough(srv, { avoid, cells })
  assert.deepStrictEqual(r.cut, [], JSON.stringify(r.cut.slice(0, 4)))
  assert.deepStrictEqual(r.fill, [], JSON.stringify(r.fill.slice(0, 4)))
})
await t('a raised crust over a hollow is left (a cut would open it, a bot maybe inside: Codex r1 BLOCKER); the mutant without the guard cuts it', async () => {
  const srv = server()
  srv.set([12, G + 1, -3], 'grass_block'); srv.set([12, G, -3], 'air'); srv.set([12, G - 1, -3], 'air')
  const r = rough(srv)
  assert.deepStrictEqual(r.cut, []); assert.deepStrictEqual(r.fill, [])
  await withMutant(RG_PATH, "if (!bad && !solidAt(x, rimMax, z)) bad = 'clump_hollow'", '', async M => {
    const m = M.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col: col(srv), spoil: T.SPOIL, yLo: HOME.y - 14 })
    assert.ok(m.cut.some(c => c.at[0] === 12 && c.at[2] === -3), 'mutant opens the hollow')
  })
})
await t('mutants: the floating run without its open-cell end, the plan\'s cells read as a build', async () => {
  const srv = server()
  for (const x of [5, 6, 7]) srv.set([x, G + 4, 3], 'dirt')
  srv.set([6, G + 1, -6], 'crafting_table')
  assert.strictEqual(rough(srv).census.floating, 3)
  await withMutant(RG_PATH, "      if (openCell(b)) break\n      if (!spoil.test(nm(b))) return { segs, ground: y, why: run.length ? 'attached' : null }", "      if (!spoil.test(nm(b))) return { segs, ground: y, why: run.length ? 'attached' : null }", async M => {
    const m = M.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col: col(srv), spoil: T.SPOIL, yLo: HOME.y - 14 })
    assert.strictEqual(m.census.floating, 0, 'mutant keeps the beam')
  })
  const avoid = (x, z) => (x === 6 && z === -6 ? 'plan_cell' : null)
  assert.ok(!rough(srv, { avoid, buildWhy: /^plan_cell$/ }).cut.some(c => c.at[0] === 6 && c.at[2] === -6), 'the plan\'s table is kept')
  await withMutant(RG_PATH, "if (w === 'plan_cell' || w === 'plan_box') return 'plan'", '', async M => {
    const m = M.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col: col(srv), spoil: T.SPOIL, avoid, buildWhy: /^plan_cell$/, yLo: HOME.y - 14 })
    assert.ok(m.cut.some(c => c.at[0] === 6 && c.at[2] === -6), 'mutant cuts the plan\'s table')
  })
})
await t('idempotent: the record laid, a re-survey finds nothing more', async () => {
  const srv = server()
  for (const x of [5, 6, 7]) srv.set([x, G + 4, 3], 'dirt')
  srv.set([3, G + 1, -8], 'dirt'); srv.set([4, G + 1, -8], 'dirt'); srv.set([-5, G, 5], 'air'); srv.set([-4, G, 5], 'air')
  const r = await withEnv('on', () => site(srv))
  const after = T.tidyOverlay(srv.read, r.record)
  const r2 = await withEnv('on', () => T.siteTidy(after, { home: HOME, r: 30 }))
  assert.strictEqual(r2.record, null)
})
await t('the wiring: surveyTidy runs the rough survey under ROUGH, over its own square or band (inSq), off the columns it already works', async () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  const td = strip(readFileSync(new URL('../src/tidy.mjs', import.meta.url), 'utf8'))
  assert.ok(/rough = roughOn\(\) \} = \{\}\) \{/.test(td), 'the switch')
  assert.ok(/const rs = surveyRough\(read, \{ home, box: \[home\.x - r, home\.z - r, home\.x \+ r, home\.z \+ r\], within: inSq, col, spoil: SPOIL, avoid, cells, busy, yLo \}\)/.test(td), 'the call')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
