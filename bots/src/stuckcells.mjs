// STUCKCELLS-01: THE CELLS EVERY PROJECT WAITS ON (control session 11-01; OWNER 11-01 ~22:05Z "lets sort out 1,2,3").
//
// THE CASES (fleetstatus 11-01 21:43Z, measured on read-only region copies of each town and copies of its pool state):
//   hive-d shop      98 h `blocked earth: 4 open, 0 placeable now` -- the four earth cells hold ONE snow layer (placeable: vanilla
//                    replaces a single layer), but the visit's read (buildbot.mjs botBuildEffects) dropped the block's properties,
//                    so townplan.mjs replaceableCell read every snow cell as a layer of unknown height: never clear, never placed.
//                    The blocked shop was the town's first open project every order, so hive-d's stair got no visit for 20 h.
//   board-a house1   48 h stuck_on_cell, pad cell 327,66,151: an AIR POCKET sealed on all six faces (the pad's stone round it, dirt
//                    under it, a placed plank over it). No stand sees a face; the project's 6-h stuck stamp held every visit.
//   board-d shop     34 h stuck_on_cell, earth cell 353,66,118: the same sealed pocket, its top a done fill cell holding LEAVES.
//   isolated-b shop  94 h stuck_on_cell, earth cells 377,69,121 and 381,69,119: each under an open earth cell, in a one-high cave
//                    under the grass crust. Their only support is the floor below, seen only down a 1x1 shaft no stand stands in.
//   placebo-a ziggurat 19 h stuck_on_cell, plinth cell 203,60,-205: the bottom of a 7-deep 1x1 hole a bot dug through the
//                    foundation (203,60..66,-205); 1,941 cells wait on it.
//
// THE REMEDIES (pure here; runVisit's `p.waive`, buildShop's and buildMonument's done rules in skills.mjs):
//   1. THE SNOW READ: the visit's read carries a snow layer's properties (buildbot.mjs), as planReader's always did.
//   2. A SEALED POCKET IS DONE (sealedPocket): a structural cell (earth fill, the pad's base) whose six neighbours are all full,
//      non-leaf blocks is invisible and unreachable; it counts done, as the ziggurat's sealed core cell does (ziggurat.mjs
//      zigHidden, the same neighbour rule). Opened again (a neighbour dug), it is an ordinary open cell and is built.
//   3. THE WAIVER (runVisit `p.waive`, the wall's waiver brought inside the visit): a cell no stand reaches, deferred
//      WAIVE_AFTER visits by the summed stuck map (this one included), whose role the project may leave hidden (`mayWaive`: earth
//      fill under a workshop or house; the ziggurat's foundation), is WAIVED in the visit and the segment is read again -- the cell
//      above it in a 1x1 hole is then the next candidate, and is waived at once when it has no stand either (a waived cell under
//      it in its column: the chain). Bounded: `max` cells a record, ever (WAIVE_MAX_SHOP / WAIVE_MAX_ZIG). The record names
//      every waived cell (`waived`: { 'x,y,z': { why, at, by } }, a `waived` row each); a waived cell counts done everywhere.
//   4. A BLOCKED SEGMENT IS DEFERRED, NOT A WALL (runVisit `p.blockedDefers`): a cell holding a block the visit may not dig is
//      counted with the deferred cells (F4) -- the project's stuck stamp then lets the town's other projects go on, instead of
//      the blocked project being every bot's first order for good (hive-d's stair).
// STUCKCELLS=off is the rollback: every visit, read and order exactly as before.

const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const kOf = a => `${a[0]},${a[1]},${a[2]}`

export const stuckCellsOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.STUCKCELLS ?? '').trim().toLowerCase())
/** MONUSTUCK-01 (buildrun.mjs: stalkFell in the sealed column, the waiver beside a sealed cell, the dig walk's stand bans).
 *  MONUSTUCK=off is the rollback: every visit exactly as before. */
export const monuStuckOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.MONUSTUCK ?? '').trim().toLowerCase())
/** TIDYDEAD-01 (buildrun.mjs `p.hardDefers`, the tidy's visit only). TIDYDEAD=off is the rollback: every visit exactly as before. */
export const tidyDeadOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.TIDYDEAD ?? '').trim().toLowerCase())

