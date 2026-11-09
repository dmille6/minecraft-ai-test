// ROADS-01: STONE-BRICK ROADS ON THE BOTS' OWN TRAVEL LINES, WITH LAMP POSTS (OWNER 2026-11-09: "stone-brick roads linking town <->
// mine <-> forest <-> village <-> farm ... choose routes from the bots' real travel lines ... grade them gently: stair or slab steps,
// no 1-block jumps ... stone bricks, slabs and stairs ... cobble as a fallback, plus edging and verges ... tie them into the existing
// paths records"; "lamp posts along the roads, paths and town walls: fence-post or log posts with lanterns").
// Design: docs/reports/roads-design-2026-11-09.md (Claude + Codex + an independent Claude, reconciled).
//
// PURE: the switch, the traffic file's routes, the ground scan, the local router, the road's cells (cross-section, slab risers,
// verges, lamp posts), the siting of one instance and the record's front. Nothing here touches a bot or a file: sinks.mjs siteSink
// hands a `road` siting here when ROADS2 is on; skills.mjs buildSink sites, kits and builds it with the sink machinery every stone
// sink uses (buildproj.mjs records, slots and segment leases; buildrun.mjs runVisit).
//
// THE MODEL. The town's `road` sink record (plot `road`, the record that already holds R1) grows by INSTANCES; a road2 instance is
// <= ROADS.len centreline NODES of one ROUTE, continuing from the last instance of that route (its end state is in the instance's
// meta), so a road is built outward from the town in bounded phases. A ROUTE is the most-walked line from the town ring to a
// destination outside it, measured by the host (scripts/host/roadtraffic.py -> `roadtraffic-<home>.json` in the pool dir: the bots'
// bot.pos rows over 7 days); the bot routes the road ITSELF over the terrain, within ROADS.band of that line (routeRoad).
//
// THE ROAD (a cross-section per node, perpendicular to its direction): verge | edge | tread | tread | tread | edge | verge.
//   tread  stone bricks (a seeded accent pattern), cobblestone the fallback       edge   a flush kerb (cobbled deepslate ... cobble)
//   verge  the ground beside the kerb, filled to one below the road where it falls away (never a drop of 2 beside a road)
// FLUSH, NEVER RAISED (the spoke causeway was a jump on and off): each node's level L (the surface block's y) is within ROADS.fillMax
// above / ROADS.cutMax below every paved column's ground. GRADED IN HALF STEPS: a level changes by 1 at most, and only after
// ROADS.runMin rows at the old level; the first row of a new level is a BOTTOM SLAB row (ws type=bottom: a top-face click, townstyle
// orientAim), so every step a walker takes on the road is 0.5 -- the slope is at most 1:2 and nothing is ever a 1-block jump
// (roadInstance re-measures it over the finished cells: `grade`). A turn is a flat 5x5 corner (ROADS.turnFlat rows flat each side).
// LAMPS: a fence post or a log post (axis y; the route's seed), a lantern on it (a torch if no lantern), on the verge every
// ROADS.lampEvery rows, sides alternating -- lights along the whole route at night (15 - (6 along + 3 across + 1 up) = 5 at the darkest
// tread cell). One block high: its top face is below the eye of a bot on the road, so the lantern's top-face click is placeable.
// WHAT ENDS A ROAD: arriving at the destination; water (the road stops short: a bridge is bridges-01's); a reservation it cannot pass
// within the band; an unread column (the next siting tries again from the same end).

import { isLiquid, isPassable, isTreeish, replaceableCell, isFurniture } from './townplan.mjs'
import { solidFloor } from './buildsite.mjs'
import { fnv1a, rng } from './zigdesign.mjs'
import { CUTTABLE, CORE_NAMES, affordable, proveBuild, sinkWalkR } from './roadsbase.mjs'   // the fleet line: the sink pieces the road needs
/** What a road's cut may dig: the towers' natural terrain (sinks.mjs CUTTABLE) and the bots' own lumps on it (cobble, gravel, sand). */
// (built on first use: on the showcase line sinks.mjs imports this module, so its bindings are not ready while this one loads)
let ROAD_CUT_RE = null
const roadCut = n => (ROAD_CUT_RE ??= new RegExp(`${CUTTABLE.source}|^(cobblestone|cobbled_deepslate|mossy_cobblestone|gravel|sand|red_sand|coarse_dirt)$`)).test(n)
import { FENCES } from './roadsbase.mjs'

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const k2 = (x, z) => `${x},${z}`
const k3 = (x, y, z) => `${x},${y},${z}`
const kOf = a => `${a[0]},${a[1]},${a[2]}`
const wet = b => !!b && (isLiquid(b) || /waterlogged/.test(String(b.name ?? '')) || nm(b) === 'ice' || nm(b) === 'bubble_column')
const uniq = xs => [...new Set(xs.filter(Boolean))]

export const ROADS = Object.freeze({
  len: 16,            // centreline nodes an instance (its own bounded phase: ~200-300 cells)
  band: 12,           // the router stays within this (Chebyshev) of the route's traffic line
  ahead: 22,          // the router's goal: the line point this far (along the line) past the start's nearest point
  half: 2,            // the paved half-width: tread -1..1, edges +-2
  verge: 3,           // the verge's offset
  fillMax: 2,         // a paved column's ground at most this below L (a hole 3 deep has no stand for its bottom cell: sinkfix-02)
  cutMax: 2,          // natural ground dug above a paved column's surface
  litterMax: 8,       // ... and a pillar of the bots' own cobble on it (their scaffold: the road takes it down)
  vergeFill: 3,       // a verge raised by at most this (to L - 1)
  runMin: 2,          // rows at a level before it may change again (the slope 1:2; a riser never beside a riser)
  turnFlat: 3,        // rows at one level before a turn, and rows after it before the level may change (the 5x5 corner is flat)
  lampEvery: 12,      // rows between lamps (sides alternating: 24 a side)
  logsMax: 24,        // trunk cells an instance may fell
  scanUp: 24, scanDown: 16,
  maxPops: 120_000,   // the router's search bound
  staleMs: 14 * 24 * 60 * 60_000,   // a traffic file older than this is no traffic (the host refreshes it daily)
  instancesMax: 60,   // the record's instances (ROADS2): ~16 rows each, every route of the town
  segNodes: 4,        // nodes a build segment (chained: each segment after the one before it, as the proof builds them)
  minEnd: 3,          // a road blocked short of its goal builds its last stretch only when it is at least this many nodes
  startSpan: 14,      // the columns along the ring either side of the route's start a landing is looked for (a 2-wide gap in a wall)
  startOut: 24,       // ... and the columns out from the ring (past a path leg the town laid outside its wall, past its stock yard)
  proofRetries: 4,    // a route whose proof fails is routed again round the column the proof could not build (each retry one more)
  dropFill: 12,       // fill cells (a pit's bottom) a proof may leave out of one instance
  blockedMs: 3 * 24 * 60 * 60_000,   // a route blocked short of its goal is tried again from its end after this
  tailMerge: 6,       // a route within this many nodes past ROADS.len of its goal is finished in the same instance
  offLine: 0.5,       // a row's price per column off the traffic line
  turnCost: 8,        // a turn's price (straight runs; a corner is a 5x5 square)
})
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const rev = d => d ^ 1
const perp = d => [-DIRS[d][1], DIRS[d][0]]

