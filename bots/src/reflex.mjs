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
import { isNight, snapshot } from './state.mjs'
import { Vec3 } from 'vec3'
import pathfinderPkg from 'mineflayer-pathfinder'
const pkgGoals = pathfinderPkg?.goals

const FOOD_PRIORITY = [
  'golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
  'cooked_chicken', 'bread', 'baked_potato', 'cooked_cod', 'cooked_salmon',
  'apple', 'carrot', 'melon_slice', 'sweet_berries',
]

const DANGER_BLOCKS = new Set(['lava', 'fire', 'campfire', 'soul_fire', 'magma_block'])

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
function makeThrottle(defaultMs = 10_000) {
  const last = new Map()
  return (kind, ms = defaultMs) => {
    const now = Date.now()
    if (now - (last.get(kind) ?? 0) < ms) return false
    last.set(kind, now)
    return true
  }
}

export function startReflexes(bot, runner, lessons = null) {
  const throttled = makeThrottle()
  let lastPos = null
  let stillSince = Date.now()
  let eating = false
  let lowHealthLatched = false
  let lowOxygenLatched = false
  let escaping = false

  const timer = setInterval(async () => {
    if (!bot.entity) return

    try {
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
      if (bot.oxygenLevel != null && bot.oxygenLevel <= 4 && throttled('oxygen', 8000)) {
        if (!lowOxygenLatched) {
          lowOxygenLatched = true
          const kind = inWater ? 'drowning' : 'suffocating'
          log('warn', `reflex: ${kind}`, { oxygen: bot.oxygenLevel, head: head?.name })
          lessons?.recordHazard(kind, bot.entity?.position)
          logEvent({
            kind: `reflex_${kind}`,
            detail: `oxygen ${bot.oxygenLevel}, head block ${head?.name ?? 'unknown'}`,
            snapshot: snapshot(bot),
          })
          runner.interrupt(kind)
        }
        if (inWater) {
          bot.setControlState('jump', true)
          setTimeout(() => bot.setControlState('jump', false), 1200)
          return
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
      }
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
        lessons?.recordHazard('entombed', bot.entity?.position)
        logEvent({ kind: 'entombed', status: 'failed',
                   detail: `walled in at y=${Math.round(bot.entity.position.y)}`,
                   snapshot: snapshot(bot) })
        log('error', 'reflex: entombed, pillaring out', { y: Math.round(bot.entity.position.y) })
        runner.interrupt('entombed')
        try { await pillarOut(bot) } catch (e) { log('warn', 'pillar out failed', { err: e.message }) }
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
      log('error', 'reflex loop error', { err: e.message })
    }
  }, config.reflex.tickMs)

  return () => clearInterval(timer)
}

/** Walls on 3+ sides at head height, and open sky is far above. */
function isEntombed(bot) {
  const p = bot.entity.position

  // A CEILING is the load-bearing condition and the original version lacked it.
  // Without this, "walls on three sides plus higher ground nearby" describes an
  // ordinary hillside, and the reflex fired 1,997 times in 40 minutes at an
  // average y of 64 -- surface level, open sky overhead. Being genuinely
  // entombed means something is above you.
  const ceiling = bot.blockAt(p.offset(0, 2, 0))
  if (!ceiling || ceiling.name === 'air' || ceiling.name.includes('leaves')) return false

  let walls = 0
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const b = bot.blockAt(p.offset(dx, 1, dz))
    if (b && b.name !== 'air' && !b.name.includes('leaves')) walls++
  }
  if (walls < 3) return false
  // Distinguish "in a corridor" from "in a hole": look for ground much higher.
  let highest = -999
  for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [-4, -4]]) {
    for (let dy = 12; dy > -2; dy--) {
      const b = bot.blockAt(p.offset(dx, dy, dz))
      if (b && b.name !== 'air' && !b.name.includes('leaves')) {
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
    if (!isEntombed(bot)) break
  }

  const gained = bot.entity.position.y - startY
  if (gained < 1) {
    log('error', 'reflex: pillar out FAILED, no height gained', { y: Math.round(startY) })
    return digStraightUp(bot, startY)
  }
  log('info', 'reflex: pillared out', { from: Math.round(startY), to: Math.round(bot.entity.position.y) })
}

/** Break upward until there is open sky, then step out. */
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
async function unstick(bot) {
  const start = bot.entity.position.clone()
  const movedEnough = () => bot.entity.position.distanceTo(start) >= 3

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
