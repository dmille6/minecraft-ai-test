// SHOP-01 STAGE A, THE BUILD PROJECT'S FILES (bots/src/buildproj.mjs): the record's generation chain, the slot and segment
// leases with fresh epochs, the mutex (D7 r2: exclusive-create GENERATIONS, the newest deciding, no age reclaim), the intent logs
// with their connection, presence and retirement, the barrier and the fence. Behaviour over real temporary directories; the
// mutex's dead-holder reclaim is exercised with a real child process that takes the lock and exits; the reclaim RACE (Codex r1
// P1) is interleaved through the liveness callback. Mutants are checked both ways (the real code passes, the mutant fails).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const P = await import('../src/buildproj.mjs')
const PATH = new URL('../src/buildproj.mjs', import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (old, neu, fn) {
  const src = readFileSync(PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
async function mutantKilled (old, neu, scenario) {
  await scenario(P)
  let killed = false
  await withMutant(old, neu, async M => { try { await scenario(M) } catch { killed = true } })
  assert.ok(killed, 'the mutant survived its scenario')
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'buildproj-'))
const KEY = P.projKey({ x: 0, y: 70, z: 0 }, 'shop')

console.log('THE RECORD')
await t('the key names the home and the plot', () => assert.strictEqual(KEY, 'project-0_70_0.shop'))
await t('publish a root, then transitions: the head walks the chain; a body of null writes nothing', () => {
  const d = tmp()
  assert.strictEqual(P.recordHead(d, KEY).head, null)
  const a = P.publishRecord(d, KEY, () => ({ v: 1, state: 'open' }))
  assert.strictEqual(a.result, 'accepted'); assert.strictEqual(a.gen, 1)
  const b = P.publishRecord(d, KEY, cur => ({ ...cur, state: 'pad_done' }))
  assert.strictEqual(b.gen, 2)
  const h = P.recordHead(d, KEY)
  assert.strictEqual(h.head.gen, 2); assert.strictEqual(h.head.rec.state, 'pad_done'); assert.strictEqual(h.head.rec.prev, 1)
  assert.strictEqual(P.publishRecord(d, KEY, () => null).result, 'nothing')
})
await t('a generation that breaks the chain (wrong prevSha) is rejected and skipped; the head stays', () => {
  const d = tmp()
  P.publishRecord(d, KEY, () => ({ v: 1 }))
  fs.writeFileSync(path.join(d, `${KEY}.g2.json`), JSON.stringify({ v: 1, gen: 2, prev: 1, prevSha: 'f'.repeat(64) }))
  const h = P.recordHead(d, KEY)
  assert.strictEqual(h.head.gen, 1); assert.deepStrictEqual(h.rejected.map(r => r.why), ['chain'])
})
await t('two writers on the same head: one links gen 2, the other rebases onto it (gen 3) -- never two gen 2s', () => {
  const d = tmp()
  P.publishRecord(d, KEY, () => ({ v: 1, n: 0 }))
  // the second writer's mutate runs, then another writer links gen 2 first (simulated inside the first mutate)
  let raced = false
  const r = P.publishRecord(d, KEY, cur => {
    if (!raced) { raced = true; P.publishRecord(d, KEY, c => ({ ...c, n: c.n + 10 })) }
    return { ...cur, n: cur.n + 1 }
  })
  assert.strictEqual(r.result, 'accepted'); assert.strictEqual(r.gen, 3)
  assert.strictEqual(P.recordHead(d, KEY).head.rec.n, 11, 'the rebase applied on top of the other writer')
})

console.log('LEASES AND SLOTS')
await t('one holder at a time; a second is refused while the lease lives and for RECLAIM_MS after it lapses', () => {
  const d = tmp(), now = 1_000_000
  const a = P.takeLease(d, KEY, 'seg-pad', 'A', { now })
  assert.ok(a.ok)
  assert.strictEqual(P.takeLease(d, KEY, 'seg-pad', 'B', { now: now + 1 }).ok, false)
  assert.strictEqual(P.takeLease(d, KEY, 'seg-pad', 'B', { now: now + P.LEASE_TTL_MS + 1 }).ok, false, 'lapsed, inside the reclaim grace')
  const b = P.takeLease(d, KEY, 'seg-pad', 'B', { now: now + P.LEASE_TTL_MS + P.RECLAIM_MS + 1 })
  assert.ok(b.ok); assert.strictEqual(b.gen, 2)
})
await t('a released lease is free at once; holdsLease is false for a lapsed lease even inside the grace (the holder may not click)', () => {
  const d = tmp(), now = 2_000_000
  const a = P.takeLease(d, KEY, 'seg-pad', 'A', { now })
  assert.ok(P.holdsLease(d, KEY, 'seg-pad', 'A', a.gen, now + 10))
  assert.ok(!P.holdsLease(d, KEY, 'seg-pad', 'A', a.gen, now + P.LEASE_TTL_MS + 5))
  P.releaseLease(d, KEY, 'seg-pad', 'A', a.gen)
  assert.ok(P.takeLease(d, KEY, 'seg-pad', 'B', { now: now + 20 }).ok)
})
await t('RENEWAL is a new generation (a fresh fencing epoch): the old generation no longer holds', () => {
  const d = tmp(), now = 3_000_000
  const a = P.takeLease(d, KEY, 'slot1', 'A', { now })
  const g2 = P.renewLease(d, KEY, 'slot1', 'A', a.gen, { now: now + 1000 })
  assert.strictEqual(g2, a.gen + 1)
  assert.ok(!P.holdsLease(d, KEY, 'slot1', 'A', a.gen, now + 1001), 'the old epoch is fenced off')
  assert.ok(P.holdsLease(d, KEY, 'slot1', 'A', g2, now + 1001))
  assert.strictEqual(P.renewLease(d, KEY, 'slot1', 'B', g2, { now: now + 1002 }), null, 'only the holder renews')
})
await t('ADMISSION SLOTS: builders_max 2 admits two builders and refuses a third; a holder re-taking renews its own slot', () => {
  const d = tmp(), now = 4_000_000
  const a = P.takeSlot(d, KEY, 'A', 2, { now }), b = P.takeSlot(d, KEY, 'B', 2, { now })
  assert.ok(a.ok && b.ok); assert.notStrictEqual(a.slot, b.slot)
  assert.strictEqual(P.takeSlot(d, KEY, 'C', 2, { now }).ok, false)
  const a2 = P.takeSlot(d, KEY, 'A', 2, { now: now + 5 })
  assert.strictEqual(a2.slot, a.slot); assert.strictEqual(a2.gen, a.gen + 1)
})
await t('an unreadable lease directory BLOCKS (never two holders)', () => {
  const s = P.leaseState('/proc/definitely/not/here/\0bad', KEY, 'slot1')
  assert.ok(s === null || s.blocksUntil === Infinity)
})

console.log('THE MUTEX (D7)')
await t('exclusive: a second taker is busy; only the holder (name and pid) releases it', () => {
  const d = tmp()
  assert.ok(P.mutexTake(d, KEY, 'A').ok)
  assert.strictEqual(P.mutexTake(d, KEY, 'B').ok, false)
  P.mutexRelease(d, KEY, 'B')
  assert.strictEqual(P.mutexTake(d, KEY, 'B').ok, false, 'B could not release A\'s lock')
  P.mutexRelease(d, KEY, 'A')
  assert.ok(P.mutexTake(d, KEY, 'B').ok)
})
await t('A HOLDER THAT DIES: a real child process takes the lock and exits -> the next taker reclaims it at once (pid dead)', () => {
  const d = tmp()
  const mod = new URL('../src/buildproj.mjs', import.meta.url).href
  execFileSync(process.execPath, ['--input-type=module', '-e', `const P = await import(${JSON.stringify(mod)}); const r = P.mutexTake(${JSON.stringify(d)}, ${JSON.stringify(KEY)}, 'child'); if (!r.ok) process.exit(3)`])
  const lock = JSON.parse(fs.readFileSync(path.join(d, `${KEY}.mutate.g1.json`), 'utf8'))
  assert.strictEqual(lock.holder, 'child')
  const r = P.mutexTake(d, KEY, 'B')
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.reclaimed, 'child')
})
await t('NO AGE RECLAIM (Codex r1 P1): a LIVE holder is never displaced, an hour on (a suspended holder may still send); released, free at once', () => {
  const d = tmp(), now = 5_000_000
  const a = P.mutexTake(d, KEY, 'A', { now, pid: 4242, alive: () => true })
  assert.ok(a.ok)
  assert.strictEqual(P.mutexTake(d, KEY, 'B', { now: now + 3_600_000, alive: () => true }).ok, false)
  P.mutexRelease(d, KEY, 'A', { pid: 4242, gen: a.gen })
  const b = P.mutexTake(d, KEY, 'B', { now: now + 3_600_001, alive: () => true })
  assert.ok(b.ok); assert.strictEqual(b.gen, a.gen + 1)
})
await t('THE RECLAIM RACE (Codex r1 P1): two takers that saw the same dead holder -- exactly one holds (the other gets EEXIST, busy)', () => {
  const d = tmp(), now = 5_100_000
  fs.writeFileSync(path.join(d, `${KEY}.mutate.g1.json`), JSON.stringify({ holder: 'dead', pid: 999_999, at: now }))
  let ra = null
  // A takes INSIDE B's liveness check of the dead holder: B has already judged gen 1 free when A creates gen 2
  const rb = P.mutexTake(d, KEY, 'B', { now, alive: pid => { if (pid === 999_999 && !ra) ra = P.mutexTake(d, KEY, 'A', { now, alive: p => p !== 999_999 }); return pid !== 999_999 } })
  assert.ok(ra?.ok, JSON.stringify(ra)); assert.strictEqual(ra.reclaimed, 'dead')
  assert.strictEqual(rb.ok, false, JSON.stringify(rb))
})
await t('a TORN generation (a kill inside the write) is held for MUTEX_TORN_MS, then free; a holder SUPERSEDED by its own newer presence is free', () => {
  const d = tmp(), now = Date.now()
  fs.writeFileSync(path.join(d, `${KEY}.mutate.g1.json`), '{"holder":"A","pi')
  assert.strictEqual(P.mutexTake(d, KEY, 'B', { now, alive: () => true }).ok, false, 'torn and fresh: held')
  const b = P.mutexTake(d, KEY, 'B', { now: now + P.MUTEX_TORN_MS + 1000, alive: () => true })
  assert.ok(b.ok, JSON.stringify(b))
  const d2 = tmp()
  assert.ok(P.mutexTake(d2, KEY, 'A', { now, pid: 4242, alive: () => true }).ok)
  assert.strictEqual(P.mutexTake(d2, KEY, 'B', { now: now + 10, alive: () => true }).ok, false, 'control: A\'s process still holds')
  P.presenceWrite(d2, KEY, 'A', { conn: 'c2', pid: 5151, now: now + 20 })   // A restarted as pid 5151 (pid 4242 may be reused)
  assert.ok(P.mutexTake(d2, KEY, 'B', { now: now + 30, alive: () => true }).ok)
})
await t('PID REUSE (Codex r2 P2): the holder restarted under the SAME pid -- its newer presence names another CONNECTION -> free; the same connection -> held', () => {
  const d = tmp(), now = Date.now()
  assert.ok(P.mutexTake(d, KEY, 'A', { now, pid: 4242, conn: 'A-c1', alive: () => true }).ok)
  P.presenceWrite(d, KEY, 'A', { conn: 'A-c1', pid: 4242, now: now + 10 })
  assert.strictEqual(P.mutexTake(d, KEY, 'B', { now: now + 20, alive: () => true }).ok, false, 'control: a fresh presence of the SAME connection proves nothing')
  P.presenceWrite(d, KEY, 'A', { conn: 'A-c2', pid: 4242, now: now + 30 })
  const r = P.mutexTake(d, KEY, 'B', { now: now + 40, alive: () => true })
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.reclaimed, 'A')
})
const beatOf = (conn, beat) => ({ conn, at: 0, beat })
await t('holderGone (Codex r3/r4/r5 P1): FAIL CLOSED on presence; the lock connection\'s beat stale 60 s AND absent from the tab list 10 s since', () => {
  const at = 21_000_000, off = { online: false, offlineSince: at + 1 }
  const stale = beatOf('c2', at + 2_000), later = at + 2_000 + P.BEAT_STALE_MS
  assert.ok(P.holderGone(at, { ...off, conn: 'c2', presence: stale, now: later }), 'positive control: dead connection, tab list agrees')
  assert.ok(!P.holderGone(at, { ...off, conn: 'c2', presence: null, now: later }), 'Codex r5 P1: NO presence (missing or unreadable) is no evidence')
  assert.ok(!P.holderGone(at, { ...off, conn: null, presence: stale, now: later }), 'a lock with no connection: no evidence')
  assert.ok(!P.holderGone(at, { ...off, conn: 'c2', presence: { conn: 'c2', at: 0 }, now: later }), 'a presence without a beat: no evidence')
  assert.ok(!P.holderGone(at, { ...off, conn: 'c2', presence: beatOf('c3', at + 1), now: at + 3_600_000 }), 'another connection\'s presence: the callers\' rule')
  assert.ok(!P.holderGone(at, { ...off, conn: 'c2', presence: beatOf('c2', at + 30_000), now: at + 35_000 }), 'Codex r4: the lock connection still BEATS')
  assert.ok(!P.holderGone(at, { online: false, offlineSince: at - 1, conn: 'c2', presence: stale, now: later }), 'Codex r3: an offline notice from before the lock')
  assert.ok(!P.holderGone(at, { online: false, offlineSince: later - P.OFFLINE_RETIRE_MS + 1, conn: 'c2', presence: stale, now: later }), 'absent, not yet 10 s')
  assert.ok(!P.holderGone(at, { online: true, offlineSince: at + 1, conn: 'c2', presence: stale, now: later }), 'online now: never')
  assert.ok(!P.holderGone(NaN, { ...off, conn: 'c2', presence: stale, now: later }), 'no time on the record: never')
})
await t('MUTANT fail-open on presence (Codex r5 P1)', () => mutantKilled("  if (!presence?.conn || !conn || presence.conn !== conn || !Number.isFinite(Number(presence.beat))) return false\n", '', M => {
  assert.ok(!M.holderGone(1000, { online: false, offlineSince: 1001, conn: 'c2', presence: null, now: 1e9 }))
}))
await t('MUTANT the heartbeat ignored (the receipt-time rule again)', () => mutantKilled('  if (now - Number(presence.beat) < BEAT_STALE_MS) return false\n', '', M => {
  const at = 21_000_000
  assert.ok(!M.holderGone(at, { online: false, offlineSince: at + 1, conn: 'c2', presence: beatOf('c2', at + 30_000), now: at + 35_000 }))
}))
await t('THE SENDER FENCES ITSELF on its own heartbeat (Codex r5 P1): published for its connection and younger than OWN_BEAT_MAX_MS, else `beat`', () => {
  const d = tmp(), now = Date.now()
  P.publishRecord(d, KEY, () => ({ v: 1 }), { now })
  const s = P.takeLease(d, KEY, 'slot1', 'A', { now }), g = P.takeLease(d, KEY, 'seg-pad', 'A', { now })
  const f = { slot: 1, slotGen: s.gen, seg: 'pad', segGen: g.gen, recordGen: 1, beatConn: 'A-c1', now }
  assert.strictEqual(P.fenceRefusal(d, KEY, 'A', f), 'beat', 'no presence: no send')
  P.presenceWrite(d, KEY, 'A', { conn: 'A-c1', now: now - 60_000, beat: now - 1_000 })
  assert.strictEqual(P.fenceRefusal(d, KEY, 'A', f), null, 'a fresh beat of this connection: may send')
  assert.strictEqual(P.fenceRefusal(d, KEY, 'A', { ...f, now: now - 1_000 + P.OWN_BEAT_MAX_MS }), 'beat', 'the beat is OWN_BEAT_MAX_MS old')
  assert.strictEqual(P.fenceRefusal(d, KEY, 'A', { ...f, beatConn: 'A-c0' }), 'beat', 'the presence names another connection')
  assert.strictEqual(P.fenceRefusal(d, KEY, 'A', { ...f, beatConn: null }), null, 'control: no beat asked for')
  assert.ok(P.OWN_BEAT_MAX_MS + 30_000 < P.BEAT_STALE_MS, 'own limit + the server keepalive stays under the peers\' limit')
})
await t('MUTANT the own-beat fence dropped', () => mutantKilled("  if (beatConn) { const pr = presenceRead(dir, key, holder); if (!pr || pr.conn !== beatConn || !(now - Number(pr.beat) < OWN_BEAT_MAX_MS)) return 'beat' }\n", '', M => {
  const d = tmp(), now = Date.now()
  M.publishRecord(d, KEY, () => ({ v: 1 }), { now })
  const s = M.takeLease(d, KEY, 'slot1', 'A', { now }), g = M.takeLease(d, KEY, 'seg-pad', 'A', { now })
  assert.strictEqual(M.fenceRefusal(d, KEY, 'A', { slot: 1, slotGen: s.gen, seg: 'pad', segGen: g.gen, recordGen: 1, beatConn: 'A-c1', now }), 'beat')
}))
await t('presenceWrite: `at` stays the connection\'s login, `beat` moves; a beat without fsync still lands', () => {
  const d = tmp()
  P.presenceWrite(d, KEY, 'A', { conn: 'A-c1', now: 1000, beat: 1000 })
  P.presenceWrite(d, KEY, 'A', { conn: 'A-c1', now: 1000, beat: 11_000, sync: false })
  const pr = P.presenceRead(d, KEY, 'A')
  assert.strictEqual(pr.at, 1000); assert.strictEqual(pr.beat, 11_000); assert.strictEqual(pr.conn, 'A-c1')
})
await t('MUTANT the postdating dropped (the r3 rule again)', () => mutantKilled('  return !online && offlineSince != null && offlineSince > since && now - offlineSince >= OFFLINE_RETIRE_MS\n', '  return !online && offlineSince != null && now - offlineSince >= RETIRE_MS\n', M => {
  assert.ok(!M.holderGone(1000, { online: false, offlineSince: 999, conn: 'c', presence: { conn: 'c', at: 0, beat: 0 }, now: 1e9 }))
}))
await t('A RETIRED HOLDER (offline on the server, as the taker saw it: `gone`) -> free; a live, online, suspended one stays held', () => {
  const d = tmp(), now = Date.now()
  assert.ok(P.mutexTake(d, KEY, 'A', { now, pid: 4242, conn: 'A-c1', alive: () => true }).ok)
  assert.strictEqual(P.mutexTake(d, KEY, 'B', { now: now + 3_600_000, alive: () => true, gone: () => false }).ok, false)
  assert.ok(P.mutexTake(d, KEY, 'B', { now: now + 3_600_000, alive: () => true, gone: rec => rec.holder === 'A' }).ok)
})
await t('old generations are pruned beyond MUTEX_KEEP; the newest always decides', () => {
  const d = tmp()
  for (let i = 0; i < P.MUTEX_KEEP + 5; i++) { const r = P.mutexTake(d, KEY, 'A'); assert.ok(r.ok); P.mutexRelease(d, KEY, 'A', { gen: r.gen }) }
  const gens = fs.readdirSync(d).filter(n => /\.mutate\.g\d+\.json$/.test(n))
  assert.ok(gens.length <= P.MUTEX_KEEP, `${gens.length} generations kept`)
  assert.ok(P.mutexTake(d, KEY, 'B').ok)
})

