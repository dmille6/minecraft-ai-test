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

import { SKILLS } from './skills.mjs'
import { makeClient, skillSchema } from './llm.mjs'
import { buildSystemPrompt, buildUserPrompt, makeSentinel, WorkingMemory } from './prompt.mjs'
import { AdmissionControl } from './admission.mjs'
import { MilestoneController } from './milestones.mjs'
import { logLlm, logEvent, log } from './logger.mjs'
import { snapshot } from './state.mjs'
import { config } from './config.mjs'

const SKILL_NAMES = Object.keys(SKILLS)

export class CognitiveLoop {
  constructor(bot, runner) {
    this.bot = bot
    this.runner = runner
    this.llm = makeClient()
    this.memory = new WorkingMemory()
    this.admission = new AdmissionControl()
    this.milestones = new MilestoneController(bot)
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
    this.memory.remember('home', { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ })
    this.memory.addEvent('agent came online')
    log('info', 'cognitive loop starting', {
      model: config.llm.model, endpoint: config.llm.baseUrl, num_ctx: config.llm.numCtx,
    })
    this.#tick('startup')
  }

  stop() { this.stopped = true; this.running = false }

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

  async #tick(trigger) {
    if (this.stopped || this.runner.isBusy()) return

    this.milestones.refresh()
    if (this.milestones.allDone) {
      log('info', 'all milestones complete', { decisions: this.decisions })
      this.memory.addEvent('all milestones complete')
      this.running = false
      try { this.bot.chat('all milestones complete') } catch {}
      return
    }

    const milestone = this.milestones.status()
    const sentinel = makeSentinel()
    const { user, tokens, dropped } = buildUserPrompt({
      bot: this.bot, milestone, memory: this.memory,
      lastOutcome: this.lastOutcome, trigger, sentinel,
    })

    const snap = snapshot(this.bot)
    const started = Date.now()
    const res = await this.llm.decide({ system: this.system, user, sentinel, schema: this.schema })
    this.decisions++

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
      if (r.status === 'failed') this.admission.noteFailure(admitted.skill, admitted.args)
      else if (r.status === 'success') this.admission.noteSuccess(admitted.skill, admitted.args)
      this.lastOutcome = `${admitted.skill} -> ${r.status}: ${r.detail ?? ''}`.slice(0, 160)
      this.memory.addEvent(this.lastOutcome)
    } else {
      const why = rejection ? `${rejection.reason} (${rejection.detail})` : res.error
      log('warn', 'decision rejected', { why, raw: res.raw?.slice(0, 120) })
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

    logLlm({
      startedAt: started, snapshot: snap, trigger,
      model: config.llm.model, endpoint: config.llm.baseUrl,
      res, promptText: user, tokensEstimated: tokens, droppedEvents: dropped,
      proposal: res.proposal, rejection, outcome,
      milestone: milestone.id,
    })

    if (this.milestones.refresh()) {
      const s = this.milestones.status()
      log('info', 'milestone complete', { next: s.id })
      this.memory.addEvent(`milestone complete, now: ${s.describe}`)
      try { this.bot.chat(`milestone done — now: ${s.id}`) } catch {}
    }

    // Pace the loop. Handoff doc S16: strategic decisions every 30-90s, with
    // deterministic skills filling the gaps -- not a model call per tick.
    if (!this.stopped && this.running) {
      setTimeout(() => { if (!this.runner.isBusy()) this.#tick('idle') }, config.llm.decisionCooldownMs)
    }
  }
}
