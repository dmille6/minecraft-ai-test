// Reflex layer -- handoff doc S9.1.
//
// Runs continuously on a timer and never calls an LLM. Everything here is a
// survival response that must happen in under a second; routing any of it
// through a model would be both slower and less reliable.
//
// Reflexes may PREEMPT the running skill. That is the whole point: a bot
// calmly pathfinding into lava because it is "busy gathering" is the failure
// mode this layer exists to prevent.

import { log, logEvent } from './logger.mjs'
import { config } from './config.mjs'
import { announceHazard } from './comms.mjs'
import { isNight, snapshot, inventorySummary } from './state.mjs'
import { Vec3 } from 'vec3'
import pathfinderPkg from 'mineflayer-pathfinder'
const pkgGoals = pathfinderPkg?.goals

const FOOD_PRIORITY = [
  'golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
  'cooked_chicken', 'bread', 'baked_potato', 'cooked_cod', 'cooked_salmon',
  'apple', 'carrot', 'melon_slice', 'sweet_berries',
]

// What is worth remembering the location of. Kept short: every entry costs a
// findBlocks call per survey tick, and the point is a sparse map of
// opportunities, not an index of the world.
const SURVEY_BLOCKS = [
  'oak_log', 'birch_log', 'spruce_log',
  'stone', 'coal_ore', 'iron_ore',
  'sand', 'water',
]

const DANGER_BLOCKS = new Set(['lava', 'fire', 'campfire', 'soul_fire', 'magma_block'])

// Escape pacing. Both of these were USED by the entombment escape in 3073a9f
// and never DECLARED, along with lastEscapeAt and escapeFailures below.
//
// The cost of that: `lastEscapeAt is not defined` threw out of the reflex
// interval callback on every single tick, twice a second, which killed the
// WHOLE reflex layer -- drowning, lava, low health, low oxygen, stuck, all of
// it -- while the bots looked alive and kept making LLM calls. A reflex layer
// that throws is worse than no reflex layer, because everything downstream
// still assumes it is watching.
//
// `node --check` does not catch this: an undeclared identifier is a runtime
// ReferenceError, not a parse error. Only executing the branch finds it, and
// this branch needs a bot to actually be entombed. See README "things that
// cost a debugging cycle".
const ESCAPE_MIN_INTERVAL_MS = 15_000   // > a full escape attempt, so a failure is not retried instantly
const ESCAPE_GIVE_UP_AFTER = 4          // then hand it to the watchdog, which can relocate/home/reconnect
// How often the marooned check may run a pathfinder search. Long, because a bot
// that cannot leave will still be unable to leave in a minute, and the check is
// the expensive kind: a real search rather than a block lookup.
const MAROON_CHECK_MS = 60_000

// At tickMs=500 these are 5s to raise the alarm and 30s to give up -- long
// enough that a transient world/pathfinder hiccup does not trip them, short
// enough that a dead reflex layer is measured in seconds rather than hours.
const REFLEX_ERROR_ALARM = 10
const REFLEX_ERROR_GIVE_UP = 60

/**
 * Shared throttle for every reflex.
 *
 * Five reflexes have now thrashed and each was fixed individually. The
 * generalisation: NO reflex should fire more than once per interval per kind.
 * A condition still true after acting on it is either not fixable by that
 * reflex or needs escalation -- in both cases hammering it 50 times a minute
 * only floods the telemetry everything else is measured from.
 *
 * Defined outside startReflexes so a reflex added tomorrow gets it for free.
 */
/**
 * Report items the REFLEX layer consumed.
 *
 * Reflexes act outside the task runner, so nothing they spend appears in any
 * `skill.inventory_delta` -- a bot pillaring out of a pit burns blocks with no
 * record at all. That is not just a reporting hole: ADR-0003's value classifier
 * decides `valuable` / `costly` FROM those deltas, so unmeasured reflex
 * consumption means the fleet is being reinforced on incomplete accounting.
 *
 * Emitted as its own event with an explicit cause, so every inventory change is
 * either attributed or visibly unattributed.
 */
function noteReflexInventory(bot, before, cause) {
  try {
    const after = inventorySummary(bot)
    const delta = {}
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const d = (after[k] ?? 0) - (before[k] ?? 0)
      if (d !== 0) delta[k] = d
    }
    if (!Object.keys(delta).length) return
    logEvent({
      kind: 'inventory_mutation', status: 'success',
      detail: `cause=${cause} ${Object.entries(delta).map(([k, n]) => `${k} ${n > 0 ? '+' : ''}${n}`).join(', ')}`,
      snapshot: snapshot(bot),
    })
  } catch { /* accounting must never break a rescue */ }
}

function makeThrottle(defaultMs = 10_000) {
  const last = new Map()
  return (kind, ms = defaultMs) => {
    const now = Date.now()
    if (now - (last.get(kind) ?? 0) < ms) return false
    last.set(kind, now)
    return true
  }
}

