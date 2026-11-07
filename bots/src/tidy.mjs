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

import { forestReplantCells } from './forest.mjs'   // forest-01: felled outside trees replanted in the forest's rows
import { townhallEntranceCols } from './townhall.mjs'   // the batch9 fold: the town hall's way in is no stair
import { cottageEntranceCols } from './cottage.mjs'   // the batch fold: the cottage's way in is no stair
import { enchantEntranceCols } from './enchantshop.mjs'   // the showcase wallext2 fold: the workshop's way in is no stair
import { hubEntranceCols } from './storehub.mjs'   // the showcase gkaccess fold: the hall's way in is no stair
import { isLiquid, isFurniture, replaceableCell } from './townplan.mjs'
import { sitePaths, pathDests, NATURAL } from './paths.mjs'
import { stageOf, stageRoadCols, zoneAt, corridorAt, walkReach, LAND, INWALL_STAGE } from './landplan.mjs'   // groundskeeper-01; gkstage-01
import { PARK_PALETTE } from './park.mjs'   // townterrace-01: the park's roles
import { siteTerrace, terraceOn, TERRACE_STAGE, farmGuardOf, inWallTrees, TERRACE } from './terrace.mjs'
import { surveyRough, roughOn, nearCellsOf } from './roughground.mjs'   // roughground-01: the ground the inside rules miss   // townterrace-01: the terrace stage; plotprep-01: the plots' trees

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
  // access-01 (owner 11-04 "no dirt steps"): a proper step where bots climbed -- the town's stone, never dirt, never `*solid` (a dirt
  // block left in an access cell reads open: the runner digs it out and lays stone)
  access: ['cobblestone', 'stone_bricks', 'cobbled_deepslate', 'mossy_cobblestone', 'stone', 'andesite'],
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
    // roughground-1b: a hollow under a crust cut is its OWN group (Paper 11-07: a held hollow -- a body in it -- kept another
    // column's layer above it waiting, the other tunnel left open a whole visit)
    if (n + mine.length > T.segCells || p.kind === 'under') { group++; n = 0 }
    n += mine.length
    if (p.kind === 'under') n = Infinity
    const base = new Map()
    for (const f of mine) { const k = k2(f.at[0], f.at[2]); base.set(k, Math.min(base.get(k) ?? Infinity, f.at[1])) }
    for (const f of mine.sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])) {
      const k = f.at[1] - base.get(k2(f.at[0], f.at[2]))
      const seg = segOf(group, k)
      if (!segs.has(seg)) { segs.add(seg); segments.push({ seg, deps: k > 0 ? [segOf(group, k - 1)] : [] }) }
      cells.push({ at: f.at, role: 'earth', seg, ...(f.opener ? { opener: f.opener } : {}) })   // roughground-1b r1: a hollow's fill names its cut (never waived)
    }
  }
  // every group's ground layer first, then every group's next (a visit meets a layer whose dependency another builder holds only
  // after every ground layer: runVisit stops `deps_open` there)
  const lk = sg => { const m = /^T-(\d+)-(\d+)$/.exec(sg); return [Number(m[2]), Number(m[1])] }
  segments.sort((a, b) => { const [ka, ga] = lk(a.seg), [kb, gb] = lk(b.seg); return ka - kb || ga - gb })
  const cut = [...s.cut].sort((a, b) => b.at[1] - a.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2]).map(c => ({ at: c.at, kind: 'tidy', name: c.name, ...(c.hollow ? { hollow: c.hollow } : {}) }))   // roughground-1b: the hollow under a crust cut rides on it
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
export function replantCells (read, land, trees, { avoid = () => null, cells = new Set(), r = LAND.workR, groves = false, busy = new Set(), forest = null, forestR = Infinity, T = TIDY } = {}) {
  const home = land?.home
  if (!home || !trees.length) return []
  // FOREST-01 (owner 11-06 "when they cut down a tree outside the walls replant in an clean organized way"): with a managed forest, a
  // felled tree's sapling goes into the forest's next open ROW plot first (forest.mjs forestReplantCells: row order, never the strip
  // being harvested); only the trees the forest has no open plot for go where they went before
  if (forest) {
    const fr = forestReplantCells(read, forest, trees, { home, maxR: forestR })   // only the plots the tidy's own walk reaches (forestR)
    if (fr.length >= trees.length) return fr
    if (fr.length) {
      const fcols = new Set(fr.map(q => `${q.cell[0]},${q.cell[2]}`))
      const rest = replantCells(read, land, trees.slice(fr.length), { avoid: (x, z) => avoid(x, z) ?? (fcols.has(`${x},${z}`) ? 'forest' : null), cells, r, groves, busy, forest: null, forestR, T })
      return [...fr, ...rest]
    }
  }
  const road = corridorAt(land)
  // outbands-01 (owner 11-04 "cut down trees and replant in better spots"): with `groves`, the wild cells beside a standing GROVE
  // (OUTBANDS.groveMin trunks within OUTBANDS.groveR) come before the rest of the wild, nearest home first; `busy` columns (this
  // stage's own cuts, fills and fells) are never a replant cell
  const trunks = new Map()
  const trunkAt = (x, z) => {
    const k = k2(x, z)
    if (!trunks.has(k)) { const c = tidyColumn(read, x, z, { yHi: home.y + T.dy, yLo: home.y - T.dy }); const b = c.y != null && c.tree ? read(x, c.y + 1, z) : null; trunks.set(k, !!b && LOG_RE.test(nm(b))) }
    return trunks.get(k)
  }
  const grove = (x, z) => { let n = 0; for (let dx = -OUTBANDS.groveR; dx <= OUTBANDS.groveR; dx++) for (let dz = -OUTBANDS.groveR; dz <= OUTBANDS.groveR; dz++) if ((dx || dz) && trunkAt(x + dx, z + dz) && ++n >= OUTBANDS.groveMin) return true; return false }
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
    // the grove pass first (lazily: a candidate's grove is read only when it is otherwise plantable), then every candidate
    for (const pass of groves && kind === 'wild' ? ['grove', 'any'] : ['any']) for (const [, x, z] of cand) {
      if (out.length >= trees.length) return out
      if (used.some(([ux, uz]) => Math.max(Math.abs(ux - x), Math.abs(uz - z)) < 4)) continue
      if (road(x, z) || avoid(x, z) || cellCols.has(`${x},${z}`) || busy.has(`${x},${z}`)) continue
      // never against a trunk (a grove's own trees keep their room: no standing trunk among its 8 neighbours)
      if (groves && N8.some(([dx, dz]) => trunkAt(x + dx, z + dz))) continue
      const c = tidyColumn(read, x, z, { yHi: home.y + T.dy, yLo: home.y - T.dy })
      if (c.why || c.y == null || c.tree || !SOIL_RE.test(c.name)) continue
      let open = true
      for (let y = c.y + 1; y <= c.y + REPLANT_AIR; y++) { const b = read(x, y, z); if (!b || !AIRN(nm(b))) { open = false; break } }
      if (!open) continue
      if (pass === 'grove' && !grove(x, z)) continue
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
export const INWALL = Object.freeze({ pillarMax: 6, holeMax: 4, litterMax: 3, hollowRough: true })   // roughground-1b: hollowRough
/**
 * wallext-01: INSIDE THE WALLS -> [[x0, z0, x1, z1]]: the wall's interior box (inwallBox) and, when the town has one, the wall
 * EXTENSION's interior (its record's `interior`: the rectangle less its own line, up to the shared line) -- the owner's "inside the
 * town walls first" is both. Disjoint by construction (the extension's interior ends on the old ring's line, outside its box). Pure.
 */
export function inwallBoxes (wall, home, ext = null, r = TIDY.r) {
  const out = [inwallBox(wall, home, r)]
  const b = ext?.interior
  if (Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] >= b[0] && b[3] >= b[1]) out.push([...b])
  return out
}
/**
 * roughground-01: THE ROUGH SURVEY OVER SOME BOXES, merged into `into` ({ cut, fill, pillars, pits }: mutated, ids namespaced `r<i>:`)
 * -> { census, skipped } summed. Pure over `read` (roughground.mjs surveyRough with the tidy's column, SPOIL and build reasons).
 */
export function roughIn (read, { home, boxes = [], within = () => true, avoid, cells, records = null, noLitter, reserved, busy = new Set(), climbs = [], standOff = () => false } = {}, into) {
  const nearCells = records ? nearCellsOf(records) : cells
  const yHi = home.y + TIDY.dy, yLo = home.y - TIDY.dy
  const memo = new Map()
  const col = (x, z) => { const k = k2(x, z); if (!memo.has(k)) memo.set(k, tidyColumn(read, x, z, { yHi, yLo })); return memo.get(k) }
  const sum = { census: {}, skipped: {}, platforms: [], clear: [] }   // roughground-1c: the stands and their leaves
  const used = new Set(busy)
  boxes.forEach((box, i) => {
    const r = surveyRough(read, { home, box, within, col, spoil: SPOIL, buildWhy: BUILD_WHY, avoid, cells, nearCells, noLitter, reserved, busy: used, climbs, yLo, standOff })
    if (!r.ok) return
    const ns = v => `r${i}:${v}`
    for (const c of r.cut) { into.cut.push({ ...c, pillar: ns(c.pillar) }); used.add(k2(c.at[0], c.at[2])) }
    for (const f of r.fill) { into.fill.push({ ...f, pit: ns(f.pit) }); used.add(k2(f.at[0], f.at[2])) }
    for (const q of r.pillars) into.pillars.push({ ...q, id: ns(q.id) })
    for (const q of r.pits) into.pits.push({ ...q, id: ns(q.id) })
    for (const p of r.platforms ?? []) { sum.platforms.push(p); for (const c of p.cells) used.add(k2(c[0], c[2])) }
    for (const c of r.clear ?? []) sum.clear.push(c)
    for (const [k, v] of Object.entries(r.census)) sum.census[k] = (sum.census[k] ?? 0) + v
    for (const [k, v] of Object.entries(r.skipped)) sum.skipped[k] = (sum.skipped[k] ?? 0) + v
  })
  return sum
}
// ================================================================================================================================
// PLOTPREP-01 (coordinator 11-04, the owner's "they can leave trees, or cut down trees and replant in better spots"): the wall
// extension's RESERVED PLOTS (wall.mjs wallExtPlots: the record's `plots` [{ id, kind, box, y }]) are made ready for their buildings
// while no project has sited on them: every tree standing on the plot felled (replanted in the tree farm or the wild zone:
// replantCells, the read's G5), a tree too tall for a ground stand felled from a temporary stone STAND beside its trunk (piece 3's
// staircase, torn down once the tree is down: platformTeardown), and the plot levelled to its prevailing floor (the median ground).
// LIVE (11-04): the workshop could not site on X1 (x 10..28, z -75..-63): a 9-log spruce at 25,-64, logs 69..77 on soil at 68 -- a
// ground stand's eye (69 + 1.62) reaches the log at 74/75, never 76..77.
// ================================================================================================================================
export const PLOTPREP = Object.freeze({ cutMax: 4, fillMax: 4, reachUp: 5, platMax: 3, teardownMs: 45 * 60_000 })
/** Ground a levelling cut may take (never an ore, sand or gravel, a path, farmland, a log). */
export const LEVEL_CUT = /^(dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|moss_block|stone|cobblestone|mossy_cobblestone|andesite|diorite|granite|tuff|deepslate|cobbled_deepslate)$/
const PLOT_NOT_SITED = new Set(['tidy', 'land', 'wall', 'wallext', 'paths'])
/** Has a project sited on the plot (any record cell of another project inside its box)? Pure. */
export function plotSited (plot, records = []) {
  const b = plot?.box
  if (!Array.isArray(b) || b.length !== 4) return true
  return (records ?? []).some(r => !PLOT_NOT_SITED.has(String(r?.plot ?? '')) && (r.cells ?? []).some(c => Array.isArray(c?.at) && !c.prev && c.at[0] >= b[0] && c.at[0] <= b[2] && c.at[2] >= b[1] && c.at[2] <= b[3]))
}
/**
 * THE PLOTS PREPARED -> { cut, fill, clear, trees, platforms, cols: Set "x,z", plots: [summary], skipped }. Pure over `read`.
 *   plots    the extension's plots;  records  every project record (a sited plot is left alone: plotSited)
 *   avoid    the tidy's refusals (a zone, a well, a farm: a column it names is never touched; a tree with a refused log is kept)
 *   cells    every record cell ("x,y,z")
 * Per plot: its FLOOR is the median ground of its columns (tidyColumn). Each TREE whose base stands in the plot (inWallTrees, any
 * height up to the stand's reach + PLOTPREP.platMax): its logs are clears (kind tree, `tree` its index); a tree whose top log is more
 * than PLOTPREP.reachUp above a ground stand's feet gets a STAND -- a staircase of p = top - (base + reachUp) steps against its trunk
 * on one side (each step one block, its top step beside the trunk, the landing at its foot one below the last step, two cells of
 * room above every step: a leaf there is cleared), else the tree is kept (named). Every other column is LEVELLED to the floor: its
 * ground above it cut (LEVEL_CUT only, <= cutMax), below it filled (<= fillMax); never water, a record cell's column, a refused one.
 */
export function plotPrep (read, { plots = [], home, records = [], avoid = () => null, cells = new Set(), noStair = () => false, T = PLOTPREP } = {}) {
  const out = { cut: [], fill: [], clear: [], trees: [], platforms: [], cols: new Set(), plots: [], skipped: {} }
  const skip = why => { out.skipped[why] = (out.skipped[why] ?? 0) + 1 }
  if (!home) return out
  const yHi = home.y + TIDY.dy, yLo = home.y - TIDY.dy
  const memo = new Map()
  const col = (x, z) => { const k = k2(x, z); if (!memo.has(k)) memo.set(k, tidyColumn(read, x, z, { yHi, yLo })); return memo.get(k) }
  const ground = c => !!c && !c.why && c.y != null
  const cellCols = new Set([...cells].map(k => { const [x, , z] = k.split(','); return `${x},${z}` }))
  const hard = (x, z) => { const w = avoid(x, z); return !!w && !/^(project|plan_cell|plan_box|plan_plot)$|^project:|^land:plot$/.test(String(w)) }
  const open = (x, y, z) => { const b = read(x, y, z); return !!b && (AIRN(nm(b)) || replaceableCell(b) || b.boundingBox === 'empty') && !isLiquid(b) }
  for (const plot of plots ?? []) {
    const b = plot?.box
    if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) continue
    if (plotSited(plot, records)) { out.plots.push({ id: plot.id, sited: true }); skip('plot_sited'); continue }
    const ys = []
    for (let x = b[0]; x <= b[2]; x++) for (let z = b[1]; z <= b[3]; z++) { const c = col(x, z); if (ground(c)) ys.push(c.y) }
    if (!ys.length) { skip('plot_unread'); continue }
    ys.sort((p, q) => p - q)
    const floor = ys[Math.floor(ys.length / 2)]
    const summary = { id: plot.id, box: [...b], floor, trees: 0, stands: 0, cut: 0, fill: 0, kept: 0 }
    const used = new Set()   // columns a tree, a stand or a landing takes (no levelling there)
    // ---- THE TREES ----
    const tr = inWallTrees(read, b, { home, avoid: (x, z) => (hard(x, z) || cellCols.has(k2(x, z)) ? 'guarded' : null), T: { ...TERRACE, treeReach: T.reachUp + T.platMax + 1 } })
    for (const [k, v] of Object.entries(tr.skipped ?? {})) out.skipped[k] = (out.skipped[k] ?? 0) + v
    for (const t of tr.trees) {
      const base = t.base[1]                  // the log on the soil: a ground stand's feet are at `base`
      const need = t.top - (base + T.reachUp)
      let plat = null
      if (need > 0) {
        for (const [dx, dz] of N4) {
          const cs = [], clears = [], cols = []
          let ok = true
          for (let i = 1; i <= need && ok; i++) {
            const cx = t.base[0] + dx * i, cz = t.base[2] + dz * i, h = need - i + 1    // step i: h blocks (base .. base+h-1)
            const c = col(cx, cz)
            if (!ground(c) && !(c?.tree && c.y != null)) { ok = false; break }
            // Codex r1 BLOCKER 2: inside its own plot, never on a door's approach, a road corridor, a stand of the plan (accessNoStair)
            if (c.y !== base - 1 || hard(cx, cz) || cellCols.has(k2(cx, cz)) || used.has(k2(cx, cz)) || noStair(cx, cz) || cx < b[0] || cx > b[2] || cz < b[1] || cz > b[3]) { ok = false; break }
            for (let y = base; y <= base + h - 1; y++) { const q = read(cx, y, cz); if (!open(cx, y, cz) && !/leaves$/.test(nm(q))) { ok = false; break } if (/leaves$/.test(nm(q))) clears.push({ at: [cx, y, cz], kind: 'leaves', name: nm(q) }); cs.push([cx, y, cz]) }
            for (let d = 0; d < 2 && ok; d++) { const y = base + h + d, q = read(cx, y, cz); if (/leaves$/.test(nm(q))) clears.push({ at: [cx, y, cz], kind: 'leaves', name: nm(q) }); else if (!open(cx, y, cz)) ok = false }
            // the top step's column above the head room up to the tree's top: its leaves block the stand's sight of the top logs
            // (the fake server, 11-04: logs G+8..G+9 unseen behind the leaves over the stand) -- the tree's own leaves, cleared
            if (i === 1) for (let y = base + h + 2; y <= t.top + 1; y++) { const q = read(cx, y, cz); if (/leaves$/.test(nm(q))) clears.push({ at: [cx, y, cz], kind: 'leaves', name: nm(q) }); else if (!open(cx, y, cz) && !LOG_RE.test(nm(q))) { ok = false; break } }
            cols.push(k2(cx, cz))
          }
          if (!ok) continue
          const lx = t.base[0] + dx * (need + 1), lz = t.base[2] + dz * (need + 1), lc = col(lx, lz)
          if (!ground(lc) || lc.y !== base - 1 || hard(lx, lz) || cellCols.has(k2(lx, lz)) || noStair(lx, lz) || !open(lx, base, lz) || !open(lx, base + 1, lz)) continue
          plat = { cells: cs, clears, cols: [...cols, k2(lx, lz)] }
          break
        }
        if (!plat || need > T.platMax) { summary.kept++; skip(need > T.platMax ? 'tree_tall' : 'tree_no_stand'); continue }
      }
      const idx = out.trees.length
      out.trees.push({ col: t.col, name: t.name, base: t.base, top: t.top, plot: plot.id })
      for (const l of t.logs) out.clear.push({ at: l.at, kind: 'tree', name: l.name, tree: idx, plot: plot.id })
      used.add(k2(t.base[0], t.base[2]))
      if (plat) {
        out.platforms.push({ tree: idx, cells: plat.cells, phase: 'up', plot: plot.id })
        for (const c of plat.clears) if (!out.clear.some(q => q.at.join(',') === c.at.join(','))) out.clear.push({ ...c, plot: plot.id })
        for (const k of plat.cols) used.add(k)
        summary.stands++
      }
      summary.trees++
    }
    // ---- THE LEVEL ----
    for (let x = b[0]; x <= b[2]; x++) for (let z = b[1]; z <= b[3]; z++) {
      const k = k2(x, z)
      if (used.has(k) || cellCols.has(k) || hard(x, z)) continue
      const c = col(x, z)
      if (!ground(c) || c.tree) continue
      if (c.y > floor) {
        if (c.y - floor > T.cutMax) { skip('level_tall'); continue }
        const bl = []
        let ok = true
        for (let y = c.y; y > floor; y--) { const n = nm(read(x, y, z)); if (!LEVEL_CUT.test(n) || cells.has(`${x},${y},${z}`)) { ok = false; break } bl.push({ at: [x, y, z], name: n }) }
        if (!ok) { skip('level_natural'); continue }
        const id = `lc${out.cut.length}`
        for (const q of bl) out.cut.push({ ...q, pillar: id, plot: plot.id })
        summary.cut += bl.length; out.cols.add(k)
      } else if (c.y < floor) {
        if (floor - c.y > T.fillMax) { skip('level_deep'); continue }
        const id = `lf${plot.id}-${x}-${z}`
        for (let y = c.y + 1; y <= floor; y++) out.fill.push({ at: [x, y, z], pit: id, plotFill: true, plot: plot.id })
        summary.fill += floor - c.y; out.cols.add(k)
      }
    }
    for (const k of used) out.cols.add(k)
    out.plots.push(summary)
  }
  return out
}
/**
 * THE STANDS TORN DOWN -> the record's next generation | null (nothing to do). Pure over `read`. A stand whose tree reads felled (no
 * listed log of it stands), or that has stood `teardownMs` since the record was sited (a tree no stand can finish never keeps it), is
 * taken back down: its cells leave the record's `cells` and become CUTS (top first, the block read there), its phase 'down'.
 */
