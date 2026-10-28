// SHOP-01 r2, ONE BUILD VISIT on the fake server (test/helpers/buildfake.mjs): the r1 review findings as scenarios.
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

/** A tree clear at a pad cell with its replant; `onWalk(srv)` runs at every walk. */
function treeScene (opts = {}) {
  const log = B.footprint(BP, { x: SITE.record.anchor[0], z: SITE.record.anchor[1] }, SITE.record.orient).pad[30]
  const at = [log[0], G + 1, log[1]]
  const rp = { cell: [SITE.record.box[2] + 10, G + 1, SITE.record.box[1]], species: 'oak', sapling: 'oak_sapling', state: 'pending' }
  const record = { ...SITE.record, clear: [{ at, kind: 'tree', name: 'oak_log' }], replant: [rp] }
  const srv = server({ [k3(at)]: 'oak_log' }), pr = project(record)
  return { at, rp, record, srv, ...pr }
}
const digAnything = (srv, dug) => async c => { dug.push(srv.read(...c).name); srv.set(c, 'air'); return 'confirmed' }   // the r1 adapter: it dug whatever stood there
const replacedDuringWalk = async M => {
  const s = treeScene()
  const dug = []
  const e = bot(s.srv, 'A', { dig: digAnything(s.srv, dug) })
  const w = e.walkTo
  // a builder lays the pad cell's stone bricks while A walks to its dig stand (after the replant is in)
  e.walkTo = async st => { if (/_sapling$/.test(s.srv.read(...s.rp.cell).name) && s.srv.read(...s.at).name === 'oak_log') s.srv.set(s.at, 'stone_bricks'); return w(st) }
  const r = await M.runVisit(s.p('A'), e, { maxSteps: 40 })
  assert.ok(!dug.includes('stone_bricks'), `the replacement was never dug (${r.stop}: ${dug})`)
  assert.strictEqual(r.cleared, 0)
}
await t('THE NAMED BLOCK RE-CHECKED AT THE DIG (Codex r1 P2): a replacement laid during the walk is never dug', () => replacedDuringWalk(R))
await t('MUTANT the at-the-dig re-check dropped (the replacement is dug)', () => both("    if (nm(rd(...at)) !== name) return 'gone'\n", '', replacedDuringWalk))

/** A dig the server never answers: the client shows air (ghost) but no block_change came. */
const ghostDig = srv => async c => { srv.set(c, 'air'); return 'unconfirmed' }
const ghostScene = async (M, probe) => {
  const s = treeScene()
  const unknown = new Set()
  const e = bot(s.srv, 'A', { dig: ghostDig(s.srv), probe })
  const r = await M.runVisit({ ...s.p('A'), unknown }, e, { maxSteps: 2000 })
  return { s, r, unknown, e }
}
await t('AN UNANSWERED PROBE CONFIRMS NOTHING (Codex r1 P2): the cell stays UNKNOWN -- not cleared, never placed into, kept for the next visit', async () => {
  const { s, r, unknown, e: e0 } = await ghostScene(R, async () => null)
  assert.strictEqual(r.cleared, 0); assert.strictEqual(r.unknown, 1); assert.ok(unknown.has(k3(s.at)))
  assert.ok(e0.logs.some(([k, d]) => k === '_build' && d.op === 'unknown' && k3(d.cell) === k3(s.at)), 'the read\'s evidence: an op=unknown row')
  assert.ok(!s.srv.placedAt.has(k3(s.at)), 'the ghost cell was never built into')
  assert.notStrictEqual(r.stop, 'complete')
  // the next visit asks the server again: it says air -> the cell is known, and built
  const r2 = await R.runVisit({ ...s.p('A'), unknown }, bot(s.srv, 'A', { probe: async () => 'air' }), { maxSteps: 2000 })
  assert.ok(!unknown.has(k3(s.at))); assert.strictEqual(r2.stop, 'complete', JSON.stringify(r2))
})
await t('MUTANT the probe read as the client\'s air again (ghost air promoted to cleared)', () => both("for (let i = 0; v === 'unconfirmed' && i < PROBES_MAX; i++) { const n = await e.probe(at); if (n != null) v = AIR(n) ? 'confirmed' : 'standing' }", "for (let i = 0; v === 'unconfirmed' && i < PROBES_MAX; i++) { await e.probe(at); if (isClear(at)) v = 'confirmed' }", async M => {
  const { r } = await ghostScene(M, async () => null)
  assert.strictEqual(r.cleared, 0)
}))
await t('a probe that says the block STANDS: not cleared, not unknown (the client is resynced; a later dig retries it)', async () => {
  const { r, unknown } = await ghostScene(R, async () => 'oak_log')
  assert.strictEqual(r.cleared, 0); assert.strictEqual(r.unknown, 0); assert.strictEqual(unknown.size, 0)
})

