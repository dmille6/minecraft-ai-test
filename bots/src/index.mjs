// Entry point. Owns the bot lifecycle: connect, recover, reconnect.
//
// Handoff doc S22 acceptance criteria 8 and 12 are about survival, not
// intelligence -- recover after death or disconnection, and run four hours
// without unrecoverable failure. That is what this file is for.

import { Vec3 } from 'vec3'
import { corridorSafe } from './lavaguard.mjs'
import { deathSiteStepCost, pathCrossesDeathSite } from './deathsites.mjs'
import { pathDropProfile, describeFallPath } from './fallpath.mjs'
import net from 'node:net'
import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
const { pathfinder, Movements } = pathfinderPkg
import collectBlockPkg from 'mineflayer-collectblock'
const collectBlock = collectBlockPkg.plugin ?? collectBlockPkg

import { config } from './config.mjs'
import { withApproachBound } from './digapproach.mjs'
import { extendScaffolding } from './scaffold.mjs'
import { pathfinderWedged, stillnessMs } from './path-watchdog.mjs'
import { log, closeLogs, logSkill, logEvent } from './logger.mjs'
import { Runner } from './runner.mjs'
import { startReflexes } from './reflex.mjs'
import { installAirTrace } from './air-trace.mjs'
import { startChunkEvictor } from './evictor.mjs'
import { attachCommands } from './commands.mjs'
import { snapshot, inventorySummary } from './state.mjs'
import { travelTool } from './toolfor.mjs'
import { diffTools } from './toolwatch.mjs'
import { installPathBackoff } from './pathbackoff.mjs'
import { attachPacketWitness } from './packet-witness.mjs'
import { installOxygenGuard } from './oxygen.mjs'
import { installShoreEgress } from './watermoves.mjs'
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

let lastFallRecordAt = 0
/**
 * The fall record (fallpath.mjs): how far the peak sampler says the bot came down, what was running, which controls
 * were held, and what the planner had last asked for. 'death' rows carry the server's cause class; 'damage' rows are
 * CANDIDATE descent-associated injuries (health fell while grounded after a >= 6-block peak) -- lava, a grounded
 * drowning tick or any other damage after a descent satisfies that too, so the row names the feet and head cells
 * and the reader filters. Never throws: the fallback row carries no snapshot.
 */
