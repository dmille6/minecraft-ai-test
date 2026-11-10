// TIDYREFRESH-01 (cleanup pass 2, 11-10): an OPEN inside-the-wall tidy record is surveyed again every hour and what the new survey
// finds is ADDED (never a column the record still works, a cell another project names, a cell the record names or waived); the rough
// cap pages over the work already planned; a cut a crew bot gave up is given up by the town (the record's waived list). Behaviour on
// buildfake's flat world (stone below G, grass at G) through tidy.mjs siteStage, plus anchored mutants.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, server } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const LP = await import('../src/landplan.mjs')
const RG = await import('../src/roughground.mjs')
const TR = await import('../src/tidyrefresh.mjs')
const { cellDone } = await import('../src/buildrun.mjs')

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
const ON = { ROUGH: 'on' }
const INWALL = LP.landStages().find(q => q.id === 'inwall')
const WALL = { ring: [-30, -30, 30, 30] }
const site = (srv, { busy = null, cells = new Set(), stageMod = T } = {}) => {
  const s = stageMod.siteStage(srv.read, { home: HOME, land: { seed: 1 }, stage: INWALL, env: ON, cells, terrace: { wall: WALL, records: [], climbs: [] }, planned: busy })
  return s.record ? T.coreFills(s.record) : null
}
const xyz = (...a) => a.join(',')
const cutK = r => (r?.cut ?? []).map(c => c.at.join(',')).sort()
const fillK = r => (r?.cells ?? []).map(c => c.at.join(',')).sort()
const done = srv => q => cellDone(srv.read(...q.at), T.TIDY_PALETTE, q.role)
const beam = (srv, x0, z, y = G + 4) => { for (const x of [x0, x0 + 1, x0 + 2]) srv.set([x, y, z], 'dirt') }
const hole = (srv, x, z) => { srv.set([x, G, z], 'air'); srv.set([x, G - 1, z], 'air') }