console.log('THE SERVER\'S OWN BLOCK (Claude r1 P2-1)')
const variants = n => (n === 'torch' ? 'wall_torch' : n === 'cut_copper' ? 'exposed_cut_copper' : n)
const variantScene = async M => {
  const srv = server(), { p } = project()
  const r = await M.runVisit(p('A'), bot(srv, 'A', { as: variants }), { maxSteps: 2000 })
  assert.strictEqual(r.stop, 'complete', JSON.stringify(r))
  assert.ok([...srv.cells.values()].includes('wall_torch') && [...srv.cells.values()].includes('exposed_cut_copper'), 'the server placed the variants')
}
await t('a server that places WALL_TORCH for a side-face torch and EXPOSED cut copper: the workshop still completes', () => variantScene(R))
await t('MUTANT the block families dropped (the exact name again)', () => both('return ok.has(blockFamily(n)) || (ok.has(\'*planks\')', 'return ok.has(n) || (ok.has(\'*planks\')', variantScene))
await t('blockFamily: wall torches, the copper weathering and waxing; anything else is itself', () => {
  assert.strictEqual(R.blockFamily('wall_torch'), 'torch')
  for (const n of ['exposed_cut_copper', 'weathered_cut_copper', 'oxidized_cut_copper', 'waxed_cut_copper', 'waxed_oxidized_cut_copper']) assert.strictEqual(R.blockFamily(n), 'cut_copper', n)
  assert.strictEqual(R.blockFamily('stone_bricks'), 'stone_bricks')
  assert.ok(!R.cellDone({ name: 'exposed_copper', boundingBox: 'block' }, BP.palette, 'trim'), 'copper BLOCK is not cut copper')
})

console.log('THE INTENT LIFECYCLE (Codex r1 P2, Claude r1 P2-2)')
const lateAck = async M => {
  const srv = server(), pr = project(SITE.record, ['A'])
  // every click is acknowledged at 80 ms; the click stops waiting at 20 ms (silent) -- the late ack must settle it
  const e = bot(srv, 'A', { ack: () => 80, capWait: 20, settle: id => PJ.intentClose(pr.dir, pr.key, 'A', id, 'settled', { state: 'ack' }) })
  await M.runVisit(pr.p('A'), e, { maxSteps: 3 })
  await new Promise(r => setTimeout(r, 150))
  assert.deepStrictEqual(PJ.openIntents(pr.dir, pr.key).filter(i => i.holder === 'A'), [], 'the late acknowledgement settled it')
}
await t('A LATE ACKNOWLEDGEMENT SETTLES the intent the click stopped waiting for (the connection\'s tracker, not the visit)', () => lateAck(R))
await t('MUTANT the intent no longer tracked (a late ack leaves it open for good)', () => both("if (v !== 'acked') { e.track?.(id, seq); return 'silent' }", "if (v !== 'acked') { return 'silent' }", lateAck))
const ownLeftovers = async M => {
  const srv = server(), pr = project(SITE.record, ['A'])
  PJ.intentOpen(pr.dir, pr.key, 'A', { cell: [0, 0, 0], block: 'x', lease: 1, seq: 5, conn: 'A-c0', now: Date.now() - 60_000 })
  await M.runVisit(pr.p('A'), bot(srv, 'A', { conn: 'A-c1' }), { maxSteps: 1 })
  assert.deepStrictEqual(PJ.openIntents(pr.dir, pr.key).filter(i => i.conn === 'A-c0'), [], 'the old connection\'s intent is cancelled')
}
await t('A VISIT CLOSES ITS OWN LEFTOVERS: an earlier connection\'s open intent is cancelled at the start', () => ownLeftovers(R))
await t('MUTANT the leftovers left open', () => both("  PJ.closeOwn(dir, key, me, { conn, acked: e.acked?.() ?? 0, now: now() })\n", '', ownLeftovers))
await t('installAckTracker: a sequence mineflayer wrote BEFORE a visit is seen; a playerLeft survives the rejoin; offline since first seen', () => {
  const client = new EventEmitter(); client.write = () => {}
  const fb = new EventEmitter(); fb._client = client; fb.players = { B: {} }
  let T = 1000
  const A = installAckTracker(fb, { now: () => T })
  client.write('use_item', { sequence: 100 })
  assert.strictEqual(A.tracker.next(), 101)
  const settled = []
  A.onSettle(id => settled.push(id))
  A.track('i1', 101)
  client.emit('packet', { sequenceId: 100 }, { name: 'acknowledge_player_digging' })
  assert.deepStrictEqual(settled, [], 'an ack below the click settles nothing')
  client.emit('packet', { sequenceId: 104 }, { name: 'acknowledge_player_digging' })
  assert.deepStrictEqual(settled, ['i1'])
  fb.emit('playerLeft', { username: 'B' }); delete fb.players.B
  T = 1500; fb.emit('playerJoined', { username: 'B' }); fb.players.B = {}
  assert.strictEqual(A.seen('B', 1600).leftAt, 1000, 'the rejoin does not erase the playerLeft')
  delete fb.players.B
  assert.strictEqual(A.seen('B', 2000).offlineSince, 2000); assert.strictEqual(A.seen('B', 2500).offlineSince, 2000)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
