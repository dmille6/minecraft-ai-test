// MONUSTUCK-01 (fleet 11-02..11-03): THE ZIGGURATS STUCK ON A BAMBOO GROVE, AND THE WALK THAT WEDGED EVERY VISIT.
//   1. hive-a (35 h), placebo-c (41 h), isolated-a, isolated-c, isolated-d: the F-E foundation cell holds the foot of a bamboo stalk
//      8-12 tall; its four sides are the foundation's own cobblestone, so no stand sees it; the sealed-column dig refused
//      `deep_3+_above` (the stalk counted as overburden) and the project sat stuck_on_cell behind it. test/fixtures/
//      monustuck-hive-a-1103.json is hive-a's world round 331,68,117 (region copy 11-03 21:13Z) with the record's cells in the box.
//      Remedy: buildrun.mjs stalkFell -- vanilla breaks every stalk block above a broken one, so the stalk is felled with one dig at
//      the cell's top, then the cell is dug through that face.
//   2. hive-a's two clear no-stand core cells waited behind that sealed cell: the waiver ran only with EVERY open cell clear.
//      Remedy: a sealed cell beside them no longer holds them back (the sealed cell itself is never waived).
//   3. board-d: 46 of 67 visits ended at one spot in the grove; a dig walk left no pending stand, so every visit walked the same way.
//      Remedy: the dig walk's stand bans (DIG_BANS_MAX, DIG_BAN_MS): the pending stand is banned, then the next, then `no_stand`.
// Every remedy is tested as a CHAIN (the refusal and what follows it), each killed by a mutant whose anchor is present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const { R, PJ, G, HOME, server, bot, withMutant } = await import('./helpers/buildfake.mjs')
const B = await import('../src/buildsite.mjs')
const Z = await import('../src/ziggurat.mjs')
const SC = await import('../src/stuckcells.mjs')
const mc = createRequire(import.meta.url)('minecraft-data')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const k = a => a.join(',')
const killedBy = async (old, neu, scenario) => {
  await scenario(R)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const withEnv = async (v, fn) => { const o = process.env.MONUSTUCK; if (v == null) delete process.env.MONUSTUCK; else process.env.MONUSTUCK = v; try { return await fn() } finally { if (o == null) delete process.env.MONUSTUCK; else process.env.MONUSTUCK = o } }

// ---- the live geometry (hive-a) ----------------------------------------------------------------------------------------------
const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/monustuck-hive-a-1103.json', import.meta.url), 'utf8'))
const box = n => mc.blocksByName[n]?.boundingBox ?? 'block'
const over = new Map()
const [bx0, by0, bz0, bx1, by1, bz1] = FX.box
const live = (x, y, z) => { if (x < bx0 || x > bx1 || z < bz0 || z > bz1 || y < by0 || y > by1) return null; const key = `${x},${y},${z}`; const n = over.get(key) ?? FX.world[key] ?? 'air'; return { name: n, boundingBox: box(n) } }
const cellKeys = new Set(FX.cells.map(c => k(c.at)))
const CELL = [331, 68, 117]
const GROUND = { x: 334, y: 69, z: 117 }   // grass east of the grove, the builders' side
const nodes = () => { const m = new Map(); for (const key of B.walkFrom(live, GROUND, new Set(), 9)) { const [x, y, z] = key.split(',').map(Number); const c = `${x},${z}`; (m.get(c) ?? m.set(c, []).get(c)).push(y) } return m }
const sealedOpts = extra => ({ isOpenForeign: () => false, isOpenAbove: q => cellKeys.has(k(q)), isCell: q => cellKeys.has(k(q)), scaffold: Z.ZIG_FOREIGN_GROWN, ...extra })

console.log('THE LIVE COLUMN (hive-a 331,68,117, pure on the region copy)')
await t('the cell is the foot of an 11-block bamboo stalk, sealed on its sides; no stand sees it; the stalk block above it has one', () => {
  over.clear()
  assert.strictEqual(live(...CELL).name, 'bamboo')
  for (let y = 69; y <= 79; y++) assert.strictEqual(live(331, y, 117).name, 'bamboo', `y${y}`)
  assert.strictEqual(live(331, 80, 117).name, 'air')
  assert.strictEqual(R.digStand(live, CELL, nodes()), null, 'the live failure: no_stand')
  assert.ok(R.digStand(live, [331, 69, 117], nodes()), 'positive control: the walk reaches the column above')
})
await t('CONTROL (the live code, no stalk rule): the column refuses `deep 3+ above` -- the row every visit logged', () => {
  over.clear()
  const sa = R.sealedAbove(live, CELL, sealedOpts())
  assert.deepStrictEqual([sa.ok, sa.why, sa.hard], [false, 'deep 3+ above', true])
})
await t('with the stalk rule: two digs (the stalk at the cell\'s top, then the cell); felled, a stand sees the cell; dug, it is placeable', () => {
  over.clear()
  const sa = R.sealedAbove(live, CELL, sealedOpts({ stalk: true }))
  assert.ok(sa.ok, sa.why)
  assert.deepStrictEqual(sa.digs.map(d => `${k(d.at)}:${d.name}:${d.kind}`), ['331,69,117:bamboo:stalk', '331,68,117:bamboo:foreign'])
  assert.strictEqual(sa.stalk, 11)
  for (let y = 69; y <= 79; y++) over.set(`331,${y},117`, 'air')   // vanilla: the stalk above the broken block breaks
  assert.ok(R.digStand(live, CELL, nodes()), 'the cell is seen through its top')
  over.set(k(CELL), 'air')
  assert.ok(B.stepFor(live, GROUND, CELL, nodes(), () => true), 'a placement step for the plinth cell')
  over.clear()
})
await t('stalkFell refuses (and the column falls back): a vetoed block in the run, another record\'s cell in it, an unread block, the clears\' own', () => {
  over.clear()
  assert.deepStrictEqual(R.stalkFell(live, CELL, { mayDig: q => q[1] !== 75 }).why, 'vetoed 331,75,117')
  const isCell = q => cellKeys.has(k(q))
  assert.match(R.stalkFell(live, CELL, { isCell }).why, /^record_cell 331,69,117/, 'a record cell the caller does not own')
  assert.ok(R.stalkFell(live, CELL, { isCell, own: isCell }).ok, 'owned (open, this or a waiting segment): felled')
  const unread = (x, y, z) => (y === 77 ? null : live(x, y, z))
  assert.deepStrictEqual([R.stalkFell(unread, CELL).why, R.stalkFell(unread, CELL).hard], ['unknown 331,77,117', false])
  assert.match(R.stalkFell(live, CELL, { listed: q => q[1] === 70 }).why, /^listed bamboo/)
  assert.strictEqual(R.stalkFell(live, [331, 66, 117]).why, 'no_stalk', 'podzol above: no stalk')
  assert.match(R.stalkFell(live, CELL, { max: 5 }).why, /^stalk 5\+/)
  // and the overburden's own rule: a stalk above an ordinary column is one dig, its lowest block
  const col = (x, y, z) => (x || z ? { name: 'cobblestone', boundingBox: 'block' } : y === 1 ? { name: 'grass_block', boundingBox: 'block' } : y === 2 ? { name: 'dirt', boundingBox: 'block' } : y <= 12 ? { name: 'bamboo', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
  assert.match(R.overburdenAbove(col, [0, 1, 0], { scaffold: Z.ZIG_FOREIGN_GROWN }).why, /^deep 3\+ above/, 'control: the stalk counted block by block')
  assert.deepStrictEqual(R.overburdenAbove(col, [0, 1, 0], { scaffold: Z.ZIG_FOREIGN_GROWN, stalk: true }).digs.map(d => k(d.at)), ['0,3,0', '0,2,0'])
})

// ---- the chain on the fake server --------------------------------------------------------------------------------------------
// A foundation segment A (G+1) under a layer B (G+2, waits on A). The middle cell 11,G+1,10 holds the foot of a bamboo stalk to
// G+11, its four sides cobblestone cells of A, as at hive-a; the server breaks the stalk above a broken stalk block (vanilla).
const zigRec = cells => ({ v: 1, plot: 'monument', blueprint: 'ziggurat@1', cells, clear: [], replant: [], segments: [{ seg: 'A', deps: [] }, { seg: 'B', deps: ['A'] }] })
const STALK_TOP = G + 11
function scene ({ core = false } = {}) {
  const cells = [], srv = server()
  for (let x = 10; x <= 12; x++) for (let z = 9; z <= 11; z++) {
    const mid = x === 11 && z === 10
    cells.push({ at: [x, G + 1, z], role: 'skin', seg: 'A' })
    srv.set([x, G + 1, z], mid ? 'bamboo' : 'cobblestone')
    cells.push({ at: [x, G + 2, z], role: 'skin', seg: 'B' })
  }
  for (let y = G + 2; y <= STALK_TOP; y++) srv.set([11, y, 10], 'bamboo')
  if (core) {
    // hive-a's other two cells: a clear core cell of A no stand reaches (an air pocket under a solid lid, sealed round)
    cells.push({ at: [14, G - 2, 10], role: 'core', seg: 'A' })
    srv.set([14, G - 2, 10], 'air')
  }
  return { srv, rec: zigRec(cells) }
}
function fellingDig (srv) {
  return async (c, expect) => {
    const b = srv.read(...c)
    if (expect && b?.name !== expect) return 'refused'
    srv.set(c, 'air')
    if (/^(bamboo|sugar_cane)$/.test(b?.name ?? '')) for (let y = c[1] + 1; srv.read(c[0], y, c[2])?.name === b.name; y++) srv.set([c[0], y, c[2]], 'air')
    return 'confirmed'
  }
}
function project (record) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/monustuck-`)
  const key = PJ.projKey(HOME, 'monument')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slots = {}
  const p = (n, extra = {}) => {
    slots[n] ??= PJ.takeSlot(dir, key, n, 2)
    return { dir, key, me: n, home: HOME, stood: [], record, recordGen: pub.gen, palette: Z.ZIG_PALETTE, slot: slots[n].slot, slotGen: slots[n].gen,
      domain: () => true, walkR: 40, foreign: Z.ZIG_FOREIGN_GROWN, blockLayer: false, stands: { pending: null, bans: {} }, ...extra }
  }
  return { dir, key, p }
}
const done = (srv, rec) => rec.cells.every(c => R.cellDone(srv.read(...c.at), Z.ZIG_PALETTE, c.role))
const SEALED = { sealed: { mayDig: () => true } }
const chain = async (M, { visits = 3, core = false, extra = SEALED } = {}) => {
  const { srv, rec } = scene({ core }), pr = project(rec), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2], dig: fellingDig(srv) })
  const stops = []
  const opts = () => ({ ...extra, ...SC.visitOpts(PJ.recordHead(pr.dir, pr.key).head.rec, 'zig', null, true) })
  for (let v = 0; v < visits && !done(srv, rec); v++) {
    const r = await M.runVisit(pr.p('A', opts()), e, { maxSteps: 400 })
    if (r.waived?.length) PJ.publishRecord(pr.dir, pr.key, cur => SC.withWaived(cur, r.waived, { cells: cur.cells.length, now: Date.now(), by: 'A', max: SC.WAIVE_MAX_ZIG }), { by: 'A' })
    stops.push(r.stop)
  }
  return { srv, rec, e, stops, pr }
}
console.log('THE STALK CHAIN (runVisit on the fake server)')
await t('CONTROL (MONUSTUCK=off): the cell is sealed `deep 3+ above`, deferred every visit, stuck_on_cell; the layer never starts', async () => {
  await withEnv('off', async () => {
    const { srv, rec, e, stops } = await chain(R, { visits: 3 })
    assert.ok(!done(srv, rec))
    assert.strictEqual(stops.at(-1), 'stuck_on_cell', String(stops))
    assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'clear_failed' && d.result === 'sealed' && d.why === 'deep 3+ above'))
    assert.strictEqual(srv.read(11, STALK_TOP, 10).name, 'bamboo')
  })
})
await t('on: the stalk is felled at the cell\'s top, the cell dug and placed, and the layer that waited on it built, in one visit -- killed with the wiring cut', async () => {
  await killedBy("scaffold: scaffoldRe, stalk: monuStuckOn() })", 'scaffold: scaffoldRe, stalk: false })', async M => {
    const { srv, rec, e, stops } = await chain(M, { visits: 1 })
    const placedB = e.logs.filter(([kk, d]) => kk === '_build' && d.op === 'place' && d.seg === 'B').length
    assert.ok(rec.cells.filter(c => c.seg === 'A').every(c => R.cellDone(srv.read(...c.at), Z.ZIG_PALETTE, c.role)), `the foundation is complete (${stops})`)
    assert.ok(placedB >= 8, `the layer that waited on it is built (${placedB} placed; its enclosed middle cell is the fake's own no-stand case)`)
    const clears = e.logs.filter(([kk, d]) => kk === '_build' && d.op === 'clear').map(([, d]) => `${k(d.cell)}:${d.kind}`)
    assert.deepStrictEqual(clears, [`11,${G + 2},10:stalk`, `11,${G + 1},10:foreign`])
    assert.strictEqual(srv.read(11, STALK_TOP, 10).name, 'air', 'the stalk is gone (the server broke it)')
  })
})
await t('a stalk that may not be felled (a veto in the run) keeps the old refusal: sealed, deferred, never `blocked`, nothing dug', async () => {
  const { srv, rec, e, stops } = await chain(R, { visits: 1, extra: { sealed: { mayDig: q => q[1] !== G + 6 } } })
  assert.ok(!done(srv, rec))
  assert.notStrictEqual(stops[0], 'blocked')
  assert.strictEqual(srv.read(11, G + 6, 10).name, 'bamboo')
  assert.ok(!e.logs.some(([kk, d]) => kk === '_build' && d.op === 'clear' && d.kind === 'stalk'))
})

