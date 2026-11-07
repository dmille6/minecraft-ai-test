// voyager-01: THE BOT PROCESS ENTRY for an LLM arm (design §4).
//
// It runs the fleet harness (bots/src/index.mjs) UNCHANGED with LLM_ENABLED=false, so the fleet's reflexes, guards and
// movement rules are all underneath, and drives that harness's own runner with the voyager loop. No file on
// config/protected-paths.txt is edited: this file wraps mineflayer.createBot (to guard chat and see each bot), records
// the runner from its own prototype methods, registers the vy_ skills into the SKILLS table, and starts the fleet's
// StagnationWatchdog itself (its cognitive argument is optional).

import { createRequire } from 'node:module'
import path from 'node:path'
import { chat as llmChat } from './llmclient.mjs'
import { makeLog } from './vlog.mjs'
import { Library } from './library.mjs'
import { VoyagerLoop } from './loop.mjs'
import { registerVySkills } from './facade.mjs'
import { installChatGuard } from './chatguard.mjs'

const env = process.env
const ARM = env.VOYAGER_ARM ?? 'x'
const SOCKET = env.VOYAGER_SOCKET ?? `/run/voyager/${ARM}/llm.sock`
const STATE = env.VOYAGER_STATE ?? path.join(env.STATE_DIR ?? '/tmp', 'voyager')
const LOGDIR = env.VOYAGER_LOG_DIR ?? env.LOG_DIR ?? '/tmp'
if (env.LLM_ENABLED !== 'false') { console.error('voyager entry refuses to start unless LLM_ENABLED=false (the fleet brain must be off)'); process.exit(2) }

const log = makeLog(LOGDIR, `voyager-${ARM}`, { arm: ARM, code: env.CODE_VERSION ?? null })
const requireBots = createRequire(new URL('../../bots/src/index.mjs', import.meta.url))
const mineflayer = requireBots('mineflayer')
const { Runner } = await import('../../bots/src/runner.mjs')
const { SKILLS, SKILL_CONTRACTS } = await import('../../bots/src/skills.mjs')
const { StagnationWatchdog } = await import('../../bots/src/watchdog.mjs')

registerVySkills(SKILLS, SKILL_CONTRACTS)

// THE RUNNER index.mjs builds is the one the reflexes interrupt, so it is the one we must drive. Record it from the first
// prototype call made on it (the reflex tick and the memory sampler call these within seconds of connect).
const runners = new WeakMap()
for (const m of ['isBusy', 'describe', 'run', 'interrupt', 'activeReservation']) {
  const orig = Runner.prototype[m]
  if (typeof orig !== 'function') continue
  Runner.prototype[m] = function (...a) { if (this?.bot && !runners.has(this.bot)) runners.set(this.bot, this); return orig.apply(this, a) }
}

let current = null      // { bot, runner, watchdog }
const getBot = () => current?.bot ?? null
const getRunner = () => current?.runner ?? null

const origCreate = mineflayer.createBot
mineflayer.createBot = function (opts) {
  const bot = origCreate.call(this, opts)
  installChatGuard(bot, e => log('command_attempt', e))
  bot.once('spawn', async () => {
    let runner = null
    for (let i = 0; i < 120 && !runner; i++) { runner = runners.get(bot) ?? null; if (!runner) await new Promise(r => setTimeout(r, 250)) }
    if (!runner) { log('runner_not_found', {}); return }
    for (let i = 0; i < 40 && !bot.spawnPoint; i++) await new Promise(r => setTimeout(r, 250))
    bot.voyager = { spawn: bot.spawnPoint ? { x: bot.spawnPoint.x, y: bot.spawnPoint.y, z: bot.spawnPoint.z } : null }
    let watchdog = null
    try { watchdog = new StagnationWatchdog(bot, runner, null); runner.watchdog = watchdog; watchdog.start() } catch (e) { log('watchdog_error', { error: String(e?.message ?? e) }) }
    if (current?.watchdog) { try { current.watchdog.stop() } catch {} }
    current = { bot, runner, watchdog }
    log('connected', { spawn: bot.voyager.spawn, pos: bot.entity?.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null })
    startLoop()
  })
  bot.on('death', () => log('death', { pos: bot.entity?.position ? { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } : null }))
  bot.once('end', reason => {
    log('disconnected', { reason: String(reason ?? '') })
    if (current?.bot === bot) { try { current.watchdog?.stop() } catch {} current = null }
  })
  return bot
}

let loop = null
function startLoop () {
  if (loop) return
  const library = new Library(path.join(STATE, 'library'))
  loop = new VoyagerLoop({
    getBot, getRunner, library, log, arm: ARM, stateDir: STATE, model: env.VOYAGER_MODEL ?? null,
    llm: async (req) => {
      const t0 = Date.now()
      const r = await llmChat({ socketPath: SOCKET, ...req })
      log('llm', { purpose: req.purpose, ok: r.ok, ms: Date.now() - t0, usage: r.usage ?? null, error: r.ok ? null : r.error })
      return r
    },
  })
  setTimeout(() => { loop.start().catch(e => log('loop_crash', { error: String(e?.stack ?? e).slice(0, 600) })) }, 8_000)
}

// THE WATCHER'S PULSE (design §5 rule 4): once a minute, where the bot is, a digest of its bag and what it is doing.
setInterval(() => {
  const b = getBot(), r = getRunner()
  if (!b?.entity) { log('heartbeat', { connected: false }); return }
  const inv = (b.inventory?.items?.() ?? []).map(i => `${i.name}:${i.count}`).sort().join(',')
  let h = 0
  for (let i = 0; i < inv.length; i++) h = (h * 31 + inv.charCodeAt(i)) | 0
  const p = b.entity.position
  log('heartbeat', { connected: true, pos: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(p.z * 10) / 10 },
    inv_hash: h, items: (b.inventory?.items?.() ?? []).length, inv: [...new Set((b.inventory?.items?.() ?? []).map(i => i.name))].sort(), health: b.health, food: b.food, doing: r?.describe?.() ?? null, loop: !!loop?.running })
}, 60_000).unref()

process.on('SIGTERM', () => { try { loop?.stop() } catch {} })
log('process_start', { pid: process.pid, node: process.version })
await import('../../bots/src/index.mjs')
