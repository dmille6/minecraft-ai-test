// WALL-01: THE TOWN WALL (owner showcase list 10-29, item 2: house-01 -> paths-01 -> wall-01). PURE: the switch, the ring, the
// cross-section, the openings, the record and the escape proof. Nothing here touches a bot or a file.
//
// WHAT IT IS: a cobblestone RAMPART round the town's plan area, laid on a rectangle MARGIN columns outside everything the town has
// built or planned (the plan's core, storehouse, workshop and their cells, the well, the farm, every project's record and the laid
// paths) -- except a ziggurat (and the path legs that lead to one): a monument stands OUTSIDE, and where the ring runs into its
// reservation (record box + PROJECT_GAP) the wall simply stops, so the wall MEETS it and the ziggurat closes that corner. The
// record is written ONCE at siting and is deterministic: the same ground, plan and records give the same cells.
//
// THE CROSS-SECTION (outside -> inside), on a base level b per ring column:
//   O   the wall: cobblestone from its ground up to b+3, and a MERLON at b+4 on every other column and at each run's ends
//   S2  the wall walk: cobblestone up to b+2 (feet at b+3)
//   S1  the fire-step: cobblestone up to b+1 (feet at b+2)
// WHY THE STEPS: a builder places onto a face it looks at FROM ITS FRONT (buildsite.mjs stepFor: the eye above a top face), and a
// ground eye is at b+2.62 -- it can top out a column at b+2 and no higher. The fire-step and the walk are the builders' own
// stands for the wall's upper course (from S2, eye b+4.62: the b+3 course and the merlons), exactly as a house's step ring is
// for its roof. They also make the wall one-way passable: from inside, a bot can climb fire-step -> walk -> crenel and drop 3 to
// the outside ground; from outside the wall is 3-4 high (no way in but the openings).
// b follows the TERRAIN: b0 is the highest ground of the column's three cells, and b is the upper 1-Lipschitz envelope of b0
// along each run (the walk steps by at most 1, so it is walkable end to end and the top is a clean staircase on a slope).
//
// THE OPENINGS (a wall must never trap a bot or cut a town off from its trees and mines):
//   GATEWAYS   where a laid path or a planned path spoke crosses the ring (the paths record's zones = its columns + 1, so a
//              2-wide path makes a 4-wide gateway), flanked by stone-brick POSTS (b+1..b+4) with a torch on each post's inner
//              face at the walk's head height when the town can spare the torches at siting
//   SALLY PORTS  owner Q7 (10-23, building-tier design): "gaps every 12" -- no solid run is longer than RUN_MAX columns; a longer
//              run is split by GAP-wide openings, evenly spaced, each nudged to the flattest ground nearby and never across a corner
//   NATURAL    water (owner 10-27: never a water bridge -- the wall stops at it and a bot swims through), a protected zone, a
//              well, the farm, another project's reservation, a cliff the wall cannot stand on (taller than TALL_MAX)
// The measured showcase (10-30, 5,094 surface crossings of the ring line by the bots in 3.5 days) has no corridor: the bots
// leave town on every side, which is Q7's reason.
//
// THE RECORD (project-<home>.wall): cells (roles wall, step, post, light, base), clear (leaves, plants and field tables in each
// column up to its top + 2; a TRUNK standing in a column is felled whole -- its connected logs, no replant owed: the monument's
// rule), segments W-<nn> one per run (no deps), zones (every record column + 1), cols (each O column's state: the picture and
// the read), builders_max 4.

import { pathColumn, pathAvoid } from './paths.mjs'

export const WALL_PLOT = 'wall'
export const WALL_BLUEPRINT = 'wall@1'
export const WALL_BUILDERS = 4
/** The cross-section and the ring (see the header). RUN_MAX and GAP are owner Q7's. */
export const WALL = Object.freeze({ margin: 6, marginMax: 9, body: 3, runMax: 12, runMin: 5, gap: 2, tallMax: 7, dy: 14, logMax: 48, clearUp: 2 })
/** THE PALETTE: the body, the steps and a foundation are cobblestone (mossy counts as built); a post is stone bricks where the town
 *  has them, else cobblestone; a light is a torch. */
export const WALL_PALETTE = Object.freeze({
  wall: ['cobblestone', 'mossy_cobblestone'],
  step: ['cobblestone', 'mossy_cobblestone'],
  base: ['cobblestone', 'mossy_cobblestone'],
  post: ['stone_bricks', 'cobblestone'],
  light: ['torch'],
})
/** Ground the wall is never set on: dug out and replaced by a cobblestone foundation (`base`). */
export const WALL_SOFT = /^(sand|red_sand|suspicious_sand|gravel|suspicious_gravel|clay|mud|snow_block|powder_snow|packed_ice|blue_ice|soul_sand|soul_soil|moss_block|dirt_path|farmland)$/
/** What a visit may dig out of an open record cell (buildrun.mjs `foreign`): terrain, the soft ground a foundation replaces, the
 *  plants a placement does not replace, a stray torch, and the pathfinder's scaffold (logs and leaves are TREE_CLEAR). */
export const WALL_FOREIGN = /^(cobblestone|mossy_cobblestone|dirt|coarse_dirt|grass_block|podzol|rooted_dirt|mycelium|moss_block|stone|andesite|diorite|granite|tuff|netherrack|cobbled_deepslate|deepslate|gravel|suspicious_gravel|sand|red_sand|suspicious_sand|clay|mud|snow_block|powder_snow|packed_ice|blue_ice|soul_sand|soul_soil|calcite|dripstone_block|smooth_basalt|dirt_path|farmland|[a-z_]+_sapling|mangrove_propagule|brown_mushroom|red_mushroom|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|sunflower|lilac|rose_bush|peony|sweet_berry_bush|bush|firefly_bush|leaf_litter|wildflowers|pink_petals|moss_carpet|short_dry_grass|tall_dry_grass|torchflower|cactus_flower|pitcher_plant|snow|torch|wall_torch|[a-z_]+_planks|sandstone|red_sandstone)$/
/** The siting's price of each margin column past WALL.margin (a looser ring encloses forest, not town). */
export const WALL_LOOSE = 10
/** A clear's one-call bound (buildrun.mjs `clearMax`): a forest line's leaves leave the rest of the visit for the segments. */
export const WALL_CLEAR_MAX = 60

/**
 * THE SWITCH -> bool. WALL=on|off; unset = on in the pools WALL_POOLS names. zigfleet-02 (the fleet rollout): the default is '*',
 * every pool; WALL=off or WALL_POOLS=showcase is the rollback. Before zigfleet-02 (default 'showcase'): the fleet's towns kept their
 * project list until the fleet rollout. Pure.
 */
