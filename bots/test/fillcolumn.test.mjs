// FILLCOLUMN-01 (planvalid-01show, 11-15): no tidy fill is planned in mid-air. LIVE on the showcase: 52 of the 86 fill cells deferred
// in 3+ visits are air with no solid block below or beside them and no record cell under them -- the ground was dug from under a
// planned column after its survey, and the hourly refresh (tidyrefresh.mjs refreshMerge) never touches a column the record has.
// Behaviour on buildfake's flat world (stone below G, grass at G) through the REAL survey (tidy.mjs siteStage) and merge, the pure
// rules of fillcolumn.mjs, an independent walk of every plan (placing cells into an overlay), a property test, and anchored mutants.
import assert from 'node:assert'
import { readFileSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
const { G, HOME, server, rowSurvives, bot, PJ, R } = await import('./helpers/buildfake.mjs')
const { withMutant } = await import('./helpers/mutant.mjs')
const T = await import('../src/tidy.mjs')
const LP = await import('../src/landplan.mjs')
const TR = await import('../src/tidyrefresh.mjs')
const FC = await import('../src/fillcolumn.mjs')
const { cellDone } = await import('../src/buildrun.mjs')
const SHOP = await import('../src/shop.mjs')
const FC_URL = new URL('../src/fillcolumn.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; if (process.env.TEST_VERBOSE) console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e.stack ?? e).split('\n').slice(0, 3).join('\n        ').slice(0, 700)}`) }
}
const say = s => { if (process.env.TEST_VERBOSE) console.log(s) }
const NOTES = []   // the measured numbers: printed last (the runner shows a failing file's last 40 lines)
// a mutant is KILLED when the scenario that passes on the real module fails an ASSERTION on the mutant (never a crash)
const kills = (name, old, neu, scen) => t(`MUTANT KILLED: ${name}`, async () => {
  await withMutant(FC_URL, old, neu, async M => {
    let died = null
    try { await scen(M) } catch (e) { died = e }
    assert.ok(died, 'the mutant survived its scenario')
    assert.ok(died instanceof assert.AssertionError, `the mutant died of something else: ${died?.stack ?? died}`)
  })
})

const ENV = { ROUGH: 'on', REGRADE: 'off' }
const ON = { FILLCOLUMN: 'on' }, OFF = { FILLCOLUMN: 'off' }
const INWALL = LP.landStages().find(q => q.id === 'inwall')
const WALL = { ring: [-30, -30, 30, 30] }
const NOW = 1_700_000_000_000, HOUR = 60 * 60_000
const site = (srv, { busy = null } = {}) => {
  const s = T.siteStage(srv.read, { home: HOME, land: { seed: 1 }, stage: INWALL, env: ENV, cells: new Set(), terrace: { wall: WALL, records: [], climbs: [] }, planned: busy, now: NOW })
  return s.record ? T.coreFills(s.record) : null
}
const xyz = (...a) => a.join(',')
const keys = cells => (cells ?? []).map(c => (Array.isArray(c) ? c : c.at).join(',')).sort()
const fillK = r => keys(r?.cells)
const done = srv => q => cellDone(srv.read(...q.at), T.TIDY_PALETTE, q.role)
const air = (srv, x, y, z) => srv.set([x, y, z], 'air')
const dig = (srv, x, z, n, top = G) => { for (let y = top; y > top - n; y--) air(srv, x, y, z) }
const cell = (x, y, z, more = {}) => ({ at: [x, y, z], role: 'earth', seg: 'T-00-0', ...more })
const rec = (cells, more = {}) => ({ v: 1, blueprint: 'tidy@1', plot: 'tidy', stageId: 'inwall', home: { ...HOME }, sitedAt: NOW, cells, cut: [], clear: [],
  segments: [...new Set(cells.map(c => c.seg))].map(seg => ({ seg, deps: [] })), bom: { earth: cells.length }, structure_complete: false, ...more })
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]

// ---- THE INDEPENDENT WALK (never fillcolumn.mjs's own code): a cell is laid against a full block below it or beside it -- the
// world's, or a cell laid before it -- and never while a cell below it in its column is open ----
const solidW = (read, x, y, z) => { const b = read(x, y, z); return !b || (b.boundingBox === 'block' && !/^(water|lava)$/.test(b.name)) }
const sup = (read, placed) => (x, y, z) => placed.has(`${x},${y},${z}`) || solidW(read, x, y, z)
const hasSupport = (S, [x, y, z]) => S(x, y - 1, z) || S(x + 1, y, z) || S(x - 1, y, z) || S(x, y, z + 1) || S(x, y, z - 1)
/** Walk `order` over the open cells -> the cells never laid. Throws on a step that breaks a rule. */
function replay (order, open, read) {
  const left = new Map(open.map(c => [c.at.join(','), c.at])), placed = new Set(), S = sup(read, placed)
  for (const at of order) {
    const k = at.join(',')
    assert.ok(left.has(k), `the order names ${k}, which is not an open cell`)
    assert.ok(![...left.values()].some(a => a[0] === at[0] && a[2] === at[2] && a[1] < at[1]), `${k} is laid over an open cell of its own column`)
    assert.ok(hasSupport(S, at), `${k} is laid with no support under or beside it`)
    left.delete(k); placed.add(k)
  }
  return [...left.values()]
}
/** Lay whatever can be laid, again and again, until nothing can -> the keys left. */
function brute (open, read) {
  const left = new Map(open.map(c => [c.at.join(','), c.at])), placed = new Set(), S = sup(read, placed)
  for (let moved = true; moved;) {
    moved = false
    for (const [k, at] of [...left]) {
      if ([...left.values()].some(a => a[0] === at[0] && a[2] === at[2] && a[1] < at[1])) continue
      if (!hasSupport(S, at)) continue
      left.delete(k); placed.add(k); moved = true
    }
  }
  return [...left.keys()].sort()
}
/** THE CORE ASSERTION: the record's open fills walked bottom-up; planOrder's order obeys the rules and leaves exactly what an
 *  independent walk leaves. -> { order, leftK } */
function walk (r, srv, F = FC) {
  const open = F.openFills(r, { done: done(srv) })
  const po = F.planOrder(open, srv.read)
  const leftK = keys(po.left)
  assert.deepStrictEqual(keys(replay(po.order, open, srv.read)), leftK, 'the order leaves exactly `left`')
  assert.deepStrictEqual(brute(open, srv.read), leftK, 'an independent walk agrees on what no order reaches')
  assert.strictEqual(po.ok, leftK.length === 0)
  return { order: po.order, leftK, open }
}

// ---- THE SCENES ----
/** A 1x1 hole at (4,4), one deep, surveyed: the plan is one cell, 4,G,4. */
function holeScene () {
  const srv = server()
  air(srv, 4, G, 4)
  const r0 = site(srv)
  assert.deepStrictEqual(fillK(r0), [xyz(4, G, 4)], 'the survey plans the hole\'s one cell')
  return { srv, r0, seg: r0.cells[0].seg }
}
/** The bots dig after the survey: the 8 columns round (cx,cz) `ring` blocks down from the surface, the hole's floor `under` more
 *  (the first solid block is then `under + 1` below the planned cell). */
const dugRound = (srv, { ring = 1, under = 2, cx = 4, cz = 4 } = {}) => { for (const [dx, dz] of N8) dig(srv, cx + dx, cz + dz, ring); for (let i = 1; i <= under; i++) air(srv, cx, G - i, cz) }
/** One refresh as skills.mjs tidyRefresh makes it: the open columns, the survey, the merge, then the repair. */
function refresh (srv, cur, env, F = FC, opts = {}) {
  const d = done(srv)
  const busy = TR.openColumns(cur, srv.read, { done: d })
  const m = TR.refreshMerge(cur, site(srv, { busy }), { busy, now: NOW + HOUR })
  const { res, fx } = F.refreshRepair(m, cur, srv.read, { done: d, now: NOW + HOUR, ...opts }, env)
  return { m, res, fx, rec: res.rec ?? cur }
}

