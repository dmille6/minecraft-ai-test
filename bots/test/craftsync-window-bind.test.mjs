// A LATE CLICK MUST NOT LAND IN ANOTHER WINDOW (withdraw round 5, Codex P1). mineflayer 4.37.1's clickWindow sleeps
// out a dig cooldown BEFORE it reads `bot.currentWindow || bot.inventory`: a click issued for a crafting table that is
// closed during the sleep goes to window 0, and one whose table is replaced goes to the new window. Codex's two repros,
// here with mineflayer's REAL inventory plugin over the fake Paper server (test/helpers/fake-paper-craft.mjs):
// nothing may reach the server, and -- round 6 -- the stale click must not even reach mineflayer, which changes its
// LOCAL window before it writes: it is refused before it is invoked. A repair (only for a backstop drop at the wire) runs
// inside craftsync's own next recount or lockstep, never in the background where it could interleave with an equip.
// (The cooldown is forced by setting lastDigTime to a Date: 4.37.1's own digging sets it from performance.now(), and
// `new Date() - performance.now()` never falls under 500 ms -- so today the sleep is latent, not live.)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as CS from '../src/craftsync.mjs'
import { createRequire } from 'node:module'
import { FakePaper, craftBot, registry, id } from './helpers/fake-paper-craft.mjs'

const injectSimpleInventory = createRequire(import.meta.url)('mineflayer/lib/plugins/simple_inventory.js')

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-winbind-'))
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'   // logger.mjs -> config.mjs (the ROWS test runs a row through the real logger)
process.env.BOT_NAME ??= 'WinBindBot'
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const nameOf = it => (it ? registry.items[it.type].name : null)
const desc = it => (it ? `${it.name ?? nameOf(it)}:${it.count}` : '-')

// Window 0 slot 37 is player slot 37 (gold); a table's slot 37 is player slot 36 (diamonds).
const setup = async ({ inventory = { 36: ['diamond', 5], 37: ['gold_ingot', 10], 9: ['dirt', 64] }, cfg = {} } = {}) => {
  const server = new FakePaper({ lagClicks: 1, inventory })
  const bot = craftBot(server)
  injectSimpleInventory(bot)
  await server.sync()
  const events = []
  CS.installCraftSync(bot, { log: e => events.push(e), ...cfg })
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
const refusedBeforeMineflayer = events => events.some(e => e.kind === 'click_refused')
const noBackgroundRepair = events => !events.some(e => e.kind === 'click_drop_repair')
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
  assert.ok(refusedBeforeMineflayer(events), 'refused before mineflayer was invoked')
  assert.equal(desc(bot.inventory.slots[37]), 'gold_ingot:10', 'the local slot was never touched')
  assert.equal(bot.inventory.selectedItem ?? null, null, 'nor the local cursor')
  assert.ok(noBackgroundRepair(events)); assert.equal(bot.craftSync.repairPending(), null, 'nothing to repair')
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
  assert.ok(refusedBeforeMineflayer(events))
  assert.equal(desc(second.slots[37]), 'diamond:5', 'the replacement window\'s slot was never touched')
  assert.equal(second.selectedItem ?? null, null)
  assert.ok(noBackgroundRepair(events))
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
  assert.ok(refusedBeforeMineflayer(events))
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
  assert.equal(events.filter(e => e.kind === 'click_dropped').length, 0)
  await server.settle(); server.stop()
})

await t('ROWS (round 7): a refusal reaches the fleet logger as _click_refused with its fields in detail -- not _undefined', async () => {
  const { tapRecords, logEvent } = await import('../src/logger.mjs')
  const recs = []
  tapRecords(r => recs.push(r))
  const { server, bot, events, table } = await setup()
  const p = lateClick(bot)
  await wait(100)
  serverCloses(server, bot, table)
  await p.catch(() => {})
  const row = events.find(e => e.kind === 'click_refused')
  assert.ok(row, 'positive control: the refusal was logged')
  logEvent(row)                                   // what index.mjs does with every craftsync row
  const r = recs.find(x => x.skill?.name === '_click_refused')
  assert.ok(r, `landed as ${recs.map(x => x.skill?.name).join(',')}`)
  assert.equal(r.skill.detail, 'slot 37 window 1: bound to window 1, written to window 0')
  assert.equal(r.skill.status, 'failed')
  assert.equal(recs.filter(x => x.skill?.name === '_undefined').length, 0)
  await server.settle(); server.stop()
})

