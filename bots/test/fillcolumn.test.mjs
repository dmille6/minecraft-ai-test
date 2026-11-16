// FILLCOLUMN-01 (planvalid-01show, 11-15): no tidy fill is planned in mid-air. LIVE on the showcase: 52 of the 86 fill cells deferred
// in 3+ visits are air with no solid block below or beside them and no record cell under them -- the ground was dug from under a
// planned column after its survey, and the hourly refresh (tidyrefresh.mjs refreshMerge) never touches a column the record has.
// Behaviour on buildfake's flat world (stone below G, grass at G) through the REAL survey (tidy.mjs siteStage) and merge, the pure
// rules of fillcolumn.mjs, an independent walk of every plan (placing cells into an overlay), a property test, and anchored mutants.
import assert from 'node:assert'
import fsReal, { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
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
const PATHS = await import('../src/paths.mjs')
const WALLM = await import('../src/wall.mjs')
const GKWM = await import('../src/gkwork.mjs')
const PAM = await import('../src/planahead.mjs')
const WR = await import('../src/waiveroom.mjs')
const URL_OF = n => new URL(`../src/${n}`, import.meta.url)
const FC_URL = new URL('../src/fillcolumn.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; if (process.env.TEST_VERBOSE) console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e.stack ?? e).split('\n').slice(0, 3).join('\n        ').slice(0, 700)}`) }
}
const say = s => { if (process.env.TEST_VERBOSE) console.log(s) }
const NOTES = []   // the measured numbers: printed last (the runner shows a failing file's last 40 lines)
// a mutant is KILLED when the scenario that passes on the real module fails an ASSERTION on the mutant (never a crash)
const kills = (name, old, neu, scen, url = FC_URL) => t(`MUTANT KILLED: ${name}`, async () => {
  await withMutant(url, old, neu, async M => {
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
// the repair's counts (columnRepair `n`), zero but for what a test names
const N = (o = {}) => ({ ext: 0, add: 0, deep: 0, drop: 0, back: 0, left: 0, total: 0, closed: 0, wait: {}, why: {}, ...o })

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
  assert.deepStrictEqual(fx.n, N({ ext: 0, add: 0, deep: 0, drop: 0, back: 0, left: 0, total: 0, why: {} }))
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
  assert.deepStrictEqual(fx.n, N({ ext: 0, add: 0, deep: 0, drop: 0, back: 0, left: 0, total: 0, why: {} }))
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
  assert.deepStrictEqual(on.fx.n, N({ ext: 1, add: 2, deep: 0, drop: 1, back: 0, left: 0, total: 2, why: { bare: 1 } }))
  assert.deepStrictEqual(keys(on.fx.added), [xyz(4, G - 2, 4), xyz(4, G - 1, 4)])
  for (const c of on.fx.added) assert.deepStrictEqual({ role: c.role, seg: c.seg, ext: c.ext, added: c.added }, { role: 'core', seg, ext: true, added: NOW + HOUR })
  assert.strictEqual(on.rec.waived[xyz(4, G, 4)].why, 'fillcolumn:bare')
  assert.deepStrictEqual(on.fx.dropped, [{ k: xyz(4, G, 4), why: 'fillcolumn:bare' }])
  assert.strictEqual(on.rec.cells.length, r0.cells.length + 2)
  assert.strictEqual(on.rec.bom.earth, r0.bom.earth + 2)
  assert.deepStrictEqual(on.rec.fillcol, { add: 2, left: 0, cols: { '4,4': [2, G - 2] } }, 'the ledger: two cells ever added to this column, the lowest at G-2')
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
  assert.deepStrictEqual(fx.n, N({ ext: 0, add: 0, deep: 0, drop: 1, back: 0, left: 0, total: 0, why: { bare: 1 } }))
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
  assert.deepStrictEqual(fx.n, N({ ext: 9, add: 18, deep: 0, drop: 9, back: 0, left: 0, total: 18, why: { bare: 9 } }))
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
  assert.deepStrictEqual(ok.fx.n, N({ ext: 1, add: 4, deep: 0, drop: 1, back: 0, left: 0, total: 4, why: { bare: 1 } }))
  assert.deepStrictEqual(walk(ok.fx.rec, ok.srv, F).leftK, [])
  const deep = one(F, srv => dugRound(srv, { ring: 1, under: 5 }))
  leftOut(deep.fx, 'budget', { deep: 1 })
  assert.deepStrictEqual(walk(deep.fx.rec, deep.srv, F).leftK, [], 'left out: nothing planned in mid-air')
}
await t('a hole deeper than the column\'s budget (4 cells) is left out and counted (control: a hole at the budget is filled, 4 cells)', () => scenDeep())
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
  const a = one(F, srv => dugRound(srv), { keepOff: (x, z) => (x === 4 && z === 4 ? 'reserved' : null) })
  leftOut(a.fx, 'excluded')
  // a cell left out for whose ground it is never comes back on the ground's say-so (the test above: a `bare` cell does)
  a.srv.set([4, G - 1, 4], 'cobblestone'); a.srv.set([5, G, 4], 'dirt')
  assert.strictEqual(F.columnRepair(a.fx.rec, a.srv.read, { done: done(a.srv), now: NOW + HOUR, keepOff: (x, z) => (x === 4 && z === 4 ? 'reserved' : null) }).n.back, 0)
  assert.strictEqual(F.columnRepair({ ...a.fx.rec, waived: { [xyz(4, G, 4)]: { why: 'fillcolumn:deep' } } }, a.srv.read, { done: done(a.srv), now: NOW + HOUR }).n.back, 1, 'the control: the same ground, a `deep` cell comes back')
  assert.strictEqual(one(F, srv => dugRound(srv), { keepOff: (x, z) => (x === 9 && z === 9 ? 'reserved' : null) }).fx.n.add, 2, 'the control: an exclusion elsewhere')
}
await t('a column the exclusions name: left out `excluded`, and it never comes back (control: an exclusion elsewhere)', () => scenReserved())
const scenUnreadBelow = (F = FC) => {
  const { srv, r0 } = holeScene()
  dugRound(srv)
  const blind = (x, y, z) => (x === 4 && y === G - 2 && z === 4 ? null : srv.read(x, y, z))
  const fx = F.columnRepair(r0, blind, { done: q => cellDone(blind(...q.at), T.TIDY_PALETTE, q.role), now: NOW })
  assert.deepStrictEqual(fx.n, N({ left: 1, wait: { unread: 1 } }))
  assert.deepStrictEqual(fillK(fx.rec), fillK(r0), 'an unread cell on the way down: no evidence, no cell added')
  assert.strictEqual(fx.rec.waived, undefined, 'and nothing left out')
  assert.deepStrictEqual(fx.rec.fillcol, { add: 0, left: 1, cols: {} }, 'only the ledger says one cell is unresolved (the visit\'s hold reads it)')
}
await t('an unread cell on the way to the floor: the column waits for the next refresh (nothing added, nothing left out, counted `left`)', () => scenUnreadBelow())
const scenPage = (F = FC) => {
  const { srv, r0 } = holeScene()
  dugRound(srv)
  const full = F.columnRepair(r0, srv.read, { done: done(srv), now: NOW, T: { ...F.FILLCOLUMN, refreshMax: 1 } })
  assert.deepStrictEqual(full.n, N({ left: 1, wait: { cap: 1 } }), 'the page is full: the column waits')
  assert.deepStrictEqual(fillK(full.rec), fillK(r0)); assert.strictEqual(full.rec.waived, undefined)
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

say('r2 BLOCKER 1: THE SURVEY\'S OWN EXCLUSIONS (a volume sited since the survey), and closed when they cannot be read')
// the refresh's survey as skills.mjs tidyRefresh runs it, with the town's exclusions built by the REAL builders (paths.mjs pathAvoid,
// shop.mjs recordZones, tidy.mjs tidyAvoid): its result carries the predicate it used (`keepOff`)
const surveyOf = (srv, { busy = null, caps = [], plinth = [], records = [], reserved = () => false, yard = [] } = {}, TM = T) => {
  const avoid = TM.tidyAvoid(PATHS.pathAvoid({ caps, plinth, records, home: HOME }), SHOP.recordZones(records))
  return TM.siteStage(srv.read, { home: HOME, land: { seed: 1 }, stage: INWALL, env: ENV, cells: new Set(), avoid, reserved, terrace: { wall: WALL, records: yard, climbs: [] }, planned: busy, now: NOW })
}
// each kind of volume, once over the deepened column (4,4) and once just beside it
const VOLUMES = [
  ['a well (its cap, Chebyshev 3)', { caps: [[7, G, 4]] }, { caps: [[8, G, 4]] }],
  ['the junk well (its plinth\'s columns + 1)', { plinth: [[5, G, 4]] }, { plinth: [[6, G, 4]] }],
  ['the shaft\'s entrance (its record\'s box + gap)', { records: [{ plot: 'shaft', box: [7, 2, 9, 6], cells: [] }] }, { records: [{ plot: 'shaft', box: [8, 2, 10, 6], cells: [] }] }],
  ['the step well\'s pit (its record\'s box + gap)', { records: [{ plot: 'stepwell', box: [5, 5, 9, 9], cells: [] }] }, { records: [{ plot: 'stepwell', box: [8, 8, 12, 12], cells: [] }] }],
  ['a building\'s interior (inside its record\'s box, on none of its cells)', { records: [{ plot: 'townhall', box: [2, 2, 8, 8], cells: [{ at: [2, G + 1, 2] }, { at: [8, G + 1, 8] }] }] }, { records: [{ plot: 'townhall', box: [8, 8, 14, 14], cells: [{ at: [8, G + 1, 8] }, { at: [14, G + 1, 14] }] }] }],
  ['a reserved plot', { reserved: (x, z) => x >= 3 && x <= 6 && z >= 3 && z <= 6 }, { reserved: (x, z) => x >= 5 && x <= 8 && z >= 3 && z <= 6 }],
  ['the stock yard (its record\'s cells + 2)', { yard: [{ plot: 'yard', cells: [{ at: [6, G + 1, 4] }] }] }, { yard: [{ plot: 'yard', cells: [{ at: [7, G + 1, 4] }] }] }],
]
const scenVolumes = (F = FC, TM = T) => {
  for (const [name, inside, beside] of VOLUMES) {
    const run = vol => {
      const { srv, r0 } = holeScene()
      dugRound(srv)
      const s = surveyOf(srv, { busy: TR.openColumns(r0, srv.read, { done: done(srv) }), ...vol }, TM)
      assert.strictEqual(typeof s.keepOff, 'function', 'the survey hands its exclusions on')
      return { s, fx: F.columnRepair(r0, srv.read, { done: done(srv), now: NOW, keepOff: s.keepOff, closed: F.repairClosed({ keepOff: s.keepOff, unread: [] }) }) }
    }
    const a = run(inside)
    assert.ok(a.s.keepOff(4, 4), `${name}: the survey keeps off the column`)
    assert.strictEqual(a.fx.n.add, 0, `${name}: no cell is added into it`)
    assert.strictEqual(a.fx.rec.cells.length, 1, name)
    assert.deepStrictEqual(a.fx.dropped, [{ k: xyz(4, G, 4), why: 'fillcolumn:excluded' }], name)
    const b = run(beside)
    assert.strictEqual(b.s.keepOff(4, 4), null, `${name}, just beside: the column is free`)
    assert.strictEqual(b.fx.n.add, 2, `${name}, just beside: the POSITIVE CONTROL -- the column is repaired`)
  }
}
await t('a deepened column inside a well, the junk well, the shaft, the step well, a building, a reserved plot, the yard gets NO added cell (control: the same column just beside each one does)', () => scenVolumes())
const scenClosed = (F = FC) => {
  // every record the exclusions are built from is read strictly: unreadable, a rejected newest generation, a read that throws
  const heads = { wall: { ok: true, head: { gen: 3 }, gens: [1, 2, 3], rejected: [] }, shaft: { ok: false }, townhall: { ok: true, head: { gen: 1 }, gens: [1, 2], rejected: [{ gen: 2 }] }, land: { ok: true, head: null, gens: [], rejected: [] } }
  assert.deepStrictEqual(F.exclUnread(['wall', 'shaft', 'townhall', 'land', 'storehub'], p => { if (p === 'storehub') throw new Error('EIO'); return heads[p] }), ['shaft', 'townhall', 'storehub'])
  assert.deepStrictEqual(F.exclUnread(['wall', 'land'], p => heads[p]), [], 'the control: read (a project with no record at all is read, and empty)')
  const { srv, r0 } = holeScene()
  dugRound(srv)
  const s = surveyOf(srv, {})
  assert.strictEqual(F.repairClosed({ keepOff: s.keepOff, unread: [] }), null)
  assert.strictEqual(F.repairClosed({ keepOff: s.keepOff, unread: ['shaft'] }), 'excl_unread:shaft')
  assert.strictEqual(F.repairClosed({ keepOff: null, unread: [] }), 'no_exclusions', 'no survey, no exclusions: closed')
  // an unreadable project record: NOTHING is added, nothing left out, it is counted, and the row says so
  const closed = F.repairClosed({ keepOff: s.keepOff, unread: ['shaft'] })
  const m = TR.refreshMerge(r0, null, { now: NOW })
  const { res, fx } = F.refreshRepair(m, r0, srv.read, { done: done(srv), now: NOW, keepOff: s.keepOff, closed }, ON)
  assert.deepStrictEqual(fx.n, N({ left: 1, closed: 1 }))
  assert.deepStrictEqual(fillK(res.rec), fillK(r0)); assert.strictEqual(res.rec.waived, undefined)
  assert.strictEqual(F.repairNote(fx.n, closed), 'closed:excl_unread:shaft')
  assert.strictEqual(F.floatHold({ ...res.rec, sitedAt: NOW }, srv.read, { done: done(srv), now: NOW + 1, env: ON }).size, 0, 'and the cell is not hidden: no hold while the repair is closed')
  // the control: the same refresh with everything read
  assert.strictEqual(F.columnRepair(r0, srv.read, { done: done(srv), now: NOW, keepOff: s.keepOff, closed: F.repairClosed({ keepOff: s.keepOff, unread: [] }) }).n.add, 2)
  // a repair that THROWS (a reader that fails) repaired nothing: the ledger says so, and the hold is off (no cell hidden behind it)
  const boom = F.refreshRepair(m, { ...r0, sitedAt: NOW }, () => { throw new Error('reader down') }, { done: () => false, now: NOW, keepOff: s.keepOff }, ON)
  assert.strictEqual(boom.fx.n.closed, 1); assert.strictEqual(boom.fx.err, 'reader down')
  assert.deepStrictEqual(boom.res.rec.fillcol, { add: 0, left: 1, cols: {} })
  assert.deepStrictEqual(fillK(boom.res.rec), fillK(r0))
  assert.strictEqual(F.floatHold(boom.res.rec, srv.read, { done: done(srv), now: NOW + 1, env: ON }).size, 0)
  assert.strictEqual(F.floatHold({ ...r0, sitedAt: NOW }, srv.read, { done: done(srv), now: NOW + 1, env: ON }).size, 1, 'the control: before the failed repair the cell was held')
  // closed: a cell left out earlier does not come back either
  const lo = rec([cell(4, G + 3, 4)], { waived: { [xyz(4, G + 3, 4)]: { why: 'fillcolumn:bare' } } })
  srv.set([4, G + 2, 4], 'dirt'); srv.set([5, G + 3, 4], 'dirt')
  assert.strictEqual(F.columnRepair(lo, srv.read, { done: done(srv), now: NOW, closed }).n.back, 0)
  assert.strictEqual(F.columnRepair(lo, srv.read, { done: done(srv), now: NOW }).n.back, 1)
}
await t('an unreadable project record (or its newest generation rejected, or a read that throws): the repair is closed -- nothing added, nothing left out, counted, on the row (control: all read)', () => scenClosed())

const scenSiteprep = (F = FC) => {
  // r3 BLOCKER 1: the strict read names the SITE-PREP record (and the land plan's) beside the guarded projects'
  assert.deepStrictEqual(F.exclPlots(['wall', 'shaft']), ['wall', 'shaft', 'land', 'siteprep'])
  assert.deepStrictEqual(F.exclPlots(['siteprep', 'wall', 'land', 'wall']), ['siteprep', 'wall', 'land'], 'each once')
  // THE CASE: the site-prep record cannot be read. The lenient reader (skills.mjs siteprepHead) drops it, so the survey's own
  // exclusions do NOT hold the plot it reserves -- here the plot over the deepened column (4,4)
  const { srv, r0 } = holeScene()
  dugRound(srv)
  const blindSurvey = surveyOf(srv, {})                                   // what the survey sees without the record
  const seeing = surveyOf(srv, { reserved: (x, z) => x >= 3 && x <= 6 && z >= 3 && z <= 6 })   // ...and with it
  assert.strictEqual(blindSurvey.keepOff(4, 4), null); assert.ok(seeing.keepOff(4, 4))
  const ok = { ok: true, head: { gen: 1 }, gens: [1], rejected: [] }
  const unread = F.exclUnread(F.exclPlots(['wall']), p => (p === 'siteprep' ? { ok: false } : ok))
  assert.deepStrictEqual(unread, ['siteprep'])
  const closed = F.repairClosed({ keepOff: blindSurvey.keepOff, unread })
  assert.strictEqual(closed, 'excl_unread:siteprep')
  const fx = F.columnRepair(r0, srv.read, { done: done(srv), now: NOW, keepOff: blindSurvey.keepOff, closed })
  assert.deepStrictEqual(fx.n, N({ left: 1, closed: 1 }), 'closed: no cell is added inside the plot nobody could read')
  assert.strictEqual(F.repairNote(fx.n, closed), 'closed:excl_unread:siteprep')
  // the controls: without the strict read the repair DOES add into the reserved plot (the blocker); with the record read the survey
  // itself keeps off it
  assert.strictEqual(F.columnRepair(r0, srv.read, { done: done(srv), now: NOW, keepOff: blindSurvey.keepOff, closed: null }).n.add, 2)
  assert.strictEqual(F.columnRepair(r0, srv.read, { done: done(srv), now: NOW, keepOff: seeing.keepOff, closed: null }).n.add, 0)
  assert.deepStrictEqual(F.exclUnread(F.exclPlots(['wall']), () => ok), [], 'everything read: open')
  // the files beside the records: a check that is not exactly true, or throws, names its input unread
  assert.deepStrictEqual(F.exclInputsUnread({ plan: () => true, zones: () => false, wells: () => { throw new Error('EIO') }, markers: () => 1, bridges: () => undefined, treefarm: () => true }), ['zones', 'wells', 'markers', 'bridges'])
  assert.deepStrictEqual(F.exclInputsUnread({ plan: () => true, zones: () => true }), [])
  assert.strictEqual(F.repairClosed({ keepOff: blindSurvey.keepOff, unread: [...unread, ...F.exclInputsUnread({ markers: () => false })] }), 'excl_unread:siteprep+markers')
}
await t('r3/1 an unreadable SITE-PREP record closes the repair, named on the row (controls: without the strict read 2 cells go into the reserved plot; with the record read the survey keeps off)', () => scenSiteprep())
const scenLedgerCells = (F = FC) => {
  // r3 BLOCKER 2: a column the repair gave its 4 cells (two refreshes of dig and fill, as above) ...
  const { srv, r0 } = holeScene()
  const fix = (r, T = F.FILLCOLUMN) => F.columnRepair(r, srv.read, { done: done(srv), now: NOW, T })
  const lay = (...ys) => { for (const y of ys) srv.set([4, y, 4], 'cobblestone') }
  dugRound(srv, { ring: 1, under: 2 })
  let r = fix(r0).rec
  lay(G - 2, G - 1)
  for (const [dx, dz] of N8) dig(srv, 4 + dx, 4 + dz, 3)
  for (let y = G - 1; y >= G - 4; y--) air(srv, 4, y, 4)
  r = fix(r).rec
  assert.deepStrictEqual(r.fillcol, { add: 4, left: 0, cols: { '4,4': [4, G - 4] } })
  assert.strictEqual(r.cells.filter(c => c.ext).length, 4)
  // ... republished WITHOUT its ledger (an older build during a rolling restart): the cells themselves say what was spent
  const bare = { ...r }
  delete bare.fillcol
  assert.deepStrictEqual(F.repairLedger(bare), { add: 4, left: 0, cols: { '4,4': [4, G - 4] } })
  // a ledger that says LESS than the cells: the cells win; one that says more: it wins (the greater count, the lower y, each way)
  assert.deepStrictEqual(F.repairLedger({ ...r, fillcol: { add: 1, left: 0, cols: { '4,4': [1, G - 1] } } }), { add: 4, left: 0, cols: { '4,4': [4, G - 4] } })
  assert.deepStrictEqual(F.repairLedger({ ...r, fillcol: { add: 9, left: 2, cols: { '4,4': [6, G - 9], '7,7': [2, 50] } } }), { add: 9, left: 2, cols: { '4,4': [6, G - 9], '7,7': [2, 50] } })
  assert.deepStrictEqual(F.repairLedger(r0), { add: 0, left: 0, cols: {} }, 'the control: no added cell, no ledger: zero')
  // the budget is already spent on the bare record: dug again, the column gets nothing (and the ledger is written back)
  lay(G - 4, G - 3)
  for (const [dx, dz] of N8) dig(srv, 4 + dx, 4 + dz, 5)
  for (let y = G - 3; y >= G - 6; y--) air(srv, 4, y, 4)
  const wide = { ...F.FILLCOLUMN, depthMax: 99, floorDy: 99 }
  const fx = fix(bare, wide)
  assert.strictEqual(fx.n.add, 0, 'no fresh budget for a column whose cells are on the record')
  assert.strictEqual(fx.n.why.budget, 1)
  assert.strictEqual(fx.n.total, 4)
  assert.deepStrictEqual(fx.rec.fillcol, { add: 4, left: 0, cols: { '4,4': [4, G - 4] } }, 'the ledger is back on the record')
  // ...and the record's lifetime total counts them: with a cap of 4 another dug-out column gets nothing (control: a cap of 6)
  air(srv, -12, G, 0); dugRound(srv, { cx: -12, cz: 0 })
  const more = { ...bare, cells: [...bare.cells, cell(-12, G, 0)] }
  const cap = n => ({ ...F.FILLCOLUMN, recMin: n, recShare: 0 })
  const at4 = F.columnRepair(more, srv.read, { done: done(srv), now: NOW, T: cap(4) })
  assert.ok(!at4.added.some(c => c.at[0] === -12), 'the record\'s cap is spent by the cells already on it')
  assert.strictEqual(at4.n.wait.rec_cap, 1)
  assert.deepStrictEqual(keys(F.columnRepair(more, srv.read, { done: done(srv), now: NOW, T: cap(6) }).added.filter(c => c.at[0] === -12)), [xyz(-12, G - 2, 0), xyz(-12, G - 1, 0)])
  // a record with nothing to repair but a missing ledger gets it written (control: with the ledger on it, nothing is written)
  const calm = server()
  const quiet = rec([cell(4, G + 1, 4), cell(4, G + 2, 4, { ext: true, added: 1 })])
  const w = F.columnRepair(quiet, calm.read, { done: done(calm), now: NOW })
  assert.deepStrictEqual(w.rec.fillcol, { add: 1, left: 0, cols: { '4,4': [1, G + 2] } })
  assert.strictEqual(F.columnRepair(w.rec, calm.read, { done: done(calm), now: NOW }).rec, null)
}
await t('r3/2 the ledger is reconciled with the cells: added cells and no ledger -> the budget is spent; a ledger that says less -> the cells win; the record\'s total too', () => scenLedgerCells())

const scenFiles = (F = FC) => {
  // r4: EVERY strict reader, both halves -- (i) ABSENT is empty and closes nothing; (ii) present and malformed, or holding ONE
  // malformed line or entry, closes. A real directory each time
  const HK = '0_70_0'
  const town = (files = {}) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fc-excl-'))
    for (const [n, v] of Object.entries(files)) writeFileSync(path.join(dir, n), typeof v === 'string' ? v : JSON.stringify(v))
    return dir
  }
  const unread = (files, fsx = fsReal) => { const dir = town(files); return F.exclFilesUnread({ dir, hk: HK, markersFile: path.join(dir, 'expedition-0_70_0.markers.jsonl'), bridgesFile: path.join(dir, 'expedition-0_70_0.bridges.jsonl') }, fsx) }
  const L = (...ls) => ls.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n'
  // (i) a town with NONE of the files (the healthy case), a town with no directory at all: nothing is unread
  assert.deepStrictEqual(unread({}), [])
  assert.deepStrictEqual(F.exclFilesUnread({ dir: path.join(os.tmpdir(), `fc-none-${process.pid}-${Date.now()}`), hk: HK, markersFile: '/nonexistent/m.jsonl', bridgesFile: '/nonexistent/b.jsonl' }), [])
  assert.deepStrictEqual(F.exclFilesUnread({ dir: town({}), hk: HK }), [], 'no markers or bridges file named at all')
  // (i) ...and every file present and well formed (blank lines and a trailing newline are no line)
  const plinth = { plan: { steps: [{ c: [5, 70, 5] }, { note: 'no cell' }], cap: { x: 5, y: 72, z: 5 }, stair: [[6, 70, 5]] }, prev: [{ x: 9, y: 70, z: 9, stair: [[9, 70, 10]] }] }
  const sight = { op: 'sight', id: 'b1', span: { near: [20, 64, 0], far: [26, 64, 0], axis: [1, 0], rows: [] }, trip: 't1', t: 1 }
  const good = {
    'junkwell-plinth-0_70_0.json': plinth, 'junkwell-site-0_70_0.g1.json': 'torn{', 'junkwell-site-0_70_0.g2.json': { x: 5, y: 70, z: 5 },
    'treefarm-0_70_0.g1.json': 'torn{', 'treefarm-0_70_0.g3.json': { record: { cells: [{ x: 1, z: 2 }, { x: 3, z: 4 }] } },
    'composter-site-0_70_0.g1.json': { x: 1.5 }, 'composter-site-0_70_0.g4.json': { x: 1, y: 70, z: 2, world: 'w' },
    'expedition-0_70_0.markers.jsonl': L({ at: [30, 64, 30], t: 1 }, '', '   ', { at: [30, 64, 30], gone: true }),
    'expedition-0_70_0.bridges.jsonl': L(sight, { op: 'state', id: 'b1', state: 'built' }),
  }
  assert.deepStrictEqual(unread(good), [], 'every file present and sound (an OLDER generation that is torn does not matter: the newest is the record)')
  assert.deepStrictEqual(unread({ 'junkwell-plinth-0_70_0.json': { plan: null } }), [], 'a plinth record with no plan (voided): sound')
  assert.deepStrictEqual(unread({ 'treefarm-0_70_0.g1.json': { cells: [] } }), [], 'a tree farm with no cells yet: sound')
  // (ii) each file, each way of being broken, closes -- and names only itself
  const only = (name, patch) => assert.deepStrictEqual(unread({ ...good, ...patch }), [name], `${name}: ${JSON.stringify(patch).slice(0, 90)}`)
  only('bridges', { 'expedition-0_70_0.bridges.jsonl': L(sight) + '{"op":"sight","span":{"near":[40,64,' + '\n' })                      // THE BLOCKER: one torn line
  only('bridges', { 'expedition-0_70_0.bridges.jsonl': L('not json at all') })
  only('bridges', { 'expedition-0_70_0.bridges.jsonl': L(sight, { op: 'sight', id: 'b2' }) })                                              // a sighting with no span
  only('bridges', { 'expedition-0_70_0.bridges.jsonl': L(sight, [1, 2, 3]) })
  only('markers', { 'expedition-0_70_0.markers.jsonl': L({ at: [30, 64, 30] }) + '{"at":[31,64' + '\n' })
  only('markers', { 'expedition-0_70_0.markers.jsonl': L({ at: [30, 64, 30] }, { at: [31, 64] }) })                                         // a marker with no z
  only('markers', { 'expedition-0_70_0.markers.jsonl': L({ at: [30, 64, 30] }, { gone: true }) })
  only('wells', { 'junkwell-plinth-0_70_0.json': '{"plan":' })
  only('wells', { 'junkwell-plinth-0_70_0.json': { plan: { cap: { x: 5, y: 72 } } } })                                                    // a cap with no z
  only('wells', { 'junkwell-plinth-0_70_0.json': { plan: { steps: [{ c: [5, 70] }] } } })
  only('wells', { 'junkwell-plinth-0_70_0.json': { ...plinth, prev: [{ x: 9, y: 70, z: 9 }, { x: 9 }] } })
  only('wells', { 'junkwell-plinth-0_70_0.json': [] })
  only('wells', { 'junkwell-site-0_70_0.g3.json': '{' })                                                                                 // the NEWEST generation torn
  only('wells', { 'junkwell-site-0_70_0.g3.json': { x: 5, y: 70 } })
  only('treefarm', { 'treefarm-0_70_0.g4.json': 'torn' })                                                                                // never the older generation instead
  only('treefarm', { 'treefarm-0_70_0.g4.json': { record: { cells: [{ x: 1, z: 2 }, { x: 3 }] } } })
  only('treefarm', { 'treefarm-0_70_0.g4.json': { record: {} } })
  only('townsite', { 'composter-site-0_70_0.g5.json': '{"x":1,' })
  only('townsite', { 'composter-site-0_70_0.g5.json': { x: 1, y: 70 } })
  // (ii) a file that EXISTS and cannot be read (not ENOENT), a directory that cannot be listed
  const eacces = n => Object.assign(new Error(`EACCES ${n}`), { code: 'EACCES' })
  const noRead = name => ({ ...fsReal, readFileSync: (f, ...a) => { if (String(f).includes(name)) throw eacces(f); return fsReal.readFileSync(f, ...a) } })
  assert.deepStrictEqual(unread(good, noRead('markers')), ['markers'])
  assert.deepStrictEqual(unread(good, noRead('bridges')), ['bridges'])
  assert.deepStrictEqual(unread(good, noRead('junkwell-plinth')), ['wells'])
  assert.deepStrictEqual(unread(good, noRead('treefarm')), ['treefarm'])
  assert.deepStrictEqual(unread(good, noRead('composter-site')), ['townsite'])
  assert.deepStrictEqual(unread(good, { ...fsReal, readdirSync: d => { throw eacces(d) } }), ['wells', 'treefarm', 'townsite'], 'the directory cannot be listed')
  // THE TOWN PLAN'S HEAD (planstore.mjs planHead's answer) and a project's record head: no plan / never sited is read, and empty
  const head = (o = {}) => ({ ok: true, head: { gen: 2 }, gens: [1, 2], rejected: [], ...o })
  assert.deepStrictEqual(F.exclUnread(['plan'], () => head({ head: null, gens: [] })), [], '(i) no plan at all')
  assert.deepStrictEqual(F.exclUnread(['plan'], () => head({ rejected: [{ gen: 1, why: 'unparseable' }] })), [], '(i) an OLD generation rejected, the newest sound')
  assert.deepStrictEqual(F.exclUnread(['plan'], () => head({ rejected: [{ gen: 2, why: 'schema: plots' }] })), ['plan'], '(ii) the newest generation malformed')
  assert.deepStrictEqual(F.exclUnread(['plan'], () => ({ ok: false, head: null, gens: [], rejected: [], from: 'error' })), ['plan'], '(ii) unreadable')
  // THE ZONES' VIEW: no zones file is known and empty; unreadable at the first read, or the last good list kept over a broken file, is not read
  assert.strictEqual(F.zonesRead({ known: true, zones: [], why: 'absent' }), true, '(i)')
  assert.strictEqual(F.zonesRead({ known: true, zones: [{ id: 'a', box: [0, 0, 0, 1, 1, 1] }], why: 'ok' }), true)
  assert.strictEqual(F.zonesRead({ known: false, zones: [], why: 'unreadable' }), false, '(ii)')
  assert.strictEqual(F.zonesRead({ known: true, zones: [{ id: 'a', box: [0, 0, 0, 1, 1, 1] }], why: 'stale:unreadable' }), false, '(ii) the last good list over a file now broken')
  assert.strictEqual(F.zonesRead({ known: true, zones: [], why: 'stale:dropped 1 of 2' }), false, '(ii) a partly malformed edit')
  assert.strictEqual(F.zonesRead(null), false)
  // ...and the whole gate: the healthy, file-less town is OPEN; one torn bridge line closes it, named
  const ks = (() => null)
  assert.strictEqual(F.repairClosed({ keepOff: ks, unread: [...F.exclUnread(F.exclPlots(['wall']), () => head({ head: null, gens: [] })), ...F.exclUnread(['plan'], () => head()), ...unread({}), ...F.exclInputsUnread({ zones: () => F.zonesRead({ known: true, zones: [], why: 'absent' }) })] }), null)
  assert.strictEqual(F.repairClosed({ keepOff: ks, unread: unread({ 'expedition-0_70_0.bridges.jsonl': L(sight) + '{"op":' + '\n' }) }), 'excl_unread:bridges')
}
await t('r4 every strict reader, both halves: an absent file (or a never-sited record, no plan, no zones file) closes nothing; a present one that is malformed or holds ONE malformed line or entry closes, named', () => scenFiles())

say('r2 BLOCKER 2: THE LEDGER -- a column dug, filled and dug again stops at its budget; a record at its lifetime cap')
const scenBudget = (F = FC) => {
  const { srv, r0 } = holeScene()
  const fix = (r, T = F.FILLCOLUMN) => F.columnRepair(r, srv.read, { done: done(srv), now: NOW, T })
  const lay = (...ys) => { for (const y of ys) srv.set([4, y, 4], 'cobblestone') }
  // refresh 1: the floor two down
  dugRound(srv, { ring: 1, under: 2 })
  let fx = fix(r0)
  assert.deepStrictEqual(keys(fx.added), [xyz(4, G - 2, 4), xyz(4, G - 1, 4)])
  let r = fx.rec
  // the visits lay them; the bots dig them out again, two deeper, and the ground round the column with them
  lay(G - 2, G - 1)
  for (const [dx, dz] of N8) dig(srv, 4 + dx, 4 + dz, 3)
  for (let y = G - 1; y >= G - 4; y--) air(srv, 4, y, 4)
  fx = fix(r)
  assert.deepStrictEqual(keys(fx.added), [xyz(4, G - 4, 4), xyz(4, G - 3, 4)], 'refresh 2: two more, the column\'s budget of 4 is spent')
  r = fx.rec
  assert.deepStrictEqual(r.fillcol, { add: 4, left: 0, cols: { '4,4': [4, G - 4] } })
  assert.strictEqual(fx.n.total, 4)
  // ...and again: the budget is the column's for good, whatever is open now (the old caps counted open cells only)
  lay(G - 4, G - 3)
  for (const [dx, dz] of N8) dig(srv, 4 + dx, 4 + dz, 5)
  for (let y = G - 3; y >= G - 6; y--) air(srv, 4, y, 4)
  const wide = { ...F.FILLCOLUMN, depthMax: 99, floorDy: 99 }   // (the depth bounds set aside: the budget alone)
  fx = fix(r, wide)
  assert.strictEqual(fx.n.add, 0, 'refresh 3: the column stops at its budget')
  assert.strictEqual(fx.n.deep, 1, 'left out, counted')
  assert.strictEqual(fx.n.why.budget, 1)
  assert.strictEqual(fx.rec.waived[xyz(4, G - 4, 4)].why, 'fillcolumn:budget')
  assert.strictEqual(fix(r).n.add, 0, 'the same with every bound on')
  r = fx.rec
  assert.deepStrictEqual(r.fillcol.cols, { '4,4': [4, G - 4] }); assert.strictEqual(r.fillcol.add, 4)
  // many more refreshes of digging: not one more cell, ever
  for (let i = 0; i < 6; i++) {
    for (let y = G - 7 - i; y >= G - 8 - i; y--) air(srv, 4, y, 4)
    const f2 = fix(r, wide)
    assert.strictEqual(f2.n.add, 0, `refresh ${4 + i}`)
    r = f2.rec ?? r
  }
  assert.strictEqual(r.cells.filter(c => c.ext).length, 4, 'four cells added to the column in all')
  assert.ok(Math.min(...r.cells.map(c => c.at[1])) >= G - 4)
}
await t('dig, fill, dig, fill over nine refreshes: the column gets 4 cells in all, then is left out `budget` (the ledger is on the record)', () => scenBudget())
const scenFloor = (F = FC) => {
  // never under the survey's own scan floor (home.y - TIDY.dy): here the floor raised to home.y - 2 = G - 1
  const { srv, r0 } = holeScene()
  dugRound(srv)
  const fx = F.columnRepair(r0, srv.read, { done: done(srv), now: NOW, T: { ...F.FILLCOLUMN, floorDy: 2 } })
  leftOut(fx, 'deep', { deep: 1 })
  assert.strictEqual(F.columnRepair(r0, srv.read, { done: done(srv), now: NOW }).n.add, 2, 'the control: the survey\'s own floor (home.y - 14) is far below')
  assert.deepStrictEqual([F.FILLCOLUMN.addMax, F.FILLCOLUMN.depthMax, F.FILLCOLUMN.floorDy], [Math.max(T.INWALL.holeMax, (await0.ROUGH).fillMax), T.TIDY.pitDepthMax, T.TIDY.dy], 'the bounds ARE the survey\'s constants')
}
const await0 = { ROUGH: (await import('../src/roughground.mjs')).ROUGH }
await t('no cell under the survey\'s scan floor (control: the real floor); the bounds are the survey\'s own constants', () => scenFloor())
const scenLifetime = (F = FC) => {
  // two dug-out columns; the record may take 3 added cells in its life: the nearer column gets its 2, the other waits
  const mk = () => { const srv = server(); air(srv, 4, G, 4); air(srv, -12, G, 0); const r0 = site(srv); dugRound(srv); dugRound(srv, { cx: -12, cz: 0 }); return { srv, r0 } }
  const { srv, r0 } = mk()
  const small = { ...F.FILLCOLUMN, recMin: 3, recShare: 0 }
  assert.strictEqual(F.repairAddMax(r0, small), 3)
  const fx = F.columnRepair(r0, srv.read, { done: done(srv), now: NOW, T: small })
  assert.deepStrictEqual(fx.n, N({ ext: 1, add: 2, drop: 1, left: 1, total: 2, wait: { rec_cap: 1 }, why: { bare: 1 } }))
  assert.deepStrictEqual(keys(fx.added), [xyz(4, G - 2, 4), xyz(4, G - 1, 4)])
  assert.ok(!fx.rec.waived[xyz(-12, G, 0)], 'at the cap the other column is simply not repaired: nothing is waived')
  assert.strictEqual(fx.rec.fillcol.add, 2)
  assert.strictEqual(F.repairTotal(fx.n, fx.rec, small), 'fcadd2/3', 'the count and the cap, for the row')
  assert.strictEqual(F.repairNote(fx.n), 'wait:rec_cap1')
  assert.strictEqual(F.floatHold({ ...fx.rec, sitedAt: NOW }, srv.read, { done: done(srv), now: NOW + 1, env: ON }).size, 0, 'and its cell is not hidden: no hold while a column waits')
  // the count is the record's for good: the next refresh adds nothing either
  const again = F.columnRepair(fx.rec, srv.read, { done: done(srv), now: NOW + HOUR, T: small })
  assert.strictEqual(again.n.add, 0); assert.strictEqual(again.n.total, 2); assert.deepStrictEqual(again.n.wait, { rec_cap: 1 })
  // a record already at its cap: nothing; the control, the real cap: both columns
  const b = mk()
  assert.strictEqual(F.columnRepair({ ...b.r0, fillcol: { add: 3, left: 0, cols: {} } }, b.srv.read, { done: done(b.srv), now: NOW, T: small }).n.add, 0)
  assert.strictEqual(F.columnRepair(b.r0, b.srv.read, { done: done(b.srv), now: NOW }).n.add, 4)
  // a record from before the ledger reads zero, whatever stands in the field
  for (const old of [{}, { fillcol: null }, { fillcol: 'x' }, { fillcol: { cols: [1, 2] } }, { fillcol: { add: -5, left: 'no' } }]) assert.deepStrictEqual(F.repairLedger(old), { add: 0, left: 0, cols: {} })
  assert.deepStrictEqual(F.repairLedger({ fillcol: { add: '7', left: 2, cols: { '1,2': [3, 60] } } }), { add: 7, left: 2, cols: { '1,2': [3, 60] } })
  assert.strictEqual(F.repairAddMax(rec([])), 48); assert.strictEqual(F.repairAddMax(rec(Array.from({ length: 6020 }, (_, i) => cell(i, 0, 0)))), 602)
  assert.strictEqual(F.repairAddMax(rec([cell(0, 0, 0), cell(1, 0, 0, { ext: true }), cell(2, 0, 0, { prev: true })]), { ...F.FILLCOLUMN, recMin: 0, recShare: 1 }), 1, 'the share is of the SURVEYED fills: an added cell buys no room')
}
await t('the record\'s lifetime cap: at it a column is not repaired and nothing is waived; the count is on the record and the row; an old record reads zero', () => scenLifetime())

say('r2 BLOCKER 3: THE REPAIR\'S WAIVERS ARE NOT THE STUCK WAIVER\'S -- its room is whole, the repair has its own cap')
const scenRoom = ({ W = WALLM, GK = GKWM, PA = PAM } = {}) => {
  // 40 fills, 13 of them left out by the column repair (32%: over the 25% rule), 1 deferred and stuck for good
  const cs = Array.from({ length: 40 }, (_, i) => cell(40 + i, G, 40))
  const k = i => xyz(40 + i, G, 40)
  const waivedBy = why => Object.fromEntries(Array.from({ length: 13 }, (_, i) => [k(i), { why, at: 1, by: 'A' }]))
  const mine = rec(cs, { waived: { ...waivedBy('fillcolumn:bare'), [k(13)]: { why: 'fillcolumn:rests_on 1,2,3' } }, reach: { state: 'proven', pu: [k(20)] } })
  const stuck = { ...mine, waived: waivedBy('no_stand') }
  const def = [{ k: k(20), why: 'no_stand', visits: 9 }]
  // every counter of the waiver's room, the real one: with the repair's entries the room is WHOLE; the control: as many stuck waivers spend it
  assert.strictEqual(WR.stuckWaivedN(mine.waived), 0); assert.strictEqual(WR.repairWaivedN(mine.waived), 14)
  assert.strictEqual(WR.stuckWaivedN(stuck.waived), 13); assert.strictEqual(WR.repairWaivedN(stuck.waived), 0)
  assert.deepStrictEqual(W.wallWaiveDue(mine, def, T.gkWaiveOpts(mine, W.WALL_WAIVE_MAX)).map(d => d.k), [k(20)], 'wallWaiveDue (the visit\'s waiver)')
  assert.deepStrictEqual(W.wallWaiveDue(stuck, def, T.gkWaiveOpts(stuck, W.WALL_WAIVE_MAX)), [])
  assert.deepStrictEqual(GK.stallWaive(mine, def, { stalled: true }).map(d => d.k), [k(20)], 'stallWaive (the 25% rule)')
  assert.deepStrictEqual(GK.stallWaive(stuck, def, { stalled: true }), [])
  assert.deepStrictEqual(GK.leftWaiveDue(mine, new Map([[k(20), 3]]), [k(20)]).map(d => d.k), [k(20)], 'leftWaiveDue (the 25% rule)')
  assert.deepStrictEqual(GK.leftWaiveDue(stuck, new Map([[k(20), 3]]), [k(20)]), [])
  assert.deepStrictEqual(PA.puWaiveDue(mine, [k(20)], { confirm: () => true }).map(d => d.k), [k(20)], 'puWaiveDue (the 25% rule)')
  assert.deepStrictEqual(PA.puWaiveDue(stuck, [k(20)], { confirm: () => true }), [])
}
await t('a record whose fillcolumn omissions exceed 25%: wallWaiveDue, stallWaive, leftWaiveDue and puWaiveDue still have their full room (control: as many stuck waivers spend it)', () => scenRoom())
const scenDependentsRoom = (F = FC) => {
  // the stuck waiver names a lower cell; the cell resting on it goes with it -- under the repair's reason, so the stuck count does
  // not move, and at the repair's own cap it does not go (it stays open: deferred and counted like any cell)
  const srv = server()
  dig(srv, 4, 4, 2)
  for (const [dx, dz] of N8) dig(srv, 4 + dx, 4 + dz, 1)
  const r0 = rec([cell(4, G - 1, 4, { role: 'core' }), cell(4, G, 4)])
  const due = [{ k: xyz(4, G - 1, 4), why: 'no_stand' }]
  const rests = F.waiveRests(r0, due, srv.read, { done: done(srv), env: ON })
  assert.strictEqual(rests.length, 1)
  const w = Object.fromEntries([...due, ...rests].map(d => [d.k, { why: d.why }]))
  assert.strictEqual(WR.stuckWaivedN(w), 1, 'one stuck waiver, whatever rested on it')
  assert.strictEqual(WR.repairWaivedN(w), 1)
  // the repair's cap (here 12: the record is small) already spent: no dependent is waived
  const full = { ...r0, waived: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [xyz(90 + i, G, 90), { why: 'fillcolumn:bare' }])) }
  assert.strictEqual(F.repairOutMax(r0), 12)
  assert.deepStrictEqual(F.waiveRests(full, due, srv.read, { done: done(srv), env: ON }), [])
  const one0 = { ...full, waived: Object.fromEntries(Object.entries(full.waived).slice(0, 11)) }
  assert.strictEqual(F.waiveRests(one0, due, srv.read, { done: done(srv), env: ON }).length, 1, 'the control: one place left')
  // 12 STUCK waivers do not spend the repair's cap either (the two are counted apart both ways)
  const other = { ...r0, waived: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [xyz(90 + i, G, 90), { why: 'no_stand' }])) }
  assert.strictEqual(F.waiveRests(other, due, srv.read, { done: done(srv), env: ON }).length, 1)
}
await t('the dependents rule never moves the stuck count, and stops at the repair\'s own cap (control: one place left)', () => scenDependentsRoom())
const scenOutCap = (F = FC) => {
  // two columns the repair would leave out (the ground round each dug 9 down), room for ONE omission
  const mk = () => { const srv = server(); air(srv, 4, G, 4); air(srv, -12, G, 0); const r0 = site(srv); dugRound(srv, { ring: 9 }); dugRound(srv, { ring: 9, cx: -12, cz: 0 }); return { srv, r0 } }
  const { srv, r0 } = mk()
  const one1 = { ...F.FILLCOLUMN, outMin: 1, outShare: 0 }
  const fx = F.columnRepair(r0, srv.read, { done: done(srv), now: NOW, T: one1 })
  assert.deepStrictEqual(fx.n, N({ drop: 1, left: 1, wait: { out_cap: 1 }, why: { bare: 1 } }))
  assert.deepStrictEqual(Object.keys(fx.rec.waived), [xyz(4, G, 4)], 'the nearer one is left out; at the cap NOTHING more is waived')
  // no cell is hidden: the other one is still open for the completion, named by the self-check, and NOT held by the visit
  assert.strictEqual(F.planSelfCheck(fx.rec, srv.read, { done: done(srv), env: ON }).left, 1)
  assert.strictEqual(F.floatHold({ ...fx.rec, sitedAt: NOW }, srv.read, { done: done(srv), now: NOW + 1, env: ON }).size, 0)
  assert.strictEqual(F.openFills(fx.rec, { done: done(srv) }).length, 1)
  // the control: the real cap -- both are left out
  const b = mk()
  assert.strictEqual(F.columnRepair(b.r0, b.srv.read, { done: done(b.srv), now: NOW }).n.drop, 2)
  // a column that would get cells AND lose its top is not repaired at all at the cap: no cell added either
  const c = holeScene()
  dugRound(c.srv)
  const f0 = F.columnRepair(c.r0, c.srv.read, { done: done(c.srv), now: NOW, T: { ...F.FILLCOLUMN, outMin: 0, outShare: 0 } })
  assert.deepStrictEqual(f0.n, N({ left: 1, wait: { out_cap: 1 } }))
  assert.deepStrictEqual(fillK(f0.rec), fillK(c.r0)); assert.strictEqual(f0.rec.waived, undefined)
}
await t('at the repair\'s own cap nothing more is left out, the column is not repaired, and its cell is not hidden (control: under the cap both are left out)', () => scenOutCap())

