// TOWNTERRACE-01: THE GROUNDSKEEPER'S TERRACE STAGE (owner 11-03, ledger townterrace-1103: "yes, do it, add it to the grounds
// keeper"). PURE: the switch, the town's inside, the building floors, the in-wall trees, the terrace grading (cut, fill, the caves a
// cut opens), the seeded park/garden and the record. Nothing here touches a bot or a file; tidy.mjs siteStage sites it as the land
// plan's stage `terrace` (landplan.mjs landStages: right after stage 0, the plaza) and the groundskeeper works it with tidy-01's
// visit (skills.mjs buildTidy).
//
// WHY (owner 11-03): walking and stuck-cell failures inside town, no room to build (the stock yard found no site on the showcase:
// 0 of 31,684 candidates), a stone sink for the resource model, and a less sterile showcase.
//
// WHAT IT DOES, inside the town wall only (the wall record's ring, else tidy-01's square round home):
//   TREES     every natural tree whose trunk stands on soil inside is felled WHOLE (its connected logs, bottom up), one sapling a
//             tree replanted in the land plan's tree-farm zone first (tidy.mjs replantCells, the road-tree rule; buildrun.mjs B4:
//             never a log before every replant reads planted). Kept and named: a tree the park planted on purpose, a tree with a
//             log in any refusal, a tree a ground stand cannot fell whole (top log more than TERRACE.treeReach above its soil).
//   TERRACES  the open ground grouped into a few terraces AT THE BUILDINGS' FLOORS (a house, the workshop, the storehouse, the wall's
//             gates, the well's surround, the ziggurat's base, the tree farm; plus steps of TERRACE.step through the ground's range
//             when the floors span less of it): each column's 5x5 median ground snapped to the nearest level, small patches merged
//             into a neighbour. The finished ground is 1-LIPSCHITZ: every 4-neighbour step between worked columns, and between a
//             worked column and one it does not touch (a kept column, a build's edge, a road, the wall), is at most 1 -- ramps
//             where two terraces meet. Never one flat plane: the levels are the floors. A column whose earthwork is refused (beyond
//             TERRACE.maxCut / maxFill, a cell that cannot be filled, a record cell, water beside the cut, no feasible height) is
//             KEPT at its own height and the grading is solved again round it.
//   CUT/FILL  the buried fill cells take cobblestone first (tidy.mjs coreFills: the town's surplus, the resource-model sink), the
//             top stays dirt so grass returns; the ramp blend (TERRACE.alphas: ramps cut into the high terrace .. filled onto the
//             low one) is chosen to BALANCE cut against fill. The volumes are on the record (`terrace`). The keeper's bag carries
//             its spoil to the next fill; what is left goes the town's way (the well takes junk).
//   CAVES     a cut that would open a cave or an air pocket under town seals it: the air cells a cut would expose (beside a
//             removed block, under a neighbour's ground) and an air floor under the cut level are `core` cells, placed once the
//             cut that opens them is down (`opener`). A pocket deeper than TERRACE.sealDepth, wet, or beside a column the stage
//             never touches keeps the column uncut.
//   THE PARK  one seeded park/garden a town (the land plan's seed: pool + home, the ziggurat-variety rule; park.mjs), published
//             as a land-plan zone (`land.park`, a reservation other builds keep off). See parkLayout.
// NEVER: wells, the farm (no column within TERRACE.farmGuard of farmland: its water stays), the protected zones (trial chambers),
// the expedition markers, the town plan's cells, boxes and plots, every project's blocks and reservation, the copper hall's reserved
// site, the road corridors (the land plan's and the paths': roads keep their grade). The caller's `avoid` holds all of them
// (skills.mjs tidyInputs); siteTerrace adds the land plan's corridors; the visit re-checks every one at work time (skills.mjs
// buildTidy `terraceGuardNow`).

import { tidyColumn, gradeLim, tidyRecord, replantCells, tidyOverlay, TIDY, TIDY_BLUEPRINT, TIDY_PLOT, TIDY_BUILDERS, REPLANT_AIR, cutWater, fillIntoOk, waterColumn } from './tidy.mjs'
import { isLiquid, replaceableCell } from './townplan.mjs'
import { rng, corridorAt } from './landplan.mjs'
import { haveOf, hasHoe, PARK_USE_ROLES, PARK_PLACE_ROLES, TILL_RE, SOIL_RE, ELEMENT_ITEMS } from './park.mjs'

export const TERRACE_STAGE = 'terrace'
/**
 * THE BOUNDS. maxCut/maxFill: a column's earthwork at most; step: the extra levels' spacing; levelsMax: at most this many levels;
 * minArea: a smaller terrace patch joins its neighbour; alphas: the ramp blends tried, the most balanced wins; treeReach: a tree's
 * top log at most this far above its soil (a ground stand's dig reach: buildsite.mjs DIG_REACH 5 from an eye at 1.62); treeLogsMax
 * / treeRadius: a tree's log component bound; farmGuard: no column within this of farmland; sealDepth: an air floor under a cut at
 * most this deep is filled; iters: re-solves after kept columns; segCols: fill columns a segment; park: the box's side range, the
 * candidate sites the seed picks among, and each element's most cells.
 */
export const TERRACE = Object.freeze({ dy: 14, maxCut: 4, maxFill: 4, step: 3, levelsMax: 6, minArea: 12, alphas: Object.freeze([0.5, 0.25, 0.75, 0, 1]), treeReach: 6, treeLogsMax: 40, treeRadius: 4, farmGuard: 4, sealDepth: 3, iters: 40, walkRounds: 4, segCols: 8,
  park: Object.freeze({ min: 7, max: 11, least: 5, spread: 2, cands: 6, flowersMax: 24, cropsMax: 9, caneMax: 6, meadowMax: 4 }) })

/** THE SWITCH -> bool. TERRACE=off is the stage's own rollback (siteStage reads the stage as having nothing to do; the ring order
 *  goes on). Unset: on wherever the groundskeeper's land plan is (groundskeeper.mjs gkOn, landplan.mjs landOn). Pure. */
export function terraceOn (env = process.env) {
  const v = String(env?.TERRACE ?? '').trim().toLowerCase()
  return !(v === 'off' || v === '0' || v === 'false' || v === 'no')
}

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'
const k2 = (x, z) => `${x},${z}`
const k3 = (x, y, z) => `${x},${y},${z}`
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
const LOG_RE = /_(log|wood)$|^mangrove_roots$/
const LEAVES_RE = /_leaves$/
const wetBlock = b => !!b && (isLiquid(b) || String(b.name ?? '').includes('waterlogged'))
const mod = (a, n) => ((a % n) + n) % n

// ---- the town's inside and its floors -----------------------------------------------------------------------------------------

/** INSIDE THE WALL -> [x0, z0, x1, z1]: the wall record's ring less its line (the body's cells and zones are refused by `avoid`),
 *  else tidy-01's square round home (TIDY.r). Pure. */
export function wallInterior (wallRec, home, r = TIDY.r) {
  const g = wallRec?.ring
  if (Array.isArray(g) && g.length === 4 && g.every(Number.isFinite) && g[2] - g[0] >= 4 && g[3] - g[1] >= 4) return [g[0] + 1, g[1] + 1, g[2] - 1, g[3] - 1]
  return home ? [home.x - r, home.z - r, home.x + r, home.z + r] : null
}

/**
 * THE BUILDINGS' FLOORS -> [{ y, why }] (the ground each build stands on; its door is one step up). Pure over `read`. Every record
 * with a `floor` (a house, the workshop, the storehouse; never a chest inside a build), else its `baseY` (the ziggurat), else its
 * `level` (the tree farm); the wall's gate columns (their ground, read: the median); each well's surround (the ground's median at
 * Chebyshev 3 round its cap, outside its footprint).
 */
export function buildingFloors ({ records = [], wall = null, caps = [], read = null, home = null, T = TERRACE } = {}) {
  const out = []
  const add = (y, why) => { if (Number.isFinite(Number(y))) out.push({ y: Math.round(Number(y)), why }) }
  const col = (x, z) => tidyColumn(read, x, z, { yHi: home.y + T.dy, yLo: home.y - T.dy }).y
  const med = ys => { const s = ys.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
  for (const r of records) {
    if (!r || r.plot === TIDY_PLOT || r.plot === 'land' || /chest/.test(String(r.plot ?? r.blueprint ?? ''))) continue
    if (Number.isFinite(r.floor)) add(r.floor, `${r.plot ?? r.blueprint}:floor`)
    else if (Number.isFinite(r.baseY)) add(r.baseY, `${r.plot ?? r.blueprint}:base`)
    else if (Number.isFinite(r.level)) add(r.level, `${r.plot ?? r.blueprint}:level`)
  }
  if (read && home) {
    for (const g of wall?.gates ?? []) add(med((g.cols ?? []).map(([x, z]) => col(x, z))), 'wall:gate')
    for (const c of caps) {
      if (!Array.isArray(c)) continue
      const ys = []
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === 3) ys.push(col(c[0] + dx, c[2] + dz))
      add(med(ys), 'well:surround')
    }
  }
  return out
}

