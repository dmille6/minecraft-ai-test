// Task runner: exactly one skill in flight, cancellable, with a watchdog.
//
// Single-slot on purpose. Two skills driving the same pathfinder produce
// behaviour nobody can debug, and "what is this bot doing right now" must
// always have one answer.
//
// Handoff doc S12 wants watchdogs for: task running beyond expected duration,
// repeated failure, and agent paused after repeated failures. All three live here.

import { SKILLS } from './skills.mjs'
import { logSkill, log } from './logger.mjs'
import { snapshot, perception, biomeAt, classifyFailure, inventorySummary } from './state.mjs'
import { config } from './config.mjs'

export class Runner {
  constructor(bot) {
    this.bot = bot
    this.current = null          // { skill, args, controller, startedAt }
    this.interruptedReason = null
    this.consecutiveFailures = 0
    this.paused = false
    this.pausedAt = null
  }

  isBusy() { return this.current !== null }
  isInterrupted() { return this.interruptedReason !== null }
  describe() { return this.current ? `${this.current.skill} ${JSON.stringify(this.current.args)}` : 'idle' }

  /** Called by the reflex layer. Aborts the running skill. */
  interrupt(reason) {
    if (!this.current) return false
    this.interruptedReason = reason
    this.current.controller.abort()
    return true
  }

  cancel(reason = 'cancelled') { return this.interrupt(reason) }

  async run(skillName, args = {}, { trigger = 'chat' } = {}) {
    const def = SKILLS[skillName]
    if (!def) return { status: 'failed', detail: `unknown skill "${skillName}"` }

    // The pause is a safety valve, not a trap. It was written for chat-driven
    // operation where a human types "resume" -- in autonomous mode there is no
    // human, so a third consecutive failure froze the agent permanently.
    // Observed: 16 minutes standing still in a forest.
    if (this.paused) {
      const waited = Date.now() - (this.pausedAt ?? 0)
      if (waited >= config.skills.pauseRecoveryMs) {
        log('info', 'auto-resuming after pause', { pausedForSec: Math.round(waited / 1000) })
        this.resume()
      } else {
        return {
          status: 'failed',
          detail: `paused after repeated failures; ${Math.ceil((config.skills.pauseRecoveryMs - waited) / 1000)}s until auto-resume`,
        }
      }
    }
    if (this.current) {
      return { status: 'failed', detail: `busy with ${this.current.skill}; send "stop" first` }
    }

    this.watchdog?.noteActivity()
    const controller = new AbortController()
    const startedAt = Date.now()
    const invBefore = inventorySummary(this.bot)
    const posBefore = this.bot.entity?.position?.clone()
    const hpBefore = this.bot.health
    const foodBefore = this.bot.food
    this.current = { skill: skillName, args, controller, startedAt }
    this.interruptedReason = null

    const watchdog = setTimeout(() => {
      log('warn', 'watchdog fired', { skill: skillName, ms: config.skills.defaultTimeoutMs })
      this.interruptedReason = 'timeout'
      controller.abort()
    }, config.skills.defaultTimeoutMs)

    let result
    try {
      result = await def.run({ bot: this.bot, runner: this }, args, controller.signal)
    } catch (e) {
      result = e?.aborted
        ? { status: 'aborted', detail: this.interruptedReason ?? 'aborted' }
        : { status: 'failed', detail: e?.message ?? String(e) }
    } finally {
      clearTimeout(watchdog)
      try { this.bot.pathfinder?.setGoal(null) } catch { /* not connected */ }
    }

    // Aborts are usually the reflex layer doing its job, so they must not
    // count toward the failure budget -- otherwise a hostile mob pauses the bot.
    if (result.status === 'failed') {
      this.consecutiveFailures++
      if (this.consecutiveFailures >= config.skills.maxConsecutiveFailures) {
        this.paused = true
        this.pausedAt = Date.now()
        log('error', 'pausing after repeated failures', {
          count: this.consecutiveFailures,
          autoResumeInSec: Math.round(config.skills.pauseRecoveryMs / 1000),
        })
      }
    } else if (result.status === 'success') {
      this.consecutiveFailures = 0
    }

    // What actually changed as a result of running this skill. "gather returned
    // success" and "the bot is 8 logs richer" are different claims, and only the
    // second one is checkable.
    const invAfter = inventorySummary(this.bot)
    const delta = {}
    for (const k of new Set([...Object.keys(invBefore), ...Object.keys(invAfter)])) {
      const d = (invAfter[k] ?? 0) - (invBefore[k] ?? 0)
      if (d !== 0) delta[k] = d
    }
    const posAfter = this.bot.entity?.position
    const moved = posBefore && posAfter ? Math.round(posBefore.distanceTo(posAfter)) : undefined

    const snap = snapshot(this.bot)
    if (snap.game) snap.game.biome = biomeAt(this.bot)

    logSkill({
      skill: skillName, args, status: result.status, detail: result.detail,
      startedAt, snapshot: snap,
      trigger: this.interruptedReason ? `interrupt:${this.interruptedReason}` : trigger,
      invDelta: Object.keys(delta).length ? delta : undefined,
      distanceMoved: moved,
      failClass: result.status === 'success' ? undefined : classifyFailure(result.detail),
      perception: perception(this.bot),
    })
    log(result.status === 'success' ? 'info' : 'warn', `skill ${skillName} -> ${result.status}`, { detail: result.detail })

    this.current = null
    this.interruptedReason = null
    // Hand the DELTA back, not just the status. The runner already computed
    // exactly what changed and then dropped it, so the learning layer could only
    // ever see "did the call return cleanly?" -- which is how `status` came to
    // be recorded as this fleet's most reliable action 115 times over, and how
    // 46% of all "successes" turned out to have moved nothing and changed no
    // inventory. ADR-0003.
    return {
      ...result,
      delta: {
        inventory: Object.keys(delta).length ? delta : {},
        distance: moved ?? 0,
        health: (this.bot.health ?? 0) - (hpBefore ?? 0),
        food: (this.bot.food ?? 0) - (foodBefore ?? 0),
        placed: /build|place/.test(skillName) && Object.values(delta).some(d => d < 0) ? 1 : 0,
        informed: skillName === 'status',
      },
    }
  }

  resume() {
    this.paused = false
    this.pausedAt = null
    this.consecutiveFailures = 0
  }
}
