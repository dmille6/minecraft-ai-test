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

export const TIDY_PLOT = 'tidy'
export const TIDY_BLUEPRINT = 'tidy@1'
export const TIDY_BUILDERS = 3
/** The survey's bounds (see the header). r: half-width of the tidied square round home; dy: the scan's height band round home.y. */
export const TIDY = Object.freeze({ r: 32, dy: 14, pillarMin: 2, pillarMax: 6, pitMin: 2, pitDepthMax: 6, pitWide: 3, segCells: 24 })
/** A bot's materials: what a pillar may be made of to be cut (dirt placed in the light turns grass_block). */
export const SPOIL = /^(dirt|coarse_dirt|grass_block|cobblestone|mossy_cobblestone|cobbled_deepslate|netherrack|[a-z_]+_planks)$/
/** What a fill places: the bag's dirt first, then cobblestone. Done = any full solid (not leaves). */
export const TIDY_PALETTE = Object.freeze({ earth: ['dirt', 'cobblestone', 'coarse_dirt', 'cobbled_deepslate', '*solid'] })
/** A complete tidy is surveyed again after this long (the bots keep digging and climbing). */
export const TIDY_RESURVEY_MS = 48 * 60 * 60_000
/** A cut a bot found no stand for (or that did not come down) in this many of its visits is given up by that bot; the record
 *  completes over the cuts every builder has given up (tidyGiveUp). */
export const TIDY_CUT_TRIES = 3
/** A clear's one-call bound (buildrun.mjs `clearMax`). */
export const TIDY_CLEAR_MAX = 48

/**
 * THE SWITCH -> bool. TIDY=on|off; unset = every pool TIDY_POOLS names (default '*'), except the showcase unless named: the
 * showcase's ground is the owner's picture (14% rough; its own zigtidy cleans the ziggurat). Pure.
 */
export const TIDY_DEFAULT_OFF_POOLS = Object.freeze(['showcase'])
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

/**
 * THE SURVEY -> { cut: [{ at, name, pillar }], fill: [{ at, pit }], pillars: [...], pits: [...], skipped: { reason: n }, cols }.
 * Pure over `read`.
 *   home        { x, y, z }
 *   avoid(x,z)  -> reason | null: zones, the plan, wells, the farm, the tree farm, every project's record and reservation
 *   cells       Set "x,y,z" never touched (every project's record cells: belt and braces under `avoid`)
 *   r           half-width of the tidied square (TIDY.r)
 */
export function surveyTidy (read, { home, avoid = () => null, cells = new Set(), r = TIDY.r, T = TIDY } = {}) {
  const skipped = {}
  const skip = why => { skipped[why] = (skipped[why] ?? 0) + 1 }
  if (!home || ![home.x, home.y, home.z].every(Number.isFinite)) return { ok: false, why: 'no_home', cut: [], fill: [], pillars: [], pits: [], skipped }
  const yHi = home.y + T.dy, yLo = home.y - T.dy
  const memo = new Map()
  // the scan reaches 2 past the square (the pit rule's 5x5 median, the rims)
  const col = (x, z) => { const k = k2(x, z); if (!memo.has(k)) memo.set(k, tidyColumn(read, x, z, { yHi, yLo })); return memo.get(k) }
  const inSq = (x, z) => Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) <= r
  const ground = c => !!c && !c.why && c.y != null
  const free = (x, z) => !avoid(x, z)
  const cut = [], fill = [], pillars = [], pits = []
  // ---- PILLARS ----
  for (let x = home.x - r; x <= home.x + r; x++) for (let z = home.z - r; z <= home.z + r; z++) {
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
export const gradeLim = (read, n = 4) => {
  const wet = wetAt(read)
  return { fillMax: n, cutMax: n, cut: GRADE_CUT, fillOk: b => fillable(b), cutOk: (b, x, y, z) => !wet(x, y, z) }
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
export function gradeTidy (read, pin, { cells = new Set(), lim = gradeLim(read, 4), reserved = () => null } = {}) {
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
  const cut = [], fill = [], clear = []
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
        else if (!b || !(AIRN(n) || replaceableCell(b))) { bad = 'grade_fill_blocked'; break }
        add.push({ at: [x, y, z] })
      }
      if (bad) { skip(bad); continue }
      fill.push(...add); clear.push(...lv)
    } else {
      const add = []
      let bad = null
      for (let y = g; y > L; y--) {
        const b = read(x, y, z), n = nm(b)
        if (cells.has(`${x},${y},${z}`)) { bad = 'grade_guarded'; break }
        if (!b || !lim.cut.test(n)) { bad = 'grade_cut_blocked'; break }
        if (wet(x, y, z)) { bad = 'grade_wet'; break }
        add.push({ at: [x, y, z], name: n })
      }
      if (bad) { skip(bad); continue }
      cut.push(...add)
    }
  }
  return { ok: true, why: 'ok', cut, fill, clear, legs, skipped, home }
}

/**
 * THE SITING -> { ok, why, record, survey, grade, tried }. Pure over `read`. The survey (pillars, pits) round home, and -- when `pin`
 * is given (the paths are not laid yet, or stand as a no-site record) -- the grading of the paths' corridors, tried at every
 * allowance of TIDY_GRADES: each candidate (survey + grading) is checked by the paths' OWN router on the ground as the tidy would
 * leave it (tidyOverlay), and the one leaving the fewest required legs unrouted is the record (ties: fewer cells). A column the
 * grading touches is the grading's alone. The bot's own (skills.mjs buildTidy) and the offline proof's (scripts/tidy-offline.mjs).
 */
export function siteTidy (read, { home, avoid = () => null, cells = new Set(), pin = null, plan = null, r = TIDY.r, now = Date.now(), grades = TIDY_GRADES } = {}) {
  const survey = surveyTidy(read, { home, avoid, cells, r })
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
      const grade = gradeTidy(read, pin, { cells, lim: gradeLim(read, n), reserved: avoid })
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
