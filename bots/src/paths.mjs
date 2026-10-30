// PATHS-01: THE TOWN'S PATHS (owner showcase list 10-29, item 2: house-01 -> paths-01 -> wall-01). PURE: the switch, the ground
// scan, the router, the network and the record. Nothing here touches a bot or a file.
//
// WHAT A PATH IS: the town's top surface, 2 wide (the town plan's spokes are 2 wide; the owner's limit is 3), made into
// DIRT_PATH by a shovel's use on grass or dirt -- no material at all -- and paved with cobblestone only where the ground cannot
// be flattened (sand, clay, mud...: dug, then a cobblestone set on the ground below). Stone, gravel and cobblestone already
// there are left as they are (they read as path). The record is written ONCE at siting and is deterministic: the same ground,
// plan and records give the same cells.
//
// THE NETWORK (a tree, joined at the town core): one leg per destination, nearest first, routed to the core's edge or to any leg
// already laid (so the well joins the farm's leg); the plan's own path segments cost half, so a leg follows a spoke where the
// spoke leads its way (p-farm to the composter, p-gate north toward the monument) and a spoke toward nothing is never laid.
//   destinations: the farm (a side of the composter), the well (the ring 4 out from its cap: never inside its footprint + 1),
//   every built project's front (a blueprint's doorway approach; the ziggurat's grand-stair foot).
// THE ROUTER: Dijkstra over 2x2 brushes (a brush at (x, z) covers x..x+1, z..z+1, so every leg is 2 wide, corners included),
// each laid flat at a level (see the router below: dips filled, bumps cut, +-1 between brushes), state (x, z, heading, level),
// ties broken by coordinates (deterministic). A column is refused on: an unread cell, water anywhere above the ground (owner
// 10-27: no water bridging; designed bridges later -- paths go round water), furniture or a built block, a protected zone, a
// plan cell or its stand, a committed plan box (+1), the core plaza itself, a well (its cap's Chebyshev 3, its plinth + 1), the
// farm, any project's record column. Prices: length, rises, turns, fill and cut, leaves at head height, and a TREE TRUNK standing
// on a column (felling is allowed but dear: route round where it is cheap); the plan's own path segments cost half.

import { keepouts, isLiquid, isFurniture, replaceableCell } from './townplan.mjs'

export const PATHS_PLOT = 'paths'
export const PATHS_BLUEPRINT = 'paths@1'
export const PATHS_BUILDERS = 4
export const PATH_SEG_CELLS = 24
export const PATH_DY = 12
/**
 * THE SWITCH -> bool. PATHS=on|off; unset = on only in the pools PATHS_POOLS names (default 'showcase'): the fleet's towns keep
 * their project list until the fleet rollout. Pure.
 */
