// TIDY-01: THE TOWN-GROUND TIDY (owner 10-13 "protect the town ground"; townplan 10-20 build order names a tidy-up chore). PURE: the
// switch, the column scan, the survey (bot pillars and pits), the record, the progress and the re-survey clock. Nothing here touches
// a bot or a file.
//
// WHY (measured 11-01 on read-only region copies of all 16 fleet towns, docs/reports/tidy-01-2026-11-01.md): the bots wreck the
// ground round their plaza -- 1x1 dirt and cobblestone pillars left by escapes and climbs, holes left by digging -- so 34-40% of
// 4-adjacent ground columns differ by 2 or more (the showcase 14%) and the town's paths router (paths.mjs, +-2 fill/cut, a cut only
// through NATURAL ground) routes no leg in 15 of 16 towns. The bots are idle most of the time (~25% of bot-time in a skill).
//
// WHAT IT DOES: a project like the house, the paths and the wall (record + segments + leases, shop.mjs PROJECTS), LAST in the order
// and with no `after`, so only a bot no other project admits works it. Inside a square of half-width TIDY.r round home it
//   CUTS a PILLAR: a single column whose ground top stands TIDY.pillarMin or more above EVERY one of its 8 neighbours, every block of
//        it above the highest neighbour a bot's material (SPOIL: dirt, grass on placed dirt, cobblestone, cobbled deepslate, planks,
//        netherrack) -- cut down to the highest neighbour, top first. Natural ground (stone, sand...) is never cut. A pillar taller
//        than TIDY.pillarMax (out of a ground stand's dig reach) is left and named.
//   FILLS a PIT: a 4-connected group of columns at least TIDY.pitMin below the median ground round them (5x5), its box at most
//        TIDY.pitWide by TIDY.pitWide, whose 8-neighbour rim is all read ground: filled to the LOWEST rim column (never above any
//        neighbour: no new bump), at most TIDY.pitDepthMax cells a column (a deeper hole is a mine, left and named), dirt from the
//        bag first, then cobblestone (the project draw: OWNER 10-27, an active project may spend 80% of the reserve).
// NEVER: a protected zone, a plan cell, box or plot (the plaza and its stations), a well, the farm, a tree-farm column, any project's
// record columns or reservation (its box + PROJECT_GAP, or its own zones), a column with furniture, a trunk or leaves (trees stay),
// liquid anywhere in a pit or its rim (owner 10-27: no water bridging; water is terrain), an unread cell. A natural hill is never
// flattened: only single columns and small holes, measured against their own neighbours.

import { isLiquid, isFurniture, replaceableCell } from './townplan.mjs'
import { sitePaths, pathDests, NATURAL } from './paths.mjs'
import { stageOf, stageRoadCols, zoneAt, corridorAt, walkReach, LAND, INWALL_STAGE } from './landplan.mjs'   // groundskeeper-01; gkstage-01
import { PARK_PALETTE } from './park.mjs'   // townterrace-01: the park's roles
import { siteTerrace, terraceOn, TERRACE_STAGE, farmGuardOf } from './terrace.mjs'   // townterrace-01: the terrace stage

export const TIDY_PLOT = 'tidy'
export const TIDY_BLUEPRINT = 'tidy@1'
export const TIDY_BUILDERS = 3
/** The survey's bounds (see the header). r: half-width of the tidied square round home; dy: the scan's height band round home.y. */
export const TIDY = Object.freeze({ r: 32, dy: 14, pillarMin: 2, pillarMax: 6, pitMin: 2, pitDepthMax: 6, pitWide: 3, segCells: 24 })
/** A bot's materials: what a pillar may be made of to be cut (dirt placed in the light turns grass_block). */
export const SPOIL = /^(dirt|coarse_dirt|grass_block|cobblestone|mossy_cobblestone|cobbled_deepslate|netherrack|[a-z_]+_planks)$/
/** What a fill places: the bag's dirt first, then cobblestone. Done = any full solid (not leaves). */
export const TIDY_PALETTE = Object.freeze({ earth: ['dirt', 'cobblestone', 'coarse_dirt', 'cobbled_deepslate', '*solid'],
  // groundskeeper-01: a BURIED fill cell (under a column's top fill) takes the town's surplus cobblestone first (a sink for the
  // resource model, resource-model-1102); the top stays dirt (it greens); a road's light is a torch
  core: ['cobblestone', 'cobbled_deepslate', 'dirt', 'coarse_dirt', '*solid'], light: ['torch'],
  // townterrace-01: the park's plantings and tool uses (park.mjs PARK_PALETTE)
  ...PARK_PALETTE })
/** A complete tidy is surveyed again after this long (the bots keep digging and climbing). */
export const TIDY_RESURVEY_MS = 48 * 60 * 60_000
/** A cut a bot found no stand for (or that did not come down) in this many of its visits is given up by that bot; the record
 *  completes over the cuts every builder has given up (tidyGiveUp). */
export const TIDY_CUT_TRIES = 3
/** A clear's one-call bound (buildrun.mjs `clearMax`). */
export const TIDY_CLEAR_MAX = 48

/**
 * THE SWITCH -> bool. TIDY=on|off; unset = every pool TIDY_POOLS names (default '*'), except a pool TIDY_DEFAULT_OFF_POOLS names
 * unless named. The showcase was that pool until its groundskeeper release (11-03: tidy-01 + groundskeeper-01 owe a showcase
 * run, Codex ops audit 11-02 flag 2); TIDY=off on the showcase bots is the rollback. Pure.
 */
