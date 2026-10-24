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
 * Blocks the descent must PLACE: one per open cell it bridges down to SAFE_DROP above the landing (rideFloorDown places
 * only where the cell two below the feet is open). Lava under the column: the descent stops SAFE_DROP + 1 above it.
 */
export const blocksNeeded = el => Math.max(0, (el?.open ?? 0) - SAFE_DROP)

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
export function describeDescent ({ outcome, el, have, need, startY, endY, placed = 0, rode = 0, stopped = null }) {
  return `${outcome}: y ${startY?.toFixed?.(1) ?? startY} -> ${endY?.toFixed?.(1) ?? endY}; open below ${el?.open ?? '?'} onto ${el?.landing ?? '?'}; ` +
    `blocks have ${have} need ${need}; placed ${placed} rode ${rode}${stopped ? `; stopped: ${stopped}` : ''}`
}

/** The refusal (and the `_needs_rescue` reason): what the bot can do from where it stands. Pure. */
export function stayRefusal ({ el, have, need }) {
  return `sky_descend: staying put -- ${el?.open ?? '?'} open blocks below onto ${el?.landing ?? '?'}, and climbing down needs ` +
    `${need + MARGIN} placeable blocks (carrying ${have}); walking off is a fall. Pick up or craft blocks (logs, planks, ` +
    `cobblestone) and it climbs down at once; otherwise it waits here for rescue`
}

/** The licence row's detail (`_respawnfall_mode`, once per spawn). */
export const respawnfallModeDetail = (env = typeof process !== 'undefined' ? process.env : {}) =>
  `on=${respawnfallOn(env) ? 1 : 0} elevated_min=${ELEVATED_MIN} safe_drop=${SAFE_DROP} window_min=${SPAWN_WINDOW_MS / 60000} margin=${MARGIN} way=ride_floor_down`