export function platformTeardown (rec, read, now = Date.now(), T = PLOTPREP) {
  const ps = rec?.plotprep?.platforms ?? []
  if (!ps.some(p => p.phase === 'up')) return null
  const down = []
  for (const p of ps) {
    if (p.phase !== 'up') continue
    // roughground-1c: a stand for floating blocks (`targets`) is done when every target is cut (open now); a tree's when its logs are
    const logs = p.targets ? p.targets.map(at => ({ at })) : (rec.clear ?? []).filter(c => c.kind === 'tree' && c.tree === p.tree)
    // Codex r1 BLOCKER 1: an UNREAD cell (an unloaded chunk) is never a felled log, and a stand with an unread cell waits (its cuts
    // would be lost): retired only on what the world says
    if (p.cells.some(c => !read(...c)) || logs.some(c => !read(...c.at))) continue
    const felled = p.targets ? logs.every(c => { const b = read(...c.at); return AIRN(nm(b)) || /_leaves$/.test(nm(b)) || b.boundingBox === 'empty' }) : logs.every(c => !LOG_RE.test(nm(read(...c.at))))
    if (felled || now - (Number(rec.sitedAt) || 0) >= T.teardownMs) down.push(p)
  }
  if (!down.length) return null
  const kill = new Set(down.flatMap(p => p.cells.map(c => c.join(','))))
  const cut = [...(rec.cut ?? [])]
  for (const c of down.flatMap(p => p.cells).sort((a, b) => b[1] - a[1])) {
    const n = nm(read(...c))
    if (read(...c)?.boundingBox === 'block' && !cut.some(q => q.at.join(',') === c.join(','))) cut.push({ at: c, kind: 'tidy', name: n, teardown: true, ...(down.find(p => p.cells.some(q => q.join(',') === c.join(',')))?.plot != null ? { plot: down.find(p => p.cells.some(q => q.join(',') === c.join(','))).plot } : {}) })   // Codex r1 (plotprep-02): the teardown's cuts keep the plot
  }
  return { ...rec, cells: (rec.cells ?? []).filter(c => !kill.has(c.at.join(','))), segments: (rec.segments ?? []).filter(sg => (rec.cells ?? []).some(c => c.seg === sg.seg && !kill.has(c.at.join(',')))), cut,
    plotprep: { ...rec.plotprep, platforms: ps.map(p => (down.includes(p) ? { ...p, phase: 'down', downAt: now } : p)) } }
}
/**
 * PLOTPREP-02 (Codex fold r4 BLOCKER, the coordinator 11-04): a plot a project has SITED on since its prep was planned is no longer the
 * groundskeeper's. -> Set of plot ids (rec.plotprep.plots, each with its box) on which another project's record now has a cell
 * (plotSited over the CURRENT records). Pure. The visit passes every entry of such a plot (plotEntryRetired), and the keeper retires
 * them (plotRetire) -- Codex's repro: the X1 workshop sited while 120 levelling cuts under its pad were still pending.
 */
