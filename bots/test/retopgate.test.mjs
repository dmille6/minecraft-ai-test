// T11REACH2-01show (rig run 26: keep flat at 137 for 40 min). In the gate, every grey re-top was passed on every visit: tidytop.mjs
// retopHeld gave the bag's dirt (16-60) to the town's other open earth cells first (200-390 a visit), and gradetidy.mjs capHeldCols
// then held each column's grade cut with its cap -- 31 of the 49 columns short of the bar. Now, while a grade gate is set, the gate's
// re-tops take the dirt first; a held re-top is NOT done on the rows (held=, held_why=); and with no dirt at all a held column's grass
// or dirt cut is dug (it drops the dirt its cap waits on). With no gate, retopHeld is today's, checked against the base's own module.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
const TT = await import('../src/tidytop.mjs')
const GT = await import('../src/gradetidy.mjs')
const T = await import('../src/tidy.mjs')
const OLD = await import('./_base-tidytop-e8c55.mjs')   // e8c55fdae's tidytop.mjs, verbatim (imports re-pointed to ../src)
const B = await import('./helpers/buildfake.mjs')
const { withMutant } = await import('./helpers/mutant.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; if (process.env.TEST_VERBOSE) console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`) }
}
const P = n => new URL(`../src/${n}`, import.meta.url)
const G = B.G
// the gate: two grade re-tops (grey cobblestone tops at height, x 0 and 2) and five open town fills elsewhere (air, seg U)
const GATE = new Set(['0,0', '2,0'])
const inGate = q => !!q?.grade && GATE.has(`${q.at[0]},${q.at[2]}`)
const recOf = () => ({ cells: [
  { at: [0, G, 0], role: 'topsoil', seg: 'R', grade: true, retop: 1 },
  { at: [2, G, 0], role: 'topsoil', seg: 'R', grade: true, retop: 1 },
  ...[0, 1, 2, 3, 4].map(i => ({ at: [10 + i, G + 1, 6], role: 'earth', seg: 'U' }))], segments: [{ seg: 'R', deps: [] }, { seg: 'U', deps: [] }], cut: [], clear: [], waived: {} })
const srvOf = (extra = {}) => B.server({ [`0,${G},0`]: 'cobblestone', [`2,${G},0`]: 'cobblestone', ...extra })
const openOf = srv => q => !/^(dirt|grass_block)$/.test(srv.read(...q.at)?.name ?? '')

await t('NO GATE: retopHeld is the base\'s, exactly (e8c55fdae tidytop.mjs) over 300 random records', () => {
  const names = ['air', 'cobblestone', 'dirt', 'grass_block', 'stone', 'andesite', 'short_grass']
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
  for (let i = 0; i < 300; i++) {
    const cells = [], world = {}
    for (let j = 0; j < 12; j++) {
      const at = [rnd(6), 60 + rnd(4), rnd(6)]
      cells.push({ at, role: ['topsoil', 'earth', 'core'][rnd(3)], ...(rnd(2) ? { retop: 1 } : {}), ...(rnd(2) ? { grade: true } : {}), ...(rnd(9) === 0 ? { prev: true } : {}) })
      world[at.join(',')] = names[rnd(names.length)]
    }
    const read = (x, y, z) => ({ name: world[`${x},${y},${z}`] ?? 'air' })
    const waived = rnd(3) ? null : { [cells[0].at.join(',')]: { why: 'x' } }
    const dirt = rnd(8)
    const a = OLD.retopHeld(cells, read, dirt, { waived }), b = TT.retopHeld(cells, read, dirt, { waived }), c = TT.retopHeld(cells, read, dirt, { waived, gate: null })
    assert.deepStrictEqual([[...b], b.left], [[...a], a.left], `record ${i}`)
    assert.deepStrictEqual([[...c], c.left], [[...a], a.left])
  }
})
await t('GATE vs NO GATE on the run-26 shape: 2 dirt, 5 open town fills -> no gate passes both gate re-tops; the gate lays both', () => {
  const srv = srvOf(), rec = recOf(), open = openOf(srv)
  assert.deepStrictEqual([...TT.retopHeld(rec.cells, srv.read, 2, { open })].sort(), ['0,69,0', '2,69,0'], 'today: the town\'s fills take the dirt')
  const g = TT.retopHeld(rec.cells, srv.read, 2, { open, gate: inGate })
  assert.deepStrictEqual([...g], [], 'the gate first'); assert.strictEqual(g.gate, 0)
  const one = TT.retopHeld(rec.cells, srv.read, 1, { open, gate: inGate })
  assert.deepStrictEqual([...one], ['2,69,0'], 'one dirt: the first in record order'); assert.strictEqual(one.gate, 1)
})