/**
 * TIDYDEAD-01: THE HARD CELLS A VISIT DEFERS instead of stopping `blocked` / `attempts_spent` (fleet 11-04: placebo-b's tidy, 455 of
 * 512 visits `blocked` on ONE oak_leaves cell no dig stand reaches, 1 of 245 fills left; hive-d's, 252 visits `attempts_spent` on ONE
 * clear fill no click lands on, 205 fills in 78 other segments waiting). The tidy's waiver (wall.mjs wallWaiveDue) names only cells a
 * visit DEFERRED, and neither stop defers, so neither cell was ever waived. Pure.
 *   open      the segment's open cells [{ at }]
 *   clear     at -> the cell takes a placement now (buildrun.mjs isClear)
 *   tries     key -> the placement attempts this visit spent on it
 *   max       the attempts a cell gets a visit (BUILD_ATTEMPTS)
 *   waits     c -> the cell waits on another open cell below it in its column (buildrun.mjs `below`): neither hard nor a chance
 *   unreached keys whose clear THIS visit failed no_stand / unreached (a dig that was refused, unconfirmed or gone is a chance)
 *   lastTry   key -> the last click result this visit (named in the deferral's why)
 *   name      at -> the block in the cell (named in the why)
 * -> [{ k, why }] the hard cells, when every open cell is hard or waits on one | null (some cell still has a chance: the stop stands)
 */
export function hardDeferrals (open = [], { clear, tries = () => 0, max = 2, waits = () => false, unreached = new Set(), lastTry = new Map(), name = () => '' } = {}) {
  const out = []
  for (const c of open) {
    const k = kOf(c.at)
    if (!clear(c.at)) {
      if (!unreached.has(k)) return null                     // a block this visit could still dig: retried at once, as before
      out.push({ k, why: `blocked ${name(c.at) || 'unread'} unreached` })
    } else if ((tries(k) ?? 0) >= max) out.push({ k, why: `attempts ${lastTry.get(k) ?? 'spent'}` })
    else if (!waits(c)) return null                          // a clear cell with attempts left: never deferred
  }
  return out.length ? out : null
}

/** A block read through a mineflayer bot -> { name, boundingBox, props? } | null: a snow layer carries its properties (its
 *  `layers`: townplan.mjs replaceableCell). Never throws. */
export function readBlock (b, withProps = stuckCellsOn()) {
  if (!b) return null
  const v = { name: b.name, boundingBox: b.boundingBox }
  if (withProps && b.name === 'snow') { try { v.props = b.getProperties?.() ?? null } catch { v.props = null } }
  return v
}

/** The roles a sealed pocket may be left in: the ground under a building and its floor's base. */
export const HIDDEN_ROLES = Object.freeze(new Set(['fill', 'base']))
const fullNonLeaf = b => !!b && b.boundingBox === 'block' && !/_leaves$/.test(nm(b)) && !/water|lava|bubble_column/.test(nm(b)) && !/\[waterlogged\]/.test(String(b.name ?? ''))
/** A SEALED POCKET (remedy 2): the cell is read and not solid, and every one of its six neighbours is a read, full, non-leaf,
 *  dry block. Pure. */
export function sealedPocket (c, read, roles = HIDDEN_ROLES) {
  if (!c || !roles.has(c.role)) return false
  const [x, y, z] = c.at
  const self = read(x, y, z)
  if (!self || self.boundingBox === 'block') return false
  for (const [dx, dy, dz] of N6) if (!fullNonLeaf(read(x + dx, y + dy, z + dz))) return false
  return true
}
/** Is a record cell waived (the record's own list; the wall's and the paths' key format)? Pure. */
export const recWaived = (rec, c) => !!rec?.waived && Object.prototype.hasOwnProperty.call(rec.waived, kOf(c.at))

export const WAIVE_AFTER = 3          // deferring visits (summed over every builder, this one included) before a cell is waived
export const WAIVE_MAX_SHOP = 6       // a workshop's or a house's earth: at most this many waived cells, ever
export const WAIVE_MAX_ZIG = 12       // the ziggurat's foundation (the wall's own bound)
/** May a workshop or a house leave this cell hidden? Its earth fill only (never the floor, a wall or the roof). Pure. */
export const shopMayWaive = c => c?.role === 'fill'
/** May the ziggurat leave this cell hidden? Its foundation (the F segments: plinth and core under the first layer) and its CORE
 *  (the hidden fill inside every layer, ziggurat.mjs zigHidden's role) -- never its skin, its stair or its lights. Pure. */
export const zigMayWaive = c => /^F(-|$)/.test(String(c?.seg ?? '')) || c?.role === 'core'

/**
 * THE WAIVER'S PICK in a visit (remedy 3) -> [{ c, why }] lowest first. Pure. `cand` the segment's placeable cells no stand reaches
 * now; `counts` the stuck map summed over every builder (buildproj.mjs stuckRead), `waived(k)` a cell waived already (the record
 * or this visit), `room` how many more the record may waive, `cellAt(k)` the record's cell there. A cell is due at `after` visits
 * counting this one, or at once when the cell directly below it in its column is a waived cell of the same segment (the chain).
 */
