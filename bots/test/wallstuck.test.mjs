// WALLSTUCK-01 (LIVE showcase 10-30): THE WALL'S LAST CELLS. The wall stood at 936 of 941 (an RCON read of every record cell); Gale's
// 23:17Z visit stamped W-03's two cells stuck (stalled: nothing else open in ITS visit) and every bot's build order skipped
// `stuck_on_cell` for 6 h. The five open cells, read from the world (test/fixtures/wallstuck-showcase-wall-1030.json):
//   W-01 23,69,-19 granite + 23,70,-19 dirt -- set in the built steps after siting, a granite block on the walk above (23,71,-19):
//        every face of both covered, `clear_failed no_stand` every visit since 13:46Z, each visit stopped `blocked` there;
//   W-03 35,68,6 (+ 35,69,6 over it) -- the column's lowest cell, its ground (35,67,6) dug away after siting: no face to place on;
//        34,69,4 -- a step cell over ground dug two deep (34,67..68,4), its five other faces solid: seen only from the dug hollow.
// The remedies (buildrun.mjs runVisit `p.sealed`, `p.footing`, `p.stuckStalledOnly`), the waiver (wall.mjs wallWaiveDue), and the
// order's back-off held to the stuck segment (shop.mjs stuckOtherWork): pure on the live geometry, then chained on the fake server,
// each remedy killed by a mutant (anchors asserted present and unique).
import assert from 'node:assert'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const { R, PJ, G, HOME, server, bot, withMutant } = await import('./helpers/buildfake.mjs')
const W = await import('../src/wall.mjs')
const S = await import('../src/shop.mjs')
const mc = createRequire(import.meta.url)('minecraft-data')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const k = a => a.join(',')
/** The scenario passes on the real module; the mutant fails the scenario's OWN assertion (not any error). */
const killedBy = async (old, neu, scenario) => {
  await scenario(R)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}

// ---- the live geometry -------------------------------------------------------------------------------------------------------
const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/wallstuck-showcase-wall-1030.json', import.meta.url), 'utf8'))
const box = n => mc.blocksByName[n]?.boundingBox ?? 'block'
const live = (x, y, z) => { const n = FX.world[`${x},${y},${z}`]; return !n || n === '?' ? null : { name: n, boundingBox: box(n) } }
const cellKeys = new Set(FX.cells.map(c => k(c.at)))
const isCell = q => cellKeys.has(k(q))

console.log('THE LIVE CELLS (pure, on the fixture)')
await t('W-01: the sealed column is dug from its top -- the granite on the walk, then the dirt, then the granite', () => {
  const open = new Set(['23,69,-19', '23,70,-19'])
  const sa = R.sealedAbove(live, [23, 69, -19], { isOpenForeign: q => open.has(k(q)) && R.foreignKind(live(...q)?.name, W.WALL_FOREIGN) === 'scaffold', isCell, scaffold: W.WALL_FOREIGN })
  assert.ok(sa.ok, sa.why)
  assert.deepStrictEqual(sa.digs.map(d => [k(d.at), d.name, d.kind]), [['23,71,-19', 'granite', 'overburden'], ['23,70,-19', 'dirt', 'foreign'], ['23,69,-19', 'granite', 'foreign']])
  // the cap is no record cell; above it air (positive control: the scan reads the column)
  assert.ok(!isCell([23, 71, -19]) && live(23, 72, -19).name === 'air')
})
await t('W-03: 35,68,6 gets its sited floor back (35,67,6, over grass at 66); 34,69,4 two cells (34,67..68,4); a floored cell needs none', () => {
  assert.deepStrictEqual(R.footingBelow(live, [35, 68, 6], { isCell }), { ok: true, cells: [[35, 67, 6]], why: null, hard: false })
  assert.deepStrictEqual(R.footingBelow(live, [34, 69, 4], { isCell }).cells, [[34, 67, 4], [34, 68, 4]])
  assert.strictEqual(R.footingBelow(live, [35, 69, 6], { isCell }).why, 'floored', 'over an (open) record cell: never a footing')
  assert.strictEqual(R.footingBelow(live, [35, 70, 6], { isCell }).why, 'floored')
  assert.strictEqual(R.footingBelow(live, [34, 69, 3], { isCell }).why, 'floored', 'a step on its ground (34,68,3 dirt): nothing to fill')
  assert.strictEqual(live(34, 68, 3).name, 'dirt', 'positive control: the scan reads that ground')
})
await t('footingBelow refuses: deeper than FOOTING_MAX, a liquid, a block it may not replace, a veto, an unread cell', () => {
  const at = [0, 70, 0]
  const col = names => (x, y, z) => { if (x || z) return { name: 'stone', boundingBox: 'block' }; const n = names[70 - y - 1]; return n === null ? null : { name: n ?? 'stone', boundingBox: box(n ?? 'stone') } }
  assert.deepStrictEqual(R.footingBelow(col(['air', 'air', 'air', 'stone']), at).cells.length, 3)
  assert.match(R.footingBelow(col(['air', 'air', 'air', 'air', 'stone']), at).why, /^deep/)
  assert.match(R.footingBelow(col(['air', 'water']), at).why, /^liquid water/)
  assert.match(R.footingBelow(col(['air', 'chest', 'stone']), at).why, /^vetoed|^kept|^liquid/, 'a chest is solid: the floor (refUsable says no -- a click would open it)')
  assert.match(R.footingBelow(col(['air', 'stone']), at, { mayPlace: () => false }).why, /^vetoed/)
  assert.deepStrictEqual(R.footingBelow(col([null]), at).hard, false)
  assert.match(R.footingBelow(col(['air', 'stone']), at, { isCell: q => q[1] === 68 }).why, /^record_cell/)
})

