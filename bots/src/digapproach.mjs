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

/**
 * Wall clock for the approach WALK, and the bound the dig time is priced
 * against. The two bounds above are cost and count; neither is time. A cost of
 * 400 admits sixteen bare-handed stone digs, and sixteen bare-handed stone digs
 * take two minutes. The watchdog that used to end such a walk at one second
 * ended every approach dig with it (see skills.mjs at the call site), so the
 * walk now runs unwatched and the PLAN must refuse what the clock cannot hold.
 */
export const APPROACH_WALK_MS = 15000

/**
 * How long would walking this path spend DIGGING, with the best tool the bot
 * holds for each block? Distinct blocks, like approachDigCount, because the
 * pathfinder lists a block on every move that needs it gone.
 *
 * Prices with `bestHarvestTool`, which is what the pathfinder equips before it
 * digs -- so this is the time the walk will take if the equip lands, and a
 * lower bound if it does not (the observer at the call site records `held=`
 * for exactly that case). A block the world cannot describe (no digTime) is
 * priced at zero: an unknown is not a refusal, and the count bound still holds.
 */
export function approachDigMs (bot, path) {
  return approachDigCost(bot, path).ms
}

/**
 * Is this a block whose loss is a loss? Ore and its raw blocks: finite, wanted,
 * and dropped only to the right tool. Stone is none of those things.
 */
export function isOreLike (name) {
  return typeof name === 'string' &&
    (name.endsWith('_ore') || name === 'ancient_debris' || /^raw_\w+_block$/.test(name))
}

/**
 * Price the digs and name the ore they would destroy.
 *
 * `destroys` is every ore-like block on the path that the bot's BEST tool
 * cannot harvest: breaking it yields nothing and the ore is gone. A bot with
 * no pickaxe tunnelling through iron ore to reach a log is a real trade, and
 * it must not be made by accident on a walk that used to be cancelled at one
 * second. The tool the drop needs is the same one the pathfinder equips.
 */
export function approachDigCost (bot, path, { inWater = false, notOnGround = false, digTimeOf = null } = {}) {
  const out = { ms: 0, destroys: [] }
  if (!Array.isArray(path)) return out
  const seen = new Set()
  for (const mv of path) {
    for (const b of (mv?.toBreak ?? [])) {
      if (!b) continue
      const k = `${Math.floor(b.x)},${Math.floor(b.y)},${Math.floor(b.z)}`
      if (seen.has(k)) continue
      seen.add(k)
      let block = null
      try { block = bot?.blockAt?.(b) ?? null } catch { block = null }
      if (!block) continue
      let tool = null
      try { tool = bot?.pathfinder?.bestHarvestTool?.(block) ?? null } catch { tool = null }
      if (typeof digTimeOf === 'function' || typeof block.digTime === 'function') {
        let t = 0
        try {
          t = typeof digTimeOf === 'function'
            ? digTimeOf(block)
            : block.digTime(tool?.type ?? null, false, inWater, notOnGround, [], bot?.entity?.effects ?? {})
        } catch { t = 0 }
        if (Number.isFinite(t) && t > 0) out.ms += t
        else if (t === Infinity) out.ms += Infinity
      }
      if (isOreLike(block.name) && typeof block.canHarvest === 'function') {
        let ok = true
        try { ok = !!block.canHarvest(tool?.type ?? null) } catch { ok = true }
        if (!ok) out.destroys.push(block.name)
      }
    }
  }
  return out
}

/** Bounded resumes of a `partial` search. Same reasoning as reachprobe.mjs. */
export const APPROACH_PUMPS = 4

/**
 * THE DIG BUDGET MUST PRICE THE DIG THE BOT WILL ACTUALLY DO.
 *
 * goto's dig retry ran for a flat 25 s. hive-b-Delta, floating under a stone
 * lid (2026-09-11, canary hole-walks-01): three retries from the pocket, each
 * "pathfinding exceeded 25000ms", the lid still stone. Bare-handed stone is
 * 7.5 s on dry ground; mineflayer multiplies by 5 when the bot is not on the
 * ground and by 5 again when it is in water, which is exactly the state of a
 * bot that needs this retry. 187 s of digging against a 25 s clock. The walk
 * was no longer cancelled at one second; it was cancelled at twenty-five.
 * Same fiction as predictedDigMs (memory dig-budget-prices-a-fiction).
 *
 * So: plan first, price the plan's digs under the bot's REAL conditions, and
 * size the clock from that. Base + dig + margin, never below the base (a plan
 * with no digs keeps the old clock), capped so a mispriced plan cannot hold a
 * bot for ever.
 */
