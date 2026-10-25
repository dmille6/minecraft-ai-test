// SHOP-01 r2/r3, ONE BUILD VISIT on the fake server (test/helpers/buildfake.mjs), part 2 (the runner's 120 s per-file
// timeout): foreign blocks, the builder's own body, the slot reference.
// r2: each fake bot runs the REAL connection tracker (buildack.mjs installAckTracker) over a fake client, so a late
// acknowledgement settles through the same settler the bots use; a server that places wall_torch / exposed_cut_copper; a
// replacement placed during the dig walk; a dig the server never answers (ghost air) stays unknown; foreign blocks.
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

console.log('FOREIGN BLOCKS IN THE VOLUME (Claude r1 P3-9)')
const foreignUnknown = async M => {
  const pad = SITE.record.cells.filter(c => c.seg === 'pad')
  const srv = server({ [k3(pad[5].at)]: 'dirt' }), pr = project()
  const unknown = new Set()
  // the dig of the dirt is never answered (ghost air), and neither is the first visit's probe
  const r1 = await M.runVisit({ ...pr.p('A'), unknown }, bot(srv, 'A', { dig: async c => { srv.set(c, 'air'); return 'unconfirmed' } }), { maxSteps: 2000 })
  assert.ok(unknown.has(k3(pad[5].at)), `unknown after visit 1 (${r1.stop})`)
  // the next visit's probe answers air: the cell is known again and built (Codex r2 P2: it was never asked)
  let probes = 0
  const r2 = await M.runVisit({ ...pr.p('A'), unknown }, bot(srv, 'A', { probe: async () => { probes++; return 'air' } }), { maxSteps: 2000 })
  assert.ok(probes >= 1, 'asked again'); assert.ok(!unknown.has(k3(pad[5].at)))
  assert.strictEqual(r2.stop, 'complete', JSON.stringify(r2))
}
await t('AN UNKNOWN FOREIGN CELL (a dig never answered) is asked again by the next visit and built (Codex r2 P2)', () => foreignUnknown(R))
await t('MUTANT the unknown record cell never asked again', () => both('        if (unk.length) { const c = unk[0]; if ((await resolveUnknown(c.at)) == null) bump(c.at); continue }\n', '', foreignUnknown))
await t('a scaffold-class block (dirt) in a pad cell is dug under the segment\'s lease and the cell built; a CHEST there stalls the segment', async () => {
  const pad = SITE.record.cells.filter(c => c.seg === 'pad')
  const srv = server({ [k3(pad[5].at)]: 'dirt' }), { p } = project()
  const e = bot(srv, 'A')
  const r = await R.runVisit(p('A'), e, { maxSteps: 2000 })
  assert.strictEqual(r.stop, 'complete', JSON.stringify(r)); assert.strictEqual(srv.read(...pad[5].at).name, 'stone_bricks')
  assert.ok(e.logs.some(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'foreign'))
  const srv2 = server({ [k3(pad[5].at)]: 'chest' }), pr2 = project()
  const r2 = await R.runVisit(pr2.p('A'), bot(srv2, 'A'), { maxSteps: 2000 })
  assert.strictEqual(srv2.read(...pad[5].at).name, 'chest'); assert.strictEqual(r2.stop, 'blocked')
})

console.log('THE BUILDER\'S OWN BODY (Paper r2: a click refused mid-jump)')
const ownBody = async M => {
  const srv = server(), { p } = project()
  const e = bot(srv, 'A')
  // the builder's own box covers every cell (a stand-in for "the head is inside the target cell" -- Paper r2 had it mid-jump
  // under a trim cell): it never lands, so no click may be sent
  e.self = () => ({ x: 0, y: -1000, z: 0, w: 4000, h: 4000 })
  let sent = 0
  const send = e.send
  e.send = (sup, face, seq) => { sent++; return send(sup, face, seq) }
  const r = await M.runVisit(p('A'), e, { maxSteps: 30 })
  assert.strictEqual(sent, 0, `no click into the builder's own body (${r.stop})`)
}
await t('a click never goes into the builder\'s OWN body (it waits for the landing, then gives the cell up as a body)', () => ownBody(R))
await t('MUTANT the own-body check dropped', () => both("    if (e.self && inCell(e.self(), cell)) return 'body'\n", '', ownBody))

