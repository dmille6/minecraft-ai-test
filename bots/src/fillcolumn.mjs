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
//                  toward the waiver -- only on a record the refresh repairs, and only while that refresh is not overdue.
// FILLCOLUMN=off is the rollback: no repair, no hold, the waiver and the rows as before.

import { refUsable } from './buildsite.mjs'
import { isLiquid, replaceableCell } from './townplan.mjs'
import { refreshedAt, tidyRefreshOn, TIDYREFRESH } from './tidyrefresh.mjs'

/** addMax: lower cells added to one column (tidy.mjs INWALL.holeMax, roughground.mjs ROUGH.fillMax: a hole the clean-up fills is at
 *  most 4 deep); depthMax: a column's open cells in all (tidy.mjs TIDY.pitDepthMax: deeper is a mine); refreshMax: cells added in one
 *  refresh (the rest wait an hour); rounds: one cell a column is judged a round; holdMs: the visit's hold lapses when the last
 *  survey is this old (two refresh periods: no keeper is refreshing). */
export const FILLCOLUMN = Object.freeze({ addMax: 4, depthMax: 6, refreshMax: 200, rounds: 12, holdMs: 2 * 60 * 60_000 })
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

/**
 * THE REPAIR -> { rec: the next record | null (nothing to change), n: { ext, add, deep, drop, left, why }, added: [cell], dropped:
 * [{ k, why }] }. Pure over `read`.
 *   done(cell), guard   the visit's done test and the cells another record names now (the visit's own guard)
 *   mayAdd([x, y, z])   may a cell be added here (never a protected zone);  reserved(x, z)  a reservation sited since
 * Round by round, each column's LOWEST cell no order reaches is judged (the cells above it wait for the next round):
 *   - the column is read down from it to its floor (a support, or an open cell of the record an order reaches); a reason on the way
 *     -- `deep`, `water`, `guarded`, `reserved`, `blocked`, `waived_below`, `record_below` -- leaves the cell out; an unread cell or
 *     a full page (`refreshMax`) leaves the column as it is for the next refresh;
 *   - the missing cells and the cell itself are KEPT bottom-up while each stands on a kept cell or the floor AND has a side beside
 *     it (a support, an open cell an order reaches, a cell kept in this round, a cell of a column that waits); kept missing cells
 *     are added, a cell not kept is left out (`bare`).
 * A cell an earlier repair left out comes back (its waiver removed) once a block is read under it and one beside it.
 * `n`: ext columns extended, add cells added, deep columns left out as too deep, drop cells left out (every reason, `why` by
 * reason), back cells that came back, left cells still unexecutable (the columns that wait).
 */
