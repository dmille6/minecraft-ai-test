// THE SHARED MINESHAFT, BUILD SIDE (shaft-01; docs/reports/ziggurat-mineshaft-2026-10-15.md section 4). PURE except the
// record files (link()-created generations, the monument's helpers).
//
// Geometry and survey are shaftplan.mjs's (the stage-1 offline gate scored the same envelope this job opens). This file adds:
//   - SHAFT_SITES: the 12 M0 sites (docs/reports/zig-z0m0-2026-10-15.json `worlds.<pool>.shaft`), re-verified live;
//   - the record (shaft-<home>.g<N>.json) and its frontier;
//   - the reserved cells (structures.mjs kind 'shaft'), the core columns (T10) and the envelope a bot may stand in;
//   - one LEVEL's work list, in the order Paper proved (scratchpad zig5/shaftprobe.mjs: 12 levels, 24/24 ladders, 72/72
//     lining on the server): dig the other column's cell diagonally, line it, ladder it; step down into it; dig this
//     column's cell beside, line it, ladder it.
// Shaft-local frame: core (0,y,0) and (1,y,0); +v points AWAY from home; column 0's ladders hang on the u=-1 wall (DOWN),
// column 1's on the u=2 wall (UP); c = the collar's feet level; the top ladders are at c-1.
import { toWorld, landingLevels, SHAFT_FLOOR } from './shaftplan.mjs'
import { toLocal, shaftIndex, goodSolid } from './shaftindex.mjs'
export { toLocal, shaftIndex }
import { structureKey } from './structures.mjs'
import { readMonument, createMonumentGen } from './monumentjob.mjs'

export const SHAFT_VERSION = 1

/** THE 12 M0 SITES (stage 1, 04:14Z snapshots): origin = local (0,0), away = the +v direction, c = collar feet level. */
export const SHAFT_SITES = Object.freeze({
  'board-a': { origin: { x: 374, z: 166 }, away: 'e', c: 69 },
  'board-b': { origin: { x: -263, z: 126 }, away: 'n', c: 64 },
  'board-c': { origin: { x: 368, z: 167 }, away: 's', c: 69 },
  'board-d': { origin: { x: 376, z: 138 }, away: 'e', c: 68 },
  'hive-a': { origin: { x: 374, z: 165 }, away: 'e', c: 72 },
  'hive-b': { origin: { x: 373, z: 167 }, away: 's', c: 70 },
  'hive-c': { origin: { x: -85, z: -65 }, away: 'w', c: 63 },
  'hive-d': { origin: { x: 56, z: 50 }, away: 'n', c: 64 },
  'placebo-a': { origin: { x: 228, z: -146 }, away: 'w', c: 72 },
  'placebo-b': { origin: { x: 261, z: -406 }, away: 'w', c: 64 },
  'placebo-c': { origin: { x: 365, z: 126 }, away: 'n', c: 71 },
  'placebo-d': { origin: { x: 158, z: 79 }, away: 'w', c: 76 },
})

export const shaftKey = home => structureKey('shaft', home)
export const readShaft = readMonument
export const createShaftGen = createMonumentGen

/** A new record body. Pure. frontier = the lowest COMPLETED level (c + 1: none yet; the collar level c counts as a level). */
export function newShaftRecord ({ site, bottom, landings, home, world = null, by = '?', now = 0, survey = null }) {
  return { v: SHAFT_VERSION, structure: 'shaft', world: world || null, home: { ...home }, site: { origin: { ...site.origin }, away: site.away, c: site.c },
           plan_bottom: bottom, plan_landings: [...landings], bottom, landings: [...landings], frontier: site.c + 1, state: 'building', why: null, survey, created_at: now, sited_by: by,
           // THE RAIL LANE (a later logistics project, coordinator 10-15): each landing's straight solid-floored run, local coords
           rail: { lane_u: 0, landing_v: [2, 8], stop_block: { u: 0, v: 1 }, surface_terminus_v_max: -2, note: 'v=1 holds a stop block so a cart never rolls into column 0; never on the pad (v=-1) or the collar rim' } }
}

/** Landings for a site and the live survey's stop (shaftplan.landingLevels; a stop keeps the landings above it). Pure. */
export function plannedLandings (c, stop = null, floor = SHAFT_FLOOR) {
  return landingLevels(c, floor).filter(yL => stop == null || yL - 2 > stop)
}