export function plotsSitedNow (rec, records = []) {
  const out = new Set()
  for (const p of rec?.plotprep?.plots ?? []) if (p?.id != null && !p.sited && !p.retired && Array.isArray(p.box) && plotSited(p, records)) out.add(String(p.id))
  return out
}
/** Is a record entry (a cell, a cut, a clear, a replant) a plot's whose project has sited? Pure. */
export const plotEntryRetired = (q, sited) => q?.plot != null && !!sited?.has?.(String(q.plot))
/**
 * THE PLOTS' PREP RETIRED -> the record's next generation | null. Pure. Every cell, cut and clear tagged with a sited plot leaves the
 * record (the project's own builders work that ground now; its records judge it); its replants stay (G5), its stands go with their
 * cells (phase `retired`), the plot `retired`.
 */
export function plotRetire (rec, sited) {
  if (!rec || !sited?.size) return null
  const gone = q => plotEntryRetired(q, sited)
  if (![...(rec.cells ?? []), ...(rec.cut ?? []), ...(rec.clear ?? [])].some(gone)) return null
  const cells = (rec.cells ?? []).filter(q => !gone(q))
  const keepSeg = new Set(cells.map(q => q.seg))
  return { ...rec, cells, segments: (rec.segments ?? []).filter(sg => keepSeg.has(sg.seg)), cut: (rec.cut ?? []).filter(q => !gone(q)), clear: (rec.clear ?? []).filter(q => !gone(q)),
    // Codex r1 (plotprep-02): the replants are LEFT as they are -- skipping them would shrink the head's count under tree-clear rows
    // already logged (the read's G5: saplings=a/b against the head); a replant cell is never in a plot, so the sapling for a tree no
    // longer felled is only one more sapling in the tree farm
    replant: rec.replant ?? [],
    plotprep: { ...rec.plotprep, plots: (rec.plotprep.plots ?? []).map(p => (sited.has(String(p.id)) ? { ...p, retired: true } : p)), platforms: (rec.plotprep.platforms ?? []).map(p => (sited.has(String(p.plot)) ? { ...p, phase: 'retired' } : p)) } }
}
/** Does a stand still stand on the record (its stage never completes over it)? Pure. */
export const platformUp = rec => (rec?.plotprep?.platforms ?? []).some(p => p.phase === 'up')

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
// ================================================================================================================================
// ACCESS-01 (owner 11-04: "if a bot needs to place a dirt block to get somewhere that means there isnt access"; groundskeeper piece 3):
// where bots built a dirt climb against a build, the groundskeeper builds a PROPER staircase of the town's stone in its place -- each
// step one block (a walk, never a jump of 2), head room above every step, a landing at the foot -- instead of cutting the climb away.
// LIVE showcase 11-04 copy: 13 climbs on or beside builds inside the wall, up to 3 high.
// ================================================================================================================================
export const ACCESS = Object.freeze({ supportMax: 4, headRoom: 2 })
/**
 * Columns a staircase never uses -> (x, z) -> bool. Pure.
 *   - within 1 of a record's door or its front approach (storehouse.mjs `door`, `frontOpen`; a house's `door`): the way in
 *   - inside a build's own footprint (its cells' x/z box; never the ring wall's or the paths' -- their boxes are the town): a stair
 *     never runs into a house or the storehouse, onto the chests' stands (Codex r1 BLOCKER 3)
 *   - a town-plan container's STAND (the plan's plots' cells' and stations' `stand`: paths.mjs pathAvoid's `flat`; Codex r1 BLOCKER 3)
 *   - a land-plan road corridor (corridorAt; the tidy's own guard leaves them out: Codex r1 BLOCKER 3)
 */
