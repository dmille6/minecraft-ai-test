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

import { HARD_STOP } from './toolfor.mjs'
import { SKILLS, classifyOutcome, SKILL_CONTRACTS, plantableSpotNear, findTownComposter, townBuildPlan, townPickMiss, townIngredientMiss, foodSkipNow } from './skills.mjs'
import { smeltInputsFor } from './smelting.mjs'
import { makeClient, skillSchema } from './llm.mjs'
import { buildSystemPrompt, buildUserPrompt, makeSentinel, WorkingMemory } from './prompt.mjs'
import { AdmissionControl } from './admission.mjs'
import { MilestoneController, servesRung, NO_PROGRESS_MS, RUNNER_REFUSALS } from './milestones.mjs'
import { orderFor, readyFor, plantingOrder, plantingEnabled, PLANT_COOLDOWN_MS } from './workorder.mjs'
import { wearOutPlan, isHousekeeping } from './hygiene.mjs'
import { compostPlan, townOrder, townOrderOutcome, boneMealRoom, composterLevel, TOWN_ORDERS, STORAGE_NEAR, TOWN_RADIUS, startableJunk } from './composter.mjs'
import { hasUsablePick, roomPlan, pickTakes, roomKeep } from './withdrawpick.mjs'
/** One wear-out order per bot per two minutes at most. */
export const WEAR_OUT_COOLDOWN_MS = 2 * 60 * 1000
/** After a wear-out that destroyed nothing, wait this long before the next order. */
export const WEAR_OUT_BACKOFF_MS = 30 * 60 * 1000
import { logLlm, logEvent, log } from './logger.mjs'
// classifyFailure is deliberately NOT imported. It regexes the prose a skill
// wrote and hands back a taxonomy label, which is a guess wearing a
// measurement's clothes -- it turned "pathfinding exceeded 25000ms" into
// `no_path` 393 times. Skills state their own class now; see the scan in
// bots/test/evidence-gate.test.mjs that keeps it that way.
import { snapshot, perception, biomeAt } from './state.mjs'
import { config } from './config.mjs'
import { escapedFrom } from './recovery.mjs'
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
 * THE OUTCOME LINE THE PROMPT RENDERS -> at most OUTCOME_CHARS characters: skill, status, verdict, the skill's detail,
 * then the evidence. Pure, exported so a test can check what actually reaches the model: whatever a refusal needs the
 * model to read (its remedy) must sit at the START of its detail, or the cut takes it.
 */
export const OUTCOME_CHARS = 220
export function formatOutcome (skill, r = {}, outcome = null) {
  const evidence = outcome?.because?.length ? ` [${outcome.because.join('; ')}]` : ''
  const verdict = outcome?.value ? ` (${outcome.value})` : ''
  return `${skill} -> ${r?.status}${verdict}: ${r?.detail ?? ''}${evidence}`.slice(0, OUTCOME_CHARS)
}

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
 * PHYSICAL FIXATION (recovery-ladder-03, 2026-09-13; two Codex passes on docs/livelock-fixation.md). The breaker used
 * to fire on three rejected decisions alone and relocated WORKING bots 30-57 blocks every 5-10 minutes (hive-b-Bravo:
 * 21 successful gathers in the half hour after an "exhausted" row). Now the decision-loop signal must coincide with
 * the body being stuck over a fully observed window. Pure; the runner supplies the samples.
 *
 * `samples`: [{ t, x, z, items }] newest last, one per decision (items = inventory total); `reconnectAt`: the last
 * (re)connect time -- samples before it are not comparable and the window must start after it.
 * Returns { fixated, reason, moved, gained, coverage } so the log can say why.
 */