/** The shell (lining) cells beside one core cell at level y, local: the column's wall, the -v side, the +v side. Pure. */
export const coreShell = (u, y) => [[u === 0 ? -1 : 2, y, 0], [u, y, -1], [u, y, 1]]
/** The wall a column's ladder hangs on, local. Pure. */
export const ladderWall = u => (u === 0 ? -1 : 2)

/**
 * ONE LEVEL'S LINING NEEDS, from the shell set of the record: the lining cells of level y that the core routine touches
 * (the -v cells at the collar level are the entry pad's side and stay open). Pure.
 */
export function levelShell (idx, y) {
  const out = []
  for (const u of [0, 1]) for (const [a, b, c] of coreShell(u, y)) if (idx.roleAt(...wxyz(idx.site, a, b, c)) === 'lining') out.push([a, b, c])
  return out
}
const wxyz = (site, u, y, v) => { const w = toWorld(site.origin, site.away, u, v); return [w.x, y, w.z] }
export const worldOf = (site, u, y, v) => { const w = toWorld(site.origin, site.away, u, v); return { x: w.x, y, z: w.z } }

/** The next level to open -> y | null (complete). Pure. */
export const nextLevel = rec => (rec && rec.state === 'building' && rec.frontier - 1 >= rec.bottom ? rec.frontier - 1 : null)

/** Advance the frontier to y (only ever down, one level at a time) -> the next record body. Pure. */
export function advance (rec, y, { now = 0, by = '?' } = {}) {
  if (y !== rec.frontier - 1) return rec
  const done = y <= rec.bottom
  return { ...rec, frontier: y, state: done ? 'complete' : rec.state, last_level_at: now, last_by: by }
}

// ---- THE NEXT OPERATION (pure; resume-safe: it reads the CELLS, never trusts the record's idea of progress) ---------------

const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|.*concrete_powder)$/
const WETN = /^(water|lava|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/
export const isWet = b => !!b && (WETN.test(b.name ?? '') || b.props?.waterlogged === true || b.props?.waterlogged === 'true')
export const isOpen = b => !!b && (b.boundingBox === 'empty' || b.name === 'ladder') && !isWet(b)
/** A good wall or floor: a full collision cube, not liquid, not a ladder; a falling block only if its own support is solid. */
export { goodSolid }
export const isFalling = b => !!b && FALLING.test(b.name ?? '')

/** The landing's dig cells in BUILD ORDER, as (u, v) pairs (each a 2-high cell pair at yL, yL+1). Pure. */
export function landingOrder () {
  const out = [[0, 1], [1, 1]]
  for (let v = 2; v <= 4; v++) for (const u of [0, 1, -1, 2]) out.push([u, v])
  for (let v = 5; v <= 8; v++) for (const u of [0, 1]) out.push([u, v])
  return out
}
/** The shell cells around a landing dig pair (u, v): floor, ceiling and the horizontal sides that are not dig cells. Pure. */
export function landingShell (dig, yL, u, v) {
  const out = [[u, yL - 1, v], [u, yL + 2, v]]
  for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const y of [yL, yL + 1]) if (!dig.has(`${u + du},${y},${v + dv}`) && !(v + dv === 0)) out.push([u + du, y, v + dv])
  return out.filter(([a, y, b]) => !(b === 9))   // the stub's end face is never lining (digging continues there)
}

/**
 * THE NEXT OPERATION OF A BUILD VISIT -> { op, ... }. Pure over read(local u, y, v) -> block | null (unloaded) and the bot's
 * LOCAL feet { u, y, v }. Ops: 'collar_dig', 'line', 'dig', 'fill_floor', 'ladder', 'move_down' (into a column cell),
 * 'step' (to an adjacent open landing cell), 'advance' (the level verified), 'close' (safe closure: refill, then stop), 'wait'
 * (unknown / unloaded reads), 'done'. `rec`: frontier, bottom (usable), landings, landings_done.
 */
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
/**
 * A PLACEMENT INTO `cell` NEEDS A SOLID NEIGHBOUR (any face: Paper accepted a non-visible one, E2). None -> the first
 * neighbour that is not a dig cell, not liquid, and has a solid neighbour of its own is placed first (a one-cell chain:
 * Claude plan r1 P1-6 / r2 P2-4). -> null (supported) | [u, y, v] (place this first) | 'none'. Pure.
 */
