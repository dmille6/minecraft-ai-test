// CLEANZONE-01: IN THE TOWN AND ITS MARGIN A ROUTE MAY NOT PLACE A BLOCK. Pure decisions + two installers; index.mjs hands in
// home and the clock. The switch is CLEANZONE=off (nothing installed: every profile and every search is exactly the base's).
//
// WHY (owner 11-13: "the cleanup grounds keeper fixes dont seem to be working ... is there a better way for bots to move, escape,
// and travel that doesnt not leave trash?"; then "build it, lets get this done"). Measured on the showcase, 24 h to 11-13 12:10Z
// (14 bots, `_place_town`): 4,572 blocks placed in the town and its margin, 3,443 of them by the pathfinder. By the skill running:
// gather 42% (1,735 by the pathfinder), explore 19%, between actions 14% (the reflexes), goto 6%, surface 6%, build_shop 5%,
// home 3%. Per hour of the night: ~200 placed, the take-back digs ~49, ~22 vanish, the cleanup fixes ~104 -- break-even.
// scaftown-01's price cannot close that: it exempts the gather profile (the largest source), it stops at home.y - 4 while 78% of
// the placements sit below that (the town's ground runs y 62-70), and a price falls back to the tower whenever a search fails.
//
// WHAT: a neighbour whose placement would land in THE CLEAN ZONE is removed from what the search is offered. The zone is exactly
// the `_place_town` instrument's (placeaudit.mjs placeZone: within PLACE_TOWN_R + PLACE_MARGIN of home, never deeper than
// home.y - PLACE_TOWN_DEPTH), so the rule and the row that measures it cannot drift apart. Walk, gather and every profile cloned
// from them carry it. EXEMPT, set `cleanZone = false` on their clones in index.mjs: ascend, descend, deck, water -- the escapes.
// The reflexes' own pillars (reflex.mjs, skills.mjs surface) call bot.placeBlock directly and never ask the pathfinder: untouched.
// Digging is not touched here (the walk profile already has canDig = false; `_dig_town` is 600 rows a day against 4,572).
//
// HOW (scaftown.mjs's mechanism, so nothing here rests on library behaviour that is not already live): an OWN getNeighbors that
// asks the one it had first and then drops the neighbours whose `toPlace` lands in the zone. It runs AFTER the library decided
// which moves are legal, so it never meets mineflayer-pathfinder's `cost > 100` cut inside getMoveUp / getMoveJumpUp.
//
// A NEW REFUSAL NEEDS A REMEDY THE BOT CAN PERFORM FROM WHERE IT IS ("A hard veto here was the pit trap", index.mjs on the town's
// ground). Three, in order:
//   1. Another route: stairs, paths, gates, swimming. The search still has every move that places nothing.
//   2. THE VALVE, deterministic, in this file: a search the ban touched that ends without a path is counted.
//        - `noPath` (the A* ran out of cells: the bot is enclosed, a pit) twice from the same spot within failMs, or
//        - `timeout` timeoutN times within timeoutMs (the bot can move but nothing it reaches goes where it must) -- only a
//          search given at least timeoutMinMs to think: reflex.mjs canStartAPath's 800 ms probe timing out says nothing
//          (Claude review 11-13: it runs every 60 s on an idle bot and would open the valve by itself),
//      and the ban is LIFTED for every search that starts within releaseR of that spot for releaseMs. The bot towers out exactly
//      as the base would. Only uncapped searches are counted (a capped probe -- reachprobe, digapproach -- running out of its
//      radius says nothing about being enclosed); a released spot frees capped searches too, so the probe and the walk agree.
//      Every release writes `_cleanzone op=release` with the spot and the goal: the list of places where access is missing.
//   3. The escapes (exempt profiles) and the reflexes, as before.
// So no bot is held where it stands for longer than two failed searches, and what the valve lets through is counted.
//
// ROWS: `_cleanzone_mode` once per spawn (the licence); `_cleanzone_hits` every hitsMs (the positive control: neighbours removed,
// searches touched, searches the ban failed, releases); `_cleanzone op=release` per release.
import { PLACE_TOWN_R, PLACE_MARGIN, PLACE_TOWN_DEPTH } from './placeaudit.mjs'
import { homeOf, isTerrain } from './townground.mjs'