export const TIDY_DEFAULT_OFF_POOLS = Object.freeze([])
export function tidyOn (env = process.env, pool = '') {
  const v = String(env?.TIDY ?? '').trim().toLowerCase()
  if (v === 'on' || v === '1' || v === 'true') return true
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  if (env?.TIDY_POOLS == null && TIDY_DEFAULT_OFF_POOLS.includes(String(pool))) return false
  const pools = String(env?.TIDY_POOLS ?? '*').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'
const LEAVES = /_leaves$/
const TREE = /_(log|wood)$|^mangrove_roots$|_stem$|^bamboo$|^sugar_cane$|^cactus$/
const k2 = (x, z) => `${x},${z}`
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/**
 * ONE COLUMN -> { y, name, why, tree }. Pure. The ground is the highest full solid from yHi down, passing air, plants, snow layers,
 * torches and other open blocks; leaves and logs (and bamboo, cane, cactus) are passed too but mark the column `tree`. `why`:
 * 'unknown' (an unread cell), 'water' (a liquid or waterlogged block at or above the ground), 'furniture', 'built' (a non-full
 * placed block that is not open: a slab, a fence, glass), 'no_ground'.
 */
export function tidyColumn (read, x, z, { yHi, yLo }) {
  let tree = false
  for (let y = yHi; y >= yLo; y--) {
    const b = read(x, y, z)
    if (!b) return { y: null, name: null, why: 'unknown', tree }
    const n = nm(b)
    if (isLiquid(b) || String(b.name ?? '').includes('waterlogged') || n === 'ice') return { y: null, name: n, why: 'water', tree }
    if (AIRN(n)) continue
    if (LEAVES.test(n) || TREE.test(n)) { tree = true; continue }
    if (isFurniture(b)) return { y: null, name: n, why: 'furniture', tree }
    if (replaceableCell(b) || b.boundingBox === 'empty') continue
    if (b.boundingBox !== 'block' || /_slab$|_stairs$|_fence|_wall$|_pane$|glass|_door$|_trapdoor$|lantern|_bed$|_carpet$/.test(n)) return { y: null, name: n, why: 'built', tree }
    return { y, name: n, why: null, tree }
  }
  return { y: null, name: null, why: 'no_ground', tree }
}

// ---- THE WATER RULE (owner 11-01, applied to the tidy 11-03: "lets go with the 11-1 rule") ------------------------------------
//
// Water is terrain; bridges, boats and buckets are allowed (owner-water-boats-bridges-1101). The tidy's old refusal -- no fill and no
// cut within one block of any liquid -- goes. Every stage (stage 0's pits and corridors, the land plan's roads, the terrace) uses this
// one rule:
//   FILL  a fill cell may hold water (an embankment, a bridge footing: the block replaces it), never lava, never a waterlogged block
//         (a part: its water stays). A pit beside water is filled to the water's surface.
//   CUT   allowed beside water only when the water cannot flow into the opened cell: every water block 4-beside a cut cell at that
//         cell's height (water spreads sideways and down, never up) gets a DAM -- a fill cell placed into that water first -- and
//         the visit re-checks at the dig (buildrun.mjs `tidyOk`: no water beside the cell now, else the cut waits). Never a cut
//         within one block of lava, never beside a waterlogged block (it cannot be dammed), never a dam in a column the stage may
//         not touch (`waterOk`: wells, farm irrigation within 4 of farmland, the protected zones -- all refused, at siting and
//         again at work time).
// TIDY_WATER=strict is the rollback: the old refusal everywhere.
/** THE WATER RULE'S SWITCH -> 'owner-1101' (default) | 'strict' (the old refusal). Pure. */
export function tidyWater (env = process.env) {
  const v = String(env?.TIDY_WATER ?? '').trim().toLowerCase()
  return v === 'strict' || v === 'off' || v === '0' ? 'strict' : 'owner-1101'
}
const isWaterB = b => !!b && /^(water|bubble_column)$/.test(nm(b))
const isLavaB = b => !!b && nm(b) === 'lava'
const loggedB = b => !!b && String(b.name ?? '').includes('waterlogged')
const anyLiquid = b => !!b && (isLiquid(b) || loggedB(b))
/** A fill may go into this cell under the 11-01 rule: air, a plant, or water (never lava, never a waterlogged block). Pure. */
export const fillIntoOk = (b, water = 'owner-1101') => !!b && (AIRN(nm(b)) || replaceableCell(b) || (water !== 'strict' && isWaterB(b)))
/**
 * A CUT CELL BESIDE WATER -> { ok, why, dams: [[x, y, z]] }. Pure over `read`. Strict: any liquid within one block refuses. The 11-01
 * rule: lava within one block, or a waterlogged block 4-beside, refuses ('cut_lava' / 'cut_logged'); each water block 4-beside at the
 * cut cell's height is a dam (refused when `mayDam(x, y, z)` says no: 'cut_wet_guarded'); `removed(k)` names the cells the same
 * earthwork removes (a neighbour cut too is no wall -- its own check dams it).
 */
export function cutWater (read, x, y, z, { water = 'owner-1101', mayDam = () => true, removed = () => false } = {}) {
  if (water === 'strict') {
    for (const [dx, dz] of N8) for (let dy = -1; dy <= 1; dy++) if (anyLiquid(read(x + dx, y + dy, z + dz))) return { ok: false, why: 'cut_wet', dams: [] }
    return { ok: true, why: null, dams: [] }
  }
  for (const [dx, dz] of [[0, 0], ...N8]) for (let dy = -1; dy <= 1; dy++) if (isLavaB(read(x + dx, y + dy, z + dz))) return { ok: false, why: 'cut_lava', dams: [] }
  // water OVER the cell (a pond's bed) is never cut under (Claude water r1 BLOCKER)
  { const up = read(x, y + 1, z); if (isWaterB(up) || loggedB(up)) return { ok: false, why: 'cut_under_water', dams: [] } }
  const dams = []
  for (const [dx, dz] of N4) {
    const at = [x + dx, y, z + dz], b = read(...at)
    if (loggedB(b)) return { ok: false, why: 'cut_logged', dams: [] }
    if (!isWaterB(b)) continue
    if (removed(at.join(','))) continue
    if (!mayDam(...at)) return { ok: false, why: 'cut_wet_guarded', dams: [] }
    dams.push(at)
  }
  return { ok: true, why: null, dams }
}
/** AT THE DIG (buildrun.mjs `tidyOk`): may this cut cell come out NOW -- no water 4-beside it at its height (its dams are in), no
 *  lava within one block, no waterlogged block beside? Pure over `read`; unread reads unsafe. */
export function cutSafeNow (read, at, water = 'owner-1101') {
  const [x, y, z] = at
  for (const [dx, dz] of N4) { const b = read(x + dx, y, z + dz); if (!b || isWaterB(b) || loggedB(b) || isLavaB(b)) return false }
  // water OVER the cell would pour in (Codex water r1 BLOCKER 1)
  { const b = read(x, y + 1, z); if (!b || isWaterB(b) || loggedB(b) || isLavaB(b)) return false }
  if (water === 'strict') return true
  for (const [dx, dz] of [[0, 0], ...N8]) for (let dy = -1; dy <= 1; dy++) if (isLavaB(read(x + dx, y + dy, z + dz))) return false
  return true
}
/** A WATER COLUMN'S BED AND SURFACE -> { bed, surface, depth } | null: under the open water (water blocks only, no lava, no ice) the
 *  first full solid, within `depth` blocks. Pure over `read`. */
export function waterColumn (read, x, z, { yHi, yLo, depth = 6 } = {}) {
  let surface = null
  for (let y = yHi; y >= yLo; y--) {
    const b = read(x, y, z)
    if (!b) return null
    const n = nm(b)
    if (surface == null) { if (AIRN(n) || replaceableCell(b)) continue; if (!isWaterB(b)) return null; surface = y; continue }
    if (isWaterB(b)) { if (surface - y + 1 > depth) return null; continue }
    if (b.boundingBox === 'block' && !isLiquid(b) && !loggedB(b)) return { bed: y, surface, depth: surface - y }
    return null
  }
  return null
}

/**
 * THE SURVEY -> { cut: [{ at, name, pillar }], fill: [{ at, pit }], pillars: [...], pits: [...], skipped: { reason: n }, cols }.
 * Pure over `read`.
 *   home        { x, y, z }
 *   avoid(x,z)  -> reason | null: zones, the plan, wells, the farm, the tree farm, every project's record and reservation
 *   cells       Set "x,y,z" never touched (every project's record cells: belt and braces under `avoid`)
 *   r           half-width of the tidied square (TIDY.r)
 */
export function surveyTidy (read, { home, avoid = () => null, cells = new Set(), r = TIDY.r, rMin = -1, water = 'strict', waterOk = () => false, T = TIDY } = {}) {
  const skipped = {}
  const skip = why => { skipped[why] = (skipped[why] ?? 0) + 1 }
  if (!home || ![home.x, home.y, home.z].every(Number.isFinite)) return { ok: false, why: 'no_home', cut: [], fill: [], pillars: [], pits: [], skipped }
  const yHi = home.y + T.dy, yLo = home.y - T.dy
  const memo = new Map()
  // the scan reaches 2 past the square (the pit rule's 5x5 median, the rims)
  const col = (x, z) => { const k = k2(x, z); if (!memo.has(k)) memo.set(k, tidyColumn(read, x, z, { yHi, yLo })); return memo.get(k) }
  // groundskeeper-01 (`rMin`, a later stage's BAND): only columns beyond Chebyshev rMin of home (the town square is stage 0's)
  const inSq = (x, z) => { const d = Math.max(Math.abs(x - home.x), Math.abs(z - home.z)); return d <= r && d > rMin }
  const ground = c => !!c && !c.why && c.y != null
  const free = (x, z) => !avoid(x, z)
  const cut = [], fill = [], pillars = [], pits = []
  // ---- PILLARS ----
  for (let x = home.x - r; x <= home.x + r; x++) for (let z = home.z - r; z <= home.z + r; z++) {
    if (!inSq(x, z)) continue
    const c = col(x, z)
    if (!ground(c) || c.tree) continue
    const ns = N8.map(([dx, dz]) => col(x + dx, z + dz))
    if (!ns.every(ground)) continue
    const base = Math.max(...ns.map(n => n.y))
    const h = c.y - base
    if (h < T.pillarMin) continue
    if (!free(x, z)) { skip('pillar_guarded'); continue }
    if (h > T.pillarMax) { skip('pillar_tall'); continue }
    const blocks = []
    let natural = false, guarded = false
    for (let y = c.y; y > base; y--) {
      const n = nm(read(x, y, z))
      if (cells.has(`${x},${y},${z}`)) { guarded = true; break }
      if (!SPOIL.test(n)) { natural = true; break }
      blocks.push({ at: [x, y, z], name: n })
    }
    if (guarded) { skip('pillar_guarded'); continue }
    if (natural) { skip('pillar_natural'); continue }
    const id = `c${pillars.length}`
    pillars.push({ id, col: [x, z], top: c.y, base, h })
    for (const b of blocks) cut.push({ ...b, pillar: id })
  }
  // ---- PITS ----
  const low = new Set()
  for (let x = home.x - r; x <= home.x + r; x++) for (let z = home.z - r; z <= home.z + r; z++) {
    if (!inSq(x, z)) continue
    const c = col(x, z)
    if (!ground(c)) continue
    const ys = []
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { if (!dx && !dz) continue; const n = col(x + dx, z + dz); if (ground(n)) ys.push(n.y) }
    if (ys.length < 16) continue
    ys.sort((a, b) => a - b)
    const med = ys[Math.floor(ys.length / 2)]
    if (c.y <= med - T.pitMin) low.add(k2(x, z))
  }
  const seen = new Set()
  for (const k0 of [...low].sort()) {
    if (seen.has(k0)) continue
    const comp = [], q = [k0]
    seen.add(k0)
    for (let h = 0; h < q.length; h++) {
      comp.push(q[h])
      const [x, z] = q[h].split(',').map(Number)
      for (const [dx, dz] of N4) { const n = k2(x + dx, z + dz); if (low.has(n) && !seen.has(n)) { seen.add(n); q.push(n) } }
    }
    const cs = comp.map(k => k.split(',').map(Number))
    const xs = cs.map(c => c[0]), zs = cs.map(c => c[1])
    if (Math.max(...xs) - Math.min(...xs) + 1 > T.pitWide || Math.max(...zs) - Math.min(...zs) + 1 > T.pitWide) { skip('pit_wide'); continue }
    if (!cs.every(([x, z]) => inSq(x, z))) { skip('pit_edge'); continue }
    if (!cs.every(([x, z]) => free(x, z))) { skip('pit_guarded'); continue }
    const inC = new Set(comp)
    const rim = new Map()
    for (const [x, z] of cs) for (const [dx, dz] of N8) { const n = k2(x + dx, z + dz); if (!inC.has(n)) rim.set(n, col(x + dx, z + dz)) }
    // the 11-01 water rule: a rim column of open water is the rim at its SURFACE (the pit is filled to the water, never into it);
    // strict, or water the stage may not touch (`waterOk`: wells, farm irrigation, protected zones), is the old refusal
    if (water !== 'strict') {
      for (const [k, c] of rim) {
        if (c?.why !== 'water') continue
        const [rx, rz] = k.split(',').map(Number)
        const wc = waterOk(rx, rz) ? waterColumn(read, rx, rz, { yHi, yLo }) : null
        if (wc) rim.set(k, { y: wc.surface, name: 'water', why: null, tree: false, water: true })
      }
    }
    if ([...rim.values()].some(c => c?.why === 'water')) { skip('pit_water'); continue }
    if (![...rim.values()].every(ground)) { skip('pit_rim'); continue }
    if (cs.some(([x, z]) => col(x, z).tree)) { skip('pit_tree'); continue }
    const F = Math.min(...[...rim.values()].map(c => c.y))
    const floor = Math.min(...cs.map(([x, z]) => col(x, z).y))
    if (F - floor < T.pitMin) { skip('pit_shallow'); continue }
    if (F - floor > T.pitDepthMax) { skip('pit_deep'); continue }
    const add = []
    let bad = null
    for (const [x, z] of cs) {
      for (let y = col(x, z).y + 1; y <= F; y++) {
        const b = read(x, y, z)
        if (cells.has(`${x},${y},${z}`)) { bad = 'pit_guarded'; break }
        if (!b || !(AIRN(nm(b)) || replaceableCell(b))) { bad = 'pit_blocked'; break }
        add.push({ at: [x, y, z] })
      }
      if (bad) break
    }
    if (bad) { skip(bad); continue }
    if (!add.length) continue
    const id = `p${pits.length}`
    pits.push({ id, cols: cs, floor, level: F, n: add.length })
    for (const a of add) fill.push({ ...a, pit: id })
  }
  return { ok: true, why: 'ok', cut, fill, pillars, pits, skipped, cols: memo.size }
}

/**
 * THE RECORD -> record | null (nothing to do). Pure. `cells`: the fills, role `earth`, in LAYERED segments: the pits (and the
 * grading's column groups), nearest home first, gathered into groups of at most TIDY.segCells cells; a group's cells at height k
 * above their own column's ground are segment T-<nn>-<k>, which waits on T-<nn>-<k-1> -- so a fill is laid bottom-up and never
 * over an open cell (a cell placed against a pit's wall above an open one would leave a hole under it, and seal a bot standing in
 * a 1x1 pit). `cut`: the pillar and grading cut blocks, top first (the visit digs them: buildrun.mjs `p.tidy`). `clear`: the
 * leaves in a grading fill cell. `zones`: none (the tidy reserves nothing).
 */
export function tidyRecord (s, { home, plan = null, now = Date.now(), r = TIDY.r, T = TIDY } = {}) {
  if (!s?.ok || (!s.cut.length && !s.fill.length)) return null
  const d = p => Math.max(Math.abs(p.cols[0][0] - home.x), Math.abs(p.cols[0][1] - home.z))
  const pits = [...s.pits].sort((a, b) => d(a) - d(b) || a.cols[0][0] - b.cols[0][0] || a.cols[0][1] - b.cols[0][1])
  const cells = [], segments = []
  let group = -1, n = Infinity
  const segs = new Set()
  const segOf = (gi, k) => `T-${String(gi).padStart(2, '0')}-${k}`
  for (const p of pits) {
    const mine = s.fill.filter(f => f.pit === p.id)
    if (!mine.length) continue
    if (n + mine.length > T.segCells) { group++; n = 0 }
    n += mine.length
    const base = new Map()
    for (const f of mine) { const k = k2(f.at[0], f.at[2]); base.set(k, Math.min(base.get(k) ?? Infinity, f.at[1])) }
    for (const f of mine.sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])) {
      const k = f.at[1] - base.get(k2(f.at[0], f.at[2]))
      const seg = segOf(group, k)
      if (!segs.has(seg)) { segs.add(seg); segments.push({ seg, deps: k > 0 ? [segOf(group, k - 1)] : [] }) }
      cells.push({ at: f.at, role: 'earth', seg })
    }
  }
  // every group's ground layer first, then every group's next (a visit meets a layer whose dependency another builder holds only
  // after every ground layer: runVisit stops `deps_open` there)
  const lk = sg => { const m = /^T-(\d+)-(\d+)$/.exec(sg); return [Number(m[2]), Number(m[1])] }
  segments.sort((a, b) => { const [ka, ga] = lk(a.seg), [kb, gb] = lk(b.seg); return ka - kb || ga - gb })
  const cut = [...s.cut].sort((a, b) => b.at[1] - a.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2]).map(c => ({ at: c.at, kind: 'tidy', name: c.name }))
  return {
    v: 1, blueprint: TIDY_BLUEPRINT, plot: TIDY_PLOT, home: { x: home.x, y: home.y, z: home.z }, r,
    cells, clear: [...(s.clear ?? [])].sort((a, b) => a.at[1] - b.at[1]), cut, replant: [], segments, zones: [],
    pillars: s.pillars.length, pits: s.pits.length, skipped: s.skipped,
    bom: { earth: cells.length }, builders_max: TIDY_BUILDERS,
    structure_complete: false, plan: plan?.gen != null ? { gen: plan.gen } : null, sitedAt: now,
  }
}

