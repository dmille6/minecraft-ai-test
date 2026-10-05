// craftsync's recount and lockstep OUTSIDE a craft (withdraw, 10-04): the server's bag, from an ANSWERED window-0
// resync, against the fake Paper server the craft tests use (test/helpers/fake-paper-craft.mjs) -- mineflayer 4.37.1's
// real inventory code on the client side.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as CS from '../src/craftsync.mjs'
import { FakePaper, craftBot, Item, id } from './helpers/fake-paper-craft.mjs'
import { INV } from './helpers/craftsync-trial.mjs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-recount-'))
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const setup = async () => {
  const server = new FakePaper({ lagClicks: 3, inventory: INV })
  const bot = craftBot(server)
  await server.sync()
  CS.installCraftSync(bot, { log: () => {} })
  return { server, bot }
}
const planks = items => items.filter(it => it.name === 'oak_planks').reduce((n, it) => n + it.count, 0)

await t('serverRecount: a local bag that disagrees with the server is replaced by the server\'s, from an answered resync', async () => {
  const { server, bot } = await setup()
  const slot = bot.inventory.slots.find(it => it?.name === 'oak_planks')
  slot.count = 50                                         // the client's belief drifts (a reverted click, a lost update)
  assert.equal(planks(bot.inventory.items()), 50, 'positive control: the local view is wrong')
  const r = await CS.serverRecount(bot, { deadline: Date.now() + 3000 })
  assert.equal(r.source, 'server')
  assert.equal(planks(r.items), 7, 'the server holds 7')
  await server.settle(); server.stop()
})

await t('serverRecount refuses while a window is open, and without craftsync says "none"', async () => {
  const { server, bot } = await setup()
  bot.currentWindow = { id: 3 }
  assert.equal((await CS.serverRecount(bot)).source, 'window_open')
  bot.currentWindow = null
  const plain = { inventory: { items: () => [] } }
  assert.equal((await CS.serverRecount(plain)).source, 'none')
  await server.settle(); server.stop()
})

await t('lockstepClicks: clicks go through craftsync\'s wrapper while it runs, and every wrapper is restored after', async () => {
  const { server, bot } = await setup()
  const before = { click: bot.clickWindow, write: bot._client.write }
  let seen = null
  await CS.lockstepClicks(bot, async click => { seen = bot.clickWindow; await click(36, 0, 0); await click(36, 0, 0) })
  assert.notEqual(seen, before.click, 'the lockstep wrapper was installed during the clicks')
  assert.equal(bot.clickWindow, before.click); assert.equal(bot._client.write, before.write)
  await server.settle(); server.stop()
})

/** An open table whose clone probe (mode 3) the server answers with `carried` (a notch object) as the cursor. */
const probed = async (carried, { onProbe = () => {}, closeWithAnswer = false } = {}) => {
  const { server, bot } = await setup()
  server.openTable(); await server.settle()
  const win = bot.currentWindow
  assert.ok(win, 'positive control: the table opened')
  const write = bot._client.write
  bot._client.write = (name, p) => {
    if (name === 'window_click' && p.mode === 3) {
      onProbe()
      server.send([['window_items', { windowId: win.id, stateId: 99, items: server.slotsOf(win.id).map(it => Item.toNotch(it ?? null)), carriedItem: carried }],
                   ...(closeWithAnswer ? [['close_window', { windowId: win.id }]] : [])])
      return
    }
    return write(name, p)
  }
  return { server, bot, win }
}

await t('K. confirmCursor applies the COMPLETE carried item: same count, different item -> the local cursor becomes the server\'s', async () => {
  const { server, bot, win } = await probed(Item.toNotch(new Item(id('stick'), 5)))
  win.selectedItem = new Item(id('stone'), 5)                       // a stale local cursor: right count, wrong item
  const r = await CS.confirmCursor(bot, win, { deadline: Date.now() + 2000 })
  assert.equal(r.answered, true, r.why); assert.equal(r.cursorEmpty, false); assert.equal(r.decodeFailed, false)
  assert.equal(win.selectedItem?.name, 'stick'); assert.equal(win.selectedItem?.count, 5)
  await server.settle(); server.stop()
})

await t('K. confirmCursor: a carried item that cannot be decoded is UNRESOLVED, and the local cursor is left alone', async () => {
  const { server, bot, win } = await probed({ itemId: 999_999, itemCount: 3, components: [], removeComponents: [] })
  win.selectedItem = new Item(id('stone'), 5)
  const r = await CS.confirmCursor(bot, win, { deadline: Date.now() + 2000 })
  assert.equal(r.answered, true, r.why); assert.equal(r.cursorEmpty, false)
  assert.equal(r.decodeFailed, true, 'the decode failure is reported')
  assert.equal(win.selectedItem?.name, 'stone', 'nothing invented on the cursor')
  await server.settle(); server.stop()
})

await t('K. confirmCursor: an empty carried item clears the local cursor (control for the two above)', async () => {
  const { server, bot, win } = await probed(Item.toNotch(null))
  win.selectedItem = new Item(id('stone'), 5)
  const r = await CS.confirmCursor(bot, win, { deadline: Date.now() + 2000 })
  assert.equal(r.answered, true, r.why); assert.equal(r.cursorEmpty, true)
  assert.equal(win.selectedItem ?? null, null)
  await server.settle(); server.stop()
})

await t('I. confirmCursor: the window closing WITH the answer -- the answer is not applied to a window that is gone', async () => {
  const { server, bot, win } = await probed(Item.toNotch(new Item(id('stick'), 5)), { closeWithAnswer: true })
  win.selectedItem = new Item(id('stone'), 5)
  const r = await CS.confirmCursor(bot, win, { deadline: Date.now() + 2000 })
  assert.notEqual(bot.currentWindow, win, 'positive control: the window did close')
  assert.equal(r.answered, false, 'no evidence for a window that is gone')
  assert.equal(win.selectedItem?.name, 'stone')
  await server.settle(); server.stop()
})

await t('I. confirmCursor: a cancellation during the probe ends it unanswered, and nothing is applied', async () => {
  let cancel = false
  const { server, bot, win } = await probed(Item.toNotch(new Item(id('stick'), 5)), { onProbe: () => { cancel = true } })
  win.selectedItem = new Item(id('stone'), 5)
  const r = await CS.confirmCursor(bot, win, { deadline: Date.now() + 2000, cancelled: () => cancel })
  assert.equal(r.answered, false); assert.equal(r.why, 'cancelled')
  assert.equal(win.selectedItem?.name, 'stone')
  await server.settle(); server.stop()
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
