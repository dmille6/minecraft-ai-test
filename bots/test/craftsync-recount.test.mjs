// craftsync's recount and lockstep OUTSIDE a craft (withdraw, 10-04): the server's bag, from an ANSWERED window-0
// resync, against the fake Paper server the craft tests use (test/helpers/fake-paper-craft.mjs) -- mineflayer 4.37.1's
// real inventory code on the client side.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as CS from '../src/craftsync.mjs'
import { FakePaper, craftBot } from './helpers/fake-paper-craft.mjs'
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