/** A cut block still standing (the world holds the block it was listed for; unread = still standing). Pure. */
export const cutStanding = (read, c) => { const b = read(...c.at); return !b || nm(b) === c.name }
/**
 * THE PROGRESS -> { cutLeft, fillLeft, cutDone, fillDone }. Pure. `fillDone(cell)` is the visit's done test (buildrun.mjs cellDone
 * with TIDY_PALETTE, or a waiver); a cut is left while it stands and is not given up (`given(key)`).
 */
export function tidyProgress (rec, read, { fillDone, given = () => false } = {}) {
  let cutLeft = 0, cutDone = 0, fillLeft = 0, fillD = 0
  for (const c of rec?.cut ?? []) { if (cutStanding(read, c) && !given(c.at.join(','))) cutLeft++; else cutDone++ }
  for (const c of rec?.cells ?? []) { if (fillDone(c)) fillD++; else fillLeft++ }
  return { cutLeft, cutDone, fillLeft, fillDone: fillD }
}
/**
 * THE GIVEN-UP CUTS (a bot's own memory for the connection): a cut this bot's visit EVALUATED (runVisit `tidied`: a stand looked
 * for) that still stands after the visit is counted; at TIDY_CUT_TRIES it is given up by this bot. Mutates and returns `mem`
 * (Map key -> n). Pure.
 */
export function tidyNoteCuts (mem, tidied = [], standing = () => true) {
  for (const k of new Set(tidied)) if (standing(k)) mem.set(k, (mem.get(k) ?? 0) + 1)
  return mem
}
export const tidyGivenUp = (mem, k, tries = TIDY_CUT_TRIES) => (mem?.get(k) ?? 0) >= tries
/** The visit's cut list (buildrun.mjs `p.tidy`): the cuts still standing that this bot has not given up, top first. Pure. */
export const tidyCuts = (rec, read, mem = null) => (rec?.cut ?? []).filter(c => cutStanding(read, c) && !tidyGivenUp(mem, c.at.join(',')))
/** Is a COMPLETE tidy due its re-survey (TIDY_RESURVEY_MS after its completion)? A completion in the future reads not due. Pure. */
export const tidyDue = (rec, now = Date.now()) => rec?.blueprint === TIDY_BLUEPRINT && rec?.structure_complete === true && Number.isFinite(Number(rec.completeAt)) && Number(rec.completeAt) <= now + 60_000 && now - Number(rec.completeAt) >= TIDY_RESURVEY_MS
/** A NOTHING-TO-DO record (the survey found no pillar and no pit): complete at once, surveyed again after TIDY_RESURVEY_MS. Pure. */
export function tidyNothing ({ home, now = 0, by = '?', skipped = {} } = {}) {
  return { v: 1, blueprint: TIDY_BLUEPRINT, plot: TIDY_PLOT, home: home ? { x: home.x, y: home.y, z: home.z } : null, state: 'nothing', structure_complete: true,
    completeAt: now, cells: [], clear: [], cut: [], replant: [], segments: [], zones: [], pillars: 0, pits: 0, skipped, sitedBy: by }
}
/**
 * THE PATHS ASKED AGAIN (the tidy's purpose): a paths NO-SITE record (paths.mjs pathsNoSite, retried after 24 h) whose retry is
 * later than `now` is brought forward to `now` when a tidy completes having changed the ground (a cut or a fill landed). -> the
 * mutated record | null (nothing to change). `isNoSite` is paths.mjs pathsNoSiteRec. Pure.
 */
export function pathsRetryNow (cur, now, isNoSite) {
  if (!cur || !isNoSite(cur)) return null
  if (!(Number(cur.retryAt) > now)) return null
  return { ...cur, retryAt: now, retryBy: 'tidy' }
}
/** Sapling keep-out: none (the tidy reserves no ground). The walk radius (buildrun.mjs walkR): r + 8, at least 48. Pure. */
export const tidyWalkR = rec => Math.max(48, (Number(rec?.r) || TIDY.r) + 8)
/**
 * WHERE THE TIDY NEVER WORKS -> (x, z) -> reason | null. Pure. `avoid` is paths.mjs pathAvoid over the town (zones, the plan's cells,
 * boxes and plots, wells, the composter, the tree farm, every project's record columns); `pzones` every project's reservation
 * (shop.mjs recordZones: a record's box + PROJECT_GAP, or the zones it names: the paths' and the wall's columns + 1).
 */
export function tidyAvoid (avoid = () => null, pzones = []) {
  return (x, z) => {
    const a = avoid(x, z)
    if (a) return a
    for (const zb of pzones) { const b = zb?.box ?? zb; if (Array.isArray(b) && b.length === 6 && x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return String(zb?.why ?? 'project') }
    return null
  }
}
/** The block-level overlay of a tidy done (the offline proof's simulated world): cuts read air, fills read `fillName`. Pure. */
export function tidyOverlay (read, rec, fillName = 'dirt') {
  const air = new Set([...(rec?.cut ?? []), ...(rec?.clear ?? [])].map(c => c.at.join(','))), solid = new Set((rec?.cells ?? []).map(c => c.at.join(',')))
  const A = { name: 'air', boundingBox: 'empty' }, F = { name: fillName, boundingBox: 'block' }
  return (x, y, z) => { const k = `${x},${y},${z}`; return air.has(k) ? A : solid.has(k) ? F : read(x, y, z) }
}
/** THE GROUND'S ROUGHNESS over the square -> { pairs, d2, d5 }: 4-adjacent read ground column pairs and how many differ by 2+ / 5+. */
export function tidyRoughness (read, home, { r = TIDY.r, T = TIDY } = {}) {
  const col = new Map()
  const g = (x, z) => { const k = k2(x, z); if (!col.has(k)) { const c = tidyColumn(read, x, z, { yHi: home.y + T.dy, yLo: home.y - T.dy }); col.set(k, !c.why && c.y != null ? c.y : null) } return col.get(k) }
  let pairs = 0, d2 = 0, d5 = 0
  for (let x = home.x - r; x <= home.x + r; x++) for (let z = home.z - r; z <= home.z + r; z++) {
    const a = g(x, z)
    if (a == null) continue
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      if (Math.max(Math.abs(x + dx - home.x), Math.abs(z + dz - home.z)) > r) continue
      const b = g(x + dx, z + dz)
      if (b == null) continue
      pairs++
      if (Math.abs(a - b) >= 2) d2++
      if (Math.abs(a - b) >= 5) d5++
    }
  }
  return { pairs, d2, d5 }
}

