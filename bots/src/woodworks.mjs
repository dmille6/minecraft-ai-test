// WOODWORKS (fences-01, OWNER 11-08: "the towns hold ~60,000 surplus logs" -- log-using builds that make the towns pretty: FENCES AND
// GATES round farms, pens, path edges where fitting and the managed forest; BOARDWALKS, DOCKS AND WOODEN BRIDGES at the water's edge).
// Design: docs/reports/woodworks-design-2026-11-08.md (Claude + Codex, reconciled).
//
// THE MODEL. A sixth TOWN SINK (sinks.mjs SINK_KINDS 'wood', plot `wood`, blueprint `wood@1`, letter W), worked by any bot the picker
// sends, built by the ordinary sink visit (buildrun.mjs runVisit). Each INSTANCE is one small structure dressing what the town already
// built:
//   ring   a fence round ONE record's box (the managed forest, the crop farm, a pen), at the first ring outside the record's own zone,
//          following the ground; OPEN where a path crosses it and at the record's own ways in (the farm's front, the forest's aisle
//          ends), at least FENCE.openingsMin openings on different sides; a GATE in the fence line beside each opening (closed, in line
//          with the fence: an ornament -- the bots walk the open gap beside it. A gate the bots walk THROUGH needs the pathfinder to price
//          an open gate as passable: gates-01, protected scope, tier 3);
//   rail   a fence along a path's edge where the path runs on a shoulder above a drop of FENCE.railDrop or more, standing on the
//          shoulder's own ground (never over the drop, never on the path).
// Every fence cell is a record cell (the tripwire judges every placement); the zones are each fence's column and each planned opening's
// (an opening stays open: nothing else is sited there). The fences and gates are the bag's, crafted by the visit's WOOD KIT from the
// town's surplus logs (skills.mjs woodKit) -- the WOOD PRESSURE (woodPressure) is the town's logs above the owner's reserve.
//
// NEVER: a fence on a path, a record's cell or column, a door's front, a reservation, a wet column, an unread cell; a structure that would
// take any walk node the town walk held before (proveFences: the walk with every fence and gate SOLID -- 1.5 tall, never a floor, never
// jumped -- must still hold every node it held without them, but the fences' own columns); a ring round a record the walk cannot reach
// (never seeded to pass); a ring round a retired record.
//
// PURE: the switch, the names, the bill, the pressure, the ring, the openings, the rails, the proof, the instance, the siting. Nothing here
// touches a bot or a file.

import { walkFrom, stepFor, overlay } from './buildsite.mjs'
import { isLiquid, replaceableCell } from './townplan.mjs'
import { pathColumns, cellGuard } from './towndress.mjs'
import { FENCES } from './decorator.mjs'

const k2 = (x, z) => `${x},${z}`
const kOf = a => `${a[0]},${a[1]},${a[2]}`
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'
const wetB = b => !!b && (isLiquid(b) || /waterlogged/.test(String(b.name ?? '')))
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))
const SIDES4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]

export const WOOD_KIND = 'wood'
export const FENCE = Object.freeze({
  instancesMax: 24,
  fenceMax: 72,          // fences (and gates) an instance
  logsMax: 32,           // an instance's whole bill in logs (Codex design: "spend at most 32 logs per new instance")
  openingW: 2,           // a planned opening's width (Codex: two-column openings)
  openingsMin: 2,        // a ring keeps at least this many openings, on different sides
  stepMax: 1,            // a fence follows the ground: the next fence's ground within this of the last (else the run breaks)
  railDrop: 2,           // a rail where the ground beyond the shoulder lies this far (or more) below the shoulder
  railRunMin: 2,         // a rail run is at least this many fences
  segMax: 16,            // fences a segment (one builder's lease)
  walkR: 128,            // the proof's walk reaches this far at most (the forest stands ~90 from home)
  dropTries: 24,         // gaps the proof may open (each one walk) before it gives up
})
/** The woods' gates (any species reads done). */
export const GATES = Object.freeze(FENCES.map(n => n.replace(/_fence$/, '_fence_gate')))
export const SPECIES = Object.freeze(['spruce', 'oak', 'birch', 'dark_oak', 'jungle', 'acacia', 'cherry', 'mangrove', 'pale_oak'])
/** WOODWORKS=on|off (default on where the sinks are on). The rollback: no wood instance is ever sited; a sited one stays protected. Pure. */
export const woodOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.WOODWORKS ?? '').trim())

// ---- the bill and the pressure -------------------------------------------------------------------------------------------------
/**
 * THE BILL in logs for F fences and G gates -> { logs, planks, sticks, fenceCrafts }. Pure. 4 planks + 2 sticks -> 3 fences; 4 sticks
 * + 2 planks -> 1 gate; 2 planks -> 4 sticks; 1 log -> 4 planks (the 1.21 recipes; the craft planner does the same sums).
 */