// The windows are sized on the decision loop, not on one skill: a bot whose walk failed is asked again ~30 s later (the
// decision cooldown) and a skill may take a minute, so two failures can be two minutes apart and the release must still be open
// when the next walk starts.
export const CLEAN_ZONE = Object.freeze({ failN: 2, failMs: 180_000, sameR: 2, timeoutN: 4, timeoutMs: 180_000, timeoutMinMs: 2000, releaseMs: 120_000, releaseR: 3, hitsMs: 10 * 60_000, passMaxMs: 60_000 })
/** THE SWITCH: CLEANZONE=off|0|false|no -> not installed. On by default. Pure. */
export const cleanZoneOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.CLEANZONE ?? '').trim())

const fin = v => typeof v === 'number' && Number.isFinite(v)
/**
 * THE ZONE -> { hx, hy, hz, R, yMin } | null (no home: no zone, nothing is removed -- it FAILS OPEN, on purpose: the bot plans
 * exactly as the base). The numbers are placeaudit.mjs's, never a copy of them. Pure.
 */
export function cleanZoneOf (home) {
  const h = homeOf(home)
  if (!h) return null
  return { hx: Math.floor(h.x), hy: Math.floor(h.y), hz: Math.floor(h.z), R: PLACE_TOWN_R + PLACE_MARGIN, yMin: Math.floor(h.y) - PLACE_TOWN_DEPTH }
}
/** Is the integer cell in the zone? Pure; a few comparisons (the A* step's hot path: no allocation). */
export function inCleanZone (zone, x, y, z) {
  if (!zone || !fin(x) || !fin(y) || !fin(z) || y < zone.yMin) return false
  return Math.abs(x - zone.hx) <= zone.R && Math.abs(z - zone.hz) <= zone.R
}
/**
 * Does a neighbour's `toPlace` put a block in the zone? -> bool. Pure. mineflayer-pathfinder's Move.toPlace entry
 * { x, y, z, dx, dy, dz } is the reference block and the face: the block lands at ref + face, or IN the reference cell when that
 * cell is still replaceable at execution (lidplace.mjs: the Paper finding). Either one in the zone counts: a route is refused at
 * the zone's edge rather than let through. A `useOne` entry places nothing.
 */
export function landsInZone (toPlace, zone) {
  if (!zone || !Array.isArray(toPlace)) return false
  for (const p of toPlace) {
    if (!p || p.useOne) continue
    if (inCleanZone(zone, p.x + (p.dx ?? 0), p.y + (p.dy ?? 0), p.z + (p.dz ?? 0)) || inCleanZone(zone, p.x, p.y, p.z)) return true
  }
  return false
}
const cellOf = p => (p && fin(Number(p.x)) && fin(Number(p.y)) && fin(Number(p.z))) ? [Math.floor(Number(p.x)), Math.floor(Number(p.y)), Math.floor(Number(p.z))] : null
/** Two cells within r of each other on every axis? Pure. */
export const nearCell = (a, b, r) => Array.isArray(a) && Array.isArray(b) && Math.abs(a[0] - b[0]) <= r && Math.abs(a[1] - b[1]) <= r && Math.abs(a[2] - b[2]) <= r
const AROUND = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 2], [0, 0, -2], [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1]]
/** Does a search for `goal` end on cell `c` and on none of the cells around it? Pure over the goal's own isEnd. A goal that
 *  throws, or has no isEnd, ends nowhere we can vouch for. */
export function endsOnlyAt (goal, c) {
  try {
    if (typeof goal?.isEnd !== 'function' || !Array.isArray(c)) return false
    if (goal.isEnd({ x: c[0], y: c[1], z: c[2] }) !== true) return false
    for (const [dx, dy, dz] of AROUND) if (goal.isEnd({ x: c[0] + dx, y: c[1] + dy, z: c[2] + dz })) return false
    return true
  } catch { return false }
}
const goalText = (goal) => {
  const at = (goal?.pos && typeof goal.pos === 'object') ? goal.pos : goal
  const c = cellOf(at)
  return `${goal?.constructor?.name ?? 'Goal'}@${c ? c.join(',') : '-'}`
}

