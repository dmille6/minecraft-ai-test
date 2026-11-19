// FILLCOLUMN-01 (planvalid-01show, 11-15, measured on the showcase). PURE: nothing here touches a bot or a file.
//
// WHY. Three days of the showcase's clean-up: the tidy accounts for 615 of 657 `stuck_on_cell` rows and 2,050 of 2,118 `deferred`
// rows. Of the 86 fill cells deferred in 3+ visits, 52 are AIR with no solid block below or on any side (the first solid 2-3 below
// for 36, 4+ below for 16) and no record cell under them: a cell planned in mid-air, which no stand can ever lay (buildsite.mjs
// stepFor clicks a SUPPORT: the block below or one of the four sides).
// THE CAUSE. Every survey plans a column from its ground up, so a column is sound when it is sited. The ground is then dug from
// under it (the bots mine and tunnel in the town), and the record can never follow:
//   - tidyrefresh.mjs refreshMerge adds whole columns only and refuses a column the record still works (`busy`) or names (`known`),
//     and "nothing is ever dropped": a deepened column's lower cells are never added, its floating cell never leaves;
//   - tidy.mjs siteStage hands the open columns to the rough survey as `planned`, so that survey does not even look at them.
// So the cell is deferred every visit until the stuck map's waiver names it, and then the cells above it float in their turn.
//
// WHAT (all of it over the record's own open fill cells; no survey rule changes):
//   planOrder      THE EXECUTABLE-ORDER CHECK: the open fills are "placed" into an overlay by the visit's own two rules (a support
//                  below or beside; never a cell while one below it in its column is open) until none can be. What is left can be
//                  laid in no order.
//   columnRepair   AT THE REFRESH (hourly, the keeper's: skills.mjs tidyRefresh, inside the publish): each column's lowest cell that
//                  no order reaches is judged. The column is read down to its floor (at most `addMax` cells, the column at most
//                  `depthMax`; never through water, a cell another record names, a protected zone, a reservation or a waived cell)
//                  and its missing lower cells are ADDED (role `core`, the cell's own segment) as far up as they stand IN the
//                  ground -- a floor under them and a side beside them. A cell that would stand free of every side (the ground
//                  round it was dug away too: a column raised there is a new pillar) and a column that cannot be read down to a
//                  floor are LEFT OUT: waived with a named reason, counted. A cell left out comes back at a later refresh once
//                  the ground has come back round it; else the next inside-the-wall record plans that ground anew.
//   waiveRests     THE WAIVER: a cell waived with open cells resting on it takes those cells with it in the same decision (a cell
//                  above that a side still holds stays: it is laid as before).
//   floatHold      AT THE VISIT: a cell no order reaches is passed (read done) for this visit instead of deferred and counted
//                  toward the waiver -- only on a record the refresh repairs, only while that refresh is not overdue, and only
//                  while its last repair left nothing unresolved.
// FILLCOLUMN=off is the rollback: no repair, no hold, the waiver and the rows as before.
//
// r2 (Codex review of b24d782dd, three blockers):
//   1. THE SURVEY'S OWN EXCLUSIONS. The repair adds no cell in a column the refresh's survey itself keeps off (`keepOff`: tidy.mjs
//      siteStage returns the predicate it used -- zones, the plan, wells, every project's columns and box, reservations, the yard),
//      and it is CLOSED (nothing added, nothing left out, said on the row) when that keep-out may be incomplete (repairClosed).
//   2. A LEDGER ON THE RECORD (`fillcol`: { add, left, cols: { "x,z": [n, lo] } }): the cells the repair ever added to a column
//      (at most `addMax`), never deeper than `depthMax` cells from the column's surveyed top nor under the survey's own scan
//      floor (home.y - `floorDy`), and at most repairAddMax(rec) cells a record, ever. The old caps counted open cells only, so a
//      column dug, filled and dug again was extended without bound. (r3: reconciled with the `ext` cells on every read.)
//   3. THE REPAIR'S WAIVERS ARE NOT THE STUCK WAIVER'S (waiveroom.mjs): every reason here starts `fillcolumn:`, no stuck-waiver
//      counter counts them, and they have their own cap (repairOutMax). At that cap a column is not repaired and nothing is waived;
//      the hold is then off, so its cells are deferred and counted like any stuck cell.
// r5 (Codex round 4): THERE IS NO SECOND PARSER. r2-r4 judged the exclusions' completeness with strict readers of their own, which
//   disagreed with the survey's lenient ones at the edges (a bridge sighting without its rows made the zone builder throw; a line
//   window counted differently). Now every reader and zone builder the survey's keep-out is built from takes an optional report
//   array and names there what it dropped, caught, cut off or fell back on, as it does so (skills.mjs fcKeepInputs, tidy.mjs
//   siteStage `report`); the repair is open only when that report is empty (reportNames / repairClosed). This module reads no file.

import { refUsable } from './buildsite.mjs'
import { isLiquid, replaceableCell } from './townplan.mjs'
import { refreshedAt, tidyRefreshOn, TIDYREFRESH } from './tidyrefresh.mjs'
import { TIDY, INWALL, GK_WAIVE_SHARE } from './tidy.mjs'
import { ROUGH } from './roughground.mjs'
import { repairWaivedN } from './waiveroom.mjs'

