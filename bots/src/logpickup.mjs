/**
 * THE LOG IS NOT GATHERED WHEN IT BREAKS. IT IS GATHERED WHEN IT IS IN THE BAG.
 *
 * Both engines, independently, 10-03, 80 bots, 3 h: the top log-gather failure was
 * not reach. 291 of 949 failed log gathers (31%, 48 bots) broke the log and then
 * failed to PICK UP the drop -- "collect threw nothing" -- and after three barren
 * rounds `barrenFailClass` called that `no_path`, which is in
 * EVIDENCE_ABOUT_THE_ACTION, so an unpicked drop became a lasting avoid rule
 * against `gather oak_log`. Fleet-wide 1,866 distinct log drops were left behind
 * against 2,584 logs gained in the same 3 h.
 *
 * The mechanism is the goal the pickup walk asked for. `pickupNearbyItems` walks
 * to GoalNear(drop, 1): some NODE within one block of the drop. A drop resting
 * on leaves or on a trunk stub 2.3+ blocks above the feet (27% of the left-behind
 * drops) has no walkable node within 1, so the goal's acceptance set is empty and
 * A* drains ~14k nodes to prove it (_path_timeout after 5 s) -- exactly what
 * digreach.mjs measured and fixed for DIGGING. The drop is then retired whether
 * or not it was collected.
 *
 * WHAT THE SERVER ACTUALLY TESTS. Vanilla Player.aiStep (1.21.x) touches every
 * entity intersecting `getBoundingBox().inflate(1.0, 0.5, 1.0)` (not riding), and
 * ItemEntity.playerTouch takes the stack once its pickup delay is 0 (10 ticks for
 * a block drop) and the inventory has room. The player box is 0.6 x 1.8 and an
 * item entity's is 0.25 x 0.25, positioned at its bottom centre. So, in item
 * position minus feet position:
 *
 *     |dx|, |dz| < 0.3 + 1.0 + 0.125 = 1.425
 *     dy in (-(0.5 + 0.25), 1.8 + 0.5) = (-0.75, 2.3)
 *
 * The 2.3 is the "2.3+ blocks above the feet" in the root cause: from the bot's
 * own floor, nothing resting higher can be taken, however long it waits.
 *
 * THE TRANSACTION. Identify the drop(s) from THIS dig; then per drop, bounded:
 *   wait           the drop is already inside the pickup box: wait out the delay
 *   break_support  it rests above the box on leaves or on the gathered log, and
 *                  that block is in dig reach and safe to break: break it so the
 *                  drop falls, re-observe (it moves) and go again -- at most twice
 *   walk           to a node whose body box contains the drop (pickupGoal), with
 *                  A* think time capped -- never GoalNear(drop, 1)
 * and it finishes ONLY on an inventory gain of that log. A drop that vanished,
 * despawned or was taken by someone else is not a collection.
 *
 * Pure parts are exported and tested by behaviour; the transaction takes its I/O
 * (walk, dig, sleep, log) from the caller so this file imports no skill code.
 */
import { Vec3 } from 'vec3'
import { LAVA_LIKE } from './lavaguard.mjs'

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

/** The same question about a planner node (block coords; the body settles at x+0.5, z+0.5). */
export function nodeInPickupBox (node, item, slackH = PLAN_SLACK_H) {
  if (!node) return false
  return inPickupBox({ x: node.x + 0.5, y: node.y, z: node.z + 0.5 }, item, slackH, LIVE_SLACK)
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
    constructor (item) {
      super(item.x, item.y, item.z)
      this.item = { x: item.x, y: item.y, z: item.z }
    }

    isEnd (node) { return nodeInPickupBox(node, this.item) }

    heuristic (node) { return Math.max(0, super.heuristic(node) - (BOX_H + BOX_ABOVE)) }
  }
  CACHE.set(goals, GoalPickupBox)
  return GoalPickupBox
}

/** The goal instance, or null if the library shape is wrong. */
export function pickupGoal (goals, item) {
  const C = pickupGoalClass(goals)
  return C && item ? new C(item) : null
}

// ---------------------------------------------------------------- strategy -----