export function startReflexes(bot, runner, lessons = null, worldFacts = null) {
  // Publish a hazard to the fleet, but only once this bot has hit it enough
  // times to be sure. One bad reading must not become everyone's belief --
  // tonight a broken oxygen check wrote 466 "drowning" events for a place with
  // no water in it, and under sharing that would have been fleet doctrine.
  const shareHazard = (kind, pos) => {
    const mine = lessons?.recordHazard(kind, pos) ?? 0
    if (worldFacts && pos && mine >= 2) {
      const fresh = worldFacts.reportHazard(kind, pos, mine)
      if (fresh) announceHazard(bot, kind, pos, mine)
    }
  }

  const throttled = makeThrottle()
  let lastPos = null
  let stillSince = Date.now()
  let eating = false
  let lowHealthLatched = false
  let lowOxygenLatched = false
  // The maroon check runs a real pathfinder search, so it is rate-limited rather
  // than run on every tick, and re-entrancy is blocked while the climb is in
  // progress -- a rescue that keeps re-triggering itself never finishes.
  let marooned = false
  let lastMaroonCheck = 0
  // Reported once per bot lifetime, not latched-and-cleared: a bad reading is a
  // defect to notice, not an event to count, and the last thing this needs is a
  // second signal that fires hundreds of times.
  let badOxygenReported = false
  let escaping = false
  // Per-bot, not module-level: two bots entombed at once must not share a
  // cooldown or a failure count.
  let lastEscapeAt = 0
  let escapeFailures = 0
  let reflexErrors = 0

  const timer = setInterval(async () => {
    if (!bot.entity) return

    try {
      // --- survey: remember where the good things are ----------------------
      // The fleet's memory was entirely negative -- hazard sites and failed
      // actions, both with coordinates, and nothing about where anything useful
      // is. A bot could walk past a forest, die, and have learned nothing.
      //
      // Deliberately cheap and throttled: a handful of block types, radius 40,
      // one hit each. `gather` at radius 96 is what nearly killed the host four
      // times tonight, so this stays small on purpose -- it is a sighting log,
      // not a search.
      if (worldFacts && throttled('survey', 20000)) {
        for (const name of SURVEY_BLOCKS) {
          const t = bot.registry?.blocksByName?.[name]
          if (!t) continue
          const hit = bot.findBlocks({ matching: t.id, maxDistance: 40, count: 1 })[0]
          if (hit) worldFacts.reportResource(name, hit)
        }
      }

      // --- low oxygen -----------------------------------------------------
      // LATCHED, for the same reason the health check below is latched: this
      // ran level-triggered and fired on every tick while oxygen was low.
      // Measured live -- 145-226 events per bot per ten minutes, ~200x the
      // real rate, drowning out genuine telemetry and re-interrupting the
      // skill runner continuously so the bot could never act its way out.
      //
      // Losing air does NOT mean drowning. A head inside a solid block
      // suffocates identically, and the two need opposite responses: jumping
      // surfaces a swimmer and does nothing for someone entombed. Observed
      // live -- four bots emitting "drowning" with no water anywhere near
      // them, one with its head inside a grass_block.
      const head = bot.blockAt(bot.entity.position.offset(0, 1, 0))
      const inWater = head?.name === 'water' || bot.entity.isInWater === true
      // THE COUNTER IS NOT THE CONDITION.
      //
      // Suffocation needs a head inside a solid block; drowning needs a head in
      // water. If neither is true the bot is standing in open air and is not
      // losing air, whatever oxygenLevel reports -- and acting on the counter
      // alone calls runner.interrupt() on a bot that has nothing to escape from.
      //
      // Measured on instance #2: Miner01 sat at 42,22,-180 for SEVENTY MINUTES
      // at 20/20 health with air at head height, emitting `suffocating
      // oxygen=0 head=air` every few seconds. Each one interrupted the running
      // skill, so no goto, no unstick and no relocation could ever run to
      // completion. The watchdog, the livelock breaker and the entombed handler
      // all fired correctly and were all cut off mid-stride by this.
      //
      // The oxygen field oscillated 0 -> 12+ -> 0 between ticks, which also
      // re-armed the latch each time, so the latch could not damp it either.
      // A latch cannot fix a signal that is wrong; it only slows it down.
      const headSolid = head != null && head.boundingBox === 'block'
      // HEALTH IS THE ARBITER, because it is the one value the SERVER owns.
      //
      // My first version of this guard trusted the block lookup: head is air, so
      // the oxygen counter must be wrong, so do not act. That was right for the
      // case it was written for -- oxygen=0 at 20/20 health with nothing
      // happening -- and wrong the moment mineflayer's chunk view disagreed with
      // the server about water. Measured immediately after deploying it: 2
      // "reading not actionable" events and 2 drowning deaths in four minutes,
      // one for one. The bots were drowning and this was explaining it away.
      //
      // A bot losing health while its air is gone is drowning, whatever
      // blockAt() thinks it is standing in. Acting costs a jump; not acting
      // costs the bot.
      const losingHealth = bot.health != null && bot.health < 20
      const reallyLosingAir = inWater || headSolid || losingHealth
      // ONE throttle evaluation, and it gates the LOG, never the rescue.
      //
      // The previous shape called throttled('oxygen') in the first condition and
      // again in the else-if. When the bot was genuinely losing air the first
      // call CONSUMED the token, the condition then rejected on
      // !reallyLosingAir, and the second call returned false -- so the branch
      // that saves the bot could never run. Measured: `reflex: drowning` fired 0
      // times across 17 drowning deaths. A rescue must not be rate-limited by a
      // counter whose only job is to stop log spam.
      if (bot.oxygenLevel != null && bot.oxygenLevel <= 4) {
        if (reallyLosingAir) {
          if (throttled('oxygen', 8000) && !lowOxygenLatched) {
            lowOxygenLatched = true
            const kind = inWater ? 'drowning' : 'suffocating'
            log('warn', `reflex: ${kind}`, {
              oxygen: bot.oxygenLevel, head: head?.name, health: bot.health,
            })
            shareHazard(kind, bot.entity?.position)
            logEvent({
              kind: `reflex_${kind}`,
              detail: `oxygen ${bot.oxygenLevel}, head block ${head?.name ?? 'unknown'}, health ${bot.health}`,
              snapshot: snapshot(bot),
            })
            runner.interrupt(kind)
          }
          // Unconditional: every tick that air is going and the head is not in
          // stone, swim. Not latched, not throttled -- drowning damage lands
          // about once a second, so an 8s gate is a death sentence.
          if (inWater || (losingHealth && !headSolid)) {
            bot.setControlState('jump', true)
            setTimeout(() => bot.setControlState('jump', false), 1200)
            return
          }
        } else if (!badOxygenReported) {
          // Low oxygen, clear head, FULL health: the counter disagrees with
          // every other signal. Worth seeing once, never worth acting on.
          badOxygenReported = true
          log('warn', 'reflex: low oxygen with clear head -- reading not actionable', {
            oxygen: bot.oxygenLevel, head: head?.name ?? 'unknown', health: bot.health,
          })
          logEvent({
            kind: 'oxygen_reading_suspect',
            detail: `oxygen ${bot.oxygenLevel} but head block is ${head?.name ?? 'unknown'} ` +
                    `and health is ${bot.health}; not interrupting`,
            snapshot: snapshot(bot),
          })
        }
      }

        // Suffocating on land means walled in, and the ONLY thing that frees a
        // bot with canDig=false is the entombed handler below, which pillars or
        // digs straight up. Two corrections to my own 23:38 change:
        //
        //   - It returned unconditionally while oxygen was low, so a suffocating
        //     bot skipped the entombed, stuck, health and hunger checks on every
        //     tick -- it could never reach the one routine that would free it.
        //     Scout01 sat walled in at -6,71,-24 for an hour, identical to 15
        //     decimal places, while this returned early ~2000 times.
        //   - It called escape(), a 1.5s sprint. Sprinting into stone when all
        //     six faces are solid does nothing.
        //
        // So: fall through. Do not return.
      // Hysteresis band, matching the health check: clear only once oxygen has
      // genuinely recovered, so one incident is one reaction.
      if (bot.oxygenLevel != null && bot.oxygenLevel >= 12) lowOxygenLatched = false

      // --- standing in something that hurts --------------------------------
      const feet = bot.blockAt(bot.entity.position)
      const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
      if ((DANGER_BLOCKS.has(feet?.name) || DANGER_BLOCKS.has(below?.name)) && throttled('danger', 8000)) {
        log('error', 'reflex: in danger block, escaping', { block: feet?.name ?? below?.name })
        logEvent({ kind: 'reflex_danger_block', detail: feet?.name ?? below?.name, snapshot: snapshot(bot) })
        runner.interrupt('danger_block')
        await escape(bot)
        return
      }

      // --- health ----------------------------------------------------------
      // Latched, not level-triggered. Firing on every tick while health is low
      // produced ~10 log lines/sec and repeated interrupts; the latch clears
      // only once health actually recovers, so one dip is one reaction.
      if (bot.health != null && bot.health <= config.reflex.fleeBelowHealth) {
        if (!lowHealthLatched && throttled('low_health', 15000)) {
          lowHealthLatched = true
          log('warn', 'reflex: health low, disengaging', { health: round1(bot.health) })
          logEvent({ kind: 'reflex_low_health', detail: `health ${round1(bot.health)}`, snapshot: snapshot(bot) })
          if (runner.isBusy()) runner.interrupt('low_health')
        }
      } else if (bot.health != null && bot.health > config.reflex.fleeBelowHealth + 4) {
        lowHealthLatched = false   // hysteresis band avoids flapping at the threshold
      }

      // --- hunger -----------------------------------------------------------
      if (!eating && bot.food != null && bot.food <= config.reflex.eatBelowFood) {
        const food = pickFood(bot)
        if (food) {
          eating = true
          try {
            await bot.equip(food, 'hand')
            await bot.consume()
            log('info', 'reflex: ate', { item: food.name, food: bot.food })
            logEvent({ kind: 'reflex_ate', detail: food.name, snapshot: snapshot(bot) })
          } catch (e) {
            log('debug', 'reflex: eat failed', { err: e.message })
          } finally {
            eating = false
          }
        }
      }

      // --- marooned: no route out, but up is open ----------------------------
      //
      // `mine` digs down. Navigation runs canDig=false and
      // allow1by1towers=false. So ONE COMPONENT CAN CREATE TOPOLOGY THE REST OF
      // THE STACK CANNOT TRAVERSE, and the bot that dug the shaft is the one bot
      // that cannot climb it. Miner01 sat at the bottom of its own forty-block
      // shaft for ninety minutes at 20/20 health with 70 cobblestone and two
      // pickaxes: no hazard, no shortage, no damage. Nothing rescued it because
      // every guard tested a SHAPE -- head blocked, not moving, low health --
      // and none tested the thing that was actually false: that it could get
      // anywhere from here.
      //
      // So this branch tests capability directly. Not "am I walled in" but "can
      // a journey begin at all", which is what the trap denies and what
      // canStartAPath() measures. Cheap guards first, because that call runs a
      // real search and this loop ticks twice a second.
      if (!escaping && !marooned && !runner.isBusy() &&
          Date.now() - lastMaroonCheck > MAROON_CHECK_MS) {
        lastMaroonCheck = Date.now()
        const above = bot.blockAt(bot.entity.position.offset(0, 2, 0))
        const upIsOpen = !above || above.name === 'air' || above.boundingBox === 'empty'
        const haveBlocks = bot.inventory.items().some(it => PLACEABLE.test(it.name))
        if (upIsOpen && haveBlocks && !isEntombed(bot) && !(await canStartAPath(bot))) {
          marooned = true
          const invBefore = inventorySummary(bot)
          const yBefore = bot.entity.position.y
          log('error', 'reflex: marooned -- no route from here, climbing out', {
            y: Math.round(yBefore),
            blocks: bot.inventory.items().filter(it => PLACEABLE.test(it.name))
              .reduce((n, it) => n + it.count, 0),
          })
          logEvent({ kind: 'marooned', status: 'failed',
                     detail: `no path can start from y=${Math.round(yBefore)} with an open ` +
                             `column above -- climbing out`,
                     snapshot: snapshot(bot) })
          runner.interrupt('marooned')
          try { await pillarOut(bot) } catch (e) { log('warn', 'maroon escape failed', { err: e.message }) }
          noteReflexInventory(bot, invBefore, 'maroon_escape')
          marooned = false
        }
      }

      // --- entombed / stuck in a pit -----------------------------------------
      // `mine` digs downward but navigation runs canDig=false and
      // allow1by1towers=false, so descending is a ONE-WAY TRIP. Observed live:
      // Scout at y=49 with stone on all four sides, 12 blocks below the
      // surrounding ground, unable to dig out or pillar out.
      //
      // This is a survival condition, so it lives here rather than in a skill --
      // it must fire regardless of what the agent thinks it is doing.
      if (!escaping && isEntombed(bot) &&
          Date.now() - lastEscapeAt > ESCAPE_MIN_INTERVAL_MS) {
        if (escapeFailures >= ESCAPE_GIVE_UP_AFTER) {
          // Hand it to the watchdog, which can relocate, go home, or reconnect.
          // Repeating an escape that has failed four times is not a strategy.
          logEvent({ kind: 'entombed_unrecoverable', status: 'failed',
                     detail: `gave up after ${escapeFailures} escape attempts at y=${Math.round(bot.entity.position.y)}`,
                     snapshot: snapshot(bot) })
          log('error', 'reflex: entombed and cannot escape, leaving it to the watchdog',
              { attempts: escapeFailures })
          lastEscapeAt = Date.now()
          escapeFailures = 0
          return
        }
        escaping = true
        lastEscapeAt = Date.now()
        const yBefore = bot.entity.position.y
        shareHazard('entombed', bot.entity?.position)
        logEvent({ kind: 'entombed', status: 'failed',
                   detail: `walled in at y=${Math.round(bot.entity.position.y)}`,
                   snapshot: snapshot(bot) })
        log('error', 'reflex: entombed, pillaring out', { y: Math.round(bot.entity.position.y) })
        runner.interrupt('entombed')
        // Bracket the whole escape, not each helper: pillarOut may hand off to
        // digStraightUp partway through, and what matters is the net cost of
        // getting out of the hole, attributed to the reflex that caused it.
        const invBefore = inventorySummary(bot)
        try { await pillarOut(bot) } catch (e) { log('warn', 'pillar out failed', { err: e.message }) }
        noteReflexInventory(bot, invBefore, 'entombed_escape')
        // Verify the postcondition. "I ran the recovery" and "the bot is no
        // longer trapped" are different claims and only the second one counts.
        if (bot.entity && bot.entity.position.y - yBefore < 1 && isEntombed(bot)) escapeFailures++
        else escapeFailures = 0
        escaping = false
        return
      }

      // --- stuck detection --------------------------------------------------
      // Handoff doc S12: "no movement DESPITE AN ACTIVE TASK". That qualifier
      // is load-bearing. Accumulating stillness while idle means the timer is
      // already expired the instant a task starts, and the first skill is
      // killed before it moves -- which is exactly what happened on first run.
      //
      // Digging is also legitimately stationary: a bot mining a vein by hand
      // stands still for many seconds and is working perfectly.
      const p = bot.entity.position
      const digging = bot.targetDigBlock != null
      if (!runner.isBusy() || digging || (lastPos && p.distanceTo(lastPos) > 0.6)) {
        stillSince = Date.now()
      }
      lastPos = p.clone()

      if (runner.isBusy() && !digging && Date.now() - stillSince > config.reflex.stuckSeconds * 1000) {
        log('warn', 'reflex: stuck, cancelling path', { seconds: config.reflex.stuckSeconds })
        logEvent({ kind: 'reflex_stuck', detail: `no movement for ${config.reflex.stuckSeconds}s`, snapshot: snapshot(bot) })
        stillSince = Date.now()
        runner.interrupt('stuck')
        try { bot.pathfinder?.stop() } catch { /* pathfinder may be idle */ }
        await unstick(bot)
      }
    } catch (e) {
      // A reflex loop that throws EVERY tick is not an error to log, it is an
      // outage to escalate. The previous version logged and continued, so a
      // ReferenceError printed twice a second for as long as the bot lived
      // while every survival reflex was silently absent -- and the bot went on
      // making LLM calls and reporting healthy the whole time.
      //
      // Telemetry, so the failure is visible to the analysis loop rather than
      // only in journald, and a hard stop once it is clearly not transient:
      // no reflexes at all is more dangerous than a reconnect.
      reflexErrors++
      log('error', 'reflex loop error', { err: e.message, consecutive: reflexErrors })
      if (reflexErrors === REFLEX_ERROR_ALARM) {
        logEvent({ kind: 'reflex_layer_down', status: 'failed',
                   detail: `reflex loop threw ${reflexErrors} consecutive times: ${e.message}`,
                   snapshot: snapshot(bot) })
      }
      if (reflexErrors >= REFLEX_ERROR_GIVE_UP) {
        log('error', 'reflex: layer is dead, reconnecting to rebuild state',
            { err: e.message, consecutive: reflexErrors })
        reflexErrors = 0
        try { bot.quit('reflex layer down') } catch { /* already gone */ }
      }
      return
    }
    // Only a clean pass proves the layer is actually working.
    reflexErrors = 0
  }, config.reflex.tickMs)

  return () => clearInterval(timer)
}