export function woodBill (F = 0, G = 0) {
  const fenceCrafts = Math.ceil(Math.max(0, F) / 3)
  const gates = Math.max(0, G)
  const sticks = 2 * fenceCrafts + 4 * gates
  const planks = 4 * fenceCrafts + 2 * gates + 2 * Math.ceil(sticks / 4)
  return { logs: Math.ceil(planks / 4), planks, sticks, fenceCrafts }
}
const LOG_RE = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/
const PLANK_RE = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_planks$/
/** A stock's wood in LOG UNITS (logs + planks / 4) -> n. Pure. */
export const woodUnits = (m = {}) => Object.entries(m ?? {}).reduce((t, [n, v]) => t + (LOG_RE.test(n) ? Number(v) || 0 : PLANK_RE.test(n) ? (Number(v) || 0) / 4 : 0), 0)
/** The bag's wood a bot keeps for itself (woodkeep.mjs: 16 log units is enough for what a bot does alone). */
export const BAG_WOOD_KEEP = 16
/** Beyond the owner's reserve (stocktarget BUILD_RESERVE.logs), the town keeps this many logs untouched by woodworks (Codex design). */
export const TOWN_WOOD_KEEP = 64
/**
 * THE WOOD PRESSURE -> { p, avail, known, town, bag }. Pure. `town` the town index's stock with its `coverage`, `bag` this bot's bag,
 * `reserve` the owner's logs reserve. Available = the town's log units above reserve + TOWN_WOOD_KEEP (read towns only: coverage >= 0.8)
 * + this bot's own bag above BAG_WOOD_KEEP. p = avail / 256, clamped to [-1, 2]; p > 0 opens a wood instance.
 */
export function woodPressure ({ town = null, coverage = 0, bag = {}, reserve = 512 } = {}) {
  const known = !!town && Number(coverage) >= 0.8
  const t = known ? Math.max(0, woodUnits(town) - (Number(reserve) || 0) - TOWN_WOOD_KEEP) : 0
  const b = Math.max(0, woodUnits(bag) - BAG_WOOD_KEEP)
  const avail = Math.floor(t + b)
  return { p: Math.round(Math.max(-1, Math.min(2, avail / 256)) * 100) / 100, avail, known, town: known ? Math.floor(woodUnits(town)) : null, bag: Math.floor(b) }
}
/** The species an instance is made of: the one the town (and bag) hold the most logs and planks of -> name. Pure. */
export function woodSpecies (stock = {}) {
  let best = 'oak', n = -1
  for (const s of SPECIES) {
    const v = (Number(stock?.[`${s}_log`]) || 0) + (Number(stock?.[`${s}_planks`]) || 0) / 4
    if (v > n) { n = v; best = s }
  }
  return best
}

// ---- the targets ---------------------------------------------------------------------------------------------------------------
/** The plots a ring may fence, in order (the forest first: its ring has no measured conflict; then the farm; then any pen). */
export const RING_PLOTS = Object.freeze(['forest', 'cropfarm', 'pens', 'pen'])
const box4 = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)
/**
 * A RECORD'S OWN MARGIN -> m: how far its own zones reach past its box (the forest's zone is its box + 1). The ring stands at m + 1, so
 * it never takes a column the record reserved for itself (its stands, its aisles' ends). Pure.
 */
export function ownMargin (rec) {
  const b = rec?.box
  if (!box4(b)) return 0
  let m = 0
  for (const z of rec?.zones ?? []) {
    const q = z?.box
    if (!Array.isArray(q) || q.length !== 6) continue
    m = Math.max(m, b[0] - q[0], q[3] - b[2], b[1] - q[2], q[5] - b[3])
  }
  return Math.max(0, Math.min(4, m))
}
/** A record's WAYS IN -> [[x, z]] (columns at or just inside its box the ring must leave open beside): the crop farm's `front`, the
 *  forest's aisle ends (its first and last aisle row along the strips' axis; an aisle cell is [x, z, level]). Pure. */
export function accessOf (plot, rec) {
  if (plot === 'cropfarm') return (rec?.front ?? []).filter(a => Array.isArray(a) && a.length >= 2).map(a => [a[0], a[1]])
  if (plot === 'forest') {
    const a = (rec?.aisles ?? []).filter(q => Array.isArray(q) && q.length >= 2)
    if (!a.length) return []
    const along = rec?.axis === 'x' ? 0 : 1
    const lo = Math.min(...a.map(q => q[along])), hi = Math.max(...a.map(q => q[along]))
    return a.filter(q => q[along] === lo || q[along] === hi).map(q => [q[0], q[1]])
  }
  return (rec?.front ?? []).filter(a => Array.isArray(a) && a.length >= 2).map(a => [a[0], a.length === 3 ? a[2] : a[1]])
}
/** The records a ring may go round -> [{ plot, rec, box, d, level, access }], in RING_PLOTS order. Never a retired record, an open one
 *  (structure not complete and not `standing`), or a record with no box. Pure. */
