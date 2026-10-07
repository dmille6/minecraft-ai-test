// Deterministic skill layer -- handoff doc S9.2.
//
// Every skill is a plain async function with the same contract:
//   run(ctx, args, signal) -> { status, detail }
// where status is 'success' | 'failed' | 'unknown' | 'no_effect' | 'aborted'.
//
// `unknown` IS NOT A SOFT 'failed'. It is the absence of an answer, and it
// exists because twelve defects in one session were the same defect: an
// operation reporting a conclusion its evidence did not support. A search that
// hit OUR budget said "no path exists". A 1s probe on a 105-block climb said
// "stranded". A skill that never moved said "reached y=68". Each of those is a
// don't-know wearing a verdict's clothes, and each one trained the lessons
// store -- which is how a bot comes to believe walking home is impossible.
//
// The rule, enforced in runner.mjs and cognitive.mjs: an `unknown` throttles
// (cooldowns, the consecutive-failure pause, the milestone attempt counter --
// all of which are transient) and NEVER becomes a lesson, neither a success nor
// an avoid rule. Persisting a belief requires having observed something.
//
// Skills never call an LLM. In pass 2 the model's only job is to CHOOSE among
// these and supply arguments; it never writes movement or block code. That
// separation is what makes failures attributable -- if a skill misbehaves it is
// a bug in here, not a bad generation.
//
// Every long loop must check `signal.aborted`, because the reflex layer
// preempts skills and a skill that ignores that will fight it.

import { haltPath } from './pathhalt.mjs'
import { stepLineSafe } from './lavaguard.mjs'
import { nearDeathSite, lineHitsDeathSite, DEATH_SITE_TARGET_RADIUS } from './deathsites.mjs'
import { applyToolPolicy, remaining, spentEquipOutcome, handHarvests, emptyHand, TOOL_RE as DIG_TOOL_RE, HARD_STOP } from './toolfor.mjs'
import { wearOutPlan, wearTarget, wearRank, wearRefusals, slotObservation, neverPickUp } from './hygiene.mjs'
import { noteSought } from './pickuplog.mjs'
import { foodSkipMode, foodSkipActive, skipFoodDrop, foodSkipDetail, difficultyOf, setPeacefulFood, peacefulFoodActive } from './foodskip.mjs'
import { inPickupBox, pickupGoalClass, pickupGoal, standHeight } from './pickupbox.mjs'
import { BAG_SLOTS, roomRecipe, admitRoom, pickupNearest, heldLine, collectDecision, placeStackOf, depositTarget, roomAdvice, craftArrived, craftRoomRemedy, wearKeepsSlot, bagFill, placeableBlock, roomForOne, executionVerdict } from './craftroom.mjs'
import { compostPlan, nextInsert, boneMealRoom, fillDecision, composterLevel, compostDetail, composterBuildPlan,
         canonicalComposterSite, siteRefusal, standableBeside, tableCellFor, townPlanTableAvailable, resolveTownSite, readTownSite,
         handPlan, isCompostInput, ADOPT_RADIUS, VISIT_BUDGET_MS, MAX_ITEMS_PER_VISIT } from './composter.mjs'
import { poolStateDir } from './worldfacts.mjs'
// The full-chest recovery (deposit): its decisions are chestfull.mjs's. A separate line so a rebase stays mechanical.
import { fullChestNext, carriedChest, chestBudget, readClaims, claimNewChest, writeClaimState, reconcileClaims, townKey,
         containerStatus, recordOutcome, readTownMemory, updateTownMemory, townRoomAt, setTownRoomReader, timeLeft,
         pickChestSite, chestSiteRefusal, closeMsFor, closeBank, bankClosed, closedRoomText, bagTotal, returnCursor,
         chestPartnerOffset, isChestPartner, TOWN_SWEEP_MS, AFTER_SWEEP_MS, CLAIM_BUDGET_MS, PLACE_READBACK_MS, MAX_SITE_TRIES } from './chestfull.mjs'
// chestfull-02: one town boundary, no deep targets, a walk that never watches digs, closure only when truly closed.
import { inTown, depositTargetOk, walkFailure, backsOffTarget, travelTimeoutAction, closesBank, TARGET_BACKOFF_MS,
         TOWN_SCAN_RADIUS } from './chestfull.mjs'
import { STORAGE_NEAR } from './composter.mjs'
// Withdraw (withdrawpick.mjs): the town order and the model's verb share one transfer, verified by the server's bag.
import { bestToolCopy, roomPlan, roomKeep, roomCandidates, allocate, pickTakes, hasUsablePick, stonePickDeficits, NEEDS, PICK_RE, transferVerdict, bagDelta, withdrawRow, HOLD_MS,
  ingredientNeedsAbsent, noteIngredientMisses, townIngredientMissComplete } from './withdrawpick.mjs'
import { setWithdrawHold } from './bankable.mjs'
import { containerPickMiss, notePickMisses, townPickMissComplete } from './chestfull.mjs'
import { serverRecount, lockstepClicks, confirmCursor, clicksInFlight, invalidateClicks } from './craftsync.mjs'
import { inflightTracker } from './inflight.mjs'
import { FLOOR } from './toolfor.mjs'
/** Tools deposit moves one usable copy at a time, by slot (bankable.mjs's own tool families). */
const DEPOSIT_TOOL_RE = /_(pickaxe|axe|shovel|sword|hoe)$/
import { townDepositPlan, fitToContainer, townDepositDetail, inTownZone, doubleChestPartner, STORAGE_REACH, TD_MAX_CONTAINERS, TD_BUDGET_MS, TD_WALK_MS, TD_OPEN_MS, TD_SETTLE_MS } from './towndeposit.mjs'
import path from 'node:path'
import { IRON_KINDS, MIN_TRIP_USES, CANDIDATE_RADIUS, breakHazard, nearHome, pickBudget, rankCandidates, clusterOf, tunnelMovements, planTunnel, ONE_PICK_USES, tripDecision } from './oretunnel.mjs'
import pkg from 'mineflayer-pathfinder'
const { goals, Movements } = pkg
import { Vec3 } from 'vec3'
import { config } from './config.mjs'
import { planCraft } from './craftplan.mjs'
import { overheadBreakRisk, dryColumnStep, isWaterCell } from './scaffold.mjs'
import { logFloodGuard, watchClimbDig } from './climbflood.mjs'
import { mayStepDown, survivableDrop, settleForFall } from './mining.mjs'
import { planDig, planDigSplit, predictedDigMs, digEnv } from './digbudget.mjs'
import { log, logEvent } from './logger.mjs'
import { probeReachable } from './reachprobe.mjs'
import { reachGoal, reachRefusal, eyeToBlock, nodeToBlock, STANCE_REACH } from './digreach.mjs'
import { planDigApproach, observeApproachDig, APPROACH_WALK_MS, planDigRetry, floatDigTargets, floatDigOk, RETRY_CAP_MS } from './digapproach.mjs'
import { scoopLiquid, pourLiquid, scoopRefusal, emptyRefusal } from './bucket.mjs'
import { countItem, horizontalDistanceFromSpawn, snapshot } from './state.mjs'
import { depositPlan, depositNoopReason, cobbleBankStacks, isCobble, COBBLE_RESERVE } from './bankable.mjs'
import { bankableInventory, depositDue, DEPOSIT_ALWAYS } from './bankable.mjs'   // chestfull-02: advice agrees with admission
import fs from 'node:fs'
import { doVisit, openBoard, withinBoard } from './board-visit.mjs'
import { canContinueDescent } from './exit-contract.mjs'
import { openLessons } from './lessons.mjs'
import { dropsOf, heldFromBlock, sourcesOf } from './drops.mjs'
import { smeltPlan, smeltRecipeFor } from './smelting.mjs'

/**
 * FAILURE CLASSES THAT NAME OUR IGNORANCE RATHER THAN THE WORLD.
 *
 * Every one of these is produced by a clock we set ourselves or by an
 * observation we could not make. None of them is evidence that the action is
 * impossible, and a skill returning one must report `unknown`, not `failed`.
 *
 *   path_budget     our 25s wall clock around pathfinder.goto expired
 *   path_timeout    pathfinder's own thinkTimeout expired MID-SEARCH; the
 *                   library distinguishes this from `noPath` (search
 *                   exhausted) and we spent 16 hours collapsing the two --
 *                   393 records of "no route exists" that the pathfinder had
 *                   never once returned
 *   collect_budget  gather's 40s-per-target COLLECT_MS expired
 *   probe_timeout   a bounded reachability probe ran out of think time; it
 *                   did not finish the search, so it cannot say there is none
 *   unverified      the call returned but the effect could not be read back
 *   no_measurable_change  the runner's evidence gate: a skill claimed success
 *                   and none of its contract's expected change was measured
 *
 * Kept as one exported set so the runner, the cognitive layer and the preflight
 * guard cannot disagree about which classes are unknowable. bots/test/
 * evidence-gate.test.mjs asserts this set never overlaps ANY of the three
 * evidence sets cognitive.mjs exports -- EVIDENCE_ABOUT_THE_ACTION,
 * EVIDENCE_ONLY_IF_STUCK and EVIDENCE_ONLY_IF_HERE. It said "the two evidence
 * sets" while there were three, which is how a widened set slips past a guard
 * that was only ever taught to check two of them.
 */
export const UNKNOWN_FAIL_CLASSES = new Set([
  'path_budget', 'path_timeout', 'collect_budget', 'probe_timeout', 'unverified',
  'no_measurable_change',
  // smelt_budget  OUR deadline expired with the furnace still burning. A vanilla
  //               furnace takes 10s per item and the runner's whole budget is
  //               180s, so running out of clock is the NORMAL end of a large
  //               batch -- "call smelt again to continue", exactly like mine's
  //               step cap. Calling that `failed` would teach the fleet that
  //               smelting does not work, which is the single most expensive
  //               wrong lesson available given nothing has ever smelted.
  'smelt_budget',
  // airborne     the bot was falling or swimming with nothing solid in any of
  //              24 cells. A TRUE, TRANSIENT statement about where the bot is,
  //              and none at all about whether placing works -- there will be a
  //              spot the moment it lands. Filed as `failed` it would feed the
  //              avoid machinery the lesson "place does not work", the same
  //              most-expensive-wrong-lesson argument that put `smelt_budget`
  //              on this list. 64 of 111 place refusals still read this way
  //              after the land-first wait shipped.
  'airborne',
  // furnace_window  the server never opened the furnace window. craft files the
  //               same event as `no_path`, which is defensible there and wrong
  //               here: the avoid key is `smelt:{"item":"raw_iron"}`, which
  //               carries no position, so one bad furnace anywhere would teach
  //               the whole fleet that smelting raw_iron is impossible
  //               everywhere -- the `explore:{}` collapse documented in SKILLS.
  'furnace_window',
  // craft_deadline  craftsync stopped a repeated craft at the skill's deadline and counted what the server
  //               delivered. Running out of clock on a big batch is the smelt_budget case again: "call craft
  //               again for the rest", not evidence that the recipe does not work.
  'craft_deadline',
])

/** The honest status for a failure class: a don't-know is not a no. */
export const statusFor = failClass => UNKNOWN_FAIL_CLASSES.has(failClass) ? 'unknown' : 'failed'

class Aborted extends Error { constructor() { super('aborted'); this.aborted = true } }
const check = signal => { if (signal?.aborted) throw new Aborted() }
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms)
  // `?.` on the method too: housekeeping orders tolerate a plain-object signal ({ aborted }), and they now sleep here
  // (craftExecutions); a real AbortSignal behaves exactly as before.
  signal?.addEventListener?.('abort', () => { clearTimeout(t); rej(new Aborted()) }, { once: true })
})

/**
 * Bound a pathfinding attempt. mineflayer-pathfinder will happily keep
 * re-planning toward an unreachable goal, during which the bot never moves --
 * indistinguishable from being stuck, and it burns the whole skill timeout.
 */
/**
 * DON'T ASK A* FOR A ROUTE FROM A PLACE THE BOT ISN'T STANDING.
 *
 * mineflayer-pathfinder searches from `bot.entity.position.floored()`
 * unconditionally. If that node has no legal neighbours -- because the bot is
 * mid-fall, or perched on a block edge with its floored position hanging in
 * air -- A* expands one node and quits. The raw events read "noPath after 1
 * nodes, 0ms", which is exactly the string behind our empty-path `stranded`
 * result, and it happens most after a maxDropDown=6 descent.
 *
 * Baritone solves this by substituting a nearby standable block as the search
 * origin (PathingBehavior.pathStart, its issue #209). We cannot pass a start
 * position to goto(), so we do the physical equivalent: wait for the bot to
 * come to rest before asking. Bounded, because a bot that never settles is a
 * different problem and must not hang here.
 */
async function settle(bot, signal, ms = 1500) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    check(signal)
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    const falling = Math.abs(bot.entity.velocity?.y ?? 0) > 0.08
    if (below && below.boundingBox === 'block' && !falling) return true
    await sleep(100, signal)
  }
  return false
}

/**
 * Cancel a path that is trying to dig something this bot cannot break.
 *
 * With any dig-capable profile A* can route through a block the bot has no tool
 * for; the bot then stands there swinging until the budget expires. Our stuck
 * reflex cannot see it -- it treats `bot.targetDigBlock != null` as evidence of
 * WORK and resets its timer -- so a bot futilely mining obsidian reads as
 * perfectly healthy for the full 40s collect or 90s ascent budget.
 * (mindcraft's checkDigProgress, skills.js.)
 */
function watchDigging(bot, onStuck) {
  return setInterval(() => {
    try {
      const b = bot.targetDigBlock
      if (!b) return
      if (!b.canHarvest(bot.heldItem?.type ?? null)) {
        try { bot.pathfinder.stop() } catch {}
        try { bot.stopDigging?.() } catch {}
        onStuck(b.name)
      }
    } catch { /* transient world state */ }
  }, 1000)
}

/**
 * Bound an await, SAY WHAT WAS BOUNDED, and clean up after it.
 *
 * `what` exists because this function used to report every timeout as
 * "pathfinding exceeded Nms" whatever it wrapped. The moment a dig was wrapped
 * (2026-08-10, when gather stopped using collectblock), a dig that never
 * finished was reported to the model, and persisted to the lessons store, as a
 * PATHFINDING failure -- teaching the fleet that a route was bad when the route
 * was fine and the block would not break. Exactly the defect this file's own
 * comment below describes, reintroduced by widening the helper's use without
 * widening its vocabulary.
 *
 * `onTimeout` exists because Promise.race does not cancel. Whatever we stop
 * waiting for keeps running unless something ends it, and what "ends it"
 * differs per API: a path needs the goal cleared, a dig needs stopDigging(), a
 * container needs closing. A generic wrapper cannot know, so callers say.
 *
 * The default is the pathfinder case, and it now clears the GOAL rather than
 * only calling stop(). stop() takes effect at the next path node, so a bot that
 * cannot reach its next node never stops -- setGoal(null) is what actually
 * ends it, which reflex.mjs already had to learn the hard way.
 */
export function withTimeout(promise, ms, bot, { what = 'pathfinding', onTimeout = null,
                                        needsDrop = true } = {}) {
  let t
  // A path that is digging the undiggable will otherwise run out the clock and
  // be recorded as a timeout, which names our budget rather than the cause.
  //
  // `needsDrop` IS THE WHOLE QUESTION, and getting it wrong sealed 27 bots in.
  //
  // watchDigging cancels any dig where `!block.canHarvest(heldItem)`. That is
  // right for `gather`, which wants the ITEM: mining stone bare-handed yields
  // nothing, so pressing on is a waste of the clock. It is exactly wrong for a
  // bot digging its way OUT, which wants the HOLE and does not care that the
  // stone drops nothing.
  //
  // Measured against the deployed 1.21.8 registry, `canHarvest(null)` returns
  // `null` for stone, deepslate, andesite and tuff -- and `undefined` when the
  // bot holds a scaffold block, which is what shaftAscend equips. Both are
  // falsy, so the watchdog fired on the FIRST poll and killed every
  // bare-handed climb dig at ~1000ms. digbudget.mjs prices those same digs at
  // 15,000ms and 24,500ms and says plainly "BREAKING BY HAND IS THE POINT...
  // a climb wants the hole, not the cobble" -- so two components in one call
  // frame held opposite beliefs about bare-handed digging, and the older one
  // won at one second. Every escape budget downstream of it was unreachable.
  //
  // The default stays TRUE. Only a caller that has already priced the dig and
  // wants the hole may turn it off, and it must say so at the call site.
  let undiggable = null
  const watch = needsDrop && (bot?.targetDigBlock !== undefined || bot?.pathfinder)
    ? watchDigging(bot, name => { undiggable = name })
    : null
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      t = setTimeout(() => {
        if (onTimeout) {
          try { onTimeout() } catch { /* best effort; the reject still happens */ }
        } else {
          haltPath(bot)   // setGoal(null) and NO trailing stop(): that left a stale flag the next goto died of (pathhalt.mjs)
        }
        // TAGGED, not just worded. The old message was matched by a regex that
        // also matched "no path", so OUR wall clock expiring was reported to
        // the model and persisted to the lessons store as "no route exists" --
        // 393 times in 16 hours. The pathfinder never once said no path exists.
        rej(undiggable
          ? Object.assign(new Error(`cannot break ${undiggable} on the way there`),
                          { failClass: 'undiggable_en_route' })
          : Object.assign(new Error(`${what} exceeded ${ms}ms`),
                          { failClass: what === 'pathfinding' ? 'path_budget' : `${what}_budget`,
                            budgetExceeded: true }))
      }, ms)
    }),
  ]).finally(() => {
    clearTimeout(t); if (watch) clearInterval(watch)
    // THE DIG WATCHER'S stop() (watchDigging) IS CONSUMED HERE (Claude review of 7775d5e): on a walk the pathfinder's
    // own dig_error reset eats it, but around gather's direct bot.dig there is no path, the dig settles first, and the
    // stale flag killed the next walk -- the pickup sweep. The race has settled, so no walk of this call is live.
    if (undiggable) haltPath(bot)
  })
}

/** Refuse any destination outside the world border. */
function assertInsideBorder(x, z) {
  const d = horizontalDistanceFromSpawn({ x, z })
  if (d > config.world.borderRadius) {
    throw new Error(`target ${Math.round(d)} blocks out exceeds border ${config.world.borderRadius}`)
  }
}

function bestTool(bot, block, opts = {}) {
  // THE CHEAPEST TOOL THAT DOES THE JOB, not the fastest (iron-retention plan v3, 2026-09-15): 16 iron pickaxes
  // vanished during work in two days, worn out on dirt, cobble and coal. toolFor() reads the server's harvest
  // table and the durability floor. (The fastest-tool picker it replaces broke digTime ties by tier because every
  // pickaxe ties on the 93 `incorrect_for_wooden_tool` ores -- that tie-break is now inside toolFor's cost order.)
  // `opts.lastSwing`: a HARVEST dig may spend a tool's final use when nothing else can harvest (see toolFor).
  return applyToolPolicy(bot, block, opts)
}

// ---------------------------------------------------------------- goto -----
//
// Long hops are broken into waypoints. A single 140-block goal through dense
// forest is a far harder search than three 50-block ones, and when it fails it
// fails totally -- the bot ends up exactly where it started with nothing
// learned. Incremental legs make partial progress real and turn one opaque
// failure into a specific one ("leg 2 of 3 was unreachable").
const MAX_LEG = 45
// `home` gets a bigger budget than a plain `goto` because it is the rescue
// path: goto's own 16-leg ceiling is 720 blocks and bots are routinely further
// out than that, so a single attempt cannot arrive and the value of the call is
// the ground it closes. Kept under the skill contract's maxMs below it.
const HOME_BUDGET_MS = 200_000
const MAX_HAZARD_RETRIES = 6

// Per-block harvest budget, and how many fruitless attempts end the skill.
// COLLECT_MS must be several times pathfinder.thinkTimeout (5s) so planning
// cannot eat the whole allowance, and BARREN_LIMIT * COLLECT_MS must stay under
// the 180s skill watchdog: 3 * 40s = 120s.
// WHAT IS WORTH DIGGING A TUNNEL FOR.
//
// The buried copy has to be the ONLY copy. Dirt, stone and sand are buried
// constantly and also lie exposed on every hillside, so escalating for them
// converts a cheap failure into an expensive one 80 times over. Ore does not
// work that way: `gather iron_ore` succeeded 10 times in 307 asks, and 59% of
// those failures were "every candidate is buried".
//
// Deliberately a pattern on the NAME rather than a hand-listed set, so
// deepslate and the 1.21 copper/emerald variants are covered without anyone
// remembering to add them. `ancient_debris` is included and is the only
// non-"_ore" member: it is the same shape of problem.
const WORTH_TUNNELLING = /(_ore|^ancient_debris$)/
// A stair step IS one block of falling (~450ms from rest). The old flat 250ms
// judged a good share of steps mid-air. Bounded, and settleForFall returns early
// as soon as the bot is down, so a clean step never pays the whole budget.
//
// Clamped to the skill budget for the same reason the runner sets
// SKILL_TIMEOUT_MS=300 in tests: a fake world where the bot never moves would
// otherwise pay the full settle on every step of every staircase, and a suite
// that takes two minutes to say "unverified" is a suite nobody runs.
const STEP_SETTLE_MS = Math.max(50, Math.min(900, Math.floor(config.skills.defaultTimeoutMs / 3)))
// The recovery budget, and it is the whole difference between this and the
// version that was reverted: a re-dig plus a shove, not a re-plan. Both clamp
// with the skill budget so the test runner does not pay production timings.
const STEP_REDIG_MS = Math.max(60, Math.min(600, Math.floor(config.skills.defaultTimeoutMs / 300)))
const STEP_IMPULSE_MS = Math.max(30, Math.min(350, Math.floor(config.skills.defaultTimeoutMs / 500)))
const COLLECT_MS = 40_000
const BARREN_LIMIT = 3

async function goto(ctx, { x, y, z, range = 1 }, signal) {
  const { bot } = ctx
  assertInsideBorder(x, z)
  check(signal)

  // Re-assert before travelling. Cheap (a string compare), and it turns "why is
  // this bot digging" into a named event instead of a mystery.
  bot.assertNav?.('goto')

  const target = new Vec3(Number(x), Number(y), Number(z))
  let legs = 0, lastErr = null
  // One dig-assisted retry per goto, not per leg: a bot that must tunnel every
  // leg is not travelling, it is excavating, and the budget should say so.
  let diggingRetry = false
  // One descent attempt per goto, same discipline: a bot that must be dropped
  // off a ledge on every leg is not travelling either.
  let descentRetry = false
  let rodeDown = false

  // THE LEG BUDGET MUST SCALE WITH THE DISTANCE, or a far target is unreachable
  // by ARITHMETIC rather than by terrain.
  //
  // This was a hardcoded 8, which at MAX_LEG=45 caps total travel at 360 blocks.
  // Measured over a 10.5-hour run: `home` failed 162 times out of 162, and all
  // 77 of the "got within N blocks" failures reported the SAME distance -- 383 --
  // because three of five bots had wandered further from home than the budget
  // could ever cover:
  //
  //     Scout01 229   Miner01 288   Gather02 383   Solo01 477   Gather01 872
  //
  // The skill was not failing. It was being asked to walk 383 blocks with 360
  // blocks of allowance, and it correctly reported that it ran out.
  //
  // The cap that DOES matter is the 180s skill watchdog. Measured: a successful
  // goto takes a median 16.5s and at worst 45s, and the worst failure 70s, so
  // roughly 9s per leg. Sixteen legs is ~145s -- inside the watchdog with margin,
  // and 720 blocks of reach.
  await settle(bot, signal).catch(() => {})
  const startDist = Math.hypot(target.x - bot.entity.position.x, target.z - bot.entity.position.z)
  const maxLegs = Math.min(16, Math.max(8, Math.ceil(startDist / MAX_LEG) + 3))

  while (legs < maxLegs) {
    check(signal)
    const here = bot.entity.position
    const dist = Math.hypot(target.x - here.x, target.z - here.z)
    if (dist <= Math.max(range, 2)) break

    // Aim at an intermediate point when the goal is far away. The final leg is
    // the one that must honour the caller's elevation; the rest are just
    // direction (see the GoalNearXZ note below).
    let leg = target
    const isFinalLeg = dist <= MAX_LEG
    if (dist > MAX_LEG) {
      const f = MAX_LEG / dist
      leg = new Vec3(
        Math.round(here.x + (target.x - here.x) * f),
        Math.round(here.y + (target.y - here.y) * f),
        Math.round(here.z + (target.z - here.z) * f))
    }

    const before = here.clone()
    try {
      // AN INTERMEDIATE WAYPOINT HAS NO BUSINESS SPECIFYING AN ELEVATION.
      //
      // `leg` is a straight-line interpolation toward the target, so its y is
      // whatever a ruler drawn through the terrain happens to pass through --
      // routinely inside a hill or hanging in mid-air. Asking GoalNear to reach
      // a specific y at that point makes A* search exhaustively for somewhere
      // that does not exist, and it reports Timeout: 117 of the goto failures
      // over a 10.5-hour run, the single largest cause after the leg budget.
      //
      // Measured, |dy| between the bot and the requested y:
      //     succeeded  p90  8 blocks   max 28
      //     failed     p90 12 blocks   max 82
      //
      // GoalNearXZ asks only "get to this column", letting the planner take
      // whatever elevation the ground actually has. Only the FINAL approach
      // needs a y, because that is what the caller asked for.
      const goal = isFinalLeg
        ? new goals.GoalNear(leg.x, leg.y, leg.z, Math.max(range, 2))
        : new goals.GoalNearXZ(leg.x, leg.z, Math.max(range, 2))
      const p = bot.pathfinder.goto(goal)
      // Halt on abort -- and REMOVE the listener when the leg ends (Codex review: one per leg accumulated, and a
      // finished leg's listener could halt a later walk).
      const onAbort = () => haltPath(bot)
      signal?.addEventListener('abort', onAbort, { once: true })
      try { await withTimeout(p, 25000, bot) } finally { signal?.removeEventListener?.('abort', onAbort) }

      // A RESOLVED PROMISE IS NOT AN ARRIVAL.
      //
      // mineflayer-pathfinder/lib/goto.js:
      //     function noPathListener (results) {
      //       if (results.path.length === 0) {
      //         cleanup()                          // <-- resolve(), no error
      //       } else if (results.status === 'noPath') {
      //         cleanup(error('NoPath', ...))      // unreachable when empty
      //
      // The empty-path case is tested BEFORE the status, so "A* could not
      // generate a single move from where I am standing" is delivered as a
      // FULFILLED promise. We only measured displacement in the catch branch,
      // so a leg that went nowhere was counted as a leg completed.
      //
      // Measured over fleet-014: 12 of 14 such failures moved exactly 0 blocks
      // while reporting 8 completed legs, and burned all 8 in 453-712ms --
      // about 80ms per leg, which is not enough time to plan a route, let alone
      // walk 13 blocks. The corresponding raw events read "noPath after 1
      // nodes, 0ms". That single mechanism is 52% of all goto failures, and it
      // was filed as `no_path` toward the DESTINATION, which reads as "the
      // world is in the way" when the truth is "this bot cannot leave its own
      // square".
      //
      // Those are different problems with different remedies, so they get
      // different names. Not moving is only evidence of being stranded if we
      // are not already standing on the leg's goal.
      const advanced = bot.entity.position.distanceTo(before)
      const atLeg = Math.hypot(leg.x - bot.entity.position.x, leg.z - bot.entity.position.z)
      if (advanced < 2 && atLeg > Math.max(range, 3)) {
        // IF IT WALKED OUT, A WALK BACK EXISTS -- UNLESS WE BUILT THE TRAP.
        //
        // Every bot starts at home, so a route home existed at least once.
        // What breaks the symmetry is our own stack: `mine` staircases down and
        // pillarOut towers up, while navigation runs canDig=false so it never
        // digs. One layer manufactures terrain another layer is forbidden to
        // cross, and the bot that dug the shaft is the one bot that cannot
        // climb it. That asymmetry is 25 of the 44 logged deposit failures --
        // filed as "no route out of here", which reads as hostile terrain when
        // the truth is a self-inflicted one-way trip.
        //
        // `surface` already has the cure for the vertical case: borrow the
        // dig-capable config for one bounded attempt. This is the horizontal
        // case, and it gets the same treatment -- ONE retry, still budgeted,
        // config always given back. Digging stays a deliberate act with a
        // named reason; it does not become how the bot walks.
        if (!diggingRetry && bot.withAscentMovements) {
          diggingRetry = true
          log('warn', 'no route on foot; retrying this leg with digging allowed',
              { from: `${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.y)},${Math.round(bot.entity.position.z)}` })
          // The retry leaves a mark either way. Until 2026-09-11 it logged a
          // warn line and nothing else, so its success rate was unreadable in
          // telemetry and the canary read for the watchdog fix above had no
          // denominator (Codex review). The dig-approach paid the same lesson.
          // Snapshot at RETRY ENTRY, not the leg start: `before` is where the
          // leg began, and a bot that walked two blocks before the on-foot
          // planner gave up would mark a retry that never moved as a success
          // (Codex review, 2026-09-11). The water->land bit is the escape
          // itself for a floating bot: hive-b-Delta's ledge is 1.5 blocks away.
          const retryFrom = bot.entity.position.clone(); const retryT0 = Date.now()
          const retryWet = !!bot.entity.isInWater
          // PLAN FIRST, THEN SIZE THE CLOCK FROM THE PLAN. A flat 25 s cannot
          // hold a bare-handed dig made floating (x5) in water (x5): hive-b-Delta
          // spent three 25 s retries under a stone lid it needed 187 s to break
          // (canary hole-walks-01). digapproach.mjs says how it is priced.
          // A GROUNDED BOT KEEPS THE OLD RETRY EXACTLY: no planning pass, the
          // flat clock. The plan-then-price path exists for the floating case
          // only, so the change is one variable on the fleet (Codex review).
          const retryPlan = bot.entity.onGround
            ? { status: 'grounded', path: [], digMs: 0, budgetMs: 25000, notOnGround: false }
            : planDigRetry(bot, bot.ascentMovements, goal)
          const retryBudget = retryPlan.budgetMs
          let retryErr = null
          // A FLOATING BOT NEVER DIGS THROUGH THE PATHFINDER: its executor
          // waits for onGround before it calls bot.dig, so the plan it found
          // for hive-b-Delta sat for 25 s doing nothing (digapproach.mjs,
          // floatDigTargets). mineflayer's dig has no such gate: break the
          // plan's first blocks here, then let goto walk. Each dig is on its
          // own priced clock, cancelled the way withTimeout cancels a dig.
          let floatDug = 0
          for (const { block, digMs } of floatDigTargets(bot, retryPlan.path)) {
            check(signal)     // an abort must not start another dig
            // Re-read the target the instant before digging: the world and the
            // bot have moved since the plan was priced (digapproach.floatDigOk).
            const gate = floatDigOk(bot, block)
            if (!gate.ok) {
              logEvent({ kind: 'goto_float_dig', status: 'skipped',
                         detail: `${block.name} at ${block.position.x},${block.position.y},${block.position.z}: ${gate.why}` })
              break
            }
            const d0 = Date.now(); let ok = true; let why = ''
            // The skill's abort must reach THIS dig: stopping the pathfinder
            // does not stop a direct bot.dig.
            const onAbort = () => { try { bot.stopDigging() } catch {} }
            signal?.addEventListener?.('abort', onAbort, { once: true })
            try {
              await withTimeout(bot.dig(block, true), Math.min(RETRY_CAP_MS, digMs + 5000), bot,
                                { what: 'float dig', needsDrop: false, onTimeout: onAbort })
            } catch (e) { ok = false; why = String(e?.message || e).slice(0, 80) }
            finally { signal?.removeEventListener?.('abort', onAbort) }
            // mineflayer sets the block to air locally when its timer runs out;
            // only the server's next update says whether the dig was accepted.
            // A server that rejected the dig puts the block back within a tick
            // or two; poll for it rather than trust the first read.
            let confirmed = null
            if (ok) {
              for (let i = 0; i < 6; i++) {
                await sleep(250)
                try { confirmed = (bot.blockAt(block.position)?.name ?? '?') === 'air' } catch { confirmed = null }
                if (confirmed === false) break
              }
            }
            logEvent({ kind: 'goto_float_dig', status: ok ? 'success' : 'failed',
                       detail: `${block.name} at ${block.position.x},${block.position.y},${block.position.z} ` +
                               `priced ${Math.round(digMs)}ms took ${Date.now() - d0}ms confirmed=${confirmed}${why ? ' ' + why : ''}` })
            if (!ok || confirmed === false) break   // a rejected dig ends the float dig; goto re-plans below
            floatDug++
          }
          check(signal)     // and an abort during the float dig must not start the walk
          try {
            await bot.withAscentMovements(async () => {
              // THE HOLE, NOT THE DROP. This retry exists to dig through what
              // blocks the walk; with the watchdog on, a bare-handed stone dig
              // is cancelled at its first poll and the retry reports "no route
              // out of here even with digging allowed". hive-b-Delta floated
              // 3.5 h under a stone lid with a one-block exit beside it while
              // the real planner (reconstructed from an RCON scan, 2026-09-11)
              // had a 3-step path: break the lid, jump west, walk. Same defect
              // as the dig-approach on 2026-09-10.
              await withTimeout(bot.pathfinder.goto(goal), retryBudget, bot, { needsDrop: false })
            })
            check(signal)
          } catch (e) { retryErr = e }   // judged below, by OUTCOME, not by completion
          // A retry that left the water and then timed out still escaped; a
          // retry that completed without moving still failed. The mark says
          // which (Codex review, 2026-09-11), with unrounded coordinates so a
          // reader can test where it started without a rounding boundary.
          const moved = bot.entity.position.distanceTo(retryFrom)
          const nowWet = !!bot.entity.isInWater
          const where = `from ${retryFrom.x.toFixed(1)},${retryFrom.y.toFixed(1)},${retryFrom.z.toFixed(1)} in ${Date.now() - retryT0}ms budget=${retryBudget}ms plan=${retryPlan.status} planned_dig=${Math.round(retryPlan.digMs)}ms floating=${retryPlan.notOnGround} float_dug=${floatDug}`
          if (moved >= 2 || (retryWet && !nowWet)) {   // it worked; carry on
            logEvent({ kind: 'goto_dig_retry', status: 'success',
                       detail: `moved ${moved.toFixed(1)} blocks dy=${(bot.entity.position.y - retryFrom.y).toFixed(1)} ` +
                               `wet=${retryWet}->${nowWet}${retryErr ? ` then ${String(retryErr?.message || retryErr).slice(0, 60)}` : ''} ${where}` })
            if (retryErr && signal?.aborted) throw retryErr
            continue
          }
          logEvent({ kind: 'goto_dig_retry', status: 'failed',
                     detail: `${retryErr ? String(retryErr?.message || retryErr).slice(0, 100) : `moved only ${moved.toFixed(1)} blocks`} ` +
                             `wet=${retryWet}->${nowWet} ${where}` })
          // fall through to the honest failure below
        }
        // STRANDED ABOVE SEA LEVEL IS A DESCENT PROBLEM, NOT A DIGGING ONE.
        //
        // Both configs above cap maxDropDown at 6, so a bot on a ledge or on
        // top of its own tower -- every exit a 7+ block drop -- has no legal
        // first move and the dig retry cannot invent one. That is the shape
        // behind "no route out of here even with digging allowed, 26 blocks
        // short": twenty-six blocks is not distance, it is a local constraint.
        //
        // It lives HERE rather than in `home` or `surface`. In `goto` every
        // caller inherits it -- home, deposit, explore, the watchdog -- and
        // `surface` would be the wrong owner regardless: its contract is
        // climbing to sea level and its success evidence is altitude GAIN, so
        // teaching it to descend would make the skill name lie to the evidence
        // gate.
        //
        // Gated on health because the whole repair is a bigger fall: 169 of 868
        // deaths are already falls, and rescuing a wounded bot by dropping it
        // eight blocks is not a rescue.
        if (!descentRetry && bot.withDescentMovements &&
            bot.entity.position.y >= SEA_LEVEL && (bot.health ?? 20) >= 18) {
          descentRetry = true
          log('warn', 'stranded above sea level; retrying this leg with a larger drop allowed',
              { y: Math.round(bot.entity.position.y), health: bot.health })
          try {
            await bot.withDescentMovements(async () => {
              // The descent profile is canDig=false, so this flag is inert
              // here today; it is set for the day that profile learns to dig,
              // so the watchdog cannot silently reappear on it (Codex review).
              await withTimeout(bot.pathfinder.goto(goal), 20000, bot, { needsDrop: false })
            })
            check(signal)
            // Same postcondition as the dig retry, and self-verifying: if it
            // moved, the loop re-plans from the new cell; if that cell is still
            // unroutable the next pass returns the honest failure below.
            if (bot.entity.position.distanceTo(before) >= 2) {
              logEvent({ kind: 'descent_escape', status: 'success',
                         detail: `dropped clear of a perch at y=${Math.round(before.y)}`,
                         snapshot: snapshot(bot) })
              continue
            }
          } catch { /* fall through to the honest failure below */ }
        }
        // LAST RUNG: nothing can be pathed and there is a void underneath.
        //
        // Everything above tries to WALK out, including with a bigger drop
        // allowed. A bot on an isolated platform at the build limit has no
        // legal first move for any of it, and `mine` correctly refuses to dig
        // into a 250-block fall. Measured: three bots made 164 descent
        // attempts in six hours and not one was permitted.
        //
        // Deliberately last, and deliberately narrow. It only runs once per
        // goto, only well above sea level, only at full health, and only when
        // the pathfinder has already proved there is no route -- so an
        // ordinary bot on a cliff at y=80, which can simply walk down, never
        // reaches this line.
        // NO MATERIAL GATE. `rideFloorDown` has two branches and only ONE of
        // them spends a block.
        //
        // `needsBridge = !under || under.boundingBox !== 'block'` -- the bridge
        // branch, which consults `rescueBlocks`. The other branch is the free
        // one, and this function's own comment calls it "98% of reality": a bot
        // standing on the pillar it built has SOLID ROCK at y-2, so the step is
        // break-the-floor-and-land-on-it. One block, no fall damage, no material.
        //
        // Requiring blocks HERE tested for material that only the fallback
        // branch spends, and it refused exactly the bots the free branch exists
        // for. Measured 2026-09-04 over 6h: of 8 marooned-high frozen bots, SIX
        // hold zero rescue blocks and failed on this line; two of those --
        // placebo-d-Echo (goto y=62 from y=168) and board-c-Alpha (goto y=65
        // from y=94) -- passed every other precondition. `_ride_floor_down`
        // fired 0 times across all 17 frozen bots.
        //
        // The bridge branch still refuses cleanly on its own ("no placeable
        // blocks left"), so removing this costs nothing but a wasted call when
        // there is genuinely nothing underneath.
        if (!rodeDown && bot.entity.position.y >= SEA_LEVEL + 20 &&
            (bot.health ?? 20) >= 18 && Number(target.y) < bot.entity.position.y - 8) {
          rodeDown = true
          const before2 = bot.entity.position.clone()
          const r = await rideFloorDown(bot, { signal })
          check(signal)
          logEvent({
            kind: 'ride_floor_down',
            status: r.descended >= 1 ? 'success' : 'failed',
            detail: `descended ${r.descended.toFixed(0)} blocks from y=${Math.round(before2.y)} ` +
                    `using ${r.placed} placed block(s) and ${r.rode} free step(s)` +
                    (r.stopped ? ` — stopped: ${r.stopped}` : ''),
            snapshot: snapshot(bot),
          })
          if (bot.entity.position.distanceTo(before2) >= 2) continue
        }
        const q = bot.entity.position
        return {
          status: 'failed',
          failClass: 'stranded',
          gap: `stranded_y${Math.round(q.y)}`,
          detail: `pathfinder returned an empty path from ` +
                  `${q.x.toFixed(0)},${q.y.toFixed(0)},${q.z.toFixed(0)} — no route out of here ` +
                  `even with digging allowed, ${Math.round(dist)} blocks short of ` +
                  `${target.x},${target.z}`,
        }
      }
      lastErr = null
    } catch (e) {
      // WE STOPPED IT OURSELVES. The reflex layer's stuck detector calls
      // runner.interrupt() and then bot.pathfinder.stop(); stop() emits
      // `path_stop`, so goto() rejects with PathStopped -- NOT with our
      // AbortError. `e.aborted` was therefore undefined, the self-inflicted
      // interruption fell through to the failure branch, and the skill was
      // charged for it: 596 times in 16 hours the bot recorded "goto failed"
      // because its own safety watchdog had cancelled the walk. Four of those
      // and the admission gate forbids the action outright, which is how a
      // fleet teaches itself that walking home is impossible.
      if (e.aborted || signal?.aborted) {
        throw e.aborted ? e : Object.assign(new Error(`interrupted: ${e.name}`), { aborted: true })
      }
      lastErr = e.message
      const moved = bot.entity.position.distanceTo(before)

      // mineflayer-pathfinder rejects with a typed error (lib/goto.js): NoPath,
      // Timeout, PathStopped, GoalChanged. Reading `e.name` asks the pathfinder
      // what happened; regexing `e.message` guesses. These mean genuinely
      // different things and only the first is evidence about the WORLD:
      //   NoPath      the search completed and no route exists    <- a real lesson
      //   Timeout     thinkTimeout expired mid-search             <- too slow, not impossible
      //   PathStopped something called stop()                     <- ours
      //   GoalChanged something set a competing goal              <- our bug
      //   budget      our own 25s execution wall                  <- ours
      const CAUSE = {
        NoPath:      ['no_path',          `no route exists toward ${target.x},${target.z}`],
        Timeout:     ['path_timeout',     `planner gave up searching toward ${target.x},${target.z}`],
        PathStopped: ['path_interrupted', `path to ${target.x},${target.z} was stopped`],
        GoalChanged: ['goal_changed',     `a competing goal replaced the route to ${target.x},${target.z}`],
      }
      const [failClass, why] = e.budgetExceeded
        ? ['path_budget', `ran out of the 25s travel budget toward ${target.x},${target.z}`]
        : (CAUSE[e.name] ?? ['other', `pathfinding failed toward ${target.x},${target.z}: ${e.message.slice(0, 60)}`])

      if (moved < 2) {
        return {
          // NoPath is a no; Timeout and our own budget are a don't-know, and
          // only the first may reach the lessons store. The taxonomy above has
          // named the difference since the day goto stopped regexing its own
          // prose -- but both classes still returned `failed`, so downstream
          // treated "the search completed and found nothing" and "we stopped
          // the search" as the same claim about the world. statusFor() is where
          // that stops.
          status: statusFor(failClass), failClass,
          detail: `${why} — after ${legs} leg(s), still ${Math.round(dist)} blocks short`,
        }
      }
      // Moved somewhat -- that is progress, so try the next leg.
    }
    legs++
  }

  const p = bot.entity.position
  const left = Math.hypot(target.x - p.x, target.z - p.z)
  // ARRIVING 14 BLOCKS ABOVE THE DESTINATION IS NOT ARRIVING.
  //
  // This test was horizontal only. With allow1by1towers=true a bot can pillar
  // straight up, and the XZ check then called that success: Miner01 reported
  // "arrived at 37,80,-243" for a target at y=66, could not build its way back
  // down (repeating place_error resets), and every later goto and craft was
  // issued from a column A* cannot leave. One bot stranded that way produced
  // roughly a third of the run's goto failures.
  //
  // Vertical tolerance is looser than horizontal because terrain height at a
  // destination is often genuinely unknown to the caller -- but it is bounded,
  // and exceeding it is reported as its own class rather than quietly passing.
  const dy = Number.isFinite(target.y) ? Math.abs(target.y - p.y) : 0
  const VERT = Math.max(range, 3) + 3
  if (left <= Math.max(range, 3) && dy <= VERT) {
    return { status: 'success', detail: `arrived at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}` }
  }
  if (left <= Math.max(range, 3)) {
    return {
      status: 'failed',
      failClass: 'wrong_elevation',
      gap: `dy_${Math.round(dy)}`,
      detail: `reached the column of ${target.x},${target.z} but ${Math.round(dy)} blocks off in y ` +
              `(at y=${p.y.toFixed(0)}, wanted ${target.y})`,
    }
  }
  // CLOSING MOST OF THE DISTANCE IS NOT THE SAME FAILURE AS GOING NOWHERE, and
  // the lessons store has to be able to tell them apart.
  //
  // Some trips genuinely cannot finish in one skill invocation -- Gather01 was
  // 872 blocks from home, which is two full budgets. Reporting that identically
  // to "could not move at all" meant `home` accrued 162 straight failures and
  // the avoid rule suppressed the one action that would have recovered the bot.
  //
  // `gap` is the remaining distance in 50-block buckets. The store's gap-gating
  // already treats a CHANGING gap as progress and only accrues against a gap
  // that stays put, so a bot walking steadily home no longer punishes itself,
  // while one pinned against terrain still does.
  const closed = Math.round(startDist - left)
  const bucket = Math.round(left / 50) * 50
  // `closed > MAX_LEG` meant travel_incomplete could not fire on any trip
  // shorter than ~45 blocks, which is most of them: the class has never once
  // appeared in the index. Meanwhile a trip that closed NOTHING was filed as
  // `no_path`, indistinguishable from a genuine A* refusal. Those are the two
  // cases this branch most needs to separate.
  return {
    status: 'failed',
    failClass: closed >= 8 ? 'travel_incomplete' : closed <= 2 ? 'no_progress' : 'no_path',
    gap: `within_${bucket}`,
    detail: closed >= 8
      ? `closed ${closed} of ${Math.round(startDist)} blocks toward ${target.x},${target.z} ` +
        `in ${legs} legs — ${Math.round(left)} still to go, call again to continue`
      : `got within ${Math.round(left)} blocks of ${target.x},${target.z} after ${legs} legs${lastErr ? ` (${lastErr.slice(0, 50)})` : ''}`,
  }
}

/**
 * Tree canopies are walkable (leaves are solid), so a bot that pathfinds up a
 * hillside or gets knocked onto foliage ends up standing 8+ blocks in the air
 * with every trunk below it "unreachable" -- observed repeatedly, and the direct
 * cause of gather burning 20-45s per attempt and returning `stuck`.
 *
 * Descending to real ground first costs one short path and makes the rest of
 * the skill behave the way it does on flat terrain.
 */
async function descendToGround(ctx, signal) {
  const { bot } = ctx
  const FOLIAGE = /(_leaves|_log|vine)$/
  let under = null
  try { under = bot.blockAt(bot.entity.position.offset(0, -1, 0)) } catch { return false }   // no readable position: the descent is not NEEDED (a throw here is not a failed descent)
  if (!under || !FOLIAGE.test(under.name)) return false

  const ground = bot.findBlocks({
    matching: b => {
      const n = bot.registry.blocks[b.type]?.name
      return n === 'grass_block' || n === 'dirt' || n === 'sand' || n === 'stone'
    },
    maxDistance: 24, count: 40,
  }).filter(p => p.y < bot.entity.position.y - 2)
    .sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b))

  if (ground.length) {
    const t = ground[0]
    log('info', 'gather: standing on foliage, descending to ground', {
      from: Math.round(bot.entity.position.y), to: t.y })
    try {
      await withTimeout(bot.pathfinder.goto(new goals.GoalNear(t.x, t.y + 1, t.z, 1)), 10000, bot)
      const now = bot.blockAt(bot.entity.position.offset(0, -1, 0))
      if (now && !FOLIAGE.test(now.name)) return true
    } catch { /* fall through to digging */ }
  }

  // Walking down failed. The bot is stranded on canopy with no walkable route
  // to the ground -- navigation keeps canDig=false deliberately, so pathfinder
  // cannot cut through the leaves holding it up.
  //
  // Digging down IS allowed here: this is the skill layer making an explicit,
  // bounded decision, not the pathfinder rearranging terrain as a side effect.
  log('info', 'gather: no walkable route down, digging through foliage',
      { y: Math.round(bot.entity.position.y) })
  // LOG THE OUTCOME, NOT THE INTENTION.
  //
  // This carried a hardcoded status:'failed' written BEFORE the dig loop ran, so
  // 217 canopy escapes in one day recorded 0% success whether or not the bot
  // reached the ground. That is the same defect as `livelock_escape`, and as
  // `drowning_escaped` before it: an event named after what the code was ABOUT
  // to do rather than what happened. The loop already knows the answer -- it
  // only leaves early when it is standing on something that is not foliage.
  const startY = bot.entity.position.y
  let freed = false
  // MEASURE THE DROP BEFORE DIGGING THE FLOOR AWAY. hive-b-Bravo, 2026-09-15 19:06: stranded on a canopy at y=101,
  // every marooned arm had refused the 37-block drop, and this loop dug the leaves out from under it, logged
  // "reached solid ground" (air is not foliage) and the bot fell 37 blocks to its death. canopyDrop() is the pure
  // rule: the first solid block below the foliage column, and the fall the bot would take to stand on it.
  const drop = canopyDrop((x, y, z) => bot.blockAt(new Vec3(x, y, z)), bot.entity.position)
  if (!drop.ok) {
    logEvent({ kind: 'canopy_drop_refused', status: 'no_effect', detail: `stranded on foliage at y=${Math.round(startY)}; not digging down: ${drop.why}`, snapshot: snapshot(bot) })   // its own kind: trapped_in_canopy stays an outcome row computed after the loop (outcome-not-intention)
    return { refused: true, why: drop.why }   // gather stops here: the escape ladder owns a descent this steep (Codex)
  }
  for (let i = 0; i < 12; i++) {
    check(signal)
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (!below) break
    if (below.name === 'air' || below.boundingBox === 'empty') { await sleep(400, signal); continue }   // falling: not freed until something solid is under the feet
    if (!CANOPY_REMOVABLE.test(below.name)) {   // solid support (a log counts): freed once landed; never dug (Codex: the loop dug its own landing block)
      if (bot.entity.onGround) { freed = true; break }
      await sleep(200, signal); continue
    }
    try {
      const tool = bestTool(bot, below)
      if (tool) await bot.equip(tool, 'hand').catch(() => {})
      await bot.dig(below)
      await sleep(300, signal)
    } catch (e) {
      if (e.aborted) throw e
      break
    }
  }
  const dropped = Math.max(0, startY - bot.entity.position.y)
  logEvent({ kind: 'trapped_in_canopy', status: freed ? 'success' : 'failed',
             detail: `stranded on foliage at y=${Math.round(startY)}; dug down ` +
                     `${dropped.toFixed(0)} block(s) and ` +
                     `${freed ? 'reached solid ground' : 'did not get free'}`,
             snapshot: snapshot(bot) })
  return freed ? true : { failed: true, why: 'the canopy descent did not get free' }   // a failed descent is not "unneeded": gather must not dig from here (Codex pass 2)
}

// -------------------------------------------------------------- gather -----
//
// Delegates to mineflayer-collectblock rather than hand-rolling path->dig->pickup.
//
// The hand-rolled version hit a chicken-and-egg that is genuinely hard: with
// pathfinder digging enabled the bot tunnels into pits reaching for canopy
// logs; with it disabled the bot cannot get into a tree at all, and ends up
// standing on the leaves unable to descend to the trunk. collectblock owns
// exactly this problem -- it manages its own movements, tool selection, and
// drop collection, and is scoped to collection so navigation elsewhere stays
// non-destructive (index.mjs keeps canDig=false for goto/come/home).
// maxDistance was 96, and that number nearly took the host down four times.
//
// collectblock runs its own movements WITH digging enabled, so the search space
// A* explores is the VOLUME of a sphere of this radius, and almost every block
// in solid rock is a legal move. Volume scales cubically: 96 -> 32 is 1/27th of
// the space.
//
// Measured, four incidents, all with an underground target:
//   gather stone       -> 3.3GB, OOM
//   gather stone       -> 9.66GB, host down to 311MB free
//   gather stone       -> OOM
//   gather cobblestone -> 9.42GB, host down to 996MB free
//
// The exposed-face filter below is still correct but was never sufficient on its
// own: within 96 blocks there is always SOME exposed stone at a cave wall, so
// the filter passed and collectblock then tried to tunnel 90 blocks to reach it.
//
// 32 is also just a better plan. A bot walking 96 blocks to fetch one block was
// never going to finish inside the skill watchdog anyway.
// SAY THE WRONG WORD, FIND NOTHING.
//
// `nothing_found` is our single largest failure class -- 263 in one 5.9-hour
// run -- and a share of it is vocabulary, not scarcity. The model asks for
// "coal" and the world contains `coal_ore`; it asks for "cobblestone" while
// standing on `stone`, which is what drops cobblestone when mined; and below
// y=0 every ore is the `deepslate_` variant, so a bot at y=-42 asking for
// `iron_ore` is asking for a block that does not exist at that depth.
//
// Resolution is ordered and each step is reported, because "we found it under a
// different name" is a different fact from "we found what you asked for", and
// the lessons store should not learn that the original name worked.
function resolveBlockName(bot, name) {
  const has = n => bot.registry.blocksByName[n] ? n : null
  const direct = has(name)
  if (direct) return { name: direct, via: null }
  for (const alt of [`${name}_ore`, `deepslate_${name}_ore`, `${name}_block`, `${name}_log`]) {
    const hit = has(alt)
    if (hit) return { name: hit, via: `${name} -> ${hit}` }
  }
  // Things whose block name is not the item name they yield.
  const YIELDS = { cobblestone: 'stone', cobbled_deepslate: 'deepslate', flint: 'gravel' }
  const y = YIELDS[name] && has(YIELDS[name])
  if (y) return { name: y, via: `${name} is mined from ${y}` }
  return { name: null, via: null }
}

/**
 * CAN THE SOURCE OF THIS INGREDIENT EXIST WHERE THE BOT IS STANDING? Pure, exported, testable.
 *
 * Lower is better. This is the tiebreak the recipe chooser was missing, and the reason it is
 * needed is measured: for `stone_pickaxe`, minecraft-data 1.21.8 returns the variants in registry
 * order `cobbled_deepslate, blackstone, cobblestone`, `better()` is strict on every clause, so a
 * tie keeps index 0 -- and the fleet is advised to fetch `cobbled_deepslate` 1,415 times a day
 * having obtained ZERO of it, ever, against `cobblestone` at 7.3% of 2,723 attempts.
 *
 * AND IT IS NOT AN ALPHABETICAL BUG, which is what I first reported and what an independent review
 * refuted by mutant: sorting the FINAL blocker list (`rootGap`) changes only the word order of one
 * sentence, because every member of that list is printed. Alphabetically `blackstone` would win
 * anyway, and the fleet sees `cobbled_deepslate` -- index 0. The choice is made HERE.
 *
 * Three tiers, and every one is a fact about Minecraft rather than about this fleet's history:
 *   2  DIMENSION-IMPOSSIBLE -- blackstone and basalt exist only in the Nether. All 16 worlds are
 *      overworld, so advice naming them can never be acted on from anywhere.
 *   1  DEPTH-IMPOSSIBLE     -- deepslate and its variants exist only below y=0, which the file
 *      already knows (`depthVariant`: "Below y=0 an ore only exists as its deepslate variant").
 *      A surface bot cannot go and get cobbled_deepslate without first digging past y=0.
 *   0  reachable from here.
 *
 * Deliberately NOT ranked by the fleet's own success rates: those live in the lessons store, which
 * is SHARED WITHIN HIVE POOLS, so a history-based ordering would differ by arm and make every
 * downstream change carry an interaction term -- the exact cost the arms were retired over.
 */
export const NETHER_ONLY = new Set(['blackstone', 'basalt', 'blackstone_slab', 'polished_blackstone',
  'netherrack', 'soul_sand', 'soul_soil', 'nether_bricks', 'gilded_blackstone'])

export function sourceReachCost (name, y = 64, dimension = 'overworld') {
  const n = String(name || '').replace(/^\d+x\s+/, '')
  if (NETHER_ONLY.has(n)) return dimension === 'the_nether' ? 0 : 2
  if (/(^|_)deepslate(_|$)/.test(n) || n === 'cobbled_deepslate') return y < 0 ? 0 : 1
  // SMELTED, NEVER GATHERED (Claude review 09-29): torch's variants come back [charcoal+stick, coal+stick], so a tie
  // advised "gather charcoal first" (19/24 h). Coal is mined; charcoal needs a furnace, fuel and logs.
  if (SMELT_ONLY.has(n)) return 1
  return 0
}
export const SMELT_ONLY = new Set(['charcoal'])

/**
 * Pure: a blocker list deduped BY ITEM, keeping the largest requirement, sorted. A sub-craft's gap can itself be a
 * '+'-joined list ("2x stick+3x oak_planks"), so it is split first (Claude review 09-29: it was keyed as one item).
 */
export function dedupeGap (blockedBy = []) {
  const byItem = new Map()
  for (const entry of blockedBy) {
    for (const b of String(entry).split('+').map(x => x.trim()).filter(Boolean)) {
      const m = /^(\d+)x\s+(.+)$/.exec(b)
      const [n, item] = m ? [Number(m[1]), m[2]] : [1, b]
      const prev = byItem.get(item)
      if (!prev || n > prev.n) byItem.set(item, { n, text: b })
    }
  }
  return [...byItem.values()].map(v => v.text).sort()
}

/** The worst (highest) reach cost in a gap, because a gap is only as good as its hardest member. */
export function gapReachCost (gap = [], y = 64, dimension = 'overworld') {
  let worst = 0
  for (const g of gap) worst = Math.max(worst, sourceReachCost(g, y, dimension))
  return worst
}

/** Below y=0 an ore only exists as its deepslate variant. */
function depthVariant(bot, name, y) {
  if (y >= 0 || name.startsWith('deepslate_')) return null
  const d = `deepslate_${name}`
  return bot.registry.blocksByName[d] ? d : null
}

// BLOCKS mineflayer-collectblock CANNOT COLLECT.
//
// Its collect() runs a dig-and-path routine that does nothing useful for
// crops, foliage and attached decorations: the call returns cleanly, the bot
// gains nothing, and our barren counter then reports "found but unreachable" --
// a claim about the WORLD derived from a library limitation, which then goes
// into the lessons store as evidence and teaches the fleet to avoid an action
// that was never attempted.
//
// The list is mindcraft's (src/utils/mcdata.js mustCollectManually), which is
// the same list every mineflayer project converges on. Substring matches cover
// the families where the exact names are numerous and version-dependent.
const MANUAL_EXACT = new Set([
  'wheat', 'carrots', 'potatoes', 'beetroots', 'nether_wart', 'cocoa',
  'sugar_cane', 'kelp', 'short_grass', 'fern', 'tall_grass', 'bamboo',
  'lever', 'redstone_wire', 'lantern',
])
const MANUAL_SUBSTRING = [
  'sapling', 'torch', 'button', 'carpet', 'pressure_plate', 'mushroom',
  'tulip', 'bush', 'vines', 'fern', 'flower',
]
// EVERYTHING IS COLLECTED MANUALLY NOW. The list above is kept because it
// documents which blocks collectblock gets WRONG, and because narrowing this
// back down later should be a deliberate act with a reason, not a silent
// default. `COLLECTBLOCK_ENABLED=true` restores the old routing for anyone who
// wants to reproduce the failure.
//
// WHY, in full. collectblock 1.5.0 contains three unbounded awaits and a
// cancel that cannot cancel:
//
//   1. collectAll's Entity branch does `yield waitForPickup` with no timeout,
//      resolved only by an `entityGone` event for that exact item. A drop that
//      floats away in water, despawns unobserved, or cannot be reached never
//      fires it. ONLY gatherers chase dropped items -- which is why every one
//      of the 48+ OOM victims was role=gatherer and the scouts and miner were
//      never touched once.
//   2. gotoChest awaits bot.pathfinder.goto with no timeout.
//   3. cancelTask() does not cancel: it stops the pathfinder, then WAITS for a
//      `collectBlock_finished` event that a stuck loop never emits.
//   4. collect() calls cancelTask() as its FIRST action. So one stuck loop
//      makes every future gather hang on its first line, permanently.
//
// That last point is the amplifier. A single unpicked-up item poisons the bot
// for the rest of its life, and each subsequent gather adds another pending
// __awaiter frame. The heap snapshot at death held 180,061 of them, with
// 360,166 Generators and 903,562 Contexts -- all REACHABLE, so GC reclaimed
// nothing and V8 died with "Ineffective mark-compacts near heap limit".
//
// None of this is reachable from outside the library, which is why two rounds
// of patching around it failed. collectManually does the same job -- walk,
// equip, dig, pick up -- with a bound on every step.
/**
 * How close a bot must be to a crafting table or furnace for the server to open
 * the window. `craft` and `smelt` both refuse beyond it, and both used to spell
 * it as a bare 4.5 in three places.
 *
 * EXPORTED because `workorder.mjs` needs exactly this number and guessed a
 * different one. It asked whether a station existed within 32 -- the SEARCH
 * radius -- ordered the craft, and the craft then died walking to it: 12 of the
 * 13 failed work orders in the first 90 minutes were `no_path`, reading
 * "crafting_table is 7/9/11/12/19 blocks away and could not be reached".
 * Existence is not the binding condition; reach is.
 */
export const STATION_REACH = 4.5

const COLLECTBLOCK_ENABLED = process.env.COLLECTBLOCK_ENABLED === 'true'
const mustCollectManually = name =>
  !COLLECTBLOCK_ENABLED ||
  MANUAL_EXACT.has(name) || MANUAL_SUBSTRING.some(f => name.includes(f))

/**
 * Walk to a block, break it by hand, and pick up what it dropped.
 *
 * collectblock does the pickup itself; doing this by hand means doing that too,
 * or the item lies on the ground and the inventory delta stays zero -- which is
 * indistinguishable from not having mined it.
 */
export async function collectManually(bot, block, signal, { beforeDig = null } = {}) {
  const p = block.position
  const wanted = block.name
  // ASK FOR THE STANCE THE SERVER WILL ACCEPT, AND ONLY IF WE ARE NOT ALREADY IN IT.
  //
  // This was GoalNear(p, 2), then GoalLookAtBlock (ad2a74d, to match the
  // ranking probe). Both are paraphrases of a test that already exists three
  // lines below -- `bot.canDigBlock`, the block CENTRE within 5.1 of the EYE --
  // and a paraphrase of the admission test is the thing that produced this
  // failure class. So ask for canDigBlock itself: see src/digreach.mjs.
  //
  // WHAT THE PARAPHRASES COST, measured against the real Movements and the real
  // AStar over synthetic worlds (test/gather-reach.test.mjs), thinkTimeout
  // 5000, canDig=false:
  //
  //   scene                GoalNear(p,2)   GoalLookAtBlock  reachGoal   legal
  //                                                                     stances
  //   block in a wall      timeout 267k    success 4        success 2    35
  //   block in a ceiling   timeout 252k    timeout 260k     success 2    69
  //   oak log 5 up a trunk timeout 234k    timeout 246k     success 4    36
  //
  // "legal stances" is the number of nodes the bot could WALK TO from which
  // canDigBlock is true. The goal was rejecting every one of them and A* then
  // had to drain the walkable world to prove there was nothing -- an empty
  // acceptance set is the most expensive query A* can be handed, and that is
  // the mechanism behind `path_timeout` appearing in 46.2% of the runs that
  // report this failure. GoalLookAtBlock is a real improvement on the wall and
  // does nothing for the other two: its reach test is
  // `node.distanceTo(pos + 1.6) <= 4.5` measured corner to corner, which
  // refuses a bot standing directly under a block three above it -- 4.6 by that
  // measure, 1.85 by canDigBlock's.
  //
  // Measured on the fleet, 3h, full walk: 673 of 4,640 gather runs (14.5%)
  // across 75 of 80 bots, 1,269 refusals, against ONE dig_unconfirmed in the
  // same scan. oak_log is 43.4% of them and the canopy row above is its shape.
  //
  // AND THE WALK IS OFTEN NOT NEEDED AT ALL. canDigBlock reaches about four
  // blocks up and four down, so the log above the bot's head and the ore under
  // its feet were both being handed to a planner that had nowhere legal to send
  // it. Checking first costs one subtraction.
  let pathSaid = 'not needed — already within reach'
  if (!(bot.canDigBlock && bot.canDigBlock(bot.blockAt(p)))) {
    // KEEP THE PATHFINDER'S VERDICT. The old catch discarded it and the refusal
    // then asserted "goto returned without moving" as a fact it had never
    // checked. goto's error NAMES are the library's own vocabulary -- NoPath,
    // Timeout, PathStopped, GoalChanged -- and they mean four different things.
    // A clean resolve is worth recording too: after an empty path that IS the
    // library's success-shaped no-path (lib/goto.js tests
    // `results.path.length === 0` and cleans up BEFORE it tests
    // `results.status === 'noPath'`), and it is indistinguishable from arrival
    // unless something downstream measures.
    pathSaid = 'resolved'
    const stance = reachGoal(goals, p) ?? new goals.GoalNear(p.x, p.y, p.z, 2)
    try {
      await withTimeout(bot.pathfinder.goto(stance), 15000, bot)
    } catch (e) {
      if (e.aborted || signal?.aborted) throw e
      pathSaid = e?.name && e.name !== 'Error' ? e.name : String(e?.message ?? e).slice(0, 60)
    }
    check(signal)
    // THE WALL IS THE REST OF IT.
    //
    // The goal above is now the server's own reach test, and it still arrives
    // in only 10 of 48 real refusals -- because a legal stance existing is not
    // the same as being able to WALK to one, and the travel profile may not
    // break a block to get anywhere. 35 of those 48 had a stance that was
    // merely behind a wall. So when the cheap walk has not put us in reach, ask
    // the same question again with digging allowed, bounded in cost AND in
    // blocks broken, and walk it only if the plan is small. See
    // src/digapproach.mjs -- both bounds and the measurements live there.
    //
    // Deliberately SECOND. The travel walk is p50 0 ms and handles the case
    // where nothing is in the way; this runs only on the ~18.7% of gather runs
    // that were reporting arrived_out_of_reach.
    if (!(bot.canDigBlock && bot.canDigBlock(bot.blockAt(p)))) {
      const plan = planDigApproach(bot, p, {
        goals,
        reachGoalFor: reachGoal,
        endsInReach: node => nodeToBlock(node, p) <= STANCE_REACH,
      })
      if (plan?.take && bot.withGatherMovements) {
        // EMITTED AFTER THE WALK, WITH THE OUTCOME THE WALK ACTUALLY HAD.
        //
        // The first draft logged status:'success' before attempting anything,
        // which would have made every dig-approach read as a win in exactly the
        // window built to judge whether digging helps. `inReach` is the real
        // endpoint -- the server's own predicate, asked after the fact -- and it
        // is what a difference-in-differences read should use, not the count.
        let said = null
        // THIS WALK WANTS THE HOLE, NOT THE DROP. withTimeout's default installs
        // watchDigging, which cancels any dig of a block the HELD item cannot
        // harvest -- right for the target block, whose drop is the point, and
        // exactly wrong for the blocks in the way of it. Measured on the canary
        // (board-c, f9ddbc4, 90 min): 22 of 38 dig-approaches ended PathStopped,
        // every one of them 1.00 s after the walk began -- the watchdog's first
        // poll -- on a bot holding a stone pickaxe. The plan above has already
        // priced every dig on this path by time and by count, which is the
        // contract withTimeout names for turning the watchdog off.
        //
        // The observer below is PASSIVE: it records which blocks broke, and the
        // first one the held item could not harvest, and cancels nothing. That
        // is what names the block next time instead of the word PathStopped.
        const watch = observeApproachDig(bot)
        let walked
        try {
          await bot.withGatherMovements(() =>
            withTimeout(bot.pathfinder.goto(reachGoal(goals, p) ?? stance), APPROACH_WALK_MS, bot, { needsDrop: false }))
          pathSaid = `${pathSaid}, then dug ${plan.dig} to approach`
        } catch (e) {
          if (e.aborted || signal?.aborted) {
            // A WALK THAT KILLED THE BOT MUST STILL BE IN THE LOG. The abort
            // used to rethrow past the event below, so a death or a reflex
            // seizure during the approach left no `_dig_approach` at all --
            // and two of the five fleet-wide deaths on 6d1fdba were "running
            // gather" with nothing to say whether the walk was digging.
            const w = watch.stop()
            logEvent({ kind: 'dig_approach', status: 'aborted',
                       detail: `${wanted} ${p.x},${p.y},${p.z}: planned ${plan.dig} block(s), aborted ` +
                               `[walk_ms=${w.walkMs} attempted=${w.attempted.length ? w.attempted.join(',') : 'none'} ` +
                               `dug=${w.dug.length ? w.dug.join(',') : 'none'}]` })
            throw e
          }
          said = e?.name && e.name !== 'Error' ? e.name : String(e?.message ?? e).slice(0, 30)
          pathSaid = `${pathSaid}, dig-approach ${said}`
        } finally {
          walked = watch.stop()
        }
        const inReach = !!(bot.canDigBlock && bot.canDigBlock(bot.blockAt(p)))
        logEvent({ kind: 'dig_approach', status: inReach ? 'success' : 'fail',
                   detail: `${wanted} ${p.x},${p.y},${p.z}: planned ${plan.dig} block(s), ` +
                           `in_reach=${inReach}${said ? ` (${said})` : ''} ` +
                           `[visited=${plan.visitedNodes ?? 'na'} ms=${plan.ms} ` +
                           `walk_ms=${walked.walkMs} dig_ms=${Math.round(plan.digMs ?? 0)} ` +
                           `attempted=${walked.attempted.length ? walked.attempted.join(',') : 'none'} ` +
                           `dug=${walked.dug.length ? walked.dug.join(',') : 'none'} ` +
                           `unharvestable=${walked.unharvestable ?? 'none'}` +
                           `${walked.unharvestable ? ` held=${walked.held} window=${walked.window}` : ''}]` })
      } else if (plan?.take) {
        // A plan we are allowed to walk and no way to install the profile is a
        // WIRING failure, not a terrain one, and it must not read as terrain.
        pathSaid = `${pathSaid}, no dig-approach (bot.withGatherMovements is missing)`
      } else if (plan) {
        pathSaid = `${pathSaid}, no dig-approach (${plan.why})`
      }
    }
  }
  check(signal)

  // DID WE ACTUALLY ARRIVE? The stance goal is the right request, but goto()
  // still does not make this postcondition trustworthy by itself.
  //
  // pathfinder's goto RESOLVES AS SUCCESS on an empty path -- lib/goto.js tests
  // `results.path.length === 0` and cleans up BEFORE it tests
  // `results.status === 'noPath'`, so the commonest unreachable case returns
  // like a success rather than throwing. And the dig does not decide:
  // mineflayer's dig never checks range either (canDigBlock is not called
  // anywhere in digging.js).
  //
  // So the bot could stand where it started, dig at a block forty blocks away,
  // and return cleanly having done nothing. That is the shape of the largest
  // bucket in the gather taxonomy: 1,005 runs across 79 bots, 93.1% of them
  // gaining NOTHING, and 26.4% of all time the fleet spends gathering.
  //
  // canDigBlock is the honest test and it is the server's own: diggable, and
  // within 5.1 blocks of the eye.
  //
  // AND IT TESTS THREE THINGS, WHICH USED TO WEAR ONE NAME. `block &&
  // block.diggable && <within 5.1>`: the block is gone, the block cannot be
  // broken by hand, or the bot is short. `arrived_out_of_reach` was thrown for
  // all three, and its message asserted a distance that only means anything in
  // the third case -- so the fleet reported "still 3.1 blocks away" for blocks
  // that had simply been taken by another bot. reachRefusal splits them, and
  // the split is a pure function so it is tested by behaviour rather than by
  // matching this text.
  const here = bot.blockAt(p)
  if (bot.canDigBlock && !bot.canDigBlock(here)) {
    const { failClass, detail } = reachRefusal({
      blockName: here?.name ?? null, wanted, target: p, pathSaid,
      dist: eyeToBlock(bot.entity?.position, p),
    })
    throw Object.assign(new Error(detail), { failClass })
  }
  const wasNamed = here?.name

  const decision = {}
  const tool = bestTool(bot, block, { lastSwing: true, decision })
  // The chosen copy, captured BEFORE the equip (prismarine moves the item object, so its fields after are not proof).
  const chosen = tool ? { name: tool.name, left: remaining(tool) } : null
  if (tool) await bot.equip(tool, 'hand').catch(() => {})
  // A SPENT SWING MUST BE SWUNG WITH THE COPY IT CHOSE. Durability is cached metadata and equip errors are
  // swallowed above, so a copy the server already broke would leave the hand empty and the dig would run
  // bare-handed (Codex review) -- or, with a same-name working copy already in hand, dig with THAT copy (both reviews,
  // 10-03: a name-only check passed it). spentEquipOutcome compares name AND uses: a pickaxe is refused; a 1-use
  // axe/shovel/hoe on a block the hand harvests falls back to the hand (never tossing what is held: emptyHand).
  let lastSwing = !!(chosen && chosen.left <= HARD_STOP)
  if (lastSwing) {
    const outcome = spentEquipOutcome({ chosen, held: bot.heldItem, handOk: handHarvests(block) })
    if (outcome === 'hand') {
      const heldWas = bot.heldItem ? `${bot.heldItem.name} at ${remaining(bot.heldItem)} use(s)` : 'nothing'
      const how = await emptyHand(bot)
      // ITS FREQUENCY IS THE POINT (Claude review): how often a chosen spent copy did not reach the hand.
      logEvent({ kind: 'spent_equip_fallback', status: DIG_TOOL_RE.test(bot.heldItem?.name ?? '') ? 'failed' : 'success', snapshot: snapshot(bot),
                 detail: `${block.name}: chose ${chosen.name} at ${chosen.left} use(s), hand held ${heldWas} after the equip; ` +
                         `emptied the hand (${how}), digging bare-handed` })
      if (DIG_TOOL_RE.test(bot.heldItem?.name ?? '')) {
        throw Object.assign(new Error(`equip_failed: could not hold the spent ${tool.name} nor empty the hand for ${block.name}`), { failClass: 'equip_failed' })
      }
      lastSwing = false   // a bare-hand dig: no spent swing to log
    } else if (outcome === 'refuse') {
      throw Object.assign(new Error(`equip_failed: could not hold the last ${tool.name} for ${block.name}`), { failClass: 'equip_failed' })
    }
  }
  // THE ADMISSION WENT STALE, AND THIS IS THE THIRD AND LAST CALL SITE.
  //
  // gather admits a candidate at scan time and digs it after a walk and an equip.
  // Codex pass 2 executed the production path: admitted at y=70, the goto moved the
  // bot to y=68, and `bot.dig` ran with `standingDry` now null -- the exemption had
  // certified a position the bot no longer occupied. A reflex can move it too, and
  // `equip` itself is an await.
  //
  // So the permission is re-asked HERE, against where the bot actually is, after
  // every await that could have moved it. This is the only place the answer is
  // load-bearing; the filter upstream just decides what to walk toward.
  //
  // Only for a block the ORDINARY rule refuses -- an unexempted block is
  // unaffected, so this cannot make the baseline stricter.
  if (!isSafeToBreak(bot, block.position) && !shorelineExemptAt(bot, block.position)) {
    throw Object.assign(
      new Error(`unsafe_now: ${block.name} at ${block.position.x},${block.position.y},${block.position.z} ` +
                `was admitted from a dry stance and the bot is no longer standing in one`),
      { failClass: 'no_safe_target' })
  }
  // BOUND THE DIG. bot.dig() has no timeout of its own. (An earlier version of
  // this comment said it "resolves when the server confirms the break" -- see
  // the correction below the call; it does no such thing, and believing it did
  // is most of why this path could fail silently.) This is
  // now the ONLY path gather takes, so an unbounded await here would reproduce
  // the exact failure that made collectblock unusable, in our own code.
  // Named `dig` so a dig that never finishes is not filed as a pathing failure,
  // and cleaned up with stopDigging() rather than the pathfinder default --
  // clearing a path goal does nothing for a stuck dig.
  // The caller's last word, immediately before the swing (craft's table retake revalidates ownership here).
  // mineflayer's dig AWAITS a lookAt before it sends block_dig unless forceLook is 'ignore' (digging.js, 4.37.1), and
  // a block can change during that look. So with a hook: look first (instant), ask the hook, then dig with 'ignore'
  // -- no second look, and no await between the last check and the dig packet.
  let forceLook
  if (beforeDig) {
    try { await bot.lookAt(p.offset(0.5, 0.5, 0.5), true) } catch { /* not fatal: the dig still faces the block */ }
    check(signal)
    beforeDig()
    forceLook = 'ignore'
  }
  await withTimeout(bot.dig(block, forceLook), 20_000, bot, {
    what: 'dig',
    onTimeout: () => { try { bot.stopDigging?.() } catch { /* not digging */ } },
  })

  // THE COMMENT ABOVE USED TO SAY dig() "resolves when the server confirms the
  // break". IT DOES NOT. digging.js contains zero ack handling -- it arms
  // `setTimeout(finishDigging, waitTime)` from bot.digTime() and, when that
  // local timer fires, calls `_updateBlockState(block.position, 0)`, writing
  // air into OUR OWN world model. The promise resolving means a timer elapsed,
  // nothing more. A dig the server rejected (out of range, protection,
  // anti-cheat, the block already gone) resolves exactly the same way.
  //
  // Which is why re-reading the block IMMEDIATELY proves nothing either: we
  // would just be reading the air the library wrote. The server is the only
  // authority, and when it disagrees it re-sends the real block -- so wait a
  // few ticks and then look. If the block is still what it was, the break did
  // not happen and calling this a harvest is the same overclaim the evidence
  // gate exists to stop.
  await sleep(250, signal)
  const nowNamed = bot.blockAt(p)?.name
  if (wasNamed && nowNamed === wasNamed && wasNamed !== 'air') {
    throw Object.assign(
      new Error(`dig_unconfirmed: ${p.x},${p.y},${p.z} is still ${nowNamed} after the ` +
                `dig resolved — the server never broke it`),
      { failClass: 'dig_unconfirmed' })
  }
  // Logged only once the block is CONFIRMED broken, with a snapshot, so the row is an outcome and not an
  // intent (both reviews): the canary reads what last swings yielded, not how often the branch was entered.
  // A SPENT COPY USED UP is not a last swing: a 1-use pickaxe spent while a working one is held ('spend_spent') and a
  // 1-use axe/shovel/hoe finished on its own block are `spent_swing`, so the last_swing read keeps its meaning.
  if (lastSwing) {
    logEvent({ kind: decision.reason === 'last_swing' ? 'last_swing' : 'spent_swing', status: 'success', snapshot: snapshot(bot),
               detail: `broke ${wasNamed} at ${p.x},${p.y},${p.z} with a ${chosen.name} at ${chosen.left} use(s) (${decision.reason ?? '?'})` })
  }

  await pickupNearbyItems(bot, signal)
}

/** FOOD_SKIP, read once per process (like PLANT_ENABLED): an env change needs a restart, which a deploy is. */
const FOOD_SKIP = foodSkipMode(process.env)
let foodSkipSaid = null
/**
 * The skip's decision for this bot NOW -> { active, foodsByName }, for skipFoodDrop. auto reads the server's difficulty
 * (foodskip.mjs difficultyOf: the packet as index.mjs recorded it) every call, so a world switched away from peaceful starts picking food up again
 * without a restart. ONE `_food_skip` row per process per change of (decision, difficulty): the canary's liveness row,
 * and the record of which mode a bot ran in.
 */
export function foodSkipNow (bot) {
  const difficulty = difficultyOf(bot)
  const active = foodSkipActive(FOOD_SKIP.mode, difficulty)
  setPeacefulFood(active)
  const said = `${active}|${difficulty}`
  if (said !== foodSkipSaid) {
    foodSkipSaid = said
    try { logEvent({ kind: 'food_skip', status: 'success', detail: foodSkipDetail({ ...FOOD_SKIP, difficulty, active }) }) } catch { /* a row must never break a pickup */ }
  }
  return { active, foodsByName: bot?.registry?.foodsByName ?? null }
}

/** Walk over anything on the floor within a few blocks. */
/**
 * ONE UNREACHABLE DROP MUST NOT ABANDON THE OTHERS.
 *
 * This returned on two conditions that are both about a SINGLE drop -- seeing
 * the same entity id twice, and a goto that threw -- and in both cases it gave
 * up the whole sweep. The nearest item is picked first, so one drop the bot
 * cannot reach sits closest forever and hides every other drop behind it. The
 * bot walks away from wood it has already broken.
 *
 * Measured 24 h to 2026-09-21 19:40Z: gather's own barren-limit message says
 * "[collect threw nothing -- it returned without gathering]" on **3,054 runs,
 * 8.8% of all 34,775 gathers, across 77 of 80 bots**. That message means the
 * collect returned and the inventory did not rise; `digVerified` THROWS
 * dig_unconfirmed when the server did not break the block (6 occurrences in the
 * same window), so the block was broken and the item was left on the ground.
 * That is an upper bound on this defect, not a measurement of it alone.
 *
 * NOT the wood fix, and this comment exists so nobody reads it as one: only 447
 * of those runs (3.1% of the 14,566 log gathers) ask for a log. Wood dies in
 * the candidate filter -- 37.3% no_safe_target, 32.0% unreachable -- long before
 * anything is broken.
 *
 * The budget is unchanged. What changes is which drop the budget is spent on:
 * a drop that refuses is SKIPPED, not surrendered to.
 */
export async function pickupNearbyItems(bot, signal, radius = 8) {
  // Ids that refused us this sweep. Per-sweep, deliberately: a drop unreachable
  // from here may be fine after the next dig moves the bot, and a persistent
  // blacklist of entity ids would outlive the entities.
  const refused = new Set()
  // FOOD IS NOT CHASED IN A PEACEFUL WORLD (foodskip.mjs; FOOD_SKIP=auto|on|off). Read once per sweep. This governs the
  // WALK only: the server still hands over food that lands within ~1 block of the bot.
  const food = foodSkipNow(bot)
  for (let i = 0; i < 4; i++) {
    check(signal)
    const drop = bot.nearestEntity?.(e =>
      e.name === 'item' && !refused.has(e.id) && !neverPickUp(e) &&   // ballast is never chased (hygiene.mjs)
      !skipFoodDrop(e, food) &&                                        // nor food while the skip is active (foodskip.mjs)
      bot.entity.position.distanceTo(e.position) < radius)
    if (!drop) return
    // TELEMETRY ONLY (pickuplog.mjs): a collect of this id while the pursuit lasts reads 'sought'. released when
    // this pursuit ends on every path -- failed, aborted, or after the settle -- so a drop given up on is not.
    const releaseSought = noteSought(bot, drop.id, 'pickup')
    const walkT0 = Date.now()
    try {
      await withTimeout(bot.pathfinder.goto(
        new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1)), 6000, bot)
    } catch (e) {
      releaseSought()
      if (e.aborted || signal?.aborted) throw e
      // The walk failed. That is a fact about THIS drop, so retire it and let
      // the next iteration pick the next-nearest -- the old code returned here
      // and left everything else lying there.
      //
      // THE CHANGE ROW. This function logged nothing, so a read of this fix had no
      // denominator and no row a control pool could not also emit -- three canaries
      // have been reverted on rows the baseline emitted too. HEAD cannot reach this
      // line at all: it returns here.
      // WHY, WHAT AND WHERE (both analyses 2026-09-29: the row carried only an id, so the causes stayed inferred).
      // err= is also the only text a build without this change cannot write.
      let what = '?', off = '?'
      try { what = drop.getDroppedItem?.()?.name ?? '?' } catch {}
      try { const q = drop.position.minus(bot.entity.position); off = `${q.x.toFixed(1)},${q.y.toFixed(1)},${q.z.toFixed(1)}` } catch {}
      refused.add(drop.id)
      logEvent({ kind: 'pickup_skipped', status: 'success',
                 detail: `drop ${drop.id} refused the walk; retired it and kept sweeping ` +
                         `(${refused.size} retired, attempt ${i + 1}/4) err=${e?.failClass ?? e?.name ?? 'Error'} ` +
                         `item=${what} d=${off} ms=${Date.now() - walkT0}` })
      continue
    }
    try { await sleep(250, signal) } finally { releaseSought() }
    // ONE WALK PER DROP PER SWEEP, whatever happened.
    //
    // The first draft retired a drop only when the bot ended up >= 2 blocks
    // away, and the test caught it orbiting: `pathfinder.goto` resolves on
    // reaching the goal it could COMPUTE, so a drop sitting inside foliage is
    // one block away, uncollected, and passes a distance check forever. A
    // collected drop is gone from the world and this costs nothing; an
    // uncollected one gets the rest of the sweep spent on its neighbours.
    refused.add(drop.id)
  }
}

/**
 * The drop under a canopy: from the feet, skip the foliage column, then count the air to the first solid block.
 * ok when that fall is at most `maxDrop` (a foliage column that is itself 20 deep is 20 blocks of falling); refuses
 * on unknown cells, liquid (a pond under the tree is a swim, but this loop digs blind), lava, or a longer fall.
 */
/** What the canopy descent may REMOVE: leaves and vines. A log is support (Codex: digging the log under the feet is the fall). */
export const CANOPY_REMOVABLE = /(_leaves|vine)$/
export function canopyDrop (at, pos, { maxDrop = 3, reach = 40 } = {}) {
  const x = Math.floor(pos.x), z = Math.floor(pos.z); const y0 = Math.floor(pos.y) - 1; let fall = 0
  // Walk down from the feet: every removable block will be dug and every air cell will be fallen through, so both
  // count as fall (a leaf found below a gap is not ground: the loop would dig it too). The first solid block that
  // is not removable is the landing; unknown, liquid and lava refuse by name.
  for (let dy = 0; dy <= reach; dy++) {
    const b = at(x, y0 - dy, z); if (!b) return { ok: false, why: 'unknown below' }
    if (/lava|magma|fire/.test(b.name)) return { ok: false, why: `${b.name} below the foliage` }
    if (/water/.test(b.name)) return { ok: false, why: 'water below the foliage (a swim, not a dig)' }
    if (b.boundingBox === 'block' && !CANOPY_REMOVABLE.test(b.name)) return fall <= maxDrop ? { ok: true, fall } : { ok: false, why: `a fall of ${fall} to the first solid block (limit ${maxDrop})`, fall }
    fall++
  }
  return { ok: false, why: `no solid block within ${reach} below` }
}

// ------------------------------------------------------------- tunnel to ore -----
const TUNNEL_STALL_MS = 6000
const TUNNEL_TRIES = 3
//
// Reach buried iron the bot already knows about (oretunnel.mjs says why and how). Called by gather in place of
// the old `mine({y})` escalation, for iron only. Every refusal names a remedy the bot can perform from where it
// stands and carries a class with no vote; the outcome row is written from the inventory, not the plan.
async function tunnelToOre(ctx, signal, { deadlineMs = 150_000 } = {}) {
  const { bot, runner } = ctx
  const t0 = Date.now()
  deadlineMs = Math.min(150_000, deadlineMs)
  const out = (res, extra) => {
    logEvent({ kind: 'ore_tunnel', status: res.status === 'success' ? 'success' : 'failed', snapshot: snapshot(bot),
               detail: `${res.status}${res.failClass ? `/${res.failClass}` : ''}: ${extra}`.slice(0, 300) })
    return res
  }
  // TIME FIRST: gather's contract is 180 s end to end and the ore still has to be collected after arrival.
  if (deadlineMs < 30_000) {
    return out({ status: 'failed', failClass: 'no_tunnel', detail: 'too little of this gather left to tunnel -- ask for the ore again' }, `refused: ${Math.round(deadlineMs / 1000)} s left`)
  }
  // ROOM FIRST: a tunnel yields ~2.4 cobblestone per block of depth plus the ore.
  if ((bot.inventory?.emptySlotCount?.() ?? 0) < 2) {
    return out({ status: 'failed', failClass: 'inventory_full', detail: 'no room for what a tunnel yields — deposit first' }, 'refused: inventory full')
  }
  const ids = IRON_KINDS.map(n => bot.registry.blocksByName[n]?.id).filter(id => id != null)
  const feet = bot.entity.position.floored()
  const at = q => bot.blockAt(q)
  const found = bot.findBlocks({ matching: ids, maxDistance: CANDIDATE_RADIUS, count: 64 }) ?? []
  // The ORE's own dig happens outside the pathfinder, so its hazard check happens here.
  const home = { x: config.world.homeX, z: config.world.homeZ }
  const candidates = rankCandidates(feet, found.filter(q => breakHazard(at, bot.blockAt(q)) === 0 && !nearHome(q, home)))
  if (!candidates.length) {
    return out({ status: 'failed', failClass: 'no_tunnel', detail: `iron within ${CANDIDATE_RADIUS} blocks, but every ore has liquid or a falling block beside it` }, `refused: ${found.length} found, 0 safe`)
  }
  const moves = bot.tunnelMovements ?? tunnelMovements(bot, bot.gatherMovements, { home })
  const plan = await planTunnel(bot, { candidates, moves })
  check(signal)
  if (!plan.ok) {
    return out({ status: 'failed', failClass: 'no_tunnel', detail: `no safe tunnel to iron: ${plan.why}` }, `refused: ${plan.why} over ${candidates.length} candidate(s) in ${plan.ms} ms`)
  }
  const cluster = clusterOf(at, plan.target)
  const pickBreaks = plan.breaks.filter(q => /pickaxe/.test(bot.blockAt(q)?.material ?? '')).length
  const budget = tripDecision(bot.inventory.items(), { pickBreaks, cluster: cluster.length })
  if (budget.refuse === 'too_long') {
    return out({ status: 'failed', failClass: 'no_tunnel', detail: `the nearest iron is ${plan.breaks.length} blocks of digging away, more than one stone pickaxe lasts` },
               `refused: needs ${budget.need} uses > ${ONE_PICK_USES}; plan ${plan.breaks.length} breaks, cluster ${cluster.length}, ${plan.ms} ms`)
  }
  if (budget.refuse === 'pickaxe_short') {
    // PICKAXE FIRST (owner): the remedy is a task the bot adopts, not advice it may ignore.
    return out({ status: 'failed', failClass: 'pickaxe_short',
                 // minUses is THIS trip's need, not a constant (both reviews): a 40-use copy must not "satisfy" a 60-use
                 // trip and send the bot straight back to the same refusal. need <= ONE_PICK_USES, so a fresh stone pick meets it.
                 need: { items: ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'], count: 1, minUses: budget.minUses,
                         because: `a tunnel to iron needs ${budget.need} pickaxe uses (${budget.why})` },
                 detail: `iron is ${plan.breaks.length} blocks of digging away but ${budget.why} — craft a stone_pickaxe first` },
               `refused: ${budget.why}; plan ${plan.breaks.length} breaks (${pickBreaks} pick), cluster ${cluster.length}, ${plan.ms} ms`)
  }

  const claim = runner?.claimBody?.('stair') ?? null      // the entombment reflex reads a staircase as sealed
  let reached = false, stopped = null, recentred = 0
  // index.mjs owns setMovements: the walk runs inside its tunnel profile and is restored there, whatever happens.
  const inTunnel = fn => (bot.withTunnelMovements ? bot.withTunnelMovements(fn) : fn())
  // A BOT OFF-CENTRE IN A 1-WIDE TUNNEL WEDGES AGAINST THE WALL. On the sandbox, walks that stalled had drifted
  // sideways (z 236.5 -> 236.7) and the pathfinder re-tried the same blocked step until the stuck reflex fired at
  // 35 s. So the tunnel watches its own progress: no movement and no dig for STALL_MS -> stop the walk, re-centre
  // on the current block, and resume, up to TUNNEL_TRIES times -- long before the reflex.
  const walkLeg = () => new Promise((resolve, reject) => {
    let last = bot.entity.position.clone(), moved = Date.now(), stalled = false
    const watch = setInterval(() => {
      const q = bot.entity.position
      if (q.distanceTo(last) > 0.3 || bot.targetDigBlock) { last = q.clone(); moved = Date.now() }
      else if (Date.now() - moved > TUNNEL_STALL_MS && !stalled) { stalled = true; try { bot.pathfinder.setGoal(null) } catch {} }
    }, 500)
    const legMs = Math.max(5000, Math.min(deadlineMs - (Date.now() - t0), 20_000 + plan.breaks.length * 2500))
    // ABORT STOPS THE WALK (Codex review): goto has no signal, so a cancelled gather would keep digging.
    const onAbort = () => { try { bot.pathfinder.setGoal(null) } catch {} }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    withTimeout(bot.pathfinder.goto(plan.goal), legMs, bot, { needsDrop: false })
      // ARRIVAL IS CHECKED, NOT ASSUMED (both reviews): pathfinder's goto resolves on ANY path_update with an empty
      // path, including a failed search (mineflayer-pathfinder lib/goto.js). Short of the goal is a stall, not success.
      .then(() => (plan.goal.isEnd(bot.entity.position.floored()) ? resolve()
                   : reject(Object.assign(new Error('the walk ended short of the ore'), { stalled: true }))),
            e => reject(Object.assign(e ?? new Error('walk failed'), { stalled })))
      .finally(() => { clearInterval(watch); signal?.removeEventListener?.('abort', onAbort) })
  })
  try {
    const renew = setInterval(() => claim?.renew?.(), 1000)
    try {
      for (let attempt = 0; attempt < TUNNEL_TRIES && !reached; attempt++) {
        try { await inTunnel(walkLeg); reached = true }
        catch (e) {
          if (e?.aborted || signal?.aborted) throw e
          stopped = `walk: ${String(e?.message ?? e).slice(0, 50)}`
          if (!e?.stalled || Date.now() - t0 > deadlineMs) break
          const f = bot.entity.position.floored()
          try { await inTunnel(() => withTimeout(bot.pathfinder.goto(new goals.GoalBlock(f.x, f.y, f.z)), 4000, bot, { needsDrop: false })) } catch (e2) { if (e2?.aborted || signal?.aborted) throw e2 }
          recentred++
        }
      }
      if (!reached) throw Object.assign(new Error(stopped ?? 'walk failed'), { soft: true })
      // SETTLE BEFORE ANYONE DIGS. On the sandbox a dig issued the instant the tunnel walk resolved hung for the
      // full 20 s dig timeout (three runs), while the SAME ore dug cleanly moments later through gather's rescan,
      // and a controlled test beside an ore (stone or air above) dug fine. So the tunnel only ARRIVES; gather's
      // own, tested collection takes the ore it exposed.
      await bot.waitForTicks?.(10)
    } catch (e) {
      if (e?.aborted || signal?.aborted) throw e
      if (!e?.soft) stopped = `walk: ${String(e?.message ?? e).slice(0, 50)}`
    } finally { clearInterval(renew) }
  } finally {
    // ON ARRIVAL THE CLAIM IS KEPT, NOT RELEASED: the bottom of a staircase is exactly what isEntombed reads as a
    // trap (solid ceiling, 3 walls, terrain above), and on the sandbox the entombment reflex pillared the bot out
    // the moment the tunnel let go, before gather could take the ore. Renewed once here, it lapses on its own after
    // Runner.CLAIM_STEP_TTL_MS or when this gather run ends (the runner drops claims of a finished run).
    if (reached) claim?.renew?.()
    else claim?.release?.()
  }
  const summary = `${plan.breaks.length} planned breaks (${pickBreaks} pick) to ${plan.target.x},${plan.target.y},${plan.target.z}, ` +
                  `cluster ${cluster.length}, uses ${budget.haveAll}/${budget.need}, plan ${plan.ms} ms, min y ${plan.minY}; ` +
                  `reached ${reached}, re-centred ${recentred}, ${Math.round((Date.now() - t0) / 1000)} s` + (stopped && !reached ? `; stopped: ${stopped}` : '')
  return reached
    ? out({ status: 'success', detail: `tunnelled to iron at ${plan.target.x},${plan.target.y},${plan.target.z}` }, summary)
    : out({ status: 'failed', failClass: 'tunnel_incomplete', detail: `could not finish the tunnel to iron${stopped ? ` (${stopped})` : ''}` }, summary)
}

async function gather(ctx, { block: blockName, count = 16, maxDistance = 32 }, signal) {
  const gatherT0 = Date.now()   // the tunnel's deadline is what is left of gather's 180 s contract, less time to collect
  maxDistance = Math.min(Number(maxDistance) || 32, 48)   // callers cannot opt back into the blowup
  const { bot } = ctx
  const asked = blockName
  const resolved = resolveBlockName(bot, blockName)
  if (!resolved.name) {
    return { status: 'failed', failClass: 'unknown_block',
             detail: `unknown block "${blockName}" — no block by that name, and no ore, ` +
                     `block or log variant of it either` }
  }
  let renamed = resolved.via
  blockName = resolved.name
  const deep = depthVariant(bot, blockName, bot.entity?.position?.y ?? 64)
  if (deep) {
    renamed = `${renamed ? renamed + '; ' : ''}below y=0, so ${blockName} -> ${deep}`
    blockName = deep
  }
  const type = bot.registry.blocksByName[blockName]

  const descent = await descendToGround(ctx, signal).catch(e => (e?.aborted ? Promise.reject(e) : { failed: true, why: `the canopy descent threw: ${String(e?.message ?? e).slice(0, 40)}` }))
  check(signal)
  if (descent && (descent.refused || descent.failed)) {   // stranded on a canopy the descent would not or could not leave: no gather from here (its mine would dig the same floor)
    return { status: 'failed', detail: `stranded on foliage: ${descent.why}; not digging down — the escape ladder owns this descent`, failClass: descent.refused ? 'canopy_refused' : 'canopy_failed' }
  }

  // GRADE THE DROP, NOT THE BLOCK. Stone does not drop stone. See drops.mjs:
  // this counter could never rise for stone/coal_ore/iron_ore, so the skill
  // reported failure every time it worked -- 13,550 `gather stone` attempts
  // with zero recorded successes, ever.
  const startHeld = heldFromBlock(bot, blockName)
  const wantDrops = dropsOf(bot.registry, blockName)
  if (wantDrops.length === 1 && wantDrops[0] === blockName &&
      !bot.registry?.blocksByName?.[blockName]?.drops?.length) {
    // LOUD FALLBACK. Falling back to the block's own name is what the old code
    // did implicitly for every block; doing it silently is how this survived
    // for months. If a block genuinely has no modelled drop, say so once so the
    // gap is visible rather than inferred from a zero.
    logEvent({ kind: 'unknown_drop_mapping', status: 'failed',
               detail: `no drop mapping for ${blockName}; scoring on its own name`,
               snapshot: snapshot(bot) })
  }
  // Per RUN. Cleared when gather returns, because a block unreachable from here
  // may be perfectly reachable once the bot has moved -- so this must not become
  // a persistent blacklist. A durable claim belongs in the lessons store, and a
  // transient geometric fact is not one.
  const excluded = new Set()
  const key = q => `${q.x},${q.y},${q.z}`
  let collected = 0, rounds = 0, barren = 0, timedOut = 0
  // Rounds this RUN whose candidates came only from the cover fallback. Run-scoped
  // on purpose: `viaCover` resets every round, and the question this answers is
  // about the whole run's failure class. See `barrenFailClass`.
  let coverRounds = 0
  // The most recent reachability probe, so the failure can cite what A* said.
  let lastProbe = null
  // Verbatim collectblock failure messages, so a refusal it makes can be read
  // rather than guessed at. Bounded: a wedged loop must not grow an array.
  const collectErrors = []
  // One escalation to `mine` per gather run, and what it said. Once, because a
  // gather that tunnels on every round is a gather that never returns.
  let escalated = false
  let mineSaid = null
  const maxRounds = count * 4 + 8

  while (collected < count && rounds < maxRounds) {
    check(signal)
    rounds++

    // ASK FOR THE ITEM, ACCEPT ANY BLOCK THAT YIELDS IT.
    //
    // Natural dirt on a plain is capped by grass_block, so every dirt candidate
    // reads as "buried" and the skill refuses. In this pool's last 12 hours
    // `gather dirt` failed 520 times out of 1,084 gather calls -- 48% of all
    // gathering -- for the one item the exit contract, climbAdvice and
    // climbPrerequisite all demand. The bot was standing on its answer.
    //
    // DELIBERATELY A FALLBACK, NOT A WIDENING. The exact block is searched
    // first and alternates are consulted only when it found nothing, so this
    // can only turn a failure into an attempt. It never redirects a search that
    // was already working.
    let positions = bot
      .findBlocks({ matching: type.id, maxDistance, count: 32 })
      .filter(p => horizontalDistanceFromSpawn(p) <= config.world.borderRadius)
    let viaSource = null
    // How many foliage-covered logs the fallback below admitted this round, or 0.
    // Carried so the run's OUTCOME can be reported against it: 'the fallback fired'
    // and 'the fallback produced a log' are two claims and only the second is the point.
    let viaCover = 0
    if (positions.length === 0) {
      for (const alt of sourcesOf(bot.registry, blockName)) {
        if (alt === blockName) continue
        const altType = bot.registry?.blocksByName?.[alt]
        if (!altType) continue
        const found = bot
          .findBlocks({ matching: altType.id, maxDistance, count: 32 })
          .filter(p => horizontalDistanceFromSpawn(p) <= config.world.borderRadius)
        if (found.length) {
          positions = found
          viaSource = alt
          logEvent({ kind: 'gather_via_source', status: 'success',
                     detail: `no ${blockName} exposed; ${alt} yields it — ` +
                             `${found.length} candidate(s)`,
                     snapshot: snapshot(bot) })
          break
        }
      }
    }

    if (positions.length === 0) {
      return collected > 0
        ? { status: 'success', detail: `collected ${collected} ${blockName} (none left within ${maxDistance})` }
        : { status: 'failed', failClass: 'nothing_found',
            detail: `no ${blockName} within ${maxDistance} blocks` +
              (renamed ? ` (read ${asked} as ${blockName}: ${renamed})` : '') +
              belowGroundHint(bot) }
    }

    // ONE block per collect() call. Passing a batch makes collectblock work
    // through them sequentially inside a single await, so the timeout below
    // covers the whole batch rather than one attempt -- observed collecting 3
    // logs successfully and then reporting failure because block 4 ran the
    // clock out. One at a time also means every call ends in movement, which
    // keeps the stuck reflex's timer honest.
    // Skip targets that are fully enclosed. collectblock runs its own movements
    // WITH digging enabled, so an embedded block turns A* loose on a solid
    // volume where nearly every neighbour is a legal move. The open set explodes
    // and the process dies.
    //
    // Measured: `gather stone` at y=68 took Gather02 from 130MB to 3.3GB in
    // ~200s -- roughly 1GB/min, twenty times any other bot -- and killed it with
    // "JavaScript heap out of memory" four times in two hours. Raising
    // --max-old-space-size to 3GB did not help; it blew through that too,
    // because the search SPACE is the problem, not the ceiling.
    //
    // Deliberately a measurement rather than a list of banned blocks: any block
    // with no exposed face must be tunnelled to, whatever it is called.
    // Ubiquitous underground blocks are just where it surfaces first, and `mine`
    // is the skill that descends on purpose.
    // WATER IS NOT AN OPENING, AND A WET BLOCK IS NOT A TARGET.
    //
    // This counted `water` as an exposing face, so a stone block with water
    // behind it scored as exposed and was RANKED AS PREFERRED. collectblock
    // then dug it, the water flowed into the hole, and the bot was standing in
    // it. We have been selecting the blocks that drown us, on purpose, and the
    // drowning reflex only ever got to clean up afterwards -- it fired 209
    // times an hour on one run, mostly at y=-8 to -12.
    //
    // Water is also not somewhere the bot can stand to mine from, so it never
    // belonged in this test on reachability grounds either.
    const exposed = p => isExposed(bot, p)
    // Ask the pathfinder whether the block is safe to break at all. safeToBreak
    // refuses anything adjacent to a liquid (dontCreateFlow) and anything under
    // a block that can fall (dontMineUnderFallingBlock), both of which our own
    // filters never considered. The Movements we lend collectblock already has
    // both flags set, so this is a test we could always have run and never did.
    // ONE OF EXACTLY TWO CALL SITES for the shoreline exemption. The other is the
    // observation in prompt.mjs, and they must move together: relax the filter
    // without relaxing what the model is told and it keeps reading
    // `exposed_safe=0` and steers away from targets the skill just unlocked.
    // That is the `model-cannot-see-it` failure, which cost four in one day.
    // IRON GETS THE TUNNEL'S SIX-FACE CHECK (Codex review): after a tunnel arrives, gather's own collection takes the
    // cluster, and collectblock's safeToBreak does not look below or at unloaded faces.
    const ironStrict = IRON_KINDS.includes(blockName)
    const safeTarget = p => (isSafeToBreak(bot, p) || shorelineExemptAt(bot, p)) && (!ironStrict || breakHazard(q => bot.blockAt(q), bot.blockAt(p)) === 0)
    // Prefer blocks the bot can STAND BESIDE. `exposed` only asks whether the
    // block has an air face, which is true of every log in a tree canopy -- so
    // findBlocks would return a trunk section five blocks up in the foliage,
    // collectblock would try to path into mid-air, and the skill returned
    // "oak_log found but unreachable after 4 attempts". That was the dominant
    // failure once the fleet finally reached a forest.
    //
    // Standing room means: feet clear, HEAD clear, solid ground underfoot --
    // the same test that took unstick from 0/16 to working. A block with a
    // standable neighbour is one the bot can walk up to and mine.
    const standable = q => {
      const pass = b => !b || b.name === 'air' || b.boundingBox === 'empty'
      const feet = bot.blockAt(q), head = bot.blockAt(q.offset(0, 1, 0)), under = bot.blockAt(q.offset(0, -1, 0))
      return pass(feet) && pass(head) && under && under.boundingBox === 'block'
    }
    const approachable = pos => {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (const dy of [0, -1]) if (standable(pos.offset(dx, dy, dz))) return true
      }
      return false
    }
    // Approachable first, nearest first within that -- but keep merely-exposed
    // blocks as a fallback so a slightly awkward target still beats giving up.
    const exposedOnes = positions.filter(exposed)
    // Safety is a filter, not a ranking: a block beside water is never a target,
    // however convenient it looks. Counted separately so "everything nearby is
    // wet" is a distinguishable answer rather than folding into "buried".
    const safeOnes = exposedOnes.filter(safeTarget)
    const rejectedUnsafe = exposedOnes.length - safeOnes.length
    // THE CHANGE ROW, and a canary without one is unreadable.
    //
    // `shorelineExemptAt` is otherwise silent, so nothing in telemetry would say the
    // exemption had ever fired -- and three canaries here have been reverted on rows a
    // CONTROL pool emitted too. This kind exists only in this build.
    //
    // Counted once per round rather than per candidate: `safeTarget` runs over every
    // exposed position, and a row per candidate would be thousands per bot-hour. The
    // count is recomputed rather than accumulated inside the filter, because a filter
    // with a side effect is a filter that reorders differently when you add a log line.
    try {
      const exempted = safeOnes.filter(q => !isSafeToBreak(bot, q)).length
      if (exempted > 0) {
        logEvent({ kind: 'shoreline_exempt', status: 'success',
                   detail: `${blockName}: ${exempted} of ${exposedOnes.length} exposed candidate(s) ` +
                           `admitted past the liquid rule as shoreline logs ` +
                           `(${rejectedUnsafe} still refused)`,
                   snapshot: snapshot(bot) })
      }
    } catch { /* a measurement may never cost the skill its turn */ }
    let reachable = [
      ...safeOnes.filter(approachable),
      ...safeOnes.filter(q => !approachable(q)),
    ]

    // ASK A* WHICH ONE IS ACTUALLY REACHABLE INSTEAD OF GUESSING.
    //
    // `approachable` above is a LOCAL test: it asks whether a standable cell
    // exists beside the block, which says nothing about whether the bot can get
    // to that cell. Measured over 5h on 80 bots, `found but unreachable` was
    // 1,625 of 5,799 gather attempts (28.0%) across 77 of 80 bots -- and 22.3%
    // even among the 73 bots travelling freely, so it is what the HEALTHY fleet
    // spends its gathering on, not a stuck-bot artifact.
    //
    // The local stencil also misses real stances: approach from above, standing
    // on the block below, and terrain shelves further than dy -1. GoalGetToBlock
    // accepts all of those, because its isEnd is orthogonal adjacency including
    // vertical, and the composite asks about every candidate in ONE search.
    //
    // REORDER ONLY. A miss changes nothing -- see the note in reachprobe.mjs:
    // the probe walks and collectblock digs, so `noPath` here would be an
    // over-broad refusal, and refusals that outrun their evidence are the most
    // repeated mistake in this file.
    const probe = probeReachable(bot, reachable, { goals })
    if (probe) {
      if (probe.hit) {
        const i = reachable.findIndex(q =>
          Math.floor(q.x) === probe.hit.x && Math.floor(q.y) === probe.hit.y &&
          Math.floor(q.z) === probe.hit.z)
        if (i > 0) reachable = [reachable[i], ...reachable.slice(0, i), ...reachable.slice(i + 1)]
      }
      lastProbe = probe
      logEvent({
        kind: 'reach_probe',
        status: probe.hit ? 'success' : 'no_effect',
        detail: `${blockName} slate=${probe.checked} status=${probe.status} ` +
                `hit=${probe.hit ? `${probe.hit.x},${probe.hit.y},${probe.hit.z}` : 'none'} ` +
                `moved_to_front=${probe.hit ? 'yes' : 'no'} ` +
                `visited=${probe.visitedNodes ?? 'na'} nearest=${probe.nearest?.toFixed(1) ?? 'na'} ` +
                `ms=${probe.ms}`,
      })
    }

    // THE TRAP IS HERE, NOT AT "FOUND NOTHING".
    //
    // Natural dirt on a plain IS found -- findBlocks returns plenty -- and then
    // every candidate fails `exposed` because grass_block caps it. So the
    // fallback fired at `positions.length === 0` never ran for the case it was
    // written for. Caught by watching `gather_via_source` stay at zero while
    // `gather dirt` kept failing on the canary, four minutes after deploying it.
    //
    // Still a fallback: it runs only when the exact block yielded no reachable
    // candidate, so it can only turn a failure into an attempt.
    if (reachable.length === 0 && !viaSource) {
      for (const alt of sourcesOf(bot.registry, blockName)) {
        if (alt === blockName) continue
        const altType = bot.registry?.blocksByName?.[alt]
        if (!altType) continue
        const found = bot
          .findBlocks({ matching: altType.id, maxDistance, count: 32 })
          .filter(q => horizontalDistanceFromSpawn(q) <= config.world.borderRadius)
        const cand = found.filter(exposed).filter(safeTarget)
        const ok = [...cand.filter(approachable), ...cand.filter(q => !approachable(q))]
        if (ok.length) {
          reachable = ok
          viaSource = alt
          logEvent({ kind: 'gather_via_source', status: 'success',
                     detail: `every ${blockName} candidate was buried or unsafe; ` +
                             `${alt} yields ${blockName} — ${ok.length} reachable`,
                     snapshot: snapshot(bot) })
          break
        }
      }
    }

    // COVER IS NOT BURIAL -- AND IT IS THE LAST THING TRIED, NOT THE FIRST.
    //
    // Same gate as `gather_via_source` directly above, and for the same reason:
    // this runs only when the exact block yielded no reachable candidate, so it
    // can only turn a failure into an attempt. leaf-01 (2850cde) put these same
    // blocks into the main candidate list instead and read **-0.65 DiD on logs
    // acquired** -- the reach probe promoted a covered log over an open one,
    // because its goal tests distance and foliage does not stop a hit. See
    // `foliageCovered`. The admission rule here is byte-for-byte leaf-01's; the
    // rank is the only thing that changed.
    //
    // NOT PROBED, deliberately. The probe is a REORDER, and there is nothing
    // left to reorder: this list is built at the point where the alternative
    // was returning `unreachable`.
    //
    // `collected === 0` is duplicated here and inside `coverFallback`. The
    // duplication is the point: the guard here is what a reader of gather sees,
    // and the one in the function is what the test can ask.
    if (reachable.length === 0 && collected === 0) {
      const slate = coverFallback(
        reachable, positions.filter(q => foliageCovered(bot, q)).filter(safeTarget),
        { approachable, collected })
      if (slate) {
        reachable = slate
        viaCover = slate.length
        coverRounds++
        logEvent({ kind: 'gather_cover_fallback', status: 'success',
                   detail: `every ${blockName} candidate was buried or unsafe; ` +
                           `${slate.length} are logs covered by foliage — trying them`,
                   snapshot: snapshot(bot) })
      }
    }

    if (reachable.length === 0) {
      if (collected > 0) {
        return { status: 'success', detail: `collected ${collected} ${blockName} (the rest are buried or unsafe)` }
      }
      if (rejectedUnsafe > 0 && exposedOnes.length === rejectedUnsafe) {
        // SAY WHICH RULE REFUSED, not "one of these two".
        //
        // safeToBreak ORs dontCreateFlow with dontMineUnderFallingBlock, so
        // every refusal has read identically and the message had to name both.
        // 18% of gather runs end here and a third of them are SAND, which is
        // itself a falling block -- so the share attributable to liquid is
        // unknown, and the only proxy available from telemetry bounds it
        // between 3% and 97%. That is too wide to decide anything on.
        const why = { liquid: 0, falling: 0, entity: 0, both: 0, unknown: 0 }
        for (const q of exposedOnes) why[breakVetoAt(bot, q) ?? 'unknown']++
        const named = Object.entries(why).filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' ')
        // THE MEASUREMENT, EMITTED SEPARATELY so the model-facing sentence below
        // is byte-for-byte what it was. `why` is the veto's own vocabulary and is
        // untouched; this says which liquid sat on which face, without collapsing
        // a mixed neighbourhood to a winner.
        try {
          const faces = {}
          for (const q of exposedOnes) {
            const m = bot.collectBlock?.movements ?? bot.pathfinder?.movements
            if (typeof m?.getBlock !== 'function') continue
            const lbl = liquidFacesLabel(liquidFaces({
              above: m.getBlock(q, 0, 1, 0),
              sides: [m.getBlock(q, -1, 0, 0), m.getBlock(q, 1, 0, 0),
                      m.getBlock(q, 0, 0, -1), m.getBlock(q, 0, 0, 1)],
            }))
            faces[lbl] = (faces[lbl] ?? 0) + 1
          }
          // TRUNCATION WOULD EAT EXACTLY WHAT THIS IS FOR (Codex pass 2).
          // logger.mjs caps event detail at 300 characters. Sorted by frequency,
          // a long tail of mixed neighbourhoods pushes the RARE buckets off the
          // end -- and the rare bucket is lava, the one case nobody may relax.
          // So: anything naming lava or an unknown fluid is emitted FIRST, the
          // list is capped explicitly, and the count of buckets is carried so a
          // reader can tell a short list from a truncated one.
          const ordered = orderFaceBuckets(faces)
          const shown = ordered.slice(0, 6)
          const facesNamed = shown.map(([k, n]) => `${k}:${n}`).join(' ')
          if (facesNamed) {
            logEvent({ kind: 'veto_faces', status: 'no_effect',
                       detail: `${blockName} ${rejectedUnsafe} unsafe candidate(s) [${named}] ` +
                               `faces ${facesNamed}` +
                               (ordered.length > shown.length
                                 ? ` (+${ordered.length - shown.length} more of ${ordered.length})`
                                 : ` (${ordered.length} kind(s))`) })
          }
        } catch { /* a measurement may never cost the skill its turn */ }
        return { status: 'failed', failClass: 'no_safe_target',
                 vetoCause: why,
                 detail: `${blockName} found but all ${rejectedUnsafe} candidates are beside water or ` +
                         `under falling blocks — digging them would flood or bury this spot [${named}]` }
      }
      // "USE MINE TO DIG DOWN" IS ADVICE, AND ADVICE PRINTED IS NOT ADVICE TAKEN.
      //
      // This is the same defect as the craft->gather boundary already documented
      // in this file: a skill that knows the next move prints it as prose and
      // hopes the model acts on it. Measured before this change, over 5h on 80
      // bots: `gather iron_ore` was asked 307 times and succeeded TEN, and
      // 176 of the 297 failures (59%) were exactly this line. Iron was visible
      // in perception 210,601 times and USABLE 4.2% of the time -- because
      // underground ore has no exposed face, and `gather` requires one.
      //
      // So gather escalates to `mine` itself, once per run, and then rescans.
      //
      // ONLY FOR THINGS WORTH A TUNNEL. Buried dirt is not worth digging for --
      // there is exposed dirt on every hillside -- and escalating for it would
      // turn a cheap failure into an expensive one across the whole fleet. Ores
      // are the case where the buried copy is the ONLY copy, which is why this
      // is the block list and not a general rule.
      //
      // `mine` keeps its own exit contract, so a bot that cannot afford the
      // climb back out is still refused -- by the guard that owns that
      // question, not by this one. Its answer is reported verbatim rather than
      // reclassified, because a refusal is evidence and this file has been
      // bitten before by deriving a failure class from prose.
      // IRON TUNNELS TO THE ORE IT CAN SEE (oretunnel.mjs), instead of stairing toward dryness. Once per run.
      if (IRON_KINDS.includes(viaSource ?? blockName) && !escalated) {
        escalated = true
        check(signal)
        const dug = await tunnelToOre(ctx, signal, { deadlineMs: SKILL_CONTRACTS.gather.maxMs - (Date.now() - gatherT0) - 30_000 })
        mineSaid = dug?.detail ?? null
        if (dug?.status === 'success') continue     // rescan: the tunnel exposed the ore; gather's own collection takes it
        // inventory_full FALLS THROUGH (Claude review): its remedy, deposit, cannot be performed while the chests are full.
        if (dug?.need || dug?.failClass === 'pickaxe_short') return dug   // the remedy is the answer
      }
      if (WORTH_TUNNELLING.test(viaSource ?? blockName) && !escalated) {
        escalated = true
        const nearest = positions[0]
        const depth = nearest ? Math.floor(nearest.y) : Math.floor(bot.entity.position.y) - 8
        logEvent({ kind: 'gather_escalated_to_mine', status: 'success',
                   detail: `${blockName}: every candidate buried, digging toward y=${depth}` })
        check(signal)
        const dug = await mine(ctx, { y: depth }, signal).catch(e => ({ status: 'failed', detail: String(e?.message ?? e) }))
        mineSaid = dug?.detail ?? null
        if (dug?.status === 'success') continue     // rescan: the tunnel may have exposed one
      }
      return { status: 'failed', failClass: 'unreachable',
               detail: `${blockName} found but every candidate is buried — use mine to dig down` +
                       belowGroundHint(bot) +
                       (mineSaid ? ` [mine said: ${String(mineSaid).slice(0, 110)}]` : '') }
    }

    // SKIP WHAT ALREADY REFUSED US, PER RUN.
    //
    // This was `reachable[0]` and the candidate list is re-scanned every round,
    // so the same block could be picked forever. Measured before the fix: 63.9%
    // of consecutive gather pairs were "failed, then re-asked the SAME block",
    // 89% of all attempts sat inside a same-block streak (median 4, max 58), and
    // a retry after failure succeeded 9.6% against a 15.8% baseline. The loop
    // was not converging; it was orbiting.
    //
    // Now that `arrived_out_of_reach` exists we know WHY it orbited: 134 events
    // across 44 of 80 bots, against ZERO dig_unconfirmed. The bot could not get
    // to that block, and nothing about re-picking it changes that. Every other
    // agent project that works has this set -- Cairn keeps `s.excluded`,
    // mindcraft passes an `exclude` list -- and ours did not.
    //
    // Per RUN, deliberately: a block that is unreachable from here may be fine
    // once the bot has moved, so this must not become a persistent blacklist.
    // The lessons store is where a durable claim would belong, and a transient
    // geometric fact is not one.
    const nextUp = reachable.find(q => !excluded.has(key(q)))
    if (!nextUp) {
      // Every candidate has already refused us this run. Re-scanning cannot
      // produce a different answer, so stop rather than spend the budget.
      if (collected > 0) {
        return { status: 'success',
                 detail: `collected ${collected} ${blockName} (the rest could not be reached from here)` }
      }
      // The admission row above already fired for this round, and this return is
      // BEFORE the accounting that emits the outcome -- measured by Codex pass 2
      // as 2 admissions against 1 outcome. Emit it here so the read's
      // denominator is the outcome row and nothing else. (An abort rethrows
      // earlier still and is not accounted; an aborted run is not an outcome.)
      if (viaCover > 0) {
        logEvent({ kind: 'gather_cover_outcome', status: 'no_effect',
                   detail: `${blockName} via foliage cover: ${viaCover} candidate(s), ` +
                           `all ${excluded.size} already refused this run — nothing attempted` })
      }
      return { status: 'failed', failClass: 'unreachable',
               detail: `${blockName}: all ${excluded.size} candidate(s) in range refused — ` +
                       `could not stand within reach of any of them` }
    }
    const target = bot.blockAt(nextUp)
    if (!target || target.name !== (viaSource ?? blockName)) { excluded.add(key(nextUp)); continue }

    try {
      // The budget has to cover PLANNING PLUS DOING. It was 10000ms while
      // pathfinder.thinkTimeout was also 10000ms, so a single expensive A*
      // search could consume the entire allowance before the bot took one step
      // -- and the skill then reported "found but unreachable", a claim about
      // reachability derived from a stopwatch. Measured over three hours:
      // gather oak_log succeeded 7 times and "failed as unreachable" 18.
      //
      // 40s leaves ~35s for walking and chopping after the worst-case 5s plan,
      // and stays under the 45s stuck reflex so a genuinely wedged bot is still
      // rescued rather than sitting out its whole budget.
      if (mustCollectManually(target.name)) {
        await collectManually(bot, target, signal)
      } else {
        // ABANDONING A PROMISE DOES NOT STOP THE WORK BEHIND IT.
        //
        // withTimeout is a Promise.race: on expiry it rejects and calls
        // bot.pathfinder.stop(). That stops the PATHFINDER. It does not stop
        // collectblock, whose collect() is `while (!options.targets.empty)`
        // around a downleveled-TypeScript await. Worse, `ignoreNoPath: true`
        // makes it SWALLOW the very error stop() produces -- the library's own
        // comment says path-stopped errors are ignored "for cancelTask to work
        // properly". So a timed-out collect kept looping, invisibly, forever.
        //
        // Measured 2026-08-10: 48 OOM kills in 8 hours, every victim
        // role=gatherer, scouts and the miner never once. A heap snapshot at
        // the moment of death held 180,061 each of the __awaiter closures
        // (step/fulfilled/rejected/adopt), 360,166 Generators, 360,208
        // Promises, 903,562 Contexts -- ~180,000 PENDING awaits from one
        // abandoned loop. Pending promises are reachable, so GC could reclaim
        // none of it: "FATAL ERROR: Ineffective mark-compacts near heap limit",
        // 35s of CPU in two minutes of thrashing, the event loop blocked, the
        // bot silent for 90s, then killed. 178MB to 1GB in under ten seconds.
        //
        // cancelTask() is the library's supported way out and exists in 1.5.0.
        // Call it on EVERY exit that is not a clean return.
        // ...AND cancelTask() DOES NOT CANCEL. Read its source before trusting
        // the name -- 1.5.0 is:
        //
        //     this.bot.pathfinder.stop()
        //     yield once(this.bot, 'collectBlock_finished')
        //
        // It stops the pathfinder and then WAITS for the loop to end by itself.
        // In the exact case we need it for -- a loop that will not end -- that
        // event never fires, so cancelTask hangs forever, holding another
        // pending await and another listener on `bot`. Awaiting it unbounded
        // (which the first version of this fix did) blocks the gather skill and
        // adds to the very pile it was meant to drain. Measured: gather2 halved
        // afterwards, and solo2 went from zero to 35 OOM kills per half hour.
        //
        // So: ask it to stop, bound the wait, and never let the request itself
        // become the leak. If it has not finished in two seconds it is not
        // going to, and the process will be recycled by MemoryMax anyway.
        try {
          await withTimeout(bot.collectBlock.collect(target, { ignoreNoPath: true }), COLLECT_MS, bot)
        } catch (e) {
          try {
            await Promise.race([
              Promise.resolve(bot.collectBlock.cancelTask?.()).catch(() => {}),
              new Promise(r => setTimeout(r, 2000)),
            ])
          } catch { /* already stopped */ }
          throw e
        }
      }
    } catch (e) {
      if (e.aborted) throw e
      // Remember WHY, so the failure below can tell the truth about itself.
      if (/exceeded|timeout/i.test(e.message ?? '')) timedOut++
      // AND SAY IT WHERE ANYONE CAN READ IT.
      //
      // This was a debug log and nothing else, so the ONE fact that explains the
      // largest remaining gather failure -- why collectblock refused a block the
      // pathfinder had just reached -- never entered telemetry at all. 35.0% of
      // healthy-bot "unreachable" failures are that case and it was invisible.
      //
      // The message is the library's, so it is recorded verbatim rather than
      // classified here: this file has already been bitten by deriving a failure
      // class from prose, which is how a collect budget and a real no-path
      // became the same lesson.
      if (collectErrors.length < 8) collectErrors.push(String(e.message ?? e).slice(0, 120))
      // THE SET IS ONLY WORTH HAVING IF SOMETHING PUTS THINGS IN IT.
      //
      // Every failure excludes its target for the rest of this run, not just
      // arrived_out_of_reach. Whatever went wrong -- refused, timed out, taken
      // by another bot -- the one thing we know is that this block did not
      // yield, and re-picking it is what produced streaks of up to 58 attempts
      // on a single position.
      excluded.add(key(target.position))
      log('debug', 'gather: target failed', { at: `${target.position}`, err: e.message })
    } finally {
      // A CANCELLED SKILL MUST CANCEL THE LIBRARY TOO.
      //
      // The watchdog and the reflex layer both cancel running skills, and that
      // unwinds OUR async function while collectblock's loop carries on -- the
      // same abandonment as the timeout above, arriving by a different door.
      // After a clean collect this is a no-op, because targets is already empty.
      if (signal?.aborted) {
        // Bounded for the same reason as above: cancelTask waits on an event a
        // wedged loop never emits, and an unbounded await here would hang the
        // cancellation path itself.
        try {
          await Promise.race([
            Promise.resolve(bot.collectBlock?.cancelTask?.()).catch(() => {}),
            new Promise(r => setTimeout(r, 2000)),
          ])
        } catch { /* already stopped */ }
      }
      // collectBlock replaces the pathfinder Movements with library defaults and
      // never restores them. Put ours back on every path out of collect(),
      // including the throwing one -- see the note in index.mjs.
      bot.assertNav?.('gather')
    }

    // A WINDFALL IS NOT A HARVEST. A bot dying beside this one drops its whole
    // inventory, and some of those bots carry hundreds of items -- so an
    // unbounded delta could credit a corpse. Credit at most what the blocks we
    // actually dug could plausibly have yielded.
    // Cap against what was ASKED FOR, not against `collected` -- `collected` is
    // the running item total and is 0 on the first round, which would score
    // every gather barren before it began.
    const MAX_PER_BLOCK = 8
    const raw = heldFromBlock(bot, blockName) - startHeld
    const gained = Math.max(0, Math.min(raw, count * MAX_PER_BLOCK))
    // "THE FALLBACK FIRED" AND "THE FALLBACK PRODUCED A LOG" ARE TWO CLAIMS.
    //
    // leaf-01's known gap was exactly this and it was never measured: breaking a
    // covered log is not acquiring it, because `pickupNearbyItems` walks to the
    // drop and gives up on seeing the same entity twice, which is what a log
    // dropping inside a canopy looks like. So the admission row above is not
    // evidence of anything on its own -- this one is, and it is emitted BEFORE
    // the barren accounting so it survives the round that ends the run.
    //
    // Also the canary's linkage row: `gather_cover_fallback` and this kind exist
    // only in this build, so a control pool cannot emit either.
    if (viaCover > 0) {
      logEvent({ kind: 'gather_cover_outcome',
                 status: gained > collected ? 'success' : 'no_effect',
                 detail: `${blockName} via foliage cover: ${viaCover} candidate(s), ` +
                         `gained ${gained - collected} this round, run total ${gained}/${count}` })
    }
    if (gained === collected) {
      barren++
      // A barren round means this target gave nothing even though nothing threw.
      // Same reasoning as the catch above: do not come back to it this run.
      excluded.add(key(target.position))
      if (barren >= BARREN_LIMIT) {
        // Name the actual cause. "Unreachable" and "ran out of time getting
        // there" call for different responses -- the first means go somewhere
        // else, the second means try again -- and reporting the second as the
        // first taught the fleet to abandon wood it could have had.
        // The class is now stated rather than recovered from the wording. Both
        // strings were previously handed to classifyFailure, which read the
        // first as `collect_budget` and the second as `no_path` purely from the
        // prose -- the exact coupling that let `gather oak_log` rules rebuild on
        // four bots within hours of a purge that emptied them.
        // THE DISCRIMINATING FACT, recorded on the failure itself.
        //
        // Two rival explanations survive the numbers: real topology (no stance
        // is connected) and a mismatch between our idea of a mining stance and
        // collectblock's. They are told apart by exactly one observation --
        // whether A* SAID a candidate was walkable and the collect then failed
        // anyway. If that is common, the precheck measures the wrong thing and
        // no amount of better ranking will help.
        const errNote = collectErrors.length
          ? ` [collect said: ${[...new Set(collectErrors)].slice(0, 2).join(' | ')}]`
          : ' [collect threw nothing -- it returned without gathering]'
        const probeNote = lastProbe
          ? ` [probe: ${lastProbe.status}, slate ${lastProbe.checked}, ` +
            `${lastProbe.hit ? 'A* reached a candidate' : 'A* reached none'}]`
          : ''
        const fc = barrenFailClass(timedOut, barren, coverRounds)
        const [failClass, why] = fc === 'collect_budget'
          ? ['collect_budget',
             `ran out of time reaching ${blockName} (${timedOut}/${barren} attempts timed out at ${COLLECT_MS / 1000}s)`]
          : [fc, `${blockName} found but unreachable after ${barren} attempts${probeNote}${errNote}` +
                 (coverRounds > 0
                   ? ` [${coverRounds} round(s) were foliage-covered last resorts, so this is not evidence there is no route]`
                   : '')]
        return collected > 0
          ? { status: 'success', detail: `collected ${collected}/${count} ${blockName}; ${why}` }
          : { status: statusFor(failClass), failClass, detail: why }
      }
      // Reposition so the next scan ranks different candidates first rather
      // than retrying the same unreachable block forever.
      await bot.pathfinder.goto(new goals.GoalNear(
        bot.entity.position.x + (Math.random() * 10 - 5), bot.entity.position.y,
        bot.entity.position.z + (Math.random() * 10 - 5), 2)).catch(() => {})
    } else {
      barren = 0
    }
    collected = gained
  }

  return collected >= count
    ? { status: 'success', detail: `collected ${collected} ${blockName}` }
    // ROUNDS RAN OUT, WHICH IS OUR CEILING, NOT THE WORLD'S. The loop is bounded
    // at count*4+8 rounds; hitting that bound says the bot did not finish inside
    // an allowance we chose, and says nothing whatever about whether more
    // ${blockName} was gettable. It classified as `other` before, which is
    // non-evidence by luck rather than by statement.
    : { status: 'unknown', failClass: 'collect_budget',
        detail: `collected ${collected}/${count} ${blockName} before running out of ` +
                `${maxRounds} attempts — not a shortage, an allowance` }
}

// ---------------------------------------------------------------- come -----
async function come(ctx, { player }, signal) {
  const { bot } = ctx
  const target = bot.players[player]?.entity
  if (!target) return { status: 'failed', failClass: 'bad_target', detail: `cannot see ${player}` }
  const p = target.position
  return goto(ctx, { x: p.x, y: p.y, z: p.z, range: 2 }, signal)
}

// -------------------------------------------------------------- follow -----
async function follow(ctx, { player, durationMs = 60000 }, signal) {
  const { bot } = ctx
  const target = bot.players[player]?.entity
  if (!target) return { status: 'failed', failClass: 'bad_target', detail: `cannot see ${player}` }
  bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
  try {
    await sleep(durationMs, signal)
  } finally {
    bot.pathfinder.setGoal(null)
  }
  return { status: 'success', detail: `followed ${player}` }
}

// ---------------------------------------------------------------- home -----
/**
 * `home` was a one-line wrapper around `goto`, and it succeeded ZERO times in
 * 353 calls across a fourteen-hour fleet run. Three separate reasons, all
 * measured, and a thin wrapper could not address any of them:
 *
 *  1. INTERRUPTION. A third of all travel failures (836 of 2,560) were the
 *     reflex layer seizing the body mid-walk -- overwhelmingly drowning. The
 *     skill returned `aborted` and the bot waited ~30s for a fresh decision,
 *     so a crossing that took three interruptions cost three whole skill
 *     invocations and made no progress. Gather01 sat SIX BLOCKS from home and
 *     failed `home` 47 times out of 47, every one of them `interrupted:
 *     drowning`.
 *  2. NO ROUTE FROM HERE. `stranded`/`no_path` with the bot below ground.
 *     `surface` is the deterministic repair for that and `home` never called
 *     it, so the watchdog escalating to `home` escalated into the same wall.
 *  3. DISTANCE. goto caps at 16 legs of 45 blocks = 720. Scout02 sat at 1,893
 *     blocks from home for the entire run -- every three-hour bucket reported
 *     the same 1893 -- so `home` was arithmetically impossible for it and said
 *     only "no route", which reads as terrain rather than budget.
 *
 * So this retries across interruptions instead of surrendering to them, repairs
 * the route once when it is below ground, and REPORTS DISTANCE CLOSED. The last
 * part matters as much as the walking: a bot that gets 700 blocks closer has
 * done the most useful thing available to it, and recording that as a flat
 * failure both wastes the evidence and teaches the fleet that going home never
 * works.
 */
async function home(ctx, _args, signal) {
  const { bot } = ctx
  const { homeX, homeY, homeZ } = config.world
  const distTo = () => Math.hypot(homeX - bot.entity.position.x,
                                  homeZ - bot.entity.position.z)

  const startDist = distTo()
  // Bounded by the skill contract's own budget, not by an attempt count: the
  // point is to keep walking while there is time, not to retry a fixed number
  // of times regardless of how long each one took.
  const deadline = Date.now() + HOME_BUDGET_MS
  let repaired = false
  let last = null
  let noProgressRuns = 0
  // Bounded so a bot standing in a lake cannot spend the whole budget being
  // rescued over and over; the deadline is the real ceiling, this is the guard
  // against a hazard that never clears.
  let hazardRuns = 0

  while (Date.now() < deadline) {
    check(signal)
    const before = distTo()
    last = await goto(ctx, { x: homeX, y: homeY, z: homeZ, range: 2 }, signal)
    const after = distTo()

    if (after <= 2) {
      // failClass is deliberately dropped, not spread through. The last leg
      // often reports something like `wrong_elevation` on its way to arriving,
      // and carrying that onto a success produces a record that is graded as a
      // win while naming a failure -- the exact ambiguity the evidence gate
      // exists to remove.
      return { status: 'success', distanceMoved: startDist - after,
               detail: `home (${Math.round(after)}b from the town centre)` }
    }

    const closed = before - after
    if (closed >= 2) {
      // Progress. Interruptions are normal on a long walk -- keep going rather
      // than handing a half-finished trip back to a loop that will pick
      // something else entirely.
      noProgressRuns = 0
      continue
    }

    // AN INTERRUPTION IS NOT A DEAD END, and counting it as one is what made
    // this loop no better than the single goto it replaced. The reflex seizing
    // the body means a hazard was handled -- the route is unchanged and the
    // walk is worth resuming. Only a route failure (stranded/no_path) is
    // evidence that continuing is pointless. Gather01's 47/47 failures six
    // blocks from home were ALL interruptions; giving up after two would have
    // reproduced the bug this skill exists to fix.
    const interrupted = last?.failClass === 'interrupted' ||
                        last?.failClass === 'path_interrupted' ||
                        last?.failClass === 'hazard_interrupt'
    if (interrupted) {
      if (++hazardRuns > MAX_HAZARD_RETRIES) break
      continue
    }

    noProgressRuns++
    // ROUTE REPAIR, ONCE. Below sea level with no route is exactly what
    // `surface` exists for, and it is the difference between "home is a walk"
    // and "home is a walk that first climbs out of the hole it is in".
    const stuck = last?.failClass === 'stranded' || last?.failClass === 'no_path'
    if (stuck && !repaired && bot.entity.position.y < SEA_LEVEL) {
      repaired = true
      const up = await surface(ctx, {}, signal)
      check(signal)
      // Carry a genuine scaffold prerequisite outward: applyPrereq turns it
      // into the task, which is the only mechanism measured to break this loop
      // (0/13 from prose, 3/13 on 7b and 12/13 on 32b once promoted).
      if (up?.need) return { ...up, status: 'failed', failClass: up.failClass ?? 'stranded',
                             detail: `cannot go home yet: ${up.detail ?? 'no route out'}` }
      continue
    }
    // Two rounds with no ground gained and no repair left to try. Anything
    // further is the same wall at a slower rate.
    if (noProgressRuns >= 2) break
  }

  const endDist = distTo()
  const closed = startDist - endDist
  // HONEST PARTIAL CREDIT. Still a failure -- the bot is not home -- but the
  // class and the detail say "this was progress, run it again", which is true
  // and is what the next decision needs to hear. `home` is a rescue skill and
  // therefore exempt from avoid rules, so reporting the attempt cannot poison
  // it either way.
  if (closed >= 16) {
    return { status: 'failed', failClass: 'travel_incomplete',
             detail: `closed ${Math.round(closed)} blocks toward home, ` +
                     `${Math.round(endDist)} still to go — run home again to continue` }
  }
  return last ?? { status: 'failed', failClass: 'no_path',
                   detail: `could not start toward home from ${Math.round(endDist)}b out` }
}

// ------------------------------------------------------------- deposit -----
async function deposit(ctx, { item = null }, signal, { noRecovery = false, preferAt = null, exclude = [], meta = {}, until = null } = {}) {
  if (item != null && ['', 'none', 'null', 'any', 'all', 'everything', 'items', 'inventory', 'undefined'].includes(String(item).trim().toLowerCase())) item = null   // a wildcard word is "everything bankable", not an item named none
  const { bot } = ctx
  // The bag's item total when the skill began: the full-chest recovery's row compares it with the end (chestfull.mjs).
  const bagBefore = bagTotal(bot.inventory?.items?.() ?? [])
  // THE RUNNER'S WATCHDOG is the clock (config.skills.defaultTimeoutMs, runner.mjs), not the contract, for EVERY deposit
  // -- the first one too (Codex round 2: with 1 s left the first open still got 8 s). `until` (a recovery attempt's
  // bound from outside) can only shorten it.
  const startedAt = ctx.runner?.current?.startedAt ?? Date.now()
  const deadline = Math.min(startedAt + config.skills.defaultTimeoutMs, until ?? Infinity)
  const msLeft = (cap) => Math.max(0, Math.min(cap, deadline - Date.now()))
  const isContainer = b => ['chest', 'barrel', 'trapped_chest']
    .includes(bot.registry.blocks[b.type]?.name)
  const skip = new Set(exclude.map(q => `${q.x},${q.y},${q.z}`))
  // mineflayer's findBlock asks the matcher about PALETTE blocks first (Block.fromStateId, position null) to decide
  // whether a section is worth scanning at all; a matcher that reads b.position throws on every call. Found on the
  // recovery-ladder-01 canary 2026-09-13: 6 of 6 deposits died with "Cannot read properties of null (reading 'x')".
  // A far chest this bot found full is skipped for a while (chestfull.mjs: a far full chest never closes town storage;
  // the deposit walks home past it instead).
  const skipFar = b => { const u = bot.skipContainers?.get?.(`${b.position.x},${b.position.y},${b.position.z}`); return !!u && u > Date.now() }
  // A DEEP CONTAINER (|dy| > TOWN_DY from home) IS NEVER A TARGET (chestfull-02, depositTargetOk): from a mine the scan
  // found a natural chest 58 below home and walked at it 18 times in 3.5 h, "No path" every time; the walk home follows.
  const hv = homeVec()
  const notTried = b => !b.position || (!skip.has(`${b.position.x},${b.position.y},${b.position.z}`) && !skipFar(b) && depositTargetOk(hv, b.position))
  const findChest = () => bot.findBlock({ matching: b => isContainer(b) && notTried(b), maxDistance: 48 })
  // PREFER THE CHEST WE WERE SENT TO, and this is not a nicety.
  //
  // The full-chest recovery below builds a NEW chest and calls deposit again.
  // Without this, that retry runs findChest() and gets the NEAREST container --
  // which is very often the same full one it just walked away from, because the
  // new chest is placed adjacent to the bot and so is the old one. The recovery
  // would then look like it ran and changed nothing.
  let chestBlock = null
  if (preferAt) {
    const b = bot.blockAt(preferAt)
    if (b && isContainer(b) && depositTargetOk(hv, b.position)) chestBlock = b
  }
  chestBlock = chestBlock || findChest()
  if (!chestBlock) {
    // The town chest lives at home, and a 48-block scan cannot see it from a
    // mine. Walking home first is the difference between "deposit works near
    // town" and "deposit works" -- and it reuses the RESCUE path's budgets
    // rather than inventing a second travel path.
    //
    // This called `goto` directly, which meant deposit inherited none of the
    // repairs that made `home` work: no retry across hazard interrupts, no
    // route repair below sea level, and goto's own 16-leg/720-block ceiling.
    // The cost is the whole endpoint -- 823 deposit attempts produced EIGHT
    // successes in twelve days, and 650 of the 815 failures (80%) were travel:
    // stranded 466, no_path 75, interrupted 65, path_interrupted 44. Only 75
    // were the actual deposit logic failing to find a chest.
    //
    // `deposit` is a co-primary endpoint in the pre-registration. It cannot be
    // measured through a walk that does not work.
    const walked = await home(ctx, {}, signal)
    check(signal)
    // Rescan BEFORE judging the walk. Gather02 ran out of legs 33 blocks from
    // home -- chest well inside the 48-block scan -- and the first version
    // returned goto's failure without ever looking around. A walk that fell
    // short can still have arrived.
    chestBlock = findChest()
    if (!chestBlock && walked.status === 'failed') {
      return { ...walked, detail: `no chest nearby; walking home to the town chest failed: ${walked.detail}` }
    }
  }
  if (!chestBlock) {
    return { status: 'failed', failClass: 'nothing_found',
             detail: 'no chest or barrel within 48 blocks, even at home' }
  }

  // A FIRST CHEST THAT CANNOT BE USED goes to the same handling as a full one (both reviews): its lid is UNAVAILABLE
  // (verified blocked); a failed open or walk is UNKNOWN (transient); and the town's memory of it is read BEFORE any
  // walk (Codex round 2): one found full in the last 30 min, in its backoff, or unusable is not visited again. Only with
  // something to hand over -- otherwise the result stands.
  const viaRecovery = (res, outcome, firstStatus = null) => {
    if (noRecovery) return res
    const plan = depositPlan(bot.inventory.items(), item, { wants: bot.currentWants ?? [] })
    if (!plan.length || plan.every(e => isCobble(e.name))) return res   // cobble never grows the bank
    return fullChestRecovery(ctx, { item, signal, first: chestBlock, firstOutcome: outcome, firstStatus, firstFail: res, exclude,
                                    eligible: plan.reduce((n, e) => n + e.count, 0), bagBefore, startedAt })
  }
  if (!noRecovery) {
    const st = townStatus(bot, chestBlock.position)
    const plan0 = depositPlan(bot.inventory.items(), item, { wants: bot.currentWants ?? [] })
    // a cobble-only plan never starts the recovery (cobble never grows the bank): it tries this chest as it is
    if (st && st !== 'visit' && plan0.length && !plan0.every(e => isCobble(e.name))) {
      const p = chestBlock.position
      return viaRecovery({ status: 'failed', failClass: 'storage_full', detail: `the town remembers the chest at ${p.x},${p.y},${p.z} as ${st}` }, 'memory', st)
    }
  }

  // A CLAMPED TIMEOUT IS OUR CLOCK, NOT THE CHEST (Claude round 3). Every bounded step (the walk, the lid dig, the open)
  // records whether the watchdog cut its budget; a timeout while cut says nothing about the chest -- the walk home may
  // have used most of the 180 s -- so it strikes nothing, starts no recovery and closes nothing: deposit again.
  const cp = chestBlock.position
  const bounded = cap => { const left = msLeft(cap); return { ms: Math.max(1, left), clamped: left < cap, left } }
  const outOfTime = what => ({ status: 'unknown', failClass: 'path_budget',
                               detail: `deposit again: this attempt ran out of time before ${what} the chest at ${cp.x},${cp.y},${cp.z}` })

  // EVERY walk to a chest is bounded (Codex round 2: an unreachable first chest was a dead end): the recovery's own
  // attempts by RECOVERY_WALK_MS, the first by FIRST_WALK_MS, both clamped to the watchdog. A first walk that fails on
  // its own terms is UNKNOWN -- a strike -- and goes on to the town's other containers, but only when it began in town
  // with STRIKE_WALK_MIN_MS to spare; otherwise it is the travel failure it always was. A failed recovery walk throws,
  // and the sweep reads it as unknown.
  // WHERE THE WALK BEGAN, judged NOW (Codex round 4): bot.entity.position is a live Vec3 that the walk mutates, so a
  // reference read after a failed goto saw where the bot ended up -- in town -- and struck the chest.
  // ONE TOWN BOUNDARY (chestfull-02, inTown): the same cylinder for where the walk began, the chest's memory and the
  // recovery. AN INTERRUPTED WALK says nothing about the chest: no strike, no backoff, no recovery. A real travel
  // failure to a chest OUTSIDE town backs that chest off for this bot, so the next deposit does not walk at it again.
  const walkBeganInTown = inTown(hv, bot.entity.position)
  const wb = bounded(noRecovery ? RECOVERY_WALK_MS : FIRST_WALK_MS)
  try {
    await chestWalk(bot, new goals.GoalNear(cp.x, cp.y, cp.z, 2), wb.ms)
    // A RESOLVED WALK IS NOT AN ARRIVAL: mineflayer-pathfinder's goto resolves an EMPTY noPath (goto.js). Paper 10-05: a
    // bot sealed in stone 17 blocks short "arrived", its open timed out, and 6c9a8fb struck a good town chest and closed
    // the bank. Out of reach to open is this walk's own no-path.
    const d = eyeToBlock(bot.entity.position, cp)
    if (!(d <= OPEN_REACH)) throw Object.assign(new Error(`No path to the goal! (the walk ended ${Math.round(d * 10) / 10} blocks from the chest)`), { failClass: 'no_path' })
  } catch (e) {
    if (e?.aborted || signal?.aborted) throw e
    if (e?.budgetExceeded && wb.clamped) return outOfTime('reaching')
    const kind = walkFailure(e)
    if (backsOffTarget({ kind, targetInTown: inTown(hv, cp) })) {
      bot.skipContainers ??= new Map()
      bot.skipContainers.set(posKey(cp), Date.now() + TARGET_BACKOFF_MS)
    }
    if (noRecovery) throw e
    const res = { status: 'failed', failClass: e?.failClass ?? (kind === 'interrupted' ? 'path_interrupted' : 'no_path'),
                  detail: `could not reach the chest at ${cp.x},${cp.y},${cp.z}: ${String(e?.message ?? e).slice(0, 60)}` }
    const strikes = kind !== 'interrupted' && walkBeganInTown && wb.left >= STRIKE_WALK_MIN_MS
    return strikes ? viaRecovery(res, 'unknown') : res
  }
  check(signal)

  // A CHEST UNDER A SOLID BLOCK DOES NOT OPEN, and mineflayer only says
  // "Event windowOpen did not fire within timeout of 20000ms" twenty seconds
  // later -- 138 times a day on this fleet. Look at the lid first: a solid
  // full block above the chest is cleared when it is safe to dig (no liquid
  // beside it), otherwise the deposit names the problem and stops here; sneak
  // is released (a sneaking bot does not open containers); the open itself
  // gets 8 s, not 20, with a class the model and the digest can read.
  const lid = bot.blockAt(chestBlock.position.offset(0, 1, 0))
  const isChest = ['chest', 'trapped_chest'].includes(bot.registry.blocks[chestBlock.type]?.name)   // barrels open under anything
  if (isChest && lid && chestLidBlocked(lid)) {
    if (lidSafeToBreak(bot, lid.position)) {
      const db = bounded(10_000)
      try { await withTimeout(bot.dig(lid), db.ms, bot, { what: 'dig', onTimeout: () => { try { bot.stopDigging?.() } catch {} }, needsDrop: false }) }
      catch (e) {
        if (e?.aborted || signal?.aborted) throw e
        if (e?.budgetExceeded && db.clamped) return outOfTime('opening')
        return viaRecovery({ status: 'failed', failClass: 'container_blocked', detail: `the chest at ${chestBlock.position.x},${chestBlock.position.y},${chestBlock.position.z} has ${lid.name} on its lid and it would not break: ${String(e?.message ?? e).slice(0, 60)}` }, 'unavailable')
      }
      check(signal)
    } else {
      return viaRecovery({ status: 'failed', failClass: 'container_blocked', detail: `the chest at ${chestBlock.position.x},${chestBlock.position.y},${chestBlock.position.z} has ${lid.name} on its lid and it is not safe to break — use another chest or place a new one` }, 'unavailable')
    }
  }
  try { bot.setControlState('sneak', false) } catch {}
  try { await bot.lookAt?.(chestBlock.position.offset(0.5, 0.5, 0.5), true) } catch {}   // face the chest; optional on test doubles
  let chest
  const ob = bounded(8_000)
  try {
    chest = await withTimeout(bot.openContainer(chestBlock), ob.ms, bot, { what: 'open the chest', onTimeout: () => {}, needsDrop: false })
  } catch (e) {
    if (e?.aborted || signal?.aborted) throw e
    if (e?.budgetExceeded && ob.clamped) return outOfTime('opening')
    return viaRecovery({ status: 'failed', failClass: 'container_open',
             detail: `could not open the chest at ${chestBlock.position.x},${chestBlock.position.y},${chestBlock.position.z} (${String(e?.message ?? e).slice(0, 50)}); lid ${lid?.name ?? '?'}, ${Math.round(eyeToBlock(bot.entity.position.offset(0, 1.62, 0), chestBlock.position) * 10) / 10} blocks from the eyes` }, 'unknown')
  }
  let moved = 0
  let cursorLost = false
  // THE COBBLE RULE's bookkeeping: what cobble the transfer counted eligible, and one record per cobble name tried
  let cobbleEligible = 0
  const cobbleRows = []
  // Which container this was, for the full-chest sweep: a double chest is ONE inventory at two coordinates.
  meta.at = chestBlock.position
  meta.double = (chest.inventoryStart ?? 27) >= 54
  // NOTHING TO HAND OVER IS NOT A FAILURE, AND CONFLATING THE TWO FAKED A NUMBER.
  //
  // This returned `failed` whether the bot had nothing eligible or the chest
  // refused everything, under one message naming both. Measured over 3h,
  // deposit read 7.3% success across 248 runs and 47% of the failures were that
  // single string -- a rate that is partly fiction, because a bot arriving with
  // nothing depositable did exactly what was asked of it.
  //
  // Counted BEFORE the loop, so the two cases separate cleanly: eligible=0 is a
  // no-op that succeeded, eligible>0 with moved=0 is a chest that would not take
  // it, which is a real environmental failure worth a different remedy.
  let eligible = 0
  // ONE SNAPSHOT, shared with the refusal sentence below: a reason computed from a
  // second read of the inventory can contradict the plan that was actually run.
  let planItems = []
  try {
    // HAND OVER THE PLAN, NOT THE INVENTORY (depositPlan, bankable.mjs). This loop
    // handed over every stack in inventory order: measured 2026-09-13 over 24 h,
    // the fleet deposited 81 pickaxes, 62 furnaces, 59 crafting tables and 17
    // buckets into chests. One tool of each family, the scaffold reserve and the
    // stations stay in the bot's hands; the valuable stacks go first so a short
    // chest keeps the iron.
    planItems = bot.inventory.items()
    const plan = depositPlan(planItems, item, { wants: bot.currentWants ?? [] })   // the wants admission judged with (set by the gate)
    for (const { name, count } of plan) {
      check(signal)
      // A TOOL GOES BY SLOT, A USABLE COPY AT A TIME (Codex round 2 on withdraw: chest.deposit(type) takes the first copy
      // by slot, so wear [129, 30, 40] with an allowance of 1 banked the SPENT copy). The worst usable copy goes first,
      // the best always stays, a spent one never moves; each source is re-read just before its shift-click, and it
      // counts as banked only if it left its slot.
      if (DEPOSIT_TOOL_RE.test(name)) {
        const usable = (chest.items?.() ?? []).filter(x => x?.name === name && remaining(x) > FLOOR)
          .map(x => ({ slot: x.slot, used: x.durabilityUsed ?? 0, left: remaining(x) })).sort((a, b) => a.left - b.left || a.slot - b.slot)
        for (const c of usable.slice(0, Math.max(0, Math.min(count, usable.length - 1)))) {
          check(signal)
          const same = x => !!x && x.name === name && (x.durabilityUsed ?? 0) === c.used
          if (!same(slotAt(chest, c.slot))) continue
          eligible += 1
          await bot.clickWindow(c.slot, 0, 1)
          if (!same(slotAt(chest, c.slot))) moved += 1
        }
        continue
      }
      // COBBLE GOES A WHOLE STACK AT A TIME (the cobble rule, bankable.mjs cobbleBankStacks): the stacks the plan counted --
      // smallest first, the reserve kept -- re-chosen from the window's own bag just before they move. Each is moved by
      // mineflayer's OWN transfer (the function chest.deposit calls), with its source range narrowed to that one slot, so
      // the actuator, its errors and the cursor rescue below are the deposit's existing ones (both reviews 10-07: no new
      // click path). A stack the container cannot take WHOLE is not started (a partial would free no slot): it is eligible
      // -- a full container -- and stays. The rows are written after the close, from the server's bag (cobbleRows).
      if (isCobble(name)) {
        const chosen = cobbleBankStacks(chest.items?.() ?? []).filter(s => s.name === name)
        const row = { name, planned: count, tried: [], went: 0, noRoom: 0 }
        cobbleRows.push(row)
        let budget = count
        for (const s of chosen) {
          check(signal)
          if (s.count > budget) continue
          const cur = slotAt(chest, s.slot)
          if (!cur || cur.name !== name || cur.count !== s.count) continue
          eligible += s.count; cobbleEligible += s.count
          if (cobbleRoom(chest, name) < s.count) { row.noRoom++; continue }
          row.tried.push(s.count)
          const had = inChest(chest, name)
          try {
            await bot.transfer({ window: chest, itemType: cur.type, metadata: null, count: s.count,
                                 sourceStart: s.slot, sourceEnd: s.slot + 1, destStart: 0, destEnd: chest.inventoryStart })
            const got = Math.max(0, inChest(chest, name) - had)
            moved += got; row.went += got; budget -= got
          } catch (e) {
            const got = Math.max(0, Math.min(s.count, inChest(chest, name) - had))
            moved += got; row.went += got; budget -= got
            const back = await returnCursor(bot, chest)
            logEvent({ kind: 'deposit_cursor_rescue', status: back.returned ? 'success' : back.reason === 'cursor empty' ? 'no_effect' : 'failed',
                       detail: `${name}: ${String(e?.message ?? e).slice(0, 40)} -- ` +
                               (back.returned ? `returned to slot ${back.slot}` : `not returned: ${back.reason}`), snapshot: snapshot(bot) })
            if (!back.returned && back.reason !== 'cursor empty') { cursorLost = true; break }
          }
        }
        if (cursorLost) break
        continue
      }
      const stacks = bot.inventory.items().filter(it => it.name === name)
      let left = count
      for (const it of stacks) {
        if (left <= 0) break
        const n = Math.min(left, it.count ?? 0)
        eligible += n
        // WHAT THE WINDOW GAINED, not what was asked: mineflayer's transfer can fill part of a stack and THEN throw
        // `destination full` (inventory.js:317-323), and counting none of it called a deposit that moved items a failure.
        const had = inChest(chest, name)
        try { await chest.deposit(it.type, null, n); moved += n; left -= n } catch (e) {
          const got = Math.max(0, Math.min(n, inChest(chest, name) - had))
          moved += got; left -= got
          // THE CURSOR IS STILL HOLDING THE STACK: mineflayer throws after lifting it and before putting it back, and
          // chest.close() below would drop it into the world. Put it back first (chestfull.mjs returnCursor).
          const back = await returnCursor(bot, chest)
          logEvent({ kind: 'deposit_cursor_rescue', status: back.returned ? 'success' : back.reason === 'cursor empty' ? 'no_effect' : 'failed',
                     detail: `${name}: ${String(e?.message ?? e).slice(0, 40)} -- ` +
                             (back.returned ? `returned to slot ${back.slot}` : `not returned: ${back.reason}`), snapshot: snapshot(bot) })
          // A stack still on the cursor is never clicked past: the next click would put it somewhere unplanned.
          if (!back.returned && back.reason !== 'cursor empty') { cursorLost = true; break }
        }
      }
      if (cursorLost) break
    }
  } finally {
    chest.close()
  }
  // THE COBBLE RULE'S ROWS, from the SERVER's bag after the close (craftsync's recount; 'none' without craftsync): one
  // _cobble_bank row per cobble name the plan named -- the stacks tried, what the window gained, what the bag keeps.
  if (cobbleRows.length) {
    const sb = await recountBag(bot, msLeft)
    const kept = (sb.bag ?? bot.inventory.items()).reduce((t, x) => t + (isCobble(x?.name) ? (x.count ?? 0) : 0), 0)
    for (const r of cobbleRows) {
      logEvent({ kind: 'cobble_bank', status: r.went > 0 ? 'success' : 'no_effect', snapshot: snapshot(bot),
                 detail: `name=${r.name} planned=${r.planned} tried=${r.tried.join(',') || '-'} moved=${r.went} kept=${kept} src=${sb.source} reserve=${COBBLE_RESERVE} no_room=${r.noRoom}` })
    }
  }
  // COBBLE NEVER GROWS THE BANK (the 10-04 SYNTHESIS: existing storage only; both reviews 10-07): when everything this
  // deposit could not place was cobble, the chests are simply full for it -- no recovery, no new chest, no bank closure.
  if (!cursorLost && moved === 0 && eligible > 0 && cobbleEligible === eligible) {
    return { status: 'no_effect', failClass: null,
             detail: `the cobble stays: no container here has room for a whole stack, and cobble never opens a new chest (cobble reserve)` }
  }
  // AN UNSETTLED TRANSFER IS NOT A FULL CHEST (Codex): a stack may still be on the cursor, so nothing else is attempted
  // -- no other container, no new chest -- until a later deposit starts from a settled bag.
  if (cursorLost) {
    return { status: 'failed', failClass: 'transfer_unsettled', moved,
             detail: `a stack could not be put back from the cursor at the chest at ${chestBlock.position.x},${chestBlock.position.y},${chestBlock.position.z}; ` +
                     `${moved} item(s) went in; stopped until the bag settles` }
  }
  if (moved > 0) {
    rememberTown(bot, chestBlock.position, 'took')   // a town container took items: room, for every bot (chestfull.mjs)
    return { status: 'success', moved, detail: `deposited ${moved} items` }
  }
  // Written out rather than left as a ternary on `status` so the preflight scan
  // in bots/test/evidence-gate.test.mjs can see it. A failure hidden inside a
  // conditional expression is exactly the one that keeps its class by accident.
  //
  // NOT `inventory`. That class is in EVIDENCE_ONLY_IF_STUCK and would start
  // writing avoid rules against `deposit`; classifyFailure filed this string as
  // `other`, which never voted, and naming the class must not smuggle in a
  // policy change alongside the honesty change.
  // Nothing eligible: the task is complete, there was simply nothing to do.
  // Still logged distinctly so "arrived empty" stays countable and never
  // silently inflates the success rate of real transfers.
  if (eligible === 0) {
    // `no_effect`, NOT `success`. The contract for deposit expects
    // inventory_loss, and the evidence gate downgrades a success that produces
    // none -- so calling this a success made the number WORSE, not better:
    // deposit read 1.1% in the window after that change against 7.3% before.
    //
    // `no_effect` is the status this codebase already has for exactly this:
    // "deliberately matches NEITHER branch. It is not a success". The bot did
    // what was asked and there was nothing to do, which is neither an
    // achievement nor a fault, and it should not be counted as either.
    // SAY WHICH CASE IT IS. Measured 2026-09-23: of 2,079 runs that ended with
    // "nothing matching <item> to hand over", the bot was carrying the item in
    // 2,078 -- the sentence was false 100.0% of the time, and 90.1% of the
    // refusals are a bot asking again for something it has already been refused.
    // `depositNoopReason` is defined in terms of `depositPlan`, so this sentence
    // cannot disagree with the transfer. It falls back to the old wording rather
    // than inventing one if the plan and the loop ever disagree.
    return { status: 'no_effect', failClass: null,
             detail: depositNoopReason(planItems, item, { wants: bot.currentWants ?? [] })
               ?? (item
                 ? `nothing matching ${item} to hand over — nothing to deposit`
                 : 'nothing worth banking — nothing to deposit') }
  }
  // A REFUSAL MUST NAME A REMEDY THE BOT CAN PERFORM FROM WHERE IT STANDS,
  // and this one named one and then did not perform it.
  //
  // The comment here already said "the remedy is another chest rather than
  // another attempt" and stopped there, which is the repo's own recurring bug:
  // advice printed is not advice taken. Measured: 108 storage_full refusals
  // across 33 DISTINCT BOTS in six hours, one of them holding 806 bankable
  // items. The town chest is 27 slots and there are five bots per world.
  //
  // A chest is eight planks. Every bot that can gather wood can make one, and
  // `craft` already resolves its own prerequisites recursively -- that is how
  // the crafting table gets placed. So make storage instead of reporting the
  // lack of it. This is also the only version of the fix that respects the
  // owner's standing rule: adding chests by RCON would be changing the world to
  // fix a bot; teaching bots to build storage is a capability.
  if (!noRecovery) return fullChestRecovery(ctx, { item, signal, first: chestBlock, firstMeta: meta, exclude, eligible, bagBefore, startedAt })
  return { status: 'failed', failClass: 'storage_full',
           detail: `had ${eligible} item(s) to hand over and the chest took none — it is full` }
}

/** The bound on one walk to a container during the full-chest recovery (deposit's noRecovery attempts). */
const RECOVERY_WALK_MS = 30_000
/** A walk to a chest has ARRIVED when the eyes are within this of the chest's centre (the server's use range is 4.5 plus
 *  a 1-block buffer, measured to the block's box; the centre is never nearer than the box). */
const OPEN_REACH = 5.5
/**
 * A WALK TO A CHEST (or to the cell beside a new one), bounded by OUR clock and nothing else (chestfull-02).
 * chestfull-01 wrapped the walk the fleet made with a bare pathfinder.goto() in withTimeout's DEFAULT, which also
 * starts watchDigging: once a second it calls pathfinder.stop() and stopDigging() whenever the block being dug cannot
 * be HARVESTED by the held tool -- a travel dig that wants the hole, and any escape dig in flight while the walk waits
 * (Codex, 10-05). So the walk never watches digs (needsDrop: false), and when the clock ends it the goal is cleared
 * only if it is still this walk's (travelTimeoutAction): a reflex that took the pathfinder keeps it.
 */
function chestWalk (bot, goal, ms) {
  return withTimeout(bot.pathfinder.goto(goal), ms, bot, {
    needsDrop: false,
    onTimeout: () => { if (travelTimeoutAction({ ours: goal, current: bot.pathfinder?.goal }) === 'halt') haltPath(bot) },
  })
}
/** The bound on a deposit's first walk to its chest (it was unbounded; the watchdog was its only end). */
const FIRST_WALK_MS = 60_000
/** A failed first walk strikes its chest only if it had at least this long (and began in town). */
const STRIKE_WALK_MIN_MS = 30_000
/** The town's memory of the container at `q` -> containerStatus, or null when it is not a town container. */
function townStatus (bot, q) {
  try {
    if (!q || !inTown(homeVec(), q)) return null
    return containerStatus(readTownMemory(townDir(), homeTownKey(), bot.worldId ?? null)[posKey(q)])
  } catch { return null }
}
/** A far chest found full is skipped by this bot's deposits for this long (it walks home past it). */
const FAR_SKIP_MS = 30 * 60 * 1000
/** How many of `name` the open container could still take: empty container slots hold a stack each, a partial stack of
 *  the same name its remainder. 0 for a window that cannot say (the cobble rule then moves nothing). */
const cobbleRoom = (chest, name) => {
  try {
    const n = chest?.inventoryStart
    if (!Number.isInteger(n)) return 0
    let room = 0
    for (let i = 0; i < n; i++) {
      const it = slotAt(chest, i)
      if (!it) room += 64
      else if (it.name === name) room += Math.max(0, (it.stackSize ?? 64) - (it.count ?? 0))
    }
    return room
  } catch { return 0 }
}
/** How many of the chest's items the open window's CONTAINER range holds (the client window: mineflayer applies
 *  clicks locally). 0 for a window that cannot say. */
const inChest = (chest, name) => {
  try { return (chest?.containerItems?.() ?? []).reduce((n, it) => n + (it?.name === name ? (it.count ?? 0) : 0), 0) } catch { return 0 }
}
/** The other half of a DOUBLE chest at `pos`, validated from both blocks' state, or null. */
function chestPartner (bot, pos) {
  try {
    const at = q => { const b = bot.blockAt(q); return b ? { name: blockNameOf(bot, b), props: b.getProperties?.() ?? {} } : null }
    const me = at(pos)
    const off = chestPartnerOffset(me?.props)
    if (!off) return null
    const q = pos.offset(off.x, 0, off.z)
    return isChestPartner(me, at(q)) ? q : null
  } catch { return null }
}
const posKey = q => `${q.x},${q.y},${q.z}`
const townDir = () => poolStateDir(config.memory.pool)
const homeTownKey = () => townKey(homeVec())
/** One outcome into the town's container memory (chestfull.mjs), for TOWN containers only (inTown: the same boundary
 *  as the memory read, so a container the recovery treats as town always gets its backoff written). */
let roomCache = { at: 0, v: -Infinity }
function rememberTown (bot, q, outcome) {
  try {
    if (!q || !inTown(homeVec(), q)) return null
    let entry = null
    updateTownMemory(townDir(), homeTownKey(), bot.worldId ?? null, e => { e[posKey(q)] = entry = recordOutcome(e[posKey(q)], outcome) })
    roomCache.at = 0
    return entry
  } catch { return null }
}
// "A town chest gained room" for the bank's early reopen: the newest `took` in the town's memory, read at most every 30 s.
setTownRoomReader(() => {
  const now = Date.now()
  if (now - roomCache.at < 30_000) return roomCache.v
  let v = -Infinity
  try { v = townRoomAt(readTownMemory(townDir(), homeTownKey())) } catch { v = -Infinity }
  roomCache = { at: now, v }
  return v
})

/**
 * THE TOWN CHESTS ARE FULL (or the first one cannot be opened) -> the deposit's result. The decisions are
 * chestfull.mjs's; this walks, opens and places.
 *
 * 1. FAR FROM HOME (beyond STORAGE_NEAR): at most two other containers within 24 blocks -- and nothing built, and
 *    the bank NOT closed: the far chests are skipped by this bot for a while, so its next deposit walks home.
 * 2. NEAR HOME: every container within STORAGE_NEAR of home, by the town's memory of it (containerStatus): one found
 *    full in the last 30 min, one with a verified blocked lid, and one that failed twice >= 10 min apart are KNOWN and
 *    skipped; one in its backoff after a failure is UNKNOWN; the rest are visited until the sweep's time runs out
 *    (anything not reached is unknown, without a strike). A double chest is one: its partner is marked from the
 *    block state. Any that takes items ends it. A scan that throws defers -- it is never "no containers".
 * 3. Then fullChestNext: any unknown -> defer; the NEW-CHEST BUDGET (10 min apart, 4 a day, 12 standing, a reconciled
 *    ledger) -> refuse, said plainly; else the CARRIED chest is placed -- crafted only when none is carried -- at the
 *    first cell chestSiteRefusal accepts in rings 1-4 around the full chest, re-checked from its standing cell. The
 *    claim is taken only with CLAIM_BUDGET_MS of the watchdog left, and covers ONE placement submission; a miss is
 *    read back for PLACE_READBACK_MS and left unresolved in the ledger for reconciliation. Then ONE retry.
 * Every refusal near home pauses deposits for this bot (bankClosed, reopened early when its reason goes away), and
 * writes one `deposit_new_chest` row.
 */
async function fullChestRecovery (ctx, { item, signal, first, firstMeta = {}, firstOutcome = 'full', firstStatus = null, firstFail = null, exclude = [],
                                         eligible = 0, bagBefore = 0, startedAt = Date.now() }) {
  const { bot } = ctx
  const isContainer = b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry.blocks[b.type]?.name)
  const home = homeVec()
  const world = bot.worldId ?? null
  const dir = townDir(), key = townKey(home)
  const here = () => bot.entity.position
  const left = () => timeLeft({ startedAt, timeoutMs: config.skills.defaultTimeoutMs })
  // THE TOWN IS WHERE ITS CONTAINERS ARE: a first chest in town (inTown) is town storage, whether or not the
  // bot reached it (a remembered or unreachable first chest is handled before any walk).
  const nearHome = inTown(home, first.position)
  const mem = readTownMemory(dir, key, world)
  const tried = new Map(exclude.map(q => [posKey(q), { at: q, room: 'excluded' }]))
  const mark = (q, room) => { if (q) tried.set(posKey(q), { at: q, room }) }
  const markWith = (q, m, room) => { mark(q, room); if (m?.double) mark(chestPartner(bot, q), `${room}_double`) }
  const triedList = () => [...tried.values()].map(v => v.at)
  const bag = () => bagTotal(bot.inventory?.items?.() ?? [])
  let containers = null, unknown = 0, unknownTime = 0, budget = null
  const remember = (q, outcome) => { const e = rememberTown(bot, q, outcome); if (e) mem[posKey(q)] = e; return e }
  // An UNKNOWN outcome is a strike in the town's memory; the second >= 10 min after the first makes it unusable.
  const strike = q => {
    const e = remember(q, 'unknown')
    if (e && containerStatus(e) === 'unusable') { mark(q, 'unusable'); return }
    unknown++
  }
  // ONE ROW PER DECISION. key=value, decision first: logEvent cuts detail at 300 characters, so tried[] goes last.
  const row = (decision, status, extra = {}) => {
    const triedS = [...tried.values()].filter(v => v.room !== 'excluded').map(v => `${posKey(v.at)}:${String(v.room).replace(/\s+/g, '_')}`).join(';')
    const f = Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' ')
    const b = budget ? ` standing=${budget.standing} today=${budget.today}` : ''
    logEvent({ kind: 'deposit_new_chest', status, snapshot: snapshot(bot),
               detail: (`decision=${decision} near_home=${nearHome} containers=${containers ?? '?'} unknown=${unknown}${b} bag=${bagBefore}->${bag()} ${f} tried=[${triedS}]`).slice(0, 300) })
  }
  // ONLY A TRULY CLOSED BANK PAUSES DEPOSITS (chestfull-02, closesBank): a defer -- some container's room unknown --
  // backs that container off in the town's memory and closes nothing.
  const shut = (outcome, why, until = null) => { if (closesBank(outcome)) closeBank(bot, why, closeMsFor(outcome, { until }), Date.now(), outcome) }
  const refuse = detail => ({ status: 'failed', failClass: 'storage_full', detail: `${detail} [bag ${bagBefore}->${bag()} items]` })

  // THE FIRST CONTAINER, as found -- or as the town remembers it (not visited: no new outcome is recorded).
  if (firstOutcome === 'memory') {
    mark(first.position, `${firstStatus}:memory`)
    if (firstStatus === 'backoff') unknown++
  } else if (firstOutcome === 'unknown') {
    if (nearHome) strike(first.position); else unknown++
    if (!tried.has(posKey(first.position))) mark(first.position, `unknown:${firstFail?.failClass ?? 'open'}`)
  } else {
    if (nearHome) remember(first.position, firstOutcome)
    markWith(first.position, firstMeta, firstOutcome)
  }

  // ONE ATTEMPT AT ANOTHER CONTAINER, recovery off: 'success' ends it; storage_full is full; a blocked lid is
  // unavailable; an unsettled transfer stops everything; a throw or any other class is a strike (unknown).
  const attempt = async (at, until) => {
    const m = {}
    // WHERE THIS WALK BEGINS, read before it (the live Vec3 moves): a travel failure from OUTSIDE town strikes no town
    // chest -- the same rule as the first walk (Codex round 2: the far sweep struck a town alternate from 20 out, and the
    // next deposit refused in place on the town's memory instead of walking).
    const began = inTown(home, here())
    let again
    try {
      again = await deposit(ctx, { item }, signal, { noRecovery: true, preferAt: at, exclude: triedList(), meta: m, until })
    } catch (e) {
      if (e?.aborted || signal?.aborted) throw e
      if (walkFailure(e) === 'interrupted') {   // someone else took the pathfinder: no strike, nothing more this attempt
        mark(at, 'interrupted')
        return { status: 'failed', failClass: 'path_interrupted', detail: `the walk to the chest at ${posKey(at)} was interrupted: ${String(e?.message ?? e).slice(0, 60)}` }
      }
      mark(at, 'unknown:travel')
      if (began) strike(at); else unknown++
      return null
    }
    const opened = m.at ?? at
    if (posKey(opened) !== posKey(at)) mark(at, 'gone')   // deposit fell back to another container: `at` is not one now
    if (again.status === 'success') { markWith(opened, m, `took_${again.moved ?? '?'}`); return again }
    if (again.status === 'no_effect' || again.failClass === 'transfer_unsettled') return again
    // OUR CLOCK, NOT THE CONTAINER: returned unchanged, before any decision that could pause banking (Codex round 4).
    if (again.failClass === 'path_budget' && again.status === 'unknown') { mark(at, 'unknown:time'); return again }
    if (again.failClass === 'storage_full') { markWith(opened, m, 'full'); remember(opened, 'full'); return null }
    if (again.failClass === 'container_blocked') { mark(at, 'unavailable'); remember(at, 'unavailable'); return null }
    mark(at, `unknown:${again.failClass ?? again.status}`); strike(at)
    return null
  }

  if (!nearHome) {
    // FAR FROM HOME: the old alternates, never a new chest -- and town storage stays open: the far chests are skipped.
    for (let alternates = 0; alternates < 2; alternates++) {
      const backedOff = q => { const u = bot.skipContainers?.get?.(posKey(q)); return !!u && u > Date.now() }
      const other = bot.findBlock({ matching: b => isContainer(b) && (!b.position || (!tried.has(posKey(b.position)) && !backedOff(b.position) && depositTargetOk(home, b.position))), maxDistance: 24 })
      if (!other) break
      mark(other.position, 'pending')
      const done = await attempt(other.position, Date.now() + Math.max(0, left() - 10_000))
      if (done) return done.status === 'success' ? { ...done, detail: `${done.detail} (the first chest was full; used another one nearby)` } : done
    }
    bot.skipContainers ??= new Map()
    // Never a TOWN container (Codex, chestfull-02 round 1): hiding it would leave the walk home with nothing to open.
    for (const v of tried.values()) if (v.room !== 'excluded' && !inTown(home, v.at)) bot.skipContainers.set(posKey(v.at), Date.now() + FAR_SKIP_MS)
    row('far', 'no_effect')
    return firstOutcome === 'full' || tried.size > 1
      ? refuse(`deposit at the town chest -- the chests here are full or closed, and new chests are only made in town; had ${eligible} item(s)`)
      : firstFail
  }

  // NEAR HOME: every container in town (inTown; the scan's sphere reaches the cylinder's corners), nearest to the bot first.
  let near
  try {
    if (typeof bot.findBlocks !== 'function') throw new Error('no findBlocks')
    near = (bot.findBlocks({ point: home, matching: isContainer, maxDistance: TOWN_SCAN_RADIUS, count: 64 }) ?? []).filter(q => inTown(home, q))
  } catch (e) {
    const why = `the town's containers could not be listed (${String(e?.message ?? e).slice(0, 40)}), so nothing is built`
    unknown++
    shut('defer', why)
    row('defer', 'no_effect', { scan: 'failed' })
    return refuse(`deposit again later -- ${why}; had ${eligible} item(s)`)
  }
  containers = near.length
  const deadline = Math.min(Date.now() + TOWN_SWEEP_MS, Date.now() + left() - AFTER_SWEEP_MS)
  for (const at of [...near].sort((a, b) => here().distanceTo(a) - here().distanceTo(b))) {
    if (tried.has(posKey(at))) continue
    check(signal)
    const st = containerStatus(mem[posKey(at)])
    if (st === 'full' || st === 'unavailable' || st === 'unusable') { mark(at, `${st}:memory`); continue }
    if (st === 'backoff') { mark(at, 'unknown:backoff'); unknown++; continue }
    if (Date.now() > deadline) { mark(at, 'unknown:time'); unknown++; unknownTime++; continue }   // not reached in time: no strike
    mark(at, 'pending')
    const done = await attempt(at, deadline)
    if (done) return done.status === 'success' ? { ...done, detail: `${done.detail} (the first chest was full; used another one in town)` } : done
  }

  // THE LEDGER, reconciled against the world, then the budget.
  const readName = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? blockNameOf(bot, b) : null }
  const claims = readClaims(dir, key)
  reconcileClaims({ dir, key, claims, read: readName, world })
  budget = chestBudget({ claims, world })
  const carried = carriedChest(bot.inventory.items())
  const next = fullChestNext({ nearHome, unknown, budget, carried: !!carried })
  // TIME ALONE IS NOT A REASON TO PAUSE BANKING (Codex round 4): when every unknown is a container the watchdog left
  // unvisited, the answer is the clamped timeout's own -- deposit again -- with no closure.
  if (next === 'defer' && unknown === unknownTime) {
    row('out_of_time', 'no_effect')
    return { status: 'unknown', failClass: 'path_budget',
             detail: `deposit again: this attempt ran out of time before reaching ${unknownTime} more container(s) in town [bag ${bagBefore}->${bag()} items]` }
  }
  if (next === 'defer') {
    const why = `${unknown} container(s) in town could not be opened, reached or read in time, so their room is unknown and no chest is built`
    shut('defer', why)
    row('defer', 'no_effect')
    return refuse(`deposit again later -- ${why}; had ${eligible} item(s)`)
  }
  if (next === 'refuse_cap') {
    // CAPACITY MANAGEMENT, SAID PLAINLY: the town's budget for new chests is spent, not "the chest is full".
    shut('refuse_cap', budget.why, budget.until)
    row('refuse_cap', 'no_effect')
    return refuse(`keep working; the town is at its chest limit -- the chests are full and ${budget.why}; had ${eligible} item(s)`)
  }

  // A NEW CHEST: where first, so nothing is crafted for a town with no cell to put it in.
  const read = readCell(bot)
  const fullNear = [...tried.values()].filter(v => /^(full|unavailable|unusable)/.test(String(v.room)) && inTown(home, v.at)).map(v => v.at)
  const anchor = fullNear.sort((a, b) => here().distanceTo(a) - here().distanceTo(b))[0] ?? first.position
  const composterSites = [readTownSite(dir, townSiteKey()).site, findTownComposter(bot)?.position].filter(Boolean)
  const skip = []
  const pickAt = () => pickChestSite({ read, anchor, home, composterSites, bodies: bodiesAround(bot), skip })
  let pick = pickAt()
  if (!pick.site) {
    shut('no_site', pick.why)
    row(next, 'no_effect', { site: 'none' })
    return refuse(`keep working and deposit later -- the town chests are full and ${pick.why}; had ${eligible} item(s)`)
  }

  // THE DECISION DRIVES IT: fullChestNext said place_carried (a chest is in the bag) or craft (none is).
  const source = next === 'place_carried' ? 'carried' : 'crafted'
  if (next === 'craft') {
    if (left() < 2 * CLAIM_BUDGET_MS) {
      shut('defer', 'not enough of this attempt\'s time left to craft and place a chest')
      row(next, 'no_effect', { time: Math.round(left() / 1000) })
      return refuse(`deposit again -- the town chests are full and this attempt had no time left to make one; had ${eligible} item(s)`)
    }
    let built
    try { built = await craft(ctx, { item: 'chest', count: 1 }, signal, 1) } catch (e) {
      if (e?.aborted || signal?.aborted) throw e
      built = { status: 'failed', failClass: 'other', detail: String(e?.message ?? e).slice(0, 80) }
    }
    if (built?.status !== 'success' || !carriedChest(bot.inventory.items())) {
      // The craft's own detail leads with ITS remedy, which may be a deposit: never quoted inside a deposit's refusal.
      const why = built?.failClass === 'inventory_full' ? 'the bag has no room to craft a chest' : `no chest could be crafted (${built?.failClass ?? 'not in the bag'})`
      shut('craft_failed', why)
      row('craft', 'failed', { source })
      return refuse(`keep working and deposit later -- the town chests are full and ${why}; had ${eligible} item(s)`)
    }
  }
  const name = carriedChest(bot.inventory.items())
  // SEARCH BEFORE SUBMITTING: walk to the standing cell and re-check the site there, with the bodies as they are now.
  // A refused site may give way to the next one -- nothing has been submitted yet.
  let site = null
  for (let i = 0; i < 3 && pick.site; i++) {
    check(signal)
    skip.push(pick.site)
    try {
      if (pick.stand) await chestWalk(bot, new goals.GoalBlock(pick.stand.x, pick.stand.y, pick.stand.z), Math.max(1, Math.min(RECOVERY_WALK_MS, left() - CLAIM_BUDGET_MS)))
    } catch (e) {
      if (e?.aborted || signal?.aborted) throw e
      // SOMEONE ELSE HAS THE PATHFINDER (a reflex): nothing is placed, nothing walked to, nothing closed (Codex round 1).
      if (walkFailure(e) === 'interrupted') {
        row(next, 'no_effect', { source, interrupted: 1 })
        return { status: 'failed', failClass: 'path_interrupted', detail: `the walk to the new chest's cell was interrupted: ${String(e?.message ?? e).slice(0, 60)}` }
      }
    }
    check(signal)
    if (!chestSiteRefusal(read, pick.site, { home, composterSites, bodies: bodiesAround(bot) })) { site = pick.site; break }
    pick = pickAt()
  }
  if (!site) {
    shut('no_site', 'no cell for a new chest stayed valid from its standing cell')
    row(next, 'no_effect', { source, site: 'refused_on_arrival' })
    return refuse(`keep working and deposit later -- the town chests are full and no cell for a new ${name} stayed valid; had ${eligible} item(s)`)
  }
  // ENOUGH TIME FOR THE PLACEMENT, ITS READ-BACK AND THE RETRY, or no claim at all.
  if (left() < CLAIM_BUDGET_MS) {
    shut('defer', 'not enough of this attempt\'s time left to place a chest')
    row(next, 'no_effect', { source, time: Math.round(left() / 1000) })
    return refuse(`deposit again -- the town chests are full and this attempt had no time left to place the ${name}; had ${eligible} item(s)`)
  }
  const claim = claimNewChest({ dir, key, site, world })
  if (!claim.ok) {
    shut('refuse_cap', claim.why, claim.until)
    row(next, 'no_effect', { source, claim: String(claim.why).slice(0, 40).replace(/\s+/g, '_') })
    return refuse(`keep working; the town is at its chest limit -- ${claim.why}; had ${eligible} item(s)`)
  }
  // ONE SUBMISSION PER CLAIM (MAX_SITE_TRIES). An abort from here on is never refunded: the claim stays, unresolved,
  // until reconcileClaims reads the cell.
  const cell = new Vec3(site.x, site.y, site.z)
  let placedAt = null, lastWhy = 'did not land'
  for (let i = 0; i < MAX_SITE_TRIES && !placedAt; i++) {
    let put
    try { put = await place(ctx, { item: name, x: site.x, y: site.y, z: site.z }, signal) } catch (e) {
      if (e?.aborted || signal?.aborted) throw e
      put = { status: 'failed', detail: String(e?.message ?? e).slice(0, 80) }
    }
    if (put?.status === 'success') { placedAt = cell; break }
    // NOT YET A FAILURE: a late server ack can still put the chest down. Read the cell until PLACE_READBACK_MS has passed.
    for (const until = Date.now() + PLACE_READBACK_MS; Date.now() < until;) {
      if (/^(chest|trapped_chest)$/.test(bot.blockAt(cell)?.name ?? '')) { placedAt = cell; break }
      await sleep(100, signal)
    }
    lastWhy = String(put?.detail ?? 'did not land').slice(0, 80)
  }
  const distTo = q => (q ? Math.round(Math.hypot(site.x - q.x, site.y - q.y, site.z - q.z) * 10) / 10 : 'none')
  const where = { at: posKey(site), home_d: distTo(home), composter_d: distTo(composterSites[0] ?? null), source, claim: claim.n }
  if (!placedAt) {
    shut('place_failed', `the new chest could not be put down (${lastWhy})`)
    row(next, 'failed', { ...where, placed: 0, last: lastWhy.replace(/\s+/g, '_').slice(0, 40) })
    return refuse(`keep working and deposit later -- the town chests are full and the ${name} could not be put down at ${posKey(site)} (${lastWhy}); had ${eligible} item(s)`)
  }
  writeClaimState(dir, key, claim.n, 'placed')
  let again
  try { again = await deposit(ctx, { item }, signal, { noRecovery: true, preferAt: placedAt, exclude: triedList(), until: Date.now() + Math.max(0, left() - 2_000) }) } catch (e) {
    if (e?.aborted || signal?.aborted) throw e
    if (walkFailure(e) === 'interrupted') {   // a reflex has the pathfinder: the chest is down, nothing else is decided
      row(next, 'failed', { ...where, placed: 1, interrupted: 1 })
      return { status: 'failed', failClass: 'path_interrupted', detail: `placed a new ${name} at ${posKey(placedAt)}; the walk to it was interrupted: ${String(e?.message ?? e).slice(0, 60)}` }
    }
    again = { status: 'failed', failClass: 'no_path', detail: `the new chest could not be reached: ${String(e?.message ?? e).slice(0, 60)}` }
  }
  const extra = { ...where, moved: again.moved ?? 0, placed: 1 }
  if (again.status === 'no_effect') { row(next, 'no_effect', extra); return again }   // nothing was left to hand over
  // OUR CLOCK ran out at the new chest (Codex round 4): returned unchanged -- the chest is down, nothing is paused.
  if (again.failClass === 'path_budget' && again.status === 'unknown') { row(next, 'no_effect', { ...extra, out_of_time: 1 }); return again }
  // A STACK STILL ON THE CURSOR is a transfer failure, propagated unchanged (Codex round 2), as the sweep does.
  if (again.failClass === 'transfer_unsettled') { row(next, 'failed', { ...extra, unsettled: 1 }); return again }
  if (again.status === 'success') {
    row(next, 'success', extra)
    return { ...again, detail: `${again.detail} (the town chests were full, so it ${source === 'carried' ? `placed the ${name} it carried` : 'crafted and placed a chest'} at ${posKey(placedAt)}) [bag ${bagBefore}->${bag()} items]` }
  }
  // ITS ROOM IS UNKNOWN, NOT FULL (Codex round 1): a new chest that was not reached or not opened is backed off in the
  // town's memory, and nothing is closed. Only a new chest that OPENED and took nothing closes the bank.
  if (again.failClass !== 'storage_full') {
    remember(placedAt, 'unknown')
    row(next, 'failed', { ...extra, unknown_room: 1 })
    return refuse(`deposit again later -- a new ${name} went down at ${posKey(placedAt)} but could not be reached or opened (${String(again.detail ?? '').slice(0, 60)}); had ${eligible} item(s)`)
  }
  shut('retry_failed', `a new chest went down at ${posKey(placedAt)} and took nothing`)
  row(next, 'failed', extra)
  return refuse(`placed a new ${name} at ${posKey(placedAt)} and still could not bank ${eligible} item(s) — ${again.detail}`)
}

// --------------------------------------------------------------- board -----
//
// The board arm's only means of sharing, and the placebo arm's structurally
// identical trip to nowhere. Both walk; only one files.
//
// A module-level set, not persisted: it records what THIS PROCESS has already
// filed, so a bot loitering at the lectern cannot re-file the same belief every
// cycle. The board's own dedup is the real defence (one reporter is never two
// witnesses however often it files); this just keeps the ledger from filling
// with no-op posts.
const filedThisRun = new Set()
let boardHandle = null

async function board(ctx, _args, signal) {
  const { bot } = ctx
  const { boardX, boardY, boardZ } = config.world

  // The hive and isolated arms have no board in their worlds. The prompt does
  // not offer it to them, but a model can still emit any skill name, and a bot
  // walking to a lectern that does not exist would be a silent cross-arm
  // contamination -- the isolated arm paying the board arm's travel cost.
  if (config.memory.scope !== 'board' && config.memory.scope !== 'checkpoint') {
    return { status: 'no_effect', detail: 'there is no bulletin board in this world' }
  }

  // THE WALK IS THE TREATMENT. Everything else in this function is bookkeeping.
  if (!withinBoard(bot.entity?.position)) {
    const walked = await goto(ctx, { x: boardX, y: boardY, z: boardZ, range: 2 }, signal)
    check(signal)
    if (!withinBoard(bot.entity?.position)) {
      return { ...walked, status: 'failed', failClass: walked.failClass ?? 'travel_incomplete',
               detail: `could not reach the town board at ${boardX},${boardZ}: ${walked.detail ?? 'no route'}` }
    }
  }

  const lessons = openLessons()
  const self = config.bot.name

  // PLACEBO ARM. Same journey, same prompt affordance, same evidence shape --
  // but nothing is shared. It exists because the board bundles four treatments
  // at once (travel, ritual, a spatial attractor, and sharing), and without
  // this arm any board effect could be any of the four. Checkpointing private
  // memory is a real act with a real cost and no informational value, which is
  // exactly the control we want.
  if (config.memory.scope === 'checkpoint') {
    lessons.save()
    const n = Object.keys(lessons.data?.avoid ?? {}).length
    return { status: 'success', adopted: 0, filed: n,
             detail: `checkpointed ${n} private beliefs at the totem (nothing shared)` }
  }

  boardHandle ??= openBoard(fs)
  boardHandle.load()                       // another bot may have filed since we last looked
  const r = doVisit({ board: boardHandle, lessons, self,
                      pos: bot.entity?.position, filed: filedThisRun })

  if (!r.filed && !r.adopted) {
    // Honest no-op: the evidence gate would catch this anyway, but saying so
    // here gives the model a reason not to keep walking back.
    return { status: 'unknown', failClass: 'no_measurable_change', adopted: 0, filed: 0,
             detail: 'visited the board: nothing new to file and nothing new to adopt' }
  }
  return { status: 'success', adopted: r.adopted, filed: r.filed,
           detail: `filed ${r.filed}, adopted ${r.adopted} from the board` +
                   (r.credit ? ` (freshness credit ${r.credit})` : '') }
}

// -------------------------------------------------------------- status -----
// Reports state and changes nothing. Genuinely useful when the agent's picture
// of itself is stale, and pure procrastination otherwise -- one bot called it 17
// times and its memory now reads "status has worked 18x -- a reliable choice".
// Same treatment as a full-belly eat: real, allowed, never counted as progress.
async function status(ctx) {
  const { bot } = ctx
  const p = bot.entity.position
  const inv = bot.inventory.items().length
  return {
    status: 'no_effect',
    detail: `hp ${bot.health?.toFixed(0)} food ${bot.food} at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)} | ${inv} stacks`,
  }
}


// ----------------------------------------------------------------- eat -----
const FOOD_PRIORITY = [
  'golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
  'cooked_chicken', 'bread', 'baked_potato', 'cooked_cod', 'cooked_salmon',
  'apple', 'carrot', 'melon_slice', 'sweet_berries',
]

async function eat(ctx, _args, signal) {
  const { bot } = ctx
  // Eating when already full is a NO-OP, and reporting it as success taught the
  // fleet to do nothing. Measured live: 15 `eat -> success "not hungry"` in ten
  // minutes while every productive skill was blocked, and the lessons file duly
  // recorded "eat has worked 15x -- a reliable choice" and fed that back into
  // the prompt. All five bots stood motionless, succeeding.
  //
  // A skill that changes nothing must not be reinforced as achievement
  // (ADR-0003). `no_effect` is deliberately distinct from `failed`: the bot did
  // nothing wrong, there was simply nothing to do, and the admission layer
  // should not start avoiding `eat` for when it IS hungry.
  if ((bot.food ?? 20) >= 20) {
    return { status: 'no_effect', detail: 'already full — nothing to do', failClass: 'no_effect' }
  }
  const items = bot.inventory.items()
  const food = FOOD_PRIORITY.map(n => items.find(i => i.name === n)).find(Boolean)
  if (!food) return { status: 'failed', failClass: 'inventory', detail: 'no edible food in inventory' }
  check(signal)
  try {
    await bot.equip(food, 'hand')
    await bot.consume()
    return { status: 'success', detail: `ate ${food.name}, hunger now ${bot.food}` }
  } catch (e) {
    return { status: 'failed', failClass: 'other',
             detail: `could not eat ${food.name}: ${e.message}` }
  }
}

// --------------------------------------------------------------- craft -----
//
// Crafting is the first skill that can FAIL FOR A GOOD REASON -- missing
// ingredients is information, not a bug. The detail string names what is
// missing so the model can choose to gather it, which is the whole point of
// having a cognitive layer at all.
//
// CRAFT RESOLVES ITS OWN PREREQUISITES, and that is the difference between a
// fleet that reaches stone tools and one that does not.
//
// Measured on the rebuilt world, one run:
//     craft oak_planks       4/4    100%
//     craft stick            2/2    100%
//     craft wooden_pickaxe   0/16     0%
// while Gather01 stood on THIRTY-ONE oak logs. Every ingredient was craftable
// and the tool never was, because the model asks for the GOAL and the skill only
// ever answered "you are missing planks". One decision per 70 seconds is far too
// coarse a channel to walk a recipe tree through -- the model would need three
// correct decisions in a row, from a prompt that never names the next step.
//
// So the skill walks it. It already computes exactly what is missing in order to
// report it; making those first costs nothing extra and turns one decision into
// a finished subtree. This is the DAG prerequisite resolution from PPA
// (arXiv 2503.03505), which covers 790+ items with a single LLM call rather than
// chain-length-plus-one.
//
// Depth is bounded because the tree bottoms out at things you gather rather than
// craft (planks <- log <- the world). Three levels covers log -> planks -> stick
// -> pickaxe, which is the deepest chain before stone.
const MAX_CRAFT_DEPTH = 3
/** Per-candidate ceiling on bot.placeBlock's wait for the server's blockUpdate. */
const PLACE_ACK_MS = 3_000

// THE TABLE THIS CALL PUT DOWN COMES BACK WITH IT (craftroom.mjs has the measurement). Every level of the recursion
// is its own call through this wrapper, so each takes back exactly the tables IT placed, after it has used them,
// success or failure. Never a table this call did not place.
//
// `owed` is how many tables the CALLERS placed and still mean to take back: their slot is reserved here too, or a
// 36/36 bag fills the slot the table freed and the retake finds no room (review: the exact population losing tables).
//
// An abort during the retake is RETHROWN after the cleanup it interrupted, never swallowed into a success.
//
// A THROW CARRIES THE VERIFIED TALLY (review: an abort between executions, or during the retake after a success, made
// the runner's catch-result lose `produced`, so verified progress vanished). `e.verified` is THIS call's requested
// item and its verified executions; each level overwrites it on the way up, so a sub-craft's planks never reach a
// pickaxe's caller.
async function craft(ctx, args, signal, depth = 0, owed = 0) {
  const placedHere = []
  const progress = { item: args?.item ?? null, requested: Math.max(1, Math.floor(Number(args?.count ?? 1) || 1)),
                     executions: 0, produced: 0 }
  // `from`: this level's own progress, or -- for a throw during the retake, after craftLevel returned -- its result
  // (a recursive craft's verified executions happened in the retry one level down). A tally already on the error for
  // the SAME item and at least as much is kept (the deeper retry's); one for another item (a sub-craft's) is replaced.
  const carry = (e, from = progress) => {
    if (!e || typeof e !== 'object') return e
    const mine = { item: from?.item ?? progress.item, requested: Number(from?.requested ?? progress.requested),
                   executions: Number(from?.executions ?? 0), produced: Number(from?.produced ?? 0) }
    const prior = e.verified
    if (!(prior && prior.item === mine.item && Number(prior.produced ?? 0) >= mine.produced)) e.verified = mine
    return e
  }
  let out
  let retook = null
  let pending = null            // an error craftLevel threw, which a cleanup error would REPLACE
  try {
    out = await craftLevel(ctx, args, signal, depth, placedHere, owed, progress)
  } catch (e) {
    throw (pending = carry(e))
  } finally {
    if (placedHere.length) {
      try { retook = await retakeTables(ctx, placedHere, signal) } catch (e) {
        // The replacement inherits the pending error's verified tally (a deeper retry's executions), then this
        // level's own result or progress may only add to it (carry keeps the larger tally for the same item).
        if ((e?.aborted || signal?.aborted) && pending?.verified && e && typeof e === 'object') e.verified = { ...pending.verified }
        if (e?.aborted || signal?.aborted) throw carry(e, out?.item === progress.item ? out : progress)
        retook = `could not take the table back: ${String(e?.message ?? e).slice(0, 60)}`
      }
    }
  }
  return retook ? { ...out, detail: `${out.detail} (${retook})` } : out
}

async function craftLevel(ctx, { item, count = 1 }, signal, depth = 0, placedHere = [], owed = 0, progress = {}) {
  const { bot } = ctx
  const owedNow = () => owed + placedHere.length
  // A stop at a SUB-level is reported as the REQUESTED item with nothing made: its own fields are about the planks.
  const nothingMade = { item, requested: Math.max(1, Math.floor(Number(count) || 1)), executions: 0, produced: 0 }
  const def = bot.registry.itemsByName[item]
  // `other`, not `bad_target`, deliberately. bad_target IS evidence about the
  // action and would begin writing permanent avoid rules for every item name the
  // model mistypes; the classifier filed this string as `other` and gave it no
  // vote. Stating the class is meant to end the guessing, not to change policy.
  if (!def) return { status: 'failed', failClass: 'other', detail: `unknown item "${item}"` }

  // Recipes needing no table first -- cheaper and always available.
  let recipe = bot.recipesFor(def.id, null, count, null)[0]
  let table = null
  const stationDid = []       // what the station branch below did, for the success line
  // THIS LEVEL'S ROOM STATE (craftExecutions): two make-room tries and the table reserve, shared by every execution
  // here and by every step of a whole-tree plan.
  const rs = { tries: 0, tableYields: false, pickupDealt: false, owed: owedNow, stationDid }

  if (!recipe) {
    const tableBlock = bot.findBlock({
      matching: b => bot.registry.blocks[b.type]?.name === 'crafting_table',
      maxDistance: 32,
    })
    if (tableBlock) {
      check(signal)
      // Two attempts at getting close, because the first often fails on the
      // approach rather than the destination -- a bot standing on the table's
      // own block, or one leaf between it and the goal. GoalNear(1) puts it
      // adjacent; GoalNear(3) is the fallback that still leaves it in reach.
      for (const range of [1, 3]) {
        try {
          await withTimeout(bot.pathfinder.goto(
            new goals.GoalNear(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, range)), 12000, bot)
          break
        } catch { /* try the looser goal, then let the reach check below decide */ }
      }
      table = tableBlock
      recipe = bot.recipesFor(def.id, null, count, table)[0]
    }
  }

  if (!recipe) {
    const hasTable = bot.inventory.items().some(i => i.name === 'crafting_table')

    // NAME THE MISSING INGREDIENT. "missing ingredients" taught the model
    // nothing, and it showed: a bot stood two blocks from the crafting table
    // holding 59 oak_log and asked for `stick` five times and `wooden_pickaxe`
    // four times, never once for `oak_planks` -- the intermediate step. It had
    // the raw material and no way to learn what the gap was.
    //
    // Ask the registry which ingredients ANY recipe for this item wants, and
    // report the ones the bot does not have. The model can act on a name.
    let missing = []
    let notCraftable = false
    try {
      const all = [
        ...bot.recipesAll(def.id, null, null),
        ...(bot.recipesAll(def.id, null, true) ?? []),
      ]
      // NOT EVERYTHING HAS A RECIPE, and the code below assumed everything did.
      //
      // oak_log has zero recipes: it is gathered, never crafted. With no recipe
      // there are no ingredients, so `missing` came out empty, and empty
      // `missing` plus a crafting_table in the pack means `stationOnly` -- so
      // `craft oak_log` answered "no recipe available for oak_log; place the
      // crafting_table first". A bot cannot place its way to a tree.
      if (all.length === 0) notCraftable = true
      // Report the CLOSEST recipe, not the union of every variant. Minecraft
      // has a plank recipe per wood type, so unioning them told a bot holding
      // oak_log that it needed "cherry_planks and bamboo_planks and
      // mangrove_planks" -- true of some recipe, useless as advice.
      //
      // Fewest-missing-ingredients is the recipe the bot is nearest to being
      // able to make, which is the one worth naming.
      let best = null
      const counted = heldCounts(bot.inventory.items())
      // Used only by the `canonical` tiebreak below, which is a NAME preference
      // for the common wood and not a claim about what the bot can make. The
      // affinity test above deliberately does not use it -- that is the bug this
      // pair replaced.
      const stem = x => String(x).split(' ').pop().split('_')[0]
      // RANK EVERY VARIANT, NOT THE FIRST TWELVE.
      //
      // This was slice(0, 12), sized for the 12 wooden_pickaxe recipes. `stick`
      // has THIRTEEN in 1.21.8, so its last variant could never be chosen, and
      // the affinity test above is only honest if it ranks the whole candidate
      // set -- ranking a truncated one is worse than not ranking, because it
      // looks decided. The registry's true maximum for any item is 44 (smoker).
      //
      // The loop body is a few array reads per recipe and breaks as soon as it
      // finds a zero-gap variant, which is the common case.
      for (const r of all.slice(0, RECIPE_VARIANT_CAP)) {
        const gap = []
        for (const d of (r.delta ?? [])) {
          if (d.count >= 0) continue                       // positive = produced
          const n = bot.registry.items[d.id]?.name
          if (n && countItem(bot, n) < -d.count) gap.push(`${-d.count}x ${n}`)
        }
        // Tiebreak toward what this bot could ACTUALLY make. Every wood type
        // has its own plank recipe, so a bot holding oak_log was told it needed
        // "cherry_planks" -- true, and unreachable. Prefer a recipe whose
        // missing ingredients share a stem with something in the inventory
        // (oak_log -> oak_planks), because that is the one step it can take.
        // A STEM MATCH IS NOT A SOURCE, AND ONE SAPLING COST THE FLEET ITS WOOD.
        //
        // This split every inventory name on '_' and kept the first token, so
        // `oak_sapling`, `oak_leaves` and `oak_boat` all registered as "this bot
        // has oak". None of them craft into an oak plank. A bot carrying 186
        // birch logs and 27 oak saplings therefore scored oak and birch EQUAL,
        // and the `canonical` tiebreak below -- which exists to point a bot with
        // no wood at all toward the common wood -- broke that tie for oak and
        // sent it to look for an oak tree it did not need.
        //
        // Measured over 6h on 80 bots: 134 of 211 `gather oak_* first` craft
        // failures (63.5%) were bots holding another log type at that moment.
        // It is the single largest craft failure shape, and it feeds the gather
        // loop -- oak_log is 32.5% of all gather requests and succeeds 8.9% of
        // the time, because much of the fleet is standing in birch forest.
        //
        // So affinity now asks the question that actually matters: can the bot
        // PRODUCE this ingredient from something in the pack? A held ingredient
        // counts, and so does a held source for it -- birch_log for
        // birch_planks. Nothing else does.
        const affinity = g => g.filter(x => canProduce(counted, x)).length
        // When the bot holds NO wood at all, every wood variant ties: same
        // number of missing ingredients, zero affinity for all of them. The
        // tiebreak then kept whichever the registry happened to return first,
        // and Miner01 -- 24 sticks, no logs -- was told it needed "3x
        // cherry_planks". True of some recipe, and advice it could never act on;
        // there is no cherry in this world's spawn forest.
        //
        // Prefer the wood the fleet actually has access to, so a bot with
        // nothing is pointed at a material it can go and find.
        const DEFAULT_WOOD = 'oak'
        const canonical = g => g.filter(x => stem(x) === DEFAULT_WOOD).length
        // REACHABILITY, ahead of the wood preference and behind affinity. A gap naming a block
        // that cannot exist where the bot stands is worse than one naming a block that can,
        // whatever else is equal -- and every clause below it still decides ties as before.
        const by = bot?.entity?.position?.y
        const reach = g => gapReachCost(g, Number.isFinite(by) ? by : 64,
                                        bot?.game?.dimension ?? 'overworld')
        const better = (g, b) =>
          g.length < b.length ||
          (g.length === b.length && affinity(g) > affinity(b)) ||
          (g.length === b.length && affinity(g) === affinity(b) && reach(g) < reach(b)) ||
          (g.length === b.length && affinity(g) === affinity(b) && reach(g) === reach(b) &&
            canonical(g) > canonical(b))
        if (!best || better(gap, best)) best = gap
        if (best.length === 0) break
      }
      missing = best ?? []
    } catch { /* registry shape varies by version; fall back to the generic message */ }

    if (notCraftable) {
      return {
        status: 'failed',
        failClass: 'not_craftable',
        gap: item,
        detail: `${item} cannot be crafted -- nothing makes it; gather it instead`,
      }
    }

    const why = missing.length
      ? `needs ${missing.join(' and ')} (you have ` +
        `${inventoryLine(bot.inventory.items(), { focus: [...missing, item] })})`
      : 'missing ingredients or need a crafting_table nearby'

    // TWO DIFFERENT FAILURES, and this returned one class for both. "I have the
    // ingredients but no station" and "I have no ingredients" need different
    // remedies, and classifyFailure() already distinguishes them -- but an
    // explicit failClass wins over the classifier, so `needs_station` was
    // unreachable on the live write path and only ever appeared in tests.
    const stationOnly = hasTable && !missing.length
    // Why placing the station failed, if we got as far as trying. Declared out
    // here because the refusal that needs it is built well below the attempt.
    let stationFailure = ''

    // ---- resolve prerequisites, then try again -----------------------------
    //
    // Everything needed to do this was already computed above for the error
    // message. Acting on it is the whole change.
    // What the sub-crafts below could not resolve. Reported instead of `missing`
    // when nothing could be made -- see the return at the bottom.
    const blockedBy = []

    // THE WHOLE TREE, THE FULL QUANTITY AND THE STATION, PLANNED BEFORE ANYTHING IS CRAFTED (craftplan.mjs).
    // The per-ingredient recursion below made each missing ingredient for its parent alone and lived on the old
    // over-crafting for slack; with exact counts `craft wooden_pickaxe` from logs failed 6/6 on the sandbox.
    // The plan is all or nothing: a shortfall is named and nothing is spent (4 planks + 2 sticks and no table
    // used to become a table and then a refusal). The chosen recipes are crafted exactly -- no re-choosing.
    // A table is READY only when it is within STATION_REACH after the walk above, or carried.
    let plan = null
    let planShort = ''
    try {
      const inReach = !!table && bot.entity.position.distanceTo(table.position.offset(0.5, 0.5, 0.5)) <= STATION_REACH
      plan = craftPlanFor(bot, item, count, hasTable || inReach)
    } catch { plan = null }
    if (plan?.ok) {
      const ran = await runCraftPlan(ctx, plan, { item, count, signal, table, rs, placedHere, progress })
      if (ran.status !== 'success') return ran
      const { local, ranOut, made: first, ...counts } = ran
      return { ...counts, verification: local ? 'verified_local' : 'server',
               detail: (ranOut ? `crafted ${ran.produced} of ${ran.requested} ${item}, then the ingredients ran out`
                 : `crafted ${ran.produced}x ${item}`) +
                       `${stationDid.length ? ` (${stationDid.join('; ')})` : ''}` +
                       `${first.length ? ` (first made ${first.join(', ')})` : ''}` }
    }
    if (plan) {
      // Bare names in the gap, as the recursion's sub.gap was: the lessons key must not move with the quantity.
      blockedBy.push(...plan.shortfall.map(x => x.item))
      planShort = plan.shortfall.map(x => `${x.count}x ${x.item}`).join(' and ')
    }

    if (depth < MAX_CRAFT_DEPTH && !plan) {
      const made = []

      // A STATION IS A PREREQUISITE TOO, and it is the one that was actually
      // blocking the fleet.
      //
      // The first version of this only handled `stationOnly` -- a bot already
      // CARRYING a table that never placed it. Measured after deploying it,
      // every bot had solved the ingredient half and stalled anyway:
      //     Miner01   4 oak_log, 14 oak_planks, 5 stick   -- and no table
      // A pickaxe needs 3 planks and 2 sticks, so nothing was missing except a
      // crafting table nobody owned, which meant `missing` was empty, `hasTable`
      // was false, and the resolver had no branch to take.
      //
      // So: no ingredients outstanding and still no recipe means the station is
      // the gap. Make one if needed, then put it on the ground.
      if (!missing.length && !table) {
        check(signal)
        if (!hasTable) {
          const built = await craft(ctx, { item: 'crafting_table', count: 1 }, signal, depth + 1, owedNow())
          if (built.status === 'success') made.push('crafting_table')
          else if (STOP_CLASSES.has(built.failClass)) return { ...built, ...nothingMade, detail: `${built.detail} [making a crafting_table for ${item}]` }
        }
        const put = await place(ctx, { item: 'crafting_table' }, signal)
        if (put.status === 'success' && put.at) placedHere.push(watchPlaced(bot, put.at))
        if (put.status === 'success') made.push('placed crafting_table')
        // Kept so the refusal below can say what actually stopped it.
        else stationFailure = put.detail || put.failClass || ''
      }

      // One level down, per missing ingredient. `missing` entries look like
      // "3x oak_planks"; anything that does not parse is left alone rather than
      // guessed at. (Only reached when the planner above could not run.)
      for (const m of missing) {
        const parsed = /^(\d+)x\s+(\S+)$/.exec(m)
        if (!parsed) continue
        const [, need, name] = parsed
        if (name === item) continue          // a recipe that needs itself: never recurse
        check(signal)
        const sub = await craft(ctx, { item: name, count: Number(need) }, signal, depth + 1, owedNow())
        if (sub.status === 'success') made.push(name)
        // A FULL BAG OR AN UNVERIFIED CRAFT STOPS THE TREE. Either is the real blocker with its own remedy;
        // filed as this level's missing ingredient it would print "needs 3x oak_planks" to a bot that has the logs
        // and no slot to put the planks in.
        else if (STOP_CLASSES.has(sub.failClass)) return { ...sub, ...nothingMade, detail: `${sub.detail} [making ${name} for ${item}]` }
        // KEEP WHAT THE DEEPER CALL LEARNED. It just walked a level further
        // down the tree and knows a truer answer than the gap computed here.
        else blockedBy.push(sub.gap || m)
      }

      // Only retry if something actually changed. Retrying after a no-op is how
      // a bounded recursion still burns the whole skill timeout.
      if (made.length) {
        check(signal)
        const retry = await craft(ctx, { item, count }, signal, depth + 1, owedNow())
        if (retry.status === 'success') {
          // THE RETRY'S COUNTS travel with it (item/requested/executions/produced): it is the same item and count.
          return { ...retry, status: 'success', detail: `${retry.detail} (first made ${made.join(', ')})` }
        }
        // Report the RETRY's failure, not the one computed before we changed the
        // inventory -- that gap is now stale, and a stale gap is exactly what
        // makes the lessons store punish an action that was making progress.
        return { ...retry, detail: `${retry.detail} [after making ${made.join(', ')}]` }
      }
    }

    // REPORT THE GAP THE BOT CAN ACT ON.
    //
    // The recursion above already discovered the real blocker and then threw it
    // away. Gather02 spent 56 attempts on this: it holds saplings and sticks,
    // asks for a wooden_pickaxe, and is told "needs 3x oak_planks". It cannot
    // make oak_planks either -- it has no oak_log, and no amount of crafting
    // produces one. So the model re-proposed `craft wooden_pickaxe` until the
    // lessons store banned it, at which point the bot had no next move at all.
    //
    // Naming the deepest unresolved requirement turns a dead end into an
    // instruction: gather oak_log.
    // DEDUPE BY ITEM, NOT BY STRING. `new Set(blockedBy)` compares the whole entry, counts and all,
    // so one blocker seen twice with different quantities survives twice: MEASURED, `craft
    // wooden_pickaxe` holding 4 oak_log yields the gap `2x oak_planks+3x oak_planks`. That is one
    // gap printed as two, and worse, the gap string is the lessons key -- lessons.mjs treats a
    // changed gap as progress and zeroes the failure streak, so a key that moves with the missing
    // QUANTITY can never accumulate. Keep the largest requirement per item.
    const rootGap = blockedBy.length ? dedupeGap(blockedBy) : missing
    const gatherFirst = rootGap.filter(g => {
      const n = /^\d+x\s+(\S+)$/.exec(g)?.[1] ?? g
      const d = bot.registry.itemsByName[n]
      if (!d) return false
      try {
        return [...bot.recipesAll(d.id, null, null),
                ...(bot.recipesAll(d.id, null, true) ?? [])].length === 0
      } catch { return false }
    })

    const stationOnlyNow = stationOnly && !planShort
    return {
      status: 'failed',
      failClass: stationOnlyNow ? 'needs_station' : 'missing_ingredients',
      // THE GAP, named exactly, so the lessons store can tell "stuck on the
      // same missing thing" from "working through the tech tree". Without it
      // the only question the store can ask is "did craft fail again", which
      // is how `craft oak_planks` reached 47 while the bot was doing the right
      // thing every time. Sorted so two identical gaps compare equal.
      gap: stationOnlyNow ? 'crafting_table' : rootGap.slice().sort().join('+'),
      detail: stationOnlyNow
        // SAY WHY THE TABLE IS NOT DOWN, because we already tried to put it down.
        //
        // `stationOnly` means the bot HAS a table and lacks nothing else, so the
        // resolver above has already called place() and place() has already
        // failed. Printing "place the crafting_table first" then tells the model
        // to redo the exact thing that just failed, and it obliges: 194 of these
        // in 200 minutes, 187 for wooden_pickaxe, concentrated in 15 bots. The
        // reason was computed, returned, and discarded one frame later.
        //
        // This is the rule about a refusal naming a remedy the bot can perform
        // from where it is. "Place it" is not that remedy when placing is what
        // failed; the obstacle is.
        ? `no recipe available for ${item}: it needs a crafting table, you are carrying one, ` +
          `and putting it down failed — ${stationFailure || 'no reason recorded'}`
        : gatherFirst.length
          ? `cannot craft ${item} -- gather ${gatherFirst.join(' and ')} first, ` +
            `nothing crafts it${planShort ? ` (short ${planShort} for the whole tree)` : ''} (you have ` +
            `${inventoryLine(bot.inventory.items(), { focus: [...gatherFirst, item] })})` +
            belowGroundHint(bot) + craftableAlternative(bot, item)
          : `cannot craft ${item} -- ${planShort ? `short ${planShort} for the whole tree (you have ` +
              `${inventoryLine(bot.inventory.items(), { focus: [...plan.shortfall.map(x => x.item), item] })})` : why}`,
    }
  }

  check(signal)

  // A table craft only works from within reach. The pathing above swallows its
  // own failure ("try crafting anyway, we may already be close enough"), so a
  // bot that could not reach the table attempted the craft from wherever it
  // stood -- the server never opens the window, and mineflayer sits there until
  // `Event windowOpen did not fire within timeout of 20000ms`.
  //
  // That error was the only thing between Miner01's 16 sticks and a wooden
  // pickaxe, and therefore between this fleet and the entire stone tier.
  //
  // Check the distance we ACTUALLY achieved rather than assuming the goto
  // worked, and look at the block first: mineflayer's block interaction is much
  // more reliable when the bot is facing what it is using.
  if (table) {
    let reach = bot.entity.position.distanceTo(table.position.offset(0.5, 0.5, 0.5))
    // THE REMEDY WAS IN ITS POCKET, craft edition.
    //
    // findBlock takes the nearest table within 32 blocks, the walk above may
    // not close that distance, and this used to fail with "move to x,z first"
    // -- advice about a place the bot has just failed to reach -- while the
    // resolver's own place() branch only ever ran when NO table was found.
    // Measured 2026-09-10, 3h, full walk: 77 craft runs failed here across 23
    // bots, 58 of them CARRYING a crafting_table at the time; 66 of the 77
    // were furnace, stone_pickaxe and iron_pickaxe -- the tier-gating crafts.
    // smelt learned the same lesson on e2b18f0. Same rule: place the one you
    // carry, once per call, and only when the known one is out of reach.
    let carried = bot.inventory.items().some(i => i.name === 'crafting_table')
    // WHAT THIS BRANCH DID is pushed onto stationDid and said on the success
    // line. The station-room canary (hive-d, 2026-09-11) could not be read
    // because a table made from wood or a cell dug for it left no mark in the
    // craft event -- the `_dig_approach` lesson (a capability is not shipped
    // until the observation names it), not applied here the first time.
    // NO TABLE IN THE PACK BUT WOOD IN IT: make one. The first fleet-wide hour
    // of the carried-table fix showed 20 of 38 far-table refusals on bots that
    // carried no table at all -- the resolver's own make-a-table branch runs
    // only when NO table was found, and a found-but-unreachable table blocked
    // it. Same bound as everything else here: one level down, once.
    if (reach > STATION_REACH && !carried && depth < MAX_CRAFT_DEPTH) {
      const inv = bot.inventory.items()
      const wood = inv.filter(i => /_log$|_planks$/.test(i.name)).reduce((n, i) => n + i.count, 0)
      if (wood >= 1) {
        check(signal)
        const built = await craft(ctx, { item: 'crafting_table', count: 1 }, signal, depth + 1, owedNow())
        if (STOP_CLASSES.has(built.failClass)) return { ...built, ...nothingMade, detail: `${built.detail} [making a crafting_table for ${item}]` }
        if (built.status === 'success') {
          carried = bot.inventory.items().some(i => i.name === 'crafting_table')
          stationDid.push('made a crafting_table from wood')
          // THE TABLE ATE THE PLANKS? Re-ask the recipe with the new inventory
          // before spending the placement; a stale recipe would craft from
          // ingredients that are no longer there (Codex review).
          const fresh = bot.recipesFor(def.id, null, count, true)[0]
          if (!fresh) {
            return { status: 'failed', failClass: 'missing_ingredients', gap: item,
                     detail: `made a crafting_table for ${item} and now lack the ingredients — ` +
                             `gather more wood first (you have ${inventoryLine(bot.inventory.items(), { focus: [item] })})` }
          }
          recipe = fresh
        }
      }
    }
    // Why putting it down failed, if it did. Both reviews of this change made
    // the same point the stationOnly branch above already makes: a refusal
    // that drops place()'s reason sends the model to redo the thing that just
    // failed. So the reason travels.
    let putSaid = ''
    if (reach > STATION_REACH && carried) {
      check(signal)
      const put = await place(ctx, { item: 'crafting_table' }, signal)
      if (put.status === 'success' && put.at) placedHere.push(watchPlaced(bot, put.at))
      // THE TABLE IT JUST PUT DOWN, by the coordinate place() returns -- not a
      // second nearest-search, which could name a different table. The
      // nearest-search is only the fallback for an older place() shape.
      const mine = (put.status === 'success' && put.at && bot.blockAt(put.at)?.name === 'crafting_table')
        ? bot.blockAt(put.at)
        : put.status === 'success'
          ? bot.findBlock({ matching: b => bot.registry.blocks[b.type]?.name === 'crafting_table',
                            maxDistance: STATION_REACH + 1 })
          : null
      if (mine) {
        table = mine
        recipe = bot.recipesFor(def.id, null, count, table)[0] ?? recipe
        reach = bot.entity.position.distanceTo(table.position.offset(0.5, 0.5, 0.5))
        stationDid.push(/made room by digging (\w+)/.test(put.detail || '')
          ? `placed the carried table, made room by digging ${RegExp.$1}`
          : 'placed the carried table')
      } else {
        putSaid = put.status === 'success'
          ? 'placed one but could not find it afterwards'
          : `putting down the one you carry failed: ${put.detail || put.failClass || 'no reason recorded'}`
      }
    }
    if (reach > STATION_REACH) {
      return {
        status: 'failed',
        failClass: 'no_path',
        detail: `crafting_table is ${Math.round(reach)} blocks away and could not be reached — ` +
                `${item} needs one within 4 blocks; move to ${table.position.x},${table.position.z} first` +
                (putSaid ? ` (${putSaid})` : ''),
      }
    }
    try { await bot.lookAt(table.position.offset(0.5, 0.5, 0.5), true) } catch { /* not fatal */ }
  }

  // THE EXECUTIONS, each behind the room check and each verified (craftExecutions, below). COUNT IS ITEMS
  // (craftsync.mjs): `craft 4 stick` is craftsFor(4) = one execution, and the result's `requested` is 4. The result
  // carries `item`, `requested` (items asked for), `executions` and `produced` (items verified to have arrived), so no
  // caller has to parse "1 of 3" out of prose.
  const requested = Math.max(1, Math.floor(Number(count) || 1))
  const tally = (executions, produced) => ({ item, requested, executions, produced })
  let executions = 0, produced = 0
  const ran = await craftExecutions(ctx, { item, recipe, crafts: craftsFor(count, recipe), table, anchor: table, signal,
    deadline: craftDeadline(ctx), rs,
    onVerified: n => { executions++; produced += n; Object.assign(progress, tally(executions, produced)) } })
  if (!ran.ok) return { ...ran.out, ...tally(executions, produced) }
  // `verification` says how the executions were confirmed: 'server' (craftsync's answered resyncs) or 'verified_local'
  // (at least one only by the local count -- possible only without craftsync). The STATUS stays 'success': the runner
  // and cognitive layer only know success | failed | unknown.
  const verification = ran.local ? 'verified_local' : 'server'
  if (ran.ranOut) {
    return { status: 'success', ...tally(executions, produced), verification,
             detail: `crafted ${produced} of ${requested} ${item}, then the ingredients ran out` +
                     `${stationDid.length ? ` (${stationDid.join('; ')})` : ''}` }
  }
  return { status: 'success', ...tally(executions, produced), verification,
           detail: `crafted ${produced}x ${item}${stationDid.length ? ` (${stationDid.join('; ')})` : ''}` }
}

/** How long a crafted result may take to appear in the LOCAL bag after bot.craft resolves (no craftsync). */
const CRAFT_READBACK_MS = 2_000
/** The craft's absolute deadline: the runner's start plus the skill timeout. craftsync stops clicking before it. */
const craftDeadline = ctx => (ctx.runner?.current?.startedAt ?? Date.now()) + config.skills.defaultTimeoutMs

/**
 * RUN `crafts` EXECUTIONS OF ONE RECIPE, ONE AT A TIME -> { ok: true, produced, local, ranOut } | { ok: false, out }
 *
 * THE ROOM CHECK SITS IN FRONT OF EVERY EXECUTION (craftroom.mjs). mineflayer's putAway(0) throws a result on the
 * ground when no slot takes it, and craftsync.mjs's copy of putSelectedItemRange keeps that rule: craftsync can
 * DETECT the loss (the server count does not rise) but not prevent it. So each bot.craft is ONE execution, made only
 * after craftRoom says the bag can take it, and asked again before the next (the server's auto-pickup can fill a slot
 * between two). Both the direct craft and every step of a whole-tree plan come through here.
 *
 * ONE VERIFIER: craftsync.mjs (executionVerdict). With craftsync installed bot.craft resolves only when its window-0
 * resyncs show the result arrived, and throws CraftSyncError otherwise; its verdict is the verdict. A not_in_inventory
 * denial that produced nothing is retried ONCE, when every ingredient is back and there is room -- craftsync's
 * after-resync has already written the server's bag into bot.inventory, so that read is the server's. Without
 * craftsync (its install failed at spawn) the local count is all there is, and a gain is `verified_local`.
 *
 * `anchor` is the crafting table the craft (or its plan) is using, also for a 2x2 step: the pickup step keeps it in reach.
 * `rs` is the level's room state ({ tries, tableYields, owed(), stationDid }), shared across a plan's steps so a plan
 * gets the same two make-room tries and the same table reserve as one direct craft. `onVerified(n)` is called with the
 * items each verified execution produced -- the ONLY place a produced count is taken, so nothing is counted twice.
 */
async function craftExecutions(ctx, { item, recipe, crafts, table, anchor = null, protect = [], signal, deadline, rs, onVerified = () => {} }) {
  const { bot } = ctx
  const plan = roomRecipe(bot.registry, recipe, item)
  const synced = !!bot.craftSync
  const perCraft = plan.result?.count ?? recipe?.result?.count ?? 1
  const name = plan.result?.name ?? item
  const reps = Math.max(1, Math.floor(Number(crafts) || 1))
  // THE CRAFT GOES FIRST, THE TABLE SECOND (owner decision, review round 2): when the only slot missing is the one held
  // back for a table this call or a caller will take back, and nothing can be freed, the craft is made and the table is
  // left standing -- a pickaxe is the measured loss, a table costs one log. Once set, the reserve stays off.
  const reserveFor = () => (rs.tableYields ? 0 : rs.owed())
  const sofar = done => (done ? ` (${done} of ${reps} executions already made)` : '')
  let done = 0, produced = 0, local = 0
  const fail = out => ({ ok: false, produced, out })
  // WITHOUT craftsync the local bag is the only witness, and the server's slot updates can land after bot.craft
  // resolves (composter build, sandbox Paper 1.21.8: an immediate read saw 4 logs / 8 planks while the server held 12
  // planks). So the local count is read back, bounded, before it decides. Under craftsync this is never consulted.
  const localArrival = async before => {
    const until = Date.now() + CRAFT_READBACK_MS
    for (;;) {
      if (craftArrived(before, bot.inventory.items(), plan.result)) return true
      if (Date.now() >= until) return false
      await sleep(50, signal)
    }
  }
  for (let rep = 0; rep < reps; rep++) {
    check(signal)
    let room = craftRoomNow(bot, plan, reserveFor())
    // The recipe was granted for the whole count; ingredients running out part-way is the end of the batch, not a
    // failure of what was already made.
    if (!room.ok && room.reason === 'ingredients' && done > 0) return { ok: true, produced, local, ranOut: true }
    // NO ROOM CHECK, NO CRAFT. mineflayer granted the recipe but the simulation cannot account for an ingredient
    // (an id the registry does not name): an unchecked craft is exactly the one that throws a pickaxe away.
    if (!room.ok && room.reason === 'ingredients') {
      logEvent({ kind: 'craft_room', status: 'refused', snapshot: snapshot(bot),
                 detail: `could not check room for ${item}: the simulation finds no ${room.missing} in the bag` })
      return fail({ status: 'unknown', failClass: 'unverified',
                    detail: `could not check room for ${item} (the recipe's ${room.missing} is not in the bag as the room ` +
                            'check reads it) — not crafted' })
    }
    // AN ITEM ON THE GROUND IS NEVER PAID FOR WITH A TOOL (Claude review). When the craft fits but for the slot held back
    // for a pickup in range (room.pickupOnly), the remedy is about the ITEM: wait for it to land or leave, collect it if
    // a slot is free to take it, else refuse naming it. ONCE PER CRAFT LEVEL (rs.pickupDealt, like the two make-room
    // tries): a long batch beside a stream of drops must not wait and walk again for every execution (Claude review).
    // makeCraftRoom is never called for it.
    const settle = async () => {
      if (!room.pickupOnly) return null
      if (rs.pickupDealt) return refusePickup(bot, item, room, ` (already waited for and tried an item once in this craft)${sofar(done)}`)
      rs.pickupDealt = true
      // THE STATION THIS CRAFT USES, even for a 2x2 step of a plan whose later steps need it (Claude review): the reach
      // band and the walk-back check are measured from it, or a pickup walk on a 2x2 step strands the next table step.
      const r = await settlePickup(ctx, { plan, owed: reserveFor, table: anchor ?? table, signal })
      room = r.room
      if (r.lostTable) {
        logEvent({ kind: 'craft_room', status: 'refused', snapshot: snapshot(bot), detail: `refused ${item}: reason=table_out_of_reach ${r.lostTable}` })
        return { status: 'unknown', failClass: 'unverified', detail: `${r.lostTable}; not crafted${sofar(done)}` }
      }
      if (r.said) rs.stationDid.push(r.said)
      return room.pickupOnly ? refusePickup(bot, item, room, `${r.tried ? ` (${r.tried})` : ''}${sofar(done)}`) : null
    }
    let held = await settle()
    if (held) return fail(held)
    // Up to two slots made per level: one for the output, one for a table this call (or a caller) will take back.
    while (!room.ok && room.reason === 'no_room' && rs.tries < 2) {
      rs.tries++
      const freed = await makeCraftRoom(ctx, item, plan, signal)
      check(signal)
      if (!freed.ok) {
        const bare = craftRoomNow(bot, plan, 0)
        if (bare.ok && reserveFor() > 0) {
          rs.tableYields = true
          room = bare
          rs.stationDid.push('no room to carry the table back as well: the craft goes first')
          break
        }
        return fail(refuseNoRoom(bot, item, plan, craftRoomNow(bot, plan, reserveFor()), freed.said, sofar(done), protect))
      }
      rs.stationDid.push(freed.said)
      room = craftRoomNow(bot, plan, reserveFor())
      held = await settle()
      if (held) return fail(held)
    }
    // Both tries made a slot and something refilled it (the server's auto-pickup cannot be refused): if the table's
    // reserved slot is all that is missing, the craft still goes first.
    if (!room.ok && room.reason === 'no_room' && reserveFor() > 0 && craftRoomNow(bot, plan, 0).ok) {
      rs.tableYields = true
      room = craftRoomNow(bot, plan, 0)
      rs.stationDid.push('no room to carry the table back as well: the craft goes first')
    }
    if (!room.ok) return fail(refuseNoRoom(bot, item, plan, room, 'already made room twice in this craft', sofar(done), protect))

    // ONE EXECUTION, VERIFIED. { signal, deadline }: craftsync stops the craft on abort or at the runner's deadline;
    // mineflayer itself ignores the fourth argument.
    let v, error, retries = 0, note = ''
    for (;;) {
      const before = bot.inventory.items().map(i => ({ name: i.name, count: i.count, slot: i.slot, durabilityUsed: i.durabilityUsed, maxDurability: i.maxDurability }))
      check(signal)
      let got = null
      error = null
      // ADMISSION AFTER THE BASELINE RESYNC (craftsync.mjs): the same room predicate, asked again on the bag the server
      // holds once craftsync has resynced it, before any craft click -- a pickup that landed while the resync was in
      // flight would otherwise leave the result no slot. Without craftsync the option is ignored (mineflayer).
      const admit = items => {
        const r = craftRoomNow(bot, plan, reserveFor(), items)
        if (r.ok) return true
        return { ok: false, failClass: 'craft_room', reason: r.reason === 'no_room' ? 'no_room_after_resync' : 'ingredients_after_resync',
                 detail: r.reason === 'no_room' ? `${items.length}/${BAG_SLOTS} slots, ${r.short} short, ${r.reserve} held back` : `no ${r.missing}` }
      }
      try { got = await bot.craft(recipe, 1, table ?? undefined, { signal, deadline, admit }) } catch (e) { error = e }
      // AN ABORT IS AN ABORT (craftFailureOutcome): the runner's aborted/interrupted, never a failure.
      if (error && (error.aborted || signal?.aborted)) throw new Aborted()
      v = executionVerdict({ synced, got, error, perCraft, arrived: !synced && !error && await localArrival(before) })
      if (!v.retry || retries >= 1) break
      // A SERVER DENIAL IS RETRIED ONCE (craftroom: the sandbox's 5 of 12 denied table crafts) -- only when the
      // server's own bag, which craftsync just resynced, has every ingredient back and room for the result.
      if (!ingredientsBack(before, bot.inventory.items(), plan.consumes)) { note = ' not_retried=ingredients_not_restored'; break }
      const again = craftRoomNow(bot, plan, reserveFor())
      if (!again.ok) { note = ` not_retried=${again.reason}`; break }
      retries++
    }
    if (v.refused) {
      // craftsync's admission said no after its resync: nothing was clicked. A bag that filled is the full-bag refusal;
      // ingredients the server's bag does not have is a don't-know about this bot's own bag.
      const now = craftRoomNow(bot, plan, reserveFor())
      logEvent({ kind: 'craft_room', status: 'refused', snapshot: snapshot(bot),
                 detail: `refused ${item} at admission: source=${v.source} verdict=${v.verdict} ` +
                         `(${bot.inventory.items().length}/${BAG_SLOTS} slots after the resync, ${now.reserve} held back)` })
      if (v.verdict === 'baseline_unanswered') {
        return fail({ status: 'unknown', failClass: 'unverified',
                      detail: `craft again: craftsync's baseline inventory resync was not answered, so the room for ${item} ` +
                              `could not be checked against the server's bag; nothing was clicked${sofar(done)}` })
      }
      if (now.pickupOnly) return fail(refusePickup(bot, item, now, ` (seen at admission, after craftsync's resync)${sofar(done)}`))
      if (v.verdict === 'no_room_after_resync') {
        return fail(refuseNoRoom(bot, item, plan, now.ok ? { ...now, short: 1 } : now,
          'the bag filled while craftsync resynced it, before any click', sofar(done), protect))
      }
      return fail({ status: 'unknown', failClass: 'unverified',
                    detail: `not crafted: the server's bag, resynced by craftsync, lacks an ingredient of ${item} (${error?.message ?? ''})${sofar(done)}` })
    }
    if (v.verdict === 'error') {
      const out = craftFailureOutcome(error, { aborted: !!signal?.aborted, item, table })
      if (out === CRAFT_ABORTED) throw new Aborted()
      return fail({ ...out, detail: `${out.detail}${sofar(done)}` })
    }
    const retried = (retries ? `retried=1 retry=${v.verdict}` : 'retried=0') + note
    const slots = bot.inventory.items().length
    // Every execution's source (server | local | none) is on its `_craft_room` row: the canary read alarms if local
    // fallbacks pass ~1% of crafts.
    const facts = `source=${v.source} verdict=${v.verdict} ${retried} (${slots}/${BAG_SLOTS} slots, predicted peak ${room.peak})`
    if (!v.ok) {
      const why = v.verdict === 'denied' ? `the server shows no new ${name} in the bag`
        : v.verdict === 'unanswered' ? `the server did not answer craftsync's inventory resync`
          : 'no new item by the local count (craftsync is not installed)'
      logEvent({ kind: 'craft_room', status: 'unverified', snapshot: snapshot(bot),
                 detail: `unverified ${item} rep ${rep + 1}/${reps}: ${why} ${facts}` })
      const out = error ? { ...craftFailureOutcome(error, { item, table }), reason: error.reason ?? null }
        : { status: 'unknown', failClass: 'unverified', verification: 'unverified', detail: `crafted ${item} but ${why}` }
      return fail({ ...out, detail: `${out.detail} (${slots}/${BAG_SLOTS} slots)${sofar(done)}` })
    }
    done++
    produced += v.produced
    if (v.source === 'local') local++
    onVerified(v.produced)
    logEvent({ kind: 'craft_room', status: v.source === 'local' ? 'verified_local' : 'success', snapshot: snapshot(bot),
               detail: `verified ${item} rep ${rep + 1}/${reps} (+${v.produced}) ${facts}` })
  }
  return { ok: true, produced, local, ranOut: false }
}

/**
 * THE ITEM THE ROOM CHECK IS HOLDING A SLOT FOR -> { room, said?, tried? }. Bounded: ~20 ticks for it to land or leave
 * range, then -- only with a free slot to take it -- the same pickup-box walk the table retake uses (pickupbox.mjs's
 * goal, 8 s), a short wait for it to arrive, and back within reach of the table if the walk left it. Never digs, never
 * spends a tool. An abort propagates.
 */
const PICKUP_SETTLE_TICKS = 20
async function settlePickup(ctx, { plan, owed, table, signal }) {
  const { bot } = ctx
  const now = () => craftRoomNow(bot, plan, owed())
  if (typeof bot.waitForTicks === 'function') await bot.waitForTicks(PICKUP_SETTLE_TICKS)
  else await sleep(PICKUP_SETTLE_TICKS * 50, signal)
  check(signal)
  let room = now()
  if (!room.pickupOnly) return { room, said: 'waited for an item on the ground to land or leave pickup range' }
  const p = room.pickup
  const e = p?.id != null ? bot.entities?.[p.id] : null
  const Goal = pickupGoalClass(goals)
  if (!e?.position || !Goal) return { room, tried: 'no way to walk to it' }
  const centre = table?.position ? table.position.offset(0.5, 0.5, 0.5) : null
  // ONLY AN ITEM IT CAN COLLECT AND STILL CRAFT: within the table's reach band, with a free slot or an open stack.
  const may = collectDecision({ items: bot.inventory.items(), pickup: { ...p, position: e.position }, tableCentre: centre,
                                stationReach: STATION_REACH, stackSizeOf: n => bot.registry?.itemsByName?.[n]?.stackSize })
  if (!may.collect) return { room, tried: may.why }
  let tried = ''
  if (!inPickupBox(bot.entity?.position, e.position)) {
    try { await withTimeout(bot.pathfinder.goto(new Goal(e.position)), 8_000, bot) } catch (err) {
      if (err?.aborted || signal?.aborted) throw err
      tried = `walking to it failed: ${String(err?.failClass ?? err?.message ?? err).slice(0, 40)}`
    }
  }
  for (let i = 0; i < 12 && bot.entities?.[p.id]; i++) await sleep(100, signal)
  check(signal)
  // THE WALK MAY HAVE LEFT THE TABLE'S REACH: back to it, bounded -- and then MEASURED. A craft out of reach waits ~20 s
  // for windowOpen and is filed as no_path, which teaches an avoid lesson against the craft (both reviews). Still out
  // of reach: the craft is not attempted, and the result names the table.
  const far = () => !!centre && !(bot.entity?.position?.distanceTo?.(centre) <= STATION_REACH)
  if (far()) {
    try { await withTimeout(bot.pathfinder.goto(new goals.GoalNear(table.position.x, table.position.y, table.position.z, 1)), 8_000, bot) } catch (err) {
      if (err?.aborted || signal?.aborted) throw err
    }
    check(signal)
    if (far()) {
      const t = table.position
      return { room: now(), lostTable: `walk back to the crafting_table at ${t.x},${t.y},${t.z}: the walk to collect ${p.name} left it out of reach` }
    }
  }
  room = now()
  if (!room.pickupOnly) return { room, said: `collected the ${p.name} that lay within pickup range` }
  return { room, tried: tried || 'it was still there after the walk' }
}

/** The pickup refusal: names the item and its distance, and a remedy that is about the item. */
function refusePickup(bot, item, room, note = '') {
  const items = bot.inventory.items()
  const p = room.pickup
  const what = `${p?.name ?? 'an item'} ${Number.isFinite(p?.distance) ? `${p.distance.toFixed(1)} blocks away` : 'nearby'}`
  logEvent({ kind: 'craft_room', status: 'refused', snapshot: snapshot(bot),
             detail: `refused ${item}: reason=pickup_pending ${what} (${items.length}/${BAG_SLOTS} slots)${note}` })
  return { status: 'failed', failClass: 'inventory_full', gap: 'inventory_space',
           detail: `step away from the ${what} or collect it. No room held for ${item}: the bag is ${items.length}/${BAG_SLOTS}, ` +
                   `but the ${what} is within pickup range and could take the slot the craft needs${note}` }
}

/**
 * The room check on the bag as it is NOW (admitRoom, craftroom.mjs): the TABLE'S SLOT is reserved when this call or a
 * caller placed a table it will take back and no crafting_table stack can receive it, and ONE MORE slot is held back
 * while an item on the ground is within pickup range (pickupPending). `items` defaults to mineflayer's bag; craftsync's
 * admission passes the bag it has just resynced from the server.
 */
function craftRoomNow(bot, plan, owedTables, items = bot.inventory.items()) {
  return admitRoom(items, plan, { owedTables, pickupNear: pickupNearest(bot.entity?.position, bot.entities) })
}

/** craftplan.mjs's view of this bot: what it holds, and every recipe as { yield, table, ingredients, ref }. */
function craftPlanFor (bot, item, count, tableReady) {
  const have = Object.fromEntries(heldCounts(bot.inventory.items()))
  const made = r => (r.delta ?? []).filter(d => d.count > 0).reduce((n, d) => n + d.count, 0)
  const shape = r => ({
    ref: r,
    yield: r.result?.count || made(r) || 1,      // mineflayer's delta carries the result too
    table: !!(r.requiresTable ?? r.needsTable),
    ingredients: (r.delta ?? []).filter(d => d.count < 0)
      .map(d => ({ name: bot.registry.items[d.id]?.name, count: -d.count })).filter(i => i.name),
  })
  const recipesOf = name => {
    const d = bot.registry.itemsByName[name]
    if (!d) return []
    try { return (bot.recipesAll(d.id, null, true) ?? []).map(shape) } catch { return [] }
  }
  // Ties (nothing held to rank by) go the way the gap advice above goes: the cheapest source to reach from
  // here first (cobblestone on the surface, cobbled_deepslate below y=0, never a smelted charcoal), then oak.
  const by = bot?.entity?.position?.y
  const reachCost = r => gapReachCost(r.ingredients.map(i => i.name), Number.isFinite(by) ? by : 64, bot?.game?.dimension ?? 'overworld')
  const prefer = r => -10 * reachCost(r) + r.ingredients.filter(i => /^oak_/.test(i.name)).length
  return planCraft({ item, count, recipesOf, have, tableReady, prefer })
}

/**
 * Craft a plan's steps with exactly the recipes it chose, putting down a table before the first step that needs
 * one (reusing one within STATION_REACH). Every step goes through craftExecutions: the room check before each
 * execution, craftsync's verdict after it. A table this plan puts down is watched from that moment and taken back by
 * craft()'s wrapper, like any other this level placed.
 * Returns { status: 'success', item, requested, executions, produced, local, ranOut, made } -- the counts are the
 * ROOT's only; sub-steps' items are named in `made`, never added to `produced` -- or a classified failure carrying the
 * root's counts. An interruption throws Aborted.
 */
async function runCraftPlan (ctx, plan, { item, count, signal, table, rs, placedHere, progress }) {
  const { bot } = ctx
  const deadline = craftDeadline(ctx)
  const reachOf = b => bot.entity.position.distanceTo(b.position.offset(0.5, 0.5, 0.5))
  const findStation = () => {
    if (table && reachOf(table) <= STATION_REACH) return table
    const b = bot.findBlock?.({ matching: x => bot.registry.blocks[x.type]?.name === 'crafting_table', maxDistance: STATION_REACH + 1 })
    return b && reachOf(b) <= STATION_REACH ? b : null
  }
  const requested = Math.max(1, Math.floor(Number(count) || 1))
  const made = []
  let produced = 0, executions = 0, local = 0, ranOut = false, station = null
  const tally = () => ({ item, requested, executions, produced })
  const after = () => (made.length ? ` [after making ${made.join(', ')}]` : '')
  // THE WHOLE CHAIN'S INGREDIENTS (Claude review): a refusal at the planks step must not advise depositing the planks or
  // logs a later step needs. Every step's refusal protects them all.
  const protect = [...new Set(plan.steps.flatMap(st => (st.recipe.ingredients ?? []).map(i => i.name)))].map(name => ({ name, count: 1 }))
  for (const step of plan.steps) {
    check(signal)
    if (step.recipe.table && !station) {
      station = findStation()
      if (!station) {
        const put = await place(ctx, { item: 'crafting_table' }, signal)
        if (put.status === 'success' && put.at) placedHere.push(watchPlaced(bot, put.at))
        station = put.status === 'success' && put.at && bot.blockAt(put.at)?.name === 'crafting_table' ? bot.blockAt(put.at) : findStation()
        if (!station) {
          return { status: 'failed', failClass: 'needs_station', gap: 'crafting_table', ...tally(),
                   detail: `could not put down a crafting_table for ${item}: ${put.detail || put.failClass || 'no reason recorded'}` +
                           after() }
        }
        rs.stationDid.push('placed a crafting_table')
      }
      try { await bot.lookAt(station.position.offset(0.5, 0.5, 0.5), true) } catch { /* not fatal */ }
    }
    const root = step.item === item
    const r = await craftExecutions(ctx, { item: step.item, recipe: step.recipe.ref, crafts: step.crafts,
      table: step.recipe.table ? station : undefined, anchor: station ?? undefined, protect, signal, deadline, rs,
      onVerified: n => { if (root) { executions++; produced += n; Object.assign(progress, tally()) } } })
    if (!r.ok) return { ...r.out, ...tally(), detail: `${r.out.detail}${root ? '' : ` [making ${step.item} for ${item}]`}${after()}` }
    local += r.local
    if (root) ranOut = ranOut || r.ranOut
    else made.push(`${r.produced}x ${step.item}`)
  }
  return { status: 'success', ...tally(), local, ranOut, made }
}

/** How many crafts make `count` items: each craft yields recipe.result.count. Pure, exported for tests. */
export function craftsFor (count, recipe) {
  const made = (recipe?.delta ?? []).filter(d => d.count > 0).reduce((n, d) => n + d.count, 0)   // delta carries the result too
  const per = Number(recipe?.result?.count) || made || 1
  return Math.max(1, Math.ceil(Number(count ?? 1) / per))
}

/** craftFailureOutcome's answer when the craft was interrupted: the skill rethrows Aborted. */
export const CRAFT_ABORTED = Symbol('craft aborted')
/**
 * What the craft skill returns when bot.craft rejects. Pure, exported for tests. An ABORT IS AN ABORT: with the
 * signal aborted (or craftsync reporting an interruption) the answer is CRAFT_ABORTED -- the runner's
 * aborted/interrupted -- never `failed`/`other`, which would put an interruption on the failure ledger.
 * craftsync's classes carry what the server actually delivered; none of them is in an evidence set.
 */
export function craftFailureOutcome (e, { aborted = false, item, table = null } = {}) {
  if (aborted || e?.aborted) return CRAFT_ABORTED
  const made = `${e?.produced ?? '?'} of ${e?.requested ?? '?'}`
  if (e?.failClass === 'craft_busy') {
    return { status: 'failed', failClass: 'craft_busy', detail: `another craft is still finishing — craft ${item} again in a few seconds` }
  }
  if (e?.failClass === 'craft_deadline') {
    return { status: statusFor('craft_deadline'), failClass: 'craft_deadline',
             detail: `ran out of time crafting ${item}: ${made} made — call craft again for the rest` }
  }
  if (e?.failClass === 'craft_unconfirmed') {
    // "did not reach the inventory" ONLY when the server's own count said so (not_in_inventory). An unanswered resync or
    // a click timeout is a don't-know: delivery could not be confirmed (Codex review).
    return { status: 'failed', failClass: 'craft_unconfirmed',
             detail: (e.reason === 'not_in_inventory'
               ? `crafting ${item} did not reach the inventory: ${made} made`
               : `could not confirm delivery of ${item}: ${made} confirmed`) + ` (${String(e.message).slice(0, 80)})` }
  }
  // Name the real problem. "Event windowOpen did not fire" is mineflayer's
  // wording for "the server refused to open the container", which in practice
  // means out of reach or the block is gone.
  const windowFail = /windowOpen|window/i.test(e?.message ?? '')
  return {
    status: 'failed',
    failClass: windowFail ? 'no_path' : 'other',
    detail: windowFail
      ? `could not open the crafting_table at ${table?.position.x},${table?.position.z} — ` +
        'stand next to it and face it before crafting'
      : `craft ${item} failed: ${String(e?.message ?? e).slice(0, 80)}`,
  }
}

/** Every consumed ingredient is back to at least its count before the attempt. */
function ingredientsBack(before, now, consumes = []) {
  const n = (list, name) => list.filter(i => i?.name === name).reduce((k, i) => k + (i.count ?? 1), 0)
  return consumes.every(c => n(now, c.name) >= n(before, c.name))
}

/**
 * IS THIS STILL THE TABLE WE PUT DOWN? Watch its cell from the moment place() returns: any block update there that
 * is not crafting_table -> crafting_table (a break, an unload, a world switch) taints it, even if a crafting table
 * stands there again by the retake. No way to watch (no block events) is "unsure", and unsure is left alone.
 */
function watchPlaced(bot, at) {
  const w = { at, stateId: bot.blockAt?.(at)?.stateId, changed: null, stop: () => {} }
  if (typeof bot.on !== 'function') { w.changed = 'no block events to watch it by'; return w }
  const ev = `blockUpdate:${new Vec3(at.x, at.y, at.z)}`   // prismarine-world's per-cell event: blockUpdate:(x, y, z)
  const fn = (was, now) => {
    if (w.changed) return
    if (was?.name !== 'crafting_table' || now?.name !== 'crafting_table') w.changed = `${was?.name ?? 'unknown'} -> ${now?.name ?? 'unknown'}`
  }
  // ITS CHUNK UNLOADING loses the history: a break while it was unloaded sends no blockUpdate, and the reload just
  // shows whatever stands there now (Codex review). prismarine-world emits the column's corner.
  const cx = Math.floor(at.x / 16) * 16; const cz = Math.floor(at.z / 16) * 16
  const onUnload = corner => { if (!w.changed && corner && corner.x === cx && corner.z === cz) w.changed = 'its chunk unloaded' }
  bot.on(ev, fn)
  bot.on('chunkColumnUnload', onUnload)
  w.stop = () => {
    try { const off = (bot.off ?? bot.removeListener); off?.call(bot, ev, fn); off?.call(bot, 'chunkColumnUnload', onUnload) } catch {}
  }
  return w
}

/** Failure classes that end the whole recipe tree instead of being reported as a missing ingredient. */
// craft_unconfirmed is craftsync's verdict that an execution did not arrive -- the verifier's stop, as `unverified`
// (the room check could not read the recipe) is the room check's.
const STOP_CLASSES = new Set(['inventory_full', 'unverified', 'craft_unconfirmed'])

/**
 * MAKE ROOM, EXECUTABLY -> { ok, said }: wear out one spent tool (craftRoomRemedy: never the last digging pickaxe),
 * on a block whose own drop cannot refill the slot (wearKeepsSlot). The ONLY remedy craft executes (review round 2):
 * placing a block to free a slot can seal a 1x2 tunnel or an escape stair, so a filler is only ever named in advice.
 * An abort during it propagates.
 */
async function makeCraftRoom(ctx, item, plan, signal) {
  const { bot } = ctx
  const items = bot.inventory.items()
  const row = (status, said) => logEvent({ kind: 'craft_room', status, snapshot: snapshot(bot),
    detail: `${item}: ${said} (${items.length} -> ${bot.inventory.items().length}/${BAG_SLOTS} slots)` })
  const pick = craftRoomRemedy(items, item)
  if (!pick) {
    const said = 'no spent tool that can be spared (the last digging pickaxe is kept)'
    row('refused', said)
    return { ok: false, said }
  }
  const cellOk = (bl, tool) => wearKeepsSlot(items, tool.name, bl.name, dropsOf(bot.registry, bl.name))
  const worn = await wearOutOne(ctx, pick.tool, signal, { cellOk, sidesOnly: true })
  check(signal)
  await bot.waitForTicks?.(12)   // a drop is collectable after 10 ticks: re-check the slots after it could land
  check(signal)
  const said = worn.ok
    ? `made room by wearing out a spent ${pick.tool.name} on ${worn.on}${pick.why === 'replaced' ? ' (the copy this craft replaces)' : ''}`
    : `wearing out a spent ${pick.tool.name} failed: ${worn.said}`
  row(worn.ok ? 'made_room' : 'refused', said)
  return { ok: worn.ok, said }
}

/**
 * WHAT FREES A SLOT FROM HERE -> { fill, remedy, kind }. ONLY A REMEDY WHOSE PRECONDITION HOLDS (roomAdvice): a
 * placement only where place() itself would find a site, eating only a single food when not full, else
 * `deposit <item>` (it walks home) for an item the craft does not need whose deposit empties a stack (depositTarget),
 * else it says nothing can be freed. `keep` -- the step's ingredients plus, for a plan, every step's -- is never
 * advised away.
 */
/**
 * THE ITEM A ROOM REFUSAL MAY TELL THE BOT TO DEPOSIT -> its name | null (depositTarget). NEVER WHILE THE BANK IS CLOSED
 * (chestfull.mjs): admission refuses every deposit then, so naming one would be a remedy the bot cannot perform.
 */
export function adviseDeposit (bot, items, keep = []) {
  if (bankClosed(bot) || !depositWorthIt(bot, items)) return null
  try { return depositTarget(items, depositPlan(items, null, { wants: bot.currentWants ?? [] }), keep) } catch { return null }
}
/**
 * WOULD ADMISSION LET A DEPOSIT THROUGH FROM HERE? Its deposit_not_worth_it test (admission.mjs): depositDue over the
 * same inputs -- the bankable count, the distance from spawn, a NON-DEEP container within 48. Advice never names a
 * deposit admission would refuse (Codex, chestfull-02 round 1: craft -> deposit -> refusal, with the deep chest now
 * not storage). The deposit milestone's own allowance is not known here, so this is never looser than admission.
 */
export function depositWorthIt (bot, items = []) {
  try {
    const home = homeVec()
    const wants = [...(bot.currentWants ?? []), ...DEPOSIT_ALWAYS]
    const storage = bot.findBlock?.({ maxDistance: 48, matching: b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry?.blocks?.[b.type]?.name) && depositTargetOk(home, b.position) })
    return depositDue({ bankable: bankableInventory(items, { wants }).count, distHome: horizontalDistanceFromSpawn(bot.entity.position),
                        storageWithin48: !!storage, occupiedSlots: items.length })
  } catch { return true }   // a world that cannot be asked: the advice as it was
}
export function slotRemedy(bot, items, keep = []) {
  const isPlaceable = n => placeableBlock(bot.registry, n)
  const fill = bagFill(items, isPlaceable, keep)
  let placeSite = false
  try { placeSite = !!fill.cheapest && placeSites(bot).length > 0 } catch { placeSite = false }
  const depositItem = adviseDeposit(bot, items, keep)
  let advice = roomAdvice({ items, consumes: keep, isPlaceable, placeSite, foodOrder: FOOD_PRIORITY, hunger: bot.food ?? 20, depositItem })
  // WHILE THE BANK IS CLOSED (Claude review): no deposit can be made, so "no deposit would empty a stack" is not the
  // truth either. A placement or a meal still comes first; otherwise the bot is told to keep working and craft later.
  const closed = bankClosed(bot)
  if (closed && advice.kind === 'none') advice = { kind: 'closed', text: closedRoomText(closed) }
  // A DEPOSIT WOULD FREE A SLOT BUT IS REFUSED FROM HERE (too far out, no usable chest in reach -- a deep one does not
  // count): the remedy is the walk home, which works from anywhere, and the deposit is admitted there (Codex,
  // chestfull-02 round 2: without this the refusal said nothing could be freed).
  if (!closed && advice.kind === 'none') {
    let far = null
    try { far = depositTarget(items, depositPlan(items, null, { wants: bot.currentWants ?? [] }), keep) } catch { far = null }
    if (far) advice = { kind: 'home', text: `home -- then deposit ${far}: banking is refused out here (no usable chest in reach) and the town chest frees slots` }
  }
  return { fill, remedy: advice.text, kind: advice.kind }
}

/** The refusal: the remedy first, then what fills the bag. Craft itself never deposits, never tosses. */
function refuseNoRoom(bot, item, plan, room, why, sofar = '', protect = []) {
  const items = bot.inventory.items()
  const { fill, remedy } = slotRemedy(bot, items, [...(plan.consumes ?? []), ...(protect ?? [])])
  const held = heldLine(room)
  logEvent({ kind: 'craft_room', status: 'refused', snapshot: snapshot(bot),
             detail: `refused ${item}: needs ${room.short} more slot(s) at ${items.length}/${BAG_SLOTS}${held ? ` (${held})` : ''}; ${why}; bag: ${fill.line}` })
  return { status: 'failed', failClass: 'inventory_full', gap: 'inventory_space',
           // THE REMEDY FIRST: the prompt keeps 220 characters of the whole outcome (cognitive.mjs formatOutcome).
           detail: `${remedy}. No room for ${item}: the bag is ${items.length}/${BAG_SLOTS} and the craft needs ${room.short} more ` +
                   `slot(s)${held ? ` (${held})` : ''} — ${fill.line}; ${why}${sofar}` }
}

/**
 * TAKE BACK THE TABLE THIS CALL PLACED -> a phrase for the craft's detail, or null.
 * Only the coordinates place() returned to this call; only while the block there is still a crafting_table; only
 * with room to receive it. The dig goes through collectManually (reach, dig, read-back, pickup), and the table
 * must ARRIVE in the bag. Every outcome is a `_table_retaken` row.
 */
async function retakeTables(ctx, watched, signal) {
  try { return await retakeWatched(ctx, watched, signal) } finally { for (const w of watched) w.stop() }
}
async function retakeWatched(ctx, watched, signal) {
  const { bot } = ctx
  const said = []
  // THE WATCH STAYS ON through the walk to the table and is asked again immediately before the dig (Codex review):
  // a table replaced while the bot approached is not ours. It stops only once that last check passes, so our own
  // dig is not read as someone else's.
  const notOurs = w => {
    const now = bot.blockAt(w.at)
    if (w.changed) return w.changed
    if (now?.name !== 'crafting_table') return `now ${now?.name ?? 'unknown'}`
    if (w.stateId != null && now.stateId != null && now.stateId !== w.stateId) return `state ${w.stateId} -> ${now.stateId}`
    return null
  }
  for (const w of watched) {
    const at = w.at
    const where = `${at.x},${at.y},${at.z}`
    const row = (status, detail) => logEvent({ kind: 'table_retaken', status, snapshot: snapshot(bot), detail: `${where}: ${detail}` })
    if (signal?.aborted) { row('left', 'craft aborted; an aborted skill does not dig'); said.push('left the table: aborted'); continue }
    const block = bot.blockAt(at)
    if (block?.name !== 'crafting_table') { row('gone', `no longer a crafting_table (${block?.name ?? 'unknown'})`); continue }
    // NEVER A TABLE THIS CALL CANNOT PROVE IS ITS OWN (Codex review): a break or a re-place at the cell since ours
    // went down, a different block state, or no way to watch -- leave it.
    const why = notOurs(w)
    if (why) { row('left', `changed since placement (${why}); not provably ours`); said.push('left the table: it changed since it was placed'); continue }
    const def = bot.registry?.itemsByName?.crafting_table
    if (!roomForOne(bot.inventory.items(), 'crafting_table', def?.stackSize ?? 64)) {
      row('left', `no room to carry it (${bot.inventory.items().length}/${BAG_SLOTS} slots)`)
      said.push(`left the table at ${where}: no room to carry it`)
      continue
    }
    const before = countItem(bot, 'crafting_table')
    const beforeDig = () => {
      const late = notOurs(w)
      if (late) throw Object.assign(new Error(`changed since placement (${late}); not provably ours`), { failClass: 'not_ours' })
      w.stop()
    }
    try {
      await collectManually(bot, block, signal, { beforeDig })
    } catch (e) {
      if (e?.aborted || signal?.aborted) { row('left', 'aborted mid-dig'); throw e }
      if (e?.failClass === 'not_ours') { row('left', `${e.message} (seen at the dig)`); said.push('left the table: it changed while the bot walked to it'); continue }
      row('failed', `dig failed: ${String(e?.message ?? e).slice(0, 80)}`)
      said.push(`could not take the table back: ${String(e?.message ?? e).slice(0, 60)}`)
      continue
    }
    let back = countItem(bot, 'crafting_table') > before
    for (let i = 0; i < 4 && !back; i++) { await sleep(100, signal); back = countItem(bot, 'crafting_table') > before }
    // NOT BACK: WALK INTO ITS PICKUP BOX (sandbox 46c4836, 1 of 4: the drop came to rest just outside the box and
    // pickupNearbyItems' GoalNear(drop, 1) called its target reached). The goal's end test is the server's own
    // pickup rule (pickupbox.mjs); arrival in the bag is the only success. Bounded.
    let walked = ''
    if (!back) {
      const centre = at.offset ? at.offset(0.5, 0.5, 0.5) : new Vec3(at.x + 0.5, at.y + 0.5, at.z + 0.5)
      const drop = bot.nearestEntity?.(e => {
        if (e?.name !== 'item' || !e.position) return false
        let n = null
        try { n = e.getDroppedItem?.()?.name } catch {}
        return n === 'crafting_table' && e.position.distanceTo(centre) < 4
      })
      const Goal = pickupGoalClass(goals)
      if (drop && Goal) {
        if (!inPickupBox(bot.entity?.position, drop.position)) {
          try { await withTimeout(bot.pathfinder.goto(new Goal(drop.position)), 8_000, bot) } catch (e) {
            if (e?.aborted || signal?.aborted) { row('left', 'aborted walking to its drop'); throw e }
            walked = ` (walk to its drop: ${String(e?.failClass ?? e?.message ?? e).slice(0, 40)})`
          }
        }
        for (let i = 0; i < 12 && !back; i++) { await sleep(100, signal); back = countItem(bot, 'crafting_table') > before }
        walked = walked || ' after walking into its pickup box'
      } else walked = drop ? ' (no pickup goal available)' : ' (its drop is not in sight)'
    }
    if (back) { row('success', `dug and back in the bag${walked}`); said.push('took the table back') } else {
      row('failed', `dug but it did not arrive (${bot.blockAt(at)?.name ?? 'unknown'} there now)${walked}`)
      said.push('dug the table but it did not arrive')
    }
  }
  return said.length ? said.join('; ') : null
}

// --------------------------------------------------------------- place -----
/**
 * Does this block on a chest's lid stop it opening? Minecraft refuses a chest
 * whose top face is covered by a solid full block; slabs, stairs, water, air,
 * torches and other non-full shapes leave it usable. Pure, exported for tests.
 */
/**
 * FAIL CLOSED: may this lid block be dug? Every neighbour (four sides and above) must be KNOWN, none liquid, and
 * the block above must not be a falling block. isSafeToBreak fails open when its checker is missing; a chest lid
 * is dug only on positive evidence (Codex, deposit pass 2).
 */
export function lidSafeToBreak (bot, p) {
  try {
    const at = (dx, dy, dz) => bot.blockAt?.(p.offset(dx, dy, dz))
    const around = [at(1, 0, 0), at(-1, 0, 0), at(0, 0, 1), at(0, 0, -1)]; const above = at(0, 1, 0)
    if (!above || around.some(b => !b)) return false
    if ([...around, above].some(b => ['water', 'lava', 'flowing_water', 'flowing_lava'].includes(b.name))) return false
    if (['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel'].includes(above.name)) return false
    return true
  } catch { return false }
}

export function chestLidBlocked (above) {
  if (!above || above.boundingBox !== 'block') return false
  const shapes = Array.isArray(above.shapes) ? above.shapes : null
  if (!shapes || !shapes.length) return true                                  // a solid we cannot inspect: assume a full cube
  return shapes.length === 1 && shapes[0][1] <= 0 && shapes[0][4] >= 1         // exactly one full-height box
}

/** Blocks that are put down to be USED, not stood on: they need a cell, not headroom. */
export const STATION_ITEMS = new Set(['crafting_table', 'furnace', 'blast_furnace', 'smoker', 'chest', 'barrel'])
/**
 * May this cell be dug to make room? The pathfinder's own veto when it can be
 * asked (liquid beside, falling block above); when it cannot, the same two
 * questions asked of bot.blockAt directly -- never "unknown means yes".
 */
export function roomVeto (bot, p) {
  const v = breakVetoAt(bot, p)
  if (v) return v
  // Six neighbours, and an UNREADABLE one is a veto: a wall cell that borders
  // an unloaded chunk may have anything behind it, and the pathfinder's own
  // stub for unloaded blocks reads as not-liquid, which is the fail-open this
  // function exists to close (Codex review).
  for (const [dx, dy, dz] of [[0, 1, 0], [0, -1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]]) {
    const n = bot.blockAt(p.offset(dx, dy, dz))
    if (!n || n.name == null) return 'unknown'
    if (n.name === 'water' || n.name === 'lava') return 'liquid'
  }
  const above = bot.blockAt(p.offset(0, 1, 0))
  if (above && FALLING.has(above.name)) return 'falling'
  return null
}

/**
 * DID THE PLACEMENT LAND? Compare the cell before and after, not its SHAPE.
 *
 * The old test was `put.boundingBox === 'empty'` -> not placed. That asks whether
 * the new block is SOLID, which is a different question, and one that every
 * non-solid placeable in the game answers "no" to: saplings, torches, every
 * plant, rails, pressure plates. minecraft-data 3.112.0 for 1.21.11 --
 * oak_sapling, birch_sapling and torch are all boundingBox 'empty'; dirt,
 * crafting_table and ladder are 'block'.
 *
 * Measured on the fleet over 24 h, and this is the positive control: every item
 * with boundingBox 'block' succeeds sometimes -- dirt 22/26, ladder 17/23,
 * crafting_table 13/16 -- and every item with boundingBox 'empty' succeeds
 * NEVER: torch 0/16. The fleet holds 485 saplings a day and cannot be credited
 * with planting one.
 *
 * `before !== after` is deliberately stricter than "not air": the target cell is
 * offset off a reference FACE and may legally start as short_grass or snow, and
 * the old `name !== 'air'` test would have scored those as placed without the
 * block ever changing.
 */
/**
 * DOES THIS ITEM NEED SOIL UNDER IT? `solid()` is not `soil`: place()'s candidate
 * scan accepts any solid top face, so a sapling offered a stone or cobblestone top
 * is proposed, sent, and rejected by the SERVER -- six candidates burned and the
 * skill fails for a reason nothing in our code names.
 *
 * Kept to the case that is actually blocked. Crops and other soil-bound placeables
 * are not in the fleet's vocabulary and adding them speculatively would widen a
 * predicate nothing exercises.
 */
/**
 * CAN A SAPLING LIVE IN THIS CELL? Pure; the caller supplies the three block names
 * it read. It lives here and not in workorder.mjs because workorder imports THIS
 * file, and the reverse import would be a cycle.
 *
 * `cell` must be genuinely REPLACEABLE, not merely non-solid: a sapling placed into
 * another sapling's cell is not a second tree.
 */
const PLANT_REPLACEABLE = new Set(['air', 'short_grass', 'tall_grass', 'fern', 'dead_bush', 'snow'])
// HOW MUCH AIR A SAPLING NEEDS ABOVE IT TO EVER BECOME A TREE. MEASURED, not typed,
// on the sandbox rig (rcon 25699, "test rig, not a fleet world") at randomTickSpeed
// 2000 with a floating grass platform at y=100 under open sky, three saplings per
// cell, a stone ceiling at a controlled offset:
//
//     ceiling at   none   +2    +3    +4    +5    +6    +7    +8
//     oak           3/3   0/3   0/3   0/3   0/3   3/3   3/3   3/3
//     birch         3/3   0/3   0/3   0/3   0/3   0/3   3/3   3/3
//
// A ceiling at +6 leaves FIVE air blocks above the sapling, so oak needs 5 and birch
// needs 6. The cliff is total: nothing grew one block short, everything grew at or
// above. Positive control: the unceilinged column grew 6/6, so a failure below the
// threshold is the ceiling and not the instrument.
//
// AND THE ROOM IS PURELY VERTICAL. A separate run put saplings at the bottom of
// hollow stone tubes of inner width 1, 3 and 5 with twelve air blocks above, and
// verified by reading the blocks back that every column really was clear: 2/2 grew in
// EVERY width including 1x1, against a control that also grew 2/2. So a clear column
// is sufficient and canopy width is not required. (The first attempt at that run had
// a `fill` silently hit the 32,768-block cap and leave terrain over the control; the
// script's own guard reported "INSTRUMENT BROKEN" rather than letting 1x1's success
// be read as a result.)
//
// jungle is NOT measured -- 15 of the fleet's 10,125 held saplings -- so it takes the
// conservative default rather than a guess that wastes them.
export const SAPLING_CLEARANCE = { oak_sapling: 5, birch_sapling: 6 }
export const SAPLING_CLEARANCE_DEFAULT = 7

export function saplingClearance (item) {
  return SAPLING_CLEARANCE[item] ?? SAPLING_CLEARANCE_DEFAULT
}

/**
 * CAN A SAPLING LIVE **AND GROW** HERE?
 *
 * `column` is the block names directly above the target cell, lowest first. It is
 * required for a sapling, because the version of this function that checked ONE block
 * above would have planted into any 1-to-5-block gap -- and the measurement above says
 * nothing in such a gap ever becomes a tree.
 *
 * That is not a cosmetic waste. isPlantable REJECTS a cell that already holds a
 * sapling, so a sapling placed where it cannot grow occupies that spot permanently.
 * The comment this replaced argued "a sapling that never grows still cost only one
 * decision"; it costs the sapling and the ground under it, for good, and the whole
 * point of the obligation is trees rather than placements.
 */
export function isPlantable ({ soil = null, cell = null, column = null, item = 'oak_sapling' } = {}) {
  if (!PLANTABLE_SOIL.has(soil)) return false
  if (!PLANT_REPLACEABLE.has(cell)) return false
  const need = saplingClearance(item)
  if (!Array.isArray(column) || column.length < need) return false
  for (let i = 0; i < need; i++) if (column[i] !== 'air') return false
  return true
}

/**
 * THE NEAREST CELL A SAPLING COULD LIVE IN. Impure by necessity -- it reads the
 * world -- but every decision it makes is isPlantable(), which is tested directly.
 *
 * Skips the cell the bot occupies: planting under your own feet is the one spot
 * guaranteed to be blocked by the bot itself.
 */
export function plantableSpotNear (bot, radius = 2, item = 'oak_sapling') {
  const p = bot?.entity?.position
  if (!p) return null
  const need = saplingClearance(item)
  for (const dy of [0, -1, 1]) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx === 0 && dz === 0) continue
        const soil = bot.blockAt(p.offset(dx, dy - 1, dz))
        const cell = bot.blockAt(p.offset(dx, dy, dz))
        if (!soil || !cell) continue
        // SOIL AND CELL FIRST, so the column read is only paid for a candidate that
        // has already survived the two cheap tests. The sweep is 75 cells; reading a
        // 5-to-7 block column for every one of them would be up to 525 blockAt calls
        // on the decision path, and almost all of it discarded.
        if (!PLANTABLE_SOIL.has(soil.name) || !PLANT_REPLACEABLE.has(cell.name)) continue
        const column = []
        for (let i = 1; i <= need; i++) {
          const b = bot.blockAt(p.offset(dx, dy + i, dz))
          if (!b) break
          column.push(b.name)
        }
        if (!isPlantable({ soil: soil.name, cell: cell.name, column, item })) continue
        return { x: cell.position.x, y: cell.position.y, z: cell.position.z }
      }
    }
  }
  return null
}

export const PLANTABLE_SOIL = new Set(
  ['dirt', 'grass_block', 'coarse_dirt', 'podzol', 'rooted_dirt', 'moss_block', 'mud'])
export function needsSoil (item) { return typeof item === 'string' && item.endsWith('_sapling') }
export function soilOk (item, under) {
  if (!needsSoil(item)) return true
  return !!under && PLANTABLE_SOIL.has(under)
}

export function placementLanded({ before, after }) {
  if (!after || after === 'air') return false
  if (before && before === after) return false
  return true
}

/**
 * DOES THE CELL AT `pos` SIT ON A CONTAINER'S LID? Pure over blockAt. A block on a chest's lid stops it opening, and the
 * next deposit digs it off (bank-fix 7720d8b). Checked INSIDE placeSites, so place() and craft's room advice (which asks
 * placeSites whether a placement exists) can never disagree about it; and on place()'s explicit coordinates.
 */
export function onContainerLid (bot, pos) {
  let below = null
  try { below = bot.blockAt?.(new Vec3(Math.floor(pos.x), Math.floor(pos.y) - 1, Math.floor(pos.z))) } catch { below = null }
  return /^(chest|trapped_chest|barrel|ender_chest|(\w+_)?shulker_box)$/.test(below?.name ?? '')
}

/**
 * WHERE CAN A BLOCK GO FROM HERE? -> [{ ref, face }], nearest first, dry before wet. The scan place() runs when it is
 * given no coordinates (and nothing else: no digging, no soil filter), so a refusal that suggests placing something
 * asks exactly the question place() will. Reads the world; does not change it.
 */
function placeSites(bot) {
  const solid = b => b != null && b.boundingBox === 'block'
  const replaceable = b => placeableInto(b)
  const UP = new Vec3(0, 1, 0)
  const candidates = []
  // Diagonals and one step up or down as well, nearest first. A bot on uneven
  // ground has a valid spot behind it far more often than beside it.
  const around = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  // DRY SPOTS FIRST, then wet ones. Placing into water is legal and works,
  // but a table on dry land stays easier to walk back to, so a wet cell is a
  // fallback rather than an equal.
  const wet = []
  for (const dy of [-1, 0, -2]) {
    for (const [dx, dz] of around) {
      const under = bot.blockAt(bot.entity.position.offset(dx, dy, dz))
      const at    = bot.blockAt(bot.entity.position.offset(dx, dy + 1, dz))
      if (!solid(under) || !replaceable(at)) continue
      if (onContainerLid(bot, at.position ?? bot.entity.position.offset(dx, dy + 1, dz))) continue   // never on a lid (below)
      ;(at.name === 'water' ? wet : candidates).push({ ref: under, face: UP })
    }
  }
  candidates.push(...wet)

  // THE BLOCK UNDER THE BOT'S OWN FEET WAS NEVER PROBED.
  //
  // `around` is eight horizontal offsets; [0,0] is not among them, so across
  // three dy levels the search examined 24 cells and never the one the bot is
  // standing on. A bot on a narrow perch -- a mountain spine, a one-wide
  // pillar, a peak -- therefore reported "no solid block with a free space
  // above it" while standing on solid ground.
  //
  // Measured: 83 refusals reading `no_support=24 [air]`, every one at FULL
  // HEALTH with y unchanged either side, so none of them was falling. One bot,
  // board-a-Bravo, produced 44 and has failed all 57 of its place attempts,
  // every one a crafting_table, which is what has kept it off the tech tree
  // for the whole window.
  //
  // A player in that spot does not look for a neighbour: they build off the
  // side of the block beneath them. `placeBlock(ref, face)` can express that
  // and the old top-face-only candidate list could not.
  if (!candidates.length) {
    const underfoot = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (solid(underfoot)) {
      for (const face of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
                          new Vec3(0, 0, 1), new Vec3(0, 0, -1)]) {
        const target = bot.blockAt(underfoot.position.offset(face.x, face.y, face.z))
        if (replaceable(target) && !onContainerLid(bot, underfoot.position.offset(face.x, face.y, face.z))) candidates.push({ ref: underfoot, face })
      }
    }
  }
  return candidates
}

async function place(ctx, { item, x, y, z }, signal) {
  const { bot } = ctx
  const held = placeStackOf(bot.inventory.items(), item)   // the same stack craft's room advice reasons about
  if (!held) return { status: 'failed', failClass: 'inventory', detail: `no ${item} in inventory` }

  // FINDING SOMEWHERE TO PUT IT IS THE HARD PART, and this function is what
  // gates the entire tech tree.
  //
  // The old version checked FOUR cardinal neighbours at exactly foot level and
  // required the target cell to be literally named "air". Measured across both
  // instances: 3 failures to 2 successes on instance #1, and on instance #2
  // Miner01 accumulated THREE crafting tables it could never put down while 56
  // oak logs sat unused across the fleet. A bot standing in tall grass, on a
  // slope, or with its back to a wall simply found nowhere.
  //
  // Two separate mistakes were in that one condition:
  //   - `at.name === 'air'` rejects grass, ferns, snow and dead bushes, all of
  //     which Minecraft happily lets you place INTO. That is most of a forest
  //     floor, which is exactly where a bot chopping wood is standing.
  //   - `under.name !== 'air'` ACCEPTS water, lava and cave_air as a surface,
  //     because none of them are named "air". Solidity is a boundingBox, not a
  //     name.
  const solid = b => b != null && b.boundingBox === 'block'
  const replaceable = b => placeableInto(b)

  // LAND FIRST. TWO THIRDS OF THE REFUSALS WERE A BOT IN MID-AIR.
  //
  // With the failure finally naming what it saw, the population is unambiguous:
  // of 48 logged refusals, 32 reported `no_support=24` with every one of the 24
  // cells reading `air`, and another 4 reading `water`. A bot with nothing solid
  // beneath it in ANY of eight directions at three heights is not boxed in --
  // it is falling, or swimming. The site search was correct and the moment was
  // wrong.
  //
  // So wait for the ground, briefly and boundedly. This cannot rescue a bot that
  // is genuinely mid-ocean, and it is not meant to: it costs a few hundred
  // milliseconds and converts the common case, which is a bot that issued
  // `place` one tick before landing.
  for (let i = 0; i < 12 && bot.entity?.onGround === false; i++) {
    await sleep(50, signal)
  }

  // A candidate is a REFERENCE BLOCK PLUS THE FACE to build off, not just a
  // block. Every placement here used to be "on top of something", which cannot
  // express the one case that matters below: building sideways off the block
  // you are standing on.
  const UP = new Vec3(0, 1, 0)
  let candidates = []
  if ([x, y, z].every(v => Number.isFinite(Number(v)))) {
    assertInsideBorder(Number(x), Number(z))
    if (onContainerLid(bot, { x: Number(x), y: Number(y), z: Number(z) })) {
      return { status: 'failed', failClass: 'no_space', detail: `${x},${y},${z} is on top of a container, which would stop it opening -- place it beside the container` }
    }
    candidates = [{ ref: bot.blockAt(new Vec3(Number(x), Number(y) - 1, Number(z))), face: UP }]
  } else {
    candidates = placeSites(bot)
  }
  // A SAPLING CANNOT GO ON STONE. The scan above accepts any SOLID top face, which
  // is right for a crafting table and wrong for anything that needs soil: the
  // server rejects it and six candidates are spent on placements that could never
  // land. Filtered here rather than inside the scan so the scan keeps one job.
  if (needsSoil(item)) {
    const before = candidates.length
    candidates = candidates.filter(c => soilOk(item, c.ref?.name))
    if (before && !candidates.length) {
      logEvent({ kind: 'place_no_soil', status: 'no_effect',
                 detail: `${item} needs soil and none of ${before} candidate face(s) offered any`,
                 snapshot: snapshot(bot) })
    }
  }

  // MAKE ROOM FOR A STATION. A crafting table is not scaffold: nobody stands
  // on it, so it does not need a free cell above, only a cell. In a one-wide
  // mine tunnel every neighbouring cell is rock, and the first fleet-wide hour
  // of the carried-table fix (2026-09-11 03:00-03:49) showed exactly that: 18
  // of 38 far-table refusals had tried to place and read "no solid block with
  // a free space above it -- no_support=2 blocked_above=22 [stone,
  // cobblestone...]". The bot is in a mine with a pickaxe in its hand. Dig ONE
  // orthogonal foot-level cell that is not beside liquid and not under a
  // falling block, then place into it. Only for stations, only when no
  // coordinates were given, only one cell per call.
  let madeRoom = null
  if (!candidates.length && STATION_ITEMS.has(item) && ![x, y, z].every(v => Number.isFinite(Number(v)))) {
    const base = bot.entity.position
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // A real Vec3 from plain numbers: test fakes give positions without
      // floored(), and the cell must be a block coordinate either way.
      const cellPos = new Vec3(Math.floor(base.x) + dx, Math.floor(base.y), Math.floor(base.z) + dz)
      const cell = bot.blockAt(cellPos)
      const under = bot.blockAt(cellPos.offset(0, -1, 0))
      if (!cell || !solid(under) || replaceable(cell) || !cell.diggable) continue
      // Never the town composter either (composter.mjs): it is not a station this bot carries, but it is one the town uses.
      if (cell.name === 'water' || cell.name === 'lava' || STATION_ITEMS.has(cell.name) || cell.name === 'composter' || /_ore$/.test(cell.name)) continue
      if (roomVeto(bot, cellPos)) continue
      check(signal)
      // ONE EXCAVATION PER CALL, whatever happens to it. A dig that outlives
      // its budget is cancelled here -- withTimeout's default only stops the
      // pathfinder, and this dig is not the pathfinder's (Codex review) -- and
      // the loop ends after the first attempt whether it opened a cell or not.
      let dug = false
      try {
        await withTimeout(bot.dig(cell, true), 8000, bot,
                          { what: 'making room', needsDrop: false, onTimeout: () => { try { bot.stopDigging?.() } catch { /* nothing to stop */ } } })
        dug = true
      } catch (e) { if (e.aborted || signal?.aborted) throw e }
      const now = bot.blockAt(cellPos); const under2 = bot.blockAt(cellPos.offset(0, -1, 0))
      if (dug && now && replaceable(now) && solid(under2)) { candidates.push({ ref: under2, face: UP }); madeRoom = cell.name }
      break
    }
  }
  if (!candidates.length) {
    // SAY WHAT IT SAW, BECAUSE GUESSING HAS COST FOUR CHANGES TONIGHT.
    //
    // "nowhere to place" fired 52 times in five hours, every one from a HEALTHY
    // bot, 75% from three of them, at a median y of 63 -- surface level, where a
    // bot standing on ground with air above it should always find a spot. Two
    // independent reviews produced four plausible mechanisms and no way to
    // choose between them, because the message names the conclusion and none of
    // the evidence.
    //
    // It now gates the tech tree: `craft wooden_pickaxe` attempts tripled after
    // the wrong-wood fix and 279 of them failed with "place the crafting_table
    // first", which is this refusal one level up.
    //
    // So the failure carries the cells it rejected. Two counts separate the two
    // candidate stories at a glance: nothing solid to stand a block on (open
    // air, a pillar) versus nothing replaceable above it (a canopy, a cave, a
    // bot boxed in). Naming the blocks tells us which without another night of
    // theories.
    const seen = { noSupport: 0, blocked: 0, names: new Set() }
    for (const dy of [-1, 0, -2]) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const under = bot.blockAt(bot.entity.position.offset(dx, dy, dz))
        const at    = bot.blockAt(bot.entity.position.offset(dx, dy + 1, dz))
        if (!solid(under)) { seen.noSupport++; if (under?.name) seen.names.add(under.name) }
        else if (!replaceable(at)) { seen.blocked++; if (at?.name) seen.names.add(at.name) }
      }
    }
    const why = `no_support=${seen.noSupport} blocked_above=${seen.blocked}` +
                ` [${[...seen.names].slice(0, 6).join(',') || 'nothing readable'}]`

    // FALLING IS NOT THE SAME REFUSAL AS BOXED IN, and calling both `no_space`
    // hid the difference behind one number.
    //
    // All 24 cells empty means nothing is nearby in ANY direction at three
    // heights -- open air or open water, not a lack of room. The bot is falling
    // or swimming, and "nowhere to place" is false: there will be somewhere the
    // moment it lands. Boxed in is the opposite situation with the opposite
    // remedy (dig or escape, not wait), and the two must not share a class.
    //
    // Measured after the land-first wait shipped: 64 of 111 place refusals still
    // read `no_support=24 [air]`, so 600ms of waiting does not cover it -- a fall
    // outlasts that. Waiting harder would be a third guess; naming the state
    // truthfully is not.
    if (seen.noSupport === 24 && bot.entity?.onGround === false) {
      return {
        status: 'failed',
        failClass: 'airborne',
        detail: `cannot place ${item} while off the ground — nothing solid in any ` +
                `direction at three heights (${why}); wait to land, there is nothing to fix here`,
      }
    }
    return {
      status: 'failed',
      failClass: 'no_space',
      detail: `nowhere to place ${item}: no solid block with a free space above it within reach — ${why}`,
    }
  }

  check(signal)
  await bot.equip(held, 'hand')

  // TRY MORE THAN ONE. placeBlock fails for reasons the block lookup cannot
  // see -- an entity standing in the cell, the server disagreeing about
  // occupancy, the bot facing the wrong way. Giving up after the first
  // candidate turned a recoverable miss into a dead tech tree.
  const failures = []
  let tried = 0
  for (const { ref, face } of candidates.slice(0, 6)) {
    check(signal)
    tried++
    try {
      // Facing the target makes mineflayer's block interaction markedly more
      // reliable; the same lesson the crafting-table reach check already learned.
      // Aim at the CENTRE OF THE FACE being built off. The old fixed offset
      // (0.5, 1.5, 0.5) points above the block, which is right for a top face
      // and wrong for every side face.
      try {
        await bot.lookAt(ref.position.offset(0.5 + face.x * 0.5,
                                             0.5 + face.y * 0.5,
                                             0.5 + face.z * 0.5), true)
      } catch { /* not fatal */ }
      // BOUNDED, because bot.placeBlock waits on a server `blockUpdate` that may
      // never arrive. Unbounded, one silent spot consumed the whole skill budget
      // and the remaining candidates were never reached -- the same open-loop
      // shape as deposit hanging on `windowOpen`. Measured: 20 place failures in
      // 200 minutes carrying mineflayer's own `Event blockUpdate:(x,y,z)` text.
      // A miss must cost one candidate, not the attempt.
      // Read the cell BEFORE the attempt: "it changed" is only answerable with
      // both ends, and a cell that legally starts as short_grass would otherwise
      // read as already-placed.
      const cellBefore = bot.blockAt(ref.position.offset(face.x, face.y, face.z))?.name ?? null
      await withTimeout(bot.placeBlock(ref, face), PLACE_ACK_MS, bot,
                        { what: 'placing', needsDrop: false })
      // READ IT BACK. placeBlock resolves without throwing when nothing was
      // placed -- build() already documents this and checks; place() did not.
      // The contract for `place` is `world_change`, and the runner scores that
      // from `result.placed`, which this never returned. So every successful
      // place was scored as changing nothing, classified `neutral`, and then
      // recorded as a success anyway by the neutral branch in cognitive.mjs.
      // A success nobody can falsify is not evidence.
      const at = ref.position.offset(face.x, face.y, face.z)
      const put = bot.blockAt(at)
      if (!placementLanded({ before: cellBefore, after: put?.name })) {
        failures.push(`placeBlock returned but ${at} is still ${put?.name ?? 'unknown'}`)
        continue
      }
      // `at` is returned STRUCTURALLY, not only inside the prose. deposit's
      // full-chest recovery needs to reopen the chest it just built, and
      // parsing a coordinate back out of an English sentence is how a caller
      // ends up depending on the wording of a log line.
      return { status: 'success', placed: 1, at,
               detail: `placed ${item} at ${at}${madeRoom ? ` (made room by digging ${madeRoom})` : ''}` }
    } catch (e) {
      failures.push(e.message)
    }
  }
  return {
    status: 'failed',
    failClass: 'no_space',
    // TRIED, not `candidates.length`. The old wording reported how many spots
    // EXISTED, so "failed at 1 spot(s)" read as "we only bothered with one" when
    // it meant "only one was ever found". It misled a reader for a whole
    // investigation; a count that is not a count of attempts must not print as one.
    detail: `place ${item} failed after ${tried} of ${candidates.length} spot(s): ` +
            `${failures[0] ?? 'unknown'}`,
  }
}

// --------------------------------------------------------------- build -----
//
// The first skill whose output PERSISTS. Everything else the agents do is
// erased by the next restart -- gathered items get lost, positions get reset,
// milestones recompute. A placed block stays placed, which is what makes a
// settlement possible and what makes progress visible from inside the game.
//
// DELIBERATELY STATELESS. Three separate bugs tonight came from a counter kept
// somewhere other than where the truth lived: milestone attempts reset on
// restart, the probation countdown reset on reconnect, and lessons.save() was
// never called on the path that mattered. So this skill stores no progress at
// all -- it reads the world, skips what is already correct, and places what is
// missing. The structure IS the progress record, and it cannot disagree with
// itself.
//
// Every placement is READ BACK. bot.placeBlock resolves without throwing in
// cases where nothing was actually placed (occluded, entity in the way, server
// rejected it), and place() above reports success on that basis. A build that
// reports 20/20 while the wall has holes in it is worse than one that fails.

const BLUEPRINTS = {
  // Small open shelter: a 5x5 floor with 3-high walls and a doorway facing +x.
  shelter: (b = 'oak_planks') => {
    const out = []
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) out.push({ dx, dy: 0, dz, block: b })
    for (let dy = 1; dy <= 3; dy++) {
      for (let d = -2; d <= 2; d++) {
        out.push({ dx: d, dy, dz: -2, block: b })
        out.push({ dx: d, dy, dz: 2, block: b })
        out.push({ dx: -2, dy, dz: d, block: b })
        if (!(dy <= 2 && d === 0)) out.push({ dx: 2, dy, dz: d, block: b })  // doorway
      }
    }
    return out
  },
  // A straight wall, 7 long and 3 high, running along z.
  wall: (b = 'oak_planks') => {
    const out = []
    for (let dz = -3; dz <= 3; dz++) for (let dy = 1; dy <= 3; dy++) out.push({ dx: 0, dy, dz, block: b })
    return out
  },
  // Marker pillar -- cheap, unmistakable from a distance, good for testing.
  pillar: (b = 'oak_planks') => {
    const out = []
    for (let dy = 1; dy <= 6; dy++) out.push({ dx: 0, dy, dz: 0, block: b })
    return out
  },
}

async function build(ctx, { plan = 'pillar', block = 'oak_planks', x, y, z }, signal) {
  const { bot } = ctx
  const make = BLUEPRINTS[plan]
  if (!make) {
    return { status: 'failed', failClass: 'other',
             detail: `unknown plan "${plan}"; have ${Object.keys(BLUEPRINTS).join(', ')}` }
  }

  // Anchor at the given point, else the configured home -- so repeated calls
  // converge on ONE structure instead of scattering half-built stubs.
  const ax = Number.isFinite(Number(x)) ? Number(x) : config.world.homeX
  const ay = Number.isFinite(Number(y)) ? Number(y) : config.world.homeY
  const az = Number.isFinite(Number(z)) ? Number(z) : config.world.homeZ
  assertInsideBorder(ax, az)

  const spec = make(block)
  let already = 0, placed = 0, failed = 0, lastErr = null

  for (const cell of spec) {
    check(signal)
    const pos = new Vec3(ax + cell.dx, ay + cell.dy, az + cell.dz)

    const current = bot.blockAt(pos)
    if (current && current.name === cell.block) { already++; continue }
    if (current && current.name !== 'air' && !current.name.includes('leaves') &&
        !current.name.includes('grass') && current.name !== 'snow') {
      failed++; lastErr = `${current.name} in the way at ${pos.x},${pos.y},${pos.z}`; continue
    }

    const held = bot.inventory.items().find(i => i.name === cell.block)
    if (!held) {
      // Out of materials is not a failure of the plan -- report honestly and
      // stop, so the cognitive layer can go and gather rather than grind.
      break
    }

    // Must be adjacent to place. Do not fight the pathfinder over one block.
    if (bot.entity.position.distanceTo(pos) > 4) {
      try {
        await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3))
      } catch {
        failed++; lastErr = `cannot reach ${pos.x},${pos.y},${pos.z}`; continue
      }
      check(signal)
    }

    const ref = bot.blockAt(pos.offset(0, -1, 0))
    if (!ref || ref.name === 'air') { failed++; lastErr = `nothing to place against under ${pos.x},${pos.y},${pos.z}`; continue }

    try {
      await bot.equip(held, 'hand')
      // Bounded for the same reason as place(): placeBlock waits on a server
      // blockUpdate that may never arrive, and a build has far more candidates
      // to get through than a single table does.
      await withTimeout(bot.placeBlock(ref, new Vec3(0, 1, 0)), PLACE_ACK_MS, bot,
                        { what: 'placing', needsDrop: false })
    } catch (e) {
      failed++; lastErr = e.message; continue
    }

    // READ IT BACK. This is the whole point.
    await new Promise(r => setTimeout(r, 120))
    const after = bot.blockAt(pos)
    if (after && after.name === cell.block) placed++
    else { failed++; lastErr = `placeBlock reported no error but ${pos.x},${pos.y},${pos.z} is ${after?.name ?? 'unknown'}` }
  }

  const done = already + placed
  const detail = `${plan} at ${ax},${ay},${az}: ${done}/${spec.length} in place (${placed} new, ${already} already, ${failed} failed)` +
                 (lastErr ? ` — last problem: ${lastErr}` : '')

  // Report `placed` -- the count of blocks this call READ BACK from the world.
  // The runner used to infer world change from `/build|place/` matching the
  // skill name plus any inventory item going down, which is true when the bot
  // eats, drops, deposits, or crafts, and false for a placement from a stack it
  // then refilled. The honest number was already sitting right here.
  if (done === spec.length) return { status: 'success', detail, placed }
  if (placed > 0) return { status: 'success', detail, placed }  // real progress this call
  // `no_space` is the class place() already uses for "nothing would go down
  // here", and it is what this is: every candidate cell was refused or read back
  // empty. It votes on nothing, which is also what the classifier's `other`
  // verdict did for this string.
  return { status: 'failed', failClass: 'no_space', detail, placed }
}


// -------------------------------------------------------------- explore -----
//
// Travel outward to somewhere the fleet has not been, so the survey in the
// reflex layer has new ground to see.
//
// Why this exists: all five bots ended up standing within sixteen blocks of
// spawn, three of them on the identical block, deadlocked. Their memory was
// correct -- "crafting a stick is unreachable AT 1,0" is true, they had stripped
// the area -- but a correct fact about a stripped patch is a trap when you never
// leave the patch. They knew everything about where they were and nothing about
// anywhere else.
//
// Deliberately NOT random walking. It picks a heading away from spawn and from
// known hazards, moves in legs the pathfinder can actually finish, and reports
// honestly how far it got. A leg that fails is information, not a retry loop.
/**
 * The nearest KNOWN sighting of something worth walking to, or null.
 *
 * Pure but for the store read, and exported so the choice can be tested without
 * a server -- a heading is exactly the kind of decision that a source-grep
 * cannot check and that silently degrades to random.
 *
 * `toward` wins when the caller names it. Otherwise we take the first kind that
 * has a sighting, in the order below: ore is worth a walk, wood is worth a walk,
 * and stone is almost always underfoot already so it is last.
 */
export function knownTarget (bot, toward = null, radius = 400) {
  const wf = bot?.worldFacts
  const at = bot?.entity?.position
  if (!wf?.resourcesNear || !at) return null
  const kinds = toward ? [toward]
    : ['iron_ore', 'coal_ore', 'oak_log', 'birch_log', 'diamond_ore', 'stone']
  // A SIGHTING ON A DEATH SITE IS NOT A TARGET. 43 of 66 lava deaths in 48 h came within a minute of explore steering
  // at a shared iron-ore sighting (deaths-review-2026-09-16). The route across the pool is the pathfinder's price
  // (deathsites.mjs); the sighting that sits IN the disc is refused here, and the skip is reported so it can be read.
  let deaths = []
  try { deaths = wf.deathSites?.() ?? [] } catch { deaths = [] }
  let skipped = 0
  for (const kind of kinds) {
    let seen
    try { seen = wf.resourcesNear(kind, at, radius) } catch { continue }
    for (const r of seen ?? []) {
      // Ignore anything we are already standing in. A sighting 6 blocks away is
      // not a reason to "explore" -- gather can already see it, and walking to
      // it would burn the decision that should have gathered it.
      const d = Math.hypot(r.x - at.x, r.z - at.z)
      if (d < 24) continue
      const site = nearDeathSite(deaths, r.x, r.y ?? at.y, r.z, { radius: DEATH_SITE_TARGET_RADIUS, dy: 8 })
      if (site) { skipped++; continue }
      return { kind, x: r.x, y: r.y, z: r.z, dist: d, skipped }
    }
  }
  return skipped ? { skipped } : null
}

async function explore(ctx, { blocks = 60, heading = null, toward = null }, signal) {
  const { bot } = ctx
  const start = bot.entity.position.clone()

  // WALK TOWARD SOMETHING WE HAVE ACTUALLY SEEN, IF WE HAVE SEEN ANYTHING.
  //
  // explore was 36% of every decision the fleet made and produced 11 items from
  // 574 attempts -- 0.0 per success -- while succeeding 72.6% of the time,
  // because its contract is `position` and walking 20 blocks satisfies it. A
  // successful explore did not even improve the NEXT gather (22.5% vs 24.3%).
  // It was the most-chosen action in the fleet and the only one that produced
  // nothing.
  //
  // Meanwhile the reflex layer has been recording resource sightings every 20
  // seconds since it was written -- 200 per pool, real coordinates for
  // iron_ore, coal_ore, stone and oak_log -- and `resourcesNear` had ZERO
  // callers. The information explore needed was already on disk, and explore
  // was picking a random heading.
  //
  // Falls back to the old bearing when nothing is known, which is the honest
  // behaviour for a bot that has genuinely seen nothing: this makes explore
  // better-informed, not conditional on being informed.
  const known = knownTarget(bot, toward)
  if (known?.skipped) logEvent({ kind: 'explore_target_skipped_death_site', status: 'no_effect', detail: `${known.skipped} sighting(s) within ${DEATH_SITE_TARGET_RADIUS} blocks of a recorded death were not steered at${known.kind ? `; heading for ${known.kind} instead` : '; random bearing'}`, snapshot: snapshot(bot) })
  if (known?.kind) {
    logEvent({
      kind: 'explore_toward_known',
      detail: `heading for ${known.kind} at ${known.x},${known.y},${known.z} ` +
              `(${known.dist.toFixed(0)}b) instead of a random bearing`,
      snapshot: snapshot(bot),
    })
    heading = (Math.atan2(known.z - start.z, known.x - start.x) * 180) / Math.PI
  }

  // Head away from SPAWN, not away from home.
  //
  // The original said "away from spawn" in the comment and computed away from
  // config.world.homeX/Z, which was the same point until the colony moved. Once
  // home became 28,0 and spawn stayed 0,0, a bot that drifted west of home was
  // sent FURTHER west -- straight back into the mined-out crater it had just been
  // moved out of. Observed: Scout01 and Gather01 both back at 0,75,0 and 2,73,0
  // with Scout01 down to 1 admitted decision in 10 and nothing left to try there.
  //
  // Spawn is the depleted origin in this world: it is where every bot started,
  // where the resources were stripped first, and where the cave damage is. Away
  // from it is the direction with unexplored ground, which is what the comment
  // always meant.
  let ang
  if (Number.isFinite(Number(heading))) ang = (Number(heading) * Math.PI) / 180
  else {
    const dx = start.x, dz = start.z            // spawn is the origin
    ang = (Math.hypot(dx, dz) < 12 ? Math.random() * Math.PI * 2 : Math.atan2(dz, dx))
      + (Math.random() - 0.5) * 0.8
  }

  const want = Math.min(Math.max(Number(blocks) || 60, 20), 120)
  // 12, not 25. At 25 blocks through forest, A* spends long enough planning that
  // the bot stands still past the 45s stuck threshold and the reflex cancels the
  // path -- measured, 8 explore attempts and 8 aborts, every single one killed
  // by `reflex: stuck`. Thinking was indistinguishable from being wedged again.
  //
  // Short legs keep the bot WALKING, which is both the point of the skill and
  // the thing that proves to the reflex layer it is not stuck. goto uses 45 for
  // open travel; forest needs less.
  const LEG = 12
  let travelled = 0, legs = 0, lastErr = null

  while (travelled < want && legs < 14) {
    check(signal)
    legs++
    const from = bot.entity.position.clone()
    const step = Math.min(LEG, want - travelled)
    const tx = Math.round(from.x + Math.cos(ang) * step)
    const tz = Math.round(from.z + Math.sin(ang) * step)
    try { assertInsideBorder(tx, tz) } catch { ang += Math.PI / 2; continue }

    try {
      // BOUNDED. The helper at the top of this file exists because
      // mineflayer-pathfinder re-plans toward an unreachable goal forever, and
      // the bot does not move while it does -- which is indistinguishable from
      // being stuck. I wrote this skill without it and paid for it: 11 explore
      // attempts, 11 aborts, every one killed by `reflex: stuck` at 45s while
      // the pathfinder churned on a goal it was never going to reach.
      //
      // 8s per leg, well inside the 45s stuck window, so a doomed leg costs one
      // heading change instead of the whole skill.
      await withTimeout(
        bot.pathfinder.goto(new goals.GoalNear(tx, Math.round(from.y), tz, 3)), 8000, bot)
    } catch (e) {
      lastErr = e.message
      const turn = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 3)
      ang += turn   // blocked: turn, do not give up
      // MOVE, even on failure. Each failed leg costs up to the pathfinder's
      // think timeout with the bot stationary, so three or four in a row
      // accumulate past the 45s stuck threshold and the reflex cancels the whole
      // skill -- measured, 8 explore attempts and 8 aborts, every one killed by
      // `reflex: stuck` while the bot was busy planning.
      //
      // A short walk in the new heading proves to the reflex layer that the bot
      // is working, and incidentally makes the next plan start from somewhere
      // different, which is often why the previous one failed.
      // ...BUT NEVER BLIND OVER LAVA. The corridor guard refuses a leg by failing the goto, which lands HERE, and this
      // walk then took the refused line: board-b-Delta 2026-09-15 10:26 died in the pool the guard had named one
      // second earlier. The step runs the same guard on its own straight line (feet to five blocks along the heading,
      // lava-free around and below); a refused step turns the other way (the same turn with the opposite sign) and,
      // if that is refused too, does not move. The walk is GROUNDED: no jump, so the body stays on the checked
      // line (a jump-held hop can carry it over a gap onto lava beyond the sampled seven blocks; Codex).
      // FOUR HEADINGS BEFORE STAYING PUT. On -08c the two-candidate version refused 3.7 steps per bot-hour, and every
      // refusal left the bot where the failed plan had started: explores per hour fell a third. The turn, the
      // other turn, then the two perpendiculars; the first safe line wins.
      let stepOk = false
      for (const cand of [ang, ang - 2 * turn, ang + Math.PI / 2, ang - Math.PI / 2]) {
        const v = stepLineSafe((x, y, z) => bot.blockAt(new Vec3(x, y, z)), bot.entity.position, cand)
        if (!v.safe) { logEvent({ kind: 'explore_blind_step_refused', status: 'no_effect', detail: `${v.why} at ${v.at?.join(',')}: the fallback walk is refused`, snapshot: snapshot(bot) }); continue }
        // ...AND NEVER BLIND INTO A RECORDED DEATH. The pathfinder prices death sites (deathsites.mjs); this walk has
        // no pathfinder, so it asks the same list. 5 of 5 post-promotion lava deaths on 16 Sep followed a corridor
        // refusal and then a walk that was not the refused leg.
        const ds = lineHitsDeathSite(bot.deathSitesNow?.() ?? [], bot.entity.position, cand)
        if (ds) { logEvent({ kind: 'explore_blind_step_refused', status: 'no_effect', detail: `blind_step: ${ds.kind} x${ds.deaths ?? 1} recorded at ${ds.x},${ds.y},${ds.z} on the line: the fallback walk is refused`, snapshot: snapshot(bot) }); continue }
        ang = cand; stepOk = true; break
      }
      if (!stepOk) { await sleep(300, signal); continue }
      try {
        await bot.look(ang, 0, true)
        bot.setControlState('forward', true)
        await sleep(1200, signal)
        bot.clearControlStates()
      } catch { bot.clearControlStates() }
      continue
    }
    check(signal)
    travelled += from.distanceTo(bot.entity.position)
  }

  const moved = Math.round(start.distanceTo(bot.entity.position))
  const p = bot.entity.position
  const detail = `explored ${moved} blocks to ${Math.round(p.x)},${Math.round(p.z)} in ${legs} legs` +
                 (lastErr ? ` (some legs blocked: ${String(lastErr).slice(0, 40)})` : '')
  // Movement IS the deliverable here, so the threshold is distance, not arrival
  // at any particular place.
  if (moved >= 20) return { status: 'success', detail }
  if (moved >= 5) return { status: 'no_effect', detail: `${detail} — barely moved`, failClass: 'stuck' }
  return { status: 'failed', detail: `could not explore: ${detail}`, failClass: 'no_path' }
}


// ------------------------------------------------------------- wear_out -----
//
// Destroys spent tools by using them: one dig on a cheap, safe block beside the bot breaks a copy at 1 use, and
// nothing is dropped, so nothing can be picked up by this bot or another (hygiene.mjs says why piles are out).
// Issued only as a work order at TRIGGER_SLOTS; never offered to the model. Each destroyed copy is VERIFIED gone
// from the inventory -- the row is an outcome, not the intention.
async function wearOut(ctx, _args, signal) {
  const { bot } = ctx
  const plan = wearOutPlan(bot.inventory?.items?.() ?? [])
  if (!plan.tools.length) return { status: 'no_effect', detail: `no spent tool to wear out at ${plan.slots} of 36 slots` }
  const destroyed = []
  let stopped = null
  for (const tool of plan.tools) {
    const r = await wearOutOne(ctx, tool, signal)
    if (!r.ok) { stopped = r.said; break }
    destroyed.push(`${tool.name} on ${r.on}`)
  }
  await bot.waitForTicks?.(12)   // a block drop is collectable after 10 ticks: count the slots after it could land
  const after = bot.inventory?.items?.().length ?? plan.slots
  logEvent({ kind: 'wear_out', status: destroyed.length ? 'success' : 'failed', snapshot: snapshot(bot),
             detail: `${plan.slots} -> ${after} slots: ${destroyed.length} of ${plan.tools.length} spent tool(s) worn out` +
                     `${destroyed.length ? ` (${destroyed.join(', ')})` : ''}${stopped ? `; stopped: ${stopped}` : ''}`.slice(0, 300) })
  return destroyed.length
    ? { status: 'success', detail: `wore out ${destroyed.length} spent tool(s) (${plan.slots} -> ${after} slots)${stopped ? `; ${stopped}` : ''}` }
    : { status: 'failed', failClass: 'wear_out_failed', detail: `wore out nothing at ${plan.slots} slots: ${stopped ?? 'unknown'}` }
}

/**
 * ONE spent tool, destroyed by one dig -> { ok, on, said }. The body of wear_out's loop, shared with craft's
 * make-room step (craftroom.mjs). `cellOk(block, tool)` narrows the blocks further: craft passes wearKeepsSlot, so
 * the dig's own drop cannot refill the slot the tool frees.
 */
const WEAR_CONFIRM_MS = Math.max(300, Math.min(1500, config.skills.defaultTimeoutMs))
/** When the late look at an unconfirmed survivor happens (logging only; not on the skill's clock). */
// Production 5 s; scaled down with the suite's skill budget (SKILL_TIMEOUT_MS=300) so the late look is testable.
const WEAR_LATE_MS = Math.max(300, Math.min(5_000, config.skills.defaultTimeoutMs))
async function wearOutOne(ctx, tool, signal, { cellOk = null, sidesOnly = false } = {}) {
  const { bot } = ctx
  const spentOf = name => (bot.inventory?.items?.() ?? []).filter(i => i.name === name && remaining(i) === 1).length
  check(signal)
  // Recomputed every tool, from where the bot stands NOW. Side cells at head and feet height first; the ground
  // beside the feet only under the guards below (both reviews: an unguarded dy=-1 dig undermined the bot on a
  // ledge, popped a planted sapling off its grass, and can open a cave). No cell another entity stands in.
  // Stone first, so a non-pickaxe breaks without a drop.
  const here = bot.entity?.position?.floored?.() ?? bot.entity?.position
  if (!here) return { ok: false, said: 'no position' }
  const occupied = c => Object.values(bot.entities ?? {}).some(e => e !== bot.entity && e?.position &&
    Math.floor(e.position.x) === c.x && Math.floor(e.position.z) === c.z && Math.abs(Math.floor(e.position.y) - c.y) <= 1)
  const cells = []
  // SIDES ONLY for craft's remedy (sandbox 46c4836, 2 of 5): a dug floor block's drop stayed in the 1-deep hole out
  // of the pickup box, and the hole is a pit. A side block at foot or head level, with solid ground under it so its
  // drop lands at the feet, leaves neither.
  for (const dy of sidesOnly ? [0, 1] : [1, 0, -1]) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) cells.push(here.offset(dx, dy, dz))
  const sideOk = c => !sidesOnly || (c.y >= here.y && bot.blockAt(c.offset(0, c.y > here.y ? -2 : -1, 0))?.boundingBox === 'block' &&
                                     (c.y === here.y || bot.blockAt(c.offset(0, -1, 0))?.boundingBox === 'block'))
  // THE GROUND BESIDE THE FEET (dy=-1) only with three guards, because on open ground it is the only block in
  // reach: its column is outside the bot's own footprint (a bot straddling onto the neighbour cell stands ON it),
  // the cell above it is plain air by NAME (a sapling or plant there has 'empty' bounds and would be popped),
  // and the block below it is solid (no hole into a cave).
  const pos = bot.entity?.position
  const underfoot = c => pos && c.x + 1 > pos.x - 0.3 && c.x < pos.x + 0.3 && c.z + 1 > pos.z - 0.3 && c.z < pos.z + 0.3
  const groundOk = c => c.y >= here.y || (!underfoot(c) && /^(air|cave_air)$/.test(bot.blockAt(c.offset(0, 1, 0))?.name ?? '') &&
                                          bot.blockAt(c.offset(0, -1, 0))?.boundingBox === 'block')
  // WHY EACH CELL WAS REFUSED, tallied (logging only; 82 of 100 failed orders in 24 h said only "no safe block within
  // reach"). The same guards as before, as one conjunction: the first that refuses names the cell's tally, and the
  // cell set and the choice are exactly what the plain filter chose.
  const refused = {}
  const refusal = c => {
    const bl = bot.blockAt(c)
    if (!wearTarget(bl)) return 'not_natural'
    if (!groundOk(c)) return underfoot(c) ? 'footprint' : !/^(air|cave_air)$/.test(bot.blockAt(c.offset(0, 1, 0))?.name ?? '') ? 'above_not_air' : 'no_support'
    if (!sideOk(c)) return 'side_unsupported'
    const room = roomVeto(bot, c)
    if (room) return `room_${room}`
    if (occupied(c)) return 'occupied'
    if (!(bot.canDigBlock?.(bl) ?? true)) return 'out_of_reach'
    if (cellOk && !cellOk(bl, tool)) return 'refills_slot'
    return null
  }
  const cell = cells.filter(c => { const why = refusal(c); if (why) refused[why] = (refused[why] ?? 0) + 1; return !why })
    .sort((x, y) => (x.y < here.y) - (y.y < here.y) || wearRank(bot.blockAt(x).name) - wearRank(bot.blockAt(y).name))[0]
  if (!cell) return { ok: false, said: `${cellOk ? 'no safe block within reach whose drop would not refill the slot' : 'no safe block within reach'} [${wearRefusals(refused, cells.length)}]` }
  const block = bot.blockAt(cell)
  const before = spentOf(tool.name)
  await bot.equip(tool, 'hand').catch(() => {})
  check(signal)
  // THE COPY IN HAND MUST BE A SPENT ONE (Codex review): equip errors are swallowed, and a same-name copy with
  // uses must never be the one that digs.
  const held = bot.heldItem
  if (!held || held.name !== tool.name || remaining(held) !== 1) return { ok: false, said: `could not hold a spent ${tool.name}` }
  const heldSlot = held.slot
  try {
    await withTimeout(bot.dig(block, true), 10_000, bot, { what: 'dig', needsDrop: false, onTimeout: () => { try { bot.stopDigging?.() } catch {} } })
  } catch (e) { if (e?.aborted || signal?.aborted) throw e; return { ok: false, said: `dig failed: ${String(e?.message ?? e).slice(0, 40)}` } }
  await bot.waitForTicks?.(2)
  // VERIFIED BY COUNT, not by slot: one fewer spent copy of that name (Codex review). AFTER THE SERVER'S SLOT UPDATE
  // (sandbox 46c4836, 3 of 5): two ticks is not enough for the slot to empty -- the pickaxe had broken (RCON: slot
  // gone, _tool_broke row) while this read said it survived. Poll, bounded.
  for (const until = Date.now() + WEAR_CONFIRM_MS; spentOf(tool.name) !== before - 1 && Date.now() < until;) { check(signal); await sleep(50, signal) }
  if (spentOf(tool.name) !== before - 1) {
    // NOT CONFIRMED DESTROYED -- an outcome this function cannot name (logging only): the sandbox already saw a slot
    // update land after this window. A late look, off this skill's clock and never awaited, records what the copy's
    // slot SHOWS then (slotObservation) and whether the block is still there; the read decides what it means.
    const nowSlot = Number.isInteger(heldSlot) ? bot.inventory?.slots?.[heldSlot] : undefined
    const was = block.name, at = block.position
    // A bot that ended or DIED inside the window: its slot says nothing about the dig (a death empties the bag).
    let ended = false, died = false
    const onEnd = () => { ended = true }, onDeath = () => { died = true }
    bot.once?.('end', onEnd)
    bot.once?.('death', onDeath)
    const late = setTimeout(() => {
      try {
        bot.removeListener?.('end', onEnd)
        bot.removeListener?.('death', onDeath)
        const it = Number.isInteger(heldSlot) ? bot.inventory?.slots?.[heldSlot] : undefined
        const alive = !ended && !died && !!bot.entity && !(Number.isFinite(bot.health) && bot.health <= 0)
        const seen = slotObservation({ slotKnown: Number.isInteger(heldSlot) && Array.isArray(bot.inventory?.slots), item: it, name: tool.name, alive })
        const blockNow = at ? bot.blockAt?.(at)?.name ?? '?' : '?'
        logEvent({ kind: 'wear_out_late', status: 'no_effect', snapshot: snapshot(bot),
                   detail: `${seen}: ${tool.name} slot ${heldSlot ?? '?'} ${WEAR_LATE_MS} ms after the dig on ${was} ` +
                           `(slot shows ${it ? `${it.name} at ${remaining(it)} use(s)` : it === null ? 'nothing' : '?'}; block now ${blockNow})` })
      } catch { /* telemetry */ }
    }, WEAR_LATE_MS)
    late.unref?.()
    return { ok: false, said: `${tool.name} not confirmed destroyed after the dig on ${block.name} (unconfirmed at ${WEAR_CONFIRM_MS} ms, ` +
                              `not a survivor: slot ${heldSlot ?? '?'} ${nowSlot ? `holds ${nowSlot.name} at ${remaining(nowSlot)} use(s)` : nowSlot === null ? 'is empty' : 'unknown'}; ` +
                              `${spentOf(tool.name)} spent copies, was ${before})` }
  }
  return { ok: true, on: block.name }
}

// -------------------------------------------------------------- compost -----
//
// INVENTORY HYGIENE, PHASE 2 (composter.mjs has the measurement, the design and every decision). Two deterministic
// work orders issued by townOrder, never offered to the model:
//   compost          insert ballast (and saplings above SAPLING_RESERVE) into the town composter; at 7 it ripens to 8
//                    after 20 ticks; at 8 one use pops a bone meal that must be CONFIRMED in the bag.
//   build_composter  craft one from wood held, AT the town's sticky canonical site, and place it there.
// Nothing is ever tossed. Every count in the rows is verified from the inventory. Every await is bounded and abortable;
// on a timeout or an abort the pathfinder is stopped, an open window closed, and every outstanding operation is
// waited for (bounded) BEFORE the hand is restored -- a late equip must not land on top of the restore.

/** Per-await bounds, scaled from the skill budget (production: 3 s / 25 s / 60 s / 5 s) like the step pacing above. */
const HK_AWAIT_MS = Math.max(200, Math.min(3_000, Math.floor(config.skills.defaultTimeoutMs / 60)))
const HK_PATH_MS = Math.max(500, Math.min(25_000, Math.floor(config.skills.defaultTimeoutMs / 7)))
const HK_CRAFT_MS = Math.max(1_000, Math.min(60_000, Math.floor(config.skills.defaultTimeoutMs / 3)))
/** The HARD bound on waiting for outstanding operations after a timeout or abort; past it the order is 'unsettled'. */
const HK_SETTLE_MS = Math.max(500, Math.min(5_000, Math.floor(config.skills.defaultTimeoutMs / 36)))
export const HOUSEKEEPING_BOUNDS = Object.freeze({ awaitMs: HK_AWAIT_MS, pathMs: HK_PATH_MS, craftMs: HK_CRAFT_MS, settleMs: HK_SETTLE_MS })

/**
 * bound(p, ms, what, { path, abortable }): p's result, or a budget error after ms, or Aborted the moment the signal
 * fires. Either way the loser's timer and listener are cleared, the pathfinder is halted for a walk, an open window
 * is closed, and `p` stays TRACKED: settle() waits (bounded) for every tracked operation to finish.
 */
function hkGuards (bot, signal) {
  const pending = new Set()
  const cancel = walk => {
    if (walk) haltPath(bot)
    try { if (bot.currentWindow) bot.closeWindow?.(bot.currentWindow) } catch { /* nothing open */ }
  }
  const bound = (p, ms, what, { path: walk = false, abortable = true, controller = null } = {}) => {
    const op = Promise.resolve(p)
    const done = op.then(() => {}, () => {})
    pending.add(done); done.then(() => pending.delete(done))
    return new Promise((resolve, reject) => {
      let timer = null, onAbort = null, over = false
      const finish = (fn, v) => {
        if (over) return
        over = true; clearTimeout(timer)
        if (onAbort) { try { signal?.removeEventListener?.('abort', onAbort) } catch { /* plain-object signal */ } }
        fn(v)
      }
      // `controller` is the operation's OWN signal (place() takes one): a timed-out operation is told to stop, not
      // merely abandoned while it keeps the order's still-live signal.
      const stop = () => { cancel(walk); try { controller?.abort() } catch { /* already aborted */ } }
      timer = setTimeout(() => { stop(); finish(reject, Object.assign(new Error(`${what} exceeded ${ms}ms`), { budgetExceeded: true })) }, ms)
      if (abortable) {
        if (signal?.aborted) { stop(); finish(reject, new Aborted()); return }
        onAbort = () => { stop(); finish(reject, new Aborted()) }
        signal?.addEventListener?.('abort', onAbort, { once: true })
      }
      op.then(v => finish(resolve, v), e => finish(reject, e))
    })
  }
  /** -> true when everything outstanding has finished, false when the hard bound ran out first. */
  const settle = () => new Promise(res => {
    if (!pending.size) { res(true); return }
    const t = setTimeout(() => res(false), HK_SETTLE_MS)
    Promise.all([...pending]).then(() => { clearTimeout(t); res(true) })
  })
  return { bound, restoreBound: (p, ms, what) => bound(p, ms, what, { abortable: false }), settle, outstanding: () => pending.size }
}
const handOf = it => (it ? { name: it.name, used: it.durabilityUsed ?? 0 } : null)
const hotbarOf = bot => Array.from({ length: 9 }, (_, i) => handOf(bot.inventory?.slots?.[36 + i]))
async function applyHand (bot, plan, bound) {
  if (plan?.action === 'select') bot.setQuickBarSlot?.(plan.index)
  else if (plan?.action === 'equip') await bound(bot.equip(plan.item, 'hand'), HK_AWAIT_MS, 'equip')
}
/**
 * Wait for everything outstanding, THEN put the hand back (bounded, not abortable: it runs after an abort too). The
 * order keeps the body the whole time -- the skill has not returned. If the hard bound runs out with an operation
 * still in flight, the hand is NOT restored: an equip that may still land would overwrite the restore, which is worse
 * than leaving the hand as it is. That is logged as `_housekeeping_unsettled` and returned as false.
 */
async function settleAndRestore (bot, was, g, order = 'housekeeping') {
  let settled = false
  try { settled = await g.settle() } catch { settled = false }
  if (!settled) {
    logEvent({ kind: 'housekeeping_unsettled', status: 'failed', snapshot: snapshot(bot),
               detail: `${order}: ${g.outstanding()} operation(s) still outstanding after ${HK_SETTLE_MS}ms; hand not restored (held ${bot.heldItem?.name ?? 'nothing'}, was ${was?.name ?? 'nothing'})` })
    return false
  }
  try {
    await applyHand(bot, handPlan({ was, held: handOf(bot.heldItem), hotbar: hotbarOf(bot), items: bot.inventory?.items?.() ?? [] }), g.restoreBound)
  } catch { /* best effort: equip swaps, so the item is in the bag either way */ }
  let restored = false
  try { restored = await g.settle() } catch { restored = false }
  if (!restored) {
    logEvent({ kind: 'housekeeping_unsettled', status: 'failed', snapshot: snapshot(bot),
               detail: `${order}: the restoring equip is still outstanding after ${HK_SETTLE_MS}ms (held ${bot.heldItem?.name ?? 'nothing'}, was ${was?.name ?? 'nothing'})` })
    return false
  }
  return true
}
const homeVec = () => new Vec3(config.world.homeX, config.world.homeY, config.world.homeZ)
const blockNameOf = (bot, b) => b?.name ?? bot.registry?.blocks?.[b?.type]?.name

/** The town's composter: searched around HOME within ADOPT_RADIUS, never around the bot, never a village's. */
export function findTownComposter (bot) {
  try {
    return bot.findBlock?.({ point: homeVec(), matching: b => blockNameOf(bot, b) === 'composter', maxDistance: ADOPT_RADIUS }) ?? null
  } catch { return null }
}
/** What this bot could build a composter from, right now. A table counts only if CARRIED (composter.mjs). */
export function townBuildPlan (bot) {
  const items = bot.inventory?.items?.() ?? []
  return composterBuildPlan(Object.fromEntries(heldCounts(items)), { tableAvailable: townPlanTableAvailable(items), items })
}
const readCell = bot => (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: blockNameOf(bot, b), boundingBox: b.boundingBox } : null }
/**
 * The town's site, from the shared generation record (composter.mjs resolveTownSite): adopted if this bot's view accepts
 * it, replaced compare-and-swap if this bot's view refuses it, deferred if anything is unknown or nothing can be shared.
 * The record is per pool + home and carries the world id (bot.worldId, from the login packet), so a reseed starts over.
 */
const townSiteKey = () => `composter-site-${config.world.homeX}_${config.world.homeY}_${config.world.homeZ}`
export function townComposterSite (bot) {
  const home = homeVec(), read = readCell(bot)
  return resolveTownSite({
    dir: poolStateDir(config.memory.pool),
    key: townSiteKey(),
    world: bot.worldId ?? null,
    compute: () => canonicalComposterSite({ home, read }),
    refuse: site => siteRefusal(read, site, home),
  })
}

/**
 * THE COMPOSTER VISIT'S WALKS never put a node on a composter's top (index.mjs withComposterWalk, composter.mjs
 * composterSafeMovements): a GoalNear(composter, 2) or a pickup walk could otherwise end on, or cross, the open top and
 * drop into the hollow. A bot without the helper (a test fake) walks with its own profile.
 */
const composterWalk = (bot, fn) => (typeof bot.withComposterWalk === 'function' ? bot.withComposterWalk(fn) : fn())

/** How long a popped bone meal may take to settle and its position to reach mineflayer (~20 ticks per update). */
const BONEMEAL_SETTLE_TICKS = 20
/** The compost visit's declared stationary window runs this long past its budget (the last insert or ripen). */
const STATIONARY_SLACK_MS = 5_000
/**
 * The pickup-box goal (pickupbox.mjs) for `item`, with the REAL standing height of each node, whose end never lies in `cell`
 * (the composter's own column, the cell and the one above): a body inside the hollow is not handed the drop.
 */
export function pickupGoalOutside(bot, item, cell) {
  const goal = pickupGoal(goals, item, node => node.y - 1 + standHeight(bot.blockAt(new Vec3(node.x, node.y - 1, node.z), false)))
  if (!goal) return null
  const isEnd = goal.isEnd.bind(goal)
  goal.isEnd = node => !(node.x === cell.x && node.z === cell.z && node.y >= cell.y && node.y <= cell.y + 1) && isEnd(node)
  return goal
}

async function compost(ctx, _args, signal) {
  const { bot } = ctx
  const items = () => bot.inventory?.items?.() ?? []
  const countOf = n => items().reduce((a, i) => a + (i.name === n ? (i.count ?? 0) : 0), 0)
  const slotsBefore = items().length
  const row = (status, f) => logEvent({ kind: 'compost', status, snapshot: snapshot(bot),
                                        detail: compostDetail({ slotsBefore, slotsAfter: items().length, ...f }) })
  const skip = (why, f = {}) => { row('no_effect', { stop: why, ...f }); return { status: 'no_effect', detail: why } }
  // ANOTHER SUBSYSTEM'S SNEAK IS NOT OURS TO RELEASE, and a sneaking use is an item use, not a block use.
  if (bot.controlState?.sneak) return skip('sneaking (held by another subsystem); composting waits for another visit')
  const comp = findTownComposter(bot)
  if (!comp) return skip('no composter within 16 of home yet')
  const pos = comp.position, centre = pos.offset(0.5, 0.5, 0.5), at = () => bot.blockAt(pos)
  const levelBefore = composterLevel(at())
  const ripe = levelBefore >= 7 && boneMealRoom(items())
  // THE PEACEFUL FOOD POLICY (foodskip.mjs, owner 10-06): apples above APPLE_RESERVE go in too, only while it is active.
  const apples = foodSkipNow(bot).active
  if (!compostPlan(items(), { apples }).junk && !ripe) return skip(`nothing compostable at ${slotsBefore} of 36 slots and nothing to harvest`)
  const was = handOf(bot.heldItem)
  const g = hkGuards(bot, signal)
  const ticks = n => g.bound(bot.waitForTicks?.(n), n * 50 + HK_AWAIT_MS, 'tick wait')
  const taken = {}
  let bonemeal = 0, stop = null, inserted = 0, uncollected = false, noRoom = false, stationary = 0, appleLevels = 0
  try {
    if (bot.entity.position.distanceTo(centre) > STATION_REACH) {
      try { await composterWalk(bot, () => g.bound(bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2)), HK_PATH_MS, 'pathfinding', { path: true })) } catch (e) { if (e?.aborted || signal?.aborted) throw e }
      check(signal)
      if (bot.entity.position.distanceTo(centre) > STATION_REACH) {
        row('failed', { stop: 'composter out of reach', levelBefore })
        return { status: 'failed', failClass: 'composter_unreachable', detail: `the town composter at ${pos.x},${pos.y},${pos.z} could not be reached` }
      }
    }
    const ripen = async () => {   // level 7 -> 8 takes 20 ticks
      for (let i = 0; i < 8 && composterLevel(at()) === 7; i++) { check(signal); await ticks(5) }
      return composterLevel(at()) !== 7
    }
    const harvest = async () => {   // level 8: one use pops a bone meal on top; it is not done until it is in the bag
      try { await applyHand(bot, handPlan({ mode: 'harvest', was, held: handOf(bot.heldItem), hotbar: hotbarOf(bot), items: items() }), g.bound) } catch (e) { if (e?.aborted) throw e }
      const before = countOf('bone_meal')
      try { await g.bound(bot.activateBlock(at()), HK_AWAIT_MS, 'use the composter') } catch (e) { if (e?.aborted) throw e }
      await ticks(12)   // the drop's pickup delay is 10 ticks
      if (composterLevel(at()) === 8) return 'level 8 did not empty'
      if (countOf('bone_meal') <= before) {
        // NOT IN THE BAG YET (sandbox, Paper 1.21.8: 5 of 6 visits left a bone meal in the world). It pops at the
        // composter's top centre +-0.35 and can fall into the hollow; mineflayer hears an item's position only every ~20
        // ticks. So: let it settle and the position arrive, then -- only if it is not already in this body's pickup box
        // -- walk into its box with the pickup-box goal (pickupbox.mjs: the server's own pickup rule), on a cell OUTSIDE the composter.
        // The old GoalNear(drop, 1) accepted the composter's own cell: the walk ended inside the hollow and the drop
        // was never handed over.
        await ticks(BONEMEAL_SETTLE_TICKS)
        const drop = bot.nearestEntity?.(e => e?.name === 'item' && e.position && e.position.distanceTo(centre) < 4 &&
          (() => { try { return e.getDroppedItem?.()?.name === 'bone_meal' } catch { return false } })())
        if (countOf('bone_meal') <= before && drop && !inPickupBox(bot.entity.position, drop.position)) {
          const goal = pickupGoalOutside(bot, drop.position, pos)
          if (goal) { try { await composterWalk(bot, () => g.bound(bot.pathfinder.goto(goal), HK_PATH_MS, 'pathfinding', { path: true })) } catch (e) { if (e?.aborted || signal?.aborted) throw e } }
          await ticks(12)
        }
      }
      const got = countOf('bone_meal') - before
      if (got <= 0) { uncollected = true; return 'bone meal popped but not confirmed in the bag; extraction stopped' }
      bonemeal += got
      return null
    }
    const deadline = Date.now() + VISIT_BUDGET_MS
    // A BOUNDED, DECLARED STATIONARY WINDOW for the stuck watchdog (reflex.mjs stuckDecision): the visit stands at the
    // composter on purpose for up to its own budget; the window expires by itself and is cleared below.
    stationary = deadline + STATIONARY_SLACK_MS
    bot.stationaryUntil = stationary
    let misses = 0
    for (;;) {
      check(signal)
      if (Date.now() > deadline) { stop = 'budget'; break }
      const room = boneMealRoom(items())
      const next = inserted < MAX_ITEMS_PER_VISIT ? nextInsert(items(), { room, apples }) : null
      const act = fillDecision({ level: composterLevel(at()), room, smallest: next?.n ?? 0 })
      if (act === 'done') break
      if (act === 'gone') { stop = 'composter gone'; break }
      if (act === 'skip_no_room') { noRoom = true; stop = 'no room for the bone meal'; break }
      if (act === 'ripen') { if (!(await ripen())) { stop = 'did not ripen'; break } continue }
      if (act === 'harvest') { const why = await harvest(); if (why) { stop = why; break } continue }
      const stack = next.item
      if (bot.heldItem?.name !== stack.name || bot.heldItem?.slot !== stack.slot) {
        try { await g.bound(bot.equip(stack, 'hand'), HK_AWAIT_MS, 'equip') } catch (e) { if (e?.aborted) throw e; stop = `could not hold ${stack.name}`; break }
        check(signal)
        if (bot.heldItem?.name !== stack.name) { stop = `could not hold ${stack.name}`; break }
      }
      const before = countOf(stack.name)
      const lv0 = composterLevel(at())
      try { await g.bound(bot.activateBlock(at()), HK_AWAIT_MS, 'use the composter') } catch (e) { if (e?.aborted) throw e }
      await ticks(2)
      let after = countOf(stack.name)
      if (after >= before) { await ticks(4); after = countOf(stack.name) }
      if (after < before) {
        taken[stack.name] = (taken[stack.name] ?? 0) + (before - after); inserted += before - after; misses = 0
        // THE LEVELS AN APPLE RAISED (the peaceful food policy's bone meal: apple_levels / 7). Inside the success branch, so
        // the miss count below is exactly the old one (Codex review: a sibling `if` had captured its `else`).
        if (stack.name === 'apple') { const lv1 = composterLevel(at()); if (lv0 != null && lv1 != null && lv1 > lv0) appleLevels += lv1 - lv0 }
      } else if (++misses >= 3) { stop = `took no ${stack.name} in 3 tries`; break }
    }
  } finally {
    if (stationary && bot.stationaryUntil === stationary) bot.stationaryUntil = 0
    await settleAndRestore(bot, was, g, 'compost')
  }
  const n = Object.values(taken).reduce((a, b) => a + b, 0)
  const slotsAfter = items().length
  const f = { levelBefore, levelAfter: composterLevel(at()), bonemeal, items: taken, stop: stop ?? 'done', appleLevels: taken.apple ? appleLevels : null }
  if (n || bonemeal) {
    row('success', f)
    return { status: 'success',
             detail: `composted ${n} item(s) (${slotsBefore} -> ${slotsAfter} slots, ${bonemeal} bone meal)${stop ? `; stopped: ${stop}` : ''}` }
  }
  // NO PENALTY for a visit that could not start: a ripe composter with no room, or no fill that could finish.
  if (noRoom) return skip(`${stop}: the composter waits for a bot with room`, f)
  row('failed', f)
  return { status: 'failed', failClass: uncollected ? 'bonemeal_uncollected' : 'compost_refused',
           detail: `composted nothing at the composter: ${stop ?? 'nothing left to insert'}` }
}

// --------------------------------------------------------- town_deposit -----
// THE TOWN DEPOSIT (towndeposit.mjs has the measurement and every rule): a bot at town with a bag at 34+ banks whole
// stacks of surplus into a town container, slot by slot. Its OWN chest loop, not `deposit`'s: the model's deposit verb
// is unchanged (it walks home, digs lids, crafts chests on a full bank); this never walks home, never digs, towers,
// bridges, crafts or places, never tries more than two containers, and moves each stack with two left clicks into an
// EMPTY container slot -- a move whose result the client can predict, so the cursor is never left loaded at a close.

const isTownContainer = (bot, b) => ['chest', 'barrel', 'trapped_chest'].includes(blockNameOf(bot, b))
const blockProps = b => { try { return b?.getProperties?.() ?? {} } catch { return {} } }
/**
 * The town containers this bot can bank into from where it stands -> Block[], nearest first (then x, y, z), at most
 * TD_MAX_CONTAINERS: within STORAGE_REACH of the bot, inside the town (16 h / 12 v of home), not under a solid lid, and
 * never the other half of a double chest already listed (the halves name each other in their block state; both open
 * the same 54 slots).
 */
export function townContainers (bot, max = TD_MAX_CONTAINERS) {
  try {
    const me = bot.entity?.position
    if (!me) return []
    const home = homeVec()
    const found = (bot.findBlocks?.({ matching: b => isTownContainer(bot, b), maxDistance: STORAGE_REACH, count: 32 }) ?? [])
      .filter(p => inTownZone(p, home) && me.distanceTo(p) <= STORAGE_REACH)
      .sort((a, b) => me.distanceTo(a) - me.distanceTo(b) || a.x - b.x || a.y - b.y || a.z - b.z)
    // THE TOWN'S MEMORY (chestfull.mjs, rebase review P3): a container recently found full, unavailable or unusable is
    // skipped, exactly as the deposit's recovery skips it.
    let mem = {}
    try { mem = readTownMemory(townDir(), homeTownKey(), bot.worldId ?? null) ?? {} } catch { mem = {} }
    const out = []
    for (const p of found) {
      if (out.length >= max) break
      if (['full', 'unavailable', 'unusable', 'backoff'].includes(containerStatus(mem[posKey(p)]))) continue
      const b = bot.blockAt(p)
      if (!b || !isTownContainer(bot, b)) continue
      const chestLike = blockNameOf(bot, b) !== 'barrel'
      if (chestLike && chestLidBlocked(bot.blockAt(p.offset(0, 1, 0)))) continue
      const partner = chestLike ? doubleChestPartner(p, blockProps(b)) : null
      if (partner && out.some(o => o.position.x === partner.x && o.position.y === partner.y && o.position.z === partner.z)) continue
      out.push(b)
    }
    return out
  } catch { return [] }
}

/** The window's own copy of the bag, numbered as INVENTORY slots (plan) with the window slot kept (clicks). */
function windowBag (bot, win) {
  const off = (bot.inventory?.inventoryStart ?? 9) - win.inventoryStart
  const out = []
  for (let s = win.inventoryStart; s < win.inventoryEnd; s++) {
    const it = win.slots[s]
    if (it) out.push({ name: it.name, count: it.count, type: it.type, maxDurability: it.maxDurability, durabilityUsed: it.durabilityUsed, slot: s + off, wslot: s })
  }
  return out
}

/**
 * OPEN A CONTAINER, BOUNDED, AND NEVER LEAVE AN OPEN BEHIND -> the window, or null. mineflayer's open waits for the next
 * `windowOpen` for up to 20 s (promise_utils once), and two pending opens resolve with the SAME window (Codex review 2).
 * So a timed-out open is DRAINED before this returns: the run waits for that pending open to settle (bounded by
 * mineflayer's own 20 s) and closes the window if it came, so no later open -- this run's or the next skill's -- can be
 * handed it.
 */
async function openTown (bot, block, ms) {
  const opening = Promise.resolve().then(() => bot.openContainer(block))
  let timer
  const won = await Promise.race([opening.then(w => ({ w }), e => ({ e })), new Promise(res => { timer = setTimeout(() => res({ late: true }), ms) })])
  clearTimeout(timer)
  if (won.w) return won.w
  if (won.late) {
    let drain
    const w = await Promise.race([opening.catch(() => null), new Promise(res => { drain = setTimeout(() => res(null), 21_000) })])
    clearTimeout(drain)
    try { if (w && bot.currentWindow === w) w.close() } catch { /* gone */ }
  }
  return null
}

/**
 * Bank the plan into one OPEN, OWNED container. -> { done: [{ step, it, dest }], full, err }. Each step is one whole
 * stack, revalidated against the window right before it moves: a left click on its slot (the cursor must then hold
 * exactly that stack), then -- the destination re-read AFTER the pickup -- a left click on an EMPTY container slot.
 * EVERY CLICK IS WITHDRAW'S (rebase review, Codex P1): inside craftsync's lockstep, tracked until it settles, refused
 * unless this window is still the open one -- a chest-layout slot never lands in another window. Any surprise stops the
 * loop; the CALLER settles the cursor with withdraw's server-confirmed settleCursor (or holds the window open).
 * Nothing is credited here (verifyTown reads the server).
 */
async function bankInto (bot, win, wanted, already, deadline, signal) {
  const bag = windowBag(bot, win)
  const plan = townDepositPlan(bag, { wanted, already })
  const steps = fitToContainer(plan.steps, win.slots.slice(0, win.inventoryStart))
  let full = plan.steps.length > steps.length
  const done = []
  const emptyDest = () => { for (let i = 0; i < win.inventoryStart; i++) if (!win.slots[i] && !done.some(x => x.dest === i)) return i; return null }
  let err = null
  try {
    await lockstepClicks(bot, async raw => {
      const click = async slot => {
        check(signal)
        if (bot.currentWindow !== win) throw stop('the window changed')
        const p = trackedClick(bot, raw, slot, 0, 0)
        p.catch(() => {})
        if ((await within(p, Math.max(250, deadline - Date.now()))) === TIMED_OUT) throw stop('a click went unanswered')
      }
      for (const step of steps) {
        check(signal)
        if (Date.now() > deadline - TD_SETTLE_MS) break
        const it = bag.find(b => b.slot === step.slot)
        const now = it ? win.slots[it.wslot] : null
        if (!now || now.name !== step.name || now.count !== step.count || win.selectedItem) continue   // the bag moved under the plan
        await click(it.wslot)
        if (!win.selectedItem || win.selectedItem.name !== step.name || win.selectedItem.count !== step.count) throw stop(`picked up ${win.selectedItem?.name ?? 'nothing'}, not ${step.name}`)
        const dest = !win.slots[step.dest] ? step.dest : emptyDest()
        if (dest == null) { full = true; throw stop('no empty container slot left') }
        await click(dest)
        if (win.selectedItem) throw stop(`the ${step.name} did not go into slot ${dest}`)
        done.push({ step, it, dest })
      }
    }, { deadline, signal })
  } catch (e) {
    if (e?.aborted || signal?.aborted) throw e
    err = String(e?.message ?? e).slice(0, 80)
  }
  return { done, full, err }
}

/**
 * THE SERVER'S WORD (Codex review 2: a 1.21 click is a client prediction, and closeWindow copies that prediction into
 * bot.inventory, so neither the window nor the bag after a close is evidence). The container is opened AGAIN: an open
 * is answered with the server's own contents (mineflayer emits windowOpen only after the slot data), so a step counts
 * only when its destination slot holds that stack in the server's copy. -> { verified: [{ step, it }], ok } where ok is
 * false when the re-open did not come back (then nothing is credited and the run says unverified).
 */
async function verifyTown (bot, block, done, ms) {
  if (!done.length) return { verified: [], ok: true, bag: null }
  const win = await openTown(bot, block, ms)
  if (!win) return { verified: [], ok: false, bag: null }
  try {
    const bag = {}
    for (const it of windowBag(bot, win)) bag[it.name] = (bag[it.name] ?? 0) + (it.count ?? 0)
    return { ok: true, bag, verified: done.filter(({ step, dest }) => { const d = win.slots[dest]; return !!d && d.name === step.name && d.count === step.count }) }
  } finally { try { win.close() } catch { /* already closed */ } }
}

async function townDeposit (ctx, _args, signal) {
  const { bot } = ctx
  const items = () => bot.inventory?.items?.() ?? []
  const deadline = Date.now() + TD_BUDGET_MS
  const wanted = Array.isArray(bot.townDepositWanted) ? bot.townDepositWanted : []
  const before = items()
  const slotsBefore = before.length
  const held = list => { const c = {}; for (const it of list) c[it.name] = (c[it.name] ?? 0) + (it.count ?? 0); return c }
  const heldBefore = held(before)
  const planned = townDepositPlan(before, { wanted }).steps.length
  // `attempted` is what this visit MOVED (the client's clicks) and spends the cap; `banked` is what the server showed in
  // a chest on the re-open. A stack another bot takes out before the re-open is attempted but not banked -- and must
  // still count against the visit's 64 (Codex round 3).
  const banked = {}, attempted = {}, tried = [], tools = []
  let stacks = 0, unsettled = 0, stop = null, clicked = 0, unverified = 0, serverBag = null
  // THE BAG'S LOSS over the banked names, from the SERVER's copy of the bag on the last re-open (the client bag after a
  // close is mineflayer's own prediction); the client bag only when nothing was re-opened.
  const bagDelta = () => { const after = serverBag ?? held(items()); return Object.keys(banked).reduce((t, n) => t + Math.max(0, (heldBefore[n] ?? 0) - (after[n] ?? 0)), 0) }
  const row = (status, extra = {}) => logEvent({ kind: 'town_deposit', status, snapshot: snapshot(bot),
    detail: townDepositDetail({ slotsBefore, slotsAfter: items().length, banked, stacks, tried, stop: stop ?? 'done', unsettled, bagDelta: bagDelta(), planned, tools, clicked, unverified, ...extra }) })
  if (!planned) { stop = 'nothing to bank above the keeps'; row('no_effect'); return { status: 'no_effect', detail: 'nothing to bank: everything carried is kept (stockpile, scaffold, tools, iron, the goal) or not bankable' } }
  if (bot.controlState?.sneak) { stop = 'sneaking'; row('no_effect'); return { status: 'no_effect', detail: 'sneaking (held by another subsystem); the town deposit waits for another visit' } }
  const containers = townContainers(bot)
  if (!containers.length) { stop = 'no town container'; row('no_effect'); return { status: 'no_effect', detail: 'no town chest within reach now; the town deposit waits for another visit' } }
  const walk = fn => (typeof bot.withTownDepositWalk === 'function' ? bot.withTownDepositWalk(fn) : fn())
  const left = () => deadline - TD_SETTLE_MS - Date.now()
  const openMs = () => Math.max(1000, Math.min(TD_OPEN_MS, left()))
  const stationary = deadline + TD_SETTLE_MS
  bot.stationaryUntil = stationary
  try {
    for (const c of containers) {
      const at = `${c.position.x},${c.position.y},${c.position.z}`
      if (left() <= 1000) { stop = 'budget'; break }
      check(signal)
      if (bot.entity.position.distanceTo(c.position.offset(0.5, 0.5, 0.5)) > STATION_REACH) {
        try {
          await walk(() => withTimeout(bot.pathfinder.goto(new goals.GoalNear(c.position.x, c.position.y, c.position.z, 2)), Math.max(1000, Math.min(TD_WALK_MS, left())), bot))
        } catch (e) { if (e?.aborted || signal?.aborted) throw e; tried.push({ at, result: 'unreachable' }); continue }
        check(signal)
      }
      const block = bot.blockAt(c.position)
      if (!block || !isTownContainer(bot, block)) { tried.push({ at, result: 'gone' }); continue }
      try { bot.setControlState('sneak', false) } catch { /* a test double */ }
      try { await bot.lookAt?.(c.position.offset(0.5, 0.5, 0.5), true) } catch { /* optional on test doubles */ }
      const win = await openTown(bot, block, openMs())
      if (!win) { tried.push({ at, result: 'unopenable' }); stop = 'open timeout'; break }
      // OWNED FROM THE OPEN TO THE CLOSE, OR HELD (withdraw's rules, rebase review P1): nothing else touches the inventory
      // while this run has the window; the cursor is settled with the SERVER's word before the close, and a cursor that
      // cannot be emptied keeps the window open (holdUnsettled) -- never a loaded close.
      const own = ownInventory(bot, win)
      let r = { done: [], full: false, err: null }, settled = null
      try {
        r = await bankInto(bot, win, wanted, attempted, deadline, signal)
      } finally {
        settled = await settleCursor(bot, win)
        if (settled.state === 'unresolved') holdUnsettled(bot, win, settled, own)
        // A WINDOW THE SERVER ALREADY CLOSED is not closed again (Codex round 2): mineflayer's close copies the window
        // into the bag and clears currentWindow, which would overwrite the server's correction or a newer window.
        else { if (bot.currentWindow === win) own.close(); invalidateClicks(bot, 'town deposit end'); own.restore() }
      }
      if (settled.state === 'unresolved') {
        // HELD: no re-open (the window is still open, held by withdraw's hold) and nothing else this run.
        unsettled++; clicked += r.done.length
        tried.push({ at, result: 'held' }); stop = 'cursor'; break
      }
      clicked += r.done.length
      for (const { step } of r.done) attempted[step.name] = (attempted[step.name] ?? 0) + step.count
      const v = await verifyTown(bot, block, r.done, openMs())
      if (!v.ok) unverified += r.done.length
      if (v.bag) serverBag = v.bag
      // A TOWN CONTAINER TOOK ITEMS (rebase review P3): the town's memory hears it, as it does from the deposit verb --
      // that clears withdraw's pickaxe/ingredient misses for this container and is the bank's "room again" signal.
      if (v.verified.length) { rememberTown(bot, c.position, 'took'); const q = chestPartner(bot, c.position); if (q) rememberTown(bot, q, 'took') }
      for (const { step, it } of v.verified) {
        banked[step.name] = (banked[step.name] ?? 0) + step.count; stacks++
        if (it.maxDurability) tools.push(`${step.name}@${it.maxDurability - (it.durabilityUsed ?? 0)}`)
      }
      tried.push({ at, result: !v.ok ? 'unverified' : v.verified.length ? (r.full ? 'took_some' : 'took') : r.full ? 'full' : 'none' })
      if (!v.ok) { stop = 'unverified'; break }
      if (!townDepositPlan(items(), { wanted, already: attempted }).steps.length) break
    }
  } finally {
    if (bot.stationaryUntil === stationary) bot.stationaryUntil = 0
  }
  const n = Object.values(banked).reduce((a, b) => a + b, 0)
  const slotsAfter = items().length
  // A HELD CURSOR OUTRANKS AN EARLIER SUCCESS (Codex round 2): the window is still open and owned; the row keeps the
  // verified tally of the containers before it.
  if (unsettled) {
    row('failed')
    return { status: 'failed', failClass: 'transfer_unsettled',
             detail: `a stack could not be put back from the cursor at the town chest (${n} item(s) were banked before it); the window is held open until it is (nothing else runs meanwhile)` }
  }
  if (n > 0) {
    row('success')
    return { status: 'success', detail: `banked ${n} item(s) in ${stacks} whole stack(s) at the town chest, read back from the server (${slotsBefore} -> ${slotsAfter} slots); the stockpile, scaffold, iron and best tools stay` }
  }
  // NOT `unknown`: the runner promotes an unknown with an inventory loss to success, and the loss here is mineflayer's own
  // prediction copied into the bag at the close -- exactly what could not be confirmed (Codex round 3). Failed: backs off.
  if (unverified) {
    row('failed')
    return { status: 'failed', failClass: 'town_deposit_unverified', detail: 'moved stacks into the town chest but could not open it again to confirm them; the town deposit waits' }
  }
  if (tried.length && tried.every(t => t.result === 'full')) {
    stop = stop ?? 'full'
    row('failed')
    return { status: 'failed', failClass: 'town_storage_full',
             detail: 'the town chests in reach are full; deposit (no item) tries other chests and can build a new one' }
  }
  stop = stop ?? (clicked ? 'not confirmed by the server' : 'nothing moved')
  row('failed')
  return { status: 'failed', failClass: 'town_deposit_failed',
           detail: `banked nothing at the town chests (${tried.map(t => t.result).join(', ') || 'none tried'}); deposit (no item) walks to the chest and tries others` }
}

// ------------------------------------------------------ build_composter -----
/** "On the stand" means the feet within this of the standing cell's centre, horizontally (the body is 0.6 wide). */
export const STAND_CENTRE_TOL = 0.3
const centredOn = (bot, c) => { const q = bot.entity?.position; return !!q && !!c && Math.abs(q.x - (c.x + 0.5)) <= STAND_CENTRE_TOL && Math.abs(q.z - (c.z + 0.5)) <= STAND_CENTRE_TOL }
/** A bounded nudge to the centre of the cell the bot already stands in: face it, step, stop. */
async function centreOn(bot, c, signal) {
  const target = new Vec3(c.x + 0.5, bot.entity.position.y + 1.62, c.z + 0.5)
  try { await bot.lookAt?.(target, true) } catch { /* not fatal */ }
  try {
    bot.setControlState?.('forward', true)
    for (const until = Date.now() + 1_500; !centredOn(bot, c) && Date.now() < until;) await sleep(25, signal)
  } finally { try { bot.setControlState?.('forward', false) } catch { /* nothing held */ } }
}
/** Every body near the bot that a placed block may not intersect: its own, and every entity's but items' and orbs'. */
const bodiesAround = bot => [bot.entity, ...Object.values(bot.entities ?? {}).filter(e => e && e !== bot.entity && e.position &&
  !['item', 'experience_orb'].includes(e.name) && e.position.distanceTo?.(bot.entity.position) < 8)]
  .filter(e => e?.position).map(e => ({ x: e.position.x, y: e.position.y, z: e.position.z, w: e.width ?? 0.6, h: e.height ?? 1.8 }))
const hkStop = (failClass, message) => Object.assign(new Error(message), { hkStop: true, failClass })
/** What the composter chain consumes (never advised away to free a slot). */
const chainConsumes = plan => (plan?.wood ? [plan.log, `${plan.wood}_planks`, `${plan.wood}_slab`].map(name => ({ name, count: 1 })) : [])
/**
 * NO ROOM TO START THE BUILD -> the skip's detail. The worst case of the chain does not fit, and the remedy cannot be
 * the composter itself (it is not built) or composting (nothing to compost into): it is slotRemedy's, which names only
 * a move whose precondition holds from here -- or says plainly that nothing can be freed here.
 */
function noRoomToBuild(bot, plan, said) {
  const { remedy } = slotRemedy(bot, bot.inventory?.items?.() ?? [], chainConsumes(plan))
  // THE REMEDY FIRST: the prompt keeps 220 characters of the whole outcome (cognitive.mjs formatOutcome).
  return `${remedy}. Not started: ${said}; the town has no composter yet, so composting cannot free them`
}
/**
 * A COMPOSTER CRAFT THE EXECUTOR REFUSED OR COULD NOT VERIFY -> { failClass, detail }. Pure. A full bag (a pickup
 * filled the room the plan counted on) is composter_no_room, its detail the executor's own refusal with its remedy;
 * everything else is composter_craft. Neither votes (evidenceScope); a failed build backs off (townOrderOutcome).
 */
export function composterCraftFailure (item, out = {}, { free = null } = {}) {
  // THE EXECUTOR'S DETAIL LEADS WITH ITS REMEDY, so it goes first, untruncated; the composter context follows.
  const said = String(out?.detail ?? out?.failClass ?? 'unknown')
  // THE BAG-FULL FAMILY (sandbox scene 2c, 2 of 3): a pickup landing mid-click leaves the result no slot, put-away tosses
  // it, and craftsync reports the server count did not rise (craft_unconfirmed / not_in_inventory). With the bag full
  // at that moment that is a room failure, not a broken craft: composter_no_room, and its own (shorter) backoff.
  const tossedForRoom = out?.failClass === 'craft_unconfirmed' && out?.reason === 'not_in_inventory' && free != null && free <= 0
  if (out?.failClass === 'inventory_full' || tossedForRoom) {
    return { failClass: 'composter_no_room', detail: `${said} [crafting ${item} for the town composter, which is not built yet, so composting cannot free the slot]` }
  }
  return { failClass: 'composter_craft', detail: `${said} [crafting ${item} for the town composter]` }
}
async function buildComposter (ctx, _args, signal) {
  const { bot } = ctx
  const items = () => bot.inventory?.items?.() ?? []
  const free = () => 36 - items().length
  const skip = why => ({ status: 'no_effect', detail: why })
  const fail = (failClass, why) => ({ status: 'failed', failClass, detail: why })
  const REMEDY = 'no composter in town and not enough wood to build one: it takes 7 slabs of one wood and a crafting table -- ' +
                 '3 logs of one kind (2 if a crafting table is carried) -- gather 3 logs and the next town visit builds it'
  if (findTownComposter(bot)) return skip('the town already has a composter')
  const pre = townBuildPlan(bot)
  if (!pre) return skip(REMEDY)
  // NEVER CRAFT INTO A FULL BAG: mineflayer drops crafted output that has no slot. And NO CIRCULAR REMEDY: the
  // composter is what would free slots, and it does not exist yet -- the refusal names what frees one from HERE.
  if (free() < pre.slotsNeeded) return skip(noRoomToBuild(bot, pre, `building needs ${pre.slotsNeeded} free slots for the craft chain and the bag has ${free()}`))
  const home = homeVec(), read = readCell(bot)
  // NO SITE IS A FREE SKIP: an unloaded cell, no valid cell, or no shared record -- never this bot's private answer.
  const { site, gen, why } = townComposterSite(bot)
  if (!site) return skip(`the town's composter site cannot be settled from here: ${why}`)
  const stand = standableBeside(read, site)
  const centre = new Vec3(site.x + 0.5, site.y + 0.5, site.z + 0.5)
  const was = handOf(bot.heldItem)
  const g = hkGuards(bot, signal)
  const inSiteColumn = e => e?.position && Math.floor(e.position.x) === site.x && Math.floor(e.position.z) === site.z && Math.abs(Math.floor(e.position.y) - site.y) <= 1
  const approach = async () => {
    const here = bot.entity.position
    if (here.distanceTo(centre) <= STATION_REACH && !inSiteColumn(bot.entity)) return true
    try { await g.bound(bot.pathfinder.goto(new goals.GoalBlock(stand.x, stand.y, stand.z)), HK_PATH_MS, 'pathfinding', { path: true }) } catch (e) { if (e?.aborted || signal?.aborted) throw e }
    check(signal)
    return bot.entity.position.distanceTo(centre) <= STATION_REACH && !inSiteColumn(bot.entity)
  }
  // place() gets its OWN signal, aborted when the order's is or when the bound runs out, so a timed-out place stops at
  // its next check instead of putting the block down after the order has given up on it.
  const placeWithin = async args => {
    const ac = new AbortController()
    const relay = () => ac.abort()
    try { signal?.addEventListener?.('abort', relay, { once: true }) } catch { /* plain-object signal */ }
    try { return await g.bound(place(ctx, args, ac.signal), HK_CRAFT_MS, 'place', { controller: ac }) } finally {
      try { signal?.removeEventListener?.('abort', relay) } catch { /* plain-object signal */ }
    }
  }
  // ONE REPETITION AT A TIME, THROUGH THE CRAFT SKILL'S OWN EXECUTOR (craftExecutions): the room check before each
  // execution (make-room never wears the last digging pickaxe), craftsync's admission after its baseline resync,
  // craftsync's verdict (or, without craftsync, the bounded local read-back the sandbox called for), the item-on-the-
  // ground hold-back, and the _craft_room rows. The next repetition's recipe is looked up only after the previous one
  // was verified, so it never runs on a stale view of the bag. bot.craft's count here is ONE EXECUTION (craftsync's
  // `count` is crafts; plan.logCrafts/slabCrafts are executions), so no item/execution conversion is involved.
  const rs = { tries: 0, tableYields: false, pickupDealt: false, owed: () => 0, stationDid: [] }
  let chain = []   // the chain's ingredients (set once the plan is read at the site): never advised away mid-build
  const craftTimes = async (item, times, table) => {
    const def = bot.registry.itemsByName[item]
    for (let i = 0; i < times; i++) {
      check(signal)
      const recipe = def && (bot.recipesFor(def.id, null, 1, table ?? null) ?? [])[0]
      if (!recipe) throw hkStop('composter_craft', `no ${item} recipe from what is held${table ? ' at the table' : ''}`)
      let ran
      try {
        ran = await g.bound(craftExecutions(ctx, { item, recipe, crafts: 1, table: table ?? undefined, anchor: table ?? null,
                                                   protect: chain, signal, deadline: Date.now() + HK_CRAFT_MS - 500, rs }), HK_CRAFT_MS, 'craft')
      } catch (e) {
        if (e?.aborted || signal?.aborted) throw e
        throw hkStop('composter_craft', `crafting ${item} failed: ${String(e?.message ?? e).slice(0, 80)}`)
      }
      if (!ran.ok) { const f = composterCraftFailure(item, ran.out, { free: free() }); throw hkStop(f.failClass, f.detail) }
    }
  }
  try {
    if (!(await approach())) return fail('composter_unreachable', `could not reach the town's composter site at ${site.x},${site.y},${site.z}`)
    // AT THE SITE: the table actually in reach, then the ingredients and the free slots, all read again here.
    const tableHere = bot.findBlock?.({ matching: b => blockNameOf(bot, b) === 'crafting_table', maxDistance: Math.ceil(STATION_REACH) + 1 })
    let table = tableHere && bot.entity.position.distanceTo(tableHere.position.offset(0.5, 0.5, 0.5)) <= STATION_REACH ? tableHere : null
    const counts = Object.fromEntries(heldCounts(items()))
    const plan = composterBuildPlan(counts, { tableAvailable: !!table || townPlanTableAvailable(items()), items: items() })
    if (!plan) return skip(REMEDY)
    chain = chainConsumes(plan)
    if (free() < plan.slotsNeeded) return skip(noRoomToBuild(bot, plan, `at the site the bag has ${free()} free slots and the craft chain needs ${plan.slotsNeeded}`))
    if (!plan.carried) {
      if (plan.logCrafts) await craftTimes(`${plan.wood}_planks`, plan.logCrafts, null)
      if (!table) {
        if (countItem(bot, 'crafting_table') < 1) await craftTimes('crafting_table', 1, null)
        // BACK ON THE STANDING CELL FIRST (C5): a pickup walk during the planks or table craft (craftExecutions) may have
        // moved the bot; the table goes within 2 of the composter's standing cell, never beside wherever that walk
        // ended. approach() alone is satisfied anywhere within reach of the site, which is not enough here.
        // ENFORCED (Codex): a failed walk back is not swallowed -- off the stand, nothing is put down, and the table cell
        // is chosen from the VERIFIED stand, never from the feet.
        // ON THE STAND MEANS CENTRED (sandbox: the floored feet passed with the bot at x+0.94 on its stand, its own body
        // overlapped the table cell, and the placement timed out): within STAND_CENTRE_TOL of the cell's centre, after a
        // bounded nudge if the cell is right but the body is not.
        const onStand = () => { const f = bot.entity.position.floored(); return !!stand && f.x === stand.x && f.y === stand.y && f.z === stand.z }
        if (stand && !onStand()) {
          try { await g.bound(bot.pathfinder.goto(new goals.GoalBlock(stand.x, stand.y, stand.z)), HK_PATH_MS, 'pathfinding', { path: true }) } catch (e) { if (e?.aborted || signal?.aborted) throw e }
          check(signal)
        }
        if (onStand() && !centredOn(bot, stand)) await centreOn(bot, stand, signal)
        if (!onStand() || !centredOn(bot, stand)) {
          const q = bot.entity.position
          return fail('composter_unreachable', `walk to the composter's standing cell at ${stand?.x},${stand?.y},${stand?.z} and clear it ` +
                      `(something may be standing on it): the bot is at ${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)}, and the crafting table goes down only from the centre of that cell`)
        }
        if (!(await approach())) return fail('composter_unreachable', `could not get back to the composter site at ${site.x},${site.y},${site.z} to put the crafting table down`)
        // NEVER INTO A BODY: the bot's own and every other's (items aside) are kept out of the table's cell.
        const cell = tableCellFor({ site, stand: { x: stand.x, y: stand.y, z: stand.z }, read, bodies: bodiesAround(bot) })
        if (!cell) {
          if (tableCellFor({ site, stand: { x: stand.x, y: stand.y, z: stand.z }, read })) {
            return fail('composter_unreachable', `wait for the cells beside the composter's standing cell at ${stand.x},${stand.y},${stand.z} to clear: ` +
                        `every cell where the crafting table could go has someone standing in it`)
          }
          return fail('composter_site', `nowhere within 2 of the composter site's standing cell to put a crafting table`)
        }
        let put
        try { put = await placeWithin({ item: 'crafting_table', x: cell.x, y: cell.y, z: cell.z }) } catch (e) { if (e?.aborted || signal?.aborted) throw e; put = { detail: String(e?.message ?? e) } }
        if (put?.status !== 'success') return fail('composter_place', `could not put the crafting table down at ${cell.x},${cell.y},${cell.z}: ${String(put?.detail).slice(0, 100)}`)
        table = bot.blockAt(new Vec3(cell.x, cell.y, cell.z))
      }
      if (plan.slabCrafts) await craftTimes(`${plan.wood}_slab`, plan.slabCrafts, table)
      // A BOT THAT LOSES THE RACE KEEPS NOTHING it cannot use: the check runs right before the composter itself.
      if (findTownComposter(bot)) return skip('another bot built the town composter first; no composter crafted (the planks/slabs stay)')
      await craftTimes('composter', 1, table)
    }
    if (!(await approach())) return fail('composter_unreachable', `could not get back to the composter site at ${site.x},${site.y},${site.z}`)
    // AFTER THE LAST MOVE AND IMMEDIATELY BEFORE PLACING: a composter anywhere in town wins, and the clearance volume
    // is read again cell by cell.
    if (findTownComposter(bot)) return skip('another bot placed the town composter first; this one stays in the bag')
    const refusal = siteRefusal(read, site, home)
    if (refusal === 'unknown') return skip(`a cell around the composter site at ${site.x},${site.y},${site.z} is not loaded; placing waits for another visit`)
    if (refusal) return fail('composter_site', `the composter site ${site.x},${site.y},${site.z} is no longer valid (${refusal}); the composter stays in the bag`)
    // THE FENCE: the shared record must still name this generation and this cell. Another bot that refused it has
    // published N+1 and is building there; this one stands down (no penalty) and the composter stays in the bag.
    const now = readTownSite(poolStateDir(config.memory.pool), townSiteKey())
    if (now.gen !== gen || !now.site || now.site.x !== site.x || now.site.y !== site.y || now.site.z !== site.z) {
      return skip(`the town's composter site moved (generation ${gen} -> ${now.gen}) while this build was under way; nothing placed`)
    }
    if (Object.values(bot.entities ?? {}).some(e => e !== bot.entity && e?.name !== 'item' && inSiteColumn(e))) {
      return skip(`something is standing on the composter site at ${site.x},${site.y},${site.z}; placing waits for another visit`)
    }
    let put
    try { put = await placeWithin({ item: 'composter', x: site.x, y: site.y, z: site.z }) } catch (e) { if (e?.aborted || signal?.aborted) throw e; put = { detail: String(e?.message ?? e) } }
    if (put?.status !== 'success') return fail('composter_place', `could not place the town composter at ${site.x},${site.y},${site.z}: ${String(put?.detail).slice(0, 120)}`)
    if (blockNameOf(bot, bot.blockAt(new Vec3(site.x, site.y, site.z))) !== 'composter') return fail('composter_place', `placed, but ${site.x},${site.y},${site.z} does not read composter`)
    logEvent({ kind: 'composter_built', status: 'success', snapshot: snapshot(bot),
               detail: `at=${site.x},${site.y},${site.z} wood=${plan.wood ?? 'carried'} free=${free()} need=${plan.slotsNeeded} table=${table ? `${table.position.x},${table.position.y},${table.position.z}` : 'none'}` })
    return { status: 'success', placed: 1, detail: `built the town composter at ${site.x},${site.y},${site.z}` }
  } catch (e) {
    if (e?.hkStop) return fail(e.failClass, e.message)
    throw e
  } finally {
    await settleAndRestore(bot, was, g, 'build_composter')
  }
}

// ------------------------------------------------------------- withdraw -----
//
// The inverse of deposit, and its absence was structural: the town chests hold 124,894 items (09-27) -- 16,383
// oak_log, 6,859 sticks, 865 stone_pickaxe -- while 45 of 80 bots carry no usable pickaxe. Withdraw moved 48 items a
// day: the model's verb alone, one container in sight, the MOST PLENTIFUL item when none was named (cobblestone), the
// first copy by slot from a bank where worn tools go, and a transfer believed from mineflayer's optimistic window.
//
// REWRITTEN (Claude + Codex, 10-04), on bank-fix's skeleton (3da782a..353d89e): walk home then rescan (the model's
// verb only -- the town order never starts a trip), the lid looked at and the open bounded with a late window closed,
// up to three containers with a double chest's halves counted once, misses that do not vote (container_short,
// chest_unreachable). THE TRANSFER IS NEW: tools by SHIFT-CLICK of the source slot (no cursor stack; with no room the
// server leaves it in the chest), ingredients one click at a time in craftsync's lockstep (pick up, right-click n
// times into one bag slot, put the rest back, the cursor checked empty before the close), and the bag VERIFIED
// against the SERVER (craftsync serverRecount: the window closed, window 0 resynced, an answered window_items) --
// success only if the server's bag changed by exactly what was moved. Anything else is transfer_unsettled and ends
// the visit. Room is made only by banking whole stacks deposit itself would bank (withdrawpick.mjs roomPlan); what
// was taken is held back from deposit for HOLD_MS (bankable.mjs setWithdrawHold), so the next deposit cannot hand it
// back. Never a spent tool, either way.
const WITHDRAW_CONTAINERS = 3
const WITHDRAW_ALT_RADIUS = 24
const WITHDRAW_WALK_MS = 30_000
const RECOUNT_MS = 3_000
const TOOLISH = /_(pickaxe|axe|shovel|hoe|sword)$/

/** One container opened to take from: the lid looked at, the open bounded, a window that arrives late closed. */
async function openForWithdraw (bot, chestBlock, signal, msLeft) {
  const cp = chestBlock.position
  const lid = bot.blockAt(cp.offset(0, 1, 0))
  const isChest = ['chest', 'trapped_chest'].includes(blockNameOf(bot, chestBlock))   // barrels open under anything
  if (isChest && lid && chestLidBlocked(lid)) {
    if (!lidSafeToBreak(bot, lid.position)) {
      return { fail: { status: 'failed', failClass: 'container_blocked', detail: `the chest at ${cp.x},${cp.y},${cp.z} has ${lid.name} on its lid and it is not safe to break` } }
    }
    try { await withTimeout(bot.dig(lid), Math.max(1, msLeft(10_000)), bot, { what: 'dig', onTimeout: () => { try { bot.stopDigging?.() } catch {} }, needsDrop: false }) }
    catch (e) {
      if (e?.aborted || signal?.aborted) throw e
      return { fail: { status: 'failed', failClass: 'container_blocked', detail: `the chest at ${cp.x},${cp.y},${cp.z} has ${lid.name} on its lid and it would not break` } }
    }
    check(signal)
  }
  try { bot.setControlState('sneak', false) } catch {}
  try { await bot.lookAt?.(cp.offset(0.5, 0.5, 0.5), true) } catch {}
  // A WINDOW THAT ARRIVES AFTER THE TIMEOUT HAS NO OWNER (bank-fix, Codex): it is closed when it comes.
  let abandoned = false
  const opening = Promise.resolve().then(() => bot.openContainer(chestBlock))
  opening.then(w => { if (abandoned) { try { w.close() } catch {} } }, () => {})
  let chest
  try {
    chest = await withTimeout(opening, Math.max(1, msLeft(8_000)), bot, { what: 'open the chest', onTimeout: () => { abandoned = true }, needsDrop: false })
  } catch (e) {
    abandoned = true
    if (e?.aborted || signal?.aborted) throw e
    return { fail: { status: 'failed', failClass: 'container_open', detail: `could not open the chest at ${cp.x},${cp.y},${cp.z} (${String(e?.message ?? e).slice(0, 50)})` } }
  }
  if (signal?.aborted) { try { chest.close() } catch {} check(signal) }
  // THE WINDOW MUST BE THIS CHEST'S: openBlock resolves with whatever window opens next (bank-fix, both reviews).
  if (bot.currentWindow && bot.currentWindow !== chest) {
    try { chest.close() } catch {}
    return { fail: { status: 'failed', failClass: 'container_open', detail: `the window that opened is not the chest at ${cp.x},${cp.y},${cp.z}` } }
  }
  return { chest }
}

/** A bag as plain records (name, count, wear), frozen when read: the server's word, before anything else moves it. */
const bagSnapshot = items => (Array.isArray(items) ? items : []).filter(it => it?.name).map(it => ({ name: it.name, count: it.count ?? 0, durabilityUsed: it.durabilityUsed ?? 0 }))
/** The server's bag (craftsync serverRecount) -> { source: 'server' | 'none' | 'unanswered' | ..., bag }. Only 'server'
 *  is accepted (Codex): without craftsync ('none') or without an answer, nothing is transferred. */
async function recountBag (bot, msLeft) {
  let r
  try { r = await serverRecount(bot, { deadline: Date.now() + Math.max(1, msLeft(RECOUNT_MS)) }) } catch (e) { r = { source: `error:${String(e?.message ?? e).slice(0, 30)}`, items: null } }
  return { source: r?.source ?? 'none', bag: r?.items ? bagSnapshot(r.items) : null }
}

/** How long the cursor's recovery may take, whatever happened to the transfer (its own budget, not the aborted one's). */
const CURSOR_SETTLE_MS = 3_000
/** The hold's last resort when nothing can take the cursor (G): OFF by default -- keep holding, never drop. */
/** The hold's clocks (exported so tests can shorten them): any hold older than interventionMs raises
 *  intervention_needed (L); a no-capacity hold older than loadedMs applies the loaded mode (N); the ownership lock is
 *  kept after a close until every in-flight click settles, at most drainMs (H). */
export const HOLD_TIMING = { interventionMs: 60_000, loadedMs: 30_000, drainMs: 10_000 }
/**
 * THE LOADED-CURSOR MODE (N; owner decision pending -- the default is unchanged): what a hold with NOWHERE for the cursor
 * does after HOLD_TIMING.loadedMs. Claude's sandbox: with a full bag the server drops the stack at the next close,
 * disconnect, death or restart anyway, so holding only freezes the bot until then.
 *   hold      (default) keep holding; intervention_needed; survival release stays available
 *   close     close the window: the server returns what fits to the bag and drops the rest at the bot's feet
 *   junkswap  trade the cursor onto a bag slot holding never-banked junk (JUNKSWAP_ITEMS), confirm with the server that
 *             the cursor now holds the junk, then close -- only the junk drops. No such slot: keep holding.
 */
export const loadedMode = (env = process.env) => (['close', 'junkswap'].includes(env.WITHDRAW_LOADED_MODE) ? env.WITHDRAW_LOADED_MODE : 'hold')
const TIMED_OUT = Symbol('timed out')
const within = (p, ms) => { let t; return Promise.race([p, new Promise(r => { t = setTimeout(() => r(TIMED_OUT), Math.max(0, ms)) })]).finally(() => clearTimeout(t)) }

/** Clicks this module started that have not settled (withdraw's own; craftsync keeps its underlying ones) -- the
 *  shared tracker (inflight.mjs), one per bot. */
const ownClicks = bot => (bot._withdrawClicks ??= inflightTracker())
/** A click that is remembered until it settles, whatever the caller does in the meantime (Codex round 3). */
function trackedClick (bot, click, slot, button, mode) {
  return ownClicks(bot).track(Promise.resolve().then(() => click(slot, button, mode)))
}
/** Are ALL clicks settled -- ours, and craftsync's underlying ones that outlived its cap or teardown? */
const clicksSettled = bot => ownClicks(bot).size === 0 && clicksInFlight(bot) === 0
/** Wait, bounded, for every click to settle -> true when they have. Cancellation ends the wait. */
async function waitClicks (bot, ms, cancelled = () => false) {
  const until = Date.now() + Math.max(0, ms)
  while (!clicksSettled(bot)) {
    if (cancelled() || Date.now() >= until) return false
    await sleep(25)
  }
  return true
}

/**
 * A FREE SLOT FOR THE CURSOR, MADE BY BANKING (F) -> the bag stack to shift-click into the container, or null. Only a
 * stack deposit itself would bank whole (roomCandidates: never junk, never a tool, never `keep`), and only into
 * COMPATIBLE capacity the container already has (partial stacks of the same item take all of it -- no arbitrary swaps).
 */
function rearrangeFor (win, keep) {
  const inChest = win.containerItems?.() ?? []
  for (const c of roomCandidates(win.items?.() ?? [], { keep })) {
    if (allocate(inChest, c.name, c.count, { emptySlots: 0 }).leftover === 0) return c
  }
  return null
}

/**
 * AN EMPTY CURSOR, WITH THE SERVER'S WORD FOR IT -> { state: 'empty' | 'rescued' | 'unresolved' | 'gone' | 'cancelled',
 * why, noCapacity }. Rules (Codex and Claude, rounds 2-3):
 *   A  no click while ANY click is still in flight -- ours or craftsync's underlying one past its cap -- and none after
 *      the budget: an unsettled click is unresolved, never "done";
 *   C  the end is the SERVER's evidence (craftsync confirmCursor: a no-op clone click answered by the window's full state)
 *      -- a quiet window or a local empty cursor is not confirmation; no evidence is unresolved;
 *   E  no click unless the open window is still this one (a chest-layout slot is never clicked into another window);
 *   F  with no slot for the cursor anywhere, one bounded rearrangement: a bankable bag stack into compatible capacity.
 * Destinations: a compatible partial stack or an empty slot of the BAG, then of the CONTAINER, never a slot holding
 * something else. Every click in craftsync's lockstep.
 */
async function settleCursor (bot, win, { budgetMs = CURSOR_SETTLE_MS, cancelled = () => false, keep = null } = {}) {
  const until = Date.now() + budgetMs
  const left = () => until - Date.now()
  const here = () => bot.currentWindow === win
  const verdict = (state, why = null, extra = {}) => ({ state, why, noCapacity: false, ...extra })
  let acted = false, rearranged = false, probedForRoom = false
  for (let i = 0; i < 8; i++) {
    if (cancelled()) return verdict('cancelled')
    if (!here()) return verdict('gone', 'the window is no longer open')
    if (!(await waitClicks(bot, left(), cancelled))) return verdict(cancelled() ? 'cancelled' : 'unresolved', 'a click is still in flight')
    if (cancelled()) return verdict('cancelled')
    if (!here()) return verdict('gone', 'the window is no longer open')
    if (!win.selectedItem) break
    if (left() <= 0) return verdict('unresolved', 'the recovery ran out of time')
    const held = win.selectedItem
    const partial = (a, b) => (held.maxDurability ? null : win.findItemRange?.(a, b, held.type, held.metadata ?? null, true, held.nbt ?? null))
    const fits = it => it && it.count < (it.stackSize ?? 64)
    const p1 = partial(win.inventoryStart, win.inventoryEnd)
    let dest = fits(p1) ? p1.slot : win.firstEmptySlotRange?.(win.inventoryStart, win.inventoryEnd)
    if (dest == null) { const p2 = partial(0, win.inventoryStart); dest = fits(p2) ? p2.slot : win.firstEmptySlotRange?.(0, win.inventoryStart) }
    let click = [dest, 0, 0]
    if (dest == null) {
      const r = !rearranged && rearrangeFor(win, keep ?? roomKeep(bot.currentWants ?? []))
      if (!r) {
        // THE SERVER'S CURSOR FIRST (Codex round 4): a ghost local cursor must not lock a bot whose server cursor is
        // empty. Once per settle: the answer either ends it (empty) or becomes the local cursor for one more pass.
        if (!probedForRoom) {
          probedForRoom = true
          const ev = await confirmCursor(bot, win, { deadline: Date.now() + Math.max(250, Math.min(1500, left())), cancelled })
          if (cancelled()) return verdict('cancelled')
          if (ev.answered && ev.cursorEmpty) return verdict(acted ? 'rescued' : 'empty')
          if (ev.answered && !ev.decodeFailed) continue
        }
        return verdict('unresolved', `no slot anywhere for ${win.selectedItem?.count ?? '?'}x ${win.selectedItem?.name ?? '?'}`, { noCapacity: true })
      }
      const it = (win.items?.() ?? []).find(x => x?.name === r.name && (x.count ?? 0) === r.count)
      if (!it) return verdict('unresolved', `the ${r.name} stack to bank is gone`, { noCapacity: true })
      click = [it.slot, 0, 1]
      rearranged = true
    }
    try {
      await lockstepClicks(bot, async raw => {
        if (cancelled() || !here()) throw stop('cancelled or the window changed')
        const p = trackedClick(bot, raw, ...click)
        p.catch(() => {})
        // Bounded wait only: an unanswered click is caught by the in-flight check at the top of the next pass (A), which
        // also refuses any further click until it settles.
        await within(p, left())
      }, { deadline: until })
    } catch (e) {
      if (cancelled()) return verdict('cancelled')
      if (!clicksSettled(bot)) return verdict('unresolved', String(e?.message ?? e).slice(0, 80))
    }
    acted = true
  }
  if (cancelled()) return verdict('cancelled')
  if (!here()) return verdict('gone', 'the window is no longer open')
  if (!(await waitClicks(bot, left(), cancelled))) return verdict('unresolved', 'a click is still in flight')
  // C: THE SERVER'S WORD. Without it, unresolved; with a loaded cursor in it, unresolved (and the local cursor now
  // says so, for the next attempt).
  const ev = await confirmCursor(bot, win, { deadline: Date.now() + Math.max(250, Math.min(1500, left())), cancelled })
  if (cancelled()) return verdict('cancelled')
  if (!ev.answered) return verdict('unresolved', `no server evidence of an empty cursor (${ev.why})`)
  if (ev.decodeFailed) return verdict('unresolved', 'the server\'s cursor item could not be decoded')
  if (!ev.cursorEmpty) return verdict('unresolved', `the server says the cursor holds ${ev.carried?.itemCount ?? '?'} item(s)`)
  return verdict(acted ? 'rescued' : 'empty')
}

/**
 * INVENTORY OWNERSHIP (I; Codex round 4) -> { close(), restore() }. From the window's open to its close -- or through
 * the hold to the hold's end -- equip / unequip / moveSlotItem / toss / tossStack / closeWindow and the window's own
 * close() refuse: a reflex's equip racing the cursor probe would make the server's evidence stale before it is used.
 * Only `close()` here closes; `restore()` puts back exactly what is still ours (a lockstep layered on top restores its
 * own wrappers first).
 */
const GUARDED = ['equip', 'unequip', 'moveSlotItem', 'toss', 'tossStack', 'closeWindow']
function ownInventory (bot, win) {
  const orig = {}, mine = {}
  let restored = false
  // A guard that outlives its restore PASSES THROUGH (round 5): a release during a lockstep finds craftsync's wrappers
  // layered on top of these, so restore() cannot unhook them, and the lockstep's own restore later puts THESE back.
  // Without the pass-through, equip would stay refused for good after a survival release.
  const refuse = name => async function (...args) {
    if (restored) return orig[name].apply(bot, args)
    throw Object.assign(new Error(`inventory held: a withdraw owns the inventory (${name} refused)`), { inventoryHeld: true })
  }
  for (const k of GUARDED) if (typeof bot[k] === 'function') { orig[k] = bot[k]; bot[k] = mine[k] = refuse(k) }
  const origClose = win.close?.bind(win)
  const lockedClose = (...args) => {
    if (restored) return origClose?.(...args)
    throw Object.assign(new Error('inventory held: the window may not close while a withdraw owns it'), { inventoryHeld: true })
  }
  win.close = lockedClose
  return {
    close () { try { origClose?.() } catch { /* already closed */ } },
    restore () {
      if (restored) return
      restored = true
      for (const k of Object.keys(orig)) if (bot[k] === mine[k]) bot[k] = orig[k]
      if (win.close === lockedClose) win.close = origClose
    },
  }
}
/** Never-banked junk the junkswap mode may drop instead of the cursor (N): a literal list -- never a tool, food, ore,
 *  ingot, log, plank or stick, nor anything withdraw or a craft needs (bamboo makes sticks, so it is not here). */
export const JUNKSWAP_ITEMS = new Set(['leaf_litter', 'dead_bush', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'seagrass', 'vine',
  'poppy', 'dandelion', 'pointed_dripstone', 'rail', 'egg', 'brown_egg', 'blue_egg', 'ink_sac', 'glow_ink_sac',
  'wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds'])
/** The junkswap (N): the cursor onto a junk bag slot, confirmed by the server, so only the junk drops at the close. */
async function junkSwap (bot, win, cancelled) {
  if (!(await waitClicks(bot, 2_000, cancelled))) return { ok: false, why: 'a click is in flight' }
  const held = win.selectedItem
  const j = (win.items?.() ?? []).find(x => x && JUNKSWAP_ITEMS.has(x.name) && x.name !== held?.name)
  if (!held || !j) return { ok: false, why: 'no junk slot to trade the cursor onto' }
  try {
    await lockstepClicks(bot, async raw => {
      if (cancelled() || bot.currentWindow !== win) throw stop('cancelled or the window changed')
      const p = trackedClick(bot, raw, j.slot, 0, 0)
      p.catch(() => {})
      await within(p, 2_000)
    }, { deadline: Date.now() + 3_000 })
  } catch { /* judged below by the server */ }
  if (!(await waitClicks(bot, 2_000, cancelled))) return { ok: false, why: 'the trade click is in flight' }
  const ev = await confirmCursor(bot, win, { cancelled })
  if (!ev.answered || ev.decodeFailed || ev.cursorEmpty || !JUNKSWAP_ITEMS.has(win.selectedItem?.name)) {
    return { ok: false, why: 'the server does not confirm junk on the cursor' }
  }
  return { ok: true, junk: `${win.selectedItem.name}:${win.selectedItem.count ?? 1}` }
}

/**
 * THE UNRESOLVED HANDOFF (Codex and Claude, rounds 2-4). A cursor that could not be emptied with the server's word for
 * it is never closed on: a close with a loaded cursor drops it unless the bag has room. The hold takes over the visit's
 * inventory ownership (ownInventory). While held:
 *   B/H  a survival reflex calls bot.inventoryUnsettled.release('reflex:<name>'): the window CLOSES AT ONCE -- no settle,
 *        no recount first; a loaded stack is never worth a death. Then every in-flight click is INVALIDATED (craftsync
 *        drops its send: a late click must not land in window 0 or a replacement window -- round 5, Codex P1), and the
 *        inventory is unlocked at once, so the reflex can equip and eat. The retry stops (it checks `done` after every
 *        await); the row is written afterwards, with the server's recount (drain_timeout logged if clicks outlive
 *        drainMs). Nothing here re-issues a click.
 *   D    every retry hears cancellation after every await and before every click; the end listener is removed.
 *   E    the SERVER closing the window (moved away, chest broken, death) ends the hold: how=server_closed.
 *   L    ANY hold older than interventionMs raises intervention_needed (and a no-capacity hold at once), every interval.
 *   N    a no-capacity hold older than loadedMs applies loadedMode(): hold (default) | close | junkswap.
 * Rows: `_withdraw_settled` how=settled | released | server_closed | intervention_needed | closed_loaded | junkswapped |
 * disconnected | drain_timeout. srv=bag=N is the server's recount (the truth); carried_local= is the client's view.
 */
function holdUnsettled (bot, win, u, own) {
  const since = Date.now()
  let busy = false, done = false, lastIntervention = 0
  const carriedLocal = () => (win.selectedItem ? `${win.selectedItem.name}:${win.selectedItem.count ?? 1}` : '-')
  const writeRow = (how, status, recount, held, extra = '') => {
    ;(async () => {
      let srv = '-'
      if (recount) {
        try { const r = await serverRecount(bot, { deadline: Date.now() + RECOUNT_MS }); srv = r?.source === 'server' ? `bag=${bagTotal(r.items)}` : r?.source } catch { srv = 'error' }
      }
      logEvent({ kind: 'withdraw_settled', status, snapshot: snapshot(bot),
                 detail: `how=${how} after_ms=${Date.now() - since} srv=${srv} carried_local=${held}${extra} why=${String(u.why ?? '').replace(/\s+/g, '_').slice(0, 80)}` })
    })().catch(() => {})
  }
  const onEnd = () => { finish('disconnected', { close: false }) }
  // THE END, at once (round 5, Codex P1): close -> invalidate every in-flight click (craftsync drops its send, so
  // nothing stale can land in this window, window 0 or a later one) -> unlock -> then, async, the recount and the row.
  // A survival reflex reaches equip/consume the moment release() returns.
  function finish (how, { close = true, extra = '' } = {}) {
    if (done) return
    done = true
    clearInterval(iv)
    bot.removeListener?.('end', onEnd)
    const held = carriedLocal()   // the client's view as the hold ended -- read BEFORE the close
    if (close && bot.currentWindow === win) own.close()
    invalidateClicks(bot, `withdraw ${how}`)
    own.restore()
    bot.inventoryUnsettled = null
    ;(async () => {
      // The recount waits (bounded) for the invalidated clicks to settle, so it counts what the server holds after them.
      if (!(await waitClicks(bot, HOLD_TIMING.drainMs))) {
        logEvent({ kind: 'withdraw_settled', status: 'failed', snapshot: snapshot(bot),
                   detail: `how=drain_timeout after_ms=${Date.now() - since} a click was still in flight ${HOLD_TIMING.drainMs} ms after the close (invalidated: its send is dropped)` })
      }
      writeRow(how, how === 'settled' ? 'success' : 'no_effect', how !== 'disconnected', held, extra)
    })().catch(() => {})
  }
  const tick = async () => {
    if (done) return
    if (clientEnded(bot)) return finish('disconnected', { close: false })
    const s = await settleCursor(bot, win, { cancelled: () => done })   // 'gone' first if the server closed the window
    if (done) return
    if (clientEnded(bot)) return finish('disconnected', { close: false })
    if (s.state === 'gone') return finish('server_closed', { close: false })
    if (s.state === 'empty' || s.state === 'rescued') return finish('settled')
    u = { ...u, why: s.why }
    const age = Date.now() - since
    if (s.noCapacity && age >= HOLD_TIMING.loadedMs) {
      const mode = loadedMode()
      if (mode === 'close') return finish('closed_loaded')
      if (mode === 'junkswap') {
        const j = await junkSwap(bot, win, () => done)
        if (done) return
        if (j.ok) return finish('junkswapped', { extra: ` dropped=${j.junk}` })
        u = { ...u, why: j.why }
      }
    }
    if ((s.noCapacity || age >= HOLD_TIMING.interventionMs) && Date.now() - lastIntervention >= HOLD_TIMING.interventionMs) {
      lastIntervention = Date.now()
      if (bot.inventoryUnsettled) bot.inventoryUnsettled.interventionNeeded = true
      writeRow('intervention_needed', 'failed', false, carriedLocal())
    }
  }
  const iv = setInterval(() => {
    if (busy || done) return
    busy = true
    tick().catch(() => {}).finally(() => { busy = false })
  }, 1_000)
  iv.unref?.()
  bot.once?.('end', onEnd)
  bot.inventoryUnsettled = {
    since, why: u.why, interventionNeeded: false,
    stop: () => finish('stopped', { close: false }),
    // A SURVIVAL REFLEX FIRST (H): close now, whatever the cursor holds; nothing is awaited before the reflex runs.
    release: (reason = 'reflex') => {
      if (done) return Promise.resolve()
      u = { ...u, why: `released by ${reason}` }
      finish('released')
      return Promise.resolve()
    },
  }
  // ALREADY GONE (round 7, Paper-proven): a hold that begins after the connection ended never hears its 'end' (it fired
  // before the listener existed) -- it probed a dead client every 2 s and wrote intervention_needed every minute, for
  // good. Checked here, at the start, and on every tick.
  if (clientEnded(bot)) finish('disconnected', { close: false })
}
/** Has this bot's connection ended? node-minecraft-protocol sets `ended`; a destroyed socket says the same. */
export const clientEnded = bot => bot?._client?.ended === true || bot?._client?.socket?.destroyed === true

/** A click on a chest slot whose content must still be what the plan saw (name and wear): the source is revalidated
 *  after every earlier click (Codex), and a mismatch stops the transfer. */
const liveSource = (win, src) => {
  const it = (win.containerItems?.() ?? []).find(x => x?.slot === src.slot)
  return !!it && it.name === src.name && (src.used == null || (it.durabilityUsed ?? 0) === src.used) && (src.count == null || (it.count ?? 0) >= 1)
}
const stop = why => Object.assign(new Error(why), { transferStop: true })
/** The window slot of hotbar index 0 (prismarine-windows sets hotbarStart; a test double may not). */
const hotbarStartOf = win => win.hotbarStart ?? ((win.inventoryEnd ?? 0) - 9)
/** The hotbar index a trade goes through: not the one held (that would change what the bot holds mid-visit). */
const tradeHotbarIndex = bot => { const held = bot.quickBarSlot ?? 0; return held === 8 ? 7 : 8 }
/** A window slot's item (prismarine-windows keeps them in `slots`; a test double may only offer `get`). */
const slotAt = (win, s) => (typeof win.get === 'function' ? win.get(s) : win.slots?.[s]) ?? null

/**
 * THE TRANSFER, inside ONE open window, all in craftsync's lockstep -> { took, gave, tool, cursor, err }.
 *   deposit  whole bag stacks shift-clicked into the chest (only when the chest has room for them -- planned)
 *   swap     { name, count }: with the chest FULL and the bag full, the bag stack and the tool trade places by NUMBER-KEY
 *            SWAPS (mode 2), never through the cursor (round 7: Paper drops whatever the cursor holds on a disconnect,
 *            room or not -- a kick after the old 3-click trade's first click dropped 64 stone, 2/2): a stack already on
 *            the hotbar trades in ONE click (chest slot <-> hotbar slot); otherwise one bag<->hotbar swap brings it there
 *            first. Every click is a pure exchange of two slots, so the totals are conserved click by click.
 *            (Claude: 228 of 375 town chests are full, so this is what makes a full bag work at all.)
 *   tool     shift-click of its chest slot (no cursor stack)
 *   takes    [{ name, count }]: per source stack -- a WHOLE source stack by shift-click (no cursor); a PART by the
 *            cursor, which is unavoidable: picked up (right-click: only HALF the stack, when that is enough), verified,
 *            placed into the slots allocate() names (one left-click when the cursor holds exactly what one slot takes,
 *            else one at a time), and the rest put back. That cursor window is the remaining disconnect exposure.
 * EVERY EXIT settles the cursor first (both reviews): an abort is rescued and rethrown; any other error ends the
 * transfer and is returned with what moved. Sources are captured before their clicks (prismarine-windows rewrites
 * `.slot` on the moved object) and revalidated after the room-making clicks.
 */
async function transferIn (bot, win, { deposit = [], swap = null, tool = null, takes = [] }, { deadline, signal }) {
  const took = {}, gave = {}
  let toolTaken = null, err = null
  try {
    await lockstepClicks(bot, async raw => {
      // EVERY CLICK hears the cancel (craftsync's lockstep refuses one after an abort; this says so without it too).
      const click = (...a) => { check(signal); return raw(...a) }
      for (const d of deposit) {
        check(signal)
        const it = (win.items?.() ?? []).find(x => x?.name === d.name && (x.count ?? 0) === d.count)
        if (!it) throw stop(`the ${d.name} stack to bank is gone`)
        await click(it.slot, 0, 1)
        gave[d.name] = (gave[d.name] ?? 0) + d.count
      }
      if (tool) {
        check(signal)
        const src = { slot: tool.slot, name: tool.name, used: tool.durabilityUsed ?? 0, left: remaining(tool) }
        if (!liveSource(win, src)) throw stop(`the ${tool.name} at chest slot ${src.slot} changed`)
        if (swap) {
          const hb = hotbarStartOf(win)
          const onHotbar = x => x.slot >= hb && x.slot < hb + 9
          const stacks = (win.items?.() ?? []).filter(x => x?.name === swap.name && (x.count ?? 0) === swap.count)
          if (!stacks.length) throw stop(`the ${swap.name} stack to trade is gone`)
          const it = stacks.find(onHotbar) ?? stacks[0]
          let h = it.slot - hb
          if (!onHotbar(it)) {
            // ONTO THE HOTBAR FIRST: a bag<->hotbar number-key swap -- two bag stacks change places, nothing is carried.
            h = tradeHotbarIndex(bot)
            await click(it.slot, h, 2)
            const there = slotAt(win, hb + h)
            if (there?.name !== swap.name || (there.count ?? 0) !== swap.count) throw stop(`the ${swap.name} stack did not reach hotbar ${h}`)
          }
          // THE SOURCE AGAIN, RIGHT BEFORE THE TRADE (Codex round 2): a pickaxe replaced meanwhile must not be traded for.
          // Nothing is carried, so stopping here leaves nothing to put back.
          if (!liveSource(win, src)) throw stop(`the ${tool.name} at chest slot ${src.slot} changed during the trade`)
          await click(src.slot, h, 2)   // chest slot <-> hotbar h: the tool comes down, the stack goes up, in one swap
          const got = slotAt(win, hb + h)
          if (got?.name !== src.name || (got.durabilityUsed ?? 0) !== src.used) throw stop(`the trade brought down ${got?.name ?? 'nothing'}`)
          gave[swap.name] = (gave[swap.name] ?? 0) + swap.count
        } else {
          if (win.firstEmptySlotRange?.(win.inventoryStart, win.inventoryEnd) == null) throw stop('no empty bag slot for the tool')
          await click(src.slot, 0, 1)
        }
        toolTaken = src
      }
      for (const take of takes) {
        let left = take.count
        const sources = (win.containerItems?.() ?? []).filter(x => x?.name === take.name)
          .map(x => ({ slot: x.slot, name: x.name, count: x.count ?? 0 })).sort((a, b) => b.count - a.count)
        for (const src of sources) {
          if (left <= 0) break
          check(signal)
          if (!liveSource(win, src)) continue
          // THE LIVE COUNT, NOT THE SNAPSHOT'S (Codex round 8): a source refilled since the plan read it (8 -> 64) must not
          // be shift-clicked whole on the old count -- that took 72 for a need of 10. Everything below uses `have`.
          const live = slotAt(win, src.slot)
          const have = live?.name === take.name ? (live.count ?? 0) : 0
          if (have <= 0) continue
          const empties = []
          for (let s = win.inventoryStart; s < win.inventoryEnd; s++) if (!slotAt(win, s)) empties.push(s)
          const want = Math.min(left, have)
          const a = allocate(win.items?.() ?? [], take.name, want, { emptySlots: empties.length })
          const m = want - a.leftover
          if (m <= 0) break
          if (m === have) {
            // A WHOLE SOURCE STACK (its live count is no more than the need, and it all fits): shift-click, so the cursor is
            // never loaded. It counts only what actually left the slot.
            await click(src.slot, 0, 1)
            const rest = slotAt(win, src.slot)
            const moved = have - (rest?.name === take.name ? (rest.count ?? 0) : 0)
            took[take.name] = (took[take.name] ?? 0) + moved
            left -= moved
            if (moved < m) throw stop(`only ${moved} of the ${m} ${take.name} moved`)
            continue
          }
          // A PART OF A STACK needs the cursor. As little as possible on it, for as few clicks as possible: a right-click
          // picks up HALF (rounded up) when that covers m; the exact amount goes in with ONE left-click when one slot
          // takes it all; otherwise one at a time.
          const half = Math.ceil(have / 2)
          await click(src.slot, m <= half ? 1 : 0, 0)
          if (win.selectedItem?.name !== take.name) throw stop(`picked up ${win.selectedItem?.name ?? 'nothing'}, not ${take.name}`)
          let placed = 0
          const one = (win.selectedItem.count ?? 0) === m
            ? (a.fresh === 0 && a.partial.length === 1 && a.partial[0].n === m ? a.partial[0].slot : (a.partial.length === 0 && a.fresh >= 1 ? empties[0] : null))
            : null
          // EVERY DESTINATION AGAIN, before its click (round 7): an auto-pickup can fill a planned slot after the pickup, and
          // a blind click there would swap stacks. Taken -> stop; the settle puts the cursor back or holds it.
          const into = async (slot, button) => {
            const x = slotAt(win, slot)
            if (x && (x.name !== take.name || (x.count ?? 0) >= 64)) throw stop(`bag slot ${slot} was filled before the ${take.name} could go in`)
            await click(slot, button, 0)
          }
          if (one != null) { await into(one, 0); placed = m }
          for (const p of a.partial) for (let i = 0; i < p.n && placed < m; i++) { await into(p.slot, 1); placed++ }
          for (let f = 0; f < a.fresh; f++) for (let i = 0; i < 64 && placed < m; i++) { await into(empties[f], 1); placed++ }
          if (win.selectedItem) await click(src.slot, 0, 0)   // the rest back where it came from
          took[take.name] = (took[take.name] ?? 0) + m
          left -= m
        }
      }
    }, { deadline, signal })
  } catch (e) {
    err = e
  }
  // EVERY EXIT: an empty cursor, synchronised, before the caller closes the window -- or the unresolved handoff.
  const settled = await settleCursor(bot, win)
  const bad = settled.state !== 'empty' && settled.state !== 'rescued'
  const state = { took, gave, tool: toolTaken, cursor: bad ? `${settled.state}:${settled.why}` : settled.state,
                  unresolved: settled.state === 'unresolved' ? settled : null, err: err ? String(err.message ?? err).slice(0, 80) : null }
  // AN ABORT CARRIES WHAT HAPPENED (Claude round 2), so both verbs' rows report THIS transfer, not an earlier visit.
  if (err && (err.aborted || signal?.aborted)) { err.withdrawState = state; throw err }
  return state
}

/**
 * ONE VISIT: reach, read the server's bag, open, look, maybe act, close, verify -> { result, saw, double, diag }.
 *   decide(containerItems, bagItems, { chestEmpty }) -> null (nothing to do here) | { noRoom } | { skip: failClass } |
 *                                                       { deposit, swap, tool, takes }
 * `result` is null when the container had nothing to act on (`saw` is what it held). `diag` carries the row's fields.
 */
async function withdrawVisit (ctx, chestBlock, decide, signal, msLeft, deadline) {
  const { bot } = ctx
  const cp = chestBlock.position
  const diag = { verification: '-', cursor: '-', err: null, chestRoom: null, srv: '-' }
  try {
    // chestfull-02's walk: never watches digs, and a clock that ends it clears only its own goal.
    await chestWalk(bot, new goals.GoalNear(cp.x, cp.y, cp.z, 2), Math.max(1, msLeft(WITHDRAW_WALK_MS)))
    // A RESOLVED WALK IS NOT AN ARRIVAL (chestfull-02's check): an empty path resolves where the bot stands.
    const d = eyeToBlock(bot.entity.position, cp)
    if (!(d <= OPEN_REACH)) throw Object.assign(new Error(`No path to the goal! (the walk ended ${Math.round(d * 10) / 10} blocks from the chest)`), { failClass: 'no_path' })
  } catch (e) {
    if (e?.aborted || signal?.aborted) throw e
    // ...and its backoff: a real travel failure to a chest OUTSIDE town hides it from this bot for a while (a town chest
    // is never hidden -- withdraw strikes nothing in the town's memory).
    if (backsOffTarget({ kind: walkFailure(e), targetInTown: inTown(homeVec(), cp) })) {
      bot.withdrawTravelBackoff ??= new Map()
      bot.withdrawTravelBackoff.set(posKey(cp), Date.now() + TARGET_BACKOFF_MS)
    }
    // NOT no_path (bank-fix, Claude review): every visit reaches for the same town chests, and no_path votes against the
    // verb with no position in the key. It is a fact about this chest, with no vote.
    return { result: { status: 'failed', failClass: 'chest_unreachable', detail: `could not reach the chest at ${cp.x},${cp.y},${cp.z}` }, diag }
  }
  check(signal)
  const before = await recountBag(bot, msLeft)
  diag.verification = before.source
  const opened = await openForWithdraw(bot, chestBlock, signal, msLeft)
  if (opened.fail) return { result: opened.fail, diag }
  const win = opened.chest
  const double = (win.inventoryStart ?? 27) >= 54
  let saw = [], plan = null, moved = null, unresolved = null
  // OWNED FROM THE OPEN TO THE CLOSE OR THE HOLD (I): nothing else touches the inventory while this visit has the window.
  const own = ownInventory(bot, win)
  try {
    saw = (win.containerItems?.() ?? []).map(it => ({ name: it.name, count: it.count ?? 0, slot: it.slot,
                                                      durabilityUsed: it.durabilityUsed ?? 0, maxDurability: it.maxDurability }))
    const chestEmpty = Math.max(0, (win.inventoryStart ?? 27) - saw.length)
    diag.chestRoom = chestEmpty
    plan = decide(win.containerItems?.() ?? [], bot.inventory.items(), { chestEmpty })
    if (plan?.noRoom) return { result: plan.noRoom, double, saw, diag }
    if (plan?.skip) return { result: null, skip: plan.skip, double, saw, diag }
    // NO SERVER BASELINE, NO TRANSFER (Codex; Claude: it is not a failure of the town -- nothing moved).
    if (plan && before.source !== 'server') {
      return { result: { status: 'failed', failClass: 'recount_unanswered',
                         detail: `nothing taken from the chest at ${cp.x},${cp.y},${cp.z}: the server's bag could not be read first (${before.source})` }, double, saw, diag }
    }
    diag.plan = [...(plan?.deposit ?? []).map(d => d.name), ...(plan?.swap ? [plan.swap.name] : [])].join(',') || '-'
    if (plan) { moved = await transferIn(bot, win, plan, { deadline, signal }); unresolved = moved.unresolved }
  } catch (e) {
    if (e?.withdrawState) {
      unresolved = e.withdrawState.unresolved
      e.withdrawDiag = { ...diag, cursor: e.withdrawState.cursor, err: 'aborted', srv: '-' }
    }
    throw e
  } finally {
    // NEVER A LOADED CLOSE: an unresolved cursor keeps the window open until it settles (holdUnsettled, which takes the
    // ownership over). Otherwise the close, then the ownership once every click has settled (bounded).
    if (unresolved) holdUnsettled(bot, win, unresolved, own)
    else {
      own.close()
      invalidateClicks(bot, 'withdraw visit end')   // a late click is dropped at its send, so the unlock need not wait
      own.restore()
    }
  }
  if (!plan) return { result: null, double, saw, diag }
  diag.cursor = moved.cursor; diag.err = moved.err
  if (unresolved) {
    return { result: { status: 'failed', failClass: 'transfer_unsettled',
                       detail: `the cursor at the chest at ${cp.x},${cp.y},${cp.z} could not be emptied (${unresolved.why}); the window is held open until it is` },
             double, saw, moved, diag }
  }
  const after = await recountBag(bot, msLeft)
  diag.verification = after.source === 'server' ? 'server' : `after:${after.source}`
  if (after.bag) diag.srv = bagDelta(before.bag, after.bag)
  let verdict = after.source === 'server'
    ? transferVerdict({ before: before.bag, after: after.bag, took: moved.took, gave: moved.gave, tool: moved.tool })
    : { ok: false, why: `the server's bag could not be read after the transfer (${after.source})` }
  if (moved.err) verdict = { ok: false, why: `the transfer stopped: ${moved.err}` }
  if (moved.cursor !== 'empty') verdict = { ok: false, why: `the cursor ${moved.cursor === 'rescued' ? 'had to be rescued' : `kept a stack (${moved.cursor})`}` }
  // WHAT WAS TAKEN IS HELD BACK FROM DEPOSIT (bankable.mjs), verified or not: an unsettled take may still have landed.
  const until = Date.now() + HOLD_MS
  for (const [name, n] of Object.entries(moved.took)) setWithdrawHold(name, n, until)
  if (moved.tool) setWithdrawHold(moved.tool.name, 1, until)
  const nothing = !moved.tool && !Object.keys(moved.took).length
  const what = moved.tool ? `1x ${moved.tool.name} with ${Number.isFinite(moved.tool.left) ? moved.tool.left : '?'} uses left`
    : Object.entries(moved.took).map(([k, n]) => `${n}x ${k}`).join(', ')
  const gaveS = Object.entries(moved.gave).map(([k, n]) => `${n}x ${k}`).join(', ')
  const result = !verdict.ok
    ? { status: 'failed', failClass: 'transfer_unsettled',
        detail: `the transfer at the chest at ${cp.x},${cp.y},${cp.z} could not be confirmed: ${verdict.why}; stopped until the bag settles` }
    : nothing
      ? { status: 'failed', failClass: 'inventory_full', detail: `no room in the bag at the chest at ${cp.x},${cp.y},${cp.z}: nothing could be taken` }
      : { status: 'success', detail: `withdrew ${what} from the chest at ${cp.x},${cp.y},${cp.z}${gaveS ? ` (${moved.tool && plan.swap ? 'traded' : 'banked'} ${gaveS} to make room)` : ''}` }
  return { result, double, saw, moved, diag }
}

/** The containers to look in: nearest first, a double chest's other half never counted twice, none the town's memory
 *  knows is unusable or has a blocked lid (chestfull.mjs containerStatus), and -- for a pickaxe -- none that showed no
 *  usable copy in the last 15 min and has taken nothing since (per container: both reviews). */
function withdrawSweep (bot, { pick = false, town = false } = {}) {
  const isContainer = b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry.blocks[b.type]?.name)
  const tried = new Set()
  let mem = {}
  try { mem = readTownMemory(townDir(), homeTownKey(), bot.worldId ?? null) } catch { mem = {} }
  const home = homeVec()
  const shut = q => { const st = containerStatus(mem[posKey(q)]); return st === 'unusable' || st === 'unavailable' }
  const skip = q => shut(q) || (pick && containerPickMiss(mem, posKey(q)))
  // WHERE (chestfull-02's boundary): the town order looks only at TOWN containers -- inTown, searched around HOME with
  // the deposit's TOWN_SCAN_RADIUS, the same set its misses are judged over; the model's verb at any container in reach
  // that is not DEEP (depositTargetOk). Never a container WITHDRAW backed off after a failed walk outside town -- its own
  // map: the deposit's skipContainers also holds 30-min "this chest is FULL" entries, and a full chest is exactly where a
  // withdraw is worth making (Codex on e897d44).
  const backedOff = q => { const u = bot.withdrawTravelBackoff?.get?.(posKey(q)); return !!u && u > Date.now() }
  const where = q => (town ? inTown(home, q) : depositTargetOk(home, q)) && !backedOff(q)
  const search = (radius, ok) => bot.findBlock({ ...(town ? { point: home, maxDistance: TOWN_SCAN_RADIUS } : { maxDistance: radius }),
    matching: b => isContainer(b) && (!b.position || (!tried.has(posKey(b.position)) && where(b.position) && ok(b.position))) })
  return {
    next (radius) { return search(radius, q => !skip(q)) },
    any (radius) { return search(radius, q => !shut(q)) },   // misses included (the ingredients pass needs one)
    mark (q, double) {
      tried.add(posKey(q))
      if (double) { const p = chestPartner(bot, q); if (p) tried.add(posKey(p)) }
    },
    halves (q, double) { const p = double ? chestPartner(bot, q) : null; return p ? [posKey(q), posKey(p)] : [posKey(q)] },
  }
}

/** The watchdog's clock for a withdraw (config.skills.defaultTimeoutMs from the skill's start), as deposit keeps it. */
function withdrawClock (ctx) {
  const startedAt = ctx.runner?.current?.startedAt ?? Date.now()
  const deadline = startedAt + config.skills.defaultTimeoutMs
  return { deadline, msLeft: cap => Math.max(0, Math.min(cap, deadline - Date.now())) }
}

/**
 * THE TOOL DECISION, shared by both verbs -> null | { noRoom } | { tool, deposit? , swap? }. Pure over its inputs.
 * An empty bag slot: take it. Else one stack must leave (roomPlan, cheapest first, never kept): into the chest when it
 * has room for it, else a SWAP into the tool's own chest slot.
 */
function decideTool (copies, inChest, bag, chestEmpty, keep) {
  const best = bestToolCopy(copies)
  if (!best) return null
  const room = roomPlan(bag, [{ tool: true, name: best.name }], { keep })
  if (!room.ok) return { noRoom: noRoomResult(best.name) }
  if (!room.deposit.length) return { tool: best }
  const d = room.deposit[0]
  const fits = allocate(inChest, d.name, d.count, { emptySlots: chestEmpty }).leftover === 0
  return fits ? { deposit: [d], tool: best } : { swap: d, tool: best }
}
/** THE INGREDIENTS DECISION -> null | { noRoom } | { skip: 'chest_no_room' } | { deposit, takes }. Room-making stacks go
 *  into the chest only when it has room for all of them; a full chest is skipped, with no backoff. */
function decideTakes (takes, inChest, bag, chestEmpty, keep) {
  if (!takes.length) return null
  const room = roomPlan(bag, takes, { keep })
  if (!room.ok) return { noRoom: noRoomResult(takes.map(t => t.name).join(' and ')) }
  let empty = chestEmpty
  const sim = inChest.map(it => ({ name: it.name, count: it.count ?? 0, slot: it.slot }))
  for (const d of room.deposit) {
    const a = allocate(sim, d.name, d.count, { emptySlots: empty })
    if (a.leftover) return { skip: 'chest_no_room' }
    empty -= a.fresh
  }
  return { deposit: room.deposit, takes }
}
/** No room, and nothing deposit would bank can make it: said plainly, with no remedy that cannot be performed. */
const noRoomResult = name => ({ status: 'failed', failClass: 'inventory_full',
  detail: `no room for ${name}: the bag is full and nothing in it is banked by a deposit to make room -- keep working; spent tools and compostable junk are cleared at town` })
const haveIn = (inChest, name) => inChest.reduce((n, it) => n + (it?.name === name ? (it.count ?? 0) : 0), 0)

/** One `_withdraw_pick` row, from the order or the model's verb. */
function withdrawRowOut (bot, r, fields) {
  logEvent({ kind: 'withdraw_pick', status: r?.status ?? 'failed', snapshot: snapshot(bot), detail: withdrawRow(fields) })
  return r
}
/** THE ROW OF A THROWN VISIT (both reviews, round 2): an abort or error still reports what THIS transfer did -- the
 *  cursor, what moved and what was planned to leave -- from the state transferIn attached, never an earlier visit's. */
function withdrawThrowRow (bot, e, { verb, need, uses = null, bagBefore = 0, tried = [] }) {
  const ws = e?.withdrawState ?? {}, wd = e?.withdrawDiag ?? {}
  withdrawRowOut(bot, { status: 'failed' }, {
    outcome: e?.aborted ? 'aborted' : 'error', need, uses, verification: wd.verification ?? '-', cursor: ws.cursor ?? wd.cursor ?? '-',
    err: String(e?.message ?? e), chestRoom: wd.chestRoom ?? null, plan: wd.plan ?? '-', srv: '-', bagBefore, bagAfter: bagTotal(bot.inventory?.items?.() ?? []),
    deposited: Object.entries(ws.gave ?? {}).map(([name, count]) => ({ name, count })),
    took: { ...(ws.took ?? {}), ...(ws.tool ? { [ws.tool.name]: 1 } : {}) }, verb, tried })
}

/**
 * withdraw <item> [count] -- the model's verb. A NAMED NEED IS REQUIRED (admission refuses it bare; Codex: the old
 * default took the most plentiful item, which is cobblestone). A tool is taken as ONE copy, the best usable one
 * (withdrawpick.mjs bestToolCopy: never a spent copy); anything else up to `count` (at most 64). Writes the same row.
 */
async function withdraw (ctx, args, signal) {
  const rs = { written: false, bagBefore: bagTotal(ctx.bot.inventory?.items?.() ?? []), tried: [], uses: null }
  try {
    return await withdrawVerb(ctx, args ?? {}, signal, rs)
  } catch (e) {
    // THE VERB REPORTS A THROW TOO (Codex round 2: an abort after the pickup wrote no row at all).
    if (!rs.written) withdrawThrowRow(ctx.bot, e, { verb: 'withdraw', need: `${args?.item}:${args?.count ?? 16}`, uses: rs.uses, bagBefore: rs.bagBefore, tried: rs.tried })
    throw e
  }
}
async function withdrawVerb (ctx, { item = null, count = 16 }, signal, rs) {
  if (item == null || ['', 'none', 'null', 'any', 'anything', 'all', 'everything', 'items', 'undefined'].includes(String(item).trim().toLowerCase())) {
    return { status: 'failed', failClass: 'bad_args', detail: 'withdraw needs the item you need, e.g. withdraw stone_pickaxe or withdraw stick 2' }
  }
  const { bot } = ctx
  const { deadline, msLeft } = withdrawClock(ctx)
  const keep = roomKeep(bot.currentWants ?? [])
  const bagBefore = rs.bagBefore
  const tried = rs.tried
  let diag = {}, moved = null, uses = null
  const out = r => (rs.written = true) && withdrawRowOut(bot, r, { outcome: r.status === 'success' ? 'took' : r.failClass ?? r.status, need: `${item}:${count}`, uses, ...diag,
    bagBefore, bagAfter: bagTotal(bot.inventory.items()), deposited: Object.entries(moved?.gave ?? {}).map(([name, c]) => ({ name, count: c })),
    took: { ...(moved?.took ?? {}), ...(moved?.tool ? { [moved.tool.name]: 1 } : {}) }, verb: 'withdraw', tried })
  const decide = (inChest, bag, { chestEmpty }) => {
    if (TOOLISH.test(item)) {
      const p = decideTool(inChest.filter(it => it?.name === item), inChest, bag, chestEmpty, keep)
      if (p?.tool) rs.uses = uses = Number.isFinite(remaining(p.tool)) ? remaining(p.tool) : 'full'
      return p
    }
    const have = haveIn(inChest, item)
    if (!have) return null
    return decideTakes([{ name: item, count: Math.min(have, Math.max(1, Math.min(64, Math.floor(Number(count) || 16)))) }], inChest, bag, chestEmpty, keep)
  }
  const sweep = withdrawSweep(bot)
  let chestBlock = sweep.next(48)
  if (!chestBlock) {
    // deposit's shape: walk home through the rescue path, then RESCAN before judging the walk.
    const walked = await home(ctx, {}, signal)
    check(signal)
    chestBlock = sweep.next(48)
    if (!chestBlock && walked.status === 'failed') return out({ ...walked, detail: `no chest nearby; walking home to the town chest failed: ${walked.detail}` })
  }
  if (!chestBlock) return out({ status: 'failed', failClass: 'nothing_found', detail: 'no chest or barrel within 48 blocks, even at home' })
  const held = []
  let lastFailure = null, noRoom = 0
  for (let n = 0; chestBlock && n < WITHDRAW_CONTAINERS; n++) {
    check(signal)
    const v = await withdrawVisit(ctx, chestBlock, decide, signal, msLeft, deadline - 2_000)
    sweep.mark(chestBlock.position, v.double)
    tried.push(`${posKey(chestBlock.position)}:${v.result?.failClass ?? v.result?.status ?? v.skip ?? (v.moved ? 'acted' : 'none')}`)
    diag = v.diag ?? diag
    if (v.moved) moved = v.moved
    if (v.result?.status === 'success') return out(v.result)
    if (v.result && ['transfer_unsettled', 'inventory_full', 'container_open', 'recount_unanswered'].includes(v.result.failClass)) return out(v.result)
    if (v.skip) noRoom++
    else if (v.result) lastFailure = v.result
    else held.push(`${chestBlock.position.x},${chestBlock.position.z}: ${v.saw.slice().sort((a, b) => b.count - a.count).slice(0, 3).map(i => `${i.count}x ${i.name}`).join(', ') || 'nothing'}`)
    chestBlock = sweep.next(WITHDRAW_ALT_RADIUS)
  }
  if (noRoom && !held.length) return out({ status: 'failed', failClass: 'chest_no_room', detail: `the chest(s) holding ${item} are full, and the bag needs room made first` })
  if (held.length) {
    // Deliberately no "no ... within" in this sentence: state.mjs's prose classifier reads that pair as nothing_found.
    return out({ status: 'failed', failClass: 'container_short',
                 detail: `${item}${TOOLISH.test(item) ? ' (a usable copy)' : ''} is not in the ${held.length} container(s) tried here -- they hold ${held.join('; ').slice(0, 160)}` })
  }
  return out(lastFailure ?? { status: 'failed', failClass: 'other', detail: 'withdraw tried no container' })
}

/** THE TOWN'S CONTAINERS, for coverage -> their keys, or null when the scan may be TRUNCATED. The boundary is inside the
 *  matcher (a scan capped before an inTown filter let 63 deep barrels crowd out a town chest -- Codex on e897d44). */
const TOWN_KEYS_CAP = 256
function townContainerKeys (bot, home, isContainer) {
  const found = bot.findBlocks?.({ point: home, maxDistance: TOWN_SCAN_RADIUS, count: TOWN_KEYS_CAP,
    matching: b => isContainer(b) && (!b.position || inTown(home, b.position)) }) ?? []
  return found.length >= TOWN_KEYS_CAP ? null : found.map(posKey)
}

/** Has every container of the town shown no usable pickaxe recently (per container, COMPLETE coverage)? For townOrder. */
export function townPickMiss (bot) {
  try {
    const home = homeVec()
    const isContainer = b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry.blocks[b.type]?.name)
    const keys = townContainerKeys(bot, home, isContainer)
    if (keys == null) return false   // more town containers than one scan returns: coverage cannot be complete
    return townPickMissComplete(readTownMemory(townDir(), homeTownKey(), bot.worldId ?? null), keys)
  } catch { return false }
}

/** Is the ingredient branch futile here (withdrawpick.mjs townIngredientMissComplete)? Nothing this bag needs for one
 *  stone pickaxe, or every town container recently held none of every need it has. For townOrder. */
export function townIngredientMiss (bot) {
  try {
    const home = homeVec()
    const isContainer = b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry.blocks[b.type]?.name)
    const keys = townContainerKeys(bot, home, isContainer)
    if (keys == null) return false   // more town containers than one scan returns: coverage cannot be complete
    const tableNear = !!bot.findBlock?.({ matching: b => blockNameOf(bot, b) === 'crafting_table', maxDistance: Math.ceil(STATION_REACH) + 1 })
    const needs = stonePickDeficits(bot.inventory.items(), { tableNear }).map(d => d.need)
    return townIngredientMissComplete(readTownMemory(townDir(), homeTownKey(), bot.worldId ?? null), keys, needs)
  } catch { return false }
}

/**
 * withdraw_pick -- the town order (composter.mjs townOrder; chatOnly, housekeeping). The bag holds no usable pickaxe:
 *   1. containers in sight that have not shown "no usable pickaxe" in the last 15 min are looked in, up to three, for
 *      ONE pickaxe -- the best usable copy -- taken where found (room made first: banked into the chest when it has room,
 *      else traded into the pickaxe's own slot); each container that has none is remembered, per container;
 *   2. only if none was found -- or no unvisited container was left -- the deficits for ONE stone pickaxe are taken from
 *      the container that holds most of them (a full chest is skipped, no backoff); the rung's own order crafts it.
 * Never a trip. One `_withdraw_pick` row per order, ALWAYS (an exception writes outcome=error).
 */
async function withdrawPick (ctx, _args, signal) {
  const { bot } = ctx
  const bagBefore = bagTotal(bot.inventory.items())
  const tried = []
  const st = { need: 'pickaxe', uses: null, diag: {}, moved: null, written: false }
  const finish = (r, outcome) => {
    st.written = true
    return withdrawRowOut(bot, r, { outcome, need: st.need, uses: st.uses, ...st.diag, bagBefore, bagAfter: bagTotal(bot.inventory.items()),
      deposited: Object.entries(st.moved?.gave ?? {}).map(([name, count]) => ({ name, count })),
      took: { ...(st.moved?.took ?? {}), ...(st.moved?.tool ? { [st.moved.tool.name]: 1 } : {}) }, verb: 'withdraw_pick', tried })
  }
  try {
    return await withdrawPickRun(ctx, signal, tried, st, finish)
  } catch (e) {
    if (!st.written) withdrawThrowRow(bot, e, { verb: 'withdraw_pick', need: st.need, uses: st.uses, bagBefore, tried })
    throw e
  }
}
async function withdrawPickRun (ctx, signal, tried, st, finish) {
  const { bot } = ctx
  const { deadline, msLeft } = withdrawClock(ctx)
  const keep = roomKeep(bot.currentWants ?? [])
  if (hasUsablePick(bot.inventory.items())) return finish({ status: 'no_effect', detail: 'already carrying a usable pickaxe' }, 'has_pick')
  const sweep = withdrawSweep(bot, { pick: true, town: true })
  const record = (v, cb) => {
    tried.push(`${posKey(cb.position)}:${v.result?.failClass ?? v.result?.status ?? v.skip ?? (v.moved ? 'acted' : 'none')}`)
    if (v.diag) st.diag = v.diag
    if (v.moved) st.moved = v.moved
  }
  const pickDecision = (inChest, bag, { chestEmpty }) => {
    const p = decideTool(inChest.filter(it => PICK_RE.test(it?.name ?? '')), inChest, bag, chestEmpty, keep)
    if (p?.tool) st.uses = Number.isFinite(remaining(p.tool)) ? remaining(p.tool) : 'full'
    return p
  }
  const seen = []
  let chestBlock = sweep.next(STORAGE_NEAR)
  for (let n = 0; chestBlock && n < WITHDRAW_CONTAINERS; n++) {
    check(signal)
    const v = await withdrawVisit(ctx, chestBlock, pickDecision, signal, msLeft, deadline - 2_000)
    sweep.mark(chestBlock.position, v.double)
    record(v, chestBlock)
    if (v.result) {
      if (v.result.status === 'success') return finish(v.result, 'took_pick')
      if (['transfer_unsettled', 'inventory_full', 'container_open', 'recount_unanswered'].includes(v.result.failClass)) return finish(v.result, v.result.failClass)
    } else if (!v.skip) {
      // NO USABLE PICKAXE HERE: remembered for this container (both halves of a double chest), not for the town -- and
      // so is every ingredient it held none of (the ingredient branch's own evidence).
      const keys = sweep.halves(chestBlock.position, v.double)
      updateTownMemory(townDir(), homeTownKey(), bot.worldId ?? null, e => { notePickMisses(e, keys); noteIngredientMisses(e, keys, ingredientNeedsAbsent(v.saw)) })
      seen.push({ block: chestBlock, saw: v.saw })
    }
    chestBlock = sweep.next(STORAGE_NEAR)
  }
  const tableNear = !!bot.findBlock?.({ matching: b => blockNameOf(bot, b) === 'crafting_table', maxDistance: Math.ceil(STATION_REACH) + 1 })
  const deficits = stonePickDeficits(bot.inventory.items(), { tableNear })
  st.need = deficits.length ? deficits.map(d => `${d.need}:${d.count}`).join(',') : 'none'
  if (!deficits.length) return finish({ status: 'no_effect', detail: 'no usable pickaxe in the town chests looked at, and the bag already holds what one stone pickaxe takes' }, 'has_ingredients')
  // THE INGREDIENTS: the container that covers most of them first (from what the sweep saw), then any other in reach --
  // also when every container was a recent miss and none was opened for the pickaxe.
  const pickName = (d, inChest) => {
    const names = NEEDS[d.need].prefer.length ? NEEDS[d.need].prefer : [...new Set(inChest.filter(it => NEEDS[d.need].match(it.name)).map(it => it.name))]
    return names.filter(nm => haveIn(inChest, nm)).sort((a, b) => haveIn(inChest, b) - haveIn(inChest, a))[0] ?? null
  }
  const coverage = saw => deficits.reduce((k, d) => k + Math.min(d.count, saw.filter(it => NEEDS[d.need].match(it.name)).reduce((a, it) => a + it.count, 0)), 0)
  const ingredientDecision = (inChest, bag, { chestEmpty }) => {
    const takes = []
    for (const d of deficits) {
      const name = pickName(d, inChest)
      if (name) takes.push({ name, count: Math.min(d.count, haveIn(inChest, name)) })
    }
    return decideTakes(takes, inChest, bag, chestEmpty, keep)
  }
  const order = seen.filter(s => coverage(s.saw) > 0).sort((a, b) => coverage(b.saw) - coverage(a.saw)).map(s => s.block)
  const ingSweep = withdrawSweep(bot, { town: true })
  for (const b of seen) if (!order.includes(b.block)) ingSweep.mark(b.block.position, false)
  let fullChests = 0
  for (let n = 0; n < WITHDRAW_CONTAINERS; n++) {
    check(signal)
    const cb = order.shift() ?? ingSweep.any(STORAGE_NEAR)
    if (!cb) break
    ingSweep.mark(cb.position, false)
    const v = await withdrawVisit(ctx, cb, ingredientDecision, signal, msLeft, deadline - 2_000)
    if (v.double) ingSweep.mark(cb.position, true)
    record(v, cb)
    if (v.result) return finish(v.result, v.result.status === 'success' ? 'took_ingredients' : v.result.failClass ?? v.result.status)
    if (v.skip) fullChests++
    else updateTownMemory(townDir(), homeTownKey(), bot.worldId ?? null, e => noteIngredientMisses(e, ingSweep.halves(cb.position, v.double), ingredientNeedsAbsent(v.saw)))
  }
  if (fullChests) return finish({ status: 'failed', failClass: 'chest_no_room', detail: `no usable pickaxe in town, and the chest(s) holding ${st.need} are full while the bag needs room made first` }, 'chest_no_room')
  return finish({ status: 'failed', failClass: 'container_short', detail: `no usable pickaxe and none of ${st.need} in the ${tried.length} container(s) tried here` }, 'short')
}

// --------------------------------------------------------------- smelt -----
//
// THE MISSING RUNG. 59 bots carry a furnace, 30 carry coal, 13 hold raw_iron,
// and `iron_ingot` has never existed in this fleet's history -- not because the
// bots cannot smelt but because NOTHING PUTS AN ITEM IN A FURNACE. A bot could
// craft a furnace (milestones.mjs) and place it (place, above) and then had no
// action that used it.
//
// STOPPING ON OUR OWN CLOCK, NOT ON THE RUNNER'S ABORT.
//
// A vanilla furnace is 10s per item and one coal fuels 8, so a full batch is 80
// seconds of standing still -- against a 180s skill budget with a 30s hard stop
// behind it. Four of this project's documented traps are a skill holding the
// body longer than the layer above expected, so this copies the shape
// shaftAscend already uses and mine's step cap already proves: an internal
// deadline WELL inside the runner's, and a resumable partial return.
//
// Blocking to completion was rejected for that reason. Deposit-and-return-later
// was rejected for a different one: there is no mechanism in this codebase for
// a bot to remember "come back to the furnace at x,z", so the ore would be left
// in a block the bot may never see again -- a brand-new item-loss channel, and
// a bot that dies loses its pockets already. A bounded batch loses nothing: the
// recovery below empties the furnace back into the inventory on EVERY exit
// path, interrupts included.
//
// THE BODY IS NOT CLAIMED, deliberately. runner.claimBody exists, but
// reflex.mjs reads exactly one claim type -- `bodyClaimFor('climb')`, and
// body-claim.test.mjs source-asserts that literal -- so a `smelt` claim would
// protect nothing while looking like it did. Every reflex can and will abort a
// bot standing at a furnace, which is correct: drowning outranks an ingot.
const SMELT_DEADLINE_MS = 150_000       // inside config.skills.defaultTimeoutMs (180s)
const SMELT_RECOVERY_MS = 12_000        // reserved to empty the furnace and close it
const SMELT_POLL_MS     = 500           // how often the wait checks the abort signal
const SMELT_OPEN_MS     = 10_000        // openFurnace waits on a server event forever

/**
 * Empty a furnace back into the bot and close it. Bounded, never throws.
 *
 * THIS IS THE ANSWER TO "WHAT HAPPENS WHEN IT IS INTERRUPTED", and it runs from
 * a `finally`, so it runs on abort, on timeout and on error alike. Without it,
 * every preempted smelt would strand the ore, the fuel and the finished ingots
 * inside a block, and `smelt` would be a net destroyer of exactly the items
 * this fleet has never managed to produce.
 *
 * mineflayer's takeOutput/takeInput/takeFuel each `assert.ok(item)` and throw on
 * an empty slot (node_modules/mineflayer/lib/plugins/furnace.js:75-91), and each
 * awaits `once(window, 'updateSlot:N')` underneath, which never fires if the
 * block is gone. So every call is both guarded and raced against a wall clock:
 * a recovery that hangs would burn the hard-stop grace and land the bot in
 * `abort_ignored`.
 */
async function drainFurnace (furnace, ms = SMELT_RECOVERY_MS) {
  const deadline = Date.now() + ms
  const bounded = p => Promise.race([
    p, new Promise(res => setTimeout(res, Math.max(250, deadline - Date.now()))),
  ])
  for (const [slot, take] of [['outputItem', 'takeOutput'],
                              ['inputItem', 'takeInput'],
                              ['fuelItem', 'takeFuel']]) {
    if (Date.now() >= deadline) break
    try {
      if (!furnace?.[slot]?.()) continue
      await bounded(furnace[take]())
    } catch { /* slot emptied under us, or the block is gone; nothing to recover */ }
  }
  try { furnace?.close?.() } catch { /* already closed */ }
}

/** Inventory as the plain {name: count} map smeltPlan reasons over. */
function heldMap (bot) {
  const out = {}
  for (const it of (bot.inventory?.items?.() ?? [])) out[it.name] = (out[it.name] ?? 0) + it.count
  return out
}

async function smelt(ctx, { item, count = 1 }, signal) {
  const { bot } = ctx
  const deadline = Date.now() + SMELT_DEADLINE_MS

  // TWO DIFFERENT WRONG NAMES, AND ONLY ONE OF THEM IS EVIDENCE.
  //
  // craft files an unknown item as `other` rather than `bad_target` so that a
  // typo cannot write a permanent avoid rule. That reasoning holds for a name
  // the registry has never heard of. It does NOT hold for `smelt dirt`: dirt is
  // a real item and a furnace will never turn it into anything, on any world,
  // forever. That is exactly what `bad_target` means -- "the args name
  // something that does not exist" -- so the split is by whether the name is
  // real, not by whether the call failed.
  if (!bot.registry.itemsByName[item]) {
    return { status: 'failed', failClass: 'other', detail: `unknown item "${item}"` }
  }

  // Plan BEFORE walking. Discovering "you have no fuel" after a 40-second hike
  // to a furnace spends the decision to learn something the inventory already
  // knew, and travel is where 80% of this fleet's deposit failures went.
  const dry = smeltPlan({ held: heldMap(bot), item, count,
                          budgetMs: SMELT_DEADLINE_MS, hasFurnace: true })
  if (!dry.ok && dry.reason === 'not_smeltable') {
    return { status: 'failed', failClass: 'bad_target',
             detail: `${dry.detail}; gather or craft it instead` }
  }
  if (!dry.ok && dry.reason === 'no_input') {
    return { status: 'failed', failClass: 'missing_ingredients', gap: dry.item,
             need: dry.need, detail: `${dry.detail} — gather ${dry.item} first` }
  }
  if (!dry.ok && dry.reason === 'no_fuel') {
    return { status: 'failed', failClass: 'missing_ingredients', gap: 'fuel',
             need: dry.need, detail: dry.detail }
  }

  // A NAME THIS FILE'S TABLE GOT WRONG MUST NOT BECOME A SILENT MIS-SMELT.
  // smelting.mjs is hand-maintained because minecraft-data ships no smelting
  // data at all; this is the check that keeps that table honest against the
  // registry the bot is actually connected to.
  const outDef = bot.registry.itemsByName[smeltRecipeFor(item)?.output]
  if (!outDef) {
    return { status: 'failed', failClass: 'other',
             detail: `this server has no item called ${smeltRecipeFor(item)?.output}` }
  }

  // ---- get a furnace into the world, mirroring craft's two-stage station ----
  const findFurnace = () => bot.findBlock({
    matching: b => bot.registry.blocks[b.type]?.name === 'furnace',
    maxDistance: 32,
  })
  let block = findFurnace()
  let placed = 0
  if (!block && bot.inventory.items().some(i => i.name === 'furnace')) {
    check(signal)
    // The SAME `place` the crafting-table path uses -- it searches eight
    // horizontal neighbours plus a step up or down and READS THE BLOCK BACK,
    // which is the repair that made the tech tree work at all.
    const put = await place(ctx, { item: 'furnace' }, signal)
    if (put.status === 'success') { placed = 1; block = findFurnace() }
  }
  if (!block) {
    const noStation = smeltPlan({ held: heldMap(bot), item, count,
                                  budgetMs: SMELT_DEADLINE_MS, hasFurnace: false })
    return { status: 'failed', failClass: 'needs_station', gap: 'furnace',
             need: noStation.need,
             detail: 'no furnace within 32 blocks and none in your inventory — ' +
                     'craft item=furnace (8 cobblestone); smelt places it for you' }
  }

  // Same two ranges craft uses: the first goal often fails on the approach
  // rather than the destination, and GoalNear(3) still leaves the bot in reach.
  for (const range of [1, 3]) {
    check(signal)
    try {
      await withTimeout(bot.pathfinder.goto(new goals.GoalNear(
        block.position.x, block.position.y, block.position.z, range)), 20000, bot)
      break
    } catch (e) { if (e.aborted) throw e /* try the looser goal, then the reach check */ }
  }
  check(signal)
  let reach = bot.entity.position.distanceTo(block.position.offset(0.5, 0.5, 0.5))
  // THE REMEDY WAS IN ITS POCKET.
  //
  // findFurnace() takes the nearest furnace within 32 blocks, and if the walk
  // cannot close that distance this used to fail -- while 68 of 80 bots CARRY a
  // furnace item. "Move to 1046,308 first" is advice about a place the bot has
  // just failed to reach; putting down the one it is holding is a remedy it can
  // perform where it stands. Measured in one 70-minute window: 11 of 56 smelt
  // attempts died on exactly this, against 13 successes.
  //
  // Only when we have not already placed one this call, so a bot cannot spend a
  // furnace per attempt.
  if (reach > STATION_REACH && !placed) {
    const carried = (bot.inventory?.items?.() ?? []).some(i => i.name === 'furnace')
    if (carried) {
      const put = await place(ctx, { item: 'furnace' }, signal)
      if (put.status === 'success') {
        placed = 1
        const mine = findFurnace()
        if (mine) {
          block = mine
          reach = bot.entity.position.distanceTo(block.position.offset(0.5, 0.5, 0.5))
        }
      }
    }
  }
  if (reach > STATION_REACH) {
    const carried = (bot.inventory?.items?.() ?? []).some(i => i.name === 'furnace')
    return { status: 'failed', failClass: 'no_path',
             // KEEP THE COORDINATES. A test asserts them and it is right to:
             // "move to x,z" is a remedy the bot can perform with goto, and my
             // first version of this replaced it with craft advice, which is a
             // worse remedy for a bot that already owns no furnace.
             detail: `the furnace is ${Math.round(reach)} blocks away and could not be reached — ` +
                     `smelting needs one within 4 blocks; move to ${block.position.x},${block.position.z} first` +
                     (carried
                       ? ' (placing the one you carry did not help either)'
                       : ' — or craft item=furnace (8 cobblestone) and smelt will place it for you') }
  }
  try { await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true) } catch { /* not fatal */ }

  // ---- re-plan against the clock that is ACTUALLY left ----------------------
  const budgetMs = deadline - Date.now() - SMELT_RECOVERY_MS
  const plan = smeltPlan({ held: heldMap(bot), item, count, budgetMs, hasFurnace: true })
  if (!plan.ok) {
    // The walk consumed the batch. Our own clock, so a don't-know, not a no.
    return { status: 'unknown', failClass: 'smelt_budget',
             detail: `${plan.detail} after reaching the furnace; call smelt again` }
  }

  const inDef = bot.registry.itemsByName[plan.input]
  const fuelDef = bot.registry.itemsByName[plan.fuel.name]
  // MEASURED BEFORE ANYTHING MOVES. ADR-0003: a promise resolving is not a
  // result. The runner grades this independently from its own before/after
  // inventory snapshot, and this number only makes the `detail` honest.
  const before = countItem(bot, plan.output)

  let furnace
  try {
    furnace = await withTimeout(bot.openFurnace(block), SMELT_OPEN_MS, bot,
                                { what: 'furnace', needsDrop: false, onTimeout: () => {} })
  } catch (e) {
    if (e.aborted) throw e
    return { status: 'unknown', failClass: 'furnace_window',
             detail: `the furnace at ${block.position.x},${block.position.z} did not open — ` +
                     'stand next to it and face it, then smelt again' }
  }

  let loaded = false
  try {
    // Anything already inside is ours to take: a previous call that was
    // preempted between the burn and the harvest leaves finished output here,
    // and leaving it would make an interrupt permanently lossy.
    try { if (furnace.outputItem()) await furnace.takeOutput() } catch { /* empty */ }
    try {
      const inSlot = furnace.inputItem()
      if (inSlot && inSlot.name !== plan.input) await furnace.takeInput()
    } catch { /* empty or full inventory; putInput below will report it */ }

    check(signal)
    await furnace.putInput(inDef.id, null, plan.batch)
    await furnace.putFuel(fuelDef.id, null, plan.fuel.count)
    loaded = true

    // THE WAIT, AND IT IS THE ONLY PLACE THIS SKILL SPENDS TIME.
    // check(signal) first in every iteration and sleep(ms, signal) for every
    // pause -- the idiom mine's descent loop uses, and the reason a reflex can
    // preempt this within half a second instead of eighty.
    //
    // EVERY SLOT READ IS GUARDED, and that is not defensive padding. A furnace
    // whose BLOCK has been broken under the bot -- by a creeper, by another bot,
    // by the bot's own pathfinder digging through it -- takes the window with
    // it, and reading a slot then throws out of this function as a raw error
    // rather than as a classified result. Found by test/smelt-skill.test.mjs,
    // which models the vanishing block; the first version of this loop had the
    // takeOutput guarded and the loop CONDITION bare, so the one read that runs
    // on every iteration was the one that could escape.
    const slot = which => { try { return furnace[which]() ?? null } catch { return undefined } }
    while (Date.now() < deadline - SMELT_RECOVERY_MS) {
      check(signal)
      const out = slot('outputItem')
      if (out === undefined) break            // the furnace is no longer readable
      if (out && out.count > 0) {
        try { await furnace.takeOutput() } catch { /* taken under us, or gone */ }
      }
      const inp = slot('inputItem')
      if (inp === undefined) break
      // Nothing left to cook and nothing left to collect: done early.
      if (!inp && !slot('outputItem')) break
      await sleep(SMELT_POLL_MS, signal)
    }
  } finally {
    await drainFurnace(furnace)
  }

  const gained = countItem(bot, plan.output) - before
  const ran = Date.now() >= deadline - SMELT_RECOVERY_MS

  // SUCCESS IS A MEASUREMENT OR IT IS NOT A SUCCESS. `status` earned 115
  // recorded wins for doing nothing because a promise resolved; the count of
  // the output item is the only thing that makes this claim falsifiable.
  if (gained > 0) {
    return {
      status: 'success',
      detail: `smelted ${gained}x ${plan.output} from ${plan.input} ` +
              `(batch ${plan.batch}, burned ${plan.fuel.count}x ${plan.fuel.name}` +
              `${placed ? ', placed the furnace first' : ''})` +
              (gained < plan.batch ? ` — ${plan.batch - gained} still to do, call smelt again` : ''),
    }
  }
  if (ran) {
    return { status: 'unknown', failClass: 'smelt_budget',
             detail: `the furnace was still burning when this call's ${Math.round(SMELT_DEADLINE_MS / 1000)}s ran out; ` +
                     `the ${plan.input} and fuel are back in your inventory — call smelt again to continue` }
  }
  return { status: 'no_effect',
           detail: loaded
             ? `the furnace produced no ${plan.output}; the ${plan.input} and fuel are back in your inventory`
             : `nothing was loaded into the furnace` }
}

// ---------------------------------------------------------------- mine -----
//
// Distinct from gather: gather goes to blocks it can already see, mine
// descends to reach ones it cannot. Staircase rather than straight down --
// digging straight down is how bots fall into lava.
async function mine(ctx, { y: targetY = 12 }, signal) {
  const { bot, runner } = ctx
  // Clamped to the bot's own elevation for the same reason admission.mjs
  // bounds the ask there: a flat 120 silently turned a stranded bot's
  // 147-block descent request into a 200-block one.
  const hereY = bot.entity?.position?.y
  const descentCap = Number.isFinite(hereY) ? Math.floor(hereY) - 1 : 120
  const goalY = Math.max(-59, Math.min(Number(targetY) || 12, descentCap))

  // REFUSE THE DESCENT rather than failing partway down it.
  //
  // Measured over 30 minutes: `mine -> success "reached y=N"` five times and
  // `mine -> failed "need a better tool for stone"` eight times. The bot dug
  // itself 6-8 blocks down, arrived beside stone it could not harvest, and was
  // then stranded in the cave layer where unstick works worst and the watchdog
  // takes twelve minutes to notice. Every bot in the fleet ended up at y=69-71
  // this way while the base sat at y=77.
  //
  // The old check ran INSIDE the loop, so it only fired after the damage. Same
  // shape as the rest of tonight: a capability with no precondition, only a
  // post-hoc failure. Descending is easy and coming back is not, so the check
  // belongs before the first block is broken.
  //
  // The detail is written for the model: it names the thing to do instead.
  // NO DIGGING AT HOME. The fleet has now dug a lethal shaft through its own
  // base twice: once at world spawn (three deaths, 1x1 shaft to y=41) and again
  // at the forward base four hours after I built it -- a 48-block void straight
  // down at 28,0 that killed Scout01 with "fell from a high place".
  //
  // The pickaxe precondition below does not prevent this, because dirt and grass
  // need no tool. A base a bot can mine out from under itself is not a base, and
  // it is where every bot respawns, so the hole is maximally dangerous exactly
  // where they are guaranteed to stand.
  const dHome = Math.hypot(bot.entity.position.x - config.world.homeX,
                           bot.entity.position.z - config.world.homeZ)
  if (dHome <= 12 && goalY < bot.entity.position.y - 1) {
    return {
      status: 'failed',
      failClass: 'forbidden',
      detail: `will not dig down within ${Math.round(dHome)} blocks of home — ` +
              'the base floor is not a resource; walk out at least 12 blocks first',
    }
  }

  if (goalY < bot.entity.position.y - 2 && !bot.inventory.items().some(i => /_pickaxe$/.test(i.name))) {
    return {
      status: 'failed',
      failClass: 'missing_tool',
      detail: 'no pickaxe, so descending would strand this bot beside stone it cannot mine — ' +
              'craft a wooden_pickaxe first (3 oak_planks + 2 sticks, at a crafting_table)',
    }
  }

  // MINE ONLY DESCENDS, AND ASKING IT TO GO UP RETURNED SUCCESS.
  //
  // The loop below is `while (y > goalY + 1)`. A bot at y=68 asked to mine to
  // y=71 never enters it and falls straight through to the terminal
  // `success: reached y=68`. Live, Scout02 did exactly this every 70 seconds:
  //
  //     LLM -> mine args={"y":71} reason=Continue mining stone for cobblestone
  //     skill mine -> success detail=reached y=68
  //     skill returned cleanly but changed nothing
  //
  // The cognitive layer noticed -- it classified the outcome `neutral` and said
  // so -- and then recorded a SUCCESS for it, which clears any avoid rule. So
  // the one mechanism that could have broken the loop was being reset by the
  // loop. Four of six bots were sitting in this state, moving zero blocks while
  // every health signal read fine.
  //
  // Same shape as goto's empty-path resolve and the watchdog's idle window: an
  // operation that did nothing, reporting the outcome it would have had if it
  // had done something. The detail names the alternative, because the model can
  // only act on what it is told.
  if (bot.entity.position.y <= goalY + 1) {
    return {
      status: 'failed',
      failClass: 'already_below',
      gap: `at_y${Math.round(bot.entity.position.y)}`,
      detail: `already at y=${Math.round(bot.entity.position.y)}, at or below the requested ` +
              `y=${goalY} — mine only digs downward, so this cannot do anything; ` +
              `use gather for blocks you can see, or goto to move upward`,
    }
  }

  // ONE BEARING FOR THE WHOLE DESCENT -- BUT CHOSEN, NOT INHERITED.
  //
  // Still chosen once and held. A bearing recomputed per step follows the bot's
  // own yaw, and the yaw swings while the pathfinder walks it into each tread --
  // so the stair curls back into itself and the bot digs through its own steps.
  //
  // What it is no longer is a READING of where the bot happens to be facing.
  // That made the yaw a hard constraint on the world: if the single cardinal it
  // snapped to had water in the tread, `mine` refused; the next decision cycle
  // found the bot facing the same way, snapped to the same cardinal, and
  // refused again. Measured over the full telemetry walk, 80 bots:
  //
  //     water refusals                          1,418
  //     ...with distance_moved = 0              1,370  (96.6%)
  //     ...in a streak of >=2 consecutive mine   249 streaks, longest 45
  //     y at refusal                            61-63  (sea level is 63)
  //
  // Every one of those 1,370 refused before taking a single step, standing on
  // dry land at a shoreline, where at least one of the other three cardinals
  // runs inland. None of them was ever tried. That is the entrapment signature:
  // the bot is not failing to mine, it is failing to CHOOSE.
  //
  // So score all four against the world: longest dry run, then fewest liquid
  // faces exposed, then the way the bot is already facing. No turn is needed to
  // dig -- the bearing is pure geometry, `bot.dig` looks at the block it is
  // given and the pathfinder walks the tread -- so choosing costs nothing but
  // the lookahead scan.
  //
  // This is the shape every project that solved it uses, arrived at from the
  // other end: mineflayer-pathfinder re-derives all four cardinals at every A*
  // node and prices a blocked one at 100 rather than aborting the search
  // (lib/movements.js getNeighbors), and Baritone's `blacklistClosestOnFailure`
  // demotes the candidate that failed instead of the task. A refusal that does
  // not retire the candidate that caused it hands the next decision the same
  // input and gets the same output -- which is the 1,418 above, exactly.
  const choice = chooseStairBearing(bot, bot.entity.position.floored())
  const bear = choice.bear
  const facing = stairBearing(bot)
  // Compared BY VALUE. Both come from the same CARDINALS array today, so `!==`
  // would work -- and would silently stop logging the day anyone clones one.
  if (bear.x !== facing.x || bear.z !== facing.z) {
    // MEASURABILITY. Only logged when the choice actually departs from the yaw,
    // because that is the event the fix exists to produce; a record on every
    // descent would be 62,000 lines saying nothing happened.
    logEvent({ kind: 'mine_bearing_turned',
               detail: `stair bearing (${bear.x},${bear.z}) instead of the facing ` +
                       `(${facing.x},${facing.z}): ${choice.runway} dry steps ahead ` +
                       `vs ${stairRunway(bot, bot.entity.position.floored(), facing)}`,
               snapshot: snapshot(bot) })
  }
  let steps = 0
  // How many steps only worked on the RETRY. Counted so the server-desync
  // share is measurable rather than inferred from the absence of failures.
  let stepRetries = 0
  // Total ms spent recovering. Pre-registered as a revert condition: if this
  // grows, the recovery is the new budget problem rather than the fix for one.
  let stepRecoverMs = 0
  // CLAIM THE BODY FOR THE STAIR, TYPED. The entombment reflex reads a bot
  // standing in the one-wide three-high corridor it has just cut as "walled
  // in" and starts pillaring OUT -- up, against the descent (12 firings per
  // bot-hour on the stair canary of 2026-09-11, `mine aborted entombed` in the
  // sandbox). `surface` quiets that branch with a 'climb' claim around its
  // hand-rolled pillar; this is the same shape. Held only around the step loop,
  // renewed per step, released on every exit. It quiets ONE branch: no water
  // path reads it, and body-claim.test.mjs pins that.
  const stairClaim = runner?.claimBody?.('stair') ?? null
  try {
  while (bot.entity.position.y > goalY + 1 && steps < 90) {
    stairClaim?.renew?.()
    check(signal)
    steps++

    // NEVER SPEND THE EXIT. Checked before EVERY dig, not once at entry.
    //
    // The entry precondition above already refuses to descend without a pickaxe,
    // and it PASSED for both bots that are now permanently entombed. Capability
    // expired mid-task: the pickaxe broke, nothing re-checked, and the bot kept
    // digging into a shaft it could no longer climb. 782 lost-last-pickaxe
    // transitions fleet-wide in one day, 107 of them below y=50.
    //
    // Cave divers turn on a reserve rather than on empty, in exactly this kind of
    // overhead environment where the only way out is back the way you came. See
    // src/exit-contract.mjs for where that analogy breaks.
    const exit = canContinueDescent({
      y: bot.entity.position.y, health: bot.health, items: bot.inventory.items(),
    })
    if (!exit.ok) {
      logEvent({ kind: 'exit_reserve_abort', status: 'failed',
                 detail: `${exit.reason}: ${exit.detail}`, snapshot: snapshot(bot) })
      // A CONTRACT REFUSAL, NOT A MINING FAILURE. The distinct class keeps this
      // out of the learned-avoid counters -- a bot that correctly declined to
      // strand itself must not learn that mining is a bad idea.
      return {
        status: 'failed', failClass: 'exit_capability_reserve',
        // THE REMEDY MUST MATCH THE SHORTFALL. This said "gather blocks" to
        // every refusal, including the one that is short a pickaxe. See
        // exitPrereqFor.
        detail: `stopped at y=${Math.round(bot.entity.position.y)} to keep an exit: ` +
                `${exit.detail}.${exitAdviceFor(exit)}`,
        need: exitPrereqFor(exit),
      }
    }
    // THE TREAD, NOT THE FLOOR. `mine` used to dig the block directly under the
    // bot and step sideways every third block, which is not a staircase -- it is
    // a shaft with ledges. Measured over 23 days: a horizontal:vertical shape
    // ratio of 0.25 (a staircase is ~1.0), 0 iron ore gathered in 65 attempts,
    // and no bot below y=56. The exit contract then priced climbing back out of
    // a sheer shaft at 59 scaffold blocks, which no gatherer ever carries, so
    // the descent refused itself before it ever reached iron at y≈15.
    //
    // A tread is dug one block ALONG the bearing and one block DOWN, with the
    // cell above it opened for headroom, and then the bot WALKS INTO IT. That
    // is 1:1, it is walkable in both directions, and the way back up costs
    // nothing but time.
    const p0 = bot.entity.position.floored()
    const cells = descentStepCells(p0, bear)
    const cellFeet = cells.feet                      // where the bot will stand
    const cellHead = cells.head                      // headroom over the tread
    // THE THIRD CELL. A bot steps DOWN into the tread from one block higher, so
    // its head passes through the cell ABOVE the tread's headroom before it
    // drops. With that cell solid the bot walks into a ceiling and stops on the
    // lip: 388 `mine_stair_step_failed` in 90 minutes on 2026-09-11, every one
    // "moved 0.19 blocks", and at six probed sites the tread and headroom were
    // air while this cell was grass or dirt. A descending stair is three cells.
    const cellAbove = cells.above                    // the bot's own head height, next column
    const treadFloor = cells.floor                   // what holds it up
    const below = bot.blockAt(cellFeet)
    if (!below) break
    for (const [pos, what] of [[cellFeet, 'tread'], [cellHead, 'headroom'], [cellAbove, 'ceiling']]) {
      const b = bot.blockAt(pos)
      // ONE PREDICATE. stairLiquid is what chooseStairBearing scored the four
      // cardinals with; if this test and that one ever drift, the chooser hands
      // the loop a bearing the loop refuses and the livelock comes back with a
      // lookahead scan bolted on top.
      if (stairLiquid(b)) {
        // `hazard_interrupt` is what classifyFailure returned for this string (it
        // matches on the word "lava"), so the class is preserved rather than
        // improved -- the taxonomy that Kibana aggregates must not shift under an
        // honesty change. It is a guard refusing to dig, not a reflex preemption,
        // and that mislabel is worth fixing separately.
        return { status: 'failed', failClass: 'hazard_interrupt',
                 detail: `stopped at y=${Math.round(bot.entity.position.y)}: ` +
                         `${b.name} in the ${what} ahead` +
                         // THE OBSERVATION HAS TO NAME THE ONLY MOVE LEFT.
                         // runway 0 means all four cardinals were wet at the
                         // first tread, so calling `mine` again from this exact
                         // cell cannot do anything -- which is precisely the
                         // loop the fleet was in. Say so, and name `goto`.
                         (choice.runway === 0
                           ? ' — and in every other direction from here, so mining ' +
                             'again from this spot cannot help; goto somewhere ' +
                             'drier first, or gather on the surface'
                           : '') }
      }
    }
    // DO NOT BREAK THE FLOOR OVER A HOLE.
    //
    // This checked exactly one block down, so a staircase that breaks into a
    // cave roof dropped the bot however far the cave happened to be deep. Our
    // death bucketing has a `fall` class and tracks peak height precisely
    // because this keeps happening, and the reflex layer has no fall handling
    // at all -- maxDropDown=6 governs the PATHFINDER, not our own digging.
    // Anchored on the TREAD's floor now, because that is what the bot is about
    // to put its weight on.
    // MEASURE THE DROP. Do not merely notice that there is one.
    //
    // This probed three blocks and refused, so a 4-block step-down -- ONE damage
    // point -- was refused exactly as hard as a 118-block void. A bot marooned on
    // a pillar is surrounded by open space by definition, so the guard against
    // fall damage was what kept it there: of 31 `mine` calls by bots above y=90
    // in 24h, twelve stopped here, and those bots had zero successes in ~400
    // decisions each.
    //
    // Probe far enough to price the fall, and refuse only what actually hurts.
    // An UNMEASURED void (deeper than the probe) is still refused -- the point is
    // to stop guessing, not to start falling.
    const maxProbe = Math.max(4, survivableDrop(bot.health) + 2)
    let hollow = 0
    let floored = false
    for (let d = 0; d <= maxProbe; d++) {
      const b = bot.blockAt(treadFloor.offset(0, -d, 0))
      if (!b || b.name === 'air' || b.name === 'cave_air' || b.boundingBox === 'empty') hollow++
      else { floored = true; break }
    }
    const depth = floored ? hollow : null      // null = deeper than we can see
    if (hollow >= 3 && !mayStepDown(depth, bot.health)) {
      return {
        status: 'failed', failClass: 'void_below',
        gap: `at_y${Math.round(bot.entity.position.y)}`,
        detail: `stopped at y=${Math.round(bot.entity.position.y)}: ` +
                (depth == null
                  ? `open space deeper than ${maxProbe} blocks under the next step — ` +
                    `that is a fall, not a stair`
                  : `a ${depth}-block drop under the next step would cost about ` +
                    `${Math.max(0, depth - 3)} health, leaving too little`),
      }
    }
    // Dig headroom first: a falling-block column above an already-open tread
    // pours gravel into the cell the bot is about to occupy.
    // OPENING THE CEILING CELL EXPOSES NEW FACES. The liquid check above reads
    // the three cells themselves; this reads what touches the ceiling cell
    // once it is gone (above and the four sides, as safeToBreak does).
    const aboveBlock = bot.blockAt(cellAbove)
    if (aboveBlock && aboveBlock.name !== 'air' && aboveBlock.name !== 'cave_air') {
      for (const [dx, dy, dz] of FLOW_NEIGHBOURS) {
        const n = bot.blockAt(cellAbove.offset(dx, dy, dz))
        if (stairLiquid(n)) {
          return { status: 'failed', failClass: 'hazard_interrupt',
                   detail: `stopped at y=${Math.round(bot.entity.position.y)}: ${n.name} beside the ` +
                           `ceiling cell ahead — opening it would let it in` }
        }
      }
    }
    const fallingAbove = FALLING.has(bot.blockAt(cellAbove.offset(0, 1, 0))?.name)   // read BEFORE digging
    for (const pos of [cellAbove, cellHead, cellFeet]) {
      const b = bot.blockAt(pos)
      if (!b || b.name === 'air' || b.name === 'cave_air') continue
      const tool = bestTool(bot, b)
      if (tool) await bot.equip(tool, 'hand').catch(() => {})
      if (!b.canHarvest(bot.heldItem?.type ?? null)) {
        // `missing_tool` is what the classifier derived from the word "tool" in
        // this string, and it is right. Stated here so it survives a rewording --
        // and deliberately WITHOUT a gap, because adding one would change how the
        // lessons store gates this class, which is not what this change is about.
        return { status: 'failed', failClass: 'missing_tool',
                 detail: `need a better tool for ${b.name} at y=${Math.round(bot.entity.position.y)}` }
      }
      try { await bot.dig(b) } catch (e) { if (e.aborted) throw e; break }
    }

    // DIGGING IS NOT DESCENDING. `bot.dig()` removes a block; it does not move
    // the bot, and for 23 days nothing here checked. A stair the bot never walks
    // down is just a wider hole -- and the specific failure to avoid is digging
    // a side cell, failing to enter it, and digging again next iteration, which
    // carves a widened shaft with ledges and reports success the whole way.
        // A FALLING COLUMN ABOVE THE OPENED CEILING refills the step after the digs.
    // Detected BEFORE the excavation (once the ceiling cell is gone the sand
    // above it is already an entity, not a block), then a bounded settle that
    // waits for the falling entities near the step to be gone, re-opens the
    // three cells top-down, and verifies the passage before the bot moves.
    // If the column will not settle, the step is refused: stepping into a cell
    // that gravel is about to fill is how a bot gets buried.
    if (fallingAbove) {
      let settled = false
      for (let round = 0; round < 4 && !settled; round++) {
        await sleep(600, signal)
        const fallingNear = Object.values(bot.entities ?? {}).some(e =>
          (e?.name === 'falling_block' || e?.displayName === 'Falling Block') &&
          e.position && e.position.distanceTo(cellAbove.offset(0.5, 0.5, 0.5)) < 4)
        if (fallingNear) continue
        const stepCells = [cellAbove, cellHead, cellFeet]
        for (const pos of stepCells) {   // re-open top-down
          const b = bot.blockAt(pos)
          if (b && b.boundingBox === 'block') { try { await bot.dig(b) } catch (e) { if (e.aborted) throw e } }
        }
        await sleep(300, signal)
        settled = stepCells.every(pos => bot.blockAt(pos)?.boundingBox !== 'block') &&
          !Object.values(bot.entities ?? {}).some(e => e?.name === 'falling_block' && e.position &&
            e.position.distanceTo(cellAbove.offset(0.5, 0.5, 0.5)) < 4)
      }
      if (!settled) {
        return { status: 'failed', failClass: 'hazard_interrupt',
                 detail: `stopped at y=${Math.round(bot.entity.position.y)}: a falling column keeps refilling the step` }
      }
    }
    const before = bot.entity.position.clone()
    let moved = 0
    try {
      await withTimeout(
        bot.pathfinder.goto(new goals.GoalBlock(cellFeet.x, cellFeet.y, cellFeet.z)),
        5000, bot, { what: 'stepping down the stair' })
    } catch (e) {
      if (e.aborted) throw e
      /* fall through to the displacement check, which is the real verdict */
    }
    // ARRIVAL, NOT DISPLACEMENT. `moved >= 0.7` only says the bot went
    // SOMEWHERE. Pathfinder times out mid-route, mobs shove, and a bot that
    // slid a metre sideways at the same elevation would pass -- and the next
    // iteration would then cut a tread from the wrong place, carving a trench
    // while every log line said the descent was progressing.
    // MEASURE THE BLOCK, NOT THE FLOAT -- AND LET IT LAND FIRST.
    //
    // The first version compared raw `position.y` to the tread with a 0.5
    // tolerance. Live, that rejected five of six SUCCESSFUL steps: the
    // pathfinder walks the bot over the lip and returns while it is still
    // falling, so y read 63.9 against a tread at 63 and the step was filed as
    // `unverified`. The log line said so in its own words -- "dug the tread at
    // (1646,63,722) but ended at (1646,63,722)" -- identical coordinates,
    // rejected. The instrument was wrong, not the staircase.
    //
    // A block is the unit that matters, so floor both sides and compare
    // exactly. The brief settle is what makes that honest rather than lucky:
    // without it the bot can still be a whole block high and floor to the
    // wrong cell.
    // 250ms WAS NOT A LANDING, AND THE STEP IS A FALL.
    //
    // A step down IS one block of falling, and one block takes about nine ticks
    // (~450ms) from rest. A flat 250ms sleep therefore judged a good number of
    // these mid-air, floored y one too high, and filed a step the bot was in
    // the middle of taking as "wrong cell".
    //
    // Measured over 172 failures across 42 bots: 85.5% ended at exactly
    // tread.y + 1, and the horizontal distance moved was bimodal -- p50 = 0.00
    // (never left the lip) and p90 = 0.99 (walked over it and was still coming
    // down). The second population is this bug and nothing more.
    //
    // `settleForFall` is the same helper the escape rungs now use, for the same
    // reason: it returns as soon as the bot is down and on the ground, so a
    // clean step costs a poll or two rather than a fixed wait.
    await settleForFall(bot, before.y, { maxMs: STEP_SETTLE_MS })
    let now = bot.entity.position
    let at = now.floored()
    moved = Math.hypot(now.x - before.x, now.z - before.z)
    let arrived = at.x === cellFeet.x && at.y === cellFeet.y && at.z === cellFeet.z

    // A SURGICAL RECOVERY, NOT THE 5-SECOND ONE I ALREADY REVERTED.
    //
    // The first attempt at this re-dug the pair and re-ran a full `goto`, which
    // cost about five seconds per failed step inside a skill that runs on a
    // budget. Measured: mine success 27.8% -> 17.8%, successes per hour 134 ->
    // 80, and it was reverted against its own pre-registered threshold.
    //
    // What it was chasing is still real and still the largest single failure in
    // this file: half of these are a bot that never moved, because mineflayer
    // writes air into the LOCAL block cache on a dig timer with no server
    // acknowledgement, so the client routes into a cell the server still has
    // filled. 60% of all mine failures are this one line, which at a 70.6%
    // failure rate is roughly 42 percentage points of every mine attempt.
    //
    // So: retry the BLOCK-STATE TRANSITION, not the movement plan. Re-dig the
    // one suspect cell on a small budget, then push into it with a brief
    // control impulse rather than asking the planner for a route to a cell one
    // step away. Total added cost is bounded under a second, against the five
    // that failed.
    if (!arrived && moved < 0.3) {
      const t0 = Date.now()
      const stillThere = bot.blockAt(cellFeet)
      if (stillThere && stillThere.boundingBox === 'block') {
        // needsDrop: false, like the two escape digs. This re-dig wants the HOLE,
        // not the cobble -- and with the default the harvest watchdog would wait
        // for a drop that unharvestable stone will never produce, turning a
        // sub-second recovery into a spin. body-claim.test.mjs caught this.
        try {
          await withTimeout(bot.dig(stillThere), STEP_REDIG_MS, bot,
            { what: 'redigging the tread', needsDrop: false })
        }
        catch (e) { if (e.aborted) throw e }
      }
      // AN IMPULSE, NOT A PLAN. One step away needs a shove, not a search.
      try {
        // Guarded: a missing lookAt must not turn a recovery into a throw that
        // aborts the whole descent. The impulse is worth trying without it.
        if (typeof bot.lookAt === 'function') await bot.lookAt(cellFeet.offset(0.5, 0.5, 0.5), true)
        bot.setControlState('forward', true)
        await sleep(STEP_IMPULSE_MS, signal)
      } catch (e) {
        if (e?.aborted) throw e
      } finally {
        try { bot.setControlState('forward', false) } catch { /* released anyway */ }
      }
      await settleForFall(bot, before.y, { maxMs: STEP_SETTLE_MS })
      now = bot.entity.position
      at = now.floored()
      moved = Math.hypot(now.x - before.x, now.z - before.z)
      arrived = at.x === cellFeet.x && at.y === cellFeet.y && at.z === cellFeet.z
      if (arrived) stepRetries++
      stepRecoverMs += Date.now() - t0
    }
    if (!arrived) {
      // Do NOT keep digging. Stop, say the step is unverified, and leave the
      // shaft no wider than it already is.
      try { bot.pathfinder.setGoal(null) } catch { /* plugin may be absent */ }
      logEvent({ kind: 'mine_stair_step_failed', status: 'failed',
                 detail: `dug the tread at (${cellFeet.x},${cellFeet.y},${cellFeet.z}) ` +
                         `but ended at (${at.x},${at.y},${at.z}) after moving ` +
                         `${moved.toFixed(2)} horizontally — the stair was cut and not taken`,
                 snapshot: snapshot(bot) })
      return {
        status: 'unknown', failClass: 'unverified',
        detail: `stopped at y=${Math.round(bot.entity.position.y)}: cut a step but could ` +
                `not stand in it (moved ${moved.toFixed(2)} blocks, wrong cell). The shaft was not ` +
                `widened further. Try goto to reposition, or gather to clear what is in the way.`,
      }
    }
    await sleep(150, signal)
  }
  } finally { stairClaim?.release?.() }
  // THE CAP IS NOT AN ARRIVAL. Falling out of the loop on `steps < 90` used to
  // return the same success as reaching the target, which is the defect this
  // skill was already caught doing once: reporting the outcome it would have
  // had. A cleared avoid-rule on a descent that stopped 40 blocks short is how
  // a bot learns that mining works when it does not.
  const endY = Math.round(bot.entity.position.y)
  if (bot.entity.position.y > goalY + 1) {
    return {
      status: 'unknown', failClass: 'unverified',
      detail: `stopped at y=${endY} after ${steps} steps, short of the requested ` +
              `y=${goalY}. Call mine again to continue, or gather first if the ` +
              `pickaxe is nearly spent.`,
    }
  }
  return { status: 'success', detail: `reached y=${endY}` }
}

/**
 * WHICH WAY THE STAIR RUNS.
 *
 * Snapped to a cardinal, because a diagonal tread needs two cells opened per
 * step and the bot clips the corner between them. mineflayer's yaw is 0 at
 * south (+z) and increases counter-clockwise.
 */
const CARDINALS = [{ x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }, { x: 1, z: 0 }]

function yawQuadrant (bot) {
  const yaw = bot?.entity?.yaw ?? 0
  return ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4
}

export function stairBearing (bot) {
  return CARDINALS[yawQuadrant(bot)]
}

/**
 * The four cardinals in PREFERENCE order for a bot already facing one of them:
 * straight ahead, then the two ninety-degree turns, then the reverse.
 *
 * Facing first because a bearing costs nothing to choose but something to
 * follow: the pathfinder is already pointed that way, and a stair that runs
 * where the bot was going is the one the model asked for. The reverse is last
 * because it is the only turn that walks the stair back over the ground the
 * bot just crossed.
 */
export function stairBearings (bot) {
  const q = yawQuadrant(bot)
  return [q, (q + 1) % 4, (q + 3) % 4, (q + 2) % 4].map(i => CARDINALS[i])
}

/**
 * THE GUARD'S OWN TEST FOR "I WILL NOT DIG THIS".
 *
 * Exported and used by BOTH the chooser and the guard inside `mine`, because
 * the one way a chooser can make things worse is to disagree with the guard:
 * pick a bearing the guard then refuses and the livelock is rebuilt one layer
 * up, with a lookahead scan added to pay for it.
 *
 * Deliberately NOT a general wetness test. Widening `isWet()` from `water` to
 * kelp and seagrass on 2026-08-29 multiplied drownings sevenfold and was rolled
 * back; block name equality is the predicate that has held.
 */
export function stairLiquid (b) {
  return !!b && (b.name === 'lava' || b.name === 'water')
}

/** How far a stair can see before it has to look. Four steps is one shoreline. */
export const STAIR_LOOKAHEAD = 4

/**
 * How many consecutive treads a stair from `from` along `bear` could cut before
 * the guard would refuse one, capped at `depth`.
 *
 * This is the guard's geometry replayed on paper: at step i the bot stands at
 * `from + i*bear - i*y`, and the cells it must open are the tread one along and
 * one down, plus the headroom over it. Nothing is dug and nothing moves.
 */
export function stairRunway (bot, from, bear, depth = STAIR_LOOKAHEAD) {
  let n = 0
  for (let i = 0; i < depth; i++) {
    const stand = from.offset(bear.x * i, -i, bear.z * i)
    if (stairLiquid(bot.blockAt(stand.offset(bear.x, -1, bear.z))) ||
        stairLiquid(bot.blockAt(stand.offset(bear.x, 0, bear.z))) ||
        stairLiquid(bot.blockAt(stand.offset(bear.x, 1, bear.z)))) break   // the third cell, too
    n++
  }
  return n
}

/**
 * The neighbourhood that decides whether opening a cell lets a liquid in:
 * above, and the four horizontals. NOT below -- both mineflayer-pathfinder's
 * `dontCreateFlow` (lib/movements.js, Movements.safeToBreak) and Baritone's
 * `avoidAdjacentBreaking` check exactly these five and deliberately skip down,
 * because a block sitting ON liquid is not a way in.
 */
const FLOW_NEIGHBOURS = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]

/**
 * How many liquid faces the stair would expose if it ran `bear` from `from`.
 *
 * A TIE-BREAK, NOT A GUARD. Upstream treats liquid adjacency as a hard refusal
 * to break the block. THE NEXT CLAUSE IS FALSE OF THE DEPLOYED VERSION and is
 * left visible rather than quietly deleted, because it is the sentence that would
 * reassure the next reader: `grep -rn dontCreateFlow node_modules/
 * mineflayer-collectblock/` returns NOTHING in 1.5.0. What it actually does is the
 * opposite -- `lib/CollectBlock.js:70` re-runs
 * `bot.pathfinder.movements.safeToBreak(block)` inside `mineBlock` and, on
 * failure, calls `removeTarget(block); return` SILENTLY: no throw, no log. And
 * index.mjs hands it OUR gatherMoves, which sets dontCreateFlow = true.
 *
 * Scope, twice corrected because both drafts over-claimed (Codex passes 1 and 2):
 * that sink is GATHER's, reached through collectblock. It does not protect or
 * constrain `mine`, which digs directly. And "ships inert" is too strong -- what
 * admitting a liquid-adjacent candidate in GATHER's filter actually buys is a walk
 * to the tree, the pathfinding for it and the elapsed budget, and then no dig and
 * no word from collectblock. The bot's behaviour DOES change; what does not change
 * is that any wood comes of it.
 * (superseded text: mineflayer-collectblock then turns that refusal off on
 * every single call -- CollectBlock.ts sets `dontCreateFlow = false` before each
 * collect) because as a veto it stops the bot doing anything. So it is used
 * here only to order cardinals that are otherwise equally dry: at a shoreline,
 * two directions can both run four dry steps while one of them runs along the
 * water and the other runs inland. Inland is the one that does not flood.
 *
 * It can never add a refusal, which matters: this whole change exists to stop
 * `mine` refusing, and a new veto smuggled in beside it would be a bad trade.
 */
export function stairFlowRisk (bot, from, bear, depth = STAIR_LOOKAHEAD) {
  let touching = 0
  const n = stairRunway(bot, from, bear, depth)
  for (let i = 0; i < n; i++) {
    const stand = from.offset(bear.x * i, -i, bear.z * i)
    for (const cell of [stand.offset(bear.x, -1, bear.z), stand.offset(bear.x, 0, bear.z), stand.offset(bear.x, 1, bear.z)]) {
      for (const [dx, dy, dz] of FLOW_NEIGHBOURS) {
        if (stairLiquid(bot.blockAt(cell.offset(dx, dy, dz)))) touching++
      }
    }
  }
  return touching
}

/**
 * WHICH WAY THE STAIR SHOULD RUN.
 *
 * Returns `{ bear, runway, flow }` for the best cardinal, ranked
 * lexicographically:
 *
 *   1. the longest DRY RUN, because a bearing that dies in one step just moves
 *      the refusal one step along;
 *   2. then the fewest LIQUID FACES exposed, which at a shoreline is the
 *      difference between digging inland and digging along the water;
 *   3. then the way the bot is already FACING, because turning for no reason
 *      costs a walk nobody asked for and makes the stair unpredictable.
 *
 * `runway === 0` means every cardinal is wet at its first tread. That is a fact
 * about where the bot is standing, not about mining, and `mine` says so.
 *
 * Nothing is dug and nothing moves: at most 4 bearings x 4 steps x 2 cells x
 * 6 reads of an already-loaded chunk.
 */
export function chooseStairBearing (bot, from, depth = STAIR_LOOKAHEAD) {
  let best = null
  for (const bear of stairBearings(bot)) {
    const runway = stairRunway(bot, from, bear, depth)
    const flow = runway === 0 ? 0 : stairFlowRisk(bot, from, bear, depth)
    if (!best || runway > best.runway || (runway === best.runway && flow < best.flow)) {
      best = { bear, runway, flow }
    }
  }
  return best
}

// --------------------------------------------------------------- sleep -----
async function sleepSkill(ctx, _args, signal) {
  const { bot } = ctx
  if (!isNightTime(bot)) return { status: 'failed', failClass: 'other', detail: 'can only sleep at night' }

  const findBed = () => bot.findBlock({ matching: b => bot.registry.blocks[b.type]?.name?.endsWith('_bed'), maxDistance: 32 })
  let bed = findBed()
  if (!bed) {
    const inBag = bot.inventory.items().find(i => i.name.endsWith('_bed'))
    if (!inBag) {
      // Same reachability flaw deposit had: the town beds stand at home and a
      // 32-block scan cannot see them from a mine. Walk home, rescan, and only
      // then admit there is nowhere to sleep.
      // Same rescue path as deposit. The comment above says "same reachability
      // flaw deposit had" and then repeated deposit's OTHER flaw: a raw goto
      // that surrenders to the first hazard interrupt.
      const walked = await home(ctx, {}, signal)
      check(signal)
      // Rescan before judging the walk -- same lesson as deposit: a walk that
      // fell short of home can still have brought the beds into scan range.
      bed = findBed()
      if (!bed && walked.status === 'failed') {
        return { ...walked, detail: `no bed nearby; walking home to the town beds failed: ${walked.detail}` }
      }
      if (!bed) {
        return { status: 'failed', failClass: 'inventory',
                 detail: 'no bed nearby and none in inventory, even at home' }
      }
    }
    if (!bed && inBag) {
    const placed = await place(ctx, { item: inBag.name }, signal)
    // INHERIT THE CLASS FROM THE CALL THAT FAILED. This wrapped place()'s prose
    // in its own and handed the result to classifyFailure, which saw "no solid
    // block ... within reach", matched its no/within rule and returned
    // `nothing_found` -- an EVIDENCE class. So a bot that could not put a bed
    // down was recorded as having searched for one and found none, and the
    // avoid rule that produced was about `sleep`. place() knew it was `no_space`
    // all along.
    if (placed.status !== 'success') {
      return { status: 'failed', failClass: placed.failClass ?? 'other',
               detail: `could not place bed: ${placed.detail}` }
    }
    bed = bot.findBlock({ matching: b => bot.registry.blocks[b.type]?.name?.endsWith('_bed'), maxDistance: 8 })
    // WE PUT ONE DOWN AND THEN COULD NOT SEE IT. That is a failed OBSERVATION,
    // not a failed placement -- place() already read the block back out of the
    // world before returning success, so the bed is there and findBlock is what
    // came up empty. Reporting it as a failure of `sleep` would teach the fleet
    // that sleeping does not work on the evidence of a lookup that missed.
    if (!bed) {
      return { status: 'unknown', failClass: 'unverified',
               detail: 'placed a bed but cannot find it within 8 blocks — cannot confirm where it went' }
    }
    }
  }

  check(signal)
  try {
    await withTimeout(bot.pathfinder.goto(
      new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2)), 12000, bot)
    await bot.sleep(bed)
    return { status: 'success', detail: 'sleeping through the night' }
  } catch (e) {
    // The 12s walk to the bed is our own budget, so its expiry says nothing
    // about whether the bot could have got there -- same rule as goto's.
    return e.budgetExceeded
      ? { status: 'unknown', failClass: 'path_budget',
          detail: `ran out of the 12s budget walking to the bed at ${bed.position.x},${bed.position.z}` }
      : { status: 'failed', failClass: 'other', detail: `sleep failed: ${e.message}` }
  }
}

function isNightTime(bot) {
  const t = bot.time?.timeOfDay ?? 0
  return t >= 12542 && t <= 23458
}

/**
 * What each skill is FOR, declared rather than inferred.
 *
 * `expects` names the durable change a skill is supposed to produce. That one
 * field turns "did the call return cleanly?" into "did the thing it exists to do
 * actually happen?" -- which is the difference between an agent that works and
 * one that has learned to return success.
 *
 * Measured need: 46% of this fleet's "successes" moved zero blocks and changed
 * no inventory. `status` was recorded as a win 115 times and the prompt duly
 * told the bot it was its most reliable action. Judging by declared intent
 * fixes that generically -- zero movement is fine for `status` and a failure
 * for `gather`.
 *
 * Deliberately a CONTRACT, not per-skill reward weights. Nothing here is tuned;
 * each entry just says what kind of evidence would show the skill did its job.
 */
/**
 * The identity of an action, for remembering how it went.
 *
 * Canonical and exported, because this used to exist twice -- once in
 * admission.mjs and once in lessons.mjs -- and the two had to agree exactly or
 * a failure recorded under one spelling would be invisible to the gate reading
 * the other. Two definitions of the same concept is a divergence waiting for a
 * quiet afternoon.
 *
 * Only DECLARED arguments count, sorted. The model routinely emits extras
 * (`craft {item: stick, player: agent}` -- craft has no player argument), and
 * keying on them made the key space unbounded: each hallucinated value minted a
 * fresh entry with a clean record, which passed the gate, failed, and left one
 * more permanent block behind.
 */
// A CROSSING IS NOT A RESCUE, AND IT IS NOT A WALK EITHER.
//
// Until today this agent had no word for travelling through water. "swim"
// existed only inside the drowning reflex, as something you do to stop dying,
// and the planner priced a wet step at ~86 against ~1 on land so A* would never
// choose one. The result was an agent that could not cross a river on purpose,
// in a game where water is most of the map.
//
// It could cross one by accident, though, and did. Measured 2026-08-22:
// board-b-Comet moved (1544,425) -> (1556,473) -- about 50 blocks -- while
// logging ninety consecutive `drowning_no_shore` events. placebo-b-Delta and
// placebo-a-Echo both reached land unaided. All three were swimming. All three
// were recorded as failed rescues, and the reflex spent the whole time holding
// them still (`forward:false, jump:true`) waiting for a shore that was not
// within its scan radius, releasing at the ceiling, and re-seizing on the next
// submersion. `drowning_reentry` fired 74 times against 108 releases: that
// counter was not measuring rescue, it was measuring a livelock.
//
// WHY THIS DOES NOT USE THE PATHFINDER FOR THE LONG LEG.
//
// A* plans node by node through loaded chunks. An ocean crossing is thousands of
// nodes of near-identical open water with no landmarks to prune on, and the far
// shore is not loaded when the plan is made. Asking A* for that route is asking
// it to fail slowly. So this is macro-routing: the pathfinder is not involved in
// the open-water segment at all -- the bot points at the target and swims, which
// is what a person does. `goto` still owns the land legs at either end.
//
// swim_to WAS DELETED HERE, 2026-09-09, and this note is the receipt.
//
// It travelled SUBMERGED for speed. Driving prismarine-physics directly on a
// 1.21.8 ocean, submerged is 1.9600 b/s with sprint on OR off -- bit-identical,
// because prismarine-physics contains the string "swim" ZERO times -- against
// 2.0853-2.1475 b/s at the surface. Diving was ~7% SLOWER. The skill's founding
// premise was not merely unreachable, it was inverted: it dove to go slower and
// paid drowning for it.
//
// It arrived 111 times in 760 crossings (14.6%) across its whole life, was
// repaired twice, and read 55.9% for six hours in September only because a
// scoring change of mine credited "moved 2 blocks while drowning" as travel.
//
// It also read bot.oxygenLevel in five places including its abort condition --
// the field mineflayer populates from ANY nearby entity's air_supply, so a
// passing cod could end a crossing. See oxygen.mjs.
//
// Nothing replaces it. mineflayer-pathfinder swims unconditionally, goto ran
// 85.4% on the 274 crossings the admission veto accidentally let through, and
// the one thing genuinely missing -- stepping back out onto a shore -- was a
// height-arithmetic bug fixed in watermoves.mjs. Ten open-source Minecraft
// agent projects were surveyed and NOT ONE exposes a water-travel verb;
// Baritone, the most mature pathfinder in the field, prices submerged travel at
// COST_INF and its author's swim PR has sat open since 2023.
//
// Diving as a deliberate capability -- shipwrecks, drowned, underwater ruins --
// is a separate skill for the day something needs it, and it will not be this
// one.

// A TOOL IS A CAPABILITY, NOT AN ITEM NAME.
//
// This file already learned the lesson for travel, and the comment sits in
// milestones.mjs beside M.travel: "A fixed coordinate can be genuinely
// unreachable ... and then the milestone can never complete and the bot loops on
// it forever. Rewarding displacement lets any workable route count."
//
// Craft never got the same treatment, and it cost ten hours of a bot's life.
// isolated-a-Alpha sat entombed at y=2 from 05:03 carrying 24 cobbled_deepslate,
// 6 sticks and 99 crafting tables -- everything needed for a STONE pickaxe, which
// would have dug it out -- while it failed over and over to craft the WOODEN one
// the milestone named, because wood is on the surface and the surface needs a
// pickaxe. cobbled_deepslate is a valid stone-tool ingredient in 1.21.8;
// minecraft-data confirms cobblestone, cobbled_deepslate and blackstone.
//
// So when the named tool is unmakeable, look for one of the SAME KIND that is.
// Mining capability order -- wood and gold mine the same tiers, which is why they
// share a rank.
const TOOL_RANK = { wooden: 1, golden: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 }
const TOOL_RE = /^(wooden|golden|stone|iron|diamond|netherite)_(pickaxe|axe|shovel|sword|hoe)$/

/**
 * Tools of the same kind that are STRICTLY better than `item`.
 *
 * `equivalentTools` is at-least-as-good, which is what a CAPABILITY test wants:
 * a bot holding a golden pickaxe has satisfied "craft a wooden pickaxe", so
 * M.craft is right to accept it. It is the wrong test for ADVICE, and the
 * difference was dormant only because the fleet could not reach the tier.
 *
 * gold shares wooden's mining rank (TOOL_RANK above), so `equivalentTools`
 * returns golden_pickaxe for a bot that asked for a wooden one -- and
 * craftableAlternative then tells it the gold one is "strictly better", which is
 * false. That was harmless while no bot could hold a gold ingot: `recipesFor`
 * checks the inventory, and `iron_ingot`, `gold_ingot` and `charcoal` had never
 * existed in this fleet's history, so the branch was unreachable.
 *
 * SHIPPING `smelt` MAKES IT REACHABLE. raw_gold and gold_ore smelt to
 * gold_ingot, so the first bot to smelt gold gets told to downgrade its pickaxe
 * to the same mining tier it already had. Adding the verb without this would
 * have un-dormanted a known bug, which is worse than leaving it dormant.
 */
export function strictlyBetterTools (item) {
  const m = TOOL_RE.exec(item || '')
  if (!m) return []
  const [, tier, kind] = m
  const want = TOOL_RANK[tier]
  return Object.entries(TOOL_RANK)
    .filter(([, r]) => r > want)
    .map(([t]) => `${t}_${kind}`)
}

/** Tools of the same kind that are at least as capable as `item`. */
export function equivalentTools (item) {
  const m = TOOL_RE.exec(item || '')
  if (!m) return []
  const [, tier, kind] = m
  const want = TOOL_RANK[tier]
  return Object.entries(TOOL_RANK)
    .filter(([t, r]) => r >= want && t !== tier)
    .map(([t]) => `${t}_${kind}`)
}

/**
 * Is there a BETTER tool of the same kind the bot could make right now?
 *
 * The bot only sees what the failure detail tells it. Saying "gather oak_log
 * first" to a bot sealed under 60 blocks of stone is advice it cannot take, and
 * it will take it anyway, forever. If something in the same family is actually
 * makeable from what it is carrying, say THAT instead -- it is the difference
 * between a dead end and a way out.
 *
 * "RIGHT NOW FROM WHAT YOU CARRY" HAS TO BE TRUE, and for 24,764 recorded
 * suggestions it was not. This asked `recipesAll`, which returns every recipe
 * that EXISTS for an item and never looks at the inventory -- `recipesFor` is
 * the one that checks (mineflayer craft.js:203 vs :214). It also built a `have`
 * map and then never read it, which is the intent showing through the defect.
 *
 * The result was the exact opposite of the function's purpose. golden_pickaxe
 * shares wooden's mining rank, so it comes first for a bot that asked for a
 * wooden one -- and gold is the one metal nothing underground yields without
 * smelting. Measured over the block: 17,523 "you can craft golden_pickaxe right
 * now" and 6,973 "iron_pickaxe", against a fleet that has never smelted an
 * ingot -- 98.9% of all such advice impossible, and concentrated on the frozen
 * bots (hive-b-Echo 1,959; isolated-a-Alpha 885).
 *
 * isolated-a-Alpha is the case this function was written FOR -- the comment
 * above TOOL_RANK names it -- and it sat at y=2 holding 24 cobbled_deepslate
 * and 10 sticks, which is a stone_pickaxe, being told 885 times to make gold.
 */
export function craftableAlternative (bot, item) {
  try {
    // NOT SWAPPED TO strictlyBetterTools, AND THAT IS A DELIBERATE NON-CHANGE.
    //
    // See the note on strictlyBetterTools: shipping `smelt` makes gold_ingot
    // reachable for the first time, which un-dormants this function's ability to
    // call a golden pickaxe "strictly better" than a wooden one. It is not --
    // TOOL_RANK gives them the same mining rank.
    //
    // The one-line fix is written, exported and tested above. It is NOT applied
    // here, because test/craftable-alternative.test.mjs:127 deliberately asserts
    // the opposite ("a bot that DOES carry gold is still told about gold"), and
    // gold is genuinely the FASTEST-mining tier -- so "is a golden pickaxe worth
    // suggesting?" is a real question about Minecraft tool semantics, not an
    // oversight to be quietly reversed inside an unrelated change. CLAUDE.md
    // requires independent review before resting a change on external Minecraft
    // behaviour, and that review has not happened.
    //
    // Recorded rather than fixed, so the silence is not mistaken for nobody
    // having looked. Practical exposure today is low: the branch needs 3
    // gold_ingot AND 2 sticks in hand, gold ore is far rarer than iron, and the
    // fleet holds 13 raw_iron against 0 raw_gold.
    const alts = equivalentTools(item)
    if (!alts.length) return ''
    for (const alt of alts) {
      const it = bot.registry?.itemsByName?.[alt]
      if (!it) continue
      // recipesFor(id, metadata, minResultCount, craftingTable). The table
      // argument stays truthy: the bot carries tables, and `craft` places one
      // itself, so a 3x3 recipe is legitimately available to it.
      const recipes = bot.recipesFor ? bot.recipesFor(it.id, null, 1, true) : []
      if (recipes.length) {
        return ` -- BUT you can craft ${alt} right now from what you carry, and it is strictly better; craft that instead.`
      }
    }
  } catch { /* registry or recipe lookup unavailable */ }
  return ''
}
/**
 * WHAT A BOT NEEDS TO LEGALLY CONTINUE A DESCENT IT JUST ABORTED.
 *
 * THE EXIT CONTRACT REFUSES FOR THREE REASONS AND USED TO ANSWER ONE.
 *
 * `canContinueDescent` returns `scaffold`, `pickaxe` or `health`. The abort
 * site turned only `scaffold` into a prerequisite -- `exit.reason === 'scaffold'
 * ? scaffoldPrereqFor(exit) : undefined` -- so a descent stopped for a TOOL
 * adopted no prerequisite at all, and the prose it did get read
 *
 *     "Run surface now, or gather blocks before going deeper."
 *
 * which is the wrong remedy, told to the bot for whom it is most wrong. That is
 * not a new mistake: `climbPrereqFor` in reflex.mjs carries a comment about the
 * identical bug one layer over -- "Answering it with 'gather blocks' sends a bot
 * that is short a TOOL to go and fetch gravel."
 *
 * THIS ADDS NO REFUSAL. The refusal already fires and already stops the descent;
 * only the remedy attached to it changes. That matters, because a new refusal is
 * how this project has manufactured four separate traps, and the remedy channel
 * cannot manufacture one: the bot's legal moves are identical before and after.
 *
 * IS THE REMEDY EXECUTABLE FROM HERE? For the pickaxe branch, yes, and it is
 * worth saying why rather than asserting it. `mine` now descends by a WALKABLE
 * STAIRCASE, and this refusal fires BEFORE the next tread is cut -- so the bot
 * is standing at the top of a 1:1 ramp it can walk back up with no blocks and no
 * tool. That is what makes "go up, then get a pickaxe" a move it can make. It
 * would NOT have been true of the shaft this skill used to dig, and if the
 * staircase is ever reverted this advice reverts with it.
 *
 * `health` gets no prerequisite on purpose. The bus fetches ITEMS; there is no
 * item whose acquisition is "wait", and inventing one sends the bot shopping.
 */
export function exitPrereqFor (exit) {
  if (!exit || exit.ok) return undefined
  if (exit.reason === 'scaffold') {
    const short = Math.max(8, (exit.want ?? 16) - (exit.have ?? 0))
    return {
      items: ['cobblestone', 'cobbled_deepslate', 'dirt', 'stone', 'andesite',
              'diorite', 'granite', 'gravel', 'tuff', 'deepslate'],
      count: short,
      describe: `Gather ${short} blocks before descending further — you need them to pillar back out.`,
      because: 'descent aborted to preserve an exit',
    }
  }
  if (exit.reason === 'pickaxe') {
    return {
      items: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'],
      count: 1,
      describe: 'Get a pickaxe before descending further — you are short a TOOL, not ' +
                'blocks. The stairs behind you are walkable: go up first, then craft one.',
      because: 'descent aborted to preserve an exit',
    }
  }
  return undefined
}

/** The one-line tail on the refusal, matched to the same three reasons. */
export function exitAdviceFor (exit) {
  if (!exit || exit.ok) return ''
  if (exit.reason === 'pickaxe') {
    return ' You are short a TOOL, not blocks: get a pickaxe before going deeper. ' +
           'The stairs behind you are walkable, so run surface first.'
  }
  if (exit.reason === 'health') {
    return ' Eat or retreat before going deeper; the climb out costs more than the dig down.'
  }
  return ' Run surface now, or gather blocks before going deeper.'
}

/**
 * Does this block have a face the bot could reach? A FACT, not a preference.
 *
 * Lifted out of gather() so the observation layer can ask the same question
 * the skill asks. It was answered 435 times in three hours as
 * "found but every candidate is buried" -- AFTER the model had already spent
 * its decision on that block, because NEARBY reports what is visible and
 * nothing had ever reported what is actionable.
 *
 * One definition on purpose. A second copy in prompt.mjs would drift, and the
 * observation would start promising things the skill then refuses.
 */
export function isExposed (bot, p) {
  for (const d of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const n = bot.blockAt(p.offset(d[0], d[1], d[2]))
    if (!n || n.name === 'air' || n.boundingBox === 'empty') return true
  }
  return false
}

/**
 * FOLIAGE IS COVER YOU CAN BREAK, AND THAT IS A LAST RESORT, NOT A PREFERENCE.
 *
 * `oak_leaves.boundingBox` is `'block'` in the fleet's own minecraft-data, so a
 * trunk inside its own canopy has six solid neighbours, `isExposed` returns
 * false, and `gather` refuses "every candidate is buried -- use mine to dig
 * down" for a log at y=68. Measured 24 h to 2026-09-19 12:25Z: **8,034 buried
 * refusals, 4,785 of them (59.6%) oak_log**, median bot y 68, only 22.4% below
 * sea level. The bots were not underground, and the gather->mine escalation
 * cannot help because `WORTH_TUNNELLING` is ores by design.
 *
 * WHY THIS IS A SEPARATE PREDICATE AND NOT A WIDER `isExposed`.
 *
 * It WAS a wider `isExposed`. That canary (leaf-01, 2850cde, board-a+board-c,
 * 19 Sep) read **logs acquired -0.65 DiD** and was reverted by its own gate. It
 * did not fail to fire -- 209 gather runs of exposure -- it fired and made the
 * fleet worse, and the mechanism is displacement, not danger:
 *
 *   - A leaf-covered log cannot satisfy `approachable` (its leaf neighbours are
 *     boundingBox 'block', so no cell beside it has clear feet AND head), so it
 *     lands in the second tier of `reachable`.
 *   - `probeReachable` then takes the nearest FOUR of that combined list and
 *     `GoalGetToBlock`'s isEnd is **distance only** -- foliage does not prevent
 *     a hit. Covered logs at distance 2/3/4/5 fill the slate outright, and the
 *     one that hits is MOVED TO THE FRONT, ahead of a genuinely open log the
 *     bot could have walked to.
 *   - Breaking it is not acquiring it: `pickupNearbyItems` walks to the drop and
 *     gives up after seeing the same entity twice, and a log dropping inside a
 *     canopy is exactly that case.
 *
 * So the widening spent the bot's gather on the worse target. This version
 * admits the identical set of blocks -- the rule below is byte-for-byte leaf-01's
 * -- but only where `gather_via_source` sits: AFTER every open candidate is
 * exhausted, where the counterfactual is a refusal rather than a better target.
 * It can turn a failure into an attempt and it cannot turn a success into one.
 *
 * SCOPE, stated exactly. ONE leaf face is enough; five stone faces and a single
 * leaf face reads covered-not-buried, because that leaf IS a way in -- the
 * pathfinder equips and breaks obstructing blocks en route
 * (mineflayer-pathfinder/index.js:483-492) and all 11 leaf types in 1.21.11 are
 * hardness 0.2 with no harvest-tool requirement. Broader than "a trunk in its
 * canopy", admitted on purpose, and UNCHANGED from leaf-01 so that rank
 * position is the single variable between the two reads.
 *
 * LOGS ONLY. Letting a leaf face admit any target made one leaf-adjacent DIRT
 * block set `reachable.length !== 0`, which switches off the alternative-source
 * search that would have found an accessible `grass_block` -- a verified
 * regression turning a gather that used to succeed into a failure. Dirt and
 * stone lie exposed on every hillside and never needed this.
 */
export const BREAKABLE_COVER = /_leaves$/
export const COVER_EXEMPT_TARGET = /_log$/

/**
 * A log that `isExposed` calls buried, whose cover includes foliage.
 *
 * Deliberately conjunctive with `!isExposed`: anything with a genuinely open
 * face is already a normal candidate and must never be routed through the
 * fallback, or the fallback would start competing with the thing it backs up.
 */
/**
 * WHERE a foliage-covered log may enter the candidate list: nowhere, unless the
 * list is empty. This is THE single variable between leaf-01 (2850cde, logs
 * acquired -0.65 DiD, reverted) and this build, so it is a function rather than
 * an `if` -- `coverFallback([openLog], [coveredLog])` returning null IS the
 * regression test for that revert, and an `if` inside `gather` could not be
 * asked the question.
 *
 * Re-asserts the emptiness itself rather than trusting the caller's guard. The
 * caller keeps its own `reachable.length === 0` check only to avoid scanning
 * `positions` on every healthy gather; correctness lives here.
 */
/**
 * WHICH FAILURE A BARREN GATHER IS -- AND THE ONLY ONE OF THE THREE THAT TEACHES.
 *
 * `no_path` is in cognitive.mjs's `EVIDENCE_ABOUT_THE_ACTION`, so it calls
 * `lessons.recordFailure` and becomes a PERSISTENT avoid rule against
 * `gather oak_log`. `unreachable` is in none of those sets and teaches nothing.
 *
 * Found by Codex pass 2, by executing the loop: with three safe foliage-covered
 * logs and a collect that returns without items, HEAD refuses once as
 * `unreachable` and the patched build makes three attempts and returns
 * `no_path`. So a speculative last resort that came back empty would have
 * trained the fleet to stop asking for wood at all -- the same mechanism that
 * once left 70 of 80 bots forbidden to craft a wooden pickaxe.
 *
 * This is also the best available explanation of leaf-01's -0.65: it put these
 * blocks in the MAIN list, so the barren rounds were many and the avoid rules
 * would ACCUMULATE across the 180-minute window rather than costing one run.
 * Displacement alone is per-run and does not compound; this does.
 *
 * ANY cover attempt in the run downgrades it, not just an all-cover run. The
 * barren count cannot be attributed per candidate, and this file's standing
 * mistake is teaching a durable lesson from a failure nobody could classify.
 * Refusing to teach costs a re-ask; teaching wrongly costs the tech tree.
 */
export function barrenFailClass (timedOut, barren, coverRounds = 0) {
  if (timedOut >= barren) return 'collect_budget'
  return coverRounds > 0 ? 'unreachable' : 'no_path'
}

export function coverFallback (primary, covered, { approachable = () => false, collected = 0 } = {}) {
  if (!Array.isArray(primary) || primary.length !== 0) return null
  // A PARTIAL SUCCESS IS A SUCCESS, AND THIS MAY NOT GAMBLE IT (Codex pass 1).
  //
  // This fallback sits ABOVE `if (collected > 0) return success` in gather, so
  // without this line a run that had already banked a log would go on to try a
  // covered one instead of returning. Executed counterexample: the covered
  // attempt throws, `gained` comes back 0, `collected = gained` overwrites the
  // banked count, and the run returns FAILED -- a gather that used to succeed
  // turned into a failure. That is the same shape as the regression leaf-01's
  // pass 2 fixed for dirt, arriving by a different door.
  //
  // With it, the claim this change rests on is true as written: it can turn a
  // failure into an attempt, and it cannot turn a success into one.
  if (collected > 0) return null
  const c = Array.isArray(covered) ? covered : []
  if (!c.length) return null
  // Same two-tier order as the main list: a covered log the bot can stand beside
  // still beats one it cannot.
  return [...c.filter(approachable), ...c.filter(q => !approachable(q))]
}

export function foliageCovered (bot, p) {
  const target = bot.blockAt(p)
  if (!target || !COVER_EXEMPT_TARGET.test(target.name || '')) return false
  if (isExposed(bot, p)) return false
  for (const d of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const n = bot.blockAt(p.offset(d[0], d[1], d[2]))
    if (n && BREAKABLE_COVER.test(n.name || '')) return true
  }
  return false
}

/**
 * Would the pathfinder refuse to break this? Also a FACT: safeToBreak rejects
 * anything adjacent to a liquid (dontCreateFlow) and anything under a block
 * that can fall (dontMineUnderFallingBlock).
 *
 * Defaults to TRUE when it cannot be asked. An observation that reports
 * "unusable" because the movements object was missing would teach the model
 * the world is emptier than it is, and a false negative here is worse than a
 * false positive: it removes a real option.
 */
/**
 * The five faces `dontCreateFlow` checks. NOT below: a block sitting ON liquid
 * is not a way in. Same set as FLOW_NEIGHBOURS, kept separate because that one
 * describes a stair's exposure and this one names a library rule.
 */
export const FLOW_FACES = [[0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]]

/**
 * WHICH of safeToBreak's two rules refused this block.
 *
 * `Movements.safeToBreak` ORs `dontCreateFlow` (liquid on any of five faces)
 * with `dontMineUnderFallingBlock` (a fallable block, or an entity, directly
 * above) and returns a single false. Every refusal therefore reads the same,
 * and the skill's message says "beside water or under falling blocks" because
 * it genuinely cannot tell.
 *
 * That ambiguity is currently blocking a decision. 18% of all gather runs fail
 * `no_safe_target`, and 320 of 958 of them are SAND -- which is itself a
 * falling block, so an unknown share of the 18% is the rule nobody proposes to
 * touch. The best proxy available from telemetry is "no liquid of any kind in
 * the perception scan", which bounds it at 3.2% and settles nothing, because a
 * scan is a 32-block radius and the rule reads five cells.
 *
 * So: measure it instead of estimating it. Pure, so it can be tested; the
 * caller gathers the cells.
 *
 * Returns 'liquid', 'falling', 'entity', 'both', or null when nothing refuses.
 */
export function breakVeto ({ above = null, sides = [], entitiesAbove = 0 } = {}) {
  const isLiquid = b => !!(b && b.liquid)
  const liquid = isLiquid(above) || sides.some(isLiquid)
  const falls = !!(above && above.canFall)
  const blocked = Number(entitiesAbove) > 0
  if (liquid && (falls || blocked)) return 'both'
  if (liquid) return 'liquid'
  if (falls) return 'falling'
  if (blocked) return 'entity'
  return null
}

/**
 * WHICH liquid, and on WHICH face. A MEASUREMENT, not a decision.
 *
 * `breakVeto` above answers one question -- may this block be broken -- and
 * collapses every liquid to the token `liquid`. That is the right answer for a
 * veto and the wrong one for an investigation: 33% of wood gather runs die here,
 * and nothing downstream can tell a shoreline tree (water beside, flowing, decays
 * over seven blocks on ground that is solid by generation) from lava, or from
 * water ABOVE, which is a column that pours down and re-spreads at the bottom --
 * the case `dontCreateFlow` actually exists for.
 *
 * THIS DOES NOT COLLAPSE. It reports the above face and a count per kind across
 * the four horizontal faces, because a token that picks a winner hides exactly
 * what the measurement is for: `[water, unknown_fluid]` reported as `side_water`
 * would fold an unknown fluid into the bucket someone later proposes to relax,
 * and `above: water, sides: [lava]` reported as `above_water` would hide lava
 * entirely (Codex pass 1). Mixed neighbourhoods stay mixed here.
 *
 * WHAT THIS COSTS, STATED RATHER THAN CLAIMED AWAY. It is not "behaviour-inert":
 * it adds up to 160 local block reads (5 faces x at most 32 candidates, already
 * bounded by findBlocks count:32) plus one queued event, on a path that has
 * already failed. What it does NOT touch is any decision: `breakVeto`, the veto
 * histogram, `result.detail` and therefore the LAST ACTION sentence the model
 * reads are byte-identical to baseline. Note also that `logEvent` stamps
 * `trigger: reflex`, and scripts/reflect.py aggregates by trigger -- so this is
 * invisible to the MODEL, not to every reader downstream.
 *
 * WHY IT IS A SEPARATE FUNCTION AND A SEPARATE EVENT. The first version widened
 * `breakVeto`'s own token, and that is NOT behaviour-inert however it looks: the
 * histogram built from it goes into `result.detail`, `cognitive.mjs` copies that
 * into `lastOutcome` and memory, and `prompt.mjs` renders it to the model as
 * LAST ACTION. Changing the token changes the text the model reads and therefore
 * can change what it decides next. It also broke eleven literal assertions in
 * break-veto.test.mjs, including a real-block integration test. So the veto, its
 * token, the histogram and the model-facing sentence are all left exactly as they
 * were, and the breakdown is emitted alongside as its own event.
 *
 * An unknown liquid is reported as `liquid`, never guessed as water: guessing
 * would invent the very distinction this function exists to measure.
 */
export function liquidKind (b) {
  if (!b) return null
  const n = String(b.name || '')
  if (n === 'water' || n === 'flowing_water' || n === 'bubble_column') return 'water'
  if (n === 'lava' || n === 'flowing_lava') return 'lava'
  // `liquid` is a DECORATION Movements.getBlock writes (movements.js:236-238).
  return b.liquid ? 'liquid' : null
}

export function liquidFaces ({ above = null, sides = [] } = {}) {
  const sideCounts = {}
  for (const b of sides) {
    const k = liquidKind(b)
    if (k) sideCounts[k] = (sideCounts[k] ?? 0) + 1
  }
  return { above: liquidKind(above), sides: sideCounts }
}

/**
 * Render one candidate's liquid neighbourhood as a stable, greppable token set.
 * Sorted so the same neighbourhood always reads the same way.
 */
/**
 * Order the emitted buckets so TRUNCATION CANNOT EAT THE RARE ONE.
 *
 * logger.mjs caps event detail at 300 characters. Sorted by frequency, a long
 * tail of mixed neighbourhoods pushes the rare buckets off the end -- and the
 * rare bucket is lava, the single case nobody may relax (Codex pass 2). So
 * anything naming lava sorts first, then an unknown fluid, then the rest by
 * frequency.
 *
 * Exported because it must be TESTED, and because the first attempt to test it
 * re-implemented this ranking inside the test file: the assertion then passed
 * against a mutated source, which is a test that cannot fail. Extracting the
 * decision is the repo's own rule for exactly this.
 */
export function orderFaceBuckets (faces = {}) {
  const rank = k => (String(k).includes('lava') ? 0 : String(k).includes('liquid') ? 1 : 2)
  return Object.entries(faces).sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1])
}

export function liquidFacesLabel (faces) {
  const parts = []
  if (faces?.above) parts.push(`above_${faces.above}`)
  for (const k of Object.keys(faces?.sides ?? {}).sort()) parts.push(`side_${k}x${faces.sides[k]}`)
  return parts.join('+') || 'none'
}

/**
 * `breakVeto` for a live bot at a position. Returns null when it cannot ask --
 * the same direction as `isSafeToBreak`, which defaults to SAFE when the
 * movements object is missing, so this never invents a refusal that the real
 * predicate would not make.
 */
export function breakVetoAt (bot, p) {
  try {
    const m = bot.collectBlock?.movements ?? bot.pathfinder?.movements
    if (!m) return null
    // `m.getBlock`, NEVER `bot.blockAt`.
    //
    // `liquid` and `canFall` are not properties of a prismarine block. They are
    // DECORATIONS that Movements.getBlock writes on (movements.js:236-238,
    // `b.liquid = this.liquids.has(b.type)`), and safeToBreak only ever reads
    // blocks that came through it. Verified against the 1.21.8 registry:
    // Block.fromStateId for water, lava, sand and gravel all report
    // `liquid=undefined canFall=undefined`, with hasOwnProperty false.
    //
    // The first version of this function read bot.blockAt, so it returned null
    // for every real block and would have filed 100% of refusals as `unknown`
    // -- a detector that answers uniformly, deployed as the cure for detectors
    // that answer uniformly. Its eight tests passed because every one of them
    // fed hand-decorated literals, including the one that claimed to check
    // agreement with the library.
    //
    // Reading through `m` also makes this definitionally consistent with the
    // rule it measures: same `liquids` set (which includes LAVA), same
    // `gravityBlocks` set, and the same {liquid:false, canFall:false} stub for
    // an unloaded chunk.
    if (typeof m.getBlock !== 'function') return null
    return breakVeto({
      above: m.getBlock(p, 0, 1, 0),
      sides: FLOW_FACES.slice(1).map(([dx, dy, dz]) => m.getBlock(p, dx, dy, dz)),
      entitiesAbove: m.getNumEntitiesAt?.(p, 0, 1, 0) ?? 0,
    })
  } catch { return null }
}

/**
 * WHAT THE MODEL IS TOLD IT IS CARRYING, as one readable line.
 *
 * NOT `state.mjs`'s `inventorySummary`, which aggregates to an OBJECT for
 * telemetry. Same subject, different consumer, and two exports with one name is
 * how a later reader picks the wrong one.
 *
 * The craft refusals built this with `bot.inventory.items().slice(0, 3)` --
 * the first three SLOTS, unaggregated and unsorted. A bot holding 7 stone
 * pickaxes across 7 slots was told:
 *
 *   cannot craft stone_pickaxe -- gather cobblestone first, nothing crafts it
 *   (you have 1x stone_pickaxe, 1x stone_pickaxe, 1x stone_pickaxe)
 *
 * while actually carrying 7 stone pickaxes, 150 oak logs, 48 crafting tables
 * and the 2 cobblestone that were the real problem. The advice was right and
 * every number attached to it was wrong.
 *
 * That string is not decoration. It is the observation the model reads when
 * deciding what to do about the failure, and this repo already knows that a
 * capability the observation does not name may as well not exist. It explains
 * what nothing else did: 195 of 221 wooden-pickaxe craft attempts failed, on
 * bots that already held one, because nothing ever told them so.
 *
 * So: aggregate by name, and lead with the items the DECISION turns on --
 * what is missing, then what is held most of. `focus` items always appear,
 * including at zero, because "you have 0x cobblestone" is the actionable fact
 * and its absence from a list is not.
 *
 * Pure: takes plain {name, count} objects, not a bot.
 */
/**
 * WHAT CAN PRODUCE THIS INGREDIENT, from one step away.
 *
 * Deliberately NOT a general recipe walk. The recipe walk is what the caller is
 * already doing; this answers the narrower question the RECIPE CHOICE needs --
 * "is this variant the one this bot is closest to being able to make" -- and it
 * has to be cheap enough to run inside a 12-recipe loop.
 *
 * Only the plank family is modelled, because that is the family Minecraft
 * duplicates per wood type and therefore the only one where choosing the wrong
 * variant strands a bot that is holding the right material. Stone tools take
 * cobblestone OR cobbled_deepslate OR blackstone, but those are three blocks a
 * bot gathers, not three recipes for one block, so a missing-ingredient name is
 * already actionable there.
 *
 * Returns [] for anything unmodelled, so an unknown ingredient scores zero
 * affinity rather than a guessed one. Scoring an unknown as reachable is the
 * failure this replaces.
 */
// Covers the largest recipe count in 1.21.8 (smoker, 44) with headroom.
export const RECIPE_VARIANT_CAP = 64

export function sourcesFor (name) {
  const m = /^(.+)_planks$/.exec(name ?? '')
  if (!m) return []
  const w = m[1]
  // THE TWO FAMILIES THAT ARE NOT LOGS. Checked against minecraft-data 1.21.8,
  // where every *_planks has exactly ONE recipe with exactly ONE ingredient:
  //   bamboo_planks  <- bamboo_block   (raw `bamboo` is TWO steps away: 9 bamboo
  //                                     make a block, so holding one stalk is not
  //                                     "can produce" -- that is the sapling bug
  //                                     again, one family over)
  //   crimson_planks <- crimson_stem   (Nether wood has stems and hyphae, never
  //   warped_planks  <- warped_stem     _log or _wood; the old prefix match got
  //                                     these right by accident)
  if (w === 'bamboo') return ['bamboo_block']
  if (w === 'crimson' || w === 'warped') {
    return [`${w}_stem`, `${w}_hyphae`, `stripped_${w}_stem`, `stripped_${w}_hyphae`]
  }
  return [`${w}_log`, `${w}_wood`, `stripped_${w}_log`, `stripped_${w}_wood`]
}

/** Aggregate {name, count} items into a name -> total map. */
export function heldCounts (items) {
  const out = new Map()
  for (const it of items ?? []) {
    const n = it?.name
    if (!n) continue
    const c = Number(it.count)
    out.set(n, (out.get(n) ?? 0) + (Number.isFinite(c) ? c : 0))
  }
  return out
}

/**
 * Can this bot produce the ingredient named in a gap entry ("3x birch_planks")?
 *
 * True when it holds the thing itself, or a source that makes it. A count of
 * zero is not holding it: `heldCounts` can carry a 0 for an item the pack once
 * had, and treating that as possession is how the old test counted a sapling.
 */
export function canProduce (counted, gapEntry) {
  const name = String(gapEntry ?? '').split(' ').pop()
  if (!name) return false
  const has = n => (counted?.get?.(n) ?? 0) > 0
  return has(name) || sourcesFor(name).some(has)
}

export function inventoryLine (items, { focus = [], limit = 6 } = {}) {
  const totals = new Map()
  for (const it of items ?? []) {
    const n = it?.name
    if (!n) continue
    const c = Number(it.count)
    totals.set(n, (totals.get(n) ?? 0) + (Number.isFinite(c) ? c : 0))
  }
  // A FOCUS ENTRY MAY ARRIVE COUNT-PREFIXED, AND IT WAS PRINTED TWICE.
  //
  // Callers pass `missing`, whose entries are already "3x oak_planks", straight
  // into focus. This then rendered `${count}x ${name}` on top of that and the
  // model was told:
  //
  //     cannot craft crafting_table -- needs 4x acacia_planks
  //     (you have 0x 4x acacia_planks, 2x crafting_table, ...)
  //
  // which reads as zero of something the bot may well have. Normalising here
  // rather than at the two call sites keeps the next caller from reintroducing
  // it, and a bare name passes through untouched.
  const bare = f => /^\d+x\s+(\S+)$/.exec(String(f))?.[1] ?? f
  const wanted = [...new Set(focus.filter(Boolean).map(bare))]
  const rest = [...totals.entries()]
    .filter(([n]) => !wanted.includes(n))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const shown = [
    ...wanted.map(n => [n, totals.get(n) ?? 0]),
    ...rest.slice(0, Math.max(0, limit - wanted.length)),
  ]
  if (!shown.length) return 'nothing'
  const more = Math.max(0, totals.size - shown.filter(([n]) => totals.has(n)).length)
  return shown.map(([n, c]) => `${c}x ${n}`).join(', ') + (more ? ` (+${more} more)` : '')
}

/**
 * Can a block be placed INTO this cell?
 *
 * Water was excluded here, and that quietly gated the tech tree. Measured 3h on
 * 2026-09-07: `place crafting_table` succeeded 19 times and failed 37, and 28 of
 * those 37 were "nowhere to place: no solid block with a free space above it
 * within reach". A bot at a shoreline, in a flooded pocket, or anywhere its
 * eight neighbours are water found NO candidate at all -- so it carried up to 48
 * crafting tables it could never put down, and `craft` fell through to
 * "place the crafting_table first", advice it was already trying to take.
 *
 * Minecraft treats water as replaceable: placing a block into a water cell
 * works and displaces the water. Excluding it was not a safety rule, it was a
 * mistake -- and it contradicts the standing directive that water is terrain.
 *
 * Lava STAYS excluded. Placing into lava is equally legal and the bot would be
 * reaching into it to do so, which is the one case where the cell being
 * replaceable is not the whole question.
 *
 * `boundingBox === 'empty'` is doing the real work: it admits grass, ferns,
 * snow and dead bushes -- most of a forest floor -- which an `=== 'air'` test
 * rejected and which cost this fleet its first tech-tree stall.
 */
export function placeableInto (b) {
  if (b == null || b.boundingBox !== 'empty') return false
  return b.name !== 'lava'
}

/**
 * THE SHORELINE TREE, AND NOTHING ELSE.
 *
 * `Movements.safeToBreak` ORs `dontCreateFlow` -- liquid on any of five faces
 * (movements.js:257-264) -- with `dontMineUnderFallingBlock` (:266-271), and it
 * produces **37.3% of all log-gather refusals**. The rule exists for a real
 * hazard: open a wall with water behind it in a shaft and the shaft floods. In
 * the 14 bot-hours 6d1fdba ran fleet-wide without it, five bots died against
 * zero in the windows either side.
 *
 * But it is being applied to a tree standing next to a pond. `veto_faces`
 * (8d6f6f7), reading the actual five cells through `Movements.getBlock` over 994
 * candidates and 191 refusals on 36 bots: **side-water-only 43.1%, liquid above
 * 28.7%, no liquid at all 28.3%, ANY LAVA 0.0%.**
 *
 * THE 0.0% IS NOT WHAT LICENSES THIS. Lava is excluded by the predicate below,
 * on every face, by name. A statistic about the last 994 candidates is not a
 * promise about the next one, and an earlier 5-21% lava estimate derived from a
 * `lava_corridor` proxy turned out to be simply wrong -- in the other direction,
 * which is luck and not method.
 *
 * WHAT MAKES THIS SAFE IS WHERE IT IS NOT. It is a term in `gather`'s candidate
 * filter and in the observation that must match it. It is NOT a flag on a
 * Movements object, so:
 *   - `gatherMoves.dontCreateFlow` stays true (index.mjs), which means the
 *     DIG-APPROACH TUNNEL -- which breaks walls to reach a stance -- still
 *     refuses every block touching liquid. That is the guard whose absence cost
 *     the five deaths.
 *   - `mine` never sees this. It has its own liquid handling (`stairLiquid`,
 *     `stairFlowRisk`) and does not use gather's filter.
 *   - gather's own escalation to `mine` is gated on `WORTH_TUNNELLING`, which is
 *     ores by design, so no log can hand a relaxed target to the tunnel.
 * Two call sites, asserted structurally with a mutant. Any implementation that
 * reaches this by clearing a Movements flag is the wrong implementation.
 */
/** Every 1.21 fluid or suffocating fill a raw `bot.blockAt` block can carry. See wetBlock. */
export const WET_NAME = /^(water|lava|flowing_water|flowing_lava|bubble_column|powder_snow)$/

export const NATURAL_LOG = /^(oak|birch|spruce|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/

/**
 * Is there TERRAIN over this block -- i.e. is it in a shaft rather than in a tree?
 *
 * The first version of this asked `surfaceYAt` to find the highest solid block in a
 * 20-block column and refused on any unreadable cell. Two problems, both found by
 * the offline funnel: the scan ran past the top of the captured scene and refused
 * on the sky, and "find the surface" was never the question. The question is
 * whether the thing above the target is TERRAIN, and a trunk's own canopy is not.
 *
 * Wood and foliage overhead are fine -- that IS a tree. Stone, dirt, gravel, ore,
 * anything else solid is overburden and the block is buried, which is a `mine`
 * problem and must keep refusing.
 *
 * IT DOES NOT PROVE THE BLOCK IS ABOVE GROUND, and the claim is weakened rather
 * than the span increased (Codex pass 1). Four blocks of leaves under a stone
 * roof passes; so does a trunk beneath an overhang. Raising four to any other
 * number just moves the counterexample. This is a cheap filter that removes the
 * common shaft case; what actually keeps the exemption out of mining is that it
 * admits only natural logs and only from a stance the bot already occupies.
 *
 * UNREADABLE IS OVERBURDEN. Four blocks straight up from a block the bot is
 * looking at is inside the loaded chunk on the fleet, so a null here is a genuine
 * anomaly and not a chunk edge. Defaulting it to sky would make this predicate
 * admit more the LESS it can see, which is the shape of every detector this
 * project has had to retract.
 */
export const OVERHEAD_OK = /(_log$|_leaves$|_wood$|^air$|^cave_air$|^vine$|^snow$)/
export function terrainAbove (bot, p, { span = 4 } = {}) {
  for (let dy = 1; dy <= span; dy++) {
    const b = bot.blockAt(p.offset(0, dy, 0))
    if (!b) return true                                   // unreadable counts against admission
    if (wetBlock(b)) return true                          // a bubble column or snow overhead is not sky
    if (b.boundingBox === 'empty') continue
    if (!OVERHEAD_OK.test(String(b.name || ''))) return true
  }
  return false
}

/**
 * Gathers the cells and asks the pure predicate. Reads through `Movements.getBlock`
 * for the five veto faces, exactly as `breakVetoAt` does and for the same reason:
 * `liquid` and `canFall` are DECORATIONS that getBlock writes, not properties of a
 * prismarine block. The first version of `breakVetoAt` read `bot.blockAt` and would
 * have filed 100% of refusals as `unknown` -- a detector that answers uniformly,
 * shipped as the cure for detectors that answer uniformly.
 *
 * Defaults to FALSE on anything it cannot read. This one is a permission, not an
 * observation, so a missing movements object must refuse rather than admit.
 */
export function shorelineExemptAt (bot, p) {
  try {
    const m = bot.collectBlock?.movements ?? bot.pathfinder?.movements
    if (typeof m?.getBlock !== 'function') return false
    const target = bot.blockAt(p)
    if (!target) return false
    // EVERY OTHER LIBRARY GUARD STILL APPLIES (Codex pass 1).
    //
    // `breakVeto` accounts for liquid, falling blocks and entities -- but
    // `safeToBreak` ALSO checks `canDig`, `blocksCantBreak` and `exclusionBreak`
    // (movements.js:275), and `|| shorelineExemptAt(...)` was bypassing all three.
    // Codex executed the `blocksCantBreak` case and got an admission.
    //
    // So instead of enumerating them -- which goes stale the next time the library
    // adds one -- ask the library itself with ONLY the flow rule off, on a receiver
    // that inherits `m` and shadows the one flag. `m` is not mutated, nothing
    // escapes, and dontMineUnderFallingBlock still runs inside this call.
    const probe = Object.create(m)
    probe.dontCreateFlow = false
    if (!probe.safeToBreak(target)) return false
    return shorelineLogExempt({
      target: { name: target.name, position: { y: Math.floor(p.y) } },
      above: m.getBlock(p, 0, 1, 0),
      sides: FLOW_FACES.slice(1).map(([dx, dy, dz]) => m.getBlock(p, dx, dy, dz)),
      entitiesAbove: m.getNumEntitiesAt?.(p, 0, 1, 0) ?? 0,
      stance: standingDry(bot, p),
      buried: terrainAbove(bot, p),
    })
  } catch { return false }
}

/**
 * IS THE BOT STANDING SOMEWHERE THAT QUALIFIES, RIGHT NOW?
 *
 * The first version asked whether a dry stance EXISTED somewhere beside the
 * target, and that is not a safety property. Codex pass 1 executed production
 * `collectManually` with the certified stance at (1,70,0) and the bot at
 * (0.5,68,1.5) -- two blocks BELOW the target -- and `bot.dig` was invoked without
 * the bot ever moving, because the reach shortcut (skills.mjs, "already in range")
 * skips the approach entirely. So the exemption certified a cell the bot was never
 * required to occupy, and the actual dig happened from underneath the block
 * holding the water back. That is the drowning case, not a corner of it.
 *
 * So the question is now about the bot's OWN position, which needs no navigation
 * to enforce and is re-asked every time the filter runs:
 *
 *   - Feet at or above the target's y. Never from below: breaking a block from
 *     under it puts the bot in the path of everything behind it.
 *   - Dry feet, dry head, solid dry footing -- by NAME, see WET_NAME.
 *
 * It refuses more than the old version, including some genuinely fine shoreline
 * trees where the bot happens to be standing badly at that moment. That is the
 * right direction: the next scan re-asks, and a refused tree costs one candidate
 * while a drowned bot costs the run and the pool's death gate.
 *
 * Waterlogging is checked three ways because a raw block exposes it
 * inconsistently across prismarine versions, and the fixtures cannot represent it
 * at all (the scene loader strips block states) -- so that arm is covered by unit
 * cases with hand-built blocks and is stated as untested on captured scenes.
 */
export function wetBlock (b) {
  return !!b && (WET_NAME.test(String(b.name || '')) || b.liquid === true ||
                 b._properties?.waterlogged === true ||
                 b.getProperties?.().waterlogged === true)
}

export function standingDry (bot, p) {
  const e = bot.entity?.position
  if (!e || typeof e.offset !== 'function') return null
  const feetY = Math.floor(e.y), py = Math.floor(p.y)
  if (feetY < py) return null
  const feet = bot.blockAt(e), head = bot.blockAt(e.offset(0, 1, 0)), under = bot.blockAt(e.offset(0, -1, 0))
  if (!feet || !head || !under) return null
  // CLEARANCE, not just dryness (Codex pass 2, which admitted a bot with STONE in
  // its head cell). A bot that is not actually standing in those two cells is not
  // standing where this says it is, and every conclusion below rests on that.
  const clear = b => b.name === 'air' || b.name === 'cave_air' || b.boundingBox === 'empty'
  if (!clear(feet) || !clear(head)) return null
  if (wetBlock(feet) || wetBlock(head)) return null
  if (under.boundingBox !== 'block' || wetBlock(under)) return null
  return { x: Math.floor(e.x), y: feetY, z: Math.floor(e.z), dry: true }
}

/**
 * Pure, so the decision is tested by behaviour and never by grep. Every one of
 * the six must hold; each has its own mutant.
 */
export function shorelineLogExempt ({ target, above = null, sides = [], entitiesAbove = 0,
                                      stance = null, buried = null } = {}) {
  // 1. A NATURAL LOG, by name. Not `/_log$/`: that admits `stripped_oak_log`,
  //    and a surviving mutant once showed nothing distinguished the two.
  if (!target || !NATURAL_LOG.test(String(target.name || ''))) return false
  // 2. The veto reason must be EXACTLY liquid. Never `both`, never `falling`,
  //    never `entity` -- the falling-block half of the rule is untouched, and
  //    320 of 958 `no_safe_target` runs were SAND, which is that half.
  if (breakVeto({ above, sides, entitiesAbove }) !== 'liquid') return false
  // 3. Nothing liquid ABOVE. This removes only the four horizontal faces of
  //    dontCreateFlow and keeps [0,1,0]: water overhead is the case that pours
  //    down and re-spreads, which is what the rule is actually for.
  if (above && above.liquid) return false
  // 4. NO LAVA ON ANY FACE, and every liquid face must be water specifically --
  //    so an unrecognised fluid refuses instead of passing.
  //
  //    THESE TWO LINES ARE REDUNDANT ON PURPOSE, and the test says so rather than
  //    assuming it. Lava is refused three times over: by name here, by the
  //    water-only line below, and (above the target) by condition 3. A mutant
  //    removing only the first one does NOT admit lava, which is how the
  //    redundancy was discovered rather than claimed. Lava is the one face
  //    nobody may relax, and a guard with two independent reasons to hold is
  //    worth five characters of duplication.
  const lava = b => /lava/.test(String(b?.name || ''))
  if (lava(above) || sides.some(lava)) return false
  if (sides.some(b => b?.liquid && String(b.name) !== 'water')) return false
  // 5. NOT UNDER TERRAIN, which makes the exemption structurally impossible in a
  //    shaft -- doubly so with (1). The caller passes `terrainAbove`'s answer;
  //    `true` and `null` both refuse, so an unreadable column cannot admit.
  const y = target?.position?.y
  if (!Number.isFinite(y)) return false
  if (buried !== false) return false
  // 6. A dry stance, at or above the target, away from its wet faces.
  if (!stance || !stance.dry || !Number.isFinite(stance.y) || stance.y < y) return false
  return true
}

export function isSafeToBreak (bot, p) {
  try {
    const m = bot.collectBlock?.movements ?? bot.pathfinder?.movements
    const b = bot.blockAt(p)
    return !m?.safeToBreak || !b ? true : m.safeToBreak(b)
  } catch { return true }
}

/**
 * The cells a DESCENDING stair step must open, from the bot's floored feet
 * cell and a unit bearing: the tread it will stand on, the headroom over the
 * tread, and the cell above that -- which its head passes through on the way
 * down, and which the cutter used to leave solid (2026-09-11: 388 steps cut
 * and not taken in 90 minutes, all stopped on the lip). Pure, so the test
 * cannot lie about it.
 */
export function descentStepCells(p0, bear) {
  return {
    feet: p0.offset(bear.x, -1, bear.z),
    head: p0.offset(bear.x, 0, bear.z),
    above: p0.offset(bear.x, 1, bear.z),
    floor: p0.offset(bear.x, -2, bear.z),
  }
}

export function actionKey(skill, args) {
  const declared = SKILLS[skill]?.args
  const src = args ?? {}
  const kept = {}
  for (const name of (declared ?? Object.keys(src)).slice().sort()) {
    if (src[name] !== undefined) kept[name] = src[name]
  }
  return `${skill}:${JSON.stringify(kept)}`
}

export const SKILL_CONTRACTS = {
  goto:     { expects: ['position'],              maxMs: 120_000 },
  explore:  { expects: ['position'],              maxMs: 120_000 },
  home:     { expects: ['position'],              maxMs: 240_000 },
  come:     { expects: ['position'],              maxMs: 60_000 },
  follow:   { expects: ['position'],              maxMs: 60_000 },
  gather:   { expects: ['inventory_gain'],        maxMs: 180_000 },
  mine:     { expects: ['inventory_gain', 'position'], maxMs: 180_000 },
  surface:  { expects: ['position'],              maxMs: 120_000 },
  // THE REQUESTED ITEM, VERIFIED BY THE CRAFT ITSELF (sandbox 46c4836): a name count misses a replacement (a spent
  // pickaxe worn out + a new one crafted reads 2 -> 2), and a bag delta credits the sub-crafts' planks to a denied
  // pickaxe. `crafted` is the craft's own verified `produced` of the item it was asked for (runner.mjs).
  craft:    { expects: ['crafted'],               maxMs: 60_000 },
  build:    { expects: ['world_change'],          maxMs: 180_000 },
  place:    { expects: ['world_change'],          maxMs: 30_000 },
  // A bucket use IS a world change: the cell it targets becomes water or air,
  // and that is the half of the evidence the world can confirm. `inventory_gain`
  // would be wrong for a pour (the bucket empties) and `inventory_loss` wrong
  // for a fill, so the shared, always-true half is the block.
  //
  // 30s like `place`: three aims at ~550ms each plus equip and look is under
  // two seconds, and anything beyond that is a bucket that is not working.
  bucket:   { expects: ['world_change'],          maxMs: 30_000 },
  // 60s covered "chest in sight"; the walk-home fallback makes deposit a
  // travel skill, and home's own budget (120s) plus the transfer must fit.
  deposit:  { expects: ['inventory_loss'],        maxMs: 240_000 },
  // Destroys spent tools by using them: the change it exists for is the loss.
  wear_out: { expects: ['inventory_loss'],        maxMs: 60_000 },
  // Consumes ballast into the town composter; a build visit also crafts and places it, so it gets more time.
  // A visit LOSES compost inputs, or -- a harvest-only visit to a ripe composter -- GAINS bone meal (sandbox 10-03:
  // harvest-only visits were downgraded to unknown). NOT any gain or loss: an auto-pickup of cobblestone on the walk
  // is not composting (classifyOutcome, compost_effect).
  compost:  { expects: ['compost_effect'],        maxMs: 120_000 },
  // Crafts and places the town composter: the change it exists for is the block in the world.
  build_composter: { expects: ['world_change'],   maxMs: 150_000 },
  // Walk home (the model's verb) plus up to three containers: deposit's budget. The runner's watchdog (180 s) is the clock.
  withdraw: { expects: ['inventory_gain'],        maxMs: 240_000 },
  // The town order: containers in sight only, never a trip.
  withdraw_pick: { expects: ['inventory_gain'],   maxMs: 120_000 },
  // Banks whole stacks into a town container: the change it exists for is the loss from the bag.
  town_deposit: { expects: ['inventory_loss'],    maxMs: 60_000 },
  eat:      { expects: ['survival'],              maxMs: 30_000 },
  // Walk-home fallback makes sleep a travel skill too (same as deposit).
  sleep:    { expects: ['survival'],              maxMs: 240_000 },
  // A board visit is a journey plus a memory change; the budget must cover the
  // walk from wherever the bot was working.
  board:    { expects: ['memory_change'],         maxMs: 240_000 },
  // Genuinely produces no durable change. Useful only when the bot's picture of
  // itself is stale, never as achievement -- which is exactly what it was being
  // recorded as.
  // Deliberately expects nothing. `status` cannot fail and cannot achieve, so
  // there is no observable change that would make running it an accomplishment.
  //
  // It USED to expect 'information', satisfied by a `delta.informed` flag that
  // the runner set to the constant `skillName === 'status'`. That is true by
  // construction on every call, so every status call met its contract, scored
  // valuable, and was reinforced -- which is the exact 115-times-recorded-as-a-
  // win bug that ADR-0003 exists to prevent, faithfully rebuilt inside the fix
  // for it. An expectation that cannot be unmet is not an expectation.
  status:   { expects: [],                        maxMs: 10_000 },
  // A FURNACE IS AN INVENTORY_GAIN OR IT IS NOTHING.
  //
  // Not `world_change`: loading a furnace changes the world and produces no
  // ingot, and a contract satisfied by the loading would let a bot score a win
  // for putting ore in a box. The item count of the OUTPUT is the only
  // falsifiable claim smelt can make, and the runner measures it independently
  // from its own before/after snapshot.
  //
  // Budget: the skill stops itself at 150s (SMELT_DEADLINE_MS) and reserves 12s
  // to empty the furnace, both inside the runner's 180s. Stated here so the two
  // cannot drift without this line looking wrong.
  smelt:    { expects: ['inventory_gain'],        maxMs: 180_000 },
}

/**
 * Classify an outcome by whether the declared expectation was met, AND say
 * which measurement justified the verdict.
 *
 * Four buckets rather than a boolean, because a boolean cannot tell a working
 * agent from one that idles successfully:
 *   valuable  -- the expected durable change happened
 *   neutral   -- returned cleanly, nothing the skill exists for occurred
 *   costly    -- met its contract but left the bot worse off
 *   failure   -- errored, timed out, or was interrupted with no progress
 *
 * Returns { value, because } where `because` lists the satisfied clauses with
 * the numbers behind them, e.g. ['inventory_gain: oak_log +3'].
 *
 * The point of `because` is not readability, it is an INVARIANT: a valuable or
 * costly verdict with an empty `because` is impossible to produce honestly, so
 * it can be detected. Every learning bug found so far -- status reinforced 115
 * times off a hardcoded flag, world_change inferred from a regex on the skill
 * name, a death record asserting "no skill running" from a variable nothing
 * assigned -- was a derived value that looked exactly like a measured one at
 * the point of use. Making the classifier show its work is what makes that
 * class of bug queryable instead of invisible.
 */
/**
 * Evidence of something the bot STILL HAS once the call is over.
 *
 * Position is not on this list and that is the whole point. A bot that gained
 * four logs keeps them; a bot that moved two blocks toward a goal it never
 * reached kept nothing. The distinction only matters in one place -- the
 * runner's UPGRADE branch, which overturns an abort -- and getting it wrong
 * there scored `drowning — but position: moved 2 blocks` as a successful swim.
 * That single loophole took swim_to from 12.3% to 55.9% overnight and none of
 * it was real.
 *
 * The prefixes are the ones `because.push` writes below; args-sayable style
 * tests keep the two in step.
 */
export const DURABLE_EVIDENCE = /^(inventory_gain|inventory_loss|world_change|memory_change|crafted):/

export function classifyOutcome(skillName, status, delta = {}, wanted = null) {
  if (status === 'failed' || status === 'aborted') return { value: 'failure', because: [] }
  if (status === 'no_effect') return { value: 'neutral', because: [] }

  const expects = SKILL_CONTRACTS[skillName]?.expects ?? []
  const inv = delta.inventory ?? {}
  const because = []

  if (expects.includes('inventory_gain')) {
    let g = Object.entries(inv).filter(([, n]) => n > 0)
    // Gaining SOMETHING is not the same as making progress. When we know what
    // the current milestone needs -- the target item or a direct ingredient of
    // it -- only those count. The fleet accumulated 80 sticks while no
    // milestone wanted more than 2, because `craft stick` was the most reliable
    // way to satisfy a generic inventory_gain. That is the ADR-0003 failure
    // again, wearing productive clothing: the old version idled successfully,
    // this one worked successfully at the wrong thing.
    //
    // A null `wanted` means we could not determine the target, and then any
    // gain counts -- an unknown goal must not silently mark real work useless.
    if (wanted?.size) {
      const useful = g.filter(([k]) => wanted.has(k))
      if (g.length && !useful.length) {
        because.push(`off-target gain (${g.map(([k]) => k).join(', ')}) — milestone needs ${[...wanted].slice(0, 3).join('/')}`)
        g = []
        // fall through to neutral: not wrong, just not progress
        because.length = 0
      } else g = useful
    }
    if (g.length) because.push(`inventory_gain: ${g.map(([k, n]) => `${k} +${n}`).join(', ')}`)
  }
  if (expects.includes('inventory_loss')) {
    const l = Object.entries(inv).filter(([, n]) => n < 0)
    if (l.length) because.push(`inventory_loss: ${l.map(([k, n]) => `${k} ${n}`).join(', ')}`)
  }
  // THE COMPOSTER'S OWN EVIDENCE, narrower than inventory_gain/loss: bone meal gained, or a planner input lost. The
  // strings keep the inventory_ prefixes so DURABLE_EVIDENCE still reads them as durable.
  if (expects.includes('compost_effect')) {
    const bm = inv.bone_meal ?? 0
    if (bm > 0) because.push(`inventory_gain: bone_meal +${bm}`)
    const l = Object.entries(inv).filter(([k, n]) => n < 0 && (isCompostInput(k) || (k === 'apple' && peacefulFoodActive())))
    if (l.length) because.push(`inventory_loss: ${l.map(([k, n]) => `${k} ${n}`).join(', ')}`)
  }
  if (expects.includes('position') && (delta.distance ?? 0) >= 2) {
    because.push(`position: moved ${Math.round(delta.distance)} blocks`)
  }
  if (expects.includes('world_change') && (delta.placed ?? 0) > 0) {
    because.push(`world_change: ${delta.placed} block(s) read back from the world`)
  }
  if (expects.includes('survival') && ((delta.health ?? 0) > 0 || (delta.food ?? 0) > 0)) {
    because.push(`survival: health ${delta.health ?? 0}, food ${delta.food ?? 0}`)
  }
  // A BOARD VISIT CHANGES MEMORY AND NOTHING ELSE. It moves no items, places no
  // blocks and heals nothing, so without its own dimension the evidence gate
  // would downgrade every successful visit to `unknown` -- and the board arm's
  // central action would be unable to prove it ever worked. Counted by the
  // skill from the board's own ledger events, never inferred, same rule as
  // `placed`: a visit that adopted nothing and filed nothing scores zero and
  // is correctly called a no-op.
  // THE CRAFT'S OWN VERIFIED COUNT OF THE ITEM IT WAS ASKED FOR, never a bag delta: the same rule as `placed`. The
  // milestone filter applies as it does to inventory_gain -- off-target work is neutral, not progress.
  if (expects.includes('crafted') && (delta.crafted ?? 0) > 0 &&
      !(wanted?.size && delta.craftedItem && !wanted.has(delta.craftedItem))) {
    because.push(`crafted: ${delta.craftedItem ?? '?'} +${delta.crafted} (verified by the craft)`)
  }
  if (expects.includes('memory_change') && ((delta.adopted ?? 0) > 0 || (delta.filed ?? 0) > 0)) {
    because.push(`memory_change: adopted ${delta.adopted ?? 0}, filed ${delta.filed ?? 0}`)
  }

  if (!because.length) return { value: 'neutral', because: [] }
  return (delta.health ?? 0) < 0
    ? { value: 'costly', because: [...because, `cost: health ${delta.health}`] }
    : { value: 'valuable', because }
}

// SEA LEVEL IN A DEFAULT OVERWORLD. Everything the early game needs -- wood,
// animals, plants, sand, a view of the sky -- exists at or above this.
const SEA_LEVEL = 63

// How far one climb stage reaches. Bounded so each pathfinder search is a
// question it can answer, rather than asking for a 107-block ascent in one go
// -- the mistake that made every probe come back `partial`.
const STEP_UP = 24

/**
 * JOIN THE TWO FACTS THE SYSTEM ALREADY HAD.
 *
 * A bot at y=-42 was told "gather oak_log first" by craft and "no oak_log
 * within 32 blocks" by gather, on alternating turns, for hours. Both were true.
 * Neither mentioned that oak_log does not occur at y=-42 at all, or that the
 * bot was 105 blocks below the nearest one, and the model has no way to know
 * either. The information existed in three separate places and was never
 * assembled into the one sentence that would have changed the next decision.
 */
function belowGroundHint(bot) {
  const y = bot.entity?.position?.y
  if (y == null || y >= SEA_LEVEL) return ''
  // SEA LEVEL IS NOT GROUND LEVEL.
  //
  // The guard was `y < 63` alone. Beaches, riverbanks, swamps and most valley
  // floors sit at y=55-62, so this told bots standing OUTDOORS, in daylight,
  // that plants and animals only exist above ground. Measured over 24h: 11,679
  // firings, 8,686 of them (74%) at y>=40 with surface blocks visible in the
  // same perception record. One bot was traced holding apples and bamboo --
  // surface loot, in hand -- while being told for three hours that surface loot
  // does not exist where it was standing.
  //
  // The cheap self-observation that actually answers "am I underground" is
  // whether there is sky above. A solid ceiling means underground whatever the
  // altitude; open air means outdoors even at y=55.
  if (!hasCeiling(bot)) return ''
  return ` — you are at y=${Math.round(y)}, ${Math.round(SEA_LEVEL - y)} blocks below sea level; ` +
         `wood, plants and animals only exist above ground, so run surface first`
}

/**
 * IS THERE ROCK OVERHEAD? The honest test for "underground".
 *
 * Deliberately bounded: a full sky check to y=320 would cost hundreds of block
 * reads on a path that runs inside failure messages. 12 blocks is enough to
 * separate a cave from a valley, and an unloaded chunk reads as open sky --
 * which errs toward saying LESS, since a wrong "you are underground" is what
 * this whole function got wrong for months.
 */
function hasCeiling (bot, up = 12) {
  const at = bot?.entity?.position
  if (!at || !bot.blockAt) return false
  for (let dy = 2; dy <= up; dy++) {
    const b = bot.blockAt(at.offset(0, dy, 0))
    if (b && b.boundingBox === 'block') return true
  }
  return false
}

/**
 * Climb back to the surface.
 *
 * Added because the fleet kept solving its own extinction. Over one 5.9-hour
 * run, three of six bots lived below sea level -- Scout01 at a mean y of -42 --
 * and the numbers down there are not survivable as a strategy:
 *
 *     nothing_found              263   (the single largest failure class)
 *     _drowning_escaped          209/hr
 *     craft                      permanently blocked on oak_log
 *
 * oak_log only grows above ground. The system already knew every fact it
 * needed: `craft` said "gather oak_log first", `gather` said "no oak_log within
 * 32 blocks", and every record carried y=-42. Nothing joined them, and no
 * action existed that would have helped if something had.
 *
 * `mine` only descends. `goto` and `explore` use the travel config, which has
 * canDig=false, so at y=-42 A* has almost no legal moves and returns the empty
 * path that now reports `stranded`. The bot was not confused. It was walled in,
 * and the skill set had no way out.
 */
// Blocks a shaft climb may stand on. Deliberately narrow: common, solid, and
// worthless enough that spending them on an escape is always the right trade.
// A PILLAR MAY BE BUILT OF SAND. A BRIDGE MAY NOT.
//
// This excluded every falling block, and two things pointed the other way at
// once: `climbPrerequisite` and the stranded-advice list both tell a bot to go
// and gather GRAVEL in order to climb, and the fleet's stuck bots were sitting
// on exactly that. board-a-Bravo held 83 sand and isolated-b-Comet 75 -- more
// than enough to climb 45 blocks -- and shaftAscend refused every one of them.
// A bot that obeys the prerequisite, fetches the block it was told to fetch,
// and still cannot climb has been charged a failed attempt for complying, which
// is the one thing the ladder rule forbids.
//
// Gravity only matters when the block is unsupported. A pillar places each
// block on TOP of the column already under the bot, so it never falls; a
// horizontal bridge places into open air, where it does. That is why the
// pathfinder's `scafoldingBlocks` list in scaffold.mjs still excludes these --
// A* plans bridges with it -- and why the hand-rolled vertical climb does not
// have to.
const SCAFFOLD = /^(cobblestone|cobbled_deepslate|dirt|netherrack|tuff|granite|diorite|andesite|deepslate|stone|sand|red_sand|gravel|.*_planks)$/
const LIQUID = new Set(['water', 'lava', 'flowing_water', 'flowing_lava'])
const FALLING = new Set(['gravel', 'sand', 'red_sand'])

/**
 * WHAT A STRANDED BOT MAY SPEND TO GET DOWN.
 *
 * Wider than SCAFFOLD on purpose. SCAFFOLD is the list of blocks cheap enough
 * to abandon in a shaft, so it excludes logs -- correctly, since a log is four
 * planks. A bot that has been stuck at the build limit for eight hours is in a
 * different trade: the two stranded bots carry 226 and 101 logs and between
 * them THREE blocks that SCAFFOLD recognises, so the careful list would have
 * left them exactly where they were.
 *
 * FALLING blocks are excluded and this is the whole reason the set is written
 * out rather than expressed as "anything solid". The move here is to place a
 * block beneath the floor and then break the floor. Do that with sand and the
 * sand falls the instant it is unsupported -- the bot drops with it, 250
 * blocks, into the void it was trying to bridge. The one block type that looks
 * most like scaffold is the one that kills.
 */
export const RESCUE_BLOCK = /^(cobblestone|cobbled_deepslate|dirt|coarse_dirt|rooted_dirt|netherrack|tuff|granite|diorite|andesite|deepslate|stone|sandstone|red_sandstone|.*_planks|.*_log|.*_wood|.*_stem)$/
export const rescueBlocks = bot => bot.inventory.items()
  .filter(it => RESCUE_BLOCK.test(it.name) && !FALLING.has(it.name))

/**
 * Climb straight up by digging and pillaring, WITHOUT the pathfinder.
 *
 * surface's ascent already had dig-capable Movements -- and used them through
 * pathfinder.goto(GoalY), which is why it never worked where it mattered.
 * Measured: "no altitude gained ... in 2s of trying (Path was stopped before it
 * could be completed)" while the budget was 120s. Two independent killers:
 * underground A* with canDig=true explores a volume (the search dies of
 * branching before committing), and anything that calls setGoal(null) -- the
 * drowning reflex does, on bots that are wet precisely because they are deep --
 * cancels the walk instantly. A shaft climb owns no pathfinder goal, so there
 * is nothing to clear.
 *
 * Safety refusals, each the lesson of a logged death:
 *   liquid above or beside the block being broken  -> stop (dontCreateFlow's
 *     reason: breaking beside water while below it is how ascents drown)
 *   lava anywhere adjacent                          -> stop
 *   falling block above -> dig it, wait for the column to settle, re-check;
 *     bounded by the same step budget as everything else
 *
 * Altitude is verified every step because that is the entire point: a climb
 * that is not gaining height within a few steps is not a climb, whatever the
 * promises returned.
 */
/**
 * The shaft's dig budget: refuse on what the block costs THIS TOOL on the
 * ground; size the deadline on what it costs where the bot actually is.
 * Pure. hive-a-Delta: stone with a wooden pickaxe, airborne in water ->
 * hardness 1.15 s (never refused), actual ~29 s, budget ~45 s, not 15 s.
 */
export function shaftDigBudget (head, tool, env) {
  return planDigSplit({ hardnessMs: predictedDigMs(head, tool),
                        actualMs: predictedDigMs(head, tool, env) })
}

export async function shaftAscend(bot, targetY, signal,
                                  { maxSteps = 96, deadline = Infinity, claim = null } = {}) {
  // TAKE THE BODY BEFORE CLIMBING.
  //
  // The sibling pillar in reflex.mjs does this and says why: "pathfinder
  // rewrites jump every tick while a goal is set, so a pillar that does not own
  // the body places blocks under a bot that is being steered somewhere else."
  // This one never did -- and it is called immediately after a `goto` that just
  // failed, so that goto's goal is usually STILL SET while the climb runs.
  //
  // The raw stop reason, once it was finally logged, reads
  // `dig failed on stone: Digging aborted` -- mineflayer's wording for a dig
  // interrupted from outside. The climb was not beaten by terrain or by a
  // missing tool. It was fighting a pathfinder that still believed it was
  // walking somewhere, losing, and then reporting "this stone needs a pickaxe"
  // to a bot with no way to get one.
  //
  // setGoal(null), not stop() alone: stop() takes effect at the next path node,
  // so a bot that cannot reach its next node never stops. withTimeout in this
  // file already had to learn that, and so did reflex.mjs.
  haltPath(bot)   // no trailing stop(): pathhalt.mjs
  try { bot.clearControlStates() } catch { /* not connected */ }

  const startY = bot.entity.position.y
  let noGain = 0
  const retried = new Set()   // one bounded retry per head cell after an interrupted tool dig
  // A REFUSAL TO DIG IS NOT A REFUSAL TO CLIMB. See dryColumnStep in
  // scaffold.mjs for the measurement; the cap is here because a bot that keeps
  // finding the next column wet must stop shuffling and report, not wander. It
  // is deliberately small: the sidestep exists to leave ONE bad column, and
  // three tries is already two more than the observed geometry needs.
  const MAX_SIDESTEPS = 3
  let sidesteps = 0
  for (let i = 0; i < maxSteps; i++) {
    check(signal)
    // STOP ON THE CALLER'S CLOCK, NOT ON THE RUNNER'S ABORT. A bare-handed
    // deepslate dig is legitimately ~25s now, so a 96-step climb can outlive
    // surface's 120s budget -- and an abort throws away both the height already
    // gained and the stopping reason that would have told the model what to do
    // next. Ending cleanly turns the same climb into `travel_incomplete`,
    // "call again to continue", which is progress rather than a failed attempt.
    if (Date.now() >= deadline) {
      return { gained: bot.entity.position.y - startY, stopped: 'out of time this call' }
    }
    // RENEW PER STEP, so a stalled climb goes stale in seconds rather than
    // holding the reflex off for the whole skill budget. A claim that stops
    // being renewed stops being honoured.
    claim?.renew?.()
    const p = bot.entity.position
    if (p.y >= targetY) break
    const yBefore = p.y

    // ONE LIQUID AUTHORITY. The `liquid overhead` branch that used to sit here
    // returned the identical string overheadBreakRisk already returns for the
    // same case -- so it was dead weight that also stole the sidestep below
    // from the one bot shape that most needs it: a head under a water ceiling,
    // where walking out from under it is the whole answer.
    const head = bot.blockAt(p.offset(0, 2, 0))
    const isLiquid = b => !!b && LIQUID.has(b.name)
    // IS THE BOT ALREADY UNDER? Both of its own cells, not one.
    //
    // Feet-only would be true of a bot wading a shoreline with its head in
    // clear air, which is precisely the bot the flood guard is right about. The
    // exemption is for a bot with nothing left to protect: head under AND feet
    // under. Read from the bot's own occupied cells, never from oxygenLevel,
    // which air.mjs documents as corrupted by any nearby fish.
    // WATER ONLY (climbflood-01, Codex r1): the exemption is for a bot already under WATER; `isLiquid` counts
    // lava and misses kelp, bubble columns and waterlogged blocks. Same classifier as the reflex's submergedAt.
    const submerged = isWaterCell(bot.blockAt(p.offset(0, 1, 0))) && isWaterCell(bot.blockAt(p))
    // THE SAME CHECK EVERY UPWARD DIG ASKS (climbflood-01): it now also reads
    // the cell ABOVE the block being broken -- the face that opens when a climb
    // breaks into the bottom of a pocket -- waterlogged blocks, flowing lava,
    // falling columns, and refuses on an unloaded cell.
    const flood = overheadBreakRisk({ at: (dx, dy, dz) => bot.blockAt(p.offset(dx, 2 + dy, dz)), submerged })
    if (flood) {
      logFloodGuard(bot, { caller: 'shaft_ascend', reason: flood, cell: p.offset(0, 2, 0), submerged })
      // WALK OUT FROM UNDER IT RATHER THAN GIVING UP.
      //
      // The guard is unchanged and still absolute: this branch never digs. It
      // asks whether a nearby column exists that the SAME guard already
      // permits, and if one does, walks there and lets the next iteration
      // re-decide from the real position. 262 refusals, 9 bots, each pinned to
      // one or two cells for days, because this was a `return`.
      const step = sidesteps < MAX_SIDESTEPS
        ? dryColumnStep({ at: (dx, dy, dz) => bot.blockAt(p.offset(dx, dy, dz)), isLiquid })
        : null
      if (!step) return { gained: p.y - startY, stopped: flood }
      sidesteps += 1
      const fromX = Math.floor(p.x), fromZ = Math.floor(p.z)
      const wantX = fromX + step.dx * step.dist, wantZ = fromZ + step.dz * step.dist
      // Look at HEAD height: aiming at the target's feet pitches the bot down
      // and the walk turns into a stare at the floor one block ahead.
      await bot.lookAt(p.offset(step.dx * step.dist, 1, step.dz * step.dist)).catch(() => {})
      bot.setControlState('forward', true)
      // RELEASE THE CONTROL ON EVERY EXIT, including the abort. A control state
      // has no owner and no timeout -- `check(signal)` throws straight out of
      // this function, and a `forward` left latched walks the bot until
      // something else happens to seize the body.
      try {
        // CUT POWER THE MOMENT THE CELL IS REACHED. A flat sleep sized for the
        // distance overshoots -- 4.3 blocks/sec means a 600ms walk crosses two
        // cells -- and the cell past the target is the one the corridor check
        // never cleared.
        const until = Date.now() + 500 * step.dist + 500
        while (Date.now() < until) {
          await sleep(60)
          check(signal)
          const q = bot.entity.position
          if (Math.floor(q.x) === wantX && Math.floor(q.z) === wantZ) break
        }
      } finally { bot.setControlState('forward', false) }
      await sleep(150)
      // VERIFY BY READING THE WORLD BACK, but only for the thing this step
      // owns: did the body actually move? Where it landed is re-judged by the
      // guard at the top of the next iteration, which is a stronger check than
      // any dead-reckoning here -- and the honest one, since a bot that cannot
      // move at all must report that rather than loop.
      const now = bot.entity.position
      if (Math.floor(now.x) === fromX && Math.floor(now.z) === fromZ) {
        return { gained: now.y - startY, stopped: `${flood}; could not step clear of it` }
      }
      continue
    }

    if (head && head.name !== 'air' && head.boundingBox !== 'empty') {
      const tool = bestTool(bot, head)
      // PRICE THE DIG FROM THE BLOCK, NOT FROM A CONSTANT. The flat 15,000ms
      // this replaces is exactly the bare-handed break time of deepslate and
      // iron_ore, and less than cobbled_deepslate's 17,500 -- so a toolless bot
      // below y=0 could never break its own ceiling, timed out, and reported
      // `dig failed`, which climbPrerequisite turned into "go and get a
      // pickaxe" from a place with no wood. See digbudget.mjs.
      //
      // REFUSE ON HARDNESS, BUDGET ON REALITY (2026-09-13, hive-a-Delta): this
      // was the last climb dig priced grounded. Delta held a wooden pickaxe in a
      // flooded pocket under twelve blocks of stone; airborne AND head in water
      // the swing is 25x slower, so a grounded 15 s budget expired every time
      // and climbPrerequisite told a bot holding a pickaxe to go and craft one.
      // `shaftDigBudget` is the same split escapeStairUp uses, exported so the
      // Delta case is a test rather than a story.
      // EQUIP FIRST, THEN PRICE WHAT IS ACTUALLY IN HAND (Codex pass 2): a
      // swallowed equip failure must not leave a bare hand digging under a
      // pickaxe's deadline, nor hide a real "needs a pickaxe".
      if (tool) await bot.equip(tool, 'hand').catch(() => {})
      // THE FLOOD CHECK AGAIN, AFTER THE HAND CHANGE (climbflood-01, Codex r2): the equip is a server round trip.
      // Anchored on `head` ITSELF (Codex r3), so a bot that drifted a cell during the equip cannot approve a dry
      // neighbour and break the original target.
      const q = bot.entity.position
      const wetNow = isWaterCell(bot.blockAt(q.offset(0, 1, 0))) && isWaterCell(bot.blockAt(q))
      {
        const cell = head.position ?? p.offset(0, 2, 0)
        const again = overheadBreakRisk({ at: (dx, dy, dz) => bot.blockAt(cell.offset(dx, dy, dz)), submerged: wetNow })
        if (again) {
          logFloodGuard(bot, { caller: 'shaft_ascend', reason: again, cell, submerged: wetNow })
          return { gained: q.y - startY, stopped: again }
        }
      }
      const inHand = tool && bot.heldItem?.name === tool.name ? tool : null
      const plan = shaftDigBudget(head, inHand, digEnv(bot))
      if (plan.refuse) {
        return { gained: p.y - startY, stopped: `cannot break ${head.name} ${inHand ? `with ${inHand.name}` : 'by hand'}` }
      }
      const left = deadline ? deadline - Date.now() : Infinity
      if (left <= 0) return { gained: p.y - startY, stopped: 'climb budget spent before the dig' }
      try {
        await withTimeout(bot.dig(head), Math.min(plan.budgetMs, left), bot, {
          what: 'dig', onTimeout: () => { try { bot.stopDigging?.() } catch {} },
          // The climb wants the hole. planDig already decided this block is
          // affordable bare-handed; the harvest watchdog must not overrule it.
          needsDrop: false,
        })
        watchClimbDig(bot, { caller: 'shaft_ascend', cell: head.position ?? p.offset(0, 2, 0), submerged: wetNow, before: head.name })
      } catch (e) {
        // NAME THE FAILURE. This swallowed the error and reported a bare "dig
        // failed on <block>", which `climbAdvice` then turned into "this stone
        // needs a pickaxe" -- advice that sends a bot underground to fetch wood
        // that only exists on the surface it cannot reach.
        //
        // After the budget fix, deepslate gets 24.5s and stone 15s, and the dig
        // should not be timing out. It still reports failure 71 times an hour at
        // y=-17 and y=-26, and the reason is not recoverable from the logs
        // because this line threw it away. A wrong diagnosis costs more than a
        // missing one: the old message asserted a cause it had never checked.
        const why = (e?.message || String(e)).slice(0, 60)
        // SAY WHAT WAS IN HAND. climbPrerequisite asks for a pickaxe on any
        // "dig failed"; a timeout or an abort while HOLDING one is not a tool
        // problem, and the sandbox replay of hive-a-Delta showed exactly that:
        // "Digging aborted" (the air reflex took the body) turned into "craft a
        // pickaxe" for a bot with a wooden pickaxe in its hand.
        //
        // RETRY HERE, NOT BY ADVICE. "Run surface again" as advice meets the
        // admission gate's repeat guard; the climb retries the same block once
        // itself, inside its own deadline, when it was interrupted with a tool
        // in hand (the reflex that took the body has finished by now).
        if (inHand && !retried.has(`${head.position?.x},${head.position?.y},${head.position?.z}`)) {
          retried.add(`${head.position?.x},${head.position?.y},${head.position?.z}`)
          await sleep(400); continue
        }
        return { gained: p.y - startY, stopped: `dig failed on ${head.name} ${inHand ? `with ${inHand.name}` : 'by hand'}: ${why}` }
      }
      if (FALLING.has(head.name)) { await sleep(500); continue }  // column settles, re-check
      await sleep(120)
    }

    // Gain the block: jump and place under our feet.
    const item = bot.inventory.items().find(it => SCAFFOLD.test(it.name))
    if (!item) {
      return { gained: bot.entity.position.y - startY, stopped: 'no scaffold blocks left' }
    }
    await bot.equip(item, 'hand').catch(() => {})
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (!below) return { gained: bot.entity.position.y - startY, stopped: 'no block below' }
    bot.setControlState('jump', true)
    await sleep(320)
    try { await withTimeout(bot.placeBlock(below, new Vec3(0, 1, 0)), 6_000, bot, { what: 'place', onTimeout: () => {} }) } catch { /* mistimed; retried next step */ }
    bot.setControlState('jump', false)
    await sleep(250)

    if (bot.entity.position.y - yBefore < 0.5) {
      if (++noGain >= 4) {
        return { gained: bot.entity.position.y - startY, stopped: 'no height gained over 4 steps' }
      }
    } else noGain = 0
  }
  return { gained: bot.entity.position.y - startY, stopped: null }
}

/**
 * RIDE YOUR OWN FLOOR DOWN.
 *
 * The last thing standing between three bots and the ground. They pillared to
 * the build limit and every other exit is now legal and still useless:
 *
 *   goto    -> "pathfinder returned an empty path — no route out of here"
 *   mine    -> "open space at least 4 blocks under" — correct, it is a
 *              250-block void and digging is a fall
 *   explore -> "explored 0 blocks in 14 legs" — it is a platform
 *   surface -> pillars UP; wrong direction by contract
 *   place   -> searches the eight HORIZONTAL neighbours, never underfoot
 *
 * In open air the only placeable position is against a face of the block you
 * are standing on, and the only exposed face pointing anywhere useful is its
 * UNDERSIDE. So the move is not to dig down into nothing -- it is to put
 * something there first, then dig. Place a block beneath the floor, break the
 * floor, fall exactly one block onto what you just placed. Repeat.
 *
 * That turns the void the `mine` guard correctly refuses into solid ground,
 * one block at a time, and the fall exposure is never more than one block.
 * It costs one carried block per block of descent -- the stranded bots carry
 * 226 logs, which is 226 blocks of it.
 *
 * AND WHEN THERE IS ALREADY SOMETHING THERE, IT COSTS NOTHING. A bot that
 * pillared up is standing on its own pillar: the block two below its feet is
 * solid, so breaking the floor drops it exactly one block onto the column it
 * built, for free. That is the common case by two orders of magnitude, and for
 * five days it was the one case this function refused. See the comment on the
 * `needsBridge` branch.
 *
 * NOT A NEW SKILL, deliberately. It hangs off `goto` after the pathfinder has
 * proved there is no route, so the model needs to learn nothing: it already
 * proposes `goto <the ground>` and is right to. A new verb would add prompt,
 * admission and telemetry surface for a state that affects 3 bots in 80.
 *
 * Bounded hard. One bad precondition here turns a rare stranding into a
 * fleet-wide fall, and 169 of 868 deaths on this project are already falls.
 * Every step verifies the placement by reading the world back and verifies
 * that the bot actually descended; anything unexpected stops the whole thing.
 */
export async function rideFloorDown (bot, { maxSteps = 16, signal } = {}) {
  const startY = bot.entity.position.y
  let placed = 0, rode = 0, stopped = null
  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) { stopped = 'aborted'; break }
    const yBefore = bot.entity.position.y
    const floor = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (!floor || floor.boundingBox !== 'block') { stopped = 'nothing underfoot to stand on'; break }

    const target = bot.entity.position.offset(0, -2, 0)
    const under = bot.blockAt(target)
    // Liquid first, and only when it is not a solid block: a water_cauldron is
    // named for water and is something to stand on. Lava or water at y-2 is a
    // one-block drop into it, which is not a rescue.
    if (under && under.boundingBox !== 'block' && /water|lava/.test(under.name ?? '')) {
      stopped = `${under.name} below`; break
    }

    // TWO WAYS DOWN, AND THE FREE ONE IS 98% OF REALITY.
    //
    // This used to stop dead here:
    //
    //     if (under && under.boundingBox === 'block')
    //       { stopped = 'solid below — ordinary digging applies'; break }
    //
    // Measured 2026-08-26..08-31: 1,879 of 1,917 calls ended on that line, and
    // `ordinary digging` never applied to any of them. board-c-Delta alone sat
    // at 575,221,157 for days -- 30,395 noPath, 3,689 `stranded_high`, 1,626
    // goto failures, 810 of these -- because a bot that PILLARED to the build
    // limit is standing on the pillar it built. The block two below its feet is
    // its own column, so the guard fired on every attempt, and the `mine` it
    // deferred to digs a STAIRCASE: the next tread is horizontally offset into
    // the 250-block void, `hollow >= 3`, `void_below`, correctly refused. Two
    // correct-looking guards, one on each side, and no way through.
    //
    // Solid at y-2 is not a reason to stop. It is the CHEAPEST step there is:
    // break the floor and land on it, one block, no fall damage, no material
    // spent. Placing is the fallback for when there is nothing there, not the
    // point of the manoeuvre. The point is descending one block at a time.
    //
    // The two branches compose: ride the pillar down for free until it runs
    // out, bridge the gap when it does, ride again on what was just placed. A
    // cave roof mid-descent is handled by the same loop with no special case.
    const needsBridge = !under || under.boundingBox !== 'block'
    if (needsBridge) {
      const item = rescueBlocks(bot)[0]
      if (!item) { stopped = 'no placeable blocks left'; break }
      await bot.equip(item, 'hand').catch(() => {})
      // Place against the UNDERSIDE of the floor we are standing on. VERIFIED
      // IN PRODUCTION, contrary to the folk belief that it cannot work: 23
      // calls placed 140 blocks this way and 21 of them descended, three of
      // them the full 16 steps (isolated-b-Comet y=320->304, placebo-a-Comet
      // y=200->184, placebo-d-Bravo y=222->206). The primitive was never the
      // defect; the guard above it was.
      //
      // forceLook, AND IT IS NOT A DETAIL. bot.placeBlock hardcodes
      // `{ swingArm: 'right' }` and never sets forceLook (mineflayer 4.37.1,
      // lib/plugins/place_block.js:33), so _genericPlace awaits a SLEWED
      // bot.lookAt at 0.15 rad/tick and no block_place packet leaves until the
      // head finishes turning. Straight down is the worst case for that: the
      // look target is the floor's bottom-face centre, directly beneath a
      // centred bot, so lookAt's `yaw = atan2(-dx, -dz)` is atan2(-0, -0) --
      // which is -PI, a spurious 180-degree turn, ~21 ticks of slewing before
      // anything is sent. mineflayer-pathfinder #296 is this exact bug
      // ("the bot stands in its way ... waiting too long before sending the
      // place packet") and IceTank's answer there is forceLook, which resolves
      // in the same tick. Measured here: 17 of the 40 attempts that reached
      // this line failed with `could not place beneath the floor`.
      //
      // _placeBlockWithOptions is the only way to pass it (place_block.js:37).
      // It is private, so fall back rather than crash if a bump removes it.
      const place = bot._placeBlockWithOptions
        ? bot._placeBlockWithOptions(floor, new Vec3(0, -1, 0),
                                     { swingArm: 'right', forceLook: true })
        : bot.placeBlock(floor, new Vec3(0, -1, 0))
      try {
        await withTimeout(place, 6_000, bot, { what: 'place', onTimeout: () => {} })
      } catch { /* verified by readback below, not by the absence of a throw */ }
      await sleep(180)
      const nowUnder = bot.blockAt(target)
      if (!nowUnder || nowUnder.boundingBox !== 'block') {
        stopped = 'could not place beneath the floor'; break
      }
      placed++
    } else {
      rode++
    }

    // Break the floor and drop exactly one block onto whatever is beneath it --
    // the block just placed, or the pillar that was already there.
    //
    // PRICE THE DIG FROM THE BLOCK, as the climb does. The flat 10,000ms this
    // replaces is under the bare-handed break time of deepslate (24.5s) and
    // cobbled_deepslate, so a toolless bot riding its own deepslate pillar down
    // could only ever report `could not break the floor` -- naming our budget,
    // not the cause. Refusing up front says the true thing instead.
    const tool = bestTool(bot, floor)
    const plan = planDig(predictedDigMs(floor, tool))
    if (plan.refuse) { stopped = `cannot break ${floor.name} by hand`; break }
    if (tool) await bot.equip(tool, 'hand').catch(() => {})
    try {
      // Same reasoning as the climb: breaking the floor to fall through it wants
      // the hole, not the cobble.
      // needsDrop:false removes the harvest watchdog, which was previously the
      // only thing that could stop a hung floor dig. So the timeout handler has
      // to do it -- an empty handler here would leave bot.dig running after
      // withTimeout had already rejected.
      await withTimeout(bot.dig(floor), plan.budgetMs, bot,
                        { what: 'dig', needsDrop: false,
                          onTimeout: () => { try { bot.stopDigging?.() } catch { /* not digging */ } } })
    } catch { stopped = 'could not break the floor'; break }
    await sleep(420)
    const fell = yBefore - bot.entity.position.y
    if (fell < 0.5) { stopped = 'floor broke but the bot did not descend'; break }
    if (fell > 3.5) { stopped = `fell ${Math.round(fell)} blocks — stopping before that repeats`; break }
  }
  return { descended: startY - bot.entity.position.y, placed, rode, stopped }
}

/**
 * Turn a shaft's stopping reason into the sentence that fixes it.
 *
 * The belowGroundHint pattern, applied to escape: the climb KNOWS why it
 * stopped ("no scaffold blocks left") and the model used to see only that a
 * climb failed -- a dead end. A failure that carries its own recipe is a
 * lesson; one that does not is just a bruise. When following the recipe works,
 * the evidence gate records a genuine worked-rule, and "gather blocks, then
 * surface" becomes knowledge the bot EARNED rather than behaviour we scripted.
 */
/**
 * The same advice as climbAdvice, but as DATA the planner can act on.
 *
 * Prose advice reaches the model and dies there. Scout01 sat at y=29 for four
 * days being told "gather 8+ dirt or cobblestone first" after every failed
 * climb, and proposed `gather oak_log` every time -- 126 recorded failures --
 * because the milestone said oak logs and the advice was only a sentence. A
 * recipe the goal layer cannot see is not a recipe, it is a comment.
 *
 * `items` is an OR-list and `count` the total across them: eight cobblestone,
 * eight dirt, or four of each all satisfy it. Returns null when the stop
 * reason names no acquirable prerequisite (blocked overhead, standing water),
 * because inventing a shopping list for those would send the bot fetching
 * things that cannot help.
 */
export function climbPrerequisite(stopped) {
  if (!stopped) return null
  const s = String(stopped)
  if (s.includes('no scaffold')) {
    return {
      items: ['dirt', 'cobblestone', 'stone', 'andesite', 'diorite', 'granite', 'gravel', 'netherrack'],
      count: 8,
      describe: 'Gather 8 dirt or cobblestone. You are trapped and need blocks in hand to pillar out.',
      because: 'the climb stopped for lack of scaffold',
    }
  }
  // A PICKAXE IS THE REMEDY ONLY WHEN THE HAND WAS THE PROBLEM. `cannot break`
  // is the hardness refusal; `dig failed ... by hand` is a bare-handed dig that
  // did not finish. A dig that failed WITH a pickaxe in hand (timeout, abort,
  // interrupted by a reflex) gets no prerequisite -- the remedy is to run the
  // climb again from here, and asking for a tool the bot holds is a loop.
  if (s.includes('cannot break') || (s.includes('dig failed') && s.includes('by hand'))) {
    return {
      items: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'],
      count: 1,
      describe: 'Get a pickaxe. The stone above you cannot be broken without one.',
      because: 'the climb stopped on stone it could not break',
    }
  }
  return null
}

export function climbAdvice(stopped) {
  if (!stopped) return ''
  const s = String(stopped)
  if (s.includes('no scaffold')) {
    return ' — you need blocks to pillar: gather 8+ dirt or cobblestone first, then run surface again'
  }
  if (s.includes('liquid')) {
    return ' — water blocks the shaft here: walk a few blocks away from the water, then run surface again'
  }
  if (s.includes('cannot break') || (s.includes('dig failed') && s.includes('by hand'))) {
    return ' — this stone needs a pickaxe: gather wood, craft a pickaxe, then run surface again'
  }
  if (s.includes('dig failed')) {
    // NOT "run surface again": the identical proposal meets the repeat guard.
    // A different column is a different action.
    return ' — the dig was cut short twice with a pickaxe in hand: step two or three blocks to another column, then surface'
  }
  if (s.includes('no height gained')) {
    return ' — this spot is blocked overhead: move somewhere more open, then run surface again'
  }
  return ' — run surface again to keep climbing'
}

async function surface(ctx, _args, signal) {
  const { bot, runner } = ctx
  const startY = bot.entity.position.y

  // Already up here. Report it as a refusal, not a success: a call that cannot
  // change anything must not be recorded as an achievement, or it clears the
  // avoid rules that would otherwise stop it being proposed again.
  if (startY >= SEA_LEVEL) {
    return {
      status: 'failed',
      failClass: 'already_surfaced',
      gap: `at_y${Math.round(startY)}`,
      detail: `already at y=${Math.round(startY)}, at or above sea level ${SEA_LEVEL} — ` +
              `nothing to climb; use gather, explore or goto from here`,
    }
  }

  if (!bot.withAscentMovements) {
    return { status: 'failed', failClass: 'unsupported',
             detail: 'ascent movements unavailable on this bot' }
  }

  // A PROBE CHOOSES THE TOOL. IT DOES NOT DECIDE WHETHER TO ACT.
  //
  // getPathTo advances the search generator exactly once and each slice is
  // capped at tickTimeout (40ms), so underground it answers `partial` for
  // essentially everything. Gating the ATTEMPT on it meant surface never
  // attempted: 15 of 15 invocations returned unknown/probe_timeout and the
  // altitude-judging code below was unreachable. Before that it read the same
  // `partial` as `stranded` and poisoned the lessons store. Two ways of being
  // wrong about the same forty milliseconds.
  //
  // So: only a COMPLETED noPath from both configs is a reason to skip. Anything
  // else, we climb and let the altitude say what happened -- which no probe can
  // fool, and which this skill already measured correctly all along.
  const probe = (moves, stageY) => {
    try {
      const r = bot.pathfinder.getPathTo?.(moves, new goals.GoalY(stageY), 3000)
      return r?.status ?? 'noPath'
    } catch { return 'noPath' }
  }

  await settle(bot, signal).catch(() => {})
  check(signal)

  // CLIMB UNTIL THE BUDGET IS SPENT, NOT UNTIL THE NEXT DECISION.
  //
  // Stages used to be one per invocation, so a bot at y=-44 needed five
  // separate LLM decisions 30 seconds apart -- two and a half minutes at best,
  // and only if the model re-chose `surface` every time against every other
  // skill competing for the slot. Deterministic progress does not belong in the
  // decision loop. One call now climbs as far as it can.
  const DEADLINE = Date.now() + 120_000
  const STAGE_MS = 40_000
  let usedDig = false
  let stalls = 0
  let lastErr = null
  let lastStop = null   // the shaft's most recent stopping reason, for the advice line
  // Did the planner ever COMMIT to a walkable route? If it did and the bot
  // still went nowhere, that is a traversal stall -- goto's empty-path resolve
  // or a stuck body -- and it is a definite answer, not a don't-know. Losing
  // that distinction would throw away the one case where we know the fault is
  // ours rather than the terrain's.
  let plannerCommitted = false

  while (bot.entity.position.y < SEA_LEVEL && Date.now() < DEADLINE) {
    check(signal)
    const y0 = bot.entity.position.y
    const stageY = Math.min(SEA_LEVEL, Math.round(y0) + STEP_UP)

    const walk = probe(bot.pathfinder.movements, stageY)
    const dig = walk === 'success' ? null : probe(bot.ascentMovements, stageY)
    // EITHER planner finishing and saying "yes" is a commitment. If one of them
    // found a route and the bot still went nowhere, the fault is traversal --
    // goto's empty-path resolve, or a stuck body -- not the terrain.
    if (walk === 'success' || dig === 'success') plannerCommitted = true
    if (walk === 'noPath' && dig === 'noPath') {
      // Both searches finished and found nothing -- which is exactly the sealed
      // pocket the SHAFT exists for. The pathfinder needs a route to exist; the
      // shaft makes one. Only if the shaft ALSO cannot move is "stranded" a
      // conclusion the evidence supports.
      usedDig = true
      // CLAIM THE BODY FOR EXACTLY THE HAND-ROLLED PILLAR, AND NOTHING ELSE.
      //
      // Not around the whole skill: the pathfinder stages above are not a body
      // seizure, and the reflex clearing a goal there is small and recoverable.
      // This stretch is the only one where the skill drives jump, equip,
      // placeBlock and a live targetDigBlock by hand, and it is the stretch the
      // entombment reflex was interrupting.
      const claim = runner?.claimBody?.('climb') ?? null
      let shaft
      try { shaft = await shaftAscend(bot, stageY, signal, { deadline: DEADLINE, claim }) }
      finally { claim?.release?.() }
      lastStop = shaft.stopped ?? lastStop
      if (shaft.gained >= 1) continue     // made height; re-plan from up there
      const q = bot.entity.position
      if (q.y - startY >= 4) break        // we did climb earlier; report that instead
      return {
        status: 'failed',
        failClass: 'stranded',
        gap: `stranded_y${Math.round(q.y)}`,
        detail: `no route up from ${q.x.toFixed(0)},${q.y.toFixed(0)},${q.z.toFixed(0)} ` +
                `toward y=${stageY}; both searches found nothing AND a direct shaft ` +
                `climb stopped: ${shaft.stopped ?? 'no height gained'}` +
                climbAdvice(shaft.stopped),
        need: climbPrerequisite(shaft.stopped),
      }
    }

    try {
      if (walk === 'success') {
        await withTimeout(bot.pathfinder.goto(new goals.GoalY(stageY)), STAGE_MS, bot)
      } else {
        usedDig = true
        await bot.withAscentMovements(async () => {
          // A climb wants the hole; see the goto retry above and digbudget.mjs.
          await withTimeout(bot.pathfinder.goto(new goals.GoalY(stageY)), STAGE_MS, bot, { needsDrop: false })
        })
      }
    } catch (e) {
      if (e.aborted || signal?.aborted) throw e
      lastErr = e
    }

    // A pathfinder stage that gained nothing gets ONE shaft stage before it
    // counts as a stall. The measured failure mode was precisely this: a
    // walkable route existed, goto was cancelled within 2s (reflex goal-clears,
    // A* dying of underground branching), and the stall counter gave up while
    // 120s of budget sat unused. The shaft owns no pathfinder goal, so the
    // things that killed the walk cannot touch it.
    if (bot.entity.position.y - y0 < 1) {
      usedDig = true
      // CLAIM THE BODY FOR EXACTLY THE HAND-ROLLED PILLAR, AND NOTHING ELSE.
      //
      // Not around the whole skill: the pathfinder stages above are not a body
      // seizure, and the reflex clearing a goal there is small and recoverable.
      // This stretch is the only one where the skill drives jump, equip,
      // placeBlock and a live targetDigBlock by hand, and it is the stretch the
      // entombment reflex was interrupting.
      const claim = runner?.claimBody?.('climb') ?? null
      let shaft
      try { shaft = await shaftAscend(bot, stageY, signal, { deadline: DEADLINE, claim }) }
      finally { claim?.release?.() }
      lastStop = shaft.stopped ?? lastStop
      if (shaft.gained < 1 && ++stalls >= 2) break
      if (shaft.gained >= 1) stalls = 0
    } else {
      stalls = 0
    }
  }

  // JUDGED ON ALTITUDE, never on how a promise returned -- goto resolves on an
  // empty path, so only the height is evidence.
  const endY = bot.entity.position.y
  const climbed = endY - startY
  const how = usedDig ? 'digging where it had to' : 'without digging'

  if (endY >= SEA_LEVEL) {
    return { status: 'success', placed: undefined,
             detail: `climbed ${Math.round(climbed)} blocks to y=${Math.round(endY)}, ${how}` }
  }
  if (climbed >= 4) {
    return {
      status: 'failed', failClass: 'travel_incomplete', gap: `at_y${Math.round(endY)}`,
      detail: `climbed ${Math.round(climbed)} blocks to y=${Math.round(endY)}, ` +
              `still ${Math.round(SEA_LEVEL - endY)} below sea level` +
              (climbAdvice(lastStop) || ' — call again to continue'),
      need: climbPrerequisite(lastStop),
    }
  }
  // Went nowhere, but no search ever finished to say it was impossible. That is
  // a don't-know, and a don't-know must never teach the fleet that escape is
  // hopeless.
  const q = bot.entity.position
  if (plannerCommitted) {
    return {
      status: 'failed', failClass: 'path_interrupted', gap: `at_y${Math.round(endY)}`,
      detail: `a walkable route upward existed and the bot did not follow it` +
              (lastErr ? ` (${String(lastErr.message).slice(0, 50)})` : ''),
    }
  }
  return {
    status: 'unknown', failClass: 'no_measurable_change', gap: `at_y${Math.round(endY)}`,
    detail: `no altitude gained from ${q.x.toFixed(0)},${q.y.toFixed(0)},${q.z.toFixed(0)} ` +
            `in ${Math.round((Date.now() - (DEADLINE - 120_000)) / 1000)}s of trying` +
            (lastErr ? ` (${String(lastErr.message).slice(0, 50)})` : '') +
            // THE RAW STOP, NOT ONLY THE ADVICE.
            //
            // This branch logged `climbAdvice(lastStop)` and nothing else, so
            // the only thing reaching telemetry was a human sentence -- "this
            // stone needs a pickaxe" -- and never the machine reason behind it.
            // 515 of 803 of these carried that sentence while the raw string it
            // was derived from appeared ZERO times anywhere in the logs, because
            // the raw string is only emitted by the OTHER return in this
            // function. Two passes were spent guessing at a cause that was
            // being computed and discarded one line before it was needed.
            (lastStop ? ` [stop: ${String(lastStop).slice(0, 70)}]` : '') +
            climbAdvice(lastStop),
    need: climbPrerequisite(lastStop),
  }
}

/**
 * USE THE BUCKET. `bucket fill` scoops a source; `bucket pour` places one.
 *
 * A SKILL AND NOT A REFLEX, AND THE FLEET DECIDED THAT.
 *
 * The obvious wiring was to make the drowning rescue scoop the water over its
 * own head, and reflex.mjs has been carrying the instrument to decide it:
 * `scoop=${scoopWouldHelp(bot)}` on every drowning route, under a note saying
 * the capability is "only worth building if this reads true on a real share of
 * sealed rescues". Measured over 12h on 80 bots across 30,006 routes:
 *
 *     scoop=dry 51.6%   scoop=no 43.5%   scoop=flowing 4.8%   scoop=yes 0.1%
 *
 * Thirty-one events. Even restricted to the sealed case that note named, 6 of
 * 148. So the reflex does not get a bucket: 43.5% of the time the head IS in a
 * source and scooping it refills within five ticks, which buys nothing. That is
 * the second time this instrument has answered no -- an earlier read was 1 yes
 * in 2,669 -- and a deterministic behaviour nobody can show a use for is how
 * this project keeps shipping dead code that still carries risk.
 *
 * So the bucket is offered to the MODEL and what it does with it is measured.
 * Every refusal is returned verbatim, because the question that decides the
 * next change is which of these the bots actually run into.
 */
async function bucketSkill (ctx, args, signal) {
  const { bot } = ctx
  const action = String(args?.action ?? '').toLowerCase()
  if (action !== 'fill' && action !== 'pour') {
    return { status: 'failed', failClass: 'bad_args',
             detail: `bucket needs action=fill or action=pour, got "${args?.action ?? ''}"` }
  }
  const p = bot.entity?.position
  if (!p) return { status: 'failed', failClass: 'not_connected', detail: 'no position' }
  const has = n => (bot.inventory?.items?.() ?? []).some(i => i.name === n)
  const at = (dx, dy, dz) => { try { return bot.blockAt(p.offset(dx, dy, dz)) } catch { return null } }
  // Only cells the bot can actually reach. The server ray-traces the use, so a
  // target beyond reach is not a near miss, it is nothing at all. Head height
  // first: that is the cell that decides whether the bot can breathe.
  const near = []
  for (let dy = 1; dy >= -1; dy--) {
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const b = at(dx, dy, dz)
      if (b) near.push({ b, off: [dx, dy, dz], d: Math.hypot(dx, dy, dz) })
    }
  }
  const reasons = []
  if (action === 'fill') {
    const hasEmpty = has('bucket')
    for (const c of near) {
      const [dx, dy, dz] = c.off
      const why = scoopRefusal({
        hasEmptyBucket: hasEmpty, target: c.b, above: at(dx, dy + 1, dz),
        cardinals: [at(dx + 1, dy, dz), at(dx - 1, dy, dz), at(dx, dy, dz + 1), at(dx, dy, dz - 1)],
        distance: c.d,
      })
      if (why) { reasons.push(why); continue }
      check(signal)
      const r = await scoopLiquid(bot, p.offset(dx, dy, dz))
      return r.ok
        ? { status: 'success', detail: `filled the bucket (${r.aims} aim(s))` }
        : { status: 'failed', failClass: 'bucket_fill', detail: `fill failed: ${r.why}` }
    }
    return { status: 'failed', failClass: 'bucket_fill',
             detail: `nothing within reach to fill from [${[...new Set(reasons)].slice(0, 3).join(' | ')}]` }
  }
  const hasWater = has('water_bucket')
  for (const c of near) {
    const [dx, dy, dz] = c.off
    const target = { ...c.b, position: p.offset(dx, dy, dz) }
    const why = emptyRefusal({ hasWaterBucket: hasWater, target, distance: c.d,
                               standingIn: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } })
    if (why) { reasons.push(why); continue }
    check(signal)
    const r = await pourLiquid(bot, p.offset(dx, dy, dz))
    return r.ok
      ? { status: 'success', detail: `poured a water source (${r.aims} aim(s))` }
      : { status: 'failed', failClass: 'bucket_pour', detail: `pour failed: ${r.why}` }
  }
  return { status: 'failed', failClass: 'bucket_pour',
           detail: `nowhere within reach will take a pour [${[...new Set(reasons)].slice(0, 3).join(' | ')}]` }
}

export const SKILLS = {
  goto:    { run: goto,    usage: 'goto <x> <y> <z>',              args: ['x', 'y', 'z'] },
  gather:  { run: gather,  usage: 'gather <count> <block_name>',   args: ['count', 'block'] },
  come:    { run: come,    usage: 'come',                          args: [], chatOnly: true },
  follow:  { run: follow,  usage: 'follow [seconds]',              args: [], chatOnly: true },
  home:    { run: home,    usage: 'home',                          args: [], rescue: true },
  deposit: { run: deposit, usage: 'deposit [item_name]',           args: [] },
  withdraw:{ run: withdraw,usage: 'withdraw [item_name] [count]',  args: ['item', 'count'] },
  // NEVER OFFERED TO THE MODEL (chatOnly keeps it out of the schema enum and the prompt): issued only as a
  // deterministic work order from cognitive.mjs at TRIGGER_SLOTS, so a model can never choose to break a tool.
  wear_out: { run: wearOut, usage: 'wear_out',                      args: [], chatOnly: true },
  // Same rule as wear_out: deterministic town orders from townOrder (composter.mjs), never the model's choice.
  compost:  { run: compost,  usage: 'compost',                       args: [], chatOnly: true },
  build_composter: { run: buildComposter, usage: 'build_composter', args: [], chatOnly: true },
  withdraw_pick: { run: withdrawPick, usage: 'withdraw_pick', args: [], chatOnly: true },
  // Same rule: the deterministic town deposit (towndeposit.mjs townDepositOrder), never the model's choice.
  town_deposit: { run: townDeposit, usage: 'town_deposit', args: [], chatOnly: true },
  status:  { run: status,  usage: 'status',                        args: [] },
  eat:     { run: eat,     usage: 'eat',                           args: [] },
  craft:   { run: craft,   usage: 'craft <count> <item_name>',     args: ['item', 'count'] },
  place:   { run: place,   usage: 'place <item_name>',             args: ['item'] },
  bucket:  { run: bucketSkill, usage: 'bucket <fill|pour>',        args: ['action'] },
  build:   { run: build,   usage: 'build <plan> [block_name]',      args: ['plan', 'block'] },
  // RESCUE-CLASS, like home and surface. `explore` is the generic relocation
  // valve -- what a bot reaches for when it does not know what else to do --
  // and it became the single most suppressed action in the system: 35,304
  // learned_avoid vetoes fleet-wide, more than twice the next worst.
  //
  // The cause is the key, not the skill. actionKey keeps only DECLARED args, and
  // the model usually omits `blocks`, so every failed explore anywhere in a
  // 3,900-block world collapses onto one counter: `explore:{}`. Four failures
  // in one bad corner of the map is enough to make relocating "known bad"
  // everywhere, forever -- and the average vetoed action carries 198 accumulated
  // failures, which at one forgiven per 20 idle minutes is ~66 hours of aging
  // to become proposable again.
  //
  // Context-free memory about a location-dependent action is not knowledge.
  // Arm-neutral: every arm loses the same invalid rule, and every other avoid
  // rule -- which is where the shared-memory treatment actually lives -- is
  // untouched.
  explore: { run: explore, usage: 'explore [blocks]',              args: ['blocks'], rescue: true },
  mine:    { run: mine,    usage: 'mine <target_y>',               args: ['y'] },
  // `args: ['item']` IS THE POLICY DECISION HERE, not a formality.
  //
  // actionKey keeps only DECLARED args, so this is the granularity of the
  // learned-avoid counter. `args: []` would collapse every smelt failure in the
  // world onto one key -- the exact defect that made `explore:{}` the single
  // most suppressed action in the system at 35,304 vetoes. Keyed on the item,
  // "raw_iron does not smelt here" cannot poison `smelt sand`.
  //
  // NOT `rescue: true`. Rescue suppresses recordFailure entirely (lessons.mjs),
  // which is right for home/surface/explore -- verbs a trapped bot must always
  // be allowed to try. smelt is a PRODUCTION verb: a bot that genuinely cannot
  // smelt something should be able to learn that, and the ratchet is handled
  // where it belongs instead. Every refusal above is either situational
  // (`missing_ingredients`/`needs_station`, which EVIDENCE_ONLY_IF_STUCK only
  // counts once the named gap stops moving), unknowable (`smelt_budget`,
  // `furnace_window`, which get no vote at all), or a permanent truth about the
  // key (`bad_target` for an item no furnace will ever transform). Marking it
  // rescue would also delete the one honest lesson smelt can teach.
  smelt:   { run: smelt,   usage: 'smelt <item_name>',              args: ['item', 'count'] },
  // OPERATOR-ONLY from 2026-08-18. Beds remain in the world as spawn
  // infrastructure; the LLM no longer spends decisions on sleeping.
  //
  // 0 successes in 505 calls. 75% of those failed on travel and 22% were chosen
  // in daylight against a prompt that already says night-only -- a
  // model/action-selection mismatch, not a missing instruction. But the
  // decisive objection is arm-neutrality: board and placebo bots travel to town
  // by obligation, so they stand near the beds at night far more often than
  // hive and isolated bots. A mechanism whose opportunity rate is a function of
  // town-visit frequency is treatment-mediated, which is the same defect that
  // kept stockpile perception out of Block 2.
  sleep:   { run: sleepSkill, usage: 'sleep',                      args: [], chatOnly: true },
  board:   { run: board,   usage: 'board',                         args: [] },
  surface: { run: surface, usage: 'surface',                       args: [], rescue: true },
}

export { Aborted }