console.log('THE REFRESH (a): new mess on an open record')
await t('a beam made after the siting is added; the beam the record still works is not planned twice (busy), nothing is dropped', async () => {
  const srv = server()
  beam(srv, 5, 3)
  const r0 = site(srv)
  assert.deepStrictEqual(cutK(r0), [xyz(5, G + 4, 3), xyz(6, G + 4, 3), xyz(7, G + 4, 3)])
  beam(srv, -12, -9)                                   // the bots' mess after 04:47Z
  const busy = TR.openColumns(r0, srv.read, { done: done(srv) })
  const fresh = site(srv, { busy })
  const m = TR.refreshMerge(r0, fresh, { busy })
  assert.ok(m.rec, 'something added')
  assert.deepStrictEqual(cutK(m.rec), [...cutK(r0), xyz(-12, G + 4, -9), xyz(-11, G + 4, -9), xyz(-10, G + 4, -9)].sort())
  assert.strictEqual(m.added.cut, 3)
  assert.strictEqual(m.rec.cut.length, new Set(m.rec.cut.map(c => c.at.join(','))).size, 'no cut twice')
  // the control: without the refresh the record never learns of the second beam
  assert.ok(!cutK(r0).includes(xyz(-12, G + 4, -9)))
  // the mutant: a busy column admitted -> the old beam is planned twice (with no busy passed to the survey either)
  await withMutant(P('tidyrefresh.mjs'), "    if (busy.has(k)) { bad(e, 'busy'); continue }\n", '', async M => {
    const f2 = site(srv)                                // the survey without busy finds the old beam again
    const m2 = M.refreshMerge({ ...r0, cut: [] }, f2, { busy })
    assert.ok(cutK(m2.rec).includes(xyz(5, G + 4, 3)), 'mutant plans a busy column')
  })
})
await t('a new pit is added in its own segment group after the record\'s highest, its layers chained bottom-up', async () => {
  const srv = server()
  hole(srv, 4, 4)
  const r0 = site(srv)
  assert.ok(fillK(r0).length >= 2)
  hole(srv, -9, 7)
  const busy = TR.openColumns(r0, srv.read, { done: done(srv) })
  const m = TR.refreshMerge(r0, site(srv, { busy }), { busy })
  const added = m.rec.cells.filter(c => c.added)
  assert.deepStrictEqual(added.map(c => c.at.join(',')).sort(), [xyz(-9, G - 1, 7), xyz(-9, G, 7)].sort())
  const g0 = Math.max(...r0.cells.map(c => Number(/^T-(\d+)-/.exec(c.seg)[1])))
  for (const c of added) assert.ok(Number(/^T-(\d+)-/.exec(c.seg)[1]) > g0, `new group ${c.seg} after ${g0}`)
  const lower = added.find(c => c.at[1] === G - 1), upper = added.find(c => c.at[1] === G)
  const seg = m.rec.segments.find(s => s.seg === upper.seg)
  assert.deepStrictEqual(seg.deps, [lower.seg], 'the upper layer waits on the lower')
  assert.ok(m.rec.segments.some(s => s.seg === lower.seg && !s.deps.length))
  assert.strictEqual(m.rec.bom.earth, r0.bom.earth + 2)
})
await t('never a cell another project names now (guarded), never one the record waived (known): those columns wait', async () => {
  const srv = server()
  beam(srv, 5, 3)
  const r0 = { ...site(srv), waived: {} }
  beam(srv, -12, -9); beam(srv, 10, -14)
  const busy = TR.openColumns(r0, srv.read, { done: done(srv) })
  const fresh = site(srv, { busy })
  const guard = new Set([xyz(-11, G + 4, -9)])
  const r1 = { ...r0, waived: { [xyz(10, G + 4, -14)]: { why: 'cut_given_up' } } }
  const m = TR.refreshMerge(r1, fresh, { busy, guard })
  assert.ok(!cutK(m.rec ?? r1).some(k => k.endsWith(`,-9`) && k.startsWith('-11')), 'the guarded cell is never added')
  assert.ok(!(m.rec?.cut ?? []).some(c => c.added && c.at[2] === -14 && c.at[0] === 10), 'a waived cut is never re-added on this record')
  assert.ok(m.skipped.guarded >= 1 && m.skipped.known >= 1, JSON.stringify(m.skipped))
  await withMutant(P('tidyrefresh.mjs'), "      if (guard.has(key)) { bad(e, 'guarded'); break }\n", '', async M => {
    const m2 = M.refreshMerge(r1, fresh, { busy, guard })
    assert.ok(m2.rec.cut.some(c => c.at.join(',') === xyz(-11, G + 4, -9)), 'mutant takes another project\'s cell')
  })
})
await t('a stand, a plot levelling cell and a split crust/hollow are never added (their bookkeeping rides on the siting)', async () => {
  const cur = { blueprint: 'tidy@1', stageId: 'inwall', home: HOME, cells: [], cut: [], clear: [], segments: [], bom: { earth: 0 } }
  const fresh = {
    cut: [{ at: [1, 80, 1], name: 'dirt', teardown: true }, { at: [2, 75, 2], name: 'dirt', hollow: [[2, 73, 2], [3, 73, 2]] }, { at: [6, 75, 6], name: 'dirt' }],
    cells: [{ at: [9, 70, 9], role: 'access', seg: 'T-00-0' }, { at: [2, 73, 2], role: 'earth', seg: 'T-01-0', opener: [2, 75, 2] }, { at: [3, 73, 2], role: 'earth', seg: 'T-01-0', opener: [2, 75, 2] }],
    clear: [], segments: [{ seg: 'T-00-0', deps: [] }, { seg: 'T-01-0', deps: [] }],
  }
  const m = TR.refreshMerge(cur, fresh, { busy: new Set(['3,2']) })
  assert.deepStrictEqual(cutK(m.rec), ['6,75,6'], JSON.stringify(m.skipped))
  assert.deepStrictEqual(fillK(m.rec), [])
  assert.ok(m.skipped.stand_or_plot >= 2 && m.skipped.hollow_split >= 2, JSON.stringify(m.skipped))
  // with the hollow's other column free, the crust and its hollow go in together
  const m2 = TR.refreshMerge(cur, fresh, {})
  assert.deepStrictEqual(cutK(m2.rec), ['2,75,2', '6,75,6'])
  assert.deepStrictEqual(fillK(m2.rec), ['2,73,2', '3,73,2'])
})
await t('at most addMax entries a refresh, nearest home first, whole columns', async () => {
  const cur = { blueprint: 'tidy@1', stageId: 'inwall', home: HOME, cells: [], cut: [], clear: [], segments: [] }
  const fresh = { cut: [{ at: [20, 80, 0], name: 'dirt' }, { at: [2, 80, 0], name: 'dirt' }, { at: [2, 79, 0], name: 'dirt' }, { at: [10, 80, 0], name: 'dirt' }], cells: [], segments: [] }
  const m = TR.refreshMerge(cur, fresh, { T: { ...TR.TIDYREFRESH, addMax: 3 } })
  assert.deepStrictEqual(cutK(m.rec), ['10,80,0', '2,79,0', '2,80,0'])
  assert.strictEqual(m.skipped.add_max, 1)
})