/**
 * THE SWITCH -> bool. ROADS2=on|off; unset = on in the pools ROADS2_POOLS names (default 'showcase': the showcase first, the fleet after
 * its read). Off is the rollback: the road sink sites along the land plan's spokes exactly as before (road@1); a sited road2 instance's
 * cells stay protected and repaired (the record is unchanged). Pure.
 */
export function roadsOn (env = process.env, pool = '') {
  const v = String(env?.ROADS2 ?? '').trim().toLowerCase()
  if (v === 'on' || v === '1' || v === 'true') return true
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  // the FLEET line: every pool by default (the canary's code runs only on its pools, so the variant IS the rollout: paths' zigfleet-02)
  const pools = String(env?.ROADS2_POOLS ?? '*').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}
/** LAMPS-01 (the paths' and the wall's dress lamps as lantern posts): LAMPS2=on|off; unset = on in LAMPS2_POOLS (default 'showcase'). Pure. */
export function lampsOn (env = process.env, pool = '') {
  const v = String(env?.LAMPS2 ?? '').trim().toLowerCase()
  if (v === 'on' || v === '1' || v === 'true') return true
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  const pools = String(env?.LAMPS2_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}
/** The traffic file's name in the pool dir. */
export const trafficFile = hk => `roadtraffic-${hk}.json`

/**
 * THE ROUTES OF A TRAFFIC FILE -> { ok, why, routes: [{ id, to, kind, trips, median_s, start: [x, z], line: [[x, z]...], box }], at }.
 * Pure. Refuses a file that is not v1, older than ROADS.staleMs, or names no route; a route without a start and a line of >= 2 points
 * is dropped. Routes come most trips first (the host's order, re-sorted: ties by id).
 */
export function trafficRoutes (file, now = Date.now(), staleMs = ROADS.staleMs) {
  if (!file || typeof file !== 'object' || file.v !== 1) return { ok: false, why: 'no_file', routes: [] }
  const at = Date.parse(String(file.at ?? ''))
  if (!Number.isFinite(at)) return { ok: false, why: 'no_time', routes: [] }
  if (now - at > staleMs) return { ok: false, why: 'stale', routes: [], at }
  const pt = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
  const routes = (Array.isArray(file.routes) ? file.routes : [])
    .filter(r => r && typeof r.id === 'string' && pt(r.start) && Array.isArray(r.line) && r.line.length >= 2 && r.line.every(pt))
    .map(r => ({ id: r.id, to: String(r.to ?? r.id), kind: String(r.kind ?? '-'), trips: Number(r.trips) || 0, median_s: Number(r.median_s) || null, start: [Math.round(r.start[0]), Math.round(r.start[1])], line: r.line.map(p => [Math.round(p[0]), Math.round(p[1])]), box: Array.isArray(r.box) ? r.box.slice(0, 4) : null }))
    .sort((a, b) => b.trips - a.trips || (a.id < b.id ? -1 : 1))
  if (!routes.length) return { ok: false, why: 'no_routes', routes: [], at }
  return { ok: true, why: 'ok', routes, at, ring: Array.isArray(file.ring) ? file.ring : null, ext: Array.isArray(file.ext) ? file.ext : null }
}
/** The line's columns, every step 1 apart (8-connected Bresenham between its points). Pure. */
export function denseLine (line) {
  const out = []
  for (let i = 0; i < line.length; i++) {
    const [x1, z1] = line[i]
    if (!i) { out.push([x1, z1]); continue }
    let [x, z] = out[out.length - 1]
    while (x !== x1 || z !== z1) { x += Math.sign(x1 - x); z += Math.sign(z1 - z); out.push([x, z]) }
  }
  return out
}

// ---- the ground --------------------------------------------------------------------------------------------------------------------
const GROUNDISH = /^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mycelium|moss_block|stone|andesite|diorite|granite|tuff|deepslate|gravel|sand|red_sand|clay|mud|snow_block|calcite|sandstone|red_sandstone|dirt_path|cobblestone|cobbled_deepslate|mossy_cobblestone|packed_ice|terracotta|[a-z_]+_terracotta|[a-z_]*_ore|smooth_basalt|dripstone_block)$/
/**
 * A COLUMN FOR A ROAD -> { g, name, logs, leaves, plants } | { why }. Pure. From yHi down: air, plants and snow layers pass (a placement
 * replaces them), logs and leaves pass and are listed (the road fells a trunk in its own columns); the first other block is the ground
 * when it is a full-cube floor (solidFloor), else the column refuses: `liquid`, `tree` (a stem, bamboo, roots), `built` (furniture, a
 * torch, a partial block: someone's work), `unknown` (an unread cell: never a guess).
 */
/** The bots' own building blocks: a block of these with nothing under it is their scaffold (a pathfinder bridge, a floating beam). */
export const LITTER = /^(cobblestone|cobbled_deepslate|mossy_cobblestone|dirt|coarse_dirt|netherrack|gravel|sand|[a-z_]+_planks)$/
export function roadColumn (read, x, z, yHi, yLo) {
  const logs = [], leaves = [], litter = []
  for (let y = yHi; y >= yLo; y--) {
    const b = read(x, y, z)
    if (!b) return { why: 'unknown' }
    const n = nm(b)
    // FLOATING LITTER (the fleet's fields, measured board-b 11-09: cobblestone hanging 3-7 over the grass with air under it): a bot
    // material with an open cell under it is the pathfinder's scaffold, never the ground -- listed (the road clears what stands in its
    // head room) and passed
    if (LITTER.test(n)) { const u = read(x, y - 1, z); if (!u) return { why: 'unknown' }; if (nm(u) === 'air' || nm(u) === 'cave_air' || (isPassable(u) && !wet(u))) { litter.push({ y, name: n }); continue } }
    if (n === 'air' || n === 'cave_air' || replaceableCell(b)) continue
    if (wet(b)) return { why: 'liquid' }
    if (/_(log|wood)$/.test(n) && !/^stripped_/.test(n)) { logs.push({ y, name: n }); continue }
    if (/_leaves$/.test(n)) { leaves.push({ y, name: n }); continue }
    if (/_sapling$|^mangrove_propagule$/.test(n)) { leaves.push({ y, name: n, plant: true }); continue }
    if (/^mangrove_roots$|_stem$|^bamboo$/.test(n) || isTreeish(b)) return { why: 'tree' }
    if (isPassable(b) && !/torch|lantern|rail|_sign$|_button$|lever|_carpet$|_pressure_plate$|campfire/.test(n) && !isFurniture(b)) continue
    if (solidFloor(b)) return { g: y, name: n, logs, leaves, litter }
    return { why: 'built' }
  }
  return { why: 'no_ground' }
}

