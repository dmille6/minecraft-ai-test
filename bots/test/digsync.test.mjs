// GHOST BLOCKS: the prediction ledger and its wiring, driven through a fake client exactly as mineflayer drives the
// real one (finishDigging: write STOP, then _updateBlockState(pos, 0)). See src/digsync.mjs for the measurements.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
const { attachDigSync, PredictionLedger, decodeSectionRecord, BACKSTOP_MS } = await import('../src/digsync.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const STONE = 1, AIR = 0

function fakeBot ({ version = '1.21.8', backstopMs, tickMs } = {}) {
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
  const ds = attachDigSync(bot, { onRollback: r => rollbacks.push(r), ...(backstopMs ? { backstopMs } : {}), ...(tickMs ? { tickMs } : {}) })
  // mineflayer's finishDigging, as it is: STOP then the local air write.
  const finishDig = pos => { client.write('block_dig', { status: 2, location: pos, face: 1, sequence: 0 }); bot._updateBlockState(pos, AIR) }
  const lastSeq = () => sent.at(-1).params.sequence
  return { bot, client, world, sent, rollbacks, ds, finishDig, lastSeq, at: p => world.get(k(p)) }
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
await t('REJECTED dig: an ack with no server word restores the block the bot believed it broke', () => {
  const f = fakeBot(); f.world.set('10,64,-3', STONE)
  f.finishDig(P); assert.equal(f.at(P), AIR, 'mineflayer wrote the ghost')
  f.client.emit('acknowledge_player_digging', { sequenceId: f.lastSeq() })
  assert.equal(f.at(P), STONE); assert.equal(f.rollbacks.length, 1); assert.equal(f.rollbacks[0].why, 'ack')
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
await t('DELAYED destroy: restored at the ack, then the late server air is simply applied (converges to the truth)', () => {
  const f = fakeBot(); f.world.set('10,64,-3', STONE)
  f.finishDig(P); f.client.emit('acknowledge_player_digging', { sequenceId: f.lastSeq() })
  assert.equal(f.at(P), STONE)
  f.client.emit('block_change', { location: P, type: AIR }); f.world.set('10,64,-3', AIR)   // Paper breaks it ~0.9 s later
  assert.equal(f.at(P), AIR); assert.equal(f.ds.ledger.size, 0, 'nothing left pending to fight the server')
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
  const l = new PredictionLedger()
  l.predict(P, 5, STONE, 0); l.predict(P, 9, AIR + 7, 1)
  assert.deepEqual(l.ack(9, 2).map(s => s.target), [STONE])
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
await t('waitSettled: the server\'s word for a refused dig, an accepted one, nothing pending, and a timeout', async () => {
  const f = fakeBot(); f.world.set('10,64,-3', STONE)
  f.finishDig(P); const w1 = f.ds.waitSettled(P, 500)
  f.client.emit('acknowledge_player_digging', { sequenceId: f.lastSeq() })
  assert.deepEqual(await w1, { broken: false, pending: false })
  f.world.set('10,64,-3', STONE); f.finishDig(P); const w2 = f.ds.waitSettled(P, 500)
  f.client.emit('block_change', { location: P, type: AIR }); f.world.set('10,64,-3', AIR)
  f.client.emit('acknowledge_player_digging', { sequenceId: f.lastSeq() })
  assert.deepEqual(await w2, { broken: true, pending: false })
  assert.deepEqual(await f.ds.waitSettled(new Vec3(99, 1, 99), 500), { broken: null, pending: false })
  f.world.set('10,64,-3', STONE); f.finishDig(P)
  assert.deepEqual(await f.ds.waitSettled(P, 30), { broken: null, pending: true })
})
await t('a restore the server contradicts with AIR soon after counts as a FALSE restore; repeats at one position are counted', () => {
  const f = fakeBot(); f.world.set('10,64,-3', STONE)
  f.finishDig(P); f.client.emit('acknowledge_player_digging', { sequenceId: f.lastSeq() })
  f.finishDig(P); f.client.emit('acknowledge_player_digging', { sequenceId: f.lastSeq() })
  assert.equal(f.ds.counts.repeatMax, 2)
  f.client.emit('block_change', { location: P, type: AIR })
  assert.equal(f.ds.counts.falseRestore, 1)
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

// ---- collectManually through digsync: the delayed-destroy case the Claude review found ----
const { collectManually } = await import('../src/skills.mjs')
function manualBot ({ serverBreaksAtMs }) {
  const world = new Map([['6,64,0', 'stone']])
  const bot = new EventEmitter()
  const at = { x: 5, y: 64, z: 0 }
  Object.assign(bot, {
    entity: { position: new Vec3(5.5, 64, 0.5) }, heldItem: null, targetDigBlock: null, gatherMovements: { canDig: true },
    blockAt: p => { const n = world.get(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`); return n ? { name: n, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), diggable: true, boundingBox: 'block' } : { name: 'air', position: p, diggable: false, boundingBox: 'empty' } },
    canDigBlock: b => !!b && b.name !== 'air', inventory: { items: () => [] }, equip: async () => {},
    dig: async () => { world.delete('6,64,0') },                // mineflayer's optimistic local air
    stopDigging: () => {}, nearestEntity: () => null, withGatherMovements: async fn => fn(),
    pathfinder: { movements: { canDig: true }, stop: () => {}, goto: async () => {}, getPathFromTo: () => ({ next: () => ({ value: { result: { status: 'success', path: [] } } }) }) },
    digSync: { waitSettled: () => new Promise(r => setTimeout(() => {
      world.set('6,64,0', 'stone')                               // the ack came with no server word: restored
      if (serverBreaksAtMs != null) setTimeout(() => world.delete('6,64,0'), serverBreaksAtMs)
      r({ broken: false, pending: false })
    }, 40)) },
  })
  return { bot, target: bot.blockAt(new Vec3(6, 64, 0)) }
}
await t('collectManually: a REFUSED dig (restored, never broken) is dig_unconfirmed', async () => {
  const { bot, target } = manualBot({ serverBreaksAtMs: null })
  await assert.rejects(collectManually(bot, target, new AbortController().signal), e => e.failClass === 'dig_unconfirmed')
})
await t('collectManually: a DELAYED destroy (restored at the ack, broken 300 ms later) is NOT walked away from', async () => {
  const { bot, target } = manualBot({ serverBreaksAtMs: 300 })
  await collectManually(bot, target, new AbortController().signal)
})

assert.ok(BACKSTOP_MS >= 3000, 'the backstop must outlast a normal confirmation (~0.9 s) with margin')
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