export function pathsOn (env = process.env, pool = '') {
  const v = String(env?.PATHS ?? '').toLowerCase()
  if (v === 'on' || v === '1' || v === 'true') return true
  if (v === 'off' || v === '0' || v === 'false') return false
  const pools = String(env?.PATHS_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes(String(pool))
}
/**
 * WHAT READS AS A FINISHED PATH CELL (buildrun.mjs cellDone by family): dirt_path first (never held, so a placement never picks
 * it), then what a builder may set into a dug cell (cobblestone, gravel), then the hard ground the path keeps as it is.
 */
export const PATH_PALETTE = Object.freeze({
  path: ['dirt_path', 'cobblestone', 'gravel', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'cobbled_deepslate', 'deepslate', 'mossy_cobblestone', 'sandstone', 'smooth_stone', 'stone_bricks'],
})
/** Ground a shovel's use turns into dirt_path (vanilla ShovelItem's flattenables). */
export const FLATTENABLE = /^(grass_block|dirt|coarse_dirt|podzol|mycelium|rooted_dirt)$/
/** Ground that is neither flattenable nor path-looking: dug out of the cell (buildrun.mjs foreignKind) and paved with cobblestone. */
export const PATH_FOREIGN = /^(sand|red_sand|suspicious_sand|clay|mud|packed_mud|snow_block|powder_snow|moss_block|ice|packed_ice|blue_ice|soul_sand|soul_soil|calcite|dripstone_block|smooth_basalt|netherrack|red_sandstone|terracotta|[a-z_]+_terracotta|muddy_mangrove_roots|[a-z_]*_ore|raw_[a-z]+_block)$/
const DONE = new Set(PATH_PALETTE.path)
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const LEAVES = /_leaves$/
const LOG = /_(log|wood)$|^mangrove_roots$/
const LITTER = /^crafting_table$/
const PLANT = /^(air|cave_air|void_air|short_grass|tall_grass|grass|fern|large_fern|dead_bush|dandelion|poppy|.*_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|sunflower|lilac|rose_bush|peony|snow|sweet_berry_bush|bush|firefly_bush|leaf_litter|wildflowers|pink_petals|brown_mushroom|red_mushroom|vine|glow_lichen|moss_carpet|short_dry_grass|tall_dry_grass|cactus_flower|torchflower|[a-z_]+_sapling|mangrove_propagule|seagrass|tall_seagrass|cobweb)$/
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'

/** Is a block a finished path cell (by name; the palette's families)? Pure. */
export const pathDone = b => DONE.has(nm(b))
/** Can a shovel's use make dirt_path of it now (flattenable, and air above -- vanilla's rule)? Pure. */
export const pathUsable = (b, above) => FLATTENABLE.test(nm(b)) && !!above && AIRN(nm(above))

/**
 * ONE COLUMN -> { y, name, why, above: [{ y, name, kind }] }. Pure. The ground is the highest full solid from yHi down, passing
 * over air, plants, snow layers, leaves, logs and a field crafting table (each listed in `above`, kind plant | leaves | tree |
 * cut). `why` names a refusal: 'unknown' (an unread cell), 'water' (a liquid at or above the ground), 'furniture', 'built' (a
 * placed part: planks, glass, a slab...), 'no_ground', 'farm' (farmland).
 */
export function pathColumn (read, x, z, { yHi, yLo }) {
  const above = []
  for (let y = yHi; y >= yLo; y--) {
    const b = read(x, y, z)
    if (!b) return { y: null, name: null, why: 'unknown', above }
    const n = nm(b)
    if (isLiquid(b) || String(b.name ?? '').includes('waterlogged')) return { y: null, name: n, why: 'water', above }
    if (AIRN(n)) continue
    if (PLANT.test(n) || replaceableCell(b)) { above.push({ y, name: n, kind: 'plant' }); continue }
    if (LEAVES.test(n)) { above.push({ y, name: n, kind: 'leaves' }); continue }
    if (LOG.test(n)) { above.push({ y, name: n, kind: 'tree' }); continue }
    if (LITTER.test(n)) { above.push({ y, name: n, kind: 'cut' }); continue }
    if (n === 'farmland') return { y: null, name: n, why: 'farm', above }
    if (isFurniture(b)) return { y: null, name: n, why: 'furniture', above }
    if (b.boundingBox !== 'block' || /_planks$|_slab$|_stairs$|_fence|_wall$|_pane$|glass|_door$|_trapdoor$|torch|lantern|ladder|_bed$|_carpet$|_wool$|_sign$|copper/.test(n)) return { y: null, name: n, why: 'built', above }
    return { y, name: n, why: null, above }
  }
  return { y: null, name: null, why: 'no_ground', above }
}
/** What a column's surface needs -> 'use' (shovel) | 'done' (already path) | 'pave' (dig, then cobblestone). Pure. */
export const surfaceNeed = name => (FLATTENABLE.test(name) ? 'use' : DONE.has(name) ? 'done' : 'pave')

// ---- the router --------------------------------------------------------------------------------------------------------------
//
// A town's ground is not a road (measured on the showcase's region copy 10-30: 14% of 4-adjacent ground columns differ by 2 or
// more -- the bots' own digging terraced the town, pillars stand on it, and the monument sits in a valley). So a leg has a LEVEL:
// every brush is laid FLAT at a level s within FILL_MAX above or CUT_MAX below each of its columns' ground -- a dip is FILLED
// (cobblestone, the top cell paved), a bump is CUT (its ground dug, listed with the clears) -- and two brushes in a row differ by
// at most one level. A column covered by several brushes takes the HIGHEST of their levels (the maximum over overlapping windows
// of a 1-Lipschitz run is 1-Lipschitz: every step of the finished path is +-1 at most; pathRecord re-measures it).
export const FILL_MAX = 2
export const CUT_MAX = 2
// canopy: leaves anywhere above a column (above the head-height clears) -- a path under a canopy is a path no camera sees (the
// showcase's timelapse looks down: owner 10-29, "camera on every project"), so open ground is preferred where it is cheap
export const COST = Object.freeze({ step: 1, rise: 0.8, turn: 8, fill: 1.5, cut: 1.2, trunk: 12, log: 0.5, leaves: 0.6, plant: 0.05, pave: 0.8, done: 0.1, canopy: 0.4, planSeg: 0.5 })
const BRUSH = [[0, 0], [1, 0], [0, 1], [1, 1]]
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
/** A ground block a cut may dig down through, and a cut's new top may be: natural full ground. */
const NATURAL = /^(grass_block|dirt|coarse_dirt|podzol|mycelium|rooted_dirt|stone|andesite|diorite|granite|tuff|deepslate|gravel|sand|red_sand|clay|sandstone|red_sandstone|calcite|[a-z_]*_ore|moss_block|mud|packed_mud|terracotta|[a-z_]+_terracotta)$/

/**
 * ONE COLUMN AT LEVEL s -> its price, or Infinity. Pure. `c` is pathColumn's answer, `read` the world (a cut reads the ground
 * under the top). Fill: the cells g+1..s must hold only what the clears take (they do: the scan passed them); cut: every cell
 * s+1..g natural full ground and the cell at s too.
 */
export function columnCost (c, s, read, x, z) {
  if (!c || c.why || c.y == null) return Infinity
  const g = c.y
  if (s > g + FILL_MAX || s < g - CUT_MAX) return Infinity
  let v = 0
  if (s > g) v += COST.fill * (s - g) + COST.pave
  else {
    if (s < g) {
      for (let y = s; y <= g; y++) { const b = read(x, y, z); if (!b || !NATURAL.test(nm(b))) return Infinity }
      v += COST.cut * (g - s)
    }
    const top = s === g ? c.name : nm(read(x, s, z))
    v += ({ use: 0, done: COST.done, pave: COST.pave })[surfaceNeed(top)]
  }
  const lo = Math.min(s, g) + 1, hi = Math.max(s, g) + 2
  const span = c.above.filter(a => a.y >= lo && a.y <= hi)
  if (span.some(a => a.kind === 'tree')) v += COST.trunk + COST.log * c.above.filter(a => a.kind === 'tree').length
  v += COST.leaves * span.filter(a => a.kind === 'leaves').length + COST.plant * span.filter(a => a.kind === 'plant').length
  if (c.above.some(a => a.kind === 'leaves' && a.y > hi)) v += COST.canopy
  return v
}

/**
 * THE GRID over a box -> { col(x, z), cost(x, z, s), levels(x, z) -> [s], inside(x, z) }. Pure, memoised. `column(x, z)` is
 * pathColumn's answer; `avoid(x, z)` -> reason | null; `read` the world.
 */
export function pathGrid (column, avoid, box, read) {
  const [bx0, bz0, bx1, bz1] = box
  const cm = new Map(), lm = new Map(), km = new Map()
  const key = (x, z) => x * 65536 + z
  const inside = (x, z) => x >= bx0 && x + 1 <= bx1 && z >= bz0 && z + 1 <= bz1
  const col = (x, z) => {
    const k = key(x, z)
    if (!cm.has(k)) {
      let c = null
      if (x >= bx0 && x <= bx1 && z >= bz0 && z <= bz1) { const why = avoid(x, z); c = why ? { y: null, why, above: [] } : column(x, z) }
      cm.set(k, c)
    }
    return cm.get(k)
  }
  const cost = (x, z, s) => {
    const k = `${x},${z},${s}`
    if (!km.has(k)) km.set(k, BRUSH.reduce((t, [dx, dz]) => t + columnCost(col(x + dx, z + dz), s, read, x + dx, z + dz), 0))
    return km.get(k)
  }
  const levels = (x, z) => {
    const k = key(x, z)
    if (!lm.has(k)) {
      const cs = BRUSH.map(([dx, dz]) => col(x + dx, z + dz))
      const out = []
      if (inside(x, z) && cs.every(c => c && !c.why && c.y != null)) {
        const ys = cs.map(c => c.y)
        for (let s = Math.max(...ys) - CUT_MAX; s <= Math.min(...ys) + FILL_MAX; s++) if (Number.isFinite(cost(x, z, s))) out.push(s)
      }
      lm.set(k, out)
    }
    return lm.get(k)
  }
  return { col, cost, levels, inside }
}

/**
 * ONE LEG -> { ok, nodes: [[x, z, s]] from the source to the target, cost, why }. Pure. Dijkstra over (brush, heading, level)
 * from every `sources` brush at every level it allows (cost 0) to the first popped brush in `targets` (Map "x,z" -> its level,
 * or null for a hub brush: any level) whose level is within one of the target's. `discount(x, z)` halves a brush's price (the
 * plan's own segments). Deterministic: equal costs pop by x, then z, then heading, then level.
 */
export function routeLeg (grid, sources, targets, { discount = () => false, maxPops = 600_000 } = {}) {
  const heap = []
  const less = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4]
  const push = it => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (less(heap[i], heap[p]) >= 0) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p } }
  const pop = () => {
    const top = heap[0], last = heap.pop()
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l], heap[m]) < 0) m = l; if (r < heap.length && less(heap[r], heap[m]) < 0) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m } }
    return top
  }
  const best = new Map(), prev = new Map()
  const sk = (x, z, d, s) => `${x},${z},${d},${s}`
  for (const [x, z] of [...sources].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    for (const s of grid.levels(x, z)) { const c0 = grid.cost(x, z, s); const k = sk(x, z, 4, s); if (c0 < (best.get(k) ?? Infinity)) { best.set(k, c0); push([c0, x, z, 4, s]) } }
  }
  let pops = 0
  while (heap.length && pops++ < maxPops) {
    const [c, x, z, d, s] = pop()
    if (c > (best.get(sk(x, z, d, s)) ?? Infinity)) continue
    const tk = `${x},${z}`
    if (targets.has(tk) && (targets.get(tk) == null || Math.abs(targets.get(tk) - s) <= 1)) {
      const nodes = [[x, z, s]]
      let k = sk(x, z, d, s)
      while (prev.has(k)) { k = prev.get(k); const [px, pz, , ps] = k.split(',').map(Number); nodes.push([px, pz, ps]) }
      return { ok: true, nodes: nodes.reverse(), cost: c, why: 'ok' }
    }
    for (let nd = 0; nd < 4; nd++) {
      const nx = x + DIRS[nd][0], nz = z + DIRS[nd][1]
      for (const ns of grid.levels(nx, nz)) {
        if (Math.abs(ns - s) > 1) continue
        const disc = discount(nx, nz) ? COST.planSeg : 1
        const nc = c + disc * (COST.step + grid.cost(nx, nz, ns)) + COST.rise * Math.abs(ns - s) + (d !== 4 && d !== nd ? COST.turn : 0)
        const k = sk(nx, nz, nd, ns)
        if (nc < (best.get(k) ?? Infinity)) { best.set(k, nc); prev.set(k, sk(x, z, d, s)); push([nc, nx, nz, nd, ns]) }
      }
    }
  }
  return { ok: false, nodes: [], cost: Infinity, why: pops >= maxPops ? 'search_bound' : 'unreachable' }
}

