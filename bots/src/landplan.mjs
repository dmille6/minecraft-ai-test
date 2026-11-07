// GROUNDSKEEPER-01: THE TOWN'S LAND PLAN (owner 11-02, ledger groundskeeper-1102: "have one of the bots work on tidying the town
// first, then tidying the surrounding area slowly working their way out ... a grounds keeper" -- and a PLAN behind it). PURE: the
// seed, the road network (a ring round the town and spokes outward), the zones, the reserved corridors and the ring order. Nothing
// here touches a bot or a file; skills.mjs publishes the plan as the town record `project-<home>.land` and the groundskeeper
// (tidy.mjs stages, skills.mjs buildTidy) works it.
//
// DETERMINISTIC GEOMETRY, NO MODEL: the shape is drawn from the town's seed (pool + home, the ziggurat-variety rule: zigdesign.mjs
// zigSeed) and the ground as read; the roads are ROUTED with the paths' own router (paths.mjs routeLeg over pathGrid) under a
// grading allowance (the tidy's: fill and cut up to 4, then 6, the bots' spoil cuttable, never beside water), so a road is a line
// the groundskeeper can grade into a walkable 2-wide corridor (every step +-1 at most). An LLM mayor (not live: coop B5
// INCONCLUSIVE) may later choose only INSIDE the plan -- which spoke next, a monument site, names (`choices`) -- never geometry.
//
//   ROADS     the RING: an octagon round the town's inner plan (plaza, store, workshop, well, farm) at a seeded radius and chamfer,
//             routed waypoint to waypoint and closed on itself; SPOKES: 3-5 bearings from the ring outward to LAND.workR -- the
//             caller's `bearings` (an expedition route), the town plan's gate and its shaft (the mine) first, then seeded ones at
//             least LAND.spokeSep apart. Each spoke names its `rail`: the line on to the expeditions' next outpost (S2: every ~400
//             blocks), which future rails follow.
//   ZONES     per 45-degree sector between the ring and workR: town (inside the ring), homes, yard, farms, treefarm, monument,
//             industry (the shaft), wild. The plan's own outer plots pin theirs; the rest are seeded. Wild is left alone.
//   CORRIDORS every road column + LAND.margin, as reservation boxes (`why: 'land:road'`): other builds (houses, the tree farm, the
//             yard, the ziggurat, the wall) are sited clear of them (skills.mjs projectHeads); the wall opens a gateway where one
//             crosses (wall.mjs). Saplings are never planted in them (owner 10-27: no planting in footprints).
//   STAGES    the ring order the groundskeeper works: the town square (tidy-01's survey and the paths' corridors to the chests and
//             the well), then the ring road and the spokes' first reach, then each outward band (its pillars, its pits and the
//             spokes through it). Nature beyond the band being worked is never touched.

import { pathColumn, pathGrid, routeLeg, pathZones, gridUnread, PATH_DY } from './paths.mjs'

export const LAND_PLOT = 'land'
export const LAND_BLUEPRINT = 'land@1'
/**
 * THE PLAN'S BOUNDS. ringR: the seeded ring radius range (Chebyshev, round home), never inside the inner plan + ringGap; chamfer:
 * the octagon's corner cut as a share of the radius; spokes: how many; spokeSep: the least angle between two spokes (degrees);
 * workR: how far out the plan (and the groundskeeper) reaches; rimR / rimStep: the town square tidy-01 works (its r) and each
 * outward band's width; wpStep: the most blocks between two routed waypoints; snap: how far a waypoint may move to ground a road
 * can take; grades: the routing allowances tried ([fill, cut], the first that routes wins); legPops: the router's bound a leg; margin: the corridor round the
 * road; outpost: the expeditions' outpost spacing (S2) a spoke's rail points at; band: how far a road may stray from its line (the
 * ring's radius, a spoke's bearing) -- unbounded, the router wandered round every earthwork (hive-c's ring: 1,624 columns).
 */
export const LAND = Object.freeze({ v: 1, ringR: [20, 28], ringGap: 4, chamfer: [0.25, 0.45], spokes: [3, 5], spokeSep: 60, workR: 80, rimR: 32, rimStep: 16, wpStep: 12, snap: 5, grades: [[6, 6]], legPops: 150_000, margin: 1, outpost: 400, band: 8, ringBand: 12 })
/** The zone kinds (a sector's use). `wild` is never worked beyond its roads. */
export const ZONE_KINDS = Object.freeze(['town', 'homes', 'yard', 'farms', 'treefarm', 'monument', 'industry', 'wild'])
/** THE SWITCH -> bool. LANDPLAN=off is the plan's own rollback (no land record is sited or read: no corridors, no road stages).
 *  Unset = on wherever the groundskeeper is (groundskeeper.mjs gkOn decides who works it). Pure. */
export function landOn (env = process.env) {
  const v = String(env?.LANDPLAN ?? '').trim().toLowerCase()
  return !(v === 'off' || v === '0' || v === 'false' || v === 'no')
}