export function wallOn (env = process.env, pool = '') {
  const v = String(env?.WALL ?? '').toLowerCase()
  if (v === 'on' || v === '1' || v === 'true') return true
  if (v === 'off' || v === '0' || v === 'false') return false
  const pools = String(env?.WALL_POOLS ?? '*').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const LOG = /_(log|wood)$/
const k2 = (x, z) => `${x},${z}`

// ---- the enclosure ----------------------------------------------------------------------------------------------------------

/**
 * WHAT THE WALL ENCLOSES -> [x0, z0, x1, z1] | null. Pure. The plan's boxed plots (core, storehouse, workshop) and every plan cell
 * and station, the well caps (+ 2: their footprint) and plinth cells, the composter, the tree farm, and every project record's
 * columns -- except a ZIGGURAT's (`zig(rec)`) and the paths' cells of a leg that leads to one (the road out to the monument).
 */
export function wallInside ({ plan = null, caps = [], plinth = [], composter = null, farm = [], records = [], zig = () => false } = {}) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  const add = (x, z) => { if (!Number.isFinite(x) || !Number.isFinite(z)) return; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
  for (const p of plan?.plots ?? []) {
    if (p.keepout && Array.isArray(p.box)) { add(p.box[0], p.box[1]); add(p.box[2], p.box[3]) }
    for (const c of [...(p.cells ?? []), ...(p.stations ?? [])]) if (Array.isArray(c?.at)) add(c.at[0], c.at[2])
  }
  for (const c of caps) { add(c[0] - 2, c[2] - 2); add(c[0] + 2, c[2] + 2) }
  for (const c of plinth) add(c[0], c[2])
  if (composter) add(composter[0], composter[2])
  for (const [x, z] of farm) add(x, z)
  const zigPlots = new Set(records.filter(r => r?.rec && zig(r.rec)).map(r => r.plot))
  for (const r of records) {
    if (!r?.rec || zig(r.rec)) continue
    // a paths record: the cells of a leg whose destination is a ziggurat stay outside (the road out through a gateway)
    const out = new Set((r.rec.legs ?? []).filter(l => zigPlots.has(l.to)).map(l => l.id))
    for (const c of r.rec.cells ?? []) {
      const leg = /^P-(.+)-\d+$/.exec(String(c.seg ?? ''))?.[1]
      if (leg && out.has(leg)) continue
      add(c.at[0], c.at[2])
    }
  }
  return Number.isFinite(x0) ? [x0, z0, x1, z1] : null
}

/**
 * THE RING round a box at margin m -> [{ x, z, i, out: [[dx, dz]] }] in loop order: the north side west to east, the east side
 * north to south, the south side east to west, the west side south to north (a corner once, with both outward normals). Pure.
 */
export function ringLoop ([bx0, bz0, bx1, bz1], m) {
  const x0 = bx0 - m, z0 = bz0 - m, x1 = bx1 + m, z1 = bz1 + m
  const out = []
  const push = (x, z) => {
    const o = []
    if (z === z0) o.push([0, -1])
    if (x === x1) o.push([1, 0])
    if (z === z1) o.push([0, 1])
    if (x === x0) o.push([-1, 0])
    out.push({ x, z, i: out.length, out: o })
  }
  for (let x = x0; x < x1; x++) push(x, z0)
  for (let z = z0; z < z1; z++) push(x1, z)
  for (let x = x1; x > x0; x--) push(x, z1)
  for (let z = z1; z > z0; z--) push(x0, z)
  return out
}
/** An O column's terrace partners: S2 (k = 1) and S1 (k = 2) -> [[x, z]] (a corner's is the inner corner, diagonal). Pure. */
export const terraceAt = (c, k) => {
  const dx = c.out.reduce((t, o) => t + o[0], 0), dz = c.out.reduce((t, o) => t + o[1], 0)
  return [c.x - dx * k, c.z - dz * k]
}

// ---- the siting --------------------------------------------------------------------------------------------------------------

/**
 * ONE CANDIDATE RING at margin m -> { ok, why, cols, cells, clear, ... } (see siteWall). Pure over `read`.
 *   avoid(x, z)    -> reason | null: the plan, protected zones, wells, the farm (paths.mjs pathAvoid)
 *   pzones         other projects' reservations [{ box: [x0,y0,z0,x1,y1,z1], why }] (shop.mjs recordZones): `project:paths` is a
 *                  GATEWAY (the wall opens where a path crosses), any other a plain gap (the wall meets that project)
 *   spokes         the plan's planned path segments [[x0, z0, x1, z1]]: + 1, a gateway too
 */
export function wallCandidate (read, inside, m, { home, avoid = () => null, pzones = [], spokes = [], lights = 0, join = null, scanMemo = null, seed = null, column = pathColumn } = {}) {
  const loop = ringLoop(inside, m)
  // wallext-01: a memo shared between candidates over the same ground (wallExtSite tries several rectangles)
  const col = scanMemo ?? new Map()
  const scan = (x, z) => {
    const k = k2(x, z)
    if (!col.has(k)) col.set(k, column(read, x, z, { yHi: home.y + WALL.dy, yLo: home.y - WALL.dy }))
    return col.get(k)
  }
  const reason = (x, z) => {
    const a = avoid(x, z)
    if (a) return { s: 'gap', why: a }
    for (const sg of spokes) if (x >= sg[0] - 1 && x <= sg[2] + 1 && z >= sg[1] - 1 && z <= sg[3] + 1) return { s: 'gate', why: 'spoke' }
    for (const zb of pzones) {
      const b = zb?.box ?? zb
      // groundskeeper-01: a land plan road's corridor (landplan.mjs, `land:road`) is a gateway too: the wall opens where it crosses
      if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return String(zb?.why ?? '') === 'project:paths' ? { s: 'gate', why: 'path' } : String(zb?.why ?? '') === 'land:road' ? { s: 'gate', why: 'road' } : { s: 'gap', why: String(zb?.why ?? 'project') }
    }
    return null
  }
  // 1. each O column's state from its own column and its two terrace columns: a gateway wins over a gap (the path goes through)
  const unknown = []
  for (const c of loop) {
    const three = [[c.x, c.z], terraceAt(c, 1), terraceAt(c, 2)]
    let st = null
    // wallext-01: a JOIN column (the side an extension shares with the wall it extends: that wall's own line) is never built here
    // -- the old wall stands on it where it stands, and where it is open the two interiors are one
    const jw = join ? join(c.x, c.z) : null
    if (jw) { c.s = 'join'; c.why = String(jw); continue }
    for (const [x, z] of three) {
      const r = reason(x, z)
      if (r && (!st || (r.s === 'gate' && st.s !== 'gate'))) st = r
    }
    if (!st) {
      for (const [x, z] of three) {
        const g = scan(x, z)
        if (g.why === 'unknown') { unknown.push(k2(x, z)); st = { s: 'gap', why: 'unknown' }; break }
        if (g.why) { st = { s: 'gap', why: g.why }; break }
      }
      // A PIT: the column's own ground more than 2 under the highest of its three (a hole dug at the line)
      if (!st) { const gs = three.map(([x, z]) => scan(x, z).y); if (Math.max(...gs) - gs[0] > 2) st = { s: 'gap', why: 'pit' } }
    }
    c.s = st ? st.s : 'wall'
    c.why = st ? st.why : null
    if (c.s === 'wall') c.g = [scan(c.x, c.z).y, scan(...terraceAt(c, 1)).y, scan(...terraceAt(c, 2)).y]
  }
  if (unknown.length) return { ok: false, why: 'unknown', unknown: unknown.slice(0, 8), m }
  const n = loop.length
  const runsOf = () => {
    // the runs of `wall` columns, cyclic: started after a non-wall column (or at 0 when the whole ring is wall)
    const start = loop.findIndex(c => c.s !== 'wall')
    const runs = []
    if (start < 0) return [loop.map((_, i) => i)]
    let cur = null
    for (let j = 1; j <= n; j++) {
      const i = (start + j) % n
      if (loop[i].s === 'wall') { (cur ??= []).push(i) } else if (cur) { runs.push(cur); cur = null }
    }
    if (cur) runs.push(cur)
    return runs
  }
  // 2. the base level: the upper 1-Lipschitz envelope of the highest ground of the three cells, per run; a column the envelope
  //    makes too tall (a ravine, a pit) becomes a gap and the runs are re-measured
  for (let pass = 0; pass < 12; pass++) {
    let changed = false
    for (const run of runsOf()) {
      const b0 = run.map(i => Math.max(...loop[i].g))
      for (let a = 0; a < run.length; a++) {
        let b = -Infinity
        for (let j = 0; j < run.length; j++) b = Math.max(b, b0[j] - Math.abs(a - j))
        loop[run[a]].b = b
      }
      for (const i of run) {
        const c = loop[i]
        if (c.b + WALL.body - c.g[0] > WALL.tallMax || c.b + 2 - c.g[1] > WALL.tallMax - 2 || c.b + 1 - c.g[2] > WALL.tallMax - 3) { c.s = 'gap'; c.why = 'tall'; changed = true }
      }
    }
    if (!changed) break
  }
  // 3. Q7's sally ports: a run longer than RUN_MAX is split by GAP-wide openings, evenly spaced, each moved (within 3) to the
  //    flattest ground and never onto a corner or a column next to one
  const corner = i => loop[i].out.length > 1
  const rough = i => {
    const a = loop[i], b = loop[(i + 1) % n]
    return Math.abs(a.g[0] - b.g[0]) + Math.abs(a.g[0] - a.g[2]) + Math.abs(b.g[0] - b.g[2])
  }
  let ports = 0
  // a ring with no opening at all is first opened at the middle of its north side (a run must have two ends)
  if (loop.every(c => c.s === 'wall')) {
    const mid = Math.floor(loop.findIndex((c, i) => i > 0 && c.out.length > 1) / 2)
    for (let e = 0; e < WALL.gap; e++) { loop[mid + e].s = 'open'; loop[mid + e].why = 'q7' }
    ports++
  }
  for (const run of runsOf()) {
    const L = run.length
    // GREEDY from the run's start: each piece as long as Q7 allows (RUN_MAX), shortened (never below RUN_MIN) to land the opening on
    // the flattest ground and off a corner; the remainder keeps RUN_MIN too. A run with no legal place left keeps its length
    let start = 0
    while (L - start > WALL.runMax) {
      let best = null, bs = Infinity
      for (const allowCorner of [false, true]) {
        for (let a = start + WALL.runMax; a >= start + WALL.runMin; a--) {
          if (a + WALL.gap > L - WALL.runMin) continue
          const idx = Array.from({ length: WALL.gap }, (_, e) => run[a + e])
          if (!allowCorner && idx.some(i => corner(i) || corner((i + 1) % n) || corner((i - 1 + n) % n))) continue
          const sc = idx.slice(0, -1).reduce((q, i) => q + rough(i), 0) + (start + WALL.runMax - a) * 0.3
          if (sc < bs) { bs = sc; best = a }
        }
        if (best != null) break
      }
      if (best == null) break
      for (let e = 0; e < WALL.gap; e++) { loop[run[best + e]].s = 'open'; loop[run[best + e]].why = 'q7' }
      start = best + WALL.gap
      ports++
    }
  }
  // 4-5 run in PASSES: built, then proven REACHABLE (wallReach: every cell has a stand the builders' walk reaches on the finished
  // wall), a column that fails made a gap and the cells built again
  const build = () => {
    // 4. posts flank the gateways; merlons on every other column and at each run's ends
    const isWall = i => loop[i].s === 'wall' || loop[i].s === 'post'
    for (let i = 0; i < n; i++) {
      if (loop[i].s !== 'wall') continue
      if (loop[(i + 1) % n].s === 'gate' || loop[(i - 1 + n) % n].s === 'gate') loop[i].s = 'post'
    }
    const wallRuns = () => {
      const out = []
      const start = loop.findIndex(c => !isWall(c.i))
      let cur = null
      for (let j = 1; j <= n; j++) {
        const i = ((start < 0 ? 0 : start) + j) % n
        if (isWall(i)) (cur ??= []).push(i); else if (cur) { out.push(cur); cur = null }
      }
      if (cur) out.push(cur)
      return out
    }
    // a run shorter than RUN_MIN has no wall walk behind it to build its upper course from: it stays open
    for (const run of wallRuns()) if (run.length < WALL.runMin) for (const i of run) { loop[i].s = 'open'; loop[i].why = 'short' }
    const runs = wallRuns()
    const oAt = new Map(loop.map(c => [k2(c.x, c.z), c]))
    const inner = { 1: ringLoop(inside, m - 1), 2: ringLoop(inside, m - 2), 3: ringLoop(inside, m - 3) }
    // 5. the cells, column by column, a segment per run; the clears of every column the record builds in
    const cells = [], clear = [], seen = new Set(), segments = [], used = new Map()
    const logsSeen = new Set()
    let trunks = 0, logN = 0, posts = 0, lightN = 0
    // THE CLEARS of a record column -- and of its LANE (lane = true: the 8 columns round it; offline on the showcase 10-30 a spruce
    // canopy beside the line hid every wall cell in it from every stand: leaves no clear listed, the segment `blocked` for good, and
    // a blocked segment ends every visit): leaves, a field table and a trunk there (felled whole); plants only in the column itself
    const addClears = (x, z, hi, lane = false) => {
      const c = scan(x, z)
      if (c.why || c.y == null) return
      let tree = false
      for (const a of c.above) {
        if (a.y < c.y + 1 || a.y > hi) continue
        if (a.kind === 'tree') { tree = true; continue }
        if (lane && a.kind === 'plant') continue
        if (a.kind === 'float') continue                          // wallext-01: a floating spoil block is no clear (extColumn)
        const k = `${x},${a.y},${z}`
        if (seen.has(k)) continue
        seen.add(k); clear.push({ at: [x, a.y, z], kind: a.kind, name: a.name })
      }
      if (!tree) return
      // A TRUNK in the column: felled whole -- the logs connected to the column's own (26-neighbours), at most WALL.logMax
      const start = c.above.filter(a => a.kind === 'tree' && a.y >= c.y + 1 && a.y <= hi).map(a => [x, a.y, z])
      const q = [...start], got = new Map(start.map(p => [p.join(','), p]))
      for (let h = 0; h < q.length && got.size <= WALL.logMax; h++) {
        const [px, py, pz] = q[h]
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const p = [px + dx, py + dy, pz + dz], key = p.join(',')
          if (got.has(key) || p[1] < home.y - WALL.dy) continue
        // never across a boundary (Codex r1 BLOCK): a log in a protected zone, the plan, a well, the farm or another project's
        // reservation is never felled -- the tree is cut at its edge (a path's zone, a gateway, is no such boundary)
        const rr = (p[0] !== x || p[2] !== z) ? reason(p[0], p[2]) : null
        if (rr && rr.s !== 'gate') continue
          const b = read(...p)
          if (b && LOG.test(nm(b))) { got.set(key, p); q.push(p) }
        }
      }
      const logs = got.size <= WALL.logMax ? [...got.values()] : start
      if (!logs.some(p => !logsSeen.has(p.join(',')))) return
      trunks++
      for (const p of logs) {
        const key = p.join(',')
        if (logsSeen.has(key)) continue
        logsSeen.add(key); seen.add(key); logN++
        clear.push({ at: p, kind: 'tree', name: nm(read(...p)) })
      }
    }
    const colCells = (x, z, top, role, seg, { topRole = null, from = null } = {}) => {
      const k = k2(x, z)
      if (used.has(k)) return
      const c = scan(x, z)
      used.set(k, seg)
      if (WALL_SOFT.test(c.name)) cells.push({ at: [x, c.y, z], role: 'base', seg })
      for (let y = (from ?? c.y + 1); y <= top; y++) cells.push({ at: [x, y, z], role: y === top && topRole ? topRole : role, seg })
      addClears(x, z, top + WALL.clearUp)
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue
        const r = reason(x + dx, z + dz)
        if (r && r.s !== 'gate') continue                         // never a zone's, a plan's or another project's column
        addClears(x + dx, z + dz, top + WALL.clearUp, true)
      }
    }
    runs.forEach((run, r) => {
      const seg = `W-${String(r).padStart(2, '0')}`
      segments.push({ seg, deps: [] })
      run.forEach((i, a) => {
        const c = loop[i]
        const end = a === 0 || a === run.length - 1
        const merlon = end || i % 2 === 0
        if (c.s === 'post') {
          posts++
          colCells(c.x, c.z, c.b + 4, 'wall', seg)
          // the post's own course: b+1..b+4 stone bricks (below b+1 the wall's cobblestone, as everywhere)
          for (const cell of cells) if (cell.at[0] === c.x && cell.at[2] === c.z && cell.at[1] >= c.b + 1 && cell.role === 'wall') cell.role = 'post'
        } else colCells(c.x, c.z, c.b + WALL.body + (merlon ? 1 : 0), 'wall', seg)
      })
      // THE TERRACE: the walk S2 on the ring one in, the fire-step S1 on the ring two in. A terrace column is built when every O
      // column within Chebyshev k of it is a wall column of THIS run (so an opening flares inward: 2 wide in the wall, 4 at the
      // walk, 6 at the fire-step -- never a step left standing in an opening), and its own ground is sound; its level is the
      // highest b of those O columns
      // THE APPROACH (k = 3, offline on the showcase 10-30: a dug pit just inside the fire-step left the terrace unreachable from the
      // town, and the wall's upper course had no stand): where the ground just inside the fire-step lies BELOW b, a step at b (one
      // under the fire-step's top) is laid there too, from that ground up -- never more than 3 cells
      const inRun = new Set(run.map(i => k2(loop[i].x, loop[i].z)))
      for (const k of [1, 2, 3]) {
        for (const s of inner[k]) {
          let b = -Infinity, all = true, any = false
          for (let dx = -k; dx <= k && all; dx++) for (let dz = -k; dz <= k && all; dz++) {
            const o = oAt.get(k2(s.x + dx, s.z + dz))
            if (!o) continue
            if (!inRun.has(k2(o.x, o.z))) { all = false; break }
            any = true; b = Math.max(b, o.b)
          }
          if (!all || !any || reason(s.x, s.z)) continue
          const g = scan(s.x, s.z)
          const top = b + ({ 1: 2, 2: 1, 3: 0 })[k]
          if (g.why || g.y > top) continue
          if (k === 3 && (g.y === top || top - g.y > 3)) continue
          colCells(s.x, s.z, top, 'step', seg)
        }
      }
      // a light on each post's inner face, at the wall walk's head height, when the town can spare them (`lights`)
      for (const i of run) {
        const c = loop[i]
        if (c.s !== 'post') continue
        // the walk's column beside the post is OPEN (the opening flares inward): the torch hangs on the post's inner face there,
        // placed from the walk one column along; its cell holds nothing but what a clear takes
        const [x, z] = terraceAt(c, 1)
        if (lightN >= lights || cells.some(q => q.at[0] === x && q.at[2] === z)) continue
        const sc = scan(x, z)
        if (sc.why || sc.y >= c.b + 4) continue
        const at = [x, c.b + 4, z]
        const there = sc.above.find(a => a.y === at[1])
        if (there && there.kind === 'tree') continue
        if (there && !seen.has(at.join(','))) { seen.add(at.join(',')); clear.push({ at, kind: there.kind, name: there.name }) }
        cells.push({ at, role: 'light', seg: WALL_LIGHT_SEG })
        lightN++
      }
    })
    return { cells, clear, segments, used, trunks, logN, posts, lightN, runs }
  }
  let B = null
  for (let pass = 0; ; pass++) {
    B = build()
    const bad = pass < WALL_REACH_PASSES ? wallReach(read, home, B, loop, seed) : []
    if (!bad.length) break
    for (const i of bad) { loop[i].s = 'gap'; loop[i].why = 'reach' }
  }
  const { cells, clear, segments, used, trunks, logN, posts, lightN } = B
  if (cells.some(c => c.role === 'light')) segments.push({ seg: WALL_LIGHT_SEG, deps: [] })
  if (!cells.length) return { ok: false, why: 'no_wall', m, cols: loop }
  // zones: every record column + 1 (a box would be the whole town)
  const colsUsed = [...used.keys()].map(k => k.split(',').map(Number))
  const zset = new Set()
  for (const [x, z] of colsUsed) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) zset.add(k2(x + dx, z + dz))
  const bom = {}
  for (const c of cells) { const b = WALL_PALETTE[c.role][0]; bom[b] = (bom[b] ?? 0) + 1 }
  const count = s => loop.filter(c => c.s === s).length
  const gates = []
  for (let i = 0; i < n; i++) {
    if (loop[i].s !== 'gate' || loop[(i - 1 + n) % n].s === 'gate') continue
    const g = []
    for (let j = i; loop[j % n].s === 'gate' && g.length < n; j++) g.push([loop[j % n].x, loop[j % n].z])
    gates.push({ cols: g, why: loop[i].why })
  }
  const earth = cells.length - (count('wall') + count('post')) * 4.5 - colsUsed.length
  const cost = trunks * 6 + logN * 0.3 + clear.length * 0.15 + Math.max(0, earth) * 0.1 + cells.length * 0.01 + loop.filter(c => c.s === 'gap' && !['project', 'zone'].some(w => String(c.why).startsWith(w)) && !String(c.why).startsWith('project:')).length * 1
  return {
    ok: true, why: 'ok', m, cols: loop, cells, clear: clear.sort((a, b) => a.at[1] - b.at[1]), segments, zones: zoneBoxes(zset),
    bom, gates, ports, posts, lights: lightN, trunks, logs: logN, cost: Math.round(cost * 10) / 10,
    counts: { wall: count('wall'), post: count('post'), gate: count('gate'), open: count('open'), gap: count('gap'), ...(count('join') ? { join: count('join') } : {}), ring: n },
  }
}
/** Passes of the reach proof before a ring is taken as it stands (each pass makes the failing columns gaps). */
export const WALL_REACH_PASSES = 4
/**
 * THE REACH PROOF -> [loop index] the O columns whose cells have no stand. Pure over `read`. The finished wall (every cell built,
 * every clear dug), the builders' stand walk from home (walkSet, a drop of one); a cell is reachable when a walked feet cell within
 * Chebyshev 3 (never its own column) stands no lower than one under it -- an eye above its support's top face, as stepFor asks.
 * A light (a torch on a post's side) is placed from a side face and is not judged. A failing O column is returned; a failing
 * terrace cell returns the O columns of its run within Chebyshev 3 of it.
 */