say('THE EXECUTABLE ORDER (planOrder)')
const scenControl = (F = FC) => {
  const { srv, r0 } = holeScene()
  const w = walk(r0, srv, F)
  assert.deepStrictEqual(w.leftK, [], 'a hole one deep: its cell stands on the floor')
  assert.deepStrictEqual(w.order, [[4, G, 4]])
  const fx = F.columnRepair(r0, srv.read, { done: done(srv), now: NOW })
  assert.strictEqual(fx.rec, null, 'nothing to repair: the record is not touched')
  assert.deepStrictEqual(fx.n, { ext: 0, add: 0, deep: 0, drop: 0, back: 0, left: 0, why: {} })
  // the refresh with the switch on and off: the very same result (the merge's own object)
  const a = refresh(srv, r0, ON, F), b = refresh(srv, r0, OFF, F)
  assert.strictEqual(a.res, a.m); assert.strictEqual(b.res, b.m)
  assert.deepStrictEqual(a.rec, b.rec)
  assert.deepStrictEqual(F.planSelfCheck(r0, srv.read, { done: done(srv), env: ON }), { open: 1, left: 0, first: null })
  assert.strictEqual(F.planSelfCheck(r0, srv.read, { done: done(srv), env: OFF }), null, 'off: no self-check')
}
await t('POSITIVE CONTROL a hole one deep: the plan is executable, the repair changes nothing, on and off agree', () => scenControl())
const scenOrder = (F = FC) => {
  // a 1x1 hole two deep with its walls standing, its cells handed over TOP FIRST: the order is still bottom-up
  const srv = server()
  dig(srv, 4, 4, 2)
  const r = rec([cell(4, G, 4), cell(4, G - 1, 4, { role: 'core' })])
  const w = walk(r, srv, F)
  assert.deepStrictEqual(w.order, [[4, G - 1, 4], [4, G, 4]])
  // a 3x3 hole one deep: the centre has no wall, it is laid against a cell laid before it
  const s2 = server()
  const cs = []
  for (let x = 3; x <= 5; x++) for (let z = 3; z <= 5; z++) { air(s2, x, G, z); cs.push(cell(x, G, z)) }
  air(s2, 4, G - 1, 4)   // ...even with the floor dug from under the centre: a side holds it (a lid: executable, as today)
  assert.deepStrictEqual(walk(rec(cs), s2, F).leftK, [])
  // NEGATIVE with its control: one cell in the air (nothing under, nothing beside) is left; a block under it and it is laid
  const s3 = server()
  const r3 = rec([cell(4, G + 3, 4)])
  assert.deepStrictEqual(walk(r3, s3, F).leftK, [xyz(4, G + 3, 4)])
  s3.set([4, G + 2, 4], 'dirt')
  assert.deepStrictEqual(walk(r3, s3, F).leftK, [])
  s3.set([4, G + 2, 4], 'air'); s3.set([5, G + 3, 4], 'cobblestone')
  assert.deepStrictEqual(walk(r3, s3, F).leftK, [], 'a block beside it holds it too')
  s3.set([5, G + 3, 4], 'water')
  assert.deepStrictEqual(walk(r3, s3, F).leftK, [xyz(4, G + 3, 4)], 'water is no support')
}
await t('bottom-up in a column whatever order the cells come in; a side holds a cell; a cell in the air is left (control: a block under it)', () => scenOrder())
const scenUnread = (F = FC) => {
  // an UNREAD cell is no evidence: with the cell under it unread, the cell is not called floating
  const srv = server()
  const r = rec([cell(4, G + 3, 4)])
  const blind = (x, y, z) => (x === 4 && y === G + 2 && z === 4 ? null : srv.read(x, y, z))
  assert.strictEqual(F.planOrder(F.openFills(r), blind).left.length, 0, 'unread under it: no negative')
  assert.strictEqual(F.planOrder(F.openFills(r), srv.read).left.length, 1, 'the control: read as air, it floats')
}
await t('an unread cell under a fill is no evidence: it is never called floating (control: the same cell read as air)', () => scenUnread())
const scenDone = (F = FC) => {
  // a cell already LAID is no plan any more: the repair never judges it (control: the same cell open, in the air, is left out)
  const srv = server()
  const r = rec([cell(4, G + 3, 4)])
  assert.strictEqual(F.columnRepair(r, srv.read, { done: done(srv), now: NOW }).n.drop, 1, 'the control: open and in the air')
  srv.set([4, G + 3, 4], 'dirt')
  const fx = F.columnRepair(r, srv.read, { done: done(srv), now: NOW })
  assert.strictEqual(fx.rec, null)
  assert.deepStrictEqual(fx.n, { ext: 0, add: 0, deep: 0, drop: 0, back: 0, left: 0, why: {} })
}
await t('a laid cell is never judged (control: the same cell open)', () => scenDone())

