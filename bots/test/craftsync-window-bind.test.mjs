// A LATE CLICK MUST NOT LAND IN ANOTHER WINDOW (withdraw round 5, Codex P1). mineflayer 4.37.1's clickWindow sleeps
// out a dig cooldown BEFORE it reads `bot.currentWindow || bot.inventory`: a click issued for a crafting table that is
// closed during the sleep goes to window 0, and one whose table is replaced goes to the new window. Codex's two repros,
// here with mineflayer's REAL inventory plugin over the fake Paper server (test/helpers/fake-paper-craft.mjs):
// nothing may reach the server, and the local inventory mineflayer already changed must be repaired from the server.
// (The cooldown is forced by setting lastDigTime to a Date: 4.37.1's own digging sets it from performance.now(), and
// `new Date() - performance.now()` never falls under 500 ms -- so today the sleep is latent, not live.)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as CS from '../src/craftsync.mjs'
import { FakePaper, craftBot, registry } from './helpers/fake-paper-craft.mjs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-winbind-'))
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const nameOf = it => (it ? registry.items[it.type].name : null)
const desc = it => (it ? `${it.name ?? nameOf(it)}:${it.count}` : '-')

// Window 0 slot 37 is player slot 37 (gold); a table's slot 37 is player slot 36 (diamonds).
const setup = async () => {
  const server = new FakePaper({ lagClicks: 1, inventory: { 36: ['diamond', 5], 37: ['gold_ingot', 10], 9: ['dirt', 64] } })
  const bot = craftBot(server)
  await server.sync()
  const events = []
  CS.installCraftSync(bot, { log: e => events.push(e) })
  server.openTable(); await server.settle()
  assert.ok(bot.currentWindow, 'positive control: the table opened')
  return { server, bot, events, table: bot.currentWindow }
}
const clicksSent = (server, since) => server.writes.filter(x => x.t >= since && x.name === 'window_click' && x.params.mode === 0 && x.params.slot === 37)
/** A slot-37 click on the table, issued now, that waits out a dig cooldown inside mineflayer's click path. */
const lateClick = bot => {
  bot.lastDigTime = new Date()
  const p = CS.lockstepClicks(bot, click => click(37, 0, 0))
  p.catch(() => {})
  return p
}
const repaired = async events => { for (let i = 0; i < 300 && !events.some(e => e.event === 'click_drop_repair'); i++) await wait(10) }
const serverCloses = (server, bot, win) => { server.onClose({ windowId: win.id }); bot._client.emit('close_window', { windowId: win.id }) }

await t('P1-a. THE TABLE CLOSES during the cooldown: the click is not sent to window 0, and the local inventory is repaired', async () => {
  const { server, bot, events, table } = await setup()
  const t0 = Date.now()
  const p = lateClick(bot)
  await wait(100)
  serverCloses(server, bot, table)
  assert.equal(bot.currentWindow, null)
  await assert.rejects(p, /dropped: bound to window 1, written to window 0/)
  assert.equal(clicksSent(server, t0).length, 0, 'nothing reached the server')
  assert.equal(nameOf(server.p[37]), 'gold_ingot'); assert.equal(server.cursor, null)
  await repaired(events)
  assert.equal(desc(bot.inventory.slots[37]), 'gold_ingot:10', 'the local slot is the server\'s again')
  assert.equal(bot.inventory.selectedItem ?? null, null, 'and the local cursor is empty, as the server\'s is')
  assert.ok(events.some(e => e.event === 'click_drop_repair' && e.how === 'recount_server'), JSON.stringify(events.filter(e => e.event)))
  await server.settle(); server.stop()
})

await t('P1-a. A REPLACEMENT TABLE opens during the cooldown: the click is not sent to window 2, and that window is repaired', async () => {
  const { server, bot, events, table } = await setup()
  const t0 = Date.now()
  const p = lateClick(bot)
  await wait(100)
  serverCloses(server, bot, table)
  server.openTable(); await server.settle()
  const second = bot.currentWindow
  assert.equal(second?.id, 2, 'positive control: a second window is open')
  await assert.rejects(p, /dropped: bound to window 1, written to window 2/)
  assert.equal(clicksSent(server, t0).length, 0, 'nothing reached the server')
  assert.equal(nameOf(server.p[36]), 'diamond'); assert.equal(server.cursor, null)
  await repaired(events)
  assert.equal(desc(second.slots[37]), 'diamond:5', 'the replacement window\'s slot is the server\'s again')
  assert.equal(second.selectedItem ?? null, null)
  assert.ok(events.some(e => e.event === 'click_drop_repair' && e.how === 'window_probe'), JSON.stringify(events.filter(e => e.event)))
  await server.settle(); server.stop()
})

await t('P1-a. AN INVALIDATION during the cooldown drops the click on the SAME window; a click issued after it is sent', async () => {
  const { server, bot, events } = await setup()
  const t0 = Date.now()
  const p = lateClick(bot)
  await wait(100)
  assert.equal(CS.invalidateClicks(bot, 'test release'), 1, 'one live ticket')
  await assert.rejects(p, /dropped: invalidated \(test release\)/)
  assert.equal(clicksSent(server, t0).length, 0)
  await repaired(events)
  assert.equal(desc(bot.currentWindow.slots[37]), 'diamond:5'); assert.equal(bot.currentWindow.selectedItem ?? null, null)
  bot.lastDigTime = null
  await CS.lockstepClicks(bot, click => click(37, 0, 0))   // positive control: the instrument sees a click that is sent
  assert.equal(clicksSent(server, t0).length, 1, 'a click issued after the invalidation goes out')
  assert.equal(nameOf(server.cursor), 'diamond')
  await server.settle(); server.stop()
})

await t('P1-a. NO RACE, NO DROP: an ordinary click with no cooldown is sent and nothing is repaired', async () => {
  const { server, bot, events } = await setup()
  const t0 = Date.now()
  await CS.lockstepClicks(bot, click => click(37, 0, 0))
  assert.equal(clicksSent(server, t0).length, 1)
  assert.equal(events.filter(e => e.event === 'click_dropped').length, 0)
  await server.settle(); server.stop()
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