// ---- the seed ------------------------------------------------------------------------------------------------------------------
/** FNV-1a 32 of a string (zigdesign.mjs's, kept here so the plan needs no material table). Pure. */
export function fnv1a (str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
/** THE TOWN'S LAND SEED: its pool and its home (a home repeats between worlds; the pool does not). Pure. */
export const landSeed = (pool, home) => fnv1a(`land@1|${pool ?? ''}|${home?.x},${home?.y},${home?.z}`)
/** mulberry32 in [0, 1). Pure. */
export function rng (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SECTORS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']
/** A sector's bearing in degrees (atan2(z, x), as townplan.mjs sectorOf measures it: E 0, S 90, W 180, N 270). Pure. */
export const sectorDeg = s => SECTORS.indexOf(s) * 45
const rad = d => (d * Math.PI) / 180
const angDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180)
const k2 = (x, z) => `${x},${z}`
const BRUSH = [[0, 0], [1, 0], [0, 1], [1, 1]]
const cheb = (home, x, z) => Math.max(Math.abs(x - home.x), Math.abs(z - home.z))

/**
 * THE INNER PLAN'S REACH -> the Chebyshev distance from home of the furthest inner thing: every plot box and cell that is not an
 * outer plot (gate, shaft, monument, pavilion, hall), the wells' caps (+3, the well's footprint) and the composter. Pure.
 */
export function innerReach (plan, { caps = [], composter = null } = {}) {
  const home = plan?.home
  if (!home) return 0
  let r = 6
  const OUTER = /^(gate|shaft|monument|pavilion|hall)$/
  for (const p of plan.plots ?? []) {
    if (OUTER.test(String(p.kind ?? p.id))) continue
    if (Array.isArray(p.box) && p.box.length === 4) r = Math.max(r, cheb(home, p.box[0], p.box[1]), cheb(home, p.box[2], p.box[3]), cheb(home, p.box[0], p.box[3]), cheb(home, p.box[2], p.box[1]))
    for (const c of [...(p.cells ?? []), ...(p.stations ?? [])]) if (Array.isArray(c?.at)) r = Math.max(r, cheb(home, c.at[0], c.at[2]))
  }
  for (const c of caps) if (Array.isArray(c)) r = Math.max(r, cheb(home, c[0], c[2]) + 3)
  if (Array.isArray(composter)) r = Math.max(r, cheb(home, composter[0], composter[2]) + 1)
  return r
}

/**
 * THE SHAPE (no ground read) -> { seed, ringR, chamfer, inner, spokes: [{ id, deg, why }], zones: { sector: kind } }. Pure and
 * deterministic in (seed, plan, bearings): the same town always gets the same shape; two towns differ by their seeds.
 *   bearings   [{ deg, why }] extra spoke bearings the caller knows (an expedition route, an outpost): taken first
 */
/**
 * YARDZONE-01 (LIVE showcase 11-03: the yard sited at 06:18Z before any land plan, so it took the workshop's sectors, W; the land
 * plan offline then seeded W as the TREE FARM zone -- and the showcase's tree farm already stands in W). THE SECTORS OF PROJECTS
 * ALREADY SITED -> [{ kind, sector }], the tree farm first (it must never be blocked), then the yard. Pure. A record's own
 * `sector` when it names one, else the sector of its box's centre (or its anchor), measured as zoneAt measures it. landShape pins
 * them before any seeded pick, so the order of siting never matters: a plan drawn first puts the yard in its yard zone (yard.mjs),
 * a yard sited first is where the plan's yard zone is.
 */
export const SITED_KINDS = Object.freeze(['treefarm', 'yard'])
export function sitedSectors (home, records = []) {
  if (!home) return []
  const out = []
  for (const kind of SITED_KINDS) {
    for (const rec of records ?? []) {
      const plot = rec?.plot ?? String(rec?.blueprint ?? '').split('@')[0]
      if (plot !== kind) continue
      let sector = SECTORS.includes(rec?.sector) ? rec.sector : null
      if (!sector) {
        const b = Array.isArray(rec?.box) && rec.box.length === 4 && rec.box.every(Number.isFinite) ? rec.box : null
        const a = Array.isArray(rec?.anchor) && rec.anchor.length >= 2 && rec.anchor.every(Number.isFinite) ? rec.anchor : null
        const c = b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : (a ? [a[0], a[a.length - 1]] : null)
        if (!c || (c[0] === home.x && c[1] === home.z)) continue
        const ang = Math.atan2(c[1] - home.z, c[0] - home.x)
        sector = SECTORS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8]
      }
      if (!out.some(o => o.kind === kind && o.sector === sector)) out.push({ kind, sector })
    }
  }
  return out
}
export function landShape (seed, { plan, caps = [], composter = null, bearings = [], sited = [], L = LAND } = {}) {
  const r = rng(seed)
  const inner = innerReach(plan, { caps, composter })
  const seeded = L.ringR[0] + Math.floor(r() * (L.ringR[1] - L.ringR[0] + 1))
  const ringR = Math.max(seeded, inner + L.ringGap)
  const chamfer = Math.round(ringR * (L.chamfer[0] + r() * (L.chamfer[1] - L.chamfer[0])))
  const n = L.spokes[0] + Math.floor(r() * (L.spokes[1] - L.spokes[0] + 1))
  const outer = (plan?.plots ?? []).filter(p => typeof p.sector === 'string' && SECTORS.includes(p.sector))
  const sec = kind => outer.find(p => p.kind === kind || p.id === kind)?.sector ?? null
  // the monument's own sector carries no spoke (a road through the ziggurat's site; its stair foot is the paths' destination)
  const mon = sec('monument')
  const spokes = []
  const tryAdd = (deg, why) => {
    deg = ((Math.round(deg) % 360) + 360) % 360
    if (spokes.length >= L.spokes[1]) return false
    if (mon && angDiff(deg, sectorDeg(mon)) < 30) return false
    if (spokes.some(s => angDiff(s.deg, deg) < L.spokeSep)) return false
    spokes.push({ id: `s${spokes.length}`, deg, why })
    return true
  }
  for (const b of bearings ?? []) if (Number.isFinite(b?.deg)) tryAdd(b.deg, String(b.why ?? 'route'))
  if (sec('gate')) tryAdd(sectorDeg(sec('gate')), 'gate')
  if (sec('shaft')) tryAdd(sectorDeg(sec('shaft')), 'industry')
  // seeded bearings: a start angle, then steps of 360/n with a seeded jitter, each kept only when it clears the others
  const a0 = r() * 360
  for (let i = 0; i < 4 * L.spokes[1] && spokes.length < n; i++) tryAdd(a0 + (i * 360) / n + (r() - 0.5) * 20 + (i >= n ? 360 / (2 * n) : 0), 'seeded')
  // THE ZONES: the plan's outer plots pin their sectors, then the farm's, the yard beside the store, homes, a seeded tree farm; wild
  const zones = {}
  const pin = (s, kind) => { if (s && SECTORS.includes(s) && !zones[s]) zones[s] = kind }
  pin(mon, 'monument')
  pin(sec('shaft'), 'industry')
  pin((plan?.plots ?? []).find(p => p.kind === 'farm')?.sector ?? null, 'farms')
  pin(sec('pavilion'), 'homes')
  pin(sec('hall'), 'homes')
  // yardzone-01: a project ALREADY SITED pins its sector to its kind (sitedSectors: the tree farm first), and its kind is never
  // seeded elsewhere; a sited kind whose sector another kind holds already stays where it is, named in `fixed` (its record is a
  // reservation either way)
  const have = new Set(), fixed = []
  for (const st of sited ?? []) {
    if (!SECTORS.includes(st?.sector) || !ZONE_KINDS.includes(st?.kind)) continue
    have.add(st.kind)
    if (!zones[st.sector]) zones[st.sector] = st.kind
    else if (zones[st.sector] !== st.kind) fixed.push({ kind: st.kind, sector: st.sector, zone: zones[st.sector] })
  }
  const free = () => SECTORS.filter(s => !zones[s])
  const pick = () => { const f = free(); return f.length ? f[Math.floor(r() * f.length) % f.length] : null }
  const storeSec = (plan?.plots ?? []).find(p => p.id === 'store' && typeof p.sector === 'string')?.sector ?? null
  if (!have.has('yard')) pin(storeSec && !zones[storeSec] ? storeSec : pick(), 'yard')
  for (let i = SECTORS.filter(s => zones[s] === 'homes').length; i < 2; i++) pin(pick(), 'homes')
  if (!have.has('treefarm')) pin(pick(), 'treefarm')
  for (const s of free()) zones[s] = 'wild'
  return { seed, ringR, chamfer, inner, spokes, zones, ...(fixed.length ? { fixed } : {}) }
}