say('THE CAUSE AND THE REPAIR (a hole deepened between two refreshes)')
const scenBug = (F = FC) => {
  const { srv, r0, seg } = holeScene()
  // refresh 1, nothing dug: the record as it was, on and off
  assert.strictEqual(refresh(srv, r0, ON, F).rec, r0)
  assert.strictEqual(refresh(srv, r0, OFF, F).rec, r0)
  // the bots dig: the ground round the hole one down, the hole itself two more -- the first solid is 3 below the planned cell
  dugRound(srv, { ring: 1, under: 2 })
  // TODAY (the switch off): the survey FINDS the deeper hole, the merge refuses its column (the record still works it), and the
  // record keeps one cell in mid-air that no order of work can lay
  const off = refresh(srv, r0, OFF, F)
  assert.strictEqual(off.fx, null)
  assert.strictEqual(off.res, off.m, 'off: the merge\'s own result, untouched')
  assert.ok((off.m.skipped.busy ?? 0) >= 2, `the merge refused the deepened column (busy: ${JSON.stringify(off.m.skipped)})`)
  assert.deepStrictEqual(keys(off.rec.cells.filter(c => c.at[0] === 4 && c.at[2] === 4)), [xyz(4, G, 4)], 'the column is still its one cell')
  assert.deepStrictEqual(walk(off.rec, srv, F).leftK, [xyz(4, G, 4)], 'THE BUG: the planned cell floats, 3 over the floor, nothing beside it')
  assert.deepStrictEqual(F.planSelfCheck(off.rec, srv.read, { done: done(srv), env: ON }), { open: 1, left: 1, first: [4, G, 4] }, 'the self-check names it')
  // THE REPAIR (on): the column's missing lower cells are added from the floor up to the ground round it; the old top, which
  // would stand free above that ground, is left out
  const on = refresh(srv, r0, ON, F)
  assert.deepStrictEqual(on.m, off.m, 'the merge is the same')
  assert.deepStrictEqual(on.fx.n, { ext: 1, add: 2, deep: 0, drop: 1, back: 0, left: 0, why: { bare: 1 } })
  assert.deepStrictEqual(keys(on.fx.added), [xyz(4, G - 2, 4), xyz(4, G - 1, 4)])
  for (const c of on.fx.added) assert.deepStrictEqual({ role: c.role, seg: c.seg, ext: c.ext, added: c.added }, { role: 'core', seg, ext: true, added: NOW + HOUR })
  assert.strictEqual(on.rec.waived[xyz(4, G, 4)].why, 'fillcolumn:bare')
  assert.deepStrictEqual(on.fx.dropped, [{ k: xyz(4, G, 4), why: 'fillcolumn:bare' }])
  assert.strictEqual(on.rec.cells.length, r0.cells.length + 2)
  assert.strictEqual(on.rec.bom.earth, r0.bom.earth + 2)
  assert.ok(on.rec.segments.some(s => s.seg === seg), 'the added cells\' segment is the record\'s own')
  assert.strictEqual(r0.cells.length, 1); assert.strictEqual(r0.waived, undefined, 'the record given is never mutated')
  const w = walk(on.rec, srv, F)
  assert.deepStrictEqual(w.leftK, [], 'every planned cell can be laid')
  assert.deepStrictEqual(w.order, [[4, G - 2, 4], [4, G - 1, 4]], 'from the first solid block upward')
  assert.deepStrictEqual(F.planSelfCheck(on.rec, srv.read, { done: done(srv), env: ON }), { open: 2, left: 0, first: null })
  // the next refresh finds nothing more to repair (no cell added twice, no waiver twice)
  const again = F.columnRepair(on.rec, srv.read, { done: done(srv), now: NOW + 2 * HOUR })
  assert.strictEqual(again.rec, null)
  return { srv, rec: on.rec }
}
await t('a hole 3 deep under a planned top cell: off -> the cell floats (the merge refuses the column); on -> the lower cells are added, the plan is executable', () => { scenBug() })
const scenBack = (F = FC) => {
  // ...and the top comes BACK once the ground has come back round it (the pit round it filled since)
  const { srv, rec: r1 } = scenBug(F)
  srv.set([4, G - 2, 4], 'cobblestone'); srv.set([4, G - 1, 4], 'cobblestone')   // the visits laid the added cells
  const early = F.columnRepair(r1, srv.read, { done: done(srv), now: NOW + 2 * HOUR })
  assert.strictEqual(early.n.back, 0, 'the control: a block under it but nothing beside it yet -- it stays out')
  assert.strictEqual(early.rec, null)
  for (const [dx, dz] of N8) srv.set([4 + dx, G, 4 + dz], 'dirt')                  // the ring is filled again (a later survey's fills)
  const fx = F.columnRepair(r1, srv.read, { done: done(srv), now: NOW + 3 * HOUR })
  assert.strictEqual(fx.n.back, 1)
  assert.ok(!Object.prototype.hasOwnProperty.call(fx.rec.waived, xyz(4, G, 4)), 'its waiver is gone')
  assert.deepStrictEqual(walk(fx.rec, srv, F).order, [[4, G, 4]], 'and it is laid like any cell')
  assert.strictEqual(fx.n.drop, 0)
}
await t('a top left out comes back when the ground round it is back (control: not before)', () => { scenBack() })
const scenPillar = (F = FC) => {
  // the ground round the hole dug 9 down: a column raised to the old level would be a pillar in a pit -- nothing is added
  const { srv, r0 } = holeScene()
  dugRound(srv, { ring: 9, under: 2 })
  assert.deepStrictEqual(walk(r0, srv, F).leftK, [xyz(4, G, 4)])
  const fx = F.columnRepair(r0, srv.read, { done: done(srv), now: NOW })
  assert.deepStrictEqual(fx.n, { ext: 0, add: 0, deep: 0, drop: 1, back: 0, left: 0, why: { bare: 1 } })
  assert.strictEqual(fx.rec.cells.length, 1, 'no cell added: nothing would stand IN the ground')
  assert.deepStrictEqual(walk(fx.rec, srv, F).leftK, [])
}
await t('the ground round the column dug away too: no pillar is planned, the cell is left out (control: the test above adds two)', () => scenPillar())
const scenWide = (F = FC) => {
  // a 3x3 planned fill one deep; every floor dug 2 more and the ground round the nine dug one down: nine cells in the air.
  // The pit is filled from its floor to the ground round it (the centre's cells stand beside cells kept in the same repair)
  const srv = server()
  const cs = []
  for (let x = 3; x <= 5; x++) for (let z = 3; z <= 5; z++) { dig(srv, x, z, 3); cs.push(cell(x, G, z)) }
  for (let x = 2; x <= 6; x++) for (let z = 2; z <= 6; z++) if (x === 2 || x === 6 || z === 2 || z === 6) dig(srv, x, z, 1)
  const r0 = rec(cs)
  assert.strictEqual(walk(r0, srv, F).leftK.length, 9)
  const fx = F.columnRepair(r0, srv.read, { done: done(srv), now: NOW })
  assert.deepStrictEqual(fx.n, { ext: 9, add: 18, deep: 0, drop: 9, back: 0, left: 0, why: { bare: 9 } })
  assert.ok(keys(fx.added).includes(xyz(4, G - 2, 4)) && keys(fx.added).includes(xyz(4, G - 1, 4)), 'the centre column too')
  const w = walk(fx.rec, srv, F)
  assert.deepStrictEqual(w.leftK, [])
  assert.strictEqual(w.order.length, 18)
}
await t('a wide pit: every column filled from its floor to the ground round the pit; the old tops left out', () => scenWide())
const scenKeptTop = (F = FC) => {
  // a planned cell is KEPT when a cell kept beside it holds it: column A (4,4) one cell at G over a floor dug one down, open on
  // three sides; column B (5,4) one cell at G+1 over an unplanned gap at G that stands against (6,G,4)
  const srv = server()
  air(srv, 4, G, 4); air(srv, 4, G - 1, 4); air(srv, 3, G, 4); air(srv, 4, G, 3); air(srv, 4, G, 5); air(srv, 5, G, 4)
  const r0 = rec([cell(4, G, 4), cell(5, G + 1, 4, { seg: 'T-01-0' })])
  assert.deepStrictEqual(walk(r0, srv, F).leftK, [xyz(4, G, 4), xyz(5, G + 1, 4)])
  const fx = F.columnRepair(r0, srv.read, { done: done(srv), now: NOW })
  assert.deepStrictEqual(keys(fx.added), [xyz(4, G - 1, 4), xyz(5, G, 4)])
  assert.strictEqual(fx.added.find(c => c.at[0] === 5).seg, 'T-01-0', 'each added cell in its own column\'s segment')
  assert.deepStrictEqual(fx.dropped, [{ k: xyz(5, G + 1, 4), why: 'fillcolumn:bare' }])
  assert.ok(!fx.rec.waived[xyz(4, G, 4)], 'A\'s planned cell stays: B\'s added cell is beside it')
  assert.deepStrictEqual(walk(fx.rec, srv, F).leftK, [])
}
await t('a planned cell beside a cell the same repair adds is kept', () => scenKeptTop())

