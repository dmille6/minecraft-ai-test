// ROUGHGROUND-01 (owner 11-07, three circled renders of the showcase town: "will the greens keeper fill these areas in and smooth them
// out?" ... "i'd like all areas like this to be smoothed out and made to look pretty"). PURE: the groundskeeper's second survey, run
// beside tidy.mjs surveyInwall in the inside-the-wall stage and in every outer band (tidy.mjs siteStage), and the stage clock that sends
// the keeper back inside the walls. Nothing here touches a bot or a file.
//
// WHY (measured 11-07 on the 07:00Z mirror copy, docs/reports/roughground-design-2026-11-07.md): the owner's ~29 circled areas map to
// ~4,300 ground columns holding 739 bump-clump columns, 94 one-column pillars, 124 floating blocks/beams, 147 hole columns and 26 stray
// crafting tables/furnaces. surveyInwall takes a STRAY only when ONE column stands above ALL 8 neighbours, every neighbour reads as
// ground, no leaf hangs over it and every block down to the neighbours is spoil -- so a 2-column clump, a pillar under a spruce, a
// dirt block hanging in the canopy (air under it: `stray_natural`, 46 in the live survey), any column beside a crafting table, and the
// table itself are never taken; a HOLE only when lower than all 8, so a 2-wide hole or a trench never is. And the bots keep making
// them: 24 h of `_place_town` rows = ~2,500 pathfinder/reflex scaffold blocks in the town and its margin; 823 of the 1,418 ledgered
// climbs (58%) still stand.
//
// WHAT IT ADDS (cuts and fills on the same record, the same visit code, buildrun.mjs `p.tidy`):
//   FLOATING  a column's spoil standing >= floatMin over the median ground of the 24 round it with an open cell (air, leaves, a
//             plant) under it -- a block or a beam left in the air -- is cut, top first, while it is within floatReach of the ground
//             under it (a bot on the ground reaches it); higher gets a STAND (roughground-1c: a stone staircase beside the column, at
//             most platMax 3 steps, torn down once the blocks are cut); no side for one: named `float_high`. A spoil run that ends on a log or natural ground
//             is attached, never floating.
//   CLUMPS    4-connected columns >= 1 over their median ground, at most clumpMax of them: each cut down to the HIGHEST ground round
//             the clump (never below a neighbour: no new pit), spoil only, at most cutMax a column; a log standing on a column (a
//             trunk) keeps the whole clump. Leaves overhead do not matter. A bigger raised area is a hill (the terrace's).
//             A crust over a hollow (the bots' 2-high tunnels under the grass): cut only with the hollow under it filled after the cut
//             (at most fillMax deep, else named `*_hollow`), the cut carrying the hollow's cells (`hollow`) so the visit digs it only
//             while no body stands in them (hollowClear; roughground-1b).
//   HOLES     4-connected columns <= -1 under their median, at most holeMax in a box of holeBox: filled to the LOWEST ground round
//             them (never above a neighbour), at most fillMax deep; never with liquid or an unread cell in the rim.
//   STATIONS  a crafting table standing loose (not a record or plan cell): cut, with the spoil pillar under it down to the highest
//             ground round it. Furnaces are left (their contents and the smelters' leases: stations-01's sweep).
//   SCAFFOLD  every ledgered climb (placeaudit.mjs climbOf: the pathfinder's and the reflexes' pillars, steps and bridges) whose
//             spoil still stands ABOVE the ground round it is cut with the spoil over it -- the bots' own scaffold, taken back by
//             the keeper (the placing code is protected movement: it stays as it is).
// NEVER: a record cell, a column within `near` of one (a build's own footprint), a column `avoid` names that is not a build's box (a
// zone, a well, the farm, the tree farm), the stock yard or the tree farm (noLitter), a site-prep reservation, a column a cut, fill or
// staircase of this stage already uses, a cell beside liquid. ROUGH=off is the rollback (the stage as it was).

import { regradeWork, REGRADE } from './regrade.mjs'   // roughground-4: the wide-area regrade

export const ROUGH = Object.freeze({ regrade: true, floatMin: 2, floatReach: 5, clumpMax: 9, cutMax: 6, holeMax: 9, holeBox: 4, fillMax: 4, smoothN: 6, hollow: true, stands: true, platMax: 3, banks: true, topsoil: true, lawnMin: 4, near: 1, cap: 1200, medMin: 16, inwallEveryMs: 60 * 60_000 })
/** THE SWITCH: ROUGH=off|0|false|no -> no rough survey, no inside-the-wall re-survey; on by default. Pure. */
export const roughOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.ROUGH ?? '').trim())

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const k2 = (x, z) => `${x},${z}`
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
const LOG = /_(log|wood)$|^mangrove_roots$|_stem$/
const AIR = /^(air|cave_air|void_air)$/
const LIQ = /^(water|lava|bubble_column)$/
export const STATION = /^crafting_table$/
/**
 * AT THE DIG (the showcase release fold, Codex BLOCKERS 1 + 2) -> why | null: a rough cut waits. Pure.
 *  - own_footing: the digging bot itself stands ON (or in) the cell with open air under it (a floating block: its walk off it failed or
 *    timed out) -- digging it drops the bot; it waits until the bot has stepped off (otherBodyOnCell covers every OTHER body);
 *  - station_in_use: the cell is a loose crafting table and another player stands within STATION_USE_R (a bot crafting at its own
 *    temporary table: runCraftPlan places one off every record) -- the table stays until nobody is at it.
 * self: the digging bot's position { x, y, z } | null; others: other players' positions.
 */
