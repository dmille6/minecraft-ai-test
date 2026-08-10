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
import { log, closeLogs, logSkill, logEvent } from './logger.mjs'
import { Runner } from './runner.mjs'
import { startReflexes } from './reflex.mjs'
import { attachCommands } from './commands.mjs'
import { snapshot, inventorySummary } from './state.mjs'
import { CognitiveLoop } from './cognitive.mjs'
import { openLessons } from './lessons.mjs'
import { openWorldFacts } from './worldfacts.mjs'
import { startComms } from './comms.mjs'
import { StagnationWatchdog } from './watchdog.mjs'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)

let reconnectDelay = config.reconnect.delayMs
let stopping = false
let stopReflexes = null
let stopComms = null
let worldFacts = null
let cognitive = null
let lessons = null
let watchdog = null
let lastDeathCause = null      // the server's own words, e.g. "fell from a high place"
let peakY = null               // highest point in the recent past, for fall distance
let stopDeathWatch = null
let peakTimer = null
// A death record with no story is a puzzle, not evidence. The old one said
// "bot died" and nothing else; reconstructing a single death meant a separate
// Elasticsearch query against the surrounding minutes, and even the improved
// version ("fell from a high place after falling 47 blocks") does not say what
// the bot had been trying to do.
//
// So carry the last few outcomes and the health trajectory INTO the record.
// Everything goes in `detail`, which is already a mapped text field -- the index
// is dynamic:strict and a new field would be rejected outright.
const hpTrail = []                     // {t, hp} ring, for the dying trajectory
const HP_MAX = 12

// The server broadcasts the real cause. Vanilla death messages all begin with
// the player's name, so match ours and keep the remainder verbatim rather than
// trying to classify it here -- Minecraft has well over a hundred of these and
// a partial list would silently mislabel the ones it missed.
// Two guards, because "starts with our name" is not the same as "is a death".
// "Scout01 joined the game" and "Scout01 left the game" match that shape too,
// and without filtering a death with no captured message would be reported as
// cause "joined the game" -- a plausible-looking record that is simply false.
const NOT_A_DEATH = /^(joined|left) the game$/i

function watchForDeathCause(bot) {
  const onMsg = jsonMsg => {
    try {
      const text = typeof jsonMsg?.toString === 'function' ? jsonMsg.toString() : String(jsonMsg)
      if (!text.startsWith(`${config.bot.name} `)) return
      const rest = text.slice(config.bot.name.length + 1).trim()
      if (!rest || rest.length >= 160 || NOT_A_DEATH.test(rest)) return
      // Timestamped, and only trusted within a few seconds of the death event.
      // A stale message from minutes ago must never be presented as the cause.
      lastDeathCause = { text: rest, at: Date.now() }
    } catch { /* malformed component; the death still logs as unknown */ }
  }
  bot.on('message', onMsg)
  return () => { try { bot.removeListener('message', onMsg) } catch {} }
}

/** The server's words if they arrived with the death, otherwise honestly unknown. */
function freshDeathCause() {
  if (!lastDeathCause) return 'unknown'
  return Date.now() - lastDeathCause.at < 5000 ? lastDeathCause.text : 'unknown'
}