/**
 * THE TERRACE LEVELS -> sorted ints. Pure. The floors (unique), then -- when the ground's range (lo..hi) reaches past them -- a level
 * every T.step below the lowest and above the highest, nearest first, at most T.levelsMax in all (every floor is kept). A floor-less
 * town gets levels every T.step from its ground's middle.
 */
export function terraceLevels (floors = [], lo = null, hi = null, T = TERRACE) {
  const fs = [...new Set(floors.map(f => (typeof f === 'number' ? f : f?.y)).filter(Number.isFinite))].sort((a, b) => a - b)
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return fs
  const out = new Set(fs.length ? fs : [Math.round((lo + hi) / 2)])
  const mn = Math.min(...out), mx = Math.max(...out)
  const extra = []
  for (let y = mn - T.step; y >= lo - 1; y -= T.step) extra.push(y)
  for (let y = mx + T.step; y <= hi + 1; y += T.step) extra.push(y)
  extra.sort((a, b) => Math.min(Math.abs(a - mn), Math.abs(a - mx)) - Math.min(Math.abs(b - mn), Math.abs(b - mx)) || a - b)
  for (const y of extra) { if (out.size >= T.levelsMax) break; out.add(y) }
  return [...out].sort((a, b) => a - b)
}
/** The level nearest y (ties: the lower). Pure. */
export const nearestLevel = (levels, y) => levels.reduce((b, l) => (Math.abs(l - y) < Math.abs(b - y) || (Math.abs(l - y) === Math.abs(b - y) && l < b) ? l : b), levels[0])

/**
 * THE FARM'S GUARD -> (x, z) -> bool: within T.farmGuard of a farmland block read in `box` + farmGuard (the farm's water and its
 * soil stay as they are). The park's own tilled plots (inside `except`, the park's box) are not a farm. Pure over `read`; the siting
 * and the visit (skills.mjs terraceGuardNow) both read it.
 */
export function farmGuardOf (read, box, home, { except = null, T = TERRACE } = {}) {
  const farmK = new Set()
  for (let x = box[0] - T.farmGuard; x <= box[2] + T.farmGuard; x++) for (let z = box[1] - T.farmGuard; z <= box[3] + T.farmGuard; z++) {
    if (inBoxP(except, x, z)) continue
    for (let y = home.y - T.dy; y <= home.y + T.dy; y++) { const b = read(x, y, z); if (b && nm(b) === 'farmland') { farmK.add(k2(x, z)); break } }
  }
  return (x, z) => { if (!farmK.size) return false; for (let dx = -T.farmGuard; dx <= T.farmGuard; dx++) for (let dz = -T.farmGuard; dz <= T.farmGuard; dz++) if (farmK.has(k2(x + dx, z + dz))) return true; return false }
}

// ---- the in-wall trees --------------------------------------------------------------------------------------------------------

/**
 * THE TREES INSIDE -> { trees: [{ base: [x, y, z], col: [x, z], name, logs: [{ at, name }] (bottom up), top }], skipped }. Pure over
 * `read`. A tree is a log standing on soil whose column is inside `box`; its logs the 26-connected log component (within
 * T.treeRadius of its base, none below it, at most T.treeLogsMax). Kept (counted in `skipped`): `keep(x, z)` (the park's own
 * trees), a log in a column `avoid` refuses, a top log beyond T.treeReach above the soil, a component too big.
 */
export function inWallTrees (read, box, { home, avoid = () => null, keep = () => false, T = TERRACE } = {}) {
  const skipped = {}
  const skip = why => { skipped[why] = (skipped[why] ?? 0) + 1 }
  const trees = [], taken = new Set()
  if (!box || !home) return { trees, skipped }
  const yHi = home.y + T.dy, yLo = home.y - T.dy
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    let base = null
    for (let y = yLo + 1; y <= yHi; y++) {
      const b = read(x, y, z)
      if (!b) break
      if (LOG_RE.test(nm(b)) && !taken.has(k3(x, y, z))) { const s = read(x, y - 1, z); if (s && SOIL_RE.test(nm(s))) { base = [x, y, z]; break } }
    }
    if (!base) continue
    const logs = [], seen = new Set([k3(...base)]), q = [base]
    let big = false
    for (let i = 0; i < q.length; i++) {
      const [cx, cy, cz] = q[i]
      logs.push({ at: q[i], name: nm(read(cx, cy, cz)) })
      if (logs.length > T.treeLogsMax) { big = true; break }
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dy && !dz) continue
        const nx = cx + dx, ny = cy + dy, nz = cz + dz, k = k3(nx, ny, nz)
        if (seen.has(k) || ny < base[1] || Math.abs(nx - base[0]) > T.treeRadius || Math.abs(nz - base[2]) > T.treeRadius) continue
        const b = read(nx, ny, nz)
        if (b && LOG_RE.test(nm(b))) { seen.add(k); q.push([nx, ny, nz]) }
      }
    }
    for (const l of logs) taken.add(k3(...l.at))
    if (big) { skip('tree_big'); continue }
    if (keep(x, z)) { skip('tree_park'); continue }
    if (logs.some(l => avoid(l.at[0], l.at[2]))) { skip('tree_guarded'); continue }
    const top = Math.max(...logs.map(l => l.at[1]))
    if (top - (base[1] - 1) > T.treeReach) { skip('tree_tall'); continue }
    trees.push({ base, col: [x, z], name: logs[0].name, logs: logs.sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2]), top })
  }
  return { trees, skipped }
}

// ---- the 1-Lipschitz grading ----------------------------------------------------------------------------------------------------

/**
 * Dial's relaxation over a graph -> a new Map. dir +1: the smallest 1-Lipschitz majorant of `v`; dir -1: the largest minorant.
 * `v` key -> int | +-Infinity (no constraint there). Pure. Exported for the tests.
 */
export function lip (keys, v, nb, dir) {
  const out = new Map(v)
  const buckets = new Map()
  for (const k of keys) { const val = out.get(k); if (Number.isFinite(val)) { if (!buckets.has(val)) buckets.set(val, []); buckets.get(val).push(k) } }
  const vals = [...buckets.keys()].sort((a, b) => (dir > 0 ? b - a : a - b))
  for (let i = 0; i < vals.length; i++) {
    const val = vals[i], list = buckets.get(val)
    for (let j = 0; j < list.length; j++) {
      const k = list[j]
      if (out.get(k) !== val) continue
      const nv = val - dir
      for (const n of nb(k)) {
        const cur = out.get(n)
        if (dir > 0 ? cur >= nv : cur <= nv) continue
        out.set(n, nv)
        if (!buckets.has(nv)) {
          buckets.set(nv, [])
          let p = i + 1
          while (p < vals.length && (dir > 0 ? vals[p] > nv : vals[p] < nv)) p++
          vals.splice(p, 0, nv)
        }
        buckets.get(nv).push(n)
      }
    }
  }
  return out
}

/**
 * THE GRADING -> { H (Map "x,z" -> finished ground, every free column), g (its own ground), kept, worked, cut: [{ at, name }],
 * fill: [{ at }], seal: [{ at, opener }], clearLeaves, levels, alpha, skipped, free }. Pure over `read`.
 *   box          inside the wall;  avoid(x, z) every refusal: never touched, its height binds its neighbours
 *   cells        Set "x,y,z" of every record cell (never cut, filled or sealed)
 *   levels       terraceLevels;  felled Set "x,y,z" of the logs this stage fells (read as air)
 *   farm(x, z)   within T.farmGuard of farmland (never touched)
 */