/** Walls on 3+ sides at head height, and open sky is far above. */
/**
 * WATER IS NOT A WALL, AND IT IS NOT A CEILING.
 *
 * Every test below asked `name !== 'air'`, so water counted as both. Underwater
 * that makes EVERY bot permanently entombed: the escape fires, pillarOut runs
 * for twenty or thirty seconds placing blocks into the sea, and because the
 * reflex loop is serial the oxygen check never gets a tick while it does. A bot
 * drowns in about fifteen seconds.
 *
 * Measured on instance #2: Scout01 drowned 13 times in two hours, 5 of them in
 * one twenty-minute window, with `reflex: drowning` firing ZERO times and
 * `reflex: entombed` firing ten. The wrong rescue was winning every race.
 *
 * You can swim through water. Being surrounded by it is a reason to go UP, which
 * is what the drowning branch already does -- so the fix is simply to stop
 * calling it entombment and let that branch have the tick.
 */
const passableFor = b =>
  !b || b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air' ||
  b.name === 'water' || b.name === 'bubble_column' || b.name.includes('leaves')

function isEntombed(bot) {
  const p = bot.entity.position

  // A CEILING is the load-bearing condition and the original version lacked it.
  // Without this, "walls on three sides plus higher ground nearby" describes an
  // ordinary hillside, and the reflex fired 1,997 times in 40 minutes at an
  // average y of 64 -- surface level, open sky overhead. Being genuinely
  // entombed means something is above you.
  const ceiling = bot.blockAt(p.offset(0, 2, 0))
  if (passableFor(ceiling)) return false

  let walls = 0
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const b = bot.blockAt(p.offset(dx, 1, dz))
    if (!passableFor(b)) walls++
  }
  if (walls < 3) return false
  // Distinguish "in a corridor" from "in a hole": look for ground much higher.
  let highest = -999
  for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [-4, -4]]) {
    for (let dy = 12; dy > -2; dy--) {
      const b = bot.blockAt(p.offset(dx, dy, dz))
      // Water is not ground either -- an ocean floor probe that stops at the
      // first water block reports the SURFACE as nearby high terrain, which is
      // how a swimming bot looked like a bot at the bottom of a pit.
      if (!passableFor(b)) {
        if (p.y + dy > highest) highest = p.y + dy
        break
      }
    }
  }
  return highest - p.y >= 4
}

