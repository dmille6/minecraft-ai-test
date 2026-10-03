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
 * WHAT THE SERVER ACTUALLY TESTS (confirmed by both reviews). Vanilla
 * Player.aiStep (1.21.x) touches every entity intersecting
 * `getBoundingBox().inflate(1.0, 0.5, 1.0)` (not riding), and ItemEntity.playerTouch
 * takes the stack once its pickup delay is 0 (10 ticks for a block drop) and the
 * inventory has room. The player box is 0.6 x 1.8 and an item entity's is
 * 0.25 x 0.25, positioned at its bottom centre. So, item position minus feet:
 *
 *     |dx|, |dz| < 0.3 + 1.0 + 0.125 = 1.425
 *     dy in (-(0.5 + 0.25), 1.8 + 0.5) = (-0.75, 2.3)
 *
 * The 2.3 is the "2.3+ blocks above the feet" in the root cause: from the bot's
 * own floor, nothing resting higher can be taken, however long it waits.
 *
 * THE TRANSACTION. Identify the drop(s) from THIS dig (new log entities near the
 * cell, or a pre-existing log stack that grew -- the server merges stacks), let
 * each SETTLE (mineflayer moves other entities only on position packets, so 250 ms
 * after the dig the drop still reads mid-air in the broken cell), confirm it is a
 * log of the gathered family, then per drop, bounded:
 *   wait           the drop is already inside the pickup box: wait out the delay
 *   break_support  it rests above the box on leaves or on the gathered log, that
 *                  block passes `supportVeto` and its dig fits the budget: break
 *                  it so the drop falls, re-settle, go again -- at most twice
 *   walk           to a node whose body box contains the drop (pickupGoal, using
 *                  the real standing height of the node), A* think time capped
 * and it finishes ONLY on an inventory gain of that log. A drop that vanished,
 * despawned or was taken by someone else is not a collection. Every wait, walk and
 * dig is clamped to an absolute deadline and aborts with the skill.
 *
 * Pure parts are exported and tested by behaviour; the transaction takes its I/O
 * (walk, dig, sleep, log) from the caller so this file imports no skill code.
 */
import { Vec3 } from 'vec3'
import { LAVA_LIKE } from './lavaguard.mjs'
import { neverPickUp } from './hygiene.mjs'

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
 *   supportOk  the caller's answer: the support passes supportVeto and its dig fits
 *   breaksLeft how many more supports this drop may cost
 */
export function choosePickupStrategy ({ feet, drop, supportName = null, logName = null, supportOk = false, breaksLeft = 0 } = {}) {
  if (inPickupBox(feet, drop)) return 'wait'
  const dy = (drop?.y ?? NaN) - (feet?.y ?? NaN)
  if (dy >= ELEVATED_DY && breaksLeft > 0 && supportOk && isLooseSupport(supportName, logName)) return 'break_support'
  return 'walk'
}

/**
 * Every block that falls when what holds it goes: gravity blocks (they fall when
 * the block BELOW them goes) and pointed dripstone (it falls when the block ABOVE
 * it goes). Breaking a support is checked against both neighbours.
 */
export const FALLS = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]+_concrete_powder|anvil|chipped_anvil|damaged_anvil|pointed_dripstone|dragon_egg|scaffolding)$/

const isWaterlogged = b => {
  if (!b) return false
  if (b._properties?.waterlogged === true) return true
  try { if (b.getProperties?.()?.waterlogged === true) return true } catch { return true }   // unreadable: fail closed
  return false
}
const isFluid = b => !!b && (b.liquid === true || /water|lava|bubble_column/.test(String(b.name)))
const isWater = b => !!b && /water|bubble_column/.test(String(b.name))

/**
 * May this support be broken? null when yes, otherwise the reason -- and it FAILS
 * CLOSED: an unknown cell, a missing safety checker or an unreadable property is
 * a veto, never a pass (Codex P1). Pure over:
 *   block        the support (prismarine block)
 *   at(x,y,z)    any cell, null for unknown
 *   safeToBreak  pathfinder Movements.safeToBreak (liquid neighbours, falling above), or null
 *   held         the held item; spent = its uses left are at the hard stop
 *   canDig       mineflayer's canDigBlock answer for the support
 */
