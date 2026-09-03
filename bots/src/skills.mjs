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

import pkg from 'mineflayer-pathfinder'
const { goals, Movements } = pkg
import { Vec3 } from 'vec3'
import { config } from './config.mjs'
import { overheadBreakRisk, dryColumnStep } from './scaffold.mjs'
import { planDig, predictedDigMs } from './digbudget.mjs'
import { log, logEvent } from './logger.mjs'
import { breathPlan } from './swim-breath.mjs'
import { countItem, horizontalDistanceFromSpawn, snapshot } from './state.mjs'
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
  // furnace_window  the server never opened the furnace window. craft files the
  //               same event as `no_path`, which is defensible there and wrong
  //               here: the avoid key is `smelt:{"item":"raw_iron"}`, which
  //               carries no position, so one bad furnace anywhere would teach
  //               the whole fleet that smelting raw_iron is impossible
  //               everywhere -- the `explore:{}` collapse documented in SKILLS.
  'furnace_window',
])

/** The honest status for a failure class: a don't-know is not a no. */
export const statusFor = failClass => UNKNOWN_FAIL_CLASSES.has(failClass) ? 'unknown' : 'failed'

class Aborted extends Error { constructor() { super('aborted'); this.aborted = true } }
const check = signal => { if (signal?.aborted) throw new Aborted() }
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Aborted()) }, { once: true })
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
function withTimeout(promise, ms, bot, { what = 'pathfinding', onTimeout = null,
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
          try { bot.pathfinder?.setGoal(null) } catch {}
          try { bot.pathfinder?.stop() } catch {}
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
  ]).finally(() => { clearTimeout(t); if (watch) clearInterval(watch) })
}

/** Refuse any destination outside the world border. */
function assertInsideBorder(x, z) {
  const d = horizontalDistanceFromSpawn({ x, z })
  if (d > config.world.borderRadius) {
    throw new Error(`target ${Math.round(d)} blocks out exceeds border ${config.world.borderRadius}`)
  }
}

// Pickaxe/axe/shovel tiers, worst to best. Used only to break digTime ties.
const TOOL_TIER = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite']
const toolTier = name => TOOL_TIER.findIndex(t => name.startsWith(t + '_'))

function bestTool(bot, block) {
  // EVERY PICKAXE TIES ON 93 KINDS OF ORE, so the tie-break is not cosmetic.
  //
  // iron_ore, gold_ore, diamond_ore, redstone_ore, lapis_ore, emerald_ore, all
  // the deepslate variants, obsidian, ancient_debris and the metal blocks carry
  // `material: "incorrect_for_wooden_tool"`, and minecraft-data's table for that
  // material lists ONLY wooden tools. prismarine-block's digTime looks up
  // registry.materials[material][heldItemType]; for a stone or iron pickaxe on
  // iron ore the lookup misses, isBestTool stays false, and the speed multiplier
  // stays at 1.
  //
  // So digTime returns the same number for every pickaxe we own, `t < bestTime`
  // never fires after the first, and the bot equips whichever tool happens to
  // come first in the inventory. Bots have been mining deepslate ore with a
  // stone pickaxe while carrying an iron one -- which is slower, which is more
  // time against the 180s skill budget, which is a timeout we then record as a
  // mining failure.
  let best = null, bestTime = Infinity
  for (const it of bot.inventory.items()) {
    if (!block.canHarvest(it.type)) continue
    const t = block.digTime(it.type, false, false, false)
    if (t < bestTime || (t === bestTime && best && toolTier(it.name) > toolTier(best.name))) {
      bestTime = t; best = it
    }
  }
  return best
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
      signal?.addEventListener('abort', () => { try { bot.pathfinder.stop() } catch {} }, { once: true })
      await withTimeout(p, 25000, bot)

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
          try {
            await bot.withAscentMovements(async () => {
              await withTimeout(bot.pathfinder.goto(goal), 25000, bot)
            })
            check(signal)
            if (bot.entity.position.distanceTo(before) >= 2) continue   // it worked; carry on
          } catch { /* fall through to the honest failure below */ }
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
              await withTimeout(bot.pathfinder.goto(goal), 20000, bot)
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
        if (!rodeDown && bot.entity.position.y >= SEA_LEVEL + 20 &&
            (bot.health ?? 20) >= 18 && Number(target.y) < bot.entity.position.y - 8 &&
            rescueBlocks(bot).length > 0) {
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
  const under = bot.blockAt(bot.entity.position.offset(0, -1, 0))
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
  for (let i = 0; i < 12; i++) {
    check(signal)
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (!below) break
    if (!FOLIAGE.test(below.name)) { freed = true; break }   // reached solid ground
    if (below.name === 'air') { await sleep(400, signal); continue }   // falling
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
  return freed
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
async function collectManually(bot, block, signal) {
  const p = block.position
  try {
    await withTimeout(
      bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2)), 15000, bot)
  } catch (e) {
    if (e.aborted || signal?.aborted) throw e
    // Close enough to reach is good enough; the dig below decides.
  }
  check(signal)
  const tool = bestTool(bot, block)
  if (tool) await bot.equip(tool, 'hand').catch(() => {})
  // BOUND THE DIG. bot.dig() has no timeout of its own: it resolves when the
  // server confirms the break, and waits forever if that never comes -- the
  // block changed under us, another bot took it, the chunk unloaded. This is
  // now the ONLY path gather takes, so an unbounded await here would reproduce
  // the exact failure that made collectblock unusable, in our own code.
  // Named `dig` so a dig that never finishes is not filed as a pathing failure,
  // and cleaned up with stopDigging() rather than the pathfinder default --
  // clearing a path goal does nothing for a stuck dig.
  await withTimeout(bot.dig(block), 20_000, bot, {
    what: 'dig',
    onTimeout: () => { try { bot.stopDigging?.() } catch { /* not digging */ } },
  })
  await pickupNearbyItems(bot, signal)
}

/** Walk over anything on the floor within a few blocks. */
async function pickupNearbyItems(bot, signal, radius = 8) {
  let last = null
  for (let i = 0; i < 4; i++) {
    check(signal)
    const drop = bot.nearestEntity?.(e =>
      e.name === 'item' && bot.entity.position.distanceTo(e.position) < radius)
    if (!drop) return
    // The same drop twice means walking to it is not working; stop rather than
    // spend the budget orbiting it.
    if (last && drop.id === last) return
    last = drop.id
    try {
      await withTimeout(bot.pathfinder.goto(
        new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1)), 6000, bot)
    } catch (e) {
      if (e.aborted || signal?.aborted) throw e
      return
    }
    await sleep(250, signal)
  }
}