/** Brushes covering any of `cols` ([[x, z]]) -> [[x, z]]. Pure. */
export const brushesOver = cols => { const s = new Map(); for (const [x, z] of cols) for (const [dx, dz] of BRUSH) s.set(`${x - dx},${z - dz}`, [x - dx, z - dz]); return [...s.values()] }
/** The brushes OUTSIDE a box that touch its edge (a brush column 4-adjacent to a box column, none inside) -> [[x, z]]. Pure. */
export function hubBrushes ([x0, z0, x1, z1]) {
  const out = []
  const inBox = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1
  for (let x = x0 - 2; x <= x1 + 1; x++) for (let z = z0 - 2; z <= z1 + 1; z++) {
    const cs = BRUSH.map(([dx, dz]) => [x + dx, z + dz])
    if (cs.some(([cx, cz]) => inBox(cx, cz))) continue
    if (cs.some(([cx, cz]) => DIRS.some(([dx, dz]) => inBox(cx + dx, cz + dz)))) out.push([x, z])
  }
  return out
}

/**
 * THE NETWORK -> { legs: [{ id, to, nodes: [[x, z, s]], join, ok, why, cost }], laid: Map "x,z" -> { leg, s } }. Pure.
 *   grid   pathGrid(...)
 *   hub    the core plaza's box [x0, z0, x1, z1]: legs start at its edge (hubBrushes, any level)
 *   dests  [{ id, to, cols: [[x, z]] }] in the order given (the caller sorts nearest first): a leg from a brush over any of its
 *          columns to the hub or to a brush already laid (its level within one)
 */