export const RETRY_BASE_MS = 25000
export const RETRY_MARGIN_MS = 5000
export const RETRY_CAP_MS = 240000

export function digRetryBudgetMs (digMs, { base = RETRY_BASE_MS, margin = RETRY_MARGIN_MS, cap = RETRY_CAP_MS } = {}) {
  if (digMs === Infinity) return cap            // undiggable by this pricing: the clock, not the base
  if (!Number.isFinite(digMs) || digMs <= 0) return base
  return Math.min(cap, base + digMs + margin)
}

/**
 * Plan one retry under `moves` and price its digs as the bot stands now.
 * Returns { status, path, digMs, budgetMs, inWater, notOnGround, ms }; a
 * planner that is missing, throws, or finds nothing still returns the base
 * budget -- the retry runs either way, and the mark says what was planned.
 */
export function planDigRetry (bot, moves, goal, { timeout = 3000, pumps = APPROACH_PUMPS } = {}) {
  const inWater = !!bot?.entity?.isInWater
  const notOnGround = !bot?.entity?.onGround
  const base = { status: 'unplanned', path: [], digMs: 0, budgetMs: digRetryBudgetMs(0), inWater, notOnGround, ms: 0 }
  const at = bot?.entity?.position
  if (!at || !goal || !moves || typeof bot?.pathfinder?.getPathFromTo !== 'function') return base
  const t0 = Date.now()
  let result
  try {
    const gen = bot.pathfinder.getPathFromTo(moves, at, goal, { timeout, optimizePath: true })
    result = gen.next()?.value?.result
    for (let i = 0; i < pumps && result?.status === 'partial' && Date.now() - t0 < timeout; i++) {
      result = gen.next()?.value?.result ?? result
    }
  } catch {
    return { ...base, status: 'threw', ms: Date.now() - t0 }
  }
  if (!result) return { ...base, ms: Date.now() - t0 }
  const path = Array.isArray(result.path) ? result.path : []
  // mineflayer's own pricing when the bot has it: held item, helmet enchants,
  // water at EYE level (not body contact -- prismarine-physics sets isInWater
  // from the body box, mineflayer's dig tests the eyes; Codex review), and the
  // real onGround. The block-level formula is the fallback for a bare block.
  const digTimeOf = typeof bot?.digTime === 'function' ? b => bot.digTime(b) : null
  const digMs = approachDigCost(bot, path, { inWater, notOnGround, digTimeOf }).ms
  return { status: result.status, path, digMs, budgetMs: digRetryBudgetMs(digMs), inWater, notOnGround, ms: Date.now() - t0 }
}

/**
 * Run one borrowed walk with the pathfinder's RUNTIME search held to the same
 * cost cap the plan was admitted under, and give the cap back afterwards.
 *
 * planDigApproach probes with `searchRadius: slack`, but goto() re-plans on its
 * own -- after a dig error, a block update, a partial -- with
 * `bot.pathfinder.searchRadius`, which is -1 (unbounded) fleet-wide. So the
 * walk the bot actually took was never bounded by the plan that admitted it;
 * only the wall clock held it. Now the re-plans cannot cost more than the
 * probe was allowed to. (Codex review, 2026-09-10.) index.mjs owns
 * setMovements and calls this from inside withGatherMovements; nothing here
 * touches the movements.
 */