export const STATION_USE_R = 8
export function roughCutWaits ({ at, read, self = null, others = [] } = {}) {
  if (!Array.isArray(at) || at.length !== 3 || typeof read !== 'function') return null
  const [x, y, z] = at
  if (self && [self.x, self.y, self.z].every(Number.isFinite)) {
    const w = 0.3
    const over = self.x + w > x && self.x - w < x + 1 && self.z + w > z && self.z - w < z + 1
    const below = read(x, y - 1, z)
    if (over && self.y >= y && self.y < y + 2.01 && (!below || openCell(below))) return 'own_footing'
  }
  const b = read(x, y, z)
  if (b && STATION.test(nm(b)) && (others ?? []).some(p => p && Math.hypot(p.x - (x + 0.5), p.y - y, p.z - (z + 0.5)) <= STATION_USE_R)) return 'station_in_use'
  return null
}
/** Earth no build is made of: floating beside a build's ring, it is still the bots' (a build's planks or cobble may not be). */
export const EARTH = /^(dirt|coarse_dirt|grass_block)$/
/** The records whose cells lie flat on the ground (a path, a road, the dress's lights, crops, decor plantings, the forest's rows): only
 *  their own columns are kept, not the ring round them. Pure data. */
export const FLAT_PLOTS = /^(paths|road|dress|decor|cropfarm|canefarm|forest|treefarm|yard|park|garden)$/
/** The cells whose ring is kept -> Set "x,y,z": every record's cells but the flat ones'. Pure. */
export const nearCellsOf = (records = []) => new Set((records ?? []).filter(r => !FLAT_PLOTS.test(String(r?.plot ?? ''))).flatMap(r => (r?.cells ?? []).filter(c => Array.isArray(c?.at)).map(c => c.at.join(','))))
/** An OPEN cell (nothing holds a block up): air, leaves, a plant or anything with no collision box. Pure. */
export const openCell = b => !!b && (AIR.test(nm(b)) || /_leaves$/.test(nm(b)) || b.boundingBox === 'empty') && !LIQ.test(nm(b)) && !String(b.name ?? '').includes('waterlogged')
const liquid = b => !!b && (LIQ.test(nm(b)) || String(b.name ?? '').includes('waterlogged'))
const median = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)] }

/**
 * ONE COLUMN'S FLOATING SPOIL -> { segs: [[{ at, name }]] top first, ground, why }. Pure over `read`. From the column's top (`top`, the
 * tidy's ground: tidyColumn, which reads a block in the canopy as ground) down: while the top block stands >= floatMin over `med` and
 * the run of spoil under it ends on an OPEN cell, the run is a floating segment; the next solid under the gap is looked at the same
 * way. `ground`: the first solid that is not floating (null when unread). `why`: 'attached' (a run ending on a log or a non-spoil
 * block, kept) | null.
 */
export function floatingSegs (read, x, z, { top, med, yLo, spoil, T = ROUGH }) {
  const segs = []
  let y = top
  for (let guard = 0; guard < 8 && y != null && y >= yLo; guard++) {
    if (y < med + T.floatMin) return { segs, ground: y, why: null }
    const run = []
    let yy = y
    while (yy >= yLo) {
      const b = read(x, yy, z)
      if (!b) return { segs, ground: null, why: 'unknown' }
      if (openCell(b)) break
      if (!spoil.test(nm(b))) return { segs, ground: y, why: run.length ? 'attached' : null }
      run.push({ at: [x, yy, z], name: nm(b) }); yy--
    }
    if (!run.length) return { segs, ground: y, why: null }
    segs.push(run)
    // down through the gap to the next solid
    while (yy >= yLo) { const b = read(x, yy, z); if (!b) return { segs, ground: null, why: 'unknown' }; if (!openCell(b)) break; yy-- }
    y = yy >= yLo ? yy : null
  }
  return { segs, ground: y, why: null }
}

/**
 * THE ROUGH-GROUND SURVEY -> { ok, cut, fill, pillars, pits, skipped, census }. Pure over `read`.
 *   box       [x0, z0, x1, z1] the columns surveyed;  within(x, z) a stage's own columns (a band's)
 *   col(x, z) the tidy's column (tidy.mjs tidyColumn: { y, name, why, tree }), memoised by the caller or not
 *   spoil     the bots' material (tidy.mjs SPOIL);  buildWhy  the avoid reasons that are a build's box (tidy.mjs BUILD_WHY)
 *   avoid, cells, noLitter, reserved   the stage's guards (as surveyInwall's);  busy  Set "x,z" this stage already works
 *   nearCells the cells whose column's RING is kept too (the standing builds': FLAT_PLOTS' cells are not in it)
 *   climbs    the bots' ledgered scaffold ([{ x, y, z, shape }], placeaudit.mjs);  home  nearest-first order
 */