/**
 * THE BOUNDS, each the survey's own constant:
 *   addMax     cells the repair ever adds to one column: tidy.mjs INWALL.holeMax / roughground.mjs ROUGH.fillMax (4: the deepest hole
 *              the inside-the-wall rules fill)
 *   depthMax   no added cell lower than depthMax - 1 under the column's surveyed top: tidy.mjs TIDY.pitDepthMax (6: "a deeper hole is
 *              a mine")
 *   floorDy    no added cell under home.y - floorDy: tidy.mjs TIDY.dy (14: the survey's scan reads no lower)
 *   recShare / recMin   cells the repair ever adds to one record: a tenth of its surveyed fills, at least 48
 *   outShare / outMin   cells the repair leaves out (with the waiver's dependents): a tenth of its surveyed fills (tidy.mjs
 *              GK_WAIVE_SHARE, the groundskeeper's own waiver room), at least 12 (wall.mjs WALL_WAIVE_MAX)
 *   refreshMax cells added in one refresh (the rest wait an hour); rounds: one cell a column is judged a round; holdMs: the visit's
 *              hold lapses when the last survey is this old (two refresh periods: no keeper is refreshing).
 */
export const FILLCOLUMN = Object.freeze({ addMax: Math.max(INWALL.holeMax, ROUGH.fillMax), depthMax: TIDY.pitDepthMax, floorDy: TIDY.dy,
  recShare: 0.1, recMin: 48, outShare: GK_WAIVE_SHARE, outMin: 12, refreshMax: 200, rounds: 12, holdMs: 2 * 60 * 60_000, hollowMax: 4 })
/** THE SWITCH: FILLCOLUMN=off|0|false|no -> off; on by default. Pure. */
export const fillColumnOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.FILLCOLUMN ?? '').trim())

const k2 = (x, z) => `${x},${z}`
const kOf = at => at.join(',')
const colOf = at => k2(at[0], at[2])
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'
const hasOwn = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]
/** The roles that are earth laid in a column (never a light, a planting, a staircase's stone). */
export const FILL_ROLES = new Set(['earth', 'core', 'topsoil'])
// a column with a plot's levelling, a hollow under a crust cut, a site prep, a floor repair or a dam keeps its own bookkeeping
const special = c => c.plot != null || !!c.opener || !!c.prep || !!c.floorFix || !!c.dam

/** IS THERE A SUPPORT AT (x, y, z)? -> a memoised reader over `read`: the visit's own test (buildsite.mjs refUsable). An UNREAD cell
 *  is no evidence and reads as a support: nothing is ever called floating on a cell nobody read. */
export function supportOf (read) {
  const m = new Map()
  return (x, y, z) => {
    const k = `${x},${y},${z}`
    let v = m.get(k)
    if (v === undefined) { const b = read(x, y, z); v = !b || refUsable(b); m.set(k, v) }
    return v
  }
}

/**
 * THE EXECUTABLE ORDER -> { ok, order: [[x, y, z]], left: [cell] }. Pure over `read`. `cells` are the OPEN fills. The visit lays a
 * cell only against a support -- the block below it or beside it (stepFor) -- and never while a cell below it in its column is open
 * (buildrun.mjs runVisit `below`). The cells are placed into an overlay in an order that keeps both rules until none can be:
 * `order` is that order, `left` the cells no order reaches.
 */
export function planOrder (cells, read, { support = supportOf(read) } = {}) {
  const cols = new Map()
  for (const c of cells ?? []) { if (!Array.isArray(c?.at)) continue; const k = colOf(c.at); if (!cols.has(k)) cols.set(k, []); cols.get(k).push(c) }
  for (const v of cols.values()) v.sort((a, b) => a.at[1] - b.at[1])
  const head = new Map([...cols.keys()].map(k => [k, 0]))
  const placed = new Set(), order = []
  const S = (x, y, z) => placed.has(`${x},${y},${z}`) || support(x, y, z)
  const ready = ([x, y, z]) => S(x, y - 1, z) || SIDES.some(([dx, dz]) => S(x + dx, y, z + dz))
  const work = [...cols.keys()]
  while (work.length) {
    const k = work.pop(), v = cols.get(k)
    let i = head.get(k), moved = false
    while (i < v.length && ready(v[i].at)) { placed.add(kOf(v[i].at)); order.push(v[i].at); i++; moved = true }
    head.set(k, i)
    if (!moved) continue
    const [x, z] = k.split(',').map(Number)
    for (const [dx, dz] of SIDES) { const q = k2(x + dx, z + dz); if (cols.has(q) && head.get(q) < cols.get(q).length) work.push(q) }
  }
  const left = []
  for (const [k, v] of cols) for (let i = head.get(k); i < v.length; i++) left.push(v[i])
  return { ok: !left.length, order, left }
}

/** THE OPEN FILLS of a record -> [cell]: earth roles, not carried (`prev`), not waived, not a cell another record names now
 *  (`guard`), not done (`done(cell)`: the visit's done test). Pure. */
export function openFills (rec, { done = () => false, guard = new Set() } = {}) {
  const w = rec?.waived ?? null
  return (rec?.cells ?? []).filter(c => Array.isArray(c?.at) && FILL_ROLES.has(c.role) && !c.prev && !hasOwn(w, kOf(c.at)) && !guard.has(kOf(c.at)) && !done(c))
}
/** THE FLOATING CELLS -> { open, stuck, left }: `stuck` every open fill no order reaches (planOrder), `left` those in the columns the
 *  repair judges (never a column with its own bookkeeping: `special`). Pure over `read`. */
