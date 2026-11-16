// SEALEDCORE-01 (showcase, obsolete-01show): A CORE CELL OF THE MONUMENT SEALED INSIDE ITS OWN FINISHED BODY IS WAIVED.
//
// THE CASE (LIVE showcase, the ziggurat at 4,885 of 4,889): two open cells, -36,69,-25 and -36,69,-26 (role `core`, segment L00-E),
// are air inside the finished body -- dirt on both x sides, two layers of dirt and the cobblestone cap above, and under them a
// one-high air run at y 68 (x -36..-32) that is no record cell. No stand sees a face (`stuck_on_cell ... visits=20`, `tempstand
// refused no_step` 32 times), and the void access refuses 13 times (`access_refused ... no_plan (dig_not_record ...)`): its shaft
// would dig cells that are not the monument's, which it rightly never does. 13 other open cells wait on that segment.
// ziggurat.mjs zigHidden already counts a core cell done when its six neighbours are solid, and zigRecord leaves an air pocket in
// the core out of the record at siting ("a hidden void, not a cell to place"): the blueprint's own rule is that an enclosed hollow
// in the fill is not something to build. zigHidden cannot see this one only because the hollow is more than one cell.
//
// THE RULE (pure here; the actuator is skills.mjs buildMonument, after its visit; the wall's waiver machinery -- wall.mjs
// wallWaiveDue: the record's `waived` map, an `op=waived` row, every completeness test reading it done). An open monument cell is
// WAIVED (`why: sealed_core`) only when ALL of these hold; invisibility alone is never enough:
//   FILL      its role is an interior FILL role of the record's own palette (fillRole: the role the blueprint marks "any solid is
//             done", `*solid` -- core; never a skin, stair, plinth, parapet, shrine or light cell);
//   ENCLOSED  the connected set of non-solid cells that holds it (six neighbours, at most `voidMax` cells) lies wholly inside the
//             monument's own box, every cell of it and every cell round it READ, none of it a liquid, and every cell on its boundary
//             is a full solid block that is either one of the record's own cells reading DONE or ground below the base (no record
//             cell, under baseY, a solid floor). An opening to open air is a void that does not stay small: refused;
//   NO CELL OF THE RECORD IN THE VOID IS A VISIBLE ONE (an open skin or stair cell that touches the void would lose the void's
//             cells as its support or its way in: such a void is work, never waived) -- and an open cell that holds the wrong
//             block on the boundary is a boundary cell not done, refused the same way;
//   STUCK     this visit deferred it and the stuck map has counted `after` deferring visits (the wall's 5);
//   NO ACCESS the void access was tried for it THIS visit and found no plan (runVisit `access`: `refused`, `noPlan`, the cell among
//             its `cells`). A visit with no access result -- VOIDFILL off, the access never reached -- waives NOTHING (review r1:
//             else a cell the access could fill would be waived for good without the access ever having been tried);
//   BOUNDED   at most `max` sealed-core waivers a record, ever -- decided again on the CURRENT record inside the publication
//             (sealedCoreMerge: two visits that each read the same generation never add up past the bound; review r1).
// The void's other cells (the air run under the base) are no record cells: nothing is done about them.
// SEALEDCORE=off|0|false|no is the rollback: nothing is waived, and a cell already waived reads open again (as before).

import { fullCube, solidFloor } from './buildsite.mjs'
import { isZigBlueprint, zigHidden } from './ziggurat.mjs'

const kOf = a => `${a[0]},${a[1]},${a[2]}`
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const LIQUIDISH = /water|lava|bubble_column|seagrass|kelp/

export const sealedCoreOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.SEALEDCORE ?? '').trim().toLowerCase())
/** after: deferring visits (wall.mjs WALL_WAIVE_AFTER); max: waived cells a record, ever; voidMax: the cells of one enclosed void. */
export const SEALED_CORE = Object.freeze({ after: 5, max: 8, voidMax: 16 })
export const SEALED_WHY = 'sealed_core'
/** The palette mark of a role any full solid completes (buildrun.mjs SOLID_ANY). */
export const FILL_MARK = '*solid'

/** Is `role` an interior FILL role of this palette (the blueprint's own mark: any solid is done there)? Pure. */
export const fillRole = (palette, role) => Array.isArray(palette?.[role]) && palette[role].includes(FILL_MARK)
/** The record's sealed-core waivers (its `waived` map may hold other kinds one day: only these count for the bound). Pure. */
const sealedCount = w => Object.values(w ?? {}).filter(v => v?.why === SEALED_WHY).length
/** A boundary block: a full cube. (Leaves are one too, and never a legal boundary: a record cell of leaves is not done, and leaves
 *  under the base are no solid floor -- a void that touches leaves is refused.) Pure. */
const wallBlock = b => fullCube(b)

/** Is this monument cell waived (the record's own `waived` map: wall.mjs wallWaived's shape)? Off, or another blueprint: never. Pure. */
export function sealedCoreWaived (rec, c, env = process.env) {
  return sealedCoreOn(env) && isZigBlueprint(rec?.blueprint) && !!rec?.waived && Array.isArray(c?.at) && Object.prototype.hasOwnProperty.call(rec.waived, kOf(c.at))
}
/** The monument visit's `alsoDone` -> (cell, read) -> bool: zigHidden, or a waived cell. Off: zigHidden itself. Pure. */
export function zigAlsoDone (rec, env = process.env) {
  if (!sealedCoreOn(env)) return zigHidden
  return (c, read) => zigHidden(c, read) || sealedCoreWaived(rec, c, env)
}

/**
 * THE ENCLOSED VOID round an open cell -> { ok: true, cells: [[x, y, z]] } | { ok: false, why }. Pure over `read`.
 *   rec      the monument record (`box` [x0, z0, x1, z1], `baseY`, `cells`)
 *   at       the open cell
 *   palette  the record's palette (fillRole);  isDone(cell, read)  the visit's completeness test
 */
