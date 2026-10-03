// SANDBOX-ONLY instrumentation preload (node --require). Patches mineflayer.createBot in THIS process only:
// logs window packets + clickWindow callers; optional shims via CRAFTSYNC_ARM = none | A | B | AB.
'use strict'
const fs = require('fs')
const path = require('path')
const ARM = process.env.CRAFTSYNC_ARM || 'none'
const TRACE = process.env.CRAFTSYNC_TRACE
if (!TRACE) throw new Error('CRAFTSYNC_TRACE required')
const mfPath = require.resolve('mineflayer', { paths: [process.cwd()] })
const mf = require(mfPath)
const out = fs.createWriteStream(TRACE, { flags: 'a' })
const log = o => { try { out.write(JSON.stringify({ ts: Date.now(), ...o }) + '\n') } catch {} }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const origCreate = mf.createBot
mf.createBot = function (opts) {
  if (!String(opts.username || '').startsWith('sandbox-') || opts.host !== '10.0.0.30') throw new Error('craftsync preload: sandbox only')
  const bot = origCreate.call(this, opts)
  instrument(bot)
  return bot
}
function caller () {
  const st = (new Error().stack || '').split('\n').slice(3)
  return st.filter(l => !l.includes('preload.cjs') && !l.includes('node:internal')).slice(0, 4).map(l => l.trim().replace(/^at /, '').replace(/\(?\/Users\/[^)]*\/(bots\/)?/, '')).join(' < ')
}
function instrument (bot) {
  const itemStr = it => (it && it.itemCount && it.itemId != null) ? `${bot.registry?.items[it.itemId]?.name || it.itemId}x${it.itemCount}` : '-'
  const lastState = new Map(); let lastGlobal = -1
  const quiet = new Map()
  let inCraft = false; let resynced = new Set()
  log({ ev: 'instrumented', arm: ARM })
  for (const n of ['open_window', 'window_items', 'set_slot', 'set_cursor_item', 'close_window', 'set_player_inventory']) {
    bot._client.on(n, p => {
      const o = { dir: 'in', pkt: n }
      if (p.windowId !== undefined) { o.win = p.windowId; quiet.set(p.windowId, Date.now()) }
      if (p.stateId !== undefined) { o.sid = p.stateId; lastState.set(p.windowId, p.stateId); lastGlobal = p.stateId }
      if (n === 'set_slot') { o.slot = p.slot; o.item = itemStr(p.item) }
      if (n === 'window_items') { o.items = p.items.map((x, i) => [i, itemStr(x)]).filter(x => x[1] !== '-'); o.carried = itemStr(p.carriedItem) }
      if (n === 'set_cursor_item') o.item = itemStr(p.contents)
      if (n === 'set_player_inventory') { o.slot = p.slotId; o.item = itemStr(p.contents) }
      if (n === 'open_window') o.type = p.inventoryType
      o.inCraft = inCraft
      log(o)
    })
  }
  const rawWrite = bot._client.write.bind(bot._client)
  bot._client.write = function (name, params) {
    if (['window_click', 'close_window', 'block_place', 'held_item_slot', 'block_dig', 'player_action'].includes(name)) {
      const o = { dir: 'out', pkt: name, inCraft }
      if (name === 'window_click') {
        if ((ARM === 'B' || ARM === 'AB') && !params._forced) {
          const per = lastState.get(params.windowId)
          if (per !== undefined && per !== params.stateId) { o.sidRewritten = `${params.stateId}->${per}`; params = { ...params, stateId: per } }
        }
        Object.assign(o, { win: params.windowId, sid: params.stateId, lastSidWin: lastState.get(params.windowId), lastSidGlobal: lastGlobal, slot: params.slot, btn: params.mouseButton, mode: params.mode,
          changed: (params.changedSlots || []).map(c => [c.location, itemStr(c.item)]), cursor: itemStr(params.cursorItem) })
        if (params._forced) { o.forced = true; params = { ...params }; delete params._forced }
      } else if (name === 'close_window') o.win = params.windowId
      else if (name === 'block_place') { o.loc = params.location; o.seq = params.sequence }
      else if (name === 'held_item_slot') o.slot = params.slotId
      else if (name === 'block_dig' || name === 'player_action') { o.status = params.status; o.loc = params.location }
      log(o)
    }
    try { return rawWrite(name, params) } catch (e) { log({ ev: 'write_throw', name, msg: String(e.message) }); throw e }
  }
  bot._client.on('error', e => log({ ev: 'client_error', msg: String(e && e.message) }))

  async function waitQuiet (winId, quietMs = 100, capMs = 1000) {
    const start = Date.now()
    while (Date.now() - start < capMs) {
      const last = Math.max(quiet.get(winId) || 0, quiet.get(0) || 0)
      if (Date.now() - last >= quietMs && Date.now() - start >= quietMs) return Date.now() - start
      await sleep(10)
    }
    log({ ev: 'quiet_cap', win: winId })
    return capMs
  }

  // wrappers installed after plugins load (they inject synchronously in createBot, but be safe: on 'inject_allowed')
  const install = () => {
    if (bot.__craftsync) return; bot.__craftsync = true
    const origClick = bot.clickWindow
    const origCraft = bot.craft
    const origPutAway = bot.putAway
    const origPSIR = bot.putSelectedItemRange
    const lockstep = ARM === 'A' || ARM === 'AB'
    bot.clickWindow = async function (slot, button, mode) {
      const w = bot.currentWindow || bot.inventory
      log({ ev: 'click_call', win: w.id, slot, button, mode, inCraft, by: inCraft ? undefined : caller() })
      if (!lockstep || !inCraft) return origClick.call(this, slot, button, mode)
      if (w.id !== 0 && !resynced.has(w.id)) {
        resynced.add(w.id)
        const waitedOpen = await waitQuiet(w.id)
        const before = quiet.get(w.id) || 0
        bot._client.write('window_click', { windowId: w.id, stateId: -1, slot: -999, mouseButton: 0, mode: 0, changedSlots: [], cursorItem: { itemCount: 0, components: [], removeComponents: [] }, _forced: true })
        const s = Date.now()
        while (Date.now() - s < 1000 && (quiet.get(w.id) || 0) <= before) await sleep(10)
        const got = (quiet.get(w.id) || 0) > before
        const waited = await waitQuiet(w.id)
        log({ ev: 'resync', win: w.id, waitedOpen, got, waited })
      }
      await origClick.call(this, slot, button, mode)
      await waitQuiet(w.id)
    }
    if (lockstep) {
      bot.putSelectedItemRange = async function (start, end, window, slot) {
        if (!inCraft) return origPSIR.call(this, start, end, window, slot)
        while (window.selectedItem) {
          const item = window.findItemRange(start, end, window.selectedItem.type, window.selectedItem.metadata, true, window.selectedItem.nbt)
          if (item && item.stackSize !== item.count) await bot.clickWindow(item.slot, 0, 0)
          else {
            const empty = window.firstEmptySlotRange(start, end)
            if (empty === null) {
              if (slot !== null) await bot.clickWindow(slot, 0, 0)
              if (window.selectedItem) await bot.clickWindow(-999, 0, 0)
            } else await bot.clickWindow(empty, 0, 0)
          }
        }
      }
      bot.putAway = async function (slot) {
        if (!inCraft) return origPutAway.call(this, slot)
        const window = bot.currentWindow || bot.inventory
        await bot.clickWindow(slot, 0, 0)
        await bot.putSelectedItemRange(window.inventoryStart, window.inventoryEnd, window, null)
      }
    }
    bot.craft = async function (recipe, count, table) {
      inCraft = true; resynced = new Set()
      log({ ev: 'craft_start', result: bot.registry.items[recipe?.result?.id]?.name, count, table: table ? `${table.position}` : null, by: caller() })
      try { const r = await origCraft.call(this, recipe, count, table); log({ ev: 'craft_end' }); return r } catch (e) { log({ ev: 'craft_err', msg: String(e.message) }); throw e } finally { inCraft = false }
    }
    const origEquip = bot.equip
    bot.equip = async function (item, dest) {
      log({ ev: 'equip_call', item: item?.name, dest, win: bot.currentWindow?.id ?? 0, inCraft, by: caller() })
      return origEquip.call(this, item, dest)
    }
  }
  if (bot.craft && bot.clickWindow) install()
  bot.once('inject_allowed', install)
  bot.once('login', install)
}