export function gradeTerraces (read, box, { home, avoid = () => null, cells = new Set(), levels = [], felled = new Set(), farm = () => false, alpha = 0.5, keep = null, water = 'strict', T = TERRACE } = {}) {
  const skipped = {}
  const skip = why => { skipped[why] = (skipped[why] ?? 0) + 1 }
  const yHi = home.y + T.dy, yLo = home.y - T.dy
  const rd = (x, y, z) => (felled.has(k3(x, y, z)) ? { name: 'air', boundingBox: 'empty' } : read(x, y, z))
  const memo = new Map()
  const col = (x, z) => { const k = k2(x, z); if (!memo.has(k)) memo.set(k, tidyColumn(rd, x, z, { yHi, yLo })); return memo.get(k) }
  const ground = c => !!c && !c.why && c.y != null
  const lim = gradeLim(read, Math.max(T.maxCut, T.maxFill), water, { waterOk: (x, z) => !avoid(x, z) && !farm(x, z) })
  const wet = (x, y, z) => { for (const [dx, dz] of N8) for (let dy = -1; dy <= 1; dy++) if (wetBlock(read(x + dx, y + dy, z + dz))) return true; return wetBlock(read(x, y + 1, z)) }
  // the owner's 11-01 water rule (tidy.mjs cutWater): a cut beside water dams it first; a dam or a fill into water only where the
  // stage may touch the column (never a refusal, never the farm's irrigation, never a record cell)
  const mayDam = (x, y, z) => !avoid(x, z) && !farm(x, z) && !cells.has(k3(x, y, z))
  const free = new Set(), g = new Map()
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    const c = col(x, z)
    if (!ground(c)) { skip(`col_${c?.why ?? 'none'}`); continue }
    if (avoid(x, z)) { skip('col_guarded'); continue }
    if (farm(x, z)) { skip('col_farm'); continue }
    free.add(k2(x, z)); g.set(k2(x, z), c.y)
  }
  // THE WATER'S EDGE (11-01 rule): an open-water column 4-beside free ground (a pond's or a stream's edge ring, at most maxFill deep)
  // is free too, its ground its bed: graded, it is an EMBANKMENT -- the terrace's edge filled into the water
  const edgeK = new Set()
  if (water !== 'strict') {
    const edge = []
    for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
      const c = col(x, z)
      if (c?.why !== 'water' || avoid(x, z) || farm(x, z)) continue
      if (!N4.some(([dx, dz]) => free.has(k2(x + dx, z + dz)))) continue
      const wc = waterColumn(rd, x, z, { yHi, yLo, depth: T.maxFill })
      if (wc) edge.push([x, z, wc.bed])
    }
    for (const [x, z, bed] of edge) { edgeK.add(k2(x, z)); free.add(k2(x, z)); g.set(k2(x, z), bed); memo.set(k2(x, z), { y: bed, name: 'water_bed', why: null, tree: false }); skip('col_water_edge') }
  }
  const nbIn = set => k => { const [x, z] = k.split(',').map(Number); const out = []; for (const [dx, dz] of N4) { const n = k2(x + dx, z + dz); if (set.has(n)) out.push(n) } return out }
  const nbFree = nbIn(free)
  // THE TARGET: the 5x5 median ground snapped to the nearest level; a patch smaller than T.minArea joins its neighbour
  const T0 = new Map()
  for (const k of free) {
    const [x, z] = k.split(',').map(Number)
    const ys = []
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { const n = k2(x + dx, z + dz); if (g.has(n)) ys.push(g.get(n)) }
    ys.sort((a, b) => a - b)
    T0.set(k, levels.length ? nearestLevel(levels, ys[Math.floor(ys.length / 2)]) : g.get(k))
  }
  for (let pass = 0; pass < 2; pass++) {
    const seen = new Set()
    for (const k0 of [...free].sort()) {
      if (seen.has(k0)) continue
      const lv = T0.get(k0), comp = [k0], border = new Map()
      seen.add(k0)
      for (let i = 0; i < comp.length; i++) for (const n of nbFree(comp[i])) {
        if (T0.get(n) === lv) { if (!seen.has(n)) { seen.add(n); comp.push(n) } } else border.set(T0.get(n), (border.get(T0.get(n)) ?? 0) + 1)
      }
      if (comp.length >= T.minArea || !border.size) continue
      const to = [...border].sort((a, b) => b[1] - a[1] || Math.abs(a[0] - lv) - Math.abs(b[0] - lv) || a[0] - b[0])[0][0]
      for (const k of comp) T0.set(k, to)
    }
  }
  // `keep`: columns the caller keeps (the walk guard's: a column a grading turned stuck-prone)
  const kept = new Set([...(keep ?? [])].filter(k => free.has(k)))
  if (kept.size) skipped.walk_kept = kept.size
  let H = new Map(), work = new Map(), seals = [], dams = []
  for (let it = 0; it < T.iters; it++) {
    const keys = [...free].filter(k => !kept.has(k))
    const ks = new Set(keys), nb = nbIn(ks)
    // THE ANCHORS: every read ground column beside a worked one that is not worked (kept, refused, outside) binds it -- within 1,
    // or within today's step when that is already more (never a step made WORSE against a column the stage does not touch: a
    // quarried town's cliffs stay what they are, the grading works round them instead of keeping everything behind them)
    const loI = new Map(), hiI = new Map()
    for (const k of keys) {
      const [x, z] = k.split(',').map(Number)
      let lo = -Infinity, hi = Infinity
      for (const [dx, dz] of N4) {
        const nx = x + dx, nz = z + dz
        if (ks.has(k2(nx, nz))) continue
        const c = col(nx, nz)
        if (!ground(c)) continue
        const sl = Math.max(1, Math.abs(g.get(k) - c.y))
        lo = Math.max(lo, c.y - sl); hi = Math.min(hi, c.y + sl)
      }
      loI.set(k, lo); hiI.set(k, hi)
    }
    const lo = lip(keys, loI, nb, +1), hi = lip(keys, hiI, nb, -1)
    const t = new Map(keys.map(k => [k, T0.get(k)]))
    const up = lip(keys, t, nb, +1), dn = lip(keys, t, nb, -1)
    H = new Map()
    let newly = 0
    for (const k of keys) {
      if (lo.get(k) > hi.get(k)) { kept.add(k); skip('infeasible'); newly++; continue }
      const f = Math.floor(dn.get(k) + alpha * (up.get(k) - dn.get(k)))
      H.set(k, Math.max(lo.get(k), Math.min(hi.get(k), f)))
    }
    if (newly) continue
    work = new Map()
    for (const k of keys) {
      const [x, z] = k.split(',').map(Number)
      const r = columnWork(rd, x, z, g.get(k), H.get(k), { cells, lim, wet, water, mayDam, edge: edgeK.has(k), T })
      if (r.why) { kept.add(k); skip(r.why); newly++; continue }
      work.set(k, r)
    }
    if (newly) continue
    // CAVES: an air cell a cut exposes beside it, under the neighbour's own ground and its finished one, is sealed (`opener`: the
    // cut cell that opens it); one the stage may not touch, or wet, keeps the cut column (and the grading is solved again)
    const finalTop = (x, z) => { const k = k2(x, z); if (work.has(k)) return H.get(k); const c = col(x, z); return ground(c) ? c.y : null }
    seals = []
    const sealK = new Set()
    for (const [k, w] of work) {
      if (!w.cut.length && !w.floor.length) continue
      const [x, z] = k.split(',').map(Number)
      const add = []
      let why = null
      for (const c of w.cut) {
        const y = c.at[1]
        for (const [dx, dz] of N4) {
          const nx = x + dx, nz = z + dz
          const top = finalTop(nx, nz)
          if (top == null || top < y) continue
          const gn = col(nx, nz).y
          if (gn == null || y > gn) continue
          const b = read(nx, y, nz)
          if (!b) { why = 'seal_unread'; break }
          if (wetBlock(b)) { why = 'seal_wet'; break }
          if (!(AIRN(nm(b)) || replaceableCell(b))) continue
          if (!free.has(k2(nx, nz)) || cells.has(k3(nx, y, nz))) { why = 'seal_guarded'; break }
          add.push({ at: [nx, y, nz], opener: c.at })
        }
        if (why) break
      }
      if (why) { kept.add(k); skip(why); newly++; continue }
      for (const s of [...add, ...w.floor]) { const sk = s.at.join(','); if (!sealK.has(sk)) { sealK.add(sk); seals.push(s) } }
    }
    if (newly) continue
    // the dams the cuts need (a dam in a column this grading cuts at that height is no dam: a cut there removes it -- that column's own
    // cut then dams its own water), and never a dam on another cut or fill cell of the grading
    dams = []
    const damK = new Set(), workK = new Set()
    for (const w of work.values()) for (const c of [...w.cut, ...w.fill]) workK.add(c.at.join(','))
    for (const w of work.values()) for (const d of w.dams) { const dk = d.join(','); if (!damK.has(dk) && !workK.has(dk)) { damK.add(dk); dams.push({ at: d }) } }
    // a worked column stepping more than 1 to a neighbour -- worse than today's step there -- is kept and the grading solved again
    for (const k of work.keys()) {
      const [x, z] = k.split(',').map(Number)
      for (const [dx, dz] of N4) {
        const n = k2(x + dx, z + dz), f = work.has(n) ? H.get(n) : col(x + dx, z + dz).y
        if (f == null || !ground(col(x + dx, z + dz))) continue
        const d1 = Math.abs(H.get(k) - f)
        if (d1 > 1 && d1 > Math.abs(g.get(k) - col(x + dx, z + dz).y)) { kept.add(k); skip('step_worse'); newly++; break }
      }
    }
    if (!newly) break
  }
  // THE CHECK: no worked column steps more than 1 to a neighbour (worked or not) -- unless that step was already more than 1 and is
  // no larger now; a column breaking it (an unconverged solve) is kept, with its earthwork and seals dropped
  const fin = (x, z) => { const k = k2(x, z); if (work.has(k)) return H.get(k); const c = col(x, z); return ground(c) ? c.y : null }
  for (let round = 0; round < 400; round++) {
    const bad = []
    for (const k of work.keys()) {
      const [x, z] = k.split(',').map(Number)
      for (const [dx, dz] of N4) {
        const f = fin(x + dx, z + dz)
        if (f == null) continue
        const g1 = col(x + dx, z + dz).y
        if (Math.abs(H.get(k) - f) > 1 && Math.abs(H.get(k) - f) > Math.abs(g.get(k) - g1)) { bad.push(k); break }
      }
    }
    if (!bad.length) break
    for (const k of bad) { work.delete(k); kept.add(k); skip('unconverged') }
  }
  const fillK = new Set()
  const cut = [], fill = [], clearLeaves = []
  for (const [, w] of [...work].sort()) { cut.push(...w.cut); for (const f of w.fill) { fillK.add(f.at.join(',')); fill.push(f) } clearLeaves.push(...w.leaves) }
  // a seal whose column or opener column was kept by the check is dropped; a cell that is also a fill stays the fill
  const seal = seals.filter(s => work.has(k2(s.opener[0], s.opener[2])) && !fillK.has(s.at.join(',')))
  // a dam whose cut column was kept by the check is dropped with it
  const cutCols = new Set(cut.map(c => k2(c.at[0], c.at[2])))
  const dam = dams.filter(d => N4.some(([dx, dz]) => cutCols.has(k2(d.at[0] + dx, d.at[2] + dz))) && !fillK.has(d.at.join(',')))
  const finalH = new Map()
  for (const k of free) finalH.set(k, work.has(k) ? H.get(k) : g.get(k))
  return { H: finalH, g, kept, worked: new Set(work.keys()), cut, fill, seal, dam, clearLeaves, levels, alpha, skipped, free }
}

