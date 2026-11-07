// voyager-01: THE CONTROL ARM's entry (design §2.3). The fleet harness as it is (LLM_ENABLED=true): its llm.mjs speaks HTTP
// to OLLAMA_BASE_URL, and the bot's network namespace has only loopback, so a relay inside the namespace carries
// 127.0.0.1:11434 to the proxy's unix socket. The proxy forces the model and rebuilds each request from an allowlist.

import net from 'node:net'
import { createRequire } from 'node:module'
import { makeLog } from './vlog.mjs'
import { installChatGuard } from './chatguard.mjs'

const env = process.env
const ARM = env.VOYAGER_ARM ?? 'ctl'
const SOCKET = env.VOYAGER_SOCKET ?? `/run/voyager/${ARM}/llm.sock`
const log = makeLog(env.VOYAGER_LOG_DIR ?? env.LOG_DIR ?? '/tmp', `voyager-${ARM}`, { arm: ARM, code: env.CODE_VERSION ?? null })

const relay = net.createServer(c => {
  const u = net.connect(SOCKET)
  c.pipe(u); u.pipe(c)
  const close = () => { c.destroy(); u.destroy() }
  c.on('error', close); u.on('error', close)
})
await new Promise((res, rej) => { relay.once('error', rej); relay.listen(11434, '127.0.0.1', res) })

const mineflayer = createRequire(new URL('../../bots/src/index.mjs', import.meta.url))('mineflayer')
const origCreate = mineflayer.createBot
mineflayer.createBot = function (opts) {
  const bot = origCreate.call(this, opts)
  installChatGuard(bot, e => log('command_attempt', e))
  bot.once('spawn', () => log('connected', { spawn: bot.spawnPoint ? { x: bot.spawnPoint.x, y: bot.spawnPoint.y, z: bot.spawnPoint.z } : null }))
  bot.on('death', () => log('death', {}))
  bot.once('end', r => { log('disconnected', { reason: String(r ?? '') }); if (current === bot) current = null })
  bot.once('spawn', () => { current = bot })
  return bot
}
// the same pulse as the LLM arms (unique items and tool tiers for the metrics)
let current = null
setInterval(() => {
  const b = current
  if (!b?.entity) { log('heartbeat', { connected: false }); return }
  const p = b.entity.position
  const items = b.inventory?.items?.() ?? []
  log('heartbeat', { connected: true, pos: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(p.z * 10) / 10 },
    items: items.length, inv: [...new Set(items.map(i => i.name))].sort(), health: b.health, food: b.food })
}, 60_000).unref()
log('process_start', { pid: process.pid, node: process.version })
await import('../../bots/src/index.mjs')
