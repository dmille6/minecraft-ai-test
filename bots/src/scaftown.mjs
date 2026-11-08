// SCAFTOWN-01: IN AND AROUND A TOWN, A WALK PREFERS THE WAY THAT IS THERE TO A DIRT TOWER IT WOULD LEAVE BEHIND.
// Pure decisions + two installers; index.mjs hands in home, the wall rings and the clock. Design and measurements:
// docs/reports/scaffold-design-2026-11-07.md.
//
// WHY (owner 11-07, after the timelapses: "we're still using dirt as a cheap way to get around and get over obstacles, and
// that leaves junk and dirt piles and pillars everywhere. is that just a cheap poor man's path finding solution?"; 11-04: "if a
// bot needs to place a dirt block to get somewhere that means there isnt access or the bot was too lazy to use the access").
// Measured on the showcase, 24 h to 11-08 00:43Z (15 bots, 322.6 bot-h; CoreProtect matched 2,609 of the 2,615 instrumented
// placements): the pathfinder placed 1,945 movement blocks in the town and its margin (pillar 1,048, step 877, bridge 20;
// dirt 2,389 of all 2,584 movement blocks), the escape reflexes 638. Of the pathfinder's, 409 cells still stand and 137 are the
// top of their column -- the pillars and steps the owner circled. The escape pillars stand in holes and tunnels: 9 of 262 on top.
// The walk prices a tower step at 1 + placeCost 5 = 6 against 1 for a walk step, so a two-block climb by dirt beats any
// staircase more than ~12 blocks away. That is the "poor man's path finding".
//
// WHAT: every placement a WORK OR TRAVEL WALK plans into THE TOWN'S AREA costs SCAF_TOWN.cost (20) more. The area is the
// walls' boxes (every wall@1 / wallext@1 record's ring, grown by ringGrow) and everything within workR (80, landplan's
// LAND.workR) of home -- at y >= home.y - dy (4): a pit, a tunnel or a mine under the town is priced exactly as before.
// With it a tower step costs 26 and a two-high step-up 46, so a walk round to the town's stairs, paths and gates wins up to
// ~20 blocks per block it would have placed; where nothing else goes, the tower is still taken.
//
// A SURCHARGE ON A LEGAL MOVE, NEVER A VETO (lidplace.mjs's lesson, the same mechanism): mineflayer-pathfinder 2.4.5 drops a
// move whose running cost passes 100 INSIDE getMoveUp / getMoveJumpUp / getMoveForward, so an exclusionAreasPlace price can
// delete a bot's only way out; and exclusionPlace is handed getMoveForward's blockC, the cell ABOVE its placement. So the price
// is added AFTER the library has decided which moves are legal (installScafTownPrice wraps getNeighbors). Every move the base
// offers is still offered; the A* only orders them differently. NO NEW REFUSAL: a bot in a pit inside the town still towers out.
//
// WHICH PROFILES (the Movements object being SEARCHED decides, `this.scafTown`, never the bot's active profile -- a probe on
// the walk while a reflex holds the ascend profile is the walk's question): walk and composter_walk carry it. EXEMPT, set
// false on their clones in index.mjs: gather (its approach admission is a capped search: digapproach), ascend, descend, deck,
// water (the escapes keep every placement: survival first), tunnel. town_deposit_walk places nothing anyway
// (towndeposit.mjs townWalkMovements). The reflexes' own pillars (reflex.mjs pillarOut, digStraightUp; skills.mjs surface,
// shaftAscend) call bot.placeBlock directly and never consult the pathfinder: untouched.
//
// THE FALLBACK IS PART OF THE PRICE (Codex design 11-07: "a finite surcharge preserves neighbours, not operational
// reachability: A* may exhaust time or a cost budget"). Three bounds, all in installScafTownSearch's wrapper round EVERY search
// (pathfinder.getPathFromTo, and each continuation of the A* it starts: the monitor calls astarContext.compute directly):
//   1. A CAPPED search (searchRadius >= 0: digapproach's 400, reachprobe's 96, the ore tunnel) is never priced: a price there
//      spends the cap and loses a route the base keeps.
//   2. THE PREFERENCE BUDGET: a search prices only its first budgetMs (1000) of compute. A search that has not found its path
//      when the budget runs out is RESTARTED from its start node at the base's costs, with the full timeout again (restartInPlace:
//      the same astarContext object, so goto's monitor and every caller keep their reference). Zeroing the price for the rest of
//      the SAME search is not enough (Codex r1 BLOCKER, reproduced with the real A*: a goal on a 20-high column, base success in
//      1,565 ms / 59,862 nodes, the priced search still timed out at 5,000 ms / 180,642 nodes after its cut -- the inflated g of
//      every closed node is kept and A* never reopens a closed node). So a priced search costs at most budgetMs + one slice more
//      than the base's, and then IS the base's search. A first slice that already failed after its cut (a probe whose single
//      slice is longer than the budget) is re-run whole, unpriced, by the generator wrapper.
//   3. THE LATCH: a priced search that ends `timeout` or `noPath` latches its goal for latchMs (120 s): every later search for
//      that goal (goto's retry, the next leg, the caller's re-issue) runs at the base's costs. So does a goal whose WALK resets
//      'stuck' stuckLatch (2) times (price.stuck, index.mjs's path_reset): a priced route the executor cannot walk falls back too.
//
// Never a veto, never a new dead end: the price changes the ORDER of legal moves, and under each bound the search is the base's.
// SCAFTOWN=off -> nothing is installed: every profile and every search is exactly the base's (the rollback without a deploy).