/** ONE COLUMN'S EARTHWORK from its ground g0 to h -> { cut, fill, floor, leaves, why }. Pure. `rd` reads the felled logs as air. */
function columnWork (rd, x, z, g0, h, { cells, lim, wet, water = 'strict', mayDam = () => false, edge = false, T }) {
  const out = { cut: [], fill: [], floor: [], leaves: [], dams: [], why: null }
  if (h === g0) return out
  if (h > g0) {
    if (h - g0 > T.maxFill) { out.why = 'fill_deep'; return out }
    for (let y = g0 + 1; y <= h; y++) {
      const b = rd(x, y, z), n = nm(b)
      if (!b) { out.why = 'fill_unread'; return out }
      if (cells.has(k3(x, y, z))) { out.why = 'fill_guarded'; return out }
      // the 11-01 rule: a fill may go into water (an embankment), never into lava or a waterlogged block
      if (wetBlock(b) && !(water !== 'strict' && fillIntoOk(b, water) && mayDam(x, y, z))) { out.why = 'fill_wet'; return out }
      if (LEAVES_RE.test(n)) out.leaves.push({ at: [x, y, z], kind: 'leaves', name: n })
      else if (!(AIRN(n) || replaceableCell(b) || (water !== 'strict' && fillIntoOk(b, water) && mayDam(x, y, z)))) { out.why = 'fill_blocked'; return out }   // (Codex water r1 BLOCKER 3)
      out.fill.push({ at: [x, y, z] })
    }
    // the head room over the new ground: leaves there are cleared (the terrace is walked)
    for (let y = h + 1; y <= h + 2; y++) { const b = rd(x, y, z), n = nm(b); if (b && LEAVES_RE.test(n) && !cells.has(k3(x, y, z))) out.leaves.push({ at: [x, y, z], kind: 'leaves', name: n }) }
    return out
  }
  if (g0 - h > T.maxCut) { out.why = 'cut_deep'; return out }
  // a pond's edge column (its ground the BED, the water over it) is filled, never cut: a cut there drains the pond into the terrace
  // (Claude water r1 BLOCKER)
  if (edge) { out.why = 'cut_under_water'; return out }
  for (let y = g0; y > h; y--) {
    const b = rd(x, y, z), n = nm(b)
    if (!b) { out.why = 'cut_unread'; return out }
    if (cells.has(k3(x, y, z))) { out.why = 'cut_guarded'; return out }
    if (AIRN(n) || replaceableCell(b)) continue                  // an air pocket inside the cut: nothing to dig there
    if (!lim.cut.test(n)) { out.why = 'cut_blocked'; return out }
    if (water === 'strict') { if (wet(x, y, z)) { out.why = 'cut_wet'; return out } } else {
      // the 11-01 rule: the water beside the cell is dammed first (the visit digs the cut only once no water is beside it)
      const cw = cutWater(rd, x, y, z, { water, mayDam })
      if (!cw.ok) { out.why = cw.why; return out }
      out.dams.push(...cw.dams)
    }
    out.cut.push({ at: [x, y, z], name: n })
  }
  // the floor at h must be ground: an air floor (a cave under the cut level) is filled up from the first solid below
  const fb = rd(x, h, z)
  if (!fb) { out.why = 'cut_unread'; return out }
  if (AIRN(nm(fb)) || replaceableCell(fb)) {
    const add = []
    const opener = out.cut.length ? out.cut[out.cut.length - 1].at : [x, h + 1, z]
    let y = h
    for (; y >= h - T.sealDepth; y--) {
      const b = rd(x, y, z)
      if (!b) { out.why = 'seal_unread'; return out }
      if (wetBlock(b)) { out.why = 'seal_wet'; return out }
      if (!(AIRN(nm(b)) || replaceableCell(b))) break
      if (cells.has(k3(x, y, z))) { out.why = 'seal_guarded'; return out }
      add.push({ at: [x, y, z], opener })
    }
    if (y < h - T.sealDepth) { out.why = 'seal_deep'; return out }
    out.floor = add.reverse()
  }
  return out
}

// ---- walking, before and after -------------------------------------------------------------------------------------------------

/**
 * THE WALK INSIDE -> { cols, reach, back, traps, rough, pairs, steep }. Pure over `read`. Ground columns inside `box` (tidyColumn);
 * a step to a 4-neighbour goes up at most 1 or down at most 3 with two cells of head room over both tops, never into a liquid
 * (landplan.mjs walkReach's rule). reach: columns reached from `from`; back: those that can walk back to `from`; traps = reach -
 * back: the STUCK-PRONE columns (a bot that drops in cannot walk out); rough: 4-adjacent ground pairs differing by 2+ of `pairs`.
 * `solid` (Set "x,y,z") reads extra cells as solid (the park's hedges, bamboo, shrubs: the offline proof's after-ground).
 */