/** A drop resting at least this far above the feet is outside the box from the bot's own floor. */
export const ELEVATED_DY = BOX_ABOVE - LIVE_SLACK

/** Blocks a drop may rest on that the bot may break to drop it: foliage, or the log being gathered. */
export function isLooseSupport (name, logName) {
  if (typeof name !== 'string') return false
  return /_leaves$/.test(name) || (!!logName && name === logName)
}

/** The block a resting item sits on: the cell just under its bottom. */
export function supportCellOf (item) {
  if (!item) return null
  return { x: Math.floor(item.x), y: Math.floor(item.y - 0.05), z: Math.floor(item.z) }
}

/**
 * wait | break_support | walk, from where the drop is relative to the feet.
 *   supportOk  the caller's answer: the support is in dig reach and safe to break
 *   breaksLeft how many more supports this drop may cost
 */
export function choosePickupStrategy ({ feet, drop, supportName = null, logName = null, supportOk = false, breaksLeft = 0 } = {}) {
  if (inPickupBox(feet, drop)) return 'wait'
  const dy = (drop?.y ?? NaN) - (feet?.y ?? NaN)
  if (dy >= ELEVATED_DY && breaksLeft > 0 && supportOk && isLooseSupport(supportName, logName)) return 'break_support'
  return 'walk'
}

/**
 * Lava is the one face nobody relaxes: nothing lava-like on the six faces of the
 * support, nor in the two cells under those (the drop falls there). `at(x,y,z)`
 * returns a block or null; an unknown cell is not safe.
 */
export function supportLavaFree (at, p) {
  if (!p || typeof at !== 'function') return false
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, -2, 0], [0, -3, 0]]) {
    const b = at(p.x + dx, p.y + dy, p.z + dz)
    if (b == null || LAVA_LIKE.has(b.name)) return false
  }
  return true
}

/** Room for one more of `name`: an empty slot, or a stack of it below its size. Unknown slot count is not full. */
export function hasRoomFor (items, emptySlots, name, stackSize = 64) {
  if (!Number.isFinite(emptySlots) || emptySlots > 0) return true
  return (Array.isArray(items) ? items : []).some(it => it?.name === name && (it.count ?? 0) < (it.stackSize ?? stackSize))
}

// ---------------------------------------------------------------- verdicts -----

/**
 * What one pickup transaction was, for gather's run accounting. ONLY an inventory
 * gain is a collection; everything else names why not:
 *   inventory_full     there was no slot for it
 *   break_unconfirmed  no drop appeared: nothing from the server says the block broke
 *   pickup_failed      the block broke (its drop was seen) and the drop never reached the bag
 */
export function transactionVerdict ({ gained = 0, sawDrop = false, bagFull = false } = {}) {
  if (gained > 0) return 'collected'
  if (bagFull) return 'inventory_full'
  if (!sawDrop) return 'break_unconfirmed'
  return 'pickup_failed'
}

// ---------------------------------------------------------------- the drops -----

/** How close to the broken cell's centre (horizontally) a new item counts as its drop, and how far it may fall. */
export const DROP_NEAR_H = 1.6
export const DROP_FALL = 12

/** Item entity ids present now. Snapshot this BEFORE the dig, so a drop is known to be new. */
export function itemIdsNow (bot) {
  const out = new Set()
  try { for (const e of Object.values(bot?.entities ?? {})) if (e?.name === 'item' && e.id != null) out.add(e.id) } catch { /* empty */ }
  return out
}

/** Is this entity a drop of THIS dig: new since the snapshot, near the cell, of the family (or metadata not in yet)? */
export function isDropFrom (e, cell, family, preIds = new Set()) {
  if (!e || e.name !== 'item' || e.id == null || preIds.has(e.id) || !cell) return false
  const p = e.position
  if (!p) return false
  if (Math.abs(p.x - (cell.x + 0.5)) > DROP_NEAR_H || Math.abs(p.z - (cell.z + 0.5)) > DROP_NEAR_H) return false
  if (p.y > cell.y + 1.5 || p.y < cell.y - DROP_FALL) return false
  let name = null
  try { name = e.getDroppedItem?.()?.name ?? null } catch { name = null }
  return name == null || family.has(name)
}

// ---------------------------------------------------------------- bounds -----

