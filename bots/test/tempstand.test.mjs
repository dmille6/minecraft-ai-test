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
// A KILL MEANS THE NAMED ASSERTION (review r1, Codex: any AssertionError let a mutant die on a positive control that the runtime's
// second defence failed, with the planner's own defence untested): every scenario's deciding assertion carries a TAG in its message,
// and the mutant must fail on THAT one (bots/test/thprep.test.mjs NO-TWO-WALKS) -- never a crash, never another assertion
const kills = async (old, neu, scenario, tag) => {
  assert.ok(typeof tag === 'string' && /^[A-Z][A-Z-]+$/.test(tag), 'a kill names its assertion')
  await scenario(R)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError && String(why.message).includes(`${tag}:`), `the mutant survived or died for another reason than ${tag}: ${why?.message?.slice(0, 120) ?? 'survived'}`)
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
const PAL = { post: ['oak_planks'], rail: ['oak_planks'], mud: ['dirt'] }
const record = (extra = []) => ({ v: 1, plot: 'shop', cells: [...POST.map(at => ({ at, role: 'post', seg: 'A' })), ...extra], segments: [{ seg: 'A', deps: [] }, ...(extra.length ? [{ seg: 'B', deps: ['A'] }] : [])], clear: [], replant: [] })
/** The fake bot with a body (voidfill.test.mjs): walks teleport, a pillar's place lifts it (land after rise), a dig underfoot drops it. */
function body (srv, name = 'A', { inv = { oak_planks: 16, dirt: 8 }, feet = [2, G + 1, 0], pickup = true, ...o } = {}) {
  const e = bot(srv, name, { inv, feet, ...o })
  // a dug block comes back to the bag (`pickup: false`: it does not -- a drop out of reach, a stone dug by hand)
  const dig0 = e.dig
  e.dig = async (c, n) => { const was = srv.read(...c)?.name; const v = await dig0(c, n); if (pickup && v === 'confirmed' && was && was !== 'air' && srv.read(...c)?.name === 'air') inv[was] = (inv[was] ?? 0) + 1; return v }
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
  assert.deepStrictEqual(tsRows(e), [], 'NO-FIRST-MISS: no stand row on a first miss')
  assert.strictEqual(r.stop, 'cell_deferred', `${r.stop} ${r.why}`)
  assert.strictEqual(r.placed, 2, 'the two cells the ground reaches (the positive control: the visit works)')
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
  assert.deepStrictEqual(solids(srv), { ...solids(c.srv), [k(TOP)]: 'oak_planks' }, 'WORLD-EQUAL: the world is the control\'s plus the one cell')
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
  assert.deepStrictEqual(stops, ['cell_deferred', 'cell_deferred', 'cell_deferred', 'complete'], `NOT-STUCK-STOP: ${stops}`)
  assert.deepStrictEqual(stamps, [null, null, null, null], 'NOT-STAMPED: never stamped stuck while stands lay cells')
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
    assert.strictEqual(e.pickaxe(), false, 'no pickaxe in this bag')
    items.push({ name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 130 }); assert.strictEqual(e.pickaxe(), false, 'one use left is none (the access\'s own rule)')
    items.push({ name: 'wooden_pickaxe', count: 1, maxDurability: 59, durabilityUsed: 3 }); assert.strictEqual(e.pickaxe(), true)
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
  assert.strictEqual(seenReceipt, 1, 'RECEIPT-FIRST: the receipt was on disk when the first block was sent')
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
  assert.strictEqual(order[0], `dig ${dirt[0]}`, `LEFTOVER-FIRST: the leftover stand comes down before anything else is placed (${order.slice(0, 3)})`)
  const rows = tsRows(e3)
  assert.deepStrictEqual([rows[0].result, rows[0].why, rows[0].n], ['removed', 'leftover', 1], JSON.stringify(rows[0]))
  assert.strictEqual(r3.stop, 'complete', `${r3.stop} ${r3.why}: the same visit then builds its own stand and lays the cell`)
  assert.deepStrictEqual(dirtIn(srv), []); assert.deepStrictEqual(receipts(pr), [])
  assert.deepStrictEqual(solids(srv), Object.fromEntries(POST.map(p => [k(p), 'oak_planks'])), 'the world: the post, nothing else')
  // (r1, Claude's note b) a block dug from the walk lies at the stand's base: this bot's own is walked to once (the reserve comes back)
  if (where === 'off') assert.ok(e3.walks.some(w => k(w) === dirt[0]), `the base is walked to after a take-down from the walk (${e3.walks.map(k).join(' ')})`)
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
    await visit(R, pr, e)
    assert.deepStrictEqual(everDirt(srv), [], 'and no new stand while it stands')
  }
  assert.strictEqual(digs, TS.TEMPSTAND.downTries, 'bounded')
  assert.strictEqual(PJ.standRead(pr.dir, pr.key, { holder: 'A' })[0]?.tries, TS.TEMPSTAND.downTries, 'the receipt stays while the block stands')
  srv.set(at, 'air')   // the grounds crew cut it
  const e = body(srv); const r = await visit(R, pr, e)
  assert.strictEqual(r.stop, 'complete', `gone from the world: the receipt goes, and the same visit builds its stand again (${r.stop})`)
  assert.deepStrictEqual(receipts(pr), [])
})
// ---- review r1, Codex BLOCKER 1: a new stand never replaces a receipt that still names standing blocks --------------------------
const receiptOpen = async Mod => {
  // as reproduced: the removal of an old dirt pillar is refused, and the next stand would otherwise complete
  const srv = server(), pr = project(record())
  const old = [4, G + 1, 4]
  srv.set(old, 'dirt')
  PJ.standWrite(pr.dir, pr.key, 'A', { block: 'dirt', base: old, cells: [old], target: TOP, seg: 'A', at: Date.now() })
  const dig = async (c, expect) => { if (k(c) === k(old)) return 'refused'; if (expect && srv.read(...c)?.name !== expect) return 'refused'; srv.set(c, 'air'); return 'confirmed' }
  await visit(Mod, pr, body(srv, 'A', { dig }))
  const e = body(srv, 'A', { dig }); const r = await visit(Mod, pr, e)
  assert.strictEqual(srv.read(...old).name, 'dirt', 'the positive control: the old pillar could not be dug')
  const rc = PJ.standRead(pr.dir, pr.key, { holder: 'A' })
  assert.ok(rc.length === 1 && rc[0].cells.some(c => k(c) === k(old)), `RECEIPT-OPEN: the receipt still names the old pillar (stop=${r.stop}, receipts=${receipts(pr).length})`)
  assert.strictEqual(r.stop, 'cell_deferred', 'the visit works on without a stand')
  assert.ok(tsRows(e).some(d => d.result === 'refused' && d.why === `receipt_open ${k(old)}`), JSON.stringify(tsRows(e)))
  assert.deepStrictEqual(everDirt(srv), [], 'no new stand was placed')
}
await t('r1: while this holder\'s receipt still names a standing block, no new stand is planned (the old dirt is never orphaned)', () => receiptOpen(R))

