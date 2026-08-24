// Entry point. Owns the bot lifecycle: connect, recover, reconnect.
//
// Handoff doc S22 acceptance criteria 8 and 12 are about survival, not
// intelligence -- recover after death or disconnection, and run four hours
// without unrecoverable failure. That is what this file is for.

import net from 'node:net'
import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
const { pathfinder, Movements } = pathfinderPkg
import collectBlockPkg from 'mineflayer-collectblock'
const collectBlock = collectBlockPkg.plugin ?? collectBlockPkg

import { config } from './config.mjs'
import { pathfinderWedged, stillnessMs } from './path-watchdog.mjs'
import { log, closeLogs, logSkill, logEvent } from './logger.mjs'
import { Runner } from './runner.mjs'
import { startReflexes } from './reflex.mjs'
import { installAirTrace } from './air-trace.mjs'
import { startChunkEvictor } from './evictor.mjs'
import { attachCommands } from './commands.mjs'
import { snapshot, inventorySummary } from './state.mjs'
import { installPathBackoff } from './pathbackoff.mjs'
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
  // Change WHICH half-finished route survives a timeout. See pathbackoff.mjs --
  // this patches the shared AStar prototype, so it affects every search the
  // fleet runs, not only the ones we start ourselves.
  installPathBackoff()

  bot.loadPlugin(collectBlock)
  const runner = new Runner(bot)

  // MEMORY, WHICH NOTHING WAS WATCHING.
  //
  // On 2026-08-10 the kernel OOM killer took 26 bots in six hours -- gather2
  // x16, solo2 x7, gatherer x2, hive1 x1, with peaks of 5-10.2G on an 11.3G
  // host. Every one was role=gatherer; scout and miner were never touched. It
  // had been happening all day and no dashboard, guard or log line mentioned
  // memory, so it presented as bots that mysteriously wedged and reconnected.
  //
  // --heapsnapshot-near-heap-limit=1 fired three times and wrote three
  // ZERO-BYTE snapshots: dumping a 3G heap needs several more gigabytes, so the
  // process was killed mid-write. The diagnostic died of the disease.
  //
  // rss vs heapUsed vs external is the split that decides where to look: V8
  // objects (a heap leak, and --max-old-space-size will eventually throw), or
  // native allocations like Buffers and chunk data (which that flag cannot see
  // and which no heap snapshot will show). Journal-only on purpose -- the
  // telemetry index is dynamic:strict and this is a diagnosis, not a schema.
  // SAMPLE FAST, LOG ON CHANGE. The first version sampled once a minute, which
  // is the wrong instrument for this shape: every bot sits flat at ~180MB for
  // hours, and gather2 went from nothing to 1.2GB in 67 SECONDS. That is not a
  // leak with a slope, it is a runaway allocation, and a 60s interval would
  // catch one point on the ramp or none at all.
  //
  // So poll every 10s and emit only when RSS actually moves, plus a heartbeat.
  // The ramp gets four or five points; an idle bot still writes one line every
  // five minutes instead of thirty.
  //
  // `doing` is the whole point of logging it here rather than from outside: an
  // external sampler can see the memory but not which skill was running when it
  // took off. That is the question.
  const MB = n => Math.round(n / 1048576)
  let lastRss = 0, lastLog = 0
  const memTimer = setInterval(() => {
    const m = process.memoryUsage()
    const rss = MB(m.rss)
    const moved = Math.abs(rss - lastRss) >= 40
    if (!moved && Date.now() - lastLog < 300_000) return
    lastRss = rss; lastLog = Date.now()
    log(moved && rss > 400 ? 'warn' : 'info', 'memory', {
      rss_mb: rss, heap_used_mb: MB(m.heapUsed), heap_total_mb: MB(m.heapTotal),
      external_mb: MB(m.external), array_buffers_mb: MB(m.arrayBuffers),
      doing: runner.describe?.() ?? 'unknown',
    })
  }, 10_000)
  memTimer.unref?.()

  // Reason tallies for the pathfinder's own events, kept for the status line.
  const pathResets = {}
  const pathUpdates = {}
  // AIR PACKET TRACE -- observability only, off unless switched on.
  //
  // AIR_TRACE_MIN=<minutes> records every entity_metadata packet that moved
  // bot.oxygenLevel, with the entity's name attached, so the question "is the
  // drowning reflex reading fish" is answered by the wire rather than by me.
  // Nothing about the bot's behaviour changes; see air-trace.mjs for why this
  // exists and what it cost not to have it.
  const traceMin = Number(process.env.AIR_TRACE_MIN || 0)
  if (traceMin > 0) {
    const stopTrace = installAirTrace(bot, {
      dir: config.log.dir, name: config.bot.name, minutes: traceMin,
    })
    log('warn', 'air trace recording', { minutes: traceMin, file: `air-trace-${config.bot.name}.jsonl` })
    process.once('exit', stopTrace)
  }

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
    // A PILLAR STEP MUST NOT BE AS CHEAP AS A WALK STEP.
    //
    // pathfinder prices getMoveUp at 1 (move) + placeCost (1) = 2, against 1 to
    // walk -- so towering up is only twice the cost of stepping sideways, and
    // with allow1by1towers=true A* reaches for it constantly. Baritone prices
    // the same action at roughly 5.4 walk steps (blockPlacementPenalty=20 on top
    // of a jump), and says plainly that the number is high to CONSERVE BLOCKS
    // rather than to model time.
    //
    // Miner01 pillared 14 blocks straight up, reported arrival because the old
    // check was horizontal-only, then could not get back down -- and every
    // later goto and craft was issued from a column A* could not leave. One bot
    // stranded that way produced about a third of that run's goto failures.
    //
    // 5 keeps towering available for the case it exists for and stops it being
    // the planner's first idea.
    moves.placeCost = 5
    // A WATER STEP MUST NOT BE AS CHEAP AS A LAND STEP.
    //
    // Default liquidCost is 1 -- water priced like pavement -- so A* routinely
    // planned straight across lakes, and Block 1 paid for it: drowning near
    // water was the top death cause, the drowning-route reflex fired 300+
    // times per bot-hour in the worst cases, and the biggest producer donated
    // its inventory to the lake floor repeatedly. The bots do not need to
    // cross water; they need to stop volunteering for it. At 10, a detour of
    // up to ~10 land steps per water step wins, which in this terrain turns
    // almost every lake crossing into a shoreline walk. Deliberately NOT
    // Infinity: if water is genuinely the only route, taking it (and letting
    // the reflex layer fight for the bot) still beats standing still forever.
    moves.liquidCost = 10

    // ...AND liquidCost DOES NOT PRICE ENTERING WATER. It prices being wet.
    //
    // movements.js:398 reads `if (this.getBlock(node, 0, 0, 0).liquid) cost +=
    // this.liquidCost` -- node 0,0,0 is the CURRENT block, so the penalty lands
    // when a wet bot moves, never when a dry one steps in. A step from grass
    // into a lake costs 1, exactly like a step onto more grass. The comment
    // above claims "a detour of up to ~10 land steps per water step wins";
    // that was never what the code did, and twelve hours of telemetry says so:
    // 3,090 drowning reflex firings, 2,241 of them at y60-69 against a sea
    // level of 63, and every one of the last nine deaths.
    //
    // exclusionAreasStep IS priced on the destination (movements.js:122, applied
    // at :367 and again inside safeOrBreak at :284), so it is the hook that
    // makes entering water expensive. Per forward move it lands two or three
    // times:
    //
    //     land -> shallow water   1 + 2N        = 51
    //     land -> deep water      1 + 3N        = 76
    //     water -> deep water     1 + 3N + 10   = 86
    //
    // 25 IS THE LARGEST SAFE VALUE, and that is arithmetic rather than taste.
    // Every one of the fifteen `if (cost > 100) return` guards DELETES the
    // neighbour outright, so at N=30 a wet bot's next wet step costs 101 and
    // water stops existing for the planner. That would trade drowning for
    // immobility -- a bot in a flooded cave could not swim out, and the only
    // route home across a river would vanish. 25 keeps every wet move legal
    // while making a one-block paddle cost about as much as a 25-block walk
    // around, which is the trade we actually want.
    const WATER_ENTRY_COST = 25
    const waterEntryPenalty = (block) => (block?.liquid ? WATER_ENTRY_COST : 0)
    moves.exclusionAreasStep = [waterEntryPenalty]
    // ORDER IS LOad-BEARING: gatherMoves, ascendMoves and descendMoves are all
    // built below with Object.assign(clone, moves), so they copy this array's
    // reference and inherit one shared policy. That is deliberate -- gathering
    // is not worth drowning for, and a descent profile should not treat "jump
    // in the lake" as a cheap way off a ledge. Moving this line below the
    // clones would silently exempt three of the four configs.
    //
    // Ascent keeps it too. A bot in a flooded cave is ALREADY wet, so the entry
    // price does not gate its first move; it only stops the climb preferring a
    // lateral swim when a dry way up exists. dontCreateFlow stays the guard
    // against digging into water.

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

    // GETTING DOWN IS A DIFFERENT PROBLEM FROM GETTING OUT, and neither travel
    // nor the ascent config can do it.
    //
    // 61% of fleet activity is at or above sea level and that is where
    // stranding dominates -- 5,115 stranded and 3,340 no_path at y=60-79 alone
    // over seven days, against 40,696 events in the deep caves everyone assumes
    // is the problem. Bots DIE underground; they LOSE THEIR TIME up here.
    //
    // The binding constraint is maxDropDown=6, in BOTH configs. A bot on a
    // ledge or on top of its own tower, where every exit is a 7+ block drop,
    // has no legal first move -- which is exactly the "no route out of here
    // even with digging allowed, 26 blocks short" the logs keep reporting.
    // Twenty-six blocks is not distance and not terrain, it is a local descent
    // constraint.
    //
    // Three deliberate differences from the ascent config:
    //   canDig stays FALSE. This is a controlled step down, not excavation.
    //     Digging down manufactures the one-way shaft that maroons bots, which
    //     is the failure mode the whole marooned/pillarOut apparatus exists to
    //     undo. Non-destructive or not at all.
    //   allow1by1towers goes FALSE. With towers legal, A* can answer "I cannot
    //     get down" by climbing HIGHER to find a route, making the perch worse
    //     while reporting progress.
    //   maxDropDown rises to 8, and ONLY here. Fall is already 169 of 868
    //     deaths, so raising it globally would price bigger drops as ordinary
    //     travel everywhere. Vanilla fall damage is (blocks-3) half-hearts, so
    //     eight blocks costs at most 2.5 hearts -- survivable, and the caller
    //     gates on health besides.
    const descendMoves = Object.create(Object.getPrototypeOf(moves))
    Object.assign(descendMoves, moves)
    descendMoves.canDig = false
    descendMoves.allow1by1towers = false
    descendMoves.allowParkour = false
    descendMoves.maxDropDown = 8
    bot.descentMovements = descendMoves
    bot.withDescentMovements = async (fn) => {
      bot.pathfinder.setMovements(descendMoves)
      try { return await fn() }
      finally { bot.pathfinder.setMovements(moves) }
    }

    // WATER IS TERRAIN. THE OTHER FOUR PROFILES EXIST TO REFUSE IT.
    //
    // Every profile above inherits one shared `exclusionAreasStep`, and that
    // sharing is deliberate: gathering is not worth drowning for. The result is
    // an agent that prices a wet step at ~86 against ~1 on land and, with the
    // fifteen `cost > 100` guards, treats open water as very nearly a wall. The
    // comment above says the quiet part out loud -- "the bots do not need to
    // cross water" -- and that was a correct read of Block 1, where drowning was
    // the top death cause.
    //
    // It is not a correct read of Minecraft. Water is most of many worlds, and a
    // platform meant to work in ANY Minecraft environment cannot treat the
    // majority of the map as a failure mode. Measured 2026-08-22: bots swam 50
    // to 70 blocks between consecutive "no shore" events, and two walked out
    // onto land unaided, while every one of those events was logged as a failed
    // rescue. They were travelling. We had no word for it.
    //
    // So this profile is the word for it. It is NOT the default and must never
    // become it: a bot does not get to volunteer for water. It is selected only
    // by a skill that has decided to cross, the same way ascentMovements is
    // selected only by a climb.
    const waterMoves = Object.create(Object.getPrototypeOf(moves))
    Object.assign(waterMoves, moves)
    // The entry penalty is the whole reason water is unreachable, and unlike the
    // other profiles this one REPLACES the array rather than inheriting the
    // shared reference. Entering the water is the point of the manoeuvre.
    waterMoves.exclusionAreasStep = []
    // Surface swimming is real travel -- about 5.6 m/s sprint-swimming against
    // 4.3 walking -- so a wet step is priced slightly ABOVE a land step rather
    // than as a catastrophe. Not 1: crossing still carries drowning risk that
    // walking does not, and a route that hugs a shoreline for free should still
    // win over one that strikes out to sea.
    waterMoves.liquidCost = 2
    // Digging while swimming drops the bot into water it cannot leave, and a
    // 1x1 tower built from a boat is not a thing. Both off.
    waterMoves.canDig = false
    waterMoves.allow1by1towers = false
    waterMoves.allowParkour = false
    waterMoves.dontCreateFlow = true
    bot.waterMovements = waterMoves
    bot.withWaterMovements = async (fn) => {
      bot.pathfinder.setMovements(waterMoves)
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
    // THE WEDGED-GOAL WATCHDOG. See src/path-watchdog.mjs for the mechanism;
    // in short, pathfinder 2.4.5 can hold a goal with an empty path forever and
    // emits nothing at all while it does, so this samples position instead.
    //
    // setGoal lives here rather than in the watchdog module because index.mjs is
    // one of the declared movement owners; adding a second writer is the
    // multi-writer bug the ratchet exists to prevent.
    const posSamples = []
    setInterval(() => {
      try {
        if (!bot.entity?.position) return
        const now = Date.now()
        const p = bot.entity.position
        posSamples.push({ x: p.x, y: p.y, z: p.z, t: now })
        while (posSamples.length > 40) posSamples.shift()
        const wedged = pathfinderWedged({
          hasGoal: !!bot.pathfinder?.goal,
          moving: bot.pathfinder?.isMoving?.() ?? false,
          mining: bot.pathfinder?.isMining?.() ?? false,
          building: bot.pathfinder?.isBuilding?.() ?? false,
          // The runner's answer, not the pathfinder's. See path-watchdog.mjs:
          // mine/gather dig outside the pathfinder, so its own flags say nothing.
          busy: runner?.isBusy?.() ?? false,
          stillFor: stillnessMs(posSamples, now),
        })
        if (!wedged) return
        logEvent({
          kind: 'pathfinder_wedged', status: 'failed',
          detail: `goal held with an empty path and no movement for ` +
                  `${Math.round(stillnessMs(posSamples, now) / 1000)}s — clearing it ` +
                  `(upstream issue #273 emits no event for this state)`,
          snapshot: snapshot(bot),
        })
        bot.pathfinder.setGoal(null)
        posSamples.length = 0
      } catch { /* not connected */ }
    }, 2000)

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
    // Bound the bot's world model. Without this every process reached its 1GB
    // cgroup ceiling in about fifteen hours -- not in the JS heap, which stayed
    // flat at 172MB, but in ArrayBuffers holding chunk columns nothing released.
    // See evictor.mjs: the radius is a CORRECTNESS bound, not a memory knob.
    startChunkEvictor(bot)
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
      // A DEBUG VIEWER MUST NOT BE ABLE TO KILL THE AGENT.
      //
      // EADDRINUSE ARRIVES AS AN EVENT, NOT AS A THROW. The try/catch that used
      // to wrap this looked like it handled a failed viewer and could never have
      // caught the only failure that actually happens: net emits 'error' on the
      // server asynchronously, nothing is listening, and Node's default for an
      // unhandled 'error' event is to throw and exit.
      //
      // 2026-08-10: a restart left the previous process holding port 3015 for a
      // moment. solo1 came up, hit EADDRINUSE, and DIED -- over a viewer.
      // systemd restarted it instantly, Paper answered "Connection throttled!",
      // it died again. Ten bots doing that drove the host to load 20.48, which
      // starved sshd to the point of failing banner exchange and hung the bots
      // that had not crashed. The whole fleet was down for ~15 minutes because
      // an optional debugging convenience could not bind a socket.
      //
      // Probe first and skip the viewer if the port is busy. Ports are per-bot,
      // so the only real collision is a bot restarting over its own stale
      // listener -- exactly what this catches, and it catches it without
      // touching the process's error semantics.
      const probe = net.createServer()
      probe.once('error', e => {
        log('error', 'viewer port busy — running WITHOUT a viewer (the bot is fine)',
          { port: config.viewer.port, err: e.code ?? e.message })
      })
      probe.once('listening', () => probe.close(() => {
        try {
          const { mineflayer: mineflayerViewer } = require_('prismarine-viewer')
          mineflayerViewer(bot, { port: config.viewer.port, firstPerson: config.viewer.firstPerson })
          log('info', 'viewer started', { url: `http://<host>:${config.viewer.port}`, firstPerson: config.viewer.firstPerson })
        } catch (e) {
          log('error', 'viewer failed to start', { err: e.message })
        }
      }))
      probe.listen(config.viewer.port)
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