console.log('INTENTS AND THE BARRIER')
await t('intents: open across holders, closed by settled or cancelled; a torn line is skipped', () => {
  const d = tmp()
  const a1 = P.intentOpen(d, KEY, 'A', { cell: [1, 2, 3], block: 'stone_bricks', lease: 4, seq: 10 })
  const a2 = P.intentOpen(d, KEY, 'A', { cell: [1, 2, 4], block: 'stone_bricks', lease: 4, seq: 11 })
  const b1 = P.intentOpen(d, KEY, 'B', { cell: [5, 2, 3], block: 'oak_planks', lease: 7, seq: 3 })
  P.intentClose(d, KEY, 'A', a1, 'settled', { state: 'stone_bricks' })
  P.intentClose(d, KEY, 'B', b1, 'cancelled')
  fs.appendFileSync(path.join(d, `${KEY}.intents.A.jsonl`), '{"op":"open","id":"torn"')
  assert.deepStrictEqual(P.openIntents(d, KEY).map(i => i.id), [a2])
})
await t('THE BARRIER: taken by A, it fences B (fenceRefusal barrier) but not A; released, B passes', () => {
  const d = tmp(), now = 6_000_000
  P.publishRecord(d, KEY, () => ({ v: 1 }), { now })
  const sa = P.takeLease(d, KEY, 'slot1', 'A', { now }), ga = P.takeLease(d, KEY, 'seg-roof-inner', 'A', { now })
  const sb = P.takeLease(d, KEY, 'slot2', 'B', { now }), gb = P.takeLease(d, KEY, 'seg-fit-out', 'B', { now })
  const fa = { slot: 1, slotGen: sa.gen, seg: 'roof-inner', segGen: ga.gen, recordGen: 1, now }
  const fb = { slot: 2, slotGen: sb.gen, seg: 'fit-out', segGen: gb.gen, recordGen: 1, now }
  assert.strictEqual(P.fenceRefusal(d, KEY, 'B', fb), null, 'before: B may click (control)')
  const bar = P.barrierTake(d, KEY, 'A', { why: 'closer', now })
  assert.ok(bar.ok)
  assert.strictEqual(P.fenceRefusal(d, KEY, 'B', fb), 'barrier')
  assert.strictEqual(P.fenceRefusal(d, KEY, 'A', fa), null)
  assert.strictEqual(P.barrierTake(d, KEY, 'B', { now }).ok, false, 'one barrier at a time')
  P.barrierRelease(d, KEY, 'A', bar.gen)
  assert.strictEqual(P.fenceRefusal(d, KEY, 'B', fb), null)
})
await t('THE BARRIER WAITS for every other holder\'s open intent: settled -> clear; or the sender RETIRED (its beat stale, absent 10 s) -> clear; never a timer', () => {
  const d = tmp(), now = 7_000_000
  const id = P.intentOpen(d, KEY, 'B', { cell: [0, 0, 0], block: 'x', lease: 1, seq: 1, conn: 'B-c1', now })
  P.intentOpen(d, KEY, 'A', { cell: [1, 0, 0], block: 'x', lease: 1, seq: 1, conn: 'A-c1', now })
  assert.deepStrictEqual(P.barrierClear(d, KEY, 'A', { now }).waiting.map(i => i.holder), ['B'], 'A\'s own intent never blocks A')
  assert.strictEqual(P.barrierClear(d, KEY, 'A', { now: now + 3_600_000 }).clear, false, 'an hour later: still waiting (no timer)')
  const pres = { conn: 'B-c1', at: now - 1, beat: now + 1 }
  const offline = (i, t) => P.intentRetired(i, { presence: pres, online: false, offlineSince: now + 1, now: t })
  assert.strictEqual(P.barrierClear(d, KEY, 'A', { isRetired: offline, now: now + 1 + P.BEAT_STALE_MS - 1 }).clear, false, 'not yet')
  assert.ok(P.barrierClear(d, KEY, 'A', { isRetired: offline, now: now + 1 + P.BEAT_STALE_MS }).clear)
  P.intentClose(d, KEY, 'B', id, 'settled', { state: 'x' })
  assert.ok(P.barrierClear(d, KEY, 'A', { now }).clear)
})
await t('THE FENCE names each lost guard: slot, segment, record generation', () => {
  const d = tmp(), now = 8_000_000
  P.publishRecord(d, KEY, () => ({ v: 1 }), { now })
  const s = P.takeLease(d, KEY, 'slot1', 'A', { now }), g = P.takeLease(d, KEY, 'seg-pad', 'A', { now })
  const f = { slot: 1, slotGen: s.gen, seg: 'pad', segGen: g.gen, recordGen: 1, now }
  assert.strictEqual(P.fenceRefusal(d, KEY, 'A', f), null)
  assert.strictEqual(P.fenceRefusal(d, KEY, 'A', { ...f, now: now + P.LEASE_TTL_MS + 1 }), 'slot')
  P.renewLease(d, KEY, 'seg-pad', 'A', g.gen, { now: now + 10 })
  assert.strictEqual(P.fenceRefusal(d, KEY, 'A', { ...f, now: now + 11 }), 'segment', 'a renewal moved the epoch: the old token fails')
  P.publishRecord(d, KEY, c => ({ ...c, t: 1 }), { now })
  assert.strictEqual(P.fenceRefusal(d, KEY, 'A', { ...f, segGen: g.gen + 1, now: now + 12 }), 'record')
})