console.log('THE CLOCK')
await t('refreshDue: an open inwall record an hour after its siting or last refresh; never complete, never another stage, never off', async () => {
  const H = 60 * 60_000, now = 1_800_000_000_000
  const rec = { blueprint: 'tidy@1', stageId: 'inwall', structure_complete: false, sitedAt: now - H }
  assert.strictEqual(TR.refreshDue(rec, { now, env: {} }), true)
  assert.strictEqual(TR.refreshDue({ ...rec, sitedAt: now - H + 60_000 }, { now, env: {} }), false)
  assert.strictEqual(TR.refreshDue({ ...rec, refreshAt: now - 10 * 60_000 }, { now, env: {} }), false)
  assert.strictEqual(TR.refreshDue({ ...rec, refreshAt: now - 2 * H }, { now, env: {} }), true)
  assert.strictEqual(TR.refreshDue({ ...rec, structure_complete: true }, { now, env: {} }), false)
  assert.strictEqual(TR.refreshDue({ ...rec, stageId: 'terrace' }, { now, env: {} }), false)
  assert.strictEqual(TR.refreshDue(rec, { now, env: { TIDYREFRESH: 'off' } }), false)
  assert.strictEqual(TR.refreshDue({ ...rec, sitedAt: now + 5 * 60_000 }, { now, env: {} }), false, 'a future clock')
  assert.strictEqual(TR.refreshStamp(rec, { now }).refreshAt, now)
})
await t('the inside-the-wall clock counts a refresh: the band after a refreshed record is not sent back inside at once', async () => {
  const H = 60 * 60_000, now = 1_800_000_000_000
  const inK = INWALL.k
  const rec = { stageId: 'inwall', sitedAt: now - 30 * H, refreshAt: now - 10 * 60_000 }
  assert.strictEqual(RG.inwallAtOf(rec), now - 10 * 60_000)
  assert.strictEqual(RG.inwallFirst({ rec, nextK: inK + 1, inwallK: inK, now, env: {} }), false)
  assert.strictEqual(RG.inwallFirst({ rec: { ...rec, refreshAt: undefined }, nextK: inK + 1, inwallK: inK, now, env: {} }), true, 'control: by the siting alone')
  await withMutant(P('roughground.mjs'), "(Math.max(Number(rec?.sitedAt) || 0, Number(rec?.refreshAt) || 0) || null)", "(Number(rec?.sitedAt) || null)", async M => {
    assert.strictEqual(M.inwallFirst({ rec, nextK: inK + 1, inwallK: inK, now, env: {} }), true, 'mutant ignores the refresh')
  })
})

console.log('THE CAP PAGES (c)')
await t('a survey past the cap takes the next page when the planned columns are busy (nearest home first)', async () => {
  const srv = server()
  for (const [x, z] of [[3, 0], [6, 0], [12, 0]]) srv.set([x, G + 4, z], 'dirt')
  const col = (x, z) => T.tidyColumn(srv.read, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 })
  const run = busy => RG.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col, spoil: T.SPOIL, yLo: HOME.y - 14, busy, T: { ...RG.ROUGH, cap: 2, regrade: false } })
  const p1 = run(new Set())
  assert.deepStrictEqual(p1.cut.map(c => c.at.join(',')).sort(), [xyz(3, G + 4, 0), xyz(6, G + 4, 0)])
  assert.strictEqual(p1.skipped.cap, 1)
  const p2 = run(new Set(['3,0', '6,0']))
  assert.deepStrictEqual(p2.cut.map(c => c.at.join(',')), [xyz(12, G + 4, 0)], 'the next page')
})
await t('siteStage passes `planned` to the rough survey: a busy column is not planned again', async () => {
  const srv = server()
  srv.set([-7, G + 4, 5], 'dirt'); srv.set([9, G + 4, -5], 'dirt')
  assert.deepStrictEqual(cutK(site(srv)), [xyz(-7, G + 4, 5), xyz(9, G + 4, -5)])
  assert.deepStrictEqual(cutK(site(srv, { busy: new Set(['-7,5']) })), [xyz(9, G + 4, -5)])
  await withMutant(P('tidy.mjs'), '      for (const k of planned ?? []) busyR.add(k)\n', '', async M => {
    assert.deepStrictEqual(cutK(site(srv, { busy: new Set(['-7,5']), stageMod: M })), [xyz(-7, G + 4, 5), xyz(9, G + 4, -5)], 'mutant plans it again')
  })
})

