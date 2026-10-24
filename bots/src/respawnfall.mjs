// RESPAWNFALL-01: A BOT THAT (RE)SPAWNS ON A HIGH PLATFORM CLIMBS DOWN INSTEAD OF WALKING OFF IT
// (docs/reports/respawnfall-01-design-2026-10-24.md). Pure: no bot. `at(x, y, z)` reads a block ({name, boundingBox, shapes?}
// or null for an unloaded cell).
//
// THE CASE (measured 7 d to 10-24): isolated-a's backup holds a bot-built structure over spawn -- 1,118 cells, 503 at y=180
// and 290 at y=125 (cobblestone, logs, dirt; 1-wide bridges and a gappy column at 354,148) -- and the world respawns a dead
// bot on the highest block of a random column within 10 of (355,147): 174 of those 441 columns are the platform.
// isolated-a-Comet died 11 times in a week falling off it (46-118 blocks), a respawn loop. The pathfinder walks the bridges
// and the bot falls; nothing makes it come DOWN.
//
// TWO TESTS, DELIBERATELY DIFFERENT (Codex r1 P1-2):
//   TRIGGER (elevation)   a deadly drop: ELEVATED_MIN open cells under the support, or that drop on EDGE_SIDES of its four
//                         sides. Only a bot within SPAWN_WINDOW_MS of a spawn starts an episode.
//   DONE (doneAt)         a SAFE stance: at most SAFE_DROP - 1 open under the support (breaking it is a fall of <= 3), and
//                         every open side a step of <= SAFE_DROP (or into water). An episode runs until DONE, window or not,
//                         and an unreadable cell never ends it (Codex r1 P1-6, Claude r1 P2-2).
// THE WAY DOWN: skills.mjs rideFloorDown, the existing primitive that places a block under its own floor and breaks the
// floor (a one-block drop each step; free where a column is already there), from the cheapest reachable column within
// START_RADIUS (rankStarts), priced by simulating it (descentCost). One carried block per open cell to bridge; a bot that
// carries too few writes `_needs_rescue` and STAYS -- the owner's choice over walking off.
export const ELEVATED_MIN = 8          // a fall of >= 8 onto rock costs >= 5 hp, and kills onto a stalagmite tip
export const SAFE_DROP = 3             // vanilla: fall damage = ceil(d - 3); Baritone's maxFallHeightNoWater is 3 too
export const SCAN = 400                // the build limit is 320 above -64: read the whole column
export const SPAWN_WINDOW_MS = 10 * 60 * 1000
export const MARGIN = 2                // blocks kept in hand beyond a non-zero count (a mistimed placement retries)
// A COLUMN STANDING IN THE AIR, NOT A CLIFF TOP: the side trigger needs this many of the four sides to be deadly drops. A
// pillar (alone, or inside a deck whose cells are over the void) has four; a natural cliff edge has one, a corner two -- a
// bot that spawns beside a ravine is not on a platform and must not dig itself a shaft beside it.
export const EDGE_SIDES = 3
export const START_RADIUS = 8
export const SAVE_MIN = 4              // another column must save this many blocks over the own one (a deck walk has its own risk)
export const SPAWN_GRACE_MS = 3000     // no floor dig in the first 3 s after a spawn: the server drops them (ghost blocks, 09-29)

/**
 * THE ESCAPE LATTICE STANDS ASIDE WHILE sky_descend OWNS THE EPISODE (Codex r1 P1-3, Claude r1 P2-4): a bot held for
 * rescue (bot.skyHoldUntil, the stay and every run) or inside an active episode (bot.skyActive, cognitive.mjs) gets none of
 * the marooned rungs -- not step_off (the walk-off), not dig_down (priced by health, not by SAFE_DROP), not climb (back up
 * its own column). reflex.mjs asks this at the maroon check and the last-resort branch. Pure.
 */
export const skyEscapeBlocked = (bot, now = Date.now()) => (bot?.skyHoldUntil ?? 0) > now || bot?.skyActive === true
/** Kept for the row and the tests: the hold alone. */
export const skyHoldActive = (bot, now = Date.now()) => (bot?.skyHoldUntil ?? 0) > now

/** RESPAWNFALL=0 turns the order off (the one-setting rollback); anything else, or unset, leaves it on. */
export const respawnfallOn = (env = typeof process !== 'undefined' ? process.env : {}) => String(env?.RESPAWNFALL ?? '1') !== '0'