await t('intentRetired: a NEWER presence of another connection; else holderGone for the intent\'s own connection (fail closed)', () => {
  const now = 12_000_000, i = { holder: 'B', conn: 'c1', at: now }
  assert.ok(!P.intentRetired(i, { now }), 'nothing seen: live')
  assert.ok(P.intentRetired(i, { presence: { conn: 'c2', at: now + 5 }, now: now + 6 }), 'B reconnected after the intent')
  assert.ok(!P.intentRetired(i, { presence: { conn: 'c2', at: now - 5 }, now: now + 6 }), 'an OLDER presence of another connection proves nothing')
  assert.ok(!P.intentRetired(i, { presence: { conn: 'c1', at: now + 5 }, now: now + 6 }), 'the same connection: live')
  assert.ok(!P.intentRetired(i, { online: false, offlineSince: now + 5, now: now + 3_600_000 }), 'Codex r5 P1: no presence -> never by the tab list alone')
  assert.ok(!P.intentRetired(i, { presence: { conn: 'c1', at: now - 100, beat: now + 20_000 }, online: false, offlineSince: now + 5, now: now + 30_000 }), 'its own connection still BEATS: live')
  assert.ok(P.intentRetired(i, { presence: { conn: 'c1', at: now - 100, beat: now + 1 }, online: false, offlineSince: now + 5, now: now + 1 + P.BEAT_STALE_MS }), 'the beat stopped and the tab list agrees: retired')
  assert.ok(!P.intentRetired(i, { presence: { conn: 'c1', at: now - 100, beat: now + 1 }, online: false, offlineSince: now - 5, now: now + 3_600_000 }), 'Codex r3: an offline notice from BEFORE the intent proves nothing')
})
await t('closeOwn: an earlier connection\'s open intents cancelled, this connection\'s acknowledged ones settled, the rest open; others untouched', () => {
  const d = tmp(), now = 13_000_000
  P.intentOpen(d, KEY, 'A', { cell: [0, 0, 0], block: 'x', lease: 1, seq: 7, conn: 'old', now })
  P.intentOpen(d, KEY, 'A', { cell: [1, 0, 0], block: 'x', lease: 1, seq: 3, conn: 'new', now })
  const live = P.intentOpen(d, KEY, 'A', { cell: [2, 0, 0], block: 'x', lease: 1, seq: 9, conn: 'new', now })
  const other = P.intentOpen(d, KEY, 'B', { cell: [3, 0, 0], block: 'x', lease: 1, seq: 1, conn: 'b1', now })
  assert.deepStrictEqual(P.closeOwn(d, KEY, 'A', { conn: 'new', acked: 5, now }), { settled: 1, cancelled: 1 })
  assert.deepStrictEqual(P.openIntents(d, KEY).map(i => i.id).sort(), [live, other].sort())
})