export function ringTargets (records = []) {
  const out = []
  for (const plot of RING_PLOTS) {
    const r = records.find(q => q?.plot === plot)?.rec ?? null
    if (!r || !box4(r.box) || r.retired || r.state === 'retired') continue
    if (!(r.structure_complete || r.state === 'standing' || r.state === 'complete')) continue
    out.push({ plot, rec: r, box: r.box.slice(), d: ownMargin(r) + 1, level: Number.isFinite(r.level) ? r.level : null, access: accessOf(plot, r) })
  }
  return out
}

// ---- the ring ------------------------------------------------------------------------------------------------------------------
/**
 * THE RING round a box at distance d -> [{ col: [x, z], side, corner }] in loop order (clockwise from the north-west corner). `side` the
 * side's outward normal as a gate facing (north: z = z0 - d, east, south, west). Pure.
 */
export function ringOf (box, d = 1) {
  const [x0, z0, x1, z1] = [box[0] - d, box[1] - d, box[2] + d, box[3] + d]
  const out = []
  for (let x = x0; x <= x1; x++) out.push({ col: [x, z0], side: 'north', corner: x === x0 || x === x1 })
  for (let z = z0 + 1; z <= z1; z++) out.push({ col: [x1, z], side: 'east', corner: z === z1 })
  for (let x = x1 - 1; x >= x0; x--) out.push({ col: [x, z1], side: 'south', corner: x === x0 })
  for (let z = z1 - 1; z > z0; z--) out.push({ col: [x0, z], side: 'west', corner: false })
  return out
}
const LEAVES = /_leaves$/
/**
 * A FENCE'S FLOOR near y (y+2 .. y-2) -> its y | null. Pure. The highest ground block (GROUND: earth, stone, a path) whose cell above is
 * open (air or a plant) and the cell above that open or a canopy's LEAVES (a fence is 1.5 tall: it stands under a low bough -- the forest
 * and its taiga stand under one). Water at the floor or the fence's cell: none.
 */
export function fenceFloor (read, x, z, y) {
  for (let fy = y + 2; fy >= y - 2; fy--) {
    const f = read(x, fy, z), a = read(x, fy + 1, z), h = read(x, fy + 2, z)
    if (!f || !a || !h) return null
    if (wetB(f) || wetB(a)) return null
    if (solidGround(f) && openCell(a) && (openCell(h) || LEAVES.test(nm(h)))) return fy
  }
  return null
}
const GROUND = /^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mycelium|moss_block|stone|andesite|diorite|granite|tuff|gravel|sand|cobblestone|mossy_cobblestone|dirt_path|stone_bricks|mud|packed_mud|clay|snow_block)$/
const solidGround = b => !!b && b.boundingBox === 'block' && GROUND.test(nm(b))
const openCell = b => !!b && !wetB(b) && (AIRN(nm(b)) || replaceableCell(b))
/**
 * ONE FENCE COLUMN -> { at, ground } | { why }. Pure. Not a path column, a record's column, a door front, a reservation; its floor
 * (towndress.mjs floorNear: a full-cube floor with two open cells over it) within FENCE.stepMax of `yRef` (the last fence's ground, or
 * the record's level); the fence's cell and the one above open (air or a plant a placement replaces) and no record cell; nothing wet
 * within a step (a fence in a flow is a waterlogged post).
 */
export function fenceAt (read, col, yRef, { pathCols, guard, reserved = () => null, stepMax = FENCE.stepMax } = {}) {
  const [x, z] = col
  const ks = k2(x, z)
  if (pathCols?.has(ks)) return { why: 'path' }
  if (guard?.cols?.has(ks)) return { why: 'record' }
  if (guard?.doors?.has(ks)) return { why: 'door' }
  const r = reserved(x, z)
  if (r) return { why: `reserved:${String(r).slice(0, 24)}` }
  for (let dy = -3; dy <= 4; dy++) if (read(x, yRef + dy, z) == null) return { why: 'unread' }
  const g = fenceFloor(read, x, z, yRef)
  if (g == null) return { why: 'no_floor' }
  if (Math.abs(g - yRef) > stepMax) return { why: 'step' }
  const at = [x, g + 1, z]
  if (!openCell(read(...at)) || !(openCell(read(x, g + 2, z)) || LEAVES.test(nm(read(x, g + 2, z))))) return { why: 'occupied' }
  if (guard?.cells?.has(kOf(at)) || guard?.cells?.has(kOf([x, g + 2, z]))) return { why: 'record_cell' }
  for (const [dx, dz] of [[0, 0], ...SIDES4]) for (let dy = 0; dy <= 1; dy++) if (wetB(read(x + dx, g + dy, z + dz))) return { why: 'wet' }
  return { at, ground: g }
}
/**
 * THE RING'S FENCES AND OPENINGS -> { fences: [{ at, side, corner, i }], openings: [{ cols, why, first, last }], gaps: { why: n }, ring }.
 * Pure. Each ring column is a fence (fenceAt) or a GAP. The OPENINGS: every path crossing (its ring columns are gaps already), every way
 * in (`access`: the ring column nearest each, FENCE.openingW wide), and -- while fewer than FENCE.openingsMin openings stand, or all on
 * one side -- the ring's column nearest home and one on the side opposite it. A planned opening's columns are never fenced.
 */
