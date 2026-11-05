// THE SHOWCASE BATCH FOLD (stoneworks-03show onto the atlas/decorator/townstyle fold; Codex fold r9 BLOCKER): the stonecutter is placed by
// the generic place skill, which guards record cells, the plan's cells, wells and protected zones -- not the town's reservations, so a
// permanent cutter could stand on a reserved plot, the demolition's hold, a doorway or an expedition marker. place() takes a caller's
// `refuse(x, z)` (applied to every candidate and to the make-room dig) and both stonecutter placements pass cutterRefusal(). The
// decision is a closure over live records: wiring checks of each anchor, plus the parts it is built from (accessNoStair / holdAt,
// tested in gkaccessfold / decorholdfold), with an anchored mutant.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const once = (s, what) => assert.strictEqual(SK.split(s).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${what}`)
t('place() applies a caller\'s refusal to the candidates and the make-room dig', () => {
  once("{ wellOwn = null, by = null, planTemp = false, refuse = null, refuseNow = null } = {}) {", 'the option')
  once("if (typeof refuse === 'function') candidates = Object.assign(candidates.filter(", 'the candidates')
  once("if (typeof refuse === 'function') { let w = null; try { w = refuse(cellPos.x, cellPos.z) } catch { w = 'refuse_error' } if (w) continue }", 'the dig')
})
t('both stonecutter placements pass cutterRefusal()', () => {
  assert.strictEqual(SK.split("place(ctx, { item: 'stonecutter' }, signal, { refuse: cutterRefusal(), refuseNow: cutterRefusal })").length, 3)
  assert.ok(!SK.includes("place(ctx, { item: 'stonecutter' }, signal)"), 'no unguarded stonecutter placement')
})
t('cutterRefusal reads the hold, the plots, the ways in and the record/marker zones; an error refuses everything', () => {
  const i = SK.indexOf('function cutterRefusal ()'), body = SK.slice(i, SK.indexOf('\n}\n', i))
  for (const s of ['holdAt(', 'WALLEXT_PLOT', 'accessNoStair(recs, {})', 'recordZones(recs)', 'townMarkerZones()', "catch { return () => 'unreadable' }"]) assert.ok(body.includes(s), s)
})
t('MUTANT KILLED: an unguarded stonecutter placement fails the check', () => {
  const m = SK.replace("place(ctx, { item: 'stonecutter' }, signal, { refuse: cutterRefusal(), refuseNow: cutterRefusal })", "place(ctx, { item: 'stonecutter' }, signal)")
  assert.ok(m.includes("place(ctx, { item: 'stonecutter' }, signal)"))
})
t('r10: the refusal is read fresh on the exact target cell right before the click', () => {
  once("try { w = refuseNow()(tgt.x, tgt.z) } catch { w = 'refuse_error' }", 'the final check')
  const i = SK.indexOf("try { w = refuseNow()(tgt.x, tgt.z) }"), j = SK.indexOf('await withTimeout(bot.placeBlock(ref, face)', i)
  assert.ok(i > 0 && j > i && j - i < 3000, 'just before the placeBlock')
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