const PLACEABLE = /^(dirt|cobblestone|stone|oak_log|oak_planks|sand|gravel|andesite|diorite|granite|deepslate|cobbled_deepslate)$/

/**
 * Escape a pit. Two failure modes the first version got wrong:
 *
 *  1. It jumped without checking HEADROOM. With a stone ceiling directly above,
 *     jump-and-place does nothing -- observed running 20 times at y=61 while
 *     going nowhere.
 *  2. It reported success unconditionally. "pillared out from=61 to=61" is a
 *     lie, and it hid the failure from both the log and the caller.
 *
 * Now: clear the ceiling first, verify height was actually gained, and fall
 * back to digging straight up when pillaring cannot work.
 */
async function pillarOut(bot, maxBlocks = 24) {

  const startY = bot.entity.position.y
  let stalled = 0

  for (let i = 0; i < maxBlocks; i++) {
    const yBefore = bot.entity.position.y

    // Headroom first. Breaking stone bare-handed drops nothing, but for escape
    // purposes breaking is all that matters.
    const head = bot.blockAt(bot.entity.position.offset(0, 2, 0))
    if (head && head.name !== 'air' && head.name !== 'water') {
      try { await bot.dig(head) } catch { /* may be unreachable; try anyway */ }
      await sleep(150)
    }

    const item = bot.inventory.items().find(it => PLACEABLE.test(it.name))
    if (!item) { return digStraightUp(bot, startY) }

    await bot.equip(item, 'hand').catch(() => {})
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (!below) break
    bot.setControlState('jump', true)
    await sleep(300)
    try { await bot.placeBlock(below, new Vec3(0, 1, 0)) } catch { /* mistimed */ }
    bot.setControlState('jump', false)
    await sleep(250)

    if (bot.entity.position.y - yBefore < 0.5) {
      if (++stalled >= 3) {
        log('warn', 'reflex: pillaring is not gaining height, digging up instead')
        return digStraightUp(bot, startY)
      }
    } else {
      stalled = 0
    }

    // WHEN IS THE ESCAPE OVER?
    //
    // This used to be `if (!isEntombed(bot)) break` -- and isEntombed() means
    // "head blocked". Miner01 was at the bottom of a forty-block open shaft it
    // had dug itself, so its head was NEVER blocked: the loop placed exactly one
    // block and exited, every time it ran. Two invocations, two blocks, ninety
    // minutes at the bottom of the hole with 70 cobblestone in its pockets.
    //
    // "My head is clear" was only ever a proxy for "I can leave". Ask the real
    // question instead: can a journey START from where I now stand? That is the
    // condition the bot actually needs restored, it is what the trap denies, and
    // canStartAPath() already answers it. Height gained is progress, not success.
    //
    // Checked every third block because it runs a real (short-budget) search and
    // this is a reflex; a rescue that stalls for seconds deciding whether it has
    // finished is its own failure.
    if (i % 3 === 2 && await canStartAPath(bot)) {
      log('info', 'reflex: pillared until a route exists again',
          { from: Math.round(startY), to: Math.round(bot.entity.position.y), blocks: i + 1 })
      return
    }
  }

  const gained = bot.entity.position.y - startY
  if (gained < 1) {
    log('error', 'reflex: pillar out FAILED, no height gained', { y: Math.round(startY) })
    return digStraightUp(bot, startY)
  }
  // Ran out of budget with height gained but no route: say so plainly rather
  // than reporting the height as though it were the point.
  log(await canStartAPath(bot) ? 'info' : 'warn',
      'reflex: pillaring ended', {
        from: Math.round(startY), to: Math.round(bot.entity.position.y),
        routeRestored: await canStartAPath(bot),
      })
}

