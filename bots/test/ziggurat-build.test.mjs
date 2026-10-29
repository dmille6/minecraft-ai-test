// MONUMENT-01: the ziggurat BUILT END TO END by buildrun.mjs runVisit on the fake server (test/helpers/buildfake.mjs, zigfake.mjs):
// one builder visit after visit, and the layer barrier with another builder holding a quadrant (killed with the barrier removed).
import assert from 'node:assert'
const { B, R, PJ, G, HOME, k3, server, plan } = await import('./helpers/buildfake.mjs')
const { Z, G12, withZigMutant, colOf, siteOn, zigProject, zigDone, KITZ, zbot } = await import('./helpers/zigfake.mjs')
const SHOPM = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
console.log('THE BUILD (runVisit on the fake server)')
await t('ONE BUILDER: the B=12 ziggurat from its record on flat ground, visit after visit: complete, every cell placed once', async () => {
  const srv = server()
  const rec = Z.zigRecord(siteOn(srv).site, srv.read, { home: HOME, g: G12 })
  const { p } = zigProject(rec)
  const e = zbot(srv, 'A', { inv: KITZ(), feet: [-5, G + 1, -5] })
  let last = null
  for (let v = 0; v < 12 && !zigDone(srv, rec); v++) last = await R.runVisit(p('A'), e, { maxSteps: 400 })
  assert.ok(zigDone(srv, rec), `complete (${last?.stop}: ${last?.why})`)
  assert.strictEqual(last.stop, 'complete')
  assert.ok([...srv.placedAt.values()].every(n => n === 1), 'never twice')
  assert.strictEqual(srv.placedAt.size, rec.cells.length)
})
await t('THE LAYER BARRIER: no cell of layer L is placed while a cell of layer L-1 is open (killed with the barrier removed)', async () => {
  const scenario = async ZM => {
    const srv = server()
    const rec = ZM.zigRecord(ZM.siteZiggurat(colOf(srv.read), () => null, { box: ZM.monumentBox(plan()), home: HOME, g: G12 }).site, srv.read, { home: HOME, g: G12 })
    const { p, dir, key } = zigProject(rec)
    // ANOTHER BUILDER holds layer 0's west quadrant (its lease, live): A builds N, E and S -- and must then stop, not climb on
    const held = PJ.takeLease(dir, key, 'seg-L00-W', 'X')
    assert.ok(held.ok)
    const e = zbot(srv, 'A', { inv: KITZ(), feet: [-5, G + 1, -5] })
    const r = await R.runVisit(p('A'), e, { maxSteps: 400 })
    const placed = e.logs.filter(([k, d]) => k === '_build' && d.op === 'place').map(([, d]) => d)
    assert.ok(placed.length > 0, 'it built the free quadrants')
    assert.ok(placed.every(d => d.cell[1] === rec.baseY), `nothing above layer 0 while L00-W is open (${placed.filter(d => d.cell[1] !== rec.baseY).length} placed)`)
    assert.strictEqual(r.stop, 'deps_open')
  }
  await scenario(Z)
  let killed = false
  // the mutant: every layer's quadrants wait on nothing -- a builder finishing quadrant N of layer 0 climbs on to layer 1's N
  await withZigMutant("for (const q of Q) out.push({ seg: segName(l, q), deps })", "for (const q of Q) out.push({ seg: segName(l, q), deps: l === 0 ? deps : [segName(l - 1, q)] })",
    async M => { try { await scenario(M) } catch { killed = true } })
  assert.ok(killed, 'the mutant survived')
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