// ---- THE GRADING (the paths' corridors) --------------------------------------------------------------------------------------
//
// MEASURED (11-01, the 16 fleet towns' region copies): cutting every bot pillar and filling every small pit leaves the paths router
// exactly where it was -- 46% of 4-adjacent column pairs in board-b differ by 2+ and stay 44% after; a 5x5 median smoothing moving
// 2,600 blocks still routes no leg. The fleet towns are QUARRIED (29% of board-b's tops are cobblestone, 19% stone): the legs fail
// on steps of 3-8 between the plaza's platform and the dug ground round it, and the router may neither fill or cut more than 2
// nor cut through cobblestone. Routed with TIDY_GRADE (fill and cut 4, the bots' own spoil cuttable) 6 of 16 towns' networks
// route; so the tidy GRADES those corridors: the earthwork of the legs that route under TIDY_GRADE -- each column brought to its
// leg's level (filled with earth up to it, or cut down to it) -- and nothing else (no tree, no plant: those are the paths' own
// clears). After it the paths' own router (+-2, natural cuts only) finds those corridors at no earthwork.
/** The grading router's limits (paths.mjs columnCost `lim`): fill and cut 4, a cut through natural ground or the bots' spoil. */
/** The grading's fills: this many columns a segment. */
export const GRADE_SEG_COLS = 8
const fillable = b => !!b && (AIRN(nm(b)) || replaceableCell(b) || LEAVES.test(nm(b)))
const wetAt = read => (x, y, z) => { for (const [dx, dz] of N8) for (let dy = -1; dy <= 1; dy++) { const b = read(x + dx, y + dy, z + dz); if (b && (isLiquid(b) || String(b.name ?? '').includes('waterlogged'))) return true } return false }
/** The grading router's limits (paths.mjs columnCost `lim`): fill and cut `n`, a cut through natural ground or the bots' spoil and
 *  never beside water, a fill only into air, a plant or leaves. The bigger allowance is tried too (gradeBest). */
export const gradeLim = (read, n = 4, water = tidyWater(), { waterOk = () => false } = {}) => {
  const wet = wetAt(read)
  // the 11-01 water rule: a fill may go into water the stage may touch; a cut beside water only where its dams may go (Codex water r1
  // BLOCKER 2: the router routes round a cut whose dam the earthwork would refuse -- the same `waterOk` as the earthwork's)
  if (water !== 'strict') return { fillMax: n, cutMax: n, cut: GRADE_CUT, water, fillOk: (b, x, y, z) => fillable(b) || (fillIntoOk(b, water) && (x == null || waterOk(x, z))), cutOk: (b, x, y, z) => cutWater(read, x, y, z, { water, mayDam: (dx, dy, dz) => waterOk(dx, dz) }).ok }
  return { fillMax: n, cutMax: n, cut: GRADE_CUT, water, fillOk: b => fillable(b), cutOk: (b, x, y, z) => !wet(x, y, z) }
}
export const GRADE_CUT = new RegExp(`${NATURAL.source}|${SPOIL.source}`)
export const TIDY_GRADES = Object.freeze([4, 6, 8])
/**
 * THE GRADING -> { ok, why, cut: [{ at, name }], fill: [{ at }], legs: [{ id, ok }], skipped }. Pure over `read`. `pin` is the
 * paths' siting inputs (paths.mjs sitePaths' `o`: plan, zones, caps, plinth, composter, farm, projects, place); `cells` the record
 * cells never touched. A column whose fill would go into anything but air or a replaceable plant (leaves, a log, a part), or whose
 * cut would reach a cell beside water (a cut there lets the water in), or into a record cell, is left to the paths (named).
 */
export const GRADE_FRONT = 3
export function gradeTidy (read, pin, { cells = new Set(), lim = gradeLim(read, 4), reserved = () => null, waterOk = () => false } = {}) {
  const skipped = {}
  const skip = why => { skipped[why] = (skipped[why] ?? 0) + 1 }
  if (!pin?.plan?.home) return { ok: false, why: 'no_plan', cut: [], fill: [], legs: [], skipped }
  const strict = sitePaths(read, pin)
  if (strict.ok) return { ok: false, why: 'paths_route', cut: [], fill: [], legs: [], skipped }
  // the grading router refuses another project's reservation too, but for the columns near a destination (a front approach)
  const D = pathDests(pin)
  const front = new Set()
  for (const d of D.dests ?? []) for (const [fx, fz] of d.cols) for (let dx = -GRADE_FRONT; dx <= GRADE_FRONT; dx++) for (let dz = -GRADE_FRONT; dz <= GRADE_FRONT; dz++) front.add(k2(fx + dx, fz + dz))
  const s = sitePaths(read, { ...pin, lim: { ...lim, avoid: (x, z) => (front.has(k2(x, z)) ? null : (reserved(x, z) ? 'reserved' : null)) } })
  if (!s.net || !s.grid) return { ok: false, why: String(s.why ?? 'no_net'), cut: [], fill: [], legs: [], skipped }
  const legs = s.net.legs.filter(l => !l.optional || l.ok).map(l => ({ id: l.id, ok: l.ok }))
  const routed = s.net.legs.filter(l => l.ok && l.nodes.length)
  const home = pin.plan.home
  const wet = (x, y, z) => { for (const [dx, dz] of N8) for (let dy = -1; dy <= 1; dy++) { const b = read(x + dx, y + dy, z + dz); if (b && (isLiquid(b) || String(b.name ?? '').includes('waterlogged'))) return true } return false }
  // per column: the LOWEST level any routed brush over it is laid at -- graded to that, every brush over it is a fill of at most 2
  // above it (brushes in a row differ by one; a column lies under at most four of them), so the paths' own router (fill 2, a cut
  // only through natural ground) lays each of those brushes without a cut
  const byCol = new Map()
  for (const l of routed) for (const [x, z, sv] of l.nodes) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const k = k2(x + dx, z + dz); byCol.set(k, Math.min(byCol.get(k) ?? Infinity, sv)) }
  const cut = [], fill = [], clear = [], dam = []
  const water = lim.water ?? 'strict'
  const damK = new Set()
  for (const [k, L] of [...byCol].sort()) {
    const [x, z] = k.split(',').map(Number)
    const g = s.grid.col(x, z)?.y
    if (!Number.isFinite(g) || g === L) continue
    if (reserved(x, z) && !front.has(k)) { skip('grade_reserved'); continue }
    if (L > g) {
      const add = [], lv = []
      let bad = null
      for (let y = g + 1; y <= L; y++) {
        const b = read(x, y, z), n = nm(b)
        if (cells.has(`${x},${y},${z}`)) { bad = 'grade_guarded'; break }
        // leaves in a fill cell are cleared first (a log is a tree: the column is left to the paths)
        if (b && LEAVES.test(n)) lv.push({ at: [x, y, z], kind: 'leaves', name: n })
        else if (!b || !(AIRN(n) || replaceableCell(b) || (water !== 'strict' && waterOk(x, z) && fillIntoOk(b, water)))) { bad = 'grade_fill_blocked'; break }
        add.push({ at: [x, y, z] })
      }
      if (bad) { skip(bad); continue }
      fill.push(...add); clear.push(...lv)
    } else {
      const add = [], dm = []
      let bad = null
      for (let y = g; y > L; y--) {
        const b = read(x, y, z), n = nm(b)
        if (cells.has(`${x},${y},${z}`)) { bad = 'grade_guarded'; break }
        if (!b || !lim.cut.test(n)) { bad = 'grade_cut_blocked'; break }
        // the 11-01 water rule (cutWater): dam the water beside the cell first, or (strict) the old refusal
        const cw = water === 'strict' ? (wet(x, y, z) ? { ok: false, why: 'grade_wet' } : { ok: true, dams: [] }) : cutWater(read, x, y, z, { water, mayDam: (dx, dy, dz) => waterOk(dx, dz) && !reserved(dx, dz) && !cells.has(`${dx},${dy},${dz}`) })
        if (!cw.ok) { bad = cw.why === 'cut_wet' ? 'grade_wet' : cw.why; break }
        dm.push(...cw.dams)
        add.push({ at: [x, y, z], name: n })
      }
      if (bad) { skip(bad); continue }
      cut.push(...add)
      for (const d of dm) if (!damK.has(d.join(','))) { damK.add(d.join(',')); dam.push({ at: d, dam: true }) }
    }
  }
  return { ok: true, why: 'ok', cut, fill: [...fill, ...dam.filter(d => !fill.some(f => f.at.join(',') === d.at.join(',')))], clear, legs, skipped, home, dams: dam.length }
}

/**
 * THE SITING -> { ok, why, record, survey, grade, tried }. Pure over `read`. The survey (pillars, pits) round home, and -- when `pin`
 * is given (the paths are not laid yet, or stand as a no-site record) -- the grading of the paths' corridors, tried at every
 * allowance of TIDY_GRADES: each candidate (survey + grading) is checked by the paths' OWN router on the ground as the tidy would
 * leave it (tidyOverlay), and the one leaving the fewest required legs unrouted is the record (ties: fewer cells). A column the
 * grading touches is the grading's alone. The bot's own (skills.mjs buildTidy) and the offline proof's (scripts/tidy-offline.mjs).
 */