/** Break upward until there is open sky, then
 step out. */
async function digStraightUp(bot, startY, maxSteps = 20) {
  for (let i = 0; i < maxSteps; i++) {
    const above = bot.blockAt(bot.entity.position.offset(0, 2, 0))
    if (!above || above.name === 'air') {
      // Ceiling clear -- try to gain the block, otherwise walk toward the gap.
      const item = bot.inventory.items().find(it => PLACEABLE.test(it.name))
      if (item) {
        await bot.equip(item, 'hand').catch(() => {})
        const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
        bot.setControlState('jump', true)
        await sleep(300)
        try { await bot.placeBlock(below, new Vec3(0, 1, 0)) } catch {}
        bot.setControlState('jump', false)
        await sleep(200)
      } else {
        // No blocks: head for whichever side is open and walk out.
        await walkToOpening(bot)
        return
      }
    } else {
      try { await bot.dig(above) } catch { break }
      await sleep(150)
    }
    if (!isEntombed(bot)) break
  }
  log('info', 'reflex: dug out', { from: Math.round(startY), to: Math.round(bot.entity.position.y) })
}

/** Sprint toward whichever horizontal direction is open. */
async function walkToOpening(bot) {
  const p = bot.entity.position
  for (const [dx, dz, k] of [[1, 0, 'right'], [-1, 0, 'left'], [0, 1, 'back'], [0, -1, 'forward']]) {
    const a = bot.blockAt(p.offset(dx, 0, dz))
    const b = bot.blockAt(p.offset(dx, 1, dz))
    if (a?.name === 'air' && b?.name === 'air') {
      await bot.look(Math.atan2(-dx, -dz), 0, true).catch(() => {})
      bot.setControlState('forward', true); bot.setControlState('sprint', true)
      await sleep(1200)
      bot.clearControlStates()
      return
    }
  }
}

