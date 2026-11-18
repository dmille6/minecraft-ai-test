// TIDYTOP-01show (item 8, 11-18): THE CLEAN-UP'S OWN FILLS PAVED THE TOWN GREY. Measured 06:30Z on the showcase's inside-the-wall
// record (g199, 9,746 surveyed columns): 2,798 columns topped with cobblestone against 4,991 grass; 1,025 grey tops were the record's
// own fill cells beside grass or dirt (809 of the strict 826 role `earth`). The cause: tidy.mjs coreFills left a column's TOP fill
// role `earth`, and TIDY_PALETTE.earth is ['dirt', 'cobblestone', ...] with a '*solid' done rule -- a bag without spare dirt laid
// cobblestone at the surface, and the cobblestone then read done for ever.
//
//   1. surfaceFills: a column's TOP fill cell (no record fill above it) is role `topsoil` (TIDY_PALETTE.topsoil: dirt or grass
//      only, never `*solid`). The visit already bills topsoil as DIRT drawn from the town (skills.mjs `wantSoil`), and a topsoil cell
//      the bag holds no dirt for is PASSED, not stoned (tidy.mjs soilSkip): the remedy is the next draw, or the dirt the visit's own
//      cuts hand the bag mid-visit (alsoDone is read per cell). The buried cells keep `core` (cobblestone first: the sink).
//   2. retopCells: the grey tops already laid go back on the work list -- the cell's role becomes `topsoil` and the block is a tidy CUT
//      of the same cell (roughground's re-soil pattern: dig the cobble, lay dirt), only on a top fill cell with air above and grass
//      or dirt beside it, never a waived, guarded, carried, planned or kept-off cell; nearest home first, RETOP.max a refresh.
//
// A bot cannot place grass_block (no silk touch, no /give): it lays dirt, and dirt beside grass in the light greens on its own.

export const RETOP = Object.freeze({ max: 300 })
/** TIDYTOP=off restores the old roles (top fill `earth`) and the re-top pass is not run. */
export const tidyTopOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.TIDYTOP ?? '').trim())

const nm = b => String(b?.name ?? '').replace(/^minecraft:/, '').replace(/\[.*\]$/, '')
const k2 = (x, z) => `${x},${z}`
const kOf = at => at.join(',')
const hasOwn = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)
/** The earth-laid roles of a tidy column. */
const COLUMN_ROLES = new Set(['earth', 'core', 'topsoil'])
/** What a grey fill is (the bag's stone a fill laid). */
export const GREY_FILL = /^(cobblestone|cobbled_deepslate|mossy_cobblestone|stone)$/
/** Ground that greens a laid dirt block beside it. */
export const SOIL_NEAR = /^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mycelium|moss_block)$/
const AIRY = /^(air|cave_air|void_air)$/

/** THE ROLE OF A TIDY FILL CELL -> role. Pure. `top`: the highest fill cell's y in the cell's column. Only an `earth` cell moves: the
 *  top one becomes `topsoil`, a lower one `core` (groundskeeper-01). Any other role is kept. */
export function fillRole (cell, top) {
  if (cell?.role !== 'earth') return cell?.role
  return cell.at[1] < top ? 'core' : 'topsoil'
}

/** THE SURFACE FILLS -> a record whose top `earth` fill per column is `topsoil`. Pure; returns the record unchanged when nothing moves. */
export function surfaceFills (rec) {
  if (!rec?.cells?.length) return rec
  const top = new Map()
  for (const c of rec.cells) if (c?.role === 'earth') { const k = k2(c.at[0], c.at[2]); top.set(k, Math.max(top.get(k) ?? -Infinity, c.at[1])) }
  if (!top.size) return rec
  return { ...rec, cells: rec.cells.map(c => { const r = fillRole(c, top.get(k2(c.at[0], c.at[2]))); return r === c.role ? c : { ...c, role: r } }) }
}

/** IS THERE SOIL BESIDE THIS SURFACE CELL? -> bool. Pure over `read`. One of the four neighbours is soil level with it (at y) or one
 *  below it with air above (a step down onto grass). */
