// SHOPCHEST-01: THE WORKSHOP'S MATERIALS CHESTS (bots/src/shopchest.mjs), pure and on the fake server: the switch; the site inside a
// COMPLETE workshop@1 only (the front row's corner cells, never the doorway's inner cell or a station, never side by side); litter
// in the cells and stands cleared, a workshop cell or a furnace refusing; the record BUILT END TO END by buildrun.mjs runVisit
// (both chests placed, the cell above each and every stand open); the use rule (a complete record only, never the chests' own
// visit; the index's word on whether a chest is worth a walk); the project's place in shop.mjs's order; the wiring in skills.mjs
// (the draw first, the bank-back first, the chest craft). Mutants assert their anchors present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, B, PJ, G, HOME, server, bot } = await import('./helpers/buildfake.mjs')
const C = await import('../src/shopchest.mjs')
const SHOP = await import('../src/shop.mjs')

const SC_PATH = new URL('../src/shopchest.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (old, neu, fn, file = SC_PATH) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async (old, neu, scenario) => {
  await scenario(C)
  let k = false
  await withMutant(old, neu, async M => { try { await scenario(M) } catch { k = true } })
  assert.ok(k, 'the mutant survived')
}
const k3 = a => a.join(',')
/** A complete workshop@1 record at anchor (24, 24), orientation E, floor G (its back-row stations as record cells). */
const SHOPREC = () => ({ blueprint: 'workshop@1', structure_complete: true, anchor: [24, 24], orient: 'E', s: G,
  cells: [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4]].map(([u, v], i) => ({ at: [24 + u, G + 1, 24 + v], role: ['light', 'furnace', 'table', 'furnace', 'light'][i], seg: 'fit-out' })) })
const W = (u, v, y) => [24 + u, G + y, 24 + v]