export function pathNetwork (grid, { hub, dests = [], discount = () => false } = {}) {
  const legs = [], laid = new Map()
  const hubs = hubBrushes(hub).filter(([x, z]) => grid.levels(x, z).length)
  for (const d of dests) {
    const targets = new Map(hubs.map(([x, z]) => [`${x},${z}`, null]))
    for (const [k, v] of laid) targets.set(k, v.s)
    const r = routeLeg(grid, brushesOver(d.cols), targets, { discount })
    if (!r.ok) { legs.push({ id: d.id, to: d.to ?? d.id, nodes: [], join: null, ok: false, why: r.why, cost: Infinity }); continue }
    const end = r.nodes[r.nodes.length - 1]
    const join = laid.has(`${end[0]},${end[1]}`) ? `leg:${laid.get(`${end[0]},${end[1]}`).leg}` : 'hub'
    const own = r.nodes.filter(([x, z]) => !laid.has(`${x},${z}`))
    legs.push({ id: d.id, to: d.to ?? d.id, nodes: own, join, ok: true, why: 'routed', cost: Math.round(r.cost * 10) / 10 })
    for (const [x, z, s] of own) laid.set(`${x},${z}`, { leg: d.id, s })
  }
  return { legs, laid }
}

/** Path columns -> merged rectangles widened by `margin`, as siting zones [{ box: [x0,y0,z0,x1,y1,z1], why }]. Pure. */
export function pathZones (cols, margin = 1) {
  const rows = new Map()
  for (const [x, z] of cols) { if (!rows.has(z)) rows.set(z, new Set()); rows.get(z).add(x) }
  const runs = []
  for (const z of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = [...rows.get(z)].sort((a, b) => a - b)
    for (let i = 0; i < xs.length;) { let j = i; while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++; runs.push([xs[i], z, xs[j]]); i = j + 1 }
  }
  // merge runs with the same span in consecutive rows
  const boxes = []
  for (const [xa, z, xb] of runs) {
    const b = boxes.find(q => q[0] === xa && q[2] === xb && q[3] === z - 1)
    if (b) b[3] = z; else boxes.push([xa, z, xb, z])
  }
  return boxes.map(([xa, za, xb, zb]) => ({ box: [xa - margin, -64, za - margin, xb + margin, 320, zb + margin], why: `project:${PATHS_PLOT}` }))
}