function pickFood(bot) {
  const items = bot.inventory?.items() ?? []
  for (const name of FOOD_PRIORITY) {
    const hit = items.find(i => i.name === name)
    if (hit) return hit
  }
  return null
}

/** Sprint-jump away from whatever is hurting us. Crude on purpose -- fast beats clever. */
async function escape(bot) {
  bot.setControlState('sprint', true)
  bot.setControlState('forward', true)
  bot.setControlState('jump', true)
  await sleep(1500)
  bot.clearControlStates()
}

/**
 * Break out of a stuck state -- and VERIFY it worked.
 *
 * The first version was a 600ms jump-and-hop. Telemetry over 44 firings showed
 * the agent was in the same place afterwards 35 times: 80% ineffective. A
 * recovery that usually does not recover is barely better than none, and it
 * costs a decision cycle each time.
 *
 * Now it escalates: nudge, then sprint in a random direction, then a real
 * pathfinding move to somewhere genuinely different -- checking after each
 * step whether the agent actually relocated.
 */
/**
 * Can a bot legally stand here? Feet clear, HEAD clear, something solid under.
 *
 * The head check is the one that matters and the one the old unstick ignored.
 * Measured live: a bot at 1,74,0 had open space at foot level in three
 * directions and solid rock at head height in all but one of them, so every
 * "obvious" escape was illegal and it thrashed against stone.
 */
function standableAt(bot, p) {
  const passable = b => !b || b.name === 'air' || b.boundingBox === 'empty'
  const feet = bot.blockAt(p)
  const head = bot.blockAt(p.offset(0, 1, 0))
  const below = bot.blockAt(p.offset(0, -1, 0))
  return passable(feet) && passable(head) && below && below.boundingBox === 'block'
}