export function soilBeside (read, at) {
  const [x, y, z] = at
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const a = nm(read(x + dx, y, z + dz)), b = nm(read(x + dx, y - 1, z + dz))
    if (SOIL_NEAR.test(a)) return true
    if (AIRY.test(a) && SOIL_NEAR.test(b)) return true
  }
  return false
}

/**
 * A GREY TOP TO RE-TOP? -> null (yes) | the reason it is left. Pure over `read`. `cell` a record fill cell, `aboveFill`: an OPEN record
 * fill cell stands above it in its column (it is not the surface yet).
 */
export function retopWhy (cell, read, { waived = null, guard = new Set(), cutK = new Set(), keepOff = () => null, aboveFill = false } = {}) {
  if (!cell || !Array.isArray(cell.at) || !COLUMN_ROLES.has(cell.role) || cell.role === 'topsoil') return 'role'
  if (cell.prev || cell.plot != null || cell.prep || cell.landmark) return 'not_tidy'
  const k = kOf(cell.at)
  if (hasOwn(waived, k)) return 'waived'
  if (guard.has(k)) return 'guarded'
  if (cutK.has(k)) return 'cut_named'
  if (aboveFill) return 'buried'
  if (keepOff(cell.at[0], cell.at[2])) return 'kept_off'
  const [x, y, z] = cell.at
  if (!GREY_FILL.test(nm(read(x, y, z)))) return 'not_grey'
  if (!AIRY.test(nm(read(x, y + 1, z)))) return 'covered'
  if (!soilBeside(read, cell.at)) return 'no_soil_beside'
  return null
}

/**
 * THE RE-TOP PASS -> { rec, n, skipped }. Pure over `read`. Every grey top fill (retopWhy null) becomes role `topsoil` with a tidy cut
 * of the block on it (dug, then laid with dirt; the cut is done once the cell holds anything else); nearest `home` first, at most
 * `max`. A cell left keeps its role. `rec` null or complete -> nothing.
 */
export function retopCells (rec, read, { guard = new Set(), keepOff = () => null, now = Date.now(), max = RETOP.max, done = () => false } = {}) {
  const skipped = {}
  if (!rec || rec.structure_complete || !Array.isArray(rec.cells)) return { rec, n: 0, skipped }
  const waived = rec.waived ?? null
  const cutK = new Set((rec.cut ?? []).map(c => kOf(c.at)))
  // the open fills above a cell in its column (a cell under one is buried, not the surface)
  const openTop = new Map()
  for (const c of rec.cells) {
    if (!COLUMN_ROLES.has(c?.role) || c.prev || hasOwn(waived, kOf(c.at)) || done(c)) continue
    const k = k2(c.at[0], c.at[2]); openTop.set(k, Math.max(openTop.get(k) ?? -Infinity, c.at[1]))
  }
  const home = rec.home ?? { x: 0, z: 0 }
  const cand = []
  for (let i = 0; i < rec.cells.length; i++) {
    const c = rec.cells[i]
    const why = retopWhy(c, read, { waived, guard, cutK, keepOff, aboveFill: (openTop.get(k2(c?.at?.[0], c?.at?.[2])) ?? -Infinity) > (c?.at?.[1] ?? Infinity) })
    if (why) { if (why !== 'role') skipped[why] = (skipped[why] ?? 0) + 1; continue }
    cand.push([Math.max(Math.abs(c.at[0] - home.x), Math.abs(c.at[2] - home.z)), i])
  }
  cand.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (cand.length > max) skipped.retop_max = cand.length - max
  const pick = cand.slice(0, Math.max(0, max)).map(p => p[1])
  if (!pick.length) return { rec, n: 0, skipped }
  const take = new Set(pick)
  const cells = rec.cells.map((c, i) => (take.has(i) ? { ...c, role: 'topsoil', retop: now } : c))
  const cut = [...(rec.cut ?? []), ...pick.map(i => ({ at: [...rec.cells[i].at], kind: 'tidy', name: nm(read(...rec.cells[i].at)), retop: now }))]
  return { rec: { ...rec, cells, cut }, n: pick.length, skipped }
}