/**
 * THE RECORD for a network (buildproj.mjs publishRecord's payload; buildrun.mjs runVisit's input) -> record. Pure over `read`.
 *   cells    per path column at its LEVEL L (the highest of the brushes over it): the path cell at L, role `path` -- and under a
 *            raised column the fill g+1..L-1, role `fill` (cobblestone, bottom-up) -- in segment `P-<leg>-<n>` (PATH_SEG_CELLS
 *            columns a segment, from where the leg joins outward); no segment waits on another
 *   clear    a CUT column's ground above L (kind cut); what stands in the column from L+1 to two above the higher of L and the
 *            ground at siting: plants and snow layers (plant), leaves (leaves), a field crafting table (cut), and -- where a trunk
 *            stands there -- every log of that column (tree; no replant is owed: the monument's rule, owner 10-26)
 *   zones    the path columns as siting zones (+1) for every later project (the record has no `box`: a box would cover the town)
 */
export function pathRecord (net, grid, read, { home, plan = null, now = Date.now() } = {}) {
  const level = new Map()
  for (const leg of net.legs) for (const [x, z, s] of leg.nodes) for (const [dx, dz] of BRUSH) { const k = `${x + dx},${z + dz}`; level.set(k, Math.max(level.get(k) ?? -Infinity, s)) }
  const cells = [], clear = [], seen = new Set(), segments = [], surface = {}, earth = { fill: 0, cut: 0 }
  let pave = 0
  for (const leg of net.legs.filter(l => l.ok && l.nodes.length)) {
    // a routed leg's nodes run from the destination to where it joins: its columns from the joining end outward
    const mine = []
    for (const [x, z] of [...leg.nodes].reverse()) for (const [dx, dz] of BRUSH) { const k = `${x + dx},${z + dz}`; if (!seen.has(k)) { seen.add(k); mine.push([x + dx, z + dz]) } }
    for (let i = 0; i < mine.length; i += PATH_SEG_CELLS) {
      const seg = `P-${leg.id}-${i / PATH_SEG_CELLS}`
      segments.push({ seg, deps: [] })
      for (const [x, z] of mine.slice(i, i + PATH_SEG_CELLS)) {
        const c = grid.col(x, z), g = c.y, L = level.get(`${x},${z}`)
        for (let y = g + 1; y < L; y++) cells.push({ at: [x, y, z], role: 'fill', seg })
        cells.push({ at: [x, L, z], role: 'path', seg })
        if (L > g) { earth.fill += L - g; pave++; surface.raised = (surface.raised ?? 0) + 1 } else {
          for (let y = L + 1; y <= g; y++) clear.push({ at: [x, y, z], kind: 'cut', name: nm(read(x, y, z)) })
          earth.cut += g - L
          const top = L === g ? c.name : nm(read(x, L, z))
          surface[top] = (surface[top] ?? 0) + 1
          if (surfaceNeed(top) === 'pave') pave++
        }
        const lo = Math.min(L, g) + 1, hi = Math.max(L, g) + 2
        const trunk = c.above.some(a => a.kind === 'tree' && a.y >= lo && a.y <= hi)
        for (const a of c.above) {
          if (a.kind === 'tree' ? !trunk : (a.y < lo || a.y > hi)) continue
          clear.push({ at: [x, a.y, z], kind: a.kind, name: a.name })
        }
      }
    }
  }
  // the steepest step between 4-adjacent path columns (the router keeps it <= 1)
  let maxStep = 0
  for (const [k, y] of level) { const [x, z] = k.split(',').map(Number); for (const [dx, dz] of [[1, 0], [0, 1]]) { const o = level.get(`${x + dx},${z + dz}`); if (o != null) maxStep = Math.max(maxStep, Math.abs(o - y)) } }
  clear.sort((a, b) => a.at[1] - b.at[1])
  const cols = [...level.keys()].map(k => k.split(',').map(Number))
  return {
    v: 1, blueprint: PATHS_BLUEPRINT, plot: PATHS_PLOT, home, width: 2,
    legs: net.legs.map(l => ({ id: l.id, to: l.to, ok: l.ok, why: l.why, join: l.join, brushes: l.nodes.length, cost: l.cost })),
    cells, clear, replant: [], segments, surface, earthwork: earth, maxStep, columns: cols.length,
    zones: pathZones(cols),
    bom: { cobblestone: pave + earth.fill - (surface.raised ?? 0) }, builders_max: PATHS_BUILDERS,
    structure_complete: false, plan: plan ? { gen: plan.gen } : null, sitedAt: now,
  }
}