export function wallReach (read, home, B, loop, seed = null) {
  const solid = new Set(B.cells.filter(c => c.role !== 'light').map(c => c.at.join(',')))
  const air = new Set(B.clear.map(c => c.at.join(',')))
  const SOLID = { name: 'cobblestone', boundingBox: 'block' }, AIRB = { name: 'air', boundingBox: 'empty' }
  const fin = (x, y, z) => { const k = `${x},${y},${z}`; return solid.has(k) ? SOLID : air.has(k) ? AIRB : read(x, y, z) }
  const r = Math.max(...loop.map(c => Math.max(Math.abs(c.x - home.x), Math.abs(c.z - home.z)))) + 8
  const nodes = new Map()
  for (const k of walkSet(fin, home, r, { seed })) { const [x, y, z] = k.split(',').map(Number); const kk = k2(x, z); if (!nodes.has(kk)) nodes.set(kk, []); nodes.get(kk).push(y) }
  const ok = c => {
    const [x, y, z] = c.at
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      if (!dx && !dz) continue
      if ((nodes.get(k2(x + dx, z + dz)) ?? []).some(ny => ny >= y - 1 && ny <= y + 3)) return true
    }
    return false
  }
  const oIdx = new Map(loop.map(c => [k2(c.x, c.z), c.i]))
  const segRun = new Map(B.runs.map((run, q) => [`W-${String(q).padStart(2, '0')}`, run]))
  const bad = new Set()
  for (const c of B.cells) {
    if (c.role === 'light' || ok(c)) continue
    const o = oIdx.get(k2(c.at[0], c.at[2]))
    if (o != null) { bad.add(o); continue }
    for (const i of segRun.get(c.seg) ?? []) if (Math.max(Math.abs(loop[i].x - c.at[0]), Math.abs(loop[i].z - c.at[2])) <= 3) bad.add(i)
  }
  return [...bad]
}
/** "x,z" keys -> merged siting zones [{ box: [x0,y0,z0,x1,y1,z1], why: 'project:wall' }] (row runs, merged over equal spans). Pure. */
export function zoneBoxes (keys) {
  const rows = new Map()
  for (const k of keys) { const [x, z] = k.split(',').map(Number); if (!rows.has(z)) rows.set(z, []); rows.get(z).push(x) }
  const runs = []
  for (const z of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = rows.get(z).sort((a, b) => a - b)
    for (let i = 0; i < xs.length;) { let j = i; while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++; runs.push([xs[i], z, xs[j]]); i = j + 1 }
  }
  const boxes = []
  for (const [xa, z, xb] of runs) {
    const b = boxes.find(q => q[0] === xa && q[2] === xb && q[3] === z - 1)
    if (b) b[3] = z; else boxes.push([xa, z, xb, z])
  }
  return boxes.map(([xa, za, xb, zb]) => ({ box: [xa, -64, za, xb, 320, zb], why: `project:${WALL_PLOT}` }))
}

