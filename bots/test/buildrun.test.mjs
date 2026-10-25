// SHOP-01 STAGE B, ONE BUILD VISIT (bots/src/buildrun.mjs) and the acknowledgement tracker (bots/src/buildack.mjs), on a FAKE
// SERVER: `send` puts the held block into the clicked face's cell and acknowledges the sequence after a delay (or refuses, or
// stays silent); digs clear. The workshop is built end to end from the siting planner's own record on flat ground; two
// builders run interleaved and never place a cell twice; a lost lease stops at the fence; a silent click keeps its intent open
// and another builder's closer waits for it until the sender retires; a replant comes before its tree; no material stops.
// The fakes are test/helpers/buildfake.mjs; the r2 scenarios are buildrun-r2.test.mjs (one file each keeps both inside the
// runner's per-file timeout).
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
const { B, R, PJ, both, G, HOME, k3, server, KIT, bot, BP, SITE, project, allDone } = await import('./helpers/buildfake.mjs')
const { AckTracker, installAckTracker } = await import('../src/buildack.mjs')
const { EventEmitter } = await import('node:events')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}

console.log('THE ACK TRACKER')
await t('next() is above every sequence written; an ack at or above wakes the waiter; below does not; a timeout returns timeout', async () => {
  const tr = new AckTracker()
  tr.sent(7)                                  // mineflayer's own use_item counter reached 7
  const s = tr.next()
  assert.strictEqual(s, 8)
  const w = tr.wait(s, 200)
  tr.ack(7)
  assert.strictEqual(await Promise.race([w, new Promise(r => setTimeout(() => r('pending'), 30))]), 'pending', 'ack 7 does not settle 8')
  tr.ack(9)
  assert.strictEqual(await w, 'acked')
  assert.strictEqual(await tr.wait(10, 20), 'timeout')
})

console.log('ONE BUILDER, END TO END')
await t('the workshop from its record on flat ground: complete, 167 placements, every cell once, one _build row each', async () => {
  const srv = server(), { p } = project()
  const e = bot(srv, 'A')
  const r = await R.runVisit(p('A'), e, { maxSteps: 2000 })
  assert.strictEqual(r.stop, 'complete', JSON.stringify(r))
  assert.strictEqual(r.placed, 167); assert.ok(allDone(srv))
  assert.ok([...srv.placedAt.values()].every(n => n === 1))
  assert.strictEqual(e.logs.filter(([k, d]) => k === '_build' && d.op === 'place').length, 167)
})
await t('BOTTOM-UP per column: no cell is placed while a lower cell of its segment, same column, is open', async () => {
  const srv = server(), { p } = project()
  const e = bot(srv, 'A')
  await R.runVisit(p('A'), e, { maxSteps: 2000 })
  const order = e.logs.filter(([k, d]) => k === '_build' && d.op === 'place').map(([, d]) => d)
  const seen = new Set()
  for (const d of order) {
    const lower = SITE.record.cells.filter(c => c.seg === d.seg && c.at[0] === d.cell[0] && c.at[2] === d.cell[2] && c.at[1] < d.cell[1])
    for (const c of lower) assert.ok(seen.has(k3(c.at)), `${d.seg} ${d.cell} placed before ${c.at}`)
    seen.add(k3(d.cell))
  }
})
await t('no material: without stone bricks the visit stops no_material at the pad and places nothing', async () => {
  const srv = server(), { p } = project()
  const inv = KIT(); delete inv.stone_bricks
  const r = await R.runVisit(p('A'), bot(srv, 'A', { inv }), { maxSteps: 50 })
  assert.strictEqual(r.stop, 'no_material'); assert.strictEqual(r.placed, 0)
})
await t('A REFUSED click is an attempt, not a placement: twice on one cell and that cell is left (attempts_spent), never counted placed', async () => {
  const srv = server(), { p } = project()
  const bad = SITE.record.cells.find(c => c.seg === 'pad').at
  const e = bot(srv, 'A', { ack: target => (k3(target) === k3(bad) ? 'refuse' : 'ok') })
  const r = await R.runVisit(p('A'), e, { maxSteps: 2000 })
  assert.ok(r.refused >= 2); assert.ok(!R.cellDone(srv.read(...bad), BP.palette, 'base'))
  assert.notStrictEqual(r.stop, 'complete')
})

