// RESPAWNFALL-01: A BOT THAT (RE)SPAWNS ON A HIGH PLATFORM CLIMBS DOWN INSTEAD OF WALKING OFF IT
// (docs/reports/respawnfall-01-design-2026-10-24.md). Pure: no bot. `at(x, y, z)` reads a block ({name, boundingBox} or
// null for an unloaded cell).
//
// THE CASE (cavefall-01 design §0.6, measured 7 d to 10-24): isolated-a's backup holds a bot-built structure over spawn --
// 503 blocks at y=180 and 290 at y=125 (cobblestone, logs, dirt; 1-wide bridges and a 1x1 column at 354,148) -- and the
// world respawns a dead bot on the highest block of a random column within 10 of (355,147): a third of those columns are
// the platform. isolated-a-Comet died 11 times in a week falling off it (118, 54, 87 blocks...), a respawn loop. The
// pathfinder walks the bridges and the bot falls; nothing makes it come DOWN.
//
// THE RULE: within SPAWN_WINDOW_MS of a spawn, a bot whose support cell has a deadly open drop under it -- at least
// ELEVATED_MIN open cells straight down before the first solid, and the landing not water -- is ELEVATED. An elevated bot
// gets one deterministic order, `sky_descend`, ahead of the model: skills.mjs rideFloorDown, the existing primitive that
// places a block under its own floor and breaks the floor (a one-block drop each step; free where a column is already
// there), repeated until the drop under it is at most SAFE_DROP. It needs one carried block per open cell to bridge; a bot
// that carries too few does not start, writes `_needs_rescue` and STAYS (the order holds the body in place) -- the owner's
// choice over walking off.
export const ELEVATED_MIN = 8          // open cells under the support: a fall of >= 9 onto rock costs >= 6 hp, and kills onto a tip
export const SAFE_DROP = 3             // vanilla: fall damage = ceil(d - 3), so the descent may stop with <= 3 under it
export const SCAN = 400                // the build limit is 320 above -64: read the whole column
export const SPAWN_WINDOW_MS = 10 * 60 * 1000
export const MARGIN = 2                // blocks kept in hand beyond the count needed (a mistimed placement retries)

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

/** The support cell under a body whose feet are at `pos` (the centred cell; feet 31.0 stand on y=30). */
export const supportOf = pos => ({ x: Math.floor(pos.x), y: Math.ceil(pos.y - 1e-6) - 1, z: Math.floor(pos.z) })

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
 * Is the bot ELEVATED? -> {elevated, why, open, landing, support}. Grounded on a solid support only (a bot in water, on a
 * ladder or in the air is not "standing on a platform"); unknown below = not yet (chunks still loading after a respawn: ask
 * again on the next decision, never guess); a water landing is not deadly (swimming is travel).
 */
export function elevation ({ pos, at, onGround = true }) {
  if (!pos || ![pos.x, pos.y, pos.z].every(Number.isFinite)) return { elevated: false, why: 'no position' }
  if (!onGround) return { elevated: false, why: 'not on the ground' }
  const s = supportOf(pos)
  let sb
  try { sb = at(s.x, s.y, s.z) } catch { sb = null }
  if (kind(sb) !== 'solid') return { elevated: false, why: 'no solid support', support: s }
  const c = columnUnder(at, s)
  if (c.landing === 'unknown') return { elevated: false, why: 'the column below is not loaded yet', unknown: true, support: s, ...c }
  if (c.landing === 'water') return { elevated: false, why: 'water below: a fall into it is safe', support: s, ...c }
  if (c.open >= ELEVATED_MIN) return { elevated: true, why: `${c.open} open below onto ${c.landing}`, support: s, ...c }
  // ...OR ON A COLUMN WITH THE VOID BESIDE IT: a pillar top inside the deck, or the pillar itself once the deck is above.
  // Its own column is solid (rideFloorDown rides it for free), but a step to any side is the deadly drop. The side's drop
  // is read from the support's level down: beside an open side cell it starts at that cell, under a solid one below it.
  let edge = null
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = { x: s.x + dx, y: s.y, z: s.z + dz }
    let nb
    try { nb = at(n.x, n.y, n.z) } catch { nb = null }
    if (nb == null) continue
    const cc = kind(nb) === 'open' ? columnUnder(at, { x: n.x, y: n.y + 1, z: n.z }) : columnUnder(at, n)
    if (cc.landing === 'water' || cc.landing === 'unknown') continue
    if (cc.open >= ELEVATED_MIN && (!edge || cc.open > edge.open)) edge = { ...cc, side: [dx, dz] }
  }
  if (edge) return { elevated: true, why: `a ${edge.open}-block drop beside the support (${edge.side.join(',')})`, support: s, ...c, edge }
  return { elevated: false, why: `only ${c.open} open below`, support: s, ...c }
}