const LIQ = /^(water|flowing_water|bubble_column|lava|flowing_lava)$/
const kind = b => {
  if (b == null) return 'unknown'
  const n = String(b.name ?? '')
  if (/lava/.test(n)) return 'lava'
  if (LIQ.test(n) || /^(kelp|kelp_plant|seagrass|tall_seagrass)$/.test(n)) return 'water'
  return b.boundingBox === 'block' ? 'solid' : 'open'
}
/**
 * A FULL CUBE: the only support the descent rides (Codex r1 P2-9). rideFloorDown reads its floor at feet - 1, which on a
 * bottom slab is the cell UNDER the slab; a stance on a slab, stair, path or farmland is walked off first (rankStarts never
 * offers one). A block without `shapes` (the tests' fakes) is a cube.
 */
export const fullCube = b => {
  if (kind(b) !== 'solid') return false
  const sh = b.shapes
  if (!Array.isArray(sh)) return true
  return sh.length === 1 && sh[0].length === 6 && sh[0][0] === 0 && sh[0][1] === 0 && sh[0][2] === 0 && sh[0][3] === 1 && sh[0][4] === 1 && sh[0][5] === 1
}

/** The support cell under a body whose feet are at `pos`: feet 181.0 stand on y=180, a slab's 180.5 on y=180 too. */
export const supportOf = pos => ({ x: Math.floor(pos.x), y: Math.floor(pos.y - 1e-3), z: Math.floor(pos.z) })

/**
 * The column under the support cell: {open, landing, landY}. `open` counts the open cells straight down before the first
 * non-open one; landing is what that cell is ('solid', 'water', 'lava', 'unknown'), or 'deep' if nothing within SCAN.
 * Pure; never throws (a throwing reader reads as unknown).
 */
export function columnUnder (at, s, { scan = SCAN } = {}) {
  let open = 0
  for (let y = s.y - 1; y >= s.y - scan; y--) {
    let b
    try { b = at(s.x, y, s.z) } catch { b = null }
    const k = kind(b)
    if (k === 'open') { open++; continue }
    return { open, landing: k, landY: y }
  }
  return { open, landing: 'deep', landY: null }
}

/**
 * A memoised reader for pricing many columns at once: kindAt(x, y, z) reads each cell once, run(x, y, z) is the open run
 * from y DOWN (0 when y itself is not open) with its landing kind, computed once per cell, block(x, y, z) the raw block.
 */
export function columnReader (at, { scan = SCAN } = {}) {
  const blocks = new Map(), runs = new Map()
  const block = (x, y, z) => {
    const k = `${x},${y},${z}`
    if (!blocks.has(k)) { let b; try { b = at(x, y, z) } catch { b = null } blocks.set(k, b ?? null) }
    return blocks.get(k)
  }
  const kindAt = (x, y, z) => kind(block(x, y, z))
  const run = (x, y0, z) => {
    const path = []
    let y = y0, base
    for (;;) {
      const k = `${x},${y},${z}`
      if (runs.has(k)) { base = runs.get(k); break }
      const kd = kindAt(x, y, z)
      if (kd !== 'open') { base = { open: 0, landing: kd, landY: y }; runs.set(k, base); break }
      if (y0 - y >= scan) { base = { open: 0, landing: 'deep', landY: null }; break }
      path.push(k); y--
    }
    for (let i = path.length - 1; i >= 0; i--) { base = { open: base.open + 1, landing: base.landing, landY: base.landY }; runs.set(path[i], base) }
    return base
  }
  return { block, kindAt, run }
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]
/** A side's drop for a body stepping off support level y: from the side cell itself when open, else from under it. */
const sideRun = (R, x, y, z) => (R.kindAt(x, y, z) === 'open' ? R.run(x, y, z) : R.run(x, y - 1, z))

/**
 * THE TRIGGER at support (x, y, z) on reader R: {exposed, own, sides, blind} or null when its own column is unreadable.
 * Exposed: its own run >= ELEVATED_MIN onto anything but water, or >= EDGE_SIDES sides whose drop is >= ELEVATED_MIN onto
 * anything but water. A water landing under the own column does NOT end the side test (Codex r1 P1-7).
 */
function exposedAt (R, x, y, z) {
  const own = R.run(x, y - 1, z)
  if (own.landing === 'unknown') return null
  if (own.landing !== 'water' && own.open >= ELEVATED_MIN) return { exposed: true, own, sides: 0, blind: false }
  let blind = false, sides = 0
  for (const [dx, dz] of SIDES) {
    if (R.kindAt(x + dx, y, z + dz) === 'unknown') { blind = true; continue }
    const r = sideRun(R, x + dx, y, z + dz)
    if (r.landing === 'unknown') { blind = true; continue }
    if (r.landing !== 'water' && r.open >= ELEVATED_MIN) sides++
  }
  return { exposed: sides >= EDGE_SIDES, own, sides, blind }
}