/**
 * THE SITING -> { ok, why, record, cand, inside }. Pure over `read`. The bot's own (skills.mjs buildWall) and the offline proof's
 * (scripts/wall-offline.mjs).
 *   plan       the town plan head's body (+ gen): its boxed plots and cells are inside, its planned path spokes are gateways
 *   zones      protected zones; caps (well caps), plinth (cells), composter, farm (tree-farm columns)
 *   records    [{ plot, rec }] every OTHER project's record; `pzones` their reservations (shop.mjs recordZones)
 *   zig(rec)   is a record a ziggurat (it and its road stay outside; the wall meets its reservation)
 *   lights     how many torches the town can spare (one per post at most)
 * Every margin from WALL.margin to WALL.marginMax is tried; the cheapest candidate (trunks felled, clears, earthwork, natural gaps)
 * that ALSO passes the escape proof (wallEscape: nothing reachable from home today is cut off) is the record.
 */
export function siteWall (read, { plan, zones = [], caps = [], plinth = [], composter = null, farm = [], records = [], pzones = [], zig = () => false, lights = 0, now = Date.now() } = {}) {
  const home = plan?.home
  if (!home) return { ok: false, why: 'no_plan', record: null }
  const inside = wallInside({ plan, caps, plinth, composter, farm, records, zig })
  if (!inside) return { ok: false, why: 'nothing_inside', record: null }
  const avoid = pathAvoid({ plan, zones, caps, plinth, composter, farm, records: [], home })
  const spokes = (plan.paths ?? []).map(p => p.seg).filter(Array.isArray)
  const tried = []
  let best = null
  for (let m = WALL.margin; m <= WALL.marginMax; m++) {
    const c = wallCandidate(read, inside, m, { home, avoid, pzones, spokes, lights })
    tried.push({ m, ok: c.ok, why: c.why, cost: c.cost ?? null })
    if (!c.ok) { if (c.why === 'unknown') return { ok: false, why: 'unknown', record: null, tried, unknown: c.unknown, inside }; continue }
    const R0 = Math.max(...c.cols.map(q => Math.max(Math.abs(q.x - home.x), Math.abs(q.z - home.z))))
    const esc = wallEscape(read, home, c.cells, { r: R0 + 14, near: R0 + 6 })
    Object.assign(tried[tried.length - 1], { cut: esc.cut, trapped: esc.trapped, pits: esc.pits })
    if (esc.cut > 0 || esc.trapped > 0) continue
    // a TIGHT ring reads as the town's wall (and is shorter): each margin column past the first costs WALL_LOOSE
    const cost = Math.round((c.cost + esc.pits * 2 + (m - WALL.margin) * WALL_LOOSE) * 10) / 10
    tried[tried.length - 1].cost = cost
    if (!best || cost < best.cost) best = { ...c, cost, escape: esc }
  }
  if (!best) return { ok: false, why: `no_ring:${tried.map(t => `m${t.m}:${t.ok ? `cut${t.cut}/trap${t.trapped}` : t.why}`).join(',')}`, record: null, tried, inside }
  const record = {
    v: 1, blueprint: WALL_BLUEPRINT, plot: WALL_PLOT, home: { x: home.x, y: home.y, z: home.z },
    ring: [inside[0] - best.m, inside[1] - best.m, inside[2] + best.m, inside[3] + best.m], inside, margin: best.m,
    cols: best.cols.map(c => ({ x: c.x, z: c.z, s: c.s, ...(c.why ? { why: c.why } : {}), ...(Number.isFinite(c.b) && (c.s === 'wall' || c.s === 'post') ? { b: c.b } : {}) })),
    gates: best.gates, counts: best.counts, ports: best.ports, posts: best.posts, lights: best.lights,
    cells: best.cells, clear: best.clear, replant: [], segments: best.segments, zones: best.zones,
    bom: best.bom, felled: { trunks: best.trunks, logs: best.logs }, escape: best.escape, builders_max: WALL_BUILDERS,
    structure_complete: false, plan: plan.gen != null ? { gen: plan.gen } : null, sitedAt: now,
  }
  return { ok: true, why: 'ok', record, tried, inside }
}

// ---- the escape proof --------------------------------------------------------------------------------------------------------

/**
 * NOTHING CUT OFF, NOBODY TRAPPED -> { cut, trapped, pits, lostStrict, under, canopy, cutAt, trapAt, reach0, reach1 }. Pure over
 * `read`. Two walks from home within Chebyshev `r`, on the world as it is and with every record cell built (solid), with the
 * PATHFINDER'S moves (mineflayer-pathfinder: 4 neighbours, a step up of one with head room, a drop of up to WALK_DROP):
 *   CUT      feet cells reached today and not with the wall built (outside the record's own cells), grouped (4 neighbours, a
 *            step of one): a group of more than PIT_MAX is a piece of the town or the land round it that the wall separates
 *   TRAPPED  feet cells the built world's walk reaches from home that cannot walk BACK to home (a reverse walk), and could before:
 *            a pen the wall makes -- a bot that drops in could not leave
 * A ring with either (outside `inner` of the boundary, `near`: the walk box's edge proves nothing) is never sited. Reported,
 * never refusals: a PIT (a group of PIT_MAX or fewer: a hole beside a terrace column, which a bot pillars or digs out of), an
 * UNDERGROUND cell (a roof of natural ground over it: the bots' own tunnels under the line, still dug out of), a CANOPY cell
 * (a floor of leaves or logs), and `lostStrict` -- the cells the builders' own stand walk (a drop of one) no longer reaches.
 */
