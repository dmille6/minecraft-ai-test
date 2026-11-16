// CWSTALL-01 (LIVE showcase f7909770, 11-10): the citywall planner's DESIGN visit (skills.mjs buildCitywall) ran 15.6-20.5 s with no await
// (`_build_visit project=citywall outcome=no_site ms=15629..20509`, wallext: the design would cut 5). Offline on the 11-10 17:16Z copy
// (scripts/citywall-stall-offline.mjs): the town walk 0.25-0.55 s, the swap walk 0.34-0.63 s, the design 0.01-0.02 s more, the escape
// proof 2.5-3.8 s (six walks) -- all one macrotask, 3.2-4.8 s. After: the escape proof breathes between and inside its walks (wall.mjs
// wallEscapeAsync, walkSet sliced every WALK_SLICE cells: 88 slices, the longest 66-99 ms), the visit between its stages; the longest
// stretch is one town walk (0.38-0.43 s). The answer is wallEscape's to the cell. Mutants anchored (present and unique).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { server, HOME } = await import('./helpers/buildfake.mjs')
const W = await import('../src/wall.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const WALL_PATH = new URL('../src/wall.mjs', import.meta.url)
const PLAN = { home: HOME, gen: 4, plots: [{ id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], keepout: true }], paths: [] }
const counting = () => { const c = { n: 0 }; return [c, async () => { c.n++; await new Promise(r => setImmediate(r)) }] }

await t('the breathing proof answers as wallEscape does: the sited ring (0 cut / 0 trapped) and the shut ring (the positive control: a pen)', async () => {
  const srv = server()
  const r = W.siteWall(srv.read, { plan: PLAN }).record
  const shut = [...r.cells]
  for (const c of r.cols.filter(q => q.s !== 'wall' && q.s !== 'post')) for (let y = 71; y <= 73; y++) shut.push({ at: [c.x, y, c.z], role: 'wall', seg: 'x' })
  for (const cells of [r.cells, shut]) {
    const s = W.wallEscape(srv.read, HOME, cells, { r: 20 })
    const [c, pause] = counting()
    const a = await W.wallEscapeAsync(srv.read, HOME, cells, { r: 20 }, { pause })
    assert.deepStrictEqual(a, s)
    assert.ok(c.n >= 7, `a turn between the walks (${c.n})`)
  }
  assert.ok(W.wallEscape(srv.read, HOME, shut, { r: 20 }).trapped > 100, 'the positive control pens the outside')
})
// a flat world 81 x 81 inside r 40: 6,561 feet cells a walk -- each of the six walks crosses WALK_SLICE once
const FLAT = (x, y, z) => (y < 70 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
const FHOME = { x: 0, y: 70, z: 0 }
await t('the walks are sliced: 7 turns between the walks + 1 inside each of the six (6,561 cells > WALK_SLICE); the same answer as the sync proof', async () => {
  assert.strictEqual(W.WALK_SLICE, 4096)
  const [c, pause] = counting()
  const a = await W.wallEscapeAsync(FLAT, FHOME, [], { r: 40 }, { pause })
  assert.strictEqual(c.n, 13)
  assert.deepStrictEqual(a, W.wallEscape(FLAT, FHOME, [], { r: 40 }))
  assert.strictEqual(a.reach0, 81 * 81)
  assert.strictEqual(W.walkSet(FLAT, FHOME, 40).size, 81 * 81, 'walkSet (sync) unchanged')
})
await t('aborted at a pause -> null (the visit stops), never a half answer', async () => {
  let n = 0
  assert.strictEqual(await W.wallEscapeAsync(FLAT, FHOME, [], { r: 40 }, { pause: async () => {}, aborted: () => ++n >= 3 }), null)
})
await t('MUTANTS KILLED: no turn inside a walk (7 turns); no turn between the reverse walks (12)', async () => {
  await withMutant(WALL_PATH, "    if (h > 0 && h % WALK_SLICE === 0) yield 'walk'\n", '', async M => {
    const [c, pause] = counting(); await M.wallEscapeAsync(FLAT, FHOME, [], { r: 40 }, { pause })
    assert.strictEqual(c.n, 7, 'MUTANT: the walk is one turn')
  })
  await withMutant(WALL_PATH, "  yield 'back0'\n", '', async M => {
    const [c, pause] = counting(); await M.wallEscapeAsync(FLAT, FHOME, [], { r: 40 }, { pause })
    assert.strictEqual(c.n, 12)
  })
})
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
await t('wiring: buildCitywall breathes after the town walk, the swap walk and the design, and proves with wallEscapeAsync; the swap pass breathes before its second walk', () => {
  const S = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const B = strip(readFileSync(new URL('../src/buildrun.mjs', import.meta.url), 'utf8'))
  const n = (src, s) => src.split(s).length - 1
  const wired = (s, b) => n(s, 'if (await breath()) return goneOut()') === 3 && n(s, 'const esc = await wallEscapeAsync(read0, home, [...rec.cells, ...design.cells]') === 1 &&
    n(s, 'if (!esc) return goneOut()') === 1 && n(b, 'if (swapNodes && winded()) { const b = await breathe(); if (b) { out.stop = b; return out } }') === 1
  assert.ok(wired(S, B))
  assert.ok(!wired(S.replace('if (await breath()) return goneOut()', ''), B), 'MUTANT: a breath cut still reads wired')
  assert.ok(!wired(S, B.replace('if (swapNodes && winded())', 'if (false)')), 'MUTANT: the swap breath cut still reads wired')
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
