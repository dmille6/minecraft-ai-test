// Task runner: exactly one skill in flight, cancellable, with a watchdog.
//
// Single-slot on purpose. Two skills driving the same pathfinder produce
// behaviour nobody can debug, and "what is this bot doing right now" must
// always have one answer.
//
// Handoff doc S12 wants watchdogs for: task running beyond expected duration,
// repeated failure, and agent paused after repeated failures. All three live here.

import { SKILLS, SKILL_CONTRACTS, classifyOutcome, DURABLE_EVIDENCE } from './skills.mjs'
import { logSkill, log, logEvent } from './logger.mjs'
import { snapshot, perception, biomeAt, inventorySummary } from './state.mjs'
import { HARD_STOP_GRACE_MS, hardStopResult } from './hard-stop.mjs'
import { config } from './config.mjs'
import { Arbiter, PRIORITY } from './arbiter.mjs'
import { logRescueRow } from './rescuerow.mjs'


export class Runner {
  constructor(bot) {
    // ONE DOOR FOR THE BODY (src/arbiter.mjs). The runner holds a 'work' grant
    // while a skill runs; reflexes take the body by acquiring at a higher
    // priority, which interrupts the skill through the grant's onCancel and
    // waits for it to acknowledge; the independent stop clears the actuators
    // at every forced revocation. Inert unless config.reflex.arbiter.
    this.arb = new Arbiter({
      log: (kind, d) => logEvent({ kind, status: kind === 'arbiter_refused' ? 'no_effect' : 'success', detail: JSON.stringify(d).slice(0, 160), snapshot: snapshot(bot) }),
      stopActuators: () => { try { bot.pathfinder?.setGoal(null) } catch {} try { if (bot.targetDigBlock) bot.stopDigging() } catch {} try { bot.clearControlStates() } catch {} },
    })
    this.grant = null
    this.bot = bot
    this.current = null          // { skill, args, controller, startedAt }
    this.lastEndedAt = 0
    // Bumped on every run so a result from an ABANDONED skill can be told apart
    // from the current one. See the hard-stop race below.
    this.generation = 0
    this.bodyClaim = null   // see claimBody(); typed, runner-owned, never on `bot`
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
    // THE RESCUE RESERVATION (homefix-01 H2 item 2): { owner, gen, until } while the watchdog's rescue waits for the
    // cancelled skill to unwind. Any other run() is declined `runner_reserved`; only the owner's passes once `current` is
    // null. `reserveGen` numbers reservations so a run suspended mid-start can tell one landed under it.
    this.reservation = null
    this.reserveGen = 0
  }

  static RECENT_MAX = 6
  /** The longest a reservation may hold the runner (the measured p95 unwind, docs/reports/expansion-plan-2026-10-19.md §2). */
  static RESERVE_MAX_MS = 20_000
  /** The danger mover's reservation owner (lavastepmove.mjs): no other owner may replace it while it lives. */
  static DANGER_OWNER = 'lavastep'

  /** Recent attempts as "skill->status", oldest first. Empty if nothing has run. */
  recentSummary() {
    return this.recent.map(r => `${r.skill}->${r.status}`).join(', ')
  }

  // A RESERVED RUNNER IS BUSY (H2 item 2): the cognitive tick and the idle reflexes read isBusy(), so nothing starts work
  // into the gap between the cancelled skill unwinding and the rescue starting.
  isBusy() { return this.current !== null || this.activeReservation() !== null }

  /** The live reservation, or null (an expired one is cleared here). */
  activeReservation () {
    const r = this.reservation
    if (!r) return null
    if (Date.now() >= r.until) { this.reservation = null; return null }
    return r
  }

  /**
   * CANCEL AND RESERVE IN ONE STEP (homefix-01 H2 item 2). Aborts the running skill (if any) and reserves the runner for
   * `owner` for at most `ms` (<= RESERVE_MAX_MS). Returns { gen, aborted }. Polling for idle instead loses to the
   * cognitive loop: a cancelled livelock rung returns and the next rung starts a goto before any timer fires.
   */
  reserve (owner, ms = Runner.RESERVE_MAX_MS, reason = 'stagnation') {
    // LAVASTEP-01 (F1 "the one runner change"): a live danger-move reservation is never replaced by another owner. The
    // caller gets { gen: null, refused: 'lavastep' } and declines: the watchdog's run then meets `runner_reserved`,
    // poolescape's renew() already returns for another owner's reservation. Nothing is interrupted. They resume once the
    // move releases it (<= 6 s). The danger mover itself may renew its own.
    const live = this.activeReservation()
    if (live && live.owner === Runner.DANGER_OWNER && owner !== Runner.DANGER_OWNER) return { gen: null, aborted: false, refused: Runner.DANGER_OWNER }
    const gen = ++this.reserveGen
    const span = Math.max(0, Math.min(Number(ms) || 0, Runner.RESERVE_MAX_MS))
    this.reservation = { owner, gen, until: Date.now() + span, at: Date.now() }
    const aborted = this.interrupt(reason)
    return { gen, aborted }
  }