// ---- the style ---------------------------------------------------------------------------------------------------------------------
/** The kerb stones, best first (each only when the town can pay for it: sinks.mjs affordable), cobblestone always last. */
export const EDGE_STONES = Object.freeze(['cobbled_deepslate', 'deepslate_bricks', 'polished_andesite', 'mossy_cobblestone', 'andesite', 'tuff'])
/** The tread's accent stones (a pattern on the stone bricks). */
export const ACCENT_STONES = Object.freeze(['deepslate_bricks', 'mossy_stone_bricks', 'polished_andesite', 'cobbled_deepslate', 'andesite', 'tuff'])
export const LOGS = Object.freeze(['spruce_log', 'oak_log', 'birch_log', 'dark_oak_log', 'jungle_log', 'acacia_log', 'cherry_log', 'mangrove_log', 'pale_oak_log'])
export const SLABS = Object.freeze(['stone_brick_slab', 'cobblestone_slab'])
/**
 * A ROUTE'S STYLE from its seed (every instance of one road looks alike) -> { tread, accent, pattern, edge, lamp }. Pure.
 *   tread    stone_bricks when the town can pay for ~3 a row of a road (else cobblestone)
 *   pattern  plain | centre (an accent centre line) | bands (an accent band every 6 rows) | border (accent rows at the edges of a band)
 *   edge     the kerb: the first EDGE_STONES the town can pay for, in the seed's order, else cobblestone
 */
export function roadStyle2 (seed, { avail = {} } = {}) {
  const r = rng(seed)
  const pick = xs => xs[Math.floor(r() * xs.length) % xs.length]
  const ok = new Set(affordable(avail, 48))
  const tread = ok.has('stone_bricks') ? 'stone_bricks' : 'cobblestone'
  const acc = ACCENT_STONES.filter(n => affordable(avail, 16).includes(n))
  const pattern = pick(['plain', 'centre', 'bands', 'centre', 'bands'])
  const accent = acc.length && pattern !== 'plain' ? pick(acc) : null
  const edges = EDGE_STONES.filter(n => ok.has(n))
  const edge = edges.length ? edges[Math.floor(r() * Math.min(2, edges.length)) % edges.length] : 'cobblestone'
  // the lamp post: a fence or a log, one block, the lantern on it -- its top face at the eye height of a bot on the road (a two-high post's
  // top is above the eye: a top-face click is then on the face's closed side, no stand could place the lantern)
  // the FLEET line has no aimed click (townstyle): a log post's axis follows the clicked face -- fence posts only here
  pick(['fence', 'fence', 'log'])
  return { tread, accent, pattern: accent ? pattern : 'plain', edge, lamp: 'fence' }
}
/** A tread cell's tag under the style at chainage t, offset w -> 'tr' | 'acc'. Pure. */
export function treadTag (style, t, w) {
  if (!style?.accent || style.pattern === 'plain') return 'tr'
  if (style.pattern === 'centre') return w === 0 ? 'acc' : 'tr'
  if (style.pattern === 'bands') return ((t % 6) + 6) % 6 === 0 ? 'acc' : 'tr'
  return 'tr'
}

// ---- the local router ----------------------------------------------------------------------------------------------------------------
/**
 * THE CROSS-SECTION AT A NODE -> { ok, cost, why, cols: [{ x, z, w, g, gr }] } at level L, direction d. Pure (memoised by the caller's
 * `col`). Every paved column (w -2..2): read (`col`), not reserved (`guard`), its ground within fillMax below / cutMax above L, a cut
 * only through CUTTABLE terrain, no liquid at or beside it from below its ground to L + 3, its head room (L+1..L+3) passable once the
 * listed logs and leaves are felled; each verge column (w +-3): read, not reserved, dry, its ground at most vergeFill below L - 1.
 */
export function crossSection (read, col, guard, x, z, L, d, own = () => false) {
  const [px, pz] = perp(d)
  const cols = []
  let cost = 0
  for (let w = -ROADS.verge; w <= ROADS.verge; w++) {
    const cx = x + px * w, cz = z + pz * w
    const gr = col(cx, cz)
    const paved = Math.abs(w) <= ROADS.half
    if (gr.why) return { ok: false, why: gr.why }
    // another record's own cell column (`own`: the paths' columns -- their zones are open to a road, their cells never)
    if (own(cx, cz)) return { ok: false, why: 'path' }
    const g = gr.g
    const why = guard(cx, cz, Math.min(g, L) - 1, L + 4)
    if (why) return { ok: false, why: 'reserved' }
    if (paved) {
      if (L - g > ROADS.fillMax) return { ok: false, why: 'fill' }
      // a cut: natural ground at most cutMax deep, a stack of the bots' blocks on it (a pillar) at most litterMax more
      let natural = 0, stack = 0
      for (let y = g; y > L; y--) { const n = nm(read(cx, y, cz)); if (LITTER.test(n) && n !== 'dirt' && n !== 'gravel' && n !== 'sand') stack++; else if (n !== 'air' && n !== 'cave_air') natural++ }
      if (natural > ROADS.cutMax || stack > ROADS.litterMax) return { ok: false, why: 'cut' }
      // (the bots' ground is hollow in places -- 1-high tunnels under the turf: an air cell in the cut is nothing to dig)
      for (let y = g; y > L; y--) { const b = read(cx, y, cz); if (!b) return { ok: false, why: 'unknown' }; const n = nm(b); if (n !== 'air' && n !== 'cave_air' && !replaceableCell(b) && !roadCut(n)) return { ok: false, why: 'cut_kind' } }
      if (g > L && /^(sand|red_sand|gravel)$/.test(nm(read(cx, g + 1, cz)))) return { ok: false, why: 'gravity' }
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) for (let y = Math.min(g, L) - 1; y <= L + 3; y++) if (wet(read(cx + dx, y, cz + dz))) return { ok: false, why: 'liquid' }
      cost += Math.max(0, L - g) * 0.6 + natural * 0.8 + stack * 0.3 + (gr.logs.some(l => l.y > L && l.y <= L + 3) ? 4 : 0) + 0.1 * gr.leaves.length
    } else {
      if (L - 1 - g > ROADS.vergeFill) return { ok: false, why: 'verge_low' }
      if (wet(read(cx, g + 1, cz)) || wet(read(cx, g, cz))) return { ok: false, why: 'liquid' }
      cost += Math.max(0, L - 1 - g) * 0.3
    }
    cols.push({ x: cx, z: cz, w, g, gr })
  }
  return { ok: true, cost, cols }
}
/**
 * ROUTE THE ROAD'S NEXT NODES -> { ok, nodes: [{ x, z, L, d, s, t }], arrived, why, tally }. Pure over `read`. A Dijkstra over states
 * (x, z, L, d, s, t) -- s: rows at the current level (capped at turnFlat), t: rows since the last turn (capped) -- from `start` toward
 * the goal: the dense line's point ROADS.ahead past the start's nearest point (or the line's end: `arrived`), within ROADS.band of the
 * line, never into the town (`forbid`: the ring the road leaves). A move goes straight, or turns left/right when s >= turnFlat and
 * t >= turnFlat (corners never overlap); it keeps the level, or changes it by 1 when s >= runMin and
 * t >= turnFlat. Prices: 1 a row + the cross-section's earthwork + ROADS.offLine x the distance off the line + ROADS.turnCost a turn + 0.5 a
 * level change (a road follows the walked line and runs straight: earthwork is cheaper than a detour).
 * A goal state within 1 of the goal point ends the search; the path is cut to ROADS.len nodes. `tally` counts the refusals met (the
 * no-site row's reasons: liquid, reserved, fill, cut, unknown...).
 */
