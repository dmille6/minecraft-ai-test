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
import { smeltInputsFor } from './smelting.mjs'
import { makeClient, skillSchema } from './llm.mjs'
import { buildSystemPrompt, buildUserPrompt, makeSentinel, WorkingMemory } from './prompt.mjs'
import { AdmissionControl } from './admission.mjs'
import { MilestoneController } from './milestones.mjs'
import { logLlm, logEvent, log } from './logger.mjs'
// classifyFailure is deliberately NOT imported. It regexes the prose a skill
// wrote and hands back a taxonomy label, which is a guess wearing a
// measurement's clothes -- it turned "pathfinding exceeded 25000ms" into
// `no_path` 393 times. Skills state their own class now; see the scan in
// bots/test/evidence-gate.test.mjs that keeps it that way.
import { snapshot, perception, biomeAt } from './state.mjs'
import { config } from './config.mjs'
import { openLessons, EVIDENCE_ONLY_IF_HERE } from './lessons.mjs'
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
// AN ALLOWLIST, NOT A DENYLIST -- the polarity is the point.
//
// This was a denylist of classes that must not become lessons, which meant
// anything unlisted was enforced by default, INCLUDING `other`. Every time a
// skill's wording drifted, its failures fell to `other` and silently began
// training the gate. That is not hypothetical: gather's collect budget did it
// once (hence `collect_budget`), and `other` was at one point the LARGEST
// failure class at 36%. A taxonomy whose default is "enforce a permanent block
// on something I could not classify" will keep producing this bug.
//
// So: name what IS evidence about the action, and let everything else -- known
// or not, present or added next week -- be logged, charted, and given no vote.
const EVIDENCE_ABOUT_THE_ACTION = new Set([
  'no_path',          // the world says there is no route
  'path_incomplete',  // moved, but repeatedly cannot finish the route
  // `nothing_found` USED TO LIVE HERE. It is still the world talking, but what
  // it says is "there is none within N blocks of HERE" -- a fact about a place,
  // stored against a key that carries no position. See EVIDENCE_ONLY_IF_HERE.
  'buried',           // the material exists but under solid ground
  'bad_target',       // the args name something that does not exist
])

// SITUATIONAL: evidence only while the situation is NOT changing.
//
// Each of these names its own remedy -- "needs 1x oak_log", "no pickaxe",
// "place the crafting_table". A failure that tells you how to fix it is a
// PLANNING signal on its first occurrence and only becomes evidence if the
// named gap stops moving. These are the tech-tree rungs: gate them outright and
// a bot can never bootstrap, gate them never and `craft diamond_pickaxe` loops
// forever. lessons.recordFailure() splits the two on whether `gap` changed.
const EVIDENCE_ONLY_IF_STUCK = new Set([
  'missing_ingredients', 'missing_tool', 'needs_station', 'inventory',
])

// A SKILL IS OFFERED ONLY WHERE IT EXISTS, and `board` did not honour that.
//
// This list feeds BOTH the JSON-schema enum the model must emit into AND the
// prompt's "Available skills" line. The usage line for `board` is gated on
// memory scope -- correctly, since only the board and placebo arms have a
// lectern -- but the NAME was offered to every arm. Rendered per scope:
//
//     board       usage-line YES   in available list YES
//     checkpoint  usage-line YES   in available list YES
//     shared      usage-line NO    in available list YES   <- offered, undocumented
//     isolated    usage-line NO    in available list YES   <- offered, undocumented
//
// So hive and isolated bots were told a verb existed, never told what it took,
// and their grammar permitted them to emit it -- for a lectern their world does
// not have. That is precisely the drift prompt-usage-coverage.test.mjs was
// written to catch, and `board` was its one hand-written exemption.
const HAS_BOARD = config.memory.scope === 'board' || config.memory.scope === 'checkpoint'
const SKILL_NAMES = Object.keys(SKILLS)
  .filter(n => !SKILLS[n].chatOnly)
  .filter(n => n !== 'board' || HAS_BOARD)