say('WHAT THE REPAIR RESPECTS')
const one = (F, mk, opts = {}) => { const { srv, r0 } = holeScene(); const o = mk(srv) ?? {}; return { srv, r0, fx: F.columnRepair(r0, srv.read, { done: done(srv), now: NOW, ...opts, ...o }) } }
const leftOut = (fx, why, extra = {}) => {
  assert.strictEqual(fx.n.add, 0, `${why}: nothing is added`)
  assert.deepStrictEqual(fx.dropped, [{ k: xyz(4, G, 4), why: `fillcolumn:${why}` }])
  assert.deepStrictEqual(fx.n.why, { [why]: 1 })
  assert.strictEqual(fx.n.deep, extra.deep ?? 0)
  assert.strictEqual(fx.rec.cells.length, 1)
}
const scenDeep = (F = FC) => {
  // the control: the floor 5 below the cell (4 missing cells: the cap) is filled; one deeper is a cavity, left out and counted
  const ok = one(F, srv => dugRound(srv, { ring: 1, under: 4 }))
  assert.deepStrictEqual(ok.fx.n, { ext: 1, add: 4, deep: 0, drop: 1, back: 0, left: 0, why: { bare: 1 } })
  assert.deepStrictEqual(walk(ok.fx.rec, ok.srv, F).leftK, [])
  const deep = one(F, srv => dugRound(srv, { ring: 1, under: 5 }))
  leftOut(deep.fx, 'deep', { deep: 1 })
  assert.deepStrictEqual(walk(deep.fx.rec, deep.srv, F).leftK, [], 'left out: nothing planned in mid-air')
}
await t('a hole deeper than the cap is left out and counted `deep` (control: a hole at the cap is filled, 4 cells)', () => scenDeep())
const scenColumnMax = (F = FC) => {
  // a column of three open cells (a hole 3 deep, planned whole) whose floor is dug: 3 + 3 missing = 6 is the most a column holds
  const mk = under => {
    const srv = server()
    dig(srv, 4, 4, 3 + under)
    for (const [dx, dz] of N8) dig(srv, 4 + dx, 4 + dz, 3)
    const r0 = rec([cell(4, G - 2, 4, { role: 'core' }), cell(4, G - 1, 4, { role: 'core' }), cell(4, G, 4)])
    return { srv, fx: F.columnRepair(r0, srv.read, { done: done(srv), now: NOW }) }
  }
  const ok = mk(3)
  assert.strictEqual(ok.fx.n.add, 3, 'the control: 3 open + 3 added = 6')
  assert.strictEqual(ok.fx.n.deep, 0)
  const over = mk(4)
  assert.strictEqual(over.fx.n.add, 0, '3 open + 4 missing: a mine, not a pit')
  assert.strictEqual(over.fx.n.deep, 1)
  assert.strictEqual(over.fx.rec.waived[xyz(4, G - 2, 4)].why, 'fillcolumn:deep')
  assert.deepStrictEqual(walk(over.fx.rec, over.srv, F).leftK, [], 'the cells above go in the following rounds')
}
await t('a column holds at most depthMax open cells in all (control: exactly depthMax is filled)', () => scenColumnMax())
const scenWater = (F = FC) => {
  const { fx, srv } = one(F, srv => { dugRound(srv, { ring: 1, under: 2 }); srv.set([4, G - 2, 4], 'water') })
  leftOut(fx, 'water')
  assert.strictEqual(srv.read(4, G - 2, 4).name, 'water')
  assert.deepStrictEqual(walk(fx.rec, srv, F).leftK, [])
}
await t('a hole over water: no cell is planned into the water, the cell is left out `water` (control: the dry hole above gets 2 cells)', () => scenWater())
const scenGuard = (F = FC) => {
  // an OPEN cell another record names in the hole (air now, theirs to build): never the tidy's
  leftOut(one(F, srv => dugRound(srv), { guard: new Set([xyz(4, G - 2, 4)]) }).fx, 'guarded')
  // a protected zone over the lower cells
  leftOut(one(F, srv => dugRound(srv), { mayAdd: q => !(q[0] === 4 && q[2] === 4 && q[1] <= G - 1) }).fx, 'guarded')
  // the control: another record's cell that is the hole's solid BOTTOM is a floor like any block -- the cells over it are added
  const ok = one(F, srv => dugRound(srv), { guard: new Set([xyz(4, G - 3, 4)]), mayAdd: q => q[1] > G - 3 })
  assert.strictEqual(ok.fx.n.add, 2)
  assert.ok(!keys(ok.fx.added).includes(xyz(4, G - 3, 4)))
}
await t('a hole whose lower cells are another record\'s, or in a protected zone: left out `guarded` (control: a solid bottom of another record is a floor)', () => scenGuard())
const scenReserved = (F = FC) => {
  const a = one(F, srv => dugRound(srv), { reserved: (x, z) => x === 4 && z === 4 })
  leftOut(a.fx, 'reserved')
  // a cell left out for a reservation never comes back on the ground's say-so (the test above: a `bare` cell does)
  a.srv.set([4, G - 1, 4], 'cobblestone'); a.srv.set([5, G, 4], 'dirt')
  assert.strictEqual(F.columnRepair(a.fx.rec, a.srv.read, { done: done(a.srv), now: NOW + HOUR, reserved: (x, z) => x === 4 && z === 4 }).n.back, 0)
  assert.strictEqual(F.columnRepair({ ...a.fx.rec, waived: { [xyz(4, G, 4)]: { why: 'fillcolumn:deep' } } }, a.srv.read, { done: done(a.srv), now: NOW + HOUR }).n.back, 1, 'the control: the same ground, a `deep` cell comes back')
  assert.strictEqual(one(F, srv => dugRound(srv), { reserved: (x, z) => x === 9 && z === 9 }).fx.n.add, 2, 'the control: a reservation elsewhere')
}
await t('a column in a reservation sited since: left out `reserved` (control: a reservation elsewhere)', () => scenReserved())
const scenUnreadBelow = (F = FC) => {
  const { srv, r0 } = holeScene()
  dugRound(srv)
  const blind = (x, y, z) => (x === 4 && y === G - 2 && z === 4 ? null : srv.read(x, y, z))
  const fx = F.columnRepair(r0, blind, { done: q => cellDone(blind(...q.at), T.TIDY_PALETTE, q.role), now: NOW })
  assert.strictEqual(fx.rec, null, 'an unread cell on the way down: no evidence, nothing changed')
  assert.deepStrictEqual(fx.n, { ext: 0, add: 0, deep: 0, drop: 0, back: 0, left: 1, why: {} })
}
await t('an unread cell on the way to the floor: the column waits for the next refresh (nothing added, nothing left out, counted `left`)', () => scenUnreadBelow())
const scenPage = (F = FC) => {
  const { srv, r0 } = holeScene()
  dugRound(srv)
  const full = F.columnRepair(r0, srv.read, { done: done(srv), now: NOW, T: { ...F.FILLCOLUMN, refreshMax: 1 } })
  assert.strictEqual(full.rec, null, 'the page is full: the column waits')
  assert.strictEqual(full.n.left, 1)
  assert.strictEqual(F.columnRepair(r0, srv.read, { done: done(srv), now: NOW, T: { ...F.FILLCOLUMN, refreshMax: 2 } }).n.add, 2, 'the control: room for both')
}
await t('at most refreshMax cells a refresh: a column that does not fit waits whole (control: it fits)', () => scenPage())
const scenSpecial = (F = FC) => {
  // a hollow under a crust cut (`opener`) and a plot's levelling (`plot`) keep their own bookkeeping: never repaired, never held
  for (const tag of [{ opener: [4, G + 1, 4] }, { plot: 'X1' }, { prep: 'p1' }, { floorFix: true }, { dam: true }]) {
    const srv = server()
    air(srv, 4, G, 4); dugRound(srv)
    const r = rec([cell(4, G, 4, tag)])
    assert.strictEqual(F.planSelfCheck(r, srv.read, { done: done(srv), env: ON }).left, 1, 'the self-check still counts it')
    assert.strictEqual(F.columnRepair(r, srv.read, { done: done(srv), now: NOW }).rec, null, `${JSON.stringify(tag)}: not the repair's`)
    assert.strictEqual(F.floatHold(r, srv.read, { done: done(srv), now: NOW + 1, env: ON }).size, 0)
  }
  // the control: the same cell untagged is repaired and held
  const srv = server(); air(srv, 4, G, 4); dugRound(srv)
  assert.ok(F.columnRepair(rec([cell(4, G, 4)]), srv.read, { done: done(srv), now: NOW }).rec)
  assert.strictEqual(F.floatHold(rec([cell(4, G, 4)]), srv.read, { done: done(srv), now: NOW + 1, env: ON }).size, 1)
  // nor a carried cell, a waived one, a cell another record names, a light
  for (const r of [rec([cell(4, G, 4, { prev: true })]), rec([cell(4, G, 4)], { waived: { [xyz(4, G, 4)]: { why: 'no_stand' } } }), rec([cell(4, G, 4, { role: 'light' })])]) assert.strictEqual(F.openFills(r).length, 0)
  assert.strictEqual(F.openFills(rec([cell(4, G, 4)]), { guard: new Set([xyz(4, G, 4)]) }).length, 0)
}
await t('a column with its own bookkeeping (a hollow under a cut, a plot, a prep, a floor repair, a dam) is never repaired or held (control: untagged)', () => scenSpecial())

