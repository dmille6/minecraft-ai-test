// TOWNSTYLE-02, THE SLAB ROOF (split from townstyle-build.test.mjs so each file stays well inside 300 s on a loaded suite host): the
// copper hall@2 built whole on a fake vanilla that MERGES a slab into a half-full same slab, and the merge guard's mutant.
import assert from 'node:assert'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'

const T = await import('../src/townstyle.mjs')
const C = await import('../src/cottage.mjs')
const BB = await import('../src/buildbot.mjs')
const F = await import('./helpers/buildfake.mjs')
const { B, R, PJ, G, HOME, k3, withMutant } = F
const { STYLE, sited, vanillaBot, COTTAGE_KIT, buildCottage, buildWithOneBadClick, withSrcMutant, siteWith, vanilla, kitFor } = await import('./helpers/townstylefake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}

console.log('TOWNSTYLE-02: A SLAB NEVER MERGES INTO ITS SUPPORT (Paper 11-05, hall@2)')
await t('the copper hall@2 (a 1:2 slab roof) is built whole on the fake vanilla that merges a slab into a half-full same slab', async () => {
  const { r, done, total, e } = await buildCottage('hall@2')
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why ?? ''} ${done}/${total}`)
  assert.ok(!e.logs.some(([k, d]) => d?.kind === 'reorient'), 'no merge to undo')
})
await t('MUTANT the merge guard dropped (buildsite stepFor): the hall\'s proof plans clicks that would merge into their supports', () => withSrcMutant('buildsite.mjs',
  "    if (aim && slabMerges(want.name, read(...sup), normal, aim.cursor[1])) continue\n", "", async Bm => {
    // the visit's own step search is buildsite's stepFor (imported by buildrun): run buildrun from a mutant tree whose buildsite is the mutant
    const B2 = Bm
    const { s } = sited('hall@2')
    assert.ok(s.ok)
    // the PROOF already shows it: a slab cell whose recorded support is a half-full same slab clicked on its open half
    const s2 = B2.siteBlueprint(F.server().read, F.plan(), C.styledBlueprint(B.loadBlueprint('hall@2'), STYLE), { tries: 3, plot: 'h' })
    const T2 = T
    const merging = (s2.record?.cells ?? []).filter(c => c.ws && /slab/.test(c.role) && s2.record.cells.some(q => q.at.join() === c.support.join() && q.ws?.type && q.role === c.role && T2.slabMerges(R.roleFirst(C.styledBlueprint(B.loadBlueprint('hall@2'), STYLE).palette, c.role), { name: R.roleFirst(C.styledBlueprint(B.loadBlueprint('hall@2'), STYLE).palette, q.role), props: q.ws }, c.face, T2.orientAim('x_slab', c.ws, c.face).cursor[1])))
    assert.ok(merging.length > 0, 'the mutant proof plans clicks that merge into their support')
  }))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