export function supportVeto ({ block, at, safeToBreak = null, heldSpent = false, canDig = false } = {}) {
  if (!block?.position) return 'no_block'
  if (!canDig) return 'out_of_reach'
  if (typeof safeToBreak !== 'function') return 'no_safety_checker'
  if (typeof at !== 'function') return 'no_world'
  const p = block.position
  if (isFluid(block) || isWaterlogged(block)) return 'waterlogged'
  let safe = false
  try { safe = !!safeToBreak(block) } catch { safe = false }
  if (!safe) return 'unsafe'
  const above = at(p.x, p.y + 1, p.z), below = at(p.x, p.y - 1, p.z)
  if (above == null || below == null) return 'unknown_neighbour'
  if (FALLS.test(String(above.name)) || FALLS.test(String(below.name))) return 'falling_block'
  if (!supportLavaFree(at, p)) {
    for (const [dx, dy, dz] of LAVA_CELLS) if (at(p.x + dx, p.y + dy, p.z + dz) == null) return 'unknown_neighbour'
    return 'lava'
  }
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const n = at(p.x + dx, p.y + dy, p.z + dz)
    if (n == null) return 'unknown_neighbour'
    if (isWater(n) || n.liquid === true || isWaterlogged(n)) return 'water_beside'
  }
  if (isWater(above) || above.liquid === true || isWaterlogged(above)) return 'water_beside'
  if (heldSpent) return 'last_swing'
  return null
}

/**
 * Lava is the one face nobody relaxes: nothing lava-like on the six faces of the
 * support, nor in the two cells under those (the drop falls there). `at(x,y,z)`
 * returns a block or null; an unknown cell is not safe.
 */
const LAVA_CELLS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, -2, 0], [0, -3, 0]]
export function supportLavaFree (at, p) {
  if (!p || typeof at !== 'function') return false
  for (const [dx, dy, dz] of LAVA_CELLS) {
    const b = at(p.x + dx, p.y + dy, p.z + dz)
    if (b == null || LAVA_LIKE.has(b.name)) return false
  }
  return true
}