// THE VISIT (real runVisit on the fake world): held cells are not done on the rows; with dirt the gate's tops are swapped
const visit = async ({ dirt, gate = inGate, srv = srvOf(), rec = recOf(), tidy = [], RV = B.R.runVisit } = {}) => {
  const { p } = B.project(rec)
  const e = B.bot(srv, 'A', { inv: { dirt, cobblestone: 64 } })
  const rows = []; const log0 = e.log; e.log = (k, d) => { rows.push([k, { ...d }]); log0(k, d) }
  const held = TT.retopHeld(rec.cells, srv.read, dirt, { open: openOf(srv), gate })
  const passed = q => T.soilSkip(q, e.has)
  await RV({ ...p('A'), palette: T.TIDY_PALETTE, alsoDone: q => passed(q) || held.has(q.at.join(',')), heldWhy: q => (held.has(q.at.join(',')) ? 'retop_no_dirt' : null), blockLayer: false, domain: () => true, walkR: 20, ...(tidy.length ? { tidy } : {}) }, e, { maxSteps: 200 })
  return { srv, rows, held, e }
}
const segRows = (rows, seg) => rows.filter(([k, d]) => k === '_build_seg' && d.seg === seg).map(([, d]) => d)
const scenHeldRows = async (RV = B.R.runVisit) => {
  const v = await visit({ dirt: 0, RV })
  const r = segRows(v.rows, 'R')
  assert.ok(r.length, 'a row for the gate\'s segment')
  for (const d of r) {
    assert.strictEqual(d.done, 0, `never done while both are cobblestone: ${JSON.stringify(d)}`)
    assert.strictEqual(d.held, 2); assert.strictEqual(d.held_why, 'retop_no_dirt')
  }
  assert.strictEqual(v.srv.read(0, G, 0).name, 'cobblestone', 'held: never dug without the dirt to put back')
}
// one dirt: one gate top laid in the visit, the other held -- the worked segment's own row says held=1, never done=2
const scenOneHeld = async (RV = B.R.runVisit) => {
  const v = await visit({ dirt: 1, RV })
  const last = segRows(v.rows, 'R').at(-1)
  assert.ok(last, 'a row for the worked segment')
  assert.strictEqual(last.held, 1, JSON.stringify(last)); assert.strictEqual(last.held_why, 'retop_no_dirt'); assert.strictEqual(last.done, 1)
  assert.deepStrictEqual([v.srv.read(0, G, 0).name, v.srv.read(2, G, 0).name], ['dirt', 'cobblestone'])
}
await t('HELD IS NOT DONE in a worked segment: 1 dirt -> one top laid, the row says done=1 held=1', () => scenOneHeld())
await t('HELD IS NOT DONE: 0 dirt in the gate -> the segment row says done=0 held=2 held_why=retop_no_dirt (not open=0 done=2)', () => scenHeldRows())
await t('THE GATE ARM in the visit: 2 dirt and 5 open town fills -> both gate tops become dirt; the same visit with no gate leaves both grey', async () => {
  const g = await visit({ dirt: 2 })
  assert.deepStrictEqual([g.srv.read(0, G, 0).name, g.srv.read(2, G, 0).name], ['dirt', 'dirt'])
  const n = await visit({ dirt: 2, gate: null })
  assert.deepStrictEqual([n.srv.read(0, G, 0).name, n.srv.read(2, G, 0).name], ['cobblestone', 'cobblestone'], 'no gate: today\'s order')
})

// THE REMEDY CHAIN (0 dirt in the bag, 0 in the town): a grade cut of grass over a held cap -> capHeldCols lets it go when the gate is
// set (`pays`) -> the visit digs it -> its drop is the cap's dirt (the fake world has no item drops: the dirt the dig yields is added to
// the bag for the next visit, as the bot's pickup does) -> the next visit lays the cap. A cobblestone cut never pays: still held
const chainRec = () => ({ cells: [{ at: [0, G, 0], role: 'topsoil', seg: 'R', grade: true, retop: 1, opener: [0, G + 1, 0] }], segments: [{ seg: 'R', deps: [] }],
  cut: [{ at: [0, G + 1, 0], kind: 'tidy', name: 'grass_block', grade: true }], clear: [], waived: {} })