export function routeRoad (read, { line, start, guard = () => null, hy = 70, maxPops = ROADS.maxPops, ahead = ROADS.ahead, forbid = () => false, own = () => false } = {}) {
  const dense = denseLine(line)
  const yHi = hy + ROADS.scanUp, yLo = hy - ROADS.scanDown
  const cm = new Map()
  const col = (x, z) => { const k = k2(x, z); if (!cm.has(k)) cm.set(k, roadColumn(read, x, z, yHi, yLo)); return cm.get(k) }
  // the band: each column's Chebyshev distance to the line (only columns within ROADS.band)
  const band = new Map()
  for (const [lx, lz] of dense) for (let dx = -ROADS.band; dx <= ROADS.band; dx++) for (let dz = -ROADS.band; dz <= ROADS.band; dz++) {
    const k = k2(lx + dx, lz + dz), dd = Math.max(Math.abs(dx), Math.abs(dz))
    if (!band.has(k) || band.get(k) > dd) band.set(k, dd)
  }
  let j0 = 0, best = Infinity
  dense.forEach(([lx, lz], i) => { const dd = Math.max(Math.abs(lx - start.x), Math.abs(lz - start.z)); if (dd < best || (dd === best && i > j0)) { best = dd; j0 = i } })
  const jg = Math.min(dense.length - 1, j0 + ahead)
  const goal = dense[jg]
  const arrives = jg === dense.length - 1
  const tally = {}
  const xs = new Map()
  const cross = (x, z, L, d) => { const k = `${x},${z},${L},${d}`; if (!xs.has(k)) { const c = crossSection(read, col, guard, x, z, L, d, own); xs.set(k, c); if (!c.ok) tally[c.why] = (tally[c.why] ?? 0) + 1 } return xs.get(k) }
  // a corner: the 5x5 square round the turn node all at L (each column within the fill/cut limits: the cross-sections both ways cover it
  // but its four outer corners)
  const corner = (x, z, L, dIn, dOut) => {
    const a = cross(x, z, L, dIn), b = cross(x, z, L, dOut)
    if (!a.ok || !b.ok) return false
    for (const sx of [-2, 2]) for (const sz of [-2, 2]) {
      const gr = col(x + sx, z + sz)
      if (gr.why || own(x + sx, z + sz) || L - gr.g > ROADS.fillMax || gr.g - L > ROADS.cutMax + ROADS.litterMax || guard(x + sx, z + sz, Math.min(gr.g, L) - 1, L + 4)) return false
    }
    return true
  }
  const key = s => `${s.x},${s.z},${s.L},${s.d},${s.s},${s.t}`
  const dist = new Map(), prev = new Map()
  const heap = []
  const push = (c, s) => { heap.push([c, s]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p } }
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m } } return top }
  const s0 = { x: start.x, z: start.z, L: start.L, d: start.d, s: Math.min(ROADS.turnFlat + 1, start.s ?? ROADS.turnFlat + 1), t: Math.min(ROADS.turnFlat, start.t ?? ROADS.turnFlat) }
  dist.set(key(s0), 0); push(0, s0)
  let pops = 0, end = null, far = null, farD = Infinity
  const gd = s => Math.max(Math.abs(s.x - goal[0]), Math.abs(s.z - goal[1]))
  const atGoal = s => gd(s) <= 1
  while (heap.length && pops < maxPops) {
    const [c, s] = pop()
    if (c > (dist.get(key(s)) ?? Infinity)) continue
    pops++
    if (s !== s0 && atGoal(s)) { end = s; break }
    if (s !== s0 && gd(s) < farD) { farD = gd(s); far = s }
    for (const d of [s.d, ...[0, 1, 2, 3].filter(q => q !== s.d && q !== rev(s.d))]) {
      const turn = d !== s.d
      // a turn's 5x5 corner reaches 2 rows back: they are full rows of its level (s > turnFlat: the slab row, the level's first, is 3 back)
      if (turn && (s.s <= ROADS.turnFlat || s.t < ROADS.turnFlat)) continue
      const x = s.x + DIRS[d][0], z = s.z + DIRS[d][1]
      const bd = band.get(k2(x, z))
      if (bd == null || forbid(x, z)) continue
      for (const dL of [0, 1, -1]) {
        if (dL && (s.s < ROADS.runMin || s.t < ROADS.turnFlat || turn)) continue
        const L = s.L + dL
        const cs = cross(x, z, L, d)
        if (!cs.ok) continue
        if (turn && !corner(s.x, s.z, s.L, s.d, d)) continue
        const n = { x, z, L, d, s: dL ? 1 : Math.min(ROADS.turnFlat + 1, s.s + 1), t: turn ? 0 : Math.min(ROADS.turnFlat, s.t + 1) }
        const nc = c + 1 + cs.cost + ROADS.offLine * bd + (turn ? ROADS.turnCost : 0) + (dL ? 0.5 : 0)
        const kk = key(n)
        if (nc < (dist.get(kk) ?? Infinity)) { dist.set(kk, nc); prev.set(kk, s); push(nc, n) }
      }
    }
  }
  // no way to the goal: the road goes as far toward it as the ground lets it (the farthest state reached), and the route ENDS there --
  // `blocked` names the refusal met most (water: a bridge is bridges-01's; a reservation; earthwork beyond the limits)
  let blocked = null
  if (!end) {
    if (pops >= maxPops || !far) return { ok: false, why: pops >= maxPops ? 'pops' : 'no_route', tally, nodes: [], arrived: false }
    end = far
    blocked = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'no_route'
    // an unread column is no answer: the stretch stops there unblocked (the next siting, with the chunk loaded, goes on)
    if (blocked === 'unknown') blocked = null
  }
  const path = []
  for (let s = end; s && s !== s0; s = prev.get(key(s))) path.push(s)
  path.reverse()
  // a stretch of at most ROADS.len nodes -- all of it when only a few more would be left for a next instance
  const nodes = path.length <= ROADS.len + ROADS.tailMerge ? path.slice() : path.slice(0, ROADS.len)
  if (blocked && nodes.length < path.length) blocked = null   // the farthest reach is beyond this instance: the next one goes on
  if (blocked && nodes.length < ROADS.minEnd) return { ok: false, why: `blocked_${blocked}`, tally, nodes: [], arrived: false }
  return { ok: true, why: blocked ? `blocked_${blocked}` : 'ok', nodes, arrived: !blocked && arrives && nodes.length === path.length, blocked, tally, pops }
}