export const SCAF_TOWN = Object.freeze({ cost: 20, workR: 80, dy: 4, ringGrow: 2, budgetMs: 1000, latchMs: 120_000, stuckLatch: 2, hitsMs: 10 * 60_000 })
/** THE SWITCH: SCAFTOWN=off|0|false|no -> not installed. On by default. Pure. */
export const scafTownOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.SCAFTOWN ?? '').trim())

const fin = v => typeof v === 'number' && Number.isFinite(v)
/** THE WALL RINGS a town's records have -> [[x0, z0, x1, z1]] (wall.mjs records' `ring`: the wall and every extension). Pure. */
export function wallRingsOf (records = []) {
  return (records ?? []).filter(r => /^wall(ext)?@1$/.test(String(r?.blueprint ?? '')) && Array.isArray(r.ring) && r.ring.length === 4 && r.ring.every(fin)).map(r => r.ring.slice())
}
/**
 * THE TOWN'S AREA -> { hx, hy, hz, R, yMin, rings } | null (no home: no area, the price is 0 everywhere -- it FAILS OPEN, on
 * purpose: the bot plans exactly as the base). Rings are grown by T.ringGrow (the wall itself and the cells just outside it). Pure.
 */
export function scafAreaOf ({ home = null, rings = [], T = SCAF_TOWN } = {}) {
  const hx = Number(home?.x ?? home?.homeX), hy = Number(home?.y ?? home?.homeY), hz = Number(home?.z ?? home?.homeZ)
  if (!fin(hx) || !fin(hy) || !fin(hz)) return null
  const g = T.ringGrow
  const rs = (rings ?? []).filter(r => Array.isArray(r) && r.length === 4 && r.every(fin))
    .map(([a, b, c, d]) => [Math.min(a, c) - g, Math.min(b, d) - g, Math.max(a, c) + g, Math.max(b, d) + g])
  return { hx: Math.floor(hx), hy: Math.floor(hy), hz: Math.floor(hz), R: T.workR, yMin: Math.floor(hy) - T.dy, rings: rs }
}
/** Is the integer cell in the town's area? Pure; a few comparisons (the A* step's hot path: no allocation). */
export function inScafArea (area, x, y, z) {
  if (!area || !fin(x) || !fin(y) || !fin(z) || y < area.yMin) return false
  if (Math.abs(x - area.hx) <= area.R && Math.abs(z - area.hz) <= area.R) return true
  const rs = area.rings
  for (let i = 0; i < rs.length; i++) { const r = rs[i]; if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return true }
  return false
}
/**
 * THE SURCHARGE FOR ONE NEIGHBOUR -> cost x its placements that may land in the area. Pure. `toPlace` is mineflayer-pathfinder's
 * Move.toPlace: { x, y, z, dx, dy, dz } is the reference block and the face, so the block lands at ref + face (what the executor
 * sends) -- or IN the reference cell when that cell is still replaceable at execution (lidplace.mjs: the Paper finding). Both are
 * tested, each placement counted once: an over-price at the area's edge, never an under-price. A `useOne` entry places nothing.
 */