// ---- review r1, Codex BLOCKER 2: a take-down never digs a cell somebody now owns -------------------------------------------------
await t('standClaims: mine is dug top first; an owned cell and every cell under it are adopted; unknown holds; expired and built-on adopt all', async () => {
  const A = [1, 72, 1], B = [1, 71, 1], C = [1, 70, 1]
  assert.deepStrictEqual(TS.standClaims([A, B, C], () => 'mine'), { dig: [A, B, C], adopted: [], held: [] }, 'the positive control')
  assert.deepStrictEqual(TS.standClaims([A, B, C], at => (at === B ? 'owned' : 'mine')), { dig: [A], adopted: [{ at: B, why: 'owned' }, { at: C, why: 'built_on' }], held: [] })
  assert.deepStrictEqual(TS.standClaims([A, B, C], at => (at === B ? 'unknown' : 'mine')), { dig: [A], adopted: [], held: [B, C] }, 'a veto that cannot be read: nothing dug under it, nothing given away')
  assert.deepStrictEqual(TS.standClaims([A, B], () => 'mine', { expired: true }), { dig: [], adopted: [{ at: A, why: 'expired' }, { at: B, why: 'expired' }], held: [] })
  assert.deepStrictEqual(TS.standClaims([A, B], () => 'mine', { covered: at => at === A }), { dig: [], adopted: [{ at: A, why: 'built_on' }, { at: B, why: 'built_on' }], held: [] })
  assert.deepStrictEqual(TS.standClaims([], () => 'owned'), { dig: [], adopted: [], held: [] })
})
/** As reproduced: an interrupted dirt stand; its coordinate is then somebody else's (the caller's veto says so); the project resumes. */
const adopted = async (Mod, where) => {
  const { srv, pr, dirt } = await receiptFirst(Mod)
  const at = dirt[0].split(',').map(Number)
  const e3 = body(srv, 'A', { feet: where === 'on' ? [at[0], at[1] + 1, at[2]] : [2, G + 1, 0] })
  const digs = []
  const dig0 = e3.dig; e3.dig = async (c, n) => { digs.push(k(c)); return dig0(c, n) }
  await visit(Mod, pr, e3, { stand: { mayPlace: q => k(q) !== dirt[0], mem: {} } })
  assert.ok(srv.read(...at).name === 'dirt' && !digs.includes(dirt[0]), `ADOPTED: a cell somebody now owns is never dug (${digs})`)
  const row = tsRows(e3).find(d => d.result === 'adopted')
  assert.deepStrictEqual([k(row?.cell ?? []), row?.n, row?.why], [dirt[0], 1, 'owned'], JSON.stringify(tsRows(e3)))
  assert.ok(!PJ.standRead(pr.dir, pr.key).some(r => r.cells.some(c => k(c) === dirt[0])), 'and it is dropped from the receipt')
}
await t('r1: a leftover cell another project took is ADOPTED, never dug (the bot on the ground: the dig from the walk)', () => adopted(R, 'off'))
await t('r1: a leftover cell another project took is ADOPTED, never dug (the bot on its pillar: the dig under its feet)', () => adopted(R, 'on'))
/** The veto turns DURING the walk to the dig's stand: the ownership is asked again at the dig. */
const adoptedAtDig = async Mod => {
  const { srv, pr, dirt } = await receiptFirst(Mod)
  const at = dirt[0].split(',').map(Number)
  const e3 = body(srv)
  let taken = false
  const walk0 = e3.walkTo; e3.walkTo = async (...a) => { taken = true; return walk0(...a) }
  await visit(Mod, pr, e3, { stand: { mayPlace: q => !(taken && k(q) === dirt[0]), mem: {} } })
  assert.strictEqual(srv.read(...at).name, 'dirt', 'ADOPTED-AT-DIG: taken during the walk to the dig: not dug')
  assert.ok(tsRows(e3).some(d => d.result === 'adopted' && d.why === 'owned'), JSON.stringify(tsRows(e3)))
}
await t('r1: the ownership is asked again AFTER the walk to the dig\'s stand', () => adoptedAtDig(R))
await t('r1: the visit\'s OWN take-down asks too: a cell taken while the builder worked from it is left standing, adopted', async () => {
  const srv = server(), pr = project(record())
  await visit(R, pr, body(srv))
  let mine = null
  const e = body(srv, 'A', { ack: (target, held) => { if (held === 'dirt') mine = k(target); return 'ok' } })
  let laid = false
  const r = await visit(R, pr, e, { stand: { mayPlace: q => { if (mine && k(q) === mine && srv.read(...TOP).name === 'oak_planks') laid = true; return !(laid && k(q) === mine) }, mem: {} } })
  assert.strictEqual(srv.read(...TOP).name, 'oak_planks', `the positive control: the stand was built and the cell laid (${r.stop})`)
  assert.strictEqual(srv.read(...mine.split(',').map(Number)).name, 'dirt', 'taken since: not dug')
  assert.deepStrictEqual(tsRows(e).map(d => `${d.result} ${d.why ?? ''}`.trim()), ['plan', 'adopted owned', 'removed done', 'done unrecovered=1'], JSON.stringify(tsRows(e)))   // and the row says the block did not come back
  assert.deepStrictEqual(receipts(pr), [], 'the receipt names nothing any more')
})
await t('r1: a leftover cell that is now THIS record\'s own cell, one with a block set on it, and one whose receipt is past ownMs: adopted, never dug', async () => {
  for (const how of ['own', 'built_on', 'expired']) {
    const { srv, pr, dirt } = await receiptFirst(R)
    const at = dirt[0].split(',').map(Number)
    if (how === 'own') PJ.publishRecord(pr.dir, pr.key, cur => ({ ...cur, cells: [...cur.cells, { at, role: 'mud', seg: 'A' }] }))
    if (how === 'built_on') srv.set([at[0], at[1] + 1, at[2]], 'cobblestone')
    if (how === 'expired') { const rc = PJ.standRead(pr.dir, pr.key, { holder: 'A' })[0]; PJ.standWrite(pr.dir, pr.key, 'A', { ...rc, at: Date.now() - TS.TEMPSTAND.ownMs - 1 }) }
    const e3 = body(srv); await visit(R, pr, e3)
    assert.strictEqual(srv.read(...at).name, 'dirt', `${how}: not dug`)
    const row = tsRows(e3).find(d => d.result === 'adopted')
    assert.strictEqual(row?.why, how === 'own' ? 'owned' : how, `${how}: ${JSON.stringify(tsRows(e3))}`)
    assert.ok(!PJ.standRead(pr.dir, pr.key).some(r => r.cells.some(c => k(c) === dirt[0])), `${how}: dropped from the receipt`)
  }
  // the control for `expired`: a minute before ownMs the same leftover IS dug
  const { srv, pr, dirt } = await receiptFirst(R)
  const rc = PJ.standRead(pr.dir, pr.key, { holder: 'A' })[0]; PJ.standWrite(pr.dir, pr.key, 'A', { ...rc, at: Date.now() - TS.TEMPSTAND.ownMs + 60_000 })
  await visit(R, pr, body(srv))
  assert.strictEqual(srv.read(...dirt[0].split(',').map(Number)).name, 'air', 'inside ownMs: taken down')
})
await t('r1: a veto that cannot be read (it throws) digs nothing and gives nothing away: the receipt waits', async () => {
  const { srv, pr, dirt } = await receiptFirst(R)
  const e3 = body(srv); await visit(R, pr, e3, { stand: { mayPlace: () => { throw new Error('unread') }, mem: {} } })
  assert.strictEqual(srv.read(...dirt[0].split(',').map(Number)).name, 'dirt')
  assert.deepStrictEqual(PJ.standRead(pr.dir, pr.key, { holder: 'A' })[0]?.cells.map(k), dirt, 'still on its receipt')
  assert.ok(!tsRows(e3).some(d => d.result === 'adopted'), JSON.stringify(tsRows(e3)))
  assert.strictEqual(PJ.standRead(pr.dir, pr.key, { holder: 'A' })[0].tries, 0, 'and it is no failed try')
})

