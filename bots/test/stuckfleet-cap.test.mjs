// STUCKFLEET-01, THE PART THAT IS NOT IN THE TRUNK. Four subtests MOVED, UNCHANGED, out of stuckfleet.test.mjs (trunkfix-c1, trunk
// merge 2026-11-16), with the setup they share with it and the cap's scene, which only they used:
//   - buildTidy's road-light waiver line (skills.mjs `const waive2 = stuckFleetOn() ? ...`): the trunk's buildTidy is the showcase's,
//     where only the keeper's visit waives (`caps.waive`), never a seal or a carried cell (tidy.mjs gkWaivable), and what a visit
//     leaves open is waived by gkleft (a6042d12a) -- the fleet's line is not a line that fits into it;
//   - the cap dig in the visit (`_build op=clear kind=cap`): its STUCKFLEET=off control, the dig, and the dependency rule's mutant.
//     The showcase digs a cover its own way (coverdig-01 005e29324: the rows say kind=cover, and the control's record completes).
// The pure rules these rode on (stuckfleet.mjs lightWaiveDue, capDigs) are still tested, live, in stuckfleet.test.mjs.
process.env.VISIT_WAIVER = 'on'
process.env.BUILDRETRY = 'on'
// KEPT, NOT RUN (control session 11-16; docs/reports/trunk-merge-2026-11-16/DECISIONS.md): the suite reports this file SKIPPED --
// never passed (scripts/test-result.mjs: `SKIP (<why>)` and exit 77). Take these two lines out to run it again.
console.log('SKIP (replaced on the showcase line by coverdig-01 (005e29324) and gkleft (a6042d12a); the fleet\'s cap and light waiver are not in the trunk (trunk merge 2026-11-16, DECISIONS.md))')
process.exit(77)
import assert from 'node:assert'
import fs from 'node:fs'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, PJ, G, HOME, server, bot, withMutant } = await import('./helpers/buildfake.mjs')
const SF = await import('../src/stuckfleet.mjs')
const RT = await import('../src/buildretry.mjs')
const W = await import('../src/wall.mjs')
const T = await import('../src/tidy.mjs')
const GW = await import('../src/gkwork.mjs')
const Z = await import('../src/ziggurat.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const k = a => a.join(',')
const killedBy = async (old, neu, scenario, mut = withMutant) => {
  await scenario(R, SF)
  let why = null
  await mut(old, neu, async M => { try { await scenario(M.R ?? M, M.SF ?? SF) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}

// ---- 1. the road light: the wiring (the rule itself is tested in stuckfleet.test.mjs) ------------------------------------------
console.log('1. THE ROAD LIGHT (buildTidy\'s line)')
await t('buildTidy composes the light waiver with its waivers, behind STUCKFLEET (source, comments stripped)', () => {
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  assert.strictEqual(src.split("const waive2 = stuckFleetOn() ? [...waive1, ...lightWaiveDue(rec, r.deferred ?? []).filter(l => !waive1.some(w => w.k === l.k))] : waive1").length, 2)
  assert.ok(/if \(waive\.length\) \{\s*const pub = publishRecord\(dir, key, cur => \{\s*if \(!cur \|\| cur\.structure_complete/.test(src), 'the composed list is what is published')
  assert.strictEqual(SF.stuckFleetOn({ STUCKFLEET: 'off' }), false)
  assert.strictEqual(SF.stuckFleetOn({}), true)
})

// ---- 3. the capped cell: the dig in the visit (placebo-c monument L02-E 327,72,106 under L03-E's stair cell holding dirt) -------
console.log('3. THE CAPPED CELL (the visit\'s dig)')
// the fake server: segment A a 3x3 at G+1, all cobblestone but the middle (air); segment B (waits on A) one cell over the middle
// holding DIRT -- the middle's four sides and its top are solid, its bottom the ground: no face any stand sees
const capScene = () => {
  const srv = server(), cells = []
  for (let x = 10; x <= 12; x++) for (let z = 9; z <= 11; z++) {
    cells.push({ at: [x, G + 1, z], role: 'skin', seg: 'A' })
    srv.set([x, G + 1, z], x === 11 && z === 10 ? 'air' : 'cobblestone')
  }
  cells.push({ at: [11, G + 2, 10], role: 'skin', seg: 'B' }); srv.set([11, G + 2, 10], 'dirt')
  const rec = { v: 1, plot: 'monument', blueprint: 'ziggurat@1', cells, clear: [], replant: [], segments: [{ seg: 'A', deps: [] }, { seg: 'B', deps: ['A'] }] }
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/stuckfleet-`)
  const key = PJ.projKey(HOME, 'monument')
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const slot = PJ.takeSlot(dir, key, 'A', 2)
  const p = { dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: Z.ZIG_PALETTE, slot: slot.slot, slotGen: slot.gen,
    domain: () => true, walkR: 40, foreign: Z.ZIG_FOREIGN, blockLayer: false, stands: { pending: null, bans: {} }, sealed: { mayDig: () => true } }
  return { srv, rec, p }
}
const built = (srv, rec) => rec.cells.every(c => R.cellDone(srv.read(...c.at), Z.ZIG_PALETTE, c.role))
await t('CONTROL (STUCKFLEET=off, the live code): the middle is deferred (no stand), the record never completes', async () => {
  const prev = process.env.STUCKFLEET; process.env.STUCKFLEET = 'off'
  try {
    const { srv, rec, p } = capScene(), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
    const r = await R.runVisit(p, e, { maxSteps: 400 })
    assert.ok(!built(srv, rec))
    assert.ok((r.deferred ?? []).some(d => d.k === k([11, G + 1, 10])), `${r.stop} ${JSON.stringify(r.deferred)}`)
  } finally { if (prev == null) delete process.env.STUCKFLEET; else process.env.STUCKFLEET = prev }
})
await t('the cap is dug (`kind=cap`), the middle placed, then B placed: the record completes -- killed with the cap branch cut', async () => {
  await killedBy('if (p.sealed && stuckFleetOn() && cand.length) {', 'if (false) {', async M => {
    const { srv, rec, p } = capScene(), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
    const r = await M.runVisit(p, e, { maxSteps: 400 })
    assert.ok(built(srv, rec), `${r.stop} ${r.why}`)
    assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'clear' && d.kind === 'cap' && k(d.cell) === k([11, G + 2, 10])))
  })
})
await t('only a segment that WAITS on this one: an independent upper segment\'s cell is never dug -- killed with the dependency test cut', async () => {
  await killedBy('return !!x && x.seg !== seg && dependsOn(record, x.seg, seg) && !isDone(x)', 'return !!x && x.seg !== seg && !isDone(x)', async M => {
    const { srv, rec, p } = capScene()
    const rec2 = { ...rec, segments: [{ seg: 'A', deps: [] }, { seg: 'B', deps: [] }] }
    const e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
    await M.runVisit({ ...p, record: rec2 }, e, { maxSteps: 400 })
    assert.ok(!e.logs.some(([kk, d]) => kk === '_build' && d.kind === 'cap'), 'no cap dug')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
