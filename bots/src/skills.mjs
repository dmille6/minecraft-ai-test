// Deterministic skill layer -- handoff doc S9.2.
//
// Every skill is a plain async function with the same contract:
//   run(ctx, args, signal) -> { status, detail }
// where status is 'success' | 'failed' | 'aborted'.
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
import { log, logEvent } from './logger.mjs'
import { countItem, horizontalDistanceFromSpawn, snapshot } from './state.mjs'

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
function withTimeout(promise, ms, bot) {
  let t
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      t = setTimeout(() => {
        try { bot.pathfinder.stop() } catch {}
        // TAGGED, not just worded. The old message was matched by a regex that
        // also matched "no path", so OUR wall clock expiring was reported to
        // the model and persisted to the lessons store as "no route exists" --
        // 393 times in 16 hours. The pathfinder never once said no path exists.
        rej(Object.assign(new Error(`pathfinding exceeded ${ms}ms`),
                          { failClass: 'path_budget', budgetExceeded: true }))
      }, ms)
    }),
  ]).finally(() => clearTimeout(t))
}

/** Refuse any destination outside the world border. */
function assertInsideBorder(x, z) {
  const d = horizontalDistanceFromSpawn({ x, z })
  if (d > config.world.borderRadius) {
    throw new Error(`target ${Math.round(d)} blocks out exceeds border ${config.world.borderRadius}`)
  }
}