export const PIT_MAX = 4
export const WALK_DROP = 3
export function wallEscape (read, home, cells, { r = 64, near = r - 6, seed = null } = {}) {
  const solid = new Set(cells.map(c => c.at.join(',')))
  const SOLID = { name: 'cobblestone', boundingBox: 'block' }
  const r1 = (x, y, z) => (solid.has(`${x},${y},${z}`) ? SOLID : read(x, y, z))
  const a = walkSet(read, home, r, { drops: WALK_DROP, seed }), b = walkSet(r1, home, r, { drops: WALK_DROP, seed })
  const inner = k => { const [x, , z] = k.split(',').map(Number); return Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) <= near }
  let under = 0, canopy = 0
  const judge = (set, rd) => {
    const keep = new Set()
    for (const k of set) {
      if (!inner(k)) continue
      const [x, y, z] = k.split(',').map(Number)
      if (solid.has(k) || solid.has(`${x},${y + 1},${z}`) || solid.has(`${x},${y - 1},${z}`)) continue
      if (/_leaves$|_log$|_wood$/.test(nm(rd(x, y - 1, z)))) { canopy++; continue }
      // UNDERGROUND: a pocket a walk no longer reaches is still dug out of (mining is never priced off natural ground)
      if (roofed(rd, x, y, z)) { under++; continue }
      keep.add(k)
    }
    return groupsOf(keep)
  }
  const lost = judge([...a].filter(k => !b.has(k)), read)
  // the reverse walks: who can get home, before and after
  const back0 = walkSet(read, home, r, { drops: WALK_DROP, reverse: true, seed }), back1 = walkSet(r1, home, r, { drops: WALK_DROP, reverse: true, seed })
  const pen = judge([...b].filter(k => !back1.has(k) && !(a.has(k) && !back0.has(k))), r1)
  const sa = walkSet(read, home, r, { seed }), sb = walkSet(r1, home, r, { seed })
  let lostStrict = 0
  for (const k of sa) if (!sb.has(k) && inner(k) && !solid.has(k)) lostStrict++
  const big = g => g.filter(q => q.length > PIT_MAX)
  const cutG = big(lost), trapG = big(pen)
  return {
    reach0: a.size, reach1: b.size, cut: cutG.flat().length, groups: cutG.length, cutAt: cutG.flat().slice(0, 20).map(k => k.split(',').map(Number)),
    trapped: trapG.flat().length, trapAt: trapG.flat().slice(0, 20).map(k => k.split(',').map(Number)),
    pits: lost.length - cutG.length + pen.length - trapG.length, pitCells: [...lost, ...pen].filter(g => g.length <= PIT_MAX).flat().slice(0, 20), under, canopy, lostStrict,
  }
}
/** Feet cells "x,y,z" -> their groups (4 neighbours, a step of one). Pure. */
function groupsOf (keys) {
  const seen = new Set(), groups = []
  for (const k of keys) {
    if (seen.has(k)) continue
    const q = [k], g = []
    seen.add(k)
    for (let h = 0; h < q.length; h++) {
      g.push(q[h])
      const [x, y, z] = q[h].split(',').map(Number)
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1]) {
        const n = `${x + dx},${y + dy},${z + dz}`
        if (keys.has(n) && !seen.has(n)) { seen.add(n); q.push(n) }
      }
    }
    groups.push(g)
  }
  return groups
}
/** A full natural block (not leaves or a log) within 12 above the head -> the cell is underground. Pure. */
function roofed (read, x, y, z) {
  for (let h = y + 2; h <= y + 13; h++) { const b = read(x, h, z); if (!b) return false; if (b.boundingBox === 'block' && !/_leaves$|_log$|_wood$/.test(nm(b))) return true }
  return false
}
const passable = b => !!b && b.boundingBox === 'empty' && !/water|lava|bubble_column/.test(nm(b))
const floorOk = b => !!b && b.boundingBox === 'block' && !/water|lava/.test(nm(b))
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
/** ONE STEP of the walk from a feet cell in a direction -> the feet cell it lands on | null: level, up one (head room above the
 *  start), or down (the body's two cells clear at the start level, then a free fall to the first floor, at most `drops`). Pure. */
function stepTo (read, node, x, y, z, dx, dz, drops) {
  const nx = x + dx, nz = z + dz
  if (node(nx, y, nz)) return [nx, y, nz]
  if (passable(read(x, y + 2, z)) && node(nx, y + 1, nz)) return [nx, y + 1, nz]
  if (!passable(read(nx, y + 1, nz)) || !passable(read(nx, y, nz))) return null
  for (let d = 1; d <= drops; d++) {
    if (node(nx, y - d, nz)) return [nx, y - d, nz]
    if (!passable(read(nx, y - d, nz))) return null
  }
  return null
}
/**
 * The feet cells a walk reaches from home within Chebyshev r -> Set "x,y,z". Pure. `drops` 1 is the builders' stand walk
 * (buildsite.mjs walkFrom), WALK_DROP the pathfinder's; `reverse` the cells from which home is reached.
 */
export function walkSet (read, home, r, { seed = null, drops = 1, reverse = false } = {}) {
  const node = (x, y, z) => floorOk(read(x, y - 1, z)) && passable(read(x, y, z)) && passable(read(x, y + 1, z))
  let start = seed
  for (let dy = 0; !start && dy <= 4; dy++) for (const y of [home.y + dy, home.y - dy]) if (!start && node(home.x, y, home.z)) start = [home.x, y, home.z]
  const seen = new Set()
  if (!start) return seen
  const q = [start]
  seen.add(start.join(','))
  const inR = (x, z) => Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) <= r
  for (let h = 0; h < q.length; h++) {
    const [x, y, z] = q[h]
    for (const [dx, dz] of DIRS4) {
      if (!reverse) {
        const n = stepTo(read, node, x, y, z, dx, dz, drops)
        if (!n || !inR(n[0], n[2])) continue
        const k = n.join(',')
        if (!seen.has(k)) { seen.add(k); q.push(n) }
        continue
      }
      // REVERSE: the cells u one column back whose own step in this direction lands here
      const ux = x - dx, uz = z - dz
      if (!inR(ux, uz)) continue
      for (let uy = y - 1; uy <= y + drops; uy++) {
        if (!node(ux, uy, uz)) continue
        const n = stepTo(read, node, ux, uy, uz, dx, dz, drops)
        if (!n || n[0] !== x || n[1] !== y || n[2] !== z) continue
        const k = `${ux},${uy},${uz}`
        if (!seen.has(k)) { seen.add(k); q.push([ux, uy, uz]) }
      }
    }
  }
  return seen
}

/** Sapling keep-out for a wall record: its columns + 1 (shop.mjs saplingAllowedAt reads `cols`) -> { cols } | null. Pure. */
export function wallSaplingCols (rec, margin = 1) {
  const cs = rec?.cells ?? []
  if (!cs.length) return null
  const cols = new Set()
  for (const c of cs) for (let dx = -margin; dx <= margin; dx++) for (let dz = -margin; dz <= margin; dz++) cols.add(k2(c.at[0] + dx, c.at[2] + dz))
  return { cols }
}
/** A wall record's walk radius (buildrun.mjs walkR): every cell's Chebyshev distance from home + 7, at least 48. Pure. */
export const wallWalkR = (rec, home) => Math.max(48, ...(rec?.cells ?? []).map(c => Math.max(Math.abs(c.at[0] - home.x), Math.abs(c.at[2] - home.z)) + 7))
/** The record's progress -> { done, open } from a `done(cell)` test. Pure. */
export function wallProgress (rec, done) {
  let d = 0, open = 0
  for (const c of rec?.cells ?? []) { if (done(c)) d++; else open++ }
  return { done: d, open }
}

/**
 * A BLOCKED SEGMENT WAITS, THE OTHERS GO ON (buildrun.mjs runVisit ends a visit `blocked` at the first segment with an open cell it
 * cannot clear -- a leaf no stand sees, a block nobody may dig -- and works the segments in the record's order, so on a 21-segment
 * ring one such cell would hold every visit of every builder on it). The visit is given the record with the segments this bot
 * found blocked in the last WALL_BLOCK_MS left out (never all of them: then the record as it is). Pure.
 *   blocked   Map seg -> when this bot's visit last stopped `blocked` on it
 */
export const WALL_BLOCK_MS = 30 * 60_000
export function wallVisitRecord (rec, blocked = new Map(), now = Date.now()) {
  const skip = new Set([...blocked].filter(([, at]) => now - at < WALL_BLOCK_MS).map(([s]) => s))
  if (!skip.size) return rec
  const segs = (rec.segments ?? []).filter(s => !skip.has(s.seg))
  return segs.length ? { ...rec, segments: segs } : rec
}
/** The segment a `blocked` stop names (runVisit's why: "<seg>: N open, M placeable now") -> seg | null. Pure. */
export const blockedSeg = (stop, why) => (stop === 'blocked' ? (/^([A-Za-z0-9-]+): \d+ open/.exec(String(why ?? ''))?.[1] ?? null) : null)

/**
 * THE WAIVER (wallstuck-01, LIVE showcase 10-30: the wall at 936 of 941, its last cells over ground the bots dug out after siting;
 * Gale's 23:17Z stuck stamp held every build order 6 h, and the wall would stall 6 h at a time for good). A cell THIS VISIT deferred
 * (runVisit `deferred`: after the footing and the sealed-column remedies were tried), counted WALL_WAIVE_AFTER deferring visits by
 * the F4 stuck map (summed over every builder), is WAIVED: the record names it (`waived`: { 'x,y,z': { why, at, by } }, a logged
 * row) and every completeness test counts it done, so the wall closes. Bounded: at most WALL_WAIVE_MAX cells a record, ever. A gap
 * is the wall's own kind of opening (gateways, sally ports): it can only add passage, so the escape proof (nothing reachable from
 * home is cut off) still holds. Pure. -> [{ k, why }] the cells to waive now.
 */
export const WALL_WAIVE_AFTER = 5
export const WALL_WAIVE_MAX = 12
export function wallWaiveDue (rec, deferred = [], { after = WALL_WAIVE_AFTER, max = WALL_WAIVE_MAX } = {}) {
  const cells = new Set((rec?.cells ?? []).filter(c => c.role !== 'light').map(c => c.at.join(',')))
  const have = rec?.waived ?? {}
  let room = max - Object.keys(have).length
  const out = []
  for (const d of deferred ?? []) {
    if (room <= 0) break
    const k = String(d?.k ?? '')
    if (!cells.has(k) || have[k] || out.some(o => o.k === k)) continue
    if ((Number(d?.visits) || 0) < after) continue
    out.push({ k, why: String(d?.why ?? 'no_stand').slice(0, 80) }); room--
  }
  return out
}
/** Is a record cell waived (the record's own list)? Pure. */
export const wallWaived = (rec, c) => !!rec?.waived && Object.prototype.hasOwnProperty.call(rec.waived, c.at.join(','))