/** Keep mineflayer's dig cooldown armed for `ms` (lastDigTime refreshed as a Date), so a hotbar click waits in it. */
const armCooldown = (bot, ms) => { const until = Date.now() + ms; bot.lastDigTime = new Date(); const iv = setInterval(() => { if (Date.now() < until) bot.lastDigTime = new Date(); else clearInterval(iv) }, 200); return iv }

await t('CAP (Codex on the grid fix): a click the cap gives up on is invalidated -- held in the cooldown past the cap, it is never sent', async () => {
  const { server, bot, events } = await setup({ cfg: { clickCapMs: 600 } })
  const t0 = Date.now()
  armCooldown(bot, 1_500)                                     // the click waits ~1.5 s; the cap is 0.6 s
  await assert.rejects(CS.lockstepClicks(bot, click => click(37, 0, 0)), /not answered in 600 ms/)
  const tReturn = Date.now()
  for (let i = 0; i < 150 && bot.craftSync.inflight() > 0; i++) await wait(20)   // the held click wakes and is judged
  assert.equal(bot.craftSync.inflight(), 0, 'the held click has settled')
  assert.ok(Date.now() - tReturn > 500, 'positive control: it was still held well after the lockstep returned')
  assert.equal(clicksSent(server, t0).length, 0, 'no late click on the wire')
  assert.ok(events.some(e => e.kind === 'click_refused' && /craft stopped: click_timeout/.test(e.detail)), JSON.stringify(events.filter(e => e.kind)))
  assert.equal(nameOf(server.p[36]), 'diamond'); assert.equal(server.cursor, null)
  assert.equal(desc(bot.currentWindow.slots[37]), 'diamond:5', 'and the local window was never touched')
  await server.settle(); server.stop()
})

await t('STOP: a click a stopped lockstep gives up on (its signal aborted) is invalidated too -- never sent', async () => {
  const { server, bot, events } = await setup()
  const t0 = Date.now()
  armCooldown(bot, 1_000)
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 150)
  await CS.lockstepClicks(bot, click => click(37, 0, 0), { signal: ac.signal }).catch(() => {})
  for (let i = 0; i < 100 && bot.craftSync.inflight() > 0; i++) await wait(20)
  assert.equal(bot.craftSync.inflight(), 0)
  assert.equal(clicksSent(server, t0).length, 0, 'no late click on the wire')
  assert.ok(events.some(e => e.kind === 'click_refused' && /craft stopped: aborted/.test(e.detail)), JSON.stringify(events.filter(e => e.kind)))
  await server.settle(); server.stop()
})

await t('NO STOP, NO INVALIDATION: the same held click with no cap and no stop is sent when it wakes (control for the two above)', async () => {
  const { server, bot, events } = await setup()
  const t0 = Date.now()
  armCooldown(bot, 800)
  await CS.lockstepClicks(bot, click => click(37, 0, 0))
  assert.equal(clicksSent(server, t0).length, 1)
  assert.equal(events.filter(e => e.kind === 'click_refused').length, 0)
  assert.equal(nameOf(server.cursor), 'diamond')
  await server.settle(); server.stop()
})

// ---- round 6: Codex's repro -- a release, then the survival equip AT ONCE, with the real simple_inventory equip
const APPLES = { 9: ['apple', 3], 36: ['diamond', 5], 37: ['gold_ingot', 10] }
/** Release (close the table, invalidate), let the stale click wake and fail, then equip the apples after `gapMs`.
 *  -> { wire: what the server received from the release on, slots: the server's 9/36/37/38 and cursor }. */
const releaseThenEquip = async gapMs => {
  const { server, bot, events, table } = await setup({ inventory: APPLES })
  const p = lateClick(bot)
  await wait(100)
  const tRelease = Date.now()
  bot.closeWindow(table)                        // the release: close at once...
  CS.invalidateClicks(bot, 'release')          // ...and invalidate what is in flight
  await p.catch(() => {})                       // the stale click has woken and been judged
  if (gapMs) await wait(gapMs)
  const apples = bot.inventory.slots[9]
  assert.equal(nameOf(apples), 'apple', 'positive control: the client still sees the apples in slot 9')
  await bot.equip(apples, 'hand')
  await wait(300); await server.settle()
  const wire = server.writes.filter(x => x.t >= tRelease && ['window_click', 'close_window'].includes(x.name))
    .map(x => (x.name === 'close_window' ? `close(${x.params.windowId})` : `click(${x.params.windowId}:${x.params.slot})`))
  const slots = Object.fromEntries([9, 36, 37, 38].map(i => [i, server.p[i] ? `${nameOf(server.p[i])}:${server.p[i].count}` : '-']))
  slots.cursor = server.cursor ? nameOf(server.cursor) : '-'
  server.stop()
  return { wire, slots, events, bot }
}
const RIGHT = { 9: '-', 36: 'diamond:5', 37: 'gold_ingot:10', 38: 'apple:3', cursor: '-' }