export function supportChain (read, digSet, [u, y, v]) {
  const solidAt = (a, b, c) => { const blk = read(a, b, c); return !!blk && blk.boundingBox === 'block' && !isWet(blk) }
  if (N6.some(([du, dy, dv]) => solidAt(u + du, y + dy, v + dv))) return null
  for (const [du, dy, dv] of N6) {
    const n = [u + du, y + dy, v + dv]
    if (digSet.has(n.join(','))) continue
    const b = read(...n)
    if (!b || isWet(b)) continue
    if (N6.some(([eu, ey, ev]) => solidAt(n[0] + eu, n[1] + ey, n[2] + ev))) return n
  }
  return 'none'
}
export function shaftNextOp ({ rec, read, feet, digSet }) {
  const c = rec.site.c
  const y = rec.frontier - 1
  if (rec.state !== 'building' || y < rec.bottom) return { op: 'done' }
  const at = (u, yy, v) => read(u, yy, v)
  // every placement op passes through here: a cell with no solid neighbour gets its chain cell first, or closes
  const placeOp = (op) => {
    const ch = supportChain(read, digSet, op.cell)
    if (ch === null) return op
    if (ch === 'none') return { op: 'close', why: `no support within one cell of ${op.cell.join(',')}` }
    return { ...op, op: 'line', cell: ch, chain: op.cell, falling: false }
  }
  const need = (cells, ctx) => {           // the first lining cell that is not a good solid -> an op
    for (const [u, yy, v] of cells) {
      const b = at(u, yy, v)
      if (b == null) return { op: 'wait', why: `unloaded ${u},${yy},${v}` }
      if (goodSolid(b, at(u, yy - 1, v))) continue
      if (isWet(b)) return { op: 'close', why: `liquid in the lining at ${u},${yy},${v}`, ctx }
      return isFalling(b) ? { op: 'line', cell: [u, yy, v], falling: true, ctx } : placeOp({ op: 'line', cell: [u, yy, v], falling: false, ctx })
    }
    return null
  }
  // THE COLLAR (level c): the two collar cells open, the rim lined, the pad floor proven
  if (y === c) {
    for (const u of [0, 1]) { const b = at(u, c, 0); if (b == null) return { op: 'wait', why: 'collar unloaded' }; if (isWet(b)) return { op: 'close', why: 'liquid in the collar' }; if (!isOpen(b)) return { op: 'collar_dig', cell: [u, c, 0] } }
    const rim = need([[-1, c, 0], [2, c, 0], [0, c, 1], [1, c, 1], [0, c - 1, -1], [1, c - 1, -1]], 'collar')
    if (rim) return rim
    return { op: 'advance', y: c }
  }
  // IN THE LANDING being built (feet at its level, in a portal/room/stub cell): the core of this level is complete by
  // construction (the landing starts only after both ladders) -- carry on with the landing
  if (feet.y === y && feet.v !== 0 && digSet.has(`${feet.u},${y},${feet.v}`) && (rec.landings ?? []).includes(y) && !(rec.landings_done ?? []).includes(y)) {
    if (at(0, y, 0)?.name === 'ladder' && at(1, y, 0)?.name === 'ladder') return { op: 'landing', y }
  }
  // the bot's place: a column cell at feet y+1 (state A) or at feet y (state B); anything else -> descend first
  if (feet.v === 0 && (feet.u === 0 || feet.u === 1) && feet.y === y + 1) {
    const a = feet.u, b = 1 - a
    const cb = at(b, y, 0)
    if (cb == null) return { op: 'wait', why: 'core unloaded' }
    if (isWet(cb)) return { op: 'close', why: `liquid in the core at ${b},${y},0` }   // Codex code r1 P2: never 'dig' water
    if (!isOpen(cb)) return { op: 'dig', cell: [b, y, 0] }
    const ln = need(coreShell(b, y).filter(([u, yy, v]) => !digSet.has(`${u},${yy},${v}`)).concat(y === rec.bottom ? [[b, y - 1, 0]] : []), 'core')
    if (ln) return ln
    const fl = at(b, y - 1, 0)
    if (fl == null) return { op: 'wait', why: 'floor unloaded' }
    if (!goodSolid(fl, at(b, y - 2, 0))) { if (isWet(fl)) return { op: 'close', why: `liquid under ${b},${y},0` }; return isFalling(fl) ? { op: 'fill_floor', cell: [b, y - 1, 0], falling: true } : placeOp({ op: 'fill_floor', cell: [b, y - 1, 0] }) }
    if (cb.name !== 'ladder') return { op: 'ladder', u: b, y }
    return { op: 'move_down', u: b, y }
  }
  if (feet.v === 0 && (feet.u === 0 || feet.u === 1) && feet.y === y) {
    const b = feet.u, a = 1 - b
    const ca = at(a, y, 0)
    if (ca == null) return { op: 'wait', why: 'core unloaded' }
    if (isWet(ca)) return { op: 'close', why: `liquid in the core at ${a},${y},0` }
    if (!isOpen(ca)) return { op: 'dig', cell: [a, y, 0] }
    const ln = need(coreShell(a, y).filter(([u, yy, v]) => !digSet.has(`${u},${yy},${v}`)).concat(y === rec.bottom ? [[a, y - 1, 0], [b, y - 1, 0]] : []), 'core')
    if (ln) return ln
    if (ca.name !== 'ladder') return { op: 'ladder', u: a, y }
    const cb = at(b, y, 0)
    if (cb?.name !== 'ladder') return { op: 'ladder', u: b, y }
    if ((rec.landings ?? []).includes(y) && !(rec.landings_done ?? []).includes(y)) return { op: 'landing', y }
    return { op: 'advance', y }
  }
  return { op: 'descend', y }
}