console.log('THE FENCE AND THE BARRIER')
await t('A LOST SLOT LEASE mid-visit: the next click stops at the fence (fence:slot); nothing is placed after it', async () => {
  const srv = server(), { p, dir, key, slots } = project()
  const e = bot(srv, 'A')
  const log = e.log
  e.log = (k, d) => { log(k, d); if (k === '_build' && e.logs.length === 20) fs.writeFileSync(path.join(dir, `${key}.slot${slots.A.slot}.lease.g${slots.A.gen}.json.released`), 'x') }
  const r = await R.runVisit(p('A'), e, { maxSteps: 2000 })
  assert.strictEqual(r.stop, 'fence:slot'); assert.strictEqual(r.placed, 20)
})
await t('TWO BUILDERS interleaved: every cell placed exactly once, the workshop complete, both admitted (two slots)', async () => {
  const srv = server(), { p } = project(SITE.record, ['A', 'B'])
  let fa = [2, G + 1, 0], fb = [0, G + 1, 2]
  const a = bot(srv, 'A', { others: () => [fb] }), b = bot(srv, 'B', { feet: fb, others: () => [fa] })
  const wa = a.walkTo, wb = b.walkTo
  a.walkTo = async s => { fa = s.slice(); return wa(s) }; b.walkTo = async s => { fb = s.slice(); return wb(s) }
  for (let round = 0; round < 6 && !allDone(srv); round++) await Promise.all([R.runVisit(p('A'), a, { maxSteps: 2000, barrierWaitMs: 2000 }), R.runVisit(p('B'), b, { maxSteps: 2000, barrierWaitMs: 2000 })])
  assert.ok(allDone(srv), 'complete')
  assert.ok([...srv.placedAt.values()].every(n => n === 1), 'never twice')
  const byA = a.logs.filter(([k, d]) => k === '_build' && d.op === 'place').length, byB = b.logs.filter(([k, d]) => k === '_build' && d.op === 'place').length
  assert.strictEqual(byA + byB, 167)
})
await t('A SILENT CLICK keeps its intent OPEN; another builder\'s closer waits for it (barrier_wait) until the sender RETIRES', async () => {
  const srv = server(), { p, dir, key } = project(SITE.record, ['A', 'B'])
  // A builds everything below the roof; then A's first roof click goes silent (no ack ever)
  const a = bot(srv, 'A', { ack: (target) => (target[1] === SITE.record.s + 3 ? 'silent' : 'ok'), capWait: 20 })
  await R.runVisit(p('A'), a, { maxSteps: 400, barrierWaitMs: 50 })
  const open = PJ.openIntents(dir, key).filter(i => i.holder === 'A')
  assert.ok(open.length >= 1, 'A\'s silent click is an open intent')
  // B now tries the roof: its closer waits for A's open intent and gives up this visit
  const b = bot(srv, 'B')
  const r1 = await R.runVisit(p('B'), b, { maxSteps: 60, barrierWaitMs: 50 })
  assert.strictEqual(r1.placed, 0, `B placed nothing while A's intent is open (${r1.stop})`)
  // A RETIRES (it reconnected: its presence, newer than the intent, names another connection): B's closers go
  PJ.presenceWrite(dir, key, 'A', { conn: 'A-c9' })
  const r2 = await R.runVisit(p('B'), bot(srv, 'B'), { maxSteps: 2000, barrierWaitMs: 50 })
  assert.ok(r2.placed > 0, JSON.stringify(r2))
})

