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
import { CognitiveLoop } from './cognitive.mjs'
import { openLessons } from './lessons.mjs'
import { StagnationWatchdog } from './watchdog.mjs'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)

let reconnectDelay = config.reconnect.delayMs
let stopping = false
let stopReflexes = null
let cognitive = null
let lessons = null
let watchdog = null

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
    // Re-enabled after evidence. It was disabled because a 1x1 pillar can
    // strand a bot on top of it -- but that was before the entombment reflex
    // and pillarOut escape existed, so the failure mode now has a recovery.
    // Without it the bot can only cross terrain with <=1 block steps, and
    // pathfinder reported "no route" for a 140-block trip through forest that
    // is plainly walkable by a player.
    moves.allow1by1towers = true
    moves.allowParkour = false        // parkour is the top source of stuck states
    // Default maxDropDown is 4, which means a bot on a ledge above a 5-block
    // drop has no legal move: it cannot dig, cannot parkour, and cannot pillar
    // without blocks in its inventory. Observed live -- Scout01 sat immobile
    // to 14 decimal places for ten minutes while the model correctly tried
    // progressively nearer waypoints. 6 costs a little fall damage and is
    // survivable; being permanently wedged is not.
    moves.maxDropDown = 6
    bot.pathfinder.setMovements(moves)
    // Default is 5s. In dense forest with canDig=false many goals are genuinely
    // unreachable, and A* needs room to prove that rather than reporting
    // "took too long" -- which is indistinguishable from a real failure.
    bot.pathfinder.thinkTimeout = 10000

    // ONE lessons store, shared. Reflexes record where the bot got hurt and
    // the cognitive layer records which actions failed; both feed the same
    // persistent memory, and it must exist before either starts.
    lessons = openLessons()
    stopReflexes = startReflexes(bot, runner, lessons)
    attachCommands(bot, runner)

    const s = snapshot(bot)
    log('info', 'spawned', {
      pos: s.bot.pos, health: s.bot.health, food: s.bot.hunger, dimension: s.game.dimension,
    })
    bot.chat(`${config.bot.name} online (${config.bot.role}) — say "${config.bot.name} help"`)

    if (config.viewer.enabled) {
      try {
        const { mineflayer: mineflayerViewer } = require_('prismarine-viewer')
        mineflayerViewer(bot, { port: config.viewer.port, firstPerson: config.viewer.firstPerson })
        log('info', 'viewer started', { url: `http://<host>:${config.viewer.port}`, firstPerson: config.viewer.firstPerson })
      } catch (e) {
        log('error', 'viewer failed to start', { err: e.message })
      }
    }

    if (config.llm.enabled) {
      cognitive = new CognitiveLoop(bot, runner, lessons)
      // Only meaningful in autonomous mode -- a chat-driven bot waiting for a
      // command is idle, not stagnant, and the human is the watchdog.
      watchdog = new StagnationWatchdog(bot, runner, cognitive)
      runner.watchdog = watchdog
      watchdog.start()
      // Give chunks a moment to load before the first perception snapshot,
      // otherwise NEARBY is empty and the first decision is made half-blind.
      setTimeout(() => cognitive.start(), 5000)
      bot.chat(`autonomous mode: ${config.llm.model}`)
    }
  })

  bot.on('death', () => {
    log('warn', 'died', { pos: bot.entity?.position })
    logSkill({
      skill: '_death', args: {}, status: 'failed', detail: 'bot died',
      startedAt: Date.now(), snapshot: snapshot(bot), trigger: 'death',
    })
    runner.cancel('death')
    cognitive?.notify('death', 'died and respawned')
    // Respawn is automatic; clearing the failure budget avoids a death
    // cascade pausing the bot permanently.
    runner.resume()
  })

  bot.on('kicked', reason => log('error', 'kicked', { reason: String(reason).slice(0, 300) }))
  bot.on('error', err => log('error', 'bot error', { err: err.message }))

  bot.on('end', reason => {
    if (stopReflexes) { stopReflexes(); stopReflexes = null }
    if (cognitive) { cognitive.stop(); cognitive = null }
    if (watchdog) { watchdog.stop(); watchdog = null }
    try { lessons?.save() } catch {}
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
    if (cognitive) cognitive.stop()
    if (watchdog) watchdog.stop()
    try { lessons?.save() } catch {}
    closeLogs()
    setTimeout(() => process.exit(0), 300)
  })
}

process.on('unhandledRejection', e => log('error', 'unhandled rejection', { err: e?.message ?? String(e) }))

connect()