export function scafTownSurcharge (toPlace, area, cost = SCAF_TOWN.cost) {
  if (!area || !Array.isArray(toPlace) || !toPlace.length) return 0
  let n = 0
  for (const p of toPlace) {
    if (!p || p.useOne) continue
    if (inScafArea(area, p.x + (p.dx ?? 0), p.y + (p.dy ?? 0), p.z + (p.dz ?? 0)) || inScafArea(area, p.x, p.y, p.z)) n++
  }
  return n * cost
}

/** A goal's latch key -> string | null (a goal with no position is never latched: it has nothing to fall back FOR). Pure. */
export function goalKey (goal) {
  if (!goal) return null
  // GoalLookAtBlock / GoalPlaceBlock / GoalBreakBlock hold `pos`, the rest x/y/z (Claude r1 note)
  const at = (goal.pos && typeof goal.pos === 'object') ? goal.pos : goal
  const x = Number(at.x), y = Number(at.y), z = Number(at.z)
  if (fin(x) && fin(z)) return `${goal.constructor?.name ?? 'Goal'}:${Math.floor(x)},${fin(y) ? Math.floor(y) : '-'},${Math.floor(z)}`
  return null
}
/**
 * WHAT ONE SEARCH PRICES -> 'priced' | 'off' | 'capped' | 'latched'. Pure. off: the switch or a holder (price.off > 0);
 * capped: searchRadius >= 0; latched: its goal's last priced search failed less than latchMs ago.
 */
export function searchMode ({ on = true, off = 0, radius = -1, key = null, latch = null, now = 0 } = {}) {
  if (!on || off > 0) return 'off'
  if (fin(radius) && radius >= 0) return 'capped'
  if (key && latch && latch.has(key) && latch.get(key) > now) return 'latched'
  return 'priced'
}
/** Does a finished search latch its goal? -> bool. Pure: a priced search whose prices touched it and that ended without a path. */
export const latchesGoal = (s, status) => !!s && s.mode === 'priced' && s.hits > 0 && (status === 'timeout' || status === 'noPath')
/** Does a slice's result send its search back to the start at the base's costs? -> bool. Pure: the budget ran out (cut), the
 *  price touched the search (hits: otherwise it IS the base's search already) and the slice did not find the path; once per search.
 *  Never on noPath: an exhausted open heap is the base's answer too (a price never removes a move) -- Claude r2 note. */
export const restartsSearch = (s, status) => !!s && s.cut === true && !s.restarted && s.mode === 'priced' && s.hits > 0 && status !== 'success' && status !== 'noPath'
/**
 * RESTART AN A* IN PLACE -> bool: the same context object, its state replaced by a fresh search from its own start node (the root
 * of the best node's parent chain) with its own movements, goal, timeout and tick budget, uncapped (a capped search is never
 * priced). The caller then computes again. False (nothing changed) when the start cannot be found.
 */
export function restartInPlace (ctx) {
  let n = ctx?.bestNode, guard = 0
  while (n && n.parent && guard++ < 1e7) n = n.parent
  const start = n?.data
  if (!start || typeof ctx.constructor !== 'function') return false
  const fresh = new ctx.constructor(start, ctx.movements, ctx.goal, ctx.timeout, ctx.tickTimeout, -1)
  for (const k of Object.keys(fresh)) ctx[k] = fresh[k]
  return true
}

/**
 * THE PRICE index.mjs installs -> (toPlace) => surcharge, with its counters and its search scope. `area()` returns the current
 * scafAreaOf (cached by the caller, refreshed on a timer: never a read in the A* step); `now()` is a monotonic clock in ms.
 * Counters: hits (priced neighbours), chosen (priced moves in paths the walk took: index.mjs path_update), searches,
 * pricedSearches, cuts (searches that ran out of the preference budget), latches, capped, latched (searches the latch freed).
 */