/** The ring's waypoints (an octagon round home, Chebyshev radius R, corners cut by c), every `step` at most, in order. Pure. */
export function ringWaypoints (home, R, c, step = LAND.wpStep) {
  const corners = [[R, -R + c], [R, R - c], [R - c, R], [-R + c, R], [-R, R - c], [-R, -R + c], [-R + c, -R], [R - c, -R]]
  const out = []
  for (let i = 0; i < corners.length; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % corners.length]
    const d = Math.max(Math.abs(bx - ax), Math.abs(bz - az))
    const n = Math.max(1, Math.ceil(d / step))
    for (let j = 0; j < n; j++) out.push([home.x + Math.round(ax + ((bx - ax) * j) / n), home.z + Math.round(az + ((bz - az) * j) / n)])
  }
  return out
}
/** A spoke's waypoints: from Chebyshev radius `from` out to `to` along `deg`, every `step`. Pure. */
export function spokeWaypoints (home, deg, from, to, step = LAND.wpStep) {
  const out = []
  const vx = Math.cos(rad(deg)), vz = Math.sin(rad(deg))
  const k = 1 / Math.max(Math.abs(vx), Math.abs(vz))   // so that max(|x|, |z|) = d
  for (let d = from; d <= to + 1e-9; d += step) out.push([home.x + Math.round(vx * k * d), home.z + Math.round(vz * k * d)])
  if (out.length && cheb(home, ...out[out.length - 1]) < to) out.push([home.x + Math.round(vx * k * to), home.z + Math.round(vz * k * to)])
  return out
}

