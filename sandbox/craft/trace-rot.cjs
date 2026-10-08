// SANDBOX-ONLY packet trace preload, ROTATION + ITEM TRAJECTORY edition (Job 5, the junk well's pit-first toss miss, 10-07).
// trace.cjs plus, OBSERVING ONLY (no packet is changed, no bot method wrapped; the RCON probes run in a child process and
// never block the bot's event loop):
//   out look / position_look / position / flying   every rotation-bearing packet the bot sends (yaw/pitch as SENT, degrees);
//                                                  plain position/flying packets are counted, not logged (20 per second)
//   out window_click                               + the client's bot.entity yaw/pitch at that moment (radians and notchian)
//   in  position / player_rotation                 server corrections of the bot's position or rotation
//   in  spawn_entity (items)                       + its spawn velocity
//   in  entity_velocity / rel_entity_move / entity_move_look / entity_teleport / sync_entity_position / entity_destroy
//                                                  for ITEM entities only: each item's trajectory, last position, removal
//   rcon on every THROW click (mode 4)             `data get entity <bot> Rotation` at once, and the item entities near the
//                                                  bot 1.5 s later (where the thrown stack is resting, before the 2.0 s pickup)
// Env: CRAFT_TRACE (required) = jsonl path; TRACE_RCON_SERVER = sandbox|sandbox3 (optional: no RCON probes without it).
'use strict'
const fs = require('fs')
const { spawn } = require('child_process')
const TRACE = process.env.CRAFT_TRACE
if (!TRACE) throw new Error('CRAFT_TRACE required')
const RCON_SERVER = process.env.TRACE_RCON_SERVER || null
if (RCON_SERVER && !/^(sandbox|sandbox3)$/.test(RCON_SERVER)) throw new Error('trace-rot: sandbox / sandbox3 only')
const mf = require(require.resolve('mineflayer', { paths: [process.cwd()] }))
const out = fs.createWriteStream(TRACE, { flags: 'a' })
const log = o => { try { out.write(JSON.stringify({ ts: Date.now(), ...o }) + '\n') } catch {} }
const deg = r => Math.round(r * 180 / Math.PI * 100) / 100
const r3 = v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)
// an async RCON probe: one ssh child per probe, its reply logged when it arrives
function rcon (tag, cmds, extra = {}) {
  if (!RCON_SERVER) return
  const t0 = Date.now()
  try {
    const ch = spawn('ssh', ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-trot-%C`, '-o', 'ControlPersist=600',
      'mike@10.0.0.30', `python3 /tmp/sbx-rcon.py ${RCON_SERVER} -`], { stdio: ['pipe', 'pipe', 'ignore'] })
    let buf = ''
    ch.stdout.on('data', d => { buf += d })
    ch.on('close', () => log({ pkt: 'rcon', tag, sentMs: t0, rttMs: Date.now() - t0, reply: buf.slice(0, 2000), ...extra }))
    ch.stdin.end(cmds.join('\n') + '\n')
  } catch (e) { log({ pkt: 'rcon_error', tag, err: String(e?.message ?? e) }) }
}
const origCreate = mf.createBot
mf.createBot = function (opts) {
  if (!String(opts.username || '').startsWith('sandbox-') || opts.host !== '10.0.0.30') throw new Error('craft trace: sandbox only')
  const bot = origCreate.call(this, opts)
  const NAME = opts.username
  const nameOf = it => (it && it.itemCount && it.itemId != null) ? `${bot.registry?.items[it.itemId]?.name || it.itemId}x${it.itemCount}` : '-'
  const c = bot._client
  const items = new Map()   // entityId -> { x, y, z } (absolute, as the client tracks it)
  c.on('spawn_entity', p => {
    const itemType = bot.registry?.entitiesByName?.item?.id
    if (itemType == null || p.type !== itemType) return
    items.set(p.entityId, { x: p.x, y: p.y, z: p.z })
    log({ pkt: 'spawn_item', id: p.entityId, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
      v: p.velocity ?? (p.velocityX != null ? { x: p.velocityX, y: p.velocityY, z: p.velocityZ } : null) })
  })
  const itemPos = (id, how, p) => {
    const it = items.get(id); if (!it) return
    if (how === 'rel') { it.x += (p.dX ?? 0) / 4096; it.y += (p.dY ?? 0) / 4096; it.z += (p.dZ ?? 0) / 4096 } else { it.x = p.x ?? it.x; it.y = p.y ?? it.y; it.z = p.z ?? it.z }
    log({ pkt: `item_${how}`, id, x: r3(it.x), y: r3(it.y), z: r3(it.z), onGround: p.onGround ?? null })
  }
  c.on('rel_entity_move', p => itemPos(p.entityId, 'rel', p))
  c.on('entity_move_look', p => itemPos(p.entityId, 'rel', p))
  c.on('entity_teleport', p => itemPos(p.entityId, 'tp', p))
  c.on('sync_entity_position', p => itemPos(p.entityId, 'sync', p))
  c.on('entity_velocity', p => { if (items.has(p.entityId)) log({ pkt: 'item_velocity', id: p.entityId, v: p.velocity ?? { x: p.velocityX, y: p.velocityY, z: p.velocityZ } }) })
  c.on('entity_destroy', p => { for (const id of (p.entityIds ?? [])) if (items.has(id)) { const it = items.get(id); log({ pkt: 'item_destroy', id, last: { x: r3(it.x), y: r3(it.y), z: r3(it.z) } }); items.delete(id) } })
  c.on('collect', p => log({ pkt: 'collect', id: p.collectedEntityId, by: p.collectorEntityId, self: p.collectorEntityId === bot.entity?.id, n: p.pickupItemCount,
    last: items.has(p.collectedEntityId) ? { x: r3(items.get(p.collectedEntityId).x), y: r3(items.get(p.collectedEntityId).y), z: r3(items.get(p.collectedEntityId).z) } : null }))
  // server corrections of the BOT
  c.on('position', p => log({ pkt: 'in_position', x: r3(p.x), y: r3(p.y), z: r3(p.z), yaw: p.yaw, pitch: p.pitch, flags: p.flags ?? null, tp: p.teleportId ?? null }))
  c.on('player_rotation', p => log({ pkt: 'in_player_rotation', yaw: p.yaw, pitch: p.pitch }))
  c.on('open_window', p => log({ pkt: 'open_window', win: p.windowId, type: p.inventoryType }))
  c.on('close_window', p => log({ pkt: 'close_window_in', win: p.windowId }))
  c.on('set_slot', p => log({ pkt: 'set_slot', win: p.windowId, slot: p.slot, item: nameOf(p.item) }))
  let quiet = 0   // position/flying packets with no rotation, counted between logged packets
  const rawWrite = c.write.bind(c)
  c.write = function (name, params) {
    if (name === 'look' || name === 'position_look') {
      log({ pkt: `out_${name}`, yaw: r3(params.yaw), pitch: r3(params.pitch), x: r3(params.x), y: r3(params.y), z: r3(params.z), quietBefore: quiet }); quiet = 0
    } else if (name === 'position' || name === 'flying') quiet++
    else if (name === 'window_click') {
      const e = bot.entity
      log({ pkt: 'click', win: params.windowId, slot: params.slot, mode: params.mode, btn: params.mouseButton,
        client: e ? { yawRad: r3(e.yaw), pitchRad: r3(e.pitch), yawMc: Math.round(((180 - deg(e.yaw)) % 360 + 360) % 360 * 100) / 100, pitchMc: -deg(e.pitch),
          pos: { x: r3(e.position.x), y: r3(e.position.y), z: r3(e.position.z) } } : null, quietBefore: quiet })
      if (params.mode === 4) {
        const at = Date.now()
        rcon('rotation_at_throw', [`data get entity ${NAME} Rotation`, `data get entity ${NAME} Pos`], { clickTs: at })
        const sel = `@e[type=item,x=${(e?.position.x ?? 0).toFixed(2)},y=${(e?.position.y ?? 0).toFixed(2)},z=${(e?.position.z ?? 0).toFixed(2)},distance=..8]`
        setTimeout(() => rcon('items_1500ms', [`execute as ${sel} run data get entity @s Pos`, `execute as ${sel} run data get entity @s Item.id`], { clickTs: at }), 1500)
      }
    } else if (name === 'close_window') log({ pkt: 'close_window_out', win: params.windowId })
    else if (name === 'block_dig') { const h = bot.heldItem; log({ pkt: 'dig', status: params.status, loc: params.location, face: params.face, held: h ? { name: h.name, slot: h.slot } : null }) }
    else if (name === 'block_place') { const p = bot.entity?.position; log({ pkt: 'block_place', loc: params.location, feet: p && { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) } }) }
    else if (name === 'held_item_slot' || name === 'arm_animation' || name === 'use_item' || name === 'entity_action') log({ pkt: `out_${name}`, p: params })
    return rawWrite(name, params)
  }
  let lastUntil = 0, lastProfile
  const poll = setInterval(() => {
    const u = Number(bot.stationaryUntil) || 0; if (u !== lastUntil) { lastUntil = u; log({ pkt: 'stationary', until: u }) }
    const m = bot.movementProfile ?? null; if (m !== lastProfile) { lastProfile = m; log({ pkt: 'profile', name: m }) }
  }, 100)
  bot.once('end', () => clearInterval(poll))
  log({ pkt: 'traced', user: opts.username, rot: true })
  return bot
}
