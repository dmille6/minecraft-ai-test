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
import { HARD_STOP_GRACE_MS } from './hard-stop.mjs'
import { logRescueRow } from './rescuerow.mjs'
import { airAdmission, airDeclineNext } from './airstate.mjs'
import { pickRelocationTargetAsync, landingCheck, reasonsLabel } from './relocate.mjs'
import { relocationForbidden } from './keepout.mjs'   // keepout-01 x homefix-02: no relocation into a fire column
import { skyEscapeBlocked } from './respawnfall.mjs'   // respawnfall-01
import { Vec3 } from 'vec3'

// ---------------------------------------------------------------------------
// THE RESCUE CONTRACT (homefix-01, docs/reports/expansion-plan-2026-10-19.md §2 H2a/H2b, "The H2 fix, as one contract").
//
// H2a: `#escalate` cancelled the skill and then called runner.run(), which returned `runner_busy` while the cancelled
// skill was still unwinding (`current` was set until after its logging) -- >= 45.9% of level-2 rescues never ran. H2b:
// check() had no in-flight guard, so 15 s into a rescue the next tick judged the OLD stagnant window plus 15 s of the
// rescue and cancelled it (404 of 610 cut at 10-20 s). The contract:
//   1. PENDING FROM THE VERDICT: no verdict and no cancel from either judgement while a rescue is pending; both histories
//      still sample. Released in a finally (identity-guarded) around the whole escalation.
//   2. CANCEL AND RESERVE in one step (Runner.reserve): nothing else can start into the gap.
//   4. THE LEVEL IS HELD (escalation--, window reset, one window of backoff) when the rescue did not START -- except after
//      RESERVE_EXPIRED_CAP consecutive `reserve_expired`: a skill ignoring its abort twice is the wedge, so go to level 3,
//      whose reconnect needs no runner.
//   5. THE WINDOW IS RESET WHEN THE RESCUE STARTS, so the next verdict is on the rescue's own samples.
//   7. ONE RESCUE AT A TIME: stagnation and stranding share `pending`.
//   8. EVERY ATTEMPT IS LOGGED (`_watchdog_rescue`, rescuerow.mjs).
// ---------------------------------------------------------------------------
export const RESCUE_OWNER = 'watchdog'
/** The reservation a rescue takes (<= Runner.RESERVE_MAX_MS): ~95% of measured unwinds finish inside it (h11). */
export const RESCUE_RESERVE_MS = 20_000
/** Consecutive `reserve_expired` declines after which the level is no longer held (item 4). */
export const RESERVE_EXPIRED_CAP = 2
/** Stranding climb-outs refunded per episode when the air reflex interrupted them (homefix-02 C3b). */
export const AIR_REFUND_CAP = 2

/**
 * DOES THIS CLIMB-OUT COUNT AS ONE OF THE TWO? -> { refund, refunds }. Pure. A climb-out that never started (any decline,
 * `air_rescue` included) is refunded, as before homefix-02. One the air reflex interrupted during a drowning in progress
 * (`interruptedBy === 'drowning'`, C3b) is refunded at most `cap` times per stranding episode, so a flooded cave still
 * reaches `stranded_unrecoverable` (Claude r3 P3-3).
 */
export function strandRefund ({ out = null, refunds = 0, cap = AIR_REFUND_CAP } = {}) {
  if (!out) return { refund: false, refunds }
  if (!out.started) return { refund: true, refunds }
  if (out.r?.interruptedBy === 'drowning' && refunds < cap) return { refund: true, refunds: refunds + 1 }
  return { refund: false, refunds }
}

/**
 * WHAT A RESCUE'S OUTCOME DOES TO THE LADDER -> { streak, hold, jump }. Pure (H2 item 4).
 *   started            the rescue ran: nothing held, the decline streak ends (the window was reset at its start)
 *   not started        held: the level goes back one and backs off one window ...
 *   ... unless this is the RESERVE_EXPIRED_CAP-th consecutive reserve_expired: not held, and below level 3 jump to it
 */