// ---- the instance's cells ------------------------------------------------------------------------------------------------------------
/**
 * THE PAVED COLUMNS of a run of nodes -> Map "x,z" -> { x, z, L, w, t } (w: the offset from the centre line, 0..2; t the chainage).
 * Pure. Each node's cross-section (w -2..2); a TURN node (its direction differs from the next node's) also covers its 5x5 square. A
 * column two nodes claim takes the higher level (the router keeps corners flat: they agree) and the smaller |w| (tread over kerb).
 */
export function pavedColumns (nodes, chain0 = 0) {
  const m = new Map()
  const claim = (x, z, L, w, t) => { const k = k2(x, z); const q = m.get(k); if (!q || L > q.L || (L === q.L && w < q.w)) m.set(k, { x, z, L, w, t }) }
  nodes.forEach((n, i) => {
    const [px, pz] = perp(n.d)
    for (let w = -ROADS.half; w <= ROADS.half; w++) claim(n.x + px * w, n.z + pz * w, n.L, Math.abs(w), chain0 + i)
    const nx = nodes[i + 1]
    if (nx && nx.d !== n.d) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) claim(n.x + dx, n.z + dz, n.L, Math.max(Math.abs(dx), Math.abs(dz)) === 2 ? 2 : 1, chain0 + i)
  })
  return m
}
/** The walking height of a paved column in half blocks (a full block's top 2L+2, a bottom slab's 2L+1). Pure. */
const hOf = (c, slab) => 2 * c.L + (slab ? 1 : 2)
/**
 * THE SLABS AND THE GRADE over paved columns (this instance's, with `tail`: the last rows of the road before it, and `land`: the
 * column the road starts from) -> { slab: Set "x,z", ok, bad }. Pure. A column is a SLAB when a 4-neighbouring paved column (or the
 * tail, or the landing) stands one level lower; the grade is OK when every two 4-neighbouring paved columns differ by at most one half
 * block in walking height (no step a walker must jump). `bad` names the first column that breaks it.
 */
export function gradeOf (paved, tail = [], land = null) {
  const all = new Map(paved)
  for (const q of tail) if (!all.has(k2(q.x, q.z))) all.set(k2(q.x, q.z), { ...q, tail: true })
  const slab = new Set()
  for (const [k, c] of paved) {
    for (const [dx, dz] of DIRS) {
      const o = all.get(k2(c.x + dx, c.z + dz))
      if (o && o.L === c.L - 1) { slab.add(k); break }
      if (!o && land && land.x === c.x + dx && land.z === c.z + dz && land.L === c.L - 1) { slab.add(k); break }
    }
  }
  for (const q of tail) if (q.slab) slab.add(k2(q.x, q.z))
  for (const [k, c] of paved) {
    for (const [dx, dz] of DIRS) {
      const ok2 = k2(c.x + dx, c.z + dz)
      const o = all.get(ok2)
      if (!o) continue
      if (Math.abs(hOf(c, slab.has(k)) - hOf(o, slab.has(ok2))) > 1) return { slab, ok: false, bad: [c.x, c.L, c.z] }
    }
  }
  return { slab, ok: true, bad: null }
}
/**
 * ONE ROAD INSTANCE from routed nodes -> { cells, clear, segments, palette, box, zones, approach, end, tail, lamps, ok, why }. Pure.
 * `prevEnd` the node the instance continues from ({ x, z, L, d, s, t, chain }), `tail` the previous instance's last paved rows,
 * `land` the landing column (the first instance: the ring-gap column it starts from), `col(x, z)` the ground scan (roadColumn),
 * `style` (roadStyle2), `lamp` (posts on), `read` the world (the clears' names), `guard` / `own` (the router's: a verge column beyond
 * its cross-sections -- an end cap, a corner's diagonal -- that either refuses is left as it is).
 * Cells (roles namespaced by the instance id): the surface (tread, accent, kerb; a SLAB row in slabs with ws type=bottom), the fill
 * under it (core: any solid, the bag's cobblestone first), the verge fill (to L - 1, its top cell dirt), the lamp posts (a fence or a
 * log, axis y; a lantern on it). Clears: logs and leaves over the paved and verge columns up to L + 3, and every cut (natural ground above L).
 * Segments: every ROADS.segNodes nodes' cells (`<id>-P<k>`, each after the one before), the lamps last (`<id>-PL`).
 */
