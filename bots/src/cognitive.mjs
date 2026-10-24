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

import { exitDecision, townYieldOn, noteKeepout, siteKey, exitOutcome } from './keepout.mjs'
import { configuredHome } from './townground.mjs'
import { HARD_STOP } from './toolfor.mjs'
import { SKILLS, pickNeedOf, roomRemedy, farFromBank, classifyOutcome, SKILL_CONTRACTS, plantableSpotNear, findTownComposter, townBuildPlan, townPickMiss, townIngredientMiss, townKitIronMiss, foodSkipNow, townContainers, townWellState, townWellBuildPlan, insideTownWell, wellSwordsNow, cobbleWellCap, townPitState, stockWellOpts, valveProof, stockCountKeys, pruneTarget, unknownRefusals, stockRecountKeys, townCopperMiss, townIronMiss, townFurnaces, furnaceLeasedNow } from './skills.mjs'
import { disposePlan, wellOrder, wellOrderOutcome, WELL_ORDERS, pitCoverItem, wellVisitOrder } from './well.mjs'
// wellcare-01 fix 2 (its own statement): the well order's vertical reach and its held-order row
import { wellOutOfReach, wellDeepDetail } from './wellcare.mjs'
import { townWellStandY } from './skills.mjs'
const WELL_DEEP_ROW_MS = 5 * 60 * 1000
// junkout-01's three visit orders' skills (well.mjs wellVisitOrder, composter.mjs compostVisitOrder, towndeposit.mjs tailOrder)
const VISIT_SKILLS = ['dispose_well', 'compost', 'town_deposit']
// plinth-01, the raised junk well (its own statements)
import { plinthOrder, plinthOrderOutcome, plinthBudget, plinthShortfall, PLINTH_STEPS_PER_VISIT, PLINTH_MIN_FUND } from './plinth.mjs'
import { townPlinthState } from './skills.mjs'
import { smeltInputsFor } from './smelting.mjs'
import { makeClient, skillSchema } from './llm.mjs'
import { buildSystemPrompt, buildUserPrompt, makeSentinel, WorkingMemory } from './prompt.mjs'
import { AdmissionControl } from './admission.mjs'
import { MilestoneController, servesRung, NO_PROGRESS_MS, RUNNER_REFUSALS } from './milestones.mjs'
import { orderFor, readyFor, plantingOrder, plantingEnabled, PLANT_COOLDOWN_MS, roomOrder, roomOutcome, roomBackedOff, roomExclusions, lostLine, ROOM_WEAR_TRUST_MS } from './workorder.mjs'
import { wearOutPlan, isHousekeeping } from './hygiene.mjs'
import { compostPlan, townOrder, townOrderOutcome, boneMealRoom, composterLevel, TOWN_ORDERS, STORAGE_NEAR, TOWN_RADIUS, startableJunk, compostVisitOrder, compostVisitStacks, RUNNER_DECLINED } from './composter.mjs'
import { roomPlan, pickTakes, roomKeep } from './withdrawpick.mjs'
import { toolkitOrder, toolkitOutcome, kitRoomTakes, withdrawDefersToKit } from './toolkit.mjs'
// FOUNDING (found-01): the found slot's decision and readings
import { FOUND, foundOrder, foundIssued, foundVisit, foundAssign, foundRetry } from './found.mjs'
import { townPlanNow, townPlanHead, townPlanZones, foundTownContainer, foundCellReady, foundLeaseFree, foundBankGroups, foundCraftFits, foundAssignHome } from './skills.mjs'
import { townDepositOrder, townDepositOutcome, townDepositPlan, tailOrder, inTownZone, TD_STAY_REARM_MS } from './towndeposit.mjs'
// junkout-01 (its own statement): the visit latch, ticked on every decision (bagallowance.mjs, a leaf)
import { visitLatchTick, visitLatchDeclined, VISIT_STAY_MS } from './bagallowance.mjs'
import { pruneOrder, pruneOutcome } from './prune.mjs'
import { smeltJobEnabled, smeltTownOrder, smeltTownOutcome, drainOrder, drainOutcome, drainPick, noteFurnacesLit, milestoneHolds } from './smeltjob.mjs'
import { recountOrder, recountOutcome } from './recount.mjs'
import { bankClosed, inTown } from './chestfull.mjs'
import { redundantRow, admitRow, HYGIENE_ITEMS } from './toolhygiene.mjs'
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
import { runnerDeclined } from './declined.mjs'
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
 * THE DECLINED ORDER'S REFUND -> the state fields to assign (pure; homefix-01, Codex code r1 P2). The four deterministic
 * orders that charge their cooldown at issue and have no decline-aware outcome handler of their own.
 */
export function refundDeclined (skill, st = {}) {
  const at = { prune_town: ['pruneState', 'lastIssuedAt'], smelt_town: ['smeltJobState', 'lastIssuedAt'],
               furnace_drain: ['drainState', 'lastIssuedAt'], build_plinth: ['plinthState', 'lastAt'] }[skill]
  // found-01: found_store / found_work charge the cooldown AND the visit at issue (found.mjs foundIssued); a declined run refunds both
  // ...the cooldown goes back to the one before this order (foundIssued keeps it as prevLastAt: Claude code r9 P3), else none
  if ((skill === 'found_store' || skill === 'found_work') && st.foundState) return { foundState: { ...st.foundState, lastAt: 'prevLastAt' in st.foundState ? st.foundState.prevLastAt : -Infinity, visitUsed: false } }
  if (!at || !st[at[0]]) return {}
  return { [at[0]]: { ...st[at[0]], [at[1]]: -Infinity } }
}

/**
 * JUNKOUT-01'S TOWN-VISIT ORDERS YIELD TO THESE (pure): the order in hand keeps the decision and the visit is ticked only
 * (never issued: issuing latches the visit and charges the well's / composter's / tail's cooldown). The full-bag town
 * deposit, the plinth build and the recount (junkout-01's own list), and -- JUNKOUT-01 x FOUND-01 (JIT 10-24) -- the found
 * slot: found_store / found_work charge their visit and 10-min cooldown when they ISSUE, so a visit that replaced one spent
 * the found slot on an order that never ran (the recount already yields to it for the same reason). The visit comes on a
 * later decision of the same stay.
 */
export const VISIT_YIELDS_TO = new Set(['town_deposit', 'build_plinth', 'count_town', 'found_store', 'found_work'])
export function visitYieldsTo (order) { return !!order && VISIT_YIELDS_TO.has(order.skill) }