export function rescueLevelStep ({ started = false, failClass = null, level = 0, streak = 0, cap = RESERVE_EXPIRED_CAP,
                                   sinceLastMs = 0, ttlMs = Infinity } = {}) {
  if (started) return { streak: 0, hold: false, jump: false }
  // A DROWNING IN PROGRESS DECLINED THE START (homefix-02 C3a): held like any rescue that did not start, and it is NOT
  // wedge evidence -- the reserve_expired streak is left exactly as it was (Codex r1 P2-5, Claude r1 P2-4).
  if (failClass === 'air_rescue') return { streak, hold: true, jump: false }
  // CONSECUTIVE MEANS RECENT (Claude code r1 P3-4): a streak of 1 left from hours ago is not half of a wedge, so an old
  // reserve_expired does not count toward the cap -- only one inside `ttlMs` of this one (the watchdog passes two windows,
  // the held level's backoff and the next verdict's window, plus the pending bound: 590 s at production clocks).
  const live = sinceLastMs <= ttlMs ? streak : 0
  const n = failClass === 'reserve_expired' ? live + 1 : 0
  if (n >= cap) return { streak: n, hold: false, jump: level < 3 }
  return { streak: n, hold: true, jump: false }
}

/**
 * At or above this the bot is stranded ON the world rather than under it, and
 * the escalation must point DOWN. 125 is where the measured population splits:
 * of the fifteen stranded bots on 2026-09-04, six sat at y>=125 and seven at
 * y<=47, with almost nothing in between.
 */
const STRANDED_HIGH_Y = 125
/** Bedrock. `mine` cannot be asked to descend past it. */
const WORLD_FLOOR = -59

/** A furnace session's declared stationary window is open now (skills.mjs smelt). */
export const furnaceWindow = bot => Number(bot?.furnaceWindowUntil) > Date.now()
/**
 * The busy time in [from, to] -> ms, excluding every interval that touches a FURNACE sample. Pure. Samples in time order.
 * Without furnace samples this is exactly to - from (the base's busy span).
 */