export const FIXATION = Object.freeze({ windowMs: 180_000, minSamples: 4, maxGapMs: 90_000, minSpanMs: 150_000, minMove: LIVELOCK_MIN_MOVE })
export function livelockFixated (samples, { now, rejections = 0, repeatLoop = false, reconnectAt = 0, cfg = FIXATION } = {}) {
  const lo = Math.max(now - cfg.windowMs, reconnectAt)
  const w = (samples || []).filter(s => s && s.t >= lo && s.t <= now).sort((a, b) => a.t - b.t)
  const span = w.length ? w[w.length - 1].t - w[0].t : 0
  let maxGap = 0
  for (let i = 1; i < w.length; i++) maxGap = Math.max(maxGap, w[i].t - w[i - 1].t)
  const coverage = w.length >= cfg.minSamples && span >= cfg.minSpanMs && maxGap <= cfg.maxGapMs
  if (!coverage) return { fixated: false, reason: 'insufficient coverage', moved: null, gained: null, coverage: false, n: w.length, span, maxGap }
  const x0 = w[0].x, z0 = w[0].z
  const moved = Math.max(...w.map(s => Math.hypot(s.x - x0, s.z - z0)))          // path extent from the oldest sample: a round trip is not 0
  let gained = 0
  for (let i = 1; i < w.length; i++) gained += Math.max(0, (w[i].items ?? 0) - (w[i - 1].items ?? 0))   // positive deltas only: consumption never masks a gain
  const arguing = repeatLoop || rejections >= 3                                   // the decision-loop signal, scoped to the caller's consecutive count
  const fixated = arguing && moved < cfg.minMove && gained === 0
  return { fixated, reason: fixated ? 'stuck and arguing' : (!arguing ? 'not arguing' : moved >= cfg.minMove ? 'moved' : 'gained'), moved, gained, coverage: true, n: w.length, span, maxGap }
}
export { escapedFrom }
/** After both rungs fail to move the bot, the breaker rests this long; the
 *  repeat window stays UNCLEARED meanwhile so the identical proposal keeps
 *  being refused instead of re-run (2026-09-13). */
export const LIVELOCK_LATCH_MS = 600_000

/**
 * THE BREAKER'S NEXT MOVE, as a pure decision. The relocation ran on the
 * travel profile (no digging, no bridging) and cleared the repeat window
 * whether or not the bot moved -- 2,296 firings, 0% measured success, and a
 * marooned bot re-proposed the same action four more times every cycle.
 *
 *   walk moved   -> done: clear the window, the perception differs now
 *   walk failed  -> 'dig': the same relocation with the ascent profile, which
 *                   may dig and bridge with the blocks in hand
 *   dig failed   -> 'latch': do NOT clear the window; rest LIVELOCK_LATCH_MS
 */
export function livelockNext ({ rung, escaped }) {
  if (escaped) return 'done'                      // the shared postcondition, nothing weaker (Codex pass 3)
  return rung === 'walk' ? 'dig' : 'latch'
}

/** The dig rung may not spend the bot below this many placeable blocks: the
 *  entombment reflex's own climb needs them (scaffoldPrereq asks for 8). */
export const LIVELOCK_BLOCK_RESERVE = 8

/** How many ladders may end in a latch within the window before the breaker
 *  declares the bot beyond its own remedies and rests for a long time. */
export const LADDER_MAX_LATCHES = 3
export const LADDER_WINDOW_MS = 3_600_000
export const LADDER_EXHAUSTED_REST_MS = 3_600_000
export function ladderExhausted (latches, now, { max = LADDER_MAX_LATCHES, windowMs = LADDER_WINDOW_MS } = {}) {
  return latches.filter(t => now - t <= windowMs).length >= max
}

/**
 * Does a held prerequisite replace the milestone this cycle?
 *
 * Pure, so the decision that governs what the model reads as TASK: can be
 * tested without standing up a bot, an LLM client and a lessons store. Returns
 * the task to render plus, when the prereq is finished, WHY it finished --
 * `satisfied` (the bot holds enough) or `abandoned` (it ran out of patience).
 */
/**
 * How many of a prerequisite the bot holds that can DO THE WORK. Pure.
 *
 * A TOOL AT ITS FLOOR IS NOT A TOOL (fleet triage 2026-09-29, 24 h, 60 bots): 4,073 of 4,605 pickaxe prerequisites
 * (88.4%) were counted SATISFIED while every pickaxe held had <= 1 use -- a copy toolfor.mjs will never swing
 * (remaining > HARD_STOP, toolfor.mjs:51). So "get a pickaxe" cleared the moment it was adopted, the bot went back to
 * the dig that had just failed, and four sealed bots looped for the whole window (96 bot-hours). A durable item counts
 * only above HARD_STOP uses, and above `minUses` when the task names one.
 */