/**
 * THE LIGHTS LAST (LIVE showcase 10-30 06:58Z: a builder with no torch stopped `no_material light_for_W-00` after 27 cells -- runVisit
 * ends a visit at a cell it has no block for, and works the segments in order, so the first run's torch held every later run): the
 * light cells in their own LAST segment WALL_LIGHT_SEG. Applied at siting and, in memory, to a record sited before (the record file
 * is unchanged; the shop read judges a cell, not its segment). -> the record (unchanged when already so). Pure.
 */
export const WALL_LIGHT_SEG = 'W-L'
export function wallLightsLast (rec) {
  if (!(rec?.cells ?? []).some(c => c.role === 'light' && c.seg !== WALL_LIGHT_SEG)) return rec
  const cells = rec.cells.map(c => (c.role === 'light' ? { ...c, seg: WALL_LIGHT_SEG } : c))
  const used = new Set(cells.map(c => c.seg))
  const segments = [...(rec.segments ?? []).filter(s => s.seg !== WALL_LIGHT_SEG && used.has(s.seg)), { seg: WALL_LIGHT_SEG, deps: [] }]
  return { ...rec, cells, segments }
}
/**
 * WHAT A VISIT DRAWS (LIVE 10-30: every visit drew `cobblestone:256` and never the torch -- shop.mjs needFromTown spends its cap on
 * the largest bill first, and the wall's cobblestone bill is ~900): the parts first (torches, stone bricks: a few each), then the
 * cobblestone with the cap that is left. -> { name: n }. Pure. `need(bill, bag, cap)` is shop.mjs needFromTown.
 */
export function wallNeed (bill = {}, spare = {}, need, cap) {
  const parts = Object.fromEntries(Object.entries(bill).filter(([n]) => n !== 'cobblestone'))
  const first = need(parts, spare, cap)
  const left = cap - Object.values(first).reduce((t, v) => t + v, 0)
  return { ...first, ...(bill.cobblestone && left > 0 ? need({ cobblestone: bill.cobblestone }, spare, left) : {}) }
}

// ================================================================================================================================
// WALLEXT-01: THE WALL EXTENSION (owner 11-04: "lets do A then extend the wall around the new building leaving room for additional
// buildings"; A = the storage hall, storehub.mjs, which the bots' own siting puts in the town ring OUTSIDE the wall). PURE.
//
// WHAT IT IS: a second ring of the SAME rampart (wallCandidate: the cross-section, the terrain-following base, the gateways where a
// path / spoke / land road crosses, Q7's sally ports, the reach proof, the escape proof) on a RECTANGLE that SHARES one side with
// the old wall's ring: the side facing the hall. That shared side is the old wall's own line; it is never built (JOIN columns:
// where the old wall stands on it, it stays; where it is open -- on the showcase 25 of the 31 columns between the ziggurat and the
// extension's far side are already gateway, sally port or gap -- the two interiors are one). So the old section is LEFT, not torn
// down: nothing is removed (no new dig rule), and the opening between old town and extension is the old line's own openings.
// The extension's other three sides meet whatever the old wall meets (a ziggurat's reservation closes a stretch, as on the old ring).
//
// WHAT IT ENCLOSES: the hall's box (its reservation stays outside every wall cell: PROJECT_GAP) and ROOM -- the rectangle is grown
// outward and along the line in WALLEXT steps, and each candidate is scored by the PLOTS its interior holds (wallExtPlots: free,
// dry, known, level-ish rectangles of hall size and house size, PLOT_GAP apart, clear of every reservation, road corridor, the hall
// and the wall's own lane). The smallest rectangle with the most plots (up to `plotsWant`) that the wall can stand on and that
// passes the escape proof is the record. The plots are written on the record (`plots`); the land plan reads them as reservations
// (landplan.mjs landReservation: `land:plot`), so the sinks, site prep, the dress and every other siting leave them free for the
// buildings to come, while the groundskeeper (whose own refusals never read the land plan's reservations) still tidies them.
// (landplan.mjs landPlotZones; the extension's record keeps them so the plots move with the record, never with the land plan.)
//
// THE RECORD (project-<home>.wallext): the wall record's shape (cells, clear, segments W-<nn> + W-L, zones, cols, gates, bom, escape)
// plus side, join { line, from, to, old }, ring (the rectangle), interior (inside the walls: the rectangle less its own line on
// three sides, up to AND INCLUDING the shared line), plots [{ id, kind, box, y }], hub { box }.
// ================================================================================================================================
export const WALLEXT_PLOT = 'wallext'
export const WALLEXT_BLUEPRINT = 'wallext@1'
/**
 * THE EXTENSION'S BOUNDS. margin: the hall's box to the ring (the old wall's least margin); grow: the steps the rectangle is widened
 * along the shared line on each side; growOut: the steps it is deepened outward; plotsWant: plots beyond which a bigger rectangle
 * buys nothing; plotGap: between two plots and between a plot and the hall's box (PROJECT_GAP); plotSpread: a plot's ground range;
 * lane: a plot's least distance from the ring's line (the walk, the fire-step, the approach and a lane); plotSizes: hall size
 * (storehub@1 19 x 11 and the copper hall 15 x 13 both fit 19 x 13) then house size (house@1 7 x 7 and its step ring); tries: the
 * candidates (best first by their plots, then the shortest ring) proven; builtMin: the least share of the ring's own (non-join)
 * columns that must stand as wall (a side that runs along a road corridor is all gateway: no wall at all).
 */