await t('ROUND 6 (Codex repro): release, then equip AT ONCE -- the wire is close(1), click 9, click 38; the gold stays in 37', async () => {
  const { wire, slots, events, bot } = await releaseThenEquip(0)
  assert.deepEqual(wire, ['close(1)', 'click(0:9)', 'click(0:38)'], 'no close_window(0) between the equip\'s clicks')
  assert.deepEqual(slots, RIGHT)
  assert.ok(refusedBeforeMineflayer(events)); assert.ok(noBackgroundRepair(events))
  assert.equal(nameOf(bot.heldItem), 'apple', 'and the bot holds the apples')
})

await t('ROUND 6 positive control: the same, equipping only after everything has settled -- the same wire and slots', async () => {
  const { wire, slots } = await releaseThenEquip(800)
  assert.deepEqual(wire, ['close(1)', 'click(0:9)', 'click(0:38)'])
  assert.deepEqual(slots, RIGHT)
})

// ---- the BACKSTOP: a drop at the wire (a ticket that got past the pre-invoke check) -- forced here through the tracker
const backstopDrop = async ({ table = true } = {}) => {
  const ctx = await setup()
  const { bot } = ctx
  if (!table) { serverCloses(ctx.server, bot, ctx.table); await ctx.server.settle() }
  const tracker = bot.craftSync.tracker
  const tk = tracker.bind({ windowId: 99, slot: 37, button: 0, mode: 0 })   // bound elsewhere: the wire must refuse it
  await tracker.dispatch(tk, () => bot.clickWindow(37, 0, 0))                // mineflayer's own click, applied locally
  return { ...ctx, tk }
}

await t('BACKSTOP, no window: the wire drops it; NOTHING runs in the background; the next recount repairs slots and cursor', async () => {
  const { server, bot, events, tk } = await backstopDrop({ table: false })
  assert.match(tk.dropped ?? '', /bound to window 99, written to window 0/)
  assert.ok(events.some(e => e.kind === 'click_dropped' && e.detail === 'slot 37 window 0: bound to window 99, written to window 0'), 'the wire drop is a readable row')
  assert.equal(nameOf(bot.inventory.selectedItem), 'gold_ingot', 'positive control: mineflayer DID change its local window')
  const n = server.writes.length
  await wait(400)
  assert.equal(server.writes.length, n, 'no repair traffic of its own: nothing may interleave with an equip')
  assert.ok(bot.craftSync.repairPending(), 'marked for repair')
  const r = await CS.serverRecount(bot, { deadline: Date.now() + 3000 })
  assert.equal(r.source, 'server')
  assert.equal(desc(bot.inventory.slots[37]), 'gold_ingot:10'); assert.equal(bot.inventory.selectedItem ?? null, null)
  assert.equal(bot.craftSync.repairPending(), null)
  assert.ok(events.some(e => e.kind === 'click_drop_repair' && e.how === 'recount_server'))
  await server.settle(); server.stop()
})

await t('BACKSTOP, window open: the next lockstep repairs the window (clone probe) BEFORE its first click', async () => {
  const { server, bot, events } = await backstopDrop()
  assert.equal(nameOf(bot.currentWindow.selectedItem), 'diamond', 'positive control: the local window was changed')
  let seenInside = null
  await CS.lockstepClicks(bot, async () => { seenInside = desc(bot.currentWindow.slots[37]) + ' ' + desc(bot.currentWindow.selectedItem) })
  assert.equal(seenInside, 'diamond:5 -', 'repaired before fn ran')
  assert.ok(events.some(e => e.kind === 'click_drop_repair' && e.how === 'window_probe'))
  assert.equal(bot.craftSync.repairPending(), null)
  await server.settle(); server.stop()
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