/** THE ROUTING GRID -> paths.mjs pathGrid over home +- (R + 2) with the road's refusals (`avoid`) and the grading limits. Pure. */
export function landGrid (read, home, avoid, lim, R = LAND.workR) {
  const box = [home.x - R - 2, home.z - R - 2, home.x + R + 2, home.z + R + 2]
  return pathGrid((x, z) => pathColumn(read, x, z, { yHi: home.y + PATH_DY, yLo: home.y - PATH_DY }), avoid, box, read, lim)
}
/** The brushes within `snap` of a waypoint the grid can lay (any level), nearest ring first (at least 4 when there are). Pure. */
export function snapBrushes (grid, [x, z], snap = LAND.snap) {
  const out = []
  for (let d = 0; d <= snap; d++) {
    for (let dx = -d; dx <= d; dx++) for (let dz = -d; dz <= d; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== d) continue
      if (grid.levels(x + dx, z + dz).length) out.push([x + dx, z + dz])
    }
    if (out.length >= 4) break
  }
  return out
}
/**
 * ONE ROAD (a chain of waypoints) -> { ok, legs: [{ ok, why }], nodes: [[x, z, s]], reached, skipped, why }. Pure. Leg by leg from
 * the first waypoint's brushes; every leg after the first starts from the brush the last one ended on at a level within one of it
 * (paths.mjs routeLeg `from`), so the whole road is one +-1 chain. A waypoint with no ground a road can take within `snap` (a
 * protected zone, a building's reservation, water), or one no leg reaches, is PASSED: the leg goes on to the next waypoint (at
 * most `skips` in a row) and the router finds the way round. Beyond that the road ends (`reached`: the waypoints it got to).
 * `close`: a last leg back to the first brush (the ring). `pause()` is awaited after every leg (the bot's event loop: a leg is the
 * unit of synchronous work, ~0.1-0.6 s on a fleet town).
 */
export async function routeRoad (grid, wps, { close = false, pops = LAND.legPops, snap = LAND.snap, skips = 3, pause = null, atGround = false } = {}) {
  const legs = [], nodes = []
  if (wps.length < 2) return { ok: false, legs, nodes, reached: 0, skipped: 0, why: 'short' }
  let i0 = 0, start = []   // the brushes the first leg starts from (moved on while nothing is laid)
  let from = null   // Map "x,z" -> level: the last brush laid
  // a waypoint [x, z, s] is a FIXED brush at level s (a junction on a road already routed): no snap, its level kept
  const fixed = w => Array.isArray(w) && w.length === 3 && Number.isFinite(w[2])
  for (; i0 < wps.length - 1 && i0 <= skips; i0++) {
    if (fixed(wps[i0])) { start = [[wps[i0][0], wps[i0][1]]]; from = new Map([[k2(wps[i0][0], wps[i0][1]), wps[i0][2]]]); break }
    start = snapBrushes(grid, wps[i0], snap); if (start.length) break
  }
  // `atGround` (a spoke leaving the town): the first brush is laid at its own ground (the highest of its columns, +-1), so the road
  // meets the untouched ground it starts from instead of a cut or a fill's edge (hive-d offline: a spoke graded 4 below the plaza's
  // edge cut the town off its roads)
  if (atGround && !from && start.length) {
    from = new Map()
    for (const [x, z] of start) { const ys = BRUSH.map(([dx, dz]) => grid.col(x + dx, z + dz)?.y).filter(Number.isFinite); if (ys.length === 4) from.set(k2(x, z), Math.max(...ys)) }
    start = start.filter(([x, z]) => from.has(k2(x, z)))
    if (!start.length) return { ok: false, legs, nodes, reached: 0, skipped: 0, why: 'no_ground_at_start' }
  }
  if (!start.length) return { ok: false, legs, nodes, reached: 0, skipped: 0, why: 'no_ground_at_start' }
  const targets = [...wps.slice(i0 + 1), ...(close ? [null] : [])]
  let reached = i0, skipped = i0, miss = 0
  for (let i = 0; i < targets.length; i++) {
    let tg
    if (targets[i] == null) {
      if (!nodes.length) break
      // the ring's closing leg: back to its first brush, at a level within one of where the road began
      const [fx, fz, fs] = nodes[0]
      tg = new Map([[k2(fx, fz), fs]])
    } else if (fixed(targets[i])) {
      tg = new Map([[k2(targets[i][0], targets[i][1]), targets[i][2]]])
    } else {
      const ts = snapBrushes(grid, targets[i], snap)
      if (!ts.length) { legs.push({ ok: false, why: 'no_ground_at_waypoint' }); if (++miss > skips) break; skipped++; continue }
      tg = new Map(ts.map(([x, z]) => [k2(x, z), null]))
    }
    const src = from ? [...from.keys()].map(k => k.split(',').map(Number)) : start
    // A*: every step costs at least COST.step (1) and no brush of a road is discounted, so the Manhattan distance to the nearest
    // target brush is a lower bound
    const tl = [...tg.keys()].map(k => k.split(',').map(Number))
    const h = (x, z) => { let m = Infinity; for (const [tx, tz] of tl) { const d = Math.abs(tx - x) + Math.abs(tz - z); if (d < m) m = d } return m }
    const r = routeLeg(grid, src, tg, { maxPops: pops, from, h })
    if (pause) await pause()
    if (!r.ok) {
      legs.push({ ok: false, why: r.why })
      // nothing laid yet: the start itself is cut off (a pocket between a well's footprint and a reservation) -- start again from
      // the waypoint this leg could not reach
      if (!nodes.length && targets[i] != null) { const ns = fixed(targets[i]) ? [[targets[i][0], targets[i][1]]] : snapBrushes(grid, targets[i], snap); if (ns.length) { start = ns; from = fixed(targets[i]) ? new Map([[k2(targets[i][0], targets[i][1]), targets[i][2]]]) : null; skipped++; continue } }
      if (targets[i] == null || ++miss > skips) break
      skipped++; continue
    }
    miss = 0
    legs.push({ ok: true, why: 'routed', n: r.nodes.length })
    for (const q of (nodes.length ? r.nodes.slice(1) : r.nodes)) nodes.push(q)
    const end = r.nodes[r.nodes.length - 1]
    from = new Map([[k2(end[0], end[1]), end[2]]])
    reached = i0 + i + 1
  }
  const ok = reached === i0 + targets.length && nodes.length > 0
  return { ok, legs, nodes, reached, skipped, why: ok ? 'routed' : (legs.at(-1)?.why ?? 'unrouted') }
}