export function makeScafTownPrice ({ area = () => null, on = true, now = () => Date.now(), T = SCAF_TOWN } = {}) {
  const price = (toPlace) => {
    if (!on || price.off > 0) return 0
    const s = price.cur
    if (s) {
      if (s.mode !== 'priced') return 0
      if (now() - s.t0 > T.budgetMs) { if (!s.cut) { s.cut = true; price.cuts++ } return 0 }
    }
    const v = scafTownSurcharge(toPlace, area(), T.cost)
    if (v > 0) { price.hits++; if (s) s.hits++ }
    return v
  }
  Object.assign(price, { off: 0, cur: null, hits: 0, chosen: 0, searches: 0, pricedSearches: 0, cuts: 0, restarts: 0, latches: 0, capped: 0, latched: 0, stuckLatches: 0, latch: new Map(), stalls: new Map(), T })
  /** A search starts -> its scope { mode, t0, hits, key }. */
  price.begin = ({ goal = null, radius = -1 } = {}) => {
    const t = now(), key = goalKey(goal)
    if (price.latch.size > 64) for (const [k, u] of price.latch) if (u <= t) price.latch.delete(k)
    const mode = searchMode({ on, off: price.off, radius, key, latch: price.latch, now: t })
    price.searches++
    if (mode === 'priced') price.pricedSearches++
    else if (mode === 'capped') price.capped++
    else if (mode === 'latched') price.latched++
    return { mode, t0: t, hits: 0, key, cut: false, done: false }
  }
  /**
   * THE EXECUTOR'S STALL (Claude r1 note): a priced route the planner FINISHED can still stall in the walking (a gate it cannot
   * get through, a wedged corner) -- the pathfinder resets 'stuck' and re-plans the SAME priced route, where the base would have
   * towered. A goal whose walk resets 'stuck' T.stuckLatch times within latchMs is latched to the base's costs like a failed search.
   * -> true when this reset latched it.
   */
  price.stuck = (goal) => {
    const key = goalKey(goal), t = now()
    if (!key || !on) return false
    const st = price.stalls.get(key)
    const n = st && st.until > t ? st.n + 1 : 1
    price.stalls.set(key, { n, until: t + T.latchMs })
    if (price.stalls.size > 64) for (const [k, v] of price.stalls) if (v.until <= t) price.stalls.delete(k)
    if (n < T.stuckLatch) return false
    price.stalls.delete(key)
    price.latch.set(key, t + T.latchMs); price.latches++; price.stuckLatches++
    return true
  }
  /** The budget, judged after a slice too (a search whose late expansions place nothing would never call the price): -> s.cut. */
  price.checkCut = (s) => {
    if (s && s.mode === 'priced' && !s.cut && now() - s.t0 > T.budgetMs) { s.cut = true; price.cuts++ }
    return !!s?.cut
  }
  /** A search slice returned `result` -> latch its goal when a priced search that the price touched ended without a path. */
  price.settle = (s, result) => {
    if (!s || s.done || !result || result.status === 'partial') return
    s.done = true
    if (latchesGoal(s, result.status) && s.key) { price.latch.set(s.key, now() + T.latchMs); price.latches++ }
  }
  return price
}

/**
 * INSTALL THE SURCHARGE on a Movements: an OWN getNeighbors that asks the one it had first and only then adds price(n.toPlace)
 * to each neighbour's cost -- unless the profile SEARCHED says `scafTown === false`. A plain function, never bound: index.mjs
 * derives every other profile with Object.create(proto) + Object.assign, which copies this property and the flag, and `this` is
 * the derived profile. Idempotent. -> the movements.
 */
export function installScafTownPrice (movements, price) {
  if (!movements || movements.__scafTownPrice || typeof price !== 'function') return movements
  const inner = movements.getNeighbors
  movements.getNeighbors = function (node) {
    const ns = inner.call(this, node)
    if (this.scafTown === false) return ns
    for (const n of ns) {
      if (!n?.toPlace?.length) continue
      const add = price(n.toPlace)
      // a SCALAR marker only (no allocation in the A* step); the chosen path's priced moves are counted in path_update
      if (add > 0) { n.cost += add; n.scafTown = add }
    }
    return ns
  }
  movements.__scafTownPrice = true
  movements.scafTown = true
  return movements
}

/**
 * THE SEARCH SCOPE: wrap pathfinder.getPathFromTo (goto's getPathTo and every probe call it through the property) so each search
 * carries its own scope -- its mode, its clock, its hits -- while ITS compute runs, including every continuation the monitor makes
 * through the yielded astarContext. The caller's generator protocol is unchanged: the same values, yielded in the same order.
 * Idempotent. -> the pathfinder.
 */
