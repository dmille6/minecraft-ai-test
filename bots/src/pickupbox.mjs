// THE SERVER'S PICKUP BOX, as a predicate and a pathfinder goal.
//
// The SAME predicate as logpickup.mjs (branch logpickup-on-93b3892, e83c243), which is not on this branch's base;
// when both land, this file folds into that one. Vanilla Player.aiStep (1.21.x) touches every entity intersecting
// `getBoundingBox().inflate(1.0, 0.5, 1.0)`; the player box is 0.6 x 1.8 and an item's 0.25 x 0.25 at its bottom
// centre. So, item position minus feet: |dx|, |dz| < 0.3 + 1.0 + 0.125 = 1.425 and dy in (-0.75, 2.3).
//
// Why craft needs it (sandbox, 46c4836, 1 of 4 retakes): the dug table's item came to rest just outside that box and
// pickupNearbyItems' GoalNear(drop, 1) called its target reached -- the table was lost.

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
/** Margin on a PLANNER node: pathfinder calls a node reached within 0.35 of its centre. */
export const PLAN_SLACK_H = 0.35

/** Is the item (its bottom-centre position) inside the pickup box of a body at `feet`? */
export function inPickupBox (feet, item, slackH = LIVE_SLACK, slackV = LIVE_SLACK) {
  if (!feet || !item) return false
  const dx = item.x - feet.x, dy = item.y - feet.y, dz = item.z - feet.z
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return false
  return Math.abs(dx) < BOX_H - slackH && Math.abs(dz) < BOX_H - slackH &&
         dy > BOX_BELOW + slackV && dy < BOX_ABOVE - slackV
}

/** The same question about a planner node (block coords; the body settles at x+0.5, z+0.5, feet at node.y). */
export function nodeInPickupBox (node, item, slackH = PLAN_SLACK_H) {
  if (!node) return false
  return inPickupBox({ x: node.x + 0.5, y: node.y, z: node.z + 0.5 }, item, slackH, LIVE_SLACK)
}

const CACHE = new WeakMap()
/**
 * A goal whose isEnd IS the pickup test, built against the caller's `goals` (mineflayer-pathfinder). The heuristic
 * subtracts the box's reach so it stays a lower bound of GoalGetToBlock's.
 */
export function pickupGoalClass (goals) {
  if (!goals?.GoalGetToBlock) return null
  const hit = CACHE.get(goals)
  if (hit) return hit
  class GoalPickupBox extends goals.GoalGetToBlock {
    constructor (item) {
      super(Math.floor(item.x), Math.floor(item.y), Math.floor(item.z))
      this.item = { x: item.x, y: item.y, z: item.z }
    }

    isEnd (node) { return nodeInPickupBox(node, this.item) }

    heuristic (node) { return Math.max(0, super.heuristic(node) - (BOX_H + BOX_ABOVE + 1)) }
  }
  CACHE.set(goals, GoalPickupBox)
  return GoalPickupBox
}
