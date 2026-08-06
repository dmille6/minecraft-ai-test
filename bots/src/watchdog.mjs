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
import pathfinderPkg from 'mineflayer-pathfinder'
const { goals } = pathfinderPkg
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

    // Only judge an agent that is actually TRYING.
    //
    // Three ways to be legitimately motionless, all of which the first version
    // misread as stagnation the moment Scout finished his milestones:
    //   - the cognitive loop has stopped (work is done)
    //   - every milestone is complete
    //   - nothing has been attempted recently (idle, awaiting a command)
    if (this.cognitive && !this.cognitive.running) return
    if (this.cognitive?.milestones?.allDone) return
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

    // Level 3+: everything local has failed.
    //
    // This used to reconnect unconditionally, on the theory that rebuilding the
    // world view clears client-side wedges. Measured over three hours: it fired
    // 68 times, and every one of 108 route failures in that window reported
    // "blocked after 0 leg(s)" -- the bot could not compute a first step. A
    // reconnect does not change terrain, position, inventory or the movement
    // rules, so it cannot fix that. It does destroy the working memory the
    // cognitive layer had built up. It was a remedy aimed at the wrong cause,
    // applied 68 times.
    //
    // Reconnect is still right for a genuinely wedged CLIENT, and the two cases
    // are distinguishable: if a path can be computed from here, the client is
    // fine and the bot is being blocked by something else; if no path exists at
    // all, the bot is physically stranded and needs terrain help, not a new
    // socket.
    let pathable = false
    try {
      const p = this.bot.entity?.position
      if (p && this.bot.pathfinder?.getPathTo && goals) {
        const r = this.bot.pathfinder.getPathTo(
          this.bot.pathfinder.movements,
          new goals.GoalNear(Math.round(p.x) + 8, Math.round(p.y), Math.round(p.z) + 8, 3),
          800)
        pathable = !!(r && r.path && r.path.length > 0)
      }
    } catch { /* treated as not pathable, which is the safer branch */ }

    if (pathable) {
      // A route exists and the bot still is not moving: that is the client-state
      // wedge reconnecting was written for.
      log('error', 'watchdog: stagnant despite a computable route, reconnecting')
      logEvent({ kind: 'stagnation_reconnect', status: 'failed',
                 detail: `escalation ${this.escalation}; route exists but no movement`,
                 snapshot: snapshot(this.bot) })
      this.escalation = 0
      try { this.bot.quit('watchdog: stagnation reset') } catch { /* already gone */ }
      return
    }

    // Physically stranded. Say so as a distinct, countable event rather than
    // burning a reconnect on it -- "how often is a bot walled in by its own
    // movement rules" is a number this project needs, and it was previously
    // indistinguishable from a client wedge.
    log('error', 'watchdog: STRANDED -- no route computable from here; reconnect would not help')
    logEvent({ kind: 'stranded', status: 'failed',
               detail: `escalation ${this.escalation}; no first leg exists from this position`,
               snapshot: snapshot(this.bot) })
    this.escalation = 0
  }
}
