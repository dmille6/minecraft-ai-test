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
export const CLEAN_ZONE = Object.freeze({ failN: 2, failMs: 180_000, sameR: 2, timeoutN: 4, timeoutMs: 180_000, timeoutMinMs: 2000, releaseMs: 120_000, releaseR: 3, hitsMs: 10 * 60_000 })
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
  const cz = { on, T, cur: null, vetoed: 0, searches: 0, touched: 0, failed: 0, releases: 0, freed: 0, lastFail: null, timeouts: [], release: null }
  /** Is the ban lifted for a search starting at `start` right now? */
  cz.freeAt = (start, t = now()) => !!(cz.release && cz.release.until > t && nearCell(cz.release.at, start, T.releaseR))
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
    return { start: st, goal, capped: fin(radius) && radius >= 0, short: fin(timeout) && timeout < T.timeoutMinMs, free: on && !!st && cz.freeAt(st), vetoed: 0, done: false }
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
  return `vetoed=${d('vetoed')} searches=${d('searches')} touched=${d('touched')} failed=${d('failed')} releases=${d('releases')} freed=${d('freed')} total_vetoed=${c?.vetoed ?? 0} total_releases=${c?.releases ?? 0}`
}
/** The counters to diff against next time. Pure. */
export const cleanZoneSnap = c => ({ vetoed: c?.vetoed ?? 0, searches: c?.searches ?? 0, touched: c?.touched ?? 0, failed: c?.failed ?? 0, releases: c?.releases ?? 0, freed: c?.freed ?? 0 })
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
// RESOLVES on an empty path, and rejects `NoPath` otherwise: both are "no route starts here"; a changed goal or a timeout
// is neither), the rule is lifted for at most trapMax cells within trapR of that spot for trapMs. Written `op=trapped`.
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
  if (err && err.name !== 'NoPath') return false
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