export function floatCells (rec, read, { done = () => false, guard = new Set(), support = supportOf(read) } = {}) {
  const open = openFills(rec, { done, guard })
  const po = planOrder(open, read, { support })
  const sp = new Set(open.filter(special).map(c => colOf(c.at)))
  return { open, stuck: po.left, left: po.left.filter(c => !sp.has(colOf(c.at))) }
}
/** THE SELF-CHECK (a survey's or a refresh's last word; logged, never thrown) -> { open, left, first } | null (the switch is off).
 *  Pure; an error reads `err`, never a throw. */
export function planSelfCheck (rec, read, { done = () => false, guard = new Set(), env = process.env } = {}) {
  if (!fillColumnOn(env)) return null
  try {
    const f = floatCells(rec, read, { done, guard })
    return { open: f.open.length, left: f.stuck.length, first: f.stuck[0]?.at ?? null }
  } catch (e) { return { open: 0, left: 0, first: null, err: String(e?.message ?? e).slice(0, 60) } }
}

/** The record's surveyed fills (never a carried cell, never a cell the repair added): what the two shares are taken of. Pure. */
const surveyedN = rec => (rec?.cells ?? []).filter(c => FILL_ROLES.has(c?.role) && !c.prev && !c.ext).length
/** The most cells the repair may ever add to this record -> n. Pure. */
export const repairAddMax = (rec, T = FILLCOLUMN) => Math.max(T.recMin, Math.ceil(T.recShare * surveyedN(rec)))
/** The most cells the repair (and the waiver's dependents) may have left out on this record -> n. Pure. */
export const repairOutMax = (rec, T = FILLCOLUMN) => Math.max(T.outMin, Math.ceil(T.outShare * surveyedN(rec)))
/** THE RECORD'S LEDGER -> { add, left, cols }: the cells the repair ever added, the cells its last run left unresolved, and per column
 *  [cells ever added, the lowest y ever added]. A record without one (every record before r2) reads zero. Pure. */
export function repairLedger (rec) {
  const f = rec?.fillcol
  const lo = v => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  const cols = {}
  if (f?.cols && typeof f.cols === 'object' && !Array.isArray(f.cols)) for (const [k, v] of Object.entries(f.cols)) cols[k] = [Math.max(0, Number(v?.[0]) || 0), lo(v?.[1])]
  // RECONCILED WITH THE CELLS (r3, Codex round 2): every cell the repair added carries `ext` and stays on the record laid, open or
  // waived. Per column the count is the greater of the ledger's and the `ext` cells present, the lowest y the lower of the two, and
  // the record's total likewise -- a record republished without its ledger (or with an older one) has spent its budget all the same
  const seen = new Map()
  let ext = 0
  for (const c of rec?.cells ?? []) {
    if (!c?.ext || !Array.isArray(c.at)) continue
    ext++
    const k = colOf(c.at), e = seen.get(k)
    seen.set(k, [(e?.[0] ?? 0) + 1, Math.min(e?.[1] ?? Infinity, c.at[1])])
  }
  for (const [k, [cnt, low]] of seen) cols[k] = [Math.max(cols[k]?.[0] ?? 0, cnt), Math.min(cols[k]?.[1] ?? Infinity, low)]
  return { add: Math.max(Math.max(0, Number(f?.add) || 0), ext), left: Math.max(0, Number(f?.left) || 0), cols }
}
/** THE REPORT'S INPUTS -> [name], each once, in the order first named. Pure. The report is the one the survey's own readers and zone
 *  builders wrote as they built its keep-out (tidy.mjs siteStage `report`; skills.mjs fcKeepInputs): { input, why } for whatever one
 *  of them dropped, caught, cut off or fell back on. This module parses none of those files itself. */
export const reportNames = report => [...new Set((report ?? []).map(r => String(r?.input ?? '?')))]
/** IS THE REPAIR CLOSED THIS REFRESH? -> why | null. Pure. Closed without the survey's own exclusions (`keepOff`), or with anything
 *  their own readers reported (`unread`: reportNames of the survey's report): fail closed -- nothing is added on a keep-out that
 *  may be smaller than the town's. */
export function repairClosed ({ keepOff = null, unread = [] } = {}) {
  if ((unread ?? []).length) return `excl_unread:${unread.join('+')}`.slice(0, 40)
  return typeof keepOff === 'function' ? null : 'no_exclusions'
}