say('THE WAIVER')
const scenWaivedBelow = (F = FC) => {
  // the record's own lower cell was WAIVED (counted done, no block): the cell above it floats -- it is left out, never extended
  const srv = server()
  dig(srv, 4, 4, 2)
  for (const [dx, dz] of N8) dig(srv, 4 + dx, 4 + dz, 1)
  const r0 = rec([cell(4, G - 1, 4, { role: 'core' }), cell(4, G, 4)], { waived: { [xyz(4, G - 1, 4)]: { why: 'no_stand', at: 1, by: 'A' } } })
  assert.deepStrictEqual(walk(r0, srv, F).leftK, [xyz(4, G, 4)])
  const fx = F.columnRepair(r0, srv.read, { done: done(srv), now: NOW })
  assert.deepStrictEqual(fx.n, N({ ext: 0, add: 0, deep: 0, drop: 1, back: 0, left: 0, total: 0, why: { waived_below: 1 } }))
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
  assert.deepStrictEqual(F.waiveRests(r0, due, srv.read, { done: done(srv), env: ON }), [{ k: xyz(4, G, 4), why: `fillcolumn:rests_on ${xyz(4, G - 1, 4)}` }])
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
  // the last repair left a cell unresolved (a column that waits: unread, a cap, the exclusions unread): nothing is held -- every
  // floating cell is deferred and counted again, none is hidden behind a repair that is not coming
  assert.strictEqual(F.floatHold({ ...r0, fillcol: { add: 0, left: 1, cols: {} } }, srv.read, at).size, 0)
  assert.strictEqual(F.floatHold({ ...r0, fillcol: { add: 5, left: 0, cols: {} } }, srv.read, at).size, 1, 'the control: nothing unresolved')
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
  rowSurvives('_build', { project: 'tidy', op: 'refreshed', n: 12, kind: 'cut12/fill345/cols67/cap0', result: tag, to: FC.repairTotal({ total: 9999 }, rec(Array.from({ length: 99999 }, (_, i) => cell(i, 0, 0)))), st: FC.repairNote({ wait: { rec_cap: 999, out_cap: 999, unread: 999, cap: 999 } }), why: 'busy:2,known:1', gen: 7 })
  rowSurvives('_build', { project: 'tidy', op: 'refreshed', result: tag, st: FC.repairNote({}, FC.repairClosed({ unread: ['wall', 'wallext', 'townhall', 'storehub', 'land', 'zones'] })) })
  assert.strictEqual(FC.repairNote(N()), null); assert.strictEqual(FC.repairNote(N({ wait: { rec_cap: 2 } })), 'wait:rec_cap2')
  assert.strictEqual(FC.repairNote(N(), 'excl_unread:shaft'), 'closed:excl_unread:shaft')
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
    "try { ({ res, fx } = refreshRepair(res, cur, read, { done: q => buildCellDone(read(...q.at), TIDY_PALETTE, q.role), guard, mayAdd: q => !cellInZones(q[0], q[1], q[2], c?.zones ?? []), keepOff: fcKeepOff ?? (() => 'closed'), closed: fcClosed, now, by: me })) } catch { fx = null }",
    'return refreshClaimed(refreshStamp(res.rec ?? cur, { now, added: res.added, skipped: res.skipped, cap }), claims, claimRetire)',
    '...(fx ? { result: repairTag(fx.n), to: repairTotal(fx.n, res?.rec ?? r0), ...(repairNote(fx.n, fcClosed ?? (fx.err ? `error:${fx.err}` : null)) ? { st: repairNote(fx.n, fcClosed ?? (fx.err ? `error:${fx.err}` : null)) } : {}) } : {})',
    "|| farmWater(q) || guard.has(q.at.join(',')) || floatHeld.has(q.at.join(',')) || (!!rec.waived && Object.prototype.hasOwnProperty.call(rec.waived, q.at.join(',')))",
    'try { floatHeld = fillFloatHold(rec, read, { done: q => buildCellDone(read(...q.at), palette, q.role), guard }) } catch { floatHeld = new Set() }',
    'const floorDone = q => waivedK(q) || buildCellDone(read(...q.at), palette, q.role)',
    'const waive = waive0p.length ? [...waive0p, ...waiveRests(rec, waive0p, read2, { done: q => buildCellDone(read2(...q.at), palette, q.role), guard })] : waive0p',
    'if (due.length) due.push(...waiveRests(rw, due, read2, { done: q => buildCellDone(read2(...q.at), palette, q.role), guard }))',
    'fcheck = planSelfCheck(body, rdc, { done: q => buildCellDone(rdc(...q.at), TIDY_PALETTE, q.role) })',
    "...(fcheck ? { result: `float${fcheck.left}/${fcheck.open}${fcheck.err ? '/err' : ''}` } : {})",
    // r2: the exclusions are THIS refresh's survey's own, the records behind them read strictly, the repair closed when one is unread
    'fcUnread = fillExclUnread(fillExclPlots(projectsGuarded().map(p => p.plot)), pl => recordHead(dir, projKeyOf(pl)))',
    // r3: every other input of the exclusions read strictly too
    "fcUnread.push(...fillExclUnread(['plan'], () => h))",
    // r4: the files by the one strict reader that drops nothing (never exBridgeSitesStrict, which drops a line it cannot parse)
    'fcUnread.push(...fillExclFilesUnread({ dir, hk: exHk(), markersFile: exMarkersFile(), bridgesFile: exBridgesFile() }))',
    'fcUnread.push(...fillExclInputsUnread({',
    'zones: () => c?.zonesKnown === true && fillZonesRead(townPlanZones(bot)),',
    'hallpad: () => !projectsOn().some(p => p.plot === HALL_PLOT) || !!blueprintOf(HALL_BLUEPRINT),',
    "fcKeepOff = typeof s?.keepOff === 'function' ? s.keepOff : null",
    'const fcClosed = repairClosed({ keepOff: fcKeepOff, unread: fcUnread })',
  ]
  const wired = src => LINES.every(l => src.split(l).length === 2) &&
    // the repair runs on the merge's result and before the stamp; the hold is filled before the visit's first done test
    src.indexOf(LINES[0]) < src.indexOf(LINES[1]) && src.indexOf(LINES[1]) < src.indexOf(LINES[2]) && src.indexOf(LINES[5]) < src.indexOf(LINES[6])
  for (const l of LINES) assert.strictEqual(s.split(l).length, 2, `wiring missing or not unique: ${l}`)
  assert.ok(wired(s))
  assert.ok(!wired(s.replace(" || floatHeld.has(q.at.join(','))", '')), 'MUTANT: the hold not read by the visit still reads wired')
  assert.ok(!wired(s.replace(LINES[1], '')), 'MUTANT: the repair cut out of the publish still reads wired')
  assert.ok(!wired(s.replace(LINES[1], '').replace(LINES[2], `${LINES[2]}\n${LINES[1]}`)), 'MUTANT: the repair after the stamp still reads wired')
  assert.ok(!wired(s.replace("fcKeepOff = typeof s?.keepOff === 'function' ? s.keepOff : null", 'fcKeepOff = I.avoid')), 'MUTANT: an exclusion rebuilt beside the survey\'s still reads wired')
  assert.ok(!wired(s.replace('fillExclPlots(projectsGuarded().map(p => p.plot))', '[...projectsGuarded().map(p => p.plot), LAND_PLOT]')), 'MUTANT (r3): the strict read without the site-prep record still reads wired')
  assert.ok(!wired(s.replace('bridgesFile: exBridgesFile() }))', 'bridgesFile: null }))')), 'MUTANT (r4): the bridge sites left out of the strict read still reads wired')
  assert.ok(!/exBridgeSitesStrict\(\) !== null/.test(s.slice(s.indexOf(LINES[0]) - 6000, s.indexOf(LINES[0]))), 'the lenient-on-lines bridge reader is not what the repair trusts')
  // the four counters of the waiver's room read the stuck waivers only (waiveroom.mjs): nowhere the map's bare size
  for (const [f, n] of [['wall.mjs', 1], ['gkwork.mjs', 2], ['planahead.mjs', 1]]) {
    const src = strip(readFileSync(URL_OF(f), 'utf8'))
    assert.strictEqual(src.split('stuckWaivedN(have)').length - 1, n, `${f}: the room counts stuck waivers`)
    assert.ok(!/Object\.keys\(have\)\.length/.test(src), `${f}: no counter reads the waived map's bare size`)
  }
  assert.ok(/Object\.keys\(have\)\.length/.test(strip(readFileSync(URL_OF('sinks.mjs'), 'utf8'))), 'the control: the pattern is found where it stands (the sinks\' own records, never the tidy\'s)')
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
await kills('the column\'s budget removed (a 5-deep cavity is filled)', "        if (had + i > T.addMax) { why = 'budget'; break }\n", '', scenDeep)
await kills('the depth under the surveyed top removed (a column of 7)', "        if (y - i < minY) { why = 'deep'; break }\n", '', scenColumnMax)
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
await kills('the exclusions no longer stop the column', "let why = keepOff(x, z) ? 'excluded' : null", 'let why = null', scenReserved)
await kills('a cell left out for whose ground it is comes back', "if (!/^fillcolumn:(?!guarded$|excluded$)/.test(String(v?.why ?? ''))) return false", "if (!/^fillcolumn:/.test(String(v?.why ?? ''))) return false", scenReserved)
await kills('the hold while the last repair left cells unresolved (a cell hidden behind a repair that is not coming)', '  if (repairLedger(rec).left > 0) return false\n', '', scenHold)
await kills('the repair asks the done test of the world once and then never again (a cell laid is read open)', 'if (v === undefined) { v = !!done(c); dm.set(k, v) } return v }', 'if (v === undefined) { v = false; dm.set(k, v) } return v }', scenDone)
await kills('a waived cell under the column no longer stops it', "        if (hasOwn(w, qk)) { why = 'waived_below'; break }\n        if (known.has(qk)) { why = 'record_below'; break }\n", '', scenWaivedBelow)
await kills('an unread cell on the way down read as a reason to leave the column out', "if (why === 'unread' || why === 'cap' || why === 'rec_cap') { waits(k, why); continue }", "if (why === 'cap' || why === 'rec_cap') { waits(k, why); continue }", scenUnreadBelow)
await kills('the page\'s bound removed', "      if (!why && gap.length > room) why = 'cap'\n", '', scenPage)
await kills('a cell comes back with nothing beside it', 'return solidNow(x, y - 1, z) && SIDES.some(([dx, dz]) => solidNow(x + dx, y, z + dz))', 'return solidNow(x, y - 1, z)', scenBack)
await kills('a column with its own bookkeeping is judged', 'left: po.left.filter(c => !sp.has(colOf(c.at))) }', 'left: po.left }', scenSpecial)
await kills('the hold never lapses (a hold with no refresh behind it)', 'return Number.isFinite(at) && at <= now + 60_000 && now - at < T.holdMs', 'return Number.isFinite(at)', scenHold)
await kills('the hold on a record no refresh serves', ' || rec.stageId !== TIDYREFRESH.inwallId) return false', ') return false', scenHold)
await kills('the hold with the refresh switched off', 'if (!fillColumnOn(env) || !tidyRefreshOn(env) || !rec', 'if (!fillColumnOn(env) || !rec', scenHold)
await kills('the property: the repair leaves the cell above a left-out cell in mid-air', "      waive[lk] = { why: `fillcolumn:${why}`, at: now, by }\n", '', (M) => scenProperty(M, 3))