/**
 * A ROAD'S COLUMNS AT THEIR LEVEL -> Map "x,z" -> L: each column under any brush of the road at the LOWEST level any brush over
 * it is laid at (tidy.mjs gradeTidy's rule: graded to that, the paths' own router -- fill 2, a natural cut -- lays every brush over
 * it). Pure.
 */
export function roadLevels (nodes) {
  const m = new Map()
  for (const [x, z, s] of nodes) for (const [dx, dz] of BRUSH) { const k = k2(x + dx, z + dz); m.set(k, Math.min(m.get(k) ?? Infinity, s)) }
  return m
}

/**
 * THE LAND PLAN -> Promise<{ ok, why, plan }>. Pure over `read` (async only to `pause` between legs) (the bot's own world, or a region copy's dump).
 *   home, plan     the town plan head's body (home, plots)
 *   seed           landSeed(pool, home)
 *   avoid(x, z)    -> reason | null: the paths' refusals (paths.mjs pathAvoid: zones, the plan's cells, boxes and plots, wells, the
 *                  composter, the tree farm, other projects' record columns) -- a road never crosses them
 *   reserved(x, z) -> reason | null: other projects' reservations (shop.mjs recordZones, never the paths'): a road goes round them
 *   limOf(n)       -> the grading router's limits at allowance n (tidy.mjs gradeLim)
 * The plan: { v, blueprint, plot, home, seed, ringR, chamfer, roads: [{ id, kind, deg?, why, ok, reached, of, grade, cols:
 * [[x, z, L]], rail? }], zones, corridors: [{ box, why }], stages, choices, structure_complete: true, cells: [] }.
 */