// the wallext + access fold (Codex fold BLOCKER): the wall extension is a ring wall too -- its box is the extension's interior
const FOOTPRINT_SKIP = new Set(['wall', 'wallext', 'paths', 'tidy', 'land'])
export function accessNoStair (records = [], { plan = null, land = null } = {}) {
  const cols = [], boxes = [], stands = new Set()
  for (const r of records ?? []) {
    if (Array.isArray(r?.door) && r.door.length === 3) cols.push([r.door[0], r.door[2]])
    for (const f of r?.frontOpen ?? []) if (Array.isArray(f) && f.length >= 2) cols.push([f[0], f[f.length - 1]])
    // the showcase gkaccess fold (Codex fold BLOCKER): the storage hall's doorway and its approach (storehub.mjs hubEntranceCols)
    for (const c of hubEntranceCols(r)) cols.push(c)
    // the showcase wallext2 fold (Codex fold BLOCKER): the enchanting workshop's doorway and approach (enchantshop.mjs enchantEntranceCols)
    for (const c of enchantEntranceCols(r)) cols.push(c)
    // the showcase batch fold (Codex fold r7 BLOCKER): the cottage's doorway and approach (cottage.mjs cottageEntranceCols)
    for (const c of cottageEntranceCols(r)) cols.push(c)
    // the showcase batch9 fold (Codex fold BLOCKER): the town hall's doorway, porch and approach (townhall.mjs townhallEntranceCols)
    for (const c of townhallEntranceCols(r)) cols.push(c)
    if (FOOTPRINT_SKIP.has(String(r?.plot ?? ''))) continue
    const cs = (r?.cells ?? []).filter(c => Array.isArray(c?.at) && !c.prev)
    if (cs.length) { const xs = cs.map(c => c.at[0]), zs = cs.map(c => c.at[2]); boxes.push([Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]) }
  }
  for (const p of plan?.plots ?? []) for (const c of [...(p.cells ?? []), ...(p.stations ?? [])]) if (Array.isArray(c?.stand)) stands.add(k2(c.stand[0], c.stand[2]))
  const road = corridorAt(land)
  return (x, z) => cols.some(([cx, cz]) => Math.max(Math.abs(cx - x), Math.abs(cz - z)) <= 1) || boxes.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]) || stands.has(k2(x, z)) || !!road(x, z)
}
/** The climb blocks a staircase may stand in: the runner digs them out of an access cell (buildrun.mjs FOREIGN_CLEAR) or they are its
 *  stone already (TIDY_PALETTE.access) -- never planks or netherrack (Codex r1 BLOCKER 2: they would be left, or dug, in a stair). */
export const STAIR_FROM = /^(dirt|coarse_dirt|cobblestone|cobbled_deepslate)$/
/** THE FILL BILL -> cobblestone to draw. Pure. Earth fills take the bag's spare dirt, then its cobblestone; a staircase's cells take
 *  STONE only (Codex r1 BLOCKER 1: spare dirt never offsets them) from the cobblestone the earth fills leave. */
export function fillWant ({ open = 0, openAccess = 0, dirt = 0, cobble = 0 } = {}) {
  const earthCobble = Math.max(0, open - dirt)
  return Math.max(0, earthCobble - cobble) + Math.max(0, openAccess - Math.max(0, cobble - earthCobble))
}
/**
 * A STAIRCASE FOR A CLIMB -> { cells: [[x, y, z]], dir: [dx, dz], cols: ["x,z"] } | null. Pure over `read`.
 *   x, z, top, base  the climb's column, its top block's y and the ground beside it (the climb is h = top - base blocks)
 *   col(x, z)        tidyColumn (memoised);  cellCols  Set "x,z" of the record cells' columns (the build)
 *   free(x, z)       may the stair use this column (no zone, no other project's cells, not reserved, not yet planned)
 * The stair runs AWAY from the build: the build's column is the climb's 4-neighbour in -dir; step i (0 at the climb) stands in column
 * climb + dir * i with its top at top - i, every cell from its ground up to that top laid (at most supportMax deep). Every step has
 * `headRoom` cells of air above it; the landing (climb + dir * h) is ground at most one below the last step, with head room. The
 * first direction (N, S, W, E order of the build's side) that fits wins; none -> null (the climb is cut, as inwall does).
 */
export function planAccessStair (read, { x, z, top, base, col, cellCols = new Set(), free = () => true, T = ACCESS } = {}) {
  const h = top - base
  if (!(h >= 1)) return null
  const ground = c => !!c && !c.why && c.y != null && !c.tree
  const open = (ax, ay, az) => { const b = read(ax, ay, az); return !!b && (AIRN(nm(b)) || replaceableCell(b) || b.boundingBox === 'empty') && !isLiquid(b) }
  for (const [dx, dz] of N4) {
    if (!cellCols.has(k2(x - dx, z - dz))) continue                 // the build is behind the climb on this side
    const cells = [], cols = []
    let ok = true
    for (let i = 0; i < h && ok; i++) {
      const cx = x + dx * i, cz = z + dz * i, yi = top - i
      if (cellCols.has(k2(cx, cz)) || (i > 0 && !free(cx, cz))) { ok = false; break }
      const c = col(cx, cz)
      if (!ground(c) || c.y > yi || yi - c.y > T.supportMax + (i === 0 ? h : 0)) { ok = false; break }
      for (let d = 1; d <= T.headRoom; d++) if (!open(cx, yi + d, cz)) { ok = false; break }
      if (!ok) break
      for (let y = (i === 0 ? base : c.y) + 1; y <= yi; y++) cells.push([cx, y, cz])
      cols.push(k2(cx, cz))
    }
    if (!ok) continue
    const lx = x + dx * h, lz = z + dz * h, lc = col(lx, lz), last = top - h + 1
    if (!ground(lc) || cellCols.has(k2(lx, lz)) || !free(lx, lz) || last - lc.y > 1 || lc.y > last) continue
    let room = true
    for (let d = 1; d <= T.headRoom; d++) if (!open(lx, lc.y + d, lz)) room = false
    if (!room) continue
    return { cells, dir: [dx, dz], cols }
  }
  return null
}

/**
 * ACCESS-02: THE CLIMB SPOTS from the bots' own placements (placeaudit.mjs climbOf -> buildproj.mjs climbRead) -> [{ col: [x, z], n }]
 * busiest first. Pure. A spot is a column with at least `min` logged climbs within Chebyshev 1 of it (within `keepMs`); a chosen spot
 * takes every column within `gap` of it. LIVE showcase 11-04: 33 such 3x3 spots in 6 h, the busiest 17 placements.
 */
export function climbSpots (climbs = [], { now = Date.now(), keepMs = 48 * 60 * 60_000, min = 2, gap = 2 } = {}) {
  const cnt = new Map(), own = new Map()
  for (const c of climbs ?? []) {
    if (!(now - c.t <= keepMs)) continue
    if (c.shape === 'bridge') continue   // roughground-01: a bridge is the keeper's to take back, never a climb spot
    own.set(k2(c.x, c.z), (own.get(k2(c.x, c.z)) ?? 0) + 1)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const k = k2(c.x + dx, c.z + dz); cnt.set(k, (cnt.get(k) ?? 0) + 1) }
  }
  // the window's count first, then the climbs AT the column (the spot is where the bots stood, not a corner of their 3x3)
  const cand = [...cnt].filter(([, n]) => n >= min).map(([k, n]) => ({ col: k.split(',').map(Number), n, at: own.get(k) ?? 0 })).sort((a, b) => b.n - a.n || b.at - a.at || a.col[0] - b.col[0] || a.col[1] - b.col[1]).map(({ col, n }) => ({ col, n }))
  const out = []
  for (const c of cand) if (out.every(o => Math.max(Math.abs(o.col[0] - c.col[0]), Math.abs(o.col[1] - c.col[1])) > gap)) out.push(c)
  return out
}
/**
 * A STAIRCASE AT A CLIMB SPOT -> { cells, dir, cols, edge } | null. Pure over `read`. Within `r` of the spot, the climb is an EDGE: a
 * column L and its 4-neighbour H whose ground stands 2..4 higher (the bots pillared up to it). The stair is piece 3's (planAccessStair)
 * against H: its top step one below H's ground (the step onto H is one block), run away from H, every column `free`. The steepest
 * edge nearest the spot that fits wins.
 *   col(x, z)  tidyColumn (memoised);  cellCols  the record cells' columns;  free(x, z)  may a stair use this column
 */