/**
 * THE BAN index.mjs installs -> an object with `drops(toPlace)` (the A* step's question), the search scope (`begin` / `settle`)
 * and its counters. `zone()` returns the current cleanZoneOf (computed once by the caller: never a read in the A* step); `now()`
 * is a monotonic clock in ms; `emit(detail)` writes a `_cleanzone` row (never throws into a search).
 * Counters: vetoed (neighbours removed), searches, touched (finished searches the ban removed something from), failed (touched
 * AND ended timeout / noPath), releases (the valve opened), freed (searches that ran with the ban lifted).
 */
export function makeCleanZone ({ zone = () => null, on = true, now = () => Date.now(), emit = null, T = CLEAN_ZONE } = {}) {
  const cz = { on, T, cur: null, vetoed: 0, searches: 0, touched: 0, failed: 0, releases: 0, freed: 0, lastFail: null, timeouts: [], release: null, pass: null, passes: 0, passed: 0 }
  /** Is the ban lifted for a search starting at `start` right now? */
  cz.freeAt = (start, t = now()) => !!(cz.release && cz.release.until > t && nearCell(cz.release.at, start, T.releaseR))
  /**
   * WELLSTEP-01: ONE GOAL'S PASS. A skill that must stand on ONE town cell (the junk well's stand) and has just failed to walk
   * there asks for the ban to be lifted for searches TO THAT CELL only, for at most T.passMaxMs: the walk may then lay the step
   * the ground lost. Every other search stays banned while the pass is held. -> granted?
   */
  cz.permit = (cell, ms, t = now()) => {
    const c = cellOf(cell)
    const max = Number(T.passMaxMs) || 60_000
    if (!on || !c || !(Number(ms) > 0)) return false
    cz.pass = { at: c, until: t + Math.min(Number(ms), max) }
    cz.passes++
    try { emit?.(`op=pass goal=${c.join(',')} ms=${Math.min(Number(ms), max)}`) } catch { /* a row never breaks a walk */ }
    return true
  }
  cz.revoke = () => { cz.pass = null }
  /** Is the pass still good, and does this search END ONLY ON the cell it names? (Codex r1: a GoalNear or GoalFollow with the
   *  same coordinates ends elsewhere and gets no pass -- the goal's own isEnd is asked, never its fields.) */
  cz.passFor = (goal, t = now()) => {
    const p = cz.pass
    if (!p || !(p.until > t)) return false
    return endsOnlyAt(goal, p.at)
  }
  /** THE A* STEP: is this neighbour removed? */
  cz.drops = (toPlace) => {
    if (!on) return false
    const s = cz.cur
    if (s && s.free) return false
    if (!landsInZone(toPlace, zone())) return false
    cz.vetoed++
    if (s) s.vetoed++
    return true
  }
  /** A search starts -> its scope { start, capped, free, vetoed, done }. */
  cz.begin = ({ start = null, goal = null, radius = -1, timeout = null } = {}) => {
    const st = cellOf(start)
    cz.searches++
    const pass = on && cz.passFor(goal)
    if (pass) cz.passed++
    return { start: st, goal, capped: fin(radius) && radius >= 0, short: fin(timeout) && timeout < T.timeoutMinMs, free: pass || (on && !!st && cz.freeAt(st)), pass, vetoed: 0, done: false }
  }
  const open = (at, why, s, t) => {
    cz.release = { at, until: t + T.releaseMs }
    cz.lastFail = null; cz.timeouts = []
    cz.releases++
    try { emit?.(`op=release why=${why} pos=${at.join(',')} goal=${goalText(s.goal)} ms=${T.releaseMs} r=${T.releaseR}`) } catch { /* a row never breaks a search */ }
  }
  /** A search slice returned `result` -> count it once, when it is final; open the valve when the ban left the bot no way. */
  cz.settle = (s, result) => {
    if (!s || s.done || !result || result.status === 'partial') return
    s.done = true
    if (s.free) { cz.freed++; return }
    if (!(s.vetoed > 0)) return
    cz.touched++
    const status = result.status
    if (status !== 'noPath' && status !== 'timeout') return
    cz.failed++
    if (s.capped || !s.start) return
    const t = now()
    if (status === 'noPath') {
      const f = cz.lastFail
      const same = !!(f && f.until > t && nearCell(f.at, s.start, T.sameR))
      const n = same ? f.n + 1 : 1
      cz.lastFail = { at: same ? f.at : s.start, n, until: t + T.failMs }
      if (n >= T.failN) open(cz.lastFail.at, 'no_path', s, t)
      return
    }
    if (s.short) return
    cz.timeouts = cz.timeouts.filter(u => u > t - T.timeoutMs)
    cz.timeouts.push(t)
    if (cz.timeouts.length >= T.timeoutN) open(s.start, 'timeouts', s, t)
  }
  return cz
}

