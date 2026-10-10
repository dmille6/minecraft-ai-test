// SANDBOX-ONLY client-side position probe (node --require posprobe.cjs). OBSERVES ONLY: every 250 ms it writes what
// the bot's own client believes -- entity.position, velocity, onGround, the blocks at the feet cell, pos+1 (the cell the
// rescue calls "head") and the eye cell (pos+1.62), bot.oxygenLevel, bot.health, bot.entity.eyeHeight (airpocket-02 sets
// it to the pose's eye while it digs) and bot.entity.metadata[6] (the server's pose datum: 0 standing, 3 swimming,
// 5 crouching). It also logs, as they arrive, every block_change / multi_block_change within 4 blocks of the bot and
// every acknowledge_player_digging, so a dig's real server-side break time can be read against the client's dig_ms.
// Changes no packet, wraps no method beyond createBot. Env: POSPROBE_OUT (required). Refuses any non-sandbox connection.
'use strict'
const fs = require('fs')
const OUT = process.env.POSPROBE_OUT
if (!OUT) throw new Error('POSPROBE_OUT required')
const mf = require(require.resolve('mineflayer', { paths: [process.cwd()] }))
const out = fs.createWriteStream(OUT, { flags: 'a' })
const w = o => { try { out.write(JSON.stringify({ ts: Date.now(), ...o }) + '\n') } catch {} }
const origCreate = mf.createBot
mf.createBot = function (opts) {
  if (!String(opts.username || '').startsWith('sandbox-') || opts.host !== '10.0.0.30') throw new Error('posprobe: sandbox only')
  const bot = origCreate.call(this, opts)
  const name = v => { try { const b = bot.blockAt(v); return b ? b.name : null } catch { return null } }
  const stateName = id => { try { return bot.registry?.blocksByStateId?.[id]?.name ?? String(id) } catch { return String(id) } }
  const near = (x, y, z) => { const p = bot.entity?.position; return p && Math.abs(x - p.x) <= 4 && Math.abs(y - p.y) <= 4 && Math.abs(z - p.z) <= 4 }
  const c = bot._client
  c.on('block_change', p => { const l = p.location; if (l && near(l.x, l.y, l.z)) w({ pkt: 'block_change', loc: `${l.x},${l.y},${l.z}`, block: stateName(p.type) }) })
  c.on('multi_block_change', p => {
    try {
      const cx = p.chunkCoordinates?.x, cy = p.chunkCoordinates?.y, cz = p.chunkCoordinates?.z
      for (const r of p.records || []) {
        // 1.20+: record = stateId << 12 | (x << 8 | z << 4 | y), section-relative
        const id = Number(BigInt(r) >> 12n), x = cx * 16 + Number((BigInt(r) >> 8n) & 15n), z = cz * 16 + Number((BigInt(r) >> 4n) & 15n), y = cy * 16 + Number(BigInt(r) & 15n)
        if (near(x, y, z)) w({ pkt: 'multi_block_change', loc: `${x},${y},${z}`, block: stateName(id) })
      }
    } catch {}
  })
  c.on('acknowledge_player_digging', p => w({ pkt: 'dig_ack', seq: p.sequenceId ?? p.sequence ?? null }))
  // THE DIG CALL'S OWN STATE: mineflayer writes block_dig status 0 inside bot.dig() and prices its finish timer there,
  // so eyeHeight / pose / onGround read at that write are what the timer was computed from. Read only; the packet passes.
  const rawWrite = c.write.bind(c)
  c.write = function (name, params) {
    if (name === 'block_dig') {
      try {
        const e = bot.entity, l = params?.location
        w({ pkt: 'dig_call', status: params?.status, loc: l ? `${l.x},${l.y},${l.z}` : null, onGround: !!e?.onGround, eyeHeight: e?.eyeHeight ?? null,
            pose: e?.metadata?.[6] ?? null, y: e?.position ? +e.position.y.toFixed(3) : null, jump: !!bot.controlState?.jump })
      } catch {}
    }
    return rawWrite(name, params)
  }
  const t = setInterval(() => {
    const e = bot.entity
    if (!e || !e.position) return
    const p = e.position
    w({ x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
      vy: +(e.velocity?.y ?? 0).toFixed(3), onGround: !!e.onGround, feet: name(p), head1: name(p.offset(0, 1, 0)),
      eye: name(p.offset(0, 1.62, 0)), oxygen: bot.oxygenLevel ?? null, health: bot.health ?? null,
      eyeHeight: e.eyeHeight ?? null, pose: e.metadata?.[6] ?? null, digging: !!bot.targetDigBlock })
  }, 250)
  bot.once('end', () => clearInterval(t))
  return bot
}