export function spotStair (read, spot, { col, cellCols = new Set(), free = () => true, r = 2, T = ACCESS } = {}) {
  const ground = c => !!c && !c.why && c.y != null && !c.tree
  const edges = []
  for (let x = spot[0] - r; x <= spot[0] + r; x++) for (let z = spot[1] - r; z <= spot[1] + r; z++) {
    const lc = col(x, z)
    if (!ground(lc) || cellCols.has(k2(x, z)) || !free(x, z)) continue
    for (const [dx, dz] of N4) {
      const hx = x - dx, hz = z - dz, hc = col(hx, hz)
      if (!ground(hc)) continue
      const d = hc.y - lc.y
      if (d < 2 || d > 4) continue
      // Codex r1 BLOCKER (access-02): the destination is GROUND, never a build (a wall top, a roof: a record cell's column, or a column
      // `free` refuses) and never a 1-wide ridge -- the column straight on past H and at least one more of H's other 4-neighbours stand
      // within 1 of it (a ledge one walks on, not a wall top with a drop beyond)
      if (cellCols.has(k2(hx, hz)) || !free(hx, hz)) continue
      const on = col(hx - dx, hz - dz)
      if (!ground(on) || Math.abs(on.y - hc.y) > 1 || cellCols.has(k2(hx - dx, hz - dz))) continue
      const level = N4.filter(([ex, ez]) => !(hx + ex === x && hz + ez === z)).map(([ex, ez]) => col(hx + ex, hz + ez)).filter(c => ground(c) && Math.abs(c.y - hc.y) <= 1).length
      if (level < 2) continue
      edges.push({ x, z, hx: x - dx, hz: z - dz, gL: lc.y, gH: hc.y, d, dist: Math.max(Math.abs(x - spot[0]), Math.abs(z - spot[1])) })
    }
  }
  edges.sort((a, b) => b.d - a.d || a.dist - b.dist || a.x - b.x || a.z - b.z)
  for (const e of edges) {
    const behind = new Set([...cellCols, k2(e.hx, e.hz)])
    const st = planAccessStair(read, { x: e.x, z: e.z, top: e.gH - 1, base: e.gL, col, cellCols: behind, free, T })
    if (st && st.dir[0] === e.x - e.hx && st.dir[1] === e.z - e.hz) return { ...st, edge: [e.x, e.z, e.hx, e.hz] }
  }
  return null
}

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
/** wallext-01: several inside-the-wall surveys (disjoint boxes) as one: their lists joined (a cell listed twice kept once), the
 *  litter and the skipped counts summed. Pure. */
export function mergeSurveys (parts = []) {
  const out = { ok: true, why: 'ok', cut: [], fill: [], pillars: [], pits: [], litter: 0, skipped: {} }
  const seen = { cut: new Set(), fill: new Set(), pillars: new Set(), pits: new Set() }
  parts.forEach((p0, i) => {
    // the wallext + access fold (Codex fold BLOCKER): each survey numbers its pits and pillars from 0 (`h0`, `a0`, `b0`), and tidyRecord
    // groups fills by `pit` and cuts by `pillar` -- the same id from two boxes made one group of both (cells twice, segments shared).
    // Every part's ids are namespaced `p<i>:` (the pit/pillar lists and the fills'/cuts' references alike) before the join
    const ns = v => (v == null ? v : `p${i}:${v}`)
    const p = parts.length > 1 ? { ...p0,
      cut: (p0.cut ?? []).map(c => (c?.pillar != null ? { ...c, pillar: ns(c.pillar) } : c)),
      fill: (p0.fill ?? []).map(f => (f?.pit != null ? { ...f, pit: ns(f.pit) } : f)),
      pillars: (p0.pillars ?? []).map(q => ({ ...q, id: ns(q.id) })),
      pits: (p0.pits ?? []).map(q => ({ ...q, id: ns(q.id) })) } : p0
    for (const f of ['cut', 'fill', 'pillars', 'pits']) for (const e of p[f] ?? []) { const k = f === 'pillars' || f === 'pits' ? `id:${e?.id}` : JSON.stringify(e?.at ?? e); if (seen[f].has(k)) continue; seen[f].add(k); out[f].push(e) }
    out.litter += Number(p.litter) || 0
    // the wallext + access fold: the staircases of every part (access-01's `access` list)
    if (Array.isArray(p.access)) (out.access ??= []).push(...p.access)
    for (const [k, v] of Object.entries(p.skipped ?? {})) out.skipped[k] = (out.skipped[k] ?? 0) + v
  })
  for (const [k, v] of Object.entries(parts[0] ?? {})) if (!(k in out)) out[k] = v
  return out
}
export function surveyInwall (read, { home, box, avoid = () => null, cells = new Set(), noLitter = () => false, reserved = () => false, noStair = () => false, within = () => true, water = 'strict', waterOk = () => false, T = INWALL } = {}) {
  const skipped = {}
  const skip = why => { skipped[why] = (skipped[why] ?? 0) + 1 }
  if (!home || !Array.isArray(box)) return { ok: false, why: 'no_box', cut: [], fill: [], pillars: [], pits: [], litter: 0, skipped }
  const yHi = home.y + TIDY.dy, yLo = home.y - TIDY.dy
  const memo = new Map()
  const col = (x, z) => { const k = k2(x, z); if (!memo.has(k)) memo.set(k, tidyColumn(read, x, z, { yHi, yLo })); return memo.get(k) }
  const ground = c => !!c && !c.why && c.y != null
  const cellCols = new Set([...cells].map(k => { const [x, , z] = k.split(','); return `${x},${z}` }))
  const cut = [], fill = [], pillars = [], pits = [], access = []
  // access-01: the columns a plan of this survey already uses (a staircase never runs over a cut, a fill or another staircase)
  const planned = new Set()
  let litter = 0
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    // outbands-01: a band's survey takes only its own columns (`within`: the band less the walls' insides and the stage's other work)
    if (!within(x, z)) continue
    const why = avoid(x, z)
    if (planned.has(k2(x, z))) { skip('planned'); continue }
    // ---- ON A BUILD: the topmost block of the column, read whatever tidyColumn calls it (a roof's slab reads `built`) ----
    // Codex r1 BLOCKER 1: the stock yard's piles and the tree farm (`noLitter`: their record boxes, from the records themselves --
    // pathAvoid names a yard floor column only `project`) are never litter
    if (noLitter(x, z)) { skip('no_litter'); continue }
    // the showcase gkstage fold (Codex fold review BLOCKER): a site-prep reservation (a prepping or prepared plot) is never inwall's,
    // checked on its own -- `avoid` names a project cell first (`project`), which BUILD_WHY reads as litter on a build
    if (reserved(x, z)) { skip('reserved'); continue }
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
      // access-01: a proper staircase where the climb stood (planAccessStair), the climb's own dirt read open in its cells -- else cut
      const stair = T.access === false || noStair(x, z) || !bl.every(b => STAIR_FROM.test(b.name)) ? null : planAccessStair(read, { x, z, top: c0.y, base: base0, col, cellCols, free: (sx, sz) => !planned.has(k2(sx, sz)) && !noLitter(sx, sz) && !reserved(sx, sz) && !noStair(sx, sz) && (() => { const w = avoid(sx, sz); return !w || BUILD_WHY.test(String(w)) })() })
      if (stair) {
        const id = `a${access.length}`
        access.push({ id, col: [x, z], top: c0.y, base: base0, h: c0.y - base0, dir: stair.dir, cells: stair.cells })
        for (const k of stair.cols) planned.add(k)
        continue
      }
      for (const s of bl) cut.push({ ...s, pillar: `b${litter}` })
      pillars.push({ id: `b${litter}`, col: [x, z], top: c0.y, base: base0, h: bl.length, onBuild: true, beside: true }); litter++
      planned.add(k2(x, z))
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
      // roughground-1b: a stray whose cut would leave its column open under it (a crust over the bots' tunnels) is the rough survey's
      // (cut with the hollow filled after it, dug only while nobody is in it); never opened here
      if (T.hollowRough && (() => { const b = read(x, base, z); return !b || AIRN(nm(b)) || /_leaves$/.test(nm(b)) || b.boundingBox === 'empty' })()) { skip('stray_hollow'); continue }
      const id = `s${pillars.length}`
      pillars.push({ id, col: [x, z], top: c.y, base, h: blocks.length })
      for (const b of blocks) cut.push({ ...b, pillar: id })
      planned.add(k2(x, z))
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
      planned.add(k2(x, z))
    }
  }
  // access-01: the staircases' cells as layered fills (tidyRecord: each layer waits on the one below), named role `access` by the
  // stage (accessCells)
  for (const a of access) {
    const cs = [...new Set(a.cells.map(c => k2(c[0], c[2])))].map(k => k.split(',').map(Number))
    pits.push({ id: a.id, cols: cs, n: a.cells.length, access: true })
    for (const at of a.cells) fill.push({ at, pit: a.id, access: true })
  }
  return { ok: true, why: 'ok', cut, fill, pillars, pits, litter, access, skipped }
}