/**
 * INSTALL THE BAN on a Movements: an OWN getNeighbors that asks the one it had first and then removes the neighbours the ban
 * drops -- unless the profile SEARCHED says `cleanZone === false`. A plain function, never bound: index.mjs derives every other
 * profile with Object.create(proto) + Object.assign, which copies this property and the flag, and `this` is the derived profile.
 * The array the library returned is handed back untouched when nothing is removed. Idempotent. -> the movements.
 */
export function installCleanZoneFilter (movements, cz) {
  if (!movements || movements.__cleanZoneFilter || typeof cz?.drops !== 'function') return movements
  const inner = movements.getNeighbors
  movements.getNeighbors = function (node) {
    const ns = inner.call(this, node)
    if (this.cleanZone === false) return ns
    let out = null
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i]
      if (n?.toPlace?.length && cz.drops(n.toPlace)) { if (!out) out = ns.slice(0, i) } else if (out) out.push(n)
    }
    return out ?? ns
  }
  movements.__cleanZoneFilter = true
  movements.cleanZone = true
  return movements
}

/**
 * THE SEARCH SCOPE: wrap pathfinder.getPathFromTo so each search carries its own scope -- where it started, what the ban removed
 * from it, whether the valve freed it -- while ITS compute runs, including every continuation the monitor makes through the
 * yielded astarContext (scaftown.mjs installScafTownSearch's pattern; the two wrappers nest). The caller's generator protocol
 * is unchanged: the same values, yielded in the same order. Idempotent. -> the pathfinder.
 */
export function installCleanZoneSearch (pathfinder, cz) {
  if (!pathfinder || pathfinder.__cleanZoneSearch || typeof pathfinder.getPathFromTo !== 'function' || typeof cz?.begin !== 'function') return pathfinder
  const orig = pathfinder.getPathFromTo
  const scoped = (s, fn) => { const prev = cz.cur; cz.cur = s; try { return fn() } finally { cz.cur = prev } }
  const wrapCompute = (ctx, s) => {
    if (!ctx || typeof ctx.compute !== 'function' || ctx.__cleanZone) return
    const oc = ctx.compute
    ctx.compute = function () {
      return scoped(s, () => {
        const r = oc.call(this)
        try { cz.settle(s, r) } catch { /* a counter never breaks a search */ }
        return r
      })
    }
    ctx.__cleanZone = true
  }
  pathfinder.getPathFromTo = function * (movements, startPos, goal, options = {}) {
    const radius = options?.searchRadius ?? pathfinder.searchRadius
    // an exempt profile's search is not the ban's business: it neither counts toward the valve nor uses it
    const s = movements?.cleanZone === false ? null : cz.begin({ start: startPos, goal, radius, timeout: options?.timeout })
    const g = orig.call(this, movements, startPos, goal, options)
    let step = scoped(s, () => g.next())
    while (!step.done) {
      const v = step.value
      try { if (s && v?.astarContext) wrapCompute(v.astarContext, s); cz.settle(s, v?.result) } catch { /* counters only */ }
      yield v
      step = scoped(s, () => g.next())
    }
    return step.value
  }
  pathfinder.__cleanZoneSearch = true
  return pathfinder
}