// ---- the destinations ------------------------------------------------------------------------------------------------------

/** A blueprint project's FRONT APPROACH: the column one outside its doorway's step, (front.u, v -1) placed like its cells ->
 *  [x, z] | null. `place(bp, anchor, s, orient)` is buildsite.mjs placeBlueprint. Pure. */
export function frontApproach (rec, bp, place) {
  if (!rec || !bp?.front || !Array.isArray(rec.anchor)) return null
  const [c] = place({ cells: [{ u: bp.front.u, v: -1, y: 0 }] }, { x: rec.anchor[0], z: rec.anchor[1] }, rec.s ?? 0, rec.orient)
  return c ? [c.at[0], c.at[2]] : null
}
/** The ziggurat's GRAND-STAIR FOOT: for each stair cell, the first column outward along the stair face that is no record column
 *  -> [[x, z]] (unique). Pure. */
export function stairFoot (rec) {
  const f = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] }[rec?.face]
  if (!f) return []
  const cols = new Set((rec.cells ?? []).map(c => `${c.at[0]},${c.at[2]}`))
  const out = new Map()
  for (const c of (rec.cells ?? []).filter(q => q.role === 'stair')) {
    let [x, z] = [c.at[0], c.at[2]]
    for (let k = 0; k < 16 && cols.has(`${x},${z}`); k++) { x += f[0]; z += f[1] }
    out.set(`${x},${z}`, [x, z])
  }
  // only the outermost row (the foot), never a column beside the flight
  const far = Math.max(...[...out.values()].map(([x, z]) => x * f[0] + z * f[1]))
  return [...out.values()].filter(([x, z]) => x * f[0] + z * f[1] === far)
}
/** The ring at Chebyshev `d` round a point -> [[x, z]]. Pure. */
export function ringCols (x0, z0, d) {
  const out = []
  for (let dx = -d; dx <= d; dx++) for (let dz = -d; dz <= d; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === d) out.push([x0 + dx, z0 + dz])
  return out
}

