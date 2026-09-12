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
  // THE VERDICT GOES FIRST, BECAUSE THE TAIL OF THIS STRING IS THROWN AWAY.
  //
  // `gather` records collect failures with `.slice(0, 120)`, and the prose
  // ahead of the verdict is ~118 characters, so the one fact this function
  // exists to publish landed one character past the cut. Measured over 90
  // minutes: 861 arrived_out_of_reach segments across 70 of 80 bots, and NOT
  // ONE carried a readable `[pathfinder said: ...]` -- every one ended at
  // `[pathfinder said:` or `[pathfinder said: ]`. The positive control is the
  // same 861 strings: the distance and the coordinates, which sit before the
  // cut, were readable in all of them.
  //
  // Raising the slice would fix it until the next caller picks a smaller one.
  // Putting the short, load-bearing part first fixes it for any cut.
  const said = pathSaid ? `[pathfinder said: ${pathSaid}] ` : ''
  const d = Number.isFinite(dist) ? dist.toFixed(1) : '?'
  // ORDER MATTERS: a block that is GONE is in reach and undiggable, and calling
  // that "out of reach" sends the bot walking for a block that is not there.
  if (blockName !== wanted && wanted) {
    return { failClass: 'target_changed',
             detail: `target_changed: ${said}${at} is ${blockName ?? 'nothing (unloaded)'} now, ` +
                     `not ${wanted} — it went away while we walked` }
  }
  if (Number.isFinite(dist) && dist <= reach) {
    return { failClass: 'target_undiggable',
             detail: `target_undiggable: ${said}${at} is ${blockName ?? 'unloaded'} and within reach ` +
                     `(${d} <= ${reach}), but the server will not let it be broken by hand` }
  }
  return { failClass: 'arrived_out_of_reach',
           detail: `arrived_out_of_reach: ${said}eye is ${d} blocks from the centre of ${at}, ` +
                   `over the ${reach} the server allows` }
}

/**
 * IN REACH IS NOT BESIDE. `canDigBlock` is a distance (block centre within 5.1
 * of the eye) and says nothing about what is between. A buried ore is by
 * definition behind other blocks, and an approach that stopped 4.3 blocks
 * short "within reach" left every dig from there dead: sandbox 2026-09-12,
 * three runs -- 01:29 collect dead in 5 s, 01:35 `Digging aborted` x3 (the
 * dig of a block behind rock never completes; the enriched error in
 * collectManually records held item and timing so the exact killer is named
 * per case), 01:42 with this goal: collected twice in 40 s. Note mineflayer's
 * dig does NOT raycast by default (forceLook 'auto'); this is not about
 * 'Block not in view'.
 *
 * The end test for a BURIED target is therefore face adjacency: the target
 * shares a face with the bot's feet cell or head cell (or sits directly over
 * its head). Standing ON the target is excluded on purpose -- breaking the
 * block under your own feet is the stance-on-target trap.
 */
export function faceAdjacent (node, p) {
  if (!node || !p) return false
  const dx = node.x - Math.floor(p.x), dy = node.y - Math.floor(p.y), dz = node.z - Math.floor(p.z)
  if (dx === 0 && dz === 0 && dy === 1) return false           // standing on it
  return Math.abs(dx) + Math.abs(dy < 0 ? dy + 1 : dy) + Math.abs(dz) === 1
}