/**
 * Blocks the descent must PLACE straight down from the support's open run alone (the first run, no column below it).
 * descentCost is the full simulation; this is its lower bound and the old reading, kept for the row.
 */
export const blocksNeeded = el => Math.max(0, (el?.open ?? 0) - SAFE_DROP)

/**
 * A memoised reader for pricing many columns at once (cheapestStart prices up to 288 cells over the same few hundred
 * columns): kind(x, y, z) reads each cell once, run(x, y, z) is the open run from y DOWN (0 when y itself is not open)
 * with its landing kind, computed once per cell.
 */
export function columnReader (at, { scan = SCAN } = {}) {
  const kinds = new Map(), runs = new Map()
  const kindAt = (x, y, z) => {
    const k = `${x},${y},${z}`
    if (!kinds.has(k)) { let b; try { b = at(x, y, z) } catch { b = null } kinds.set(k, kind(b)) }
    return kinds.get(k)
  }
  const run = (x, y0, z) => {
    // iterative, bottom-up fill: walk down to the first non-open cell (or the scan floor), then memoise on the way back
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
  return { kindAt, run }
}

/**
 * Is a body on support cell (x, y, z) still exposed to a deadly drop -- elevation()'s test on the memoised reader? Its
 * own run (from y-1) >= ELEVATED_MIN onto anything but water, or a cardinal side's (from y when that side is open, else
 * from y-1) onto anything but water. Unknown under its own column -> null (not priced); an unloaded side is `blind` (a
 * descent is never called done beside a column it could not read).
 */
function exposedAt (R, x, y, z) {
  const own = R.run(x, y - 1, z)
  if (own.landing === 'unknown') return null
  if (own.landing !== 'water' && own.open >= ELEVATED_MIN) return { exposed: true, own }
  let blind = false
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nk = R.kindAt(x + dx, y, z + dz)
    if (nk === 'unknown') { blind = true; continue }
    const r = nk === 'open' ? R.run(x + dx, y, z + dz) : R.run(x + dx, y - 1, z + dz)
    if (r.landing === 'unknown') { blind = true; continue }
    if (r.landing === 'water') continue
    if (r.open >= ELEVATED_MIN) return { exposed: true, own }
  }
  return { exposed: false, own, blind }
}

/**
 * WHAT A DESCENT STRAIGHT DOWN FROM SUPPORT `s` COSTS, by simulating rideFloorDown on the world as read: each step the
 * support moves down one; the cell under it is ridden for free when solid and bridged with ONE carried block when open
 * (only cells above the support ever change, so the runs below stay as read). The descent is over at the first support
 * with at most SAFE_DROP open under it (or water) and no deadly side -- skyDescend's own stopping test.
 * -> {ok, cost, steps, why, endY}. Not ok: lava or water in the column (rideFloorDown stops at a liquid two below), an
 * unloaded cell, or more than SCAN steps. Pure; never throws. `R` shares one columnReader across calls.
 */
export function descentCost (at, s, { scan = SCAN, R = columnReader(at, { scan }) } = {}) {
  let cost = 0, y = s.y
  for (let step = 0; step <= scan; step++) {
    const e = exposedAt(R, s.x, y, s.z)
    if (e == null) return { ok: false, cost, steps: step, why: 'an unloaded cell below', endY: y }
    if (!e.exposed && (e.own.open <= SAFE_DROP || e.own.landing === 'water')) {
      if (e.blind) return { ok: false, cost, steps: step, why: 'an unloaded column beside it', endY: y }
      return { ok: true, cost, steps: step, why: step ? `${step} steps down, ${cost} placed` : 'already off the platform', endY: y }
    }
    const k = R.kindAt(s.x, y - 1, s.z), k2 = R.kindAt(s.x, y - 2, s.z)
    if (k === 'unknown' || k2 === 'unknown') return { ok: false, cost, steps: step, why: 'an unloaded cell below', endY: y }
    if (k === 'lava' || k === 'water' || k2 === 'lava' || k2 === 'water') {
      return { ok: false, cost, steps: step, why: `${[k, k2].find(v => v === 'lava' || v === 'water')} under the column at y=${y - (k === 'lava' || k === 'water' ? 1 : 2)}`, endY: y }
    }
    if (k === 'open') cost++
    y--
  }
  return { ok: false, cost, steps: scan, why: 'deeper than the scan', endY: y }
}

/** Is the descent from support `s` over (skyDescend's loop test)? descentCost's stopping test on a fresh read. */
export function descentDone (at, s) {
  const e = exposedAt(columnReader(at), s.x, s.y, s.z)
  return e != null && !e.exposed && !e.blind && (e.own.open <= SAFE_DROP || e.own.landing === 'water')
}