export function siteTidy (read, { home, avoid = () => null, cells = new Set(), pin = null, plan = null, r = TIDY.r, now = Date.now(), grades = TIDY_GRADES, water = 'strict', waterOk = () => false } = {}) {
  // townterrace-01 (owner 11-01 rule): `water` 'owner-1101' fills beside and into water, dams a cut's water first; `waterOk(x, z)`
  // the columns whose water the stage may touch (never a well, farm irrigation, a protected zone). Default strict: tidy-01 as before
  const survey = surveyTidy(read, { home, avoid, cells, r, water, waterOk })
  if (!survey.ok) return { ok: false, why: survey.why, record: null, survey, grade: null, tried: [] }
  const build = grade => {
    // a column the grading touches is the grading's alone (a pit's fill on a column it cuts would float; a pillar's cut under its
    // fill would leave a hole): the survey's cuts and fills there are dropped
    const gcols = new Set(grade?.ok ? [...grade.cut, ...grade.fill].map(c => k2(c.at[0], c.at[2])) : [])
    const mineCol = c => !gcols.has(k2(c.at[0], c.at[2]))
    const s = { ...survey, cut: survey.cut.filter(mineCol), fill: survey.fill.filter(mineCol), clear: [] }
    s.pits = survey.pits.filter(p => s.fill.some(f => f.pit === p.id))
    s.pillars = survey.pillars.filter(p => s.cut.some(c => c.pillar === p.id))
    if (grade?.ok) {
      s.clear = grade.clear ?? []
      s.cut.push(...grade.cut.map(c => ({ ...c, pillar: 'grade' })))
      // the grading's fills in segments of GRADE_SEG_COLS columns, after the pits (tidyRecord orders them nearest home first)
      const cols = [...new Set(grade.fill.map(c => k2(c.at[0], c.at[2])))]
      for (let i = 0; i < cols.length; i += GRADE_SEG_COLS) {
        const id = `g${i / GRADE_SEG_COLS}`
        const mine = new Set(cols.slice(i, i + GRADE_SEG_COLS))
        const fs = grade.fill.filter(c => mine.has(k2(c.at[0], c.at[2])))
        s.pits.push({ id, cols: [...mine].map(q => q.split(',').map(Number)), grade: true, n: fs.length })
        for (const f of fs) s.fill.push({ ...f, pit: id })
      }
    }
    const record = tidyRecord(s, { home, plan, now, r })
    if (record) record.grade = grade ? { ok: grade.ok, why: grade.why, n: grade.n ?? null, cut: grade.cut.length, fill: grade.fill.length, legs: grade.legs, skipped: grade.skipped } : null
    return record
  }
  const unrouted = rec => { const q = sitePaths(rec ? tidyOverlay(read, rec) : read, pin); return q.ok ? 0 : (q.net?.legs ?? []).filter(l => !l.ok && !l.optional).length || 99 }
  const tried = []
  let best = null
  if (pin) {
    for (const n of grades) {
      const grade = gradeTidy(read, pin, { cells, lim: gradeLim(read, n, water, { waterOk }), reserved: avoid, waterOk })
      grade.n = n
      if (!grade.ok) { tried.push({ n, why: grade.why }); if (grade.why === 'paths_route') break; continue }
      const record = build(grade)
      const left = unrouted(record)
      const size = (record?.cells.length ?? 0) + (record?.cut.length ?? 0)
      tried.push({ n, left, size })
      if (!best || left < best.left || (left === best.left && size < best.size)) best = { record, grade, left, size }
      if (left === 0) break
    }
  }
  if (!best) { const record = build(null); return { ok: true, why: record ? 'ok' : 'nothing', record, survey, grade: null, tried } }
  if (best.record) best.record.tried = tried
  return { ok: true, why: best.record ? 'ok' : 'nothing', record: best.record, survey, grade: best.grade, tried }
}

// ---- GROUNDSKEEPER-01: THE LAND PLAN'S STAGES ------------------------------------------------------------------------------------
//
// The groundskeeper (groundskeeper.mjs: one leased bot a town) works the town's land plan (landplan.mjs) stage by stage, the ring
// order: stage 0 is tidy-01's town square as it is; stage 1 grades the ring road and the spokes' first reach; each later stage
// tidies one outward band (its pillars and pits, tidy-01's survey with rMin) and grades the spokes through it. A stage is one
// generation of the same tidy record (`stage`), so the visit, the leases, the waiver and the completion are tidy-01's.

/**
 * townterrace-01: a stage record's `stage` NUMBER is groundskeeper-01's ring order (town 0, roads 1, rim48 2 ...), the terrace stage
 * 0; today's order is read from `stageId` (landplan.mjs recStageK). So a code rollback to groundskeeper-01 reads a terrace record as
 * the town's stage done and goes on with the roads, and a roads record as its own stage 1 (Claude r1 note: a renumbered ring
 * skipped the roads after a rollback). Pure.
 */
// gkstage-01 (Codex r1 BLOCKER 2): `inwall` (k 3) takes no legacy number of its own -- it reads as roads' 1, so a rollback's ring order
// goes on to the bands; the bands keep theirs (k 4 -> 2: rim48 is 2 as before the insertion)
export const legacyStage = st => (st?.id === TERRACE_STAGE ? 0 : st?.id === INWALL_STAGE ? 1 : st?.k >= 4 ? st.k - 2 : st?.k >= 2 ? st.k - 1 : (st?.k ?? 0))
/**
 * THE CELLS A STAGE CARRIES ON (townterrace-01, Codex r1 note): when the next stage's generation replaces the record, every cell of
 * the one before is carried into it as a PREVIOUS cell (seg PREV_SEG, `prev: true`) -- no segment names it, so no visit works it,
 * and the visit, the bill and the completion read it as done (skills.mjs buildTidy `waivedK`). The showcase tripwire judges a
 * placement against the HEAD record's cells (shopread.py.txt judge, op=place), so a stage's own placements read in the window after
 * the next stage is sited stay on the record. At most `max` (the newest kept). Pure.
 */
export const PREV_SEG = 'T-PREV'
export const PREV_MAX = 8000
export function stageCarry (body, cur, max = PREV_MAX) {
  if (!body || !cur?.cells?.length) return body
  // Codex + Claude r2 BLOCKER: never a previous cell on one of this stage's cuts or clears (clears() never digs under a record cell)
  const have = new Set([...(body.cells ?? []).map(c => c.at.join(',')), ...(body.cut ?? []).map(c => c.at.join(',')), ...(body.clear ?? []).map(c => c.at.join(','))])
  const prev = []
  for (const c of cur.cells) { const k = c.at.join(','); if (have.has(k)) continue; have.add(k); prev.push({ at: c.at, role: c.role, seg: PREV_SEG, prev: true }) }
  return { ...body, cells: [...(body.cells ?? []), ...prev.slice(Math.max(0, prev.length - max))] }
}
/** A road light every this many road columns (a torch on the corridor's edge column). */
export const ROAD_LIGHT_EVERY = 12
/** A felled road trunk's sapling (oak for dark oak: one sapling never grows a dark oak). */
export const SAPLING_OF = Object.freeze({ oak_log: 'oak_sapling', birch_log: 'birch_sapling', spruce_log: 'spruce_sapling', jungle_log: 'jungle_sapling', acacia_log: 'acacia_sapling', dark_oak_log: 'oak_sapling', cherry_log: 'cherry_sapling', mangrove_log: 'mangrove_propagule', pale_oak_log: 'oak_sapling' })
const SOIL_RE = /^(grass_block|dirt|podzol|coarse_dirt|rooted_dirt|moss_block|mycelium)$/
/** A sapling's room: this many air cells above its soil (birch needs 6; sapling-clearance measured 09-28). */
export const REPLANT_AIR = 6
const LOG_RE = /_(log|wood)$|^mangrove_roots$/

/**
 * THE ROAD'S EARTHWORK -> { cut, fill, clear, trees, skipped }. Pure over `read`. Each road column ([x, z, L], landplan.mjs
 * roadLevels) brought to its level L: filled with earth from its ground up to L (only into air, a plant or leaves -- leaves are
 * cleared first), or cut down to L (only through natural ground or the bots' spoil, never beside water); then its head room
 * (L+1, L+2) opened: leaves cleared, and a TRUNK standing there felled whole (every log of that column above the ground, kind
 * `tree`, one replant owed: `trees`). A column whose earthwork would touch a record cell, or that cannot be brought level, is left
 * (named in `skipped`): the road is graded round it by the paths later.
 */
export function roadWork (read, cols, { home, cells = new Set(), lim, avoid = () => null, waterOk = () => false, T = TIDY } = {}) {
  const skipped = {}
  const skip = why => { skipped[why] = (skipped[why] ?? 0) + 1 }
  const cut = [], fill = [], clear = [], trees = []
  const wet = wetAt(read)
  const water = lim?.water ?? 'strict'
  const damK = new Set()
  for (const [x, z, L] of cols) {
    // Codex r1 BLOCKER 1: the plan was routed once; a zone, the plan's cells or a project sited SINCE are refused NOW (the tidy's
    // own guard: zones, the plan, wells, the farm, every project's record and reservation) -- never cut, filled or cleared
    if (avoid(x, z)) { skip('road_guarded'); continue }
    let c = tidyColumn(read, x, z, { yHi: home.y + T.dy, yLo: home.y - T.dy })
    // the 11-01 water rule: a road column of open water is an EMBANKMENT -- filled from its bed up to the road's level
    if (c.why === 'water' && water !== 'strict' && waterOk(x, z)) { const wc = waterColumn(read, x, z, { yHi: home.y + T.dy, yLo: home.y - T.dy }); if (wc && L - wc.bed <= (lim?.fillMax ?? 6) && L >= wc.surface) c = { y: wc.bed, name: 'water_bed', why: null, tree: false } }
    if (c.why || c.y == null) { skip(`road_${c.why ?? 'no_ground'}`); continue }
    const g = c.y
    const add = [], lv = [], cu = [], dm = []
    let bad = null
    if (L > g) {
      for (let y = g + 1; y <= L; y++) {
        const b = read(x, y, z), n = nm(b)
        if (cells.has(`${x},${y},${z}`)) { bad = 'road_guarded'; break }
        if (b && LEAVES.test(n)) lv.push({ at: [x, y, z], kind: 'leaves', name: n })
        else if (!b || !(AIRN(n) || replaceableCell(b) || (water !== 'strict' && waterOk(x, z) && fillIntoOk(b, water)))) { bad = 'road_fill_blocked'; break }   // (the cell guard is above: every fill and leaves cell)
        add.push({ at: [x, y, z] })
      }
    } else if (L < g) {
      for (let y = g; y > L; y--) {
        const b = read(x, y, z), n = nm(b)
        if (cells.has(`${x},${y},${z}`)) { bad = 'road_guarded'; break }
        if (!b || !lim.cut.test(n)) { bad = 'road_cut_blocked'; break }
        const cw = water === 'strict' ? (wet(x, y, z) ? { ok: false, why: 'cut_wet' } : { ok: true, dams: [] }) : cutWater(read, x, y, z, { water, mayDam: (dx, dy, dz) => waterOk(dx, dz) && !avoid(dx, dz) && !cells.has(`${dx},${dy},${dz}`) })
        if (!cw.ok) { bad = cw.why === 'cut_wet' ? 'road_wet' : `road_${cw.why}`; break }
        dm.push(...cw.dams)
        cu.push({ at: [x, y, z], name: n })
      }
    }
    if (bad) { skip(bad); continue }
    // the head room over the finished level: leaves cleared, a trunk felled whole (its logs from the ground up)
    let trunk = null
    for (let y = Math.max(L, g) + 1; y <= Math.max(L, g) + 2; y++) {
      const b = read(x, y, z), n = nm(b)
      if (!b) { bad = 'road_unknown'; break }
      if (cells.has(`${x},${y},${z}`)) { bad = 'road_guarded'; break }
      if (LEAVES.test(n) && !lv.some(q => q.at[1] === y)) lv.push({ at: [x, y, z], kind: 'leaves', name: n })
      else if (LOG_RE.test(n)) trunk = n
    }
    if (bad) { skip(bad); continue }
    if (trunk) {
      const logs = []
      for (let y = g + 1; y <= g + T.dy; y++) { const b = read(x, y, z), n = nm(b); if (!b) break; if (LOG_RE.test(n)) logs.push({ at: [x, y, z], kind: 'tree', name: n }); else if (!AIRN(n) && !LEAVES.test(n)) break }
      if (logs.some(q => cells.has(q.at.join(',')))) { skip('road_guarded'); continue }
      clear.push(...logs)
      trees.push({ col: [x, z], name: trunk })
    }
    fill.push(...add); clear.push(...lv); cut.push(...cu)
    for (const d of dm) if (!damK.has(d.join(','))) { damK.add(d.join(',')); fill.push({ at: d, dam: true }) }
  }
  return { cut, fill, clear, trees, skipped }
}

