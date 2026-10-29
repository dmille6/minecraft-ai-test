// MONUMENT-01: three builders interleaved, and a ziggurat on uneven ground (foundation, cut, natural ground in the core, a skin
// cell dug and replaced), built by buildrun.mjs runVisit on the fake server (test/helpers/buildfake.mjs, zigfake.mjs).
import assert from 'node:assert'
const { B, R, PJ, G, HOME, k3, server, plan } = await import('./helpers/buildfake.mjs')
const { Z, G12, withZigMutant, colOf, siteOn, zigProject, zigDone, KITZ, zbot } = await import('./helpers/zigfake.mjs')
const SHOPM = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
console.log('THE BUILD, CONCURRENT AND UNEVEN (runVisit on the fake server)')
await t('THREE BUILDERS interleaved: complete, every cell placed exactly once, each placed some (three slots)', async () => {
  const srv = server()
  const rec = Z.zigRecord(siteOn(srv).site, srv.read, { home: HOME, g: G12 })
  const { p } = zigProject(rec, ['A', 'B', 'C'])
  const feet = { A: [-5, G + 1, -5], B: [-6, G + 1, -24], C: [-24, G + 1, -6] }
  const bots = Object.fromEntries(['A', 'B', 'C'].map(n => [n, zbot(srv, n, { inv: KITZ(), feet: feet[n], others: () => Object.entries(feet).filter(([m]) => m !== n).map(([, f]) => f) })]))
  for (const [n, b] of Object.entries(bots)) { const w = b.walkTo; b.walkTo = async s => { feet[n] = s.slice(); return w(s) } }
  for (let round = 0; round < 12 && !zigDone(srv, rec); round++) await Promise.all(['A', 'B', 'C'].map(n => R.runVisit(p(n), bots[n], { maxSteps: 400 })))
  assert.ok(zigDone(srv, rec), 'complete')
  assert.ok([...srv.placedAt.values()].every(n => n === 1), 'never twice')
  const by = n => bots[n].logs.filter(([k, d]) => k === '_build' && d.op === 'place').length
  assert.strictEqual(by('A') + by('B') + by('C'), rec.cells.length)
  assert.ok(['A', 'B', 'C'].every(n => by(n) > 0), `each builder placed: ${['A', 'B', 'C'].map(by)}`)
})
await t('UNEVEN GROUND BUILT: the foundation first, the cut dug, natural dirt in the core kept, dirt in a skin cell dug and replaced', async () => {
  const s0 = siteOn(server(), { box: [-30, -30, -7, -7] }).site
  const cx = s0.corner.x, cz = s0.corner.z
  const cells = {}
  for (let dx = 4; dx < 7; dx++) for (let dz = 4; dz < 7; dz++) { cells[k3([cx + dx, G, cz + dz])] = 'air'; cells[k3([cx + dx, G - 1, cz + dz])] = 'air' }
  cells[k3([cx, G + 1, cz])] = 'dirt'; cells[k3([cx, G + 2, cz])] = 'dirt'; cells[k3([cx, G + 3, cz])] = 'dirt'
  cells[k3([cx + 5, G + 1, cz + 3])] = 'dirt'        // a natural block in a CORE cell of layer 0
  const srv = server(cells)
  const rec = Z.zigRecord(siteOn(srv, { box: [cx - 2, cz - 2, cx + 13, cz + 13] }).site, srv.read, { home: HOME, g: G12 })
  const { p } = zigProject(rec)
  const e = zbot(srv, 'A', { inv: KITZ(), feet: [-5, G + 1, -5] })
  for (let v = 0; v < 14 && !zigDone(srv, rec); v++) await R.runVisit(p('A'), e, { maxSteps: 400 })
  assert.ok(zigDone(srv, rec), 'complete')
  assert.strictEqual(srv.read(cx, G + 3, cz).name, 'air', 'the cut is dug')
  assert.strictEqual(srv.read(cx, G + 1, cz).name, 'cobblestone', 'the dirt in the corner SKIN cell was dug and replaced')
  assert.strictEqual(srv.read(cx + 5, G + 1, cz + 3).name, 'dirt', 'the dirt in the core stayed (done)')
  const order = e.logs.filter(([k, d]) => k === '_build' && d.op === 'place').map(([, d]) => d.seg)
  assert.ok(order.lastIndexOf('F') < order.indexOf('L00-N'), 'the foundation before layer 0')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