function fallRecord(bot, runner, fell, kind, { cause = null, dHealth = null } = {}) {
  lastFallRecordAt = Date.now()
  let detail
  try {
    const last = bot.lastPlannedPath?.() ?? null
    const ctl = bot.controlState ? Object.entries(bot.controlState).filter(([, v]) => v).map(([k]) => k).join('+') || 'none' : '?'
    const pos = bot.entity?.position; const feet = pos ? bot.blockAt(pos)?.name : '?'; const head = pos ? bot.blockAt(pos.offset(0, 1, 0))?.name : '?'
    detail = `${kind}${cause ? ` (${cause})` : ''}: peak-to-here ${fell} blocks${dHealth != null ? `, health ${dHealth}` : ''}${runner?.current?.skill ? ` running ${runner.current.skill}` : ' idle'}; controls ${ctl}; feet ${feet} head ${head}; ${describeFallPath(last)}`
  } catch (e) { detail = `${kind}: peak-to-here ${fell} blocks; record failed: ${String(e?.message ?? e).slice(0, 60)}` }
  try { logEvent({ kind: 'fall_path', status: kind === 'death' ? 'failed' : 'no_effect', detail: detail.slice(0, 290), snapshot: snapshot(bot) }) }
  catch { try { logEvent({ kind: 'fall_path', status: 'failed', detail: detail.slice(0, 290) }) } catch { /* telemetry must never take the bot down */ } }
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

  // Two counters that answer a question every other field we log is blind to:
  // is the world model wrong, or is the server holding the bot still? See
  // packet-witness.mjs -- `onGround` cannot separate those and reading it as
  // if it could is a measurement that was already retracted once.
  bot.packetWitness = attachPacketWitness(bot)

  // BEFORE the pathfinder, before anything that might read breath. mineflayer
  // writes bot.oxygenLevel from any entity's metadata, so on an ocean world a
  // passing cod owns this bot's breath meter. See oxygen.mjs.
  installOxygenGuard(bot)

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
    // THE PATHFINDER'S OWN DIGS USED THE FASTEST TOOL. mineflayer-pathfinder assigns `bestHarvestTool` as a plain
    // property and calls it before every travel dig, so the override is the whole fix: the cheapest tool that can
    // harvest the block, with the durability floor (iron-retention plan v3, 2026-09-15). Installed on spawn, not at
    // loadPlugin time: plugins are injected after login, so bot.pathfinder does not exist yet up there (Codex pass 1).
    if (bot.pathfinder) bot.pathfinder.bestHarvestTool = block => travelTool(block, bot.inventory?.items?.() ?? [], bot.heldItem)
    // Tool losses, named: a debounced inventory diff (300 ms, so a hotbar swap settles) logs `tool_broke` (the lost
    // copy had two or fewer uses left) or `tool_gone` (it did not -- a deposit, a drop, a death; the read reconciles).
    // Durability is copied as VALUES: prismarine-item's durabilityUsed is a prototype getter that a spread drops.
    const toolShot = () => (bot.inventory?.items?.() ?? []).map(it => ({ name: it.name, type: it.type, count: it.count, slot: it.slot, durabilityUsed: it.durabilityUsed, maxDurability: it.maxDurability }))
    let toolItemsBefore = toolShot(), toolDiffTimer = null   // captured at install, so a loss on the first update is seen (Codex pass 2)
    const onSlot = () => {
      if (toolDiffTimer) return
      toolDiffTimer = setTimeout(() => {
        toolDiffTimer = null
        const now = toolShot()
        try {
          for (const d of diffTools(toolItemsBefore, now)) {
            logEvent({ kind: d.broke ? 'tool_broke' : 'tool_gone', status: 'no_effect', detail: `${d.name} x${d.lost}; the lost copy had ${d.least === Infinity ? '?' : d.least} of ${d.max ?? '?'} uses left`, snapshot: snapshot(bot) })
          }
        } catch {}
        toolItemsBefore = now
      }, 300)
    }
    bot.inventory?.on?.('updateSlot', onSlot)
    bot.once('end', () => { clearTimeout(toolDiffTimer); toolDiffTimer = null; bot.inventory?.off?.('updateSlot', onSlot) })
    // THE ACTUATOR GATE (src/arbiter.mjs): with ARBITER=1 every dig, placement,
    // control state and pathfinder goto is refused unless its async context is
    // the arbiter's current holder (or the body is free). Installed before the
    // movement profiles so the pathfinder's goto is the wrapped one.
    if (config.reflex.arbiter && runner?.arb) {
      // The refusal names its CALL SITE (first frame outside arbiter.mjs and node internals): corpus run 5
      // (2026-09-13) showed 86 refused control states on one fixture and no way to tell which unrouted path wrote them.
      const site = () => { const st = (new Error().stack || '').split('\n').slice(1); const f = st.find(l => !/arbiter\.mjs|node:internal|index\.mjs/.test(l)) || st[2] || ''; return f.replace(/^\s*at\s+/, '').replace(/^.*\/bots\//, '').replace(/\?.*$/, '').slice(0, 80) }
      runner.arb.installActuatorGate(bot, { onRefuse: (name, ctx, holder, bound) => logEvent({ kind: 'arbiter_actuator_refused', status: 'no_effect', detail: `${name} from ${ctx?.owner ?? 'an unrouted caller'} while ${holder?.owner ?? 'nobody'} holds the body (tick bound to ${bound?.owner ?? 'nobody'}) | at ${site()}`, snapshot: snapshot(bot) }) })
    }
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
    // ...AND allow1by1towers IS INERT UNLESS THE BLOCK IS ON THIS LIST.
    //
    // mineflayer-pathfinder seeds `scafoldingBlocks` (its spelling) with exactly
    // two ids -- dirt and cobblestone -- and getMoveUp bails on
    // `node.remainingBlocks === 0`. Nothing here ever extended it, so a bot
    // holding anything else could not tower, and A* returned NO PATH rather than
    // "you could climb". Measured 2026-08-31 on the 32 permanently frozen bots:
    // 7 of 10 sampled carried zero pathfinder-usable scaffold while holding
    // plenty of blocks -- board-a-Bravo sat on 83 SAND, isolated-b-Comet on 75,
    // hive-b-Comet on 24 andesite. `surface` succeeded 490/913 times above
    // y=60 and 0 times in 1,902 calls below it.
    //
    // FALLING BLOCKS ARE DELIBERATELY EXCLUDED. `scafoldingBlocks` is used for
    // horizontal bridging as well as towering, and a sand bridge falls out from
    // under the bot. Straight-up pillaring with sand is fine, so `shaftAscend`
    // keeps its wider SCAFFOLD set for that; this list is only what A* may plan
    // a bridge with.
    extendScaffolding(moves, bot.registry)
    moves.allowParkour = false        // parkour is the top source of stuck states

    // BEFORE the derived profiles below, so gatherMoves/ascendMoves/descendMoves
    // all inherit it through their Object.assign. Without this a bot floating
    // beside a shore is offered five moves and not one of them is onto the land:
    // water has no collision shape, so the block under a swimmer reports its
    // height as the block's base and a one-block step out measures as a
    // two-block climb. See watermoves.mjs.
    installShoreEgress(moves)
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
    // WATER IS TERRAIN, PRICED AT WHAT IT COSTS TO CROSS.
    //
    // This was 10, with the stated intent "the bots do not need to cross water;
    // they need to stop volunteering for it." That was written when swimming did
    // not work. It does: mineflayer-pathfinder aims at the next node, holds
    // `forward`, and holds `jump` whenever `isInWater` (index.js:607-613). We
    // priced out a working feature and then built `swim_to` and a rescue reflex
    // to replace it.
    //
    // What the old price actually bought, measured over 636 bot-hours: water was
    // still 32% of every skill record, so it never kept bots dry. It only
    // removed their ROUTE once wet -- a wet step cost 86 against a 100-cost
    // threshold where pathfinder deletes the neighbour outright. That is why
    // 20 of 20 drowning deaths were `idle` with nobody owning the body.
    //
    // Surface swimming is 2.2 m/s against a walk of ~4.3 -- 1.95x slower. 2
    // prices the stroke at just above its real time cost; the risk premium
    // lives in the entry penalty below, where it belongs, because entering is
    // the decision and being wet is the consequence.
    moves.liquidCost = 2

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
    // 25 was chosen as "the largest safe value" under the old regime, where the
    // goal was to make water nearly unreachable without deleting it outright.
    // At 1 the arithmetic gives land->shallow 3, land->deep 4, water->deep 6
    // against a land step of 1. A wet step therefore costs about six paces --
    // three times its real time cost, which is the risk premium -- and a
    // 20-block crossing comes to 118 against the ~150 paces of shore walk it
    // replaces. So a bot swims a lake rather than walking a long way round it,
    // and still prefers a SHORT walk round. I first set this to 2 and the test
    // rejected it: a 20-block crossing came to 197 and still lost to a 150-step
    // detour, which is the old policy wearing smaller numbers.
    //
    // This is NOT a return to Block 1's liquidCost=1 with no entry price at
    // all, which ran alongside broken swimming and made drowning the top death
    // cause.
    //
    // TOO EXPENSIVE still looks like: bots walking long shore detours where a
    // short swim is obviously cheaper, and wet bots with no route out.
    // TOO CHEAP looks like: water's share of routes rising faster than water's
    // share of terrain, crossings ATTEMPTED rising without crossings COMPLETED,
    // and drowning damage per bot-hour going up.
    const WATER_ENTRY_COST = 1
    const waterEntryPenalty = (block) => (block?.liquid ? WATER_ENTRY_COST : 0)
    // DEATH SITES ARE PRICED, NOT ADVISED (deathsites.mjs; docs/reports/deaths-review-2026-09-16.md). The pool's
    // recorded deaths are read from world facts every 20 s (a file read, never per node) and every destination cell
    // within 6 blocks and 6 y of one costs 25 -- three chargings per move stay under the 100 that deletes a
    // neighbour, so the disc is a detour, never a wall. Shared by every profile below (the array reference is
    // copied) and added again to waterMoves, which replaces the array on purpose.
    let deathSites = []
    const refreshDeathSites = () => { try { deathSites = worldFacts?.deathSites?.() ?? [] } catch { deathSites = [] } }
    // Refreshed on a timer and right after this bot's own death is published (below), never inside the per-node
    // callback (Codex pass 2: a file read inside an A* step). The callback only scans the cached array.
    const deathSitesTimer = setInterval(refreshDeathSites, 20_000); deathSitesTimer.unref?.()
    bot.once('end', () => clearInterval(deathSitesTimer))
    const deathSitePenalty = (block) => deathSiteStepCost(deathSites, block)
    bot.deathSitesNow = () => deathSites
    bot.refreshDeathSites = refreshDeathSites
    moves.exclusionAreasStep = [waterEntryPenalty, deathSitePenalty]
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

    bot.pathfinder.setMovements(moves); bot.movementProfile = 'walk'
    // THE DIG-CAPABLE APPROACH, WHICH GATHER LOST BY ACCIDENT.
    //
    // This clone existed only inside `if (bot.collectBlock)`. It had readers --
    // `breakVetoAt` and `isSafeToBreak` both resolve their movements object as
    // `bot.collectBlock?.movements ?? bot.pathfinder?.movements`, and its
    // canDig=true is what makes safeToBreak answer at all, so the assignment
    // below is LOAD-BEARING and must not be deleted as dead. What it never had
    // was a user on the WALK: collectblock has been off by default since
    // COLLECTBLOCK_ENABLED, so from that day the approach to a gather target
    // ran on the TRAVEL profile, which may not break a block to get anywhere.
    // The dig-capable profile reached the break predicate and never reached A*.
    //
    // Measured on 48 scenes read off the live fleet by RCON -- real bot
    // positions, real refused blocks, the surrounding world scanned cell by
    // cell -- the travel profile reaches a legal mining stance in 10 of 48 and
    // this one reaches it in 47. In 35 of the 48 a legal stance existed and was
    // simply behind a wall. See src/digapproach.mjs for the numbers and for the
    // two bounds that keep this from being the 3.3 GB OOM again.
    //
    // Built unconditionally now, and exposed the same way ascentMovements is:
    // a skill may PROBE with it (getPathFromTo is read-only) and may borrow it
    // for one bounded walk, but only index.mjs calls setMovements.
    const gatherMoves = Object.create(Object.getPrototypeOf(moves))
    Object.assign(gatherMoves, moves)
    gatherMoves.canDig = true          // required: safeToBreak() gates on it
    gatherMoves.allowParkour = false
    gatherMoves.allow1by1towers = true
    gatherMoves.maxDropDown = 6
    // NEVER OPEN A WALL WITH WATER OR LAVA BEHIND IT. The ascent profile below
    // has carried this flag since the flooded-cave drownings; the approach
    // profile did not, and in the 14 bot-hours 6d1fdba ran fleet-wide
    // (2026-09-11 00:15-00:26, a deploy-wrapper defect) five bots died
    // against zero in the f9ddbc4 windows either side -- two of them in a
    // gather, one drowned "sealed, no route up or out", one fallen 46 blocks.
    // Refusing any dig adjacent to liquid costs a few approaches and buys the
    // one thing the observer cannot log, because a bot that dies mid-walk
    // never reaches the log line.
    gatherMoves.dontCreateFlow = true
    bot.gatherMovements = gatherMoves
    bot.withGatherMovements = async (fn) => {
      bot.pathfinder.setMovements(gatherMoves); bot.movementProfile = 'gather'
      // The plan was admitted under a cost cap; the walk's own re-plans were
      // not, because bot.pathfinder.searchRadius is -1. Hold them to the same
      // cap for the duration. See withApproachBound.
      try { return await withApproachBound(bot, fn) }
      finally { bot.pathfinder.setMovements(moves); bot.movementProfile = 'walk' }
    }
    // Grant collectblock the one setting it cannot work without, and none of
    // the others. See the note below for why this is a clone and why injecting
    // our own object instead would break gathering outright.
    try {
      if (bot.collectBlock) bot.collectBlock.movements = gatherMoves
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
      bot.pathfinder.setMovements(ascendMoves); bot.movementProfile = 'ascend'
      try { return await fn() }
      finally { bot.pathfinder.setMovements(moves); bot.movementProfile = 'walk' }
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
      bot.pathfinder.setMovements(descendMoves); bot.movementProfile = 'descend'
      try { return await fn() }
      finally { bot.pathfinder.setMovements(moves); bot.movementProfile = 'walk' }
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
    waterMoves.exclusionAreasStep = [deathSitePenalty]   // the water entry price goes; the death price stays (a drowning site is a death site)
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
      bot.pathfinder.setMovements(waterMoves); bot.movementProfile = 'water'
      try { return await fn() }
      finally { bot.pathfinder.setMovements(moves); bot.movementProfile = 'walk' }
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
          // HOW LONG THAT SKILL HAS OWNED THE BOT. The `busy` exemption defers
          // to the skill's own timeout, and on 2026-08-25 that timeout fired and
          // the skill ignored it for 83 minutes -- so `busy` alone kept this
          // watchdog looking away from the only bot that needed it. Past the
          // timeout the exemption's justification is already disproven.
          skillElapsedMs: runner?.current ? now - runner.current.startedAt : 0,
          skillTimeoutMs: config.skills.defaultTimeoutMs,
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

    let lavaCorridorLoggedAt = 0
    let deathSiteCrossLoggedAt = 0
    let lastPlannedPath = null
    bot.lastPlannedPath = () => lastPlannedPath
    bot.on('path_reset', (reason) => {
      if (lastPlannedPath?.active) { lastPlannedPath.active = false; lastPlannedPath.endedBy = `reset:${reason}`; lastPlannedPath.endedAt = Date.now() }
      pathResets[reason] = (pathResets[reason] ?? 0) + 1
      logEvent({ kind: 'path_reset', detail: reason, snapshot: snapshot(bot) })
    })
    bot.on('path_update', (r) => {
      if (!r || !r.status) return
      pathUpdates[r.status] = (pathUpdates[r.status] ?? 0) + 1
      // LAVA GUARD 1 (docs/lava-prevention.md v3): the EXECUTED route's swept footprint must be known, supported and
      // lava-free; a failing sample stops the leg before the first step and again on every replan. The pathfinder
      // already refuses lava as a node; this catches the ledge over a pool that a walkable node sequence crosses.
      if ((r.status === 'success' || r.status === 'partial') && Array.isArray(r.path) && r.path.length && bot.entity?.position) {
        const p = bot.entity.position
        const nodes = [{ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }, ...r.path.map(n => ({ x: n.x, y: n.y, z: n.z }))]
        const v = corridorSafe((x, y, z) => bot.blockAt(new Vec3(x, y, z)), nodes)
        if (!v.safe) {
          try { bot.pathfinder.setGoal(null) } catch { /* not connected */ }
          if (Date.now() - lavaCorridorLoggedAt > 5_000) { lavaCorridorLoggedAt = Date.now(); logEvent({ kind: 'lava_corridor', status: 'no_effect', detail: `${v.why} at ${v.at?.join(',')} after ${v.samples} samples; the leg is refused`, snapshot: snapshot(bot) }) }
          return
        }
        // POSITIVE CONTROL for the death-site price: a route the corridor guard accepted that still passes through a disc is logged
        // (not refused -- the price is a detour, and a bot standing inside a disc has to walk out of it).
        const crossed = pathCrossesDeathSite(bot.deathSitesNow?.() ?? [], r.path)
        if (crossed && Date.now() - deathSiteCrossLoggedAt > 5_000) { deathSiteCrossLoggedAt = Date.now(); logEvent({ kind: 'death_site_route_crossed', status: 'no_effect', detail: `${crossed.site.kind} x${crossed.site.deaths ?? 1} at ${crossed.site.x},${crossed.site.y},${crossed.site.z}; the planned route passes ${crossed.node.x},${crossed.node.y},${crossed.node.z} (${r.path.length} nodes)`, snapshot: snapshot(bot) }) }
        // THE LAST PLANNED PATH, KEPT FOR THE FALL RECORD (fallpath.mjs): captured only once the corridor guard has
        // ACCEPTED the route (a refused leg is never executed), with the planner's real policy at that moment
        // (maxDropDown, the liquid drop-down flag: the profile name is a label, the values are the evidence) and the
        // landing cells read NOW, at planning time, not at the fall. Invalidated by path_reset. Read at a death or
        // a fall; never acted on. Codex pass 1, 17 Sep.
        {
          const g = bot.pathfinder?.goal; const mv = bot.pathfinder?.movements
          const goal = g && Number.isFinite(g.x) && Number.isFinite(g.z) ? `${g.x},${Number.isFinite(g.y) ? g.y : '?'},${g.z}` : (g ? (g.constructor?.name ?? 'goal') : null)
          lastPlannedPath = { t: Date.now(), status: r.status, active: true, profile: bot.movementProfile ?? 'walk', goal, nodes: nodes.length,
                              maxDropDown: mv?.maxDropDown ?? null, liquidDropdown: mv?.infiniteLiquidDropdownDistance ?? null,
                              drops: pathDropProfile(nodes, (x, y, z) => bot.blockAt(new Vec3(x, y, z)), { maxDrop: mv?.maxDropDown ?? 4 }) }
        }
      }
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
    // ON THE BUS, so skills can read it. The reflex layer has been writing
    // resource sightings here every 20s since it was built -- 200 per pool,
    // with real coordinates for iron_ore, coal_ore, stone and oak_log -- and
    // `resourcesNear` had ZERO callers. A store nothing reads is the
    // `bot.waterMovements` defect again, and this one was full of exactly the
    // information `explore` needed while explore picked random headings.
    bot.worldFacts = worldFacts
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
    const prev = hpTrail.length ? hpTrail[hpTrail.length - 1].hp : null
    hpTrail.push({ t: Date.now(), hp: Math.round((bot.health ?? 0) * 10) / 10 })
    if (hpTrail.length > HP_MAX) hpTrail.shift()
    // A NON-FATAL FALL IS THE SAME EVIDENCE AS A FATAL ONE, and there are many more of them: health dropped, the
    // feet are on the ground, and the peak was more than 6 blocks up. One row per landing (10-s throttle).
    const y = bot.entity?.position?.y
    if (prev != null && bot.health != null && bot.health < prev - 0.5 && y != null && peakY != null && peakY - y >= 6 && bot.entity?.onGround && Date.now() - lastFallRecordAt > 10_000) {
      fallRecord(bot, runner, Math.round(peakY - y), 'damage', { dHealth: Math.round((bot.health - prev) * 10) / 10 })
    }
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
    if (fell != null && fell > 3) fallRecord(bot, runner, fell, 'death', { cause: deathClass(cause) })
    const lost = inventorySummary(bot)
    const lostSummary = Object.entries(lost)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([k, n]) => `${k} x${n}`).join(', ')
    const cause = freshDeathCause()
    // THE DEATH BECOMES A SITE the pool's planner prices from now on (deathsites.mjs). Published before the cause and
    // peak are cleared below; a failure to write is logged and never blocks the death record.
    if (worldFacts && deathPos) {
      try {
        const site = worldFacts.reportDeath(deathClass(cause), deathPos)
        bot.refreshDeathSites?.()
        if (site) logEvent({ kind: 'death_site_recorded', status: 'success', detail: `${site.kind} x${site.deaths} at ${site.x},${site.y},${site.z} (${fell != null && fell > 3 ? `after a ${fell}-block fall; ` : ''}${worldFacts.deathSites().length} sites on file)`, snapshot: snapshot(bot) })
      } catch (e) { logEvent({ kind: 'death_site_recorded', status: 'failed', detail: String(e?.message ?? e).slice(0, 80), snapshot: snapshot(bot) }) }
    }
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