/**
 * REPLANT CELLS for felled road trunks -> [{ cell, species, sapling, state }]. Pure. In the land plan's TREEFARM zone (else any
 * wild sector), within its worked radius, on soil with REPLANT_AIR air above, spaced 4 apart, never in a corridor, a refusal of
 * `avoid` or a record cell's column; nearest home first. Fewer cells than trees: the rest are owed none (the visit fells a trunk
 * only once every listed replant stands: buildrun.mjs B4).
 */
export function replantCells (read, land, trees, { avoid = () => null, cells = new Set(), r = LAND.workR, T = TIDY } = {}) {
  const home = land?.home
  if (!home || !trees.length) return []
  const road = corridorAt(land)
  const cellCols = new Set([...cells].map(k => { const [x, , z] = k.split(','); return `${x},${z}` }))
  const want = [...new Set(['treefarm', 'wild'])]
  const out = [], used = []
  for (const kind of want) {
    const cand = []
    for (let x = home.x - r; x <= home.x + r; x += 2) for (let z = home.z - r; z <= home.z + r; z += 2) {
      if (zoneAt(land, x, z) !== kind) continue
      cand.push([Math.max(Math.abs(x - home.x), Math.abs(z - home.z)), x, z])
    }
    cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    for (const [, x, z] of cand) {
      if (out.length >= trees.length) return out
      if (used.some(([ux, uz]) => Math.max(Math.abs(ux - x), Math.abs(uz - z)) < 4)) continue
      if (road(x, z) || avoid(x, z) || cellCols.has(`${x},${z}`)) continue
      const c = tidyColumn(read, x, z, { yHi: home.y + T.dy, yLo: home.y - T.dy })
      if (c.why || c.y == null || c.tree || !SOIL_RE.test(c.name)) continue
      let open = true
      for (let y = c.y + 1; y <= c.y + REPLANT_AIR; y++) { const b = read(x, y, z); if (!b || !AIRN(nm(b))) { open = false; break } }
      if (!open) continue
      const t = trees[out.length]
      out.push({ cell: [x, c.y + 1, z], species: t.name.replace(/_(log|wood)$/, ''), sapling: SAPLING_OF[t.name] ?? 'oak_sapling', state: 'pending' })
      used.push([x, z])
    }
  }
  return out
}

/**
 * ROAD LIGHTS -> [{ at }]: a torch every ROAD_LIGHT_EVERY road columns, on the first corridor-edge column beside the road (not a
 * road column, not refused by `avoid`, its ground a full solid with air above), at most `n`. Pure.
 */
export function roadLights (read, cols, { home, avoid = () => null, n = 0, cells = new Set(), T = TIDY } = {}) {
  if (!(n > 0) || !cols.length) return []
  const roadSet = new Set(cols.map(([x, z]) => k2(x, z)))
  const out = []
  const sorted = [...cols].sort((a, b) => Math.atan2(a[1] - home.z, a[0] - home.x) - Math.atan2(b[1] - home.z, b[0] - home.x) || a[0] - b[0] || a[1] - b[1])
  for (let i = 0; i < sorted.length && out.length < n; i += ROAD_LIGHT_EVERY) {
    const [x, z] = sorted[i]
    for (const [dx, dz] of N8) {
      const ex = x + dx, ez = z + dz
      if (roadSet.has(k2(ex, ez)) || avoid(ex, ez)) continue
      const c = tidyColumn(read, ex, ez, { yHi: home.y + T.dy, yLo: home.y - T.dy })
      if (c.why || c.y == null || c.tree) continue
      const at = [ex, c.y + 1, ez]
      const b = read(...at)
      if (!b || !AIRN(nm(b)) || cells.has(at.join(','))) continue
      if (out.some(o => Math.max(Math.abs(o.at[0] - ex), Math.abs(o.at[2] - ez)) < 6)) continue
      out.push({ at })
      break
    }
  }
  return out
}

// ================================================================================================================================
// GKSTAGE-01: INSIDE THE WALL (owner 11-04: "inside the town walls first ... visually appealing and clean, like a normal town ... no
// holes gaps ... i dont want dirt steps on things where bots needed to get up"). LIVE showcase 11-04 (a 13:00Z copy, the 80x58
// interior): 93 stray SPOIL blocks standing above every neighbour (16 one high), 4 on a build (paths, the wall), 201 columns lower
// than every neighbour (153 one deep) -- tidy-01's survey takes pillars from 2 high and pits from 2 deep, and never in a build's box.
// ================================================================================================================================
export const INWALL = Object.freeze({ pillarMax: 6, holeMax: 4, litterMax: 3 })
/** The wall's interior box [x0, z0, x1, z1] (terrace.mjs wallInterior), else the town square. Pure. */
export const inwallBox = (wall, home, r = TIDY.r) => {
  const g = wall?.ring
  if (Array.isArray(g) && g.length === 4 && g.every(Number.isFinite) && g[2] - g[0] >= 4 && g[3] - g[1] >= 4) return [g[0] + 1, g[1] + 1, g[2] - 1, g[3] - 1]
  return [home.x - r, home.z - r, home.x + r, home.z + r]
}
/** The columns no litter rule may touch -> (x, z) -> bool: every STOCK YARD and TREE FARM record's cells' x/z box, +2 (the piles sit
 *  on the yard's floor slots; a farm's soil and saplings). Pure. Codex r1 BLOCKER 1. */
export const NO_LITTER_PLOTS = new Set(['yard', 'treefarm'])
export function inwallNoLitter (records = []) {
  const boxes = []
  for (const r of records ?? []) {
    if (!NO_LITTER_PLOTS.has(String(r?.plot ?? ''))) continue
    const cs = (r.cells ?? []).filter(c => Array.isArray(c?.at))
    if (!cs.length) continue
    const xs = cs.map(c => c.at[0]), zs = cs.map(c => c.at[2])
    boxes.push([Math.min(...xs) - 2, Math.min(...zs) - 2, Math.max(...xs) + 2, Math.max(...zs) + 2])
  }
  return (x, z) => boxes.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])
}
/** The avoid reasons that are a BUILD's box (litter on it may go), never a zone, a well, a farm, the tree farm or the stock yard. */
const BUILD_WHY = /^(project|plan_cell|plan_box|plan_plot)$|^project:(?!yard$|treefarm$|land$|tidy$)/
/**
 * THE INSIDE-THE-WALL SURVEY -> { ok, why, cut, fill, pillars, pits, litter, skipped } (tidyRecord's input). Pure over `read`.
 *   STRAY BLOCKS  a column whose top stands above ALL 8 neighbours' (each read ground): its SPOIL blocks above the highest neighbour,
 *                 from 1 high (tidy-01: 2), at most INWALL.pillarMax -- never a record cell, never a natural block under them, never a
 *                 column `avoid` names
 *   ON A BUILD    the column's topmost block is SPOIL, NOT a record cell, and sits on one (a dirt step on a roof, a path, a wall top),
 *                 at most INWALL.litterMax stacked -- in a build's box only (BUILD_WHY), never a zone/well/farm/tree farm/yard
 *   HOLES         a column lower than ALL 8 neighbours (a true hole: a terrace's lower step has a neighbour as low): filled up to the
 *                 lowest neighbour, at most INWALL.holeMax deep; never water, never a column `avoid` names or a record cell's column
 *   cells  Set "x,y,z" of every project's record cells (the tidy's guard); box [x0, z0, x1, z1]
 */