/** THE POSITIVE CONTROL (`_cleanzone_hits`, every hitsMs): the counters since the last row and in total. Pure. */
export function cleanZoneHitsDetail (c, prev = {}) {
  const d = k => (c?.[k] ?? 0) - (prev?.[k] ?? 0)
  return `vetoed=${d('vetoed')} searches=${d('searches')} touched=${d('touched')} failed=${d('failed')} releases=${d('releases')} freed=${d('freed')} total_vetoed=${c?.vetoed ?? 0} total_releases=${c?.releases ?? 0} passes=${d('passes')} passed=${d('passed')}`
}
/** The counters to diff against next time. Pure. */
export const cleanZoneSnap = c => ({ vetoed: c?.vetoed ?? 0, searches: c?.searches ?? 0, touched: c?.touched ?? 0, failed: c?.failed ?? 0, releases: c?.releases ?? 0, freed: c?.freed ?? 0, passes: c?.passes ?? 0, passed: c?.passed ?? 0 })
/** The licence row (`_cleanzone_mode`, once per spawn). Pure. */
export const cleanZoneModeDetail = (env = process.env, zone = null, T = CLEAN_ZONE) =>
  `on=${cleanZoneOn(env) ? 1 : 0} r=${zone?.R ?? '-'} y_min=${zone?.yMin ?? '-'} home=${zone ? `${zone.hx},${zone.hy},${zone.hz}` : '-'} fail_n=${T.failN} fail_ms=${T.failMs} timeout_n=${T.timeoutN} timeout_ms=${T.timeoutMs} timeout_min_ms=${T.timeoutMinMs} release_ms=${T.releaseMs} release_r=${T.releaseR}`

// ---- CLEANZONE-02: NO GATHERING OF THE GROUND INSIDE THE ZONE ---------------------------------------------------------------
//
// WHY (owner 11-13, after the first hour of the ban: "Yes, build it"). The ban stops a WALK from leaving blocks; it does not
// stop a bot choosing `gather dirt` where it stands. The first hour's valve rows: 7 of 32 releases at one pit near 17,32,
// where two bots were gathering dirt at y 52-59 inside the town, digging the pit deeper and then needing the valve to get out.
// townground.mjs already keeps the town's ground from gather -- but its box is 16 blocks around home, sized for the junk
// well on the fleet's towns, and the showcase town reaches 45 from home with its margin at 64.
//
// WHAT: a gather TARGET that is terrain (townground.mjs TERRAIN less its ores: dirt, grass, sand, gravel, stone and its kin
// -- never a log, a leaf, a crop or an ore) inside the zone's square is not taken, AT ANY DEPTH: a floor on the rule would only make
// the nearest eligible dirt the one straight down, which is the pit again. ONE EXCEPTION: a bot that is itself below the
// band (feet under home.y - deep: it is in the mine) may take terrain that is also below it -- the rock around it.
//
// THE REMEDY IS PERFORMED, NOT ADVISED (skills.mjs gatherRun): when the rule emptied the search, gather walks to the nearest
// point `out` blocks beyond the zone's edge (gatherExitPoints, nearest first, never across the town) and searches again
// from there. Only when no exit is reached does it fail, and then it names the exit a `goto` can be given.
// A BOT THAT CANNOT LEAVE WHERE IT STANDS KEEPS ITS WAY OUT (Codex review 11-13, a blocker: a bot with no scaffold in a
// shallow pit inside the zone must gather the dirt beside it to climb -- climbPrerequisite demands it -- and the ban on
// placing means it cannot walk out either). When the walk to an exit did not move the bot (mineflayer-pathfinder's goto
// RESOLVES on an empty path, and rejects `NoPath` otherwise: both are "no route starts here", and so is a walk that spent
// its whole budget without moving; a changed goal is not), the rule is lifted for at most trapMax cells within trapR of that spot for trapMs. Written `op=trapped`.
// GATHERZONE=off -> gather is exactly the base's.
export const GATHER_ZONE = Object.freeze({ deep: 24, out: 6, walkMs: 25_000, exits: 2, trapR: 3, trapMax: 8, trapMs: 90_000, trapMove: 2, climbTries: 2 })
// ORES STAY AS THEY ARE (townground.mjs counts `_ore` as terrain; this rule does not): iron and coal are reached by the ore
// tunnel, which has its own price on the town's ground, and the pits this rule is for were dug for dirt.
const ORE = /_ore$/
/** THE SWITCH: GATHERZONE=off|0|false|no -> off. On by default. Pure. */
export const gatherZoneOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.GATHERZONE ?? '').trim())
/** Is the column inside the zone's square, whatever its height? Pure. */
export const inZoneSquare = (zone, x, z) => !!zone && fin(x) && fin(z) && Math.abs(Math.floor(x) - zone.hx) <= zone.R && Math.abs(Math.floor(z) - zone.hz) <= zone.R
/**
 * May gather NOT take this cell? -> bool. Pure. `feetY` is the bot's own height (unknown: the exception does not apply).
 * No zone (no home) -> false: it FAILS OPEN, the bot gathers exactly as the base.
 */
