// STUCKFLEET-01: THREE CELLS NO REMEDY REACHED (control session 11-08, the owner's "anything stalled or stuck?").
//
// THE CASES (fleet 1e593b9b, goalwatch 11-08 13:30Z; 36 h of `_build_visit` / `_build` rows, records and region reads):
//   1. A ROAD LIGHT NO STAND REACHES (hive-a tidy 33 h, hive-c tidy 31 h, isolated-a tidy, isolated-d tidy): the stuck cell is a
//      `light` cell (a road torch, segment T-L) -- 355,68,225 on hive-a (stuck map 4 visits summed), -27,62,-100 on hive-c (5),
//      386,74,148 + 2 on isolated-a, 398,84,104 on isolated-d (a torch sited one above a bot's pillar, in mid air). The tidy's
//      waivers (wall.mjs wallWaiveDue, gkwork.mjs stallWaive) both skip `role light`, so the stage stops stuck_on_cell, the keeper
//      lets the lease go, the order backs off 6 h, and the report says "no bot is visiting" -- for good.
//      REMEDY lightWaiveDue: a light deferred GK_WAIVE_AFTER visits (summed over builders) is waived (a road torch is ornament; the
//      stage it holds is the town's ground), LIGHT_WAIVE_MAX a visit, outside the stage's share (lights never spent it).
//   2. A HELD CELL THE WAIVER NEVER SEES (isolated-d monument, F-S: 6 core cells, 318,68,116 a vine, `deferred why=retry_hold`
//      x34 in 36 h, stuck_on_cell visits=9, 7,271 cells waiting, 0 of 12 waivers used): buildretry-01 starts a held cell with its
//      attempts spent, so it is never in the waiver's candidates (runVisit `cand` wants attempts left) -- only deferred.
//      REMEDY heldWaiveCand: the waiver's candidates also carry the segment's HELD cells that read clear and wait on no open cell
//      below (the waiver's own mayWaive still decides: the ziggurat's foundation and core only, never its skin).
//   3. A CELL CAPPED BY ITS OWN UPPER LAYER (placebo-c monument 23 h, L02-E tier0 327,72,106: air, its four sides the layer's
//      cobble, under it L01 core dirt, over it L03-E's stair cell 327,73,106 holding DIRT -- no face any stand sees; 3,277 cells
//      wait on it; skin, so never waivable). zigsealed-01 opens such a column for a FOREIGN cell only, never for an air one.
//      REMEDY capDigs: the open record cells directly above a placeable cell no stand reaches, of segments that wait on its own
//      (they cannot be leased while it is open), holding a scaffold-class block, are dug highest first -- each is placed again by
//      its own segment later -- when the column above them is open; then the cell's top face is seen.
// STUCKFLEET=off is the rollback: every visit exactly as before.

const kOf = a => `${a[0]},${a[1]},${a[2]}`
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'

export const stuckFleetOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.STUCKFLEET ?? '').trim().toLowerCase())

export const LIGHT_WAIVE_AFTER = 2   // = tidy.mjs GK_WAIVE_AFTER: deferring visits, summed over builders, this one counted
export const LIGHT_WAIVE_MAX = 6     // lights waived a visit
/**
 * REMEDY 1 -> [{ k, why }]: the record's LIGHT cells this visit deferred (`deferred` = runVisit out.deferred: { k, why, visits }
 * with visits summed over builders), at `after`+ visits, not waived yet, at most `max`. Pure.
 */
export function lightWaiveDue (rec, deferred = [], { after = LIGHT_WAIVE_AFTER, max = LIGHT_WAIVE_MAX } = {}) {
  const lights = new Set((rec?.cells ?? []).filter(c => c?.role === 'light' && Array.isArray(c.at)).map(c => kOf(c.at)))
  const have = rec?.waived ?? {}
  const out = []
  for (const d of deferred ?? []) {
    if (out.length >= max) break
    const k = String(d?.k ?? '')
    if (!lights.has(k) || Object.prototype.hasOwnProperty.call(have, k) || out.some(o => o.k === k)) continue
    if ((Number(d?.visits) || 0) < after) continue
    out.push({ k, why: `light ${String(d?.why ?? 'no_stand').slice(0, 60)}` })
  }
  return out
}

/**
 * REMEDY 2 -> the waiver's candidates: `cand` (placeable cells no stand reaches) plus the segment's open cells that are HELD
 * (`held(k)`: buildretry-01), read clear (`clear(at)`), and wait on no open cell below (`below(c)`), each once. Pure.
 */
export function heldWaiveCand (open = [], cand = [], { held = () => false, clear = () => false, below = () => false } = {}) {
  const seen = new Set(cand.map(c => kOf(c.at)))
  const out = [...cand]
  for (const c of open ?? []) {
    const k = kOf(c.at)
    if (seen.has(k) || !held(k) || !clear(c.at) || below(c)) continue
    seen.add(k); out.push(c)
  }
  return out
}

export const CAP_MAX = 3             // cells dug over one capped cell
/**
 * REMEDY 3 -> [{ at, name }] highest first, or [] (nothing to do / refused). Pure.
 *   at          the placeable cell no stand reaches (air or a plant)
 *   read        (x, y, z) -> { name } | null
 *   isOpenAbove at -> an OPEN record cell of a segment that waits on this cell's segment (never this segment's: its own pass places it)
 *   scaffold    the scaffold-class names a visit may dig (buildrun.mjs FOREIGN_CLEAR)
 *   mayDig      at -> false never digs (a protected zone, another record's cell)
 * The column straight up from the cell: open record cells holding a scaffold-class block are taken; air or a plant there ends the
 * column OPEN (done); anything else -- a non-record block, a done cell, an unread cell, a veto, more than `max` -- refuses.
 */