/**
 * THE REPAIR -> { rec: the next record | null (nothing to change), n: { ext, add, deep, drop, back, left, total, closed, wait, why },
 * added: [cell], dropped: [{ k, why }] }. Pure over `read`.
 *   done(cell), guard   the visit's done test and the cells another record names now (the visit's own guard)
 *   mayAdd([x, y, z])   may a cell be added here (never a protected zone)
 *   keepOff(x, z)       the refresh's survey's own exclusions -> reason | null (tidy.mjs siteStage `keepOff`)
 *   closed              why the repair may not run at all (repairClosed), else null
 * Round by round, each column's LOWEST cell no order reaches is judged (the cells above it wait for the next round):
 *   - the column is read down from it to its floor (a support, or an open cell of the record an order reaches); a reason on the way
 *     -- `excluded`, `deep`, `budget`, `water`, `guarded`, `blocked`, `waived_below`, `record_below` -- leaves the cell out, while
 *     the repair's own room for omissions lasts (repairOutMax); an unread cell, a full page (`refreshMax`), the record's lifetime
 *     cap (`rec_cap`) or that room spent (`out_cap`) leaves the column as it is: not repaired, nothing waived (`n.wait`);
 *   - the missing cells and the cell itself are KEPT bottom-up while each stands on a kept cell or the floor AND has a side beside
 *     it (a support, an open cell an order reaches, a cell kept in this round, a cell of a column that waits); kept missing cells
 *     are added, a cell not kept is left out (`bare`).
 * A cell an earlier repair left out comes back (its waiver removed) once a block is read under it and one beside it.
 * `n`: ext columns extended, add cells added, deep columns left out as too deep (`deep`, `budget`), drop cells left out (every
 * reason, `why` by reason), back cells that came back, left cells still unexecutable (the columns that wait: `wait` by reason),
 * total the cells the repair ever added to this record, closed 1 when it did not run.
 * The record's ledger (`fillcol`) is written whenever it changes.
 */