/**
 * JUNKOUT-01 x KEEPOUT-01 (jit-1023) -> the state fields to assign (pure). A junkout visit order the keep-out exit
 * DISPLACED never ran: the visit is not spent (the latch re-arms with the reason that armed it, as a decline does:
 * visitLatchDeclined) and everything its issue charged is given back -- the visit's scan cadence, the tail's own cooldown,
 * the well's / composter's cooldown (the order could only issue with each of them clear) -- so the visit can issue on the
 * first decision out of the column. Any other order: {}.
 */
export function visitDisplacedRefund (order, st = {}) {
  const unspend = v => ({ ...visitLatchDeclined(v ?? {}), lastScanAt: -Infinity })
  if (order?.skill === 'dispose_well' && order.args?.visit === true) {
    return { wellVisitState: unspend(st.wellVisitState), wellState: { ...(st.wellState ?? {}), lastDisposeAt: -Infinity } }
  }
  if (order?.skill === 'compost' && order.args?.visit === true) {
    return { compostVisitState: unspend(st.compostVisitState), townState: { ...(st.townState ?? {}), lastCompostAt: -Infinity } }
  }
  if (order?.skill === 'town_deposit' && order.args?.tail === true) return { tailState: { ...unspend(st.tailState), lastIssuedAt: -Infinity } }
  return {}
}

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
export function livelockNext ({ rung, escaped, declined = false }) {
  if (escaped) return 'done'                      // the shared postcondition, nothing weaker (Codex pass 3)
  // A RUNG THE RUNNER DECLINED NEVER RAN (homefix-01, declined.mjs: e.g. `runner_reserved` while the watchdog's rescue
  // takes the runner): it is not "did not escape". Retry on a later tick; never the dig rung, never a latch.
  if (declined) return 'retry'
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
  //
  // `air_pocket` (airpocket-01): the drowning rescue's dig step interrupts any skill that starts while it digs. Waking a
  // decision on that interrupt would start another skill for the step to interrupt again -- decision churn inside a
  // ~15-30 s dig. The rescue's own release (or its `drowning` trigger) wakes cognition when the step is over.
  static TRIGGER_SUPPRESSED = new Set(['user_stop', 'air_pocket'])

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
    const walked = await this.runner.run('goto', { x, y: Math.round(p.y), z }, { trigger: 'livelock_escape' })
    let rung = 'walk', moved = movedNow(), next = livelockNext({ rung, escaped: escapedFrom(from, here()), declined: runnerDeclined(walked) })
    if (next === 'retry') return this.#escapeDeclined(walked)
    // THE RESERVE IS ENFORCED BEFORE THE RUNG, not reported after it: a bot
    // holding fewer blocks than the entombment climb needs does not get to
    // bridge with them (Codex pass 2).
    if (next === 'dig' && typeof this.bot.withAscentMovements === 'function' && blocksBefore >= LIVELOCK_BLOCK_RESERVE) {
      rung = 'dig'
      let dug = null
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
          try { dug = await this.runner.run('goto', { x, y: Math.round(p.y), z }, { trigger: 'livelock_escape_dig' }); return dug }
          finally { if (m && typeof orig === 'function') m.countScaffoldingItems = orig }
        })
      } finally { clearInterval(watch) }
      moved = movedNow(); next = livelockNext({ rung, escaped: escapedFrom(from, here()), declined: runnerDeclined(dug) })
      if (next === 'retry') return this.#escapeDeclined(dug)
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

  /** A livelock rung the runner declined (homefix-01): nothing is latched, cleared or counted; the next tick retries. */
  #escapeDeclined (r) {
    logEvent({ kind: 'livelock_escape', status: 'no_effect',
               detail: `fixated on one action; the relocation was declined by the runner (${r?.failClass ?? '?'}) -- not an attempt, retried next tick`,
               snapshot: snapshot(this.bot) })
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

  /**
   * THE TOWN DEPOSIT ORDER, or null (towndeposit.mjs townDepositOrder decides; this supplies readings and keeps the
   * state). The plan keeps the active rung's wants, handed to the skill through the bot like admission's currentWants.
   * Every read is guarded: a town deposit must never cost the bot its decision.
   */
  #recountOrder() {
    try {
      const bot = this.bot
      const items = bot.inventory?.items?.() ?? []
      const home = { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ }
      const r = recountOrder({ now: Date.now(), atTown: inTown(home, bot.entity?.position), unknownRefused: () => unknownRefusals(bot, items),
        keys: () => stockRecountKeys(bot, items), state: this.recountState ?? {} })
      this.recountState = r.state
      return r.order
    } catch { return null }
  }

  // `dry` (ironpick-01): the same decision with its state NOT kept -- withdraw_pick asks whether the kit would make the iron
  // pickaxe now (toolkit.mjs withdrawDefersToKit); a dry run never charges the cooldown
  #toolkitOrder({ dry = false } = {}) {
    try {
      const bot = this.bot
      const items = bot.inventory?.items?.() ?? []
      const home = { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ }
      const keep = [...roomKeep(bot.currentWants ?? []), 'iron_ingot']
      const r = toolkitOrder({
        now: Date.now(), atTown: inTown(home, bot.entity?.position), items, credit: bot.kitCredit ?? 0,
        container: () => townContainers(bot).length > 0,
        townMiss: d => townKitIronMiss(bot, d),
        // the bag can take the draw -- and, ironpick-01, the tools its crafts make (toolkit.mjs kitRoomTakes): the same room plan
        // and keep as at the chest (withdrawpick roomPlan)
        room: d => roomPlan(items, kitRoomTakes(d), { keep }).ok,
        tableNear: () => !!bot.findBlock?.({ matching: b => bot.registry?.blocks?.[b.type]?.name === 'crafting_table', maxDistance: 32 }),
        state: this.toolkitState ?? {},
      })
      if (!dry) this.toolkitState = r.state
      return r.order
    } catch { return null }   // an inventory or world read must never break the decision loop
  }

  #townDepositOrder(milestone, { dry = false } = {}) {
    try {
      const bot = this.bot
      const items = bot.inventory?.items?.() ?? []
      let wanted = null
      const plan = () => {
        wanted = [...(this.#wantedItems(milestone) ?? [])]
        const noSwords = foodSkipNow(bot).active   // the peaceful kit: the switch, read here
        const p = townDepositPlan(items, { wanted, noSwords })
        if (p.freed >= 1) return p
        // THE VALVE (stocktarget design 3.2): only with the PROOF that nothing else at town frees a slot -- no well-able stack,
        // nothing compostable -- one spare tool copy may go in above the town's tool target
        return valveProof(bot, items) ? townDepositPlan(items, { wanted, noSwords, valve: true }) : p
      }
      const r = townDepositOrder({
        // the count step (stocktarget design 3.7): targeted surplus the town cannot judge yet, and a container to count
        count: () => stockCountKeys(bot, items, { floor: true }).length > 0,
        now: Date.now(), slots: items.length, pos: bot.entity?.position ?? null,
        home: { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ },
        // A CLOSED BANK (chestfull.mjs bankClosed) is not a town chest to bank into: the deposit's own closure, respected.
        plan, container: () => !bankClosed(bot) && townContainers(bot).length > 0,
        // DRY (found-01's slot asks whether the deposit WOULD issue now): its state copied, the 30 s scan throttle ignored, kept nowhere
        state: dry ? { ...(this.townDepositState ?? {}), lastScanAt: -Infinity } : this.townDepositState ?? {},
      })
      if (dry) return r.order
      this.townDepositState = r.state
      if (r.order) bot.townDepositWanted = wanted ?? []
      return r.order
    } catch { return null }
  }

  /** THE FOUND SLOT (found-01; found.mjs foundOrder decides, this supplies the readings and keeps the per-bot state) -> an order or
   *  null. Only in town, only with a plan of this world; the visit and the 10-min cooldown are charged when an order is issued. */
  #foundOrder(milestone) {
    try {
      const bot = this.bot
      if (!FOUND.on) return null
      const p = bot.entity?.position
      const home = { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ }
      const inT = !!p && inTown(home, p)
      this.foundState = foundVisit(this.foundState ?? {}, inT)
      if (!inT) return null
      // THE HEAD READ FRESH for this decision (Paper FOUND-RETRO 10-22: a bot that decided from its 30-s-old cached head took the
      // lease the moment another bot released it, crafted a spare table for a station that bot had just filled, and spent its
      // visit on lost_reservation). One directory read per in-town decision; the walk continues incrementally.
      try { townPlanHead(bot) } catch { /* the cached head serves */ }
      const tp = townPlanNow(bot)
      if (!tp) return null
      const items = bot.inventory?.items?.() ?? []
      const wanted = [...(this.#wantedItems(milestone) ?? [])]
      const bankGroups = foundBankGroups(bot, wanted)
      // a homeless group takes an unassigned container first: a plan-only publish (no skill, no cooldown, no visit)
      const as = foundAssign({ plan: tp.plan, bankGroups })
      if (as) foundAssignHome(bot, as.at, as.group)
      const tp2 = townPlanNow(bot) ?? tp
      const r = foundOrder({
        plan: tp2.plan, zonesKnown: townPlanZones(bot).known, items,
        wanted: Object.fromEntries(wanted.filter(n => typeof n === 'string').map(n => [n, 64])),
        townContainer: foundTownContainer(bot), ready: cell => foundCellReady(bot, cell), leaseFree: foundLeaseFree(bot),
        depositWouldIssue: !!this.#townDepositOrder(milestone, { dry: true }),
        bankGroups, craftFits: item => foundCraftFits(bot, item),
        state: this.foundState, now: Date.now(),
      })
      if (!r.order) return null
      this.foundState = foundIssued(this.foundState, Date.now())
      return r.order
    } catch { return null }
  }

  /**
   * THE TOWN-VISIT ORDERS (junkout-01; design docs/reports/junkout-01-design-2026-10-21.md section 3): the junk well, the
   * composter and the bag allowance's tail, ONCE EACH PER VISIT, below 34 slots, in the town deposit's zone. The three
   * latches are TICKED HERE ON EVERY DECISION (Codex design r1 P1-1: a latch updated only when its order gets a turn misses
   * the departures it re-arms on); the first order that issues wins this decision. Every read is lazy and guarded.
   */
  #visitOrder(milestone, { tickOnly = false } = {}) {
    try {
      const bot = this.bot
      const now = Date.now()
      const p = bot.entity?.position ?? null
      const home = { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ }
      const inZone = !!p && inTownZone(p, home)
      this.wellVisitState = visitLatchTick(this.wellVisitState ?? {}, { now, atTown: inZone, stayMs: VISIT_STAY_MS })
      this.compostVisitState = visitLatchTick(this.compostVisitState ?? {}, { now, atTown: inZone, stayMs: VISIT_STAY_MS })
      this.tailState = visitLatchTick(this.tailState ?? {}, { now, atTown: inZone, stayMs: TD_STAY_REARM_MS })
      if (!inZone || tickOnly) return null
      const items = bot.inventory?.items?.() ?? []
      const distHome = Math.hypot(home.x - p.x, home.z - p.z), dy = p.y - home.y
      let wanted = null
      const wantedNow = () => (wanted ??= [...(this.#wantedItems(milestone) ?? [])])
      // THE WELL: listed junk only, never a name the goal wants (Claude design r1 P3-6), near the well (VISIT_WELL_REACH)
      let w = null
      const well = () => (w ??= townWellState(bot))
      const rw = wellVisitOrder({
        now, slots: items.length, inZone, distHome, dy,
        visitJunkStacks: () => disposePlan(items, { keep: wantedNow() }).junkStacks,
        well, distWell: () => { const c = well()?.cap; return c ? Math.hypot(c.x + 0.5 - p.x, c.z + 0.5 - p.z) : null },
        inside: () => insideTownWell(bot), keep: wantedNow,
        depth: skill => wellOutOfReach({ feetY: p.y, standY: townWellStandY(bot, skill) ?? config.world.homeY }),
        state: this.wellVisitState, wellState: this.wellState ?? {}, myName: bot.username ?? '',
      })
      this.wellVisitState = rw.state
      if (rw.order) { this.wellState = { ...(this.wellState ?? {}), lastDisposeAt: now }; return rw.order }
      // THE COMPOSTER: compost junk and the peaceful plants, never a sapling (Claude design r1 P2-5)
      const peaceful = foodSkipNow(bot).active
      const rc = compostVisitOrder({
        now, slots: items.length, inZone, distHome, dy,
        visitStacks: () => compostVisitStacks(items, { apples: peaceful, plants: peaceful }),
        storageNear: () => !!bot.findBlock?.({ matching: b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry?.blocks?.[b.type]?.name), maxDistance: STORAGE_NEAR }),
        distComposter: () => { const c = findTownComposter(bot)?.position; return c ? Math.hypot(c.x + 0.5 - p.x, c.z + 0.5 - p.z) : null },
        state: this.compostVisitState, townState: this.townState ?? {}, myName: bot.username ?? '',
      })
      this.compostVisitState = rc.state
      if (rc.order) { this.townState = { ...(this.townState ?? {}), lastCompostAt: now }; return rc.order }
      // THE BAG ALLOWANCE'S TAIL: the rows only, into a town container in reach
      const noSwords = foodSkipNow(bot).active
      const rt = tailOrder({
        now, slots: items.length, pos: p, home,
        plan: () => townDepositPlan(items, { wanted: wantedNow(), noSwords, tail: 'only' }),
        container: () => !bankClosed(bot) && townContainers(bot).length > 0,
        state: this.tailState, myName: bot.username ?? '',
      })
      this.tailState = rt.state
      if (rt.order) { bot.townDepositWanted = wantedNow(); return rt.order }
      return null
    } catch { return null }   // an inventory or world read must never break the decision loop
  }

  /** THE RAISED JUNK WELL ORDER, or null (plinth.mjs plinthOrder decides; every read is lazy and guarded). */
  #plinthOrder() {
    try {
      const bot = this.bot
      const items = bot.inventory?.items?.() ?? []
      const p = bot.entity?.position
      let st = null
      const town = () => (st ??= townPlinthState(bot))
      const r = plinthOrder({
        now: Date.now(), distHome: p ? Math.hypot(config.world.homeX - p.x, config.world.homeZ - p.z) : Infinity,
        dy: p ? p.y - config.world.homeY : Infinity,   // plinth-02.1: never from a mine below the town
        inside: () => insideTownWell(bot), want: () => town().want, lease: () => town().lease,
        budget: () => plinthBudget(items, PLINTH_STEPS_PER_VISIT), freeSlots: 36 - items.length,
        chests: () => townContainers(bot).length > 0, chestSlots: () => Math.max(1, Math.ceil(plinthShortfall(items, PLINTH_MIN_FUND) / 64)),
        state: this.plinthState ?? {},
      })
      this.plinthState = r.state
      return r.order
    } catch { return null }
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

  /**
   * THE REMEDY FOR A WITHHELD CRAFT (orderroom-01) -> { kind, item, text }: skills.mjs roomRemedy with every kind left
   * out that is backing off (roomState) or that the gate's memory would refuse (AdmissionControl.memoryRefuses: cooldown,
   * learned failures, a full repeat window) -- so the next remedy, or the model, takes the turn instead of a refused order.
   */
  #roomRemedy(noRoom) {
    try {
      const now = Date.now()
      const memory = {}
      for (const kind of ['eat', 'deposit', 'home']) memory[kind] = this.admission.memoryRefuses(kind, {}, now)
      const exclude = roomExclusions({ backedOff: roomBackedOff(this.roomState ?? {}, now), memory })
      // the well's own dispose backoff (well.mjs wellOrderOutcome): a walk to a well that is backing off would find nothing
      if (now < (this.wellState?.disposeBackoffUntil ?? 0)) exclude.add('home_well')
      const r = roomRemedy(this.bot, this.bot.inventory?.items?.() ?? [], noRoom.keep ?? [], { exclude })
      // A PAUSED REMEDY IS NOT "NOTHING CAN BE FREED" (Claude r2): say which is waiting, so the prompt does not lie.
      // Only the remedies that make room from anywhere (deposit, home): an excluded `eat` with no single food would not
      // have applied anyway (Claude r3).
      const paused = [...exclude].filter(k => k === 'deposit' || k === 'home').sort()
      if (r?.kind === 'none' && paused.length) return { ...r, text: `free a slot first -- ${paused.join('/')} paused (backing off or refused recently); keep working and craft later` }
      return r
    } catch { return null }
  }

  /** KEEPOUT-01: exitDecision's answer for `order` -- the readings only, no counters (jit-1023: the visit orders ask it too). */
  #keepoutExitDecision(order) {
    const bot = this.bot
    const sites = bot.fireSitesNow?.() ?? []
    if (!sites.length || !bot.entity?.position) return null
    return exitDecision({ sites, pos: bot.entity.position, home: configuredHome(config.world), skill: order?.skill ?? null,
      yielded: s => !!bot.keepoutYields?.(s), yieldOn: townYieldOn(process.env), backoffUntil: this.keepoutExitBackoffUntil ?? 0 })
  }

  /** KEEPOUT-01: the `_keepout_exit` order, or null (keepout.mjs exitDecision decides; this supplies readings). */
  #keepoutExitOrder(order) {
    try {
      const bot = this.bot
      const d = this.#keepoutExitDecision(order)
      if (!d) return null
      // a yield is counted when it STARTS (Claude r1 P3-7), not on every tick it holds
      const yk = d.why === 'town_job' || d.why === 'home' ? `${d.why}@${siteKey(d.site)}` : null
      if (yk && yk !== this.keepoutYieldKey) noteKeepout(bot, d.why === 'home' ? 'yield_home' : 'yield_town_job')
      this.keepoutYieldKey = yk
      if (!d.start) return null
      return { skill: 'keepout_exit', args: {}, why: `inside the column above a marked lava pool (fire death site ${siteKey(d.site)}): leaving it first${order ? ` (instead of ${order.skill})` : ''}` }
    } catch { return null }
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
    // NO CRAFT ORDER WITHOUT ROOM (orderroom-01; workorder.mjs readyFor, skills.mjs craftRoomCheck): computed BEFORE the
    // prompt, so the prompt stops advertising a craft the bag cannot hold and names the remedy instead.
    const ready = readyFor(this.bot, milestone, { wearFailedRecently: Date.now() - (this.roomWearFailAt?.[milestone?.wants] ?? -Infinity) < ROOM_WEAR_TRUST_MS })
    const room = ready.noRoom ? this.#roomRemedy(ready.noRoom) : null
    const { user, tokens, dropped, affordance } = buildUserPrompt({
      bot: this.bot, milestone, memory: this.memory, wanted: this.#wantedItems(milestone),
      lastOutcome: this.lastOutcome, trigger, sentinel,
      noRoom: ready.noRoom ? { item: ready.noRoom.item, short: ready.noRoom.short, text: room?.text ?? null } : null,
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
    let order = orderFor(ready)
    // THE CRAFT'S OWN MAKE-ROOM ROUTE IS NAMED on the order (Claude r2), so the read can tell a designed wear-out attempt
    // from a craft issued into a bag without room.
    // ...and when the check could not say (unknown route, a pickup-only shortage): the read counts those apart too.
    if (order?.skill === 'craft' && (ready.roomVia === 'wear' || ready.roomVia === 'unknown')) order = { ...order, why: `${order.why} (room via ${ready.roomVia})` }
    // THE TOWN DEPOSIT GOES FIRST (towndeposit.mjs; owner 10-05 "add automatic town deposit"): a bag at 34+ at town
    // banks its surplus before other work. AHEAD of the milestone order on purpose: a craft-ready rung re-issues its
    // craft every decision, craftroom refuses it at 36/36, and an order placed after it would never get a turn
    // (test/towndeposit.test.mjs CHAIN drives this through the real loop).
    // THE RAISED JUNK WELL GOES BEFORE THE DEPOSIT (plinth.mjs plinthOrder; design 3.4): at town, a funded bot's surplus
    // stone builds the town's well before any of it is banked; one builder per town (the lease), on its own cooldown.
    // FOUNDING (found-01, found.mjs foundOrder): the found slot between the raised well and the town deposit -- a town's first
    // chest (the deposit can bank nothing without one), its workshop table and furnace, a homeless group's chest; it yields to a
    // deposit that would issue now except for an F3 with a carried chest (build spec 2.1)
    order = this.#plinthOrder() ?? this.#foundOrder(milestone) ?? this.#townDepositOrder(milestone) ?? order
    // THE TOWN RECOUNT (stocktarget-02, recount.mjs): at town, holding what a plan refuses as NOT YET COUNTED, the town's
    // reachable unknown containers are counted now -- whatever the bag's size (the 34-slot town deposit left hive-a and
    // placebo-a uncounted for hours after the clear). Ahead of the milestone order like the town deposit: a craft-ready
    // rung re-issues every decision and would starve it. The town deposit and the plinth build keep their turn (both are
    // bounded and on their own cooldowns; the recount comes on the next decision).
    if (!order || (order.skill !== 'town_deposit' && order.skill !== 'build_plinth' && order.skill !== 'found_store' && order.skill !== 'found_work')) order = this.#recountOrder() ?? order
    // THE TOWN-VISIT ORDERS (junkout-01): after the plinth build, the full-bag town deposit and the recount, AHEAD of the
    // milestone's work order (Codex design r1 P1-1: a craft-ready rung re-issues every decision and would hold the cleanup off
    // the whole visit) -- bounded: one well, one compost and one tail run per visit, each on its own cooldown. The latches
    // are ticked on every decision, whatever wins it.
    {
      // code r1 (both engines): an order that cannot win this decision is never ISSUED (issuing latches the visit and charges
      // the well's / composter's cooldown) -- the latches are only ticked
      // JUNKOUT-01 x KEEPOUT-01 (jit-1023, Codex rebase review P2): nor while the keep-out exit would replace it -- the exit is
      // LAST in the chain and overrides any order, so a visit issued now would spend its latch and the well's / composter's
      // cooldown on a run that never happens. Asked for ONE visit skill: all three are TOWN_JOB_SKILLS, so exitDecision answers
      // the same for each (a yielded C12 column lets them run). Ticked only: the latch stays armed, and the visit issues on the
      // first decision outside. The exit's own call below refunds a visit it displaces anyway (visitDisplacedRefund).
      const exitFirst = () => { try { return this.#keepoutExitDecision({ skill: VISIT_SKILLS[0] })?.start === true } catch { return false } }
      // JUNKOUT-01 x FOUND-01 (JIT 10-24): the found slot is one of the orders the visit yields to (visitYieldsTo)
      const blocked = visitYieldsTo(order) || exitFirst()
      const visit = this.#visitOrder(milestone, { tickOnly: blocked })
      if (visit) order = visit
    }
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
          // the real surplus after every reserve, and only when a fill can start (composter.mjs startableJunk; owner 10-07)
          now: Date.now(), slots: plan.slots, freeSlots: 36 - plan.slots, junk: startableJunk(items, { apples: peaceful, plants: peaceful, level: () => (p && Math.hypot(home.x - p.x, home.z - p.z) <= TOWN_RADIUS ? composterLevel(findTownComposter(bot)) : 0) }),
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
          // since townsearch-02: no pickaxe that can pay an ore trip (skills.mjs pickNeedOf: oretunnel hasTripPickaxe's line)
          pickNeeded: pickNeedOf(items) != null,
          // ironpick-01: NO DOUBLE TRIP -- while the kit would make an iron pickaxe now (its dry run), withdraw_pick does not
          // also fetch a stone copy for the same need; asked only when the withdraw branch is otherwise ready (lazy)
          pickDefer: () => withdrawDefersToKit(pickNeedOf(items), this.#toolkitOrder({ dry: true }), items),
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
    // THE JUNK WELL'S TOWN ORDERS (well.mjs wellOrder decides; this supplies readings and keeps the state): close an open
    // well nobody is at, dispose listed junk at 34+ slots, or build the well. After the composter: it takes what composts.
    if (!order) {
      try {
        const bot = this.bot
        const items = bot.inventory?.items?.() ?? []
        const p = bot.entity?.position
        const home = { x: config.world.homeX, z: config.world.homeZ }
        const distHome = p ? Math.hypot(home.x - p.x, home.z - p.z) : Infinity
        // the town's cobble is read only AT TOWN, where a well order can be given at all (Claude coupling review P3: the cap
        // read on every decision anywhere in the world was a hot-path cost)
        const atTown = distHome <= TOWN_RADIUS
        // ...and at town every targeted group at its target (stocktarget design 3.4: the available floor, the keeps)
        const plan = disposePlan(items, { swords: wellSwordsNow(bot), cobbleAtCap: atTown && cobbleWellCap(bot, items) === 'at_cap', stock: atTown ? stockWellOpts(bot, items) : null })   // a peaceful world's swords count (well.mjs swordGoes)
        const buildPlanJunk = disposePlan(items)   // the pit-first build tosses neither cobble nor swords (Claude coupling review P3)
        const r = wellOrder({
          now: Date.now(), slots: plan.slots, freeSlots: 36 - plan.slots, junkStacks: plan.junkStacks, buildJunkStacks: buildPlanJunk.junkStacks,
          distHome,
          well: () => townWellState(bot),
          // NO COVER BLOCK, NO BUILD ORDER (Claude r2 P3): the build would only skip no_cover every cooldown
          buildPlan: () => (pitCoverItem(items) ? townWellBuildPlan(bot) : null),
          pit: () => townPitState(bot),
          inside: () => insideTownWell(bot),
          myName: bot.username ?? '',
          peers: () => Object.values(bot.players ?? {}).filter(q => q?.username && q.username !== bot.username && q.entity?.position &&
            Math.hypot(q.entity.position.x - home.x, q.entity.position.z - home.z) <= TOWN_RADIUS).map(q => q.username),
          // wellcare-01 fix 2: not from deep under the stand (wellcare.mjs wellOutOfReach); home's y when the town knows no stand
          depth: skill => wellOutOfReach({ feetY: p?.y, standY: townWellStandY(bot, skill) ?? config.world.homeY }),
          state: this.wellState ?? {},
        })
        this.wellState = r.state
        if (r.order) order = r.order
        // THE HELD ORDER IS SAID (the read's guard row; one per bot per order kind per 5 min), with the bot's own remedy.
        // HELD, NOT REPLACED (r5, after Claude r2 P2-1/P2-2 and Codex r3 P2 on the scheduler climb): a scheduler `surface`
        // overshoots stands below 63, cannot reach stands above 75, and its shaft dig does not read the well's cells -- a new
        // movement on the scheduler's behalf for a gain the base data does not show (wellcare.mjs wellDeepRemedy).
        if (r.held && Date.now() - (this.wellDeepLoggedAt?.[r.held.skill] ?? -Infinity) >= WELL_DEEP_ROW_MS) {
          this.wellDeepLoggedAt = { ...(this.wellDeepLoggedAt ?? {}), [r.held.skill]: Date.now() }
          logEvent({ kind: 'well_deep', status: 'refused', snapshot: snapshot(bot), detail: wellDeepDetail(r.held) })
        }
      } catch { /* an inventory or world read must never break the decision loop */ }
    }
    // CHEST PRUNING (stocktarget-01, prune.mjs): after the well's orders, at town with room in the bag and a usable well,
    // over-target full stacks from a town chest go down the well. Never a trip, never the model's choice.
    if (!order) {
      try {
        const bot = this.bot
        const items = bot.inventory?.items?.() ?? []
        const p = bot.entity?.position
        const home = { x: config.world.homeX, z: config.world.homeZ }
        const r = pruneOrder({ now: Date.now(), atTown: !!p && Math.hypot(home.x - p.x, home.z - p.z) <= TOWN_RADIUS, freeSlots: 36 - items.length,
          wellUsable: () => { const w = townWellState(bot); return !!w && !w.breached }, pick: () => pruneTarget(bot, items), state: this.pruneState ?? {} })
        this.pruneState = r.state
        if (r.order) order = r.order
      } catch { /* an inventory or world read must never break the decision loop */ }
    }
    // THE ROOM ORDER (orderroom-01): the rung craft was withheld for no room, nothing above freed a slot this tick (the
    // town deposit, wear_out, the town orders, the junk well and chest pruning all run first), so the remedy the craft would have named is the order.
    let roomIssued = null, roomBefore = null
    if (ready.noRoom) {
      try {
        const items = this.bot.inventory?.items?.() ?? []
        const n = ready.noRoom
        this.noRoomLoggedAt ??= {}
        if (Date.now() - (this.noRoomLoggedAt[n.item] ?? -Infinity) >= 5 * 60 * 1000) {
          this.noRoomLoggedAt[n.item] = Date.now()
          logEvent({ kind: 'craft_noroom', status: 'no_effect',
                     detail: `item=${n.item} short=${n.short} slots=${items.length} route=${n.route ?? '?'} remedy=${room?.kind ?? '?'} target=${room?.item ?? '-'} order=${order ? order.skill : '-'}`,
                     snapshot: snap })
        }
        if (!order) {
          const r = roomOrder({ noRoom: n, remedy: room, now: Date.now(), state: this.roomState ?? {}, slots: items.length })
          this.roomState = r.state
          if (r.order) {
            order = r.order; roomIssued = r.order.room
            roomBefore = {}
            for (const it of items) roomBefore[it.name] = (roomBefore[it.name] ?? 0) + (it.count ?? 0)
          }
        }
      } catch { /* a world read must never break the decision loop */ }
    }
    // THE TOOLKIT (toolkit-01, toolkit.mjs): at town with no usable iron axe / iron shovel, the town's iron makes them.
    // LAST of the town orders: every one above -- the milestone's work order and its room order included -- goes first, so a
    // ready milestone step is never displaced. AHEAD of the town smelt job and the furnace drain (smeltjob-01), which run only
    // with nothing chosen above (their tally counts a toolkit decision as `taken`): the kit is a bounded once-per-bot need
    // (no order once both tools are held), the smelt job a repeating one. Only planting and the model come after them.
    if (!order) order = this.#toolkitOrder()
    // THE TOWN SMELT JOB AND THE FURNACE DRAIN (smeltjob-01; smeltjob.mjs decides, this supplies readings and keeps the
    // state). After every deterministic order but sapling planting, and only with NOTHING chosen above -- the milestone's
    // own work order, the town deposit, every town order -- AND no rung waiting on room (ready.noRoom): a ready milestone
    // step always wins (owner 10-15). Planting (below) is no milestone step: a job decision only moves it to the next free
    // decision, its cooldown untouched (Codex rebase review P3). Never a trip: at town only (TOWN_RADIUS). Off in isolated pools (owner D2) and by SMELT_JOB=0.
    {
      const bot = this.bot
      const p = bot.entity?.position
      const home = { x: config.world.homeX, z: config.world.homeZ }
      const atTown = !!p && Math.hypot(home.x - p.x, home.z - p.z) <= TOWN_RADIUS
      const sw = smeltJobEnabled(process.env, config.memory.scope)
      // THE DENOMINATOR (Codex code r1 P2-8): every at-town decision of a bot whose job is on is tallied by what happened
      // to the job's slot -- `taken` (an order above won it), or the job's own issue / skip reason -- BEFORE any cooldown
      // or throttle, and flushed as one `_smelt_job_tally` row per 10 min: the free-decision share and the decisions
      // "eligible but for room" are read from it.
      const tally = what => {
        if (!atTown || !sw.on) return
        const now = Date.now()
        this.smeltTally ??= { t0: now, c: {} }
        this.smeltTally.c[what] = (this.smeltTally.c[what] ?? 0) + 1
        if (now - this.smeltTally.t0 >= 10 * 60 * 1000) {
          const c = this.smeltTally.c
          try { logEvent({ kind: 'smelt_job_tally', status: 'success', detail: `secs=${Math.round((now - this.smeltTally.t0) / 1000)} ` + Object.entries(c).sort().map(([k, v]) => `${k}=${v}`).join(' '), snapshot: snap }) } catch { /* telemetry only */ }
          this.smeltTally = { t0: now, c: {} }
        }
      }
      if (order) tally('taken')
      else {
        try {
          const items = bot.inventory?.items?.() ?? []
          const holds = milestoneHolds({ order, ready })
          const held = {}
          for (const it of items) held[it.name] = (held[it.name] ?? 0) + (it.count ?? 0)
          const free = 36 - items.length
          const r = smeltTownOrder({ now: Date.now(), on: sw.on, atTown, holds, held, freeSlots: free,
            townMiss: () => townCopperMiss(bot), ironMiss: () => townIronMiss(bot), state: this.smeltJobState ?? {} })   // ironsmelt-01: iron first
          this.smeltJobState = r.state
          tally(r.order ? 'issued' : r.skip)
          if (r.order) order = r.order
          else {
            const d = drainOrder({ now: Date.now(), on: sw.on, atTown, holds, freeSlots: free,
              pick: () => {
                const fs = townFurnaces(bot)
                bot.furnaceSeen = noteFurnacesLit(bot.furnaceSeen ?? {}, fs)
                return drainPick({ furnaces: fs, leased: k => furnaceLeasedNow(k), seen: bot.furnaceSeen, now: Date.now() })
              },
              state: this.drainState ?? {} })
            this.drainState = d.state
            if (d.order) { order = d.order; tally('+drain_issued') }   // '+': an extra counter, not a decision bucket (Codex code r2)
            // why the job did not run, at most once per 10 min per reason, only for the reasons that say something about
            // the town (room, no copper, nothing to drain) -- never the every-decision ones
            const why = r.skip === 'room' || r.skip === 'town_has_none' ? r.skip : (d.skip === 'nothing_to_drain' ? 'nothing_to_drain' : null)
            this.smeltSkipAt ??= {}
            if (atTown && sw.on && why && Date.now() - (this.smeltSkipAt[why] ?? -Infinity) >= 10 * 60 * 1000) {
              this.smeltSkipAt[why] = Date.now()
              logEvent({ kind: 'smelt_job_skip', status: 'no_effect', detail: `why=${why} free=${free} copper=${held.raw_copper ?? 0} fuel=${held.coal ?? 0} raw_iron=${held.raw_iron ?? 0}`, snapshot: snap })
            }
          }
        } catch { /* an inventory or world read must never break the decision loop */ }
      }
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
    // KEEPOUT-01: A BODY INSIDE A FIRE COLUMN LEAVES IT BEFORE ANYTHING ELSE (keepout.mjs exitDecision; design 4.6 row 4). LAST
    // in the chain on purpose, so it overrides every order above -- except a town job inside a column that covers the town
    // (C12, owner 2026-10-22 "yes": KEEPOUT_TOWN_YIELD) and a bot at home there, and except for 5 min after a failed exit
    // (the stranded ladder and the model have the body then). Deterministic: never advice, never the model's choice.
    // found-01 (Codex JIT 10-23c r1 P2): the found slot charged its visit and cooldown when it ISSUED; an order the exit replaces
    // never ran, so it is refunded like a declined run (refundDeclined) -- out of the column, still in town, the slot can issue it again
    // jit-1023 (junkout-01 x keepout-01, Codex fix review P2): a junkout visit the exit DISPLACES here never ran -- refunded as
    // a decline is (the probe above keeps this rare: it differs from this call only if the exit's backoff ran out in between).
    // junkout-01 x found-01 (JIT 10-24): both refunds stand; each answers {} / nothing for the other's skills.
    { const ko = this.#keepoutExitOrder(order); if (ko) { if (order?.skill === 'found_store' || order?.skill === 'found_work') Object.assign(this, refundDeclined(order.skill, this)); Object.assign(this, visitDisplacedRefund(order, this)); order = ko } }
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
      const wantedNow = this.#wantedItems(milestone)
      const check = this.admission.check(res.proposal, this.bot, wantedNow)
      if (check.ok) admitted = check
      else rejection = check
      // TOOL HYGIENE, PART 1: one row per refusal -- the canary's liveness, and the read's G2/G4 evidence (the
      // snapshot is the bag the refusal judged; `wanted` and `source` must always read 0 / model).
      if (rejection?.reason === 'redundant_craft' && rejection.redundant) {
        try {
          const row = redundantRow(rejection.redundant, { taskId: milestone?.id ?? null,
            wanted: !!wantedNow?.has?.(rejection.redundant.item), source: order ? 'order' : 'model', wantedSet: wantedNow })
          logEvent({ kind: 'redundant_craft', status: 'no_effect', detail: row.detail, args: row.args, snapshot: snapshot(this.bot) })
        } catch { /* a log row must never break the decision loop */ }
      }
      // ...and one per ADMITTED craft of a hygiene item: the read's G1 judges it on this snapshot and wanted set.
      if (check.ok && check.skill === 'craft' && HYGIENE_ITEMS.has(check.args?.item)) {
        try {
          const row = admitRow(check.args.item, { taskId: milestone?.id ?? null, source: order ? 'order' : 'model', wantedSet: wantedNow, count: check.args?.count ?? 1 })
          logEvent({ kind: 'craft_admit', status: 'success', detail: row.detail, args: row.args, snapshot: snapshot(this.bot) })
        } catch { /* a log row must never break the decision loop */ }
      }
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
      // THE RUNNER DECLINED (homefix-01, declined.mjs -- one set, `runner_reserved` included): the skill never ran, so no
      // handler below backs off, no cooldown is charged and no lesson is written. The decision row, lessons.save and the
      // milestone accounting (RUNNER_REFUSALS extends the same set) still run.
      const declined = runnerDeclined(r)
      // THE HANDLERS THAT KNOW A DECLINE (they import the same set and refund or skip it: townOrderOutcome,
      // townDepositOutcome, wellOrderOutcome, toolkitOutcome, recountOutcome) always run -- skipping them would lose
      // their refund of the cooldown charged at issue. The ones that treat ANY `failed` as a backoff are skipped.
      // A FAILED WEAR-OUT BACKS OFF (both reviews): a bot with no safe block (deepslate, a pillar, water) would
      // otherwise take a decision every cooldown, forever.
      if (!declined && admitted.skill === 'wear_out') this.wearOutBackoffUntil = r.status === 'failed' ? Date.now() + WEAR_OUT_BACKOFF_MS : 0
      // A TOWN ORDER THAT FAILED BACKS OFF; a skip (no_effect) or an interruption costs nothing (townOrderOutcome).
      if (TOWN_ORDERS.has(admitted.skill)) this.townState = townOrderOutcome(admitted.skill, r.status, Date.now(), this.townState ?? {}, r.failClass ?? null)
      // junkout-01: the tail's outcome lands in ITS state (Claude design r1 P2-2), never in the full-bag deposit's backoff
      if (admitted.skill === 'town_deposit') {
        if (admitted.args?.tail === true) {
          this.tailState = townDepositOutcome(r.status, r.failClass ?? null, Date.now(), this.tailState ?? {})
          // a DECLINED tail never ran: the visit is not spent and the reason that armed it stands again (code r1, both engines)
          if (RUNNER_DECLINED.has(r.failClass ?? null)) this.tailState = visitLatchDeclined(this.tailState)
        }
        else this.townDepositState = townDepositOutcome(r.status, r.failClass ?? null, Date.now(), this.townDepositState ?? {})
      }
      if (WELL_ORDERS.has(admitted.skill)) this.wellState = wellOrderOutcome(admitted.skill, r.status, Date.now(), this.wellState ?? {}, r.failClass ?? null)
      // junkout-01: a visit order the runner DECLINED never ran -- the visit is not spent (homefix-01's one decline set)
      if (admitted.args?.visit === true && declined) {
        if (admitted.skill === 'dispose_well') this.wellVisitState = visitLatchDeclined(this.wellVisitState ?? {})
        if (admitted.skill === 'compost') this.compostVisitState = visitLatchDeclined(this.compostVisitState ?? {})
      }
      if (!declined && admitted.skill === 'prune_town') this.pruneState = pruneOutcome(r.status, Date.now(), this.pruneState ?? {})
      if (!declined && admitted.skill === 'smelt_town') this.smeltJobState = smeltTownOutcome(r.status, r.stop ?? r.failClass ?? null, Date.now(), this.smeltJobState ?? {})
      if (!declined && admitted.skill === 'furnace_drain') this.drainState = drainOutcome(r.status, r.stop ?? r.failClass ?? null, Date.now(), this.drainState ?? {})
      // THE TOOLKIT: a failure backs off, a decline is refunded (what a run drew and did not use is on the bot: bot.kitCredit)
      if (admitted.skill === 'toolkit') this.toolkitState = toolkitOutcome(r.status, Date.now(), this.toolkitState ?? {}, r.failClass ?? null)
      if (admitted.skill === 'count_town') this.recountState = recountOutcome(r.status, r.delta?.counted ?? 0, Date.now(), this.recountState ?? {}, r.failClass ?? null)
      if (!declined && admitted.skill === 'build_plinth') this.plinthState = plinthOrderOutcome(r.status, Date.now(), this.plinthState ?? {}, r.failClass ?? null)
      // KEEPOUT-01: a failed exit backs off (the stranded ladder owns the body); anything else re-arms it at once
      // KEEPOUT-01: the exit's own bookkeeping (keepout.mjs exitOutcome): 3 attempts that do not get out -> the 5-min back-off
      // (a run the runner DECLINED never ran -- homefix-02's declined.mjs -- and does not count)
      if (!declined && admitted.skill === 'keepout_exit') {
        const o = exitOutcome({ tries: this.keepoutExitTries ?? 0, backoffUntil: this.keepoutExitBackoffUntil ?? 0 }, r.status)
        this.keepoutExitTries = o.tries; this.keepoutExitBackoffUntil = o.backoffUntil
      }
      // found-01: a body in the plan cell is a FREE skip -- the visit and the cooldown come back, the order is retried after FOUND_RETRY_MS
      if (!declined && (admitted.skill === 'found_store' || admitted.skill === 'found_work') && r.failClass === 'found_body') this.foundState = foundRetry(this.foundState ?? {}, Date.now(), r.at ?? admitted.args?.at ?? null)
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
      if (declined) {
        log('info', 'the runner declined the skill: not an outcome', { skill: admitted.skill, failClass: r.failClass })
        // THE ISSUE-TIME COOLDOWN IS REFUNDED TOO (Codex code r1 P2): pruneOrder / smeltTownOrder / drainOrder / plinthOrder
        // charge it when they ISSUE, before the run; a run the runner declined never happened, so the order is eligible on
        // the next decision -- toolkitOutcome's own refund, the same rule (isBusy() holds the decisions off while reserved).
        Object.assign(this, refundDeclined(admitted.skill, this))
      } else if (r.status === 'unknown') {
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
    // THE ROOM ORDER'S OUTCOME, MEASURED: the bag's slots now against when it was issued (workorder.mjs roomOutcome).
    if (roomIssued) {
      try {
        const items = this.bot.inventory?.items?.() ?? []
        const after = {}
        for (const it of items) after[it.name] = (after[it.name] ?? 0) + (it.count ?? 0)
        const lost = lostLine(roomBefore ?? {}, after)
        const stillFar = roomIssued.kind === 'home' && admitted ? farFromBank(this.bot) : false
        const out = roomOutcome({ status: outcome.status, failClass: runFailClass, refused: !admitted, slotsAfter: items.length, stillFar, now: Date.now(), state: this.roomState ?? {} })
        this.roomState = out.state
        const st = out.verdict === 'ok' ? 'success' : (out.verdict === 'walking' || out.verdict === 'declined') ? 'no_effect' : 'failed'
        logEvent({ kind: 'room_order', status: st,
                   detail: `kind=${roomIssued.kind} item=${roomIssued.item ?? '-'} craft=${roomIssued.craft} short=${roomIssued.short ?? '?'} slots=${roomIssued.slots}->${items.length} freed=${out.freed} verdict=${out.verdict} run=${admitted ? outcome.status : 'refused:' + (rejection?.reason ?? '?')} lost=${lost}`,
                   snapshot: snapshot(this.bot) })
      } catch { /* a log row must never break the decision loop */ }
    }
    // A RUNG CRAFT REFUSED FOR ROOM stops trusting the craft's own wear-out route for a while (craftRoomCheck).
    if (admitted?.skill === 'craft' && runFailClass === 'inventory_full' && admitted.args?.item) {
      this.roomWearFailAt ??= {}
      this.roomWearFailAt[admitted.args.item] = Date.now()
    }

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