export function surveyRough (read, { home, box, within = () => true, col, spoil, buildWhy = /^$/, avoid = () => null, cells = new Set(), nearCells = cells, noLitter = () => false, reserved = () => false, busy = new Set(), climbs = [], yLo = -64, standOff = () => false, T = ROUGH } = {}) {
  const skipped = {}
  const skip = (why, n = 1) => { skipped[why] = (skipped[why] ?? 0) + n }
  const census = { floating: 0, float_high: 0, clumps: 0, holes: 0, stations: 0, scaffold: 0, smoothed: 0, hollows: 0, stands: 0, topsoil: 0, banks: 0, regraded: 0 }
  const out = { ok: true, why: 'ok', cut: [], fill: [], pillars: [], pits: [], platforms: [], clear: [], skipped, census }
  if (!home || !Array.isArray(box) || typeof col !== 'function' || !spoil) return { ...out, ok: false, why: 'no_box' }
  const colsOf = set => new Set([...set].map(k => { const [x, , z] = String(k).split(','); return `${x},${z}` }))
  const cellCols = colsOf(cells), nearCols = colsOf(nearCells)
  // a record cell's own column is never touched; a STANDING build's (nearCells: not the flat ones -- paths, lights, crops) ring too
  const nearCell = (x, z) => { if (cellCols.has(k2(x, z))) return true; for (let dx = -T.near; dx <= T.near; dx++) for (let dz = -T.near; dz <= T.near; dz++) if (nearCols.has(k2(x + dx, z + dz))) return true; return false }
  const used = new Set(busy)
  // MAY THIS SURVEY TOUCH (x, z)? -> null | why
  const refuse = (x, z) => {
    if (x < box[0] || x > box[2] || z < box[1] || z > box[3] || !within(x, z)) return 'outside'
    if (used.has(k2(x, z))) return 'planned'
    if (noLitter(x, z)) return 'no_litter'
    if (reserved(x, z)) return 'reserved'
    const w = avoid(x, z)
    // the town plan's own cells and boxes (its stations, chests, the well's plot) are never the rough survey's, build or not
    if (w === 'plan_cell' || w === 'plan_box') return 'plan'
    if (w && !buildWhy.test(String(w))) return 'guarded'
    if (nearCell(x, z)) return 'build'
    return null
  }
  // THE GROUND, every column of the box + 2 (the medians): the tidy's top, then the floating spoil taken off it
  const raw = new Map(), gnd = new Map(), flo = new Map()
  const at = (x, z) => { const k = k2(x, z); if (!raw.has(k)) raw.set(k, col(x, z)); return raw.get(k) }
  const ok = c => !!c && !c.why && c.y != null
  const med24 = (x, z, f) => { const ys = []; for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { if (!dx && !dz) continue; const v = f(x + dx, z + dz); if (Number.isFinite(v)) ys.push(v) } return ys.length >= T.medMin ? median(ys) : null }
  const rawY = (x, z) => { const c = at(x, z); return ok(c) ? c.y : null }
  for (let x = box[0] - 2; x <= box[2] + 2; x++) for (let z = box[1] - 2; z <= box[3] + 2; z++) {
    const c = at(x, z)
    if (!ok(c)) { gnd.set(k2(x, z), null); continue }
    const med = med24(x, z, rawY)
    if (med == null) { gnd.set(k2(x, z), c.y); continue }
    const f = floatingSegs(read, x, z, { top: c.y, med, yLo, spoil, T })
    gnd.set(k2(x, z), f.ground)
    if (f.segs.length) flo.set(k2(x, z), { ...f, med })
    if (f.why === 'attached' && x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3]) skip('float_attached')
  }
  const g = (x, z) => gnd.get(k2(x, z)) ?? null
  const cuts = [], fills = []
  const order = []   // [d, kind, fn] -- nearest home first, under the cap
  const dist = (x, z) => Math.max(Math.abs(x - home.x), Math.abs(z - home.z))
  const solidAt = (x, y, z) => { const b = read(x, y, z); return !!b && !openCell(b) && !liquid(b) }
  // ROUGHGROUND-1B: UNDER A CUT over a hollow (the bots' 2-high tunnels under the grass crust) -> the open cells from the hollow's
  // floor up to the cut's new ground `top`, bottom first: filled after the cut (the record's layered segments), the cut itself dug only
  // while no body stands in them (the cut entry's `hollow`, hollowClear at the dig) -> [{ at }] | null (cannot: the column is left)
  const underFill = (x, top, z) => {
    if (!T.hollow) return null
    const add = []
    for (let yy = top; yy > top - T.fillMax - 1; yy--) {
      const b = read(x, yy, z)
      if (!b) return null
      if (solidAt(x, yy, z)) return add.length ? add.reverse() : null
      if (liquid(b) || cells.has(`${x},${yy},${z}`) || sideLiquid(x, yy, z) || !(AIR.test(nm(b)) || b.boundingBox === 'empty')) return null
      add.push({ at: [x, yy, z] })
    }
    return null
  }
  const sideLiquid = (x, y, z) => N4.some(([dx, dz]) => liquid(read(x + dx, y, z + dz))) || liquid(read(x, y + 1, z))
  // ROUGHGROUND-1C: A STAND to reach `top` over a column whose ground is `g` -> { cells, clears, cols } | null. The plotprep stand's
  // shape (tidy.mjs plotPrep): need = top - g - floatReach steps (<= platMax) running away from the column on one side, step i
  // need - i + 1 blocks high from the ground up, each column ground at g and free (`refuse`: no record, plan, zone, well, reservation),
  // its cells and two of head room open (leaves are cleared), step 1's column open up to the top (the bot's sight), a landing at
  // its foot. null: no side fits -- the blocks are named float_high.
  function standFor (x, z, gy, top) {
    const need = top - gy - T.floatReach
    if (need < 1 || need > T.platMax) return null
    const open = (cx, cy, cz) => { const b = read(cx, cy, cz); return !!b && (AIR.test(nm(b)) || (b.boundingBox === 'empty' && !liquid(b))) }
    const leaf = (cx, cy, cz) => /_leaves$/.test(nm(read(cx, cy, cz)))
    for (const [dx, dz] of N4) {
      const cs = [], clears = [], cols = []
      let ok = true
      for (let i = 1; i <= need + 1 && ok; i++) {
        const cx = x + dx * i, cz = z + dz * i, h = i <= need ? need - i + 1 : 0
        // Codex 1c r1 BLOCKER: never on a reserved plot (`standOff`: the wall extension's plots, whole boxes)
        if (g(cx, cz) !== gy || refuse(cx, cz) || used.has(k2(cx, cz)) || nearCell(cx, cz) || standOff(cx, cz)) { ok = false; break }
        const upTo = i === 1 ? top + 1 : gy + h + 2
        for (let y = gy + 1; y <= upTo; y++) {
          if (leaf(cx, y, cz)) clears.push({ at: [cx, y, cz], kind: 'leaves', name: nm(read(cx, y, cz)) })
          else if (!open(cx, y, cz)) { ok = false; break }
          if (y <= gy + h) cs.push([cx, y, cz])
        }
        cols.push(k2(cx, cz))
      }
      if (ok) return { cells: cs, clears, cols }
    }
    return null
  }
  // ---- FLOATING ----
  for (const [k, f] of flo) {
    const [x, z] = k.split(',').map(Number)
    const why = refuse(x, z)
    const earthOnly = f.segs.every(seg => seg.every(b => EARTH.test(b.name)))
    if (why && !(why === 'build' && earthOnly && !cellCols.has(k)) ) { if (why !== 'outside') skip(`float_${why}`); continue }
    const base = f.ground
    if (base == null) { skip('float_unread'); continue }
    const blocks = [], highs = []
    let bad = false
    for (const seg of f.segs) for (const b of seg) {
      if (cells.has(b.at.join(','))) { bad = true; break }
      if (b.at[1] - base > T.floatReach) { highs.push(b); continue }
      blocks.push(b)
    }
    if (bad) { skip('float_cell'); continue }
    // ROUGHGROUND-1C: blocks out of a ground stand's reach get a STAND -- a staircase of the town's stone beside the column, at most
    // platMax steps, torn down once they are cut (tidy.mjs platformTeardown, `targets`)
    let stand = null
    if (highs.length) {
      stand = T.stands ? standFor(x, z, base, Math.max(...highs.map(b => b.at[1]))) : null
      if (stand) blocks.push(...highs)
      else { skip('float_high', highs.length); census.float_high += highs.length }
    }
    if (!blocks.length) continue
    if (blocks.some(b => sideLiquid(...b.at))) { skip('float_water'); continue }
    order.push([dist(x, z), () => {
      if (used.has(k) || (stand && stand.cols.some(c => used.has(c)))) return
      used.add(k); census.floating += blocks.length
      const id = `rf${out.pillars.length}`; out.pillars.push({ id, col: [x, z], top: Math.max(...blocks.map(b => b.at[1])), base, h: blocks.length, kind: 'floating' })
      for (const b of blocks) cuts.push({ ...b, pillar: id })
      if (stand) {
        for (const c of stand.cols) used.add(c)
        census.stands++
        out.platforms.push({ targets: highs.map(b => b.at), cells: stand.cells, phase: 'up', kind: 'float' })
        for (const c of stand.clears) if (!out.clear.some(q => q.at.join(',') === c.at.join(','))) out.clear.push(c)
      }
    }])
  }
  // ---- STATIONS (a loose crafting table, and the spoil pillar under it) ----
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    const c = at(x, z)
    if (!c || c.why !== 'furniture' || !STATION.test(String(c.name))) continue
    const why = refuse(x, z)
    if (why) { if (why !== 'outside') skip(`station_${why}`); continue }
    let y = null
    for (let yy = (home.y ?? 70) + 16; yy >= yLo; yy--) { const b = read(x, yy, z); if (b && STATION.test(nm(b))) { y = yy; break } }
    if (y == null || cells.has(`${x},${y},${z}`)) { skip('station_cell'); continue }
    const ring = N8.map(([dx, dz]) => g(x + dx, z + dz)).filter(Number.isFinite)
    const rimMax = ring.length ? Math.max(...ring) : y - 1
    const blocks = [{ at: [x, y, z], name: nm(read(x, y, z)) }]
    let bad = false
    for (let yy = y - 1; yy > rimMax; yy--) {
      const b = read(x, yy, z)
      if (!b || openCell(b)) break
      if (cells.has(`${x},${yy},${z}`) || !spoil.test(nm(b))) { bad = true; break }
      blocks.push({ at: [x, yy, z], name: nm(b) })
    }
    if (bad) { skip('station_pillar_natural'); continue }
    if (blocks.some(b => sideLiquid(...b.at))) { skip('station_water'); continue }
    order.push([dist(x, z), () => { if (used.has(k2(x, z))) return; used.add(k2(x, z)); census.stations++; const id = `rs${out.pillars.length}`; out.pillars.push({ id, col: [x, z], top: y, base: rimMax, h: blocks.length, kind: 'station' }); for (const b of blocks) cuts.push({ ...b, pillar: id }) }])
  }
  // ---- CLUMPS and HOLES: 4-connected components off the median ground ----
  const dev = new Map()
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    const y = g(x, z)
    if (!Number.isFinite(y) || flo.has(k2(x, z))) continue
    // a column this survey may not touch is never part of a clump or a hole: it is their rim (a build's own: not even that)
    const rf = refuse(x, z)
    if (rf) { if (rf === 'build' || rf === 'planned') { const m0 = med24(x, z, g); if (m0 != null && Math.abs(y - m0) >= 1) skip(`ground_${rf}`) } continue }
    const m = med24(x, z, g)
    if (m == null) continue
    if (y >= m + 1) dev.set(k2(x, z), 1)
    else if (y <= m - 1) dev.set(k2(x, z), -1)
  }
  const seen = new Set(), keep = new Set()   // a clump or hole the rules KEEP (a trunk on it, water by it): never smoothed piecemeal
  for (const k0 of [...dev.keys()].sort()) {
    if (seen.has(k0)) continue
    const sign = dev.get(k0), comp = [], q = [k0]
    seen.add(k0)
    for (let i = 0; i < q.length; i++) {
      comp.push(q[i])
      const [x, z] = q[i].split(',').map(Number)
      for (const [dx, dz] of N4) { const n = k2(x + dx, z + dz); if (!seen.has(n) && dev.get(n) === sign) { seen.add(n); q.push(n) } }
    }
    const cs = comp.map(k => k.split(',').map(Number))
    const kind = sign > 0 ? 'clump' : 'hole'
    if (cs.length > (sign > 0 ? T.clumpMax : T.holeMax)) { skip(`${kind}_wide`); continue }
    const xs = cs.map(c => c[0]), zs = cs.map(c => c[1])
    if (sign < 0 && (Math.max(...xs) - Math.min(...xs) + 1 > T.holeBox || Math.max(...zs) - Math.min(...zs) + 1 > T.holeBox)) { skip('hole_wide'); continue }
    const inC = new Set(comp), ring = new Map()
    for (const [x, z] of cs) for (const [dx, dz] of N8) { const n = k2(x + dx, z + dz); if (!inC.has(n) && !nearCell(x + dx, z + dz)) ring.set(n, [x + dx, z + dz]) }
    const ringC = [...ring.values()].map(([x, z]) => ({ c: at(x, z), y: g(x, z) }))
    // ROUGHGROUND-2 (clean banks): a dry HOLE beside water is filled to the bank's ground round it (the water rim columns are not
    // its level, and nothing is placed into the water); a clump by water, or anything by an unread rim, is left as before
    const wet = ringC.some(r => r.c?.why === 'water')
    if (ringC.some(r => r.c?.why === 'unknown' || !r.c) || (wet && !(sign < 0 && T.banks))) { skip(`${kind}_rim`); for (const k of comp) keep.add(k); continue }
    if (wet && cs.some(([x, z]) => { for (let yy = g(x, z) + 1; yy <= g(x, z) + T.fillMax + 1; yy++) if (liquid(read(x, yy, z))) return true; return false })) { skip('hole_wet'); for (const k of comp) keep.add(k); continue }
    const ys = ringC.filter(r => r.c?.why !== 'water').map(r => r.y).filter(Number.isFinite)
    if (ys.length < Math.ceil(ring.size / 2)) { skip(`${kind}_rim`); continue }
    if (sign > 0) {
      const rimMax = Math.max(...ys)
      const blocks = [], under = []
      let bad = null
      for (const [x, z] of cs) {
        const y = g(x, z)
        if (y <= rimMax) continue
        if (y - rimMax > T.cutMax) { bad = 'clump_tall'; break }
        if (LOG.test(nm(read(x, y + 1, z)))) { bad = 'clump_tree'; break }
        for (let yy = y; yy > rimMax; yy--) {
          const b = read(x, yy, z)
          if (!b || cells.has(`${x},${yy},${z}`) || !spoil.test(nm(b))) { bad = 'clump_natural'; break }
          if (sideLiquid(x, yy, z)) { bad = 'clump_water'; break }
          blocks.push({ at: [x, yy, z], name: nm(b) })
        }
        if (!bad && !solidAt(x, rimMax, z)) {
          // a crust over a hollow: opened only with the hollow filled after it, and dug only while nobody stands in it (1b)
          const u = underFill(x, rimMax, z)
          if (!u) bad = 'clump_hollow'
          else {
            const mine = blocks.filter(b => b.at[0] === x && b.at[2] === z)
            for (const b of mine) b.hollow = u.map(a => a.at)
            for (const a of u) a.opener = mine[mine.length - 1].at   // Codex 1b r1: never waived (gkWaivable / stallWaive)
            under.push(...u)
          }
        }
        if (bad) break
      }
      if (bad) { skip(bad); if (bad === 'clump_tree' || bad === 'clump_water' || bad === 'clump_natural' || bad === 'clump_hollow') for (const k of comp) keep.add(k); continue }
      if (!blocks.length) continue
      const d = Math.min(...cs.map(([x, z]) => dist(x, z)))
      order.push([d, () => { if (comp.some(k => used.has(k))) return; for (const k of comp) used.add(k); census.clumps++; const id = `rc${out.pillars.length}`; out.pillars.push({ id, col: cs[0], cols: cs, base: rimMax, h: blocks.length, kind: 'clump' }); for (const b of blocks.sort((p, q) => q.at[1] - p.at[1])) cuts.push({ ...b, pillar: id }); if (under.length) { census.hollows++; out.pits.push({ id: `${id}u`, cols: [...new Set(under.map(a => k2(a.at[0], a.at[2])))].map(q => q.split(',').map(Number)), n: under.length, kind: 'under' }); for (const a of under) fills.push({ ...a, pit: `${id}u` }) } }])
    } else {
      const rimMin = Math.min(...ys)
      const floor = Math.min(...cs.map(([x, z]) => g(x, z)))
      if (rimMin - floor > T.fillMax) { skip('hole_deep'); continue }
      const add = []
      let bad = null
      for (const [x, z] of cs) {
        for (let yy = g(x, z) + 1; yy <= rimMin; yy++) {
          const b = read(x, yy, z)
          if (cells.has(`${x},${yy},${z}`)) { bad = 'hole_cell'; break }
          if (!b || !(AIR.test(nm(b)) || b.boundingBox === 'empty') || liquid(b)) { bad = 'hole_blocked'; break }
          add.push({ at: [x, yy, z] })
        }
        if (bad) break
      }
      if (bad) { skip(bad); continue }
      if (!add.length) continue
      const d = Math.min(...cs.map(([x, z]) => dist(x, z)))
      order.push([d, () => { if (comp.some(k => used.has(k))) return; for (const k of comp) used.add(k); census.holes++; if (wet) census.banks++; const id = `rh${out.pits.length}`; out.pits.push({ id, cols: cs, n: add.length, kind: 'hole' }); for (const a of add) fills.push({ ...a, pit: id }) }])
    }
  }
  // ---- SMOOTH: a column standing out of the ground round it where the clump/hole rule could not take it (rough ground wider than a
  // clump: each pass takes its sharpest columns to the median, the next survey the next ones; a hill's or a terrace's plateau is never
  // taken -- its columns are not over their own median, its edge columns have too few lower neighbours) ----
  for (const [k, sign] of dev) {
    if (keep.has(k)) continue
    const [x, z] = k.split(',').map(Number)
    const y = g(x, z)
    const ns = N8.map(([dx, dz]) => g(x + dx, z + dz))
    if (ns.filter(Number.isFinite).length < 7) continue
    const m = med24(x, z, g)
    const beyond = ns.filter(v => Number.isFinite(v) && (sign > 0 ? v < y : v > y)).length
    if (beyond < T.smoothN) continue
    if (sign > 0) {
      if (y - m > T.cutMax || LOG.test(nm(read(x, y + 1, z)))) { skip('smooth_tree_or_tall'); continue }
      const blocks = []
      let bad = false
      for (let yy = y; yy > m; yy--) { const b = read(x, yy, z); if (!b || cells.has(`${x},${yy},${z}`) || !spoil.test(nm(b)) || sideLiquid(x, yy, z)) { bad = true; break } blocks.push({ at: [x, yy, z], name: nm(b) }) }
      if (bad || !blocks.length) { if (bad) skip('smooth_natural'); continue }
      // a crust over a hollow (the bots' 2-high tunnels under the town): a cut would open the hollow, a bot may be in it, and the
      // visit digs before it fills (Codex r1 BLOCKER) -- the column is left, named
      const under = solidAt(x, m, z) ? [] : underFill(x, m, z)
      if (!under) { skip('smooth_hollow'); continue }
      if (under.length) { for (const b of blocks) b.hollow = under.map(a => a.at); for (const a of under) a.opener = blocks[blocks.length - 1].at }   // Codex 1b r1: the fill names the cut that opens it (gkWaivable / stallWaive never waive it)
      order.push([dist(x, z), () => { if (used.has(k)) return; used.add(k); census.smoothed++; const id = `rm${out.pillars.length}`; out.pillars.push({ id, col: [x, z], top: y, base: m, h: blocks.length, kind: 'smooth' }); for (const b of blocks) cuts.push({ ...b, pillar: id }); if (under.length) { census.hollows++; out.pits.push({ id: `${id}u`, cols: [[x, z]], n: under.length, kind: 'under' }); for (const a of under) fills.push({ ...a, pit: `${id}u` }) } }])
    } else {
      if (m - y > T.fillMax) { skip('smooth_deep'); continue }
      const add = []
      let bad = false
      for (let yy = y + 1; yy <= m; yy++) { const b = read(x, yy, z); if (!b || cells.has(`${x},${yy},${z}`) || !(AIR.test(nm(b)) || b.boundingBox === 'empty') || liquid(b) || sideLiquid(x, yy, z)) { bad = true; break } add.push({ at: [x, yy, z] }) }
      if (bad || !add.length) { if (bad) skip('smooth_blocked'); continue }
      order.push([dist(x, z), () => { if (used.has(k)) return; used.add(k); census.smoothed++; const id = `rn${out.pits.length}`; out.pits.push({ id, cols: [[x, z]], n: add.length, kind: 'smooth' }); for (const a of add) fills.push({ ...a, pit: id }) }])
    }
  }
  // ---- ROUGHGROUND-2 TOPSOIL: a cobblestone (or cobbled deepslate) top in a LAWN (lawnMin of its 8 neighbours grass) -- the bots' rubble at ground level --
  // is cut and the cell laid again in DIRT (role `topsoil`), which the grass round it greens (Paper 11-07: bare dirt beside grass in
  // daylight at the default tick, 24 of 24 green within 7.4 min, median 1.1). Only open ground: no avoid reason at all (never a
  // build's box, a path, the plaza), never a record cell or its ring, never a column this survey already works. ----
  if (T.topsoil) for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    const k = k2(x, z)
    const c = at(x, z)
    // Codex 2 r1 BLOCKER: only what the segment's own foreign dig takes (buildrun.mjs FOREIGN_CLEAR: the visit digs the cell's block
    // before it lays the dirt -- a tidy cut on a record cell is never in the visit's cut list); mossy cobblestone is not, so it is left
    if (!c || c.why || c.y == null || !/^(cobblestone|cobbled_deepslate)$/.test(String(c.name)) || dev.has(k) || flo.has(k)) continue
    if (refuse(x, z) || avoid(x, z)) continue
    const grassN = N8.filter(([dx, dz]) => { const n = at(x + dx, z + dz); return n && !n.why && n.name === 'grass_block' }).length
    if (grassN < T.lawnMin) continue
    if (cells.has(`${x},${c.y},${z}`) || sideLiquid(x, c.y, z) || !openCell(read(x, c.y + 1, z))) { skip('topsoil_guarded'); continue }
    order.push([dist(x, z), () => { if (used.has(k)) return; used.add(k); census.topsoil++; const id = `rt${out.pits.length}`; cuts.push({ at: [x, c.y, z], name: String(c.name), pillar: id }); out.pillars.push({ id, col: [x, z], kind: 'topsoil' }); out.pits.push({ id: `${id}f`, cols: [[x, z]], n: 1, kind: 'topsoil' }); fills.push({ at: [x, c.y, z], pit: `${id}f`, role: 'topsoil' }) }])
  }
  // ---- SCAFFOLD: the ledgered climbs still standing above the ground round them ----
  const seenC = new Set()
  for (const c of climbs ?? []) {
    if (![c?.x, c?.y, c?.z].every(Number.isFinite)) continue
    const kc = `${c.x},${c.y},${c.z}`
    if (seenC.has(kc)) continue
    seenC.add(kc)
    // the ledger PROVES the block is a bot's scaffold: beside a build (its footprint's ring) it is still taken, never a record cell
    const why = refuse(c.x, c.z)
    if (why && why !== 'build') { if (why !== 'outside' && why !== 'planned') skip(`scaffold_${why}`); continue }
    if (cellCols.has(k2(c.x, c.z))) { skip('scaffold_cellcol'); continue }
    const b = read(c.x, c.y, c.z)
    if (!b || !spoil.test(nm(b)) || cells.has(kc)) continue
    const m = med24(c.x, c.z, g)
    const ring = N8.filter(([dx, dz]) => !cellCols.has(k2(c.x + dx, c.z + dz))).map(([dx, dz]) => g(c.x + dx, c.z + dz)).filter(Number.isFinite)
    if (m == null || !ring.length || c.y <= Math.max(m, Math.max(...ring))) continue   // at or under the ground round it: it fills something now
    // the cell and every block over it in the column, while spoil (a log or a build over it: kept)
    const blocks = []
    let bad = null
    for (let yy = c.y; ; yy++) {
      const q = read(c.x, yy, c.z)
      if (!q) { bad = 'scaffold_unread'; break }
      if (openCell(q)) break
      if (cells.has(`${c.x},${yy},${c.z}`) || !spoil.test(nm(q))) { bad = 'scaffold_capped'; break }
      blocks.push({ at: [c.x, yy, c.z], name: nm(q) })
    }
    if (bad) { skip(bad); continue }
    if (blocks.at(-1).at[1] - Math.max(...ring) > T.floatReach + 1) { skip('scaffold_high'); continue }
    if (blocks.some(q => sideLiquid(...q.at))) { skip('scaffold_water'); continue }
    order.push([dist(c.x, c.z), () => { if (used.has(k2(c.x, c.z))) return; used.add(k2(c.x, c.z)); census.scaffold++; const id = `rl${out.pillars.length}`; out.pillars.push({ id, col: [c.x, c.z], top: blocks.at(-1).at[1], base: Math.max(...ring), h: blocks.length, kind: 'scaffold' }); for (const q of blocks.reverse()) cuts.push({ ...q, pillar: id }) }])
  }
  // nearest home first, under the cap (a cell is taken once: a later entry on a used column is dropped)
  order.sort((a, b) => a[0] - b[0])
  for (const [, fn] of order) {
    if (cuts.length + fills.length >= T.cap) { skip('cap'); continue }
    fn()
  }
  // ---- ROUGHGROUND-4: THE WIDE-AREA REGRADE over every open column no rule above took (regrade.mjs): rough ground wider than a
  // clump blended into 1-block steps toward the median ground round it, natural relief kept, in tiles nearest home first ----
  if (T.regrade) {
    const Hr = new Map()
    for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
      const k = k2(x, z), y = g(x, z)
      if (!Number.isFinite(y) || flo.has(k) || used.has(k) || keep.has(k) || refuse(x, z)) continue
      if (LOG.test(nm(read(x, y + 1, z)))) continue   // a trunk on the column: the tree stands
      Hr.set(k, y)
    }
    const room = Math.max(0, T.cap - cuts.length - fills.length)
    if (room > 0 && Hr.size) {
      const openR = (x, y, z) => { const b = read(x, y, z); return !!b && !cells.has(`${x},${y},${z}`) && (AIR.test(nm(b)) || (b.boundingBox === 'empty' && !liquid(b))) }
      const rw = regradeWork(read, Hr, { home, open: openR, solid: solidAt, wet: sideLiquid, R: { ...REGRADE, cap: Math.min(REGRADE.cap, room) } })
      for (const tl of rw.tiles) { out.pillars.push({ id: `rg${tl}`, kind: 'regrade' }); out.pits.push({ id: `rg${tl}`, cols: [...new Set(rw.fill.filter(f => f.tile === tl).map(f => k2(f.at[0], f.at[2])))].map(q => q.split(',').map(Number)), kind: 'regrade' }) }
      out.pits = out.pits.filter(p => p.kind !== 'regrade' || p.cols.length)
      for (const c of rw.cut) { cuts.push({ at: c.at, name: c.name, pillar: `rg${c.tile}` }); used.add(k2(c.at[0], c.at[2])) }
      for (const f of rw.fill) { fills.push({ at: f.at, pit: `rg${f.tile}`, role: f.role }); used.add(k2(f.at[0], f.at[2])) }
      census.regraded = rw.census.columns
      for (const [k, v] of Object.entries(rw.skipped)) skip(k, v)
    }
  }
  const seenCut = new Set()
  out.cut = cuts.filter(c => { const k = c.at.join(','); if (seenCut.has(k)) return false; seenCut.add(k); return true })
  out.fill = fills
  return out
}