export const PICKUP_WAIT_MS = 600       // pickup delay is 10 ticks (500 ms) from the spawn; we look >= 250 ms after
export const DROP_SEEN_MS = 1000        // how long to wait for the drop entity to appear
export const DROP_MS = 6000             // per drop
export const RUN_MS = 9000              // per transaction (one dig)
export const MAX_STEPS = 4              // wait/walk/break steps per drop
export const MAX_BREAKS = 2             // break a support, re-observe, repeat once
export const MAX_DROPS = 3
export const WALK_MS = 4000
export const PICKUP_THINK_MS = 1500     // A* think time for a pickup walk (thinkTimeout is 5000)

const r1 = v => Math.round(v * 10) / 10

/**
 * One bounded pickup transaction after a log dig.
 *
 *   opts.cell       the broken block's position
 *   opts.logName    what was broken (and what a log support must be to be broken)
 *   opts.family     item names the dig yields (drops.dropsOf)
 *   opts.preIds     item entity ids before the dig (itemIdsNow)
 *   opts.heldBefore count of the family before the dig; opts.held() reads it now
 *   io.goals           the pathfinder goals module (pickupGoal builds on it)
 *   io.walk(goal, ms)  bounded walk with capped think time; throws on failure
 *   io.dig(block)      bounded break of a support
 *   io.supportOk(b)    in dig reach and safe to break (lava/liquid/falling rules)
 *   io.sleep(ms, sig)  rejects on abort
 *   io.log(row)        writes a `_pickup_reach` row
 *   io.sought(id)      telemetry marker; returns release()
 *
 * Returns { verdict, gained, drops, rows }. Aborts propagate.
 */