/**
 * DONE at support (x, y, z): {done, unknown, why}. A safe stance: at most SAFE_DROP - 1 open under the support or water
 * under it (so even breaking it is a fall of <= SAFE_DROP), NO side a deadly drop (>= ELEVATED_MIN onto anything but
 * water), and at least one SAFE EXIT -- a side a body can step into (feet and head cells open) whose drop is <= SAFE_DROP
 * or water (a flat step onto a block counts that block's own column: a step onto a deck cell is still on the platform) -- unless every side is a wall (enclosed: the entombed reflex's case, not a platform's). A side
 * dropping 4..7 beside a safe exit is ordinary terrain: the pathfinder takes such a drop only as a planned one (maxDropDown
 * 6). An unreadable cell is unknown, never done. Pure.
 */
export function doneAt (R, x, y, z) {
  const own = R.run(x, y - 1, z)
  if (own.landing === 'unknown') return { done: false, unknown: true, why: 'the column below is not loaded' }
  if (!(own.open <= SAFE_DROP - 1 || own.landing === 'water')) return { done: false, unknown: false, why: `${own.open} open below` }
  let exits = 0, walls = 0
  for (const [dx, dz] of SIDES) {
    const f = R.kindAt(x + dx, y + 1, z + dz), h = R.kindAt(x + dx, y + 2, z + dz), sk = R.kindAt(x + dx, y, z + dz)
    if (f === 'unknown' || h === 'unknown' || sk === 'unknown') return { done: false, unknown: true, why: 'a side is not loaded' }
    // the side's drop: from the side cell when it is open; under it when it is a block -- a flat step onto a DECK cell is
    // a step onto the platform, not off it, so its own column counts. Asked of a WALLED side too: a body riding down under
    // a deck has the deck at its feet's level all round and the void just below it -- an overhang, not an enclosure
    const r = sk === 'open' ? R.run(x + dx, y, z + dz) : R.run(x + dx, y - 1, z + dz)
    if (r.landing === 'unknown') return { done: false, unknown: true, why: 'a side is not loaded' }
    if (r.landing !== 'water' && r.open >= ELEVATED_MIN) return { done: false, unknown: false, why: `a ${r.open}-block drop beside it` }
    if (f !== 'open' || h !== 'open') { walls++; continue }          // a wall: no exit
    if (r.landing === 'water' || r.open <= SAFE_DROP) exits++
  }
  if (!exits && walls < 4) return { done: false, unknown: false, why: 'no side is a safe step yet' }
  return { done: true, unknown: false, why: walls === 4 ? 'enclosed' : 'a safe stance' }
}

/**
 * Is the bot ELEVATED (the trigger)? -> {elevated, why, open, landing, support, transient?, partial?}. Grounded on a solid
 * support only. TRANSIENT readings -- no position, in the air, no solid support (a rejected dig's ghost air, an edge's open
 * side), an unloaded column -- are flagged: an episode in progress waits on them, never ends on them.
 */
export function elevation ({ pos, at, onGround = true }) {
  if (!pos || ![pos.x, pos.y, pos.z].every(Number.isFinite)) return { elevated: false, why: 'no position', transient: true }
  if (!onGround) return { elevated: false, why: 'not on the ground', transient: true }
  const s = supportOf(pos)
  const R = columnReader(at)
  const sb = R.block(s.x, s.y, s.z)
  if (kind(sb) !== 'solid') return { elevated: false, why: 'no solid support', support: s, transient: true }
  const e = exposedAt(R, s.x, s.y, s.z)
  if (e == null) return { elevated: false, why: 'the column below is not loaded yet', unknown: true, transient: true, support: s }
  const base = { support: s, open: e.own.open, landing: e.own.landing, landY: e.own.landY, partial: !fullCube(sb), sides: e.sides }
  if (e.exposed && e.own.open >= ELEVATED_MIN && e.own.landing !== 'water') return { elevated: true, why: `${e.own.open} open below onto ${e.own.landing}`, ...base }
  if (e.exposed) return { elevated: true, why: `a deadly drop on ${e.sides} sides of the support`, ...base }
  if (e.blind) return { elevated: false, why: 'a side column is not loaded yet', unknown: true, transient: true, ...base }
  return { elevated: false, why: e.own.landing === 'water' ? 'water below and no deadly sides' : `only ${e.own.open} open below`, ...base }
}