export function terraceWalk (read, box, home, from, { dy = 16, solid = null } = {}) {
  const rd = solid?.size ? (x, y, z) => (solid.has(k3(x, y, z)) ? { name: 'cobblestone', boundingBox: 'block' } : read(x, y, z)) : read
  const memo = new Map()
  const col = (x, z) => { const k = k2(x, z); if (!memo.has(k)) memo.set(k, tidyColumn(rd, x, z, { yHi: home.y + dy, yLo: home.y - dy })); return memo.get(k) }
  const inBox = (x, z) => x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3]
  const ok = c => !!c && !c.why && c.y != null
  const clear = (x, y, z) => { const b = rd(x, y, z); return !!b && b.boundingBox === 'empty' && !/water|lava/.test(String(b.name)) }
  const step = (x, z, nx, nz) => {
    const c = col(x, z), n = col(nx, nz)
    if (!ok(c) || !ok(n)) return false
    const up = n.y - c.y
    if (up > 1 || up < -3) return false
    const hi = Math.max(n.y, c.y)
    return clear(x, hi + 1, z) && clear(x, hi + 2, z) && clear(nx, n.y + 1, nz) && clear(nx, n.y + 2, nz)
  }
  const bfs = (starts, fwd) => {
    const seen = new Set(), q = []
    for (const [x, z] of starts) if (inBox(x, z) && ok(col(x, z)) && !seen.has(k2(x, z))) { seen.add(k2(x, z)); q.push([x, z]) }
    for (let i = 0; i < q.length; i++) {
      const [x, z] = q[i]
      for (const [dx, dz] of N4) {
        const nx = x + dx, nz = z + dz, k = k2(nx, nz)
        if (seen.has(k) || !inBox(nx, nz)) continue
        if (!(fwd ? step(x, z, nx, nz) : step(nx, nz, x, z))) continue
        seen.add(k); q.push([nx, nz])
      }
    }
    return seen
  }
  const fr = (from ?? []).filter(([x, z]) => inBox(x, z))
  const start = fr.length ? fr : [[home.x, home.z]]
  const R = bfs(start, true), C = bfs(start, false)
  let cols = 0, rough = 0, pairs = 0, steep = 0
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    const c = col(x, z)
    if (!ok(c)) continue
    cols++
    for (const [dx, dz] of [[1, 0], [0, 1]]) { if (!inBox(x + dx, z + dz)) continue; const n = col(x + dx, z + dz); if (!ok(n)) continue; pairs++; if (Math.abs(n.y - c.y) >= 2) rough++; if (Math.abs(n.y - c.y) >= 4) steep++ }
  }
  let back = 0
  const trapSet = new Set()
  for (const k of R) { if (C.has(k)) back++; else trapSet.add(k) }
  return { cols, reach: R.size, back, traps: R.size - back, rough, pairs, steep, trapSet }
}

// ---- the park ------------------------------------------------------------------------------------------------------------------

/**
 * THE PARK'S SITE -> { box: [x0, z0, x1, z1], score } | null. Pure. A box of seeded sides in T.park.min..max over graded open columns
 * (every column free and not kept, its finished ground within 1 of the box's median), none within 1 of a road or path column
 * (`near`); the flattest nearest home first, the seed picking one of the best T.park.cands distinct sites.
 */
export function parkSite (H, kept, box, { seed = 0, home, near = () => false, T = TERRACE } = {}) {
  const r = rng((seed ^ 0x9e3779b9) >>> 0)
  const w = T.park.min + Math.floor(r() * (T.park.max - T.park.min + 1)), d = T.park.min + Math.floor(r() * (T.park.max - T.park.min + 1))
  const pick = r()
  for (const [sw, sd] of [[w, d], [d, w], [T.park.min, T.park.min], [T.park.least, T.park.least]]) {
    const cands = []
    for (let x0 = box[0] + 1; x0 + sw - 1 <= box[2] - 1; x0++) for (let z0 = box[1] + 1; z0 + sd - 1 <= box[3] - 1; z0++) {
      let ok = true
      const ys = []
      for (let x = x0; x < x0 + sw && ok; x++) for (let z = z0; z < z0 + sd; z++) {
        const k = k2(x, z)
        if (!H.has(k) || near(x, z)) { ok = false; break }
        ys.push(H.get(k))
      }
      if (!ok) continue
      ys.sort((a, b) => a - b)
      const med = ys[Math.floor(ys.length / 2)]
      if (ys[ys.length - 1] - ys[0] > T.park.spread) continue
      const dist = Math.max(Math.abs(x0 + sw / 2 - home.x), Math.abs(z0 + sd / 2 - home.z))
      cands.push({ box: [x0, z0, x0 + sw - 1, z0 + sd - 1], score: (ys[ys.length - 1] - ys[0]) * 100 + dist })
    }
    if (!cands.length) continue
    cands.sort((a, b) => a.score - b.score || a.box[0] - b.box[0] || a.box[1] - b.box[1])
    const best = []
    for (const c of cands) {
      if (best.length >= T.park.cands) break
      if (best.some(p => !(c.box[2] < p.box[0] || c.box[0] > p.box[2] || c.box[3] < p.box[1] || c.box[1] > p.box[3]))) continue
      best.push(c)
    }
    return best[Math.floor(pick * best.length) % best.length]
  }
  return null
}

/**
 * THE PARK'S LAYOUT -> { box, cross, cells: [{ at, role, el }], trees: [[x, y, z]], kinds, entrances, skipped, placed }. Pure over
 * `read` (the ground as the grading leaves it). Seeded: the same town always lays the same park, two towns differ.
 *   top(x, z) finished ground; orig(x, z) its own; soilTop(x, z) the finished top is soil (a fill's top is dirt)
 *   have      { item: n } the town's stock + the keeper's bag: an element nobody holds is SKIPPED and named, never planted
 *   water(x, y, z), near(x, z) (a road or path column: no hedge beside one -- never across a path)
 * Layout: a 1-wide cross path (left open) and four quadrants, each one element in a seeded order (flowers first when there are
 * any): a flower bed (rotated kinds), tall flowers (every other column, two cells of room), azalea (every second column), one tree
 * (a sapling at the quadrant's middle with REPLANT_AIR room: the park's own, never felled), a 3x3 bamboo grove, crop plots (a till
 * cell on its own grass or dirt and a crop on it; a hoe needed). A quadrant left over is the MEADOW (bone meal on its natural grass;
 * else the meadow takes any quadrant's). Sugar cane on the box's soil beside water. Lily pads: skipped (placing on water is not an
 * action the visit has). The HEDGE: leaf blocks on the box's edge only, an entrance on every side (seeded) and at the cross path's
 * ends, never beside a road or path column.
 */