console.log('REPLANT BEFORE THE TREE')
await t('a tree in the clear list: without its sapling the visit stops no_sapling and the tree stands; with it, the sapling first, then the log', async () => {
  const log = B.footprint(BP, { x: SITE.record.anchor[0], z: SITE.record.anchor[1] }, SITE.record.orient).pad[30]
  const at = [log[0], G + 1, log[1]]
  const rp = { cell: [SITE.record.box[2] + 10, G + 1, SITE.record.box[1]], species: 'oak', sapling: 'oak_sapling', state: 'pending' }
  const record = { ...SITE.record, clear: [{ at, kind: 'tree', name: 'oak_log' }], replant: [rp] }
  const srv = server({ [k3(at)]: 'oak_log' }), { p } = project(record)
  const inv = KIT(); delete inv.oak_sapling
  // C1: the other work goes on around the tree; the pad cell under the trunk waits, and the visit says why
  const r = await R.runVisit(p('A'), bot(srv, 'A', { inv }), { maxSteps: 2000 })
  assert.strictEqual(r.stop, 'no_sapling'); assert.strictEqual(srv.read(...at).name, 'oak_log')
  const e = bot(srv, 'A')
  const r2 = await R.runVisit(p('A'), e, { maxSteps: 2000 })
  const ops = e.logs.filter(([k]) => k === '_build').map(([, d]) => d.op)
  assert.strictEqual(ops[0], 'replant'); assert.strictEqual(ops[1], 'clear')
  assert.strictEqual(srv.read(...rp.cell).name, 'oak_sapling'); assert.strictEqual(srv.read(...at).name !== 'oak_log', true)
  assert.strictEqual(r2.stop, 'complete')
})

/** A clear entry naming a log at a PAD cell the world already shows built (stone bricks): the pad done, the rest open. */
function builtOverClear () {
  const padCell = SITE.record.cells.find(c => c.seg === 'pad').at
  const cells = Object.fromEntries(SITE.record.cells.filter(c => c.seg === 'pad').map(c => [k3(c.at), 'stone_bricks']))
  return { padCell, cells, record: { ...SITE.record, clear: [{ at: padCell, kind: 'tree', name: 'oak_log' }], replant: [] } }
}
await t('A CLEAR NEVER DIGS A BUILT CELL (found in stage B: the pad laid over a felled trunk\'s cell was dug again)', async () => {
  const b = builtOverClear(), srv = server(b.cells), { p } = project(b.record)
  const r = await R.runVisit(p('A'), bot(srv, 'A'), { maxSteps: 2000 })
  assert.strictEqual(srv.read(...b.padCell).name, 'stone_bricks'); assert.strictEqual(r.cleared, 0); assert.strictEqual(r.stop, 'complete')
})
console.log('PURE PIECES')
await t('blockFor: the palette\'s first choice held, else its fallback; $planks is any planks species carried', () => {
  const has = n => ['birch_planks', 'glass_pane'].includes(n); has.planks = () => 'birch_planks'
  assert.strictEqual(R.blockFor(BP.palette, 'wall', has), 'birch_planks')
  assert.strictEqual(R.blockFor(BP.palette, 'trim', has), 'birch_planks', 'no cut copper: the planks fallback')
  assert.strictEqual(R.blockFor(BP.palette, 'window', has), 'glass_pane')
  assert.strictEqual(R.blockFor(BP.palette, 'base', has), null)
})
await t('cellDone: any planks for $planks; the fallback counts; air never', () => {
  assert.ok(R.cellDone({ name: 'spruce_planks', boundingBox: 'block' }, BP.palette, 'wall'))
  assert.ok(R.cellDone({ name: 'oak_planks', boundingBox: 'block' }, BP.palette, 'trim'))
  assert.ok(!R.cellDone({ name: 'air', boundingBox: 'empty' }, BP.palette, 'base'))
  assert.ok(!R.cellDone({ name: 'dirt', boundingBox: 'block' }, BP.palette, 'base'))
})
await t('concurrentOk: two walls do not share a cell or stand? the pad and the ring do (never concurrent)', () => {
  assert.strictEqual(R.concurrentOk(SITE.record, 'pad', 'ring'), false)
  assert.strictEqual(R.concurrentOk(SITE.record, 'pad', 'pad'), false)
})