// Exported so the classification policy can be asserted directly. The bug this
// replaced was invisible in every test precisely because the policy lived only
// inside a branch that needed a live bot to reach.
//
// EVIDENCE_ONLY_IF_HERE is RE-EXPORTED, NOT REDECLARED -- it is the very object
// lessons.mjs obeys, imported above, so the taxonomy still reads as three sets
// in one place while having exactly one definition. A copy here would be the
// stale-mirror bug that scripts/purge-situational-lessons.py already carries a
// warning about.
export { EVIDENCE_ABOUT_THE_ACTION, EVIDENCE_ONLY_IF_STUCK, EVIDENCE_ONLY_IF_HERE }

/**
 * Which store does this failure class get a vote in, and under what condition?
 *
 * ONE source of truth, pure and exported, so the policy can be asserted
 * directly instead of by reading which of three Sets a name happens to be in.
 * `null` means "logged, charted, and given no vote" -- the default, and the
 * polarity the allowlist exists to keep.
 */
export function evidenceScope(failClass) {
  if (EVIDENCE_ABOUT_THE_ACTION.has(failClass)) return 'action'
  if (EVIDENCE_ONLY_IF_STUCK.has(failClass)) return 'situation'
  if (EVIDENCE_ONLY_IF_HERE.has(failClass)) return 'place'
  return null
}

// A prerequisite that cannot be met (no dirt reachable from a sealed pocket)
// must not become a permanent goal -- that would be this fix wearing its own
// uniform. Fifteen minutes is several cognitive cycles plus a gather attempt.
export const PREREQ_TTL_MS = 15 * 60_000

// Enough displacement that the bot's surroundings -- and so the blocks in its
// prompt -- are different ones. Below this the breaker has not broken anything
// and must not report that it did.
export const LIVELOCK_MIN_MOVE = 8

/**
 * Does a held prerequisite replace the milestone this cycle?
 *
 * Pure, so the decision that governs what the model reads as TASK: can be
 * tested without standing up a bot, an LLM client and a lessons store. Returns
 * the task to render plus, when the prereq is finished, WHY it finished --
 * `satisfied` (the bot holds enough) or `abandoned` (it ran out of patience).
 */
export function applyPrereq(milestone, prereq, have, now = Date.now()) {
  if (!prereq) return { task: milestone, clear: null }
  if (have >= prereq.count) return { task: milestone, clear: 'satisfied' }
  if (now - prereq.since > PREREQ_TTL_MS) return { task: milestone, clear: 'abandoned' }
  return {
    clear: null,
    task: {
      ...milestone,
      id: `${milestone.id}+prereq`,
      describe: prereq.describe,
      progress: `${have}/${prereq.count} held`,
      hint: `This is a detour, not the goal. Once you hold ${prereq.count}, ` +
            `run ${prereq.fromSkill} again and the original task resumes.`,
      // `wants` MOVES WITH THE TASK, and that is the half that makes this work:
      // the admission gate's milestone-critical exemption and the value
      // classifier both read it, so while the detour stands, gathering the
      // blocks can never be hard-blocked by an avoid rule and counts as
      // progress rather than busywork.
      wants: prereq.items[0],
    },
  }
}

