// GHOST BLOCKS: the prediction ledger and its wiring, driven through a fake client exactly as mineflayer drives the
// real one (finishDigging: write STOP, then _updateBlockState(pos, 0)). See src/digsync.mjs for the measurements.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const DIGSYNC = await import('../src/digsync.mjs')
const { attachDigSync, PredictionLedger, decodeSectionRecord, BACKSTOP_MS, GRACE_MS, FALSE_RESTORE_MS } = DIGSYNC

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const STONE = 1, AIR = 0

// `graceMs` defaults to a LONG grace here (an ack with no word stays pending for the whole test) unless a test injects
// a short one; `attach` lets a mutant module stand in for the real one.
function fakeBot ({ version = '1.21.8', backstopMs, tickMs, graceMs = 60_000, now, attach = attachDigSync } = {}) {
  const world = new Map()
  const k = p => `${p.x},${p.y},${p.z}`
  const client = new EventEmitter()
  const sent = []
  client.write = (name, params) => { sent.push({ name, params }) }
  const bot = new EventEmitter()
  const [maj, min, pat] = version.split('.').map(Number)
  const num = v => { const [a, b, c] = v.split('.').map(Number); return a * 1e6 + b * 1e3 + (c || 0) }
  bot.registry = { version: { '>=': v => maj * 1e6 + min * 1e3 + (pat || 0) >= num(v) } }
  bot._client = client
  // AS STRICT AS mineflayer: prismarine-world calls pos.floored(), so a plain object must throw here (it hid a real bug).
  bot.blockAt = p => { const f = p.floored(); return world.has(k(f)) ? { stateId: world.get(k(f)) } : null }
  bot._updateBlockState = (p, s) => { const f = p.floored(); world.set(k(f), s) }
  const rollbacks = []
  const ds = attach(bot, { onRollback: r => rollbacks.push(r), graceMs, ...(backstopMs ? { backstopMs } : {}), ...(tickMs ? { tickMs } : {}), ...(now ? { now } : {}) })
  // mineflayer's finishDigging, as it is: STOP then the local air write.
  const finishDig = pos => { client.write('block_dig', { status: 2, location: pos, face: 1, sequence: 0 }); bot._updateBlockState(pos, AIR) }
  const lastSeq = () => sent.at(-1).params.sequence
  const ack = () => client.emit('acknowledge_player_digging', { sequenceId: lastSeq() })
  // The server's word as mineflayer sees it: our listener runs first (digsync attaches before the plugins inject),
  // then mineflayer's blocks plugin writes the state into the world.
  const say = (p, type) => { client.emit('block_change', { location: p, type }); world.set(k(p), type) }
  return { bot, client, world, sent, rollbacks, ds, finishDig, lastSeq, ack, say, at: p => world.get(k(p)) }
}
import { createRequire } from 'node:module'
const { Vec3 } = createRequire(import.meta.url)('vec3')
const P = new Vec3(10, 64, -3)