console.log('THE MUTEX AND A GONE HOLDER, THROUGH A VISIT (Codex r3 P1, Claude r3 P3-3)')
const heldBy = (pr, at) => fs.writeFileSync(path.join(pr.dir, `${pr.key}.mutate.g1.json`), JSON.stringify({ holder: 'A', pid: process.pid, conn: 'A-c2', at }))
await t('a holder GONE after taking the mutex (its beat stopped, absent from the tab list 10 s since): B\'s visit takes it and builds', async () => {
  const srv = server(), pr = project(SITE.record, ['B'])
  const at = Date.now() - 120_000
  heldBy(pr, at)
  PJ.presenceWrite(pr.dir, pr.key, 'A', { conn: 'A-c2', now: at - 1_000, beat: at + 1_000 })
  srv.seen.set('A', { online: false, offlineSince: at + 10, leftAt: null })
  const r = await R.runVisit(pr.p('B'), bot(srv, 'B'), { maxSteps: 20 })
  assert.ok(r.placed > 0, JSON.stringify(r))
})
await t('THE CODEX r4 SCENARIO: A\'s lock connection still BEATS -- B\'s tab list says absent for a minute, nothing is displaced', async () => {
  const srv = server(), pr = project(SITE.record, ['B'])
  const at = Date.now() - 60_000
  heldBy(pr, at)
  PJ.presenceWrite(pr.dir, pr.key, 'A', { conn: 'A-c2', now: at - 1_000, beat: Date.now() })
  srv.seen.set('A', { online: false, offlineSince: at + 10, leftAt: at + 10 })
  const r = await R.runVisit(pr.p('B'), bot(srv, 'B'), { maxSteps: 20 })
  assert.strictEqual(r.placed, 0, `a beating holder is never displaced (${r.stop})`)
})
await t('THE CODEX r3 SCENARIO: B noticed A offline BEFORE A reconnected and took the mutex -- the stale notice frees nothing', async () => {
  const srv = server(), pr = project(SITE.record, ['B'])
  const at = Date.now() - 5_000
  heldBy(pr, at)
  srv.seen.set('A', { online: false, offlineSince: at - 60_000, leftAt: at - 60_000 })   // the tab list has not caught up
  const r = await R.runVisit(pr.p('B'), bot(srv, 'B'), { maxSteps: 20 })
  assert.strictEqual(r.placed, 0, `A's live mutex is never displaced (${r.stop})`)
})

console.log('THE SENDER FENCES ITSELF ON ITS OWN BEAT (Codex r5 P1)')
const ownBeat = async (M, age) => {
  const srv = server(), pr = project()
  PJ.presenceWrite(pr.dir, pr.key, 'A', { conn: 'A-c1', now: Date.now() - 600_000, beat: Date.now() - age })
  return M.runVisit({ ...pr.p('A'), beat: true }, bot(srv, 'A'), { maxSteps: 12 })
}
await t('a builder whose own beat is not published (20 s old) sends nothing (fence:beat); a fresh beat builds (control)', async () => {
  const stale = await ownBeat(R, 20_000)
  assert.strictEqual(stale.placed, 0); assert.strictEqual(stale.stop, 'fence:beat', JSON.stringify(stale))
  const fresh = await ownBeat(R, 1_000)
  assert.ok(fresh.placed > 0, JSON.stringify(fresh))
})
await t('MUTANT the visit never asks for its beat', () => both('beatConn: p.beat ? conn : null, now: now() })', 'beatConn: null, now: now() })', async M => {
  const r = await ownBeat(M, 20_000)
  assert.strictEqual(r.placed, 0)
}))

console.log('THE READ\'S EVIDENCE (read r1)')
await t('placedBy books every acknowledged placement by the HELD name (a torch that lands as a wall_torch is a torch); a caller\'s object is filled in place', async () => {
  const srv = server(), { p } = project()
  const placedBy = {}
  const r = await R.runVisit({ ...p('A'), placedBy }, bot(srv, 'A', { as: n => (n === 'torch' ? 'wall_torch' : n) }), { maxSteps: 2000 })
  assert.strictEqual(r.stop, 'complete')
  assert.strictEqual(Object.values(placedBy).reduce((a, b) => a + b, 0), r.placed + r.planted)
  assert.strictEqual(placedBy.stone_bricks, 89); assert.strictEqual(placedBy.torch, 2); assert.ok(!('wall_torch' in placedBy))
  assert.strictEqual(r.placedBy, placedBy)
})
await t('a felled tree\'s clear row carries the replant cells reading a sapling at the felling (saplings=1/1)', async () => {
  const log = B.footprint(BP, { x: SITE.record.anchor[0], z: SITE.record.anchor[1] }, SITE.record.orient).pad[30]
  const at = [log[0], G + 1, log[1]]
  const rp = { cell: [SITE.record.box[2] + 10, G + 1, SITE.record.box[1]], species: 'oak', sapling: 'oak_sapling', state: 'pending' }
  const record = { ...SITE.record, clear: [{ at, kind: 'tree', name: 'oak_log' }], replant: [rp] }
  const srv = server({ [k3(at)]: 'oak_log' }), { p } = project(record)
  const e = bot(srv, 'A')
  await R.runVisit(p('A'), e, { maxSteps: 2000 })
  const row = e.logs.find(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'tree')
  assert.ok(row, 'the felling row'); assert.strictEqual(row[1].saplings, '1/1')
})

console.log('THE SLOT REFERENCE (Codex r1 P3)')
await t('slotRef follows every renewal of the admission slot (the caller releases the LATEST generation on any exit)', async () => {
  const srv = server(), { p } = project()
  const e = bot(srv, 'A')
  let off = 0
  e.now = () => Date.now() + off
  const log = e.log
  e.log = (k, d) => { log(k, d); if (k === '_build' && e.logs.length === 10) off = 3 * 60_000 }
  const pp = { ...p('A'), slotRef: { gen: null } }
  const g0 = pp.slotGen
  await R.runVisit(pp, e, { maxSteps: 40 })
  assert.ok(pp.slotRef.gen > g0, `renewed: ${g0} -> ${pp.slotRef.gen}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