say('THE WAIVER')
const scenWaivedBelow = (F = FC) => {
  // the record's own lower cell was WAIVED (counted done, no block): the cell above it floats -- it is left out, never extended
  const srv = server()
  dig(srv, 4, 4, 2)
  for (const [dx, dz] of N8) dig(srv, 4 + dx, 4 + dz, 1)
  const r0 = rec([cell(4, G - 1, 4, { role: 'core' }), cell(4, G, 4)], { waived: { [xyz(4, G - 1, 4)]: { why: 'no_stand', at: 1, by: 'A' } } })
  assert.deepStrictEqual(walk(r0, srv, F).leftK, [xyz(4, G, 4)])
  const fx = F.columnRepair(r0, srv.read, { done: done(srv), now: NOW })
  assert.deepStrictEqual(fx.n, { ext: 0, add: 0, deep: 0, drop: 1, back: 0, left: 0, why: { waived_below: 1 } })
  assert.strictEqual(fx.rec.waived[xyz(4, G - 1, 4)].why, 'no_stand', 'the old waiver is kept as it was')
  assert.strictEqual(fx.rec.cells.length, 2, 'a waived cell is never added again')
}
await t('a waived lower cell: the cell resting on it is left out `waived_below`, the waived cell is not planned again', () => scenWaivedBelow())
const scenWaiveRests = (F = FC) => {
  // the waiver is about to name the lower cell of a column: the cell above rests on it alone -> it goes in the same decision
  const srv = server()
  dig(srv, 4, 4, 2)
  for (const [dx, dz] of N8) dig(srv, 4 + dx, 4 + dz, 1)
  const r0 = rec([cell(4, G - 1, 4, { role: 'core' }), cell(4, G, 4)])
  assert.deepStrictEqual(walk(r0, srv, F).leftK, [], 'before the waiver the column is executable')
  const due = [{ k: xyz(4, G - 1, 4), why: 'no_stand' }]
  assert.deepStrictEqual(F.waiveRests(r0, due, srv.read, { done: done(srv), env: ON }), [{ k: xyz(4, G, 4), why: `rests_on_waived ${xyz(4, G - 1, 4)}` }])
  const w = { ...Object.fromEntries(due.map(d => [d.k, d])), ...Object.fromEntries(F.waiveRests(r0, due, srv.read, { done: done(srv), env: ON }).map(d => [d.k, d])) }
  assert.deepStrictEqual(walk({ ...r0, waived: w }, srv, F).leftK, [], 'after the decision nothing floats')
  assert.deepStrictEqual(walk({ ...r0, waived: Object.fromEntries(due.map(d => [d.k, d])) }, srv, F).leftK, [xyz(4, G, 4)], 'the control: the waiver alone leaves the cell above in mid-air')
  // the control (gkstall-01's hole): with the hole's walls standing the cell above is held by a side -- it stays, laid as before
  const s2 = server()
  dig(s2, 4, 4, 2)
  assert.deepStrictEqual(F.waiveRests(r0, due, s2.read, { done: done(s2), env: ON }), [])
  // off: none; a waiver of something that is no fill cell (a clear, a cut): none
  assert.deepStrictEqual(F.waiveRests(r0, due, srv.read, { done: done(srv), env: OFF }), [])
  assert.deepStrictEqual(F.waiveRests(r0, [{ k: xyz(9, G, 9) }], srv.read, { done: done(srv), env: ON }), [])
  assert.deepStrictEqual(F.waiveRests(r0, [], srv.read, { done: done(srv), env: ON }), [])
  // never a hollow's seal (`opener`: never waived)
  const r1 = rec([cell(4, G - 1, 4, { role: 'core' }), cell(4, G, 4, { opener: [4, G + 1, 4] })])
  assert.deepStrictEqual(F.waiveRests(r1, due, srv.read, { done: done(srv), env: ON }), [])
}
await t('a waived cell takes the cells resting on it in the same decision (controls: a cell a side holds stays; off; a seal is never waived)', () => scenWaiveRests())

say('THE VISIT\'S HOLD AND ITS REMEDY (the refusal chain)')
const scenHold = (F = FC) => {
  const { srv, r0: r } = holeScene()
  const r0 = { ...r, sitedAt: NOW }
  const at = { done: done(srv), now: NOW + 10 * 60_000, env: ON }
  assert.strictEqual(F.floatHold(r0, srv.read, at).size, 0, 'the control: a supported cell is never held')
  dugRound(srv)
  // the refusal: the floating cell is passed this visit
  assert.deepStrictEqual([...F.floatHold(r0, srv.read, at)], [xyz(4, G, 4)])
  // ...and a cell waiting on it in its column is passed with it (never laid over the void against a side)
  const r2 = { ...r0, cells: [...r0.cells, cell(4, G + 1, 4)] }
  srv.set([5, G + 1, 4], 'cobblestone')
  assert.deepStrictEqual([...F.floatHold(r2, srv.read, at)].sort(), [xyz(4, G, 4), xyz(4, G + 1, 4)].sort())
  srv.set([5, G + 1, 4], 'air')
  // THE REMEDY, performed: the keeper's refresh (due an hour after the survey) repairs the column...
  assert.strictEqual(TR.refreshDue(r0, { now: NOW + HOUR, env: {} }), true, 'the refresh this hold waits for is due within the hour')
  const fx = F.columnRepair(r0, srv.read, { done: done(srv), now: NOW + HOUR })
  const r1 = TR.refreshStamp(fx.rec, { now: NOW + HOUR })
  // ...after which nothing is held and the bot has cells it can lay from where it is
  const after = { ...at, now: NOW + HOUR + 60_000 }
  assert.strictEqual(F.floatHold(r1, srv.read, after).size, 0)
  assert.deepStrictEqual(walk(r1, srv, F).order, [[4, G - 2, 4], [4, G - 1, 4]])
  // THE CHAIN'S OTHER END: no refresh in two periods (no keeper is refreshing) -> nothing is held: the cell is deferred and
  // counted toward the waiver as before (never a hold with no remedy behind it)
  assert.strictEqual(F.floatHold(r0, srv.read, { ...at, now: NOW + 2 * HOUR }).size, 0)
  assert.strictEqual(F.floatHold(r0, srv.read, { ...at, now: NOW + 2 * HOUR - 1 }).size, 1)
  assert.strictEqual(F.floatHold({ ...r0, sitedAt: NOW + 10 * HOUR }, srv.read, at).size, 0, 'a survey time in the future: not served')
  // a record the refresh does not serve (another stage, a complete one, either switch off): nothing is held
  assert.strictEqual(F.floatHold({ ...r0, stageId: 'rim48' }, srv.read, at).size, 0)
  assert.strictEqual(F.floatHold({ ...r0, structure_complete: true }, srv.read, at).size, 0)
  assert.strictEqual(F.floatHold(r0, srv.read, { ...at, env: OFF }).size, 0)
  assert.strictEqual(F.floatHold(r0, srv.read, { ...at, env: { TIDYREFRESH: 'off' } }).size, 0)
  for (const v of ['off', '0', 'false', 'no', 'OFF']) assert.strictEqual(F.fillColumnOn({ FILLCOLUMN: v }), false)
  for (const v of [undefined, '', 'on', '1']) assert.strictEqual(F.fillColumnOn({ FILLCOLUMN: v }), true)
}
await t('held -> the hourly refresh repairs -> not held, cells to lay; no refresh in two periods -> not held (deferred as before); only a record the refresh serves', () => scenHold())