export function gatherZoneRefuses (zone, p, blockName, feetY = null, T = GATHER_ZONE) {
  if (!zone || !p || !isTerrain(blockName) || ORE.test(blockName) || !inZoneSquare(zone, p.x, p.z)) return false
  const deepY = zone.hy - T.deep
  if (fin(feetY) && feetY < deepY && fin(p.y) && p.y < deepY) return false
  return true
}
/**
 * WHERE TO WALK so the next search starts beyond the zone -> [{ x, z }], nearest first. Pure. The four points `out` blocks
 * past the square's edge at the bot's own coordinate on the other axis; a bot already beyond the square on an axis is never
 * sent to the far side of town along it (townground.mjs walkOutPoints' rule). Empty when there is no zone or no position.
 */
export function gatherExitPoints (from, zone, T = GATHER_ZONE) {
  if (!zone || !from || !fin(Number(from.x)) || !fin(Number(from.z))) return []
  const x = Math.floor(Number(from.x)), z = Math.floor(Number(from.z)), R = zone.R + T.out
  const outX = Math.abs(x - zone.hx) > zone.R ? Math.sign(x - zone.hx) : 0, outZ = Math.abs(z - zone.hz) > zone.R ? Math.sign(z - zone.hz) : 0
  return [
    { d: (zone.hx + R) - x, x: zone.hx + R, z, sx: 1, sz: 0 }, { d: x - (zone.hx - R), x: zone.hx - R, z, sx: -1, sz: 0 },
    { d: (zone.hz + R) - z, x, z: zone.hz + R, sx: 0, sz: 1 }, { d: z - (zone.hz - R), x, z: zone.hz - R, sx: 0, sz: -1 },
  ].filter(o => o.d >= 0 && !(outX && o.sx === -outX) && !(outZ && o.sz === -outZ)).sort((a, b) => a.d - b.d).map(({ x, z }) => ({ x, z }))
}
/** Did the walk to an exit leave the bot where it was, with no route starting there? -> bool. Pure. `err` is what the walk
 *  rejected with (null: it resolved); `from` / `at` the bot's cell before and after. */
