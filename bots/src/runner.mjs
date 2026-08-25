// Task runner: exactly one skill in flight, cancellable, with a watchdog.
//
// Single-slot on purpose. Two skills driving the same pathfinder produce
// behaviour nobody can debug, and "what is this bot doing right now" must
// always have one answer.
//
// Handoff doc S12 wants watchdogs for: task running beyond expected duration,
// repeated failure, and agent paused after repeated failures. All three live here.

import { SKILLS, SKILL_CONTRACTS, classifyOutcome } from './skills.mjs'
import { logSkill, log, logEvent } from './logger.mjs'
import { snapshot, perception, biomeAt, inventorySummary } from './state.mjs'
import { HARD_STOP_GRACE_MS, hardStopResult } from './hard-stop.mjs'
import { config } from './config.mjs'

export class Runner {
  constructor(bot) {
    this.bot = bot
    this.current = null          // { skill, args, controller, startedAt }
    // Bumped on every run so a result from an ABANDONED skill can be told apart
    // from the current one. See the hard-stop race below.
    this.generation = 0
    this.interruptedReason = null
    this.consecutiveFailures = 0
    this.paused = false
    this.pausedAt = null
    // What the bot has recently tried, newest last. The death handler used to
    // read a module-level `lastSkillRun` that was declared and read but never
    // assigned, so every death record in the index -- all 20 of them -- claimed
    // "no skill running" regardless of what the bot was doing. The runner is
    // the only thing that actually knows, so it keeps the record.
    this.recent = []
  }

  static RECENT_MAX = 6

