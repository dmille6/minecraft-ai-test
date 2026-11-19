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
  assert.deepStrictEqual(w2.cut.map(c => c.name), ['cobblestone']); assert.deepStrictEqual(w2.fill, [{ at: [1, G, 0], role: 'topsoil', retop: true, opener: [1, G + 1, 0] }])
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

await t('gradeColumn: a crust over a hollow -> the crust cut, the hollow filled from its floor; too deep -> left; a canopy is no tree', () => {
  // grass at G+1 over air at G, stone under it (the bots' layered spoil; replay of T11 11-18: 30 such columns)
  const srv = server({ [`0,${G + 1},0`]: 'grass_block', [`0,${G},0`]: 'air' })
  const w = GT.gradeColumn(srv.read, 0, 0, G, deps(srv.read))
  assert.deepStrictEqual(w.cut.map(c => c.at[1]), [G + 1])
  assert.deepStrictEqual(w.fill.map(f => ({ at: f.at, role: f.role })), [{ at: [0, G, 0], role: 'topsoil' }])
  // control 11-18 (option b): a hollow 2 deep is DEFERRED -- its crust is left alone
  srv.set([3, G + 1, 0], 'grass_block'); srv.set([3, G, 0], 'air'); srv.set([3, G - 1, 0], 'air')
  assert.strictEqual(GT.gradeColumn(srv.read, 3, 0, G, deps(srv.read)).why, 'hollow_deep')
  for (let y = G - 6; y <= G; y++) srv.set([1, y, 0], 'air'); srv.set([1, G + 1, 0], 'dirt')
  assert.strictEqual(GT.gradeColumn(srv.read, 1, 0, G, deps(srv.read)).why, 'hollow_deep')
  // leaves over the column are not a trunk: the cobblestone top under them is re-topped
  srv.set([2, G, 0], 'cobblestone'); srv.set([2, G + 3, 0], 'spruce_leaves'); srv.set([2, G + 4, 0], 'spruce_leaves')
  assert.deepStrictEqual(GT.gradeColumn(srv.read, 2, 0, G, deps(srv.read)).fill, [{ at: [2, G, 0], role: 'topsoil', retop: true }])
})
console.log('THE SURVEY')
await t('gradeSurvey: only gated columns; unknown and no-opinion classes counted, never planned; avoid and other records honoured', () => {
  const srv = server({ [`5,${G + 1},5`]: 'dirt', [`6,${G + 1},5`]: 'dirt', [`7,${G + 1},5`]: 'dirt', [`9,${G + 1},9`]: 'dirt' })
  const t0 = GT.gradeTarget(plan({ over: { '6,5': { c: 'q' }, '7,5': { c: 'f' } }, gate: [[5, 5], [6, 5], [7, 5], [8, 5], [8, 6], [8, 7]] })).t
  const gs = GT.gradeSurvey(srv.read, t0, { ...deps(srv.read), avoid: (x, z) => (x === 8 && z === 6 ? 'zone' : null), cellCols: new Set(['8,7']) })
  assert.deepStrictEqual(gs.cut.map(c => c.at.join(',')), [`5,${G + 1},5`])
  assert.ok(!gs.cut.some(c => c.at[0] === 9), 'never an ungated column')
  assert.deepStrictEqual(gs.skipped, { unknown_class: 1, no_opinion: 1, 'avoided:zone': 1, cell_column: 1, at_target: 1 })
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

console.log('A COLUMN THE RECORD ALREADY NAMES')
await t('releaseGradeCols: a gated column whose named work is all done or waived is released; any open work keeps the whole column', () => {
  const rec = { cells: [{ at: [1, G, 1], role: 'earth' }, { at: [2, G, 1], role: 'earth' }, { at: [3, G, 1], role: 'earth' }, { at: [9, G, 9], role: 'earth' }],
    cut: [{ at: [2, G + 1, 1], name: 'dirt' }, { at: [4, G + 1, 1], name: 'dirt' }], clear: [], waived: { [`3,${G},1`]: { why: 'x' } } }
  const cols = new Set(['1,1', '2,1', '3,1', '4,1', '9,9'])
  const done = q => q.at[0] === 1 || q.at[0] === 9   // (1) done, (2) open, (3) waived, (9) done
  const standing = q => q.at[0] === 2                // (2)'s cut stands, (4)'s is down
  const { rec: r2, released } = GT.releaseGradeCols(rec, cols, { done, standing })
  assert.deepStrictEqual(released.sort(), ['1,1', '3,1', '4,1', '9,9'])
  assert.deepStrictEqual(r2.cells.map(c => c.at[0]), [2]); assert.deepStrictEqual(r2.cut.map(c => c.at[0]), [2])
  assert.deepStrictEqual(r2.waived, {})
  // an ungated column is never touched
  assert.strictEqual(GT.releaseGradeCols(rec, new Set(['7,7']), { done, standing }).released.length, 0)
})
await t('WIRED (comments stripped): the refresh releases the finished gated columns before its merge', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const sk = strip(readFileSync(P('skills.mjs'), 'utf8'))
  assert.ok(/const relG = gNow\?\.t \? releaseGradeCols\(cur, gNow\.t\.gate,[^\n]*\n\s*cur = relG\.rec\n\s*const busy = openColumns\(cur, read,[^\n]*\n\s*res = refreshMerge\(cur, fresh,/.test(sk))
})
await t('gradeFirst: segments with an open grade cell, and what they wait on, go first; none open -> the order as it was', () => {
  const rec = { segments: [{ seg: 'A', deps: [] }, { seg: 'B', deps: [] }, { seg: 'G0', deps: [] }, { seg: 'G1', deps: ['G0'] }],
    cells: [{ at: [0, 0, 0], seg: 'A' }, { at: [1, 0, 0], seg: 'G0', grade: true }, { at: [1, 1, 0], seg: 'G1', grade: true }] }
  assert.deepStrictEqual(GT.gradeFirst(rec).segments.map(s => s.seg), ['G0', 'G1', 'A', 'B'])
  assert.deepStrictEqual(GT.gradeFirst(rec, q => q.seg === 'G1').segments.map(s => s.seg), ['G0', 'G1', 'A', 'B'], 'a layer pulls the one under it')
  assert.strictEqual(GT.gradeFirst(rec, () => false), rec)
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  assert.ok(/visitRec = gradeFirst\(visitRec, q => !waivedK\(q\) && !buildCellDone\(read\(\.\.\.q\.at\), palette, q\.role\), new Set\(\(bot\.gradeUnreached = noteUnreached\(bot\.gradeUnreached, \[\], Date\.now\(\)\)\)\.keys\(\)\)\)/.test(strip(readFileSync(P('skills.mjs'), 'utf8'))), 'the visit orders by it')
})
console.log('CODEX T11 r1')
await t('BLOCKER 1: a reserved column (keepOff: landmark, hold, lawn) is never graded', () => {
  const srv = server({ [`5,${G + 1},5`]: 'dirt' })
  const g = GT.gradeTarget(plan({ gate: [[5, 5]] }))
  // the inwall survey's reservations come in through terrace.records / landmark zones; here the survey's own `avoid` path stands in
  const { rec } = site(srv, { t: g.t }, { avoid: (x, z) => (x === 5 && z === 5 ? 'reserved:landmark' : null) })
  assert.ok(!(rec?.cut ?? []).some(c => c.grade), 'nothing graded in a reserved column')
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  assert.ok(/gw = gradeSurvey\(read, grade\.t, \{ home, avoid: keepOff,/.test(strip(readFileSync(P('tidy.mjs'), 'utf8'))), 'the survey\'s own keepOff, reservations first')
})
await t('BLOCKER 2: a crust over a hollow: the cuts carry the hollow, the hollow cells name their opener (never waived)', () => {
  const srv = server({ [`0,${G + 1},0`]: 'grass_block', [`0,${G},0`]: 'air' })
  const w = GT.gradeColumn(srv.read, 0, 0, G, deps(srv.read))
  assert.deepStrictEqual(w.cut[0].hollow, [[0, G, 0]])
  assert.ok(w.fill.every(f => JSON.stringify(f.opener) === JSON.stringify([0, G + 1, 0])))
  const g = GT.gradeTarget(plan({ gate: [[0, 0]] }))
  const { rec } = site(srv, { t: g.t })
  assert.ok(rec.cells.filter(c => c.grade).every(c => Array.isArray(c.opener)) && rec.cut.find(c => c.grade).hollow.length === 1, 'the record keeps both')
})
await t('BLOCKER 3: a changed or withdrawn target takes the open grade work off; finished work stays; the same plan keeps all', () => {
  const rec = { grade_v: 'A', cells: [{ at: [1, G, 1], grade: true }, { at: [2, G, 1], grade: true }, { at: [3, G, 1] }], cut: [{ at: [1, G + 1, 1], grade: true }], waived: { [`2,${G},1`]: {} } }
  const done = q => q.at[0] === 1
  const standing = () => true
  assert.strictEqual(GT.dropStaleGrade(rec, 'A', { done, standing }).dropped, 0)
  const r2 = GT.dropStaleGrade(rec, 'B', { done, standing })
  assert.deepStrictEqual(r2.rec.cells.map(c => c.at[0]), [1, 3]); assert.deepStrictEqual(r2.rec.cut, []); assert.deepStrictEqual(r2.rec.waived, {})
  assert.strictEqual(r2.rec.grade_v, 'B')
  const r3 = GT.dropStaleGrade(rec, null, { done, standing })
  assert.ok(!('grade_v' in r3.rec)); assert.strictEqual(r3.dropped, 2)
  // a fresh siting carries its stamp, so its own first refresh keeps its work
  const srv = server({ [`5,${G + 1},5`]: 'dirt' })
  const g = GT.gradeTarget(plan({ gate: [[5, 5]] }))
  const { rec: sited } = site(srv, { t: g.t })
  assert.strictEqual(sited.grade_v, GT.gradeStamp(g.t))
  assert.strictEqual(GT.dropStaleGrade(sited, GT.gradeStamp(g.t)).dropped, 0)
  // the gate is part of the stamp: the same v and sha with another gate is another plan
  assert.notStrictEqual(GT.gradeStamp(g.t), GT.gradeStamp(GT.gradeTarget(plan({ gate: [[5, 6]] })).t))
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  assert.ok(/const stale = dropStaleGrade\(cur, gradeStamp\(gNow\?\.t \?\? null\),[^\n]*\n\s*cur = stale\.rec/.test(strip(readFileSync(P('skills.mjs'), 'utf8'))), 'the refresh drops it before the release and the merge')
})
await t('chainCuts: the grade\'s cuts first, then the rest from where they end (the visit digs the terrace before the town)', () => {
  const cuts = [{ at: [1, G + 1, 0] }, { at: [20, G + 1, 0], grade: true }, { at: [21, G + 2, 0], grade: true }, { at: [22, G + 1, 0] }]
  assert.deepStrictEqual(T.chainCuts(cuts, [0, 0]).map(c => c.at[0]), [20, 21, 22, 1])
  assert.deepStrictEqual(T.chainCuts(cuts.map(c => ({ at: c.at })), [0, 0]).map(c => c.at[0]), [1, 20, 21, 22], 'control: without the grade, nearest first')
})
console.log('CODEX T11 r2')
await t('BLOCKER 1: a withdrawn plan keeps the fills of a hole it already opened', () => {
  const rec = { grade_v: 'A', cells: [{ at: [0, G - 1, 0], grade: true, opener: [0, G + 1, 0] }, { at: [0, G, 0], grade: true, opener: [0, G + 1, 0] }, { at: [3, G, 0], grade: true }],
    cut: [{ at: [0, G + 1, 0], grade: true, hollow: [[0, G - 1, 0], [0, G, 0]] }] }
  const r = GT.dropStaleGrade(rec, null, { done: () => false, standing: () => false })   // the crust is dug: the hollow is open
  assert.deepStrictEqual(r.rec.cells.map(c => c.at[0]), [0, 0], 'the opened hollow\'s fills stay; the untouched column\'s goes')
  const r2 = GT.dropStaleGrade(rec, null, { done: () => false, standing: () => true })    // nothing dug yet: all of it goes
  assert.strictEqual(r2.rec.cells.length, 0)
})
await t('BLOCKER 2: a re-top only on a block the visit may dig (tuff, mossy cobblestone are left); the list is buildrun\'s own', async () => {
  const { FOREIGN_CLEAR } = await import('../src/buildrun.mjs')
  assert.strictEqual(GT.RETOP_DIGGABLE.source, FOREIGN_CLEAR.source)
  const srv = server({ [`0,${G},0`]: 'tuff', [`1,${G},0`]: 'andesite' })
  const d = { ...deps(srv.read), retopable: n => T.LEVEL_CUT.test(n) && GT.RETOP_DIGGABLE.test(n) }
  assert.strictEqual(GT.gradeColumn(srv.read, 0, 0, G, d).why, 'retop_not_diggable')
  assert.deepStrictEqual(GT.gradeColumn(srv.read, 1, 0, G, d).fill, [{ at: [1, G, 0], role: 'topsoil', retop: true }])
  assert.ok(!TT.GREY_FILL.test('mossy_cobblestone'))
})
await t('Codex T11 r3: a re-top already dug out (air now) is owed by a withdrawn plan too; one not yet dug goes', () => {
  const rec = { grade_v: 'A', cells: [{ at: [0, G, 0], role: 'topsoil', grade: true, retop: 1 }, { at: [1, G, 0], role: 'topsoil', grade: true, retop: 1 }], cut: [] }
  const r = GT.dropStaleGrade(rec, null, { done: () => false, standing: () => true, empty: q => q.at[0] === 0 })
  assert.deepStrictEqual(r.rec.cells.map(c => c.at[0]), [0])
})
console.log('CONTROL 11-18 DECISION 2')
await t('the re-top pass works only inside the gate and its banks while a gate is set; with none, town-wide as before', () => {
  const t0 = GT.gradeTarget(plan({ over: { '8,5': { c: 'b' }, '9,5': { c: 'b' } }, gate: [[5, 5], [6, 5], [7, 5]] })).t
  const ko = GT.retopKeepOff(t0, () => null)
  assert.strictEqual(ko(6, 5), null); assert.strictEqual(ko(8, 5), null, 'a bank beside the gate')
  assert.strictEqual(ko(9, 5), 'outside_gate', 'a bank not beside it'); assert.strictEqual(ko(0, 0), 'outside_gate')
  assert.strictEqual(GT.retopKeepOff(null, () => 'zone')(0, 0), 'zone')
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  assert.ok(/const capHeld = capHeldCols\(tidyCuts\(rec, read, mem\), read, retopPass, visitRec\.cells, rec\.waived\)/.test(strip(readFileSync(P('skills.mjs'), 'utf8'))) && /const cutHeld = gradeOn\(\) \? gradeCutsHeld\(tidyCuts\(rec, read, mem\), read, capHeld\) : new Set\(\)/.test(strip(readFileSync(P('skills.mjs'), 'utf8'))) && /filter\(q => !claimedQ\(q\) && !plotEntryRetired\(q, plotsSited\) && !cutHeld\.has\(q\.at\.join\(','\)\) &&/.test(strip(readFileSync(P('skills.mjs'), 'utf8'))), 'the visit holds the cuts')
  assert.ok(/retopCells\(res\.rec \?\? cur, read, \{ guard, keepOff: retopKeepOff\(gNow\?\.t \?\? null, fcKeepOff \?\? \(\(\) => 'closed'\)\),/.test(strip(readFileSync(P('skills.mjs'), 'utf8'))))
})
const capVisit = async (dirt) => {
  // a column cut down to its target: dirt at G+1 over cobblestone AT the target (the cut exposes stone)
  const srv = server({ [`5,${G + 1},5`]: 'dirt', [`5,${G},5`]: 'cobblestone' })
  const g = GT.gradeTarget(plan({ gate: [[5, 5]] }))
  const { rec } = site(srv, { t: g.t })
  const inv = { stone_pickaxe: 1, ...(dirt ? { dirt } : {}) }
  const digDrops = async (c, expect) => { const n = srv.read(...c)?.name; if (expect && n !== expect) return 'refused'; srv.set(c, 'air'); const d = n === 'grass_block' ? 'dirt' : n; inv[d] = (inv[d] ?? 0) + 1; return 'confirmed' }
  const e = bot(srv, 'A', { inv, feet: [6, G + 1, 3], dig: digDrops })
  // the visit's own rules: retopHeld on the bag's dirt (no keep in the fake), gradeCutsHeld on the held caps
  const held = TT.retopHeld(rec.cells, srv.read, dirt, { open: q => !cellDone(srv.read(...q.at), T.TIDY_PALETTE, q.role) })
  const capHeld = GT.capHeldCols(rec.cut, srv.read, held, rec.cells)
  const cutHeld = GT.gradeCutsHeld(rec.cut, srv.read, capHeld)
  const { p } = project(rec)
  await R.runVisit({ ...p('A'), palette: T.TIDY_PALETTE, tidy: rec.cut.filter(c => !cutHeld.has(c.at.join(','))), alsoDone: q => T.soilSkip(q, e.has) || held.has(q.at.join(',')), blockLayer: false, domain: () => true, walkR: 30 }, e, { maxSteps: 200 })
  return { top: [G + 1, G].map(y => srv.read(5, y, 5).name), cutHeld }
}
await t('a cut that would expose stone waits without the dirt to cap it (no grey top made); with the dirt it cuts and caps in one visit', async () => {
  const none = await capVisit(0)
  assert.strictEqual(none.cutHeld.size, 1)
  assert.deepStrictEqual(none.top, ['dirt', 'cobblestone'], 'nothing cut: the earth top stays')
  const one = await capVisit(1)
  assert.strictEqual(one.cutHeld.size, 0)
  assert.deepStrictEqual(one.top, ['air', 'dirt'], 'cut to the target and capped with earth')
})
await t('gradeCutsHeld: the earth above the first stone-exposing cut is still cut; that cut and every one below it wait', () => {
  const srv = server({ [`0,${G + 3},0`]: 'dirt', [`0,${G + 2},0`]: 'dirt', [`0,${G + 1},0`]: 'cobblestone', [`0,${G},0`]: 'stone' })
  const cuts = [G + 3, G + 2, G + 1].map(y => ({ at: [0, y, 0], grade: true }))
  assert.deepStrictEqual([...GT.gradeCutsHeld(cuts, srv.read, new Set(['0,0']))].sort(), [`0,${G + 1},0`, `0,${G + 2},0`].sort())
  assert.strictEqual(GT.gradeCutsHeld(cuts, srv.read, new Set()).size, 0, 'a cap the visit can lay holds nothing')
})
await t('MUTANT: without the hold the cut exposes cobblestone with no dirt to cap it (a grey top)', async () => {
  await withMutant(P('gradetidy.mjs'), "      if (hold) held.add(c.at.join(','))\n", '', async M => {
    const srv = server({ [`5,${G + 1},5`]: 'dirt', [`5,${G},5`]: 'cobblestone' })
    assert.strictEqual(M.gradeCutsHeld([{ at: [5, G + 1, 5], grade: true }], srv.read, new Set(['5,5'])).size, 0)
  })
})
console.log('CODEX T11 DELTA r1')
await t('BLOCKER 1: stone between earth layers (no cap planned) is not cut into without dirt; with a dirt unit it is', () => {
  const srv = server({ [`0,${G + 3},0`]: 'dirt', [`0,${G + 2},0`]: 'stone', [`0,${G + 1},0`]: 'stone' })   // target G: dirt (earth)
  const cuts = [G + 3, G + 2, G + 1].map(y => ({ at: [0, y, 0], grade: true }))
  const none = Object.assign(new Set(), { left: 0 })
  assert.deepStrictEqual([...GT.capHeldCols(cuts, srv.read, none)], ['0,0'])
  assert.deepStrictEqual([...GT.gradeCutsHeld(cuts, srv.read, GT.capHeldCols(cuts, srv.read, none))].sort(), [G + 1, G + 2, G + 3].map(y => `0,${y},0`).sort())
  assert.strictEqual(GT.capHeldCols(cuts, srv.read, Object.assign(new Set(), { left: 1 })).size, 0)
})
await t('BLOCKER 2: a waived cap is never held, so its column\'s cuts are never held for good', () => {
  const srv = server({ [`0,${G},0`]: 'cobblestone' })
  const cells = [{ at: [0, G, 0], role: 'topsoil', retop: 1, grade: true }]
  assert.strictEqual(TT.retopHeld(cells, srv.read, 0).size, 1)
  assert.strictEqual(TT.retopHeld(cells, srv.read, 0, { waived: { [`0,${G},0`]: {} } }).size, 0)
})
console.log('CODEX T11 DELTA r2')
await t('BLOCKER 1: the visit bills the dirt its held cap-less columns wait on (never a wait on dirt it never asked for)', () => {
  const srv = server({ [`0,${G + 3},0`]: 'grass_block', [`0,${G + 2},0`]: 'stone', [`0,${G + 1},0`]: 'stone' })
  const cuts = [G + 3, G + 2, G + 1].map(y => ({ at: [0, y, 0], grade: true }))
  assert.strictEqual(GT.exposeDirtNeed(cuts, srv.read, []), 1)
  srv.set([0, G, 0], 'cobblestone')
  assert.strictEqual(GT.exposeDirtNeed(cuts, srv.read, [{ at: [0, G, 0], role: 'topsoil', retop: 1 }]), 0, 'a column with its own cap is billed as topsoil already')
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  assert.ok(/const ne = exposeDirtNeed\(tidyCuts\(rec, read, mem\), read, visitRec\.cells, rec\.waived\); exposeNeed = ne; if \(ne > 0\) extra\.dirt = \(extra\.dirt \?\? 0\) \+ Math\.min\(ne, TIDY_VISIT_FILLS\)/.test(strip(readFileSync(P('skills.mjs'), 'utf8'))))
})
await t('BLOCKER 2: a column whose cap is waived is held whatever the dirt, and the refresh takes its cuts off (nothing exposed, no wait for good)', () => {
  const srv = server({ [`0,${G + 1},0`]: 'grass_block', [`0,${G},0`]: 'cobblestone' })
  const cells = [{ at: [0, G, 0], role: 'topsoil', retop: 1, grade: true }]
  const waived = { [`0,${G},0`]: {} }
  const cuts = [{ at: [0, G + 1, 0], grade: true }]
  const rich = Object.assign(new Set(), { left: 9 })
  assert.ok(GT.capHeldCols(cuts, srv.read, rich, cells, waived).has('0,0'))
  assert.strictEqual(GT.gradeCutsHeld(cuts, srv.read, GT.capHeldCols(cuts, srv.read, rich, cells, waived)).size, 1)
  const r = GT.dropOrphanCuts({ cells, cut: cuts, waived })
  assert.strictEqual(r.dropped, 1); assert.deepStrictEqual(r.rec.cut, [])
  assert.strictEqual(GT.dropOrphanCuts({ cells, cut: cuts, waived: {} }).dropped, 0)
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  assert.ok(/cur = stale\.rec\n\s*\{ const oc = dropOrphanCuts\(cur, \{ standing: q => cutStanding\(read, q, now\) \}\); cur = oc\.rec \}/.test(strip(readFileSync(P('skills.mjs'), 'utf8'))))
})
console.log('CODEX T11 DELTA r3')
await t('BLOCKER 2: a cap already laid (earth there now) does not exempt the column\'s remaining stone-exposing cuts', () => {
  const srv = server({ [`0,${G + 3},0`]: 'grass_block', [`0,${G + 2},0`]: 'stone', [`0,${G + 1},0`]: 'air', [`0,${G},0`]: 'dirt' })
  const cells = [{ at: [0, G, 0], role: 'topsoil', retop: 1, grade: true }]
  const cuts = [{ at: [0, G + 3, 0], grade: true }, { at: [0, G + 2, 0], grade: true }]
  assert.ok(GT.capHeldCols(cuts, srv.read, Object.assign(new Set(), { left: 0 }), cells).has('0,0'))
  srv.set([0, G, 0], 'cobblestone')   // control: a cap still to lay is the column's own (it holds through retopHeld)
  assert.ok(!GT.capHeldCols(cuts, srv.read, Object.assign(new Set(), { left: 0 }), cells).has('0,0'))
})
await t('BLOCKER 1: with only held cuts left (no workable segment) the visit still draws their dirt (comments stripped)', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  assert.ok(/\}\s*else if \(exposeNeed > 0 && \(need\.dirt \?\? 0\) > 0\) \{ const w2 = await matsWithdraw\(ctx, \{ dirt: need\.dirt \}, signal,/.test(strip(readFileSync(P('skills.mjs'), 'utf8'))))
})
console.log('CODEX T11 DELTA r4')
await t('the live check at the dig: a grade cut that would leave stone on top is dug only with a dirt in the bag now', () => {
  const srv = server({ [`0,${G + 2},0`]: 'grass_block', [`0,${G + 1},0`]: 'stone', [`1,${G + 1},0`]: 'dirt' })
  const q = { at: [0, G + 2, 0], grade: true }
  assert.strictEqual(GT.gradeCutOk(q, srv.read, () => false), false)
  assert.strictEqual(GT.gradeCutOk(q, srv.read, n => n === 'dirt'), true)
  assert.strictEqual(GT.gradeCutOk({ at: [1, G + 2, 0], grade: true }, srv.read, () => false), true, 'earth below: yes')
  assert.strictEqual(GT.gradeCutOk({ at: [0, G + 2, 0] }, srv.read, () => false), true, 'not the grade\'s: as before')
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  assert.ok(/&& gradeCutOk\(q, rd, n => !!effects\?\.has\?\.\(n\)\) && handedBare\(q, rd\) \} : \{\}\),/.test(strip(readFileSync(P('skills.mjs'), 'utf8'))), 'wired into tidyOk')
})
await t('Codex T11 delta r5: an air gap under the cut is looked through -- the block left on top is the first solid below it', () => {
  const srv = server({ [`0,${G + 3},0`]: 'grass_block', [`0,${G + 2},0`]: 'air', [`0,${G + 1},0`]: 'stone' })
  const q = { at: [0, G + 3, 0], grade: true }
  assert.strictEqual(GT.topUnder(srv.read, q.at), 'stone')
  assert.strictEqual(GT.gradeCutOk(q, srv.read, () => false), false)
  assert.ok(GT.capHeldCols([q], srv.read, Object.assign(new Set(), { left: 0 })).has('0,0'))
  assert.strictEqual(GT.gradeCutsHeld([q], srv.read, new Set(['0,0'])).size, 1)
})
await t('Codex T11 delta r6: a gap deeper than the scan reads unknown (held), never air', () => {
  const srv = server()
  for (let y = G; y <= G + 40; y++) srv.set([0, y, 0], 'air')
  srv.set([0, G + 41, 0], 'cobblestone')
  assert.strictEqual(GT.topUnder(srv.read, [0, G + 41, 0]), 'unknown')
  assert.strictEqual(GT.gradeCutOk({ at: [0, G + 41, 0], grade: true }, srv.read, () => false), false)
})
console.log('CONTROL 11-18 (ff935d4e2) DECISION 2: LAWN SWAPS PAUSED WHILE A GATE IS SET')
await t('the survey plans no new lawn swap while a gate is set; without a gate it does (positive control)', () => {
  const srv = server({ [`-10,${G},-10`]: 'cobblestone' })
  const swaps = rec => (rec?.cells ?? []).filter(c => c.role === 'topsoil' && !c.grade && (rec.cut ?? []).some(q => q.at.join(',') === c.at.join(','))).length
  const { rec: r0 } = site(srv, null)
  assert.ok(swaps(r0) >= 1, 'control: the rough survey swaps a cobblestone top in a lawn')
  const g = GT.gradeTarget(plan({ gate: [[5, 5]] }))
  const { rec: r1 } = site(srv, { t: g.t })
  assert.strictEqual(swaps(r1), 0)
})
await t('lawnSwapKeys: a non-grade topsoil cell with a cut on the same cell; never a grade cell or a re-top', () => {
  const rec = { cells: [{ at: [1, G, 1], role: 'topsoil' }, { at: [2, G, 1], role: 'topsoil', grade: true }, { at: [3, G, 1], role: 'topsoil', retop: 1 }, { at: [4, G, 1], role: 'topsoil' }],
    cut: [{ at: [1, G, 1] }, { at: [2, G, 1], grade: true }, { at: [3, G, 1] }] }
  assert.deepStrictEqual([...GT.lawnSwapKeys(rec)], [`1,${G},1`])
  const sv = { fill: [{ at: [1, G, 1], pit: 'rt0f' }, { at: [9, G, 9], pit: 'p3' }], cut: [{ at: [1, G, 1], pillar: 'rt0' }, { at: [8, G, 8], pillar: 'p1' }], pits: [{ id: 'rt0f' }, { id: 'p3' }], pillars: [{ id: 'rt0', kind: 'topsoil' }, { id: 'p1' }] }
  const d = GT.dropLawnSwaps(sv)
  assert.deepStrictEqual([d.fill.length, d.cut.length, d.pits.length, d.pillars.length], [1, 1, 1, 1])
})
await t('WIRED (comments stripped): the visit passes the record\'s lawn swaps while a gate is set (cells and cuts)', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const sk = strip(readFileSync(P('skills.mjs'), 'utf8'))
  assert.ok(/const lawnPaused = gradeOn\(\) && gradeNow\(bot\)\?\.t \? lawnSwapKeys\(rec, q => cutStanding\(read, q\)\) : new Set\(\)\n\s*const retopPass = tidyTopOn\(\) \? retopHeld\(lawnPaused\.size \? visitRec\.cells\.filter\(q => !lawnPaused\.has\(q\.at\.join\(','\)\)\) : visitRec\.cells,[^\n]*\n\s*for \(const k of lawnPaused\) retopPass\.add\(k\)/.test(sk), 'paused swaps never charged against the dirt')
  assert.ok(/for \(const k of lawnPaused\) cutHeld\.add\(k\)/.test(sk))
  assert.ok(/if \(gw\) Object\.assign\(sv0, dropLawnSwaps\(sv0\)\)/.test(strip(readFileSync(P('tidy.mjs'), 'utf8'))))
})
await t('Codex T11 new r1: a swap whose cut is already dug out is not paused (its hole is filled)', () => {
  const rec = { cells: [{ at: [1, G, 1], role: 'topsoil' }], cut: [{ at: [1, G, 1] }] }
  assert.strictEqual(GT.lawnSwapKeys(rec, () => true).size, 1)
  assert.strictEqual(GT.lawnSwapKeys(rec, () => false).size, 0)
})
console.log('T11C-01show (a): A CUT AND ITS CAP ARE ONE UNIT')
const pairWorld = () => server({ [`5,${G + 1},5`]: 'grass_block', [`5,${G},5`]: 'cobblestone' })
const pairVisit = async ({ dirt = 4, deadline = Infinity, domain = () => true } = {}) => {
  const srv = pairWorld()
  const g = GT.gradeTarget(plan({ gate: [[5, 5]] }))
  const { rec } = site(srv, { t: g.t })
  const cuts = GT.pairCuts(rec.cut, rec.cells, srv.read)
  const inv = { stone_pickaxe: 1, ...(dirt ? { dirt } : {}) }
  const digDrops = async (c, expect) => { const n = srv.read(...c)?.name; if (expect && n !== expect) return 'refused'; srv.set(c, 'air'); inv[n] = (inv[n] ?? 0) + 1; return 'confirmed' }
  const e = bot(srv, 'A', { inv, feet: [6, G + 1, 3], dig: digDrops })
  const { p } = project(rec)
  // no segment work: only the clear pass (alsoDone passes every cell), so the cap can only come from the pair
  const r = await R.runVisit({ ...p('A'), palette: T.TIDY_PALETTE, tidy: cuts, alsoDone: () => true, blockLayer: false, domain, walkR: 30 }, e, { maxSteps: 100, deadline })
  return { cuts, col: [G + 1, G].map(y => srv.read(5, y, 5).name), r, logs: e.logs }
}
await t('pairCuts marks the lowest stone-exposing grade cut with its cap; an earth-exposing one is left as it is', () => {
  const srv = pairWorld()
  const cells = [{ at: [5, G, 5], role: 'topsoil', grade: true, seg: 'S', retop: 1 }]
  assert.deepStrictEqual(GT.pairCuts([{ at: [5, G + 1, 5], grade: true }], cells, srv.read)[0].cap, [5, G, 5])
  srv.set([5, G, 5], 'dirt')
  assert.ok(!GT.pairCuts([{ at: [5, G + 1, 5], grade: true }], cells, srv.read)[0].cap)
})
// t11reach2-01show (rig run 28, e.g. 9,-31): grass cut at 70 over a 1-deep hollow (air at 69, the target) over grass at 68 -- the cut
// left the top at 68 (a step of 2 with each neighbour) and the hollow's fill came later or never. Now the cut and its fill are one unit
const hollowWorld = () => server({ [`5,${G + 1},5`]: 'grass_block', [`5,${G},5`]: 'air', [`5,${G - 1},5`]: 'grass_block' })
const hollowVisit = async ({ dirt = 4, PC = GT.pairCuts, RV = R.runVisit } = {}) => {
  const srv = hollowWorld()
  const rec = { cells: [{ at: [5, G, 5], role: 'topsoil', grade: true, seg: 'S', opener: [5, G + 1, 5] }], segments: [{ seg: 'S', deps: [] }],
    cut: [{ at: [5, G + 1, 5], kind: 'tidy', name: 'grass_block', grade: true, hollow: [[5, G, 5]] }], clear: [], waived: {} }
  const cuts = PC(rec.cut, rec.cells, srv.read)
  const inv = { stone_pickaxe: 1, ...(dirt ? { dirt } : {}) }
  const digDrops = async (c, expect) => { const n = srv.read(...c)?.name; if (expect && n !== expect) return 'refused'; srv.set(c, 'air'); const d = n === 'grass_block' ? 'dirt' : n; inv[d] = (inv[d] ?? 0) + 1; return 'confirmed' }
  const e = bot(srv, 'A', { inv, feet: [6, G + 1, 3], dig: digDrops })
  const { p } = project(rec)
  await RV({ ...p('A'), palette: T.TIDY_PALETTE, tidy: cuts, alsoDone: () => true, blockLayer: false, domain: () => true, walkR: 30 }, e, { maxSteps: 100 })
  return { cuts, col: [G + 1, G, G - 1].map(y => srv.read(5, y, 5).name), logs: e.logs }
}
const scenHollowPair = async PC => {
  const v = await hollowVisit({ PC })
  assert.ok(v.cuts[0].cap, 'the cut over the hollow is paired with the hollow\'s fill')
  assert.deepStrictEqual(v.col, ['air', 'dirt', 'grass_block'], 'the top ends AT the target, never below it')
}
await t('THE 70 -> 68 COLUMN: a grass cut over a 1-deep hollow over grass -> cut and fill in one pass; with no dirt, not cut at all', async () => {
  await scenHollowPair(GT.pairCuts)
  const none = await hollowVisit({ dirt: 0 })
  assert.deepStrictEqual(none.col, ['grass_block', 'air', 'grass_block'], 'the fill cannot be done: the cut waits (never a hole under the target)')
  assert.ok(none.logs.some(([, d]) => d?.op === 'pair_held' && d.why === 'no_material'))
})
await t('MUTANT KILLED: the pair judged by the first block under the cut again (the hollow over grass left unpaired)', async () => {
  await withMutant(P('gradetidy.mjs'), '    const n = nm(read(...cap.at))\n', '    const n = topUnder(read, q.at)\n', async M => {
    let died = null; try { await scenHollowPair(M.pairCuts) } catch (e) { died = e }
    assert.ok(died instanceof assert.AssertionError, `survived or died otherwise: ${died}`)
  })
})
await t('with dirt, time and a stand: the cut is dug and its cap laid in the same clear pass (no grey top left)', async () => {
  const v = await pairVisit()
  assert.ok(v.cuts[0].cap, 'paired')
  assert.deepStrictEqual(v.col, ['air', 'dirt'])
  assert.ok(v.logs.some(([k, d]) => k === '_build' && d.op === 'pair_cap' && d.result === 'placed'))
})
await t('the deadline case: too little time left for the pair -> the cut is not dug', async () => {
  const v = await pairVisit({ deadline: Date.now() + 5_000 })
  assert.deepStrictEqual(v.col, ['grass_block', 'cobblestone'])
  assert.ok(v.logs.some(([k, d]) => d?.op === 'pair_held' && d.why === 'no_time'))
})
await t('no spare dirt -> the cut is not dug', async () => {
  const v = await pairVisit({ dirt: 0 })
  assert.deepStrictEqual(v.col, ['grass_block', 'cobblestone'])
  assert.ok(v.logs.some(([k, d]) => d?.op === 'pair_held' && d.why === 'no_material'))
})
await t('the cap has no stand the placer would use (the same stepZ test) -> the cut is not dug', async () => {
  const v = await pairVisit({ domain: () => false })
  assert.deepStrictEqual(v.col, ['grass_block', 'cobblestone'])
  assert.ok(v.logs.some(([k, d]) => d?.op === 'pair_held' && d.why === 'no_stand'))
})
await t('pairHeldWhy: each reason in turn; the stand is asked last (its walk is the dear one)', () => {
  let asked = 0
  const stand = () => { asked++; return null }
  assert.strictEqual(R.pairHeldWhy({ block: null, left: 1e9, stand }), 'no_material')
  assert.strictEqual(R.pairHeldWhy({ block: 'dirt', left: 1, stand }), 'no_time')
  assert.strictEqual(asked, 0)
  assert.strictEqual(R.pairHeldWhy({ block: 'dirt', left: 1e9, stand }), 'no_stand')
  assert.strictEqual(R.pairHeldWhy({ block: 'dirt', left: 1e9, stand: () => ({}) }), null)
})
await t('MUTANT: without the pair check the cut is dug with no time for its cap (a grey top)', async () => {
  await withMutant(P('buildrun.mjs'), "          if (why) { (out.pairHeld ??= []).push(kOf(c.at)); e.log('_build', { op: 'pair_held', cell: c.at, block: c.name, why }); continue }\n", '', async M => {
    const srv = pairWorld()
    const g = GT.gradeTarget(plan({ gate: [[5, 5]] }))
    const { rec } = site(srv, { t: g.t })
    const e = bot(srv, 'A', { inv: { stone_pickaxe: 1, dirt: 4 }, feet: [6, G + 1, 3] })
    const { p } = project(rec)
    await M.runVisit({ ...p('A'), palette: T.TIDY_PALETTE, tidy: GT.pairCuts(rec.cut, rec.cells, srv.read), alsoDone: () => true, blockLayer: false, domain: () => false, walkR: 30 }, e, { maxSteps: 100 })
    assert.strictEqual(srv.read(5, G + 1, 5).name, 'air', 'the cut went')
  })
})
await t('Codex t11c r1: another bot holding the cap segment -> neither the cut nor the cap is dug', async () => {
  const srv = pairWorld()
  const g = GT.gradeTarget(plan({ gate: [[5, 5]] }))
  const { rec } = site(srv, { t: g.t })
  const cuts = GT.pairCuts(rec.cut, rec.cells, srv.read)
  const { p, dir, key } = project(rec)
  const PJ = await import('../src/buildproj.mjs')
  assert.ok(PJ.takeLease(dir, key, `seg-${cuts[0].capSeg}`, 'B', { now: Date.now() }).ok, 'B holds the cap segment')
  const e = bot(srv, 'A', { inv: { stone_pickaxe: 1, dirt: 4 }, feet: [6, G + 1, 3] })
  await R.runVisit({ ...p('A'), palette: T.TIDY_PALETTE, tidy: cuts, alsoDone: () => true, blockLayer: false, domain: () => true, walkR: 30 }, e, { maxSteps: 100 })
  assert.deepStrictEqual([G + 1, G].map(y => srv.read(5, y, 5).name), ['grass_block', 'cobblestone'])
  assert.ok(e.logs.some(([k, d]) => d?.op === 'pair_held' && d.why === 'lease'))
})
await t('Codex t11c r3: a cap holding a block the foreign rule never digs (a chest) -> neither cut nor cap is dug', async () => {
  const srv = pairWorld()
  const g = GT.gradeTarget(plan({ gate: [[5, 5]] }))
  const { rec } = site(srv, { t: g.t })
  const cuts = GT.pairCuts(rec.cut, rec.cells, srv.read)
  srv.set([5, G, 5], 'chest')   // placed after the survey
  const e = bot(srv, 'A', { inv: { stone_pickaxe: 1, dirt: 4 }, feet: [6, G + 1, 3] })
  const { p } = project(rec)
  await R.runVisit({ ...p('A'), palette: T.TIDY_PALETTE, tidy: cuts, alsoDone: () => true, blockLayer: false, domain: () => true, walkR: 30 }, e, { maxSteps: 100 })
  assert.deepStrictEqual([G + 1, G].map(y => srv.read(5, y, 5).name), ['grass_block', 'chest'])
  assert.ok(e.logs.some(([k, d]) => d?.op === 'pair_held' && d.why === 'cap_kept'))
})
const pairUnreachedCap = async (RR) => {
  // the cut's walk arrives, the cap dig's walk does not (rig run 19: 8,69,-32 `pair_cap result=dig_unreached`)
  const srv = pairWorld()
  const g = GT.gradeTarget(plan({ gate: [[5, 5]] }))
  const { rec } = site(srv, { t: g.t })
  const cuts = GT.pairCuts(rec.cut, rec.cells, srv.read)
  const inv = { stone_pickaxe: 1, dirt: 4 }
  // the cut digs; the cap's dig fails (in the rig the walk did not arrive; here the server refuses it -- the same branch: no cap laid)
  const drop = n => (n === 'grass_block' ? 'dirt' : n === 'stone' ? 'cobblestone' : n)   // vanilla: grass digs to dirt (Codex t11c r5)
  const digDrops = async (c, expect) => { const n = srv.read(...c)?.name; if (c[1] === G) return 'refused'; if (expect && n !== expect) return 'refused'; srv.set(c, 'air'); inv[drop(n)] = (inv[drop(n)] ?? 0) + 1; return 'confirmed' }
  const e = bot(srv, 'A', { inv, feet: [6, G + 1, 3], dig: digDrops })
  const { p } = project(rec)
  await RR.runVisit({ ...p('A'), palette: T.TIDY_PALETTE, tidy: cuts, alsoDone: () => true, blockLayer: false, domain: () => true, walkR: 30 }, e, { maxSteps: 100 })
  return { col: [G + 1, G].map(y => srv.read(5, y, 5).name), logs: e.logs }
}
await t('control (t11c 4d7bcbd18): pairHeldWhy asks for the cap\'s DIG stand (the digger\'s digStand) after its place stand', () => {
  assert.strictEqual(R.pairHeldWhy({ block: 'dirt', left: 1e9, stand: () => ({}), digStandOk: () => false }), 'no_dig_stand')
  assert.strictEqual(R.pairHeldWhy({ block: 'dirt', left: 1e9, stand: () => ({}), digStandOk: () => true }), null)
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  assert.ok(/digStandOk: \(\) => \{ const n = nm\(rd\(\.\.\.capC\.at\)\); return AIR\(n\) \|\| replaceableCell\(rd\(\.\.\.capC\.at\)\) \|\| !!digStand\(pairRead\(rd, \[c\.at\]\), capC\.at, nodes\) \}/.test(strip(readFileSync(P('buildrun.mjs'), 'utf8'))), 'wired with the digger\'s own test')
})
await t('MUTANT: without the dig-stand check a cap with no dig stand would pass the pre-check', async () => {
  await withMutant(P('buildrun.mjs'), "  if (!digStandOk()) return 'no_dig_stand'", '', M => assert.strictEqual(M.pairHeldWhy({ block: 'dirt', left: 1e9, stand: () => ({}), digStandOk: () => false }), null))
})
await t('the cap cannot be laid after the cut (its dig fails) -> the cut\'s own block goes back on top (no grey top left)', async () => {
  const v = await pairUnreachedCap(R)
  assert.deepStrictEqual(v.col, ['dirt', 'cobblestone'], 'the grass\'s own drop (dirt) is back over the stone')
  assert.deepStrictEqual(R.PUTBACK_ORDER('grass_block'), ['grass_block', 'dirt', 'cobblestone'])
  assert.ok(v.logs.some(([k, d]) => d?.op === 'pair_putback' && d.result === 'placed'))
})
await t('MUTANT: without the put-back the unreached cap leaves the stone on top', async () => {
  await withMutant(P('buildrun.mjs'), "            if (pv !== 'placed' && pv !== 'already') await putBack(c, pair)\n", '', async M => {
    const v = await pairUnreachedCap(M)
    assert.deepStrictEqual(v.col, ['air', 'cobblestone'])
  })
})
await t('Codex t11c r7: a re-top cap under a cut names its cut (never waived once the stone is exposed)', async () => {
  const srv = pairWorld()
  const w = GT.gradeColumn(srv.read, 5, 5, G, deps(srv.read))
  assert.deepStrictEqual(w.fill.find(f => f.retop).opener, [5, G + 1, 5])
  const rec = { cells: [{ at: [5, G, 5], role: 'topsoil', grade: true, retop: 1, opener: [5, G + 1, 5], seg: 'S' }], waived: {} }
  assert.strictEqual(T.gkWaivable(rec, [{ k: `5,${G},5` }]).length, 0)
  // a re-top with no cut above it (at height already) has no opener: as before
  const srv2 = server({ [`6,${G},5`]: 'cobblestone' })
  assert.ok(!GT.gradeColumn(srv2.read, 6, 5, G, deps(srv2.read)).fill[0].opener)
})
console.log('T11C-01show (b): ONE BAD CAP NEVER STARVES THE OTHERS')
await t('gradeFirst puts a grade segment with an unreached cell behind the other grade segments at once', () => {
  const rec = { segments: [{ seg: 'BAD', deps: [] }, { seg: 'G1', deps: [] }, { seg: 'G2', deps: [] }, { seg: 'X', deps: [] }],
    cells: [{ at: [1, G, 1], seg: 'BAD', grade: true }, { at: [2, G, 1], seg: 'G1', grade: true }, { at: [3, G, 1], seg: 'G2', grade: true }, { at: [4, G, 1], seg: 'X' }] }
  assert.deepStrictEqual(GT.gradeFirst(rec).segments.map(s => s.seg), ['BAD', 'G1', 'G2', 'X'])
  assert.deepStrictEqual(GT.gradeFirst(rec, () => true, new Set([`1,${G},1`])).segments.map(s => s.seg), ['G1', 'G2', 'BAD', 'X'])
  const m = GT.noteUnreached(new Map([['old', 0]]), [`1,${G},1`], 3_600_001)
  assert.deepStrictEqual([...m.keys()], [`1,${G},1`], 'an hour-old entry drops, the new one is kept')
})
await t('a visit reports the cell whose foreign dig could not be reached (buildrun out.unreached)', async () => {
  const srv = server({ [`5,${G},5`]: 'cobblestone' })
  const rec = { cells: [{ at: [5, G, 5], role: 'topsoil', seg: 'T' }], segments: [{ seg: 'T', after: [] }], cut: [], clear: [], replant: [] }
  const e = bot(srv, 'A', { inv: { stone_pickaxe: 1, dirt: 4 }, feet: [20, G + 1, 20] })
  e.walkTo = async () => false   // the walk never arrives: the dig ends `unreached` (digReachFrom)
  const { p } = project(rec)
  const r = await R.runVisit({ ...p('A'), palette: T.TIDY_PALETTE, blockLayer: false, domain: () => true, walkR: 30 }, e, { maxSteps: 40 })
  assert.ok((r.unreached ?? []).includes(`5,${G},5`), JSON.stringify(r.unreached ?? null) + ' ' + r.stop)
})
await t('Codex t11c r2: a segment waiting on a late one goes late with it (never ahead of what it waits on)', () => {
  const rec = { segments: [{ seg: 'LOW', deps: [] }, { seg: 'HIGH', deps: ['LOW'] }, { seg: 'G', deps: [] }],
    cells: [{ at: [1, G, 1], seg: 'LOW', grade: true }, { at: [1, G + 1, 1], seg: 'HIGH', grade: true }, { at: [2, G, 1], seg: 'G', grade: true }] }
  assert.deepStrictEqual(GT.gradeFirst(rec, () => true, new Set([`1,${G},1`])).segments.map(s => s.seg), ['G', 'LOW', 'HIGH'])
})
await t('Codex t11c r2 (structural, comments stripped): the cap lease is taken after every skip, right before the cut', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const src = strip(readFileSync(P('buildrun.mjs'), 'utf8'))
  const i = src.indexOf("const g = guard(); if (g) return g\n        tried++"), j = src.indexOf('const l = PJ.takeLease(dir, key, `seg-${pair.seg}`'), k = src.indexOf('v = await digNamed(c.at, c.name, held, nodes')
  assert.ok(i > 0 && j > i && k > j, 'guard, then the lease, then the cut')
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
  assert.ok(/setGradeSource\(\(\) => gradeNow\(activeMem\?\.bot \?\? null\)\)/.test(sk), 'the process\'s target source')
  assert.ok(/report = null, grade = gradeProvided\(\) \} = \{\}\) \{/.test(strip(readFileSync(P('tidy.mjs'), 'utf8'))), 'siteStage\'s default')
  assert.ok(/op: 'refreshed'[^\n]*\.\.\.\(s\?\.grade \? \{ grade_v: s\.grade\.v \} : \{\}\)/.test(sk), 'grade_v on the refresh row')
  assert.ok(/'grade_v', 'why'\], f\)/.test(strip(readFileSync(P('shop.mjs'), 'utf8'))), 'the row keeps the field')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