// ================================================================================================================================
// OUTBANDS-01 (owner 11-04, groundskeeper piece 5: "once that is done, the grounds keeper(s) can move outside the walls and clean
// these areas up, they can leave trees, or cut down trees and replant in better spots. again cleaning up the land, terracing, and
// making it easier for other bots to work, mine, travel, explore"). Each outward band (rim48, rim64, rim80: landplan.mjs landStages)
// already cut tidy-01's pillars (2+ high), filled its pits (2+ deep, up to 3x3) and graded the spokes through it. Now it also
//   CLEANS    the inside-the-wall survey's rules over the band's own columns (surveyInwall with `within`): every STRAY of the bots'
//             material 1+ high above all 8 neighbours, every HOLE lower than all 8 (up to INWALL.holeMax: levelled), the litter ON a
//             build and the dirt climbs BESIDE one (cut: outside the wall a climb is never made a staircase -- a stair to the wall's
//             top from outside is a way over it). Never inside a wall's box (inwall's), never a column this stage already works.
//   STUMPS    a log column standing on its ground, at most OUTBANDS.stumpMax logs, with no leaves within OUTBANDS.stumpLeafR and no
//             other log touching it (a bent acacia's trunk leaves its column: Codex r1) -- a trunk the bots left when they felled the
//             tree: its logs cleared (kind `tree`, no replant owed: the tree is gone).
//   ROAD TREES a living trunk standing in a land-plan road CORRIDOR in the band (the road's own head room is roadWork's): felled whole
//             (its 4-connected trunk columns one tree, at most OUTBANDS.fellMax a band), one replant owed each -- in the tree farm
//             first, then beside a standing GROVE in the wild (replantCells `groves`), never in a corridor, never on this stage's work.
//   Every other tree stays. OUTBANDS=off is the rollback (the band is what it was).
// ================================================================================================================================
export const OUTBANDS = Object.freeze({ stumpMax: 4, stumpLeafR: 2, stumpReach: 32, fellMax: 8, stumpCap: 24, groveR: 5, groveMin: 2 })
/** THE SWITCH -> bool. OUTBANDS=off|0|false|no -> the bands as before; on by default. Pure. */
export const outbandsOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.OUTBANDS ?? '').trim())
/**
 * THE BAND'S TREES -> { stumps: [{ cols, logs }], fells: [{ cols, name, logs }], skipped }. Pure over `read`. `inBand(x, z)`: the
 * band's own columns (the caller's: the band less the walls' insides and the stage's other work); `corridor(x, z)`: the land
 * plan's road corridors. A trunk column is one whose block over its ground is a log; its logs are the run of logs from there up.
 * Never a column `avoid` names, `noLitter` names (the tree farm, the yard) or with a record cell among its logs; an unread cell
 * anywhere in the reading leaves the column alone.
 */
export function bandTrees (read, { home, box, inBand = () => true, corridor = () => null, avoid = () => null, noLitter = () => false, cells = new Set(), T = OUTBANDS } = {}) {
  const skipped = {}
  const skip = why => { skipped[why] = (skipped[why] ?? 0) + 1 }
  const yHi = home.y + TIDY.dy, yLo = home.y - TIDY.dy
  const trunk = new Map()
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) {
    if (!inBand(x, z)) continue
    const c = tidyColumn(read, x, z, { yHi, yLo })
    if (c.why || c.y == null || !c.tree) continue
    const b0 = read(x, c.y + 1, z)
    if (!b0 || !LOG_RE.test(nm(b0))) continue
    const logs = []
    let unread = false
    for (let y = c.y + 1; y <= yHi; y++) { const b = read(x, y, z); if (!b) { unread = true; break } const n = nm(b); if (!LOG_RE.test(n)) break; logs.push({ at: [x, y, z], kind: 'tree', name: n }) }
    if (unread) { skip('tree_unread'); continue }
    if (avoid(x, z) || noLitter(x, z) || logs.some(l => cells.has(l.at.join(',')))) { skip('tree_guarded'); continue }
    trunk.set(k2(x, z), { x, z, logs })
  }
  // trunk columns whose logs TOUCH (8 neighbours, heights within 1: a 2x2 spruce or dark oak, two stumps standing corner to corner --
  // Codex r2) are one tree
  const span = t => [t.logs[0].at[1], t.logs[t.logs.length - 1].at[1]]
  const touch = (a, b) => { const [a0, a1] = span(a), [b0, b1] = span(b); return a0 <= b1 + 1 && b0 <= a1 + 1 }
  const seen = new Set(), stumps = [], fells = []
  for (const [k0, t0] of trunk) {
    if (seen.has(k0)) continue
    const grp = [], q = [t0]
    seen.add(k0)
    for (let i = 0; i < q.length; i++) { grp.push(q[i]); for (const [dx, dz] of N8) { const k = k2(q[i].x + dx, q[i].z + dz); if (trunk.has(k) && !seen.has(k) && touch(q[i], trunk.get(k))) { seen.add(k); q.push(trunk.get(k)) } } }
    const logs = grp.flatMap(g => g.logs)
    const top = Math.max(...logs.map(l => l.at[1])), low = Math.min(...logs.map(l => l.at[1]))
    let leaves = false, unread = false
    // Codex r4: from the ground beside the lowest log (a jungle bush's leaves sit at its base) to 3 over the top
    for (const g of grp) for (let dx = -T.stumpLeafR; dx <= T.stumpLeafR && !leaves; dx++) for (let dz = -T.stumpLeafR; dz <= T.stumpLeafR && !leaves; dz++) for (let y = low - 1; y <= top + 3; y++) {
      const b = read(g.x + dx, y, g.z + dz)
      if (!b) { unread = true; continue }
      if (LEAVES.test(nm(b))) { leaves = true; break }
    }
    const cols = grp.map(g => [g.x, g.z])
    if (!leaves) {
      if (unread) { skip('stump_unread'); continue }
      // Codex r1 BLOCKER: a BENT trunk (acacia, a leaning branch) leaves its column sideways: every log touching the group's logs
      // (26 neighbours) must be the group's own, else it is part of a living tree. Codex r3: a group of more than
      // OUTBANDS.stumpReach logs is never a stump (fail closed: no bound may skip the check)
      if (logs.length > T.stumpReach) { skip('stump_big'); continue }
      const own = new Set(logs.map(l => l.at.join(',')))
      const seenL = new Set(own), qL = logs.map(l => l.at)
      let joined = false
      for (let i = 0; i < qL.length && !joined; i++) {
        const [lx, ly, lz] = qL[i]
        for (let dx = -1; dx <= 1 && !joined; dx++) for (let dy = -1; dy <= 1 && !joined; dy++) for (let dz = -1; dz <= 1; dz++) {
          const k = `${lx + dx},${ly + dy},${lz + dz}`
          if (seenL.has(k)) continue
          const b = read(lx + dx, ly + dy, lz + dz)
          if (!b) { unread = true; continue }
          if (!LOG_RE.test(nm(b))) continue
          seenL.add(k); joined = true; break
        }
      }
      if (unread) { skip('stump_unread'); continue }
      if (joined) { skip('stump_joined'); continue }
      if (grp.some(g => g.logs.length > T.stumpMax)) { skip('stump_tall'); continue }
      if (stumps.length >= T.stumpCap) { skip('stump_cap'); continue }
      stumps.push({ cols, logs })
      continue
    }
    if (!grp.some(g => corridor(g.x, g.z))) continue
    if (fells.length >= T.fellMax) { skip('fell_cap'); continue }
    fells.push({ cols, name: grp[0].logs[0].name, logs })
  }
  return { stumps, fells, skipped }
}

/**
 * A STAGE'S SITING -> { ok, why, record, survey, road }. Pure over `read`. Stage 0 is siteTidy itself (tidy-01). A later stage:
 * tidy-01's survey over its band (rMin, rMax] when it has one, and the earthwork of its road columns (landplan.mjs stageRoadCols)
 * graded with `lim`, their trunks felled with replant cells owed, and `lights` torches beside the roads; the record is tidy-01's
 * (tidyRecord: layered fills, cuts, clears) with `stage`. A column the road touches is the road's alone. `null` record: nothing to
 * do in this stage (the caller moves to the next). townterrace-01: the terrace stage returns a PROMISE (terrace.mjs siteTerrace);
 * callers await siteStage.
 */