function bestTool(bot, block) {
  let best = null, bestTime = Infinity
  for (const it of bot.inventory.items()) {
    if (!block.canHarvest(it.type)) continue
    const t = block.digTime(it.type, false, false, false)
    if (t < bestTime) { bestTime = t; best = it }
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
        const q = bot.entity.position
        return {
          status: 'failed',
          failClass: 'stranded',
          gap: `stranded_y${Math.round(q.y)}`,
          detail: `pathfinder returned an empty path from ` +
                  `${q.x.toFixed(0)},${q.y.toFixed(0)},${q.z.toFixed(0)} — no route out of here, ` +
                  `${Math.round(dist)} blocks short of ${target.x},${target.z}`,
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
          status: 'failed', failClass,
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
  logEvent({ kind: 'trapped_in_canopy', status: 'failed',
             detail: `stranded on foliage at y=${Math.round(bot.entity.position.y)}, digging out`,
             snapshot: snapshot(bot) })
  for (let i = 0; i < 12; i++) {
    check(signal)
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (!below) break
    if (!FOLIAGE.test(below.name)) return true          // reached solid ground
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
  return false
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
async function gather(ctx, { block: blockName, count = 16, maxDistance = 32 }, signal) {
  maxDistance = Math.min(Number(maxDistance) || 32, 48)   // callers cannot opt back into the blowup
  const { bot } = ctx
  const type = bot.registry.blocksByName[blockName]
  if (!type) return { status: 'failed', detail: `unknown block "${blockName}"` }

  await descendToGround(ctx, signal).catch(() => {})
  check(signal)

  const startHeld = countItem(bot, blockName)
  let collected = 0, rounds = 0, barren = 0, timedOut = 0
  const maxRounds = count * 4 + 8

  while (collected < count && rounds < maxRounds) {
    check(signal)
    rounds++

    const positions = bot
      .findBlocks({ matching: type.id, maxDistance, count: 32 })
      .filter(p => horizontalDistanceFromSpawn(p) <= config.world.borderRadius)

    if (positions.length === 0) {
      return collected > 0
        ? { status: 'success', detail: `collected ${collected} ${blockName} (none left within ${maxDistance})` }
        : { status: 'failed', detail: `no ${blockName} within ${maxDistance} blocks` }
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
    const exposed = p => {
      for (const d of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
        const n = bot.blockAt(p.offset(d[0], d[1], d[2]))
        if (!n || n.name === 'air' || n.name === 'water' || n.boundingBox === 'empty') return true
      }
      return false
    }
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
    const reachable = [
      ...exposedOnes.filter(approachable),
      ...exposedOnes.filter(q => !approachable(q)),
    ]
    if (reachable.length === 0) {
      return collected > 0
        ? { status: 'success', detail: `collected ${collected} ${blockName} (the rest are buried)` }
        : { status: 'failed', failClass: 'unreachable',
            detail: `${blockName} found but every candidate is buried — use mine to dig down` }
    }

    const target = bot.blockAt(reachable[0])
    if (!target || target.name !== blockName) continue

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
      await withTimeout(bot.collectBlock.collect(target, { ignoreNoPath: true }), COLLECT_MS, bot)
    } catch (e) {
      if (e.aborted) throw e
      // Remember WHY, so the failure below can tell the truth about itself.
      if (/exceeded|timeout/i.test(e.message ?? '')) timedOut++
      log('debug', 'gather: target failed', { at: `${target.position}`, err: e.message })
    } finally {
      // collectBlock replaces the pathfinder Movements with library defaults and
      // never restores them. Put ours back on every path out of collect(),
      // including the throwing one -- see the note in index.mjs.
      bot.assertNav?.('gather')
    }

    const gained = countItem(bot, blockName) - startHeld
    if (gained === collected) {
      barren++
      if (barren >= BARREN_LIMIT) {
        // Name the actual cause. "Unreachable" and "ran out of time getting
        // there" call for different responses -- the first means go somewhere
        // else, the second means try again -- and reporting the second as the
        // first taught the fleet to abandon wood it could have had.
        const why = timedOut >= barren
          ? `ran out of time reaching ${blockName} (${timedOut}/${barren} attempts timed out at ${COLLECT_MS / 1000}s)`
          : `${blockName} found but unreachable after ${barren} attempts`
        return collected > 0
          ? { status: 'success', detail: `collected ${collected}/${count} ${blockName}; ${why}` }
          : { status: 'failed', detail: why }
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
    : { status: 'failed', detail: `collected ${collected}/${count} ${blockName} before giving up` }
}

// ---------------------------------------------------------------- come -----
async function come(ctx, { player }, signal) {
  const { bot } = ctx
  const target = bot.players[player]?.entity
  if (!target) return { status: 'failed', detail: `cannot see ${player}` }
  const p = target.position
  return goto(ctx, { x: p.x, y: p.y, z: p.z, range: 2 }, signal)
}

// -------------------------------------------------------------- follow -----
async function follow(ctx, { player, durationMs = 60000 }, signal) {
  const { bot } = ctx
  const target = bot.players[player]?.entity
  if (!target) return { status: 'failed', detail: `cannot see ${player}` }
  bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
  try {
    await sleep(durationMs, signal)
  } finally {
    bot.pathfinder.setGoal(null)
  }
  return { status: 'success', detail: `followed ${player}` }
}

// ---------------------------------------------------------------- home -----
async function home(ctx, _args, signal) {
  const { homeX, homeY, homeZ } = config.world
  return goto(ctx, { x: homeX, y: homeY, z: homeZ, range: 2 }, signal)
}

// ------------------------------------------------------------- deposit -----
async function deposit(ctx, { item = null }, signal) {
  const { bot } = ctx
  const chestBlock = bot.findBlock({
    matching: b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry.blocks[b.type]?.name),
    maxDistance: 48,
  })
  if (!chestBlock) return { status: 'failed', detail: 'no chest or barrel within 48 blocks' }

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
  return { status: moved > 0 ? 'success' : 'failed', detail: `deposited ${moved} items` }
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
  if (!food) return { status: 'failed', detail: 'no edible food in inventory' }
  check(signal)
  try {
    await bot.equip(food, 'hand')
    await bot.consume()
    return { status: 'success', detail: `ate ${food.name}, hunger now ${bot.food}` }
  } catch (e) {
    return { status: 'failed', detail: `could not eat ${food.name}: ${e.message}` }
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
  if (!def) return { status: 'failed', detail: `unknown item "${item}"` }

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
            `${bot.inventory.items().slice(0, 3).map(i => `${i.count}x ${i.name}`).join(', ') || 'nothing'})`
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
  if (!held) return { status: 'failed', detail: `no ${item} in inventory` }

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
      return { status: 'success', detail: `placed ${item} at ${ref.position.offset(0, 1, 0)}` }
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
    return { status: 'failed', detail: `unknown plan "${plan}"; have ${Object.keys(BLUEPRINTS).join(', ')}` }
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
  return { status: 'failed', detail, placed }
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
    return { status: 'failed', detail: `withdraw failed: ${e.message.slice(0, 70)}` }
  } finally {
    try { chest.close() } catch { /* already closed */ }
  }
}

// ---------------------------------------------------------------- mine -----
//
// Distinct from gather: gather goes to blocks it can already see, mine
// descends to reach ones it cannot. Staircase rather than straight down --
// digging straight down is how bots fall into lava.
async function mine(ctx, { y: targetY = 12 }, signal) {
  const { bot } = ctx
  const goalY = Math.max(-59, Math.min(Number(targetY) || 12, 120))

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

  let steps = 0
  while (bot.entity.position.y > goalY + 1 && steps < 90) {
    check(signal)
    steps++
    const ahead = bot.entity.position.offset(0, -1, 0)
    const below = bot.blockAt(ahead)
    if (!below) break
    if (below.name === 'lava' || below.name === 'water') {
      return { status: 'failed', detail: `stopped at y=${Math.round(bot.entity.position.y)}: ${below.name} below` }
    }
    if (below.name === 'air') { await sleep(300, signal); continue }
    const tool = bestTool(bot, below)
    if (tool) await bot.equip(tool, 'hand').catch(() => {})
    if (!below.canHarvest(bot.heldItem?.type ?? null)) {
      return { status: 'failed', detail: `need a better tool for ${below.name} at y=${Math.round(bot.entity.position.y)}` }
    }
    try { await bot.dig(below) } catch (e) { if (e.aborted) throw e; break }
    // Step sideways every few blocks so it is a staircase, not a shaft.
    if (steps % 3 === 0) {
      const side = bot.blockAt(bot.entity.position.offset(1, 0, 0))
      if (side && side.name !== 'air') { try { await bot.dig(side) } catch { /* optional */ } }
    }
    await sleep(150, signal)
  }
  return { status: 'success', detail: `reached y=${Math.round(bot.entity.position.y)}` }
}

// --------------------------------------------------------------- sleep -----
async function sleepSkill(ctx, _args, signal) {
  const { bot } = ctx
  if (!isNightTime(bot)) return { status: 'failed', detail: 'can only sleep at night' }

  let bed = bot.findBlock({ matching: b => bot.registry.blocks[b.type]?.name?.endsWith('_bed'), maxDistance: 32 })
  if (!bed) {
    const inBag = bot.inventory.items().find(i => i.name.endsWith('_bed'))
    if (!inBag) return { status: 'failed', detail: 'no bed nearby and none in inventory' }
    const placed = await place(ctx, { item: inBag.name }, signal)
    if (placed.status !== 'success') return { status: 'failed', detail: `could not place bed: ${placed.detail}` }
    bed = bot.findBlock({ matching: b => bot.registry.blocks[b.type]?.name?.endsWith('_bed'), maxDistance: 8 })
    if (!bed) return { status: 'failed', detail: 'placed a bed but cannot find it' }
  }

  check(signal)
  try {
    await withTimeout(bot.pathfinder.goto(
      new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2)), 12000, bot)
    await bot.sleep(bed)
    return { status: 'success', detail: 'sleeping through the night' }
  } catch (e) {
    return { status: 'failed', detail: `sleep failed: ${e.message}` }
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
  home:     { expects: ['position'],              maxMs: 120_000 },
  come:     { expects: ['position'],              maxMs: 60_000 },
  follow:   { expects: ['position'],              maxMs: 60_000 },
  gather:   { expects: ['inventory_gain'],        maxMs: 180_000 },
  mine:     { expects: ['inventory_gain', 'position'], maxMs: 180_000 },
  craft:    { expects: ['inventory_gain'],        maxMs: 60_000 },
  build:    { expects: ['world_change'],          maxMs: 180_000 },
  place:    { expects: ['world_change'],          maxMs: 30_000 },
  deposit:  { expects: ['inventory_loss'],        maxMs: 60_000 },
  withdraw: { expects: ['inventory_gain'],        maxMs: 60_000 },
  eat:      { expects: ['survival'],              maxMs: 30_000 },
  sleep:    { expects: ['survival'],              maxMs: 60_000 },
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

  if (!because.length) return { value: 'neutral', because: [] }
  return (delta.health ?? 0) < 0
    ? { value: 'costly', because: [...because, `cost: health ${delta.health}`] }
    : { value: 'valuable', because }
}

export const SKILLS = {
  goto:    { run: goto,    usage: 'goto <x> <y> <z>',              args: ['x', 'y', 'z'] },
  gather:  { run: gather,  usage: 'gather <count> <block_name>',   args: ['count', 'block'] },
  come:    { run: come,    usage: 'come',                          args: [], chatOnly: true },
  follow:  { run: follow,  usage: 'follow [seconds]',              args: [], chatOnly: true },
  home:    { run: home,    usage: 'home',                          args: [] },
  deposit: { run: deposit, usage: 'deposit [item_name]',           args: [] },
  withdraw:{ run: withdraw,usage: 'withdraw [item_name] [count]',  args: ['item', 'count'] },
  status:  { run: status,  usage: 'status',                        args: [] },
  eat:     { run: eat,     usage: 'eat',                           args: [] },
  craft:   { run: craft,   usage: 'craft <count> <item_name>',     args: ['item', 'count'] },
  place:   { run: place,   usage: 'place <item_name>',             args: ['item'] },
  build:   { run: build,   usage: 'build <plan> [block_name]',      args: ['plan', 'block'] },
  explore: { run: explore, usage: 'explore [blocks]',              args: ['blocks'] },
  mine:    { run: mine,    usage: 'mine <target_y>',               args: ['y'] },
  sleep:   { run: sleepSkill, usage: 'sleep',                      args: [] },
}

export { Aborted }