/**
 * WHAT A PATH MUST NOT MEET -> (x, z) -> reason | null. Pure.
 *   plan       the town plan: its cells and their stands (any height in home.y +- PATH_DY), its committed boxes + 1, and every
 *              keep-out plot's own box (the core plaza: the legs stop at its edge) -- its PATH SEGMENTS are no refusal
 *   zones      protected boxes [x0,y0,z0,x1,y1,z1] (or { box })
 *   caps       well caps [[x, y, z]]: Chebyshev 3 (the footprint cap +- 2, + 1); `plinth` the plinth cells' columns + 1
 *   composter  [x, y, z] its column; `farm` tree-farm columns + 2
 *   records    every other project's record: its cell columns
 */
export function pathAvoid ({ plan = null, zones = [], caps = [], plinth = [], composter = null, farm = [], records = [], home = { y: 70 } } = {}) {
  const ko = plan ? keepouts(plan) : null
  const plots = (plan?.plots ?? []).filter(p => p.keepout && Array.isArray(p.box)).map(p => p.box)
  const cols = new Set()
  for (const r of records) for (const c of r?.cells ?? []) cols.add(`${c.at[0]},${c.at[2]}`)
  const pl = new Set()
  for (const c of plinth) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) pl.add(`${c[0] + dx},${c[2] + dz}`)
  const fm = new Set()
  for (const [x, z] of farm) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) fm.add(`${x + dx},${z + dz}`)
  return (x, z) => {
    for (const zb of zones) { const b = zb?.box ?? zb; if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return 'zone' }
    if (ko) {
      for (let y = home.y - PATH_DY; y <= home.y + PATH_DY; y++) if (ko.never(x, y, z)) return 'plan_cell'
      if (ko.boxAt(x, z)) return 'plan_box'
    }
    if (plots.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])) return 'plan_plot'
    if (caps.some(c => Math.max(Math.abs(c[0] - x), Math.abs(c[2] - z)) <= 3)) return 'well'
    if (pl.has(`${x},${z}`)) return 'well'
    if (composter && composter[0] === x && composter[2] === z) return 'farm'
    if (fm.has(`${x},${z}`)) return 'treefarm'
    if (cols.has(`${x},${z}`)) return 'project'
    return null
  }
}