async function gather(ctx, { block: blockName, count = 16, maxDistance = 32 }, signal) {
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

  await descendToGround(ctx, signal).catch(() => {})
  check(signal)

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
  let collected = 0, rounds = 0, barren = 0, timedOut = 0
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
    const safeTarget = p => isSafeToBreak(bot, p)
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
    let reachable = [
      ...safeOnes.filter(approachable),
      ...safeOnes.filter(q => !approachable(q)),
    ]

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

    if (reachable.length === 0) {
      if (collected > 0) {
        return { status: 'success', detail: `collected ${collected} ${blockName} (the rest are buried or unsafe)` }
      }
      if (rejectedUnsafe > 0 && exposedOnes.length === rejectedUnsafe) {
        return { status: 'failed', failClass: 'no_safe_target',
                 detail: `${blockName} found but all ${rejectedUnsafe} candidates are beside water or ` +
                         `under falling blocks — digging them would flood or bury this spot` }
      }
      return { status: 'failed', failClass: 'unreachable',
               detail: `${blockName} found but every candidate is buried — use mine to dig down` +
                       belowGroundHint(bot) }
    }

    const target = bot.blockAt(reachable[0])
    if (!target || target.name !== (viaSource ?? blockName)) continue

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
    if (gained === collected) {
      barren++
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
        const [failClass, why] = timedOut >= barren
          ? ['collect_budget',
             `ran out of time reaching ${blockName} (${timedOut}/${barren} attempts timed out at ${COLLECT_MS / 1000}s)`]
          : ['no_path', `${blockName} found but unreachable after ${barren} attempts`]
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
async function deposit(ctx, { item = null }, signal) {
  const { bot } = ctx
  const findChest = () => bot.findBlock({
    matching: b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry.blocks[b.type]?.name),
    maxDistance: 48,
  })
  let chestBlock = findChest()
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

  await bot.pathfinder.goto(new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2))
  check(signal)

  const chest = await bot.openContainer(chestBlock)
  let moved = 0
  try {
    for (const it of bot.inventory.items()) {
      check(signal)
      if (item && it.name !== item) continue
      try { await chest.deposit(it.type, null, it.count); moved += it.count } catch { /* chest full */ }
    }
  } finally {
    chest.close()
  }
  if (moved > 0) return { status: 'success', detail: `deposited ${moved} items` }
  // Written out rather than left as a ternary on `status` so the preflight scan
  // in bots/test/evidence-gate.test.mjs can see it. A failure hidden inside a
  // conditional expression is exactly the one that keeps its class by accident.
  //
  // NOT `inventory`. That class is in EVIDENCE_ONLY_IF_STUCK and would start
  // writing avoid rules against `deposit`; classifyFailure filed this string as
  // `other`, which never voted, and naming the class must not smuggle in a
  // policy change alongside the honesty change.
  return { status: 'failed', failClass: 'nothing_to_deposit',
           detail: 'deposited 0 items — nothing matching to hand over, or the chest was full' }
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

async function craft(ctx, { item, count = 1 }, signal, depth = 0) {
  const { bot } = ctx
  const def = bot.registry.itemsByName[item]
  // `other`, not `bad_target`, deliberately. bad_target IS evidence about the
  // action and would begin writing permanent avoid rules for every item name the
  // model mistypes; the classifier filed this string as `other` and gave it no
  // vote. Stating the class is meant to end the guessing, not to change policy.
  if (!def) return { status: 'failed', failClass: 'other', detail: `unknown item "${item}"` }

  // Recipes needing no table first -- cheaper and always available.
  let recipe = bot.recipesFor(def.id, null, count, null)[0]
  let table = null

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
      for (const r of all.slice(0, 12)) {
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
        const held = bot.inventory.items().map(i => i.name.split('_')[0])
        const stem = x => x.split(' ').pop().split('_')[0]
        const affinity = g => g.filter(x => held.includes(stem(x))).length
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
        const better = (g, b) =>
          g.length < b.length ||
          (g.length === b.length && affinity(g) > affinity(b)) ||
          (g.length === b.length && affinity(g) === affinity(b) && canonical(g) > canonical(b))
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
        `${bot.inventory.items().slice(0, 3).map(i => `${i.count}x ${i.name}`).join(', ') || 'nothing'})`
      : 'missing ingredients or need a crafting_table nearby'

    // TWO DIFFERENT FAILURES, and this returned one class for both. "I have the
    // ingredients but no station" and "I have no ingredients" need different
    // remedies, and classifyFailure() already distinguishes them -- but an
    // explicit failClass wins over the classifier, so `needs_station` was
    // unreachable on the live write path and only ever appeared in tests.
    const stationOnly = hasTable && !missing.length

    // ---- resolve prerequisites, then try again -----------------------------
    //
    // Everything needed to do this was already computed above for the error
    // message. Acting on it is the whole change.
    // What the sub-crafts below could not resolve. Reported instead of `missing`
    // when nothing could be made -- see the return at the bottom.
    const blockedBy = []

    if (depth < MAX_CRAFT_DEPTH) {
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
          const built = await craft(ctx, { item: 'crafting_table', count: 1 }, signal, depth + 1)
          if (built.status === 'success') made.push('crafting_table')
        }
        const put = await place(ctx, { item: 'crafting_table' }, signal)
        if (put.status === 'success') made.push('placed crafting_table')
      }

      // One level down, per missing ingredient. `missing` entries look like
      // "3x oak_planks"; anything that does not parse is left alone rather than
      // guessed at.
      for (const m of missing) {
        const parsed = /^(\d+)x\s+(\S+)$/.exec(m)
        if (!parsed) continue
        const [, need, name] = parsed
        if (name === item) continue          // a recipe that needs itself: never recurse
        check(signal)
        const sub = await craft(ctx, { item: name, count: Number(need) }, signal, depth + 1)
        if (sub.status === 'success') made.push(name)
        // KEEP WHAT THE DEEPER CALL LEARNED. It just walked a level further
        // down the tree and knows a truer answer than the gap computed here.
        else blockedBy.push(sub.gap || m)
      }

      // Only retry if something actually changed. Retrying after a no-op is how
      // a bounded recursion still burns the whole skill timeout.
      if (made.length) {
        check(signal)
        const retry = await craft(ctx, { item, count }, signal, depth + 1)
        if (retry.status === 'success') {
          return { status: 'success', detail: `${retry.detail} (first made ${made.join(', ')})` }
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
    const rootGap = blockedBy.length ? [...new Set(blockedBy)].sort() : missing
    const gatherFirst = rootGap.filter(g => {
      const n = /^\d+x\s+(\S+)$/.exec(g)?.[1] ?? g
      const d = bot.registry.itemsByName[n]
      if (!d) return false
      try {
        return [...bot.recipesAll(d.id, null, null),
                ...(bot.recipesAll(d.id, null, true) ?? [])].length === 0
      } catch { return false }
    })

    return {
      status: 'failed',
      failClass: stationOnly ? 'needs_station' : 'missing_ingredients',
      // THE GAP, named exactly, so the lessons store can tell "stuck on the
      // same missing thing" from "working through the tech tree". Without it
      // the only question the store can ask is "did craft fail again", which
      // is how `craft oak_planks` reached 47 while the bot was doing the right
      // thing every time. Sorted so two identical gaps compare equal.
      gap: stationOnly ? 'crafting_table' : rootGap.slice().sort().join('+'),
      detail: stationOnly
        ? `no recipe available for ${item}; place the crafting_table first`
        : gatherFirst.length
          ? `cannot craft ${item} -- gather ${gatherFirst.join(' and ')} first, ` +
            `nothing crafts it (you have ` +
            `${bot.inventory.items().slice(0, 3).map(i => `${i.count}x ${i.name}`).join(', ') || 'nothing'})` +
            belowGroundHint(bot) + craftableAlternative(bot, item)
          : `cannot craft ${item} -- ${why}`,
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
    const reach = bot.entity.position.distanceTo(table.position.offset(0.5, 0.5, 0.5))
    if (reach > 4.5) {
      return {
        status: 'failed',
        failClass: 'no_path',
        detail: `crafting_table is ${Math.round(reach)} blocks away and could not be reached — ` +
                `${item} needs one within 4 blocks; move to ${table.position.x},${table.position.z} first`,
      }
    }
    try { await bot.lookAt(table.position.offset(0.5, 0.5, 0.5), true) } catch { /* not fatal */ }
  }

  try {
    await bot.craft(recipe, count, table ?? undefined)
    return { status: 'success', detail: `crafted ${count}x ${item}` }
  } catch (e) {
    // Name the real problem. "Event windowOpen did not fire" is mineflayer's
    // wording for "the server refused to open the container", which in practice
    // means out of reach or the block is gone.
    const windowFail = /windowOpen|window/i.test(e.message)
    return {
      status: 'failed',
      failClass: windowFail ? 'no_path' : 'other',
      detail: windowFail
        ? `could not open the crafting_table at ${table?.position.x},${table?.position.z} — ` +
          'stand next to it and face it before crafting'
        : `craft ${item} failed: ${e.message.slice(0, 80)}`,
    }
  }
}

// --------------------------------------------------------------- place -----
async function place(ctx, { item, x, y, z }, signal) {
  const { bot } = ctx
  const held = bot.inventory.items().find(i => i.name === item)
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
  const solid       = b => b != null && b.boundingBox === 'block'
  const replaceable = b => b != null && b.boundingBox === 'empty' &&
                           b.name !== 'water' && b.name !== 'lava'

  let candidates = []
  if ([x, y, z].every(v => Number.isFinite(Number(v)))) {
    assertInsideBorder(Number(x), Number(z))
    candidates = [bot.blockAt(new Vec3(Number(x), Number(y) - 1, Number(z)))]
  } else {
    // Diagonals and one step up or down as well, nearest first. A bot on uneven
    // ground has a valid spot behind it far more often than beside it.
    const around = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    for (const dy of [-1, 0, -2]) {
      for (const [dx, dz] of around) {
        const under = bot.blockAt(bot.entity.position.offset(dx, dy, dz))
        const at    = bot.blockAt(bot.entity.position.offset(dx, dy + 1, dz))
        if (solid(under) && replaceable(at)) candidates.push(under)
      }
    }
  }
  if (!candidates.length) {
    return {
      status: 'failed',
      failClass: 'no_space',
      detail: `nowhere to place ${item}: no solid block with a free space above it within reach`,
    }
  }

  check(signal)
  await bot.equip(held, 'hand')

  // TRY MORE THAN ONE. placeBlock fails for reasons the block lookup cannot
  // see -- an entity standing in the cell, the server disagreeing about
  // occupancy, the bot facing the wrong way. Giving up after the first
  // candidate turned a recoverable miss into a dead tech tree.
  const failures = []
  for (const ref of candidates.slice(0, 6)) {
    check(signal)
    try {
      // Facing the target makes mineflayer's block interaction markedly more
      // reliable; the same lesson the crafting-table reach check already learned.
      try { await bot.lookAt(ref.position.offset(0.5, 1.5, 0.5), true) } catch { /* not fatal */ }
      await bot.placeBlock(ref, new Vec3(0, 1, 0))
      // READ IT BACK. placeBlock resolves without throwing when nothing was
      // placed -- build() already documents this and checks; place() did not.
      // The contract for `place` is `world_change`, and the runner scores that
      // from `result.placed`, which this never returned. So every successful
      // place was scored as changing nothing, classified `neutral`, and then
      // recorded as a success anyway by the neutral branch in cognitive.mjs.
      // A success nobody can falsify is not evidence.
      const at = ref.position.offset(0, 1, 0)
      const put = bot.blockAt(at)
      if (!put || put.name === 'air' || put.boundingBox === 'empty') {
        failures.push(`placeBlock returned but ${at} is still ${put?.name ?? 'unknown'}`)
        continue
      }
      return { status: 'success', placed: 1, detail: `placed ${item} at ${at}` }
    } catch (e) {
      failures.push(e.message)
    }
  }
  return {
    status: 'failed',
    failClass: 'no_space',
    detail: `place ${item} failed at ${candidates.length} spot(s): ${failures[0] ?? 'unknown'}`,
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
      await bot.placeBlock(ref, new Vec3(0, 1, 0))
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
async function explore(ctx, { blocks = 60, heading = null }, signal) {
  const { bot } = ctx
  const start = bot.entity.position.clone()

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
      ang += (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 3)   // blocked: turn, do not give up
      // MOVE, even on failure. Each failed leg costs up to the pathfinder's
      // think timeout with the bot stationary, so three or four in a row
      // accumulate past the 45s stuck threshold and the reflex cancels the whole
      // skill -- measured, 8 explore attempts and 8 aborts, every one killed by
      // `reflex: stuck` while the bot was busy planning.
      //
      // A short walk in the new heading proves to the reflex layer that the bot
      // is working, and incidentally makes the next plan start from somewhere
      // different, which is often why the previous one failed.
      try {
        await bot.look(ang, 0, true)
        bot.setControlState('forward', true)
        bot.setControlState('jump', true)
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


// ------------------------------------------------------------- withdraw -----
//
// The inverse of deposit, and its absence was structural.
//
// `deposit` has existed since the storage work; `withdraw` never did. A bot
// could put items into a chest and no bot could ever take them out, so the
// shared chests were a one-way sink. Measured tonight: the two scouts held 25
// and 59 oak_log between them and are never told to craft, while Miner01 -- the
// one whose milestone chain IS planks -> sticks -> table -> pickaxe -- held five
// dirt. The materials and the job were in different bots with no path between
// them.
//
// Same shape as the rest of tonight's bugs: something could be added but never
// removed, a guard could trip with no way back. A colony needs both directions.
async function withdraw(ctx, { item = null, count = 16 }, signal) {
  const { bot } = ctx
  const chestBlock = bot.findBlock({
    matching: b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry.blocks[b.type]?.name),
    maxDistance: 48,
  })
  if (!chestBlock) return { status: 'failed', failClass: 'nothing_found', detail: 'no chest or barrel within 48 blocks' }

  check(signal)
  try {
    await withTimeout(bot.pathfinder.goto(
      new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2)), 20000, bot)
  } catch {
    return { status: 'failed', failClass: 'no_path', detail: `could not reach the chest at ${chestBlock.position.x},${chestBlock.position.z}` }
  }
  check(signal)

  const chest = await bot.openContainer(chestBlock)
  try {
    const items = chest.containerItems()
    if (!items.length) {
      return { status: 'no_effect', detail: 'the chest is empty' }
    }
    // No item named -> take whatever is most plentiful. A bot that knows it
    // needs something specific should say so; one that just needs materials
    // should not have to guess what is in there.
    const want = item
      ? items.filter(i => i.name === item)
      : [items.slice().sort((a, b) => b.count - a.count)[0]]
    if (!want.length) {
      return {
        status: 'failed', failClass: 'nothing_found',
        detail: `no ${item} in the chest — it holds ${items.slice(0, 4).map(i => `${i.count}x ${i.name}`).join(', ')}`,
      }
    }
    let took = 0
    for (const it of want) {
      check(signal)
      const n = Math.min(it.count, Math.max(1, Number(count) || 16) - took)
      if (n <= 0) break
      await chest.withdraw(it.type, null, n)
      took += n
      if (took >= (Number(count) || 16)) break
    }
    return took > 0
      ? { status: 'success', detail: `withdrew ${took}x ${want[0].name} from the chest` }
      : { status: 'no_effect', detail: 'nothing withdrawn' }
  } catch (e) {
    return { status: 'failed', failClass: 'other',
             detail: `withdraw failed: ${e.message.slice(0, 70)}` }
  } finally {
    try { chest.close() } catch { /* already closed */ }
  }
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
  const reach = bot.entity.position.distanceTo(block.position.offset(0.5, 0.5, 0.5))
  if (reach > 4.5) {
    return { status: 'failed', failClass: 'no_path',
             detail: `the furnace is ${Math.round(reach)} blocks away and could not be reached — ` +
                     `smelting needs one within 4 blocks; move to ${block.position.x},${block.position.z} first` }
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
  const { bot } = ctx
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
  while (bot.entity.position.y > goalY + 1 && steps < 90) {
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
    const cellFeet = p0.offset(bear.x, -1, bear.z)   // where the bot will stand
    const cellHead = p0.offset(bear.x, 0, bear.z)    // headroom over the tread
    const treadFloor = p0.offset(bear.x, -2, bear.z) // what holds it up
    const below = bot.blockAt(cellFeet)
    if (!below) break
    for (const [pos, what] of [[cellFeet, 'tread'], [cellHead, 'headroom']]) {
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
    let hollow = 0
    for (let d = 0; d <= 2; d++) {
      const b = bot.blockAt(treadFloor.offset(0, -d, 0))
      if (!b || b.name === 'air' || b.name === 'cave_air' || b.boundingBox === 'empty') hollow++
      else break
    }
    if (hollow >= 3) {
      return {
        status: 'failed', failClass: 'void_below',
        gap: `at_y${Math.round(bot.entity.position.y)}`,
        detail: `stopped at y=${Math.round(bot.entity.position.y)}: open space at least ` +
                `${hollow + 1} blocks deep under the next step — that is a fall, not a stair`,
      }
    }
    // Dig headroom first: a falling-block column above an already-open tread
    // pours gravel into the cell the bot is about to occupy.
    for (const pos of [cellHead, cellFeet]) {
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
    await sleep(250, signal)
    const now = bot.entity.position
    const at = now.floored()
    moved = Math.hypot(now.x - before.x, now.z - before.z)
    const arrived = at.x === cellFeet.x && at.y === cellFeet.y && at.z === cellFeet.z
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
        stairLiquid(bot.blockAt(stand.offset(bear.x, 0, bear.z)))) break
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
 * to break the block; mineflayer-collectblock then turns that refusal off on
 * every single call (CollectBlock.ts sets `dontCreateFlow = false` before each
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
    for (const cell of [stand.offset(bear.x, -1, bear.z), stand.offset(bear.x, 0, bear.z)]) {
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
// THE BODY HANDSHAKE. `bot.waterTravel` tells the drowning reflex that being wet
// is intentional right now. The reflex still owns real drowning -- oxygen
// actually falling, health actually dropping -- because that is what it was
// written for after eight bots died in forty-five minutes. What it stops doing
// is treating a bot at the surface with full lungs as an emergency.
async function swimTo (ctx, { x, y, z, range = 4 }, signal) {
  const { bot } = ctx
  assertInsideBorder(x, z)
  check(signal)
  bot.assertNav?.('swim_to')

  const target = new Vec3(Number(x), Number(y), Number(z))
  const here0 = bot.entity.position
  const startDist = Math.hypot(target.x - here0.x, target.z - here0.z)

  const inWater = () => {
    const b = bot.blockAt?.(bot.entity.position)
    return !!b && (b.name === 'water' || b.name === 'bubble_column')
  }
  const onLand = () => {
    if (!bot.entity?.onGround) return false
    const below = bot.blockAt?.(bot.entity.position.offset(0, -1, 0))
    return !!below && below.name !== 'water' && below.boundingBox === 'block'
  }

  // Refuse the job rather than do it badly. A dry bot asking to swim wants
  // `goto`, and silently doing something else is how a skill's name stops
  // meaning anything.
  if (!inWater()) {
    return { status: 'failed', failClass: 'unsupported',
             detail: 'not in water — use goto for land travel' }
  }

  // A ONE-BLOCK SWIM IS NOT A CROSSING, AND ACCEPTING IT HID A PROMPT BUG.
  //
  // The model asked for 0b and 1b "crossings" because the observation told it to
  // swim without telling it where land was. Accepting those requests turned a
  // prompt defect into a skill that thrashed for twelve seconds and aborted at
  // oxygen 3. A skill that cannot succeed at what it was asked should say so
  // immediately and name the alternative, so the failure reads as the bad
  // request it is.
  // A SHORT SWIM IS STILL A SWIM.
  //
  // This refused anything under 8 blocks as "not a crossing". Measured over 636
  // bot-hours it was the single largest swim_to failure: 1,158 `bad_target`, of
  // which 597 were targets ONE BLOCK away. A bot in water asking to move one
  // block to land is the most sympathetic request in the system, and we
  // answered it by naming two other skills -- `goto`, which paths through water
  // it could not afford, and `surface`, which does not go anywhere.
  //
  // The original reasoning was that 0b and 1b requests were a PROMPT defect
  // wearing a skill's clothes. That was true and is still worth logging, but
  // refusing the bot does not fix the prompt; it just leaves it in the water.
  // Do the short swim, and record that it was short.
  if (startDist < 2) {
    logEvent({ kind: 'swim_short_hop', status: 'success',
               detail: `target ${startDist.toFixed(1)}b away — doing it anyway; ` +
                       `a bot in water asking to move one block is not a bad request`,
               snapshot: snapshot(bot) })
  }

  // TAKE THE BODY, for the same reason the reflex does: pathfinder's
  // monitorMovement rewrites forward/jump/sprint every physics tick while a goal
  // is set, so a swim that does not clear the goal is overwritten within ~50ms.
  try { bot.pathfinder.setGoal(null) } catch { /* plugin may be absent */ }
  try { bot.clearControlStates() } catch { /* not connected */ }

  bot.waterTravel = { active: true, since: Date.now(), target }

  // SURFACE FIRST. A submerged bot that starts swimming horizontally drowns on
  // the way: measured `0 strokes over 0s` followed immediately by `aborted:
  // oxygen 3`, because the loop's own oxygen guard fired before the first
  // stroke. Hold jump until the head is in air, then travel.
  const headIsAir = () => {
    const h = bot.blockAt?.(bot.entity.position.offset(0, 1, 0))
    return !!h && h.name !== 'water' && h.boundingBox === 'empty'
  }
  // IS THERE ANY AIR ABOVE US AT ALL. Porpoising assumes the surface is
  // reachable; under ice, an overhang or a flooded ceiling it is not, and
  // burning the last of a breath rising into stone is worse than handing the
  // body to the reflex early. Four blocks is what a bot can rise through inside
  // one breath's margin.
  const canSurface = () => {
    for (let dy = 1; dy <= 4; dy++) {
      const b = bot.blockAt?.(bot.entity.position.offset(0, dy, 0))
      if (!b) return true                       // unloaded: assume open, do not trap
      if (b.name !== 'water' && b.boundingBox === 'empty') return true
      if (b.boundingBox === 'block') return false   // solid lid
    }
    return true
  }
  let breathPhase = 'dive'
  // The server's air scale, learned rather than assumed: 1.21.8 reports ~400
  // where a constant would say 20, and a threshold on the wrong scale never fires.
  let airScale = 20
  let jumpTicks = 0
  const noteAir = () => {
    if (typeof bot.oxygenLevel === 'number') airScale = Math.max(airScale, bot.oxygenLevel)
  }
  noteAir()

  const SURFACE_MS = 6_000
  const surfaceBy = Date.now() + SURFACE_MS
  while (!headIsAir() && Date.now() < surfaceBy) {
    check(signal)
    noteAir()
    bot.setControlState('jump', true)
    bot.setControlState('forward', false)
    await new Promise(r => setTimeout(r, 200))
  }

  // One leg's worth of swimming, not a whole crossing. See the note at the
  // deadline return below.
  const MIN_LEG = 32
  const DEADLINE_MS = 150_000
  const STALL_MS = 12_000        // no closing progress for this long -> give up
  const TICK_MS = 250
  const started = Date.now()
  let best = startDist
  let lastProgressAt = Date.now()
  let strokes = 0

  logEvent({
    kind: 'swim_started',
    status: 'success',
    detail: `crossing ${startDist.toFixed(0)}b to ${Math.round(target.x)},${Math.round(target.z)}`,
    snapshot: snapshot(bot),
  })

  try {
    while (Date.now() - started < DEADLINE_MS) {
      check(signal)
      const here = bot.entity.position
      const dist = Math.hypot(target.x - here.x, target.z - here.z)

      if (dist <= range && onLand()) {
        logEvent({ kind: 'swim_completed', status: 'success',
                   detail: `ashore ${dist.toFixed(1)}b from target after ${strokes} strokes`,
                   snapshot: snapshot(bot) })
        return { status: 'success', detail: `swam ${(startDist - dist).toFixed(0)}b and landed` }
      }

      // ARRIVING IS LANDING, NOT BEING NEAR. A bot treading water on top of its
      // destination has not arrived, and saying it has is the same lie the
      // drowning release used to tell.
      if (dist <= range && !onLand()) {
        // Close enough to look for a foothold rather than a heading.
        const shore = bot.blockAt?.(here.offset(0, -1, 0))
        if (shore && shore.boundingBox === 'block' && shore.name !== 'water') {
          // standing on something already; let the next iteration's onLand() see it
        }
      }

      if (dist < best - 1) { best = dist; lastProgressAt = Date.now() }
      if (Date.now() - lastProgressAt > STALL_MS) {
        return { status: 'failed', failClass: 'stuck',
                 detail: `stalled ${(dist).toFixed(0)}b out; closed ${(startDist - best).toFixed(0)}b of ${startDist.toFixed(0)}b` }
      }

      // Real drowning still outranks the crossing, but this is now a BACKSTOP
      // rather than the plan. It fired 28 times over six hours as
      // "aborted: oxygen 4" -- which is inside the reflex band, so by then the
      // body was already being taken. breathPlan surfaces long before here;
      // reaching this line means the porpoise cycle failed and the honest thing
      // is to hand over.
      if (typeof bot.oxygenLevel === 'number' && bot.oxygenLevel > 0 &&
          bot.oxygenLevel <= 4 && !onLand()) {
        return { status: 'failed', failClass: 'hazard_interrupt',
                 detail: `aborted: oxygen ${bot.oxygenLevel} despite porpoising, ` +
                         `letting the reflex surface us` }
      }

      try { await bot.lookAt(new Vec3(target.x, here.y, target.z), true) } catch { /* not connected */ }

      // FAST SWIMMING IS NOT TREADING WATER.
      //
      // The first version held `jump` every tick to keep the head up. Measured
      // result: median 1.32 m/s. In water, jump adds vertical velocity
      // (prismarine-physics: vel.y += 0.04) and never produces the horizontal
      // sprint-swim pose, so the bot bobs instead of swimming.
      //
      // The real numbers, which corrected an error of mine: surface swimming
      // caps at 2.20 m/s and SPRINT-SWIMMING reaches 3.92 -- not the 5.6 I first
      // claimed. Sprint-swimming requires being SUBMERGED and horizontal, so
      // speed and air are a genuine trade, not a free win.
      //
      // So: travel by default, surface only on demand. `jump` is pulsed when the
      // head is actually submerged or air is running low -- not held.
      // PORPOISE, DO NOT PANIC. The old rule surfaced at 35% air against a
      // reflex firing at 25% -- ten points, on a signal sampled every 500ms,
      // while rising takes time. The reflex usually won that race: of 279
      // started crossings over six hours, `drowning` was the single largest
      // outcome at 174. See swim-breath.mjs.
      const plan = breathPlan({
        airFraction: (airScale > 0 && typeof bot.oxygenLevel === 'number')
          ? bot.oxygenLevel / airScale
          : null,
        headUp: headIsAir(),
        phase: breathPhase,
        canSurface: canSurface(),
      })
      breathPhase = plan.phase
      if (plan.abort) {
        return { status: 'failed', failClass: 'hazard_interrupt',
                 detail: `aborted: ${plan.reason} (oxygen ${bot.oxygenLevel})` }
      }
      bot.setControlState('forward', true)
      bot.setControlState('sprint', plan.sprint)
      bot.setControlState('jump', plan.jump)
      if (plan.jump) jumpTicks++
      strokes++
      await new Promise(r => setTimeout(r, TICK_MS))
    }
    // A CROSSING IS LONGER THAN ONE SKILL CALL, AND PRETENDING OTHERWISE MADE
    // EVERY REAL CROSSING A FAILURE.
    //
    // Sprint-swimming is about 5.6 m/s, so the 1,378-block crossing observed on
    // placebo-a-Delta needs roughly 246 seconds. DEADLINE_MS is 150. The skill
    // could not finish a real crossing by ARITHMETIC, exactly the way goto's
    // hardcoded 8-leg budget once capped travel at 360 blocks and reported 162
    // consecutive `home` failures at a distance it could never cover.
    //
    // goto solved this with legs, and so does this: a call that closes real
    // ground has done its job and hands back for the next decision. The bot
    // re-issues -- placebo-a-Delta did exactly that, 1378b then 1101b, unaided.
    // What changes is that the 277 blocks between those two numbers is now
    // recorded as the progress it was rather than as a deadline failure.
    //
    // MIN_LEG is deliberately large. A skill that reports success for closing
    // two blocks is a skill that always reports success.
    const here = bot.entity.position
    const dist = Math.hypot(target.x - here.x, target.z - here.z)
    const closed = startDist - dist
    if (closed >= MIN_LEG) {
      logEvent({ kind: 'swim_progress', status: 'success',
                 detail: `closed ${closed.toFixed(0)}b of ${startDist.toFixed(0)}b, ${dist.toFixed(0)}b to go`,
                 snapshot: snapshot(bot) })
      return { status: 'success',
               detail: `swam ${closed.toFixed(0)}b; ${dist.toFixed(0)}b still to go — re-issue swim_to to continue` }
    }
    return { status: 'failed', failClass: 'travel_incomplete',
             detail: `deadline: closed only ${closed.toFixed(0)}b of ${startDist.toFixed(0)}b` }
  } finally {
    bot.waterTravel = null
    try { bot.clearControlStates() } catch { /* not connected */ }
    logEvent({
      kind: 'swim_ended', status: 'success',
      detail: `${strokes} strokes over ${Math.round((Date.now() - started) / 1000)}s; ` +
              `jump duty ${strokes ? Math.round(100 * jumpTicks / strokes) : 0}%; ` +
              `airScale ${airScale}`,
      snapshot: snapshot(bot),
    })
  }
}

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
 * Would the pathfinder refuse to break this? Also a FACT: safeToBreak rejects
 * anything adjacent to a liquid (dontCreateFlow) and anything under a block
 * that can fall (dontMineUnderFallingBlock).
 *
 * Defaults to TRUE when it cannot be asked. An observation that reports
 * "unusable" because the movements object was missing would teach the model
 * the world is emptier than it is, and a false negative here is worse than a
 * false positive: it removes a real option.
 */
export function isSafeToBreak (bot, p) {
  try {
    const m = bot.collectBlock?.movements ?? bot.pathfinder?.movements
    const b = bot.blockAt(p)
    return !m?.safeToBreak || !b ? true : m.safeToBreak(b)
  } catch { return true }
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
  swim_to:  { expects: ['position'],              maxMs: 180_000 },
  craft:    { expects: ['inventory_gain'],        maxMs: 60_000 },
  build:    { expects: ['world_change'],          maxMs: 180_000 },
  place:    { expects: ['world_change'],          maxMs: 30_000 },
  // 60s covered "chest in sight"; the walk-home fallback makes deposit a
  // travel skill, and home's own budget (120s) plus the transfer must fit.
  deposit:  { expects: ['inventory_loss'],        maxMs: 240_000 },
  withdraw: { expects: ['inventory_gain'],        maxMs: 60_000 },
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
  try { bot.pathfinder?.setGoal(null) } catch { /* not connected */ }
  try { bot.pathfinder?.stop() } catch { /* not connected */ }
  try { bot.clearControlStates() } catch { /* not connected */ }

  const startY = bot.entity.position.y
  let noGain = 0
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
    const flood = overheadBreakRisk({
      head,
      sides: [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => bot.blockAt(p.offset(dx, 2, dz))),
      isLiquid,
    })
    if (flood) {
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
      const plan = planDig(predictedDigMs(head, tool))
      if (plan.refuse) {
        return { gained: p.y - startY, stopped: `cannot break ${head.name} by hand` }
      }
      if (tool) await bot.equip(tool, 'hand').catch(() => {})
      try {
        await withTimeout(bot.dig(head), plan.budgetMs, bot, {
          what: 'dig', onTimeout: () => { try { bot.stopDigging?.() } catch {} },
          // The climb wants the hole. planDig already decided this block is
          // affordable bare-handed; the harvest watchdog must not overrule it.
          needsDrop: false,
        })
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
        return { gained: p.y - startY, stopped: `dig failed on ${head.name}: ${why}` }
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
  if (s.includes('dig failed') || s.includes('cannot break')) {
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
  if (s.includes('dig failed') || s.includes('cannot break')) {
    return ' — this stone needs a pickaxe: gather wood, craft a pickaxe, then run surface again'
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
          await withTimeout(bot.pathfinder.goto(new goals.GoalY(stageY)), STAGE_MS, bot)
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

export const SKILLS = {
  goto:    { run: goto,    usage: 'goto <x> <y> <z>',              args: ['x', 'y', 'z'] },
  swim_to: { run: swimTo,  usage: 'swim_to <x> <y> <z>',           args: ['x', 'y', 'z'] },
  gather:  { run: gather,  usage: 'gather <count> <block_name>',   args: ['count', 'block'] },
  come:    { run: come,    usage: 'come',                          args: [], chatOnly: true },
  follow:  { run: follow,  usage: 'follow [seconds]',              args: [], chatOnly: true },
  home:    { run: home,    usage: 'home',                          args: [], rescue: true },
  deposit: { run: deposit, usage: 'deposit [item_name]',           args: [] },
  withdraw:{ run: withdraw,usage: 'withdraw [item_name] [count]',  args: ['item', 'count'] },
  status:  { run: status,  usage: 'status',                        args: [] },
  eat:     { run: eat,     usage: 'eat',                           args: [] },
  craft:   { run: craft,   usage: 'craft <count> <item_name>',     args: ['item', 'count'] },
  place:   { run: place,   usage: 'place <item_name>',             args: ['item'] },
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