export async function planLand (read, { home, plan, seed = 0, avoid = () => null, reserved = () => null, limOf = null, bearings = [], caps = [], composter = null, sited = [], now = 0, pause = null, L = LAND } = {}) {
  if (!home || !plan) return { ok: false, why: 'no_plan', plan: null }
  const shape = landShape(seed, { plan, caps, composter, bearings, sited, L })
  const road = (x, z) => avoid(x, z) ?? reserved(x, z) ?? null
  // each road on its own grid, kept within L.band of its line: the ring between ringR - band and ringR + band, a spoke within band
  // of its bearing's ray (and outside the ring's inner edge)
  const banded = within => { const f = (x, z) => road(x, z) ?? (within(x, z) ? null : 'off_line'); f.flat = avoid.flat; return f }
  // a road raised more than a step over the ground round it is a WALL across the land, a deep cut a trench (hive-d offline: a ring
  // filled 4 over the plaza's edge cut the town off its roads): fill at most 2 (then 4), cut at most 4 (then 6); a stage whose road work makes the walk worse is dropped (tidy.mjs siteStage)
  const gridsFor = within => (L.grades ?? [[1, 3]]).map(([f, c]) => ({ n: `${f}/${c}`, grid: landGrid(read, home, banded(within), limOf ? { ...limOf(Math.max(f, c)), fillMax: f, cutMax: c } : null, L.workR) }))
  const ringBand = (x, z) => { const d = cheb(home, x, z); return d >= Math.max(shape.inner + 1, shape.ringR - L.ringBand) && d <= shape.ringR + L.ringBand }
  const roads = [], used = []
  // where the town square ends: a spoke starts at the core plaza's edge, so the roads meet the town (the paths' hub)
  const core = (plan.plots ?? []).find(p => p.id === 'core' && Array.isArray(p.box))?.box ?? null
  const coreR = core ? Math.max(cheb(home, core[0], core[1]), cheb(home, core[2], core[3]), cheb(home, core[0], core[3]), cheb(home, core[2], core[1])) : 6
  // THE SPOKES FIRST: each from the plaza's edge out along its bearing (within L.band of the ray) to workR
  const rayBand = deg => { const vx = Math.cos(rad(deg)), vz = Math.sin(rad(deg)); return (x, z) => { const dx = x - home.x, dz = z - home.z; return dx * vx + dz * vz >= 0 && Math.abs(dx * vz - dz * vx) <= L.band + 1 && cheb(home, x, z) > coreR } }
  for (const sp of shape.spokes) {
    const wps = spokeWaypoints(home, sp.deg, coreR + 1, L.workR, L.wpStep)
    let best = null
    for (const { n, grid } of gridsFor(rayBand(sp.deg))) {
      used.push(grid)
      const r = await routeRoad(grid, wps, { pops: L.legPops, snap: L.snap, pause, atGround: true })
      if (!best || r.reached > best.r.reached) best = { r, n }
      if (r.ok) break
    }
    const vx = Math.cos(rad(sp.deg)), vz = Math.sin(rad(sp.deg))
    roads.push({ id: sp.id, kind: 'spoke', deg: sp.deg, why: sp.why, ok: best.r.ok, reached: best.r.reached, of: wps.length - 1, grade: best.n, nodes: best.r.nodes,
      rail: { from: [home.x + Math.round(vx * L.workR), home.z + Math.round(vz * L.workR)], to: [home.x + Math.round(vx * L.outpost), home.z + Math.round(vz * L.outpost)] } })
  }
  // THE RING: arcs between the spokes' crossings of the ring's radius (a junction at the spoke's own level), shaped by the octagon's
  // waypoints between them; with no spoke across it, the octagon alone, closed on itself
  const rw = ringWaypoints(home, shape.ringR, shape.chamfer, L.wpStep)
  const ang = ([x, z]) => ((Math.atan2(z - home.z, x - home.x) * 180) / Math.PI + 360) % 360
  const cross = roads.filter(r => r.nodes.length).map(r => r.nodes.reduce((b, q) => (Math.abs(cheb(home, q[0], q[1]) - shape.ringR) < Math.abs(cheb(home, b[0], b[1]) - shape.ringR) ? q : b), r.nodes[0]))
    .filter(q => Math.abs(cheb(home, q[0], q[1]) - shape.ringR) <= 2).sort((a, b) => ang(a) - ang(b))
  let chain = rw, close = true
  if (cross.length) {
    chain = []
    for (let i = 0; i < cross.length; i++) {
      const a = ang(cross[i]), b = i + 1 < cross.length ? ang(cross[i + 1]) : ang(cross[0]) + 360
      chain.push(cross[i])
      for (const w of rw) { let t = ang(w); if (t <= a) t += 360; if (t > a + 4 && t < b - 4) chain.push(w) }
    }
    chain.push(cross[0])
    close = false
  }
  let ring = null
  for (const { n, grid } of gridsFor(ringBand)) {
    used.push(grid)
    const r = await routeRoad(grid, chain, { close, pops: L.legPops, snap: L.snap, pause })
    if (!ring || r.reached > ring.r.reached) ring = { r, n }
    if (r.ok) break
  }
  roads.unshift({ id: 'ring', kind: 'ring', why: cross.length ? `ring:${cross.length}_junctions` : 'ring', ok: ring.r.ok, reached: ring.r.reached, of: chain.length - 1, grade: ring.n, nodes: ring.r.nodes })
  // ONE LEVEL A COLUMN over every road (the spokes' first: a junction keeps the spoke's level), each road's columns at it
  const level = new Map()
  for (const r of [...roads.slice(1), roads[0]]) for (const [k, sv] of roadLevels(r.nodes)) if (!level.has(k)) level.set(k, sv)
  for (const r of roads) { r.cols = [...roadLevels(r.nodes).keys()].map(k => [...k.split(',').map(Number), level.get(k)]); delete r.nodes }
  // the columns the routing met that were never read (a chunk not loaded from where the bot stands): the caller may wait for them
  const R = L.workR + 2
  const unread = Math.max(0, ...used.map(grid => gridUnread(grid, [home.x - R, home.z - R, home.x + R, home.z + R])))
  const allCols = new Map()
  for (const r of roads) for (const [x, z] of r.cols) allCols.set(k2(x, z), [x, z])
  const corridors = pathZones([...allCols.values()], L.margin).map(z => ({ box: z.box, why: 'land:road' }))
  return {
    ok: true,
    why: 'ok',
    plan: {
      v: L.v, blueprint: LAND_BLUEPRINT, plot: LAND_PLOT, home: { x: home.x, y: home.y, z: home.z }, seed, ringR: shape.ringR, chamfer: shape.chamfer, inner: shape.inner,
      roads, zones: shape.zones, ...(shape.fixed ? { fixed: shape.fixed } : {}), corridors, workR: L.workR, unread,
      // what a mayor may choose later, never geometry (owner 11-02): the spokes' order, the monument's site, names
      choices: { spokeOrder: roads.filter(r => r.kind === 'spoke').map(r => r.id), monument: null, names: {} },
      plan: plan.gen != null ? { gen: plan.gen } : null, sitedAt: now, structure_complete: true, state: 'plan', cells: [],
    },
  }
}

/**
 * THE RING ORDER -> [{ k, id, rMin, rMax, roads, upto }]. Pure. Stage 0 is tidy-01's town square (its pillars and pits, and the
 * paths' corridors to the chests and the well graded); stage 1 the ring road and the spokes out to `upto`; then each outward band
 * (rMin, rMax]: its pillars and pits, and the spokes through it out to `upto`. The last band ends at workR.
 */