await t('every sequenced packet gets a strictly increasing sequence > 0, whatever the caller passed', () => {
  const f = fakeBot()
  f.client.write('block_dig', { status: 0, location: P, face: 1, sequence: 0 })
  f.client.write('use_item', { hand: 0, sequence: 7 })
  f.client.write('block_place', { hand: 0, location: P, sequence: 0 })
  f.client.write('chat', { message: 'hi' })
  const seqs = f.sent.filter(s => s.name !== 'chat').map(s => s.params.sequence)
  assert.deepEqual(seqs, [1, 2, 3])
  assert.equal(f.sent.find(s => s.name === 'chat').params.sequence, undefined, 'unsequenced packets untouched')
})
await t('ACCEPTED dig: the server says air before its ack -> nothing restored', () => {
  const f = fakeBot(); f.world.set('10,64,-3', STONE)
  f.finishDig(P); const seq = f.lastSeq()
  f.client.emit('block_change', { location: P, type: AIR }); f.world.set('10,64,-3', AIR)   // mineflayer applies it
  f.client.emit('acknowledge_player_digging', { sequenceId: seq })
  assert.equal(f.at(P), AIR); assert.equal(f.rollbacks.length, 0); assert.equal(f.ds.counts.confirmed, 1)
})
// CONTRACT CHANGE (v2): v1 restored at the ack; now the restore waits out the grace. Same end state, later.
await t('REJECTED dig: an ack with no server word restores the block the bot believed it broke -- at grace EXPIRY, not before', async () => {
  const f = fakeBot({ graceMs: 80, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); assert.equal(f.at(P), AIR, 'mineflayer wrote the ghost')
  const w = f.ds.waitSettled(P); const t0 = Date.now()
  f.ack()
  assert.equal(f.ds.counts.graceStarted, 1)
  await sleep(30)
  assert.equal(f.at(P), AIR, 'restored inside the grace'); assert.equal(f.rollbacks.length, 0)
  assert.deepEqual(await w, { broken: false, pending: false, why: 'grace-expired' })
  assert.ok(Date.now() - t0 >= 75, `waitSettled answered at ${Date.now() - t0} ms, before the grace expired`)
  assert.equal(f.at(P), STONE); assert.equal(f.rollbacks.length, 1); assert.equal(f.rollbacks[0].why, 'grace-expired')
  assert.equal(f.ds.counts.graceExpired, 1); assert.equal(f.ds.counts.rolledBack, 1); assert.equal(f.ds.counts.backstop, 0)
  f.bot.emit('end')
})
await t('confirmation by multi_block_change counts as server word (the probe saw both kinds)', () => {
  const f = fakeBot(); const Q = new Vec3(35, 72, 21); f.world.set('35,72,21', STONE)
  f.finishDig(Q); const seq = f.lastSeq()
  // chunk (2, 4, 1): x 35 = 2*16+3, y 72 = 4*16+8, z 21 = 1*16+5
  const rec = (BigInt(AIR) << 12n) | (3n << 8n) | (5n << 4n) | 8n
  assert.deepEqual(decodeSectionRecord({ x: 2, y: 4, z: 1 }, rec).pos, { x: 35, y: 72, z: 21 }, 'decoder positive control')
  f.client.emit('multi_block_change', { chunkCoordinates: { x: 2, y: 4, z: 1 }, records: [rec] })
  f.client.emit('acknowledge_player_digging', { sequenceId: seq })
  assert.equal(f.at(Q), AIR); assert.equal(f.rollbacks.length, 0)
})
await t('an ack for an EARLIER sequence (the START) does not settle the STOP', () => {
  const f = fakeBot(); f.world.set('10,64,-3', STONE)
  f.client.write('block_dig', { status: 0, location: P, face: 1 }); const startSeq = f.lastSeq()
  f.finishDig(P)
  f.client.emit('acknowledge_player_digging', { sequenceId: startSeq })
  assert.equal(f.at(P), AIR, 'still a prediction'); assert.equal(f.ds.ledger.size, 1)
})
// CONTRACT CHANGE (v2): v1 restored stone at the ack and let the late air overwrite it (a false restore, 67% of all
// restores on the fixes-02 canary). Now the late air lands inside the grace and nothing is ever restored.
// Shared with the mutant below, so the mutant runs exactly this scenario.
async function delayedDestroy (attach) {
  const f = fakeBot({ graceMs: 150, tickMs: 5, attach }); f.world.set('10,64,-3', STONE)
  f.finishDig(P)
  const w = f.ds.waitSettled(P); let answeredAt = null
  w.then(() => { answeredAt = Date.now() })
  f.ack(); const ackAt = Date.now()
  const right_after_ack = f.at(P)
  await sleep(40)
  f.say(P, AIR)                       // Paper breaks it a few ticks after it acked the STOP
  const res = await w
  await sleep(200)                    // well past the grace: nothing may restore now
  f.bot.emit('end')
  return { f, res, right_after_ack, answeredMs: answeredAt - ackAt }
}
await t('DELAYED destroy: the ack outruns the air -> held through the grace, NEVER restored, world stays AIR, graceAir=1', async () => {
  const { f, res, right_after_ack, answeredMs } = await delayedDestroy(attachDigSync)
  assert.equal(right_after_ack, AIR, 'restored at the ack (the v1 false restore)')
  assert.equal(f.at(P), AIR); assert.equal(f.rollbacks.length, 0); assert.equal(f.ds.counts.rolledBack, 0)
  assert.equal(f.ds.counts.graceStarted, 1); assert.equal(f.ds.counts.graceAir, 1); assert.equal(f.ds.counts.graceExpired, 0)
  assert.equal(f.ds.counts.graceLt250, 1, 'the ack->air delay histogram'); assert.equal(f.ds.counts.confirmed, 1)
  assert.deepEqual(res, { broken: true, pending: false, why: 'server' })
  assert.ok(answeredMs < 120, `waitSettled answered ${answeredMs} ms after the ack: it waited for expiry instead of the word`)
  assert.equal(f.ds.counts.falseRestore, 0)
})
await t('GRACE, server says STONE: settled on the server\'s word at once, graceOther=1, not counted as a rollback', async () => {
  const f = fakeBot({ graceMs: 100, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); const w = f.ds.waitSettled(P); f.ack()
  await sleep(20)
  f.client.emit('block_change', { location: P, type: STONE })   // digsync's listener first: it settles and writes it
  assert.equal(f.at(P), STONE, 'the server\'s STONE is in the world model immediately')
  assert.deepEqual(await w, { broken: false, pending: false, why: 'server' })
  assert.equal(f.ds.counts.graceOther, 1); assert.equal(f.ds.counts.graceAir, 0); assert.equal(f.ds.ledger.size, 0)
  await sleep(130)
  assert.equal(f.ds.counts.graceExpired, 0, 'the grace must not also expire'); assert.equal(f.rollbacks.length, 0)
  f.bot.emit('end')
})
await t('the server\'s word BEFORE the ack: unchanged v1 behaviour, settled at the ack with no grace', () => {
  const f = fakeBot({ graceMs: 100, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); f.say(P, AIR); f.ack()
  assert.equal(f.ds.counts.graceStarted, 0); assert.equal(f.ds.counts.confirmed, 1); assert.equal(f.ds.ledger.size, 0)
  f.bot.emit('end')
})
await t('the BACKSTOP does not pre-empt a running grace, even when the prediction is older than the backstop', async () => {
  const f = fakeBot({ backstopMs: 30, graceMs: 120, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); await sleep(20); f.ack()
  await sleep(60)                     // prediction age ~80 ms > backstop 30; grace ~60 of 120
  assert.equal(f.at(P), AIR, 'restored before the grace expired'); assert.equal(f.ds.counts.backstop, 0)
  assert.equal([...f.ds.ledger.pending.values()][0]?.phase, 'grace')
  await sleep(110)
  assert.equal(f.at(P), STONE); assert.equal(f.rollbacks[0]?.why, 'grace-expired'); assert.equal(f.ds.counts.backstop, 0)
  f.bot.emit('end')
})
for (const [what, act] of [['respawn', f => f.bot.emit('spawn')], ['death', f => f.bot.emit('death')], ['disconnect', f => f.bot.emit('end')]]) {
  await t(`${what} DURING the grace clears it and tells the waiter nothing is known (null), and nothing restores later`, async () => {
    const f = fakeBot({ graceMs: 60, tickMs: 5 }); f.world.set('10,64,-3', STONE)
    f.finishDig(P); const w = f.ds.waitSettled(P); f.ack()
    await sleep(10); act(f)
    assert.deepEqual(await w, { broken: null, pending: false, why: 'cleared' })
    assert.equal(f.ds.ledger.size, 0); assert.equal(f.ds.counts.graceDropped, 1)
    await sleep(90)
    assert.equal(f.at(P), AIR); assert.equal(f.rollbacks.length, 0); assert.equal(f.ds.counts.graceExpired, 0)
    f.bot.emit('end')
  })
}
await t('a fresh chunk DURING the grace drops the prediction (the chunk is the truth), and tells the waiter', async () => {
  const f = fakeBot({ graceMs: 60, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); const w = f.ds.waitSettled(P); f.ack()
  f.client.emit('map_chunk', { x: 5, z: 5 })        // another column: positive control, nothing dropped
  assert.equal(f.ds.ledger.size, 1)
  f.client.emit('map_chunk', { x: 0, z: -1 })
  // CONTRACT CHANGE (second pass): 'dropped-chunk' split into 'replaced-chunk' (readable) and 'unloaded-chunk' (unknown)
  assert.deepEqual(await w, { broken: null, pending: false, why: 'replaced-chunk' })
  await sleep(90)
  assert.equal(f.at(P), AIR); assert.equal(f.rollbacks.length, 0); assert.equal(f.ds.counts.graceDropped, 1)
  f.bot.emit('end')
})
await t('a re-dig at the same position DURING the grace cancels it, keeps the OLDER prior, and waits for its own ack', async () => {
  const f = fakeBot({ graceMs: 60, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); f.ack()
  f.world.set('10,64,-3', 7); f.finishDig(P)        // the bot digs there again (prior now reads 7)
  assert.equal(f.ds.counts.graceDropped, 1)
  await sleep(90)
  assert.equal(f.at(P), AIR, 'the newer prediction was settled by the old grace')
  f.ack(); await sleep(90)
  assert.equal(f.at(P), STONE, 'restored to the FIRST prior'); assert.equal(f.ds.counts.graceExpired, 1)
  f.bot.emit('end')
})
await t('a fresh chunk is authoritative: its column\'s predictions are dropped, so no reverse ghost', () => {
  const f = fakeBot(); f.world.set('10,64,-3', STONE)
  f.finishDig(P); const seq = f.lastSeq()
  f.client.emit('map_chunk', { x: 0, z: -1 })      // x 10 -> chunk 0, z -3 -> chunk -1
  f.client.emit('acknowledge_player_digging', { sequenceId: seq })
  assert.equal(f.at(P), AIR); assert.equal(f.rollbacks.length, 0)
})
await t('BACKSTOP: no ack at all -> restored after the backstop, marked as such', async () => {
  const f = fakeBot({ backstopMs: 40, tickMs: 10 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); await sleep(90)
  assert.equal(f.at(P), STONE); assert.equal(f.rollbacks[0]?.why, 'backstop'); assert.equal(f.ds.counts.backstop, 1)
  f.bot.emit('end')
})
await t('player_loaded is sent on EVERY spawn (join and respawn) on 1.21.4+, and never on older protocols', () => {
  const f = fakeBot(); f.bot.emit('spawn'); f.bot.emit('spawn')
  assert.equal(f.sent.filter(s => s.name === 'player_loaded').length, 2)
  const old = fakeBot({ version: '1.21.1' }); old.bot.emit('spawn')
  assert.equal(old.sent.filter(s => s.name === 'player_loaded').length, 0)
})
await t('ledger: a repeat prediction at one position keeps the FIRST prior (the state the server may still hold)', () => {
  const l = new PredictionLedger({ graceMs: 0 })   // CONTRACT CHANGE (v2): ack() returns { settled, graced }
  l.predict(P, 5, STONE, 0); l.predict(P, 9, AIR + 7, 1)
  assert.deepEqual(l.ack(9, 2).settled.map(s => s.target), [STONE])
})
await t('WIRED: index.mjs attaches digsync to the bot (comments stripped)', () => {
  const src = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(src, /bot\.digSync\s*=\s*attachDigSync\(bot,/)
})
await t('WIRED: the SIGTERM/SIGINT handler writes the final totals BEFORE it closes the logs', () => {
  const src = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const h = src.slice(src.indexOf("for (const sig of ['SIGINT', 'SIGTERM'])"))
  const a = h.indexOf('digSyncFinal?.()'), b = h.indexOf('closeLogs()')
  assert.ok(a > 0 && b > 0 && a < b, `final row at ${a}, closeLogs at ${b}`)
})
// CONTRACT CHANGE (v2): a refused dig answers at grace expiry, so the refused case injects a short grace.
await t('waitSettled: the server\'s word for a refused dig, an accepted one, nothing pending, and a timeout', async () => {
  const f = fakeBot({ graceMs: 40, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); const w1 = f.ds.waitSettled(P, 500)
  f.client.emit('acknowledge_player_digging', { sequenceId: f.lastSeq() })
  assert.deepEqual(await w1, { broken: false, pending: false, why: 'grace-expired' })
  f.world.set('10,64,-3', STONE); f.finishDig(P); const w2 = f.ds.waitSettled(P, 500)
  f.client.emit('block_change', { location: P, type: AIR }); f.world.set('10,64,-3', AIR)
  f.client.emit('acknowledge_player_digging', { sequenceId: f.lastSeq() })
  assert.deepEqual(await w2, { broken: true, pending: false, why: 'server' })
  assert.deepEqual(await f.ds.waitSettled(new Vec3(99, 1, 99), 500), { broken: null, pending: false, why: 'none' })
  f.world.set('10,64,-3', STONE); f.finishDig(P)
  assert.deepEqual(await f.ds.waitSettled(P, 15), { broken: null, pending: true, why: 'timeout' })
  const ac = new AbortController(); const w4 = f.ds.waitSettled(P, 5000, ac.signal); ac.abort()
  assert.deepEqual(await w4, { broken: null, pending: true, why: 'aborted' }, 'an abort answers at once')
  f.bot.emit('end')
})
await t('waitSettled DEFAULT timeout covers the worst-case settlement (backstop + grace + two ticks): a refused dig answers broken:false, never pending', async () => {
  const f = fakeBot({ graceMs: 120, tickMs: 10 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); const w = f.ds.waitSettled(P)
  await sleep(60); f.ack()                         // a slow ack: 60 ms, then the full grace
  assert.deepEqual(await w, { broken: false, pending: false, why: 'grace-expired' })
  assert.ok(f.ds.settleBoundMs >= BACKSTOP_MS + 120 + 2 * 10, `settleBoundMs ${f.ds.settleBoundMs}`)
  f.bot.emit('end')
})
// CONTRACT CHANGE (v2): restores happen at grace expiry, so each ack is followed by a wait past the grace.
await t('a restore the server contradicts with AIR soon after counts as a FALSE restore; repeats at one position are counted', async () => {
  const f = fakeBot({ graceMs: 20, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); f.ack(); await sleep(45)
  f.finishDig(P); f.ack(); await sleep(45)
  assert.equal(f.ds.counts.repeatMax, 2)
  f.client.emit('block_change', { location: P, type: AIR })
  assert.equal(f.ds.counts.falseRestore, 1); assert.equal(f.ds.counts.lateAirLt2s, 1)
  f.bot.emit('end')
})
await t('a RE-DIG after a restore is the bot\'s own new dig: its AIR is not a false restore (positive control above)', async () => {
  const f = fakeBot({ graceMs: 20, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); f.ack(); await sleep(45)
  assert.equal(f.ds.counts.rolledBack, 1, 'the restore this test is about')
  f.finishDig(P)                                     // dig it again; the server breaks it this time
  f.say(P, AIR); f.ack()
  assert.equal(f.ds.counts.falseRestore, 0); assert.equal(f.ds.counts.confirmed, 1)
  f.bot.emit('end')
})
await t('late AIR after a restore is bucketed by delay (<2s, <5s, <10s) and ignored beyond FALSE_RESTORE_MS', async () => {
  assert.equal(FALSE_RESTORE_MS, 10_000)
  const out = []
  for (const late of [3000, 7000, 12_000]) {
    let clock = 1_000_000
    const f = fakeBot({ graceMs: 50, tickMs: 5, now: () => clock }); f.world.set('10,64,-3', STONE)
    f.finishDig(P); f.ack(); clock += 50; await sleep(20)
    assert.equal(f.ds.counts.rolledBack, 1, 'positive control: the restore happened')
    clock += late; f.client.emit('block_change', { location: P, type: AIR })
    out.push([f.ds.counts.lateAirLt2s, f.ds.counts.lateAirLt5s, f.ds.counts.lateAirLt10s, f.ds.counts.falseRestore])
    f.bot.emit('end')
  }
  assert.deepEqual(out, [[0, 1, 0, 1], [0, 0, 1, 1], [0, 0, 0, 0]])
})
await t('the packet path NEVER throws: a world model that throws during the grace costs the bookkeeping, not the handler', async () => {
  const f = fakeBot({ graceMs: 20, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); f.ack()
  f.bot.blockAt = () => { throw new Error('world not ready') }
  f.client.emit('block_change', { location: P, type: AIR })
  f.client.emit('multi_block_change', { chunkCoordinates: null, records: [1n] })
  f.client.emit('acknowledge_player_digging', { sequenceId: 99 })
  await sleep(30)
  f.bot.emit('end')
})
await t('the write wrapper NEVER throws: a broken world model costs the prediction, not the packet', () => {
  const f = fakeBot(); f.bot.blockAt = () => { throw new Error('world not ready') }
  f.client.write('block_dig', { status: 2, location: { x: 1, y: 2, z: 3 }, face: 1 })
  assert.equal(f.sent.at(-1).name, 'block_dig'); assert.equal(f.ds.counts.predictFailed, 1)
})
await t('no sequence wrap: an old high ack cannot settle a new low sequence', () => {
  const l = new PredictionLedger(); l.seq = 0x3fffffff
  assert.equal(l.nextSeq(), 0x40000000)
})
await t('player_loaded is decided AT SPAWN: a registry that appears after attach still gets it', () => {
  const reg = fakeBot().bot.registry   // a 1.21.8 registry
  // attach to a bot with NO registry yet (an auto-detected version), then let it appear before the first spawn
  const bot2 = new EventEmitter(); const c2 = new EventEmitter(); const sent2 = []; c2.write = (n, pr) => sent2.push(n); bot2._client = c2
  attachDigSync(bot2); bot2.registry = reg; bot2.emit('spawn')
  assert.equal(sent2.filter(n => n === 'player_loaded').length, 1)
})

// ---- collectManually through the REAL digsync: the delayed-destroy case the Claude review found, now the grace's ----
// CONTRACT CHANGE (v2): v1 faked waitSettled and collectManually slept 600 ms more after a restore. The grace owns the
// delayed destroy now, so these drive collectManually through attachDigSync itself (the refusal CHAIN, not one guard).
const { collectManually } = await import('../src/skills.mjs')
function manualBot ({ serverSays = null, afterAckMs = 0, graceMs = 60, ackAtMs = 10, backstopMs, restoreThrows = false, script = null, predictReadThrows = false, predictReadNull = false }) {
  const NAMES = { [STONE]: 'stone' }
  const world = new Map([['6,64,0', STONE]])
  const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`
  const bot = new EventEmitter(); const client = new EventEmitter(); let seq = null
  // unloaded: the column is gone from the world model (blockAt -> null, as prismarine-world answers for an unloaded chunk).
  // failNextRead: digsync's read of the prior at STOP throws once (predictFailed), every other read works.
  // nullNextRead: digsync's read of the prior at STOP returns null WITHOUT throwing (an unloaded column), once.
  const ctl = { unloaded: false, failNextRead: false, nullNextRead: false }
  client.write = (name, params) => { if (name === 'block_dig') seq = params.sequence }
  bot._client = client
  Object.assign(bot, {
    entity: { position: new Vec3(5.5, 64, 0.5) }, heldItem: null, targetDigBlock: null, gatherMovements: { canDig: true },
    blockAt: p => { if (ctl.failNextRead) { ctl.failNextRead = false; throw new Error('world not ready') } if (ctl.nullNextRead) { ctl.nullNextRead = false; return null } if (ctl.unloaded) return null; const id = world.get(key(p)) ?? AIR; const pos = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); return id ? { name: NAMES[id], stateId: id, position: pos, diggable: true, boundingBox: 'block' } : { name: 'air', stateId: AIR, position: pos, diggable: false, boundingBox: 'empty' } },
    // restoreThrows: the world model refuses digsync's write (an unloaded column, a prismarine error). mineflayer's own
    // optimistic air write in dig() below goes straight to the world, so only digsync's restore is affected.
    _updateBlockState: (p, st) => { if (restoreThrows) throw new Error('column not loaded'); world.set(key(p), st) },
    canDigBlock: b => !!b && b.name !== 'air', inventory: { items: () => [] }, equip: async () => {},
    // mineflayer's finishDigging: STOP, then the optimistic local air. The server acks 10 ms later, and maybe speaks.
    dig: async b => {
      if (predictReadThrows) ctl.failNextRead = true
      if (predictReadNull) ctl.nullNextRead = true
      bot._client.write('block_dig', { status: 2, location: b.position, face: 1, sequence: 0 }); world.set(key(b.position), AIR)
      if (script) { setTimeout(() => script({ client, world, ctl, pos: b.position, seq, k: key(b.position) }), 10); return }
      if (ackAtMs == null) return                    // the ack never comes
      setTimeout(() => {
        client.emit('acknowledge_player_digging', { sequenceId: seq })
        if (serverSays != null) setTimeout(() => { client.emit('block_change', { location: b.position, type: serverSays }); world.set(key(b.position), serverSays) }, afterAckMs)
      }, ackAtMs)
    },
    stopDigging: () => {}, nearestEntity: () => null, withGatherMovements: async fn => fn(),
    pathfinder: { movements: { canDig: true }, stop: () => {}, goto: async () => {}, getPathFromTo: () => ({ next: () => ({ value: { result: { status: 'success', path: [] } } }) }) },
  })
  const rollbacks = []
  bot.digSync = attachDigSync(bot, { graceMs, tickMs: 5, onRollback: r => rollbacks.push(r), ...(backstopMs ? { backstopMs } : {}) })
  return { bot, rollbacks, target: bot.blockAt(new Vec3(6, 64, 0)), done: () => bot.emit('end') }
}
await t('collectManually: a REFUSED dig (no word for the whole grace, restored) is dig_unconfirmed', async () => {
  const m = manualBot({})
  await assert.rejects(collectManually(m.bot, m.target, new AbortController().signal), e => e.failClass === 'dig_unconfirmed')
  assert.equal(m.rollbacks.length, 1); m.done()
})
// The grace is 500 ms so the bound DISCRIMINATES (Claude second pass): answering on the word takes ~40 ms, waiting out
// the grace takes >= 510. With a 60 ms grace both fit under the old bound and the test could not fail.
await t('collectManually: a DELAYED destroy (air 30 ms after the ack, inside the grace) is collected, never restored', async () => {
  const m = manualBot({ serverSays: AIR, afterAckMs: 30, graceMs: 500 })
  const t0 = Date.now()
  await collectManually(m.bot, m.target, new AbortController().signal)
  assert.equal(m.rollbacks.length, 0)
  assert.ok(Date.now() - t0 < 300, `took ${Date.now() - t0} ms: it waited out the grace instead of answering on the word`)
  m.done()
})
await t('collectManually: the server REFUSES with an explicit STONE during the grace -> dig_unconfirmed without waiting out the grace', async () => {
  const m = manualBot({ serverSays: STONE, afterAckMs: 5, graceMs: 500 })
  const t0 = Date.now()
  await assert.rejects(collectManually(m.bot, m.target, new AbortController().signal), e => e.failClass === 'dig_unconfirmed')
  assert.ok(Date.now() - t0 < 300, `took ${Date.now() - t0} ms`); m.done()
})

// ---- Codex review of ede3b83: four ways an UNKNOWN outcome was reported as a known one ----
// [P1] collectManually must never take mineflayer's predicted AIR as evidence. The timings make the wait the old
// default (grace + tick + 1000) shorter than the settlement: backstop 1500 > 30+5+1000; a late ack at 1200 with a
// 600 ms grace ends at 1800 > 600+5+1000.
await t('[P1] collectManually: NO ACK ever -> not a harvest (the backstop restores it; predicted air is not evidence)', async () => {
  const m = manualBot({ ackAtMs: null, graceMs: 30, backstopMs: 1500 })
  await assert.rejects(collectManually(m.bot, m.target, new AbortController().signal), e => e.failClass === 'dig_unconfirmed')
  m.done()
})
await t('[P1] collectManually: a LATE ack and then silence -> not a harvest (it waits for the grace the late ack opened)', async () => {
  const m = manualBot({ ackAtMs: 1200, graceMs: 600, backstopMs: 1500 })
  await assert.rejects(collectManually(m.bot, m.target, new AbortController().signal), e => e.failClass === 'dig_unconfirmed')
  m.done()
})
await t('[P1] positive control: a LATE ack and then the server\'s AIR inside the grace IS a harvest', async () => {
  const m = manualBot({ ackAtMs: 1200, graceMs: 600, backstopMs: 1500, serverSays: AIR, afterAckMs: 500 })
  await collectManually(m.bot, m.target, new AbortController().signal)
  assert.equal(m.rollbacks.length, 0); m.done()
})
// [P2-a] mineflayer's dig() keeps the block object it was handed and sends STOP without re-reading the world, so a
// second STOP at a predicted position finds local AIR. It must still supersede the old prediction.
await t('[P1] a re-dig during the grace with local AIR supersedes the old grace: no stone restored before ITS ack', async () => {
  const f = fakeBot({ graceMs: 60, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); f.ack()
  assert.equal(f.at(P), AIR, 'the local state really is AIR at the re-dig')
  f.finishDig(P)                                       // second STOP, local AIR
  await sleep(90)                                      // past the FIRST grace
  assert.equal(f.at(P), AIR, 'the old grace restored stone under the new dig'); assert.equal(f.rollbacks.length, 0)
  assert.equal(f.ds.ledger.size, 1, 'the re-dig is pending, awaiting its own ack')
  f.ack(); await sleep(90)
  assert.equal(f.at(P), STONE, 'restored to the ORIGINAL prior'); assert.equal(f.rollbacks.length, 1)
  f.bot.emit('end')
})
await t('[P2] a waiter for the superseded dig is told UNKNOWN at the re-dig, not handed the replacement\'s outcome', async () => {
  const f = fakeBot({ graceMs: 60, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); const w = f.ds.waitSettled(P); f.ack()
  let got = null; w.then(r => { got = r })
  f.finishDig(P); await sleep(0)
  assert.deepEqual(got && { broken: got.broken, pending: got.pending, why: got.why }, { broken: null, pending: false, why: 'superseded' })
  f.say(P, AIR); f.ack()                               // the replacement is confirmed; the old waiter must not learn it
  f.bot.emit('end')
})
await t('[P2] a restore that could not be applied is UNKNOWN to the waiter (not broken:false)', async () => {
  const f = fakeBot({ graceMs: 20, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); const w = f.ds.waitSettled(P); f.ack()
  f.bot.blockAt = () => { throw new Error('world not ready') }
  const r = await w
  assert.deepEqual({ broken: r.broken, pending: r.pending, why: r.why }, { broken: null, pending: false, why: 'restore-failed' })
  f.bot.emit('end')
})
await t('[P2] collectManually: a refused dig whose restore FAILED (local still AIR) is not a harvest', async () => {
  const m = manualBot({ restoreThrows: true })
  await assert.rejects(collectManually(m.bot, m.target, new AbortController().signal), e => /dig_unsettled/.test(e.message))
  m.done()
})

// ---- second-pass reviews of 35dd656 ----
await t('[C1] a server word that came BEFORE a re-dig describes the state before it: the re-dig is a fresh prediction, not settled by it', async () => {
  const f = fakeBot({ graceMs: 150, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); const seq1 = f.lastSeq()
  f.say(P, STONE)                                      // dig #1 refused, word before its ack
  f.finishDig(P)                                       // the bot digs again; this one is a delayed destroy
  f.client.emit('acknowledge_player_digging', { sequenceId: seq1 })
  f.ack()                                              // ack #2 outruns its air
  assert.equal(f.at(P), AIR, 'dig #2 settled at its ack on dig #1\'s STONE word (the v1 false restore)')
  await sleep(30); f.say(P, AIR)
  await sleep(200)
  assert.equal(f.at(P), AIR); assert.equal(f.ds.counts.graceAir, 1); assert.equal(f.rollbacks.length, 0)
  f.bot.emit('end')
})
await t('[C1] a superseded server word becomes the prior: a refused re-dig restores what the server last said', async () => {
  const f = fakeBot({ graceMs: 30, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); f.say(P, 7)                          // the server says the block is now state 7
  f.finishDig(P); f.ack(); await sleep(60)
  assert.equal(f.at(P), 7, 'restored the stale pre-word prior instead of the server\'s last word')
  f.bot.emit('end')
})
await t('[C2] a non-air SERVER settlement contradicted by AIR within 10 s is counted and bucketed (re-digs excluded)', async () => {
  const f = fakeBot({ graceMs: 150, tickMs: 5 }); f.world.set('10,64,-3', STONE)
  f.finishDig(P); f.say(P, STONE); f.ack()             // settled 'server', not broken
  assert.equal(f.ds.counts.serverNonAir, 1)
  f.say(P, AIR)                                        // ...and then the server breaks it after all
  assert.equal(f.ds.counts.airAfterServerWord, 1); assert.equal(f.ds.counts.airAfterWordLt2s, 1)
  // exclusion: a re-dig after the word is the bot's own dig
  const g = fakeBot({ graceMs: 150, tickMs: 5 }); g.world.set('10,64,-3', STONE)
  g.finishDig(P); g.say(P, STONE); g.ack()
  g.finishDig(P); g.say(P, AIR); g.ack()
  assert.equal(g.ds.counts.airAfterServerWord, 0); assert.equal(g.ds.counts.serverNonAir, 1, 'positive control: the word was counted')
  f.bot.emit('end'); g.bot.emit('end')
})
await t('[C2] the totals row carries the new counters (every key in counts)', () => {
  const f = fakeBot()
  for (const k of ['serverNonAir', 'airAfterServerWord', 'airAfterWordLt2s', 'airAfterWordLt5s', 'airAfterWordLt10s'])
    assert.ok(k in f.ds.counts, `${k} missing`)
  f.bot.emit('end')
})
await t('[X1] an UNLOADED column is unknown, not a harvest (blockAt is null afterwards)', async () => {
  const m = manualBot({ script: ({ client, ctl }) => { ctl.unloaded = true; client.emit('unload_chunk', { chunkX: 0, chunkZ: 0 }) } })
  await assert.rejects(collectManually(m.bot, m.target, new AbortController().signal), e => e.failClass === 'unverified')
  m.done()
})
await t('[X1] a REPLACED chunk is the truth: stone in it -> dig_unconfirmed; air in it -> collected', async () => {
  const a = manualBot({ script: ({ client, world, k }) => { world.set(k, STONE); client.emit('map_chunk', { x: 0, z: 0 }) } })
  await assert.rejects(collectManually(a.bot, a.target, new AbortController().signal), e => e.failClass === 'dig_unconfirmed')
  a.done()
  const b = manualBot({ script: ({ client, world, k }) => { world.set(k, AIR); client.emit('map_chunk', { x: 0, z: 0 }) } })
  await collectManually(b.bot, b.target, new AbortController().signal)
  b.done()
})
await t('[X1] a dig whose prediction FAILED is not accepted on mineflayer\'s optimistic air', async () => {
  const m = manualBot({ predictReadThrows: true, ackAtMs: null })
  await assert.rejects(collectManually(m.bot, m.target, new AbortController().signal), e => e.failClass === 'unverified')
  assert.equal(m.bot.digSync.counts.predictFailed, 1, 'positive control: the prediction really failed')
  m.done()
})

// ---- Codex third pass on 57adb5b ----
await t('[T1] a prior read that returns NULL at STOP (no throw) is unpredicted too: not accepted on optimistic air', async () => {
  const m = manualBot({ predictReadNull: true, ackAtMs: null })
  await assert.rejects(collectManually(m.bot, m.target, new AbortController().signal), e => e.failClass === 'unverified')
  assert.equal(m.bot.digSync.counts.predicted, 0, 'positive control: no prediction was made')
  assert.equal(m.bot.digSync.counts.predictFailed, 0, 'this is the NON-throwing path, distinct from predictFailed')
  m.done()
})
await t('[T1] waitSettled says unpredicted (not none) after a null prior read; a STOP over real AIR is still none', async () => {
  const f = fakeBot(); const realAt = f.bot.blockAt
  f.bot.blockAt = () => null
  f.client.write('block_dig', { status: 2, location: P, face: 1, sequence: 0 })
  f.bot.blockAt = realAt
  assert.equal((await f.ds.waitSettled(P)).why, 'unpredicted')
  const Q = new Vec3(1, 64, 1); f.world.set('1,64,1', AIR)
  f.client.write('block_dig', { status: 2, location: Q, face: 1, sequence: 0 })
  assert.equal((await f.ds.waitSettled(Q)).why, 'none', 'control: a known-AIR prior is not a missing read')
  f.bot.emit('end')
})

// ---- the mutant: GRACE 0 (v1's restore-at-the-ack) must fail the delayed-destroy test for the stated reason ----
await t('MUTANT KILLED: with the grace forced to 0 the delayed destroy is restored at the ack (the v1 false restore)', async () => {
  const path = new URL('../src/digsync.mjs', import.meta.url)
  const src = readFileSync(path, 'utf8')
  const old = 'const ledger = new PredictionLedger({ graceMs })'
  assert.ok(src.includes(old), 'ANCHOR MISSING: a mutant that was never written reads as killed')
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-digsync-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, 'const ledger = new PredictionLedger({ graceMs: 0 })'))
  try {
    const mod = await import(out.href)
    const { f, right_after_ack } = await delayedDestroy(mod.attachDigSync)
    assert.equal(right_after_ack, STONE, 'the mutant did not restore at the ack, so it does not reproduce v1')
    assert.equal(f.rollbacks.length, 1); assert.equal(f.ds.counts.graceAir, 0)
    assert.equal(f.ds.counts.falseRestore, 1, 'the late air contradicts the mutant\'s restore')
  } finally { try { unlinkSync(out) } catch {} }
})

assert.ok(BACKSTOP_MS >= 3000, 'the backstop must outlast a normal confirmation (~0.9 s) with margin')
assert.ok(GRACE_MS >= 2000, 'the grace must outlast the measured ack->air delay (92 of 92 false restores were contradicted within 2 s)')
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