/**
 * THE INSIDE-THE-WALL CLOCK (owner 11-04 "inside the town walls first"; LIVE 11-07: the showcase's inwall record was surveyed 11-05
 * 15:34Z and read "cuts 0/77, fills 0/1331" for 23 h while the bots kept piling scaffold up): when was the inside last surveyed?
 * -> ms | null. Pure. A record of the inwall stage is its own siting; any later stage carries the time on (`inwallAt`).
 */
export const inwallAtOf = (rec, inwallId = 'inwall') => (rec?.stageId === inwallId ? (Number(rec?.sitedAt) || null) : (Number(rec?.inwallAt) || null))
/**
 * BEFORE THE NEXT STAGE, INSIDE AGAIN? -> bool. Pure. The keeper is about to site stage `nextK` (a complete stage's successor): when
 * that is a stage AFTER the inside-the-wall one and the inside was last surveyed `everyMs` ago or more (or never, by this clock),
 * the inside is surveyed first -- a stage with work there is sited there, else the ring order goes on to `nextK`.
 */
export function inwallFirst ({ rec, nextK, inwallK, now = Date.now(), env = process.env, T = ROUGH } = {}) {
  if (!roughOn(env) || !Number.isFinite(nextK) || !Number.isFinite(inwallK) || nextK <= inwallK) return false
  const at = inwallAtOf(rec)
  return !Number.isFinite(at) || now - at >= T.inwallEveryMs
}
/** The stages to try, in order -> [k]: the inside first when inwallFirst says so, then nextK .. last. Pure. */
export const stageTryOrder = (k0, last, first, inwallK) => [...(first ? [inwallK] : []), ...Array.from({ length: Math.max(k0, last) - k0 + 1 }, (_, i) => k0 + i)]
/** The record's inside-the-wall clock after this siting -> ms | null. Pure: the inwall stage's own siting time, else the one carried. */
export const inwallAtNext = (cur, body, inwallId = 'inwall') => (body?.stageId === inwallId ? (Number(body?.sitedAt) || null) : (inwallAtOf(cur, inwallId) ?? (Number(body?.inwallAt) || null)))
/**
 * ROUGHGROUND-1B: MAY THIS CUT BE DUG NOW? -> bool. Pure. A cut over a hollow (`cut.hollow`: the open cells under it the record fills
 * after it) only while no body stands in any of them (`bodyAt(cell)`: skills.mjs otherBodyOnCell) -- opening a tunnel a bot is in is
 * what Codex r1 refused; a cut with no hollow is always clear here (the caller's other checks stand).
 */
export const hollowClear = (cut, bodyAt = () => false) => !(Array.isArray(cut?.hollow) && cut.hollow.some(c => Array.isArray(c) && bodyAt(c)))