export function capDigs (at, { read, isOpenAbove = () => false, scaffold = /^$/, mayDig = () => true, max = CAP_MAX } = {}) {
  if (!Array.isArray(at) || typeof read !== 'function') return []
  const digs = []
  for (let y = at[1] + 1; y <= at[1] + max + 1; y++) {
    const q = [at[0], y, at[2]]
    const b = read(...q)
    if (!b) return []
    const n = nm(b)
    if (AIRN(n) || b.boundingBox === 'empty') return digs.reverse()      // the column is open above the digs
    if (!isOpenAbove(q) || !scaffold.test(n) || !mayDig(q) || digs.length >= max) return []
    digs.push({ at: q, name: n })
  }
  return []
}

// ---- STUCKFLEET-02 (11-08): A CELL ORPHANED BY THE WAIVER BELOW IT -------------------------------------------------------------
// LIVE board-c tidy (fleet 1e593b9b, 11-08; stuck since 10:14Z): core 372,66,152 of a filled pit column (63 laid; 64 and 65 WAIVED
// `attempts stand`; 66 open; 67 earth over it). The region read: 64..68 of the column and every side cell at 66 are AIR -- the cell
// has no face to click, so no stand ever places it (stuck map 26 visits summed over 5 bots); 12 of the stage's 36 cells are waived,
// past gkwork's stall share (ceil(0.25 x 36) = 9), so nothing waives it and the stage holds for good. Two correct guards composing:
// the waiver gave the support up, and the stall share keeps the ground from being given up wholesale.
// REMEDY orphanWaiveDue: a deferred record cell whose cell BELOW is a waived record cell of this stage and which has NO solid face
// (all six neighbours read open; an unread one counts as solid: never on no evidence) is waived `orphan`, and so is each open record
// cell straight above it that is left with no solid face the same way (the column already given up below). It is the waiver's own
// consequence, not new ground given up: outside the stall share, but at most ORPHAN_MAX a visit and never past ORPHAN_CEIL of the
// stage waived in all (a stage never closes with more than half its cells undone). Never a light (stuckfleet-01 owns them).
export const ORPHAN_AFTER = 2        // deferring visits, summed over builders (= LIGHT_WAIVE_AFTER)
export const ORPHAN_MAX = 6          // cells waived a visit
export const ORPHAN_CEIL = 0.5       // the stage's waived share this remedy never passes
export const stuckFleet2On = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.STUCKFLEET2 ?? '').trim().toLowerCase())
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
/** A neighbour a placement could click -> bool: a solid block, or UNREAD (never "open" on no evidence). Pure. */
const faceSolid = b => !b || (b.boundingBox === 'block' && !AIRN(nm(b)))
/** Does the cell at `at` have any face to place against? -> bool. The WORLD decides (Codex r1 BLOCKER: a waived neighbour may hold a
 *  block -- a waiver removes nothing); `gone(k)` is for a caller's what-if only (the visit never passes it). Pure. */
export function hasFace (read, at, gone = () => false) {
  return N6.some(([dx, dy, dz]) => { const q = [at[0] + dx, at[1] + dy, at[2] + dz]; return !gone(kOf(q)) && faceSolid(read(...q)) })
}
/**
 * REMEDY 4 -> [{ k, why }]. Pure. `rec` the tidy stage (cells, waived), `deferred` runVisit's out.deferred ({ k, why, visits }),
 * `read` the world. The rules above; the cells straight above an orphan are taken only while each is open, a record cell, not a
 * light, and itself without a face.
 */
export function orphanWaiveDue (rec, deferred = [], read, { after = ORPHAN_AFTER, max = ORPHAN_MAX, ceil = ORPHAN_CEIL } = {}) {
  if (typeof read !== 'function') return []
  const cells = new Map((rec?.cells ?? []).filter(c => Array.isArray(c?.at) && c.role !== 'light').map(c => [kOf(c.at), c]))
  const have = rec?.waived ?? {}
  const waived = k => Object.prototype.hasOwnProperty.call(have, k)
  let room = Math.min(max, Math.floor(ceil * cells.size) - Object.keys(have).length)
  const out = [], taken = new Set()
  const gone = k => waived(k) || taken.has(k)
  const isOpen = at => { const b = read(...at); return !!b && (AIRN(nm(b)) || b.boundingBox === 'empty') }
  for (const d of deferred ?? []) {
    if (room <= 0) break
    const k = String(d?.k ?? '')
    const c = cells.get(k)
    if (!c || gone(k) || (Number(d?.visits) || 0) < after) continue
    const below = kOf([c.at[0], c.at[1] - 1, c.at[2]])
    if (!cells.has(below) || !waived(below) || !isOpen(c.at) || hasFace(read, c.at)) continue
    out.push({ k, why: `orphan:below_waived ${String(d?.why ?? 'no_stand').slice(0, 40)}` }); taken.add(k); room--
    for (let y = c.at[1] + 1; room > 0; y++) {
      const q = [c.at[0], y, c.at[2]], kq = kOf(q)
      if (!cells.has(kq) || gone(kq) || !isOpen(q) || hasFace(read, q)) break
      out.push({ k: kq, why: 'orphan:column_above' }); taken.add(kq); room--
    }
  }
  return out
}