export function parkLayout (read, pbox, { seed = 0, top, orig, soilTop, have = {}, water = () => false, near = () => false, T = TERRACE } = {}) {
  const r = rng((seed ^ 0x85ebca6b) >>> 0)
  const skipped = {}, placed = {}, cells = [], trees = []
  const [x0, z0, x1, z1] = pbox
  const used = new Set(), path = new Set()
  const air = (x, y, z) => { const b = read(x, y, z); return !!b && (AIRN(nm(b)) || replaceableCell(b)) }
  const put = (x, z, role, el) => {
    if (used.has(k2(x, z)) || path.has(k2(x, z))) return false
    used.add(k2(x, z))
    cells.push({ at: [x, top(x, z) + 1, z], role, el })
    placed[el] = (placed[el] ?? 0) + 1
    return true
  }
  const cx = Math.floor((x0 + x1) / 2) + Math.floor(r() * 3) - 1, cz = Math.floor((z0 + z1) / 2) + Math.floor(r() * 3) - 1
  for (let x = x0; x <= x1; x++) path.add(k2(x, cz))
  for (let z = z0; z <= z1; z++) path.add(k2(cx, z))
  const quads = [[x0 + 1, z0 + 1, cx - 1, cz - 1], [cx + 1, z0 + 1, x1 - 1, cz - 1], [x0 + 1, cz + 1, cx - 1, z1 - 1], [cx + 1, cz + 1, x1 - 1, z1 - 1]].filter(q => q[2] >= q[0] && q[3] >= q[1])
  const want = ['flowers', 'tall_flowers', 'azalea', 'trees', 'bamboo', 'crops']
  const avail = []
  for (const el of want) {
    if (haveOf(have, el) < 1) { skipped[el] = `no_${{ trees: 'sapling', crops: 'seeds', tall_flowers: 'tall_flowers' }[el] ?? el}`; continue }
    if (el === 'crops' && !hasHoe(have)) { skipped[el] = 'no_hoe'; continue }
    avail.push(el)
  }
  const order = avail.slice()
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  if (order.includes('flowers')) { order.splice(order.indexOf('flowers'), 1); order.unshift('flowers') }
  for (const el of order.slice(quads.length)) skipped[el] = 'no_quadrant'
  const kinds = {}
  const soilOk = (x, z) => soilTop(x, z) && air(x, top(x, z) + 1, z)
  quads.forEach((q, qi) => {
    const el = order[qi]
    if (!el) { kinds[`q${qi}`] = 'meadow'; return }
    kinds[`q${qi}`] = el
    const qc = []
    for (let x = q[0]; x <= q[2]; x++) for (let z = q[1]; z <= q[3]; z++) qc.push([x, z])
    const cap = haveOf(have, el)
    let n = 0
    if (el === 'flowers') {
      for (const [x, z] of qc) { if (n >= Math.min(T.park.flowersMax, cap)) break; if (soilOk(x, z) && put(x, z, `flower${(x * 3 + z * 7 + qi) & 3}`, el)) n++ }
    } else if (el === 'tall_flowers') {
      for (const [x, z] of qc) { if (n >= cap) break; if (mod(x + z, 2) || !soilOk(x, z) || !air(x, top(x, z) + 2, z)) continue; if (put(x, z, `tall${mod(x, 2)}`, el)) n++ }
    } else if (el === 'azalea') {
      for (const [x, z] of qc) { if (n >= cap) break; if (mod(x, 2) || mod(z, 2) || !soilOk(x, z)) continue; if (put(x, z, 'shrub', el)) n++ }
    } else if (el === 'trees') {
      const mx = Math.round((q[0] + q[2]) / 2), mz = Math.round((q[1] + q[3]) / 2)
      for (const [x, z] of qc.slice().sort((a, b) => Math.abs(a[0] - mx) + Math.abs(a[1] - mz) - Math.abs(b[0] - mx) - Math.abs(b[1] - mz) || a[0] - b[0] || a[1] - b[1])) {
        if (!soilOk(x, z)) continue
        let room = true
        for (let y = top(x, z) + 1; y <= top(x, z) + REPLANT_AIR; y++) if (!air(x, y, z)) { room = false; break }
        if (!room) continue
        if (put(x, z, `sapling${mod(x + z, 3)}`, el)) { trees.push([x, top(x, z) + 1, z]); n++ }
        break
      }
    } else if (el === 'bamboo') {
      const mx = Math.round((q[0] + q[2]) / 2), mz = Math.round((q[1] + q[3]) / 2)
      for (let x = mx - 1; x <= mx + 1; x++) for (let z = mz - 1; z <= mz + 1; z++) { if (n >= cap || x < q[0] || x > q[2] || z < q[1] || z > q[3]) continue; if (soilOk(x, z) && put(x, z, 'bamboo', el)) n++ }
    } else if (el === 'crops') {
      for (const [x, z] of qc) {
        if (n >= Math.min(T.park.cropsMax, cap)) break
        const t = top(x, z)
        if (used.has(k2(x, z)) || path.has(k2(x, z)) || t !== orig(x, z) || !TILL_RE.test(nm(read(x, t, z))) || !air(x, t + 1, z)) continue
        used.add(k2(x, z))
        cells.push({ at: [x, t, z], role: 'till', el }, { at: [x, t + 1, z], role: `crop${(x + z) & 3}`, el })
        placed[el] = (placed[el] ?? 0) + 1
        n++
      }
    }
    if (!n) skipped[el] = 'no_room'
  })
  // THE MEADOW: bone meal (the composter's: mushrooms -> bone meal) on the park's natural grass
  if (haveOf(have, 'meadow') < 1) skipped.meadow = 'no_bone_meal'
  else {
    let n = 0
    const mq = quads.filter((q, qi) => kinds[`q${qi}`] === 'meadow')
    for (const q of (mq.length ? mq : quads)) for (let x = q[0]; x <= q[2]; x += 2) for (let z = q[1]; z <= q[3]; z += 2) {
      if (n >= Math.min(T.park.meadowMax, haveOf(have, 'meadow'))) break
      const t = top(x, z)
      if (used.has(k2(x, z)) || path.has(k2(x, z)) || t !== orig(x, z) || nm(read(x, t, z)) !== 'grass_block' || !air(x, t + 1, z)) continue
      used.add(k2(x, z))
      cells.push({ at: [x, t, z], role: 'meadow', el: 'meadow' })
      placed.meadow = (placed.meadow ?? 0) + 1
      n++
    }
    if (!n) skipped.meadow = 'no_natural_grass'
  }
  // SUGAR CANE where there is water: the box's own soil beside a water block at the soil's height
  if (haveOf(have, 'cane') < 1) skipped.cane = 'no_sugar_cane'
  else {
    let n = 0
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (n >= Math.min(T.park.caneMax, haveOf(have, 'cane')) || used.has(k2(x, z)) || path.has(k2(x, z))) continue
      const t = top(x, z)
      if (!Number.isFinite(t) || t !== orig(x, z) || !/^(grass_block|dirt|sand|red_sand|podzol|coarse_dirt)$/.test(nm(read(x, t, z))) || !air(x, t + 1, z)) continue
      if (!N4.some(([dx, dz]) => water(x + dx, t, z + dz))) continue
      if (put(x, z, 'cane', 'cane')) n++
    }
    if (!n) skipped.cane = 'no_water'
  }
  skipped.lily_pads = 'no_actuator'
  // THE HEDGE: the box's edge only; an entrance on every side (seeded) and at the cross path's ends; never beside a road or path
  const entrances = [], gate = new Set()
  const sides = [['N', [x0, z0], [1, 0], x1 - x0 + 1], ['S', [x0, z1], [1, 0], x1 - x0 + 1], ['W', [x0, z0], [0, 1], z1 - z0 + 1], ['E', [x1, z0], [0, 1], z1 - z0 + 1]]
  for (const [s, [ax, az], [ux, uz], len] of sides) {
    const off = 1 + Math.floor(r() * Math.max(1, len - 3))
    for (let i = off; i < off + 2 && i < len - 1; i++) gate.add(k2(ax + ux * i, az + uz * i))
    entrances.push({ side: s, at: [ax + ux * off, az + uz * off] })
  }
  for (const k of [k2(cx, z0), k2(cx, z1), k2(x0, cz), k2(x1, cz)]) gate.add(k)
  if (haveOf(have, 'hedge') < 1) skipped.hedge = 'no_leaves'
  else {
    let n = 0
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (!(x === x0 || x === x1 || z === z0 || z === z1) || n >= haveOf(have, 'hedge')) continue
      if (gate.has(k2(x, z)) || near(x, z) || N8.some(([dx, dz]) => near(x + dx, z + dz))) continue
      if (!air(x, top(x, z) + 1, z)) continue
      if (put(x, z, 'hedge', 'hedge')) n++
    }
    if (!n) skipped.hedge = 'no_room'
  }
  return { box: pbox, cross: [cx, cz], cells, trees, kinds, entrances, skipped, placed }
}

// ---- the stage's siting -------------------------------------------------------------------------------------------------------

/**
 * THE TERRACE STAGE -> { ok, why, record, grade, trees, park, levels, floors, box, walk0, walk1 }. Pure over `read`.
 *   home, plan, land   the town (land: the land plan record -- its seed, its tree-farm zone for the replants, its corridors, its park)
 *   avoid(x, z)        every refusal (skills.mjs tidyInputs); cells: every other record's cells
 *   records, wall, caps   the floors' sources (every other project's record, the wall record, the wells' caps)
 *   have               { item: n } what the town can get (the park's elements)
 *   walkFrom           the town's edge (tidy.mjs townEdge): a grading that leaves fewer columns inside walkable-and-back from it, or
 *                      more stuck-prone ones, is not taken (every blend refused: no grading at all; the trees and the park stay)
 */
