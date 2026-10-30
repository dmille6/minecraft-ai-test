// PATHS-01: the paths LAID END TO END by buildrun.mjs runVisit's tool use (`p.use`) on the fake server (test/helpers/buildfake.mjs):
// a shovel's use turns grass and dirt into dirt_path (vanilla's rule: the top face, air above); a block held is placed into the
// clicked face's cell. The scenes: a leg over grass with a fern, a sand patch and a trench (one builder, visit after visit:
// complete); the TOOL CHECK at the send (a hand that is not the shovel is never sent -- killed by a mutant that drops it); the
// stuck cell no stand reaches is deferred, not a stop; and the shop read's view of the rows (every place and clear on the record).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { R, PJ, G, HOME, server, bot, withMutant, plan } = await import('./helpers/buildfake.mjs')
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
/** buildfake's bot with a HAND: a shovel's use converts the clicked top face (grass/dirt, air above) to dirt_path; any held block
 *  is placed into the clicked face's cell (vanilla). `slip` = the equip never takes (the hand keeps the cobblestone). */
function pbot (srv, name, { inv = { cobblestone: 64, [SHOVEL]: 1 }, slip = false } = {}) {
  const e = bot(srv, name, { inv, feet: [2, G + 1, 7] })
  let held = 'cobblestone'
  e.hold = async n => { if (!e.has(n)) return false; held = n; return true }
  e.self = () => { const f = e.feet(); return { x: f[0] + 0.5, y: f[1], z: f[2] + 0.5, w: 0.6, h: 1.8 } }
  e.sent = []
  e.send = (support, face, seq) => {
    e.sent.push({ support, face, held })
    setImmediate(() => {
      const b = srv.read(...support), up = srv.read(support[0], support[1] + 1, support[2])
      if (/_shovel$/.test(held)) {
        if (face[1] === 1 && P.FLATTENABLE.test(b?.name ?? '') && up?.name === 'air') srv.set(support, 'dirt_path')
      } else {
        const target = support.map((v, i) => v + face[i]), tb = srv.read(...target)
        if (tb && (tb.name === 'air' || tb.name === 'short_grass') && (inv[held] ?? 0) > 0) { srv.set(target, held); inv[held]--; srv.placedAt.set(target.join(','), (srv.placedAt.get(target.join(',')) ?? 0) + 1) }
      }
      e.tracker.ack(seq)
    })
  }
  const use = {
    block: 'dirt_path',
    can: b => P.FLATTENABLE.test(b?.name ?? ''),
    want: b => b?.name === 'dirt_path',
    held: () => /_shovel$/.test(held),
    hold: async () => { if (!(inv[SHOVEL] > 0)) return false; if (!slip) held = SHOVEL; return true },
  }
  return { e, use, hand: () => held }
}
function project (record, names = ['A']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-'))
  const key = PJ.projKey(HOME, P.PATHS_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slots = {}
  for (const n of names) slots[n] = PJ.takeSlot(dir, key, n, P.PATHS_BUILDERS)
  const p = (n, use) => ({ dir, key, me: n, home: HOME, stood: [], record, recordGen: pub.gen, palette: P.PATH_PALETTE, slot: slots[n].slot, slotGen: slots[n].gen,
    domain: () => true, walkR: P.pathWalkR(record, HOME), foreign: P.PATH_FOREIGN, blockLayer: false, use, stands: { pending: null, bans: {} } })
  return { dir, key, p }
}
const done = (srv, rec) => rec.cells.every(c => R.cellDone(srv.read(...c.at), P.PATH_PALETTE, c.role))

console.log('THE LEG (runVisit on the fake server)')
await t('ONE BUILDER lays a leg over grass, a fern, a sand patch and a trench, visit after visit: complete; no block ever above a path cell', async () => {
  const srv = server()
  srv.set([1, G + 1, 12], 'fern')
  for (const z of [15, 16]) for (const x of [0, 1, 2]) srv.set([x, G, z], 'sand')
  for (let x = -40; x <= 40; x++) { srv.set([x, G, 20], 'air'); srv.set([x, G - 1, 20], 'air') }
  const rec = siteOn(srv)
  assert.ok(rec.cells.some(c => c.role === 'fill'), 'the trench is in the record as fill')
  const { p } = project(rec)
  const b = pbot(srv, 'A')
  let last = null
  for (let v = 0; v < 12 && !done(srv, rec); v++) last = await R.runVisit(p('A', b.use), b.e, { maxSteps: 400 })
  assert.ok(done(srv, rec), `complete (${last?.stop}: ${last?.why})`)
  assert.strictEqual(last.stop, 'complete')
  const paths = rec.cells.filter(c => c.role === 'path')
  const dp = paths.filter(c => srv.read(...c.at).name === 'dirt_path').length
  assert.ok(dp >= paths.length - 12, `mostly dirt_path (${dp} of ${paths.length})`)
  assert.ok(paths.filter(c => c.at[2] === 15 || c.at[2] === 16).every(c => srv.read(...c.at).name === 'cobblestone' || srv.read(...c.at).name === 'dirt_path'), 'the sand paved')
  for (const c of paths) assert.strictEqual(srv.read(c.at[0], c.at[1] + 1, c.at[2]).name, 'air', `nothing above ${c.at}`)
  const uses = b.e.logs.filter(([k, d]) => k === '_build' && d.op === 'place' && d.kind === 'use')
  assert.ok(uses.length >= dp - 1 && uses.every(([, d]) => d.block === 'dirt_path'))
  assert.ok(b.e.sent.filter(s => s.face[1] === 1 && rec.cells.some(c => c.at.join(',') === s.support.join(','))).every(s => /_shovel$/.test(s.held)), 'every top-face click on a path cell held the shovel')
})
await t('THE TOOL CHECK AT THE SEND: an equip that does not take is never sent (no cobblestone set on the path) -- killed with the check removed', async () => {
  const scenario = async RM => {
    const srv = server()
    const rec = siteOn(srv)
    const { p } = project(rec)
    const b = pbot(srv, 'A', { slip: true })
    await RM.runVisit(p('A', b.use), b.e, { maxSteps: 120 })
    const cols = new Set(rec.cells.map(c => `${c.at[0]},${c.at[2]}`))
    const above = [...srv.placedAt.keys()].filter(k => { const [x, y, z] = k.split(',').map(Number); return cols.has(`${x},${z}`) && y === G + 1 })
    assert.deepStrictEqual(above, [], 'a block set on a path cell')
  }
  await scenario(R)
  let killed = false
  await withMutant("|| !AIR(nm(rd(c.at[0], c.at[1] + 1, c.at[2]))) || !p.use.held()) return 'refused'", "|| !AIR(nm(rd(c.at[0], c.at[1] + 1, c.at[2])))) return 'refused'",
    async M => { try { await scenario(M) } catch { killed = true } })
  assert.ok(killed, 'the mutant survived')
})
await t('NO TOOL: the visit stops `no_tool` (its remedy named by the caller), nothing placed on top', async () => {
  const srv = server()
  const rec = siteOn(srv)
  const { p } = project(rec)
  const b = pbot(srv, 'A', { inv: { cobblestone: 64 } })
  const r = await R.runVisit(p('A', b.use), b.e, { maxSteps: 60 })
  assert.strictEqual(r.stop, 'no_tool')
  assert.strictEqual(srv.placedAt.size, 0)
})
await t('A PLANT LISTED on a path cell is dug by the use pass (row on the record\'s clear list); an UNLISTED one is left (the cell waits)', async () => {
  const srv = server()
  const rec = siteOn(srv)
  const target = rec.cells.find(c => c.role === 'path' && c.at[2] === 12)
  // listed: a fern added to the record's clear list, as siting lists one
  srv.set([target.at[0], G + 1, target.at[2]], 'fern')
  const rec2 = { ...rec, clear: [] }
  rec2.clear = [{ at: [target.at[0], G + 1, target.at[2]], kind: 'plant', name: 'fern' }]
  // and one NOT listed (a sweet berry bush grown after siting)
  const other = rec.cells.find(c => c.role === 'path' && c.at[2] === 14)
  srv.set([other.at[0], G + 1, other.at[2]], 'sweet_berry_bush')
  const { p } = project(rec2)
  const b = pbot(srv, 'A')
  for (let v = 0; v < 6; v++) await R.runVisit({ ...p('A', b.use), record: rec2 }, b.e, { maxSteps: 400 })
  assert.strictEqual(srv.read(...target.at).name, 'dirt_path')
  assert.strictEqual(srv.read(other.at[0], G + 1, other.at[2]).name, 'sweet_berry_bush', 'never dug off the record')
  assert.notStrictEqual(srv.read(...other.at).name, 'dirt_path')
  const clears = b.e.logs.filter(([k, d]) => k === '_build' && d.op === 'clear').map(([, d]) => d)
  assert.ok(clears.every(d => rec2.clear.some(c => c.at.join(',') === d.cell.join(','))), 'every clear row on the record\'s clear list')
})
await t('THE SHOP READ\'S VIEW: every place row is a record cell, every clear row a clear-list cell (or a record cell for kind=foreign)', async () => {
  const srv = server()
  srv.set([1, G + 1, 12], 'fern')
  for (const z of [15, 16]) for (const x of [0, 1, 2]) srv.set([x, G, z], 'sand')
  srv.set([2, G + 1, 22], 'grass_block')
  const rec = siteOn(srv)
  const { p } = project(rec)
  const b = pbot(srv, 'A')
  for (let v = 0; v < 12 && !done(srv, rec); v++) await R.runVisit(p('A', b.use), b.e, { maxSteps: 400 })
  const cells = new Set(rec.cells.map(c => c.at.join(','))), clears = new Set(rec.clear.map(c => c.at.join(',')))
  const rows = b.e.logs.filter(([k]) => k === '_build').map(([, d]) => d)
  assert.ok(rows.some(d => d.op === 'place') && rows.some(d => d.op === 'clear'), 'both kinds seen')
  for (const d of rows) {
    if (d.op === 'place') assert.ok(cells.has(d.cell.join(',')), `off_record ${d.cell}`)
    if (d.op === 'clear') assert.ok(d.kind === 'foreign' ? cells.has(d.cell.join(',')) : clears.has(d.cell.join(',')), `clear_outside ${d.cell} ${d.kind}`)
    if (d.op === 'clear' && d.kind === 'tree') assert.match(String(d.saplings), /^\d+\/\d+$/)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
