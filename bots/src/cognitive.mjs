// Cognitive layer -- ADR-0002 D3.
//
// Event-driven, never per-tick (handoff doc S9.3). One decision per event:
// build a compressed prompt, ask the model for ONE skill, pass it through the
// admission gate, execute, record, repeat.
//
// The model's output is a proposal. The admission layer can reject it, the
// milestone controller decides what "done" means, and the reflex layer can
// preempt whatever gets executed. That layering is deliberate -- it is what
// keeps a bad generation from becoming a bad action.

import { SKILLS, classifyOutcome, SKILL_CONTRACTS } from './skills.mjs'
import { makeClient, skillSchema } from './llm.mjs'
import { buildSystemPrompt, buildUserPrompt, makeSentinel, WorkingMemory } from './prompt.mjs'
import { AdmissionControl } from './admission.mjs'
import { MilestoneController } from './milestones.mjs'
import { logLlm, logEvent, log } from './logger.mjs'
import { snapshot, perception, biomeAt, classifyFailure } from './state.mjs'
import { config } from './config.mjs'
import { openLessons } from './lessons.mjs'
import { announceUnreachable } from './comms.mjs'

// Only skills that can succeed WITHOUT a human present.
//
// `come` and `follow` need a player to come to or follow, and in autonomous
// operation there is nobody there. They were offered to the model anyway, which
// picked them 29 times and failed 29 times -- every single failure the literal
// string "cannot see undefined". A skill that cannot succeed still costs a
// decision, still trains the admission gate to avoid it, and still counts
// against the fleet's success rate. They remain available to chat, where a
// human IS present and the argument is real.
// Failure classes that are NOT evidence the action cannot work. Two kinds:
//
//   we caused it   path_interrupted (our reflex stopped the path), path_budget
//                  and collect_budget (our own time limits expiring),
//                  goal_changed (we set a competing goal)
//   it says nothing  died -- the world killed the bot mid-skill. The danger is
//                  the PLACE, which recordHazard captures; blocking the ACTION
//                  teaches that gathering wood is impossible because something
//                  killed you while doing it once.
//
// Deliberately NOT here: path_incomplete. A route that repeatedly cannot be
// completed is genuine evidence about the world and should be learned.
const NOT_ACTION_EVIDENCE = new Set([
  'path_interrupted', 'path_budget', 'collect_budget', 'goal_changed', 'died',
])

const SKILL_NAMES = Object.keys(SKILLS).filter(n => !SKILLS[n].chatOnly)

export class CognitiveLoop {
  constructor(bot, runner, lessons = null, worldFacts = null) {
    this.bot = bot
    this.runner = runner
    this.llm = makeClient()
    this.memory = new WorkingMemory()
    this.lessons = lessons ?? openLessons()
    this.worldFacts = worldFacts
    // Invalidate what this bot learned about any skill whose code has changed.
    // A judgement is only valid for the version of the skill that earned it --
    // `status` kept being chosen after it stopped being rewarded, and `explore`
    // kept being vetoed after it was fixed. Both were memory outliving its
    // subject.
    try {
      this.lessons.migrateActionKeys?.()
      const changed = this.lessons.reconcileSkillVersions?.(SKILLS) ?? []
      if (changed.length) {
        this.lessons.save()
        logEvent({ kind: 'skill_versions_reconciled', status: 'success',
                   detail: `cleared judgements for: ${changed.join(', ')}`,
                   snapshot: snapshot(bot) })
      }
    } catch (e) { log('warn', 'skill version reconcile failed', { err: e.message }) }

    this.admission = new AdmissionControl(this.lessons)
    this.milestones = new MilestoneController(bot, config.bot.role, this.lessons, worldFacts)
    this.schema = skillSchema(SKILL_NAMES)
    this.system = buildSystemPrompt(SKILL_NAMES)
    this.running = false
    this.stopped = false
    this.lastOutcome = null
    this.decisions = 0
  }

  start() {
    if (this.running) return
    this.running = true
    this.startedAt = Date.now()
    this.memory.remember('home', { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ })
    this.memory.addEvent('agent came online')
    log('info', 'cognitive loop starting', {
      model: config.llm.model, endpoint: config.llm.baseUrl, num_ctx: config.llm.numCtx,
    })
    this.#startLiveness()
    this.#tick('startup')
  }

