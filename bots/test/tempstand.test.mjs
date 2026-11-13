// TEMPSTAND-01 (tempstand.mjs; buildrun.mjs runVisit `p.tempStand`; buildproj.mjs standRead / standWrite / standCells).
// LIVE 11-12: a handful of cells no stand reaches froze whole buildings for days (the wall extension on 13 cells, the monument on 2,
// a cottage corner post whose only click is the post's top face from two above the ground). The owner: a stuck cell must not freeze
// a building -- a temporary stand, taken back in the same visit.
// THE SCENE (the fake server of the other build tests, helpers/buildfake.mjs): a three-block POST on flat ground. Its two lower cells
// are clicked from the ground; the third's only face is the top of the second, and an eye on the ground is below it: no stand.
//   1. the pure decisions: standDue (never a first miss), standBlock, standColumn, planTempStand
//   2. the visits: a first miss builds nothing; the second visit raises a one-block pillar, lays the cell and takes the pillar down
//      -- the world is the control's plus that one cell; the positive control (the switch off) never completes and goes stuck
//   3. the receipt: written before the first block; an aborted or refused stand leaves it or clears it by what the world reads; the
//      next visit takes the stand down first; another holder's is touched only when stale
//   4. never in another record's cells, never in this record's own; never clicked against the stand's own block
//   5. mutants, each anchor present and unique, each dying on the scenario's own assertion
import assert from 'node:assert'
import fs from 'node:fs'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { B, R, PJ, G, HOME, server, bot, project, withMutant } = await import('./helpers/buildfake.mjs')
const TS = await import('../src/tempstand.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
// A KILL MEANS AN ASSERTION: the mutant must fail the scenario's own assert (never a crash)
const kills = async (old, neu, scenario) => {
  await scenario(R)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const TS_PATH = new URL('../src/tempstand.mjs', import.meta.url)
async function withStandMutant (old, neu, fn) {
  const src = readFileSync(TS_PATH, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-ts-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const k = a => a.join(',')

// ---- the scene -------------------------------------------------------------------------------------------------------------------
const PX = 10, PZ = 0
const POST = [1, 2, 3].map(i => [PX, G + i, PZ]), TOP = POST[2]
const PAL = { post: ['oak_planks'], rail: ['oak_planks'] }
const record = (extra = []) => ({ v: 1, plot: 'shop', cells: [...POST.map(at => ({ at, role: 'post', seg: 'A' })), ...extra], segments: [{ seg: 'A', deps: [] }, ...(extra.length ? [{ seg: 'B', deps: ['A'] }] : [])], clear: [], replant: [] })
/** The fake bot with a body (voidfill.test.mjs): walks teleport, a pillar's place lifts it (land after rise), a dig underfoot drops it. */
function body (srv, name = 'A', { inv = { oak_planks: 16, dirt: 8 }, feet = [2, G + 1, 0], ...o } = {}) {
  const e = bot(srv, name, { inv, feet, ...o })
  let at = feet.slice(), risen = false
  e.feet = () => at.slice()
  e.walks = []
  e.walkTo = async s => { e.walks.push(s.slice()); at = s.slice(); return true }
  e.count = n => inv[n] ?? 0
  e.rise = async () => { risen = true; return true }
  e.land = async () => { if (risen && srv.read(...at)?.boundingBox === 'block') at[1]++; risen = false }
  e.settle = async () => { while (srv.read(at[0], at[1] - 1, at[2])?.boundingBox === 'empty') at[1]-- }
  e.tool = async () => {}
  return e
}
const visit = (Mod, pr, e, { who = 'A', stand = { mayPlace: () => true, mem: {} }, opts = {}, extra = {} } = {}) => {
  const h = PJ.recordHead(pr.dir, pr.key)
  return Mod.runVisit({ ...pr.p(who), palette: PAL, record: h.head.rec, recordGen: h.head.gen, domain: () => true, ...(stand ? { tempStand: stand } : {}), ...extra }, e, { maxSteps: 400, tempStand: true, ...opts })
}
const solids = srv => Object.fromEntries([...srv.cells].filter(([, n]) => n !== 'air').sort())
const tsRows = e => e.logs.filter(([kk, d]) => kk === '_build' && d.op === 'tempstand').map(([, d]) => d)
const receipts = pr => fs.readdirSync(pr.dir).filter(n => /\.tempstand\./.test(n))
const dirtIn = srv => [...srv.cells].filter(([, n]) => n === 'dirt').map(([c]) => c)
const everDirt = srv => [...srv.placedAt.keys()].filter(c => !POST.some(p => k(p) === c))

// ---- 1. the pure decisions ---------------------------------------------------------------------------------------------------------
await t('the switch: TEMPSTAND=off|0|false|no is off, anything else (and nothing) is on', async () => {
  for (const v of ['off', '0', 'false', 'no', 'OFF', ' No ']) assert.strictEqual(TS.tempStandOn({ TEMPSTAND: v }), false, v)
  for (const v of [undefined, '', 'on', '1', 'yes']) assert.strictEqual(TS.tempStandOn({ TEMPSTAND: v }), true, String(v))
})
await t('standDue: never a first miss -- only a cell an EARLIER visit deferred too', async () => {
  assert.deepStrictEqual(TS.standDue({}, ['1,2,3']), [], 'no file: the first miss')
  assert.deepStrictEqual(TS.standDue({ '1,2,3': { visits: 0 } }, ['1,2,3']), [])
  assert.deepStrictEqual(TS.standDue({ '1,2,3': { visits: 1 }, '9,9,9': { visits: 4 } }, ['1,2,3', '4,5,6']), ['1,2,3'], 'the positive control: one earlier visit')
})
await t('standBlock: the first cheap block the bag holds enough of, never the block its own cell needs', async () => {
  const bag = inv => n => inv[n] ?? 0
  assert.strictEqual(TS.standBlock(bag({ dirt: 1, cobblestone: 5 }), 1), 'dirt')
  assert.strictEqual(TS.standBlock(bag({ dirt: 1, cobblestone: 5 }), 2), 'cobblestone', 'two blocks: one dirt is not enough')
  assert.strictEqual(TS.standBlock(bag({ cobblestone: 2 }), 2, n => (n === 'cobblestone' ? 1 : 0)), null, 'the cell needs one of the two')
  assert.strictEqual(TS.standBlock(bag({ cobblestone: 3 }), 2, n => (n === 'cobblestone' ? 1 : 0)), 'cobblestone')
  assert.strictEqual(TS.standBlock(bag({ oak_planks: 64 }), 1), null, 'never a block that is not cheap')
})
await t('standColumn: air stand cells on a full floor with head room; a record cell, a veto, a plant, water and an unread cell refuse', async () => {
  const srv = server({ [k([5, G + 1, 5])]: 'short_grass', [k([6, G, 6])]: 'water', [k([7, G + 4, 7])]: 'stone', [k([8, G, 8])]: 'sand' })
  assert.deepStrictEqual(TS.standColumn(srv.read, [3, G + 1, 3], 2), { ok: true, why: 'ok' }, 'the positive control')
  assert.match(TS.standColumn(srv.read, [5, G + 1, 5], 1).why, /^not_air short_grass/)
  assert.match(TS.standColumn(srv.read, [6, G + 1, 6], 1).why, /^floor water/)
  assert.match(TS.standColumn(srv.read, [8, G + 1, 8], 1).why, /^floor sand/, 'a floor that falls')
  assert.deepStrictEqual(TS.standColumn(srv.read, [7, G + 1, 7], 1), { ok: true, why: 'ok' }, 'one block under a ceiling four up: feet and head fit')
  assert.match(TS.standColumn(srv.read, [7, G + 1, 7], 2).why, /^headroom/)
  assert.match(TS.standColumn(srv.read, [3, G + 1, 3], 2, { taken: at => at[1] === G + 2 }).why, /^record_cell 3,71,3/)
  assert.match(TS.standColumn(srv.read, [3, G + 1, 3], 1, { mayPlace: () => false }).why, /^vetoed/)
  assert.match(TS.standColumn(srv.read, [3, G + 1, 3], 1, { mayPlace: () => { throw new Error('x') } }).why, /^vetoed/, 'a veto that throws refuses')
  assert.match(TS.standColumn(srv.read, [61, G + 1, 0], 1).why, /^unknown/)
})
const scenePlan = (srv, o = {}) => {
  const nodes = new Map()
  for (const key of B.walkFrom(srv.read, HOME, new Set([k(TOP)]), 48)) { const [x, y, z] = key.split(',').map(Number); const c = `${x},${z}`; if (!nodes.has(c)) nodes.set(c, []); nodes.get(c).push(y) }
  return { nodes, plan: TS.planTempStand({ read: srv.read, home: HOME, cell: TOP, nodes, domain: () => true, ...o }) }
}
await t('planTempStand: the post\'s top cell has no ground stand; one block beside it gives one, proven with the pillar standing', async () => {
  const srv = server({ [k(POST[0])]: 'oak_planks', [k(POST[1])]: 'oak_planks' })
  const { nodes, plan } = scenePlan(srv)
  assert.strictEqual(B.stepFor(srv.read, HOME, TOP, nodes, () => true), null, 'the control: no stand on the walk')
  assert.ok(plan.ok, plan.why)
  assert.strictEqual(plan.h, 1, 'the lowest pillar that works')
  assert.deepStrictEqual(plan.cells, [plan.base]); assert.deepStrictEqual(plan.top, [plan.base[0], plan.base[1] + 1, plan.base[2]])
  assert.ok(nodes.get(`${plan.base[0]},${plan.base[2]}`)?.includes(plan.base[1]), 'the base is a node of the walk it was given')
  assert.deepStrictEqual(plan.step.support, POST[1], 'clicked on the post under it'); assert.deepStrictEqual(plan.step.face, [0, 1, 0])
  assert.strictEqual(Math.max(Math.abs(plan.base[0] - PX), Math.abs(plan.base[2] - PZ)), 1, 'the nearest column')
  // a cell four above the ground needs two blocks; three is the bound
  const high = server({ [k(POST[0])]: 'oak_planks', [k(POST[1])]: 'oak_planks', [k(TOP)]: 'oak_planks' })
  const up = [PX, G + 4, PZ]
  const p2 = TS.planTempStand({ read: high.read, home: HOME, cell: up, nodes, domain: () => true })
  assert.ok(p2.ok && p2.h === 2, `${p2.why} h=${p2.h}`)
  assert.strictEqual(TS.planTempStand({ read: high.read, home: HOME, cell: up, nodes, domain: () => true, max: 1 }).ok, false, 'bounded by max')
})
await t('planTempStand: every column vetoed -> refused and named; one column allowed -> that column', async () => {
  const srv = server({ [k(POST[0])]: 'oak_planks', [k(POST[1])]: 'oak_planks' })
  const none = scenePlan(srv, { mayPlace: () => false }).plan
  assert.strictEqual(none.ok, false); assert.match(none.why, /^vetoed/)
  const one = scenePlan(srv, { mayPlace: at => at[0] === PX + 2 && at[2] === PZ + 1 }).plan
  assert.ok(one.ok, one.why); assert.deepStrictEqual([one.base[0], one.base[2]], [PX + 2, PZ + 1])
  const mine = scenePlan(srv, { taken: at => Math.max(Math.abs(at[0] - PX), Math.abs(at[2] - PZ)) <= 1 }).plan
  assert.ok(mine.ok, mine.why); assert.strictEqual(Math.max(Math.abs(mine.base[0] - PX), Math.abs(mine.base[2] - PZ)), 2, 'never in the record\'s own cells')
})
await t('planTempStand: never a click against the stand\'s own block (a cell hung on a block that is about to go)', async () => {
  // A REACH-ONLY cell (`blind`: its face need not be on the eye's side) on the ground, and one walk node beside it: from the top of
  // a pillar there the NEAREST face is the pillar's own side -- refused, and named. (A cell clicked by sight can never take it: an
  // eye centred over a one-block pillar is on no side face's open side.)
  const srv = server(), cell = [20, G + 1, 0], nodes = new Map([['21,0', [G + 1]]]), want = { name: 'oak_planks', ws: null, blind: true }
  const raised = B.stepFor(srv.read, HOME, cell, new Map([['21,0', [G + 2]]]), () => true, want)
  assert.deepStrictEqual(raised?.support, [20, G, 0], 'the control: with the pillar thought away the click is the ground\'s')
  const plan = TS.planTempStand({ read: srv.read, home: HOME, cell, want, nodes, domain: () => true, max: 1 })
  assert.deepStrictEqual(plan, { ok: false, why: 'support_is_stand' })
  await withStandMutant('      if (s2 && !keys.has(kOf(s2.support))) return {', '      if (s2) return {', async M => {
    const p = M.planTempStand({ read: srv.read, home: HOME, cell, want, nodes, domain: () => true, max: 1 })
    assert.ok(p.ok && k(p.step.support) === k(p.cells[0]), 'the mutant: the cell would be clicked onto the stand')
  })
})

// ---- 2. the visits ---------------------------------------------------------------------------------------------------------------
const twoVisits = async (Mod, { stand, opts, inv } = {}) => {
  const srv = server(), pr = project(record())
  const e1 = body(srv, 'A', inv ? { inv: { ...inv } } : {}); const r1 = await visit(Mod, pr, e1, { stand, opts })
  const e2 = body(srv, 'A', inv ? { inv: { ...inv } } : {}); const r2 = await visit(Mod, pr, e2, { stand, opts })
  return { srv, pr, e1, r1, e2, r2 }
}
const firstMiss = async Mod => {
  const srv = server(), pr = project(record())
  const e = body(srv); const r = await visit(Mod, pr, e)
  assert.strictEqual(r.stop, 'cell_deferred', `${r.stop} ${r.why}`)
  assert.strictEqual(r.placed, 2, 'the two cells the ground reaches (the positive control: the visit works)')
  assert.deepStrictEqual(tsRows(e), [], 'no stand row on a first miss')
  assert.deepStrictEqual(everDirt(srv), [], 'nothing but the post was ever placed')
  assert.deepStrictEqual(receipts(pr), [])
  assert.strictEqual(PJ.stuckRead(pr.dir, pr.key)[k(TOP)]?.visits, 1, 'the miss is counted, as before')
}
await t('a first miss builds nothing: the cell is deferred and counted exactly as before', () => firstMiss(R))
const secondVisit = async Mod => {
  const { srv, pr, e2, r2 } = await twoVisits(Mod)
  // the control: the same two visits with no stand
  const c = await twoVisits(Mod, { opts: { tempStand: false } })
  assert.strictEqual(c.r2.stop, 'cell_deferred'); assert.strictEqual(c.srv.read(...TOP).name, 'air', 'the control leaves the cell open')
  assert.strictEqual(r2.stop, 'complete', `${r2.stop} ${r2.why}`)
  assert.strictEqual(srv.read(...TOP).name, 'oak_planks', 'the cell is laid')
  assert.deepStrictEqual(solids(srv), { ...solids(c.srv), [k(TOP)]: 'oak_planks' }, 'the world is the control\'s plus the one cell')
  assert.deepStrictEqual(dirtIn(srv), [], 'the stand is gone')
  const placedDirt = everDirt(srv)
  assert.strictEqual(placedDirt.length, 1, `one block was the whole stand (${placedDirt})`)
  assert.deepStrictEqual(receipts(pr), [], 'the receipt is cleared')
  const rows = tsRows(e2)
  assert.deepStrictEqual(rows.map(d => d.result), ['plan', 'removed', 'done'], JSON.stringify(rows))
  assert.deepStrictEqual(rows[0].cell, TOP); assert.strictEqual(rows[0].block, 'dirt'); assert.strictEqual(rows[0].n, 1); assert.strictEqual(rows[0].to, placedDirt[0])
  assert.strictEqual(rows[2].n, 1, 'one cell worked from it')
  assert.ok(e2.logs.some(([kk, d]) => kk === '_build' && d.op === 'place' && d.kind === 'tempstand' && k(d.cell) === k(TOP)), 'the cell\'s place row names the stand')
  assert.strictEqual(k(e2.feet()), placedDirt[0], 'the builder stands on the node it started from')
  assert.strictEqual(r2.placed, 1, 'the stand\'s own block is not a placement of the record')
  assert.deepStrictEqual(r2.placedBy, { oak_planks: 1 }, 'nor of the bag\'s tally')
  assert.deepStrictEqual(PJ.stuckRead(pr.dir, pr.key), {}, 'a cell worked from a stand no longer counts toward stuck')
  assert.strictEqual(PJ.stuckAt(pr.dir, pr.key), null)
}
await t('the second visit: a one-block stand, the cell laid, the stand gone -- the world is the control\'s plus the one cell', () => secondVisit(R))
await t('positive control: with the switch off (and with no p.tempStand) the same visits never complete and go stuck_on_cell', async () => {
  for (const how of [{ opts: { tempStand: false } }, { stand: null }]) {
    const srv = server(), pr = project(record())
    const stops = []
    for (let i = 0; i < R.STUCK_VISITS; i++) { const e = body(srv); stops.push((await visit(R, pr, e, how)).stop); assert.deepStrictEqual(tsRows(e), []) }
    assert.deepStrictEqual(stops, ['cell_deferred', 'cell_deferred', 'stuck_on_cell'], `${stops}`)
    assert.deepStrictEqual(everDirt(srv), []); assert.strictEqual(srv.read(...TOP).name, 'air')
    assert.strictEqual(PJ.stuckRead(pr.dir, pr.key)[k(TOP)]?.visits, R.STUCK_VISITS)
  }
})
await t('a bot with no pillar step (no rise / land / settle effects) builds no stand: deferred as before', async () => {
  const srv = server(), pr = project(record())
  for (let i = 0; i < 2; i++) { const e = bot(srv, 'A', { inv: { oak_planks: 16, dirt: 8 } }); const r = await visit(R, pr, e); assert.strictEqual(r.stop, 'cell_deferred'); assert.deepStrictEqual(tsRows(e), []) }
  assert.deepStrictEqual(everDirt(srv), [])
})
await t('no cheap block in the bag: refused and named, nothing placed, the cell deferred as before -- and never counted against the cell', async () => {
  const { srv, pr, e2, r2 } = await twoVisits(R, { inv: { oak_planks: 16 } })
  assert.strictEqual(r2.stop, 'cell_deferred')
  assert.deepStrictEqual(tsRows(e2).map(d => `${d.result} ${d.why}`), ['refused no_material'])
  assert.deepStrictEqual(everDirt(srv), []); assert.deepStrictEqual(receipts(pr), [])
  // the same bot's memory, a bag with dirt: the stand is built (the refusal spent none of the cell's tries)
  const mem = {}
  const s2 = server(), p2 = project(record())
  for (let i = 0; i < 3; i++) await visit(R, p2, body(s2, 'A', { inv: { oak_planks: 16 } }), { stand: { mayPlace: () => true, mem } })
  const e = body(s2); const r = await visit(R, p2, e, { stand: { mayPlace: () => true, mem } })
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why}`)
})
await t('too late in the visit (less than TEMPSTAND.minMs left): no stand is started', async () => {
  const srv = server(), pr = project(record())
  await visit(R, pr, body(srv))
  const e = body(srv); const r = await visit(R, pr, e, { opts: { deadline: Date.now() + TS.TEMPSTAND.minMs - 5_000 } })
  assert.strictEqual(r.stop, 'cell_deferred'); assert.deepStrictEqual(tsRows(e), []); assert.deepStrictEqual(everDirt(srv), [])
})
await t('bounded per cell: after TEMPSTAND.tries stands that did not lay it, the bot builds no more for that cell', async () => {
  const srv = server(), pr = project(record()), mem = {}
  await visit(R, pr, body(srv), { stand: { mayPlace: () => true, mem } })
  const ack = target => (k(target) === k(TOP) ? 'refuse' : 'ok')   // the server refuses the cell itself, every time
  const results = []
  for (let i = 0; i < TS.TEMPSTAND.tries + 2; i++) { const e = body(srv, 'A', { ack }); await visit(R, pr, e, { stand: { mayPlace: () => true, mem } }); results.push(tsRows(e).map(d => d.result).join('+')); assert.deepStrictEqual(dirtIn(srv), [], 'every stand came down') }
  assert.deepStrictEqual(results, ['plan+removed+done', 'plan+removed+done', '', ''], `${results}`)
  assert.deepStrictEqual(receipts(pr), [])
})

// three posts in one segment, far apart: three cells no ground stand reaches, one stand a visit
const POSTS3 = [10, 20, 30].map(x => [1, 2, 3].map(i => [x, G + i, 0]))
const record3 = () => ({ v: 1, plot: 'shop', cells: POSTS3.flat().map(at => ({ at, role: 'post', seg: 'A' })), segments: [{ seg: 'A', deps: [] }], clear: [], replant: [] })
const progress = async Mod => {
  const srv = server(), pr = project(record3()), mem = {}
  const stops = [], stamps = [], laid = []
  for (let i = 0; i < 4; i++) {
    const e = body(srv, 'A', { inv: { oak_planks: 32, dirt: 8 } }); const r = await visit(Mod, pr, e, { stand: { mayPlace: () => true, mem } })
    stops.push(r.stop); stamps.push(PJ.stuckAt(pr.dir, pr.key)); laid.push(POSTS3.filter(q => srv.read(...q[2]).name === 'oak_planks').length)
    assert.deepStrictEqual(dirtIn(srv), [], 'every stand came down')
  }
  assert.deepStrictEqual(laid, [0, 1, 2, 3], 'the positive control: one stand a visit, one top cell each')
  // visit 3 lays its cell while the last one has been deferred three times: the project moved, so it is NOT stamped stuck (no 6-hour
  // back-off) and the bot's own stop is cell_deferred
  assert.deepStrictEqual(stops, ['cell_deferred', 'cell_deferred', 'cell_deferred', 'complete'], `${stops}`)
  assert.deepStrictEqual(stamps, [null, null, null, null], 'never stamped stuck while stands lay cells')
}
await t('a visit that laid a cell from a stand is progress: no stuck stop and no 6-hour stamp for the cells still waiting their turn', () => progress(R))
await t('the positive control for that: the same three posts with no stand end stuck_on_cell and stamped at the third visit', async () => {
  const srv = server(), pr = project(record3())
  const stops = []
  for (let i = 0; i < 3; i++) stops.push((await visit(R, pr, body(srv, 'A', { inv: { oak_planks: 32, dirt: 8 } }), { stand: null })).stop)
  assert.deepStrictEqual(stops, ['cell_deferred', 'cell_deferred', 'stuck_on_cell']); assert.ok(PJ.stuckAt(pr.dir, pr.key) > 0, 'stamped')
})
/** A bag whose dirt is all KEPT (the scaffold reserve): `has` and `count` say none to spare, `countAll` / `holdKept` reach it. */
function keptDirt (srv, { reserve = true } = {}) {
  const inv = { oak_planks: 16, dirt: 3 }
  const e = body(srv, 'A', { inv })
  let viaKept = false
  const hold0 = e.hold, has0 = e.has
  e.hold = async n => (n === 'dirt' && !viaKept ? false : hold0(n))
  e.has = Object.assign(n => (n === 'dirt' ? false : has0(n)), { planks: has0.planks })
  e.count = n => (n === 'dirt' ? 0 : inv[n] ?? 0)
  if (reserve) { e.countAll = n => inv[n] ?? 0; e.holdKept = async n => { viaKept = true; try { return await hold0(n) } finally { viaKept = false } } }
  return e
}
await t('the scaffold reserve: a stand may be made of KEPT dirt the segment does not place itself (it is dug back); without that effect: no_material', async () => {
  const srv = server(), pr = project(record())
  await visit(R, pr, keptDirt(srv))
  const e = keptDirt(srv); const r = await visit(R, pr, e)
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why} ${JSON.stringify(tsRows(e))}`)
  assert.deepStrictEqual(dirtIn(srv), []); assert.strictEqual(everDirt(srv).length, 1)
  const s2 = server(), p2 = project(record())
  await visit(R, p2, keptDirt(s2, { reserve: false }))
  const e2 = keptDirt(s2, { reserve: false }); const r2 = await visit(R, p2, e2)
  assert.strictEqual(r2.stop, 'cell_deferred'); assert.deepStrictEqual(tsRows(e2).map(d => `${d.result} ${d.why}`), ['refused no_material'], 'the control')
})
await t('a stand never spends the block its own segment places: a post of DIRT takes its stand from the spare dirt only, one left for the cell', async () => {
  // the cell's own block is dirt here: the bag's whole count (`countAll`: 64, the keeps) is never asked for it -- the spare is
  const rec = { ...record(), cells: record().cells.map(c => ({ ...c, role: 'mud' })) }
  const srv = server({ [k(POST[0])]: 'dirt', [k(POST[1])]: 'dirt' }), pr = project(rec)
  const mk = () => { const e = body(srv, 'A', { inv: { dirt: 2 } }); e.countAll = n => (n === 'dirt' ? 64 : 0); e.holdKept = e.hold; return e }
  const pal = { mud: ['dirt'] }
  const go = e => { const h = PJ.recordHead(pr.dir, pr.key); return R.runVisit({ ...pr.p('A'), palette: pal, record: h.head.rec, recordGen: h.head.gen, domain: () => true, tempStand: { mayPlace: () => true, mem: {} } }, e, { maxSteps: 400, tempStand: true }) }
  await go(mk())
  const e = mk(); const r = await go(e)
  // two dirt to spare: one for the stand, one left for the cell -> built and laid
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${JSON.stringify(tsRows(e))}`)
  const s2 = server({ [k(POST[0])]: 'dirt', [k(POST[1])]: 'dirt' }), p2 = project(rec)
  const mk1 = () => { const e1 = body(s2, 'A', { inv: { dirt: 1 } }); e1.countAll = n => (n === 'dirt' ? 64 : 0); e1.holdKept = e1.hold; return e1 }
  const go2 = e1 => { const h = PJ.recordHead(p2.dir, p2.key); return R.runVisit({ ...p2.p('A'), palette: pal, record: h.head.rec, recordGen: h.head.gen, domain: () => true, tempStand: { mayPlace: () => true, mem: {} } }, e1, { maxSteps: 400, tempStand: true }) }
  await go2(mk1())
  const e1 = mk1(); const r1 = await go2(e1)
  assert.strictEqual(r1.stop, 'cell_deferred'); assert.deepStrictEqual(tsRows(e1).map(d => `${d.result} ${d.why}`), ['refused no_material'], 'one dirt: the cell\'s own')
  assert.strictEqual(s2.read(...TOP).name, 'air')
})

await t('buildbot.mjs effects: `count` / `hold` stop at the keeps; `countAll` / `holdKept` reach the scaffold reserve', async () => {
  const { EventEmitter } = await import('node:events')
  const BB = await import('../src/buildbot.mjs')
  const client = new EventEmitter(); client.write = () => {}
  const items = [{ name: 'dirt', count: 3 }, { name: 'oak_planks', count: 5 }]
  const fb = Object.assign(new EventEmitter(), { _client: client, entity: { position: { x: 0, y: 0, z: 0 }, pitch: 0, yaw: 0, onGround: true }, blockAt: () => null, inventory: { items: () => items }, players: {}, heldItem: null })
  fb.equip = async it => { fb.heldItem = it }
  const e = BB.botBuildEffects(fb, { keep: { dirt: 3 } })
  try {
    assert.strictEqual(e.count('dirt'), 0); assert.strictEqual(e.has('dirt'), false); assert.strictEqual(await e.hold('dirt'), false, 'the keeps hold: no dirt to spare')
    assert.strictEqual(fb.heldItem, null, 'nothing was equipped')
    assert.strictEqual(e.countAll('dirt'), 3); assert.strictEqual(await e.holdKept('dirt'), true); assert.strictEqual(fb.heldItem?.name, 'dirt')
    assert.strictEqual(await e.holdKept('cobblestone'), false, 'never a block the bag does not hold')
    assert.strictEqual(e.count('oak_planks'), 5, 'the positive control: an unkept block is spare'); assert.strictEqual(await e.hold('oak_planks'), true)
  } finally { e.close() }
})

// ---- 3. the receipt --------------------------------------------------------------------------------------------------------------
await t('buildproj: standWrite / standRead / standCells -- one file a holder, fresh cells listed, stale ones not, null removes', async () => {
  const pr = project(record())
  const rc = { block: 'dirt', base: [1, 70, 1], cells: [[1, 70, 1], [1, 71, 1]], target: [2, 73, 1], seg: 'A', at: 1_000_000 }
  assert.strictEqual(PJ.standWrite(pr.dir, pr.key, 'A', rc), true)
  assert.strictEqual(PJ.standWrite(pr.dir, pr.key, 'B', { ...rc, cells: [[5, 70, 5]], base: [5, 70, 5], at: 1_000_000 - 20 * 60_000 }), true)
  assert.deepStrictEqual(PJ.standRead(pr.dir, pr.key, { holder: 'A' }), [{ holder: 'A', at: 1_000_000, block: 'dirt', base: [1, 70, 1], cells: [[1, 70, 1], [1, 71, 1]], target: [2, 73, 1], seg: 'A', tries: 0 }])
  assert.deepStrictEqual(PJ.standRead(pr.dir, pr.key, { exclude: 'A' }).map(r => r.holder), ['B'])
  assert.deepStrictEqual(PJ.standRead(pr.dir, pr.key).map(r => r.holder).sort(), ['A', 'B'])
  assert.deepStrictEqual([...PJ.standCells(pr.dir, { now: 1_000_000 + 60_000 })].sort(), ['1,70,1', '1,71,1'], 'the fresh receipt\'s cells; the stale one\'s are ordinary litter')
  assert.deepStrictEqual([...PJ.standCells(pr.dir, { now: 1_000_000 + 60 * 60_000 })], [], 'an hour on: none')
  assert.strictEqual(TS.standLive(PJ.standRead(pr.dir, pr.key, { holder: 'A' })[0], 'B', 1_000_000 + 60_000), true)
  assert.strictEqual(TS.standLive(PJ.standRead(pr.dir, pr.key, { holder: 'A' })[0], 'A', 1_000_000 + 60_000), false, 'never live to its own holder')
  assert.strictEqual(TS.standLive(PJ.standRead(pr.dir, pr.key, { holder: 'B' })[0], 'A', 1_000_000), false, 'stale')
  assert.strictEqual(PJ.standWrite(pr.dir, pr.key, 'A', null), true); assert.strictEqual(PJ.standWrite(pr.dir, pr.key, 'A', null), true, 'removing twice is fine')
  assert.deepStrictEqual(PJ.standRead(pr.dir, pr.key).map(r => r.holder), ['B'])
  fs.writeFileSync(`${pr.dir}/${pr.key}.tempstand.C.json`, '{ not json')
  assert.deepStrictEqual(PJ.standRead(pr.dir, pr.key).map(r => r.holder), ['B'], 'an unreadable receipt is none')
})
/** Visit 1 defers; visit 2 is ABORTED the moment its pillar block lands (a reflex takes the body). -> the scene after visit 2. */
const abortedStand = async Mod => {
  const srv = server(), pr = project(record())
  await visit(Mod, pr, body(srv))
  let gone = false, seenReceipt = null
  const e2 = body(srv, 'A', { aborted: () => gone, ack: (target, held) => { if (held === 'dirt') { seenReceipt = receipts(pr).length; gone = true } return 'ok' } })
  const r2 = await visit(Mod, pr, e2)
  return { srv, pr, e2, r2, seenReceipt }
}
const receiptFirst = async Mod => {
  const { srv, pr, r2, seenReceipt } = await abortedStand(Mod)
  assert.strictEqual(r2.stop, 'aborted')
  assert.strictEqual(seenReceipt, 1, 'the receipt was on disk when the first block was sent')
  const dirt = dirtIn(srv)
  assert.strictEqual(dirt.length, 1, 'the positive control: the aborted visit left its block standing')
  const rc = PJ.standRead(pr.dir, pr.key, { holder: 'A' })
  assert.strictEqual(rc.length, 1, 'the receipt names it'); assert.deepStrictEqual(rc[0].cells.map(k), dirt); assert.strictEqual(rc[0].block, 'dirt'); assert.deepStrictEqual(rc[0].target, TOP)
  assert.ok(PJ.standCells(pr.dir).has(dirt[0]), 'and the tidy\'s survey is told of it while it is fresh')
  return { srv, pr, dirt }
}
await t('an aborted stand leaves its receipt (written BEFORE the first block) and its block', () => receiptFirst(R))
const nextVisitRemoves = async (Mod, where) => {
  const { srv, pr, dirt } = await receiptFirst(Mod)
  const at = dirt[0].split(',').map(Number)
  // the next visit: the bot elsewhere on the ground, or still standing on its pillar
  const e3 = body(srv, 'A', { feet: where === 'on' ? [at[0], at[1] + 1, at[2]] : [2, G + 1, 0] })
  const order = []
  const dig0 = e3.dig; e3.dig = async (c, n) => { order.push(`dig ${k(c)}`); return dig0(c, n) }
  const send0 = e3.send; e3.send = (...a) => { order.push('send'); return send0(...a) }
  const r3 = await visit(Mod, pr, e3)
  assert.strictEqual(order[0], `dig ${dirt[0]}`, `the leftover stand comes down before anything else is placed (${order.slice(0, 3)})`)
  const rows = tsRows(e3)
  assert.deepStrictEqual([rows[0].result, rows[0].why, rows[0].n], ['removed', 'leftover', 1], JSON.stringify(rows[0]))
  assert.strictEqual(r3.stop, 'complete', `${r3.stop} ${r3.why}: the same visit then builds its own stand and lays the cell`)
  assert.deepStrictEqual(dirtIn(srv), []); assert.deepStrictEqual(receipts(pr), [])
  assert.deepStrictEqual(solids(srv), Object.fromEntries(POST.map(p => [k(p), 'oak_planks'])), 'the world: the post, nothing else')
}
await t('the next visit takes the leftover stand down first (the bot on the ground: dug from the walk), then goes on', () => nextVisitRemoves(R, 'off'))
await t('the next visit takes the leftover stand down first (the bot still on its pillar: it digs under its feet)', () => nextVisitRemoves(R, 'on'))
await t('another holder\'s receipt: left alone while fresh, taken down once stale; never dug when the cell holds another block', async () => {
  const srv = server(), pr = project(record(), ['A', 'B'])
  const at = [4, G + 1, 4], other = [6, G + 1, 6]
  srv.set(at, 'dirt'); srv.set(other, 'cobblestone')
  PJ.standWrite(pr.dir, pr.key, 'B', { block: 'dirt', base: at, cells: [at], target: TOP, seg: 'A', at: Date.now() })
  const e1 = body(srv); await visit(R, pr, e1)
  assert.strictEqual(srv.read(...at).name, 'dirt', 'fresh: B\'s visit may still be on it'); assert.strictEqual(receipts(pr).length, 1)
  PJ.standWrite(pr.dir, pr.key, 'B', { block: 'dirt', base: at, cells: [at, other], target: TOP, seg: 'A', at: Date.now() - TS.TEMPSTAND.staleMs - 1 })
  const e2 = body(srv); await visit(R, pr, e2)
  assert.strictEqual(srv.read(...at).name, 'air', 'stale: taken down by the next visit to the project')
  assert.strictEqual(srv.read(...other).name, 'cobblestone', 'a cell that holds another block than the receipt\'s is never dug')
  assert.ok(tsRows(e2).some(d => d.result === 'removed' && d.why === 'leftover'), JSON.stringify(tsRows(e2)))
  assert.ok(!receipts(pr).some(n => /\.B\.json$/.test(n)), 'B\'s receipt is cleared')
})
await t('a leftover no stand can dig stays on its receipt, counted; after TEMPSTAND.downTries visits it is left to the grounds crew', async () => {
  const srv = server(), pr = project(record())
  const at = [4, G + 1, 4]
  srv.set(at, 'dirt')
  PJ.standWrite(pr.dir, pr.key, 'A', { block: 'dirt', base: at, cells: [at], target: TOP, seg: 'A', at: Date.now() })
  let digs = 0
  for (let i = 0; i < TS.TEMPSTAND.downTries + 2; i++) {
    const e = body(srv, 'A', { dig: async () => { digs++; return 'refused' } })
    await visit(R, pr, e, { stand: { mayPlace: () => false, mem: {} } })
  }
  assert.strictEqual(digs, TS.TEMPSTAND.downTries, 'bounded')
  assert.strictEqual(PJ.standRead(pr.dir, pr.key, { holder: 'A' })[0]?.tries, TS.TEMPSTAND.downTries, 'the receipt stays while the block stands')
  srv.set(at, 'air')   // the grounds crew cut it
  await visit(R, pr, body(srv), { stand: { mayPlace: () => false, mem: {} } })
  assert.deepStrictEqual(receipts(pr), [], 'gone from the world: the receipt goes')
})
await t('the server refuses the pillar: nothing stands, the receipt is cleared, a failed row, the cell deferred as before', async () => {
  const srv = server(), pr = project(record())
  await visit(R, pr, body(srv))
  const e = body(srv, 'A', { ack: (target, held) => (held === 'dirt' ? 'refuse' : 'ok') })
  const r = await visit(R, pr, e)
  assert.strictEqual(r.stop, 'cell_deferred', `${r.stop} ${r.why}`)
  assert.deepStrictEqual(tsRows(e).map(d => d.result), ['plan', 'removed', 'failed'], JSON.stringify(tsRows(e)))
  assert.match(tsRows(e)[2].why, /^pillar .* refused$/)
  assert.deepStrictEqual(everDirt(srv), []); assert.deepStrictEqual(receipts(pr), [])
  assert.strictEqual(PJ.stuckRead(pr.dir, pr.key)[k(TOP)]?.visits, 2, 'counted toward stuck exactly as before')
})
await t('a SILENT pillar click: the receipt is kept (the block may still land); the next visit reads the world and clears or digs', async () => {
  const srv = server(), pr = project(record())
  await visit(R, pr, body(srv))
  let target = null
  const e = body(srv, 'A', { capWait: 20, ack: (tg, held) => { if (held === 'dirt') { target = tg; return 'silent' } return 'ok' } })
  const r = await visit(R, pr, e)
  assert.strictEqual(r.stop, 'cell_deferred')
  assert.strictEqual(receipts(pr).length, 1, 'kept'); assert.ok(tsRows(e).some(d => d.result === 'removed' && /receipt_kept/.test(d.why)))
  srv.set(target, 'dirt')   // the click lands late
  const e2 = body(srv); await visit(R, pr, e2)
  assert.strictEqual(srv.read(...target).name, 'air', 'the late block is taken down by the next visit')
  assert.ok(tsRows(e2).some(d => d.result === 'removed' && d.why === 'leftover' && d.n === 1))
})

// ---- 4. where a stand may be -----------------------------------------------------------------------------------------------------
const NEAR = [[PX + 1, PZ], [PX - 1, PZ], [PX, PZ + 1], [PX, PZ - 1], [PX + 1, PZ + 1], [PX + 1, PZ - 1], [PX - 1, PZ + 1], [PX - 1, PZ - 1]]
const vetoed = async Mod => {
  // every column within 1 of the post belongs to ANOTHER record (the caller's veto), and the record's own later segment has its
  // cells two out to the east: the stand goes to a column that is neither
  const otherCells = new Set(NEAR.flatMap(([x, z]) => [1, 2, 3].map(i => k([x, G + i, z]))))
  const own = [[PX + 2, G + 1, PZ], [PX + 2, G + 1, PZ + 1], [PX + 2, G + 1, PZ - 1]].map(at => ({ at, role: 'rail', seg: 'B' }))
  const srv = server(), pr = project(record(own))
  const stand = { mayPlace: at => !otherCells.has(k(at)), mem: {} }
  await visit(Mod, pr, body(srv), { stand })
  const e = body(srv); const r = await visit(Mod, pr, e, { stand })
  const placed = everDirt(srv).filter(c => !own.some(o => k(o.at) === c))
  assert.strictEqual(srv.read(...TOP).name, 'oak_planks', `${r.stop} ${r.why} ${JSON.stringify(tsRows(e))}`)
  assert.strictEqual(placed.length, 1, 'the positive control: a stand was built')
  assert.ok(!otherCells.has(placed[0]), `never in another record's cell (${placed[0]})`)
  assert.ok(!own.some(o => k(o.at) === placed[0]), 'never in this record\'s own cell')
  assert.deepStrictEqual(dirtIn(srv), [])
}
await t('never in another record\'s cells (the caller\'s veto), never in this record\'s own: the stand goes where neither is', () => vetoed(R))
await t('every column vetoed: refused and named, nothing placed, deferred as before', async () => {
  const srv = server(), pr = project(record())
  const stand = { mayPlace: () => false, mem: {} }
  await visit(R, pr, body(srv), { stand })
  const e = body(srv); const r = await visit(R, pr, e, { stand })
  assert.strictEqual(r.stop, 'cell_deferred')
  assert.strictEqual(tsRows(e).length, 1); assert.strictEqual(tsRows(e)[0].result, 'refused'); assert.match(tsRows(e)[0].why, /^vetoed/)
  assert.deepStrictEqual(everDirt(srv), []); assert.deepStrictEqual(receipts(pr), [])
})
await t('the stand\'s click never walks: the builder clicks from the top of its pillar, and one stand a visit', async () => {
  const { e2 } = await twoVisits(R)
  const plan = tsRows(e2)[0]
  assert.deepStrictEqual(e2.walks.filter(w => k(w) !== plan.to).filter(w => w[1] > G + 1), [], 'no walk to a stand above the ground')
  assert.strictEqual(tsRows(e2).filter(d => d.result === 'plan').length, 1)
})

// ---- 5. mutants --------------------------------------------------------------------------------------------------------------------
await t('MUTANT: a stand on the first miss dies on "no stand row on a first miss"', () =>
  kills('    const due = new Set(TS.standDue(standCounts, cand.map(c => kOf(c.at))))', '    const due = new Set(cand.map(c => kOf(c.at)))', firstMiss))
await t('MUTANT: a stand that is never taken down dies on "the world is the control\'s plus the one cell"', () =>
  kills("    const d = await standDown(rc, held, 'done')\n", "    const d = { removed: 0, left: 0 }\n", secondVisit))
await t('MUTANT: a stand placed with no receipt dies on "the receipt was on disk when the first block was sent"', () =>
  kills("    if (!PJ.standWrite(dir, key, me, rc, { now: now() })) { tsRow({ seg, cell: target.at, result: 'refused', why: 'receipt_unwritten' }); res.result = 'refused'; return res }\n", '', receiptFirst))
await t('MUTANT: a leftover stand that is not taken down first dies on "comes down before anything else"', () =>
  kills("      await standDown(rc, null, 'leftover')\n", '', M => nextVisitRemoves(M, 'off')))
await t('MUTANT: the caller\'s veto ignored dies on "never in another record\'s cell"', () =>
  kills('    const mayPlace = tstand.mayPlace ?? (() => true)\n', '    const mayPlace = () => true\n', vetoed))
await t('MUTANT: the record\'s own cells not kept out dies on "never in this record\'s own cell"', async () => {
  // the record's later segment stands in EVERY column within 1 of the post: the stand must go two out
  const scenario = async Mod => {
    const own = NEAR.map(([x, z]) => ({ at: [x, G + 1, z], role: 'rail', seg: 'B' }))
    const srv = server(), pr = project(record(own))
    await visit(Mod, pr, body(srv))
    const dirtAt = []
    const e = body(srv, 'A', { ack: (target, held) => { if (held === 'dirt') dirtAt.push(k(target)); return 'ok' } }); await visit(Mod, pr, e)
    assert.strictEqual(dirtAt.length, 1, `the positive control: a stand was built (${JSON.stringify(tsRows(e))})`)
    assert.ok(!own.some(o => k(o.at) === dirtAt[0]), `never in this record's own cell (${dirtAt[0]})`)
  }
  await kills('        pl = TS.planTempStand({ read: rd, home, cell: c.at, want: wantOf(c), nodes, domain, min: h, max: h, block: b, mayPlace, taken: at => standTaken.has(kOf(at)) })', '        pl = TS.planTempStand({ read: rd, home, cell: c.at, want: wantOf(c), nodes, domain, min: h, max: h, block: b, mayPlace })', scenario)
})
await t('MUTANT: a stand\'s progress still stamped stalled dies on "never stamped stuck while stands lay cells"', () =>
  kills('    const stalled = atEnd && !standWorked && segmentsOf(record)', '    const stalled = atEnd && segmentsOf(record)', progress))
await t('MUTANT: a stand\'s progress still stopping stuck_on_cell dies on the stops', () =>
  kills("      if (standWorked) return { stop: 'cell_deferred',", "      if (false) return { stop: 'cell_deferred',", progress))
await t('MUTANT (tempstand.mjs): standDue without its threshold lets a first miss through', async () => {
  await withStandMutant('  return keys.filter(k => (Number(counts?.[k]?.visits) || 0) >= after)', '  return keys.filter(k => (Number(counts?.[k]?.visits) || 0) >= 0)', async M => {
    assert.deepStrictEqual(TS.standDue({}, ['1,2,3']), [], 'the real one')
    assert.deepStrictEqual(M.standDue({}, ['1,2,3']), ['1,2,3'], 'the mutant: the same assertion would fail')
  })
})
await t('MUTANT (tempstand.mjs): standColumn without the air rule would raise a pillar through a plant', async () => {
  const srv = server({ [k([5, G + 1, 5])]: 'short_grass' })
  await withStandMutant("    if (nm(b) !== 'air') return { ok: false, why: `not_air ${nm(b)} ${kOf(at)}` }\n", '', async M => {
    assert.strictEqual(TS.standColumn(srv.read, [5, G + 1, 5], 1).ok, false, 'the real one')
    assert.strictEqual(M.standColumn(srv.read, [5, G + 1, 5], 1).ok, true, 'the mutant: the same assertion would fail')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