export function columnRepair (rec, read, { done = () => false, guard = new Set(), mayAdd = () => true, keepOff = () => null, closed = null, now = Date.now(), by = 'fillcolumn', T = FILLCOLUMN } = {}) {
  const n = { ext: 0, add: 0, deep: 0, drop: 0, back: 0, left: 0, total: 0, closed: closed ? 1 : 0, wait: {}, why: {} }
  const added = [], dropped = []
  if (!rec || rec.structure_complete) return { rec: null, n, added, dropped }
  const led = repairLedger(rec)
  n.total = led.add
  const support = supportOf(read)
  // (the world does not move under one repair: each cell's done test is asked once, whatever the number of rounds)
  const dm = new Map()
  const doneOnce = c => { const k = kOf(c.at); let v = dm.get(k); if (v === undefined) { v = !!done(c); dm.set(k, v) } return v }
  const colsL = { ...led.cols }
  // the record with its ledger as it stands now -> rec | null (nothing changed): written when a cell was added, when the unresolved
  // count moved (the visit's hold reads it), when the record itself changed, or when the ledger on it is not the reconciled one
  const out = cur => {
    n.left = floatCells(cur, read, { done: doneOnce, guard, support }).left.length
    n.total = led.add + added.length
    const next = { add: n.total, left: n.left, cols: colsL }
    const same = rec.fillcol ? JSON.stringify(rec.fillcol) === JSON.stringify(next) : (!next.add && !next.left && !Object.keys(colsL).length)
    return cur === rec && same ? null : { ...cur, fillcol: next }
  }
  // CLOSED (the exclusions could not be read): nothing is added, nothing left out, nothing comes back
  if (closed) return { rec: out(rec), n, added, dropped }
  // 0. a cell left out by an earlier repair COMES BACK when the ground has come back round it: a block READ under it and one READ
  // beside it now (the pit round it was filled since) -- it is the survey's own cell again, laid like any other. Never a cell left
  // out for whose ground it is (`guarded`, `excluded`): that is not the ground's to answer
  let cur = rec
  {
    const solidNow = (x, y, z) => { const b = read(x, y, z); return !!b && refUsable(b) }
    const back = Object.entries(rec.waived ?? {}).filter(([k, v]) => {
      if (!/^fillcolumn:(?!guarded$|excluded$|keepoff:)/.test(String(v?.why ?? ''))) return false   // t11reach2: another project's ground never comes back
      const [x, y, z] = k.split(',').map(Number)
      return solidNow(x, y - 1, z) && SIDES.some(([dx, dz]) => solidNow(x + dx, y, z + dz))
    }).map(([k]) => k)
    if (back.length) { const w = { ...rec.waived }; for (const k of back) delete w[k]; cur = { ...rec, waived: w }; n.back = back.length }
  }
  const home = rec.home ?? { x: 0, z: 0 }
  const far = k => { const [x, z] = k.split(',').map(Number); return Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) }
  const extCols = new Set(), deepCols = new Set(), wait = new Set()
  const waits = (k, why) => { wait.add(k); n.wait[why] = (n.wait[why] ?? 0) + 1 }
  // each column's surveyed top (its highest fill the repair did not add): the depth bound's anchor, the same at every refresh
  const colTop = new Map()
  for (const c of rec.cells ?? []) { if (!Array.isArray(c?.at) || !FILL_ROLES.has(c.role) || c.prev || c.ext) continue; const k = colOf(c.at); if (!(colTop.get(k) >= c.at[1])) colTop.set(k, c.at[1]) }
  const floorY = Number.isFinite(Number(home.y)) ? Number(home.y) - T.floorDy : -Infinity
  const recMax = repairAddMax(rec, T), outMax = repairOutMax(rec, T)
  // every cell the record names (its fills, cuts and clears): never planned twice (the cells added below join it)
  const known = new Set([...(rec.cells ?? []), ...(rec.cut ?? []), ...(rec.clear ?? [])].filter(q => Array.isArray(q?.at)).map(q => kOf(q.at)))
  for (let round = 0; round < T.rounds; round++) {
    const f = floatCells(cur, read, { done: doneOnce, guard, support })
    const lows = new Map()
    for (const c of f.left) { const k = colOf(c.at); if (wait.has(k)) continue; const o = lows.get(k); if (!o || c.at[1] < o.at[1]) lows.set(k, c) }
    if (!lows.size) break
    const stuckK = new Set(f.stuck.map(c => kOf(c.at)))
    const reach = new Set(f.open.map(c => kOf(c.at)).filter(k => !stuckK.has(k)))   // the open cells an order reaches: solid in time
    const w = cur.waived ?? null
    // 1. every column read down to its floor, nearest home first (the page's order)
    const plan = new Map()
    let room = T.refreshMax - added.length, recRoom = recMax - led.add - added.length
    for (const [k, L] of [...lows].sort((a, b) => far(a[0]) - far(b[0]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      const [x, y, z] = L.at
      const gap = []
      const had = Math.max(0, Number(colsL[k]?.[0]) || 0)
      const minY = Math.max((colTop.get(k) ?? y) - (T.depthMax - 1), floorY)
      let why = keepOff(x, z) ? 'excluded' : null
      for (let i = 1; !why; i++) {
        const q = [x, y - i, z], qk = kOf(q), b = read(...q)
        if (!b) { why = 'unread'; break }
        if (refUsable(b) || reach.has(qk)) break
        if (hasOwn(w, qk)) { why = 'waived_below'; break }
        if (known.has(qk)) { why = 'record_below'; break }
        if (guard.has(qk) || !mayAdd(q)) { why = 'guarded'; break }
        if (isLiquid(b) || String(b.name ?? '').includes('waterlogged')) { why = 'water'; break }
        if (!(AIRN(nm(b)) || replaceableCell(b) || b.boundingBox === 'empty')) { why = 'blocked'; break }
        if (y - i < minY) { why = 'deep'; break }
        if (had + i > T.addMax) { why = 'budget'; break }
        gap.push(q)
      }
      if (!why && !gap.length) why = 'unread'   // (a floor right under a cell no order reaches: no evidence to act on)
      if (!why && gap.length > recRoom) why = 'rec_cap'
      if (!why && gap.length > room) why = 'cap'
      if (why === 'unread' || why === 'cap' || why === 'rec_cap') { waits(k, why); continue }
      if (!why) { room -= gap.length; recRoom -= gap.length }
      plan.set(k, { L, cand: why ? [] : [...gap.reverse(), L.at], why })
    }
    // 2. what stands IN the ground: kept bottom-up, a floor under it and a side beside it
    let kept
    for (;;) {
      // the cells of the columns that wait (and of the columns with their own bookkeeping) are not judged: they may yet be laid
      const maybe = new Set(f.stuck.filter(c => !plan.has(colOf(c.at))).map(c => kOf(c.at)))
      kept = new Set()
      const S = (x, y, z) => { const q = `${x},${y},${z}`; return kept.has(q) || reach.has(q) || support(x, y, z) }
      const at = new Map([...plan.keys()].map(k => [k, 0]))
      const work = [...plan.keys()]
      while (work.length) {
        const k = work.pop(), cand = plan.get(k).cand
        let i = at.get(k), moved = false
        while (i < cand.length) {
          const [x, y, z] = cand[i]
          if (!S(x, y - 1, z) || !SIDES.some(([dx, dz]) => S(x + dx, y, z + dz) || maybe.has(`${x + dx},${y},${z + dz}`))) break
          kept.add(kOf(cand[i])); i++; moved = true
        }
        at.set(k, i)
        if (!moved) continue
        const [x, z] = k.split(',').map(Number)
        for (const [dx, dz] of SIDES) { const q = k2(x + dx, z + dz); if (plan.has(q) && at.get(q) < plan.get(q).cand.length) work.push(q) }
      }
      // THE OMISSIONS' OWN ROOM (repairOutMax, never the stuck waiver's): a column whose cell would be left out past it is NOT
      // repaired at all -- nothing added, nothing waived; it waits (`out_cap`), and what stood on it is judged again without it
      let outRoom = outMax - repairWaivedN(cur.waived), over = false
      for (const [k, p] of plan) {
        if (kept.has(kOf(p.L.at))) continue
        if (outRoom > 0) { outRoom--; continue }
        plan.delete(k); waits(k, 'out_cap'); over = true
      }
      if (!over) break
    }
    // 3. the round's changes: the kept missing cells added, the cell left out when it is not kept
    const add = [], waive = {}
    for (const [k, p] of plan) {
      const lk = kOf(p.L.at), n0 = add.length
      for (const q of p.cand) { const qk = kOf(q); if (qk !== lk && kept.has(qk)) add.push({ at: q, role: 'core', seg: p.L.seg, added: now, ext: true }) }
      if (add.length > n0) extCols.add(k)
      if (kept.has(lk)) continue
      const why = p.why ?? 'bare'
      if (why === 'deep' || why === 'budget') deepCols.add(k)
      waive[lk] = { why: `fillcolumn:${why}`, at: now, by }
      dropped.push({ k: lk, why: `fillcolumn:${why}` })
      n.why[why] = (n.why[why] ?? 0) + 1
    }
    if (!add.length && !Object.keys(waive).length) break
    added.push(...add)
    for (const c of add) { known.add(kOf(c.at)); const k = colOf(c.at), e = colsL[k]; colsL[k] = [(Number(e?.[0]) || 0) + 1, Math.min(e?.[1] ?? Infinity, c.at[1])] }
    cur = { ...cur, cells: add.length ? [...(cur.cells ?? []), ...add] : cur.cells, waived: Object.keys(waive).length ? { ...(cur.waived ?? {}), ...waive } : cur.waived,
      ...(add.length ? { bom: { ...(cur.bom ?? {}), earth: (Number(cur.bom?.earth) || 0) + add.length } } : {}) }
  }
  n.ext = extCols.size; n.add = added.length; n.deep = deepCols.size; n.drop = dropped.length
  return { rec: out(cur), n, added, dropped }
}

/**
 * T11REACH2-01show (rig runs 19 and 21, 11-19: the T11 plateau). A HOLLOW'S FILL OVER A CAVE -> { rec, n: { add, deep }, added, hollow }.
 * Pure over `read`. A fill that names the cut opening it (`opener`: a hollow under a crust) is the record's own bookkeeping, so
 * columnRepair never judges its column (`special`) and no waiver may take it (gkWaivable / stallWaive) -- and when the ground under
 * it was a cave the survey never planned (-33,68,-12: grass at 69, air 66-68, stone at 65; the cell is `no_support` every visit and
 * 28 open cells wait on it), the two correct rules compose into a dead end. Here, for each such column whose lowest open fill no
 * order reaches (planOrder), the column is read down from that cell to its floor:
 *   (a) a floor at most `hollowMax` cells down: the cells between are ADDED as `core` (buried: cobblestone allowed), in the cell's
 *       own segment and naming its opener, so they are laid bottom-up first (runVisit `below`) and the cell then stands on them;
 *   (b) more than `hollowMax` cells of air: a DEEP hollow -- the column's open opener cells get `hollowDeep` (deferred as before,
 *       the crust left alone; the waivers may now take them) and a row names it (`hollow`).
 * Anything else on the way down (water, a record cell, a guarded or excluded cell, a block that is not air, an unread cell) leaves
 * the column as it is. Never when the repair is `closed`; the record's lifetime add cap (repairAddMax) is shared with columnRepair
 * (the added cells carry `ext`).
 */
export function hollowFloor (rec, read, { done = () => false, guard = new Set(), mayAdd = () => true, keepOff = () => null, closed = null, now = Date.now(), T = FILLCOLUMN } = {}) {
  const n = { add: 0, deep: 0, off: 0 }, added = [], hollow = [], dropped = []
  if (!rec || rec.structure_complete || closed) return { rec: null, n, added, hollow, dropped }
  const support = supportOf(read)
  const f = floatCells(rec, read, { done, guard, support })
  const lows = new Map()
  for (const c of f.stuck) {
    if (!c.opener || c.hollowDeep || c.plot != null || c.prep || c.floorFix || c.dam) continue
    const k = colOf(c.at), o = lows.get(k)
    if (!o || c.at[1] < o.at[1]) lows.set(k, c)
  }
  // CODEX r9 BLOCKER (t11reach2): A GREY RE-TOP WITH AIR UNDER IT (the visit holds it `air_below`: digging it opens the cave) would
  // hold its column's cut for good -- the cap is never dug, never waived (an empty-bag wait is no strike). The refresh DEFERS it:
  // waived `fillcolumn:air_below` (the grey crust left alone), and the grade cuts above it in its column leave the record with it
  const ab = {}
  for (const c of rec.cells ?? []) {
    if (!c?.retop || c.role !== 'topsoil' || !Array.isArray(c.at) || hasOwn(rec.waived, kOf(c.at)) || done(c)) continue
    const top = read(...c.at), under = read(c.at[0], c.at[1] - 1, c.at[2])
    if (!top || AIRN(nm(top)) || !refUsable(top)) continue
    if (!under || AIRN(nm(under)) || isLiquid(under) || under.boundingBox === 'empty') ab[kOf(c.at)] = { why: 'fillcolumn:air_below', at: now, by: 'fillcolumn' }
  }
  if (!lows.size && !Object.keys(ab).length) return { rec: null, n, added, hollow, dropped }
  const known = new Set([...(rec.cells ?? []), ...(rec.cut ?? []), ...(rec.clear ?? [])].filter(q => Array.isArray(q?.at)).map(q => kOf(q.at)))
  const w = rec.waived ?? null
  let room = repairAddMax(rec, T) - repairLedger(rec).add
  const add = [], deepCols = new Set(), off = {}
  for (const [k, L] of [...lows].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const [x, y, z] = L.at
    // ANOTHER PROJECT'S GROUND (rig run 24: -33,68,-12 lies in house1's columns, `project:house1`). keepOff is the survey's own
    // exclusions -- the columns where the tidy plans nothing, a project's box and gap among them (tidy.mjs siteStage) -- so a tidy
    // fill there is one planned before that project claimed the ground: today's survey would not plan it, and nothing may be added
    // under it. It LEAVES the work list: waived `fillcolumn:keepoff:<reason>` (the record keeps it; the repair's own waiver, never
    // the stuck waiver's -- waiveroom.mjs), and its pending crust cut with it (below). Only a cell no order reaches: one the visit
    // can still lay is laid as before
    const ko = keepOff(x, z)
    if (ko) { off[kOf(L.at)] = { why: `fillcolumn:keepoff:${String(ko).slice(0, 40)}`, at: now, by: 'fillcolumn' }; continue }
    const gap = []
    let floor = false, stop = false
    for (let i = 1; i <= T.hollowMax + 1; i++) {
      const q = [x, y - i, z], qk = kOf(q), b = read(...q)
      if (!b) { stop = true; break }
      if (refUsable(b)) { floor = true; break }
      if (known.has(qk) || hasOwn(w, qk) || guard.has(qk) || !mayAdd(q)) { stop = true; break }
      if (isLiquid(b) || String(b.name ?? '').includes('waterlogged')) { stop = true; break }
      if (!(AIRN(nm(b)) || replaceableCell(b) || b.boundingBox === 'empty')) { stop = true; break }
      gap.push(q)
    }
    if (stop) continue
    if (floor && gap.length && gap.length <= T.hollowMax) {
      if (gap.length > room) continue
      room -= gap.length
      for (const q of gap.reverse()) add.push({ at: q, role: 'core', seg: L.seg, opener: L.opener, added: now, ext: true })
      hollow.push({ kind: 'under', cell: L.at, n: gap.length })
    } else if (!floor && gap.length > T.hollowMax) {
      deepCols.add(k)
      hollow.push({ kind: 'deep', cell: L.at, n: gap.length })
    }
  }
  for (const [k, v] of Object.entries(ab)) off[k] = v
  if (!add.length && !deepCols.size && !Object.keys(off).length) return { rec: null, n, added, hollow, dropped }
  added.push(...add)
  n.add = add.length; n.deep = deepCols.size; n.off = Object.keys(off).length
  for (const [k, v] of Object.entries(off)) { dropped.push({ k, why: v.why }); hollow.push({ kind: hasOwn(ab, k) ? 'air_below' : 'keepoff', cell: k.split(',').map(Number), n: 0 }) }
  const cells = (rec.cells ?? []).map(c => (c?.opener && Array.isArray(c.at) && deepCols.has(colOf(c.at)) && !c.hollowDeep ? { ...c, hollowDeep: now } : c))
  // THE CRUST LEFT ALONE (Codex r1 BLOCKER): a deep hollow's fills may now be waived, so the cut that would open it must not be dug
  // after them -- every cut a marked fill names as its opener leaves the record (a cut already dug is gone from the world anyway)
  const retire = new Set(cells.filter(c => (c?.hollowDeep === now || hasOwn(off, kOf(c.at))) && Array.isArray(c.opener)).map(c => kOf(c.opener)))
  // ...and an air_below cap's column: every grade cut above it
  const abCols = new Map(Object.keys(ab).map(k => { const [x, y, z] = k.split(',').map(Number); return [k2(x, z), y] }))
  const overAb = q => Array.isArray(q?.at) && q.grade && abCols.has(k2(q.at[0], q.at[2])) && q.at[1] > abCols.get(k2(q.at[0], q.at[2]))
  if (abCols.size) for (const q of rec.cut ?? []) if (overAb(q)) retire.add(kOf(q.at))
  const cut = retire.size ? (rec.cut ?? []).filter(q => !(Array.isArray(q?.at) && retire.has(kOf(q.at)))) : rec.cut
  n.retired = (rec.cut ?? []).length - (cut ?? []).length
  return { rec: { ...rec, cells: [...cells, ...add], ...(retire.size ? { cut } : {}), ...(n.off ? { waived: { ...(rec.waived ?? {}), ...off } } : {}), ...(add.length ? { bom: { ...(rec.bom ?? {}), earth: (Number(rec.bom?.earth) || 0) + add.length } } : {}) }, n, added, hollow, dropped }
}

/**
 * THE REFRESH'S OWN STEP (skills.mjs tidyRefresh, inside the publish) -> { res, fx }: tidyrefresh.mjs refreshMerge's result with the
 * repaired record in it (`res.rec`), and the repair (`fx`: columnRepair's, or null with the switch off -- `res` is then the very
 * object it was given). `cur` is the head now; the repair runs on what the merge made of it. Pure.
 */
export function refreshRepair (res, cur, read, opts = {}, env = process.env) {
  if (!fillColumnOn(env)) return { res, fx: null }
  const base = res?.rec ?? cur
  let fx
  try {
    fx = columnRepair(base, read, opts)
    // t11reach2-01show: then the hollows over a cave (hollowFloor), on what the repair made of the record
    const hf = hollowFloor(fx.rec ?? base, read, opts)
    fx = { ...fx, hollow: hf.hollow, ...(hf.rec ? { rec: hf.rec, added: [...fx.added, ...hf.added], dropped: [...fx.dropped, ...hf.dropped], n: { ...fx.n, total: fx.n.total + hf.added.length } } : {}) }
  } catch (e) {
    // a repair that FAILED repaired nothing: the ledger says a cell is unresolved, so the visit's hold is off (repairServes) and
    // every floating cell is deferred and counted again -- never a hold kept up by a repair that cannot run
    const led = repairLedger(base)
    fx = { rec: base ? { ...base, fillcol: { add: led.add, left: Math.max(1, led.left), cols: led.cols } } : null, added: [], dropped: [],
      n: { ext: 0, add: 0, deep: 0, drop: 0, back: 0, left: Math.max(1, led.left), total: led.add, closed: 1, wait: {}, why: {} }, err: String(e?.message ?? e).slice(0, 40) }
  }
  return { res: fx.rec ? { ...res, rec: fx.rec } : res, fx }
}
/** The refresh row's lifetime count (`to`) -> 'fcadd<ever added>/<the record's cap>'. Pure. */
export const repairTotal = (n, rec, T = FILLCOLUMN) => `fcadd${n?.total ?? 0}/${repairAddMax(rec, T)}`
/** What the repair did NOT do, for the refresh row (`st`, 48 characters) -> 'closed:<why>' | 'wait:<reason><columns>,...' | null. Pure. */
export function repairNote (n, closed = null) {
  if (closed) return `closed:${closed}`.slice(0, 48)
  const w = Object.entries(n?.wait ?? {}).map(([a, b]) => `${a}${b}`).join(',')
  return w ? `wait:${w}`.slice(0, 48) : null
}
/** The refresh row's counts (shop.mjs buildRowDetail `result`, 48 characters) -> 'ext1/add2/deep0/drop1/back0/left0'. Pure. */
export const repairTag = n => `ext${n?.ext ?? 0}/add${n?.add ?? 0}/deep${n?.deep ?? 0}/drop${n?.drop ?? 0}/back${n?.back ?? 0}/left${n?.left ?? 0}`

/**
 * THE WAIVER'S DEPENDENTS -> [{ k, why }] to waive WITH `due` ([{ k }]: the cells a waiver is about to name). Pure over `read`. With
 * the due cells waived, every open fill above one of them in its column that no order reaches any more (it rested on the waived
 * cell: no side holds it) goes with it; a cell above that a side holds stays open (it is laid against that side, as before). Never
 * a column with its own bookkeeping. FILLCOLUMN=off: none.
 * Their reason starts `fillcolumn:`: no stuck-waiver counter counts them (waiveroom.mjs), and they take the repair's own room
 * (repairOutMax) -- a column's cells bottom-up while it lasts, none past it (they stay open: deferred and counted like any cell).
 */
export function waiveRests (rec, due = [], read, { done = () => false, guard = new Set(), env = process.env, T = FILLCOLUMN } = {}) {
  if (!fillColumnOn(env) || !rec || !(due ?? []).length) return []
  const cellAt = new Map((rec.cells ?? []).filter(c => Array.isArray(c?.at)).map(c => [kOf(c.at), c]))
  const low = new Map()
  const w = { ...(rec.waived ?? {}) }
  for (const d of due) {
    const k = String(d?.k ?? ''), c = cellAt.get(k)
    w[k] ??= { why: 'due' }
    if (!c || !FILL_ROLES.has(c.role)) continue
    const col = colOf(c.at)
    if (!low.has(col) || c.at[1] < low.get(col)[1]) low.set(col, c.at)
  }
  if (!low.size) return []
  let room = repairOutMax(rec, T) - repairWaivedN(rec.waived)
  const out = [], cut = new Set()
  const rests = floatCells({ ...rec, waived: w }, read, { done, guard }).left
    .filter(c => { const b = low.get(colOf(c.at)); return !!b && c.at[1] > b[1] })
    .sort((a, b) => a.at[1] - b.at[1])
  for (const c of rests) {
    const col = colOf(c.at)
    if (cut.has(col)) continue
    if (room <= 0) { cut.add(col); continue }   // never a cell over one that stays open
    out.push({ k: kOf(c.at), why: `fillcolumn:rests_on ${kOf(low.get(col))}` }); room--
  }
  return out
}

/**
 * DOES THE REFRESH REPAIR THIS RECORD NOW? -> bool. Pure. An open inside-the-wall tidy record (the one tidyrefresh.mjs refreshDue
 * serves), both switches on, surveyed less than `holdMs` ago (and not in the future), and its last repair left nothing unresolved
 * (the ledger's `left`: a column that waits -- unread, a cap, the exclusions unread -- is not being repaired): the hold below names
 * a remedy only while that remedy is running.
 */
export function repairServes (rec, { now = Date.now(), env = process.env, T = FILLCOLUMN } = {}) {
  if (!fillColumnOn(env) || !tidyRefreshOn(env) || !rec || rec.structure_complete || rec.blueprint !== 'tidy@1' || rec.stageId !== TIDYREFRESH.inwallId) return false
  if (repairLedger(rec).left > 0) return false
  const at = refreshedAt(rec)
  return Number.isFinite(at) && at <= now + 60_000 && now - at < T.holdMs
}
/** The hold's words for its row: what the bot was refused and what repairs it. */
export const HOLD_WHY = 'no support under or beside it (ground dug since the survey): passed; the keeper\'s hourly refresh extends or drops it'
/**
 * THE VISIT'S HOLD -> Set "x,y,z": the open fills no order reaches now (floatCells `left`), passed by this visit -- never tried,
 * never deferred, never counted toward the stuck map's waiver -- because the refresh repairs their columns (repairServes; else
 * none: the cells are deferred and waived as before). Pure over `read`.
 */
export function floatHold (rec, read, { done = () => false, guard = new Set(), now = Date.now(), env = process.env } = {}) {
  if (!repairServes(rec, { now, env })) return new Set()
  return new Set(floatCells(rec, read, { done, guard }).left.map(c => kOf(c.at)))
}
