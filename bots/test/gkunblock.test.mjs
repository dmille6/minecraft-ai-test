// GKUNBLOCK-01 (LIVE showcase 8b4ea9cc, 11-04 23:10Z..): the groundskeeper's record (tidy g25, stage inwall + the site prep SP2) stood
// still -- every keeper visit `blocked: SP2-0L04: 3 open, 2 placeable now`, every helper visit `helper_idle` (78 in the first hour).
// SP2-0L04's open cells: two air cells no stand reached and one SNOW LAYER (-80,65,-32): neither clear (the plan readers carry no
// `layers`) nor in FOREIGN_CLEAR, so runVisit returned `blocked` before any other segment, every visit. Behaviour on buildfake.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { G, HOME, server, bot, PJ, R } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const BUILDRUN_PATH = new URL('../src/buildrun.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const col = (srv, x, z, y0, y1, name) => { for (let y = y0; y <= y1; y++) srv.set([x, y, z], name) }
// two 3-deep pits, one group each: the near one's cell at `y` (its top, G: a stand on the rim sees it) holds `bottom`
const twoPits = (bottom, y = G) => {
  const srv = server()
  col(srv, 9, 1, G - 2, G, 'air')
  col(srv, -12, 0, G - 2, G, 'air')
  const s = T.surveyTidy(srv.read, { home: HOME })
  const rec = T.tidyRecord(s, { home: HOME, T: { ...T.TIDY, segCells: 3 } })
  srv.set([9, y, 1], bottom)
  return { srv, rec }
}
const visit = async (RM, srv, rec, extra) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gku-'))
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const slot = PJ.takeSlot(dir, key, 'A', 1)
  const e = bot(srv, 'A', { inv: { dirt: 64, cobblestone: 64 }, feet: [0, G + 1, 0] })
  return RM.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, tidy: [], recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: T.tidyWalkR(rec), clearMax: T.TIDY_CLEAR_MAX, stuckStalledOnly: true, ...extra }, e, { maxSteps: 400 })
}
await t('a SNOW layer in an open fill cell is dug like the other terrain, and the pit is filled (the live SP2-0L04 cell)', async () => {
  assert.ok(R.FOREIGN_CLEAR.test('snow'))
  const a = twoPits('snow')
  const r = await visit(R, a.srv, a.rec, { deferSpent: true })
  assert.notStrictEqual(r.stop, 'blocked', r.why)
  for (let y = G - 2; y <= G; y++) assert.ok(['dirt', 'cobblestone'].includes(a.srv.read(9, y, 1).name), `the pit is filled at ${y}: ${a.srv.read(9, y, 1).name}`)
  await withMutant(BUILDRUN_PATH, '|deepslate|gravel|snow)$/', '|deepslate|gravel)$/', async RM => {
    const b = twoPits('snow')
    const m = await visit(RM, b.srv, b.rec, {})
    assert.strictEqual(m.stop, 'blocked', 'mutant (snow not terrain): the live stop')
    assert.match(m.why, /open, 0 placeable now/)
  })
})
await t('a block the visit may NOT dig (a cobweb) holding a tidy segment is deferred (named) and the visit goes on to the far pit; control: without deferSpent it ends `blocked`', async () => {
  const a = twoPits('cobweb')
  const r0 = await visit(R, a.srv, a.rec, {})
  assert.strictEqual(r0.stop, 'blocked', 'control: the old stop')
  assert.strictEqual(a.srv.read(-12, G, 0).name, 'air', 'control: the far pit\'s top layer (after the blocked one) untouched')
  const b = twoPits('cobweb')
  const r1 = await visit(R, b.srv, b.rec, { deferSpent: true })
  assert.notStrictEqual(r1.stop, 'blocked')
  assert.notStrictEqual(b.srv.read(-12, G, 0).name, 'air', 'the far pit\'s top layer is laid in the same visit')
  assert.ok((r1.deferred ?? []).some(d => d.k === `9,${G},1` && d.why === 'blocked cobweb'), JSON.stringify(r1.deferred))
  assert.strictEqual(b.srv.read(9, G, 1).name, 'cobweb', 'never dug')
  await withMutant(BUILDRUN_PATH, '          if (p.deferSpent && open.length && !needSapling) {', '          if (false) {', async RM => {
    const c = twoPits('cobweb')
    assert.strictEqual((await visit(RM, c.srv, c.rec, { deferSpent: true })).stop, 'blocked', 'mutant: blocked again')
  })
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
