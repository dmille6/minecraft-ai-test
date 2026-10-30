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
export const WALL = Object.freeze({ margin: 6, marginMax: 9, body: 3, runMax: 12, runMin: 4, gap: 2, tallMax: 7, dy: 14, logMax: 48, clearUp: 2 })
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
export const WALL_SOFT = /^(sand|red_sand|suspicious_sand|gravel|suspicious_gravel|clay|mud|snow_block|powder_snow|ice|packed_ice|blue_ice|soul_sand|soul_soil|moss_block|dirt_path|farmland)$/
/** What a visit may dig out of an open record cell (buildrun.mjs `foreign`): terrain, the soft ground a foundation replaces, the
 *  plants a placement does not replace, a stray torch, and the pathfinder's scaffold (logs and leaves are TREE_CLEAR). */
export const WALL_FOREIGN = /^(cobblestone|mossy_cobblestone|dirt|coarse_dirt|grass_block|podzol|rooted_dirt|mycelium|moss_block|stone|andesite|diorite|granite|tuff|netherrack|cobbled_deepslate|deepslate|gravel|suspicious_gravel|sand|red_sand|suspicious_sand|clay|mud|snow_block|powder_snow|ice|packed_ice|blue_ice|soul_sand|soul_soil|calcite|dripstone_block|smooth_basalt|dirt_path|farmland|[a-z_]+_sapling|mangrove_propagule|brown_mushroom|red_mushroom|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|sunflower|lilac|rose_bush|peony|sweet_berry_bush|bush|firefly_bush|leaf_litter|wildflowers|pink_petals|moss_carpet|short_dry_grass|tall_dry_grass|torchflower|cactus_flower|pitcher_plant|snow|torch|wall_torch|[a-z_]+_planks|sandstone|red_sandstone)$/
/** The siting's price of each margin column past WALL.margin (a looser ring encloses forest, not town). */
export const WALL_LOOSE = 10
/** A clear's one-call bound (buildrun.mjs `clearMax`): a forest line's leaves leave the rest of the visit for the segments. */
export const WALL_CLEAR_MAX = 60

/**
 * THE SWITCH -> bool. WALL=on|off; unset = on only in the pools WALL_POOLS names (default 'showcase'): the fleet's towns keep their
 * project list until the fleet rollout. Pure.
 */
export function wallOn (env = process.env, pool = '') {
  const v = String(env?.WALL ?? '').toLowerCase()
  if (v === 'on' || v === '1' || v === 'true') return true
  if (v === 'off' || v === '0' || v === 'false') return false
  const pools = String(env?.WALL_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes(String(pool))
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
export function wallCandidate (read, inside, m, { home, avoid = () => null, pzones = [], spokes = [], lights = 0 } = {}) {
  const loop = ringLoop(inside, m)
  const col = new Map()
  const scan = (x, z) => {
    const k = k2(x, z)
    if (!col.has(k)) col.set(k, pathColumn(read, x, z, { yHi: home.y + WALL.dy, yLo: home.y - WALL.dy }))
    return col.get(k)
  }
  const reason = (x, z) => {
    const a = avoid(x, z)
    if (a) return { s: 'gap', why: a }
    for (const sg of spokes) if (x >= sg[0] - 1 && x <= sg[2] + 1 && z >= sg[1] - 1 && z <= sg[3] + 1) return { s: 'gate', why: 'spoke' }
    for (const zb of pzones) {
      const b = zb?.box ?? zb
      if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return String(zb?.why ?? '') === 'project:paths' ? { s: 'gate', why: 'path' } : { s: 'gap', why: String(zb?.why ?? 'project') }
    }
    return null
  }
  // 1. each O column's state from its own column and its two terrace columns: a gateway wins over a gap (the path goes through)
  const unknown = []
  for (const c of loop) {
    const three = [[c.x, c.z], terraceAt(c, 1), terraceAt(c, 2)]
    let st = null
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
        cells.push({ at, role: 'light', seg })
        lightN++
      }
    })
    return { cells, clear, segments, used, trunks, logN, posts, lightN, runs }
  }
  let B = null
  for (let pass = 0; ; pass++) {
    B = build()
    const bad = pass < WALL_REACH_PASSES ? wallReach(read, home, B, loop) : []
    if (!bad.length) break
    for (const i of bad) { loop[i].s = 'gap'; loop[i].why = 'reach' }
  }
  const { cells, clear, segments, used, trunks, logN, posts, lightN } = B
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
    counts: { wall: count('wall'), post: count('post'), gate: count('gate'), open: count('open'), gap: count('gap'), ring: n },
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
export function wallReach (read, home, B, loop) {
  const solid = new Set(B.cells.filter(c => c.role !== 'light').map(c => c.at.join(',')))
  const air = new Set(B.clear.map(c => c.at.join(',')))
  const SOLID = { name: 'cobblestone', boundingBox: 'block' }, AIRB = { name: 'air', boundingBox: 'empty' }
  const fin = (x, y, z) => { const k = `${x},${y},${z}`; return solid.has(k) ? SOLID : air.has(k) ? AIRB : read(x, y, z) }
  const r = Math.max(...loop.map(c => Math.max(Math.abs(c.x - home.x), Math.abs(c.z - home.z)))) + 8
  const nodes = new Map()
  for (const k of walkSet(fin, home, r)) { const [x, y, z] = k.split(',').map(Number); const kk = k2(x, z); if (!nodes.has(kk)) nodes.set(kk, []); nodes.get(kk).push(y) }
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
export function wallEscape (read, home, cells, { r = 64, near = r - 6 } = {}) {
  const solid = new Set(cells.map(c => c.at.join(',')))
  const SOLID = { name: 'cobblestone', boundingBox: 'block' }
  const r1 = (x, y, z) => (solid.has(`${x},${y},${z}`) ? SOLID : read(x, y, z))
  const a = walkSet(read, home, r, { drops: WALK_DROP }), b = walkSet(r1, home, r, { drops: WALK_DROP })
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
  const back0 = walkSet(read, home, r, { drops: WALK_DROP, reverse: true }), back1 = walkSet(r1, home, r, { drops: WALK_DROP, reverse: true })
  const pen = judge([...b].filter(k => !back1.has(k) && !(a.has(k) && !back0.has(k))), r1)
  const sa = walkSet(read, home, r), sb = walkSet(r1, home, r)
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