await t('the switch: SHOPCHEST on/off, else only the pools SHOPCHEST_POOLS names (default showcase)', async () => {
  assert.strictEqual(C.shopchestOn({}, 'showcase'), true)
  assert.strictEqual(C.shopchestOn({}, 'board-a'), false)
  assert.strictEqual(C.shopchestOn({ SHOPCHEST: 'off' }, 'showcase'), false)
  assert.strictEqual(C.shopchestOn({ SHOPCHEST: 'on' }, 'board-a'), true)
})
await t('the cells: the front row\'s corners, never side by side, never the doorway\'s inner cell or the station row', async () => {
  const cs = C.shopchestBlueprint().cells
  assert.deepStrictEqual(cs.map(c => [c.u, c.v, c.y]), [[2, 2, 1], [6, 2, 1]])
  assert.ok(!cs.some(c => c.u === 4 && c.v === 2), 'the doorway\'s inner cell stays free')
  assert.ok(!cs.some(c => c.v === 4), 'no station cell')
  assert.ok(Math.abs(cs[0].u - cs[1].u) > 1, 'never side by side (they would join)')
})
await t('the site: only inside a COMPLETE workshop@1; litter cleared; a workshop cell or a furnace in the way refuses', async () => {
  const srv = server({ [k3(W(4, 3, 1))]: 'crafting_table', [k3(W(2, 2, 1))]: 'dirt' })
  const st = C.shopchestSite(srv.read, SHOPREC())
  assert.ok(st.ok, st.why)
  assert.deepStrictEqual(st.site.clear.map(c => k3(c.at)).sort(), [k3(W(2, 2, 1)), k3(W(4, 3, 1))].sort())
  assert.strictEqual(C.shopchestSite(srv.read, { ...SHOPREC(), structure_complete: false }).why, 'workshop_open')
  assert.strictEqual(C.shopchestSite(srv.read, { ...SHOPREC(), blueprint: 'house@1' }).why, 'no_workshop')
  assert.strictEqual(C.shopchestSite(server({ [k3(W(6, 2, 1))]: 'furnace' }).read, SHOPREC()).why, 'cell_not_free')
  assert.strictEqual(C.shopchestSite(server({ [k3(W(6, 2, 2))]: 'stone_bricks' }).read, SHOPREC()).why, 'cell_not_free', 'a solid above the chest (its lid)')
  const own = SHOPREC(); own.cells.push({ at: W(4, 2, 1), role: 'wall', seg: 'wall-F' })
  assert.strictEqual(C.shopchestSite(server({ [k3(W(4, 2, 1))]: 'oak_planks' }).read, own).why, 'workshop_cell')
})
await t('BUILT END TO END: both chests placed from their stands; the cell above each and every stand open', async () => {
  const srv = server({ [k3(W(4, 3, 1))]: 'crafting_table' })
  const shop = SHOPREC()
  for (const c of shop.cells) srv.set(c.at, c.role === 'light' ? 'torch' : c.role === 'table' ? 'crafting_table' : 'furnace')
  const st = C.shopchestSite(srv.read, shop)
  const p = B.proveSite(srv.read, HOME, st.bp, st.site, { stood: [] })
  assert.ok(p.ok, `${p.why} ${p.detail ?? ''}`)
  const rec = C.shopchestRecord(st, p, { home: HOME })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shopchest-'))
  const key = PJ.projKey(HOME, C.SHOPCHEST_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const b = bot(srv, 'A', { inv: { chest: 2 }, feet: [0, G + 1, 0] })
  for (let i = 0; i < 4 && !rec.cells.every(c => R.cellDone(srv.read(...c.at), C.SHOPCHEST_PALETTE, c.role)); i++) {
    const slot = PJ.takeSlot(dir, key, 'A', 1)
    await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: C.SHOPCHEST_PALETTE, slot: slot.slot, slotGen: slot.gen, stands: { pending: null, bans: {} } }, b, { maxSteps: 100 })
    PJ.releaseLease(dir, key, `slot${slot.slot}`, 'A', slot.gen)
  }
  for (const [u, v] of C.SHOPCHEST_CELLS) { assert.strictEqual(srv.read(...W(u, v, 1)).name, 'chest'); assert.strictEqual(srv.read(...W(u, v, 2)).name, 'air') }
  for (const [u, v] of C.SHOPCHEST_STANDS) assert.strictEqual(srv.read(...W(u, v, 1)).name, 'air', `stand ${u},${v}`)
  assert.deepStrictEqual(C.materialsChests({ ...rec, structure_complete: true }).map(k3), [k3(W(2, 2, 1)), k3(W(6, 2, 1))])
})
await t('THE USE: a complete record only, never the chests\' own visit, never with the switch off; the index says when a walk is worth it', async () => {
  const rec = { blueprint: C.SHOPCHEST_BLUEPRINT, structure_complete: true, cells: [{ at: [1, 2, 3], role: 'chest' }] }
  assert.deepStrictEqual(C.materialsChests(rec, { plot: 'storehouse' }), [[1, 2, 3]])
  assert.deepStrictEqual(C.materialsChests({ ...rec, structure_complete: false }, { plot: 'storehouse' }), [])
  assert.deepStrictEqual(C.materialsChests(rec, { plot: C.SHOPCHEST_PLOT }), [])
  assert.deepStrictEqual(C.materialsChests(rec, { on: false, plot: 'storehouse' }), [])
  assert.strictEqual(C.materialsWorthTry(null, { stone_bricks: 4 }), true, 'unknown: try it')
  assert.strictEqual(C.materialsWorthTry({ torch: [3, 1] }, { stone_bricks: 4 }), false)
  assert.strictEqual(C.materialsWorthTry({ stone_bricks: [9, 1] }, { stone_bricks: 4 }), true)
  assert.strictEqual(C.materialsWorthTry({ spruce_planks: [9, 1] }, { oak_planks: 4 }), true, 'any planks for planks')
})
await t('MUTANT KILLED: the chests\' own visit drawing from (and banking into) the chests it is placing', async () => {
  await killed("  if (!on || plot === SHOPCHEST_PLOT || rec?.blueprint !== SHOPCHEST_BLUEPRINT || !rec.structure_complete) return []", "  if (!on || rec?.blueprint !== SHOPCHEST_BLUEPRINT || !rec.structure_complete) return []", async M => {
    assert.deepStrictEqual(M.materialsChests({ blueprint: C.SHOPCHEST_BLUEPRINT, structure_complete: true, cells: [{ at: [1, 2, 3], role: 'chest' }] }, { plot: C.SHOPCHEST_PLOT }), [])
  })
})
await t('the project: after the workshop, before the storehouse, one builder; the bill crafts a chest the town lacks (8 planks)', async () => {
  const i = SHOP.PROJECTS.findIndex(q => q.plot === C.SHOPCHEST_PLOT), j = SHOP.PROJECTS.findIndex(q => q.plot === 'storehouse')
  assert.ok(i > 0 && i < j && SHOP.PROJECTS[i].after === 'shop' && SHOP.buildersOf(SHOP.PROJECTS[i]) === 1)
  assert.ok(SHOP.projectsOn(true, true, true, true, false, true, true, true).some(q => q.plot === C.SHOPCHEST_PLOT))
  assert.ok(!SHOP.projectsOn(true, true, true, true, false, true, true, false).some(q => q.plot === C.SHOPCHEST_PLOT))
  const need = SHOP.visitNeeds({ cells: [] }, { chest: 2 }, { town: {}, spare: {}, planks: 'spruce_planks' })
  assert.strictEqual(need.spruce_planks, 16)
  assert.strictEqual(SHOP.visitNeeds({ cells: [] }, { chest: 2 }, { town: { chest: 2 }, spare: {} }).oak_planks, undefined, 'the town has them: drawn, not crafted')
})
await t('WIRED (skills.mjs, comments stripped): sited in the workshop; the draw and the bank-back go to the materials chests first; a chest is crafted', async () => {
  const src = readFileSync(SKILLS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(/if \(plot === SHOPCHEST_PLOT\) \{\s*const shopRec = /.test(src))
  assert.ok(src.includes("const nextOf = () => (firsts.length ? { block: firsts.shift(), first: true } : townSearchNext("), 'matsWithdraw tries `first` before the town')
  assert.ok(src.includes('const c = (curFirst ? firstAllow : allow)(n, want, '), 'no reserve on the materials chests')
  assert.ok(src.includes('PD.onUncertain, { first }); took = w.took ?? {}'), 'buildShop passes them')
  assert.ok(src.includes('prefer: mats.map(b => b.position) }'), 'the bank-back prefers them')
  assert.ok(src.includes("const pre = (prefer ?? []).filter(ok)") && src.includes('return [...pre, ...[...near, ...idx]'), 'matsBank puts them first')
  assert.ok(src.includes("for (const item of ['furnace', 'crafting_table', 'chest']) {"), 'the chest crafted when the town has none')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
