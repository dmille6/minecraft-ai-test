// NOSTOCK-01show (c): GATHER SKIPS WHAT IS BUILT, AT ENUMERATION, AND SAYS SO.
//
// docs/reports/gather-diag-2026-11-20.md section 1: in 3.5 h, 108 of 275 spruce_log gather failures ended "found but all N
// candidates are beside water or under falling blocks [unknown:N]" with the bot a median 14 blocks from home. `unknown` means
// breakVetoAt found no liquid, no falling block and no entity: what refused was the third part of mineflayer-pathfinder's
// safeToBreak, `exclusionBreak(block) < 100` -- the exclusionAreasBreak prices index.mjs installs (the town plan's cells, the
// protect zones, the wells, the workshop's footprint). Logs are not terrain, so the town-ground filter (townground.mjs) passes
// them, and the 32 nearest candidates were the town's houses: every one refused after the search, none replaced by a log
// further out. The successes were a median 78 blocks out.
//
// So a cell the gather profile prices at 100+ is skipped AT ENUMERATION (as town ground, keep-out and the clean zone are), the
// search's 32 are the nearest the bot may take, and an emptied search names the real reason ("protected / built") and a remedy
// the bot performs: one bounded walk BUILT_OUT blocks past the built cells, away from the town, and the search again.
// No rule is relaxed: these cells were refused before (safeToBreak), they are now refused earlier.

/** How far past the farthest built cell the walk goes (the owner's "25+ blocks out of town"). */
export const BUILT_OUT = 25
/** The walk's bound (ms). */
export const BUILT_WALK_MS = 45_000
/** Walks a run may make (one: a second emptied search is the refusal). */
export const BUILT_WALKS = 1

/** The profile's break price of a block (mineflayer-pathfinder exclusionBreak) -> number; 0 when it cannot be asked. */
export function builtPrice (m, block) {
  try { return block && typeof m?.exclusionBreak === 'function' ? Number(m.exclusionBreak(block)) || 0 : 0 } catch { return 0 }
}
/** Is the cell protected / built (safeToBreak's `exclusionBreak < 100` refuses it)? Pure over the profile. */
export const isBuiltCell = (m, block) => builtPrice(m, block) >= 100

/**
 * THE WALK'S POINT -> { x, z } | null. Pure. Out from the town's home (else the built cells' centre) along the bearing to the bot,
 * BUILT_OUT past the farther of the bot and the farthest skipped built cell. A bot standing on the home column walks east.
 */
export function builtRemedyPoint ({ from, home = null, cells = [], out = BUILT_OUT } = {}) {
  if (!from || !Number.isFinite(from.x) || !Number.isFinite(from.z)) return null
  const pts = (Array.isArray(cells) ? cells : []).filter(c => c && Number.isFinite(c.x) && Number.isFinite(c.z))
  const o = home && Number.isFinite(home.x) && Number.isFinite(home.z)
    ? { x: home.x, z: home.z }
    : pts.length ? { x: pts.reduce((t, c) => t + c.x, 0) / pts.length, z: pts.reduce((t, c) => t + c.z, 0) / pts.length } : null
  if (!o) return null
  let dx = from.x - o.x, dz = from.z - o.z
  const d = Math.hypot(dx, dz)
  if (d < 1) { dx = 1; dz = 0 } else { dx /= d; dz /= d }
  const r = Math.max(d, ...pts.map(c => Math.hypot(c.x - o.x, c.z - o.z)), 0) + out
  return { x: Math.round(o.x + dx * r), z: Math.round(o.z + dz * r) }
}

/** The refusal (the remedy first: gather keeps the start of an error). Pure. */
export function builtRefusal ({ block, n, point = null, walked = 0, maxDistance = 32 }) {
  const go = point ? `goto x=${point.x} z=${point.z} (${BUILT_OUT}+ blocks out of town) and gather ${block} there` : `walk ${BUILT_OUT}+ blocks out of town and gather ${block} there`
  return `${go} -- all ${n} ${block} within ${maxDistance} blocks are protected / built (houses, the town plan's cells, zones, wells, the workshop)` +
    (walked ? `; the walk out did not reach open ground (${walked} tried)` : '')
}

/** The `_gather_built` row. Pure. */
export const builtRowDetail = ({ op, block, skipped = 0, from = null, to = null, reached = null, ms = null, err = null, found = null }) =>
  `op=${op} block=${block} skipped=${skipped}${from ? ` from=${from.x},${from.y},${from.z}` : ''}${to ? ` to=${to.x},${to.z}` : ''}` +
  `${reached == null ? '' : ` reached=${reached ? 1 : 0}`}${found == null ? '' : ` found=${found}`}${ms == null ? '' : ` ms=${ms}`}` +
  `${err ? ` err=${String(err?.message ?? err).replace(/\s+/g, '_').slice(0, 60)}` : ''}`