export function activeSpanMs (samples = [], from = 0, to = 0) {
  let ms = to - from
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i]
    if (b.t <= from || a.t >= to) continue
    if (a.furnace || b.furnace) ms -= Math.min(b.t, to) - Math.max(a.t, from)
  }
  return Math.max(0, ms)
}

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
    this.strandWindows = 0     // consecutive WINDOWS (not ticks) meeting the condition
    this.surfaceAttempts = 0   // climb-outs tried since the last real progress
    this.airRefunds = 0        // climb-outs refunded because the air reflex took them (homefix-02 C3b), this episode
    this.airDeclines = { stagnation: 0, stranding: 0 }   // consecutive `air_rescue` declines per rescue kind (C3a cap)
    this.lastStrandJudgedAt = 0

    // THE RESCUE CONTRACT's state (see the header). `pending` = { attempt, kind, level, at, startedAt, tickSeen, gen,
    // rescue } while a rescue is requested or running. The streak survives the `escalation = 0` resets on purpose.
    this.pending = null
    this.attemptSeq = 0
    this.reserveExpiredStreak = 0
    this.lastReserveExpiredAt = -Infinity
    this.backoffUntil = 0
    this.windowResetAt = 0
    this.reserveMs = RESCUE_RESERVE_MS
  }

  /** The most a pending rescue can last: the reservation + the rescue's skill timeout + the hard-stop grace (item 6). */
  pendingBoundMs () { return this.reserveMs + config.skills.defaultTimeoutMs + HARD_STOP_GRACE_MS }

  #resetWindow () { this.samples = []; this.windowResetAt = Date.now() }

  #newAttempt () { return `${Date.now().toString(36)}-${++this.attemptSeq}` }

  /** A tick while a rescue is pending: sample both histories, issue nothing (item 1); mark the first tick in a started rescue. */
  #pendingTick () {
    const now = Date.now()
    this.#strandSample(now)
    const pd = this.pending
    if (!pd) return
    if (pd.startedAt && !pd.tickSeen && pd.rescue) {
      pd.tickSeen = true
      logRescueRow(this.bot, pd.rescue, 'tick_seen', { pending_ms: now - pd.at })
    }
    // A backstop, not the bound: the runner itself releases the body by pendingBoundMs (its hard stop). Past it with
    // margin, a pending that never cleared would silence the watchdog forever, which is the old H2a in a new place.
    if (now - pd.at > this.pendingBoundMs() + 30_000) {
      log('error', 'watchdog: a pending rescue outlived its bound; releasing it', { attempt: pd.attempt, ms: now - pd.at })
      this.pending = null
    }
  }

  /**
   * ONE RESCUE, PENDING FROM THE VERDICT TO ITS END (items 1, 6, 7). `body(pending)` does the work; whatever it does or
   * throws (e.g. reading the position after a disconnect), the pending flag and this attempt's reservation are released.
   */
  async #rescue (kind, body) {
    const mine = { attempt: this.#newAttempt(), kind, level: this.escalation, at: Date.now(), startedAt: null,
                   tickSeen: false, gen: null, rescue: null }
    this.pending = mine
    try { return await body(mine) }
    catch (e) { log('error', 'watchdog: rescue threw', { err: e?.message, kind }); return null }
    finally {
      if (mine.gen != null) { try { this.runner.releaseReservation?.(mine.gen) } catch {} }
      if (this.pending === mine) this.pending = null
    }
  }

  /**
   * Run one rescue skill through the runner: `requested` row, cancel-and-reserve, then the owner's run. Returns
   * { r, started }. A runner without reserve() (the unit fakes) gets the old cancel.
   */
  async #runRescue (pd, { level, remedy, skill, args, trigger, reason, rowExtra = {} }) {
    pd.level = level
    pd.rescue = { attempt: pd.attempt, level, remedy }
    logRescueRow(this.bot, pd.rescue, 'requested', { skill, kind: pd.kind, ...rowExtra })
    if (typeof this.runner.reserve === 'function') pd.gen = this.runner.reserve(RESCUE_OWNER, this.reserveMs, reason).gen
    else this.runner.cancel(reason)
    this.runner.resume()        // a stagnant agent must not also be paused
    const r = await this.runner.run(skill, args, {
      trigger, owner: RESCUE_OWNER, rescue: pd.rescue,
      onStart: () => { pd.startedAt = Date.now(); this.reserveExpiredStreak = 0; this.#resetWindow() },
      // homefix-02 C3a: asked by the runner at the instant of the start (after the unwind), never before reserve(); the
      // per-kind decline count caps it (airstate.mjs AIR_DECLINE_CAP)
      admit: () => airAdmission(this.bot?.airRescue ?? null, Date.now(), { declines: this.airDeclines[pd.kind] ?? 0 }),
    })
    this.airDeclines[pd.kind] = airDeclineNext(this.airDeclines[pd.kind] ?? 0, { started: pd.startedAt != null, failClass: r?.failClass ?? null })
    return { r: r ?? null, started: pd.startedAt != null }
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
   * Act on the stranding verdict, and only after it has held twice.
   *
   * TWO WINDOWS, not one. A single six-minute window can legitimately show no
   * height gain and no inventory change -- a long walk, a slow craft chain, a
   * bot waiting out a mob. Requiring the condition to hold across two
   * consecutive windows costs twelve minutes before acting and is the
   * difference between rescuing a stuck bot and interrupting a working one.
   */
  /**
   * Public for the same reason check() is: the 15s timer is not a testable
   * surface. At a six-minute window a test driving the timer would take twelve
   * minutes to see one verdict, so the tests call this directly with a
   * controlled clock -- which is how the tick-vs-window unit bug was caught.
   */
  async judgeStranding() {
    // ONE VERDICT PER WINDOW, NOT ONE PER SAMPLE.
    //
    // check() runs every 15s. Counting a "window" on every call made the
    // two-window requirement mean thirty seconds instead of twelve minutes:
    // deployed 2026-08-11, it burned through both climb-outs inside a minute
    // and wrote 43 `stranded_underground` events in 22 minutes, one every
    // sample. The threshold was reasoned about in minutes and implemented in
    // ticks.
    //
    // The history still accumulates every call -- that is what makes the
    // six-minute measurement possible -- but the JUDGEMENT is rate-limited to
    // the window it is defined over.
    const now = Date.now()
    const W = config.watchdog.strandWindowMs ?? 6 * 60_000
    // ONE RESCUE AT A TIME (homefix-01 H2 items 1, 7): while any rescue is pending this judgement only samples.
    if (this.pending) { this.#strandSample(now); return 'pending' }
    // Sample on EVERY call -- the six-minute measurement is built from these --
    // but judge at most once per window.
    const v = this.#strandingVerdict(now)
    if (now - (this.lastStrandJudgedAt ?? 0) < W) return
    this.lastStrandJudgedAt = now
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
      this.airRefunds = 0
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
              `no milestone change, no inventory change; climb-out attempt ${this.surfaceAttempts}` +
              `${this.airRefunds ? `; air refunds ${this.airRefunds}` : ''}`,
      snapshot: snapshot(this.bot),
    })

    if (this.surfaceAttempts <= 2) {
      log('error', 'watchdog: STRANDED UNDERGROUND -- forcing a climb-out',
          { y, attempt: this.surfaceAttempts })
      // The same contract as the stagnation rescue (homefix-01 H2a: this shared the cancel-then-run shape): pending,
      // cancel-and-reserve, attempt rows. Level 0 in the rows names the stranding ladder.
      const out = await this.#rescue('stranding', pd => this.#runRescue(pd, {
        level: 0, remedy: 'climb_out', skill: 'surface', args: {}, trigger: 'watchdog_stranded_underground', reason: 'stranded' }))
      // A climb-out that never started was not an attempt: it does not use up one of the two. ONE THE AIR REFLEX TOOK
      // (homefix-02 C3b) is refunded too, at most AIR_REFUND_CAP times per episode (strandRefund).
      const rf = strandRefund({ out, refunds: this.airRefunds })
      if (rf.refund) this.surfaceAttempts--
      this.airRefunds = rf.refunds
      // Do NOT clear strandWindows here. The next window decides whether it
      // worked, and altitude is what answers that -- not the fact that a rescue
      // ran. A rescue that reports success while the bot stays at y=-42 is the
      // exact failure this whole class of bug is made of.
      this.strandWindows = 1
      return 'rescued'
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
  /** The stranding history's sample, split out so a pending tick can take it without judging (homefix-01 H2 item 1). */
  #strandSample(now = Date.now()) {
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
    return p
  }

  #strandingVerdict(now = Date.now()) {
    const W = config.watchdog.strandWindowMs ?? 6 * 60_000
    const p = this.#strandSample(now)
    if (!p) return null

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
    // ...and a FURNACE SESSION is not trying to move either (smeltjob-01): eight items are 80 s at the furnace, and a smelt
    // converts 1:1, so it never gains items. Scoped to the furnace's declared window (bot.furnaceWindowUntil, its own
    // deadline, bounded by the session's; Codex code r1 P1-2, Claude code r2 P3) -- the compost and town-deposit windows are judged as on
    // the base. Such a sample is `furnace` and not busy.
    const furnace = furnaceWindow(this.bot)
    const s = { t: Date.now(), x: p.x, y: p.y, z: p.z, items, busy: !!this.runner?.isBusy?.() && !furnace, furnace }
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
    // A RESCUE IS PENDING (homefix-01 H2 items 1, 5): this tick samples both histories and issues NO verdict and NO cancel.
    // Before this guard the 15 s setInterval re-entered check() mid-rescue and cut the rescue on the OLD window.
    if (this.pending) { this.#pendingTick(); return }

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
    // A FURNACE SESSION IS RUNNING NOW: never judged mid-session (Codex code r1 P1-2: the busy samples taken BEFORE the
    // declaration would otherwise cancel the smelt that followed them)
    if (furnaceWindow(this.bot)) return
    // RESPAWNFALL-01: A BOT HELD ON A HIGH PLATFORM ON PURPOSE, OR MID-DESCENT (skills.mjs skyDescend's hold, cognitive's open
    // episode) is not stranded or stagnant: a relocation or a rescue walk from there is the fall the hold exists to prevent
    if (skyEscapeBlocked(this.bot)) return

    // CHRONIC STRANDING, judged before stagnation and on its own clock.
    //
    // A stranded bot is usually not stagnant by the definition above: it walks
    // around its cave, runs skills, and fails them, so `busy` time accrues and
    // displacement looks fine. It is going nowhere in the only direction that
    // matters. That is invisible to a 180-second window and obvious over six
    // minutes.
    // A stranding rescue ran this tick: its outcome is judged on the next window, not on this one.
    if (await this.judgeStranding() === 'rescued') return
    // A RESCUE THAT DID NOT START holds its level and backs off one window (H2 item 4).
    if (Date.now() < this.backoffUntil) return

    const idleFor = Date.now() - this.lastActionAt
    // A SKILL STILL HOLDING THE RUNNER IS NOT IDLE (homefix-01 H2 item 4). lastActionAt moves only when a run STARTS, so a
    // skill past its own timeout and ignoring its abort (the 180-210 s before the runner's hard stop) read as "nothing
    // attempted recently" and could never earn the second verdict the reserve_expired cap needs to reach level 3.
    if (idleFor > config.watchdog.windowMs && !this.runner?.isBusy?.()) return

    // JUDGE ONLY THE TIME THE BOT WAS TRYING. Samples taken while no skill was
    // running are idle-by-design and say nothing about being stuck.
    const busy = this.samples.filter(s => s.busy)
    // ...and the furnace's declared time between the first and last busy sample is not busy time either (Codex code r1
    // P1-2: a withdraw before and a deposit after a furnace session must not add up across it)
    const busyMs = busy.length > 1 ? activeSpanMs(this.samples, busy[0].t, busy[busy.length - 1].t) : 0

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
    // PENDING FROM THE VERDICT (H2 item 1): set inside #rescue before anything is cancelled. The verdict row carries its
    // window's first-sample time (`window_from`) and the last window reset, so homefixread.py G3 can tell a verdict on the
    // rescue's own samples from one on samples taken before the rescue started.
    await this.#rescue('stagnation', async pd => {
      logEvent({ kind: 'stagnation', status: 'failed',
                 detail: `${detail}; escalation ${this.escalation}`,
                 args: { escalation: this.escalation, attempt: pd.attempt,
                         window_from: new Date(this.samples[0]?.t ?? Date.now()).toISOString(),
                         window_reset_at: this.windowResetAt ? new Date(this.windowResetAt).toISOString() : '' },
                 snapshot: snapshot(this.bot) })
      this.cognitive?.memory?.addEvent(`watchdog: stuck making no progress — ${detail}`)
      await this.#escalate(pd)
    })
    // NO WINDOW RESET HERE any more (H2 item 5): a rescue that STARTED reset it at its start (onStart), so the next
    // verdict is on the rescue's own samples; one that did not start reset it in #escalate.
  }

  /**
   * Escalating response. Each level does something strictly more drastic than
   * the last, because "try the same recovery again" is what produced twenty
   * minutes of nothing.
   */
  async #escalate(pd) {
    const p = this.bot.entity.position
    if (this.escalation >= 3) return this.#levelThree(pd)
    let plan
    let target = null
    if (this.escalation === 1) {
      // Move decisively further than a reflex nudge would -- TO SOMEWHERE DRY (homefix-02 C2, relocate.mjs): a standable
      // surface cell whose whole goto arrival volume reads dry. The old target was a random point at the bot's own y;
      // in hive-d it was often a frozen river's ice sheet (death 1).
      const t0 = Date.now()
      const read = (x, y, z) => this.bot.blockAt?.(new Vec3(x, y, z)) ?? null
      // a world-facts read error never breaks the rescue ladder (Claude jit-1022b P3): no sites -> the base rule
      let fire = []
      try { fire = this.bot.fireSitesNow?.() ?? [] } catch { fire = [] }
      const pick = await pickRelocationTargetAsync({ p, read, ...(fire.length ? { forbid: (x, y, z) => relocationForbidden(fire, x, y, z) } : {}) })
      const dryMs = Date.now() - t0
      const rowExtra = { dry_tries: pick.tries, dry_reasons: reasonsLabel(pick.reasons), dry_ms: dryMs }
      if (pick.ok) {
        target = { x: pick.x, y: pick.y, z: pick.z }
        log('warn', 'watchdog: forcing relocation', { to: `${pick.x},${pick.y},${pick.z}`, tries: pick.tries })
        plan = { level: 1, remedy: 'relocate', skill: 'goto', args: { ...target }, trigger: 'watchdog_relocate', reason: 'stagnation',
                 rowExtra: { ...rowExtra, target_x: pick.x, target_y: pick.y, target_z: pick.z } }
      } else {
        // NO DRY TARGET IN 16 TRIES: the bot is in a wet, steep or unreadable place, and the one remedy it can still
        // perform is home (an executable walk; level 3 follows if it fails). ONE requested row, level 2, with the
        // fallback named -- that attempt's `_stagnation` row says escalation 1 (Claude r1 P3-11).
        log('warn', 'watchdog: no dry relocation target; returning home now', { tries: pick.tries, reasons: rowExtra.dry_reasons })
        this.escalation = 2
        // the cancel reason stays the verdict's ('stagnation'): the cancelled skill's row reads interrupt:stagnation as
        // for any rescue (G3 and every reader key on it); the fallback is named on the requested row only
        plan = { level: 2, remedy: 'home', skill: 'home', args: {}, trigger: 'watchdog_home', reason: 'stagnation',
                 rowExtra: { ...rowExtra, fallback: 'no_dry_relocation' } }
      }
    } else {
      // Still stuck after a relocation: the local area is the problem. Go home,
      // which is known-reachable terrain by construction.
      log('warn', 'watchdog: relocation did not help, returning home')
      plan = { level: 2, remedy: 'home', skill: 'home', args: {}, trigger: 'watchdog_home', reason: 'stagnation' }
    }
    const { r, started } = await this.#runRescue(pd, plan)
    if (target && started) {
      // THE LANDING (homefix-02 C2, read G5f), judged with the target's own volume (relocate.mjs landingCheck)
      try {
        const q = this.bot.entity?.position
        if (q) {
          const read = (x, y, z) => this.bot.blockAt?.(new Vec3(x, y, z)) ?? null
          const L = landingCheck(read, q, target)
          logEvent({ kind: 'relocate_landed', status: L.wet ? 'failed' : 'success',
                     detail: `attempt ${pd.attempt}: ${r?.status ?? '?'} ${L.wet ? 'WET' : 'dry'} feet=${L.feet} head=${L.head} in_region=${L.in_region} region_now=${L.region_now}`,
                     args: { attempt: String(pd.attempt), status: String(r?.status ?? ''), ...L,
                             target_x: target.x, target_y: target.y, target_z: target.z },
                     snapshot: snapshot(this.bot) })
        }
      } catch { /* a row must never break the ladder */ }
    }
    return this.#afterRescue(pd, r, started)
  }

  /** The ladder after a rescue's run (H2 item 4; the decision is rescueLevelStep). */
  async #afterRescue (pd, r, started) {
    const now = Date.now()
    const step = rescueLevelStep({ started, failClass: r?.failClass ?? null, level: this.escalation, streak: this.reserveExpiredStreak,
                                   sinceLastMs: now - this.lastReserveExpiredAt,
                                   ttlMs: 2 * config.watchdog.windowMs + this.pendingBoundMs() })
    this.reserveExpiredStreak = step.streak
    if (r?.failClass === 'reserve_expired') this.lastReserveExpiredAt = now
    if (started) return r
    this.#resetWindow()
    if (step.hold) {
      this.escalation = Math.max(0, this.escalation - 1)
      this.backoffUntil = Date.now() + config.watchdog.windowMs
      log('warn', 'watchdog: the rescue did not start; level held, backing off one window',
          { failClass: r?.failClass ?? null, level: this.escalation })
      return r
    }
    if (step.jump) {
      // The cancelled skill ignored its abort for a whole reservation, twice: that IS the wedge. Level 3 now, whose
      // reconnect needs no runner (it bypasses the reservation by construction).
      log('error', 'watchdog: two rescues expired behind a skill that will not unwind; going to level 3',
          { streak: step.streak })
      this.escalation = 3
      pd.attempt = this.#newAttempt()
      pd.startedAt = null; pd.tickSeen = false; pd.gen = null; pd.rescue = null
      return this.#levelThree(pd)
    }
    return r
  }

  /** Level 3+: reconnect when a route exists (no runner needed), else surface / mine through the runner. */
  async #levelThree(pd) {

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
      // The attempt's rows: `requested`, then its TERMINAL phase `reconnected` BEFORE bot.quit (H2 item 8; after the
      // quit nothing more is written). No reservation: the reconnect needs no runner (item 4).
      pd.level = this.escalation
      pd.rescue = { attempt: pd.attempt, level: this.escalation, remedy: 'reconnect' }
      logRescueRow(this.bot, pd.rescue, 'requested', { skill: '', kind: pd.kind })
      logEvent({ kind: 'stagnation_reconnect', status: 'failed',
                 detail: `escalation ${this.escalation}; route exists but no movement`,
                 snapshot: snapshot(this.bot) })
      logRescueRow(this.bot, pd.rescue, 'reconnected')
      this.escalation = 0
      try { this.runner.cancel('stagnation') } catch { /* as before homefix-01: the skill is told before the socket goes */ }
      try { this.bot.quit('watchdog: stagnation reset') } catch { /* already gone */ }
      return null
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
    // ESCALATE IN THE DIRECTION THE BOT IS ACTUALLY STUCK.
    //
    // This ran `surface` unconditionally, and `surface` CLIMBS. Measured
    // 2026-09-04, six of the fifteen stranded bots sat at y>=125 -- three of
    // them above y=190, on pillars they had built -- and the terminal rescue
    // answered by sending them further up. `surface` succeeded 490/913 above
    // y=60 and 0 times in 1,902 calls below it, so the population it works for
    // is the one already near the top.
    //
    // A bot marooned ABOVE the world needs to go down. `mine` descends to an
    // elevation and prices the fall against health, so it is the verb that can
    // refuse safely rather than the verb that cannot help at all.
    const y = this.bot?.entity?.position?.y
    const tooHigh = typeof y === 'number' && y >= STRANDED_HIGH_Y
    const verb = tooHigh ? 'mine' : 'surface'
    const args = tooHigh ? { y: Math.max(WORLD_FLOOR, Math.round(y) - 8) } : {}
    log('warn', `watchdog: stranded at y=${typeof y === 'number' ? Math.round(y) : '?'}` +
                ` -- forcing ${verb} rather than counting it again`)
    // Through the runner, under the same contract. A skill that still holds the runner (the wedge) answers
    // reserve_expired here; its release is then the runner's hard stop at timeout + grace (stated, not fixed: §2 item 4).
    try {
      const { r, started } = await this.#runRescue(pd, { level: this.escalation, remedy: verb, skill: verb, args,
                                                         trigger: 'watchdog_stranded', reason: 'stagnation' })
      return this.#afterRescue(pd, r, started)
    } catch (e) {
      log('error', 'watchdog: escape failed', { err: e.message, verb })
      return null
    }
  }
}