console.log('MUTANTS (anchored, unique; both ways)')
await t('MUTANT the reclaim grace dropped (a lapsed lease is taken at once)', () => mutantKilled('now < cur.blocksUntil) return', 'now < cur.holdsUntil) return', M => {
  const d = tmp(), now = 9_000_000
  M.takeLease(d, KEY, 'seg-pad', 'A', { now })
  assert.strictEqual(M.takeLease(d, KEY, 'seg-pad', 'B', { now: now + M.LEASE_TTL_MS + 1 }).ok, false)
}))
await t('MUTANT a live mutex reclaimed (the pid check ignored)', () => mutantKilled("if (Number.isInteger(rec.pid) && !alive(rec.pid)) return { gen: g, rec, held: false, why: 'dead' }", "if (true) return { gen: g, rec, held: false, why: 'dead' }", M => {
  const d = tmp()
  M.mutexTake(d, KEY, 'A', { alive: () => true })
  assert.strictEqual(M.mutexTake(d, KEY, 'B', { alive: () => true }).ok, false)
}))
await t('MUTANT the barrier no longer fences others', () => mutantKilled("if (b?.active && b.rec?.holder !== holder) return 'barrier'", '', M => {
  const d = tmp(), now = 10_000_000
  M.publishRecord(d, KEY, () => ({ v: 1 }), { now })
  const s = M.takeLease(d, KEY, 'slot2', 'B', { now }), g = M.takeLease(d, KEY, 'seg-x', 'B', { now })
  M.barrierTake(d, KEY, 'A', { now })
  assert.strictEqual(M.fenceRefusal(d, KEY, 'B', { slot: 2, slotGen: s.gen, seg: 'x', segGen: g.gen, recordGen: 1, now }), 'barrier')
}))
await t('MUTANT the newest-generation check dropped (a taker that read the listing long ago holds beside a newer generation)', () => mutantKilled('if (gens.at(-1) !== n) {', 'if (false) {', M => {
  const d = tmp(), now = 14_000_000
  fs.writeFileSync(path.join(d, `${KEY}.mutate.g1.json`), JSON.stringify({ holder: 'dead', pid: 999_999, at: now }))
  // while B judges gen 1, gen 3 appears (held by a live process): B's gen 2 is not the newest and must not hold
  const r = M.mutexTake(d, KEY, 'B', { now, alive: pid => { if (pid === 999_999) fs.writeFileSync(path.join(d, `${KEY}.mutate.g3.json`), JSON.stringify({ holder: 'C', pid: process.pid, at: now })); return pid !== 999_999 } })
  assert.strictEqual(r.ok, false)
}))
await t('MUTANT the barrier waits on a timer (an old intent counted as settled)', () => mutantKilled('const waiting = openIntents(dir, key).filter(i => i.holder !== holder && !isRetired(i, now))', 'const waiting = openIntents(dir, key).filter(i => i.holder !== holder && now - i.at < 60_000)', M => {
  const d = tmp(), now = 11_000_000
  M.intentOpen(d, KEY, 'B', { cell: [0, 0, 0], block: 'x', lease: 1, seq: 1, now })
  assert.strictEqual(M.barrierClear(d, KEY, 'A', { now: now + 3_600_000 }).clear, false)
}))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
