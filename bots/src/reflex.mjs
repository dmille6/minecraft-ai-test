// Reflex layer -- handoff doc S9.1.
//
// Runs continuously on a timer and never calls an LLM. Everything here is a
// survival response that must happen in under a second; routing any of it
// through a model would be both slower and less reliable.
//
// Reflexes may PREEMPT the running skill. That is the whole point: a bot
// calmly pathfinding into lava because it is "busy gathering" is the failure
// mode this layer exists to prevent.

import { log } from './logger.mjs'
import { config } from './config.mjs'
import { isNight } from './state.mjs'

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

  const timer = setInterval(async () => {
    if (!bot.entity) return

    try {
      // --- drowning -------------------------------------------------------
      if (bot.oxygenLevel != null && bot.oxygenLevel <= 4) {
        log('warn', 'reflex: drowning, surfacing')
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
          } catch (e) {
            log('debug', 'reflex: eat failed', { err: e.message })
          } finally {
            eating = false
          }
        }
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