export function columnRepair (rec, read, { done = () => false, guard = new Set(), mayAdd = () => true, reserved = () => false, now = Date.now(), by = 'fillcolumn', T = FILLCOLUMN } = {}) {
  const n = { ext: 0, add: 0, deep: 0, drop: 0, back: 0, left: 0, why: {} }
  const added = [], dropped = []
  if (!rec || rec.structure_complete) return { rec: null, n, added, dropped }
  const support = supportOf(read)
  // (the world does not move under one repair: each cell's done test is asked once, whatever the number of rounds)
  const dm = new Map()
  const doneOnce = c => { const k = kOf(c.at); let v = dm.get(k); if (v === undefined) { v = !!done(c); dm.set(k, v) } return v }
  // 0. a cell left out by an earlier repair COMES BACK when the ground has come back round it: a block READ under it and one READ
  // beside it now (the pit round it was filled since) -- it is the survey's own cell again, laid like any other. Never a cell left
  // out for whose ground it is (`guarded`, `reserved`): that is not the ground's to answer
  let cur = rec
  {
    const solidNow = (x, y, z) => { const b = read(x, y, z); return !!b && refUsable(b) }
    const back = Object.entries(rec.waived ?? {}).filter(([k, v]) => {
      if (!/^fillcolumn:(?!guarded$|reserved$)/.test(String(v?.why ?? ''))) return false
      const [x, y, z] = k.split(',').map(Number)
      return solidNow(x, y - 1, z) && SIDES.some(([dx, dz]) => solidNow(x + dx, y, z + dz))
    }).map(([k]) => k)
    if (back.length) { const w = { ...rec.waived }; for (const k of back) delete w[k]; cur = { ...rec, waived: w }; n.back = back.length }
  }
  const home = rec.home ?? { x: 0, z: 0 }
  const far = k => { const [x, z] = k.split(',').map(Number); return Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) }
  const extCols = new Set(), deepCols = new Set(), wait = new Set()
  // every cell the record names (its fills, cuts and clears): never planned twice (the cells added below join it)
  const known = new Set([...(rec.cells ?? []), ...(rec.cut ?? []), ...(rec.clear ?? [])].filter(q => Array.isArray(q?.at)).map(q => kOf(q.at)))
  for (let round = 0; round < T.rounds; round++) {
    const f = floatCells(cur, read, { done: doneOnce, guard, support })
    const lows = new Map()
    for (const c of f.left) { const k = colOf(c.at); if (wait.has(k)) continue; const o = lows.get(k); if (!o || c.at[1] < o.at[1]) lows.set(k, c) }
    if (!lows.size) break
    const stuckK = new Set(f.stuck.map(c => kOf(c.at)))
    const reach = new Set(f.open.map(c => kOf(c.at)).filter(k => !stuckK.has(k)))   // the open cells an order reaches: solid in time
    const openN = new Map()
    for (const c of f.open) openN.set(colOf(c.at), (openN.get(colOf(c.at)) ?? 0) + 1)
    const w = cur.waived ?? null
    // 1. every column read down to its floor, nearest home first (the page's order)
    const plan = new Map()
    let room = T.refreshMax - added.length
    for (const [k, L] of [...lows].sort((a, b) => far(a[0]) - far(b[0]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      const [x, y, z] = L.at
      const gap = []
      let why = reserved(x, z) ? 'reserved' : null
      for (let i = 1; !why; i++) {
        const q = [x, y - i, z], qk = kOf(q), b = read(...q)
        if (!b) { why = 'unread'; break }
        if (refUsable(b) || reach.has(qk)) break
        if (hasOwn(w, qk)) { why = 'waived_below'; break }
        if (known.has(qk)) { why = 'record_below'; break }
        if (guard.has(qk) || !mayAdd(q)) { why = 'guarded'; break }
        if (isLiquid(b) || String(b.name ?? '').includes('waterlogged')) { why = 'water'; break }
        if (!(AIRN(nm(b)) || replaceableCell(b) || b.boundingBox === 'empty')) { why = 'blocked'; break }
        if (i > T.addMax || (openN.get(k) ?? 0) + i > T.depthMax) { why = 'deep'; break }
        gap.push(q)
      }
      if (!why && !gap.length) why = 'unread'   // (a floor right under a cell no order reaches: no evidence to act on)
      if (!why && gap.length > room) why = 'cap'
      if (why === 'unread' || why === 'cap') { wait.add(k); continue }
      if (!why) room -= gap.length
      plan.set(k, { L, cand: why ? [] : [...gap.reverse(), L.at], why })
    }
    // the cells of the columns that wait (and of the columns with their own bookkeeping) are not judged: they may yet be laid
    const maybe = new Set(f.stuck.filter(c => !plan.has(colOf(c.at))).map(c => kOf(c.at)))
    // 2. what stands IN the ground: kept bottom-up, a floor under it and a side beside it
    const kept = new Set()
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
    // 3. the round's changes: the kept missing cells added, the cell left out when it is not kept
    const add = [], waive = {}
    for (const [k, p] of plan) {
      const lk = kOf(p.L.at), n0 = add.length
      for (const q of p.cand) { const qk = kOf(q); if (qk !== lk && kept.has(qk)) add.push({ at: q, role: 'core', seg: p.L.seg, added: now, ext: true }) }
      if (add.length > n0) extCols.add(k)
      if (kept.has(lk)) continue
      const why = p.why ?? 'bare'
      if (why === 'deep') deepCols.add(k)
      waive[lk] = { why: `fillcolumn:${why}`, at: now, by }
      dropped.push({ k: lk, why: `fillcolumn:${why}` })
      n.why[why] = (n.why[why] ?? 0) + 1
    }
    if (!add.length && !Object.keys(waive).length) break
    added.push(...add)
    for (const c of add) known.add(kOf(c.at))
    cur = { ...cur, cells: add.length ? [...(cur.cells ?? []), ...add] : cur.cells, waived: Object.keys(waive).length ? { ...(cur.waived ?? {}), ...waive } : cur.waived,
      ...(add.length ? { bom: { ...(cur.bom ?? {}), earth: (Number(cur.bom?.earth) || 0) + add.length } } : {}) }
  }
  n.ext = extCols.size; n.add = added.length; n.deep = deepCols.size; n.drop = dropped.length
  n.left = floatCells(cur, read, { done: doneOnce, guard, support }).left.length
  return { rec: cur === rec ? null : cur, n, added, dropped }
}

/**
 * THE REFRESH'S OWN STEP (skills.mjs tidyRefresh, inside the publish) -> { res, fx }: tidyrefresh.mjs refreshMerge's result with the
 * repaired record in it (`res.rec`), and the repair (`fx`: columnRepair's, or null with the switch off -- `res` is then the very
 * object it was given). `cur` is the head now; the repair runs on what the merge made of it. Pure.
 */
export function refreshRepair (res, cur, read, opts = {}, env = process.env) {
  if (!fillColumnOn(env)) return { res, fx: null }
  const fx = columnRepair(res?.rec ?? cur, read, opts)
  return { res: fx.rec ? { ...res, rec: fx.rec } : res, fx }
}
/** The refresh row's counts (shop.mjs buildRowDetail `result`, 48 characters) -> 'ext1/add2/deep0/drop1/back0/left0'. Pure. */
export const repairTag = n => `ext${n?.ext ?? 0}/add${n?.add ?? 0}/deep${n?.deep ?? 0}/drop${n?.drop ?? 0}/back${n?.back ?? 0}/left${n?.left ?? 0}`

/**
 * THE WAIVER'S DEPENDENTS -> [{ k, why }] to waive WITH `due` ([{ k }]: the cells a waiver is about to name). Pure over `read`. With
 * the due cells waived, every open fill above one of them in its column that no order reaches any more (it rested on the waived
 * cell: no side holds it) goes with it; a cell above that a side holds stays open (it is laid against that side, as before). Never
 * a column with its own bookkeeping. FILLCOLUMN=off: none.
 */
export function waiveRests (rec, due = [], read, { done = () => false, guard = new Set(), env = process.env } = {}) {
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
  return floatCells({ ...rec, waived: w }, read, { done, guard }).left
    .filter(c => { const b = low.get(colOf(c.at)); return !!b && c.at[1] > b[1] })
    .map(c => ({ k: kOf(c.at), why: `rests_on_waived ${kOf(low.get(colOf(c.at)))}` }))
}

/**
 * DOES THE REFRESH REPAIR THIS RECORD NOW? -> bool. Pure. An open inside-the-wall tidy record (the one tidyrefresh.mjs refreshDue
 * serves), both switches on, surveyed less than `holdMs` ago (and not in the future): the hold below names a remedy only while
 * that remedy is running.
 */
export function repairServes (rec, { now = Date.now(), env = process.env, T = FILLCOLUMN } = {}) {
  if (!fillColumnOn(env) || !tidyRefreshOn(env) || !rec || rec.structure_complete || rec.blueprint !== 'tidy@1' || rec.stageId !== TIDYREFRESH.inwallId) return false
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