/** Legal neighbours, most open first -- openness is a proxy for "leads somewhere". */
function escapeCandidates(bot, tabu = null) {
  const p = bot.entity.position.floored()
  const out = []
  for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
    for (const dy of [0, 1, -1]) {          // step up, level, or down one
      const c = p.offset(dx, dy, dz)
      if (!standableAt(bot, c)) continue
      if (tabu && tabu.has(cellKey(c))) break   // already tried; it did not work
      let open = 0
      for (const [ex, ez] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        if (standableAt(bot, c.offset(ex, 0, ez))) open++
      }
      out.push({ pos: c, open })
      break
    }
  }
  return out.sort((a, b) => b.open - a.open)
}

/**
 * What unstick has already tried, and where it tried it from.
 *
 * Stage 0 grades itself with `escapedCell()` -- "am I on a different block than
 * I started on". Inside a pit that is satisfied perfectly by stepping from one
 * corner to the other, so the escape reported success 74 times out of 74 while
 * the bot went nowhere. Measured on instance #1: the SAME target was chosen 8
 * times (5,74,-3), 6 times (3,73,-5), 5 times (-14,68,-4). The bot was bouncing
 * between two squares of a hole it could walk around but not climb out of --
 * visible in-world as a bot hopping on the spot.
 *
 * Two things were missing. Memory, so the same failed square is not re-chosen;
 * and an INVERSE, so that "I keep unsticking from the same four blocks" is
 * recognised as the horizontal escape having failed rather than having worked.
 *
 * Per-bot rather than module-level, for the same reason the escape counters are:
 * nothing here may leak between two bots sharing a process.
 */
const UNSTICK_MEMORY_MS   = 5 * 60 * 1000   // how long a tried square stays tabu
const UNSTICK_TABU_MAX    = 12
const OSCILLATION_TRIES   = 3               // unsticks from ~one spot before we call it a trap
const OSCILLATION_RADIUS  = 4               // blocks
const unstickHistory = new WeakMap()

const cellKey = c => `${c.x},${c.y},${c.z}`

function unstickMemory(bot) {
  let h = unstickHistory.get(bot)
  if (!h) { h = { tried: [], origins: [] }; unstickHistory.set(bot, h) }
  const cutoff = Date.now() - UNSTICK_MEMORY_MS
  h.tried = h.tried.filter(t => t.at > cutoff).slice(-UNSTICK_TABU_MAX)
  h.origins = h.origins.filter(o => o.at > cutoff)
  return h
}

/**
 * Can this bot begin a journey from where it now stands?
 *
 * Leaving the stuck cell is necessary but not sufficient -- stepping one block
 * sideways inside the same sealed pocket is not an escape. Every one of 108
 * route failures in three hours reported "blocked after 0 leg(s)", i.e. no
 * first leg existed, so that is the exact condition worth testing.
 *
 * Deliberately cheap: a short-range goal with a small think budget. This runs
 * inside a reflex, and a reflex that stalls for seconds deciding whether it
 * succeeded is its own failure.
 */
async function canStartAPath(bot) {
  if (!pkgGoals) return true                       // cannot test; do not block the escape
  const p = bot.entity.position
  const prev = bot.pathfinder.thinkTimeout
  try {
    bot.pathfinder.thinkTimeout = 800
    const path = bot.pathfinder.getPathTo(
      bot.pathfinder.movements,
      new pkgGoals.GoalNear(Math.round(p.x) + 8, Math.round(p.y), Math.round(p.z) + 8, 3),
      800)
    return !!(path && path.path && path.path.length > 0)
  } catch {
    return true                                    // unknown is not a reason to keep thrashing
  } finally {
    bot.pathfinder.thinkTimeout = prev
  }
}