for (const n of NOTES) console.log(`  NOTE  ${n}`)
await kills('r2/1 the repair runs although the exclusions could not be read', '  if (closed) return { rec: out(rec), n, added, dropped }\n', '', scenClosed)
await kills('r2/1 an unreadable record read as read', "if (!h?.ok || (h.rejected ?? []).some(r => r.gen === (h.gens ?? []).at(-1))) out.push(String(p))", "if ((h?.rejected ?? []).some(r => r.gen === (h.gens ?? []).at(-1))) out.push(String(p))", scenClosed)
await kills('r2/1 a rejected newest generation read as read', "if (!h?.ok || (h.rejected ?? []).some(r => r.gen === (h.gens ?? []).at(-1))) out.push(String(p))", 'if (!h?.ok) out.push(String(p))', scenClosed)
await kills('r2/1 unread records do not close the repair', "  if ((unread ?? []).length) return `excl_unread:${unread.join('+')}`.slice(0, 40)\n", '', scenClosed)
await kills('r2/1 no exclusions at all does not close the repair', "return typeof keepOff === 'function' ? null : 'no_exclusions'", 'return null', scenClosed)
await kills('(a) a repair that throws leaves the hold up (a cell hidden behind a repair that cannot run)', 'fillcol: { add: led.add, left: Math.max(1, led.left), cols: led.cols } } : null, added: [], dropped: [],', 'fillcol: { add: led.add, left: led.left, cols: led.cols } } : null, added: [], dropped: [],', scenClosed)
await kills('r2/1 the exclusions not asked (a well is filled)', "let why = keepOff(x, z) ? 'excluded' : null", 'let why = null', scenVolumes)
await kills('r2/1 tidy.mjs: the survey hands on exclusions without `avoid` (wells, shafts, buildings)', "(noLitterK(x, z) ? 'no_litter' : reservedP(x, z) ? 'reserved' : (avoid(x, z) ?? null))", "(noLitterK(x, z) ? 'no_litter' : reservedP(x, z) ? 'reserved' : null)", TM => scenVolumes(FC, TM), URL_OF('tidy.mjs'))
await kills('r2/1 tidy.mjs: ...without the reservations', "(noLitterK(x, z) ? 'no_litter' : reservedP(x, z) ? 'reserved' : (avoid(x, z) ?? null))", "(noLitterK(x, z) ? 'no_litter' : (avoid(x, z) ?? null))", TM => scenVolumes(FC, TM), URL_OF('tidy.mjs'))
await kills('r2/1 tidy.mjs: ...without the yard', "(noLitterK(x, z) ? 'no_litter' : reservedP(x, z) ? 'reserved' : (avoid(x, z) ?? null))", "(reservedP(x, z) ? 'reserved' : (avoid(x, z) ?? null))", TM => scenVolumes(FC, TM), URL_OF('tidy.mjs'))
await kills('r2/2 the column\'s lifetime budget removed (dig, fill, dig: extended for ever)', "        if (had + i > T.addMax) { why = 'budget'; break }\n", '', scenBudget)
await kills('r2/2 the budget read from the open cells, not the ledger', 'const had = Math.max(0, Number(colsL[k]?.[0]) || 0)', 'const had = 0', scenBudget)
await kills('r2/2 the ledger not written for the cells added', 'colsL[k] = [(Number(e?.[0]) || 0) + 1, ', 'colsL[k] = [0, ', scenBudget)
await kills('r2/2 the scan floor removed', 'const minY = Math.max((colTop.get(k) ?? y) - (T.depthMax - 1), floorY)', 'const minY = (colTop.get(k) ?? y) - (T.depthMax - 1)', scenFloor)
await kills('r2/2 the record\'s lifetime cap removed', "      if (!why && gap.length > recRoom) why = 'rec_cap'\n", '', scenLifetime)
await kills('r2/2 the lifetime count forgotten between refreshes', 'let room = T.refreshMax - added.length, recRoom = recMax - led.add - added.length', 'let room = T.refreshMax - added.length, recRoom = recMax - added.length', scenLifetime)
await kills('r2/3 wall.mjs: the room counts every waived entry', 'let room = max - stuckWaivedN(have)', 'let room = max - Object.keys(have).length', M => scenRoom({ W: M }), URL_OF('wall.mjs'))
await kills('r2/3 gkwork.mjs stallWaive: the room counts every waived entry', 'Math.ceil(G.stallShare * cells.size) - stuckWaivedN(have))', 'Math.ceil(G.stallShare * cells.size) - Object.keys(have).length)', M => scenRoom({ GK: M }), URL_OF('gkwork.mjs'))
await kills('r2/3 gkwork.mjs leftWaiveDue: the room counts every waived entry', 'Math.ceil(share * size) - stuckWaivedN(have))', 'Math.ceil(share * size) - Object.keys(have).length)', M => scenRoom({ GK: M }), URL_OF('gkwork.mjs'))
await kills('r2/3 planahead.mjs puWaiveDue: the room counts every waived entry', 'Math.ceil(P.share * size) - stuckWaivedN(have) - taken.size', 'Math.ceil(P.share * size) - Object.keys(have).length - taken.size', M => scenRoom({ PA: M }), URL_OF('planahead.mjs'))
await kills('r2/3 the dependents waived under the stuck waiver\'s reason', "why: `fillcolumn:rests_on ${kOf(low.get(col))}` }); room--", "why: `rests_on_waived ${kOf(low.get(col))}` }); room--", scenDependentsRoom)
await kills('r2/3 the dependents past the repair\'s cap', '    if (room <= 0) { cut.add(col); continue }   // never a cell over one that stays open\n', '', scenDependentsRoom)
await kills('r2/3 the repair\'s cap counted with the stuck waivers', 'let room = repairOutMax(rec, T) - repairWaivedN(rec.waived)', 'let room = repairOutMax(rec, T) - Object.keys(rec.waived ?? {}).length', scenDependentsRoom)
await kills('r2/3 the omissions\' cap removed (the repair leaves out without bound)', '        if (outRoom > 0) { outRoom--; continue }\n', '        if (outRoom > -Infinity) { outRoom--; continue }\n', scenOutCap)
await kills('r2/3 at the cap the column still gets its cells (a bare top is then laid)', "        plan.delete(k); waits(k, 'out_cap'); over = true\n", "        waits(k, 'out_cap')\n", scenOutCap)