export class CognitiveLoop {
  constructor(bot, runner, lessons = null, worldFacts = null) {
    this.bot = bot
    this.runner = runner
    this.llm = makeClient()
    this.memory = new WorkingMemory()
    // In-memory ONLY, and deliberately so: a prerequisite is about the spot the
    // bot is standing in right now. Persisting it across a reconnect would
    // restore a shopping list for a hole the bot is no longer in.
    this.prereq = null
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
      // The whole pool, in preference order. Logging only the primary hid a
      // two-endpoint config behind a one-endpoint line.
      model: config.llm.model, endpoints: config.llm.baseUrls, num_ctx: config.llm.numCtx,
    })
    this.#startLiveness()
    this.#tick('startup')
  }

  stop() {
    this.stopped = true; this.running = false
    clearTimeout(this.nextTimer); clearInterval(this.liveness)
    try { this.lessons.save() } catch {} }

  /**
   * WHY A REFLEX INTERRUPT BECOMES THE NEXT TRIGGER.
   *
   * The reflex hands a situation up to cognition by interrupting the skill.
   * That handoff carried no information: every reason arrived as `idle`, 99.0%
   * of 21,180 decisions in three hours, which is how two bots read
   * `TRIGGER: idle` on their 59th diagnosed stranding at the build limit.
   *
   * Held rather than dispatched, for two reasons. `notify()` drops anything
   * that arrives while the runner is busy, and dispatching from the runner
   * would nest a decision inside the one still unwinding.
   *
   * PRIORITY, NOT LAST-WINS. Two reflexes can fire in quick succession and the
   * runner keeps only the newest reason, so `stranded_high` can be overwritten
   * by a `stuck` that is merely its symptom. The ranking below is by how badly
   * the situation needs a DIFFERENT plan rather than a retry.
   */
  static TRIGGER_RANK = {
    death: 6,
    stranded_high: 5, entombed: 5,
    marooned: 4, stranded: 4,
    drowning: 3, suffocating: 3, low_health: 3,
    danger_block: 2,
    stuck: 1, stagnation: 1,
  }

  /**
   * REASONS THAT MUST NOT WAKE A DECISION.
   *
   * `user_stop` is a human saying stop. Treating it as a situation to think
   * about would have the bot make a fresh decision the instant it was stopped,
   * which is the opposite of what was asked. It is an instruction, not a
   * predicament, and the difference is not visible from the reason string --
   * which is exactly why it is written down rather than left to rank 0.
   */
  static TRIGGER_SUPPRESSED = new Set(['user_stop'])

  #raiseTrigger (reason, detail) {
    if (CognitiveLoop.TRIGGER_SUPPRESSED.has(reason)) return
    const rank = r => CognitiveLoop.TRIGGER_RANK[r] ?? 0
    if (this.pendingTrigger && rank(this.pendingTrigger) > rank(reason)) return
    this.pendingTrigger = reason
    // The model reads RECENT EVENTS, not the enum, so record what happened.
    if (detail) this.memory.addEvent(`reflex took over (${reason}): ${detail}`.slice(0, 160))
  }

  #takePendingTrigger () {
    const t = this.pendingTrigger
    this.pendingTrigger = null
    return t
  }

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
    this.memory.addEvent(`stuck choosing the same action; relocated toward ${x},${z} to find different surroundings`)
    // LOG THE OUTCOME, NOT THE INTENTION.
    //
    // This event carried a hardcoded `status: 'failed'` written BEFORE the goto
    // ran, so 2,296 relocations in 24 hours recorded 0% success regardless of
    // whether the bot moved. That is not a rescue path that never works; it is
    // one that was never measured -- the same defect that let `drowning_escaped`
    // count ceiling timeouts as rescues.
    //
    // Success here is DISPLACEMENT, not arrival. The breaker exists to put the
    // bot where its perception differs so the model stops proposing the same
    // action; reaching the exact square 25-60 blocks out was never the goal.
    const from = { x: p.x, z: p.z }
    await this.runner.run('goto', { x, y: Math.round(p.y), z }, { trigger: 'livelock_escape' })
    const at = this.bot.entity?.position
    const moved = at ? Math.hypot(at.x - from.x, at.z - from.z) : 0
    logEvent({ kind: 'livelock_escape',
               status: moved >= LIVELOCK_MIN_MOVE ? 'success' : 'failed',
               detail: `fixated on one action; relocating to ${x},${z} -- moved ` +
                       `${moved.toFixed(0)} of the ${Math.round(dist)} blocks asked for`,
               snapshot: snapshot(this.bot) })
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
      this.#tick(this.#takePendingTrigger() ?? 'idle')
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
  /**
   * THE RECIPE BECOMES THE TASK.
   *
   * Four days of Scout01 at y=29: every failed climb handed the model the
   * sentence "gather 8+ dirt or cobblestone first", and every next decision
   * proposed `gather oak_log` -- an action with 126 recorded failures -- because
   * TASK: still said "Stockpile oak logs" and advice is not a goal. The bot was
   * standing inside a solid mass of diggable stone the whole time.
   *
   * So a prerequisite reported by a skill PREEMPTS the milestone until it is
   * satisfied. Not a new milestone (the chain must not be rewritten by a
   * failure), not a hint (hints were already being ignored) -- a temporary
   * override of the one line the model actually plans against.
   *
   * `wants` moves with it, which is the half that makes it work: the admission
   * gate's milestone-critical exemption and the value classifier both read
   * `wants`, so while the override stands, `gather dirt` can never be
   * hard-blocked by an avoid rule and counts as real progress rather than
   * busywork.
   */
  #adoptPrereq(need, fromSkill) {
    if (!need?.items?.length) return
    if (this.prereq && this.#prereqHave() < this.prereq.count) return   // one at a time
    this.prereq = { ...need, since: Date.now(), fromSkill }
    log('warn', 'prerequisite adopted as the current task', {
      need: need.items.slice(0, 3).join('/'), count: need.count, after: fromSkill,
    })
    logEvent({ kind: 'prereq_adopted', status: 'failed',
               detail: `${fromSkill} needs ${need.count}x ${need.items.slice(0, 3).join(' or ')} ` +
                       `(${need.because}); it is now the task until satisfied`,
               snapshot: snapshot(this.bot) })
  }

  #prereqHave() {
    if (!this.prereq) return 0
    const want = new Set(this.prereq.items)
    let n = 0
    for (const it of (this.bot.inventory?.items() ?? [])) if (want.has(it.name)) n += it.count
    return n
  }

  #activeTask() {
    // The reflex layer cannot reach this object, so it leaves prerequisites on
    // the bot (the same bus assertNav and withAscentMovements ride). Drain it
    // here, before the task is chosen, so an escape that failed for want of a
    // pickaxe becomes the goal on the very next decision.
    if (this.bot.pendingPrereq) {
      const p = this.bot.pendingPrereq
      this.bot.pendingPrereq = null
      this.#adoptPrereq(p, 'the escape reflex')
    }
    const m = this.milestones.status()
    const { task, clear } = applyPrereq(m, this.prereq, this.#prereqHave())
    if (clear) {
      const held = this.prereq
      // READ IT BEFORE YOU CLEAR IT. `#prereqHave()` returns 0 when
      // `this.prereq` is null, and the log line below called it AFTER the null
      // -- so every prerequisite event ever written said "had 0/N", including
      // the ones written at the exact moment the prerequisite was satisfied.
      // Confirmed over the full log: 226 of 226 events, not one non-zero.
      const haveNow = this.#prereqHave()
      this.prereq = null
      logEvent({ kind: clear === 'satisfied' ? 'prereq_satisfied' : 'prereq_abandoned',
                 status: clear === 'satisfied' ? 'success' : 'failed',
                 detail: `${held.items[0]}-class: had ${haveNow}/${held.count} ` +
                         `after ${Math.round((Date.now() - held.since) / 1000)}s`,
                 snapshot: snapshot(this.bot) })
      if (clear === 'satisfied') {
        this.memory.addEvent(`got the ${held.count} blocks the climb needed; run ${held.fromSkill} again now`)
      }
    }
    return task
  }

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
    // THE CRAFTING GRAPH DOES NOT CONTAIN THE SMELTING GRAPH, and reading only
    // the first was a dead end waiting to happen.
    //
    // recipesAll('iron_ingot') returns the CRAFTING recipes -- iron_nugget and
    // iron_block -- because the furnace route is not a recipe the registry
    // models at all (minecraft-data ships no smelting data; see smelting.mjs).
    // So a bot whose milestone is "1 iron_ingot", doing precisely the right
    // thing by mining down and gathering the ore, would have had its raw_iron
    // scored `off-target gain` by classifyOutcome, called busywork, and denied
    // the decrement on its avoid rule.
    //
    // That is the CLAUDE.md failure shape exactly: two correct components
    // meeting at a gap neither could see. One line closes it.
    for (const src of smeltInputsFor(target)) want.add(src)
    return want
  }

  async #tick(trigger) {
    if (this.stopped || this.runner.isBusy()) return

    // `chainComplete` is not a thing MilestoneController has ever defined -- the
    // getter is `allDone` (milestones.mjs). Both reads returned undefined, so
    // the transition below compared undefined to undefined and this branch
    // could never fire: the fleet has never once logged entering the sustaining
    // loop, and nobody noticed because the absence of a log line looks exactly
    // like the condition not being met.
    const wasChainDone = this.milestones.allDone
    this.milestones.refresh()
    if (!wasChainDone && this.milestones.allDone) {
      log('info', 'fixed milestone chain complete, entering sustaining loop', { decisions: this.decisions })
      this.memory.addEvent('finished the tool-crafting chain; now stockpiling and scouting on a loop')
      try { this.bot.chat('tool chain complete — switching to sustaining goals') } catch {}
    }

    const milestone = this.#activeTask()
    const sentinel = makeSentinel()
    const { user, tokens, dropped, affordance } = buildUserPrompt({
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
      // The same wanted-set the outcome classifier uses, so "what counts as
      // progress" and "what may never be blocked" cannot drift apart. A null
      // set means we could not resolve the recipe, and the gate treats that as
      // "no exemption" rather than inventing one.
      // The gate needs to know which rung is active: a deposit is worth making
      // under a deposit goal and not worth a 800-block walk otherwise. Set here
      // rather than passed, because every other check() argument is about the
      // PROPOSAL and this is about the bot's current obligation.
      this.admission.activeMilestoneId = milestone?.id ?? null
      const check = this.admission.check(res.proposal, this.bot, this.#wantedItems(milestone))
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
      // THE REFLEX TOOK THE BODY -- SAY SO ON THE NEXT DECISION.
      if (r.interruptedBy) this.#raiseTrigger(r.interruptedBy, r.detail)
      // A PREREQUISITE THE GOAL LAYER CANNOT SEE IS NOT A PREREQUISITE.
      // Adopt whatever the skill said it needed; #activeTask makes it the task.
      if (r.need) this.#adoptPrereq(r.need, admitted.skill)
      // AN UNKNOWN THROTTLES BUT NEVER TEACHES.
      //
      // `unknown` is what a skill returns when a budget expired, an observation
      // could not be made, or -- via the runner's evidence gate -- a success
      // arrived with nothing measurable behind it. The cooldown still applies,
      // because a decision that went nowhere is still a decision worth not
      // repeating immediately, and it is transient in-memory state that expires
      // on its own. The lessons store is not touched at all: it holds beliefs
      // that persist across restarts and propagate through the hive, and there
      // is nothing here to believe. This is the branch that would have kept
      // "pathfinding exceeded 25000ms" from becoming 393 permanent records of
      // "no route exists".
      if (r.status === 'unknown') {
        this.admission.noteFailure(admitted.skill, admitted.args)
        log('info', 'outcome unknown: throttled, not learned', {
          skill: admitted.skill, failClass: r.failClass ?? 'other',
          detail: String(r.detail ?? '').slice(0, 80),
        })
      } else if (r.status === 'failed') {
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
        // `?? 'other'` is a floor, not a fallback: `other` is in neither evidence
        // set, so a skill that forgets to classify itself gets no vote at all.
        // That is the safe direction, and the source scan in
        // bots/test/evidence-gate.test.mjs means it should never fire.
        const fc = r.failClass ?? 'other'
        // ONE CALL FOR BOTH SETS, and deliberately so. A place-scoped class is
        // recorded with exactly the arguments an action-scoped one is; whether
        // the streak is scoped to a place is decided inside recordFailure from
        // the class itself (lessons.mjs, EVIDENCE_ONLY_IF_HERE). The first draft
        // passed a `placeScoped` boolean from right here, and review's verdict
        // was fatal and correct: flipping that one literal to `false` switched
        // the feature off with the whole suite still green. There is no longer a
        // literal here to flip -- only the routing, and a nothing_found failure
        // that reaches the store at all is asserted end-to-end through this
        // exact branch in test/learned-avoid-scope.test.mjs.
        if (EVIDENCE_ABOUT_THE_ACTION.has(fc) || EVIDENCE_ONLY_IF_HERE.has(fc)) {
          this.lessons.recordFailure(admitted.skill, admitted.args, fc, this.bot.entity?.position)
        } else if (EVIDENCE_ONLY_IF_STUCK.has(fc)) {
          // Passing `gap` is what makes this conditional. A skill that cannot
          // name its gap passes null, and the entry accrues as before -- so an
          // unnamed gap is never SAFER than the old behaviour, only never worse.
          this.lessons.recordFailure(
            admitted.skill, admitted.args, fc, this.bot.entity?.position, r.gap ?? null)
        } else {
          log('info', 'failure not persisted as a lesson: not evidence about the action', {
            skill: admitted.skill, failClass: fc,
          })
        }
      } else if (r.status === 'success') {
        // ADR-0003. Reward the skill only if the durable change it EXISTS FOR
        // actually happened -- judged against the contract in SKILL_CONTRACTS,
        // not against whether the call returned cleanly.
        //
        // THE CONTRACT CHECK NO LONGER LIVES HERE. It runs in the runner, before
        // this layer is handed anything, and a success that could not show its
        // contract's change never arrives as a success at all -- it arrives as
        // `unknown` and is handled above. This branch used to do the detecting
        // AND the recording, which meant it logged "skill returned cleanly but
        // changed nothing" and then called recordSuccess() on the very next
        // line. Detecting a thing you then do anyway is not a check.
        //
        // What is left here is the MILESTONE question, which is a different
        // question and belongs at this altitude: was the change the one we
        // currently want? That governs preference and hazards only.
        const { value, because } = classifyOutcome(
          admitted.skill, r.status, r.delta ?? {}, this.#wantedItems(milestone))

        // THE DISPROOF CHANNEL MUST BE AT LEAST AS WIDE AS THE ACCRUAL CHANNEL.
        //
        // Failures were recorded unconditionally; successes only when the gain
        // was on the CURRENT milestone's shopping list. So `craft stick` while
        // the milestone wanted a crafting table scored `neutral` and decremented
        // nothing -- correct-but-early work could never disprove the rule that
        // was blocking it. Accrual +1 per attempt against disproof +0 is not a
        // learning rule, it is a ratchet.
        //
        // So the win is recorded from the CONTRACT evidence the runner measured,
        // not from the milestone-filtered verdict: the skill did the durable
        // thing it exists for, which is exactly the fact an avoid rule claims is
        // false, whichever milestone happened to be current. There is no longer
        // a `neutral` branch calling recordSuccess -- there is one call, and it
        // cannot be made without the measurement in hand.
        this.lessons.recordSuccess(admitted.skill, admitted.args, r.contractEvidence)

        // Preference -- what makes a bot KEENER -- stays gated on `valuable`.
        if (value === 'valuable') {
          this.admission.noteSuccess(admitted.skill, admitted.args)
        } else if (value === 'costly') {
          // A win that costs health is not fed to the admission gate. The cost
          // attaches to the place, not the skill: mining at y=39 is not a bad
          // idea; mining at y=39 THERE is, and hazardsNear() is what the prompt
          // layer reads back.
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
          // Reaching here now means one specific thing: the contract WAS met and
          // the gain was off the milestone's list. "Changed nothing" cannot get
          // this far any more -- the runner turns it into `unknown`.
          log('info', 'skill met its contract, off the current milestone', {
            skill: admitted.skill,
            expected: (SKILL_CONTRACTS[admitted.skill]?.expects ?? []).join('|') || 'nothing',
            measured: (r.contractEvidence ?? []).join('; ').slice(0, 80),
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
      // res.endpoint is the url that ANSWERED. NULL WHEN NOTHING DID, and it
      // stays null: this was `res.endpoint ?? config.llm.baseUrl`, which
      // reinstated the exact lie the rest of this change removed. When every
      // endpoint in the pool fails, that `??` names the configured primary as
      // though it had served a request it never answered -- so a total inference
      // outage would be recorded as the primary handling traffic normally, with
      // an error beside it. `llm.endpoint` is a keyword mapping; null is
      // "nothing served this", which is the true answer and a queryable one.
      // res.model is what SERVED the decision, which is not config.llm.model
      // when the pool degraded to an endpoint pinned to a smaller one.
      model: res.model ?? config.llm.model, endpoint: res.endpoint,
      res, promptText: user, tokensEstimated: tokens, droppedEvents: dropped,
      proposal: res.proposal, rejection, outcome, admission: admitted,
      milestone: milestone.id, systemPrompt: this.system, perceptionSnapshot: percept,
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