export function prereqHave(items, prereq) {
  if (!prereq) return 0
  const want = new Set(prereq.items ?? [])
  const min = Math.max(HARD_STOP + 1, prereq.minUses ?? 0)
  let n = 0
  for (const it of items ?? []) {
    if (!want.has(it?.name)) continue
    // DIGGING TOOLS ONLY (Codex review): the floor is toolfor's swing reserve. A one-use shears, armour or
    // flint_and_steel still does its job, so only pickaxes/axes/shovels/hoes are held to it.
    if (DIG_TOOL.test(it.name) && it.maxDurability && it.maxDurability - (it.durabilityUsed ?? 0) < min) continue
    n += it.count ?? 1
  }
  return n
}
const DIG_TOOL = /_(pickaxe|axe|shovel|hoe)$/

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
      // AND `wantsAny` MOVES WITH IT TOO, or the detour inherits the goal's
      // family. The spread above copies every field, so a wood rung that accepts
      // eight log types handed its whole family to a scaffold-dirt detour:
      // measured by Codex pass 2, the resulting task read wants:'dirt' with all
      // eight logs still wanted, so gathering birch counted as progress toward
      // fetching dirt AND earned the milestone-critical exemption on a task that
      // has nothing to do with wood. The detour's family is its own item list.
      wantsAny: Array.isArray(prereq.items) && prereq.items.length > 1
        ? [...prereq.items] : null,
    },
  }
}