/** gkstage-01: the inside-the-wall stage's id (tidy.mjs surveyInwall). */
export const INWALL_STAGE = 'inwall'
export function landStages (L = LAND) {
  const out = [{ k: 0, id: 'town', rMin: -1, rMax: L.rimR, roads: null, upto: -1 }]
  // townterrace-01 (owner 11-03): the in-wall trees, the terraces and the park, right after the plaza (terrace.mjs)
  out.push({ k: 1, id: 'terrace', rMin: -1, rMax: -1, roads: null, upto: -1 })
  out.push({ k: 2, id: 'roads', rMin: -1, rMax: -1, roads: 'ring+spokes', upto: L.rimR + L.rimStep })
  // gkstage-01 (owner 11-04: "inside the town walls first ... no holes gaps ... no dirt steps"): INSIDE THE WALL -- every 1-high
  // stray block and pillar, the litter left ON the builds, every hole -- before the bands outside; and again in every cycle (the
  // land plan wraps to it after its last band: groundskeeper.mjs gkNextStage)
  out.push({ k: 3, id: INWALL_STAGE, rMin: -1, rMax: -1, roads: null, upto: -1 })
  let k = 4
  for (let r = L.rimR; r < L.workR; r += L.rimStep, k++) out.push({ k, id: `rim${Math.min(L.workR, r + L.rimStep)}`, rMin: r, rMax: Math.min(L.workR, r + L.rimStep), roads: 'spokes', upto: Math.min(L.workR, r + 2 * L.rimStep) })
  return out
}
/** The stage after `k` -> its entry | null (after the last: the town is surveyed again after its re-survey wait). Pure. */
export const nextStage = (k, L = LAND) => landStages(L).find(s => s.k === (Number.isFinite(k) ? k : 0) + 1) ?? null
/**
 * gkstage-01 (owner 11-04: "i want them to stay busy"): THE NEXT STAGE, WRAPPING -> entry | null. Pure. The ring order's next stage;
 * after the LAST band, once the record has been complete `cycleMs`, the inside-the-wall stage again (and the bands after it, each
 * re-surveyed: a band with nothing to do is passed by the siting). The land plan never runs out of work; a cycle that finds nothing
 * anywhere publishes a complete `nothing` record and waits `cycleMs` again.
 */
export const LAND_CYCLE_MS = 30 * 60_000
export function nextStageCycle (rec, now = Date.now(), { cycleMs = LAND_CYCLE_MS, L = LAND, env = process.env } = {}) {
  const n = nextStage(recStageK(rec, L), L)
  if (n) return n
  const at = Number(rec?.completeAt)
  if (rec?.structure_complete && Number.isFinite(at) && now - at >= cycleMs) return landStages(L).find(s => s.id === cycleWrapId(env)) ?? null
  return null
}
/**
 * ROUGHGROUND-2 (owner 11-07: "slopes as 1-block terrace steps", the target pictures): the stage the cycle wraps to -> stage id. Pure.
 * The TERRACE stage by default (graded again every cycle: the ground the bots roughed up since is re-terraced, then roads, then the
 * inside, then the bands); TERRACE_CYCLE=off|0|false|no is the old wrap straight to the inside of the wall.
 */
export const cycleWrapId = (env = process.env) => (/^(off|0|false|no)$/i.test(String(env?.TERRACE_CYCLE ?? '').trim()) ? INWALL_STAGE : 'terrace')
/** A stage by number -> its entry (stage 0 when unknown). Pure. */
export const stageOf = (k, L = LAND) => landStages(L).find(s => s.k === k) ?? landStages(L)[0]
/**
 * A TIDY RECORD'S STAGE NUMBER in today's ring order -> int. Pure. By its `stageId` when it names one (townterrace-01 put the terrace
 * stage at 1: a record a groundskeeper-01 build sited at stage 1 `roads` is stage 2 now); a record of stage 1 or later sited before
 * the terrace stage existed (no `terraceV`) reads as stage 0, so the terrace stage comes next and the stages after it are asked
 * again (each finds what is still to do); else its number (0 when it has none).
 */
export function recStageK (rec, L = LAND) {
  const id = rec?.stageId
  const st = id ? landStages(L).find(s => s.id === id) : null
  // (gkstage-01, Codex r1: a record with terraceV and a number but no id is never written -- siteStage and tidyNothing set stageId
  // with terraceV -- so the numeric fallback only serves the pre-terrace records, which read 0 below)
  const k = st ? st.k : (Number.isFinite(Number(rec?.stage)) ? Number(rec.stage) : 0)
  if (k >= 1 && id !== 'terrace' && !(Number(rec?.terraceV) >= 1)) return 0
  return k
}

/**
 * A STAGE'S ROAD COLUMNS -> [[x, z, L]]: stage 1 the ring's columns and every spoke's within `upto`; a later stage every spoke's
 * columns beyond the previous stage's `upto` and within its own (a column is graded in one stage only). Pure.
 */
export function stageRoadCols (land, stage, { L = LAND } = {}) {
  const home = land?.home
  if (!land || !stage?.roads || !home) return []
  const prevUpto = stage.k <= 1 ? -1 : (stageOf(stage.k - 1, L).upto ?? -1)
  const out = []
  for (const r of land.roads ?? []) {
    if (r.kind === 'ring' && !/ring/.test(stage.roads)) continue
    for (const c of r.cols ?? []) {
      const d = cheb(home, c[0], c[1])
      if (r.kind === 'ring' || (d <= stage.upto && d > prevUpto)) out.push(c)
    }
  }
  return out
}