export function ringPlan (read, target, home, { pathCols = new Map(), guard = { cols: new Set(), cells: new Set(), doors: new Set() }, reserved = () => null } = {}) {
  const ring = ringOf(target.box, target.d)
  const n = ring.length
  const planned = new Map()   // i -> why
  const open = (i, why) => { for (let w = 0; w < FENCE.openingW; w++) { const j = (i + w) % n; if (!planned.has(j)) planned.set(j, why) } }
  // the ways in: the ring column nearest each access column (never starting on a corner)
  for (const a of target.access ?? []) {
    let best = -1, bd = Infinity
    ring.forEach((q, i) => { const d = cheb(q.col, a); if (d < bd) { bd = d; best = i } })
    if (best >= 0 && bd <= target.d + 1) open(ring[best].corner ? (best + 1) % n : best, 'access')
  }
  const isPath = i => pathCols.has(k2(...ring[i].col))
  const isOpen = i => planned.has(i) || isPath(i)
  const sidesOpen = () => new Set([...ring.keys()].filter(isOpen).map(i => ring[i].side))
  const runs = () => { let c = 0; for (let i = 0; i < n; i++) if (isOpen(i) && !isOpen((i - 1 + n) % n)) c++; return c || ([...ring.keys()].every(isOpen) ? 1 : 0) }
  if (runs() < FENCE.openingsMin || sidesOpen().size < 2) {
    // the column nearest home (never a corner), then the one nearest it on the side opposite
    const hc = [home.x, home.z]
    const byHome = [...ring.keys()].filter(i => !ring[i].corner).sort((a, b) => cheb(ring[a].col, hc) - cheb(ring[b].col, hc) || a - b)
    if (byHome.length) {
      const first = byHome[0]
      if (!isOpen(first)) open(first, 'home')
      const opp = { north: 'south', south: 'north', east: 'west', west: 'east' }[ring[first].side]
      const second = byHome.find(i => ring[i].side === opp)
      if (second != null && (runs() < FENCE.openingsMin || sidesOpen().size < 2)) open(second, 'far')
    }
  }
  const fences = [], gaps = {}
  let yRef = Number.isFinite(target.level) ? target.level : home.y - 1
  // the ground follows round the loop: from the record's level, then the last fence's ground
  for (let i = 0; i < n; i++) {
    const q = ring[i]
    if (planned.has(i)) { const w = `open_${planned.get(i)}`; gaps[w] = (gaps[w] ?? 0) + 1; continue }
    let r = fenceAt(read, q.col, yRef, { pathCols, guard, reserved })
    // a run broken by a step: try the record's own level once (the ground came back to it)
    if (r.why === 'step' && Number.isFinite(target.level) && yRef !== target.level) r = fenceAt(read, q.col, target.level, { pathCols, guard, reserved })
    if (r.why) { gaps[r.why] = (gaps[r.why] ?? 0) + 1; continue }
    fences.push({ at: r.at, side: q.side, corner: q.corner, i })
    yRef = r.ground
  }
  // the openings, as columns (a run of planned or path columns on the ring; a path's own columns stay the path's)
  const openings = []
  let cur = null
  for (let i = 0; i < n; i++) {
    const why = planned.get(i) ?? (isPath(i) ? 'path' : null)
    if (why) { if (cur && cur.why === why && cur.last === i - 1) { cur.cols.push(ring[i].col); cur.last = i } else { cur = { cols: [ring[i].col], why, first: i, last: i }; openings.push(cur) } } else cur = null
  }
  return { fences, openings, gaps, ring: n }
}
/**
 * THE GATES -> the fences turned gates: for each opening, the fence just before it in loop order (else just after), never a corner, in
 * line with the fence (`facing` the side's outward normal: a gate facing north or south spans east-west). One gate an opening. Pure.
 */
export function gatesFor (fences, openings, n) {
  const byI = new Map(fences.map(f => [f.i, f]))
  const out = new Map()
  for (const o of openings) {
    const before = byI.get((o.first - 1 + n) % n), after = byI.get((o.last + 1) % n)
    const g = [before, after].find(f => f && !f.corner && !out.has(f.i))
    if (g) out.set(g.i, { ...g, facing: g.side })
  }
  return [...out.values()]
}

// ---- the rails -----------------------------------------------------------------------------------------------------------------
/**
 * THE RAIL CANDIDATES beside the laid paths -> [{ at, ground, d }]. Pure. A side column s of a path column p: not a path, a record's
 * column, a door front or a reservation; its floor is the path's SHOULDER (level with the path's surface or one below, never above);
 * the column beyond it (away from the path) has its ground FENCE.railDrop or more under the shoulder (or water there); the rail stands
 * on the shoulder (fenceAt), never over the drop.
 */