  /** Drop a reservation, only the one this caller made (identity by generation). */
  releaseReservation (gen) { if (this.reservation && this.reservation.gen === gen) this.reservation = null }

  // ---------------------------------------------------------------------
  // A SKILL MAY DECLARE THAT IT IS DRIVING THE BODY BY HAND.
  //
  // The entombment reflex interrupted `surface`'s pillar mid-dig: it saw a bot
  // sealed in a one-block column, called that entombed, tried its own pillar,
  // had that refused for want of blocks, and disturbed the body anyway. The
  // reflex won the contention and then did nothing. reflex.mjs already states
  // the principle one line above the guard -- "A bot mid-climb is sealed in by
  // design. Only the climb may decide the climb has failed." It simply had no
  // way to see a skill-layer climb.
  //
  // WHY THIS LIVES ON THE RUNNER AND NOT ON `bot`. The existing precedent,
  // `bot.waterTravel`, is not leak-proof: it is assigned before its `try` opens,
  // so a throw in between strands it set for the life of the bot, and its clear
  // is unguarded by identity, so an abandoned skill unwinding minutes later
  // nulls whatever a NEWER skill has since installed. A bot property also
  // survives the reconnect that reflex.mjs performs precisely to rebuild state.
  // `this.current` cannot outlive a skill -- it is nulled on every exit path --
  // and `generation` ties a claim to one specific run.
  //
  // WHY IT IS TYPED. There is deliberately no `hasClaim()`. A reflex may only
  // ask `bodyClaimFor('climb')`. The question "is any skill running?" is the
  // one that produced a 7.5x increase in drownings when the water reflex stood
  // down for unowned bots, and `owned = !!pathfinder.goal` wearing a new hat.
  // The API makes it unaskable.
  // ---------------------------------------------------------------------

  // Worst single climb step: a 30s predicted dig priced at x1.5 + 2s slack
  // (digbudget.mjs) = 47s, plus a 6s placeBlock timeout and ~0.7s of settling.
  // 60s is that, rounded up once. A claim not renewed within one step is stale.
  static CLAIM_STEP_TTL_MS = 60_000
  // Absolute ceiling. Past the skill timeout plus the hard-stop grace the
  // runner has BY DEFINITION released the body and moved on, so any surviving
  // claim is stale by construction. Expressed as the sum so it cannot drift.
  static CLAIM_MAX_MS = config.skills.defaultTimeoutMs + HARD_STOP_GRACE_MS

  /**
   * A skill declares it is driving the body by hand.
   * Returns a HANDLE bound to this specific claim: { renew, release }.
   *
   * The handle is the whole safety property. An earlier version exposed
   * `renewBody(what)` on the runner, which only checked the type -- so an
   * abandoned skill still looping after a hard stop would renew whatever claim
   * a NEWER run had since installed, keeping the reflex stood down for a bot it
   * no longer had anything to do with. Both methods are closures over `claim`,
   * so a zombie's handle is inert the moment it is superseded.
   */
  claimBody (what) {
    const dead = { renew () {}, release () {} }
    if (!this.current) return dead              // idle runner: nothing may claim
    const claim = {
      what,
      skill: this.current.skill,
      generation: this.generation,
      startedAt: Date.now(),
      at: Date.now(),                            // renewed per step
      startY: this.bot?.entity?.position?.y ?? null,
      bestY: this.bot?.entity?.position?.y ?? null,
    }
    this.bodyClaim = claim
    if (this.grant && this.arb.ok(this.grant)) this.grant.context = { kind: what, skill: this.current.skill }   // detectors read the operation context from the holder
    // IDENTITY-GUARDED, both of them. An abandoned skill unwinding late must
    // neither clear nor renew a claim that a newer run has since installed --
    // the first is the exact bug in bot.waterTravel's unguarded `= null`, and
    // the second would be worse, because it is silent.
    return {
      renew: () => {
        if (this.bodyClaim !== claim) return    // superseded: this handle is inert
        claim.at = Date.now()
        const y = this.bot?.entity?.position?.y
        if (typeof y === 'number' && (claim.bestY == null || y > claim.bestY)) claim.bestY = y
      },
      release: () => { if (this.bodyClaim === claim) this.bodyClaim = null },
    }
  }

