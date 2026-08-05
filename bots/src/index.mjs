// Entry point. Owns the bot lifecycle: connect, recover, reconnect.
//
// Handoff doc S22 acceptance criteria 8 and 12 are about survival, not
// intelligence -- recover after death or disconnection, and run four hours
// without unrecoverable failure. That is what this file is for.

import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
const { pathfinder, Movements } = pathfinderPkg
import collectBlockPkg from 'mineflayer-collectblock'
const collectBlock = collectBlockPkg.plugin ?? collectBlockPkg

import { config } from './config.mjs'
import { log, closeLogs, logSkill } from './logger.mjs'
import { Runner } from './runner.mjs'
import { startReflexes } from './reflex.mjs'
import { attachCommands } from './commands.mjs'
import { snapshot } from './state.mjs'

let reconnectDelay = config.reconnect.delayMs
let stopping = false
let stopReflexes = null

function connect() {
  log('info', 'connecting', {
    host: `${config.mc.host}:${config.mc.port}`,
    version: config.mc.version,
    bot: config.bot.name,
    role: config.bot.role,
    run_id: config.log.runId,
  })

  const bot = mineflayer.createBot({
    host: config.mc.host,
    port: config.mc.port,
    username: config.bot.name,
    auth: config.mc.auth,
    version: config.mc.version,
  })

  bot.loadPlugin(pathfinder)
  // Scoped to the gather skill. It manages its own movements (including
  // digging), which is why general navigation can stay canDig=false.
  bot.loadPlugin(collectBlock)
  const runner = new Runner(bot)

  bot.once('spawn', () => {
    reconnectDelay = config.reconnect.delayMs   // reset backoff on a good connect

    const moves = new Movements(bot)
    // canDig=false is deliberate and load-bearing. With digging enabled the
    // pathfinder treats excavation as a normal way to reach a goal, and the bot
    // steadily tunnels downward -- observed descending 68->65 while "walking"
    // to a tree 4 blocks away, ending in a self-dug pit it then struggled to
    // path out of.
    //
    // It also violates the layering: digging is a decision the skill layer
    // makes explicitly (gather digs its target block), not a side effect of
    // navigation. Terrain the bot cannot walk around is a pathfinding failure
    // we want reported, not silently resolved by rearranging the world.
    moves.canDig = false
    moves.allow1by1towers = false     // 1x1 pillars strand bots on the way back
    moves.allowParkour = false        // parkour is the top source of stuck states
    bot.pathfinder.setMovements(moves)
    // Default is 5s. In dense forest with canDig=false many goals are genuinely
    // unreachable, and A* needs room to prove that rather than reporting
    // "took too long" -- which is indistinguishable from a real failure.
    bot.pathfinder.thinkTimeout = 10000

    stopReflexes = startReflexes(bot, runner)
    attachCommands(bot, runner)

    const s = snapshot(bot)
    log('info', 'spawned', {
      pos: s.bot.pos, health: s.bot.health, food: s.bot.hunger, dimension: s.game.dimension,
    })
    bot.chat(`${config.bot.name} online (${config.bot.role}) — say "${config.bot.name} help"`)
  })

  bot.on('death', () => {
    log('warn', 'died', { pos: bot.entity?.position })
    logSkill({
      skill: '_death', args: {}, status: 'failed', detail: 'bot died',
      startedAt: Date.now(), snapshot: snapshot(bot), trigger: 'death',
    })
    runner.cancel('death')
    // Respawn is automatic; clearing the failure budget avoids a death
    // cascade pausing the bot permanently.
    runner.resume()
  })

  bot.on('kicked', reason => log('error', 'kicked', { reason: String(reason).slice(0, 300) }))
  bot.on('error', err => log('error', 'bot error', { err: err.message }))

  bot.on('end', reason => {
    if (stopReflexes) { stopReflexes(); stopReflexes = null }
    if (stopping) return
    log('warn', 'disconnected, will reconnect', { reason: String(reason), delayMs: reconnectDelay })
    setTimeout(connect, reconnectDelay)
    // Exponential backoff so a server that is down does not get hammered.
    reconnectDelay = Math.min(reconnectDelay * 2, config.reconnect.maxDelayMs)
  })

  return bot
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true
    log('info', 'shutting down', { signal: sig })
    if (stopReflexes) stopReflexes()
    closeLogs()
    setTimeout(() => process.exit(0), 300)
  })
}

process.on('unhandledRejection', e => log('error', 'unhandled rejection', { err: e?.message ?? String(e) }))

connect()