export class CognitiveLoop {
  constructor(bot, runner, lessons = null, worldFacts = null) {
    // PHYSICAL FIXATION samples: one per decision, last five minutes; a new Cognitive is a new connection, so
    // `startedAt` is the reconnect bound (samples from a previous connection are not comparable).
    this.fixationSamples = []; this.startedAt = Date.now()
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
    marooned: 4, flooded_pocket: 4, stranded: 4,   // flooded_pocket: the tooled pocket rung (2026-09-14)
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
    const from = { x: p.x, y: p.y, z: p.z }
    const placeable = () => this.bot.inventory?.items?.().filter(it => /dirt|cobblestone|stone|planks|_log|andesite|diorite|granite|gravel|netherrack/.test(it.name)).reduce((n, it) => n + it.count, 0) ?? 0
    const blocksBefore = placeable()
    const here = () => { const at = this.bot.entity?.position; return at ? { x: at.x, y: at.y, z: at.z, wet: !!this.bot.entity?.isInWater } : null }
    const movedNow = () => { const at = here(); return at ? Math.hypot(at.x - from.x, at.z - from.z) : 0 }
    // RUNG 1: walk. RUNG 2: the same relocation with the ascent profile (dig
    // and bridge allowed) -- hive-a-Comet stood on a disconnected ledge with
    // 460 cobblestone while the travel profile said noPath every time.
    await this.runner.run('goto', { x, y: Math.round(p.y), z }, { trigger: 'livelock_escape' })
    let rung = 'walk', moved = movedNow(), next = livelockNext({ rung, escaped: escapedFrom(from, here()) })
    // THE RESERVE IS ENFORCED BEFORE THE RUNG, not reported after it: a bot
    // holding fewer blocks than the entombment climb needs does not get to
    // bridge with them (Codex pass 2).
    if (next === 'dig' && typeof this.bot.withAscentMovements === 'function' && blocksBefore >= LIVELOCK_BLOCK_RESERVE) {
      rung = 'dig'
      // THE RESERVE HOLDS THROUGHOUT (Codex pass 3): a watcher ends the walk
      // the moment placeable blocks fall to the reserve, so a bridge can start
      // with eight and never end with zero.
      const watch = setInterval(() => {
        if (placeable() <= LIVELOCK_BLOCK_RESERVE) { try { this.bot.pathfinder?.setGoal?.(null) } catch {} }
      }, 500)
      try {
        await this.bot.withAscentMovements(async () => {
          // THE RESERVE IS SUBTRACTED BEFORE PLANNING (Codex pass 4): the
          // pathfinder bridges with what countScaffoldingItems() reports, so
          // during this rung it reports the inventory MINUS the reserve and
          // never plans a placement that would spend it. The watcher above is
          // only the backstop for a plan already in flight.
          const m = this.bot.pathfinder?.movements
          const orig = m?.countScaffoldingItems
          if (m && typeof orig === 'function') m.countScaffoldingItems = () => Math.max(0, orig.call(m) - LIVELOCK_BLOCK_RESERVE)
          try { return await this.runner.run('goto', { x, y: Math.round(p.y), z }, { trigger: 'livelock_escape_dig' }) }
          finally { if (m && typeof orig === 'function') m.countScaffoldingItems = orig }
        })
      } finally { clearInterval(watch) }
      moved = movedNow(); next = livelockNext({ rung, escaped: escapedFrom(from, here()) })
    }
    const spent = blocksBefore - placeable()
    logEvent({ kind: 'livelock_escape',
               status: next === 'done' ? 'success' : 'failed',
               detail: `fixated on one action; relocating to ${x},${z} -- moved ` +
                       `${moved.toFixed(0)} of the ${Math.round(dist)} blocks asked for (${rung}${next === 'latch' ? '; latched' : ''}; ` +
                       `dy ${((here()?.y ?? from.y) - from.y).toFixed(1)}, blocks spent ${spent})`,
               snapshot: snapshot(this.bot) })
    if (next === 'done') {
      this.admission.clearRepeatWindow()
      this.consecutiveRejections = 0
      return
    }
    // THE WINDOW STAYS. Clearing it here is what let the same action run four
    // more times from the same square; the veto is the only thing that was
    // working. Rest before trying to relocate again -- and after three latches
    // in an hour, say so ONCE, plainly, and rest an hour: the bot is beyond
    // its own remedies and a person needs to see it (recovery_exhausted is the
    // digest's trapped-bot list).
    this.consecutiveRejections = 0
    this.livelockLatches = [...(this.livelockLatches ?? []), Date.now()].filter(t => Date.now() - t <= LADDER_WINDOW_MS)
    if (ladderExhausted(this.livelockLatches, Date.now())) {
      const at = here()
      logEvent({ kind: 'recovery_exhausted', status: 'failed',
                 detail: `${this.livelockLatches.length} relocation ladders latched in the last hour at ` +
                         `${Math.round(at?.x ?? 0)},${Math.round(at?.y ?? 0)},${Math.round(at?.z ?? 0)}; placeable ${placeable()}, ` +
                         `held ${this.bot.heldItem?.name ?? 'nothing'}${at?.wet ? ', in water' : ''} -- the breaker is off until the bot is somewhere else`,
                 snapshot: snapshot(this.bot) })
      // TERMINAL, NOT A COOLDOWN (Codex pass 2): the breaker stays off until
      // the bot has left this place by some other means. It is a state a
      // person reads in the digest, not a timer that restarts the same ladder.
      this.recoveryExhaustedAt = at
      this.livelockLatchedUntil = Infinity
      this.livelockLatches = []
    } else {
      this.livelockLatchedUntil = Date.now() + LIVELOCK_LATCH_MS
    }
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
    // named= vs usable= : the canary's licence text, and the number the old count hid (a bot holding six spent pickaxes
    // reads named=6 usable=0).
    const inv = this.bot.inventory?.items?.() ?? []
    const named = inv.filter(it => (need.items ?? []).includes(it?.name)).reduce((n, it) => n + (it.count ?? 1), 0)
    // THE CASE THIS BUILD CHANGES (Codex review): by name the bot "has" it, by use it does not. The old count cleared
    // this detour at once; only this build can write the row.
    if (named >= need.count && prereqHave(inv, need) < need.count) {
      logEvent({ kind: 'prereq_usable_filtered', status: 'success',
                 detail: `${fromSkill}: named=${named} usable=${prereqHave(inv, need)} of ${need.count}x ${need.items.slice(0, 2).join('/')}; floor ${Math.max(HARD_STOP + 1, need.minUses ?? 0)} uses`,
                 snapshot: snapshot(this.bot) })
    }
    logEvent({ kind: 'prereq_adopted', status: 'failed',
               detail: `${fromSkill} needs ${need.count}x ${need.items.slice(0, 3).join(' or ')} ` +
                       `(${need.because}); it is now the task until satisfied named=${named} usable=${prereqHave(inv, need)}`,
               snapshot: snapshot(this.bot) })
  }

