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

const FOOD_PRIORITY = [
  'golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
  'cooked_chicken', 'bread', 'baked_potato', 'cooked_cod', 'cooked_salmon',
  'apple', 'carrot', 'melon_slice', 'sweet_berries',
]

const DANGER_BLOCKS = new Set(['lava', 'fire', 'campfire', 'soul_fire', 'magma_block'])

export function startReflexes(bot, runner) {
  let lastPos = null
  let stillSince = Date.now()
  let eating = false
  let lowHealthLatched = false
  let escaping = false

  const timer = setInterval(async () => {
    if (!bot.entity) return

    try {
      // --- drowning -------------------------------------------------------
      if (bot.oxygenLevel != null && bot.oxygenLevel <= 4) {
        log('warn', 'reflex: drowning, surfacing')
        logEvent({ kind: 'reflex_drowning', detail: `oxygen ${bot.oxygenLevel}`, snapshot: snapshot(bot) })
        runner.interrupt('drowning')
        bot.setControlState('jump', true)
        setTimeout(() => bot.setControlState('jump', false), 1200)
        return
      }

      // --- standing in something that hurts --------------------------------
      const feet = bot.blockAt(bot.entity.position)
      const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
      if (DANGER_BLOCKS.has(feet?.name) || DANGER_BLOCKS.has(below?.name)) {
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
        if (!lowHealthLatched) {
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
      if (!escaping && isEntombed(bot)) {
        escaping = true
        logEvent({ kind: 'entombed', status: 'failed',
                   detail: `walled in at y=${Math.round(bot.entity.position.y)}`,
                   snapshot: snapshot(bot) })
        log('error', 'reflex: entombed, pillaring out', { y: Math.round(bot.entity.position.y) })
        runner.interrupt('entombed')
        try { await pillarOut(bot) } catch (e) { log('warn', 'pillar out failed', { err: e.message }) }
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

/** Jump-and-place under our own feet until back near the surrounding ground. */
async function pillarOut(bot, maxBlocks = 20) {
  const startY = bot.entity.position.y
  for (let i = 0; i < maxBlocks; i++) {
    const item = bot.inventory.items().find(it => PLACEABLE.test(it.name))
    if (!item) {
      log('warn', 'reflex: nothing placeable to pillar with; digging up instead')
      return digOut(bot)
    }
    await bot.equip(item, 'hand').catch(() => {})
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (!below) break
    bot.setControlState('jump', true)
    await sleep(280)
    try { await bot.placeBlock(below, new Vec3(0, 1, 0)) } catch { /* mistimed jump; retry */ }
    bot.setControlState('jump', false)
    await sleep(220)
    if (!isEntombed(bot)) break
  }
  log('info', 'reflex: pillared out', { from: Math.round(startY), to: Math.round(bot.entity.position.y) })
}

/** Last resort when there is nothing to stand on: dig a diagonal staircase up. */
async function digOut(bot, maxSteps = 24) {
  for (let i = 0; i < maxSteps; i++) {
    const target = bot.blockAt(bot.entity.position.offset(1, 2, 0))
        ?? bot.blockAt(bot.entity.position.offset(0, 2, 0))
    if (!target || target.name === 'air') { await sleep(250); continue }
    try { await bot.dig(target) } catch { break }
    bot.setControlState('forward', true); bot.setControlState('jump', true)
    await sleep(400)
    bot.clearControlStates()
    if (!isEntombed(bot)) break
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

/** Small random hop to break out of a pathfinder corner case. */
async function unstick(bot) {
  bot.setControlState('jump', true)
  bot.setControlState('back', true)
  await sleep(600)
  bot.clearControlStates()
  await bot.look(Math.random() * Math.PI * 2, 0, true).catch(() => {})
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const round1 = n => Math.round(n * 10) / 10

export { isNight }