export function surveyInwall (read, { home, box, avoid = () => null, cells = new Set(), noLitter = () => false, water = 'strict', waterOk = () => false, T = INWALL } = {}) {
  const skipped = {}
  const skip = why => { skipped[why] = (skipped[why] ?? 0) + 1 }
  if (!home || !Array.isArray(box)) return { ok: false, why: 'no_box', cut: [], fill: [], pillars: [], pits: [], litter: 0, skipped }
  const yHi = home.y + TIDY.dy, yLo = home.y - TIDY.dy
  const memo = new Map()
  const col = (x, z) => { const k = k2(x, z); if (!memo.has(k)) memo.set(k, tidyColumn(read, x, z, { yHi, yLo })); return memo.get(k) }
  const ground = c => !!c && !c.why && c.y != null
  const cellCols = new Set([...cells].map(k => { const [x, , z] = k.split(','); return `${x},${z}` }))
  const cut = [], fill = [], pillars = [], pits = []
  let litter = 0
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    const why = avoid(x, z)
    // ---- ON A BUILD: the topmost block of the column, read whatever tidyColumn calls it (a roof's slab reads `built`) ----
    // Codex r1 BLOCKER 1: the stock yard's piles and the tree farm (`noLitter`: their record boxes, from the records themselves --
    // pathAvoid names a yard floor column only `project`) are never litter
    if (noLitter(x, z)) { skip('no_litter'); continue }
    if (why && BUILD_WHY.test(String(why))) {
      let y = yHi
      while (y >= yLo && (() => { const b = read(x, y, z); return !!b && (AIRN(nm(b)) || replaceableCell(b) || b.boundingBox === 'empty') })()) y--
      const stack = []
      while (y >= yLo && stack.length <= T.litterMax) {
        const b = read(x, y, z), k = `${x},${y},${z}`
        if (!b || cells.has(k) || !SPOIL.test(nm(b))) break
        stack.push({ at: [x, y, z], name: nm(b) }); y--
      }
      if (stack.length && stack.length <= T.litterMax && cells.has(`${x},${y},${z}`)) { for (const s of stack) cut.push({ ...s, pillar: `b${litter}` }); pillars.push({ id: `b${litter}`, col: [x, z], top: stack[0].at[1], base: y, h: stack.length, onBuild: true }); litter++; continue }
      // BESIDE A BUILD (a dirt step against a wall or a house, in the build's box margin, on the ground): a column with no record cell
      // whose top stands above every neighbour that is not the build's own column -- its SPOIL blocks above them go
      if (cellCols.has(k2(x, z))) continue
      const c0 = col(x, z)
      if (!ground(c0) || c0.tree) continue
      const nb = N8.filter(([dx, dz]) => !cellCols.has(k2(x + dx, z + dz))).map(([dx, dz]) => col(x + dx, z + dz))
      if (nb.length < 3 || !nb.every(ground)) continue
      const base0 = Math.max(...nb.map(n => n.y))
      if (c0.y <= base0 || c0.y - base0 > T.litterMax) continue
      const bl = []
      let ok0 = true
      for (let yy = c0.y; yy > base0; yy--) { const n = nm(read(x, yy, z)); if (cells.has(`${x},${yy},${z}`) || !SPOIL.test(n) || n === 'grass_block') { ok0 = false; break } bl.push({ at: [x, yy, z], name: n }) }
      if (!ok0) { skip('beside_natural'); continue }
      for (const s of bl) cut.push({ ...s, pillar: `b${litter}` })
      pillars.push({ id: `b${litter}`, col: [x, z], top: c0.y, base: base0, h: bl.length, onBuild: true, beside: true }); litter++
      continue
    }
    const c = col(x, z)
    if (!ground(c)) continue
    if (why) continue
    const ns = N8.map(([dx, dz]) => col(x + dx, z + dz))
    if (!ns.every(ground)) continue
    // ---- STRAY BLOCKS ----
    const base = Math.max(...ns.map(n => n.y))
    if (c.y > base && !c.tree) {
      if (c.y - base > T.pillarMax) { skip('stray_tall'); continue }
      const blocks = []
      let bad = null
      for (let y = c.y; y > base; y--) {
        const n = nm(read(x, y, z))
        if (cells.has(`${x},${y},${z}`)) { bad = 'stray_guarded'; break }
        if (!SPOIL.test(n)) { bad = 'stray_natural'; break }
        blocks.push({ at: [x, y, z], name: n })
      }
      if (bad) { skip(bad); continue }
      const id = `s${pillars.length}`
      pillars.push({ id, col: [x, z], top: c.y, base, h: blocks.length })
      for (const b of blocks) cut.push({ ...b, pillar: id })
      continue
    }
    // ---- HOLES ----
    const lo = Math.min(...ns.map(n => n.y))
    if (c.y < lo) {
      if (cellCols.has(k2(x, z))) { skip('hole_guarded'); continue }
      if (lo - c.y > T.holeMax) { skip('hole_deep'); continue }
      const id = `h${pits.length}`
      pits.push({ id, cols: [[x, z]], n: lo - c.y })
      for (let y = c.y + 1; y <= lo; y++) fill.push({ at: [x, y, z], pit: id })
    }
  }
  return { ok: true, why: 'ok', cut, fill, pillars, pits, litter, skipped }
}

/**
 * A STAGE'S SITING -> { ok, why, record, survey, road }. Pure over `read`. Stage 0 is siteTidy itself (tidy-01). A later stage:
 * tidy-01's survey over its band (rMin, rMax] when it has one, and the earthwork of its road columns (landplan.mjs stageRoadCols)
 * graded with `lim`, their trunks felled with replant cells owed, and `lights` torches beside the roads; the record is tidy-01's
 * (tidyRecord: layered fills, cuts, clears) with `stage`. A column the road touches is the road's alone. `null` record: nothing to
 * do in this stage (the caller moves to the next). townterrace-01: the terrace stage returns a PROMISE (terrace.mjs siteTerrace);
 * callers await siteStage.
 */
export function siteStage (read, { home, land, stage, avoid = () => null, cells = new Set(), plan = null, pin = null, lim = null, lights = 0, now = Date.now(), walkFrom = null, terrace = null, env = process.env, L = LAND } = {}) {
  const st = typeof stage === 'object' ? stage : stageOf(stage, L)
  // the owner's 11-01 water rule for every stage (tidyWater: TIDY_WATER=strict is the old refusal): the stage may touch the water of
  // a column it may touch at all, never within farmGuard of farmland (the farm's irrigation)
  const water = tidyWater(env)
  const reach = Math.max(TIDY.r, st.rMax ?? -1, st.upto ?? -1)
  let farmAt = null
  const waterOk = (x, z) => { if (avoid(x, z)) return false; farmAt ??= farmGuardOf(read, [home.x - reach, home.z - reach, home.x + reach, home.z + reach], home); return !farmAt(x, z) }
  if (st.k === 0) { const s = siteTidy(read, { home, avoid, cells, pin, plan, now, water, waterOk }); if (s.record) { s.record.stage = 0; s.record.stageId = st.id; s.record.terraceV = 1 } return { ...s, road: null } }
  // townterrace-01: the terrace stage (terrace.mjs siteTerrace) inside the wall; TERRACE=off (or no terrace inputs) reads as
  // nothing to do, and the ring order goes on
  if (st.id === TERRACE_STAGE) {
    if (!terraceOn(env) || !terrace) return { ok: true, why: 'off', record: null, survey: null, road: null }
    // ASYNC (the grading's solves are seconds of work on a rough town: `pause` yields the bot's event loop between them); every
    // caller awaits siteStage
    return siteTerrace(read, { home, plan, land, avoid, cells, walkFrom, now, water, ...terrace }).then(t => {
      if (t.record) { t.record.stage = legacyStage(st); t.record.terraceV = 1; t.record.land = land ? { seed: land.seed, sitedAt: land.sitedAt ?? null } : null }
      return { ...t, survey: null, road: null }
    })
  }
  // gkstage-01: inside the wall (surveyInwall), the box the wall encloses (the terrace's inputs carry the wall record)
  if (st.id === INWALL_STAGE) {
    const box = inwallBox(terrace?.wall ?? null, home)
    const sv = surveyInwall(read, { home, box, avoid, cells, noLitter: inwallNoLitter(terrace?.records ?? []), water, waterOk })
    if (!sv.ok) return { ok: false, why: sv.why, record: null, survey: sv, road: null }
    const record = tidyRecord(sv, { home, plan, now, r: Math.max(TIDY.r, Math.abs(box[0] - home.x), Math.abs(box[2] - home.x), Math.abs(box[1] - home.z), Math.abs(box[3] - home.z)) })
    if (!record) return { ok: true, why: 'nothing', record: null, survey: sv, road: null }
    record.stage = legacyStage(st); record.stageId = st.id; record.terraceV = 1
    record.land = land ? { seed: land.seed, sitedAt: land.sitedAt ?? null } : null
    record.inwall = { box, pillars: sv.pillars.length, litter: sv.litter, holes: sv.pits.length, cut: sv.cut.length, fill: sv.fill.length, skipped: sv.skipped }
    return { ok: true, why: 'ok', record, survey: sv, road: null }
  }
  if (!land) return { ok: false, why: 'no_land', record: null, survey: null, road: null }
  const survey = st.rMax > 0 ? surveyTidy(read, { home, avoid, cells, r: st.rMax, rMin: st.rMin, water, waterOk }) : { ok: true, cut: [], fill: [], pillars: [], pits: [], skipped: {} }
  if (!survey.ok) return { ok: false, why: survey.why, record: null, survey, road: null }
  const rcols = stageRoadCols(land, st, { L })
  let road = rcols.length ? roadWork(read, rcols, { home, cells, avoid, waterOk, lim: { ...(lim ?? gradeLim(read, 6, water)), water } }) : { cut: [], fill: [], clear: [], trees: [], skipped: {} }
  // NEVER WORSE (offline, hive-d: a ring graded 4 over the plaza's edge cut the town off its roads): with `walkFrom` (the town's
  // edge columns), the walk from the town -- over all the land, and along the roads -- is measured on the ground as it is and as
  // this stage's road work would leave it; a road work that reaches fewer columns either way is dropped (named), the band's
  // pillars and pits stay
  if (walkFrom && (road.cut.length || road.fill.length)) {
    const after = tidyOverlay(read, { cut: road.cut, clear: road.clear, cells: road.fill })
    const roadSet = new Set((land.roads ?? []).flatMap(r => r.cols.map(([x, z]) => k2(x, z))))
    const freeR = Math.max(TIDY.r / 2, (land.inner ?? 0) + 2)
    const allow = (x, z) => roadSet.has(k2(x, z)) || Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) <= freeR
    // one column scan for both walks on each ground (Codex r1 note: four full scans a stage), out to this stage's reach + 8; the
    // after-ground reuses every column the road work does not touch
    const r = Math.min(L.workR, Math.max(st.upto ?? -1, st.rMax ?? -1, TIDY.r) + 8)
    const reach = (rd, memo) => [walkReach(rd, home, { r, from: walkFrom, column: tidyColumn, memo }).reach, walkReach(rd, home, { r, from: walkFrom, column: tidyColumn, allow, memo }).reach]
    const memo0 = new Map()
    const [w0, a0] = reach(read, memo0)
    const memo1 = new Map(memo0)
    for (const c of [...road.cut, ...road.fill, ...road.clear]) memo1.delete(k2(c.at[0], c.at[2]))
    const [w1, a1] = reach(after, memo1)
    if (w1 < w0 || a1 < a0) road = { cut: [], fill: [], clear: [], trees: [], skipped: { ...road.skipped, road_walk_worse: rcols.length }, walk: { w0, w1, a0, a1 } }
    else road.walk = { w0, w1, a0, a1 }
  }
  const rk = new Set([...road.cut, ...road.fill].map(c => k2(c.at[0], c.at[2])))
  const s = { ...survey, cut: survey.cut.filter(c => !rk.has(k2(c.at[0], c.at[2]))), fill: survey.fill.filter(c => !rk.has(k2(c.at[0], c.at[2]))), clear: road.clear }
  s.pits = survey.pits.filter(p => s.fill.some(f => f.pit === p.id))
  s.pillars = survey.pillars.filter(p => s.cut.some(c => c.pillar === p.id))
  s.cut.push(...road.cut.map(c => ({ ...c, pillar: 'road' })))
  const cols = [...new Set(road.fill.map(c => k2(c.at[0], c.at[2])))]
  for (let i = 0; i < cols.length; i += GRADE_SEG_COLS) {
    const id = `r${i / GRADE_SEG_COLS}`
    const mine = new Set(cols.slice(i, i + GRADE_SEG_COLS))
    const fs = road.fill.filter(c => mine.has(k2(c.at[0], c.at[2])))
    s.pits.push({ id, cols: [...mine].map(q => q.split(',').map(Number)), road: true, n: fs.length })
    for (const f of fs) s.fill.push({ ...f, pit: id })
  }
  const lightAt = roadLights(read, rcols, { home, avoid: (x, z) => avoid(x, z) ?? (rk.has(k2(x, z)) ? 'road' : null), n: lights, cells })
  let record = tidyRecord(s, { home, plan, now, r: Math.max(st.rMax, st.upto ?? -1, TIDY.r) })
  if (!record && !road.clear.length && !lightAt.length) return { ok: true, why: 'nothing', record: null, survey, road }
  record ??= { v: 1, blueprint: TIDY_BLUEPRINT, plot: TIDY_PLOT, home: { x: home.x, y: home.y, z: home.z }, r: Math.max(st.upto ?? -1, TIDY.r), cells: [], clear: [], cut: [], replant: [], segments: [], zones: [], pillars: 0, pits: 0, skipped: {}, bom: { earth: 0 }, builders_max: TIDY_BUILDERS, structure_complete: false, plan: plan?.gen != null ? { gen: plan.gen } : null, sitedAt: now }
  record.clear = [...(record.clear ?? [])]
  for (const c of road.clear) if (!record.clear.some(q => q.at.join(',') === c.at.join(','))) record.clear.push(c)
  record.clear.sort((a, b) => a.at[1] - b.at[1])
  record.replant = replantCells(read, land, road.trees, { avoid, cells })
  if (lightAt.length) {
    record.segments.push({ seg: 'T-L', deps: [] })
    for (const l of lightAt) record.cells.push({ at: l.at, role: 'light', seg: 'T-L' })
  }
  record.stage = legacyStage(st)
  record.stageId = st.id
  record.terraceV = 1   // townterrace-01: sited in the ring order that has the terrace stage (landplan.mjs recStageK)
  record.land = { seed: land.seed, sitedAt: land.sitedAt ?? null }
  record.road = { cols: rcols.length, cut: road.cut.length, fill: road.fill.length, trees: road.trees.length, replant: record.replant.length, lights: lightAt.length, skipped: road.skipped, walk: road.walk ?? null }
  record.r = Math.max(record.r ?? 0, st.upto ?? -1, st.rMax ?? -1)
  return { ok: true, why: 'ok', record, survey, road }
}