/** Margin on a support dig: digTime is the client's estimate, and a tick or two of lag is normal. */
export const DIG_MARGIN_MS = 500
/** Timeout for a support dig of `digMs`, or null when it cannot fit in `leftMs` (then do not start it). */
export function supportDigTimeout (digMs, leftMs) {
  if (!Number.isFinite(digMs) || digMs < 0 || !Number.isFinite(leftMs)) return null
  const need = Math.ceil(digMs * 1.25) + DIG_MARGIN_MS
  return need <= leftMs ? need : null
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

/** How close to the broken cell's centre (horizontally) a drop counts as its drop, and how far it may fall. */
export const DROP_NEAR_H = 1.6
export const DROP_FALL = 12

/** What an item entity is, from its metadata: family | other | ballast | unknown (metadata not in yet). */
export function identify (e, family) {
  let it = null
  try { it = e?.getDroppedItem?.() ?? null } catch { it = null }
  const name = it?.name ?? null
  const count = Number.isFinite(it?.count) ? it.count : null
  if (!name) return { kind: 'unknown', name: null, count }
  if (neverPickUp(e)) return { kind: 'ballast', name, count }
  return { kind: family.has(name) ? 'family' : 'other', name, count }
}

/**
 * Item entities present now, id -> stack count (null when unknown). Snapshot this
 * BEFORE the dig: a drop is either a new id, or an old stack that GREW -- the
 * server merges a fresh drop into a nearby stack of the same item (Codex P1).
 */
export function itemIdsNow (bot) {
  const out = new Map()
  try {
    for (const e of Object.values(bot?.entities ?? {})) {
      if (e?.name !== 'item' || e.id == null) continue
      let c = null
      try { c = e.getDroppedItem?.()?.count ?? null } catch { c = null }
      out.set(e.id, Number.isFinite(c) ? c : null)
    }
  } catch { /* empty */ }
  return out
}

/** Is this entity a drop of THIS dig: near the cell, and new, or a pre-existing family stack that grew? */
export function isDropFrom (e, cell, family, pre = new Map()) {
  if (!e || e.name !== 'item' || e.id == null || !cell) return false
  const p = e.position
  if (!p) return false
  if (Math.abs(p.x - (cell.x + 0.5)) > DROP_NEAR_H || Math.abs(p.z - (cell.z + 0.5)) > DROP_NEAR_H) return false
  if (p.y > cell.y + 1.5 || p.y < cell.y - DROP_FALL) return false
  const who = identify(e, family)
  if (who.kind === 'other' || who.kind === 'ballast') return false
  const had = pre instanceof Map ? pre.get(e.id) : (pre?.has?.(e.id) ? null : undefined)
  if (had === undefined) return true                              // a new entity (identified or not yet)
  return who.kind === 'family' && Number.isFinite(had) && Number.isFinite(who.count) && who.count > had
}

// ---------------------------------------------------------------- bounds -----

export const PICKUP_WAIT_MS = 600       // pickup delay is 10 ticks (500 ms) from the spawn
export const SETTLE_MS = 700            // a drop with no position packet yet is trusted after this long
export const SETTLE_QUIET_MS = 200      // ...or this long after its last position packet
export const IDENTIFY_MS = 1000         // metadata that has not arrived by then: not pursued
export const DROP_SEEN_MS = 1000        // how long to wait for the drop entity to appear
export const DROP_MS = 6000             // per drop
export const RUN_MS = 9000              // per transaction (one dig)
export const MAX_STEPS = 4              // wait/walk/break steps per drop
export const MAX_BREAKS = 2             // break a support, re-observe, repeat once
export const MAX_DROPS = 3
export const WALK_MS = 4000
export const MIN_ACT_MS = 250           // less budget than this left: do not start a walk or a dig
export const PICKUP_THINK_MS = 1500     // A* think time for a pickup walk (thinkTimeout is 5000)

const r1 = v => Math.round(v * 10) / 10
const posOf = p => ({ x: p.x, y: p.y, z: p.z })

/**
 * One bounded pickup transaction after a log dig.
 *
 *   opts.cell       the broken block's position
 *   opts.logName    what was broken (and what a log support must be to be broken)
 *   opts.family     item names the dig yields (drops.dropsOf)
 *   opts.pre        item entities before the dig (itemIdsNow: id -> count)
 *   opts.heldBefore count of the family before the dig; opts.held() reads it now
 *   opts.deadline   absolute ms: nothing is started past it, everything is clamped to it
 *   io.goals              the pathfinder goals module (pickupGoal builds on it)
 *   io.standY(node)       real feet height on a planner node
 *   io.walk(goal, ms, sig)  bounded, abortable walk with capped think time; throws on failure
 *   io.dig(block, ms, sig)  bounded, abortable break of a support
 *   io.digMs(block)       estimated dig time of the support with the held item
 *   io.veto(block)        supportVeto's answer for this block (null = may break)
 *   io.sleep(ms, sig)     rejects on abort
 *   io.log(row)           writes a `_pickup_reach` row
 *   io.sought(id)         telemetry marker; returns release()
 *
 * Returns { verdict, gained, drops, ids, rows }. Aborts propagate.
 */
export async function pickupTransaction (bot, opts, io) {
  const { cell, logName, heldBefore = 0, held, signal = null } = opts
  const pre = opts.pre instanceof Map ? opts.pre : new Map([...(opts.pre ?? [])].map(id => [id, null]))
  const family = new Set(opts.family?.length ? opts.family : [logName])
  const itemName = [...family][0] ?? logName
  const now = io.now ?? (() => Date.now())
  const t0 = now()
  const end = Math.min(t0 + RUN_MS, Number.isFinite(opts.deadline) ? opts.deadline : Infinity)
  const left = () => end - now()
  const gained = () => Math.max(0, (Number(held?.()) || 0) - heldBefore)
  const aborted = () => { if (signal?.aborted) throw Object.assign(new Error('aborted'), { aborted: true }) }
  const rows = []
  const seen = new Set()
  const queue = []
  const track = new Map()       // id -> { first, moved, lastMove, pos0 }
  const scanCells = [cell]
  const scan = () => {
    try {
      for (const e of Object.values(bot?.entities ?? {})) {
        if (seen.has(e?.id)) continue
        if (!scanCells.some(c => isDropFrom(e, c, family, pre))) continue
        seen.add(e.id)
        track.set(e.id, { first: now(), moved: false, lastMove: null, pos0: posOf(e.position) })
        if (seen.size <= MAX_DROPS) queue.push(e.id)
      }
    } catch { /* an unreadable entity table is "no drop seen" */ }
  }
  // A POSITION PACKET IS THE ONLY THING THAT MOVES ANOTHER ENTITY in mineflayer (entities.js emits entityMoved).
  const onMoved = e => { const tr = track.get(e?.id); if (tr) { tr.moved = true; tr.lastMove = now() } }
  const settled = (id, ent) => {
    const tr = track.get(id)
    if (!tr) return true
    const p = ent?.position
    if (!tr.moved && p && Math.hypot(p.x - tr.pos0.x, p.y - tr.pos0.y, p.z - tr.pos0.z) > 0.01) { tr.moved = true; tr.lastMove = now() }
    if (tr.moved) return now() - tr.lastMove >= SETTLE_QUIET_MS
    return now() - tr.first >= SETTLE_MS
  }
  const resettle = (id, ent) => { const tr = track.get(id); if (tr && ent?.position) Object.assign(tr, { first: now(), moved: false, lastMove: null, pos0: posOf(ent.position) }) }
  const emit = row => { rows.push(row); try { io.log?.(row) } catch { /* telemetry */ } }
  try { bot.on?.('entityMoved', onMoved) } catch { /* no events: positions are compared instead */ }
  try {
    // 1. WHICH DROP CAME FROM THIS DIG. Its appearance is also the only server-side
    //    evidence the break happened: the 250 ms re-read before this reads our own
    //    cache, which mineflayer wrote air into when its local dig timer fired.
    scan()
    while (!queue.length && gained() === 0 && now() - t0 < DROP_SEEN_MS && left() > 0) {
      aborted()
      await io.sleep(100, signal)
      scan()
    }
    if (!queue.length) {
      const g = gained()
      emit(pickupRow({ logName, outcome: g > 0 ? 'collected' : 'left', strategies: g > 0 ? ['wait'] : [],
                       reason: g > 0 ? null : (left() <= 0 ? 'deadline' : 'no_drop_seen'), delta: g, ms: now() - t0 }))
      return { verdict: transactionVerdict({ gained: g, sawDrop: false }), gained: g, drops: 0, ids: [], rows }
    }

    let bagFull = false
    while (queue.length && left() > 0) {
      const id = queue.shift()
      const d0 = now()
      const g0 = gained()
      const strategies = []
      let breaks = 0, steps = 0, off = null, support = null, veto = null, reason = null, walkSaid = null, outside = 0
      while (true) {
        aborted()
        if (gained() > g0) break
        if (left() < MIN_ACT_MS) { reason = 'deadline'; break }
        if (now() - d0 > DROP_MS) { reason = 'timeout'; break }
        if (steps >= MAX_STEPS) { reason = 'steps'; break }
        scan()
        const ent = bot.entities?.[id]
        // RETIRE IS NOT COMPLETION. The entity is gone; only the bag says whether we took it.
        if (!ent) { await io.sleep(Math.min(150, left()), signal); reason = 'vanished'; break }
        if (!hasRoomFor(bot.inventory?.items?.() ?? [], bot.inventory?.emptySlotCount?.(), itemName)) {
          bagFull = true; reason = 'inventory_full'; break
        }
        // ONLY A CONFIRMED LOG IS PURSUED (Codex P2). Metadata may lag the spawn: re-read, never guess.
        const who = identify(ent, family)
        if (who.kind === 'other' || who.kind === 'ballast') { reason = 'not_family'; break }
        if (who.kind === 'unknown') {
          if (now() - (track.get(id)?.first ?? d0) >= IDENTIFY_MS) { reason = 'unidentified'; break }
          await io.sleep(Math.min(100, left()), signal); continue
        }
        // DECIDE FROM A SETTLED POSITION (Claude): a drop read before it has landed sits in the broken cell, over air.
        if (!settled(id, ent)) { await io.sleep(Math.min(100, left()), signal); continue }
        const feet = bot.entity?.position
        const pos = ent.position
        if (!feet || !pos) { reason = 'no_position'; break }
        if (!off) off = { x: r1(pos.x - feet.x), y: r1(pos.y - feet.y), z: r1(pos.z - feet.z) }
        const sc = supportCellOf(pos)
        let sup = null
        try { sup = bot.blockAt?.(new Vec3(sc.x, sc.y, sc.z)) ?? null } catch { sup = null }
        support ??= sup?.name ?? null
        // Never the block the bot is standing on.
        // (feet 64.0 stand on cell 63; feet 64.5 stand on the slab in cell 64)
        const underFeet = Math.floor(feet.x) === sc.x && Math.floor(feet.y - 0.01) === sc.y && Math.floor(feet.z) === sc.z
        let ok = false
        const elevated = pos.y - feet.y >= ELEVATED_DY && isLooseSupport(sup?.name, logName)
        if (elevated && !underFeet && breaks < MAX_BREAKS) {
          let v = null
          try { v = typeof io.veto === 'function' ? io.veto(sup) : 'no_veto_checker' } catch { v = 'veto_threw' }
          if (!v) {
            let digMs = NaN
            try { digMs = Number(io.digMs?.(sup)) } catch { digMs = NaN }
            const budget = Math.min(left(), DROP_MS - (now() - d0))
            if (supportDigTimeout(digMs, budget) == null) v = Number.isFinite(digMs) ? `dig_too_slow_${Math.round(digMs)}ms` : 'dig_time_unknown'
          }
          veto = v
          ok = !v
        }
        const s = choosePickupStrategy({ feet, drop: pos, supportName: sup?.name ?? null, logName, supportOk: ok,
                                         breaksLeft: MAX_BREAKS - breaks })
        strategies.push(s)
        steps++
        if (s === 'wait') { await io.sleep(Math.min(PICKUP_WAIT_MS, left()), signal); continue }
        if (s === 'break_support') {
          breaks++
          const budget = Math.min(left(), DROP_MS - (now() - d0))
          const ms = supportDigTimeout(Number(io.digMs?.(sup)), budget) ?? budget
          try { await io.dig(sup, ms, signal) } catch (e) { if (e?.aborted || signal?.aborted) throw e }
          resettle(id, ent)                       // the drop falls: decide again only once it has landed
          scanCells.push(sc)                      // a broken log support drops a log of its own
          continue
        }
        // walk
        const from = posOf(pos)
        const goal = pickupGoal(io.goals, pos, io.standY ?? null)
        if (!goal) { reason = 'no_goal'; break }
        const release = io.sought?.(id) ?? (() => {})
        let walked = false
        try {
          await io.walk(goal, Math.max(1, Math.min(WALK_MS, left(), DROP_MS - (now() - d0))), signal)
          walked = true
        } catch (e) {
          if (e?.aborted || signal?.aborted) { release(); throw e }
          walkSaid = e?.name && e.name !== 'Error' ? e.name : (e?.failClass ?? String(e?.message ?? e).slice(0, 30))
          const at = bot.entities?.[id]?.position
          // UNREACHABLE ONLY FROM A SETTLED POSITION THAT DID NOT MOVE while we tried.
          if (at && settled(id, bot.entities[id]) && Math.hypot(at.x - from.x, at.y - from.y, at.z - from.z) < 0.5) {
            release(); reason = 'unreachable'; break
          }
        }
        try { await io.sleep(Math.min(150, Math.max(0, left())), signal) } finally { release() }
        // ARRIVAL IS CHECKED, NOT ASSUMED: goto resolves on the goal it computed, and the body must hold the drop.
        if (walked && !inPickupBox(bot.entity?.position, bot.entities?.[id]?.position ?? pos) && gained() <= g0) {
          walkSaid = 'arrived_outside'
          if (++outside >= 2) { reason = 'arrived_outside'; break }
        }
      }
      const delta = gained() - g0
      if (delta > 0 && !strategies.length) strategies.push('wait')   // taken by the server while it settled
      if (delta <= 0 && !reason) reason = 'steps'
      emit(pickupRow({ logName, outcome: delta > 0 ? 'collected' : 'left', strategies, off, support, veto,
                       reason: delta > 0 ? null : reason, delta, ms: now() - d0, breaks, walkSaid }))
      if (bagFull) break
    }
    const g = gained()
    return { verdict: transactionVerdict({ gained: g, sawDrop: true, bagFull }), gained: g, drops: seen.size, ids: [...seen], rows }
  } finally {
    try { bot.off?.('entityMoved', onMoved) } catch { /* events */ }
  }
}

/** The `_pickup_reach` row: most important first in detail, every field structured in args. */
export function pickupRow ({ logName, outcome, strategies = [], off = null, support = null, veto = null, reason = null,
                             delta = 0, ms = 0, breaks = 0, walkSaid = null }) {
  const strategy = strategies[0] ?? 'none'
  const d = off ? `${off.x},${off.y},${off.z}` : '?'
  const detail = [
    `${outcome} ${logName} via ${strategies.length ? strategies.join('>') : 'none'}`,
    `d=${d}`, `on=${support ?? '?'}`, `delta=${delta}`, `ms=${Math.round(ms)}`,
    reason ? `why=${reason}` : null, veto ? `veto=${veto}` : null, breaks ? `breaks=${breaks}` : null,
    walkSaid ? `walk=${walkSaid}` : null,
  ].filter(Boolean).join(' ').slice(0, 300)
  return {
    outcome, detail,
    args: { item: logName, strategy, strategies: strategies.join('>'), dx: off?.x ?? null, dy: off?.y ?? null,
            dz: off?.z ?? null, support, veto, outcome, reason, delta, ms: Math.round(ms), breaks, walk: walkSaid },
  }
}