/** The open run under the support alone, less SAFE_DROP: the row's lower bound (descentCost is the price). */
export const blocksNeeded = el => Math.max(0, (el?.open ?? 0) - SAFE_DROP)

/**
 * WHAT A DESCENT STRAIGHT DOWN FROM SUPPORT `s` COSTS, by simulating rideFloorDown: each step breaks the support (it must
 * be breakable: `diggable(x, y, z)` -> {ok, why}, default ok -- Claude r1 P2-3) and drops one; the cell under it is ridden
 * for free when solid and bridged with ONE carried block when open (a placed block is the bot's own and is not asked).
 * Only cells above the support change, so the runs below stay as read. Over at the first doneAt support.
 * -> {ok, cost, steps, why, endY}. Not ok: a liquid one or two below (rideFloorDown stops at a liquid two below), an
 * unloaded cell, a support that cannot be broken, or more than SCAN steps. Pure; never throws.
 */
export function descentCost (at, s, { scan = SCAN, R = columnReader(at, { scan }), diggable = null } = {}) {
  let cost = 0, y = s.y, placedAt = null
  for (let step = 0; step <= scan; step++) {
    const d = doneAt(R, s.x, y, s.z)
    if (d.done) return { ok: true, cost, steps: step, why: step ? `${step} steps down, ${cost} placed` : 'already off the platform', endY: y }
    if (d.unknown) return { ok: false, cost, steps: step, why: d.why, endY: y }
    const k = R.kindAt(s.x, y - 1, s.z), k2 = R.kindAt(s.x, y - 2, s.z)
    if (k === 'unknown' || k2 === 'unknown') return { ok: false, cost, steps: step, why: 'an unloaded cell below', endY: y }
    if (k === 'lava' || k === 'water' || k2 === 'lava' || k2 === 'water') {
      const which = [k, k2].find(v => v === 'lava' || v === 'water')
      return { ok: false, cost, steps: step, why: `${which} under the column at y=${y - (k === 'lava' || k === 'water' ? 1 : 2)}`, endY: y }
    }
    if (diggable && placedAt !== y) {
      let g
      try { g = diggable(s.x, y, s.z) } catch { g = { ok: false, why: 'unreadable' } }
      if (!g?.ok) return { ok: false, cost, steps: step, why: g?.why ?? `cannot break the support at y=${y}`, endY: y }
    }
    if (k === 'open') { cost++; placedAt = y - 1 } else placedAt = null
    y--
  }
  return { ok: false, cost, steps: scan, why: 'deeper than the scan', endY: y }
}

/** Is the descent from support `s` over? -> {done, unknown, why} on a fresh read (skyDescend's loop, cognitive's episode). */
export const descentDone = (at, s) => doneAt(columnReader(at), s.x, s.y, s.z)

/**
 * THE PLACES TO START, best first (Codex r1 P1-5, Claude r1 P3-10): the own support (when it is a full cube and priced) and
 * every stance REACHABLE from it on its own level -- a 4-connected flood over full-cube supports with two open cells over
 * them, within `radius` -- priced by descentCost. A cell other than the own one is offered only when it saves SAVE_MIN
 * blocks (and the cost of its walk: one block per 4 cells walked); sorted by cost, then walk. `exclude` holds cells whose
 * walk already failed. -> [{cell, cost, dist, own, why}]. Pure; never throws.
 */
export function rankStarts ({ at, support, radius = START_RADIUS, diggable = null, exclude = null }) {
  const R = columnReader(at)
  const key = c => `${c.x},${c.y},${c.z}`
  const stance = c => fullCube(R.block(c.x, c.y, c.z)) && R.kindAt(c.x, c.y + 1, c.z) === 'open' && R.kindAt(c.x, c.y + 2, c.z) === 'open'
  const out = []
  const ownOk = fullCube(R.block(support.x, support.y, support.z))
  const own = ownOk ? descentCost(at, support, { R, diggable }) : { ok: false, why: 'not a full block' }
  if (own.ok) out.push({ cell: support, cost: own.cost, dist: 0, own: true, why: own.why })
  // the flood: the own cell need not be a stance (a slab, the bot's own feet), its neighbours must
  const seen = new Set([key(support)]), q = [[support, 0]]
  while (q.length) {
    const [c, d] = q.shift()
    for (const [dx, dz] of SIDES) {
      const n = { x: c.x + dx, y: c.y, z: c.z + dz }
      if (Math.abs(n.x - support.x) > radius || Math.abs(n.z - support.z) > radius || seen.has(key(n))) continue
      seen.add(key(n))
      if (!stance(n)) continue
      q.push([n, d + 1])
      if (exclude?.has?.(key(n))) continue
      const p = descentCost(at, n, { R, diggable })
      if (!p.ok) continue
      const walk = Math.floor((d + 1) / 4)
      if (own.ok && own.cost - p.cost < SAVE_MIN + walk) continue
      out.push({ cell: n, cost: p.cost, dist: d + 1, own: false, why: p.why })
    }
  }
  return out.sort((a, b) => a.cost + Math.floor(a.dist / 4) - (b.cost + Math.floor(b.dist / 4)) || a.dist - b.dist)
}
/** The best start, or null (the tests' and the row's view of rankStarts). */
export const cheapestStart = args => rankStarts(args)[0] ?? null