export async function pickupTransaction (bot, opts, io) {
  const { cell, logName, preIds = new Set(), heldBefore = 0, held, signal = null } = opts
  const family = new Set(opts.family?.length ? opts.family : [logName])
  const itemName = [...family][0] ?? logName
  const now = io.now ?? (() => Date.now())
  const t0 = now()
  const gained = () => Math.max(0, (Number(held?.()) || 0) - heldBefore)
  const rows = []
  const seen = new Set()
  const queue = []
  const scan = near => {
    try {
      for (const e of Object.values(bot?.entities ?? {})) {
        if (seen.has(e?.id) || !isDropFrom(e, near, family, preIds)) continue
        seen.add(e.id)
        if (seen.size <= MAX_DROPS) queue.push(e.id)
      }
    } catch { /* an unreadable entity table is "no drop seen" */ }
  }
  const emit = row => { rows.push(row); try { io.log?.(row) } catch { /* telemetry */ } }

  // 1. WHICH DROP CAME FROM THIS DIG. Its appearance is also the only server-side
  //    evidence the break happened: the 250 ms re-read before this reads our own
  //    cache, which mineflayer wrote air into when its local dig timer fired.
  scan(cell)
  while (!queue.length && gained() === 0 && now() - t0 < DROP_SEEN_MS) {
    await io.sleep(100, signal)
    scan(cell)
  }
  if (!queue.length) {
    const g = gained()
    emit(pickupRow({ logName, outcome: g > 0 ? 'collected' : 'left', strategies: g > 0 ? ['wait'] : [],
                     reason: g > 0 ? null : 'no_drop_seen', delta: g, ms: now() - t0 }))
    return { verdict: transactionVerdict({ gained: g, sawDrop: false }), gained: g, drops: 0, rows }
  }

  let bagFull = false
  while (queue.length && now() - t0 < RUN_MS) {
    const id = queue.shift()
    const d0 = now()
    const g0 = gained()
    const strategies = []
    let breaks = 0, off = null, support = null, reason = null, walkSaid = null
    for (let step = 0; step < MAX_STEPS; step++) {
      if (gained() > g0) break
      const ent = bot.entities?.[id]
      // RETIRE IS NOT COMPLETION. The entity is gone; only the bag says whether we took it.
      if (!ent) { await io.sleep(150, signal); reason = 'vanished'; break }
      if (!hasRoomFor(bot.inventory?.items?.() ?? [], bot.inventory?.emptySlotCount?.(), itemName)) {
        bagFull = true; reason = 'inventory_full'; break
      }
      if (now() - d0 > DROP_MS || now() - t0 > RUN_MS) { reason = 'timeout'; break }
      const feet = bot.entity?.position
      const pos = ent.position
      if (!feet || !pos) { reason = 'no_position'; break }
      if (!off) off = { x: r1(pos.x - feet.x), y: r1(pos.y - feet.y), z: r1(pos.z - feet.z) }
      const sc = supportCellOf(pos)
      let sup = null
      try { sup = bot.blockAt?.(new Vec3(sc.x, sc.y, sc.z)) ?? null } catch { sup = null }
      support ??= sup?.name ?? null
      // Never the block the bot is standing on.
      const underFeet = Math.floor(feet.x) === sc.x && Math.floor(feet.y) - 1 === sc.y && Math.floor(feet.z) === sc.z
      let ok = false
      try { ok = !underFeet && !!sup && !!io.supportOk?.(sup) } catch { ok = false }
      const s = choosePickupStrategy({ feet, drop: pos, supportName: sup?.name ?? null, logName, supportOk: ok,
                                       breaksLeft: MAX_BREAKS - breaks })
      strategies.push(s)
      if (s === 'wait') { await io.sleep(PICKUP_WAIT_MS, signal); continue }
      if (s === 'break_support') {
        breaks++
        try { await io.dig(sup) } catch (e) { if (e?.aborted || signal?.aborted) throw e }
        await io.sleep(PICKUP_WAIT_MS, signal)   // the drop falls; it is re-observed on the next step
        scan(sc)                                  // a broken log support drops a log of its own
        continue
      }
      // walk
      const from = { x: pos.x, y: pos.y, z: pos.z }
      const goal = pickupGoal(io.goals, pos)
      if (!goal) { reason = 'no_goal'; break }
      const release = io.sought?.(id) ?? (() => {})
      try {
        await io.walk(goal, Math.max(250, Math.min(WALK_MS, DROP_MS - (now() - d0))))
      } catch (e) {
        if (e?.aborted || signal?.aborted) { release(); throw e }
        walkSaid = e?.name && e.name !== 'Error' ? e.name : (e?.failClass ?? String(e?.message ?? e).slice(0, 30))
        const at = bot.entities?.[id]?.position
        // The same drop, still where it was: another walk will not do better.
        if (at && Math.hypot(at.x - from.x, at.y - from.y, at.z - from.z) < 0.5) {
          release(); await io.sleep(150, signal); reason = 'unreachable'; break
        }
      }
      try { await io.sleep(150, signal) } finally { release() }
    }
    const delta = gained() - g0
    if (delta <= 0 && !reason) reason = 'steps'
    emit(pickupRow({ logName, outcome: delta > 0 ? 'collected' : 'left', strategies, off, support,
                     reason: delta > 0 ? null : reason, delta, ms: now() - d0, breaks, walkSaid }))
    if (bagFull) break
  }
  const g = gained()
  return { verdict: transactionVerdict({ gained: g, sawDrop: true, bagFull }), gained: g, drops: seen.size, rows }
}

/** The `_pickup_reach` row: most important first in detail, every field structured in args. */
export function pickupRow ({ logName, outcome, strategies = [], off = null, support = null, reason = null,
                             delta = 0, ms = 0, breaks = 0, walkSaid = null }) {
  const strategy = strategies[0] ?? 'none'
  const d = off ? `${off.x},${off.y},${off.z}` : '?'
  const detail = [
    `${outcome} ${logName} via ${strategies.length ? strategies.join('>') : 'none'}`,
    `d=${d}`, `on=${support ?? '?'}`, `delta=${delta}`, `ms=${Math.round(ms)}`,
    reason ? `why=${reason}` : null, breaks ? `breaks=${breaks}` : null, walkSaid ? `walk=${walkSaid}` : null,
  ].filter(Boolean).join(' ').slice(0, 300)
  return {
    outcome, detail,
    args: { item: logName, strategy, strategies: strategies.join('>'), dx: off?.x ?? null, dy: off?.y ?? null,
            dz: off?.z ?? null, support, outcome, reason, delta, ms: Math.round(ms), breaks, walk: walkSaid },
  }
}