say('THE CHAIN THROUGH THE REAL VISIT (buildrun.mjs runVisit, the real stand search)')
// two planned 1x1 holes, each its own segment: (4,4) -- the ground then dug from under and round its cell -- and a far one, sound
const twoHoles = () => {
  const srv = server()
  air(srv, 4, G, 4); air(srv, -12, G, 0)
  const r = site(srv)
  assert.deepStrictEqual(fillK(r), [xyz(-12, G, 0), xyz(4, G, 4)].sort())
  const r0 = { ...r, sitedAt: NOW, cells: r.cells.map(c => (c.at[0] === -12 ? { ...c, seg: 'T-01-0' } : c)), segments: [...r.segments, { seg: 'T-01-0', deps: [] }] }
  dugRound(srv)
  return { srv, rec: r0 }
}
const visit = async (srv, record, extra = {}) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fillcol-'))
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slot = PJ.takeSlot(dir, key, 'A', 1)
  const e = bot(srv, 'A', { inv: { dirt: 64, cobblestone: 64 }, feet: [0, G + 1, 0] })
  // the tidy visit's own options (skills.mjs buildTidy): deferSpent, skipOpenDeps, stuckStalledOnly
  const r = await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record, tidy: [], recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: T.tidyWalkR(record), blockLayer: false, clearMax: T.TIDY_CLEAR_MAX, stuckStalledOnly: true, deferSpent: true, skipOpenDeps: true, ...extra }, e, { maxSteps: 400 })
  return { r, ops: e.logs.filter(([k]) => k === '_build').map(([, d]) => d) }
}
const laid = (srv, x, y, z) => ['dirt', 'cobblestone'].includes(srv.read(x, y, z).name)
await t('TODAY: the floating cell is deferred (counted toward stuck and the waiver) and the visit still lays the other segment -- it is not held off it', async () => {
  const a = twoHoles()
  const v = await visit(a.srv, a.rec)
  assert.ok(laid(a.srv, -12, G, 0), `the far segment is laid (stop ${v.r.stop}: ${v.r.why})`)
  assert.deepStrictEqual((v.r.deferred ?? []).map(d => d.k), [xyz(4, G, 4)])
  assert.ok(v.ops.some(d => d.op === 'deferred'), 'a deferred row')
  assert.strictEqual(v.r.stop, 'cell_deferred')
  assert.strictEqual(a.srv.read(4, G, 4).name, 'air')
})
await t('HELD: the same visit with the hold -- no deferral, no stuck count, the other segment laid; then the REMEDY (the repair) and the bot lays the added cells from where it stands', async () => {
  const b = twoHoles()
  const held = FC.floatHold(b.rec, b.srv.read, { done: done(b.srv), now: NOW + 60_000, env: ON })
  assert.deepStrictEqual([...held], [xyz(4, G, 4)])
  const v = await visit(b.srv, b.rec, { alsoDone: q => held.has(q.at.join(',')) })
  assert.ok(laid(b.srv, -12, G, 0), `the far segment is laid (stop ${v.r.stop}: ${v.r.why})`)
  assert.deepStrictEqual(v.r.deferred ?? [], [], 'nothing deferred')
  assert.ok(!v.ops.some(d => d.op === 'deferred' || d.op === 'stuck_on_cell'), 'no deferred row, no stuck row')
  assert.strictEqual(b.srv.read(4, G, 4).name, 'air', 'the held cell is not tried')
  // the remedy: the refresh's repair, then a visit on the repaired record (the waived top read done, as skills.mjs waivedK reads it)
  const fx = FC.columnRepair(b.rec, b.srv.read, { done: done(b.srv), now: NOW + HOUR })
  assert.deepStrictEqual(keys(fx.added), [xyz(4, G - 2, 4), xyz(4, G - 1, 4)])
  const v2 = await visit(b.srv, fx.rec, { alsoDone: q => Object.prototype.hasOwnProperty.call(fx.rec.waived ?? {}, q.at.join(',')) })
  assert.ok(laid(b.srv, 4, G - 2, 4) && laid(b.srv, 4, G - 1, 4), `the added cells are laid, bottom-up (stop ${v2.r.stop}: ${v2.r.why}; ${JSON.stringify(v2.r.deferred ?? [])})`)
  assert.strictEqual(v2.r.placed, 2)
  assert.deepStrictEqual(v2.r.deferred ?? [], [])
  assert.strictEqual(b.srv.read(4, G, 4).name, 'air', 'the cell left out is not laid')
  assert.strictEqual(v2.r.stop, 'complete')
})

say('THE ROWS AND THE WIRING')
await t('the refresh row\'s counts and the hold\'s reason survive the log formatter uncut', () => {
  const tag = FC.repairTag({ ext: 999, add: 999, deep: 999, drop: 9999, back: 999, left: 9999 })
  assert.strictEqual(tag, 'ext999/add999/deep999/drop9999/back999/left9999')
  rowSurvives('_build', { project: 'tidy', op: 'refreshed', n: 12, kind: 'cut12/fill345/cols67/cap0', result: tag, why: 'busy:2,known:1', gen: 7 })
  rowSurvives('_build', { project: 'tidy', op: 'float_held', cell: [4, G, 4], n: 52, why: FC.HOLD_WHY })
  rowSurvives('_build', { project: 'tidy', op: 'waived', cell: [4, G, 4], gen: 7, why: 'fillcolumn:waived_below' })
  rowSurvives('_build', { project: 'tidy', op: 'sited', cell: [0, 70, 0], seg: 'stage3', n: 0, result: 'float0/2619', kind: 'pillars93/cut1106/pits201/fill2619/grade-:0+0', gen: 96 })
  assert.ok(tag.length <= 48 && FC.HOLD_WHY.length <= 120)
  // the control: a longer tag IS cut by the formatter (the check can fail)
  assert.ok(!SHOP.buildRowDetail({ project: 'tidy', op: 'refreshed', result: `${tag}/more` }).includes(`${tag}/more`))
  assert.ok(SHOP.buildRowDetail({ project: 'tidy', op: 'refreshed', result: tag }).includes(`result=${tag}`))
})
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
await t('skills.mjs (structural, comments stripped): the repair inside the refresh\'s publish, the hold before the visit, the waiver\'s dependents, the self-check', () => {
  const s = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const LINES = [
    'res = refreshMerge(cur, fresh, { busy, guard, now })',
    'try { ({ res, fx } = refreshRepair(res, cur, read, { done: q => buildCellDone(read(...q.at), TIDY_PALETTE, q.role), guard, mayAdd: q => !cellInZones(q[0], q[1], q[2], c?.zones ?? []), reserved: reservedNow, now, by: me })) } catch { fx = null }',
    'return refreshClaimed(refreshStamp(res.rec ?? cur, { now, added: res.added, skipped: res.skipped, cap }), claims, claimRetire)',
    '...(fx ? { result: repairTag(fx.n) } : {})',
    "|| farmWater(q) || guard.has(q.at.join(',')) || floatHeld.has(q.at.join(',')) || (!!rec.waived && Object.prototype.hasOwnProperty.call(rec.waived, q.at.join(',')))",
    'try { floatHeld = fillFloatHold(rec, read, { done: q => buildCellDone(read(...q.at), palette, q.role), guard }) } catch { floatHeld = new Set() }',
    'const floorDone = q => waivedK(q) || buildCellDone(read(...q.at), palette, q.role)',
    'const waive = waive0p.length ? [...waive0p, ...waiveRests(rec, waive0p, read2, { done: q => buildCellDone(read2(...q.at), palette, q.role), guard })] : waive0p',
    'if (due.length) due.push(...waiveRests(rw, due, read2, { done: q => buildCellDone(read2(...q.at), palette, q.role), guard }))',
    'fcheck = planSelfCheck(body, rdc, { done: q => buildCellDone(rdc(...q.at), TIDY_PALETTE, q.role) })',
    "...(fcheck ? { result: `float${fcheck.left}/${fcheck.open}${fcheck.err ? '/err' : ''}` } : {})",
  ]
  const wired = src => LINES.every(l => src.split(l).length === 2) &&
    // the repair runs on the merge's result and before the stamp; the hold is filled before the visit's first done test
    src.indexOf(LINES[0]) < src.indexOf(LINES[1]) && src.indexOf(LINES[1]) < src.indexOf(LINES[2]) && src.indexOf(LINES[5]) < src.indexOf(LINES[6])
  for (const l of LINES) assert.strictEqual(s.split(l).length, 2, `wiring missing or not unique: ${l}`)
  assert.ok(wired(s))
  assert.ok(!wired(s.replace(" || floatHeld.has(q.at.join(','))", '')), 'MUTANT: the hold not read by the visit still reads wired')
  assert.ok(!wired(s.replace(LINES[1], '')), 'MUTANT: the repair cut out of the publish still reads wired')
  assert.ok(!wired(s.replace(LINES[1], '').replace(LINES[2], `${LINES[2]}\n${LINES[1]}`)), 'MUTANT: the repair after the stamp still reads wired')
})