export function roadInstance (id, nodes, { prevEnd = null, tail = [], land = null, col, style, lamp = true, read, chain0 = 0, guard = () => null, own = () => false } = {}) {
  const paved = pavedColumns(nodes, chain0)
  const gr = gradeOf(paved, tail, land)
  if (!gr.ok) return { ok: false, why: 'grade', bad: gr.bad }
  const roles = {}
  const role = (tag, names) => { const r = `${id}-${tag}`; roles[r] ??= names; return r }
  const rTread = role('tr', uniq([style.tread, 'cobblestone']))
  const rAcc = style.accent ? role('acc', uniq([style.accent, style.tread, 'cobblestone'])) : rTread
  const rEdge = role('ed', uniq([style.edge, 'cobblestone']))
  const rSlab = role('sl', SLABS.slice())
  const rCore = role('core', CORE_NAMES.slice())
  const cells = [], clear = [], clearK = new Set()
  const segOf = t => `${id}-P${Math.floor((t - chain0) / ROADS.segNodes)}`
  const addClear = (x, y, z, kind) => { const k = k3(x, y, z); if (clearK.has(k)) return; const b = read(x, y, z); const n = nm(b); if (!b || n === 'air' || n === 'cave_air') return; clearK.add(k); clear.push({ at: [x, y, z], kind, name: n }) }
  const taken = new Set()
  for (const [k, c] of paved) {
    const g = col(c.x, c.z)
    if (g.why) return { ok: false, why: `col_${g.why}` }
    const seg = segOf(c.t)
    for (let y = g.g + 1; y < c.L; y++) { cells.push({ at: [c.x, y, c.z], role: rCore, seg }); taken.add(k3(c.x, y, c.z)) }
    const slab = gr.slab.has(k)
    const tag = c.w === 2 ? rEdge : treadTag(style, c.t, c.w) === 'acc' ? rAcc : rTread
    cells.push({ at: [c.x, c.L, c.z], role: slab ? rSlab : tag, seg, ...(slab ? { ws: { type: 'bottom' } } : {}) })
    taken.add(k3(c.x, c.L, c.z))
    for (let y = g.g; y > c.L; y--) addClear(c.x, y, c.z, 'cut')
    for (const l of g.logs) if (l.y > c.L && l.y <= c.L + 3) addClear(c.x, l.y, c.z, 'tree')
    for (const l of g.litter ?? []) if (l.y > c.L && l.y <= c.L + 4) addClear(c.x, l.y, c.z, 'cut')
    for (const l of g.leaves) if (l.y > c.L && l.y <= c.L + 4) addClear(c.x, l.y, c.z, l.plant ? 'plant' : 'leaves')
  }
  // the verges: every column 4-beside the paved area (not paved) -- a ground lower than L - 1 is filled to L - 1 (dirt on top)
  const rVerge = role('vg', ['dirt', 'coarse_dirt', 'cobblestone', 'cobbled_deepslate'])
  const verge = new Map()
  for (const c of paved.values()) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const k = k2(c.x + dx, c.z + dz)
    if (paved.has(k) || tail.some(q => q.x === c.x + dx && q.z === c.z + dz)) continue
    const q = verge.get(k)
    if (!q || c.L > q.L) verge.set(k, { x: c.x + dx, z: c.z + dz, L: c.L, t: c.t })
  }
  // Codex r1 BLOCKER: a verge column is beyond the router's cross-sections at an end cap or a corner's diagonal -- it is validated here
  // as they are (another record's cell column, a reservation, the landing): such a column gets no fill, no clear and no lamp
  for (const [k, v] of [...verge]) {
    const g = col(v.x, v.z)
    if (g.why || own(v.x, v.z) || guard(v.x, v.z, Math.min(g.g, v.L) - 1, v.L + 4) || (land && land.x === v.x && land.z === v.z)) { verge.delete(k); continue }
    v.g = g.g
    const seg = segOf(v.t)
    if (g.g < v.L - 1) {
      for (let y = g.g + 1; y < v.L - 1; y++) cells.push({ at: [v.x, y, v.z], role: rCore, seg })
      cells.push({ at: [v.x, v.L - 1, v.z], role: rVerge, seg })
      v.g = v.L - 1
    }
    for (const l of g.logs) if (l.y > v.g && l.y <= v.L + 3) addClear(v.x, l.y, v.z, 'tree')
    for (const l of g.litter ?? []) if (l.y > v.g && l.y <= v.L + 3) addClear(v.x, l.y, v.z, 'cut')
  }
  // the lamp posts: on a verge column at every lampEvery-th row (chainage; the nearest row within 3 that takes one), sides alternating,
  // on a straight row (no turn within 2), the verge ground at L-1..L, the post's and the lantern's cells clear
  const lamps = []
  if (lamp) {
    const rPost = style.lamp === 'log' ? role('log', LOGS.slice()) : role('fence', FENCES.slice()), rLight = role('light', ['lantern', 'torch'])
    // each lamp's row: the chainage's every lampEvery-th (at lampEvery / 2), else the nearest row within 3 that takes a post
    const want = nodes.map((n, i) => chain0 + i).filter(t => ((t % ROADS.lampEvery) + ROADS.lampEvery) % ROADS.lampEvery === ROADS.lampEvery / 2)
    for (const t0 of want) {
      const i0 = t0 - chain0
      let done = false
      for (const o of [0, 1, -1, 2, -2, 3, -3]) {
        const i = i0 + o, n = nodes[i]
        if (!n || done) continue
        if (nodes.slice(Math.max(0, i - 2), i + 3).some(q => q.d !== n.d)) continue
        const side = Math.floor(t0 / ROADS.lampEvery) % 2 === 0 ? 1 : -1
        const [px, pz] = perp(n.d)
        for (const s of [side, -side]) {
          const v = verge.get(k2(n.x + px * s * ROADS.verge, n.z + pz * s * ROADS.verge))
          // the post's ground at L-1 or L: its top face below the eye of a bot on the road (L + 1 + 1.62), so the lantern is placeable
          if (!v || v.g == null || v.g < n.L - 1 || v.g > n.L) continue
          const post = [[v.x, v.g + 1, v.z]], light = [v.x, v.g + 2, v.z]
          if ([...post, light].some(c => { const b = read(...c); return taken.has(kOf(c)) || !b || !(nm(b) === 'air' || replaceableCell(b) || /_leaves$/.test(nm(b)) || clearK.has(kOf(c))) })) continue
          for (const c of [...post, light]) if (/_leaves$/.test(nm(read(...c)))) addClear(c[0], c[1], c[2], 'leaves')
          cells.push({ at: post[0], role: rPost, seg: `${id}-PL`, ...(style.lamp === 'log' ? { ws: { axis: 'y' } } : {}) }, { at: light, role: rLight, seg: `${id}-PL` })
          lamps.push(light)
          done = true
          break
        }
      }
    }
  }
  const logs = clear.filter(c => c.kind === 'tree').length
  if (logs > ROADS.logsMax) return { ok: false, why: 'logs_over_max' }
  // the segments: P0, P1, ... each after the one before (the proof builds them in that order from the road behind); the lamps last
  const ps = [...new Set(cells.map(c => c.seg))].filter(s => /-P\d+$/.test(s)).sort((a, b) => Number(a.split('-P')[1]) - Number(b.split('-P')[1]))
  const segments = ps.map((s, i) => ({ seg: s, deps: i ? [ps[i - 1]] : [] }))
  if (cells.some(c => c.seg === `${id}-PL`)) segments.push({ seg: `${id}-PL`, deps: ps.slice() })
  const xs = cells.map(c => c.at[0]), zs = cells.map(c => c.at[2])
  const box = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]
  // the zones: each node's own square (half + verge + 1), never the instance's box (a winding road would fence off a field)
  const R = ROADS.verge + 1
  const zones = nodes.map(n => ({ box: [n.x - R, -64, n.z - R, n.x + R, 320, n.z + R], why: `project:road:${id}` }))
  const last = nodes[nodes.length - 1]
  const lastRows = [...paved.values()].filter(c => c.t >= chain0 + nodes.length - 2).map(c => ({ x: c.x, z: c.z, L: c.L, slab: gr.slab.has(k2(c.x, c.z)) }))
  const approach = prevEnd ? [[prevEnd.x, prevEnd.L + 1, prevEnd.z]] : land ? [[land.x, land.L + 1, land.z]] : []
  return {
    ok: true, why: 'ok', cells, clear: clear.sort((a, b) => b.at[1] - a.at[1]), segments, palette: roles, box, zones, approach, lamps,
    end: { x: last.x, z: last.z, L: last.L, d: last.d, s: last.s, t: last.t, chain: chain0 + nodes.length - 1 }, tail: lastRows,
    slabs: gr.slab.size, len: nodes.length,
  }
}

// ---- siting one instance -------------------------------------------------------------------------------------------------------------
/** A record's road2 instances of one route, oldest first. Pure. */
export const routeInstances = (rec, route) => (Array.isArray(rec?.instances) ? rec.instances : []).filter(i => i?.design?.kind === 'road2' && i.route === route)
/** Has a route ended? An instance of it ARRIVED; or its last instance was BLOCKED less than ROADS.blockedMs ago (the ground changes:
 *  the keeper grades, a tree is felled -- the road tries again from where it stopped). Pure. */
