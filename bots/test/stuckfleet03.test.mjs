// STUCKFLEET-03 (bots/src/stuckfleet.mjs sealedSolidCand; buildrun.mjs the waiver's candidates). LIVE isolated-d monument (fleet
// e2500c84, effect audit 11-10): plinth cell 315,60,123 (seg F) holds DIRT under the ziggurat's own done cells; its dig is refused
// `sealed why=record_cell_315,65,123` every visit, a sealed cell is never waived, so 7,248 open cells waited on it from 11-06.
// The chain is tested on the fake server (runVisit, several visits, the record's waivers published between them), with the control
// (STUCKFLEET3=off: the live dead end), the refusals, and anchored mutants (helpers/buildfake.mjs withMutant asserts its anchor).
import assert from 'node:assert'
import fs from 'node:fs'
const { R, PJ, G, HOME, server, bot, withMutant } = await import('./helpers/buildfake.mjs')
const Z = await import('../src/ziggurat.mjs')
const SC = await import('../src/stuckcells.mjs')
const S = await import('../src/stuckfleet.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const k = a => a.join(',')
const withEnv = async (v, fn) => { const o = process.env.STUCKFLEET3; if (v == null) delete process.env.STUCKFLEET3; else process.env.STUCKFLEET3 = v; try { return await fn() } finally { if (o == null) delete process.env.STUCKFLEET3; else process.env.STUCKFLEET3 = o } }
const killedBy = async (old, neu, scenario) => {
  await scenario(R)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}

// ---- the scene: a foundation F (two courses, G+1 and G+2, 3x3) under a layer B (G+3, waits on F) ----------------------------
// F's middle bottom cell 11,G+1,10 holds `fill` (dirt, as live); every other F cell is built (cobbled_deepslate), so the cell is sealed on
// its sides and under the done F cell 11,G+2,10 -- no stand sees it and the sealed column may not be opened (record cell above).
const CELL = [11, G + 1, 10]
// the live design palette dresses the foundation's shown cells `plinth` (cobbled_deepslate on isolated-d); the base palette has no plinth
const PAL = { ...Z.ZIG_PALETTE, plinth: ['cobbled_deepslate'] }
function scene ({ fill = 'dirt', seg = 'F', role = 'plinth' } = {}) {
  const cells = [], srv = server()
  for (let x = 10; x <= 12; x++) for (let z = 9; z <= 11; z++) {
    const mid = x === 11 && z === 10
    cells.push({ at: [x, G + 1, z], role: mid ? role : 'plinth', seg: mid ? seg : 'F' })
    srv.set([x, G + 1, z], mid ? fill : 'cobbled_deepslate')
    cells.push({ at: [x, G + 2, z], role: 'plinth', seg: 'F' })
    srv.set([x, G + 2, z], 'cobbled_deepslate')
    cells.push({ at: [x, G + 3, z], role: 'skin', seg: 'B' })
  }
  const segs = seg === 'F' ? [{ seg: 'F', deps: [] }, { seg: 'B', deps: ['F'] }] : [{ seg: 'F', deps: [] }, { seg, deps: ['F'] }, { seg: 'B', deps: ['F', seg] }]
  return { srv, rec: { v: 1, plot: 'monument', blueprint: 'ziggurat@1', cells, clear: [], replant: [], segments: segs } }
}
function project (record) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/stuckfleet03-`)
  const key = PJ.projKey(HOME, 'monument')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slots = {}
  const p = (n, extra = {}) => {
    slots[n] ??= PJ.takeSlot(dir, key, n, 2)
    return { dir, key, me: n, home: HOME, stood: [], record, recordGen: pub.gen, palette: PAL, slot: slots[n].slot, slotGen: slots[n].gen,
      domain: () => true, walkR: 40, foreign: Z.ZIG_FOREIGN_GROWN, blockLayer: false, stands: { pending: null, bans: {} }, ...extra }
  }
  return { dir, key, p }
}
const touchedB = e => e.logs.filter(([kk, d]) => kk === '_build' && d.seg === 'B').length
const SEALED = { sealed: { mayDig: () => true } }
const chain = async (M, { visits = SC.WAIVE_AFTER + 3, ...sc } = {}) => {
  const { srv, rec } = scene(sc), pr = project(rec), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
  const stops = []
  for (let v = 0; v < visits; v++) {
    const opts = { ...SEALED, ...SC.visitOpts(PJ.recordHead(pr.dir, pr.key).head.rec, 'zig', null, true) }
    const r = await M.runVisit(pr.p('A', opts), e, { maxSteps: 400 })
    if (r.waived?.length) PJ.publishRecord(pr.dir, pr.key, cur => SC.withWaived(cur, r.waived, { cells: cur.cells.length, now: Date.now(), by: 'A', max: SC.WAIVE_MAX_ZIG }), { by: 'A' })
    stops.push(r.stop)
  }
  const head = PJ.recordHead(pr.dir, pr.key).head.rec
  const placedB = e.logs.filter(([kk, d]) => kk === '_build' && d.op === 'place' && d.seg === 'B').length
  return { srv, rec, e, stops, head, placedB }
}

console.log('THE LIVE DEAD END AND ITS REMEDY (runVisit on the fake server)')
await t('CONTROL (STUCKFLEET3=off): the dirt plinth is sealed `record_cell`, deferred every visit, never waived; B never worked', async () => {
  await withEnv('off', async () => {
    const { e, stops, head, placedB } = await chain(R)
    assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'clear_failed' && d.result === 'sealed' && /^record_cell/.test(String(d.why))), `refused as live: ${JSON.stringify(e.logs.filter(([kk]) => /^_build/.test(kk)).map(([kk, d]) => [kk, d.op ?? d.outcome, d.result, d.why, d.cell]).slice(0, 30))}`)
    assert.deepStrictEqual(Object.keys(head.waived ?? {}), [])
    assert.strictEqual(placedB, 0)
    assert.strictEqual(touchedB(e), 0, 'B is never worked')
    assert.strictEqual(stops.at(-1), 'stuck_on_cell', String(stops))
  })
})
await t('on: after WAIVE_AFTER visits the plinth is waived `sealed_solid dirt`, its dirt stays, and B is worked -- killed with the wiring cut', async () => {
  await killedBy('const wcand3 = sf3 ? sf3.cells : wcand', 'const wcand3 = wcand', async M => {
    const { srv, e, head, placedB, stops } = await chain(M)
    assert.deepStrictEqual(Object.keys(head.waived ?? {}), [k(CELL)], 'the one sealed cell is waived')
    const row = e.logs.find(([kk, d]) => kk === '_build' && d.op === 'waived')
    assert.match(String(row?.[1]?.why), /^sealed_solid dirt no_stand \d+ visits$/)
    assert.strictEqual(srv.read(...CELL).name, 'dirt', 'nothing dug: the block stays as the support')
    // the fake has no stand at G+3 (two courses up from the ground), so B's cells are DEFERRED no_stand there: what matters is that
    // the layer that waited on the plinth is now worked at all (the control never reaches it)
    assert.ok(touchedB(e) > 0, `the layer that waited on it is worked (stops ${stops})`)
  })
})
await t('the waiver still counts visits: one visit does not waive it (WAIVE_AFTER > 1)', async () => {
  assert.ok(SC.WAIVE_AFTER > 1)
  const { head } = await chain(R, { visits: 1 })
  assert.deepStrictEqual(Object.keys(head.waived ?? {}), [])
})

console.log('THE REFUSALS (the waiver\'s own rules still decide)')
await t('a sealed SKIN cell holding dirt (not foundation, not core) is never waived: B never worked', async () => {
  const { head, e } = await chain(R, { seg: 'S', role: 'skin' })
  assert.deepStrictEqual(Object.keys(head.waived ?? {}), [])
  assert.strictEqual(touchedB(e), 0)
})
await t('sealedSolidCand: only a SEALED cell holding a full natural solid block joins; never an unread, plant, leaves, log, gravel or air cell', () => {
  const c = { at: [1, 2, 3] }, d = { at: [4, 5, 6] }
  const rd = n => () => (n == null ? null : { name: n, boundingBox: /^(air|short_grass)$/.test(n) ? 'empty' : 'block' })
  const sealedAll = () => true
  assert.deepStrictEqual(S.sealedSolidCand([c], [], { sealed: sealedAll, read: rd('dirt') }).cells, [c])
  assert.deepStrictEqual([...S.sealedSolidCand([c], [], { sealed: sealedAll, read: rd('cobbled_deepslate') }).solid], ['1,2,3'])
  for (const n of [null, 'bamboo', 'oak_leaves', 'oak_log', 'gravel', 'sand', 'air', 'short_grass', 'chest']) {
    assert.deepStrictEqual(S.sealedSolidCand([c], [], { sealed: sealedAll, read: rd(n) }).cells, [], String(n))
  }
  assert.deepStrictEqual(S.sealedSolidCand([c], [], { sealed: () => false, read: rd('dirt') }).cells, [], 'not sealed this visit: no')
  // the existing candidates pass through once, in order
  const out = S.sealedSolidCand([c, d], [d], { sealed: sealedAll, read: rd('stone') })
  assert.deepStrictEqual(out.cells, [d, c]); assert.deepStrictEqual([...out.solid], ['1,2,3'])
})
await t('STUCKFLEET3 parses as its siblings (off|0|false|no -> off; unset -> on)', () => {
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.strictEqual(S.stuckFleet3On({ STUCKFLEET3: v }), false)
  for (const v of [undefined, '', 'on', '1']) assert.strictEqual(S.stuckFleet3On({ STUCKFLEET3: v }), true)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