export function railCandidates (read, paths, home, { guard, reserved = () => null } = {}) {
  const pathCols = pathColumns(paths)
  const out = [], seen = new Set()
  for (const p of pathCols.values()) for (const [dx, dz] of SIDES4) {
    const s = [p.x + dx, p.z + dz]
    const ks = k2(...s)
    if (seen.has(ks) || pathCols.has(ks)) continue
    const r = fenceAt(read, s, p.y, { pathCols, guard, reserved })
    if (r.why || r.ground > p.y || r.ground < p.y - 1) continue
    const o = [s[0] + dx, s[1] + dz]
    if (pathCols.has(k2(...o))) continue
    let top = null
    for (let y = r.ground; y >= r.ground - 8; y--) { const b = read(o[0], y, o[1]); if (b == null) { top = undefined; break } if (wetB(b) || b.boundingBox === 'block') { top = y; break } }
    if (top === undefined) continue
    if (top != null && r.ground - top < FENCE.railDrop) continue
    seen.add(ks)
    out.push({ at: r.at, ground: r.ground, d: Math.max(Math.abs(s[0] - home.x), Math.abs(s[1] - home.z)) })
  }
  return out.sort((a, b) => a.d - b.d || a.at[0] - b.at[0] || a.at[2] - b.at[2])
}
/** The rails' RUNS -> [[cand]]: neighbours within one column (Chebyshev, ground within one), each run at least FENCE.railRunMin, the
 *  nearest home first, at most `max` fences in all. Pure. */
export function railRuns (cands, { max = FENCE.fenceMax, runMin = FENCE.railRunMin } = {}) {
  const left = cands.slice(), runs = []
  while (left.length) {
    const run = [left.shift()]
    for (let grew = true; grew;) {
      grew = false
      for (let i = 0; i < left.length; i++) {
        if (run.some(c => cheb([c.at[0], c.at[2]], [left[i].at[0], left[i].at[2]]) <= 1 && Math.abs(c.at[1] - left[i].at[1]) <= 1)) { run.push(left.splice(i, 1)[0]); grew = true; i-- }
      }
    }
    if (run.length >= runMin) runs.push(run)
  }
  const out = []
  let total = 0
  for (const r of runs) { if (total + r.length > max) continue; out.push(r); total += r.length }
  return out
}

// ---- the proof -----------------------------------------------------------------------------------------------------------------
const SOLID = name => Object.freeze({ name, boundingBox: 'block' })
const solidOf = c => SOLID(c.gate ? 'spruce_fence_gate' : 'spruce_fence')
/** The town walk's nodes by column (buildsite.mjs walkFrom from home and `stood`). Pure. */
export function woodNodes (read, home, { stood = [], walkR = 64 } = {}) {
  const m = new Map()
  for (const k of walkFrom(read, home, new Set(), walkR, { stood })) { const [x, y, z] = k.split(',').map(Number); const c = k2(x, z); if (!m.has(c)) m.set(c, []); m.get(c).push(y) }
  return m
}
/** The walk nodes lost when `cells` stand solid -> [colKey] (the cells' own columns never count); `opts.after` receives the walk. Pure. */
export function lostNodes (read, home, cells, before, { stood = [], walkR = 64, out = null } = {}) {
  const over = new Map(cells.map(c => [kOf(c.at), solidOf(c)]))
  const cols = new Set(cells.map(c => k2(c.at[0], c.at[2])))
  const after = woodNodes(overlay(read, over), home, { stood, walkR })
  if (out) out.after = after
  const lost = []
  for (const [c, ys] of before) { if (cols.has(c)) continue; const a = after.get(c) ?? []; if (ys.some(y => !a.includes(y))) lost.push(c) }
  return lost
}
/**
 * THE FENCES' PROOF -> { ok, cells, why, dropped }. Pure. `runs` [[cell]] (a ring's runs between its openings, or the rails' runs):
 *  1. the town walk WITHOUT them is the baseline (`base`, or walked here);
 *  2. a ring's inside must hold a node of that walk (`inside(x, z)`): never a ring round ground the town cannot reach;
 *  3. with every cell SOLID (a fence: 1.5 tall -- never a floor, its cell never feet or head) the walk holds every node it held before
 *     but the cells' own columns; on a loss a GAP opens where the walk went (the first fence between a lost node and a held one, 2 wide),
 *     else the run nearest a lost node goes; at most FENCE.dropTries walks (`dropped`: the cells dropped).
 *     A walk only gains when an obstacle goes, so every PREFIX of the build (any subset of the cells) holds every node too;
 *  4. every cell kept has a STEP (buildsite.mjs stepFor: a support below or beside it, a stand of the walk in reach, a clear sight
 *     line) over the cells placed before it -- a cell with none is dropped (the walk only gains from a dropped fence).
 */