export function routeEnded (rec, route, now = Date.now()) {
  const ins = routeInstances(rec, route)
  if (ins.some(i => i.ended === 'arrived')) return true
  const last = ins[ins.length - 1]
  return !!last?.ended && now - (Number(last.sitedAt) || 0) < ROADS.blockedMs
}
/** The road record's slab floors (every road2 cell with ws type=bottom) -> Set "x,y,z": the walk's floors (buildsite walkFrom `floors`). Pure. */
export const roadFloors = rec => new Set((rec?.cells ?? []).filter(c => c?.ws?.type === 'bottom' && Array.isArray(c.at)).map(c => kOf(c.at)))
/**
 * THE FIRST NODE OF A ROUTE -> { ok, start: { x, z, L, d, s, t }, land: { x, z, L } } | { ok: false, why }. Pure. The route's start
 * column (the first column outside the town, the host's), up to ROADS.startSpan columns along the ring either side of it and up to ROADS.startOut
 * out, nearest first: the
 * road leaves the town straight out of the ring side it is on (d), from a LANDING column one back toward the town that is walkable
 * ground, not reserved (`landOk(x, z)`: no wall cell, no record), dry -- the road's first row at the landing's level (a flat join).
 */
export function routeStart (read, route, opts = {}) { const all = routeStarts(read, route, { ...opts, max: 1 }); return all.ok ? { ok: true, start: all.starts[0].start, land: all.starts[0].land } : all }
/** Every start a route may take (routeStart's candidates, nearest first, at most `max`) -> { ok, starts: [{ start, land }] } | { ok: false, why }. Pure. */
export function routeStarts (read, route, { ring = null, guard = () => null, hy = 70, landOk = () => true, own = () => false, max = 6 } = {}) {
  const [sx, sz] = route.start
  // the side of the ring the start is on -> the road's first direction (outward)
  let d
  if (Array.isArray(ring) && ring.length === 4) d = sx > ring[2] ? 0 : sx < ring[0] ? 1 : sz > ring[3] ? 2 : sz < ring[1] ? 3 : null
  if (d == null) { const n1 = route.line[1] ?? route.line[0]; const ux = n1[0] - sx, uz = n1[1] - sz; d = Math.abs(ux) >= Math.abs(uz) ? (ux >= 0 ? 0 : 1) : (uz >= 0 ? 2 : 3) }
  const [px, pz] = perp(d)
  const yHi = hy + ROADS.scanUp, yLo = hy - ROADS.scanDown
  const tried = {}, found = []
  // along the ring (o) nearest first, and out from it (out 0..startOut: a road's 7-wide cross-section clears the wall's own zone a
  // column or two out, its landing then on the open ground in front of the gap -- or past the end of a path the town already laid
  // out there: the road continues it)
  const cand = []
  for (let out = 0; out <= ROADS.startOut; out++) for (const o of [0, ...Array.from({ length: ROADS.startSpan }, (_, i) => [i + 1, -(i + 1)]).flat()]) cand.push([o, out])
  cand.sort((a, b) => Math.abs(a[0]) + a[1] - (Math.abs(b[0]) + b[1]))
  for (const [o, out] of cand) {
    const x = sx + px * o + DIRS[d][0] * out, z = sz + pz * o + DIRS[d][1] * out
    const lx = x - DIRS[d][0], lz = z - DIRS[d][1]
    const lg = roadColumn(read, lx, lz, yHi, yLo)
    if (lg.why) { tried[lg.why] = (tried[lg.why] ?? 0) + 1; continue }
    if (!landOk(lx, lz)) { tried.land = (tried.land ?? 0) + 1; continue }
    const L = lg.g
    // the landing is walked on: its feet and head cells open now (a leaf or a log there is no stand: the proof's walk would end short)
    if (![1, 2].every(dy => { const b = read(lx, L + dy, lz); return !!b && isPassable(b) && !wet(b) })) { tried.land_head = (tried.land_head ?? 0) + 1; continue }
    const cs = crossSection(read, (a, b) => roadColumn(read, a, b, yHi, yLo), guard, x, z, L, d, own)
    if (!cs.ok) { tried[cs.why] = (tried[cs.why] ?? 0) + 1; continue }
    found.push({ start: { x, z, L, d, s: ROADS.turnFlat + 1, t: ROADS.turnFlat }, land: { x: lx, z: lz, L } })
    if (found.length >= max) break
  }
  if (found.length) return { ok: true, starts: found }
  return { ok: false, why: `no_start:${Object.entries(tried).map(([k, v]) => `${k}${v}`).join('+')}` }
}
/**
 * SITE THE NEXT ROAD2 INSTANCE -> { ok, inst, meta, tried, proofs } | { ok: false, why, tried }. Pure over `read`. ctx: id, n, home,
 * pool, avail, guard, rec (the road record so far), routes (trafficRoutes), ring (the town ring for the first direction), landOk,
 * stood, walkR, lamp. The routes most-walked first; a route that ended is skipped. Its next instance: from its last instance's end
 * (or its start: routeStart), routed (routeRoad), laid out (roadInstance), proven (sinks.mjs proveBuild: the town walk reaches its
 * approach -- the road behind it, with the road's slab rows as floors -- and every cell has a step in order). A route the router cannot
 * continue at all ENDS: the instance-less end is recorded by the caller's no-site row; a route whose router stopped short of the goal
 * (water, a reservation) builds what it routed and is ENDED by that instance (`ended`: its why).
 */
