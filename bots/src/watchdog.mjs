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

    // CHRONIC STRANDING IS A DIFFERENT QUESTION FROM STAGNATION, ON A DIFFERENT
    // CLOCK, AND IT NEEDS ITS OWN HISTORY.
    //
    // `samples` is pruned to config.watchdog.windowMs (180s) because stagnation
    // is about the last few minutes of trying. Stranding is about whether the
    // bot has got ANYWHERE over a much longer stretch, so it keeps a coarse
    // record of its own rather than lengthening the stagnation window and
    // changing what that judgement means.
    this.strandHistory = []    // { t, y, items, milestone }
    this.strandWindows = 0     // consecutive windows meeting the condition
    this.surfaceAttempts = 0   // climb-outs tried since the last real progress
  }

  start() {
    this.timer = setInterval(() => this.check().catch(e =>
      log('error', 'watchdog error', { err: e.message })), config.watchdog.sampleMs)
    log('info', 'stagnation watchdog started', {
      windowSec: Math.round(config.watchdog.windowMs / 1000),
      minMove: config.watchdog.minMoveBlocks,
    })
  }

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null } }

  /** Called when a skill actually runs, so an idle agent is not judged as stuck. */
  noteActivity() { this.lastActionAt = Date.now() }

  /**
   * IS THIS BOT STRANDED UNDERGROUND? An OUTCOME test, deliberately not a
   * capability test.
   *
   * Every capability probe this project has written has been satisfied by the
   * broken state it was meant to catch. isEntombed() asks "is my head blocked",
   * and Miner01 sat at the bottom of an open shaft for ninety minutes with a
   * clear head. canStartAPath() asks for a route to (x+8, y, z+8) -- eight
   * blocks DIAGONALLY AT THE SAME DEPTH -- which a bot in a large cavern
   * satisfies instantly while a hundred blocks below anything useful. On
   * 2026-08-10 five bots sat at y=-42, -42, -2, 29 and 55 for 45 minutes while
   * every guard in the system reported success.
   *
   * The pathfinder cannot answer the real question: getPathTo advances its
   * incremental search exactly once per call, so any distant or vertical goal
   * returns `partial`. Aiming the probe higher would report NOT-REACHABLE for
   * healthy bots too. That constraint is why the check was written to look
   * eight blocks sideways in the first place, and it is not going away.
   *
   * So stop asking whether the bot COULD leave and ask whether it HAS got
   * anywhere. A bot deep underground that has gained no height, completed no
   * milestone and collected nothing over two consecutive windows is stranded,
   * whatever any probe says about its local mobility.
   *
   * The inventory term is what keeps a working miner out of this. Miner01
   * legitimately spends long stretches below y=50; what it does NOT do is spend
   * them without its inventory changing.
   */
  /**
   * Act on the stranding verdict, and only after it has held twice.
   *
   * TWO WINDOWS, not one. A single six-minute window can legitimately show no
   * height gain and no inventory change -- a long walk, a slow craft chain, a
   * bot waiting out a mob. Requiring the condition to hold across two
   * consecutive windows costs twelve minutes before acting and is the
   * difference between rescuing a stuck bot and interrupting a working one.
   */
  async #judgeStranding() {
    const v = this.#strandingVerdict()
    if (!v) return

    const stranded = v.deep && v.altitudeGain < v.needGain && !v.milestoneMoved && !v.itemsChanged
    if (!stranded) {
      if (this.strandWindows > 0) {
        log('info', 'watchdog: no longer stranded', {
          y: Math.round(v.window[v.window.length - 1].y),
          gain: Math.round(v.altitudeGain),
        })
      }
      this.strandWindows = 0
      this.surfaceAttempts = 0
      return
    }

    this.strandWindows++
    const y = Math.round(v.window[v.window.length - 1].y)
    if (this.strandWindows < 2) {
      log('warn', 'watchdog: possible stranding, waiting one more window', {
        y, gain: Math.round(v.altitudeGain),
      })
      return
    }

    // Held across two windows. This bot is not working underground, it is stuck
    // underground, and the difference is now evidenced rather than assumed.
    this.surfaceAttempts++
    logEvent({
      kind: 'stranded_underground', status: 'failed',
      detail: `y=${y}, ${Math.round(v.altitudeGain)}b net gain over ` +
              `${Math.round((v.window[v.window.length - 1].t - v.window[0].t) / 60000)}m, ` +
              `no milestone change, no inventory change; climb-out attempt ${this.surfaceAttempts}`,
      snapshot: snapshot(this.bot),
    })

    if (this.surfaceAttempts <= 2) {
      log('error', 'watchdog: STRANDED UNDERGROUND -- forcing a climb-out',
          { y, attempt: this.surfaceAttempts })
      this.runner.cancel('stranded')
      this.runner.resume()
      try {
        await this.runner.run('surface', {}, { trigger: 'watchdog_stranded_underground' })
      } catch (e) {
        log('error', 'watchdog: climb-out failed', { err: e.message })
      }
      // Do NOT clear strandWindows here. The next window decides whether it
      // worked, and altitude is what answers that -- not the fact that a rescue
      // ran. A rescue that reports success while the bot stays at y=-42 is the
      // exact failure this whole class of bug is made of.
      this.strandWindows = 1
      return
    }

    // Two climb-outs and still down there. Say so as a distinct, countable
    // state rather than trying a third identical rescue.
    //
    // TELEPORT IS THE OBVIOUS NEXT STEP AND IS DELIBERATELY NOT DONE HERE. It
    // would work, but a teleported bot did not solve its own problem, and this
    // is an experiment about how agents learn. Moving one is an EXTERNAL
    // INTERVENTION: legitimate only if it is recorded as one so those episodes
    // can be excluded from analysis. That needs an operator decision and a
    // telemetry field, not a quiet line in a watchdog.
    log('error', 'watchdog: STRANDED after 2 climb-outs -- needs intervention', { y })
    logEvent({
      kind: 'stranded_unrecoverable', status: 'failed',
      detail: `y=${y}: two climb-out attempts produced under ${v.needGain}b of gain each. ` +
              `Deterministic rescue has been exhausted; escalating rather than repeating it.`,
      snapshot: snapshot(this.bot),
    })
    this.strandWindows = 1
  }

  #strandingVerdict(now = Date.now()) {
    const W = config.watchdog.strandWindowMs ?? 6 * 60_000
    const p = this.bot.entity?.position
    if (!p) return null
    const items = Object.values(inventorySummary(this.bot)).reduce((a, b) => a + b, 0)
    const milestone = (() => {
      try { return this.cognitive?.milestones?.status?.()?.id ?? null } catch { return null }
    })()
    this.strandHistory.push({ t: now, y: p.y, items, milestone })
    // Keep a little over two windows so a verdict always has a full one behind it.
    const cutoff = now - W * 2.5
    while (this.strandHistory.length && this.strandHistory[0].t < cutoff) this.strandHistory.shift()

    const win = this.strandHistory.filter(s => s.t >= now - W)
    if (win.length < 2 || (win[win.length - 1].t - win[0].t) < W * 0.9) return null

    const depth = config.watchdog.strandDepthY ?? 50
    const gain = config.watchdog.strandMinGainY ?? 8
    const ys = win.map(s => s.y)
    return {
      deep: p.y < depth,
      // NET gain, not range: a bot bouncing up and down a shaft is not leaving.
      altitudeGain: ys[ys.length - 1] - ys[0],
      milestoneMoved: win[0].milestone !== win[win.length - 1].milestone,
      itemsChanged: win[win.length - 1].items !== win[0].items,
      window: win,
      needGain: gain,
    }
  }

  #sample() {
    const p = this.bot.entity?.position
    if (!p) return null
    const items = Object.values(inventorySummary(this.bot)).reduce((a, b) => a + b, 0)
    // WAS A SKILL ACTUALLY RUNNING when we took this sample?
    //
    // Without this the watchdog measures the decision cadence, not stagnation.
    // At a 70s cooldown a bot acts for ~5s and then stands still for ~65s BY
    // DESIGN, so any 180s window shows almost no movement. Measured over 913
    // stagnation events: median displacement 0.0 blocks, and only 9% fired with
    // the bot having moved more than 2 blocks. The watchdog was right that
    // nothing moved and wrong about what that meant -- and then cancelled
    // whichever skill happened to be running when the window matured, which is
    // 97 goto and 52 home failures blamed on the wrong cause.
    //
    // Being motionless is only evidence of being stuck if the bot was TRYING.
    const s = { t: Date.now(), x: p.x, y: p.y, z: p.z, items, busy: !!this.runner?.isBusy?.() }
    this.samples.push(s)
    const cutoff = Date.now() - config.watchdog.windowMs
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift()
    return s
  }

  /**
   * One judgement pass. Public because the timer is not a testable surface:
   * at a 15s sample interval a test would have to wait three minutes to see a
   * single verdict, so the tests drive this directly.
   */
  async check() {
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

    // CHRONIC STRANDING, judged before stagnation and on its own clock.
    //
    // A stranded bot is usually not stagnant by the definition above: it walks
    // around its cave, runs skills, and fails them, so `busy` time accrues and
    // displacement looks fine. It is going nowhere in the only direction that
    // matters. That is invisible to a 180-second window and obvious over six
    // minutes.
    await this.#judgeStranding()

    const idleFor = Date.now() - this.lastActionAt
    if (idleFor > config.watchdog.windowMs) return

    // JUDGE ONLY THE TIME THE BOT WAS TRYING. Samples taken while no skill was
    // running are idle-by-design and say nothing about being stuck.
    const busy = this.samples.filter(s => s.busy)
    const busyMs = busy.length > 1 ? busy[busy.length - 1].t - busy[0].t : 0

    // A bot must have been actively working for a meaningful stretch before it
    // can be called stagnant. One skill's worth is the right unit: below this
    // the window is dominated by decision gaps and the verdict is meaningless.
    const MIN_BUSY_MS = Math.min(60_000, config.watchdog.windowMs / 3)
    if (busyMs < MIN_BUSY_MS) {
      this.escalation = 0
      return
    }

    const xs = busy.map(s => s.x), ys = busy.map(s => s.y), zs = busy.map(s => s.z)
    const spread = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...zs) - Math.min(...zs))
    const climbed = Math.max(...ys) - Math.min(...ys)
    const gained = busy[busy.length - 1].items - busy[0].items

    const stagnant = spread < config.watchdog.minMoveBlocks &&
                     climbed < config.watchdog.minMoveBlocks &&
                     gained <= 0

    // HOW LONG HAS IT ACTUALLY NOT MOVED -- the number people kept wanting when
    // they read the old message. `span` cannot answer it: the gate above refuses
    // to judge until span >= windowMs * 0.9, so span is bounded below by 162s and
    // a "median of 165s" was a constant of the design being read as a measurement
    // of freeze duration.
    let frozenMs = 0
    for (let i = this.samples.length - 1; i > 0; i--) {
      const a = this.samples[i], b = this.samples[i - 1]
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= 1) break
      frozenMs = this.samples[this.samples.length - 1].t - b.t
    }

    if (!stagnant) {
      if (this.escalation) log('info', 'watchdog: progress resumed', { escalation: this.escalation })
      this.escalation = 0
      return
    }

    this.escalation++
    // State the design constants separately from the observations, so no future
    // reader can mistake a threshold for a measurement.
    const detail = `no progress across ${Math.round(busyMs / 1000)}s of ACTIVE skill time ` +
                   `(moved ${spread.toFixed(1)} blocks, items ${gained >= 0 ? '+' : ''}${gained}, ` +
                   `frozen ${Math.round(frozenMs / 1000)}s; window ${Math.round(config.watchdog.windowMs / 1000)}s, ` +
                   `threshold ${config.watchdog.minMoveBlocks} blocks)`
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

    // AND THEN IT DID NOTHING, AND RESET ITS OWN COUNTER.
    //
    // This branch logged the diagnosis, cleared `escalation`, and returned --
    // so the ladder started again from zero, reached level 3, logged the same
    // line, and reset again, forever. The one state the watchdog identifies
    // most precisely was the one it never acted on. Measured 2026-08-10:
    // `stranded` 12 times and `_path_noPath` 431 times in thirty minutes, with
    // bots sitting at y=-45, -42, -42 the whole while.
    //
    // Reconnect is correctly ruled out above -- it changes no terrain. But
    // "reconnect will not help" is not a reason to do nothing; it is a reason
    // to do the thing that WILL. The bot cannot compute a first leg, so give it
    // one: `surface` is the deterministic climb-out, it does not depend on the
    // pathfinder finding a route first, and it is the skill written for exactly
    // this position.
    //
    // Escalation is NOT reset here. A rescue that did not work must leave the
    // ladder where it was, or the next failure is indistinguishable from the
    // first and the bot loops at level 3 forever. It resets in #check() when
    // real progress is observed, which is the only evidence that means it.
    log('warn', 'watchdog: stranded -- forcing a climb-out rather than counting it again')
    try {
      await this.runner.run('surface', {}, { trigger: 'watchdog_stranded' })
    } catch (e) {
      log('error', 'watchdog: climb-out failed', { err: e.message })
    }
  }
}