// ---- the chains on the fake server -------------------------------------------------------------------------------------------
const wallRec = (cells, segs) => ({ v: 1, plot: W.WALL_PLOT, blueprint: W.WALL_BLUEPRINT, cells, clear: [], replant: [], segments: segs.map(seg => ({ seg, deps: [] })) })
function project (record) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/wallstuck-`)
  const key = PJ.projKey(HOME, W.WALL_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slots = {}
  const p = (n, extra = {}) => {
    slots[n] ??= PJ.takeSlot(dir, key, n, W.WALL_BUILDERS)
    return { dir, key, me: n, home: HOME, stood: [], record, recordGen: pub.gen, palette: W.WALL_PALETTE, slot: slots[n].slot, slotGen: slots[n].gen,
      domain: () => true, walkR: 40, foreign: W.WALL_FOREIGN, blockLayer: false, stands: { pending: null, bans: {} }, ...extra }
  }
  return { dir, key, p }
}
const inv = () => ({ cobblestone: 64 })
const done = (srv, rec, waived = {}) => rec.cells.every(c => waived[k(c.at)] || R.cellDone(srv.read(...c.at), W.WALL_PALETTE, c.role))
const REMEDIES = { sealed: { mayDig: () => true }, footing: { mayPlace: () => true, role: 'base' }, stuckStalledOnly: true }

// W-01's shape: a 3x3 of built step columns (G+1..G+2), the middle one holding granite (G+1) and dirt (G+2) under a granite cap on
// the walk (G+3, no record cell); a stair onto the walk from the ground (a cobblestone at 9,G+1,10)
function sealedScene () {
  const cells = [], srv = server()
  for (let x = 10; x <= 12; x++) for (let z = 9; z <= 11; z++) for (const y of [G + 1, G + 2]) {
    cells.push({ at: [x, y, z], role: 'step', seg: 'W-01' })
    srv.set([x, y, z], x === 11 && z === 10 ? (y === G + 1 ? 'granite' : 'dirt') : 'cobblestone')
  }
  srv.set([11, G + 3, 10], 'granite')
  srv.set([9, G + 1, 10], 'cobblestone')
  return { srv, rec: wallRec(cells, ['W-01']) }
}
const sealedChain = async (M, extra = REMEDIES) => {
  const { srv, rec } = sealedScene(), pr = project(rec), e = bot(srv, 'A', { inv: inv(), feet: [2, G + 1, 2] })
  const stops = []
  for (let v = 0; v < 3 && !done(srv, rec); v++) stops.push((await M.runVisit(pr.p('A', extra), e, { maxSteps: 400 })).stop)
  return { srv, rec, e, stops }
}
console.log('W-01: A SEALED FOREIGN COLUMN (runVisit on the fake server)')
await t('the cap on the walk, then the dirt, then the granite are dug, highest first, and the cells are BUILT -- killed with the remedy cut', async () => {
  const scenario = async M => {
    const { srv, rec, e, stops } = await sealedChain(M)
    assert.ok(done(srv, rec), `built (${stops})`)
    const digs = e.logs.filter(([kk, d]) => kk === '_build' && d.op === 'clear').map(([, d]) => `${k(d.cell)}:${d.kind}`)
    assert.deepStrictEqual(digs, [`11,${G + 3},10:overburden`, `11,${G + 2},10:foreign`, `11,${G + 1},10:foreign`])
    assert.strictEqual(srv.read(11, G + 3, 10).name, 'air', 'the cap is gone (the walk is the step\'s own top again)')
  }
  await killedBy("if (v === 'no_stand' && p.sealed && kind !== 'tree') {", "if (false) {", scenario)
})
await t('CONTROL (no p.sealed, the live behaviour): `clear_failed no_stand` and the visit stops `blocked` at the segment, every visit', async () => {
  const { srv, rec, e, stops } = await sealedChain(R, {})
  assert.ok(!done(srv, rec))
  assert.deepStrictEqual(stops, ['blocked', 'blocked', 'blocked'])
  assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'clear_failed' && d.result === 'no_stand'))
})
await t('a column that cannot be opened (the cap vetoed) is SEALED: named, DEFERRED (counted to stuck_on_cell), never `blocked` -- killed with the deferral cut', async () => {
  const scenario = async M => {
    const { srv, rec } = sealedScene(), pr = project(rec), e = bot(srv, 'A', { inv: inv(), feet: [2, G + 1, 2] })
    const veto = k([11, G + 3, 10])
    const stops = []
    for (let v = 0; v < R.STUCK_VISITS; v++) stops.push((await M.runVisit(pr.p('A', { ...REMEDIES, sealed: { mayDig: q => k(q) !== veto } }), e, { maxSteps: 400 })).stop)
    assert.strictEqual(srv.read(11, G + 3, 10).name, 'granite', 'the vetoed cap stands')
    assert.ok(!stops.includes('blocked'), `never blocked (${stops})`)
    assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'clear_failed' && d.result === 'sealed' && /^vetoed/.test(d.why)), 'named with its reason')
    const counts = PJ.stuckRead(pr.dir, pr.key)
    assert.strictEqual(counts[k([11, G + 1, 10])]?.visits, R.STUCK_VISITS, JSON.stringify(counts))
    assert.strictEqual(stops[R.STUCK_VISITS - 1], 'stuck_on_cell', 'nothing else open: the stall is named (and the order backs off)')
  }
  await killedBy("if (p.sealed && open.some(c => sealed.has(kOf(c.at))) && open.every(c => isClear(c.at) || sealed.has(kOf(c.at)))) {", "if (false) {", scenario)
})

// W-03's shape: a wall column (G+1, G+2) whose ground cell (G) was dug away: no face to place its lowest cell on
const hangScene = (under = 'air') => {
  const srv = server()
  srv.set([20, G, 10], under)
  return { srv, rec: wallRec([{ at: [20, G + 1, 10], role: 'wall', seg: 'W-03' }, { at: [20, G + 2, 10], role: 'wall', seg: 'W-03' }], ['W-03']) }
}
console.log('W-03: A CELL WHOSE GROUND WAS DUG AWAY')
await t('the footing (20,G,10) is placed first (a kind=footing row), then the column -- built in ONE visit; killed with the footing cut', async () => {
  const scenario = async M => {
    const { srv, rec } = hangScene(), pr = project(rec), e = bot(srv, 'A', { inv: inv(), feet: [2, G + 1, 2] })
    const r = await M.runVisit(pr.p('A', REMEDIES), e, { maxSteps: 400 })
    assert.ok(done(srv, rec), `${r.stop}: ${r.why}`)
    assert.strictEqual(srv.read(20, G, 10).name, 'cobblestone')
    const pl = e.logs.filter(([kk, d]) => kk === '_build' && d.op === 'place').map(([, d]) => `${k(d.cell)}:${d.kind ?? '-'}`)
    assert.deepStrictEqual(pl, [`20,${G},10:footing`, `20,${G + 1},10:-`, `20,${G + 2},10:-`])
  }
  await killedBy('if (p.footing && cand.length && !open.some(c => !isClear(c.at) && !sealed.has(kOf(c.at)))) {', 'if (false) {', scenario)
})
await t('CONTROL (no p.footing, the live behaviour): deferred every visit, stuck_on_cell at STUCK_VISITS', async () => {
  const { srv, rec } = hangScene(), pr = project(rec), e = bot(srv, 'A', { inv: inv(), feet: [2, G + 1, 2] })
  const stops = []
  for (let v = 0; v < R.STUCK_VISITS; v++) stops.push((await R.runVisit(pr.p('A'), e, { maxSteps: 400 })).stop)
  assert.deepStrictEqual(stops, [...Array(R.STUCK_VISITS - 1).fill('cell_deferred'), 'stuck_on_cell'])
  assert.ok(!done(srv, rec))
})

console.log('A FEW HARD CELLS DO NOT FREEZE THE REST (the stop, the order\'s stamp, the waiver)')
// the hanging cell over WATER (never a footing: the owner's no-bridge rule) in W-03, and W-05's open cell held by another builder
const busyScene = () => {
  const { srv, rec } = hangScene('water')
  const cells = [...rec.cells, { at: [26, G + 1, 10], role: 'wall', seg: 'W-05' }]
  return { srv, rec: wallRec(cells, ['W-03', 'W-05']) }
}
const busyChain = async (M, extra) => {
  const { srv, rec } = busyScene(), pr = project(rec), e = bot(srv, 'A', { inv: inv(), feet: [2, G + 1, 2] })
  PJ.takeLease(pr.dir, pr.key, 'seg-W-05', 'Other', { now: Date.now() })
  const rs = []
  for (let v = 0; v < R.STUCK_VISITS; v++) rs.push(await M.runVisit(pr.p('A', extra), e, { maxSteps: 400 }))
  return { srv, rec, pr, e, rs }
}
await t('the rest still open (W-05): the stuck row is named, the stop is cell_deferred (no 6-h hold on THIS bot) -- killed with the rule cut', async () => {
  const scenario = async M => {
    const { e, rs } = await busyChain(M, REMEDIES)
    const row = e.logs.find(([kk, d]) => kk === '_build' && d.op === 'stuck_on_cell')
    assert.ok(row && !row[1].stalled, 'the row: named, not stalled')
    assert.strictEqual(rs[R.STUCK_VISITS - 1].stop, 'cell_deferred', rs.map(r => r.stop).join(','))
  }
  await killedBy("if (p.stuckStalledOnly && !stalled) return { stop: 'cell_deferred',", "if (false) return { stop: 'cell_deferred',", scenario)
})
await t('CONTROL: without the rule the same visit stops stuck_on_cell; STALLED (nothing else open) still stops stuck_on_cell with it', async () => {
  const { rs } = await busyChain(R, {})
  assert.strictEqual(rs[R.STUCK_VISITS - 1].stop, 'stuck_on_cell')
  const { srv, rec } = hangScene('water'), pr = project(rec), e = bot(srv, 'A', { inv: inv(), feet: [2, G + 1, 2] })
  const stops = []
  for (let v = 0; v < R.STUCK_VISITS; v++) stops.push((await R.runVisit(pr.p('A', REMEDIES), e, { maxSteps: 400 })).stop)
  assert.strictEqual(stops[R.STUCK_VISITS - 1], 'stuck_on_cell', stops.join(','))
})
await t('the visit names what it deferred and why (out.deferred, the summed count); the WAIVER takes a cell at WALL_WAIVE_AFTER; the wall then CLOSES', async () => {
  const { srv, rec } = hangScene('water'), pr = project(rec), e = bot(srv, 'A', { inv: inv(), feet: [2, G + 1, 2] })
  let cur = rec, r = null
  const log = []
  // buildWall's loop: a visit, then the waiver on what it deferred (the record republished with `waived`)
  for (let v = 0; v < 2 * W.WALL_WAIVE_AFTER + 2 && !done(srv, rec, cur.waived ?? {}); v++) {
    r = await R.runVisit({ ...pr.p('A', { ...REMEDIES, alsoDone: q => W.wallWaived(cur, q) }), record: cur }, e, { maxSteps: 400 })
    if (v === 0) assert.ok(r.deferred.some(x => x.k === k([20, G + 1, 10]) && /^footing liquid water/.test(x.why) && x.visits === 1), JSON.stringify(r.deferred))
    const due = W.wallWaiveDue(cur, r.deferred)
    log.push(`${r.stop}:${due.map(x => x.k).join('+') || '-'}`)
    if (due.length) cur = { ...cur, waived: { ...(cur.waived ?? {}), ...Object.fromEntries(due.map(x => [x.k, { why: x.why }])) } }
  }
  assert.ok(done(srv, rec, cur.waived ?? {}), log.join(' '))
  assert.deepStrictEqual(Object.keys(cur.waived).sort(), [k([20, G + 1, 10]), k([20, G + 2, 10])].sort(), 'the cell over water, then the one that hung over it')
  assert.strictEqual(log.findIndex(x => x.includes(k([20, G + 1, 10]))), W.WALL_WAIVE_AFTER - 1, `never before WALL_WAIVE_AFTER counted visits (${log.join(' ')})`)
  assert.strictEqual(srv.read(20, G, 10).name, 'water', 'nothing was placed over the water')
  const r2 = await R.runVisit({ ...pr.p('A', { ...REMEDIES, alsoDone: q => W.wallWaived(cur, q) }), record: cur }, e, { maxSteps: 400 })
  assert.strictEqual(r2.stop, 'complete', `${r2.stop}: ${r2.why}`)
})
await t('wallWaiveDue: only this visit\'s deferred record cells at the count; never a light, never twice, at most WALL_WAIVE_MAX a record', () => {
  const cells = [...Array(20)].map((_, i) => ({ at: [i, 70, 0], role: i === 0 ? 'light' : 'wall', seg: 'W-00' }))
  const rec = wallRec(cells, ['W-00'])
  const def = cells.map(c => ({ k: k(c.at), why: 'no_stand', visits: W.WALL_WAIVE_AFTER }))
  const due = W.wallWaiveDue(rec, def)
  assert.strictEqual(due.length, W.WALL_WAIVE_MAX)
  assert.ok(!due.some(x => x.k === '0,70,0'), 'never a light')
  assert.deepStrictEqual(W.wallWaiveDue(rec, def.map(x => ({ ...x, visits: W.WALL_WAIVE_AFTER - 1 }))), [])
  assert.deepStrictEqual(W.wallWaiveDue(rec, [{ k: '99,70,0', why: 'x', visits: 9 }]), [], 'not a record cell')
  const full = { ...rec, waived: Object.fromEntries(due.map(x => [x.k, {}])) }
  assert.deepStrictEqual(W.wallWaiveDue(full, def), [], 'the bound is per record, ever')
  assert.strictEqual(W.wallWaived(full, cells[1]), true); assert.strictEqual(W.wallWaived(rec, cells[1]), false)
})
await t('stuckOtherWork: the stamp holds only its segment -- an open read cell elsewhere is other work; unread, done, a light or the stuck segment is not', () => {
  const rec = { cells: [{ at: [0, 0, 0], role: 'wall', seg: 'A' }, { at: [1, 0, 0], role: 'wall', seg: 'A' }, { at: [5, 0, 0], role: 'wall', seg: 'B' }, { at: [6, 0, 0], role: 'light', seg: 'L' }] }
  const open = s => c => s.has(k(c.at))
  assert.strictEqual(S.stuckOtherWork(['0,0,0'], rec, open(new Set(['0,0,0', '1,0,0']))), false, 'the stuck segment\'s own cells')
  assert.strictEqual(S.stuckOtherWork(['0,0,0'], rec, open(new Set(['0,0,0', '5,0,0']))), true, 'W-01\'s case: another segment open')
  assert.strictEqual(S.stuckOtherWork(['0,0,0'], rec, open(new Set(['6,0,0']))), false, 'a light')
  assert.strictEqual(S.stuckOtherWork(['0,0,0'], rec, () => null), false, 'unread is not open')
  assert.strictEqual(S.stuckOtherWork(['9,9,9'], rec, () => true), false, 'a stamp naming no record cell: no evidence')
})

console.log('WIRING (source, comments stripped: the wall visit takes the remedies, the waiver and the stamp rule)')
await t('buildWall passes wallStuckOf + the waived cells; projStuckLive reads stuckOtherWork for an open wall; a waived wall cell is no damage', () => {
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const one = re => { const m = src.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) }
  one("\\.\\.\\.wallStuckOf\\(c\\), \\.\\.\\.\\(wallStuckOn\\(\\) \\? \\{ alsoDone: q => wallWaived\\(rec, q\\) \\} : \\{\\}\\) \\}, effects")
  one("const due = wallWaiveDue\\(rec, r\\.deferred \\?\\? \\[\\]\\)")
  one("return rec\\?\\.blueprint === WALL_BLUEPRINT && wallStuckOn\\(\\) && \\(stuckStale\\(keys, rec, c => recordCellDone\\(b, rec, c\\)\\) \\|\\| stuckOtherWork\\(keys, rec, c => recordCellOpen\\(b, rec, c\\)\\)\\)")
  one("if \\(r\\.blueprint === WALL_BLUEPRINT && wallWaived\\(r, c\\)\\) continue")
  one("if \\(r\\.blueprint === WALL_BLUEPRINT && wallWaived\\(r, c\\)\\) return true")
  one("return \\{ sealed: \\{ mayDig: may \\}, footing: \\{ mayPlace: may, role: 'base' \\}, stuckStalledOnly: true \\}")
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