/**
 * THE NEXT LANDING OPERATION at landing yL -> { op, ... }. Pure. The bot works the landing from open cells at feet yL; each
 * dig pair is opened from an adjacent open stance, its floor proven (filled if not), its shell lined, before the next.
 *   ops: 'step' (to an adjacent open cell toward `stance`), 'dig', 'fill_floor', 'line', 'landing_done', 'wait', 'close'
 */
export function landingNextOp ({ yL, read, feet, digSet }) {
  const at = (u, yy, v) => read(u, yy, v)
  const placeOp = (op) => { const ch = supportChain(read, digSet, op.cell); if (ch === null) return op; if (ch === 'none') return { op: 'close', why: `no support within one cell of ${op.cell.join(',')}` }; return { ...op, cell: ch, chain: op.cell, falling: false } }
  const order = landingOrder()
  for (let i = 0; i < order.length; i++) {
    const [u, v] = order[i]
    const feetB = at(u, yL, v), headB = at(u, yL + 1, v)
    if (feetB == null || headB == null) return { op: 'wait', why: `landing unloaded ${u},${v}` }
    if (isWet(feetB) || isWet(headB)) return { op: 'close', why: `liquid in the landing at ${u},${v}` }
    const opened = isOpen(feetB) && isOpen(headB)
    if (!opened) {
      // a stance: an open neighbour at feet yL, earlier in the order (or a core column cell)
      const stances = [[u, v - 1], [u - 1, v], [u + 1, v]].filter(([su, sv]) => (sv === 0 ? (su === 0 || su === 1) : digSet.has(`${su},${yL},${sv}`)) && isOpen(at(su, yL, sv)) && isOpen(at(su, yL + 1, sv)))
      if (!stances.length) return { op: 'close', why: `no open stance beside ${u},${v}` }
      const st = stances.find(([su, sv]) => su === feet.u && sv === feet.v && feet.y === yL)
      if (!st) return { op: 'walk', to: [stances[0][0], yL, stances[0][1]] }
      if (!isOpen(headB)) return { op: 'dig', cell: [u, yL + 1, v] }
      return { op: 'dig', cell: [u, yL, v] }
    }
    // opened: the floor proven, then the shell lined
    const fl = at(u, yL - 1, v)
    if (fl == null) return { op: 'wait', why: 'landing floor unloaded' }
    if (!goodSolid(fl, at(u, yL - 2, v))) {
      if (isWet(fl)) return { op: 'close', why: `liquid under the landing at ${u},${v}` }
      const s0 = [[u, v - 1], [u - 1, v], [u + 1, v]].find(([su, sv]) => (sv === 0 ? (su === 0 || su === 1) : digSet.has(`${su},${yL},${sv}`)) && isOpen(at(su, yL, sv)) && goodSolid(at(su, yL - 1, sv), at(su, yL - 2, sv)))
      const op = { op: 'line', cell: [u, yL - 1, v], falling: isFalling(fl), ctx: 'landing', from: s0 ? [s0[0], yL, s0[1]] : null }
      return op.falling ? op : placeOp(op)
    }
    for (const [a, yy, b] of landingShell(digSet, yL, u, v)) {
      const blk = at(a, yy, b)
      if (blk == null) return { op: 'wait', why: 'landing shell unloaded' }
      if (goodSolid(blk, at(a, yy - 1, b))) continue
      if (isWet(blk)) return { op: 'close', why: `liquid in the landing shell at ${a},${yy},${b}` }
      return isFalling(blk) ? { op: 'line', cell: [a, yy, b], falling: true, ctx: 'landing', from: [u, yL, v] } : placeOp({ op: 'line', cell: [a, yy, b], falling: false, ctx: 'landing', from: [u, yL, v] })
    }
  }
  return { op: 'landing_done', y: yL }
}