say('THE PROPERTY: random ground, random holes, random digging -- after every refresh the plan is executable')
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let v = Math.imul(seed ^ seed >>> 15, 1 | seed); v = v + Math.imul(v ^ v >>> 7, 61 | v) ^ v; return ((v ^ v >>> 14) >>> 0) / 4294967296 }
const topOf = (srv, x, z) => { for (let y = G + 3; y > G - 18; y--) if (srv.read(x, y, z)?.boundingBox === 'block') return y; return G - 18 }
const stats = { seeds: 0, refreshes: 0, sitedCells: 0, sitedFloat: 0, offFloat: 0, onFloat: 0, add: 0, drop: 0, back: 0, ext: 0, deep: 0, cells: 0 }
const scenProperty = (F = FC, seeds = 8) => {
  for (let seed = 1; seed <= seeds; seed++) {
    const R = rng(seed * 7919), ri = n => Math.floor(R() * n)
    const srv = server()
    for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) if (R() < 0.08) dig(srv, x, z, 1 + ri(3))
    let cur = site(srv)
    if (!cur) continue
    stats.seeds++
    // a survey's own plan is sound: every column starts on its ground (the cause is never the survey)
    const w0 = walk(cur, srv, F)
    stats.sitedCells += w0.open.length; stats.sitedFloat += w0.leftK.length
    assert.deepStrictEqual(w0.leftK, [], `seed ${seed}: the survey's own plan is executable`)
    for (let round = 0; round < 3; round++) {
      // the visits lay a third of what can be laid; the bots dig under and round some open cells
      const w = walk(cur, srv, F)
      for (const at of w.order.slice(0, Math.floor(w.order.length / 3))) srv.set(at, R() < 0.5 ? 'dirt' : 'cobblestone')
      const open = F.openFills(cur, { done: done(srv) })
      for (let i = 0; i < 6 && open.length; i++) {
        const c = open[ri(open.length)].at
        for (let d = 1, u = 1 + ri(3); d <= u; d++) air(srv, c[0], c[1] - d, c[2])
        const deepRing = R() < 0.2
        for (const [dx, dz] of N8) { if (R() < 0.3) continue; const x = c[0] + dx, z = c[2] + dz, top = topOf(srv, x, z); if (top > G - 8) dig(srv, x, z, deepRing ? 6 : ri(3), top) }
      }
      const off = refresh(srv, cur, OFF, F), on = refresh(srv, cur, ON, F, { T: { ...F.FILLCOLUMN, refreshMax: 100000 } })
      assert.strictEqual(off.res, off.m)
      stats.refreshes++
      stats.offFloat += F.floatCells(off.rec, srv.read, { done: done(srv) }).left.length
      const wOn = walk(on.rec, srv, F)
      const judged = F.floatCells(on.rec, srv.read, { done: done(srv) })
      stats.onFloat += judged.left.length
      assert.deepStrictEqual(keys(judged.left), [], `seed ${seed} round ${round}: a cell no order reaches is still planned`)
      assert.deepStrictEqual(wOn.leftK, keys(judged.stuck))
      assert.strictEqual(on.fx.n.left, 0)
      // no cell twice, no added cell on a cell the record or another refresh names, every added cell in a segment the record has
      assert.strictEqual(new Set(fillK(on.rec)).size, on.rec.cells.length, 'no cell twice')
      for (const c of on.fx.added) assert.ok(on.rec.segments.some(sg => sg.seg === c.seg), `added cell in an unknown segment ${c.seg}`)
      for (const k of ['add', 'drop', 'back', 'ext', 'deep']) stats[k] += on.fx.n[k]
      cur = on.rec
    }
    stats.cells += cur.cells.length
  }
}
await t('8 random towns x 3 refreshes: the survey\'s plan is sound; after each refresh with the switch on no planned cell is unexecutable', () => {
  scenProperty()
  NOTES.push(`property: ${JSON.stringify(stats)}`)
  // the worlds are not vacuous: the old refresh DID leave floating cells, and the repair both added and left out
  assert.ok(stats.seeds >= 6 && stats.sitedCells > 100, 'the random towns have plans')
  assert.ok(stats.offFloat > 0, 'the control: with the switch off the same worlds hold floating cells')
  assert.ok(stats.add > 0 && stats.drop > 0, 'the repair added cells and left cells out')
  assert.strictEqual(stats.onFloat, 0)
})