const ADJ_CACHE = new WeakMap()
export function adjacentGoalClass (goals) {
  if (!goals?.GoalGetToBlock) return null
  const hit = ADJ_CACHE.get(goals)
  if (hit) return hit
  class GoalBesideBlock extends goals.GoalGetToBlock {
    isEnd (node) { return faceAdjacent(node, this) }
  }
  ADJ_CACHE.set(goals, GoalBesideBlock)
  return GoalBesideBlock
}
export function adjacentGoal (goals, p) {
  const C = adjacentGoalClass(goals)
  if (!C) return null
  return new C(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
}

/*
 * THE NUDGE MAY NOT CROSS A HOLE (Codex, 2026-09-12, second pass on the pickup
 * nudge). A drop 2 blocks away can lie on the far lip of a pit or a lava
 * pocket; both distance limits are satisfied and the straight walk enters the
 * hazard before it reaches the stopping radius. The pathfinder's `noPath` had
 * refused exactly that walk, so a nudge that ignores the ground is strictly
 * more dangerous than the code it replaced.
 *
 * Every column the bot's 0.6-wide body sweeps on the straight line from its
 * feet to the drop must carry a floor: a solid block directly under the feet
 * level, or one step down (air over solid -- the drop can lie a block lower).
 * No lava, magma, fire, cactus or other harmful block anywhere from two below
 * the feet to the head; no ice under it (the stop is a control release, not a
 * brake). The sweep runs NUDGE_OVERSHOOT past the drop for the same reason. An
 * unknown block (unloaded chunk) is a refusal. The probe is pure so it can be tested by
 * behaviour, and it returns the offending column so the refusal names it.
 */
export const NUDGE_HALF_WIDTH = 0.3
// Blocks that hurt a bot standing on or in them. A magma block IS a solid floor
// (Codex, third pass) and would have passed the floor test by shape alone.
export const NUDGE_HAZARDS = new Set(['lava', 'magma_block', 'fire', 'soul_fire', 'campfire', 'soul_campfire',
                                      'cactus', 'sweet_berry_bush', 'wither_rose', 'powder_snow', 'pointed_dripstone'])
// Floors a walking bot slides on: the 0.4-block stop is a control release, not
// a brake, and on ice the body keeps going past the probed line.
export const NUDGE_SLIPPERY = new Set(['ice', 'packed_ice', 'blue_ice', 'frosted_ice'])
// The sweep runs this far PAST the drop: releasing the controls at 0.4 from it
// leaves the body's momentum to carry it a fraction of a block further.
export const NUDGE_OVERSHOOT = 0.6
export function nudgeGround (blockAt, from, to) {
  if (!from || !to) return { ok: false, why: 'no endpoints' }
  const fy = Math.floor(from.y)
  const flat = Math.hypot(to.x - from.x, to.z - from.z)
  if (!(flat > 0)) return { ok: true, columns: 0 }                    // standing on it already
  const ux = (to.x - from.x) / flat, uz = (to.z - from.z) / flat
  const reach = flat + NUDGE_OVERSHOOT
  const steps = Math.max(1, Math.ceil(reach / 0.25))
  const cols = new Map()
  for (let i = 0; i <= steps; i++) {
    const d = Math.min(reach, i * 0.25)
    const x = from.x + ux * d, z = from.z + uz * d
    for (const [ox, oz] of [[-NUDGE_HALF_WIDTH, -NUDGE_HALF_WIDTH], [NUDGE_HALF_WIDTH, -NUDGE_HALF_WIDTH],
                            [-NUDGE_HALF_WIDTH, NUDGE_HALF_WIDTH], [NUDGE_HALF_WIDTH, NUDGE_HALF_WIDTH]]) {
      const cx = Math.floor(x + ox), cz = Math.floor(z + oz)
      cols.set(`${cx},${cz}`, [cx, cz])
    }
  }
  // A trigger underfoot (desert-temple TNT plates, jungle-temple tripwires) is
  // refused too: the probe reads the floor as it is, and stepping on a plate is
  // what changes it (Codex, fifth pass).
  const trigger = b => /pressure_plate$|^tripwire/.test(b.name)
  const solid = b => !!b && b.boundingBox === 'block'
  const liquid = b => !!b && (b.name === 'water' || b.name === 'lava')
  for (const [cx, cz] of cols.values()) {
    for (let y = fy - 2; y <= fy + 1; y++) {
      const b = blockAt(cx, y, cz)
      if (!b) return { ok: false, why: `unknown block at ${cx},${y},${cz}` }
      if (NUDGE_HAZARDS.has(b.name) || trigger(b)) return { ok: false, why: `${b.name} at ${cx},${y},${cz}` }
    }
    const under = blockAt(cx, fy - 1, cz), lower = blockAt(cx, fy - 2, cz)
    const slip = [under, lower].find(b => NUDGE_SLIPPERY.has(b.name))
    if (slip) return { ok: false, why: `slippery ${slip.name} under ${cx},${fy - 1},${cz}` }
    if (solid(under)) continue
    if (!liquid(under) && solid(lower)) continue                       // one step down, onto something
    return { ok: false, why: `no floor under ${cx},${fy - 1},${cz}` }
  }
  return { ok: true, columns: cols.size }
}