export function installScafTownSearch (pathfinder, price) {
  if (!pathfinder || pathfinder.__scafTownSearch || typeof pathfinder.getPathFromTo !== 'function' || typeof price?.begin !== 'function') return pathfinder
  const orig = pathfinder.getPathFromTo
  const scoped = (s, fn) => { const prev = price.cur; price.cur = s; try { return fn() } finally { price.cur = prev } }
  const wrapCompute = (ctx, s) => {
    if (!ctx || typeof ctx.compute !== 'function' || ctx.__scafTown) return
    const oc = ctx.compute
    ctx.compute = function () {
      return scoped(s, () => {
        let r = oc.call(this)
        price.checkCut(s)
        // the budget ran out before the path was found: from the start again at the base's costs, full timeout (Codex r1 BLOCKER)
        if (restartsSearch(s, r?.status) && restartInPlace(this)) { s.restarted = true; s.mode = 'fallback'; price.restarts++; r = oc.call(this) }
        try { price.settle(s, r) } catch { /* a counter never breaks a search */ }
        return r
      })
    }
    ctx.__scafTown = true
  }
  pathfinder.getPathFromTo = function * (movements, startPos, goal, options = {}) {
    const radius = options?.searchRadius ?? pathfinder.searchRadius
    let s = price.begin({ goal, radius })
    let g = orig.call(this, movements, startPos, goal, options)
    let step = scoped(s, () => g.next())
    price.checkCut(s)
    // a FIRST slice that ran past the budget and failed (a probe whose one slice outlasts budgetMs): the whole search again,
    // unpriced, through the library's own generator (its post-processing and its continuation protocol unchanged)
    if (!step.done && restartsSearch(s, step.value?.result?.status)) {
      price.restarts++
      s = { ...s, mode: 'fallback', restarted: true, hits: 0, done: false }
      g = orig.call(this, movements, startPos, goal, options)
      step = scoped(s, () => g.next())
    }
    while (!step.done) {
      const v = step.value
      try { if (v?.astarContext) wrapCompute(v.astarContext, s); price.settle(s, v?.result) } catch { /* counters only */ }
      yield v
      step = scoped(s, () => g.next())
    }
    return step.value
  }
  pathfinder.__scafTownSearch = true
  return pathfinder
}

/** The chosen path's priced moves -> count (path_update; a move carries the scalar `scafTown` only when the price touched it). Pure. */
export function chosenScafTown (path) {
  if (!Array.isArray(path)) return 0
  let n = 0
  for (const m of path) if (m?.scafTown > 0) n++
  return n
}
/** THE POSITIVE CONTROL (`_scaftown_hits`, every hitsMs): the price's counters since the last row and in total. Pure. */
export function scafTownHitsDetail (p, prev = {}) {
  const d = k => (p?.[k] ?? 0) - (prev?.[k] ?? 0)
  return `hits=${d('hits')} chosen=${d('chosen')} searches=${d('searches')} priced=${d('pricedSearches')} cuts=${d('cuts')} restarts=${d('restarts')} latches=${d('latches')} ` +
         `latched=${d('latched')} capped=${d('capped')} stuck_latches=${d('stuckLatches')} total_hits=${p?.hits ?? 0} off=${p?.off ?? 0}`
}
/** The counters to diff against next time. Pure. */
export const scafTownSnap = p => ({ hits: p?.hits ?? 0, chosen: p?.chosen ?? 0, searches: p?.searches ?? 0, pricedSearches: p?.pricedSearches ?? 0, cuts: p?.cuts ?? 0, restarts: p?.restarts ?? 0, latches: p?.latches ?? 0, latched: p?.latched ?? 0, capped: p?.capped ?? 0, stuckLatches: p?.stuckLatches ?? 0 })
/** The licence row (`_scaftown_mode`, once per spawn). Pure. */
export const scafTownModeDetail = (env = process.env, area = null, T = SCAF_TOWN) =>
  `on=${scafTownOn(env) ? 1 : 0} cost=${T.cost} workR=${T.workR} dy=${T.dy} budget_ms=${T.budgetMs} latch_ms=${T.latchMs} home=${area ? `${area.hx},${area.hy},${area.hz}` : '-'} rings=${area?.rings?.length ?? 0}`
