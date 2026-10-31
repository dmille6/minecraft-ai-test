// PATHSCLOSE-01 (LIVE showcase 10-30: the paths at 261/263 all day, 304 of 307 visits since 12Z `clears_wait`, nothing done): two
// path cells had dirt / grass SET ON THEM after siting (19,67,16: one grass_block; 20,69,24: dirt + grass_block), a shovel converts
// only with air above, and the visit dug a LISTED plant only -- so the cells waited every visit for good. The scenes, on the fake
// server (test/helpers/buildfake.mjs): the overburden dug highest first and the leg completes (killed by a mutant that skips the
// dig); without the dig the waiting cell is DEFERRED and counted to stuck_on_cell -- never `clears_wait` every visit (killed by a
// mutant that drops the deferral); a block the visit may not dig (a chest, a vetoed cell) is never dug and is named HARD, and the
// waiver (paths.mjs pathWaiveDue) takes it only after PATH_WAIVE_AFTER counted visits; overburdenAbove's refusals, pure.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { R, PJ, G, HOME, server, bot, withMutant } = await import('./helpers/buildfake.mjs')
const P = await import('../src/paths.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const CORE = [-6, -6, 6, 6]
const SHOVEL = 'iron_shovel'
const siteOn = (srv, cols = [[1, 25]]) => {
  const grid = P.pathGrid((x, z) => P.pathColumn(srv.read, x, z, { yHi: G + 12, yLo: G - 12 }), () => null, [-40, -40, 40, 40], srv.read)
  return P.pathRecord(P.pathNetwork(grid, { hub: CORE, dests: [{ id: 'd', cols }] }), grid, srv.read, { home: HOME })
}
function pbot (srv, name) {
  const inv = { cobblestone: 64, [SHOVEL]: 1 }
  const e = bot(srv, name, { inv, feet: [2, G + 1, 7] })
  let held = 'cobblestone'
  e.hold = async n => { if (!e.has(n)) return false; held = n; return true }
  e.self = () => { const f = e.feet(); return { x: f[0] + 0.5, y: f[1], z: f[2] + 0.5, w: 0.6, h: 1.8 } }
  e.send = (support, face, seq) => {
    setImmediate(() => {
      const b = srv.read(...support), up = srv.read(support[0], support[1] + 1, support[2])
      if (/_shovel$/.test(held)) {
        if (face[1] === 1 && P.FLATTENABLE.test(b?.name ?? '') && up?.name === 'air') srv.set(support, 'dirt_path')
      } else {
        const target = support.map((v, i) => v + face[i]), tb = srv.read(...target)
        if (tb && tb.name === 'air' && (inv[held] ?? 0) > 0) { srv.set(target, held); inv[held]--; srv.placedAt.set(target.join(','), 1) }
      }
      e.tracker.ack(seq)
    })
  }
  const use = {
    block: 'dirt_path',
    can: b => P.FLATTENABLE.test(b?.name ?? ''),
    want: b => b?.name === 'dirt_path',
    held: () => /_shovel$/.test(held),
    hold: async () => { held = SHOVEL; return true },
  }
  return { e, use }
}
function project (record) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathsclose-'))
  const key = PJ.projKey(HOME, P.PATHS_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slots = {}
  const p = (n, use, extra = {}) => {
    slots[n] ??= PJ.takeSlot(dir, key, n, P.PATHS_BUILDERS)
    return { dir, key, me: n, home: HOME, stood: [], record, recordGen: pub.gen, palette: P.PATH_PALETTE, slot: slots[n].slot, slotGen: slots[n].gen,
      domain: () => true, walkR: P.pathWalkR(record, HOME), foreign: P.PATH_FOREIGN, blockLayer: false, use, stands: { pending: null, bans: {} }, ...extra }
  }
  return { dir, key, p }
}
const done = (srv, rec) => rec.cells.every(c => R.cellDone(srv.read(...c.at), P.PATH_PALETTE, c.role))
const up = (at, n = 1) => [at[0], at[1] + n, at[2]]
/** The live shape: two path cells, one under a grass_block, one under dirt + grass_block (set after siting). */
function scene () {
  const srv = server()
  const rec = siteOn(srv)
  const paths = rec.cells.filter(c => c.role === 'path')
  const a = paths.find(c => c.at[2] === 12), b = paths.find(c => c.at[2] === 18)
  srv.set(up(a.at), 'grass_block')
  srv.set(up(b.at), 'dirt'); srv.set(up(b.at, 2), 'grass_block')
  return { srv, rec, a, b }
}

console.log('THE OVERBURDEN (runVisit on the fake server)')
const overburdenScene = async RM => {
  const { srv, rec, a, b } = scene()
  const { p } = project(rec)
  const pb = pbot(srv, 'A')
  let last = null
  for (let v = 0; v < 12 && !done(srv, rec); v++) last = await RM.runVisit(p('A', pb.use, { overburden: { mayDig: () => true } }), pb.e, { maxSteps: 400 })
  assert.ok(done(srv, rec), `complete (${last?.stop}: ${last?.why})`)
  assert.strictEqual(srv.read(...a.at).name, 'dirt_path'); assert.strictEqual(srv.read(...b.at).name, 'dirt_path')
  const ob = pb.e.logs.filter(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'overburden').map(([, d]) => d)
  assert.deepStrictEqual(ob.map(d => d.cell.join(',')).sort(), [up(a.at), up(b.at), up(b.at, 2)].map(x => x.join(',')).sort(), 'exactly the three blocks set on the two cells')
  const iB2 = ob.findIndex(d => d.cell.join(',') === up(b.at, 2).join(',')), iB1 = ob.findIndex(d => d.cell.join(',') === up(b.at).join(','))
  assert.ok(iB2 < iB1, 'highest first')
  return last
}
await t('the blocks SET ON two path cells (grass; dirt + grass) are dug, highest first, and the leg COMPLETES -- killed with the dig skipped', async () => {
  const last = await overburdenScene(R)
  assert.strictEqual(last.stop, 'complete')
  let killed = false
  await withMutant('if (!p.overburden || listedNow(up)) { waitCells.push(c); continue }', 'if (true) { waitCells.push(c); continue }',
    async M => { try { await overburdenScene(M) } catch { killed = true } })
  assert.ok(killed, 'the mutant survived')
})
const deferScene = async RM => {
  const { srv, rec } = scene()
  const { p } = project(rec)
  const pb = pbot(srv, 'A')
  const stops = []
  for (let v = 0; v < 6; v++) stops.push((await RM.runVisit(p('A', pb.use), pb.e, { maxSteps: 400 })).stop)
  return stops
}
await t('WITHOUT the dig (PATHS_OVERBURDEN=off) the waiting cells are DEFERRED and counted: stuck_on_cell by the 3rd visit, never clears_wait -- killed with the deferral dropped', async () => {
  const stops = await deferScene(R)
  assert.ok(!stops.includes('clears_wait'), `no clears_wait (${stops})`)
  assert.strictEqual(stops[R.STUCK_VISITS - 1], 'stuck_on_cell', `the F4 count ends it (${stops})`)
  let killed = false
  await withMutant("const defer = [...noStand, ...waitCells.filter(c => e.read(c.at[0], c.at[1] + 1, c.at[2]))]", 'const defer = [...noStand]',
    async M => { try { const s = await deferScene(M); assert.ok(!s.includes('clears_wait')) } catch { killed = true } })
  assert.ok(killed, 'the mutant survived')
})
await t('A BLOCK THE VISIT MAY NOT DIG (a chest; a vetoed cell) is never dug, named HARD, deferred to stuck_on_cell; then waived only at PATH_WAIVE_AFTER counted visits', async () => {
  const { srv, rec, a, b } = scene()
  srv.set(up(a.at), 'chest')
  const { dir, key, p } = project(rec)
  const pb = pbot(srv, 'A')
  const veto = up(b.at, 2).join(',')
  const results = []
  for (let v = 0; v < 4; v++) results.push(await R.runVisit(p('A', pb.use, { overburden: { mayDig: at => at.join(',') !== veto } }), pb.e, { maxSteps: 400 }))
  assert.strictEqual(srv.read(...up(a.at)).name, 'chest', 'the chest stands')
  assert.strictEqual(srv.read(...up(b.at, 2)).name, 'grass_block', 'the vetoed block stands')
  assert.strictEqual(srv.read(...up(b.at)).name, 'dirt', 'and nothing under it was dug (the column is refused whole)')
  const bl = results[0].blocked ?? []
  assert.ok(bl.some(x => x.at.join(',') === a.at.join(',') && x.hard && /^kept chest/.test(x.why)), JSON.stringify(bl))
  assert.ok(bl.some(x => x.at.join(',') === b.at.join(',') && x.hard && /^vetoed/.test(x.why)), JSON.stringify(bl))
  assert.ok(results.some(r => r.stop === 'stuck_on_cell'), results.map(r => r.stop).join(','))
  // the waiver: counted visits from the stuck map (summed), only HARD refusals, only path cells
  const counts = PJ.stuckRead(dir, key)
  assert.ok((counts[a.at.join(',')]?.visits ?? 0) >= P.PATH_WAIVE_AFTER, JSON.stringify(counts))
  const due = P.pathWaiveDue(rec, bl, counts)
  assert.deepStrictEqual(due.map(d => d.k).sort(), [a.at.join(','), b.at.join(',')].sort())
  assert.deepStrictEqual(P.pathWaiveDue(rec, bl, {}), [], 'no count: nothing waived')
  assert.deepStrictEqual(P.pathWaiveDue(rec, bl.map(x => ({ ...x, hard: false })), counts), [], 'a soft refusal is never waived')
  // waived, the visit reads the cells done and completes
  const w = { ...rec, waived: Object.fromEntries(due.map(d => [d.k, { why: d.why }])) }
  const r = await R.runVisit({ ...p('A', pb.use, { overburden: { mayDig: at => at.join(',') !== veto }, alsoDone: q => P.pathWaived(w, q) }), record: w }, pb.e, { maxSteps: 400 })
  assert.strictEqual(r.stop, 'complete', `${r.stop}: ${r.why}`)
})
const unknownScene = async RM => {
  const { srv, rec, a, b } = scene()
  const { p } = project(rec)
  // the server lands the dig but never answers it (the first time): the cell above goes UNKNOWN for the connection
  let silent = 1
  const pb = pbot(srv, 'A')
  pb.e.dig = async (at, expect) => { if (expect && srv.read(...at)?.name !== expect) return 'refused'; srv.set(at, 'air'); return silent-- > 0 ? 'unconfirmed' : 'confirmed' }
  pb.e.probe = async () => null   // no answer at the dig either
  const unknown = new Set()
  let first = null
  for (let v = 0; v < 8 && !done(srv, rec); v++) {
    if (v === 1) pb.e.probe = async at => srv.read(...at)?.name ?? null   // the server answers later visits
    const r = await RM.runVisit({ ...p('A', pb.use, { overburden: { mayDig: () => true } }), unknown }, pb.e, { maxSteps: 400 })
    first ??= r
  }
  assert.ok(first.unknown >= 1, 'the scene: an overburden dig left its cell unknown')
  assert.ok(done(srv, rec), 'the unknown cell was asked again and the leg completed')
}
await t('Codex r1: an UNCONFIRMED overburden dig (its cell unknown for the connection) is asked again and the leg completes -- killed with the re-ask removed', async () => {
  await unknownScene(R)
  let killed = false
  await withMutant('if (uq) { if ((await resolveUnknown(uq)) == null) bump(uq); acted = true; break }', 'if (false) { }',
    async M => { try { await unknownScene(M) } catch { killed = true } })
  assert.ok(killed, 'the mutant survived')
})
console.log('overburdenAbove (pure)')
await t('the column up to the first air; refusals: deep, a record cell, the clears\' own, a tree, a part, unread, vetoed', () => {
  const W = new Map()
  const read = (x, y, z) => { const n = W.get(`${x},${y},${z}`); return n === null ? null : { name: n ?? 'air', boundingBox: (n ?? 'air') === 'air' ? 'empty' : 'block' } }
  const at = [0, 70, 0]
  const set = (...ns) => { W.clear(); ns.forEach((n, i) => W.set(`0,${71 + i},0`, n)) }
  set('dirt', 'grass_block', 'short_grass')
  assert.deepStrictEqual(R.overburdenAbove(read, at).digs.map(d => d.name), ['short_grass', 'grass_block', 'dirt'])
  set('dirt', 'dirt', 'dirt', 'dirt'); assert.deepStrictEqual([R.overburdenAbove(read, at).ok, R.overburdenAbove(read, at).hard], [false, true])
  set('cobblestone'); assert.strictEqual(R.overburdenAbove(read, at, { isCell: p => p[1] === 71 }).why, 'record_cell 0,71,0')
  set('dirt'); assert.deepStrictEqual([R.overburdenAbove(read, at, { listed: p => p[1] === 71 }).hard, /^listed/.test(R.overburdenAbove(read, at, { listed: () => true }).why)], [false, true])
  set('oak_log'); assert.deepStrictEqual([R.overburdenAbove(read, at).ok, R.overburdenAbove(read, at).hard], [false, false])
  set('oak_planks'); assert.match(R.overburdenAbove(read, at).why, /^kept oak_planks/)
  set(null); assert.deepStrictEqual([R.overburdenAbove(read, at).ok, R.overburdenAbove(read, at).hard], [false, false])
  set('dirt'); assert.match(R.overburdenAbove(read, at, { mayDig: () => false }).why, /^vetoed/)
  set(); assert.deepStrictEqual(R.overburdenAbove(read, at), { ok: true, digs: [], why: null, hard: false })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