// ---- review r1, Codex BLOCKER 3: the deadline bounds everything awaited on the stand ------------------------------------------------
/** A visit on a clock the test owns: `now` and every sleep move it, nothing waits in real time. */
const clocked = (srv, o = {}) => { const e = body(srv, 'A', o); e.clock = Date.now(); e.now = () => e.clock; e.sleep = async ms => { e.clock += ms }; return e }
const ROOF = () => ({ ...record(), cells: record().cells.map(c => ({ ...c, seg: 'roof-edge' })), segments: [{ seg: 'roof-edge', deps: [] }] })
const barrierCapped = async Mod => {
  // as reported: 50 s left, a roof-edge cell (a CLOSER: its click waits at the barrier) and another holder's outstanding intent
  const srv = server(), pr = project(ROOF(), ['A', 'B'])
  await visit(Mod, pr, clocked(srv))
  const e = clocked(srv)
  PJ.intentOpen(pr.dir, pr.key, 'B', { cell: [0, G + 9, 0], block: 'oak_planks', lease: 1, seq: 1, conn: 'B-c1', now: e.clock })
  const deadline = e.clock + 50_000
  let dugAt = null
  const dig0 = e.dig; e.dig = async (c, n) => { dugAt ??= e.clock; return dig0(c, n) }
  const r = await visit(Mod, pr, e, { opts: { deadline } })
  assert.strictEqual(everDirt(srv).length, 1, `the positive control: a stand was built (${JSON.stringify(tsRows(e))})`)
  assert.strictEqual(srv.read(...TOP).name, 'air', 'the positive control: the barrier never cleared, the cell was not laid')
  assert.ok(dugAt != null && dugAt <= deadline - TS.TEMPSTAND.tailMs + R.BARRIER_WAIT_MS / 10, `BARRIER-CAPPED: the take-down started ${dugAt == null ? 'never' : `${Math.round((dugAt - (deadline - 50_000)) / 1000)} s in`}, the visit had 50 s`)
  assert.ok(e.clock <= deadline, `and the whole visit ended inside its deadline (${Math.round((e.clock - deadline) / 1000)} s over)`)
  assert.deepStrictEqual(dirtIn(srv), [], 'the stand is down'); assert.deepStrictEqual(receipts(pr), [])
  assert.notStrictEqual(r.stop, 'aborted')
}
await t('r1: a click that would wait at the barrier past the stand\'s time returns in time; the stand is down inside the deadline', () => barrierCapped(R))
await t('r1: a walk to the base that eats the budget: nothing is placed (late after the walk)', async () => {
  const srv = server(), pr = project(record())
  await visit(R, pr, clocked(srv))
  const e = clocked(srv)
  const walk0 = e.walkTo; e.walkTo = async (...a) => { e.clock += 40_000; return walk0(...a) }
  await visit(R, pr, e, { opts: { deadline: e.clock + 50_000 } })
  assert.deepStrictEqual(tsRows(e).map(d => `${d.result} ${d.why ?? ''}`.trim()), ['plan', 'removed failed', 'failed late after the walk'], JSON.stringify(tsRows(e)))
  assert.deepStrictEqual(everDirt(srv), []); assert.deepStrictEqual(receipts(pr), [])
})
await t('r1: a rise that eats the budget: the next rise is not started, the half-built stand comes down (late on the pillar)', async () => {
  // a post FOUR high: its top cell needs a stand of two
  const P4 = [1, 2, 3, 4].map(i => [PX, G + i, PZ])
  const rec = { ...record(), cells: P4.map(at => ({ at, role: 'post', seg: 'A' })) }
  const srv = server(), pr = project(rec), mem = {}
  for (let i = 0; i < 2; i++) await visit(R, pr, clocked(srv), { stand: { mayPlace: () => true, mem } })
  assert.deepStrictEqual([srv.read(...P4[2]).name, srv.read(...P4[3]).name], ['oak_planks', 'air'], 'the positive control: three laid (the third from a stand of one), the fourth missed once')
  const e = clocked(srv)
  const rise0 = e.rise; e.rise = async (...a) => { e.clock += 40_000; return rise0(...a) }
  await visit(R, pr, e, { stand: { mayPlace: () => true, mem }, opts: { deadline: e.clock + 50_000 } })
  const rows = tsRows(e)
  assert.strictEqual(rows[0].n, 2, `a stand of two was planned (${JSON.stringify(rows)})`)
  assert.deepStrictEqual(rows.slice(1).map(d => `${d.result} ${d.why ?? ''}`.trim()), ['removed failed', 'failed late on the pillar'], JSON.stringify(rows))
  assert.strictEqual(everDirt(srv).length, 1, 'one block was placed, the second never'); assert.deepStrictEqual(dirtIn(srv), []); assert.deepStrictEqual(receipts(pr), [])
})