export function gatherWalkTrapped (from, at, err = null, T = GATHER_ZONE) {
  if (!from || !at) return false
  // ... or the walk ran out its WHOLE budget without moving (cleanzone-03, measured on the showcase 11-13 16:31-16:57Z: Iris
  // stood at -33,64,-28; her searches never drained -- a large enclosed space times out, it does not answer NoPath -- so
  // each 25-s walk ended on skills.mjs withTimeout's budget, the trap never fired, and gather -> two walks -> refused ran
  // nine times in 26 minutes; 16 of the hour's 17 failed walk-outs were hers, while the bots that could move covered 46-55
  // blocks inside the same budget). A changed goal is still not a trap: something else took the walk.
  if (err && err.name !== 'NoPath' && err.budgetExceeded !== true) return false
  return Math.abs(at.x - from.x) < T.trapMove && Math.abs(at.z - from.z) < T.trapMove
}
/** The trap a walk found -> { at: [x, y, z], until, left }. Pure. */
export const gatherTrapOf = (at, now, T = GATHER_ZONE) => ({ at: [at.x, at.y, at.z], until: now + T.trapMs, left: T.trapMax })
/** Does a live trap let gather take this cell? -> bool. Pure: in time, cells left, within trapR of the spot on every axis. */
export function gatherTrapAllows (trap, p, now, T = GATHER_ZONE) {
  return !!trap && !!p && trap.until > now && trap.left > 0 && nearCell([p.x, p.y, p.z], trap.at, T.trapR)
}
/** What the refusal says when no exit was reached: where the ground may be taken, as a place a `goto` can be given. Pure. */
export function gatherZoneRemedy (zone, exit = null) {
  const where = exit ? `goto ${exit.x} ${zone?.hy ?? 70} ${exit.z} and gather there` : `gather more than ${zone?.R ?? '?'} blocks from home`
  return `the town's ground is kept within ${zone?.R ?? '?'} blocks of home (dirt, sand, gravel and stone are not taken there): ${where}`
}
/** The `_gather_zone` licence detail (once per bot process). Pure. */
export const gatherZoneModeDetail = (env = process.env, zone = null, T = GATHER_ZONE) =>
  `op=mode on=${gatherZoneOn(env) ? 1 : 0} r=${zone?.R ?? '-'} deep_y=${zone ? zone.hy - T.deep : '-'} out=${T.out} walk_ms=${T.walkMs} exits=${T.exits} trap_r=${T.trapR} trap_max=${T.trapMax}`

// ---- WELLSTEP-01: THE JUNK WELL'S STAND IS REACHED AGAIN -------------------------------------------------------------------
//
// WHY (LIVE showcase 11-13, 14 bots): dispose_well 0 successes of 124 from 18:12Z (8-15 an hour for the 19 h before; all 210
// successes stood at 12,74,6). At 18:12:01Z a tidy visit cut 7,69,4, the one-block step of the only walk up to the stand; the
// first rise became two blocks. The same cut on 11-12 17:48Z healed in 12 minutes: a walk laid a dirt step there (`_takeback
// outcome=adopted shape=step`). Today the ban above forbids that placement, and the valve does not help a one-shot walk
// (`op=release goal=GoalBlock@12,74,6` fired twice; the order had already ended). Two correct rules composed into a dead end:
// bags stop emptying, and the town visit's order is spent on a throw that cannot happen (build orders 148 -> 63 per 2 h).
// THE REMEDY IS PERFORMED, by the order itself: the walk to the stand that failed is tried ONCE more with a pass for that one
// goal (makeCleanZone permit). Whatever it lays is recorded as every pathfinder placement is (`_place_town`), and the take-back
// keeps a step that is walked on and removes the rest. Switch: WELLSTEP=off.
export const WELL_STEP = Object.freeze({ nearR: 16, below: 12, minBlocks: 1 })
export const wellStepOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.WELLSTEP ?? '').trim())
/**
 * MAY THE FAILED WALK TO THE STAND BE TRIED AGAIN WITH A PASS? -> { go, why }. Pure.
 * `off` the switch; `no_ban` the ban is not installed or off (the first walk could already place: a second changes nothing);
 * `far` the bot is not at the well (more than nearR beside it or more than `below` under it: wellcare's hold is that case's);
 * `no_blocks` nothing in the bag the walk could lay.
 */
export function wellStepDecision ({ on = true, ban = false, feet = null, stand = null, held = 0, T = WELL_STEP } = {}) {
  if (!on) return { go: false, why: 'off' }
  if (!ban) return { go: false, why: 'no_ban' }
  const f = cellOf(feet), s = cellOf(stand)
  if (!f || !s) return { go: false, why: 'far' }
  if (Math.max(Math.abs(f[0] - s[0]), Math.abs(f[2] - s[2])) > T.nearR || s[1] - f[1] > T.below) return { go: false, why: 'far' }
  if (!(held >= T.minBlocks)) return { go: false, why: 'no_blocks' }
  return { go: true, why: 'unreachable' }
}
/**
 * RUN ONE WALK UNDER A PASS -> { ran, err }. The pass is revoked however the walk ends (a throw, an abort): a pass never
 * outlives its walk. `walk()` is the caller's bounded goto; its error is handed back for the caller's own rules (an abort is
 * rethrown there). `halt()` is called when the walk THREW, before the pass goes (Codex r1: mineflayer-pathfinder 2.4.5 rejects
 * goto on noPath / timeout and keeps walking the partial path it found -- a route planned under the pass must not go on being
 * walked, and laid, after it).
 */