/**
 * THE CHEAPEST SAFE PLACE TO START, within `radius` on the support's own level: every cell a body can stand on (solid
 * support, two open cells over it) priced by descentCost; the bot's own cell first, and another only when it saves at
 * least SAVE_MIN blocks (the walk across a deck has its own risk). -> {cell, cost, dist, own} or null when no cell is ok.
 * `reach(cell)`, if given, filters out cells the caller knows it cannot walk to. Pure; never throws.
 */
export const START_RADIUS = 8
export const SAVE_MIN = 4
export function cheapestStart ({ at, support, radius = START_RADIUS, reach = null }) {
  const R = columnReader(at)
  const own = descentCost(at, support, { R })
  let best = own.ok ? { cell: support, cost: own.cost, dist: 0, own: true, why: own.why } : null
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (!dx && !dz) continue
      const c = { x: support.x + dx, y: support.y, z: support.z + dz }
      if (R.kindAt(c.x, c.y, c.z) !== 'solid' || R.kindAt(c.x, c.y + 1, c.z) !== 'open' || R.kindAt(c.x, c.y + 2, c.z) !== 'open') continue
      const d = descentCost(at, c, { R })
      if (!d.ok) continue
      const dist = Math.abs(dx) + Math.abs(dz)
      const saves = best ? (best.own ? best.cost - d.cost >= SAVE_MIN : d.cost < best.cost || (d.cost === best.cost && dist < best.dist)) : true
      if (!saves) continue
      if (reach && !reach(c)) continue
      best = { cell: c, cost: d.cost, dist, own: false, why: d.why }
    }
  }
  return best
}

/** Logs a bot could turn into planks where it stands (4 per log, the 2x2 grid needs no table): the blocks it could have. */
export const PLANKS_PER_LOG = 4

/**
 * Should the `sky_descend` order be issued now? -> {issue, why, state}. Pure.
 *   now, lastSpawnAt         the window opens at a spawn (login or respawn) and lasts SPAWN_WINDOW_MS ...
 *   state.active             ... or while a descent that made progress is still under way (a long drop takes several runs)
 *   el                       elevation() now
 *   on                       RESPAWNFALL
 */
export function descendOrder ({ now = Date.now(), lastSpawnAt = null, el = null, state = {}, on = true }) {
  const s = { ...state }
  if (!on) return { issue: false, why: 'off', state: s }
  const inWindow = lastSpawnAt != null && now - lastSpawnAt <= SPAWN_WINDOW_MS
  if (!el?.elevated) {
    if (s.active) s.active = false             // grounded (or never elevated): the episode is over
    return { issue: false, why: el?.why ?? 'not elevated', state: s }
  }
  if (!inWindow && !s.active) return { issue: false, why: 'not since a spawn', state: s }
  s.active = true                              // the episode runs until elevation() says otherwise, window or not
  return { issue: true, why: el.why, state: s }
}

/** One line for the `_sky_descend` row, evidence first. Pure. */
export function describeDescent ({ outcome, el, have, need, startY, endY, placed = 0, rode = 0, stopped = null, walked = null, crafted = 0 }) {
  return `${outcome}: y ${startY?.toFixed?.(1) ?? startY} -> ${endY?.toFixed?.(1) ?? endY}; open below ${el?.open ?? '?'} onto ${el?.landing ?? '?'}; ` +
    `blocks have ${have} need ${need}; placed ${placed} rode ${rode}${walked ? `; walked ${walked}` : ''}${crafted ? `; planks from ${crafted} log(s)` : ''}${stopped ? `; stopped: ${stopped}` : ''}`
}

/** The refusal (and the `_needs_rescue` reason): what the bot can do from where it stands. Pure. */
export function stayRefusal ({ el, have, need, why = null }) {
  if (why) return `sky_descend: staying put -- ${el?.open ?? '?'} open blocks below onto ${el?.landing ?? '?'} and no safe column within ${START_RADIUS} (${why}); walking off is a fall. It waits here for rescue`
  return `sky_descend: staying put -- ${el?.open ?? '?'} open blocks below onto ${el?.landing ?? '?'}, and climbing down needs ` +
    `${need + MARGIN} placeable blocks (carrying ${have}, logs counted as ${PLANKS_PER_LOG} planks); walking off is a fall. ` +
    `Pick up blocks (cobblestone, dirt, logs) and it climbs down at once; otherwise it waits here for rescue`
}

/** The licence row's detail (`_respawnfall_mode`, once per spawn). */
export const respawnfallModeDetail = (env = typeof process !== 'undefined' ? process.env : {}) =>
  `on=${respawnfallOn(env) ? 1 : 0} elevated_min=${ELEVATED_MIN} safe_drop=${SAFE_DROP} window_min=${SPAWN_WINDOW_MS / 60000} margin=${MARGIN} radius=${START_RADIUS} save_min=${SAVE_MIN} way=cheapest_column+ride_floor_down`