/**
 * WHICH COLUMN TO RIDE DOWN TO THE WORK -> { col, land: { u, y, v } } | { blocked: why }. Pure (Claude shaft plan r1 P2-3: a
 * resumed builder must never slide one level past the frontier onto an unproven floor). y = frontier - 1: ride a column
 * that is open, laddered and whose floor (·,y-1) is proven (it lands at feet y: the deepest proven stand); else one whose
 * cell at y is still SOLID (it lands at feet frontier); else blocked (nothing is ridden onto an unknown floor).
 */
export function descentPlan ({ rec, read }) {
  const y = rec.frontier - 1
  // the deepest proven stand first (a resumed visit picks up where the last one stood), then the frontier itself
  for (const col of [0, 1]) { const b = read(col, y, 0); if (b?.name === 'ladder' && goodSolid(read(col, y - 1, 0), read(col, y - 2, 0))) return { col, land: { u: col, y, v: 0 } } }
  for (const col of [0, 1]) { const b = read(col, y, 0); if (b && b.boundingBox === 'block' && b.name !== 'ladder') return { col, land: { u: col, y: y + 1, v: 0 } } }
  return { blocked: `neither column at y=${y} can be ridden onto a proven floor` }
}

// ---- THE ORDER (cognitive; design 4.5, plan r2 item 13) -------------------------------------------------------------------
export const SHAFT_ORDERS = new Set(['dig_shaft'])
export const SHAFT_COOLDOWN_MS = 10 * 60_000
export const SHAFT_BUDGET_MS = 10 * 60_000          // body time per hour
export const SHAFT_ORDER_RADIUS = 48
const LOGS = /_log$|_stem$/
/** Ladders this bag holds or could make (7 sticks -> 3 ladders; 2 planks -> 4 sticks; 1 log -> 4 planks). Pure. */
export function laddersAvailable (items = []) {
  const n = re => items.filter(i => re.test(i.name)).reduce((a, i) => a + (i.count ?? 0), 0)
  const sticks = n(/^stick$/) + 2 * n(/_planks$/) + 8 * n(LOGS)
  return n(/^ladder$/) + 3 * Math.floor(sticks / 7)
}
/**
 * SEND A BOT TO BUILD THE SHAFT? -> { order, why, state }. Pure. Admission only for a bot that can finish a level (Claude
 * plan r1 P2-5): a pickaxe with durability, stone above the reserve, ladders it holds or can craft; near the pad; the build
 * lease free; off cooldown; inside the hourly budget; a record that is building (or none yet).
 */
export function shaftOrder ({ now = 0, on = false, state: rs = 'unsited', distPad = Infinity, leaseFree = true, spareStone = 0, pickDurability = 0, items = [], st = {} } = {}) {
  const state = { ...st }
  const no = why => ({ order: null, why, state })
  if (!on) return no('off')
  if (!(rs === 'building' || rs === 'unsited' || rs === 'closure_pending')) return no(`shaft ${rs}`)
  if (distPad > SHAFT_ORDER_RADIUS) return no('far')
  if (now < (state.cooldownUntil ?? 0) || now < (state.backoffUntil ?? 0)) return no('cooldown')
  const spent = (state.spent ?? []).filter(v => now - v.t < 3_600_000).reduce((a, v) => a + v.ms, 0)
  if (spent >= SHAFT_BUDGET_MS) return no('budget')
  if (!leaseFree) return no('busy')
  if (pickDurability < 20 || spareStone < 8 || laddersAvailable(items) < 3) return no('materials')
  state.lastIssuedAt = now
  return { order: { skill: 'dig_shaft', args: {}, why: 'the shared mineshaft: build the next levels' }, why: 'ok', state }
}
const RUNNER_DECLINES_S = new Set(['runner_paused', 'runner_busy', 'body_held'])
export function shaftOrderOutcome (status, failClass, now = 0, ms = 0, st = {}) {
  const s = { ...st, cooldownUntil: now + SHAFT_COOLDOWN_MS, spent: [...(st.spent ?? []), { t: now, ms: Math.max(0, ms) }].filter(v => now - v.t < 3_600_000) }
  if (RUNNER_DECLINES_S.has(failClass)) return s
  if (failClass === 'shaft_no_site') s.backoffUntil = now + 60 * 60_000
  else if (status === 'failed') s.backoffUntil = now + 30 * 60_000
  return s
}
