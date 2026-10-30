// ZIGGURAT V2, BUILT (bots/src/zigdesign.mjs on buildrun.mjs runVisit, the fake server): small v2 shapes -- H 3 with four stairs and a
// campfire on its brazier; a parapet, a dais with posts and lanterns -- built to completion by two builders. Split from
// ziggurat-v2.test.mjs (the runner's 300 s per file).
import assert from 'node:assert'
const { R, G, HOME, k3, server } = await import('./helpers/buildfake.mjs')
const { Z, colOf, zigProject, zbot } = await import('./helpers/zigfake.mjs')
const D = await import('../src/zigdesign.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
console.log('THE BUILD (runVisit on the fake server, small v2 shapes)')
const kitAll = d => { const inv = { cobblestone: 5000, dirt: 64 }; for (const list of Object.values(d.palette)) for (const n of list) if (n !== '*solid') inv[n] = inv[n] ?? 999; return inv }
async function buildIt (g, seed, stock, names = ['A', 'B']) {
  const d = D.zigDesignFor(g, seed, { stock })
  const srv = server()
  const s = Z.siteZiggurat(colOf(srv.read), () => null, { box: [-40, -40, -9, -9], home: HOME, g })
  assert.ok(s.ok, JSON.stringify(s.rejects))
  const rec0 = Z.zigRecord(s.site, srv.read, { home: HOME, g, design: d })
  const { p } = zigProject(rec0, names)
  const rec = Z.zigSplitFoundation(rec0)
  const pal = Z.zigPaletteOf(rec0)
  const feet = Object.fromEntries(names.map((n, i) => [n, [-5 - i, G + 1, -5]]))
  const bots = Object.fromEntries(names.map(n => { const e = zbot(srv, n, { inv: kitAll(d), feet: feet[n], others: () => names.filter(m => m !== n).map(m => feet[m]) }); const w = e.walkTo; e.walkTo = async st => { feet[n] = st.slice(); return w(st) }; return [n, e] }))
  const done = () => rec.cells.every(c => R.cellDone(srv.read(...c.at), pal, c.role) || Z.zigHidden(c, srv.read))
  for (let v = 0; v < 20 && !done(); v++) await Promise.all(names.map(n => R.runVisit({ ...p(n), palette: pal }, bots[n], { maxSteps: 400 })))
  return { srv, rec, d, done: done(), bots }
}
await t('H 3, FOUR STAIRS, a brazier with its campfire: built to completion; every stair step and the fire placed as designed', async () => {
  const g = { B: 12, S: 3, H: 3, STAIR_W: 1, FACES: 4, TIERS: 2, PARAPET: null }
  assert.strictEqual(D.zigShapeWhy({ ...g, B: 24 }), null)
  const r = await buildIt(g, 11, { torch: 60, campfire: 1, stone_bricks: 300 })
  assert.ok(r.done, 'complete')
  assert.ok([...r.srv.placedAt.values()].every(n => n === 1), 'never twice')
  const fire = r.rec.cells.find(c => c.role === 'fire')
  assert.ok(fire && r.srv.read(...fire.at).name === 'campfire')
  for (const c of r.rec.cells.filter(c => c.role === 'stair')) assert.strictEqual(r.srv.read(...c.at).name, r.rec.palette.stair[0])
  assert.strictEqual(r.rec.cells.filter(c => c.role === 'stair').length, 4 * 2 * 3, 'four faces x two tiers x (2 + 1) step blocks')
})
await t('A PARAPET, A DAIS WITH POSTS, LANTERNS ON THE CORNERS: built to completion, the parapet open at the stair', async () => {
  const g = { B: 18, S: 3, H: 2, STAIR_W: 1, FACES: 1, TIERS: 2, PARAPET: 0 }
  const r = await buildIt(g, 5, { lantern: 60, stone_bricks: 2000, polished_deepslate: 300 })
  assert.ok(r.done, 'complete')
  assert.ok(r.rec.cells.some(c => c.role === 'parapet') && r.rec.cells.filter(c => c.role === 'shrine').length >= 16 + 8 + 2)
  const lights = r.rec.cells.filter(c => c.role === 'light')
  assert.ok(lights.length >= 12 && lights.every(c => r.srv.read(...c.at).name === 'lantern'), 'lanterns')
  const st = r.rec.cells.filter(c => c.role === 'stair' && c.at[1] === r.rec.baseY)
  for (const c of st) {
    const inward = { s: [0, -1], n: [0, 1], e: [-1, 0], w: [1, 0] }[r.rec.face]
    const edge = [c.at[0] + inward[0], r.rec.baseY + 2, c.at[2] + inward[1]]
    assert.ok(!r.rec.cells.some(x => k3(x.at) === k3(edge)), `the parapet is open where the stair arrives (${edge})`)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