async function unstick(bot) {
  const start = bot.entity.position.clone()
  const startBlock = start.floored()

  // TWO different questions, and they were being asked with one test.
  //
  // `movedEnough` (>= 3 blocks) is a "did this bot make progress toward its
  // task" metric. Stage 0 does not attempt that: it steps to one of the eight
  // ADJACENT standable neighbours, so the furthest it can possibly travel is
  // about 1.73 blocks, and the GoalNear(t, 1) that follows also settles about a
  // block away. A perfect escape therefore scored as a failure, and the bot
  // fell through into the three blind stages that were measured at 16/16
  // failures before stage 0 was written.
  //
  // Measured over three hours: 188 legal steps found, 106 FAILED, and the
  // "genuinely walled in" branch fired ZERO times. Detection was never the
  // problem. The escape was being graded against a threshold it cannot reach.
  //
  // So stage 0 asks the question it is actually answering: are we out of the
  // cell we were stuck in?
  const escapedCell = () => !bot.entity.position.floored().equals(startBlock)
  const movedEnough = () => bot.entity.position.distanceTo(start) >= 3

  // Have we been here before? A pit is walkable inside and sealed on top, so
  // every horizontal escape "succeeds" and none of them get the bot out. Three
  // unsticks from within four blocks means the horizontal answer is the wrong
  // answer -- stop re-deriving it and go UP, which is the only direction that
  // leaves a hole. The entombed branch cannot do this for us: it requires
  // isEntombed(), and an open-topped pit has nothing above the bot's head.
  const mem = unstickMemory(bot)
  const nearby = mem.origins.filter(o => o.pos.distanceTo(start) <= OSCILLATION_RADIUS)
  mem.origins.push({ pos: start.clone(), at: Date.now() })
  if (nearby.length >= OSCILLATION_TRIES - 1) {
    log('error', 'reflex: unstick oscillating -- treating as a pit, pillaring out', {
      attempts: nearby.length + 1,
      at: `${start.x.toFixed(0)},${start.y.toFixed(0)},${start.z.toFixed(0)}`,
    })
    logEvent({ kind: 'unstick_oscillation', status: 'failed',
               detail: `${nearby.length + 1} unsticks within ${OSCILLATION_RADIUS} blocks at ` +
                       `y=${Math.round(start.y)} -- horizontal escape is not working`,
               snapshot: snapshot(bot) })
    const yBefore = bot.entity.position.y
    const invBefore = inventorySummary(bot)
    try { await pillarOut(bot) } catch (e) { log('warn', 'pillar out failed', { err: e.message }) }
    noteReflexInventory(bot, invBefore, 'unstick_oscillation')
    // Same discipline as the entombed branch: "I ran the recovery" and "the bot
    // got out" are different claims, and only the second is worth reporting.
    const climbed = bot.entity ? bot.entity.position.y - yBefore : 0
    if (climbed >= 1) {
      mem.origins = []                 // genuinely somewhere else now
      log('info', 'reflex: pillared out of the pit', { climbed: round1(climbed) })
      return
    }
    log('warn', 'reflex: could not pillar out either, falling through', { climbed: round1(climbed) })
  }

  // 0. LOOK BEFORE THRASHING.
  //
  // The old version's three stages were all blind: a random 600ms nudge, a
  // random sprint, then a pathfind to a random point 18-32 blocks away. In a
  // confined space every one of those is a wall, and the third is unreachable
  // by construction. Measured: 16 attempts, 16 failures, 100% -- the visible
  // symptom being a bot jumping on the spot forever.
  //
  // So: enumerate the neighbours that are ACTUALLY standable and step to the
  // most open one. In the pocket the fleet was trapped in, exactly one of eight
  // neighbours qualified -- findable in a millisecond, invisible to a sprint.
  const tabu = new Set(mem.tried.map(t => t.key))
  let options = escapeCandidates(bot, tabu)
  if (!options.length && tabu.size) {
    // Every legal neighbour is one we already tried and that did not work. That
    // is not "walled in" -- it is a pocket we have fully enumerated, which is a
    // stronger statement than any single attempt could make.
    log('warn', 'reflex: every escape square has already been tried', { tried: tabu.size })
    options = escapeCandidates(bot)                  // fall back rather than freeze
  }
  if (options.length) {
    const t = options[0].pos
    mem.tried.push({ key: cellKey(t), at: Date.now() })
    log('info', 'reflex: unstick found a legal step', {
      to: `${t.x},${t.y},${t.z}`, openness: options[0].open, candidates: options.length,
      retried: tabu.has(cellKey(t)) || undefined,
    })
    try {
      await bot.lookAt(t.offset(0.5, 1.6, 0.5), true)
      bot.setControlState('forward', true)
      if (t.y > Math.floor(start.y)) bot.setControlState('jump', true)
      await sleep(900)
      bot.clearControlStates()
      if (escapedCell() && await canStartAPath(bot)) return
      // A short, REACHABLE goal -- unlike the old random distant one.
      if (pkgGoals) {
        await Promise.race([
          bot.pathfinder.goto(new pkgGoals.GoalNear(t.x, t.y, t.z, 1)),
          sleep(6000),
        ])
      }
      bot.clearControlStates()
      if (escapedCell() && await canStartAPath(bot)) return
    } catch { bot.clearControlStates() }
  } else {
    log('warn', 'reflex: unstick found NO standable neighbour -- genuinely walled in')
  }

  // 1. cheap nudge
  bot.setControlState('jump', true)
  bot.setControlState('back', true)
  await sleep(600)
  bot.clearControlStates()
  await bot.look(Math.random() * Math.PI * 2, 0, true).catch(() => {})
  if (movedEnough()) return

  // 2. sprint out of whatever geometry is holding us
  bot.setControlState('sprint', true)
  bot.setControlState('forward', true)
  bot.setControlState('jump', true)
  await sleep(1600)
  bot.clearControlStates()
  if (movedEnough()) return

  // 3. commit to going somewhere else entirely
  try {
    const ang = Math.random() * Math.PI * 2
    const d = 18 + Math.random() * 14
    const gp = pkgGoals && new pkgGoals.GoalNear(
      Math.round(start.x + Math.cos(ang) * d),
      Math.round(start.y),
      Math.round(start.z + Math.sin(ang) * d), 2)
    if (gp) await Promise.race([bot.pathfinder.goto(gp), sleep(9000)])
  } catch { /* pathfinder may refuse; nothing further to try here */ }

  if (!movedEnough()) {
    log('warn', 'reflex: unstick FAILED, still in place', {
      at: `${start.x.toFixed(0)},${start.y.toFixed(0)},${start.z.toFixed(0)}`,
    })
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const round1 = n => Math.round(n * 10) / 10

export { isNight }
// Exported for tests only: the pit geometry that produced 74 false successes is
// pure block arithmetic, and it is worth being able to assert on it directly.
export { escapeCandidates, unstickMemory, standableAt, cellKey,
         OSCILLATION_TRIES, OSCILLATION_RADIUS, UNSTICK_TABU_MAX }
