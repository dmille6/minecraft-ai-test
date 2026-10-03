// SANDBOX-ONLY packet trace preload (node --require trace.cjs). OBSERVES ONLY: it changes no packet, wraps no skill and
// no mineflayer method, so the bot under test runs its own code unchanged (unlike preload.cjs, which can shim clicks).
// Logs, with wall-clock ts, what the craft A/B needs to place a drop relative to the craft's clicks:
//   out window_click / close_window      every click the bot sends (slot, mode, button)
//   in  open_window / close_window       the crafting window opening and closing
//   in  spawn_entity (items only)        when an item entity appears, and where
//   in  collect                          when the server hands an item entity to a player (pickup)
//   in  set_slot / set_player_inventory  player-inventory slot changes (window 0 or the open window), name x count
// Env: CRAFT_TRACE (required) = jsonl path. Refuses any non-sandbox connection.
'use strict'
const fs = require('fs')
const TRACE = process.env.CRAFT_TRACE
if (!TRACE) throw new Error('CRAFT_TRACE required')
const mf = require(require.resolve('mineflayer', { paths: [process.cwd()] }))
const out = fs.createWriteStream(TRACE, { flags: 'a' })
const log = o => { try { out.write(JSON.stringify({ ts: Date.now(), ...o }) + '\n') } catch {} }
const origCreate = mf.createBot
mf.createBot = function (opts) {
  if (!String(opts.username || '').startsWith('sandbox-') || opts.host !== '10.0.0.30') throw new Error('craft trace: sandbox only')
  const bot = origCreate.call(this, opts)
  const nameOf = it => (it && it.itemCount && it.itemId != null) ? `${bot.registry?.items[it.itemId]?.name || it.itemId}x${it.itemCount}` : '-'
  const c = bot._client
  c.on('spawn_entity', p => {
    const itemType = bot.registry?.entitiesByName?.item?.id
    if (itemType == null || p.type !== itemType) return
    log({ pkt: 'spawn_item', id: p.entityId, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) })
  })
  c.on('collect', p => log({ pkt: 'collect', id: p.collectedEntityId, by: p.collectorEntityId, self: p.collectorEntityId === bot.entity?.id, n: p.pickupItemCount }))
  c.on('open_window', p => log({ pkt: 'open_window', win: p.windowId, type: p.inventoryType }))
  c.on('close_window', p => log({ pkt: 'close_window_in', win: p.windowId }))
  c.on('set_slot', p => log({ pkt: 'set_slot', win: p.windowId, slot: p.slot, item: nameOf(p.item) }))
  c.on('set_player_inventory', p => log({ pkt: 'set_player_inventory', slot: p.slotId, item: nameOf(p.contents) }))
  const rawWrite = c.write.bind(c)
  c.write = function (name, params) {
    if (name === 'window_click') log({ pkt: 'click', win: params.windowId, slot: params.slot, mode: params.mode, btn: params.mouseButton })
    else if (name === 'close_window') log({ pkt: 'close_window_out', win: params.windowId })
    return rawWrite(name, params)
  }
  log({ pkt: 'traced', user: opts.username })
  return bot
}