export const WALLEXT = Object.freeze({ margin: 6, grow: [0, 4, 8, 12, 16, 20, 24, 28], growOut: [0, 4, 8, 12, 16, 20, 24], plotsWant: 4, plotGap: 3, plotSpread: 4, lane: 5, plotSizes: Object.freeze([Object.freeze({ kind: 'hall', w: 19, d: 13 }), Object.freeze({ kind: 'house', w: 11, d: 11 })]), tries: 10, builtMin: 0.5 })
/** THE SWITCH -> bool. WALLEXT=on|off; unset = on in the pools WALLEXT_POOLS names (default the showcase). Pure. */
export function wallextOn (env = process.env, pool = '') {
  const v = String(env?.WALLEXT ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  const pools = String(env?.WALLEXT_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}
const validBox4 = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] >= b[0] && b[3] >= b[1]
/**
 * WHICH SIDE OF THE OLD RING THE HALL IS BEYOND -> 'N' | 'S' | 'W' | 'E' | null. Pure. North is -z. Null when the box touches or
 * lies inside the ring (nothing to extend), lies beyond a corner (two sides), or reaches past the ring's span along that side (an
 * extension's sides must meet the old line).
 */
export function extSide (ring, box) {
  if (!validBox4(ring) || !validBox4(box)) return null
  const n = box[3] < ring[1], s = box[1] > ring[3], w = box[2] < ring[0], e = box[0] > ring[2]
  if (n + s + w + e !== 1) return null
  if ((n || s) && (box[0] <= ring[0] || box[2] >= ring[2])) return null
  if ((w || e) && (box[1] <= ring[1] || box[3] >= ring[3])) return null
  return n ? 'N' : s ? 'S' : w ? 'W' : 'E'
}
/**
 * A COLUMN'S GROUND, FLOATING SPOIL PASSED -> pathColumn's answer. Pure over `read`. LIVE showcase 11-04 (the basin north of the
 * town, y 62-63): the pathfinder's bridge blocks float at the town's level (y 70: dirt and cobblestone over 6 cells of air), and
 * pathColumn reads the first solid from the top as the ground -- so the ring's base rose to 70 over a 63 basin (every such column
 * `tall`) and no plot was level. A SPOIL block (FLOAT_SPOIL) with two or more cells of air under it is not ground: it is listed
 * in `above` as kind 'float' (never a clear: a placement into it is the visit's `foreign` dig, one above the wall is left) and the
 * scan goes on below it. At most FLOAT_MAX are passed in a column.
 */
export const FLOAT_SPOIL = /^(dirt|coarse_dirt|grass_block|cobblestone|mossy_cobblestone|cobbled_deepslate|netherrack|stone|andesite|diorite|granite|tuff|gravel|sand|dirt_path|rooted_dirt|podzol)$/
export const FLOAT_MAX = 4
export function extColumn (read, x, z, { yHi, yLo }) {
  let hi = yHi
  const extra = []
  for (let n = 0; n <= FLOAT_MAX; n++) {
    const c = pathColumn(read, x, z, { yHi: hi, yLo })
    if (c.why || c.y == null || n === FLOAT_MAX) return extra.length ? { ...c, above: [...extra, ...c.above] } : c
    const b1 = read(x, c.y - 1, z), b2 = read(x, c.y - 2, z)
    const air = b => !!b && b.boundingBox === 'empty' && !/water|lava/.test(nm(b))
    if (!FLOAT_SPOIL.test(c.name) || !air(b1) || !air(b2)) return extra.length ? { ...c, above: [...extra, ...c.above] } : c
    extra.push(...c.above, { y: c.y, name: c.name, kind: 'float' })
    hi = c.y - 1
  }
  return pathColumn(read, x, z, { yHi: yLo, yLo })
}
/** The old ring's line on that side -> { axis: 'z'|'x', at }. Pure. */
export const extLine = (ring, side) => (side === 'N' ? { axis: 'z', at: ring[1] } : side === 'S' ? { axis: 'z', at: ring[3] } : side === 'W' ? { axis: 'x', at: ring[0] } : { axis: 'x', at: ring[2] })
/** A JOIN test for wallCandidate -> (x, z) -> 'join' | null: the column lies on the shared line. Pure. */
export const extJoin = (ring, side) => { const L = extLine(ring, side); return (x, z) => ((L.axis === 'z' ? z : x) === L.at ? 'join' : null) }
/**
 * THE CANDIDATE RECTANGLES -> [{ rect: [x0, z0, x1, z1], a, b, out }]. Pure. The hall's box + `margin`, the shared side ON the old
 * line, widened along it by a (one end) and b (the other) from `grow` (never past the old ring's span) and deepened by out from
 * `growOut`. A rectangle too small to hold a ring at `margin` is left out.
 */
export function extRects (ring, box, side, W = WALLEXT) {
  const m = W.margin, out = []
  const seen = new Set()
  for (const a of W.grow) for (const b of W.grow) for (const o of W.growOut) {
    let r
    if (side === 'N') r = [Math.max(ring[0], box[0] - m - a), box[1] - m - o, Math.min(ring[2], box[2] + m + b), ring[1]]
    else if (side === 'S') r = [Math.max(ring[0], box[0] - m - a), ring[3], Math.min(ring[2], box[2] + m + b), box[3] + m + o]
    else if (side === 'W') r = [box[0] - m - o, Math.max(ring[1], box[1] - m - a), ring[0], Math.min(ring[3], box[3] + m + b)]
    else if (side === 'E') r = [ring[2], Math.max(ring[1], box[1] - m - a), box[2] + m + o, Math.min(ring[3], box[3] + m + b)]
    else continue
    if (r[2] - r[0] < 2 * m + 1 || r[3] - r[1] < 2 * m + 1) continue
    const k = r.join(',')
    if (seen.has(k)) continue
    seen.add(k); out.push({ rect: r, a, b, out: o })
  }
  return out
}
/** INSIDE THE EXTENSION -> [x0, z0, x1, z1]: the rectangle less its own line on three sides, up to and including the shared line. */
export function extInterior (rect, side) {
  const [x0, z0, x1, z1] = rect
  if (side === 'N') return [x0 + 1, z0 + 1, x1 - 1, z1]
  if (side === 'S') return [x0 + 1, z0, x1 - 1, z1 - 1]
  if (side === 'W') return [x0 + 1, z0 + 1, x1, z1 - 1]
  return [x0, z0 + 1, x1 - 1, z1 - 1]
}
/** The plots' domain: the rectangle `lane` in from its own line on three sides, and 2 off the shared line. Pure. */
export function extPlotDomain (rect, side, lane = WALLEXT.lane) {
  const [x0, z0, x1, z1] = rect
  if (side === 'N') return [x0 + lane, z0 + lane, x1 - lane, z1 - 2]
  if (side === 'S') return [x0 + lane, z0 + 2, x1 - lane, z1 - lane]
  if (side === 'W') return [x0 + lane, z0 + lane, x1 - 2, z1 - lane]
  return [x0 + 2, z0 + lane, x1 - lane, z1 - lane]
}
/**
 * THE PLOTS a domain holds -> [{ id, kind, box: [x0, z0, x1, z1], y: [lo, hi] }]. Pure over `read`. Hall-size plots first, then
 * house-size, each the free rectangle nearest `near` (the hall's centre) in either orientation: every column not refused
 * (`refuse(x, z)`: a zone, the plan, a well, the farm, a record or its reservation, a road corridor, the old wall), its ground read,
 * dry and known, the ground's range (10th to 90th percentile) within `spread`; two plots (and a plot and `keep` boxes: the hall's) at least `gap` apart. At most
 * `want` plots. `memo` (Map "x,z" -> column) is shared with the ring's own scan.
 */
export function wallExtPlots (read, domain, { home, refuse = () => null, near = null, keep = [], want = WALLEXT.plotsWant, sizes = WALLEXT.plotSizes, gap = WALLEXT.plotGap, spread = WALLEXT.plotSpread, memo = null, column = extColumn } = {}) {
  if (!validBox4(domain) || !home) return []
  const [dx0, dz0, dx1, dz1] = domain
  const W = dx1 - dx0 + 1, D = dz1 - dz0 + 1
  const m = memo ?? new Map()
  const scan = (x, z) => { const k = k2(x, z); if (!m.has(k)) m.set(k, column(read, x, z, { yHi: home.y + WALL.dy, yLo: home.y - WALL.dy })); return m.get(k) }
  // the good columns and their ground, then a prefix sum of the bad ones (a candidate is O(1) to screen)
  const ys = new Array(W * D).fill(null)
  const bad = new Int32Array((W + 1) * (D + 1))
  for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) {
    const x = dx0 + i, z = dz0 + j
    let ok = !refuse(x, z)
    if (ok) { const c = scan(x, z); ok = !c.why && c.y != null; if (ok) ys[j * W + i] = c.y }
    bad[(j + 1) * (W + 1) + (i + 1)] = (ok ? 0 : 1) + bad[j * (W + 1) + (i + 1)] + bad[(j + 1) * (W + 1) + i] - bad[j * (W + 1) + i]
  }
  const badIn = (i0, j0, i1, j1) => bad[(j1 + 1) * (W + 1) + (i1 + 1)] - bad[j0 * (W + 1) + (i1 + 1)] - bad[(j1 + 1) * (W + 1) + i0] + bad[j0 * (W + 1) + i0]
  const [cx, cz] = near ?? [(dx0 + dx1) / 2, (dz0 + dz1) / 2]
  const taken = keep.filter(validBox4).map(b => [...b])
  const clash = b => taken.some(t => b[0] <= t[2] + gap && b[2] >= t[0] - gap && b[1] <= t[3] + gap && b[3] >= t[1] - gap)
  const out = []
  for (const s of sizes) {
    for (;;) {
      if (out.length >= want) return out
      let best = null
      for (const [w, d] of s.w === s.d ? [[s.w, s.d]] : [[s.w, s.d], [s.d, s.w]]) {
        for (let i = 0; i + w <= W; i++) for (let j = 0; j + d <= D; j++) {
          if (badIn(i, j, i + w - 1, j + d - 1)) continue
          const b = [dx0 + i, dz0 + j, dx0 + i + w - 1, dz0 + j + d - 1]
          if (clash(b)) continue
          const dist = Math.hypot((b[0] + b[2]) / 2 - cx, (b[1] + b[3]) / 2 - cz)
          if (best && dist >= best.dist) continue
          // the ground's range between its 10th and 90th percentile: the bots' own pillars and pits (the groundskeeper's work) are
          // not the ground a building is sited on (the basin north of the showcase: 1-2 high stray blocks and 1-3 deep holes)
          const g = []
          for (let ii = i; ii < i + w; ii++) for (let jj = j; jj < j + d; jj++) g.push(ys[jj * W + ii])
          g.sort((p, q) => p - q)
          const lo = g[Math.floor(g.length * 0.1)], hi = g[Math.min(g.length - 1, Math.floor(g.length * 0.9))]
          if (hi - lo > spread) continue
          best = { b, dist, y: [lo, hi] }
        }
      }
      if (!best) break
      taken.push(best.b)
      out.push({ id: `X${out.length + 1}`, kind: s.kind, box: best.b, y: best.y })
    }
  }
  return out
}
/**
 * THE EXTENSION'S SITING -> { ok, why, record, tried }. Pure over `read`. The bot's own (skills.mjs buildWall for WALLEXT) and the
 * offline proof's (scripts/wallext-offline.mjs).
 *   wall       the old wall record (its ring and its cells: the cells' columns are never the extension's)
 *   hub        the hall's record (its box)
 *   plan, zones, caps, plinth, composter, farm, pzones, lights   siteWall's inputs (pzones: every other record's reservation and the
 *              land plan's corridors; the old wall's own zones are dropped -- its line is the join)
 *   records    every other project's record: their cell columns are refused (pathAvoid), the tidy's for the ring only
 * The candidates are screened (cheap: their plots, then how LEVEL their line is, then the shortest), the best `tries` proven
 * (wallCandidate + the escape proof) and scored (plots, the share standing as wall, length, cost). ASYNC only to `pause` between
 * candidates (a bot's event loop: one candidate is ~1-3 s of work; the whole siting ~30 s would miss the server's keep-alive).
 */