console.log('THE TOWN GIVES A CUT UP (b)')
await t('a cut this bot gave up that still stands is named for the town, with the hollow fills it would open; a dug or unread one never', async () => {
  const srv = server()
  srv.set([4, G + 2, 4], 'dirt'); srv.set([5, G + 2, 4], 'dirt')
  const rec = { cut: [{ at: [4, G + 2, 4], name: 'dirt' }, { at: [5, G + 2, 4], name: 'dirt' }, { at: [6, G + 2, 4], name: 'dirt' }, { at: [900, G, 900], name: 'dirt' }],
    cells: [{ at: [4, G + 1, 4], role: 'earth', opener: [4, G + 2, 4] }, { at: [5, G + 1, 4], role: 'earth', opener: [5, G + 2, 4] }], waived: { [xyz(5, G + 2, 4)]: { why: 'x' } } }
  const given = new Set([xyz(4, G + 2, 4), xyz(5, G + 2, 4), xyz(6, G + 2, 4), xyz(900, G, 900)])
  const read = (x, y, z) => (x === 900 ? null : srv.read(x, y, z))
  const g = TR.cutGiveUps(rec, read, { given: k => given.has(k) })
  assert.deepStrictEqual(g.map(d => d.k), [xyz(4, G + 2, 4), xyz(4, G + 1, 4)], JSON.stringify(g))
  assert.match(g[0].why, /next inside-the-wall survey plans it again/, 'the remedy is named')
  assert.deepStrictEqual(TR.cutGiveUps(rec, read, { given: () => false }), [], 'a cut this bot did not give up stays')
})
await t('composed: once the town names the cut, the progress another keeper reads has no cut left (the stage can complete)', async () => {
  const srv = server()
  srv.set([4, G + 2, 4], 'dirt')
  const rec = { cut: [{ at: [4, G + 2, 4], name: 'dirt' }], cells: [], waived: {} }
  const otherKeeper = new Map()   // its own memory: never tried the cut
  const prog = r => T.tidyProgress(r, srv.read, { fillDone: () => true, given: k => T.tidyGivenUp(otherKeeper, k) || TR.cutWaived(r, k) })
  assert.strictEqual(prog(rec).cutLeft, 1, 'before: the other keeper still waits on it')
  const mine = new Map([[xyz(4, G + 2, 4), T.TIDY_CUT_TRIES]])
  const w = Object.fromEntries(TR.cutGiveUps(rec, srv.read, { given: k => T.tidyGivenUp(mine, k) }).map(d => [d.k, { why: d.why }]))
  assert.strictEqual(prog({ ...rec, waived: w }).cutLeft, 0)
  // and the refresh never puts it back on this record
  const m = TR.refreshMerge({ ...rec, waived: w, home: HOME, segments: [] }, { cut: [{ at: [4, G + 2, 4], name: 'dirt' }], cells: [], segments: [] }, {})
  assert.strictEqual(m.rec, null)
})

console.log('WIRING (skills.mjs: structural, comments stripped)')
await t('the keeper refreshes an open record, the visit drops and the completion counts the town\'s given-up cuts, the give-up is published', async () => {
  const src = readFileSync(P('skills.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
  assert.ok(/if \(GROUNDS\.on && LANDP\.on && caps\.site && rh\.head && refreshDue\(rh\.head\.rec\)\) \{\s*const r2 = await tidyRefresh\(/.test(src), 'the refresh call')
  assert.ok(src.includes('guardNow(q.at[0], q.at[2])) && !(TRF_ON && GROUNDS.on && cutWaived(rec, q.at.join(\',\'))))'), 'the visit\'s cut list')
  assert.ok(src.includes('Number(k.split(\',\')[2]))) || (TRF_ON && GROUNDS.on && cutWaived(rw, k)) }'), 'the completion\'s given')
  assert.ok(/const gu = cutGiveUps\(rw, read2, \{ given: k => tidyGivenUp\(mem, k\) \}\)/.test(src), 'the give-up')
  assert.ok(/s = await siteStage\(read, \{[^}]*planned: busy \}\)/.test(src), 'the refresh passes its open columns')
  // each anchor fails on its mutant (the clause removed): the assertions read the executable line, not a comment
  const mut = (a, b) => { assert.strictEqual(src.split(a).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${a.slice(0, 50)}`); return src.replace(a, b) }
  assert.ok(!/refreshDue\(rh\.head\.rec\)\) \{\s*const r2 = await tidyRefresh\(/.test(mut('&& refreshDue(rh.head.rec)) {', '&& false) {')))
  assert.ok(!mut(' && !(TRF_ON && GROUNDS.on && cutWaived(rec, q.at.join(\',\'))))', ')').includes('guardNow(q.at[0], q.at[2])) && !(TRF_ON && GROUNDS.on && cutWaived(rec, q.at.join(\',\'))))'))
  assert.ok(!mut(' || (TRF_ON && GROUNDS.on && cutWaived(rw, k)) }', ' }').includes('Number(k.split(\',\')[2]))) || (TRF_ON && GROUNDS.on && cutWaived(rw, k)) }'))
  assert.ok(!/s = await siteStage\(read, \{[^}]*planned: busy \}\)/.test(mut('forest: forestRecNow(), planned: busy })', 'forest: forestRecNow() })')))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