export function proveFences (read, home, runs, { stood = [], walkR = 64, base = null, inside = null, domain = null } = {}) {
  const before = base ?? woodNodes(read, home, { stood, walkR })
  if (inside) {
    let reached = false
    for (const c of before.keys()) { const [x, z] = c.split(',').map(Number); if (inside(x, z)) { reached = true; break } }
    if (!reached) return { ok: false, cells: [], why: 'unreached', dropped: 0 }
  }
  let keep = runs.filter(r => r.length)
  let dropped = 0
  for (let t = 0; keep.length; t++) {
    const o = {}
    const lost = lostNodes(read, home, keep.flat(), before, { stood, walkR, out: o })
    if (!lost.length) break
    if (t >= FENCE.dropTries) return { ok: false, cells: [], why: 'walk_lost', dropped }
    // A GAP WHERE THE WALK WENT: the first fence (loop order) standing between a lost node and a node the walk still holds -- with the
    // next fence of its run when that one stands beside a lost node too (a 2-wide opening); none such: the run nearest a lost node goes
    const lostSet = new Set(lost)
    const held = c => { const k = c.split(','); return (o.after.get(c) ?? []).length > 0 && !lostSet.has(c) && !keep.some(r => r.some(q => q.at[0] === +k[0] && q.at[2] === +k[1])) }
    const touches = (c, test) => { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && test(k2(c.at[0] + dx, c.at[2] + dz))) return true; return false }
    const between = c => touches(c, k => lostSet.has(k)) && touches(c, held)
    let hit = null
    for (let ri = 0; ri < keep.length && !hit; ri++) for (let ci = 0; ci < keep[ri].length; ci++) if (between(keep[ri][ci])) { hit = [ri, ci]; break }
    if (hit) {
      const [ri, ci] = hit
      const run = keep[ri]
      const drop = new Set([ci])
      if (ci + 1 < run.length && touches(run[ci + 1], k => lostSet.has(k))) drop.add(ci + 1)
      else if (ci > 0 && touches(run[ci - 1], k => lostSet.has(k))) drop.add(ci - 1)
      // the run splits at the gap: its two sides stay separate runs (segments)
      const a = run.slice(0, Math.min(...drop)), b = run.slice(Math.max(...drop) + 1)
      keep = [...keep.slice(0, ri), ...(a.length ? [a] : []), ...(b.length ? [b] : []), ...keep.slice(ri + 1)]
      dropped += drop.size
      continue
    }
    const lc = lost.map(c => c.split(',').map(Number))
    const near = r => Math.min(...r.map(c => Math.min(...lc.map(q => cheb([c.at[0], c.at[2]], q)))))
    const worst = keep.reduce((b, r, i) => (near(r) < near(keep[b]) ? i : b), 0)
    dropped += keep[worst].length
    keep = keep.filter((_, i) => i !== worst)
  }
  if (!keep.length) return { ok: false, cells: [], why: 'walk_lost', dropped }
  // the steps, over the cells placed before (the order the visit places them: run by run)
  const over = new Map()
  const cells = []
  for (const run of keep) for (const c of run) {
    const step = stepFor(overlay(read, over), home, c.at, before, domain)
    if (!step) continue
    cells.push(c)
    over.set(kOf(c.at), solidOf(c))
  }
  return cells.length ? { ok: true, cells, why: 'ok', dropped } : { ok: false, cells: [], why: 'no_step', dropped }
}

// ---- the instance --------------------------------------------------------------------------------------------------------------
export const woodFenceRole = role => /^W\d+-f$/.test(String(role ?? ''))
export const woodGateRole = role => /^W\d+-g$/.test(String(role ?? ''))
/** The wood roles the BAG supplies (the visit's kit crafts them; the town's chests are never billed for them). */
export const woodBagRole = role => woodFenceRole(role) || woodGateRole(role)
/**
 * A STRUCTURE AS AN INSTANCE -> { cells, segments, palette, counts, clear, zones, cols, box }. Pure. The fences in runs (one segment a
 * run, at most FENCE.segMax fences: `W2-R0`...), role `W2-f` (the species' fence first, any fence done) and `W2-g` (the species' gate
 * first, any gate done; its `ws` the facing: in line with the fence). Zones: each cell's column and each planned opening's.
 */
export function woodInstance (id, { cells = [], species = 'oak', openings = [] } = {}) {
  const palette = { [`${id}-f`]: [`${species}_fence`, ...FENCES.filter(n => n !== `${species}_fence`)], [`${id}-g`]: [`${species}_fence_gate`, ...GATES.filter(n => n !== `${species}_fence_gate`)] }
  const out = [], segments = []
  let seg = null, inSeg = 0, prevRun = null
  for (const c of cells) {
    if (!seg || c.run !== prevRun || inSeg >= FENCE.segMax) { seg = `${id}-R${segments.length}`; segments.push({ seg, deps: [] }); inSeg = 0 }
    out.push({ at: c.at.slice(), role: c.gate ? `${id}-g` : `${id}-f`, seg, ...(c.gate ? { ws: { facing: c.facing } } : {}) })
    inSeg++; prevRun = c.run
  }
  const zones = [], cols = [], seen = new Set()
  const addCol = (x, z) => { const k = k2(x, z); if (seen.has(k)) return; seen.add(k); cols.push([x, z]); zones.push({ box: [x, -64, z, x, 320, z], why: `project:wood:${id}` }) }
  for (const c of out) addCol(c.at[0], c.at[2])
  for (const o of openings) if (o.why !== 'path') for (const [x, z] of o.cols ?? []) addCol(x, z)
  const xs = cols.map(c => c[0]), zs = cols.map(c => c[1])
  const counts = out.reduce((m, c) => (m[c.role] = (m[c.role] ?? 0) + 1, m), {})
  return { cells: out, segments, palette, counts, clear: [], zones, cols, box: cols.length ? [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] : null }
}

