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

// LOGWALK-01show: THE WALK-OUT FIRES WHERE THE TOWN'S LOGS ARE BUILT CELLS OR CAVE FLOORS, AND IT WALKS TO KNOWN WOOD.
//
// Showcase 11-20 (ES, nostock live): 0 log gathers succeeded after 13Z; all 117 failures were "spruce_log found but all N
// candidate(s) are floors over a drop into a cave", under 1.4 s each, 99 of them within ~12 blocks of the town centre. The
// built-cell walk above was guarded by `!caveInBorder().length`, and in town the few logs that are not in a building are always
// cave floors -- two correct guards composed into a dead end (0 `_gather_built` rows for logs). So:
//   1. a search emptied by built cells and/or cave floors walks out (walkOutDue); the cave refusal comes only once the walks are
//      spent, and then it names a point further out (walkSpentRemedy);
//   2. the walk aims at the nearest live wood find of the bots' shared map (atlas.mjs: not gone, outside town ground, the zones
//      and the plan's cells; `ok` is the caller's test), at most ATLAS_WALK_MAX blocks toward it; with no find known, the
//      nostock step (builtRemedyPoint, BUILT_OUT past the cells);
//   3. one `_gather_walk` row a try (from, to, dist, arrived, found); an atlas walk that arrived and found no log marks its find
//      gone (missIsGone), so the next bot is not sent there.

/** The farthest one walk goes toward a find (blocks); a find beyond it is walked toward, this far. */
export const ATLAS_WALK_MAX = 96
/** The walk's bound for its length (ms): BUILT_WALK_MS at least, ~0.6 s a block, at most WALK_MS_MAX (gather's contract is 180 s). */
export const WALK_MS_PER_BLOCK = 600
export const WALK_MS_MAX = 75_000
export const walkMsFor = dist => Math.min(WALK_MS_MAX, Math.max(BUILT_WALK_MS, Math.round((Number(dist) || 0) * WALK_MS_PER_BLOCK)))

/** IS THE WALK-OUT DUE? Pure. The search emptied (nothing takeable), nothing collected yet this run, something WAS here but every
 *  one was a built cell or a floor over a drop, and the run has a walk left. */
export function walkOutDue ({ positions = 0, built = 0, cave = 0, refused = 0, collected = 0, walked = 0, walks = BUILT_WALKS } = {}) {
  // atlasgather-01show: `refused` = cells the bot's own refusal memory skipped (gatherrefused.mjs): a search they emptied walks out too
  return positions === 0 && collected === 0 && (built > 0 || cave > 0 || refused > 0) && walked < walks
}

const fin = p => p && Number.isFinite(p.x) && Number.isFinite(p.z)

/**
 * THE NEAREST KNOWN WOOD -> { x, z, dist, find, capped } | null. Pure. `finds`: the atlas view's live finds; only `kind`, only
 * those `ok` passes, only beyond `minDist` (a find inside the search just made was searched and refused). Within `cap`: the find's
 * own column; beyond it: `cap` blocks along the bearing to it.
 */
export function atlasWalkTarget ({ from, finds = [], kind, ok = () => true, minDist = 0, cap = ATLAS_WALK_MAX } = {}) {
  if (!fin(from) || !kind) return null
  let best = null
  for (const f of Array.isArray(finds) ? finds : []) {
    if (!f || f.kind !== kind || !fin(f)) continue
    let pass = false
    try { pass = !!ok(f) } catch { pass = false }
    if (!pass) continue
    const d = Math.hypot(f.x - from.x, f.z - from.z)
    if (d <= minDist) continue
    if (!best || d < best.d) best = { f, d }
  }
  if (!best) return null
  const { f, d } = best
  if (d <= cap) return { x: Math.round(f.x), z: Math.round(f.z), dist: Math.round(d), find: f, capped: false }
  const k = cap / d
  return { x: Math.round(from.x + (f.x - from.x) * k), z: Math.round(from.z + (f.z - from.z) * k), dist: cap, find: f, capped: true }
}

/** THE WALK'S TARGET -> { x, z, dist, via: 'atlas' | 'step', find? } | null. Pure. Known wood first, else the nostock step. */
export function walkTargetFor ({ from, home = null, cells = [], finds = [], kind, ok, minDist = 0, cap = ATLAS_WALK_MAX } = {}) {
  const a = atlasWalkTarget({ from, finds, kind, ok, minDist, cap })
  if (a) return { ...a, via: 'atlas' }
  const p = builtRemedyPoint({ from, home, cells })
  return p ? { x: p.x, z: p.z, dist: Math.round(Math.hypot(p.x - from.x, p.z - from.z)), via: 'step' } : null
}

/** A MISS: an atlas walk that arrived AT THE FIND (not a capped point short of it: Codex + Claude r1 BLOCKER) and whose search found
 *  nothing takeable. Its find is marked gone. Pure. */
export const missIsGone = ({ via, arrived, found, capped = false } = {}) => via === 'atlas' && arrived === true && capped !== true && Number(found) === 0

/** What the cave refusal adds once the walks are spent: the walk made and a point further out (a `goto` the bot can make). Pure. */
export function walkSpentRemedy ({ block, walked = 0, to = null, next = null } = {}) {
  if (!walked) return ''
  return ` -- walked out ${walked} time(s)${to ? ` (to ${to.x},${to.z})` : ''} and found none there either: ` +
    (next ? `goto x=${next.x} z=${next.z} (${BUILT_OUT} blocks further out) and gather ${block} there, or explore` : `explore, then gather ${block}`)
}

/** The `_gather_walk` row (one a try). Pure. */
export const walkRowDetail = ({ via, block, from = null, to = null, dist = null, arrived = null, found = null, ms = null, built = 0, cave = 0, find = null, gone = false, err = null }) =>
  `via=${via} block=${block}${from ? ` from=${from.x},${from.y},${from.z}` : ''}${to ? ` to=${to.x},${to.z}` : ''}${dist == null ? '' : ` dist=${dist}`}` +
  `${arrived == null ? '' : ` arrived=${arrived ? 1 : 0}`}${found == null ? '' : ` found=${found}`} built=${built} cave=${cave}` +
  `${find ? ` find=${find.x},${find.y},${find.z}` : ''}${gone ? ' gone=1' : ''}${ms == null ? '' : ` ms=${ms}`}` +
  `${err ? ` err=${String(err?.message ?? err).replace(/\s+/g, '_').slice(0, 60)}` : ''}`
