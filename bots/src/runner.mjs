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
import { snapshot } from './state.mjs'
import { config } from './config.mjs'

export class Runner {
  constructor(bot) {
    this.bot = bot
    this.current = null          // { skill, args, controller, startedAt }
    this.interruptedReason = null
    this.consecutiveFailures = 0
    this.paused = false
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

    if (this.paused) {
      return { status: 'failed', detail: `paused after ${this.consecutiveFailures} consecutive failures; send "resume"` }
    }
    if (this.current) {
      return { status: 'failed', detail: `busy with ${this.current.skill}; send "stop" first` }
    }

    const controller = new AbortController()
    const startedAt = Date.now()
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
        log('error', 'pausing after repeated failures', { count: this.consecutiveFailures })
      }
    } else if (result.status === 'success') {
      this.consecutiveFailures = 0
    }

    logSkill({
      skill: skillName, args, status: result.status, detail: result.detail,
      startedAt, snapshot: snapshot(this.bot),
      trigger: this.interruptedReason ? `interrupt:${this.interruptedReason}` : trigger,
    })
    log(result.status === 'success' ? 'info' : 'warn', `skill ${skillName} -> ${result.status}`, { detail: result.detail })

    this.current = null
    this.interruptedReason = null
    return result
  }

  resume() {
    this.paused = false
    this.consecutiveFailures = 0
  }
}
