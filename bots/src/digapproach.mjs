/**
 * THE LAST WALL IS THE WHOLE PROBLEM.
 *
 * `arrived_out_of_reach` survived the goal fix (GoalNear(p,2) -> reachGoal) and
 * stayed at 18.7% of gather runs, 480 of 2,561 in 90 minutes across 70 of 80
 * bots. The goal was never the remaining cause. The MOVEMENTS were.
 *
 * MEASURED, on the real Movements and the real AStar, over 48 scenes read off
 * the live fleet by RCON -- the actual bot position and the actual refused block
 * from 48 real refusals, with the surrounding world scanned cell by cell
 * (285,000 read-only probes, four controls per pool, zero unloaded cells):
 *
 *   walk (canDig=false) + reachGoal      arrives 10/48   ( 20.8%)
 *   dig  (canDig=true)  + reachGoal      arrives 47/48   ( 97.9%)
 *
 * In 35 of the 48 a legal stance EXISTED -- a cell with clear feet, clear head
 * and solid footing whose eye is inside the server's 5.1 -- and was not
 * walk-connected to the bot. The bot was not lost and the block was not gone
 * (`target_changed` and `target_undiggable` were both 0 in the same window,
 * against 480 arrived_out_of_reach: the same query, so the zero is a reading).
 * There was a wall in the way, and the walk profile may not break walls.
 *
 * That profile is right for travel and this file does not change it. What it
 * changes is that `gather` -- the one skill whose entire job is to break a
 * specific block -- lost its dig-capable approach when it stopped calling
 * mineflayer-collectblock. collectblock installed `canDig=true` movements
 * before every walk (CollectBlock.js does `setMovements(this.movements)`), and
 * index.mjs still builds exactly that clone for it. Nothing has used it since
 * COLLECTBLOCK_ENABLED defaulted off, so the capability was deleted by
 * accident rather than by decision.
 *
 * WHY THIS IS NOT THE 3.3 GB OOM COMING BACK.
 *
 * `gather stone` once took a bot from 130 MB to 3.3 GB in 200 s and killed it
 * four times, with dig-enabled movements. Two things were true then that are
 * not true here:
 *
 *   1. The goal was GoalNear(p, 2), whose acceptance set for a block in a wall
 *      is EMPTY. An unsatisfiable goal makes A* drain the world, and with
 *      digging on the world is every cell rather than every walkable cell.
 *      reachGoal accepts any node within 4.5 of the block, so the search stops
 *      as soon as it breaks through -- measured p50 104 visited nodes.
 *   2. Nothing bounded it. searchRadius was -1 and it ran inside collectblock's
 *      own unbounded loop.
 *
 * Both bounds are restored here, and the cap is on COST, which is the only
 * quantity that bounds search size and excavation at the same time.
 *
 *   searchRadius IS A COST CAP, NOT A DISTANCE. astar.js:
 *       this.maxCost = searchRadius < 0 ? -1 : startNode.h + searchRadius
 *   The first version of the experiment above passed searchRadius=16 meaning
 *   "16 blocks", a barehanded stone dig costs about 24, and so every dig was
 *   priced out of budget: canDig=true measured IDENTICAL to canDig=false, and
 *   it read exactly like "digging does not help". It is slack ABOVE the start
 *   node's heuristic, so a long walk is not charged for being long.
 */

/**
 * How much cost slack above the straight-line estimate an approach may spend.
 *
 * MEASURED over the same 48 real scenes, dig-enabled, reachGoal, 4 s think:
 *
 *   slack   arrives        blocks broken (arrivals)   visited        ms
 *     150   29/48 ( 60%)   p50=1  p90=4   max=6       p90=796        p90=32
 *     200   31/48 ( 65%)   p50=1  p90=5   max=8       p90=1223       p90=61
 *     300   35/48 ( 73%)   p50=2  p90=8   max=12      p90=2595       p90=131
 *     400   40/48 ( 83%)   p50=2  p90=13  max=16      p90=3480       p90=177
 *     500   43/48 ( 90%)   p50=3  p90=13  max=20      p90=3804       p90=211
 *      -1   47/48 ( 98%)   p50=3  p90=19  max=46      p90=7049       p90=372
 *
 * 400 is where the curve stops being cheap. It is also the point past which the
 * excavation stops looking like breaking through a wall (median TWO blocks) and
 * starts looking like a tunnel, which is the behaviour canDig=false exists to
 * prevent.
 */
export const APPROACH_SLACK = 400

/**
 * ...AND A COST CAP IS NOT A BLOCK CAP, because cost is dig TIME.
 *
 * A barehanded stone dig prices at about 24 and a diamond-pickaxe one at about
 * 2.2, so the same 400 of slack buys ~16 blocks empty-handed and ~180 with a
 * good pickaxe. The bound that matters to the world is the block count, and the
 * fleet's tools change under it, so the block count is bounded directly and the
 * decision is made on the PATH before a step is taken.
 *
 * 16 is the measured max at slack 400 on real scenes, so this is a backstop
 * against a better-equipped bot, not a second tuning knob.
 */
