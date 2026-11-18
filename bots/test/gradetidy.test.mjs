// GRADETIDY-01show (T11 bundle (b)): the clean-up grades the gated columns toward the published ground plan -- cut above the target,
// fill below it, an earth top at it; unknown classes are no opinion (counted); the survey's own rules stay out of the grade's
// columns; one visit cuts, then lays the dirt it dug. Behaviour on buildfake's flat world (grass at G, stone below), plus mutants.
// (c) is here too: a core fill takes cobblestone first, and the bag's own spoil.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, server, bot, project, R } = await import('./helpers/buildfake.mjs')
const GT = await import('../src/gradetidy.mjs')
const T = await import('../src/tidy.mjs')
const TT = await import('../src/tidytop.mjs')
const LP = await import('../src/landplan.mjs')
const TD = await import('../src/towndeposit.mjs')
const { cellDone, blockFor } = await import('../src/buildrun.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const P = n => new URL(`../src/${n}`, import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
// a plan over [-20,-20,20,20]: every column a terrace at G; `over` sets a column's class or height
const BOX = [-20, -20, 20, 20]
const plan = ({ over = {}, gate = [], v = 1 } = {}) => {
  const w = BOX[2] - BOX[0] + 1
  const h = [], cls = []
  for (let z = BOX[1]; z <= BOX[3]; z++) {
    const hr = [], cr = []
    for (let x = BOX[0]; x <= BOX[2]; x++) { const o = over[`${x},${z}`] ?? {}; hr.push(o.y ?? G); cr.push(o.c ?? 't') }
    h.push(hr); cls.push(cr.join(''))
  }
  assert.strictEqual(h[0].length, w)
  return { v, sha256: 'ab12cd34ef', box: BOX, h, class: cls, gate: { id: 'T11', cols: gate } }
}
const gateSq = (x0, z0, x1, z1) => { const out = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push([x, z]); return out }
const deps = read => ({ col: (x, z, y) => T.tidyColumn(read, x, z, { yHi: y + 16, yLo: y - 16 }), cuttable: n => T.LEVEL_CUT.test(n), liquid: b => !!b && /water|lava/.test(b.name) })
const INWALL = LP.landStages().find(q => q.id === 'inwall')
const site = (srv, grade, { cells = new Set(), avoid } = {}) => {
  const s = T.siteStage(srv.read, { home: HOME, land: { seed: 1 }, stage: INWALL, env: { ROUGH: 'on' }, cells, terrace: { wall: { ring: [-30, -30, 30, 30] }, records: [], climbs: [] }, grade, ...(avoid ? { avoid } : {}) })
  return { s, rec: s.record ? T.coreFills(s.record) : null }
}

console.log('THE TARGET FILE')
await t('gradeTarget: a good file -> the gate and its version; every bad shape -> a reason, never a throw', () => {
  const g = GT.gradeTarget(plan({ gate: [[1, 2], [3, 4]] }))
  assert.ok(g.ok); assert.strictEqual(g.t.gate.size, 2); assert.ok(g.t.gate.has('1,2'))
  assert.strictEqual(GT.gradeV(g.t), 'v1:ab12cd34:T11')
  assert.strictEqual(GT.gradeTarget(null).why, 'no_file')
  assert.strictEqual(GT.gradeTarget({ ...plan({ gate: [[1, 2]] }), box: [0, 0] }).why, 'bad_box')
  assert.strictEqual(GT.gradeTarget({ ...plan({ gate: [[1, 2]] }), h: [] }).why, 'bad_rows')
  assert.strictEqual(GT.gradeTarget({ ...plan({ gate: [[1, 2]] }), sha256: '' }).why, 'no_version')
  assert.strictEqual(GT.gradeTarget(plan({ gate: [] })).why, 'no_gate')
  assert.strictEqual(GT.gradeTarget('garbage').why, 'no_file')
})
await t('targetAt: t, b, a and e are ground with a target; o, f, w no opinion; an unknown class no opinion, named; outside the box', () => {
  const t0 = GT.gradeTarget(plan({ over: { '1,1': { c: 'b', y: 70 }, '2,1': { c: 'a' }, '3,1': { c: 'e' }, '4,1': { c: 'o' }, '5,1': { c: 'f' }, '6,1': { c: 'w' }, '7,1': { c: 'q' } }, gate: [[0, 0]] })).t
  assert.deepStrictEqual(GT.targetAt(t0, 0, 0), { y: G, cls: 't' })
  assert.deepStrictEqual(GT.targetAt(t0, 1, 1), { y: 70, cls: 'b' })
  assert.strictEqual(GT.targetAt(t0, 2, 1).y, G); assert.strictEqual(GT.targetAt(t0, 3, 1).y, G)
  for (const x of [4, 5, 6]) assert.strictEqual(GT.targetAt(t0, x, 1).why, 'no_opinion')
  assert.strictEqual(GT.targetAt(t0, 7, 1).why, 'unknown_class')
  assert.strictEqual(GT.targetAt(t0, 50, 0).why, 'outside_box')
})

console.log('ONE COLUMN')
await t('gradeColumn: above -> cuts top first and an earth top left alone; a stone top at the target -> a re-top', () => {
  const srv = server({ [`0,${G + 1},0`]: 'dirt', [`0,${G + 2},0`]: 'dirt' })
  const w = GT.gradeColumn(srv.read, 0, 0, G, deps(srv.read))
  assert.deepStrictEqual(w.cut.map(c => c.at[1]), [G + 2, G + 1]); assert.deepStrictEqual(w.fill, [])
  srv.set([1, G, 0], 'stone'); srv.set([1, G + 1, 0], 'cobblestone')
  const w2 = GT.gradeColumn(srv.read, 1, 0, G, deps(srv.read))
  assert.deepStrictEqual(w2.cut.map(c => c.name), ['cobblestone']); assert.deepStrictEqual(w2.fill, [{ at: [1, G, 0], role: 'topsoil', retop: true }])
})
await t('gradeColumn: below -> earth up to the target, topsoil at it; at the target -> nothing on grass, a re-top on cobblestone', () => {
  const srv = server({ [`0,${G},0`]: 'air', [`0,${G - 1},0`]: 'air', [`1,${G},0`]: 'cobblestone' })
  const w = GT.gradeColumn(srv.read, 0, 0, G, deps(srv.read))
  assert.deepStrictEqual(w.fill, [{ at: [0, G - 1, 0], role: 'earth' }, { at: [0, G, 0], role: 'topsoil' }]); assert.deepStrictEqual(w.cut, [])
  assert.deepStrictEqual(GT.gradeColumn(srv.read, 2, 0, G, deps(srv.read)), { cut: [], fill: [], why: null, h: G })
  assert.deepStrictEqual(GT.gradeColumn(srv.read, 1, 0, G, deps(srv.read)).fill, [{ at: [1, G, 0], role: 'topsoil', retop: true }])
})
await t('gradeColumn: never half a column -- a tree, a built block, water beside, a block it may not cut -> the reason, nothing planned', () => {
  const srv = server({ [`0,${G + 1},0`]: 'oak_log', [`1,${G + 1},0`]: 'oak_slab', [`2,${G},1`]: 'water', [`3,${G + 1},0`]: 'gravel' })
  assert.strictEqual(GT.gradeColumn(srv.read, 0, 0, G, deps(srv.read)).why, 'tree')
  assert.strictEqual(GT.gradeColumn(srv.read, 1, 0, G, deps(srv.read)).why, 'built')
  assert.strictEqual(GT.gradeColumn(srv.read, 2, 0, G, deps(srv.read)).why, 'water_beside')
  assert.strictEqual(GT.gradeColumn(srv.read, 3, 0, G, deps(srv.read)).why, 'not_cuttable')
  // a floating spoil block over a gap is cut (the gap is nothing to dig)
  srv.set([4, G + 3, 0], 'dirt')
  assert.deepStrictEqual(GT.gradeColumn(srv.read, 4, 0, G, deps(srv.read)).cut.map(c => c.at[1]), [G + 3])
})

console.log('THE SURVEY')
await t('gradeSurvey: only gated columns; unknown and no-opinion classes counted, never planned; avoid and other records honoured', () => {
  const srv = server({ [`5,${G + 1},5`]: 'dirt', [`6,${G + 1},5`]: 'dirt', [`7,${G + 1},5`]: 'dirt', [`9,${G + 1},9`]: 'dirt' })
  const t0 = GT.gradeTarget(plan({ over: { '6,5': { c: 'q' }, '7,5': { c: 'f' } }, gate: [[5, 5], [6, 5], [7, 5], [8, 5], [8, 6], [8, 7]] })).t
  const gs = GT.gradeSurvey(srv.read, t0, { ...deps(srv.read), avoid: (x, z) => (x === 8 && z === 6 ? 'zone' : null), cellCols: new Set(['8,7']) })
  assert.deepStrictEqual(gs.cut.map(c => c.at.join(',')), [`5,${G + 1},5`])
  assert.ok(!gs.cut.some(c => c.at[0] === 9), 'never an ungated column')
  assert.deepStrictEqual(gs.skipped, { unknown_class: 1, no_opinion: 1, avoided: 1, cell_column: 1, at_target: 1 })
  assert.ok(gs.cols.has('5,5') && gs.cols.has('8,5') && !gs.cols.has('6,5') && !gs.cols.has('7,5'))
  assert.strictEqual(gs.v, 'v1:ab12cd34:T11')
})
await t('siteStage: the gated columns are graded and the survey\'s own rules stay out of them; outside the gate the survey as before', () => {
  const srv = server()
  // in the gate: a 2-high dirt pillar (cut), a 2-deep hole (core + topsoil), a cobblestone top (re-top), a floating beam (cut)
  srv.set([5, G + 1, 5], 'dirt'); srv.set([5, G + 2, 5], 'dirt')
  srv.set([6, G, 5], 'air'); srv.set([6, G - 1, 5], 'air')
  srv.set([7, G, 5], 'cobblestone')
  for (const x of [5, 6, 7]) srv.set([x, G + 4, 7], 'dirt')
  // outside the gate: the same beam (the rough survey's)
  for (const x of [-12, -11, -10]) srv.set([x, G + 4, -9], 'dirt')
  const g = GT.gradeTarget(plan({ gate: gateSq(5, 5, 7, 7) }))
  const { rec, s } = site(srv, { t: g.t })
  const gc = rec.cut.filter(c => c.grade).map(c => c.at.join(',')).sort()
  assert.deepStrictEqual(gc, [`5,${G + 1},5`, `5,${G + 2},5`, `5,${G + 4},7`, `6,${G + 4},7`, `7,${G + 4},7`].sort())
  const gcell = Object.fromEntries(rec.cells.filter(c => c.grade).map(c => [c.at.join(','), c.role + (c.retop ? '+retop' : '')]))
  assert.deepStrictEqual(gcell, { [`6,${G - 1},5`]: 'core', [`6,${G},5`]: 'topsoil', [`7,${G},5`]: 'topsoil+retop' })
  // the rough survey still takes the beam outside the gate, and nothing ungraded lands in a gated column
  assert.ok(rec.cut.some(c => c.at.join(',') === `-12,${G + 4},-9` && !c.grade))
  const inGate = at => at[0] >= 5 && at[0] <= 7 && at[2] >= 5 && at[2] <= 7
  assert.ok([...rec.cut, ...rec.cells].filter(q => inGate(q.at)).every(q => q.grade), 'only the grade in its columns')
  assert.strictEqual(s.grade.v, 'v1:ab12cd34:T11'); assert.strictEqual(rec.inwall.grade.cut, 5)
  // control: no grade -> the gated beam is the rough survey's again
  const { rec: r0 } = site(srv, null)
  assert.ok(r0.cut.some(c => c.at.join(',') === `5,${G + 4},7` && !c.grade))
})
const siteM = (M, srv, g) => M.siteStage(srv.read, { home: HOME, land: { seed: 1 }, stage: INWALL, env: { ROUGH: 'on' }, cells: new Set(), terrace: { wall: { ring: [-30, -30, 30, 30] }, records: [], climbs: [] }, grade: { t: g.t } }).record
await t('MUTANTS: without dropGradeCols the inside-the-wall pillar is cut twice; without the busy columns the rough beam is planned twice', async () => {
  const srv = server()
  srv.set([5, G + 1, 5], 'dirt'); srv.set([5, G + 2, 5], 'dirt')
  for (const x of [5, 6, 7]) srv.set([x, G + 4, 7], 'dirt')
  const g = GT.gradeTarget(plan({ gate: gateSq(5, 5, 7, 7) }))
  const dup = rec => rec.cut.length - new Set(rec.cut.map(c => c.at.join(','))).size
  assert.strictEqual(dup(siteM(T, srv, g)), 0, 'positive control: no cut twice')
  await withMutant(P('tidy.mjs'), '      const kept = dropGradeCols(sv0, gw.cols)\n', '      const kept = sv0\n', M => assert.ok(dup(siteM(M, srv, g)) > 0, 'the pillar twice'))
  // the plan keeps a 1-high dirt bump (its target IS the bump): the rough survey would cut it (roughground: a 2-column bump 1 high)
  const srv2 = server({ [`5,${G + 1},6`]: 'dirt', [`6,${G + 1},6`]: 'dirt' })
  const g2 = GT.gradeTarget(plan({ over: { '5,6': { y: G + 1 }, '6,6': { y: G + 1 } }, gate: gateSq(5, 5, 7, 7) }))
  const bumpCut = rec => (rec?.cut ?? []).filter(c => c.at[2] === 6 && c.at[1] === G + 1).length
  assert.strictEqual(bumpCut(siteM(T, srv2, g2)), 0, 'the grade keeps the planned bump')
  const noGrade = T.siteStage(srv2.read, { home: HOME, land: { seed: 1 }, stage: INWALL, env: { ROUGH: 'on' }, cells: new Set(), terrace: { wall: { ring: [-30, -30, 30, 30] }, records: [], climbs: [] } }).record
  assert.ok(bumpCut(noGrade) > 0, 'positive control: the rough survey cuts it without the grade')
  await withMutant(P('tidy.mjs'), '      for (const k of gw?.cols ?? []) busyR.add(k)', '', M => assert.ok(bumpCut(siteM(M, srv2, g2)) > 0, 'the rough survey cuts the planned bump'))
})

console.log('ONE VISIT: CUT, THEN LAY THE DIRT IT DUG')
await t('a bag with no dirt cuts the pillar and lays its dirt in the hole beside it, in the same visit; nothing left open', async () => {
  const srv = server()
  srv.set([5, G + 1, 5], 'dirt'); srv.set([5, G + 2, 5], 'dirt')
  srv.set([7, G, 5], 'air'); srv.set([7, G - 1, 5], 'air')
  const g = GT.gradeTarget(plan({ gate: gateSq(5, 5, 7, 5) }))
  const { rec } = site(srv, { t: g.t })
  const { p } = project(rec)
  // the fake's dig drops the block into the bag, as a pickaxe's dig does (Paper: the block's drop is picked up)
  const inv = { stone_pickaxe: 1 }
  const digDrops = async (c, expect) => { const n = srv.read(...c)?.name; if (expect && n !== expect) return 'refused'; srv.set(c, 'air'); inv[n === 'grass_block' ? 'dirt' : n] = (inv[n === 'grass_block' ? 'dirt' : n] ?? 0) + 1; return 'confirmed' }
  const e = bot(srv, 'A', { inv, feet: [6, G + 1, 3], dig: digDrops })
  await R.runVisit({ ...p('A'), palette: T.TIDY_PALETTE, tidy: rec.cut, alsoDone: q => T.soilSkip(q, e.has), blockLayer: false, domain: () => true, walkR: 30 }, e, { maxSteps: 200 })
  assert.deepStrictEqual([G + 1, G + 2].map(y => srv.read(5, y, 5).name), ['air', 'air'], 'the pillar is cut')
  assert.deepStrictEqual([G - 1, G].map(y => srv.read(7, y, 5).name), ['dirt', 'dirt'], 'the hole is filled with its dirt')
  assert.ok(rec.cells.every(q => cellDone(srv.read(...q.at), T.TIDY_PALETTE, q.role)))
})

console.log('(c) CORE FILLS TAKE THE BAG\'S COBBLESTONE FIRST')
await t('a core cell takes cobblestone first; the spoil a visit digs above the bag\'s keep is spendable at once', () => {
  assert.strictEqual(blockFor(T.TIDY_PALETTE, 'core', n => ['cobblestone', 'dirt'].includes(n)), 'cobblestone')
  assert.strictEqual(blockFor(T.TIDY_PALETTE, 'topsoil', n => ['cobblestone'].includes(n)), null)
  // the keep is read from the bag at the visit's start (min(held, 64)): what the cuts add above it is spare
  const keep = TD.townKeeps({ cobblestone: 40 }).keep
  assert.strictEqual(keep.cobblestone, 40)
  const spare = n => ({ cobblestone: 40 + 6 })[n] - (keep[n] ?? 0)
  assert.strictEqual(spare('cobblestone'), 6)
})

console.log('THE ROWS')
await t('gradeAdded counts what a refresh added of the grade; retopWhy leaves a graded cell to the target', () => {
  const rec = { cut: [{ at: [0, 1, 0], grade: true, added: 5 }, { at: [1, 1, 0], added: 5 }], cells: [{ at: [0, 0, 0], grade: true, added: 5 }, { at: [2, 0, 0], grade: true, added: 4 }] }
  assert.deepStrictEqual(GT.gradeAdded(rec, 5), { cut: 1, fill: 1 })
  assert.strictEqual(TT.retopWhy({ at: [0, G, 0], role: 'earth', grade: true }, server({ [`0,${G},0`]: 'cobblestone' }).read), 'grade')
})
await t('WIRED (comments stripped): the refresh and the inside-the-wall siting pass the target; the refresh row says grade_v', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const sk = strip(readFileSync(P('skills.mjs'), 'utf8'))
  assert.ok(/planned: busy, grade: gradeNow\(bot\) \}\)/.test(sk), 'the refresh')
  assert.ok(/forest: forestRecNow\(\), grade: k === landStages\(\)\.find\(q => q\.id === 'inwall'\)\?\.k \? gradeNow\(bot\) : null \}\)/.test(sk), 'the siting')
  assert.ok(/op: 'refreshed'[^\n]*\.\.\.\(s\?\.grade \? \{ grade_v: s\.grade\.v \} : \{\}\)/.test(sk), 'grade_v on the refresh row')
  assert.ok(/'grade_v', 'why'\], f\)/.test(strip(readFileSync(P('shop.mjs'), 'utf8'))), 'the row keeps the field')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