  /** The ONLY reader. Typed: a 'climb' claim can never quiet a water reflex. */
  bodyClaimFor (what) {
    const c = this.bodyClaim
    if (!c || c.what !== what) return null
    if (!this.current) { this.bodyClaim = null; return null }
    if (c.generation !== this.generation) { this.bodyClaim = null; return null }
    const now = Date.now()
    // Stale claims are IGNORED but not cleared, so they stay visible to
    // telemetry: a claim that keeps going stale is a bug worth seeing.
    if (now - c.at > Runner.CLAIM_STEP_TTL_MS) return null
    if (now - c.startedAt > Runner.CLAIM_MAX_MS) return null
    return c
  }
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

  async run(skillName, args = {}, { trigger = 'chat', owner = null, rescue = null, onStart = null, admit = null } = {}) {
    const def = SKILLS[skillName]
    // A rescue run's decline is an attempt row too (declined:<class>), written here so the watchdog does not grade itself.
    const declined = (r, extra = {}) => { logRescueRow(this.bot, rescue, `declined:${r.failClass}`, { skill: skillName, ...extra }); return r }
    // These three refusals never ran anything, so they carry a class that says
    // "the runner declined", not one that says anything about the world. Named
    // rather than left blank because nothing downstream may guess any more.
    if (!def) return declined({ status: 'failed', failClass: 'unknown_skill', detail: `unknown skill "${skillName}"` })

    // THE RESERVATION (homefix-01 H2 item 2). Anyone but its owner gets a "not now" that every outcome handler skips
    // (declined.mjs). The owner waits -- at most the reservation -- for the cancelled skill to unwind.
    const held = this.activeReservation()
    if (held && held.owner !== owner) {
      return declined({ status: 'failed', failClass: 'runner_reserved',
               detail: `the runner is reserved for ${held.owner}'s rescue (${Math.ceil((held.until - Date.now()) / 1000)}s at most); not now` })
    }
    let myGen = null
    if (held && held.owner === owner) {
      myGen = held.gen
      while (this.current && Date.now() < held.until && this.reservation?.gen === myGen) await new Promise(r => setTimeout(r, 25))
      if (this.reservation && this.reservation.gen !== myGen) {
        return declined({ status: 'failed', failClass: 'runner_reserved', detail: 'a newer reservation replaced this one' })
      }
      if (this.current) {
        this.releaseReservation(myGen)
        return declined({ status: 'failed', failClass: 'reserve_expired',
                          detail: `${this.current.skill} did not unwind within the ${Math.round((held.until - held.at) / 1000)}s reservation; the rescue did not start` })
      }
    }

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
        if (myGen != null) this.releaseReservation(myGen)
        return declined({
          status: 'failed',
          failClass: 'runner_paused',
          detail: `paused after repeated failures; ${Math.ceil((config.skills.pauseRecoveryMs - waited) / 1000)}s until auto-resume`,
        })
      }
    }
    if (this.current) {
      if (myGen != null) this.releaseReservation(myGen)
      return declined({ status: 'failed', failClass: 'runner_busy',
               detail: `busy with ${this.current.skill}; send "stop" first` })
    }

    this.watchdog?.noteActivity()
    const controller = new AbortController()
    const startedAt = Date.now()
    if (config.reflex.arbiter) {
      // A reflex may be holding the body (an escape in progress): a skill does
      // not start under it. That is the answer "busy", not a silent overlap.
      const ask = () => this.arb.acquire({ owner: skillName, priority: PRIORITY.work, context: null,
                                           onCancel: () => { this.interrupt(`preempted by ${this.arb.holder?.owner ?? 'a reflex'}`) } })
      let grant = await ask()
      // THE OWNER LOSES THE BODY TO THE RUN IT IS ABOUT TO TURN AWAY (Claude code r1 P2-2): both waited on the same
      // preemption, the brain's in-flight run was granted first, and its re-check below gives the body back one microtask
      // LATER -- after this owner was refused (by the time this line runs it has usually released already). With no skill
      // running and the body either free again or held at WORK priority (a run in its start, never a reflex), ask once more
      // after a macrotask, by which time that run has released or started.
      const by = this.arb.holder
      if (!grant && myGen != null && !this.current && (by == null || by.priority === PRIORITY.work)) {
        await new Promise(r => setImmediate(r))
        grant = await ask()
      }
      if (!grant) {
        if (myGen != null) this.releaseReservation(myGen)
        return declined({ status: 'failed', failClass: 'body_held', detail: `the body is held by ${this.arb.holder?.owner ?? 'a reflex'}; the skill did not start` })
      }
      // THE IN-FLIGHT START (H2 item 2, Codex r3): this run passed its entry check, then waited here with no `current`,
      // so a reservation that landed meanwhile could abort nothing. Re-check after the grant; the loser gives it back.
      const landed = this.activeReservation()
      if (landed && landed.owner !== owner) {
        this.arb.release(grant, 'the runner was reserved while this run waited for the body')
        return declined({ status: 'failed', failClass: 'runner_reserved',
                 detail: `the runner was reserved for ${landed.owner}'s rescue while this run waited for the body; not now` })
      }
      // THE OWNER'S OWN START, RE-CHECKED AFTER THE SAME AWAIT (Codex code r1 P1): a NEWER reservation that replaced this
      // one while the rescue waited for the body makes this attempt stale -- it gives the grant back and the newer one
      // stands. A reservation that merely EXPIRED during the wait does not: nothing else can have started (no other run
      // passes the entry check while it was live, and once it lapsed the arbiter refuses an equal-priority asker while this
      // run holds the body -- the `current` check below is the backstop), so the rescue starts rather than being thrown away.
      if (myGen != null && landed && landed.gen !== myGen) {
        this.arb.release(grant, 'a newer reservation replaced this one while the rescue waited for the body')
        return declined({ status: 'failed', failClass: 'runner_reserved',
                 detail: 'a newer reservation replaced this one while the rescue waited for the body; not now' })
      }
      if (this.current) {
        this.arb.release(grant, 'another run started while this one waited for the body')
        if (myGen != null) this.releaseReservation(myGen)
        return declined({ status: 'failed', failClass: 'runner_busy', detail: `busy with ${this.current.skill}; another run started first` })
      }
      this.grant = grant
    }
    // THE OWNER'S ADMISSION, AT THE INSTANT OF THE START (homefix-02 C3a, Codex r1 P1-1): after the reservation wait and
    // the body acquisition, with no await between this check and `this.current = mine` -- a check made before
    // reserve() goes stale during a 20-s unwind. A refusal never ran anything: its class is in RUNNER_DECLINED.
    let admission = null
    if (typeof admit === 'function') {
      try { admission = admit() } catch { admission = null }
      if (admission?.refuse) {
        if (this.grant) { try { this.arb.release(this.grant, 'the owner refused its own start') } catch {} this.grant = null }
        if (myGen != null) this.releaseReservation(myGen)
        // the one admission today is the watchdog's air gate (airstate.mjs airAdmission), so the class is that one
        return declined({ status: 'failed', failClass: 'air_rescue', detail: admission.detail ?? 'the owner refused its own start' },
                        admission.fields ?? {})
      }
    }
    const invBefore = inventorySummary(this.bot)
    const posBefore = this.bot.entity?.position?.clone()
    const hpBefore = this.bot.health
    const foodBefore = this.bot.food
    // `owner` and `rescue` ride on `current` (homefix-02 C3b): the air reflex interrupts a watchdog-owned run during a
    // drowning in progress, and names the attempt in its row.
    const mine = { skill: skillName, args, controller, startedAt, owner, rescue }
    this.current = mine
    this.interruptedReason = null
    // The owner's run has started: the reservation is consumed. `started` is the RUNNER's row (H2 item 8), so the
    // watchdog never grades its own attempt; onStart lets it reset its window at the rescue's start (item 5).
    if (myGen != null) this.releaseReservation(myGen)
    let terminalWritten = !rescue
    if (rescue) logRescueRow(this.bot, rescue, 'started', { skill: skillName, run_started: new Date(startedAt).toISOString(), ...(admission?.fields ?? {}) })
    try { onStart?.(mine) } catch { /* a callback must never stop the skill */ }

    // `current` IS ALWAYS CLEARED (H2 item 3): everything from here to the return is the protected body; the OUTER
    // finally below clears `current` even if the evidence processing or logging throws, identity-guarded so a late
    // unwind can never clear a newer run's state. Before homefix-01 a throw there left the runner `busy` forever.
    try {

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
            this.bodyClaim = null
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
      // A SKILL'S OWN VERIFIED TALLY SURVIVES ITS THROW (craft: executions verified before an abort or a failed
      // table retake). Only the four tally fields, and only what the skill attached itself -- never inferred here.
      const v = e?.verified && typeof e.verified === 'object' ? e.verified : null
      const carried = v ? { item: v.item ?? null, requested: Number(v.requested ?? 0),
                            executions: Number(v.executions ?? 0), produced: Number(v.produced ?? 0) } : {}
      // H3 (homefix-01): ANY throw while this run's own signal is aborted is an interruption, whatever its shape. 225 home
      // rows were filed skill_error carrying the raw pathfinder "goal was changed" that a climb's catch re-threw after the
      // entombment reflex took the body (skills.mjs surface: `if (e.aborted || signal?.aborted) throw e`), and the same
      // re-throw sits at 20+ sites; skill_error feeds consecutiveFailures, the pause and the lessons.
      result = (e?.aborted || controller.signal.aborted)
        ? { status: 'aborted', failClass: 'interrupted',
            // the thrown message is KEPT when the throw was not the skill's own abort mark (Claude code r1 P3-1): a real bug
            // thrown after an abort stays findable in the row, while the class says what ended the run
            detail: (this.interruptedReason ?? 'aborted') + (e?.aborted ? '' : ` (threw ${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 80)})`), ...carried }
        : e?.budgetExceeded
          ? { status: 'unknown', failClass: e.failClass ?? 'path_budget',
              detail: e?.message ?? String(e), ...carried }
          : { status: 'failed', failClass: e?.failClass ?? 'skill_error',
              detail: e?.message ?? String(e), ...carried }
    } finally {
      clearTimeout(watchdog)
      if (hardStop) clearTimeout(hardStop)
      try { this.bot.pathfinder?.setGoal(null) } catch { /* not connected */ }
      this.bodyClaim = null
      if (this.grant) { this.arb.release(this.grant, `skill ended: ${result?.status ?? 'unknown'}`); this.grant = null }
      this.lastEndedAt = Date.now()   // the lava stand-off waits 20 s after any skill before moving an idle bot
    }

    // A LATE RESOLUTION FROM AN ABANDONED SKILL MUST NOT LAND. If the runner
    // hard-stopped and moved on, the original promise may still resolve minutes
    // later, into a bot that is now doing something else. Its result is dropped.
    if (generation !== this.generation) {
      log('warn', 'discarding a result from a superseded run', { skill: skillName })
      if (rescue) { logRescueRow(this.bot, rescue, 'completed:superseded', { skill: skillName }); terminalWritten = true }
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
      // THE CRAFT'S OWN VERIFIED COUNT, same rule as `placed`, and only for the item it was ASKED for: sub-crafts'
      // planks are not evidence about a pickaxe, and a replacement (spent copy out, new copy in) moves no name count.
      crafted: result.item != null && result.item === args?.item ? Number(result.produced ?? 0) : 0,
      craftedItem: result.item ?? null,
      // THE PRUNE'S verified count (pruneTown: taken from the chest and accounted lost down the well), same rule
      pruned: Number(result.pruned ?? 0),
      // THE RECOUNT's verified count of town containers counted (countTown), same rule
      counted: Number(result.counted ?? 0),
      // THE TOWN SMELT JOB's own count of raw copper the furnace turned into ingots (smeltTown; prior output excluded),
      // same rule: the bag ends where it began, so no inventory delta can show it (Paper 10-15: graded unknown without it)
      smelted: Number(result.smelted ?? 0),
      // THE TOOLKIT's verified count of kit tools made (a NEW usable copy in the bag after its craft), same rule
      kitCrafted: Number(result.kitCrafted ?? 0),
      // THE MATERIALS JOB's verified count of building parts made (mats-01), same rule
      made: Number(result.made ?? 0),
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
    // Asked as a COUNTERFACTUAL -- 'success' is passed literally, not
    // `result.status`. classifyOutcome short-circuits on line one for `failed`
    // and `aborted` and hands back an empty `because`, so asking it about a
    // failure can only ever answer "no evidence", whatever the bot actually did.
    // The question this gate needs is "IF this had claimed success, would the
    // contract's change be there?" -- and that has to be asked in the same
    // words for both directions or the gate is only ever a downgrade.
    // For a run that really did claim success this is the identical call.
    const { because: contractEvidence } = classifyOutcome(skillName, 'success', measured, null)
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
    } else if (contractEvidence.some(b => DURABLE_EVIDENCE.test(b)) &&
               (result.status === 'aborted' || result.status === 'unknown')) {
      // THE GATE SWINGS BOTH WAYS, OR IT IS NOT A GATE.
      //
      // For its whole life this gate could only take a success away. It never
      // once gave one back, while `measured` -- the proof -- was computed for
      // every outcome and written to every log line, unread on this side.
      //
      // Measured 2026-09-09 over 6h: 882 of 1,309 `unknown` mines (67.4%, 66
      // bots) put ore in the bag, and 256 of 862 `aborted` gathers (29.7%, 55
      // bots) came home with items. `mine` reads 25.8% and is nearer 57%. We
      // have been steering a fleet by a number that could only fall.
      //
      // DURABLE EVIDENCE ONLY, and this bound was missing for the first six
      // hours this branch was live. `position` counts as contract evidence at
      // two blocks, so an aborted swim scored:
      //     drowning — but position: moved 2 blocks ... so it worked
      // A bot the reflex dragged two blocks while it was drowning did not
      // travel anywhere. Measured before the bound: 78% of swim_to's successes
      // were this, and stripping them puts it back at 12.3% -- exactly where it
      // has always been. I manufactured that improvement.
      //
      // The line is whether the bot STILL HAS the thing afterwards. Four logs
      // in the bag survive the abort; two blocks of drift toward an unreached
      // goal survive nothing. Downgrades are untouched: refusing to overturn an
      // abort needs stronger proof than refusing to trust a claim.
      //
      // ONLY `aborted` AND `unknown`, NEVER `failed`, and that distinction is
      // the whole safety of this branch. `unknown` says in as many words that
      // we cannot tell -- evidence is exactly what it was missing. `aborted`
      // means the reflex cut in before the skill could judge itself, so there
      // is no verdict to overturn. But `failed` IS a verdict: the skill looked
      // at what happened and said no. Overriding that on an inventory delta
      // would let a log picked up in passing erase a real refusal -- the same
      // overclaim as the downgrade, pointing the other way, and the comment
      // above rejects it in that direction for exactly this reason.
      log('info', 'failure upgraded to success: contract evidence present', {
        skill: skillName, was: result.status, because: contractEvidence.join(','),
      })
      result = {
        ...result,
        status: 'success',
        failClass: null,
        detail: `${result.detail ?? ''} — but ${contractEvidence.join(' and ')}, ` +
                `which is what ${skillName} is for, so it worked`,
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

    // WHY THE REASON IS RETURNED RATHER THAN DISPATCHED FROM HERE.
    //
    // The reflex decides some situations are cognitive work and hands them up
    // by interrupting the running skill. Nothing was listening: `notify()` is
    // called from exactly one place in the tree, and every reflex reason
    // reached the model as `idle` -- 99.0% of 21,180 decisions over 3h.
    //
    // The obvious fix, calling notify() from here, is wrong twice over. It
    // fires before run() returns to the CognitiveLoop's own #tick(), so the
    // notify nests a fresh decision inside the one still unwinding; and
    // notify() drops anything arriving while the runner is busy, which during
    // an abort it still is. So the reason is DATA on the result, and the
    // caller acts on it once it is safe to.
    const interruptedBy = this.interruptedReason
    if (rescue) {
      logRescueRow(this.bot, rescue, interruptedBy ? `interrupted:${interruptedBy}` : `completed:${result.status}`,
                   { skill: skillName, status: result.status, fail_class: result.failClass ?? '', run_ms: Date.now() - startedAt })
      terminalWritten = true
    }
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
      interruptedBy,
      delta: measured,
      // The measurements that let this call through the gate above, carried
      // forward so the thing that RECORDS the success has the observation in
      // hand. lessons.recordSuccess() refuses to be called without it, which is
      // what makes "a win with nothing behind it" unwritable rather than merely
      // detectable. Empty for every status except `success`.
      contractEvidence,
    }
    } finally {
      if (this.current === mine) { this.current = null; this.interruptedReason = null }
      if (!terminalWritten) logRescueRow(this.bot, rescue, 'interrupted:runner_error', { skill: skillName })
    }
  }

  resume() {
    this.paused = false
    this.pausedAt = null
    this.consecutiveFailures = 0
  }
}