// ---- review r1, Claude's note b: the reserve comes back, or the row says so ---------------------------------------------------------
await t('r1: a stone stand only with a pickaxe in the bag (dirt first; by hand a stone block is ten seconds and drops nothing)', async () => {
  const inv = () => ({ oak_planks: 16, cobblestone: 8 })
  const a = await twoVisits(R, { inv: inv() })
  assert.deepStrictEqual(tsRows(a.e2).map(d => `${d.result} ${d.why}`), ['refused no_pickaxe'], 'no pickaxe: no stone stand'); assert.strictEqual(a.r2.stop, 'cell_deferred')
  assert.deepStrictEqual([...a.srv.placedAt.keys()].filter(c => !POST.some(q => k(q) === c)), [])
  const srv = server(), pr = project(record())
  const mk = () => { const e = body(srv, 'A', { inv: inv() }); e.pickaxe = () => true; e.seq = []; const tool0 = e.tool; e.tool = async () => { e.seq.push('tool'); return tool0() }; const d0 = e.dig; e.dig = async (c, n) => { e.seq.push(`dig ${n}`); return d0(c, n) }; return e }
  await visit(R, pr, mk())
  const e = mk(); const r = await visit(R, pr, e)
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${JSON.stringify(tsRows(e))}`)
  assert.strictEqual(tsRows(e)[0].block, 'cobblestone'); assert.deepStrictEqual(e.seq, ['tool', 'dig cobblestone'], 'the pickaxe in hand before the dig')
  // and dirt is taken first when the bag holds both
  const b = await twoVisits(R, { inv: { oak_planks: 16, cobblestone: 8, dirt: 1 } })
  assert.strictEqual(tsRows(b.e2)[0].block, 'dirt')
})
await t('r1: the stand\'s block is counted back: recovered -> no note; not recovered -> the outcome row says unrecovered=N', async () => {
  const ok = await twoVisits(R)
  assert.strictEqual(tsRows(ok.e2).at(-1).why, undefined, 'the positive control: the block came back, the row carries no note')
  assert.strictEqual(ok.e2.inv.dirt, 8)
  const srv = server(), pr = project(record())
  await visit(R, pr, body(srv, 'A', { pickup: false }))
  const e = body(srv, 'A', { pickup: false }); const r = await visit(R, pr, e)
  assert.strictEqual(r.stop, 'complete')
  assert.deepStrictEqual([tsRows(e).at(-1).result, tsRows(e).at(-1).why], ['done', 'unrecovered=1'], JSON.stringify(tsRows(e)))
  assert.ok(e.walks.some(w => k(w) === tsRows(e)[0].to), 'the base was walked to once for it')
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
  assert.ok(!otherCells.has(placed[0]), `OTHER-RECORD: never in another record's cell (${placed[0]})`)
  assert.ok(!own.some(o => k(o.at) === placed[0]), 'never in this record\'s own cell')
  if (Mod === R) assert.deepStrictEqual(dirtIn(srv), [])
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

// ---- 5. mutants (each anchor present and unique: helpers/buildfake.mjs withMutant; each dies on the assertion it NAMES) --------------
await t('MUTANT: a stand on the first miss dies on NO-FIRST-MISS', () =>
  kills('    const due = new Set(TS.standDue(standCounts, cand.map(c => kOf(c.at))))', '    const due = new Set(cand.map(c => kOf(c.at)))', firstMiss, 'NO-FIRST-MISS'))
await t('MUTANT: a stand that is never taken down dies on WORLD-EQUAL', () =>
  kills("    const d = await standDown(rc, held, 'done')\n", "    const d = { removed: 0, left: 0, walked: 0 }\n", secondVisit, 'WORLD-EQUAL'))
await t('MUTANT: a stand placed with no receipt dies on RECEIPT-FIRST', () =>
  kills("    if (!PJ.standWrite(dir, key, me, rc, { now: now() })) { tsRow({ seg, cell: target.at, result: 'refused', why: 'receipt_unwritten' }); res.result = 'refused'; return res }\n", '', receiptFirst, 'RECEIPT-FIRST'))
await t('MUTANT: a leftover stand that is not taken down first dies on LEFTOVER-FIRST', () =>
  kills("      const d = await standDown(rc, null, 'leftover')\n", '      const d = { removed: 0, left: 0, walked: 0 }\n', M => nextVisitRemoves(M, 'off'), 'LEFTOVER-FIRST'))
await t('MUTANT: the caller\'s veto ignored at the plan and the placement dies on OTHER-RECORD', () =>
  kills('    const mayPlace = tstand.mayPlace ?? (() => true)\n', '    const mayPlace = () => true\n', vetoed, 'OTHER-RECORD'))
// (r1, Codex BLOCKER 4) THE PLANNER'S DEFENCE AND THE RUNTIME'S, EACH ON ITS OWN ASSERTION. The record's later segment stands in EVERY
// column within 1 of the post. The planner: the PLAN row's base is never one of them (read off the plan row, before any placement).
const planNotOwn = async Mod => {
  const own = NEAR.map(([x, z]) => ({ at: [x, G + 1, z], role: 'rail', seg: 'B' }))
  const srv = server(), pr = project(record(own))
  await visit(Mod, pr, body(srv))
  const e = body(srv); await visit(Mod, pr, e)
  const plan = tsRows(e).find(d => d.result === 'plan')
  assert.ok(plan, `the positive control: a stand was planned (${JSON.stringify(tsRows(e))})`)
  assert.ok(!own.some(o => k(o.at) === plan.to), `PLAN-NOT-OWN: the plan's base is never this record's own cell (${plan.to})`)
}
await t('the planner keeps the record\'s own cells out of the plan (the plan row\'s base)', () => planNotOwn(R))
await t('MUTANT: the planner without `taken` dies on PLAN-NOT-OWN', () =>
  kills('        pl = TS.planTempStand({ read: rd, home, cell: c.at, want: wantOf(c), nodes, domain, min: h, max: h, block: b, mayPlace, taken: at => standTaken.has(kOf(at)) })', '        pl = TS.planTempStand({ read: rd, home, cell: c.at, want: wantOf(c), nodes, domain, min: h, max: h, block: b, mayPlace })', planNotOwn, 'PLAN-NOT-OWN'))
// The runtime: a column the plan was allowed and that is taken DURING the walk to the base is never placed into.
const runtimeVeto = async Mod => {
  const srv = server(), pr = project(record())
  await visit(Mod, pr, body(srv))
  const e = body(srv)
  let walked = false
  const walk0 = e.walkTo; e.walkTo = async (...a) => { walked = true; return walk0(...a) }
  const r = await visit(Mod, pr, e, { stand: { mayPlace: () => !walked, mem: {} } })
  assert.ok(tsRows(e).some(d => d.result === 'plan'), `the positive control: the plan passed (${JSON.stringify(tsRows(e))})`)
  assert.deepStrictEqual(everDirt(srv), [], 'RUNTIME-VETO: a cell vetoed after the plan is never placed into')
  assert.ok(tsRows(e).some(d => d.result === 'failed' && /vetoed$/.test(d.why)), JSON.stringify(tsRows(e)))
  assert.strictEqual(r.stop, 'cell_deferred'); assert.deepStrictEqual(receipts(pr), [])
}
await t('the placement asks the veto again: a cell taken after the plan is never placed into', () => runtimeVeto(R))
await t('MUTANT: the placement without its own veto dies on RUNTIME-VETO', () =>
  kills('      try { may = !standTaken.has(kOf(at)) && !!mayPlace(at) } catch { may = false }\n', '      may = true\n', runtimeVeto, 'RUNTIME-VETO'))
await t('MUTANT: a stand\'s progress still stamped stalled dies on NOT-STAMPED', () =>
  kills('    const stalled = atEnd && !standWorked && segmentsOf(record)', '    const stalled = atEnd && segmentsOf(record)', progress, 'NOT-STAMPED'))
await t('MUTANT: a stand\'s progress still stopping stuck_on_cell dies on NOT-STUCK-STOP', () =>
  kills("      if (standWorked) return { stop: 'cell_deferred',", "      if (false) return { stop: 'cell_deferred',", progress, 'NOT-STUCK-STOP'))
await t('MUTANT (r1): a new stand over an open receipt dies on RECEIPT-OPEN', () =>
  kills('    if (openRc.length) { standUsed = true;', '    if (false) { standUsed = true;', receiptOpen, 'RECEIPT-OPEN'))
const OWNER = "  const standOwner = at => { try { return standTakenSet().has(kOf(at)) || !(tstand.mayPlace ?? (() => true))(at) ? 'owned' : 'mine' } catch { return 'unknown' } }\n"
await t('MUTANT (r1): a take-down that asks nobody dies on ADOPTED (from the walk)', () => kills(OWNER, "  const standOwner = () => 'mine'\n", M => adopted(M, 'off'), 'ADOPTED'))
await t('MUTANT (r1): a take-down that asks nobody dies on ADOPTED (under the feet)', () => kills(OWNER, "  const standOwner = () => 'mine'\n", M => adopted(M, 'on'), 'ADOPTED'))
await t('MUTANT (r1): no second ask after the walk dies on ADOPTED-AT-DIG', () =>
  kills("          const v = await digNamed(at, rc.block, heldFn, null, () => standOwner(at) === 'mine')\n", '          const v = await digNamed(at, rc.block, heldFn, null, null)\n', adoptedAtDig, 'ADOPTED-AT-DIG'))
await t('MUTANT (r1): the barrier wait uncapped on a stand dies on BARRIER-CAPPED', () =>
  kills('      const until = now() + Math.min(barrierWaitMs, Number.isFinite(waitMs) ? Math.max(0, waitMs) : Infinity)\n', '      const until = now() + barrierWaitMs\n', barrierCapped, 'BARRIER-CAPPED'))
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