export async function siteTerrace (read, { home, plan = null, land = null, avoid = () => null, cells = new Set(), records = [], wall = null, caps = [], have = {}, walkFrom = null, seed = null, now = Date.now(), pause = null, water = 'strict', T = TERRACE } = {}) {
  if (!home) return { ok: false, why: 'no_home', record: null }
  const box = wallInterior(wall, home)
  const road = corridorAt(land)
  const guard = (x, z) => avoid(x, z) ?? road(x, z)
  const s0 = Number.isFinite(seed) ? seed >>> 0 : (Number(land?.seed) >>> 0)
  const parkPrev = land?.park ?? null
  // farmland and its water: no column within farmGuard of a farmland block
  const farm = farmGuardOf(read, box, home, { except: parkPrev?.box ?? null, T })
  // THE TREES (a park tree, planted on purpose, is kept). Codex r1 BLOCKER 3: a tree is felled only with its own replant cell -- one
  // the tree-farm zone has no room for keeps its tree standing (named), and the grading reads it as standing
  const keepCols = new Set((parkPrev?.trees ?? []).map(t => k2(t[0], t[2])))
  const tr0 = inWallTrees(read, box, { home, avoid: (x, z) => guard(x, z) ?? (farm(x, z) ? 'farm' : null), keep: (x, z) => keepCols.has(k2(x, z)), T })
  const replant = land ? replantCells(read, land, tr0.trees.map(t => ({ col: t.col, name: t.name })), { avoid: guard, cells }).map((r, i) => ({ ...r, tree: i })) : []
  const tr = { trees: tr0.trees.slice(0, replant.length), skipped: { ...tr0.skipped } }
  if (tr0.trees.length > replant.length) tr.skipped[land ? 'tree_no_replant' : 'tree_no_land'] = tr0.trees.length - replant.length
  const felled = new Set(tr.trees.flatMap(t => t.logs.map(l => l.at.join(','))))
  // THE FLOORS AND THE LEVELS
  const floors = buildingFloors({ records, wall, caps, read, home, T })
  const gys = []
  for (let x = box[0]; x <= box[2]; x += 2) for (let z = box[1]; z <= box[3]; z += 2) { if (guard(x, z)) continue; const c = tidyColumn(read, x, z, { yHi: home.y + T.dy, yLo: home.y - T.dy }); if (!c.why && c.y != null) gys.push(c.y) }
  gys.sort((a, b) => a - b)
  const q = p => gys[Math.min(gys.length - 1, Math.floor(gys.length * p))]
  const levels = terraceLevels(floors, gys.length ? q(0.1) : null, gys.length ? q(0.9) : null, T)
  // THE GRADING at each blend: the most balanced one that never makes the walk worse
  const fellRec = { cut: [], clear: [...felled].map(k => ({ at: k.split(',').map(Number) })), cells: [] }
  const walk0 = walkFrom ? terraceWalk(tidyOverlay(read, fellRec), box, home, walkFrom) : null
  const tried = []
  let best = null
  for (const alpha of T.alphas) {
    // NEVER WORSE: a column the grading leaves STUCK-PRONE that was not (reached, no walk back) keeps itself and its worked
    // neighbours, and the grading is solved again (at most T.walkRounds times); then the blend is taken only if the inside has no
    // fewer walkable-and-back columns and no more stuck-prone ones than before
    const keep = new Set()
    let gr = null, walk1 = null, worse = false
    for (let round = 0; round <= T.walkRounds; round++) {
      if (pause) await pause()
      gr = gradeTerraces(read, box, { home, avoid: guard, cells, levels, felled, farm, alpha, keep, water, T })
      if (process.env.TERRACE_PROFILE) console.error('grade', alpha, round, Date.now() - now)
      if (pause) await pause()
      walk1 = walkFrom ? terraceWalk(tidyOverlay(read, { cut: gr.cut, clear: [...fellRec.clear, ...gr.clearLeaves], cells: [...gr.fill, ...gr.seal, ...gr.dam] }, 'dirt'), box, home, walkFrom) : null
      if (!walk0 || !walk1) break
      const fresh = [...walk1.trapSet].filter(k => !walk0.trapSet.has(k))
      worse = walk1.back < walk0.back || walk1.traps > walk0.traps
      if (!fresh.length) break
      const n0 = keep.size
      for (const k of fresh) {
        const [x, z] = k.split(',').map(Number)
        for (const q of [k, ...N4.map(([dx, dz]) => k2(x + dx, z + dz))]) if (gr.worked.has(q)) keep.add(q)
      }
      if (keep.size === n0) break
    }
    const fillN = gr.fill.length + gr.seal.length + gr.dam.length
    tried.push({ alpha, cut: gr.cut.length, fill: fillN, worse, kept: keep.size, ...(walk1 ? { back: walk1.back, traps: walk1.traps } : {}) })
    if (worse) continue
    const bal = Math.abs(gr.cut.length - fillN), size = gr.cut.length + fillN
    if (!best || bal < best.bal || (bal === best.bal && size < best.size)) best = { gr, bal, size, walk1 }
  }
  const skipped = { ...tr.skipped }
  let gr = best?.gr ?? null
  if (!gr) {
    skipped.terrace_walk_worse = T.alphas.length
    const g0 = gradeTerraces(read, box, { home, avoid: guard, cells, levels, felled, farm, alpha: 0.5, water, T })
    gr = { ...g0, cut: [], fill: [], seal: [], dam: [], clearLeaves: [], H: new Map(g0.g), worked: new Set(), kept: new Set(g0.free) }
  }
  for (const [k, v] of Object.entries(gr.skipped ?? {})) skipped[k] = (skipped[k] ?? 0) + v
  // THE PARK on the graded ground (in the land plan's place when it has one)
  const colTop = (x, z) => { const c = tidyColumn(read, x, z, { yHi: home.y + T.dy, yLo: home.y - T.dy }); return c.why ? null : c.y }
  const top = (x, z) => gr.H.get(k2(x, z)) ?? colTop(x, z)
  const orig = (x, z) => gr.g.get(k2(x, z)) ?? null
  const fillCols = new Set(gr.fill.map(f => k2(f.at[0], f.at[2])))
  const soilTop = (x, z) => { const t = top(x, z); if (!Number.isFinite(t)) return false; return fillCols.has(k2(x, z)) || SOIL_RE.test(nm(read(x, t, z))) }
  const near = (x, z) => { const a = guard(x, z); return !!a && /road|path/.test(String(a)) }
  const pbox = parkPrev?.box ?? parkSite(gr.H, gr.kept, box, { seed: s0, home, near: (x, z) => near(x, z) || N8.some(([dx, dz]) => near(x + dx, z + dz)), T })?.box ?? null
  const after = tidyOverlay(read, { cut: gr.cut, clear: fellRec.clear, cells: [] })
  const park = pbox ? parkLayout(after, pbox, { seed: s0, top, orig, soilTop, have, water: (x, y, z) => nm(read(x, y, z)) === 'water', near, T }) : null
  if (!park) skipped.park_no_site = 1
  // a park cell in a column the stage may not touch now (a park from the land plan, a project sited since) is dropped
  // Claude r1 BLOCKER: never a park cell on one of the stage's own cuts (a cut column's H+1 is its lowest cut: the cut would never be
  // dug under a record cell, and the stage would never complete)
  const cutK = new Set([...gr.cut, ...gr.dam].map(c => c.at.join(',')))
  if (park) park.cells = park.cells.filter(c => !guard(c.at[0], c.at[2]) && !cells.has(c.at.join(',')) && !cutK.has(c.at.join(',')))
  if (park) park.trees = park.trees.filter(t => park.cells.some(c => c.at.join(',') === t.join(',')))
  // THE RECORD: tidy-01's (tidyRecord: layered fills, top-first cuts, the leaves' clears), then the trees, the seals, the park
  const fill = [], pits = []
  const cols = [...new Set(gr.fill.map(f => k2(f.at[0], f.at[2])))].sort((a, b) => {
    const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number)
    const ta = [Math.floor((ax - home.x) / T.segCols), Math.floor((az - home.z) / T.segCols)], tb = [Math.floor((bx - home.x) / T.segCols), Math.floor((bz - home.z) / T.segCols)]
    return Math.max(Math.abs(ta[0]), Math.abs(ta[1])) - Math.max(Math.abs(tb[0]), Math.abs(tb[1])) || ta[0] - tb[0] || ta[1] - tb[1] || ax - bx || az - bz
  })
  for (let i = 0; i < cols.length; i += T.segCols) {
    const id = `t${i / T.segCols}`
    const mine = new Set(cols.slice(i, i + T.segCols))
    const fs = gr.fill.filter(c => mine.has(k2(c.at[0], c.at[2])))
    pits.push({ id, cols: [...mine].map(q2 => q2.split(',').map(Number)), terrace: true, n: fs.length })
    for (const f of fs) fill.push({ ...f, pit: id })
  }
  const r0 = Math.max(TIDY.r, Math.abs(box[0] - home.x), Math.abs(box[2] - home.x), Math.abs(box[1] - home.z), Math.abs(box[3] - home.z))
  let record = tidyRecord({ ok: true, cut: gr.cut.map(c => ({ ...c, pillar: 'terrace' })), fill, pits, pillars: [], skipped, clear: gr.clearLeaves }, { home, plan, now, r: r0 })
  record ??= { v: 1, blueprint: TIDY_BLUEPRINT, plot: TIDY_PLOT, home: { x: home.x, y: home.y, z: home.z }, r: r0, cells: [], clear: [], cut: [], replant: [], segments: [], zones: [], pillars: 0, pits: 0, skipped, bom: { earth: 0 }, builders_max: TIDY_BUILDERS, structure_complete: false, plan: plan?.gen != null ? { gen: plan.gen } : null, sitedAt: now }
  const clearK = new Set(record.clear.map(c => c.at.join(',')))
  tr.trees.forEach((t, i) => { for (const l of t.logs) if (!clearK.has(l.at.join(','))) { clearK.add(l.at.join(',')); record.clear.push({ at: l.at, kind: 'tree', name: l.name, tree: i }) } })
  record.clear.sort((a, b) => a.at[1] - b.at[1])
  record.replant = replant
  // the dams (owner 11-01 rule: a cut beside water waits for them -- the visit's dig-time check): placed into the water, cobblestone
  if (gr.dam.length) {
    record.segments.unshift({ seg: 'T-D', deps: [] })
    for (const c of gr.dam) record.cells.push({ at: c.at, role: 'core', seg: 'T-D', dam: true })
  }
  if (gr.seal.length) {
    record.segments.push({ seg: 'T-S', deps: [] })
    for (const c of gr.seal) record.cells.push({ at: c.at, role: 'core', seg: 'T-S', opener: c.opener })
  }
  // the park's tool uses (the hoe, the bone meal), its plantings, its hedge: segments of their own, after every fill in order (the
  // visit's skip rule passes a planting whose ground is not laid yet: park.mjs terraceSkip)
  if (park?.cells.length) {
    const cellK = new Set(record.cells.map(c => c.at.join(',')))
    // Claude r1 note: the tilling before the bone meal (the meadow's grass spreads onto an untilled plot and covers it)
    const by = [['T-PT', c => c.role === 'till'], ['T-PP', c => PARK_PLACE_ROLES.has(c.role) && c.role !== 'hedge'], ['T-PH', c => c.role === 'hedge'], ['T-PM', c => c.role === 'meadow']]
    for (const [seg, f] of by) {
      const mine = park.cells.filter(c => f(c) && !cellK.has(c.at.join(',')))
      if (!mine.length) continue
      record.segments.push({ seg, deps: [] })
      for (const c of mine) { cellK.add(c.at.join(',')); record.cells.push({ at: c.at, role: c.role, seg, el: c.el }) }
    }
  }
  record.stageId = TERRACE_STAGE
  record.terrace = {
    box, levels, floors: floors.map(f => `${f.why}:${f.y}`), alpha: best ? gr.alpha : null, tried,
    cut: gr.cut.length, fill: gr.fill.length, seal: gr.seal.length, dam: gr.dam.length, water, net: gr.cut.length - gr.fill.length - gr.seal.length - gr.dam.length,
    columns: gr.free.size, worked: gr.worked.size, kept: gr.kept.size, trees: tr.trees.length, logs: felled.size, replant: replant.length, skipped,
    walk: walk0 ? { before: pickWalk(walk0), after: best?.walk1 ? pickWalk(best.walk1) : null } : null,
  }
  record.park = park ? { box: park.box, cross: park.cross, kinds: park.kinds, entrances: park.entrances, trees: park.trees, placed: park.placed, skipped: park.skipped, seed: s0 } : null
  const nothing = !record.cut.length && !record.cells.length && !record.clear.length
  return { ok: true, why: nothing ? 'nothing' : 'ok', record: nothing ? null : record, grade: gr, trees: tr, park, levels, floors, box, walk0, walk1: best?.walk1 ?? null, tried, skipped }
}
const pickWalk = w => ({ cols: w.cols, reach: w.reach, back: w.back, traps: w.traps, rough: w.rough, steep: w.steep })
const inBoxP = (b, x, z) => Array.isArray(b) && x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]
/** The park as the land plan keeps it (skills.mjs publishes it once on the land record) -> { box, trees, seed } | null. Pure. */
export const landPark = rec => (rec?.park?.box ? { box: rec.park.box, trees: rec.park.trees ?? [], seed: rec.park.seed ?? null } : null)

