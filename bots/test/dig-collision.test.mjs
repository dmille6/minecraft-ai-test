// The recorder must see EVERY cancelled dig and change nothing.
//
// v1 wrapped bot.dig and was blind: deployed as digwatch-01, the canary logged
// three gather runs ending "Digging aborted" and zero collision rows in eleven
// minutes. Wrapping dig() catches only the cancellation dig() does on its own
// first line for a NEW dig request; the fleet's aborts come from direct
// bot.stopDigging() calls in our own timeout handlers, which that never sees.
//
// v2 listens for mineflayer's diggingAborted, which stopDigging emits
// SYNCHRONOUSLY -- so the listener's stack still holds whoever called it.
import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { installDigCollisionWatch } from '../src/digcollision.mjs'

const blk = (name, x = 1, y = 2, z = 3) => ({ name, position: { x, y, z } })

test('THE v1 BLIND SPOT: a direct stopDigging is recorded', () => {
  const bot = new EventEmitter(); const rows = []
  installDigCollisionWatch(bot, r => rows.push(r))
  // what skills.mjs:1204's onTimeout does -- no dig() call is involved
  bot.emit('diggingAborted', blk('cobblestone', 4, 5, 6))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'dig_collision')
  assert.match(rows[0].detail, /cobblestone@4,5,6 cancelled/)
})

test('the row names the CALLER, which is the whole point', () => {
  const bot = new EventEmitter(); const rows = []
  installDigCollisionWatch(bot, r => rows.push(r))
  const pretendTimeoutHandler = () => bot.emit('diggingAborted', blk('stone'))
  pretendTimeoutHandler()
  assert.match(rows[0].detail, /stopDigging called from dig-collision\.test\.mjs:\d+/)
})

test('it reports a CHAIN of frames, so one anonymous wrapper cannot hide the caller', () => {
  const bot = new EventEmitter(); const rows = []
  installDigCollisionWatch(bot, r => rows.push(r))
  const inner = () => bot.emit('diggingAborted', blk('dirt'))
  const outer = () => inner()
  outer()
  assert.match(rows[0].detail, / <- /)
})

test('no abort, no row', () => {
  const bot = new EventEmitter(); const rows = []
  installDigCollisionWatch(bot, r => rows.push(r))
  bot.emit('diggingCompleted', blk('oak_log'))
  assert.equal(rows.length, 0)
})

test('a missing block does not crash the recorder', () => {
  const bot = new EventEmitter(); const rows = []
  installDigCollisionWatch(bot, r => rows.push(r))
  bot.emit('diggingAborted', undefined)
  assert.equal(rows.length, 1)
  assert.match(rows[0].detail, /\?@\?/)
})

test('IT CHANGES NOTHING: bot.dig is never touched', () => {
  const bot = new EventEmitter(); const dig = async () => 'dug'
  bot.dig = dig
  installDigCollisionWatch(bot, () => {})
  assert.equal(bot.dig, dig, 'v1 replaced this; v2 must not')
})

test('IT CHANGES NOTHING: a throwing logger cannot break the abort path', () => {
  const bot = new EventEmitter()
  installDigCollisionWatch(bot, () => { throw new Error('logger exploded') })
  assert.doesNotThrow(() => bot.emit('diggingAborted', blk('stone')))
})

test('throttle suppresses a burst, and the first row always lands', () => {
  const bot = new EventEmitter(); const rows = []
  installDigCollisionWatch(bot, r => rows.push(r), { throttleMs: 60_000 })
  for (let i = 0; i < 5; i++) bot.emit('diggingAborted', blk('stone'))
  assert.equal(rows.length, 1)
})

test('uninstall removes the listener and leaves no others behind', () => {
  const bot = new EventEmitter(); const rows = []
  const off = installDigCollisionWatch(bot, r => rows.push(r))
  off()
  bot.emit('diggingAborted', blk('stone'))
  assert.equal(rows.length, 0)
  assert.equal(bot.listenerCount('diggingAborted'), 0)
})

test('a bot that cannot listen is left alone', () => {
  const off = installDigCollisionWatch({}, () => {})
  assert.equal(typeof off, 'function')
})