export const MAX_APPROACH_DIG = 16

/** Wall clock for the approach search. thinkTimeout is 5000; this is a retry. */
export const APPROACH_TIMEOUT_MS = 2000

/** Bounded resumes of a `partial` search. Same reasoning as reachprobe.mjs. */
export const APPROACH_PUMPS = 4

/**
 * How many distinct blocks would walking this path break?
 *
 * Pure, and it takes the PATH rather than a bot, so the bound can be tested
 * without a world. Distinct positions, because pathfinder lists the same block
 * on every move that needs it gone and counting those twice would refuse a
 * legal approach.
 */
export function approachDigCount (path) {
  if (!Array.isArray(path)) return 0
  const seen = new Set()
  for (const mv of path) {
    for (const b of (mv?.toBreak ?? [])) {
      if (!b) continue
      seen.add(`${Math.floor(b.x)},${Math.floor(b.y)},${Math.floor(b.z)}`)
    }
  }
  return seen.size
}

/**
 * MAY WE WALK THIS PATH?
 *
 * Split out and pure for the reason CLAUDE.md gives: a refusal asserted by
 * matching source text has passed for the wrong reason five times in this repo
 * in one day. This one is a function, so the tests can hand it the cases.
 *
 * `endsInReach` is supplied by the caller rather than recomputed here, because
 * the geometry has exactly one definition (digreach.mjs) and a second copy of
 * it is how the walk and the admission test came apart in the first place.
 */
export function approachVerdict ({ status, path, endsInReach, maxDig = MAX_APPROACH_DIG } = {}) {
  if (status !== 'success') {
    return { take: false, why: `approach search said ${status ?? 'nothing'}` }
  }
  if (!endsInReach) {
    // A* succeeded against the goal we handed it and the end node is still out
    // of reach: that is a goal/geometry disagreement, and walking it would cost
    // the dig for nothing. It has never been observed; it is refused anyway,
    // because "the search succeeded" and "it succeeded at the thing I meant"
    // are two claims.
    return { take: false, why: 'approach path does not end within reach' }
  }
  const dig = approachDigCount(path)
  if (dig > maxDig) {
    return { take: false, why: `approach would break ${dig} blocks, over the ${maxDig} allowed` }
  }
  return { take: true, why: null, dig }
}

/**
 * Plan a dig-capable approach and hand back the verdict. DOES NOT WALK IT.
 *
 * Read-only by construction: `getPathFromTo` is a search, and the movements are
 * borrowed rather than installed (index.mjs owns setMovements and that rule is
 * what keeps the collectblock clobber a single known problem). The caller
 * installs them only if this says yes.
 *
 * Returns null when the shape of the library is not what we expect, so a
 * missing piece is a no-op rather than a throw -- the same contract
 * probeReachable keeps, for the same reason.
 */
export function planDigApproach (bot, target, { goals, reachGoalFor, endsInReach,
                                                slack = APPROACH_SLACK,
                                                timeout = APPROACH_TIMEOUT_MS } = {}) {
  const at = bot?.entity?.position
  if (!at || !target) return null
  // The guard must name the thing actually used. reachprobe.mjs shipped a guard
  // for GoalGetToBlock after switching to GoalLookAtBlock, which would have made
  // the probe silently inert on the fleet.
  if (typeof bot?.pathfinder?.getPathFromTo !== 'function') return null
  const moves = bot.gatherMovements
  if (!moves || moves.canDig !== true) return null      // no dig profile, no approach
  const goal = reachGoalFor?.(goals, target)
  if (!goal) return null

  const t0 = Date.now()
  let result
  try {
    const gen = bot.pathfinder.getPathFromTo(moves, at, goal,
      { timeout, searchRadius: slack, optimizePath: true })
    result = gen.next()?.value?.result
    for (let i = 0; i < APPROACH_PUMPS && result?.status === 'partial'
                    && Date.now() - t0 < timeout; i++) {
      result = gen.next()?.value?.result ?? result
    }
  } catch {
    return null            // a search that throws must cost nothing
  }
  if (!result) return null
  const path = Array.isArray(result.path) ? result.path : []
  // An empty path on success means ALREADY THERE, which reachprobe.mjs learned
  // the hard way was the commonest outcome and was being discarded as "nowhere".
  // `end` is a planner NODE either way -- block coordinates, not a body -- which
  // is why `endsInReach` must be the node-flavoured test and not the body one.
  const end = path.length
    ? path[path.length - 1]
    : { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) }
  const verdict = approachVerdict({
    status: result.status,
    path,
    endsInReach: endsInReach ? !!endsInReach(end) : false,
  })
  return {
    ...verdict,
    goal,
    status: result.status,
    path,
    visitedNodes: typeof result.visitedNodes === 'number' ? result.visitedNodes : null,
    ms: Date.now() - t0,
  }
}