/** A log's planks: the 2x2 grid needs no table, and one log is four planks -- three more blocks to place. */
export const PLANKS_PER_LOG = 4

/**
 * Should the `sky_descend` order be issued now? -> {issue, why, state}. Pure.
 *   STARTS  an elevated bot within SPAWN_WINDOW_MS of a spawn (login or respawn) -> state.active.
 *   RUNS    while active, window or not, until `done` (descentDone at the support: {done, unknown}) is TRUE. An unknown
 *           or transient reading keeps the episode and still issues the order (the skill waits on it): the model never
 *           gets a turn while the episode is open (Codex r1 P1-6, Claude r1 P2-2).
 *   on      RESPAWNFALL
 */
export function descendOrder ({ now = Date.now(), lastSpawnAt = null, el = null, done = null, state = {}, on = true }) {
  const s = { ...state }
  if (!on) { s.active = false; return { issue: false, why: 'off', state: s } }
  if (s.active) {
    if (done?.done === true && !el?.transient) { s.active = false; return { issue: false, why: 'down: a safe stance', state: s } }
    return { issue: true, why: el?.elevated ? el.why : `episode open: ${el?.transient ? `waiting (${el.why})` : (done?.why ?? el?.why ?? 'not down yet')}`, state: s }
  }
  const inWindow = lastSpawnAt != null && now - lastSpawnAt <= SPAWN_WINDOW_MS
  if (!el?.elevated) return { issue: false, why: el?.why ?? 'not elevated', state: s }
  if (!inWindow) return { issue: false, why: 'not since a spawn', state: s }
  s.active = true
  return { issue: true, why: el.why, state: s }
}

/** One line for the `_sky_descend` row, evidence first. Pure. */
export function describeDescent ({ outcome, el, have, need, startY, endY, placed = 0, rode = 0, stopped = null, walked = null, crafted = 0 }) {
  return `${outcome}: y ${startY?.toFixed?.(1) ?? startY} -> ${endY?.toFixed?.(1) ?? endY}; open below ${el?.open ?? '?'} onto ${el?.landing ?? '?'}; ` +
    `blocks have ${have} need ${need}; placed ${placed} rode ${rode}${walked ? `; walked ${walked}` : ''}${crafted ? `; planks from ${crafted} log(s)` : ''}${stopped ? `; stopped: ${stopped}` : ''}`
}

/**
 * The stay's reason (and the `_needs_rescue` detail). It says only what is true and what happens next (Claude r1 P1-1):
 * the bot is HELD, the order comes back every decision, and the flag is up. No advice it cannot act on. Pure.
 */
export function stayRefusal ({ el, have, need, why = null }) {
  const where = `${el?.open ?? '?'} open blocks below onto ${el?.landing ?? '?'}`
  if (why) return `sky_descend: staying put -- ${where}, and no column within ${START_RADIUS} it can climb down (${why}); walking off is a fall. Held here for rescue (_needs_rescue raised); it re-checks every decision`
  return `sky_descend: staying put -- ${where}; the cheapest column down needs ${need + (need > 0 ? MARGIN : 0)} placeable blocks and it carries ${have} ` +
    `(its logs already turned into planks); walking off is a fall. Held here for rescue (_needs_rescue raised); it climbs down as soon as it carries enough`
}

/** The licence row's detail (`_respawnfall_mode`, once per spawn). */
export const respawnfallModeDetail = (env = typeof process !== 'undefined' ? process.env : {}) =>
  `on=${respawnfallOn(env) ? 1 : 0} elevated_min=${ELEVATED_MIN} safe_drop=${SAFE_DROP} window_min=${SPAWN_WINDOW_MS / 60000} margin=${MARGIN} edge_sides=${EDGE_SIDES} radius=${START_RADIUS} save_min=${SAVE_MIN} way=cheapest_column+ride_floor_down`