export async function permittedWalk (cz, cell, ms, walk, halt = null) {
  if (typeof cz?.permit !== 'function' || !cz.permit(cell, ms)) return { ran: false, err: null }
  try { await walk(); return { ran: true, err: null } } catch (err) { try { halt?.() } catch { /* the halt never hides the walk's error */ } return { ran: true, err } } finally { cz.revoke() }
}
/**
 * ONE WALK, LISTENED TO THE END -> a promise: resolved when the pathfinder says `goal_reached`, rejected by name (NoPath,
 * Timeout, GoalChanged, PathStopped) when it gives up. `start()` is the caller's own `bot.pathfinder.setGoal(goal)` (the steering
 * stays in the caller's file).
 * WHY NOT THE LIBRARY'S goto (LIVE 11-14 00:51-00:55Z, the first four climbs of this piece: `reached=0 ms=198..295`, no error,
 * no search row): mineflayer-pathfinder 2.4.5 goto.js resolves on ANY `path_update` whose path is empty, whatever its status.
 * A bot standing under the stand is already on the cell the heuristic likes best, so the search's first 40-ms slice answers
 * `partial` with an empty path -- and goto says done a quarter of a second in, with the real search barely begun. Here a
 * `partial` is waited through; a `timeout` (the 5-s think budget: the pathfinder walks the part it found and searches again)
 * is waited through `maxTimeouts` times; `noPath` is final.
 */
export function walkToGoal (bot, goal, start, { maxTimeouts = 2 } = {}) {
  const err = (name, message) => Object.assign(new Error(message), { name })
  return new Promise((resolve, reject) => {
    let timeouts = 0, done = false
    const end = (e) => {
      if (done) return
      done = true
      bot.removeListener('goal_reached', onReached); bot.removeListener('path_update', onUpdate)
      bot.removeListener('goal_updated', onGoal); bot.removeListener('path_stop', onStop)
      setTimeout(() => (e ? reject(e) : resolve()), 0)
    }
    const onReached = () => end()
    const onUpdate = (r) => {
      if (r?.status === 'noPath') return end(err('NoPath', 'No path to the goal!'))
      if (r?.status === 'timeout' && ++timeouts > maxTimeouts) return end(err('Timeout', 'Took to long to decide path to goal!'))
    }
    const onGoal = (g) => { if (g !== goal) end(err('GoalChanged', 'The goal was changed before it could be completed!')) }
    const onStop = () => end(err('PathStopped', 'Path was stopped before it could be completed! Thus, the desired goal was not reached.'))
    bot.on('goal_reached', onReached); bot.on('path_update', onUpdate); bot.on('goal_updated', onGoal); bot.on('path_stop', onStop)
    try { start() } catch (e) { end(e) }
  })
}
/** What the refusal adds when the step could not be laid: a move the bot can make from the well's foot. Pure. */
export const wellStepRemedy = why => (why === 'no_blocks'
  ? ' -- the walk up has lost a step and the bag holds no dirt or cobblestone to lay it: take a few from the town chests (withdraw), and the next visit lays the step'
  : '')
/** The `_well_step` row. Pure. */
export const wellStepDetail = ({ op, why = '-', stand = null, from = null, held = 0, reached = null, ms = null, err = null }) =>
  `op=${op} why=${why} stand=${stand ? `${stand.x},${stand.y},${stand.z}` : '-'} from=${from ? from.join(',') : '-'} held=${held}${reached == null ? '' : ` reached=${reached ? 1 : 0}`}${ms == null ? '' : ` ms=${ms}`}${err ? ` err=${String(err).replace(/\s+/g, '_').slice(0, 60)}` : ''}`
export const wellStepModeDetail = (env = process.env, T = WELL_STEP) => `op=mode on=${wellStepOn(env) ? 1 : 0} near_r=${T.nearR} below=${T.below} min_blocks=${T.minBlocks} pass_max_ms=${CLEAN_ZONE.passMaxMs}`
