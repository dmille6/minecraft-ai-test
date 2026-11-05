// TOWNSTYLE-01, THE BUILDS (split from townstyle.test.mjs): the positive control (today's actuator never finishes the roof), a misoriented
// stair reoriented, a wrong landing booked as placed, and the anchored mutants of buildrun.mjs and buildsite.mjs.
import assert from 'node:assert'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'

const T = await import('../src/townstyle.mjs')
const C = await import('../src/cottage.mjs')
const BB = await import('../src/buildbot.mjs')
const F = await import('./helpers/buildfake.mjs')
const { B, R, PJ, G, HOME, k3, withMutant } = F
const { STYLE, sited, vanillaBot, COTTAGE_KIT, buildCottage, buildWithOneBadClick, withSrcMutant, siteWith, vanilla } = await import('./helpers/townstylefake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}

await t('POSITIVE CONTROL: the same build with the CURRENT actuator (no aim: the look toward the face) never completes the roof', async () => {
  const { r, done, total } = await buildCottage('s', { aimless: true })
  assert.notStrictEqual(r.stop, 'complete', 'the instrument can see a wrong state')
  assert.ok(done < total)
})
await t('a MISORIENTED stair in a roof cell is dug (`reorient`) and placed again, aimed', async () => {
  const { r, e, srv } = await buildCottage('s', {
    pre: (sv, rec) => {
      const c = rec.cells.find(q => q.role === 'roof' && q.seg === 'roof-edge')
      sv.set(c.at, 'dark_oak_stairs')
      ;(sv.props ??= new Map()).set(k3(c.at), { facing: { north: 'south', south: 'north', east: 'west', west: 'east' }[c.ws.facing], half: 'bottom' })
    },
  })
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why ?? ''}`)
  const re = e.logs.filter(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'reorient')
  assert.strictEqual(re.length, 1, 'one reorient dig')
  assert.ok(srv.placedAt.get(k3(re[0][1].cell)) >= 1, 'placed again')
})
await t('a click that LANDS IN THE WRONG STATE is booked as placed (the bag balance holds), then dug and placed again', async () => {
  const kit = COTTAGE_KIT()
  const { r, e, bad } = await buildWithOneBadClick()
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why ?? ''}`)
  const rows = e.logs.filter(([k, d]) => k === '_build' && d.op === 'place' && k3(d.cell) === k3(bad.at))
  assert.deepStrictEqual(rows.map(([, d]) => d.result ?? 'ok'), ['misplaced', 'ok'], 'one misplaced row, then the good one')
  assert.ok(e.logs.some(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'reorient' && k3(d.cell) === k3(bad.at)), 'the reorient dig between')
  // the bag's balance: every block that left the bag is booked as placed (shopread G8: no negative unexplained)
  for (const n of Object.keys(kit)) assert.strictEqual(kit[n] - e.inv[n], r.placedBy[n] ?? 0, `${n}: left the bag ${kit[n] - e.inv[n]}, booked ${r.placedBy[n] ?? 0}`)
})
await t('MUTANT the misplaced booking dropped: the wrong-state block leaves the bag unbooked (a G8 bag_loss)', () => withMutant(
  "        if (ws && state === block) return 'misplaced'\n", "", async M => {
    const kit = COTTAGE_KIT()
    const { r, e } = await buildWithOneBadClick(M)
    const n = 'dark_oak_stairs'
    assert.notStrictEqual(kit[n] - e.inv[n], r.placedBy[n] ?? 0, 'the mutant leaves one stair unbooked')
  }))
await t('MUTANT the aim dropped from the send: the roof never completes', () => withMutant(
  "        e.send(here.support, here.face, seq, here.aim ?? null)",
  "        e.send(here.support, here.face, seq)", async M => {
    const { r } = await buildCottage('s', { Mod: M })
    assert.notStrictEqual(r.stop, 'complete')
  }))
await t('MUTANT the state dropped from cellDone: a misoriented stair reads done (the roof completes wrong)', () => withMutant(
  "  if (ws) return stateOk(propsOf(b), ws)\n",
  "", async M => {
    const pal = { roof: ['spruce_stairs'] }
    assert.strictEqual(M.cellDone({ name: 'spruce_stairs', props: { facing: 'south', half: 'bottom' } }, pal, 'roof', { facing: 'north', half: 'bottom' }), true, 'the mutant cannot see it')
    const { r, e } = await buildCottage('s', { Mod: M, aimless: true })
    assert.strictEqual(r.stop, 'complete', 'the mutant calls a wrong roof complete')
    assert.ok(!e.logs.some(([k, d]) => d?.kind === 'reorient'))
  }))
await t('MUTANT the reorient dig dropped: a misoriented stair blocks its cell for good', () => withMutant(
  "  const misorientedAt = c => { if (!c.ws) return false;",
  "  const misorientedAt = c => { if (c.ws) return false;", async M => {
    const { r } = await buildCottage('s', {
      Mod: M,
      pre: (sv, rec) => { const c = rec.cells.find(q => q.role === 'roof' && q.seg === 'roof-edge'); sv.set(c.at, 'dark_oak_stairs'); (sv.props ??= new Map()).set(k3(c.at), { facing: 'up', half: 'top' }) },
    })
    assert.notStrictEqual(r.stop, 'complete')
  }))

await t('MUTANT the reach-only rule dropped (buildsite stepFor): the cottage has no proven site -- its upper courses are above every eye', () => withSrcMutant('buildsite.mjs',
  "    const blind = !!want?.blind", "    const blind = false", async Bm => {
    assert.ok(siteWith(B).ok, 'control: the real module sites it')
    const s = siteWith(Bm)
    assert.strictEqual(s.ok, false)
    assert.ok(JSON.stringify(s.sectors).includes('no_step'), JSON.stringify(s.sectors).slice(0, 200))
  }))
await t('MUTANT the state filter dropped (buildsite stepFor): the proof picks a face that cannot make a sill\'s state', () => withSrcMutant('buildsite.mjs',
  "    if (want?.ws && !aim) continue\n", "", async Bm => {
    const s = siteWith(Bm, 's')
    assert.ok(s.ok)
    const pal = C.styledBlueprint(B.loadBlueprint('cottage@1s'), STYLE).palette
    const wrong = s.record.cells.filter(c => c.ws && !T.orientAim(R.roleFirst(pal, c.role), c.ws, c.face))
    assert.ok(wrong.length > 0, 'a state cell whose recorded face cannot make its state')
  }))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