  stop() {
    this.stopped = true; this.running = false
    clearTimeout(this.nextTimer); clearInterval(this.liveness)
    try { this.lessons.save() } catch {} }

  /** Called by the harness when something interesting happens. */
  notify(trigger, detail) {
    if (detail) this.memory.addEvent(detail)
    if (!this.running || this.stopped) return
    if (this.runner.isBusy()) return   // a decision is already being acted on
    this.#tick(trigger)
  }

  /**
   * Deterministic circuit-breaker. Relocates the bot so the next perception
   * snapshot genuinely differs, then clears the repeat window.
   */
  async #escape() {
    const p = this.bot.entity?.position
    if (!p) return
    const ang = Math.random() * Math.PI * 2
    const dist = 25 + Math.random() * 35
    const x = Math.round(p.x + Math.cos(ang) * dist)
    const z = Math.round(p.z + Math.sin(ang) * dist)
    log('warn', 'livelock breaker: relocating', { to: `${x},${z}` })
    logEvent({ kind: 'livelock_escape', status: 'failed',
               detail: `fixated on one action; relocating to ${x},${z}`, snapshot: snapshot(this.bot) })
    this.memory.addEvent(`stuck choosing the same action; relocated toward ${x},${z} to find different surroundings`)
    await this.runner.run('goto', { x, y: Math.round(p.y), z }, { trigger: 'livelock_escape' })
    this.admission.clearRepeatWindow()
    this.consecutiveRejections = 0
  }

  /**
   * ALWAYS reschedules. Skipping the work is fine; skipping the reschedule is
   * a dead loop.
   *
   * The previous version was `setTimeout(() => { if (!busy) tick() })`, which
   * meant a timer that fired while a skill was running simply did nothing and
   * nothing ever scheduled another. It tripped reliably when the stagnation
   * watchdog escalated, because the watchdog starts a skill OUTSIDE this loop:
   * timer fires, runner busy, tick skipped, agent silent forever with the
   * service still reporting active.
   *
   * Same shape as three other bugs in this codebase: a guard with no path
   * forward once the guard trips. Found by the measurement agent from an
   * ingestion gap -- the process looked healthy from every angle except that
   * no documents were arriving.
   */
  #scheduleNext(delay = config.llm.decisionCooldownMs) {
    if (this.stopped || !this.running) return
    clearTimeout(this.nextTimer)
    this.nextTimer = setTimeout(() => {
      if (this.stopped || !this.running) return
      if (this.runner.isBusy()) {
        // Busy is a reason to wait, never a reason to stop waiting.
        this.#scheduleNext(Math.min(delay, 10_000))
        return
      }
      this.#tick('idle')
    }, delay)
  }

  /**
   * A watchdog for the loop itself. Every guard above is inside the loop, so
   * none of them can notice the loop being gone. This is deliberately outside.
   */
  #startLiveness() {
    const idleLimit = Math.max(config.llm.decisionCooldownMs * 3, 120_000)
    this.liveness = setInterval(() => {
      if (this.stopped || !this.running) return
      const since = Date.now() - (this.lastDecisionAt ?? this.startedAt ?? Date.now())
      if (since < idleLimit) return
      if (this.runner.isBusy()) return          // legitimately working
      log('error', 'cognitive loop went silent, restarting it', {
        idle_sec: Math.round(since / 1000), limit_sec: Math.round(idleLimit / 1000),
      })
      logEvent({
        kind: 'loop_restart', status: 'failed',
        detail: `cognitive loop produced no decision for ${Math.round(since / 1000)}s`,
        snapshot: snapshot(this.bot),
      })
      this.#tick('liveness_restart')
    }, 30_000)
  }

  /**
   * What would count as progress right now: the milestone's target item, plus
   * the direct ingredients of its recipe.
   *
   * Ingredients are included deliberately. A strict target-only rule would mark
   * `gather oak_log` useless while the milestone is "craft oak_planks", which
   * is the prerequisite step -- punishing the bot for doing the right thing one
   * move early. Returns null when the target or its recipe cannot be resolved,
   * and a null set means "we do not know", which the classifier treats as
   * permissive rather than inventing a judgement it cannot support.
   */
  #wantedItems(milestone) {
    const target = milestone?.wants
    if (!target) return null
    const want = new Set([target])
    try {
      const def = this.bot.registry.itemsByName[target]
      if (def) {
        for (const r of (this.bot.recipesAll(def.id, null, true) ?? []).slice(0, 8)) {
          for (const d of (r.delta ?? [])) {
            if (d.count >= 0) continue                      // positive = produced
            const n = this.bot.registry.items[d.id]?.name
            if (n) want.add(n)
          }
        }
      }
    } catch { /* registry shape varies by version; the target alone still counts */ }
    return want
  }

  async #tick(trigger) {
    if (this.stopped || this.runner.isBusy()) return

    const wasChainDone = this.milestones.chainComplete
    this.milestones.refresh()
    if (!wasChainDone && this.milestones.chainComplete) {
      log('info', 'fixed milestone chain complete, entering sustaining loop', { decisions: this.decisions })
      this.memory.addEvent('finished the tool-crafting chain; now stockpiling and scouting on a loop')
      try { this.bot.chat('tool chain complete — switching to sustaining goals') } catch {}
    }

    const milestone = this.milestones.status()
    const sentinel = makeSentinel()
    const { user, tokens, dropped } = buildUserPrompt({
      bot: this.bot, milestone, memory: this.memory,
      lastOutcome: this.lastOutcome, trigger, sentinel,
      // Own experience first, then what peers reported. Peer lines carry the
      // reporter's name ("Gather02 hit entombed 16x near ...") so the model can
      // weigh first-hand knowledge against hearsay, and so a bad fact can be
      // traced to whoever published it rather than merely suspected.
      lessons: [
        ...this.lessons.promptLines(this.bot.entity?.position),
        ...(this.worldFacts?.promptLines(this.bot.entity?.position) ?? []),
      ],
    })

    const snap = snapshot(this.bot)
    if (snap.game) snap.game.biome = biomeAt(this.bot)
    const percept = perception(this.bot)
    const started = Date.now()
    const res = await this.llm.decide({ system: this.system, user, sentinel, schema: this.schema })
    this.decisions++
    this.lastDecisionAt = Date.now()

    let admitted = null, rejection = null
    if (res.schemaValid) {
      const check = this.admission.check(res.proposal, this.bot)
      if (check.ok) admitted = check
      else rejection = check
    }

    // Execute (or not), then record ONE row describing the whole decision.
    let outcome = { status: 'aborted', detail: rejection?.detail ?? res.error ?? 'no action' }
    if (admitted) {
      log('info', `LLM -> ${admitted.skill}`, {
        args: admitted.args, reason: res.proposal.reason?.slice(0, 90), ms: res.latencyMs,
      })
      const r = await this.runner.run(admitted.skill, admitted.args, { trigger: `llm:${trigger}` })
      outcome = { status: r.status, detail: r.detail }
      if (r.status === 'failed') {
        this.admission.noteFailure(admitted.skill, admitted.args)
        // Persist it, so the next RUN starts knowing this, not just the next
        // decision in this one.
        // NOT EVERY FAILURE IS EVIDENCE ABOUT THE WORLD. A lesson claims "this
        // action does not work"; only a failure the WORLD caused can support
        // that. These classes are caused by us -- our reflex stopping the path,
        // our travel budget expiring, a competing goal we set -- and persisting
        // them taught the fleet that walking home is impossible, then had the
        // gate enforce it. Verified against mineflayer-pathfinder 2.4.5:
        // `path_stop` is emitted ONLY by stop(), which only our code calls.
        //
        // They are still logged, classified and visible in Kibana. They just do
        // not get a vote on what the bot is allowed to attempt next.
        const fc = r.failClass ?? classifyFailure(r.detail)
        if (NOT_ACTION_EVIDENCE.has(fc)) {
          log('info', 'failure not persisted as a lesson: not evidence about the action', {
            skill: admitted.skill, failClass: fc,
          })
        } else {
          this.lessons.recordFailure(admitted.skill, admitted.args, fc, this.bot.entity?.position)
        }
      } else if (r.status === 'success') {
        // ADR-0003, finally implemented. Reward the skill only if the durable
        // change it EXISTS FOR actually happened -- judged against the contract
        // in SKILL_CONTRACTS, not against whether the call returned cleanly.
        //
        // Without this, `eat` on a full stomach and `status` were reinforced
        // exactly like chopping a tree, and the fleet learned to do the safe
        // thing that always works. A neutral outcome is recorded as neither win
        // nor failure: the bot did nothing wrong, and it achieved nothing.
        const { value, because } = classifyOutcome(
          admitted.skill, r.status, r.delta ?? {}, this.#wantedItems(milestone))
        // The invariant. A reinforcing verdict has to name the measurement that
        // earned it; if it cannot, the verdict was derived from something that
        // is not evidence and must not be allowed to quietly train the fleet.
        // This is the check that would have caught status-reinforced-115-times
        // on the first firing rather than after a night of it.
        if ((value === 'valuable' || value === 'costly') && !because.length) {
          log('error', 'BUG: reinforcing verdict with no measurement behind it', {
            skill: admitted.skill, value, delta: r.delta,
          })
        }
        if (value === 'valuable') {
          this.admission.noteSuccess(admitted.skill, admitted.args)
          this.lessons.recordSuccess(admitted.skill, admitted.args)
        } else if (value === 'costly') {
          // The skill DID achieve its contract, so it is recorded as having
          // worked -- refusing that would teach the fleet to avoid the only
          // action that works in hard terrain. But it is not fed to the
          // admission gate, which is what builds PREFERENCE: a win that costs
          // health should not make the bot keener to repeat it.
          //
          // The cost attaches to the place, not the skill. Mining at y=39 is
          // not a bad idea; mining at y=39 THERE is, and hazardsNear() is what
          // the prompt layer reads back.
          this.lessons.recordSuccess(admitted.skill, admitted.args)
          this.lessons.recordHazard(`costly_${admitted.skill}`, this.bot.entity?.position)
          log('warn', 'skill met its contract but cost health', {
            skill: admitted.skill, hp: r.delta?.health, food: r.delta?.food,
          })
        }
        // The evidence goes back to the MODEL too, not just the log. "gather ->
        // success" and "gather -> success, inventory_gain: oak_log +3" are
        // different pieces of information, and the second one is the one that
        // lets it tell a real harvest from a call that returned cleanly.
        outcome = { status: r.status, detail: r.detail, value, because }
        if (value === 'neutral') {
          log('info', 'skill returned cleanly but changed nothing', {
            skill: admitted.skill,
            expected: (SKILL_CONTRACTS[admitted.skill]?.expects ?? []).join('|') || 'nothing',
            detail: String(r.detail ?? '').slice(0, 60),
          })
        } else {
          log('info', `skill outcome ${value}`, { skill: admitted.skill, because })
        }
      }
      // 'no_effect' deliberately matches NEITHER branch. It is not a success, so
      // it is never reinforced as achievement; it is not a failure, so the
      // admission gate will not start avoiding a skill that is correct later --
      // eating matters when the bot is genuinely hungry.
      //
      // The concrete half of ADR-0003. Observed live: five bots standing
      // motionless while `eat -> success "not hungry"` fired 15 times in ten
      // minutes and `status` 7 more, each recorded as a win and fed back into the
      // prompt as "has worked Nx -- a reliable choice". Every productive skill
      // was blocked behind a tool dependency, so the fleet settled into the one
      // thing it could still do perfectly: nothing.
      this.lessons.save()
      // Include the verdict AND the measurement behind it. The model was being
      // told "gather -> success" and nothing more, which is the same impoverished
      // signal the learning layer had before ADR-0003 -- it could not tell a real
      // harvest from a call that merely returned. `outcome` carries the evidence;
      // this is the string the prompt actually renders, so the evidence has to be
      // in here to reach the model at all.
      const evidence = outcome?.because?.length ? ` [${outcome.because.join('; ')}]` : ''
      const verdict = outcome?.value ? ` (${outcome.value})` : ''
      this.lastOutcome =
        `${admitted.skill} -> ${r.status}${verdict}: ${r.detail ?? ''}${evidence}`.slice(0, 220)
      this.memory.addEvent(this.lastOutcome)
    } else {
      // Flush on rejection too. save() used to live only in the executed-skill
      // branch, so a bot whose every decision was vetoed never persisted
      // anything -- including the probation countdown that exists to end that
      // exact state. Scout01 reconnected twelve times with the counter reset
      // to zero on each one.
      this.lessons.save()
      const why = rejection ? `${rejection.reason} (${rejection.detail})` : res.error
      log('warn', 'decision rejected', {
        why, raw: res.raw?.slice(0, 120),
        // Attribution travels with the rejection: which stored rule blocked it,
        // how many failures it holds, and which bots observed them.
        cited: rejection?.cited
          ? `${rejection.cited.key} fails=${rejection.cited.fails}` +
            ` reporters=${(rejection.cited.reporters ?? ['-']).join('+')}`
          : undefined,
      })
      this.lastOutcome = `rejected: ${why}`.slice(0, 160)
      this.memory.addEvent(this.lastOutcome)

      // A veto alone is a LIVELOCK: the model re-proposes the same action, the
      // gate rejects it again, and nothing about the world has changed to make
      // a different choice attractive. Observed happening indefinitely.
      // So a rejection that means "you keep doing this" must be followed by a
      // deterministic action that CHANGES the situation.
      this.consecutiveRejections = (this.consecutiveRejections ?? 0) + 1
      if (rejection?.reason === 'repeat_loop' || this.consecutiveRejections >= 3) {
        await this.#escape()
      }
    }
    if (admitted) this.consecutiveRejections = 0

    // Track whether this milestone is going anywhere at all.
    // Flush immediately. noteAttempt runs AFTER both save() calls above, so a
    // give-up was only written on some later cycle -- and a reconnect in that
    // window lost it, sending the bot back through 25 more attempts at a goal
    // it had already proven impossible.
    this.lessons.save()
    if (this.milestones.noteAttempt(outcome.status !== 'success')) {
      const sk = this.milestones.status()
      log('warn', 'milestone unreachable, skipping', { now: sk.id })
      this.memory.addEvent(`gave up on the previous goal as unreachable; now: ${sk.describe}`)
      logEvent({ kind: 'milestone_skipped', status: 'failed',
                 detail: `no progress after 25 attempts; moved on to ${sk.id}`,
                 snapshot: snapshot(this.bot) })
      this.lessons.save()   // a give-up is rare and expensive to relearn
      // Tell the fleet. Two scouts each spent 25 attempts proving the SAME
      // goal unreachable tonight; the second one should not have had to.
      const gaveUp = this.milestones.skipped[this.milestones.skipped.length - 1]
      if (gaveUp && this.worldFacts?.reportUnreachable(gaveUp, config.bot.name, this.bot.entity?.position)) {
        announceUnreachable(this.bot, gaveUp)
      }
    }

    logLlm({
      startedAt: started, snapshot: snap, trigger,
      model: config.llm.model, endpoint: config.llm.baseUrl,
      res, promptText: user, tokensEstimated: tokens, droppedEvents: dropped,
      proposal: res.proposal, rejection, outcome,
      milestone: milestone.id, perceptionSnapshot: percept,
    })

    if (this.milestones.refresh()) {
      const s = this.milestones.status()
      log('info', 'milestone complete', { next: s.id, was: milestone.id })
      // SHIP IT. milestone_skipped was already an event, but completion was only
      // ever a local log line -- so Elasticsearch recorded every give-up and no
      // achievement, and "milestones completed per bot-hour" (the primary
      // outcome of any model comparison) simply did not exist as data. Measuring
      // only what goes wrong makes progress unfalsifiable in both directions.
      logEvent({
        kind: 'milestone_complete', status: 'success',
        detail: `completed ${milestone.id}; now ${s.id}`,
        snapshot: snapshot(this.bot),
      })
      this.memory.addEvent(`milestone complete, now: ${s.describe}`)
      try { this.bot.chat(`milestone done — now: ${s.id}`) } catch {}
    }

    // Pace the loop. Handoff doc S16: strategic decisions every 30-90s, with
    // deterministic skills filling the gaps -- not a model call per tick.
    this.#scheduleNext()
  }
}