// ---- the siting ----------------------------------------------------------------------------------------------------------------
/** The targets the record already went round -> Set of plot names (a ring is never sited twice round one record). Pure. */
export const ringsDone = rec => new Set((rec?.instances ?? []).filter(i => i?.type === 'ring').map(i => i.target))
/** A ring's runs between its openings and gaps, in loop order, the gates marked -> [[{ at, run, gate?, facing? }]]. The loop's last run
 *  joins its first when the ring closes on them (one segment). Pure. */
export function ringRuns (plan) {
  const gates = new Map(gatesFor(plan.fences, plan.openings, plan.ring).map(g => [g.i, g]))
  const runs = []
  let run = null, prevI = null
  for (const f of plan.fences) {
    if (!run || f.i !== prevI + 1) { run = []; runs.push(run) }
    const g = gates.get(f.i)
    run.push({ at: f.at, i: f.i, run: runs.length - 1, ...(g ? { gate: true, facing: g.facing } : {}) })
    prevI = f.i
  }
  if (runs.length > 1 && plan.fences[0].i === 0 && plan.fences.at(-1).i === plan.ring - 1) { const last = runs.pop(); runs[0] = [...last, ...runs[0]] }
  return runs.map((r, k) => r.map(c => ({ ...c, run: k })))
}
/**
 * SITE THE NEXT WOOD INSTANCE -> { ok, inst, meta, tried } | { ok: false, why, tried }. Pure over `read`. ctx:
 *   id, n, home, records [{ plot, rec }] (every OTHER project's head record), rec (the wood record so far), reserved(x, z), stood,
 *   wood { avail (log units this bot may spend), species }.
 * The next ring first (RING_PLOTS order, each record once); then a batch of rails beside the paths. Each is proven (proveFences) and
 * billed (woodBill <= min(FENCE.logsMax, wood.avail): a structure the wood cannot pay is not sited -- `unfunded`).
 */