export function siteStage (read, { home, land, stage, avoid = () => null, cells = new Set(), plan = null, pin = null, lim = null, lights = 0, now = Date.now(), walkFrom = null, terrace = null, reserved = () => false, forest = null, env = process.env, L = LAND } = {}) {
  const st = typeof stage === 'object' ? stage : stageOf(stage, L)
  // the owner's 11-01 water rule for every stage (tidyWater: TIDY_WATER=strict is the old refusal): the stage may touch the water of
  // a column it may touch at all, never within farmGuard of farmland (the farm's irrigation)
  const water = tidyWater(env)
  // wallext-01: the inside-the-wall stage reaches as far as its boxes (the farm guard's box below)
  const inR = st.id === INWALL_STAGE ? Math.max(-1, ...inwallBoxes(terrace?.wall ?? null, home, terrace?.wallext ?? null).map(b => Math.max(Math.abs(b[0] - home.x), Math.abs(b[2] - home.x), Math.abs(b[1] - home.z), Math.abs(b[3] - home.z)))) : -1
  const reach = Math.max(TIDY.r, st.rMax ?? -1, st.upto ?? -1, inR)
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
    // wallext-01: every box inside the walls (the wall's, the extension's), one survey each, merged
    const boxes = inwallBoxes(terrace?.wall ?? null, home, terrace?.wallext ?? null)
    const box = boxes[0]
    // access-01: the staircases' refusals (accessNoStair), in every box
    const noStair = accessNoStair(terrace?.records ?? [], { plan, land })
    // plotprep-01: the extension's reserved plots first (their trees, their stands, their level); the other inwall rules keep off them
    const pp = plotPrep(read, { plots: terrace?.wallext?.plots ?? [], home, records: terrace?.records ?? [], avoid, cells, noStair })
    const reservedP = (x, z) => pp.cols.has(k2(x, z)) || reserved(x, z)
    const parts = boxes.map(b => surveyInwall(read, { home, box: b, avoid, cells, noLitter: inwallNoLitter(terrace?.records ?? []), reserved: reservedP, noStair, water, waterOk, T: { ...INWALL, hollowRough: roughOn(env) } }))
    const bad = parts.find(q => !q.ok)
    if (bad) return { ok: false, why: bad.why, record: null, survey: bad, road: null }
    const sv00 = parts.length === 1 ? parts[0] : mergeSurveys(parts)
    // access-02: a staircase at every busy climb spot of the bots' own ledger (climbSpots / spotStair), off every column a plan of this
    // stage already uses, off the plots, the stands' refusals, the yard and the tree farm
    const sv0 = { ...sv00, access: [...(sv00.access ?? [])], fill: [...sv00.fill], pits: [...sv00.pits] }
    if (terrace?.climbs?.length) {
      const yHi = home.y + TIDY.dy, yLo = home.y - TIDY.dy
      const memo = new Map()
      const colA = (x, z) => { const k = k2(x, z); if (!memo.has(k)) memo.set(k, tidyColumn(read, x, z, { yHi, yLo })); return memo.get(k) }
      const usedA = new Set([...sv0.cut, ...sv0.fill].map(q => k2(q.at[0], q.at[2])))
      for (const a of sv0.access) for (const c of a.cells) usedA.add(k2(c[0], c[2]))
      const cellColsA = new Set([...cells].map(k => { const [x, , z] = k.split(','); return `${x},${z}` }))
      const inBox = (x, z) => boxes.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])
      const nl = inwallNoLitter(terrace?.records ?? [])
      // the showcase plotprep-02 fold (Codex fold BLOCKER): never across a reserved plot -- a flat unsited plot has no worked columns
      // (pp.cols) and the tidy's `avoid` leaves the land plan's reservations out: every wall-extension plot's box, whole
      const plotBoxesA = (terrace?.wallext?.plots ?? []).map(q => q?.box).filter(b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite))
      const inPlotA = (x, z) => plotBoxesA.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])
      const freeA = (x, z) => inBox(x, z) && !inPlotA(x, z) && !usedA.has(k2(x, z)) && !reservedP(x, z) && !nl(x, z) && !noStair(x, z) && (() => { const w = avoid(x, z); return !w || BUILD_WHY.test(String(w)) })()
      let n = 0
      const spotsTried = []
      for (const sp of climbSpots(terrace.climbs, { now })) {
        if (!inBox(...sp.col)) continue
        const st = spotStair(read, sp.col, { col: colA, cellCols: cellColsA, free: freeA })
        spotsTried.push(`${sp.col.join(',')}:${sp.n}:${st ? 'stair' : 'none'}`)
        if (!st) continue
        const id = `al${n++}`
        sv0.access.push({ id, col: [st.edge[0], st.edge[1]], top: null, base: null, h: st.cols.length, dir: st.dir, cells: st.cells, ledger: true })
        sv0.pits.push({ id, cols: [...new Set(st.cells.map(c => k2(c[0], c[2])))].map(k => k.split(',').map(Number)), n: st.cells.length, access: true })
        for (const at of st.cells) sv0.fill.push({ at, pit: id, access: true })
        for (const k of st.cols) usedA.add(k)
      }
      sv0.ledger = spotsTried
    }
    // roughground-01 (owner 11-07): the ground the rules above miss -- clumps, floating spoil and beams, wide holes, loose crafting
    // tables, the bots' own ledgered scaffold -- off every column this stage already works and the plots' levelling
    if (roughOn(env)) {
      const busyR = new Set([...sv0.cut, ...sv0.fill, ...pp.cut, ...pp.fill].map(q => k2(q.at[0], q.at[2])))
      for (const a of sv0.access ?? []) for (const c of a.cells) busyR.add(k2(c[0], c[2]))
      sv0.cut = [...sv0.cut]; sv0.pillars = [...sv0.pillars]
      // Codex 1c r1 BLOCKER: a stand never stands on a wall extension's reserved plot (the whole box)
      const plotBoxesR = (terrace?.wallext?.plots ?? []).map(q => q?.box).filter(b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite))
      sv0.rough = roughIn(read, { home, boxes, avoid, cells, records: terrace?.records ?? null, noLitter: inwallNoLitter(terrace?.records ?? []), reserved: reservedP, busy: busyR, climbs: terrace?.climbs ?? [], standOff: (x, z) => plotBoxesR.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]) }, sv0)
    }
    // plotprep-01: the plots' levelling cuts and fills, the trees' logs (clears), the stands' cells (access fills, layered)
    // roughground-1c: the rough survey's stands are platforms too (laid as access fills, torn down by platformTeardown)
    const roughPlat = sv0.rough?.platforms ?? []
    const plat = [...pp.platforms, ...roughPlat].map((q, i) => ({ id: `pp${i}`, cells: q.cells }))
    const sv = { ...sv0, cut: [...sv0.cut, ...pp.cut], fill: [...sv0.fill, ...pp.fill, ...plat.flatMap(q => q.cells.map(at => ({ at, pit: q.id, access: true, stand: true })))],
      pits: [...sv0.pits, ...[...new Set(pp.fill.map(f => f.pit))].map(id => ({ id, cols: [pp.fill.find(f => f.pit === id).at].map(a => [a[0], a[2]]) })), ...plat.map(q => ({ id: q.id, cols: [...new Set(q.cells.map(c => k2(c[0], c[2])))].map(k => k.split(',').map(Number)), access: true }))],
      pillars: [...sv0.pillars, ...[...new Set(pp.cut.map(c => c.pillar))].map(id => ({ id }))], clear: [...(sv0.clear ?? []), ...pp.clear, ...(sv0.rough?.clear ?? [])] }
    const rr = Math.max(TIDY.r, ...boxes.map(b => Math.max(Math.abs(b[0] - home.x), Math.abs(b[2] - home.x), Math.abs(b[1] - home.z), Math.abs(b[3] - home.z))))
    // plotprep-01: a felled tree is owed its sapling (replantCells: the tree farm, else the wild zone; the read's G5) -- a tree the
    // zones have no room for keeps standing, its logs and its stand dropped (named)
    const plotBoxes = (terrace?.wallext?.plots ?? []).map(q => q?.box).filter(q => Array.isArray(q) && q.length === 4)
    const avoidRp = (x, z) => avoid(x, z) ?? (plotBoxes.some(q => x >= q[0] && x <= q[2] && z >= q[1] && z <= q[3]) ? 'land:plot' : null)
    const rp = pp.trees.length ? (land ? replantCells(read, land, pp.trees.map(t => ({ col: t.col, name: t.name })), { avoid: avoidRp, cells, forest, forestR: tidyWalkR({ r: rr }) - 2 }) : []) : []
    const keptT = new Set(pp.trees.map((t, i) => i).filter(i => i >= rp.length))
    if (keptT.size) { sv.skipped = { ...sv.skipped, [land ? 'tree_no_replant' : 'tree_no_land']: keptT.size }; sv.clear = sv.clear.filter(c => !(c.kind === 'tree' && keptT.has(c.tree))) }
    const platsKept = [...pp.platforms.filter(q => !keptT.has(q.tree)), ...roughPlat]
    const standK = new Set(pp.platforms.filter(q => q.tree != null && keptT.has(q.tree)).flatMap(q => q.cells.map(c => c.join(','))))
    if (standK.size) sv.fill = sv.fill.filter(f => !standK.has(f.at.join(',')))
    let record = tidyRecord(sv, { home, plan, now, r: rr })
    if (!record && sv.clear.length) record = { v: 1, blueprint: TIDY_BLUEPRINT, plot: TIDY_PLOT, home: { x: home.x, y: home.y, z: home.z }, r: rr, cells: [], clear: [...sv.clear].sort((p, q) => p.at[1] - q.at[1]), cut: [], replant: [], segments: [], zones: [], pillars: 0, pits: 0, skipped: {}, bom: { earth: 0 }, builders_max: TIDY_BUILDERS, structure_complete: false, plan: plan?.gen != null ? { gen: plan.gen } : null, sitedAt: now }
    if (record && rp.length) record.replant = rp.map((r, i) => ({ ...r, tree: i, ...(pp.trees[i]?.plot != null ? { plot: pp.trees[i].plot } : {}) }))
    // plotprep-02: every plot entry keeps its plot's id on the record (tidyRecord rebuilds cuts and cells without it)
    if (record) {
      const tag = new Map([...pp.cut, ...pp.fill].map(q => [q.at.join(','), q.plot]))
      for (const q of pp.platforms) for (const c of q.cells) tag.set(c.join(','), q.plot)
      record.cells = record.cells.map(c => (tag.has(c.at.join(',')) ? { ...c, plot: tag.get(c.at.join(',')) } : c))
      record.cut = record.cut.map(c => (tag.has(c.at.join(',')) ? { ...c, plot: tag.get(c.at.join(',')) } : c))
    }
    if (record && (pp.plots.length || platsKept.length)) record.plotprep = { plots: pp.plots, platforms: platsKept, skipped: pp.skipped }
    if (!record) return { ok: true, why: 'nothing', record: null, survey: sv, road: null }
    record.stage = legacyStage(st); record.stageId = st.id; record.terraceV = 1
    record.land = land ? { seed: land.seed, sitedAt: land.sitedAt ?? null } : null
    // access-01: the staircase cells are role `access` (TIDY_PALETTE.access: stone, never dirt)
    const acc = new Set((sv.fill ?? []).filter(f => f.access).map(f => f.at.join(',')))
    if (acc.size) record.cells = record.cells.map(c => (acc.has(c.at.join(',')) ? { ...c, role: 'access' } : c))
    record.inwall = { box, ...(boxes.length > 1 ? { boxes } : {}), pillars: sv.pillars.length, litter: sv.litter, holes: sv.pits.filter(q => !q.access).length, cut: sv.cut.length, fill: sv.fill.length, skipped: sv.skipped,
      access: (sv.access ?? []).map(a => ({ col: a.col, top: a.top, h: a.h, dir: a.dir, n: a.cells.length, ...(a.ledger ? { ledger: true } : {}) })), ...(sv.ledger ? { ledger: sv.ledger.slice(0, 40) } : {}), ...(sv.rough ? { rough: { census: sv.rough.census, skipped: sv.rough.skipped } } : {}) }
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
  // outbands-01: the band's own clean-up (strays, holes, litter, climbs), its stumps and its road trees (bandTrees), over the band's
  // columns less the walls' insides and every column this stage already works
  let band = null, bandPlat = []   // roughground-1c: the band's stands
  const bandClear = [], bandTrunks = [], busy = new Set()
  if (outbandsOn(env) && st.rMax > 0) {
    const boxes = inwallBoxes(terrace?.wall ?? null, home, terrace?.wallext ?? null)
    const inWall = (x, z) => boxes.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])
    for (const c of [...s.cut, ...s.fill, ...(s.clear ?? [])]) busy.add(k2(c.at[0], c.at[2]))
    for (const p of s.pits) for (const c of p.cols ?? []) busy.add(k2(c[0], c[1]))
    const work = new Set(busy)
    const dh = (x, z) => Math.max(Math.abs(x - home.x), Math.abs(z - home.z))
    const inBand = (x, z) => dh(x, z) > st.rMin && dh(x, z) <= st.rMax && !inWall(x, z) && !work.has(k2(x, z))
    const bx = [home.x - st.rMax, home.z - st.rMax, home.x + st.rMax, home.z + st.rMax]
    const noLitter = inwallNoLitter(terrace?.records ?? [])
    const tr = bandTrees(read, { home, box: bx, inBand, corridor: corridorAt(land), avoid, noLitter, cells })
    const treeK = new Set([...tr.stumps, ...tr.fells].flatMap(t => t.cols.map(([x, z]) => k2(x, z))))
    const sv = surveyInwall(read, { home, box: bx, within: (x, z) => inBand(x, z) && !treeK.has(k2(x, z)), avoid, cells, noLitter, reserved, water, waterOk, T: { ...INWALL, access: false, hollowRough: roughOn(env) } })
    if (sv.ok) {
      const ns = v => `o${v}`
      for (const c of sv.cut) { s.cut.push({ ...c, pillar: ns(c.pillar) }); busy.add(k2(c.at[0], c.at[2])) }
      for (const f of sv.fill) { s.fill.push({ ...f, pit: ns(f.pit) }); busy.add(k2(f.at[0], f.at[2])) }
      for (const q of sv.pillars) s.pillars.push({ ...q, id: ns(q.id) })
      for (const q of sv.pits) s.pits.push({ ...q, id: ns(q.id) })
    }
    // roughground-01: the band's rough ground (the same survey as inside the wall, over the band's own columns)
    let roughB = null
    if (roughOn(env)) {
      const acc = { cut: [], fill: [], pillars: [], pits: [] }
      roughB = roughIn(read, { home, boxes: [bx], within: (x, z) => inBand(x, z) && !treeK.has(k2(x, z)), avoid, cells, records: terrace?.records ?? null, noLitter, reserved, busy, climbs: terrace?.climbs ?? [] }, acc)
      for (const c of acc.cut) { s.cut.push({ ...c, pillar: `o${c.pillar}` }); busy.add(k2(c.at[0], c.at[2])) }
      for (const f of acc.fill) { s.fill.push({ ...f, pit: `o${f.pit}` }); busy.add(k2(f.at[0], f.at[2])) }
      for (const q of acc.pillars) s.pillars.push({ ...q, id: `o${q.id}` })
      for (const q of acc.pits) s.pits.push({ ...q, id: `o${q.id}` })
      // roughground-1c: the band's stands (access fills, layered), their leaves cleared; torn down by platformTeardown
      roughB.platforms.forEach((q, i) => { const id = `ost${i}`; s.pits.push({ id, cols: [...new Set(q.cells.map(c => k2(c[0], c[2])))].map(v => v.split(',').map(Number)), access: true }); for (const at of q.cells) { s.fill.push({ at, pit: id, access: true, stand: true }); busy.add(k2(at[0], at[2])) } })
      for (const c of roughB.clear) bandClear.push(c)
    }
    for (const t of [...tr.stumps, ...tr.fells]) { bandClear.push(...t.logs); for (const [x, z] of t.cols) busy.add(k2(x, z)) }
    for (const f of tr.fells) bandTrunks.push({ col: f.cols[0], name: f.name })
    band = { strays: sv.ok ? sv.pillars.filter(q => !q.onBuild).length : 0, holes: sv.ok ? sv.pits.length : 0, litter: sv.ok ? sv.litter : 0,
      stumps: tr.stumps.length, fells: tr.fells.length, ...(sv.ok ? {} : { why: sv.why }), skipped: { ...(sv.skipped ?? {}), ...tr.skipped }, ...(roughB ? { rough: { census: roughB.census, skipped: roughB.skipped } } : {}) }
    bandPlat = roughB?.platforms ?? []
  }
  const lightAt = roadLights(read, rcols, { home, avoid: (x, z) => avoid(x, z) ?? (rk.has(k2(x, z)) || busy.has(k2(x, z)) ? 'road' : null), n: lights, cells })
  let record = tidyRecord(s, { home, plan, now, r: Math.max(st.rMax, st.upto ?? -1, TIDY.r) })
  if (!record && !road.clear.length && !lightAt.length && !bandClear.length) return { ok: true, why: 'nothing', record: null, survey, road, band }
  record ??= { v: 1, blueprint: TIDY_BLUEPRINT, plot: TIDY_PLOT, home: { x: home.x, y: home.y, z: home.z }, r: Math.max(st.upto ?? -1, TIDY.r), cells: [], clear: [], cut: [], replant: [], segments: [], zones: [], pillars: 0, pits: 0, skipped: {}, bom: { earth: 0 }, builders_max: TIDY_BUILDERS, structure_complete: false, plan: plan?.gen != null ? { gen: plan.gen } : null, sitedAt: now }
  record.clear = [...(record.clear ?? [])]
  for (const c of [...road.clear, ...bandClear]) if (!record.clear.some(q => q.at.join(',') === c.at.join(','))) record.clear.push(c)
  record.clear.sort((a, b) => a.at[1] - b.at[1])
  // outbands-01: the band's felled road trees owe their replants too; with the switch on every replant goes to a grove first
  record.replant = replantCells(read, land, [...road.trees, ...bandTrunks], { avoid, cells, groves: !!band, busy, forest, forestR: tidyWalkR(record) - 2 })
  if (lightAt.length) {
    record.segments.push({ seg: 'T-L', deps: [] })
    for (const l of lightAt) record.cells.push({ at: l.at, role: 'light', seg: 'T-L' })
  }
  record.stage = legacyStage(st)
  record.stageId = st.id
  record.terraceV = 1   // townterrace-01: sited in the ring order that has the terrace stage (landplan.mjs recStageK)
  record.land = { seed: land.seed, sitedAt: land.sitedAt ?? null }
  if (bandPlat.length) {
    const accB = new Set(bandPlat.flatMap(q => q.cells.map(c => c.join(','))))
    record.cells = record.cells.map(c => (accB.has(c.at.join(',')) ? { ...c, role: 'access' } : c))
    record.plotprep = { plots: [], platforms: bandPlat, skipped: {} }
  }
  record.road = { cols: rcols.length, cut: road.cut.length, fill: road.fill.length, trees: road.trees.length, replant: record.replant.length, lights: lightAt.length, skipped: road.skipped, walk: road.walk ?? null }
  if (band) record.band = band
  record.r = Math.max(record.r ?? 0, st.upto ?? -1, st.rMax ?? -1)
  return { ok: true, why: 'ok', record, survey, road, band }
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