/** THE CORRIDORS as a refusal -> (x, z) -> 'land:road' | null. Pure. */
export function corridorAt (land) {
  const bs = (land?.corridors ?? []).map(z => z.box).filter(b => Array.isArray(b) && b.length === 6)
  return (x, z) => (bs.some(b => x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) ? 'land:road' : null)
}
/** The corridors' columns as a sapling keep-out (shop.mjs saplingAllowedAt reads `cols`) -> { cols } | null. Pure. */
export function landSaplingCols (land) {
  const cols = new Set()
  for (const z of land?.corridors ?? []) { const b = z.box; if (!Array.isArray(b) || b.length !== 6) continue; for (let x = b[0]; x <= b[3]; x++) for (let zz = b[2]; zz <= b[5]; zz++) cols.add(k2(x, zz)) }
  return cols.size ? { cols } : null
}
/** The zone of a column -> a ZONE_KINDS entry: town inside the ring, wild beyond workR, else its sector's. Pure. */
export function zoneAt (land, x, z) {
  const home = land?.home
  if (!home) return 'wild'
  const d = cheb(home, x, z)
  if (d <= (land.ringR ?? 0)) return 'town'
  if (d > (land.workR ?? LAND.workR)) return 'wild'
  const a = Math.atan2(z - home.z, x - home.x)
  return land.zones?.[SECTORS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]] ?? 'wild'
}
/** THE LAND RECORD AS A RESERVATION (the pseudo-record skills.mjs projectHeads appends): its corridors as zones, no cells. Pure. */
export const landReservation = (land, ext = null) => (land ? { plot: LAND_PLOT, blueprint: LAND_BLUEPRINT, zones: [...(land.corridors ?? []), ...parkZones(land), ...gardenZones(land), ...landPlotZones(ext)], cells: [], structure_complete: true, state: 'plan' } : null)
/**
 * wallext-01 (owner 11-04: "extend the wall around the new building leaving room for additional buildings"): THE RESERVED PLOTS inside
 * a wall extension (wall.mjs siteWallExt's record `plots`) as the land plan's zones [{ box, why: 'land:plot', id }]: every siting
 * (the sinks, site prep, the dress, a house) keeps off them; the groundskeeper's own refusals never read the land plan's reservation
 * (skills.mjs tidyInputs), so it still tidies them. A building that takes a plot later passes its id as its own exception. Pure.
 */
export function landPlotZones (ext) {
  const ok = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] >= b[0] && b[3] >= b[1]
  return (ext?.plots ?? []).filter(p => ok(p?.box)).map(p => ({ box: [p.box[0], -64, p.box[1], p.box[2], 320, p.box[3]], why: 'land:plot', id: String(p.id ?? '') }))
}
/** townterrace-01: the land plan's PARK as a reservation zone (other builds keep off it; the groundskeeper plants it). Pure. */
/** FOREST-01: the town GARDEN on the retired in-wall tree farm's ground (forest.mjs gardenOf: `land.garden`) as a reservation, as the
 *  park's: its box, every height. Pure. */
export function gardenZones (land) {
  const b = land?.garden?.box
  return Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) ? [{ box: [b[0], -64, b[1], b[2], 320, b[3]], why: 'land:garden' }] : []
}
export function parkZones (land) {
  const b = land?.park?.box
  return Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) ? [{ box: [b[0], -64, b[1], b[2], 320, b[3]], why: 'land:park' }] : []
}

/**
 * WALKING CONNECTIVITY (the offline proof's "easy to move through") -> { cols, reach, share, pts, reached }. Pure over `read`. A BFS
 * over ground column tops (`column`: tidy.mjs tidyColumn) round home from `from` ([[x, z]]; default home): a step to a 4-neighbour
 * goes up at most 1 or down at most 3, with two cells of head room over both tops, never into a liquid. `share` = columns reached /
 * read ground columns within Chebyshev r; `reached` = how many of `pts` ([[x, z]]) the walk reaches (or a 4-neighbour of). `allow(x, z)`
 * keeps the walk on some columns only (the offline proof's walk ALONG the roads); `memo` (Map "x,z" -> column) shares the column
 * scan between walks over the same ground (the stage guard's).
 */
export function walkReach (read, home, { r = LAND.workR, dy = 16, from = null, pts = [], column, allow = null, memo = null } = {}) {
  const top = memo ?? new Map()
  const col = (x, z) => { const k = k2(x, z); if (!top.has(k)) top.set(k, column(read, x, z, { yHi: home.y + dy, yLo: home.y - dy })); return top.get(k) }
  const ok = c => !!c && !c.why && c.y != null
  const clear = (x, y, z) => { const b = read(x, y, z); return !!b && b.boundingBox === 'empty' && !/water|lava/.test(String(b.name)) }
  const seen = new Set(), q = []
  for (const [x, z] of from ?? [[home.x, home.z]]) { if (ok(col(x, z)) && !seen.has(k2(x, z))) { seen.add(k2(x, z)); q.push([x, z]) } }
  for (let i = 0; i < q.length; i++) {
    const [x, z] = q[i]
    const c = col(x, z)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, k = k2(nx, nz)
      if (seen.has(k) || cheb(home, nx, nz) > r || (allow && !allow(nx, nz))) continue
      const n = col(nx, nz)
      if (!ok(n)) continue
      const up = n.y - c.y
      if (up > 1 || up < -3) continue
      const hi = Math.max(n.y, c.y)
      if (!clear(x, hi + 1, z) || !clear(x, hi + 2, z) || !clear(nx, n.y + 1, nz) || !clear(nx, n.y + 2, nz)) continue
      seen.add(k); q.push([nx, nz])
    }
  }
  let cols = 0
  for (let x = home.x - r; x <= home.x + r; x++) for (let z = home.z - r; z <= home.z + r; z++) if (ok(col(x, z))) cols++
  const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]
  const reached = pts.filter(([x, z]) => near.some(([dx, dz]) => seen.has(k2(x + dx, z + dz)))).length
  return { cols, reach: seen.size, share: cols ? seen.size / cols : 0, pts: pts.length, reached }
}