/** Sapling keep-out for a paths record: its columns + 1 (shop.mjs saplingAllowedAt reads `cols`) -> { cols } | null. Pure. */
export function pathSaplingCols (rec, margin = 1) {
  const cs = rec?.cells ?? []
  if (!cs.length) return null
  const cols = new Set()
  for (const c of cs) for (let dx = -margin; dx <= margin; dx++) for (let dz = -margin; dz <= margin; dz++) cols.add(`${c.at[0] + dx},${c.at[2] + dz}`)
  return { cols }
}
/** A paths record's walk radius (buildrun.mjs walkR): every cell's Chebyshev distance from home + 7, at least 48. Pure. */
export const pathWalkR = (rec, home) => Math.max(48, ...(rec?.cells ?? []).map(c => Math.max(Math.abs(c.at[0] - home.x), Math.abs(c.at[2] - home.z)) + 7))
/** The record's progress -> { done, open } from a `done(cell)` test. Pure. */
export function pathProgress (rec, done) {
  let d = 0, open = 0
  for (const c of rec?.cells ?? []) { if (done(c)) d++; else open++ }
  return { done: d, open }
}

/**
 * THE SITING -> { ok, why, record, net, dests }. Pure over `read`. The bot's own (skills.mjs buildPaths) and the offline proof's
 * (scripts/pathsite-offline.mjs).
 *   plan       the town plan head's body: its core plaza is the hub, its path segments cost half (the router follows them where
 *              they lead somewhere; a spoke toward nothing -- the showcase's p-well points E, its well stands S -- is not laid)
 *   projects   [{ plot, rec, bp }] every other project's record (and its blueprint, for a front approach); only a COMPLETE one
 *              is a destination; the ziggurat's grand-stair foot is its front
 *   composter, caps (well caps [x, y, z]), plinth (cells), farm (tree-farm columns), zones; `place` buildsite.mjs placeBlueprint
 * Destinations nearest first; every one must be reached (the record is written once: a destination no leg reaches leaves the
 * network unsited and the order asks again).
 */
export function sitePaths (read, { plan, zones = [], caps = [], plinth = [], composter = null, farm = [], projects = [], place, now = Date.now(), r = 56 } = {}) {
  const home = plan?.home
  if (!home) return { ok: false, why: 'no_plan', record: null }
  const core = (plan.plots ?? []).find(p => p.id === 'core' && Array.isArray(p.box))?.box
  if (!core) return { ok: false, why: 'no_core', record: null }
  const dests = []
  if (composter) dests.push({ id: 'farm', to: 'farm', cols: DIRS.map(([dx, dz]) => [composter[0] + dx, composter[2] + dz]) })
  if (caps[0]) dests.push({ id: 'well', to: 'well', cols: ringCols(caps[0][0], caps[0][2], 4) })
  for (const p of projects) {
    if (!p?.rec?.structure_complete) continue                       // a path leads to what stands
    if (p.rec.blueprint === 'ziggurat@1') { const f = stairFoot(p.rec); if (f.length) dests.push({ id: p.plot, to: p.plot, cols: f }); continue }
    const a = p.bp ? frontApproach(p.rec, p.bp, place) : null
    if (a) dests.push({ id: p.plot, to: p.plot, cols: [a] })
  }
  const dist = d => Math.min(...d.cols.map(([x, z]) => Math.hypot(x - home.x, z - home.z)))
  dests.sort((a, b) => dist(a) - dist(b) || (a.id < b.id ? -1 : 1))
  if (!dests.length) return { ok: false, why: 'no_destination', record: null }
  const avoid = pathAvoid({ plan, zones, caps, plinth, composter, farm, records: projects.map(p => p.rec), home })
  const box = [home.x - r, home.z - r, home.x + r, home.z + r]
  const grid = pathGrid((x, z) => pathColumn(read, x, z, { yHi: home.y + PATH_DY, yLo: home.y - PATH_DY }), avoid, box, read)
  const segs = (plan.paths ?? []).map(p => p.seg).filter(Array.isArray)
  const discount = (x, z) => segs.some(s => x >= s[0] && x + 1 <= s[2] && z >= s[1] && z + 1 <= s[3])
  const net = pathNetwork(grid, { hub: core, dests, discount })
  const missed = net.legs.filter(l => !l.ok)
  if (missed.length) return { ok: false, why: `unrouted:${missed.map(l => `${l.id}:${l.why}`).join(',')}`, record: null, net, dests }
  const record = pathRecord(net, grid, read, { home, plan, now })
  if (!record.cells.length) return { ok: false, why: 'no_route', record: null, net, dests }
  return { ok: true, why: 'ok', record, net, dests }
}