say('THE COST (a town-sized record: 1,161 columns, 5,805 fill cells, 60 columns dug out)')
await t('the repair, the hold and the self-check on a town-sized record: measured beside the survey and the refresh\'s own pass', () => {
  const srv = server()
  const cs = [], cols = []
  for (let x = -29; x <= 29; x++) for (let z = -29; z <= 29; z++) {
    if ((((x + 2 * z) % 3) + 3) % 3 !== 0) continue
    dig(srv, x, z, 5)
    cols.push([x, z])
    for (let y = G - 4; y <= G; y++) cs.push(cell(x, y, z, { role: y === G ? 'earth' : 'core', seg: `T-${String(cols.length % 200).padStart(2, '0')}-${y - (G - 4)}` }))
  }
  const r0 = rec(cs)
  // 60 columns dug out: the floor one more down and the four columns beside it 5 down (the lowest cell has nothing beside it)
  let n = 0
  for (const [x, z] of cols) { if (Math.abs(x) > 26 || Math.abs(z) > 26 || (x * 31 + z * 17) % 11 !== 0 || n >= 60) continue; n++; air(srv, x, G - 5, z); for (const [dx, dz] of N8.slice(0, 4)) dig(srv, x + dx, z + dz, 5) }
  assert.strictEqual(n, 60)
  const d = done(srv)
  const time = fn => { const t0 = performance.now(); const v = fn(); return [performance.now() - t0, v] }
  const [msOpen, busy] = time(() => TR.openColumns(r0, srv.read, { done: d }))
  const [msSurvey, fresh] = time(() => site(srv, { busy }))
  const [msMerge, m] = time(() => TR.refreshMerge(r0, fresh, { busy, now: NOW }))
  const [msRepair, fx] = time(() => FC.columnRepair(m.rec ?? r0, srv.read, { done: d, now: NOW }))
  const [msHold, held] = time(() => FC.floatHold(r0, srv.read, { done: d, now: NOW + 1, env: ON }))
  const [msCheck, chk] = time(() => FC.planSelfCheck(r0, srv.read, { done: d, env: ON }))
  NOTES.push(`cost: cells=${cs.length} cols=${cols.length} | BEFORE openColumns=${msOpen.toFixed(1)}ms survey=${msSurvey.toFixed(1)}ms merge=${msMerge.toFixed(1)}ms | ADDED repair=${msRepair.toFixed(1)}ms (${JSON.stringify(fx.n)}) | visit hold=${msHold.toFixed(1)}ms (${held.size} held) selfcheck=${msCheck.toFixed(1)}ms (${JSON.stringify(chk)})`)
  assert.strictEqual(cs.length, 5805)
  assert.ok(held.size >= 60 * 5, `every cell of the 60 dug columns is held (${held.size})`)
  assert.strictEqual(fx.n.left, 0)
  assert.ok(fx.n.drop > 0)
  assert.strictEqual(FC.floatCells(fx.rec, srv.read, { done: d }).left.length, 0)
  // a generous bound (the CI hosts run at nice 19): the repair costs less than the survey it rides with, and well under a second
  assert.ok(msRepair < Math.max(1500, 2 * msSurvey), `the repair took ${msRepair.toFixed(0)} ms (the survey ${msSurvey.toFixed(0)} ms)`)
  assert.ok(msHold < 1000, `the hold took ${msHold.toFixed(0)} ms`)
})

say('MUTANTS')
await kills('the downward extension removed (no lower cell is ever added)', '        gap.push(q)\n', '', scenBug)
await kills('the per-column depth cap removed (a 5-deep cavity is filled)', 'if (i > T.addMax || (openN.get(k) ?? 0) + i > T.depthMax)', 'if ((openN.get(k) ?? 0) + i > T.depthMax)', scenDeep)
await kills('the column\'s total cap removed (a column of 7)', 'if (i > T.addMax || (openN.get(k) ?? 0) + i > T.depthMax)', 'if (i > T.addMax)', scenColumnMax)
await kills('the support test always true (nothing is ever floating)', 'const ready = ([x, y, z]) => S(x, y - 1, z) || SIDES.some(([dx, dz]) => S(x + dx, y, z + dz))', 'const ready = () => true', scenBug)
await kills('the support test without the sides (a lid is called floating)', 'const ready = ([x, y, z]) => S(x, y - 1, z) || SIDES.some(([dx, dz]) => S(x + dx, y, z + dz))', 'const ready = ([x, y, z]) => S(x, y - 1, z)', scenOrder)
await kills('the support test without the block below', 'const ready = ([x, y, z]) => S(x, y - 1, z) || SIDES.some(([dx, dz]) => S(x + dx, y, z + dz))', 'const ready = ([x, y, z]) => SIDES.some(([dx, dz]) => S(x + dx, y, z + dz))', scenOrder)
await kills('the column no longer walked bottom-up', '  for (const v of cols.values()) v.sort((a, b) => a.at[1] - b.at[1])\n', '', scenOrder)
await kills('an unread cell read as "no support"', 'v = !b || refUsable(b)', 'v = !!b && refUsable(b)', scenUnread)
await kills('the waiver\'s dependents dropped', ".filter(c => { const b = low.get(colOf(c.at)); return !!b && c.at[1] > b[1] })", '.filter(() => false)', scenWaiveRests)
await kills('the due cells not read as waived when their dependents are looked for', "    w[k] ??= { why: 'due' }\n", '', scenWaiveRests)
await kills('the switch stuck on (off no longer restores the old refresh)', "export const fillColumnOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.FILLCOLUMN ?? '').trim())", 'export const fillColumnOn = () => true', scenBug)
await kills('the switch stuck on (the hold and the waiver)', "export const fillColumnOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.FILLCOLUMN ?? '').trim())", 'export const fillColumnOn = () => true', scenWaiveRests)
await kills('a cell kept with nothing beside it (a pillar is planned)', "if (!S(x, y - 1, z) || !SIDES.some(([dx, dz]) => S(x + dx, y, z + dz) || maybe.has(`${x + dx},${y},${z + dz}`))) break", 'if (!S(x, y - 1, z)) break', scenPillar)
await kills('a cell kept this round holds nothing (not the cell over it, not the one beside it: a wide pit stays empty)', 'return kept.has(q) || reach.has(q) || support(x, y, z) }', 'return reach.has(q) || support(x, y, z) }', scenWide)
await kills('water no longer stops the column', "        if (isLiquid(b) || String(b.name ?? '').includes('waterlogged')) { why = 'water'; break }\n", '', scenWater)
await kills('another record\'s cell and the protected zone no longer stop the column', "        if (guard.has(qk) || !mayAdd(q)) { why = 'guarded'; break }\n", '', scenGuard)
await kills('a reservation no longer stops the column', "let why = reserved(x, z) ? 'reserved' : null", 'let why = null', scenReserved)
await kills('a cell left out for a reservation comes back', "if (!/^fillcolumn:(?!guarded$|reserved$)/.test(String(v?.why ?? ''))) return false", "if (!/^fillcolumn:/.test(String(v?.why ?? ''))) return false", scenReserved)
await kills('the repair asks the done test of the world once and then never again (a cell laid is read open)', 'if (v === undefined) { v = !!done(c); dm.set(k, v) } return v }', 'if (v === undefined) { v = false; dm.set(k, v) } return v }', scenDone)
await kills('a waived cell under the column no longer stops it', "        if (hasOwn(w, qk)) { why = 'waived_below'; break }\n        if (known.has(qk)) { why = 'record_below'; break }\n", '', scenWaivedBelow)
await kills('an unread cell on the way down read as a reason to leave the column out', "if (why === 'unread' || why === 'cap') { wait.add(k); continue }", "if (why === 'cap') { wait.add(k); continue }", scenUnreadBelow)
await kills('the page\'s bound removed', "      if (!why && gap.length > room) why = 'cap'\n", '', scenPage)
await kills('a cell comes back with nothing beside it', 'return solidNow(x, y - 1, z) && SIDES.some(([dx, dz]) => solidNow(x + dx, y, z + dz))', 'return solidNow(x, y - 1, z)', scenBack)
await kills('a column with its own bookkeeping is judged', 'left: po.left.filter(c => !sp.has(colOf(c.at))) }', 'left: po.left }', scenSpecial)
await kills('the hold never lapses (a hold with no refresh behind it)', 'return Number.isFinite(at) && at <= now + 60_000 && now - at < T.holdMs', 'return Number.isFinite(at)', scenHold)
await kills('the hold on a record no refresh serves', ' || rec.stageId !== TIDYREFRESH.inwallId) return false', ') return false', scenHold)
await kills('the hold with the refresh switched off', 'if (!fillColumnOn(env) || !tidyRefreshOn(env) || !rec', 'if (!fillColumnOn(env) || !rec', scenHold)
await kills('the property: the repair leaves the cell above a left-out cell in mid-air', "      waive[lk] = { why: `fillcolumn:${why}`, at: now, by }\n", '', (M) => scenProperty(M, 3))

for (const n of NOTES) console.log(`  NOTE  ${n}`)
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
