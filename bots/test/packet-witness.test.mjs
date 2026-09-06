// THE COUNTERS THAT SEPARATE "WRONG MAP" FROM "SERVER HOLDING THE BOT STILL".
//
// The first attempt at this diagnosis used `onGround` as the discriminator and
// was retracted: mineflayer's physics.js:418 sets `bot.entity.onGround = false`
// unconditionally on EVERY inbound position packet, with no reference to the
// world cache, so it is consistent with both explanations at once.
//
// These two are not confounded, because neither is derived from the block cache:
//   posPackets    the server pushing the bot around (a bare client measured 0)
//   physicsTicks  our own physics loop running at all (physics.js:81 returns
//                 early and SILENTLY when the bot's own chunk is not loaded)
import assert from 'node:assert'
import fsmod from 'node:fs'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { RollingCount, attachPacketWitness } from '../src/packet-witness.mjs'

test('POSITIVE CONTROL: the counter can report both zero and non-zero', () => {
  // Without this every assertion below could pass because it always said 0.
  const c = new RollingCount({ windowMs: 1000, buckets: 10 })
  assert.equal(c.count(10_000), 0)
  c.bump(10_000)
  assert.equal(c.count(10_000), 1)
})

test('it counts only inside the window', () => {
  const c = new RollingCount({ windowMs: 1000, buckets: 10 })
  for (let i = 0; i < 5; i++) c.bump(10_000 + i * 10)
  assert.equal(c.count(10_050), 5, 'all five are recent')
  assert.equal(c.count(11_500), 0, 'and all five have aged out')
})

test('a stale bucket resets rather than adding to a previous lap', () => {
  // The ring reuses slots. Without the staleness check a count from one lap
  // would be added to the next, inventing traffic that never happened — an
  // instrument that over-reports is as bad as one that under-reports.
  const c = new RollingCount({ windowMs: 1000, buckets: 10 })
  c.bump(10_000)
  c.bump(11_000)          // same slot index, one full window later
  assert.equal(c.count(11_000), 1, 'the old lap must not be counted')
})

test('memory is bounded — it must not become the thing it measures', () => {
  const c = new RollingCount({ windowMs: 1000, buckets: 8 })
  for (let i = 0; i < 50_000; i++) c.bump(10_000 + i)
  assert.equal(c.slots.length, 8)
  assert.equal(c.stamps.length, 8)
})

function fakeBot () {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  return bot
}

test('THE DISCRIMINATOR: position packets and physics ticks are counted apart', () => {
  const bot = fakeBot()
  const read = attachPacketWitness(bot)
  assert.deepEqual([read().posPackets, read().physicsTicks], [0, 0],
    'POSITIVE CONTROL: it starts at zero, so a later non-zero means something')

  for (let i = 0; i < 7; i++) bot._client.emit('packet', {}, { name: 'position' })
  for (let i = 0; i < 3; i++) bot.emit('physicsTick')
  const w = read()
  assert.equal(w.posPackets, 7, 'server position packets')
  assert.equal(w.physicsTicks, 3, 'our own physics loop')
  assert.equal(w.posTotal, 7)
  assert.equal(w.physTotal, 3)
})

test('the four readings the fleet needs to tell apart', () => {
  // Each row is a state the stuck bots could be in. The point of the counters
  // is that these are four DIFFERENT readings, where `onGround` gave one.
  const cases = [
    { name: 'server stomping position', pos: 200, phys: 200, expect: 'stomp' },
    { name: 'physics silently disabled', pos: 0, phys: 0, expect: 'nophys' },
    { name: 'healthy — the cache story stands', pos: 0, phys: 200, expect: 'cache' },
    { name: 'both, which is its own answer', pos: 200, phys: 0, expect: 'stomp' },
  ]
  for (const c of cases) {
    const bot = fakeBot(); const read = attachPacketWitness(bot)
    for (let i = 0; i < c.pos; i++) bot._client.emit('packet', {}, { name: 'position' })
    for (let i = 0; i < c.phys; i++) bot.emit('physicsTick')
    const w = read()
    const reading = w.posPackets > 20 ? 'stomp' : (w.physicsTicks < 20 ? 'nophys' : 'cache')
    assert.equal(reading, c.expect, `${c.name}: pos=${w.posPackets} phys=${w.physicsTicks}`)
  }
})

test('a rename cannot silently zero the instrument', () => {
  // Named handlers would go quiet on a protocol rename and read as "no traffic".
  // Both spellings must count, and an unrelated packet must not.
  const bot = fakeBot(); const read = attachPacketWitness(bot)
  bot._client.emit('packet', {}, { name: 'position' })
  bot._client.emit('packet', {}, { name: 'player_position' })
  bot._client.emit('packet', {}, { name: 'keep_alive' })
  assert.equal(read().posPackets, 2)
  bot._client.emit('packet', {}, { name: 'block_change' })
  bot._client.emit('packet', {}, { name: 'multi_block_change' })
  assert.equal(read().blockChanges, 2)
})

test('instrumentation must never break the packet path or startup', () => {
  // It runs on 80 bots' sockets. A throw here would take the fleet down, and a
  // bot whose client is not ready must not fail to start.
  const bot = fakeBot(); const read = attachPacketWitness(bot)
  assert.doesNotThrow(() => bot._client.emit('packet', null, null))
  assert.doesNotThrow(() => bot._client.emit('packet', {}, {}))
  assert.equal(typeof read().posPackets, 'number')
  assert.doesNotThrow(() => attachPacketWitness({}), 'no _client at all')
  assert.doesNotThrow(() => attachPacketWitness(undefined))
})

test('WIRED IN: the lattice logs the counters, and ABSENT never reads as zero', () => {
  const fs = fsmod
  const raw = fs.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
  assert.match(code, /function witnessText/, 'POSITIVE CONTROL: the helper survives stripping')
  const i = code.indexOf("kind: 'escape_lattice'")
  assert.ok(i > 0, 'POSITIVE CONTROL: the lattice event is still there')
  assert.match(code.slice(i, i + 500), /witnessText\(bot\)/,
    'the lattice event must carry the counters')
  assert.match(code, /posPkts=absent physTicks=absent/,
    'an unattached witness must log ABSENT — a zero meaning "not measured" is ' +
    'the exact failure ZeroLooksWrong exists to stop')

  const idx = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8')
  assert.match(idx, /bot\.packetWitness = attachPacketWitness\(bot\)/,
    'and it must actually be attached, or every reading is ABSENT forever')
})
