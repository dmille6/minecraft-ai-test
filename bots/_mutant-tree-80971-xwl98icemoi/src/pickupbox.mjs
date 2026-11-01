// THE SERVER'S PICKUP BOX, as a predicate and a pathfinder goal -- a LIBRARY ONLY.
//
// Copied verbatim from logpickup.mjs's "the box" section (branch logpickup, a40c588), which craft's table retake and
// the composter's bone-meal walk reuse. logpickup's gather behaviour (the pickup transaction, the sweep, the support
// digs) is NOT here: on this base gather is unchanged. When logpickup lands, this file folds back into it.
//
// Vanilla Player.aiStep (1.21.x) touches every entity intersecting `getBoundingBox().inflate(1.0, 0.5, 1.0)`; the
// player box is 0.6 x 1.8 and an item's 0.25 x 0.25 at its bottom centre. So, item position minus feet:
// |dx|, |dz| < 0.3 + 1.0 + 0.125 = 1.425 and dy in (-0.75, 2.3).

// ---------------------------------------------------------------- the box -----

/** Vanilla's pickup inflation of the player box (Player.aiStep: inflate(1.0, 0.5, 1.0)). */
export const PICKUP_INFLATE = Object.freeze({ h: 1.0, v: 0.5 })
export const PLAYER_HALF_WIDTH = 0.3
export const PLAYER_HEIGHT = 1.8
export const ITEM_HALF_WIDTH = 0.125
export const ITEM_HEIGHT = 0.25
/** Horizontal reach of the box, feet centre to item centre: 1.425. */
export const BOX_H = PLAYER_HALF_WIDTH + PICKUP_INFLATE.h + ITEM_HALF_WIDTH
/** The item's bottom may sit this far below the feet: -0.75. */
export const BOX_BELOW = -(PICKUP_INFLATE.v + ITEM_HEIGHT)
/** ...and must sit below this far above them: 2.3. */
export const BOX_ABOVE = PLAYER_HEIGHT + PICKUP_INFLATE.v
/** Margin on the live body: positions arrive by packet and a drop on an edge flaps. */
export const LIVE_SLACK = 0.05
/**
 * Margin on a PLANNER node: pathfinder calls a node reached within 0.35 of its
 * centre (mineflayer-pathfinder index.js, `Math.abs(dx) <= 0.35`), so a node is
 * only good if the box still contains the drop from anywhere in that square.
 */
export const PLAN_SLACK_H = 0.35

/** Is the item (its bottom-centre position) inside the pickup box of a body at `feet`? */
export function inPickupBox (feet, item, slackH = LIVE_SLACK, slackV = LIVE_SLACK) {
  if (!feet || !item) return false
  const dx = item.x - feet.x, dy = item.y - feet.y, dz = item.z - feet.z
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return false
  return Math.abs(dx) < BOX_H - slackH && Math.abs(dz) < BOX_H - slackH &&
         dy > BOX_BELOW + slackV && dy < BOX_ABOVE - slackV
}

/**
 * How high above its cell floor a block's top is: the max y of its collision
 * shapes (a bottom slab 0.5, a full block 1, a fence 1.5). A planner node stands
 * IN the cell above the block it stands on, so a node over a bottom slab has its
 * feet half a block below `node.y` (mineflayer-pathfinder Movements: height =
 * y + max shape y). Unknown shape reads as a full block, the old assumption.
 */
export function standHeight (blockBelow) {
  const shapes = blockBelow?.shapes
  if (!Array.isArray(shapes) || !shapes.length) return 1
  let top = 0
  for (const s of shapes) if (Array.isArray(s) && Number.isFinite(s[4])) top = Math.max(top, s[4])
  return top > 0 ? Math.min(top, 1.5) : 1
}

/**
 * The same question about a planner node (block coords; the body settles at
 * x+0.5, z+0.5). `standY(node)` gives the real feet height on that node; without
 * it the node is assumed to stand on a full block.
 */
export function nodeInPickupBox (node, item, slackH = PLAN_SLACK_H, standY = null) {
  if (!node) return false
  let y = node.y
  if (typeof standY === 'function') { try { const v = standY(node); if (Number.isFinite(v)) y = v } catch { /* full block */ } }
  return inPickupBox({ x: node.x + 0.5, y, z: node.z + 0.5 }, item, slackH, LIVE_SLACK)
}

const CACHE = new WeakMap()

/**
 * A goal whose isEnd IS the pickup test -- modelled on digreach.reachGoalClass.
 * Built against the caller's `goals` so tests hand it the real classes. The
 * heuristic subtracts the box's reach (horizontal + vertical) so it stays a lower
 * bound: GoalGetToBlock estimates the cost of standing ADJACENT, and this goal is
 * satisfied up to ~3.7 blocks earlier.
 */
export function pickupGoalClass (goals) {
  if (!goals?.GoalGetToBlock) return null
  const hit = CACHE.get(goals)
  if (hit) return hit
  class GoalPickupBox extends goals.GoalGetToBlock {
    constructor (item, standY = null) {
      super(item.x, item.y, item.z)
      this.item = { x: item.x, y: item.y, z: item.z }
      this.standY = standY
    }

    isEnd (node) { return nodeInPickupBox(node, this.item, PLAN_SLACK_H, this.standY) }

    heuristic (node) { return Math.max(0, super.heuristic(node) - (BOX_H + BOX_ABOVE + 1)) }
  }
  CACHE.set(goals, GoalPickupBox)
  return GoalPickupBox
}

/** The goal instance, or null if the library shape is wrong. */
export function pickupGoal (goals, item, standY = null) {
  const C = pickupGoalClass(goals)
  return C && item ? new C(item, standY) : null
}
