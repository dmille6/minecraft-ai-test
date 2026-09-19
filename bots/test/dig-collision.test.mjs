// The dig-collision recorder must see the collision, name both parties, and
// change nothing. Every case here is about that last clause as much as the first.
import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { installDigCollisionWatch } from '../src/digcollision.mjs'

const blk = (name, x = 1, y = 2, z = 3) => ({ name, position: { x, y, z } })

function fakeBot () {
  const bot = new EventEmitter()
  bot.targetDigBlock = null
  bot.digCalls = []
  bot.dig = async function (block, ...rest) {
    bot.digCalls.push([block, ...rest])
    bot.targetDigBlock = block
    return `dug:${block.name}`
  }
  return bot
}

test('no row when nothing was already being dug', () => {
  const bot = fakeBot(); const rows = []
  installDigCollisionWatch(bot, r => rows.push(r))
  bot.dig(blk('stone'))
  assert.equal(rows.length, 0)
})

test('THE COLLISION: a second dig while one is in flight writes one row', async () => {
  const bot = fakeBot(); const rows = []
  installDigCollisionWatch(bot, r => rows.push(r))
  await bot.dig(blk('oak_log', 5, 6, 7))     // incumbent; sets targetDigBlock
  await bot.dig(blk('cobblestone', 1, 2, 3)) // requester; cancels it
  assert.equal(rows.length, 1)
  const d = rows[0].detail
  assert.equal(rows[0].kind, 'dig_collision')
  assert.match(d, /oak_log@5,6,7 cancelled/)       // the victim, and where
  assert.match(d, /new dig of cobblestone@1,2,3/)  // the requester, and where
  assert.match(d, /incumbent asked by .+, requester .+/)
})

test('the row names a FILE:LINE for each party, not "unknown"', async () => {
  const bot = fakeBot(); const rows = []
  installDigCollisionWatch(bot, r => rows.push(r))
  await bot.dig(blk('oak_log')); await bot.dig(blk('stone'))
  assert.match(rows[0].detail, /requester dig-collision\.test\.mjs:\d+/)
})

test('a completed dig clears the incumbent, so the next dig is not a collision', async () => {
  const bot = fakeBot(); const rows = []
  installDigCollisionWatch(bot, r => rows.push(r))
  await bot.dig(blk('oak_log'))
  bot.emit('diggingCompleted', blk('oak_log'))
  bot.targetDigBlock = null
  await bot.dig(blk('stone'))
  assert.equal(rows.length, 0, 'a sequential dig is not a collision')
})

test('IT CHANGES NOTHING: arguments, return value and `this` all survive', async () => {
  const bot = fakeBot(); installDigCollisionWatch(bot, () => {})
  const b = blk('oak_log')
  const out = await bot.dig(b, true, 'top')
  assert.equal(out, 'dug:oak_log')
  assert.deepEqual(bot.digCalls[0], [b, true, 'top'])
})

test('IT CHANGES NOTHING: a rejection still rejects, unswallowed', async () => {
  const bot = fakeBot(); installDigCollisionWatch(bot, () => {})
  bot.dig = bot.dig.bind(bot)
  const boom = new EventEmitter()
  boom.targetDigBlock = null
  boom.dig = async () => { throw new Error('Digging aborted') }
  installDigCollisionWatch(boom, () => {})
  await assert.rejects(() => boom.dig(blk('stone')), /Digging aborted/)
})

test('a throwing logger cannot break the dig', async () => {
  const bot = fakeBot()
  installDigCollisionWatch(bot, () => { throw new Error('logger exploded') })
  await bot.dig(blk('oak_log'))
  assert.equal(await bot.dig(blk('stone')), 'dug:stone')
})

test('uninstall restores the original dig exactly', async () => {
  const bot = fakeBot(); const before = bot.dig
  const off = installDigCollisionWatch(bot, () => {})
  assert.notEqual(bot.dig, before)
  off()
  assert.equal(bot.dig, before)
})

test('a bot with no dig method is left alone', () => {
  const bot = new EventEmitter(); bot.dig = undefined
  const off = installDigCollisionWatch(bot, () => {})
  assert.equal(typeof off, 'function')
  assert.equal(bot.dig, undefined)
})

test('throttle suppresses a burst but the first row always lands', async () => {
  const bot = fakeBot(); const rows = []
  installDigCollisionWatch(bot, r => rows.push(r), { throttleMs: 60_000 })
  await bot.dig(blk('oak_log')); await bot.dig(blk('stone')); await bot.dig(blk('dirt'))
  assert.equal(rows.length, 1)
})

test('a FINISHED dig is never reported as the victim, even if targetDigBlock is stale', async () => {
  // Caught by a surviving mutant: the earlier "completed" case cleared
  // targetDigBlock by hand, so it passed on `victim` being null rather than on
  // the incumbent being cleared, and `onDone = () => {}` survived it. The guard
  // has two halves and each needs its own case. mineflayer normally clears the
  // field on completion; this asserts the recorder does not depend on that.
  const bot = fakeBot(); const rows = []
  installDigCollisionWatch(bot, r => rows.push(r))
  await bot.dig(blk('oak_log'))
  bot.emit('diggingCompleted', blk('oak_log'))   // finished, but field left set
  assert.ok(bot.targetDigBlock, 'precondition: the stale field is still set')
  await bot.dig(blk('stone'))
  assert.equal(rows.length, 0, 'a dig that already completed is not a collision')
})

test('after a completed dig, a REAL later collision still names the right incumbent', async () => {
  const bot = fakeBot(); const rows = []
  installDigCollisionWatch(bot, r => rows.push(r))
  await bot.dig(blk('oak_log'))
  bot.emit('diggingCompleted', blk('oak_log')); bot.targetDigBlock = null
  await bot.dig(blk('stone', 9, 9, 9))           // new incumbent
  await bot.dig(blk('dirt'))                     // collides with stone, not oak_log
  assert.equal(rows.length, 1)
  assert.match(rows[0].detail, /stone@9,9,9 cancelled/)
  assert.doesNotMatch(rows[0].detail, /oak_log@/)
})