export function waivePick (cand = [], { counts = {}, waived = () => false, room = 0, after = WAIVE_AFTER, mayWaive = () => false, cellAt = () => null } = {}) {
  const out = []
  for (const c of [...cand].sort((a, b) => a.at[1] - b.at[1])) {
    if (out.length >= room) break
    const k = kOf(c.at)
    if (!mayWaive(c) || waived(k)) continue
    const visits = (Number(counts[k]?.visits) || 0) + 1
    const belowK = kOf([c.at[0], c.at[1] - 1, c.at[2]])
    const below = cellAt(belowK)
    const chained = !!below && below.seg === c.seg && waived(belowK)
    if (visits >= after) out.push({ c, why: `no_stand ${visits} visits` })
    else if (chained) out.push({ c, why: `no_stand over waived ${belowK}` })
  }
  return out
}

/** A STAMP THE WAIVER WILL LIFT (skills.mjs projStuckLive): every cell an open record's stuck stamp names is done now, or would
 *  be waived by the next visit (mayWaive, `after` deferring visits already, room left, `clear(c)`: the cell and every open cell of
 *  its segment read clear -- the visit's own condition). Pure. */
export function stampLiftable (keys = [], rec = null, { done = () => false, counts = {}, mayWaive = () => false, max = 0, after = WAIVE_AFTER, clear = () => false } = {}) {
  if (!keys.length || !rec) return false
  const byKey = new Map((rec.cells ?? []).map(c => [kOf(c.at), c]))
  let room = max - Object.keys(rec.waived ?? {}).length
  for (const k of keys) {
    const c = byKey.get(k)
    if (!c) return false
    if (done(c)) continue
    // ...and only a cell the next visit COULD waive (Claude r1 BLOCK: the visit waives a placeable cell only, in a segment whose
    // open cells are all clear -- a stamp on a blocked or sealed cell lifted at once made the project every bot's first order again)
    if (!mayWaive(c) || recWaived(rec, c) || !clear(c) || (Number(counts[k]?.visits) || 0) + 1 < after || room <= 0) return false
    room--
  }
  return true
}

/**
 * THE VISIT'S OPTIONS (runVisit `p`) for a workshop or a house (`kind` 'shop') or the ziggurat ('zig'): a sealed pocket (shop
 * only) and a waived cell count done (`alsoDone`, composed with the visit's own `base`: the ziggurat's zigHidden), the waiver
 * (`waive`), a blocked cell deferred (`blockedDefers`, shop only: the ziggurat keeps its own `blocked`). {} when off. Pure.
 */
export function visitOpts (rec, kind, base = null, on = stuckCellsOn(), mayPlace = () => true) {
  if (!on || !rec) return {}
  const zig = kind === 'zig'
  const extra = zig ? (c => recWaived(rec, c)) : ((c, read) => recWaived(rec, c) || sealedPocket(c, read))
  return {
    alsoDone: base ? (c, read) => base(c, read) || extra(c, read) : extra,
    // never on a COMPLETE record's repair (Codex r1 BLOCK: its waivers could not be written; the repair would loop): a damaged
    // cell there is deferred as before (the order's repair back-off)
    ...(rec.structure_complete ? {} : { waive: { mayWaive: zig ? zigMayWaive : shopMayWaive, max: zig ? WAIVE_MAX_ZIG : WAIVE_MAX_SHOP, have: rec.waived ?? {} } }),
    // the ziggurat's FOOTING (the wall's remedy, buildrun.mjs footingBelow): a layer cell whose ground was dug away gets it back,
    // core blocks bottom-up, before any waiver; `mayPlace` the caller's (never a protected zone, never another record's cell)
    ...(zig ? { footing: { mayPlace, role: 'core' } } : { blockedDefers: true }),
  }
}
/** The record after a visit's waivers (runVisit out.waived) -> the new record | null (nothing new; a complete record; a record
 *  whose cells changed). At most the bound the visit applied (it counted the record's own list). Pure. */
export function withWaived (cur, waived = [], { cells = null, now = 0, by = null, max = Infinity, complete = false } = {}) {
  if (!cur || (cur.structure_complete && !complete) || !waived?.length) return null
  if (cells != null && cur.cells.length !== cells) return null
  const keys = new Set(cur.cells.map(c => kOf(c.at)))
  const w = { ...(cur.waived ?? {}) }
  let n = 0
  // the bound is the RECORD's (Claude r1: two builders' visits each counted from the same list): never past `max`, ever
  for (const d of waived) if (d?.k && keys.has(d.k) && !w[d.k] && Object.keys(w).length < max) { w[d.k] = { why: String(d.why ?? 'no_stand').slice(0, 80), at: now, by }; n++ }
  return n ? { ...cur, waived: w } : null
}
/** THE COMPLETION'S RECORD (Claude r1: a waiver whose own publish was lost, then the visit's completion, left the complete record
 *  reading damaged at that cell -- a repair loop): the visit's waivers merged into the record the completion writes. Pure. */
export const completeWithWaived = (cur, waived = [], o = {}) => withWaived(cur, waived, { ...o, complete: true }) ?? cur