  /** Recent attempts as "skill->status", oldest first. Empty if nothing has run. */
  recentSummary() {
    return this.recent.map(r => `${r.skill}->${r.status}`).join(', ')
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
    // These three refusals never ran anything, so they carry a class that says
    // "the runner declined", not one that says anything about the world. Named
    // rather than left blank because nothing downstream may guess any more.
    if (!def) return { status: 'failed', failClass: 'unknown_skill', detail: `unknown skill "${skillName}"` }

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
          failClass: 'runner_paused',
          detail: `paused after repeated failures; ${Math.ceil((config.skills.pauseRecoveryMs - waited) / 1000)}s until auto-resume`,
        }
      }
    }
    if (this.current) {
      return { status: 'failed', failClass: 'runner_busy',
               detail: `busy with ${this.current.skill}; send "stop" first` }
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

    // THE RUNNER STOPS WAITING IF THE SKILL WILL NOT. See hard-stop.mjs: a
    // `gather` on board-d-Alpha ran 83 minutes past a 3-minute timeout, holding
    // `this.current` and therefore the whole cognitive loop, because it never
    // reached a line that checks the signal.
    //
    // The abandoned promise keeps running -- there is no way to kill it -- so
    // the generation counter below makes sure a late resolution cannot write
    // over whatever the bot is doing by then. The bot's controls and pathfinder
    // goal are cleared on the way out, so the zombie spins without a body.
    const generation = ++this.generation
    let hardStop = null
    let result
    try {
      result = await Promise.race([
        def.run({ bot: this.bot, runner: this }, args, controller.signal),
        new Promise(resolve => {
          hardStop = setTimeout(() => {
            const elapsed = Date.now() - startedAt
            log('error', 'skill ignored its abort; releasing the bot', {
              skill: skillName, elapsedSec: Math.round(elapsed / 1000),
              timeoutMs: config.skills.defaultTimeoutMs,
            })
            logEvent({ kind: 'skill_abort_ignored', status: 'failed',
                       detail: `${skillName} still running ${Math.round(elapsed / 1000)}s after ` +
                               `abort; runner released the bot`,
                       snapshot: snapshot(this.bot) })
            try { this.bot.pathfinder?.setGoal(null) } catch { /* not connected */ }
            try { this.bot.clearControlStates() } catch { /* not connected */ }
            resolve(hardStopResult(skillName, elapsed))
          }, config.skills.defaultTimeoutMs + HARD_STOP_GRACE_MS)
        }),
      ])
    } catch (e) {
      // A SKILL THAT THREW STILL HAS TO SAY WHAT KIND OF FAILURE IT WAS, because
      // nothing downstream is allowed to guess from the message any more. The
      // two escapes that matter carry their own tags: withTimeout() marks our
      // wall clock with budgetExceeded, and everything else is a genuine bug in
      // the skill, which is its own class rather than an opinion about the world.
      result = e?.aborted
        ? { status: 'aborted', failClass: 'interrupted',
            detail: this.interruptedReason ?? 'aborted' }
        : e?.budgetExceeded
          ? { status: 'unknown', failClass: e.failClass ?? 'path_budget',
              detail: e?.message ?? String(e) }
          : { status: 'failed', failClass: e?.failClass ?? 'skill_error',
              detail: e?.message ?? String(e) }
    } finally {
      clearTimeout(watchdog)
      if (hardStop) clearTimeout(hardStop)
      try { this.bot.pathfinder?.setGoal(null) } catch { /* not connected */ }
    }

    // A LATE RESOLUTION FROM AN ABANDONED SKILL MUST NOT LAND. If the runner
    // hard-stopped and moved on, the original promise may still resolve minutes
    // later, into a bot that is now doing something else. Its result is dropped.
    if (generation !== this.generation) {
      log('warn', 'discarding a result from a superseded run', { skill: skillName })
      return { status: 'failed', failClass: 'superseded',
               detail: `${skillName} returned after the runner had moved on` }
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

    const measured = {
      inventory: Object.keys(delta).length ? delta : {},
      distance: moved ?? 0,
      health: (this.bot.health ?? 0) - (hpBefore ?? 0),
      food: (this.bot.food ?? 0) - (foodBefore ?? 0),
      // Taken from the skill's own verified count, never inferred. A skill
      // that places blocks reads them back out of the world; a skill that
      // does not simply omits the field and gets 0. The previous version
      // guessed from the skill NAME and any inventory decrease, which is also
      // true of eating, dropping, depositing and crafting.
      placed: Number(result.placed ?? 0),
      // Same rule as `placed`: the board skill reports what the ledger actually
      // recorded, so a visit that changed no minds cannot claim it did.
      adopted: Number(result.adopted ?? 0),
      filed: Number(result.filed ?? 0),
    }

    // THE EVIDENCE GATE. A claim of success does not leave this function unless
    // the contract's expected change was actually measured.
    //
    // This check already existed -- one layer up, AFTER the fact, in
    // cognitive.mjs -- and being downstream is exactly why it could not help.
    // The cognitive layer detected the no-op, logged "skill returned cleanly but
    // changed nothing", and then called recordSuccess() anyway, which cleared
    // the avoid rule that was the only thing capable of breaking the loop.
    // Scout02 rode that circuit every 70 seconds: `mine {"y":71}` from y=68,
    // a skill whose loop it never entered, reporting "reached y=68". Four of six
    // bots sat in that state with every health signal reading fine.
    //
    // Downgraded to `unknown`, NOT to `failed`. Nothing here shows the action is
    // impossible -- only that this call achieved nothing observable -- and
    // recording a failure would be the same overclaim in the other direction.
    //
    // Judged against a null `wanted` set: this asks the contract question ("did
    // the durable change the skill exists for happen?") and not the milestone
    // question ("was it the change we currently want?"). The second is the
    // cognitive layer's to ask, and it must not be able to turn a real harvest
    // into an unknown just because the milestone moved on.
    const { because: contractEvidence } = classifyOutcome(skillName, result.status, measured, null)
    if (result.status === 'success' && !contractEvidence.length) {
      const expects = (SKILL_CONTRACTS[skillName]?.expects ?? []).join('|') || 'nothing'
      log('warn', 'success downgraded to unknown: no contract evidence', {
        skill: skillName, expects, detail: String(result.detail ?? '').slice(0, 80),
      })
      result = {
        ...result,
        status: 'unknown',
        failClass: 'no_measurable_change',
        detail: `${result.detail ?? ''} — but nothing changed that ${skillName} exists to change ` +
                `(expected ${expects}); cannot tell whether it worked`,
      }
    }

    // Aborts are usually the reflex layer doing its job, so they must not
    // count toward the failure budget -- otherwise a hostile mob pauses the bot.
    //
    // `unknown` counts here alongside `failed`, and that is the deliberate line:
    // everything TRANSIENT (this pause, the admission cooldown, the milestone
    // attempt counter) treats a don't-know like a no, because all three exist to
    // stop the bot repeating something that is going nowhere. Everything
    // PERSISTENT -- the lessons store -- ignores it entirely, because those are
    // beliefs and we did not observe anything. A success downgraded above is a
    // no-op, and a no-op that resets the failure streak is how a livelock hides.
    if (result.status === 'failed' || result.status === 'unknown') {
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

    const snap = snapshot(this.bot)
    if (snap.game) snap.game.biome = biomeAt(this.bot)

    logSkill({
      skill: skillName, args, status: result.status, detail: result.detail,
      startedAt, snapshot: snap,
      trigger: this.interruptedReason ? `interrupt:${this.interruptedReason}` : trigger,
      invDelta: Object.keys(delta).length ? delta : undefined,
      distanceMoved: moved,
      // Only ACTUAL failures get a failure class. `no_effect` means the skill
      // correctly declined to act -- eating when full, status reporting -- and
      // feeding that to a failure classifier put 396 non-failures into the
      // taxonomy, half of everything it had labelled `other`. A no-op is
      // already visible as skill.status; it is not a kind of failure.
      // THE CLASSIFIER IS OFF THE LIVE WRITE PATH.
      //
      // classifyFailure re-derived the cause by pattern-matching the prose we
      // had just written, so the taxonomy was only ever as good as the wording:
      // "pathfinding exceeded 25000ms" matched its "no path" rule and OUR wall
      // clock was recorded as "no route exists" 393 times in 16 hours, a verdict
      // the pathfinder never once returned. A regex over a human-readable
      // sentence is not an observation, and it must not be able to mint one.
      //
      // Every failed/unknown return in skills.mjs now states its own class --
      // bots/test/evidence-gate.test.mjs scans the source and fails if one does
      // not -- so there is nothing left for a fallback to recover. classifyFailure
      // stays in state.mjs for reclassifying the 16h of history already in
      // Elasticsearch, which is the one job a prose classifier is honest at.
      failClass: (result.status === 'failed' || result.status === 'aborted' ||
                  result.status === 'unknown')
        ? (result.failClass ?? 'other')
        : undefined,
      perception: perception(this.bot),
    })
    log(result.status === 'success' ? 'info' : 'warn', `skill ${skillName} -> ${result.status}`, { detail: result.detail })

    this.recent.push({ skill: skillName, status: result.status, at: Date.now() })
    if (this.recent.length > Runner.RECENT_MAX) this.recent.shift()

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
      delta: measured,
      // The measurements that let this call through the gate above, carried
      // forward so the thing that RECORDS the success has the observation in
      // hand. lessons.recordSuccess() refuses to be called without it, which is
      // what makes "a win with nothing behind it" unwritable rather than merely
      // detectable. Empty for every status except `success`.
      contractEvidence,
    }
  }

  resume() {
    this.paused = false
    this.pausedAt = null
    this.consecutiveFailures = 0
  }
}