console.log('MUTANTS (anchored, unique; both ways)')
await t('MUTANT the fence skipped before the send', () => both('if (why) { cancel(); return `fence:${why}` }', '', async M => {
  const srv = server(), { p, dir, key, slots } = project()
  const e = bot(srv, 'A')
  const log = e.log
  e.log = (k, d) => { log(k, d); if (k === '_build' && e.logs.length === 5) fs.writeFileSync(path.join(dir, `${key}.slot${slots.A.slot}.lease.g${slots.A.gen}.json.released`), 'x') }
  const r = await M.runVisit(p('A'), e, { maxSteps: 2000 })
  assert.strictEqual(r.placed, 5)
}))
/** A record with an EARTH segment: a 3-deep hole under one pad column, filled from below (the terrain gives every level a side support). */
function holeRecord () {
  const col = B.footprint(BP, { x: SITE.record.anchor[0], z: SITE.record.anchor[1] }, SITE.record.orient).pad[30]
  const fill = [G - 2, G - 1, G].map(y => [col[0], y, col[1]])
  const record = { ...SITE.record, cells: [...fill.map(at => ({ at, role: 'fill', seg: 'earth' })), ...SITE.record.cells],
    segments: [{ seg: 'earth', deps: [] }, ...SITE.record.segments.map(s => (s.seg === 'pad' ? { ...s, deps: ['earth'] } : s))] }
  return { record, cells: Object.fromEntries(fill.map(a => [k3(a), 'air'])) }
}
await t('BOTTOM-UP in a filled hole (side supports at every level): the fill goes in from the bottom', async () => {
  const h = holeRecord(), srv = server(h.cells), { p } = project(h.record)
  const e = bot(srv, 'A')
  const r = await R.runVisit(p('A'), e, { maxSteps: 2000 })
  assert.strictEqual(r.stop, 'complete', JSON.stringify(r))
  const fills = e.logs.filter(([k, d]) => k === '_build' && d.seg === 'earth').map(([, d]) => d.cell[1])
  assert.deepStrictEqual(fills, [G - 2, G - 1, G])
})
await t('MUTANT the bottom-up rule dropped (the top of the hole first)', () => both('&& !below(c) && isClear(c.at))\n          .sort((a, b) => a.at[1] - b.at[1] ||', '&& isClear(c.at))\n          .sort((a, b) => b.at[1] - a.at[1] ||', async M => {
  const h = holeRecord(), srv = server(h.cells), { p } = project(h.record)
  const e = bot(srv, 'A')
  await M.runVisit(p('A'), e, { maxSteps: 2000 })
  const order = e.logs.filter(([k, d]) => k === '_build' && d.op === 'place').map(([, d]) => d)
  const seen = new Set()
  for (const d of order) {
    for (const c of h.record.cells.filter(c => c.seg === d.seg && c.at[0] === d.cell[0] && c.at[2] === d.cell[2] && c.at[1] < d.cell[1])) assert.ok(seen.has(k3(c.at)))
    seen.add(k3(d.cell))
  }
}))
await t('MUTANT the replant-first rule dropped (a tree felled before its sapling)', () => both("if (c.kind === 'tree' && !replanted()) { needSapling ??= 'a sapling'; continue }", '', async M => {
  const log = B.footprint(BP, { x: SITE.record.anchor[0], z: SITE.record.anchor[1] }, SITE.record.orient).pad[30]
  const at = [log[0], G + 1, log[1]]
  const record = { ...SITE.record, clear: [{ at, kind: 'tree', name: 'oak_log' }], replant: [{ cell: [SITE.record.box[2] + 10, G + 1, SITE.record.box[1]], species: 'oak', sapling: 'oak_sapling', state: 'pending' }] }
  const srv = server({ [k3(at)]: 'oak_log' }), { p } = project(record)
  const inv = KIT(); delete inv.oak_sapling
  await M.runVisit(p('A'), bot(srv, 'A', { inv }), { maxSteps: 50 })
  assert.strictEqual(srv.read(...at).name, 'oak_log')
}))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