export function siteRoad2 (read, ctx = {}) {
  const { id, n = 1, home, pool = '', avail = {}, guard = () => null, rec = null, routes = [], ring = null, landOk = () => true, stood = [], lamp = true, own = () => false } = ctx
  const tried = []
  let proofs = 0
  for (const route of routes) {
    if (routeEnded(rec, route.id, ctx.now ?? Date.now())) { tried.push(`${route.id}:ended`); continue }
    const done = routeInstances(rec, route.id)
    const last = done[done.length - 1] ?? null
    let starts
    if (last) starts = [{ start: { ...last.end }, land: null }]
    else {
      const st = routeStarts(read, route, { ring: typeof ctx.ringFor === 'function' ? ctx.ringFor(route.start) : ring, guard, hy: home.y, landOk, own })
      if (!st.ok) { tried.push(`${route.id}:${st.why}`); continue }
      starts = st.starts
    }
    const towns = (typeof ctx.townBoxes === 'function' ? ctx.townBoxes() : ctx.townBoxes) ?? []
    const forbid = (x, z) => towns.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])
    const seed = fnv1a(`road2|${pool}|${home.x},${home.y},${home.z}|${route.id}`)
    const style = last?.design?.style ?? roadStyle2(seed, { avail })
    const yHi = home.y + ROADS.scanUp, yLo = home.y - ROADS.scanDown
    const cm = new Map()
    const col = (x, z) => { const k = k2(x, z); if (!cm.has(k)) cm.set(k, roadColumn(read, x, z, yHi, yLo)); return cm.get(k) }
    const chain0 = last ? Number(last.end?.chain ?? 0) + 1 : 0
    // THE PROOF LOOP: route, lay out, prove; a cell the proof cannot build (a hole's bottom no stand reaches, a hollow) is a column the
    // next routing goes round (`bad`: reserved to the router), at most ROADS.proofRetries times
    const bad = new Set()
    const g2 = (x, z, y0, y1) => (bad.has(k2(x, z)) ? 'proof' : guard(x, z, y0, y1))
    let r = null, inst = null, pr = null, start = null, land = null
    // the first instance tries the route's starts in turn (a landing whose road cannot leave it is the next one's turn)
    for (const sc of starts) {
    start = sc.start; land = sc.land; r = null; inst = null; pr = null; bad.clear()
    for (let a = 0; a <= ROADS.proofRetries; a++) {
      r = routeRoad(read, { line: route.line, start, guard: g2, hy: home.y, forbid, own })
      if (!r.ok || !r.nodes.length) break
      inst = roadInstance(id, r.nodes, { prevEnd: last ? last.end : null, tail: last?.tail ?? [], land, col, style, lamp, read, chain0, guard: g2, own })
      if (!inst.ok) break
      // the proof: the town walk (the road's slab rows floors) reaches the approach; every cell has a step, segment by segment
      const floors = new Set([...roadFloors(rec), ...inst.cells.filter(c => c.ws?.type === 'bottom').map(c => kOf(c.at))])
      const walkR = Math.max(ctx.walkR ?? 0, sinkWalkR(inst.cells, home))
      const b = inst.box
      proofs++
      pr = proveBuild(read, home, inst, { stood, walkR, approach: inst.approach, domain: (x, z) => x >= b[0] - 6 && x <= b[2] + 6 && z >= b[1] - 6 && z <= b[3] + 6, localR: 28, floors })
      // a FILL cell no stand reaches (the bottom of a narrow pit) is left out: the surface over it stands on its neighbours' sides,
      // the hollow under a road is harmless (ROADS.dropFill a instance) -- then proven again with the same route
      for (let dropped = 0; !pr.ok && pr.why === 'no_step' && dropped < ROADS.dropFill; dropped++) {
        const m = /first (\S+)@(-?\d+),(-?\d+),(-?\d+)/.exec(String(pr.detail ?? ''))
        if (!m) break
        const k = `${m[2]},${m[3]},${m[4]}`
        // ...and a LAMP no stand can finish is left out whole (its log, fence and lantern: a lamp is an ornament, never the road)
        const lampRole = new RegExp(`^${id}-(log|fence|light)$`)
        if (lampRole.test(m[1])) inst = { ...inst, cells: inst.cells.filter(c => !(lampRole.test(c.role) && c.at[0] === Number(m[2]) && c.at[2] === Number(m[4]))), lamps: inst.lamps.filter(l => !(l[0] === Number(m[2]) && l[2] === Number(m[4]))) }
        else if (m[1] === `${id}-core`) inst = { ...inst, cells: inst.cells.filter(c => kOf(c.at) !== k), dropped: [...(inst.dropped ?? []), k] }
        else break
        inst.segments = inst.segments.filter(sg => inst.cells.some(c => c.seg === sg.seg)).map(sg => ({ ...sg, deps: sg.deps.filter(d => inst.cells.some(c => c.seg === d)) }))
        proofs++
        pr = proveBuild(read, home, inst, { stood, walkR, approach: inst.approach, domain: (x, z) => x >= b[0] - 6 && x <= b[2] + 6 && z >= b[1] - 6 && z <= b[3] + 6, localR: 28, floors })
      }
      if (pr.ok || pr.why === 'unreachable') break
      const at = /@(-?\d+),(-?\d+),(-?\d+)/.exec(String(pr.detail ?? ''))
      if (!at) break
      bad.add(k2(Number(at[1]), Number(at[3])))
    }
    if (r?.ok && r.nodes.length && inst?.ok && pr?.ok) break
    }
    if (!r.ok || !r.nodes.length) { tried.push(`${route.id}:${r.why}:${Object.entries(r.tally ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}${v}`).join('+')}`); continue }
    if (!inst?.ok) { tried.push(`${route.id}:${inst?.why ?? 'layout'}`); continue }
    if (!pr?.ok) { tried.push(`${route.id}:proof_${pr?.why}:${String(pr?.detail ?? '').replace(/\s+/g, '_').slice(0, 40)}`); continue }
    tried.push(`${route.id}:ok${bad.size ? `:round${bad.size}` : ''}`)
    // the route ENDS with this instance when it arrived, or when the router could not reach its goal within ROADS.len nodes because
    // the way on is refused (the path came up short of ROADS.len and short of the goal)
    const ended = r.arrived ? 'arrived' : r.blocked ? `blocked_${r.blocked}` : null
    const design = { kind: 'road2', route: route.id, k: done.length, style }
    const meta = {
      id, n, kind: 'road', route: route.id, k: done.length, seed, design, summary: `${route.id.slice(0, 20)}/k${done.length}/${style.pattern}/${style.tread}/${style.edge}${lamp ? '/lamps' : ''}`,
      box: inst.box, zones: inst.zones, end: inst.end, tail: inst.tail, path: r.nodes.map(q => [q.x, q.z, q.L]), approach: inst.approach, len: inst.len, slabs: inst.slabs, lamps: inst.lamps.length,
      ...(land ? { front: [[land.x, land.z]], land } : {}), ...(ended ? { ended } : {}), trips: route.trips,
    }
    return { ok: true, inst, meta, tried, proofs }
  }
  return { ok: false, why: 'no_site', tried, proofs }
}
/** The road record's FRONT (the paths' destination: paths.mjs pathDests reads a record's `front`): the landing columns of its routes'
 *  first instances. Pure. */
export const roadFront = rec => (Array.isArray(rec?.instances) ? rec.instances : []).filter(i => i?.design?.kind === 'road2' && Array.isArray(i.front)).flatMap(i => i.front)
/** Every ended route of a record -> { route: why }. Pure. */
export const endedRoutes = (rec, now = Date.now()) => Object.fromEntries([...new Set((Array.isArray(rec?.instances) ? rec.instances : []).filter(i => i?.design?.kind === 'road2').map(i => i.route))].filter(r => routeEnded(rec, r, now)).map(r => [r, true]))
/**
 * THE KIT A ROAD VISIT CRAFTS (skills.mjs roadKit) -> { slab, fence, lantern, log }: what the open cells of the record still owe in the
 * bag-made roles, less what the bag holds. Pure. `open(c)` -> the cell is not done; `held` the bag.
 */
export function roadKitNeed (rec, open, held = {}) {
  const owe = { slab: 0, fence: 0, lantern: 0 }
  for (const c of rec?.cells ?? []) {
    if (!open(c)) continue
    if (/-sl$/.test(c.role)) owe.slab++
    else if (/-fence$/.test(c.role) && /^R\d+-/.test(c.role)) owe.fence++
    else if (/-light$/.test(c.role) && /^R\d+-/.test(c.role)) owe.lantern++
  }
  const has = re => Object.entries(held).filter(([k]) => re.test(k)).reduce((t, [, v]) => t + (Number(v) || 0), 0)
  return {
    slab: Math.max(0, owe.slab - has(/^(stone_brick|cobblestone)_slab$/)),
    fence: Math.max(0, owe.fence - has(/_fence$/)),
    lantern: Math.max(0, owe.lantern - has(/^lantern$/) - has(/^torch$/)),
    owe,
  }
}