await kills('r3/1 the strict read without the site-prep record', 'export const exclPlots = (guarded = []) => [...new Set([...(guarded ?? []).map(String), LAND_PLOT, SITEPREP_PLOT])]', 'export const exclPlots = (guarded = []) => [...new Set([...(guarded ?? []).map(String), LAND_PLOT])]', scenSiteprep)
await kills('r3/1 the strict read without the land plan', 'export const exclPlots = (guarded = []) => [...new Set([...(guarded ?? []).map(String), LAND_PLOT, SITEPREP_PLOT])]', 'export const exclPlots = (guarded = []) => [...new Set([...(guarded ?? []).map(String), SITEPREP_PLOT])]', scenSiteprep)
await kills('r3/1 an input whose check throws read as read', 'let v = false; try { v = ok() === true } catch { v = false } if (!v) out.push(name)', 'let v = false; try { v = ok() === true } catch { v = true } if (!v) out.push(name)', scenSiteprep)
await kills('r3/1 an input whose check is merely truthy read as read', 'let v = false; try { v = ok() === true } catch { v = false } if (!v) out.push(name)', 'let v = false; try { v = !!ok() } catch { v = false } if (!v) out.push(name)', scenSiteprep)
await kills('r3/2 the column\'s count is the ledger\'s alone (the max() gone)', 'cols[k] = [Math.max(cols[k]?.[0] ?? 0, cnt), Math.min(cols[k]?.[1] ?? Infinity, low)]', 'cols[k] = [cols[k]?.[0] ?? cnt, Math.min(cols[k]?.[1] ?? Infinity, low)]', scenLedgerCells)
await kills('r3/2 the column\'s lowest y is the ledger\'s alone', 'cols[k] = [Math.max(cols[k]?.[0] ?? 0, cnt), Math.min(cols[k]?.[1] ?? Infinity, low)]', 'cols[k] = [Math.max(cols[k]?.[0] ?? 0, cnt), cols[k]?.[1] ?? low]', scenLedgerCells)
await kills('r3/2 the cells are not read at all (the ledger trusted alone)', '    if (!c?.ext || !Array.isArray(c.at)) continue\n    ext++\n', '    if (c) continue\n    ext++\n', scenLedgerCells)
await kills('r3/2 the record\'s total is the ledger\'s alone', 'return { add: Math.max(Math.max(0, Number(f?.add) || 0), ext), left:', 'return { add: Math.max(0, Number(f?.add) || 0), left:', scenLedgerCells)
await kills('r4 a bridge line that does not parse is dropped (the blocker)', "    for (const l of txt.split('\\n').filter(q => q.trim()).slice(-max)) { let v; try { v = JSON.parse(l) } catch { return false } if (!obj(v) || !lineOk(v)) return false }", "    for (const l of txt.split('\\n').filter(q => q.trim()).slice(-max)) { let v; try { v = JSON.parse(l) } catch { continue } if (!obj(v) || !lineOk(v)) return false }", scenFiles)
await kills('r4 a line that parses to no entry is dropped', "catch { return false } if (!obj(v) || !lineOk(v)) return false }", "catch { return false } if (!obj(v) || !lineOk(v)) continue }", scenFiles)
await kills('r4 an ABSENT jsonl file closes the repair', "    try { txt = fsx.readFileSync(f, 'utf8') } catch (e) { return e?.code === 'ENOENT' }\n    for (const l of", "    try { txt = fsx.readFileSync(f, 'utf8') } catch (e) { return false }\n    for (const l of", scenFiles)
await kills('r4 a jsonl file that cannot be read passes as none', "    try { txt = fsx.readFileSync(f, 'utf8') } catch (e) { return e?.code === 'ENOENT' }\n    for (const l of", "    try { txt = fsx.readFileSync(f, 'utf8') } catch (e) { return true }\n    for (const l of", scenFiles)
await kills('r4 an ABSENT json file closes the repair', "return e?.code === 'ENOENT' ? { absent: true } : { bad: true } }", 'return { bad: true } }', scenFiles)
await kills('r4 a json file that cannot be read passes as none', "return e?.code === 'ENOENT' ? { absent: true } : { bad: true } }", 'return { absent: true } }', scenFiles)
await kills('r4 a sighting with no span passes', "v => v.op !== 'sight' || (obj(v.span) && Array.isArray(v.span.near) && Array.isArray(v.span.axis))", 'v => true', scenFiles)
await kills('r4 a marker with no place passes', 'markers: () => jsonl(markersFile, 2000, v => fin3(v.at)),', 'markers: () => jsonl(markersFile, 2000, v => true),', scenFiles)
await kills('r4 a malformed plinth passes', '    if (pj.bad || (!pj.absent && !plinthOk(pj.v))) return false\n', '    if (pj.bad) return false\n', scenFiles)
await kills('r4 a malformed prev column of the plinth passes', "    if (r.prev != null && !(Array.isArray(r.prev) && r.prev.every(c => obj(c) && [c.x, c.y, c.z].every(Number.isFinite) && (c.stair == null || (Array.isArray(c.stair) && c.stair.every(fin3)))))) return false\n", '', scenFiles)
await kills('r4 a well site with no place passes', "return gen(`junkwell-site-${hk}`, v => obj(v) && [v.x, v.y, v.z].every(Number.isFinite))", "return gen(`junkwell-site-${hk}`, v => obj(v))", scenFiles)
await kills('r4 a torn newest generation passes (or an older one stands in)', 'return !j.bad && !j.absent && ok(j.v) }', 'return j.bad || j.absent || ok(j.v) }', scenFiles)
await kills('r4 a tree-farm cell with no place passes', 'return Array.isArray(cs) && cs.every(c => obj(c) && Number.isFinite(c.x) && Number.isFinite(c.z)) })', 'return Array.isArray(cs) })', scenFiles)
await kills('r4 a malformed town site passes', "const site = () => gen(`composter-site-${hk}`, v => obj(v) && [v.x, v.y, v.z].every(Number.isInteger))", "const site = () => gen(`composter-site-${hk}`, v => obj(v))", scenFiles)
await kills('r4 a directory that cannot be listed reads as empty', "  try { names = fsx.readdirSync(dir) } catch (e) { if (e?.code !== 'ENOENT') listed = false }\n", '  try { names = fsx.readdirSync(dir) } catch (e) { /* none */ }\n', scenFiles)
await kills('r4 a town with no directory closes the repair', "  try { names = fsx.readdirSync(dir) } catch (e) { if (e?.code !== 'ENOENT') listed = false }\n", '  try { names = fsx.readdirSync(dir) } catch (e) { listed = false }\n', scenFiles)
await kills('r4 the last good zones kept over a broken file read as read', "export const zonesRead = view => view?.known === true && Array.isArray(view.zones) && !/^stale/.test(String(view.why ?? ''))", 'export const zonesRead = view => view?.known === true && Array.isArray(view.zones)', scenFiles)
await kills('r4 unknown zones read as read', "export const zonesRead = view => view?.known === true && Array.isArray(view.zones) && !/^stale/.test(String(view.why ?? ''))", "export const zonesRead = view => Array.isArray(view?.zones) && !/^stale/.test(String(view.why ?? ''))", scenFiles)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
