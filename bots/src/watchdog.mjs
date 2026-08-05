// Stagnation watchdog -- handoff doc S12.
//
// The reflex layer watches for IMMEDIATE danger on a 500ms timer. This watches
// for something slower and much harder to see: an agent that is busy and
// making no progress.
//
// That distinction matters because stagnation hides behind healthy signals.
// Observed live: twenty minutes entombed at y=49 while the decision rate,
// latency, and schema validity all looked perfect. Nothing was failing loudly
// enough to notice, so nothing noticed.
//
// It deliberately measures OUTCOMES, not activity:
//   - did the agent's position actually change?
//   - did its inventory actually change?
// Deciding, pathfinding, and running skills all count as activity and none of
// them count as progress.

import { logEvent, log } from './logger.mjs'
import { snapshot, inventorySummary } from './state.mjs'
import { config } from './config.mjs'

export class StagnationWatchdog {
  /**
   * @param bot      mineflayer bot
   * @param runner   task runner (so we only judge the agent while it is trying)
   * @param cognitive optional cognitive loop, for its memory
   */
  constructor(bot, runner, cognitive = null) {
    this.bot = bot
    this.runner = runner
    this.cognitive = cognitive
    this.samples = []          // { t, x, y, z, items }
    this.escalation = 0
    this.lastActionAt = Date.now()
    this.timer = null
  }

  start() {
    this.timer = setInterval(() => this.#check().catch(e =>
      log('error', 'watchdog error', { err: e.message })), config.watchdog.sampleMs)
    log('info', 'stagnation watchdog started', {
      windowSec: Math.round(config.watchdog.windowMs / 1000),
      minMove: config.watchdog.minMoveBlocks,
    })
  }

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null } }

  /** Called when a skill actually runs, so an idle agent is not judged as stuck. */
  noteActivity() { this.lastActionAt = Date.now() }

  #sample() {
    const p = this.bot.entity?.position
    if (!p) return null
    const items = Object.values(inventorySummary(this.bot)).reduce((a, b) => a + b, 0)
    const s = { t: Date.now(), x: p.x, y: p.y, z: p.z, items }
    this.samples.push(s)
    const cutoff = Date.now() - config.watchdog.windowMs
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift()
    return s
  }

  async #check() {
    if (!this.bot.entity) return
    this.#sample()

    // Need a full window before judging anything.
    const span = this.samples.length
      ? this.samples[this.samples.length - 1].t - this.samples[0].t : 0
    if (span < config.watchdog.windowMs * 0.9) return

    // Only judge an agent that is actually trying. An idle bot waiting for a
    // command is not stuck, and a finished agent is not stuck either.
    const idleFor = Date.now() - this.lastActionAt
    if (idleFor > config.watchdog.windowMs) return

    const xs = this.samples.map(s => s.x), ys = this.samples.map(s => s.y), zs = this.samples.map(s => s.z)
    const spread = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...zs) - Math.min(...zs))
    const climbed = Math.max(...ys) - Math.min(...ys)
    const gained = this.samples[this.samples.length - 1].items - this.samples[0].items

    const stagnant = spread < config.watchdog.minMoveBlocks &&
                     climbed < config.watchdog.minMoveBlocks &&
                     gained <= 0

    if (!stagnant) {
      if (this.escalation) log('info', 'watchdog: progress resumed', { escalation: this.escalation })
      this.escalation = 0
      return
    }

    this.escalation++
    const detail = `no progress for ${Math.round(span / 1000)}s ` +
                   `(moved ${spread.toFixed(1)} blocks, items ${gained >= 0 ? '+' : ''}${gained})`
    log('error', `watchdog: STAGNANT (level ${this.escalation})`, { detail })
    logEvent({ kind: 'stagnation', status: 'failed',
               detail: `${detail}; escalation ${this.escalation}`,
               snapshot: snapshot(this.bot) })
    this.cognitive?.memory?.addEvent(`watchdog: stuck making no progress — ${detail}`)

    await this.#escalate()
    this.samples = []           // fresh window so we judge the result, not the past
  }

  /**
   * Escalating response. Each level does something strictly more drastic than
   * the last, because "try the same recovery again" is what produced twenty
   * minutes of nothing.
   */
  async #escalate() {
    const p = this.bot.entity.position
    this.runner.cancel('stagnation')
    this.runner.resume()        // a stagnant agent must not also be paused

    if (this.escalation === 1) {
      // Move decisively further than a reflex nudge would.
      const ang = Math.random() * Math.PI * 2
      const d = 45 + Math.random() * 25
      const x = Math.round(p.x + Math.cos(ang) * d), z = Math.round(p.z + Math.sin(ang) * d)
      log('warn', 'watchdog: forcing relocation', { to: `${x},${z}` })
      await this.runner.run('goto', { x, y: Math.round(p.y), z }, { trigger: 'watchdog_relocate' })
      return
    }

    if (this.escalation === 2) {
      // Still stuck after a relocation: the local area is the problem. Go home,
      // which is known-reachable terrain by construction.
      log('warn', 'watchdog: relocation did not help, returning home')
      await this.runner.run('home', {}, { trigger: 'watchdog_home' })
      return
    }

    // Level 3+: everything local has failed. Reconnecting rebuilds the world
    // view and physics state, which clears whole classes of client-side wedge
    // that no in-world movement can fix.
    log('error', 'watchdog: repeated stagnation, reconnecting to reset client state')
    logEvent({ kind: 'stagnation_reconnect', status: 'failed',
               detail: `escalation ${this.escalation}; forcing reconnect`,
               snapshot: snapshot(this.bot) })
    this.escalation = 0
    try { this.bot.quit('watchdog: stagnation reset') } catch { /* already gone */ }
  }
}