export async function withApproachBound (bot, fn, { slack = APPROACH_SLACK } = {}) {
  const pf = bot?.pathfinder
  if (!pf || !('searchRadius' in pf)) return fn()
  const before = pf.searchRadius
  pf.searchRadius = slack
  try { return await fn() } finally { pf.searchRadius = before }
}

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
export function approachVerdict ({ status, path, endsInReach, maxDig = MAX_APPROACH_DIG,
                                  digMs = 0, budgetMs = APPROACH_WALK_MS, destroys = [] } = {}) {
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
  // TIME, not just count. Two bare-handed stone digs are 15 s, which is the
  // whole walk budget; a bot that cannot afford the digs must be refused here,
  // with the number, rather than spend the budget and be refused by the clock.
  if (!(digMs <= budgetMs)) {
    return { take: false, why: `approach digs would take ${Number.isFinite(digMs) ? Math.round(digMs) : 'infinite'}ms, over the ${budgetMs}ms walk budget`, dig }
  }
  if (Array.isArray(destroys) && destroys.length) {
    return { take: false, why: `approach would destroy ${destroys.join(',')} without a tool to harvest it`, dig }
  }
  return { take: true, why: null, dig, digMs }
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
  const cost = approachDigCost(bot, path)
  const verdict = approachVerdict({
    status: result.status,
    path,
    endsInReach: endsInReach ? !!endsInReach(end) : false,
    digMs: cost.ms,
    destroys: cost.destroys,
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

/**
 * Watch a dig-approach walk WITHOUT touching it.
 *
 * The walk runs with the dig watchdog off (skills.mjs says why at the call
 * site), so nothing else records what it broke. This does: every block whose
 * dig completed, and the first block the held item could not harvest -- the
 * question the watchdog used to answer by cancelling, which left the log with
 * the word PathStopped and no block name. Twenty-two of those in ninety minutes
 * and not one said which block.
 *
 * Passive by construction: it never calls stop(), stopDigging() or equip().
 * A poll rather than an event because mineflayer emits nothing when a dig
 * STARTS; `bot.targetDigBlock` is the only signal that one is under way.
 */
export function observeApproachDig (bot, { pollMs = 200 } = {}) {
  const t0 = Date.now()
  const attempted = []          // every distinct block a dig was seen on: {name, pos}
  const seenAt = new Set()
  let unharvestable = null
  let held = null
  let window = null             // the open container, if any, at that moment
  // NO EVENT LISTENER, on purpose. mineflayer's diggingCompleted carries the
  // NEW block (air), not the one that broke, and the pathfinder's
  // detectDiggingStopped calls removeAllListeners('diggingAborted', fn), which
  // Node reads as "remove them all". So the poll records each dig it sees by
  // position, and stop() re-reads those positions: a block that is no longer
  // what it was is a block that broke. (Both from the Codex review.)
  const timer = setInterval(() => {
    try {
      const b = bot?.targetDigBlock
      if (!b) return
      const pos = b.position
      const k = pos ? `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}` : b.name
      // KEEP THE Vec3. blockAt() calls .floored() on what it is given; a plain
      // {x,y,z} throws inside the re-read below and every walk read dug=none --
      // which is what the first fleet-wide minutes of 6d1fdba showed, on walks
      // that had dug four stone and arrived. The test fake accepted a plain
      // object, so the fixture inherited the bug.
      if (!seenAt.has(k)) {
        seenAt.add(k)
        attempted.push({ name: b.name ?? 'unknown', pos: pos && typeof pos.clone === 'function' ? pos.clone() : null })
      }
      if (unharvestable || typeof b.canHarvest !== 'function') return
      const item = bot.heldItem
      if (!b.canHarvest(item?.type ?? null)) {
        unharvestable = b.name ?? 'unknown'
        held = item?.name ?? 'nothing'
        // The rival explanation for "unharvestable with a pickaxe in the bag":
        // the pathfinder's equip clicks against bot.currentWindow, and a hung
        // container window sends those clicks to the wrong slots. Record it.
        const w = bot.currentWindow
        window = w ? (w.type ?? w.title ?? 'open') : 'none'
      }
    } catch { /* transient world state */ }
  }, pollMs)
  let stopped = null
  return {
    stop () {
      if (stopped) return stopped
      clearInterval(timer)
      const dug = []
      for (const a of attempted) {
        if (!a.pos) continue
        let now = null
        try { now = bot?.blockAt?.(a.pos) ?? null } catch { now = null }
        if (now && now.name !== a.name) dug.push(a.name)
      }
      stopped = { walkMs: Date.now() - t0, dug, attempted: attempted.map(a => a.name), unharvestable, held, window }
      return stopped
    },
  }
}


/**
 * A FLOATING BOT NEVER DIGS THROUGH THE PATHFINDER.
 *
 * mineflayer-pathfinder's executor starts a dig only when
 * `bot.entity.onGround` (index.js: `if (!digging && bot.entity.onGround)`).
 * A bot treading water under a stone lid has a plan that breaks the lid and
 * an executor that waits for ground it will never touch -- hive-b-Delta,
 * canary hole-walks-01: three 25 s retries, a found path, no dig, no event.
 * mineflayer's own `bot.dig` has no such gate, so the retry breaks the plan's
 * first blocks itself when it is not on the ground, then lets goto walk.
 *
 * Pure over the plan: the blocks the FIRST digging move wants gone (the ones
 * between the bot and its next node), distinct, present, reachable by
 * mineflayer's own reach test when the bot has one, at most `max`. Anything
 * beyond the first move is the executor's business once the bot stands.
 */
export function floatDigTargets (bot, path, { max = 3 } = {}) {
  if (!bot?.entity || bot.entity.onGround) return []
  if (!Array.isArray(path)) return []
  // Only the FIRST move: the executor digs in path order, and a dig that
  // sits behind a walk or a placement is not a dig from here. If the plan
  // walks first, the walk is the executor's to try (Codex review).
  const mv = path[0]
  if (!Array.isArray(mv?.toBreak) || mv.toBreak.length === 0) return []
  const out = []; const seen = new Set()
  for (const b of mv.toBreak) {
    if (!b || out.length >= max) break
    const k = `${Math.floor(b.x)},${Math.floor(b.y)},${Math.floor(b.z)}`
    if (seen.has(k)) continue
    seen.add(k)
    let block = null
    try { block = bot.blockAt?.(b) ?? null } catch { block = null }
    if (!block || !block.name || block.name === 'air' || block.boundingBox === 'empty') continue
    if (typeof bot.canDigBlock === 'function') {
      let ok = false
      try { ok = !!bot.canDigBlock(block) } catch { ok = false }
      if (!ok) continue
    }
    let digMs = 0
    try { digMs = typeof bot.digTime === 'function' ? bot.digTime(block) : 0 } catch { digMs = 0 }
    out.push({ block, digMs: Number.isFinite(digMs) && digMs > 0 ? digMs : 0 })
  }
  return out
}


/**
 * Re-read a float-dig target the instant before digging it. Targets are
 * priced once; the world and the bot move. Refuse when the bot has since
 * found ground (the executor will dig, with its own checks), when the block
 * is gone or no longer reachable, when it is the block under the bot's feet
 * (a floating bot has none, but a bot that drifted onto a ledge does), or
 * when lava touches it. Water beside it is allowed: the bot is already in
 * water, and a pocket cannot flood a bot that is floating in it.
 */
export function floatDigOk (bot, block) {
  if (!bot?.entity || bot.entity.onGround) return { ok: false, why: 'grounded' }
  const pos = block?.position
  if (!pos) return { ok: false, why: 'no block' }
  let now = null
  try { now = bot.blockAt?.(pos) ?? null } catch { now = null }
  if (!now || !now.name || now.name === 'air' || now.boundingBox === 'empty') return { ok: false, why: 'already open' }
  if (typeof bot.canDigBlock === 'function') {
    let ok = false
    try { ok = !!bot.canDigBlock(now) } catch { ok = false }
    if (!ok) return { ok: false, why: 'out of reach' }
  }
  const p = bot.entity.position
  if (p && Math.floor(p.x) === pos.x && Math.floor(p.z) === pos.z && pos.y === Math.floor(p.y) - 1) {
    return { ok: false, why: 'under my feet' }
  }
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    let n = null
    try { n = bot.blockAt?.({ x: pos.x + dx, y: pos.y + dy, z: pos.z + dz }) ?? null } catch { n = null }
    if (n && /lava/.test(n.name || '')) return { ok: false, why: `lava at ${pos.x + dx},${pos.y + dy},${pos.z + dz}` }
  }
  return { ok: true, why: '' }
}