  #prereqHave() {
    // prereq-usable's prereqHave (it honours `minUses`, which the ore tunnel sets) replaces the tunnel's own copy.
    return prereqHave(this.bot.inventory?.items() ?? [], this.prereq)
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
    // A GOAL THAT ACCEPTS ANY LOG MUST NOT CALL BIRCH OFF-TARGET.
    //
    // `wants` is a single registry key and stays one: it is indexed directly
    // below and in workorder.mjs, and an array would make both silently do
    // nothing. A milestone that accepts a FAMILY carries the family in
    // `wantsAny`, and this set -- which drives the value classifier and the
    // milestone_critical admission exemption -- has to include it. Without this,
    // a bot could satisfy its wood rung with birch while every birch gain was
    // scored `neutral` and never earned the exemption (Codex pass 1).
    const target = milestone?.wants
    if (!target) return null
    const family = Array.isArray(milestone?.wantsAny) ? milestone.wantsAny : []
    const want = new Set([target, ...family.filter(x => typeof x === 'string')])
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
    { const at = this.bot.entity?.position; if (at) { const inv = this.bot.inventory?.items?.() ?? []; this.fixationSamples.push({ t: Date.now(), x: at.x, z: at.z, items: inv.reduce((n, it) => n + (it.count ?? 0), 0) }); const lo = Date.now() - 300_000; while (this.fixationSamples.length && this.fixationSamples[0].t < lo) this.fixationSamples.shift() } }
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
    // ---- THE WORK ORDER ------------------------------------------------
    //
    // If the ACTIVE RUNG is a conversion the bot can already perform, perform
    // it. Do not spend a decision asking a 7B to notice what it is holding.
    //
    // Measured: when the chain lands on a craft rung the model picks the craft
    // verb 27-60% of the time against an 8.4% baseline, so the goal channel
    // works; and craft succeeds 36.7% at 5.8 items per success with smelt at
    // 68.6%, so the skills work. The loss is in CHOOSING -- the fleet calls
    // gather 26 times for every smelt while carrying idle stockpiles. This is
    // the repo's oldest lesson (`advice printed is not advice taken`) applied
    // to the ladder itself.
    //
    // SYNTHESISED AS A PROPOSAL rather than dispatched directly, and that is
    // deliberate. Everything downstream then runs unchanged: the admission gate
    // still vets it (and already exempts milestone-critical crafts from
    // learned_avoid), the outcome still feeds `milestones.noteAttempt`, so a
    // work order that keeps failing still counts toward the give-up. Bypassing
    // that would let a bot loop forever on an impossible rung by a new door.
    // PLANTING, ONLY WHEN THERE IS NO RUNG TO ADVANCE. A craft or smelt the
    // milestone is waiting on always wins; this fills an otherwise-LLM decision.
    //
    // Measured 2026-09-26: the fleet gathers 3,605 logs a day, picks up 485
    // saplings a day and plants ZERO -- no sapling has ever appeared in a place
    // attempt. Items/bot-h fell 55.73 -> 14.82 in fourteen days while gather
    // ATTEMPTS stayed flat, and the two pools given FRESH WORLDS on 19 Sep jumped
    // log-gather 4.9% -> 57.6% on identical code, then fell back 67% in six days.
    // The worlds are being consumed and nothing puts anything back.
    //
    // The cooldown is charged when the order is ISSUED, not when it succeeds, so a
    // spot that cannot be planted costs one decision every ten minutes rather than
    // every decision.
    let order = orderFor(readyFor(this.bot, milestone))
    // HYGIENE BEFORE PLANTING, and before the model: a bot at 34+ of 36 slots breaks blocks and leaves the drop
    // on the ground (hygiene.mjs has the measurement). Spent tools are worn out -- destroyed by use, never
    // dropped. Rate-limited by a cooldown charged when the order is ISSUED, like planting.
    if (!order && Date.now() - (this.lastWearOutAt ?? 0) >= WEAR_OUT_COOLDOWN_MS && Date.now() >= (this.wearOutBackoffUntil ?? 0)) {
      try {
        const plan = wearOutPlan(this.bot.inventory?.items?.() ?? [])
        if (plan.tools.length) {
          this.lastWearOutAt = Date.now()
          order = { skill: 'wear_out', args: {},
                    why: `inventory at ${plan.slots} of 36 slots; ${plan.tools.length} spent tool(s) to wear out` }
        }
      } catch { /* an inventory read must never break the decision loop */ }
    }
    // THE TOWN ORDERS (composter.mjs townOrder decides; this only supplies readings and keeps the state): compost at
    // town at 34+ slots, or build the town's composter when there is none and the bag has room for the craft chain.
    // Never a trip. Every world scan is lazy and rate-limited inside townOrder.
    if (!order) {
      try {
        const bot = this.bot
        const items = bot.inventory?.items?.() ?? []
        const p = bot.entity?.position
        // THE PEACEFUL FOOD POLICY (foodskip.mjs, owner 10-06): apples above the reserve count as compostable only while it is active.
        const peaceful = foodSkipNow(bot).active   // the food policy's apples and the peaceful kit's plants: one switch
        const plan = compostPlan(items, { apples: peaceful, plants: peaceful })
        const home = { x: config.world.homeX, z: config.world.homeZ }
        const r = townOrder({
          // while the switch is on, a full bag only gets the order when a fill can start (composter.mjs startableJunk)
          now: Date.now(), slots: plan.slots, freeSlots: 36 - plan.slots, junk: peaceful ? startableJunk(items, { apples: peaceful, plants: peaceful, level: () => (p && Math.hypot(home.x - p.x, home.z - p.z) <= TOWN_RADIUS ? composterLevel(findTownComposter(bot)) : 0) }) : plan.junk,
          distHome: p ? Math.hypot(home.x - p.x, home.z - p.z) : Infinity,
          storageNear: () => !!bot.findBlock?.({ matching: b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry?.blocks?.[b.type]?.name), maxDistance: STORAGE_NEAR }),
          composterAtTown: () => !!findTownComposter(bot),
          room: boneMealRoom(items),
          composterRipe: () => (composterLevel(findTownComposter(bot)) ?? 0) >= 7,
          buildPlan: () => townBuildPlan(bot),
          myName: bot.username ?? '',
          peers: () => Object.values(bot.players ?? {}).filter(q => q?.username && q.username !== bot.username && q.entity?.position &&
            Math.hypot(q.entity.position.x - home.x, q.entity.position.z - home.z) <= TOWN_RADIUS).map(q => q.username),
          // THE PICKAXE (withdrawpick.mjs): none usable in the bag; the town's memory of a recent miss; room for one.
          pickNeeded: !hasUsablePick(items),
          pickMiss: () => townPickMiss(bot),
          // ...and the ingredients' own: nothing needed, or every container recently held none of every need.
          ingredientMiss: () => townIngredientMiss(bot),
          // The SAME keep as at the chest (withdrawPick): the goal's wants and the stone-pickaxe ingredients.
          pickRoom: () => roomPlan(items, pickTakes(), { keep: roomKeep(bot.currentWants ?? []) }).ok,
          state: this.townState ?? {},
        })
        this.townState = r.state
        if (r.order) order = r.order
      } catch { /* an inventory or world read must never break the decision loop */ }
    }
    if (!order) {
      const sap = {}
      try {
        for (const it of this.bot.inventory?.items?.() ?? []) {
          if (it?.name?.endsWith('_sapling')) sap[it.name] = (sap[it.name] ?? 0) + (it.count ?? 0)
        }
      } catch { /* an inventory read must never break the decision loop */ }
      // THE COOLDOWN MUST GATE THE SCAN, NOT JUST THE ORDER. Review caught this:
      // plantableSpotNear is a 5x5x3 = 75-call blockAt sweep, and evaluating it in
      // plantingOrder's argument list ran it on EVERY decision for EVERY bot holding
      // a sapling -- which is 100% of them, measured. ~7,300 sweeps an hour
      // fleet-wide, over 95% of them discarded by a cooldown checked afterwards, on
      // the hot path readyFor is documented to keep thin.
      const sinceLast = Date.now() - (this.lastPlantedAt ?? 0)
      if (plantingEnabled(process.env) && Object.keys(sap).length && sinceLast >= PLANT_COOLDOWN_MS) {
        const best = Object.entries(sap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'oak_sapling'
        const spot = plantableSpotNear(this.bot, 2, best)
        // THE COOLDOWN IS CHARGED FOR THE SCAN, NOT FOR THE ORDER, and the previous
        // version of this line was the whole bug it was written to fix. It read
        // `if (order) this.lastPlantedAt = ...`, so a bot that found NO spot left the
        // clock untouched and swept again on its very next decision -- for ever, since
        // a bot with no soil nearby never gets an order. Both review engines caught it
        // independently. The sweep is 72 candidate cells and now reads a 5-to-7 block
        // column for each survivor, so at 41 decisions/bot-hour x 80 bots that is
        // millions of blockAt calls an hour to answer a question whose answer has not
        // changed. Charging on the SCAN makes the worst case 6 sweeps/bot-hour, which
        // is what the cap was always supposed to mean.
        this.lastPlantedAt = Date.now()
        order = plantingOrder({ saplings: sap, spot,
                                now: Date.now(), lastPlantedAt: 0 })
        // THE SWEEP'S OWN RESULT. Without it "no trees appeared" has causes that cannot
        // be told apart: the arm is off, the cooldown never expired, there is no
        // plantable ground in reach, or the ground was fine and the tree never grew.
        // THE COORDINATE IS THE INSTRUMENT -- three hours later an RCON read of that
        // exact block says `oak_sapling` (never grew) or something else (it did), and
        // that is the only number that answers whether planting works. A new EVENT and
        // never a new field: the ELK templates are dynamic:strict and an unknown field
        // drops the whole document.
        logEvent({ kind: 'plant_spot',
                   detail: `${spot ? 'found' : 'none'} at=${spot ? `${spot.x},${spot.y},${spot.z}` : '-'} item=${best} sap=${Object.values(sap).reduce((a, b) => a + b, 0)} kinds=${Object.keys(sap).length} ordered=${order ? 1 : 0}`,
                   snapshot: snap })
      }
    }
    if (order) {
      // A COUNTER, because five changes shipped inert on this project in one
      // day and each was caught only by asking whether the branch had run.
      logEvent({ kind: 'work_order',
                 detail: `${order.skill} ${JSON.stringify(order.args)} — ${order.why}`,
                 snapshot: snap })
    }
    const res = order
      ? { schemaValid: true, latencyMs: 0, raw: null,
          proposal: { skill: order.skill, args: order.args, reason: order.why } }
      : await this.llm.decide({ system: this.system, user, sentinel, schema: this.schema })
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
    let runFailClass = null
    if (admitted) {
      log('info', `LLM -> ${admitted.skill}`, {
        args: admitted.args, reason: res.proposal.reason?.slice(0, 90), ms: res.latencyMs,
      })
      const r = await this.runner.run(admitted.skill, admitted.args, { trigger: `llm:${trigger}` })
      outcome = { status: r.status, detail: r.detail }
      runFailClass = r.failClass ?? null
      // A FAILED WEAR-OUT BACKS OFF (both reviews): a bot with no safe block (deepslate, a pillar, water) would
      // otherwise take a decision every cooldown, forever.
      if (admitted.skill === 'wear_out') this.wearOutBackoffUntil = r.status === 'failed' ? Date.now() + WEAR_OUT_BACKOFF_MS : 0
      // A TOWN ORDER THAT FAILED BACKS OFF; a skip (no_effect) or an interruption costs nothing (townOrderOutcome).
      if (TOWN_ORDERS.has(admitted.skill)) this.townState = townOrderOutcome(admitted.skill, r.status, Date.now(), this.townState ?? {}, r.failClass ?? null)
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
        // Housekeeping (wear_out, compost, build_composter) is never the model's choice, nor a "reliable choice" in its prompt.
        if (!isHousekeeping(admitted.skill)) this.lessons.recordSuccess(admitted.skill, admitted.args, r.contractEvidence)

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
      this.lastOutcome = formatOutcome(admitted.skill, r, outcome)
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
        // LATCHED: both rungs failed recently; the rejection itself is the
        // remedy until the rest expires (the model must propose something else).
        if (this.recoveryExhaustedAt) {
          // the terminal state lifts only when the bot is somewhere else
          const at = this.bot.entity?.position
          if (at && escapedFrom(this.recoveryExhaustedAt, { x: at.x, y: at.y, z: at.z, wet: !!this.bot.entity?.isInWater })) {
            this.recoveryExhaustedAt = null; this.livelockLatchedUntil = 0
          }
        }
        // THE BREAKER FIRES ON PHYSICAL FIXATION, NOT ON ARGUMENT ALONE (docs/livelock-fixation.md, 2026-09-13).
        const fx = livelockFixated(this.fixationSamples, { now: Date.now(), rejections: this.consecutiveRejections, repeatLoop: rejection?.reason === 'repeat_loop', reconnectAt: this.startedAt })
        if (!fx.fixated) {
          logEvent({ kind: 'livelock_not_fixated', status: 'no_effect', detail: `${fx.reason}: moved ${fx.moved ?? '?'} gained ${fx.gained ?? '?'} over ${fx.n} samples / ${Math.round((fx.span ?? 0) / 1000)} s (rejections ${this.consecutiveRejections}${rejection?.reason === 'repeat_loop' ? ', repeat_loop' : ''})`, snapshot: snapshot(this.bot) })
        } else if (!(this.livelockLatchedUntil > Date.now())) await this.#escape()
      }
    }
    if (admitted) this.consecutiveRejections = 0

    // Track whether this milestone is going anywhere at all.
    // Flush immediately. noteAttempt runs AFTER both save() calls above, so a
    // give-up was only written on some later cycle -- and a reconnect in that
    // window lost it, sending the bot back through 25 more attempts at a goal
    // it had already proven impossible.
    this.lessons.save()
    // THE IDLE GAP (milestones.mjs NO_PROGRESS_MS): only an executed decision that serves the task counts toward a
    // give-up. A rejection is not an attempt at the goal, and neither is exploring while the goal is a pickaxe.
    // The runner's own refusals never ran the skill (Claude review of f3bff3d: 22% of 'serving failures' on the fleet
    // were 'paused after repeated failures', and a paused give-up was even reported to peers).
    const executed = !!admitted && outcome.status !== 'aborted' && !RUNNER_REFUSALS.has(runFailClass)
    let serving = false
    try { serving = executed && servesRung(admitted.skill, admitted.args, milestone, this.#wantedItems(milestone)) } catch { serving = false }
    const overlay = /\+prereq$/.test(String(milestone?.id ?? ''))
    // HOUSEKEEPING IS NOT AN ATTEMPT AT THE GOAL (hygiene, Claude review): housekeeping neither resets nor feeds the give-up.
    if (!isHousekeeping(admitted?.skill) && this.milestones.noteAttempt({ failed: outcome.status !== 'success', executed, serving, overlay, taskId: milestone?.id ?? null })) {
      const sk = this.milestones.status()
      const why = this.milestones.lastSkip ?? {}
      log('warn', 'milestone unreachable, skipping', { now: sk.id, reason: why.reason })
      this.memory.addEvent(`gave up on the previous goal as unreachable; now: ${sk.describe}`)
      logEvent({ kind: 'milestone_skipped', status: 'failed',
                 detail: (why.reason === 'no_progress' ? `no serving progress in ${Math.round(NO_PROGRESS_MS / 60_000)} min`
                   : why.reason === 'residence' ? 'current for 3 h without being met'
                   : `${why.budget ?? 25} serving attempts failed`) + ` (skip #${why.skipCount ?? '?'} of ${why.id ?? '?'}); moved on to ${sk.id}`,
                 snapshot: snapshot(this.bot) })
      this.lessons.save()   // a give-up is rare and expensive to relearn
      // Tell the fleet. Two scouts each spent 25 attempts proving the SAME
      // goal unreachable tonight; the second one should not have had to.
      const gaveUp = this.milestones.skipped[this.milestones.skipped.length - 1]
      // A deadline give-up says nothing about the goal's reachability (Codex review): never tell peers.
      if (gaveUp && why.reason === 'attempts' && this.worldFacts?.reportUnreachable(gaveUp, config.bot.name, this.bot.entity?.position)) {
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