/**
 * GKHELPERS-01: THE PARK TOPPED UP (owner 11-03 B). A park sited while the town held nothing for it (LIVE showcase 11-03: all four
 * quadrants a meadow, every other element `no_<x>`) gets the elements the town holds NOW, in the same box, cross path and entrances
 * -- never re-rolled, never over a cell any generation already has. -> { cells, segments, park } | null (nothing new). Pure over `read`.
 *   park    the park as it stands ({ box, seed, kinds, placed, skipped }: the land plan's, else the terrace record's)
 *   have    { item: n } the town's stock + the bag; an element is added only once the town holds TOPUP_MIN of it
 *   taken   (x, z) -> bool: a column a record cell of the chain already has (the meadow's, a tilled plot's, any fill)
 *   near    (x, z) -> bool: a road or path column (no hedge beside one); water(x, y, z)
 *   segN    the top-up's number (its segments T-PU<n>-T|P|H: the tilling first, then the plantings, then the hedge)
 *   y0, y1  the ground's search heights (the column's top: the highest solid non-plant block in them)
 */
export const TOPUP_MIN = Object.freeze({ flowers: 4, tall_flowers: 2, azalea: 2, trees: 1, bamboo: 3, crops: 3, cane: 2, hedge: 8 })
export function parkTopUp (read, { park, have = {}, taken = () => false, near = () => false, water = () => false, segN = 0, y0, y1, T = TERRACE } = {}) {
  if (!Array.isArray(park?.box) || park.box.length !== 4) return null
  const placed = park.placed ?? {}
  const fresh = {}
  for (const [el, min] of Object.entries(TOPUP_MIN)) {
    if ((placed[el] ?? 0) > 0) continue
    if (haveOf(have, el) < min) continue
    if (el === 'crops' && !hasHoe(have)) continue
    for (const n of ELEMENT_ITEMS[el] ?? []) if (Number(have[n]) > 0) fresh[n] = Number(have[n])
  }
  if (!Object.keys(fresh).length) return null
  for (const [n, v] of Object.entries(have)) if (/_hoe$/.test(n) && Number(v) > 0) fresh[n] = v
  const topMemo = new Map()
  const top = (x, z) => {
    const k = k2(x, z)
    if (topMemo.has(k)) return topMemo.get(k)
    let t = -Infinity
    for (let y = y1; y >= y0; y--) { const b = read(x, y, z); if (!b) break; const n = nm(b); if (b.boundingBox === 'block' && !/leaves$/.test(n)) { t = y; break } }
    topMemo.set(k, t)
    return t
  }
  const soilTop = (x, z) => { const t = top(x, z); return Number.isFinite(t) && SOIL_RE.test(nm(read(x, t, z))) }
  const lay = parkLayout(read, park.box, { seed: Number(park.seed) || 0, top, orig: top, soilTop, have: fresh, water, near, T })
  // a till and its crop stand together or not at all; never a column a cell of the chain has
  const bad = new Set(lay.cells.filter(c => taken(c.at[0], c.at[2])).map(c => k2(c.at[0], c.at[2])))
  const cells = lay.cells.filter(c => !bad.has(k2(c.at[0], c.at[2])) && Number.isFinite(c.at[1]))
  if (!cells.length) return null
  const segs = [], out = []
  for (const [suf, f] of [['T', c => c.role === 'till'], ['P', c => PARK_PLACE_ROLES.has(c.role) && c.role !== 'hedge'], ['H', c => c.role === 'hedge']]) {
    const mine = cells.filter(f)
    if (!mine.length) continue
    const seg = `T-PU${segN}-${suf}`
    segs.push({ seg, deps: [] })
    for (const c of mine) out.push({ at: c.at, role: c.role, seg, el: c.el, topup: segN })
  }
  if (!out.length) return null
  const nowPlaced = {}
  for (const c of out) if (c.role !== 'till') nowPlaced[c.el] = (nowPlaced[c.el] ?? 0) + 1
  const skipped = { ...(park.skipped ?? {}) }
  for (const el of Object.keys(nowPlaced)) delete skipped[el]
  // an element the town now holds that still found no place (cane with no water in the box, no room) keeps the layout's reason: a
  // `no_water` is no want (park.mjs parkWant), so the crew stops gathering what the park cannot use
  for (const [el, why] of Object.entries(lay.skipped ?? {})) if (!nowPlaced[el] && Object.keys(TOPUP_MIN).includes(el) && haveOf(fresh, el) >= (TOPUP_MIN[el] ?? 1)) skipped[el] = why
  const kinds = { ...(park.kinds ?? {}) }
  for (const [q, el] of Object.entries(lay.kinds ?? {})) if (el !== 'meadow' && nowPlaced[el]) kinds[q] = el
  return { cells: out, segments: segs, park: { ...park, kinds, placed: { ...placed, ...nowPlaced }, skipped, trees: [...(park.trees ?? []), ...lay.trees.filter(t => out.some(c => c.at.join(',') === t.join(',')))], topups: (park.topups ?? 0) + 1 } }
}