export async function siteWallExt (read, { wall, hub, plan, zones = [], caps = [], plinth = [], composter = null, farm = [], records = [], pzones = [], lights = 0, now = Date.now(), pause = null, W = WALLEXT } = {}) {
  const home = plan?.home
  if (!home) return { ok: false, why: 'no_plan', record: null }
  if (!validBox4(wall?.ring)) return { ok: false, why: 'no_wall', record: null }
  if (!validBox4(hub?.box)) return { ok: false, why: 'no_hub', record: null }
  const ring = wall.ring, box = hub.box
  const side = extSide(ring, box)
  if (!side) return { ok: false, why: 'hub_not_beyond_a_side', record: null }
  const oldCols = new Set((wall.cells ?? []).map(c => k2(c.at[0], c.at[2])))
  // Codex code r1 BLOCKER: every OTHER record's cell columns are refused (a record with no zones -- the tidy's stage record -- has
  // cells all the same: a wall cell there would dig its fill as `foreign`); the old wall's by `oldCols`. The plots read the same
  // refusals but the tidy's (its fills and cuts are ground work, never a building's footprint)
  const others = (records ?? []).filter(r => r && r.plot !== WALL_PLOT && r.plot !== WALLEXT_PLOT && r.blueprint !== WALL_BLUEPRINT && r.blueprint !== WALLEXT_BLUEPRINT)
  const avoid0 = pathAvoid({ plan, zones, caps, plinth, composter, farm, records: others, home })
  const avoidP = pathAvoid({ plan, zones, caps, plinth, composter, farm, records: others.filter(r => r.plot !== 'tidy'), home })
  const avoid = (x, z) => (oldCols.has(k2(x, z)) ? 'old_wall' : avoid0(x, z))
  const pz = pzones.filter(z => String(z?.why ?? '') !== `project:${WALL_PLOT}` && String(z?.why ?? '') !== `project:${WALLEXT_PLOT}`)
  const pzAt = (x, z) => { for (const zb of pz) { const b = zb?.box ?? zb; if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return String(zb?.why ?? 'project') } return null }
  const spokes = (plan.paths ?? []).map(p => p.seg).filter(Array.isArray)
  const join = extJoin(ring, side)
  const memo = new Map()
  const near = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]
  const refuse = (x, z) => (oldCols.has(k2(x, z)) ? 'old_wall' : avoidP(x, z)) ?? pzAt(x, z)
  const m = W.margin
  const seed = walkFeet(read, home)
  if (!seed) return { ok: false, why: 'no_feet_at_home', record: null }
  // 1. SCREEN: each rectangle's plots (the hall's reservation is in pzones; its box kept `plotGap` off)
  const scanG = (x, z) => { const k = k2(x, z); if (!memo.has(k)) memo.set(k, extColumn(read, x, z, { yHi: home.y + WALL.dy, yLo: home.y - WALL.dy })); return memo.get(k) }
  const cands = []
  for (const c of extRects(ring, box, side, W)) {
    const plots = wallExtPlots(read, extPlotDomain(c.rect, side, W.lane), { home, refuse, near, keep: [box], want: W.plotsWant, memo, sizes: W.plotSizes, gap: W.plotGap, spread: W.plotSpread })
    const per = 2 * (c.rect[2] - c.rect[0] + c.rect[3] - c.rect[1])
    // LEVEL: the share of the ring's own free columns whose cross-section (the line and the fire-step two in) is within 2 -- a
    // line along a ridge's edge or a slope stands `tall` and opens (the basin north of the showcase: its rim)
    let lv = 0, nv = 0
    for (const q of ringLoop([c.rect[0] + W.margin, c.rect[1] + W.margin, c.rect[2] - W.margin, c.rect[3] - W.margin], W.margin)) {
      if (join(q.x, q.z) || refuse(q.x, q.z)) continue
      nv++
      const a = scanG(q.x, q.z), b = scanG(...terraceAt(q, 2))
      if (!a.why && !b.why && a.y != null && b.y != null && Math.abs(a.y - b.y) <= 2) lv++
    }
    cands.push({ ...c, plots: Math.min(plots.length, W.plotsWant), per, level: nv ? Math.round((lv / nv) * 20) / 20 : 0 })
    if (pause) await pause()
  }
  cands.sort((p, q) => q.plots - p.plots || q.level - p.level || p.per - q.per)
  const tried = []
  let best = null
  for (const c of cands.slice(0, W.tries)) {
    const inside = [c.rect[0] + m, c.rect[1] + m, c.rect[2] - m, c.rect[3] - m]
    const cand = wallCandidate(read, inside, m, { home, avoid, pzones: pz, spokes, lights, join, scanMemo: memo, seed, column: extColumn })
    if (pause) await pause()
    const t = { rect: c.rect, plots: c.plots, level: c.level, ok: cand.ok, why: cand.why }
    tried.push(t)
    if (!cand.ok) { if (cand.why === 'unknown') return { ok: false, why: 'unknown', record: null, tried, unknown: cand.unknown }; continue }
    const R0 = Math.max(...cand.cols.map(q => Math.max(Math.abs(q.x - home.x), Math.abs(q.z - home.z))))
    const esc = wallEscape(read, home, cand.cells, { r: R0 + 14, near: R0 + 6, seed })
    if (pause) await pause()
    Object.assign(t, { cut: esc.cut, trapped: esc.trapped, pits: esc.pits })
    if (esc.cut > 0 || esc.trapped > 0) continue
    // 2. THE PLOTS AGAIN on the built ring: clear of its own record columns + 1 (its zones) and one lane more
    const used = new Set(cand.cells.map(q => k2(q.at[0], q.at[2])))
    const nearWall = (x, z) => { for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (used.has(k2(x + dx, z + dz))) return 'wallext' ; return null }
    const plots = wallExtPlots(read, extPlotDomain(c.rect, side, W.lane), { home, refuse: (x, z) => refuse(x, z) ?? nearWall(x, z), near, keep: [box], want: W.plotsWant, memo, sizes: W.plotSizes, gap: W.plotGap, spread: W.plotSpread })
    t.plotsBuilt = plots.length
    // THE SCORE: the plots (to plotsWant), then the share of the ring that stands as wall, then the shortest ring
    // (a stretch where the ring meets another build -- a ziggurat's reservation or cells, the hall's -- is that build's, as on the old ring)
    const own = cand.cols.filter(q => q.s !== 'join' && !(q.s === 'gap' && /^project(:|$)/.test(String(q.why ?? '')))).length
    const built = own ? (cand.counts.wall + cand.counts.post) / own : 0
    t.built = Math.round(built * 100) / 100
    if (built < W.builtMin) { t.why = 'too_open'; continue }
    const score = Math.min(plots.length, W.plotsWant) * 100 + built * 50 - c.per * 0.1 - cand.cost * 0.05
    t.score = Math.round(score * 10) / 10
    if (best && best.score >= score) continue
    const L = extLine(ring, side)
    const along = L.axis === 'z' ? [c.rect[0], c.rect[2]] : [c.rect[1], c.rect[3]]
    const oldOn = (wall.cols ?? []).filter(q => (L.axis === 'z' ? q.z : q.x) === L.at && (L.axis === 'z' ? q.x : q.z) >= along[0] && (L.axis === 'z' ? q.x : q.z) <= along[1])
    const record = {
      v: 1, blueprint: WALLEXT_BLUEPRINT, plot: WALLEXT_PLOT, home: { x: home.x, y: home.y, z: home.z }, side,
      join: { axis: L.axis, line: L.at, from: along[0], to: along[1], cols: along[1] - along[0] + 1, oldBuilt: oldOn.filter(q => q.s === 'wall' || q.s === 'post').length, ring: [...ring] },
      ring: c.rect, inside, interior: extInterior(c.rect, side), margin: m,
      cols: cand.cols.map(q => ({ x: q.x, z: q.z, s: q.s, ...(q.why ? { why: q.why } : {}), ...(Number.isFinite(q.b) && (q.s === 'wall' || q.s === 'post') ? { b: q.b } : {}) })),
      gates: cand.gates, counts: cand.counts, ports: cand.ports, posts: cand.posts, lights: cand.lights,
      cells: cand.cells, clear: cand.clear, replant: [], segments: cand.segments, zones: cand.zones.map(z => ({ ...z, why: `project:${WALLEXT_PLOT}` })),
      bom: cand.bom, felled: { trunks: cand.trunks, logs: cand.logs }, escape: esc, plots, hub: { box: [...box] }, builders_max: WALL_BUILDERS,
      structure_complete: false, plan: plan.gen != null ? { gen: plan.gen } : null, sitedAt: now,
    }
    best = { score, record }
  }
  if (best) return { ok: true, why: 'ok', record: best.record, tried }
  return { ok: false, why: `no_ring:${tried.map(t => `${t.rect.join('_')}:${t.ok ? `cut${t.cut}/trap${t.trapped}` : t.why}`).join(',')}`.slice(0, 400), record: null, tried }
}
/**
 * THE WALKS' START -> [x, y, z] | null: home's own feet cell (walkSet's: within 4 of home.y), else the NEAREST feet cell within
 * Chebyshev `r` and `dy` of home (LIVE showcase 11-04: a dirt pillar stood on home's column to y 75 -- every walk from home was
 * empty, so the reach proof made every column a gap). Pure over `read`.
 */
export function walkFeet (read, home, { r = 6, dy = 6 } = {}) {
  const node = (x, y, z) => floorOk(read(x, y - 1, z)) && passable(read(x, y, z)) && passable(read(x, y + 1, z))
  for (let d = 0; d <= r; d++) {
    for (let ddy = 0; ddy <= (d === 0 ? 4 : dy); ddy++) {
      for (const y of ddy ? [home.y + ddy, home.y - ddy] : [home.y]) {
        for (let dx = -d; dx <= d; dx++) for (let dz = -d; dz <= d; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== d) continue
          if (node(home.x + dx, y, home.z + dz)) return [home.x + dx, y, home.z + dz]
        }
      }
    }
  }
  return null
}
/** INSIDE THE WALLS -> [[x0, z0, x1, z1]]: the old wall's interior box (terrace.mjs wallInterior's rule) and the extension's. Pure. */
export function wallInteriors (wallRec, extRec) {
  const out = []
  const g = wallRec?.ring
  if (validBox4(g) && g[2] - g[0] >= 4 && g[3] - g[1] >= 4) out.push([g[0] + 1, g[1] + 1, g[2] - 1, g[3] - 1])
  if (validBox4(extRec?.interior)) out.push([...extRec.interior])
  return out
}
/**
 * THE OPENING RULE -> { open, why }. Pure. The extension is sited only round a hall that stands (shop.mjs PROJECTS `after`) BEYOND one
 * side of a complete wall (extSide): a hall sited inside the wall, beyond a corner, or with no wall record never opens it (the order
 * then never offers the extension: `waiting`).
 */
export function wallextOpening (wallRec, hubRec) {
  if (!wallRec || !validBox4(wallRec.ring)) return { open: false, why: 'no_wall' }
  if (!wallRec.structure_complete) return { open: false, why: 'wall_open' }
  if (!hubRec || !validBox4(hubRec.box)) return { open: false, why: 'no_hub' }
  if (!extSide(wallRec.ring, hubRec.box)) return { open: false, why: 'hub_not_beyond_a_side' }
  return { open: true, why: 'ok' }
}