export function sealedVoid (rec, at, read, { palette, isDone, voidMax = SEALED_CORE.voidMax } = {}) {
  const box = rec?.box, baseY = rec?.baseY
  if (!Array.isArray(box) || box.length !== 4 || !Number.isFinite(baseY)) return { ok: false, why: 'no_box' }
  const inBox = c => c[0] >= box[0] && c[0] <= box[2] && c[2] >= box[1] && c[2] <= box[3]
  const cellAt = new Map((rec.cells ?? []).map(c => [kOf(c.at), c]))
  const b0 = read(...at)
  if (!b0) return { ok: false, why: `unread ${kOf(at)}` }
  if (wallBlock(b0)) return { ok: false, why: 'not_open' }
  const seen = new Set([kOf(at)]), queue = [at], cells = []
  while (queue.length) {
    const c = queue.shift(), k = kOf(c)
    if (LIQUIDISH.test(nm(read(...c)))) return { ok: false, why: `liquid ${k}` }
    if (!inBox(c)) return { ok: false, why: `box_edge ${k}` }
    const rc = cellAt.get(k)
    if (rc && !fillRole(palette, rc.role)) return { ok: false, why: `visible_cell ${k}` }
    cells.push(c)
    if (cells.length > voidMax) return { ok: false, why: 'too_big' }
    for (const [dx, dy, dz] of N6) {
      const n = [c[0] + dx, c[1] + dy, c[2] + dz], nk = kOf(n)
      if (seen.has(nk)) continue
      const nb = read(...n)
      if (!nb) return { ok: false, why: `unread ${nk}` }
      if (!wallBlock(nb)) { seen.add(nk); queue.push(n); continue }
      const nc = cellAt.get(nk)
      if (nc) { if (!isDone(nc, read)) return { ok: false, why: `boundary_open ${nk}` }; continue }
      if (!(n[1] < baseY && inBox(n) && solidFloor(nb))) return { ok: false, why: `boundary_foreign ${nk}` }
    }
  }
  return { ok: true, cells }
}

/**
 * THE CELLS TO WAIVE NOW -> { due: [{ k, why: 'sealed_core', n, visits }], held: [{ k, why, visits }] } (`held`: the fill cells this
 * visit deferred that the rule refuses, each with its reason -- the visit names the first on a row). Pure.
 *   rec       the monument record;  deferred  runVisit's `deferred` [{ k, why, visits }]
 *   read, palette, isDone   as sealedVoid
 *   access    runVisit's `access` ({ result, noPlan, cells }) of THIS visit; null / undefined (no access result): never waived
 *   counts    { k: { visits } }: a lifetime tally of the deferrals (the stuck map forgets after 24 h), the larger count taken
 */
export function sealedCoreDue (rec, deferred = [], { read, palette, isDone, access, counts = {}, after = SEALED_CORE.after, max = SEALED_CORE.max, voidMax = SEALED_CORE.voidMax } = {}) {
  const out = { due: [], held: [] }
  if (!isZigBlueprint(rec?.blueprint) || typeof read !== 'function' || typeof isDone !== 'function') return out
  const cellAt = new Map((rec.cells ?? []).map(c => [kOf(c.at), c]))
  const have = rec.waived ?? {}
  let room = max - sealedCount(have)
  for (const d of deferred ?? []) {
    const k = String(d?.k ?? ''), c = cellAt.get(k)
    if (!c || have[k] || out.due.some(o => o.k === k) || !fillRole(palette, c.role)) continue
    const visits = Math.max(Number(counts?.[k]?.visits) || 0, Number(d?.visits) || 0)
    const hold = why => out.held.push({ k, why, visits })
    if (visits < after) { hold(`young ${visits}/${after}`); continue }
    if (!(access?.result === 'refused' && access.noPlan === true && (access.cells ?? []).includes(k))) { hold(access == null ? 'no_access_result' : `access_${access.result ?? 'unknown'}`); continue }
    const v = sealedVoid(rec, c.at, read, { palette, isDone, voidMax })
    if (!v.ok) { hold(v.why); continue }
    if (room <= 0) { hold(`cap ${max}`); continue }
    out.due.push({ k, why: SEALED_WHY, n: v.cells.length, visits }); room--
  }
  return out
}
/**
 * THE MERGE INTO THE CURRENT RECORD (the publication's own callback, run again on every attempt against the head it is given) ->
 * { rec: the next generation | null (nothing taken), took: [due entry], refused: [{ k, why }] }. Pure. `due` was decided on the
 * visit's own, possibly stale, record: here each cell is asked again of `cur` -- one `cur` already names is `already_waived` (never
 * written twice, never counted), and one past the bound (`max` sealed-core waivers on `cur`, the ones taken here counted) is
 * `cap <max>`. The visit names only `took` as waived.
 */
export function sealedCoreMerge (cur, due = [], { now = Date.now(), by = null, max = SEALED_CORE.max } = {}) {
  const out = { rec: null, took: [], refused: [] }
  if (!cur || !Array.isArray(due) || !due.length) return out
  const w = { ...(cur.waived ?? {}) }
  let room = max - sealedCount(w)
  for (const d of due) {
    if (Object.prototype.hasOwnProperty.call(w, d.k)) { out.refused.push({ k: d.k, why: 'already_waived' }); continue }
    if (room <= 0) { out.refused.push({ k: d.k, why: `cap ${max}` }); continue }
    w[d.k] = { why: SEALED_WHY, at: now, by, void: d.n }; out.took.push(d); room--
  }
  if (out.took.length) out.rec = { ...cur, waived: w }
  return out
}
