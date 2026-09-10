/**
 * ONE DEFINITION OF "CLOSE ENOUGH TO MINE THIS", SHARED BY THE PROBE AND THE WALK.
 *
 * gather had three different answers to that question and none of them was the
 * server's:
 *
 *   the RANKING asked `probeReachable`, which A*s to a GoalLookAtBlock
 *     (within 4.5 of pos+1.6, plus a raycast onto a visible face)
 *   the WALK asked `bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2))`
 *     (any node within 2 blocks of the block, standable or not)
 *   the ADMISSION asked `bot.canDigBlock` -- diggable, and the block CENTRE
 *     within 5.1 of the EYE (digging.js:220)
 *
 * Only the third one decides anything, because it is mineflayer's own gate and
 * the closest thing we have to the server's. The other two are paraphrases, and
 * the walk's paraphrase is the strictest of the three by a wide margin.
 *
 * MEASURED, on the real Movements class over synthetic worlds (see
 * test/gather-reach.test.mjs), thinkTimeout 5000, canDig=false:
 *
 *   scene                  GoalNear(p,2)                 this goal
 *   block in a wall        timeout, 267,365 nodes, 5.0s  success, 2 nodes, 0ms
 *   block in a ceiling     timeout, 252,035 nodes, 5.0s  success, 2 nodes, 0ms
 *   oak log 5 up in canopy timeout, 234,027 nodes, 5.0s  success, 4 nodes, 0ms
 *
 * In all three the block was diggable from 35, 69 and 36 nodes the bot could
 * actually walk to. GoalNear(p,2) accepted NONE of them, so A* had to drain the
 * whole walkable world to prove it -- which is why an unreachable-looking gather
 * costs five seconds of planning per attempt and then reports a claim about
 * terrain.
 *
 * A goal with an empty acceptance set is the most expensive query you can hand
 * A*, and gather was building one every time the target was in a wall, in a
 * ceiling, or up a tree. Those are not edge cases: oak_log is 43.4% of the
 * failures this replaces.
 */
import { Vec3 } from 'vec3'

/** mineflayer's own gate (digging.js:224). Not ours to choose. */
export const SERVER_REACH = 5.1

/**
 * What we PLAN for. The margin is not timidity, it is the difference between a
 * node and a body: A* accepts block coordinates, the bot then settles somewhere
 * inside that block, and `canDigBlock` measures the body. 0.6 covers the ~0.5
 * of horizontal slack plus a tick of fall.
 */
export const STANCE_REACH = 4.5

/** Eye height, from digging.js's own offset. */
const EYE = 1.65

/**
 * The exact quantity `canDigBlock` tests: block centre to eye.
 *
 * Pure, and it takes a POSITION rather than a bot, so the same arithmetic can be
 * asked of a planner node (where the bot would stand) and of the live body
 * (where it does stand). Those were different functions before and that is
 * precisely how the walk and the admission test came apart.
 */
export function eyeToBlock (from, p) {
  if (!from || !p) return NaN
  return new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
    .offset(0.5, 0.5, 0.5)
    .distanceTo(new Vec3(from.x, from.y, from.z).offset(0, EYE, 0))
}

/** Would the server let a body at `from` dig the block at `p`? Geometry only. */
export function withinDigReach (from, p, reach = SERVER_REACH) {
  const d = eyeToBlock(from, p)
  return Number.isFinite(d) && d <= reach
}

/**
 * The same question about a planner NODE, whose x/y/z are block coordinates.
 *
 * pathfinder centres the bot on the node (`moveToBlock` in index.js recentres
 * when the hitbox overhangs), so standing on node (x,y,z) means a body at
 * (x+0.5, y, z+0.5).
 */
export function nodeToBlock (node, p) {
  if (!node) return NaN
  return eyeToBlock({ x: node.x + 0.5, y: node.y, z: node.z + 0.5 }, p)
}

const CACHE = new WeakMap()

/**
 * A goal whose isEnd IS the reach test, rather than a proxy for it.
 *
 * Built against the caller's `goals` object rather than importing the library
 * here, for the same reason `probeReachable` takes one: the guard that checks
 * the goal exists must be checking the goal that is actually used, and tests
 * must be able to hand it the real classes.
 *
 * The heuristic subtracts the reach. GoalGetToBlock's heuristic estimates the
 * cost of standing ADJACENT to the block; this goal is satisfied up to `reach`
 * blocks earlier, so the unmodified heuristic would overestimate the remaining
 * cost by up to `reach` moves -- inadmissible, which lets A* return a worse
 * route than one it has already seen. Subtracting the slack restores
 * admissibility and costs nothing.
 */
export function reachGoalClass (goals) {
  if (!goals?.GoalGetToBlock) return null
  const hit = CACHE.get(goals)
  if (hit) return hit
  class GoalWithinDigReach extends goals.GoalGetToBlock {
    constructor (x, y, z, reach = STANCE_REACH) {
      super(x, y, z)
      this.reach = reach
    }

    isEnd (node) { return nodeToBlock(node, this) <= this.reach }

    heuristic (node) { return Math.max(0, super.heuristic(node) - this.reach) }
  }
  CACHE.set(goals, GoalWithinDigReach)
  return GoalWithinDigReach
}

/** Convenience: the goal instance, or null if the library shape is wrong. */
export function reachGoal (goals, p, reach = STANCE_REACH) {
  const C = reachGoalClass(goals)
  if (!C) return null
  return new C(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), reach)
}

/**
 * TWO FAILURES WORE ONE NAME.
 *
 * `canDigBlock` is `block && block.diggable && <within 5.1>`. The old refusal
 * threw `arrived_out_of_reach` for all three, and its message asserted
 * "goto returned without moving" as fact -- which is a claim about the
 * pathfinder that the code never asked the pathfinder about. Reading 673 of
 * these off the fleet took five separate telemetry passes precisely because the
 * one string that could have answered it was a guess.
 *
 * So: say which of the three it was, and quote what the pathfinder actually
 * said. `pathSaid` is the goto rejection's NAME (NoPath, Timeout, PathStopped,
 * GoalChanged -- goto.js's own vocabulary), or 'resolved' when goto returned
 * cleanly, which after an empty path is what "unreachable" looks like from
 * outside.
 *
 * Pure, so the classification is a behaviour test rather than a grep.
 */
export function reachRefusal ({ blockName, wanted, target, dist, pathSaid, reach = SERVER_REACH } = {}) {
  const at = target ? `${Math.floor(target.x)},${Math.floor(target.y)},${Math.floor(target.z)}` : '?'
  const said = pathSaid ? ` [pathfinder said: ${pathSaid}]` : ''
  const d = Number.isFinite(dist) ? dist.toFixed(1) : '?'
  // ORDER MATTERS: a block that is GONE is in reach and undiggable, and calling
  // that "out of reach" sends the bot walking for a block that is not there.
  if (blockName !== wanted && wanted) {
    return { failClass: 'target_changed',
             detail: `target_changed: ${at} is ${blockName ?? 'nothing (unloaded)'} now, not ${wanted} — ` +
                     `it went away while we walked${said}` }
  }
  if (Number.isFinite(dist) && dist <= reach) {
    return { failClass: 'target_undiggable',
             detail: `target_undiggable: ${at} is ${blockName ?? 'unloaded'} and within reach ` +
                     `(${d} <= ${reach}), but the server will not let it be broken by hand${said}` }
  }
  return { failClass: 'arrived_out_of_reach',
           detail: `arrived_out_of_reach: eye is ${d} blocks from the centre of ${at}, ` +
                   `over the ${reach} the server allows${said}` }
}