const PAYS = srv => q => inGate(q) && /^(grass_block|dirt)$/.test(srv.read(...q.at)?.name ?? '')
const scenChain = async (GM = GT) => {
  const srv = srvOf({ [`0,${G + 1},0`]: 'grass_block' }), rec = chainRec()
  const held = TT.retopHeld(rec.cells, srv.read, 0, { open: openOf(srv), gate: inGate })
  assert.deepStrictEqual([...held], ['0,69,0'], 'no dirt: the cap is held')
  assert.ok(GT.capHeldCols(rec.cut, srv.read, held, rec.cells, rec.waived).has('0,0'), 'without the remedy: the cut waits on the cap for ever')
  const cutHeld = GM.capHeldCols(rec.cut, srv.read, held, rec.cells, rec.waived, { pays: PAYS(srv) })
  assert.ok(!cutHeld.has('0,0'), 'the remedy: the grass cut is let go')
  await visit({ dirt: 0, srv, rec, tidy: rec.cut.filter(q => !cutHeld.has(`${q.at[0]},${q.at[2]}`)) })
  assert.strictEqual(srv.read(0, G + 1, 0).name, 'air', 'visit 1 dug the cut')
  assert.strictEqual(srv.read(0, G, 0).name, 'cobblestone', 'and left the cap (no dirt yet)')
  await visit({ dirt: 1, srv, rec })   // the dug grass's drop
  assert.strictEqual(srv.read(0, G, 0).name, 'dirt', 'visit 2 lays the cap: the column at grade with an earth top')
  // a cut that drops no dirt is never let go
  const srvC = srvOf({ [`0,${G + 1},0`]: 'cobblestone' })
  assert.ok(GM.capHeldCols(rec.cut, srvC.read, held, rec.cells, rec.waived, { pays: PAYS(srvC) }).has('0,0'), 'a cobblestone cut still waits')
  // and a waived cap holds whatever pays
  assert.ok(GM.capHeldCols(rec.cut, srv.read, new Set(), rec.cells, { '0,69,0': { why: 'x' } }, { pays: () => true }).has('0,0'))
}
await t('THE REMEDY CHAIN: 0 dirt anywhere, in the gate -> the held cap\'s grass cut is dug, its dirt lays the cap next visit; cobblestone still waits', () => scenChain())

await t('MUTANT KILLED: the gate-first allocation removed (the gate re-tops queue behind the town again)', async () => {
  await withMutant(P('tidytop.mjs'), "  if (typeof gate !== 'function') return retopHeldBase(cells, read, dirt, { waived, open })", '  return retopHeldBase(cells, read, dirt, { waived, open })', async M => {
    const srv = srvOf()
    assert.notDeepStrictEqual([...M.retopHeld(recOf().cells, srv.read, 2, { open: openOf(srv), gate: inGate })], [], 'killed')
  })
})
await t('MUTANT KILLED: held counted done again on the worked segment\'s row', async () => {
  await withMutant(P('buildrun.mjs'), 'if (hw.length) { row.done -= hw.length; row.held = hw.length;', 'if (false) { row.done -= hw.length; row.held = hw.length;', async M => {
    let died = null; try { await scenOneHeld(M.runVisit) } catch (e) { died = e }
    assert.ok(died instanceof assert.AssertionError, `survived or died otherwise: ${died}`)
  })
})
await t('MUTANT KILLED: an all-held segment skipped silently again (the run-26 "never offered")', async () => {
  await withMutant(P('buildrun.mjs'), "if (hw.length) e.log('_build_seg', { seg, open: 0,", "if (false) e.log('_build_seg', { seg, open: 0,", async M => {
    let died = null; try { await scenHeldRows(M.runVisit) } catch (e) { died = e }
    assert.ok(died instanceof assert.AssertionError, `survived or died otherwise: ${died}`)
  })
})
await t('MUTANT KILLED: the remedy removed (the cap waits on a cut that would pay for it)', async () => {
  await withMutant(P('gradetidy.mjs'), 'if (c?.grade && out.has(k) && !waivedCol.has(k) && pays(c)) out.delete(k)', 'void k', async M => {
    let died = null; try { await scenChain(M) } catch (e) { died = e }
    assert.ok(died instanceof assert.AssertionError, `survived or died otherwise: ${died}`)
  })
})
await t('WIRED (structural, comments stripped): the visit hands retopHeld the gate, capHeldCols the remedy, runVisit the held reasons', () => {
  const sk = readFileSync(P('skills.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  assert.ok(/open: q => !buildCellDone\(read\(\.\.\.q\.at\), palette, q\.role\), gate: inGate \}\)/.test(sk))
  assert.ok(/capHeldCols\(tidyCuts\(rec, read, mem\), read, retopPass, visitRec\.cells, rec\.waived, inGate \? \{ pays:/.test(sk))
  assert.ok(/heldWhy: q => \(lawnPaused\.has\(q\.at\.join\(','\)\) \? 'lawn_paused' : retopPass\.has\(q\.at\.join\(','\)\) \? 'retop_no_dirt' : null\)/.test(sk))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