// Coarse buckets so deaths are aggregatable, with the verbatim cause kept in
// detail. Anything unmatched stays 'other' rather than being forced into a
// bucket it does not belong in.
function deathClass(cause = '') {
  const c = String(cause).toLowerCase()
  if (c.includes('fell') || c.includes('hit the ground')) return 'fall'
  if (c.includes('suffocat')) return 'suffocation'
  if (c.includes('drown')) return 'drowning'
  if (c.includes('lava') || c.includes('burn') || c.includes('fire')) return 'fire'
  if (c.includes('slain') || c.includes('shot') || c.includes('blown') || c.includes('blew')) return 'mob'
  if (c.includes('starv')) return 'starvation'
  if (c === 'unknown' || !c) return 'unknown'
  return 'other'
}

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
  // Reason tallies for the pathfinder's own events, kept for the status line.
  const pathResets = {}
  const pathUpdates = {}
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

    // Grant collectblock the one setting it cannot work without, and none of
    // the others. See the note below for why this is a clone and why injecting
    // our own object instead would break gathering outright.
    try {
      if (bot.collectBlock) {
        const gatherMoves = Object.create(Object.getPrototypeOf(moves))
        Object.assign(gatherMoves, moves)
        gatherMoves.canDig = true          // required: safeToBreak() gates on it
        gatherMoves.allowParkour = false
        gatherMoves.allow1by1towers = true
        gatherMoves.maxDropDown = 6
        bot.collectBlock.movements = gatherMoves
      }
    } catch { /* older collectblock without the property: the guard below covers us */ }

    // CLIMBING OUT NEEDS DIFFERENT RULES THAN WALKING AROUND.
    //
    // canDig=false is right for travel -- it is what stops a bot tunnelling 383
    // blocks toward home. It is also why a bot at y=-42 can never leave: A* can
    // only use pre-existing air, and deepslate has very little of it. Three of
    // six bots spent a six-hour run below sea level, where there is no wood, no
    // surface resource of any kind, and the drowning reflex fired 209 times an
    // hour.
    //
    // So `surface` borrows a dig-capable config for the ascent and gives it
    // straight back. dontCreateFlow=true is the important one: it refuses to
    // break any block adjacent to liquid, which is precisely how a bot digging
    // upward out of a flooded cave drowns itself. (It is also the flag
    // collectblock 1.6.0 forces OFF, which is why we pin 1.5.0.)
    //
    // The swap lives here because index.mjs owns setMovements -- the dependency
    // contract asserts nothing else calls it, and that rule is what keeps the
    // collectblock clobber a single known problem instead of a diffuse one.
    const ascendMoves = Object.create(Object.getPrototypeOf(moves))
    Object.assign(ascendMoves, moves)
    ascendMoves.canDig = true
    ascendMoves.allow1by1towers = true
    ascendMoves.dontCreateFlow = true
    ascendMoves.allowParkour = false
    ascendMoves.maxDropDown = 6
    // Exposed so a skill can PROBE with it (getPathTo is read-only) without
    // installing it. Only index.mjs may call setMovements; asking "could I get
    // there if I were allowed to dig?" is a different question from digging.
    bot.ascentMovements = ascendMoves
    bot.withAscentMovements = async (fn) => {
      bot.pathfinder.setMovements(ascendMoves)
      try { return await fn() }
      finally { bot.pathfinder.setMovements(moves) }
    }

    // OUR MOVEMENT CONFIG IS NOT OURS TO KEEP.
    //
    // An earlier version of this comment had the mechanism wrong, and the
    // correction matters because it changes what the right fix is.
    //
    // collectblock does NOT build a fresh Movements per call. In 1.4.1 through
    // 1.6.0 the constructor runs once at loadPlugin time (CollectBlock.js:153):
    //     this.movements = new Movements(bot)        // LIBRARY DEFAULTS
    // and collect() only re-installs that same object (CollectBlock.js:192-195):
    //     this.movements.dontMineUnderFallingBlock = false   // 1.6.0+
    //     this.movements.dontCreateFlow = false              // 1.6.0+
    //     this.bot.pathfinder.setMovements(this.movements)
    // with no restore. Library defaults are canDig=true, allowParkour=true,
    // maxDropDown=4 -- verified against the deployed node_modules.
    //
    // `movements` is a public, documented, writable property, so the obvious
    // fix is to hand collectblock OUR config. THAT WOULD SILENTLY BREAK
    // GATHERING. Its mineBlock() gates every dig on
    //     bot.pathfinder.movements.safeToBreak(block)
    // and pathfinder's safeToBreak returns false immediately when canDig is
    // false. With our config injected, collect() would drop every target and
    // resolve successfully having mined nothing -- no error, no event.
    //
    // The clobber is, right now, the only reason gather works at all.
    //
    // So from each bot's FIRST gather onward, every goto, home, explore,
    // unstick, canStartAPath() and the watchdog's pathability probe has been
    // running with digging on, parkour on, and maxDropDown back at 4. Every
    // failure the comments below blame on other causes is a prediction of this:
    // a bot at y=-3 that "cannot dig its way out" dug its way IN via ordinary
    // navigation, and canDig=true is also why A* blows its 5s budget so often --
    // nearly every solid block becomes a legal move.
    //
    // So the fix is two-sided. Re-assert our config after each gather rather
    // than trusting it survives -- same discipline as llm.mjs sending num_ctx on
    // every request instead of configuring it once, and seizeBody() taking the
    // control states before steering: shared mutable state with no ownership
    // layer must be claimed at each use, not at startup.
    //
    // And narrow the window. collectblock needs canDig=true and nothing else,
    // so give it a CLONE that keeps our safety settings and grants only the
    // digging. Drift during a gather then covers one deliberate setting instead
    // of three accidental ones, and a bot pathing to a tree stops doing parkour
    // and stops taking 4-block drops it was configured not to take.
    //
    // A clone specifically, never `moves` itself: 1.6.0's collect() MUTATES
    // whatever object it is handed, forcing dontMineUnderFallingBlock=false and
    // dontCreateFlow=false on it. Those make it willing to dig under gravel and
    // beside liquid, which at y=-8 is how a bot drowns. Handing it a copy keeps
    // that confined to gathering instead of becoming our permanent config.
    const navFingerprint = m => [
      m.canDig, m.allowParkour, m.allow1by1towers, m.allowSprinting, m.maxDropDown,
      m.scafoldingBlocks?.length, m.blocksCantBreak?.size,
    ].join('|')
    const wanted = navFingerprint(moves)

    bot.assertNav = (where) => {
      try {
        const live = bot.pathfinder?.movements
        if (!live) return false
        const got = navFingerprint(live)
        if (got === wanted) return false
        // Name the keys that actually changed, so this is a diagnosis rather
        // than "something differs".
        const changed = []
        for (const k of ['canDig', 'allowParkour', 'allow1by1towers', 'allowSprinting', 'maxDropDown']) {
          if (live[k] !== moves[k]) changed.push(`${k}: ${live[k]} -> ${moves[k]}`)
        }
        bot.pathfinder.setMovements(moves)
        logEvent({
          kind: 'config_drift', status: 'failed',
          detail: `pathfinder Movements was replaced during ${where}; restored. ${changed.join(', ') || 'fingerprint differed'}`,
          snapshot: snapshot(bot),
        })
        log('warn', 'nav config drifted, restored', { where, changed: changed.join(', ') })
        return true
      } catch { return false }
    }
    // Default is 5s. In dense forest with canDig=false many goals are genuinely
    // unreachable, and A* needs room to prove that rather than reporting
    // "took too long" -- which is indistinguishable from a real failure.
    // 5s, not 10s. This is the PLANNING slice, and the harvest budget that
    // contains it is 40s -- when both were 10s a single expensive A* search
    // consumed the entire allowance and the bot never moved, which gather then
    // reported as "unreachable". It stays well above the 5s default because in
    // dense forest with canDig=false many goals are genuinely unreachable and
    // A* needs room to PROVE that, rather than reporting "took too long" --
    // indistinguishable from a real failure.
    bot.pathfinder.thinkTimeout = 5000

    // WHAT THE PATHFINDER ACTUALLY SAYS, rather than what we infer from the one
    // rejection that happens to escape. goto() collapses a whole route into a
    // single terminal error, so every replan, every chunk load that invalidated
    // a path, and pathfinder's OWN 3500ms stuck reset were invisible -- and we
    // spent 16 hours attributing all of it to "no route exists", a verdict the
    // pathfinder never once returned.
    //
    // Reasons come from resetPath() in mineflayer-pathfinder 2.4.5: stuck,
    // chunk_loaded, block_updated, goal_updated, goal_moved, movements_updated,
    // dig_error, place_error, no_scaffolding_blocks. Each means something
    // different and only some of them are the world's fault.
    bot.on('path_reset', (reason) => {
      pathResets[reason] = (pathResets[reason] ?? 0) + 1
      logEvent({ kind: 'path_reset', detail: reason, snapshot: snapshot(bot) })
    })
    bot.on('path_update', (r) => {
      if (!r || !r.status) return
      pathUpdates[r.status] = (pathUpdates[r.status] ?? 0) + 1
      // Only the terminal verdicts are worth a document; `success` and
      // `partial` fire constantly during normal walking.
      if (r.status === 'noPath' || r.status === 'timeout') {
        logEvent({ kind: `path_${r.status}`,
                   detail: `${r.status} after ${r.visitedNodes ?? '?'} nodes, ${Math.round(r.time ?? 0)}ms`,
                   snapshot: snapshot(bot) })
      }
    })

    // ONE lessons store, shared. Reflexes record where the bot got hurt and
    // the cognitive layer records which actions failed; both feed the same
    // persistent memory, and it must exist before either starts.
    lessons = openLessons()
    // World facts are SHARED across the fleet; lessons stay private. The split
    // is empirical, not a preference: five bots discovered the same hole three
    // separate times and two scouts each burned 25 attempts on the same
    // unreachable goal, while a check for actions avoided by more than one bot
    // found zero overlap at all. Terrain is common knowledge; policy is not.
    worldFacts = openWorldFacts()
    stopReflexes = startReflexes(bot, runner, lessons, worldFacts)
    stopComms = startComms(bot, worldFacts)
    stopDeathWatch = watchForDeathCause(bot)
    // Sample height on a slow timer. Cheap, and it is the only way to know
    // afterwards how far a bot fell -- position at the moment of death tells
    // you where it landed, never where it left.
    peakY = bot.entity?.position?.y ?? null
    clearInterval(peakTimer)
    peakTimer = setInterval(() => {
      const y = bot.entity?.position?.y
      if (y == null) return
      if (peakY == null || y > peakY) peakY = y
      // Decay toward current height so an old peak does not inflate a much
      // later fall.
      else peakY -= Math.min(0.35, (peakY - y) * 0.06)
    }, 1000)
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
      cognitive = new CognitiveLoop(bot, runner, lessons, worldFacts)
      // Only meaningful in autonomous mode -- a chat-driven bot waiting for a
      // command is idle, not stagnant, and the human is the watchdog.
      watchdog = new StagnationWatchdog(bot, runner, cognitive)
      runner.watchdog = watchdog
      watchdog.start()
      // Give chunks a moment to load before the first perception snapshot,
      // otherwise NEARBY is empty and the first decision is made half-blind.
      // Guarded: a disconnect inside this 5s window sets cognitive = null in
      // the 'end' handler, and the timer then threw on null and killed the
      // process outright -- systemd restart, lessons reloaded, world re-entered.
      // Observed at 02:07:38, a kick 5s after spawn. Capture-then-use-after-
      // teardown, the same shape as the reconnect and counter bugs tonight.
      const startTimer = setTimeout(() => {
        if (!cognitive || stopping) return
        cognitive.start()
      }, 5000)
      bot.once('end', () => clearTimeout(startTimer))
      bot.chat(`autonomous mode: ${config.llm.model}`)
    }
  })

  // Health is sampled on the same slow timer as height; a death that took 90
  // seconds looks completely different from one that took 900ms, and the
  // trajectory is what distinguishes suffocation from a fall from a mob.
  bot.on('health', () => {
    hpTrail.push({ t: Date.now(), hp: Math.round((bot.health ?? 0) * 10) / 10 })
    if (hpTrail.length > HP_MAX) hpTrail.shift()
  })

  bot.on('death', () => {
    // "bot died" was the entire record. The CAUSE was sitting in the Paper log
    // the whole time -- "Scout01 fell from a high place" -- in a different
    // index, unjoined, so a death told us nothing about what to fix.
    //
    // Fall distance is captured here rather than inferred later because it is
    // the difference between a navigation bug and a terrain trap. Scout01 died
    // standing still at spawn: full health, 33 blocks down a 1x1 shaft another
    // bot had mined through the world spawn point. No decision log would have
    // shown that; the y-delta does.
    const deathPos = bot.entity?.position
    const fell = deathPos && peakY != null ? Math.round(peakY - deathPos.y) : null
    // WHAT WAS LOST. A death drops the entire inventory, so it is the single
    // largest destroyer of accumulated progress in this world -- and until now
    // the record said only that a death happened. "Miner01 died" and "Miner01
    // died holding the fleet's only stone_pickaxe" are different events, and
    // the second one is the one that explains a stalled milestone chain.
    // Captured BEFORE the respawn clears it.
    const lost = inventorySummary(bot)
    const lostSummary = Object.entries(lost)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([k, n]) => `${k} x${n}`).join(', ')
    const cause = freshDeathCause()
    // Ask the runner, which is the only thing that knows. Reading a variable
    // nothing ever assigned is how every death came to report "no skill
    // running" -- a claim that was not measured, merely printed.
    const running = runner.current?.skill ?? null
    const leadUp = runner.recentSummary()
    log('warn', 'died', { pos: deathPos, cause, fell_blocks: fell, running })
    logSkill({
      skill: '_death', args: {}, status: 'failed',
      detail: `${cause}${fell != null && fell > 3 ? ` after falling ${fell} blocks` : ''}` +
              `${running ? `; was running ${running}` : '; idle at the moment of death'}` +
              (leadUp ? ` | leading up: ${leadUp}` : '') +
              (hpTrail.length > 1
                ? ` | hp ${hpTrail[0].hp}->${hpTrail[hpTrail.length - 1].hp} over ` +
                  `${Math.round((hpTrail[hpTrail.length - 1].t - hpTrail[0].t) / 1000)}s`
                : '') +
              (lostSummary ? ` | dropped: ${lostSummary}` : ' | carried nothing'),
      // camelCase: logSkill destructures `failClass` and maps it to the
      // Elasticsearch field `fail_class` itself. Passing the snake_case name
      // meant logSkill silently ignored it, and 23 death records were written
      // with no cause class -- which is why the "deaths by cause" panel was
      // empty even after the cause capture was working.
      failClass: deathClass(cause),
      startedAt: Date.now(), snapshot: snapshot(bot), trigger: 'death',
    })
    lastDeathCause = null
    peakY = null
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
    if (stopComms) { stopComms(); stopComms = null }
    if (stopDeathWatch) { stopDeathWatch(); stopDeathWatch = null }
    clearInterval(peakTimer)
    if (cognitive) { cognitive.stop(); cognitive = null }
    if (watchdog) { watchdog.stop(); watchdog = null }
    try { lessons?.save() } catch {}
    if (stopping) return
    // JITTER. Every bot on this host shares one source IP, and Paper's
    // connection-throttle is per-IP (4000ms here) -- so bots thrown off
    // together retry together, collide again, and stay in lockstep. A
    // thundering herd of our own making. Observed live: Scout02 kicked
    // "Connection throttled!" at 01:19:51 and again at 01:20:07, sitting
    // offline the whole time while its systemd unit reported 'active'.
    //
    // Randomising each delay breaks the lockstep; the floor keeps a lone
    // retry from landing inside the throttle window by itself.
    const delay = Math.max(reconnectDelay, 5000) + Math.floor(Math.random() * 6000)
    log('warn', 'disconnected, will reconnect', { reason: String(reason), delayMs: delay })
    setTimeout(connect, delay)
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