console.log('THE WAIVER BESIDE A SEALED CELL (runVisit)')
await t('a clear no-stand core cell is waived after WAIVE_AFTER visits though a sealed cell sits beside it; the sealed cell is NEVER waived -- killed with the old condition', async () => {
  const unfellable = { sealed: { mayDig: q => q[1] !== G + 6 } }
  await killedBy('(monuStuckOn() ? open.every(c => isClear(c.at) || sealed.has(kOf(c.at))) : !open.some(c => !isClear(c.at)))', '!open.some(c => !isClear(c.at))', async M => {
    const { e, pr } = await chain(M, { visits: SC.WAIVE_AFTER, core: true, extra: unfellable })
    const waived = Object.keys(PJ.recordHead(pr.dir, pr.key).head.rec.waived ?? {})
    assert.deepStrictEqual(waived, [k([14, G - 2, 10])], `waived ${waived}`)
    assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'deferred' && d.why === 'sealed'), 'the sealed cell is deferred (counted)')
  })
})

// ---- the dig walk's bans -----------------------------------------------------------------------------------------------------
// A clear-list dig (a log the record lists) whose walk is cut by the stuck reflex, visit after visit (board-d 338,71,114): the fake
// walk aborts the visit when it is sent to a stand inside the "grove" (x >= 20); stands west of the log are fine.
console.log('THE DIG WALK (runVisit on the fake server)')
function walkScene () {
  const srv = server()
  const LOG = [22, G + 1, 10]
  srv.set(LOG, 'oak_log')
  const cells = [{ at: [10, G + 1, 10], role: 'skin', seg: 'A' }]
  return { srv, LOG, rec: { ...zigRec(cells), clear: [{ at: LOG, name: 'oak_log', kind: 'log' }] } }
}
const walkChain = async (M, visits) => {
  const { srv, LOG, rec } = walkScene(), pr = project(rec)
  let cut = false, last = null
  const walked = []
  const e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2], aborted: () => cut })
  const walk0 = e.walkTo
  e.walkTo = async s => { walked.push(k(s)); last = s; if (s[0] >= 20 && Math.abs(s[2] - LOG[2]) <= 4) { cut = true; return false } return walk0(s) }
  const stands = { pending: null, bans: {} }
  const stops = []
  for (let v = 0; v < visits; v++) {
    cut = false
    const r = await M.runVisit(pr.p('A', { stands }), e, { maxSteps: 400 })
    stops.push(r.stop)
  }
  return { srv, LOG, e, stops, walked, stands, last }
}
await t('CONTROL (MONUSTUCK=off): every visit walks to the SAME stand and is cut there', async () => {
  await withEnv('off', async () => {
    const { stops, walked } = await walkChain(R, 4)
    assert.deepStrictEqual(stops, ['aborted', 'aborted', 'aborted', 'aborted'])
    const dig = walked.filter(s => +s.split(',')[0] >= 20)
    assert.strictEqual(new Set(dig).size, 1, `one stand, walked ${dig.length}x`)
  })
})
await t('on: the cut walk\'s stand is banned (a stand_banned row), the next visit walks another; after DIG_BANS_MAX the log has NO STAND: the visits stop being cut -- killed with the pending cut', async () => {
  await killedBy("    if (banOn) stands.pending = { cell: kOf(at), stand: kOf(stand), at: now(), op: 'dig' }\n", '\n', async M => {
    const { stops, walked, e } = await walkChain(M, 5)
    const dig = walked.filter(s => +s.split(',')[0] >= 20)
    assert.strictEqual(dig.length, R.DIG_BANS_MAX, `cut walks ${dig.length} (${stops})`)
    assert.strictEqual(new Set(dig).size, R.DIG_BANS_MAX, 'each to a different stand')
    assert.deepStrictEqual(stops.slice(0, R.DIG_BANS_MAX), Array(R.DIG_BANS_MAX).fill('aborted'))
    assert.ok(stops.slice(R.DIG_BANS_MAX).every(s => s !== 'aborted'), String(stops))
    assert.strictEqual(e.logs.filter(([kk, d]) => kk === '_build' && d.op === 'stand_banned' && d.kind === 'dig').length, R.DIG_BANS_MAX)
  })
})
await t('a walk that ended out of reach bans its stand at once (no abort needed)', async () => {
  const { srv, LOG, rec } = walkScene(), pr = project(rec)
  const e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
  e.walkTo = async () => true   // the walk "ends" where the bot already is: 20 blocks off
  const stands = { pending: null, bans: {} }
  await R.runVisit(pr.p('A', { stands }), e, { maxSteps: 400 })
  assert.strictEqual(Object.keys(stands.bans[k(LOG)] ?? {}).length >= 1, true, JSON.stringify(stands.bans))
  assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'stand_banned' && /^unreached/.test(d.why)))
})
await t('settlePendingStand returns the walk it banned (null when none); MONUSTUCK=off is the rollback switch', () => {
  const m = { pending: { cell: '1,2,3', stand: '4,5,6', at: 0 }, bans: {} }
  assert.deepStrictEqual(R.settlePendingStand(m, 10), { cell: '1,2,3', stand: '4,5,6', at: 0 })
  assert.strictEqual(R.settlePendingStand(m, 11), null)
  assert.deepStrictEqual(m.bans, { '1,2,3': { '4,5,6': 10 } })
  assert.strictEqual(SC.monuStuckOn({}), true)
  assert.strictEqual(SC.monuStuckOn({ MONUSTUCK: 'off' }), false)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