export function siteWood (read, ctx = {}) {
  const { id, n = 1, home, records = [], rec = null, reserved = () => null, stood = [] } = ctx
  const avail = Math.max(0, Number(ctx.wood?.avail) || 0)
  const species = ctx.wood?.species ?? 'oak'
  const tried = []
  const byPlot = new Map(records.filter(r => r?.rec).map(r => [r.plot, r.rec]))
  const guard = cellGuard([...records.map(r => r.rec).filter(Boolean), ...(rec ? [rec] : [])])
  const pathCols = pathColumns(byPlot.get('paths') ?? null)
  const budget = Math.min(FENCE.logsMax, avail)
  const done = ringsDone(rec)
  let base = null
  const baseFor = walkR => (base && base.r >= walkR ? base.nodes : (base = { r: walkR, nodes: woodNodes(read, home, { stood, walkR }) }).nodes)
  for (const t of ringTargets(records)) {
    if (done.has(t.plot)) { tried.push(`${t.plot}:done`); continue }
    const plan = ringPlan(read, t, home, { pathCols, guard, reserved })
    if (!plan.fences.length) { tried.push(`${t.plot}:no_fence:${Object.keys(plan.gaps).join('+') || '-'}`); continue }
    const runs = ringRuns(plan)
    const cells0 = runs.flat()
    if (cells0.length > FENCE.fenceMax) { tried.push(`${t.plot}:too_long${cells0.length}`); continue }
    const bill = woodBill(cells0.filter(c => !c.gate).length, cells0.filter(c => c.gate).length)
    if (bill.logs > budget) { tried.push(`${t.plot}:unfunded${bill.logs}>${budget}`); continue }
    const [bx0, bz0, bx1, bz1] = [t.box[0] - t.d, t.box[1] - t.d, t.box[2] + t.d, t.box[3] + t.d]
    const far = Math.max(Math.abs(bx0 - home.x), Math.abs(bx1 - home.x), Math.abs(bz0 - home.z), Math.abs(bz1 - home.z))
    const walkR = Math.min(FENCE.walkR, Math.max(64, far + 6))
    const pr = proveFences(read, home, runs, { stood, walkR, base: baseFor(walkR), inside: (x, z) => x > bx0 && x < bx1 && z > bz0 && z < bz1,
      domain: (x, z) => x >= bx0 - 6 && x <= bx1 + 6 && z >= bz0 - 6 && z <= bz1 + 6 })
    if (!pr.ok) { tried.push(`${t.plot}:${pr.why}`); continue }
    const inst = woodInstance(id, { cells: pr.cells, species, openings: plan.openings })
    const gatesN = pr.cells.filter(c => c.gate).length
    tried.push(`${t.plot}:ok`)
    const meta = { id, n, kind: WOOD_KIND, type: 'ring', target: t.plot, species, fences: pr.cells.length - gatesN, gates: gatesN, logs: woodBill(pr.cells.length - gatesN, gatesN).logs,
      openings: plan.openings.map(o => ({ why: o.why, cols: o.cols })), gaps: plan.gaps, dropped: pr.dropped,
      summary: woodSummary({ type: 'ring', target: t.plot, species, fences: pr.cells.length - gatesN, gates: gatesN, openings: plan.openings.length }),
      box: inst.box, zones: inst.zones, cols: inst.cols, approach: [inst.cells[0].at], centre: [inst.cells[0].at[0], inst.cells[0].at[2]], walkR }
    return { ok: true, inst, meta, tried }
  }
  // the rails beside the paths (one batch an instance; a rail's column is a record column after: never a candidate again)
  const paths = byPlot.get('paths') ?? null
  if (paths) {
    const cands = railCandidates(read, paths, home, { guard, reserved })
    let fit = 0
    while (fit < FENCE.fenceMax && woodBill(fit + 1, 0).logs <= budget) fit++
    const runs = railRuns(cands, { max: fit })
    if (!runs.length) tried.push(`rails:${cands.length ? (fit ? 'no_run' : `unfunded0>${budget}`) : 'none'}`)
    else {
      const far = Math.max(...runs.flat().map(c => c.d))
      const walkR = Math.min(FENCE.walkR, Math.max(64, far + 8))
      const rr = runs.map((r, k) => r.map(c => ({ at: c.at, run: k })))
      const near = new Set(rr.flat().flatMap(c => { const o = []; for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) o.push(k2(c.at[0] + dx, c.at[2] + dz)); return o }))
      const pr = proveFences(read, home, rr, { stood, walkR, base: baseFor(walkR), domain: (x, z) => near.has(k2(x, z)) })
      if (!pr.ok) tried.push(`rails:${pr.why}`)
      else {
        const inst = woodInstance(id, { cells: pr.cells, species })
        tried.push('rails:ok')
        const meta = { id, n, kind: WOOD_KIND, type: 'rail', target: 'paths', species, fences: pr.cells.length, gates: 0, logs: woodBill(pr.cells.length, 0).logs, dropped: pr.dropped,
          summary: woodSummary({ type: 'rail', target: 'paths', species, fences: pr.cells.length, gates: 0, openings: 0 }),
          box: inst.box, zones: inst.zones, cols: inst.cols, approach: [inst.cells[0].at], centre: [inst.cells[0].at[0], inst.cells[0].at[2]], walkR }
        return { ok: true, inst, meta, tried }
      }
    }
  }
  return { ok: false, why: tried.some(t => /unfunded/.test(t)) ? 'unfunded' : 'no_site', tried }
}
/** The instance's summary for the rows (under 60 characters). Pure. */
export const woodSummary = ({ type, target, species, fences = 0, gates = 0, openings = 0 }) => `${type}:${target}/${species}/f${fences}/g${gates}/o${openings}`
/** `_wood` rows (detail strings only). */
export const woodRowDetail = f => Object.entries(f).filter(([, v]) => v != null).map(([k, v]) => `${k}=${String(Array.isArray(v) ? v.join(',') : v).replace(/\s+/g, '_').slice(0, 80)}`).join(' ')
/** The fences and gates an open record still owes -> { fences, gates } (`done(cell)`: the visit's cellDone). Pure. */
export function woodOwed (rec, done = () => false) {
  let fences = 0, gates = 0
  for (const c of rec?.cells ?? []) { if (done(c)) continue; if (woodFenceRole(c.role)) fences++; else if (woodGateRole(c.role)) gates++ }
  return { fences, gates }
}
/** The species an open record is made of (its newest fence role's first name) -> name | null. Pure. */
export function woodSpeciesOf (rec) {
  let best = null
  for (const [role, names] of Object.entries(rec?.palette ?? {})) if (woodFenceRole(role) && Array.isArray(names) && names.length) best = String(names[0]).replace(/_fence$/, '')
  return best
}
/**
 * THE KIT still to make for the owed cells -> { fences, gates, logs }: the bag's fences and gates counted (any species: any reads done),
 * the logs to draw (woodBill over what is still owed, less the bag's wood above BAG_WOOD_KEEP). Pure.
 */
export function woodKitNeed (owed = { fences: 0, gates: 0 }, held = {}) {
  const fenceHeld = FENCES.reduce((t, n) => t + (Number(held?.[n]) || 0), 0)
  const gateHeld = GATES.reduce((t, n) => t + (Number(held?.[n]) || 0), 0)
  const fences = Math.max(0, (Number(owed?.fences) || 0) - fenceHeld), gates = Math.max(0, (Number(owed?.gates) || 0) - gateHeld)
  if (!fences && !gates) return { fences: 0, gates: 0, logs: 0 }
  const bill = woodBill(fences, gates)
  const spare = Math.max(0, woodUnits(held) - BAG_WOOD_KEEP)
  return { fences, gates, logs: Math.max(0, Math.ceil(bill.logs - spare)) }
}