/**
 * THE BURIED FILLS TAKE THE COBBLE (groundskeeper-01, a resource-model sink): every fill cell under its column's top fill cell gets
 * role `core` (cobblestone first, TIDY_PALETTE.core); the top keeps `earth` (dirt first: it greens). Pure; returns a new record.
 */
export function coreFills (rec) {
  if (!rec?.cells?.length) return rec
  const top = new Map()
  for (const c of rec.cells) if (c.role === 'earth') { const k = k2(c.at[0], c.at[2]); top.set(k, Math.max(top.get(k) ?? -Infinity, c.at[1])) }
  return { ...rec, cells: rec.cells.map(c => (c.role === 'earth' && c.at[1] < top.get(k2(c.at[0], c.at[2])) ? { ...c, role: 'core' } : c)) }
}

/**
 * THE CUTS IN WALKING ORDER (groundskeeper-01: 43 of 215 tidy visits on 11-02 ended `deadline` with 1-5 blocks cut in ~130 s --
 * runVisit dug the record's cuts highest first across the whole square, a walk across town between two digs). -> the same cuts:
 * grouped by column (top first within a column, so nothing is left floating), the columns visited nearest-neighbour from `start`
 * ([x, z]). Pure.
 */
export function chainCuts (cuts, start) {
  const byCol = new Map()
  for (const c of cuts) { const k = k2(c.at[0], c.at[2]); if (!byCol.has(k)) byCol.set(k, []); byCol.get(k).push(c) }
  for (const v of byCol.values()) v.sort((a, b) => b.at[1] - a.at[1])
  const left = [...byCol.keys()].map(k => k.split(',').map(Number))
  const out = []
  let [px, pz] = start ?? [0, 0]
  while (left.length) {
    let bi = 0, bd = Infinity
    for (let i = 0; i < left.length; i++) { const d = Math.abs(left[i][0] - px) + Math.abs(left[i][1] - pz); if (d < bd || (d === bd && (left[i][0] < left[bi][0] || (left[i][0] === left[bi][0] && left[i][1] < left[bi][1])))) { bd = d; bi = i } }
    const [x, z] = left.splice(bi, 1)[0]
    out.push(...byCol.get(k2(x, z)))
    px = x; pz = z
  }
  return out
}

/** THE TOWN'S EDGE (the walk guard's start): the columns just outside the plan's core plaza box (home +- 6 without one). Pure. */
export function townEdge (plan, home = plan?.home) {
  const core = (plan?.plots ?? []).find(p => p.id === 'core' && Array.isArray(p.box))?.box ?? (home ? [home.x - 6, home.z - 6, home.x + 6, home.z + 6] : null)
  if (!core) return []
  const out = []
  for (let x = core[0] - 1; x <= core[2] + 1; x++) for (let z = core[1] - 1; z <= core[3] + 1; z++) if (x < core[0] || x > core[2] || z < core[1] || z > core[3]) out.push([x, z])
  return out
}

/** Codex r1 BLOCKER 2: a stage's CLEARS (a felled road trunk, the road's head-room leaves) are its work too: a stage completes only
 *  when none still stands (unread = standing), or when this bot's visits made no clear progress GK_CLEAR_VISITS times (a trunk
 *  no stand reaches, a sapling the town lacks: named, the stage moves on). -> how many still stand. Pure. */
export const GK_CLEAR_VISITS = 5
export const tidyClearsLeft = (rec, read) => (rec?.clear ?? []).filter(c => { const b = read(...c.at); return !b || nm(b) === c.name }).length
/**
 * GKSTALL-01 (LIVE showcase 11-03 04:27-06:07Z: stage 0 held 1 h 40 min on ONE pit cell, 21,66,0, two cells waiting on it, no land
 * plan published and no road graded). The cell was a 1x1 hole two deep (its fill tops at 66, the ground round it at 67): the only
 * support is the cobble below it, and no walked node's eye has a sight line to that top face past the rim. It was waived only on
 * the 5th deferring visit (WALL_WAIVE_AFTER), and every visit cost about 30 min: the keeper's stuck_on_cell stop backed its whole
 * build order off 6 h while it still held the lease, so the next visit waited for the lease to lapse and another bot to take it.
 * The keeper's grounds therefore waive a fill after GK_WAIVE_AFTER deferring visits (summed over every builder, this one counted:
 * below STUCK_VISITS, so a waivable cell never reaches the 6-h back-off), with room for a tenth of the stage's cells (a road stage
 * has hundreds), and a visit that waived ends `cell_waived`, never stuck_on_cell. -> wallWaiveDue's options. Pure.
 */
export const GK_WAIVE_AFTER = 2
export const GK_WAIVE_SHARE = 0.1
// (the stage's OWN cells: a terrace record's carried `prev` cells from the stage before are never worked, so they buy no room -- Claude fold note)
export const gkWaiveOpts = (rec, max0 = 12) => ({ after: GK_WAIVE_AFTER, max: Math.max(max0, Math.ceil(GK_WAIVE_SHARE * (rec?.cells ?? []).filter(c => !c?.prev).length)) })
/** The deferred cells the keeper's waiver may name -> the deferred list less every cave SEAL (a record cell with an `opener`,
 *  townterrace-01: a pocket under a cut must be filled, never waived -- Codex fold r1 BLOCKER) and every carried `prev` cell. Pure. */
export function gkWaivable (rec, deferred = []) {
  const keep = new Set((rec?.cells ?? []).filter(c => c && !c.opener && !c.prev).map(c => c.at.join(',')))
  return (deferred ?? []).filter(d => keep.has(String(d?.k ?? '')))
}
/** The visit's stop once its waiver has run -> stop. A visit that waived a cell freed the stage: not stuck, asked again at once. Pure. */
export const gkStopAfterWaive = (stop, waivedN) => (waivedN > 0 && (stop === 'stuck_on_cell' || stop === 'cell_deferred') ? 'cell_waived' : stop)
